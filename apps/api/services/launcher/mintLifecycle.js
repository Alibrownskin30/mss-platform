import "dotenv/config";
import db from "../../db/index.js";
import { Connection, Keypair } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import bs58 from "bs58";

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

async function ensureMintAddress(launch) {
const existingToken = await getTokenByLaunchId(launch.id);

if (existingToken?.mint_address) {
if (clean(launch.contract_address, 120) !== clean(existingToken.mint_address, 120)) {
await db.run(
`
UPDATE launches
SET contract_address = ?,
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

// Core rule:
// Do not trust launch.contract_address as the source of truth unless a token row
// already exists with that mint. This forces MSS to generate the final mint at
// launch finalization rather than relying on placeholder/internal values.
const authority = getMintAuthorityKeypair();
const connection = new Connection(getRpcUrl(), "confirmed");
const decimals = getMintDecimals();

const mintPubkey = await createMint(
connection,
authority,
authority.publicKey,
null,
decimals
);

const mintAddress = mintPubkey.toBase58();

await db.run(
`
UPDATE launches
SET contract_address = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[mintAddress, launch.id]
);

return {
created: true,
mintAddress,
tokenRow: existingToken || null,
source: "mss_generated",
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
};
}
