import {
getEffectiveSentinelConfig,
normalizeSentinelConfig,
} from "./config.js";
import { REASON_CODE, ensureReasonCodeArray } from "./reason-codes.js";
import {
getPositionById,
getOpenPositionByToken,
isOpenStage,
} from "./position-store.js";

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

function nowTsMs(input = null) {
if (input instanceof Date) return input.getTime();
if (typeof input === "number" && Number.isFinite(input)) return input;

if (typeof input === "string") {
const parsed = new Date(input).getTime();
if (!Number.isNaN(parsed)) return parsed;
}

return Date.now();
}

function normalizeNullableScore(value) {
if (value == null) return null;
return clamp(value, 0, 100);
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

reclaim_strength_score: normalizeNullableScore(
firstFiniteNumber(
snapshot.reclaim_strength_score,
snapshot.reclaim_strength,
snapshot.reclaimStrengthScore
)
),
buy_pressure_score: normalizeNullableScore(
firstFiniteNumber(
snapshot.buy_pressure_score,
snapshot.buy_pressure,
snapshot.buyPressureScore
)
),
structural_health_score: normalizeNullableScore(
firstFiniteNumber(
snapshot.structural_health_score,
snapshot.structural_health,
snapshot.market_quality_score,
snapshot.structure_score,
snapshot.structuralHealthScore
)
),
insider_sell_score: normalizeNullableScore(
firstFiniteNumber(
snapshot.insider_sell_score,
snapshot.insider_sell_risk,
snapshot.insiderSellScore,
snapshot.insiderSellRisk
)
),
liquidity_break_risk: normalizeNullableScore(
firstFiniteNumber(
snapshot.liquidity_break_risk,
snapshot.liquidity_break,
snapshot.liquidityBreakRisk,
snapshot.liquidityBreakScore
)
),
};
}

function normalizePosition(position = {}, currentNowTs = Date.now()) {
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

const openedAt =
cleanText(
firstDefined(position.opened_at, position.openedAt, position.open_ts),
64
) || null;

const openedAtMs = openedAt ? nowTsMs(openedAt) : currentNowTs;
const openAgeSec = Math.max(0, Math.floor((currentNowTs - openedAtMs) / 1000));

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
has_banked_10x: Boolean(position.has_banked_10x),
opened_at: openedAt,
open_age_sec: openAgeSec,
};
}

function buildCheck(
code,
actual,
threshold,
comparator,
rejected,
{ missing = false, note = null } = {}
) {
return {
code,
actual,
threshold,
comparator,
rejected: Boolean(rejected),
missing: Boolean(missing),
note: cleanText(note, 500) || null,
};
}

function collectRejectedReasons(checks = []) {
return checks.filter((check) => check.rejected).map((check) => check.code);
}

function collectMissingMetrics(checks = []) {
return checks.filter((check) => check.missing).map((check) => check.code);
}

function isPreRunnerOpenPosition(position) {
if (!position?.id) return false;
if (!isOpenStage(position.stage)) return false;
if (position.has_banked_10x) return false;

return (
cleanText(position.stage, 64) === "scout_open" ||
cleanText(position.stage, 64) === "sniper_added"
);
}

function getLookupKey(snapshot = {}, position = null) {
return (
cleanText(position?.token_id, 255) ||
cleanText(position?.mint_address, 255) ||
cleanText(snapshot?.token_id, 255) ||
cleanText(snapshot?.mint_address, 255) ||
cleanText(snapshot?.mint, 255) ||
""
);
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
return codes.some((code) => isInvalidationReason(code))
? "invalidated"
: "closed";
}

export function getExitThresholds(config = {}, runtime = {}) {
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

early_fail_timeout_sec: Math.max(0, toInt(safe.early_fail_timeout_sec, 180)),
weak_stall_timeout_sec: Math.max(0, toInt(safe.weak_stall_timeout_sec, 420)),

early_reclaim_failure_score_threshold: paperMode ? 30 : 45,
weak_stall_buy_pressure_threshold: paperMode ? 30 : 45,
insider_dump_score_threshold: paperMode ? 90 : 75,
liquidity_break_risk_threshold: paperMode ? 90 : 75,
structural_health_collapse_threshold: paperMode ? 25 : 40,
};
}

export function evaluateEarlyExitSync(
snapshot = {},
position = null,
config = {},
context = {}
) {
const safeSnapshot = normalizeSnapshot(snapshot || {});
const currentNowTs = nowTsMs(context?.now_ts);
const safePosition = normalizePosition(position || null, currentNowTs);

const executionMode =
resolveExecutionMode(
context?.execution_mode,
safeSnapshot.execution_mode,
safePosition?.execution_mode,
config?.execution_mode
) || "paper";

const safeConfig = getEffectiveSentinelConfig(
normalizeSentinelConfig({
...(config || {}),
execution_mode: executionMode,
})
);

const thresholds = getExitThresholds(safeConfig, {
execution_mode: executionMode,
});

if (!isPreRunnerOpenPosition(safePosition)) {
return {
exit: false,
invalidate: false,
decision: "hold",
reasons: [],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
checks: [],
thresholds,
meta: {
valid_open_position: false,
exit_type: null,
execution_mode: executionMode,
paper_mode_relaxed: Boolean(thresholds.paper_mode_relaxed),
total_check_count: 0,
rejected_check_count: 0,
missing_metrics: [],
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
max_reclaim_strength_score:
thresholds.early_reclaim_failure_score_threshold,
},
"age>=threshold && reclaim<threshold",
safeSnapshot.reclaim_strength_score != null &&
safePosition.open_age_sec >= thresholds.early_fail_timeout_sec &&
safeSnapshot.reclaim_strength_score <
thresholds.early_reclaim_failure_score_threshold,
{
missing: safeSnapshot.reclaim_strength_score == null,
note:
safeSnapshot.reclaim_strength_score == null
? "Skipped because reclaim strength score is missing."
: null,
}
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
safeSnapshot.buy_pressure_score != null &&
safePosition.open_age_sec >= thresholds.weak_stall_timeout_sec &&
safeSnapshot.buy_pressure_score <
thresholds.weak_stall_buy_pressure_threshold,
{
missing: safeSnapshot.buy_pressure_score == null,
note:
safeSnapshot.buy_pressure_score == null
? "Skipped because buy pressure score is missing."
: null,
}
),
buildCheck(
REASON_CODE.INSIDER_DUMP_DETECTED,
safeSnapshot.insider_sell_score,
thresholds.insider_dump_score_threshold,
">=",
safeSnapshot.insider_sell_score != null &&
safeSnapshot.insider_sell_score >= thresholds.insider_dump_score_threshold,
{
missing: safeSnapshot.insider_sell_score == null,
note:
safeSnapshot.insider_sell_score == null
? "Skipped because insider sell score is missing."
: null,
}
),
buildCheck(
REASON_CODE.LIQUIDITY_BREAK_DETECTED,
safeSnapshot.liquidity_break_risk,
thresholds.liquidity_break_risk_threshold,
">=",
safeSnapshot.liquidity_break_risk != null &&
safeSnapshot.liquidity_break_risk >=
thresholds.liquidity_break_risk_threshold,
{
missing: safeSnapshot.liquidity_break_risk == null,
note:
safeSnapshot.liquidity_break_risk == null
? "Skipped because liquidity break risk is missing."
: null,
}
),
buildCheck(
REASON_CODE.STRUCTURAL_HEALTH_COLLAPSED,
safeSnapshot.structural_health_score,
thresholds.structural_health_collapse_threshold,
"<",
safeSnapshot.structural_health_score != null &&
safeSnapshot.structural_health_score <
thresholds.structural_health_collapse_threshold,
{
missing: safeSnapshot.structural_health_score == null,
note:
safeSnapshot.structural_health_score == null
? "Skipped because structural health score is missing."
: null,
}
),
];

const reasons = collectRejectedReasons(checks);
const invalidate = reasons.some((code) => isInvalidationReason(code));
const missingMetrics = collectMissingMetrics(checks);

return {
exit: reasons.length > 0,
invalidate,
decision: reasons.length > 0 ? "full_exit" : "hold",
reasons,
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
checks,
thresholds,
meta: {
valid_open_position: true,
exit_type: reasons.length
? invalidate
? "invalidated"
: "closed"
: null,
execution_mode: executionMode,
paper_mode_relaxed: Boolean(thresholds.paper_mode_relaxed),
total_check_count: checks.length,
rejected_check_count: reasons.length,
missing_metrics: missingMetrics,
},
};
}

export async function evaluateEarlyExit(
snapshot = {},
position = null,
config = {},
context = {}
) {
const safeSnapshot = normalizeSnapshot(snapshot || {});
const safeConfig = getEffectiveSentinelConfig(
normalizeSentinelConfig(config || {})
);

const executionMode =
resolveExecutionMode(
context?.execution_mode,
safeSnapshot.execution_mode,
position?.execution_mode,
safeConfig.execution_mode
) || "paper";

let resolvedPosition = position || null;

if (!resolvedPosition?.id) {
if (context?.position_id) {
resolvedPosition = await getPositionById(context.position_id);
} else {
const lookupKey = getLookupKey(safeSnapshot, resolvedPosition);
if (lookupKey) {
resolvedPosition = await getOpenPositionByToken(lookupKey, executionMode);
}
}
}

return evaluateEarlyExitSync(
{
...safeSnapshot,
execution_mode: executionMode,
},
resolvedPosition,
{
...safeConfig,
execution_mode: executionMode,
},
{
...context,
execution_mode: executionMode,
now_ts: context?.now_ts,
}
);
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
execution_mode: null,
paper_mode_relaxed: false,
missing_metrics: [],
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
execution_mode: cleanText(result?.meta?.execution_mode, 64) || null,
paper_mode_relaxed: Boolean(result?.meta?.paper_mode_relaxed),
missing_metrics: ensureReasonCodeArray(result?.meta?.missing_metrics || []),
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
