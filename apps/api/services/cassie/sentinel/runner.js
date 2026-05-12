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

buy_pressure_score: normalizeNullableScore(
firstFiniteNumber(
snapshot.buy_pressure_score,
snapshot.buy_pressure,
snapshot.buyPressureScore
)
),
persistence_score: normalizeNullableScore(
firstFiniteNumber(
snapshot.persistence_score,
snapshot.persistence,
snapshot.persistenceScore
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
failed_breakout_count: (() => {
const raw = firstDefined(
snapshot.failed_breakout_count,
snapshot.failedBreakoutCount,
snapshot.failed_breakouts,
snapshot.failedBreakouts
);
if (raw == null || raw === "") return null;
return Math.max(0, toInt(raw, 0));
})(),
insider_sell_score: normalizeNullableScore(
firstFiniteNumber(
snapshot.insider_sell_score,
snapshot.insider_sell_risk,
snapshot.insiderSellScore,
snapshot.insiderSellRisk
)
),
liquidity_decay_score: normalizeNullableScore(
firstFiniteNumber(
snapshot.liquidity_decay_score,
snapshot.liquidity_decay,
snapshot.liquidityDecayScore,
snapshot.liquidityDecayRisk
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
has_banked_10x: Boolean(position.has_banked_10x),
current_value_usd: Math.max(0, toFloat(position.current_value_usd, 0)),
runner_started_at:
cleanText(
firstDefined(position.runner_started_at, position.runnerStartedAt),
64
) || null,
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
position_id:
toInt(firstDefined(context.position_id, context.positionId), 0) || null,
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

function isRunnerPosition(position) {
if (!position?.id) return false;
if (!isOpenStage(position.stage)) return false;
if (!position.has_banked_10x) return false;

return (
cleanText(position.stage, 64) === "half_banked_at_10x" ||
cleanText(position.stage, 64) === "runner_only"
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

export function getRunnerReasonCodes() {
return Array.from(RUNNER_REASON_SET);
}

export function isRunnerReason(code) {
return RUNNER_REASON_SET.has(cleanText(code, 128));
}

export function filterRunnerReasons(reasonCodes = []) {
return ensureReasonCodeArray(reasonCodes).filter((code) =>
isRunnerReason(code)
);
}

export function getRunnerThresholds(config = {}, runtime = {}) {
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

min_buy_pressure_score_for_runner: paperMode ? 35 : 45,
min_persistence_score_for_runner: paperMode ? 35 : 45,
min_structural_health_score_for_runner: paperMode
? Math.min(safe.min_post_entry_health_score, 40)
: safe.min_post_entry_health_score,

runner_failed_breakout_limit: paperMode
? Math.max(safe.runner_failed_breakout_limit, 4)
: safe.runner_failed_breakout_limit,

runner_insider_sell_score_threshold: paperMode ? 80 : 65,
runner_liquidity_decay_score_threshold: paperMode ? 80 : 65,
};
}

export function evaluateRunnerExitSync(
snapshot = {},
position = null,
config = {},
context = {}
) {
const safeSnapshot = normalizeSnapshot(snapshot || {});
const safePosition = normalizePosition(position || null);
const safeContext = normalizeContext(context || {});

const executionMode =
safeContext.execution_mode ||
safeSnapshot.execution_mode ||
safePosition?.execution_mode ||
config?.execution_mode ||
"paper";

const safeConfig = getEffectiveSentinelConfig(
normalizeSentinelConfig({
...(config || {}),
execution_mode: executionMode,
})
);

const thresholds = getRunnerThresholds(safeConfig, {
execution_mode: executionMode,
});

if (!safeConfig.enable_runner_management) {
return {
exit: false,
decision: "hold",
reasons: [REASON_CODE.RUNNER_MANAGEMENT_DISABLED],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
checks: [],
thresholds,
meta: {
runner_management_enabled: false,
valid_runner_position: isRunnerPosition(safePosition),
execution_mode: executionMode,
paper_mode_relaxed: Boolean(thresholds.paper_mode_relaxed),
total_check_count: 0,
rejected_check_count: 0,
missing_metrics: [],
},
};
}

if (!isRunnerPosition(safePosition)) {
return {
exit: false,
decision: "hold",
reasons: [REASON_CODE.NO_RUNNER_POSITION],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
checks: [],
thresholds,
meta: {
runner_management_enabled: true,
valid_runner_position: false,
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
REASON_CODE.BUY_PRESSURE_DECAY,
safeSnapshot.buy_pressure_score,
thresholds.min_buy_pressure_score_for_runner,
"<",
safeSnapshot.buy_pressure_score != null &&
safeSnapshot.buy_pressure_score <
thresholds.min_buy_pressure_score_for_runner,
{
missing: safeSnapshot.buy_pressure_score == null,
note:
safeSnapshot.buy_pressure_score == null
? "Skipped because buy pressure score is missing."
: null,
}
),
buildCheck(
REASON_CODE.PERSISTENCE_DECAY,
safeSnapshot.persistence_score,
thresholds.min_persistence_score_for_runner,
"<",
safeSnapshot.persistence_score != null &&
safeSnapshot.persistence_score <
thresholds.min_persistence_score_for_runner,
{
missing: safeSnapshot.persistence_score == null,
note:
safeSnapshot.persistence_score == null
? "Skipped because persistence score is missing."
: null,
}
),
buildCheck(
REASON_CODE.STRUCTURAL_HEALTH_WEAK,
safeSnapshot.structural_health_score,
thresholds.min_structural_health_score_for_runner,
"<",
safeSnapshot.structural_health_score != null &&
safeSnapshot.structural_health_score <
thresholds.min_structural_health_score_for_runner,
{
missing: safeSnapshot.structural_health_score == null,
note:
safeSnapshot.structural_health_score == null
? "Skipped because structural health score is missing."
: null,
}
),
buildCheck(
REASON_CODE.FAILED_BREAKOUTS_TOO_MANY,
safeSnapshot.failed_breakout_count,
thresholds.runner_failed_breakout_limit,
">=",
safeSnapshot.failed_breakout_count != null &&
safeSnapshot.failed_breakout_count >=
thresholds.runner_failed_breakout_limit,
{
missing: safeSnapshot.failed_breakout_count == null,
note:
safeSnapshot.failed_breakout_count == null
? "Skipped because failed breakout count is missing."
: null,
}
),
buildCheck(
REASON_CODE.RUNNER_INSIDER_SELL_RISK,
safeSnapshot.insider_sell_score,
thresholds.runner_insider_sell_score_threshold,
">=",
safeSnapshot.insider_sell_score != null &&
safeSnapshot.insider_sell_score >=
thresholds.runner_insider_sell_score_threshold,
{
missing: safeSnapshot.insider_sell_score == null,
note:
safeSnapshot.insider_sell_score == null
? "Skipped because insider sell score is missing."
: null,
}
),
buildCheck(
REASON_CODE.RUNNER_LIQUIDITY_DECAY,
safeSnapshot.liquidity_decay_score,
thresholds.runner_liquidity_decay_score_threshold,
">=",
safeSnapshot.liquidity_decay_score != null &&
safeSnapshot.liquidity_decay_score >=
thresholds.runner_liquidity_decay_score_threshold,
{
missing: safeSnapshot.liquidity_decay_score == null,
note:
safeSnapshot.liquidity_decay_score == null
? "Skipped because liquidity decay score is missing."
: null,
}
),
];

const reasons = collectRejectedReasons(checks);
const missingMetrics = collectMissingMetrics(checks);

return {
exit: reasons.length > 0,
decision: reasons.length > 0 ? "full_exit" : "hold",
reasons: reasons.length ? reasons : [REASON_CODE.RUNNER_HEALTHY],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
checks,
thresholds,
meta: {
runner_management_enabled: true,
valid_runner_position: true,
execution_mode: executionMode,
paper_mode_relaxed: Boolean(thresholds.paper_mode_relaxed),
total_check_count: checks.length,
rejected_check_count: reasons.length,
missing_metrics: missingMetrics,
},
};
}

export async function evaluateRunnerExit(
snapshot = {},
position = null,
config = {},
context = {}
) {
const safeSnapshot = normalizeSnapshot(snapshot || {});
const safeConfig = getEffectiveSentinelConfig(
normalizeSentinelConfig(config || {})
);
const safeContext = normalizeContext(context || {});

const executionMode =
safeContext.execution_mode ||
safeSnapshot.execution_mode ||
cleanText(position?.execution_mode, 64) ||
cleanText(safeConfig.execution_mode, 64) ||
"paper";

let resolvedPosition = position ? normalizePosition(position) : null;

if (!resolvedPosition?.id) {
if (safeContext.position_id) {
resolvedPosition = normalizePosition(
await getPositionById(safeContext.position_id)
);
} else {
const lookupKey = getLookupKey(safeSnapshot, resolvedPosition);
if (lookupKey) {
resolvedPosition = normalizePosition(
await getOpenPositionByToken(lookupKey, executionMode)
);
}
}
}

return evaluateRunnerExitSync(
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
...safeContext,
execution_mode: executionMode,
}
);
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
execution_mode: null,
paper_mode_relaxed: false,
missing_metrics: [],
};
}

return {
exit: Boolean(result.exit),
decision: cleanText(result.decision, 64) || "hold",
reasons: ensureReasonCodeArray(result.reasons || []),
rejected_check_count: toInt(result?.meta?.rejected_check_count, 0),
total_check_count: toInt(result?.meta?.total_check_count, 0),
valid_runner_position: Boolean(result?.meta?.valid_runner_position),
execution_mode: cleanText(result?.meta?.execution_mode, 64) || null,
paper_mode_relaxed: Boolean(result?.meta?.paper_mode_relaxed),
missing_metrics: ensureReasonCodeArray(result?.meta?.missing_metrics || []),
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
