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

function toInt(value, fallback = 0) {
const num = Number.parseInt(value, 10);
return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min = 0, max = 100) {
return Math.min(max, Math.max(min, toFloat(value, min)));
}

function normalizeStats(stats = {}) {
return {
stat_date: cleanText(stats.stat_date, 32) || null,
execution_mode: cleanText(stats.execution_mode, 64) || null,

daily_loss_usd: Math.max(0, toFloat(stats.daily_loss_usd, 0)),
consecutive_failures: Math.max(0, toInt(stats.consecutive_failures, 0)),
recent_rug_rate_pct: clamp(stats.recent_rug_rate_pct, 0, 100),
reclaim_success_rate_pct: clamp(stats.reclaim_success_rate_pct, 0, 100),
avg_market_liquidity_usd: Math.max(0, toFloat(stats.avg_market_liquidity_usd, 0)),
};
}

function buildCheck(code, actual, threshold, comparator, triggered) {
return {
code,
actual,
threshold,
comparator,
triggered: Boolean(triggered),
};
}

function collectTriggeredReasons(checks = []) {
return checks.filter((check) => check.triggered).map((check) => check.code);
}

export function getKillSwitchReasonCodes() {
return Array.from(KILL_SWITCH_REASON_SET);
}

export function isKillSwitchReason(code) {
return KILL_SWITCH_REASON_SET.has(cleanText(code, 128));
}

export function filterKillSwitchReasons(reasonCodes = []) {
return ensureReasonCodeArray(reasonCodes).filter((code) => isKillSwitchReason(code));
}

export function getKillSwitchThresholds(config = {}) {
const safe = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));

return {
execution_mode: safe.execution_mode,
max_daily_loss_usd: safe.max_daily_loss_usd,
max_consecutive_failures: safe.max_consecutive_failures,
max_recent_rug_rate_pct: 35,
min_reclaim_success_rate_pct: 20,
min_avg_market_liquidity_usd: 600,
};
}

export function evaluateKillSwitchSync(dayStats = {}, config = {}) {
const safeConfig = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
const safeStats = normalizeStats(dayStats || {});
const thresholds = getKillSwitchThresholds(safeConfig);

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
safeStats.reclaim_success_rate_pct <= thresholds.min_reclaim_success_rate_pct
),
buildCheck(
REASON_CODE.MARKET_LIQUIDITY_TOO_LOW,
safeStats.avg_market_liquidity_usd,
thresholds.min_avg_market_liquidity_usd,
"<=",
safeStats.avg_market_liquidity_usd <= thresholds.min_avg_market_liquidity_usd
),
];

const reasons = collectTriggeredReasons(checks);

return {
active: reasons.length > 0,
reasons: reasons.length ? reasons : [],
checks,
thresholds,
stats: safeStats,
meta: {
execution_mode: safeConfig.execution_mode,
total_check_count: checks.length,
triggered_check_count: reasons.length,
hard_stop_only: reasons.length > 0,
should_halt_new_entries: reasons.length > 0,
should_continue_runner_management: true,
},
};
}

export async function evaluateKillSwitch(dayStats = null, config = {}) {
const safeConfig = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
const stats =
dayStats && Object.keys(dayStats).length
? normalizeStats(dayStats)
: await getDailyStats(safeConfig.execution_mode || "paper");

return evaluateKillSwitchSync(stats, safeConfig);
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
