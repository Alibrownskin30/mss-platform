import db from "../../db/index.js";

export async function finalizeLaunch(launchId) {

const launch = await db.get(
`SELECT * FROM launches WHERE id = ?`,
[launchId]
);

if (!launch) {
throw new Error("Launch not found");
}

if (launch.status !== "countdown") {
return;
}

const now = Date.now();
const countdownEnds = new Date(launch.countdown_ends_at).getTime();

if (now < countdownEnds) {
return;
}

const commits = await db.all(
`SELECT wallet, sol_amount FROM commits WHERE launch_id = ?`,
[launchId]
);

const totalCommitted = commits.reduce(
(sum, c) => sum + Number(c.sol_amount || 0),
0
);

const launchFeePct = launch.launch_fee_pct || 5;

const feeTotal = totalCommitted * (launchFeePct / 100);
const founderFee = feeTotal * 0.5;
const buybackFee = feeTotal * 0.3;
const treasuryFee = feeTotal * 0.2;

const netRaise = totalCommitted - feeTotal;

console.log("Finalizing launch", launchId);
console.log("Total committed:", totalCommitted);
console.log("Net raise:", netRaise);

/*
NEXT PHASE (coming step by step)

1. Transfer fees to fee wallets
2. Create Raydium LP
3. Mint launch token
4. Distribute tokens to commit participants
*/

await db.run(
`UPDATE launches
SET status = 'live'
WHERE id = ?`,
[launchId]
);

console.log("Launch moved to LIVE:", launchId);
}