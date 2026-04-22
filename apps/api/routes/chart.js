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

if (!hasExplicitTimezone && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
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
launch.mint_address
);
const reservationStatus = cleanText(
launch.mint_reservation_status,
64
).toLowerCase();

const countdownStartedMs = parseDbTime(launch.countdown_started_at);
const countdownEndsMs = parseDbTime(launch.countdown_ends_at || launch.live_at);
const liveAtMs = parseDbTime(launch.live_at || launch.countdown_ends_at);

const hasCountdownWindow =
Number.isFinite(countdownStartedMs) || Number.isFinite(countdownEndsMs);

const hasLiveSignal = Boolean(
contractAddress || reservationStatus === "finalized"
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

function sanitizeLaunchForResponse(launch = null, stats = {}) {
if (!launch) return null;

const normalizedStatus = inferRevealStatus(launch);
const revealContract = shouldRevealContractAddress(normalizedStatus);

return {
...launch,
status: normalizedStatus || launch.status || null,

contract_address: revealContract
? cleanText(launch.contract_address, 120) || null
: null,
mint_address: revealContract
? cleanText(
launch.mint_address || launch.contract_address,
120
) || null
: null,

reserved_mint_address: null,
reserved_mint_secret: null,
mint_reservation_status: revealContract
? cleanText(launch.mint_reservation_status, 64) || null
: null,
mint_finalized_at: revealContract ? launch.mint_finalized_at || null : null,

price: toNumber(
chooseFirstFinite(
stats.price_sol,
stats.price,
launch.price
),
0
),
price_sol: toNumber(
chooseFirstFinite(
stats.price_sol,
stats.price,
launch.price
),
0
),
price_usd: toNumber(
chooseFirstFinite(
stats.price_usd,
launch.price_usd
),
0
),

liquidity: toNumber(
chooseFirstFinite(
stats.liquidity_sol,
stats.liquidity,
launch.liquidity_sol,
launch.liquidity
),
0
),
liquidity_sol: toNumber(
chooseFirstFinite(
stats.liquidity_sol,
stats.liquidity,
launch.liquidity_sol,
launch.liquidity
),
0
),
liquidity_usd: toNumber(
chooseFirstFinite(
stats.liquidity_usd,
launch.liquidity_usd,
launch.current_liquidity_usd
),
0
),
current_liquidity_usd: toNumber(
chooseFirstFinite(
stats.liquidity_usd,
launch.current_liquidity_usd,
launch.liquidity_usd
),
0
),

market_cap: toNumber(
chooseFirstFinite(
stats.market_cap_sol,
stats.market_cap,
launch.market_cap
),
0
),
market_cap_sol: toNumber(
chooseFirstFinite(
stats.market_cap_sol,
stats.market_cap,
launch.market_cap
),
0
),
market_cap_usd: toNumber(
chooseFirstFinite(
stats.market_cap_usd,
launch.market_cap_usd
),
0
),

volume_24h: toNumber(
chooseFirstFinite(
stats.volume_24h_sol,
stats.volume_24h,
launch.volume_24h
),
0
),
volume_24h_sol: toNumber(
chooseFirstFinite(
stats.volume_24h_sol,
stats.volume_24h,
launch.volume_24h
),
0
),
volume_24h_usd: toNumber(
chooseFirstFinite(
stats.volume_24h_usd,
launch.volume_24h_usd
),
0
),

sol_usd_price: toNumber(
chooseFirstFinite(
stats.sol_usd_price,
launch.sol_usd_price
),
0
),
};
}

function sanitizeTokenForResponse(token = null, launch = null) {
if (!token) return null;

const normalizedStatus = inferRevealStatus(launch);
const revealContract = shouldRevealContractAddress(normalizedStatus);

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

function buildWalletPayload(wallet = {}, stats = {}) {
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
error: "Invalid launch id",
});
}

const payload = await getChartCandles({
db: launcherDb,
launchId,
interval,
limit,
});

const stats = payload?.stats || {};
const sanitizedLaunch = sanitizeLaunchForResponse(payload?.launch || null, stats);

return res.json({
ok: true,
success: true,
launch_id: launchId,
launchId,
interval,
candles: payload?.candles || [],
launch: sanitizedLaunch,
token: sanitizeTokenForResponse(payload?.token || null, sanitizedLaunch),
pool: payload?.pool || null,
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

const stats = payload?.stats || {};
const sanitizedLaunch = sanitizeLaunchForResponse(payload?.launch || null, stats);

return res.json({
ok: true,
success: true,
launch_id: launchId,
launchId,
trades: payload?.trades || [],
launch: sanitizedLaunch,
token: sanitizeTokenForResponse(payload?.token || null, sanitizedLaunch),
pool: payload?.pool || null,
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

const stats = payload?.stats || {};
const sanitizedLaunch = sanitizeLaunchForResponse(payload?.launch || null, stats);
const walletPayload = buildWalletPayload(payload?.wallet || {}, stats);

return res.json({
ok: true,
success: true,
launch_id: launchId,
launchId,
stats,
launch: sanitizedLaunch,
token: sanitizeTokenForResponse(payload?.token || null, sanitizedLaunch),
pool: payload?.pool || null,
wallet: walletPayload,
wallet_summary: walletPayload,
cassie: payload?.cassie || null,
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

const stats = payload?.stats || {};
const sanitizedLaunch = sanitizeLaunchForResponse(payload?.launch || null, stats);
const walletPayload = buildWalletPayload(payload?.wallet || {}, stats);

return res.json({
ok: true,
success: true,
launch_id: launchId,
launchId,
interval,
launch: sanitizedLaunch,
token: sanitizeTokenForResponse(payload?.token || null, sanitizedLaunch),
pool: payload?.pool || null,
wallet: walletPayload,
wallet_summary: walletPayload,
stats,
candles: payload?.candles || [],
trades: payload?.trades || [],
cassie: payload?.cassie || null,
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
