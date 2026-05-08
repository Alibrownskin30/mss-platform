import { getEffectiveSentinelConfig, normalizeSentinelConfig } from "./config.js";
import { REASON_CODE, ensureReasonCodeArray } from "./reason-codes.js";
import { getPositionById, getOpenPositionByToken, isOpenStage } from "./position-store.js";

const EXIT_REASON_SET = new Set([
REASON_CODE.EARLY_RECLAIM_FAILED,
REASON_CODE.WEAK_STALL_NO_BUYERS,
REASON_CODE.INSIDER_DUMP_DETECTED,
REASON_CODE.LIQUIDITY_BREAK_DETECTED,
REASON_CODE.STRUCTURAL_HEALTH_COLLAPSED,
REASON_CODE.INVALIDATION_EXIT,
REASON_CODE.FULL_EXIT_EXECUTED,
REASON_CODE.POSITION_CLOSED,
]);

const INVALIDATION_TRIGGER_SET = new Set([
REASON_CODE.EARLY_RECLAIM_FAILED,
REASON_CODE.WEAK_STALL_NO_BUYERS,
REASON_CODE.INSIDER_DUMP_DETECTED,
REASON_CODE.LIQUIDITY_BREAK_DETECTED,
REASON_CODE.STRUCTURAL_HEALTH_COLLAPSED,
REASON_CODE.INVALIDATION_EXIT,
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

function nowTsMs(input = null) {
if (input instanceof Date) return input.getTime();
if (typeof input === "number" && Number.isFinite(input)) return input;
if (typeof input === "string") {
const parsed = new Date(input).getTime();
if (!Number.isNaN(parsed)) return parsed;
}
return Date.now();
}

function normalizeSnapshot(snapshot = {}) {
return {
token_id: cleanText(snapshot.token_id, 255),
mint_address: cleanText(snapshot.mint_address, 255),

reclaim_strength_score: clamp(snapshot.reclaim_strength_score, 0, 100),
buy_pressure_score: clamp(snapshot.buy_pressure_score, 0, 100),
structural_health_score: clamp(snapshot.structural_health_score, 0, 100),
insider_sell_score: clamp(snapshot.insider_sell_score, 0, 100),
liquidity_break_risk: clamp(snapshot.liquidity_break_risk, 0, 100),
};
}

function normalizePosition(position = {}, currentNowTs = Date.now()) {
const openedAt = cleanText(position.opened_at || position.open_ts, 64) || null;
const openedAtMs = openedAt ? nowTsMs(openedAt) : currentNowTs;
const openAgeSec = Math.max(0, Math.floor((currentNowTs - openedAtMs) / 1000));

return {
id: toInt(position.id, 0) || null,
token_id: cleanText(position.token_id, 255),
mint_address: cleanText(position.mint_address, 255),
stage: cleanText(position.stage, 64),
execution_mode: cleanText(position.execution_mode, 64) || null,
has_banked_10x: Boolean(position.has_banked_10x),
opened_at: openedAt,
open_age_sec: openAgeSec,
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

function isPreRunnerOpenPosition(position) {
if (!position?.id) return false;
if (!isOpenStage(position.stage)) return false;
if (position.has_banked_10x) return false;
return position.stage === "scout_open" || position.stage === "sniper_added";
}

export function getExitReasonCodes() {
return Array.from(EXIT_REASON_SET);
}

export function isExitReason(code) {
return EXIT_REASON_SET.has(cleanText(code, 128));
}

export function isInvalidationReason(code) {
return INVALIDATION_TRIGGER_SET.has(cleanText(code, 128));
}

export function filterExitReasons(reasonCodes = []) {
return ensureReasonCodeArray(reasonCodes).filter((code) => isExitReason(code));
}

export function classifyExitType(reasonCodes = []) {
const codes = filterExitReasons(reasonCodes);
return codes.some((code) => isInvalidationReason(code)) ? "invalidated" : "closed";
}

export function getExitThresholds(config = {}) {
const safe = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
return {
early_fail_timeout_sec: safe.early_fail_timeout_sec,
weak_stall_timeout_sec: safe.weak_stall_timeout_sec,

early_reclaim_failure_score_threshold: 45,
weak_stall_buy_pressure_threshold: 45,
insider_dump_score_threshold: 75,
liquidity_break_risk_threshold: 75,
structural_health_collapse_threshold: 40,
};
}

export function evaluateEarlyExitSync(
snapshot = {},
position = null,
config = {},
context = {}
) {
const safeConfig = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
const thresholds = getExitThresholds(safeConfig);
const currentNowTs = nowTsMs(context?.now_ts);
const safeSnapshot = normalizeSnapshot(snapshot || {});
const safePosition = normalizePosition(position || {}, currentNowTs);

if (!isPreRunnerOpenPosition(safePosition)) {
return {
exit: false,
invalidate: false,
decision: "hold",
reasons: [],
snapshot: safeSnapshot,
position: safePosition,
checks: [],
thresholds,
meta: {
valid_open_position: false,
exit_type: null,
total_check_count: 0,
rejected_check_count: 0,
},
};
}

const checks = [
buildCheck(
REASON_CODE.EARLY_RECLAIM_FAILED,
{
open_age_sec: safePosition.open_age_sec,
reclaim_strength_score: safeSnapshot.reclaim_strength_score,
},
{
min_open_age_sec: thresholds.early_fail_timeout_sec,
max_reclaim_strength_score: thresholds.early_reclaim_failure_score_threshold,
},
"age>=threshold && reclaim<threshold",
safePosition.open_age_sec >= thresholds.early_fail_timeout_sec &&
safeSnapshot.reclaim_strength_score < thresholds.early_reclaim_failure_score_threshold
),
buildCheck(
REASON_CODE.WEAK_STALL_NO_BUYERS,
{
open_age_sec: safePosition.open_age_sec,
buy_pressure_score: safeSnapshot.buy_pressure_score,
},
{
min_open_age_sec: thresholds.weak_stall_timeout_sec,
max_buy_pressure_score: thresholds.weak_stall_buy_pressure_threshold,
},
"age>=threshold && buy_pressure<threshold",
safePosition.open_age_sec >= thresholds.weak_stall_timeout_sec &&
safeSnapshot.buy_pressure_score < thresholds.weak_stall_buy_pressure_threshold
),
buildCheck(
REASON_CODE.INSIDER_DUMP_DETECTED,
safeSnapshot.insider_sell_score,
thresholds.insider_dump_score_threshold,
">=",
safeSnapshot.insider_sell_score >= thresholds.insider_dump_score_threshold
),
buildCheck(
REASON_CODE.LIQUIDITY_BREAK_DETECTED,
safeSnapshot.liquidity_break_risk,
thresholds.liquidity_break_risk_threshold,
">=",
safeSnapshot.liquidity_break_risk >= thresholds.liquidity_break_risk_threshold
),
buildCheck(
REASON_CODE.STRUCTURAL_HEALTH_COLLAPSED,
safeSnapshot.structural_health_score,
thresholds.structural_health_collapse_threshold,
"<",
safeSnapshot.structural_health_score < thresholds.structural_health_collapse_threshold
),
];

const reasons = collectRejectedReasons(checks);
const invalidate = reasons.some((code) => isInvalidationReason(code));

return {
exit: reasons.length > 0,
invalidate,
decision: reasons.length > 0 ? "full_exit" : "hold",
reasons,
snapshot: safeSnapshot,
position: safePosition,
checks,
thresholds,
meta: {
valid_open_position: true,
exit_type: reasons.length ? (invalidate ? "invalidated" : "closed") : null,
total_check_count: checks.length,
rejected_check_count: reasons.length,
},
};
}

export async function evaluateEarlyExit(
snapshot = {},
position = null,
config = {},
context = {}
) {
const safeConfig = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
const safeSnapshot = normalizeSnapshot(snapshot || {});

let resolvedPosition = position || null;

if (!resolvedPosition?.id) {
if (context?.position_id) {
resolvedPosition = await getPositionById(context.position_id);
} else if (safeSnapshot.token_id) {
const executionMode =
cleanText(context?.execution_mode, 64) ||
cleanText(position?.execution_mode, 64) ||
cleanText(safeConfig.execution_mode, 64) ||
"paper";

resolvedPosition = await getOpenPositionByToken(safeSnapshot.token_id, executionMode);
}
}

return evaluateEarlyExitSync(safeSnapshot, resolvedPosition, safeConfig, {
now_ts: context?.now_ts,
});
}

export async function shouldExitEarly(
snapshot = {},
position = null,
config = {},
context = {}
) {
const result = await evaluateEarlyExit(snapshot, position, config, context);
return Boolean(result.exit);
}

export function summarizeEarlyExit(result = null) {
if (!result) {
return {
exit: false,
invalidate: false,
decision: "hold",
reasons: [],
exit_type: null,
rejected_check_count: 0,
total_check_count: 0,
};
}

return {
exit: Boolean(result.exit),
invalidate: Boolean(result.invalidate),
decision: cleanText(result.decision, 64) || "hold",
reasons: ensureReasonCodeArray(result.reasons || []),
exit_type: cleanText(result?.meta?.exit_type, 32) || null,
rejected_check_count: toInt(result?.meta?.rejected_check_count, 0),
total_check_count: toInt(result?.meta?.total_check_count, 0),
};
}

export default {
getExitReasonCodes,
isExitReason,
isInvalidationReason,
filterExitReasons,
classifyExitType,
getExitThresholds,
evaluateEarlyExitSync,
evaluateEarlyExit,
shouldExitEarly,
summarizeEarlyExit,
};
