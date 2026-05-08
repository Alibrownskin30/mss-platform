import crypto from "crypto";
import db from "../../db/index.js";

const tableExistsCache = new Map();
const tableColumnsCache = new Map();

const REFUND_STATUS_PENDING = "pending";
const REFUND_STATUS_PROCESSING = "processing";
const REFUND_STATUS_REFUNDED = "refunded";
const REFUND_STATUS_PARTIAL = "partial";
const REFUND_STATUS_FAILED = "failed";

function cleanText(value, max = 5000) {
return String(value ?? "").trim().slice(0, max);
}

function normalizeWallet(value) {
return cleanText(value, 120);
}

function normalizeWalletKey(value) {
return normalizeWallet(value).toLowerCase();
}

function safeNum(value, fallback = 0) {
const n = Number(value);
return Number.isFinite(n) ? n : fallback;
}

function roundSol(value) {
return Number(safeNum(value, 0).toFixed(9));
}

function solToLamports(solAmount) {
return Math.round(Number(solAmount || 0) * 1_000_000_000);
}

function lamportsToSol(lamports) {
return roundSol(Number(lamports || 0) / 1_000_000_000);
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

function uniqueStrings(values = []) {
const seen = new Set();
const out = [];

for (const value of values) {
const cleaned = cleanText(value, 200);
if (!cleaned || seen.has(cleaned)) continue;
seen.add(cleaned);
out.push(cleaned);
}

return out;
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

async function assertRefundLedgerTables() {
const required = [
"launch_refund_ledger",
"launch_refund_events",
"launch_escrow_vaults",
];

for (const tableName of required) {
if (!(await tableExists(tableName))) {
throw new Error(`${tableName} table not found`);
}
}
}

async function getCommitsTableName() {
const row = await db.get(
`
SELECT name
FROM sqlite_master
WHERE type = 'table' AND name IN ('commits', 'launcher_commits')
ORDER BY CASE WHEN name = 'commits' THEN 0 ELSE 1 END
LIMIT 1
`
);

return row?.name || null;
}

async function getLaunchRow(launchId) {
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

async function getEscrowVaultRow(launchId) {
if (!(await tableExists("launch_escrow_vaults"))) return null;

return db.get(
`
SELECT *
FROM launch_escrow_vaults
WHERE launch_id = ?
LIMIT 1
`,
[launchId]
);
}

function resolveEscrowContext(launch = null, vault = null) {
const sharedEscrowWallet = cleanText(process.env.ESCROW_WALLET, 120);

const vaultAddress =
cleanText(
vault?.commit_destination_address ||
vault?.vault_address ||
launch?.commit_escrow_address ||
launch?.launch_escrow_address ||
launch?.escrow_vault_address ||
launch?.escrow_address ||
launch?.vault_address ||
launch?.escrow_wallet,
120
) || null;

const modelHint = cleanText(
vault?.escrow_model ||
launch?.commit_escrow_model ||
launch?.escrow_model ||
launch?.escrow_type ||
launch?.funds_model,
80
).toLowerCase();

let escrowModel = "shared_wallet";

if (
modelHint.includes("vault") ||
modelHint.includes("program") ||
modelHint.includes("pda")
) {
escrowModel = "launch_vault";
} else if (vaultAddress && sharedEscrowWallet && vaultAddress !== sharedEscrowWallet) {
escrowModel = "launch_vault";
}

return {
address: vaultAddress || sharedEscrowWallet || null,
escrowModel,
refundMode:
cleanText(vault?.refund_mode, 80).toLowerCase() ||
(escrowModel === "launch_vault" ? "vault_program" : "wallet_transfer"),
relayerAddress:
cleanText(vault?.fee_relayer_address, 120) ||
cleanText(process.env.RELAYER_PUBLIC_KEY, 120) ||
cleanText(process.env.REFUND_RELAYER_PUBLIC_KEY, 120) ||
null,
};
}

async function getConfirmedCommitRows(launchId, wallet = "") {
const tableName = await getCommitsTableName();
if (!tableName) return [];

const columns = await getTableColumns(tableName);
const hasStatus = columns.has("status");
const hasTxStatus = columns.has("tx_status");
const hasWallet = columns.has("wallet");
const hasSolAmount = columns.has("sol_amount");
const hasTxSignature = columns.has("tx_signature");
const hasCreatedAt = columns.has("created_at");

if (!hasWallet || !hasSolAmount) {
throw new Error(`${tableName} schema missing wallet or sol_amount`);
}

let statusClause = "";
if (hasStatus) {
statusClause = `AND status IN ('confirmed', 'complete', 'completed')`;
} else if (hasTxStatus) {
statusClause = `AND tx_status IN ('confirmed', 'complete', 'completed')`;
}

const walletClause = wallet ? `AND LOWER(wallet) = LOWER(?)` : "";
const params = wallet ? [launchId, wallet] : [launchId];

const rows = await db.all(
`
SELECT
wallet,
sol_amount,
${hasTxSignature ? "tx_signature" : "NULL AS tx_signature"},
${hasCreatedAt ? "created_at" : "NULL AS created_at"}
FROM ${tableName}
WHERE launch_id = ?
${walletClause}
${statusClause}
ORDER BY id ASC
`,
params
);

return rows.map((row) => ({
wallet: normalizeWallet(row.wallet),
solAmount: roundSol(row.sol_amount),
txSignature: cleanText(row.tx_signature, 140),
createdAt: row.created_at || null,
}));
}

function aggregateCommitRows(rows = []) {
const cleanRows = (Array.isArray(rows) ? rows : []).filter(
(row) => normalizeWallet(row.wallet) && safeNum(row.solAmount, 0) > 0
);

const signatures = uniqueStrings(cleanRows.map((row) => row.txSignature));
const committedSol = roundSol(
cleanRows.reduce((sum, row) => sum + safeNum(row.solAmount, 0), 0)
);
const committedLamports = solToLamports(committedSol);

return {
commitCount: cleanRows.length,
committedSol,
committedLamports,
latestCommitTxSignature:
signatures.length > 0 ? signatures[signatures.length - 1] : null,
sourceCommitTxSignatures: signatures,
};
}

async function getRefundLedgerEntry(launchId, wallet) {
await assertRefundLedgerTables();

return db.get(
`
SELECT *
FROM launch_refund_ledger
WHERE launch_id = ? AND LOWER(wallet) = LOWER(?)
LIMIT 1
`,
[launchId, wallet]
);
}

async function insertRefundEvent({
launchId,
ledgerId = null,
wallet,
eventType,
eventStatus = "ok",
txSignature = "",
details = null,
}) {
await assertRefundLedgerTables();

await db.run(
`
INSERT INTO launch_refund_events (
launch_id,
ledger_id,
wallet,
event_type,
event_status,
tx_signature,
details_json
) VALUES (?, ?, ?, ?, ?, ?, ?)
`,
[
launchId,
ledgerId,
normalizeWallet(wallet),
cleanText(eventType, 80),
cleanText(eventStatus, 40) || "ok",
cleanText(txSignature, 140),
details == null ? null : JSON.stringify(details),
]
);
}

function buildClaimToken() {
return crypto.randomBytes(16).toString("hex");
}

async function upsertRefundLedgerEntry({
launchId,
wallet,
observedCommits = [],
escrowContext = null,
metadata = null,
}) {
await assertRefundLedgerTables();

const normalizedWallet = normalizeWallet(wallet);
if (!normalizedWallet) {
throw new Error("wallet is required for refund ledger upsert");
}

const existing = await getRefundLedgerEntry(launchId, normalizedWallet);
const observed = aggregateCommitRows(observedCommits);

const existingCommittedLamports = safeNum(existing?.committed_lamports, 0);
const existingCommittedSol = roundSol(existing?.committed_sol);
const existingRefundedLamports = safeNum(existing?.refunded_lamports, 0);
const existingRefundedSol = roundSol(existing?.refunded_sol);
const existingCommitCount = safeNum(existing?.commit_count, 0);

const existingSignatures = uniqueStrings(
parseJsonMaybe(existing?.source_commit_tx_signatures_json, [])
);

const mergedSignatures = uniqueStrings([
...existingSignatures,
...observed.sourceCommitTxSignatures,
]);

const committedLamports = Math.max(
existingCommittedLamports,
observed.committedLamports
);
const committedSol = Math.max(existingCommittedSol, observed.committedSol);
const commitCount = Math.max(existingCommitCount, observed.commitCount);

const refundableLamports = Math.max(0, committedLamports - existingRefundedLamports);
const refundableSol = lamportsToSol(refundableLamports);

let nextStatus = REFUND_STATUS_PENDING;
const currentStatus = cleanText(existing?.status, 40).toLowerCase();

if (committedLamports <= 0) {
nextStatus = currentStatus || REFUND_STATUS_PENDING;
} else if (refundableLamports <= 0) {
nextStatus = REFUND_STATUS_REFUNDED;
} else if (currentStatus === REFUND_STATUS_PROCESSING) {
nextStatus = REFUND_STATUS_PROCESSING;
} else if (currentStatus === REFUND_STATUS_FAILED) {
nextStatus = REFUND_STATUS_FAILED;
} else if (existingRefundedLamports > 0) {
nextStatus = REFUND_STATUS_PARTIAL;
}

const values = {
launch_id: launchId,
wallet: normalizedWallet,
status: nextStatus,
commit_count: commitCount,
committed_sol: committedSol,
committed_lamports: committedLamports,
refundable_sol: refundableSol,
refundable_lamports: refundableLamports,
refunded_sol: existingRefundedSol,
refunded_lamports: existingRefundedLamports,
source_commit_tx_signature:
observed.latestCommitTxSignature ||
cleanText(existing?.source_commit_tx_signature, 140) ||
null,
source_commit_tx_signatures_json: JSON.stringify(mergedSignatures),
escrow_source_address: cleanText(
escrowContext?.address || existing?.escrow_source_address,
120
) || null,
relayer_fee_payer: cleanText(
escrowContext?.relayerAddress || existing?.relayer_fee_payer,
120
) || null,
metadata_json:
metadata != null
? JSON.stringify(metadata)
: existing?.metadata_json || null,
};

if (!existing) {
const result = await db.run(
`
INSERT INTO launch_refund_ledger (
launch_id,
wallet,
status,
commit_count,
committed_sol,
committed_lamports,
refundable_sol,
refundable_lamports,
refunded_sol,
refunded_lamports,
source_commit_tx_signature,
source_commit_tx_signatures_json,
escrow_source_address,
relayer_fee_payer,
metadata_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
[
values.launch_id,
values.wallet,
values.status,
values.commit_count,
values.committed_sol,
values.committed_lamports,
values.refundable_sol,
values.refundable_lamports,
values.refunded_sol,
values.refunded_lamports,
values.source_commit_tx_signature,
values.source_commit_tx_signatures_json,
values.escrow_source_address,
values.relayer_fee_payer,
values.metadata_json,
]
);

const inserted = await db.get(
`SELECT * FROM launch_refund_ledger WHERE id = ? LIMIT 1`,
[result.lastID]
);

await insertRefundEvent({
launchId,
ledgerId: inserted?.id || null,
wallet: normalizedWallet,
eventType: "ledger_synced",
details: {
committedSol,
refundableSol,
status: values.status,
},
});

return inserted;
}

await db.run(
`
UPDATE launch_refund_ledger
SET status = ?,
commit_count = ?,
committed_sol = ?,
committed_lamports = ?,
refundable_sol = ?,
refundable_lamports = ?,
source_commit_tx_signature = ?,
source_commit_tx_signatures_json = ?,
escrow_source_address = ?,
relayer_fee_payer = ?,
metadata_json = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[
values.status,
values.commit_count,
values.committed_sol,
values.committed_lamports,
values.refundable_sol,
values.refundable_lamports,
values.source_commit_tx_signature,
values.source_commit_tx_signatures_json,
values.escrow_source_address,
values.relayer_fee_payer,
values.metadata_json,
existing.id,
]
);

const updated = await db.get(
`SELECT * FROM launch_refund_ledger WHERE id = ? LIMIT 1`,
[existing.id]
);

await insertRefundEvent({
launchId,
ledgerId: existing.id,
wallet: normalizedWallet,
eventType: "ledger_synced",
details: {
committedSol: values.committed_sol,
refundableSol: values.refundable_sol,
status: values.status,
},
});

return updated;
}

export async function syncRefundLedgerForWallet(launchId, wallet, options = {}) {
await assertRefundLedgerTables();

const normalizedWallet = normalizeWallet(wallet);
if (!normalizedWallet) {
throw new Error("wallet is required");
}

const [launch, vault, observedCommits] = await Promise.all([
getLaunchRow(launchId),
getEscrowVaultRow(launchId),
getConfirmedCommitRows(launchId, normalizedWallet),
]);

if (!launch) {
throw new Error("launch not found");
}

const escrowContext = resolveEscrowContext(launch, vault);

return upsertRefundLedgerEntry({
launchId,
wallet: normalizedWallet,
observedCommits,
escrowContext,
metadata: options.metadata || null,
});
}

export async function syncRefundLedgerForLaunch(launchId, options = {}) {
await assertRefundLedgerTables();

const [launch, vault, observedCommits] = await Promise.all([
getLaunchRow(launchId),
getEscrowVaultRow(launchId),
getConfirmedCommitRows(launchId),
]);

if (!launch) {
throw new Error("launch not found");
}

const escrowContext = resolveEscrowContext(launch, vault);
const wallets = new Set();

for (const row of observedCommits) {
const key = normalizeWalletKey(row.wallet);
if (key) wallets.add(normalizeWallet(row.wallet));
}

const existingRows = await db.all(
`
SELECT wallet
FROM launch_refund_ledger
WHERE launch_id = ?
`,
[launchId]
);

for (const row of existingRows) {
const key = normalizeWalletKey(row.wallet);
if (key) wallets.add(normalizeWallet(row.wallet));
}

const results = [];

for (const wallet of wallets) {
const walletCommits = observedCommits.filter(
(row) => normalizeWalletKey(row.wallet) === normalizeWalletKey(wallet)
);

const entry = await upsertRefundLedgerEntry({
launchId,
wallet,
observedCommits: walletCommits,
escrowContext,
metadata: options.metadata || null,
});

results.push(entry);
}

return results;
}

export async function getRefundLedgerForLaunch(launchId) {
await assertRefundLedgerTables();

return db.all(
`
SELECT *
FROM launch_refund_ledger
WHERE launch_id = ?
ORDER BY id ASC
`,
[launchId]
);
}

export async function claimRefundLedgerEntry({ launchId, wallet }) {
await assertRefundLedgerTables();

const entry = await syncRefundLedgerForWallet(launchId, wallet);
if (!entry) {
throw new Error("refund ledger entry not found");
}

if (safeNum(entry.refundable_lamports, 0) <= 0) {
return {
ok: false,
reason: "nothing refundable",
entry,
};
}

const claimToken = buildClaimToken();

const claim = await db.run(
`
UPDATE launch_refund_ledger
SET status = ?,
claim_token = ?,
claimed_at = CURRENT_TIMESTAMP,
refund_requested_at = COALESCE(refund_requested_at, CURRENT_TIMESTAMP),
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
AND refundable_lamports > 0
AND status IN (?, ?, ?)
`,
[
REFUND_STATUS_PROCESSING,
claimToken,
entry.id,
REFUND_STATUS_PENDING,
REFUND_STATUS_FAILED,
REFUND_STATUS_PARTIAL,
]
);

if (!claim?.changes) {
const latest = await db.get(
`SELECT * FROM launch_refund_ledger WHERE id = ? LIMIT 1`,
[entry.id]
);

return {
ok: false,
reason: "refund entry is already claimed or settled",
entry: latest || entry,
};
}

const claimed = await db.get(
`SELECT * FROM launch_refund_ledger WHERE id = ? LIMIT 1`,
[entry.id]
);

await insertRefundEvent({
launchId,
ledgerId: claimed?.id || entry.id,
wallet,
eventType: "refund_claimed",
details: {
claimToken,
refundableSol: roundSol(claimed?.refundable_sol),
},
});

return {
ok: true,
claimToken,
entry: claimed,
};
}

export async function markRefundLedgerPaid({
ledgerId,
launchId,
wallet,
refundedSol,
refundTxSignature = "",
relayerFeePayer = "",
escrowSourceAddress = "",
metadata = null,
}) {
await assertRefundLedgerTables();

let entry = null;

if (ledgerId) {
entry = await db.get(
`SELECT * FROM launch_refund_ledger WHERE id = ? LIMIT 1`,
[ledgerId]
);
} else if (launchId && wallet) {
entry = await getRefundLedgerEntry(launchId, wallet);
}

if (!entry) {
throw new Error("refund ledger entry not found");
}

const refundLamports = solToLamports(refundedSol);
if (refundLamports <= 0) {
throw new Error("refunded amount must be greater than zero");
}

const committedLamports = safeNum(entry.committed_lamports, 0);
const nextRefundedLamports = Math.min(
committedLamports,
safeNum(entry.refunded_lamports, 0) + refundLamports
);
const nextRefundedSol = lamportsToSol(nextRefundedLamports);
const nextRefundableLamports = Math.max(0, committedLamports - nextRefundedLamports);
const nextRefundableSol = lamportsToSol(nextRefundableLamports);
const nextStatus =
nextRefundableLamports <= 0 ? REFUND_STATUS_REFUNDED : REFUND_STATUS_PARTIAL;

await db.run(
`
UPDATE launch_refund_ledger
SET status = ?,
refunded_sol = ?,
refunded_lamports = ?,
refundable_sol = ?,
refundable_lamports = ?,
refund_tx_signature = ?,
relayer_fee_payer = COALESCE(?, relayer_fee_payer),
escrow_source_address = COALESCE(?, escrow_source_address),
refund_processed_at = CURRENT_TIMESTAMP,
last_error = NULL,
metadata_json = COALESCE(?, metadata_json),
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[
nextStatus,
nextRefundedSol,
nextRefundedLamports,
nextRefundableSol,
nextRefundableLamports,
cleanText(refundTxSignature, 140),
cleanText(relayerFeePayer, 120) || null,
cleanText(escrowSourceAddress, 120) || null,
metadata != null ? JSON.stringify(metadata) : null,
entry.id,
]
);

const updated = await db.get(
`SELECT * FROM launch_refund_ledger WHERE id = ? LIMIT 1`,
[entry.id]
);

await insertRefundEvent({
launchId: updated.launch_id,
ledgerId: updated.id,
wallet: updated.wallet,
eventType: "refund_paid",
txSignature: refundTxSignature,
details: {
refundedSol: roundSol(refundedSol),
refundedLamports: refundLamports,
totalRefundedSol: nextRefundedSol,
remainingRefundableSol: nextRefundableSol,
status: nextStatus,
},
});

return updated;
}

export async function markRefundLedgerFailed({
ledgerId,
launchId,
wallet,
errorMessage,
metadata = null,
}) {
await assertRefundLedgerTables();

let entry = null;

if (ledgerId) {
entry = await db.get(
`SELECT * FROM launch_refund_ledger WHERE id = ? LIMIT 1`,
[ledgerId]
);
} else if (launchId && wallet) {
entry = await getRefundLedgerEntry(launchId, wallet);
}

if (!entry) {
throw new Error("refund ledger entry not found");
}

const nextAttempts = safeNum(entry.refund_attempts, 0) + 1;
const message = cleanText(errorMessage, 1000) || "refund execution failed";

await db.run(
`
UPDATE launch_refund_ledger
SET status = ?,
refund_attempts = ?,
last_error = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[REFUND_STATUS_FAILED, nextAttempts, message, entry.id]
);

const updated = await db.get(
`SELECT * FROM launch_refund_ledger WHERE id = ? LIMIT 1`,
[entry.id]
);

await insertRefundEvent({
launchId: updated.launch_id,
ledgerId: updated.id,
wallet: updated.wallet,
eventType: "refund_failed",
eventStatus: "error",
details: {
error: message,
refundAttempts: nextAttempts,
metadata,
},
});

return updated;
}

export async function releaseRefundLedgerClaim({
ledgerId,
launchId,
wallet,
errorMessage = "",
}) {
await assertRefundLedgerTables();

let entry = null;

if (ledgerId) {
entry = await db.get(
`SELECT * FROM launch_refund_ledger WHERE id = ? LIMIT 1`,
[ledgerId]
);
} else if (launchId && wallet) {
entry = await getRefundLedgerEntry(launchId, wallet);
}

if (!entry) {
throw new Error("refund ledger entry not found");
}

const nextStatus =
safeNum(entry.refundable_lamports, 0) > 0
? REFUND_STATUS_PENDING
: REFUND_STATUS_REFUNDED;

await db.run(
`
UPDATE launch_refund_ledger
SET status = ?,
claim_token = NULL,
claimed_at = NULL,
last_error = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[nextStatus, cleanText(errorMessage, 1000), entry.id]
);

return db.get(`SELECT * FROM launch_refund_ledger WHERE id = ? LIMIT 1`, [
entry.id,
]);
}
