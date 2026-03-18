import express from "express";
import {
Connection,
Keypair,
PublicKey,
SystemProgram,
Transaction,
TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";
import db from "../db/index.js";
import { buildLaunchAllocations } from "../services/launcher/allocationService.js";
import { verifyCommitTransfer } from "../services/launcher/commitVerifier.js";
import { finalizeLaunch } from "../services/launcher/finalizeLaunch.js";

const router = express.Router();

const COMMIT_PHASE_MINUTES = 4;
const COUNTDOWN_MINUTES = 4;
const MAX_WALLET_COMMIT_SOL = 100;
const MAX_TEAM_WALLETS = 5;
const MAX_TEAM_ALLOCATION_PCT = 15;
const MIN_BUILDER_BOND_SOL = 5;
const TEAM_PCT_PRECISION = 6;
const RECONCILE_INTERVAL_MS = 15000;

const LAUNCH_FEE_SPLIT = {
founder: 0.5,
buyback: 0.3,
treasury: 0.2,
};

const MEMO_PROGRAM_ID = new PublicKey(
"MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

function cleanText(value, max = 280) {
return String(value ?? "").trim().slice(0, max);
}

function cleanSymbol(value, max = 20) {
return String(value ?? "")
.toUpperCase()
.replace(/[^A-Z0-9]/g, "")
.slice(0, max);
}

function safeNumber(value, fallback = 0) {
const n = Number(value);
return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
return Math.max(min, Math.min(max, n));
}

function roundPct(value) {
return Number(Number(value || 0).toFixed(TEAM_PCT_PRECISION));
}

function approxEqual(a, b, epsilon = 0.000001) {
return Math.abs(Number(a || 0) - Number(b || 0)) <= epsilon;
}

function parseJsonMaybe(input, fallback = null) {
if (input == null || input === "") return fallback;
if (typeof input === "object") return input;

try {
return JSON.parse(String(input));
} catch {
return fallback;
}
}

function normalizeWallet(value) {
return cleanText(value, 120);
}

function dedupeWalletEntries(wallets = []) {
const seen = new Set();
const out = [];

for (const wallet of wallets) {
const w = normalizeWallet(wallet);
if (!w) continue;
if (seen.has(w)) continue;
seen.add(w);
out.push(w);
}

return out;
}

function parseTeamWallets(input) {
if (!input) return [];

if (Array.isArray(input)) {
return dedupeWalletEntries(input).slice(0, MAX_TEAM_WALLETS);
}

const parsed = parseJsonMaybe(input, []);
if (Array.isArray(parsed)) {
return dedupeWalletEntries(parsed).slice(0, MAX_TEAM_WALLETS);
}

return [];
}

function parseTeamWalletBreakdown(input) {
if (!input) return [];

const raw = Array.isArray(input) ? input : parseJsonMaybe(input, []);
if (!Array.isArray(raw)) return [];

const seen = new Set();
const out = [];

for (const entry of raw) {
if (!entry || typeof entry !== "object") continue;

const wallet = normalizeWallet(entry.wallet ?? entry.address ?? entry.pubkey);
const pct = roundPct(entry.pct ?? entry.percent ?? entry.percentage);

if (!wallet) continue;
if (!Number.isFinite(pct) || pct <= 0) continue;
if (seen.has(wallet)) continue;

seen.add(wallet);
out.push({ wallet, pct, label: cleanText(entry.label, 80) });
}

return out.slice(0, MAX_TEAM_WALLETS);
}

function buildEqualBreakdown(wallets, totalPct) {
const cleanWallets = dedupeWalletEntries(wallets).slice(0, MAX_TEAM_WALLETS);
const pct = roundPct(totalPct);

if (!cleanWallets.length || pct <= 0) return [];

const perWallet = roundPct(pct / cleanWallets.length);
const out = cleanWallets.map((wallet, index) => ({
wallet,
pct:
index === cleanWallets.length - 1
? roundPct(pct - perWallet * (cleanWallets.length - 1))
: perWallet,
}));

return out.filter((x) => x.pct > 0);
}

function normalizeSupply(value, fallback) {
const raw = String(value ?? fallback ?? "").trim();
if (!raw) return String(fallback ?? "1000000000");

const digits = raw.replace(/[^\d]/g, "");
if (!digits) return String(fallback ?? "1000000000");

return digits;
}

function safeJsonParseArray(value) {
const parsed = parseJsonMaybe(value, []);
return Array.isArray(parsed) ? parsed : [];
}

function getTemplateConfig(template) {
const configs = {
degen: {
launch_type: "degen",
supply: "1000000000",
min_raise_sol: 1,
hard_cap_sol: 1,
liquidity_pct: 20,
participants_pct: 45,
reserve_pct: 30,
builder_pct: 5,
},
degen_zone: {
launch_type: "degen",
supply: "1000000000",
min_raise_sol: 1,
hard_cap_sol: 1.1,
liquidity_pct: 20,
participants_pct: 45,
reserve_pct: 30,
builder_pct: 5,
},
meme_lite: {
launch_type: "main",
supply: "1000000000",
min_raise_sol: 20,
hard_cap_sol: 100,
liquidity_pct: 20,
participants_pct: 45,
reserve_pct: 30,
builder_pct: 5,
},
meme_pro: {
launch_type: "main",
supply: "1000000000",
min_raise_sol: 50,
hard_cap_sol: 200,
liquidity_pct: 20,
participants_pct: 45,
reserve_pct: 30,
builder_pct: 5,
},
builder: {
launch_type: "main",
supply: "1000000000",
min_raise_sol: 50,
hard_cap_sol: 250,
liquidity_pct: 20,
participants_pct: 45,
reserve_pct: 30,
builder_pct: 5,
},
community: {
launch_type: "main",
supply: "1000000000",
min_raise_sol: 40,
hard_cap_sol: 200,
liquidity_pct: 20,
participants_pct: 45,
reserve_pct: 30,
builder_pct: 5,
},
};

return configs[template] || null;
}

function buildCommitPercent(totalCommitted, hardCap) {
const total = Number(totalCommitted || 0);
const cap = Number(hardCap || 0);
if (cap <= 0) return 0;
return Math.max(0, Math.min(100, Math.floor((total / cap) * 100)));
}

function buildFeeBreakdown(totalCommitted, launchFeePct = 5) {
const feeTotal = Number(totalCommitted) * (Number(launchFeePct) / 100);
const founderFee = feeTotal * LAUNCH_FEE_SPLIT.founder;
const buybackFee = feeTotal * LAUNCH_FEE_SPLIT.buyback;
const treasuryFee = feeTotal * LAUNCH_FEE_SPLIT.treasury;
const netRaiseAfterFee = Number(totalCommitted) - feeTotal;

return {
launchFeePct: Number(launchFeePct),
totalCommitted: Number(totalCommitted),
feeTotal,
founderFee,
buybackFee,
treasuryFee,
netRaiseAfterFee,
};
}

function shapeBuilderConfig(template, reqBody) {
if (template !== "builder") {
return {
team_allocation_pct: 0,
team_wallets: [],
team_wallet_breakdown: [],
builder_bond_sol: 0,
};
}

const teamAllocationPct = clamp(
safeNumber(reqBody.team_allocation_pct, reqBody.teamAllocation),
0,
MAX_TEAM_ALLOCATION_PCT
);

const builderBondSol = safeNumber(
reqBody.builder_bond_sol,
reqBody.builderBond
);

const rawTeamWallets = parseTeamWallets(
reqBody.team_wallets ?? reqBody.teamWallets
);

let breakdown = parseTeamWalletBreakdown(
reqBody.team_wallet_breakdown ?? reqBody.teamWalletBreakdown
);

let teamWallets = rawTeamWallets;

if (!breakdown.length && teamWallets.length && teamAllocationPct > 0) {
breakdown = buildEqualBreakdown(teamWallets, teamAllocationPct);
}

if (breakdown.length) {
teamWallets = dedupeWalletEntries(breakdown.map((x) => x.wallet));
}

return {
team_allocation_pct: teamAllocationPct,
team_wallets: teamWallets.slice(0, MAX_TEAM_WALLETS),
team_wallet_breakdown: breakdown.slice(0, MAX_TEAM_WALLETS),
builder_bond_sol: builderBondSol,
};
}

function validateBuilderConfig(template, cfg, builderCfg) {
if (!cfg) {
throw new Error("invalid template");
}

if (Number(cfg.min_raise_sol) <= 0) {
throw new Error("invalid minimum raise");
}

if (Number(cfg.hard_cap_sol) <= Number(cfg.min_raise_sol)) {
throw new Error("hard cap must be greater than minimum raise");
}

if (template !== "builder") {
return;
}

if (
!Number.isFinite(builderCfg.team_allocation_pct) ||
builderCfg.team_allocation_pct < 0
) {
throw new Error("invalid team allocation");
}

if (builderCfg.team_allocation_pct > MAX_TEAM_ALLOCATION_PCT) {
throw new Error(`team allocation cannot exceed ${MAX_TEAM_ALLOCATION_PCT}%`);
}

if (!Array.isArray(builderCfg.team_wallets)) {
throw new Error("team wallets must be an array");
}

if (builderCfg.team_wallets.length > MAX_TEAM_WALLETS) {
throw new Error(`team wallets cannot exceed ${MAX_TEAM_WALLETS}`);
}

if (builderCfg.team_wallets.some((wallet) => !wallet)) {
throw new Error("invalid team wallet entry");
}

if (!Array.isArray(builderCfg.team_wallet_breakdown)) {
throw new Error("team wallet breakdown must be an array");
}

if (builderCfg.team_wallet_breakdown.length > MAX_TEAM_WALLETS) {
throw new Error(`team wallet breakdown cannot exceed ${MAX_TEAM_WALLETS}`);
}

const breakdownWallets = new Set();
let breakdownTotal = 0;

for (const entry of builderCfg.team_wallet_breakdown) {
if (!entry || typeof entry !== "object") {
throw new Error("invalid team wallet breakdown entry");
}

const wallet = normalizeWallet(entry.wallet);
const pct = Number(entry.pct);

if (!wallet) {
throw new Error("team wallet breakdown wallet is required");
}

if (breakdownWallets.has(wallet)) {
throw new Error("duplicate wallet in team wallet breakdown");
}

if (!Number.isFinite(pct) || pct <= 0) {
throw new Error("team wallet breakdown pct must be greater than 0");
}

breakdownWallets.add(wallet);
breakdownTotal += pct;
}

breakdownTotal = roundPct(breakdownTotal);

const teamWalletSet = new Set(builderCfg.team_wallets);

for (const wallet of breakdownWallets) {
if (!teamWalletSet.has(wallet)) {
throw new Error("team wallet breakdown must match team wallets");
}
}

if (builderCfg.team_allocation_pct === 0) {
if (builderCfg.team_wallets.length || builderCfg.team_wallet_breakdown.length) {
throw new Error("team wallets are not allowed when team allocation is 0");
}
} else {
if (!builderCfg.team_wallets.length) {
throw new Error("team wallets are required for builder launches");
}

if (!builderCfg.team_wallet_breakdown.length) {
throw new Error("team wallet breakdown is required for builder launches");
}

if (!approxEqual(breakdownTotal, builderCfg.team_allocation_pct)) {
throw new Error("team wallet breakdown must equal team allocation");
}
}

if (
!Number.isFinite(builderCfg.builder_bond_sol) ||
builderCfg.builder_bond_sol < MIN_BUILDER_BOND_SOL
) {
throw new Error(`builder bond must be at least ${MIN_BUILDER_BOND_SOL} SOL`);
}
}

function parseLaunchJsonFields(row) {
const teamWallets = Array.isArray(row?.team_wallets)
? row.team_wallets
: safeJsonParseArray(row?.team_wallets);

const teamWalletBreakdown = Array.isArray(row?.team_wallet_breakdown)
? row.team_wallet_breakdown
: safeJsonParseArray(row?.team_wallet_breakdown);

return {
...row,
team_allocation_pct: Number(row?.team_allocation_pct || 0),
builder_bond_sol: Number(row?.builder_bond_sol || 0),
builder_bond_refunded: Number(row?.builder_bond_refunded || 0),
builder_bond_paid: Number(row?.builder_bond_paid || 0),
builder_bond_tx_signature: cleanText(row?.builder_bond_tx_signature, 140),
team_wallets: teamWallets,
team_wallet_breakdown: teamWalletBreakdown,
};
}

function hasCollectedBuilderBond(row) {
const launch = parseLaunchJsonFields(row);
return Boolean(
Number(launch.builder_bond_paid || 0) === 1 ||
cleanText(launch.builder_bond_tx_signature || "", 140)
);
}

function isBuilderBondSatisfied(row) {
const launch = parseLaunchJsonFields(row);
if (String(launch.template || "") !== "builder") return true;
if (Number(launch.builder_bond_sol || 0) <= 0) return false;
return Number(launch.builder_bond_paid || 0) === 1;
}

function isValidSolanaAddress(value) {
try {
new PublicKey(String(value || "").trim());
return true;
} catch {
return false;
}
}

function isLikelyBlockhashExpiredError(err) {
const msg = String(err?.message || err || "").toLowerCase();
return msg.includes("blockhash not found") || msg.includes("block height exceeded");
}

function shapeLaunchForList(row) {
const parsed = parseLaunchJsonFields(row);
const totalCommitted = Number(parsed.committed_sol || 0);
const hardCap = Number(parsed.hard_cap_sol || 0);

return {
id: parsed.id,
token_name: parsed.token_name,
symbol: parsed.symbol,
description: parsed.description,
image_url: parsed.image_url,
template: parsed.template,
launch_type: parsed.launch_type,
status: parsed.status,
min_raise_sol: Number(parsed.min_raise_sol || 0),
hard_cap_sol: hardCap,
committed_sol: totalCommitted,
participants_count: Number(parsed.participants_count || 0),
launch_fee_pct: Number(parsed.launch_fee_pct || 0),
liquidity_pct: Number(parsed.liquidity_pct || 0),
participants_pct: Number(parsed.participants_pct || 0),
reserve_pct: Number(parsed.reserve_pct || 0),
builder_pct: Number(parsed.builder_pct || 0),
team_allocation_pct: Number(parsed.team_allocation_pct || 0),
team_wallets: parsed.team_wallets,
team_wallet_breakdown: parsed.team_wallet_breakdown,
builder_bond_sol: Number(parsed.builder_bond_sol || 0),
builder_bond_refunded: Number(parsed.builder_bond_refunded || 0),
builder_bond_paid: Number(parsed.builder_bond_paid || 0),
commit_started_at: parsed.commit_started_at || null,
commit_ends_at: parsed.commit_ends_at || null,
countdown_started_at: parsed.countdown_started_at || null,
countdown_ends_at: parsed.countdown_ends_at || null,
live_at: parsed.live_at || null,
failed_at: parsed.failed_at || null,
builder_wallet: parsed.builder_wallet || null,
builder_alias: parsed.builder_alias || null,
builder_score: parsed.builder_score ?? null,
commitPercent: buildCommitPercent(totalCommitted, hardCap),
};
}

function getEscrowWallet() {
const wallet = cleanText(process.env.ESCROW_WALLET, 120);
if (!wallet) {
throw new Error("ESCROW_WALLET is not configured");
}
return wallet;
}

function getRpcUrl() {
return (
cleanText(process.env.SOLANA_RPC, 500) ||
cleanText(process.env.RPC_URL, 500) ||
"https://api.devnet.solana.com"
);
}

function getEscrowKeypair() {
const raw = cleanText(process.env.ESCROW_PRIVATE_KEY, 5000);
if (!raw) {
throw new Error("ESCROW_PRIVATE_KEY is not configured");
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
throw new Error(`ESCROW_PRIVATE_KEY is invalid: ${err?.message || err}`);
}
}

function solToLamports(solAmount) {
return Math.round(Number(solAmount) * 1_000_000_000);
}

function buildBuilderBondReference(wallet) {
return `mss-builder-bond-${cleanText(wallet, 80)}`;
}

async function buildEscrowTransferTransaction({ wallet, solAmount, reference }) {
const escrowWallet = getEscrowWallet();
const expectedLamports = solToLamports(solAmount);

const connection = new Connection(getRpcUrl(), "confirmed");
const fromPubkey = new PublicKey(wallet);
const escrowPubkey = new PublicKey(escrowWallet);

const transaction = new Transaction();

transaction.add(
SystemProgram.transfer({
fromPubkey,
toPubkey: escrowPubkey,
lamports: expectedLamports,
})
);

transaction.add(
new TransactionInstruction({
keys: [],
programId: MEMO_PROGRAM_ID,
data: Buffer.from(reference, "utf8"),
})
);

const { blockhash, lastValidBlockHeight } =
await connection.getLatestBlockhash("confirmed");

transaction.feePayer = fromPubkey;
transaction.recentBlockhash = blockhash;

const transactionBase64 = Buffer.from(
transaction.serialize({
requireAllSignatures: false,
verifySignatures: false,
})
).toString("base64");

return {
escrowWallet,
expectedLamports,
reference,
transaction: transactionBase64,
blockhash,
lastValidBlockHeight,
};
}

async function sendRefundTransfer({ destinationWallet, solAmount }) {
const destination = String(destinationWallet || "").trim();
if (!isValidSolanaAddress(destination)) {
console.log("Skipping refund for non-wallet address:", destination);
return null;
}

const rpcUrl = getRpcUrl();
const connection = new Connection(rpcUrl, "confirmed");
const escrowKeypair = getEscrowKeypair();

const lamports = solToLamports(solAmount);
if (!Number.isFinite(lamports) || lamports <= 0) {
throw new Error("invalid refund lamports");
}

const destinationPubkey = new PublicKey(destination);
const { blockhash, lastValidBlockHeight } =
await connection.getLatestBlockhash("confirmed");

const feeBufferLamports = 10000;
const escrowBalance = await connection.getBalance(
escrowKeypair.publicKey,
"confirmed"
);

if (escrowBalance < lamports + feeBufferLamports) {
throw new Error(
`escrow wallet lacks fee reserve for full refund: balance=${escrowBalance}, refund=${lamports}`
);
}

const tx = new Transaction({
feePayer: escrowKeypair.publicKey,
recentBlockhash: blockhash,
}).add(
SystemProgram.transfer({
fromPubkey: escrowKeypair.publicKey,
toPubkey: destinationPubkey,
lamports,
})
);

const signature = await connection.sendTransaction(tx, [escrowKeypair], {
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
signature,
refundedSol: solAmount,
refundedLamports: lamports,
};
}

async function refundRejectedCommit({
wallet,
solAmount,
txSignature,
reason,
status = null,
logLabel = "Late confirm refund failed",
}) {
try {
const refundTransfer = await sendRefundTransfer({
destinationWallet: wallet,
solAmount,
});

return {
httpStatus: 409,
body: {
ok: false,
error: `${reason}; funds refunded`,
txSignature,
refundTxSignature: refundTransfer?.signature || null,
refundedSol: refundTransfer?.refundedSol || 0,
status,
},
};
} catch (refundErr) {
console.error(`${logLabel}:`, refundErr);
return {
httpStatus: 409,
body: {
ok: false,
error: `${reason} and refund failed: ${refundErr?.message || refundErr}`,
txSignature,
status,
},
};
}
}

async function getLaunchById(launchId) {
return db.get(`SELECT * FROM launches WHERE id = ?`, [launchId]);
}

async function getBuilderByWallet(wallet) {
return db.get(
`SELECT id, wallet, alias FROM builders WHERE wallet = ?`,
[wallet]
);
}

async function getBuilderWalletForLaunch(launchId) {
return db.get(
`
SELECT b.wallet
FROM launches l
JOIN builders b ON b.id = l.builder_id
WHERE l.id = ?
`,
[launchId]
);
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

async function beginCountdown(launchId) {
const launch = await getLaunchById(launchId);
if (!launch) return null;

if (!isBuilderBondSatisfied(launch)) {
throw new Error("builder bond not satisfied");
}

if (launch.status === "countdown") {
return launch;
}

await db.run(
`
UPDATE launches
SET status = 'countdown',
countdown_started_at = CURRENT_TIMESTAMP,
countdown_ends_at = datetime(CURRENT_TIMESTAMP, '+${COUNTDOWN_MINUTES} minutes'),
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launchId]
);

return getLaunchById(launchId);
}

async function markLaunchFailed(launchId) {
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

return getLaunchById(launchId);
}

async function autoRefundFailedLaunch(launchId) {
let launch = await getLaunchById(launchId);
if (!launch || launch.status !== "failed") {
return launch;
}

const parsedLaunch = parseLaunchJsonFields(launch);
const builder = await getBuilderWalletForLaunch(launchId);

const refundRows = await db.all(
`
SELECT wallet, COALESCE(SUM(sol_amount), 0) AS total
FROM commits
WHERE launch_id = ?
GROUP BY wallet
`,
[launchId]
);

const refunds = refundRows.map((row) => ({
wallet: String(row.wallet || ""),
committedRefundSol: Number(row.total || 0),
builderBondRefundSol: 0,
totalRefundSol: Number(row.total || 0),
txSignature: null,
refundedSolActual: 0,
}));

const shouldRefundBuilderBond =
String(parsedLaunch.template || "") === "builder" &&
Number(parsedLaunch.builder_bond_sol || 0) > 0 &&
Number(parsedLaunch.builder_bond_refunded || 0) !== 1 &&
hasCollectedBuilderBond(parsedLaunch) &&
builder?.wallet;

if (shouldRefundBuilderBond) {
const builderWallet = String(builder.wallet);
const existing = refunds.find((x) => x.wallet === builderWallet);

if (existing) {
existing.builderBondRefundSol = Number(parsedLaunch.builder_bond_sol || 0);
existing.totalRefundSol += Number(parsedLaunch.builder_bond_sol || 0);
} else {
refunds.push({
wallet: builderWallet,
committedRefundSol: 0,
builderBondRefundSol: Number(parsedLaunch.builder_bond_sol || 0),
totalRefundSol: Number(parsedLaunch.builder_bond_sol || 0),
txSignature: null,
refundedSolActual: 0,
});
}
}

for (const refund of refunds) {
if (!refund.wallet || Number(refund.totalRefundSol || 0) <= 0) continue;

const refundTransfer = await sendRefundTransfer({
destinationWallet: refund.wallet,
solAmount: refund.totalRefundSol,
});

if (!refundTransfer) continue;

refund.txSignature = refundTransfer.signature;
refund.refundedSolActual = refundTransfer.refundedSol;
}

if (shouldRefundBuilderBond) {
await db.run(
`
UPDATE launches
SET builder_bond_refunded = 1,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launchId]
);
}

await db.run(
`
DELETE FROM commits
WHERE launch_id = ?
`,
[launchId]
);

await syncLaunchStats(launchId);

await db.run(
`
UPDATE launches
SET status = 'failed_refunded',
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launchId]
);

launch = await getLaunchById(launchId);

return {
launch,
refunds,
};
}

async function finalizeLaunchIfReady(launchId) {
let launch = await getLaunchById(launchId);
if (!launch || launch.status !== "countdown") {
return launch;
}

const countdownCheck = await db.get(
`
SELECT CASE
WHEN countdown_ends_at IS NOT NULL AND datetime('now') >= datetime(countdown_ends_at)
THEN 1 ELSE 0
END AS ready
FROM launches
WHERE id = ?
`,
[launchId]
);

if (!countdownCheck || Number(countdownCheck.ready) !== 1) {
return launch;
}

const result = await finalizeLaunch(launchId);

if (result?.ok) {
return getLaunchById(launchId);
}

return getLaunchById(launchId);
}

export async function reconcileLaunchState(launchId) {
let launch = await getLaunchById(launchId);
if (!launch) return null;

if (
String(launch.template || "") === "builder" &&
["commit", "countdown"].includes(String(launch.status || "")) &&
!isBuilderBondSatisfied(launch)
) {
await markLaunchFailed(launchId);
const refunded = await autoRefundFailedLaunch(launchId);
return refunded?.launch || getLaunchById(launchId);
}

if (launch.status === "commit") {
const stats = await syncLaunchStats(launchId);
launch = await getLaunchById(launchId);

const minRaise = Number(launch.min_raise_sol || 0);
const hardCap = Number(launch.hard_cap_sol || 0);

const commitExpiredCheck = await db.get(
`
SELECT CASE
WHEN commit_ends_at IS NOT NULL AND datetime('now') >= datetime(commit_ends_at)
THEN 1 ELSE 0
END AS expired
FROM launches
WHERE id = ?
`,
[launchId]
);

const commitExpired = Number(commitExpiredCheck?.expired || 0) === 1;

if (Number(stats.totalCommitted) >= hardCap && hardCap > 0) {
return beginCountdown(launchId);
}

if (commitExpired) {
if (Number(stats.totalCommitted) >= minRaise && minRaise > 0) {
return beginCountdown(launchId);
}

await markLaunchFailed(launchId);
const refunded = await autoRefundFailedLaunch(launchId);
return refunded?.launch || getLaunchById(launchId);
}

return launch;
}

if (launch.status === "countdown") {
return finalizeLaunchIfReady(launchId);
}

if (launch.status === "failed") {
return launch;
}

return launch;
}

async function reconcileActiveLaunchesWorker() {
try {
const rows = await db.all(
`
SELECT id
FROM launches
WHERE status IN ('commit', 'countdown')
ORDER BY id ASC
`
);

for (const row of rows) {
try {
await reconcileLaunchState(Number(row.id));
} catch (err) {
console.error(`Launch reconcile worker failed for launch ${row.id}:`, err);
}
}
} catch (err) {
console.error("Launch reconcile worker tick failed:", err);
}
}

function startLaunchReconcileWorker() {
if (globalThis.__mssLaunchReconcileWorkerStarted) return;
globalThis.__mssLaunchReconcileWorkerStarted = true;

setTimeout(() => {
void reconcileActiveLaunchesWorker();
}, 3000);

setInterval(() => {
void reconcileActiveLaunchesWorker();
}, RECONCILE_INTERVAL_MS);
}

router.post("/prepare-builder-bond", async (req, res) => {
try {
const wallet = cleanText(req.body.wallet, 100);
const builderBondSol = Number(
req.body.builderBondSol ?? req.body.builder_bond_sol
);

if (!wallet || !Number.isFinite(builderBondSol)) {
return res.status(400).json({ ok: false, error: "missing or invalid fields" });
}

if (builderBondSol < MIN_BUILDER_BOND_SOL) {
return res.status(400).json({
ok: false,
error: `builder bond must be at least ${MIN_BUILDER_BOND_SOL} SOL`,
});
}

const prepared = await buildEscrowTransferTransaction({
wallet,
solAmount: builderBondSol,
reference: buildBuilderBondReference(wallet),
});

return res.json({
ok: true,
wallet,
builderBondSol,
...prepared,
});
} catch (err) {
console.error("POST /api/launcher/prepare-builder-bond failed:", err);
return res.status(500).json({
ok: false,
error: err.message || "failed to prepare builder bond",
});
}
});

router.post("/confirm-builder-bond", async (req, res) => {
try {
const wallet = cleanText(req.body.wallet, 100);
const builderBondSol = Number(
req.body.builderBondSol ?? req.body.builder_bond_sol
);
const txSignatureInput = cleanText(req.body.txSignature, 140);
const signedTransactionBase64 = cleanText(
req.body.signedTransaction ?? req.body.signedBase64 ?? req.body.signedTx,
50000
);

if (
!wallet ||
!Number.isFinite(builderBondSol) ||
(!txSignatureInput && !signedTransactionBase64)
) {
return res.status(400).json({ ok: false, error: "missing or invalid fields" });
}

if (builderBondSol < MIN_BUILDER_BOND_SOL) {
return res.status(400).json({
ok: false,
error: `builder bond must be at least ${MIN_BUILDER_BOND_SOL} SOL`,
});
}

let txSignature = txSignatureInput;

if (!txSignature) {
const connection = new Connection(getRpcUrl(), "confirmed");
const rawSignedTx = Buffer.from(signedTransactionBase64, "base64");

try {
const decodedTx = Transaction.from(rawSignedTx);
const sigBuf = decodedTx.signatures?.[0]?.signature;
if (sigBuf) {
txSignature = bs58.encode(sigBuf);
}
} catch {
// ignore extraction failure; sendRawTransaction below is source of truth
}

try {
txSignature = await connection.sendRawTransaction(rawSignedTx, {
skipPreflight: false,
preflightCommitment: "confirmed",
});
} catch (sendErr) {
if (isLikelyBlockhashExpiredError(sendErr)) {
return res.status(409).json({
ok: false,
error: "builder bond approval expired. please prepare and approve the builder bond again",
});
}
throw sendErr;
}

const confirmation = await connection.confirmTransaction(txSignature, "confirmed");
if (confirmation?.value?.err) {
throw new Error("signed builder bond transaction confirmation failed");
}
}

const existingLaunch = await db.get(
`SELECT id FROM launches WHERE builder_bond_tx_signature = ? LIMIT 1`,
[txSignature]
);

if (existingLaunch) {
return res.status(400).json({
ok: false,
error: "builder bond transaction already attached to another launch",
});
}

await verifyCommitTransfer({
txSignature,
expectedSender: wallet,
expectedDestination: getEscrowWallet(),
expectedLamports: solToLamports(builderBondSol),
reference: buildBuilderBondReference(wallet),
});

return res.json({
ok: true,
wallet,
builderBondSol,
txSignature,
builderBondPaid: 1,
});
} catch (err) {
console.error("POST /api/launcher/confirm-builder-bond failed:", err);
return res.status(400).json({
ok: false,
error: err.message || "builder bond verification failed",
});
}
});

router.post("/create", async (req, res) => {
try {
const wallet = cleanText(req.body.wallet, 100);
const template = cleanText(req.body.template, 40);
const tokenName = cleanText(req.body.token_name, 60);
const symbol = cleanSymbol(req.body.symbol, 20);
const description = cleanText(req.body.description, 500);
const imageUrl = cleanText(req.body.image_url, 500);
const builderBondTxSignature = cleanText(
req.body.builder_bond_tx_signature ?? req.body.builderBondTxSignature,
140
);

if (!wallet) {
return res.status(400).json({ ok: false, error: "wallet is required" });
}

if (!template) {
return res.status(400).json({ ok: false, error: "template is required" });
}

if (!tokenName) {
return res.status(400).json({ ok: false, error: "token_name is required" });
}

if (!symbol) {
return res.status(400).json({ ok: false, error: "symbol is required" });
}

const builder = await getBuilderByWallet(wallet);

if (!builder) {
return res.status(404).json({
ok: false,
error: "builder profile not found",
});
}

const cfg = getTemplateConfig(template);
const builderCfg = shapeBuilderConfig(template, req.body);

try {
validateBuilderConfig(template, cfg, builderCfg);
} catch (validationErr) {
return res.status(400).json({
ok: false,
error: validationErr.message,
});
}

let builderBondPaid = 0;
let finalBuilderBondTxSignature = "";

if (template === "builder") {
if (!builderBondTxSignature) {
return res.status(400).json({
ok: false,
error: "builder bond transaction is required for builder launches",
});
}

const existingLaunchWithBondTx = await db.get(
`SELECT id FROM launches WHERE builder_bond_tx_signature = ? LIMIT 1`,
[builderBondTxSignature]
);

if (existingLaunchWithBondTx) {
return res.status(400).json({
ok: false,
error: "builder bond transaction already used by another launch",
});
}

await verifyCommitTransfer({
txSignature: builderBondTxSignature,
expectedSender: wallet,
expectedDestination: getEscrowWallet(),
expectedLamports: solToLamports(builderCfg.builder_bond_sol),
reference: buildBuilderBondReference(wallet),
});

builderBondPaid = 1;
finalBuilderBondTxSignature = builderBondTxSignature;
}

const result = await db.run(
`
INSERT INTO launches (
builder_id,
launch_type,
template,
token_name,
symbol,
description,
image_url,
supply,
min_raise_sol,
hard_cap_sol,
launch_fee_pct,
liquidity_pct,
participants_pct,
reserve_pct,
builder_pct,
team_allocation_pct,
team_wallets,
team_wallet_breakdown,
builder_bond_sol,
builder_bond_refunded,
builder_bond_paid,
builder_bond_tx_signature,
commit_started_at,
commit_ends_at,
countdown_started_at,
countdown_ends_at,
live_at,
failed_at,
committed_sol,
participants_count,
status
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, CURRENT_TIMESTAMP, datetime(CURRENT_TIMESTAMP, '+${COMMIT_PHASE_MINUTES} minutes'), NULL, NULL, NULL, NULL, 0, 0, 'commit')
`,
[
builder.id,
cfg.launch_type,
template,
tokenName,
symbol,
description,
imageUrl,
template === "builder"
? normalizeSupply(req.body.supply, cfg.supply)
: cfg.supply,
cfg.min_raise_sol,
cfg.hard_cap_sol,
5,
cfg.liquidity_pct,
cfg.participants_pct,
cfg.reserve_pct,
cfg.builder_pct,
builderCfg.team_allocation_pct,
JSON.stringify(builderCfg.team_wallets),
JSON.stringify(builderCfg.team_wallet_breakdown),
builderCfg.builder_bond_sol,
builderBondPaid,
finalBuilderBondTxSignature,
]
);

const launch = await getLaunchById(result.lastID);

return res.json({
ok: true,
launch: parseLaunchJsonFields(launch),
builderConfig: builderCfg,
});
} catch (err) {
console.error("POST /api/launcher/create failed:", err);
return res.status(500).json({ ok: false, error: err.message || "internal server error" });
}
});

router.post("/prepare-commit", async (req, res) => {
try {
const launchId = Number(req.body.launchId);
const wallet = cleanText(req.body.wallet, 100);
const solAmount = Number(req.body.solAmount);

if (!launchId || !wallet || !Number.isFinite(solAmount)) {
return res.status(400).json({ ok: false, error: "missing or invalid fields" });
}

if (solAmount <= 0) {
return res.status(400).json({ ok: false, error: "solAmount must be greater than 0" });
}

let launch = await reconcileLaunchState(launchId);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (launch.status !== "commit") {
return res.status(400).json({ ok: false, error: "commit phase closed" });
}

if (!isBuilderBondSatisfied(launch)) {
return res.status(400).json({ ok: false, error: "builder bond not satisfied" });
}

const existing = await db.get(
`
SELECT COALESCE(SUM(sol_amount), 0) AS total
FROM commits
WHERE launch_id = ? AND wallet = ?
`,
[launchId, wallet]
);

const currentWalletTotal = Number(existing?.total || 0);

if (currentWalletTotal + solAmount > MAX_WALLET_COMMIT_SOL) {
return res.status(400).json({
ok: false,
error: `max commit per wallet is ${MAX_WALLET_COMMIT_SOL} SOL`,
});
}

const currentLaunchTotal = Number(launch.committed_sol || 0);
const hardCap = Number(launch.hard_cap_sol || 0);

if (currentLaunchTotal + solAmount > hardCap) {
return res.status(400).json({
ok: false,
error: "hard cap reached",
});
}

const reference = `mss-launch-${launchId}`;

const prepared = await buildEscrowTransferTransaction({
wallet,
solAmount,
reference,
});

return res.json({
ok: true,
launchId,
wallet,
...prepared,
maxWalletCommitSol: MAX_WALLET_COMMIT_SOL,
currentWalletCommitted: currentWalletTotal,
remainingWalletCommit: Math.max(0, MAX_WALLET_COMMIT_SOL - currentWalletTotal),
status: launch.status,
commitEndsAt: launch.commit_ends_at || null,
});
} catch (err) {
console.error("POST /api/launcher/prepare-commit failed:", err);
return res.status(500).json({ ok: false, error: err.message || "failed to prepare commit" });
}
});

router.post("/confirm-commit", async (req, res) => {
try {
const launchId = Number(req.body.launchId);
const wallet = cleanText(req.body.wallet, 100);
const solAmount = Number(req.body.solAmount);
const txSignatureInput = cleanText(req.body.txSignature, 140);
const signedTransactionBase64 = cleanText(
req.body.signedTransaction ?? req.body.signedBase64 ?? req.body.signedTx,
50000
);

if (
!launchId ||
!wallet ||
!Number.isFinite(solAmount) ||
(!txSignatureInput && !signedTransactionBase64)
) {
return res.status(400).json({ ok: false, error: "missing or invalid fields" });
}

if (solAmount <= 0) {
return res.status(400).json({ ok: false, error: "solAmount must be greater than 0" });
}

const txWasAlreadySentByWallet = Boolean(txSignatureInput);
let launch = await reconcileLaunchState(launchId);

if (!launch && !txWasAlreadySentByWallet) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (launch && launch.status !== "commit" && !txWasAlreadySentByWallet) {
return res.status(400).json({ ok: false, error: "commit phase closed" });
}

if (launch && !isBuilderBondSatisfied(launch) && !txWasAlreadySentByWallet) {
return res.status(400).json({ ok: false, error: "builder bond not satisfied" });
}

let txSignature = txSignatureInput;

if (!txSignature) {
const existing = await db.get(
`
SELECT COALESCE(SUM(sol_amount), 0) AS total
FROM commits
WHERE launch_id = ? AND wallet = ?
`,
[launchId, wallet]
);

const currentWalletTotal = Number(existing?.total || 0);

if (currentWalletTotal + solAmount > MAX_WALLET_COMMIT_SOL) {
return res.status(400).json({
ok: false,
error: `max commit per wallet is ${MAX_WALLET_COMMIT_SOL} SOL`,
});
}

const currentLaunchTotal = Number(launch?.committed_sol || 0);
const hardCap = Number(launch?.hard_cap_sol || 0);

if (currentLaunchTotal + solAmount > hardCap) {
return res.status(400).json({
ok: false,
error: "hard cap reached",
});
}

const connection = new Connection(getRpcUrl(), "confirmed");
const rawSignedTx = Buffer.from(signedTransactionBase64, "base64");

try {
txSignature = await connection.sendRawTransaction(rawSignedTx, {
skipPreflight: false,
preflightCommitment: "confirmed",
});
} catch (sendErr) {
if (isLikelyBlockhashExpiredError(sendErr)) {
return res.status(409).json({
ok: false,
error: "commit approval expired. please prepare the commit again",
});
}
throw sendErr;
}

const confirmation = await connection.confirmTransaction(txSignature, "confirmed");
if (confirmation?.value?.err) {
throw new Error("signed transaction confirmation failed");
}
}

const reusedTx = await db.get(
`
SELECT id FROM commits
WHERE tx_signature = ?
LIMIT 1
`,
[txSignature]
);

if (reusedTx) {
return res.status(400).json({ ok: false, error: "transaction already used" });
}

const escrowWallet = getEscrowWallet();
const expectedLamports = solToLamports(solAmount);

await verifyCommitTransfer({
txSignature,
expectedSender: wallet,
expectedDestination: escrowWallet,
expectedLamports,
reference: `mss-launch-${launchId}`,
});

launch = await reconcileLaunchState(launchId);

if (!launch) {
const refunded = await refundRejectedCommit({
wallet,
solAmount,
txSignature,
reason: "launch not found after transfer verification",
logLabel: "Late confirm refund failed after missing launch",
});
return res.status(refunded.httpStatus).json(refunded.body);
}

if (launch.status !== "commit") {
const refunded = await refundRejectedCommit({
wallet,
solAmount,
txSignature,
reason: "commit phase closed before confirmation completed",
status: launch.status,
logLabel: "Late confirm refund failed after commit phase closure",
});
return res.status(refunded.httpStatus).json(refunded.body);
}

if (!isBuilderBondSatisfied(launch)) {
const refunded = await refundRejectedCommit({
wallet,
solAmount,
txSignature,
reason: "builder bond no longer satisfied",
status: launch.status,
logLabel: "Late confirm refund failed after builder bond check",
});
return res.status(refunded.httpStatus).json(refunded.body);
}

const existing = await db.get(
`
SELECT COALESCE(SUM(sol_amount), 0) AS total
FROM commits
WHERE launch_id = ? AND wallet = ?
`,
[launchId, wallet]
);

const currentWalletTotal = Number(existing?.total || 0);

if (currentWalletTotal + solAmount > MAX_WALLET_COMMIT_SOL) {
const refunded = await refundRejectedCommit({
wallet,
solAmount,
txSignature,
reason: `max commit per wallet is ${MAX_WALLET_COMMIT_SOL} SOL`,
status: launch.status,
logLabel: "Late confirm refund failed after wallet max check",
});
return res.status(refunded.httpStatus).json(refunded.body);
}

const currentLaunchTotal = Number(launch.committed_sol || 0);
const hardCap = Number(launch.hard_cap_sol || 0);

if (currentLaunchTotal + solAmount > hardCap) {
const refunded = await refundRejectedCommit({
wallet,
solAmount,
txSignature,
reason: "hard cap reached before confirmation completed",
status: launch.status,
logLabel: "Late confirm refund failed after hard cap check",
});
return res.status(refunded.httpStatus).json(refunded.body);
}

await db.run(
`
INSERT INTO commits (
launch_id,
wallet,
sol_amount,
tx_signature,
tx_status,
verified_at
) VALUES (?, ?, ?, ?, 'confirmed', CURRENT_TIMESTAMP)
`,
[launchId, wallet, solAmount, txSignature]
);

const stats = await syncLaunchStats(launchId);
let updatedLaunch = await getLaunchById(launchId);

if (
Number(stats.totalCommitted) >= Number(updatedLaunch.hard_cap_sol || 0) &&
Number(updatedLaunch.hard_cap_sol || 0) > 0 &&
updatedLaunch.status === "commit"
) {
updatedLaunch = await beginCountdown(launchId);
} else {
updatedLaunch = await reconcileLaunchState(launchId);
}

return res.json({
ok: true,
launchId,
wallet,
txSignature,
walletCommittedTotal: currentWalletTotal + solAmount,
totalCommitted: stats.totalCommitted,
participants: stats.participants,
minRaise: Number(updatedLaunch.min_raise_sol),
hardCap: Number(updatedLaunch.hard_cap_sol),
commitPercent: buildCommitPercent(
stats.totalCommitted,
updatedLaunch.hard_cap_sol
),
status: updatedLaunch.status,
commitEndsAt: updatedLaunch.commit_ends_at || null,
countdownEndsAt: updatedLaunch.countdown_ends_at || null,
});
} catch (err) {
console.error("POST /api/launcher/confirm-commit failed:", err);
return res.status(400).json({ ok: false, error: err.message || "commit verification failed" });
}
});

router.post("/commit", async (_req, res) => {
return res.status(410).json({
ok: false,
error: "direct commit is deprecated. use prepare-commit and confirm-commit",
});
});

router.post("/refund", async (req, res) => {
try {
const launchId = Number(req.body.launchId);
const wallet = cleanText(req.body.wallet, 100);

if (!launchId || !wallet) {
return res.status(400).json({
ok: false,
error: "launchId and wallet are required",
});
}

let launch = await reconcileLaunchState(launchId);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (!["commit", "failed"].includes(launch.status)) {
return res.status(400).json({
ok: false,
error: "refunds are only allowed during commit phase or after a failed launch",
});
}

const walletCommit = await db.get(
`
SELECT COALESCE(SUM(sol_amount), 0) AS total
FROM commits
WHERE launch_id = ? AND wallet = ?
`,
[launchId, wallet]
);

let refundAmount = Number(walletCommit?.total || 0);
let builderBondRefunded = 0;

const parsedLaunch = parseLaunchJsonFields(launch);

if (
launch.status === "failed" &&
String(parsedLaunch.template || "") === "builder" &&
Number(parsedLaunch.builder_bond_sol || 0) > 0 &&
Number(parsedLaunch.builder_bond_refunded || 0) !== 1 &&
hasCollectedBuilderBond(parsedLaunch)
) {
const builder = await getBuilderWalletForLaunch(launchId);

if (builder?.wallet === wallet) {
refundAmount += Number(parsedLaunch.builder_bond_sol || 0);
builderBondRefunded = Number(parsedLaunch.builder_bond_sol || 0);

await db.run(
`
UPDATE launches
SET builder_bond_refunded = 1,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launchId]
);
}
}

if (refundAmount <= 0) {
return res.status(400).json({ ok: false, error: "nothing to refund" });
}

const refundTransfer = await sendRefundTransfer({
destinationWallet: wallet,
solAmount: refundAmount,
});

await db.run(
`
DELETE FROM commits
WHERE launch_id = ? AND wallet = ?
`,
[launchId, wallet]
);

const stats = await syncLaunchStats(launchId);
launch = await getLaunchById(launchId);

return res.json({
ok: true,
launchId,
wallet,
refundedSol: refundAmount,
refundedSolActual: refundTransfer?.refundedSol || 0,
builderBondRefunded,
refundTxSignature: refundTransfer?.signature || null,
totalCommitted: stats.totalCommitted,
participants: stats.participants,
commitPercent: buildCommitPercent(
stats.totalCommitted,
launch.hard_cap_sol
),
status: launch.status,
});
} catch (err) {
console.error("POST /api/launcher/refund failed:", err);
return res.status(500).json({ ok: false, error: err.message || "refund failed" });
}
});

router.post("/:id/start-countdown", async (req, res) => {
try {
const launchId = Number(req.params.id);
let launch = await reconcileLaunchState(launchId);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (launch.status !== "commit") {
return res.status(400).json({
ok: false,
error: "countdown can only start from commit phase",
});
}

if (!isBuilderBondSatisfied(launch)) {
return res.status(400).json({ ok: false, error: "builder bond not satisfied" });
}

if (Number(launch.min_raise_sol) <= 0) {
return res.status(400).json({ ok: false, error: "invalid minimum raise" });
}

if (Number(launch.hard_cap_sol) <= Number(launch.min_raise_sol)) {
return res.status(400).json({
ok: false,
error: "hard cap must be greater than minimum raise",
});
}

const stats = await syncLaunchStats(launchId);
const minRaise = Number(launch.min_raise_sol);

if (stats.totalCommitted < minRaise) {
return res.status(400).json({
ok: false,
error: "min raise not reached",
});
}

const updatedLaunch = await beginCountdown(launchId);

return res.json({
ok: true,
launchId,
status: updatedLaunch.status,
countdownStartedAt: updatedLaunch.countdown_started_at,
countdownEndsAt: updatedLaunch.countdown_ends_at,
totalCommitted: stats.totalCommitted,
participants: stats.participants,
commitPercent: buildCommitPercent(
stats.totalCommitted,
updatedLaunch.hard_cap_sol
),
});
} catch (err) {
console.error("POST /api/launcher/:id/start-countdown failed:", err);
return res.status(500).json({ ok: false, error: err.message || "failed to start countdown" });
}
});

router.post("/:id/cancel-countdown", async (req, res) => {
try {
const launchId = Number(req.params.id);
const launch = await getLaunchById(launchId);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (launch.status !== "countdown") {
return res.status(400).json({ ok: false, error: "launch is not in countdown" });
}

const commitStillOpenCheck = await db.get(
`
SELECT CASE
WHEN commit_ends_at IS NOT NULL AND datetime('now') < datetime(commit_ends_at)
THEN 1 ELSE 0
END AS still_open
FROM launches
WHERE id = ?
`,
[launchId]
);

if (Number(commitStillOpenCheck?.still_open || 0) !== 1) {
return res.status(400).json({
ok: false,
error: "commit window has already expired",
});
}

await db.run(
`
UPDATE launches
SET status = 'commit',
countdown_started_at = NULL,
countdown_ends_at = NULL,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launchId]
);

const updatedLaunch = await getLaunchById(launchId);

return res.json({
ok: true,
launchId,
status: updatedLaunch.status,
commitEndsAt: updatedLaunch.commit_ends_at || null,
});
} catch (err) {
console.error("POST /api/launcher/:id/cancel-countdown failed:", err);
return res.status(500).json({ ok: false, error: "failed to cancel countdown" });
}
});

router.post("/:id/finalize", async (req, res) => {
try {
const launchId = Number(req.params.id);
const launch = await reconcileLaunchState(launchId);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (launch.status !== "live") {
return res.status(400).json({ ok: false, error: "launch is not ready to finalize" });
}

const stats = await syncLaunchStats(launchId);
const updatedLaunch = await getLaunchById(launchId);
const feeBreakdown = buildFeeBreakdown(
Number(stats.totalCommitted),
Number(updatedLaunch.launch_fee_pct || 5)
);

return res.json({
ok: true,
launchId,
status: updatedLaunch.status,
liveAt: updatedLaunch.live_at || null,
totalCommitted: stats.totalCommitted,
participants: stats.participants,
commitPercent: buildCommitPercent(
stats.totalCommitted,
updatedLaunch.hard_cap_sol
),
feeBreakdown,
});
} catch (err) {
console.error("POST /api/launcher/:id/finalize failed:", err);
return res.status(400).json({
ok: false,
error: err.message || "finalize failed",
});
}
});

router.get("/list", async (_req, res) => {
try {
const rows = await db.all(
`
SELECT
l.*,
b.wallet AS builder_wallet,
b.alias AS builder_alias,
b.builder_score
FROM launches l
JOIN builders b ON b.id = l.builder_id
ORDER BY l.id DESC
`
);

const shaped = rows
.filter(
(row) =>
isBuilderBondSatisfied(row) || String(row.template || "") !== "builder"
)
.map(shapeLaunchForList);

const visible = shaped.filter((x) => x.status !== "failed_refunded");

const grouped = {
commit: visible.filter((x) => x.status === "commit"),
countdown: visible.filter((x) => x.status === "countdown"),
live: visible.filter((x) => x.status === "live"),
failed: visible.filter((x) => x.status === "failed"),
};

return res.json({
ok: true,
launches: grouped,
all: visible,
history: shaped,
});
} catch (err) {
console.error("GET /api/launcher/list failed:", err);
return res.status(500).json({ ok: false, error: err.message || "failed to fetch launches" });
}
});

router.get("/commits/:launchId", async (req, res) => {
try {
const launchId = Number(req.params.launchId);

if (!launchId) {
return res.status(400).json({ ok: false, error: "invalid launchId" });
}

const launch = await getLaunchById(launchId);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

const parsedLaunch = parseLaunchJsonFields(launch);
const stats = await getCommitStats(launchId);

const recent = await db.all(
`
SELECT wallet, sol_amount, created_at, tx_signature, tx_status, verified_at
FROM commits
WHERE launch_id = ?
ORDER BY id DESC
LIMIT 25
`,
[launchId]
);

return res.json({
ok: true,
launchId,
status: parsedLaunch.status,
minRaise: Number(parsedLaunch.min_raise_sol),
hardCap: Number(parsedLaunch.hard_cap_sol),
totalCommitted: stats.totalCommitted,
participants: stats.participants,
commitPercent: buildCommitPercent(
stats.totalCommitted,
parsedLaunch.hard_cap_sol
),
commitStartedAt: parsedLaunch.commit_started_at || null,
commitEndsAt: parsedLaunch.commit_ends_at || null,
countdownStartedAt: parsedLaunch.countdown_started_at || null,
countdownEndsAt: parsedLaunch.countdown_ends_at || null,
failedAt: parsedLaunch.failed_at || null,
teamAllocationPct: Number(parsedLaunch.team_allocation_pct || 0),
teamWallets: parsedLaunch.team_wallets,
teamWalletBreakdown: parsedLaunch.team_wallet_breakdown,
builderBondSol: Number(parsedLaunch.builder_bond_sol || 0),
builderBondRefunded: Number(parsedLaunch.builder_bond_refunded || 0),
builderBondPaid: Number(parsedLaunch.builder_bond_paid || 0),
recent,
});
} catch (err) {
console.error("GET /api/launcher/commits/:launchId failed:", err);
return res.status(500).json({ ok: false, error: "failed to fetch commit stats" });
}
});

router.post("/:id/execute", async (req, res) => {
try {
const launchId = Number(req.params.id);
const launch = await reconcileLaunchState(launchId);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (launch.status !== "live") {
return res.status(400).json({
ok: false,
error: "launch must be live before allocations can be built",
});
}

const stats = await syncLaunchStats(launchId);
const allocationResult = await buildLaunchAllocations(launchId);
const feeBreakdown = buildFeeBreakdown(
Number(stats.totalCommitted),
Number(launch.launch_fee_pct || 5)
);

const updatedLaunch = parseLaunchJsonFields(await getLaunchById(launchId));

return res.json({
ok: true,
execution: allocationResult,
feeBreakdown,
launch: updatedLaunch,
});
} catch (err) {
console.error("POST /api/launcher/:id/execute failed:", err);
return res.status(400).json({ ok: false, error: err.message });
}
});

router.get("/:id/allocations", async (req, res) => {
try {
const launchId = Number(req.params.id);

const rows = await db.all(
`SELECT * FROM allocations WHERE launch_id = ? ORDER BY id ASC`,
[launchId]
);

return res.json({ ok: true, allocations: rows });
} catch (err) {
console.error("GET /api/launcher/:id/allocations failed:", err);
return res.status(500).json({ ok: false, error: "internal server error" });
}
});

router.get("/:id", async (req, res) => {
try {
const id = Number(req.params.id);

const launch = await db.get(
`
SELECT
l.*,
b.wallet AS builder_wallet,
b.alias AS builder_alias,
b.builder_score
FROM launches l
JOIN builders b ON b.id = l.builder_id
WHERE l.id = ?
`,
[id]
);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (!isBuilderBondSatisfied(launch)) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

const parsedLaunch = parseLaunchJsonFields(launch);

return res.json({
ok: true,
launch: {
...parsedLaunch,
commitPercent: buildCommitPercent(
parsedLaunch.committed_sol,
parsedLaunch.hard_cap_sol
),
},
});
} catch (err) {
console.error("GET /api/launcher/:id failed:", err);
return res.status(500).json({ ok: false, error: "internal server error" });
}
});

startLaunchReconcileWorker();

export default router;