const cassieMemory = {
byMint: new Map(),
bySignature: new Map(),
scans: [],
};

const MAX_SIGNATURE_BUCKET = 150;
const MAX_GLOBAL_SCANS = 1000;

function nowIso() {
return new Date().toISOString();
}

function safeNum(v, fallback = 0) {
const n = Number(v);
return Number.isFinite(n) ? n : fallback;
}

function normalizeMatches(matches) {
if (!Array.isArray(matches)) return [];
return [...new Set(matches.map((m) => String(m || "").trim()).filter(Boolean))];
}

function buildTopPattern(entry) {
if (!entry) return null;

const matches = entry.matches || [];

if (matches.includes("developer_controlled_concentration_pattern")) {
return "Developer-controlled concentration pattern";
}

if (matches.includes("wallet_network_control_map_pattern")) {
return "Wallet-network control pattern";
}

if (matches.includes("authority_plus_thin_liquidity")) {
return "Authority + thin liquidity pattern";
}

if (matches.includes("clustered_concentration_pattern")) {
return "Clustered concentration pattern";
}

if (matches.includes("fresh_wallet_concentration_pattern")) {
return "Fresh-wallet concentration pattern";
}

if (matches.includes("whale_pressure_with_risk_acceleration")) {
return "Whale pressure + acceleration pattern";
}

if (matches.includes("developer_network_pattern")) {
return "Developer-network pattern";
}

if (matches.includes("wallet_network_pattern")) {
return "Wallet-network pattern";
}

return entry.riskClass ? `${entry.riskClass} structural profile` : "Observed structure";
}

function buildMemoryHits(signatureBucket, currentEntry) {
if (!Array.isArray(signatureBucket) || !signatureBucket.length) return [];

return signatureBucket
.slice(0, 5)
.map((entry) => ({
mint: entry.mint,
signature: entry.signature,
score: entry.score,
confidence: entry.confidence,
riskClass: entry.riskClass,
at: entry.at,
sameMint: entry.mint === currentEntry?.mint,
topPattern: buildTopPattern(entry),
}));
}

export function rememberCassieScan({
mint,
cassieDna,
securityModel,
radar = null,
simulation = null,
}) {
if (!mint || !cassieDna?.signature) return;

const signature = String(cassieDna.signature).trim();
if (!signature) return;

const entry = {
mint,
signature,
riskClass: cassieDna.riskClass || "unknown",
confidence: safeNum(cassieDna.confidence, 0),
matches: normalizeMatches(cassieDna.matches),
score: safeNum(securityModel?.score, 0),
threatLevel:
securityModel?.label?.text ||
securityModel?.signal ||
"Unknown",
reputationLabel: securityModel?.reputation?.label || "Unknown",
reputationScore: safeNum(securityModel?.reputation?.score, 0),
primaryDriver: securityModel?.primaryDriver || "Unknown",
walletNetworkConfidence: safeNum(securityModel?.walletNetwork?.confidence, 0),
walletNetworkControlEstimatePct: safeNum(
securityModel?.walletNetwork?.controlEstimatePct,
0
),
developerNetworkConfidence: safeNum(
securityModel?.developerNetwork?.confidence ||
securityModel?.developerActivity?.confidence,
0
),
developerNetworkLikelyControlPct: safeNum(
securityModel?.developerNetwork?.likelyControlPct ||
securityModel?.developerActivity?.likelyControlPct,
0
),
hiddenControlScore: safeNum(securityModel?.hiddenControl?.score, 0),
topPattern: buildTopPattern(cassieDna),
radarScore: safeNum(radar?.score, 0),
simulationScore: safeNum(simulation?.score, 0),
at: nowIso(),
};

cassieMemory.byMint.set(mint, entry);

const existingBucket = cassieMemory.bySignature.get(signature) || [];
const filteredBucket = existingBucket.filter((x) => x.mint !== mint);
filteredBucket.unshift(entry);
cassieMemory.bySignature.set(signature, filteredBucket.slice(0, MAX_SIGNATURE_BUCKET));

cassieMemory.scans = cassieMemory.scans.filter(
(x) => !(x.mint === mint && x.signature === signature)
);
cassieMemory.scans.unshift(entry);
if (cassieMemory.scans.length > MAX_GLOBAL_SCANS) {
cassieMemory.scans.length = MAX_GLOBAL_SCANS;
}
}

export function getCassieMemoryByMint(mint) {
const entry = cassieMemory.byMint.get(mint);
if (!entry) return null;

const signatureBucket = cassieMemory.bySignature.get(entry.signature) || [];
const seenCount = signatureBucket.length;

return {
...entry,
seenCount,
topPattern: entry.topPattern || buildTopPattern(entry),
hits: buildMemoryHits(signatureBucket, entry),
relatedCountExcludingSelf: Math.max(0, seenCount - 1),
};
}

export function getCassieMemoryBySignature(signature) {
const bucket = cassieMemory.bySignature.get(signature) || [];
return bucket.map((entry) => ({
...entry,
topPattern: entry.topPattern || buildTopPattern(entry),
}));
}

export function getCassieMemorySnapshot(limit = 50) {
return cassieMemory.scans
.slice()
.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
.slice(0, limit)
.map((entry) => ({
...entry,
seenCount: (cassieMemory.bySignature.get(entry.signature) || []).length,
topPattern: entry.topPattern || buildTopPattern(entry),
}));
}
