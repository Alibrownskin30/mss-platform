import express from "express";
import launcherDb from "../db/index.js";
import { getChartSnapshot } from "../services/chart-service.js";

const router = express.Router();

const ALLOWED_INTERVALS = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);

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

function normalizeInterval(raw) {
const interval = String(raw || "1m").trim();
return ALLOWED_INTERVALS.has(interval) ? interval : "1m";
}

function shouldRevealContractAddress(status) {
const normalized = cleanText(status, 64).toLowerCase();
return normalized === "live" || normalized === "graduated";
}

function sanitizeLaunchForResponse(launch = null) {
if (!launch) return null;

const status = cleanText(launch.status, 64).toLowerCase();
const revealContract = shouldRevealContractAddress(status);

return {
...launch,
contract_address: revealContract ? cleanText(launch.contract_address, 120) || null : null,
mint_address: revealContract ? cleanText(launch.mint_address, 120) || null : null,
reserved_mint_address: null,
reserved_mint_secret: null,
};
}

function pickLaunchRow(row) {
if (!row) return null;

const revealContract = shouldRevealContractAddress(row.status);

return {
id: row.id,
token_name: row.token_name,
symbol: row.symbol,
status: row.status,
template: row.template,

contract_address: revealContract ? cleanText(row.contract_address, 120) || null : null,
mint_address: revealContract ? cleanText(row.contract_address, 120) || null : null,
builder_wallet: cleanText(row.builder_wallet, 120) || null,

website_url: cleanText(row.website_url, 500),
x_url: cleanText(row.x_url, 500),
telegram_url: cleanText(row.telegram_url, 500),
discord_url: cleanText(row.discord_url, 500),

committed_sol: toNumber(row.committed_sol, 0),
participants_count: toNumber(row.participants_count, 0),
hard_cap_sol: toNumber(row.hard_cap_sol, 0),

builder_pct: toNumber(row.builder_pct, 0),
team_allocation_pct: toNumber(row.team_allocation_pct, 0),

countdown_started_at: row.countdown_started_at || null,
countdown_ends_at: row.countdown_ends_at || null,
live_at: row.live_at || null,
commit_started_at: row.commit_started_at || null,
commit_ends_at: row.commit_ends_at || null,

supply: toNumber(row.supply, 0),
final_supply: toNumber(row.final_supply || row.supply, 0),
circulating_supply: toNumber(row.circulating_supply, 0),

liquidity: toNumber(row.liquidity, 0),
liquidity_sol: toNumber(row.liquidity, 0),
liquidity_usd: toNumber(row.liquidity_usd, 0),
current_liquidity_usd: toNumber(row.current_liquidity_usd, 0),
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
id,
token_name,
symbol,
status,
template,
contract_address,
builder_wallet,
website_url,
x_url,
telegram_url,
discord_url,
committed_sol,
participants_count,
hard_cap_sol,
builder_pct,
team_allocation_pct,
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

const interval = normalizeInterval(req.query.interval);
const candleLimit = clampNumber(req.query.candle_limit, 1, 500, 120);
const tradeLimit = clampNumber(req.query.trade_limit, 1, 200, 50);

const fallbackLaunch = pickLaunchRow(launchRow);

const snapshot = await getChartSnapshot({
db: launcherDb,
launchId: tokenRow.launch_id,
interval,
candleLimit,
tradeLimit,
wallet,
});

const snapshotLaunch = sanitizeLaunchForResponse(snapshot?.launch || null);
const resolvedLaunch = snapshotLaunch || fallbackLaunch;

const resolvedMintAddress =
cleanText(tokenRow.mint_address, 120) ||
cleanText(snapshot?.token?.mint_address, 120) ||
cleanText(snapshotLaunch?.mint_address, 120) ||
cleanText(resolvedLaunch?.mint_address, 120) ||
null;

return res.json({
ok: true,
success: true,
mint,
wallet: wallet || null,

token: {
id: tokenRow.id,
launch_id: tokenRow.launch_id,
name: tokenRow.name,
symbol: tokenRow.symbol,
ticker: tokenRow.symbol,
supply: toNumber(tokenRow.supply, 0),
mint_address: resolvedMintAddress,
mint: resolvedMintAddress,
created_at: tokenRow.created_at,
},

launch: resolvedLaunch,

chart: {
stats: snapshot?.stats || {},
candles: snapshot?.candles || [],
trades: snapshot?.trades || [],
},

pool: snapshot?.pool || null,
wallet_summary: snapshot?.wallet || null,
wallet: snapshot?.wallet || null,

cassie: snapshot?.cassie || {
monitoring_active: true,
phase: String(resolvedLaunch?.status || "").toLowerCase() || "commit",
layer: "market-intelligence",
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
