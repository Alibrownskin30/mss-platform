import db from "../../db/index.js";

const GRADUATION_MARKETCAP_SOL = 2500; // placeholder target
const REMAINING_POOL_THRESHOLD = 0.10; // 10% remaining = 90% sold
const RAYDIUM_SPLIT_PCT = 0.5; // 50%
const MSS_LOCK_SPLIT_PCT = 0.5; // 50%

let lifecycleColumnsCache = null;

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

async function getLifecycleColumns() {
if (!lifecycleColumnsCache) {
if (await tableExists("launch_liquidity_lifecycle")) {
const rows = await db.all(`PRAGMA table_info(launch_liquidity_lifecycle)`);
lifecycleColumnsCache = new Set(rows.map((row) => String(row.name || "").trim()));
} else {
lifecycleColumnsCache = new Set();
}
}

return lifecycleColumnsCache;
}

async function lifecycleHasColumn(columnName) {
const columns = await getLifecycleColumns();
return columns.has(columnName);
}

async function getActivePools() {
return db.all(
`
SELECT
p.*,
t.supply AS token_supply,
t.name AS token_name,
t.symbol AS token_symbol,
l.status AS launch_status,
l.contract_address,
l.builder_wallet,
l.final_supply,
l.circulating_supply,
l.internal_pool_sol,
l.internal_pool_tokens
FROM pools p
JOIN tokens t ON t.id = p.token_id
JOIN launches l ON l.id = p.launch_id
WHERE p.status = 'active'
AND l.status IN ('live', 'active')
`
);
}

function calculateMarketCapInSol(pool) {
const tokenReserve = safeNum(pool.token_reserve, 0);
const solReserve = safeNum(pool.sol_reserve, 0);
const supply = safeNum(
pool.final_supply || pool.circulating_supply || pool.token_supply,
0
);

if (tokenReserve <= 0 || solReserve <= 0 || supply <= 0) return 0;

const priceInSol = solReserve / tokenReserve;
return priceInSol * supply;
}

function hasReachedPoolSoldThreshold(pool) {
const initialReserve = safeNum(pool.initial_token_reserve, 0);
const currentReserve = safeNum(pool.token_reserve, 0);

if (initialReserve <= 0 || currentReserve <= 0) return false;

return currentReserve <= initialReserve * REMAINING_POOL_THRESHOLD;
}

function getGraduationReason(pool) {
const marketCapInSol = calculateMarketCapInSol(pool);
const soldThresholdHit = hasReachedPoolSoldThreshold(pool);

if (marketCapInSol >= GRADUATION_MARKETCAP_SOL) {
return {
shouldGraduate: true,
reason: "marketcap",
marketCapInSol,
soldThresholdHit,
};
}

if (soldThresholdHit) {
return {
shouldGraduate: true,
reason: "pool_sold",
marketCapInSol,
soldThresholdHit,
};
}

return {
shouldGraduate: false,
reason: null,
marketCapInSol,
soldThresholdHit,
};
}

function buildGraduationSplit(pool) {
const solReserve = safeNum(pool.sol_reserve, 0);
const tokenReserve = safeNum(pool.token_reserve, 0);

if (solReserve <= 0 || tokenReserve <= 0) {
throw new Error("cannot graduate pool with empty reserves");
}

const raydiumSol = roundSol(solReserve * RAYDIUM_SPLIT_PCT);
const raydiumTokens = floorToken(tokenReserve * RAYDIUM_SPLIT_PCT);

const mssLockedSol = roundSol(solReserve - raydiumSol);
const mssLockedTokens = floorToken(tokenReserve - raydiumTokens);

return {
totalSolReserve: roundSol(solReserve),
totalTokenReserve: floorToken(tokenReserve),
raydiumSol,
raydiumTokens,
mssLockedSol,
mssLockedTokens,
raydiumSplitPct: RAYDIUM_SPLIT_PCT * 100,
mssLockSplitPct: MSS_LOCK_SPLIT_PCT * 100,
};
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

async function ensureLifecycleSeed(pool, marketCapInSol) {
if (!(await tableExists("launch_liquidity_lifecycle"))) {
return null;
}

const existing = await getLifecycleRow(pool.launch_id);
const split = buildGraduationSplit(pool);
const columns = await getLifecycleColumns();
const has = (name) => columns.has(name);

if (existing) {
const sets = [];
const values = [];

if (has("internal_sol_reserve")) {
sets.push("internal_sol_reserve = ?");
values.push(split.totalSolReserve);
}
if (has("internal_token_reserve")) {
sets.push("internal_token_reserve = ?");
values.push(split.totalTokenReserve);
}
if (has("implied_marketcap_sol")) {
sets.push("implied_marketcap_sol = ?");
values.push(roundSol(marketCapInSol));
}
if (has("updated_at")) {
sets.push("updated_at = CURRENT_TIMESTAMP");
}

if (sets.length) {
values.push(pool.launch_id);
await db.run(
`
UPDATE launch_liquidity_lifecycle
SET ${sets.join(", ")}
WHERE launch_id = ?
`,
values
);
}

return getLifecycleRow(pool.launch_id);
}

const insertColumns = ["launch_id"];
const placeholders = ["?"];
const values = [pool.launch_id];

if (has("internal_sol_reserve")) {
insertColumns.push("internal_sol_reserve");
placeholders.push("?");
values.push(split.totalSolReserve);
}
if (has("internal_token_reserve")) {
insertColumns.push("internal_token_reserve");
placeholders.push("?");
values.push(split.totalTokenReserve);
}
if (has("graduation_status")) {
insertColumns.push("graduation_status");
placeholders.push("?");
values.push("eligible");
}
if (has("graduated")) {
insertColumns.push("graduated");
placeholders.push("?");
values.push(0);
}
if (has("implied_marketcap_sol")) {
insertColumns.push("implied_marketcap_sol");
placeholders.push("?");
values.push(roundSol(marketCapInSol));
}
if (has("raydium_target_pct")) {
insertColumns.push("raydium_target_pct");
placeholders.push("?");
values.push(RAYDIUM_SPLIT_PCT * 100);
}
if (has("mss_locked_target_pct")) {
insertColumns.push("mss_locked_target_pct");
placeholders.push("?");
values.push(MSS_LOCK_SPLIT_PCT * 100);
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

return getLifecycleRow(pool.launch_id);
}

async function persistGraduationLifecycle(pool, reason, marketCapInSol) {
if (!(await tableExists("launch_liquidity_lifecycle"))) {
return {
split: buildGraduationSplit(pool),
lifecycle: null,
};
}

const split = buildGraduationSplit(pool);
const columns = await getLifecycleColumns();
const has = (name) => columns.has(name);

const existing = await getLifecycleRow(pool.launch_id);

if (!existing) {
await ensureLifecycleSeed(pool, marketCapInSol);
}

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
values.push(reason);
}
if (has("graduated_at")) {
sets.push("graduated_at = CURRENT_TIMESTAMP");
}
if (has("implied_marketcap_sol")) {
sets.push("implied_marketcap_sol = ?");
values.push(roundSol(marketCapInSol));
}
if (has("raydium_sol_migrated")) {
sets.push("raydium_sol_migrated = ?");
values.push(split.raydiumSol);
}
if (has("raydium_token_migrated")) {
sets.push("raydium_token_migrated = ?");
values.push(split.raydiumTokens);
}
if (has("mss_locked_sol")) {
sets.push("mss_locked_sol = ?");
values.push(split.mssLockedSol);
}
if (has("mss_locked_token")) {
sets.push("mss_locked_token = ?");
values.push(split.mssLockedTokens);
}
if (has("lock_status")) {
sets.push("lock_status = ?");
values.push("locked_pending_proof");
}
if (has("updated_at")) {
sets.push("updated_at = CURRENT_TIMESTAMP");
}

if (sets.length) {
values.push(pool.launch_id);
await db.run(
`
UPDATE launch_liquidity_lifecycle
SET ${sets.join(", ")}
WHERE launch_id = ?
`,
values
);
}

return {
split,
lifecycle: await getLifecycleRow(pool.launch_id),
};
}

async function graduateLaunch(pool, reason, marketCapInSol) {
const lifecycleResult = await persistGraduationLifecycle(
pool,
reason,
marketCapInSol
);

await db.run(
`
UPDATE pools
SET status = 'graduated',
graduated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[pool.id]
);

await db.run(
`
UPDATE launches
SET status = 'graduated',
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[pool.launch_id]
);

console.log(
`🎓 Launch ${pool.launch_id} graduated (${pool.token_symbol}) via ${reason}`
);

if (lifecycleResult?.split) {
console.log(
`↳ LP split prepared: Raydium ${lifecycleResult.split.raydiumSol} SOL / ${lifecycleResult.split.raydiumTokens} tokens | MSS Lock ${lifecycleResult.split.mssLockedSol} SOL / ${lifecycleResult.split.mssLockedTokens} tokens`
);
}
}

export async function checkGraduations() {
try {
const pools = await getActivePools();

for (const pool of pools) {
const result = getGraduationReason(pool);

await ensureLifecycleSeed(pool, result.marketCapInSol);

if (!result.shouldGraduate) {
continue;
}

await graduateLaunch(pool, result.reason, result.marketCapInSol);
}
} catch (err) {
console.error("GRADUATION WATCHER ERROR:", err);
}
}

export function startGraduationWatcher() {
console.log("🎓 Graduation watcher running (every 15s)");

checkGraduations();

setInterval(() => {
checkGraduations();
}, 15000);
}
