import express from "express";
import db from "../db/index.js";
import { getChartSnapshot } from "../services/chart-service.js";

const router = express.Router();

function toNumber(value, fallback = 0) {
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max);
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
const wallet = cleanText(req.query.wallet, 120);

if (!launchId) {
return res.status(400).json({ ok: false, error: "Invalid launchId" });
}

const snapshot = await getChartSnapshot({
db,
launchId,
interval: "1m",
candleLimit: 120,
tradeLimit: 100,
wallet,
});

const launch = snapshot?.launch || null;
const token = snapshot?.token || null;
const pool = snapshot?.pool || null;
const walletSummary = snapshot?.wallet || {};
const stats = snapshot?.stats || {};
const trades = Array.isArray(snapshot?.trades) ? snapshot.trades : [];
const cassie = snapshot?.cassie || null;

if (!launch) {
return res.status(404).json({ ok: false, error: "Launch not found" });
}

const mintAddress =
token?.mint_address ||
launch?.mint_address ||
launch?.contract_address ||
null;

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
liquidity_sol: toNumber(launch.liquidity_sol ?? launch.liquidity, 0),
liquidity_usd: toNumber(launch.liquidity_usd, 0),
current_liquidity_usd: toNumber(launch.current_liquidity_usd, 0),
sol_usd_price: toNumber(stats.sol_usd_price, 0),
website_url: launch.website_url || "",
x_url: launch.x_url || "",
telegram_url: launch.telegram_url || "",
discord_url: launch.discord_url || "",
countdown_started_at: launch.countdown_started_at || null,
countdown_ends_at: launch.countdown_ends_at || null,
live_at: launch.live_at || null,
commit_started_at: launch.commit_started_at || null,
commit_ends_at: launch.commit_ends_at || null,
created_at: launch.created_at || null,
updated_at: launch.updated_at || null,
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
wallet: {
token_balance: toNumber(walletSummary.token_balance, 0),
tokenBalance: toNumber(
walletSummary.tokenBalance ?? walletSummary.token_balance,
0
),
position_value_usd: toNumber(walletSummary.position_value_usd, 0),
positionValueUsd: toNumber(
walletSummary.positionValueUsd ?? walletSummary.position_value_usd,
0
),
sol_balance: toNumber(walletSummary.sol_balance, 0),
solBalance: toNumber(
walletSummary.solBalance ?? walletSummary.sol_balance,
0
),
sol_delta: toNumber(
walletSummary.sol_delta ??
walletSummary.walletSolDelta ??
walletSummary.sol_balance,
0
),
walletSolDelta: toNumber(
walletSummary.walletSolDelta ??
walletSummary.sol_delta ??
walletSummary.sol_balance,
0
),
},
stats: {
...stats,
wallet_token_balance: toNumber(
stats.wallet_token_balance ?? walletSummary.token_balance,
0
),
wallet_position_value_usd: toNumber(
stats.wallet_position_value_usd ?? walletSummary.position_value_usd,
0
),
wallet_sol_balance: toNumber(
stats.wallet_sol_balance ?? walletSummary.sol_balance,
0
),
wallet_sol_delta: toNumber(
stats.wallet_sol_delta ??
walletSummary.walletSolDelta ??
walletSummary.sol_balance,
0
),
},
pool: pool
? {
id: pool.id,
status: pool.status || null,
token_reserve: toNumber(pool.token_reserve, 0),
sol_reserve: toNumber(pool.sol_reserve, 0),
k_value: toNumber(pool.k_value, 0),
initial_token_reserve: toNumber(pool.initial_token_reserve, 0),
created_at: pool.created_at || null,
}
: null,
cassie: {
monitoring_active:
cassie?.monitoring_active !== false,
phase:
String(cassie?.phase || launch.status || "").toLowerCase() || "commit",
layer: cassie?.layer || "market-intelligence",
risk_state: cassie?.risk_state || cassieRisk,
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
trades: Array.isArray(trades)
? trades.map(normalizeTradeRow).reverse()
: [],
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
