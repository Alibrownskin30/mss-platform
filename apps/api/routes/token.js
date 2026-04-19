import express from "express";
import db from "../db/index.js";
import { getChartSnapshot, getChartTrades } from "../services/chart-service.js";

const router = express.Router();

function toNumber(value, fallback = 0) {
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function toInt(value, fallback = 0) {
return Math.max(0, Math.floor(toNumber(value, fallback)));
}

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max);
}

function cleanWallet(value) {
return cleanText(value, 120);
}

function choosePreferredString(...values) {
for (const value of values) {
const cleaned = cleanText(value, 500);
if (cleaned) return cleaned;
}
return "";
}

function chooseFirstFinite(...values) {
for (const value of values) {
const num = Number(value);
if (Number.isFinite(num)) return num;
}
return null;
}

function normalizeLaunchStatus(launch = null) {
if (!launch) return "";

const rawStatus = cleanText(launch.status, 64).toLowerCase();

if (
rawStatus === "commit" ||
rawStatus === "countdown" ||
rawStatus === "building" ||
rawStatus === "live" ||
rawStatus === "graduated" ||
rawStatus === "failed" ||
rawStatus === "failed_refunded"
) {
return rawStatus;
}

return rawStatus || "commit";
}

function shouldRevealContractAddress(status) {
const normalized = cleanText(status, 64).toLowerCase();
return normalized === "live" || normalized === "graduated";
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

function normalizeTradeRow(row) {
const solAmount = toNumber(row?.sol_amount ?? row?.base_amount, 0);
const tokenAmount = toNumber(row?.token_amount, 0);
const explicitPrice = toNumber(row?.price ?? row?.price_sol, 0);
const derivedPrice = tokenAmount > 0 ? solAmount / tokenAmount : 0;
const executionPrice = explicitPrice > 0 ? explicitPrice : derivedPrice;

return {
id: row?.id ?? null,
launch_id: row?.launch_id ?? null,
token_id: row?.token_id ?? null,
wallet: cleanText(row?.wallet, 120),
side: String(row?.side || "").toLowerCase() === "sell" ? "sell" : "buy",
price_sol: executionPrice,
price: executionPrice,
token_amount: tokenAmount,
base_amount: solAmount,
sol_amount: solAmount,
timestamp: row?.created_at || row?.timestamp || null,
created_at: row?.created_at || row?.timestamp || null,
};
}

function normalizeLifecycle(raw = {}) {
if (!raw || typeof raw !== "object") return null;

return {
launch_status:
cleanText(raw.launch_status ?? raw.launchStatus, 64).toLowerCase() || null,
contract_address:
cleanText(raw.contract_address ?? raw.contractAddress, 120) || null,
builder_wallet:
cleanText(raw.builder_wallet ?? raw.builderWallet, 120) || null,

internal_sol_reserve: toNumber(
raw.internal_sol_reserve ?? raw.internalSolReserve,
0
),
internal_token_reserve: toInt(
raw.internal_token_reserve ?? raw.internalTokenReserve,
0
),
implied_marketcap_sol: toNumber(
raw.implied_marketcap_sol ?? raw.impliedMarketcapSol,
0
),

graduation_status:
cleanText(raw.graduation_status ?? raw.graduationStatus, 120) ||
"internal_live",
graduated: Boolean(raw.graduated),
graduation_reason:
cleanText(raw.graduation_reason ?? raw.graduationReason, 200) || null,
graduated_at: raw.graduated_at ?? raw.graduatedAt ?? null,

raydium_target_pct: toNumber(
raw.raydium_target_pct ?? raw.raydiumTargetPct,
50
),
mss_locked_target_pct: toNumber(
raw.mss_locked_target_pct ?? raw.mssLockedTargetPct,
50
),

raydium_pool_id:
cleanText(raw.raydium_pool_id ?? raw.raydiumPoolId, 200) || null,
raydium_sol_migrated: toNumber(
raw.raydium_sol_migrated ?? raw.raydiumSolMigrated,
0
),
raydium_token_migrated: toInt(
raw.raydium_token_migrated ?? raw.raydiumTokenMigrated,
0
),
raydium_lp_tokens:
cleanText(raw.raydium_lp_tokens ?? raw.raydiumLpTokens, 200) || null,
raydium_migration_tx:
cleanText(raw.raydium_migration_tx ?? raw.raydiumMigrationTx, 300) || null,

mss_locked_sol: toNumber(raw.mss_locked_sol ?? raw.mssLockedSol, 0),
mss_locked_token: toInt(raw.mss_locked_token ?? raw.mssLockedToken, 0),
mss_locked_lp_amount:
cleanText(raw.mss_locked_lp_amount ?? raw.mssLockedLpAmount, 200) || null,
lock_status:
cleanText(raw.lock_status ?? raw.lockStatus, 120) || "not_locked",
lock_tx: cleanText(raw.lock_tx ?? raw.lockTx, 300) || null,
lock_expires_at: raw.lock_expires_at ?? raw.lockExpiresAt ?? null,

graduation_readiness:
raw.graduation_readiness ?? raw.graduationReadiness ?? null,
};
}

function normalizeGraduationReadiness(readiness = {}) {
if (!readiness || typeof readiness !== "object") return null;

return {
ready: Boolean(readiness.ready),
reason: cleanText(readiness.reason, 500) || "",
thresholds:
readiness.thresholds && typeof readiness.thresholds === "object"
? {
marketcapSol: toNumber(readiness.thresholds.marketcapSol, 0),
volume24hSol: toNumber(readiness.thresholds.volume24hSol, 0),
minHolders: toInt(readiness.thresholds.minHolders, 0),
minLiveMinutes: toInt(readiness.thresholds.minLiveMinutes, 0),
lockDays: toInt(readiness.thresholds.lockDays, 0),
}
: null,
metrics:
readiness.metrics && typeof readiness.metrics === "object"
? {
marketcapSol: toNumber(readiness.metrics.marketcapSol, 0),
volume24hSol: toNumber(readiness.metrics.volume24hSol, 0),
holderCount: toInt(readiness.metrics.holderCount, 0),
liveMinutes: toInt(readiness.metrics.liveMinutes, 0),
solReserve: toNumber(readiness.metrics.solReserve, 0),
tokenReserve: toInt(readiness.metrics.tokenReserve, 0),
priceSol: toNumber(readiness.metrics.priceSol, 0),
totalSupply: toInt(readiness.metrics.totalSupply, 0),
}
: null,
checks:
readiness.checks && typeof readiness.checks === "object"
? {
liveStatus: Boolean(readiness.checks.liveStatus),
marketcapReached: Boolean(readiness.checks.marketcapReached),
volumeReached: Boolean(readiness.checks.volumeReached),
holdersReached: Boolean(readiness.checks.holdersReached),
minimumLiveWindowReached: Boolean(
readiness.checks.minimumLiveWindowReached
),
hasReserves: Boolean(readiness.checks.hasReserves),
alreadyGraduated: Boolean(readiness.checks.alreadyGraduated),
}
: null,
};
}

function normalizeBuilderVestingSummary(raw = {}) {
if (!raw || typeof raw !== "object") {
return {
builder_wallet: null,
total_allocation: 0,
daily_unlock: 0,
unlocked_amount: 0,
locked_amount: 0,
vesting_start_at: null,
created_at: null,
updated_at: null,
};
}

return {
builder_wallet:
cleanText(raw.builder_wallet ?? raw.builderWallet, 120) || null,
total_allocation: toInt(raw.total_allocation ?? raw.totalAllocation, 0),
daily_unlock: toInt(raw.daily_unlock ?? raw.dailyUnlock, 0),
unlocked_amount: toInt(raw.unlocked_amount ?? raw.unlockedAmount, 0),
locked_amount: toInt(raw.locked_amount ?? raw.lockedAmount, 0),
vesting_start_at: raw.vesting_start_at ?? raw.vestingStartAt ?? null,
created_at: raw.created_at ?? raw.createdAt ?? null,
updated_at: raw.updated_at ?? raw.updatedAt ?? null,
};
}

async function readLifecycleFallback(launchId) {
try {
const row = await db.get(
`
SELECT *
FROM launch_liquidity_lifecycle
WHERE launch_id = ?
LIMIT 1
`,
[launchId]
);
return row || null;
} catch {
return null;
}
}

async function readBuilderVestingFallback(launchId) {
try {
const row = await db.get(
`
SELECT *
FROM builder_vesting
WHERE launch_id = ?
LIMIT 1
`,
[launchId]
);
return row || null;
} catch {
return null;
}
}

router.get("/:launchId", async (req, res) => {
try {
const launchId = Number(req.params.launchId);
const wallet = cleanWallet(req.query.wallet);

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
const trades = Array.isArray(snapshot?.trades)
? snapshot.trades.map(normalizeTradeRow)
: [];
const cassie = snapshot?.cassie || null;

if (!launch) {
return res.status(404).json({ ok: false, error: "Launch not found" });
}

const lifecycleRaw =
snapshot?.lifecycle ||
launch?.lifecycle ||
(await readLifecycleFallback(launchId)) ||
null;

const lifecycle = normalizeLifecycle(lifecycleRaw);

const graduationReadiness = normalizeGraduationReadiness(
snapshot?.graduationReadiness ||
snapshot?.graduation_readiness ||
lifecycle?.graduation_readiness ||
launch?.graduationReadiness ||
launch?.graduation_readiness ||
null
);

const builderVestingRaw =
snapshot?.builderVesting ||
snapshot?.builder_vesting ||
launch?.builder_vesting ||
(await readBuilderVestingFallback(launchId)) ||
null;

const builderVesting = normalizeBuilderVestingSummary(builderVestingRaw);

const inferredStatus = normalizeLaunchStatus(launch);
const revealContract = shouldRevealContractAddress(inferredStatus);

const mintAddress =
(revealContract
? choosePreferredString(
token?.mint_address,
token?.mint,
launch?.mint_address,
launch?.contract_address,
lifecycle?.contract_address
)
: "") || null;

const requestWalletNormalized = cleanText(wallet, 120).toLowerCase();
const builderWalletNormalized = cleanText(
launch?.builder_wallet || lifecycle?.builder_wallet,
120
).toLowerCase();

const requestWalletIsBuilder = Boolean(
requestWalletNormalized &&
builderWalletNormalized &&
requestWalletNormalized === builderWalletNormalized
);

const cassieRisk = inferCassieRisk(stats);

const builderTotalAllocationFallback = toInt(
chooseFirstFinite(
walletSummary.builder_total_allocation_tokens,
stats.builder_total_allocation_tokens,
builderVesting.total_allocation
),
0
);

const builderUnlockedFallback = toInt(
chooseFirstFinite(
walletSummary.builder_unlocked_tokens,
stats.builder_unlocked_tokens,
builderVesting.unlocked_amount
),
0
);

const builderLockedFallback = toInt(
chooseFirstFinite(
walletSummary.builder_locked_tokens,
stats.builder_locked_tokens,
builderVesting.locked_amount
),
0
);

const builderSellableFallback = toInt(
chooseFirstFinite(
walletSummary.builder_sellable_tokens,
stats.builder_sellable_tokens,
builderUnlockedFallback
),
builderUnlockedFallback
);

const walletIsBuilder = Boolean(
walletSummary.wallet_is_builder ??
walletSummary.is_builder_wallet ??
stats.wallet_is_builder ??
stats.is_builder_wallet ??
requestWalletIsBuilder
);

const walletVestingActive = Boolean(
walletSummary.wallet_vesting_active ??
walletSummary.vesting_active ??
stats.wallet_vesting_active ??
(walletIsBuilder && builderLockedFallback > 0)
);

const walletTokenBalance = toInt(
chooseFirstFinite(
walletSummary.token_balance,
walletSummary.tokenBalance,
walletSummary.balance_tokens,
walletSummary.wallet_balance_tokens,
stats.wallet_token_balance,
stats.wallet_balance_tokens,
walletIsBuilder ? builderSellableFallback : null
),
walletIsBuilder ? builderSellableFallback : 0
);

const walletTotalBalance = toInt(
chooseFirstFinite(
walletSummary.total_balance,
walletSummary.totalBalance,
stats.wallet_total_balance,
walletIsBuilder ? builderTotalAllocationFallback : null,
walletTokenBalance
),
walletIsBuilder
? Math.max(walletTokenBalance, builderTotalAllocationFallback)
: walletTokenBalance
);

const walletSellableBalance = toInt(
chooseFirstFinite(
walletSummary.sellable_balance,
walletSummary.sellableBalance,
walletSummary.sellable_token_balance,
walletSummary.sellableTokenBalance,
stats.wallet_sellable_balance,
stats.wallet_sellable_token_balance,
walletIsBuilder ? builderSellableFallback : null,
walletTokenBalance
),
walletIsBuilder ? builderSellableFallback : walletTokenBalance
);

const walletUnlockedBalance = toInt(
chooseFirstFinite(
walletSummary.unlocked_balance,
walletSummary.unlockedBalance,
walletSummary.unlocked_token_balance,
walletSummary.unlockedTokenBalance,
stats.wallet_unlocked_balance,
stats.wallet_unlocked_token_balance,
walletIsBuilder ? builderUnlockedFallback : null,
walletSellableBalance
),
walletIsBuilder ? builderUnlockedFallback : walletSellableBalance
);

const walletLockedBalance = toInt(
chooseFirstFinite(
walletSummary.locked_balance,
walletSummary.lockedBalance,
walletSummary.locked_token_balance,
walletSummary.lockedTokenBalance,
stats.wallet_locked_balance,
stats.wallet_locked_token_balance,
walletIsBuilder ? builderLockedFallback : null,
Math.max(0, walletTotalBalance - walletUnlockedBalance)
),
walletIsBuilder
? Math.max(builderLockedFallback, walletTotalBalance - walletUnlockedBalance)
: Math.max(0, walletTotalBalance - walletUnlockedBalance)
);

const walletPositionValueUsd = toNumber(
chooseFirstFinite(
walletSummary.position_value_usd,
walletSummary.positionValueUsd,
stats.wallet_position_value_usd
),
0
);

const walletSolBalance = toNumber(
chooseFirstFinite(
walletSummary.sol_balance,
walletSummary.solBalance,
stats.wallet_sol_balance,
walletSummary.sol_delta,
walletSummary.solDelta,
stats.wallet_sol_delta
),
0
);

const walletSolDelta = toNumber(
chooseFirstFinite(
walletSummary.sol_delta,
walletSummary.solDelta,
walletSummary.walletSolDelta,
stats.wallet_sol_delta,
walletSolBalance
),
walletSolBalance
);

const priceSol = toNumber(
chooseFirstFinite(stats.price_sol, stats.price, launch.price),
0
);

const priceUsd = toNumber(
chooseFirstFinite(stats.price_usd),
0
);

const liquiditySol = toNumber(
chooseFirstFinite(
stats.liquidity_sol,
stats.liquidity,
pool?.sol_reserve,
lifecycle?.internal_sol_reserve,
launch.internal_pool_sol,
launch.liquidity_sol,
launch.liquidity
),
0
);

const liquidityUsd = toNumber(
chooseFirstFinite(
stats.liquidity_usd,
launch.current_liquidity_usd,
launch.liquidity_usd
),
0
);

const marketCapSol = toNumber(
chooseFirstFinite(
stats.market_cap_sol,
stats.market_cap,
lifecycle?.implied_marketcap_sol,
launch.market_cap
),
0
);

const marketCapUsd = toNumber(
chooseFirstFinite(stats.market_cap_usd),
0
);

const volume24hSol = toNumber(
chooseFirstFinite(
stats.volume_24h_sol,
stats.volume_24h,
launch.volume_24h
),
0
);

const volume24hUsd = toNumber(
chooseFirstFinite(stats.volume_24h_usd),
0
);

const totalSupply = toInt(
chooseFirstFinite(
token?.supply,
launch?.total_supply,
launch?.final_supply,
launch?.supply,
stats?.total_supply,
graduationReadiness?.metrics?.totalSupply
),
0
);

return res.json({
ok: true,
success: true,

launch: {
id: launch.id,
token_name: launch.token_name,
symbol: launch.symbol,
status: inferredStatus,
template: launch.template || null,

contract_address: revealContract
? cleanText(launch.contract_address, 120) || mintAddress
: null,
mint_address: revealContract ? mintAddress : null,

builder_wallet: cleanText(
launch.builder_wallet || lifecycle?.builder_wallet,
120
) || null,
builder_alias: cleanText(launch.builder_alias, 120) || null,
builder_score: toNumber(launch.builder_score, 0),

supply: toInt(launch.supply, 0),
final_supply: toInt(launch.final_supply ?? launch.supply, 0),
total_supply: totalSupply,
circulating_supply: toInt(
chooseFirstFinite(
launch.circulating_supply,
launch.final_supply,
launch.supply
),
0
),

committed_sol: toNumber(launch.committed_sol, 0),
participants_count: toInt(launch.participants_count, 0),
hard_cap_sol: toNumber(launch.hard_cap_sol, 0),
min_raise_sol: toNumber(launch.min_raise_sol, 0),

internal_pool_sol: toNumber(
chooseFirstFinite(
launch.internal_pool_sol,
lifecycle?.internal_sol_reserve
),
0
),
internal_pool_tokens: toInt(
chooseFirstFinite(
launch.internal_pool_tokens,
lifecycle?.internal_token_reserve
),
0
),

liquidity: liquiditySol,
liquidity_sol: liquiditySol,
liquidity_usd: liquidityUsd,
current_liquidity_usd: liquidityUsd,

sol_usd_price: toNumber(stats.sol_usd_price, 0),

price: priceSol,
price_sol: priceSol,
price_usd: priceUsd,

market_cap: marketCapSol,
market_cap_sol: marketCapSol,
market_cap_usd: marketCapUsd,

volume_24h: volume24hSol,
volume_24h_sol: volume24hSol,
volume_24h_usd: volume24hUsd,

website_url: cleanText(launch.website_url, 500),
x_url: cleanText(launch.x_url, 500),
telegram_url: cleanText(launch.telegram_url, 500),
discord_url: cleanText(launch.discord_url, 500),

countdown_started_at: launch.countdown_started_at || null,
countdown_ends_at: launch.countdown_ends_at || null,
live_at: launch.live_at || null,
commit_started_at: launch.commit_started_at || null,
commit_ends_at: launch.commit_ends_at || null,
created_at: launch.created_at || null,
updated_at: launch.updated_at || null,

lifecycle,
graduation_readiness: graduationReadiness,
builder_vesting: builderVesting,

surge_status: lifecycle?.graduation_status || null,
surge_ready: Boolean(graduationReadiness?.ready),
},

token: {
id: token?.id || null,
launch_id: token?.launch_id || launchId,
name: token?.name || launch.token_name || null,
symbol: token?.symbol || launch.symbol || null,
ticker: token?.symbol || launch.symbol || null,
supply: totalSupply,
mint_address: revealContract ? mintAddress : null,
mint: revealContract ? mintAddress : null,
created_at: token?.created_at || null,
},

wallet: {
token_balance: walletTokenBalance,
tokenBalance: walletTokenBalance,
balance_tokens: walletTokenBalance,
wallet_balance_tokens: walletTokenBalance,

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

builder_total_allocation_tokens: builderTotalAllocationFallback,
builder_unlocked_tokens: builderUnlockedFallback,
builder_locked_tokens: builderLockedFallback,
builder_sellable_tokens: builderSellableFallback,
builder_vesting_percent_unlocked: toNumber(
chooseFirstFinite(
walletSummary.builder_vesting_percent_unlocked,
stats.builder_vesting_percent_unlocked,
builderVesting.total_allocation > 0
? (builderVesting.unlocked_amount / builderVesting.total_allocation) * 100
: 0
),
0
),
builder_vesting_days_live: toInt(
chooseFirstFinite(
walletSummary.builder_vesting_days_live,
stats.builder_vesting_days_live
),
0
),
builder_daily_unlock_tokens: toInt(
chooseFirstFinite(
walletSummary.builder_daily_unlock_tokens,
stats.builder_daily_unlock_tokens,
builderVesting.daily_unlock
),
0
),
},

stats: {
...stats,

price: priceSol,
price_sol: priceSol,
price_usd: priceUsd,

liquidity: liquiditySol,
liquidity_sol: liquiditySol,
liquidity_usd: liquidityUsd,

market_cap: marketCapSol,
market_cap_sol: marketCapSol,
market_cap_usd: marketCapUsd,

volume_24h: volume24hSol,
volume_24h_sol: volume24hSol,
volume_24h_usd: volume24hUsd,

total_supply: totalSupply,

wallet_token_balance: walletTokenBalance,
wallet_total_balance: walletTotalBalance,
wallet_balance_tokens: walletTokenBalance,

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

builder_total_allocation_tokens: builderTotalAllocationFallback,
builder_unlocked_tokens: builderUnlockedFallback,
builder_locked_tokens: builderLockedFallback,
builder_sellable_tokens: builderSellableFallback,
builder_vesting_percent_unlocked: toNumber(
chooseFirstFinite(
stats.builder_vesting_percent_unlocked,
walletSummary.builder_vesting_percent_unlocked,
builderVesting.total_allocation > 0
? (builderVesting.unlocked_amount / builderVesting.total_allocation) * 100
: 0
),
0
),
builder_vesting_days_live: toInt(
chooseFirstFinite(
stats.builder_vesting_days_live,
walletSummary.builder_vesting_days_live
),
0
),
builder_daily_unlock_tokens: toInt(
chooseFirstFinite(
stats.builder_daily_unlock_tokens,
walletSummary.builder_daily_unlock_tokens,
builderVesting.daily_unlock
),
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
String(cassie?.phase || inferredStatus || launch.status || "").toLowerCase() ||
"commit",
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

const payload = await getChartTrades({
db,
launchId,
limit: 100,
});

return res.json({
ok: true,
success: true,
trades: Array.isArray(payload?.trades)
? payload.trades.map(normalizeTradeRow)
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
