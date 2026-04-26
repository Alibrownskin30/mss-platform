import { buildCandlesFromTrades, fillMissingCandles } from "./candle-builder.js";
import { buildMarketStats } from "./market-stats.js";

const BUILDER_DAILY_UNLOCK_PERCENT = 0.5;
const BUILDER_MAX_ALLOCATION_PERCENT = 5;

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
const mintReservationStatus = cleanText(
row.mint_reservation_status,
64
).toLowerCase();
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
const lifecycleGraduationStatus = normalizeLaunchStatus(
row.lifecycle_graduation_status
);
const lifecycleGraduated = toInt(row.lifecycle_graduated, 0) === 1;

const countdownStartedMs = parseDbTime(row.countdown_started_at);
const countdownEndsMs = parseDbTime(row.countdown_ends_at);
const liveAtMs = parseDbTime(row.live_at);
const now = Date.now();

const hasCountdownWindow =
Number.isFinite(countdownStartedMs) || Number.isFinite(countdownEndsMs);
const countdownStillRunning =
Number.isFinite(countdownEndsMs) && now < countdownEndsMs;
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

/*
Critical:
building is protected. Mint/pool/bootstrap signals are not allowed to
promote building -> live here. finalizeLaunch.js owns final live promotion.
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

return {
id: row.id,
name: row.token_name,
token_name: row.token_name,
symbol: row.symbol,
template: row.template,
status,
raw_status: normalizeLaunchStatus(row.status) || "commit",
phase: buildPhaseMeta({ status }),
market_bootstrapped: publicCaVisible ? marketBootstrapped : false,

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
circulating_supply: publicCaVisible
? toNumber(row.circulating_supply || row.final_supply || row.supply, 0)
: 0,

liquidity: oneSidedLiquiditySol,
liquidity_sol: oneSidedLiquiditySol,
internal_pool_sol: publicCaVisible ? launchInternalPoolSol : 0,
internal_pool_tokens: publicCaVisible
? poolTokenReserve > 0
? poolTokenReserve
: launchInternalPoolTokens
: 0,
liquidity_usd: publicCaVisible ? toNumber(row.liquidity_usd, 0) : 0,
current_liquidity_usd: publicCaVisible
? toNumber(row.current_liquidity_usd, 0)
: 0,
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

builder_pct: toNumber(row.builder_pct, 0),
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

lifecycle: publicCaVisible
? {
launch_status: status,
internal_sol_reserve: toNumber(row.lifecycle_internal_sol_reserve, 0),
internal_token_reserve: toInt(row.lifecycle_internal_token_reserve, 0),
implied_marketcap_sol: toNumber(row.lifecycle_implied_marketcap_sol, 0),
graduation_status:
cleanText(row.lifecycle_graduation_status, 120) || "internal_live",
surge_status:
cleanText(row.lifecycle_graduation_status, 120) || "internal_live",
graduated: lifecycleGraduated,
graduation_reason:
cleanText(row.lifecycle_graduation_reason, 200) || null,
graduated_at: row.lifecycle_graduated_at || null,
raydium_target_pct: toNumber(row.lifecycle_raydium_target_pct, 50),
mss_locked_target_pct: toNumber(row.lifecycle_mss_locked_target_pct, 50),
raydium_pool_id:
cleanText(row.lifecycle_raydium_pool_id, 200) || null,
raydium_sol_migrated: toNumber(row.lifecycle_raydium_sol_migrated, 0),
raydium_token_migrated: toInt(row.lifecycle_raydium_token_migrated, 0),
raydium_lp_tokens:
cleanText(row.lifecycle_raydium_lp_tokens, 200) || null,
raydium_migration_tx:
cleanText(row.lifecycle_raydium_migration_tx, 300) || null,
mss_locked_sol: toNumber(row.lifecycle_mss_locked_sol, 0),
mss_locked_token: toInt(row.lifecycle_mss_locked_token, 0),
mss_locked_lp_amount:
cleanText(row.lifecycle_mss_locked_lp_amount, 200) || null,
lock_status: cleanText(row.lifecycle_lock_status, 120) || "not_locked",
lock_tx: cleanText(row.lifecycle_lock_tx, 300) || null,
lock_expires_at: row.lifecycle_lock_expires_at || null,
market_bootstrapped: marketBootstrapped,
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

const [token, pool, hasBuilders, hasLifecycle, hasBuilderVesting] =
await Promise.all([
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

function buildCassiePayload(launch = {}, stats = {}) {
const phase = buildPhaseMeta(launch);
const absMove = Math.abs(toNumber(stats?.price_change_pct, 0));
const buyCount = toNumber(stats?.buys_24h, 0);
const sellCount = toNumber(stats?.sells_24h, 0);
const imbalance = Math.abs(buyCount - sellCount);

let riskState = "normal";
if (phase.market_enabled && (absMove >= 25 || imbalance >= 10)) {
riskState = "elevated";
} else if (phase.market_enabled && (absMove >= 12 || imbalance >= 5)) {
riskState = "active";
}

return {
monitoring_active: true,
phase: phase.status,
layer: "market-intelligence",
risk_state: riskState,
market_enabled: phase.market_enabled,
can_trade: phase.can_trade,
market_bootstrapped: phase.market_enabled
? Boolean(launch?.market_bootstrapped)
: false,
};
}

function buildStatsInput({ launch, token, pool }) {
const totalSupply = toNumber(
token?.supply ?? launch?.final_supply ?? launch?.supply,
0
);

const circulatingSupply = toNumber(
launch?.circulating_supply ?? totalSupply,
totalSupply
);

const oneSidedLiquiditySol = toNumber(
pool?.sol_reserve ??
launch?.lifecycle?.internal_sol_reserve ??
launch?.internal_pool_sol ??
launch?.liquidity ??
0,
0
);

const internalTokenReserve = toNumber(
pool?.token_reserve ??
launch?.lifecycle?.internal_token_reserve ??
launch?.internal_pool_tokens ??
0,
0
);

return {
...(launch || {}),
mint_address:
token?.mint_address || launch?.mint_address || launch?.contract_address || null,
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
liquidity_usd: toNumber(
launch?.current_liquidity_usd ?? launch?.liquidity_usd,
0
),
};
}

function getLiveDays(launch = {}) {
const liveMs = parseDbTime(launch?.live_at || launch?.updated_at || launch?.created_at);
if (!liveMs) return 0;
return Math.max(0, Math.floor((Date.now() - liveMs) / 86400000));
}

function getBuilderAllocationPercent(launch = {}) {
const builderPct = toNumber(launch?.builder_pct, 0);
const teamAllocationPct = toNumber(launch?.team_allocation_pct, 0);

if (builderPct > 0) return builderPct;
if (teamAllocationPct > 0) return teamAllocationPct;

return BUILDER_MAX_ALLOCATION_PERCENT;
}

function buildFallbackBuilderVestingSummary({ launch, wallet, tokenBalance }) {
const cleanWallet = normalizeWallet(wallet);
const builderWallet = normalizeWallet(launch?.builder_wallet);
const template = String(launch?.template || "").toLowerCase();
const totalSupply = toNumber(
launch?.final_supply ?? launch?.total_supply ?? launch?.supply,
0
);

const isBuilderWallet = Boolean(
template === "builder" && builderWallet && cleanWallet && builderWallet === cleanWallet
);

if (!isBuilderWallet || totalSupply <= 0) {
return {
is_builder_wallet: false,
vesting_active: false,
builder_total_allocation_tokens: 0,
builder_unlocked_tokens: tokenBalance,
builder_locked_tokens: 0,
builder_sellable_tokens: tokenBalance,
builder_visible_total_tokens: tokenBalance,
builder_vesting_percent_unlocked: 100,
builder_vesting_days_live: getLiveDays(launch),
builder_daily_unlock_tokens: 0,
};
}

const allocationPct = Math.min(
BUILDER_MAX_ALLOCATION_PERCENT,
Math.max(0, getBuilderAllocationPercent(launch))
);

const daysLive = getLiveDays(launch);
const unlockedPct = Math.min(
allocationPct,
Math.max(
BUILDER_DAILY_UNLOCK_PERCENT,
(daysLive + 1) * BUILDER_DAILY_UNLOCK_PERCENT
)
);

const totalAllocationTokens = Math.floor((totalSupply * allocationPct) / 100);
const unlockedAllocationTokens = Math.floor((totalSupply * unlockedPct) / 100);
const lockedAllocationTokens = Math.max(
0,
totalAllocationTokens - unlockedAllocationTokens
);

const visibleTotalTokens = Math.max(tokenBalance, totalAllocationTokens);
const sellableTokens = Math.max(
0,
Math.min(visibleTotalTokens, unlockedAllocationTokens)
);
const visibleUnlockedTokens = Math.max(
0,
Math.min(visibleTotalTokens, unlockedAllocationTokens)
);
const visibleLockedTokens = Math.max(
0,
Math.min(visibleTotalTokens - sellableTokens, lockedAllocationTokens)
);

return {
is_builder_wallet: true,
vesting_active: lockedAllocationTokens > 0,
builder_total_allocation_tokens: totalAllocationTokens,
builder_unlocked_tokens: visibleUnlockedTokens,
builder_locked_tokens: visibleLockedTokens,
builder_sellable_tokens: sellableTokens,
builder_visible_total_tokens: visibleTotalTokens,
builder_vesting_percent_unlocked:
allocationPct > 0 ? (unlockedPct / allocationPct) * 100 : 100,
builder_vesting_days_live: daysLive,
builder_daily_unlock_tokens: Math.floor(
(totalSupply * BUILDER_DAILY_UNLOCK_PERCENT) / 100
),
};
}

function buildBuilderVestingSummary({
launch,
wallet,
tokenBalance,
storedTotalBalance = null,
storedUnlockedBalance = null,
storedLockedBalance = null,
storedSellableBalance = null,
}) {
const cleanWallet = normalizeWallet(wallet);
const builderWallet = normalizeWallet(launch?.builder_wallet);
const vestingWallet = normalizeWallet(launch?.builder_vesting?.builder_wallet);
const template = String(launch?.template || "").toLowerCase();

const isBuilderWallet = Boolean(
template === "builder" &&
cleanWallet &&
(builderWallet === cleanWallet || vestingWallet === cleanWallet)
);

if (!isBuilderWallet) {
return {
is_builder_wallet: false,
vesting_active: false,
builder_total_allocation_tokens: 0,
builder_unlocked_tokens: tokenBalance,
builder_locked_tokens: 0,
builder_sellable_tokens: tokenBalance,
builder_visible_total_tokens: tokenBalance,
builder_vesting_percent_unlocked: 100,
builder_vesting_days_live: getLiveDays(launch),
builder_daily_unlock_tokens: 0,
};
}

const vesting = launch?.builder_vesting || {};
const totalAllocation = toInt(vesting.total_allocation, 0);
const unlockedAmount = toInt(vesting.unlocked_amount, 0);
const lockedAmount = toInt(vesting.locked_amount, 0);
const dailyUnlock = toInt(vesting.daily_unlock, 0);

const vestingStartMs = parseDbTime(
vesting.vesting_start_at || vesting.created_at || launch?.live_at || launch?.created_at
);

const vestedDays = vestingStartMs
? Math.max(0, Math.floor((Date.now() - vestingStartMs) / 86400000))
: getLiveDays(launch);

const hasExplicitVesting =
totalAllocation > 0 || unlockedAmount > 0 || lockedAmount > 0 || dailyUnlock > 0;

if (hasExplicitVesting) {
const derivedTotalAllocation =
totalAllocation > 0
? totalAllocation
: Math.max(tokenBalance, unlockedAmount + lockedAmount);

const derivedUnlocked = Math.max(
0,
Math.min(
derivedTotalAllocation,
chooseFirstFinite(
storedUnlockedBalance,
storedSellableBalance,
unlockedAmount,
tokenBalance,
0
) ?? 0
)
);

const derivedLocked = Math.max(
0,
Math.min(
derivedTotalAllocation,
chooseFirstFinite(
storedLockedBalance,
lockedAmount,
Math.max(0, derivedTotalAllocation - derivedUnlocked),
0
) ?? 0
)
);

const visibleTotal = Math.max(
tokenBalance,
derivedUnlocked + derivedLocked,
toInt(storedTotalBalance, 0),
derivedTotalAllocation
);

const sellable = Math.max(
0,
Math.min(
visibleTotal,
chooseFirstFinite(storedSellableBalance, derivedUnlocked, tokenBalance, 0) ?? 0
)
);

const visibleLocked = Math.max(
0,
Math.min(
Math.max(0, visibleTotal - sellable),
Math.max(derivedLocked, Math.max(0, visibleTotal - sellable))
)
);

const percentUnlocked =
derivedTotalAllocation > 0
? clamp((Math.max(0, derivedUnlocked) / derivedTotalAllocation) * 100, 0, 100)
: 100;

return {
is_builder_wallet: true,
vesting_active: visibleLocked > 0 || derivedLocked > 0,
builder_total_allocation_tokens: derivedTotalAllocation,
builder_unlocked_tokens: Math.max(0, Math.min(visibleTotal, derivedUnlocked)),
builder_locked_tokens: visibleLocked,
builder_sellable_tokens: sellable,
builder_visible_total_tokens: visibleTotal,
builder_vesting_percent_unlocked: percentUnlocked,
builder_vesting_days_live: vestedDays,
builder_daily_unlock_tokens: dailyUnlock,
};
}

return buildFallbackBuilderVestingSummary({ launch, wallet, tokenBalance });
}

async function getWalletBalanceSnapshot(db, launchId, wallet) {
const cleanWallet = cleanText(wallet, 120);
if (!cleanWallet) return null;

const columnSet = await getWalletBalanceColumns(db);
if (!columnSet.size) return null;

const aliasGroups = {
tokenBalance: [
"token_amount",
"balance_tokens",
"token_balance",
"wallet_balance_tokens",
],
totalBalance: ["total_balance", "total_balance_tokens", "wallet_total_balance"],
unlockedBalance: [
"unlocked_balance",
"unlocked_token_balance",
"wallet_unlocked_balance",
],
lockedBalance: ["locked_balance", "locked_token_balance", "wallet_locked_balance"],
sellableBalance: [
"sellable_balance",
"sellable_token_balance",
"wallet_sellable_balance",
],
solBalance: ["sol_balance", "wallet_sol_balance"],
};

const selectParts = [];
for (const [alias, names] of Object.entries(aliasGroups)) {
const found = names.find((name) => columnSet.has(name));
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
[launchId, cleanWallet]
);

if (!row) return null;

return {
tokenBalance: chooseFirstFinite(row.tokenBalance, 0) ?? 0,
totalBalance: chooseFirstFinite(row.totalBalance, row.tokenBalance, 0),
unlockedBalance: chooseFirstFinite(row.unlockedBalance),
lockedBalance: chooseFirstFinite(row.lockedBalance),
sellableBalance: chooseFirstFinite(row.sellableBalance),
solBalance: chooseFirstFinite(row.solBalance),
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
(tokenAmount > 0
? toNumber(trade?.sol_amount ?? trade?.base_amount, 0) / tokenAmount
: 0);

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
pool?.sol_reserve ??
launch?.lifecycle?.internal_sol_reserve ??
launch?.internal_pool_sol ??
launch?.liquidity,
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

function finalizeMarketStats({ stats = {}, launch = {}, token = {}, pool = {}, trades = [] }) {
const finalized = { ...(stats || {}) };

const totalSupply = toNumber(
finalized.total_supply ?? token?.supply ?? launch?.final_supply ?? launch?.supply,
0
);

const circulatingSupply = toNumber(
finalized.circulating_supply ?? launch?.circulating_supply ?? totalSupply,
totalSupply
);

const priceSol =
chooseFirstPositive(
finalized.price_sol,
finalized.price,
launch?.price,
getLatestTradePriceSol(trades),
getPoolSpotPriceSol(pool, launch)
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

const marketCapSol =
chooseFirstPositive(
finalized.market_cap_sol,
finalized.market_cap,
launch?.market_cap,
priceSol > 0 && circulatingSupply > 0 ? priceSol * circulatingSupply : 0
) || 0;

const volume24hSol =
chooseFirstPositive(finalized.volume_24h_sol, finalized.volume_24h, launch?.volume_24h) || 0;

const explicitLiquidityUsd =
chooseFirstPositive(finalized.liquidity_usd, launch?.current_liquidity_usd, launch?.liquidity_usd) || 0;

const explicitMarketCapUsd =
chooseFirstPositive(finalized.market_cap_usd, launch?.market_cap_usd) || 0;

const explicitVolumeUsd =
chooseFirstPositive(finalized.volume_24h_usd, launch?.volume_24h_usd) || 0;

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

const resolvedPriceUsd =
explicitPriceUsd > 0
? explicitPriceUsd
: solUsdPrice > 0 && priceSol > 0
? priceSol * solUsdPrice
: 0;

const resolvedLiquidityUsd =
explicitLiquidityUsd > 0
? explicitLiquidityUsd
: solUsdPrice > 0 && oneSidedLiquiditySol > 0
? oneSidedLiquiditySol * solUsdPrice
: 0;

const resolvedMarketCapUsd =
explicitMarketCapUsd > 0
? explicitMarketCapUsd
: solUsdPrice > 0 && marketCapSol > 0
? marketCapSol * solUsdPrice
: 0;

const resolvedVolume24hUsd =
explicitVolumeUsd > 0
? explicitVolumeUsd
: solUsdPrice > 0 && volume24hSol > 0
? volume24hSol * solUsdPrice
: 0;

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

function applyMarketGateToStats(stats = {}, launch = null) {
const phase = buildPhaseMeta(launch);
const marketActive = phase.market_enabled;

if (marketActive) {
return {
...(stats || {}),
phase,
market_enabled: true,
can_trade: true,
};
}

return {
...(stats || {}),
phase,
market_enabled: false,
can_trade: false,

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

price: 0,
price_sol: 0,
price_usd: 0,

liquidity: 0,
liquidity_sol: 0,
liquidity_usd: 0,

market_cap: 0,
market_cap_sol: 0,
market_cap_usd: 0,

volume_24h: 0,
volume_24h_sol: 0,
volume_24h_usd: 0,

buys_24h: 0,
sells_24h: 0,
trades_24h: 0,
tx_count_24h: 0,

price_change_pct: 0,
high_24h: 0,
low_24h: 0,
high_24h_sol: 0,
low_24h_sol: 0,
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
};
}

async function buildWalletSummary({ db, launchId, launch, trades, wallet, priceUsd = 0 }) {
const cleanWallet = cleanText(wallet, 120);
if (!cleanWallet || !isMarketEnabledLaunch(launch)) {
return emptyWalletSummary();
}

const walletSnapshot = await getWalletBalanceSnapshot(db, launchId, cleanWallet);

let tokenBalance = Math.max(0, Math.floor(toNumber(walletSnapshot?.tokenBalance, 0)));

if (tokenBalance <= 0) {
let derivedBalance = 0;
const targetWallet = normalizeWallet(cleanWallet);

for (const trade of trades) {
const sameWallet = normalizeWallet(trade.wallet) === targetWallet;
if (!sameWallet) continue;

if (String(trade.side || "").toLowerCase() === "sell") {
derivedBalance -= toNumber(trade.token_amount, 0);
} else {
derivedBalance += toNumber(trade.token_amount, 0);
}
}

tokenBalance = Math.max(0, Math.floor(derivedBalance));
}

let walletSolDelta = 0;
const targetWallet = normalizeWallet(cleanWallet);

for (const trade of trades) {
const sameWallet = normalizeWallet(trade.wallet) === targetWallet;
if (!sameWallet) continue;

const tradeSol = toNumber(trade.sol_amount ?? trade.base_amount, 0);

if (String(trade.side || "").toLowerCase() === "sell") {
walletSolDelta += tradeSol;
} else {
walletSolDelta -= tradeSol;
}
}

const vesting = buildBuilderVestingSummary({
launch,
wallet: cleanWallet,
tokenBalance,
storedTotalBalance: walletSnapshot?.totalBalance,
storedUnlockedBalance: walletSnapshot?.unlockedBalance,
storedLockedBalance: walletSnapshot?.lockedBalance,
storedSellableBalance: walletSnapshot?.sellableBalance,
});

const walletTokenBalance = vesting.is_builder_wallet
? vesting.builder_visible_total_tokens
: tokenBalance;

const sellableBalance = vesting.builder_sellable_tokens;
const unlockedBalance = vesting.builder_unlocked_tokens;
const lockedBalance = vesting.builder_locked_tokens;
const totalBalance = vesting.is_builder_wallet
? Math.max(walletTokenBalance, vesting.builder_visible_total_tokens)
: Math.max(walletTokenBalance, toInt(walletSnapshot?.totalBalance, 0));

const positionValueUsd = totalBalance > 0 && priceUsd > 0 ? totalBalance * priceUsd : 0;

const visibleSolBalance =
walletSnapshot?.solBalance != null ? walletSnapshot.solBalance : walletSolDelta;

return {
token_balance: walletTokenBalance,
tokenBalance: walletTokenBalance,
balance_tokens: walletTokenBalance,
wallet_balance_tokens: walletTokenBalance,

total_balance: totalBalance,
totalBalance: totalBalance,
visible_total_balance: totalBalance,
visibleTotalBalance: totalBalance,

position_value_usd: positionValueUsd,
positionValueUsd: positionValueUsd,

sol_balance: visibleSolBalance,
solBalance: visibleSolBalance,
sol_delta: walletSolDelta,
solDelta: walletSolDelta,
walletSolDelta: walletSolDelta,

sellable_balance: sellableBalance,
sellableBalance: sellableBalance,
sellable_token_balance: sellableBalance,
sellableTokenBalance: sellableBalance,

locked_balance: lockedBalance,
lockedBalance: lockedBalance,
locked_token_balance: lockedBalance,
lockedTokenBalance: lockedBalance,

unlocked_balance: unlockedBalance,
unlockedBalance: unlockedBalance,
unlocked_token_balance: unlockedBalance,
unlockedTokenBalance: unlockedBalance,

is_builder_wallet: vesting.is_builder_wallet,
wallet_is_builder: vesting.is_builder_wallet,
vesting_active: vesting.vesting_active,
wallet_vesting_active: vesting.vesting_active,

builder_total_allocation_tokens: vesting.builder_total_allocation_tokens,
builder_unlocked_tokens: vesting.builder_unlocked_tokens,
builder_locked_tokens: vesting.builder_locked_tokens,
builder_sellable_tokens: vesting.builder_sellable_tokens,
builder_visible_total_tokens: vesting.builder_visible_total_tokens,
builder_vesting_percent_unlocked: vesting.builder_vesting_percent_unlocked,
builder_vesting_days_live: vesting.builder_vesting_days_live,
builder_daily_unlock_tokens: vesting.builder_daily_unlock_tokens,
};
}

function attachWalletStats(stats = {}, walletSummary = {}) {
return {
...stats,

wallet_token_balance: walletSummary.token_balance,
wallet_balance_tokens: walletSummary.token_balance,
wallet_total_balance: walletSummary.total_balance,
wallet_visible_total_balance:
walletSummary.visible_total_balance ?? walletSummary.total_balance,
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

is_builder_wallet: walletSummary.is_builder_wallet,
builder_total_allocation_tokens: walletSummary.builder_total_allocation_tokens,
builder_unlocked_tokens: walletSummary.builder_unlocked_tokens,
builder_locked_tokens: walletSummary.builder_locked_tokens,
builder_sellable_tokens: walletSummary.builder_sellable_tokens,
builder_visible_total_tokens: walletSummary.builder_visible_total_tokens,
builder_vesting_percent_unlocked: walletSummary.builder_vesting_percent_unlocked,
builder_vesting_days_live: walletSummary.builder_vesting_days_live,
builder_daily_unlock_tokens: walletSummary.builder_daily_unlock_tokens,
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

export async function getChartCandles({ db, launchId, interval = "1m", limit = 120 }) {
const [launch, rawToken, rawPool, trades] = await Promise.all([
getLaunchById(db, launchId),
getTokenByLaunchId(db, launchId),
getPoolByLaunchId(db, launchId),
getTradeRows(db, launchId, 2000),
]);

const rawCandles = fillMissingCandles(
buildCandlesFromTrades(trades, interval),
interval,
limit
);

const baseStats = finalizeMarketStats({
stats: buildMarketStats({
launch: buildStatsInput({ launch, token: rawToken, pool: rawPool }),
trades,
candles: rawCandles,
}),
launch,
token: rawToken,
pool: rawPool,
trades,
});

const stats = applyMarketGateToStats(baseStats, launch);
const filtered = filterMarketRowsForLaunch({ launch, candles: rawCandles, trades });

return {
launch,
token: maskTokenForLaunch(rawToken, launch),
pool: maskPoolForLaunch(rawPool, launch),
stats,
candles: filtered.candles,
};
}

export async function getChartTrades({ db, launchId, limit = 50 }) {
const [launch, rawToken, rawPool, trades] = await Promise.all([
getLaunchById(db, launchId),
getTokenByLaunchId(db, launchId),
getPoolByLaunchId(db, launchId),
getTradeRows(db, launchId, Math.max(limit, 1)),
]);

const recentTrades = trades.slice(-limit);

const baseStats = finalizeMarketStats({
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

const stats = applyMarketGateToStats(baseStats, launch);
const filtered = filterMarketRowsForLaunch({ launch, trades: recentTrades });

return {
launch,
token: maskTokenForLaunch(rawToken, launch),
pool: maskPoolForLaunch(rawPool, launch),
stats,
trades: filtered.trades,
};
}

export async function getChartStats({ db, launchId, wallet = "" }) {
const [launch, rawToken, rawPool, trades] = await Promise.all([
getLaunchById(db, launchId),
getTokenByLaunchId(db, launchId),
getPoolByLaunchId(db, launchId),
getTradeRows(db, launchId, 2000),
]);

const candles = buildCandlesFromTrades(trades, "1m");

const baseStats = finalizeMarketStats({
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

const stats = applyMarketGateToStats(baseStats, launch);

const walletSummary = await buildWalletSummary({
db,
launchId,
launch,
trades,
wallet,
priceUsd: toNumber(stats.price_usd, 0),
});

return {
launch,
token: maskTokenForLaunch(rawToken, launch),
pool: maskPoolForLaunch(rawPool, launch),
wallet: walletSummary,
cassie: buildCassiePayload(launch, stats),
stats: attachWalletStats(stats, walletSummary),
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
const [launch, rawToken, rawPool, trades] = await Promise.all([
getLaunchById(db, launchId),
getTokenByLaunchId(db, launchId),
getPoolByLaunchId(db, launchId),
getTradeRows(db, launchId, 2000),
]);

const rawCandles = fillMissingCandles(
buildCandlesFromTrades(trades, interval),
interval,
candleLimit
);

const recentTrades = trades.slice(-tradeLimit);

const baseStats = finalizeMarketStats({
stats: buildMarketStats({
launch: buildStatsInput({ launch, token: rawToken, pool: rawPool }),
trades,
candles: rawCandles,
}),
launch,
token: rawToken,
pool: rawPool,
trades,
});

const stats = applyMarketGateToStats(baseStats, launch);

const walletSummary = await buildWalletSummary({
db,
launchId,
launch,
trades,
wallet,
priceUsd: toNumber(stats.price_usd, 0),
});

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
cassie: buildCassiePayload(launch, stats),
stats: attachWalletStats(stats, walletSummary),
candles: filtered.candles,
trades: filtered.trades,
};
}