// apps/api/cluster.js
import { PublicKey } from "@solana/web3.js";

/**
* Cluster Intelligence (MSS)
* Goal: Detect if top holders are likely linked via shared payer/funder fingerprint + new-wallet patterns.
*
* This is an on-chain heuristic (no external indexer required).
* It uses:
* - top holder owners (passed in)
* - recent signatures for each owner (small window)
* - parsed transaction fee payer (fingerprint)
* - approximate wallet "age" based on oldest signature in window
*/

// Conservative limits (to avoid hammering RPC)
const SIG_LIMIT = 12; // signatures per wallet
const PARSE_PER_WALLET = 2; // parse first successful txs (best-effort)
const MAX_WALLETS = 14; // analyze at most N unique owners from top holders
const NEW_WALLET_DAYS = 7; // within window considered "new-ish"

function nowMs() {
return Date.now();
}

function daysAgo(tsSec) {
return (nowMs() - tsSec * 1000) / (24 * 3600 * 1000);
}

function safeBase58(pk) {
try {
return new PublicKey(pk).toBase58();
} catch {
return null;
}
}

function buildScore({ total, clusteredCount, clusterCount, maxClusterSize, newWalletPct }) {
if (!total || total < 2) return 0;

// Core signal: biggest cluster share
const biggestShare = (maxClusterSize || 1) / total; // 0..1
let score = 0;

// Biggest cluster weight (0..70)
score += Math.min(70, Math.round((biggestShare - (1 / total)) * 80));

// Cluster count weight (0..20)
score += Math.min(20, clusterCount * 6);

// Clustered coverage weight (0..10)
const coverage = clusteredCount / total; // 0..1
score += Math.min(10, Math.round(coverage * 12));

// New wallet modifier (0..15)
score += Math.min(15, Math.round((newWalletPct / 100) * 18));

score = Math.max(0, Math.min(100, Math.round(score)));
return score;
}

function scoreLabel(score) {
if (score >= 70) return { label: "High Linkage", band: "high" };
if (score >= 35) return { label: "Moderate Linkage", band: "mid" };
return { label: "Low Linkage", band: "low" };
}

/**
* @param {object} args
* @param {import("@solana/web3.js").Connection} args.connection
* @param {function} args.rpcRetry - retry wrapper
* @param {string[]} args.owners - unique owners list
*/
export async function getClusterIntel({ connection, rpcRetry, owners }) {
const uniqueOwners = [...new Set((owners || []).map(safeBase58).filter(Boolean))].slice(0, MAX_WALLETS);

// For each owner:
// - collect signatures (small window)
// - parse first successful tx to extract fee payer as a fingerprint
// - infer "new-ish" based on oldest signature in window
const perWallet = [];
for (const owner of uniqueOwners) {
let sigs = [];
try {
sigs = await rpcRetry(() => connection.getSignaturesForAddress(new PublicKey(owner), { limit: SIG_LIMIT }));
} catch {
sigs = [];
}

// oldest in our window (approx wallet age)
let oldestBlockTime = null;
for (let i = sigs.length - 1; i >= 0; i--) {
if (sigs[i]?.blockTime) {
oldestBlockTime = sigs[i].blockTime;
break;
}
}
const approxAgeDays = oldestBlockTime ? daysAgo(oldestBlockTime) : null;
const isNew = approxAgeDays != null ? approxAgeDays <= NEW_WALLET_DAYS : null;

// payer fingerprint from parsed tx (best effort)
let payer = null;
let parsedCount = 0;

for (const s of sigs) {
if (parsedCount >= PARSE_PER_WALLET) break;
if (!s?.signature) continue;

try {
const tx = await rpcRetry(() =>
connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 })
);

// fee payer is first account key (typical)
const keys = tx?.transaction?.message?.accountKeys || [];
const maybePayer = keys?.[0]?.pubkey?.toBase58?.() || keys?.[0]?.toBase58?.();
if (maybePayer) {
payer = maybePayer;
parsedCount++;
break;
}
} catch {
// ignore
}
}

perWallet.push({
owner,
payer: payer || null,
approxAgeDays: approxAgeDays != null ? Number(approxAgeDays.toFixed(2)) : null,
isNew,
sigWindow: sigs.length,
});
}

// Cluster by shared payer fingerprint (payer used by 2+ wallets)
const groups = new Map(); // payer -> owners[]
for (const w of perWallet) {
if (!w.payer) continue;
if (!groups.has(w.payer)) groups.set(w.payer, []);
groups.get(w.payer).push(w.owner);
}

const clusters = [];
for (const [payer, members] of groups.entries()) {
if (members.length < 2) continue;
clusters.push({
payer,
members,
size: members.length,
});
}

clusters.sort((a, b) => b.size - a.size);

const total = perWallet.length;
const maxClusterSize = clusters[0]?.size || 1;

// How many wallets are part of any cluster
const clusteredSet = new Set();
for (const c of clusters) for (const m of c.members) clusteredSet.add(m);

const clusteredCount = clusteredSet.size;
const clusterCount = clusters.length;

// New wallet ratio (only among known booleans)
const knownNew = perWallet.filter((w) => typeof w.isNew === "boolean");
const newCount = knownNew.filter((w) => w.isNew).length;
const newWalletPct = knownNew.length ? (newCount / knownNew.length) * 100 : 0;

const score = buildScore({ total, clusteredCount, clusterCount, maxClusterSize, newWalletPct });
const label = scoreLabel(score);

return {
ok: true,
analyzedWallets: total,
clusterCount,
clusteredWallets: clusteredCount,
maxClusterSize,
newWalletPct: Number(newWalletPct.toFixed(1)),
score,
label: label.label,
band: label.band,
clusters: clusters.slice(0, 6), // cap
wallets: perWallet,
note:
"Heuristic based on shared fee-payer fingerprints and short signature history windows. Strong signals indicate likely linkage; not definitive attribution.",
};
}
