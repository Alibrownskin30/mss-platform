import db from "../../db/index.js";

const TRADING_TAX_PCT = 1;

const TRADING_TAX_SPLIT = {
founder: 0.5,
buyback: 0.3,
treasury: 0.2,
};

function toTokenAmount(totalSupply, pct) {
return Math.floor((Number(totalSupply) * Number(pct)) / 100);
}

function roundSol(value) {
return Number(Number(value || 0).toFixed(9));
}

function getRevenueWallets() {
return {
founder: process.env.FOUNDER_WALLET || "FOUNDER_WALLET_UNSET",
buyback: process.env.BUYBACK_WALLET || "BUYBACK_WALLET_UNSET",
treasury: process.env.TREASURY_WALLET || "TREASURY_WALLET_UNSET",
};
}

function buildTradingTaxBreakdown(baseSolAmount) {
const totalTaxSol = roundSol((Number(baseSolAmount) * TRADING_TAX_PCT) / 100);

const founderSol = roundSol(totalTaxSol * TRADING_TAX_SPLIT.founder);
const buybackSol = roundSol(totalTaxSol * TRADING_TAX_SPLIT.buyback);
const treasurySol = roundSol(totalTaxSol * TRADING_TAX_SPLIT.treasury);

const recomposed = roundSol(founderSol + buybackSol + treasurySol);
const remainder = roundSol(totalTaxSol - recomposed);

return {
tradingTaxPct: TRADING_TAX_PCT,
totalTaxSol,
founderSol: roundSol(founderSol + remainder),
buybackSol,
treasurySol,
splitPct: {
founder: 0.5,
buyback: 0.3,
treasury: 0.2,
},
wallets: getRevenueWallets(),
};
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

const commits = await db.all(
`SELECT wallet, sol_amount FROM commits WHERE launch_id = ? ORDER BY id ASC`,
[launchId]
);

const totalSupply = Number(launch.supply);
const totalCommitted = Number(launch.committed_sol);
const launchFeePct = Number(launch.launch_fee_pct || 5);

if (!totalSupply || !totalCommitted) {
throw new Error("invalid launch supply or committed total");
}

const participantTokens = toTokenAmount(totalSupply, launch.participants_pct);
const liquidityTokens = toTokenAmount(totalSupply, launch.liquidity_pct);
const reserveTokens = toTokenAmount(totalSupply, launch.reserve_pct);
const builderTokens = toTokenAmount(totalSupply, launch.builder_pct);

const launchFeeSol = roundSol((totalCommitted * launchFeePct) / 100);
const netCommittedAfterLaunchFee = roundSol(totalCommitted - launchFeeSol);

// This is the protocol trading tax model for launcher trading activity.
// It is returned as metadata here so the platform has one clean source of truth.
const tradingTax = buildTradingTaxBreakdown(totalCommitted);

// Participant allocations
for (const row of commits) {
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
[launchId, `LP_LAUNCH_${launchId}`, String(liquidityTokens), netCommittedAfterLaunchFee]
);

return {
launchId,
totalSupply,
totalCommitted,
launchFeePct,
launchFeeSol,
netCommittedAfterLaunchFee,
participantTokens,
liquidityTokens,
reserveTokens,
builderTokens,
tradingTax,
};
}