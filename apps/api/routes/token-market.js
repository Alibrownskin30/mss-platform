import express from "express";
import launcherDb from "../db/index.js";
import { getChartSnapshot } from "../services/chart-service.js";

const router = express.Router();

function toNumber(value, fallback = 0) {
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function clampNumber(value, min, max, fallback) {
const num = Number(value);
if (!Number.isFinite(num)) return fallback;
return Math.min(max, Math.max(min, num));
}

function pickLaunchRow(row) {
if (!row) return null;

return {
id: row.id,
token_name: row.token_name,
symbol: row.symbol,
status: row.status,
contract_address: row.contract_address,
builder_wallet: row.builder_wallet,
website_url: row.website_url,
x_url: row.x_url,
telegram_url: row.telegram_url,
discord_url: row.discord_url,
committed_sol: toNumber(row.committed_sol, 0),
participants_count: toNumber(row.participants_count, 0),
hard_cap_sol: toNumber(row.hard_cap_sol, 0),
countdown_started_at: row.countdown_started_at,
countdown_ends_at: row.countdown_ends_at,
live_at: row.live_at,
commit_started_at: row.commit_started_at,
commit_ends_at: row.commit_ends_at,
supply: row.supply,
final_supply: row.final_supply,
circulating_supply: toNumber(row.circulating_supply, 0),
liquidity: toNumber(row.liquidity, 0),
liquidity_usd: toNumber(row.liquidity_usd, 0),
current_liquidity_usd: toNumber(row.current_liquidity_usd, 0),
};
}

router.get("/:mint", async (req, res) => {
try {
const mint = String(req.params.mint || "").trim();

if (!mint) {
return res.status(400).json({
ok: false,
error: "Mint is required",
});
}

const tokenRow = await launcherDb.get(
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
WHERE mint_address = ?
LIMIT 1
`,
[mint]
);

if (!tokenRow) {
return res.status(404).json({
ok: false,
error: "Token not found for mint",
});
}

const launchRow = await launcherDb.get(
`
SELECT
id,
token_name,
symbol,
status,
contract_address,
builder_wallet,
website_url,
x_url,
telegram_url,
discord_url,
committed_sol,
participants_count,
hard_cap_sol,
countdown_started_at,
countdown_ends_at,
live_at,
commit_started_at,
commit_ends_at,
supply,
final_supply,
circulating_supply,
liquidity,
liquidity_usd,
current_liquidity_usd
FROM launches
WHERE id = ?
LIMIT 1
`,
[tokenRow.launch_id]
);

if (!launchRow) {
return res.status(404).json({
ok: false,
error: "Launch not found for token",
});
}

const interval = String(req.query.interval || "1m");
const candleLimit = clampNumber(req.query.candle_limit, 1, 500, 120);
const tradeLimit = clampNumber(req.query.trade_limit, 1, 200, 50);

const launch = pickLaunchRow(launchRow);

const snapshot = await getChartSnapshot({
db: launcherDb,
launchId: tokenRow.launch_id,
interval,
candleLimit,
tradeLimit,
});

return res.json({
ok: true,
mint,
token: {
id: tokenRow.id,
launch_id: tokenRow.launch_id,
name: tokenRow.name,
symbol: tokenRow.symbol,
supply: tokenRow.supply,
mint_address: tokenRow.mint_address,
created_at: tokenRow.created_at,
},
launch,
chart: {
stats: snapshot?.stats || {},
candles: snapshot?.candles || [],
trades: snapshot?.trades || [],
},
cassie: {
monitoring_active: true,
phase: String(launch?.status || "").toLowerCase() || "commit",
layer: "token-market",
},
});
} catch (error) {
console.error("GET /api/token-market/:mint failed", error);
return res.status(500).json({
ok: false,
error: "Failed to resolve token market",
message: error?.message || String(error),
});
}
});

export default router;
