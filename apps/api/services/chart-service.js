import { buildCandlesFromTrades, fillMissingCandles } from "./candle-builder.js";
import { buildMarketStats } from "./market-stats.js";

const BUILDER_DAILY_UNLOCK_PERCENT = 0.5;
const BUILDER_MAX_ALLOCATION_PERCENT = 5;

let walletBalanceColumnsCache = null;
const tableExistsCache = new Map();

function toNumber(value, fallback = 0) {
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function toInt(value, fallback = 0) {
return Math.max(0, Math.floor(toNumber(value, fallback)));
}

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max);
}

function parseDbTime(value) {
if (!value) return null;
const raw = String(value).trim();
if (!raw) return null;

const hasExplicitTimezone =
/z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw);

if (!hasExplicitTimezone && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
const sqliteUtc = Date.parse(raw.replace(" ", "T") + "Z");
return Number.isFinite(sqliteUtc) ? sqliteUtc : null;
}

const direct = Date.parse(raw);
return Number.isFinite(direct) ? direct : null;
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

function normalizeWallet(value) {
return cleanText(value, 120).toLowerCase();
}

function shouldRevealContractAddress(status) {
const normalized = cleanText(status, 64).toLowerCase();
return normalized === "live" || normalized === "graduated";
}

async function tableExists(db, tableName) {
const key = String(tableName || "").trim();
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

function getWalletBalanceColumnsFromRows(rows = []) {
return new Set(rows.map((row) => String(row.name || "").trim()));
}

async function getWalletBalanceColumns(db) {
const hasWalletBalances = await tableExists(db, "wallet_balances");
if (!hasWalletBalances) return new Set();

if (!walletBalanceColumnsCache) {
const rows = await db.all(`PRAGMA table_info(wallet_balances)`);
walletBalanceColumnsCache = getWalletBalanceColumnsFromRows(rows);
}

return walletBalanceColumnsCache;
}

function pickLaunchRow(row) {
if (!row) return null;

const poolSolReserve = toNumber(row.sol_reserve, 0);
const launchInternalPoolSol = toNumber(row.internal_pool_sol, 0);
const launchLiquidity = toNumber(row.liquidity, 0);
const poolTokenReserve = toNumber(row.token_reserve, 0);
const launchInternalPoolTokens = toNumber(row.internal_pool_tokens, 0);
const publicCaVisible = shouldRevealContractAddress(row.status);

const oneSidedLiquiditySol =
poolSolReserve > 0
? poolSolReserve
: launchInternalPoolSol > 0
? launchInternalPoolSol
: launchLiquidity > 0
? launchLiquidity
: 0;

const mintAddress = cleanText(row.token_mint_address, 120) || null;
const contractAddress = cleanText(row.contract_address, 120) || null;

return {
id: row.id,
name: row.token_name,
token_name: row.token_name,
symbol: row.symbol,
status: row.status,
template: row.template,

contract_address: publicCaVisible ? contractAddress : null,
mint_address: publicCaVisible ? (mintAddress || contractAddress) : null,

reserved_mint_address: null,
reserved_mint_secret: null,
mint_reservation_status: publicCaVisible
? cleanText(row.mint_reservation_status, 64).toLowerCase() || null
: null,
mint_finalized_at: publicCaVisible ? row.mint_finalized_at || null : null,

builder_wallet: cleanText(row.builder_wallet, 120) || null,
builder_alias: cleanText(row.builder_alias, 120) || null,
builder_score: toNumber(row.builder_score, 0),

supply: toNumber(row.supply, 0),
final_supply: toNumber(row.final_supply || row.supply, 0),
total_supply: toNumber(row.final_supply || row.supply, 0),
circulating_supply: toNumber(
row.circulating_supply || row.final_supply || row.supply,
0
),

liquidity: oneSidedLiquiditySol,
liquidity_sol: oneSidedLiquiditySol,
internal_pool_sol: launchInternalPoolSol,
internal_pool_tokens:
poolTokenReserve > 0 ? poolTokenReserve : launchInternalPoolTokens,
liquidity_usd: toNumber(row.liquidity_usd, 0),
current_liquidity_usd: toNumber(row.current_liquidity_usd, 0),
sol_usd_price: toNumber(row.sol_usd_price, 0),
price: toNumber(row.price, 0),
market_cap: toNumber(row.market_cap, 0),
volume_24h: toNumber(row.volume_24h, 0),

website_url: cleanText(row.website_url, 500),
x_url: cleanText(row.x_url, 500),
telegram_url: cleanText(row.telegram_url, 500),
discord_url: cleanText(row.discord_url, 500),

committed_sol: toNumber(row.committed_sol, 0),
participant_count: toNumber(row.participants_count, 0),
participants_count: toNumber(row.participants_count, 0),
hard_cap_sol: toNumber(row.hard_cap_sol, 0),
min_raise_sol: toNumber(row.min_raise_sol, 0),

builder_pct: toNumber(row.builder_pct, 0),
team_allocation_pct: toNumber(row.team_allocation_pct, 0),
team_wallet_breakdown: Array.isArray(row.team_wallet_breakdown)
? row.team_wallet_breakdown
: parseJsonMaybe(row.team_wallet_breakdown, []),

countdown_started_at: row.countdown_started_at || null,
countdown_ends_at: row.countdown_ends_at || null,
live_at: row.live_at || null,
commit_started_at: row.commit_started_at || null,
commit_ends_at: row.commit_ends_at || null,
created_at: row.created_at || null,
updated_at: row.updated_at || null,

lifecycle: {
internal_sol_reserve: toNumber(row.lifecycle_internal_sol_reserve, 0),
internal_token_reserve: toInt(row.lifecycle_internal_token_reserve, 0),
implied_marketcap_sol: toNumber(row.lifecycle_implied_marketcap_sol, 0),
graduation_status:
cleanText(row.lifecycle_graduation_status, 120) || "internal_live",
graduated: toInt(row.lifecycle_graduated, 0) === 1,
graduation_reason: cleanText(row.lifecycle_graduation_reason, 200) || null,
graduated_at: row.lifecycle_graduated_at || null,
raydium_target_pct: toNumber(row.lifecycle_raydium_target_pct, 50),
mss_locked_target_pct: toNumber(row.lifecycle_mss_locked_target_pct, 50),
raydium_pool_id: cleanText(row.lifecycle_raydium_pool_id, 200) || null,
raydium_sol_migrated: toNumber(row.lifecycle_raydium_sol_migrated, 0),
raydium_token_migrated: toInt(row.lifecycle_raydium_token_migrated, 0),
raydium_lp_tokens: cleanText(row.lifecycle_raydium_lp_tokens, 200) || null,
raydium_migration_tx:
cleanText(row.lifecycle_raydium_migration_tx, 300) || null,
mss_locked_sol: toNumber(row.lifecycle_mss_locked_sol, 0),
mss_locked_token: toInt(row.lifecycle_mss_locked_token, 0),
mss_locked_lp_amount:
cleanText(row.lifecycle_mss_locked_lp_amount, 200) || null,
lock_status: cleanText(row.lifecycle_lock_status, 120) || "not_locked",
lock_tx: cleanText(row.lifecycle_lock_tx, 300) || null,
lock_expires_at: row.lifecycle_lock_expires_at || null,
},

builder_vesting: {
builder_wallet: cleanText(row.vesting_builder_wallet, 120) || null,
total_allocation: toInt(row.vesting_total_allocation, 0),
daily_unlock: toInt(row.vesting_daily_unlock, 0),
unlocked_amount: toInt(row.vesting_unlocked_amount, 0),
locked_amount: toInt(row.vesting_locked_amount, 0),
vesting_start_at: row.vesting_start_at || null,
created_at: row.vesting_created_at || null,
updated_at: row.vesting_updated_at || null,
},
};
}

function pickTokenRow(row) {
if (!row) return null;

return {
id: row.id,
launch_id: row.launch_id,
name: row.name,
symbol: row.symbol,
supply: toNumber(row.supply, 0),
mint_address: cleanText(row.mint_address, 120) || null,
created_at: row.created_at || null,
};
}

function pickPoolRow(row) {
if (!row) return null;

return {
id: row.id,
launch_id: row.launch_id,
status: row.status || null,
token_reserve: toNumber(row.token_reserve, 0),
sol_reserve: toNumber(row.sol_reserve, 0),
k_value: toNumber(row.k_value, 0),
initial_token_reserve: toNumber(row.initial_token_reserve, 0),
created_at: row.created_at || null,
};
}

function normalizeTradeRow(row) {
const solAmount = toNumber(row.sol_amount, 0);
const tokenAmount = toNumber(row.token_amount, 0);
const explicitPrice = toNumber(row.price, 0);
const derivedPrice = tokenAmount > 0 ? solAmount / tokenAmount : 0;
const executionPrice = explicitPrice > 0 ? explicitPrice : derivedPrice;

return {
id: row.id,
launch_id: row.launch_id,
token_id: row.token_id,
wallet: cleanText(row.wallet, 120),
side: String(row.side || "").toLowerCase() === "sell" ? "sell" : "buy",
price_sol: executionPrice,
price: executionPrice,
token_amount: tokenAmount,
base_amount: solAmount,
sol_amount: solAmount,
timestamp: row.created_at,
created_at: row.created_at,
};
}

async function getTokenByLaunchId(db, launchId) {
const hasTokens = await tableExists(db, "tokens");
if (!hasTokens) return null;

const row = await db.get(
`
SELECT *
FROM tokens
WHERE launch_id = ?
ORDER BY id DESC
LIMIT 1
`,
[launchId]
);

return pickTokenRow(row);
}

async function getPoolByLaunchId(db, launchId) {
const hasPools = await tableExists(db, "pools");
if (!hasPools) return null;

const row = await db.get(
`
SELECT *
FROM pools
WHERE launch_id = ?
ORDER BY id DESC
LIMIT 1
`,
[launchId]
);

return pickPoolRow(row);
}

async function getLaunchById(db, launchId) {
const hasLaunches = await tableExists(db, "launches");
if (!hasLaunches) return null;

const launchRow = await db.get(
`
SELECT *
FROM launches
WHERE id = ?
LIMIT 1
`,
[launchId]
);

if (!launchRow) return null;

const [token, pool] = await Promise.all([
getTokenByLaunchId(db, launchId),
getPoolByLaunchId(db, launchId),
]);

let builderRow = null;
if (launchRow.builder_id && await tableExists(db, "builders")) {
builderRow = await db.get(
`
SELECT *
FROM builders
WHERE id = ?
LIMIT 1
`,
[launchRow.builder_id]
);
}

let lifecycleRow = null;
if (await tableExists(db, "launch_liquidity_lifecycle")) {
lifecycleRow = await db.get(
`
SELECT *
FROM launch_liquidity_lifecycle
WHERE launch_id = ?
LIMIT 1
`,
[launchId]
);
}

let vestingRow = null;
if (await tableExists(db, "builder_vesting")) {
vestingRow = await db.get(
`
SELECT *
FROM builder_vesting
WHERE launch_id = ?
LIMIT 1
`,
[launchId]
);
}

const merged = {
...launchRow,

builder_wallet:
cleanText(launchRow.builder_wallet, 120) ||
cleanText(builderRow?.wallet, 120) ||
null,
builder_alias: builderRow?.alias || null,
builder_score: builderRow?.builder_score ?? 0,

sol_reserve: pool?.sol_reserve ?? 0,
token_reserve: pool?.token_reserve ?? 0,
token_mint_address: token?.mint_address || null,

lifecycle_internal_sol_reserve: lifecycleRow?.internal_sol_reserve,
lifecycle_internal_token_reserve: lifecycleRow?.internal_token_reserve,
lifecycle_implied_marketcap_sol: lifecycleRow?.implied_marketcap_sol,
lifecycle_graduation_status: lifecycleRow?.graduation_status,
lifecycle_graduated: lifecycleRow?.graduated,
lifecycle_graduation_reason: lifecycleRow?.graduation_reason,
lifecycle_graduated_at: lifecycleRow?.graduated_at,
lifecycle_raydium_target_pct: lifecycleRow?.raydium_target_pct,
lifecycle_mss_locked_target_pct: lifecycleRow?.mss_locked_target_pct,
lifecycle_raydium_pool_id: lifecycleRow?.raydium_pool_id,
lifecycle_raydium_sol_migrated: lifecycleRow?.raydium_sol_migrated,
lifecycle_raydium_token_migrated: lifecycleRow?.raydium_token_migrated,
lifecycle_raydium_lp_tokens: lifecycleRow?.raydium_lp_tokens,
lifecycle_raydium_migration_tx: lifecycleRow?.raydium_migration_tx,
lifecycle_mss_locked_sol: lifecycleRow?.mss_locked_sol,
lifecycle_mss_locked_token: lifecycleRow?.mss_locked_token,
lifecycle_mss_locked_lp_amount: lifecycleRow?.mss_locked_lp_amount,
lifecycle_lock_status: lifecycleRow?.lock_status,
lifecycle_lock_tx: lifecycleRow?.lock_tx,
lifecycle_lock_expires_at: lifecycleRow?.lock_expires_at,

vesting_builder_wallet: vestingRow?.builder_wallet,
vesting_total_allocation: vestingRow?.total_allocation,
vesting_daily_unlock: vestingRow?.daily_unlock,
vesting_unlocked_amount: vestingRow?.unlocked_amount,
vesting_locked_amount: vestingRow?.locked_amount,
vesting_start_at: vestingRow?.vesting_start_at,
vesting_created_at: vestingRow?.created_at,
vesting_updated_at: vestingRow?.updated_at,
};

return pickLaunchRow(merged);
}

async function getTradeRows(db, launchId, limit = 2000) {
const hasTrades = await tableExists(db, "trades");
if (!hasTrades) return [];

const rows = await db.all(
`
SELECT *
FROM trades
WHERE launch_id = ?
ORDER BY datetime(created_at) ASC, id ASC
LIMIT ?
`,
[launchId, limit]
);

return rows.map(normalizeTradeRow);
}

function buildCassiePayload(launch = {}, stats = {}) {
const absMove = Math.abs(toNumber(stats?.price_change_pct, 0));
const buyCount = toNumber(stats?.buys_24h, 0);
const sellCount = toNumber(stats?.sells_24h, 0);
const imbalance = Math.abs(buyCount - sellCount);

let riskState = "normal";
if (absMove >= 25 || imbalance >= 10) {
riskState = "elevated";
} else if (absMove >= 12 || imbalance >= 5) {
riskState = "active";
}

return {
monitoring_active: true,
phase: String(launch?.status || "").toLowerCase() || "commit",
layer: "market-intelligence",
risk_state: riskState,
};
}

function buildStatsInput({ launch, token, pool }) {
const totalSupply = toNumber(
token?.supply ?? launch?.final_supply ?? launch?.supply,
0
);

const circulatingSupply = toNumber(
launch?.circulating_supply ?? totalSupply,
0
);

const oneSidedLiquiditySol = toNumber(
pool?.sol_reserve ??
launch?.lifecycle?.internal_sol_reserve ??
launch?.internal_pool_sol ??
launch?.liquidity ??
0,
0
);

const internalTokenReserve = toNumber(
pool?.token_reserve ??
launch?.lifecycle?.internal_token_reserve ??
launch?.internal_pool_tokens ??
0,
0
);

return {
...(launch || {}),
mint_address:
token?.mint_address || launch?.mint_address || launch?.contract_address || null,
total_supply: totalSupply,
circulating_supply: circulatingSupply,
liquidity: oneSidedLiquiditySol,
liquidity_sol: oneSidedLiquiditySol,
internal_pool_sol: oneSidedLiquiditySol,
internal_pool_tokens: internalTokenReserve,
sol_usd_price: toNumber(launch?.sol_usd_price, 0),
price: toNumber(launch?.price, 0),
market_cap: toNumber(launch?.market_cap, 0),
volume_24h: toNumber(launch?.volume_24h, 0),
};
}

function getLiveDays(launch = {}) {
const liveMs = parseDbTime(launch?.live_at || launch?.updated_at || launch?.created_at);
if (!liveMs) return 0;
return Math.max(0, Math.floor((Date.now() - liveMs) / 86400000));
}

function getBuilderAllocationPercent(launch = {}) {
const builderPct = toNumber(launch?.builder_pct, 0);
const teamAllocationPct = toNumber(launch?.team_allocation_pct, 0);

if (builderPct > 0) return builderPct;
if (teamAllocationPct > 0) return teamAllocationPct;

return BUILDER_MAX_ALLOCATION_PERCENT;
}

function buildFallbackBuilderVestingSummary({
launch,
wallet,
tokenBalance,
}) {
const cleanWallet = normalizeWallet(wallet);
const builderWallet = normalizeWallet(launch?.builder_wallet);
const template = String(launch?.template || "").toLowerCase();
const totalSupply = toNumber(
launch?.final_supply ?? launch?.total_supply ?? launch?.supply,
0
);

const isBuilderWallet = Boolean(
template === "builder" &&
builderWallet &&
cleanWallet &&
builderWallet === cleanWallet
);

if (!isBuilderWallet || totalSupply <= 0) {
return {
is_builder_wallet: false,
vesting_active: false,
builder_total_allocation_tokens: 0,
builder_unlocked_tokens: tokenBalance,
builder_locked_tokens: 0,
builder_sellable_tokens: tokenBalance,
builder_vesting_percent_unlocked: 100,
builder_vesting_days_live: getLiveDays(launch),
builder_daily_unlock_tokens: 0,
};
}

const allocationPct = Math.min(
BUILDER_MAX_ALLOCATION_PERCENT,
Math.max(0, getBuilderAllocationPercent(launch))
);

const daysLive = getLiveDays(launch);
const unlockedPct = Math.min(
allocationPct,
Math.max(BUILDER_DAILY_UNLOCK_PERCENT, daysLive * BUILDER_DAILY_UNLOCK_PERCENT)
);

const totalAllocationTokens = Math.floor((totalSupply * allocationPct) / 100);
const unlockedAllocationTokens = Math.floor((totalSupply * unlockedPct) / 100);
const lockedAllocationTokens = Math.max(0, totalAllocationTokens - unlockedAllocationTokens);

const sellableTokens = Math.max(
0,
Math.min(tokenBalance, unlockedAllocationTokens)
);

const unlockedVisibleTokens = Math.max(
0,
Math.min(tokenBalance, unlockedAllocationTokens)
);

const lockedVisibleTokens = Math.max(
0,
tokenBalance - unlockedVisibleTokens
);

return {
is_builder_wallet: true,
vesting_active: lockedAllocationTokens > 0,
builder_total_allocation_tokens: totalAllocationTokens,
builder_unlocked_tokens: unlockedVisibleTokens,
builder_locked_tokens: Math.max(lockedAllocationTokens, lockedVisibleTokens),
builder_sellable_tokens: sellableTokens,
builder_vesting_percent_unlocked:
allocationPct > 0 ? (unlockedPct / allocationPct) * 100 : 100,
builder_vesting_days_live: daysLive,
builder_daily_unlock_tokens: Math.floor((totalSupply * BUILDER_DAILY_UNLOCK_PERCENT) / 100),
};
}

function buildBuilderVestingSummary({
launch,
wallet,
tokenBalance,
}) {
const cleanWallet = normalizeWallet(wallet);
const builderWallet = normalizeWallet(launch?.builder_wallet);
const vestingWallet = normalizeWallet(launch?.builder_vesting?.builder_wallet);
const template = String(launch?.template || "").toLowerCase();

const isBuilderWallet = Boolean(
template === "builder" &&
cleanWallet &&
(builderWallet === cleanWallet || vestingWallet === cleanWallet)
);

if (!isBuilderWallet) {
return {
is_builder_wallet: false,
vesting_active: false,
builder_total_allocation_tokens: 0,
builder_unlocked_tokens: tokenBalance,
builder_locked_tokens: 0,
builder_sellable_tokens: tokenBalance,
builder_vesting_percent_unlocked: 100,
builder_vesting_days_live: getLiveDays(launch),
builder_daily_unlock_tokens: 0,
};
}

const vesting = launch?.builder_vesting || {};
const totalAllocation = toInt(vesting.total_allocation, 0);
const unlockedAmount = toInt(vesting.unlocked_amount, 0);
const lockedAmount = toInt(vesting.locked_amount, 0);
const dailyUnlock = toInt(vesting.daily_unlock, 0);

const vestingStartMs = parseDbTime(
vesting.vesting_start_at || vesting.created_at || launch?.live_at || launch?.created_at
);

const vestedDays = vestingStartMs
? Math.max(0, Math.floor((Date.now() - vestingStartMs) / 86400000))
: getLiveDays(launch);

if (totalAllocation > 0 || unlockedAmount > 0 || lockedAmount > 0 || dailyUnlock > 0) {
const visibleUnlocked = Math.max(0, Math.min(tokenBalance, unlockedAmount));
const visibleLocked = Math.max(
0,
Math.max(lockedAmount, tokenBalance - visibleUnlocked)
);
const sellable = Math.max(0, Math.min(tokenBalance, visibleUnlocked));
const percentUnlocked =
totalAllocation > 0
? Math.min(100, (Math.max(0, unlockedAmount) / totalAllocation) * 100)
: 100;

return {
is_builder_wallet: true,
vesting_active: visibleLocked > 0 || lockedAmount > 0,
builder_total_allocation_tokens: totalAllocation,
builder_unlocked_tokens: visibleUnlocked,
builder_locked_tokens: visibleLocked,
builder_sellable_tokens: sellable,
builder_vesting_percent_unlocked: percentUnlocked,
builder_vesting_days_live: vestedDays,
builder_daily_unlock_tokens: dailyUnlock,
};
}

return buildFallbackBuilderVestingSummary({
launch,
wallet,
tokenBalance,
});
}

async function getWalletSolBalanceSnapshot(db, launchId, wallet) {
const cleanWallet = cleanText(wallet, 120);
if (!cleanWallet) return null;

const hasWalletBalances = await tableExists(db, "wallet_balances");
if (!hasWalletBalances) return null;

const columnSet = await getWalletBalanceColumns(db);
if (!columnSet.has("sol_balance")) return null;

const row = await db.get(
`
SELECT sol_balance
FROM wallet_balances
WHERE launch_id = ? AND wallet = ?
ORDER BY id DESC
LIMIT 1
`,
[launchId, cleanWallet]
);

if (!row) return null;
return toNumber(row.sol_balance, null);
}

function getLatestTradePriceSol(trades = []) {
if (!Array.isArray(trades) || !trades.length) return 0;

for (let i = trades.length - 1; i >= 0; i -= 1) {
const trade = trades[i];
const price =
toNumber(trade?.price_sol, 0) ||
toNumber(trade?.price, 0) ||
(
toNumber(trade?.token_amount, 0) > 0
? toNumber(trade?.sol_amount ?? trade?.base_amount, 0) / toNumber(trade?.token_amount, 0)
: 0
);

if (price > 0) return price;
}

return 0;
}

function getPoolSpotPriceSol(pool = {}, launch = {}) {
const tokenReserve = toNumber(
pool?.token_reserve ??
launch?.lifecycle?.internal_token_reserve ??
launch?.internal_pool_tokens,
0
);
const solReserve = toNumber(
pool?.sol_reserve ??
launch?.lifecycle?.internal_sol_reserve ??
launch?.internal_pool_sol ??
launch?.liquidity,
0
);

if (tokenReserve <= 0 || solReserve <= 0) return 0;
return solReserve / tokenReserve;
}

function finalizeMarketStats({
stats = {},
launch = {},
token = {},
pool = {},
trades = [],
}) {
const finalized = { ...(stats || {}) };

const totalSupply = toNumber(
finalized.total_supply ??
token?.supply ??
launch?.final_supply ??
launch?.supply,
0
);

const circulatingSupply = toNumber(
finalized.circulating_supply ??
launch?.circulating_supply ??
totalSupply,
totalSupply
);

const priceSol =
toNumber(finalized.price_sol, 0) ||
toNumber(finalized.price, 0) ||
toNumber(launch?.price, 0) ||
getLatestTradePriceSol(trades) ||
getPoolSpotPriceSol(pool, launch);

const solUsdPrice =
toNumber(finalized.sol_usd_price, 0) ||
toNumber(launch?.sol_usd_price, 0);

const oneSidedLiquiditySol =
toNumber(finalized.liquidity_sol, 0) ||
toNumber(finalized.liquidity, 0) ||
toNumber(pool?.sol_reserve, 0) ||
toNumber(launch?.lifecycle?.internal_sol_reserve, 0) ||
toNumber(launch?.internal_pool_sol, 0) ||
toNumber(launch?.liquidity, 0);

const marketCapSol =
toNumber(finalized.market_cap_sol, 0) ||
toNumber(finalized.market_cap, 0) ||
toNumber(launch?.market_cap, 0) ||
(priceSol > 0 && circulatingSupply > 0 ? priceSol * circulatingSupply : 0);

const volume24hSol =
toNumber(finalized.volume_24h_sol, 0) ||
toNumber(finalized.volume_24h, 0) ||
toNumber(launch?.volume_24h, 0);

const liquidityUsd =
toNumber(finalized.liquidity_usd, 0) ||
toNumber(launch?.current_liquidity_usd, 0) ||
toNumber(launch?.liquidity_usd, 0) ||
(solUsdPrice > 0 && oneSidedLiquiditySol > 0 ? oneSidedLiquiditySol * solUsdPrice : 0);

const marketCapUsd =
toNumber(finalized.market_cap_usd, 0) ||
(solUsdPrice > 0 && marketCapSol > 0 ? marketCapSol * solUsdPrice : 0);

const volume24hUsd =
toNumber(finalized.volume_24h_usd, 0) ||
(solUsdPrice > 0 && volume24hSol > 0 ? volume24hSol * solUsdPrice : 0);

finalized.total_supply = totalSupply;
finalized.circulating_supply = circulatingSupply;

finalized.price_sol = priceSol;
finalized.price = priceSol;
finalized.price_usd =
toNumber(finalized.price_usd, 0) ||
(solUsdPrice > 0 && priceSol > 0 ? priceSol * solUsdPrice : 0);

finalized.sol_usd_price = solUsdPrice;

finalized.liquidity = oneSidedLiquiditySol;
finalized.liquidity_sol = oneSidedLiquiditySol;
finalized.liquidity_usd = liquidityUsd;

finalized.market_cap = marketCapSol;
finalized.market_cap_sol = marketCapSol;
finalized.market_cap_usd = marketCapUsd;

finalized.volume_24h = volume24hSol;
finalized.volume_24h_sol = volume24hSol;
finalized.volume_24h_usd = volume24hUsd;

return finalized;
}

async function buildWalletSummary({
db,
launchId,
launch,
token,
trades,
wallet,
priceUsd = 0,
}) {
const cleanWallet = cleanText(wallet, 120);
if (!cleanWallet) {
return {
token_balance: 0,
tokenBalance: 0,
total_balance: 0,
totalBalance: 0,
position_value_usd: 0,
positionValueUsd: 0,
sol_balance: 0,
solBalance: 0,
sol_delta: 0,
solDelta: 0,

sellable_balance: 0,
sellableBalance: 0,
sellable_token_balance: 0,
sellableTokenBalance: 0,

locked_balance: 0,
lockedBalance: 0,
locked_token_balance: 0,
lockedTokenBalance: 0,

unlocked_balance: 0,
unlockedBalance: 0,
unlocked_token_balance: 0,
unlockedTokenBalance: 0,

is_builder_wallet: false,
wallet_is_builder: false,
vesting_active: false,
wallet_vesting_active: false,

builder_total_allocation_tokens: 0,
builder_unlocked_tokens: 0,
builder_locked_tokens: 0,
builder_sellable_tokens: 0,
builder_vesting_percent_unlocked: 0,
builder_vesting_days_live: 0,
builder_daily_unlock_tokens: 0,
};
}

let walletRow = null;
const hasWalletBalances = await tableExists(db, "wallet_balances");
if (hasWalletBalances) {
walletRow = await db.get(
`
SELECT token_amount
FROM wallet_balances
WHERE launch_id = ? AND wallet = ?
ORDER BY id DESC
LIMIT 1
`,
[launchId, cleanWallet]
);
}

let tokenBalance = Math.max(0, Math.floor(toNumber(walletRow?.token_amount, 0)));

if (tokenBalance <= 0) {
let derivedBalance = 0;
const targetWallet = normalizeWallet(cleanWallet);

for (const trade of trades) {
const sameWallet = normalizeWallet(trade.wallet) === targetWallet;
if (!sameWallet) continue;

if (String(trade.side || "").toLowerCase() === "sell") {
derivedBalance -= toNumber(trade.token_amount, 0);
} else {
derivedBalance += toNumber(trade.token_amount, 0);
}
}

tokenBalance = Math.max(0, Math.floor(derivedBalance));
}

let walletSolDelta = 0;
const targetWallet = normalizeWallet(cleanWallet);

for (const trade of trades) {
const sameWallet = normalizeWallet(trade.wallet) === targetWallet;
if (!sameWallet) continue;

const tradeSol = toNumber(trade.sol_amount ?? trade.base_amount, 0);

if (String(trade.side || "").toLowerCase() === "sell") {
walletSolDelta += tradeSol;
} else {
walletSolDelta -= tradeSol;
}
}

const walletSolSnapshot = await getWalletSolBalanceSnapshot(db, launchId, cleanWallet);

const vesting = buildBuilderVestingSummary({
launch,
wallet: cleanWallet,
tokenBalance,
});

const sellableBalance = vesting.builder_sellable_tokens;
const unlockedBalance = vesting.builder_unlocked_tokens;
const lockedBalance = vesting.builder_locked_tokens;
const totalBalance = tokenBalance;

const positionValueUsd =
tokenBalance > 0 && priceUsd > 0
? tokenBalance * priceUsd
: 0;

const visibleSolBalance =
walletSolSnapshot != null
? walletSolSnapshot
: walletSolDelta;

return {
token_balance: tokenBalance,
tokenBalance: tokenBalance,
total_balance: totalBalance,
totalBalance: totalBalance,

position_value_usd: positionValueUsd,
positionValueUsd: positionValueUsd,

sol_balance: visibleSolBalance,
solBalance: visibleSolBalance,
sol_delta: walletSolDelta,
solDelta: walletSolDelta,

sellable_balance: sellableBalance,
sellableBalance: sellableBalance,
sellable_token_balance: sellableBalance,
sellableTokenBalance: sellableBalance,

locked_balance: lockedBalance,
lockedBalance: lockedBalance,
locked_token_balance: lockedBalance,
lockedTokenBalance: lockedBalance,

unlocked_balance: unlockedBalance,
unlockedBalance: unlockedBalance,
unlocked_token_balance: unlockedBalance,
unlockedTokenBalance: unlockedBalance,

is_builder_wallet: vesting.is_builder_wallet,
wallet_is_builder: vesting.is_builder_wallet,
vesting_active: vesting.vesting_active,
wallet_vesting_active: vesting.vesting_active,

builder_total_allocation_tokens: vesting.builder_total_allocation_tokens,
builder_unlocked_tokens: vesting.builder_unlocked_tokens,
builder_locked_tokens: vesting.builder_locked_tokens,
builder_sellable_tokens: vesting.builder_sellable_tokens,
builder_vesting_percent_unlocked: vesting.builder_vesting_percent_unlocked,
builder_vesting_days_live: vesting.builder_vesting_days_live,
builder_daily_unlock_tokens: vesting.builder_daily_unlock_tokens,
};
}

function attachWalletStats(stats = {}, walletSummary = {}) {
return {
...stats,

wallet_token_balance: walletSummary.token_balance,
wallet_total_balance: walletSummary.total_balance,
wallet_position_value_usd: walletSummary.position_value_usd,
wallet_sol_balance: walletSummary.sol_balance,
wallet_sol_delta: walletSummary.sol_delta,

wallet_sellable_balance: walletSummary.sellable_balance,
wallet_sellable_token_balance: walletSummary.sellable_token_balance,
wallet_locked_balance: walletSummary.locked_balance,
wallet_locked_token_balance: walletSummary.locked_token_balance,
wallet_unlocked_balance: walletSummary.unlocked_balance,
wallet_unlocked_token_balance: walletSummary.unlocked_token_balance,

wallet_is_builder: walletSummary.wallet_is_builder,
wallet_vesting_active: walletSummary.wallet_vesting_active,

is_builder_wallet: walletSummary.is_builder_wallet,
builder_total_allocation_tokens: walletSummary.builder_total_allocation_tokens,
builder_unlocked_tokens: walletSummary.builder_unlocked_tokens,
builder_locked_tokens: walletSummary.builder_locked_tokens,
builder_sellable_tokens: walletSummary.builder_sellable_tokens,
builder_vesting_percent_unlocked: walletSummary.builder_vesting_percent_unlocked,
builder_vesting_days_live: walletSummary.builder_vesting_days_live,
builder_daily_unlock_tokens: walletSummary.builder_daily_unlock_tokens,
};
}

export async function getChartCandles({
db,
launchId,
interval = "1m",
limit = 120,
}) {
const [launch, token, pool, trades] = await Promise.all([
getLaunchById(db, launchId),
getTokenByLaunchId(db, launchId),
getPoolByLaunchId(db, launchId),
getTradeRows(db, launchId, 2000),
]);

const candles = fillMissingCandles(
buildCandlesFromTrades(trades, interval),
interval,
limit
);

const stats = finalizeMarketStats({
stats: buildMarketStats({
launch: buildStatsInput({ launch, token, pool }),
trades,
candles,
}),
launch,
token,
pool,
trades,
});

return {
launch,
token,
pool,
stats,
candles,
};
}

export async function getChartTrades({
db,
launchId,
limit = 50,
}) {
const [launch, token, pool, trades] = await Promise.all([
getLaunchById(db, launchId),
getTokenByLaunchId(db, launchId),
getPoolByLaunchId(db, launchId),
getTradeRows(db, launchId, Math.max(limit, 1)),
]);

const recentTrades = trades.slice(-limit);

const stats = finalizeMarketStats({
stats: buildMarketStats({
launch: buildStatsInput({ launch, token, pool }),
trades,
candles: [],
}),
launch,
token,
pool,
trades,
});

return {
launch,
token,
pool,
stats,
trades: recentTrades,
};
}

export async function getChartStats({
db,
launchId,
wallet = "",
}) {
const [launch, token, pool, trades] = await Promise.all([
getLaunchById(db, launchId),
getTokenByLaunchId(db, launchId),
getPoolByLaunchId(db, launchId),
getTradeRows(db, launchId, 2000),
]);

const candles = buildCandlesFromTrades(trades, "1m");

const stats = finalizeMarketStats({
stats: buildMarketStats({
launch: buildStatsInput({ launch, token, pool }),
trades,
candles,
}),
launch,
token,
pool,
trades,
});

const walletSummary = await buildWalletSummary({
db,
launchId,
launch,
token,
trades,
wallet,
priceUsd: toNumber(stats.price_usd, 0),
});

return {
launch,
token,
pool,
wallet: walletSummary,
cassie: buildCassiePayload(launch, stats),
stats: attachWalletStats(stats, walletSummary),
};
}

export async function getChartSnapshot({
db,
launchId,
interval = "1m",
candleLimit = 120,
tradeLimit = 50,
wallet = "",
}) {
const [launch, token, pool, trades] = await Promise.all([
getLaunchById(db, launchId),
getTokenByLaunchId(db, launchId),
getPoolByLaunchId(db, launchId),
getTradeRows(db, launchId, 2000),
]);

const candles = fillMissingCandles(
buildCandlesFromTrades(trades, interval),
interval,
candleLimit
);

const recentTrades = trades.slice(-tradeLimit);

const stats = finalizeMarketStats({
stats: buildMarketStats({
launch: buildStatsInput({ launch, token, pool }),
trades,
candles,
}),
launch,
token,
pool,
trades,
});

const walletSummary = await buildWalletSummary({
db,
launchId,
launch,
token,
trades,
wallet,
priceUsd: toNumber(stats.price_usd, 0),
});

return {
launch,
token,
pool,
wallet: walletSummary,
cassie: buildCassiePayload(launch, stats),
stats: attachWalletStats(stats, walletSummary),
candles,
trades: recentTrades,
};
}
