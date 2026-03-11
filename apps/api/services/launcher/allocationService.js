import db from "../../db/index.js";

function toTokenAmount(totalSupply, pct) {
return Math.floor((Number(totalSupply) * Number(pct)) / 100);
}

export async function buildLaunchAllocations(launchId) {
const launch = await db.get(
`SELECT * FROM launches WHERE id = ?`,
[launchId]
);

if (!launch) {
throw new Error("launch not found");
}

if (launch.status !== "live") {
throw new Error("launch must be live before allocations can be built");
}

const existing = await db.get(
`SELECT id FROM allocations WHERE launch_id = ? LIMIT 1`,
[launchId]
);

if (existing) {
throw new Error("allocations already built for this launch");
}

const commitments = await db.all(
`SELECT wallet, sol_amount FROM commitments WHERE launch_id = ? ORDER BY id ASC`,
[launchId]
);

const totalSupply = Number(launch.supply);
const totalCommitted = Number(launch.committed_sol);
const feePct = Number(launch.launch_fee_pct);

if (!totalSupply || !totalCommitted) {
throw new Error("invalid launch supply or committed total");
}

const participantTokens = toTokenAmount(totalSupply, launch.participants_pct);
const liquidityTokens = toTokenAmount(totalSupply, launch.liquidity_pct);
const reserveTokens = toTokenAmount(totalSupply, launch.reserve_pct);
const builderTokens = toTokenAmount(totalSupply, launch.builder_pct);

const feeSol = Number(((totalCommitted * feePct) / 100).toFixed(9));
const liquiditySol = Number((totalCommitted - feeSol).toFixed(9));

// Participant allocations
for (const row of commitments) {
const walletShare = Number(row.sol_amount) / totalCommitted;
const tokenAmount = Math.floor(participantTokens * walletShare);

await db.run(
`
INSERT INTO allocations (
launch_id,
wallet,
allocation_type,
token_amount,
sol_amount
) VALUES (?, ?, 'participant', ?, ?)
`,
[launchId, row.wallet, String(tokenAmount), Number(row.sol_amount)]
);
}

// Builder allocation
const builder = await db.get(
`
SELECT b.wallet
FROM launches l
JOIN builders b ON b.id = l.builder_id
WHERE l.id = ?
`,
[launchId]
);

await db.run(
`
INSERT INTO allocations (
launch_id,
wallet,
allocation_type,
token_amount,
sol_amount
) VALUES (?, ?, 'builder', ?, 0)
`,
[launchId, builder.wallet, String(builderTokens)]
);

// Reserve allocation
await db.run(
`
INSERT INTO allocations (
launch_id,
wallet,
allocation_type,
token_amount,
sol_amount
) VALUES (?, ?, 'reserve', ?, 0)
`,
[launchId, `RESERVE_LAUNCH_${launchId}`, String(reserveTokens)]
);

// Liquidity allocation
await db.run(
`
INSERT INTO allocations (
launch_id,
wallet,
allocation_type,
token_amount,
sol_amount
) VALUES (?, ?, 'liquidity', ?, ?)
`,
[launchId, `LP_LAUNCH_${launchId}`, String(liquidityTokens), liquiditySol]
);

return {
launchId,
totalSupply,
totalCommitted,
feeSol,
liquiditySol,
participantTokens,
liquidityTokens,
reserveTokens,
builderTokens,
};
}