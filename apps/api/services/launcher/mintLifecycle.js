import "dotenv/config";
import db from "../../db/index.js";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import bs58 from "bs58";

const DEFAULT_REQUIRED_MINT_TAG = "MSS";
const DEFAULT_MINT_RESERVATION_ATTEMPTS = 25000;

function safeNum(value, fallback = 0) {
const n = Number(value);
return Number.isFinite(n) ? n : fallback;
}

function floorToken(value) {
return Math.floor(safeNum(value, 0));
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
mint_required_tag: clean(row.mint_required_tag, 32).toUpperCase() || DEFAULT_REQUIRED_MINT_TAG,
mint_reservation_attempts: safeNum(row.mint_reservation_attempts, 0),
contract_address: clean(row.contract_address, 120),
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
const mint = clean(address, 120).toUpperCase();
return Boolean(tag && mint && mint.includes(tag));
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

export function prepareReservedMintReservation({
requiredTag = DEFAULT_REQUIRED_MINT_TAG,
maxAttempts = DEFAULT_MINT_RESERVATION_ATTEMPTS,
} = {}) {
const tag = normalizeMintTag(requiredTag);
const attemptsLimit = Math.max(1, Math.floor(safeNum(maxAttempts, DEFAULT_MINT_RESERVATION_ATTEMPTS)));

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
`failed to reserve mint containing ${tag} within ${attemptsLimit} attempts`
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

async function ensureMintAddress(launch) {
const existingToken = await getTokenByLaunchId(launch.id);

if (existingToken?.mint_address) {
if (clean(launch.contract_address, 120) !== clean(existingToken.mint_address, 120)) {
await db.run(
`
UPDATE launches
SET contract_address = ?,
mint_reservation_status = COALESCE(NULLIF(mint_reservation_status, ''), 'finalized'),
mint_finalized_at = COALESCE(mint_finalized_at, CURRENT_TIMESTAMP),
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[existingToken.mint_address, launch.id]
);
}

return {
created: false,
mintAddress: existingToken.mint_address,
tokenRow: existingToken,
source: "token_row",
};
}

const reservationStatus = clean(launch.mint_reservation_status, 40).toLowerCase();
const existingLaunchAddress = clean(launch.contract_address, 120);

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
throw new Error(`reserved mint address does not contain required tag ${requiredTag}`);
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
[mintAddress, launch.id]
);

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
[
launch.token_name,
launch.symbol,
supply,
mintAddress,
token.id,
]
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
[
launchId,
launch.token_name,
launch.symbol,
supply,
mintAddress,
]
);

token = await db.get(`SELECT * FROM tokens WHERE id = ?`, [result.lastID]);
return token;
}

async function ensureWalletBalancesFromAllocations(launchId) {
const allocations = await getAllocationsForLaunch(launchId);

const creditable = allocations.filter((row) =>
["participant", "builder", "team"].includes(String(row.allocation_type || ""))
);

for (const row of creditable) {
const wallet = String(row.wallet || "").trim();
const tokenAmount = floorToken(row.token_amount);

if (!wallet || tokenAmount <= 0) continue;

const existing = await db.get(
`
SELECT id, token_amount
FROM wallet_balances
WHERE launch_id = ? AND wallet = ?
LIMIT 1
`,
[launchId, wallet]
);

if (existing) {
await db.run(
`
UPDATE wallet_balances
SET token_amount = ?
WHERE id = ?
`,
[tokenAmount, existing.id]
);
continue;
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
status = 'active'
WHERE id = ?
`,
[
tokenId,
internalPoolTokens,
internalPoolSol,
kValue,
existingPool.id,
]
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
[
launchId,
tokenId,
internalPoolTokens,
internalPoolSol,
kValue,
internalPoolTokens,
]
);

return db.get(`SELECT * FROM pools WHERE id = ?`, [result.lastID]);
}

async function getDistributedCirculatingSupply(launchId) {
const row = await db.get(
`
SELECT COALESCE(SUM(token_amount), 0) AS total
FROM allocations
WHERE launch_id = ?
AND allocation_type IN ('participant', 'builder', 'team')
`,
[launchId]
);

return floorToken(row?.total);
}

async function updateLaunchMarketFields(launchId, launch, pool) {
const oneSidedSolLiquidity = safeNum(pool.sol_reserve, 0);
const distributedCirculatingSupply = await getDistributedCirculatingSupply(launchId);
const fallbackSupply = floorToken(launch.final_supply || launch.supply || 0);

const circulatingSupply =
distributedCirculatingSupply > 0 ? distributedCirculatingSupply : fallbackSupply;

await db.run(
`
UPDATE launches
SET circulating_supply = ?,
liquidity = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[circulatingSupply, oneSidedSolLiquidity, launchId]
);
}

export async function bootstrapLiveMarket(launchId) {
let launch = await getLaunchById(launchId);

if (!launch) {
throw new Error("launch not found");
}

if (String(launch.status || "") !== "live") {
throw new Error("launch must be live before market bootstrap");
}

const mintResult = await ensureMintAddress(launch);
launch = await getLaunchById(launchId);

const token = await ensureTokenRow(launchId, launch, mintResult.mintAddress);
await ensureWalletBalancesFromAllocations(launchId);

const pool = await ensurePoolRow(launchId, token.id, launch);
await updateLaunchMarketFields(launchId, launch, pool);

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
mintRequiredTag: launch.mint_required_tag || DEFAULT_REQUIRED_MINT_TAG,
};
}
