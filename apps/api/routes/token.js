import express from "express";
import db from "../db/index.js";
import { buildMarketStats } from "../services/market-stats.js";

const router = express.Router();

function toNumber(value, fallback = 0) {
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function normalizeTradeRow(row) {
return {
id: row.id,
launch_id: row.launch_id,
token_id: row.token_id,
wallet: row.wallet,
side: String(row.side || "").toLowerCase() === "sell" ? "sell" : "buy",
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

function inferCassieRisk(stats = {}) {
const priceChangePct = Math.abs(toNumber(stats.price_change_pct, 0));
const buys24h = toNumber(stats.buys_24h, 0);
const sells24h = toNumber(stats.sells_24h, 0);
const flowImbalance = Math.abs(buys24h - sells24h);

if (priceChangePct >= 25 || flowImbalance >= 10) return "elevated";
if (priceChangePct >= 12 || flowImbalance >= 5) return "active";
return "normal";
}

router.get("/:launchId", async (req, res) => {
try {
const launchId = Number(req.params.launchId);

if (!launchId) {
return res.status(400).json({ ok: false, error: "Invalid launchId" });
}

const launch = await db.get(
`
SELECT
l.id,
l.token_name,
l.symbol,
l.status,
l.template,
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
b.alias AS builder_alias,
b.builder_score AS builder_score
FROM launches l
LEFT JOIN builders b ON b.id = l.builder_id
WHERE l.id = ?
LIMIT 1
`,
[launchId]
);

if (!launch) {
return res.status(404).json({ ok: false, error: "Launch not found" });
}

const token = await db.get(
`
SELECT
*
FROM tokens
WHERE launch_id = ?
ORDER BY id DESC
LIMIT 1
`,
[launchId]
);

const pool = await db.get(
`
SELECT
*
FROM pools
WHERE launch_id = ?
ORDER BY id DESC
LIMIT 1
`,
[launchId]
);

const tradeRows = await db.all(
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
LIMIT 2000
`,
[launchId]
);

const trades = Array.isArray(tradeRows) ? tradeRows.map(normalizeTradeRow) : [];

const tokenReserve = toNumber(pool?.token_reserve, 0);
const solReserve = toNumber(pool?.sol_reserve, 0);
const kValue = toNumber(pool?.k_value, 0);

const mintAddress = token?.mint_address || launch.contract_address || null;

const launchForStats = {
...launch,
mint_address: mintAddress,
total_supply: toNumber(
token?.supply ?? launch.final_supply ?? launch.supply,
0
),
circulating_supply: toNumber(
launch.circulating_supply ??
token?.supply ??
launch.final_supply ??
launch.supply,
0
),
liquidity: solReserve,
liquidity_sol: solReserve,
internal_pool_sol: solReserve,
};

const stats = buildMarketStats({
launch: launchForStats,
trades,
candles: [],
});

const cassieRisk = inferCassieRisk(stats);

return res.json({
ok: true,
success: true,
launch: {
id: launch.id,
token_name: launch.token_name,
symbol: launch.symbol,
status: launch.status,
template: launch.template || null,
contract_address: launch.contract_address || null,
mint_address: mintAddress,
builder_wallet: launch.builder_wallet || null,
builder_alias: launch.builder_alias || null,
builder_score: toNumber(launch.builder_score, 0),
supply: toNumber(launch.supply, 0),
final_supply: toNumber(launch.final_supply ?? launch.supply, 0),
circulating_supply: toNumber(
launch.circulating_supply ?? launch.final_supply ?? launch.supply,
0
),
committed_sol: toNumber(launch.committed_sol, 0),
participants_count: toNumber(launch.participants_count, 0),
hard_cap_sol: toNumber(launch.hard_cap_sol, 0),
internal_pool_sol: toNumber(launch.internal_pool_sol, 0),
liquidity: toNumber(launch.liquidity, 0),
liquidity_usd: toNumber(launch.liquidity_usd, 0),
current_liquidity_usd: toNumber(launch.current_liquidity_usd, 0),
sol_usd_price: toNumber(launch.sol_usd_price, 0),
website_url: launch.website_url || "",
x_url: launch.x_url || "",
telegram_url: launch.telegram_url || "",
discord_url: launch.discord_url || "",
countdown_started_at: launch.countdown_started_at || null,
countdown_ends_at: launch.countdown_ends_at || null,
live_at: launch.live_at || null,
commit_started_at: launch.commit_started_at || null,
commit_ends_at: launch.commit_ends_at || null,
},
token: {
id: token?.id || null,
launch_id: token?.launch_id || launchId,
name: token?.name || launch.token_name || null,
symbol: token?.symbol || launch.symbol || null,
ticker: token?.symbol || launch.symbol || null,
supply: toNumber(token?.supply ?? launch.final_supply ?? launch.supply, 0),
mint_address: mintAddress,
mint: mintAddress,
created_at: token?.created_at || null,
},
stats,
pool: pool
? {
id: pool.id,
status: pool.status || null,
token_reserve: tokenReserve,
sol_reserve: solReserve,
k_value: kValue,
}
: null,
cassie: {
monitoring_active: true,
phase: String(launch.status || "").toLowerCase() || "commit",
layer: "market-intelligence",
risk_state: cassieRisk,
},
});
} catch (err) {
console.error("TOKEN STATS error:", err);
return res.status(500).json({
ok: false,
error: "Failed to fetch token stats",
message: err?.message || String(err),
});
}
});

router.get("/:launchId/trades", async (req, res) => {
try {
const launchId = Number(req.params.launchId);

if (!launchId) {
return res.status(400).json({ ok: false, error: "Invalid launchId" });
}

const trades = await db.all(
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
ORDER BY datetime(created_at) DESC, id DESC
LIMIT 100
`,
[launchId]
);

return res.json({
ok: true,
success: true,
trades: Array.isArray(trades) ? trades.map(normalizeTradeRow).reverse() : [],
});
} catch (err) {
console.error("TOKEN TRADES error:", err);
return res.status(500).json({
ok: false,
error: "Failed to fetch trades",
message: err?.message || String(err),
});
}
});

export default router;