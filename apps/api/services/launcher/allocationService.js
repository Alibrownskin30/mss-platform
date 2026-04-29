import db from "../../db/index.js";

const DEFAULT_PARTICIPANT_PCT = 45;
const DEFAULT_LIQUIDITY_PCT = 20;
const DEFAULT_MAX_WALLET_ALLOCATION_PCT = 0.5;
const DEFAULT_LAUNCH_FEE_PCT = 5;

const TEMPLATE_BONUS_PCT = {
degen: 20,
degen_zone: 20,
meme_lite: 25,
meme_pro: 30,
community: 25,
builder: 25,
};

const TEMPLATE_PARTICIPANT_VESTING = {
degen: {
unlockPctAtLaunch: 40,
vestingDays: 7,
label: "40% unlocked at launch, 60% over 7 days",
},
degen_zone: {
unlockPctAtLaunch: 40,
vestingDays: 7,
label: "40% unlocked at launch, 60% over 7 days",
},
meme_lite: {
unlockPctAtLaunch: 35,
vestingDays: 14,
label: "35% unlocked at launch, 65% over 14 days",
},
meme_pro: {
unlockPctAtLaunch: 25,
vestingDays: 21,
label: "25% unlocked at launch, 75% over 21 days",
},
community: {
unlockPctAtLaunch: 25,
vestingDays: 21,
label: "25% unlocked at launch, 75% over 21 days",
},
builder: {
unlockPctAtLaunch: 25,
vestingDays: 21,
label: "25% unlocked at launch, 75% over 21 days",
},
};

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

function cleanText(value, max = 5000) {
return String(value ?? "").trim().slice(0, max);
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

function normalizeTemplate(value) {
return cleanText(value, 80).toLowerCase() || "meme_lite";
}

function getTemplateBonusPct(launch) {
const template = normalizeTemplate(launch?.template || launch?.launch_type);
return safeNum(
launch?.participant_bonus_pct,
TEMPLATE_BONUS_PCT[template] ?? 25
);
}

function getParticipantVestingProfile(launch) {
const template = normalizeTemplate(launch?.template || launch?.launch_type);

return (
TEMPLATE_PARTICIPANT_VESTING[template] || {
unlockPctAtLaunch: 25,
vestingDays: 21,
label: "25% unlocked at launch, 75% over 21 days",
}
);
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
participants_pct: safeNum(row.participants_pct, DEFAULT_PARTICIPANT_PCT),
liquidity_pct: safeNum(row.liquidity_pct, DEFAULT_LIQUIDITY_PCT),
reserve_pct: safeNum(row.reserve_pct, 0),
builder_pct: safeNum(row.builder_pct, 0),
team_allocation_pct: safeNum(row.team_allocation_pct, 0),
builder_bond_sol: safeNum(row.builder_bond_sol, 0),
builder_bond_paid: safeNum(row.builder_bond_paid, 0),
max_wallet_allocation_pct: safeNum(
row.max_wallet_allocation_pct,
DEFAULT_MAX_WALLET_ALLOCATION_PCT
),
participant_bonus_pct: safeNum(
row.participant_bonus_pct,
TEMPLATE_BONUS_PCT[normalizeTemplate(row.template || row.launch_type)] ?? 25
),
team_wallet_breakdown: parseJsonArray(row.team_wallet_breakdown),
countdown_ends_at: row.countdown_ends_at || null,
live_at: row.live_at || null,
team_wallets: parseJsonArray(row.team_wallets),
builder_wallet: cleanWallet(row.builder_wallet),
template: normalizeTemplate(row.template),
launch_type: normalizeTemplate(row.launch_type),
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

const cappedTeamAllocationPct = Math.min(Math.max(teamAllocationPct, 0), 15);

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

const teamTokens = toTokenAmount(totalSupply, cappedTeamAllocationPct);

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
vesting: {
unlockPctAtLaunch: 0,
cliffDays: 14,
vestingDays: 180,
label: "0% unlocked at launch, 14 day cliff, linear vesting over 180 days",
},
});
}

return {
teamTokens,
rows,
};
}

function buildParticipantAllocations({
commits,
hardCap,
internalPoolSol,
internalPoolTokens,
participantMaxTokens,
maxWalletAllocationTokens,
bonusPct,
vestingProfile,
}) {
if (!commits.length) return [];

if (internalPoolSol <= 0 || internalPoolTokens <= 0) {
throw new Error("invalid internal pool seed for participant allocation");
}

const openingPriceSol = internalPoolSol / internalPoolTokens;

if (!Number.isFinite(openingPriceSol) || openingPriceSol <= 0) {
throw new Error("invalid opening price for participant allocation");
}

let runningCommitted = 0;

const rows = commits.map((row) => {
const fillBefore = hardCap > 0 ? runningCommitted / hardCap : 0;
const fillAfter = hardCap > 0 ? (runningCommitted + row.sol_amount) / hardCap : 0;

runningCommitted += row.sol_amount;

const baseTokensRaw = row.sol_amount / openingPriceSol;
const bonusTokensRaw = baseTokensRaw * (bonusPct / 100);
const wantedTotalRaw = baseTokensRaw + bonusTokensRaw;

const wantedBaseTokens = floorBig(baseTokensRaw);
const wantedBonusTokens = floorBig(bonusTokensRaw);
const wantedTotalTokens = floorBig(wantedTotalRaw);

const cappedTotalTokens = Math.max(
0,
Math.min(wantedTotalTokens, maxWalletAllocationTokens)
);

const baseTokens = Math.min(wantedBaseTokens, cappedTotalTokens);
const bonusTokens = Math.max(0, cappedTotalTokens - baseTokens);

const unlockedAtLaunch = floorBig(
(cappedTotalTokens * vestingProfile.unlockPctAtLaunch) / 100
);

const lockedTokens = Math.max(0, cappedTotalTokens - unlockedAtLaunch);

return {
wallet: row.wallet,
allocation_type: "participant",
committed_sol: row.sol_amount,
opening_price_sol: openingPriceSol,
bonus_pct: bonusPct,
fill_before: fillBefore,
fill_after: fillAfter,

wanted_base_tokens: wantedBaseTokens,
wanted_bonus_tokens: wantedBonusTokens,
wanted_total_tokens: wantedTotalTokens,

base_tokens: baseTokens,
bonus_tokens: bonusTokens,
token_amount: cappedTotalTokens,

wallet_cap_tokens: maxWalletAllocationTokens,
capped_by_wallet_limit: wantedTotalTokens > maxWalletAllocationTokens,

unlocked_at_launch_tokens: unlockedAtLaunch,
locked_tokens: lockedTokens,
vesting_unlock_pct_at_launch: vestingProfile.unlockPctAtLaunch,
vesting_days: vestingProfile.vestingDays,
vesting_label: vestingProfile.label,
};
});

const wantedTotal = sum(rows, (x) => x.token_amount);

if (wantedTotal <= participantMaxTokens) {
return rows;
}

let distributed = 0;

return rows.map((row, index) => {
let tokenAmount;

if (index === rows.length - 1) {
tokenAmount = Math.max(0, participantMaxTokens - distributed);
} else {
tokenAmount = floorBig((row.token_amount / wantedTotal) * participantMaxTokens);
distributed += tokenAmount;
}

const baseTokens = Math.min(row.base_tokens, tokenAmount);
const bonusTokens = Math.max(0, tokenAmount - baseTokens);

const unlockedAtLaunch = floorBig(
(tokenAmount * vestingProfile.unlockPctAtLaunch) / 100
);

return {
...row,
base_tokens: baseTokens,
bonus_tokens: bonusTokens,
token_amount: tokenAmount,
capped_by_participant_pool: true,
unlocked_at_launch_tokens: unlockedAtLaunch,
locked_tokens: Math.max(0, tokenAmount - unlockedAtLaunch),
};
});
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
unusedParticipantTokensBurned,
}) {
const rows = [];

if (builderTokens > 0) {
rows.push({
wallet: builderWallet || `BUILDER_LAUNCH_${launchId}`,
allocation_type: "builder",
token_amount: builderTokens,
sol_amount: 0,
vesting: {
unlockPctAtLaunch: 0,
cliffDays: 7,
vestingDays: 90,
label: "0% unlocked at launch, 7 day cliff, linear vesting over 90 days",
},
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
locked: true,
note: "Protocol-controlled locked reserve. Not counted as circulating supply.",
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

if (unusedParticipantTokensBurned > 0) {
rows.push({
wallet: "11111111111111111111111111111111",
allocation_type: "burn_unused_participants",
token_amount: unusedParticipantTokensBurned,
sol_amount: 0,
});
}

return rows;
}

function assertAllocationMath({
totalSupply,
participantDistributedTotal,
unusedParticipantTokensBurned,
internalPoolTokens,
raydiumLiquidityTokensReserved,
reserveTokens,
builderTokens,
teamTokens,
}) {
const totalAccounted =
participantDistributedTotal +
unusedParticipantTokensBurned +
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
let launch = await db.get(`SELECT * FROM launches WHERE id = ?`, [launchId]);
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
const launchFeePct = safeNum(launch.launch_fee_pct, DEFAULT_LAUNCH_FEE_PCT);
const hardCap = safeNum(launch.hard_cap_sol, 0);

if (totalCommitted <= 0) {
throw new Error("invalid committed total");
}

const summedCommitSol = roundSol(sum(commits, (x) => x.sol_amount));

if (Math.abs(summedCommitSol - roundSol(totalCommitted)) > 0.000001) {
throw new Error("commit rows do not match launch committed total");
}

const launchFeeSol = roundSol((totalCommitted * launchFeePct) / 100);
const netRaiseAfterFee = roundSol(totalCommitted - launchFeeSol);

if (netRaiseAfterFee <= 0) {
throw new Error("net raise after fee must be greater than zero");
}

const isBuilderLaunch = String(launch.template || "") === "builder";
const teamAllocationPct = safeNum(launch.team_allocation_pct, 0);
const rawReservePct = safeNum(launch.reserve_pct, 0);
const builderPct = safeNum(launch.builder_pct, 0);
const liquidityPct = safeNum(launch.liquidity_pct, DEFAULT_LIQUIDITY_PCT);
const participantMaxPct = safeNum(launch.participants_pct, DEFAULT_PARTICIPANT_PCT);
const maxWalletAllocationPct = safeNum(
launch.max_wallet_allocation_pct,
DEFAULT_MAX_WALLET_ALLOCATION_PCT
);

if (liquidityPct <= 0) {
throw new Error("liquidity pct must be greater than zero");
}

if (participantMaxPct <= 0) {
throw new Error("participant max pct must be greater than zero");
}

const effectiveReservePct =
isBuilderLaunch && teamAllocationPct > 0
? Math.max(0, rawReservePct - teamAllocationPct)
: rawReservePct;

const participantMaxTokens = toTokenAmount(totalSupply, participantMaxPct);
const maxWalletAllocationTokens = toTokenAmount(totalSupply, maxWalletAllocationPct);

if (maxWalletAllocationTokens <= 0) {
throw new Error("max wallet allocation token cap is invalid");
}

const liquidityTokenAllocation = toTokenAmount(totalSupply, liquidityPct);

if (liquidityTokenAllocation <= 0) {
throw new Error("liquidity token allocation is invalid");
}

const internalPoolTokens = liquidityTokenAllocation;
const raydiumLiquidityTokensReserved = 0;

/*
MSS V1 target model:
- 5% launch fee is removed first.
- 95% of raised SOL goes into the internal LP.
- 20% of supply goes into the internal LP.
- Opening price is derived from that LP truth.
*/
const liquiditySolAllocation = netRaiseAfterFee;
const netRaiseRetainedOutsidePool = 0;
const openingPriceSol = liquiditySolAllocation / internalPoolTokens;
const openingFdvSol = openingPriceSol * totalSupply;

const reserveTokens = toTokenAmount(totalSupply, effectiveReservePct);
const builderTokens = toTokenAmount(totalSupply, builderPct);

const { teamTokens, rows: teamRows } = buildTeamAllocations({
isBuilderLaunch,
totalSupply,
teamAllocationPct,
teamWalletBreakdown: launch.team_wallet_breakdown,
});

const participantBonusPct = getTemplateBonusPct(launch);
const participantVesting = getParticipantVestingProfile(launch);

const participantRows = buildParticipantAllocations({
commits,
hardCap,
internalPoolSol: liquiditySolAllocation,
internalPoolTokens,
participantMaxTokens,
maxWalletAllocationTokens,
bonusPct: participantBonusPct,
vestingProfile: participantVesting,
});

const participantDistributedBase = sum(participantRows, (x) => x.base_tokens);
const participantDistributedBonus = sum(participantRows, (x) => x.bonus_tokens);
const participantDistributedTotal = sum(participantRows, (x) => x.token_amount);

const unusedParticipantTokensBurned = Math.max(
0,
participantMaxTokens - participantDistributedTotal
);

const totalBurned = unusedParticipantTokensBurned;

const totalAccounted = assertAllocationMath({
totalSupply,
participantDistributedTotal,
unusedParticipantTokensBurned,
internalPoolTokens,
raydiumLiquidityTokensReserved,
reserveTokens,
builderTokens,
teamTokens,
});

const unallocatedRemainder = Math.max(0, totalSupply - totalAccounted);
const finalSupply = Math.max(0, totalSupply - totalBurned - unallocatedRemainder);

const systemAllocationRows = buildSystemAllocations({
launchId,
builderWallet,
builderTokens,
teamRows,
reserveTokens,
internalPoolTokens,
internalPoolSol: liquiditySolAllocation,
raydiumLiquidityTokensReserved,
unusedParticipantTokensBurned: unusedParticipantTokensBurned + unallocatedRemainder,
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
netRaiseAfterFee,

liquidityPct,
liquiditySolAllocation,
netRaiseRetainedOutsidePool,
internalPoolSol: liquiditySolAllocation,
internalPoolTokens,
liquidityTokenAllocation,
raydiumLiquidityTokensReserved,

openingPriceSol,
openingFdvSol,

participantMaxPct,
participantMaxTokens,
maxWalletAllocationPct,
maxWalletAllocationTokens,
participantBonusPct,
participantVesting,

participantDistributedBase,
participantDistributedBonus,
participantDistributedTotal,
unusedParticipantTokensBurned,
totalBurned,

reserveTokens,
builderTokens,
teamTokens,
effectiveReservePct,

totalAccounted,
unallocatedRemainder,

builderVesting: {
totalAllocation: builderTokens,
unlockPctAtLaunch: 0,
cliffDays: 7,
vestingDays: 90,
label: "0% unlocked at launch, 7 day cliff, linear vesting over 90 days",
},

teamVesting: {
totalAllocation: teamTokens,
unlockPctAtLaunch: 0,
cliffDays: 14,
vestingDays: 180,
label: "0% unlocked at launch, 14 day cliff, linear vesting over 180 days",
},

reservePolicy: {
totalReserveTokens: reserveTokens,
locked: true,
countedAsCirculating: false,
label: "Protocol-controlled locked reserve. Any movement should require visible records/proof.",
},

allocations: participantRows,
systemAllocations: systemAllocationRows,
};
}