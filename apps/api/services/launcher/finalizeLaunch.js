import db from "../../db/index.js";
import { buildLaunchAllocations } from "./allocationService.js";
import { buildLaunchFeeBreakdown, distributeLaunchFees } from "./feeDistributor.js";

function safeNum(value, fallback = 0) {
const n = Number(value);
return Number.isFinite(n) ? n : fallback;
}

function parseDbTime(value) {
if (!value) return null;
const ms = Date.parse(String(value).replace(" ", "T") + "Z");
return Number.isFinite(ms) ? ms : null;
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

function normalizeLaunch(row) {
if (!row) return null;

return {
...row,
committed_sol: safeNum(row.committed_sol, 0),
participants_count: safeNum(row.participants_count, 0),
min_raise_sol: safeNum(row.min_raise_sol, 0),
hard_cap_sol: safeNum(row.hard_cap_sol, 0),
launch_fee_pct: safeNum(row.launch_fee_pct, 5),
team_allocation_pct: safeNum(row.team_allocation_pct, 0),
builder_bond_sol: safeNum(row.builder_bond_sol, 0),
builder_bond_paid: safeNum(row.builder_bond_paid, 0),
builder_bond_refunded: safeNum(row.builder_bond_refunded, 0),
fees_distributed: safeNum(row.fees_distributed, 0),
team_wallets: Array.isArray(row.team_wallets)
? row.team_wallets
: parseJsonMaybe(row.team_wallets, []),
team_wallet_breakdown: Array.isArray(row.team_wallet_breakdown)
? row.team_wallet_breakdown
: parseJsonMaybe(row.team_wallet_breakdown, []),
launch_result_json: parseJsonMaybe(row.launch_result_json, null),
fee_distribution_json: parseJsonMaybe(row.fee_distribution_json, null),
};
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
String(launch.final_supply || "").trim() ||
String(launch.unsold_participant_tokens_burned || "").trim() ||
String(launch.unused_bonus_tokens_burned || "").trim() ||
String(launch.internal_pool_tokens || "").trim() ||
String(launch.raydium_liquidity_tokens_reserved || "").trim() ||
launch.launch_result_json
);
}

async function getCommitStats(launchId) {
const totalRow = await db.get(
`
SELECT COALESCE(SUM(sol_amount), 0) AS total
FROM commits
WHERE launch_id = ?
`,
[launchId]
);

const participantsRow = await db.get(
`
SELECT COUNT(DISTINCT wallet) AS wallets
FROM commits
WHERE launch_id = ?
`,
[launchId]
);

return {
totalCommitted: safeNum(totalRow?.total, 0),
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

async function promoteLaunchLiveOnce(launchId) {
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

if (claim.changes > 0) {
return { promoted: true };
}

const latest = normalizeLaunch(
await db.get(`SELECT * FROM launches WHERE id = ?`, [launchId])
);

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

export async function finalizeLaunch(launchId) {
let launch = normalizeLaunch(
await db.get(`SELECT * FROM launches WHERE id = ?`, [launchId])
);

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

let refreshed = normalizeLaunch(
await db.get(`SELECT * FROM launches WHERE id = ?`, [launchId])
);

if (!refreshed) {
throw new Error("Launch not found after sync");
}

if (!isBuilderLaunchPaid(refreshed)) {
if (refreshed.status === "countdown") {
await markLaunchFailed(launchId);
}

return {
ok: false,
reason: "builder bond not paid",
};
}

const totalCommitted = safeNum(stats.totalCommitted, 0);
const minRaise = safeNum(refreshed.min_raise_sol, 0);
const launchFeePct = safeNum(refreshed.launch_fee_pct, 5);

if (totalCommitted < minRaise) {
if (refreshed.status === "countdown") {
await markLaunchFailed(launchId);
}

return {
ok: false,
reason: "minimum raise not met",
totalCommitted,
minRaise,
};
}

const feePlan = buildLaunchFeeBreakdown(totalCommitted, launchFeePct);

console.log("Finalizing launch", launchId);
console.log("Template:", refreshed.template);
console.log("Total committed:", totalCommitted);
console.log("Participants:", stats.participants);
console.log("Fee total:", feePlan.feeTotal);
console.log("Core fee:", feePlan.coreFee);
console.log("Buyback fee:", feePlan.buybackFee);
console.log("Treasury fee:", feePlan.treasuryFee);
console.log("Net raise:", feePlan.netRaiseAfterFee);

let feeDistribution = refreshed.fee_distribution_json || null;

if (safeNum(refreshed.fees_distributed, 0) === 1) {
console.log(`Fees already distributed for launch ${launchId}, skipping`);
} else {
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
} else {
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
}

const liveClaim = await promoteLaunchLiveOnce(launchId);
if (!liveClaim.promoted && !liveClaim.alreadyLive) {
return {
ok: false,
reason: "launch could not be promoted to live",
};
}

let allocationResult = null;
let allocationsBuilt = false;

const beforeAllocLaunch = normalizeLaunch(
await db.get(`SELECT * FROM launches WHERE id = ?`, [launchId])
);

if (hasPersistedAllocationResult(beforeAllocLaunch)) {
allocationsBuilt = true;
allocationResult = beforeAllocLaunch.launch_result_json || null;
console.log(`Allocations already persisted for launch ${launchId}, skipping`);
} else {
try {
allocationResult = await buildLaunchAllocations(launchId);
allocationsBuilt = true;

if (allocationResult) {
await persistAllocationResult(launchId, allocationResult);
}
} catch (err) {
const msg = String(err?.message || err || "");
if (msg.toLowerCase().includes("already")) {
allocationsBuilt = true;

const latest = normalizeLaunch(
await db.get(`SELECT * FROM launches WHERE id = ?`, [launchId])
);

allocationResult = latest?.launch_result_json || null;
console.log(`Allocation service reported already built for launch ${launchId}, skipping`);
} else {
console.error(`Allocation build failed for launch ${launchId}:`, err);
throw err;
}
}
}

const finalLaunch = normalizeLaunch(
await db.get(`SELECT * FROM launches WHERE id = ?`, [launchId])
);

console.log("Launch moved to LIVE:", launchId);

return {
ok: true,
launchId,
totalCommitted,
participants: stats.participants,
launchFeePct,
feeTotal: feePlan.feeTotal,
coreFee: feePlan.coreFee,
buybackFee: feePlan.buybackFee,
treasuryFee: feePlan.treasuryFee,
netRaise: feePlan.netRaiseAfterFee,
feeDistribution: finalLaunch?.fee_distribution_json || feeDistribution,
allocationsBuilt,
finalSupply: String(finalLaunch?.final_supply || allocationResult?.finalSupply || ""),
unsoldParticipantTokensBurned: String(
finalLaunch?.unsold_participant_tokens_burned ||
allocationResult?.unsoldParticipantTokensBurned ||
"0"
),
unusedBonusTokensBurned: String(
finalLaunch?.unused_bonus_tokens_burned ||
allocationResult?.unusedBonusTokensBurned ||
"0"
),
internalPoolSol: safeNum(
finalLaunch?.internal_pool_sol,
allocationResult?.internalPoolSol || 0
),
internalPoolTokens: String(
finalLaunch?.internal_pool_tokens ||
allocationResult?.internalPoolTokens ||
"0"
),
raydiumLiquidityTokensReserved: String(
finalLaunch?.raydium_liquidity_tokens_reserved ||
allocationResult?.raydiumLiquidityTokensReserved ||
"0"
),
launchResult:
finalLaunch?.launch_result_json ||
allocationResult ||
null,
};
}