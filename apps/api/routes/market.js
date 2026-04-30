import express from "express";
import db from "../db/index.js";
import { getLiquidityLifecycle } from "../services/launcher/liquidityLifecycle.js";

const router = express.Router();

const BASE_MAX_WALLET_PERCENT = 0.005; // 0.5%
const DAILY_INCREASE_PERCENT = 0.005; // +0.5% per day
const PROTECTED_WALLET_CAP_DAYS = 5;

const MSS_TRADING_FEE_PCT = 0.5;

const TRADING_FEE_SPLIT = {
protocolRevenue: 0.6, // 0.3% of trade
ecosystemSupport: 0.4, // 0.2% of trade
};

const BUILDER_ALLOCATION_PCT = 5;
const BUILDER_DAILY_UNLOCK_PCT = 0.5;
const BUILDER_UNLOCK_DAYS = 10;
const BUILDER_CLIFF_DAYS = 0;
const BUILDER_VESTING_DAYS = BUILDER_UNLOCK_DAYS;

const TEAM_CLIFF_DAYS = 14;
const TEAM_VESTING_DAYS = 180;

const PARTICIPANT_UNLOCK_LABEL = "100% unlocked at live.";

const BUILDER_VESTING_RULE =
"0% unlocked at live. Builder allocation then unlocks at 0.5% of total supply per day for 10 days until the full 5% allocation is unlocked.";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const WALLET_BALANCE_ALIAS_GROUPS = {
token_amount: [
"token_amount",
"token_balance",
"balance_tokens",
"wallet_balance_tokens",
],
total_balance: [
"total_balance",
"total_balance_tokens",
"wallet_total_balance",
],
visible_total_balance: [
"visible_total_balance",
"visible_total_tokens",
"wallet_visible_total_balance",
"builder_visible_total_tokens",
],
unlocked_balance: [
"unlocked_balance",
"unlocked_token_balance",
"wallet_unlocked_balance",
],
locked_balance: [
"locked_balance",
"locked_token_balance",
"wallet_locked_balance",
],
sellable_balance: [
"sellable_balance",
"sellable_token_balance",
"wallet_sellable_balance",
],
sol_balance: ["sol_balance", "wallet_sol_balance"],
};

let walletBalanceColumnsCache = null;
const tableExistsCache = new Map();

function safeNum(value, fallback = 0) {
const n = Number(value);
return Number.isFinite(n) ? n : fallback;
}

function roundSol(value) {
return Number(safeNum(value, 0).toFixed(9));
}

function floorToken(value) {
return Math.max(0, Math.floor(safeNum(value, 0)));
}

function cleanText(value, max = 200) {
return String(value ?? "").trim().slice(0, max);
}

function parseJsonMaybe(value, fallback = null) {
if (value == null || value === "") return fallback;
if (typeof value === "object") return value;

try {
return JSON.parse(String(value));
} catch {
return fallback;
}
}

function parseDbTime(value) {
if (!value) return null;

const raw = String(value).trim();
if (!raw) return null;

const hasExplicitTimezone =
/z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw);

if (
!hasExplicitTimezone &&
/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
) {
const sqliteUtc = Date.parse(raw.replace(" ", "T") + "Z");
return Number.isFinite(sqliteUtc) ? sqliteUtc : null;
}

const direct = Date.parse(raw);
return Number.isFinite(direct) ? direct : null;
}

function choosePreferredString(...values) {
for (const value of values) {
const cleaned = cleanText(value, 500);
if (cleaned) return cleaned;
}

return "";
}

function chooseFirstFinite(...values) {
for (const value of values) {
if (value === null || value === undefined || value === "") continue;

const num = Number(value);
if (Number.isFinite(num)) return num;
}

return null;
}

function normalizeWallet(value) {
return cleanText(value, 120).toLowerCase();
}

async function tableExists(tableName) {
const key = cleanText(tableName, 120);
if (!key) return false;

if (tableExistsCache.has(key)) {
return tableExistsCache.get(key);
}

const row = await db.get(
`
SELECT name
FROM sqlite_master
WHERE type = 'table' AND name = ?
LIMIT 1
`,
[key]
);

const exists = Boolean(row?.name);
tableExistsCache.set(key, exists);
return exists;
}

function normalizePhaseStatus(value) {
const status = cleanText(value, 80).toLowerCase();

if (!status) return "";

if (status === "failed_refunded" || status === "refunded") {
return "failed_refunded";
}

if (
status === "failed" ||
status === "cancelled" ||
status === "canceled" ||
status === "expired"
) {
return "failed";
}

if (status === "graduated" || status === "surged" || status === "surge") {
return "graduated";
}

if (status === "live" || status === "trading" || status === "market_live") {
return "live";
}

if (
status === "building" ||
status === "bootstrapping" ||
status === "deploying" ||
status === "finalizing" ||
status === "finalising"
) {
return "building";
}

if (status === "countdown" || status === "pre_live" || status === "prelive") {
return "countdown";
}

if (
status === "commit" ||
status === "committing" ||
status === "open" ||
status === "pending" ||
status === "created" ||
status === "draft"
) {
return "commit";
}

return status;
}

function inferLaunchPhase(launch = {}) {
const rawStatus = normalizePhaseStatus(launch?.status);

const countdownStartedMs = parseDbTime(launch?.countdown_started_at);
const countdownEndsMs = parseDbTime(
launch?.countdown_ends_at || launch?.live_at
);
const liveAtMs = parseDbTime(launch?.live_at || launch?.countdown_ends_at);
const mintFinalizedAtMs = parseDbTime(launch?.mint_finalized_at);

const contractAddress = choosePreferredString(
launch?.contract_address,
launch?.token_mint,
launch?.mint_address,
launch?.mint
);

const reservationStatus = cleanText(
launch?.mint_reservation_status,
64
).toLowerCase();

const hasCountdownWindow =
Number.isFinite(countdownStartedMs) || Number.isFinite(countdownEndsMs);

const hasLiveSignal = Boolean(
contractAddress ||
reservationStatus === "finalized" ||
Number.isFinite(mintFinalizedAtMs)
);

if (rawStatus === "failed_refunded") return "failed_refunded";
if (rawStatus === "failed") return "failed";
if (rawStatus === "graduated") return "graduated";
if (rawStatus === "live") return "live";

/*
Protected phase rule:
countdown/building must not auto-promote to live from CA/mint/finalized signals.
finalizeLaunch.js owns true live promotion.
*/
if (rawStatus === "building") return "building";

if (rawStatus === "countdown") {
if (!Number.isFinite(countdownEndsMs) || Date.now() < countdownEndsMs) {
return "countdown";
}

return "building";
}

if (rawStatus === "commit") {
if (hasCountdownWindow) {
if (!Number.isFinite(countdownEndsMs) || Date.now() < countdownEndsMs) {
return "countdown";
}

return "building";
}

return "commit";
}

if (hasCountdownWindow) {
if (!Number.isFinite(countdownEndsMs) || Date.now() < countdownEndsMs) {
return "countdown";
}

return "building";
}

/*
Legacy fallback only:
old rows with no protected phase may infer live from finalized mint/CA data.
*/
if (
!rawStatus &&
Number.isFinite(liveAtMs) &&
Date.now() >= liveAtMs &&
hasLiveSignal
) {
return "live";
}

if (!rawStatus && hasLiveSignal) {
return "live";
}

return rawStatus || "commit";
}

function buildPhaseMeta(launch = {}) {
const status = inferLaunchPhase(launch);
const marketEnabled = status === "live" || status === "graduated";

return {
status,
market_enabled: marketEnabled,
can_trade: marketEnabled,
is_commit: status === "commit",
is_countdown: status === "countdown",
is_building: status === "building",
is_live: status === "live",
is_graduated: status === "graduated",
is_failed: status === "failed" || status === "failed_refunded",
};
}

function normalizeLaunchForMarket(launch = null) {
if (!launch) return null;

const phase = buildPhaseMeta(launch);

return {
...launch,
launch_result_json: parseJsonMaybe(launch.launch_result_json, null),
status: phase.status,
phase,
};
}

function getFeeBreakdown(totalFeeSol) {
const fee = roundSol(totalFeeSol);
const protocolRevenue = roundSol(fee * TRADING_FEE_SPLIT.protocolRevenue);
const ecosystemSupport = roundSol(fee * TRADING_FEE_SPLIT.ecosystemSupport);

return {
total: fee,
total_fee_sol: fee,

protocolRevenue,
protocol_revenue: protocolRevenue,
protocol_revenue_sol: protocolRevenue,

ecosystemSupport,
ecosystem_support: ecosystemSupport,
ecosystem_support_sol: ecosystemSupport,

core: protocolRevenue,
buyback: ecosystemSupport,
treasury: 0,

model: {
totalFeePct: MSS_TRADING_FEE_PCT,
protocolRevenuePct: 0.3,
ecosystemSupportPct: 0.2,
},
};
}

function getDaysSinceLaunch(launch) {
const launchStartMs = parseDbTime(
launch?.live_at || launch?.updated_at || launch?.created_at
);

if (!Number.isFinite(launchStartMs)) return 0;

return Math.max(0, Math.floor((Date.now() - launchStartMs) / MS_PER_DAY));
}

function isWalletCapOpen(launch) {
return getDaysSinceLaunch(launch) >= PROTECTED_WALLET_CAP_DAYS;
}

function getMaxWalletPercent(launch, isBuilderWallet = false) {
if (isWalletCapOpen(launch)) {
return 1;
}

if (isBuilderWallet) {
return BUILDER_ALLOCATION_PCT / 100;
}

const daysSinceLaunch = getDaysSinceLaunch(launch);
return BASE_MAX_WALLET_PERCENT + daysSinceLaunch * DAILY_INCREASE_PERCENT;
}

function getMaxBuySol() {
return null;
}

function isMarketTradable(launch) {
return Boolean(buildPhaseMeta(launch).can_trade);
}

function getEffectiveTotalSupply(launch, token) {
return floorToken(
launch?.final_supply ??
launch?.total_supply ??
token?.supply ??
launch?.supply ??
launch?.circulating_supply ??
0
);
}

function getMaxWalletTokens(launch, token, isBuilderWallet = false) {
const totalSupply = getEffectiveTotalSupply(launch, token);
const maxWalletPercent = getMaxWalletPercent(launch, isBuilderWallet);
const walletCapOpen = isWalletCapOpen(launch);

return {
totalSupply,
maxWalletPercent,
maxWalletPercentDisplay: maxWalletPercent * 100,
max_wallet_percent: maxWalletPercent,
max_wallet_percent_display: maxWalletPercent * 100,
maxWalletTokens: walletCapOpen
? totalSupply
: floorToken(totalSupply * maxWalletPercent),
walletCapOpen,
protectedDays: PROTECTED_WALLET_CAP_DAYS,
protectedDay: Math.min(
getDaysSinceLaunch(launch) + 1,
PROTECTED_WALLET_CAP_DAYS
),
};
}

async function getLaunchById(launchId) {
const launch = await db.get(`SELECT * FROM launches WHERE id = ?`, [launchId]);
return normalizeLaunchForMarket(launch);
}

async function getTokenByLaunchId(launchId) {
return db.get(
`SELECT * FROM tokens WHERE launch_id = ? ORDER BY id DESC LIMIT 1`,
[launchId]
);
}

async function getPoolByLaunchId(launchId) {
return db.get(
`
SELECT *
FROM pools
WHERE launch_id = ?
AND LOWER(COALESCE(status, 'active')) IN ('active', 'live', 'internal_live')
ORDER BY id DESC
LIMIT 1
`,
[launchId]
);
}

async function getTokenLaunchAndPool(launchId) {
const launch = await getLaunchById(launchId);

if (!launch) {
return { error: "Launch not found" };
}

const token = await getTokenByLaunchId(launchId);
if (!token) {
return { error: "Token not found", launch };
}

const pool = await getPoolByLaunchId(launchId);
if (!pool) {
return { error: "Pool not found", launch, token };
}

return { launch, token, pool };
}

async function getBuilderWalletByLaunch(launch) {
const direct = cleanText(launch?.builder_wallet || "", 120);
if (direct) return direct;

if (!launch?.builder_id) return "";

const builder = await db.get(`SELECT wallet FROM builders WHERE id = ?`, [
launch.builder_id,
]);

return cleanText(builder?.wallet || "", 120);
}

async function getWalletBalanceColumns() {
if (!walletBalanceColumnsCache) {
const rows = await db.all(`PRAGMA table_info(wallet_balances)`);
walletBalanceColumnsCache = new Set(
rows.map((row) => String(row.name || "").trim())
);
}

return walletBalanceColumnsCache;
}

function getAliasValue(row, aliases = [], fallback = null) {
for (const alias of aliases) {
if (row?.[alias] !== undefined && row?.[alias] !== null) {
return row[alias];
}
}

return fallback;
}

function pickExistingWalletBalanceColumn(columns, preferredGroups = []) {
for (const aliases of preferredGroups) {
for (const column of aliases) {
if (columns.has(column)) return column;
}
}

return null;
}

async function getOrCreateWalletBalanceRow(launchId, wallet) {
const walletStr = cleanText(wallet, 120);

let walletBalance = await db.get(
`
SELECT *
FROM wallet_balances
WHERE launch_id = ? AND LOWER(wallet) = LOWER(?)
ORDER BY id DESC
LIMIT 1
`,
[launchId, walletStr]
);

if (walletBalance) {
return {
...walletBalance,
__had_existing_balance_row: true,
__canonical_wallet: walletBalance.wallet || walletStr,
};
}

const columns = await getWalletBalanceColumns();

const insertColumns = ["launch_id", "wallet"];
const placeholders = ["?", "?"];
const params = [launchId, walletStr];

const tokenColumn = pickExistingWalletBalanceColumn(columns, [
WALLET_BALANCE_ALIAS_GROUPS.token_amount,
]);

if (tokenColumn) {
insertColumns.push(tokenColumn);
placeholders.push("?");
params.push(0);
}

if (columns.has("created_at")) {
insertColumns.push("created_at");
placeholders.push("CURRENT_TIMESTAMP");
}

if (columns.has("updated_at")) {
insertColumns.push("updated_at");
placeholders.push("CURRENT_TIMESTAMP");
}

await db.run(
`
INSERT INTO wallet_balances (${insertColumns.join(", ")})
VALUES (${placeholders.join(", ")})
`,
params
);

walletBalance = await db.get(
`
SELECT *
FROM wallet_balances
WHERE launch_id = ? AND LOWER(wallet) = LOWER(?)
ORDER BY id DESC
LIMIT 1
`,
[launchId, walletStr]
);

return walletBalance
? {
...walletBalance,
__had_existing_balance_row: false,
__canonical_wallet: walletBalance.wallet || walletStr,
}
: null;
}

async function getOrCreateWalletBalance(launchId, wallet) {
const walletRow = await getOrCreateWalletBalanceRow(launchId, wallet);
const columns = await getWalletBalanceColumns();

const tokenAmount = floorToken(
chooseFirstFinite(
getAliasValue(walletRow, WALLET_BALANCE_ALIAS_GROUPS.token_amount),
0
)
);

const totalBalance = floorToken(
chooseFirstFinite(
getAliasValue(walletRow, WALLET_BALANCE_ALIAS_GROUPS.total_balance),
tokenAmount
)
);

const visibleTotalBalance = floorToken(
chooseFirstFinite(
getAliasValue(walletRow, WALLET_BALANCE_ALIAS_GROUPS.visible_total_balance),
totalBalance,
tokenAmount
)
);

const unlockedBalance = floorToken(
chooseFirstFinite(
getAliasValue(walletRow, WALLET_BALANCE_ALIAS_GROUPS.unlocked_balance),
tokenAmount
)
);

const lockedBalance = floorToken(
chooseFirstFinite(
getAliasValue(walletRow, WALLET_BALANCE_ALIAS_GROUPS.locked_balance),
Math.max(0, visibleTotalBalance - unlockedBalance)
)
);

const sellableBalance = floorToken(
chooseFirstFinite(
getAliasValue(walletRow, WALLET_BALANCE_ALIAS_GROUPS.sellable_balance),
unlockedBalance
)
);

const solBalance = roundSol(
chooseFirstFinite(
getAliasValue(walletRow, WALLET_BALANCE_ALIAS_GROUPS.sol_balance),
0
)
);

return {
wallet: cleanText(walletRow?.wallet || wallet, 120),
token_amount: tokenAmount,
total_balance: totalBalance,
visible_total_balance: visibleTotalBalance,
unlocked_balance: unlockedBalance,
locked_balance: lockedBalance,
sellable_balance: sellableBalance,
sol_balance: solBalance,

hadExistingBalanceRow: Boolean(walletRow?.__had_existing_balance_row),
canonicalWallet: cleanText(walletRow?.__canonical_wallet || wallet, 120),

hasTokenAmountColumn: WALLET_BALANCE_ALIAS_GROUPS.token_amount.some((x) =>
columns.has(x)
),
hasTotalBalanceColumn: WALLET_BALANCE_ALIAS_GROUPS.total_balance.some((x) =>
columns.has(x)
),
hasVisibleTotalBalanceColumn:
WALLET_BALANCE_ALIAS_GROUPS.visible_total_balance.some((x) =>
columns.has(x)
),
hasUnlockedBalanceColumn: WALLET_BALANCE_ALIAS_GROUPS.unlocked_balance.some(
(x) => columns.has(x)
),
hasLockedBalanceColumn: WALLET_BALANCE_ALIAS_GROUPS.locked_balance.some(
(x) => columns.has(x)
),
hasSellableBalanceColumn: WALLET_BALANCE_ALIAS_GROUPS.sellable_balance.some(
(x) => columns.has(x)
),
hasSolBalanceColumn:
columns.has("sol_balance") || columns.has("wallet_sol_balance"),
};
}

function buildWalletState(walletBalance = {}, sellability = null) {
const tokenAmount = floorToken(walletBalance?.token_amount ?? 0);

const visibleTotalBalance = floorToken(
chooseFirstFinite(
sellability?.visibleTotalBalance,
walletBalance?.visible_total_balance,
walletBalance?.total_balance,
tokenAmount
)
);

const unlockedBalance = floorToken(
chooseFirstFinite(
sellability?.unlockedBalance,
walletBalance?.unlocked_balance,
tokenAmount
)
);

const lockedBalance = floorToken(
chooseFirstFinite(
sellability?.lockedBalance,
walletBalance?.locked_balance,
Math.max(0, visibleTotalBalance - unlockedBalance)
)
);

const sellableBalance = floorToken(
chooseFirstFinite(
sellability?.sellableBalance,
walletBalance?.sellable_balance,
unlockedBalance
)
);

return {
tokenAmount,
totalBalance: visibleTotalBalance,
visibleTotalBalance,
unlockedBalance,
lockedBalance,
sellableBalance,
};
}

async function updateWalletBalanceSnapshot(
launchId,
wallet,
{
tokenAmount = 0,
totalBalance = null,
visibleTotalBalance = null,
unlockedBalance = null,
lockedBalance = null,
sellableBalance = null,
solBalance = null,
} = {}
) {
const walletRow = await getOrCreateWalletBalanceRow(launchId, wallet);
const walletStr = cleanText(walletRow?.wallet || wallet, 120);
const columns = await getWalletBalanceColumns();

const normalizedTokenAmount = Math.max(0, floorToken(tokenAmount));

const normalizedVisibleTotalBalance = Math.max(
normalizedTokenAmount,
floorToken(visibleTotalBalance ?? totalBalance ?? normalizedTokenAmount)
);

const normalizedTotalBalance = Math.max(
normalizedTokenAmount,
floorToken(totalBalance ?? normalizedVisibleTotalBalance)
);

const normalizedUnlockedBalance = Math.max(
0,
Math.min(
normalizedVisibleTotalBalance,
floorToken(unlockedBalance ?? normalizedTokenAmount)
)
);

const normalizedLockedBalance = Math.max(
0,
Math.min(
normalizedVisibleTotalBalance,
floorToken(
lockedBalance ??
Math.max(0, normalizedVisibleTotalBalance - normalizedUnlockedBalance)
)
)
);

const normalizedSellableBalance = Math.max(
0,
Math.min(
normalizedVisibleTotalBalance,
floorToken(sellableBalance ?? normalizedUnlockedBalance)
)
);

const updates = [];
const params = [];

const setAliasGroup = (aliases, value, formatter = (v) => v) => {
for (const column of aliases) {
if (!columns.has(column)) continue;
updates.push(`${column} = ?`);
params.push(formatter(value));
}
};

setAliasGroup(
WALLET_BALANCE_ALIAS_GROUPS.token_amount,
normalizedTokenAmount,
floorToken
);

setAliasGroup(
WALLET_BALANCE_ALIAS_GROUPS.total_balance,
normalizedTotalBalance,
floorToken
);

setAliasGroup(
WALLET_BALANCE_ALIAS_GROUPS.visible_total_balance,
normalizedVisibleTotalBalance,
floorToken
);

setAliasGroup(
WALLET_BALANCE_ALIAS_GROUPS.unlocked_balance,
normalizedUnlockedBalance,
floorToken
);

setAliasGroup(
WALLET_BALANCE_ALIAS_GROUPS.locked_balance,
normalizedLockedBalance,
floorToken
);

setAliasGroup(
WALLET_BALANCE_ALIAS_GROUPS.sellable_balance,
normalizedSellableBalance,
floorToken
);

if (solBalance != null) {
setAliasGroup(
WALLET_BALANCE_ALIAS_GROUPS.sol_balance,
roundSol(solBalance),
roundSol
);
}

if (columns.has("updated_at")) {
updates.push("updated_at = CURRENT_TIMESTAMP");
}

if (!updates.length) {
return {
token_amount: normalizedTokenAmount,
total_balance: normalizedTotalBalance,
visible_total_balance: normalizedVisibleTotalBalance,
unlocked_balance: normalizedUnlockedBalance,
locked_balance: normalizedLockedBalance,
sellable_balance: normalizedSellableBalance,
sol_balance: solBalance != null ? roundSol(solBalance) : null,
};
}

params.push(launchId, walletStr);

await db.run(
`
UPDATE wallet_balances
SET ${updates.join(", ")}
WHERE launch_id = ? AND LOWER(wallet) = LOWER(?)
`,
params
);

return {
token_amount: normalizedTokenAmount,
total_balance: normalizedTotalBalance,
visible_total_balance: normalizedVisibleTotalBalance,
unlocked_balance: normalizedUnlockedBalance,
locked_balance: normalizedLockedBalance,
sellable_balance: normalizedSellableBalance,
sol_balance: solBalance != null ? roundSol(solBalance) : null,
};
}

async function syncLaunchPoolSnapshot(launchId, { solReserve, tokenReserve, price }) {
const updates = [];
const values = [];

if (solReserve != null) {
updates.push("internal_pool_sol = ?");
values.push(roundSol(solReserve));
}

if (tokenReserve != null) {
updates.push("internal_pool_tokens = ?");
values.push(floorToken(tokenReserve));
}

if (price != null && Number.isFinite(Number(price))) {
updates.push("price = ?");
values.push(Number(price));
}

updates.push("updated_at = CURRENT_TIMESTAMP");
values.push(launchId);

await db.run(
`
UPDATE launches
SET ${updates.join(", ")}
WHERE id = ?
`,
values
);
}

async function getUnlockedWalletCirculatingSupply(launchId, tokenReserve = 0) {
const columns = await getWalletBalanceColumns();

const balanceColumn = pickExistingWalletBalanceColumn(columns, [
WALLET_BALANCE_ALIAS_GROUPS.sellable_balance,
WALLET_BALANCE_ALIAS_GROUPS.unlocked_balance,
WALLET_BALANCE_ALIAS_GROUPS.token_amount,
]);

let walletSellableSupply = 0;

if (balanceColumn) {
const row = await db.get(
`
SELECT COALESCE(SUM(${balanceColumn}), 0) AS total
FROM wallet_balances
WHERE launch_id = ?
`,
[launchId]
);

walletSellableSupply = floorToken(row?.total || 0);
}

return floorToken(tokenReserve) + walletSellableSupply;
}

async function syncLaunchMarketFields(launchId, { solReserve, tokenReserve, price }) {
const circulatingSupply = await getUnlockedWalletCirculatingSupply(
launchId,
tokenReserve
);

const oneSidedLiquiditySol = roundSol(solReserve);
const safePrice = safeNum(price, 0);
const marketCap = safePrice > 0 ? safePrice * circulatingSupply : 0;

const volumeRow = await db.get(
`
SELECT COALESCE(SUM(ABS(sol_amount)), 0) AS total
FROM trades
WHERE launch_id = ?
AND datetime(created_at) >= datetime('now', '-24 hours')
`,
[launchId]
);

const volume24h = roundSol(volumeRow?.total || 0);

await db.run(
`
UPDATE launches
SET
liquidity = ?,
internal_pool_sol = ?,
internal_pool_tokens = ?,
price = ?,
circulating_supply = ?,
market_cap = ?,
volume_24h = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[
oneSidedLiquiditySol,
oneSidedLiquiditySol,
floorToken(tokenReserve),
safePrice,
circulatingSupply,
marketCap,
volume24h,
launchId,
]
);
}

async function getWalletSolDelta(launchId, wallet) {
const walletStr = cleanText(wallet, 120);
if (!walletStr) return 0;

const rows = await db.all(
`
SELECT side, sol_amount
FROM trades
WHERE launch_id = ? AND LOWER(wallet) = LOWER(?)
ORDER BY id ASC
`,
[launchId, walletStr]
);

let delta = 0;

for (const row of rows) {
const side = String(row?.side || "").toLowerCase();
const solAmount = safeNum(row?.sol_amount, 0);

if (side === "sell") {
delta += solAmount;
} else {
delta -= solAmount;
}
}

return roundSol(delta);
}

function getLaunchResult(launch = {}) {
return parseJsonMaybe(launch?.launch_result_json, null) || {};
}

function getLaunchResultAllocations(launch = {}) {
const result = getLaunchResult(launch);
const participantRows = Array.isArray(result.allocations) ? result.allocations : [];
const systemRows = Array.isArray(result.systemAllocations)
? result.systemAllocations
: [];

return [...participantRows, ...systemRows];
}

async function getAllocationForWallet(launchId, launch, wallet, allocationType) {
const walletKey = normalizeWallet(wallet);
const type = cleanText(allocationType, 80).toLowerCase();

if (!walletKey || !type) return null;

const resultRows = getLaunchResultAllocations(launch);

const fromResult = resultRows.find((row) => {
const rowWallet = normalizeWallet(row?.wallet);
const rowTypeRaw = cleanText(
row?.allocation_type ||
row?.allocationType ||
row?.type ||
row?.role ||
row?.bucket ||
(type === "participant" ? "participant" : ""),
80
).toLowerCase();

const rowType =
rowTypeRaw === "participants" ? "participant" : rowTypeRaw;

return rowWallet === walletKey && rowType === type;
});

if (fromResult) {
return {
...fromResult,
allocation_type: type,
token_amount: floorToken(
fromResult.token_amount ??
fromResult.tokenAmount ??
fromResult.tokens ??
fromResult.amount
),
};
}

if (!(await tableExists("allocations"))) return null;

const row = await db.get(
`
SELECT *
FROM allocations
WHERE launch_id = ?
AND LOWER(wallet) = LOWER(?)
AND LOWER(allocation_type) = LOWER(?)
ORDER BY id ASC
LIMIT 1
`,
[launchId, cleanText(wallet, 120), type]
);

if (!row) return null;

return {
...row,
allocation_type: type,
token_amount: floorToken(row.token_amount),
};
}

async function getParticipantAllocationForWallet(launchId, launch, wallet) {
return getAllocationForWallet(launchId, launch, wallet, "participant");
}

async function getTeamAllocationForWallet(launchId, launch, wallet) {
return getAllocationForWallet(launchId, launch, wallet, "team");
}

async function getBuilderAllocationForWallet(launchId, launch, wallet) {
return getAllocationForWallet(launchId, launch, wallet, "builder");
}

function computeLinearVesting({
totalAllocation,
launch,
unlockPctAtLaunch = 0,
cliffDays = 0,
vestingDays = 0,
startAt = null,
}) {
const total = floorToken(totalAllocation);

if (total <= 0) {
return {
unlockedAllocation: 0,
lockedAllocation: 0,
percentUnlocked: 0,
elapsedDays: 0,
};
}

const startMs = parseDbTime(
startAt || launch?.live_at || launch?.updated_at || launch?.created_at
);
const elapsedMs = Number.isFinite(startMs)
? Math.max(0, Date.now() - startMs)
: 0;
const elapsedDays = Number.isFinite(startMs)
? Math.floor(elapsedMs / MS_PER_DAY)
: 0;

const initialUnlocked = floorToken(
(total * Math.max(0, Math.min(100, unlockPctAtLaunch))) / 100
);
const lockedAtLaunch = Math.max(0, total - initialUnlocked);

const cliffMs = Math.max(0, cliffDays) * MS_PER_DAY;
const vestingMs = Math.max(0, vestingDays) * MS_PER_DAY;

let vestedFromLocked = 0;

if (elapsedMs >= cliffMs) {
if (vestingMs <= 0) {
vestedFromLocked = lockedAtLaunch;
} else {
vestedFromLocked = floorToken(
lockedAtLaunch * Math.min(1, (elapsedMs - cliffMs) / vestingMs)
);
}
}

const unlockedAllocation = Math.max(
0,
Math.min(total, initialUnlocked + vestedFromLocked)
);
const lockedAllocation = Math.max(0, total - unlockedAllocation);

return {
unlockedAllocation,
lockedAllocation,
percentUnlocked:
total > 0 ? Math.max(0, Math.min(100, (unlockedAllocation / total) * 100)) : 0,
elapsedDays,
};
}

function computeParticipantSellability({
allocation,
totalBalance,
trustStoredTotalBalance = false,
}) {
const totalAllocation = floorToken(allocation?.token_amount || 0);
const storedVisibleTotalBalance = floorToken(totalBalance);

if (totalAllocation <= 0 && storedVisibleTotalBalance <= 0) {
return null;
}

const visibleTotalBalance = trustStoredTotalBalance
? storedVisibleTotalBalance
: Math.max(storedVisibleTotalBalance, totalAllocation);

if (visibleTotalBalance <= 0) {
return null;
}

return {
isParticipantWallet: true,
participantVestingActive: false,

totalBalance: visibleTotalBalance,
visibleTotalBalance,
unlockedBalance: visibleTotalBalance,
lockedBalance: 0,
sellableBalance: visibleTotalBalance,

participantTotalAllocationTokens: totalAllocation,
participantUnlockedAllocationTokens: totalAllocation,
participantLockedAllocationTokens: 0,
participantVestingPercentUnlocked: 100,
participantVestingDaysLive: 0,
participantVestingDays: 0,
participantVestingLabel: PARTICIPANT_UNLOCK_LABEL,
};
}

function computeTeamSellability({
launch,
allocation,
totalBalance,
trustStoredTotalBalance = false,
}) {
const totalAllocation = floorToken(allocation?.token_amount || 0);
const storedVisibleTotalBalance = floorToken(totalBalance);

if (totalAllocation <= 0 && storedVisibleTotalBalance <= 0) {
return null;
}

const vesting = computeLinearVesting({
totalAllocation,
launch,
unlockPctAtLaunch: 0,
cliffDays: TEAM_CLIFF_DAYS,
vestingDays: TEAM_VESTING_DAYS,
});

const visibleTotalBalance = trustStoredTotalBalance
? storedVisibleTotalBalance
: Math.max(storedVisibleTotalBalance, totalAllocation);

if (visibleTotalBalance <= 0) {
return null;
}

const visibleLocked = Math.max(
0,
Math.min(visibleTotalBalance, vesting.lockedAllocation)
);

const visibleUnlocked = Math.max(0, visibleTotalBalance - visibleLocked);
const sellableBalance = visibleUnlocked;

return {
isTeamWallet: true,
teamVestingActive: visibleLocked > 0,

totalBalance: visibleTotalBalance,
visibleTotalBalance,
unlockedBalance: visibleUnlocked,
lockedBalance: visibleLocked,
sellableBalance,

teamTotalAllocationTokens: totalAllocation,
teamUnlockedAllocationTokens: vesting.unlockedAllocation,
teamLockedAllocationTokens: vesting.lockedAllocation,
teamVestingPercentUnlocked: vesting.percentUnlocked,
teamVestingDaysLive: vesting.elapsedDays,
teamCliffDays: TEAM_CLIFF_DAYS,
teamVestingDays: TEAM_VESTING_DAYS,
};
}

function resolveBuilderVestingStartAt(launch = {}, lifecycleVesting = null) {
const storedStart =
lifecycleVesting?.vestingStartAt ||
lifecycleVesting?.vesting_start_at ||
null;

if (storedStart) return storedStart;
if (launch?.live_at) return launch.live_at;

const status = cleanText(launch?.status, 64).toLowerCase();
if (status === "live" || status === "graduated") {
return launch?.updated_at || launch?.created_at || null;
}

return null;
}

function getBuilderDailyUnlockTokens(totalSupply, totalAllocation, lifecycleVesting = null) {
const fromTotalSupply = floorToken(
(safeNum(totalSupply, 0) * BUILDER_DAILY_UNLOCK_PCT) / 100
);
const fromAllocation = floorToken(
safeNum(totalAllocation, 0) / BUILDER_UNLOCK_DAYS
);
const fromLifecycle = floorToken(
lifecycleVesting?.dailyUnlock ?? lifecycleVesting?.daily_unlock ?? 0
);

return Math.max(fromTotalSupply, fromAllocation, fromLifecycle);
}

function computeBuilderDailyVesting({ totalAllocation, dailyUnlock, vestingStartAt }) {
const total = floorToken(totalAllocation);
const daily = floorToken(dailyUnlock);
const startMs = parseDbTime(vestingStartAt);

if (total <= 0 || daily <= 0) {
return {
unlockedAllocation: 0,
lockedAllocation: total,
percentUnlocked: 0,
elapsedDays: 0,
vestedDays: 0,
};
}

if (!Number.isFinite(startMs) || Date.now() < startMs) {
return {
unlockedAllocation: 0,
lockedAllocation: total,
percentUnlocked: 0,
elapsedDays: 0,
vestedDays: 0,
};
}

const elapsedMs = Math.max(0, Date.now() - startMs);
const elapsedDays = Math.floor(elapsedMs / MS_PER_DAY);
const vestedDays = Math.min(BUILDER_UNLOCK_DAYS, elapsedDays);

const unlockedAllocation =
vestedDays >= BUILDER_UNLOCK_DAYS
? total
: Math.min(total, daily * vestedDays);

const lockedAllocation = Math.max(0, total - unlockedAllocation);

return {
unlockedAllocation,
lockedAllocation,
percentUnlocked:
total > 0 ? Math.max(0, Math.min(100, (unlockedAllocation / total) * 100)) : 0,
elapsedDays,
vestedDays,
};
}

function computeBuilderSellability({
launch,
totalBalance,
lifecycleVesting = null,
builderAllocation = null,
trustStoredTotalBalance = false,
}) {
const storedVisibleTotalBalance = floorToken(totalBalance);

const totalSupply = floorToken(
launch?.final_supply || launch?.supply || launch?.total_supply || 0
);

const fallbackTotalAllocation = floorToken(
(totalSupply * BUILDER_ALLOCATION_PCT) / 100
);

const totalAllocation = Math.max(
floorToken(builderAllocation?.token_amount),
floorToken(lifecycleVesting?.totalAllocation),
floorToken(lifecycleVesting?.total_allocation),
fallbackTotalAllocation
);

const vestingStartAt = resolveBuilderVestingStartAt(launch, lifecycleVesting);
const dailyUnlock = getBuilderDailyUnlockTokens(
totalSupply,
totalAllocation,
lifecycleVesting
);

const vesting = computeBuilderDailyVesting({
totalAllocation,
dailyUnlock,
vestingStartAt,
});

const visibleTotalBalance = trustStoredTotalBalance
? storedVisibleTotalBalance
: Math.max(storedVisibleTotalBalance, totalAllocation);

if (visibleTotalBalance <= 0) {
return {
isBuilderWallet: true,
vestingActive: false,
totalBalance: 0,
visibleTotalBalance: 0,
unlockedBalance: 0,
lockedBalance: 0,
sellableBalance: 0,

builderVestingPercentUnlocked: vesting.percentUnlocked,
builderVestingDaysLive: vesting.elapsedDays,
builderVestedDays: vesting.vestedDays,

builderTotalAllocationTokens: totalAllocation,
builderUnlockedAllocationTokens: vesting.unlockedAllocation,
builderLockedAllocationTokens: vesting.lockedAllocation,
builderDailyUnlockTokens: dailyUnlock,
builderCliffDays: BUILDER_CLIFF_DAYS,
builderVestingDays: BUILDER_VESTING_DAYS,
builderUnlockDays: BUILDER_UNLOCK_DAYS,
builderDailyUnlockPct: BUILDER_DAILY_UNLOCK_PCT,
builderTotalAllocationPct: BUILDER_ALLOCATION_PCT,
builderVestingStartAt: vestingStartAt,
builderVestingRule: BUILDER_VESTING_RULE,
};
}

const visibleLocked = Math.max(
0,
Math.min(visibleTotalBalance, vesting.lockedAllocation)
);

const sellableBalance = Math.max(0, visibleTotalBalance - visibleLocked);
const visibleUnlocked = sellableBalance;

return {
isBuilderWallet: true,
vestingActive: visibleLocked > 0,

totalBalance: visibleTotalBalance,
visibleTotalBalance,
unlockedBalance: visibleUnlocked,
lockedBalance: visibleLocked,
sellableBalance,

builderVestingPercentUnlocked: vesting.percentUnlocked,
builderVestingDaysLive: vesting.elapsedDays,
builderVestedDays: vesting.vestedDays,

builderTotalAllocationTokens: totalAllocation,
builderUnlockedAllocationTokens: vesting.unlockedAllocation,
builderLockedAllocationTokens: vesting.lockedAllocation,
builderDailyUnlockTokens: dailyUnlock,

builderCliffDays: BUILDER_CLIFF_DAYS,
builderVestingDays: BUILDER_VESTING_DAYS,
builderUnlockDays: BUILDER_UNLOCK_DAYS,
builderDailyUnlockPct: BUILDER_DAILY_UNLOCK_PCT,
builderTotalAllocationPct: BUILDER_ALLOCATION_PCT,
builderVestingStartAt: vestingStartAt,
builderVestingRule: BUILDER_VESTING_RULE,
};
}

async function getWalletSellability(
launchId,
launch,
wallet,
walletVisibleTotalBalance,
walletBalance = null
) {
const walletStr = cleanText(wallet, 120);
const builderWallet = await getBuilderWalletByLaunch(launch);

const isBuilderWallet =
Boolean(walletStr) &&
Boolean(builderWallet) &&
walletStr.toLowerCase() === builderWallet.toLowerCase();

const totalBalance = floorToken(walletVisibleTotalBalance);

const trustStoredTotalBalance = Boolean(
walletBalance?.hadExistingBalanceRow &&
(walletBalance?.hasTotalBalanceColumn ||
walletBalance?.hasVisibleTotalBalanceColumn ||
walletBalance?.hasTokenAmountColumn)
);

const builderAllocation = await getBuilderAllocationForWallet(
launchId,
launch,
walletStr
);

if (
builderAllocation ||
(isBuilderWallet && String(launch?.template || "").toLowerCase() === "builder")
) {
let lifecycleVesting = null;

try {
const lifecycle = await getLiquidityLifecycle(launchId);
lifecycleVesting =
lifecycle?.builderVesting || lifecycle?.builder_vesting || null;
} catch {}

return computeBuilderSellability({
launch,
totalBalance,
lifecycleVesting,
builderAllocation,
trustStoredTotalBalance,
});
}

const teamAllocation = await getTeamAllocationForWallet(launchId, launch, walletStr);

const teamSellability = computeTeamSellability({
launch,
allocation: teamAllocation,
totalBalance,
trustStoredTotalBalance,
});

if (teamSellability) {
return {
isBuilderWallet: false,
isParticipantWallet: false,
isTeamWallet: true,
vestingActive: teamSellability.teamVestingActive,
builderVestingPercentUnlocked: 0,
builderVestingDaysLive: 0,
...teamSellability,
};
}

const participantAllocation = await getParticipantAllocationForWallet(
launchId,
launch,
walletStr
);

const participantSellability = computeParticipantSellability({
allocation: participantAllocation,
totalBalance,
trustStoredTotalBalance,
});

if (participantSellability) {
return {
isBuilderWallet: false,
isTeamWallet: false,
vestingActive: false,
builderVestingPercentUnlocked: 0,
builderVestingDaysLive: 0,
...participantSellability,
};
}

return {
isBuilderWallet,
isParticipantWallet: false,
isTeamWallet: false,
vestingActive: false,
totalBalance,
visibleTotalBalance: totalBalance,
unlockedBalance: totalBalance,
lockedBalance: 0,
sellableBalance: totalBalance,
builderVestingPercentUnlocked: 0,
builderVestingDaysLive: 0,
};
}

function buildBuyQuote({ solIn, tokenReserve, solReserve }) {
const grossSolIn = safeNum(solIn, 0);
const x = safeNum(tokenReserve, 0);
const y = safeNum(solReserve, 0);

if (grossSolIn <= 0) {
throw new Error("Invalid solAmount");
}

if (x <= 0 || y <= 0) {
throw new Error("Pool reserves are invalid");
}

const feeSol = grossSolIn * (MSS_TRADING_FEE_PCT / 100);
const netSolIn = grossSolIn - feeSol;

if (netSolIn <= 0) {
throw new Error("Trade too small after fee");
}

const k = x * y;
const newSolReserveRaw = y + netSolIn;
const newTokenReserveRaw = k / newSolReserveRaw;
const tokensBought = floorToken(x - newTokenReserveRaw);

if (!Number.isFinite(tokensBought) || tokensBought <= 0) {
throw new Error("Invalid trade output");
}

const newTokenReserve = x - tokensBought;
const newSolReserve = newSolReserveRaw;
const newKValue = String(Math.floor(newTokenReserve * newSolReserve));
const executionPrice = grossSolIn / tokensBought;
const postTradeUnitPrice = newSolReserve / Math.max(newTokenReserve, 1);
const feeBreakdown = getFeeBreakdown(feeSol);

return {
grossSolIn: roundSol(grossSolIn),
gross_sol_in: roundSol(grossSolIn),

walletSolDelta: roundSol(-grossSolIn),
wallet_sol_delta: roundSol(-grossSolIn),

feeSol: roundSol(feeSol),
fee_sol: roundSol(feeSol),

netSolIn: roundSol(netSolIn),
net_sol_in: roundSol(netSolIn),

tokensBought,
tokens_bought: tokensBought,
tokenOut: tokensBought,
token_out: tokensBought,

newSolReserve: roundSol(newSolReserve),
new_sol_reserve: roundSol(newSolReserve),

newTokenReserve: floorToken(newTokenReserve),
new_token_reserve: floorToken(newTokenReserve),

newKValue,
new_k_value: newKValue,

price: executionPrice,
executionPrice,
execution_price: executionPrice,
postTradeUnitPrice,
post_trade_unit_price: postTradeUnitPrice,

feeBreakdown,
fee_breakdown: feeBreakdown,
};
}

function buildSellQuote({ tokensIn, tokenReserve, solReserve }) {
const grossTokensIn = floorToken(tokensIn);
const x = safeNum(tokenReserve, 0);
const y = safeNum(solReserve, 0);

if (grossTokensIn <= 0) {
throw new Error("Invalid tokenAmount");
}

if (x <= 0 || y <= 0) {
throw new Error("Pool reserves are invalid");
}

const k = x * y;
const newTokenReserveRaw = x + grossTokensIn;
const newSolReserveRaw = k / newTokenReserveRaw;
const grossSolOut = y - newSolReserveRaw;

if (!Number.isFinite(grossSolOut) || grossSolOut <= 0) {
throw new Error("Invalid trade output");
}

const feeSol = grossSolOut * (MSS_TRADING_FEE_PCT / 100);
const netSolOut = grossSolOut - feeSol;

if (!Number.isFinite(netSolOut) || netSolOut <= 0) {
throw new Error("Invalid trade output");
}

const finalSolReserve = newSolReserveRaw;
const finalTokenReserve = x + grossTokensIn;
const finalK = String(Math.floor(finalTokenReserve * finalSolReserve));
const executionPrice = grossSolOut / grossTokensIn;
const postTradeUnitPrice = finalSolReserve / Math.max(finalTokenReserve, 1);
const feeBreakdown = getFeeBreakdown(feeSol);

return {
grossTokensIn,
gross_tokens_in: grossTokensIn,

grossSolOut: roundSol(grossSolOut),
gross_sol_out: roundSol(grossSolOut),

walletSolDelta: roundSol(netSolOut),
wallet_sol_delta: roundSol(netSolOut),

feeSol: roundSol(feeSol),
fee_sol: roundSol(feeSol),

netSolOut: roundSol(netSolOut),
net_sol_out: roundSol(netSolOut),
solOut: roundSol(netSolOut),
sol_out: roundSol(netSolOut),
solReceived: roundSol(netSolOut),
sol_received: roundSol(netSolOut),

newSolReserve: roundSol(finalSolReserve),
new_sol_reserve: roundSol(finalSolReserve),

newTokenReserve: floorToken(finalTokenReserve),
new_token_reserve: floorToken(finalTokenReserve),

newKValue: finalK,
new_k_value: finalK,

price: executionPrice,
executionPrice,
execution_price: executionPrice,
postTradeUnitPrice,
post_trade_unit_price: postTradeUnitPrice,

feeBreakdown,
fee_breakdown: feeBreakdown,
};
}

function buildWalletLimitPayload({
launch,
token,
isBuilderWallet,
walletBalanceBefore,
tokensAdded = 0,
}) {
const {
totalSupply,
maxWalletPercent,
maxWalletPercentDisplay,
maxWalletTokens,
walletCapOpen,
protectedDays,
protectedDay,
} = getMaxWalletTokens(launch, token, isBuilderWallet);

const currentBalance = floorToken(walletBalanceBefore);
const afterBalance = floorToken(currentBalance + floorToken(tokensAdded));
const walletCapacityRemaining = walletCapOpen
? Math.max(0, totalSupply - currentBalance)
: Math.max(0, maxWalletTokens - currentBalance);
const exceedsMaxWallet = walletCapOpen ? false : afterBalance > maxWalletTokens;

return {
totalSupply,
total_supply: totalSupply,

maxWalletPercent,
maxWalletPercentDisplay,
max_wallet_percent: maxWalletPercent,
max_wallet_percent_display: maxWalletPercentDisplay,

maxWallet: maxWalletTokens,
maxWalletTokens,
max_wallet: maxWalletTokens,
max_wallet_tokens: maxWalletTokens,

walletCapOpen,
wallet_cap_open: walletCapOpen,

protectedDays,
protected_days: protectedDays,
protectedDay,
protected_day: protectedDay,

walletBalanceBefore: currentBalance,
wallet_balance_before: currentBalance,
walletBalanceAfter: afterBalance,
wallet_balance_after: afterBalance,

walletCapacityRemaining,
wallet_capacity_remaining: walletCapacityRemaining,

exceedsMaxWallet,
exceeds_max_wallet: exceedsMaxWallet,

isBuilderWallet: Boolean(isBuilderWallet),
is_builder_wallet: Boolean(isBuilderWallet),
};
}

function buildSellabilityPayload(sellability = {}) {
const sellableBalance = floorToken(sellability?.sellableBalance ?? 0);
const unlockedBalance = floorToken(sellability?.unlockedBalance ?? 0);
const lockedBalance = floorToken(sellability?.lockedBalance ?? 0);
const visibleTotalBalance = floorToken(
sellability?.visibleTotalBalance ?? sellability?.totalBalance ?? 0
);

const participantTotal = floorToken(
sellability?.participantTotalAllocationTokens ?? 0
);
const participantUnlocked = floorToken(
sellability?.participantUnlockedAllocationTokens ?? 0
);
const participantLocked = floorToken(
sellability?.participantLockedAllocationTokens ?? 0
);

const teamTotal = floorToken(sellability?.teamTotalAllocationTokens ?? 0);
const teamUnlocked = floorToken(sellability?.teamUnlockedAllocationTokens ?? 0);
const teamLocked = floorToken(sellability?.teamLockedAllocationTokens ?? 0);

const builderTotal = floorToken(sellability?.builderTotalAllocationTokens ?? 0);
const builderUnlocked = floorToken(
sellability?.builderUnlockedAllocationTokens ?? 0
);
const builderLocked = floorToken(
sellability?.builderLockedAllocationTokens ?? 0
);

const vestingActive = Boolean(
sellability?.vestingActive ||
sellability?.participantVestingActive ||
sellability?.teamVestingActive ||
lockedBalance > 0
);

return {
totalBalance: visibleTotalBalance,
total_balance: visibleTotalBalance,
visibleTotalBalance,
visible_total_balance: visibleTotalBalance,

sellableBalance,
sellable_balance: sellableBalance,
sellableTokenBalance: sellableBalance,
sellable_token_balance: sellableBalance,

unlockedBalance,
unlocked_balance: unlockedBalance,
unlockedTokenBalance: unlockedBalance,
unlocked_token_balance: unlockedBalance,

lockedBalance,
locked_balance: lockedBalance,
lockedTokenBalance: lockedBalance,
locked_token_balance: lockedBalance,

isBuilderWallet: Boolean(sellability?.isBuilderWallet),
is_builder_wallet: Boolean(sellability?.isBuilderWallet),
wallet_is_builder: Boolean(sellability?.isBuilderWallet),

isParticipantWallet: Boolean(sellability?.isParticipantWallet),
is_participant_wallet: Boolean(sellability?.isParticipantWallet),

isTeamWallet: Boolean(sellability?.isTeamWallet),
is_team_wallet: Boolean(sellability?.isTeamWallet),

vestingActive,
vesting_active: vestingActive,
wallet_vesting_active: vestingActive,

participantVestingActive: Boolean(sellability?.participantVestingActive),
participant_vesting_active: Boolean(sellability?.participantVestingActive),

teamVestingActive: Boolean(sellability?.teamVestingActive),
team_vesting_active: Boolean(sellability?.teamVestingActive),

participantTotalAllocationTokens: participantTotal,
participant_total_allocation_tokens: participantTotal,
participantUnlockedTokens: participantUnlocked,
participant_unlocked_tokens: participantUnlocked,
participantLockedTokens: participantLocked,
participant_locked_tokens: participantLocked,
participantSellableTokens: sellability?.isParticipantWallet ? sellableBalance : 0,
participant_sellable_tokens: sellability?.isParticipantWallet ? sellableBalance : 0,
participantVestingPercentUnlocked: safeNum(
sellability?.participantVestingPercentUnlocked,
100
),
participant_vesting_percent_unlocked: safeNum(
sellability?.participantVestingPercentUnlocked,
100
),
participantVestingDaysLive: safeNum(
sellability?.participantVestingDaysLive,
0
),
participant_vesting_days_live: safeNum(
sellability?.participantVestingDaysLive,
0
),
participantVestingDays: safeNum(sellability?.participantVestingDays, 0),
participant_vesting_days: safeNum(sellability?.participantVestingDays, 0),
participantVestingLabel:
sellability?.participantVestingLabel || PARTICIPANT_UNLOCK_LABEL,
participant_vesting_label:
sellability?.participantVestingLabel || PARTICIPANT_UNLOCK_LABEL,

teamTotalAllocationTokens: teamTotal,
team_total_allocation_tokens: teamTotal,
teamUnlockedTokens: teamUnlocked,
team_unlocked_tokens: teamUnlocked,
teamLockedTokens: teamLocked,
team_locked_tokens: teamLocked,
teamSellableTokens: sellability?.isTeamWallet ? sellableBalance : 0,
team_sellable_tokens: sellability?.isTeamWallet ? sellableBalance : 0,
teamVestingPercentUnlocked: safeNum(sellability?.teamVestingPercentUnlocked, 100),
team_vesting_percent_unlocked: safeNum(
sellability?.teamVestingPercentUnlocked,
100
),
teamCliffDays: safeNum(sellability?.teamCliffDays, TEAM_CLIFF_DAYS),
team_cliff_days: safeNum(sellability?.teamCliffDays, TEAM_CLIFF_DAYS),
teamVestingDays: safeNum(sellability?.teamVestingDays, TEAM_VESTING_DAYS),
team_vesting_days: safeNum(sellability?.teamVestingDays, TEAM_VESTING_DAYS),

builderTotalAllocationTokens: builderTotal,
builder_total_allocation_tokens: builderTotal,
builderUnlockedTokens: builderUnlocked,
builder_unlocked_tokens: builderUnlocked,
builderUnlockedAllocationTokens: builderUnlocked,
builder_unlocked_allocation_tokens: builderUnlocked,
builderLockedTokens: builderLocked,
builder_locked_tokens: builderLocked,
builderLockedAllocationTokens: builderLocked,
builder_locked_allocation_tokens: builderLocked,
builderSellableTokens: sellability?.isBuilderWallet ? sellableBalance : 0,
builder_sellable_tokens: sellability?.isBuilderWallet ? sellableBalance : 0,
builderVisibleTotalTokens: sellability?.isBuilderWallet ? visibleTotalBalance : 0,
builder_visible_total_tokens: sellability?.isBuilderWallet
? visibleTotalBalance
: 0,
builderDailyUnlockTokens: floorToken(sellability?.builderDailyUnlockTokens ?? 0),
builder_daily_unlock_tokens: floorToken(
sellability?.builderDailyUnlockTokens ?? 0
),
builderVestingPercentUnlocked: safeNum(
sellability?.builderVestingPercentUnlocked,
0
),
builder_vesting_percent_unlocked: safeNum(
sellability?.builderVestingPercentUnlocked,
0
),
builderVestingDaysLive: safeNum(sellability?.builderVestingDaysLive, 0),
builder_vesting_days_live: safeNum(sellability?.builderVestingDaysLive, 0),
builderVestedDays: safeNum(sellability?.builderVestedDays, 0),
builder_vested_days: safeNum(sellability?.builderVestedDays, 0),
builderCliffDays: safeNum(sellability?.builderCliffDays, BUILDER_CLIFF_DAYS),
builder_cliff_days: safeNum(sellability?.builderCliffDays, BUILDER_CLIFF_DAYS),
builderVestingDays: safeNum(
sellability?.builderVestingDays,
BUILDER_VESTING_DAYS
),
builder_vesting_days: safeNum(
sellability?.builderVestingDays,
BUILDER_VESTING_DAYS
),
builderUnlockDays: safeNum(sellability?.builderUnlockDays, BUILDER_UNLOCK_DAYS),
builder_unlock_days: safeNum(
sellability?.builderUnlockDays,
BUILDER_UNLOCK_DAYS
),
builderDailyUnlockPct: safeNum(
sellability?.builderDailyUnlockPct,
BUILDER_DAILY_UNLOCK_PCT
),
builder_daily_unlock_pct: safeNum(
sellability?.builderDailyUnlockPct,
BUILDER_DAILY_UNLOCK_PCT
),
builderTotalAllocationPct: safeNum(
sellability?.builderTotalAllocationPct,
BUILDER_ALLOCATION_PCT
),
builder_total_allocation_pct: safeNum(
sellability?.builderTotalAllocationPct,
BUILDER_ALLOCATION_PCT
),
builderVestingStartAt: sellability?.builderVestingStartAt || null,
builder_vesting_start_at: sellability?.builderVestingStartAt || null,
builderVestingRule:
sellability?.builderVestingRule || BUILDER_VESTING_RULE,
builder_vesting_rule:
sellability?.builderVestingRule || BUILDER_VESTING_RULE,
};
}

async function getRefreshedWalletState(launchId, launch, wallet) {
const walletBalance = await getOrCreateWalletBalance(launchId, wallet);
const sellability = await getWalletSellability(
launchId,
launch,
wallet,
walletBalance.visible_total_balance ||
walletBalance.total_balance ||
walletBalance.token_amount,
walletBalance
);

const state = buildWalletState(walletBalance, sellability);

return {
walletBalance,
sellability,
state,
};
}

router.post("/quote-buy", async (req, res) => {
try {
const { launchId, solAmount, wallet = "" } = req.body;

if (!launchId || !solAmount) {
return res.status(400).json({ ok: false, error: "Missing parameters" });
}

const launchIdNum = Number(launchId);
const requestedSol = Number(solAmount);

if (!Number.isFinite(launchIdNum) || launchIdNum <= 0) {
return res.status(400).json({ ok: false, error: "Invalid launchId" });
}

if (!Number.isFinite(requestedSol) || requestedSol <= 0) {
return res.status(400).json({ ok: false, error: "Invalid solAmount" });
}

const launch = await getLaunchById(launchIdNum);
if (!launch) {
return res.status(404).json({ ok: false, error: "Launch not found" });
}

if (!isMarketTradable(launch)) {
return res.status(400).json({
ok: false,
error: "Market is not live",
status: launch.status,
phase: launch.phase,
});
}

const result = await getTokenLaunchAndPool(launchIdNum);

if (result.error) {
return res.status(404).json({ ok: false, error: result.error });
}

const { token, pool } = result;

const walletStr = cleanText(wallet, 120);
const builderWallet = await getBuilderWalletByLaunch(launch);

const isBuilderWallet =
walletStr &&
builderWallet &&
walletStr.toLowerCase() === builderWallet.toLowerCase();

const maxBuySol = getMaxBuySol(launch);

if (Number.isFinite(maxBuySol) && requestedSol > maxBuySol) {
return res.status(400).json({
ok: false,
error: "Max buy transaction exceeded",
maxBuySol,
max_buy_sol: maxBuySol,
status: launch.status,
phase: launch.phase,
});
}

const quote = buildBuyQuote({
solIn: requestedSol,
tokenReserve: Number(pool.token_reserve),
solReserve: Number(pool.sol_reserve),
});

let walletBalanceBefore = 0;
let walletVisibleTotalBalanceBefore = 0;
let walletSellableBalanceBefore = 0;
let walletSolBalance = 0;
let walletSolDelta = 0;
let hasSolBalanceColumn = false;
let sellability = null;

if (walletStr) {
const walletBalance = await getOrCreateWalletBalance(launchIdNum, walletStr);

walletBalanceBefore = safeNum(walletBalance.token_amount, 0);
walletVisibleTotalBalanceBefore = safeNum(
walletBalance.visible_total_balance,
walletBalance.total_balance
);
walletSolBalance = safeNum(walletBalance.sol_balance, 0);
hasSolBalanceColumn = Boolean(walletBalance.hasSolBalanceColumn);
walletSolDelta = await getWalletSolDelta(launchIdNum, walletStr);

sellability = await getWalletSellability(
launchIdNum,
launch,
walletStr,
walletVisibleTotalBalanceBefore || walletBalanceBefore,
walletBalance
);

walletSellableBalanceBefore = floorToken(
sellability?.sellableBalance ??
walletBalance.sellable_balance ??
walletBalanceBefore
);
}

const walletLimit = buildWalletLimitPayload({
launch,
token,
isBuilderWallet,
walletBalanceBefore: walletVisibleTotalBalanceBefore || walletBalanceBefore,
tokensAdded: quote.tokensBought,
});

const walletSolBalanceBeforeDisplay = hasSolBalanceColumn
? walletSolBalance
: walletSolDelta;

const walletSolBalanceAfterDisplay = hasSolBalanceColumn
? roundSol(walletSolBalance + quote.walletSolDelta)
: roundSol(walletSolDelta + quote.walletSolDelta);

return res.json({
ok: true,
success: true,
side: "buy",
status: launch.status,
phase: launch.phase,
quote: {
...quote,
feePct: MSS_TRADING_FEE_PCT,
fee_pct: MSS_TRADING_FEE_PCT,
maxBuySol,
max_buy_sol: maxBuySol,
isBuilderWallet,
is_builder_wallet: isBuilderWallet,

walletBalanceBefore: walletSellableBalanceBefore,
wallet_balance_before: walletSellableBalanceBefore,
walletTokenBalanceBefore: walletBalanceBefore,
wallet_token_balance_before: walletBalanceBefore,
walletVisibleTotalBalanceBefore,
wallet_visible_total_balance_before: walletVisibleTotalBalanceBefore,

walletVisibleTotalBalanceAfter: floorToken(
walletVisibleTotalBalanceBefore + quote.tokensBought
),
wallet_visible_total_balance_after: floorToken(
walletVisibleTotalBalanceBefore + quote.tokensBought
),
walletSellableBalanceAfter: floorToken(
walletSellableBalanceBefore + quote.tokensBought
),
wallet_sellable_balance_after: floorToken(
walletSellableBalanceBefore + quote.tokensBought
),

walletSolBalanceBefore: walletSolBalanceBeforeDisplay,
wallet_sol_balance_before: walletSolBalanceBeforeDisplay,
walletSolBalanceAfter: walletSolBalanceAfterDisplay,
wallet_sol_balance_after: walletSolBalanceAfterDisplay,

walletSolDeltaBefore: walletSolDelta,
wallet_sol_delta_before: walletSolDelta,
walletSolDeltaAfter: roundSol(walletSolDelta + quote.walletSolDelta),
wallet_sol_delta_after: roundSol(walletSolDelta + quote.walletSolDelta),

...walletLimit,
...buildSellabilityPayload(sellability),
},
});
} catch (err) {
console.error("QUOTE BUY ERROR", err);
return res.status(400).json({
ok: false,
error: err.message || "Quote buy failed",
});
}
});

router.post("/quote-sell", async (req, res) => {
try {
const { launchId, tokenAmount, wallet = "" } = req.body;

if (!launchId || !tokenAmount) {
return res.status(400).json({ ok: false, error: "Missing parameters" });
}

const launchIdNum = Number(launchId);
const requestedTokens = floorToken(tokenAmount);

if (!Number.isFinite(launchIdNum) || launchIdNum <= 0) {
return res.status(400).json({ ok: false, error: "Invalid launchId" });
}

if (!Number.isFinite(requestedTokens) || requestedTokens <= 0) {
return res.status(400).json({ ok: false, error: "Invalid tokenAmount" });
}

const walletStr = cleanText(wallet, 120);
if (!walletStr) {
return res.status(400).json({ ok: false, error: "Connect wallet first" });
}

const launch = await getLaunchById(launchIdNum);
if (!launch) {
return res.status(404).json({ ok: false, error: "Launch not found" });
}

if (!isMarketTradable(launch)) {
return res.status(400).json({
ok: false,
error: "Market is not live",
status: launch.status,
phase: launch.phase,
});
}

const result = await getTokenLaunchAndPool(launchIdNum);

if (result.error) {
return res.status(404).json({ ok: false, error: result.error });
}

const { pool } = result;

const walletBalance = await getOrCreateWalletBalance(launchIdNum, walletStr);

const walletBalanceBefore = safeNum(walletBalance.token_amount, 0);
const walletVisibleTotalBalanceBefore = safeNum(
walletBalance.visible_total_balance,
walletBalance.total_balance
);
const walletSolBalance = safeNum(walletBalance.sol_balance, 0);
const hasSolBalanceColumn = Boolean(walletBalance.hasSolBalanceColumn);
const walletSolDelta = await getWalletSolDelta(launchIdNum, walletStr);

const sellability = await getWalletSellability(
launchIdNum,
launch,
walletStr,
walletVisibleTotalBalanceBefore || walletBalanceBefore,
walletBalance
);

const currentState = buildWalletState(walletBalance, sellability);
const sellableBalance = floorToken(
sellability?.sellableBalance ?? currentState.sellableBalance
);

if (sellableBalance < requestedTokens) {
return res.status(400).json({
ok: false,
error: sellability?.vestingActive
? "Insufficient sellable tokens"
: "Insufficient tokens",
walletBalanceBefore: sellableBalance,
wallet_balance_before: sellableBalance,
walletTokenBalanceBefore: walletBalanceBefore,
wallet_token_balance_before: walletBalanceBefore,
walletVisibleTotalBalanceBefore,
wallet_visible_total_balance_before: walletVisibleTotalBalanceBefore,
...buildSellabilityPayload(sellability),
status: launch.status,
phase: launch.phase,
});
}

const quote = buildSellQuote({
tokensIn: requestedTokens,
tokenReserve: Number(pool.token_reserve),
solReserve: Number(pool.sol_reserve),
});

const walletVisibleTotalBalanceAfter = Math.max(
0,
currentState.visibleTotalBalance - requestedTokens
);
const walletSellableBalanceAfter = Math.max(0, sellableBalance - requestedTokens);

const walletSolBalanceBeforeDisplay = hasSolBalanceColumn
? walletSolBalance
: walletSolDelta;

const walletSolBalanceAfterDisplay = hasSolBalanceColumn
? roundSol(walletSolBalance + quote.walletSolDelta)
: roundSol(walletSolDelta + quote.walletSolDelta);

return res.json({
ok: true,
success: true,
side: "sell",
status: launch.status,
phase: launch.phase,
quote: {
...quote,
feePct: MSS_TRADING_FEE_PCT,
fee_pct: MSS_TRADING_FEE_PCT,

walletBalanceBefore: sellableBalance,
wallet_balance_before: sellableBalance,
walletBalanceAfter: walletSellableBalanceAfter,
wallet_balance_after: walletSellableBalanceAfter,

walletTokenBalanceBefore: walletBalanceBefore,
wallet_token_balance_before: walletBalanceBefore,
walletVisibleTotalBalanceBefore,
wallet_visible_total_balance_before: walletVisibleTotalBalanceBefore,
walletVisibleTotalBalanceAfter,
wallet_visible_total_balance_after: walletVisibleTotalBalanceAfter,

walletSolBalanceBefore: walletSolBalanceBeforeDisplay,
wallet_sol_balance_before: walletSolBalanceBeforeDisplay,
walletSolBalanceAfter: walletSolBalanceAfterDisplay,
wallet_sol_balance_after: walletSolBalanceAfterDisplay,

walletSolDeltaBefore: walletSolDelta,
wallet_sol_delta_before: walletSolDelta,
walletSolDeltaAfter: roundSol(walletSolDelta + quote.walletSolDelta),
wallet_sol_delta_after: roundSol(walletSolDelta + quote.walletSolDelta),

...buildSellabilityPayload(sellability),
},
});
} catch (err) {
console.error("QUOTE SELL ERROR", err);
return res.status(400).json({
ok: false,
error: err.message || "Quote sell failed",
});
}
});

router.post("/buy", async (req, res) => {
try {
const { launchId, wallet, solAmount } = req.body;

if (!launchId || !wallet || !solAmount) {
return res.status(400).json({ ok: false, error: "Missing parameters" });
}

const launchIdNum = Number(launchId);
const walletStr = cleanText(wallet, 120);
const solIn = Number(solAmount);

if (!Number.isFinite(launchIdNum) || launchIdNum <= 0) {
return res.status(400).json({ ok: false, error: "Invalid launchId" });
}

if (!walletStr) {
return res.status(400).json({ ok: false, error: "Invalid wallet" });
}

if (!Number.isFinite(solIn) || solIn <= 0) {
return res.status(400).json({ ok: false, error: "Invalid solAmount" });
}

const launch = await getLaunchById(launchIdNum);
if (!launch) {
return res.status(404).json({ ok: false, error: "Launch not found" });
}

if (!isMarketTradable(launch)) {
return res.status(400).json({
ok: false,
error: "Market is not live",
status: launch.status,
phase: launch.phase,
});
}

const result = await getTokenLaunchAndPool(launchIdNum);

if (result.error) {
return res.status(404).json({ ok: false, error: result.error });
}

const { token, pool } = result;

const builderWallet = await getBuilderWalletByLaunch(launch);

const isBuilderWallet =
Boolean(builderWallet) &&
walletStr.toLowerCase() === builderWallet.toLowerCase();

const maxBuySol = getMaxBuySol(launch);

if (Number.isFinite(maxBuySol) && solIn > maxBuySol) {
return res.status(400).json({
ok: false,
error: "Max buy transaction exceeded",
maxBuySol,
max_buy_sol: maxBuySol,
status: launch.status,
phase: launch.phase,
});
}

const quote = buildBuyQuote({
solIn,
tokenReserve: Number(pool.token_reserve),
solReserve: Number(pool.sol_reserve),
});

const walletBalance = await getOrCreateWalletBalance(launchIdNum, walletStr);

const currentBalance = safeNum(walletBalance.token_amount, 0);
const currentVisibleTotalBalance = safeNum(
walletBalance.visible_total_balance,
walletBalance.total_balance
);
const walletSolBalanceBefore = safeNum(walletBalance.sol_balance, 0);
const hasSolBalanceColumn = Boolean(walletBalance.hasSolBalanceColumn);
const walletSolDeltaBefore = await getWalletSolDelta(launchIdNum, walletStr);

const currentSellability = await getWalletSellability(
launchIdNum,
launch,
walletStr,
currentVisibleTotalBalance || currentBalance,
walletBalance
);

const currentState = buildWalletState(walletBalance, currentSellability);

const walletLimit = buildWalletLimitPayload({
launch,
token,
isBuilderWallet,
walletBalanceBefore: currentState.visibleTotalBalance || currentState.tokenAmount,
tokensAdded: quote.tokensBought,
});

if (walletLimit.exceedsMaxWallet) {
return res.status(400).json({
ok: false,
error: "Max wallet limit exceeded",
maxWallet: walletLimit.maxWallet,
maxWalletTokens: walletLimit.maxWalletTokens,
max_wallet: walletLimit.maxWallet,
max_wallet_tokens: walletLimit.maxWalletTokens,
attemptedBalance: walletLimit.walletBalanceAfter,
attempted_balance: walletLimit.walletBalanceAfter,
walletBalanceBefore: currentState.sellableBalance,
wallet_balance_before: currentState.sellableBalance,
walletVisibleTotalBalanceBefore: currentState.visibleTotalBalance,
wallet_visible_total_balance_before: currentState.visibleTotalBalance,
walletCapOpen: walletLimit.walletCapOpen,
wallet_cap_open: walletLimit.walletCapOpen,
status: launch.status,
phase: launch.phase,
});
}

await db.run("BEGIN TRANSACTION");

try {
await db.run(
`
UPDATE pools
SET token_reserve = ?, sol_reserve = ?, k_value = ?
WHERE launch_id = ? AND id = ?
`,
[
quote.newTokenReserve,
quote.newSolReserve,
quote.newKValue,
launchIdNum,
pool.id,
]
);

await db.run(
`
INSERT INTO trades
(launch_id, token_id, wallet, side, sol_amount, token_amount, price)
VALUES (?, ?, ?, 'buy', ?, ?, ?)
`,
[
launchIdNum,
token.id,
walletStr,
quote.grossSolIn,
quote.tokensBought,
quote.executionPrice,
]
);

const nextVisibleTotalBalance =
currentState.visibleTotalBalance + quote.tokensBought;
const nextUnlockedBalance = currentState.unlockedBalance + quote.tokensBought;
const nextSellableBalance = currentState.sellableBalance + quote.tokensBought;

await updateWalletBalanceSnapshot(launchIdNum, walletStr, {
tokenAmount: nextVisibleTotalBalance,
totalBalance: nextVisibleTotalBalance,
visibleTotalBalance: nextVisibleTotalBalance,
unlockedBalance: nextUnlockedBalance,
lockedBalance: currentState.lockedBalance,
sellableBalance: nextSellableBalance,
solBalance: walletSolBalanceBefore + quote.walletSolDelta,
});

await syncLaunchPoolSnapshot(launchIdNum, {
solReserve: quote.newSolReserve,
tokenReserve: quote.newTokenReserve,
price: quote.postTradeUnitPrice,
});

await syncLaunchMarketFields(launchIdNum, {
solReserve: quote.newSolReserve,
tokenReserve: quote.newTokenReserve,
price: quote.postTradeUnitPrice,
});

await db.run("COMMIT");
} catch (innerErr) {
await db.run("ROLLBACK");
throw innerErr;
}

const refreshed = await getRefreshedWalletState(launchIdNum, launch, walletStr);
const nextState = refreshed.state;
const nextSellability = refreshed.sellability;

const walletSolDeltaAfter = roundSol(walletSolDeltaBefore + quote.walletSolDelta);

const walletSolBalanceAfter =
refreshed.walletBalance.sol_balance != null
? refreshed.walletBalance.sol_balance
: walletSolDeltaAfter;

const walletSolBalanceBeforeDisplay = hasSolBalanceColumn
? walletSolBalanceBefore
: walletSolDeltaBefore;

return res.json({
ok: true,
success: true,
side: "buy",
status: launch.status,
phase: launch.phase,

tokensReceived: quote.tokensBought,
tokens_received: quote.tokensBought,
tokenOut: quote.tokensBought,
token_out: quote.tokensBought,

price: quote.executionPrice,
executionPrice: quote.executionPrice,
execution_price: quote.executionPrice,
marketPriceAfter: quote.postTradeUnitPrice,
market_price_after: quote.postTradeUnitPrice,

feePct: MSS_TRADING_FEE_PCT,
fee_pct: MSS_TRADING_FEE_PCT,
feeSol: quote.feeSol,
fee_sol: quote.feeSol,
feeBreakdown: quote.feeBreakdown,
fee_breakdown: quote.feeBreakdown,

walletSolDelta: quote.walletSolDelta,
wallet_sol_delta: quote.walletSolDelta,
walletSolDeltaBefore,
wallet_sol_delta_before: walletSolDeltaBefore,
walletSolDeltaAfter,
wallet_sol_delta_after: walletSolDeltaAfter,
walletSolBalanceBefore: walletSolBalanceBeforeDisplay,
wallet_sol_balance_before: walletSolBalanceBeforeDisplay,
walletSolBalanceAfter,
wallet_sol_balance_after: walletSolBalanceAfter,

maxBuySol,
max_buy_sol: maxBuySol,
isBuilderWallet,
is_builder_wallet: isBuilderWallet,

...walletLimit,

walletBalanceBefore: currentState.sellableBalance,
wallet_balance_before: currentState.sellableBalance,
walletBalanceAfter: nextState.sellableBalance,
wallet_balance_after: nextState.sellableBalance,

walletTokenBalanceBefore: currentState.tokenAmount,
wallet_token_balance_before: currentState.tokenAmount,
walletTokenBalanceAfter: nextState.tokenAmount,
wallet_token_balance_after: nextState.tokenAmount,

walletTotalBalanceBefore: currentState.visibleTotalBalance,
wallet_total_balance_before: currentState.visibleTotalBalance,
walletTotalBalanceAfter: nextState.visibleTotalBalance,
wallet_total_balance_after: nextState.visibleTotalBalance,

walletVisibleTotalBalanceBefore: currentState.visibleTotalBalance,
wallet_visible_total_balance_before: currentState.visibleTotalBalance,
walletVisibleTotalBalanceAfter: nextState.visibleTotalBalance,
wallet_visible_total_balance_after: nextState.visibleTotalBalance,

walletUnlockedBalanceAfter: nextState.unlockedBalance,
wallet_unlocked_balance_after: nextState.unlockedBalance,
walletLockedBalanceAfter: nextState.lockedBalance,
wallet_locked_balance_after: nextState.lockedBalance,
walletSellableBalanceAfter: nextState.sellableBalance,
wallet_sellable_balance_after: nextState.sellableBalance,

...buildSellabilityPayload(nextSellability),

pool: {
sol_reserve: quote.newSolReserve,
token_reserve: quote.newTokenReserve,
k_value: quote.newKValue,
},
});
} catch (err) {
console.error("BUY ERROR", err);
return res.status(500).json({
ok: false,
error: err.message || "Buy failed",
});
}
});

router.post("/sell", async (req, res) => {
try {
const { launchId, wallet, tokenAmount } = req.body;

if (!launchId || !wallet || !tokenAmount) {
return res.status(400).json({ ok: false, error: "Missing parameters" });
}

const launchIdNum = Number(launchId);
const walletStr = cleanText(wallet, 120);
const tokensIn = floorToken(tokenAmount);

if (!Number.isFinite(launchIdNum) || launchIdNum <= 0) {
return res.status(400).json({ ok: false, error: "Invalid launchId" });
}

if (!walletStr) {
return res.status(400).json({ ok: false, error: "Invalid wallet" });
}

if (!Number.isFinite(tokensIn) || tokensIn <= 0) {
return res.status(400).json({ ok: false, error: "Invalid tokenAmount" });
}

const launch = await getLaunchById(launchIdNum);
if (!launch) {
return res.status(404).json({ ok: false, error: "Launch not found" });
}

if (!isMarketTradable(launch)) {
return res.status(400).json({
ok: false,
error: "Market is not live",
status: launch.status,
phase: launch.phase,
});
}

const result = await getTokenLaunchAndPool(launchIdNum);

if (result.error) {
return res.status(404).json({ ok: false, error: result.error });
}

const { token, pool } = result;

const walletBalance = await getOrCreateWalletBalance(launchIdNum, walletStr);

const currentBalance = safeNum(walletBalance.token_amount, 0);
const currentVisibleTotalBalance = safeNum(
walletBalance.visible_total_balance,
walletBalance.total_balance
);
const walletSolBalanceBefore = safeNum(walletBalance.sol_balance, 0);
const hasSolBalanceColumn = Boolean(walletBalance.hasSolBalanceColumn);
const walletSolDeltaBefore = await getWalletSolDelta(launchIdNum, walletStr);

const sellability = await getWalletSellability(
launchIdNum,
launch,
walletStr,
currentVisibleTotalBalance || currentBalance,
walletBalance
);

const currentState = buildWalletState(walletBalance, sellability);

const sellableBalance = floorToken(
sellability?.sellableBalance ?? currentState.sellableBalance
);

if (sellableBalance < tokensIn) {
return res.status(400).json({
ok: false,
error: sellability?.vestingActive
? "Insufficient sellable tokens"
: "Insufficient tokens",
walletBalanceBefore: sellableBalance,
wallet_balance_before: sellableBalance,
walletTokenBalanceBefore: currentState.tokenAmount,
wallet_token_balance_before: currentState.tokenAmount,
walletVisibleTotalBalanceBefore: currentState.visibleTotalBalance,
wallet_visible_total_balance_before: currentState.visibleTotalBalance,
...buildSellabilityPayload(sellability),
status: launch.status,
phase: launch.phase,
});
}

const quote = buildSellQuote({
tokensIn,
tokenReserve: Number(pool.token_reserve),
solReserve: Number(pool.sol_reserve),
});

await db.run("BEGIN TRANSACTION");

try {
await db.run(
`
UPDATE pools
SET token_reserve = ?, sol_reserve = ?, k_value = ?
WHERE launch_id = ? AND id = ?
`,
[
quote.newTokenReserve,
quote.newSolReserve,
quote.newKValue,
launchIdNum,
pool.id,
]
);

await db.run(
`
INSERT INTO trades
(launch_id, token_id, wallet, side, sol_amount, token_amount, price)
VALUES (?, ?, ?, 'sell', ?, ?, ?)
`,
[
launchIdNum,
token.id,
walletStr,
quote.netSolOut,
quote.grossTokensIn,
quote.executionPrice,
]
);

const nextVisibleTotalBalance = Math.max(
0,
currentState.visibleTotalBalance - quote.grossTokensIn
);
const nextUnlockedBalance = Math.max(
0,
currentState.unlockedBalance - quote.grossTokensIn
);
const nextSellableBalance = Math.max(
0,
currentState.sellableBalance - quote.grossTokensIn
);

await updateWalletBalanceSnapshot(launchIdNum, walletStr, {
tokenAmount: nextVisibleTotalBalance,
totalBalance: nextVisibleTotalBalance,
visibleTotalBalance: nextVisibleTotalBalance,
unlockedBalance: nextUnlockedBalance,
lockedBalance: currentState.lockedBalance,
sellableBalance: nextSellableBalance,
solBalance: walletSolBalanceBefore + quote.walletSolDelta,
});

await syncLaunchPoolSnapshot(launchIdNum, {
solReserve: quote.newSolReserve,
tokenReserve: quote.newTokenReserve,
price: quote.postTradeUnitPrice,
});

await syncLaunchMarketFields(launchIdNum, {
solReserve: quote.newSolReserve,
tokenReserve: quote.newTokenReserve,
price: quote.postTradeUnitPrice,
});

await db.run("COMMIT");
} catch (innerErr) {
await db.run("ROLLBACK");
throw innerErr;
}

const refreshed = await getRefreshedWalletState(launchIdNum, launch, walletStr);
const nextState = refreshed.state;
const nextSellability = refreshed.sellability;

const walletSolDeltaAfter = roundSol(walletSolDeltaBefore + quote.walletSolDelta);

const walletSolBalanceAfter =
refreshed.walletBalance.sol_balance != null
? refreshed.walletBalance.sol_balance
: walletSolDeltaAfter;

const walletSolBalanceBeforeDisplay = hasSolBalanceColumn
? walletSolBalanceBefore
: walletSolDeltaBefore;

return res.json({
ok: true,
success: true,
side: "sell",
status: launch.status,
phase: launch.phase,

solReceived: quote.netSolOut,
sol_received: quote.netSolOut,
netSolOut: quote.netSolOut,
net_sol_out: quote.netSolOut,
grossSolOut: quote.grossSolOut,
gross_sol_out: quote.grossSolOut,

feePct: MSS_TRADING_FEE_PCT,
fee_pct: MSS_TRADING_FEE_PCT,
feeSol: quote.feeSol,
fee_sol: quote.feeSol,
feeBreakdown: quote.feeBreakdown,
fee_breakdown: quote.feeBreakdown,

price: quote.executionPrice,
executionPrice: quote.executionPrice,
execution_price: quote.executionPrice,
marketPriceAfter: quote.postTradeUnitPrice,
market_price_after: quote.postTradeUnitPrice,

walletSolDelta: quote.walletSolDelta,
wallet_sol_delta: quote.walletSolDelta,
walletSolDeltaBefore,
wallet_sol_delta_before: walletSolDeltaBefore,
walletSolDeltaAfter,
wallet_sol_delta_after: walletSolDeltaAfter,
walletSolBalanceBefore: walletSolBalanceBeforeDisplay,
wallet_sol_balance_before: walletSolBalanceBeforeDisplay,
walletSolBalanceAfter,
wallet_sol_balance_after: walletSolBalanceAfter,

walletBalanceBefore: currentState.sellableBalance,
wallet_balance_before: currentState.sellableBalance,
walletBalanceAfter: nextState.sellableBalance,
wallet_balance_after: nextState.sellableBalance,

walletTokenBalanceBefore: currentState.tokenAmount,
wallet_token_balance_before: currentState.tokenAmount,
walletTokenBalanceAfter: nextState.tokenAmount,
wallet_token_balance_after: nextState.tokenAmount,

walletTotalBalanceBefore: currentState.visibleTotalBalance,
wallet_total_balance_before: currentState.visibleTotalBalance,
walletTotalBalanceAfter: nextState.visibleTotalBalance,
wallet_total_balance_after: nextState.visibleTotalBalance,

walletVisibleTotalBalanceBefore: currentState.visibleTotalBalance,
wallet_visible_total_balance_before: currentState.visibleTotalBalance,
walletVisibleTotalBalanceAfter: nextState.visibleTotalBalance,
wallet_visible_total_balance_after: nextState.visibleTotalBalance,

walletUnlockedBalanceBefore: currentState.unlockedBalance,
wallet_unlocked_balance_before: currentState.unlockedBalance,
walletUnlockedBalanceAfter: nextState.unlockedBalance,
wallet_unlocked_balance_after: nextState.unlockedBalance,

walletLockedBalanceBefore: currentState.lockedBalance,
wallet_locked_balance_before: currentState.lockedBalance,
walletLockedBalanceAfter: nextState.lockedBalance,
wallet_locked_balance_after: nextState.lockedBalance,

walletSellableBalanceBefore: currentState.sellableBalance,
wallet_sellable_balance_before: currentState.sellableBalance,
walletSellableBalanceAfter: nextState.sellableBalance,
wallet_sellable_balance_after: nextState.sellableBalance,

sellableBalanceBefore: sellableBalance,
sellable_balance_before: sellableBalance,
unlockedBalanceBefore: floorToken(
sellability?.unlockedBalance ?? currentState.unlockedBalance
),
unlocked_balance_before: floorToken(
sellability?.unlockedBalance ?? currentState.unlockedBalance
),
lockedBalanceBefore: floorToken(
sellability?.lockedBalance ?? currentState.lockedBalance
),
locked_balance_before: floorToken(
sellability?.lockedBalance ?? currentState.lockedBalance
),

...buildSellabilityPayload(nextSellability),

tokenAmountSold: quote.grossTokensIn,
token_amount_sold: quote.grossTokensIn,
soldTokens: quote.grossTokensIn,
sold_tokens: quote.grossTokensIn,

totalSupply: getEffectiveTotalSupply(launch, token),
total_supply: getEffectiveTotalSupply(launch, token),

pool: {
sol_reserve: quote.newSolReserve,
token_reserve: quote.newTokenReserve,
k_value: quote.newKValue,
},
});
} catch (err) {
console.error("SELL ERROR", err);
return res.status(500).json({
ok: false,
error: err.message || "Sell failed",
});
}
});

export default router;