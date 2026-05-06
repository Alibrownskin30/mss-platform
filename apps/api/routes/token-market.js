import express from "express";
import launcherDb from "../db/index.js";
import { getChartSnapshot } from "../services/chart-service.js";
import {
getLiquidityLifecycle,
buildGraduationPlanForLaunch,
} from "../services/launcher/liquidityLifecycle.js";

const router = express.Router();

const ALLOWED_INTERVALS = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);

const BUILDER_TOTAL_ALLOCATION_PCT = 5;
const BUILDER_DAILY_UNLOCK_PCT = 0.5;
const BUILDER_UNLOCK_DAYS = 10;
const BUILDER_CLIFF_DAYS = 0;
const BUILDER_VESTING_DAYS = BUILDER_UNLOCK_DAYS;

const TEAM_CLIFF_DAYS = 14;
const TEAM_VESTING_DAYS = 180;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PARTICIPANT_UNLOCKED_LABEL = "100% unlocked at live.";

const BUILDER_VESTING_RULE =
"0% unlocked at live. Builder allocation then unlocks at 0.5% of total supply per day for 10 days until the full 5% allocation is unlocked.";

const EXTERNAL_MARKET_VENUE = "Raydium";
const EXTERNAL_MARKET_MODE = "external_lp_only";

const MARKET_SOURCE_PRELIVE = "hidden_pre_live";
const MARKET_SOURCE_UNAVAILABLE = "unavailable";

const LP_FEE_BENEFICIARY_TYPE = "builder";
const LP_FEE_CONTROLLER_TYPE = "mss_distributor";
const LP_FEE_CONTROL_MODE = "distributor_only";
const LP_FEE_DISTRIBUTION_MODEL = "builder_via_mss_distributor";
const LP_FEE_SOURCE = "raydium_lp";
const LP_FEE_PRE_GRADUATION_SOURCE = "pending_raydium_lp";

function toNumber(value, fallback = 0) {
if (value === null || value === undefined || value === "") return fallback;
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
if (value === null || value === undefined || value === "") continue;
const num = Number(value);
if (Number.isFinite(num)) return num;
}

return null;
}

function normalizeInterval(raw) {
const interval = String(raw || "1m").trim().toLowerCase();
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
status === "bootstrap" ||
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

function getContractCandidateFromLaunch(launch = null, lifecycle = null) {
if (!launch && !lifecycle) return "";

return choosePreferredString(
launch?.contract_address,
launch?.mint_address,
launch?.token_mint,
launch?.mint,
lifecycle?.contract_address,
lifecycle?.contractAddress
);
}

function hasLiveMintSignal(launch = null, lifecycle = null) {
if (!launch && !lifecycle) return false;

const contractAddress = getContractCandidateFromLaunch(launch, lifecycle);
const reservationStatus = cleanText(
launch?.mint_reservation_status,
64
).toLowerCase();
const mintFinalizedAtMs = parseDbTime(launch?.mint_finalized_at);

return Boolean(
contractAddress ||
reservationStatus === "finalized" ||
Number.isFinite(mintFinalizedAtMs)
);
}

function lifecycleGraduated(raw = {}) {
return raw?.graduated === true || toNumber(raw?.graduated, 0) === 1;
}

function isFalseLike(value) {
if (value === false || value === 0) return true;
const raw = String(value ?? "").trim().toLowerCase();
return raw === "0" || raw === "false" || raw === "no";
}

function isTrueLike(value) {
if (value === true || value === 1) return true;
const raw = String(value ?? "").trim().toLowerCase();
return raw === "1" || raw === "true" || raw === "yes";
}

function booleanLike(value, fallback = false) {
if (isTrueLike(value)) return true;
if (isFalseLike(value)) return false;
return fallback;
}

function isMarketBootstrappedFalse(launch = null, lifecycle = null) {
return isFalseLike(
launch?.market_bootstrapped ??
lifecycle?.market_bootstrapped ??
lifecycle?.marketBootstrapped
);
}

function computeCanonicalLaunchStatus(launch = null, lifecycle = null) {
if (!launch && !lifecycle) return "commit";

const rawStatus = normalizeLaunchStatus(launch?.status);
const lifecycleLaunchStatus = normalizeLaunchStatus(
lifecycle?.launch_status ?? lifecycle?.launchStatus ?? lifecycle?.status
);
const lifecycleGraduationStatus = normalizeLaunchStatus(
lifecycle?.graduation_status ??
lifecycle?.graduationStatus ??
lifecycle?.surge_status ??
lifecycle?.surgeStatus
);

const countdownStartedMs = parseDbTime(launch?.countdown_started_at);
const countdownEndsMs = parseDbTime(
launch?.countdown_ends_at || launch?.live_at
);
const liveAtMs = parseDbTime(launch?.live_at || launch?.countdown_ends_at);
const now = Date.now();

const hasCountdownWindow =
Number.isFinite(countdownStartedMs) || Number.isFinite(countdownEndsMs);

const countdownStillRunning =
Number.isFinite(countdownEndsMs) && now < countdownEndsMs;

const liveMintSignal = hasLiveMintSignal(launch, lifecycle);

if (
rawStatus === "failed_refunded" ||
lifecycleLaunchStatus === "failed_refunded"
) {
return "failed_refunded";
}

if (rawStatus === "failed" || lifecycleLaunchStatus === "failed") {
return "failed";
}

if (
rawStatus === "graduated" ||
lifecycleLaunchStatus === "graduated" ||
lifecycleGraduationStatus === "graduated" ||
lifecycleGraduated(lifecycle)
) {
return "graduated";
}

if (rawStatus === "live" || lifecycleLaunchStatus === "live") {
return isMarketBootstrappedFalse(launch, lifecycle) ? "building" : "live";
}

if (rawStatus === "building" || lifecycleLaunchStatus === "building") {
return "building";
}

if (rawStatus === "countdown" || lifecycleLaunchStatus === "countdown") {
if (!Number.isFinite(countdownEndsMs) || countdownStillRunning) {
return "countdown";
}

return "building";
}

if (rawStatus === "commit" || lifecycleLaunchStatus === "commit") {
if (hasCountdownWindow) {
if (!Number.isFinite(countdownEndsMs) || countdownStillRunning) {
return "countdown";
}

return "building";
}

return "commit";
}

if (!rawStatus && !lifecycleLaunchStatus && hasCountdownWindow) {
if (!Number.isFinite(countdownEndsMs) || countdownStillRunning) {
return "countdown";
}

return "building";
}

if (
!rawStatus &&
!lifecycleLaunchStatus &&
Number.isFinite(liveAtMs) &&
now >= liveAtMs &&
liveMintSignal
) {
return isMarketBootstrappedFalse(launch, lifecycle) ? "building" : "live";
}

if (!rawStatus && !lifecycleLaunchStatus && liveMintSignal) {
return isMarketBootstrappedFalse(launch, lifecycle) ? "building" : "live";
}

return rawStatus || lifecycleLaunchStatus || "commit";
}

function shouldRevealContractAddress(status) {
const normalized = normalizeLaunchStatus(status);
return normalized === "live" || normalized === "graduated";
}

function buildPhaseMeta(launch = null, lifecycle = null) {
const status = computeCanonicalLaunchStatus(launch, lifecycle);
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

function getLaunchTotalSupply(launch = null) {
return toInt(
chooseFirstFinite(
launch?.final_supply,
launch?.total_supply,
launch?.supply,
launch?.circulating_supply
),
0
);
}

function resolveBuilderVestingStartAt(raw = {}, launch = null) {
return (
raw.vesting_start_at ||
raw.vestingStartAt ||
raw.builder_vesting_start_at ||
raw.builderVestingStartAt ||
launch?.live_at ||
null
);
}

function computeBuilderVestingFromRule(
raw = {},
launch = null,
{ allowSupplyFallback = true } = {}
) {
const totalSupply = getLaunchTotalSupply(launch);

const rawTotalAllocation = toInt(
chooseFirstFinite(
raw.total_allocation,
raw.totalAllocation,
raw.builder_total_allocation_tokens,
raw.builderTotalAllocationTokens,
raw.builder_visible_total_tokens,
raw.builderVisibleTotalTokens
),
0
);

const fallbackTotalAllocation =
allowSupplyFallback && totalSupply > 0
? Math.floor((totalSupply * BUILDER_TOTAL_ALLOCATION_PCT) / 100)
: 0;

const totalAllocation = Math.max(rawTotalAllocation, fallbackTotalAllocation);

const supplyDailyUnlock =
totalSupply > 0
? Math.floor((totalSupply * BUILDER_DAILY_UNLOCK_PCT) / 100)
: 0;

const allocationDailyUnlock =
totalAllocation > 0 ? Math.floor(totalAllocation / BUILDER_UNLOCK_DAYS) : 0;

const rawDailyUnlock = toInt(
chooseFirstFinite(
raw.daily_unlock,
raw.dailyUnlock,
raw.builder_daily_unlock_tokens,
raw.builderDailyUnlockTokens
),
0
);

const dailyUnlock = Math.max(
supplyDailyUnlock,
allocationDailyUnlock,
rawDailyUnlock && totalAllocation <= 0 ? rawDailyUnlock : 0
);

const vestingStartAt = resolveBuilderVestingStartAt(raw, launch);
const startMs = parseDbTime(vestingStartAt);

const rawUnlocked = toInt(
chooseFirstFinite(
raw.unlocked_amount,
raw.unlockedAmount,
raw.builder_unlocked_tokens,
raw.builderUnlockedTokens,
raw.builder_unlocked_allocation_tokens,
raw.builderUnlockedAllocationTokens
),
0
);

const rawLocked = toInt(
chooseFirstFinite(
raw.locked_amount,
raw.lockedAmount,
raw.builder_locked_tokens,
raw.builderLockedTokens,
raw.builder_locked_allocation_tokens,
raw.builderLockedAllocationTokens
),
Math.max(0, totalAllocation - rawUnlocked)
);

let unlockedAmount = rawUnlocked;
let lockedAmount = rawLocked;
let elapsedDays = toInt(
chooseFirstFinite(
raw.vesting_days_live,
raw.vestingDaysLive,
raw.builder_vesting_days_live,
raw.builderVestingDaysLive
),
0
);
let vestedDays = toInt(
chooseFirstFinite(
raw.vested_days,
raw.vestedDays,
raw.builder_vested_days,
raw.builderVestedDays
),
0
);

if (totalAllocation > 0 && dailyUnlock > 0 && Number.isFinite(startMs)) {
const elapsedMs = Math.max(0, Date.now() - startMs);
elapsedDays = Math.floor(elapsedMs / MS_PER_DAY);

if (Date.now() >= startMs) {
vestedDays = Math.min(BUILDER_UNLOCK_DAYS, elapsedDays);
unlockedAmount =
vestedDays >= BUILDER_UNLOCK_DAYS
? totalAllocation
: Math.min(totalAllocation, dailyUnlock * vestedDays);
lockedAmount = Math.max(0, totalAllocation - unlockedAmount);
} else {
vestedDays = 0;
unlockedAmount = 0;
lockedAmount = totalAllocation;
}
} else if (totalAllocation > 0) {
unlockedAmount = Math.min(totalAllocation, rawUnlocked);
lockedAmount = Math.max(0, totalAllocation - unlockedAmount);
}

const percentUnlocked =
totalAllocation > 0
? Math.max(0, Math.min(100, (unlockedAmount / totalAllocation) * 100))
: 0;

return {
total_allocation: totalAllocation,
totalAllocation,

daily_unlock: dailyUnlock,
dailyUnlock,

unlocked_amount: unlockedAmount,
unlockedAmount,

locked_amount: lockedAmount,
lockedAmount,

vesting_start_at: vestingStartAt,
vestingStartAt,

vested_days: vestedDays,
vestedDays,

vesting_days_live: elapsedDays,
vestingDaysLive: elapsedDays,

cliff_days: BUILDER_CLIFF_DAYS,
cliffDays: BUILDER_CLIFF_DAYS,

vesting_days: BUILDER_VESTING_DAYS,
vestingDays: BUILDER_VESTING_DAYS,

unlock_days: BUILDER_UNLOCK_DAYS,
unlockDays: BUILDER_UNLOCK_DAYS,

daily_unlock_pct: BUILDER_DAILY_UNLOCK_PCT,
dailyUnlockPct: BUILDER_DAILY_UNLOCK_PCT,

total_allocation_pct: BUILDER_TOTAL_ALLOCATION_PCT,
totalAllocationPct: BUILDER_TOTAL_ALLOCATION_PCT,

percent_unlocked: percentUnlocked,
percentUnlocked,

rule: BUILDER_VESTING_RULE,
builder_vesting_rule: BUILDER_VESTING_RULE,
};
}

function sanitizeSourceForResponse(source = {}, launch = null, lifecycle = null) {
const phase = buildPhaseMeta(launch, lifecycle);

if (!phase.market_enabled) {
return {
external_market_venue: EXTERNAL_MARKET_VENUE,
external_market_mode: EXTERNAL_MARKET_MODE,
chart_source: MARKET_SOURCE_PRELIVE,
trade_source: MARKET_SOURCE_PRELIVE,
price_source: MARKET_SOURCE_PRELIVE,
liquidity_source: MARKET_SOURCE_PRELIVE,
volume_source: MARKET_SOURCE_PRELIVE,
external_sync_status: "prelive_hidden",
market_sync_warning:
"Market data is intentionally hidden until the launch is live.",
last_trade_at: null,
last_candle_at: null,
chart_is_synthetic: false,
};
}

return {
external_market_venue:
cleanText(source.external_market_venue, 80) || EXTERNAL_MARKET_VENUE,
external_market_mode:
cleanText(source.external_market_mode, 120) || EXTERNAL_MARKET_MODE,
chart_source: cleanText(source.chart_source, 120) || MARKET_SOURCE_UNAVAILABLE,
trade_source: cleanText(source.trade_source, 120) || MARKET_SOURCE_UNAVAILABLE,
price_source: cleanText(source.price_source, 120) || MARKET_SOURCE_UNAVAILABLE,
liquidity_source:
cleanText(source.liquidity_source, 120) || MARKET_SOURCE_UNAVAILABLE,
volume_source: cleanText(source.volume_source, 120) || MARKET_SOURCE_UNAVAILABLE,
external_sync_status:
cleanText(source.external_sync_status, 120) || "unavailable",
market_sync_warning: cleanText(source.market_sync_warning, 500) || "",
last_trade_at: source.last_trade_at || null,
last_candle_at: source.last_candle_at || null,
chart_is_synthetic: Boolean(source.chart_is_synthetic),
};
}

function sanitizeLaunchForResponse(
launch = null,
stats = {},
lifecycle = null,
source = null
) {
if (!launch) return null;

const phase = buildPhaseMeta(launch, lifecycle);
const revealContract = phase.market_enabled;
const sourceMeta = sanitizeSourceForResponse(source || stats || {}, launch, lifecycle);

const revealedMintAddress = revealContract
? choosePreferredString(
launch.mint_address,
launch.contract_address,
launch.token_mint,
launch.mint,
lifecycle?.contract_address,
lifecycle?.contractAddress
) || null
: null;

const priceSol = revealContract
? toNumber(
chooseFirstFinite(stats.price_sol, stats.priceSol, stats.price, launch.price),
0
)
: 0;

const liquiditySol = revealContract
? toNumber(
chooseFirstFinite(
stats.liquidity_sol,
stats.liquiditySol,
stats.liquidity,
launch.liquidity_sol,
launch.liquidity,
lifecycle?.internal_sol_reserve
),
0
)
: 0;

const marketCapSol = revealContract
? toNumber(
chooseFirstFinite(
stats.market_cap_sol,
stats.marketCapSol,
stats.market_cap,
stats.marketCap,
launch.market_cap,
lifecycle?.implied_marketcap_sol
),
0
)
: 0;

const volume24hSol = revealContract
? toNumber(
chooseFirstFinite(
stats.volume_24h_sol,
stats.volume24hSol,
stats.volume_24h,
stats.volume24h,
launch.volume_24h
),
0
)
: 0;

return {
...launch,

status: phase.status || launch.status || null,
raw_status: cleanText(launch.status, 80) || null,
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
? cleanText(launch.mint_reservation_status, 64).toLowerCase() || null
: null,
mint_finalized_at: revealContract ? launch.mint_finalized_at || null : null,
market_bootstrapped:
launch.market_bootstrapped ??
lifecycle?.market_bootstrapped ??
lifecycle?.marketBootstrapped ??
null,

price: priceSol,
price_sol: priceSol,
price_usd: revealContract
? toNumber(
chooseFirstFinite(stats.price_usd, stats.priceUsd, launch.price_usd),
0
)
: 0,

liquidity: liquiditySol,
liquidity_sol: liquiditySol,
liquidity_usd: revealContract
? toNumber(
chooseFirstFinite(
stats.liquidity_usd,
stats.liquidityUsd,
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
stats.liquidityUsd,
launch.current_liquidity_usd,
launch.liquidity_usd
),
0
)
: 0,

market_cap: marketCapSol,
market_cap_sol: marketCapSol,
market_cap_usd: revealContract
? toNumber(
chooseFirstFinite(
stats.market_cap_usd,
stats.marketCapUsd,
launch.market_cap_usd
),
0
)
: 0,

volume_24h: volume24hSol,
volume_24h_sol: volume24hSol,
volume_24h_usd: revealContract
? toNumber(
chooseFirstFinite(
stats.volume_24h_usd,
stats.volume24hUsd,
launch.volume_24h_usd
),
0
)
: 0,

sol_usd_price: revealContract
? toNumber(
chooseFirstFinite(
stats.sol_usd_price,
stats.solUsdPrice,
launch.sol_usd_price
),
0
)
: 0,

external_market_venue: sourceMeta.external_market_venue,
external_market_mode: sourceMeta.external_market_mode,

chart_source: sourceMeta.chart_source,
trade_source: sourceMeta.trade_source,
price_source: sourceMeta.price_source,
liquidity_source: sourceMeta.liquidity_source,
volume_source: sourceMeta.volume_source,
external_sync_status: sourceMeta.external_sync_status,
market_sync_warning: sourceMeta.market_sync_warning,
last_trade_at: sourceMeta.last_trade_at,
last_candle_at: sourceMeta.last_candle_at,
chart_is_synthetic: sourceMeta.chart_is_synthetic,

lp_fee_beneficiary_wallet: revealContract
? cleanText(
launch.lp_fee_beneficiary_wallet ?? lifecycle?.lp_fee_beneficiary_wallet,
120
) || null
: null,
lp_fee_beneficiary_type: revealContract
? cleanText(
launch.lp_fee_beneficiary_type ?? lifecycle?.lp_fee_beneficiary_type,
120
) || LP_FEE_BENEFICIARY_TYPE
: null,
lp_fee_controller_type: revealContract
? cleanText(
launch.lp_fee_controller_type ?? lifecycle?.lp_fee_controller_type,
120
) || LP_FEE_CONTROLLER_TYPE
: null,
lp_fee_control_mode: revealContract
? cleanText(
launch.lp_fee_control_mode ?? lifecycle?.lp_fee_control_mode,
120
) || LP_FEE_CONTROL_MODE
: null,
lp_fee_distribution_model: revealContract
? cleanText(
launch.lp_fee_distribution_model ?? lifecycle?.lp_fee_distribution_model,
120
) || LP_FEE_DISTRIBUTION_MODEL
: null,
lp_fee_source: revealContract
? cleanText(
launch.lp_fee_source ?? lifecycle?.lp_fee_source,
120
) || resolveLpFeeSource(phase.status)
: null,
lp_fee_distributor_enabled: revealContract
? booleanLike(
launch.lp_fee_distributor_enabled ?? lifecycle?.lp_fee_distributor_enabled,
false
)
: false,
lp_fee_distributor_status: revealContract
? cleanText(
launch.lp_fee_distributor_status ?? lifecycle?.lp_fee_distributor_status,
120
) || null
: null,
lp_fee_distributor_address: revealContract
? cleanText(
launch.lp_fee_distributor_address ?? lifecycle?.lp_fee_distributor_address,
200
) || null
: null,
lp_fee_distributor_program: revealContract
? cleanText(
launch.lp_fee_distributor_program ?? lifecycle?.lp_fee_distributor_program,
200
) || null
: null,
lp_fee_distributor_program_id: revealContract
? cleanText(
launch.lp_fee_distributor_program_id ??
lifecycle?.lp_fee_distributor_program_id,
200
) || null
: null,
lp_fee_distributor_vault: revealContract
? cleanText(
launch.lp_fee_distributor_vault ?? lifecycle?.lp_fee_distributor_vault,
200
) || null
: null,
lp_fee_distributor_tx: revealContract
? cleanText(
launch.lp_fee_distributor_tx ?? lifecycle?.lp_fee_distributor_tx,
300
) || null
: null,
lp_fee_last_distributed_at: revealContract
? launch.lp_fee_last_distributed_at ??
lifecycle?.lp_fee_last_distributed_at ??
null
: null,
builder_can_remove_lp: revealContract
? booleanLike(
launch.builder_can_remove_lp ?? lifecycle?.builder_can_remove_lp,
false
)
: false,
builder_can_claim_lp_fees: revealContract
? booleanLike(
launch.builder_can_claim_lp_fees ?? lifecycle?.builder_can_claim_lp_fees,
false
)
: false,
};
}

function sanitizeTokenForResponse(token = null, launch = null, lifecycle = null) {
if (!token) return null;

const phase = buildPhaseMeta(launch, lifecycle);
const revealContract = phase.market_enabled;

const revealedMintAddress = revealContract
? cleanText(
token.mint_address ||
token.mint ||
token.token_mint ||
token.contract_address ||
launch?.mint_address ||
launch?.contract_address ||
launch?.token_mint ||
lifecycle?.contract_address,
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

function sanitizePoolForResponse(pool = null, launch = null, lifecycle = null) {
const phase = buildPhaseMeta(launch, lifecycle);
if (!pool || !phase.market_enabled) return null;

return {
...pool,
token_reserve: toNumber(pool.token_reserve, 0),
sol_reserve: toNumber(pool.sol_reserve, 0),
k_value: toNumber(pool.k_value, 0),
initial_token_reserve: toNumber(pool.initial_token_reserve, 0),
};
}

function sanitizeCandlesForResponse(candles = [], launch = null, lifecycle = null) {
const phase = buildPhaseMeta(launch, lifecycle);
if (!phase.market_enabled) return [];

return Array.isArray(candles)
? candles.map((candle) => ({
bucket_start: candle.bucket_start,
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

vwap: toNumber(candle.vwap, 0),
first_trade_at: candle.first_trade_at || null,
last_trade_at: candle.last_trade_at || null,

change: toNumber(candle.change, 0),
change_pct: toNumber(candle.change_pct, 0),
is_bullish: Boolean(candle.is_bullish),
is_synthetic: Boolean(candle.is_synthetic),
}))
: [];
}

function sanitizeTradesForResponse(trades = [], launch = null, lifecycle = null) {
const phase = buildPhaseMeta(launch, lifecycle);
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

function sanitizeStatsForResponse(stats = {}, launch = null, lifecycle = null, source = null) {
const phase = buildPhaseMeta(launch, lifecycle);
const marketActive = phase.market_enabled;
const sourceMeta = sanitizeSourceForResponse(source || stats || {}, launch, lifecycle);

const totalSupply = toNumber(
chooseFirstFinite(
stats.total_supply,
stats.totalSupply,
launch?.total_supply,
launch?.supply
),
0
);

const circulatingSupply = marketActive
? toNumber(
chooseFirstFinite(
stats.circulating_supply,
stats.circulatingSupply,
launch?.circulating_supply,
totalSupply
),
0
)
: 0;

const priceSol = marketActive
? toNumber(
chooseFirstFinite(
stats.price_sol,
stats.priceSol,
stats.price,
launch?.price
),
0
)
: 0;

const liquiditySol = marketActive
? toNumber(
chooseFirstFinite(
stats.liquidity_sol,
stats.liquiditySol,
stats.liquidity,
launch?.liquidity,
lifecycle?.internal_sol_reserve
),
0
)
: 0;

const marketCapSol = marketActive
? toNumber(
chooseFirstFinite(
stats.market_cap_sol,
stats.marketCapSol,
stats.market_cap,
stats.marketCap,
launch?.market_cap,
lifecycle?.implied_marketcap_sol
),
0
)
: 0;

const volume24hSol = marketActive
? toNumber(
chooseFirstFinite(
stats.volume_24h_sol,
stats.volume24hSol,
stats.volume_24h,
stats.volume24h
),
0
)
: 0;

const trades24h = marketActive
? toInt(
stats.trades_24h ??
stats.trades24h ??
stats.tx_count_24h ??
stats.txCount24h,
0
)
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

const walletSolBalance = marketActive
? toNumber(stats.wallet_sol_balance ?? stats.sol_balance, 0)
: 0;

const walletSolDelta = marketActive
? toNumber(
stats.wallet_sol_delta ?? stats.walletSolDelta ?? walletSolBalance,
walletSolBalance
)
: 0;

const walletPositionValueSol = marketActive
? toNumber(
chooseFirstFinite(
stats.wallet_position_value_sol,
priceSol > 0 && walletVisibleTotalBalance > 0
? Number(priceSol) * walletVisibleTotalBalance
: 0
),
0
)
: 0;

const walletPositionValueUsd = marketActive
? toNumber(stats.wallet_position_value_usd, 0)
: 0;

const revealedMintAddress = marketActive
? cleanText(
stats.mint_address ||
stats.contract_address ||
stats.token_mint ||
getContractCandidateFromLaunch(launch, lifecycle),
120
) || null
: null;

const walletIsBuilder = marketActive
? Boolean(stats.wallet_is_builder || stats.is_builder_wallet)
: false;

const rawTeamTotalAllocationTokens = marketActive
? toInt(
chooseFirstFinite(
stats.team_total_allocation_tokens,
stats.team_unlocked_tokens,
stats.team_sellable_tokens,
stats.team_locked_tokens
),
0
)
: 0;

const rawTeamUnlockedTokens = marketActive
? toInt(
chooseFirstFinite(stats.team_unlocked_tokens, stats.team_sellable_tokens),
0
)
: 0;

const rawTeamLockedTokens = marketActive
? toInt(
chooseFirstFinite(
stats.team_locked_tokens,
Math.max(0, rawTeamTotalAllocationTokens - rawTeamUnlockedTokens)
),
Math.max(0, rawTeamTotalAllocationTokens - rawTeamUnlockedTokens)
)
: 0;

const teamSellableTokens = marketActive
? toInt(
chooseFirstFinite(stats.team_sellable_tokens, rawTeamUnlockedTokens),
rawTeamUnlockedTokens
)
: 0;

const teamTotalAllocationTokens = Math.max(
rawTeamTotalAllocationTokens,
rawTeamUnlockedTokens + rawTeamLockedTokens,
teamSellableTokens
);

const walletIsTeam = marketActive
? Boolean(
stats.is_team_wallet ||
teamTotalAllocationTokens > 0 ||
rawTeamLockedTokens > 0
)
: false;

const teamVestingPercentUnlocked = marketActive
? toNumber(
chooseFirstFinite(
stats.team_vesting_percent_unlocked,
teamTotalAllocationTokens > 0
? (rawTeamUnlockedTokens / teamTotalAllocationTokens) * 100
: 0
),
0
)
: 0;

const participantFlag = marketActive
? Boolean(
stats.is_participant_wallet ||
toInt(stats.participant_total_allocation_tokens, 0) > 0 ||
toInt(stats.participant_unlocked_tokens, 0) > 0 ||
toInt(stats.participant_sellable_tokens, 0) > 0
)
: false;

const participantTotalAllocationTokens = participantFlag
? Math.max(
toInt(stats.participant_total_allocation_tokens, 0),
toInt(stats.participant_unlocked_tokens, 0),
toInt(stats.participant_sellable_tokens, 0)
)
: 0;

const participantUnlockedTokens = participantFlag
? Math.max(
toInt(
chooseFirstFinite(
stats.participant_unlocked_tokens,
stats.participant_sellable_tokens,
participantTotalAllocationTokens
),
participantTotalAllocationTokens
),
participantTotalAllocationTokens
)
: 0;

const participantSellableTokens = participantFlag
? Math.max(
toInt(
chooseFirstFinite(
stats.participant_sellable_tokens,
participantUnlockedTokens
),
participantUnlockedTokens
),
participantUnlockedTokens
)
: 0;

const participantLockedTokens = 0;
const participantVestingPercentUnlocked = participantFlag ? 100 : 0;
const participantVestingDaysLive = 0;
const participantVestingDays = 0;
const participantVestingLabel = participantFlag
? PARTICIPANT_UNLOCKED_LABEL
: "";

const hasBuilderStats =
marketActive &&
(walletIsBuilder ||
toInt(stats.builder_total_allocation_tokens, 0) > 0 ||
toInt(stats.builder_visible_total_tokens, 0) > 0 ||
toInt(stats.builder_daily_unlock_tokens, 0) > 0);

const builderStatsVesting = hasBuilderStats
? computeBuilderVestingFromRule(
{
total_allocation: stats.builder_total_allocation_tokens,
daily_unlock: stats.builder_daily_unlock_tokens,
unlocked_amount:
stats.builder_unlocked_allocation_tokens ??
stats.builder_unlocked_tokens,
locked_amount:
stats.builder_locked_allocation_tokens ?? stats.builder_locked_tokens,
vesting_start_at: stats.builder_vesting_start_at,
vested_days: stats.builder_vested_days,
vesting_days_live: stats.builder_vesting_days_live,
},
launch,
{ allowSupplyFallback: walletIsBuilder }
)
: computeBuilderVestingFromRule({}, launch, {
allowSupplyFallback: false,
});

const builderVisibleTotalTokens = marketActive
? Math.max(
toInt(stats.builder_visible_total_tokens, 0),
builderStatsVesting.total_allocation
)
: 0;

const walletVestingActive = marketActive
? Boolean(
(walletIsBuilder && builderStatsVesting.locked_amount > 0) ||
(walletIsTeam && rawTeamLockedTokens > 0)
)
: false;

return {
...stats,

phase,
market_enabled: marketActive,
can_trade: phase.can_trade,

external_market_venue: sourceMeta.external_market_venue,
external_market_mode: sourceMeta.external_market_mode,

chart_source: sourceMeta.chart_source,
trade_source: sourceMeta.trade_source,
price_source: sourceMeta.price_source,
liquidity_source: sourceMeta.liquidity_source,
volume_source: sourceMeta.volume_source,
external_sync_status: sourceMeta.external_sync_status,
market_sync_warning: sourceMeta.market_sync_warning,
last_trade_at: sourceMeta.last_trade_at,
last_candle_at: sourceMeta.last_candle_at,
chart_is_synthetic: sourceMeta.chart_is_synthetic,

lifecycle_launch_status:
marketActive
? cleanText(
stats.lifecycle_launch_status ?? lifecycle?.launch_status,
64
) || phase.status
: null,
lifecycle_graduation_status:
marketActive
? cleanText(
stats.lifecycle_graduation_status ?? lifecycle?.graduation_status,
120
) || null
: null,
lifecycle_lock_status:
marketActive
? cleanText(
stats.lifecycle_lock_status ?? lifecycle?.lock_status,
120
) || null
: null,
lifecycle_market_bootstrapped: marketActive
? booleanLike(
stats.lifecycle_market_bootstrapped ??
lifecycle?.market_bootstrapped ??
launch?.market_bootstrapped,
false
)
: false,

lp_fee_beneficiary_wallet: marketActive
? cleanText(
stats.lp_fee_beneficiary_wallet ??
launch?.lp_fee_beneficiary_wallet ??
lifecycle?.lp_fee_beneficiary_wallet,
120
) || null
: null,
lp_fee_beneficiary_type: marketActive
? cleanText(
stats.lp_fee_beneficiary_type ??
launch?.lp_fee_beneficiary_type ??
lifecycle?.lp_fee_beneficiary_type,
120
) || LP_FEE_BENEFICIARY_TYPE
: null,
lp_fee_controller_type: marketActive
? cleanText(
stats.lp_fee_controller_type ??
launch?.lp_fee_controller_type ??
lifecycle?.lp_fee_controller_type,
120
) || LP_FEE_CONTROLLER_TYPE
: null,
lp_fee_control_mode: marketActive
? cleanText(
stats.lp_fee_control_mode ??
launch?.lp_fee_control_mode ??
lifecycle?.lp_fee_control_mode,
120
) || LP_FEE_CONTROL_MODE
: null,
lp_fee_distribution_model: marketActive
? cleanText(
stats.lp_fee_distribution_model ??
launch?.lp_fee_distribution_model ??
lifecycle?.lp_fee_distribution_model,
120
) || LP_FEE_DISTRIBUTION_MODEL
: null,
lp_fee_source: marketActive
? cleanText(
stats.lp_fee_source ??
launch?.lp_fee_source ??
lifecycle?.lp_fee_source,
120
) || resolveLpFeeSource(phase.status)
: null,
lp_fee_distributor_enabled: marketActive
? booleanLike(
stats.lp_fee_distributor_enabled ??
launch?.lp_fee_distributor_enabled ??
lifecycle?.lp_fee_distributor_enabled,
false
)
: false,
lp_fee_distributor_status: marketActive
? cleanText(
stats.lp_fee_distributor_status ??
launch?.lp_fee_distributor_status ??
lifecycle?.lp_fee_distributor_status,
120
) || null
: null,
lp_fee_distributor_address: marketActive
? cleanText(
stats.lp_fee_distributor_address ??
launch?.lp_fee_distributor_address ??
lifecycle?.lp_fee_distributor_address,
200
) || null
: null,
lp_fee_distributor_program: marketActive
? cleanText(
stats.lp_fee_distributor_program ??
launch?.lp_fee_distributor_program ??
lifecycle?.lp_fee_distributor_program,
200
) || null
: null,
lp_fee_distributor_program_id: marketActive
? cleanText(
stats.lp_fee_distributor_program_id ??
launch?.lp_fee_distributor_program_id ??
lifecycle?.lp_fee_distributor_program_id,
200
) || null
: null,
lp_fee_distributor_vault: marketActive
? cleanText(
stats.lp_fee_distributor_vault ??
launch?.lp_fee_distributor_vault ??
lifecycle?.lp_fee_distributor_vault,
200
) || null
: null,
lp_fee_distributor_tx: marketActive
? cleanText(
stats.lp_fee_distributor_tx ??
launch?.lp_fee_distributor_tx ??
lifecycle?.lp_fee_distributor_tx,
300
) || null
: null,
lp_fee_last_distributed_at: marketActive
? stats.lp_fee_last_distributed_at ??
launch?.lp_fee_last_distributed_at ??
lifecycle?.lp_fee_last_distributed_at ??
null
: null,
builder_can_remove_lp: marketActive
? booleanLike(
stats.builder_can_remove_lp ??
launch?.builder_can_remove_lp ??
lifecycle?.builder_can_remove_lp,
false
)
: false,
builder_can_claim_lp_fees: marketActive
? booleanLike(
stats.builder_can_claim_lp_fees ??
launch?.builder_can_claim_lp_fees ??
lifecycle?.builder_can_claim_lp_fees,
false
)
: false,

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
? cleanText(
stats.mint_reservation_status || launch?.mint_reservation_status,
64
) || null
: null,
mint_finalized_at: marketActive
? stats.mint_finalized_at || launch?.mint_finalized_at || null
: null,

total_supply: totalSupply,
circulating_supply: circulatingSupply,

sol_usd_price: marketActive
? toNumber(stats.sol_usd_price ?? stats.solUsdPrice, 0)
: 0,
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
price_usd: marketActive
? toNumber(stats.price_usd ?? stats.priceUsd, 0)
: 0,

liquidity: liquiditySol,
liquidity_sol: liquiditySol,
liquidity_usd: marketActive
? toNumber(stats.liquidity_usd ?? stats.liquidityUsd, 0)
: 0,

total_lp_liquidity_sol: marketActive
? toNumber(stats.total_lp_liquidity_sol ?? stats.totalLpLiquiditySol, 0)
: 0,
total_lp_liquidity_usd: marketActive
? toNumber(stats.total_lp_liquidity_usd ?? stats.totalLpLiquidityUsd, 0)
: 0,

market_cap: marketCapSol,
market_cap_sol: marketCapSol,
market_cap_usd: marketActive
? toNumber(stats.market_cap_usd ?? stats.marketCapUsd, 0)
: 0,

fdv: marketActive ? toNumber(stats.fdv ?? stats.fdv_sol, 0) : 0,
fdv_sol: marketActive ? toNumber(stats.fdv_sol ?? stats.fdv, 0) : 0,
fdv_usd: marketActive ? toNumber(stats.fdv_usd, 0) : 0,

volume_24h: volume24hSol,
volume_24h_sol: volume24hSol,
volume_24h_usd: marketActive
? toNumber(stats.volume_24h_usd ?? stats.volume24hUsd, 0)
: 0,

buys_24h: marketActive ? toInt(stats.buys_24h ?? stats.buys24h, 0) : 0,
sells_24h: marketActive ? toInt(stats.sells_24h ?? stats.sells24h, 0) : 0,
trades_24h: trades24h,
tx_count_24h: trades24h,
trade_count_24h: trades24h,
trade_count_total: marketActive ? toInt(stats.trade_count_total, 0) : 0,
trades_total: marketActive ? toInt(stats.trades_total, 0) : 0,

price_change_pct: marketActive
? toNumber(stats.price_change_pct ?? stats.priceChangePct, 0)
: 0,
high_24h: marketActive ? toNumber(stats.high_24h ?? stats.high24h, 0) : 0,
low_24h: marketActive ? toNumber(stats.low_24h ?? stats.low24h, 0) : 0,
high_24h_sol: marketActive
? toNumber(
stats.high_24h_sol ??
stats.high24hSol ??
stats.high_24h ??
stats.high24h,
0
)
: 0,
low_24h_sol: marketActive
? toNumber(
stats.low_24h_sol ??
stats.low24hSol ??
stats.low_24h ??
stats.low24h,
0
)
: 0,
high_24h_usd: marketActive ? toNumber(stats.high_24h_usd, 0) : 0,
low_24h_usd: marketActive ? toNumber(stats.low_24h_usd, 0) : 0,

pool_sol_reserve: marketActive ? toNumber(stats.pool_sol_reserve, 0) : 0,
pool_token_reserve: marketActive ? toInt(stats.pool_token_reserve, 0) : 0,

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

wallet_is_builder: walletIsBuilder,
wallet_vesting_active: walletVestingActive,

is_builder_wallet: walletIsBuilder,
is_participant_wallet: participantFlag,
is_team_wallet: walletIsTeam,

participant_total_allocation_tokens: participantTotalAllocationTokens,
participant_unlocked_tokens: participantUnlockedTokens,
participant_locked_tokens: participantLockedTokens,
participant_sellable_tokens: participantSellableTokens,
participant_vesting_percent_unlocked: participantVestingPercentUnlocked,
participant_vesting_days_live: participantVestingDaysLive,
participant_vesting_days: participantVestingDays,
participant_vesting_label: participantVestingLabel,

team_total_allocation_tokens: teamTotalAllocationTokens,
team_unlocked_tokens: rawTeamUnlockedTokens,
team_locked_tokens: rawTeamLockedTokens,
team_sellable_tokens: teamSellableTokens,
team_vesting_percent_unlocked: teamVestingPercentUnlocked,

builder_total_allocation_tokens: marketActive
? builderStatsVesting.total_allocation
: 0,
builder_unlocked_tokens: marketActive ? builderStatsVesting.unlocked_amount : 0,
builder_locked_tokens: marketActive ? builderStatsVesting.locked_amount : 0,
builder_sellable_tokens: marketActive
? Math.max(
toInt(stats.builder_sellable_tokens, 0),
builderStatsVesting.unlocked_amount
)
: 0,
builder_visible_total_tokens: builderVisibleTotalTokens,
builder_unlocked_allocation_tokens: marketActive
? builderStatsVesting.unlocked_amount
: 0,
builder_locked_allocation_tokens: marketActive
? builderStatsVesting.locked_amount
: 0,
builder_vesting_percent_unlocked: marketActive
? builderStatsVesting.percent_unlocked
: 0,
builder_vesting_days_live: marketActive
? builderStatsVesting.vesting_days_live
: 0,
builder_vested_days: marketActive ? builderStatsVesting.vested_days : 0,
builder_daily_unlock_tokens: marketActive ? builderStatsVesting.daily_unlock : 0,
builder_cliff_days: BUILDER_CLIFF_DAYS,
builder_vesting_days: BUILDER_VESTING_DAYS,
builder_unlock_days: BUILDER_UNLOCK_DAYS,
builder_daily_unlock_pct: BUILDER_DAILY_UNLOCK_PCT,
builder_total_allocation_pct: BUILDER_TOTAL_ALLOCATION_PCT,
builder_vesting_start_at: marketActive
? builderStatsVesting.vesting_start_at || null
: null,
builder_vesting_rule: marketActive ? BUILDER_VESTING_RULE : "",
};
}

function extractGraduationReadiness(lifecycle) {
return lifecycle?.graduationReadiness || lifecycle?.graduation_readiness || null;
}

function normalizeLifecycle(raw = {}, launch = null, phaseOverride = null) {
const phase = phaseOverride || buildPhaseMeta(launch, raw);
if (!raw || typeof raw !== "object" || !phase.market_enabled) {
return null;
}

const graduated = lifecycleGraduated(raw);

return {
launch_status:
cleanText(raw.launch_status ?? raw.launchStatus ?? raw.status, 64).toLowerCase() ||
null,
contract_address:
cleanText(raw.contract_address ?? raw.contractAddress, 120) || null,
builder_wallet:
cleanText(raw.builder_wallet ?? raw.builderWallet ?? launch?.builder_wallet, 120) ||
null,
market_bootstrapped:
raw.market_bootstrapped ?? raw.marketBootstrapped ?? null,

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
(graduated ? "graduated" : "internal_live"),
surge_status:
cleanText(raw.surge_status ?? raw.surgeStatus ?? raw.graduation_status, 120) ||
(graduated ? "surged" : "internal_live"),

graduated,
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

lp_fee_beneficiary_wallet:
cleanText(raw.lp_fee_beneficiary_wallet ?? raw.lpFeeBeneficiaryWallet, 120) ||
null,
lp_fee_beneficiary_type:
cleanText(raw.lp_fee_beneficiary_type ?? raw.lpFeeBeneficiaryType, 120) ||
LP_FEE_BENEFICIARY_TYPE,
lp_fee_controller_type:
cleanText(raw.lp_fee_controller_type ?? raw.lpFeeControllerType, 120) ||
LP_FEE_CONTROLLER_TYPE,
lp_fee_control_mode:
cleanText(raw.lp_fee_control_mode ?? raw.lpFeeControlMode, 120) ||
LP_FEE_CONTROL_MODE,
lp_fee_distribution_model:
cleanText(
raw.lp_fee_distribution_model ?? raw.lpFeeDistributionModel,
120
) || LP_FEE_DISTRIBUTION_MODEL,
lp_fee_source:
cleanText(raw.lp_fee_source ?? raw.lpFeeSource, 120) ||
resolveLpFeeSource(phase.status),
lp_fee_distributor_enabled: booleanLike(
raw.lp_fee_distributor_enabled ?? raw.lpFeeDistributorEnabled,
false
),
lp_fee_distributor_status:
cleanText(raw.lp_fee_distributor_status ?? raw.lpFeeDistributorStatus, 120) ||
null,
lp_fee_distributor_address:
cleanText(raw.lp_fee_distributor_address ?? raw.lpFeeDistributorAddress, 200) ||
null,
lp_fee_distributor_program:
cleanText(raw.lp_fee_distributor_program ?? raw.lpFeeDistributorProgram, 200) ||
null,
lp_fee_distributor_program_id:
cleanText(
raw.lp_fee_distributor_program_id ?? raw.lpFeeDistributorProgramId,
200
) || null,
lp_fee_distributor_vault:
cleanText(raw.lp_fee_distributor_vault ?? raw.lpFeeDistributorVault, 200) ||
null,
lp_fee_distributor_tx:
cleanText(raw.lp_fee_distributor_tx ?? raw.lpFeeDistributorTx, 300) || null,
lp_fee_last_distributed_at:
raw.lp_fee_last_distributed_at ?? raw.lpFeeLastDistributedAt ?? null,
builder_can_remove_lp: booleanLike(
raw.builder_can_remove_lp ?? raw.builderCanRemoveLp,
false
),
builder_can_claim_lp_fees: booleanLike(
raw.builder_can_claim_lp_fees ?? raw.builderCanClaimLpFees,
false
),

graduationReadiness:
raw.graduationReadiness ?? raw.graduation_readiness ?? null,
graduation_readiness:
raw.graduation_readiness ?? raw.graduationReadiness ?? null,

builderVesting: raw.builderVesting ?? raw.builder_vesting ?? null,
builder_vesting: raw.builder_vesting ?? raw.builderVesting ?? null,

external_market_venue: EXTERNAL_MARKET_VENUE,
external_market_mode: EXTERNAL_MARKET_MODE,
};
}

function normalizeGraduationReadiness(readiness = {}, launch = null, phaseOverride = null) {
const phase = phaseOverride || buildPhaseMeta(launch);
if (!readiness || typeof readiness !== "object" || !phase.market_enabled) {
return null;
}

return {
ready: Boolean(readiness.ready),
reason: cleanText(readiness.reason, 500) || "",
thresholds:
readiness.thresholds && typeof readiness.thresholds === "object"
? {
marketcapSol: toNumber(
readiness.thresholds.marketcapSol ??
readiness.thresholds.marketcap_sol,
0
),
volume24hSol: toNumber(
readiness.thresholds.volume24hSol ??
readiness.thresholds.volume24h_sol,
0
),
minHolders: toInt(
readiness.thresholds.minHolders ??
readiness.thresholds.min_holders,
0
),
minLiveMinutes: toInt(
readiness.thresholds.minLiveMinutes ??
readiness.thresholds.min_live_minutes,
0
),
lockDays: toInt(
readiness.thresholds.lockDays ?? readiness.thresholds.lock_days,
0
),
}
: null,
metrics:
readiness.metrics && typeof readiness.metrics === "object"
? {
marketcapSol: toNumber(
readiness.metrics.marketcapSol ??
readiness.metrics.marketcap_sol,
0
),
volume24hSol: toNumber(
readiness.metrics.volume24hSol ??
readiness.metrics.volume_24h_sol ??
readiness.metrics.volume24h_sol,
0
),
holderCount: toInt(
readiness.metrics.holderCount ??
readiness.metrics.holder_count,
0
),
liveMinutes: toInt(
readiness.metrics.liveMinutes ??
readiness.metrics.live_minutes,
0
),
solReserve: toNumber(
readiness.metrics.solReserve ??
readiness.metrics.sol_reserve,
0
),
tokenReserve: toInt(
readiness.metrics.tokenReserve ??
readiness.metrics.token_reserve,
0
),
priceSol: toNumber(
readiness.metrics.priceSol ??
readiness.metrics.price_sol,
0
),
totalSupply: toInt(
readiness.metrics.totalSupply ??
readiness.metrics.total_supply,
0
),
}
: null,
checks:
readiness.checks && typeof readiness.checks === "object"
? {
liveStatus: Boolean(
readiness.checks.liveStatus ?? readiness.checks.live_status
),
marketcapReached: Boolean(
readiness.checks.marketcapReached ??
readiness.checks.marketcap_reached
),
volumeReached: Boolean(
readiness.checks.volumeReached ?? readiness.checks.volume_reached
),
holdersReached: Boolean(
readiness.checks.holdersReached ??
readiness.checks.holders_reached
),
minimumLiveWindowReached: Boolean(
readiness.checks.minimumLiveWindowReached ??
readiness.checks.minimum_live_window_reached
),
hasReserves: Boolean(
readiness.checks.hasReserves ?? readiness.checks.has_reserves
),
marketBootstrapped: Boolean(
readiness.checks.marketBootstrapped ??
readiness.checks.market_bootstrapped
),
alreadyGraduated: Boolean(
readiness.checks.alreadyGraduated ??
readiness.checks.already_graduated
),
}
: null,
};
}

function normalizeBuilderVestingSummary(raw = {}, launch = null, phaseOverride = null) {
const phase = phaseOverride || buildPhaseMeta(launch);
if (!raw || typeof raw !== "object" || !phase.market_enabled) {
return null;
}

const fixed = computeBuilderVestingFromRule(raw, launch, {
allowSupplyFallback: true,
});

return {
builder_wallet:
cleanText(raw.builder_wallet ?? raw.builderWallet ?? launch?.builder_wallet, 120) ||
null,
builderWallet:
cleanText(raw.builderWallet ?? raw.builder_wallet ?? launch?.builder_wallet, 120) ||
null,

total_allocation: fixed.total_allocation,
totalAllocation: fixed.totalAllocation,
daily_unlock: fixed.daily_unlock,
dailyUnlock: fixed.dailyUnlock,
unlocked_amount: fixed.unlocked_amount,
unlockedAmount: fixed.unlockedAmount,
locked_amount: fixed.locked_amount,
lockedAmount: fixed.lockedAmount,

vesting_start_at: fixed.vesting_start_at,
vestingStartAt: fixed.vestingStartAt,
created_at: raw.created_at ?? raw.createdAt ?? null,
createdAt: raw.createdAt ?? raw.created_at ?? null,
updated_at: raw.updated_at ?? raw.updatedAt ?? null,
updatedAt: raw.updatedAt ?? raw.updated_at ?? null,

vested_days: fixed.vested_days,
vestedDays: fixed.vestedDays,
vesting_days_live: fixed.vesting_days_live,
vestingDaysLive: fixed.vestingDaysLive,

cliff_days: BUILDER_CLIFF_DAYS,
cliffDays: BUILDER_CLIFF_DAYS,
vesting_days: BUILDER_VESTING_DAYS,
vestingDays: BUILDER_VESTING_DAYS,
unlock_days: BUILDER_UNLOCK_DAYS,
unlockDays: BUILDER_UNLOCK_DAYS,

daily_unlock_pct: BUILDER_DAILY_UNLOCK_PCT,
dailyUnlockPct: BUILDER_DAILY_UNLOCK_PCT,
total_allocation_pct: BUILDER_TOTAL_ALLOCATION_PCT,
totalAllocationPct: BUILDER_TOTAL_ALLOCATION_PCT,

percent_unlocked: fixed.percent_unlocked,
percentUnlocked: fixed.percentUnlocked,

rule: BUILDER_VESTING_RULE,
builder_vesting_rule: BUILDER_VESTING_RULE,
};
}

function pickLaunchRow(row) {
if (!row) return null;

return {
id: row.id,
token_name: row.token_name,
symbol: row.symbol,
status: row.status,
raw_status: cleanText(row.status, 80) || null,
template: row.template,
description: cleanText(row.description, 5000),
image_url: cleanText(row.image_url, 1000),

contract_address: cleanText(row.contract_address, 120) || null,
mint_address: cleanText(row.mint_address, 120) || null,
token_mint: cleanText(row.token_mint, 120) || null,
mint:
cleanText(
row.mint_address || row.contract_address || row.token_mint,
120
) || null,

reserved_mint_address: null,
reserved_mint_public_key: null,
reserved_mint_secret: null,
reserved_mint_private_key: null,
reserved_mint_keypair: null,

mint_reservation_status:
cleanText(row.mint_reservation_status, 64).toLowerCase() || null,
mint_finalized_at: row.mint_finalized_at || null,
market_bootstrapped: row.market_bootstrapped ?? null,

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

builder_pct: toNumber(row.builder_pct, BUILDER_TOTAL_ALLOCATION_PCT),
team_allocation_pct: toNumber(row.team_allocation_pct, 0),

countdown_started_at: row.countdown_started_at || null,
countdown_ends_at: row.countdown_ends_at || null,
live_at: row.live_at || null,
commit_started_at: row.commit_started_at || null,
commit_ends_at: row.commit_ends_at || null,

supply: toInt(row.supply, 0),
final_supply: toInt(row.final_supply || row.supply, 0),
total_supply: toInt(row.final_supply || row.supply, 0),
circulating_supply: toInt(row.circulating_supply, 0),

liquidity: toNumber(row.liquidity, 0),
liquidity_sol: toNumber(row.liquidity, 0),
liquidity_usd: toNumber(row.liquidity_usd, 0),
current_liquidity_usd: toNumber(row.current_liquidity_usd, 0),
price: toNumber(row.price, 0),
price_sol: toNumber(row.price, 0),
price_usd: toNumber(row.price_usd, 0),
market_cap: toNumber(row.market_cap, 0),
market_cap_sol: toNumber(row.market_cap, 0),
market_cap_usd: toNumber(row.market_cap_usd, 0),
volume_24h: toNumber(row.volume_24h, 0),
volume_24h_sol: toNumber(row.volume_24h, 0),
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
team_cliff_days: TEAM_CLIFF_DAYS,
team_vesting_days: TEAM_VESTING_DAYS,

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

function buildWalletPayload(
snapshotWallet = {},
stats = {},
launch = null,
builderVesting = null,
requestWalletIsBuilder = false,
lifecycle = null
) {
const phase = buildPhaseMeta(launch, lifecycle);

if (!phase.market_enabled) {
return buildEmptyWalletPayload(phase);
}

const walletTokenBalance = toInt(
snapshotWallet.token_balance ??
snapshotWallet.tokenBalance ??
snapshotWallet.balance_tokens ??
snapshotWallet.wallet_balance_tokens ??
stats.wallet_token_balance ??
stats.wallet_balance_tokens,
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

const walletPositionValueSol = toNumber(
chooseFirstFinite(
snapshotWallet.position_value_sol,
snapshotWallet.positionValueSol,
stats.wallet_position_value_sol,
stats.price_sol && walletVisibleTotalBalance > 0
? Number(stats.price_sol) * walletVisibleTotalBalance
: 0
),
0
);

const walletPositionValueUsd = toNumber(
chooseFirstFinite(
snapshotWallet.position_value_usd,
snapshotWallet.positionValueUsd,
stats.wallet_position_value_usd
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
snapshotWallet.walletSolDelta ??
stats.wallet_sol_delta ??
stats.walletSolDelta ??
walletSolBalance,
walletSolBalance
);

const walletIsBuilder = Boolean(
snapshotWallet.wallet_is_builder ||
snapshotWallet.is_builder_wallet ||
stats.wallet_is_builder ||
stats.is_builder_wallet ||
requestWalletIsBuilder
);

const rawTeamTotalAllocationTokens = toInt(
chooseFirstFinite(
snapshotWallet.team_total_allocation_tokens,
stats.team_total_allocation_tokens,
snapshotWallet.team_unlocked_tokens,
stats.team_unlocked_tokens,
snapshotWallet.team_sellable_tokens,
stats.team_sellable_tokens,
snapshotWallet.team_locked_tokens,
stats.team_locked_tokens
),
0
);

const rawTeamUnlockedTokens = toInt(
chooseFirstFinite(
snapshotWallet.team_unlocked_tokens,
stats.team_unlocked_tokens,
snapshotWallet.team_sellable_tokens,
stats.team_sellable_tokens
),
0
);

const rawTeamLockedTokens = toInt(
chooseFirstFinite(
snapshotWallet.team_locked_tokens,
stats.team_locked_tokens,
Math.max(0, rawTeamTotalAllocationTokens - rawTeamUnlockedTokens)
),
Math.max(0, rawTeamTotalAllocationTokens - rawTeamUnlockedTokens)
);

const teamSellableTokens = toInt(
chooseFirstFinite(
snapshotWallet.team_sellable_tokens,
stats.team_sellable_tokens,
rawTeamUnlockedTokens
),
rawTeamUnlockedTokens
);

const teamTotalAllocationTokens = Math.max(
rawTeamTotalAllocationTokens,
rawTeamUnlockedTokens + rawTeamLockedTokens,
teamSellableTokens
);

const walletIsTeam = Boolean(
snapshotWallet.is_team_wallet ||
stats.is_team_wallet ||
teamTotalAllocationTokens > 0 ||
rawTeamLockedTokens > 0
);

const teamVestingPercentUnlocked = toNumber(
chooseFirstFinite(
snapshotWallet.team_vesting_percent_unlocked,
stats.team_vesting_percent_unlocked,
teamTotalAllocationTokens > 0
? (rawTeamUnlockedTokens / teamTotalAllocationTokens) * 100
: 0
),
0
);

const participantFlag = Boolean(
snapshotWallet.is_participant_wallet ||
stats.is_participant_wallet ||
toInt(snapshotWallet.participant_total_allocation_tokens, 0) > 0 ||
toInt(stats.participant_total_allocation_tokens, 0) > 0 ||
toInt(snapshotWallet.participant_unlocked_tokens, 0) > 0 ||
toInt(stats.participant_unlocked_tokens, 0) > 0 ||
toInt(snapshotWallet.participant_sellable_tokens, 0) > 0 ||
toInt(stats.participant_sellable_tokens, 0) > 0
);

const participantTotalAllocationTokens = participantFlag
? Math.max(
toInt(snapshotWallet.participant_total_allocation_tokens, 0),
toInt(stats.participant_total_allocation_tokens, 0),
toInt(snapshotWallet.participant_unlocked_tokens, 0),
toInt(stats.participant_unlocked_tokens, 0),
toInt(snapshotWallet.participant_sellable_tokens, 0),
toInt(stats.participant_sellable_tokens, 0)
)
: 0;

const participantUnlockedTokens = participantFlag
? Math.max(
toInt(
chooseFirstFinite(
snapshotWallet.participant_unlocked_tokens,
stats.participant_unlocked_tokens,
snapshotWallet.participant_sellable_tokens,
stats.participant_sellable_tokens,
participantTotalAllocationTokens
),
participantTotalAllocationTokens
),
participantTotalAllocationTokens
)
: 0;

const participantSellableTokens = participantFlag
? Math.max(
toInt(
chooseFirstFinite(
snapshotWallet.participant_sellable_tokens,
stats.participant_sellable_tokens,
participantUnlockedTokens
),
participantUnlockedTokens
),
participantUnlockedTokens
)
: 0;

const participantLockedTokens = 0;
const participantVestingPercentUnlocked = participantFlag ? 100 : 0;
const participantVestingDaysLive = 0;
const participantVestingDays = 0;
const participantVestingLabel = participantFlag
? PARTICIPANT_UNLOCKED_LABEL
: "";

const fixedBuilderVesting =
builderVesting ||
(walletIsBuilder
? computeBuilderVestingFromRule(
{
total_allocation:
snapshotWallet.builder_total_allocation_tokens ??
stats.builder_total_allocation_tokens,
daily_unlock:
snapshotWallet.builder_daily_unlock_tokens ??
stats.builder_daily_unlock_tokens,
unlocked_amount:
snapshotWallet.builder_unlocked_allocation_tokens ??
stats.builder_unlocked_allocation_tokens ??
snapshotWallet.builder_unlocked_tokens ??
stats.builder_unlocked_tokens,
locked_amount:
snapshotWallet.builder_locked_allocation_tokens ??
stats.builder_locked_allocation_tokens ??
snapshotWallet.builder_locked_tokens ??
stats.builder_locked_tokens,
vesting_start_at:
snapshotWallet.builder_vesting_start_at ??
stats.builder_vesting_start_at,
vested_days:
snapshotWallet.builder_vested_days ?? stats.builder_vested_days,
vesting_days_live:
snapshotWallet.builder_vesting_days_live ??
stats.builder_vesting_days_live,
},
launch,
{ allowSupplyFallback: true }
)
: computeBuilderVestingFromRule({}, launch, {
allowSupplyFallback: false,
}));

const builderVisibleTotalTokens = Math.max(
toInt(snapshotWallet.builder_visible_total_tokens, 0),
toInt(stats.builder_visible_total_tokens, 0),
toInt(fixedBuilderVesting?.total_allocation, 0)
);

const builderTotalAllocationTokens = toInt(
fixedBuilderVesting?.total_allocation ??
fixedBuilderVesting?.totalAllocation ??
snapshotWallet.builder_total_allocation_tokens ??
stats.builder_total_allocation_tokens,
0
);

const builderUnlockedAllocationTokens = toInt(
fixedBuilderVesting?.unlocked_amount ??
fixedBuilderVesting?.unlockedAmount ??
snapshotWallet.builder_unlocked_allocation_tokens ??
stats.builder_unlocked_allocation_tokens,
0
);

const builderLockedAllocationTokens = toInt(
fixedBuilderVesting?.locked_amount ??
fixedBuilderVesting?.lockedAmount ??
snapshotWallet.builder_locked_allocation_tokens ??
stats.builder_locked_allocation_tokens,
0
);

const builderSellableTokens = Math.max(
toInt(snapshotWallet.builder_sellable_tokens, 0),
toInt(stats.builder_sellable_tokens, 0),
builderUnlockedAllocationTokens
);

const walletVestingActive = Boolean(
(walletIsBuilder && builderLockedAllocationTokens > 0) ||
(walletIsTeam && rawTeamLockedTokens > 0)
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

position_value_sol: walletPositionValueSol,
positionValueSol: walletPositionValueSol,
position_value_usd: walletPositionValueUsd,
positionValueUsd: walletPositionValueUsd,

sol_balance: walletSolBalance,
solBalance: walletSolBalance,
sol_delta: walletSolDelta,
solDelta: walletSolDelta,
walletSolDelta: walletSolDelta,

wallet_is_builder: walletIsBuilder,
is_builder_wallet: walletIsBuilder,
is_participant_wallet: participantFlag,
is_team_wallet: walletIsTeam,
vesting_active: walletVestingActive,
wallet_vesting_active: walletVestingActive,

participant_total_allocation_tokens: participantTotalAllocationTokens,
participant_unlocked_tokens: participantUnlockedTokens,
participant_locked_tokens: participantLockedTokens,
participant_sellable_tokens: participantSellableTokens,
participant_vesting_percent_unlocked: participantVestingPercentUnlocked,
participant_vesting_days_live: participantVestingDaysLive,
participant_vesting_days: participantVestingDays,
participant_vesting_label: participantVestingLabel,

team_total_allocation_tokens: teamTotalAllocationTokens,
team_unlocked_tokens: rawTeamUnlockedTokens,
team_locked_tokens: rawTeamLockedTokens,
team_sellable_tokens: teamSellableTokens,
team_vesting_percent_unlocked: teamVestingPercentUnlocked,
team_cliff_days: TEAM_CLIFF_DAYS,
team_vesting_days: TEAM_VESTING_DAYS,

builder_total_allocation_tokens: builderTotalAllocationTokens,
builder_unlocked_tokens: builderUnlockedAllocationTokens,
builder_locked_tokens: builderLockedAllocationTokens,
builder_sellable_tokens: builderSellableTokens,
builder_visible_total_tokens: builderVisibleTotalTokens,
builder_unlocked_allocation_tokens: builderUnlockedAllocationTokens,
builder_locked_allocation_tokens: builderLockedAllocationTokens,
builder_vesting_percent_unlocked: toNumber(
fixedBuilderVesting?.percent_unlocked ??
fixedBuilderVesting?.percentUnlocked ??
snapshotWallet.builder_vesting_percent_unlocked ??
stats.builder_vesting_percent_unlocked,
0
),
builder_vesting_days_live: toInt(
fixedBuilderVesting?.vesting_days_live ??
fixedBuilderVesting?.vestingDaysLive ??
snapshotWallet.builder_vesting_days_live ??
stats.builder_vesting_days_live,
0
),
builder_vested_days: toInt(
fixedBuilderVesting?.vested_days ??
fixedBuilderVesting?.vestedDays ??
snapshotWallet.builder_vested_days ??
stats.builder_vested_days,
0
),
builder_daily_unlock_tokens: toInt(
fixedBuilderVesting?.daily_unlock ??
fixedBuilderVesting?.dailyUnlock ??
snapshotWallet.builder_daily_unlock_tokens ??
stats.builder_daily_unlock_tokens,
0
),
builder_cliff_days: BUILDER_CLIFF_DAYS,
builder_vesting_days: BUILDER_VESTING_DAYS,
builder_unlock_days: BUILDER_UNLOCK_DAYS,
builder_daily_unlock_pct: BUILDER_DAILY_UNLOCK_PCT,
builder_total_allocation_pct: BUILDER_TOTAL_ALLOCATION_PCT,
builder_vesting_start_at:
fixedBuilderVesting?.vesting_start_at ??
fixedBuilderVesting?.vestingStartAt ??
snapshotWallet.builder_vesting_start_at ??
stats.builder_vesting_start_at ??
null,
builder_vesting_rule: BUILDER_VESTING_RULE,

phase,
market_enabled: true,
can_trade: phase.can_trade,
};
}

function buildCassiePayload(cassie = null, launch = null, lifecycle = null, source = null) {
const phase = buildPhaseMeta(launch, lifecycle);
const sourceMeta = sanitizeSourceForResponse(source || {}, launch, lifecycle);

return {
...(cassie || {}),
phase: phase.status,
market_enabled: phase.market_enabled,
can_trade: phase.can_trade,
external_market_venue: sourceMeta.external_market_venue,
external_market_mode: sourceMeta.external_market_mode,
chart_source: sourceMeta.chart_source,
trade_source: sourceMeta.trade_source,
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
l.status,
l.contract_address,
l.mint_address,
l.token_mint,
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
supply: 0,
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
l.market_bootstrapped,
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
b.wallet AS builder_wallet,
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

const [snapshot, lifecycleRaw, graduationPlanRaw] = await Promise.all([
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

const preliminaryPhase = buildPhaseMeta(rawLaunch, lifecycleRaw);
const lifecycle = normalizeLifecycle(
rawLaunch?.lifecycle || lifecycleRaw || null,
rawLaunch,
preliminaryPhase
);
const phase = buildPhaseMeta(rawLaunch, lifecycle);

if (!phase.market_enabled) {
return res.status(404).json({
ok: false,
error: "Token market is not active",
status: phase.status,
phase,
market_enabled: false,
can_trade: false,
});
}

const source = sanitizeSourceForResponse(
snapshot?.source || snapshot?.stats || {},
rawLaunch,
lifecycle
);

const snapshotStats = sanitizeStatsForResponse(
snapshot?.stats || {},
rawLaunch,
lifecycle,
source
);

const snapshotLaunch = sanitizeLaunchForResponse(
rawLaunch,
snapshotStats,
lifecycle,
source
);

const lifecycleSource =
rawLaunch?.lifecycle ||
lifecycleRaw ||
snapshotLaunch?.lifecycle ||
null;

const graduationReadiness = normalizeGraduationReadiness(
extractGraduationReadiness(lifecycleSource),
rawLaunch,
phase
);

const builderVestingSource =
lifecycleSource?.builderVesting ||
lifecycleSource?.builder_vesting ||
rawLaunch?.builder_vesting ||
snapshotLaunch?.builder_vesting ||
{};

const builderVesting = normalizeBuilderVestingSummary(
builderVestingSource,
rawLaunch,
phase
);

const graduationPlan =
phase.market_enabled &&
graduationPlanRaw &&
typeof graduationPlanRaw === "object"
? graduationPlanRaw
: null;

const resolvedMintAddress =
cleanText(
tokenRow.mint_address ||
snapshot?.token?.mint_address ||
snapshot?.token?.mint ||
snapshotLaunch?.mint_address,
120
) || null;

const requestWalletNormalized = cleanText(wallet, 120).toLowerCase();
const builderWalletNormalized = cleanText(
rawLaunch?.builder_wallet || lifecycle?.builder_wallet,
120
).toLowerCase();

const requestWalletIsBuilder = Boolean(
requestWalletNormalized &&
builderWalletNormalized &&
requestWalletNormalized === builderWalletNormalized
);

const walletPayload = buildWalletPayload(
snapshot?.wallet || {},
snapshotStats,
rawLaunch,
builderVesting,
requestWalletIsBuilder,
lifecycle
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
token_mint: resolvedMintAddress,
contract_address: resolvedMintAddress,
created_at: tokenRow.created_at,
},
rawLaunch,
lifecycle
);

const normalizedLaunch = snapshotLaunch
? {
...snapshotLaunch,
lifecycle,
graduation_readiness: graduationReadiness,
graduationReadiness,
builder_vesting: builderVesting,
builderVesting,
}
: null;

const sanitizedCandles = sanitizeCandlesForResponse(
snapshot?.candles || [],
rawLaunch,
lifecycle
);
const sanitizedTrades = sanitizeTradesForResponse(
snapshot?.trades || [],
rawLaunch,
lifecycle
);
const sanitizedPool = sanitizePoolForResponse(
snapshot?.pool || null,
rawLaunch,
lifecycle
);

return res.json({
ok: true,
success: true,
mint,
wallet_query: wallet || null,
status: phase.status,
phase,
market_enabled: phase.market_enabled,
can_trade: phase.can_trade,

source,

token: tokenPayload,
launch: normalizedLaunch,

chart: {
stats: snapshotStats,
candles: sanitizedCandles,
trades: sanitizedTrades,
source,
},

stats: snapshotStats,
candles: sanitizedCandles,
trades: sanitizedTrades,
pool: sanitizedPool,

wallet_summary: walletPayload,
wallet: walletPayload,

lifecycle,
graduationPlan,
graduationReadiness,
graduation_readiness: graduationReadiness,

builderVesting,
builder_vesting: builderVesting,

cassie: buildCassiePayload(
snapshot?.cassie || null,
rawLaunch,
lifecycle,
source
),
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