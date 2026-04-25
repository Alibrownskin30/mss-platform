import express from "express";
import launcherDb from "../db/index.js";
import { getChartSnapshot } from "../services/chart-service.js";
import {
getLiquidityLifecycle,
buildGraduationPlanForLaunch,
} from "../services/launcher/liquidityLifecycle.js";

const router = express.Router();

const ALLOWED_INTERVALS = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);

function toNumber(value, fallback = 0) {
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function toInt(value, fallback = 0) {
return Math.max(0, Math.floor(toNumber(value, fallback)));
}

function clampNumber(value, min, max, fallback) {
const num = Number(value);
if (!Number.isFinite(num)) return fallback;
return Math.min(max, Math.max(min, num));
}

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max);
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

function normalizeInterval(raw) {
const interval = String(raw || "1m").trim();
return ALLOWED_INTERVALS.has(interval) ? interval : "1m";
}

function parseDbTime(value) {
if (!value) return null;
const raw = String(value).trim();
if (!raw) return null;

const hasExplicitTimezone =
/z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw);

if (
!hasExplicitTimezone &&
/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
) {
const sqliteUtc = Date.parse(raw.replace(" ", "T") + "Z");
return Number.isFinite(sqliteUtc) ? sqliteUtc : null;
}

const direct = Date.parse(raw);
return Number.isFinite(direct) ? direct : null;
}

function inferRevealStatus(launch = null) {
if (!launch) return "";

const rawStatus = cleanText(launch.status, 64).toLowerCase();
const contractAddress = choosePreferredString(
launch.contract_address,
launch.mint_address,
launch.token_mint
);
const reservationStatus = cleanText(
launch.mint_reservation_status,
64
).toLowerCase();
const mintFinalizedAtMs = parseDbTime(launch.mint_finalized_at);

const countdownStartedMs = parseDbTime(launch.countdown_started_at);
const countdownEndsMs = parseDbTime(
launch.countdown_ends_at || launch.live_at
);
const liveAtMs = parseDbTime(launch.live_at || launch.countdown_ends_at);

const hasCountdownWindow =
Number.isFinite(countdownStartedMs) || Number.isFinite(countdownEndsMs);

const hasLiveSignal = Boolean(
contractAddress ||
reservationStatus === "finalized" ||
Number.isFinite(mintFinalizedAtMs)
);

if (rawStatus === "failed_refunded") return "failed_refunded";
if (rawStatus === "failed") return "failed";
if (rawStatus === "graduated") return "graduated";
if (rawStatus === "live") return "live";

if (rawStatus === "building") {
return hasLiveSignal ? "live" : "building";
}

if (rawStatus === "countdown") {
if (Number.isFinite(countdownEndsMs) && Date.now() < countdownEndsMs) {
return "countdown";
}
return hasLiveSignal ? "live" : "building";
}

if (hasCountdownWindow) {
if (Number.isFinite(countdownEndsMs) && Date.now() < countdownEndsMs) {
return "countdown";
}
return hasLiveSignal ? "live" : "building";
}

if (Number.isFinite(liveAtMs) && Date.now() >= liveAtMs && hasLiveSignal) {
return "live";
}

if (hasLiveSignal) {
return "live";
}

return rawStatus || "commit";
}

function shouldRevealContractAddress(status) {
const normalized = cleanText(status, 64).toLowerCase();
return normalized === "live" || normalized === "graduated";
}

function buildPhaseMeta(launch = null) {
const status = inferRevealStatus(launch);
const marketEnabled = shouldRevealContractAddress(status);

return {
status,
market_enabled: marketEnabled,
can_trade: marketEnabled,
is_commit: status === "commit",
is_countdown: status === "countdown",
is_building: status === "building",
is_live: status === "live",
is_graduated: status === "graduated",
is_failed: status === "failed" || status === "failed_refunded",
};
}

function sanitizeLaunchForResponse(launch = null, stats = {}) {
if (!launch) return null;

const phase = buildPhaseMeta(launch);
const revealContract = phase.market_enabled;

return {
...launch,
status: phase.status || launch.status || null,
phase,

contract_address: revealContract
? cleanText(launch.contract_address, 120) || null
: null,
mint_address: revealContract
? cleanText(launch.mint_address || launch.contract_address, 120) || null
: null,

reserved_mint_address: null,
reserved_mint_secret: null,
mint_reservation_status: revealContract
? cleanText(launch.mint_reservation_status, 64) || null
: null,
mint_finalized_at: revealContract ? launch.mint_finalized_at || null : null,

price: revealContract
? toNumber(
chooseFirstFinite(stats.price_sol, stats.price, launch.price),
0
)
: 0,
price_sol: revealContract
? toNumber(
chooseFirstFinite(stats.price_sol, stats.price, launch.price),
0
)
: 0,
price_usd: revealContract
? toNumber(chooseFirstFinite(stats.price_usd, launch.price_usd), 0)
: 0,

liquidity: revealContract
? toNumber(
chooseFirstFinite(
stats.liquidity_sol,
stats.liquidity,
launch.liquidity_sol,
launch.liquidity
),
0
)
: 0,
liquidity_sol: revealContract
? toNumber(
chooseFirstFinite(
stats.liquidity_sol,
stats.liquidity,
launch.liquidity_sol,
launch.liquidity
),
0
)
: 0,
liquidity_usd: revealContract
? toNumber(
chooseFirstFinite(
stats.liquidity_usd,
launch.liquidity_usd,
launch.current_liquidity_usd
),
0
)
: 0,
current_liquidity_usd: revealContract
? toNumber(
chooseFirstFinite(
stats.liquidity_usd,
launch.current_liquidity_usd,
launch.liquidity_usd
),
0
)
: 0,

market_cap: revealContract
? toNumber(
chooseFirstFinite(
stats.market_cap_sol,
stats.market_cap,
launch.market_cap
),
0
)
: 0,
market_cap_sol: revealContract
? toNumber(
chooseFirstFinite(
stats.market_cap_sol,
stats.market_cap,
launch.market_cap
),
0
)
: 0,
market_cap_usd: revealContract
? toNumber(
chooseFirstFinite(stats.market_cap_usd, launch.market_cap_usd),
0
)
: 0,

volume_24h: revealContract
? toNumber(
chooseFirstFinite(
stats.volume_24h_sol,
stats.volume_24h,
launch.volume_24h
),
0
)
: 0,
volume_24h_sol: revealContract
? toNumber(
chooseFirstFinite(
stats.volume_24h_sol,
stats.volume_24h,
launch.volume_24h
),
0
)
: 0,
volume_24h_usd: revealContract
? toNumber(
chooseFirstFinite(stats.volume_24h_usd, launch.volume_24h_usd),
0
)
: 0,

sol_usd_price: revealContract
? toNumber(
chooseFirstFinite(stats.sol_usd_price, launch.sol_usd_price),
0
)
: 0,
};
}

function sanitizeTokenForResponse(token = null, launch = null) {
if (!token) return null;

const phase = buildPhaseMeta(launch);
const revealContract = phase.market_enabled;

return {
...token,
mint_address: revealContract
? cleanText(token.mint_address, 120) || null
: null,
mint: revealContract
? cleanText(token.mint || token.mint_address, 120) || null
: null,
};
}

function sanitizePoolForResponse(pool = null, launch = null) {
const phase = buildPhaseMeta(launch);
if (!pool || !phase.market_enabled) return null;

return {
...pool,
token_reserve: toNumber(pool.token_reserve, 0),
sol_reserve: toNumber(pool.sol_reserve, 0),
k_value: toNumber(pool.k_value, 0),
initial_token_reserve: toNumber(pool.initial_token_reserve, 0),
};
}

function sanitizeCandlesForResponse(candles = [], launch = null) {
const phase = buildPhaseMeta(launch);
if (!phase.market_enabled) return [];

return Array.isArray(candles)
? candles.map((candle) => ({
bucket_start: candle.bucket_start,
open: toNumber(candle.open, 0),
high: toNumber(candle.high, 0),
low: toNumber(candle.low, 0),
close: toNumber(candle.close, 0),
volume_base: toNumber(candle.volume_base, 0),
volume_token: toNumber(candle.volume_token, 0),
buys: toInt(candle.buys, 0),
sells: toInt(candle.sells, 0),
}))
: [];
}

function sanitizeTradesForResponse(trades = [], launch = null) {
const phase = buildPhaseMeta(launch);
if (!phase.market_enabled) return [];

return Array.isArray(trades)
? trades.map((trade) => ({
id: trade.id ?? null,
launch_id: trade.launch_id ?? null,
token_id: trade.token_id ?? null,
wallet: cleanText(trade.wallet, 120),
side: String(trade.side || "").toLowerCase() === "sell" ? "sell" : "buy",
price_sol: toNumber(trade.price_sol ?? trade.price, 0),
price: toNumber(trade.price ?? trade.price_sol, 0),
token_amount: toNumber(trade.token_amount, 0),
base_amount: toNumber(trade.base_amount ?? trade.sol_amount, 0),
sol_amount: toNumber(trade.sol_amount ?? trade.base_amount, 0),
timestamp: trade.timestamp || trade.created_at || null,
created_at: trade.created_at || trade.timestamp || null,
}))
: [];
}

function sanitizeStatsForResponse(stats = {}, launch = null) {
const phase = buildPhaseMeta(launch);
const marketActive = phase.market_enabled;

return {
...stats,
phase,
market_enabled: marketActive,
can_trade: marketActive,

total_supply: toNumber(stats.total_supply, 0),
circulating_supply: marketActive ? toNumber(stats.circulating_supply, 0) : 0,

sol_usd_price: marketActive ? toNumber(stats.sol_usd_price, 0) : 0,

price: marketActive ? toNumber(stats.price ?? stats.price_sol, 0) : 0,
price_sol: marketActive ? toNumber(stats.price_sol ?? stats.price, 0) : 0,
price_usd: marketActive ? toNumber(stats.price_usd, 0) : 0,

liquidity: marketActive ? toNumber(stats.liquidity ?? stats.liquidity_sol, 0) : 0,
liquidity_sol: marketActive ? toNumber(stats.liquidity_sol ?? stats.liquidity, 0) : 0,
liquidity_usd: marketActive ? toNumber(stats.liquidity_usd, 0) : 0,

market_cap: marketActive ? toNumber(stats.market_cap ?? stats.market_cap_sol, 0) : 0,
market_cap_sol: marketActive ? toNumber(stats.market_cap_sol ?? stats.market_cap, 0) : 0,
market_cap_usd: marketActive ? toNumber(stats.market_cap_usd, 0) : 0,

volume_24h: marketActive ? toNumber(stats.volume_24h ?? stats.volume_24h_sol, 0) : 0,
volume_24h_sol: marketActive ? toNumber(stats.volume_24h_sol ?? stats.volume_24h, 0) : 0,
volume_24h_usd: marketActive ? toNumber(stats.volume_24h_usd, 0) : 0,

buys_24h: marketActive ? toInt(stats.buys_24h, 0) : 0,
sells_24h: marketActive ? toInt(stats.sells_24h, 0) : 0,
trades_24h: marketActive ? toInt(stats.trades_24h ?? stats.tx_count_24h, 0) : 0,
tx_count_24h: marketActive ? toInt(stats.tx_count_24h ?? stats.trades_24h, 0) : 0,

price_change_pct: marketActive ? toNumber(stats.price_change_pct, 0) : 0,
high_24h: marketActive ? toNumber(stats.high_24h, 0) : 0,
low_24h: marketActive ? toNumber(stats.low_24h, 0) : 0,
high_24h_sol: marketActive ? toNumber(stats.high_24h_sol ?? stats.high_24h, 0) : 0,
low_24h_sol: marketActive ? toNumber(stats.low_24h_sol ?? stats.low_24h, 0) : 0,

wallet_token_balance: marketActive ? toInt(stats.wallet_token_balance, 0) : 0,
wallet_balance_tokens: marketActive ? toInt(stats.wallet_balance_tokens, 0) : 0,
wallet_total_balance: marketActive ? toInt(stats.wallet_total_balance, 0) : 0,
wallet_visible_total_balance: marketActive ? toInt(stats.wallet_visible_total_balance, 0) : 0,
wallet_position_value_usd: marketActive ? toNumber(stats.wallet_position_value_usd, 0) : 0,
wallet_sol_balance: marketActive ? toNumber(stats.wallet_sol_balance, 0) : 0,
wallet_sol_delta: marketActive ? toNumber(stats.wallet_sol_delta, 0) : 0,

wallet_sellable_balance: marketActive ? toInt(stats.wallet_sellable_balance, 0) : 0,
wallet_sellable_token_balance: marketActive ? toInt(stats.wallet_sellable_token_balance, 0) : 0,
wallet_locked_balance: marketActive ? toInt(stats.wallet_locked_balance, 0) : 0,
wallet_locked_token_balance: marketActive ? toInt(stats.wallet_locked_token_balance, 0) : 0,
wallet_unlocked_balance: marketActive ? toInt(stats.wallet_unlocked_balance, 0) : 0,
wallet_unlocked_token_balance: marketActive ? toInt(stats.wallet_unlocked_token_balance, 0) : 0,

wallet_is_builder: marketActive ? Boolean(stats.wallet_is_builder) : false,
wallet_vesting_active: marketActive ? Boolean(stats.wallet_vesting_active) : false,

is_builder_wallet: marketActive ? Boolean(stats.is_builder_wallet) : false,
builder_total_allocation_tokens: marketActive ? toInt(stats.builder_total_allocation_tokens, 0) : 0,
builder_unlocked_tokens: marketActive ? toInt(stats.builder_unlocked_tokens, 0) : 0,
builder_locked_tokens: marketActive ? toInt(stats.builder_locked_tokens, 0) : 0,
builder_sellable_tokens: marketActive ? toInt(stats.builder_sellable_tokens, 0) : 0,
builder_visible_total_tokens: marketActive ? toInt(stats.builder_visible_total_tokens, 0) : 0,
builder_vesting_percent_unlocked: marketActive ? toNumber(stats.builder_vesting_percent_unlocked, 0) : 0,
builder_vesting_days_live: marketActive ? toInt(stats.builder_vesting_days_live, 0) : 0,
builder_daily_unlock_tokens: marketActive ? toInt(stats.builder_daily_unlock_tokens, 0) : 0,
};
}

function extractGraduationReadiness(lifecycle) {
return lifecycle?.graduationReadiness || lifecycle?.graduation_readiness || null;
}

function normalizeLifecycle(raw = {}, launch = null) {
const phase = buildPhaseMeta(launch);
if (!raw || typeof raw !== "object" || !phase.market_enabled) {
return null;
}

return {
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

graduationReadiness:
raw.graduationReadiness ?? raw.graduation_readiness ?? null,
builderVesting: raw.builderVesting ?? raw.builder_vesting ?? null,
};
}

function normalizeGraduationReadiness(readiness = {}, launch = null) {
const phase = buildPhaseMeta(launch);
if (!readiness || typeof readiness !== "object" || !phase.market_enabled) {
return null;
}

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

function normalizeBuilderVestingSummary(raw = {}, launch = null) {
const phase = buildPhaseMeta(launch);
if (!raw || typeof raw !== "object" || !phase.market_enabled) {
return null;
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
vested_days: toInt(raw.vested_days ?? raw.vestedDays, 0),
};
}

function pickLaunchRow(row) {
if (!row) return null;

const phase = buildPhaseMeta(row);
const revealContract = phase.market_enabled;

return {
id: row.id,
token_name: row.token_name,
symbol: row.symbol,
status: phase.status || row.status,
phase,
template: row.template,
description: cleanText(row.description, 5000),
image_url: cleanText(row.image_url, 1000),

contract_address: revealContract
? cleanText(row.contract_address, 120) || null
: null,
mint_address: revealContract
? cleanText(row.mint_address || row.contract_address, 120) || null
: null,

reserved_mint_address: null,
reserved_mint_secret: null,
mint_reservation_status: revealContract
? cleanText(row.mint_reservation_status, 64).toLowerCase() || null
: null,
mint_finalized_at: revealContract ? row.mint_finalized_at || null : null,

builder_wallet: cleanText(row.builder_wallet, 120) || null,
builder_alias: cleanText(row.builder_alias, 120) || null,
builder_score: toNumber(row.builder_score, 0),

website_url: cleanText(row.website_url, 500),
x_url: cleanText(row.x_url, 500),
telegram_url: cleanText(row.telegram_url, 500),
discord_url: cleanText(row.discord_url, 500),

committed_sol: toNumber(row.committed_sol, 0),
participants_count: toInt(row.participants_count, 0),
hard_cap_sol: toNumber(row.hard_cap_sol, 0),
min_raise_sol: toNumber(row.min_raise_sol, 0),

builder_pct: toNumber(row.builder_pct, 0),
team_allocation_pct: toNumber(row.team_allocation_pct, 0),

countdown_started_at: row.countdown_started_at || null,
countdown_ends_at: row.countdown_ends_at || null,
live_at: row.live_at || null,
commit_started_at: row.commit_started_at || null,
commit_ends_at: row.commit_ends_at || null,

supply: toInt(row.supply, 0),
final_supply: toInt(row.final_supply || row.supply, 0),
circulating_supply: toInt(row.circulating_supply, 0),

liquidity: revealContract ? toNumber(row.liquidity, 0) : 0,
liquidity_sol: revealContract ? toNumber(row.liquidity, 0) : 0,
liquidity_usd: revealContract ? toNumber(row.liquidity_usd, 0) : 0,
current_liquidity_usd: revealContract
? toNumber(row.current_liquidity_usd, 0)
: 0,
price: revealContract ? toNumber(row.price, 0) : 0,
price_usd: revealContract ? toNumber(row.price_usd, 0) : 0,
market_cap: revealContract ? toNumber(row.market_cap, 0) : 0,
market_cap_usd: revealContract ? toNumber(row.market_cap_usd, 0) : 0,
volume_24h: revealContract ? toNumber(row.volume_24h, 0) : 0,
volume_24h_usd: revealContract ? toNumber(row.volume_24h_usd, 0) : 0,
sol_usd_price: revealContract ? toNumber(row.sol_usd_price, 0) : 0,
};
}

async function safeGetLifecycle(launchId) {
try {
return await getLiquidityLifecycle(launchId);
} catch {
return null;
}
}

async function safeGetGraduationPlan(launchId) {
try {
return await buildGraduationPlanForLaunch(launchId);
} catch {
return null;
}
}

function buildWalletPayload(snapshotWallet = {}, stats = {}, launch = null) {
const phase = buildPhaseMeta(launch);

if (!phase.market_enabled) {
return {
token_balance: 0,
tokenBalance: 0,
balance_tokens: 0,
wallet_balance_tokens: 0,

total_balance: 0,
totalBalance: 0,
visible_total_balance: 0,
visibleTotalBalance: 0,

sellable_balance: 0,
sellableBalance: 0,
sellable_token_balance: 0,
sellableTokenBalance: 0,

unlocked_balance: 0,
unlockedBalance: 0,
unlocked_token_balance: 0,
unlockedTokenBalance: 0,

locked_balance: 0,
lockedBalance: 0,
locked_token_balance: 0,
lockedTokenBalance: 0,

position_value_usd: 0,
positionValueUsd: 0,

sol_balance: 0,
solBalance: 0,
sol_delta: 0,
solDelta: 0,

wallet_is_builder: false,
is_builder_wallet: false,
vesting_active: false,
wallet_vesting_active: false,

builder_total_allocation_tokens: 0,
builder_unlocked_tokens: 0,
builder_locked_tokens: 0,
builder_sellable_tokens: 0,
builder_visible_total_tokens: 0,
builder_vesting_percent_unlocked: 0,
builder_vesting_days_live: 0,
builder_daily_unlock_tokens: 0,

phase,
market_enabled: false,
can_trade: false,
};
}

const walletTokenBalance = toInt(
snapshotWallet.token_balance ??
snapshotWallet.tokenBalance ??
stats.wallet_token_balance,
0
);

const walletTotalBalance = toInt(
snapshotWallet.total_balance ??
snapshotWallet.totalBalance ??
stats.wallet_total_balance ??
walletTokenBalance,
walletTokenBalance
);

const walletVisibleTotalBalance = toInt(
snapshotWallet.visible_total_balance ??
snapshotWallet.visibleTotalBalance ??
stats.wallet_visible_total_balance ??
walletTotalBalance,
walletTotalBalance
);

const walletSellableBalance = toInt(
snapshotWallet.sellable_balance ??
snapshotWallet.sellableBalance ??
snapshotWallet.sellable_token_balance ??
snapshotWallet.sellableTokenBalance ??
stats.wallet_sellable_balance ??
stats.wallet_sellable_token_balance ??
walletTokenBalance,
walletTokenBalance
);

const walletUnlockedBalance = toInt(
snapshotWallet.unlocked_balance ??
snapshotWallet.unlockedBalance ??
snapshotWallet.unlocked_token_balance ??
snapshotWallet.unlockedTokenBalance ??
stats.wallet_unlocked_balance ??
stats.wallet_unlocked_token_balance ??
walletSellableBalance,
walletSellableBalance
);

const walletLockedBalance = toInt(
snapshotWallet.locked_balance ??
snapshotWallet.lockedBalance ??
snapshotWallet.locked_token_balance ??
snapshotWallet.lockedTokenBalance ??
stats.wallet_locked_balance ??
stats.wallet_locked_token_balance ??
Math.max(0, walletVisibleTotalBalance - walletUnlockedBalance),
Math.max(0, walletVisibleTotalBalance - walletUnlockedBalance)
);

const walletPositionValueUsd = toNumber(
chooseFirstFinite(
snapshotWallet.position_value_usd,
snapshotWallet.positionValueUsd,
stats.wallet_position_value_usd,
stats.price_usd && walletVisibleTotalBalance > 0
? Number(stats.price_usd) * walletVisibleTotalBalance
: 0
),
0
);

const walletSolBalance = toNumber(
snapshotWallet.sol_balance ??
snapshotWallet.solBalance ??
stats.wallet_sol_balance,
0
);

const walletSolDelta = toNumber(
snapshotWallet.sol_delta ??
snapshotWallet.solDelta ??
stats.wallet_sol_delta ??
walletSolBalance,
walletSolBalance
);

const walletIsBuilder = Boolean(
snapshotWallet.wallet_is_builder ??
snapshotWallet.is_builder_wallet ??
stats.wallet_is_builder ??
stats.is_builder_wallet ??
false
);

const walletVestingActive = Boolean(
snapshotWallet.wallet_vesting_active ??
snapshotWallet.vesting_active ??
stats.wallet_vesting_active ??
false
);

const builderVisibleTotalTokens = toInt(
snapshotWallet.builder_visible_total_tokens ??
stats.builder_visible_total_tokens ??
walletVisibleTotalBalance,
walletVisibleTotalBalance
);

return {
...snapshotWallet,

token_balance: walletTokenBalance,
tokenBalance: walletTokenBalance,
balance_tokens: walletTokenBalance,
wallet_balance_tokens: walletTokenBalance,

total_balance: walletTotalBalance,
totalBalance: walletTotalBalance,
visible_total_balance: walletVisibleTotalBalance,
visibleTotalBalance: walletVisibleTotalBalance,

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

wallet_is_builder: walletIsBuilder,
is_builder_wallet: walletIsBuilder,
vesting_active: walletVestingActive,
wallet_vesting_active: walletVestingActive,

builder_total_allocation_tokens: toInt(
snapshotWallet.builder_total_allocation_tokens ??
stats.builder_total_allocation_tokens,
0
),
builder_unlocked_tokens: toInt(
snapshotWallet.builder_unlocked_tokens ??
stats.builder_unlocked_tokens,
0
),
builder_locked_tokens: toInt(
snapshotWallet.builder_locked_tokens ??
stats.builder_locked_tokens,
0
),
builder_sellable_tokens: toInt(
snapshotWallet.builder_sellable_tokens ??
stats.builder_sellable_tokens,
0
),
builder_visible_total_tokens: builderVisibleTotalTokens,
builder_vesting_percent_unlocked: toNumber(
snapshotWallet.builder_vesting_percent_unlocked ??
stats.builder_vesting_percent_unlocked,
0
),
builder_vesting_days_live: toInt(
snapshotWallet.builder_vesting_days_live ??
stats.builder_vesting_days_live,
0
),
builder_daily_unlock_tokens: toInt(
snapshotWallet.builder_daily_unlock_tokens ??
stats.builder_daily_unlock_tokens,
0
),

phase,
market_enabled: true,
can_trade: true,
};
}

function buildCassiePayload(cassie = null, launch = null) {
const phase = buildPhaseMeta(launch);

return {
...(cassie || {}),
phase: phase.status,
market_enabled: phase.market_enabled,
can_trade: phase.can_trade,
};
}

async function findTokenOrLaunchByMint(mint) {
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

if (tokenRow) {
return {
tokenRow,
launchId: tokenRow.launch_id,
};
}

const launchFallback = await launcherDb.get(
`
SELECT
l.id AS launch_id,
l.token_name,
l.symbol,
l.supply,
l.final_supply,
l.live_at,
l.created_at
FROM launches l
WHERE l.contract_address = ?
OR l.token_mint = ?
OR l.mint_address = ?
LIMIT 1
`,
[mint, mint, mint]
);

if (!launchFallback) {
return null;
}

return {
tokenRow: {
id: null,
launch_id: launchFallback.launch_id,
name: launchFallback.token_name,
symbol: launchFallback.symbol,
supply: launchFallback.final_supply || launchFallback.supply || 0,
mint_address: mint,
created_at: launchFallback.live_at || launchFallback.created_at || null,
},
launchId: launchFallback.launch_id,
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

const resolved = await findTokenOrLaunchByMint(mint);

if (!resolved?.tokenRow || !resolved?.launchId) {
return res.status(404).json({
ok: false,
error: "Token not found for mint",
});
}

const tokenRow = resolved.tokenRow;

const launchRow = await launcherDb.get(
`
SELECT
l.id,
l.token_name,
l.symbol,
l.status,
l.template,
l.contract_address,
l.mint_address,
l.token_mint,
l.mint_reservation_status,
l.mint_finalized_at,
l.builder_wallet,
l.description,
l.image_url,
l.website_url,
l.x_url,
l.telegram_url,
l.discord_url,
l.committed_sol,
l.participants_count,
l.hard_cap_sol,
l.min_raise_sol,
l.builder_pct,
l.team_allocation_pct,
l.countdown_started_at,
l.countdown_ends_at,
l.live_at,
l.commit_started_at,
l.commit_ends_at,
l.supply,
l.final_supply,
l.circulating_supply,
l.internal_pool_sol,
l.internal_pool_tokens,
l.liquidity,
l.price,
l.market_cap,
l.volume_24h,
l.liquidity_usd,
l.current_liquidity_usd,
l.price_usd,
l.market_cap_usd,
l.volume_24h_usd,
l.sol_usd_price,
b.alias AS builder_alias,
b.builder_score AS builder_score
FROM launches l
LEFT JOIN builders b
ON b.id = l.builder_id
WHERE l.id = ?
LIMIT 1
`,
[resolved.launchId]
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

const fallbackLaunch = pickLaunchRow({
...launchRow,
mint_address: tokenRow.mint_address,
});

const [snapshot, lifecycleRaw, graduationPlan] = await Promise.all([
getChartSnapshot({
db: launcherDb,
launchId: resolved.launchId,
interval,
candleLimit,
tradeLimit,
wallet,
}),
safeGetLifecycle(resolved.launchId),
safeGetGraduationPlan(resolved.launchId),
]);

const rawLaunch = snapshot?.launch || fallbackLaunch || null;
if (!rawLaunch) {
return res.status(404).json({
ok: false,
error: "Launch not found for token",
});
}

const phase = buildPhaseMeta(rawLaunch);

if (!phase.market_enabled) {
return res.status(404).json({
ok: false,
error: "Token market is not active",
phase,
});
}

const snapshotStats = sanitizeStatsForResponse(snapshot?.stats || {}, rawLaunch);
const snapshotLaunch = sanitizeLaunchForResponse(rawLaunch, snapshotStats);
const lifecycle = normalizeLifecycle(lifecycleRaw, rawLaunch);
const graduationReadiness = normalizeGraduationReadiness(
extractGraduationReadiness(lifecycleRaw),
rawLaunch
);
const builderVesting = normalizeBuilderVestingSummary(
lifecycleRaw?.builderVesting || lifecycleRaw?.builder_vesting || {},
rawLaunch
);

const resolvedMintAddress =
cleanText(
tokenRow.mint_address ||
snapshot?.token?.mint_address ||
snapshot?.token?.mint ||
snapshotLaunch?.mint_address,
120
) || null;

const walletPayload = buildWalletPayload(
snapshot?.wallet || {},
snapshotStats,
rawLaunch
);

const tokenPayload = sanitizeTokenForResponse(
{
id: tokenRow.id,
launch_id: tokenRow.launch_id,
name: tokenRow.name,
symbol: tokenRow.symbol,
ticker: tokenRow.symbol,
supply: toInt(
chooseFirstFinite(
tokenRow.supply,
snapshot?.token?.supply,
snapshotLaunch?.final_supply,
snapshotLaunch?.supply
),
0
),
mint_address: resolvedMintAddress,
mint: resolvedMintAddress,
created_at: tokenRow.created_at,
},
rawLaunch
);

const normalizedLaunch = snapshotLaunch
? {
...snapshotLaunch,
lifecycle,
graduation_readiness: graduationReadiness,
builder_vesting: builderVesting,
}
: null;

return res.json({
ok: true,
success: true,
mint,
wallet_query: wallet || null,
status: phase.status,
phase,

token: tokenPayload,
launch: normalizedLaunch,

chart: {
stats: snapshotStats,
candles: sanitizeCandlesForResponse(snapshot?.candles || [], rawLaunch),
trades: sanitizeTradesForResponse(snapshot?.trades || [], rawLaunch),
},

stats: snapshotStats,
candles: sanitizeCandlesForResponse(snapshot?.candles || [], rawLaunch),
trades: sanitizeTradesForResponse(snapshot?.trades || [], rawLaunch),
pool: sanitizePoolForResponse(snapshot?.pool || null, rawLaunch),

wallet_summary: walletPayload,
wallet: walletPayload,

lifecycle,
graduationPlan,
graduationReadiness: graduationReadiness,

cassie: buildCassiePayload(snapshot?.cassie || null, rawLaunch),
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
