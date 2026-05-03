import db from "../../db/index.js";

const BUILDER_TOTAL_ALLOCATION_PCT = 5;
const BUILDER_DAILY_UNLOCK_PCT = 0.5;
const BUILDER_UNLOCK_DAYS = 10;
const BUILDER_CLIFF_DAYS = 0;
const BUILDER_VESTING_DAYS = BUILDER_UNLOCK_DAYS;

const RAYDIUM_SPLIT_PCT = 50;
const MSS_LOCK_SPLIT_PCT = 50;

const DEFAULT_GRADUATION_MARKETCAP_SOL = 120;
const DEFAULT_GRADUATION_VOLUME_24H_SOL = 80;
const DEFAULT_GRADUATION_MIN_HOLDERS = 25;
const DEFAULT_GRADUATION_MIN_LIVE_MINUTES = 15;
const DEFAULT_MSS_LOCK_DAYS = 90;

const BUILDER_VESTING_RULE =
"0% unlocked at live. Builder allocation then unlocks at 0.5% of total supply per day for 10 days until the full 5% allocation is unlocked.";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const tableExistsCache = new Map();
const tableColumnCache = new Map();

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

function clean(value, max = 5000) {
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

function nowIso() {
return new Date().toISOString();
}

function addDaysIso(days) {
const ms = Date.now() + Math.max(0, safeNum(days, 0)) * MS_PER_DAY;
return new Date(ms).toISOString();
}

function firstPresent(...values) {
for (const value of values) {
if (value == null) continue;
const text = clean(value, 5000);
if (text) return value;
}
return null;
}

function normalizePhaseStatus(value) {
const status = clean(value, 80).toLowerCase();

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

function isExplicitFalseish(value) {
if (value === false || value === 0) return true;
const raw = String(value ?? "").trim().toLowerCase();
return raw === "0" || raw === "false" || raw === "no";
}

function isExplicitTrueish(value) {
if (value === true || value === 1) return true;
const raw = String(value ?? "").trim().toLowerCase();
return raw === "1" || raw === "true" || raw === "yes";
}

async function tableExists(tableName) {
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

async function getTableColumns(tableName) {
const key = String(tableName || "").trim();
if (!key) return new Set();

if (tableColumnCache.has(key)) {
return tableColumnCache.get(key);
}

const rows = await db.all(`PRAGMA table_info(${key})`);
const columns = new Set(rows.map((row) => String(row.name || "").trim()));
tableColumnCache.set(key, columns);
return columns;
}

function computeSpotPriceSolPerToken(solReserve, tokenReserve) {
const sol = safeNum(solReserve, 0);
const tokens = safeNum(tokenReserve, 0);

if (sol <= 0 || tokens <= 0) return 0;
return sol / tokens;
}

function computeBuilderTotalAllocation(totalSupply) {
return floorToken(
(safeNum(totalSupply, 0) * BUILDER_TOTAL_ALLOCATION_PCT) / 100
);
}

function computeBuilderDailyUnlock(totalSupply) {
return floorToken(
(safeNum(totalSupply, 0) * BUILDER_DAILY_UNLOCK_PCT) / 100
);
}

function resolveBuilderTotalAllocation(totalSupply, override = null) {
return Math.max(
computeBuilderTotalAllocation(totalSupply),
floorToken(override)
);
}

function resolveBuilderDailyUnlock(
totalSupply,
totalAllocation,
override = null
) {
const canonicalDailyUnlock = computeBuilderDailyUnlock(totalSupply);
const allocationDerivedDailyUnlock = floorToken(
safeNum(totalAllocation, 0) / BUILDER_UNLOCK_DAYS
);

return Math.max(
canonicalDailyUnlock,
allocationDerivedDailyUnlock,
floorToken(override)
);
}

function computeBuilderUnlockedAmount({
totalSupply,
totalAllocationOverride = null,
dailyUnlockOverride = null,
vestingStartAt,
now = Date.now(),
}) {
const totalAllocation = resolveBuilderTotalAllocation(
totalSupply,
totalAllocationOverride
);

const dailyUnlock = resolveBuilderDailyUnlock(
totalSupply,
totalAllocation,
dailyUnlockOverride
);

if (totalAllocation <= 0 || dailyUnlock <= 0) {
return {
totalAllocation,
dailyUnlock,
unlockedAmount: 0,
lockedAmount: 0,
vestedDays: 0,
vestingDaysLive: 0,
unlockDays: BUILDER_UNLOCK_DAYS,
cliffDays: BUILDER_CLIFF_DAYS,
totalAllocationPct: BUILDER_TOTAL_ALLOCATION_PCT,
dailyUnlockPct: BUILDER_DAILY_UNLOCK_PCT,
};
}

const startMs = parseDbTime(vestingStartAt);
if (!Number.isFinite(startMs) || now < startMs) {
return {
totalAllocation,
dailyUnlock,
unlockedAmount: 0,
lockedAmount: totalAllocation,
vestedDays: 0,
vestingDaysLive: 0,
unlockDays: BUILDER_UNLOCK_DAYS,
cliffDays: BUILDER_CLIFF_DAYS,
totalAllocationPct: BUILDER_TOTAL_ALLOCATION_PCT,
dailyUnlockPct: BUILDER_DAILY_UNLOCK_PCT,
};
}

const elapsedMs = Math.max(0, now - startMs);
const elapsedDays = Math.floor(elapsedMs / MS_PER_DAY);
const vestedDays = Math.min(BUILDER_UNLOCK_DAYS, elapsedDays);

const unlockedAmount =
vestedDays >= BUILDER_UNLOCK_DAYS
? totalAllocation
: Math.min(totalAllocation, dailyUnlock * vestedDays);

return {
totalAllocation,
dailyUnlock,
unlockedAmount,
lockedAmount: Math.max(0, totalAllocation - unlockedAmount),
vestedDays,
vestingDaysLive: elapsedDays,
unlockDays: BUILDER_UNLOCK_DAYS,
cliffDays: BUILDER_CLIFF_DAYS,
totalAllocationPct: BUILDER_TOTAL_ALLOCATION_PCT,
dailyUnlockPct: BUILDER_DAILY_UNLOCK_PCT,
};
}

function resolveTotalSupply(launch, token, lifecycle = null) {
return floorToken(
firstPresent(
token?.supply,
token?.total_supply,
launch?.final_supply,
launch?.total_supply,
launch?.supply,
lifecycle?.total_supply,
lifecycle?.totalSupply
) || 0
);
}

function resolveInternalSolReserve(launch, pool, lifecycle) {
return roundSol(
firstPresent(
pool?.sol_reserve,
lifecycle?.internal_sol_reserve,
lifecycle?.internalSolReserve,
launch?.internal_pool_sol,
launch?.liquidity
) || 0
);
}

function resolveInternalTokenReserve(launch, pool, lifecycle) {
return floorToken(
firstPresent(
pool?.token_reserve,
lifecycle?.internal_token_reserve,
lifecycle?.internalTokenReserve,
launch?.internal_pool_tokens
) || 0
);
}

function getContractCandidateFromState(launch = null, lifecycle = null) {
return clean(
firstPresent(
launch?.contract_address,
launch?.token_mint,
launch?.mint_address,
launch?.mint,
lifecycle?.contract_address,
lifecycle?.contractAddress
),
120
);
}

function hasLiveMintSignal(launch = null, lifecycle = null) {
const contractAddress = getContractCandidateFromState(launch, lifecycle);
const reservationStatus = clean(
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
return safeNum(lifecycle.graduated, 0) === 1;
}

function computeCanonicalLifecycleStatus(launch = null, lifecycle = null) {
if (!launch && !lifecycle) return "commit";

const rawStatus = normalizePhaseStatus(launch?.status);
const lifecycleLaunchStatus = normalizePhaseStatus(
lifecycle?.launch_status ?? lifecycle?.launchStatus ?? lifecycle?.status
);
const lifecycleGraduationStatus = normalizePhaseStatus(
lifecycle?.graduation_status ??
lifecycle?.graduationStatus ??
lifecycle?.surge_status ??
lifecycle?.surgeStatus
);

const countdownStartedMs = parseDbTime(launch?.countdown_started_at);
const countdownEndsMs = parseDbTime(
launch?.countdown_ends_at || launch?.live_at
);
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

const bootstrappedFalse = isExplicitFalseish(
launch?.market_bootstrapped ??
lifecycle?.market_bootstrapped ??
lifecycle?.marketBootstrapped
);

if (rawStatus === "live" || lifecycleLaunchStatus === "live") {
return bootstrappedFalse ? "building" : "live";
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

if (!rawStatus && !lifecycleLaunchStatus && Number.isFinite(liveAtMs) && now >= liveAtMs && liveMintSignal) {
return bootstrappedFalse ? "building" : "live";
}

if (!rawStatus && !lifecycleLaunchStatus && liveMintSignal) {
return bootstrappedFalse ? "building" : "live";
}

return rawStatus || lifecycleLaunchStatus || "commit";
}

function resolveMarketBootstrapped({
launch,
lifecycle,
token,
pool,
totalSupply,
solReserve,
tokenReserve,
}) {
const explicit = launch?.market_bootstrapped ?? lifecycle?.market_bootstrapped ?? lifecycle?.marketBootstrapped;

if (isExplicitTrueish(explicit)) return true;
if (isExplicitFalseish(explicit)) return false;

return Boolean(
token &&
pool &&
totalSupply > 0 &&
solReserve > 0 &&
tokenReserve > 0 &&
hasLiveMintSignal(launch, lifecycle)
);
}

function resolveGraduationStatus(launch, lifecycle, canonicalStatus) {
const persisted = clean(
lifecycle?.graduation_status ?? lifecycle?.graduationStatus,
64
);
if (persisted) return persisted;

if (canonicalStatus === "graduated") return "graduated";
if (canonicalStatus === "live") return "internal_live";
if (canonicalStatus === "building") return "building";
if (canonicalStatus === "countdown") return "countdown";
if (canonicalStatus === "commit") return "pending";
return canonicalStatus || "pending";
}

function resolveLockStatus(
launch,
lifecycle,
canonicalStatus,
hasReserves,
marketBootstrapped
) {
const persisted = clean(lifecycle?.lock_status ?? lifecycle?.lockStatus, 64);
if (persisted) return persisted;

if (canonicalStatus === "graduated") {
return "locked_pending_proof";
}

if (
(canonicalStatus === "live" || canonicalStatus === "building") &&
hasReserves &&
marketBootstrapped
) {
return "mss_held_internal";
}

if (canonicalStatus === "building") return "bootstrapping";
if (canonicalStatus === "countdown") return "pending_live";
if (canonicalStatus === "commit") return "pending";

return "pending";
}

function getGraduationThresholds() {
return {
marketcapSol: safeNum(
process.env.MSS_GRADUATION_MARKETCAP_SOL,
DEFAULT_GRADUATION_MARKETCAP_SOL
),
volume24hSol: safeNum(
process.env.MSS_GRADUATION_VOLUME_24H_SOL,
DEFAULT_GRADUATION_VOLUME_24H_SOL
),
minHolders: Math.max(
1,
Math.floor(
safeNum(
process.env.MSS_GRADUATION_MIN_HOLDERS,
DEFAULT_GRADUATION_MIN_HOLDERS
)
)
),
minLiveMinutes: Math.max(
0,
Math.floor(
safeNum(
process.env.MSS_GRADUATION_MIN_LIVE_MINUTES,
DEFAULT_GRADUATION_MIN_LIVE_MINUTES
)
)
),
lockDays: Math.max(
1,
Math.floor(
safeNum(process.env.MSS_LP_LOCK_DAYS, DEFAULT_MSS_LOCK_DAYS)
)
),
};
}

function getLiveMinutes(launch) {
const liveMs = parseDbTime(
launch?.live_at || launch?.updated_at || launch?.created_at
);
if (!Number.isFinite(liveMs)) return 0;
return Math.max(0, Math.floor((Date.now() - liveMs) / 60000));
}

async function getLaunchRow(launchId) {
return db.get(
`
SELECT *
FROM launches
WHERE id = ?
LIMIT 1
`,
[launchId]
);
}

async function getPoolRow(launchId) {
return db.get(
`
SELECT *
FROM pools
WHERE launch_id = ?
ORDER BY id DESC
LIMIT 1
`,
[launchId]
);
}

async function getTokenRow(launchId) {
return db.get(
`
SELECT *
FROM tokens
WHERE launch_id = ?
ORDER BY id DESC
LIMIT 1
`,
[launchId]
);
}

async function getLifecycleRow(launchId) {
if (!(await tableExists("launch_liquidity_lifecycle"))) return null;

return db.get(
`
SELECT *
FROM launch_liquidity_lifecycle
WHERE launch_id = ?
LIMIT 1
`,
[launchId]
);
}

async function getBuilderVestingRow(launchId) {
if (!(await tableExists("builder_vesting"))) return null;

return db.get(
`
SELECT *
FROM builder_vesting
WHERE launch_id = ?
LIMIT 1
`,
[launchId]
);
}

async function getTrades24hVolume(launchId) {
const row = await db.get(
`
SELECT COALESCE(SUM(ABS(sol_amount)), 0) AS total
FROM trades
WHERE launch_id = ?
AND datetime(created_at) >= datetime('now', '-24 hours')
`,
[launchId]
);

return roundSol(row?.total || 0);
}

async function getHolderCount(launchId) {
if (!(await tableExists("wallet_balances"))) return 0;

const columns = await getTableColumns("wallet_balances");
const balanceColumn = [
"token_amount",
"balance_tokens",
"token_balance",
"wallet_balance_tokens",
"visible_total_balance",
"visible_total_tokens",
"wallet_visible_total_balance",
].find((column) => columns.has(column));

if (!balanceColumn) return 0;

const row = await db.get(
`
SELECT COUNT(*) AS total
FROM wallet_balances
WHERE launch_id = ?
AND COALESCE(${balanceColumn}, 0) > 0
`,
[launchId]
);

return safeNum(row?.total, 0);
}

function resolveBuilderVestingStartAt({
launch,
existing,
canonicalStatus,
marketBootstrapped,
}) {
const existingStart = clean(existing?.vesting_start_at, 120);
if (existingStart) return existingStart;

const liveAt = clean(launch?.live_at, 120);
if (liveAt) return liveAt;

if (
marketBootstrapped &&
(canonicalStatus === "live" || canonicalStatus === "graduated")
) {
return nowIso();
}

return null;
}

async function ensureBuilderVestingRecord(
launchId,
launch,
token,
context = {}
) {
if (!(await tableExists("builder_vesting"))) return null;

const columns = await getTableColumns("builder_vesting");
const has = (name) => columns.has(name);

const totalSupply = resolveTotalSupply(launch, token, context.lifecycle);
const builderWallet = clean(launch?.builder_wallet, 120);
const existing = await getBuilderVestingRow(launchId);
const vestingStartAt = resolveBuilderVestingStartAt({
launch,
existing,
canonicalStatus: context.canonicalStatus,
marketBootstrapped: context.marketBootstrapped,
});

const computed = computeBuilderUnlockedAmount({
totalSupply,
totalAllocationOverride: existing?.total_allocation,
dailyUnlockOverride: existing?.daily_unlock,
vestingStartAt,
});

if (existing) {
const sets = [];
const values = [];

if (has("builder_wallet")) {
sets.push("builder_wallet = ?");
values.push(builderWallet);
}
if (has("total_allocation")) {
sets.push("total_allocation = ?");
values.push(computed.totalAllocation);
}
if (has("daily_unlock")) {
sets.push("daily_unlock = ?");
values.push(computed.dailyUnlock);
}
if (has("unlocked_amount")) {
sets.push("unlocked_amount = ?");
values.push(computed.unlockedAmount);
}
if (has("locked_amount")) {
sets.push("locked_amount = ?");
values.push(computed.lockedAmount);
}
if (has("vesting_start_at")) {
sets.push("vesting_start_at = ?");
values.push(vestingStartAt);
}
if (has("updated_at")) {
sets.push("updated_at = CURRENT_TIMESTAMP");
}

if (sets.length) {
values.push(launchId);
await db.run(
`
UPDATE builder_vesting
SET ${sets.join(", ")}
WHERE launch_id = ?
`,
values
);
}
} else {
const insertColumns = ["launch_id"];
const placeholders = ["?"];
const values = [launchId];

if (has("builder_wallet")) {
insertColumns.push("builder_wallet");
placeholders.push("?");
values.push(builderWallet);
}
if (has("total_allocation")) {
insertColumns.push("total_allocation");
placeholders.push("?");
values.push(computed.totalAllocation);
}
if (has("daily_unlock")) {
insertColumns.push("daily_unlock");
placeholders.push("?");
values.push(computed.dailyUnlock);
}
if (has("unlocked_amount")) {
insertColumns.push("unlocked_amount");
placeholders.push("?");
values.push(computed.unlockedAmount);
}
if (has("locked_amount")) {
insertColumns.push("locked_amount");
placeholders.push("?");
values.push(computed.lockedAmount);
}
if (has("vesting_start_at")) {
insertColumns.push("vesting_start_at");
placeholders.push("?");
values.push(vestingStartAt);
}
if (has("created_at")) {
insertColumns.push("created_at");
placeholders.push("CURRENT_TIMESTAMP");
}
if (has("updated_at")) {
insertColumns.push("updated_at");
placeholders.push("CURRENT_TIMESTAMP");
}

await db.run(
`
INSERT INTO builder_vesting (${insertColumns.join(", ")})
VALUES (${placeholders.join(", ")})
`,
values
);
}

return getBuilderVestingRow(launchId);
}

async function ensureLifecycleRecord(launchId, launch, token, pool, context = {}) {
if (!(await tableExists("launch_liquidity_lifecycle"))) return null;

const columns = await getTableColumns("launch_liquidity_lifecycle");
const has = (name) => columns.has(name);

const totalSupply = resolveTotalSupply(launch, token, context.lifecycle);
const solReserve = resolveInternalSolReserve(launch, pool, context.lifecycle);
const tokenReserve = resolveInternalTokenReserve(launch, pool, context.lifecycle);
const impliedMarketcapSol = roundSol(
computeSpotPriceSolPerToken(solReserve, tokenReserve) * totalSupply
);
const canonicalStatus = context.canonicalStatus || computeCanonicalLifecycleStatus(launch, context.lifecycle);
const marketBootstrapped =
context.marketBootstrapped ??
resolveMarketBootstrapped({
launch,
lifecycle: context.lifecycle,
token,
pool,
totalSupply,
solReserve,
tokenReserve,
});

const defaultGraduationStatus =
canonicalStatus === "graduated"
? "graduated"
: canonicalStatus === "live"
? "internal_live"
: canonicalStatus === "building"
? "building"
: canonicalStatus === "countdown"
? "countdown"
: "pending";

const existing = await getLifecycleRow(launchId);
const builderWallet = clean(launch?.builder_wallet, 120);
const contractAddress = clean(
launch?.contract_address || launch?.token_mint || launch?.mint_address,
120
);
const lockStatus = resolveLockStatus(
launch,
existing || context.lifecycle,
canonicalStatus,
solReserve > 0 && tokenReserve > 0,
marketBootstrapped
);

if (existing) {
const sets = [];
const values = [];

if (has("launch_status")) {
sets.push("launch_status = ?");
values.push(canonicalStatus);
}
if (has("contract_address")) {
sets.push("contract_address = ?");
values.push(contractAddress);
}
if (has("builder_wallet")) {
sets.push("builder_wallet = ?");
values.push(builderWallet);
}
if (has("market_bootstrapped")) {
sets.push("market_bootstrapped = ?");
values.push(marketBootstrapped ? 1 : 0);
}
if (has("internal_sol_reserve")) {
sets.push("internal_sol_reserve = ?");
values.push(solReserve);
}
if (has("internal_token_reserve")) {
sets.push("internal_token_reserve = ?");
values.push(tokenReserve);
}
if (has("implied_marketcap_sol")) {
sets.push("implied_marketcap_sol = ?");
values.push(impliedMarketcapSol);
}
if (has("graduation_status")) {
sets.push(`
graduation_status = CASE
WHEN COALESCE(graduated, 0) = 1 THEN graduation_status
WHEN graduation_status IS NULL OR graduation_status IN ('pending', 'countdown', 'building', 'internal_live')
THEN ?
ELSE graduation_status
END
`);
values.push(defaultGraduationStatus);
}
if (has("raydium_target_pct")) {
sets.push("raydium_target_pct = COALESCE(raydium_target_pct, ?)");
values.push(RAYDIUM_SPLIT_PCT);
}
if (has("mss_locked_target_pct")) {
sets.push("mss_locked_target_pct = COALESCE(mss_locked_target_pct, ?)");
values.push(MSS_LOCK_SPLIT_PCT);
}
if (has("lock_status")) {
sets.push("lock_status = COALESCE(lock_status, ?)");
values.push(lockStatus);
}
if (has("updated_at")) {
sets.push("updated_at = CURRENT_TIMESTAMP");
}

if (sets.length) {
values.push(launchId);
await db.run(
`
UPDATE launch_liquidity_lifecycle
SET ${sets.join(", ")}
WHERE launch_id = ?
`,
values
);
}
} else {
const insertColumns = ["launch_id"];
const placeholders = ["?"];
const values = [launchId];

if (has("launch_status")) {
insertColumns.push("launch_status");
placeholders.push("?");
values.push(canonicalStatus);
}
if (has("contract_address")) {
insertColumns.push("contract_address");
placeholders.push("?");
values.push(contractAddress);
}
if (has("builder_wallet")) {
insertColumns.push("builder_wallet");
placeholders.push("?");
values.push(builderWallet);
}
if (has("market_bootstrapped")) {
insertColumns.push("market_bootstrapped");
placeholders.push("?");
values.push(marketBootstrapped ? 1 : 0);
}
if (has("internal_sol_reserve")) {
insertColumns.push("internal_sol_reserve");
placeholders.push("?");
values.push(solReserve);
}
if (has("internal_token_reserve")) {
insertColumns.push("internal_token_reserve");
placeholders.push("?");
values.push(tokenReserve);
}
if (has("implied_marketcap_sol")) {
insertColumns.push("implied_marketcap_sol");
placeholders.push("?");
values.push(impliedMarketcapSol);
}
if (has("graduation_status")) {
insertColumns.push("graduation_status");
placeholders.push("?");
values.push(defaultGraduationStatus);
}
if (has("graduated")) {
insertColumns.push("graduated");
placeholders.push("?");
values.push(defaultGraduationStatus === "graduated" ? 1 : 0);
}
if (has("raydium_target_pct")) {
insertColumns.push("raydium_target_pct");
placeholders.push("?");
values.push(RAYDIUM_SPLIT_PCT);
}
if (has("mss_locked_target_pct")) {
insertColumns.push("mss_locked_target_pct");
placeholders.push("?");
values.push(MSS_LOCK_SPLIT_PCT);
}
if (has("lock_status")) {
insertColumns.push("lock_status");
placeholders.push("?");
values.push(lockStatus);
}
if (has("created_at")) {
insertColumns.push("created_at");
placeholders.push("CURRENT_TIMESTAMP");
}
if (has("updated_at")) {
insertColumns.push("updated_at");
placeholders.push("CURRENT_TIMESTAMP");
}

await db.run(
`
INSERT INTO launch_liquidity_lifecycle (${insertColumns.join(", ")})
VALUES (${placeholders.join(", ")})
`,
values
);
}

return getLifecycleRow(launchId);
}

function buildGraduationPlanFromReserves(solReserve, tokenReserve) {
const totalSolReserve = roundSol(solReserve);
const totalTokenReserve = floorToken(tokenReserve);

const raydiumSol = roundSol(totalSolReserve * (RAYDIUM_SPLIT_PCT / 100));
const raydiumToken = floorToken(totalTokenReserve * (RAYDIUM_SPLIT_PCT / 100));
const mssLockedSol = roundSol(totalSolReserve - raydiumSol);
const mssLockedToken = floorToken(totalTokenReserve - raydiumToken);

return {
totalSolReserve,
totalTokenReserve,
raydiumSol,
raydiumToken,
mssLockedSol,
mssLockedToken,
raydiumSplitPct: RAYDIUM_SPLIT_PCT,
mssLockedSplitPct: MSS_LOCK_SPLIT_PCT,
raydiumTargetPct: RAYDIUM_SPLIT_PCT,
mssLockedTargetPct: MSS_LOCK_SPLIT_PCT,
raydium_split_pct: RAYDIUM_SPLIT_PCT,
mss_locked_split_pct: MSS_LOCK_SPLIT_PCT,
raydium_target_pct: RAYDIUM_SPLIT_PCT,
mss_locked_target_pct: MSS_LOCK_SPLIT_PCT,
};
}

function buildGraduationPlan(pool, launch = null, lifecycle = null) {
const solReserve = resolveInternalSolReserve(launch, pool, lifecycle);
const tokenReserve = resolveInternalTokenReserve(launch, pool, lifecycle);
return buildGraduationPlanFromReserves(solReserve, tokenReserve);
}

async function buildGraduationReadiness(
launchId,
launch,
token,
pool,
lifecycle,
context = {}
) {
const thresholds = getGraduationThresholds();

const totalSupply = resolveTotalSupply(launch, token, lifecycle);
const solReserve = resolveInternalSolReserve(launch, pool, lifecycle);
const tokenReserve = resolveInternalTokenReserve(launch, pool, lifecycle);
const priceSol = computeSpotPriceSolPerToken(solReserve, tokenReserve);
const marketcapSol = roundSol(priceSol * totalSupply);
const volume24hSol = await getTrades24hVolume(launchId);
const holderCount = await getHolderCount(launchId);
const liveMinutes = getLiveMinutes(launch);

const canonicalStatus =
context.canonicalStatus || computeCanonicalLifecycleStatus(launch, lifecycle);
const alreadyGraduated =
lifecycleIsGraduated(lifecycle) || canonicalStatus === "graduated";
const marketBootstrapped =
context.marketBootstrapped ??
resolveMarketBootstrapped({
launch,
lifecycle,
token,
pool,
totalSupply,
solReserve,
tokenReserve,
});

const checks = {
liveStatus: canonicalStatus === "live" || canonicalStatus === "graduated",
marketcapReached: marketcapSol >= thresholds.marketcapSol,
volumeReached: volume24hSol >= thresholds.volume24hSol,
holdersReached: holderCount >= thresholds.minHolders,
minimumLiveWindowReached: liveMinutes >= thresholds.minLiveMinutes,
hasReserves: solReserve > 0 && tokenReserve > 0,
marketBootstrapped,
alreadyGraduated,
};

const ready =
!alreadyGraduated &&
checks.liveStatus &&
checks.marketcapReached &&
checks.volumeReached &&
checks.holdersReached &&
checks.minimumLiveWindowReached &&
checks.hasReserves &&
checks.marketBootstrapped;

return {
ready,
reason: ready
? "Graduation thresholds satisfied."
: !checks.hasReserves
? "Internal reserves are still being established."
: !checks.marketBootstrapped
? "Market bootstrap is still being completed."
: !checks.liveStatus
? "Launch is not live yet."
: !checks.marketcapReached
? "Market cap threshold not reached yet."
: !checks.volumeReached
? "24h volume threshold not reached yet."
: !checks.holdersReached
? "Minimum holder threshold not reached yet."
: !checks.minimumLiveWindowReached
? "Minimum live-time window not reached yet."
: alreadyGraduated
? "Launch has already graduated."
: "Graduation conditions are still being monitored.",
thresholds,
metrics: {
marketcapSol,
volume24hSol,
holderCount,
liveMinutes,
solReserve,
tokenReserve,
priceSol,
totalSupply,
},
checks,
};
}

function buildPendingGraduationReadiness({
launch,
token,
pool,
lifecycle = null,
reason,
context = {},
}) {
const thresholds = getGraduationThresholds();
const totalSupply = resolveTotalSupply(launch, token, lifecycle);
const solReserve = resolveInternalSolReserve(launch, pool, lifecycle);
const tokenReserve = resolveInternalTokenReserve(launch, pool, lifecycle);
const canonicalStatus =
context.canonicalStatus || computeCanonicalLifecycleStatus(launch, lifecycle);
const marketBootstrapped =
context.marketBootstrapped ??
resolveMarketBootstrapped({
launch,
lifecycle,
token,
pool,
totalSupply,
solReserve,
tokenReserve,
});

const liveMinutes = getLiveMinutes(launch);
const priceSol = computeSpotPriceSolPerToken(solReserve, tokenReserve);
const marketcapSol = roundSol(priceSol * totalSupply);
const alreadyGraduated =
lifecycleIsGraduated(lifecycle) || canonicalStatus === "graduated";

return {
ready: false,
reason:
reason ||
(canonicalStatus === "commit"
? "Launch is still in commit phase."
: canonicalStatus === "countdown"
? "Countdown is active. Live market has not opened yet."
: canonicalStatus === "building"
? "Market bootstrap is still being completed."
: "Graduation conditions are still being monitored."),
thresholds,
metrics: {
marketcapSol,
volume24hSol: roundSol(0),
holderCount: 0,
liveMinutes,
solReserve,
tokenReserve,
priceSol,
totalSupply,
},
checks: {
liveStatus: canonicalStatus === "live" || canonicalStatus === "graduated",
marketcapReached: false,
volumeReached: false,
holdersReached: false,
minimumLiveWindowReached: false,
hasReserves: solReserve > 0 && tokenReserve > 0,
marketBootstrapped,
alreadyGraduated,
},
};
}

function buildBuilderVestingSummary({ launch, token, vesting, context = {} }) {
const totalSupply = resolveTotalSupply(launch, token, context.lifecycle);
const canonicalStatus =
context.canonicalStatus || computeCanonicalLifecycleStatus(launch, context.lifecycle);
const marketBootstrapped =
context.marketBootstrapped ?? false;

const canUnlock =
marketBootstrapped &&
(canonicalStatus === "live" || canonicalStatus === "graduated");

const canonicalTotalAllocation = computeBuilderTotalAllocation(totalSupply);
const storedTotalAllocation = floorToken(vesting?.total_allocation);
const totalAllocation = Math.max(canonicalTotalAllocation, storedTotalAllocation);

const dailyUnlock = resolveBuilderDailyUnlock(
totalSupply,
totalAllocation,
vesting?.daily_unlock
);

const vestingStartAt = canUnlock
? vesting?.vesting_start_at || clean(launch?.live_at, 120) || null
: null;

const computed = computeBuilderUnlockedAmount({
totalSupply,
totalAllocationOverride: totalAllocation,
dailyUnlockOverride: dailyUnlock,
vestingStartAt,
});

const builderWallet =
clean(vesting?.builder_wallet || launch?.builder_wallet, 120) || null;
const percentUnlocked =
computed.totalAllocation > 0
? Math.max(
0,
Math.min(100, (computed.unlockedAmount / computed.totalAllocation) * 100)
)
: 0;

return {
builderWallet,
builder_wallet: builderWallet,

totalAllocation: computed.totalAllocation,
total_allocation: computed.totalAllocation,

dailyUnlock: computed.dailyUnlock,
daily_unlock: computed.dailyUnlock,

unlockedAmount: computed.unlockedAmount,
unlocked_amount: computed.unlockedAmount,

lockedAmount: computed.lockedAmount,
locked_amount: computed.lockedAmount,

vestingStartAt: vestingStartAt || null,
vesting_start_at: vestingStartAt || null,

createdAt: vesting?.created_at || null,
created_at: vesting?.created_at || null,

updatedAt: vesting?.updated_at || null,
updated_at: vesting?.updated_at || null,

vestedDays: computed.vestedDays,
vested_days: computed.vestedDays,

vestingDaysLive: computed.vestingDaysLive,
vesting_days_live: computed.vestingDaysLive,

unlockDays: BUILDER_UNLOCK_DAYS,
unlock_days: BUILDER_UNLOCK_DAYS,

cliffDays: BUILDER_CLIFF_DAYS,
cliff_days: BUILDER_CLIFF_DAYS,

vestingDays: BUILDER_VESTING_DAYS,
vesting_days: BUILDER_VESTING_DAYS,

totalAllocationPct: BUILDER_TOTAL_ALLOCATION_PCT,
total_allocation_pct: BUILDER_TOTAL_ALLOCATION_PCT,

dailyUnlockPct: BUILDER_DAILY_UNLOCK_PCT,
daily_unlock_pct: BUILDER_DAILY_UNLOCK_PCT,

percentUnlocked,
percent_unlocked: percentUnlocked,

rule: BUILDER_VESTING_RULE,
builder_vesting_rule: BUILDER_VESTING_RULE,
};
}

function buildLifecycleSummary({
launch,
token,
pool,
lifecycle,
vesting,
volume24h,
readiness = null,
context = {},
}) {
const canonicalStatus =
context.canonicalStatus || computeCanonicalLifecycleStatus(launch, lifecycle);
const totalSupply = resolveTotalSupply(launch, token, lifecycle);
const solReserve = resolveInternalSolReserve(launch, pool, lifecycle);
const tokenReserve = resolveInternalTokenReserve(launch, pool, lifecycle);
const price = computeSpotPriceSolPerToken(solReserve, tokenReserve);
const impliedMarketcapSol = roundSol(price * totalSupply);
const marketBootstrapped =
context.marketBootstrapped ??
resolveMarketBootstrapped({
launch,
lifecycle,
token,
pool,
totalSupply,
solReserve,
tokenReserve,
});
const graduationStatus = resolveGraduationStatus(
launch,
lifecycle,
canonicalStatus
);
const graduated =
lifecycleIsGraduated(lifecycle) || canonicalStatus === "graduated";
const hasReserves = solReserve > 0 && tokenReserve > 0;
const builderVesting = buildBuilderVestingSummary({
launch,
token,
vesting,
context: {
canonicalStatus,
marketBootstrapped,
lifecycle,
},
});
const lockStatus = resolveLockStatus(
launch,
lifecycle,
canonicalStatus,
hasReserves,
marketBootstrapped
);
const contractAddress =
clean(
launch?.contract_address ||
launch?.token_mint ||
launch?.mint_address ||
lifecycle?.contract_address,
120
) || null;
const builderWallet =
clean(
launch?.builder_wallet ||
lifecycle?.builder_wallet ||
lifecycle?.builderWallet,
120
) || null;

const updatedAt =
lifecycle?.updated_at ||
vesting?.updated_at ||
launch?.updated_at ||
launch?.created_at ||
null;

return {
launchId: launch?.id || null,
launch_id: launch?.id || null,

status: canonicalStatus,
launchStatus: canonicalStatus,
launch_status: canonicalStatus,

contractAddress,
contract_address: contractAddress,

builderWallet,
builder_wallet: builderWallet,

marketBootstrapped,
market_bootstrapped: marketBootstrapped,

totalSupply,
total_supply: totalSupply,

priceSol: price,
price_sol: price,

marketcapSol: impliedMarketcapSol,
marketcap_sol: impliedMarketcapSol,

impliedMarketcapSol: impliedMarketcapSol,
implied_marketcap_sol: impliedMarketcapSol,

volume24hSol: roundSol(volume24h),
volume_24h_sol: roundSol(volume24h),

internalSolReserve: solReserve,
internal_sol_reserve: solReserve,

internalTokenReserve: tokenReserve,
internal_token_reserve: tokenReserve,

graduationStatus,
graduation_status: graduationStatus,

graduated,
graduationReason:
clean(lifecycle?.graduation_reason ?? lifecycle?.graduationReason, 64) || null,
graduation_reason:
clean(lifecycle?.graduation_reason ?? lifecycle?.graduationReason, 64) || null,
graduatedAt: lifecycle?.graduated_at ?? lifecycle?.graduatedAt ?? null,
graduated_at: lifecycle?.graduated_at ?? lifecycle?.graduatedAt ?? null,

surgeStatus: graduationStatus === "graduated" ? "surged" : graduationStatus,
surge_status: graduationStatus === "graduated" ? "surged" : graduationStatus,
surged: graduated,
surgeReason:
clean(lifecycle?.graduation_reason ?? lifecycle?.graduationReason, 64) || null,
surge_reason:
clean(lifecycle?.graduation_reason ?? lifecycle?.graduationReason, 64) || null,

raydiumTargetPct: safeNum(
lifecycle?.raydium_target_pct ?? lifecycle?.raydiumTargetPct,
RAYDIUM_SPLIT_PCT
),
raydium_target_pct: safeNum(
lifecycle?.raydium_target_pct ?? lifecycle?.raydiumTargetPct,
RAYDIUM_SPLIT_PCT
),

mssLockedTargetPct: safeNum(
lifecycle?.mss_locked_target_pct ?? lifecycle?.mssLockedTargetPct,
MSS_LOCK_SPLIT_PCT
),
mss_locked_target_pct: safeNum(
lifecycle?.mss_locked_target_pct ?? lifecycle?.mssLockedTargetPct,
MSS_LOCK_SPLIT_PCT
),

raydiumPoolId:
clean(lifecycle?.raydium_pool_id ?? lifecycle?.raydiumPoolId, 200) || null,
raydium_pool_id:
clean(lifecycle?.raydium_pool_id ?? lifecycle?.raydiumPoolId, 200) || null,

raydiumSolMigrated: roundSol(
lifecycle?.raydium_sol_migrated ?? lifecycle?.raydiumSolMigrated ?? 0
),
raydium_sol_migrated: roundSol(
lifecycle?.raydium_sol_migrated ?? lifecycle?.raydiumSolMigrated ?? 0
),

raydiumTokenMigrated: floorToken(
lifecycle?.raydium_token_migrated ?? lifecycle?.raydiumTokenMigrated ?? 0
),
raydium_token_migrated: floorToken(
lifecycle?.raydium_token_migrated ?? lifecycle?.raydiumTokenMigrated ?? 0
),

raydiumLpTokens:
clean(lifecycle?.raydium_lp_tokens ?? lifecycle?.raydiumLpTokens, 500) || null,
raydium_lp_tokens:
clean(lifecycle?.raydium_lp_tokens ?? lifecycle?.raydiumLpTokens, 500) || null,

raydiumMigrationTx:
clean(
lifecycle?.raydium_migration_tx ?? lifecycle?.raydiumMigrationTx,
500
) || null,
raydium_migration_tx:
clean(
lifecycle?.raydium_migration_tx ?? lifecycle?.raydiumMigrationTx,
500
) || null,

mssLockedSol: roundSol(
lifecycle?.mss_locked_sol ?? lifecycle?.mssLockedSol ?? 0
),
mss_locked_sol: roundSol(
lifecycle?.mss_locked_sol ?? lifecycle?.mssLockedSol ?? 0
),

mssLockedToken: floorToken(
lifecycle?.mss_locked_token ?? lifecycle?.mssLockedToken ?? 0
),
mss_locked_token: floorToken(
lifecycle?.mss_locked_token ?? lifecycle?.mssLockedToken ?? 0
),

mssLockedLpAmount:
clean(
lifecycle?.mss_locked_lp_amount ?? lifecycle?.mssLockedLpAmount,
500
) || null,
mss_locked_lp_amount:
clean(
lifecycle?.mss_locked_lp_amount ?? lifecycle?.mssLockedLpAmount,
500
) || null,

lockStatus,
lock_status: lockStatus,

lockTx: clean(lifecycle?.lock_tx ?? lifecycle?.lockTx, 500) || null,
lock_tx: clean(lifecycle?.lock_tx ?? lifecycle?.lockTx, 500) || null,

lockExpiresAt:
lifecycle?.lock_expires_at ?? lifecycle?.lockExpiresAt ?? null,
lock_expires_at:
lifecycle?.lock_expires_at ?? lifecycle?.lockExpiresAt ?? null,

createdAt: lifecycle?.created_at || null,
created_at: lifecycle?.created_at || null,
updatedAt,
updated_at: updatedAt,

builderVesting,
builder_vesting: builderVesting,

graduationReadiness: readiness || null,
graduation_readiness: readiness || null,

surgeReadiness: readiness || null,
surge_readiness: readiness || null,
};
}

async function buildLifecycleState(launchId, { persist = false } = {}) {
const launch = await getLaunchRow(launchId);
if (!launch) {
throw new Error("launch not found");
}

let [token, pool, lifecycle, vesting] = await Promise.all([
getTokenRow(launchId),
getPoolRow(launchId),
getLifecycleRow(launchId),
getBuilderVestingRow(launchId),
]);

const volume24h = await getTrades24hVolume(launchId);
let canonicalStatus = computeCanonicalLifecycleStatus(launch, lifecycle);
const totalSupply = resolveTotalSupply(launch, token, lifecycle);
const solReserve = resolveInternalSolReserve(launch, pool, lifecycle);
const tokenReserve = resolveInternalTokenReserve(launch, pool, lifecycle);
let marketBootstrapped = resolveMarketBootstrapped({
launch,
lifecycle,
token,
pool,
totalSupply,
solReserve,
tokenReserve,
});

if (persist && ["building", "live", "graduated"].includes(canonicalStatus)) {
vesting = await ensureBuilderVestingRecord(launchId, launch, token, {
lifecycle,
canonicalStatus,
marketBootstrapped,
});

lifecycle = await ensureLifecycleRecord(launchId, launch, token, pool, {
lifecycle,
canonicalStatus,
marketBootstrapped,
});

canonicalStatus = computeCanonicalLifecycleStatus(launch, lifecycle);
marketBootstrapped = resolveMarketBootstrapped({
launch,
lifecycle,
token,
pool,
totalSupply,
solReserve,
tokenReserve,
});
}

const hasResolvedLiveState =
marketBootstrapped && totalSupply > 0 && solReserve > 0 && tokenReserve > 0;

const readiness =
hasResolvedLiveState &&
(canonicalStatus === "building" ||
canonicalStatus === "live" ||
canonicalStatus === "graduated")
? await buildGraduationReadiness(launchId, launch, token, pool, lifecycle, {
canonicalStatus,
marketBootstrapped,
})
: buildPendingGraduationReadiness({
launch,
token,
pool,
lifecycle,
context: {
canonicalStatus,
marketBootstrapped,
},
reason:
canonicalStatus === "commit"
? "Launch is still in commit phase."
: canonicalStatus === "countdown"
? "Countdown is active. Live market has not opened yet."
: canonicalStatus === "building"
? "Market bootstrap is still being completed."
: "Graduation conditions are still being monitored.",
});

return buildLifecycleSummary({
launch,
token,
pool,
lifecycle,
vesting,
volume24h,
readiness,
context: {
canonicalStatus,
marketBootstrapped,
lifecycle,
},
});
}

export async function syncLiquidityLifecycle(launchId) {
return buildLifecycleState(launchId, { persist: true });
}

export async function getLiquidityLifecycle(launchId) {
return buildLifecycleState(launchId, { persist: false });
}

export async function buildGraduationPlanForLaunch(launchId) {
const launch = await getLaunchRow(launchId);
if (!launch) {
throw new Error("launch not found");
}

const [pool, lifecycle] = await Promise.all([
getPoolRow(launchId),
getLifecycleRow(launchId),
]);

return buildGraduationPlan(pool, launch, lifecycle);
}

export async function evaluateGraduationReadiness(launchId) {
const launch = await getLaunchRow(launchId);
if (!launch) throw new Error("launch not found");

const [token, pool, lifecycle] = await Promise.all([
getTokenRow(launchId),
getPoolRow(launchId),
getLifecycleRow(launchId),
]);

const canonicalStatus = computeCanonicalLifecycleStatus(launch, lifecycle);
const totalSupply = resolveTotalSupply(launch, token, lifecycle);
const solReserve = resolveInternalSolReserve(launch, pool, lifecycle);
const tokenReserve = resolveInternalTokenReserve(launch, pool, lifecycle);
const marketBootstrapped = resolveMarketBootstrapped({
launch,
lifecycle,
token,
pool,
totalSupply,
solReserve,
tokenReserve,
});

const hasResolvedLiveState =
marketBootstrapped && totalSupply > 0 && solReserve > 0 && tokenReserve > 0;

if (!hasResolvedLiveState) {
return buildPendingGraduationReadiness({
launch,
token,
pool,
lifecycle,
context: {
canonicalStatus,
marketBootstrapped,
},
reason:
canonicalStatus === "commit"
? "Launch is still in commit phase."
: canonicalStatus === "countdown"
? "Countdown is active. Live market has not opened yet."
: canonicalStatus === "building"
? "Market bootstrap is still being completed."
: "Graduation conditions are still being monitored.",
});
}

return buildGraduationReadiness(launchId, launch, token, pool, lifecycle, {
canonicalStatus,
marketBootstrapped,
});
}

export async function markLaunchGraduatedLifecycle({
launchId,
reason = "manual",
raydiumPoolId = "",
raydiumMigrationTx = "",
lockTx = "",
raydiumLpTokens = "",
mssLockedLpAmount = "",
lockExpiresAt = "",
} = {}) {
if (!(await tableExists("launch_liquidity_lifecycle"))) {
throw new Error("launch_liquidity_lifecycle table not found");
}

const launch = await getLaunchRow(launchId);
if (!launch) {
throw new Error("launch not found");
}

const [token, pool] = await Promise.all([
getTokenRow(launchId),
getPoolRow(launchId),
]);

if (!pool) {
throw new Error("pool not found for launch");
}

await ensureLifecycleRecord(launchId, launch, token, pool, {
canonicalStatus: "graduated",
marketBootstrapped: true,
lifecycle: await getLifecycleRow(launchId),
});

const plan = buildGraduationPlan(pool, launch, await getLifecycleRow(launchId));
const columns = await getTableColumns("launch_liquidity_lifecycle");
const has = (name) => columns.has(name);

const sets = [];
const values = [];

if (has("launch_status")) {
sets.push("launch_status = ?");
values.push("graduated");
}
if (has("market_bootstrapped")) {
sets.push("market_bootstrapped = ?");
values.push(1);
}
if (has("graduation_status")) {
sets.push("graduation_status = ?");
values.push("graduated");
}
if (has("graduated")) {
sets.push("graduated = ?");
values.push(1);
}
if (has("graduation_reason")) {
sets.push("graduation_reason = ?");
values.push(clean(reason, 120));
}
if (has("graduated_at")) {
sets.push("graduated_at = CURRENT_TIMESTAMP");
}
if (has("raydium_sol_migrated")) {
sets.push("raydium_sol_migrated = ?");
values.push(plan.raydiumSol);
}
if (has("raydium_token_migrated")) {
sets.push("raydium_token_migrated = ?");
values.push(plan.raydiumToken);
}
if (has("raydium_pool_id")) {
sets.push("raydium_pool_id = ?");
values.push(clean(raydiumPoolId, 200));
}
if (has("raydium_migration_tx")) {
sets.push("raydium_migration_tx = ?");
values.push(clean(raydiumMigrationTx, 500));
}
if (has("raydium_lp_tokens")) {
sets.push("raydium_lp_tokens = ?");
values.push(clean(raydiumLpTokens, 500));
}
if (has("mss_locked_sol")) {
sets.push("mss_locked_sol = ?");
values.push(plan.mssLockedSol);
}
if (has("mss_locked_token")) {
sets.push("mss_locked_token = ?");
values.push(plan.mssLockedToken);
}
if (has("mss_locked_lp_amount")) {
sets.push("mss_locked_lp_amount = ?");
values.push(clean(mssLockedLpAmount, 500));
}
if (has("lock_status")) {
sets.push("lock_status = ?");
values.push(lockTx ? "locked" : "locked_pending_proof");
}
if (has("lock_tx")) {
sets.push("lock_tx = ?");
values.push(clean(lockTx, 500));
}
if (has("lock_expires_at")) {
sets.push("lock_expires_at = ?");
values.push(clean(lockExpiresAt, 120));
}
if (has("updated_at")) {
sets.push("updated_at = CURRENT_TIMESTAMP");
}

if (!sets.length) {
throw new Error("launch_liquidity_lifecycle schema missing expected columns");
}

values.push(launchId);

await db.run(
`
UPDATE launch_liquidity_lifecycle
SET ${sets.join(", ")}
WHERE launch_id = ?
`,
values
);

await db.run(
`
UPDATE pools
SET status = 'graduated',
graduated_at = CURRENT_TIMESTAMP
WHERE launch_id = ?
`,
[launchId]
);

await db.run(
`
UPDATE launches
SET status = 'graduated',
market_bootstrapped = CASE
WHEN market_bootstrapped IS NULL THEN 1
ELSE market_bootstrapped
END,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launchId]
);

return getLiquidityLifecycle(launchId);
}

export async function executeLaunchGraduation({
launchId,
reason = "thresholds_met",
raydiumPoolId = "",
raydiumMigrationTx = "",
lockTx = "",
raydiumLpTokens = "",
mssLockedLpAmount = "",
lockDays = null,
allowUnsafe = false,
} = {}) {
const launch = await getLaunchRow(launchId);
if (!launch) {
throw new Error("launch not found");
}

const token = await getTokenRow(launchId);
if (!token) {
throw new Error("token not found for launch");
}

const pool = await getPoolRow(launchId);
if (!pool) {
throw new Error("pool not found for launch");
}

const lifecycle = await ensureLifecycleRecord(launchId, launch, token, pool, {
lifecycle: await getLifecycleRow(launchId),
canonicalStatus: computeCanonicalLifecycleStatus(
launch,
await getLifecycleRow(launchId)
),
});

const readiness = await buildGraduationReadiness(
launchId,
launch,
token,
pool,
lifecycle
);

if (!allowUnsafe && !readiness.ready) {
const unmet = Object.entries(readiness.checks)
.filter(([key, value]) => {
if (key === "alreadyGraduated") return false;
return value === false;
})
.map(([key]) => key);

throw new Error(
`launch not ready for graduation: ${
unmet.length ? unmet.join(", ") : "conditions not met"
}`
);
}

if (readiness.checks.alreadyGraduated) {
return {
ok: true,
alreadyGraduated: true,
lifecycle: await getLiquidityLifecycle(launchId),
plan: buildGraduationPlan(pool, launch, lifecycle),
readiness,
};
}

const lockExpiry = clean(
lockDays != null
? addDaysIso(lockDays)
: addDaysIso(getGraduationThresholds().lockDays),
120
);

const updatedLifecycle = await markLaunchGraduatedLifecycle({
launchId,
reason,
raydiumPoolId,
raydiumMigrationTx,
lockTx,
raydiumLpTokens,
mssLockedLpAmount,
lockExpiresAt: lockExpiry,
});

return {
ok: true,
alreadyGraduated: false,
lifecycle: updatedLifecycle,
plan: buildGraduationPlan(pool, launch, updatedLifecycle),
readiness,
};
}