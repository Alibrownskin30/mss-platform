import express from "express";
import launcherDb from "../db/index.js";
import {
getChartCandles,
getChartTrades,
getChartStats,
getChartSnapshot,
} from "../services/chart-service.js";
import { getLiquidityLifecycle } from "../services/launcher/liquidityLifecycle.js";

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
const TEAM_CLIFF_DAYS = 14;
const TEAM_VESTING_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

function lifecycleIsGraduated(lifecycle = null) {
if (!lifecycle) return false;
if (lifecycle.graduated === true) return true;
return toNumber(lifecycle.graduated, 0) === 1;
}

function isFalseLike(value) {
if (value === false || value === 0) return true;
const raw = String(value ?? "").trim().toLowerCase();
return raw === "0" || raw === "false" || raw === "no";
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
lifecycleIsGraduated(lifecycle)
) {
return "graduated";
}

if (rawStatus === "live" || lifecycleLaunchStatus === "live") {
return isMarketBootstrappedFalse(launch, lifecycle) ? "building" : "live";
}

/*
Protected phase rule:
Building/countdown must not auto-promote to live just because mint, pool,
lifecycle or contract data exists. finalizeLaunch.js owns live promotion.
*/
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

/*
Legacy fallback only. This is intentionally after countdown/building checks
so old rows can be rescued without breaking protected pre-live phases.
*/
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
const phaseStatusFromService = normalizeLaunchStatus(launch?.phase?.status);
const phaseSource = phaseStatusFromService
? { ...(launch || {}), status: phaseStatusFromService }
: launch;

const status = computeCanonicalLaunchStatus(phaseSource, lifecycle);
const marketEnabled = shouldRevealContractAddress(status);

return {
status,
market_enabled: marketEnabled,
can_trade: status === "live",
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

function normalizeLifecycle(raw = {}, launch = null, phaseOverride = null) {
const phase = phaseOverride || buildPhaseMeta(launch, raw);
if (!raw || typeof raw !== "object") return null;
if (!phase.market_enabled) return null;

const graduated = lifecycleIsGraduated(raw);

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

graduation_readiness:
raw.graduation_readiness ?? raw.graduationReadiness ?? null,
graduationReadiness:
raw.graduationReadiness ?? raw.graduation_readiness ?? null,

builder_vesting: raw.builder_vesting ?? raw.builderVesting ?? null,
builderVesting: raw.builderVesting ?? raw.builder_vesting ?? null,
};
}

function normalizeGraduationReadiness(readiness = {}, phase = null) {
if (!readiness || typeof readiness !== "object") return null;
if (phase && !phase.market_enabled) return null;

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
readiness.thresholds.lockDays ??
readiness.thresholds.lock_days,
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
readiness.checks.liveStatus ??
readiness.checks.live_status
),
marketcapReached: Boolean(
readiness.checks.marketcapReached ??
readiness.checks.marketcap_reached
),
volumeReached: Boolean(
readiness.checks.volumeReached ??
readiness.checks.volume_reached
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
readiness.checks.hasReserves ??
readiness.checks.has_reserves
),
alreadyGraduated: Boolean(
readiness.checks.alreadyGraduated ??
readiness.checks.already_graduated
),
}
: null,
};
}

function normalizeBuilderVestingSummary(raw = {}, launch = null, phase = null) {
const empty = {
builder_wallet: null,
builderWallet: null,

total_allocation: 0,
totalAllocation: 0,
daily_unlock: 0,
dailyUnlock: 0,
unlocked_amount: 0,
unlockedAmount: 0,
locked_amount: 0,
lockedAmount: 0,

vesting_start_at: null,
vestingStartAt: null,
created_at: null,
createdAt: null,
updated_at: null,
updatedAt: null,

vested_days: 0,
vestedDays: 0,
vesting_days_live: 0,
vestingDaysLive: 0,
unlock_days: BUILDER_UNLOCK_DAYS,
unlockDays: BUILDER_UNLOCK_DAYS,
cliff_days: BUILDER_CLIFF_DAYS,
cliffDays: BUILDER_CLIFF_DAYS,
vesting_days: BUILDER_VESTING_DAYS,
vestingDays: BUILDER_VESTING_DAYS,

total_allocation_pct: BUILDER_TOTAL_ALLOCATION_PCT,
totalAllocationPct: BUILDER_TOTAL_ALLOCATION_PCT,
daily_unlock_pct: BUILDER_DAILY_UNLOCK_PCT,
dailyUnlockPct: BUILDER_DAILY_UNLOCK_PCT,

percent_unlocked: 0,
percentUnlocked: 0,

rule: BUILDER_VESTING_RULE,
builder_vesting_rule: BUILDER_VESTING_RULE,
};

if (!raw || typeof raw !== "object" || (phase && !phase.market_enabled)) {
return empty;
}

const fixed = computeBuilderVestingFromRule(raw, launch, {
allowSupplyFallback: true,
});

const builderWallet =
cleanText(
raw.builder_wallet ?? raw.builderWallet ?? launch?.builder_wallet,
120
) || null;

return {
builder_wallet: builderWallet,
builderWallet: builderWallet,

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

vested_days: Math.min(BUILDER_UNLOCK_DAYS, fixed.vested_days),
vestedDays: Math.min(BUILDER_UNLOCK_DAYS, fixed.vestedDays),
vesting_days_live: fixed.vesting_days_live,
vestingDaysLive: fixed.vestingDaysLive,
unlock_days: BUILDER_UNLOCK_DAYS,
unlockDays: BUILDER_UNLOCK_DAYS,
cliff_days: BUILDER_CLIFF_DAYS,
cliffDays: BUILDER_CLIFF_DAYS,
vesting_days: BUILDER_VESTING_DAYS,
vestingDays: BUILDER_VESTING_DAYS,

total_allocation_pct: BUILDER_TOTAL_ALLOCATION_PCT,
totalAllocationPct: BUILDER_TOTAL_ALLOCATION_PCT,
daily_unlock_pct: BUILDER_DAILY_UNLOCK_PCT,
dailyUnlockPct: BUILDER_DAILY_UNLOCK_PCT,

percent_unlocked: fixed.percent_unlocked,
percentUnlocked: fixed.percentUnlocked,

rule: BUILDER_VESTING_RULE,
builder_vesting_rule: BUILDER_VESTING_RULE,
};
}

async function safeGetLifecycle(launchId) {
try {
return await getLiquidityLifecycle(launchId);
} catch {
return null;
}
}

async function readLifecycleFallback(launchId) {
try {
const row = await launcherDb.get(
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
const row = await launcherDb.get(
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

function sanitizeLaunchForResponse(launch = null, stats = {}, lifecycle = null) {
if (!launch) return null;

const phase = buildPhaseMeta(launch, lifecycle);
const revealContract = phase.market_enabled;

const revealedMintAddress = revealContract
? cleanText(
launch.mint_address ||
launch.contract_address ||
launch.token_mint ||
launch.mint ||
lifecycle?.contract_address,
120
) || null
: null;

const priceSol = revealContract
? toNumber(
chooseFirstFinite(
stats.price_sol,
stats.price,
launch.price,
launch.price_sol
),
0
)
: 0;

const liquiditySol = revealContract
? toNumber(
chooseFirstFinite(
stats.liquidity_sol,
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
stats.market_cap,
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
stats.volume_24h,
launch.volume_24h
),
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

lifecycle: revealContract ? launch.lifecycle || lifecycle || null : null,
builder_vesting: revealContract ? launch.builder_vesting || null : null,
allocation_summary: revealContract ? launch.allocation_summary || null : null,
launch_result_json: revealContract ? launch.launch_result_json || null : null,
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
if (!pool) return null;

const phase = buildPhaseMeta(launch, lifecycle);

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

function sanitizeCandlesForResponse(candles = [], launch = null, lifecycle = null) {
const phase = buildPhaseMeta(launch, lifecycle);
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

function sanitizeStatsForResponse(stats = {}, launch = null, lifecycle = null) {
const phase = buildPhaseMeta(launch, lifecycle);
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
stats.price_sol && walletVisibleTotalBalance > 0
? Number(stats.price_sol) * walletVisibleTotalBalance
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
getContractCandidateFromLaunch(launch, lifecycle),
120
) || null
: null;

return {
...stats,

phase,
market_enabled: marketActive,
can_trade: phase.can_trade,

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
wallet = {},
stats = {},
launch = null,
builderVesting = {},
requestWalletIsBuilder = false,
lifecycle = null
) {
const phase = buildPhaseMeta(launch, lifecycle);

if (!phase.market_enabled) {
return buildEmptyWalletPayload(phase);
}

const builderTotalAllocationFallback = toInt(
chooseFirstFinite(
wallet.builder_total_allocation_tokens,
stats.builder_total_allocation_tokens,
builderVesting.total_allocation,
builderVesting.totalAllocation
),
0
);

const builderUnlockedAllocationFallback = toInt(
chooseFirstFinite(
wallet.builder_unlocked_allocation_tokens,
stats.builder_unlocked_allocation_tokens,
builderVesting.unlocked_amount,
builderVesting.unlockedAmount
),
0
);

const builderLockedAllocationFallback = toInt(
chooseFirstFinite(
wallet.builder_locked_allocation_tokens,
stats.builder_locked_allocation_tokens,
builderVesting.locked_amount,
builderVesting.lockedAmount
),
0
);

const builderUnlockedFallback = toInt(
chooseFirstFinite(
wallet.builder_unlocked_tokens,
stats.builder_unlocked_tokens,
builderUnlockedAllocationFallback
),
builderUnlockedAllocationFallback
);

const builderLockedFallback = toInt(
chooseFirstFinite(
wallet.builder_locked_tokens,
stats.builder_locked_tokens,
builderLockedAllocationFallback
),
builderLockedAllocationFallback
);

const builderSellableFallback = toInt(
chooseFirstFinite(
wallet.builder_sellable_tokens,
stats.builder_sellable_tokens,
builderUnlockedFallback
),
builderUnlockedFallback
);

const builderVisibleTotalFallback = toInt(
chooseFirstFinite(
wallet.builder_visible_total_tokens,
stats.builder_visible_total_tokens,
builderTotalAllocationFallback
),
builderTotalAllocationFallback
);

const builderVestedDays = Math.min(
BUILDER_UNLOCK_DAYS,
toInt(
chooseFirstFinite(
wallet.builder_vested_days,
stats.builder_vested_days,
builderVesting.vested_days,
builderVesting.vestedDays
),
0
)
);

const builderDailyUnlockTokens = Math.max(
toInt(
chooseFirstFinite(
wallet.builder_daily_unlock_tokens,
stats.builder_daily_unlock_tokens,
builderVesting.daily_unlock,
builderVesting.dailyUnlock
),
0
),
builderTotalAllocationFallback > 0
? toInt(builderTotalAllocationFallback / BUILDER_UNLOCK_DAYS, 0)
: 0
);

const builderVestingStartAt =
wallet.builder_vesting_start_at ||
stats.builder_vesting_start_at ||
builderVesting.vesting_start_at ||
builderVesting.vestingStartAt ||
null;

const walletIsBuilder = Boolean(
wallet.wallet_is_builder ||
wallet.is_builder_wallet ||
stats.wallet_is_builder ||
stats.is_builder_wallet ||
requestWalletIsBuilder
);

const tokenBalance = toInt(
chooseFirstFinite(
wallet.token_balance,
wallet.tokenBalance,
wallet.balance_tokens,
wallet.wallet_balance_tokens,
stats.wallet_token_balance,
stats.wallet_balance_tokens,
walletIsBuilder ? builderSellableFallback : null
),
walletIsBuilder ? builderSellableFallback : 0
);

const totalBalance = toInt(
chooseFirstFinite(
wallet.total_balance,
wallet.totalBalance,
stats.wallet_total_balance,
walletIsBuilder ? builderTotalAllocationFallback : null,
tokenBalance
),
walletIsBuilder
? Math.max(tokenBalance, builderTotalAllocationFallback)
: tokenBalance
);

const visibleTotalBalance = toInt(
chooseFirstFinite(
wallet.visible_total_balance,
wallet.visibleTotalBalance,
wallet.total_balance,
wallet.totalBalance,
stats.wallet_visible_total_balance,
stats.wallet_total_balance,
walletIsBuilder ? builderVisibleTotalFallback : null,
totalBalance
),
walletIsBuilder
? Math.max(totalBalance, builderVisibleTotalFallback)
: totalBalance
);

const sellableBalance = toInt(
chooseFirstFinite(
wallet.sellable_balance,
wallet.sellableBalance,
wallet.sellable_token_balance,
wallet.sellableTokenBalance,
stats.wallet_sellable_balance,
stats.wallet_sellable_token_balance,
walletIsBuilder ? builderSellableFallback : null,
tokenBalance
),
walletIsBuilder ? builderSellableFallback : tokenBalance
);

const unlockedBalance = toInt(
chooseFirstFinite(
wallet.unlocked_balance,
wallet.unlockedBalance,
wallet.unlocked_token_balance,
wallet.unlockedTokenBalance,
stats.wallet_unlocked_balance,
stats.wallet_unlocked_token_balance,
walletIsBuilder ? builderUnlockedFallback : null,
sellableBalance
),
walletIsBuilder ? builderUnlockedFallback : sellableBalance
);

const lockedBalance = toInt(
chooseFirstFinite(
wallet.locked_balance,
wallet.lockedBalance,
wallet.locked_token_balance,
wallet.lockedTokenBalance,
stats.wallet_locked_balance,
stats.wallet_locked_token_balance,
walletIsBuilder ? builderLockedFallback : null,
Math.max(0, visibleTotalBalance - unlockedBalance)
),
walletIsBuilder
? Math.max(builderLockedFallback, visibleTotalBalance - unlockedBalance)
: Math.max(0, visibleTotalBalance - unlockedBalance)
);

const rawTeamTotalAllocationTokens = toInt(
chooseFirstFinite(
wallet.team_total_allocation_tokens,
stats.team_total_allocation_tokens,
wallet.team_unlocked_tokens,
stats.team_unlocked_tokens,
wallet.team_sellable_tokens,
stats.team_sellable_tokens,
wallet.team_locked_tokens,
stats.team_locked_tokens
),
0
);

const rawTeamUnlockedTokens = toInt(
chooseFirstFinite(
wallet.team_unlocked_tokens,
stats.team_unlocked_tokens,
wallet.team_sellable_tokens,
stats.team_sellable_tokens
),
0
);

const rawTeamLockedTokens = toInt(
chooseFirstFinite(
wallet.team_locked_tokens,
stats.team_locked_tokens,
Math.max(0, rawTeamTotalAllocationTokens - rawTeamUnlockedTokens)
),
Math.max(0, rawTeamTotalAllocationTokens - rawTeamUnlockedTokens)
);

const teamSellableTokens = toInt(
chooseFirstFinite(
wallet.team_sellable_tokens,
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
wallet.is_team_wallet ||
stats.is_team_wallet ||
teamTotalAllocationTokens > 0 ||
rawTeamLockedTokens > 0
);

const teamVestingPercentUnlocked = toNumber(
chooseFirstFinite(
wallet.team_vesting_percent_unlocked,
stats.team_vesting_percent_unlocked,
teamTotalAllocationTokens > 0
? (rawTeamUnlockedTokens / teamTotalAllocationTokens) * 100
: 0
),
0
);

const rawWalletIsParticipant = Boolean(
wallet.is_participant_wallet || stats.is_participant_wallet
);

const participantTotalAllocationSeed = toInt(
chooseFirstFinite(
wallet.participant_total_allocation_tokens,
stats.participant_total_allocation_tokens,
rawWalletIsParticipant ? visibleTotalBalance : null,
rawWalletIsParticipant ? totalBalance : null,
rawWalletIsParticipant ? sellableBalance : null,
rawWalletIsParticipant ? unlockedBalance : null
),
0
);

const walletIsParticipant = Boolean(
rawWalletIsParticipant || participantTotalAllocationSeed > 0
);

const participantTotalAllocationTokens = walletIsParticipant
? Math.max(
participantTotalAllocationSeed,
toInt(
chooseFirstFinite(
wallet.participant_unlocked_tokens,
stats.participant_unlocked_tokens,
wallet.participant_sellable_tokens,
stats.participant_sellable_tokens
),
0
)
)
: 0;

const participantUnlockedTokens = walletIsParticipant
? Math.max(
toInt(
chooseFirstFinite(
wallet.participant_unlocked_tokens,
stats.participant_unlocked_tokens,
wallet.participant_sellable_tokens,
stats.participant_sellable_tokens,
participantTotalAllocationTokens
),
participantTotalAllocationTokens
),
participantTotalAllocationTokens
)
: 0;

const participantSellableTokens = walletIsParticipant
? Math.max(
toInt(
chooseFirstFinite(
wallet.participant_sellable_tokens,
stats.participant_sellable_tokens,
participantUnlockedTokens
),
participantUnlockedTokens
),
participantUnlockedTokens
)
: 0;

const participantLockedTokens = 0;
const participantVestingPercentUnlocked = walletIsParticipant ? 100 : 0;
const participantVestingDaysLive = 0;
const participantVestingDays = 0;
const participantVestingLabel = walletIsParticipant
? PARTICIPANT_UNLOCK_LABEL
: "";

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

const builderVestingPercentUnlocked = toNumber(
chooseFirstFinite(
wallet.builder_vesting_percent_unlocked,
stats.builder_vesting_percent_unlocked,
builderVesting.percent_unlocked,
builderVesting.percentUnlocked,
builderTotalAllocationFallback > 0
? (builderUnlockedAllocationFallback / builderTotalAllocationFallback) * 100
: 0
),
0
);

const builderVestingDaysLive = toInt(
chooseFirstFinite(
wallet.builder_vesting_days_live,
stats.builder_vesting_days_live,
builderVesting.vesting_days_live,
builderVesting.vestingDaysLive,
builderVestedDays
),
0
);

const walletVestingActive = Boolean(
(walletIsBuilder && builderLockedFallback > 0) ||
(walletIsTeam && rawTeamLockedTokens > 0)
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

builder_total_allocation_tokens: builderTotalAllocationFallback,
builder_unlocked_tokens: builderUnlockedFallback,
builder_locked_tokens: builderLockedFallback,
builder_sellable_tokens: builderSellableFallback,
builder_visible_total_tokens: builderVisibleTotalFallback,
builder_unlocked_allocation_tokens: builderUnlockedAllocationFallback,
builder_locked_allocation_tokens: builderLockedAllocationFallback,
builder_vesting_percent_unlocked: builderVestingPercentUnlocked,
builder_vesting_days_live: builderVestingDaysLive,
builder_vested_days: builderVestedDays,
builder_daily_unlock_tokens: builderDailyUnlockTokens,
builder_cliff_days: BUILDER_CLIFF_DAYS,
builder_vesting_days: BUILDER_VESTING_DAYS,
builder_unlock_days: BUILDER_UNLOCK_DAYS,
builder_daily_unlock_pct: BUILDER_DAILY_UNLOCK_PCT,
builder_total_allocation_pct: BUILDER_TOTAL_ALLOCATION_PCT,
builder_vesting_start_at: builderVestingStartAt,
builder_vesting_rule: BUILDER_VESTING_RULE,

phase,
market_enabled: true,
can_trade: phase.can_trade,
};
}

function buildCassiePayload(cassie = null, launch = null, lifecycle = null) {
const phase = buildPhaseMeta(launch, lifecycle);

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

async function buildResponseContext(payload = {}, wallet = "", launchId = null) {
const rawLaunch = payload?.launch || null;

const lifecycleRaw =
payload?.lifecycle ||
rawLaunch?.lifecycle ||
(launchId ? await safeGetLifecycle(launchId) : null) ||
(launchId ? await readLifecycleFallback(launchId) : null) ||
null;

const preliminaryPhase = buildPhaseMeta(rawLaunch, lifecycleRaw);
const lifecycle = normalizeLifecycle(rawLifecycleSeed(lifecycleRaw), rawLaunch, preliminaryPhase);
const phase = buildPhaseMeta(rawLaunch, lifecycle);

const graduationReadiness = normalizeGraduationReadiness(
payload?.graduationReadiness ||
payload?.graduation_readiness ||
lifecycle?.graduation_readiness ||
lifecycle?.graduationReadiness ||
rawLaunch?.graduationReadiness ||
rawLaunch?.graduation_readiness ||
null,
phase
);

const builderVestingRaw =
payload?.builderVesting ||
payload?.builder_vesting ||
rawLaunch?.builder_vesting ||
lifecycle?.builder_vesting ||
lifecycle?.builderVesting ||
(launchId ? await readBuilderVestingFallback(launchId) : null) ||
null;

const builderVesting = normalizeBuilderVestingSummary(
builderVestingRaw,
rawLaunch,
phase
);

const stats = sanitizeStatsForResponse(payload?.stats || {}, rawLaunch, lifecycle);
const sanitizedLaunch = sanitizeLaunchForResponse(
{
...(rawLaunch || {}),
lifecycle,
builder_vesting: builderVesting,
graduation_readiness: graduationReadiness,
},
stats,
lifecycle
);

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
payload?.wallet || {},
stats,
rawLaunch,
builderVesting,
requestWalletIsBuilder,
lifecycle
);

return {
rawLaunch,
lifecycle,
phase,
graduationReadiness,
builderVesting,
stats,
launch: sanitizedLaunch,
token: sanitizeTokenForResponse(payload?.token || null, rawLaunch, lifecycle),
pool: sanitizePoolForResponse(payload?.pool || null, rawLaunch, lifecycle),
wallet: walletPayload,
wallet_summary: walletPayload,
cassie: buildCassiePayload(payload?.cassie || null, rawLaunch, lifecycle),
wallet_address: wallet || null,
};
}

function rawLifecycleSeed(raw) {
return raw && typeof raw === "object" ? raw : {};
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

const ctx = await buildResponseContext(payload, "", launchId);

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
candles: sanitizeCandlesForResponse(
payload?.candles || [],
ctx.rawLaunch,
ctx.lifecycle
),
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

const ctx = await buildResponseContext(payload, "", launchId);

return res.json({
ok: true,
success: true,
launch_id: launchId,
launchId,
status: ctx.phase.status,
phase: ctx.phase,
market_enabled: ctx.phase.market_enabled,
can_trade: ctx.phase.can_trade,
trades: sanitizeTradesForResponse(
payload?.trades || [],
ctx.rawLaunch,
ctx.lifecycle
),
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

const ctx = await buildResponseContext(payload, wallet, launchId);

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
lifecycle: ctx.phase.market_enabled ? ctx.lifecycle : null,
graduationReadiness: ctx.phase.market_enabled ? ctx.graduationReadiness : null,
graduation_readiness: ctx.phase.market_enabled ? ctx.graduationReadiness : null,
builderVesting: ctx.phase.market_enabled ? ctx.builderVesting : null,
builder_vesting: ctx.phase.market_enabled ? ctx.builderVesting : null,
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

const ctx = await buildResponseContext(payload, wallet, launchId);

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
candles: sanitizeCandlesForResponse(
payload?.candles || [],
ctx.rawLaunch,
ctx.lifecycle
),
trades: sanitizeTradesForResponse(
payload?.trades || [],
ctx.rawLaunch,
ctx.lifecycle
),
cassie: ctx.cassie,
lifecycle: ctx.phase.market_enabled ? ctx.lifecycle : null,
graduationReadiness: ctx.phase.market_enabled ? ctx.graduationReadiness : null,
graduation_readiness: ctx.phase.market_enabled ? ctx.graduationReadiness : null,
builderVesting: ctx.phase.market_enabled ? ctx.builderVesting : null,
builder_vesting: ctx.phase.market_enabled ? ctx.builderVesting : null,
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