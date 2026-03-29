import "dotenv/config";
import db from "../../db/index.js";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import bs58 from "bs58";

const DEFAULT_REQUIRED_MINT_TAG = "MSS";
const DEFAULT_MINT_RESERVATION_ATTEMPTS = 1000000;
const DEFAULT_POOL_TARGET_SIZE = 100;
const DEFAULT_POOL_TOPUP_BATCH = 5;
const CLAIM_RETRY_LIMIT = 10;
const BUILDER_TOTAL_ALLOCATION_PCT = 5;
const BUILDER_DAILY_UNLOCK_PCT = 0.5;
const LIQUIDITY_TOKEN_PCT = 20;
const RAYDIUM_LIQUIDITY_SPLIT_PCT = 50;

let launchesColumnsCache = null;
let mintReservationsColumnsCache = null;
let builderVestingColumnsCache = null;

function safeNum(value, fallback = 0) {
const n = Number(value);
return Number.isFinite(n) ? n : fallback;
}

function floorToken(value) {
return Math.floor(safeNum(value, 0));
}

function roundSol(value) {
return Number(safeNum(value, 0).toFixed(9));
}

function clean(value, max = 5000) {
return String(value ?? "").trim().slice(0, max);
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

async function getTableColumns(tableName) {
const rows = await db.all(`PRAGMA table_info(${tableName})`);
return new Set(rows.map((row) => String(row.name || "").trim()));
}

async function tableExists(tableName) {
const row = await db.get(
`
SELECT name
FROM sqlite_master
WHERE type = 'table' AND name = ?
LIMIT 1
`,
[tableName]
);
return Boolean(row?.name);
}

async function getLaunchesColumns() {
if (!launchesColumnsCache) {
launchesColumnsCache = await getTableColumns("launches");
}
return launchesColumnsCache;
}

async function getMintReservationsColumns() {
if (!mintReservationsColumnsCache) {
mintReservationsColumnsCache = await getTableColumns("mint_reservations");
}
return mintReservationsColumnsCache;
}

async function getBuilderVestingColumns() {
if (!builderVestingColumnsCache) {
if (await tableExists("builder_vesting")) {
builderVestingColumnsCache = await getTableColumns("builder_vesting");
} else {
builderVestingColumnsCache = new Set();
}
}
return builderVestingColumnsCache;
}

async function launchesHasColumn(columnName) {
const columns = await getLaunchesColumns();
return columns.has(columnName);
}

async function builderVestingHasColumn(columnName) {
const columns = await getBuilderVestingColumns();
return columns.has(columnName);
}

async function assertMintReservationSchema() {
const columns = await getMintReservationsColumns();

if (!columns.has("reserved_for_launch_id")) {
throw new Error(
"mint_reservations schema mismatch: expected reserved_for_launch_id"
);
}

if (!columns.has("mint_address")) {
throw new Error("mint_reservations schema mismatch: expected mint_address");
}

if (!columns.has("mint_secret")) {
throw new Error("mint_reservations schema mismatch: expected mint_secret");
}

if (!columns.has("status")) {
throw new Error("mint_reservations schema mismatch: expected status");
}

if (!columns.has("finalized_at")) {
throw new Error("mint_reservations schema mismatch: expected finalized_at");
}
}

function normalizeLaunch(row) {
if (!row) return null;

return {
...row,
launch_result_json: parseJsonMaybe(row.launch_result_json, null),
final_supply: String(row.final_supply || row.supply || "0"),
internal_pool_sol: safeNum(row.internal_pool_sol, 0),
internal_pool_tokens: String(row.internal_pool_tokens || "0"),
reserved_mint_address: clean(row.reserved_mint_address, 120),
reserved_mint_secret: clean(row.reserved_mint_secret, 20000),
mint_reservation_status: clean(row.mint_reservation_status, 40).toLowerCase(),
mint_required_tag:
clean(row.mint_required_tag, 32).toUpperCase() || DEFAULT_REQUIRED_MINT_TAG,
mint_reservation_attempts: safeNum(row.mint_reservation_attempts, 0),
contract_address: clean(row.contract_address, 120),
token_mint: clean(row.token_mint, 120),
builder_wallet: clean(row.builder_wallet, 120),
liquidity: safeNum(row.liquidity, 0),
liquidity_usd: safeNum(row.liquidity_usd, 0),
current_liquidity_usd: safeNum(row.current_liquidity_usd, 0),
circulating_supply: safeNum(row.circulating_supply, 0),
market_cap: safeNum(row.market_cap, 0),
price: safeNum(row.price, 0),
volume_24h: safeNum(row.volume_24h, 0),
};
}

function normalizePoolRow(row) {
if (!row) return null;

return {
...row,
mint_address: clean(row.mint_address, 120),
mint_secret: clean(row.mint_secret, 20000),
required_tag:
clean(row.required_tag, 32).toUpperCase() || DEFAULT_REQUIRED_MINT_TAG,
attempts: safeNum(row.mint_reservation_attempts, 0),
status: clean(row.status, 40).toLowerCase(),
reserved_for_launch_id:
row.reserved_for_launch_id == null
? null
: safeNum(row.reserved_for_launch_id, null),
};
}

function getRpcUrl() {
return (
clean(process.env.SOLANA_RPC, 1000) ||
clean(process.env.RPC_URL, 1000) ||
"https://api.devnet.solana.com"
);
}

function getMintDecimals() {
const n = Number(process.env.MSS_TOKEN_DECIMALS || 9);
return Number.isInteger(n) && n >= 0 && n <= 9 ? n : 9;
}

function getMintAuthorityKeypair() {
const raw = clean(process.env.MINT_AUTHORITY_PRIVATE_KEY, 20000);
if (!raw) {
throw new Error("MINT_AUTHORITY_PRIVATE_KEY is not configured");
}

try {
if (raw.startsWith("[")) {
const arr = JSON.parse(raw);
if (!Array.isArray(arr) || !arr.length) {
throw new Error("invalid secret key array");
}
return Keypair.fromSecretKey(Uint8Array.from(arr));
}

return Keypair.fromSecretKey(bs58.decode(raw));
} catch (err) {
throw new Error(`MINT_AUTHORITY_PRIVATE_KEY is invalid: ${err?.message || err}`);
}
}

function isValidSolanaAddress(value) {
try {
new PublicKey(String(value || "").trim());
return true;
} catch {
return false;
}
}

function normalizeMintTag(value) {
return clean(value, 32).toUpperCase() || DEFAULT_REQUIRED_MINT_TAG;
}

function mintContainsRequiredTag(address, requiredTag = DEFAULT_REQUIRED_MINT_TAG) {
const tag = normalizeMintTag(requiredTag);
const mint = clean(address, 120);
return Boolean(tag && mint && mint.endsWith(tag));
}

function encodeSecretKey(secretKey) {
return bs58.encode(secretKey);
}

function decodeSecretKey(raw) {
const value = clean(raw, 20000);
if (!value) {
throw new Error("reserved mint secret is missing");
}

try {
if (value.startsWith("[")) {
const arr = JSON.parse(value);
if (!Array.isArray(arr) || !arr.length) {
throw new Error("invalid reserved mint secret array");
}
return Uint8Array.from(arr);
}

return bs58.decode(value);
} catch (err) {
throw new Error(`reserved mint secret is invalid: ${err?.message || err}`);
}
}

function keypairFromEncodedSecret(raw) {
return Keypair.fromSecretKey(decodeSecretKey(raw));
}

function getReservationPoolTargetSize() {
return Math.max(
1,
Math.floor(safeNum(process.env.MSS_MINT_POOL_TARGET_SIZE, DEFAULT_POOL_TARGET_SIZE))
);
}

function getReservationPoolTopUpBatchSize() {
return Math.max(
1,
Math.floor(safeNum(process.env.MSS_MINT_POOL_TOPUP_BATCH, DEFAULT_POOL_TOPUP_BATCH))
);
}

function getMintSuffixExpression() {
return "substr(mint_address, length(mint_address) - length(?) + 1, length(?)) = ?";
}

function computeSpotPriceSolPerToken(pool) {
const solReserve = safeNum(pool?.sol_reserve, 0);
const tokenReserve = safeNum(pool?.token_reserve, 0);
if (solReserve <= 0 || tokenReserve <= 0) return 0;
return solReserve / tokenReserve;
}

function computeBuilderDailyUnlock(totalSupply) {
return floorToken((safeNum(totalSupply, 0) * BUILDER_DAILY_UNLOCK_PCT) / 100);
}

function computeBuilderTotalAllocation(totalSupply) {
return floorToken((safeNum(totalSupply, 0) * BUILDER_TOTAL_ALLOCATION_PCT) / 100);
}

function computeLiquidityTokenAllocation(totalSupply) {
return floorToken((safeNum(totalSupply, 0) * LIQUIDITY_TOKEN_PCT) / 100);
}

function computeRaydiumReservedTokens(liquidityTokenAllocation) {
return floorToken((safeNum(liquidityTokenAllocation, 0) * RAYDIUM_LIQUIDITY_SPLIT_PCT) / 100);
}

export function prepareReservedMintReservation({
requiredTag = DEFAULT_REQUIRED_MINT_TAG,
maxAttempts = DEFAULT_MINT_RESERVATION_ATTEMPTS,
} = {}) {
const tag = normalizeMintTag(requiredTag);
const attemptsLimit = Math.max(
1,
Math.floor(safeNum(maxAttempts, DEFAULT_MINT_RESERVATION_ATTEMPTS))
);

for (let attempts = 1; attempts <= attemptsLimit; attempts += 1) {
const keypair = Keypair.generate();
const mintAddress = keypair.publicKey.toBase58();

if (mintContainsRequiredTag(mintAddress, tag)) {
return {
ok: true,
requiredTag: tag,
mintAddress,
reservedMintAddress: mintAddress,
reservedMintSecret: encodeSecretKey(keypair.secretKey),
attempts,
status: "reserved",
};
}
}

throw new Error(
`failed to reserve mint ending with ${tag} within ${attemptsLimit} attempts`
);
}

async function getLaunchById(launchId) {
const row = await db.get(`SELECT * FROM launches WHERE id = ?`, [launchId]);
return normalizeLaunch(row);
}

async function getTokenByLaunchId(launchId) {
return db.get(
`SELECT * FROM tokens WHERE launch_id = ? ORDER BY id DESC LIMIT 1`,
[launchId]
);
}

async function getPoolByLaunchId(launchId) {
return db.get(
`SELECT * FROM pools WHERE launch_id = ? ORDER BY id DESC LIMIT 1`,
[launchId]
);
}

async function getAllocationsForLaunch(launchId) {
return db.all(
`
SELECT *
FROM allocations
WHERE launch_id = ?
ORDER BY id ASC
`,
[launchId]
);
}

async function getTrades24hVolumeByLaunch(launchId) {
const row = await db.get(
`
SELECT COALESCE(SUM(sol_amount), 0) AS total
FROM trades
WHERE launch_id = ?
AND datetime(created_at) >= datetime('now', '-24 hours')
`,
[launchId]
);

return safeNum(row?.total, 0);
}

async function getAssignedPoolReservationForLaunch(
launchId,
requiredTag = DEFAULT_REQUIRED_MINT_TAG
) {
const tag = normalizeMintTag(requiredTag);

const row = await db.get(
`
SELECT *
FROM mint_reservations
WHERE required_tag = ?
AND reserved_for_launch_id = ?
AND status IN ('assigned', 'finalized')
AND ${getMintSuffixExpression()}
ORDER BY id DESC
LIMIT 1
`,
[tag, launchId, tag, tag, tag]
);

return normalizePoolRow(row);
}

async function getAvailablePoolReservation(requiredTag = DEFAULT_REQUIRED_MINT_TAG) {
const tag = normalizeMintTag(requiredTag);

const row = await db.get(
`
SELECT *
FROM mint_reservations
WHERE required_tag = ?
AND status = 'available'
AND ${getMintSuffixExpression()}
ORDER BY id ASC
LIMIT 1
`,
[tag, tag, tag, tag]
);

return normalizePoolRow(row);
}

async function countAvailablePoolReservations(requiredTag = DEFAULT_REQUIRED_MINT_TAG) {
const tag = normalizeMintTag(requiredTag);

const row = await db.get(
`
SELECT COUNT(*) AS total
FROM mint_reservations
WHERE required_tag = ?
AND status = 'available'
AND ${getMintSuffixExpression()}
`,
[tag, tag, tag, tag]
);

return safeNum(row?.total, 0);
}

async function insertPoolReservation(reservation) {
await db.run(
`
INSERT INTO mint_reservations (
mint_address,
mint_secret,
required_tag,
mint_reservation_attempts,
status
) VALUES (?, ?, ?, ?, 'available')
`,
[
reservation.reservedMintAddress,
reservation.reservedMintSecret,
reservation.requiredTag,
reservation.attempts,
]
);
}

export async function topUpMintReservationPool({
requiredTag = DEFAULT_REQUIRED_MINT_TAG,
targetSize = getReservationPoolTargetSize(),
batchSize = getReservationPoolTopUpBatchSize(),
maxAttempts = DEFAULT_MINT_RESERVATION_ATTEMPTS,
} = {}) {
await assertMintReservationSchema();

const tag = normalizeMintTag(requiredTag);
const target = Math.max(1, Math.floor(safeNum(targetSize, DEFAULT_POOL_TARGET_SIZE)));
const batch = Math.max(1, Math.floor(safeNum(batchSize, DEFAULT_POOL_TOPUP_BATCH)));

const availableNow = await countAvailablePoolReservations(tag);
if (availableNow >= target) {
return {
ok: true,
requiredTag: tag,
available: availableNow,
created: 0,
target,
};
}

const needed = target - availableNow;
const createCount = Math.min(batch, needed);

let created = 0;

for (let i = 0; i < createCount; i += 1) {
const reservation = prepareReservedMintReservation({
requiredTag: tag,
maxAttempts,
});
await insertPoolReservation(reservation);
created += 1;
}

const availableAfter = await countAvailablePoolReservations(tag);

return {
ok: true,
requiredTag: tag,
available: availableAfter,
created,
target,
};
}

async function updateLaunchReservationFields({
launchId,
reservedMintAddress,
reservedMintSecret,
requiredTag,
attempts,
status = "reserved",
}) {
await db.run(
`
UPDATE launches
SET reserved_mint_address = ?,
reserved_mint_secret = ?,
mint_reservation_status = ?,
mint_required_tag = ?,
mint_reservation_attempts = ?,
mint_reserved_at = CURRENT_TIMESTAMP,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[
reservedMintAddress,
reservedMintSecret,
status,
requiredTag,
attempts,
launchId,
]
);
}

export async function claimReservedMintForLaunch(
launchId,
requiredTag = DEFAULT_REQUIRED_MINT_TAG,
maxAttempts = DEFAULT_MINT_RESERVATION_ATTEMPTS
) {
await assertMintReservationSchema();

const tag = normalizeMintTag(requiredTag);
const existingLaunch = await getLaunchById(launchId);

if (!existingLaunch) {
throw new Error("launch not found");
}

if (
existingLaunch.reserved_mint_address &&
existingLaunch.reserved_mint_secret &&
mintContainsRequiredTag(existingLaunch.reserved_mint_address, tag)
) {
return {
ok: true,
requiredTag: tag,
reservedMintAddress: existingLaunch.reserved_mint_address,
reservedMintSecret: existingLaunch.reserved_mint_secret,
attempts: existingLaunch.mint_reservation_attempts || 0,
status: existingLaunch.mint_reservation_status || "reserved",
source: "launch_row",
};
}

const alreadyAssigned = await getAssignedPoolReservationForLaunch(launchId, tag);
if (alreadyAssigned?.mint_address && alreadyAssigned?.mint_secret) {
await updateLaunchReservationFields({
launchId,
reservedMintAddress: alreadyAssigned.mint_address,
reservedMintSecret: alreadyAssigned.mint_secret,
requiredTag: tag,
attempts: alreadyAssigned.attempts,
status: "reserved",
});

return {
ok: true,
requiredTag: tag,
reservedMintAddress: alreadyAssigned.mint_address,
reservedMintSecret: alreadyAssigned.mint_secret,
attempts: alreadyAssigned.attempts,
status: "reserved",
source: "pool_assigned_existing",
};
}

for (let attempt = 0; attempt < CLAIM_RETRY_LIMIT; attempt += 1) {
let poolReservation = await getAvailablePoolReservation(tag);

if (!poolReservation) {
await topUpMintReservationPool({
requiredTag: tag,
targetSize: 1,
batchSize: 1,
maxAttempts,
});
poolReservation = await getAvailablePoolReservation(tag);
}

if (!poolReservation) {
throw new Error(`no reserved mint available for suffix ${tag}`);
}

const claim = await db.run(
`
UPDATE mint_reservations
SET status = 'assigned',
reserved_for_launch_id = ?,
assigned_at = CURRENT_TIMESTAMP,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
AND status = 'available'
`,
[launchId, poolReservation.id]
);

if (claim?.changes > 0) {
await updateLaunchReservationFields({
launchId,
reservedMintAddress: poolReservation.mint_address,
reservedMintSecret: poolReservation.mint_secret,
requiredTag: tag,
attempts: poolReservation.attempts,
status: "reserved",
});

return {
ok: true,
requiredTag: tag,
reservedMintAddress: poolReservation.mint_address,
reservedMintSecret: poolReservation.mint_secret,
attempts: poolReservation.attempts,
status: "reserved",
source: "pool",
};
}
}

throw new Error(`failed to claim reserved mint for launch ${launchId}`);
}

function getInternalPoolSeed(launch) {
const internalPoolSol = safeNum(
launch?.internal_pool_sol,
safeNum(launch?.launch_result_json?.internalPoolSol, 0)
);

const internalPoolTokens = safeNum(
launch?.internal_pool_tokens,
safeNum(launch?.launch_result_json?.internalPoolTokens, 0)
);

if (internalPoolSol <= 0 || internalPoolTokens <= 0) {
throw new Error("internal pool seed is missing from launch result");
}

return {
internalPoolSol,
internalPoolTokens,
};
}

function getReservedMintKeypairFromLaunch(launch) {
const reservedSecret = clean(launch?.reserved_mint_secret, 20000);
const reservedAddress = clean(launch?.reserved_mint_address, 120);

if (!reservedSecret) {
throw new Error("reserved mint secret is missing on launch");
}

const keypair = keypairFromEncodedSecret(reservedSecret);
const derivedAddress = keypair.publicKey.toBase58();

if (!reservedAddress) {
throw new Error("reserved mint address is missing on launch");
}

if (derivedAddress !== reservedAddress) {
throw new Error("reserved mint secret does not match reserved mint address");
}

return keypair;
}

async function markPoolReservationFinalizedByLaunch(launch) {
const reservedAddress = clean(launch?.reserved_mint_address, 120);
if (!reservedAddress) return;

await db.run(
`
UPDATE mint_reservations
SET status = 'finalized',
finalized_at = CURRENT_TIMESTAMP,
updated_at = CURRENT_TIMESTAMP
WHERE mint_address = ?
AND reserved_for_launch_id = ?
`,
[reservedAddress, launch.id]
);
}

async function updateLaunchMintFields(
launchId,
mintAddress,
reservationStatus = "finalized"
) {
const hasTokenMint = await launchesHasColumn("token_mint");

if (hasTokenMint) {
await db.run(
`
UPDATE launches
SET contract_address = ?,
token_mint = ?,
mint_reservation_status = ?,
mint_finalized_at = COALESCE(mint_finalized_at, CURRENT_TIMESTAMP),
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[mintAddress, mintAddress, reservationStatus, launchId]
);
return;
}

await db.run(
`
UPDATE launches
SET contract_address = ?,
mint_reservation_status = ?,
mint_finalized_at = COALESCE(mint_finalized_at, CURRENT_TIMESTAMP),
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[mintAddress, reservationStatus, launchId]
);
}

async function finalizeLaunchMintFields(launchId, mintAddress) {
const hasTokenMint = await launchesHasColumn("token_mint");

if (hasTokenMint) {
await db.run(
`
UPDATE launches
SET contract_address = ?,
token_mint = ?,
mint_reservation_status = 'finalized',
mint_finalized_at = CURRENT_TIMESTAMP,
reserved_mint_secret = NULL,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[mintAddress, mintAddress, launchId]
);
return;
}

await db.run(
`
UPDATE launches
SET contract_address = ?,
mint_reservation_status = 'finalized',
mint_finalized_at = CURRENT_TIMESTAMP,
reserved_mint_secret = NULL,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[mintAddress, launchId]
);
}

async function ensureMintAddress(launch) {
const existingToken = await getTokenByLaunchId(launch.id);

if (existingToken?.mint_address) {
const existingMint = clean(existingToken.mint_address, 120);

if (
clean(launch.contract_address, 120) !== existingMint ||
clean(launch.token_mint, 120) !== existingMint
) {
await updateLaunchMintFields(launch.id, existingMint, "finalized");
}

return {
created: false,
mintAddress: existingMint,
tokenRow: existingToken,
source: "token_row",
};
}

const reservationStatus = clean(launch.mint_reservation_status, 40).toLowerCase();
const existingLaunchAddress =
clean(launch.token_mint, 120) || clean(launch.contract_address, 120);

if (
reservationStatus === "finalized" &&
existingLaunchAddress &&
isValidSolanaAddress(existingLaunchAddress)
) {
return {
created: false,
mintAddress: existingLaunchAddress,
tokenRow: null,
source: "launch_row_finalized",
};
}

const reservedMintAddress = clean(launch.reserved_mint_address, 120);
const requiredTag = normalizeMintTag(launch.mint_required_tag);

if (!reservedMintAddress) {
throw new Error("reserved mint address is missing");
}

if (!mintContainsRequiredTag(reservedMintAddress, requiredTag)) {
throw new Error(`reserved mint address does not end with required tag ${requiredTag}`);
}

const reservedMintKeypair = getReservedMintKeypairFromLaunch(launch);
const authority = getMintAuthorityKeypair();
const connection = new Connection(getRpcUrl(), "confirmed");
const decimals = getMintDecimals();

const mintPubkey = await createMint(
connection,
authority,
authority.publicKey,
null,
decimals,
reservedMintKeypair
);

const mintAddress = mintPubkey.toBase58();

if (mintAddress !== reservedMintAddress) {
throw new Error("created mint address does not match reserved mint address");
}

await finalizeLaunchMintFields(launch.id, mintAddress);
await markPoolReservationFinalizedByLaunch(launch);

return {
created: true,
mintAddress,
tokenRow: existingToken || null,
source: "reserved_mss_mint",
};
}

async function ensureTokenRow(launchId, launch, mintAddress) {
let token = await getTokenByLaunchId(launchId);
const supply = String(launch.final_supply || launch.supply || "0");

if (token) {
await db.run(
`
UPDATE tokens
SET name = ?,
symbol = ?,
supply = ?,
mint_address = ?
WHERE id = ?
`,
[launch.token_name, launch.symbol, supply, mintAddress, token.id]
);

return getTokenByLaunchId(launchId);
}

const result = await db.run(
`
INSERT INTO tokens (
launch_id,
name,
symbol,
supply,
mint_address
) VALUES (?, ?, ?, ?, ?)
`,
[launchId, launch.token_name, launch.symbol, supply, mintAddress]
);

token = await db.get(`SELECT * FROM tokens WHERE id = ?`, [result.lastID]);
return token;
}

async function getExistingWalletBalance(launchId, wallet) {
return db.get(
`
SELECT id, token_amount
FROM wallet_balances
WHERE launch_id = ? AND wallet = ?
LIMIT 1
`,
[launchId, wallet]
);
}

async function upsertWalletBalance(launchId, wallet, tokenAmount) {
const existing = await getExistingWalletBalance(launchId, wallet);

if (existing) {
await db.run(
`
UPDATE wallet_balances
SET token_amount = ?
WHERE id = ?
`,
[tokenAmount, existing.id]
);
return;
}

await db.run(
`
INSERT INTO wallet_balances (
launch_id,
wallet,
token_amount
) VALUES (?, ?, ?)
`,
[launchId, wallet, tokenAmount]
);
}

async function ensureWalletBalancesFromAllocations(launchId, launch) {
const allocations = await getAllocationsForLaunch(launchId);
const totalSupply = floorToken(launch.final_supply || launch.supply || 0);
const builderWallet = clean(launch.builder_wallet, 120);
const builderTotalAllocation = computeBuilderTotalAllocation(totalSupply);
const builderInitialUnlocked = Math.min(
builderTotalAllocation,
computeBuilderDailyUnlock(totalSupply)
);

const creditable = allocations.filter((row) =>
["participant", "builder", "team"].includes(String(row.allocation_type || ""))
);

for (const row of creditable) {
const wallet = clean(row.wallet, 120);
let tokenAmount = floorToken(row.token_amount);

if (!wallet || tokenAmount <= 0) continue;

if (
String(row.allocation_type || "") === "builder" &&
builderWallet &&
wallet.toLowerCase() === builderWallet.toLowerCase()
) {
tokenAmount = Math.min(tokenAmount, builderInitialUnlocked);
}

await upsertWalletBalance(launchId, wallet, tokenAmount);
}
}

async function ensurePoolRow(launchId, tokenId, launch) {
const existingPool = await getPoolByLaunchId(launchId);
const { internalPoolSol, internalPoolTokens } = getInternalPoolSeed(launch);
const kValue = Number(internalPoolSol) * Number(internalPoolTokens);

if (existingPool) {
await db.run(
`
UPDATE pools
SET token_id = ?,
token_reserve = ?,
sol_reserve = ?,
k_value = ?,
status = 'active',
initial_token_reserve = COALESCE(initial_token_reserve, ?)
WHERE id = ?
`,
[tokenId, internalPoolTokens, internalPoolSol, kValue, internalPoolTokens, existingPool.id]
);

return getPoolByLaunchId(launchId);
}

const result = await db.run(
`
INSERT INTO pools (
launch_id,
token_id,
token_reserve,
sol_reserve,
k_value,
status,
initial_token_reserve
) VALUES (?, ?, ?, ?, ?, 'active', ?)
`,
[launchId, tokenId, internalPoolTokens, internalPoolSol, kValue, internalPoolTokens]
);

return db.get(`SELECT * FROM pools WHERE id = ?`, [result.lastID]);
}

async function ensureBuilderVestingState(launchId, launch) {
const builderWallet = clean(launch.builder_wallet, 120);
if (!builderWallet) return null;

const totalSupply = floorToken(launch.final_supply || launch.supply || 0);
if (totalSupply <= 0) return null;

const totalAllocation = computeBuilderTotalAllocation(totalSupply);
const dailyUnlock = computeBuilderDailyUnlock(totalSupply);
const initialUnlocked = Math.min(totalAllocation, dailyUnlock);
const lockedRemaining = Math.max(0, totalAllocation - initialUnlocked);

if (!(await tableExists("builder_vesting"))) {
return {
launch_id: launchId,
builder_wallet: builderWallet,
total_allocation: totalAllocation,
daily_unlock: dailyUnlock,
unlocked_amount: initialUnlocked,
locked_amount: lockedRemaining,
vesting_start_at: launch.live_at || new Date().toISOString(),
};
}

const existing = await db.get(
`
SELECT *
FROM builder_vesting
WHERE launch_id = ?
LIMIT 1
`,
[launchId]
);

const hasBuilderWallet = await builderVestingHasColumn("builder_wallet");
const hasTotalAllocation = await builderVestingHasColumn("total_allocation");
const hasDailyUnlock = await builderVestingHasColumn("daily_unlock");
const hasUnlockedAmount = await builderVestingHasColumn("unlocked_amount");
const hasLockedAmount = await builderVestingHasColumn("locked_amount");
const hasVestingStartAt = await builderVestingHasColumn("vesting_start_at");
const hasUpdatedAt = await builderVestingHasColumn("updated_at");
const hasCreatedAt = await builderVestingHasColumn("created_at");

if (existing) {
const sets = [];
const values = [];

if (hasBuilderWallet) {
sets.push("builder_wallet = ?");
values.push(builderWallet);
}
if (hasTotalAllocation) {
sets.push("total_allocation = ?");
values.push(totalAllocation);
}
if (hasDailyUnlock) {
sets.push("daily_unlock = ?");
values.push(dailyUnlock);
}
if (hasUnlockedAmount) {
sets.push("unlocked_amount = COALESCE(unlocked_amount, ?)");
values.push(initialUnlocked);
}
if (hasLockedAmount) {
sets.push("locked_amount = COALESCE(locked_amount, ?)");
values.push(lockedRemaining);
}
if (hasVestingStartAt) {
sets.push("vesting_start_at = COALESCE(vesting_start_at, ?)");
values.push(launch.live_at || new Date().toISOString());
}
if (hasUpdatedAt) {
sets.push("updated_at = CURRENT_TIMESTAMP");
}

if (sets.length) {
values.push(launchId);
await db.run(
`
UPDATE builder_vesting
SET ${sets.join(", ")}
WHERE launch_id = ?
`,
values
);
}
} else {
const columns = ["launch_id"];
const placeholders = ["?"];
const values = [launchId];

if (hasBuilderWallet) {
columns.push("builder_wallet");
placeholders.push("?");
values.push(builderWallet);
}
if (hasTotalAllocation) {
columns.push("total_allocation");
placeholders.push("?");
values.push(totalAllocation);
}
if (hasDailyUnlock) {
columns.push("daily_unlock");
placeholders.push("?");
values.push(dailyUnlock);
}
if (hasUnlockedAmount) {
columns.push("unlocked_amount");
placeholders.push("?");
values.push(initialUnlocked);
}
if (hasLockedAmount) {
columns.push("locked_amount");
placeholders.push("?");
values.push(lockedRemaining);
}
if (hasVestingStartAt) {
columns.push("vesting_start_at");
placeholders.push("?");
values.push(launch.live_at || new Date().toISOString());
}
if (hasCreatedAt) {
columns.push("created_at");
placeholders.push("CURRENT_TIMESTAMP");
}
if (hasUpdatedAt) {
columns.push("updated_at");
placeholders.push("CURRENT_TIMESTAMP");
}

await db.run(
`
INSERT INTO builder_vesting (${columns.join(", ")})
VALUES (${placeholders.join(", ")})
`,
values
);
}

return {
launch_id: launchId,
builder_wallet: builderWallet,
total_allocation: totalAllocation,
daily_unlock: dailyUnlock,
unlocked_amount: initialUnlocked,
locked_amount: lockedRemaining,
vesting_start_at: launch.live_at || new Date().toISOString(),
};
}

async function getDistributedCirculatingSupply(launchId, launch) {
const row = await db.get(
`
SELECT COALESCE(SUM(token_amount), 0) AS total
FROM wallet_balances
WHERE launch_id = ?
`,
[launchId]
);

const fromWalletBalances = floorToken(row?.total);

if (fromWalletBalances > 0) {
return fromWalletBalances;
}

const fallbackRow = await db.get(
`
SELECT COALESCE(SUM(token_amount), 0) AS total
FROM allocations
WHERE launch_id = ?
AND allocation_type IN ('participant', 'builder', 'team')
`,
[launchId]
);

return Math.max(
0,
floorToken(fallbackRow?.total),
floorToken(launch.circulating_supply || 0)
);
}

async function updateLaunchMarketFields(launchId, launch, pool) {
const oneSidedSolLiquidity = safeNum(pool.sol_reserve, 0);
const distributedCirculatingSupply = await getDistributedCirculatingSupply(launchId, launch);
const price = computeSpotPriceSolPerToken(pool);
const marketCap = price > 0 && distributedCirculatingSupply > 0
? price * distributedCirculatingSupply
: 0;
const volume24h = await getTrades24hVolumeByLaunch(launchId);

await db.run(
`
UPDATE launches
SET circulating_supply = ?,
liquidity = ?,
price = ?,
market_cap = ?,
volume_24h = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[distributedCirculatingSupply, oneSidedSolLiquidity, price, marketCap, volume24h, launchId]
);
}

async function ensureLaunchLiquidityLifecycle(launchId, launch, pool) {
if (!(await tableExists("launch_liquidity_lifecycle"))) {
return {
launch_id: launchId,
internal_sol_reserve: safeNum(pool.sol_reserve, 0),
internal_token_reserve: floorToken(pool.token_reserve),
graduated: false,
raydium_target_pct: RAYDIUM_LIQUIDITY_SPLIT_PCT,
mss_locked_target_pct: RAYDIUM_LIQUIDITY_SPLIT_PCT,
};
}

const existing = await db.get(
`
SELECT *
FROM launch_liquidity_lifecycle
WHERE launch_id = ?
LIMIT 1
`,
[launchId]
);

const columns = await getTableColumns("launch_liquidity_lifecycle");
const has = (name) => columns.has(name);

const internalSolReserve = safeNum(pool.sol_reserve, 0);
const internalTokenReserve = floorToken(pool.token_reserve);

if (existing) {
const sets = [];
const values = [];

if (has("internal_sol_reserve")) {
sets.push("internal_sol_reserve = ?");
values.push(internalSolReserve);
}
if (has("internal_token_reserve")) {
sets.push("internal_token_reserve = ?");
values.push(internalTokenReserve);
}
if (has("graduated")) {
sets.push("graduated = COALESCE(graduated, 0)");
}
if (has("raydium_target_pct")) {
sets.push("raydium_target_pct = COALESCE(raydium_target_pct, ?)");
values.push(RAYDIUM_LIQUIDITY_SPLIT_PCT);
}
if (has("mss_locked_target_pct")) {
sets.push("mss_locked_target_pct = COALESCE(mss_locked_target_pct, ?)");
values.push(RAYDIUM_LIQUIDITY_SPLIT_PCT);
}
if (has("updated_at")) {
sets.push("updated_at = CURRENT_TIMESTAMP");
}

if (sets.length) {
values.push(launchId);
await db.run(
`
UPDATE launch_liquidity_lifecycle
SET ${sets.join(", ")}
WHERE launch_id = ?
`,
values
);
}
} else {
const insertColumns = ["launch_id"];
const placeholders = ["?"];
const values = [launchId];

if (has("internal_sol_reserve")) {
insertColumns.push("internal_sol_reserve");
placeholders.push("?");
values.push(internalSolReserve);
}
if (has("internal_token_reserve")) {
insertColumns.push("internal_token_reserve");
placeholders.push("?");
values.push(internalTokenReserve);
}
if (has("graduated")) {
insertColumns.push("graduated");
placeholders.push("?");
values.push(0);
}
if (has("raydium_target_pct")) {
insertColumns.push("raydium_target_pct");
placeholders.push("?");
values.push(RAYDIUM_LIQUIDITY_SPLIT_PCT);
}
if (has("mss_locked_target_pct")) {
insertColumns.push("mss_locked_target_pct");
placeholders.push("?");
values.push(RAYDIUM_LIQUIDITY_SPLIT_PCT);
}
if (has("created_at")) {
insertColumns.push("created_at");
placeholders.push("CURRENT_TIMESTAMP");
}
if (has("updated_at")) {
insertColumns.push("updated_at");
placeholders.push("CURRENT_TIMESTAMP");
}

await db.run(
`
INSERT INTO launch_liquidity_lifecycle (${insertColumns.join(", ")})
VALUES (${placeholders.join(", ")})
`,
values
);
}

return {
launch_id: launchId,
internal_sol_reserve: internalSolReserve,
internal_token_reserve: internalTokenReserve,
graduated: false,
raydium_target_pct: RAYDIUM_LIQUIDITY_SPLIT_PCT,
mss_locked_target_pct: RAYDIUM_LIQUIDITY_SPLIT_PCT,
};
}

export async function bootstrapLiveMarket(launchId) {
await assertMintReservationSchema();

let launch = await getLaunchById(launchId);

if (!launch) {
throw new Error("launch not found");
}

const status = String(launch.status || "").toLowerCase();
if (status !== "countdown" && status !== "live") {
throw new Error("launch must be countdown or live before market bootstrap");
}

if (
!clean(launch.reserved_mint_address, 120) ||
!clean(launch.reserved_mint_secret, 20000)
) {
await claimReservedMintForLaunch(
launchId,
launch.mint_required_tag || DEFAULT_REQUIRED_MINT_TAG
);
launch = await getLaunchById(launchId);
}

const launchResult = launch.launch_result_json || {};
const totalSupply = floorToken(launch.final_supply || launch.supply || 0);
const liquidityTokenAllocation = computeLiquidityTokenAllocation(totalSupply);
const builderTotalAllocation = computeBuilderTotalAllocation(totalSupply);
const builderDailyUnlock = computeBuilderDailyUnlock(totalSupply);
const raydiumReservedTokens = computeRaydiumReservedTokens(liquidityTokenAllocation);

const internalPoolSol = safeNum(
launch.internal_pool_sol,
safeNum(launchResult.internalPoolSol, 0)
);
const internalPoolTokens = floorToken(
launch.internal_pool_tokens ||
launchResult.internalPoolTokens ||
0
);

if (internalPoolSol <= 0) {
throw new Error("launch internal pool SOL is missing before bootstrap");
}

if (internalPoolTokens <= 0) {
throw new Error("launch internal pool token allocation is missing before bootstrap");
}

const mintResult = await ensureMintAddress(launch);
launch = await getLaunchById(launchId);

const token = await ensureTokenRow(launchId, launch, mintResult.mintAddress);
await ensureBuilderVestingState(launchId, launch);
await ensureWalletBalancesFromAllocations(launchId, launch);

const pool = await ensurePoolRow(launchId, token.id, launch);
if (!pool) {
throw new Error("pool row missing after bootstrap");
}

if (safeNum(pool.sol_reserve, 0) <= 0 || safeNum(pool.token_reserve, 0) <= 0) {
throw new Error("pool reserves missing after bootstrap");
}

await ensureLaunchLiquidityLifecycle(launchId, launch, pool);
await updateLaunchMarketFields(launchId, launch, pool);

const refreshedLaunch = await getLaunchById(launchId);
if (!refreshedLaunch) {
throw new Error("launch missing after market field update");
}

if (safeNum(refreshedLaunch.liquidity, 0) <= 0) {
throw new Error("launch liquidity not written during bootstrap");
}

if (safeNum(refreshedLaunch.price, 0) <= 0) {
throw new Error("launch implied price not written during bootstrap");
}

if (!clean(refreshedLaunch.contract_address, 120)) {
throw new Error("launch contract address not written during bootstrap");
}

void topUpMintReservationPool({
requiredTag: launch.mint_required_tag || DEFAULT_REQUIRED_MINT_TAG,
}).catch((err) => {
console.error("Mint pool top-up after bootstrap failed:", err);
});

return {
ok: true,
launchId,
mintAddress: mintResult.mintAddress,
mintSource: mintResult.source,
tokenId: token.id,
poolId: pool.id,
poolStatus: pool.status,
tokenReserve: Number(pool.token_reserve || 0),
solReserve: Number(pool.sol_reserve || 0),
liquidity: safeNum(refreshedLaunch?.liquidity, safeNum(pool.sol_reserve, 0)),
circulatingSupply: safeNum(refreshedLaunch?.circulating_supply, 0),
price: safeNum(refreshedLaunch?.price, 0),
marketCap: safeNum(refreshedLaunch?.market_cap, 0),
volume24h: safeNum(refreshedLaunch?.volume_24h, 0),
mintRequiredTag: launch.mint_required_tag || DEFAULT_REQUIRED_MINT_TAG,
internalPoolSol,
internalPoolTokens,
liquidityTokenAllocation,
raydiumReservedTokens,
builderTotalAllocation,
builderDailyUnlock,
};
}
