import express from "express";
import db from "../db/index.js";
import { getLiquidityLifecycle } from "../services/launcher/liquidityLifecycle.js";

const router = express.Router();

const BASE_MAX_WALLET_PERCENT = 0.005; // 0.5%
const DAILY_INCREASE_PERCENT = 0.005; // +0.5% per day
const PROTECTED_WALLET_CAP_DAYS = 5;

const EXTERNAL_MARKET_VENUE = "raydium";
const EXTERNAL_MARKET_MODE = "external_lp_only";

function safeNum(value, fallback = 0) {
const n = Number(value);
return Number.isFinite(n) ? n : fallback;
}

function floorToken(value) {
return Math.max(0, Math.floor(safeNum(value, 0)));
}

function roundSol(value) {
return Number(safeNum(value, 0).toFixed(9));
}

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max);
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

function choosePreferredString(...values) {
for (const value of values) {
const cleaned = cleanText(value, 500);
if (cleaned) return cleaned;
}

return "";
}

function normalizeWallet(value) {
return cleanText(value, 120).toLowerCase();
}

function normalizePhaseStatus(value) {
const status = cleanText(value, 80).toLowerCase();

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

function isExplicitFalseish(value) {
if (value === false || value === 0) return true;
const raw = String(value ?? "").trim().toLowerCase();
return raw === "0" || raw === "false" || raw === "no";
}

function isMarketBootstrapPending(launch = {}) {
return isExplicitFalseish(launch?.market_bootstrapped);
}

function inferLaunchPhase(launch = {}) {
const rawStatus = normalizePhaseStatus(launch?.status);

const countdownStartedMs = parseDbTime(launch?.countdown_started_at);
const countdownEndsMs = parseDbTime(
launch?.countdown_ends_at || launch?.live_at
);
const liveAtMs = parseDbTime(launch?.live_at || launch?.countdown_ends_at);
const mintFinalizedAtMs = parseDbTime(launch?.mint_finalized_at);

const contractAddress = choosePreferredString(
launch?.contract_address,
launch?.token_mint,
launch?.mint_address,
launch?.mint
);

const reservationStatus = cleanText(
launch?.mint_reservation_status,
64
).toLowerCase();

const hasCountdownWindow =
Number.isFinite(countdownStartedMs) || Number.isFinite(countdownEndsMs);

const hasLiveSignal = Boolean(
contractAddress ||
reservationStatus === "finalized" ||
Number.isFinite(mintFinalizedAtMs)
);

const marketBootstrapPending = isMarketBootstrapPending(launch);

if (rawStatus === "failed_refunded") return "failed_refunded";
if (rawStatus === "failed") return "failed";
if (rawStatus === "graduated") return "graduated";

if (rawStatus === "live") {
return marketBootstrapPending ? "building" : "live";
}

/*
Protected phase rule:
countdown/building must not auto-promote to live from CA/mint/finalized signals.
finalizeLaunch.js owns true live promotion.
*/
if (rawStatus === "building") return "building";

if (rawStatus === "countdown") {
if (!Number.isFinite(countdownEndsMs) || Date.now() < countdownEndsMs) {
return "countdown";
}

return "building";
}

if (rawStatus === "commit") {
if (hasCountdownWindow) {
if (!Number.isFinite(countdownEndsMs) || Date.now() < countdownEndsMs) {
return "countdown";
}

return "building";
}

return "commit";
}

if (hasCountdownWindow) {
if (!Number.isFinite(countdownEndsMs) || Date.now() < countdownEndsMs) {
return "countdown";
}

return "building";
}

/*
Legacy fallback only:
old rows with no protected phase may infer live from finalized mint/CA data.
*/
if (
!rawStatus &&
Number.isFinite(liveAtMs) &&
Date.now() >= liveAtMs &&
hasLiveSignal
) {
return marketBootstrapPending ? "building" : "live";
}

if (!rawStatus && hasLiveSignal) {
return marketBootstrapPending ? "building" : "live";
}

return rawStatus || "commit";
}

function buildPhaseMeta(launch = {}) {
const status = inferLaunchPhase(launch);
const marketEnabled = status === "live" || status === "graduated";

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

function normalizeLaunchForMarket(launch = null) {
if (!launch) return null;

const phase = buildPhaseMeta(launch);

return {
...launch,
status: phase.status,
phase,
};
}

function shouldRevealContractAddress(status) {
const normalized = normalizePhaseStatus(status);
return normalized === "live" || normalized === "graduated";
}

function getDaysSinceLaunch(launch) {
const launchStartMs = parseDbTime(
launch?.live_at || launch?.updated_at || launch?.created_at
);

if (!Number.isFinite(launchStartMs)) return 0;

return Math.max(0, Math.floor((Date.now() - launchStartMs) / (24 * 60 * 60 * 1000)));
}

function isWalletCapOpen(launch) {
return getDaysSinceLaunch(launch) >= PROTECTED_WALLET_CAP_DAYS;
}

function getMaxWalletPercent(launch, isBuilderWallet = false) {
if (isWalletCapOpen(launch)) {
return 1;
}

if (isBuilderWallet) {
return 0.05;
}

const daysSinceLaunch = getDaysSinceLaunch(launch);
return BASE_MAX_WALLET_PERCENT + daysSinceLaunch * DAILY_INCREASE_PERCENT;
}

function getEffectiveTotalSupply(launch, token) {
return floorToken(
launch?.final_supply ??
launch?.total_supply ??
token?.supply ??
launch?.supply ??
launch?.circulating_supply ??
0
);
}

function buildWalletCapPayload(launch, token, isBuilderWallet = false) {
const totalSupply = getEffectiveTotalSupply(launch, token);
const maxWalletPercent = getMaxWalletPercent(launch, isBuilderWallet);
const walletCapOpen = isWalletCapOpen(launch);

return {
totalSupply,
total_supply: totalSupply,
maxWalletPercent,
max_wallet_percent: maxWalletPercent,
maxWalletPercentDisplay: maxWalletPercent * 100,
max_wallet_percent_display: maxWalletPercent * 100,
maxWalletTokens: walletCapOpen
? totalSupply
: floorToken(totalSupply * maxWalletPercent),
max_wallet_tokens: walletCapOpen
? totalSupply
: floorToken(totalSupply * maxWalletPercent),
walletCapOpen,
wallet_cap_open: walletCapOpen,
protectedDays: PROTECTED_WALLET_CAP_DAYS,
protected_days: PROTECTED_WALLET_CAP_DAYS,
protectedDay: Math.min(
getDaysSinceLaunch(launch) + 1,
PROTECTED_WALLET_CAP_DAYS
),
protected_day: Math.min(
getDaysSinceLaunch(launch) + 1,
PROTECTED_WALLET_CAP_DAYS
),
};
}

async function getLaunchById(launchId) {
const launch = await db.get(`SELECT * FROM launches WHERE id = ?`, [launchId]);
return normalizeLaunchForMarket(launch);
}

async function getTokenByLaunchId(launchId) {
return db.get(
`SELECT * FROM tokens WHERE launch_id = ? ORDER BY id DESC LIMIT 1`,
[launchId]
);
}

async function getBuilderWalletByLaunch(launch) {
const direct = cleanText(launch?.builder_wallet || "", 120);
if (direct) return direct;

if (!launch?.builder_id) return "";

const builder = await db.get(`SELECT wallet FROM builders WHERE id = ?`, [
launch.builder_id,
]);

return cleanText(builder?.wallet || "", 120);
}

function buildExternalRouteMessage(side, launch) {
const verb = side === "sell" ? "sell" : "buy";
const status = normalizePhaseStatus(launch?.status);

if (status === "commit") {
return `Trading is not open yet. Commit and reservation flow is active, but ${verb} routing stays external-only after live.`;
}

if (status === "countdown") {
return `Countdown is active. ${verb} routing opens on the external venue once launch goes live.`;
}

if (status === "building") {
return `Launch is building. Internal MSS execution is disabled. ${verb} routing becomes external-only after live bootstrap completes.`;
}

if (status === "live" || status === "graduated") {
return `MSS internal ${verb} execution is disabled in the external LP model. Trade on ${EXTERNAL_MARKET_VENUE} instead.`;
}

if (status === "failed" || status === "failed_refunded") {
return `This launch is not tradable.`;
}

return `Internal MSS execution is disabled for this market route.`;
}

function buildExternalRoutePayload({
launch,
token,
lifecycle,
wallet = "",
side = "buy",
}) {
const phase = launch?.phase || buildPhaseMeta(launch);
const revealAddress = shouldRevealContractAddress(phase.status);

const contractAddress = revealAddress
? choosePreferredString(
launch?.contract_address,
launch?.token_mint,
token?.mint_address,
launch?.mint_address,
launch?.mint
) || null
: null;

const builderWallet = cleanText(
launch?.builder_wallet ||
lifecycle?.builderWallet ||
lifecycle?.builder_wallet ||
"",
120
);

const walletStr = cleanText(wallet, 120);
const isBuilderWallet =
Boolean(walletStr) &&
Boolean(builderWallet) &&
normalizeWallet(walletStr) === normalizeWallet(builderWallet);

const walletCaps = buildWalletCapPayload(launch, token, isBuilderWallet);
const canTrade = Boolean(phase.can_trade);
const raydiumPoolId =
cleanText(
lifecycle?.raydiumPoolId || lifecycle?.raydium_pool_id || "",
200
) || null;

return {
ok: true,
success: false,
side,
externalMarketOnly: true,
external_market_only: true,
executionMode: EXTERNAL_MARKET_MODE,
execution_mode: EXTERNAL_MARKET_MODE,
executionAvailable: false,
execution_available: false,
quoteAvailable: false,
quote_available: false,
status: phase.status,
phase,
message: buildExternalRouteMessage(side, launch),
route: {
venue: canTrade ? EXTERNAL_MARKET_VENUE : null,
mode: EXTERNAL_MARKET_MODE,
canTrade,
can_trade: canTrade,
internalExecutionEnabled: false,
internal_execution_enabled: false,
contractAddress,
contract_address: contractAddress,
tokenMint: contractAddress,
token_mint: contractAddress,
raydiumPoolId,
raydium_pool_id: raydiumPoolId,
liquidity: roundSol(launch?.liquidity || 0),
price: safeNum(launch?.price, 0),
marketCap: safeNum(launch?.market_cap, 0),
market_cap: safeNum(launch?.market_cap, 0),
volume24h: roundSol(launch?.volume_24h || 0),
volume_24h: roundSol(launch?.volume_24h || 0),
mssLpFeeRightsPct: 100,
mss_lp_fee_rights_pct: 100,
builderLpFeeRightsPct: 0,
builder_lp_fee_rights_pct: 0,
},
wallet: {
connected: Boolean(walletStr),
address: walletStr || null,
isBuilderWallet,
is_builder_wallet: isBuilderWallet,
...walletCaps,
},
quote: {
available: false,
available_for_execution: false,
feePct: 0,
fee_pct: 0,
tokenOut: 0,
token_out: 0,
solOut: 0,
sol_out: 0,
externalMarketOnly: true,
external_market_only: true,
message: buildExternalRouteMessage(side, launch),
},
lifecycle: lifecycle || null,
};
}

async function resolveLaunchMarketContext(launchId, wallet = "") {
const launch = await getLaunchById(launchId);
if (!launch) {
return { error: "Launch not found", statusCode: 404 };
}

const token = await getTokenByLaunchId(launchId);

let lifecycle = null;
try {
lifecycle = await getLiquidityLifecycle(launchId);
} catch {
lifecycle = null;
}

const builderWallet = await getBuilderWalletByLaunch(launch);
const hydratedLaunch = {
...launch,
builder_wallet: launch.builder_wallet || builderWallet || null,
};

return {
launch: hydratedLaunch,
token,
lifecycle,
wallet: cleanText(wallet, 120),
};
}

router.post("/quote-buy", async (req, res) => {
try {
const launchId = Number(req.body.launchId);
const wallet = cleanText(req.body.wallet, 120);

if (!Number.isFinite(launchId) || launchId <= 0) {
return res.status(400).json({ ok: false, error: "Invalid launchId" });
}

const context = await resolveLaunchMarketContext(launchId, wallet);
if (context.error) {
return res.status(context.statusCode || 404).json({
ok: false,
error: context.error,
});
}

return res.json(
buildExternalRoutePayload({
launch: context.launch,
token: context.token,
lifecycle: context.lifecycle,
wallet: context.wallet,
side: "buy",
})
);
} catch (err) {
console.error("QUOTE BUY ERROR", err);
return res.status(500).json({
ok: false,
error: err.message || "Quote buy failed",
});
}
});

router.post("/quote-sell", async (req, res) => {
try {
const launchId = Number(req.body.launchId);
const wallet = cleanText(req.body.wallet, 120);

if (!Number.isFinite(launchId) || launchId <= 0) {
return res.status(400).json({ ok: false, error: "Invalid launchId" });
}

const context = await resolveLaunchMarketContext(launchId, wallet);
if (context.error) {
return res.status(context.statusCode || 404).json({
ok: false,
error: context.error,
});
}

return res.json(
buildExternalRoutePayload({
launch: context.launch,
token: context.token,
lifecycle: context.lifecycle,
wallet: context.wallet,
side: "sell",
})
);
} catch (err) {
console.error("QUOTE SELL ERROR", err);
return res.status(500).json({
ok: false,
error: err.message || "Quote sell failed",
});
}
});

router.post("/buy", async (req, res) => {
try {
const launchId = Number(req.body.launchId);
const wallet = cleanText(req.body.wallet, 120);

if (!Number.isFinite(launchId) || launchId <= 0) {
return res.status(400).json({ ok: false, error: "Invalid launchId" });
}

const context = await resolveLaunchMarketContext(launchId, wallet);
if (context.error) {
return res.status(context.statusCode || 404).json({
ok: false,
error: context.error,
});
}

const payload = buildExternalRoutePayload({
launch: context.launch,
token: context.token,
lifecycle: context.lifecycle,
wallet: context.wallet,
side: "buy",
});

return res.status(409).json({
...payload,
ok: false,
code: "external_market_only",
error: payload.message,
});
} catch (err) {
console.error("BUY ERROR", err);
return res.status(500).json({
ok: false,
error: err.message || "Buy failed",
});
}
});

router.post("/sell", async (req, res) => {
try {
const launchId = Number(req.body.launchId);
const wallet = cleanText(req.body.wallet, 120);

if (!Number.isFinite(launchId) || launchId <= 0) {
return res.status(400).json({ ok: false, error: "Invalid launchId" });
}

const context = await resolveLaunchMarketContext(launchId, wallet);
if (context.error) {
return res.status(context.statusCode || 404).json({
ok: false,
error: context.error,
});
}

const payload = buildExternalRoutePayload({
launch: context.launch,
token: context.token,
lifecycle: context.lifecycle,
wallet: context.wallet,
side: "sell",
});

return res.status(409).json({
...payload,
ok: false,
code: "external_market_only",
error: payload.message,
});
} catch (err) {
console.error("SELL ERROR", err);
return res.status(500).json({
ok: false,
error: err.message || "Sell failed",
});
}
});

export default router;
