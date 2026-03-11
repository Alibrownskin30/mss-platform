import express from "express";
import db from "../db/index.js";

const router = express.Router();

router.get("/:launchId", async (req, res) => {
try {
const launchId = Number(req.params.launchId);

if (!launchId) {
return res.status(400).json({ error: "Invalid launchId" });
}

const token = await db.get(
`SELECT * FROM tokens WHERE launch_id = ?`,
[launchId]
);

if (!token) {
return res.status(404).json({ error: "Token not found" });
}

const pool = await db.get(
`SELECT * FROM pools WHERE launch_id = ?`,
[launchId]
);

if (!pool) {
return res.status(404).json({ error: "Pool not found" });
}

const tradesAgg = await db.get(
`
SELECT
COUNT(*) as trade_count,
COALESCE(SUM(sol_amount), 0) as volume_sol
FROM trades
WHERE launch_id = ?
`,
[launchId]
);

const priceInSol = Number(pool.sol_reserve) / Number(pool.token_reserve);
const marketCapInSol = priceInSol * Number(token.supply);
const liquidityInSol = Number(pool.sol_reserve) * 2;

return res.json({
success: true,
token: {
id: token.id,
launch_id: token.launch_id,
name: token.name,
symbol: token.symbol,
supply: token.supply,
mint_address: token.mint_address
},
stats: {
priceInSol,
marketCapInSol,
liquidityInSol,
volumeSol: Number(tradesAgg.volume_sol),
tradeCount: Number(tradesAgg.trade_count)
},
pool: {
token_reserve: Number(pool.token_reserve),
sol_reserve: Number(pool.sol_reserve),
k_value: Number(pool.k_value)
}
});

} catch (err) {
console.error("TOKEN STATS error:", err);
return res.status(500).json({ error: "Failed to fetch token stats" });
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
trades
});

} catch (err) {
console.error("TOKEN TRADES error:", err);
return res.status(500).json({ error: "Failed to fetch trades" });
}
});

export default router;