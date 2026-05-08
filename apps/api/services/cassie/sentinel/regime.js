import { getEffectiveSentinelConfig, normalizeSentinelConfig } from "./config.js";
import { REASON_CODE, ensureReasonCodeArray } from "./reason-codes.js";

export const MARKET_REGIME = {
RISK_OFF: "risk_off",
CAUTIOUS: "cautious",
NEUTRAL: "neutral",
FAVORABLE: "favorable",
HIGH_OPPORTUNITY: "high_opportunity",
};

const VALID_REGIME_STATES = new Set(Object.values(MARKET_REGIME));
const VALID_ACTION_TYPES = new Set(["scout", "sniper"]);

const REGIME_REASON_SET = new Set([
REASON_CODE.EMERGENCY_STOP_ACTIVE,
REASON_CODE.RISK_OFF_REGIME,
REASON_CODE.REGIME_SCORE_TOO_LOW,
REASON_CODE.MARKET_QUALITY_TOO_LOW,
]);

function cleanText(value, max = 255) {
return String(value ?? "").trim().slice(0, max);
}

function toFloat(value, fallback = 0) {
const num = Number.parseFloat(value);
return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min = 0, max = 100) {
return Math.min(max, Math.max(min, toFloat(value, min)));
}

function normalizeRegimeState(value) {
const normalized = cleanText(value, 64).toLowerCase();
return VALID_REGIME_STATES.has(normalized) ? normalized : null;
}

function normalizeActionType(value, fallback = "scout") {
const normalized = cleanText(value, 32).toLowerCase();
return VALID_ACTION_TYPES.has(normalized) ? normalized : fallback;
}

function normalizeSnapshot(snapshot = {}) {
return {
token_id: cleanText(snapshot.token_id, 255),
mint_address: cleanText(snapshot.mint_address, 255),

regime_state: normalizeRegimeState(snapshot.regime_state),
regime_score:
snapshot.regime_score == null ? null : clamp(snapshot.regime_score, 0, 100),

recent_rug_rate_pct:
snapshot.recent_rug_rate_pct == null
? null
: clamp(snapshot.recent_rug_rate_pct, 0, 100),

reclaim_success_rate_pct:
snapshot.reclaim_success_rate_pct == null
? null
: clamp(snapshot.reclaim_success_rate_pct, 0, 100),

avg_market_liquidity_usd:
snapshot.avg_market_liquidity_usd == null
? null
: Math.max(0, toFloat(snapshot.avg_market_liquidity_usd, 0)),

recent_runner_count:
snapshot.recent_runner_count == null
? null
: Math.max(0, toFloat(snapshot.recent_runner_count, 0)),

breakout_follow_through_score:
snapshot.breakout_follow_through_score == null
? null
: clamp(snapshot.breakout_follow_through_score, 0, 100),

live_launch_count:
snapshot.live_launch_count == null
? null
: Math.max(0, toFloat(snapshot.live_launch_count, 0)),
};
}

function getLiquidityScore(avgMarketLiquidityUsd, config) {
if (avgMarketLiquidityUsd == null) return 50;
const baseline = Math.max(1, toFloat(config.min_liquidity_usd, 800));
const ratio = avgMarketLiquidityUsd / baseline;

if (ratio >= 2) return 100;
if (ratio >= 1.5) return 85;
if (ratio >= 1.0) return 70;
if (ratio >= 0.75) return 55;
if (ratio >= 0.5) return 35;
return 15;
}

function getRunnerScore(recentRunnerCount) {
if (recentRunnerCount == null) return 50;
if (recentRunnerCount >= 10) return 100;
return clamp(recentRunnerCount * 10, 0, 100);
}

function deriveRegimeScore(snapshot = {}, config = {}) {
if (snapshot.regime_score != null) {
return {
score: clamp(snapshot.regime_score, 0, 100),
used_provided_score: true,
components: {
provided_regime_score: clamp(snapshot.regime_score, 0, 100),
},
};
}

const reclaimScore =
snapshot.reclaim_success_rate_pct == null
? 50
: clamp(snapshot.reclaim_success_rate_pct, 0, 100);

const inverseRugScore =
snapshot.recent_rug_rate_pct == null
? 50
: clamp(100 - snapshot.recent_rug_rate_pct, 0, 100);

const liquidityScore = getLiquidityScore(snapshot.avg_market_liquidity_usd, config);
const runnerScore = getRunnerScore(snapshot.recent_runner_count);
const followThroughScore =
snapshot.breakout_follow_through_score == null
? 50
: clamp(snapshot.breakout_follow_through_score, 0, 100);

const weightedScore =
reclaimScore * 0.4 +
inverseRugScore * 0.25 +
liquidityScore * 0.2 +
runnerScore * 0.1 +
followThroughScore * 0.05;

return {
score: clamp(weightedScore, 0, 100),
used_provided_score: false,
components: {
reclaim_success_score: reclaimScore,
inverse_rug_score: inverseRugScore,
liquidity_score: liquidityScore,
runner_score: runnerScore,
breakout_follow_through_score: followThroughScore,
},
};
}

export function deriveRegimeState(regimeScore) {
const score = clamp(regimeScore, 0, 100);

if (score < 35) return MARKET_REGIME.RISK_OFF;
if (score < 55) return MARKET_REGIME.CAUTIOUS;
if (score < 70) return MARKET_REGIME.NEUTRAL;
if (score < 85) return MARKET_REGIME.FAVORABLE;
return MARKET_REGIME.HIGH_OPPORTUNITY;
}

export function getRegimeThresholds(config = {}) {
const safe = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
return {
min_regime_score_for_scout: safe.min_regime_score_for_scout,
min_regime_score_for_sniper: safe.min_regime_score_for_sniper,
risk_off_disable_new_entries: Boolean(safe.risk_off_disable_new_entries),
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

export function getRegimeReasonCodes() {
return Array.from(REGIME_REASON_SET);
}

export function isRegimeReason(code) {
return REGIME_REASON_SET.has(cleanText(code, 128));
}

export function filterRegimeReasons(reasonCodes = []) {
return ensureReasonCodeArray(reasonCodes).filter((code) => isRegimeReason(code));
}

export function evaluateRegimeGateSync(
snapshot = {},
config = {},
{ action_type = "scout" } = {}
) {
const safeConfig = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
const safeSnapshot = normalizeSnapshot(snapshot || {});
const actionType = normalizeActionType(action_type, "scout");

const derived = deriveRegimeScore(safeSnapshot, safeConfig);
const derivedState = safeSnapshot.regime_state || deriveRegimeState(derived.score);
const requiredScore =
actionType === "sniper"
? safeConfig.min_regime_score_for_sniper
: safeConfig.min_regime_score_for_scout;

if (!safeConfig.enable_market_regime_filter) {
return {
passed: true,
reasons: [],
action_type: actionType,
snapshot: {
...safeSnapshot,
regime_state: derivedState,
regime_score: derived.score,
},
checks: [],
thresholds: getRegimeThresholds(safeConfig),
meta: {
regime_filter_enabled: false,
derived_state: derivedState,
derived_score: derived.score,
used_provided_score: derived.used_provided_score,
score_components: derived.components,
},
};
}

const checks = [];

if (safeConfig.execution_mode === "emergency_stop") {
checks.push(
buildCheck(
REASON_CODE.EMERGENCY_STOP_ACTIVE,
safeConfig.execution_mode,
"not_emergency_stop",
"===",
true
)
);
}

if (
derivedState === MARKET_REGIME.RISK_OFF &&
safeConfig.risk_off_disable_new_entries
) {
checks.push(
buildCheck(
REASON_CODE.RISK_OFF_REGIME,
derivedState,
MARKET_REGIME.RISK_OFF,
"===",
true
)
);
}

checks.push(
buildCheck(
REASON_CODE.REGIME_SCORE_TOO_LOW,
derived.score,
requiredScore,
"<",
derived.score < requiredScore
)
);

const marketQualityTooLow =
derived.score < requiredScore &&
(
derivedState === MARKET_REGIME.RISK_OFF ||
derivedState === MARKET_REGIME.CAUTIOUS
);

checks.push(
buildCheck(
REASON_CODE.MARKET_QUALITY_TOO_LOW,
derivedState,
`${MARKET_REGIME.NEUTRAL}+`,
"state",
marketQualityTooLow
)
);

const reasons = collectRejectedReasons(checks);

return {
passed: reasons.length === 0,
reasons,
action_type: actionType,
snapshot: {
...safeSnapshot,
regime_state: derivedState,
regime_score: derived.score,
},
checks,
thresholds: getRegimeThresholds(safeConfig),
meta: {
regime_filter_enabled: true,
derived_state: derivedState,
derived_score: derived.score,
used_provided_score: derived.used_provided_score,
score_components: derived.components,
total_check_count: checks.length,
rejected_check_count: reasons.length,
},
};
}

export async function evaluateRegimeGate(
snapshot = {},
config = {},
context = {}
) {
return evaluateRegimeGateSync(snapshot, config, context);
}

export async function passesRegimeGate(
snapshot = {},
config = {},
context = {}
) {
const result = await evaluateRegimeGate(snapshot, config, context);
return Boolean(result.passed);
}

export function summarizeRegimeGate(result = null) {
if (!result) {
return {
passed: true,
reasons: [],
action_type: "scout",
derived_state: MARKET_REGIME.NEUTRAL,
derived_score: 50,
rejected_check_count: 0,
total_check_count: 0,
};
}

return {
passed: Boolean(result.passed),
reasons: ensureReasonCodeArray(result.reasons || []),
action_type: cleanText(result.action_type, 32) || "scout",
derived_state:
cleanText(result?.meta?.derived_state, 64) || MARKET_REGIME.NEUTRAL,
derived_score: toFloat(result?.meta?.derived_score, 50),
rejected_check_count: Number(result?.meta?.rejected_check_count || 0),
total_check_count: Number(result?.meta?.total_check_count || 0),
};
}

export default {
MARKET_REGIME,
deriveRegimeScore,
deriveRegimeState,
getRegimeThresholds,
getRegimeReasonCodes,
isRegimeReason,
filterRegimeReasons,
evaluateRegimeGateSync,
evaluateRegimeGate,
passesRegimeGate,
summarizeRegimeGate,
};
