import db from "../../db/index.js";

const BUILDER_TOTAL_ALLOCATION_PCT = 5;
const BUILDER_DAILY_UNLOCK_PCT = 0.5;
const RAYDIUM_SPLIT_PCT = 50;
const MSS_LOCK_SPLIT_PCT = 50;

const DEFAULT_GRADUATION_MARKETCAP_SOL = 120;
const DEFAULT_GRADUATION_VOLUME_24H_SOL = 80;
const DEFAULT_GRADUATION_MIN_HOLDERS = 25;
const DEFAULT_GRADUATION_MIN_LIVE_MINUTES = 15;
const DEFAULT_MSS_LOCK_DAYS = 90;

function safeNum(value, fallback = 0) {
const n = Number(value);
return Number.isFinite(n) ? n : fallback;
}

function floorToken(value) {
return Math.floor(safeNum(value, 0));
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

if (!hasExplicitTimezone && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
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
const ms = Date.now() + Math.max(0, safeNum(days, 0)) * 86400000;
return new Date(ms).toISOString();
}

async function tableExists(tableName) {
const row = await db.get(
`
SELECT name
FROM sqlite_master
WHERE type = 'table' AND name = ?
LIMIT 1
`,
[tableName]
);

return Boolean(row?.name);
}

async function getTableColumns(tableName) {
const rows = await db.all(`PRAGMA table_info(${tableName})`);
return new Set(rows.map((row) => String(row.name || "").trim()));
}

function computeSpotPriceSolPerToken(solReserve, tokenReserve) {
const sol = safeNum(solReserve, 0);
const tokens = safeNum(tokenReserve, 0);

if (sol <= 0 || tokens <= 0) return 0;
return sol / tokens;
}

function computeBuilderTotalAllocation(totalSupply) {
return floorToken((safeNum(totalSupply, 0) * BUILDER_TOTAL_ALLOCATION_PCT) / 100);
}

function computeBuilderDailyUnlock(totalSupply) {
return floorToken((safeNum(totalSupply, 0) * BUILDER_DAILY_UNLOCK_PCT) / 100);
}

function computeBuilderUnlockedAmount({
totalSupply,
vestingStartAt,
now = Date.now(),
}) {
const totalAllocation = computeBuilderTotalAllocation(totalSupply);
const dailyUnlock = computeBuilderDailyUnlock(totalSupply);

if (totalAllocation <= 0 || dailyUnlock <= 0) {
return {
totalAllocation,
dailyUnlock,
unlockedAmount: 0,
lockedAmount: 0,
vestedDays: 0,
};
}

const startMs = parseDbTime(vestingStartAt);
if (!startMs) {
const unlockedAmount = Math.min(totalAllocation, dailyUnlock);
return {
totalAllocation,
dailyUnlock,
unlockedAmount,
lockedAmount: Math.max(0, totalAllocation - unlockedAmount),
vestedDays: 1,
};
}

const elapsedMs = Math.max(0, now - startMs);
const elapsedDays = Math.floor(elapsedMs / 86400000);
const vestedDays = elapsedDays + 1;
const unlockedAmount = Math.min(totalAllocation, dailyUnlock * vestedDays);

return {
totalAllocation,
dailyUnlock,
unlockedAmount,
lockedAmount: Math.max(0, totalAllocation - unlockedAmount),
vestedDays,
};
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
SELECT COALESCE(SUM(sol_amount), 0) AS total
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

const row = await db.get(
`
SELECT COUNT(*) AS total
FROM wallet_balances
WHERE launch_id = ?
AND COALESCE(token_amount, 0) > 0
`,
[launchId]
);

return safeNum(row?.total, 0);
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
safeNum(process.env.MSS_GRADUATION_MIN_HOLDERS, DEFAULT_GRADUATION_MIN_HOLDERS)
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
Math.floor(safeNum(process.env.MSS_LP_LOCK_DAYS, DEFAULT_MSS_LOCK_DAYS))
),
};
}

function getLiveMinutes(launch) {
const liveMs = parseDbTime(launch?.live_at || launch?.updated_at || launch?.created_at);
if (!liveMs) return 0;
return Math.max(0, Math.floor((Date.now() - liveMs) / 60000));
}

async function ensureBuilderVestingRecord(launchId, launch, token) {
if (!(await tableExists("builder_vesting"))) return null;

const columns = await getTableColumns("builder_vesting");
const has = (name) => columns.has(name);

const totalSupply = floorToken(
token?.supply ||
launch?.final_supply ||
launch?.supply ||
0
);

const builderWallet = clean(launch?.builder_wallet, 120);
const vestingStartAt = clean(launch?.live_at, 120) || nowIso();

const computed = computeBuilderUnlockedAmount({
totalSupply,
vestingStartAt,
});

const existing = await getBuilderVestingRow(launchId);

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
sets.push("vesting_start_at = COALESCE(vesting_start_at, ?)");
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

async function ensureLifecycleRecord(launchId, launch, token, pool) {
if (!(await tableExists("launch_liquidity_lifecycle"))) return null;

const columns = await getTableColumns("launch_liquidity_lifecycle");
const has = (name) => columns.has(name);

const totalSupply = floorToken(
token?.supply ||
launch?.final_supply ||
launch?.supply ||
0
);

const solReserve = roundSol(pool?.sol_reserve || 0);
const tokenReserve = floorToken(pool?.token_reserve || 0);
const impliedMarketcapSol = roundSol(
computeSpotPriceSolPerToken(solReserve, tokenReserve) * totalSupply
);

const existing = await getLifecycleRow(launchId);

if (existing) {
const sets = [];
const values = [];

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
sets.push(
"graduation_status = CASE WHEN COALESCE(graduated, 0) = 1 THEN graduation_status ELSE COALESCE(graduation_status, 'internal_live') END"
);
}
if (has("raydium_target_pct")) {
sets.push("raydium_target_pct = COALESCE(raydium_target_pct, ?)");
values.push(RAYDIUM_SPLIT_PCT);
}
if (has("mss_locked_target_pct")) {
sets.push("mss_locked_target_pct = COALESCE(mss_locked_target_pct, ?)");
values.push(MSS_LOCK_SPLIT_PCT);
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
values.push("internal_live");
}
if (has("graduated")) {
insertColumns.push("graduated");
placeholders.push("?");
values.push(0);
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
values.push("not_locked");
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

function buildGraduationPlan(pool) {
const solReserve = roundSol(pool?.sol_reserve || 0);
const tokenReserve = floorToken(pool?.token_reserve || 0);

const raydiumSol = roundSol(solReserve * (RAYDIUM_SPLIT_PCT / 100));
const raydiumToken = floorToken(tokenReserve * (RAYDIUM_SPLIT_PCT / 100));
const mssLockedSol = roundSol(solReserve - raydiumSol);
const mssLockedToken = floorToken(tokenReserve - raydiumToken);

return {
totalSolReserve: solReserve,
totalTokenReserve: tokenReserve,
raydiumSol,
raydiumToken,
mssLockedSol,
mssLockedToken,
raydiumSplitPct: RAYDIUM_SPLIT_PCT,
mssLockedSplitPct: MSS_LOCK_SPLIT_PCT,
};
}

async function buildGraduationReadiness(launchId, launch, token, pool, lifecycle) {
const thresholds = getGraduationThresholds();

const totalSupply = floorToken(
token?.supply ||
launch?.final_supply ||
launch?.supply ||
0
);

const solReserve = roundSol(pool?.sol_reserve || lifecycle?.internal_sol_reserve || 0);
const tokenReserve = floorToken(pool?.token_reserve || lifecycle?.internal_token_reserve || 0);
const priceSol = computeSpotPriceSolPerToken(solReserve, tokenReserve);
const marketcapSol = roundSol(priceSol * totalSupply);
const volume24hSol = await getTrades24hVolume(launchId);
const holderCount = await getHolderCount(launchId);
const liveMinutes = getLiveMinutes(launch);

const status = clean(launch?.status, 64).toLowerCase();
const alreadyGraduated =
safeNum(lifecycle?.graduated, 0) === 1 || status === "graduated";

const checks = {
liveStatus: status === "live" || status === "graduated" || status === "building",
marketcapReached: marketcapSol >= thresholds.marketcapSol,
volumeReached: volume24hSol >= thresholds.volume24hSol,
holdersReached: holderCount >= thresholds.minHolders,
minimumLiveWindowReached: liveMinutes >= thresholds.minLiveMinutes,
hasReserves: solReserve > 0 && tokenReserve > 0,
alreadyGraduated,
};

const ready =
!alreadyGraduated &&
checks.liveStatus &&
checks.marketcapReached &&
checks.volumeReached &&
checks.holdersReached &&
checks.minimumLiveWindowReached &&
checks.hasReserves;

return {
ready,
reason: ready
? "Graduation thresholds satisfied."
: !checks.hasReserves
? "Internal reserves are still being established."
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

function buildLifecycleSummary({
launch,
token,
pool,
lifecycle,
vesting,
volume24h,
readiness = null,
}) {
const totalSupply = floorToken(
token?.supply ||
launch?.final_supply ||
launch?.supply ||
0
);

const solReserve = roundSol(pool?.sol_reserve || lifecycle?.internal_sol_reserve || 0);
const tokenReserve = floorToken(pool?.token_reserve || lifecycle?.internal_token_reserve || 0);
const price = computeSpotPriceSolPerToken(solReserve, tokenReserve);
const marketcapSol = roundSol(price * totalSupply);

const vestComputed = computeBuilderUnlockedAmount({
totalSupply,
vestingStartAt: vesting?.vesting_start_at || launch?.live_at,
});

return {
launchId: launch?.id || null,
launchStatus: clean(launch?.status, 64).toLowerCase() || null,
contractAddress: clean(launch?.contract_address, 120) || null,
builderWallet: clean(launch?.builder_wallet, 120) || null,

totalSupply,
priceSol: price,
marketcapSol,
volume24hSol: roundSol(volume24h),

internalSolReserve: solReserve,
internalTokenReserve: tokenReserve,

graduationStatus:
clean(lifecycle?.graduation_status, 64) ||
(clean(launch?.status, 64).toLowerCase() === "graduated" ? "graduated" : "internal_live"),
graduated: safeNum(lifecycle?.graduated, 0) === 1,
graduationReason: clean(lifecycle?.graduation_reason, 64) || null,
graduatedAt: lifecycle?.graduated_at || null,

raydiumTargetPct: safeNum(lifecycle?.raydium_target_pct, RAYDIUM_SPLIT_PCT),
mssLockedTargetPct: safeNum(lifecycle?.mss_locked_target_pct, MSS_LOCK_SPLIT_PCT),
raydiumPoolId: clean(lifecycle?.raydium_pool_id, 200) || null,
raydiumSolMigrated: roundSol(lifecycle?.raydium_sol_migrated || 0),
raydiumTokenMigrated: floorToken(lifecycle?.raydium_token_migrated || 0),
raydiumLpTokens: clean(lifecycle?.raydium_lp_tokens, 500) || null,
raydiumMigrationTx: clean(lifecycle?.raydium_migration_tx, 500) || null,

mssLockedSol: roundSol(lifecycle?.mss_locked_sol || 0),
mssLockedToken: floorToken(lifecycle?.mss_locked_token || 0),
mssLockedLpAmount: clean(lifecycle?.mss_locked_lp_amount, 500) || null,
lockStatus: clean(lifecycle?.lock_status, 64) || "not_locked",
lockTx: clean(lifecycle?.lock_tx, 500) || null,
lockExpiresAt: lifecycle?.lock_expires_at || null,

builderVesting: {
totalAllocation: floorToken(vesting?.total_allocation || vestComputed.totalAllocation),
dailyUnlock: floorToken(vesting?.daily_unlock || vestComputed.dailyUnlock),
unlockedAmount: floorToken(vesting?.unlocked_amount || vestComputed.unlockedAmount),
lockedAmount: floorToken(vesting?.locked_amount || vestComputed.lockedAmount),
vestingStartAt: vesting?.vesting_start_at || launch?.live_at || null,
vestedDays: vestComputed.vestedDays,
},

graduationReadiness: readiness || null,
};
}

export async function syncLiquidityLifecycle(launchId) {
const launch = await getLaunchRow(launchId);
if (!launch) {
throw new Error("launch not found");
}

const status = clean(launch?.status, 64).toLowerCase();
if (!["building", "live", "graduated"].includes(status)) {
throw new Error("token not found for launch");
}

const token = await getTokenRow(launchId);
const pool = await getPoolRow(launchId);

if (!token || !pool) {
return {
launchId: launch?.id || null,
launchStatus: status || null,
contractAddress: clean(launch?.contract_address, 120) || null,
builderWallet: clean(launch?.builder_wallet, 120) || null,
totalSupply: floorToken(launch?.final_supply || launch?.supply || 0),
priceSol: safeNum(launch?.price, 0),
marketcapSol: safeNum(launch?.market_cap, 0),
volume24hSol: safeNum(launch?.volume_24h, 0),
internalSolReserve: safeNum(launch?.internal_pool_sol || launch?.liquidity || 0, 0),
internalTokenReserve: floorToken(launch?.internal_pool_tokens || 0),
graduationStatus: status === "graduated" ? "graduated" : "building",
graduated: status === "graduated",
graduationReason: null,
graduatedAt: null,
raydiumTargetPct: RAYDIUM_SPLIT_PCT,
mssLockedTargetPct: MSS_LOCK_SPLIT_PCT,
raydiumPoolId: null,
raydiumSolMigrated: 0,
raydiumTokenMigrated: 0,
raydiumLpTokens: null,
raydiumMigrationTx: null,
mssLockedSol: 0,
mssLockedToken: 0,
mssLockedLpAmount: null,
lockStatus: "not_locked",
lockTx: null,
lockExpiresAt: null,
builderVesting: {
totalAllocation: computeBuilderTotalAllocation(
floorToken(launch?.final_supply || launch?.supply || 0)
),
dailyUnlock: computeBuilderDailyUnlock(
floorToken(launch?.final_supply || launch?.supply || 0)
),
unlockedAmount: 0,
lockedAmount: computeBuilderTotalAllocation(
floorToken(launch?.final_supply || launch?.supply || 0)
),
vestingStartAt: launch?.live_at || null,
vestedDays: 0,
},
graduationReadiness: {
ready: false,
reason: "Market bootstrap is still being completed.",
thresholds: getGraduationThresholds(),
metrics: {
marketcapSol: safeNum(launch?.market_cap, 0),
volume24hSol: safeNum(launch?.volume_24h, 0),
holderCount: 0,
liveMinutes: getLiveMinutes(launch),
solReserve: safeNum(launch?.internal_pool_sol || launch?.liquidity || 0, 0),
tokenReserve: floorToken(launch?.internal_pool_tokens || 0),
priceSol: safeNum(launch?.price, 0),
totalSupply: floorToken(launch?.final_supply || launch?.supply || 0),
},
checks: {
liveStatus: status === "building" || status === "live" || status === "graduated",
marketcapReached: false,
volumeReached: false,
holdersReached: false,
minimumLiveWindowReached: false,
hasReserves: false,
alreadyGraduated: status === "graduated",
},
},
};
}

const vesting = await ensureBuilderVestingRecord(launchId, launch, token);
const lifecycle = await ensureLifecycleRecord(launchId, launch, token, pool);
const volume24h = await getTrades24hVolume(launchId);
const readiness = await buildGraduationReadiness(
launchId,
launch,
token,
pool,
lifecycle
);

return buildLifecycleSummary({
launch,
token,
pool,
lifecycle,
vesting,
volume24h,
readiness,
});
}

export async function getLiquidityLifecycle(launchId) {
const launch = await getLaunchRow(launchId);
if (!launch) {
throw new Error("launch not found");
}

const status = clean(launch?.status, 64).toLowerCase();
const token = await getTokenRow(launchId);
const pool = await getPoolRow(launchId);
const lifecycle = await getLifecycleRow(launchId);
const vesting = await getBuilderVestingRow(launchId);
const volume24h = await getTrades24hVolume(launchId);

if (!token || !pool) {
return {
launchId: launch?.id || null,
launchStatus: status || null,
contractAddress: clean(launch?.contract_address, 120) || null,
builderWallet: clean(launch?.builder_wallet, 120) || null,
totalSupply: floorToken(launch?.final_supply || launch?.supply || 0),
priceSol: safeNum(launch?.price, 0),
marketcapSol: safeNum(launch?.market_cap, 0),
volume24hSol: safeNum(launch?.volume_24h, 0),
internalSolReserve: safeNum(launch?.internal_pool_sol || launch?.liquidity || 0, 0),
internalTokenReserve: floorToken(launch?.internal_pool_tokens || 0),
graduationStatus:
clean(lifecycle?.graduation_status, 64) ||
(status === "graduated" ? "graduated" : "building"),
graduated: safeNum(lifecycle?.graduated, 0) === 1 || status === "graduated",
graduationReason: clean(lifecycle?.graduation_reason, 64) || null,
graduatedAt: lifecycle?.graduated_at || null,
raydiumTargetPct: safeNum(lifecycle?.raydium_target_pct, RAYDIUM_SPLIT_PCT),
mssLockedTargetPct: safeNum(lifecycle?.mss_locked_target_pct, MSS_LOCK_SPLIT_PCT),
raydiumPoolId: clean(lifecycle?.raydium_pool_id, 200) || null,
raydiumSolMigrated: roundSol(lifecycle?.raydium_sol_migrated || 0),
raydiumTokenMigrated: floorToken(lifecycle?.raydium_token_migrated || 0),
raydiumLpTokens: clean(lifecycle?.raydium_lp_tokens, 500) || null,
raydiumMigrationTx: clean(lifecycle?.raydium_migration_tx, 500) || null,
mssLockedSol: roundSol(lifecycle?.mss_locked_sol || 0),
mssLockedToken: floorToken(lifecycle?.mss_locked_token || 0),
mssLockedLpAmount: clean(lifecycle?.mss_locked_lp_amount, 500) || null,
lockStatus: clean(lifecycle?.lock_status, 64) || "not_locked",
lockTx: clean(lifecycle?.lock_tx, 500) || null,
lockExpiresAt: lifecycle?.lock_expires_at || null,
builderVesting: {
totalAllocation: floorToken(
vesting?.total_allocation ||
computeBuilderTotalAllocation(
floorToken(launch?.final_supply || launch?.supply || 0)
)
),
dailyUnlock: floorToken(
vesting?.daily_unlock ||
computeBuilderDailyUnlock(
floorToken(launch?.final_supply || launch?.supply || 0)
)
),
unlockedAmount: floorToken(vesting?.unlocked_amount || 0),
lockedAmount: floorToken(
vesting?.locked_amount ||
computeBuilderTotalAllocation(
floorToken(launch?.final_supply || launch?.supply || 0)
)
),
vestingStartAt: vesting?.vesting_start_at || launch?.live_at || null,
vestedDays: 0,
},
graduationReadiness: {
ready: false,
reason: "Market bootstrap is still being completed.",
thresholds: getGraduationThresholds(),
metrics: {
marketcapSol: safeNum(launch?.market_cap, 0),
volume24hSol: volume24h,
holderCount: 0,
liveMinutes: getLiveMinutes(launch),
solReserve: safeNum(launch?.internal_pool_sol || launch?.liquidity || 0, 0),
tokenReserve: floorToken(launch?.internal_pool_tokens || 0),
priceSol: safeNum(launch?.price, 0),
totalSupply: floorToken(launch?.final_supply || launch?.supply || 0),
},
checks: {
liveStatus: status === "building" || status === "live" || status === "graduated",
marketcapReached: false,
volumeReached: false,
holdersReached: false,
minimumLiveWindowReached: false,
hasReserves: false,
alreadyGraduated: status === "graduated",
},
},
};
}

const readiness = await buildGraduationReadiness(launchId, launch, token, pool, lifecycle);

return buildLifecycleSummary({
launch,
token,
pool,
lifecycle,
vesting,
volume24h,
readiness,
});
}

export async function buildGraduationPlanForLaunch(launchId) {
const pool = await getPoolRow(launchId);
if (!pool) {
throw new Error("pool not found for launch");
}

return buildGraduationPlan(pool);
}

export async function evaluateGraduationReadiness(launchId) {
const launch = await getLaunchRow(launchId);
if (!launch) throw new Error("launch not found");

const token = await getTokenRow(launchId);
if (!token) throw new Error("token not found for launch");

const pool = await getPoolRow(launchId);
if (!pool) throw new Error("pool not found for launch");

const lifecycle = await getLifecycleRow(launchId);

return buildGraduationReadiness(launchId, launch, token, pool, lifecycle);
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

const pool = await getPoolRow(launchId);
if (!pool) {
throw new Error("pool not found for launch");
}

const plan = buildGraduationPlan(pool);
const columns = await getTableColumns("launch_liquidity_lifecycle");
const has = (name) => columns.has(name);

const sets = [];
const values = [];

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

const lifecycle = await ensureLifecycleRecord(launchId, launch, token, pool);
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
`launch not ready for graduation: ${unmet.length ? unmet.join(", ") : "conditions not met"}`
);
}

if (readiness.checks.alreadyGraduated) {
return {
ok: true,
alreadyGraduated: true,
lifecycle: await getLiquidityLifecycle(launchId),
plan: buildGraduationPlan(pool),
readiness,
};
}

const lockExpiry = clean(
lockDays != null ? addDaysIso(lockDays) : addDaysIso(getGraduationThresholds().lockDays),
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
plan: buildGraduationPlan(pool),
readiness,
};
}
