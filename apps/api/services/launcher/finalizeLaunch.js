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

const feeDistribution = await distributeLaunchFees({
totalCommitted,
launchFeePct,
});

console.log("Fee distribution complete:", feeDistribution);

/*
NEXT PHASES
1. Mint launch token
2. Create LP
3. Distribute participant allocations
*/

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

try {
await buildLaunchAllocations(launchId);
allocationsBuilt = true;
} catch (err) {
const msg = String(err?.message || err || "");
if (!msg.toLowerCase().includes("already")) {
console.error(`Allocation build failed for launch ${launchId}:`, err);
throw err;
}
}

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
};
}