import "dotenv/config";
import express from "express";
import db from "../db/index.js";
import {
Connection,
Keypair,
PublicKey,
SystemProgram,
Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";

const router = express.Router();

const REFUND_STATUS_PENDING_PROGRAM = "pending_program_refund";
const REFUND_STATUS_PROCESSING = "processing";
const REFUND_STATUS_REFUNDED = "refunded";
const REFUND_STATUS_FAILED = "failed";
const REFUND_FEE_BUFFER_LAMPORTS = 10000;

const tableExistsCache = new Map();
const tableColumnsCache = new Map();

function cleanText(value, max = 5000) {
return String(value ?? "").trim().slice(0, max);
}

function safeNumber(value, fallback = 0) {
const n = Number(value);
return Number.isFinite(n) ? n : fallback;
}

function roundSol(value) {
return Number(safeNumber(value, 0).toFixed(9));
}

function firstPresent(...values) {
for (const value of values) {
if (value === undefined || value === null) continue;
const text = String(value).trim();
if (!text) continue;
return value;
}
return null;
}

function isValidSolanaAddress(value) {
try {
new PublicKey(String(value || "").trim());
return true;
} catch {
return false;
}
}

function getRpcUrl() {
return (
cleanText(process.env.SOLANA_RPC, 500) ||
cleanText(process.env.RPC_URL, 500) ||
"https://api.devnet.solana.com"
);
}

function decodeKeypairRaw(raw, label = "private key") {
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
throw new Error(`${label} is invalid: ${err?.message || err}`);
}
}

function maybeGetKeypairFromEnv(envNames = [], label = "private key") {
for (const envName of envNames) {
const raw = cleanText(process.env[envName], 5000);
if (!raw) continue;
return decodeKeypairRaw(raw, envName || label);
}
return null;
}

function getEscrowWallet() {
const wallet = cleanText(process.env.ESCROW_WALLET, 120);
if (!wallet) {
throw new Error("ESCROW_WALLET is not configured");
}
return wallet;
}

function getEscrowKeypair() {
const keypair = maybeGetKeypairFromEnv(
["LAUNCH_ESCROW_PRIVATE_KEY", "ESCROW_PRIVATE_KEY"],
"launch escrow signer"
);

if (!keypair) {
throw new Error(
"LAUNCH_ESCROW_PRIVATE_KEY or ESCROW_PRIVATE_KEY is not configured"
);
}

return keypair;
}

function getRelayerKeypair(fallback = null) {
return (
maybeGetKeypairFromEnv(
["RELAYER_PRIVATE_KEY", "REFUND_RELAYER_PRIVATE_KEY"],
"relayer signer"
) || fallback
);
}

function solToLamports(solAmount) {
return Math.round(Number(solAmount) * 1_000_000_000);
}

function lamportsToSol(lamports) {
return roundSol(Number(lamports || 0) / 1_000_000_000);
}

async function tableExists(tableName) {
const key = String(tableName || "").trim();
if (!key) return false;

if (tableExistsCache.has(key)) {
return tableExistsCache.get(key);
}

const row = await db.get(
`
SELECT name
FROM sqlite_master
WHERE type = 'table' AND name = ?
LIMIT 1
`,
[key]
);

const exists = Boolean(row?.name);
tableExistsCache.set(key, exists);
return exists;
}

async function getTableColumns(tableName) {
const key = String(tableName || "").trim();
if (!key) return new Set();

if (tableColumnsCache.has(key)) {
return tableColumnsCache.get(key);
}

const rows = await db.all(`PRAGMA table_info(${key})`);
const columns = new Set(rows.map((row) => String(row.name || "").trim()));
tableColumnsCache.set(key, columns);
return columns;
}

async function updateRowSafe(tableName, id, fields = {}) {
const columns = await getTableColumns(tableName);
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
UPDATE ${tableName}
SET ${setParts.join(", ")}
WHERE id = ?
`,
[...values, id]
);
}

async function getLaunchById(launchId) {
return db.get(
`
SELECT *
FROM launches
WHERE id = ?
LIMIT 1
`,
[launchId]
);
}

function resolveLaunchCommitEscrow(launch = null) {
const defaultAddress = getEscrowWallet();

const explicitAddress = cleanText(
firstPresent(
launch?.commit_escrow_address,
launch?.launch_escrow_address,
launch?.escrow_vault_address,
launch?.escrow_address,
launch?.vault_address,
launch?.escrow_wallet
),
120
);

const modelHint = cleanText(
firstPresent(
launch?.commit_escrow_model,
launch?.escrow_model,
launch?.escrow_type,
launch?.funds_model
),
80
).toLowerCase();

let model = "shared_wallet";

if (
modelHint.includes("vault") ||
modelHint.includes("program") ||
modelHint.includes("pda")
) {
model = "launch_vault";
} else if (explicitAddress && explicitAddress !== defaultAddress) {
model = "launch_vault";
}

const address = explicitAddress || defaultAddress;

if (!address || !isValidSolanaAddress(address)) {
throw new Error("launch commit escrow address is invalid");
}

return {
address,
model,
};
}

function normalizeRefundLedgerRow(row = {}) {
const requestedSol = roundSol(
firstPresent(
row.requested_refund_sol,
row.refund_sol,
row.amount_sol,
row.sol_amount,
row.requested_sol
) || 0
);

const requestedLamports = safeNumber(
firstPresent(
row.requested_refund_lamports,
row.refund_lamports,
row.amount_lamports,
row.requested_lamports
),
requestedSol > 0 ? solToLamports(requestedSol) : 0
);

return {
...row,
launchId: safeNumber(firstPresent(row.launch_id, row.launchId), 0),
wallet: cleanText(firstPresent(row.wallet, row.destination_wallet), 120),
status: cleanText(row.status, 80).toLowerCase(),
refundReason: cleanText(
firstPresent(row.refund_reason, row.reason, row.error_reason),
500
),
requestedSol,
requestedLamports,
reference: cleanText(
firstPresent(row.reference, row.memo_reference, row.commit_reference),
200
),
attemptCount: safeNumber(
firstPresent(row.attempt_count, row.attempts, row.retry_count),
0
),
lastError: cleanText(
firstPresent(row.last_error, row.error_message, row.failure_reason),
1000
),
refundTxSignature: cleanText(row.refund_tx_signature, 200),
};
}

async function getRefundLedgerRowById(refundId) {
if (!(await tableExists("launch_refund_ledger"))) return null;

const row = await db.get(
`
SELECT *
FROM launch_refund_ledger
WHERE id = ?
LIMIT 1
`,
[refundId]
);

return row ? normalizeRefundLedgerRow(row) : null;
}

async function getCommitStats(launchId) {
const totalRow = await db.get(
`
SELECT COALESCE(SUM(sol_amount), 0) AS total
FROM commits
WHERE launch_id = ?
`,
[launchId]
);

const participantsRow = await db.get(
`
SELECT COUNT(DISTINCT wallet) AS wallets
FROM commits
WHERE launch_id = ?
`,
[launchId]
);

return {
totalCommitted: Number(totalRow?.total || 0),
participants: Number(participantsRow?.wallets || 0),
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

async function maybeMarkLaunchFailedRefunded(launchId) {
const stats = await getCommitStats(launchId);

if (Number(stats.totalCommitted || 0) > 0) {
return getLaunchById(launchId);
}

await db.run(
`
UPDATE launches
SET status = 'failed_refunded',
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
AND status = 'failed'
`,
[launchId]
);

return getLaunchById(launchId);
}

function getInternalRefundToken() {
return (
cleanText(process.env.ESCROW_REFUND_INTERNAL_TOKEN, 500) ||
cleanText(process.env.MSS_INTERNAL_ROUTE_TOKEN, 500) ||
""
);
}

function getRequestInternalToken(req) {
const authHeader = cleanText(req.headers.authorization, 500);
if (authHeader.toLowerCase().startsWith("bearer ")) {
return cleanText(authHeader.slice(7), 500);
}

return (
cleanText(req.headers["x-internal-token"], 500) ||
cleanText(req.headers["x-refund-token"], 500) ||
cleanText(req.body?.internalToken, 500)
);
}

function authorizeInternalRequest(req) {
const configured = getInternalRefundToken();
if (!configured) return true;
return getRequestInternalToken(req) === configured;
}

function parseSignerMapFromEnv() {
const raw =
cleanText(process.env.LAUNCH_ESCROW_SIGNER_MAP_JSON, 50000) ||
cleanText(process.env.MSS_LAUNCH_ESCROW_SIGNER_MAP_JSON, 50000) ||
cleanText(process.env.ESCROW_SIGNER_MAP_JSON, 50000) ||
"";

if (!raw) return {};

try {
const parsed = JSON.parse(raw);
return parsed && typeof parsed === "object" ? parsed : {};
} catch {
throw new Error("LAUNCH_ESCROW_SIGNER_MAP_JSON is invalid JSON");
}
}

function resolveEscrowSignerForAddress(address) {
const targetAddress = cleanText(address, 120);
if (!targetAddress) return null;

const signerMap = parseSignerMapFromEnv();
const mappedRaw =
signerMap[targetAddress] ||
signerMap[targetAddress.toLowerCase()] ||
signerMap[targetAddress.toUpperCase()] ||
null;

if (mappedRaw) {
const mappedSigner = decodeKeypairRaw(
cleanText(mappedRaw, 5000),
`signer map entry for ${targetAddress}`
);

if (mappedSigner.publicKey.toBase58() === targetAddress) {
return mappedSigner;
}

throw new Error(
`configured signer map key does not match escrow address ${targetAddress}`
);
}

const directCandidates = [
maybeGetKeypairFromEnv(["PROGRAM_ESCROW_PRIVATE_KEY"], "PROGRAM_ESCROW_PRIVATE_KEY"),
maybeGetKeypairFromEnv(["MSS_LAUNCH_ESCROW_PRIVATE_KEY"], "MSS_LAUNCH_ESCROW_PRIVATE_KEY"),
maybeGetKeypairFromEnv(["LAUNCH_ESCROW_PRIVATE_KEY"], "LAUNCH_ESCROW_PRIVATE_KEY"),
maybeGetKeypairFromEnv(["ESCROW_PRIVATE_KEY"], "ESCROW_PRIVATE_KEY"),
].filter(Boolean);

for (const keypair of directCandidates) {
if (keypair.publicKey.toBase58() === targetAddress) {
return keypair;
}
}

try {
const sharedEscrowWallet = getEscrowWallet();
if (sharedEscrowWallet === targetAddress) {
const sharedEscrowKeypair = getEscrowKeypair();
if (sharedEscrowKeypair.publicKey.toBase58() === targetAddress) {
return sharedEscrowKeypair;
}
}
} catch {
// ignore and fall through
}

return null;
}

async function executeVaultRefundTransfer({
launch = null,
destinationWallet,
requestedLamports,
requestedSol,
}) {
const destination = cleanText(destinationWallet, 120);
if (!isValidSolanaAddress(destination)) {
throw new Error("refund destination wallet is invalid");
}

const launchEscrow = resolveLaunchCommitEscrow(launch);
const sourceKeypair = resolveEscrowSignerForAddress(launchEscrow.address);

if (!sourceKeypair) {
throw new Error(
`no signer is configured for escrow address ${launchEscrow.address}. set LAUNCH_ESCROW_SIGNER_MAP_JSON or a matching escrow private key env`
);
}

const lamports = safeNumber(
requestedLamports,
requestedSol > 0 ? solToLamports(requestedSol) : 0
);

if (!Number.isFinite(lamports) || lamports <= 0) {
throw new Error("invalid refund lamports");
}

const rpcUrl = getRpcUrl();
const connection = new Connection(rpcUrl, "confirmed");
const relayerKeypair = getRelayerKeypair(sourceKeypair);
const destinationPubkey = new PublicKey(destination);

const { blockhash, lastValidBlockHeight } =
await connection.getLatestBlockhash("confirmed");

const sourceBalance = await connection.getBalance(
sourceKeypair.publicKey,
"confirmed"
);

if (sourceBalance < lamports + REFUND_FEE_BUFFER_LAMPORTS) {
throw new Error(
`escrow vault lacks fee reserve for full refund: balance=${sourceBalance}, refund=${lamports}`
);
}

const tx = new Transaction({
feePayer: relayerKeypair.publicKey,
recentBlockhash: blockhash,
}).add(
SystemProgram.transfer({
fromPubkey: sourceKeypair.publicKey,
toPubkey: destinationPubkey,
lamports,
})
);

const signers =
relayerKeypair.publicKey.toBase58() === sourceKeypair.publicKey.toBase58()
? [sourceKeypair]
: [relayerKeypair, sourceKeypair];

const signature = await connection.sendTransaction(tx, signers, {
skipPreflight: false,
preflightCommitment: "confirmed",
});

const confirmation = await connection.confirmTransaction(
{
signature,
blockhash,
lastValidBlockHeight,
},
"confirmed"
);

if (confirmation?.value?.err) {
throw new Error("refund transfer confirmation failed");
}

return {
ok: true,
signature,
refundedLamports: lamports,
refundedSol: lamportsToSol(lamports),
feePayer: relayerKeypair.publicKey.toBase58(),
relayerWallet: relayerKeypair.publicKey.toBase58(),
sourceWallet: sourceKeypair.publicKey.toBase58(),
escrowAddress: launchEscrow.address,
executionModel:
launchEscrow.model === "launch_vault" ? "vault_signer" : "shared_wallet",
};
}

async function settleRefundState({
refundRow = null,
launchId,
wallet,
execution = null,
}) {
if (refundRow?.id) {
await updateRowSafe("launch_refund_ledger", refundRow.id, {
status: REFUND_STATUS_REFUNDED,
refund_tx_signature: cleanText(
firstPresent(
execution?.signature,
execution?.refundTxSignature
),
200
) || null,
refunded_at: new Date().toISOString(),
refunded_sol: roundSol(
firstPresent(
execution?.refundedSol,
refundRow.requestedSol,
0
) || 0
),
refunded_lamports: safeNumber(
firstPresent(
execution?.refundedLamports,
refundRow.requestedLamports
),
0
),
relayer_wallet: cleanText(
firstPresent(
execution?.relayerWallet,
execution?.feePayer
),
120
) || null,
fee_payer_wallet: cleanText(
firstPresent(
execution?.feePayer,
execution?.relayerWallet
),
120
) || null,
source_wallet: cleanText(
firstPresent(
execution?.sourceWallet,
execution?.escrowAddress
),
120
) || null,
escrow_address: cleanText(
firstPresent(
execution?.escrowAddress
),
120
) || null,
last_error: null,
error_message: null,
failure_reason: null,
processing_started_at: null,
next_retry_at: null,
});
}

await db.run(
`
DELETE FROM commits
WHERE launch_id = ? AND wallet = ?
`,
[launchId, cleanText(wallet, 120)]
);

const stats = await syncLaunchStats(launchId);
const launch = await getLaunchById(launchId);

if (launch?.status === "failed" && Number(stats.totalCommitted || 0) <= 0) {
await maybeMarkLaunchFailedRefunded(launchId);
}

return {
stats,
launch: await getLaunchById(launchId),
};
}

async function markRefundFailure(refundRow, err) {
if (!refundRow?.id) return;

await updateRowSafe("launch_refund_ledger", refundRow.id, {
status: REFUND_STATUS_FAILED,
last_error: cleanText(err?.message || err || "refund execution failed", 1000),
error_message: cleanText(err?.message || err || "refund execution failed", 1000),
failure_reason: cleanText(err?.message || err || "refund execution failed", 1000),
processing_started_at: null,
});
}

async function handleProgramRefund(req, res) {
let refundRow = null;

try {
if (!authorizeInternalRequest(req)) {
return res.status(401).json({
ok: false,
error: "unauthorized internal refund request",
});
}

const refundLedgerId = Number(
firstPresent(req.body.refundLedgerId, req.body.refund_ledger_id, 0)
);
const launchId = Number(firstPresent(req.body.launchId, req.body.launch_id, 0));
const wallet = cleanText(req.body.wallet, 120);
const requestedLamports = safeNumber(
firstPresent(req.body.requestedLamports, req.body.requested_lamports),
0
);
const requestedSol = roundSol(
firstPresent(req.body.requestedSol, req.body.requested_sol, 0) || 0
);

if (!launchId || !wallet) {
return res.status(400).json({
ok: false,
error: "launchId and wallet are required",
});
}

if (requestedLamports <= 0 && requestedSol <= 0) {
return res.status(400).json({
ok: false,
error: "requested refund amount is required",
});
}

const launch = await getLaunchById(launchId);
if (!launch) {
return res.status(404).json({
ok: false,
error: "launch not found",
});
}

const launchEscrow = resolveLaunchCommitEscrow(launch);

if (refundLedgerId > 0) {
refundRow = await getRefundLedgerRowById(refundLedgerId);

if (!refundRow) {
return res.status(404).json({
ok: false,
error: "refund ledger row not found",
});
}

if (refundRow.launchId !== launchId) {
return res.status(409).json({
ok: false,
error: "refund ledger row launch mismatch",
});
}

if (refundRow.wallet.toLowerCase() !== wallet.toLowerCase()) {
return res.status(409).json({
ok: false,
error: "refund ledger row wallet mismatch",
});
}

if (refundRow.status === REFUND_STATUS_REFUNDED) {
return res.json({
ok: true,
alreadyRefunded: true,
refundLedgerId: refundRow.id,
launchId,
wallet,
signature: refundRow.refundTxSignature || null,
refundTxSignature: refundRow.refundTxSignature || null,
refundedSol: refundRow.requestedSol || requestedSol,
refundedLamports: refundRow.requestedLamports || requestedLamports,
escrowAddress: launchEscrow.address,
executionModel:
launchEscrow.model === "launch_vault" ? "vault_signer" : "shared_wallet",
});
}

if (
refundRow.status !== REFUND_STATUS_PENDING_PROGRAM &&
refundRow.status !== REFUND_STATUS_PROCESSING
) {
return res.status(409).json({
ok: false,
error: `refund ledger row is not executable from this route: ${refundRow.status || "unknown"}`,
});
}
}

const execution = await executeVaultRefundTransfer({
launch,
destinationWallet: wallet,
requestedLamports:
requestedLamports > 0
? requestedLamports
: refundRow?.requestedLamports || 0,
requestedSol:
requestedSol > 0
? requestedSol
: refundRow?.requestedSol || 0,
});

const settledState = await settleRefundState({
refundRow,
launchId,
wallet,
execution,
});

return res.json({
ok: true,
refundLedgerId: refundRow?.id || refundLedgerId || null,
launchId,
wallet,
signature: execution.signature,
refundTxSignature: execution.signature,
refundedLamports: execution.refundedLamports,
refundedSol: execution.refundedSol,
feePayer: execution.feePayer,
relayerWallet: execution.relayerWallet,
sourceWallet: execution.sourceWallet,
escrowAddress: execution.escrowAddress,
executionModel: execution.executionModel,
launchStatus: cleanText(settledState.launch?.status, 80) || null,
totalCommitted: safeNumber(settledState.stats?.totalCommitted, 0),
participants: safeNumber(settledState.stats?.participants, 0),
});
} catch (err) {
await markRefundFailure(refundRow, err);

console.error("POST /api/escrow-refunds/program-refund failed:", err);
return res.status(500).json({
ok: false,
error: err?.message || "program refund execution failed",
refundLedgerId: refundRow?.id || null,
});
}
}

router.get("/health", async (_req, res) => {
try {
const hasRefundLedger = await tableExists("launch_refund_ledger");
const signerMap = parseSignerMapFromEnv();
const signerMapSize = Object.keys(signerMap).length;

return res.json({
ok: true,
hasRefundLedger,
internalTokenRequired: Boolean(getInternalRefundToken()),
signerMapEntries: signerMapSize,
sharedEscrowConfigured: Boolean(cleanText(process.env.ESCROW_WALLET, 120)),
launchEscrowKeyConfigured: Boolean(
cleanText(process.env.LAUNCH_ESCROW_PRIVATE_KEY, 5000) ||
cleanText(process.env.ESCROW_PRIVATE_KEY, 5000)
),
});
} catch (err) {
return res.status(500).json({
ok: false,
error: err?.message || "failed to inspect escrow refund health",
});
}
});

router.post("/program-refund", handleProgramRefund);
router.post("/execute", handleProgramRefund);

export default router;
