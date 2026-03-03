// apps/api/activity.js
import { PublicKey } from "@solana/web3.js";
import { AccountLayout } from "@solana/spl-token";

// Small helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRateLimitError(e) {
const msg = String(e?.message || e || "");
if (msg.includes("429")) return true;
if (msg.toLowerCase().includes("too many requests")) return true;
if (e?.code === 429) return true;
if (e?.data?.code === 429) return true;
if (e?.response?.status === 429) return true;
return false;
}

export async function rpcRetry(fn, { tries = 6, baseDelayMs = 300 } = {}) {
let lastErr;
for (let i = 0; i < tries; i++) {
try {
return await fn();
} catch (e) {
lastErr = e;
const delay = Math.min(9000, baseDelayMs * Math.pow(2, i)) + Math.floor(Math.random() * 220);
if (isRateLimitError(e)) await sleep(delay);
else await sleep(180);
}
}
throw lastErr;
}

// ---- In-memory cache + in-flight de-dupe ----
const activityCache = new Map(); // mint -> { ts, data }
const activityInFlight = new Map(); // mint -> Promise
const ACTIVITY_TTL_MS = 60_000; // 60s

// Parse token balance deltas for a given token account from a parsed tx
function tokenDeltaFromParsedTx(parsedTx, tokenAccountStr, mintStr) {
try {
const meta = parsedTx?.meta;
if (!meta) return 0;

const pre = meta.preTokenBalances || [];
const post = meta.postTokenBalances || [];

const pick = (arr) =>
arr.find(
(x) =>
String(x?.mint) === mintStr &&
String(x?.accountIndex) != null
);

// We need to locate tokenAccount index from message accountKeys
const keys = parsedTx?.transaction?.message?.accountKeys || [];
let idx = -1;
for (let i = 0; i < keys.length; i++) {
const k = keys[i];
const pk = typeof k === "string" ? k : k?.pubkey?.toString?.();
if (pk === tokenAccountStr) {
idx = i;
break;
}
}
if (idx === -1) return 0;

const preBal = pre.find((b) => b.accountIndex === idx && b.mint === mintStr);
const postBal = post.find((b) => b.accountIndex === idx && b.mint === mintStr);

const preUi = Number(preBal?.uiTokenAmount?.uiAmount || 0);
const postUi = Number(postBal?.uiTokenAmount?.uiAmount || 0);
return postUi - preUi;
} catch {
return 0;
}
}

// Resolve owners from token accounts (fast: getMultipleAccountsInfo once)
async function resolveOwners(connection, tokenAccountPubkeys) {
const infos = await rpcRetry(() => connection.getMultipleAccountsInfo(tokenAccountPubkeys));
return infos.map((info) => {
try {
if (!info?.data) return null;
const decoded = AccountLayout.decode(info.data);
return new PublicKey(decoded.owner).toBase58();
} catch {
return null;
}
});
}

// Build clusters (best-effort, lightweight heuristics)
function buildClusters({ funderMap, fanInMap, syncMap }) {
const clusters = [];
let clusterId = 1;

// Common funder -> cluster
for (const [funder, wallets] of funderMap.entries()) {
if (wallets.size >= 5) {
clusters.push({
clusterId: `F${clusterId++}`,
walletCount: wallets.size,
score: Math.min(100, 55 + (wallets.size - 5) * 6),
evidence: ["Common funding source (recent SOL inbound)"],
wallets: Array.from(wallets).slice(0, 24),
});
}
}

// Fan-in -> cluster
for (const [receiver, senders] of fanInMap.entries()) {
if (senders.size >= 5) {
clusters.push({
clusterId: `I${clusterId++}`,
walletCount: senders.size,
score: Math.min(100, 50 + (senders.size - 5) * 7),
evidence: ["Fan-in consolidation (many senders -> one receiver)"],
wallets: [receiver, ...Array.from(senders).slice(0, 23)],
});
}
}

// Sync bursts -> cluster
for (const [bucket, wallets] of syncMap.entries()) {
if (wallets.size >= 8) {
clusters.push({
clusterId: `S${clusterId++}`,
walletCount: wallets.size,
score: Math.min(100, 45 + (wallets.size - 8) * 5),
evidence: ["Synchronized activity window (timing correlation)"],
wallets: Array.from(wallets).slice(0, 24),
});
}
}

// Rank clusters by score desc
clusters.sort((a, b) => b.score - a.score);

// Cap output
return clusters.slice(0, 8);
}

// Calculate sybil score from clusters + extra signals
function computeSybilScore(clusters, { whale1hPct, whale24hPct }) {
let score = 0;

// cluster weight
for (const c of clusters) score += Math.min(30, Math.round(c.score / 3));

// whale distribution boosts
const dist = Math.max(0, -Number(whale1hPct || 0));
const dist24 = Math.max(0, -Number(whale24hPct || 0));
if (dist >= 0.25) score += 10;
if (dist >= 0.75) score += 14;
if (dist24 >= 1.0) score += 10;
if (dist24 >= 2.5) score += 12;

return Math.max(0, Math.min(100, Math.round(score)));
}

function confidenceFromSignals({ analyzedWallets, txParsed, hadRateLimit }) {
// pragmatic confidence label
if (hadRateLimit) return "low";
if (analyzedWallets >= 12 && txParsed >= 20) return "high";
if (analyzedWallets >= 8 && txParsed >= 10) return "medium";
return "low";
}

// ---- Main exported function ----
export async function getTokenActivity({ connection, mintStr, topTokenAccounts, topOwners, totalSupplyUi }) {
// cache
const cached = activityCache.get(mintStr);
if (cached && Date.now() - cached.ts < ACTIVITY_TTL_MS) return cached.data;

// in-flight dedupe
if (activityInFlight.has(mintStr)) return await activityInFlight.get(mintStr);

const task = (async () => {
const mintPk = new PublicKey(mintStr);

// windows
const now = Date.now();
const oneH = now - 60 * 60 * 1000;
const oneD = now - 24 * 60 * 60 * 1000;

// We calculate whale net flow by scanning a *small* number of recent txs for each top token account
// This is “serious but pragmatic”: good signal, light enough for Codespaces.
const SIGS_PER_ACCOUNT = 18; // keep it lean
let txParsed = 0;
let hadRateLimit = false;

let netFlow1hUi = 0; // net tokens moving out (negative = distribution)
let netFlow24hUi = 0;

// --- Cluster heuristic structures ---
const funderMap = new Map(); // funder -> Set(wallet)
const fanInMap = new Map(); // receiver -> Set(sender)
const syncMap = new Map(); // timeBucket -> Set(wallet)

// Helper: add wallet to funder cluster
const addFunderLink = (funder, wallet) => {
if (!funder || !wallet) return;
if (!funderMap.has(funder)) funderMap.set(funder, new Set());
funderMap.get(funder).add(wallet);
};

// Helper: add fan-in
const addFanIn = (receiver, sender) => {
if (!receiver || !sender) return;
if (!fanInMap.has(receiver)) fanInMap.set(receiver, new Set());
fanInMap.get(receiver).add(sender);
};

// Helper: add sync bucket
const addSync = (bucket, wallet) => {
if (!bucket || !wallet) return;
if (!syncMap.has(bucket)) syncMap.set(bucket, new Set());
syncMap.get(bucket).add(wallet);
};

// Analyze top holders’ token accounts
const analyzedWallets = Math.min(topTokenAccounts.length, 12); // top 12 only for performance

for (let i = 0; i < analyzedWallets; i++) {
const tokenAcc = topTokenAccounts[i];
const owner = topOwners[i];

let sigs = [];
try {
const resp = await rpcRetry(() =>
connection.getSignaturesForAddress(new PublicKey(tokenAcc), { limit: SIGS_PER_ACCOUNT })
);
sigs = resp || [];
} catch (e) {
if (isRateLimitError(e)) hadRateLimit = true;
continue;
}

// sync buckets based on signature time (90s buckets)
for (const s of sigs) {
const bt = (s.blockTime || 0) * 1000;
if (!bt) continue;
const bucket = Math.floor(bt / 90_000); // 90 sec
addSync(String(bucket), owner);
}

// parse a subset of recent txs for netflow + fan-in + common funder best-effort
for (const s of sigs.slice(0, 10)) {
try {
const parsedTx = await rpcRetry(() =>
connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 })
);
if (!parsedTx) continue;
txParsed++;

const bt = (parsedTx.blockTime || 0) * 1000;
const delta = tokenDeltaFromParsedTx(parsedTx, tokenAcc, mintStr);

// If token account balance drops, assume outflow from this whale token account (distribution)
if (bt >= oneH) netFlow1hUi += delta;
if (bt >= oneD) netFlow24hUi += delta;

// Fan-in heuristic: find token transfer instructions involving this mint and attempt sender->receiver owner mapping
const ix = parsedTx?.transaction?.message?.instructions || [];
for (const instr of ix) {
const parsed = instr?.parsed;
if (!parsed) continue;
if (parsed?.type !== "transfer" && parsed?.type !== "transferChecked") continue;

const info = parsed?.info || {};
const mint = info?.mint;
if (mint !== mintStr) continue;

const source = info?.source;
const destination = info?.destination;

// If destination equals this tokenAcc, treat as inflow consolidation (sender -> this owner)
// We can’t always map source owner cheaply; but if source is among known top accounts, we can.
const srcIdx = topTokenAccounts.indexOf(source);
const dstIdx = topTokenAccounts.indexOf(destination);

const senderOwner = srcIdx >= 0 ? topOwners[srcIdx] : null;
const receiverOwner = dstIdx >= 0 ? topOwners[dstIdx] : null;

if (receiverOwner && senderOwner && receiverOwner !== senderOwner) {
addFanIn(receiverOwner, senderOwner);
}
}

// Common funder heuristic (best effort): look for simple SOL transfer into owner in same tx (rare but useful)
// We check parsed system transfers and take sender if owner is recipient.
const inner = parsedTx?.meta?.innerInstructions || [];
const allInstr = [...ix, ...inner.flatMap((x) => x.instructions || [])];
for (const instr of allInstr) {
const parsed = instr?.parsed;
if (!parsed) continue;
if (parsed?.type !== "transfer") continue;
const info = parsed?.info || {};
if (!info?.destination || !info?.source) continue;
if (info.destination === owner) {
addFunderLink(info.source, owner);
}
}
} catch (e) {
if (isRateLimitError(e)) hadRateLimit = true;
continue;
}
}
}

// Convert net flows to “distribution” sign:
// netFlowUi is delta in whale token accounts. Negative delta means whales reduced holdings = distribution.
const total = Number(totalSupplyUi || 0);
const whale1hPct = total > 0 ? (netFlow1hUi / total) * 100 : 0;
const whale24hPct = total > 0 ? (netFlow24hUi / total) * 100 : 0;

const clusters = buildClusters({ funderMap, fanInMap, syncMap });
const sybilScore = computeSybilScore(clusters, { whale1hPct, whale24hPct });
const confidence = confidenceFromSignals({ analyzedWallets, txParsed, hadRateLimit });

// Output formatted for UI
const out = {
mint: mintPk.toBase58(),
whaleNetFlow: {
"1h": Number(whale1hPct.toFixed(3)), // % supply change in top whales token accounts
"24h": Number(whale24hPct.toFixed(3)),
},
clusters,
sybilScore,
confidence,
meta: {
analyzedWallets,
txParsed,
cachedTtlMs: ACTIVITY_TTL_MS,
},
note:
"Activity analysis is best-effort on-chain telemetry. Confidence reflects data completeness and RPC stability.",
};

activityCache.set(mintStr, { ts: Date.now(), data: out });
return out;
})();

activityInFlight.set(mintStr, task);
const data = await task;
activityInFlight.delete(mintStr);
return data;
}
