import {
canOpenNewPositions,
getEffectiveSentinelConfig,
normalizeSentinelConfig,
} from "./config.js";
import { REASON_CODE, ensureReasonCodeArray } from "./reason-codes.js";
import { evaluateHardRejects } from "./hard-rejects.js";
import { evaluateOperatorGate } from "./operator-gate.js";
import { evaluateRegimeGate } from "./regime.js";
import { evaluateScoutEntry } from "./scout.js";
import { evaluateSniperAdd } from "./sniper.js";
import { evaluateEarlyExit } from "./exits.js";
import { evaluateRunnerExit } from "./runner.js";
import { evaluateKillSwitch } from "./kill-switch.js";

export const SENTINEL_DECISION = {
REJECT: "reject",
WATCHLIST: "watchlist",
SCOUT_ENTRY: "scout_entry",
SNIPER_ADD: "sniper_add",
HOLD: "hold",
PARTIAL_TAKE_PROFIT: "partial_take_profit",
FULL_EXIT: "full_exit",
KILL_SWITCH: "kill_switch",
};

const VALID_DECISIONS = new Set(Object.values(SENTINEL_DECISION));

function cleanText(value, max = 255) {
return String(value ?? "").trim().slice(0, max);
}

function toFloat(value, fallback = 0) {
const num = Number.parseFloat(value);
return Number.isFinite(num) ? num : fallback;
}

function toInt(value, fallback = 0) {
const num = Number.parseInt(value, 10);
return Number.isFinite(num) ? num : fallback;
}

function normalizeDecision(value, fallback = SENTINEL_DECISION.WATCHLIST) {
const normalized = cleanText(value, 64).toLowerCase();
return VALID_DECISIONS.has(normalized) ? normalized : fallback;
}

function firstDefined(...values) {
for (const value of values) {
if (value !== undefined && value !== null && value !== "") {
return value;
}
}
return undefined;
}

function resolveExecutionMode(...values) {
for (const value of values) {
const mode = cleanText(value, 64).toLowerCase();
if (mode) return mode;
}
return null;
}

function normalizeSnapshot(snapshot = {}) {
const tokenId = cleanText(
firstDefined(
snapshot.token_id,
snapshot.tokenId,
snapshot.mint,
snapshot.mint_address,
snapshot.mintAddress
),
255
);

const mintAddress = cleanText(
firstDefined(
snapshot.mint_address,
snapshot.mintAddress,
snapshot.mint,
snapshot.token_id,
snapshot.tokenId
),
255
);

return {
...snapshot,
token_id: tokenId || mintAddress || "",
mint_address: mintAddress || tokenId || "",
execution_mode:
resolveExecutionMode(
snapshot.execution_mode,
snapshot.executionMode,
snapshot.mode
) || null,
linked_operator_cluster_id: cleanText(
firstDefined(
snapshot.linked_operator_cluster_id,
snapshot.linkedOperatorClusterId,
snapshot.operator_cluster_id,
snapshot.operatorClusterId,
snapshot.primary_cluster_id,
snapshot.primaryClusterId
),
255
),
current_multiple:
firstDefined(snapshot.current_multiple, snapshot.currentMultiple) == null
? null
: Math.max(
0,
toFloat(
firstDefined(snapshot.current_multiple, snapshot.currentMultiple),
0
)
),
current_value_usd:
firstDefined(snapshot.current_value_usd, snapshot.currentValueUsd) == null
? null
: Math.max(
0,
toFloat(
firstDefined(snapshot.current_value_usd, snapshot.currentValueUsd),
0
)
),
};
}

function normalizePosition(position = {}) {
if (!position || typeof position !== "object") return null;

const tokenId = cleanText(
firstDefined(
position.token_id,
position.tokenId,
position.mint,
position.mint_address,
position.mintAddress
),
255
);

const mintAddress = cleanText(
firstDefined(
position.mint_address,
position.mintAddress,
position.mint,
position.token_id,
position.tokenId
),
255
);

return {
...position,
id: toInt(position.id, 0) || null,
token_id: tokenId || mintAddress || "",
mint_address: mintAddress || tokenId || "",
stage: cleanText(position.stage, 64),
execution_mode:
resolveExecutionMode(
position.execution_mode,
position.executionMode,
position.mode
) || null,
linked_operator_cluster_id: cleanText(
firstDefined(
position.linked_operator_cluster_id,
position.linkedOperatorClusterId,
position.operator_cluster_id,
position.operatorClusterId,
position.primary_cluster_id,
position.primaryClusterId
),
255
),
total_size_usd: Math.max(0, toFloat(position.total_size_usd, 0)),
total_cost_usd: Math.max(0, toFloat(position.total_cost_usd, 0)),
current_value_usd: Math.max(0, toFloat(position.current_value_usd, 0)),
has_banked_10x: Boolean(position.has_banked_10x),
};
}

function normalizeContext(context = {}) {
return {
...context,
execution_mode:
resolveExecutionMode(
context.execution_mode,
context.executionMode,
context.mode
) || null,
position_id: toInt(context.position_id, 0) || null,
};
}

function buildSnapshotWithGateOverrides(snapshot = {}, gateResult = null) {
return normalizeSnapshot({
...(snapshot || {}),
regime_state: gateResult?.snapshot?.regime_state ?? snapshot?.regime_state ?? null,
regime_score: gateResult?.snapshot?.regime_score ?? snapshot?.regime_score ?? null,
execution_mode:
gateResult?.snapshot?.execution_mode ?? snapshot?.execution_mode ?? null,
});
}

function mergeStages(stages = {}) {
return {
kill_switch: stages.kill_switch || null,
hard_rejects: stages.hard_rejects || null,
operator_gate: stages.operator_gate || null,
regime_gate: stages.regime_gate || null,
scout: stages.scout || null,
sniper: stages.sniper || null,
exits: stages.exits || null,
runner: stages.runner || null,
};
}

function buildBaseResult({
decision = SENTINEL_DECISION.WATCHLIST,
reason_codes = [],
size_usd = null,
bank_fraction = null,
snapshot = null,
position = null,
meta = {},
stages = {},
} = {}) {
return {
decision: normalizeDecision(decision),
reason_codes: ensureReasonCodeArray(reason_codes, []),
size_usd: size_usd == null ? null : Math.max(0, toFloat(size_usd, 0)),
bank_fraction:
bank_fraction == null
? null
: Math.min(1, Math.max(0, toFloat(bank_fraction, 0))),
snapshot: snapshot ? normalizeSnapshot(snapshot) : null,
position: position ? normalizePosition(position) : null,
meta: {
...meta,
stages: mergeStages(stages),
},
};
}

function deriveCurrentMultiple(position = {}, snapshot = {}) {
const explicitMultiple = toFloat(
firstDefined(snapshot.current_multiple, snapshot.currentMultiple),
null
);
if (explicitMultiple != null && explicitMultiple > 0) {
return explicitMultiple;
}

const currentValueUsd = Math.max(
0,
toFloat(
firstDefined(snapshot.current_value_usd, snapshot.currentValueUsd),
position.current_value_usd || 0
)
);
const totalCostUsd = Math.max(0.0000001, toFloat(position.total_cost_usd, 0));

return currentValueUsd / totalCostUsd;
}

function shouldAttemptTakeProfit(position = {}, snapshot = {}, config = {}) {
if (!position?.id) return false;
if (position.has_banked_10x) return false;
if (!config?.auto_bank_enabled) return false;

const multiple = deriveCurrentMultiple(position, snapshot);
return multiple >= Math.max(1, toFloat(config.auto_bank_multiple, 10));
}

function getTakeProfitReasonCodes(position = {}, snapshot = {}, config = {}) {
if (!config?.auto_bank_enabled) {
return [REASON_CODE.AUTO_BANK_DISABLED];
}

if (position?.has_banked_10x) {
return [REASON_CODE.ALREADY_BANKED];
}

const multiple = deriveCurrentMultiple(position, snapshot);
if (multiple >= Math.max(1, toFloat(config.auto_bank_multiple, 10))) {
return [REASON_CODE.TEN_X_REACHED];
}

return [REASON_CODE.TEN_X_NOT_REACHED];
}

function hasUsableTokenReference(snapshot = {}, position = null) {
if (cleanText(snapshot?.token_id, 255)) return true;
if (cleanText(snapshot?.mint_address, 255)) return true;
if (cleanText(position?.token_id, 255)) return true;
if (cleanText(position?.mint_address, 255)) return true;
return false;
}

export async function evaluateToken(snapshot = {}, config = {}, context = {}) {
const safeSnapshot = normalizeSnapshot(snapshot || {});
const safeConfig = getEffectiveSentinelConfig(
normalizeSentinelConfig(config || {})
);
const safeContext = normalizeContext(context || {});
const safePosition = normalizePosition(safeContext.position || null);

const executionMode =
safeContext.execution_mode ||
safeSnapshot.execution_mode ||
safePosition?.execution_mode ||
safeConfig.execution_mode ||
"paper";

const stages = {};
const hasPosition = Boolean(safePosition?.id);

if (!hasUsableTokenReference(safeSnapshot, safePosition)) {
return buildBaseResult({
decision: hasPosition ? SENTINEL_DECISION.HOLD : SENTINEL_DECISION.WATCHLIST,
reason_codes: [REASON_CODE.INVALID_TOKEN_SNAPSHOT],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: "invalid_snapshot",
execution_mode: executionMode,
},
stages,
});
}

stages.kill_switch = await evaluateKillSwitch(
safeContext.day_stats || safeContext.dayStats || safeContext,
{
...safeConfig,
execution_mode: executionMode,
}
);

if (stages.kill_switch?.active) {
return buildBaseResult({
decision: SENTINEL_DECISION.KILL_SWITCH,
reason_codes: ensureReasonCodeArray(
stages.kill_switch.reasons || [REASON_CODE.KILL_SWITCH_TRIGGERED]
),
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: "kill_switch",
execution_mode: executionMode,
},
stages,
});
}

if (!hasPosition) {
stages.hard_rejects = evaluateHardRejects(
{
...safeSnapshot,
execution_mode: executionMode,
},
{
...safeConfig,
execution_mode: executionMode,
}
);

if (stages.hard_rejects?.rejected) {
return buildBaseResult({
decision: SENTINEL_DECISION.REJECT,
reason_codes:
stages.hard_rejects.reasons || [REASON_CODE.TOKEN_REJECTED],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: null,
meta: {
halt_reason: "hard_rejects",
execution_mode: executionMode,
},
stages,
});
}

stages.operator_gate = await evaluateOperatorGate(
{
...safeSnapshot,
execution_mode: executionMode,
},
{
...safeConfig,
execution_mode: executionMode,
},
{
...safeContext,
execution_mode: executionMode,
}
);

if (!stages.operator_gate?.passed) {
return buildBaseResult({
decision: SENTINEL_DECISION.REJECT,
reason_codes:
stages.operator_gate.reasons || [REASON_CODE.OPERATOR_QUALITY_TOO_LOW],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: null,
meta: {
halt_reason: "operator_gate",
execution_mode: executionMode,
},
stages,
});
}

if (!canOpenNewPositions({ ...safeConfig, execution_mode: executionMode })) {
return buildBaseResult({
decision: SENTINEL_DECISION.WATCHLIST,
reason_codes: [REASON_CODE.WATCHLIST_ONLY],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: null,
meta: {
halt_reason: "new_entries_disabled",
execution_mode: executionMode,
},
stages,
});
}

stages.regime_gate = await evaluateRegimeGate(
{
...safeSnapshot,
execution_mode: executionMode,
},
{
...safeConfig,
execution_mode: executionMode,
},
{
...safeContext,
execution_mode: executionMode,
action_type: "scout",
}
);

if (!stages.regime_gate?.passed) {
return buildBaseResult({
decision: SENTINEL_DECISION.WATCHLIST,
reason_codes:
stages.regime_gate.reasons || [REASON_CODE.REGIME_SCORE_TOO_LOW],
snapshot: buildSnapshotWithGateOverrides(
{
...safeSnapshot,
execution_mode: executionMode,
},
stages.regime_gate
),
position: null,
meta: {
halt_reason: "regime_gate",
execution_mode: executionMode,
},
stages,
});
}

stages.scout = await evaluateScoutEntry(
{
...safeSnapshot,
execution_mode: executionMode,
},
{
...safeConfig,
execution_mode: executionMode,
},
{
...safeContext,
execution_mode: executionMode,
}
);

if (stages.scout?.allow) {
return buildBaseResult({
decision: SENTINEL_DECISION.SCOUT_ENTRY,
reason_codes:
stages.scout.reasons || [REASON_CODE.SCOUT_ENTRY_APPROVED],
size_usd: stages.scout.size_usd,
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: null,
meta: {
halt_reason: null,
execution_mode: executionMode,
},
stages,
});
}

return buildBaseResult({
decision: SENTINEL_DECISION.WATCHLIST,
reason_codes: stages.scout?.reasons || [REASON_CODE.WATCHLIST_ONLY],
size_usd: stages.scout?.size_usd ?? null,
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: null,
meta: {
halt_reason: "scout",
execution_mode: executionMode,
},
stages,
});
}

stages.hard_rejects = evaluateHardRejects(
{
...safeSnapshot,
execution_mode: executionMode,
},
{
...safeConfig,
execution_mode: executionMode,
}
);

if (stages.hard_rejects?.rejected) {
return buildBaseResult({
decision: SENTINEL_DECISION.FULL_EXIT,
reason_codes:
stages.hard_rejects.reasons || [REASON_CODE.FULL_EXIT_EXECUTED],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: "hard_rejects",
execution_mode: executionMode,
invalidate: false,
exit_type: "closed",
},
stages,
});
}

stages.exits = await evaluateEarlyExit(
{
...safeSnapshot,
execution_mode: executionMode,
},
safePosition,
{
...safeConfig,
execution_mode: executionMode,
},
{
...safeContext,
execution_mode: executionMode,
position_id: safePosition.id,
}
);

if (stages.exits?.exit) {
return buildBaseResult({
decision: SENTINEL_DECISION.FULL_EXIT,
reason_codes:
stages.exits.reasons || [REASON_CODE.FULL_EXIT_EXECUTED],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: "exits",
execution_mode: executionMode,
invalidate: Boolean(stages.exits.invalidate),
exit_type: stages.exits?.meta?.exit_type || null,
},
stages,
});
}

if (shouldAttemptTakeProfit(safePosition, safeSnapshot, safeConfig)) {
return buildBaseResult({
decision: SENTINEL_DECISION.PARTIAL_TAKE_PROFIT,
reason_codes: getTakeProfitReasonCodes(
safePosition,
safeSnapshot,
safeConfig
),
bank_fraction: Math.min(
1,
Math.max(0.01, toFloat(safeConfig.auto_bank_fraction, 0.5))
),
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: null,
execution_mode: executionMode,
},
stages,
});
}

if (safePosition.has_banked_10x) {
if (!safeConfig.enable_runner_management) {
return buildBaseResult({
decision: SENTINEL_DECISION.HOLD,
reason_codes: [REASON_CODE.HOLD_POSITION],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: "runner_disabled",
execution_mode: executionMode,
},
stages,
});
}

stages.runner = await evaluateRunnerExit(
{
...safeSnapshot,
execution_mode: executionMode,
},
safePosition,
{
...safeConfig,
execution_mode: executionMode,
},
{
...safeContext,
execution_mode: executionMode,
position_id: safePosition.id,
}
);

if (stages.runner?.exit) {
return buildBaseResult({
decision: SENTINEL_DECISION.FULL_EXIT,
reason_codes:
stages.runner.reasons || [REASON_CODE.RUNNER_EXIT_EXECUTED],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: "runner",
execution_mode: executionMode,
},
stages,
});
}

return buildBaseResult({
decision: SENTINEL_DECISION.HOLD,
reason_codes: stages.runner?.reasons || [REASON_CODE.RUNNER_HEALTHY],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: null,
execution_mode: executionMode,
},
stages,
});
}

stages.operator_gate = await evaluateOperatorGate(
{
...safeSnapshot,
execution_mode: executionMode,
},
{
...safeConfig,
execution_mode: executionMode,
},
{
...safeContext,
execution_mode: executionMode,
}
);

if (!stages.operator_gate?.passed) {
return buildBaseResult({
decision: SENTINEL_DECISION.HOLD,
reason_codes: stages.operator_gate.reasons || [REASON_CODE.HOLD_POSITION],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: "operator_gate",
execution_mode: executionMode,
},
stages,
});
}

if (!safeConfig.enable_sniper) {
return buildBaseResult({
decision: SENTINEL_DECISION.HOLD,
reason_codes: [REASON_CODE.HOLD_POSITION],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: "sniper_disabled",
execution_mode: executionMode,
},
stages,
});
}

stages.regime_gate = await evaluateRegimeGate(
{
...safeSnapshot,
execution_mode: executionMode,
},
{
...safeConfig,
execution_mode: executionMode,
},
{
...safeContext,
execution_mode: executionMode,
action_type: "sniper",
}
);

if (!stages.regime_gate?.passed) {
return buildBaseResult({
decision: SENTINEL_DECISION.HOLD,
reason_codes:
stages.regime_gate.reasons || [REASON_CODE.REGIME_SCORE_TOO_LOW],
snapshot: buildSnapshotWithGateOverrides(
{
...safeSnapshot,
execution_mode: executionMode,
},
stages.regime_gate
),
position: safePosition,
meta: {
halt_reason: "regime_gate",
execution_mode: executionMode,
},
stages,
});
}

stages.sniper = await evaluateSniperAdd(
{
...safeSnapshot,
execution_mode: executionMode,
},
safePosition,
{
...safeConfig,
execution_mode: executionMode,
},
{
...safeContext,
execution_mode: executionMode,
position_id: safePosition.id,
}
);

if (stages.sniper?.allow) {
return buildBaseResult({
decision: SENTINEL_DECISION.SNIPER_ADD,
reason_codes:
stages.sniper.reasons || [REASON_CODE.SNIPER_ADD_APPROVED],
size_usd: stages.sniper.size_usd,
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: null,
execution_mode: executionMode,
},
stages,
});
}

return buildBaseResult({
decision: SENTINEL_DECISION.HOLD,
reason_codes: stages.sniper?.reasons || [REASON_CODE.HOLD_POSITION],
size_usd: stages.sniper?.size_usd ?? null,
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: "sniper",
execution_mode: executionMode,
},
stages,
});
}

export async function evaluateTokenDecision(
snapshot = {},
config = {},
context = {}
) {
return evaluateToken(snapshot, config, context);
}

export async function shouldRejectToken(
snapshot = {},
config = {},
context = {}
) {
const result = await evaluateToken(snapshot, config, context);
return result.decision === SENTINEL_DECISION.REJECT;
}

export async function shouldOpenScout(
snapshot = {},
config = {},
context = {}
) {
const result = await evaluateToken(snapshot, config, context);
return result.decision === SENTINEL_DECISION.SCOUT_ENTRY;
}

export async function shouldAddSniper(
snapshot = {},
config = {},
context = {}
) {
const result = await evaluateToken(snapshot, config, context);
return result.decision === SENTINEL_DECISION.SNIPER_ADD;
}

export async function shouldTakeProfit(
snapshot = {},
config = {},
context = {}
) {
const result = await evaluateToken(snapshot, config, context);
return result.decision === SENTINEL_DECISION.PARTIAL_TAKE_PROFIT;
}

export async function shouldExitPosition(
snapshot = {},
config = {},
context = {}
) {
const result = await evaluateToken(snapshot, config, context);
return result.decision === SENTINEL_DECISION.FULL_EXIT;
}

export function summarizeEvaluation(result = null) {
if (!result) {
return {
decision: SENTINEL_DECISION.WATCHLIST,
reason_codes: [],
size_usd: null,
bank_fraction: null,
halt_reason: null,
invalidate: false,
exit_type: null,
execution_mode: null,
};
}

return {
decision: normalizeDecision(result.decision, SENTINEL_DECISION.WATCHLIST),
reason_codes: ensureReasonCodeArray(result.reason_codes || []),
size_usd:
result.size_usd == null ? null : Math.max(0, toFloat(result.size_usd, 0)),
bank_fraction:
result.bank_fraction == null
? null
: Math.min(1, Math.max(0, toFloat(result.bank_fraction, 0))),
halt_reason: cleanText(result?.meta?.halt_reason, 64) || null,
invalidate: Boolean(result?.meta?.invalidate),
exit_type: cleanText(result?.meta?.exit_type, 32) || null,
execution_mode: cleanText(result?.meta?.execution_mode, 64) || null,
};
}

export default {
SENTINEL_DECISION,
evaluateToken,
evaluateTokenDecision,
shouldRejectToken,
shouldOpenScout,
shouldAddSniper,
shouldTakeProfit,
shouldExitPosition,
summarizeEvaluation,
};
