import db from "../../../db/index.js";
import {
getEffectiveSentinelConfig,
normalizeSentinelConfig,
} from "./config.js";
import { REASON_CODE, ensureReasonCodeArray } from "./reason-codes.js";
import {
countOpenPositions,
getDailyStats,
getOpenPositionByToken,
isTokenInCooldown,
} from "./position-store.js";

const SCOUT_REASON_SET = new Set([
REASON_CODE.SCOUT_DISABLED,
REASON_CODE.POSITION_ALREADY_OPEN,
REASON_CODE.TOKEN_IN_COOLDOWN,
REASON_CODE.DAILY_LOSS_LIMIT_HIT,
REASON_CODE.DAILY_SCOUT_BUDGET_HIT,
REASON_CODE.MAX_OPEN_POSITIONS_HIT,
REASON_CODE.MAX_TOKENS_PER_HOUR_HIT,
REASON_CODE.SELLER_EXHAUSTION_NOT_STRONG_ENOUGH,
REASON_CODE.RECLAIM_TOO_WEAK,
REASON_CODE.BUY_PRESSURE_TOO_WEAK,
REASON_CODE.PERSISTENCE_TOO_WEAK,
REASON_CODE.STRUCTURE_NOT_READY,
REASON_CODE.SCOUT_ENTRY_APPROVED,
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

function toBool(value, fallback = false) {
if (typeof value === "boolean") return value;
const normalized = cleanText(value, 32).toLowerCase();
if (normalized === "1" || normalized === "true" || normalized === "yes") {
return true;
}
if (normalized === "0" || normalized === "false" || normalized === "no") {
return false;
}
return fallback;
}

function normalizeNullableScore(...values) {
const num = firstFiniteNumber(...values);
if (num == null) return null;
return clamp(num, 0, 100);
}

function normalizeNullableMin(...values) {
const num = firstFiniteNumber(...values);
if (num == null) return null;
return Math.max(0, num);
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

return {
...snapshot,
token_id: tokenId || mintAddress || "",
mint_address: mintAddress || tokenId || "",
execution_mode: resolveExecutionMode(
snapshot.execution_mode,
snapshot.executionMode,
snapshot.mode
),
linked_operator_cluster_id: firstNonEmpty(
snapshot.linked_operator_cluster_id,
snapshot.linkedOperatorClusterId,
snapshot.operator_cluster_id,
snapshot.operatorClusterId,
snapshot.primary_cluster_id,
snapshot.primaryClusterId,
snapshot.cluster_id,
snapshot.clusterId
),

seller_exhaustion_score: normalizeNullableScore(
snapshot.seller_exhaustion_score,
snapshot.seller_exhaustion,
snapshot.sellerExhaustionScore,
snapshot.seller_exhaustion_strength,
snapshot.sellerExhaustionStrength,
snapshot.securityModel?.sellerExhaustion?.score
),
reclaim_strength_score: normalizeNullableScore(
snapshot.reclaim_strength_score,
snapshot.reclaim_strength,
snapshot.reclaimStrengthScore,
snapshot.reclaim_score,
snapshot.reclaimScore
),
buy_pressure_score: normalizeNullableScore(
snapshot.buy_pressure_score,
snapshot.buy_pressure,
snapshot.buyPressureScore,
snapshot.buy_pressure_strength,
snapshot.buyPressureStrength
),
persistence_score: normalizeNullableScore(
snapshot.persistence_score,
snapshot.persistence,
snapshot.persistenceScore
),
structural_health_score: normalizeNullableScore(
snapshot.structural_health_score,
snapshot.structural_health,
snapshot.market_quality_score,
snapshot.marketQualityScore,
snapshot.structure_score,
snapshot.structuralHealthScore
),
};
}

function normalizeContext(context = {}) {
return {
execution_mode:
resolveExecutionMode(
context.execution_mode,
context.executionMode,
context.mode
) || null,
has_open_position: toBool(
firstDefined(context.has_open_position, context.hasOpenPosition),
false
),
in_cooldown: toBool(
firstDefined(context.in_cooldown, context.inCooldown),
false
),
daily_loss_usd: Math.max(
0,
toFloat(firstDefined(context.daily_loss_usd, context.daily_loss), 0)
),
daily_scout_spend_usd: Math.max(
0,
toFloat(
firstDefined(context.daily_scout_spend_usd, context.daily_scout_spend),
0
)
),
open_positions_count: Math.max(
0,
toInt(
firstDefined(context.open_positions_count, context.openPositionsCount),
0
)
),
hourly_new_entries_count: Math.max(
0,
toInt(
firstDefined(
context.hourly_new_entries_count,
context.hourlyNewEntriesCount
),
0
)
),
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

function getTokenLookupKey(snapshot = {}) {
return cleanText(
firstDefined(snapshot.token_id, snapshot.mint_address, snapshot.mint),
255
);
}

function getMetricValueForGate(value, paperMode = false) {
if (value != null) return value;
return paperMode ? 50 : 0;
}

function getMissingMetrics(snapshot = {}) {
const missing = [];

if (snapshot.seller_exhaustion_score == null) {
missing.push("seller_exhaustion_score");
}
if (snapshot.reclaim_strength_score == null) {
missing.push("reclaim_strength_score");
}
if (snapshot.buy_pressure_score == null) {
missing.push("buy_pressure_score");
}
if (snapshot.persistence_score == null) {
missing.push("persistence_score");
}
if (snapshot.structural_health_score == null) {
missing.push("structural_health_score");
}

return missing;
}

export function getScoutReasonCodes() {
return Array.from(SCOUT_REASON_SET);
}

export function isScoutReason(code) {
return SCOUT_REASON_SET.has(cleanText(code, 128));
}

export function filterScoutReasons(reasonCodes = []) {
return ensureReasonCodeArray(reasonCodes).filter((code) =>
isScoutReason(code)
);
}

export function getScoutThresholds(config = {}, runtime = {}) {
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

scout_usd: safe.scout_usd,
max_daily_loss_usd: safe.max_daily_loss_usd,
max_daily_scout_spend_usd: safe.max_daily_scout_spend_usd,
max_open_positions: safe.max_open_positions,
max_tokens_per_hour: safe.max_tokens_per_hour,

min_seller_exhaustion_score: paperMode ? 40 : 55,
min_reclaim_strength_score: paperMode
? Math.min(safe.min_reclaim_strength_score, 45)
: safe.min_reclaim_strength_score,
min_buy_pressure_score: paperMode
? Math.min(safe.min_buy_pressure_score, 45)
: safe.min_buy_pressure_score,
min_persistence_score: paperMode
? Math.min(safe.min_persistence_score, 40)
: safe.min_persistence_score,
min_structural_health_score: paperMode
? Math.min(safe.min_post_entry_health_score, 40)
: safe.min_post_entry_health_score,
};
}

export function evaluateScoutEntrySync(snapshot = {}, config = {}, context = {}) {
const safeSnapshot = normalizeSnapshot(snapshot || {});
const safeContext = normalizeContext(context || {});

const executionMode =
safeContext.execution_mode ||
safeSnapshot.execution_mode ||
resolveExecutionMode(config?.execution_mode) ||
"paper";

const safeConfig = getEffectiveSentinelConfig(
normalizeSentinelConfig({
...(config || {}),
execution_mode: executionMode,
})
);

const thresholds = getScoutThresholds(safeConfig, {
execution_mode: executionMode,
});

if (!safeConfig.enable_scout) {
return {
allow: false,
decision: "watchlist",
reasons: [REASON_CODE.SCOUT_DISABLED],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
checks: [],
thresholds,
size_usd: thresholds.scout_usd,
meta: {
scout_enabled: false,
execution_mode: executionMode,
paper_mode_relaxed: Boolean(thresholds.paper_mode_relaxed),
recommended_size_usd: thresholds.scout_usd,
token_lookup_key: getTokenLookupKey(safeSnapshot),
missing_metrics: getMissingMetrics(safeSnapshot),
total_check_count: 0,
rejected_check_count: 1,
},
};
}

const paperMode = Boolean(thresholds.paper_mode_relaxed);
const sellerExhaustionScore = getMetricValueForGate(
safeSnapshot.seller_exhaustion_score,
paperMode
);
const reclaimStrengthScore = getMetricValueForGate(
safeSnapshot.reclaim_strength_score,
paperMode
);
const buyPressureScore = getMetricValueForGate(
safeSnapshot.buy_pressure_score,
paperMode
);
const persistenceScore = getMetricValueForGate(
safeSnapshot.persistence_score,
paperMode
);
const structuralHealthScore = getMetricValueForGate(
safeSnapshot.structural_health_score,
paperMode
);

const checks = [
buildCheck(
REASON_CODE.POSITION_ALREADY_OPEN,
safeContext.has_open_position,
false,
"===",
safeContext.has_open_position === true
),
buildCheck(
REASON_CODE.TOKEN_IN_COOLDOWN,
safeContext.in_cooldown,
false,
"===",
safeContext.in_cooldown === true
),
buildCheck(
REASON_CODE.DAILY_LOSS_LIMIT_HIT,
safeContext.daily_loss_usd,
thresholds.max_daily_loss_usd,
">=",
safeContext.daily_loss_usd >= thresholds.max_daily_loss_usd
),
buildCheck(
REASON_CODE.DAILY_SCOUT_BUDGET_HIT,
safeContext.daily_scout_spend_usd,
thresholds.max_daily_scout_spend_usd,
">=",
safeContext.daily_scout_spend_usd >= thresholds.max_daily_scout_spend_usd
),
buildCheck(
REASON_CODE.MAX_OPEN_POSITIONS_HIT,
safeContext.open_positions_count,
thresholds.max_open_positions,
">=",
safeContext.open_positions_count >= thresholds.max_open_positions
),
buildCheck(
REASON_CODE.MAX_TOKENS_PER_HOUR_HIT,
safeContext.hourly_new_entries_count,
thresholds.max_tokens_per_hour,
">=",
safeContext.hourly_new_entries_count >= thresholds.max_tokens_per_hour
),
buildCheck(
REASON_CODE.SELLER_EXHAUSTION_NOT_STRONG_ENOUGH,
sellerExhaustionScore,
thresholds.min_seller_exhaustion_score,
"<",
sellerExhaustionScore < thresholds.min_seller_exhaustion_score
),
buildCheck(
REASON_CODE.RECLAIM_TOO_WEAK,
reclaimStrengthScore,
thresholds.min_reclaim_strength_score,
"<",
reclaimStrengthScore < thresholds.min_reclaim_strength_score
),
buildCheck(
REASON_CODE.BUY_PRESSURE_TOO_WEAK,
buyPressureScore,
thresholds.min_buy_pressure_score,
"<",
buyPressureScore < thresholds.min_buy_pressure_score
),
buildCheck(
REASON_CODE.PERSISTENCE_TOO_WEAK,
persistenceScore,
thresholds.min_persistence_score,
"<",
persistenceScore < thresholds.min_persistence_score
),
buildCheck(
REASON_CODE.STRUCTURE_NOT_READY,
structuralHealthScore,
thresholds.min_structural_health_score,
"<",
structuralHealthScore < thresholds.min_structural_health_score
),
];

const reasons = collectRejectedReasons(checks);

return {
allow: reasons.length === 0,
decision: reasons.length === 0 ? "scout_entry" : "watchlist",
reasons: reasons.length ? reasons : [REASON_CODE.SCOUT_ENTRY_APPROVED],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
checks,
thresholds,
size_usd: thresholds.scout_usd,
meta: {
scout_enabled: true,
execution_mode: executionMode,
paper_mode_relaxed: paperMode,
recommended_size_usd: thresholds.scout_usd,
total_check_count: checks.length,
rejected_check_count: reasons.length,
token_lookup_key: getTokenLookupKey(safeSnapshot),
missing_metrics: getMissingMetrics(safeSnapshot),
context: safeContext,
},
};
}

async function countRecentScoutEntries(executionMode = null, lookbackMinutes = 60) {
const minutes = Math.max(1, Math.min(1440, toInt(lookbackMinutes, 60)));
const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();

const row = executionMode
? await db.get(
`
SELECT COUNT(*) AS count
FROM cassie_sentinel_positions
WHERE execution_mode = ?
AND opened_at >= ?
`,
[cleanText(executionMode, 64), since]
)
: await db.get(
`
SELECT COUNT(*) AS count
FROM cassie_sentinel_positions
WHERE opened_at >= ?
`,
[since]
);

return Math.max(0, toInt(row?.count, 0));
}

export async function evaluateScoutEntry(snapshot = {}, config = {}, context = {}) {
const safeSnapshot = normalizeSnapshot(snapshot || {});
const safeContext = normalizeContext(context || {});
const safeConfig = getEffectiveSentinelConfig(
normalizeSentinelConfig(config || {})
);

const executionMode =
safeContext.execution_mode ||
safeSnapshot.execution_mode ||
cleanText(safeConfig.execution_mode, 64) ||
"paper";

const tokenLookupKey = getTokenLookupKey(safeSnapshot);

const hasOpenPosition =
context?.has_open_position != null || context?.hasOpenPosition != null
? safeContext.has_open_position
: Boolean(
tokenLookupKey
? await getOpenPositionByToken(tokenLookupKey, executionMode)
: false
);

const inCooldown =
context?.in_cooldown != null || context?.inCooldown != null
? safeContext.in_cooldown
: Boolean(tokenLookupKey ? await isTokenInCooldown(tokenLookupKey) : false);

const dailyStats =
context?.daily_loss_usd != null ||
context?.daily_loss != null ||
context?.daily_scout_spend_usd != null ||
context?.daily_scout_spend != null
? {
daily_loss_usd: safeContext.daily_loss_usd,
daily_scout_spend_usd: safeContext.daily_scout_spend_usd,
}
: await getDailyStats(executionMode);

const openPositionsCount =
context?.open_positions_count != null || context?.openPositionsCount != null
? safeContext.open_positions_count
: await countOpenPositions(executionMode);

const hourlyNewEntriesCount =
context?.hourly_new_entries_count != null ||
context?.hourlyNewEntriesCount != null
? safeContext.hourly_new_entries_count
: await countRecentScoutEntries(executionMode, 60);

return evaluateScoutEntrySync(
{
...safeSnapshot,
execution_mode: executionMode,
},
{
...safeConfig,
execution_mode: executionMode,
},
{
execution_mode: executionMode,
has_open_position: hasOpenPosition,
in_cooldown: inCooldown,
daily_loss_usd: toFloat(
firstDefined(dailyStats?.daily_loss_usd, dailyStats?.daily_loss),
0
),
daily_scout_spend_usd: toFloat(
firstDefined(
dailyStats?.daily_scout_spend_usd,
dailyStats?.daily_scout_spend
),
0
),
open_positions_count: openPositionsCount,
hourly_new_entries_count: hourlyNewEntriesCount,
}
);
}

export async function shouldOpenScout(snapshot = {}, config = {}, context = {}) {
const result = await evaluateScoutEntry(snapshot, config, context);
return Boolean(result.allow);
}

export function summarizeScoutEntry(result = null) {
if (!result) {
return {
allow: false,
decision: "watchlist",
reasons: [],
recommended_size_usd: 0,
rejected_check_count: 0,
total_check_count: 0,
execution_mode: null,
paper_mode_relaxed: false,
missing_metrics: [],
};
}

return {
allow: Boolean(result.allow),
decision: cleanText(result.decision, 64) || "watchlist",
reasons: ensureReasonCodeArray(result.reasons || []),
recommended_size_usd: toFloat(result.size_usd, 0),
rejected_check_count: toInt(result?.meta?.rejected_check_count, 0),
total_check_count: toInt(result?.meta?.total_check_count, 0),
execution_mode: cleanText(result?.meta?.execution_mode, 64) || null,
paper_mode_relaxed: Boolean(result?.meta?.paper_mode_relaxed),
missing_metrics: Array.isArray(result?.meta?.missing_metrics)
? result.meta.missing_metrics
: [],
};
}

export default {
getScoutReasonCodes,
isScoutReason,
filterScoutReasons,
getScoutThresholds,
evaluateScoutEntrySync,
evaluateScoutEntry,
shouldOpenScout,
summarizeScoutEntry,
};
