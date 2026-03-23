import { buildCandlesFromTrades, fillMissingCandles } from "./candle-builder.js";
import { buildMarketStats } from "./market-stats.js";

function toNumber(value, fallback = 0) {
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max);
}

function pickLaunchRow(row) {
if (!row) return null;

const poolSolReserve = toNumber(row.sol_reserve, 0);
const launchInternalPoolSol = toNumber(row.internal_pool_sol, 0);
const launchLiquidity = toNumber(row.liquidity, 0);

const oneSidedLiquiditySol =
poolSolReserve > 0
? poolSolReserve
: launchInternalPoolSol > 0
? launchInternalPoolSol
: launchLiquidity > 0
? launchLiquidity / 2
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
liquidity_usd: toNumber(row.liquidity_usd, 0),
current_liquidity_usd: toNumber(row.current_liquidity_usd, 0),
sol_usd_price: 0,

website_url: cleanText(row.website_url, 500),
x_url: cleanText(row.x_url, 500),
telegram_url: cleanText(row.telegram_url, 500),
discord_url: cleanText(row.discord_url, 500),

committed_sol: toNumber(row.committed_sol, 0),
participant_count: toNumber(row.participants_count, 0),
participants_count: toNumber(row.participants_count, 0),
hard_cap_sol: toNumber(row.hard_cap_sol, 0),

countdown_started_at: row.countdown_started_at || null,
countdown_ends_at: row.countdown_ends_at || null,
live_at: row.live_at || null,
commit_started_at: row.commit_started_at || null,
commit_ends_at: row.commit_ends_at || null,
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
return {
id: row.id,
launch_id: row.launch_id,
token_id: row.token_id,
wallet: cleanText(row.wallet, 120),
side: String(row.side || "").toLowerCase() === "sell" ? "sell" : "buy",
price_sol: toNumber(row.price, 0),
price: toNumber(row.price, 0),
token_amount: toNumber(row.token_amount, 0),
base_amount: toNumber(row.sol_amount, 0),
sol_amount: toNumber(row.sol_amount, 0),
timestamp: row.created_at,
created_at: row.created_at,
};
}

function buildWalletSummary({ launch, token, trades, wallet }) {
const cleanWallet = cleanText(wallet, 120);
if (!cleanWallet) {
return {
token_balance: 0,
tokenBalance: 0,
position_value_usd: 0,
positionValueUsd: 0,
sol_balance: 0,
solBalance: 0,
};
}

let tokenBalance = 0;

for (const trade of trades) {
if (String(trade.wallet || "").trim().toLowerCase() !== cleanWallet.toLowerCase()) {
continue;
}

const tokenDelta =
String(trade.side || "").toLowerCase() === "sell"
? -toNumber(trade.token_amount, 0)
: toNumber(trade.token_amount, 0);

tokenBalance += tokenDelta;
}

tokenBalance = Math.max(0, Math.floor(tokenBalance));

const stats = buildMarketStats({
launch: {
...(launch || {}),
total_supply: toNumber(
token?.supply ?? launch?.final_supply ?? launch?.supply,
0
),
circulating_supply: toNumber(
launch?.circulating_supply ??
token?.supply ??
launch?.final_supply ??
launch?.supply,
0
),
},
trades,
candles: [],
});

const positionValueUsd =
tokenBalance > 0 && toNumber(stats.price_usd, 0) > 0
? tokenBalance * toNumber(stats.price_usd, 0)
: 0;

return {
token_balance: tokenBalance,
tokenBalance,
position_value_usd: positionValueUsd,
positionValueUsd,
sol_balance: 0,
solBalance: 0,
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
l.liquidity,
l.liquidity_usd,
l.current_liquidity_usd,
l.website_url,
l.x_url,
l.telegram_url,
l.discord_url,
l.countdown_started_at,
l.countdown_ends_at,
l.live_at,
l.commit_started_at,
l.commit_ends_at,
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

function buildCassiePayload(launch = {}) {
return {
monitoring_active: true,
phase: String(launch?.status || "").toLowerCase() || "commit",
layer: "market-intelligence",
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
pool?.sol_reserve ?? launch?.internal_pool_sol ?? 0,
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
sol_usd_price: 0,
};
}

export async function getChartCandles({
db,
launchId,
interval = "1m",
limit = 120,
}) {
const trades = await getTradeRows(db, launchId, 2000);

const candles = fillMissingCandles(
buildCandlesFromTrades(trades, interval),
interval,
limit
);

return { candles };
}

export async function getChartTrades({
db,
launchId,
limit = 50,
}) {
const trades = await getTradeRows(db, launchId, Math.max(limit, 1));

return {
trades: trades.slice(-limit),
};
}

export async function getChartStats({
db,
launchId,
wallet = "",
}) {
const [launch, token, pool] = await Promise.all([
getLaunchById(db, launchId),
getTokenByLaunchId(db, launchId),
getPoolByLaunchId(db, launchId),
]);

const trades = await getTradeRows(db, launchId, 2000);
const candles = buildCandlesFromTrades(trades, "1m");

const stats = buildMarketStats({
launch: buildStatsInput({ launch, token, pool }),
trades,
candles,
});

const walletSummary = buildWalletSummary({
launch,
token,
trades,
wallet,
});

return {
launch,
token,
pool,
wallet: walletSummary,
cassie: buildCassiePayload(launch),
stats: {
...stats,
wallet_token_balance: walletSummary.token_balance,
wallet_position_value_usd: walletSummary.position_value_usd,
wallet_sol_balance: walletSummary.sol_balance,
},
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
const [launch, token, pool] = await Promise.all([
getLaunchById(db, launchId),
getTokenByLaunchId(db, launchId),
getPoolByLaunchId(db, launchId),
]);

const trades = await getTradeRows(db, launchId, 2000);

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

const walletSummary = buildWalletSummary({
launch,
token,
trades,
wallet,
});

return {
launch,
token,
pool,
wallet: walletSummary,
cassie: buildCassiePayload(launch),
stats: {
...stats,
wallet_token_balance: walletSummary.token_balance,
wallet_position_value_usd: walletSummary.position_value_usd,
wallet_sol_balance: walletSummary.sol_balance,
},
candles,
trades: recentTrades,
};
}
