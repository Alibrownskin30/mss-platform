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

function parseJsonMaybe(value, fallback = null) {
if (value == null || value === "") return fallback;
if (typeof value === "object") return value;

try {
return JSON.parse(String(value));
} catch {
return fallback;
}
}

export async function finalizeLaunch(launchId) {
const launch = await db.get(
`SELECT * FROM launches WHERE id = ?`,
[launchId]
);

if (!launch) {
throw new Error("Launch not found");
}

if (launch.status !== "countdown") {
return {
ok: false,
reason: "launch is not in countdown",
};
}

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

const stats = await syncLaunchStats(launchId);
const refreshed = await db.get(
`SELECT * FROM launches WHERE id = ?`,
[launchId]
);

if (!refreshed) {
throw new Error("Launch not found after sync");
}

const totalCommitted = safeNum(stats.totalCommitted, 0);
const minRaise = safeNum(refreshed.min_raise_sol, 0);
const launchFeePct = safeNum(refreshed.launch_fee_pct, 5);

if (totalCommitted < minRaise) {
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

return {
ok: false,
reason: "minimum raise not met",
totalCommitted,
minRaise,
};
}

const feePlan = buildLaunchFeeBreakdown(totalCommitted, launchFeePct);

console.log("Finalizing launch", launchId);
console.log("Total committed:", totalCommitted);
console.log("Participants:", stats.participants);
console.log("Fee total:", feePlan.feeTotal);
console.log("Core fee:", feePlan.coreFee);
console.log("Buyback fee:", feePlan.buybackFee);
console.log("Treasury fee:", feePlan.treasuryFee);
console.log("Net raise:", feePlan.netRaiseAfterFee);

let feeDistribution = null;

const priorFeeDistribution = parseJsonMaybe(
refreshed.fee_distribution_json,
null
);

if (Number(refreshed.fees_distributed || 0) === 1) {
console.log(`Fees already distributed for launch ${launchId}, skipping`);
feeDistribution = priorFeeDistribution;
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
const latest = await db.get(
`SELECT fee_distribution_json, fees_distributed FROM launches WHERE id = ?`,
[launchId]
);

feeDistribution = parseJsonMaybe(latest?.fee_distribution_json, null);
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

await db.run(
`
UPDATE launches
SET status = 'live',
live_at = CURRENT_TIMESTAMP,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launchId]
);

let allocationsBuilt = false;
let allocationResult = null;

try {
allocationResult = await buildLaunchAllocations(launchId);
allocationsBuilt = true;
} catch (err) {
const msg = String(err?.message || err || "");
if (msg.toLowerCase().includes("already")) {
allocationsBuilt = true;
allocationResult = null;
} else {
console.error(`Allocation build failed for launch ${launchId}:`, err);
throw err;
}
}

if (allocationResult) {
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

const finalLaunch = await db.get(
`SELECT * FROM launches WHERE id = ?`,
[launchId]
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
feeDistribution,
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
launchResult: allocationResult || parseJsonMaybe(finalLaunch?.launch_result_json, null),
};
}