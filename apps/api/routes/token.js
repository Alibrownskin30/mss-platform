import express from "express";
import db from "../db/index.js";

const router = express.Router();

function toNumber(value, fallback = 0) {
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

router.get("/:launchId", async (req, res) => {
try {
const launchId = Number(req.params.launchId);

if (!launchId) {
return res.status(400).json({ error: "Invalid launchId" });
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

const tradesAgg = await db.get(
`
SELECT
COUNT(*) AS trade_count,
COALESCE(SUM(sol_amount), 0) AS volume_sol
FROM trades
WHERE launch_id = ?
`,
[launchId]
);

const tokenReserve = toNumber(pool.token_reserve, 0);
const solReserve = toNumber(pool.sol_reserve, 0);
const supply = toNumber(token.supply, 0);
const kValue = toNumber(pool.k_value, 0);

const priceInSol =
tokenReserve > 0 && solReserve > 0 ? solReserve / tokenReserve : 0;

const marketCapInSol = supply > 0 ? priceInSol * supply : 0;
const liquidityInSol = solReserve > 0 ? solReserve * 2 : 0;

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
stats: {
priceInSol,
marketCapInSol,
liquidityInSol,
volumeSol: toNumber(tradesAgg?.volume_sol, 0),
tradeCount: toNumber(tradesAgg?.trade_count, 0),
},
pool: {
id: pool.id,
status: pool.status,
token_reserve: tokenReserve,
sol_reserve: solReserve,
k_value: kValue,
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