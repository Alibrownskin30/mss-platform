import express from "express";
import db from "../db/index.js";
import { getChartSnapshot, getChartTrades } from "../services/chart-service.js";

const router = express.Router();

const BUILDER_TOTAL_ALLOCATION_PCT = 5;
const BUILDER_DAILY_UNLOCK_PCT = 0.5;
const BUILDER_UNLOCK_DAYS = 10;
const BUILDER_CLIFF_DAYS = 0;
const BUILDER_VESTING_DAYS = BUILDER_UNLOCK_DAYS;

const BUILDER_VESTING_RULE =
"Builder allocation unlocks at 0.5% of total supply per day until the full 5% builder allocation is unlocked.";

function toNumber(value, fallback = 0) {
if (value === null || value === undefined || value === "") return fallback;
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

function parseJsonMaybe(value, fallback = null) {
if (value == null || value === "") return fallback;
if (typeof value === "object") return value;

try {
return JSON.parse(String(value));
} catch {
return fallback;
}
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
const countdownEndsMs = parseDbTime(launch?.countdown_ends_at);
const liveAtMs = parseDbTime(launch?.live_at);
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
return "live";
}

/*
Protected phase rule:
countdown/building must not auto-promote to live just because mint/CA/pool
data exists. finalizeLaunch.js owns true live promotion.
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
Legacy fallback only:
allow missing/unknown status to infer live from mint signals.
Never override protected states.
*/
if (
!rawStatus &&
!lifecycleLaunchStatus &&
Number.isFinite(liveAtMs) &&
now >= liveAtMs &&
liveMintSignal
) {
return "live";
}

if (!rawStatus && !lifecycleLaunchStatus && liveMintSignal) {
return "live";
}

return rawStatus || lifecycleLaunchStatus || "commit";
}

function shouldRevealContractAddress(status) {
const normalized = cleanText(status, 64).toLowerCase();
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

function inferCassieRisk(stats = {}, phase = null) {
if (phase && !phase.market_enabled) return "normal";

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

function normalizeLifecycle(raw = {}, phase = null) {
if (!raw || typeof raw !== "object") return null;

if (phase && !phase.market_enabled) {
return null;
}

return {
launch_status:
cleanText(raw.launch_status ?? raw.launchStatus ?? raw.status, 64).toLowerCase() ||
null,
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
surge_status:
cleanText(raw.surge_status ?? raw.surgeStatus ?? raw.graduation_status, 120) ||
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
graduationReadiness:
raw.graduationReadiness ?? raw.graduation_readiness ?? null,

builder_vesting: raw.builder_vesting ?? raw.builderVesting ?? null,
builderVesting: raw.builderVesting ?? raw.builder_vesting ?? null,
};
}

function normalizeGraduationReadiness(readiness = {}, phase = null) {
if (!readiness || typeof readiness !== "object") return null;

if (phase && !phase.market_enabled) {
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

function normalizeBuilderVestingSummary(raw = {}, phase = null) {
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

rule: BUILDER_VESTING_RULE,
};

if (!raw || typeof raw !== "object" || (phase && !phase.market_enabled)) {
return empty;
}

const builderWallet =
cleanText(raw.builder_wallet ?? raw.builderWallet, 120) || null;
const totalAllocation = toInt(raw.total_allocation ?? raw.totalAllocation, 0);
const rawDailyUnlock = toInt(raw.daily_unlock ?? raw.dailyUnlock, 0);
const dailyUnlock = Math.max(
rawDailyUnlock,
totalAllocation > 0 ? toInt(totalAllocation / BUILDER_UNLOCK_DAYS, 0) : 0
);
const unlockedAmount = toInt(raw.unlocked_amount ?? raw.unlockedAmount, 0);
const lockedAmount = toInt(raw.locked_amount ?? raw.lockedAmount, 0);
const vestedDays = toInt(raw.vested_days ?? raw.vestedDays, 0);
const vestingStartAt = raw.vesting_start_at ?? raw.vestingStartAt ?? null;

return {
builder_wallet: builderWallet,
builderWallet,

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
created_at: raw.created_at ?? raw.createdAt ?? null,
createdAt: raw.createdAt ?? raw.created_at ?? null,
updated_at: raw.updated_at ?? raw.updatedAt ?? null,
updatedAt: raw.updatedAt ?? raw.updated_at ?? null,

vested_days: Math.min(BUILDER_UNLOCK_DAYS, vestedDays),
vestedDays: Math.min(BUILDER_UNLOCK_DAYS, vestedDays),
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

rule: BUILDER_VESTING_RULE,
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

function sanitizePoolForResponse(pool, phase) {
if (!pool || !phase.market_enabled) return null;

return {
id: pool.id ?? null,
launch_id: pool.launch_id ?? null,
status: pool.status || null,
token_reserve: toNumber(pool.token_reserve, 0),
sol_reserve: toNumber(pool.sol_reserve, 0),
k_value: toNumber(pool.k_value, 0),
initial_token_reserve: toNumber(pool.initial_token_reserve, 0),
created_at: pool.created_at || null,
};
}

function sanitizeTradesForResponse(trades, phase) {
if (!phase.market_enabled) return [];
return Array.isArray(trades) ? trades.map(normalizeTradeRow) : [];
}

function emptyWalletPayload(phase) {
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

function buildWalletPayload({
phase,
walletSummary = {},
stats = {},
builderVesting = {},
requestWalletIsBuilder = false,
}) {
if (!phase.market_enabled) {
return emptyWalletPayload(phase);
}

const builderTotalAllocationFallback = toInt(
chooseFirstFinite(
walletSummary.builder_total_allocation_tokens,
stats.builder_total_allocation_tokens,
builderVesting.total_allocation,
builderVesting.totalAllocation
),
0
);

const builderUnlockedAllocationFallback = toInt(
chooseFirstFinite(
walletSummary.builder_unlocked_allocation_tokens,
stats.builder_unlocked_allocation_tokens,
builderVesting.unlocked_amount,
builderVesting.unlockedAmount
),
0
);

const builderLockedAllocationFallback = toInt(
chooseFirstFinite(
walletSummary.builder_locked_allocation_tokens,
stats.builder_locked_allocation_tokens,
builderVesting.locked_amount,
builderVesting.lockedAmount
),
0
);

const builderUnlockedFallback = toInt(
chooseFirstFinite(
walletSummary.builder_unlocked_tokens,
stats.builder_unlocked_tokens,
builderUnlockedAllocationFallback
),
builderUnlockedAllocationFallback
);

const builderLockedFallback = toInt(
chooseFirstFinite(
walletSummary.builder_locked_tokens,
stats.builder_locked_tokens,
builderLockedAllocationFallback
),
builderLockedAllocationFallback
);

const builderSellableFallback = toInt(
chooseFirstFinite(
walletSummary.builder_sellable_tokens,
stats.builder_sellable_tokens,
builderUnlockedFallback
),
builderUnlockedFallback
);

const builderVisibleTotalFallback = toInt(
chooseFirstFinite(
walletSummary.builder_visible_total_tokens,
stats.builder_visible_total_tokens,
builderTotalAllocationFallback
),
builderTotalAllocationFallback
);

const builderVestedDays = Math.min(
BUILDER_UNLOCK_DAYS,
toInt(
chooseFirstFinite(
walletSummary.builder_vested_days,
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
walletSummary.builder_daily_unlock_tokens,
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
walletSummary.builder_vesting_start_at ||
stats.builder_vesting_start_at ||
builderVesting.vesting_start_at ||
builderVesting.vestingStartAt ||
null;

const walletIsBuilder = Boolean(
walletSummary.wallet_is_builder ||
walletSummary.is_builder_wallet ||
stats.wallet_is_builder ||
stats.is_builder_wallet ||
requestWalletIsBuilder
);

const walletIsParticipant = Boolean(
walletSummary.is_participant_wallet || stats.is_participant_wallet
);

const walletIsTeam = Boolean(
walletSummary.is_team_wallet || stats.is_team_wallet
);

const walletVestingActive = Boolean(
walletSummary.wallet_vesting_active ||
walletSummary.vesting_active ||
stats.wallet_vesting_active ||
stats.vesting_active ||
(walletIsBuilder && builderLockedFallback > 0)
);

const tokenBalance = toInt(
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

const totalBalance = toInt(
chooseFirstFinite(
walletSummary.total_balance,
walletSummary.totalBalance,
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
walletSummary.visible_total_balance,
walletSummary.visibleTotalBalance,
walletSummary.total_balance,
walletSummary.totalBalance,
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
walletSummary.sellable_balance,
walletSummary.sellableBalance,
walletSummary.sellable_token_balance,
walletSummary.sellableTokenBalance,
stats.wallet_sellable_balance,
stats.wallet_sellable_token_balance,
walletIsBuilder ? builderSellableFallback : null,
tokenBalance
),
walletIsBuilder ? builderSellableFallback : tokenBalance
);

const unlockedBalance = toInt(
chooseFirstFinite(
walletSummary.unlocked_balance,
walletSummary.unlockedBalance,
walletSummary.unlocked_token_balance,
walletSummary.unlockedTokenBalance,
stats.wallet_unlocked_balance,
stats.wallet_unlocked_token_balance,
walletIsBuilder ? builderUnlockedFallback : null,
sellableBalance
),
walletIsBuilder ? builderUnlockedFallback : sellableBalance
);

const lockedBalance = toInt(
chooseFirstFinite(
walletSummary.locked_balance,
walletSummary.lockedBalance,
walletSummary.locked_token_balance,
walletSummary.lockedTokenBalance,
stats.wallet_locked_balance,
stats.wallet_locked_token_balance,
walletIsBuilder ? builderLockedFallback : null,
Math.max(0, visibleTotalBalance - unlockedBalance)
),
walletIsBuilder
? Math.max(builderLockedFallback, visibleTotalBalance - unlockedBalance)
: Math.max(0, visibleTotalBalance - unlockedBalance)
);

const positionValueSol = toNumber(
chooseFirstFinite(
walletSummary.position_value_sol,
walletSummary.positionValueSol,
stats.wallet_position_value_sol
),
0
);

const positionValueUsd = toNumber(
chooseFirstFinite(
walletSummary.position_value_usd,
walletSummary.positionValueUsd,
stats.wallet_position_value_usd
),
0
);

const solBalance = toNumber(
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

const solDelta = toNumber(
chooseFirstFinite(
walletSummary.sol_delta,
walletSummary.solDelta,
walletSummary.walletSolDelta,
stats.wallet_sol_delta,
stats.walletSolDelta,
solBalance
),
solBalance
);

const builderVestingPercentUnlocked = toNumber(
chooseFirstFinite(
walletSummary.builder_vesting_percent_unlocked,
stats.builder_vesting_percent_unlocked,
builderTotalAllocationFallback > 0
? (builderUnlockedAllocationFallback / builderTotalAllocationFallback) * 100
: 0
),
0
);

const builderVestingDaysLive = toInt(
chooseFirstFinite(
walletSummary.builder_vesting_days_live,
stats.builder_vesting_days_live,
builderVestedDays
),
0
);

return {
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

participant_total_allocation_tokens: toInt(
walletSummary.participant_total_allocation_tokens ??
stats.participant_total_allocation_tokens,
0
),
participant_unlocked_tokens: toInt(
walletSummary.participant_unlocked_tokens ??
stats.participant_unlocked_tokens,
0
),
participant_locked_tokens: toInt(
walletSummary.participant_locked_tokens ?? stats.participant_locked_tokens,
0
),
participant_sellable_tokens: toInt(
walletSummary.participant_sellable_tokens ??
stats.participant_sellable_tokens,
0
),
participant_vesting_percent_unlocked: toNumber(
walletSummary.participant_vesting_percent_unlocked ??
stats.participant_vesting_percent_unlocked,
0
),
participant_vesting_days_live: toInt(
walletSummary.participant_vesting_days_live ??
stats.participant_vesting_days_live,
0
),
participant_vesting_days: toInt(
walletSummary.participant_vesting_days ?? stats.participant_vesting_days,
0
),
participant_vesting_label: cleanText(
walletSummary.participant_vesting_label ?? stats.participant_vesting_label,
200
),

team_total_allocation_tokens: toInt(
walletSummary.team_total_allocation_tokens ??
stats.team_total_allocation_tokens,
0
),
team_unlocked_tokens: toInt(
walletSummary.team_unlocked_tokens ?? stats.team_unlocked_tokens,
0
),
team_locked_tokens: toInt(
walletSummary.team_locked_tokens ?? stats.team_locked_tokens,
0
),
team_sellable_tokens: toInt(
walletSummary.team_sellable_tokens ?? stats.team_sellable_tokens,
0
),
team_vesting_percent_unlocked: toNumber(
walletSummary.team_vesting_percent_unlocked ??
stats.team_vesting_percent_unlocked,
0
),

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
can_trade: true,
};
}

function buildStatsPayload({
phase,
stats = {},
launch = {},
token = {},
lifecycle = {},
walletPayload = {},
graduationReadiness = null,
}) {
const marketActive = phase.market_enabled;

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

const circulatingSupply = marketActive
? toInt(
chooseFirstFinite(
stats.circulating_supply,
launch.circulating_supply
),
0
)
: 0;

const priceSol = marketActive
? toNumber(chooseFirstFinite(stats.price_sol, stats.price, launch.price), 0)
: 0;

const priceUsd = marketActive
? toNumber(chooseFirstFinite(stats.price_usd, launch.price_usd), 0)
: 0;

const liquiditySol = marketActive
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

const liquidityUsd = marketActive
? toNumber(
chooseFirstFinite(
stats.liquidity_usd,
launch.current_liquidity_usd,
launch.liquidity_usd
),
0
)
: 0;

const marketCapSol = marketActive
? toNumber(
chooseFirstFinite(
stats.market_cap_sol,
stats.market_cap,
lifecycle?.implied_marketcap_sol,
launch.market_cap
),
0
)
: 0;

const marketCapUsd = marketActive
? toNumber(chooseFirstFinite(stats.market_cap_usd, launch.market_cap_usd), 0)
: 0;

const volume24hSol = marketActive
? toNumber(
chooseFirstFinite(stats.volume_24h_sol, stats.volume_24h, launch.volume_24h),
0
)
: 0;

const volume24hUsd = marketActive
? toNumber(chooseFirstFinite(stats.volume_24h_usd, launch.volume_24h_usd), 0)
: 0;

return {
...stats,

phase,
market_enabled: marketActive,
can_trade: marketActive,

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

buys_24h: marketActive ? toInt(stats.buys_24h, 0) : 0,
sells_24h: marketActive ? toInt(stats.sells_24h, 0) : 0,
trades_24h: marketActive ? toInt(stats.trades_24h ?? stats.tx_count_24h, 0) : 0,
tx_count_24h: marketActive ? toInt(stats.tx_count_24h ?? stats.trades_24h, 0) : 0,

price_change_pct: marketActive ? toNumber(stats.price_change_pct, 0) : 0,
high_24h: marketActive ? toNumber(stats.high_24h, 0) : 0,
low_24h: marketActive ? toNumber(stats.low_24h, 0) : 0,
high_24h_sol: marketActive
? toNumber(stats.high_24h_sol ?? stats.high_24h, 0)
: 0,
low_24h_sol: marketActive
? toNumber(stats.low_24h_sol ?? stats.low_24h, 0)
: 0,

total_supply: totalSupply,
circulating_supply: circulatingSupply,

sol_usd_price: marketActive ? toNumber(stats.sol_usd_price, 0) : 0,

wallet_token_balance: walletPayload.token_balance,
wallet_balance_tokens: walletPayload.wallet_balance_tokens,
wallet_total_balance: walletPayload.total_balance,
wallet_visible_total_balance: walletPayload.visible_total_balance,

wallet_sellable_balance: walletPayload.sellable_balance,
wallet_sellable_token_balance: walletPayload.sellable_token_balance,

wallet_unlocked_balance: walletPayload.unlocked_balance,
wallet_unlocked_token_balance: walletPayload.unlocked_token_balance,

wallet_locked_balance: walletPayload.locked_balance,
wallet_locked_token_balance: walletPayload.locked_token_balance,

wallet_position_value_sol: walletPayload.position_value_sol,
wallet_position_value_usd: walletPayload.position_value_usd,
wallet_sol_balance: walletPayload.sol_balance,
wallet_sol_delta: walletPayload.sol_delta,
walletSolDelta: walletPayload.walletSolDelta,

wallet_is_builder: walletPayload.wallet_is_builder,
is_builder_wallet: walletPayload.is_builder_wallet,
is_participant_wallet: walletPayload.is_participant_wallet,
is_team_wallet: walletPayload.is_team_wallet,
wallet_vesting_active: walletPayload.wallet_vesting_active,

participant_total_allocation_tokens:
walletPayload.participant_total_allocation_tokens,
participant_unlocked_tokens: walletPayload.participant_unlocked_tokens,
participant_locked_tokens: walletPayload.participant_locked_tokens,
participant_sellable_tokens: walletPayload.participant_sellable_tokens,
participant_vesting_percent_unlocked:
walletPayload.participant_vesting_percent_unlocked,
participant_vesting_days_live: walletPayload.participant_vesting_days_live,
participant_vesting_days: walletPayload.participant_vesting_days,
participant_vesting_label: walletPayload.participant_vesting_label,

team_total_allocation_tokens: walletPayload.team_total_allocation_tokens,
team_unlocked_tokens: walletPayload.team_unlocked_tokens,
team_locked_tokens: walletPayload.team_locked_tokens,
team_sellable_tokens: walletPayload.team_sellable_tokens,
team_vesting_percent_unlocked: walletPayload.team_vesting_percent_unlocked,

builder_total_allocation_tokens: walletPayload.builder_total_allocation_tokens,
builder_unlocked_tokens: walletPayload.builder_unlocked_tokens,
builder_locked_tokens: walletPayload.builder_locked_tokens,
builder_sellable_tokens: walletPayload.builder_sellable_tokens,
builder_visible_total_tokens: walletPayload.builder_visible_total_tokens,
builder_unlocked_allocation_tokens:
walletPayload.builder_unlocked_allocation_tokens,
builder_locked_allocation_tokens:
walletPayload.builder_locked_allocation_tokens,
builder_vesting_percent_unlocked:
walletPayload.builder_vesting_percent_unlocked,
builder_vesting_days_live: walletPayload.builder_vesting_days_live,
builder_vested_days: walletPayload.builder_vested_days,
builder_daily_unlock_tokens: walletPayload.builder_daily_unlock_tokens,
builder_cliff_days: walletPayload.builder_cliff_days,
builder_vesting_days: walletPayload.builder_vesting_days,
builder_unlock_days: walletPayload.builder_unlock_days,
builder_daily_unlock_pct: walletPayload.builder_daily_unlock_pct,
builder_total_allocation_pct: walletPayload.builder_total_allocation_pct,
builder_vesting_start_at: walletPayload.builder_vesting_start_at,
builder_vesting_rule: walletPayload.builder_vesting_rule,
};
}

function buildLaunchPayload({
launch = {},
phase,
mintAddress,
lifecycle,
graduationReadiness,
builderVesting,
statsPayload,
}) {
const revealContract = phase.market_enabled;

return {
id: launch.id,
token_name: launch.token_name,
name: launch.name || launch.token_name,
symbol: launch.symbol,
status: phase.status,
raw_status: cleanText(launch.raw_status || launch.status, 80) || null,
phase,
template: launch.template || null,
launch_type: launch.launch_type || null,

description: cleanText(launch.description, 5000),
image_url: cleanText(launch.image_url, 1000),

contract_address: revealContract
? cleanText(launch.contract_address, 120) || mintAddress
: null,
mint_address: revealContract ? mintAddress : null,
token_mint: revealContract ? mintAddress : null,
mint: revealContract ? mintAddress : null,

reserved_mint_address: null,
reserved_mint_secret: null,
reserved_mint_public_key: null,
reserved_mint_private_key: null,
reserved_mint_keypair: null,

mint_reservation_status: revealContract
? cleanText(launch.mint_reservation_status, 64) || null
: null,
mint_finalized_at: revealContract ? launch.mint_finalized_at || null : null,

builder_wallet:
cleanText(launch.builder_wallet || lifecycle?.builder_wallet, 120) || null,
builder_alias: cleanText(launch.builder_alias, 120) || null,
builder_score: toNumber(launch.builder_score, 0),

supply: toInt(launch.supply, 0),
final_supply: toInt(launch.final_supply ?? launch.supply, 0),
total_supply: statsPayload.total_supply,
circulating_supply: revealContract ? statsPayload.circulating_supply : 0,

committed_sol: toNumber(launch.committed_sol, 0),
participants_count: toInt(launch.participants_count ?? launch.participant_count, 0),
participant_count: toInt(launch.participants_count ?? launch.participant_count, 0),
hard_cap_sol: toNumber(launch.hard_cap_sol, 0),
min_raise_sol: toNumber(launch.min_raise_sol, 0),

liquidity_pct: toNumber(launch.liquidity_pct, 20),
participants_pct: toNumber(launch.participants_pct, 45),
reserve_pct: toNumber(launch.reserve_pct, 30),
builder_pct: toNumber(launch.builder_pct, 5),
team_allocation_pct: toNumber(launch.team_allocation_pct, 0),

internal_pool_sol: revealContract
? toNumber(
chooseFirstFinite(
launch.internal_pool_sol,
lifecycle?.internal_sol_reserve
),
0
)
: 0,
internal_pool_tokens: revealContract
? toInt(
chooseFirstFinite(
launch.internal_pool_tokens,
lifecycle?.internal_token_reserve
),
0
)
: 0,

liquidity: statsPayload.liquidity,
liquidity_sol: statsPayload.liquidity_sol,
liquidity_usd: statsPayload.liquidity_usd,
current_liquidity_usd: statsPayload.liquidity_usd,

sol_usd_price: statsPayload.sol_usd_price,

price: statsPayload.price,
price_sol: statsPayload.price_sol,
price_usd: statsPayload.price_usd,

market_cap: statsPayload.market_cap,
market_cap_sol: statsPayload.market_cap_sol,
market_cap_usd: statsPayload.market_cap_usd,

volume_24h: statsPayload.volume_24h,
volume_24h_sol: statsPayload.volume_24h_sol,
volume_24h_usd: statsPayload.volume_24h_usd,

website_url: cleanText(launch.website_url, 500),
x_url: cleanText(launch.x_url, 500),
telegram_url: cleanText(launch.telegram_url, 500),
discord_url: cleanText(launch.discord_url, 500),

team_wallets: Array.isArray(launch.team_wallets)
? launch.team_wallets
: parseJsonMaybe(launch.team_wallets, []),
team_wallet_breakdown: Array.isArray(launch.team_wallet_breakdown)
? launch.team_wallet_breakdown
: parseJsonMaybe(launch.team_wallet_breakdown, []),

countdown_started_at: launch.countdown_started_at || null,
countdown_ends_at: launch.countdown_ends_at || null,
live_at: launch.live_at || null,
commit_started_at: launch.commit_started_at || null,
commit_ends_at: launch.commit_ends_at || null,
created_at: launch.created_at || null,
updated_at: launch.updated_at || null,

lifecycle: revealContract ? lifecycle : null,
graduation_readiness: revealContract ? graduationReadiness : null,
graduationReadiness: revealContract ? graduationReadiness : null,
builder_vesting: revealContract ? builderVesting : null,
builderVesting: revealContract ? builderVesting : null,

surge_status: revealContract ? lifecycle?.graduation_status || null : null,
surge_ready: revealContract ? Boolean(graduationReadiness?.ready) : false,
};
}

function buildTokenPayload({ token = {}, launch = {}, phase, mintAddress, totalSupply }) {
const revealContract = phase.market_enabled;

return {
id: token?.id || null,
launch_id: token?.launch_id || launch?.id || null,
name: token?.name || launch?.token_name || launch?.name || null,
symbol: token?.symbol || launch?.symbol || null,
ticker: token?.symbol || launch?.symbol || null,
supply: totalSupply,

mint_address: revealContract ? mintAddress : null,
mint: revealContract ? mintAddress : null,
token_mint: revealContract ? mintAddress : null,
contract_address: revealContract ? mintAddress : null,

reserved_mint_address: null,
reserved_mint_secret: null,
reserved_mint_public_key: null,
reserved_mint_private_key: null,
reserved_mint_keypair: null,

created_at: token?.created_at || null,
};
}

router.get("/:launchId", async (req, res) => {
try {
const launchId = Number(req.params.launchId);
const wallet = cleanWallet(req.query.wallet);

if (!Number.isFinite(launchId) || launchId <= 0) {
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

if (!launch) {
return res.status(404).json({ ok: false, error: "Launch not found" });
}

const lifecycleRaw =
snapshot?.lifecycle ||
launch?.lifecycle ||
(await readLifecycleFallback(launchId)) ||
null;

const preliminaryPhase = buildPhaseMeta(launch, lifecycleRaw);
const lifecycle = normalizeLifecycle(lifecycleRaw, preliminaryPhase);
const phase = buildPhaseMeta(launch, lifecycle);

const token = snapshot?.token || null;
const pool = snapshot?.pool || null;
const walletSummary = snapshot?.wallet || {};
const stats = snapshot?.stats || {};
const cassie = snapshot?.cassie || null;

const graduationReadiness = normalizeGraduationReadiness(
snapshot?.graduationReadiness ||
snapshot?.graduation_readiness ||
lifecycle?.graduation_readiness ||
lifecycle?.graduationReadiness ||
launch?.graduationReadiness ||
launch?.graduation_readiness ||
null,
phase
);

const builderVestingRaw =
snapshot?.builderVesting ||
snapshot?.builder_vesting ||
launch?.builder_vesting ||
lifecycle?.builder_vesting ||
lifecycle?.builderVesting ||
(await readBuilderVestingFallback(launchId)) ||
null;

const builderVesting = normalizeBuilderVestingSummary(builderVestingRaw, phase);

const revealContract = phase.market_enabled;

const mintAddress =
(revealContract
? choosePreferredString(
token?.mint_address,
token?.mint,
token?.token_mint,
launch?.mint_address,
launch?.contract_address,
launch?.token_mint,
launch?.mint,
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

const walletPayload = buildWalletPayload({
phase,
walletSummary,
stats,
builderVesting,
requestWalletIsBuilder,
});

const statsPayload = buildStatsPayload({
phase,
stats,
launch,
token,
lifecycle,
walletPayload,
graduationReadiness,
});

const launchPayload = buildLaunchPayload({
launch,
phase,
mintAddress,
lifecycle,
graduationReadiness,
builderVesting,
statsPayload,
});

const tokenPayload = buildTokenPayload({
token,
launch,
phase,
mintAddress,
totalSupply: statsPayload.total_supply,
});

const sanitizedPool = sanitizePoolForResponse(pool, phase);
const sanitizedTrades = sanitizeTradesForResponse(snapshot?.trades, phase);
const cassieRisk = inferCassieRisk(statsPayload, phase);

return res.json({
ok: true,
success: true,
status: phase.status,
phase,
market_enabled: phase.market_enabled,
can_trade: phase.can_trade,

launch: launchPayload,
token: tokenPayload,

wallet: walletPayload,
wallet_summary: walletPayload,

stats: statsPayload,
pool: sanitizedPool,
trades: sanitizedTrades,

lifecycle: phase.market_enabled ? lifecycle : null,
graduationReadiness: phase.market_enabled ? graduationReadiness : null,
graduation_readiness: phase.market_enabled ? graduationReadiness : null,
builderVesting: phase.market_enabled ? builderVesting : null,
builder_vesting: phase.market_enabled ? builderVesting : null,

cassie: {
...(cassie || {}),
monitoring_active:
phase.market_enabled ? cassie?.monitoring_active !== false : false,
phase: phase.status,
layer: cassie?.layer || "market-intelligence",
risk_state: phase.market_enabled
? cassie?.risk_state || cassieRisk
: "normal",
market_enabled: phase.market_enabled,
can_trade: phase.can_trade,
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

if (!Number.isFinite(launchId) || launchId <= 0) {
return res.status(400).json({ ok: false, error: "Invalid launchId" });
}

const payload = await getChartTrades({
db,
launchId,
limit: 100,
});

const launch = payload?.launch || null;

if (!launch) {
return res.status(404).json({ ok: false, error: "Launch not found" });
}

const phase = buildPhaseMeta(launch);
const trades = sanitizeTradesForResponse(payload?.trades, phase);

return res.json({
ok: true,
success: true,
status: phase.status,
phase,
market_enabled: phase.market_enabled,
can_trade: phase.can_trade,
trades,
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
