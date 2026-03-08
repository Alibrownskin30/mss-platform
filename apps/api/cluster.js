import { PublicKey } from "@solana/web3.js";

/**
* MSS Phase 3B Cluster + Developer Network Intelligence
* Heuristic on-chain linkage model using:
* - shared fee payer fingerprints
* - short signature windows
* - approximate wallet age from oldest recent sig
* - synchronized activity buckets
*
* Output is designed to feed:
* - hidden control scoring
* - developer-network scoring
* - wallet network intelligence UI
* - future graph / control-map rendering
*/

const SIG_LIMIT = 12;
const PARSE_PER_WALLET = 2;
const MAX_WALLETS = 14;
const NEW_WALLET_DAYS = 7;

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

function clamp(n, a, b) {
return Math.max(a, Math.min(b, n));
}

function pct(part, total, dp = 1) {
if (!(total > 0)) return 0;
return Number(((part / total) * 100).toFixed(dp));
}

function riskBand(score) {
if (score >= 75) return { text: "High", state: "bad" };
if (score >= 45) return { text: "Moderate", state: "warn" };
return { text: "Low", state: "good" };
}

function confidenceLabel(score) {
if (score >= 75) return "High";
if (score >= 45) return "Moderate";
return "Low";
}

function computeSyncBuckets(sigListsByOwner) {
const bucketMap = new Map();

for (const [owner, sigs] of sigListsByOwner.entries()) {
for (const s of sigs || []) {
const bt = Number(s?.blockTime || 0);
if (!bt) continue;

const bucket = Math.floor((bt * 1000) / 90_000);
if (!bucketMap.has(bucket)) bucketMap.set(bucket, new Set());
bucketMap.get(bucket).add(owner);
}
}

const syncBursts = [];
for (const [bucket, owners] of bucketMap.entries()) {
if (owners.size >= 3) {
syncBursts.push({
bucket,
owners: Array.from(owners),
size: owners.size,
});
}
}

syncBursts.sort((a, b) => b.size - a.size);
return syncBursts.slice(0, 10);
}

function buildLinkedGroups(perWallet) {
const byPayer = new Map();

for (const w of perWallet) {
if (!w.payer) continue;
if (!byPayer.has(w.payer)) byPayer.set(w.payer, []);
byPayer.get(w.payer).push(w.owner);
}

const groups = [];
for (const [payer, members] of byPayer.entries()) {
if (members.length < 2) continue;
groups.push({
payer,
members,
size: members.length,
});
}

groups.sort((a, b) => b.size - a.size);
return groups;
}

function buildScore({
total,
linkedWallets,
largestGroupSize,
newWalletPct,
syncBurstSize,
sharedFundingDetected,
}) {
if (!total || total < 2) return 0;

let score = 0;

const linkedPct = linkedWallets / total;
score += Math.round(linkedPct * 45);

const largestPct = largestGroupSize / total;
score += Math.round(largestPct * 25);

score += Math.round((newWalletPct / 100) * 15);

if (syncBurstSize >= 5) score += 8;
else if (syncBurstSize >= 3) score += 4;

if (sharedFundingDetected) score += 10;

return clamp(score, 0, 100);
}

function buildDeveloperNetwork({
totalWallets,
linkedWallets,
linkedWalletPct,
largestGroupSize,
sharedFundingDetected,
newWalletPct,
syncBurstSize,
groups,
}) {
const notes = [];
let confidence = 0;

if (sharedFundingDetected) {
confidence += 28;
notes.push("Multiple wallets share payer fingerprint linkage.");
}

if (largestGroupSize >= 4) {
confidence += 22;
notes.push(`Largest linked wallet group contains ${largestGroupSize} wallets.`);
} else if (largestGroupSize >= 3) {
confidence += 14;
notes.push(`A linked wallet group of ${largestGroupSize} wallets was detected.`);
}

if (linkedWalletPct >= 40) {
confidence += 18;
notes.push(`Linked wallets represent ${linkedWalletPct}% of analyzed wallets.`);
} else if (linkedWalletPct >= 20) {
confidence += 10;
notes.push(`Linked wallets represent a meaningful share of analyzed wallets (${linkedWalletPct}%).`);
}

if (syncBurstSize >= 5) {
confidence += 16;
notes.push(`Synchronized activity burst detected across ${syncBurstSize} wallets.`);
} else if (syncBurstSize >= 3) {
confidence += 8;
notes.push(`Moderate synchronized activity detected across ${syncBurstSize} wallets.`);
}

if (newWalletPct >= 35) {
confidence += 10;
notes.push(`Fresh-wallet participation is elevated at ${newWalletPct}%.`);
} else if (newWalletPct >= 20) {
confidence += 6;
notes.push(`Fresh-wallet concentration is notable at ${newWalletPct}%.`);
}

confidence = clamp(Math.round(confidence), 0, 100);

const detected = confidence >= 35 || (sharedFundingDetected && largestGroupSize >= 3);

let label = "No Clear Developer Network";
let state = "good";

if (confidence >= 75) {
label = "Strong Developer Network";
state = "bad";
} else if (confidence >= 55) {
label = "Elevated Developer Network";
state = "bad";
} else if (confidence >= 35) {
label = "Weak Developer Linkage";
state = "warn";
}

const earlyReceiverCount = clamp(largestGroupSize, 0, totalWallets);
const likelyControlPct = linkedWalletPct;

if (!notes.length) {
notes.push("No strong developer-linked wallet network was detected in this snapshot.");
}

return {
detected,
confidence,
label,
state,
linkedWallets,
fundingSourceShared: sharedFundingDetected,
earlyReceiverCount,
likelyControlPct,
groups: groups.slice(0, 3).map((g) => ({
payer: g.payer,
size: g.size,
members: g.members,
})),
notes,
};
}

function buildWalletNetwork({
groups,
linkedWallets,
linkedWalletPct,
hiddenControlScore,
developerNetwork,
sharedFundingDetected,
syncBurstSize,
}) {
const primaryGroup = groups[0] || null;
const primaryWallet = primaryGroup?.payer || primaryGroup?.members?.[0] || null;
const primaryClusterId = primaryGroup ? "C1" : null;

let role = "Observed wallet";
if (developerNetwork?.detected && developerNetwork?.confidence >= 75) {
role = "Likely operator";
} else if (developerNetwork?.detected) {
role = "Probable linked wallet";
} else if (sharedFundingDetected) {
role = "Shared payer / controller";
} else if ((primaryGroup?.size || 0) >= 2) {
role = "Lead linked wallet";
}

const confidence = clamp(
Math.round(
hiddenControlScore * 0.45 +
Number(developerNetwork?.confidence || 0) * 0.4 +
(syncBurstSize >= 5 ? 10 : syncBurstSize >= 3 ? 5 : 0)
),
0,
100
);

return {
primaryWallet,
primaryClusterId,
role,
linkedWallets,
linkedWalletPct,
sharedFundingDetected,
controlEstimatePct: Number(
developerNetwork?.likelyControlPct || linkedWalletPct || 0
),
confidence,
confidenceLabel: confidenceLabel(confidence),
clusters: groups.slice(0, 6).map((g, i) => ({
id: `C${i + 1}`,
payer: g.payer,
size: g.size,
members: g.members,
score: clamp(42 + g.size * 10, 0, 100),
role: i === 0 ? "Primary linked cluster" : "Linked cluster",
})),
};
}

/**
* @param {object} args
* @param {import("@solana/web3.js").Connection} args.connection
* @param {function} args.rpcRetry
* @param {string[]} args.owners
*/
export async function getClusterIntel({ connection, rpcRetry, owners }) {
const uniqueOwners = [...new Set((owners || []).map(safeBase58).filter(Boolean))].slice(0, MAX_WALLETS);

const perWallet = [];
const sigListsByOwner = new Map();

for (const owner of uniqueOwners) {
let sigs = [];
try {
sigs = await rpcRetry(() =>
connection.getSignaturesForAddress(new PublicKey(owner), { limit: SIG_LIMIT })
);
} catch {
sigs = [];
}

sigListsByOwner.set(owner, sigs);

let oldestBlockTime = null;
for (let i = sigs.length - 1; i >= 0; i--) {
if (sigs[i]?.blockTime) {
oldestBlockTime = sigs[i].blockTime;
break;
}
}

const approxAgeDays = oldestBlockTime ? daysAgo(oldestBlockTime) : null;
const isNew = approxAgeDays != null ? approxAgeDays <= NEW_WALLET_DAYS : null;

let payer = null;
let parsedCount = 0;

for (const s of sigs) {
if (parsedCount >= PARSE_PER_WALLET) break;
if (!s?.signature) continue;

try {
const tx = await rpcRetry(() =>
connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 })
);

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

const groups = buildLinkedGroups(perWallet);

const linkedSet = new Set();
for (const g of groups) {
for (const m of g.members) linkedSet.add(m);
}

const linkedWallets = linkedSet.size;
const largestGroupSize = groups[0]?.size || 1;
const sharedFundingDetected = groups.length > 0;

const knownNew = perWallet.filter((w) => typeof w.isNew === "boolean");
const newWallets = knownNew.filter((w) => w.isNew).length;
const newWalletPct = knownNew.length ? pct(newWallets, knownNew.length) : 0;

const syncBursts = computeSyncBuckets(sigListsByOwner);
const syncBurstSize = syncBursts[0]?.size || 0;

const hiddenControlScore = buildScore({
total: perWallet.length,
linkedWallets,
largestGroupSize,
newWalletPct,
syncBurstSize,
sharedFundingDetected,
});

const hiddenControlBand = riskBand(hiddenControlScore);
const linkedWalletPct = pct(linkedWallets, perWallet.length);

const hiddenControl = {
score: hiddenControlScore,
label: hiddenControlBand.text,
state: hiddenControlBand.state,
linkedWallets,
linkedWalletPct,
largestGroupSize,
sharedFundingDetected,
syncBurstSize,
note:
hiddenControlScore >= 70
? "Multiple wallets show linkage patterns consistent with coordinated control."
: hiddenControlScore >= 45
? "Some linkage patterns detected. Review concentration and wallet behavior carefully."
: "No strong hidden-control structure detected in this snapshot.",
};

const developerNetwork = buildDeveloperNetwork({
totalWallets: perWallet.length,
linkedWallets,
linkedWalletPct,
largestGroupSize,
sharedFundingDetected,
newWalletPct,
syncBurstSize,
groups,
});

const developer = {
overlapDetected: developerNetwork.detected,
linkedWalletsEstimate: developerNetwork.linkedWallets,
label: developerNetwork.label,
confidence: developerNetwork.confidence,
};

const freshWalletRisk = {
walletCount: newWallets,
pct: newWalletPct,
label:
newWalletPct >= 45
? "High"
: newWalletPct >= 20
? "Moderate"
: "Low",
state:
newWalletPct >= 45
? "bad"
: newWalletPct >= 20
? "warn"
: "good",
};

const whaleActivity = {
syncBurstSize,
clusterCount: groups.length,
pressureLabel:
syncBurstSize >= 6
? "Elevated coordination"
: syncBurstSize >= 3
? "Watchlist"
: "Normal",
};

const walletNetwork = buildWalletNetwork({
groups,
linkedWallets,
linkedWalletPct,
hiddenControlScore,
developerNetwork,
sharedFundingDetected,
syncBurstSize,
});

return {
ok: true,
analyzedWallets: perWallet.length,
clusterCount: groups.length,
clusteredWallets: linkedWallets,
maxClusterSize: largestGroupSize,
newWalletPct,
score: hiddenControlScore,
label: hiddenControlBand.text,
band: hiddenControlBand.state,
clusters: walletNetwork.clusters,
wallets: perWallet,
hiddenControl,
developer,
developerNetwork,
walletNetwork,
freshWalletRisk,
whaleActivity,
syncBursts,
note:
"Heuristic linkage model based on shared payer fingerprints, recent signature windows, wallet age, and synchronized activity. Signals are strong indicators, not definitive attribution.",
};
}