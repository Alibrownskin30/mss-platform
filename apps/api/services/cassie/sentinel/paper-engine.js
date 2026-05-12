import db from "../../../db/index.js";
import {
SENTINEL_MODE,
getEffectiveSentinelConfig,
normalizeSentinelConfig,
} from "./config.js";
import { REASON_CODE, ensureReasonCodeArray } from "./reason-codes.js";
import {
createScoutPosition,
addSniperToPosition,
refreshPositionMarketValue,
markPositionBankedAt10x,
upsertTokenCooldown,
ensureDailyStats,
incrementDailyStats,
resetDailyFailureStreak,
snapshotOpenPositionExposure,
getOpenPositionByToken,
getDailyStats,
closePosition,
} from "./position-store.js";
import {
AUDIT_EVENT_TYPE,
EXECUTION_STATUS,
logAuditEvent,
logTokenReject,
logScoutEntry,
logSniperAdd,
logPartialTakeProfit,
logRunnerExit,
logFullExit,
logKillSwitch,
} from "./audit-log.js";
import { evaluateToken, SENTINEL_DECISION } from "./evaluator.js";
import { isInvalidationReason } from "./exits.js";

const NON_ACTION_AUDIT_COOLDOWN_MS = 60 * 1000;
const nonActionAuditCache = new Map();

function cleanText(value, max = 255) {
return String(value ?? "").trim().slice(0, max);
}

function toFloat(value, fallback = null) {
const num = Number.parseFloat(value);
return Number.isFinite(num) ? num : fallback;
}

function toInt(value, fallback = null) {
const num = Number.parseInt(value, 10);
return Number.isFinite(num) ? num : fallback;
}

function todayUtcDate() {
return new Date().toISOString().slice(0, 10);
}

function buildPaperExecutionRef(action, tokenId = "") {
const safeAction = cleanText(action, 48).toLowerCase() || "paper";
const safeToken =
cleanText(tokenId, 48).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || "token";
const stamp = Date.now();
return `paper_${safeAction}_${safeToken}_${stamp}`;
}

function getSnapshotTokenLookupValue(snapshot = {}) {
return (
cleanText(snapshot.token_id, 255) ||
cleanText(snapshot.mint_address, 255) ||
cleanText(snapshot.mint, 255) ||
""
);
}

function getCurrentPrice(snapshot = {}) {
return (
toFloat(snapshot.price_now, null) ??
toFloat(snapshot.current_price, null) ??
toFloat(snapshot.price, null) ??
null
);
}

function derivePositionCurrentValue(snapshot = {}, position = null, fallback = null) {
const explicitValue =
toFloat(snapshot.position_value_usd, null) ??
toFloat(snapshot.current_value_usd, null) ??
null;

if (explicitValue != null) return Math.max(0, explicitValue);

const priceNow = getCurrentPrice(snapshot);
if (priceNow != null && position?.units != null) {
return Math.max(0, priceNow * Math.max(0, Number(position.units) || 0));
}

const multiple = toFloat(snapshot.current_multiple, null);
if (multiple != null && position?.total_cost_usd != null) {
return Math.max(
0,
multiple * Math.max(0, Number(position.total_cost_usd) || 0)
);
}

if (position?.current_value_usd != null) {
return Math.max(0, Number(position.current_value_usd) || 0);
}

if (fallback != null) {
return Math.max(0, Number(fallback) || 0);
}

return null;
}

function deriveEntryUnits(sizeUsd, snapshot = {}) {
const priceNow = getCurrentPrice(snapshot);
const safeSize = Math.max(0, Number(sizeUsd) || 0);

if (priceNow != null && priceNow > 0) {
return safeSize / priceNow;
}

return safeSize;
}

function getCooldownSeconds(config = {}, reasonCodes = []) {
const reasons = ensureReasonCodeArray(reasonCodes, []);
const hasInvalidationReason = reasons.some((code) => isInvalidationReason(code));

return hasInvalidationReason
? Math.max(0, toInt(config.cooldown_after_invalidation_sec, 3600) || 3600)
: Math.max(0, toInt(config.cooldown_after_close_sec, 1800) || 1800);
}

function getNonActionAuditEventType(decision) {
if (decision === SENTINEL_DECISION.WATCHLIST) {
return AUDIT_EVENT_TYPE?.WATCHLIST || "watchlist";
}

if (decision === SENTINEL_DECISION.HOLD) {
return AUDIT_EVENT_TYPE?.HOLD || "hold";
}

if (decision === SENTINEL_DECISION.REJECT) {
return AUDIT_EVENT_TYPE?.TOKEN_REJECT || "token_reject";
}

if (decision === SENTINEL_DECISION.KILL_SWITCH) {
return AUDIT_EVENT_TYPE?.KILL_SWITCH || "kill_switch";
}

return AUDIT_EVENT_TYPE?.DECISION || "decision";
}

function getNonActionExecutionStatus(decision) {
if (
decision === SENTINEL_DECISION.WATCHLIST ||
decision === SENTINEL_DECISION.HOLD
) {
return EXECUTION_STATUS?.SIMULATED || "simulated";
}

return EXECUTION_STATUS?.SKIPPED || "skipped";
}

function pruneNonActionAuditCache() {
const cutoff = Date.now() - NON_ACTION_AUDIT_COOLDOWN_MS;
for (const [key, ts] of nonActionAuditCache.entries()) {
if (!Number.isFinite(ts) || ts < cutoff) {
nonActionAuditCache.delete(key);
}
}
}

function buildNonActionAuditKey(evaluation = {}) {
const decision = cleanText(evaluation?.decision, 64).toLowerCase() || "decision";
const tokenId =
cleanText(evaluation?.snapshot?.token_id, 255) ||
cleanText(evaluation?.snapshot?.mint_address, 255) ||
"unknown";
const reasons = ensureReasonCodeArray(evaluation?.reason_codes || []).join("|");
return `${decision}:${tokenId}:${reasons}`;
}

function shouldLogNonActionAudit(evaluation = {}, context = {}) {
if (context.log_non_actions === false) return false;

pruneNonActionAuditCache();

const key = buildNonActionAuditKey(evaluation);
const lastLoggedAt = nonActionAuditCache.get(key);
if (lastLoggedAt && Date.now() - lastLoggedAt < NON_ACTION_AUDIT_COOLDOWN_MS) {
return false;
}

nonActionAuditCache.set(key, Date.now());
return true;
}

async function syncDailyUnrealizedForMode(executionMode = SENTINEL_MODE.PAPER) {
const statDate = todayUtcDate();
await ensureDailyStats(executionMode, statDate);
const exposure = await snapshotOpenPositionExposure(executionMode);

await db.run(
`
UPDATE cassie_sentinel_daily_stats
SET
daily_unrealized_pnl_usd = ?,
updated_at = CURRENT_TIMESTAMP
WHERE stat_date = ?
AND execution_mode = ?
`,
[Number(exposure.unrealized_pnl_usd) || 0, statDate, executionMode]
);

return exposure;
}

async function maybeRefreshPaperPositionValue(position, snapshot = {}) {
if (!position?.id) return position;

const currentValueUsd = derivePositionCurrentValue(
snapshot,
position,
position.current_value_usd
);
const priceNow = getCurrentPrice(snapshot);

if (currentValueUsd == null) {
return position;
}

return refreshPositionMarketValue(position.id, {
current_value_usd: currentValueUsd,
avg_exit_price: priceNow ?? position.avg_exit_price ?? null,
});
}

async function refreshPassiveEvaluationPosition(
evaluation = {},
snapshot = {},
executionMode = SENTINEL_MODE.PAPER
) {
let refreshedPosition = evaluation?.position || null;

if (refreshedPosition?.id) {
refreshedPosition = await maybeRefreshPaperPositionValue(refreshedPosition, snapshot);
await syncDailyUnrealizedForMode(executionMode);
}

return refreshedPosition;
}

async function buildPaperEvaluationContext(snapshot = {}, context = {}) {
const suppliedPosition =
context?.position && typeof context.position === "object" && context.position.id
? context.position
: null;

const tokenLookup = getSnapshotTokenLookupValue(snapshot);

const openPosition =
suppliedPosition ||
(tokenLookup
? await getOpenPositionByToken(tokenLookup, SENTINEL_MODE.PAPER)
: null);

const dayStats =
context?.day_stats && typeof context.day_stats === "object"
? context.day_stats
: await getDailyStats(SENTINEL_MODE.PAPER);

return {
...context,
execution_mode: SENTINEL_MODE.PAPER,
log_non_actions: context.log_non_actions !== false,
position: openPosition || null,
position_id: openPosition?.id || null,
day_stats: dayStats,
};
}

async function closePaperPosition(
position,
{
snapshot = {},
config = {},
reason_codes = [REASON_CODE.FULL_EXIT_EXECUTED],
execution_mode = SENTINEL_MODE.PAPER,
} = {}
) {
const currentPosition = await maybeRefreshPaperPositionValue(position, snapshot);
const exitValueUsd =
derivePositionCurrentValue(
snapshot,
currentPosition,
currentPosition.current_value_usd
) ?? 0;
const priceNow = getCurrentPrice(snapshot);
const reasons = ensureReasonCodeArray(reason_codes, [REASON_CODE.FULL_EXIT_EXECUTED]);
const txCloseRef = buildPaperExecutionRef("exit", currentPosition.token_id);

const beforeRealized = Number(currentPosition.realized_pnl_usd || 0);

const closedPosition = await closePosition(currentPosition.id, {
exit_value_usd: exitValueUsd,
avg_exit_price: priceNow ?? currentPosition.avg_exit_price ?? null,
tx_close_ref: txCloseRef,
close_reason_codes: reasons,
});

const realizedIncrement =
Number(closedPosition?.realized_pnl_usd || 0) - beforeRealized;

const cooldownSeconds = getCooldownSeconds(config, reasons);

if (cooldownSeconds > 0) {
const cooldownUntil = new Date(Date.now() + cooldownSeconds * 1000).toISOString();
await upsertTokenCooldown({
token_id: currentPosition.token_id,
mint_address: currentPosition.mint_address,
last_close_reason: reasons[0] || REASON_CODE.POSITION_CLOSED,
cooldown_until: cooldownUntil,
});
}

await syncDailyUnrealizedForMode(executionMode);

return {
position: closedPosition,
tx_close_ref: txCloseRef,
realized_increment_usd: realizedIncrement,
close_stage: closedPosition?.stage || "closed",
};
}

async function executePaperScoutEntry(evaluation, config, context = {}) {
const snapshot = evaluation.snapshot || {};
const tokenId =
cleanText(snapshot.token_id, 255) || cleanText(snapshot.mint_address, 255);
const mintAddress =
cleanText(snapshot.mint_address, 255) || cleanText(snapshot.token_id, 255);
const sizeUsd = Math.max(0, Number(evaluation.size_usd || config.scout_usd) || 0);
const priceNow = getCurrentPrice(snapshot);
const units = deriveEntryUnits(sizeUsd, snapshot);
const txOpenRef = buildPaperExecutionRef("scout", tokenId);

const position = await createScoutPosition({
token_id: tokenId,
mint_address: mintAddress,
linked_operator_cluster_id:
cleanText(snapshot.linked_operator_cluster_id, 255) || null,
execution_mode: SENTINEL_MODE.PAPER,
size_usd: sizeUsd,
units,
avg_entry_price: priceNow,
current_value_usd: sizeUsd,
entry_reason_codes: evaluation.reason_codes,
tx_open_ref: txOpenRef,
});

await incrementDailyStats(SENTINEL_MODE.PAPER, {
scouts_opened: 1,
daily_scout_spend_usd: sizeUsd,
});

await syncDailyUnrealizedForMode(SENTINEL_MODE.PAPER);

const auditEvent = await logScoutEntry({
token_id: tokenId,
mint_address: mintAddress,
position_id: position?.id || null,
execution_mode: SENTINEL_MODE.PAPER,
size_usd: sizeUsd,
reason_codes: evaluation.reason_codes,
snapshot_summary: snapshot,
execution_status: EXECUTION_STATUS.SIMULATED,
actor_id: context.actor_id || "system",
});

return {
decision: evaluation.decision,
position,
audit_event: auditEvent,
simulated: true,
};
}

async function executePaperSniperAdd(evaluation, config, context = {}) {
const snapshot = evaluation.snapshot || {};
const position = evaluation.position;
const sizeUsd = Math.max(0, Number(evaluation.size_usd || config.sniper_add_usd) || 0);
const priceNow = getCurrentPrice(snapshot);
const addUnits = deriveEntryUnits(sizeUsd, snapshot);

const refreshed = await maybeRefreshPaperPositionValue(position, snapshot);
const updatedPosition = await addSniperToPosition(refreshed.id, {
add_size_usd: sizeUsd,
add_units: addUnits,
add_avg_entry_price: priceNow,
current_value_usd:
(derivePositionCurrentValue(snapshot, refreshed, refreshed.current_value_usd) ??
0) + sizeUsd,
tx_add_ref: buildPaperExecutionRef("sniper", refreshed.token_id),
});

await syncDailyUnrealizedForMode(SENTINEL_MODE.PAPER);

const auditEvent = await logSniperAdd({
token_id: refreshed.token_id,
mint_address: refreshed.mint_address,
position_id: refreshed.id,
execution_mode: SENTINEL_MODE.PAPER,
size_usd: sizeUsd,
reason_codes: evaluation.reason_codes,
snapshot_summary: snapshot,
execution_status: EXECUTION_STATUS.SIMULATED,
actor_id: context.actor_id || "system",
});

return {
decision: evaluation.decision,
position: updatedPosition,
audit_event: auditEvent,
simulated: true,
};
}

async function executePaperTakeProfit(evaluation, config, context = {}) {
const snapshot = evaluation.snapshot || {};
const position = evaluation.position;
const refreshed = await maybeRefreshPaperPositionValue(position, snapshot);
const bankFraction = Math.min(
1,
Math.max(
0.01,
Number(evaluation.bank_fraction || config.auto_bank_fraction) || 0.5
)
);

const currentValueUsd =
derivePositionCurrentValue(snapshot, refreshed, refreshed.current_value_usd) ??
refreshed.current_value_usd;
const remainingValueUsd = currentValueUsd * (1 - bankFraction);
const remainingUnits = Math.max(
0,
Number(refreshed.units || 0) * (1 - bankFraction)
);

const beforeRealized = Number(refreshed.realized_pnl_usd || 0);
const updatedPosition = await markPositionBankedAt10x(refreshed.id, {
bank_fraction: bankFraction,
realized_exit_value_usd: currentValueUsd * bankFraction,
remaining_value_usd: remainingValueUsd,
remaining_units: remainingUnits,
tx_bank_ref: buildPaperExecutionRef("bank", refreshed.token_id),
});

const realizedIncrement =
Number(updatedPosition?.realized_pnl_usd || 0) - beforeRealized;

if (realizedIncrement < 0) {
await incrementDailyStats(SENTINEL_MODE.PAPER, {
consecutive_failures: 1,
});
} else if (realizedIncrement > 0) {
await resetDailyFailureStreak(SENTINEL_MODE.PAPER);
}

await syncDailyUnrealizedForMode(SENTINEL_MODE.PAPER);

const auditEvent = await logPartialTakeProfit({
token_id: refreshed.token_id,
mint_address: refreshed.mint_address,
position_id: refreshed.id,
execution_mode: SENTINEL_MODE.PAPER,
bank_fraction: bankFraction,
reason_codes: evaluation.reason_codes,
snapshot_summary: snapshot,
execution_status: EXECUTION_STATUS.SIMULATED,
actor_id: context.actor_id || "system",
});

return {
decision: evaluation.decision,
position: updatedPosition,
audit_event: auditEvent,
simulated: true,
};
}

async function executePaperExit(evaluation, config, context = {}) {
const snapshot = evaluation.snapshot || {};
const position = evaluation.position;
const closed = await closePaperPosition(position, {
snapshot,
config,
reason_codes: evaluation.reason_codes,
execution_mode: SENTINEL_MODE.PAPER,
});

const auditEvent = position?.has_banked_10x
? await logRunnerExit({
token_id: position.token_id,
mint_address: position.mint_address,
position_id: position.id,
execution_mode: SENTINEL_MODE.PAPER,
reason_codes: evaluation.reason_codes,
snapshot_summary: snapshot,
execution_status: EXECUTION_STATUS.SIMULATED,
actor_id: context.actor_id || "system",
})
: await logFullExit({
token_id: position.token_id,
mint_address: position.mint_address,
position_id: position.id,
execution_mode: SENTINEL_MODE.PAPER,
reason_codes: evaluation.reason_codes,
snapshot_summary: snapshot,
execution_status: EXECUTION_STATUS.SIMULATED,
actor_id: context.actor_id || "system",
});

return {
decision: evaluation.decision,
position: closed.position,
audit_event: auditEvent,
simulated: true,
meta: {
realized_increment_usd: closed.realized_increment_usd,
close_stage: closed.close_stage,
},
};
}

async function maybeLogNonAction(evaluation, context = {}) {
if (!shouldLogNonActionAudit(evaluation, context)) {
return null;
}

return logAuditEvent({
event_type: getNonActionAuditEventType(evaluation.decision),
token_id: evaluation.snapshot?.token_id || null,
mint_address: evaluation.snapshot?.mint_address || null,
position_id: evaluation.position?.id || null,
execution_mode: SENTINEL_MODE.PAPER,
decision: evaluation.decision,
reason_codes: evaluation.reason_codes,
snapshot_summary: evaluation.snapshot || null,
action_payload: {
position_id: evaluation.position?.id || null,
size_usd: evaluation.size_usd ?? null,
bank_fraction: evaluation.bank_fraction ?? null,
},
execution_status: getNonActionExecutionStatus(evaluation.decision),
actor_type: "system",
actor_id: context.actor_id || "system",
});
}

export async function processPaperSnapshot(snapshot = {}, config = {}, context = {}) {
const safeConfig = getEffectiveSentinelConfig({
...normalizeSentinelConfig(config || {}),
execution_mode: SENTINEL_MODE.PAPER,
});

const safeContext = await buildPaperEvaluationContext(snapshot, context);
const evaluation = await evaluateToken(snapshot, safeConfig, safeContext);

switch (evaluation.decision) {
case SENTINEL_DECISION.KILL_SWITCH: {
const refreshedPosition = await refreshPassiveEvaluationPosition(
evaluation,
snapshot,
SENTINEL_MODE.PAPER
);

const auditEvent = shouldLogNonActionAudit(evaluation, safeContext)
? await logKillSwitch({
execution_mode: SENTINEL_MODE.PAPER,
reason_codes: evaluation.reason_codes,
actor_id: safeContext.actor_id || "system",
})
: null;

return {
ok: true,
execution_mode: SENTINEL_MODE.PAPER,
simulated: true,
evaluation: {
...evaluation,
position: refreshedPosition,
},
audit_event: auditEvent,
};
}

case SENTINEL_DECISION.REJECT: {
const refreshedPosition = await refreshPassiveEvaluationPosition(
evaluation,
snapshot,
SENTINEL_MODE.PAPER
);

const auditEvent = shouldLogNonActionAudit(evaluation, safeContext)
? await logTokenReject({
token_id: evaluation.snapshot?.token_id || null,
mint_address: evaluation.snapshot?.mint_address || null,
execution_mode: SENTINEL_MODE.PAPER,
reason_codes: evaluation.reason_codes,
snapshot_summary: evaluation.snapshot || null,
actor_id: safeContext.actor_id || "system",
})
: null;

return {
ok: true,
execution_mode: SENTINEL_MODE.PAPER,
simulated: true,
evaluation: {
...evaluation,
position: refreshedPosition,
},
audit_event: auditEvent,
};
}

case SENTINEL_DECISION.SCOUT_ENTRY: {
const result = await executePaperScoutEntry(evaluation, safeConfig, safeContext);
return {
ok: true,
execution_mode: SENTINEL_MODE.PAPER,
simulated: true,
evaluation,
...result,
};
}

case SENTINEL_DECISION.SNIPER_ADD: {
const result = await executePaperSniperAdd(evaluation, safeConfig, safeContext);
return {
ok: true,
execution_mode: SENTINEL_MODE.PAPER,
simulated: true,
evaluation,
...result,
};
}

case SENTINEL_DECISION.PARTIAL_TAKE_PROFIT: {
const result = await executePaperTakeProfit(evaluation, safeConfig, safeContext);
return {
ok: true,
execution_mode: SENTINEL_MODE.PAPER,
simulated: true,
evaluation,
...result,
};
}

case SENTINEL_DECISION.FULL_EXIT: {
const result = await executePaperExit(evaluation, safeConfig, safeContext);
return {
ok: true,
execution_mode: SENTINEL_MODE.PAPER,
simulated: true,
evaluation,
...result,
};
}

case SENTINEL_DECISION.HOLD:
case SENTINEL_DECISION.WATCHLIST:
default: {
const refreshedPosition = await refreshPassiveEvaluationPosition(
evaluation,
snapshot,
SENTINEL_MODE.PAPER
);

const auditEvent = await maybeLogNonAction(
{
...evaluation,
position: refreshedPosition,
},
safeContext
);

return {
ok: true,
execution_mode: SENTINEL_MODE.PAPER,
simulated: true,
evaluation: {
...evaluation,
position: refreshedPosition,
},
audit_event: auditEvent,
};
}
}
}

export async function runPaperEvaluation(snapshot = {}, config = {}, context = {}) {
return processPaperSnapshot(snapshot, config, context);
}

export async function processPaperSnapshots(
snapshots = [],
config = {},
context = {}
) {
const results = [];

for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
const result = await processPaperSnapshot(snapshot, config, context);
results.push(result);
}

return results;
}

export default {
processPaperSnapshot,
runPaperEvaluation,
processPaperSnapshots,
};
