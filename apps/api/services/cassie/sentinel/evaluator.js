import {
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

function normalizeSnapshot(snapshot = {}) {
return {
token_id: cleanText(snapshot.token_id, 255),
mint_address: cleanText(snapshot.mint_address, 255),
execution_mode: cleanText(snapshot.execution_mode, 64) || null,
...snapshot,
};
}

function normalizePosition(position = {}) {
if (!position || typeof position !== "object") return null;

return {
...position,
id: toInt(position.id, 0) || null,
token_id: cleanText(position.token_id, 255),
mint_address: cleanText(position.mint_address, 255),
stage: cleanText(position.stage, 64),
execution_mode: cleanText(position.execution_mode, 64) || null,
total_size_usd: Math.max(0, toFloat(position.total_size_usd, 0)),
total_cost_usd: Math.max(0, toFloat(position.total_cost_usd, 0)),
current_value_usd: Math.max(0, toFloat(position.current_value_usd, 0)),
has_banked_10x: Boolean(position.has_banked_10x),
};
}

function normalizeContext(context = {}) {
return {
...context,
execution_mode: cleanText(context.execution_mode, 64) || null,
position_id: toInt(context.position_id, 0) || null,
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
bank_fraction == null ? null : Math.min(1, Math.max(0, toFloat(bank_fraction, 0))),
snapshot,
position,
meta: {
...meta,
stages,
},
};
}

function decisionFromGateFailure(
gateName,
result,
fallbackDecision = SENTINEL_DECISION.REJECT
) {
return buildBaseResult({
decision: fallbackDecision,
reason_codes: ensureReasonCodeArray(result?.reasons || []),
snapshot: result?.snapshot || null,
meta: {
halt_reason: gateName,
passed: false,
stage_result: result || null,
},
});
}

function shouldAttemptTakeProfit(position = {}, snapshot = {}, config = {}) {
if (!position?.id) return false;
if (position.has_banked_10x) return false;
if (!config?.auto_bank_enabled) return false;

const currentValueUsd = Math.max(
0,
toFloat(snapshot.current_value_usd, position.current_value_usd || 0)
);
const totalCostUsd = Math.max(0.0000001, toFloat(position.total_cost_usd, 0));

const multiple = currentValueUsd / totalCostUsd;
return multiple >= Math.max(1, toFloat(config.auto_bank_multiple, 10));
}

function getTakeProfitReasonCodes(position = {}, snapshot = {}, config = {}) {
if (!config?.auto_bank_enabled) {
return [REASON_CODE.AUTO_BANK_DISABLED];
}

if (position?.has_banked_10x) {
return [REASON_CODE.ALREADY_BANKED];
}

const currentValueUsd = Math.max(
0,
toFloat(snapshot.current_value_usd, position.current_value_usd || 0)
);
const totalCostUsd = Math.max(0.0000001, toFloat(position.total_cost_usd, 0));
const multiple = currentValueUsd / totalCostUsd;

if (multiple >= Math.max(1, toFloat(config.auto_bank_multiple, 10))) {
return [REASON_CODE.TEN_X_REACHED];
}

return [REASON_CODE.TEN_X_NOT_REACHED];
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

export async function evaluateToken(
snapshot = {},
config = {},
context = {}
) {
const safeSnapshot = normalizeSnapshot(snapshot || {});
const safeConfig = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
const safeContext = normalizeContext(context || {});
const safePosition = normalizePosition(safeContext.position || null);

const executionMode =
safeContext.execution_mode ||
safeSnapshot.execution_mode ||
safePosition?.execution_mode ||
safeConfig.execution_mode ||
"paper";

const stages = {};

stages.kill_switch = await evaluateKillSwitch(
safeContext.day_stats || null,
{
...safeConfig,
execution_mode: executionMode,
}
);

if (stages.kill_switch?.active) {
return buildBaseResult({
decision: SENTINEL_DECISION.KILL_SWITCH,
reason_codes: ensureReasonCodeArray(stages.kill_switch.reasons || [
REASON_CODE.KILL_SWITCH_TRIGGERED,
]),
snapshot: safeSnapshot,
position: safePosition,
meta: {
halt_reason: "kill_switch",
},
stages: mergeStages(stages),
});
}

stages.hard_rejects = evaluateHardRejects(safeSnapshot, safeConfig);
if (stages.hard_rejects?.rejected) {
return buildBaseResult({
decision: SENTINEL_DECISION.REJECT,
reason_codes: stages.hard_rejects.reasons || [REASON_CODE.TOKEN_REJECTED],
snapshot: safeSnapshot,
position: safePosition,
meta: {
halt_reason: "hard_rejects",
},
stages: mergeStages(stages),
});
}

stages.operator_gate = await evaluateOperatorGate(
safeSnapshot,
safeConfig,
{
...safeContext,
execution_mode: executionMode,
}
);
if (!stages.operator_gate?.passed) {
return buildBaseResult({
decision: SENTINEL_DECISION.REJECT,
reason_codes: stages.operator_gate.reasons || [REASON_CODE.OPERATOR_QUALITY_TOO_LOW],
snapshot: safeSnapshot,
position: safePosition,
meta: {
halt_reason: "operator_gate",
},
stages: mergeStages(stages),
});
}

const hasPosition = Boolean(safePosition?.id);

if (!hasPosition) {
stages.regime_gate = await evaluateRegimeGate(
safeSnapshot,
safeConfig,
{
...safeContext,
execution_mode: executionMode,
action_type: "scout",
}
);

if (!stages.regime_gate?.passed) {
return buildBaseResult({
decision: SENTINEL_DECISION.WATCHLIST,
reason_codes: stages.regime_gate.reasons || [REASON_CODE.REGIME_SCORE_TOO_LOW],
snapshot: {
...safeSnapshot,
regime_state:
stages.regime_gate?.snapshot?.regime_state || safeSnapshot.regime_state,
regime_score:
stages.regime_gate?.snapshot?.regime_score ?? safeSnapshot.regime_score,
},
position: null,
meta: {
halt_reason: "regime_gate",
},
stages: mergeStages(stages),
});
}

stages.scout = await evaluateScoutEntry(
safeSnapshot,
safeConfig,
{
...safeContext,
execution_mode: executionMode,
}
);

if (stages.scout?.allow) {
return buildBaseResult({
decision: SENTINEL_DECISION.SCOUT_ENTRY,
reason_codes: stages.scout.reasons || [REASON_CODE.SCOUT_ENTRY_APPROVED],
size_usd: stages.scout.size_usd,
snapshot: safeSnapshot,
position: null,
meta: {
halt_reason: null,
},
stages: mergeStages(stages),
});
}

return buildBaseResult({
decision: SENTINEL_DECISION.WATCHLIST,
reason_codes: stages.scout?.reasons || [REASON_CODE.WATCHLIST_ONLY],
size_usd: stages.scout?.size_usd ?? null,
snapshot: safeSnapshot,
position: null,
meta: {
halt_reason: "scout",
},
stages: mergeStages(stages),
});
}

stages.exits = await evaluateEarlyExit(
safeSnapshot,
safePosition,
safeConfig,
{
...safeContext,
execution_mode: executionMode,
position_id: safePosition.id,
}
);

if (stages.exits?.exit) {
return buildBaseResult({
decision: SENTINEL_DECISION.FULL_EXIT,
reason_codes: stages.exits.reasons || [REASON_CODE.FULL_EXIT_EXECUTED],
snapshot: safeSnapshot,
position: safePosition,
meta: {
halt_reason: "exits",
invalidate: Boolean(stages.exits.invalidate),
exit_type: stages.exits?.meta?.exit_type || null,
},
stages: mergeStages(stages),
});
}

if (safePosition.has_banked_10x) {
stages.runner = await evaluateRunnerExit(
safeSnapshot,
safePosition,
safeConfig,
{
...safeContext,
execution_mode: executionMode,
position_id: safePosition.id,
}
);

if (stages.runner?.exit) {
return buildBaseResult({
decision: SENTINEL_DECISION.FULL_EXIT,
reason_codes: stages.runner.reasons || [REASON_CODE.RUNNER_EXIT_EXECUTED],
snapshot: safeSnapshot,
position: safePosition,
meta: {
halt_reason: "runner",
},
stages: mergeStages(stages),
});
}

return buildBaseResult({
decision: SENTINEL_DECISION.HOLD,
reason_codes: stages.runner?.reasons || [REASON_CODE.RUNNER_HEALTHY],
snapshot: safeSnapshot,
position: safePosition,
meta: {
halt_reason: null,
},
stages: mergeStages(stages),
});
}

if (shouldAttemptTakeProfit(safePosition, safeSnapshot, safeConfig)) {
return buildBaseResult({
decision: SENTINEL_DECISION.PARTIAL_TAKE_PROFIT,
reason_codes: getTakeProfitReasonCodes(safePosition, safeSnapshot, safeConfig),
bank_fraction: Math.min(1, Math.max(0.01, toFloat(safeConfig.auto_bank_fraction, 0.5))),
snapshot: safeSnapshot,
position: safePosition,
meta: {
halt_reason: null,
},
stages: mergeStages(stages),
});
}

stages.regime_gate = await evaluateRegimeGate(
safeSnapshot,
safeConfig,
{
...safeContext,
execution_mode: executionMode,
action_type: "sniper",
}
);

if (!stages.regime_gate?.passed) {
return buildBaseResult({
decision: SENTINEL_DECISION.HOLD,
reason_codes: stages.regime_gate.reasons || [REASON_CODE.REGIME_SCORE_TOO_LOW],
snapshot: {
...safeSnapshot,
regime_state:
stages.regime_gate?.snapshot?.regime_state || safeSnapshot.regime_state,
regime_score:
stages.regime_gate?.snapshot?.regime_score ?? safeSnapshot.regime_score,
},
position: safePosition,
meta: {
halt_reason: "regime_gate",
},
stages: mergeStages(stages),
});
}

stages.sniper = await evaluateSniperAdd(
safeSnapshot,
safePosition,
safeConfig,
{
...safeContext,
execution_mode: executionMode,
position_id: safePosition.id,
}
);

if (stages.sniper?.allow) {
return buildBaseResult({
decision: SENTINEL_DECISION.SNIPER_ADD,
reason_codes: stages.sniper.reasons || [REASON_CODE.SNIPER_ADD_APPROVED],
size_usd: stages.sniper.size_usd,
snapshot: safeSnapshot,
position: safePosition,
meta: {
halt_reason: null,
},
stages: mergeStages(stages),
});
}

return buildBaseResult({
decision: SENTINEL_DECISION.HOLD,
reason_codes: stages.sniper?.reasons || [REASON_CODE.HOLD_POSITION],
size_usd: stages.sniper?.size_usd ?? null,
snapshot: safeSnapshot,
position: safePosition,
meta: {
halt_reason: "sniper",
},
stages: mergeStages(stages),
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
