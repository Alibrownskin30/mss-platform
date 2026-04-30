import express from "express";
import launcherDb from "../db/index.js";
import {
getChartCandles,
getChartTrades,
getChartStats,
getChartSnapshot,
} from "../services/chart-service.js";

const router = express.Router();

const ALLOWED_INTERVALS = new Set([
"1m",
"5m",
"15m",
"30m",
"1h",
"4h",
"1d",
]);

const BUILDER_TOTAL_ALLOCATION_PCT = 5;
const BUILDER_DAILY_UNLOCK_PCT = 0.5;
const BUILDER_UNLOCK_DAYS = 10;
const BUILDER_CLIFF_DAYS = 0;
const BUILDER_VESTING_DAYS = BUILDER_UNLOCK_DAYS;

const BUILDER_VESTING_RULE =
"0% unlocked at live. Builder allocation then unlocks at 0.5% of total supply per day for 10 days until the full 5% allocation is unlocked.";

const PARTICIPANT_UNLOCK_LABEL = "100% unlocked at live.";

function clampInt(value, fallback, min, max) {
const num = Number.parseInt(value, 10);
if (!Number.isFinite(num)) return fallback;
return Math.min(max, Math.max(min, num));
}

function parseLaunchId(raw) {
const launchId = Number.parseInt(String(raw || ""), 10);

if (!Number.isFinite(launchId) || launchId <= 0) {
return null;
}

return launchId;
}

function normalizeInterval(raw) {
const interval = String(raw || "1m").trim().toLowerCase();

if (!ALLOWED_INTERVALS.has(interval)) {
return "1m";
}

return interval;
}

function cleanWallet(raw) {
return String(raw ?? "").trim().slice(0, 120);
}

function getWalletParam(query = {}) {
return cleanWallet(
query.wallet ||
query.wallet_address ||
query.walletAddress ||
query.address ||
""
);
}

function cleanText(value, max = 200) {
return String(value ?? "").trim().slice(0, max);
}

function toNumber(value, fallback = 0) {
if (value === null || value === undefined || value === "") return fallback;

const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function toInt(value, fallback = 0) {
return Math.max(0, Math.floor(toNumber(value, fallback)));
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
if (value === null || value === undefined || value === "") continue;

const num = Number(value);
if (Number.isFinite(num)) return num;
}

return null;
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

function normalizeLaunchStatus(raw) {
const status = cleanText(raw, 80).toLowerCase();

if (!status) return "";

if (status === "failed_refunded" || status === "refunded") {
return "failed_refunded";
}

if (
status === "failed" ||
status === "cancelled" ||
status === "canceled" ||
status === "expired"
) {
return "failed";
}

if (status === "graduated" || status === "surged" || status === "surge") {
return "graduated";
}

if (status === "live" || status === "trading" || status === "market_live") {
return "live";
}

if (
status === "building" ||
status === "bootstrapping" ||
status === "deploying" ||
status === "finalizing" ||
status === "finalising"
) {
return "building";
}

if (status === "countdown" || status === "pre_live" || status === "prelive") {
return "countdown";
}

if (
status === "commit" ||
status === "committing" ||
status === "open" ||
status === "pending" ||
status === "created" ||
status === "draft"
) {
return "commit";
}

return status;
}

function getContractCandidateFromLaunch(launch = null) {
if (!launch) return "";

return choosePreferredString(
launch.contract_address,
launch.mint_address,
launch.token_mint,
launch.mint
);
}

function hasLiveMintSignal(launch = null) {
if (!launch) return false;

const contractAddress = getContractCandidateFromLaunch(launch);
const reservationStatus = cleanText(
launch.mint_reservation_status,
64
).toLowerCase();
const mintFinalizedAtMs = parseDbTime(launch.mint_finalized_at);

return Boolean(
contractAddress ||
reservationStatus === "finalized" ||
Number.isFinite(mintFinalizedAtMs)
);
}

function inferRevealStatus(launch = null) {
if (!launch) return "commit";

const rawStatus = normalizeLaunchStatus(launch.status);
const now = Date.now();

const countdownStartedMs = parseDbTime(launch.countdown_started_at);
const countdownEndsMs = parseDbTime(launch.countdown_ends_at);
const liveAtMs = parseDbTime(launch.live_at);

const hasCountdownWindow =
Number.isFinite(countdownStartedMs) || Number.isFinite(countdownEndsMs);

const countdownStillRunning =
Number.isFinite(countdownEndsMs) && now < countdownEndsMs;

const liveMintSignal = hasLiveMintSignal(launch);

if (rawStatus === "failed_refunded") return "failed_refunded";
if (rawStatus === "failed") return "failed";
if (rawStatus === "graduated") return "graduated";
if (rawStatus === "live") return "live";

/*
Protected phase rule:
Building must not auto-promote to live just because mint, pool,
lifecycle or contract data exists. finalizeLaunch.js owns live promotion.
*/
if (rawStatus === "building") return "building";

if (rawStatus === "countdown") {
if (!Number.isFinite(countdownEndsMs) || countdownStillRunning) {
return "countdown";
}

return "building";
}

if (rawStatus === "commit") {
if (hasCountdownWindow) {
if (!Number.isFinite(countdownEndsMs) || countdownStillRunning) {
return "countdown";
}

return "building";
}

return "commit";
}

if (!rawStatus && hasCountdownWindow) {
if (!Number.isFinite(countdownEndsMs) || countdownStillRunning) {
return "countdown";
}

return "building";
}

/*
Legacy fallback only. This is intentionally after countdown/building checks
so old rows can be rescued without breaking protected pre-live phases.
*/
if (!rawStatus && Number.isFinite(liveAtMs) && now >= liveAtMs && liveMintSignal) {
return "live";
}

if (!rawStatus && liveMintSignal) {
return "live";
}

return rawStatus || "commit";
}

function shouldRevealContractAddress(status) {
const normalized = normalizeLaunchStatus(status);
return normalized === "live" || normalized === "graduated";
}

function buildPhaseMeta(launch = null) {
const servicePhaseStatus = normalizeLaunchStatus(launch?.phase?.status);
const status = servicePhaseStatus || inferRevealStatus(launch);
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

const revealedMintAddress = revealContract
? cleanText(
launch.mint_address ||
launch.contract_address ||
launch.token_mint ||
launch.mint,
120
) || null
: null;

const priceSol = revealContract
? toNumber(chooseFirstFinite(stats.price_sol, stats.price, launch.price), 0)
: 0;

const liquiditySol = revealContract
? toNumber(
chooseFirstFinite(
stats.liquidity_sol,
stats.liquidity,
launch.liquidity_sol,
launch.liquidity
),
0
)
: 0;

const marketCapSol = revealContract
? toNumber(
chooseFirstFinite(stats.market_cap_sol, stats.market_cap, launch.market_cap),
0
)
: 0;

const volume24hSol = revealContract
? toNumber(
chooseFirstFinite(stats.volume_24h_sol, stats.volume_24h, launch.volume_24h),
0
)
: 0;

return {
...launch,

status: phase.status || launch.status || null,
raw_status: cleanText(launch.raw_status || launch.status, 80) || null,
phase,
market_enabled: phase.market_enabled,
can_trade: phase.can_trade,

contract_address: revealContract
? cleanText(launch.contract_address, 120) || revealedMintAddress
: null,
mint_address: revealedMintAddress,
token_mint: revealedMintAddress,
mint: revealedMintAddress,

reserved_mint_address: null,
reserved_mint_public_key: null,
reserved_mint_secret: null,
reserved_mint_private_key: null,
reserved_mint_keypair: null,

mint_reservation_status: revealContract
? cleanText(launch.mint_reservation_status, 64) || null
: null,
mint_finalized_at: revealContract ? launch.mint_finalized_at || null : null,

price: priceSol,
price_sol: priceSol,
price_usd: revealContract
? toNumber(chooseFirstFinite(stats.price_usd, launch.price_usd), 0)
: 0,

liquidity: liquiditySol,
liquidity_sol: liquiditySol,
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

market_cap: marketCapSol,
market_cap_sol: marketCapSol,
market_cap_usd: revealContract
? toNumber(chooseFirstFinite(stats.market_cap_usd, launch.market_cap_usd), 0)
: 0,

volume_24h: volume24hSol,
volume_24h_sol: volume24hSol,
volume_24h_usd: revealContract
? toNumber(chooseFirstFinite(stats.volume_24h_usd, launch.volume_24h_usd), 0)
: 0,

sol_usd_price: revealContract
? toNumber(chooseFirstFinite(stats.sol_usd_price, launch.sol_usd_price), 0)
: 0,

circulating_supply: revealContract
? toNumber(
chooseFirstFinite(stats.circulating_supply, launch.circulating_supply),
0
)
: 0,

lifecycle: revealContract ? launch.lifecycle || null : null,
builder_vesting: revealContract ? launch.builder_vesting || null : null,
allocation_summary: revealContract ? launch.allocation_summary || null : null,
launch_result_json: revealContract ? launch.launch_result_json || null : null,
};
}

function sanitizeTokenForResponse(token = null, launch = null) {
if (!token) return null;

const phase = buildPhaseMeta(launch);
const revealContract = phase.market_enabled;

const revealedMintAddress = revealContract
? cleanText(
token.mint_address ||
token.mint ||
token.token_mint ||
token.contract_address ||
launch?.mint_address ||
launch?.contract_address ||
launch?.token_mint,
120
) || null
: null;

return {
...token,

mint_address: revealedMintAddress,
mint: revealedMintAddress,
token_mint: revealedMintAddress,
contract_address: revealedMintAddress,

reserved_mint_address: null,
reserved_mint_public_key: null,
reserved_mint_secret: null,
reserved_mint_private_key: null,
reserved_mint_keypair: null,
};
}

function sanitizePoolForResponse(pool = null, launch = null) {
if (!pool) return null;

const phase = buildPhaseMeta(launch);

if (!phase.market_enabled) {
return null;
}

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
bucket_start: candle.bucket_start || candle.timestamp || candle.time || null,
bucket_start_ms:
candle.bucket_start_ms === null || candle.bucket_start_ms === undefined
? null
: toNumber(candle.bucket_start_ms, 0),
timestamp: candle.timestamp || candle.bucket_start || candle.time || null,
time: candle.time || candle.bucket_start || candle.timestamp || null,

open: toNumber(candle.open, 0),
high: toNumber(candle.high, 0),
low: toNumber(candle.low, 0),
close: toNumber(candle.close, 0),

volume_base: toNumber(candle.volume_base ?? candle.volume_sol, 0),
volume_sol: toNumber(candle.volume_sol ?? candle.volume_base, 0),
volume_token: toNumber(candle.volume_token, 0),

buys: toInt(candle.buys, 0),
sells: toInt(candle.sells, 0),
trade_count: toInt(candle.trade_count, 0),

buy_volume_base: toNumber(
candle.buy_volume_base ?? candle.buy_volume_sol,
0
),
buy_volume_sol: toNumber(
candle.buy_volume_sol ?? candle.buy_volume_base,
0
),
sell_volume_base: toNumber(
candle.sell_volume_base ?? candle.sell_volume_sol,
0
),
sell_volume_sol: toNumber(
candle.sell_volume_sol ?? candle.sell_volume_base,
0
),
buy_volume_token: toNumber(candle.buy_volume_token, 0),
sell_volume_token: toNumber(candle.sell_volume_token, 0),

vwap: toNumber(candle.vwap, candle.close),
first_trade_at: candle.first_trade_at || null,
last_trade_at: candle.last_trade_at || null,

change: toNumber(candle.change, 0),
change_pct: toNumber(candle.change_pct, 0),
is_bullish: Boolean(candle.is_bullish),
is_synthetic: Boolean(candle.is_synthetic),
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

const totalSupply = toNumber(
chooseFirstFinite(stats.total_supply, launch?.total_supply, launch?.supply),
0
);

const circulatingSupply = marketActive
? toNumber(
chooseFirstFinite(
stats.circulating_supply,
launch?.circulating_supply,
totalSupply
),
0
)
: 0;

const priceSol = marketActive
? toNumber(chooseFirstFinite(stats.price_sol, stats.price), 0)
: 0;

const liquiditySol = marketActive
? toNumber(chooseFirstFinite(stats.liquidity_sol, stats.liquidity), 0)
: 0;

const marketCapSol = marketActive
? toNumber(chooseFirstFinite(stats.market_cap_sol, stats.market_cap), 0)
: 0;

const volume24hSol = marketActive
? toNumber(chooseFirstFinite(stats.volume_24h_sol, stats.volume_24h), 0)
: 0;

const trades24h = marketActive
? toInt(stats.trades_24h ?? stats.tx_count_24h, 0)
: 0;

const walletTokenBalance = marketActive
? toInt(stats.wallet_token_balance ?? stats.wallet_balance_tokens, 0)
: 0;

const walletTotalBalance = marketActive
? toInt(
stats.wallet_total_balance ??
stats.wallet_visible_total_balance ??
walletTokenBalance,
walletTokenBalance
)
: 0;

const walletVisibleTotalBalance = marketActive
? toInt(
stats.wallet_visible_total_balance ?? walletTotalBalance,
walletTotalBalance
)
: 0;

const walletSellableBalance = marketActive
? toInt(
stats.wallet_sellable_balance ??
stats.wallet_sellable_token_balance ??
walletTokenBalance,
walletTokenBalance
)
: 0;

const walletUnlockedBalance = marketActive
? toInt(
stats.wallet_unlocked_balance ??
stats.wallet_unlocked_token_balance ??
walletSellableBalance,
walletSellableBalance
)
: 0;

const walletLockedBalance = marketActive
? toInt(
stats.wallet_locked_balance ??
stats.wallet_locked_token_balance ??
Math.max(0, walletVisibleTotalBalance - walletUnlockedBalance),
Math.max(0, walletVisibleTotalBalance - walletUnlockedBalance)
)
: 0;

const walletPositionValueSol = marketActive
? toNumber(
chooseFirstFinite(
stats.wallet_position_value_sol,
priceSol > 0 && walletVisibleTotalBalance > 0
? priceSol * walletVisibleTotalBalance
: 0
),
0
)
: 0;

const walletPositionValueUsd = marketActive
? toNumber(stats.wallet_position_value_usd, 0)
: 0;

const walletSolBalance = marketActive
? toNumber(stats.wallet_sol_balance ?? stats.sol_balance, 0)
: 0;

const walletSolDelta = marketActive
? toNumber(
stats.wallet_sol_delta ?? stats.walletSolDelta ?? walletSolBalance,
walletSolBalance
)
: 0;

const participantTotalAllocationTokens = marketActive
? toInt(stats.participant_total_allocation_tokens, 0)
: 0;

const participantUnlockedTokens = marketActive
? toInt(
stats.participant_unlocked_tokens,
participantTotalAllocationTokens > 0 ? participantTotalAllocationTokens : 0
)
: 0;

const participantLockedTokens = marketActive
? toInt(stats.participant_locked_tokens, 0)
: 0;

const participantSellableTokens = marketActive
? toInt(
stats.participant_sellable_tokens,
participantTotalAllocationTokens > 0 ? participantUnlockedTokens : 0
)
: 0;

const revealedMintAddress = marketActive
? cleanText(
stats.mint_address ||
stats.contract_address ||
stats.token_mint ||
getContractCandidateFromLaunch(launch),
120
) || null
: null;

return {
...stats,

phase,
market_enabled: marketActive,
can_trade: marketActive,

contract_address: revealedMintAddress,
mint_address: revealedMintAddress,
token_mint: revealedMintAddress,
mint: revealedMintAddress,

reserved_mint_address: null,
reserved_mint_public_key: null,
reserved_mint_secret: null,
reserved_mint_private_key: null,
reserved_mint_keypair: null,

mint_reservation_status: marketActive
? cleanText(stats.mint_reservation_status || launch?.mint_reservation_status, 64) ||
null
: null,
mint_finalized_at: marketActive
? stats.mint_finalized_at || launch?.mint_finalized_at || null
: null,

total_supply: totalSupply,
circulating_supply: circulatingSupply,

sol_usd_price: marketActive ? toNumber(stats.sol_usd_price, 0) : 0,
sol_usd_source: marketActive ? stats.sol_usd_source || null : null,
sol_usd_price_updated_at: marketActive
? stats.sol_usd_price_updated_at || null
: null,
sol_usd_block_id: marketActive ? stats.sol_usd_block_id || null : null,
sol_usd_price_change_24h: marketActive
? toNumber(stats.sol_usd_price_change_24h, 0)
: 0,

price: priceSol,
price_sol: priceSol,
price_usd: marketActive ? toNumber(stats.price_usd, 0) : 0,

open_price: marketActive ? toNumber(stats.open_price, 0) : 0,
open_price_sol: marketActive
? toNumber(stats.open_price_sol ?? stats.open_price, 0)
: 0,
open_price_usd: marketActive ? toNumber(stats.open_price_usd, 0) : 0,

liquidity: liquiditySol,
liquidity_sol: liquiditySol,
liquidity_usd: marketActive ? toNumber(stats.liquidity_usd, 0) : 0,

total_lp_liquidity_sol: marketActive
? toNumber(stats.total_lp_liquidity_sol, 0)
: 0,
total_lp_liquidity_usd: marketActive
? toNumber(stats.total_lp_liquidity_usd, 0)
: 0,

market_cap: marketCapSol,
market_cap_sol: marketCapSol,
market_cap_usd: marketActive ? toNumber(stats.market_cap_usd, 0) : 0,

fdv: marketActive ? toNumber(stats.fdv, 0) : 0,
fdv_sol: marketActive ? toNumber(stats.fdv_sol ?? stats.fdv, 0) : 0,
fdv_usd: marketActive ? toNumber(stats.fdv_usd, 0) : 0,

volume_24h: volume24hSol,
volume_24h_sol: volume24hSol,
volume_24h_usd: marketActive ? toNumber(stats.volume_24h_usd, 0) : 0,

buys_24h: marketActive ? toInt(stats.buys_24h, 0) : 0,
sells_24h: marketActive ? toInt(stats.sells_24h, 0) : 0,
trades_24h: trades24h,
tx_count_24h: trades24h,
trade_count_24h: trades24h,
trade_count_total: marketActive ? toInt(stats.trade_count_total, 0) : 0,
trades_total: marketActive ? toInt(stats.trades_total, 0) : 0,

price_change_pct: marketActive ? toNumber(stats.price_change_pct, 0) : 0,
high_24h: marketActive ? toNumber(stats.high_24h, 0) : 0,
low_24h: marketActive ? toNumber(stats.low_24h, 0) : 0,
high_24h_sol: marketActive
? toNumber(stats.high_24h_sol ?? stats.high_24h, 0)
: 0,
low_24h_sol: marketActive
? toNumber(stats.low_24h_sol ?? stats.low_24h, 0)
: 0,
high_24h_usd: marketActive ? toNumber(stats.high_24h_usd, 0) : 0,
low_24h_usd: marketActive ? toNumber(stats.low_24h_usd, 0) : 0,

wallet_token_balance: walletTokenBalance,
wallet_balance_tokens: walletTokenBalance,

wallet_total_balance: walletTotalBalance,
wallet_visible_total_balance: walletVisibleTotalBalance,

wallet_position_value_sol: walletPositionValueSol,
wallet_position_value_usd: walletPositionValueUsd,

wallet_sol_balance: walletSolBalance,
wallet_sol_delta: walletSolDelta,
walletSolDelta: walletSolDelta,

wallet_sellable_balance: walletSellableBalance,
wallet_sellable_token_balance: walletSellableBalance,

wallet_locked_balance: walletLockedBalance,
wallet_locked_token_balance: walletLockedBalance,

wallet_unlocked_balance: walletUnlockedBalance,
wallet_unlocked_token_balance: walletUnlockedBalance,

wallet_is_builder: marketActive ? Boolean(stats.wallet_is_builder) : false,
wallet_vesting_active: marketActive
? Boolean(stats.wallet_vesting_active)
: false,

is_builder_wallet: marketActive ? Boolean(stats.is_builder_wallet) : false,
is_participant_wallet: marketActive
? Boolean(stats.is_participant_wallet)
: false,
is_team_wallet: marketActive ? Boolean(stats.is_team_wallet) : false,

participant_total_allocation_tokens: participantTotalAllocationTokens,
participant_unlocked_tokens: participantUnlockedTokens,
participant_locked_tokens: participantLockedTokens,
participant_sellable_tokens: participantSellableTokens,
participant_vesting_percent_unlocked: marketActive
? toNumber(
stats.participant_vesting_percent_unlocked,
participantTotalAllocationTokens > 0 ? 100 : 0
)
: 0,
participant_vesting_days_live: marketActive
? toInt(stats.participant_vesting_days_live, 0)
: 0,
participant_vesting_days: marketActive
? toInt(stats.participant_vesting_days, 0)
: 0,
participant_vesting_label: marketActive
? cleanText(
stats.participant_vesting_label ||
(participantTotalAllocationTokens > 0 ? PARTICIPANT_UNLOCK_LABEL : ""),
200
)
: "",

team_total_allocation_tokens: marketActive
? toInt(stats.team_total_allocation_tokens, 0)
: 0,
team_unlocked_tokens: marketActive ? toInt(stats.team_unlocked_tokens, 0) : 0,
team_locked_tokens: marketActive ? toInt(stats.team_locked_tokens, 0) : 0,
team_sellable_tokens: marketActive ? toInt(stats.team_sellable_tokens, 0) : 0,
team_vesting_percent_unlocked: marketActive
? toNumber(stats.team_vesting_percent_unlocked, 0)
: 0,

builder_total_allocation_tokens: marketActive
? toInt(stats.builder_total_allocation_tokens, 0)
: 0,
builder_unlocked_tokens: marketActive
? toInt(stats.builder_unlocked_tokens, 0)
: 0,
builder_locked_tokens: marketActive ? toInt(stats.builder_locked_tokens, 0) : 0,
builder_sellable_tokens: marketActive
? toInt(stats.builder_sellable_tokens, 0)
: 0,
builder_visible_total_tokens: marketActive
? toInt(stats.builder_visible_total_tokens, 0)
: 0,
builder_unlocked_allocation_tokens: marketActive
? toInt(stats.builder_unlocked_allocation_tokens, 0)
: 0,
builder_locked_allocation_tokens: marketActive
? toInt(stats.builder_locked_allocation_tokens, 0)
: 0,
builder_vesting_percent_unlocked: marketActive
? toNumber(stats.builder_vesting_percent_unlocked, 0)
: 0,
builder_vesting_days_live: marketActive
? toInt(stats.builder_vesting_days_live, 0)
: 0,
builder_vested_days: marketActive ? toInt(stats.builder_vested_days, 0) : 0,
builder_daily_unlock_tokens: marketActive
? toInt(stats.builder_daily_unlock_tokens, 0)
: 0,
builder_cliff_days: marketActive ? BUILDER_CLIFF_DAYS : 0,
builder_vesting_days: marketActive ? BUILDER_VESTING_DAYS : 0,
builder_unlock_days: marketActive ? BUILDER_UNLOCK_DAYS : 0,
builder_daily_unlock_pct: marketActive ? BUILDER_DAILY_UNLOCK_PCT : 0,
builder_total_allocation_pct: marketActive ? BUILDER_TOTAL_ALLOCATION_PCT : 0,
builder_vesting_start_at: marketActive
? stats.builder_vesting_start_at || null
: null,
builder_vesting_rule: marketActive ? BUILDER_VESTING_RULE : "",
};
}

function buildEmptyWalletPayload(phase) {
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

position_value_sol: 0,
positionValueSol: 0,
position_value_usd: 0,
positionValueUsd: 0,

sol_balance: 0,
solBalance: 0,
sol_delta: 0,
solDelta: 0,
walletSolDelta: 0,

wallet_is_builder: false,
is_builder_wallet: false,
is_participant_wallet: false,
is_team_wallet: false,
vesting_active: false,
wallet_vesting_active: false,

participant_total_allocation_tokens: 0,
participant_unlocked_tokens: 0,
participant_locked_tokens: 0,
participant_sellable_tokens: 0,
participant_vesting_percent_unlocked: 0,
participant_vesting_days_live: 0,
participant_vesting_days: 0,
participant_vesting_label: "",

team_total_allocation_tokens: 0,
team_unlocked_tokens: 0,
team_locked_tokens: 0,
team_sellable_tokens: 0,
team_vesting_percent_unlocked: 0,

builder_total_allocation_tokens: 0,
builder_unlocked_tokens: 0,
builder_locked_tokens: 0,
builder_sellable_tokens: 0,
builder_visible_total_tokens: 0,
builder_unlocked_allocation_tokens: 0,
builder_locked_allocation_tokens: 0,
builder_vesting_percent_unlocked: 0,
builder_vesting_days_live: 0,
builder_vested_days: 0,
builder_daily_unlock_tokens: 0,
builder_cliff_days: BUILDER_CLIFF_DAYS,
builder_vesting_days: BUILDER_VESTING_DAYS,
builder_unlock_days: BUILDER_UNLOCK_DAYS,
builder_daily_unlock_pct: BUILDER_DAILY_UNLOCK_PCT,
builder_total_allocation_pct: BUILDER_TOTAL_ALLOCATION_PCT,
builder_vesting_start_at: null,
builder_vesting_rule: BUILDER_VESTING_RULE,

phase,
market_enabled: false,
can_trade: false,
};
}

function buildWalletPayload(wallet = {}, stats = {}, launch = null) {
const phase = buildPhaseMeta(launch);

if (!phase.market_enabled) {
return buildEmptyWalletPayload(phase);
}

const tokenBalance = toInt(
wallet.token_balance ??
wallet.tokenBalance ??
wallet.balance_tokens ??
wallet.wallet_balance_tokens ??
stats.wallet_token_balance ??
stats.wallet_balance_tokens,
0
);

const totalBalance = toInt(
wallet.total_balance ??
wallet.totalBalance ??
stats.wallet_total_balance ??
tokenBalance,
tokenBalance
);

const visibleTotalBalance = toInt(
wallet.visible_total_balance ??
wallet.visibleTotalBalance ??
stats.wallet_visible_total_balance ??
totalBalance,
totalBalance
);

const sellableBalance = toInt(
wallet.sellable_balance ??
wallet.sellableBalance ??
wallet.sellable_token_balance ??
wallet.sellableTokenBalance ??
stats.wallet_sellable_balance ??
stats.wallet_sellable_token_balance ??
tokenBalance,
tokenBalance
);

const unlockedBalance = toInt(
wallet.unlocked_balance ??
wallet.unlockedBalance ??
wallet.unlocked_token_balance ??
wallet.unlockedTokenBalance ??
stats.wallet_unlocked_balance ??
stats.wallet_unlocked_token_balance ??
sellableBalance,
sellableBalance
);

const lockedBalance = toInt(
wallet.locked_balance ??
wallet.lockedBalance ??
wallet.locked_token_balance ??
wallet.lockedTokenBalance ??
stats.wallet_locked_balance ??
stats.wallet_locked_token_balance ??
Math.max(0, visibleTotalBalance - unlockedBalance),
Math.max(0, visibleTotalBalance - unlockedBalance)
);

const positionValueSol = toNumber(
chooseFirstFinite(
wallet.position_value_sol,
wallet.positionValueSol,
stats.wallet_position_value_sol,
stats.price_sol && visibleTotalBalance > 0
? Number(stats.price_sol) * visibleTotalBalance
: 0
),
0
);

const positionValueUsd = toNumber(
chooseFirstFinite(
wallet.position_value_usd,
wallet.positionValueUsd,
stats.wallet_position_value_usd,
stats.price_usd && visibleTotalBalance > 0
? Number(stats.price_usd) * visibleTotalBalance
: 0
),
0
);

const solBalance = toNumber(
wallet.sol_balance ?? wallet.solBalance ?? stats.wallet_sol_balance,
0
);

const solDelta = toNumber(
wallet.sol_delta ??
wallet.solDelta ??
wallet.walletSolDelta ??
stats.wallet_sol_delta ??
stats.walletSolDelta ??
solBalance,
solBalance
);

const walletIsBuilder = Boolean(
wallet.wallet_is_builder ||
wallet.is_builder_wallet ||
stats.wallet_is_builder ||
stats.is_builder_wallet
);

const walletIsParticipant = Boolean(
wallet.is_participant_wallet || stats.is_participant_wallet
);

const walletIsTeam = Boolean(wallet.is_team_wallet || stats.is_team_wallet);

const walletVestingActive = Boolean(
wallet.wallet_vesting_active ||
wallet.vesting_active ||
stats.wallet_vesting_active ||
stats.vesting_active ||
lockedBalance > 0
);

const participantTotalAllocationTokens = toInt(
wallet.participant_total_allocation_tokens ??
stats.participant_total_allocation_tokens,
0
);

const participantUnlockedTokens = toInt(
wallet.participant_unlocked_tokens ??
stats.participant_unlocked_tokens ??
(participantTotalAllocationTokens > 0
? participantTotalAllocationTokens
: 0),
participantTotalAllocationTokens > 0 ? participantTotalAllocationTokens : 0
);

const participantLockedTokens = toInt(
wallet.participant_locked_tokens ?? stats.participant_locked_tokens,
0
);

const participantSellableTokens = toInt(
wallet.participant_sellable_tokens ??
stats.participant_sellable_tokens ??
participantUnlockedTokens,
participantUnlockedTokens
);

const builderVisibleTotalTokens = toInt(
wallet.builder_visible_total_tokens ??
stats.builder_visible_total_tokens ??
visibleTotalBalance,
visibleTotalBalance
);

return {
...wallet,

token_balance: tokenBalance,
tokenBalance,
balance_tokens: tokenBalance,
wallet_balance_tokens: tokenBalance,

total_balance: totalBalance,
totalBalance,
visible_total_balance: visibleTotalBalance,
visibleTotalBalance,

sellable_balance: sellableBalance,
sellableBalance,
sellable_token_balance: sellableBalance,
sellableTokenBalance: sellableBalance,

unlocked_balance: unlockedBalance,
unlockedBalance,
unlocked_token_balance: unlockedBalance,
unlockedTokenBalance: unlockedBalance,

locked_balance: lockedBalance,
lockedBalance,
locked_token_balance: lockedBalance,
lockedTokenBalance: lockedBalance,

position_value_sol: positionValueSol,
positionValueSol,
position_value_usd: positionValueUsd,
positionValueUsd,

sol_balance: solBalance,
solBalance,
sol_delta: solDelta,
solDelta,
walletSolDelta: solDelta,

wallet_is_builder: walletIsBuilder,
is_builder_wallet: walletIsBuilder,
is_participant_wallet: walletIsParticipant,
is_team_wallet: walletIsTeam,
vesting_active: walletVestingActive,
wallet_vesting_active: walletVestingActive,

participant_total_allocation_tokens: participantTotalAllocationTokens,
participant_unlocked_tokens: participantUnlockedTokens,
participant_locked_tokens: participantLockedTokens,
participant_sellable_tokens: participantSellableTokens,
participant_vesting_percent_unlocked: toNumber(
wallet.participant_vesting_percent_unlocked ??
stats.participant_vesting_percent_unlocked ??
(participantTotalAllocationTokens > 0 ? 100 : 0),
participantTotalAllocationTokens > 0 ? 100 : 0
),
participant_vesting_days_live: toInt(
wallet.participant_vesting_days_live ??
stats.participant_vesting_days_live,
0
),
participant_vesting_days: toInt(
wallet.participant_vesting_days ?? stats.participant_vesting_days,
0
),
participant_vesting_label: cleanText(
wallet.participant_vesting_label ??
stats.participant_vesting_label ??
(participantTotalAllocationTokens > 0 ? PARTICIPANT_UNLOCK_LABEL : ""),
200
),

team_total_allocation_tokens: toInt(
wallet.team_total_allocation_tokens ?? stats.team_total_allocation_tokens,
0
),
team_unlocked_tokens: toInt(
wallet.team_unlocked_tokens ?? stats.team_unlocked_tokens,
0
),
team_locked_tokens: toInt(
wallet.team_locked_tokens ?? stats.team_locked_tokens,
0
),
team_sellable_tokens: toInt(
wallet.team_sellable_tokens ?? stats.team_sellable_tokens,
0
),
team_vesting_percent_unlocked: toNumber(
wallet.team_vesting_percent_unlocked ??
stats.team_vesting_percent_unlocked,
0
),

builder_total_allocation_tokens: toInt(
wallet.builder_total_allocation_tokens ??
stats.builder_total_allocation_tokens,
0
),
builder_unlocked_tokens: toInt(
wallet.builder_unlocked_tokens ?? stats.builder_unlocked_tokens,
0
),
builder_locked_tokens: toInt(
wallet.builder_locked_tokens ?? stats.builder_locked_tokens,
0
),
builder_sellable_tokens: toInt(
wallet.builder_sellable_tokens ?? stats.builder_sellable_tokens,
0
),
builder_visible_total_tokens: builderVisibleTotalTokens,
builder_unlocked_allocation_tokens: toInt(
wallet.builder_unlocked_allocation_tokens ??
stats.builder_unlocked_allocation_tokens,
0
),
builder_locked_allocation_tokens: toInt(
wallet.builder_locked_allocation_tokens ??
stats.builder_locked_allocation_tokens,
0
),
builder_vesting_percent_unlocked: toNumber(
wallet.builder_vesting_percent_unlocked ??
stats.builder_vesting_percent_unlocked,
0
),
builder_vesting_days_live: toInt(
wallet.builder_vesting_days_live ?? stats.builder_vesting_days_live,
0
),
builder_vested_days: toInt(
wallet.builder_vested_days ?? stats.builder_vested_days,
0
),
builder_daily_unlock_tokens: toInt(
wallet.builder_daily_unlock_tokens ?? stats.builder_daily_unlock_tokens,
0
),
builder_cliff_days: BUILDER_CLIFF_DAYS,
builder_vesting_days: BUILDER_VESTING_DAYS,
builder_unlock_days: BUILDER_UNLOCK_DAYS,
builder_daily_unlock_pct: BUILDER_DAILY_UNLOCK_PCT,
builder_total_allocation_pct: BUILDER_TOTAL_ALLOCATION_PCT,
builder_vesting_start_at:
wallet.builder_vesting_start_at ?? stats.builder_vesting_start_at ?? null,
builder_vesting_rule: BUILDER_VESTING_RULE,

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

function ensureLaunchExistsOr404(res, launch) {
if (launch) return false;

res.status(404).json({
ok: false,
success: false,
error: "Launch not found",
});

return true;
}

function buildResponseContext(payload = {}, wallet = "") {
const rawLaunch = payload?.launch || null;
const phase = buildPhaseMeta(rawLaunch);
const stats = sanitizeStatsForResponse(payload?.stats || {}, rawLaunch);
const sanitizedLaunch = sanitizeLaunchForResponse(rawLaunch, stats);
const walletPayload = buildWalletPayload(payload?.wallet || {}, stats, rawLaunch);

return {
rawLaunch,
phase,
stats,
launch: sanitizedLaunch,
token: sanitizeTokenForResponse(payload?.token || null, rawLaunch),
pool: sanitizePoolForResponse(payload?.pool || null, rawLaunch),
wallet: walletPayload,
wallet_summary: walletPayload,
cassie: buildCassiePayload(payload?.cassie || null, rawLaunch),
wallet_address: wallet || null,
};
}

router.get("/:launchId/candles", async (req, res) => {
try {
const launchId = parseLaunchId(req.params.launchId);
const interval = normalizeInterval(req.query.interval);
const limit = clampInt(req.query.limit, 120, 1, 500);

if (!launchId) {
return res.status(400).json({
ok: false,
success: false,
error: "Invalid launch id",
});
}

const payload = await getChartCandles({
db: launcherDb,
launchId,
interval,
limit,
});

if (ensureLaunchExistsOr404(res, payload?.launch || null)) return;

const ctx = buildResponseContext(payload);

return res.json({
ok: true,
success: true,
launch_id: launchId,
launchId,
status: ctx.phase.status,
phase: ctx.phase,
market_enabled: ctx.phase.market_enabled,
can_trade: ctx.phase.can_trade,
interval,
candles: sanitizeCandlesForResponse(payload?.candles || [], ctx.rawLaunch),
launch: ctx.launch,
token: ctx.token,
pool: ctx.pool,
stats: ctx.stats,
});
} catch (error) {
console.error("GET /api/chart/:launchId/candles failed", error);

return res.status(500).json({
ok: false,
success: false,
error: error?.message || "Failed to fetch candles",
});
}
});

router.get("/:launchId/trades", async (req, res) => {
try {
const launchId = parseLaunchId(req.params.launchId);
const limit = clampInt(req.query.limit, 50, 1, 200);

if (!launchId) {
return res.status(400).json({
ok: false,
success: false,
error: "Invalid launch id",
});
}

const payload = await getChartTrades({
db: launcherDb,
launchId,
limit,
});

if (ensureLaunchExistsOr404(res, payload?.launch || null)) return;

const ctx = buildResponseContext(payload);

return res.json({
ok: true,
success: true,
launch_id: launchId,
launchId,
status: ctx.phase.status,
phase: ctx.phase,
market_enabled: ctx.phase.market_enabled,
can_trade: ctx.phase.can_trade,
trades: sanitizeTradesForResponse(payload?.trades || [], ctx.rawLaunch),
launch: ctx.launch,
token: ctx.token,
pool: ctx.pool,
stats: ctx.stats,
});
} catch (error) {
console.error("GET /api/chart/:launchId/trades failed", error);

return res.status(500).json({
ok: false,
success: false,
error: error?.message || "Failed to fetch trades",
});
}
});

router.get("/:launchId/stats", async (req, res) => {
try {
const launchId = parseLaunchId(req.params.launchId);
const wallet = getWalletParam(req.query);

if (!launchId) {
return res.status(400).json({
ok: false,
success: false,
error: "Invalid launch id",
});
}

const payload = await getChartStats({
db: launcherDb,
launchId,
wallet,
});

if (ensureLaunchExistsOr404(res, payload?.launch || null)) return;

const ctx = buildResponseContext(payload, wallet);

return res.json({
ok: true,
success: true,
launch_id: launchId,
launchId,
status: ctx.phase.status,
phase: ctx.phase,
market_enabled: ctx.phase.market_enabled,
can_trade: ctx.phase.can_trade,
stats: ctx.stats,
launch: ctx.launch,
token: ctx.token,
pool: ctx.pool,
wallet: ctx.wallet,
wallet_summary: ctx.wallet_summary,
wallet_address: ctx.wallet_address,
cassie: ctx.cassie,
});
} catch (error) {
console.error("GET /api/chart/:launchId/stats failed", error);

return res.status(500).json({
ok: false,
success: false,
error: error?.message || "Failed to fetch chart stats",
});
}
});

router.get("/:launchId/snapshot", async (req, res) => {
try {
const launchId = parseLaunchId(req.params.launchId);
const interval = normalizeInterval(req.query.interval);
const candleLimit = clampInt(
req.query.candle_limit ?? req.query.candleLimit ?? req.query.limit,
120,
1,
500
);
const tradeLimit = clampInt(
req.query.trade_limit ?? req.query.tradeLimit,
50,
1,
200
);
const wallet = getWalletParam(req.query);

if (!launchId) {
return res.status(400).json({
ok: false,
success: false,
error: "Invalid launch id",
});
}

const payload = await getChartSnapshot({
db: launcherDb,
launchId,
interval,
candleLimit,
tradeLimit,
wallet,
});

if (ensureLaunchExistsOr404(res, payload?.launch || null)) return;

const ctx = buildResponseContext(payload, wallet);

return res.json({
ok: true,
success: true,
launch_id: launchId,
launchId,
status: ctx.phase.status,
phase: ctx.phase,
market_enabled: ctx.phase.market_enabled,
can_trade: ctx.phase.can_trade,
interval,
launch: ctx.launch,
token: ctx.token,
pool: ctx.pool,
wallet: ctx.wallet,
wallet_summary: ctx.wallet_summary,
wallet_address: ctx.wallet_address,
stats: ctx.stats,
candles: sanitizeCandlesForResponse(payload?.candles || [], ctx.rawLaunch),
trades: sanitizeTradesForResponse(payload?.trades || [], ctx.rawLaunch),
cassie: ctx.cassie,
});
} catch (error) {
console.error("GET /api/chart/:launchId/snapshot failed", error);

return res.status(500).json({
ok: false,
success: false,
error: error?.message || "Failed to fetch chart snapshot",
});
}
});

export default router;