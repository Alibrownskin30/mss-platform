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

const inferredStatus = inferRevealStatus(launch);
const revealContract = shouldRevealContractAddress(inferredStatus);

return {
...launch,
status: inferredStatus || launch.status || null,

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

function extractGraduationReadiness(lifecycle) {
return lifecycle?.graduationReadiness || null;
}

function normalizeLifecycle(lifecycle = {}) {
if (!lifecycle || typeof lifecycle !== "object") return null;

return {
internal_sol_reserve: toNumber(lifecycle.internal_sol_reserve, 0),
internal_token_reserve: toInt(lifecycle.internal_token_reserve, 0),
implied_marketcap_sol: toNumber(lifecycle.implied_marketcap_sol, 0),

graduation_status:
cleanText(lifecycle.graduation_status, 120) || "internal_live",
graduated: Boolean(lifecycle.graduated),
graduation_reason: cleanText(lifecycle.graduation_reason, 200) || null,
graduated_at: lifecycle.graduated_at || null,

raydium_target_pct: toNumber(lifecycle.raydium_target_pct, 50),
mss_locked_target_pct: toNumber(lifecycle.mss_locked_target_pct, 50),

raydium_pool_id: cleanText(lifecycle.raydium_pool_id, 200) || null,
raydium_sol_migrated: toNumber(lifecycle.raydium_sol_migrated, 0),
raydium_token_migrated: toInt(lifecycle.raydium_token_migrated, 0),
raydium_lp_tokens: cleanText(lifecycle.raydium_lp_tokens, 200) || null,
raydium_migration_tx:
cleanText(lifecycle.raydium_migration_tx, 300) || null,

mss_locked_sol: toNumber(lifecycle.mss_locked_sol, 0),
mss_locked_token: toInt(lifecycle.mss_locked_token, 0),
mss_locked_lp_amount:
cleanText(lifecycle.mss_locked_lp_amount, 200) || null,
lock_status: cleanText(lifecycle.lock_status, 120) || "not_locked",
lock_tx: cleanText(lifecycle.lock_tx, 300) || null,
lock_expires_at: lifecycle.lock_expires_at || null,

graduationReadiness: lifecycle.graduationReadiness || null,
builderVesting: lifecycle.builderVesting || null,
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
}
: null,
};
}

function normalizeBuilderVestingSummary(raw = {}) {
if (!raw || typeof raw !== "object") return null;

return {
builder_wallet: cleanText(raw.builder_wallet, 120) || null,
total_allocation: toInt(raw.total_allocation, 0),
daily_unlock: toInt(raw.daily_unlock, 0),
unlocked_amount: toInt(raw.unlocked_amount, 0),
locked_amount: toInt(raw.locked_amount, 0),
vesting_start_at: raw.vesting_start_at || null,
created_at: raw.created_at || null,
updated_at: raw.updated_at || null,
vested_days: toInt(raw.vested_days, 0),
};
}

function pickLaunchRow(row) {
if (!row) return null;

const inferredStatus = inferRevealStatus(row);
const revealContract = shouldRevealContractAddress(inferredStatus);

return {
id: row.id,
token_name: row.token_name,
symbol: row.symbol,
status: inferredStatus || row.status,
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

liquidity: toNumber(row.liquidity, 0),
liquidity_sol: toNumber(row.liquidity, 0),
liquidity_usd: toNumber(row.liquidity_usd, 0),
current_liquidity_usd: toNumber(row.current_liquidity_usd, 0),
price: toNumber(row.price, 0),
price_usd: toNumber(row.price_usd, 0),
market_cap: toNumber(row.market_cap, 0),
market_cap_usd: toNumber(row.market_cap_usd, 0),
volume_24h: toNumber(row.volume_24h, 0),
volume_24h_usd: toNumber(row.volume_24h_usd, 0),
sol_usd_price: toNumber(row.sol_usd_price, 0),
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

function buildWalletPayload(snapshotWallet = {}, stats = {}) {
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
OR l.reserved_mint_address = ?
LIMIT 1
`,
[mint, mint]
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

const snapshotStats = snapshot?.stats || {};
const lifecycle = normalizeLifecycle(lifecycleRaw);
const graduationReadiness = normalizeGraduationReadiness(
extractGraduationReadiness(lifecycleRaw)
);
const builderVesting = normalizeBuilderVestingSummary(
lifecycleRaw?.builderVesting || {}
);

const snapshotLaunch = sanitizeLaunchForResponse(
snapshot?.launch || null,
snapshotStats
);

const resolvedLaunch =
snapshotLaunch || sanitizeLaunchForResponse(fallbackLaunch, snapshotStats);

const effectiveStatus = inferRevealStatus(
resolvedLaunch || fallbackLaunch || {}
);
const revealContract = shouldRevealContractAddress(effectiveStatus);

const resolvedMintAddress =
(revealContract
? cleanText(
tokenRow.mint_address ||
snapshot?.token?.mint_address ||
snapshotLaunch?.mint_address ||
resolvedLaunch?.mint_address,
120
)
: "") || null;

const walletPayload = buildWalletPayload(
snapshot?.wallet || {},
snapshotStats
);

const tokenPayload = {
id: tokenRow.id,
launch_id: tokenRow.launch_id,
name: tokenRow.name,
symbol: tokenRow.symbol,
ticker: tokenRow.symbol,
supply: toInt(
chooseFirstFinite(
tokenRow.supply,
snapshot?.token?.supply,
resolvedLaunch?.final_supply,
resolvedLaunch?.supply
),
0
),
mint_address: revealContract ? resolvedMintAddress : null,
mint: revealContract ? resolvedMintAddress : null,
created_at: tokenRow.created_at,
};

const normalizedLaunch = resolvedLaunch
? {
...resolvedLaunch,
status: effectiveStatus || resolvedLaunch.status || null,
contract_address: revealContract
? cleanText(resolvedLaunch.contract_address, 120) || null
: null,
mint_address: revealContract ? resolvedMintAddress : null,
mint_reservation_status: revealContract
? cleanText(resolvedLaunch.mint_reservation_status, 64) || null
: null,
lifecycle,
graduation_readiness: graduationReadiness,
builder_vesting: builderVesting,
}
: null;

return res.json({
ok: true,
success: true,
mint,
wallet: wallet || null,

token: tokenPayload,
launch: normalizedLaunch,

chart: {
stats: snapshotStats,
candles: snapshot?.candles || [],
trades: snapshot?.trades || [],
},

stats: snapshotStats,
candles: snapshot?.candles || [],
trades: snapshot?.trades || [],
pool: snapshot?.pool || null,

wallet_summary: walletPayload,
wallet: walletPayload,

lifecycle,
graduationPlan,
graduationReadiness: graduationReadiness,

cassie: snapshot?.cassie || {
monitoring_active: true,
phase:
String(effectiveStatus || resolvedLaunch?.status || "").toLowerCase() ||
"commit",
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
