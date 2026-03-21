import { buildCandlesFromTrades, fillMissingCandles } from "./candle-builder.js";
import { buildMarketStats } from "./market-stats.js";

function toNumber(value, fallback = 0) {
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function pickLaunchRow(row) {
if (!row) return null;

const liquiditySol = toNumber(
row.sol_reserve ?? row.internal_pool_sol ?? row.liquidity ?? 0,
0
);

return {
id: row.id,
name: row.token_name,
token_name: row.token_name,
symbol: row.symbol,
status: row.status,
template: row.template,
contract_address: row.contract_address,
mint_address: row.token_mint_address || row.contract_address || null,
builder_wallet: row.builder_wallet,

supply: toNumber(row.supply, 0),
final_supply: toNumber(row.final_supply || row.supply, 0),
total_supply: toNumber(row.final_supply || row.supply, 0),
circulating_supply: toNumber(
row.circulating_supply || row.final_supply || row.supply,
0
),

liquidity: liquiditySol,
liquidity_sol: liquiditySol,
internal_pool_sol: toNumber(row.internal_pool_sol, 0),
liquidity_usd: toNumber(row.liquidity_usd, 0),
current_liquidity_usd: toNumber(row.current_liquidity_usd, 0),
sol_usd_price: toNumber(row.sol_usd_price, 0),

website_url: row.website_url,
x_url: row.x_url,
telegram_url: row.telegram_url,
discord_url: row.discord_url,

committed_sol: toNumber(row.committed_sol, 0),
participant_count: toNumber(row.participants_count, 0),
participants_count: toNumber(row.participants_count, 0),
hard_cap_sol: toNumber(row.hard_cap_sol, 0),

countdown_started_at: row.countdown_started_at,
countdown_ends_at: row.countdown_ends_at,
live_at: row.live_at,
commit_started_at: row.commit_started_at,
commit_ends_at: row.commit_ends_at,
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
mint_address: row.mint_address || null,
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
};
}

function normalizeTradeRow(row) {
return {
id: row.id,
launch_id: row.launch_id,
token_id: row.token_id,
wallet: row.wallet,
side: row.side,
price_sol: toNumber(row.price, 0),
price: toNumber(row.price, 0),
token_amount: toNumber(row.token_amount, 0),
base_amount: toNumber(row.sol_amount, 0),
sol_amount: toNumber(row.sol_amount, 0),
timestamp: row.created_at,
created_at: row.created_at,
tx_signature: row.tx_signature || null,
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
l.sol_usd_price,
l.website_url,
l.x_url,
l.telegram_url,
l.discord_url,
l.countdown_started_at,
l.countdown_ends_at,
l.live_at,
l.commit_started_at,
l.commit_ends_at,
p.sol_reserve,
p.token_reserve,
t.mint_address AS token_mint_address
FROM launches l
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
k_value
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
tx_signature,
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
}) {
const [launch, token, pool] = await Promise.all([
getLaunchById(db, launchId),
getTokenByLaunchId(db, launchId),
getPoolByLaunchId(db, launchId),
]);

const trades = await getTradeRows(db, launchId, 2000);
const candles = buildCandlesFromTrades(trades, "1m");

const stats = buildMarketStats({
launch: launch || {},
trades,
candles,
});

return {
launch,
token,
pool,
cassie: buildCassiePayload(launch),
stats,
};
}

export async function getChartSnapshot({
db,
launchId,
interval = "1m",
candleLimit = 120,
tradeLimit = 50,
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
launch: launch || {},
trades,
candles,
});

return {
launch,
token,
pool,
cassie: buildCassiePayload(launch),
stats,
candles,
trades: recentTrades,
};
}