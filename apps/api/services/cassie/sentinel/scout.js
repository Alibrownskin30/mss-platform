import db from "../../../db/index.js";
import { getEffectiveSentinelConfig, normalizeSentinelConfig } from "./config.js";
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

function normalizeSnapshot(snapshot = {}) {
return {
token_id: cleanText(snapshot.token_id, 255),
mint_address: cleanText(snapshot.mint_address, 255),
linked_operator_cluster_id: cleanText(snapshot.linked_operator_cluster_id, 255),

seller_exhaustion_score: clamp(snapshot.seller_exhaustion_score, 0, 100),
reclaim_strength_score: clamp(snapshot.reclaim_strength_score, 0, 100),
buy_pressure_score: clamp(snapshot.buy_pressure_score, 0, 100),
persistence_score: clamp(snapshot.persistence_score, 0, 100),
structural_health_score: clamp(snapshot.structural_health_score, 0, 100),
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

function normalizeContext(context = {}) {
return {
execution_mode: cleanText(context.execution_mode, 64) || null,
has_open_position: Boolean(context.has_open_position),
in_cooldown: Boolean(context.in_cooldown),
daily_loss_usd: Math.max(0, toFloat(context.daily_loss_usd, 0)),
daily_scout_spend_usd: Math.max(0, toFloat(context.daily_scout_spend_usd, 0)),
open_positions_count: Math.max(0, toInt(context.open_positions_count, 0)),
hourly_new_entries_count: Math.max(0, toInt(context.hourly_new_entries_count, 0)),
};
}

export function getScoutReasonCodes() {
return Array.from(SCOUT_REASON_SET);
}

export function isScoutReason(code) {
return SCOUT_REASON_SET.has(cleanText(code, 128));
}

export function filterScoutReasons(reasonCodes = []) {
return ensureReasonCodeArray(reasonCodes).filter((code) => isScoutReason(code));
}

export function getScoutThresholds(config = {}) {
const safe = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
return {
scout_usd: safe.scout_usd,
max_daily_loss_usd: safe.max_daily_loss_usd,
max_daily_scout_spend_usd: safe.max_daily_scout_spend_usd,
max_open_positions: safe.max_open_positions,
max_tokens_per_hour: safe.max_tokens_per_hour,

min_seller_exhaustion_score: 55,
min_reclaim_strength_score: safe.min_reclaim_strength_score,
min_buy_pressure_score: safe.min_buy_pressure_score,
min_persistence_score: safe.min_persistence_score,
min_structural_health_score: safe.min_post_entry_health_score,
};
}

export function evaluateScoutEntrySync(
snapshot = {},
config = {},
context = {}
) {
const safeConfig = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
const safeSnapshot = normalizeSnapshot(snapshot || {});
const safeContext = normalizeContext(context || {});
const thresholds = getScoutThresholds(safeConfig);

if (!safeConfig.enable_scout) {
return {
allow: false,
decision: "watchlist",
reasons: [REASON_CODE.SCOUT_DISABLED],
snapshot: safeSnapshot,
checks: [],
thresholds,
meta: {
scout_enabled: false,
recommended_size_usd: thresholds.scout_usd,
},
};
}

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
safeSnapshot.seller_exhaustion_score,
thresholds.min_seller_exhaustion_score,
"<",
safeSnapshot.seller_exhaustion_score < thresholds.min_seller_exhaustion_score
),
buildCheck(
REASON_CODE.RECLAIM_TOO_WEAK,
safeSnapshot.reclaim_strength_score,
thresholds.min_reclaim_strength_score,
"<",
safeSnapshot.reclaim_strength_score < thresholds.min_reclaim_strength_score
),
buildCheck(
REASON_CODE.BUY_PRESSURE_TOO_WEAK,
safeSnapshot.buy_pressure_score,
thresholds.min_buy_pressure_score,
"<",
safeSnapshot.buy_pressure_score < thresholds.min_buy_pressure_score
),
buildCheck(
REASON_CODE.PERSISTENCE_TOO_WEAK,
safeSnapshot.persistence_score,
thresholds.min_persistence_score,
"<",
safeSnapshot.persistence_score < thresholds.min_persistence_score
),
buildCheck(
REASON_CODE.STRUCTURE_NOT_READY,
safeSnapshot.structural_health_score,
thresholds.min_structural_health_score,
"<",
safeSnapshot.structural_health_score < thresholds.min_structural_health_score
),
];

const reasons = collectRejectedReasons(checks);

return {
allow: reasons.length === 0,
decision: reasons.length === 0 ? "scout_entry" : "watchlist",
reasons: reasons.length ? reasons : [REASON_CODE.SCOUT_ENTRY_APPROVED],
snapshot: safeSnapshot,
checks,
thresholds,
size_usd: thresholds.scout_usd,
meta: {
scout_enabled: true,
recommended_size_usd: thresholds.scout_usd,
total_check_count: checks.length,
rejected_check_count: reasons.length,
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

export async function evaluateScoutEntry(
snapshot = {},
config = {},
context = {}
) {
const safeConfig = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
const safeSnapshot = normalizeSnapshot(snapshot || {});
const executionMode =
cleanText(context?.execution_mode, 64) ||
cleanText(safeConfig.execution_mode, 64) ||
"paper";

const openPosition =
context?.has_open_position != null
? context.has_open_position
: Boolean(
safeSnapshot.token_id
? await getOpenPositionByToken(safeSnapshot.token_id, executionMode)
: false
);

const inCooldown =
context?.in_cooldown != null
? Boolean(context.in_cooldown)
: safeSnapshot.token_id
? await isTokenInCooldown(safeSnapshot.token_id)
: false;

const dailyStats =
context?.daily_loss_usd != null ||
context?.daily_scout_spend_usd != null
? {
daily_loss_usd: toFloat(context.daily_loss_usd, 0),
daily_scout_spend_usd: toFloat(context.daily_scout_spend_usd, 0),
}
: await getDailyStats(executionMode);

const openPositionsCount =
context?.open_positions_count != null
? toInt(context.open_positions_count, 0)
: await countOpenPositions(executionMode);

const hourlyNewEntriesCount =
context?.hourly_new_entries_count != null
? toInt(context.hourly_new_entries_count, 0)
: await countRecentScoutEntries(executionMode, 60);

return evaluateScoutEntrySync(safeSnapshot, safeConfig, {
execution_mode: executionMode,
has_open_position: openPosition,
in_cooldown: inCooldown,
daily_loss_usd: dailyStats.daily_loss_usd,
daily_scout_spend_usd: dailyStats.daily_scout_spend_usd,
open_positions_count: openPositionsCount,
hourly_new_entries_count: hourlyNewEntriesCount,
});
}

export async function shouldOpenScout(
snapshot = {},
config = {},
context = {}
) {
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
};
}

return {
allow: Boolean(result.allow),
decision: cleanText(result.decision, 64) || "watchlist",
reasons: ensureReasonCodeArray(result.reasons || []),
recommended_size_usd: toFloat(result.size_usd, 0),
rejected_check_count: toInt(result?.meta?.rejected_check_count, 0),
total_check_count: toInt(result?.meta?.total_check_count, 0),
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
