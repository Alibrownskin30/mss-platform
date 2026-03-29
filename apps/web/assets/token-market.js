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

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max);
}

function pickLaunchRow(row) {
if (!row) return null;

return {
id: row.id,
token_name: row.token_name,
symbol: row.symbol,
status: row.status,
template: row.template || null,
contract_address: cleanText(row.contract_address, 120) || null,
mint_address:
cleanText(row.token_mint_address, 120) ||
cleanText(row.contract_address, 120) ||
null,
builder_wallet: cleanText(row.builder_wallet, 120) || null,
builder_alias: cleanText(row.builder_alias, 120) || null,
builder_score: toNumber(row.builder_score, 0),
website_url: cleanText(row.website_url, 500),
x_url: cleanText(row.x_url, 500),
telegram_url: cleanText(row.telegram_url, 500),
discord_url: cleanText(row.discord_url, 500),
committed_sol: toNumber(row.committed_sol, 0),
participants_count: toNumber(row.participants_count, 0),
hard_cap_sol: toNumber(row.hard_cap_sol, 0),
countdown_started_at: row.countdown_started_at || null,
countdown_ends_at: row.countdown_ends_at || null,
live_at: row.live_at || null,
commit_started_at: row.commit_started_at || null,
commit_ends_at: row.commit_ends_at || null,
supply: toNumber(row.supply, 0),
final_supply: toNumber(row.final_supply || row.supply, 0),
circulating_supply: toNumber(
row.circulating_supply || row.final_supply || row.supply,
0
),
liquidity: toNumber(row.liquidity, 0),
liquidity_usd: toNumber(row.liquidity_usd, 0),
current_liquidity_usd: toNumber(row.current_liquidity_usd, 0),
internal_pool_sol: toNumber(row.internal_pool_sol, 0),
};
}

router.get("/:mint", async (req, res) => {
try {
const mint = cleanText(req.params.mint, 120);
const wallet = cleanText(req.query.wallet, 120);

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
l.id,
l.token_name,
l.symbol,
l.status,
l.template,
l.contract_address,
l.builder_wallet,
l.website_url,
l.x_url,
l.telegram_url,
l.discord_url,
l.committed_sol,
l.participants_count,
l.hard_cap_sol,
l.countdown_started_at,
l.countdown_ends_at,
l.live_at,
l.commit_started_at,
l.commit_ends_at,
l.supply,
l.final_supply,
l.circulating_supply,
l.liquidity,
l.liquidity_usd,
l.current_liquidity_usd,
l.internal_pool_sol,
b.alias AS builder_alias,
b.builder_score AS builder_score,
t.mint_address AS token_mint_address
FROM launches l
LEFT JOIN builders b
ON b.id = l.builder_id
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
wallet,
});

return res.json({
ok: true,
success: true,
mint,
token: {
id: tokenRow.id,
launch_id: tokenRow.launch_id,
name: tokenRow.name,
symbol: tokenRow.symbol,
ticker: tokenRow.symbol,
supply: toNumber(tokenRow.supply, 0),
mint_address: cleanText(tokenRow.mint_address, 120) || mint,
mint: cleanText(tokenRow.mint_address, 120) || mint,
created_at: tokenRow.created_at || null,
},
launch: snapshot?.launch || launch,
pool: snapshot?.pool || null,
wallet: snapshot?.wallet || null,
chart: {
stats: snapshot?.stats || {},
candles: snapshot?.candles || [],
trades: snapshot?.trades || [],
},
cassie:
snapshot?.cassie || {
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
