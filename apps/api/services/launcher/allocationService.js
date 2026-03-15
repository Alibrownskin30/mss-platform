import db from "../../db/index.js";

const BASE_PARTICIPANT_PCT = 42;
const BONUS_PARTICIPANT_PCT = 3;
const INTERNAL_POOL_LIQUIDITY_PCT = 10;
const RAYDIUM_RESERVED_LIQUIDITY_PCT = 10;

function floorBig(n) {
return Math.floor(Number(n || 0));
}

function roundSol(value) {
return Number(Number(value || 0).toFixed(9));
}

function safeNum(value, fallback = 0) {
const n = Number(value);
return Number.isFinite(n) ? n : fallback;
}

function parseJsonArray(value) {
if (Array.isArray(value)) return value;
if (value == null || value === "") return [];
try {
const parsed = JSON.parse(String(value));
return Array.isArray(parsed) ? parsed : [];
} catch {
return [];
}
}

function toTokenAmount(totalSupply, pct) {
return floorBig((Number(totalSupply) * Number(pct)) / 100);
}

function sum(items, fn) {
return items.reduce((acc, item) => acc + Number(fn(item) || 0), 0);
}

function getBonusPctByFillRatio(fillRatio) {
const pctFilled = Number(fillRatio || 0) * 100;

if (pctFilled < 10) return 8;
if (pctFilled < 30) return 5;
if (pctFilled < 60) return 3;
return 0;
}

function normalizeSupply(value) {
const n = Number(value);
if (!Number.isFinite(n) || n <= 0) {
throw new Error("invalid total supply");
}
return Math.floor(n);
}

function normalizeCommitRows(rows) {
return (Array.isArray(rows) ? rows : [])
.map((row) => ({
wallet: String(row?.wallet || "").trim(),
sol_amount: safeNum(row?.sol_amount, 0),
}))
.filter((row) => row.wallet && row.sol_amount > 0);
}

function buildParticipantBaseAllocations(commits, totalCommitted, baseParticipantTokens) {
if (!commits.length || totalCommitted <= 0 || baseParticipantTokens <= 0) {
return commits.map((row) => ({
wallet: row.wallet,
committed_sol: row.sol_amount,
base_tokens: 0,
}));
}

let distributed = 0;

return commits.map((row, index) => {
let baseTokens;

if (index === commits.length - 1) {
baseTokens = Math.max(0, baseParticipantTokens - distributed);
} else {
const share = row.sol_amount / totalCommitted;
baseTokens = floorBig(baseParticipantTokens * share);
distributed += baseTokens;
}

return {
wallet: row.wallet,
committed_sol: row.sol_amount,
base_tokens: baseTokens,
};
});
}

function buildBonusAllocations({
commits,
hardCap,
bonusPoolTokens,
}) {
if (!commits.length || bonusPoolTokens <= 0 || hardCap <= 0) {
return commits.map((row) => ({
wallet: row.wallet,
committed_sol: row.sol_amount,
bonus_pct: 0,
bonus_tokens_raw: 0,
bonus_tokens: 0,
fill_before: 0,
fill_after: 0,
}));
}

let runningCommitted = 0;

const raw = commits.map((row) => {
const fillBefore = runningCommitted / hardCap;
const fillAfter = (runningCommitted + row.sol_amount) / hardCap;
const bonusPct = getBonusPctByFillRatio(fillBefore);

runningCommitted += row.sol_amount;

return {
wallet: row.wallet,
committed_sol: row.sol_amount,
bonus_pct: bonusPct,
bonus_tokens_raw: row.sol_amount * (bonusPct / 100),
fill_before: fillBefore,
fill_after: fillAfter,
};
});

const totalRawWeight = sum(raw, (x) => x.bonus_tokens_raw);

if (totalRawWeight <= 0) {
return raw.map((x) => ({
...x,
bonus_tokens: 0,
}));
}

let distributed = 0;

return raw.map((row, index) => {
let bonusTokens;

if (index === raw.length - 1) {
bonusTokens = Math.max(0, bonusPoolTokens - distributed);
} else {
bonusTokens = floorBig((row.bonus_tokens_raw / totalRawWeight) * bonusPoolTokens);
distributed += bonusTokens;
}

return {
...row,
bonus_tokens: bonusTokens,
};
});
}

function buildTeamAllocations({
isBuilderLaunch,
totalSupply,
teamAllocationPct,
teamWalletBreakdown,
}) {
if (!isBuilderLaunch || teamAllocationPct <= 0 || !teamWalletBreakdown.length) {
return {
teamTokens: 0,
rows: [],
};
}

const teamTokens = toTokenAmount(totalSupply, teamAllocationPct);

let distributed = 0;
const rows = [];

for (let i = 0; i < teamWalletBreakdown.length; i++) {
const item = teamWalletBreakdown[i];
const wallet = String(item?.wallet || "").trim();
const pct = safeNum(item?.pct, 0);

if (!wallet || pct <= 0) continue;

let tokenAmount;
if (i === teamWalletBreakdown.length - 1) {
tokenAmount = Math.max(0, teamTokens - distributed);
} else {
tokenAmount = floorBig((teamTokens * pct) / teamAllocationPct);
distributed += tokenAmount;
}

rows.push({
wallet,
allocation_type: "team",
token_amount: tokenAmount,
sol_amount: 0,
});
}

return {
teamTokens,
rows,
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

const rawCommits = await db.all(
`SELECT wallet, sol_amount FROM commits WHERE launch_id = ? ORDER BY id ASC`,
[launchId]
);

const commits = normalizeCommitRows(rawCommits);

const totalSupply = normalizeSupply(launch.supply);
const totalCommitted = safeNum(launch.committed_sol, 0);
const launchFeePct = safeNum(launch.launch_fee_pct, 5);
const hardCap = safeNum(launch.hard_cap_sol, 0);

if (totalCommitted <= 0) {
throw new Error("invalid committed total");
}

const launchFeeSol = roundSol((totalCommitted * launchFeePct) / 100);
const netCommittedAfterLaunchFee = roundSol(totalCommitted - launchFeeSol);

const isBuilderLaunch = String(launch.template || "") === "builder";
const teamAllocationPct = safeNum(launch.team_allocation_pct, 0);
const rawReservePct = safeNum(launch.reserve_pct, 0);
const builderPct = safeNum(launch.builder_pct, 0);

const effectiveReservePct =
isBuilderLaunch && teamAllocationPct > 0
? Math.max(0, rawReservePct - teamAllocationPct)
: rawReservePct;

const participantTotalTokens = toTokenAmount(totalSupply, safeNum(launch.participants_pct, 45));
const participantBaseTokens = toTokenAmount(totalSupply, BASE_PARTICIPANT_PCT);
const participantBonusPoolTokens = toTokenAmount(totalSupply, BONUS_PARTICIPANT_PCT);

if (participantBaseTokens + participantBonusPoolTokens > participantTotalTokens) {
throw new Error("participant allocation math exceeds configured participant pct");
}

const internalPoolTokens = toTokenAmount(totalSupply, INTERNAL_POOL_LIQUIDITY_PCT);
const raydiumLiquidityTokensReserved = toTokenAmount(
totalSupply,
RAYDIUM_RESERVED_LIQUIDITY_PCT
);

const reserveTokens = toTokenAmount(totalSupply, effectiveReservePct);
const builderTokens = toTokenAmount(totalSupply, builderPct);

const teamWalletBreakdown = parseJsonArray(launch.team_wallet_breakdown);
const { teamTokens, rows: teamRows } = buildTeamAllocations({
isBuilderLaunch,
totalSupply,
teamAllocationPct,
teamWalletBreakdown,
});

const baseAllocs = buildParticipantBaseAllocations(
commits,
totalCommitted,
participantBaseTokens
);

const bonusAllocs = buildBonusAllocations({
commits,
hardCap,
bonusPoolTokens: participantBonusPoolTokens,
});

const bonusByWallet = new Map(
bonusAllocs.map((row) => [row.wallet, row])
);

const participantRows = baseAllocs.map((row) => {
const bonus = bonusByWallet.get(row.wallet);

return {
wallet: row.wallet,
allocation_type: "participant",
committed_sol: row.committed_sol,
base_tokens: row.base_tokens,
bonus_tokens: safeNum(bonus?.bonus_tokens, 0),
bonus_pct: safeNum(bonus?.bonus_pct, 0),
fill_before: safeNum(bonus?.fill_before, 0),
fill_after: safeNum(bonus?.fill_after, 0),
token_amount: row.base_tokens + safeNum(bonus?.bonus_tokens, 0),
};
});

const participantDistributedBase = sum(participantRows, (x) => x.base_tokens);
const participantDistributedBonus = sum(participantRows, (x) => x.bonus_tokens);
const participantDistributedTotal = sum(participantRows, (x) => x.token_amount);

const unsoldParticipantTokensBurned = Math.max(
0,
participantBaseTokens - participantDistributedBase
);

const unusedBonusTokensBurned = Math.max(
0,
participantBonusPoolTokens - participantDistributedBonus
);

const totalBurned = unsoldParticipantTokensBurned + unusedBonusTokensBurned;
const finalSupply = Math.max(0, totalSupply - totalBurned);

const builder = await db.get(
`
SELECT b.wallet
FROM launches l
JOIN builders b ON b.id = l.builder_id
WHERE l.id = ?
`,
[launchId]
);

const allocationRows = [];

for (const row of participantRows) {
allocationRows.push({
wallet: row.wallet,
allocation_type: "participant",
token_amount: row.token_amount,
sol_amount: row.committed_sol,
});
}

allocationRows.push({
wallet: builder?.wallet || `BUILDER_LAUNCH_${launchId}`,
allocation_type: "builder",
token_amount: builderTokens,
sol_amount: 0,
});

for (const row of teamRows) {
allocationRows.push(row);
}

allocationRows.push({
wallet: `RESERVE_LAUNCH_${launchId}`,
allocation_type: "reserve",
token_amount: reserveTokens,
sol_amount: 0,
});

allocationRows.push({
wallet: `INTERNAL_POOL_LAUNCH_${launchId}`,
allocation_type: "internal_pool",
token_amount: internalPoolTokens,
sol_amount: netCommittedAfterLaunchFee,
});

allocationRows.push({
wallet: `RAYDIUM_RESERVED_LAUNCH_${launchId}`,
allocation_type: "raydium_reserved",
token_amount: raydiumLiquidityTokensReserved,
sol_amount: 0,
});

if (unsoldParticipantTokensBurned > 0) {
allocationRows.push({
wallet: "11111111111111111111111111111111",
allocation_type: "burn_unsold_participants",
token_amount: unsoldParticipantTokensBurned,
sol_amount: 0,
});
}

if (unusedBonusTokensBurned > 0) {
allocationRows.push({
wallet: "11111111111111111111111111111111",
allocation_type: "burn_unused_bonus",
token_amount: unusedBonusTokensBurned,
sol_amount: 0,
});
}

for (const row of allocationRows) {
await db.run(
`
INSERT INTO allocations (
launch_id,
wallet,
allocation_type,
token_amount,
sol_amount
) VALUES (?, ?, ?, ?, ?)
`,
[
launchId,
row.wallet,
row.allocation_type,
String(row.token_amount),
Number(row.sol_amount || 0),
]
);
}

return {
launchId,
totalSupply,
finalSupply,
totalCommitted,
launchFeePct,
launchFeeSol,
netRaiseAfterFee: netCommittedAfterLaunchFee,
participantTotalTokens,
participantBaseTokens,
participantBonusPoolTokens,
participantDistributedBase,
participantDistributedBonus,
participantDistributedTotal,
unsoldParticipantTokensBurned,
unusedBonusTokensBurned,
internalPoolSol: netCommittedAfterLaunchFee,
internalPoolTokens,
raydiumLiquidityTokensReserved,
reserveTokens,
builderTokens,
teamTokens,
effectiveReservePct,
allocations: participantRows,
systemAllocations: allocationRows.filter((x) => x.allocation_type !== "participant"),
};
}