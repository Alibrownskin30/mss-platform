import {
getEffectiveSentinelConfig,
normalizeSentinelConfig,
isEmergencyStopMode,
} from "./config.js";
import { REASON_CODE, ensureReasonCodeArray } from "./reason-codes.js";
import { getDailyStats } from "./position-store.js";

const KILL_SWITCH_REASON_SET = new Set([
REASON_CODE.EMERGENCY_STOP_ACTIVE,
REASON_CODE.DAILY_LOSS_LIMIT,
REASON_CODE.CONSECUTIVE_FAILURE_LIMIT,
REASON_CODE.RUG_RATE_TOO_HIGH,
REASON_CODE.RECLAIM_SUCCESS_TOO_LOW,
REASON_CODE.MARKET_LIQUIDITY_TOO_LOW,
REASON_CODE.KILL_SWITCH_TRIGGERED,
]);

function cleanText(value, max = 255) {
return String(value ?? "").trim().slice(0, max);
}

function toFloat(value, fallback = 0) {
const num = Number.parseFloat(value);
return Number.isFinite(num) ? num : fallback;
}

function toNullableFloat(value, fallback = null) {
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

function resolveExecutionMode(...values) {
for (const value of values) {
const mode = cleanText(value, 64).toLowerCase();
if (mode) return mode;
}
return null;
}

function hasPositiveMetric(value) {
return Number.isFinite(Number(value)) && Number(value) > 0;
}

function normalizeStats(stats = {}) {
const reclaimSuccessRatePct = toNullableFloat(
firstDefined(
stats.reclaim_success_rate_pct,
stats.reclaim_success_rate,
stats.reclaimSuccessRatePct,
stats.reclaimSuccessRate
),
null
);

const avgMarketLiquidityUsd = toNullableFloat(
firstDefined(
stats.avg_market_liquidity_usd,
stats.avg_market_liquidity,
stats.avgMarketLiquidityUsd,
stats.avgMarketLiquidity
),
null
);

return {
...stats,
stat_date: cleanText(firstDefined(stats.stat_date, stats.statDate), 32) || null,
execution_mode:
resolveExecutionMode(
stats.execution_mode,
stats.executionMode,
stats.mode
) || null,

daily_loss_usd: Math.max(
0,
toFloat(firstDefined(stats.daily_loss_usd, stats.dailyLossUsd), 0)
),
consecutive_failures: Math.max(
0,
toInt(firstDefined(stats.consecutive_failures, stats.consecutiveFailures), 0)
),
recent_rug_rate_pct: clamp(
firstDefined(stats.recent_rug_rate_pct, stats.recentRugRatePct),
0,
100
),

reclaim_success_rate_pct:
reclaimSuccessRatePct == null ? null : clamp(reclaimSuccessRatePct, 0, 100),

avg_market_liquidity_usd:
avgMarketLiquidityUsd == null ? null : Math.max(0, avgMarketLiquidityUsd),
};
}

function buildCheck(
code,
actual,
threshold,
comparator,
triggered,
{ skipped = false, note = null } = {}
) {
return {
code,
actual,
threshold,
comparator,
triggered: Boolean(triggered),
skipped: Boolean(skipped),
note: cleanText(note, 500) || null,
};
}

function collectTriggeredReasons(checks = []) {
return checks.filter((check) => check.triggered).map((check) => check.code);
}

function hasUsableReclaimMetric(stats = {}) {
return hasPositiveMetric(stats.reclaim_success_rate_pct);
}

function hasUsableMarketLiquidityMetric(stats = {}) {
return hasPositiveMetric(stats.avg_market_liquidity_usd);
}

export function getKillSwitchReasonCodes() {
return Array.from(KILL_SWITCH_REASON_SET);
}

export function isKillSwitchReason(code) {
return KILL_SWITCH_REASON_SET.has(cleanText(code, 128));
}

export function filterKillSwitchReasons(reasonCodes = []) {
return ensureReasonCodeArray(reasonCodes).filter((code) =>
isKillSwitchReason(code)
);
}

export function getKillSwitchThresholds(config = {}, runtime = {}) {
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

return {
execution_mode: runtimeExecutionMode || safe.execution_mode,
max_daily_loss_usd: safe.max_daily_loss_usd,
max_consecutive_failures: safe.max_consecutive_failures,
max_recent_rug_rate_pct: 35,
min_reclaim_success_rate_pct: 20,
min_avg_market_liquidity_usd: 600,
};
}

export function evaluateKillSwitchSync(dayStats = {}, config = {}) {
const safeStats = normalizeStats(dayStats || {});
const executionMode = resolveExecutionMode(
safeStats.execution_mode,
config?.execution_mode
);

const safeConfig = getEffectiveSentinelConfig(
normalizeSentinelConfig({
...(config || {}),
...(executionMode ? { execution_mode: executionMode } : {}),
})
);

const thresholds = getKillSwitchThresholds(safeConfig, {
execution_mode: executionMode,
});

const reclaimMetricAvailable = hasUsableReclaimMetric(safeStats);
const marketLiquidityMetricAvailable = hasUsableMarketLiquidityMetric(safeStats);

const checks = [
buildCheck(
REASON_CODE.EMERGENCY_STOP_ACTIVE,
safeConfig.execution_mode,
"not_emergency_stop",
"===",
isEmergencyStopMode(safeConfig)
),
buildCheck(
REASON_CODE.DAILY_LOSS_LIMIT,
safeStats.daily_loss_usd,
thresholds.max_daily_loss_usd,
">=",
safeStats.daily_loss_usd >= thresholds.max_daily_loss_usd
),
buildCheck(
REASON_CODE.CONSECUTIVE_FAILURE_LIMIT,
safeStats.consecutive_failures,
thresholds.max_consecutive_failures,
">=",
safeStats.consecutive_failures >= thresholds.max_consecutive_failures
),
buildCheck(
REASON_CODE.RUG_RATE_TOO_HIGH,
safeStats.recent_rug_rate_pct,
thresholds.max_recent_rug_rate_pct,
">=",
safeStats.recent_rug_rate_pct >= thresholds.max_recent_rug_rate_pct
),
buildCheck(
REASON_CODE.RECLAIM_SUCCESS_TOO_LOW,
safeStats.reclaim_success_rate_pct,
thresholds.min_reclaim_success_rate_pct,
"<=",
reclaimMetricAvailable &&
safeStats.reclaim_success_rate_pct <=
thresholds.min_reclaim_success_rate_pct,
{
skipped: !reclaimMetricAvailable,
note: !reclaimMetricAvailable
? "Skipped because reclaim success regime metric is missing or uninitialized."
: null,
}
),
buildCheck(
REASON_CODE.MARKET_LIQUIDITY_TOO_LOW,
safeStats.avg_market_liquidity_usd,
thresholds.min_avg_market_liquidity_usd,
"<=",
marketLiquidityMetricAvailable &&
safeStats.avg_market_liquidity_usd <=
thresholds.min_avg_market_liquidity_usd,
{
skipped: !marketLiquidityMetricAvailable,
note: !marketLiquidityMetricAvailable
? "Skipped because average market liquidity regime metric is missing or uninitialized."
: null,
}
),
];

const triggeredReasons = collectTriggeredReasons(checks);
const active = triggeredReasons.length > 0;
const reasons = active
? Array.from(new Set([...triggeredReasons, REASON_CODE.KILL_SWITCH_TRIGGERED]))
: [];

return {
active,
reasons,
checks,
thresholds,
stats: safeStats,
meta: {
execution_mode: thresholds.execution_mode,
total_check_count: checks.length,
triggered_check_count: triggeredReasons.length,
hard_stop_only: active,
should_halt_new_entries: active,
should_continue_runner_management: true,
reclaim_metric_available: reclaimMetricAvailable,
market_liquidity_metric_available: marketLiquidityMetricAvailable,
market_regime_context_available:
reclaimMetricAvailable || marketLiquidityMetricAvailable,
triggered_reasons: triggeredReasons,
},
};
}

export async function evaluateKillSwitch(dayStats = null, config = {}) {
const safeConfig = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
const executionMode = resolveExecutionMode(
dayStats?.execution_mode,
dayStats?.executionMode,
dayStats?.mode,
safeConfig.execution_mode
);

const stats =
dayStats && typeof dayStats === "object" && Object.keys(dayStats).length
? normalizeStats({
...dayStats,
execution_mode: executionMode,
})
: await getDailyStats(executionMode || safeConfig.execution_mode || "paper");

return evaluateKillSwitchSync(stats, {
...safeConfig,
execution_mode: executionMode || safeConfig.execution_mode,
});
}

export async function isKillSwitchActive(dayStats = null, config = {}) {
const result = await evaluateKillSwitch(dayStats, config);
return Boolean(result.active);
}

export function summarizeKillSwitch(result = null) {
if (!result) {
return {
active: false,
reasons: [],
triggered_check_count: 0,
total_check_count: 0,
should_halt_new_entries: false,
should_continue_runner_management: true,
reclaim_metric_available: false,
market_liquidity_metric_available: false,
market_regime_context_available: false,
execution_mode: null,
};
}

return {
active: Boolean(result.active),
reasons: ensureReasonCodeArray(result.reasons || []),
triggered_check_count: toInt(result?.meta?.triggered_check_count, 0),
total_check_count: toInt(result?.meta?.total_check_count, 0),
should_halt_new_entries: Boolean(result?.meta?.should_halt_new_entries),
should_continue_runner_management: Boolean(
result?.meta?.should_continue_runner_management
),
reclaim_metric_available: Boolean(result?.meta?.reclaim_metric_available),
market_liquidity_metric_available: Boolean(
result?.meta?.market_liquidity_metric_available
),
market_regime_context_available: Boolean(
result?.meta?.market_regime_context_available
),
execution_mode: cleanText(result?.meta?.execution_mode, 64) || null,
};
}

export default {
getKillSwitchReasonCodes,
isKillSwitchReason,
filterKillSwitchReasons,
getKillSwitchThresholds,
evaluateKillSwitchSync,
evaluateKillSwitch,
isKillSwitchActive,
summarizeKillSwitch,
};
