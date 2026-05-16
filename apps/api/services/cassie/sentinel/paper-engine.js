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
markPositionRunnerOnly,
upsertTokenCooldown,
ensureDailyStats,
incrementDailyStats,
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
const LEGACY_UNIT_REBASE_EPSILON = 0.001;
const nonActionAuditCache = new Map();

function cleanText(value, max = 255) {
return String(value ?? "").trim().slice(0, max);
}

function toFloat(value, fallback = null) {
if (typeof value === "number") {
return Number.isFinite(value) ? value : fallback;
}

if (value == null) return fallback;

const raw = String(value).trim();
if (!raw) return fallback;

const cleaned = raw.replace(/,/g, "");
const direct = Number.parseFloat(cleaned);
if (Number.isFinite(direct)) return direct;

const match = cleaned.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i);
if (!match) return fallback;

const parsed = Number.parseFloat(match[0]);
return Number.isFinite(parsed) ? parsed : fallback;
}

function toPositiveFloat(value, fallback = null) {
const num = toFloat(value, null);
return num != null && num > 0 ? num : fallback;
}

function toInt(value, fallback = null) {
const num = Number.parseInt(value, 10);
return Number.isFinite(num) ? num : fallback;
}

function firstPositiveNumber(values = [], fallback = null) {
for (const value of values) {
const num = toPositiveFloat(value, null);
if (num != null) return num;
}

return fallback;
}

function firstFiniteNumber(values = [], fallback = null) {
for (const value of values) {
const num = toFloat(value, null);
if (num != null && Number.isFinite(num)) return num;
}

return fallback;
}

function todayUtcDate() {
return new Date().toISOString().slice(0, 10);
}

function buildPaperExecutionRef(action, tokenId = "") {
const safeAction = cleanText(action, 48).toLowerCase() || "paper";
const safeToken =
cleanText(tokenId, 48).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) ||
"token";
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

function getPositionCostUsd(position = {}) {
return Math.max(
0,
firstFiniteNumber(
[
position.total_cost_usd,
position.cost_usd,
position.entry_cost_usd,
position.size_usd,
position.scout_size_usd,
],
0
) || 0
);
}

function getCurrentPrice(snapshot = {}) {
return firstPositiveNumber(
[
snapshot.price_now,
snapshot.priceNow,
snapshot.current_price,
snapshot.currentPrice,
snapshot.current_price_usd,
snapshot.currentPriceUsd,
snapshot.price,
snapshot.price_usd,
snapshot.priceUsd,
snapshot.market_price_usd,
snapshot.marketPriceUsd,
snapshot.token_price_usd,
snapshot.tokenPriceUsd,
snapshot.usd_price,
snapshot.usdPrice,

snapshot.market?.price_now,
snapshot.market?.priceNow,
snapshot.market?.current_price,
snapshot.market?.currentPrice,
snapshot.market?.current_price_usd,
snapshot.market?.currentPriceUsd,
snapshot.market?.price,
snapshot.market?.price_usd,
snapshot.market?.priceUsd,
snapshot.market?.token_price_usd,
snapshot.market?.tokenPriceUsd,
snapshot.market?.usd_price,
snapshot.market?.usdPrice,
snapshot.market?.usd?.price,
snapshot.market?.price?.usd,

snapshot.raw?.price_now,
snapshot.raw?.priceNow,
snapshot.raw?.current_price,
snapshot.raw?.currentPrice,
snapshot.raw?.current_price_usd,
snapshot.raw?.currentPriceUsd,
snapshot.raw?.price,
snapshot.raw?.price_usd,
snapshot.raw?.priceUsd,
snapshot.raw?.market_price_usd,
snapshot.raw?.marketPriceUsd,
snapshot.raw?.token_price_usd,
snapshot.raw?.tokenPriceUsd,
snapshot.raw?.usd_price,
snapshot.raw?.usdPrice,

snapshot.raw?.market?.price_now,
snapshot.raw?.market?.priceNow,
snapshot.raw?.market?.current_price,
snapshot.raw?.market?.currentPrice,
snapshot.raw?.market?.current_price_usd,
snapshot.raw?.market?.currentPriceUsd,
snapshot.raw?.market?.price,
snapshot.raw?.market?.price_usd,
snapshot.raw?.market?.priceUsd,
snapshot.raw?.market?.token_price_usd,
snapshot.raw?.market?.tokenPriceUsd,
snapshot.raw?.market?.usd_price,
snapshot.raw?.market?.usdPrice,
snapshot.raw?.market?.usd?.price,
snapshot.raw?.market?.price?.usd,
],
null
);
}

function getCurrentMultiple(snapshot = {}) {
return firstPositiveNumber(
[
snapshot.current_multiple,
snapshot.currentMultiple,
snapshot.multiple,
snapshot.pnl_multiple,
snapshot.pnlMultiple,
snapshot.performance_multiple,
snapshot.performanceMultiple,

snapshot.market?.current_multiple,
snapshot.market?.currentMultiple,
snapshot.market?.multiple,
snapshot.market?.pnl_multiple,
snapshot.market?.pnlMultiple,
snapshot.market?.performance_multiple,
snapshot.market?.performanceMultiple,

snapshot.raw?.current_multiple,
snapshot.raw?.currentMultiple,
snapshot.raw?.multiple,
snapshot.raw?.pnl_multiple,
snapshot.raw?.pnlMultiple,
snapshot.raw?.performance_multiple,
snapshot.raw?.performanceMultiple,

snapshot.raw?.market?.current_multiple,
snapshot.raw?.market?.currentMultiple,
snapshot.raw?.market?.multiple,
snapshot.raw?.market?.pnl_multiple,
snapshot.raw?.market?.pnlMultiple,
snapshot.raw?.market?.performance_multiple,
snapshot.raw?.market?.performanceMultiple,
],
null
);
}

function getExplicitCurrentValueUsd(snapshot = {}) {
return firstFiniteNumber(
[
snapshot.position_value_usd,
snapshot.positionValueUsd,
snapshot.current_value_usd,
snapshot.currentValueUsd,
snapshot.market_value_usd,
snapshot.marketValueUsd,

snapshot.market?.position_value_usd,
snapshot.market?.positionValueUsd,
snapshot.market?.current_value_usd,
snapshot.market?.currentValueUsd,
snapshot.market?.market_value_usd,
snapshot.market?.marketValueUsd,

snapshot.raw?.position_value_usd,
snapshot.raw?.positionValueUsd,
snapshot.raw?.current_value_usd,
snapshot.raw?.currentValueUsd,
snapshot.raw?.market_value_usd,
snapshot.raw?.marketValueUsd,

snapshot.raw?.market?.position_value_usd,
snapshot.raw?.market?.positionValueUsd,
snapshot.raw?.market?.current_value_usd,
snapshot.raw?.market?.currentValueUsd,
snapshot.raw?.market?.market_value_usd,
snapshot.raw?.market?.marketValueUsd,
],
null
);
}

function shouldRebaseLegacyPaperUnits(position = {}, snapshot = {}) {
const priceNow = getCurrentPrice(snapshot);
const totalCostUsd = getPositionCostUsd(position);
const units = toFloat(position.units, null);
const currentValueUsd = toFloat(position.current_value_usd, null);

if (!position?.id || priceNow == null || priceNow <= 0 || totalCostUsd <= 0) {
return false;
}

if (units == null || units <= 0) return true;

const tolerance = Math.max(0.000001, totalCostUsd * LEGACY_UNIT_REBASE_EPSILON);
const unitsLookLikeUsdCost = Math.abs(units - totalCostUsd) <= tolerance;
const currentLooksLikeCost =
currentValueUsd == null || Math.abs(currentValueUsd - totalCostUsd) <= tolerance;

return unitsLookLikeUsdCost && currentLooksLikeCost;
}

async function maybeRebaseLegacyPaperPosition(position, snapshot = {}) {
if (!shouldRebaseLegacyPaperUnits(position, snapshot)) return position;

const priceNow = getCurrentPrice(snapshot);
const totalCostUsd = getPositionCostUsd(position);
const nextUnits = priceNow > 0 ? totalCostUsd / priceNow : toFloat(position.units, 0);

if (!Number.isFinite(nextUnits) || nextUnits <= 0) {
return position;
}

return refreshPositionMarketValue(position.id, {
current_value_usd: totalCostUsd,
units: nextUnits,
avg_exit_price: priceNow,
});
}

function derivePositionCurrentValue(snapshot = {}, position = null, fallback = null) {
const priceNow = getCurrentPrice(snapshot);
const units = toFloat(position?.units, null);

if (priceNow != null && priceNow > 0 && units != null && units > 0) {
return Math.max(0, priceNow * units);
}

const multiple = getCurrentMultiple(snapshot);
const totalCostUsd = getPositionCostUsd(position || {});

if (multiple != null && totalCostUsd > 0) {
return Math.max(0, multiple * totalCostUsd);
}

const explicitValue = getExplicitCurrentValueUsd(snapshot);
if (explicitValue != null) return Math.max(0, explicitValue);

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

async function ensurePaperDailyStatsRow() {
const statDate = todayUtcDate();
await ensureDailyStats(SENTINEL_MODE.PAPER, statDate);
return statDate;
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

let workingPosition = await maybeRebaseLegacyPaperPosition(position, snapshot);

const currentValueUsd = derivePositionCurrentValue(
snapshot,
workingPosition,
workingPosition.current_value_usd
);
const priceNow = getCurrentPrice(snapshot);

if (currentValueUsd == null) {
return workingPosition;
}

return refreshPositionMarketValue(workingPosition.id, {
current_value_usd: currentValueUsd,
units: workingPosition.units,
avg_exit_price: priceNow ?? workingPosition.avg_exit_price ?? null,
});
}

async function maybePromotePaperRunnerOnly(position, snapshot = {}) {
if (!position?.id) return position;
if (!position?.has_banked_10x) return position;
if (position?.stage !== "half_banked_at_10x") return position;

const currentValueUsd =
derivePositionCurrentValue(snapshot, position, position.current_value_usd) ??
position.current_value_usd;

return markPositionRunnerOnly(position.id, {
current_value_usd: currentValueUsd,
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
await ensurePaperDailyStatsRow();

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

const refreshedOpenPosition = openPosition?.id
? await maybeRefreshPaperPositionValue(openPosition, snapshot)
: null;

const dayStats =
context?.day_stats && typeof context.day_stats === "object"
? context.day_stats
: await getDailyStats(SENTINEL_MODE.PAPER);

return {
...context,
execution_mode: SENTINEL_MODE.PAPER,
log_non_actions: context.log_non_actions !== false,
position: refreshedOpenPosition || null,
position_id: refreshedOpenPosition?.id || null,
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

await syncDailyUnrealizedForMode(execution_mode);

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
const refreshedValue =
derivePositionCurrentValue(snapshot, refreshed, refreshed.current_value_usd) ?? 0;

const updatedPosition = await addSniperToPosition(refreshed.id, {
add_size_usd: sizeUsd,
add_units: addUnits,
add_avg_entry_price: priceNow,
current_value_usd: refreshedValue + sizeUsd,
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
meta: {
realized_increment_usd: realizedIncrement,
},
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

function buildSnapshotProcessingErrorResult(snapshot = {}, error = null) {
const message = cleanText(
error?.message || String(error || "Snapshot processing failed"),
2000
);

return {
ok: false,
execution_mode: SENTINEL_MODE.PAPER,
simulated: true,
skipped: true,
error: {
message,
},
evaluation: {
decision: SENTINEL_DECISION.HOLD,
reason_codes: [],
snapshot,
position: null,
meta: {
processing_error: message,
},
},
audit_event: null,
};
}

export async function processPaperSnapshot(snapshot = {}, config = {}, context = {}) {
await ensurePaperDailyStatsRow();

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
let refreshedPosition = await refreshPassiveEvaluationPosition(
evaluation,
snapshot,
SENTINEL_MODE.PAPER
);

if (
evaluation.decision === SENTINEL_DECISION.HOLD &&
refreshedPosition?.has_banked_10x &&
refreshedPosition?.stage === "half_banked_at_10x"
) {
refreshedPosition = await maybePromotePaperRunnerOnly(
refreshedPosition,
snapshot
);
}

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
await ensurePaperDailyStatsRow();

const results = [];

for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
try {
const result = await processPaperSnapshot(snapshot, config, context);
results.push(result);
} catch (error) {
console.error("Sentinel paper snapshot processing failed", {
token_id: snapshot?.token_id || null,
mint_address: snapshot?.mint_address || null,
error: error?.message || String(error),
});

results.push(buildSnapshotProcessingErrorResult(snapshot, error));
}
}

return results;
}

export default {
processPaperSnapshot,
runPaperEvaluation,
processPaperSnapshots,
};
