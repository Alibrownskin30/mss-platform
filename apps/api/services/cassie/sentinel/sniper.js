import {
getEffectiveSentinelConfig,
normalizeSentinelConfig,
} from "./config.js";
import { REASON_CODE, ensureReasonCodeArray } from "./reason-codes.js";
import {
getDailyStats,
getPositionById,
getOpenPositionByToken,
} from "./position-store.js";

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

function isPaperMode(executionMode) {
return cleanText(executionMode, 64).toLowerCase() === "paper";
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

reclaim_strength_score: clamp(
firstDefined(
snapshot.reclaim_strength_score,
snapshot.reclaim_strength,
snapshot.reclaimStrengthScore
),
0,
100
),
buy_pressure_score: clamp(
firstDefined(
snapshot.buy_pressure_score,
snapshot.buy_pressure,
snapshot.buyPressureScore
),
0,
100
),
persistence_score: clamp(
firstDefined(
snapshot.persistence_score,
snapshot.persistence,
snapshot.persistenceScore
),
0,
100
),
structural_health_score: clamp(
firstDefined(
snapshot.structural_health_score,
snapshot.structural_health,
snapshot.market_quality_score,
snapshot.structure_score,
snapshot.structuralHealthScore
),
0,
100
),
vertical_extension_score: clamp(
firstDefined(
snapshot.vertical_extension_score,
snapshot.vertical_extension,
snapshot.vertical_extension_risk,
snapshot.verticalExtensionScore
),
0,
100
),
insider_sell_score: clamp(
firstDefined(
snapshot.insider_sell_score,
snapshot.insider_sell_risk,
snapshot.insiderSellScore,
snapshot.insiderSellRisk
),
0,
100
),
liquidity_decay_score: clamp(
firstDefined(
snapshot.liquidity_decay_score,
snapshot.liquidity_decay,
snapshot.liquidity_decay_risk,
snapshot.liquidityDecayScore,
snapshot.liquidityDecayRisk
),
0,
100
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
total_cost_usd: Math.max(0, toFloat(position.total_cost_usd, 0)),
total_size_usd: Math.max(0, toFloat(position.total_size_usd, 0)),
current_value_usd: Math.max(0, toFloat(position.current_value_usd, 0)),
has_banked_10x: Boolean(position.has_banked_10x),
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
position_id: toInt(context.position_id, 0) || null,
daily_sniper_spend_usd: Math.max(
0,
toFloat(
firstDefined(
context.daily_sniper_spend_usd,
context.dailySniperSpendUsd
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

function isValidScoutPosition(position) {
if (!position?.id) return false;
if (position.has_banked_10x) return false;
return cleanText(position.stage, 64) === "scout_open";
}

function getPositionLookupKey(snapshot = {}, position = null) {
return (
cleanText(position?.token_id, 255) ||
cleanText(position?.mint_address, 255) ||
cleanText(snapshot?.token_id, 255) ||
cleanText(snapshot?.mint_address, 255) ||
cleanText(snapshot?.mint, 255) ||
""
);
}

export function getSniperReasonCodes() {
return Array.from(SNIPER_REASON_SET);
}

export function isSniperReason(code) {
return SNIPER_REASON_SET.has(cleanText(code, 128));
}

export function filterSniperReasons(reasonCodes = []) {
return ensureReasonCodeArray(reasonCodes).filter((code) =>
isSniperReason(code)
);
}

export function getSniperThresholds(config = {}, runtime = {}) {
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

sniper_add_usd: safe.sniper_add_usd,
max_total_position_usd: safe.max_total_position_usd,
max_daily_sniper_spend_usd: safe.max_daily_sniper_spend_usd,

min_reclaim_strength_score_for_add: paperMode
? Math.max(55, safe.min_reclaim_strength_score - 5)
: Math.max(65, safe.min_reclaim_strength_score),
min_buy_pressure_score_for_add: paperMode
? Math.max(55, safe.min_buy_pressure_score - 5)
: Math.max(65, safe.min_buy_pressure_score),
min_persistence_score_for_add: paperMode
? Math.max(50, safe.min_persistence_score - 5)
: Math.max(60, safe.min_persistence_score),
min_structural_health_score_for_add: paperMode
? Math.max(50, safe.min_post_entry_health_score - 5)
: Math.max(60, safe.min_post_entry_health_score),

max_vertical_extension_score_for_add: paperMode
? Math.max(safe.max_vertical_extension_score_for_add, 85)
: safe.max_vertical_extension_score_for_add,
max_insider_sell_score: paperMode
? Math.max(safe.max_insider_sell_score, 60)
: safe.max_insider_sell_score,
max_liquidity_decay_score: paperMode
? Math.max(safe.max_liquidity_decay_score, 65)
: safe.max_liquidity_decay_score,
};
}

export function evaluateSniperAddSync(
snapshot = {},
position = null,
config = {},
context = {}
) {
const safeSnapshot = normalizeSnapshot(snapshot || {});
const safePosition = normalizePosition(position || null);
const safeContext = normalizeContext(context || {});

const safeConfig = getEffectiveSentinelConfig(
normalizeSentinelConfig({
...(config || {}),
...(safeContext.execution_mode
? { execution_mode: safeContext.execution_mode }
: {}),
...(safeSnapshot.execution_mode
? { execution_mode: safeSnapshot.execution_mode }
: {}),
...(safePosition?.execution_mode
? { execution_mode: safePosition.execution_mode }
: {}),
})
);

const executionMode =
safeContext.execution_mode ||
safeSnapshot.execution_mode ||
safePosition?.execution_mode ||
safeConfig.execution_mode ||
"paper";

const thresholds = getSniperThresholds(safeConfig, {
execution_mode: executionMode,
});

if (!safeConfig.enable_sniper) {
return {
allow: false,
decision: "hold",
reasons: [REASON_CODE.SNIPER_DISABLED],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
checks: [],
thresholds,
size_usd: thresholds.sniper_add_usd,
meta: {
sniper_enabled: false,
execution_mode: executionMode,
paper_mode_relaxed: Boolean(thresholds.paper_mode_relaxed),
recommended_size_usd: thresholds.sniper_add_usd,
},
};
}

const projectedPositionSize =
Math.max(0, Number(safePosition?.total_size_usd || 0)) +
thresholds.sniper_add_usd;

const validScoutPosition = isValidScoutPosition(safePosition);

const checks = [
buildCheck(
REASON_CODE.NO_VALID_SCOUT_POSITION,
safePosition?.stage || null,
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
safeSnapshot.reclaim_strength_score <
thresholds.min_reclaim_strength_score_for_add
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
safeSnapshot.structural_health_score <
thresholds.min_structural_health_score_for_add
),
buildCheck(
REASON_CODE.TOO_EXTENDED_FOR_ADD,
safeSnapshot.vertical_extension_score,
thresholds.max_vertical_extension_score_for_add,
">",
safeSnapshot.vertical_extension_score >
thresholds.max_vertical_extension_score_for_add
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
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
checks,
thresholds,
size_usd: thresholds.sniper_add_usd,
meta: {
sniper_enabled: true,
execution_mode: executionMode,
paper_mode_relaxed: Boolean(thresholds.paper_mode_relaxed),
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
const safeSnapshot = normalizeSnapshot(snapshot || {});
const safeContext = normalizeContext(context || {});
const safeConfig = getEffectiveSentinelConfig(
normalizeSentinelConfig(config || {})
);

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
const lookupKey = getPositionLookupKey(safeSnapshot, resolvedPosition);
if (lookupKey) {
resolvedPosition = normalizePosition(
await getOpenPositionByToken(lookupKey, executionMode)
);
}
}
}

const dailyStats =
context?.daily_sniper_spend_usd != null
? {
daily_sniper_spend_usd: toFloat(context.daily_sniper_spend_usd, 0),
}
: await getDailyStats(executionMode);

return evaluateSniperAddSync(
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
execution_mode: executionMode,
position_id: safeContext.position_id,
daily_sniper_spend_usd: dailyStats.daily_sniper_spend_usd,
}
);
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
execution_mode: null,
paper_mode_relaxed: false,
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
execution_mode: cleanText(result?.meta?.execution_mode, 64) || null,
paper_mode_relaxed: Boolean(result?.meta?.paper_mode_relaxed),
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
