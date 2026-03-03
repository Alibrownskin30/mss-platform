function clamp(n, a, b) {
return Math.max(a, Math.min(b, n));
}

function num(x) {
const v = Number(x);
return Number.isFinite(v) ? v : 0;
}

export function buildActivityFromHolders(holdersJson) {
const holders = Array.isArray(holdersJson?.holders) ? holdersJson.holders : [];
if (!holders.length) {
return {
sybilScore0to100: 0,
clustersCount: 0,
clusters: [],
whaleFlow1hPct: null,
whaleFlow24hPct: null,
signalText: "No holder data",
signalState: "muted",
meta: { analyzedWallets: 0, parsedTx: 0, confidence: "low" },
};
}

// Normalize: top list only
const top = holders.slice(0, 20).map((h, i) => ({
rank: h.rank ?? (i + 1),
owner: h.owner || null,
tokenAccount: h.tokenAccount || null,
pctSupply: num(h.pctSupply),
uiAmount: h.uiAmount,
}));

// Primary: group by owner (strongest evidence)
const byOwner = new Map(); // owner -> { owner, accounts, pctSum, members[] }
for (const h of top) {
if (!h.owner) continue;
const row = byOwner.get(h.owner) || { owner: h.owner, accounts: 0, pctSum: 0, members: [] };
row.accounts += 1;
row.pctSum += h.pctSupply;
row.members.push(h.tokenAccount || h.owner);
byOwner.set(h.owner, row);
}

const ownerClusters = [...byOwner.values()]
.filter((r) => r.accounts >= 2)
.sort((a, b) => b.pctSum - a.pctSum)
.slice(0, 6)
.map((r, idx) => {
const score = clamp(Math.round(r.accounts * 12 + r.pctSum * 0.9), 0, 100);
const evidence =
r.accounts >= 4
? "Multiple top token accounts under one owner (structuring)"
: "Repeated owner across top token accounts (structuring signal)";

return {
id: `S${idx + 1}`,
wallets: r.accounts,
score,
evidence,
members: [r.owner, ...r.members.filter(Boolean)],
};
});

// Fallback: if no owner field, estimate “structuring” by distribution pattern
// (many holders clustered in same narrow % range => looks like split wallets)
let distCluster = null;
if (ownerClusters.length === 0) {
const buckets = new Map(); // bucketKey -> count
for (const h of top) {
// bucket by 0.25% steps
const b = Math.round(h.pctSupply / 0.25) * 0.25;
const key = b.toFixed(2);
buckets.set(key, (buckets.get(key) || 0) + 1);
}
let bestKey = null;
let bestCount = 0;
for (const [k, c] of buckets.entries()) {
if (c > bestCount) {
bestCount = c;
bestKey = k;
}
}

if (bestCount >= 6 && bestKey != null) {
const score = clamp(Math.round(25 + bestCount * 8), 0, 80);
distCluster = {
id: "S1",
wallets: bestCount,
score,
evidence: `Many top holders clustered around ~${bestKey}% each (split-wallet distribution pattern)`,
members: [],
};
}
}

const clusters = ownerClusters.length ? ownerClusters : distCluster ? [distCluster] : [];
const clustersCount = clusters.length;

const maxScore = clusters.reduce((m, c) => Math.max(m, c.score), 0);
const sybilScore0to100 = clamp(Math.round(maxScore * 0.8 + clustersCount * 8), 0, 100);

let signalText = "Normal Activity";
let signalState = "good";
if (sybilScore0to100 >= 70) {
signalText = "Coordinated / Structured";
signalState = "bad";
} else if (sybilScore0to100 >= 40) {
signalText = "Elevated Structuring";
signalState = "warn";
}

return {
sybilScore0to100,
clustersCount,
clusters,
whaleFlow1hPct: null,
whaleFlow24hPct: null,
signalText,
signalState,
meta: {
analyzedWallets: Math.min(holders.length, 20),
parsedTx: 0,
confidence: clustersCount ? "medium" : "high",
},
};
}
