import { getEffectiveSentinelConfig, normalizeSentinelConfig } from "./config.js";
import { REASON_CODE, ensureReasonCodeArray } from "./reason-codes.js";
import { getDailyStats, getPositionById, getOpenPositionByToken } from "./position-store.js";

const SNIPER_REASON_SET = new Set([
REASON_CODE.SNIPER_DISABLED,
REASON_CODE.NO_VALID_SCOUT_POSITION,
REASON_CODE.DAILY_SNIPER_BUDGET_HIT,
REASON_CODE.MAX_POSITION_SIZE_EXCEEDED,
REASON_CODE.RECLAIM_NOT_CONFIRMED,
REASON_CODE.BUY_PRESSURE_NOT_PERSISTENT,
REASON_CODE.PERSISTENCE_NOT_STRONG_ENOUGH,
REASON_CODE.STRUCTURE_NOT_HEALTHY_ENOUGH,
REASON_CODE.TOO_EXTENDED_FOR_ADD,
REASON_CODE.INSIDER_SELL_RISK_TOO_HIGH,
REASON_CODE.LIQUIDITY_DECAY_TOO_HIGH,
REASON_CODE.SNIPER_ADD_APPROVED,
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

reclaim_strength_score: clamp(snapshot.reclaim_strength_score, 0, 100),
buy_pressure_score: clamp(snapshot.buy_pressure_score, 0, 100),
persistence_score: clamp(snapshot.persistence_score, 0, 100),
structural_health_score: clamp(snapshot.structural_health_score, 0, 100),
vertical_extension_score: clamp(snapshot.vertical_extension_score, 0, 100),
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
total_cost_usd: Math.max(0, toFloat(position.total_cost_usd, 0)),
total_size_usd: Math.max(0, toFloat(position.total_size_usd, 0)),
current_value_usd: Math.max(0, toFloat(position.current_value_usd, 0)),
has_banked_10x: Boolean(position.has_banked_10x),
};
}

function normalizeContext(context = {}) {
return {
execution_mode: cleanText(context.execution_mode, 64) || null,
daily_sniper_spend_usd: Math.max(0, toFloat(context.daily_sniper_spend_usd, 0)),
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

function isValidScoutPosition(position) {
if (!position?.id) return false;
if (position.has_banked_10x) return false;
return cleanText(position.stage, 64) === "scout_open";
}

export function getSniperReasonCodes() {
return Array.from(SNIPER_REASON_SET);
}

export function isSniperReason(code) {
return SNIPER_REASON_SET.has(cleanText(code, 128));
}

export function filterSniperReasons(reasonCodes = []) {
return ensureReasonCodeArray(reasonCodes).filter((code) => isSniperReason(code));
}

export function getSniperThresholds(config = {}) {
const safe = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
return {
sniper_add_usd: safe.sniper_add_usd,
max_total_position_usd: safe.max_total_position_usd,
max_daily_sniper_spend_usd: safe.max_daily_sniper_spend_usd,

min_reclaim_strength_score_for_add: 70,
min_buy_pressure_score_for_add: 70,
min_persistence_score_for_add: 65,
min_structural_health_score_for_add: Math.max(60, safe.min_post_entry_health_score),

max_vertical_extension_score_for_add: safe.max_vertical_extension_score_for_add,
max_insider_sell_score: safe.max_insider_sell_score,
max_liquidity_decay_score: safe.max_liquidity_decay_score,
};
}

export function evaluateSniperAddSync(
snapshot = {},
position = null,
config = {},
context = {}
) {
const safeConfig = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
const safeSnapshot = normalizeSnapshot(snapshot || {});
const safePosition = normalizePosition(position || {});
const safeContext = normalizeContext(context || {});
const thresholds = getSniperThresholds(safeConfig);

if (!safeConfig.enable_sniper) {
return {
allow: false,
decision: "hold",
reasons: [REASON_CODE.SNIPER_DISABLED],
snapshot: safeSnapshot,
position: safePosition,
checks: [],
thresholds,
size_usd: thresholds.sniper_add_usd,
meta: {
sniper_enabled: false,
recommended_size_usd: thresholds.sniper_add_usd,
},
};
}

const projectedPositionSize = safePosition.total_size_usd + thresholds.sniper_add_usd;
const validScoutPosition = isValidScoutPosition(safePosition);

const checks = [
buildCheck(
REASON_CODE.NO_VALID_SCOUT_POSITION,
safePosition.stage || null,
"scout_open",
"===",
!validScoutPosition
),
buildCheck(
REASON_CODE.DAILY_SNIPER_BUDGET_HIT,
safeContext.daily_sniper_spend_usd,
thresholds.max_daily_sniper_spend_usd,
">=",
safeContext.daily_sniper_spend_usd >= thresholds.max_daily_sniper_spend_usd
),
buildCheck(
REASON_CODE.MAX_POSITION_SIZE_EXCEEDED,
projectedPositionSize,
thresholds.max_total_position_usd,
">",
projectedPositionSize > thresholds.max_total_position_usd
),
buildCheck(
REASON_CODE.RECLAIM_NOT_CONFIRMED,
safeSnapshot.reclaim_strength_score,
thresholds.min_reclaim_strength_score_for_add,
"<",
safeSnapshot.reclaim_strength_score < thresholds.min_reclaim_strength_score_for_add
),
buildCheck(
REASON_CODE.BUY_PRESSURE_NOT_PERSISTENT,
safeSnapshot.buy_pressure_score,
thresholds.min_buy_pressure_score_for_add,
"<",
safeSnapshot.buy_pressure_score < thresholds.min_buy_pressure_score_for_add
),
buildCheck(
REASON_CODE.PERSISTENCE_NOT_STRONG_ENOUGH,
safeSnapshot.persistence_score,
thresholds.min_persistence_score_for_add,
"<",
safeSnapshot.persistence_score < thresholds.min_persistence_score_for_add
),
buildCheck(
REASON_CODE.STRUCTURE_NOT_HEALTHY_ENOUGH,
safeSnapshot.structural_health_score,
thresholds.min_structural_health_score_for_add,
"<",
safeSnapshot.structural_health_score < thresholds.min_structural_health_score_for_add
),
buildCheck(
REASON_CODE.TOO_EXTENDED_FOR_ADD,
safeSnapshot.vertical_extension_score,
thresholds.max_vertical_extension_score_for_add,
">",
safeSnapshot.vertical_extension_score > thresholds.max_vertical_extension_score_for_add
),
buildCheck(
REASON_CODE.INSIDER_SELL_RISK_TOO_HIGH,
safeSnapshot.insider_sell_score,
thresholds.max_insider_sell_score,
">",
safeSnapshot.insider_sell_score > thresholds.max_insider_sell_score
),
buildCheck(
REASON_CODE.LIQUIDITY_DECAY_TOO_HIGH,
safeSnapshot.liquidity_decay_score,
thresholds.max_liquidity_decay_score,
">",
safeSnapshot.liquidity_decay_score > thresholds.max_liquidity_decay_score
),
];

const reasons = collectRejectedReasons(checks);

return {
allow: reasons.length === 0,
decision: reasons.length === 0 ? "sniper_add" : "hold",
reasons: reasons.length ? reasons : [REASON_CODE.SNIPER_ADD_APPROVED],
snapshot: safeSnapshot,
position: safePosition,
checks,
thresholds,
size_usd: thresholds.sniper_add_usd,
meta: {
sniper_enabled: true,
recommended_size_usd: thresholds.sniper_add_usd,
projected_position_size_usd: projectedPositionSize,
total_check_count: checks.length,
rejected_check_count: reasons.length,
context: safeContext,
},
};
}

export async function evaluateSniperAdd(
snapshot = {},
position = null,
config = {},
context = {}
) {
const safeConfig = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
const safeSnapshot = normalizeSnapshot(snapshot || {});
const safeContext = normalizeContext(context || {});
const executionMode =
safeContext.execution_mode ||
cleanText(position?.execution_mode, 64) ||
cleanText(safeConfig.execution_mode, 64) ||
"paper";

let resolvedPosition = position ? normalizePosition(position) : null;

if (!resolvedPosition?.id) {
if (context?.position_id) {
resolvedPosition = normalizePosition(await getPositionById(context.position_id));
} else if (safeSnapshot.token_id) {
resolvedPosition = normalizePosition(
await getOpenPositionByToken(safeSnapshot.token_id, executionMode)
);
}
}

const dailyStats =
context?.daily_sniper_spend_usd != null
? {
daily_sniper_spend_usd: toFloat(context.daily_sniper_spend_usd, 0),
}
: await getDailyStats(executionMode);

return evaluateSniperAddSync(safeSnapshot, resolvedPosition, safeConfig, {
execution_mode: executionMode,
daily_sniper_spend_usd: dailyStats.daily_sniper_spend_usd,
});
}

export async function shouldAddSniper(
snapshot = {},
position = null,
config = {},
context = {}
) {
const result = await evaluateSniperAdd(snapshot, position, config, context);
return Boolean(result.allow);
}

export function summarizeSniperAdd(result = null) {
if (!result) {
return {
allow: false,
decision: "hold",
reasons: [],
recommended_size_usd: 0,
projected_position_size_usd: 0,
rejected_check_count: 0,
total_check_count: 0,
};
}

return {
allow: Boolean(result.allow),
decision: cleanText(result.decision, 64) || "hold",
reasons: ensureReasonCodeArray(result.reasons || []),
recommended_size_usd: toFloat(result.size_usd, 0),
projected_position_size_usd: toFloat(
result?.meta?.projected_position_size_usd,
0
),
rejected_check_count: toInt(result?.meta?.rejected_check_count, 0),
total_check_count: toInt(result?.meta?.total_check_count, 0),
};
}

export default {
getSniperReasonCodes,
isSniperReason,
filterSniperReasons,
getSniperThresholds,
evaluateSniperAddSync,
evaluateSniperAdd,
shouldAddSniper,
summarizeSniperAdd,
};
