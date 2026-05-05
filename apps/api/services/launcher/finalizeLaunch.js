import db from "../../db/index.js";
import { buildLaunchAllocations } from "./allocationService.js";
import { distributeLaunchFees } from "./feeDistributor.js";
import { bootstrapLiveMarket } from "./mintLifecycle.js";

const DEFAULT_LAUNCH_FEE_PCT = 3;
const LAUNCH_FEE_SPLIT = {
coreTeamDevelopment: 0.6,
ecosystemSupport: 0.4,
};

const finalizeRunLocks = new Map();
const tableColumnCache = new Map();

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

if (
!hasExplicitTimezone &&
/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
) {
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

function firstPresent(...values) {
for (const value of values) {
if (value == null) continue;
const text = cleanText(value, 5000);
if (text) return value;
}
return null;
}

function allocationUnusedParticipantBurn(allocationResult = null) {
return String(
firstPresent(
allocationResult?.unusedParticipantTokensBurned,
allocationResult?.unsoldParticipantTokensBurned,
allocationResult?.totalBurned,
"0"
) ?? "0"
);
}

function allocationUnusedBonusBurn(allocationResult = null) {
return String(
firstPresent(allocationResult?.unusedBonusTokensBurned, "0") ?? "0"
);
}

function isBootstrapped(launch) {
return safeNum(launch?.market_bootstrapped, 0) === 1;
}

function buildNormalizedLaunchFeeBreakdown(
totalCommitted,
launchFeePct = DEFAULT_LAUNCH_FEE_PCT
) {
const committed = roundSol(safeNum(totalCommitted, 0));
const pct = safeNum(launchFeePct, DEFAULT_LAUNCH_FEE_PCT);
const feeTotal = roundSol(committed * (pct / 100));
const coreTeamDevelopmentFee = roundSol(
feeTotal * LAUNCH_FEE_SPLIT.coreTeamDevelopment
);
const ecosystemSupportFee = roundSol(feeTotal - coreTeamDevelopmentFee);
const netRaiseAfterFee = roundSol(committed - feeTotal);

return {
launchFeePct: pct,
totalCommitted: committed,
feeTotal,
coreTeamDevelopmentFee,
ecosystemSupportFee,
netRaiseAfterFee,
split: {
coreTeamDevelopmentPct: LAUNCH_FEE_SPLIT.coreTeamDevelopment * 100,
ecosystemSupportPct: LAUNCH_FEE_SPLIT.ecosystemSupport * 100,
},
compatibility: {
founderFee: coreTeamDevelopmentFee,
coreFee: coreTeamDevelopmentFee,
buybackFee: 0,
treasuryFee: ecosystemSupportFee,
},
};
}

function normalizeFeePlanPayload(
raw = null,
totalCommitted = 0,
launchFeePct = DEFAULT_LAUNCH_FEE_PCT
) {
const base = buildNormalizedLaunchFeeBreakdown(totalCommitted, launchFeePct);
const payload = raw && typeof raw === "object" ? raw : {};

return {
...payload,
launchFeePct: base.launchFeePct,
totalCommitted: base.totalCommitted,
feeTotal: base.feeTotal,
coreTeamDevelopmentFee: base.coreTeamDevelopmentFee,
ecosystemSupportFee: base.ecosystemSupportFee,
netRaiseAfterFee: base.netRaiseAfterFee,
split: base.split,
compatibility: base.compatibility,
founderFee: base.compatibility.founderFee,
coreFee: base.compatibility.coreFee,
buybackFee: base.compatibility.buybackFee,
treasuryFee: base.compatibility.treasuryFee,
netRaise: base.netRaiseAfterFee,
};
}

function normalizeFeeDistributionPayload(raw = null, feePlan = null) {
if (!raw || typeof raw !== "object") {
return null;
}

const normalizedPlan =
feePlan ||
buildNormalizedLaunchFeeBreakdown(
safeNum(raw.totalCommitted, 0),
safeNum(raw.launchFeePct, DEFAULT_LAUNCH_FEE_PCT)
);

const coreTeamDevelopmentFee = safeNum(
firstPresent(
raw.coreTeamDevelopmentFee,
raw.core_team_development_fee,
raw.coreFee,
raw.core_fee,
raw.founderFee,
raw.founder_fee
),
normalizedPlan.coreTeamDevelopmentFee
);

const ecosystemSupportFee = safeNum(
firstPresent(
raw.ecosystemSupportFee,
raw.ecosystem_support_fee,
raw.treasuryFee,
raw.treasury_fee
),
normalizedPlan.ecosystemSupportFee
);

const buybackFee = safeNum(
firstPresent(raw.buybackFee, raw.buyback_fee),
0
);

return {
...raw,
launchFeePct: normalizedPlan.launchFeePct,
feeTotal: normalizedPlan.feeTotal,
totalDistributed: safeNum(
firstPresent(raw.totalDistributed, raw.total_distributed, raw.feeTotal),
normalizedPlan.feeTotal
),
coreTeamDevelopmentFee,
ecosystemSupportFee,
split: normalizedPlan.split,
compatibility: {
founderFee: coreTeamDevelopmentFee,
coreFee: coreTeamDevelopmentFee,
buybackFee,
treasuryFee: ecosystemSupportFee,
},
founderFee: coreTeamDevelopmentFee,
coreFee: coreTeamDevelopmentFee,
buybackFee,
treasuryFee: ecosystemSupportFee,
netRaiseAfterFee: normalizedPlan.netRaiseAfterFee,
netRaise: normalizedPlan.netRaiseAfterFee,
};
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
market_bootstrapped:
row.market_bootstrapped === undefined ? null : row.market_bootstrapped,
team_wallets: Array.isArray(row.team_wallets)
? row.team_wallets
: parseJsonMaybe(row.team_wallets, []),
team_wallet_breakdown: Array.isArray(row.team_wallet_breakdown)
? row.team_wallet_breakdown
: parseJsonMaybe(row.team_wallet_breakdown, []),
launch_result_json: parseJsonMaybe(row.launch_result_json, null),
fee_distribution_json: normalizeFeeDistributionPayload(
parseJsonMaybe(row.fee_distribution_json, null),
buildNormalizedLaunchFeeBreakdown(
safeNum(row.committed_sol, 0),
safeNum(row.launch_fee_pct, DEFAULT_LAUNCH_FEE_PCT)
)
),
contract_address: cleanText(row.contract_address, 120),
token_mint: cleanText(row.token_mint, 120),
final_supply: cleanText(row.final_supply, 120),
internal_pool_tokens: cleanText(row.internal_pool_tokens, 120),
raydium_liquidity_tokens_reserved: cleanText(
row.raydium_liquidity_tokens_reserved,
120
),
unsold_participant_tokens_burned: cleanText(
row.unsold_participant_tokens_burned,
120
),
unused_bonus_tokens_burned: cleanText(
row.unused_bonus_tokens_burned,
120
),
mint_reservation_status: cleanText(
row.mint_reservation_status,
40
).toLowerCase(),
mint_finalized_at: row.mint_finalized_at || null,
status: cleanText(row.status, 40).toLowerCase(),
};
}

async function getTableColumns(tableName) {
const key = String(tableName || "").trim();

if (tableColumnCache.has(key)) {
return tableColumnCache.get(key);
}

const rows = await db.all(`PRAGMA table_info(${key})`);
const columns = new Set(rows.map((row) => String(row.name || "").trim()));
tableColumnCache.set(key, columns);
return columns;
}

async function updateLaunchFieldsSafe(launchId, fields = {}) {
const columns = await getTableColumns("launches");
const entries = Object.entries(fields).filter(([name, value]) => {
return columns.has(name) && value !== undefined;
});

if (!entries.length && !columns.has("updated_at")) return;

const setParts = entries.map(([name]) => `${name} = ?`);
const values = entries.map(([, value]) => value);

if (columns.has("updated_at")) {
setParts.push("updated_at = CURRENT_TIMESTAMP");
}

await db.run(
`
UPDATE launches
SET ${setParts.join(", ")}
WHERE id = ?
`,
[...values, launchId]
);
}

async function setLaunchMarketBootstrapped(launchId, bootstrapped) {
const columns = await getTableColumns("launches");
if (!columns.has("market_bootstrapped")) return;

await updateLaunchFieldsSafe(launchId, {
market_bootstrapped: bootstrapped ? 1 : 0,
});
}

async function getLaunchById(launchId) {
const row = await db.get(`SELECT * FROM launches WHERE id = ?`, [launchId]);
return normalizeLaunch(row);
}

async function getTokenByLaunchId(launchId) {
return db.get(
`
SELECT *
FROM tokens
WHERE launch_id = ?
ORDER BY id DESC
LIMIT 1
`,
[launchId]
);
}

async function getPoolByLaunchId(launchId) {
return db.get(
`
SELECT *
FROM pools
WHERE launch_id = ?
ORDER BY id DESC
LIMIT 1
`,
[launchId]
);
}

function pickMintFromToken(tokenRow) {
return cleanText(
firstPresent(
tokenRow?.mint_address,
tokenRow?.contract_address,
tokenRow?.token_mint,
tokenRow?.mint
),
120
);
}

function pickMintFromLaunch(launch) {
return cleanText(firstPresent(launch?.contract_address, launch?.token_mint), 120);
}

function pickSolReserve(poolRow) {
return safeNum(
firstPresent(
poolRow?.sol_reserve,
poolRow?.internal_pool_sol,
poolRow?.liquidity,
poolRow?.sol_liquidity
),
0
);
}

function pickTokenReserve(poolRow) {
return safeNum(
firstPresent(
poolRow?.token_reserve,
poolRow?.internal_pool_tokens,
poolRow?.token_liquidity
),
0
);
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

async function getLiveBootstrapArtifacts(launchId, launch) {
const [tokenRow, poolRow] = await Promise.all([
getTokenByLaunchId(launchId),
getPoolByLaunchId(launchId),
]);

const mint = cleanText(
firstPresent(pickMintFromLaunch(launch), pickMintFromToken(tokenRow)),
120
);

const solReserve = pickSolReserve(poolRow);
const tokenReserve = pickTokenReserve(poolRow);

const completed = Boolean(
hasPersistedAllocationResult(launch) &&
tokenRow?.id &&
poolRow?.id &&
mint &&
solReserve > 0 &&
tokenReserve > 0
);

return {
completed,
mint,
tokenRow,
poolRow,
tokenId: tokenRow?.id || null,
poolId: poolRow?.id || null,
solReserve,
tokenReserve,
};
}

async function normalizeBootstrapFlagAgainstArtifacts(launchId, launch) {
if (!launch) return null;

const artifacts = await getLiveBootstrapArtifacts(launchId, launch);

if (artifacts.completed) {
if (!isBootstrapped(launch)) {
await setLaunchMarketBootstrapped(launchId, true);
return getLaunchById(launchId);
}
return launch;
}

if (isBootstrapped(launch)) {
await setLaunchMarketBootstrapped(launchId, false);
return getLaunchById(launchId);
}

return launch;
}

async function demoteLiveToBuildingIfArtifactsIncomplete(launchId, launch) {
if (!launch) return null;

const status = String(launch.status || "").toLowerCase();
if (status !== "live") {
return launch;
}

const artifacts = await getLiveBootstrapArtifacts(launchId, launch);
if (artifacts.completed) {
return launch;
}

await setLaunchMarketBootstrapped(launchId, false);

await db.run(
`
UPDATE launches
SET status = 'building',
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
AND status = 'live'
`,
[launchId]
);

return getLaunchById(launchId);
}

async function syncLaunchMarketArtifactsFromRows(launchId, launch) {
const artifacts = await getLiveBootstrapArtifacts(launchId, launch);

if (!artifacts.mint && !artifacts.poolRow?.id) {
return launch;
}

const fields = {};
const status = String(launch?.status || "").toLowerCase();

if (artifacts.mint && status === "live") {
fields.contract_address = artifacts.mint;
fields.token_mint = artifacts.mint;
}

if (artifacts.solReserve > 0) {
fields.liquidity = artifacts.solReserve;
fields.internal_pool_sol = artifacts.solReserve;
}

if (artifacts.tokenReserve > 0) {
fields.internal_pool_tokens = String(artifacts.tokenReserve);
}

if (artifacts.completed) {
fields.market_bootstrapped = 1;
}

await updateLaunchFieldsSafe(launchId, fields);

let refreshed = await getLaunchById(launchId);
refreshed = await normalizeBootstrapFlagAgainstArtifacts(launchId, refreshed);
refreshed = await demoteLiveToBuildingIfArtifactsIncomplete(launchId, refreshed);

return refreshed || launch;
}

async function syncLaunchMarketArtifactsFromBootstrap(
launchId,
marketBootstrap,
allocationResult = null
) {
if (!marketBootstrap || typeof marketBootstrap !== "object") return;

const mintAddress = cleanText(
firstPresent(
marketBootstrap.mintAddress,
marketBootstrap.mint_address,
marketBootstrap.contractAddress,
marketBootstrap.contract_address
),
120
);

const fields = {};

if (mintAddress) {
fields.contract_address = mintAddress;
fields.token_mint = mintAddress;
}

const liquidity = safeNum(
firstPresent(
marketBootstrap.liquidity,
marketBootstrap.internalPoolSol,
marketBootstrap.solReserve,
allocationResult?.internalPoolSol
),
0
);

const price = safeNum(marketBootstrap.price, 0);
const marketCap = safeNum(marketBootstrap.marketCap, 0);
const volume24h = safeNum(marketBootstrap.volume24h, 0);
const circulatingSupply = safeNum(marketBootstrap.circulatingSupply, 0);

const internalPoolSol = safeNum(
firstPresent(
marketBootstrap.internalPoolSol,
liquidity,
allocationResult?.internalPoolSol
),
0
);

const internalPoolTokensRaw = firstPresent(
marketBootstrap.internalPoolTokens,
marketBootstrap.tokenReserve,
allocationResult?.internalPoolTokens
);

const internalPoolTokensNum = safeNum(internalPoolTokensRaw, 0);

const raydiumReservedTokens = firstPresent(
marketBootstrap.raydiumReservedTokens,
marketBootstrap.raydiumLiquidityTokensReserved,
allocationResult?.raydiumLiquidityTokensReserved
);

if (liquidity > 0) fields.liquidity = liquidity;
if (internalPoolSol > 0) fields.internal_pool_sol = internalPoolSol;
if (internalPoolTokensRaw != null) {
fields.internal_pool_tokens = String(internalPoolTokensRaw);
}
if (raydiumReservedTokens != null) {
fields.raydium_liquidity_tokens_reserved = String(raydiumReservedTokens);
}
if (circulatingSupply > 0) fields.circulating_supply = circulatingSupply;
if (price > 0) fields.price = price;
if (marketCap > 0) fields.market_cap = marketCap;
if (volume24h >= 0) fields.volume_24h = volume24h;

if (
marketBootstrap.ok !== false &&
mintAddress &&
internalPoolSol > 0 &&
internalPoolTokensNum > 0
) {
fields.market_bootstrapped = 1;
}

await updateLaunchFieldsSafe(launchId, fields);
}

function requiresLaunchBond(launch) {
if (!launch) return false;
return safeNum(launch.builder_bond_sol, 0) > 0;
}

function isLaunchBondSatisfied(launch) {
if (!requiresLaunchBond(launch)) return true;
return safeNum(launch.builder_bond_paid, 0) === 1;
}

async function hasCompletedLiveBootstrap(launchId, launch) {
if (!launch) return false;
const artifacts = await getLiveBootstrapArtifacts(launchId, launch);
return artifacts.completed;
}

async function refreshLiveMarketAfterPromotion(
launchId,
launch,
allocationResult = null
) {
let marketBootstrap = null;
let refreshedLaunch = launch || (await getLaunchById(launchId));

try {
refreshedLaunch = await normalizeBootstrapFlagAgainstArtifacts(
launchId,
refreshedLaunch || launch
);
refreshedLaunch = await demoteLiveToBuildingIfArtifactsIncomplete(
launchId,
refreshedLaunch || launch
);

const existingArtifacts = await getLiveBootstrapArtifacts(
launchId,
refreshedLaunch || launch
);

if (!existingArtifacts.completed) {
marketBootstrap = await bootstrapLiveMarket(launchId);
await syncLaunchMarketArtifactsFromBootstrap(
launchId,
marketBootstrap,
allocationResult
);
}

refreshedLaunch = await getLaunchById(launchId);
refreshedLaunch = await syncLaunchMarketArtifactsFromRows(
launchId,
refreshedLaunch || launch
);

if (
(existingArtifacts.completed || marketBootstrap?.ok !== false) &&
(await hasCompletedLiveBootstrap(launchId, refreshedLaunch || launch))
) {
await setLaunchMarketBootstrapped(launchId, true);
refreshedLaunch = (await getLaunchById(launchId)) || refreshedLaunch;
}

return {
launch: refreshedLaunch || launch,
marketBootstrap,
error: "",
};
} catch (err) {
console.error(`Post-live market refresh failed for launch ${launchId}:`, err);

return {
launch: refreshedLaunch || launch,
marketBootstrap,
error: err?.message || "post-live market refresh failed",
};
}
}

function buildFinalizeResponse({
ok,
launchId,
launch,
totalCommitted = null,
participants = null,
feePlan = null,
feeDistribution = null,
feeDistributionPending = false,
feeDistributionError = "",
allocationsBuilt = false,
marketBootstrap = null,
allocationResult = null,
alreadyFinalized = false,
stage = "live",
stageLabel = "",
reason = "",
retryable = false,
}) {
const resolvedFeePlan = normalizeFeePlanPayload(
feePlan,
safeNum(totalCommitted, safeNum(launch?.committed_sol, 0)),
safeNum(launch?.launch_fee_pct, DEFAULT_LAUNCH_FEE_PCT)
);

const resolvedFeeDistribution = normalizeFeeDistributionPayload(
launch?.fee_distribution_json || feeDistribution || null,
resolvedFeePlan
);

const resolvedMint =
marketBootstrap?.mintAddress ||
cleanText(launch?.contract_address, 120) ||
cleanText(launch?.token_mint, 120) ||
null;

const unsoldParticipantTokensBurned = String(
firstPresent(
launch?.unsold_participant_tokens_burned,
allocationResult?.unusedParticipantTokensBurned,
allocationResult?.unsoldParticipantTokensBurned,
allocationResult?.totalBurned,
"0"
)
);

return {
ok: Boolean(ok),
alreadyFinalized: Boolean(alreadyFinalized),
retryable: Boolean(retryable),
reason: reason || "",
launchId,
stage,
status: cleanText(launch?.status, 40).toLowerCase() || stage,
stageLabel:
stageLabel ||
(stage === "building"
? "Building market"
: stage === "live"
? "Live"
: stage === "countdown"
? "Countdown"
: "Ready"),
totalCommitted: safeNum(totalCommitted, safeNum(launch?.committed_sol, 0)),
participants: safeNum(participants, safeNum(launch?.participants_count, 0)),
launchFeePct: resolvedFeePlan.launchFeePct,
feeTotal: safeNum(resolvedFeePlan.feeTotal, 0),
coreTeamDevelopmentFee: safeNum(
resolvedFeePlan.coreTeamDevelopmentFee,
0
),
ecosystemSupportFee: safeNum(resolvedFeePlan.ecosystemSupportFee, 0),
coreTeamDevelopmentPct: safeNum(
resolvedFeePlan.split?.coreTeamDevelopmentPct,
60
),
ecosystemSupportPct: safeNum(
resolvedFeePlan.split?.ecosystemSupportPct,
40
),
founderFee: safeNum(resolvedFeePlan.compatibility?.founderFee, 0),
coreFee: safeNum(resolvedFeePlan.compatibility?.coreFee, 0),
buybackFee: safeNum(resolvedFeePlan.compatibility?.buybackFee, 0),
treasuryFee: safeNum(resolvedFeePlan.compatibility?.treasuryFee, 0),
netRaise: safeNum(resolvedFeePlan.netRaiseAfterFee, 0),
netRaiseAfterFee: safeNum(resolvedFeePlan.netRaiseAfterFee, 0),
feeDistribution: resolvedFeeDistribution,
feeDistributionPending: Boolean(feeDistributionPending),
feeDistributionError: feeDistributionError || "",
allocationsBuilt: Boolean(allocationsBuilt),
marketBootstrap,
marketBootstrapped: isBootstrapped(launch),
market_bootstrapped: isBootstrapped(launch),
mintAddress: resolvedMint,
mintSource: marketBootstrap?.mintSource || null,
tokenId: marketBootstrap?.tokenId || null,
poolId: marketBootstrap?.poolId || null,
mintReservationStatus: launch?.mint_reservation_status || "",
mintFinalizedAt: launch?.mint_finalized_at || null,
finalSupply: String(launch?.final_supply || allocationResult?.finalSupply || ""),
unsoldParticipantTokensBurned,
unusedParticipantTokensBurned: unsoldParticipantTokensBurned,
unusedBonusTokensBurned: String(
firstPresent(
launch?.unused_bonus_tokens_burned,
allocationResult?.unusedBonusTokensBurned,
"0"
)
),
internalPoolSol: safeNum(
launch?.internal_pool_sol,
allocationResult?.internalPoolSol || 0
),
internalPoolTokens: String(
launch?.internal_pool_tokens || allocationResult?.internalPoolTokens || "0"
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
await setLaunchMarketBootstrapped(launchId, false);

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

async function forcePromoteLaunchToBuilding(launchId) {
await db.run(
`
UPDATE launches
SET status = 'building',
market_bootstrapped = CASE
WHEN market_bootstrapped = 1 THEN market_bootstrapped
ELSE 0
END,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
AND status IN ('countdown', 'building')
`,
[launchId]
);

const launch = await getLaunchById(launchId);

if (!launch) {
throw new Error("launch not found after building promotion");
}

if (String(launch.status || "").toLowerCase() !== "building") {
throw new Error("launch is not building after promotion");
}

return launch;
}

async function refreshBuildingStateAfterBootstrapFailure(launchId) {
await setLaunchMarketBootstrapped(launchId, false);

await db.run(
`
UPDATE launches
SET status = 'building',
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
AND status IN ('building', 'countdown', 'live')
`,
[launchId]
);

return getLaunchById(launchId);
}

async function forcePromoteLaunchToLive(launchId) {
await db.run(
`
UPDATE launches
SET status = 'live',
market_bootstrapped = CASE
WHEN COALESCE(market_bootstrapped, 0) = 1 THEN 1
ELSE market_bootstrapped
END,
live_at = CASE
WHEN status != 'live' THEN CURRENT_TIMESTAMP
WHEN live_at IS NULL THEN CURRENT_TIMESTAMP
WHEN countdown_ends_at IS NOT NULL
AND datetime(live_at) = datetime(countdown_ends_at)
THEN CURRENT_TIMESTAMP
ELSE live_at
END,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
AND status IN ('building', 'countdown', 'live')
`,
[launchId]
);

let liveLaunch = await getLaunchById(launchId);
liveLaunch = await normalizeBootstrapFlagAgainstArtifacts(launchId, liveLaunch);
liveLaunch = await demoteLiveToBuildingIfArtifactsIncomplete(launchId, liveLaunch);

if (!liveLaunch) {
throw new Error("launch not found after live promotion");
}

if (String(liveLaunch.status || "").toLowerCase() !== "live") {
throw new Error("launch is not live after promotion");
}

return liveLaunch;
}

async function persistAllocationResult(launchId, allocationResult) {
const unsoldParticipantTokensBurned =
allocationUnusedParticipantBurn(allocationResult);
const unusedBonusTokensBurned = allocationUnusedBonusBurn(allocationResult);

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
unsoldParticipantTokensBurned,
unusedBonusTokensBurned,
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
unusedParticipantTokensBurned:
launch.unsold_participant_tokens_burned || "0",
unsoldParticipantTokensBurned:
launch.unsold_participant_tokens_burned || "0",
unusedBonusTokensBurned: launch.unused_bonus_tokens_burned || "0",
internalPoolSol: launch.internal_pool_sol || 0,
internalPoolTokens: launch.internal_pool_tokens || "0",
raydiumLiquidityTokensReserved:
launch.raydium_liquidity_tokens_reserved || "0",
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
unusedParticipantTokensBurned:
latest?.unsold_participant_tokens_burned || "0",
unsoldParticipantTokensBurned:
latest?.unsold_participant_tokens_burned || "0",
unusedBonusTokensBurned: latest?.unused_bonus_tokens_burned || "0",
internalPoolSol: latest?.internal_pool_sol || 0,
internalPoolTokens: latest?.internal_pool_tokens || "0",
raydiumLiquidityTokensReserved:
latest?.raydium_liquidity_tokens_reserved || "0",
};
validateAllocationResult(allocationResult);
allocationsBuilt = true;
console.log(
`Allocation service reported already built for launch ${launchId}, skipping`
);
return { allocationResult, allocationsBuilt };
}

console.error(`Allocation build failed for launch ${launchId}:`, err);
throw err;
}
}

async function ensureFeeDistribution(launchId, launch, totalCommitted) {
const launchFeePct = safeNum(launch.launch_fee_pct, DEFAULT_LAUNCH_FEE_PCT);
const feePlan = buildNormalizedLaunchFeeBreakdown(totalCommitted, launchFeePct);
let feeDistribution = normalizeFeeDistributionPayload(
launch.fee_distribution_json || null,
feePlan
);

console.log("Finalizing launch", launchId);
console.log("Template:", launch.template);
console.log("Total committed:", totalCommitted);
console.log("Participants:", launch.participants_count);
console.log("Fee total:", feePlan.feeTotal);
console.log(
"Core Team Development fee:",
safeNum(feePlan.coreTeamDevelopmentFee, 0)
);
console.log(
"MSS Ecosystem Support fee:",
safeNum(feePlan.ecosystemSupportFee, 0)
);
console.log("Net raise:", safeNum(feePlan.netRaiseAfterFee, 0));

if (safeNum(launch.fees_distributed, 0) === 1) {
console.log(`Fees already distributed for launch ${launchId}, skipping`);
return {
feePlan,
feeDistribution,
feeDistributionPending: false,
feeDistributionError: "",
};
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
`SELECT fees_distributed, fee_distribution_json, committed_sol, launch_fee_pct FROM launches WHERE id = ?`,
[launchId]
)
);

feeDistribution = normalizeFeeDistributionPayload(
latest?.fee_distribution_json || null,
feePlan
);

console.log(`Fee distribution already claimed for launch ${launchId}, skipping`);

return {
feePlan,
feeDistribution,
feeDistributionPending: safeNum(latest?.fees_distributed, 0) !== 1,
feeDistributionError: "",
};
}

try {
const rawFeeDistribution = await distributeLaunchFees({
totalCommitted,
launchFeePct,
});

feeDistribution = normalizeFeeDistributionPayload(rawFeeDistribution, feePlan);

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

return {
feePlan,
feeDistribution,
feeDistributionPending: false,
feeDistributionError: "",
};
} catch (err) {
const feeError = err?.message || "fee distribution failed";

await db.run(
`
UPDATE launches
SET fees_distributed = 0,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launchId]
);

console.error(`Fee distribution failed for launch ${launchId}:`, err);

return {
feePlan,
feeDistribution,
feeDistributionPending: true,
feeDistributionError: feeError,
};
}
}

async function buildAlreadyLiveResponse({
launchId,
launch,
stats,
allocationResult = null,
marketBootstrap = null,
}) {
const refreshed = await refreshLiveMarketAfterPromotion(
launchId,
launch,
allocationResult || launch?.launch_result_json || null
);

const finalLaunch = refreshed.launch || launch;
const finalMarketBootstrap = refreshed.marketBootstrap || marketBootstrap;

console.log(`Launch ${launchId} already finalized/live, skipping re-finalize`);

return buildFinalizeResponse({
ok: true,
launchId,
launch: finalLaunch,
totalCommitted: stats.totalCommitted,
participants: stats.participants,
feeDistribution: finalLaunch.fee_distribution_json || null,
feeDistributionPending: safeNum(finalLaunch.fees_distributed, 0) !== 1,
feeDistributionError: refreshed.error || "",
allocationsBuilt: hasPersistedAllocationResult(finalLaunch),
marketBootstrap: finalMarketBootstrap,
allocationResult: finalLaunch.launch_result_json || allocationResult || null,
alreadyFinalized: true,
stage: "live",
stageLabel: "Live",
});
}

async function finalizeLaunchInternal(launchId) {
let launch = await getLaunchById(launchId);

if (!launch) {
throw new Error("Launch not found");
}

launch = await normalizeBootstrapFlagAgainstArtifacts(launchId, launch);
launch = await demoteLiveToBuildingIfArtifactsIncomplete(launchId, launch);

const status = String(launch.status || "").toLowerCase();

if (!["countdown", "building", "live"].includes(status)) {
return {
ok: false,
reason: "launch is not in countdown, building, or live",
};
}

if (!isLaunchBondSatisfied(launch)) {
if (status === "countdown") {
await markLaunchFailed(launchId);
}

return {
ok: false,
reason: "launch bond not paid",
};
}

if (status === "live" || status === "building") {
launch = await syncLaunchMarketArtifactsFromRows(launchId, launch);

if (await hasCompletedLiveBootstrap(launchId, launch)) {
await setLaunchMarketBootstrapped(launchId, true);

if (String(launch.status || "").toLowerCase() !== "live") {
launch = await forcePromoteLaunchToLive(launchId);
}

const stats = await getCommitStats(launchId);

return buildAlreadyLiveResponse({
launchId,
launch,
stats,
allocationResult: launch.launch_result_json || null,
});
}
}

if (status === "countdown") {
const countdownEnds = parseDbTime(launch.countdown_ends_at || launch.live_at);

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

launch = await normalizeBootstrapFlagAgainstArtifacts(launchId, launch);
launch = await demoteLiveToBuildingIfArtifactsIncomplete(launchId, launch);

if (!isLaunchBondSatisfied(launch)) {
if (String(launch.status || "").toLowerCase() === "countdown") {
await markLaunchFailed(launchId);
}

return {
ok: false,
reason: "launch bond not paid",
};
}

if (
String(launch.status || "").toLowerCase() === "live" ||
String(launch.status || "").toLowerCase() === "building"
) {
launch = await syncLaunchMarketArtifactsFromRows(launchId, launch);

if (await hasCompletedLiveBootstrap(launchId, launch)) {
await setLaunchMarketBootstrapped(launchId, true);

if (String(launch.status || "").toLowerCase() !== "live") {
launch = await forcePromoteLaunchToLive(launchId);
}

console.log(
`Launch ${launchId} finalized during sync window, skipping duplicate finalize`
);

return buildAlreadyLiveResponse({
launchId,
launch,
stats,
allocationResult: launch.launch_result_json || null,
});
}
}

const totalCommitted = safeNum(stats.totalCommitted, 0);
const minRaise = safeNum(launch.min_raise_sol, 0);

if (totalCommitted < minRaise) {
if (String(launch.status || "").toLowerCase() === "countdown") {
await markLaunchFailed(launchId);
}

return {
ok: false,
reason: "minimum raise not met",
totalCommitted,
minRaise,
};
}

const {
feePlan,
feeDistribution,
feeDistributionPending,
feeDistributionError,
} = await ensureFeeDistribution(launchId, launch, totalCommitted);

launch = await forcePromoteLaunchToBuilding(launchId);
await setLaunchMarketBootstrapped(launchId, false);
launch = await syncLaunchMarketArtifactsFromRows(launchId, launch);

if (await hasCompletedLiveBootstrap(launchId, launch)) {
await setLaunchMarketBootstrapped(launchId, true);
launch = await forcePromoteLaunchToLive(launchId);

const refreshed = await refreshLiveMarketAfterPromotion(
launchId,
launch,
launch.launch_result_json || null
);

const finalLaunch = refreshed.launch || launch;

console.log(
`Launch ${launchId} already had persisted bootstrap artifacts, promoting to live`
);

return buildFinalizeResponse({
ok: true,
launchId,
launch: finalLaunch,
totalCommitted,
participants: stats.participants,
feePlan,
feeDistribution: finalLaunch.fee_distribution_json || feeDistribution,
feeDistributionPending,
feeDistributionError: feeDistributionError || refreshed.error || "",
allocationsBuilt: hasPersistedAllocationResult(finalLaunch),
marketBootstrap: refreshed.marketBootstrap,
allocationResult: finalLaunch.launch_result_json || null,
alreadyFinalized: true,
stage: "live",
stageLabel: "Live",
});
}

const { allocationResult, allocationsBuilt } = await ensureAllocationResult(
launchId,
launch
);

let marketBootstrap = null;

try {
marketBootstrap = await bootstrapLiveMarket(launchId);
console.log("Market bootstrap complete:", marketBootstrap);
} catch (err) {
console.error(`Market bootstrap failed for launch ${launchId}:`, err);

const buildingLaunch = await refreshBuildingStateAfterBootstrapFailure(launchId);

return buildFinalizeResponse({
ok: false,
launchId,
launch: buildingLaunch || launch,
totalCommitted,
participants: stats.participants,
feePlan,
feeDistribution: buildingLaunch?.fee_distribution_json || feeDistribution,
feeDistributionPending,
feeDistributionError:
feeDistributionError || err?.message || "market bootstrap failed",
allocationsBuilt,
marketBootstrap: null,
allocationResult,
alreadyFinalized: false,
stage: "building",
stageLabel: "Bootstrap retry pending",
reason: err?.message || "market bootstrap failed",
retryable: true,
});
}

if (!marketBootstrap?.ok) {
const buildingLaunch = await refreshBuildingStateAfterBootstrapFailure(launchId);

return buildFinalizeResponse({
ok: false,
launchId,
launch: buildingLaunch || launch,
totalCommitted,
participants: stats.participants,
feePlan,
feeDistribution: buildingLaunch?.fee_distribution_json || feeDistribution,
feeDistributionPending,
feeDistributionError:
feeDistributionError ||
cleanText(marketBootstrap?.error, 500) ||
"market bootstrap failed",
allocationsBuilt,
marketBootstrap,
allocationResult,
alreadyFinalized: false,
stage: "building",
stageLabel: "Bootstrap retry pending",
reason: cleanText(marketBootstrap?.error, 500) || "market bootstrap failed",
retryable: true,
});
}

await syncLaunchMarketArtifactsFromBootstrap(
launchId,
marketBootstrap,
allocationResult
);

let bootstrapReadyLaunch = await getLaunchById(launchId);
bootstrapReadyLaunch = await syncLaunchMarketArtifactsFromRows(
launchId,
bootstrapReadyLaunch || launch
);

if (!(await hasCompletedLiveBootstrap(launchId, bootstrapReadyLaunch || launch))) {
const buildingLaunch = await refreshBuildingStateAfterBootstrapFailure(launchId);

return buildFinalizeResponse({
ok: false,
launchId,
launch: buildingLaunch || bootstrapReadyLaunch || launch,
totalCommitted,
participants: stats.participants,
feePlan,
feeDistribution: bootstrapReadyLaunch?.fee_distribution_json || feeDistribution,
feeDistributionPending,
feeDistributionError: feeDistributionError || "market bootstrap incomplete",
allocationsBuilt,
marketBootstrap,
allocationResult,
alreadyFinalized: false,
stage: "building",
stageLabel: "Bootstrap retry pending",
reason: "market bootstrap incomplete",
retryable: true,
});
}

await setLaunchMarketBootstrapped(launchId, true);
let finalLaunch = await forcePromoteLaunchToLive(launchId);

if (!finalLaunch) {
throw new Error("Launch not found after market bootstrap");
}

if (
!cleanText(finalLaunch.contract_address, 120) &&
!cleanText(finalLaunch.token_mint, 120)
) {
const buildingLaunch = await refreshBuildingStateAfterBootstrapFailure(launchId);

return buildFinalizeResponse({
ok: false,
launchId,
launch: buildingLaunch || finalLaunch,
totalCommitted,
participants: stats.participants,
feePlan,
feeDistribution: finalLaunch.fee_distribution_json || feeDistribution,
feeDistributionPending,
feeDistributionError:
feeDistributionError ||
"launch contract address missing after market bootstrap",
allocationsBuilt,
marketBootstrap,
allocationResult,
alreadyFinalized: false,
stage: "building",
stageLabel: "Bootstrap retry pending",
reason: "launch contract address missing after market bootstrap",
retryable: true,
});
}

const refreshed = await refreshLiveMarketAfterPromotion(
launchId,
finalLaunch,
allocationResult
);

finalLaunch = refreshed.launch || finalLaunch;
const finalMarketBootstrap = refreshed.marketBootstrap || marketBootstrap;

if (
!cleanText(finalLaunch.contract_address, 120) ||
!isBootstrapped(finalLaunch)
) {
const buildingLaunch = await refreshBuildingStateAfterBootstrapFailure(launchId);

return buildFinalizeResponse({
ok: false,
launchId,
launch: buildingLaunch || finalLaunch,
totalCommitted,
participants: stats.participants,
feePlan,
feeDistribution: finalLaunch.fee_distribution_json || feeDistribution,
feeDistributionPending,
feeDistributionError:
feeDistributionError || "launch bootstrap not fully settled after live refresh",
allocationsBuilt,
marketBootstrap: finalMarketBootstrap,
allocationResult,
alreadyFinalized: false,
stage: "building",
stageLabel: "Bootstrap retry pending",
reason: "launch bootstrap not fully settled after live refresh",
retryable: true,
});
}

console.log("Launch moved to LIVE:", launchId);

return buildFinalizeResponse({
ok: true,
launchId,
launch: finalLaunch,
totalCommitted,
participants: stats.participants,
feePlan,
feeDistribution: finalLaunch.fee_distribution_json || feeDistribution,
feeDistributionPending,
feeDistributionError: feeDistributionError || refreshed.error || "",
allocationsBuilt,
marketBootstrap: finalMarketBootstrap,
allocationResult,
alreadyFinalized: false,
stage: "live",
stageLabel: "Live",
});
}

export async function finalizeLaunch(launchId) {
if (finalizeRunLocks.has(launchId)) {
return finalizeRunLocks.get(launchId);
}

const runPromise = (async () => {
return finalizeLaunchInternal(launchId);
})();

finalizeRunLocks.set(launchId, runPromise);

try {
return await runPromise;
} finally {
finalizeRunLocks.delete(launchId);
}
}
