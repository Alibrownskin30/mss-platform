import db from "../../../db/index.js";
import { SENTINEL_MODE } from "./config.js";
import { REASON_CODE, ensureReasonCodeArray } from "./reason-codes.js";

const OPEN_STAGES = new Set([
"scout_open",
"sniper_added",
"half_banked_at_10x",
"runner_only",
]);

const CLOSED_STAGES = new Set(["closed", "invalidated"]);

const INVALIDATION_REASONS = new Set([
REASON_CODE.EARLY_RECLAIM_FAILED,
REASON_CODE.WEAK_STALL_NO_BUYERS,
REASON_CODE.INSIDER_DUMP_DETECTED,
REASON_CODE.LIQUIDITY_BREAK_DETECTED,
REASON_CODE.STRUCTURAL_HEALTH_COLLAPSED,
REASON_CODE.INVALIDATION_EXIT,
]);

function todayUtcDate() {
return new Date().toISOString().slice(0, 10);
}

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

function toBool(value, fallback = false) {
if (typeof value === "boolean") return value;
if (value === 1 || value === "1" || value === "true") return true;
if (value === 0 || value === "0" || value === "false") return false;
return fallback;
}

function safeJsonParse(value, fallback = null) {
if (!value) return fallback;
if (typeof value === "object") return value;

try {
return JSON.parse(value);
} catch {
return fallback;
}
}

function getInsertId(result) {
const candidate =
result?.lastID ??
result?.lastId ??
result?.lastInsertRowid ??
result?.insertId ??
null;

const id = Number(candidate);
return Number.isFinite(id) && id > 0 ? id : null;
}

function normalizeExecutionMode(value, fallback = SENTINEL_MODE.PAPER) {
const mode = cleanText(value, 64).toLowerCase();
return mode || fallback;
}

function normalizeTokenPair(tokenId, mintAddress) {
const safeTokenId = cleanText(tokenId, 255);
const safeMintAddress = cleanText(mintAddress, 255);

return {
token_id: safeTokenId || safeMintAddress || "",
mint_address: safeMintAddress || safeTokenId || "",
};
}

function getTokenLookupValue(tokenIdOrMint) {
return cleanText(tokenIdOrMint, 255);
}

function getRemainingCostBasisUsd(position) {
if (!position) return 0;

const units = Math.max(0, toFloat(position.units, 0));
const avgEntryPrice =
position.avg_entry_price == null
? null
: Math.max(0, toFloat(position.avg_entry_price, 0));

if (units > 0 && avgEntryPrice != null) {
return Math.max(0, units * avgEntryPrice);
}

const currentValueUsd = Math.max(0, toFloat(position.current_value_usd, 0));
const unrealizedPnlUsd = toFloat(position.unrealized_pnl_usd, 0);
const derived = currentValueUsd - unrealizedPnlUsd;

if (Number.isFinite(derived) && derived >= 0) {
return derived;
}

if (position.has_banked_10x) {
return Math.max(0, toFloat(position.total_cost_usd, 0) * 0.5);
}

return Math.max(0, toFloat(position.total_cost_usd, 0));
}

function serializePosition(row) {
if (!row) return null;

const position = {
id: row.id,
token_id: row.token_id,
mint_address: row.mint_address,
linked_operator_cluster_id: row.linked_operator_cluster_id,
stage: row.stage,
execution_mode: row.execution_mode,
total_cost_usd: toFloat(row.total_cost_usd),
total_size_usd: toFloat(row.total_size_usd),
current_value_usd: toFloat(row.current_value_usd),
units: toFloat(row.units),
avg_entry_price:
row.avg_entry_price == null ? null : toFloat(row.avg_entry_price),
avg_exit_price:
row.avg_exit_price == null ? null : toFloat(row.avg_exit_price),
realized_pnl_usd: toFloat(row.realized_pnl_usd),
unrealized_pnl_usd: toFloat(row.unrealized_pnl_usd),
has_banked_10x: toBool(row.has_banked_10x, false),
banked_10x_at: row.banked_10x_at || null,
runner_started_at: row.runner_started_at || null,
open_reason_codes: safeJsonParse(row.open_reason_codes, []),
close_reason_codes: safeJsonParse(row.close_reason_codes, []),
opened_at: row.opened_at || null,
closed_at: row.closed_at || null,
invalidated_at: row.invalidated_at || null,
tx_open_ref: row.tx_open_ref || null,
tx_add_ref: row.tx_add_ref || null,
tx_bank_ref: row.tx_bank_ref || null,
tx_close_ref: row.tx_close_ref || null,
};

return {
...position,
remaining_cost_basis_usd: getRemainingCostBasisUsd(position),
};
}

function getClosedStage(reasonCodes = []) {
const codes = ensureReasonCodeArray(reasonCodes);
return codes.some((code) => INVALIDATION_REASONS.has(code))
? "invalidated"
: "closed";
}

export function isOpenStage(stage) {
return OPEN_STAGES.has(cleanText(stage, 64));
}

export function isClosedStage(stage) {
return CLOSED_STAGES.has(cleanText(stage, 64));
}

export async function getPositionById(positionId) {
const id = toInt(positionId, 0);
if (!id) return null;

const row = await db.get(
`SELECT * FROM cassie_sentinel_positions WHERE id = ? LIMIT 1`,
[id]
);

return serializePosition(row);
}

export async function getOpenPositionByToken(tokenIdOrMint, executionMode = null) {
const lookup = getTokenLookupValue(tokenIdOrMint);
if (!lookup) return null;

const safeMode = executionMode ? normalizeExecutionMode(executionMode, "") : null;
let row;

if (safeMode) {
row = await db.get(
`
SELECT *
FROM cassie_sentinel_positions
WHERE (token_id = ? OR mint_address = ?)
AND execution_mode = ?
AND stage IN ('scout_open', 'sniper_added', 'half_banked_at_10x', 'runner_only')
ORDER BY datetime(opened_at) DESC, id DESC
LIMIT 1
`,
[lookup, lookup, safeMode]
);
} else {
row = await db.get(
`
SELECT *
FROM cassie_sentinel_positions
WHERE (token_id = ? OR mint_address = ?)
AND stage IN ('scout_open', 'sniper_added', 'half_banked_at_10x', 'runner_only')
ORDER BY datetime(opened_at) DESC, id DESC
LIMIT 1
`,
[lookup, lookup]
);
}

return serializePosition(row);
}

export async function listOpenPositions(executionMode = null, limit = 200) {
const safeLimit = Math.max(1, Math.min(1000, toInt(limit, 200)));
const safeMode = executionMode ? normalizeExecutionMode(executionMode, "") : null;
let rows;

if (safeMode) {
rows = await db.all(
`
SELECT *
FROM cassie_sentinel_positions
WHERE execution_mode = ?
AND stage IN ('scout_open', 'sniper_added', 'half_banked_at_10x', 'runner_only')
ORDER BY datetime(opened_at) DESC, id DESC
LIMIT ?
`,
[safeMode, safeLimit]
);
} else {
rows = await db.all(
`
SELECT *
FROM cassie_sentinel_positions
WHERE stage IN ('scout_open', 'sniper_added', 'half_banked_at_10x', 'runner_only')
ORDER BY datetime(opened_at) DESC, id DESC
LIMIT ?
`,
[safeLimit]
);
}

return rows.map(serializePosition);
}

export async function countOpenPositions(executionMode = null) {
const safeMode = executionMode ? normalizeExecutionMode(executionMode, "") : null;

const row = safeMode
? await db.get(
`
SELECT COUNT(*) AS count
FROM cassie_sentinel_positions
WHERE execution_mode = ?
AND stage IN ('scout_open', 'sniper_added', 'half_banked_at_10x', 'runner_only')
`,
[safeMode]
)
: await db.get(
`
SELECT COUNT(*) AS count
FROM cassie_sentinel_positions
WHERE stage IN ('scout_open', 'sniper_added', 'half_banked_at_10x', 'runner_only')
`
);

return toInt(row?.count, 0);
}

export async function countOpenPositionsForOperatorCluster(
linkedOperatorClusterId,
executionMode = null
) {
const clusterId = cleanText(linkedOperatorClusterId, 255);
if (!clusterId) return 0;

const safeMode = executionMode ? normalizeExecutionMode(executionMode, "") : null;

const row = safeMode
? await db.get(
`
SELECT COUNT(*) AS count
FROM cassie_sentinel_positions
WHERE linked_operator_cluster_id = ?
AND execution_mode = ?
AND stage IN ('scout_open', 'sniper_added', 'half_banked_at_10x', 'runner_only')
`,
[clusterId, safeMode]
)
: await db.get(
`
SELECT COUNT(*) AS count
FROM cassie_sentinel_positions
WHERE linked_operator_cluster_id = ?
AND stage IN ('scout_open', 'sniper_added', 'half_banked_at_10x', 'runner_only')
`,
[clusterId]
);

return toInt(row?.count, 0);
}

export async function countRecentOpenedPositions(
executionMode = null,
lookbackMinutes = 60
) {
const minutes = Math.max(1, Math.min(1440, toInt(lookbackMinutes, 60)));
const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
const safeMode = executionMode ? normalizeExecutionMode(executionMode, "") : null;

const row = safeMode
? await db.get(
`
SELECT COUNT(*) AS count
FROM cassie_sentinel_positions
WHERE execution_mode = ?
AND opened_at >= ?
`,
[safeMode, since]
)
: await db.get(
`
SELECT COUNT(*) AS count
FROM cassie_sentinel_positions
WHERE opened_at >= ?
`,
[since]
);

return toInt(row?.count, 0);
}

export async function createScoutPosition({
token_id,
mint_address,
linked_operator_cluster_id = null,
execution_mode = SENTINEL_MODE.PAPER,
size_usd = 0,
units = 0,
avg_entry_price = null,
current_value_usd = null,
entry_reason_codes = [REASON_CODE.SCOUT_ENTRY_APPROVED],
tx_open_ref = null,
}) {
const normalized = normalizeTokenPair(token_id, mint_address);
const tokenId = normalized.token_id;
const mintAddress = normalized.mint_address;

if (!tokenId) {
throw new Error(
"token_id or mint_address is required to create a Sentinel scout position."
);
}

const costUsd = Math.max(0, toFloat(size_usd, 0));
const safeUnits = Math.max(0, toFloat(units, 0));
const entryPrice =
avg_entry_price == null ? null : Math.max(0, toFloat(avg_entry_price, 0));
const currentValue =
current_value_usd == null
? costUsd
: Math.max(0, toFloat(current_value_usd, costUsd));

const result = await db.run(
`
INSERT INTO cassie_sentinel_positions (
token_id,
mint_address,
linked_operator_cluster_id,
stage,
execution_mode,
total_cost_usd,
total_size_usd,
current_value_usd,
units,
avg_entry_price,
avg_exit_price,
realized_pnl_usd,
unrealized_pnl_usd,
has_banked_10x,
open_reason_codes,
tx_open_ref,
opened_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`,
[
tokenId,
mintAddress,
cleanText(linked_operator_cluster_id, 255) || null,
"scout_open",
normalizeExecutionMode(execution_mode),
costUsd,
costUsd,
currentValue,
safeUnits,
entryPrice,
null,
0,
currentValue - costUsd,
0,
JSON.stringify(
ensureReasonCodeArray(entry_reason_codes, [REASON_CODE.SCOUT_ENTRY_APPROVED])
),
cleanText(tx_open_ref, 255) || null,
]
);

const positionId = getInsertId(result);
return positionId
? getPositionById(positionId)
: getOpenPositionByToken(tokenId, execution_mode);
}

export async function addSniperToPosition(
positionId,
{
add_size_usd = 0,
add_units = 0,
add_avg_entry_price = null,
current_value_usd = null,
tx_add_ref = null,
} = {}
) {
const position = await getPositionById(positionId);
if (!position) {
throw new Error("Sentinel position not found for sniper add.");
}

if (!isOpenStage(position.stage)) {
throw new Error("Cannot add sniper size to a closed Sentinel position.");
}

if (position.has_banked_10x) {
throw new Error("Cannot add sniper size after 10x banking has started.");
}

const addSizeUsd = Math.max(0, toFloat(add_size_usd, 0));
const addUnits = Math.max(0, toFloat(add_units, 0));
const addEntryPrice =
add_avg_entry_price == null
? null
: Math.max(0, toFloat(add_avg_entry_price, 0));

const newTotalCostUsd = position.total_cost_usd + addSizeUsd;
const newTotalSizeUsd = position.total_size_usd + addSizeUsd;
const newUnits = position.units + addUnits;

let nextAvgEntryPrice = position.avg_entry_price;
if (newUnits > 0) {
if (position.avg_entry_price != null && addEntryPrice != null) {
nextAvgEntryPrice =
(position.avg_entry_price * position.units + addEntryPrice * addUnits) /
newUnits;
} else if (position.avg_entry_price == null && addEntryPrice != null) {
nextAvgEntryPrice = addEntryPrice;
}
}

const nextCurrentValue =
current_value_usd == null
? position.current_value_usd + addSizeUsd
: Math.max(0, toFloat(current_value_usd, 0));

await db.run(
`
UPDATE cassie_sentinel_positions
SET
stage = 'sniper_added',
total_cost_usd = ?,
total_size_usd = ?,
current_value_usd = ?,
units = ?,
avg_entry_price = ?,
unrealized_pnl_usd = ?,
tx_add_ref = ?,
closed_at = NULL,
invalidated_at = NULL
WHERE id = ?
`,
[
newTotalCostUsd,
newTotalSizeUsd,
nextCurrentValue,
newUnits,
nextAvgEntryPrice,
nextCurrentValue - newTotalCostUsd,
cleanText(tx_add_ref, 255) || position.tx_add_ref || null,
position.id,
]
);

await incrementDailyStats(position.execution_mode, {
sniper_adds: 1,
daily_sniper_spend_usd: addSizeUsd,
});

return getPositionById(position.id);
}

export async function refreshPositionMarketValue(
positionId,
{ current_value_usd = null, units = null, avg_exit_price = null } = {}
) {
const position = await getPositionById(positionId);
if (!position) {
throw new Error("Sentinel position not found for market refresh.");
}

if (isClosedStage(position.stage)) {
return position;
}

const nextCurrentValue =
current_value_usd == null
? position.current_value_usd
: Math.max(0, toFloat(current_value_usd, 0));

const nextUnits = units == null ? position.units : Math.max(0, toFloat(units, 0));

const nextAvgExitPrice =
avg_exit_price == null
? position.avg_exit_price
: Math.max(0, toFloat(avg_exit_price, 0));

const remainingCostBasisUsd = getRemainingCostBasisUsd({
...position,
units: nextUnits,
});

await db.run(
`
UPDATE cassie_sentinel_positions
SET
current_value_usd = ?,
units = ?,
avg_exit_price = ?,
unrealized_pnl_usd = ?
WHERE id = ?
`,
[
nextCurrentValue,
nextUnits,
nextAvgExitPrice,
nextCurrentValue - remainingCostBasisUsd,
position.id,
]
);

return getPositionById(position.id);
}

export async function markPositionBankedAt10x(
positionId,
{
bank_fraction = 0.5,
realized_exit_value_usd = null,
remaining_value_usd = null,
remaining_units = null,
tx_bank_ref = null,
} = {}
) {
const position = await getPositionById(positionId);
if (!position) {
throw new Error("Sentinel position not found for 10x bank.");
}

if (!isOpenStage(position.stage)) {
throw new Error("Cannot bank a closed Sentinel position.");
}

if (position.has_banked_10x) {
return position;
}

const bankFraction = Math.min(1, Math.max(0.01, toFloat(bank_fraction, 0.5)));
const currentRemainingCostBasisUsd = getRemainingCostBasisUsd(position);

const realizedExitValue =
realized_exit_value_usd == null
? position.current_value_usd * bankFraction
: Math.max(0, toFloat(realized_exit_value_usd, 0));

const soldCostBasisUsd = currentRemainingCostBasisUsd * bankFraction;
const remainingCostBasisUsd = Math.max(
0,
currentRemainingCostBasisUsd - soldCostBasisUsd
);
const realizedPnlIncrement = realizedExitValue - soldCostBasisUsd;

const nextCurrentValue =
remaining_value_usd == null
? Math.max(0, position.current_value_usd - realizedExitValue)
: Math.max(0, toFloat(remaining_value_usd, 0));

const nextUnits =
remaining_units == null
? Math.max(0, position.units * (1 - bankFraction))
: Math.max(0, toFloat(remaining_units, 0));

await db.run(
`
UPDATE cassie_sentinel_positions
SET
stage = 'half_banked_at_10x',
current_value_usd = ?,
units = ?,
realized_pnl_usd = ?,
unrealized_pnl_usd = ?,
has_banked_10x = 1,
banked_10x_at = CURRENT_TIMESTAMP,
runner_started_at = CURRENT_TIMESTAMP,
tx_bank_ref = ?
WHERE id = ?
`,
[
nextCurrentValue,
nextUnits,
position.realized_pnl_usd + realizedPnlIncrement,
nextCurrentValue - remainingCostBasisUsd,
cleanText(tx_bank_ref, 255) || position.tx_bank_ref || null,
position.id,
]
);

await incrementDailyStats(position.execution_mode, {
daily_realized_pnl_usd: realizedPnlIncrement,
daily_loss_usd: realizedPnlIncrement < 0 ? Math.abs(realizedPnlIncrement) : 0,
});

if (realizedPnlIncrement < 0) {
await incrementDailyStats(position.execution_mode, {
consecutive_failures: 1,
});
} else if (realizedPnlIncrement > 0) {
await resetDailyFailureStreak(position.execution_mode);
}

return getPositionById(position.id);
}

export async function markPositionRunnerOnly(
positionId,
{ current_value_usd = null } = {}
) {
const position = await getPositionById(positionId);
if (!position) {
throw new Error("Sentinel position not found for runner stage update.");
}

if (!position.has_banked_10x) {
throw new Error("Cannot move to runner_only before 10x bank.");
}

const nextCurrentValue =
current_value_usd == null
? position.current_value_usd
: Math.max(0, toFloat(current_value_usd, 0));

const remainingCostBasisUsd = getRemainingCostBasisUsd(position);

await db.run(
`
UPDATE cassie_sentinel_positions
SET
stage = 'runner_only',
current_value_usd = ?,
unrealized_pnl_usd = ?
WHERE id = ?
`,
[nextCurrentValue, nextCurrentValue - remainingCostBasisUsd, position.id]
);

return getPositionById(position.id);
}

export async function closePosition(
positionId,
{
exit_value_usd = null,
avg_exit_price = null,
tx_close_ref = null,
close_reason_codes = [REASON_CODE.POSITION_CLOSED],
} = {}
) {
const position = await getPositionById(positionId);
if (!position) {
throw new Error("Sentinel position not found for close.");
}

if (isClosedStage(position.stage)) {
return position;
}

const reasonCodes = ensureReasonCodeArray(close_reason_codes, [
REASON_CODE.POSITION_CLOSED,
]);

const stage = getClosedStage(reasonCodes);

const exitValue =
exit_value_usd == null
? position.current_value_usd
: Math.max(0, toFloat(exit_value_usd, 0));

const nextAvgExitPrice =
avg_exit_price == null
? position.avg_exit_price
: Math.max(0, toFloat(avg_exit_price, 0));

const remainingCostBasisUsd = getRemainingCostBasisUsd(position);
const closeRealizedPnlIncrement = exitValue - remainingCostBasisUsd;
const finalRealizedPnlUsd = position.realized_pnl_usd + closeRealizedPnlIncrement;

await db.run(
`
UPDATE cassie_sentinel_positions
SET
stage = ?,
current_value_usd = 0,
units = 0,
avg_exit_price = ?,
realized_pnl_usd = ?,
unrealized_pnl_usd = 0,
close_reason_codes = ?,
closed_at = CURRENT_TIMESTAMP,
invalidated_at = CASE
WHEN ? = 'invalidated' THEN CURRENT_TIMESTAMP
ELSE invalidated_at
END,
tx_close_ref = ?
WHERE id = ?
`,
[
stage,
nextAvgExitPrice,
finalRealizedPnlUsd,
JSON.stringify(reasonCodes),
stage,
cleanText(tx_close_ref, 255) || position.tx_close_ref || null,
position.id,
]
);

const updated = await getPositionById(position.id);
const lossDelta =
closeRealizedPnlIncrement < 0 ? Math.abs(closeRealizedPnlIncrement) : 0;

await incrementDailyStats(position.execution_mode, {
positions_closed: 1,
invalidations: stage === "invalidated" ? 1 : 0,
daily_realized_pnl_usd: closeRealizedPnlIncrement,
daily_loss_usd: lossDelta,
consecutive_failures: closeRealizedPnlIncrement < 0 ? 1 : 0,
});

if (closeRealizedPnlIncrement > 0) {
await resetDailyFailureStreak(position.execution_mode);
}

return updated;
}

export async function invalidatePosition(
positionId,
{
exit_value_usd = null,
avg_exit_price = null,
tx_close_ref = null,
close_reason_codes = [REASON_CODE.INVALIDATION_EXIT],
} = {}
) {
const reasonCodes = ensureReasonCodeArray(close_reason_codes, [
REASON_CODE.INVALIDATION_EXIT,
]);

if (!reasonCodes.includes(REASON_CODE.INVALIDATION_EXIT)) {
reasonCodes.push(REASON_CODE.INVALIDATION_EXIT);
}

return closePosition(positionId, {
exit_value_usd,
avg_exit_price,
tx_close_ref,
close_reason_codes: reasonCodes,
});
}

export async function upsertTokenCooldown({
token_id,
mint_address = null,
last_close_reason = null,
cooldown_until = null,
}) {
const normalized = normalizeTokenPair(token_id, mint_address);
const tokenId = normalized.token_id;
const mintAddress = normalized.mint_address;
const cooldownUntil = cleanText(cooldown_until, 64);

if (!tokenId) {
throw new Error(
"token_id or mint_address is required for Sentinel cooldown upsert."
);
}

if (!cooldownUntil) {
throw new Error("cooldown_until is required for Sentinel cooldown upsert.");
}

await db.run(
`
INSERT INTO cassie_sentinel_token_cooldowns (
token_id,
mint_address,
last_close_reason,
cooldown_until,
updated_at
) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
ON CONFLICT(token_id)
DO UPDATE SET
mint_address = excluded.mint_address,
last_close_reason = excluded.last_close_reason,
cooldown_until = excluded.cooldown_until,
updated_at = CURRENT_TIMESTAMP
`,
[
tokenId,
mintAddress || null,
cleanText(last_close_reason, 255) || null,
cooldownUntil,
]
);

return getTokenCooldown(tokenId);
}

export async function getTokenCooldown(tokenIdOrMint) {
const lookup = getTokenLookupValue(tokenIdOrMint);
if (!lookup) return null;

const row = await db.get(
`
SELECT *
FROM cassie_sentinel_token_cooldowns
WHERE token_id = ? OR mint_address = ?
LIMIT 1
`,
[lookup, lookup]
);

if (!row) return null;

return {
token_id: row.token_id,
mint_address: row.mint_address || null,
last_close_reason: row.last_close_reason || null,
cooldown_until: row.cooldown_until,
updated_at: row.updated_at || null,
};
}

export async function isTokenInCooldown(tokenIdOrMint, now = new Date()) {
const cooldown = await getTokenCooldown(tokenIdOrMint);
if (!cooldown?.cooldown_until) return false;

const nowTs = new Date(now).getTime();
const untilTs = new Date(cooldown.cooldown_until).getTime();

if (Number.isNaN(nowTs) || Number.isNaN(untilTs)) return false;
return untilTs > nowTs;
}

export async function getDailyStats(
executionMode = SENTINEL_MODE.PAPER,
statDate = todayUtcDate()
) {
const safeMode = normalizeExecutionMode(executionMode);
const safeDate = cleanText(statDate, 32);

const row = await db.get(
`
SELECT *
FROM cassie_sentinel_daily_stats
WHERE stat_date = ?
AND execution_mode = ?
LIMIT 1
`,
[safeDate, safeMode]
);

if (!row) {
return {
stat_date: safeDate,
execution_mode: safeMode,
scouts_opened: 0,
sniper_adds: 0,
positions_closed: 0,
invalidations: 0,
daily_scout_spend_usd: 0,
daily_sniper_spend_usd: 0,
daily_realized_pnl_usd: 0,
daily_unrealized_pnl_usd: 0,
daily_loss_usd: 0,
consecutive_failures: 0,
recent_rug_rate_pct: 0,
reclaim_success_rate_pct: 0,
avg_market_liquidity_usd: 0,
created_at: null,
updated_at: null,
};
}

return {
stat_date: row.stat_date,
execution_mode: row.execution_mode,
scouts_opened: toInt(row.scouts_opened, 0),
sniper_adds: toInt(row.sniper_adds, 0),
positions_closed: toInt(row.positions_closed, 0),
invalidations: toInt(row.invalidations, 0),
daily_scout_spend_usd: toFloat(row.daily_scout_spend_usd, 0),
daily_sniper_spend_usd: toFloat(row.daily_sniper_spend_usd, 0),
daily_realized_pnl_usd: toFloat(row.daily_realized_pnl_usd, 0),
daily_unrealized_pnl_usd: toFloat(row.daily_unrealized_pnl_usd, 0),
daily_loss_usd: toFloat(row.daily_loss_usd, 0),
consecutive_failures: toInt(row.consecutive_failures, 0),
recent_rug_rate_pct: toFloat(row.recent_rug_rate_pct, 0),
reclaim_success_rate_pct: toFloat(row.reclaim_success_rate_pct, 0),
avg_market_liquidity_usd: toFloat(row.avg_market_liquidity_usd, 0),
created_at: row.created_at || null,
updated_at: row.updated_at || null,
};
}

export async function ensureDailyStats(
executionMode = SENTINEL_MODE.PAPER,
statDate = todayUtcDate()
) {
const safeMode = normalizeExecutionMode(executionMode);
const safeDate = cleanText(statDate, 32);

await db.run(
`
INSERT OR IGNORE INTO cassie_sentinel_daily_stats (
stat_date,
execution_mode
) VALUES (?, ?)
`,
[safeDate, safeMode]
);

return getDailyStats(safeMode, safeDate);
}

export async function incrementDailyStats(
executionMode = SENTINEL_MODE.PAPER,
deltas = {},
statDate = todayUtcDate()
) {
const safeMode = normalizeExecutionMode(executionMode);
const safeDate = cleanText(statDate, 32);

await ensureDailyStats(safeMode, safeDate);
const current = await getDailyStats(safeMode, safeDate);

const next = {
scouts_opened: current.scouts_opened + Math.max(0, toInt(deltas.scouts_opened, 0)),
sniper_adds: current.sniper_adds + Math.max(0, toInt(deltas.sniper_adds, 0)),
positions_closed:
current.positions_closed + Math.max(0, toInt(deltas.positions_closed, 0)),
invalidations: current.invalidations + Math.max(0, toInt(deltas.invalidations, 0)),

daily_scout_spend_usd:
current.daily_scout_spend_usd +
Math.max(0, toFloat(deltas.daily_scout_spend_usd, 0)),
daily_sniper_spend_usd:
current.daily_sniper_spend_usd +
Math.max(0, toFloat(deltas.daily_sniper_spend_usd, 0)),
daily_realized_pnl_usd:
current.daily_realized_pnl_usd + toFloat(deltas.daily_realized_pnl_usd, 0),
daily_unrealized_pnl_usd:
current.daily_unrealized_pnl_usd +
toFloat(deltas.daily_unrealized_pnl_usd, 0),
daily_loss_usd:
current.daily_loss_usd + Math.max(0, toFloat(deltas.daily_loss_usd, 0)),

consecutive_failures:
toInt(deltas.consecutive_failures, 0) > 0
? current.consecutive_failures + toInt(deltas.consecutive_failures, 0)
: current.consecutive_failures,
};

await db.run(
`
UPDATE cassie_sentinel_daily_stats
SET
scouts_opened = ?,
sniper_adds = ?,
positions_closed = ?,
invalidations = ?,
daily_scout_spend_usd = ?,
daily_sniper_spend_usd = ?,
daily_realized_pnl_usd = ?,
daily_unrealized_pnl_usd = ?,
daily_loss_usd = ?,
consecutive_failures = ?,
updated_at = CURRENT_TIMESTAMP
WHERE stat_date = ?
AND execution_mode = ?
`,
[
next.scouts_opened,
next.sniper_adds,
next.positions_closed,
next.invalidations,
next.daily_scout_spend_usd,
next.daily_sniper_spend_usd,
next.daily_realized_pnl_usd,
next.daily_unrealized_pnl_usd,
next.daily_loss_usd,
next.consecutive_failures,
safeDate,
safeMode,
]
);

return getDailyStats(safeMode, safeDate);
}

export async function setDailyFailureState(
executionMode = SENTINEL_MODE.PAPER,
{
consecutive_failures = null,
recent_rug_rate_pct = null,
reclaim_success_rate_pct = null,
avg_market_liquidity_usd = null,
} = {},
statDate = todayUtcDate()
) {
const safeMode = normalizeExecutionMode(executionMode);
const safeDate = cleanText(statDate, 32);

await ensureDailyStats(safeMode, safeDate);
const current = await getDailyStats(safeMode, safeDate);

await db.run(
`
UPDATE cassie_sentinel_daily_stats
SET
consecutive_failures = ?,
recent_rug_rate_pct = ?,
reclaim_success_rate_pct = ?,
avg_market_liquidity_usd = ?,
updated_at = CURRENT_TIMESTAMP
WHERE stat_date = ?
AND execution_mode = ?
`,
[
consecutive_failures == null
? current.consecutive_failures
: Math.max(0, toInt(consecutive_failures, 0)),
recent_rug_rate_pct == null
? current.recent_rug_rate_pct
: Math.max(0, toFloat(recent_rug_rate_pct, 0)),
reclaim_success_rate_pct == null
? current.reclaim_success_rate_pct
: Math.max(0, toFloat(reclaim_success_rate_pct, 0)),
avg_market_liquidity_usd == null
? current.avg_market_liquidity_usd
: Math.max(0, toFloat(avg_market_liquidity_usd, 0)),
safeDate,
safeMode,
]
);

return getDailyStats(safeMode, safeDate);
}

export async function recordScoutOpened(
executionMode = SENTINEL_MODE.PAPER,
scoutUsd = 0
) {
return incrementDailyStats(executionMode, {
scouts_opened: 1,
daily_scout_spend_usd: Math.max(0, toFloat(scoutUsd, 0)),
});
}

export async function resetDailyFailureStreak(
executionMode = SENTINEL_MODE.PAPER,
statDate = todayUtcDate()
) {
const safeMode = normalizeExecutionMode(executionMode);
const safeDate = cleanText(statDate, 32);

await ensureDailyStats(safeMode, safeDate);

await db.run(
`
UPDATE cassie_sentinel_daily_stats
SET
consecutive_failures = 0,
updated_at = CURRENT_TIMESTAMP
WHERE stat_date = ?
AND execution_mode = ?
`,
[safeDate, safeMode]
);

return getDailyStats(safeMode, safeDate);
}

export async function snapshotOpenPositionExposure(executionMode = null) {
const safeMode = executionMode ? normalizeExecutionMode(executionMode, "") : null;

const row = safeMode
? await db.get(
`
SELECT
COUNT(*) AS open_positions,
COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd,
COALESCE(SUM(current_value_usd), 0) AS current_value_usd,
COALESCE(SUM(realized_pnl_usd), 0) AS realized_pnl_usd,
COALESCE(SUM(unrealized_pnl_usd), 0) AS unrealized_pnl_usd
FROM cassie_sentinel_positions
WHERE execution_mode = ?
AND stage IN ('scout_open', 'sniper_added', 'half_banked_at_10x', 'runner_only')
`,
[safeMode]
)
: await db.get(
`
SELECT
COUNT(*) AS open_positions,
COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd,
COALESCE(SUM(current_value_usd), 0) AS current_value_usd,
COALESCE(SUM(realized_pnl_usd), 0) AS realized_pnl_usd,
COALESCE(SUM(unrealized_pnl_usd), 0) AS unrealized_pnl_usd
FROM cassie_sentinel_positions
WHERE stage IN ('scout_open', 'sniper_added', 'half_banked_at_10x', 'runner_only')
`
);

return {
open_positions: toInt(row?.open_positions, 0),
total_cost_usd: toFloat(row?.total_cost_usd, 0),
current_value_usd: toFloat(row?.current_value_usd, 0),
realized_pnl_usd: toFloat(row?.realized_pnl_usd, 0),
unrealized_pnl_usd: toFloat(row?.unrealized_pnl_usd, 0),
};
}

export default {
isOpenStage,
isClosedStage,
getPositionById,
getOpenPositionByToken,
listOpenPositions,
countOpenPositions,
countOpenPositionsForOperatorCluster,
countRecentOpenedPositions,
createScoutPosition,
addSniperToPosition,
refreshPositionMarketValue,
markPositionBankedAt10x,
markPositionRunnerOnly,
closePosition,
invalidatePosition,
upsertTokenCooldown,
getTokenCooldown,
isTokenInCooldown,
getDailyStats,
ensureDailyStats,
incrementDailyStats,
setDailyFailureState,
recordScoutOpened,
resetDailyFailureStreak,
snapshotOpenPositionExposure,
};
