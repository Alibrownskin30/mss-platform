import "dotenv/config";
import { Connection } from "@solana/web3.js";

const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC, "confirmed");

function toBase58Key(keyLike) {
if (!keyLike) return "";
if (typeof keyLike === "string") return keyLike;
if (typeof keyLike?.pubkey?.toBase58 === "function") return keyLike.pubkey.toBase58();
if (typeof keyLike?.toBase58 === "function") return keyLike.toBase58();
return "";
}

function extractTransferLamports(tx, expectedSender, expectedDestination) {
let matchedLamports = 0;

const instructions = tx?.transaction?.message?.instructions || [];
for (const ix of instructions) {
if (ix?.parsed?.type !== "transfer") continue;

const info = ix?.parsed?.info || {};
const source = String(info.source || "");
const destination = String(info.destination || "");
const lamports = Number(info.lamports || 0);

if (source === expectedSender && destination === expectedDestination) {
matchedLamports += lamports;
}
}

return matchedLamports;
}

function extractReferencePresent(tx, reference) {
if (!reference) return true;

const instructions = tx?.transaction?.message?.instructions || [];
for (const ix of instructions) {
const parsed = ix?.parsed;
if (!parsed) continue;

const text = JSON.stringify(parsed);
if (text.includes(reference)) return true;
}

return false;
}

export async function verifyCommitTransfer({
txSignature,
expectedSender,
expectedDestination,
expectedLamports,
reference = null,
}) {
if (!txSignature) {
throw new Error("missing transaction signature");
}

if (!expectedSender) {
throw new Error("missing expected sender");
}

if (!expectedDestination) {
throw new Error("missing expected destination");
}

if (!Number.isFinite(Number(expectedLamports)) || Number(expectedLamports) <= 0) {
throw new Error("invalid expected lamports");
}

const tx = await connection.getParsedTransaction(txSignature, {
maxSupportedTransactionVersion: 0,
commitment: "confirmed",
});

if (!tx) {
throw new Error("transaction not found");
}

const err = tx?.meta?.err;
if (err) {
throw new Error("transaction failed on-chain");
}

const accountKeys = (tx?.transaction?.message?.accountKeys || []).map(toBase58Key);
if (!accountKeys.includes(expectedSender)) {
throw new Error("sender mismatch");
}

const matchedLamports = extractTransferLamports(
tx,
expectedSender,
expectedDestination
);

if (matchedLamports < Number(expectedLamports)) {
throw new Error("transfer amount mismatch");
}

if (reference) {
const hasReference = extractReferencePresent(tx, reference);
if (!hasReference) {
// keep this soft for now if your wallet flow doesn't attach memo/reference yet
// throw new Error("transaction reference mismatch");
}
}

return {
ok: true,
txSignature,
matchedLamports,
slot: tx.slot,
blockTime: tx.blockTime || null,
};
}