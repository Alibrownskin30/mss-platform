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

function toInt(value, fallback = 0) {
const num = Number.parseInt(value, 10);
return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min = 0, max = 100) {
return Math.min(max, Math.max(min, toFloat(value, min)));
}

function firstDefined(...values) {
for (const value of values) {
if (value !== undefined && value !== null && value !== "") {
return value;
}
}
return undefined;
}

function firstNonEmpty(...values) {
for (const value of values) {
const cleaned = cleanText(value, 255);
if (cleaned) return cleaned;
}
return "";
}

function firstFiniteNumber(...values) {
for (const value of values) {
const num = Number.parseFloat(value);
if (Number.isFinite(num)) return num;
}
return null;
}

function resolveExecutionMode(...values) {
for (const value of values) {
const mode = cleanText(value, 64).toLowerCase();
if (mode) return mode;
}
return null;
}

function isPaperMode(executionMode) {
return cleanText(executionMode, 64).toLowerCase() === "paper";
}

function normalizePercentLike(value, fallback = null) {
if (value == null || value === "") return fallback;

const num = Number(value);
if (!Number.isFinite(num)) return fallback;

if (num >= 0 && num <= 1) {
return clamp(num * 100, 0, 100);
}

return clamp(num, 0, 100);
}

function normalizeNullableMin(value) {
const num = firstFiniteNumber(value);
if (num == null) return null;
return Math.max(0, num);
}

function normalizeNullableScore(value) {
const num = firstFiniteNumber(value);
if (num == null) return null;
return clamp(num, 0, 100);
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
const tokenId = firstNonEmpty(
snapshot.token_id,
snapshot.tokenId,
snapshot.mint,
snapshot.mint_address,
snapshot.mintAddress
);

const mintAddress = firstNonEmpty(
snapshot.mint_address,
snapshot.mintAddress,
snapshot.mint,
snapshot.token_id,
snapshot.tokenId
);

const executionMode = resolveExecutionMode(
snapshot.execution_mode,
snapshot.executionMode,
snapshot.mode
);

const regimeState = normalizeRegimeState(
firstDefined(
snapshot.regime_state,
snapshot.market_regime,
snapshot.market_regime_state,
snapshot.regime,
snapshot.market_state
)
);

const regimeScore = normalizeNullableScore(
firstDefined(
snapshot.regime_score,
snapshot.market_regime_score,
snapshot.market_score,
snapshot.regimeScore,
snapshot.marketRegimeScore
)
);

const recentRugRatePct = normalizePercentLike(
firstDefined(
snapshot.recent_rug_rate_pct,
snapshot.rug_rate_pct,
snapshot.recent_rug_rate,
snapshot.recentRugRatePct,
snapshot.recentRugRate
),
null
);

const reclaimSuccessRatePct = normalizePercentLike(
firstDefined(
snapshot.reclaim_success_rate_pct,
snapshot.reclaim_success_rate,
snapshot.reclaim_rate_pct,
snapshot.reclaim_success_score,
snapshot.reclaimSuccessRatePct,
snapshot.reclaimSuccessRate
),
null
);

const avgMarketLiquidityUsd = normalizeNullableMin(
firstDefined(
snapshot.avg_market_liquidity_usd,
snapshot.market_liquidity_usd,
snapshot.avg_liquidity_usd,
snapshot.avgMarketLiquidityUsd,
snapshot.marketLiquidityUsd,
snapshot.liquidity_usd,
snapshot.liquidityUsd,
snapshot.market?.liquidity_usd,
snapshot.market?.liquidityUsd,
snapshot.market?.liquidity?.usd
)
);

const recentRunnerCount = normalizeNullableMin(
firstDefined(
snapshot.recent_runner_count,
snapshot.recent_runners,
snapshot.runner_count,
snapshot.recentRunnerCount,
snapshot.recentRunners
)
);

const breakoutFollowThroughScore = normalizeNullableScore(
firstDefined(
snapshot.breakout_follow_through_score,
snapshot.follow_through_score,
snapshot.breakout_score,
snapshot.breakoutFollowThroughScore,
snapshot.followThroughScore
)
);

const liveLaunchCount = normalizeNullableMin(
firstDefined(
snapshot.live_launch_count,
snapshot.active_launch_count,
snapshot.liveLaunchCount,
snapshot.activeLaunchCount
)
);

return {
...snapshot,
token_id: tokenId || mintAddress || "",
mint_address: mintAddress || tokenId || "",
execution_mode: executionMode,
regime_state: regimeState,
regime_score: regimeScore,
recent_rug_rate_pct: recentRugRatePct,
reclaim_success_rate_pct: reclaimSuccessRatePct,
avg_market_liquidity_usd: avgMarketLiquidityUsd,
recent_runner_count: recentRunnerCount,
breakout_follow_through_score: breakoutFollowThroughScore,
live_launch_count: liveLaunchCount,
};
}

function normalizePaperMetric(
value,
{ paperMode = false, treatZeroAsUnknown = false } = {}
) {
if (value == null) return null;
if (paperMode && treatZeroAsUnknown && Number(value) <= 0) {
return null;
}
return value;
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

function getLiveLaunchScore(liveLaunchCount) {
if (liveLaunchCount == null) return 50;
if (liveLaunchCount >= 12) return 90;
if (liveLaunchCount >= 8) return 75;
if (liveLaunchCount >= 4) return 60;
if (liveLaunchCount >= 1) return 45;
return 30;
}

export function deriveRegimeScore(snapshot = {}, config = {}) {
const safeSnapshot = normalizeSnapshot(snapshot || {});
const safeConfig = getEffectiveSentinelConfig(
normalizeSentinelConfig(config || {})
);

const executionMode = resolveExecutionMode(
safeSnapshot.execution_mode,
safeConfig.execution_mode
);
const paperMode = isPaperMode(executionMode);

const providedScore =
paperMode && Number(safeSnapshot.regime_score) === 0
? null
: safeSnapshot.regime_score;

if (providedScore != null) {
return {
score: clamp(providedScore, 0, 100),
used_provided_score: true,
components: {
provided_regime_score: clamp(providedScore, 0, 100),
},
missing_metrics: [],
};
}

const reclaimPct = normalizePaperMetric(safeSnapshot.reclaim_success_rate_pct, {
paperMode,
treatZeroAsUnknown: true,
});

const rugPct = normalizePaperMetric(safeSnapshot.recent_rug_rate_pct, {
paperMode,
treatZeroAsUnknown: false,
});

const liquidityUsd = normalizePaperMetric(safeSnapshot.avg_market_liquidity_usd, {
paperMode,
treatZeroAsUnknown: true,
});

const runnerCount = normalizePaperMetric(safeSnapshot.recent_runner_count, {
paperMode,
treatZeroAsUnknown: true,
});

const liveLaunchCount = normalizePaperMetric(safeSnapshot.live_launch_count, {
paperMode,
treatZeroAsUnknown: true,
});

const followThrough = normalizePaperMetric(
safeSnapshot.breakout_follow_through_score,
{
paperMode,
treatZeroAsUnknown: true,
}
);

const reclaimScore = reclaimPct == null ? 50 : clamp(reclaimPct, 0, 100);
const inverseRugScore = rugPct == null ? 50 : clamp(100 - rugPct, 0, 100);
const liquidityScore = getLiquidityScore(liquidityUsd, safeConfig);
const runnerScore = getRunnerScore(runnerCount);
const followThroughScore = followThrough == null ? 50 : clamp(followThrough, 0, 100);
const launchBreadthScore = getLiveLaunchScore(liveLaunchCount);

const weightedScore =
reclaimScore * 0.35 +
inverseRugScore * 0.22 +
liquidityScore * 0.18 +
runnerScore * 0.1 +
followThroughScore * 0.08 +
launchBreadthScore * 0.07;

const missingMetrics = [];
if (reclaimPct == null) missingMetrics.push("reclaim_success_rate_pct");
if (rugPct == null) missingMetrics.push("recent_rug_rate_pct");
if (liquidityUsd == null) missingMetrics.push("avg_market_liquidity_usd");
if (runnerCount == null) missingMetrics.push("recent_runner_count");
if (followThrough == null) missingMetrics.push("breakout_follow_through_score");
if (liveLaunchCount == null) missingMetrics.push("live_launch_count");

return {
score: clamp(weightedScore, 0, 100),
used_provided_score: false,
components: {
reclaim_success_score: reclaimScore,
inverse_rug_score: inverseRugScore,
liquidity_score: liquidityScore,
runner_score: runnerScore,
breakout_follow_through_score: followThroughScore,
live_launch_score: launchBreadthScore,
},
missing_metrics: missingMetrics,
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

export function getRegimeThresholds(config = {}, runtime = {}) {
const runtimeExecutionMode = resolveExecutionMode(
runtime?.execution_mode,
config?.execution_mode
);

const safe = getEffectiveSentinelConfig(
normalizeSentinelConfig({
...(config || {}),
...(runtimeExecutionMode ? { execution_mode: runtimeExecutionMode } : {}),
})
);

const executionMode = runtimeExecutionMode || safe.execution_mode;
const paperMode = isPaperMode(executionMode);

return {
execution_mode: executionMode,
paper_mode_relaxed: paperMode,
min_regime_score_for_scout: paperMode
? Math.min(safe.min_regime_score_for_scout, 35)
: safe.min_regime_score_for_scout,
min_regime_score_for_sniper: paperMode
? Math.min(safe.min_regime_score_for_sniper, 45)
: safe.min_regime_score_for_sniper,
risk_off_disable_new_entries: paperMode
? false
: Boolean(safe.risk_off_disable_new_entries),
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
return ensureReasonCodeArray(reasonCodes).filter((code) =>
isRegimeReason(code)
);
}

export function evaluateRegimeGateSync(
snapshot = {},
config = {},
{ action_type = "scout", execution_mode = null } = {}
) {
const safeSnapshot = normalizeSnapshot(snapshot || {});
const safeExecutionMode =
resolveExecutionMode(
execution_mode,
safeSnapshot.execution_mode,
config?.execution_mode
) || "paper";

const safeConfig = getEffectiveSentinelConfig(
normalizeSentinelConfig({
...(config || {}),
...(safeExecutionMode ? { execution_mode: safeExecutionMode } : {}),
})
);

const thresholds = getRegimeThresholds(safeConfig, {
execution_mode: safeExecutionMode,
});

const actionType = normalizeActionType(action_type, "scout");
const derived = deriveRegimeScore(safeSnapshot, safeConfig);
const derivedState =
safeSnapshot.regime_state || deriveRegimeState(derived.score);

const requiredScore =
actionType === "sniper"
? thresholds.min_regime_score_for_sniper
: thresholds.min_regime_score_for_scout;

if (!safeConfig.enable_market_regime_filter) {
return {
passed: true,
reasons: [],
action_type: actionType,
snapshot: {
...safeSnapshot,
execution_mode: thresholds.execution_mode,
regime_state: derivedState,
regime_score: derived.score,
},
checks: [],
thresholds,
meta: {
regime_filter_enabled: false,
derived_state: derivedState,
derived_score: derived.score,
used_provided_score: derived.used_provided_score,
score_components: derived.components,
execution_mode: thresholds.execution_mode,
paper_mode_relaxed: Boolean(thresholds.paper_mode_relaxed),
total_check_count: 0,
rejected_check_count: 0,
missing_metrics: derived.missing_metrics || [],
},
};
}

const checks = [];

if (thresholds.execution_mode === "emergency_stop") {
checks.push(
buildCheck(
REASON_CODE.EMERGENCY_STOP_ACTIVE,
thresholds.execution_mode,
"not_emergency_stop",
"===",
true
)
);
}

if (
derivedState === MARKET_REGIME.RISK_OFF &&
thresholds.risk_off_disable_new_entries
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

const marketQualityTooLow = thresholds.paper_mode_relaxed
? derived.score < Math.max(20, requiredScore - 10)
: derived.score < requiredScore &&
(derivedState === MARKET_REGIME.RISK_OFF ||
derivedState === MARKET_REGIME.CAUTIOUS);

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
execution_mode: thresholds.execution_mode,
regime_state: derivedState,
regime_score: derived.score,
},
checks,
thresholds,
meta: {
regime_filter_enabled: true,
derived_state: derivedState,
derived_score: derived.score,
used_provided_score: derived.used_provided_score,
score_components: derived.components,
total_check_count: checks.length,
rejected_check_count: reasons.length,
execution_mode: thresholds.execution_mode,
paper_mode_relaxed: Boolean(thresholds.paper_mode_relaxed),
missing_metrics: derived.missing_metrics || [],
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
execution_mode: null,
paper_mode_relaxed: false,
missing_metrics: [],
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
execution_mode: cleanText(result?.meta?.execution_mode, 64) || null,
paper_mode_relaxed: Boolean(result?.meta?.paper_mode_relaxed),
missing_metrics: Array.isArray(result?.meta?.missing_metrics)
? result.meta.missing_metrics
: [],
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
