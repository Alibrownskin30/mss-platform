import express from "express";
import launcherDb from "../db/index.js";
import {
getChartCandles,
getChartTrades,
getChartStats,
getChartSnapshot,
} from "../services/chart-service.js";

const router = express.Router();

const ALLOWED_INTERVALS = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);

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
const interval = String(raw || "1m").trim();
if (!ALLOWED_INTERVALS.has(interval)) {
return "1m";
}
return interval;
}

function cleanWallet(raw) {
return String(raw ?? "").trim().slice(0, 120);
}

function cleanText(value, max = 200) {
return String(value ?? "").trim().slice(0, max);
}

function toNumber(value, fallback = 0) {
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

const revealedMintAddress = revealContract
? cleanText(
launch.mint_address || launch.contract_address || launch.token_mint,
120
) || null
: null;

return {
...launch,
status: phase.status || launch.status || null,
phase,

contract_address: revealContract
? cleanText(launch.contract_address, 120) || revealedMintAddress
: null,
mint_address: revealedMintAddress,
token_mint: revealedMintAddress,

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

const revealedMintAddress = revealContract
? cleanText(
token.mint_address || token.mint || launch?.mint_address || launch?.token_mint,
120
) || null
: null;

return {
...token,
mint_address: revealedMintAddress,
mint: revealedMintAddress,
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

function buildWalletPayload(wallet = {}, stats = {}, launch = null) {
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
walletSolDelta: 0,

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

const tokenBalance = toInt(
wallet.token_balance ??
wallet.tokenBalance ??
stats.wallet_token_balance,
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
wallet.sol_balance ??
wallet.solBalance ??
stats.wallet_sol_balance,
0
);

const solDelta = toNumber(
wallet.sol_delta ??
wallet.solDelta ??
stats.wallet_sol_delta ??
solBalance,
solBalance
);

const walletIsBuilder = Boolean(
wallet.wallet_is_builder ??
wallet.is_builder_wallet ??
stats.wallet_is_builder ??
stats.is_builder_wallet ??
false
);

const walletVestingActive = Boolean(
wallet.wallet_vesting_active ??
wallet.vesting_active ??
stats.wallet_vesting_active ??
false
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
tokenBalance: tokenBalance,
balance_tokens: tokenBalance,
wallet_balance_tokens: tokenBalance,

total_balance: totalBalance,
totalBalance: totalBalance,
visible_total_balance: visibleTotalBalance,
visibleTotalBalance: visibleTotalBalance,

sellable_balance: sellableBalance,
sellableBalance: sellableBalance,
sellable_token_balance: sellableBalance,
sellableTokenBalance: sellableBalance,

unlocked_balance: unlockedBalance,
unlockedBalance: unlockedBalance,
unlocked_token_balance: unlockedBalance,
unlockedTokenBalance: unlockedBalance,

locked_balance: lockedBalance,
lockedBalance: lockedBalance,
locked_token_balance: lockedBalance,
lockedTokenBalance: lockedBalance,

position_value_usd: positionValueUsd,
positionValueUsd: positionValueUsd,

sol_balance: solBalance,
solBalance: solBalance,
sol_delta: solDelta,
solDelta: solDelta,
walletSolDelta: solDelta,

wallet_is_builder: walletIsBuilder,
is_builder_wallet: walletIsBuilder,
vesting_active: walletVestingActive,
wallet_vesting_active: walletVestingActive,

builder_total_allocation_tokens: toInt(
wallet.builder_total_allocation_tokens ??
stats.builder_total_allocation_tokens,
0
),
builder_unlocked_tokens: toInt(
wallet.builder_unlocked_tokens ??
stats.builder_unlocked_tokens,
0
),
builder_locked_tokens: toInt(
wallet.builder_locked_tokens ??
stats.builder_locked_tokens,
0
),
builder_sellable_tokens: toInt(
wallet.builder_sellable_tokens ??
stats.builder_sellable_tokens,
0
),
builder_visible_total_tokens: builderVisibleTotalTokens,
builder_vesting_percent_unlocked: toNumber(
wallet.builder_vesting_percent_unlocked ??
stats.builder_vesting_percent_unlocked,
0
),
builder_vesting_days_live: toInt(
wallet.builder_vesting_days_live ??
stats.builder_vesting_days_live,
0
),
builder_daily_unlock_tokens: toInt(
wallet.builder_daily_unlock_tokens ??
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

function ensureLaunchExistsOr404(res, launch) {
if (launch) return false;

res.status(404).json({
ok: false,
error: "Launch not found",
});
return true;
}

router.get("/:launchId/candles", async (req, res) => {
try {
const launchId = parseLaunchId(req.params.launchId);
const interval = normalizeInterval(req.query.interval);
const limit = clampInt(req.query.limit, 120, 1, 500);

if (!launchId) {
return res.status(400).json({
ok: false,
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

const rawLaunch = payload?.launch || null;
const phase = buildPhaseMeta(rawLaunch);
const stats = sanitizeStatsForResponse(payload?.stats || {}, rawLaunch);
const sanitizedLaunch = sanitizeLaunchForResponse(rawLaunch, stats);

return res.json({
ok: true,
success: true,
launch_id: launchId,
launchId,
status: phase.status,
phase,
interval,
candles: sanitizeCandlesForResponse(payload?.candles || [], rawLaunch),
launch: sanitizedLaunch,
token: sanitizeTokenForResponse(payload?.token || null, sanitizedLaunch),
pool: sanitizePoolForResponse(payload?.pool || null, rawLaunch),
stats,
});
} catch (error) {
console.error("GET /api/chart/:launchId/candles failed", error);
return res.status(500).json({
ok: false,
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
error: "Invalid launch id",
});
}

const payload = await getChartTrades({
db: launcherDb,
launchId,
limit,
});

if (ensureLaunchExistsOr404(res, payload?.launch || null)) return;

const rawLaunch = payload?.launch || null;
const phase = buildPhaseMeta(rawLaunch);
const stats = sanitizeStatsForResponse(payload?.stats || {}, rawLaunch);
const sanitizedLaunch = sanitizeLaunchForResponse(rawLaunch, stats);

return res.json({
ok: true,
success: true,
launch_id: launchId,
launchId,
status: phase.status,
phase,
trades: sanitizeTradesForResponse(payload?.trades || [], rawLaunch),
launch: sanitizedLaunch,
token: sanitizeTokenForResponse(payload?.token || null, sanitizedLaunch),
pool: sanitizePoolForResponse(payload?.pool || null, rawLaunch),
stats,
});
} catch (error) {
console.error("GET /api/chart/:launchId/trades failed", error);
return res.status(500).json({
ok: false,
error: error?.message || "Failed to fetch trades",
});
}
});

router.get("/:launchId/stats", async (req, res) => {
try {
const launchId = parseLaunchId(req.params.launchId);
const wallet = cleanWallet(req.query.wallet);

if (!launchId) {
return res.status(400).json({
ok: false,
error: "Invalid launch id",
});
}

const payload = await getChartStats({
db: launcherDb,
launchId,
wallet,
});

if (ensureLaunchExistsOr404(res, payload?.launch || null)) return;

const rawLaunch = payload?.launch || null;
const phase = buildPhaseMeta(rawLaunch);
const stats = sanitizeStatsForResponse(payload?.stats || {}, rawLaunch);
const sanitizedLaunch = sanitizeLaunchForResponse(rawLaunch, stats);
const walletPayload = buildWalletPayload(payload?.wallet || {}, stats, rawLaunch);

return res.json({
ok: true,
success: true,
launch_id: launchId,
launchId,
status: phase.status,
phase,
stats,
launch: sanitizedLaunch,
token: sanitizeTokenForResponse(payload?.token || null, sanitizedLaunch),
pool: sanitizePoolForResponse(payload?.pool || null, rawLaunch),
wallet: walletPayload,
wallet_summary: walletPayload,
cassie: buildCassiePayload(payload?.cassie || null, rawLaunch),
});
} catch (error) {
console.error("GET /api/chart/:launchId/stats failed", error);
return res.status(500).json({
ok: false,
error: error?.message || "Failed to fetch chart stats",
});
}
});

router.get("/:launchId/snapshot", async (req, res) => {
try {
const launchId = parseLaunchId(req.params.launchId);
const interval = normalizeInterval(req.query.interval);
const candleLimit = clampInt(req.query.candle_limit, 120, 1, 500);
const tradeLimit = clampInt(req.query.trade_limit, 50, 1, 200);
const wallet = cleanWallet(req.query.wallet);

if (!launchId) {
return res.status(400).json({
ok: false,
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

const rawLaunch = payload?.launch || null;
const phase = buildPhaseMeta(rawLaunch);
const stats = sanitizeStatsForResponse(payload?.stats || {}, rawLaunch);
const sanitizedLaunch = sanitizeLaunchForResponse(rawLaunch, stats);
const walletPayload = buildWalletPayload(payload?.wallet || {}, stats, rawLaunch);

return res.json({
ok: true,
success: true,
launch_id: launchId,
launchId,
status: phase.status,
phase,
interval,
launch: sanitizedLaunch,
token: sanitizeTokenForResponse(payload?.token || null, sanitizedLaunch),
pool: sanitizePoolForResponse(payload?.pool || null, rawLaunch),
wallet: walletPayload,
wallet_summary: walletPayload,
stats,
candles: sanitizeCandlesForResponse(payload?.candles || [], rawLaunch),
trades: sanitizeTradesForResponse(payload?.trades || [], rawLaunch),
cassie: buildCassiePayload(payload?.cassie || null, rawLaunch),
});
} catch (error) {
console.error("GET /api/chart/:launchId/snapshot failed", error);
return res.status(500).json({
ok: false,
error: error?.message || "Failed to fetch chart snapshot",
});
}
});

export default router;
