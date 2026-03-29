import db from "../../db/index.js";
import { buildLaunchAllocations } from "./allocationService.js";
import { buildLaunchFeeBreakdown, distributeLaunchFees } from "./feeDistributor.js";
import { bootstrapLiveMarket } from "./mintLifecycle.js";

const DEFAULT_LAUNCH_FEE_PCT = 5;

function safeNum(value, fallback = 0) {
const n = Number(value);
return Number.isFinite(n) ? n : fallback;
}

function roundSol(value) {
return Number(safeNum(value, 0).toFixed(9));
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

function parseJsonMaybe(value, fallback = null) {
if (value == null || value === "") return fallback;
if (typeof value === "object") return value;

try {
return JSON.parse(String(value));
} catch {
return fallback;
}
}

function cleanText(value, max = 5000) {
return String(value ?? "").trim().slice(0, max);
}

function normalizeLaunch(row) {
if (!row) return null;

return {
...row,
committed_sol: safeNum(row.committed_sol, 0),
participants_count: safeNum(row.participants_count, 0),
min_raise_sol: safeNum(row.min_raise_sol, 0),
hard_cap_sol: safeNum(row.hard_cap_sol, 0),
launch_fee_pct: safeNum(row.launch_fee_pct, DEFAULT_LAUNCH_FEE_PCT),
team_allocation_pct: safeNum(row.team_allocation_pct, 0),
builder_bond_sol: safeNum(row.builder_bond_sol, 0),
builder_bond_paid: safeNum(row.builder_bond_paid, 0),
builder_bond_refunded: safeNum(row.builder_bond_refunded, 0),
fees_distributed: safeNum(row.fees_distributed, 0),
liquidity: safeNum(row.liquidity, 0),
internal_pool_sol: safeNum(row.internal_pool_sol, 0),
circulating_supply: safeNum(row.circulating_supply, 0),
market_cap: safeNum(row.market_cap, 0),
price: safeNum(row.price, 0),
volume_24h: safeNum(row.volume_24h, 0),
team_wallets: Array.isArray(row.team_wallets)
? row.team_wallets
: parseJsonMaybe(row.team_wallets, []),
team_wallet_breakdown: Array.isArray(row.team_wallet_breakdown)
? row.team_wallet_breakdown
: parseJsonMaybe(row.team_wallet_breakdown, []),
launch_result_json: parseJsonMaybe(row.launch_result_json, null),
fee_distribution_json: parseJsonMaybe(row.fee_distribution_json, null),
contract_address: cleanText(row.contract_address, 120),
token_mint: cleanText(row.token_mint, 120),
final_supply: cleanText(row.final_supply, 120),
internal_pool_tokens: cleanText(row.internal_pool_tokens, 120),
raydium_liquidity_tokens_reserved: cleanText(row.raydium_liquidity_tokens_reserved, 120),
unsold_participant_tokens_burned: cleanText(row.unsold_participant_tokens_burned, 120),
unused_bonus_tokens_burned: cleanText(row.unused_bonus_tokens_burned, 120),
};
}

async function getLaunchById(launchId) {
const row = await db.get(`SELECT * FROM launches WHERE id = ?`, [launchId]);
return normalizeLaunch(row);
}

function isBuilderLaunchPaid(launch) {
if (!launch) return false;
if (String(launch.template || "") !== "builder") return true;
if (safeNum(launch.builder_bond_sol, 0) <= 0) return false;
return safeNum(launch.builder_bond_paid, 0) === 1;
}

function hasPersistedAllocationResult(launch) {
if (!launch) return false;

return Boolean(
cleanText(launch.final_supply, 120) ||
cleanText(launch.unsold_participant_tokens_burned, 120) ||
cleanText(launch.unused_bonus_tokens_burned, 120) ||
cleanText(launch.internal_pool_tokens, 120) ||
cleanText(launch.raydium_liquidity_tokens_reserved, 120) ||
launch.launch_result_json
);
}

function hasCompletedLiveBootstrap(launch) {
if (!launch) return false;

return Boolean(
cleanText(launch.contract_address, 120) &&
safeNum(launch.liquidity, 0) > 0 &&
safeNum(launch.price, 0) > 0 &&
(
cleanText(launch.final_supply, 120) ||
launch.launch_result_json
)
);
}

function buildFinalizeSuccessResponse({
launchId,
launch,
totalCommitted = null,
participants = null,
feePlan = null,
feeDistribution = null,
allocationsBuilt = false,
marketBootstrap = null,
allocationResult = null,
alreadyFinalized = false,
}) {
const resolvedFeePlan =
feePlan ||
buildLaunchFeeBreakdown(
safeNum(totalCommitted, safeNum(launch?.committed_sol, 0)),
safeNum(launch?.launch_fee_pct, DEFAULT_LAUNCH_FEE_PCT)
);

return {
ok: true,
alreadyFinalized,
launchId,
totalCommitted: safeNum(totalCommitted, safeNum(launch?.committed_sol, 0)),
participants: safeNum(participants, safeNum(launch?.participants_count, 0)),
launchFeePct: resolvedFeePlan.launchFeePct,
feeTotal: resolvedFeePlan.feeTotal,
coreFee: resolvedFeePlan.coreFee,
buybackFee: resolvedFeePlan.buybackFee,
treasuryFee: resolvedFeePlan.treasuryFee,
netRaise: resolvedFeePlan.netRaiseAfterFee,
feeDistribution: launch?.fee_distribution_json || feeDistribution || null,
allocationsBuilt,
marketBootstrap,
mintAddress:
marketBootstrap?.mintAddress ||
cleanText(launch?.contract_address, 120) ||
null,
mintSource: marketBootstrap?.mintSource || null,
tokenId: marketBootstrap?.tokenId || null,
poolId: marketBootstrap?.poolId || null,
finalSupply: String(launch?.final_supply || allocationResult?.finalSupply || ""),
unsoldParticipantTokensBurned: String(
launch?.unsold_participant_tokens_burned ||
allocationResult?.unsoldParticipantTokensBurned ||
"0"
),
unusedBonusTokensBurned: String(
launch?.unused_bonus_tokens_burned ||
allocationResult?.unusedBonusTokensBurned ||
"0"
),
internalPoolSol: safeNum(
launch?.internal_pool_sol,
allocationResult?.internalPoolSol || 0
),
internalPoolTokens: String(
launch?.internal_pool_tokens ||
allocationResult?.internalPoolTokens ||
"0"
),
raydiumLiquidityTokensReserved: String(
launch?.raydium_liquidity_tokens_reserved ||
allocationResult?.raydiumLiquidityTokensReserved ||
"0"
),
liquidity: safeNum(launch?.liquidity, 0),
circulatingSupply: safeNum(launch?.circulating_supply, 0),
marketCap: safeNum(launch?.market_cap, 0),
price: safeNum(launch?.price, 0),
volume24h: safeNum(launch?.volume_24h, 0),
launchResult: launch?.launch_result_json || allocationResult || null,
};
}

async function getCommitStats(launchId) {
const commitsTable = await db.get(
`
SELECT name
FROM sqlite_master
WHERE type = 'table' AND name IN ('launcher_commits', 'commits')
ORDER BY CASE WHEN name = 'launcher_commits' THEN 0 ELSE 1 END
LIMIT 1
`
);

const tableName = commitsTable?.name;
if (!tableName) {
return {
totalCommitted: 0,
participants: 0,
};
}

const columns = await db.all(`PRAGMA table_info(${tableName})`);
const names = new Set(columns.map((row) => String(row.name || "").trim()));

const statusClause = names.has("status")
? `AND status IN ('confirmed', 'complete', 'completed')`
: "";

const totalRow = await db.get(
`
SELECT COALESCE(SUM(sol_amount), 0) AS total
FROM ${tableName}
WHERE launch_id = ?
${statusClause}
`,
[launchId]
);

const participantsRow = await db.get(
`
SELECT COUNT(DISTINCT wallet) AS wallets
FROM ${tableName}
WHERE launch_id = ?
${statusClause}
`,
[launchId]
);

return {
totalCommitted: roundSol(totalRow?.total || 0),
participants: safeNum(participantsRow?.wallets, 0),
};
}

async function syncLaunchStats(launchId) {
const stats = await getCommitStats(launchId);

await db.run(
`
UPDATE launches
SET committed_sol = ?,
participants_count = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[stats.totalCommitted, stats.participants, launchId]
);

return stats;
}

async function markLaunchFailed(launchId) {
await db.run(
`
UPDATE launches
SET status = 'failed',
failed_at = CURRENT_TIMESTAMP,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launchId]
);
}

async function ensureLaunchPromotedToLive(launchId) {
const claim = await db.run(
`
UPDATE launches
SET status = 'live',
live_at = COALESCE(live_at, CURRENT_TIMESTAMP),
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
AND status = 'countdown'
`,
[launchId]
);

if (claim?.changes > 0) {
return { promoted: true };
}

const latest = await getLaunchById(launchId);
if (latest?.status === "live") {
return { promoted: false, alreadyLive: true, launch: latest };
}

return { promoted: false, alreadyLive: false, launch: latest };
}

async function persistAllocationResult(launchId, allocationResult) {
await db.run(
`
UPDATE launches
SET final_supply = ?,
unsold_participant_tokens_burned = ?,
unused_bonus_tokens_burned = ?,
internal_pool_sol = ?,
internal_pool_tokens = ?,
raydium_liquidity_tokens_reserved = ?,
launch_result_json = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[
String(allocationResult.finalSupply ?? ""),
String(allocationResult.unsoldParticipantTokensBurned ?? "0"),
String(allocationResult.unusedBonusTokensBurned ?? "0"),
safeNum(allocationResult.internalPoolSol, 0),
String(allocationResult.internalPoolTokens ?? "0"),
String(allocationResult.raydiumLiquidityTokensReserved ?? "0"),
JSON.stringify(allocationResult),
launchId,
]
);
}

function validateAllocationResult(allocationResult) {
if (!allocationResult || typeof allocationResult !== "object") {
throw new Error("allocation result missing");
}

const finalSupply = safeNum(allocationResult.finalSupply, 0);
const internalPoolSol = safeNum(allocationResult.internalPoolSol, 0);
const internalPoolTokens = safeNum(allocationResult.internalPoolTokens, 0);

if (finalSupply <= 0) {
throw new Error("allocation result missing final supply");
}

if (internalPoolSol <= 0) {
throw new Error("allocation result missing internal pool SOL");
}

if (internalPoolTokens <= 0) {
throw new Error("allocation result missing internal pool tokens");
}

return {
finalSupply: String(allocationResult.finalSupply),
internalPoolSol,
internalPoolTokens: String(allocationResult.internalPoolTokens),
};
}

async function ensureAllocationResult(launchId, launch) {
let allocationResult = null;
let allocationsBuilt = false;

if (hasPersistedAllocationResult(launch)) {
allocationsBuilt = true;
allocationResult = launch.launch_result_json || {
finalSupply: launch.final_supply,
unsoldParticipantTokensBurned: launch.unsold_participant_tokens_burned || "0",
unusedBonusTokensBurned: launch.unused_bonus_tokens_burned || "0",
internalPoolSol: launch.internal_pool_sol || 0,
internalPoolTokens: launch.internal_pool_tokens || "0",
raydiumLiquidityTokensReserved: launch.raydium_liquidity_tokens_reserved || "0",
};
validateAllocationResult(allocationResult);
console.log(`Allocations already persisted for launch ${launchId}, skipping`);
return { allocationResult, allocationsBuilt };
}

try {
allocationResult = await buildLaunchAllocations(launchId);
validateAllocationResult(allocationResult);
allocationsBuilt = true;
await persistAllocationResult(launchId, allocationResult);
return { allocationResult, allocationsBuilt };
} catch (err) {
const msg = String(err?.message || err || "").toLowerCase();

if (msg.includes("already")) {
const latest = await getLaunchById(launchId);
allocationResult = latest?.launch_result_json || {
finalSupply: latest?.final_supply,
unsoldParticipantTokensBurned: latest?.unsold_participant_tokens_burned || "0",
unusedBonusTokensBurned: latest?.unused_bonus_tokens_burned || "0",
internalPoolSol: latest?.internal_pool_sol || 0,
internalPoolTokens: latest?.internal_pool_tokens || "0",
raydiumLiquidityTokensReserved: latest?.raydium_liquidity_tokens_reserved || "0",
};
validateAllocationResult(allocationResult);
allocationsBuilt = true;
console.log(`Allocation service reported already built for launch ${launchId}, skipping`);
return { allocationResult, allocationsBuilt };
}

console.error(`Allocation build failed for launch ${launchId}:`, err);
throw err;
}
}

async function ensureFeeDistribution(launchId, launch, totalCommitted) {
const launchFeePct = safeNum(launch.launch_fee_pct, DEFAULT_LAUNCH_FEE_PCT);
const feePlan = buildLaunchFeeBreakdown(totalCommitted, launchFeePct);
let feeDistribution = launch.fee_distribution_json || null;

console.log("Finalizing launch", launchId);
console.log("Template:", launch.template);
console.log("Total committed:", totalCommitted);
console.log("Participants:", launch.participants_count);
console.log("Fee total:", feePlan.feeTotal);
console.log("Core fee:", feePlan.coreFee);
console.log("Buyback fee:", feePlan.buybackFee);
console.log("Treasury fee:", feePlan.treasuryFee);
console.log("Net raise:", feePlan.netRaiseAfterFee);

if (safeNum(launch.fees_distributed, 0) === 1) {
console.log(`Fees already distributed for launch ${launchId}, skipping`);
return { feePlan, feeDistribution };
}

const claim = await db.run(
`
UPDATE launches
SET fees_distributed = 2,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
AND COALESCE(fees_distributed, 0) = 0
`,
[launchId]
);

if (claim.changes === 0) {
const latest = normalizeLaunch(
await db.get(
`SELECT fees_distributed, fee_distribution_json FROM launches WHERE id = ?`,
[launchId]
)
);

feeDistribution = latest?.fee_distribution_json || null;
console.log(`Fee distribution already claimed for launch ${launchId}, skipping`);
return { feePlan, feeDistribution };
}

try {
feeDistribution = await distributeLaunchFees({
totalCommitted,
launchFeePct,
});

await db.run(
`
UPDATE launches
SET fees_distributed = 1,
fees_distributed_at = CURRENT_TIMESTAMP,
fee_distribution_json = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[JSON.stringify(feeDistribution), launchId]
);

console.log("Fee distribution complete:", feeDistribution);
return { feePlan, feeDistribution };
} catch (err) {
await db.run(
`
UPDATE launches
SET fees_distributed = 0,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launchId]
);
throw err;
}
}

async function ensureReadyForLiveBootstrap(launchId) {
const claim = await ensureLaunchPromotedToLive(launchId);

if (!claim.promoted && !claim.alreadyLive) {
return {
ok: false,
reason: "launch could not be promoted to live",
};
}

const liveLaunch = await getLaunchById(launchId);
if (!liveLaunch || liveLaunch.status !== "live") {
throw new Error("launch is not live after promotion");
}

return {
ok: true,
launch: liveLaunch,
};
}

export async function finalizeLaunch(launchId) {
let launch = await getLaunchById(launchId);

if (!launch) {
throw new Error("Launch not found");
}

if (launch.status !== "countdown" && launch.status !== "live") {
return {
ok: false,
reason: "launch is not in countdown or live",
};
}

if (!isBuilderLaunchPaid(launch)) {
if (launch.status === "countdown") {
await markLaunchFailed(launchId);
}

return {
ok: false,
reason: "builder bond not paid",
};
}

if (launch.status === "live" && hasCompletedLiveBootstrap(launch)) {
const stats = await getCommitStats(launchId);

console.log(`Launch ${launchId} already finalized/live, skipping re-finalize`);

return buildFinalizeSuccessResponse({
launchId,
launch,
totalCommitted: stats.totalCommitted,
participants: stats.participants,
feeDistribution: launch.fee_distribution_json || null,
allocationsBuilt: hasPersistedAllocationResult(launch),
marketBootstrap: null,
allocationResult: launch.launch_result_json || null,
alreadyFinalized: true,
});
}

if (launch.status === "countdown") {
const countdownEnds = parseDbTime(launch.countdown_ends_at);

if (!countdownEnds) {
throw new Error("Invalid countdown end time");
}

if (Date.now() < countdownEnds) {
return {
ok: false,
reason: "countdown not finished",
};
}
}

const stats = await syncLaunchStats(launchId);
launch = await getLaunchById(launchId);

if (!launch) {
throw new Error("Launch not found after sync");
}

if (!isBuilderLaunchPaid(launch)) {
if (launch.status === "countdown") {
await markLaunchFailed(launchId);
}

return {
ok: false,
reason: "builder bond not paid",
};
}

if (launch.status === "live" && hasCompletedLiveBootstrap(launch)) {
console.log(`Launch ${launchId} finalized during sync window, skipping duplicate finalize`);

return buildFinalizeSuccessResponse({
launchId,
launch,
totalCommitted: stats.totalCommitted,
participants: stats.participants,
feeDistribution: launch.fee_distribution_json || null,
allocationsBuilt: hasPersistedAllocationResult(launch),
marketBootstrap: null,
allocationResult: launch.launch_result_json || null,
alreadyFinalized: true,
});
}

const totalCommitted = safeNum(stats.totalCommitted, 0);
const minRaise = safeNum(launch.min_raise_sol, 0);

if (totalCommitted < minRaise) {
if (launch.status === "countdown") {
await markLaunchFailed(launchId);
}

return {
ok: false,
reason: "minimum raise not met",
totalCommitted,
minRaise,
};
}

const { feePlan, feeDistribution } = await ensureFeeDistribution(
launchId,
launch,
totalCommitted
);

const liveState = await ensureReadyForLiveBootstrap(launchId);
if (!liveState.ok) {
return liveState;
}

const liveLaunch = liveState.launch || (await getLaunchById(launchId));

if (liveLaunch?.status === "live" && hasCompletedLiveBootstrap(liveLaunch)) {
console.log(`Launch ${launchId} already live before bootstrap step, returning persisted state`);

return buildFinalizeSuccessResponse({
launchId,
launch: liveLaunch,
totalCommitted,
participants: stats.participants,
feePlan,
feeDistribution: liveLaunch.fee_distribution_json || feeDistribution,
allocationsBuilt: hasPersistedAllocationResult(liveLaunch),
marketBootstrap: null,
allocationResult: liveLaunch.launch_result_json || null,
alreadyFinalized: true,
});
}

const { allocationResult, allocationsBuilt } = await ensureAllocationResult(
launchId,
liveLaunch
);

let marketBootstrap = null;

try {
marketBootstrap = await bootstrapLiveMarket(launchId);
console.log("Market bootstrap complete:", marketBootstrap);
} catch (err) {
console.error(`Market bootstrap failed for launch ${launchId}:`, err);
throw err;
}

const finalLaunch = await getLaunchById(launchId);
if (!finalLaunch) {
throw new Error("Launch not found after market bootstrap");
}

if (!cleanText(finalLaunch.contract_address, 120)) {
throw new Error("launch contract address missing after market bootstrap");
}

if (safeNum(finalLaunch.liquidity, 0) <= 0) {
throw new Error("launch liquidity missing after market bootstrap");
}

if (safeNum(finalLaunch.price, 0) <= 0) {
throw new Error("launch price missing after market bootstrap");
}

console.log("Launch moved to LIVE:", launchId);

return buildFinalizeSuccessResponse({
launchId,
launch: finalLaunch,
totalCommitted,
participants: stats.participants,
feePlan,
feeDistribution: finalLaunch.fee_distribution_json || feeDistribution,
allocationsBuilt,
marketBootstrap,
allocationResult,
alreadyFinalized: false,
});
}