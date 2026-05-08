import "dotenv/config";
import db from "../../db/index.js";
import {
Connection,
Keypair,
PublicKey,
SystemProgram,
Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";

const REFUND_STATUS_PENDING_PROGRAM = "pending_program_refund";
const REFUND_STATUS_PENDING_SHARED = "pending_shared_refund";
const REFUND_STATUS_PENDING_SHARED_LEGACY = "pending_shared_wallet_refund";
const REFUND_STATUS_PROCESSING = "processing";
const REFUND_STATUS_REFUNDED = "refunded";
const REFUND_STATUS_FAILED = "failed";
const REFUND_STATUS_CANCELLED = "cancelled";

const DEFAULT_EXECUTOR_BATCH_SIZE = 10;
const DEFAULT_EXECUTOR_INTERVAL_MS = 12000;
const DEFAULT_RETRY_DELAY_MS = 15000;
const MAX_REFUND_ATTEMPTS = 25;
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

function normalizePendingStatus(status) {
const raw = cleanText(status, 120).toLowerCase();

if (raw === REFUND_STATUS_PENDING_SHARED_LEGACY) {
return REFUND_STATUS_PENDING_SHARED;
}

return raw;
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

function isRetryableRefundError(err) {
const msg = String(err?.message || err || "").toLowerCase();

return (
msg.includes("429") ||
msg.includes("too many requests") ||
msg.includes("timeout") ||
msg.includes("timed out") ||
msg.includes("fetch failed") ||
msg.includes("socket") ||
msg.includes("econnreset") ||
msg.includes("connection reset") ||
msg.includes("temporarily unavailable") ||
msg.includes("blockhash not found") ||
msg.includes("block height exceeded") ||
msg.includes("node is behind") ||
msg.includes("already in use") ||
msg.includes("locked")
);
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
const rawStatus = cleanText(row.status, 80).toLowerCase();
const status = normalizePendingStatus(rawStatus);

const requestedSol = roundSol(
firstPresent(
row.requested_refund_sol,
row.refund_sol,
row.amount_sol,
row.sol_amount,
row.requested_sol,
0
)
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
statusRaw: rawStatus,
status,
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
firstPresent(row.attempt_count, row.attempts, row.retry_count, row.refund_attempts),
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

async function listPendingRefundLedgerRows(limit = DEFAULT_EXECUTOR_BATCH_SIZE) {
if (!(await tableExists("launch_refund_ledger"))) {
return [];
}

const columns = await getTableColumns("launch_refund_ledger");
const hasNextRetryAt = columns.has("next_retry_at");

const rows = await db.all(
`
SELECT *
FROM launch_refund_ledger
WHERE LOWER(status) IN (?, ?, ?)
${
hasNextRetryAt
? "AND (next_retry_at IS NULL OR datetime(next_retry_at) <= datetime('now'))"
: ""
}
ORDER BY
CASE
WHEN LOWER(status) = ? THEN 0
ELSE 1
END,
id ASC
LIMIT ?
`,
[
REFUND_STATUS_PENDING_PROGRAM,
REFUND_STATUS_PENDING_SHARED,
REFUND_STATUS_PENDING_SHARED_LEGACY,
REFUND_STATUS_PENDING_PROGRAM,
Math.max(1, Number(limit || DEFAULT_EXECUTOR_BATCH_SIZE)),
]
);

return rows.map(normalizeRefundLedgerRow);
}

async function claimRefundLedgerRow(refundId, expectedRawStatuses = []) {
if (!(await tableExists("launch_refund_ledger"))) {
throw new Error("launch_refund_ledger table not found");
}

const normalizedExpected = Array.isArray(expectedRawStatuses)
? expectedRawStatuses.map((status) => cleanText(status, 120).toLowerCase()).filter(Boolean)
: [];

if (!normalizedExpected.length) {
return null;
}

const columns = await getTableColumns("launch_refund_ledger");
const setClauses = ["status = ?"];
const params = [REFUND_STATUS_PROCESSING];

if (columns.has("processing_started_at")) {
setClauses.push("processing_started_at = CURRENT_TIMESTAMP");
}
if (columns.has("last_attempt_at")) {
setClauses.push("last_attempt_at = CURRENT_TIMESTAMP");
}
if (columns.has("next_retry_at")) {
setClauses.push("next_retry_at = NULL");
}
if (columns.has("attempt_count")) {
setClauses.push("attempt_count = COALESCE(attempt_count, 0) + 1");
} else if (columns.has("refund_attempts")) {
setClauses.push("refund_attempts = COALESCE(refund_attempts, 0) + 1");
}
if (columns.has("updated_at")) {
setClauses.push("updated_at = CURRENT_TIMESTAMP");
}

const placeholders = normalizedExpected.map(() => "?").join(", ");

const result = await db.run(
`
UPDATE launch_refund_ledger
SET ${setClauses.join(", ")}
WHERE id = ?
AND LOWER(status) IN (${placeholders})
`,
[...params, refundId, ...normalizedExpected]
);

if (Number(result?.changes || 0) < 1) {
return null;
}

return getRefundLedgerRowById(refundId);
}

async function markRefundLedgerSettled(refundId, result = {}) {
const payload = {
status: REFUND_STATUS_REFUNDED,
refund_tx_signature:
cleanText(firstPresent(result.signature, result.refundTxSignature), 200) ||
null,
refunded_at: new Date().toISOString(),
refunded_sol: roundSol(
firstPresent(result.refundedSol, result.requestedSol, 0) || 0
),
refunded_lamports: safeNumber(
firstPresent(result.refundedLamports, result.requestedLamports),
0
),
last_error: null,
error_message: null,
failure_reason: null,
processing_started_at: null,
next_retry_at: null,
fee_payer_wallet:
cleanText(firstPresent(result.feePayer, result.fee_payer_wallet), 120) ||
null,
relayer_wallet:
cleanText(
firstPresent(result.relayerWallet, result.feePayer, result.relayer_wallet),
120
) || null,
source_wallet:
cleanText(firstPresent(result.sourceWallet, result.source_wallet), 120) ||
null,
escrow_address:
cleanText(firstPresent(result.escrowAddress, result.escrow_address), 120) ||
null,
};

await updateRowSafe("launch_refund_ledger", refundId, payload);
return getRefundLedgerRowById(refundId);
}

async function markRefundLedgerFailed(
refundRow,
err,
{
retryable = false,
retryStatus = REFUND_STATUS_PENDING_PROGRAM,
} = {}
) {
const refundId = refundRow?.id;
if (!refundId) return null;

const nextStatus =
retryable && refundRow.attemptCount < MAX_REFUND_ATTEMPTS
? normalizePendingStatus(retryStatus)
: REFUND_STATUS_FAILED;

const retryAt =
nextStatus === REFUND_STATUS_FAILED
? null
: new Date(Date.now() + DEFAULT_RETRY_DELAY_MS).toISOString();

const payload = {
status: nextStatus,
last_error: cleanText(err?.message || err || "refund failed", 1000),
error_message: cleanText(err?.message || err || "refund failed", 1000),
failure_reason: cleanText(err?.message || err || "refund failed", 1000),
next_retry_at: retryAt,
processing_started_at: null,
failed_at: nextStatus === REFUND_STATUS_FAILED ? new Date().toISOString() : null,
};

await updateRowSafe("launch_refund_ledger", refundId, payload);
return getRefundLedgerRowById(refundId);
}

async function markRefundLedgerCancelled(refundId, reason = "") {
await updateRowSafe("launch_refund_ledger", refundId, {
status: REFUND_STATUS_CANCELLED,
last_error: cleanText(reason || "refund no longer required", 1000),
error_message: cleanText(reason || "refund no longer required", 1000),
failure_reason: cleanText(reason || "refund no longer required", 1000),
next_retry_at: null,
processing_started_at: null,
});

return getRefundLedgerRowById(refundId);
}

async function getWalletCommitTotalSol(launchId, wallet) {
const row = await db.get(
`
SELECT COALESCE(SUM(sol_amount), 0) AS total
FROM commits
WHERE launch_id = ? AND wallet = ?
`,
[launchId, wallet]
);

return roundSol(row?.total || 0);
}

async function deleteWalletCommitRows(launchId, wallet) {
await db.run(
`
DELETE FROM commits
WHERE launch_id = ? AND wallet = ?
`,
[launchId, wallet]
);
}

async function syncLaunchCommitStats(launchId) {
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

const totalCommitted = roundSol(totalRow?.total || 0);
const participants = safeNumber(participantsRow?.wallets, 0);

await db.run(
`
UPDATE launches
SET committed_sol = ?,
participants_count = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[totalCommitted, participants, launchId]
);

return {
totalCommitted,
participants,
};
}

async function maybeMarkLaunchFailedRefunded(launchId) {
const launch = await getLaunchById(launchId);
if (!launch) return null;

const totalRow = await db.get(
`
SELECT COALESCE(SUM(sol_amount), 0) AS total
FROM commits
WHERE launch_id = ?
`,
[launchId]
);

const remainingCommitted = roundSol(totalRow?.total || 0);

if (
cleanText(launch.status, 80).toLowerCase() === "failed" &&
remainingCommitted <= 0
) {
await db.run(
`
UPDATE launches
SET status = 'failed_refunded',
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launchId]
);
}

return getLaunchById(launchId);
}

async function reconcileRefundedWalletState(refundRow) {
if (!refundRow?.launchId || !refundRow?.wallet) return null;

const remainingBeforeDelete = await getWalletCommitTotalSol(
refundRow.launchId,
refundRow.wallet
);

if (remainingBeforeDelete <= 0) {
const stats = await syncLaunchCommitStats(refundRow.launchId);
const launch = await maybeMarkLaunchFailedRefunded(refundRow.launchId);

return {
skipped: true,
reason: "no remaining wallet commits to delete after refund settlement",
deletedCommitSol: 0,
stats,
launch,
};
}

await deleteWalletCommitRows(refundRow.launchId, refundRow.wallet);
const stats = await syncLaunchCommitStats(refundRow.launchId);
const launch = await maybeMarkLaunchFailedRefunded(refundRow.launchId);

return {
skipped: false,
deletedCommitSol: remainingBeforeDelete,
stats,
launch,
};
}

async function sendSharedWalletRefundTransfer({
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
if (launchEscrow.model === "launch_vault") {
throw new Error(
"launch uses a program-controlled escrow vault and cannot be refunded by shared-wallet transfer"
);
}

const rpcUrl = getRpcUrl();
const connection = new Connection(rpcUrl, "confirmed");
const escrowKeypair = getEscrowKeypair();
const relayerKeypair = getRelayerKeypair(escrowKeypair);

const configuredSourceWallet = escrowKeypair.publicKey.toBase58();
if (configuredSourceWallet !== launchEscrow.address) {
throw new Error(
"configured shared escrow signer does not match the launch commit escrow destination"
);
}

const lamports = safeNumber(
requestedLamports,
requestedSol > 0 ? solToLamports(requestedSol) : 0
);

if (!Number.isFinite(lamports) || lamports <= 0) {
throw new Error("invalid refund lamports");
}

const destinationPubkey = new PublicKey(destination);
const { blockhash, lastValidBlockHeight } =
await connection.getLatestBlockhash("confirmed");

const escrowBalance = await connection.getBalance(
escrowKeypair.publicKey,
"confirmed"
);

if (escrowBalance < lamports + REFUND_FEE_BUFFER_LAMPORTS) {
throw new Error(
`escrow wallet lacks fee reserve for full refund: balance=${escrowBalance}, refund=${lamports}`
);
}

const tx = new Transaction({
feePayer: relayerKeypair.publicKey,
recentBlockhash: blockhash,
}).add(
SystemProgram.transfer({
fromPubkey: escrowKeypair.publicKey,
toPubkey: destinationPubkey,
lamports,
})
);

const signers =
relayerKeypair.publicKey.toBase58() === escrowKeypair.publicKey.toBase58()
? [escrowKeypair]
: [relayerKeypair, escrowKeypair];

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
sourceWallet: escrowKeypair.publicKey.toBase58(),
escrowAddress: launchEscrow.address,
executionModel: "shared_wallet",
};
}

function getProgramRefundAdapterUrl() {
return (
cleanText(process.env.MSS_LAUNCH_ESCROW_PROGRAM_REFUND_URL, 1000) ||
cleanText(process.env.LAUNCH_ESCROW_PROGRAM_REFUND_URL, 1000) ||
cleanText(process.env.MSS_ESCROW_PROGRAM_REFUND_URL, 1000) ||
""
);
}

async function executeProgramRefundAdapter({
refundRow,
launch,
requestedLamports,
requestedSol,
}) {
const adapterUrl = getProgramRefundAdapterUrl();
if (!adapterUrl) {
throw new Error(
"program refund adapter is not configured. set MSS_LAUNCH_ESCROW_PROGRAM_REFUND_URL before processing pending_program_refund rows"
);
}

if (typeof fetch !== "function") {
throw new Error("native fetch is not available for program refund execution");
}

const launchEscrow = resolveLaunchCommitEscrow(launch);
const relayer = getRelayerKeypair(null);

const payload = {
refundLedgerId: refundRow.id,
launchId: refundRow.launchId,
wallet: refundRow.wallet,
reference: refundRow.reference || `mss-launch-${refundRow.launchId}`,
requestedLamports,
requestedSol,
escrowAddress: launchEscrow.address,
escrowModel: launchEscrow.model,
relayerWallet: relayer ? relayer.publicKey.toBase58() : null,
reason: refundRow.refundReason || "",
};

let response;
try {
response = await fetch(adapterUrl, {
method: "POST",
headers: {
"content-type": "application/json",
accept: "application/json",
},
body: JSON.stringify(payload),
});
} catch (err) {
throw new Error(`program refund adapter request failed: ${err?.message || err}`);
}

let body = null;
try {
body = await response.json();
} catch {
body = null;
}

if (!response.ok || !body?.ok) {
throw new Error(
body?.error ||
`program refund adapter returned ${response.status || "unknown status"}`
);
}

const signature = cleanText(
firstPresent(body.signature, body.refundTxSignature, body.txSignature),
200
);

if (!signature) {
throw new Error("program refund adapter response missing signature");
}

return {
ok: true,
signature,
refundedLamports: safeNumber(
firstPresent(body.refundedLamports, body.lamports),
requestedLamports
),
refundedSol: roundSol(
firstPresent(body.refundedSol, body.solAmount, requestedSol) || requestedSol
),
feePayer:
cleanText(firstPresent(body.feePayer, body.relayerWallet), 120) || null,
relayerWallet:
cleanText(firstPresent(body.relayerWallet, body.feePayer), 120) || null,
sourceWallet:
cleanText(firstPresent(body.sourceWallet, body.escrowAddress), 120) || null,
escrowAddress:
cleanText(firstPresent(body.escrowAddress), 120) || launchEscrow.address,
executionModel: "program_vault",
raw: body,
};
}

async function executeRefundRow(refundRow) {
if (!refundRow?.id) {
throw new Error("refund ledger row missing id");
}

if (!refundRow.launchId) {
throw new Error("refund ledger row missing launch_id");
}

if (!refundRow.wallet) {
throw new Error("refund ledger row missing wallet");
}

const requestedLamports = safeNumber(
refundRow.requestedLamports,
refundRow.requestedSol > 0 ? solToLamports(refundRow.requestedSol) : 0
);

if (!Number.isFinite(requestedLamports) || requestedLamports <= 0) {
throw new Error("refund ledger row missing valid refund amount");
}

const launch = await getLaunchById(refundRow.launchId);
if (!launch) {
throw new Error("launch not found for refund ledger row");
}

const launchEscrow = resolveLaunchCommitEscrow(launch);

if (
refundRow.status === REFUND_STATUS_PENDING_SHARED ||
launchEscrow.model === "shared_wallet"
) {
return sendSharedWalletRefundTransfer({
launch,
destinationWallet: refundRow.wallet,
requestedLamports,
requestedSol: refundRow.requestedSol,
});
}

return executeProgramRefundAdapter({
refundRow,
launch,
requestedLamports,
requestedSol: refundRow.requestedSol,
});
}

export async function settleRefundLedgerEntryById(refundId) {
const row = await getRefundLedgerRowById(refundId);
if (!row) {
throw new Error("refund ledger row not found");
}

if (row.status === REFUND_STATUS_REFUNDED) {
const cleanup = await reconcileRefundedWalletState(row);
return {
ok: true,
alreadyRefunded: true,
row,
cleanup,
};
}

if (
row.status !== REFUND_STATUS_PENDING_PROGRAM &&
row.status !== REFUND_STATUS_PENDING_SHARED
) {
throw new Error(`refund ledger row is not pending: ${row.status || "unknown"}`);
}

const retryStatus = row.status;
const expectedRawStatuses = [row.statusRaw || row.status];

if (
retryStatus === REFUND_STATUS_PENDING_SHARED &&
row.statusRaw !== REFUND_STATUS_PENDING_SHARED_LEGACY
) {
expectedRawStatuses.push(REFUND_STATUS_PENDING_SHARED_LEGACY);
}

const claimed = await claimRefundLedgerRow(refundId, expectedRawStatuses);
if (!claimed) {
return {
ok: false,
skipped: true,
reason: "refund ledger row could not be claimed",
};
}

const remainingBeforeExecution = await getWalletCommitTotalSol(
claimed.launchId,
claimed.wallet
);

if (remainingBeforeExecution <= 0) {
const cancelled = await markRefundLedgerCancelled(
claimed.id,
"no remaining wallet commits to refund"
);

return {
ok: false,
skipped: true,
reason: "no remaining wallet commits to refund",
row: cancelled,
};
}

try {
const execution = await executeRefundRow({
...claimed,
status: retryStatus,
});

const settled = await markRefundLedgerSettled(claimed.id, {
...execution,
requestedSol: claimed.requestedSol,
requestedLamports: claimed.requestedLamports,
});

const cleanup = await reconcileRefundedWalletState(claimed);

return {
ok: true,
row: settled,
execution,
cleanup,
};
} catch (err) {
const retryable = isRetryableRefundError(err);
const failed = await markRefundLedgerFailed(claimed, err, {
retryable,
retryStatus,
});

return {
ok: false,
row: failed,
retryable,
error: err?.message || "refund execution failed",
};
}
}

export async function executePendingRefunds({
limit = DEFAULT_EXECUTOR_BATCH_SIZE,
} = {}) {
if (!(await tableExists("launch_refund_ledger"))) {
return {
ok: true,
processed: 0,
refunded: 0,
failed: 0,
skipped: 0,
rows: [],
note: "launch_refund_ledger table not found",
};
}

const pendingRows = await listPendingRefundLedgerRows(limit);

let refunded = 0;
let failed = 0;
let skipped = 0;
const rows = [];

for (const row of pendingRows) {
try {
const result = await settleRefundLedgerEntryById(row.id);
rows.push(result);

if (result?.ok && !result?.skipped) {
refunded += 1;
} else if (result?.skipped) {
skipped += 1;
} else {
failed += 1;
}
} catch (err) {
failed += 1;
rows.push({
ok: false,
refundLedgerId: row.id,
error: err?.message || "refund execution failed",
});
}
}

return {
ok: true,
processed: pendingRows.length,
refunded,
failed,
skipped,
rows,
};
}

export function startRefundExecutor({
intervalMs = DEFAULT_EXECUTOR_INTERVAL_MS,
limit = DEFAULT_EXECUTOR_BATCH_SIZE,
} = {}) {
if (globalThis.__mssRefundExecutorWorkerStarted) {
return;
}

globalThis.__mssRefundExecutorWorkerStarted = true;

setTimeout(() => {
void executePendingRefunds({ limit }).catch((err) => {
console.error("Initial refund executor tick failed:", err);
});
}, 3500);

setInterval(() => {
void executePendingRefunds({ limit }).catch((err) => {
console.error("Refund executor tick failed:", err);
});
}, Math.max(1000, Number(intervalMs || DEFAULT_EXECUTOR_INTERVAL_MS)));
}

export const startRefundExecutorWorker = startRefundExecutor;
