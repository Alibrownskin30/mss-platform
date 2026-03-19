import { buildCandlesFromTrades, fillMissingCandles } from "./candle-builder.js";
import { buildMarketStats } from "./market-stats.js";

function toNumber(value, fallback = 0) {
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function pickLaunchRow(row) {
if (!row) return null;

return {
id: row.id,
name: row.token_name,
symbol: row.symbol,
status: row.status,
contract_address: row.contract_address,
builder_wallet: row.builder_wallet,
total_supply: toNumber(row.final_supply || row.supply, 0),
circulating_supply: toNumber(row.circulating_supply || row.final_supply || row.supply, 0),
liquidity: toNumber(row.liquidity || row.internal_pool_sol, 0),
liquidity_usd: toNumber(row.liquidity_usd, 0),
current_liquidity_usd: toNumber(row.current_liquidity_usd, 0),
website_url: row.website_url,
x_url: row.x_url,
telegram_url: row.telegram_url,
discord_url: row.discord_url,
committed_sol: toNumber(row.committed_sol, 0),
participant_count: toNumber(row.participants_count, 0),
hard_cap_sol: toNumber(row.hard_cap_sol, 0),
countdown_started_at: row.countdown_started_at,
countdown_ends_at: row.countdown_ends_at,
live_at: row.live_at,
commit_started_at: row.commit_started_at,
commit_ends_at: row.commit_ends_at,
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
token_amount: toNumber(row.token_amount, 0),
base_amount: toNumber(row.sol_amount, 0),
timestamp: row.created_at,
};
}

async function getLaunchById(db, launchId) {
const row = await db.get(
`
SELECT
id,
token_name,
symbol,
status,
contract_address,
builder_wallet,
supply,
final_supply,
circulating_supply,
committed_sol,
participants_count,
hard_cap_sol,
internal_pool_sol,
liquidity,
liquidity_usd,
current_liquidity_usd,
website_url,
x_url,
telegram_url,
discord_url,
countdown_started_at,
countdown_ends_at,
live_at,
commit_started_at,
commit_ends_at
FROM launches
WHERE id = ?
LIMIT 1
`,
[launchId]
);

return pickLaunchRow(row);
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
ORDER BY datetime(created_at) ASC
LIMIT ?
`,
[launchId, limit]
);

return rows.map(normalizeTradeRow);
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
const launch = await getLaunchById(db, launchId);
const trades = await getTradeRows(db, launchId, 2000);
const candles = buildCandlesFromTrades(trades, "1m");

const stats = buildMarketStats({
launch: launch || {},
trades,
candles,
});

return { stats };
}

export async function getChartSnapshot({
db,
launchId,
interval = "1m",
candleLimit = 120,
tradeLimit = 50,
}) {
const launch = await getLaunchById(db, launchId);
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
stats,
candles,
trades: recentTrades,
};
}