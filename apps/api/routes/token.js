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
side: row.side,
price_sol: toNumber(row.price, 0),
token_amount: toNumber(row.token_amount, 0),
base_amount: toNumber(row.sol_amount, 0),
timestamp: row.created_at,
};
}

router.get("/:launchId", async (req, res) => {
try {
const launchId = Number(req.params.launchId);

if (!launchId) {
return res.status(400).json({ error: "Invalid launchId" });
}

const launch = await db.get(
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

if (!launch) {
return res.status(404).json({ error: "Launch not found" });
}

const token = await db.get(
`
SELECT *
FROM tokens
WHERE launch_id = ?
ORDER BY id DESC
LIMIT 1
`,
[launchId]
);

if (!token) {
return res.status(404).json({ error: "Token not found" });
}

const pool = await db.get(
`
SELECT *
FROM pools
WHERE launch_id = ?
ORDER BY id DESC
LIMIT 1
`,
[launchId]
);

if (!pool) {
return res.status(404).json({ error: "Pool not found" });
}

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
created_at
FROM trades
WHERE launch_id = ?
ORDER BY datetime(created_at) ASC
LIMIT 2000
`,
[launchId]
);

const trades = Array.isArray(tradeRows) ? tradeRows.map(normalizeTradeRow) : [];

const tokenReserve = toNumber(pool.token_reserve, 0);
const solReserve = toNumber(pool.sol_reserve, 0);
const kValue = toNumber(pool.k_value, 0);

const launchForStats = {
...launch,
total_supply: toNumber(token.supply ?? launch.final_supply ?? launch.supply, 0),
circulating_supply: toNumber(
launch.circulating_supply ?? token.supply ?? launch.final_supply ?? launch.supply,
0
),
liquidity_sol: solReserve,
};

const stats = buildMarketStats({
launch: launchForStats,
trades,
candles: [],
});

return res.json({
success: true,
token: {
id: token.id,
launch_id: token.launch_id,
name: token.name,
symbol: token.symbol,
supply: token.supply,
mint_address: token.mint_address || null,
},
stats,
pool: {
id: pool.id,
status: pool.status,
token_reserve: tokenReserve,
sol_reserve: solReserve,
k_value: kValue,
},
cassie: {
monitoring_active: true,
phase: String(launch.status || "").toLowerCase() || "commit",
layer: "market-intelligence",
},
});
} catch (err) {
console.error("TOKEN STATS error:", err);
return res.status(500).json({
error: "Failed to fetch token stats",
message: err?.message || String(err),
});
}
});

router.get("/:launchId/trades", async (req, res) => {
try {
const launchId = Number(req.params.launchId);

if (!launchId) {
return res.status(400).json({ error: "Invalid launchId" });
}

const trades = await db.all(
`
SELECT *
FROM trades
WHERE launch_id = ?
ORDER BY id DESC
LIMIT 50
`,
[launchId]
);

return res.json({
success: true,
trades: Array.isArray(trades) ? trades : [],
});
} catch (err) {
console.error("TOKEN TRADES error:", err);
return res.status(500).json({
error: "Failed to fetch trades",
message: err?.message || String(err),
});
}
});

export default router;