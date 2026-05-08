import { getEffectiveSentinelConfig, normalizeSentinelConfig } from "./config.js";
import { REASON_CODE, ensureReasonCodeArray } from "./reason-codes.js";
import { getPositionById, getOpenPositionByToken, isOpenStage } from "./position-store.js";

const RUNNER_REASON_SET = new Set([
REASON_CODE.RUNNER_MANAGEMENT_DISABLED,
REASON_CODE.NO_RUNNER_POSITION,
REASON_CODE.RUNNER_HEALTHY,
REASON_CODE.BUY_PRESSURE_DECAY,
REASON_CODE.PERSISTENCE_DECAY,
REASON_CODE.STRUCTURAL_HEALTH_WEAK,
REASON_CODE.FAILED_BREAKOUTS_TOO_MANY,
REASON_CODE.RUNNER_INSIDER_SELL_RISK,
REASON_CODE.RUNNER_LIQUIDITY_DECAY,
REASON_CODE.RUNNER_EXIT_EXECUTED,
]);

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

function clamp(value, min = 0, max = 100) {
return Math.min(max, Math.max(min, toFloat(value, min)));
}

function normalizeSnapshot(snapshot = {}) {
return {
token_id: cleanText(snapshot.token_id, 255),
mint_address: cleanText(snapshot.mint_address, 255),

buy_pressure_score: clamp(snapshot.buy_pressure_score, 0, 100),
persistence_score: clamp(snapshot.persistence_score, 0, 100),
structural_health_score: clamp(snapshot.structural_health_score, 0, 100),
failed_breakout_count: Math.max(0, toInt(snapshot.failed_breakout_count, 0)),
insider_sell_score: clamp(snapshot.insider_sell_score, 0, 100),
liquidity_decay_score: clamp(snapshot.liquidity_decay_score, 0, 100),
};
}

function normalizePosition(position = {}) {
return {
id: toInt(position.id, 0) || null,
token_id: cleanText(position.token_id, 255),
mint_address: cleanText(position.mint_address, 255),
stage: cleanText(position.stage, 64),
execution_mode: cleanText(position.execution_mode, 64) || null,
has_banked_10x: Boolean(position.has_banked_10x),
current_value_usd: Math.max(0, toFloat(position.current_value_usd, 0)),
runner_started_at: cleanText(position.runner_started_at, 64) || null,
};
}

function buildCheck(code, actual, threshold, comparator, rejected) {
return {
code,
actual,
threshold,
comparator,
rejected: Boolean(rejected),
};
}

function collectRejectedReasons(checks = []) {
return checks.filter((check) => check.rejected).map((check) => check.code);
}

function isRunnerPosition(position) {
if (!position?.id) return false;
if (!isOpenStage(position.stage)) return false;
if (!position.has_banked_10x) return false;

return (
position.stage === "half_banked_at_10x" ||
position.stage === "runner_only"
);
}

export function getRunnerReasonCodes() {
return Array.from(RUNNER_REASON_SET);
}

export function isRunnerReason(code) {
return RUNNER_REASON_SET.has(cleanText(code, 128));
}

export function filterRunnerReasons(reasonCodes = []) {
return ensureReasonCodeArray(reasonCodes).filter((code) => isRunnerReason(code));
}

export function getRunnerThresholds(config = {}) {
const safe = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
return {
min_buy_pressure_score_for_runner: 45,
min_persistence_score_for_runner: 45,
min_structural_health_score_for_runner: safe.min_post_entry_health_score,
runner_failed_breakout_limit: safe.runner_failed_breakout_limit,
runner_insider_sell_score_threshold: 65,
runner_liquidity_decay_score_threshold: 65,
};
}

export function evaluateRunnerExitSync(
snapshot = {},
position = null,
config = {},
context = {}
) {
const safeConfig = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
const safeSnapshot = normalizeSnapshot(snapshot || {});
const safePosition = normalizePosition(position || {});
const thresholds = getRunnerThresholds(safeConfig);

if (!safeConfig.enable_runner_management) {
return {
exit: false,
decision: "hold",
reasons: [REASON_CODE.RUNNER_MANAGEMENT_DISABLED],
snapshot: safeSnapshot,
position: safePosition,
checks: [],
thresholds,
meta: {
runner_management_enabled: false,
valid_runner_position: isRunnerPosition(safePosition),
total_check_count: 0,
rejected_check_count: 0,
},
};
}

if (!isRunnerPosition(safePosition)) {
return {
exit: false,
decision: "hold",
reasons: [REASON_CODE.NO_RUNNER_POSITION],
snapshot: safeSnapshot,
position: safePosition,
checks: [],
thresholds,
meta: {
runner_management_enabled: true,
valid_runner_position: false,
total_check_count: 0,
rejected_check_count: 0,
},
};
}

const checks = [
buildCheck(
REASON_CODE.BUY_PRESSURE_DECAY,
safeSnapshot.buy_pressure_score,
thresholds.min_buy_pressure_score_for_runner,
"<",
safeSnapshot.buy_pressure_score < thresholds.min_buy_pressure_score_for_runner
),
buildCheck(
REASON_CODE.PERSISTENCE_DECAY,
safeSnapshot.persistence_score,
thresholds.min_persistence_score_for_runner,
"<",
safeSnapshot.persistence_score < thresholds.min_persistence_score_for_runner
),
buildCheck(
REASON_CODE.STRUCTURAL_HEALTH_WEAK,
safeSnapshot.structural_health_score,
thresholds.min_structural_health_score_for_runner,
"<",
safeSnapshot.structural_health_score < thresholds.min_structural_health_score_for_runner
),
buildCheck(
REASON_CODE.FAILED_BREAKOUTS_TOO_MANY,
safeSnapshot.failed_breakout_count,
thresholds.runner_failed_breakout_limit,
">=",
safeSnapshot.failed_breakout_count >= thresholds.runner_failed_breakout_limit
),
buildCheck(
REASON_CODE.RUNNER_INSIDER_SELL_RISK,
safeSnapshot.insider_sell_score,
thresholds.runner_insider_sell_score_threshold,
">=",
safeSnapshot.insider_sell_score >= thresholds.runner_insider_sell_score_threshold
),
buildCheck(
REASON_CODE.RUNNER_LIQUIDITY_DECAY,
safeSnapshot.liquidity_decay_score,
thresholds.runner_liquidity_decay_score_threshold,
">=",
safeSnapshot.liquidity_decay_score >= thresholds.runner_liquidity_decay_score_threshold
),
];

const reasons = collectRejectedReasons(checks);

return {
exit: reasons.length > 0,
decision: reasons.length > 0 ? "full_exit" : "hold",
reasons: reasons.length ? reasons : [REASON_CODE.RUNNER_HEALTHY],
snapshot: safeSnapshot,
position: safePosition,
checks,
thresholds,
meta: {
runner_management_enabled: true,
valid_runner_position: true,
total_check_count: checks.length,
rejected_check_count: reasons.length,
},
};
}

export async function evaluateRunnerExit(
snapshot = {},
position = null,
config = {},
context = {}
) {
const safeConfig = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
const safeSnapshot = normalizeSnapshot(snapshot || {});

let resolvedPosition = position ? normalizePosition(position) : null;

if (!resolvedPosition?.id) {
if (context?.position_id) {
resolvedPosition = normalizePosition(await getPositionById(context.position_id));
} else if (safeSnapshot.token_id) {
const executionMode =
cleanText(context?.execution_mode, 64) ||
cleanText(position?.execution_mode, 64) ||
cleanText(safeConfig.execution_mode, 64) ||
"paper";

resolvedPosition = normalizePosition(
await getOpenPositionByToken(safeSnapshot.token_id, executionMode)
);
}
}

return evaluateRunnerExitSync(safeSnapshot, resolvedPosition, safeConfig, context);
}

export async function shouldExitRunner(
snapshot = {},
position = null,
config = {},
context = {}
) {
const result = await evaluateRunnerExit(snapshot, position, config, context);
return Boolean(result.exit);
}

export function summarizeRunnerExit(result = null) {
if (!result) {
return {
exit: false,
decision: "hold",
reasons: [],
rejected_check_count: 0,
total_check_count: 0,
valid_runner_position: false,
};
}

return {
exit: Boolean(result.exit),
decision: cleanText(result.decision, 64) || "hold",
reasons: ensureReasonCodeArray(result.reasons || []),
rejected_check_count: toInt(result?.meta?.rejected_check_count, 0),
total_check_count: toInt(result?.meta?.total_check_count, 0),
valid_runner_position: Boolean(result?.meta?.valid_runner_position),
};
}

export default {
getRunnerReasonCodes,
isRunnerReason,
filterRunnerReasons,
getRunnerThresholds,
evaluateRunnerExitSync,
evaluateRunnerExit,
shouldExitRunner,
summarizeRunnerExit,
};
