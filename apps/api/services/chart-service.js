import { buildCandlesFromTrades, fillMissingCandles } from "./candle-builder.js";
import { buildMarketStats } from "./market-stats.js";

const BUILDER_MAX_ALLOCATION_PERCENT = 5;
const BUILDER_DAILY_UNLOCK_PERCENT = 0.5;
const BUILDER_UNLOCK_DAYS = 10;
const BUILDER_CLIFF_DAYS = 0;
const BUILDER_VESTING_DAYS = BUILDER_UNLOCK_DAYS;

const BUILDER_VESTING_RULE =
"0% unlocked at live. Builder allocation then unlocks at 0.5% of total supply per day for 10 days until the full 5% allocation is unlocked.";

const TEAM_CLIFF_DAYS = 14;
const TEAM_VESTING_DAYS = 180;

const PARTICIPANT_UNLOCK_LABEL = "100% unlocked at live.";

const EXTERNAL_MARKET_VENUE = "Raydium";
const EXTERNAL_MARKET_MODE = "external_lp_only";

const MARKET_SOURCE_PRELIVE = "hidden_pre_live";
const MARKET_SOURCE_INTERNAL_LEGACY = "internal_legacy";
const MARKET_SOURCE_SYNTHETIC = "synthetic_fallback";
const MARKET_SOURCE_LAUNCH_POOL = "launch_pool_fallback";
const MARKET_SOURCE_INTERNAL_SNAPSHOT = "internal_wallet_snapshot";
const MARKET_SOURCE_POLICY_ESTIMATE = "policy_estimate";
const MARKET_SOURCE_POLICY_METADATA_ONLY = "policy_metadata_only";
const MARKET_SOURCE_UNAVAILABLE = "unavailable";

const MS_PER_DAY = 86_400_000;

let walletBalanceColumnsCache = null;
const tableExistsCache = new Map();

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

function parseDbTime(value) {
if (!value) return null;

const raw = String(value).trim();
if (!raw) return null;

const hasExplicitTimezone = /z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw);

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

function parseJsonMaybe(value, fallback = null) {
if (value == null || value === "") return fallback;
if (typeof value === "object") return value;

try {
return JSON.parse(String(value));
} catch {
return fallback;
}
}

function normalizeWallet(value) {
return cleanText(value, 120).toLowerCase();
}

function normalizeTemplate(value) {
return cleanText(value, 80).toLowerCase() || "meme_lite";
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

function chooseFirstPositive(...values) {
for (const value of values) {
if (value === null || value === undefined || value === "") continue;
const num = Number(value);
if (Number.isFinite(num) && num > 0) return num;
}

return null;
}

function clamp(value, min, max) {
return Math.max(min, Math.min(max, value));
}

function normalizeAllocationType(value) {
const raw = cleanText(value, 80).toLowerCase();

if (!raw) return "";
if (raw === "participants") return "participant";
if (raw === "participant_allocation") return "participant";
if (raw === "builder_allocation") return "builder";
if (raw === "team_allocation") return "team";

return raw;
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

function shouldRevealContractAddress(status) {
const normalized = normalizeLaunchStatus(status);
return normalized === "live" || normalized === "graduated";
}

function isMarketEnabledLaunch(launch = null) {
return shouldRevealContractAddress(launch?.status);
}

async function tableExists(db, tableName) {
const key = String(tableName || "").trim();
if (!key) return false;

if (tableExistsCache.has(key)) {
return tableExistsCache.get(key);
}

const row = await db.get(
`
SELECT name
FROM sqlite_master
WHERE type = 'table' AND name = ?
LIMIT 1
`,
[key]
);

const exists = Boolean(row?.name);
tableExistsCache.set(key, exists);
return exists;
}

function getWalletBalanceColumnsFromRows(rows = []) {
return new Set(rows.map((row) => String(row.name || "").trim()));
}

async function getWalletBalanceColumns(db) {
const hasWalletBalances = await tableExists(db, "wallet_balances");
if (!hasWalletBalances) return new Set();

if (!walletBalanceColumnsCache) {
const rows = await db.all(`PRAGMA table_info(wallet_balances)`);
walletBalanceColumnsCache = getWalletBalanceColumnsFromRows(rows);
}

return walletBalanceColumnsCache;
}

function hasMintFinalizationSignal(row = {}) {
const contractAddress = cleanText(row.contract_address, 120);
const tokenMintAddress = cleanText(
row.token_mint_address || row.token_mint || row.mint_address || row.mint,
120
);
const mintReservationStatus = cleanText(row.mint_reservation_status, 64).toLowerCase();
const mintFinalizedAt = row.mint_finalized_at || null;

return Boolean(
contractAddress ||
tokenMintAddress ||
mintReservationStatus === "finalized" ||
mintFinalizedAt
);
}

function hasBootstrapReserveSignal(row = {}) {
const poolId = toInt(row.pool_id, 0);
const tokenId = toInt(row.token_id, 0);

const poolSolReserve = toNumber(row.sol_reserve, 0);
const poolTokenReserve = toNumber(row.token_reserve, 0);

const lifecycleSolReserve = toNumber(row.lifecycle_internal_sol_reserve, 0);
const lifecycleTokenReserve = toNumber(row.lifecycle_internal_token_reserve, 0);

const launchInternalPoolSol = toNumber(row.internal_pool_sol, 0);
const launchInternalPoolTokens = toNumber(row.internal_pool_tokens, 0);

const launchLiquidity = toNumber(row.liquidity, 0);
const launchPrice = toNumber(row.price, 0);

const hasPoolArtifacts =
tokenId > 0 && poolId > 0 && poolSolReserve > 0 && poolTokenReserve > 0;

const hasLifecycleReserves = lifecycleSolReserve > 0 && lifecycleTokenReserve > 0;

const hasLaunchSeedTruth =
launchInternalPoolSol > 0 &&
launchInternalPoolTokens > 0 &&
launchLiquidity > 0 &&
launchPrice > 0;

return hasPoolArtifacts || hasLifecycleReserves || hasLaunchSeedTruth;
}

function hasBootstrappedMarketSignal(row = {}) {
return hasMintFinalizationSignal(row) && hasBootstrapReserveSignal(row);
}

function computeLaunchPhase(row = {}) {
const rawStatus = normalizeLaunchStatus(row.status);
const lifecycleGraduationStatus = normalizeLaunchStatus(row.lifecycle_graduation_status);
const lifecycleGraduated = toInt(row.lifecycle_graduated, 0) === 1;

const countdownStartedMs = parseDbTime(row.countdown_started_at);
const countdownEndsMs = parseDbTime(row.countdown_ends_at);
const liveAtMs = parseDbTime(row.live_at);
const now = Date.now();

const hasCountdownWindow =
Number.isFinite(countdownStartedMs) || Number.isFinite(countdownEndsMs);
const countdownStillRunning = Number.isFinite(countdownEndsMs) && now < countdownEndsMs;
const hasBootstrappedMarket = hasBootstrappedMarketSignal(row);

if (rawStatus === "failed_refunded") return "failed_refunded";
if (rawStatus === "failed") return "failed";

if (
rawStatus === "graduated" ||
lifecycleGraduationStatus === "graduated" ||
lifecycleGraduated
) {
return "graduated";
}

if (rawStatus === "live") {
return hasBootstrappedMarket ? "live" : "building";
}

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

if (!rawStatus && Number.isFinite(liveAtMs) && now >= liveAtMs && hasBootstrappedMarket) {
return "live";
}

if (!rawStatus && hasBootstrappedMarket) {
return "live";
}

return rawStatus || "commit";
}

function buildPhaseMeta(launch = {}) {
const status = normalizeLaunchStatus(launch?.status || "commit") || "commit";
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

function getIntervalMs(interval = "1m") {
const value = String(interval || "1m").trim().toLowerCase();
if (value === "5m") return 5 * 60 * 1000;
if (value === "15m") return 15 * 60 * 1000;
if (value === "30m") return 30 * 60 * 1000;
if (value === "1h") return 60 * 60 * 1000;
if (value === "4h") return 4 * 60 * 60 * 1000;
if (value === "1d") return 24 * 60 * 60 * 1000;
return 60 * 1000;
}

function getLastTradeAt(trades = []) {
if (!Array.isArray(trades) || !trades.length) return null;
const latest = trades[trades.length - 1];
return latest?.created_at || latest?.timestamp || null;
}

function getLastCandleAt(candles = []) {
if (!Array.isArray(candles) || !candles.length) return null;
const latest = candles[candles.length - 1];
return latest?.bucket_start || latest?.timestamp || latest?.time || null;
}

function buildSyntheticCandles({ stats = {}, launch = {}, interval = "1m", limit = 120 }) {
if (!isMarketEnabledLaunch(launch)) return [];

const price = chooseFirstPositive(
stats.price_sol,
stats.price,
launch.price_sol,
launch.price
);

if (!(price > 0)) return [];

const bucketMs = getIntervalMs(interval);
const safeLimit = Math.max(1, Math.min(toInt(limit, 120), 500));
const nowBucketMs = Math.floor(Date.now() / bucketMs) * bucketMs;
const candles = [];

for (let index = safeLimit - 1; index >= 0; index -= 1) {
const bucketStartMs = nowBucketMs - index * bucketMs;
const bucketStart = new Date(bucketStartMs).toISOString();

candles.push({
bucket_start: bucketStart,
bucket_start_ms: bucketStartMs,
timestamp: bucketStart,
time: bucketStart,
open: price,
high: price,
low: price,
close: price,
volume_base: 0,
volume_sol: 0,
volume_token: 0,
buys: 0,
sells: 0,
trade_count: 0,
buy_volume_base: 0,
buy_volume_sol: 0,
sell_volume_base: 0,
sell_volume_sol: 0,
buy_volume_token: 0,
sell_volume_token: 0,
vwap: price,
first_trade_at: null,
last_trade_at: null,
change: 0,
change_pct: 0,
is_bullish: false,
is_synthetic: true,
source_kind: MARKET_SOURCE_SYNTHETIC,
source_venue: EXTERNAL_MARKET_VENUE,
source_mode: EXTERNAL_MARKET_MODE,
});
}

return candles;
}

function buildSourceMeta({ launch = {}, stats = {}, trades = [], candles = [], syntheticCandlesUsed = false }) {
const phase = buildPhaseMeta(launch);
const marketEnabled = phase.market_enabled;
const hasTrades = Array.isArray(trades) && trades.length > 0;
const hasCandles = Array.isArray(candles) && candles.length > 0;
const hasPrice = toNumber(stats.price_sol ?? stats.price, 0) > 0;
const hasLiquidity = toNumber(stats.liquidity_sol ?? stats.liquidity, 0) > 0;

let chartSource = MARKET_SOURCE_PRELIVE;
let tradeSource = MARKET_SOURCE_PRELIVE;
let priceSource = MARKET_SOURCE_PRELIVE;
let liquiditySource = MARKET_SOURCE_PRELIVE;
let volumeSource = MARKET_SOURCE_PRELIVE;
let externalSyncStatus = "prelive_hidden";
let marketSyncWarning = "Market data is intentionally hidden until the launch is live.";

if (marketEnabled) {
tradeSource = hasTrades ? MARKET_SOURCE_INTERNAL_LEGACY : MARKET_SOURCE_UNAVAILABLE;
chartSource = hasCandles
? syntheticCandlesUsed
? MARKET_SOURCE_SYNTHETIC
: hasTrades
? MARKET_SOURCE_INTERNAL_LEGACY
: MARKET_SOURCE_SYNTHETIC
: MARKET_SOURCE_UNAVAILABLE;

priceSource = hasTrades
? `${MARKET_SOURCE_INTERNAL_LEGACY}_trades`
: hasPrice
? MARKET_SOURCE_LAUNCH_POOL
: MARKET_SOURCE_UNAVAILABLE;

liquiditySource = hasLiquidity ? MARKET_SOURCE_LAUNCH_POOL : MARKET_SOURCE_UNAVAILABLE;
volumeSource = hasTrades ? `${MARKET_SOURCE_INTERNAL_LEGACY}_trades` : MARKET_SOURCE_UNAVAILABLE;

if (hasTrades) {
externalSyncStatus = "legacy_internal_only";
marketSyncWarning =
"External venue execution is enabled, but chart candles and tape are still sourced from legacy internal records until dedicated external sync is available.";
} else if (syntheticCandlesUsed || hasPrice || hasLiquidity) {
externalSyncStatus = "synthetic_fallback";
marketSyncWarning =
"External venue execution is enabled, but live candles are currently synthetic fallback rows built from launch / pool truth until external trade sync is available.";
} else {
externalSyncStatus = "unavailable";
marketSyncWarning =
"External venue execution is enabled, but no trusted external market sync is currently available for charting or tape.";
}
}

return {
external_market_venue: EXTERNAL_MARKET_VENUE,
external_market_mode: EXTERNAL_MARKET_MODE,
chart_source: chartSource,
trade_source: tradeSource,
price_source: priceSource,
liquidity_source: liquiditySource,
volume_source: volumeSource,
external_sync_status: externalSyncStatus,
market_sync_warning: marketSyncWarning,
last_trade_at: marketEnabled ? getLastTradeAt(trades) : null,
last_candle_at: marketEnabled ? getLastCandleAt(candles) : null,
chart_is_synthetic: Boolean(syntheticCandlesUsed),
};
}

function getPublicMintAddress(row = {}, publicCaVisible = false) {
if (!publicCaVisible) return null;

return (
choosePreferredString(
row.token_mint_address,
row.mint_address,
row.token_mint,
row.contract_address,
row.mint
) || null
);
}

function buildAllocationSummary(row = {}, launchResult = null) {
const result = launchResult && typeof launchResult === "object" ? launchResult : {};

const totalSupply = toInt(result.totalSupply ?? row.final_supply ?? row.supply, 0);
const finalSupply = toInt(result.finalSupply ?? row.final_supply ?? row.supply, 0);

const participantMaxPct = toNumber(result.participantMaxPct ?? row.participants_pct, 45);

const participantDistributedTotal = toInt(result.participantDistributedTotal, 0);

const unusedParticipantTokensBurned = toInt(
result.unusedParticipantTokensBurned ??
result.unsoldParticipantTokensBurned ??
row.unsold_participant_tokens_burned,
0
);

const liquidityPct = toNumber(result.liquidityPct ?? row.liquidity_pct, 20);
const liquidityTokenAllocation = toInt(
result.liquidityTokenAllocation ?? result.internalPoolTokens ?? row.internal_pool_tokens,
0
);

const liquiditySolAllocation = toNumber(
result.liquiditySolAllocation ?? result.internalPoolSol ?? row.internal_pool_sol,
0
);

const reserveTokens = toInt(result.reserveTokens, 0);
const builderTokens = toInt(result.builderTokens, 0);
const teamTokens = toInt(result.teamTokens, 0);

return {
total_supply: totalSupply,
final_supply: finalSupply,

participant_max_pct: participantMaxPct,
participant_distributed_tokens: participantDistributedTotal,
participant_unused_burned_tokens: unusedParticipantTokensBurned,

liquidity_pct: liquidityPct,
liquidity_tokens: liquidityTokenAllocation,
liquidity_sol: liquiditySolAllocation,

reserve_pct: toNumber(row.reserve_pct, 30),
reserve_tokens: reserveTokens,

builder_pct: toNumber(row.builder_pct, BUILDER_MAX_ALLOCATION_PERCENT),
builder_tokens: builderTokens,

team_allocation_pct: toNumber(row.team_allocation_pct, 0),
team_tokens: teamTokens,

participant_vesting: {
unlockPctAtLaunch: 100,
vestingDays: 0,
label: PARTICIPANT_UNLOCK_LABEL,
},
builder_vesting: {
unlockPctAtLaunch: 0,
cliffDays: BUILDER_CLIFF_DAYS,
vestingDays: BUILDER_VESTING_DAYS,
unlockDays: BUILDER_UNLOCK_DAYS,
totalAllocationPct: BUILDER_MAX_ALLOCATION_PERCENT,
dailyUnlockPct: BUILDER_DAILY_UNLOCK_PERCENT,
label: BUILDER_VESTING_RULE,
},
team_vesting: {
unlockPctAtLaunch: 0,
cliffDays: TEAM_CLIFF_DAYS,
vestingDays: TEAM_VESTING_DAYS,
label: "0% unlocked at live, 14 day cliff, then linear vesting over 180 days.",
},
reserve_policy: result.reservePolicy || null,
};
}

function pickLaunchRow(row) {
if (!row) return null;

const status = computeLaunchPhase(row);
const publicCaVisible = shouldRevealContractAddress(status);

const poolSolReserve = toNumber(row.sol_reserve, 0);
const launchInternalPoolSol = toNumber(row.internal_pool_sol, 0);
const launchLiquidity = toNumber(row.liquidity, 0);
const poolTokenReserve = toNumber(row.token_reserve, 0);
const launchInternalPoolTokens = toNumber(row.internal_pool_tokens, 0);

const oneSidedLiquiditySol = publicCaVisible
? poolSolReserve > 0
? poolSolReserve
: launchInternalPoolSol > 0
? launchInternalPoolSol
: launchLiquidity > 0
? launchLiquidity
: 0
: 0;

const mintAddress = getPublicMintAddress(row, publicCaVisible);
const contractAddress = publicCaVisible
? cleanText(row.contract_address, 120) || mintAddress
: null;

const marketBootstrapped = hasBootstrappedMarketSignal(row);
const lifecycleGraduated = toInt(row.lifecycle_graduated, 0) === 1;
const parsedLaunchResult = publicCaVisible ? parseJsonMaybe(row.launch_result_json, null) : null;

return {
id: row.id,
name: row.token_name,
token_name: row.token_name,
symbol: row.symbol,
template: normalizeTemplate(row.template),
launch_type: row.launch_type,
status,
raw_status: normalizeLaunchStatus(row.status) || "commit",
phase: buildPhaseMeta({ status }),
market_bootstrapped: publicCaVisible ? marketBootstrapped : false,
external_market_venue: EXTERNAL_MARKET_VENUE,
external_market_mode: EXTERNAL_MARKET_MODE,

description: cleanText(row.description, 5000),
image_url: cleanText(row.image_url, 1000),

contract_address: contractAddress,
mint_address: mintAddress,
token_mint: mintAddress,
mint: mintAddress,

reserved_mint_address: null,
reserved_mint_public_key: null,
reserved_mint_secret: null,
reserved_mint_private_key: null,
reserved_mint_keypair: null,

mint_reservation_status: publicCaVisible
? cleanText(row.mint_reservation_status, 64).toLowerCase() || null
: null,
mint_finalized_at: publicCaVisible ? row.mint_finalized_at || null : null,

builder_wallet: cleanText(row.builder_wallet, 120) || null,
builder_alias: cleanText(row.builder_alias, 120) || null,
builder_score: toNumber(row.builder_score, 0),

supply: toNumber(row.supply, 0),
final_supply: toNumber(row.final_supply || row.supply, 0),
total_supply: toNumber(row.final_supply || row.supply, 0),
circulating_supply: publicCaVisible ? toNumber(row.circulating_supply, 0) : 0,

liquidity: oneSidedLiquiditySol,
liquidity_sol: oneSidedLiquiditySol,
internal_pool_sol: publicCaVisible ? launchInternalPoolSol : 0,
internal_pool_tokens: publicCaVisible
? poolTokenReserve > 0
? poolTokenReserve
: launchInternalPoolTokens
: 0,
liquidity_usd: publicCaVisible ? toNumber(row.liquidity_usd, 0) : 0,
current_liquidity_usd: publicCaVisible ? toNumber(row.current_liquidity_usd, 0) : 0,
sol_usd_price: publicCaVisible ? toNumber(row.sol_usd_price, 0) : 0,
price: publicCaVisible ? toNumber(row.price, 0) : 0,
price_sol: publicCaVisible ? toNumber(row.price, 0) : 0,
price_usd: publicCaVisible ? toNumber(row.price_usd, 0) : 0,
market_cap: publicCaVisible ? toNumber(row.market_cap, 0) : 0,
market_cap_sol: publicCaVisible ? toNumber(row.market_cap, 0) : 0,
market_cap_usd: publicCaVisible ? toNumber(row.market_cap_usd, 0) : 0,
volume_24h: publicCaVisible ? toNumber(row.volume_24h, 0) : 0,
volume_24h_sol: publicCaVisible ? toNumber(row.volume_24h, 0) : 0,
volume_24h_usd: publicCaVisible ? toNumber(row.volume_24h_usd, 0) : 0,

website_url: cleanText(row.website_url, 500),
x_url: cleanText(row.x_url, 500),
telegram_url: cleanText(row.telegram_url, 500),
discord_url: cleanText(row.discord_url, 500),

committed_sol: toNumber(row.committed_sol, 0),
participant_count: toNumber(row.participants_count, 0),
participants_count: toNumber(row.participants_count, 0),
hard_cap_sol: toNumber(row.hard_cap_sol, 0),
min_raise_sol: toNumber(row.min_raise_sol, 0),

liquidity_pct: toNumber(row.liquidity_pct, 20),
participants_pct: toNumber(row.participants_pct, 45),
reserve_pct: toNumber(row.reserve_pct, 30),
builder_pct: toNumber(row.builder_pct, BUILDER_MAX_ALLOCATION_PERCENT),
team_allocation_pct: toNumber(row.team_allocation_pct, 0),
team_wallets: Array.isArray(row.team_wallets)
? row.team_wallets
: parseJsonMaybe(row.team_wallets, []),
team_wallet_breakdown: Array.isArray(row.team_wallet_breakdown)
? row.team_wallet_breakdown
: parseJsonMaybe(row.team_wallet_breakdown, []),

countdown_started_at: row.countdown_started_at || null,
countdown_ends_at: row.countdown_ends_at || null,
live_at: row.live_at || null,
commit_started_at: row.commit_started_at || null,
commit_ends_at: row.commit_ends_at || null,
created_at: row.created_at || null,
updated_at: row.updated_at || null,

launch_result_json: parsedLaunchResult,
allocation_summary: publicCaVisible ? buildAllocationSummary(row, parsedLaunchResult) : null,

lifecycle: publicCaVisible
? {
launch_status: status,
internal_sol_reserve: toNumber(row.lifecycle_internal_sol_reserve, 0),
internal_token_reserve: toInt(row.lifecycle_internal_token_reserve, 0),
implied_marketcap_sol: toNumber(row.lifecycle_implied_marketcap_sol, 0),
graduation_status: cleanText(row.lifecycle_graduation_status, 120) || "internal_live",
surge_status: cleanText(row.lifecycle_graduation_status, 120) || "internal_live",
graduated: lifecycleGraduated,
graduation_reason: cleanText(row.lifecycle_graduation_reason, 200) || null,
graduated_at: row.lifecycle_graduated_at || null,
raydium_target_pct: toNumber(row.lifecycle_raydium_target_pct, 50),
mss_locked_target_pct: toNumber(row.lifecycle_mss_locked_target_pct, 50),
raydium_pool_id: cleanText(row.lifecycle_raydium_pool_id, 200) || null,
raydium_sol_migrated: toNumber(row.lifecycle_raydium_sol_migrated, 0),
raydium_token_migrated: toInt(row.lifecycle_raydium_token_migrated, 0),
raydium_lp_tokens: cleanText(row.lifecycle_raydium_lp_tokens, 200) || null,
raydium_migration_tx: cleanText(row.lifecycle_raydium_migration_tx, 300) || null,
mss_locked_sol: toNumber(row.lifecycle_mss_locked_sol, 0),
mss_locked_token: toInt(row.lifecycle_mss_locked_token, 0),
mss_locked_lp_amount: cleanText(row.lifecycle_mss_locked_lp_amount, 200) || null,
lock_status: cleanText(row.lifecycle_lock_status, 120) || "not_locked",
lock_tx: cleanText(row.lifecycle_lock_tx, 300) || null,
lock_expires_at: row.lifecycle_lock_expires_at || null,
market_bootstrapped: marketBootstrapped,
external_market_venue: EXTERNAL_MARKET_VENUE,
external_market_mode: EXTERNAL_MARKET_MODE,
}
: null,

builder_vesting: publicCaVisible
? {
builder_wallet: cleanText(row.vesting_builder_wallet, 120) || null,
total_allocation: toInt(row.vesting_total_allocation, 0),
daily_unlock: toInt(row.vesting_daily_unlock, 0),
unlocked_amount: toInt(row.vesting_unlocked_amount, 0),
locked_amount: toInt(row.vesting_locked_amount, 0),
vesting_start_at: row.vesting_start_at || null,
created_at: row.vesting_created_at || null,
updated_at: row.vesting_updated_at || null,
total_allocation_pct: BUILDER_MAX_ALLOCATION_PERCENT,
daily_unlock_pct: BUILDER_DAILY_UNLOCK_PERCENT,
unlock_days: BUILDER_UNLOCK_DAYS,
vesting_days: BUILDER_VESTING_DAYS,
cliff_days: BUILDER_CLIFF_DAYS,
rule: BUILDER_VESTING_RULE,
}
: null,
};
}

function pickTokenRow(row) {
if (!row) return null;

const mintAddress = cleanText(row.mint_address, 120) || null;

return {
id: row.id,
launch_id: row.launch_id,
name: row.name,
symbol: row.symbol,
ticker: row.symbol,
supply: toNumber(row.supply, 0),
mint_address: mintAddress,
mint: mintAddress,
token_mint: mintAddress,
contract_address: mintAddress,
created_at: row.created_at || null,
};
}

function maskTokenForLaunch(token = null, launch = null) {
if (!token) return null;

if (!isMarketEnabledLaunch(launch)) {
return {
...token,
mint_address: null,
mint: null,
token_mint: null,
contract_address: null,
reserved_mint_address: null,
reserved_mint_public_key: null,
reserved_mint_secret: null,
reserved_mint_private_key: null,
reserved_mint_keypair: null,
};
}

return {
...token,
reserved_mint_address: null,
reserved_mint_public_key: null,
reserved_mint_secret: null,
reserved_mint_private_key: null,
reserved_mint_keypair: null,
};
}

function pickPoolRow(row) {
if (!row) return null;

return {
id: row.id,
launch_id: row.launch_id,
status: row.status || null,
token_reserve: toNumber(row.token_reserve, 0),
sol_reserve: toNumber(row.sol_reserve, 0),
k_value: toNumber(row.k_value, 0),
initial_token_reserve: toNumber(row.initial_token_reserve, 0),
created_at: row.created_at || null,
source_kind: MARKET_SOURCE_LAUNCH_POOL,
external_market_venue: EXTERNAL_MARKET_VENUE,
external_market_mode: EXTERNAL_MARKET_MODE,
};
}

function maskPoolForLaunch(pool = null, launch = null) {
if (!pool || !isMarketEnabledLaunch(launch)) return null;
return pool;
}

function normalizeTradeRow(row) {
const solAmount = toNumber(row.sol_amount, 0);
const tokenAmount = toNumber(row.token_amount, 0);
const explicitPrice = toNumber(row.price, 0);
const derivedPrice = tokenAmount > 0 ? solAmount / tokenAmount : 0;
const executionPrice = explicitPrice > 0 ? explicitPrice : derivedPrice;

return {
id: row.id,
launch_id: row.launch_id,
token_id: row.token_id,
wallet: cleanText(row.wallet, 120),
side: String(row.side || "").toLowerCase() === "sell" ? "sell" : "buy",
price_sol: executionPrice,
price: executionPrice,
token_amount: tokenAmount,
base_amount: solAmount,
sol_amount: solAmount,
timestamp: row.created_at,
created_at: row.created_at,
source_kind: MARKET_SOURCE_INTERNAL_LEGACY,
is_external_execution: false,
external_market_venue: EXTERNAL_MARKET_VENUE,
external_market_mode: EXTERNAL_MARKET_MODE,
};
}

async function getTokenByLaunchId(db, launchId) {
const hasTokens = await tableExists(db, "tokens");
if (!hasTokens) return null;

const row = await db.get(
`
SELECT *
FROM tokens
WHERE launch_id = ?
ORDER BY id DESC
LIMIT 1
`,
[launchId]
);

return pickTokenRow(row);
}

async function getPoolByLaunchId(db, launchId) {
const hasPools = await tableExists(db, "pools");
if (!hasPools) return null;

const row = await db.get(
`
SELECT *
FROM pools
WHERE launch_id = ?
AND LOWER(COALESCE(status, 'active')) IN ('active', 'live', 'internal_live')
ORDER BY id DESC
LIMIT 1
`,
[launchId]
);

return pickPoolRow(row);
}

async function getLaunchById(db, launchId) {
const hasLaunches = await tableExists(db, "launches");
if (!hasLaunches) return null;

const launchRow = await db.get(
`
SELECT *
FROM launches
WHERE id = ?
LIMIT 1
`,
[launchId]
);

if (!launchRow) return null;

const [token, pool, hasBuilders, hasLifecycle, hasBuilderVesting] = await Promise.all([
getTokenByLaunchId(db, launchId),
getPoolByLaunchId(db, launchId),
tableExists(db, "builders"),
tableExists(db, "launch_liquidity_lifecycle"),
tableExists(db, "builder_vesting"),
]);

let builderRow = null;
if (launchRow.builder_id && hasBuilders) {
builderRow = await db.get(
`
SELECT *
FROM builders
WHERE id = ?
LIMIT 1
`,
[launchRow.builder_id]
);
}

let lifecycleRow = null;
if (hasLifecycle) {
lifecycleRow = await db.get(
`
SELECT *
FROM launch_liquidity_lifecycle
WHERE launch_id = ?
LIMIT 1
`,
[launchId]
);
}

let vestingRow = null;
if (hasBuilderVesting) {
vestingRow = await db.get(
`
SELECT *
FROM builder_vesting
WHERE launch_id = ?
LIMIT 1
`,
[launchId]
);
}

const merged = {
...launchRow,

builder_wallet:
cleanText(launchRow.builder_wallet, 120) ||
cleanText(builderRow?.wallet, 120) ||
null,
builder_alias:
cleanText(launchRow.builder_alias, 120) ||
cleanText(builderRow?.alias, 120) ||
null,
builder_score: builderRow?.builder_score ?? launchRow?.builder_score ?? 0,

token_id: token?.id || null,
pool_id: pool?.id || null,
sol_reserve: pool?.sol_reserve ?? 0,
token_reserve: pool?.token_reserve ?? 0,
token_mint_address: token?.mint_address || null,

lifecycle_internal_sol_reserve: lifecycleRow?.internal_sol_reserve,
lifecycle_internal_token_reserve: lifecycleRow?.internal_token_reserve,
lifecycle_implied_marketcap_sol: lifecycleRow?.implied_marketcap_sol,
lifecycle_graduation_status: lifecycleRow?.graduation_status,
lifecycle_graduated: lifecycleRow?.graduated,
lifecycle_graduation_reason: lifecycleRow?.graduation_reason,
lifecycle_graduated_at: lifecycleRow?.graduated_at,
lifecycle_raydium_target_pct: lifecycleRow?.raydium_target_pct,
lifecycle_mss_locked_target_pct: lifecycleRow?.mss_locked_target_pct,
lifecycle_raydium_pool_id: lifecycleRow?.raydium_pool_id,
lifecycle_raydium_sol_migrated: lifecycleRow?.raydium_sol_migrated,
lifecycle_raydium_token_migrated: lifecycleRow?.raydium_token_migrated,
lifecycle_raydium_lp_tokens: lifecycleRow?.raydium_lp_tokens,
lifecycle_raydium_migration_tx: lifecycleRow?.raydium_migration_tx,
lifecycle_mss_locked_sol: lifecycleRow?.mss_locked_sol,
lifecycle_mss_locked_token: lifecycleRow?.mss_locked_token,
lifecycle_mss_locked_lp_amount: lifecycleRow?.mss_locked_lp_amount,
lifecycle_lock_status: lifecycleRow?.lock_status,
lifecycle_lock_tx: lifecycleRow?.lock_tx,
lifecycle_lock_expires_at: lifecycleRow?.lock_expires_at,

vesting_builder_wallet: vestingRow?.builder_wallet,
vesting_total_allocation: vestingRow?.total_allocation,
vesting_daily_unlock: vestingRow?.daily_unlock,
vesting_unlocked_amount: vestingRow?.unlocked_amount,
vesting_locked_amount: vestingRow?.locked_amount,
vesting_start_at: vestingRow?.vesting_start_at,
vesting_created_at: vestingRow?.created_at,
vesting_updated_at: vestingRow?.updated_at,
};

return pickLaunchRow(merged);
}

async function getTradeRows(db, launchId, limit = 2000) {
const hasTrades = await tableExists(db, "trades");
if (!hasTrades) return [];

const rows = await db.all(
`
SELECT *
FROM (
SELECT *
FROM trades
WHERE launch_id = ?
ORDER BY datetime(created_at) DESC, id DESC
LIMIT ?
) recent_trades
ORDER BY datetime(created_at) ASC, id ASC
`,
[launchId, limit]
);

return rows.map(normalizeTradeRow);
}

function getLaunchResultAllocations(launch = {}) {
const result = parseJsonMaybe(launch?.launch_result_json, null) || {};
const participantRows = Array.isArray(result.allocations) ? result.allocations : [];
const systemRows = Array.isArray(result.systemAllocations)
? result.systemAllocations
: [];

return [...participantRows, ...systemRows];
}

function getAllocationTypeFromRow(row = {}, fallback = "") {
return normalizeAllocationType(
row?.allocation_type ||
row?.allocationType ||
row?.type ||
row?.role ||
row?.bucket ||
fallback
);
}

function hydrateAllocationWithLaunchResult(launch, allocation = {}) {
const walletKey = normalizeWallet(allocation.wallet);
const type = getAllocationTypeFromRow(allocation);

const resultRows = getLaunchResultAllocations(launch);
const fromResult = resultRows.find((row) => {
const rowWallet = normalizeWallet(row?.wallet);
const rowType = getAllocationTypeFromRow(
row,
type === "participant" ? "participant" : ""
);

return rowWallet === walletKey && rowType === type;
});

return {
...(fromResult || {}),
...allocation,
wallet: allocation.wallet || fromResult?.wallet || "",
allocation_type: type || getAllocationTypeFromRow(fromResult) || "",
token_amount: toInt(
allocation.token_amount ??
allocation.tokenAmount ??
allocation.tokens ??
allocation.amount ??
fromResult?.token_amount ??
fromResult?.tokenAmount ??
fromResult?.tokens ??
fromResult?.amount,
0
),
};
}

async function getAllocationForWallet(db, launchId, launch, wallet, type) {
const walletKey = normalizeWallet(wallet);
const allocationType = normalizeAllocationType(type);
if (!walletKey || !allocationType) return null;

const resultRows = getLaunchResultAllocations(launch);
const fromResult = resultRows.find((row) => {
const rowWallet = normalizeWallet(row?.wallet);
const rowType = getAllocationTypeFromRow(
row,
allocationType === "participant" ? "participant" : ""
);

return rowWallet === walletKey && rowType === allocationType;
});

if (fromResult) {
return {
...fromResult,
allocation_type: allocationType,
token_amount: toInt(
fromResult.token_amount ??
fromResult.tokenAmount ??
fromResult.tokens ??
fromResult.amount,
0
),
};
}

if (!(await tableExists(db, "allocations"))) return null;

const row = await db.get(
`
SELECT *
FROM allocations
WHERE launch_id = ?
AND LOWER(wallet) = LOWER(?)
AND LOWER(allocation_type) = LOWER(?)
ORDER BY id ASC
LIMIT 1
`,
[launchId, cleanText(wallet, 120), allocationType]
);

if (!row) return null;

return hydrateAllocationWithLaunchResult(launch, row);
}

async function getAllocationsForCirculatingSupply(db, launchId, launch) {
if (!(await tableExists(db, "allocations"))) {
return getLaunchResultAllocations(launch).map((row) => ({
...row,
allocation_type: getAllocationTypeFromRow(row, "participant"),
token_amount: toInt(
row.token_amount ?? row.tokenAmount ?? row.tokens ?? row.amount,
0
),
}));
}

const rows = await db.all(
`
SELECT wallet, allocation_type, token_amount
FROM allocations
WHERE launch_id = ?
ORDER BY id ASC
`,
[launchId]
);

return rows.map((row) => hydrateAllocationWithLaunchResult(launch, row));
}

function computeLinearVesting({
totalAllocation,
launch,
unlockPctAtLaunch = 0,
cliffDays = 0,
vestingDays = 0,
startAt = null,
}) {
const total = toInt(totalAllocation, 0);
if (total <= 0) {
return {
unlockedAllocation: 0,
lockedAllocation: 0,
percentUnlocked: 0,
elapsedDays: 0,
};
}

const startMs = parseDbTime(
startAt || launch?.live_at || launch?.updated_at || launch?.created_at
);
const elapsedMs = Number.isFinite(startMs) ? Math.max(0, Date.now() - startMs) : 0;
const elapsedDays = Number.isFinite(startMs) ? Math.floor(elapsedMs / MS_PER_DAY) : 0;

const initialUnlocked = toInt((total * clamp(unlockPctAtLaunch, 0, 100)) / 100, 0);
const lockedAtLaunch = Math.max(0, total - initialUnlocked);

const cliffMs = Math.max(0, cliffDays) * MS_PER_DAY;
const vestingMs = Math.max(0, vestingDays) * MS_PER_DAY;

let vestedFromLocked = 0;

if (elapsedMs >= cliffMs) {
if (vestingMs <= 0) {
vestedFromLocked = lockedAtLaunch;
} else {
vestedFromLocked = toInt(
lockedAtLaunch * Math.min(1, (elapsedMs - cliffMs) / vestingMs),
0
);
}
}

const unlockedAllocation = Math.max(0, Math.min(total, initialUnlocked + vestedFromLocked));
const lockedAllocation = Math.max(0, total - unlockedAllocation);

return {
unlockedAllocation,
lockedAllocation,
percentUnlocked: total > 0 ? clamp((unlockedAllocation / total) * 100, 0, 100) : 0,
elapsedDays,
};
}

function computeParticipantWalletVesting({ allocation, visibleTotalBalance }) {
const totalAllocation = toInt(allocation?.token_amount, 0);
const visibleTotal = toInt(visibleTotalBalance, 0);

if (totalAllocation <= 0) {
return null;
}

const visible = Math.max(0, visibleTotal);

return {
is_participant_wallet: true,
participant_vesting_active: false,
participant_total_allocation_tokens: totalAllocation,
participant_unlocked_tokens: totalAllocation,
participant_locked_tokens: 0,
participant_sellable_tokens: totalAllocation,
participant_vesting_percent_unlocked: 100,
participant_vesting_days_live: 0,
participant_vesting_days: 0,
participant_vesting_label: PARTICIPANT_UNLOCK_LABEL,

visible_total_tokens: visible,
unlocked_tokens: visible,
locked_tokens: 0,
sellable_tokens: visible,
vesting_active: false,
};
}

function computeTeamWalletVesting({ launch, allocation, visibleTotalBalance }) {
const totalAllocation = toInt(allocation?.token_amount, 0);
const visibleTotal = toInt(visibleTotalBalance, 0);

if (totalAllocation <= 0) {
return null;
}

const vesting = computeLinearVesting({
totalAllocation,
launch,
unlockPctAtLaunch: 0,
cliffDays: TEAM_CLIFF_DAYS,
vestingDays: TEAM_VESTING_DAYS,
});

const visible = Math.max(0, visibleTotal);
const visibleLocked = Math.max(0, Math.min(visible, vesting.lockedAllocation));
const sellable = Math.max(0, visible - visibleLocked);

return {
is_team_wallet: true,
team_vesting_active: visibleLocked > 0,
team_total_allocation_tokens: totalAllocation,
team_unlocked_tokens: Math.max(0, Math.min(totalAllocation, vesting.unlockedAllocation)),
team_locked_tokens: Math.max(0, Math.min(totalAllocation, vesting.lockedAllocation)),
team_sellable_tokens: Math.max(0, Math.min(totalAllocation, vesting.unlockedAllocation)),
team_vesting_percent_unlocked: vesting.percentUnlocked,
team_vesting_days_live: vesting.elapsedDays,
team_cliff_days: TEAM_CLIFF_DAYS,
team_vesting_days: TEAM_VESTING_DAYS,

visible_total_tokens: visible,
unlocked_tokens: sellable,
locked_tokens: visibleLocked,
sellable_tokens: sellable,
vesting_active: visibleLocked > 0,
};
}

function getBuilderAllocationPercent(launch = {}) {
const builderPct = toNumber(launch?.builder_pct, 0);
if (builderPct > 0) return Math.min(builderPct, BUILDER_MAX_ALLOCATION_PERCENT);
return BUILDER_MAX_ALLOCATION_PERCENT;
}

function getBuilderDailyUnlockTokens(totalSupply, totalAllocation, storedVesting = null) {
const fromTotalSupply = toInt((toNumber(totalSupply, 0) * BUILDER_DAILY_UNLOCK_PERCENT) / 100, 0);
const fromAllocation = toInt(toNumber(totalAllocation, 0) / BUILDER_UNLOCK_DAYS, 0);
const fromStored = toInt(storedVesting?.daily_unlock ?? storedVesting?.dailyUnlock, 0);

return Math.max(fromTotalSupply, fromAllocation, fromStored);
}

function resolveBuilderVestingStartAt(launch = {}, storedVesting = null) {
const storedStart = storedVesting?.vesting_start_at || storedVesting?.vestingStartAt || null;

if (storedStart) return storedStart;
if (launch?.live_at) return launch.live_at;

const status = normalizeLaunchStatus(launch?.status);
if (status === "live" || status === "graduated") {
return launch?.updated_at || launch?.created_at || null;
}

return null;
}

function computeBuilderDailyVesting({ totalAllocation, dailyUnlock, vestingStartAt }) {
const total = toInt(totalAllocation, 0);
const daily = toInt(dailyUnlock, 0);
const startMs = parseDbTime(vestingStartAt);

if (total <= 0 || daily <= 0) {
return {
unlockedAllocation: 0,
lockedAllocation: total,
percentUnlocked: 0,
elapsedDays: 0,
vestedDays: 0,
};
}

if (!Number.isFinite(startMs) || Date.now() < startMs) {
return {
unlockedAllocation: 0,
lockedAllocation: total,
percentUnlocked: 0,
elapsedDays: 0,
vestedDays: 0,
};
}

const elapsedMs = Math.max(0, Date.now() - startMs);
const elapsedDays = Math.floor(elapsedMs / MS_PER_DAY);
const vestedDays = Math.min(BUILDER_UNLOCK_DAYS, elapsedDays);

const unlockedAllocation =
vestedDays >= BUILDER_UNLOCK_DAYS ? total : Math.min(total, daily * vestedDays);

const lockedAllocation = Math.max(0, total - unlockedAllocation);

return {
unlockedAllocation,
lockedAllocation,
percentUnlocked: total > 0 ? clamp((unlockedAllocation / total) * 100, 0, 100) : 0,
elapsedDays,
vestedDays,
};
}

function computeBuilderWalletVesting({
launch,
visibleTotalBalance,
storedVesting = null,
hasWalletBalanceTruth = false,
}) {
const storedVisibleTotal = toInt(visibleTotalBalance, 0);
const totalSupply = toNumber(launch?.final_supply ?? launch?.total_supply ?? launch?.supply, 0);

const allocationPct = getBuilderAllocationPercent(launch);
const fallbackTotalAllocation = toInt((totalSupply * allocationPct) / 100, 0);

const totalAllocation = Math.max(
toInt(storedVesting?.total_allocation ?? storedVesting?.totalAllocation, 0),
toInt(launch?.allocation_summary?.builder_tokens, 0),
fallbackTotalAllocation
);

const dailyUnlock = getBuilderDailyUnlockTokens(totalSupply, totalAllocation, storedVesting);
const vestingStartAt = resolveBuilderVestingStartAt(launch, storedVesting);

const vesting = computeBuilderDailyVesting({
totalAllocation,
dailyUnlock,
vestingStartAt,
});

const visibleTotal = hasWalletBalanceTruth
? Math.max(0, storedVisibleTotal)
: Math.max(storedVisibleTotal, totalAllocation);

const visibleLocked = Math.max(0, Math.min(visibleTotal, vesting.lockedAllocation));
const sellable = Math.max(0, visibleTotal - visibleLocked);

return {
is_builder_wallet: true,
wallet_is_builder: true,
vesting_active: visibleLocked > 0,
wallet_vesting_active: visibleLocked > 0,

builder_total_allocation_tokens: totalAllocation,
builder_unlocked_tokens: sellable,
builder_locked_tokens: visibleLocked,
builder_sellable_tokens: sellable,
builder_visible_total_tokens: visibleTotal,

builder_unlocked_allocation_tokens: vesting.unlockedAllocation,
builder_locked_allocation_tokens: vesting.lockedAllocation,

builder_vesting_percent_unlocked: vesting.percentUnlocked,
builder_vesting_days_live: vesting.elapsedDays,
builder_vested_days: vesting.vestedDays,

builder_daily_unlock_tokens: dailyUnlock,
builder_cliff_days: BUILDER_CLIFF_DAYS,
builder_vesting_days: BUILDER_VESTING_DAYS,
builder_unlock_days: BUILDER_UNLOCK_DAYS,
builder_daily_unlock_pct: BUILDER_DAILY_UNLOCK_PERCENT,
builder_total_allocation_pct: BUILDER_MAX_ALLOCATION_PERCENT,
builder_vesting_start_at: vestingStartAt,
builder_vesting_rule: BUILDER_VESTING_RULE,

visible_total_tokens: visibleTotal,
unlocked_tokens: sellable,
locked_tokens: visibleLocked,
sellable_tokens: sellable,
};
}

function buildFreeWalletSummary({ visibleTotalBalance }) {
const visibleTotal = toInt(visibleTotalBalance, 0);

return {
is_builder_wallet: false,
wallet_is_builder: false,
is_participant_wallet: false,
is_team_wallet: false,
vesting_active: false,
wallet_vesting_active: false,

visible_total_tokens: visibleTotal,
unlocked_tokens: visibleTotal,
locked_tokens: 0,
sellable_tokens: visibleTotal,

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
builder_daily_unlock_pct: BUILDER_DAILY_UNLOCK_PERCENT,
builder_total_allocation_pct: BUILDER_MAX_ALLOCATION_PERCENT,
builder_vesting_start_at: null,
builder_vesting_rule: BUILDER_VESTING_RULE,
};
}

function buildMetadataOnlySummary(base = {}, metadata = {}) {
return {
...base,
...metadata,
visible_total_tokens: 0,
unlocked_tokens: 0,
locked_tokens: 0,
sellable_tokens: 0,
vesting_active: false,
wallet_vesting_active: false,
};
}

async function getWalletBalanceSnapshot(db, launchId, wallet) {
const cleanWalletValue = cleanText(wallet, 120);
if (!cleanWalletValue) return null;

const columnSet = await getWalletBalanceColumns(db);
if (!columnSet.size) return null;

const aliasGroups = {
tokenBalance: ["token_amount", "balance_tokens", "token_balance", "wallet_balance_tokens"],
totalBalance: ["total_balance", "total_balance_tokens", "wallet_total_balance"],
visibleTotalBalance: [
"visible_total_balance",
"visible_total_tokens",
"wallet_visible_total_balance",
"builder_visible_total_tokens",
],
unlockedBalance: ["unlocked_balance", "unlocked_token_balance", "wallet_unlocked_balance"],
lockedBalance: ["locked_balance", "locked_token_balance", "wallet_locked_balance"],
sellableBalance: ["sellable_balance", "sellable_token_balance", "wallet_sellable_balance"],
solBalance: ["sol_balance", "wallet_sol_balance"],
};

const foundAliases = {};
const selectParts = [];

for (const [alias, names] of Object.entries(aliasGroups)) {
const found = names.find((name) => columnSet.has(name));
foundAliases[alias] = found || null;

if (found) {
selectParts.push(`${found} AS ${alias}`);
}
}

if (!selectParts.length) return null;

const row = await db.get(
`
SELECT ${selectParts.join(", ")}
FROM wallet_balances
WHERE launch_id = ? AND LOWER(wallet) = LOWER(?)
ORDER BY id DESC
LIMIT 1
`,
[launchId, cleanWalletValue]
);

if (!row) return null;

return {
tokenBalance: chooseFirstFinite(row.tokenBalance, 0) ?? 0,
totalBalance: chooseFirstFinite(row.totalBalance, row.tokenBalance, 0),
visibleTotalBalance: chooseFirstFinite(row.visibleTotalBalance, row.totalBalance, row.tokenBalance, 0),
unlockedBalance: chooseFirstFinite(row.unlockedBalance),
lockedBalance: chooseFirstFinite(row.lockedBalance),
sellableBalance: chooseFirstFinite(row.sellableBalance),
solBalance: chooseFirstFinite(row.solBalance),

hasTokenBalanceColumn: Boolean(foundAliases.tokenBalance),
hasTotalBalanceColumn: Boolean(foundAliases.totalBalance),
hasVisibleTotalBalanceColumn: Boolean(foundAliases.visibleTotalBalance),
hasUnlockedBalanceColumn: Boolean(foundAliases.unlockedBalance),
hasLockedBalanceColumn: Boolean(foundAliases.lockedBalance),
hasSellableBalanceColumn: Boolean(foundAliases.sellableBalance),
hasSolBalanceColumn: Boolean(foundAliases.solBalance),
};
}

function getLatestTradePriceSol(trades = []) {
if (!Array.isArray(trades) || !trades.length) return 0;

for (let i = trades.length - 1; i >= 0; i -= 1) {
const trade = trades[i];
const tokenAmount = toNumber(trade?.token_amount, 0);
const price =
toNumber(trade?.price_sol, 0) ||
toNumber(trade?.price, 0) ||
(tokenAmount > 0 ? toNumber(trade?.sol_amount ?? trade?.base_amount, 0) / tokenAmount : 0);

if (price > 0) return price;
}

return 0;
}

function getPoolSpotPriceSol(pool = {}, launch = {}) {
const tokenReserve = toNumber(
pool?.token_reserve ?? launch?.lifecycle?.internal_token_reserve ?? launch?.internal_pool_tokens,
0
);
const solReserve = toNumber(
pool?.sol_reserve ?? launch?.lifecycle?.internal_sol_reserve ?? launch?.internal_pool_sol ?? launch?.liquidity,
0
);

if (tokenReserve <= 0 || solReserve <= 0) return 0;
return solReserve / tokenReserve;
}

function deriveSolUsdPrice({
explicitSolUsd = 0,
priceUsd = 0,
priceSol = 0,
liquidityUsd = 0,
liquiditySol = 0,
marketCapUsd = 0,
marketCapSol = 0,
volumeUsd = 0,
volumeSol = 0,
}) {
const direct = chooseFirstPositive(explicitSolUsd);
if (direct) return direct;

const fromLiquidity = liquidityUsd > 0 && liquiditySol > 0 ? liquidityUsd / liquiditySol : 0;
if (fromLiquidity > 0) return fromLiquidity;

const fromMarketCap = marketCapUsd > 0 && marketCapSol > 0 ? marketCapUsd / marketCapSol : 0;
if (fromMarketCap > 0) return fromMarketCap;

const fromVolume = volumeUsd > 0 && volumeSol > 0 ? volumeUsd / volumeSol : 0;
if (fromVolume > 0) return fromVolume;

const fromPrice = priceUsd > 0 && priceSol > 0 ? priceUsd / priceSol : 0;
if (fromPrice > 0) return fromPrice;

return 0;
}

function buildStatsInput({ launch, token, pool }) {
const totalSupply = toNumber(token?.supply ?? launch?.final_supply ?? launch?.supply, 0);
const circulatingSupply = toNumber(launch?.circulating_supply, 0);
const oneSidedLiquiditySol = toNumber(
pool?.sol_reserve ?? launch?.lifecycle?.internal_sol_reserve ?? launch?.internal_pool_sol ?? launch?.liquidity ?? 0,
0
);
const internalTokenReserve = toNumber(
pool?.token_reserve ?? launch?.lifecycle?.internal_token_reserve ?? launch?.internal_pool_tokens ?? 0,
0
);

return {
...(launch || {}),
mint_address: token?.mint_address || launch?.mint_address || launch?.contract_address || null,
total_supply: totalSupply,
circulating_supply: circulatingSupply,
liquidity: oneSidedLiquiditySol,
liquidity_sol: oneSidedLiquiditySol,
internal_pool_sol: oneSidedLiquiditySol,
internal_pool_tokens: internalTokenReserve,
sol_usd_price: toNumber(launch?.sol_usd_price, 0),
price: toNumber(launch?.price, 0),
price_usd: toNumber(launch?.price_usd, 0),
market_cap: toNumber(launch?.market_cap, 0),
market_cap_usd: toNumber(launch?.market_cap_usd, 0),
volume_24h: toNumber(launch?.volume_24h, 0),
volume_24h_usd: toNumber(launch?.volume_24h_usd, 0),
liquidity_usd: toNumber(launch?.current_liquidity_usd ?? launch?.liquidity_usd, 0),
};
}

function finalizeMarketStats({ stats = {}, launch = {}, token = {}, pool = {}, trades = [] }) {
const finalized = { ...(stats || {}) };

const totalSupply = toNumber(finalized.total_supply ?? token?.supply ?? launch?.final_supply ?? launch?.supply, 0);
const circulatingSupply = toNumber(finalized.circulating_supply ?? launch?.circulating_supply, 0);

const priceSol =
chooseFirstPositive(
finalized.price_sol,
finalized.price,
getLatestTradePriceSol(trades),
getPoolSpotPriceSol(pool, launch),
launch?.price
) || 0;

const oneSidedLiquiditySol =
chooseFirstPositive(
finalized.liquidity_sol,
finalized.liquidity,
pool?.sol_reserve,
launch?.lifecycle?.internal_sol_reserve,
launch?.internal_pool_sol,
launch?.liquidity
) || 0;

const derivedMarketCapSol = priceSol > 0 && circulatingSupply > 0 ? priceSol * circulatingSupply : 0;

const marketCapSol =
chooseFirstPositive(
derivedMarketCapSol,
finalized.market_cap_sol,
finalized.market_cap,
launch?.market_cap
) || 0;

const volume24hSol =
chooseFirstPositive(finalized.volume_24h_sol, finalized.volume_24h, launch?.volume_24h) || 0;

const explicitLiquidityUsd =
chooseFirstPositive(finalized.liquidity_usd, launch?.current_liquidity_usd, launch?.liquidity_usd) || 0;

const explicitMarketCapUsd = chooseFirstPositive(finalized.market_cap_usd, launch?.market_cap_usd) || 0;
const explicitVolumeUsd = chooseFirstPositive(finalized.volume_24h_usd, launch?.volume_24h_usd) || 0;
const explicitPriceUsd = chooseFirstPositive(finalized.price_usd, launch?.price_usd) || 0;

const solUsdPrice = deriveSolUsdPrice({
explicitSolUsd: chooseFirstPositive(finalized.sol_usd_price, launch?.sol_usd_price) || 0,
priceUsd: explicitPriceUsd,
priceSol,
liquidityUsd: explicitLiquidityUsd,
liquiditySol: oneSidedLiquiditySol,
marketCapUsd: explicitMarketCapUsd,
marketCapSol,
volumeUsd: explicitVolumeUsd,
volumeSol: volume24hSol,
});

const resolvedPriceUsd = explicitPriceUsd > 0 ? explicitPriceUsd : solUsdPrice > 0 && priceSol > 0 ? priceSol * solUsdPrice : 0;
const resolvedLiquidityUsd = explicitLiquidityUsd > 0 ? explicitLiquidityUsd : solUsdPrice > 0 && oneSidedLiquiditySol > 0 ? oneSidedLiquiditySol * solUsdPrice : 0;
const resolvedMarketCapUsd = explicitMarketCapUsd > 0 ? explicitMarketCapUsd : solUsdPrice > 0 && marketCapSol > 0 ? marketCapSol * solUsdPrice : 0;
const resolvedVolume24hUsd = explicitVolumeUsd > 0 ? explicitVolumeUsd : solUsdPrice > 0 && volume24hSol > 0 ? volume24hSol * solUsdPrice : 0;

finalized.total_supply = totalSupply;
finalized.circulating_supply = circulatingSupply;

finalized.price_sol = priceSol;
finalized.price = priceSol;
finalized.price_usd = resolvedPriceUsd;

finalized.sol_usd_price = solUsdPrice;

finalized.liquidity = oneSidedLiquiditySol;
finalized.liquidity_sol = oneSidedLiquiditySol;
finalized.liquidity_usd = resolvedLiquidityUsd;

finalized.market_cap = marketCapSol;
finalized.market_cap_sol = marketCapSol;
finalized.market_cap_usd = resolvedMarketCapUsd;

finalized.volume_24h = volume24hSol;
finalized.volume_24h_sol = volume24hSol;
finalized.volume_24h_usd = resolvedVolume24hUsd;

return finalized;
}

async function sumWalletBalanceColumn(db, launchId, columns, aliases = []) {
const column = aliases.find((name) => columns.has(name));
if (!column) return 0;

const row = await db.get(
`
SELECT COALESCE(SUM(${column}), 0) AS total
FROM wallet_balances
WHERE launch_id = ?
`,
[launchId]
);

return toInt(row?.total, 0);
}

async function countWalletBalanceRows(db, launchId) {
if (!(await tableExists(db, "wallet_balances"))) return 0;

const row = await db.get(
`
SELECT COUNT(*) AS total
FROM wallet_balances
WHERE launch_id = ?
`,
[launchId]
);

return toInt(row?.total, 0);
}

async function computeAllocationSellableSupply(db, launchId, launch) {
const allocations = await getAllocationsForCirculatingSupply(db, launchId, launch);

let sellableSupply = 0;

for (const allocation of allocations) {
const type = normalizeAllocationType(allocation.allocation_type);
const tokenAmount = toInt(allocation.token_amount, 0);

if (tokenAmount <= 0) continue;

if (type === "participant") {
const summary = computeParticipantWalletVesting({
allocation,
visibleTotalBalance: tokenAmount,
});

sellableSupply += toInt(summary?.participant_sellable_tokens, 0);
continue;
}

if (type === "builder") {
const summary = computeBuilderWalletVesting({
launch,
visibleTotalBalance: tokenAmount,
storedVesting: launch?.builder_vesting,
hasWalletBalanceTruth: false,
});

sellableSupply += toInt(summary?.builder_sellable_tokens, 0);
continue;
}

if (type === "team") {
const summary = computeTeamWalletVesting({
launch,
allocation,
visibleTotalBalance: tokenAmount,
});

sellableSupply += toInt(summary?.team_sellable_tokens, 0);
}
}

return toInt(sellableSupply, 0);
}

async function computeWalletSellableSupply(db, launchId) {
const columns = await getWalletBalanceColumns(db);
if (!columns.size) return 0;

const sellableSum = await sumWalletBalanceColumn(db, launchId, columns, [
"sellable_balance",
"sellable_token_balance",
"wallet_sellable_balance",
]);

if (sellableSum > 0) return sellableSum;

const unlockedSum = await sumWalletBalanceColumn(db, launchId, columns, [
"unlocked_balance",
"unlocked_token_balance",
"wallet_unlocked_balance",
]);

if (unlockedSum > 0) return unlockedSum;

const tokenAmountSum = await sumWalletBalanceColumn(db, launchId, columns, [
"token_amount",
"balance_tokens",
"token_balance",
"wallet_balance_tokens",
]);

if (tokenAmountSum > 0) return tokenAmountSum;

return 0;
}

async function enrichLaunchRuntimeState({ db, launchId, launch, pool }) {
if (!launch || !isMarketEnabledLaunch(launch)) return launch;

const poolTokenReserve = toInt(
pool?.token_reserve ?? launch?.lifecycle?.internal_token_reserve ?? launch?.internal_pool_tokens,
0
);

const walletBalanceRows = await countWalletBalanceRows(db, launchId);
const walletSellableSupply = await computeWalletSellableSupply(db, launchId);
const allocationSellableSupply = await computeAllocationSellableSupply(db, launchId, launch);

const sellableWalletSupply = walletBalanceRows > 0 ? walletSellableSupply : allocationSellableSupply;
const circulatingSupply = toInt(poolTokenReserve + sellableWalletSupply, 0);

return {
...launch,
circulating_supply: circulatingSupply,
sellable_wallet_supply: sellableWalletSupply,
pool_circulating_supply: poolTokenReserve,
circulating_supply_model: "internal_lp_tokens_plus_sellable_wallet_tokens",
};
}

function attachSourceMetaToStats({ stats = {}, launch = null, trades = [], candles = [], syntheticCandlesUsed = false }) {
return {
...(stats || {}),
...buildSourceMeta({
launch: launch || {},
stats: stats || {},
trades,
candles,
syntheticCandlesUsed,
}),
};
}

function applyMarketGateToStats(stats = {}, launch = null) {
const phase = buildPhaseMeta(launch);
const marketActive = phase.market_enabled;

if (marketActive) {
return {
...(stats || {}),
phase,
market_enabled: true,
can_trade: true,
external_market_venue: EXTERNAL_MARKET_VENUE,
external_market_mode: EXTERNAL_MARKET_MODE,
};
}

return {
...(stats || {}),
phase,
market_enabled: false,
can_trade: false,

external_market_venue: EXTERNAL_MARKET_VENUE,
external_market_mode: EXTERNAL_MARKET_MODE,
chart_source: MARKET_SOURCE_PRELIVE,
trade_source: MARKET_SOURCE_PRELIVE,
price_source: MARKET_SOURCE_PRELIVE,
liquidity_source: MARKET_SOURCE_PRELIVE,
volume_source: MARKET_SOURCE_PRELIVE,
external_sync_status: "prelive_hidden",
market_sync_warning: "Market data is intentionally hidden until the launch is live.",
last_trade_at: null,
last_candle_at: null,
chart_is_synthetic: false,

contract_address: null,
mint_address: null,
token_mint: null,
mint: null,

reserved_mint_address: null,
reserved_mint_public_key: null,
reserved_mint_secret: null,
reserved_mint_private_key: null,
reserved_mint_keypair: null,

circulating_supply: 0,
sol_usd_price: 0,
sol_usd_source: null,
sol_usd_price_updated_at: null,
sol_usd_block_id: null,
sol_usd_price_change_24h: 0,

price: 0,
price_sol: 0,
price_usd: 0,

liquidity: 0,
liquidity_sol: 0,
liquidity_usd: 0,

total_lp_liquidity_sol: 0,
total_lp_liquidity_usd: 0,

market_cap: 0,
market_cap_sol: 0,
market_cap_usd: 0,

fdv: 0,
fdv_sol: 0,
fdv_usd: 0,

volume_24h: 0,
volume_24h_sol: 0,
volume_24h_usd: 0,

buys_24h: 0,
sells_24h: 0,
trades_24h: 0,
tx_count_24h: 0,
trade_count_24h: 0,
trade_count_total: 0,
trades_total: 0,

price_change_pct: 0,
high_24h: 0,
low_24h: 0,
high_24h_sol: 0,
low_24h_sol: 0,
high_24h_usd: 0,
low_24h_usd: 0,

pool_sol_reserve: 0,
pool_token_reserve: 0,
};
}

function emptyWalletSummary() {
return {
token_balance: 0,
tokenBalance: 0,
balance_tokens: 0,
wallet_balance_tokens: 0,

total_balance: 0,
totalBalance: 0,
visible_total_balance: 0,
visibleTotalBalance: 0,

position_value_sol: 0,
positionValueSol: 0,
position_value_usd: 0,
positionValueUsd: 0,

sol_balance: 0,
solBalance: 0,
sol_delta: 0,
solDelta: 0,
walletSolDelta: 0,

sellable_balance: 0,
sellableBalance: 0,
sellable_token_balance: 0,
sellableTokenBalance: 0,

locked_balance: 0,
lockedBalance: 0,
locked_token_balance: 0,
lockedTokenBalance: 0,

unlocked_balance: 0,
unlockedBalance: 0,
unlocked_token_balance: 0,
unlockedTokenBalance: 0,

is_builder_wallet: false,
wallet_is_builder: false,
is_participant_wallet: false,
is_team_wallet: false,
vesting_active: false,
wallet_vesting_active: false,

wallet_source: MARKET_SOURCE_UNAVAILABLE,
wallet_source_kind: MARKET_SOURCE_UNAVAILABLE,
wallet_source_warning:
"Wallet balances are unavailable here until a dedicated external wallet sync is attached to the chart service.",
wallet_position_confidence: "none",

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
builder_daily_unlock_pct: BUILDER_DAILY_UNLOCK_PERCENT,
builder_total_allocation_pct: BUILDER_MAX_ALLOCATION_PERCENT,
builder_vesting_start_at: null,
builder_vesting_rule: BUILDER_VESTING_RULE,
};
}

async function buildWalletSummary({ db, launchId, launch, wallet, priceUsd = 0, priceSol = 0 }) {
const cleanWalletValue = cleanText(wallet, 120);
if (!cleanWalletValue || !isMarketEnabledLaunch(launch)) {
return emptyWalletSummary();
}

const walletSnapshot = await getWalletBalanceSnapshot(db, launchId, cleanWalletValue);

const participantAllocation = await getAllocationForWallet(
db,
launchId,
launch,
cleanWalletValue,
"participant"
);

const teamAllocation = await getAllocationForWallet(
db,
launchId,
launch,
cleanWalletValue,
"team"
);

const builderAllocation = await getAllocationForWallet(
db,
launchId,
launch,
cleanWalletValue,
"builder"
);

const builderWallet = normalizeWallet(launch?.builder_wallet);
const isBuilderWallet = Boolean(builderWallet && normalizeWallet(cleanWalletValue) === builderWallet);

const hasWalletTruth = Boolean(
walletSnapshot &&
(walletSnapshot.hasTokenBalanceColumn ||
walletSnapshot.hasTotalBalanceColumn ||
walletSnapshot.hasVisibleTotalBalanceColumn ||
walletSnapshot.hasUnlockedBalanceColumn ||
walletSnapshot.hasLockedBalanceColumn ||
walletSnapshot.hasSellableBalanceColumn)
);

let walletSource = MARKET_SOURCE_UNAVAILABLE;
let walletSourceKind = MARKET_SOURCE_UNAVAILABLE;
let walletSourceWarning =
"Wallet balances are unavailable here until a dedicated external wallet sync is attached to the chart service.";
let walletPositionConfidence = "none";

let summary = emptyWalletSummary();

if (hasWalletTruth) {
const visibleTotalBalance = toInt(
walletSnapshot?.visibleTotalBalance ?? walletSnapshot?.totalBalance ?? walletSnapshot?.tokenBalance,
0
);

let vestingSummary = null;

if (isBuilderWallet || builderAllocation) {
vestingSummary = computeBuilderWalletVesting({
launch,
visibleTotalBalance,
storedVesting: launch?.builder_vesting,
hasWalletBalanceTruth: true,
});
} else if (teamAllocation) {
vestingSummary = computeTeamWalletVesting({
launch,
allocation: teamAllocation,
visibleTotalBalance,
});
} else if (participantAllocation) {
vestingSummary = computeParticipantWalletVesting({
allocation: participantAllocation,
visibleTotalBalance,
});
} else {
vestingSummary = buildFreeWalletSummary({ visibleTotalBalance });
}

const tokenBalance = toInt(
chooseFirstFinite(
walletSnapshot?.tokenBalance,
walletSnapshot?.visibleTotalBalance,
walletSnapshot?.totalBalance,
vestingSummary.visible_total_tokens,
0
),
0
);

const totalBalance = toInt(
chooseFirstFinite(
walletSnapshot?.totalBalance,
walletSnapshot?.visibleTotalBalance,
tokenBalance,
vestingSummary.visible_total_tokens,
0
),
tokenBalance
);

const visibleTotal = toInt(
chooseFirstFinite(walletSnapshot?.visibleTotalBalance, totalBalance, tokenBalance),
totalBalance
);

const sellableBalance = toInt(
chooseFirstFinite(walletSnapshot?.sellableBalance, vestingSummary.sellable_tokens, tokenBalance),
tokenBalance
);

const unlockedBalance = toInt(
chooseFirstFinite(walletSnapshot?.unlockedBalance, vestingSummary.unlocked_tokens, sellableBalance),
sellableBalance
);

const lockedBalance = toInt(
chooseFirstFinite(
walletSnapshot?.lockedBalance,
vestingSummary.locked_tokens,
Math.max(0, visibleTotal - unlockedBalance)
),
Math.max(0, visibleTotal - unlockedBalance)
);

summary = {
...summary,
...vestingSummary,
token_balance: tokenBalance,
tokenBalance: tokenBalance,
balance_tokens: tokenBalance,
wallet_balance_tokens: tokenBalance,
total_balance: totalBalance,
totalBalance: totalBalance,
visible_total_balance: visibleTotal,
visibleTotalBalance: visibleTotal,
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
sol_balance: toNumber(walletSnapshot?.solBalance, 0),
solBalance: toNumber(walletSnapshot?.solBalance, 0),
sol_delta: 0,
solDelta: 0,
walletSolDelta: 0,
};

walletSource = MARKET_SOURCE_INTERNAL_SNAPSHOT;
walletSourceKind = MARKET_SOURCE_INTERNAL_SNAPSHOT;
walletSourceWarning =
"Wallet balances are being served from stored internal wallet snapshots. External venue trading may not yet be reflected here.";
walletPositionConfidence = isBuilderWallet ? "medium" : "low";
} else if (isBuilderWallet || builderAllocation) {
const vestingSummary = computeBuilderWalletVesting({
launch,
visibleTotalBalance: 0,
storedVesting: launch?.builder_vesting,
hasWalletBalanceTruth: false,
});

summary = {
...summary,
...vestingSummary,
token_balance: toInt(vestingSummary.builder_sellable_tokens, 0),
tokenBalance: toInt(vestingSummary.builder_sellable_tokens, 0),
balance_tokens: toInt(vestingSummary.builder_sellable_tokens, 0),
wallet_balance_tokens: toInt(vestingSummary.builder_sellable_tokens, 0),
total_balance: toInt(vestingSummary.builder_visible_total_tokens, 0),
totalBalance: toInt(vestingSummary.builder_visible_total_tokens, 0),
visible_total_balance: toInt(vestingSummary.builder_visible_total_tokens, 0),
visibleTotalBalance: toInt(vestingSummary.builder_visible_total_tokens, 0),
sellable_balance: toInt(vestingSummary.builder_sellable_tokens, 0),
sellableBalance: toInt(vestingSummary.builder_sellable_tokens, 0),
sellable_token_balance: toInt(vestingSummary.builder_sellable_tokens, 0),
sellableTokenBalance: toInt(vestingSummary.builder_sellable_tokens, 0),
unlocked_balance: toInt(vestingSummary.builder_sellable_tokens, 0),
unlockedBalance: toInt(vestingSummary.builder_sellable_tokens, 0),
unlocked_token_balance: toInt(vestingSummary.builder_sellable_tokens, 0),
unlockedTokenBalance: toInt(vestingSummary.builder_sellable_tokens, 0),
locked_balance: toInt(vestingSummary.builder_locked_tokens, 0),
lockedBalance: toInt(vestingSummary.builder_locked_tokens, 0),
locked_token_balance: toInt(vestingSummary.builder_locked_tokens, 0),
lockedTokenBalance: toInt(vestingSummary.builder_locked_tokens, 0),
sol_balance: 0,
solBalance: 0,
sol_delta: 0,
solDelta: 0,
walletSolDelta: 0,
};

walletSource = MARKET_SOURCE_POLICY_ESTIMATE;
walletSourceKind = MARKET_SOURCE_POLICY_ESTIMATE;
walletSourceWarning =
"Builder balances are shown as policy-driven vesting estimates. They are not confirmed external wallet holdings.";
walletPositionConfidence = "policy_only";
} else if (participantAllocation) {
const participantSummary = computeParticipantWalletVesting({
allocation: participantAllocation,
visibleTotalBalance: 0,
});

summary = buildMetadataOnlySummary(summary, participantSummary || {});
walletSource = MARKET_SOURCE_POLICY_METADATA_ONLY;
walletSourceKind = MARKET_SOURCE_POLICY_METADATA_ONLY;
walletSourceWarning =
"Participant allocation metadata is known, but external wallet holdings are not synced here.";
walletPositionConfidence = "none";
} else if (teamAllocation) {
const teamSummary = computeTeamWalletVesting({
launch,
allocation: teamAllocation,
visibleTotalBalance: 0,
});

summary = buildMetadataOnlySummary(summary, teamSummary || {});
walletSource = MARKET_SOURCE_POLICY_METADATA_ONLY;
walletSourceKind = MARKET_SOURCE_POLICY_METADATA_ONLY;
walletSourceWarning =
"Team allocation metadata is known, but external wallet holdings are not synced here.";
walletPositionConfidence = "none";
}

const visibleForValue = toInt(summary.visible_total_balance ?? summary.total_balance, 0);
const positionValueSol = visibleForValue > 0 && priceSol > 0 ? visibleForValue * priceSol : 0;
const positionValueUsd = visibleForValue > 0 && priceUsd > 0 ? visibleForValue * priceUsd : 0;

summary.position_value_sol = positionValueSol;
summary.positionValueSol = positionValueSol;
summary.position_value_usd = positionValueUsd;
summary.positionValueUsd = positionValueUsd;

summary.wallet_source = walletSource;
summary.wallet_source_kind = walletSourceKind;
summary.wallet_source_warning = walletSourceWarning;
summary.wallet_position_confidence = walletPositionConfidence;
summary.external_market_venue = EXTERNAL_MARKET_VENUE;
summary.external_market_mode = EXTERNAL_MARKET_MODE;

return summary;
}

function attachWalletStats(stats = {}, walletSummary = {}) {
return {
...stats,

wallet_token_balance: walletSummary.token_balance,
wallet_balance_tokens: walletSummary.token_balance,
wallet_total_balance: walletSummary.total_balance,
wallet_visible_total_balance: walletSummary.visible_total_balance ?? walletSummary.total_balance,

wallet_position_value_sol: walletSummary.position_value_sol,
wallet_position_value_usd: walletSummary.position_value_usd,

wallet_sol_balance: walletSummary.sol_balance,
wallet_sol_delta: walletSummary.sol_delta,
walletSolDelta: walletSummary.walletSolDelta ?? walletSummary.sol_delta,

wallet_sellable_balance: walletSummary.sellable_balance,
wallet_sellable_token_balance: walletSummary.sellable_token_balance,
wallet_locked_balance: walletSummary.locked_balance,
wallet_locked_token_balance: walletSummary.locked_token_balance,
wallet_unlocked_balance: walletSummary.unlocked_balance,
wallet_unlocked_token_balance: walletSummary.unlocked_token_balance,

wallet_is_builder: walletSummary.wallet_is_builder,
wallet_vesting_active: walletSummary.wallet_vesting_active,
wallet_source: walletSummary.wallet_source,
wallet_source_kind: walletSummary.wallet_source_kind,
wallet_source_warning: walletSummary.wallet_source_warning,
wallet_position_confidence: walletSummary.wallet_position_confidence,

is_builder_wallet: walletSummary.is_builder_wallet,
is_participant_wallet: walletSummary.is_participant_wallet,
is_team_wallet: walletSummary.is_team_wallet,

participant_total_allocation_tokens: walletSummary.participant_total_allocation_tokens,
participant_unlocked_tokens: walletSummary.participant_unlocked_tokens,
participant_locked_tokens: walletSummary.participant_locked_tokens,
participant_sellable_tokens: walletSummary.participant_sellable_tokens,
participant_vesting_percent_unlocked: walletSummary.participant_vesting_percent_unlocked,
participant_vesting_days_live: walletSummary.participant_vesting_days_live,
participant_vesting_days: walletSummary.participant_vesting_days,
participant_vesting_label: walletSummary.participant_vesting_label,

team_total_allocation_tokens: walletSummary.team_total_allocation_tokens,
team_unlocked_tokens: walletSummary.team_unlocked_tokens,
team_locked_tokens: walletSummary.team_locked_tokens,
team_sellable_tokens: walletSummary.team_sellable_tokens,
team_vesting_percent_unlocked: walletSummary.team_vesting_percent_unlocked,

builder_total_allocation_tokens: walletSummary.builder_total_allocation_tokens,
builder_unlocked_tokens: walletSummary.builder_unlocked_tokens,
builder_locked_tokens: walletSummary.builder_locked_tokens,
builder_sellable_tokens: walletSummary.builder_sellable_tokens,
builder_visible_total_tokens: walletSummary.builder_visible_total_tokens,
builder_unlocked_allocation_tokens: walletSummary.builder_unlocked_allocation_tokens,
builder_locked_allocation_tokens: walletSummary.builder_locked_allocation_tokens,
builder_vesting_percent_unlocked: walletSummary.builder_vesting_percent_unlocked,
builder_vesting_days_live: walletSummary.builder_vesting_days_live,
builder_vested_days: walletSummary.builder_vested_days,
builder_daily_unlock_tokens: walletSummary.builder_daily_unlock_tokens,
builder_cliff_days: walletSummary.builder_cliff_days,
builder_vesting_days: walletSummary.builder_vesting_days,
builder_unlock_days: walletSummary.builder_unlock_days,
builder_daily_unlock_pct: walletSummary.builder_daily_unlock_pct,
builder_total_allocation_pct: walletSummary.builder_total_allocation_pct,
builder_vesting_start_at: walletSummary.builder_vesting_start_at,
builder_vesting_rule: walletSummary.builder_vesting_rule,
};
}

function buildCassiePayload(launch = {}, stats = {}) {
const phase = buildPhaseMeta(launch);
const absMove = Math.abs(toNumber(stats?.price_change_pct, 0));
const buyCount = toNumber(stats?.buys_24h, 0);
const sellCount = toNumber(stats?.sells_24h, 0);
const imbalance = Math.abs(buyCount - sellCount);
const liquiditySol = toNumber(stats?.liquidity_sol ?? stats?.liquidity, 0);
const marketCapSol = toNumber(stats?.market_cap_sol ?? stats?.market_cap, 0);
const trades24h = toNumber(stats?.trades_24h ?? stats?.tx_count_24h, 0);

let riskState = "normal";
let verdict = "Monitoring";

if (!phase.market_enabled) {
riskState = phase.is_failed ? "failed" : "pre-market";
verdict = phase.is_building ? "Bootstrap protected" : "Pre-market";
} else if (liquiditySol <= 0 || marketCapSol <= 0) {
riskState = "incomplete";
verdict = "Market data incomplete";
} else if (absMove >= 40 || imbalance >= 15) {
riskState = "elevated";
verdict = "High activity variance";
} else if (absMove >= 15 || imbalance >= 6) {
riskState = "active";
verdict = "Active market movement";
} else if (trades24h === 0) {
riskState = "quiet";
verdict = "No live trade flow yet";
}

return {
monitoring_active: true,
phase: phase.status,
layer: "market-intelligence",
risk_state: riskState,
verdict,
market_enabled: phase.market_enabled,
can_trade: phase.can_trade,
market_bootstrapped: phase.market_enabled ? Boolean(launch?.market_bootstrapped) : false,
external_market_venue: EXTERNAL_MARKET_VENUE,
external_market_mode: EXTERNAL_MARKET_MODE,
chart_source: stats?.chart_source || MARKET_SOURCE_UNAVAILABLE,
trade_source: stats?.trade_source || MARKET_SOURCE_UNAVAILABLE,
signals: {
price_change_pct: toNumber(stats?.price_change_pct, 0),
buys_24h: buyCount,
sells_24h: sellCount,
trades_24h: trades24h,
trade_imbalance: imbalance,
liquidity_sol: liquiditySol,
market_cap_sol: marketCapSol,
circulating_supply: toNumber(stats?.circulating_supply, 0),
},
};
}

function filterMarketRowsForLaunch({ launch, candles = [], trades = [] }) {
if (!isMarketEnabledLaunch(launch)) {
return {
candles: [],
trades: [],
};
}

return {
candles,
trades,
};
}

async function buildSnapshotBase({ db, launchId, interval = "1m", candleLimit = 120 }) {
let [launch, rawToken, rawPool, trades] = await Promise.all([
getLaunchById(db, launchId),
getTokenByLaunchId(db, launchId),
getPoolByLaunchId(db, launchId),
getTradeRows(db, launchId, 2000),
]);

launch = await enrichLaunchRuntimeState({
db,
launchId,
launch,
pool: rawPool,
});

const builtCandlesFromTrades = fillMissingCandles(
buildCandlesFromTrades(trades, interval),
interval,
candleLimit
);

const baseStats = finalizeMarketStats({
stats: buildMarketStats({
launch: buildStatsInput({ launch, token: rawToken, pool: rawPool }),
trades,
candles: builtCandlesFromTrades,
}),
launch,
token: rawToken,
pool: rawPool,
trades,
});

const syntheticCandles = buildSyntheticCandles({
stats: baseStats,
launch,
interval,
limit: candleLimit,
});

const usingSyntheticCandles =
isMarketEnabledLaunch(launch) && builtCandlesFromTrades.length === 0 && syntheticCandles.length > 0;

const rawCandles = usingSyntheticCandles ? syntheticCandles : builtCandlesFromTrades;

let stats = finalizeMarketStats({
stats: baseStats,
launch,
token: rawToken,
pool: rawPool,
trades,
});

stats = applyMarketGateToStats(stats, launch);
stats = attachSourceMetaToStats({
stats,
launch,
trades,
candles: rawCandles,
syntheticCandlesUsed: usingSyntheticCandles,
});

return {
launch,
rawToken,
rawPool,
trades,
rawCandles,
stats,
source: buildSourceMeta({
launch,
stats,
trades,
candles: rawCandles,
syntheticCandlesUsed: usingSyntheticCandles,
}),
};
}

export async function getChartCandles({ db, launchId, interval = "1m", limit = 120 }) {
const { launch, rawToken, rawPool, trades, rawCandles, stats, source } = await buildSnapshotBase({
db,
launchId,
interval,
candleLimit: limit,
});

const filtered = filterMarketRowsForLaunch({
launch,
candles: rawCandles,
trades,
});

return {
launch,
token: maskTokenForLaunch(rawToken, launch),
pool: maskPoolForLaunch(rawPool, launch),
stats,
candles: filtered.candles,
source,
};
}

export async function getChartTrades({ db, launchId, limit = 50 }) {
let [launch, rawToken, rawPool, trades] = await Promise.all([
getLaunchById(db, launchId),
getTokenByLaunchId(db, launchId),
getPoolByLaunchId(db, launchId),
getTradeRows(db, launchId, Math.max(limit, 1)),
]);

launch = await enrichLaunchRuntimeState({
db,
launchId,
launch,
pool: rawPool,
});

const recentTrades = trades.slice(-limit);

let stats = finalizeMarketStats({
stats: buildMarketStats({
launch: buildStatsInput({ launch, token: rawToken, pool: rawPool }),
trades,
candles: [],
}),
launch,
token: rawToken,
pool: rawPool,
trades,
});

stats = applyMarketGateToStats(stats, launch);
stats = attachSourceMetaToStats({
stats,
launch,
trades: recentTrades,
candles: [],
syntheticCandlesUsed: false,
});

const filtered = filterMarketRowsForLaunch({ launch, trades: recentTrades });

return {
launch,
token: maskTokenForLaunch(rawToken, launch),
pool: maskPoolForLaunch(rawPool, launch),
stats,
trades: filtered.trades,
source: buildSourceMeta({
launch,
stats,
trades: recentTrades,
candles: [],
syntheticCandlesUsed: false,
}),
};
}

export async function getChartStats({ db, launchId, wallet = "" }) {
let [launch, rawToken, rawPool, trades] = await Promise.all([
getLaunchById(db, launchId),
getTokenByLaunchId(db, launchId),
getPoolByLaunchId(db, launchId),
getTradeRows(db, launchId, 2000),
]);

launch = await enrichLaunchRuntimeState({
db,
launchId,
launch,
pool: rawPool,
});

const candles = buildCandlesFromTrades(trades, "1m");

let stats = finalizeMarketStats({
stats: buildMarketStats({
launch: buildStatsInput({ launch, token: rawToken, pool: rawPool }),
trades,
candles,
}),
launch,
token: rawToken,
pool: rawPool,
trades,
});

stats = applyMarketGateToStats(stats, launch);
stats = attachSourceMetaToStats({
stats,
launch,
trades,
candles,
syntheticCandlesUsed: false,
});

const walletSummary = await buildWalletSummary({
db,
launchId,
launch,
wallet,
priceUsd: toNumber(stats.price_usd, 0),
priceSol: toNumber(stats.price_sol ?? stats.price, 0),
});

const attachedStats = attachWalletStats(stats, walletSummary);

return {
launch,
token: maskTokenForLaunch(rawToken, launch),
pool: maskPoolForLaunch(rawPool, launch),
wallet: walletSummary,
cassie: buildCassiePayload(launch, attachedStats),
stats: attachedStats,
source: buildSourceMeta({
launch,
stats: attachedStats,
trades,
candles,
syntheticCandlesUsed: false,
}),
};
}

export async function getChartSnapshot({
db,
launchId,
interval = "1m",
candleLimit = 120,
tradeLimit = 50,
wallet = "",
}) {
const { launch, rawToken, rawPool, trades, rawCandles, stats, source } = await buildSnapshotBase({
db,
launchId,
interval,
candleLimit,
});

const recentTrades = trades.slice(-tradeLimit);

const walletSummary = await buildWalletSummary({
db,
launchId,
launch,
wallet,
priceUsd: toNumber(stats.price_usd, 0),
priceSol: toNumber(stats.price_sol ?? stats.price, 0),
});

const attachedStats = attachWalletStats(stats, walletSummary);

const filtered = filterMarketRowsForLaunch({
launch,
candles: rawCandles,
trades: recentTrades,
});

return {
launch,
token: maskTokenForLaunch(rawToken, launch),
pool: maskPoolForLaunch(rawPool, launch),
wallet: walletSummary,
cassie: buildCassiePayload(launch, attachedStats),
stats: attachedStats,
candles: filtered.candles,
trades: filtered.trades,
source,
};
}