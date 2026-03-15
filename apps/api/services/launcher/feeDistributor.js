import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

const FEE_SPLIT = {
core: 0.5,
buyback: 0.3,
treasury: 0.2,
};

function clean(value, max = 5000) {
return String(value ?? "").trim().slice(0, max);
}

function safeNum(value, fallback = 0) {
const n = Number(value);
return Number.isFinite(n) ? n : fallback;
}

function solToLamports(solAmount) {
return Math.round(Number(solAmount) * 1_000_000_000);
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
return Keypair.fromSecretKey(Uint8Array.from(arr));
}
return Keypair.fromSecretKey(bs58.decode(raw));
} catch (err) {
throw new Error(`ESCROW_PRIVATE_KEY is invalid: ${err?.message || err}`);
}
}

async function sendSol({ connection, signer, destinationWallet, solAmount }) {
const lamports = solToLamports(solAmount);
if (!Number.isFinite(lamports) || lamports <= 0) {
return null;
}

const toPubkey = new PublicKey(destinationWallet);
const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

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

const signature = await connection.sendTransaction(tx, [signer], {
skipPreflight: false,
preflightCommitment: "confirmed",
});

const confirmation = await connection.confirmTransaction(
{ signature, blockhash, lastValidBlockHeight },
"confirmed"
);

if (confirmation?.value?.err) {
throw new Error(`transfer confirmation failed for ${destinationWallet}`);
}

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

const connection = new Connection(getRpcUrl(), "confirmed");
const signer = getEscrowKeypair();

const coreWallet = getRequiredWallet("CORE_WALLET");
const buybackWallet = getRequiredWallet("BUYBACK_WALLET");
const treasuryWallet = getRequiredWallet("TREASURY_WALLET");

const transfers = [];

const coreSig = await sendSol({
connection,
signer,
destinationWallet: coreWallet,
solAmount: breakdown.coreFee,
});
if (coreSig) {
transfers.push({
bucket: "core",
wallet: coreWallet,
solAmount: breakdown.coreFee,
txSignature: coreSig,
});
}

const buybackSig = await sendSol({
connection,
signer,
destinationWallet: buybackWallet,
solAmount: breakdown.buybackFee,
});
if (buybackSig) {
transfers.push({
bucket: "buyback",
wallet: buybackWallet,
solAmount: breakdown.buybackFee,
txSignature: buybackSig,
});
}

const treasurySig = await sendSol({
connection,
signer,
destinationWallet: treasuryWallet,
solAmount: breakdown.treasuryFee,
});
if (treasurySig) {
transfers.push({
bucket: "treasury",
wallet: treasuryWallet,
solAmount: breakdown.treasuryFee,
txSignature: treasurySig,
});
}

return {
ok: true,
skipped: false,
breakdown,
transfers,
};
}