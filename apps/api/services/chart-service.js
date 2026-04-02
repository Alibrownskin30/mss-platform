import { buildCandlesFromTrades, fillMissingCandles } from "./candle-builder.js";
import { buildMarketStats } from "./market-stats.js";

const BUILDER_DAILY_UNLOCK_PERCENT = 0.5;
const BUILDER_MAX_ALLOCATION_PERCENT = 5;

function toNumber(value, fallback = 0) {
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
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

function pickLaunchRow(row) {
if (!row) return null;

const poolSolReserve = toNumber(row.sol_reserve, 0);
const launchInternalPoolSol = toNumber(row.internal_pool_sol, 0);
const launchLiquidity = toNumber(row.liquidity, 0);
const poolTokenReserve = toNumber(row.token_reserve, 0);
const launchInternalPoolTokens = toNumber(row.internal_pool_tokens, 0);

const oneSidedLiquiditySol =
poolSolReserve > 0
? poolSolReserve
: launchInternalPoolSol > 0
? launchInternalPoolSol
: launchLiquidity > 0
? launchLiquidity
: 0;

return {
id: row.id,
name: row.token_name,
token_name: row.token_name,
symbol: row.symbol,
status: row.status,
template: row.template,

contract_address: cleanText(row.contract_address, 120) || null,
mint_address:
cleanText(row.token_mint_address, 120) ||
cleanText(row.contract_address, 120) ||
null,

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

website_url: cleanText(row.website_url, 500),
x_url: cleanText(row.x_url, 500),
telegram_url: cleanText(row.telegram_url, 500),
discord_url: cleanText(row.discord_url, 500),

committed_sol: toNumber(row.committed_sol, 0),
participant_count: toNumber(row.participants_count, 0),
participants_count: toNumber(row.participants_count, 0),
hard_cap_sol: toNumber(row.hard_cap_sol, 0),

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

async function getLaunchById(db, launchId) {
const row = await db.get(
`
SELECT
l.id,
l.token_name,
l.symbol,
l.template,
l.status,
l.contract_address,
l.builder_wallet,
l.supply,
l.final_supply,
l.circulating_supply,
l.committed_sol,
l.participants_count,
l.hard_cap_sol,
l.internal_pool_sol,
l.internal_pool_tokens,
l.liquidity,
l.liquidity_usd,
l.current_liquidity_usd,
l.website_url,
l.x_url,
l.telegram_url,
l.discord_url,
l.builder_pct,
l.team_allocation_pct,
l.team_wallet_breakdown,
l.countdown_started_at,
l.countdown_ends_at,
l.live_at,
l.commit_started_at,
l.commit_ends_at,
l.created_at,
l.updated_at,
b.alias AS builder_alias,
b.builder_score AS builder_score,
p.sol_reserve,
p.token_reserve,
t.mint_address AS token_mint_address
FROM launches l
LEFT JOIN builders b
ON b.id = l.builder_id
LEFT JOIN pools p
ON p.id = (
SELECT p2.id
FROM pools p2
WHERE p2.launch_id = l.id
ORDER BY p2.id DESC
LIMIT 1
)
LEFT JOIN tokens t
ON t.id = (
SELECT t2.id
FROM tokens t2
WHERE t2.launch_id = l.id
ORDER BY t2.id DESC
LIMIT 1
)
WHERE l.id = ?
LIMIT 1
`,
[launchId]
);

return pickLaunchRow(row);
}

async function getTokenByLaunchId(db, launchId) {
const row = await db.get(
`
SELECT
id,
launch_id,
name,
symbol,
supply,
mint_address,
created_at
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
const row = await db.get(
`
SELECT
id,
launch_id,
status,
token_reserve,
sol_reserve,
k_value,
initial_token_reserve,
created_at
FROM pools
WHERE launch_id = ?
ORDER BY id DESC
LIMIT 1
`,
[launchId]
);

return pickPoolRow(row);
}

async function getTradeRows(db, launchId, limit = 2000) {
const rows = await db.all(
`
SELECT
id,
launch_id,
token_id,
wallet,
side,
sol_amount,
token_amount,
price,
created_at
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
pool?.sol_reserve ?? launch?.internal_pool_sol ?? launch?.liquidity ?? 0,
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
internal_pool_tokens: toNumber(
pool?.token_reserve ?? launch?.internal_pool_tokens ?? 0,
0
),
sol_usd_price: toNumber(launch?.sol_usd_price, 0),
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

function buildBuilderVestingSummary({
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
};
}

const allocationPct = Math.min(
BUILDER_MAX_ALLOCATION_PERCENT,
Math.max(0, getBuilderAllocationPercent(launch))
);

const daysLive = getLiveDays(launch);
const unlockedPct = Math.min(
allocationPct,
Math.max(0, daysLive * BUILDER_DAILY_UNLOCK_PERCENT)
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
builder_vesting_percent_unlocked: unlockedPct,
builder_vesting_days_live: daysLive,
};
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
};
}

const walletRow = await db.get(
`
SELECT token_amount
FROM wallet_balances
WHERE launch_id = ? AND wallet = ?
LIMIT 1
`,
[launchId, cleanWallet]
);

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
sellableBalance > 0 && priceUsd > 0
? sellableBalance * priceUsd
: tokenBalance > 0 && priceUsd > 0
? tokenBalance * priceUsd
: 0;

return {
token_balance: tokenBalance,
tokenBalance: tokenBalance,
total_balance: totalBalance,
totalBalance: totalBalance,

position_value_usd: positionValueUsd,
positionValueUsd: positionValueUsd,

sol_balance: walletSolDelta,
solBalance: walletSolDelta,
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

const stats = buildMarketStats({
launch: buildStatsInput({ launch, token, pool }),
trades,
candles,
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
const stats = buildMarketStats({
launch: buildStatsInput({ launch, token, pool }),
trades,
candles: [],
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

const stats = buildMarketStats({
launch: buildStatsInput({ launch, token, pool }),
trades,
candles,
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

const stats = buildMarketStats({
launch: buildStatsInput({ launch, token, pool }),
trades,
candles,
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
