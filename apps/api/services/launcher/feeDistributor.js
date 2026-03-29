import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

const FEE_SPLIT = {
core: 0.5,
buyback: 0.3,
treasury: 0.2,
};

const LAMPORTS_PER_SOL = 1_000_000_000;
const ESCROW_FEE_BUFFER_LAMPORTS = 10000;

const RPC_COMMITMENT = "confirmed";
const RPC_RETRY_ATTEMPTS = 4;
const RPC_RETRY_DELAY_MS = 1200;
const CONFIRM_TIMEOUT_MS = 60000;

function clean(value, max = 5000) {
return String(value ?? "").trim().slice(0, max);
}

function safeNum(value, fallback = 0) {
const n = Number(value);
return Number.isFinite(n) ? n : fallback;
}

function solToLamports(solAmount) {
const sol = Number(solAmount);
if (!Number.isFinite(sol) || sol <= 0) return 0;
return Math.round(sol * LAMPORTS_PER_SOL);
}

function lamportsToSol(lamports) {
const n = Number(lamports);
if (!Number.isFinite(n) || n <= 0) return 0;
return n / LAMPORTS_PER_SOL;
}

function sleep(ms) {
return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRpcUrl() {
return (
clean(process.env.SOLANA_RPC, 1000) ||
clean(process.env.RPC_URL, 1000) ||
"https://api.devnet.solana.com"
);
}

function getRequiredWallet(envName) {
const value = clean(process.env[envName], 200);
if (!value) {
throw new Error(`${envName} is not configured`);
}
return value;
}

function getEscrowKeypair() {
const raw = clean(process.env.ESCROW_PRIVATE_KEY, 10000);
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

function assertValidPublicKey(wallet, label) {
try {
return new PublicKey(wallet);
} catch (err) {
throw new Error(`${label} is invalid: ${err?.message || err}`);
}
}

function buildConnection() {
return new Connection(getRpcUrl(), {
commitment: RPC_COMMITMENT,
confirmTransactionInitialTimeout: CONFIRM_TIMEOUT_MS,
});
}

async function withRpcRetry(label, fn, attempts = RPC_RETRY_ATTEMPTS) {
let lastError = null;

for (let i = 1; i <= attempts; i += 1) {
try {
return await fn();
} catch (err) {
lastError = err;
const isLast = i >= attempts;

console.warn(
`[feeDistributor] ${label} attempt ${i}/${attempts} failed:`,
err?.message || err
);

if (isLast) break;
await sleep(RPC_RETRY_DELAY_MS * i);
}
}

throw new Error(
`${label} failed after ${attempts} attempts: ${lastError?.message || lastError}`
);
}

async function getLatestBlockhashWithRetry(connection) {
return withRpcRetry("getLatestBlockhash", async () => {
return connection.getLatestBlockhash(RPC_COMMITMENT);
});
}

async function getBalanceWithRetry(connection, pubkey) {
return withRpcRetry("getBalance", async () => {
return connection.getBalance(pubkey, RPC_COMMITMENT);
});
}

async function sendTransactionWithRetry(connection, tx, signer) {
return withRpcRetry("sendTransaction", async () => {
return connection.sendTransaction(tx, [signer], {
skipPreflight: false,
preflightCommitment: RPC_COMMITMENT,
maxRetries: 3,
});
});
}

async function confirmTransactionWithRetry(connection, confirmationPayload) {
return withRpcRetry("confirmTransaction", async () => {
const confirmation = await connection.confirmTransaction(
confirmationPayload,
RPC_COMMITMENT
);

if (confirmation?.value?.err) {
throw new Error(
`transfer confirmation failed: ${JSON.stringify(confirmation.value.err)}`
);
}

return confirmation;
});
}

async function sendLamports({
connection,
signer,
destinationWallet,
lamports,
}) {
if (!Number.isFinite(lamports) || lamports <= 0) {
return null;
}

const toPubkey = new PublicKey(destinationWallet);
const { blockhash, lastValidBlockHeight } =
await getLatestBlockhashWithRetry(connection);

const tx = new Transaction({
feePayer: signer.publicKey,
recentBlockhash: blockhash,
}).add(
SystemProgram.transfer({
fromPubkey: signer.publicKey,
toPubkey,
lamports,
})
);

const signature = await sendTransactionWithRetry(connection, tx, signer);

await confirmTransactionWithRetry(connection, {
signature,
blockhash,
lastValidBlockHeight,
});

return signature;
}

export function buildLaunchFeeBreakdown(totalCommitted, launchFeePct = 5) {
const total = safeNum(totalCommitted, 0);
const feePct = safeNum(launchFeePct, 5);

const feeTotal = total * (feePct / 100);
const coreFee = feeTotal * FEE_SPLIT.core;
const buybackFee = feeTotal * FEE_SPLIT.buyback;
const treasuryFee = feeTotal * FEE_SPLIT.treasury;
const netRaiseAfterFee = total - feeTotal;

return {
totalCommitted: total,
launchFeePct: feePct,
feeTotal,
coreFee,
buybackFee,
treasuryFee,
netRaiseAfterFee,
};
}

function buildTransferPlan(breakdown) {
const coreWallet = getRequiredWallet("CORE_WALLET");
const buybackWallet = getRequiredWallet("BUYBACK_WALLET");
const treasuryWallet = getRequiredWallet("TREASURY_WALLET");

assertValidPublicKey(coreWallet, "CORE_WALLET");
assertValidPublicKey(buybackWallet, "BUYBACK_WALLET");
assertValidPublicKey(treasuryWallet, "TREASURY_WALLET");

const rawPlan = [
{
bucket: "core",
wallet: coreWallet,
solAmount: breakdown.coreFee,
lamports: solToLamports(breakdown.coreFee),
},
{
bucket: "buyback",
wallet: buybackWallet,
solAmount: breakdown.buybackFee,
lamports: solToLamports(breakdown.buybackFee),
},
{
bucket: "treasury",
wallet: treasuryWallet,
solAmount: breakdown.treasuryFee,
lamports: solToLamports(breakdown.treasuryFee),
},
];

const merged = new Map();

for (const item of rawPlan) {
if (item.lamports <= 0) continue;

const existing = merged.get(item.wallet);
if (existing) {
existing.lamports += item.lamports;
existing.solAmount = lamportsToSol(existing.lamports);
existing.buckets.push(item.bucket);
} else {
merged.set(item.wallet, {
wallet: item.wallet,
lamports: item.lamports,
solAmount: lamportsToSol(item.lamports),
buckets: [item.bucket],
});
}
}

return Array.from(merged.values());
}

export async function distributeLaunchFees({
totalCommitted,
launchFeePct = 5,
}) {
const breakdown = buildLaunchFeeBreakdown(totalCommitted, launchFeePct);

if (breakdown.feeTotal <= 0) {
return {
ok: true,
skipped: true,
reason: "no fees to distribute",
breakdown,
transfers: [],
};
}

const connection = buildConnection();
const signer = getEscrowKeypair();
const transferPlan = buildTransferPlan(breakdown);

if (!transferPlan.length) {
return {
ok: true,
skipped: true,
reason: "all fee buckets rounded to zero lamports",
breakdown,
transfers: [],
};
}

const escrowBalanceLamports = await getBalanceWithRetry(
connection,
signer.publicKey
);

const requiredLamports =
transferPlan.reduce((sum, row) => sum + row.lamports, 0) +
ESCROW_FEE_BUFFER_LAMPORTS;

if (escrowBalanceLamports < requiredLamports) {
throw new Error(
`escrow wallet lacks fee reserve for fee distribution: balance=${escrowBalanceLamports}, required=${requiredLamports}`
);
}

const transfers = [];

for (const row of transferPlan) {
const txSignature = await sendLamports({
connection,
signer,
destinationWallet: row.wallet,
lamports: row.lamports,
});

if (txSignature) {
transfers.push({
bucket: row.buckets.join("+"),
buckets: row.buckets,
wallet: row.wallet,
solAmount: row.solAmount,
lamports: row.lamports,
txSignature,
});
}
}

return {
ok: true,
skipped: false,
breakdown,
transfers,
};
}
