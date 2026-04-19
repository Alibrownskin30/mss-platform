import db from "../../db/index.js";

const DEFAULT_PARTICIPANT_PCT = 45;
const BONUS_PARTICIPANT_PCT = 3;
const DEFAULT_LIQUIDITY_PCT = 20;

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

function cleanWallet(value) {
return String(value || "").trim();
}

function normalizeWalletKey(value) {
return cleanWallet(value).toLowerCase();
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
wallet: cleanWallet(row?.wallet),
sol_amount: safeNum(row?.sol_amount, 0),
}))
.filter((row) => row.wallet && row.sol_amount > 0);
}

function mergeCommitRowsByWallet(rows) {
const ordered = [];
const byWallet = new Map();

for (const row of normalizeCommitRows(rows)) {
const key = normalizeWalletKey(row.wallet);
if (!key) continue;

if (!byWallet.has(key)) {
const merged = {
wallet: row.wallet,
sol_amount: roundSol(row.sol_amount),
};
byWallet.set(key, merged);
ordered.push(merged);
continue;
}

const existing = byWallet.get(key);
existing.sol_amount = roundSol(existing.sol_amount + row.sol_amount);
}

return ordered.filter((row) => row.wallet && row.sol_amount > 0);
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
participants_pct: safeNum(row.participants_pct, DEFAULT_PARTICIPANT_PCT),
liquidity_pct: safeNum(row.liquidity_pct, DEFAULT_LIQUIDITY_PCT),
reserve_pct: safeNum(row.reserve_pct, 0),
builder_pct: safeNum(row.builder_pct, 0),
team_allocation_pct: safeNum(row.team_allocation_pct, 0),
builder_bond_sol: safeNum(row.builder_bond_sol, 0),
builder_bond_paid: safeNum(row.builder_bond_paid, 0),
team_wallet_breakdown: parseJsonArray(row.team_wallet_breakdown),
countdown_ends_at: row.countdown_ends_at || null,
live_at: row.live_at || null,
team_wallets: parseJsonArray(row.team_wallets),
builder_wallet: cleanWallet(row.builder_wallet),
};
}

function isBuilderLaunchPaid(launch) {
if (!launch) return false;
if (String(launch.template || "") !== "builder") return true;
if (safeNum(launch.builder_bond_sol, 0) <= 0) return false;
return safeNum(launch.builder_bond_paid, 0) === 1;
}

function canBuildAllocationsForStatus(launch) {
const status = String(launch?.status || "").toLowerCase();

if (status === "live" || status === "graduated" || status === "building") {
return true;
}

if (status !== "countdown") {
return false;
}

const countdownEndsMs = parseDbTime(launch?.countdown_ends_at || launch?.live_at);
if (!Number.isFinite(countdownEndsMs)) {
return false;
}

return Date.now() >= countdownEndsMs;
}

function buildRestrictedCommitWalletSet(launch, builderWallet = "") {
const out = new Set();

const normalizedBuilderWallet =
normalizeWalletKey(builderWallet) || normalizeWalletKey(launch?.builder_wallet);
if (normalizedBuilderWallet) {
out.add(normalizedBuilderWallet);
}

const teamWallets = parseJsonArray(launch?.team_wallets);
for (const wallet of teamWallets) {
const normalized = normalizeWalletKey(wallet);
if (normalized) out.add(normalized);
}

const breakdown = parseJsonArray(launch?.team_wallet_breakdown);
for (const entry of breakdown) {
const normalized = normalizeWalletKey(entry?.wallet);
if (normalized) out.add(normalized);
}

return out;
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

const validRows = teamWalletBreakdown
.map((item) => ({
wallet: cleanWallet(item?.wallet),
pct: safeNum(item?.pct, 0),
}))
.filter((item) => item.wallet && item.pct > 0);

if (!validRows.length) {
return {
teamTokens: 0,
rows: [],
};
}

const totalBreakdownPct = sum(validRows, (x) => x.pct);
if (totalBreakdownPct <= 0) {
return {
teamTokens: 0,
rows: [],
};
}

const teamTokens = toTokenAmount(totalSupply, teamAllocationPct);

let distributed = 0;
const rows = [];

for (let i = 0; i < validRows.length; i += 1) {
const item = validRows[i];

let tokenAmount;
if (i === validRows.length - 1) {
tokenAmount = Math.max(0, teamTokens - distributed);
} else {
tokenAmount = floorBig((teamTokens * item.pct) / totalBreakdownPct);
distributed += tokenAmount;
}

rows.push({
wallet: item.wallet,
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

function buildSystemAllocations({
launchId,
builderWallet,
builderTokens,
teamRows,
reserveTokens,
internalPoolTokens,
internalPoolSol,
raydiumLiquidityTokensReserved,
unsoldParticipantTokensBurned,
unusedBonusTokensBurned,
}) {
const rows = [];

if (builderTokens > 0) {
rows.push({
wallet: builderWallet || `BUILDER_LAUNCH_${launchId}`,
allocation_type: "builder",
token_amount: builderTokens,
sol_amount: 0,
});
}

for (const row of teamRows) {
rows.push(row);
}

if (reserveTokens > 0) {
rows.push({
wallet: `RESERVE_LAUNCH_${launchId}`,
allocation_type: "reserve",
token_amount: reserveTokens,
sol_amount: 0,
});
}

if (internalPoolTokens > 0 || internalPoolSol > 0) {
rows.push({
wallet: `INTERNAL_POOL_LAUNCH_${launchId}`,
allocation_type: "internal_pool",
token_amount: internalPoolTokens,
sol_amount: internalPoolSol,
});
}

if (raydiumLiquidityTokensReserved > 0) {
rows.push({
wallet: `RAYDIUM_RESERVED_LAUNCH_${launchId}`,
allocation_type: "raydium_reserved",
token_amount: raydiumLiquidityTokensReserved,
sol_amount: 0,
});
}

if (unsoldParticipantTokensBurned > 0) {
rows.push({
wallet: "11111111111111111111111111111111",
allocation_type: "burn_unsold_participants",
token_amount: unsoldParticipantTokensBurned,
sol_amount: 0,
});
}

if (unusedBonusTokensBurned > 0) {
rows.push({
wallet: "11111111111111111111111111111111",
allocation_type: "burn_unused_bonus",
token_amount: unusedBonusTokensBurned,
sol_amount: 0,
});
}

return rows;
}

function assertAllocationMath({
totalSupply,
participantDistributedTotal,
unsoldParticipantTokensBurned,
unusedBonusTokensBurned,
internalPoolTokens,
raydiumLiquidityTokensReserved,
reserveTokens,
builderTokens,
teamTokens,
}) {
const totalAccounted =
participantDistributedTotal +
unsoldParticipantTokensBurned +
unusedBonusTokensBurned +
internalPoolTokens +
raydiumLiquidityTokensReserved +
reserveTokens +
builderTokens +
teamTokens;

if (totalAccounted > totalSupply) {
throw new Error("allocation math exceeds total supply");
}

return totalAccounted;
}

async function getCommitsTableName() {
const row = await db.get(
`
SELECT name
FROM sqlite_master
WHERE type = 'table' AND name IN ('launcher_commits', 'commits')
ORDER BY CASE WHEN name = 'launcher_commits' THEN 0 ELSE 1 END
LIMIT 1
`
);

return row?.name || null;
}

async function getCommittedRowsForLaunch(launchId) {
const tableName = await getCommitsTableName();
if (!tableName) return [];

const columns = await db.all(`PRAGMA table_info(${tableName})`);
const names = new Set(columns.map((row) => String(row.name || "").trim()));
const hasStatus = names.has("status");
const hasTxStatus = names.has("tx_status");

const rows = await db.all(
`
SELECT wallet, sol_amount
FROM ${tableName}
WHERE launch_id = ?
${
hasStatus
? `AND status IN ('confirmed', 'complete', 'completed')`
: hasTxStatus
? `AND tx_status IN ('confirmed', 'complete', 'completed')`
: ""
}
ORDER BY id ASC
`,
[launchId]
);

return normalizeCommitRows(rows);
}

export async function buildLaunchAllocations(launchId) {
let launch = await db.get(
`SELECT * FROM launches WHERE id = ?`,
[launchId]
);

launch = normalizeLaunch(launch);

if (!launch) {
throw new Error("launch not found");
}

if (!canBuildAllocationsForStatus(launch)) {
throw new Error("launch must be post-countdown before allocations can be built");
}

if (!isBuilderLaunchPaid(launch)) {
throw new Error("builder bond not paid for builder launch");
}

const existing = await db.get(
`SELECT id FROM allocations WHERE launch_id = ? LIMIT 1`,
[launchId]
);

if (existing) {
throw new Error("allocations already built for this launch");
}

const builder = await db.get(
`
SELECT b.wallet
FROM launches l
JOIN builders b ON b.id = l.builder_id
WHERE l.id = ?
`,
[launchId]
);

const builderWallet = cleanWallet(builder?.wallet || launch.builder_wallet || "");
const rawCommitRows = await getCommittedRowsForLaunch(launchId);
const commits = mergeCommitRowsByWallet(rawCommitRows);

const restrictedWallets = buildRestrictedCommitWalletSet(launch, builderWallet);
const restrictedCommitRows = commits.filter((row) =>
restrictedWallets.has(normalizeWalletKey(row.wallet))
);

if (restrictedCommitRows.length) {
const badWallets = restrictedCommitRows.map((row) => row.wallet).join(", ");
throw new Error(
`restricted commit wallets detected in participant phase: ${badWallets}`
);
}

const totalSupply = normalizeSupply(launch.final_supply || launch.supply);
const totalCommitted = safeNum(launch.committed_sol, 0);
const launchFeePct = safeNum(launch.launch_fee_pct, 5);
const hardCap = safeNum(launch.hard_cap_sol, 0);

if (totalCommitted <= 0) {
throw new Error("invalid committed total");
}

const summedCommitSol = roundSol(sum(commits, (x) => x.sol_amount));
if (Math.abs(summedCommitSol - roundSol(totalCommitted)) > 0.000001) {
throw new Error("commit rows do not match launch committed total");
}

const launchFeeSol = roundSol((totalCommitted * launchFeePct) / 100);
const netCommittedAfterLaunchFee = roundSol(totalCommitted - launchFeeSol);

const isBuilderLaunch = String(launch.template || "") === "builder";
const teamAllocationPct = safeNum(launch.team_allocation_pct, 0);
const rawReservePct = safeNum(launch.reserve_pct, 0);
const builderPct = safeNum(launch.builder_pct, 0);
const liquidityPct = safeNum(launch.liquidity_pct, DEFAULT_LIQUIDITY_PCT);

const effectiveReservePct =
isBuilderLaunch && teamAllocationPct > 0
? Math.max(0, rawReservePct - teamAllocationPct)
: rawReservePct;

const participantTotalPct = safeNum(launch.participants_pct, DEFAULT_PARTICIPANT_PCT);
const participantBonusPct = Math.min(BONUS_PARTICIPANT_PCT, participantTotalPct);
const participantBasePct = Math.max(0, participantTotalPct - participantBonusPct);

const participantTotalTokens = toTokenAmount(totalSupply, participantTotalPct);
const participantBaseTokens = toTokenAmount(totalSupply, participantBasePct);
const participantBonusPoolTokens = toTokenAmount(totalSupply, participantBonusPct);

if (participantBaseTokens + participantBonusPoolTokens > participantTotalTokens) {
throw new Error("participant allocation math exceeds configured participant pct");
}

const liquidityTokenAllocation = toTokenAmount(totalSupply, liquidityPct);
const internalPoolTokens = liquidityTokenAllocation;
const raydiumLiquidityTokensReserved = 0;

const liquiditySolAllocation = roundSol(
(netCommittedAfterLaunchFee * liquidityPct) / 100
);
const netRaiseRetainedOutsidePool = roundSol(
Math.max(0, netCommittedAfterLaunchFee - liquiditySolAllocation)
);

const reserveTokens = toTokenAmount(totalSupply, effectiveReservePct);
const builderTokens = toTokenAmount(totalSupply, builderPct);

const { teamTokens, rows: teamRows } = buildTeamAllocations({
isBuilderLaunch,
totalSupply,
teamAllocationPct,
teamWalletBreakdown: launch.team_wallet_breakdown,
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
committed_sol: row.sol_amount,
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

const totalBurned =
unsoldParticipantTokensBurned + unusedBonusTokensBurned;

const totalAccounted = assertAllocationMath({
totalSupply,
participantDistributedTotal,
unsoldParticipantTokensBurned,
unusedBonusTokensBurned,
internalPoolTokens,
raydiumLiquidityTokensReserved,
reserveTokens,
builderTokens,
teamTokens,
});

const unallocatedRemainder = Math.max(0, totalSupply - totalAccounted);
const finalSupply = Math.max(0, totalSupply - totalBurned);

const systemAllocationRows = buildSystemAllocations({
launchId,
builderWallet,
builderTokens,
teamRows,
reserveTokens,
internalPoolTokens,
internalPoolSol: liquiditySolAllocation,
raydiumLiquidityTokensReserved,
unsoldParticipantTokensBurned,
unusedBonusTokensBurned,
});

const allocationRows = [
...participantRows.map((row) => ({
wallet: row.wallet,
allocation_type: "participant",
token_amount: row.token_amount,
sol_amount: row.committed_sol,
})),
...systemAllocationRows,
];

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
liquidityPct,
liquiditySolAllocation,
netRaiseRetainedOutsidePool,
participantTotalPct,
participantBasePct,
participantBonusPct,
participantTotalTokens,
participantBaseTokens,
participantBonusPoolTokens,
participantDistributedBase,
participantDistributedBonus,
participantDistributedTotal,
unsoldParticipantTokensBurned,
unusedBonusTokensBurned,
totalBurned,
totalAccounted,
unallocatedRemainder,
internalPoolSol: liquiditySolAllocation,
internalPoolTokens,
liquidityTokenAllocation,
raydiumLiquidityTokensReserved,
reserveTokens,
builderTokens,
teamTokens,
effectiveReservePct,
allocations: participantRows,
systemAllocations: systemAllocationRows,
};
}
