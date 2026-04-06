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
const solAmount = toNumber(row.sol_amount, 0);
const tokenAmount = toNumber(row.token_amount, 0);
const explicitPrice = toNumber(row.price, 0);
const derivedPrice = tokenAmount > 0 ? solAmount / tokenAmount : 0;
const executionPrice = explicitPrice > 0 ? explicitPrice : derivedPrice;

return {
id: row.id,
launch_id: row.launch_id,
token_id: row.token_id,
wallet: cleanText(row.wallet, 120),
side: String(row.side || "").toLowerCase() === "sell" ? "sell" : "buy",
price_sol: executionPrice,
price: executionPrice,
token_amount: tokenAmount,
base_amount: solAmount,
sol_amount: solAmount,
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

const walletTokenBalance = toNumber(
walletSummary.token_balance ??
walletSummary.tokenBalance ??
stats.wallet_token_balance,
0
);

const walletTotalBalance = toNumber(
walletSummary.total_balance ??
walletSummary.totalBalance ??
stats.wallet_total_balance ??
walletTokenBalance,
walletTokenBalance
);

const walletSellableBalance = toNumber(
walletSummary.sellable_balance ??
walletSummary.sellableBalance ??
walletSummary.sellable_token_balance ??
walletSummary.sellableTokenBalance ??
stats.wallet_sellable_balance ??
stats.wallet_sellable_token_balance ??
walletTokenBalance,
walletTokenBalance
);

const walletUnlockedBalance = toNumber(
walletSummary.unlocked_balance ??
walletSummary.unlockedBalance ??
walletSummary.unlocked_token_balance ??
walletSummary.unlockedTokenBalance ??
stats.wallet_unlocked_balance ??
stats.wallet_unlocked_token_balance ??
walletSellableBalance,
walletSellableBalance
);

const walletLockedBalance = toNumber(
walletSummary.locked_balance ??
walletSummary.lockedBalance ??
walletSummary.locked_token_balance ??
walletSummary.lockedTokenBalance ??
stats.wallet_locked_balance ??
stats.wallet_locked_token_balance ??
Math.max(0, walletTotalBalance - walletUnlockedBalance),
Math.max(0, walletTotalBalance - walletUnlockedBalance)
);

const walletPositionValueUsd = toNumber(
walletSummary.position_value_usd ??
walletSummary.positionValueUsd ??
stats.wallet_position_value_usd,
0
);

const walletSolBalance = toNumber(
walletSummary.sol_balance ??
walletSummary.solBalance ??
stats.wallet_sol_balance,
0
);

const walletSolDelta = toNumber(
walletSummary.sol_delta ??
walletSummary.solDelta ??
walletSummary.walletSolDelta ??
stats.wallet_sol_delta ??
walletSolBalance,
walletSolBalance
);

const walletIsBuilder = Boolean(
walletSummary.wallet_is_builder ??
walletSummary.is_builder_wallet ??
stats.wallet_is_builder ??
stats.is_builder_wallet ??
false
);

const walletVestingActive = Boolean(
walletSummary.wallet_vesting_active ??
walletSummary.vesting_active ??
stats.wallet_vesting_active ??
false
);

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
internal_pool_tokens: toNumber(launch.internal_pool_tokens, 0),
liquidity: toNumber(launch.liquidity, 0),
liquidity_sol: toNumber(launch.liquidity_sol ?? launch.liquidity, 0),
liquidity_usd: toNumber(
stats.liquidity_usd ??
launch.current_liquidity_usd ??
launch.liquidity_usd,
0
),
current_liquidity_usd: toNumber(
stats.liquidity_usd ??
launch.current_liquidity_usd ??
launch.liquidity_usd,
0
),
sol_usd_price: toNumber(stats.sol_usd_price, 0),
price: toNumber(stats.price_sol ?? launch.price, 0),
price_usd: toNumber(stats.price_usd, 0),
market_cap: toNumber(stats.market_cap_sol ?? launch.market_cap, 0),
market_cap_usd: toNumber(stats.market_cap_usd, 0),
volume_24h: toNumber(stats.volume_24h_sol ?? launch.volume_24h, 0),
volume_24h_usd: toNumber(stats.volume_24h_usd, 0),
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
token_balance: walletTokenBalance,
tokenBalance: walletTokenBalance,
total_balance: walletTotalBalance,
totalBalance: walletTotalBalance,

sellable_balance: walletSellableBalance,
sellableBalance: walletSellableBalance,
sellable_token_balance: walletSellableBalance,
sellableTokenBalance: walletSellableBalance,

unlocked_balance: walletUnlockedBalance,
unlockedBalance: walletUnlockedBalance,
unlocked_token_balance: walletUnlockedBalance,
unlockedTokenBalance: walletUnlockedBalance,

locked_balance: walletLockedBalance,
lockedBalance: walletLockedBalance,
locked_token_balance: walletLockedBalance,
lockedTokenBalance: walletLockedBalance,

position_value_usd: walletPositionValueUsd,
positionValueUsd: walletPositionValueUsd,

sol_balance: walletSolBalance,
solBalance: walletSolBalance,
sol_delta: walletSolDelta,
solDelta: walletSolDelta,
walletSolDelta: walletSolDelta,

wallet_is_builder: walletIsBuilder,
is_builder_wallet: walletIsBuilder,
vesting_active: walletVestingActive,
wallet_vesting_active: walletVestingActive,

builder_total_allocation_tokens: toNumber(
walletSummary.builder_total_allocation_tokens ??
stats.builder_total_allocation_tokens,
0
),
builder_unlocked_tokens: toNumber(
walletSummary.builder_unlocked_tokens ??
stats.builder_unlocked_tokens,
0
),
builder_locked_tokens: toNumber(
walletSummary.builder_locked_tokens ??
stats.builder_locked_tokens,
0
),
builder_sellable_tokens: toNumber(
walletSummary.builder_sellable_tokens ??
stats.builder_sellable_tokens,
0
),
builder_vesting_percent_unlocked: toNumber(
walletSummary.builder_vesting_percent_unlocked ??
stats.builder_vesting_percent_unlocked,
0
),
builder_vesting_days_live: toNumber(
walletSummary.builder_vesting_days_live ??
stats.builder_vesting_days_live,
0
),
},
stats: {
...stats,

wallet_token_balance: walletTokenBalance,
wallet_total_balance: walletTotalBalance,

wallet_sellable_balance: walletSellableBalance,
wallet_sellable_token_balance: walletSellableBalance,

wallet_unlocked_balance: walletUnlockedBalance,
wallet_unlocked_token_balance: walletUnlockedBalance,

wallet_locked_balance: walletLockedBalance,
wallet_locked_token_balance: walletLockedBalance,

wallet_position_value_usd: walletPositionValueUsd,
wallet_sol_balance: walletSolBalance,
wallet_sol_delta: walletSolDelta,

wallet_is_builder: walletIsBuilder,
is_builder_wallet: walletIsBuilder,
wallet_vesting_active: walletVestingActive,

builder_total_allocation_tokens: toNumber(
stats.builder_total_allocation_tokens ??
walletSummary.builder_total_allocation_tokens,
0
),
builder_unlocked_tokens: toNumber(
stats.builder_unlocked_tokens ??
walletSummary.builder_unlocked_tokens,
0
),
builder_locked_tokens: toNumber(
stats.builder_locked_tokens ??
walletSummary.builder_locked_tokens,
0
),
builder_sellable_tokens: toNumber(
stats.builder_sellable_tokens ??
walletSummary.builder_sellable_tokens,
0
),
builder_vesting_percent_unlocked: toNumber(
stats.builder_vesting_percent_unlocked ??
walletSummary.builder_vesting_percent_unlocked,
0
),
builder_vesting_days_live: toNumber(
stats.builder_vesting_days_live ??
walletSummary.builder_vesting_days_live,
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
trades,
cassie: {
monitoring_active: cassie?.monitoring_active !== false,
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
