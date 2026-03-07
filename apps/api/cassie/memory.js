const cassieMemory = {
byMint: new Map(),
bySignature: new Map(),
};

function nowIso() {
return new Date().toISOString();
}

export function rememberCassieScan({ mint, cassieDna, securityModel }) {
if (!mint || !cassieDna?.signature) return;

const entry = {
mint,
signature: cassieDna.signature,
riskClass: cassieDna.riskClass,
confidence: cassieDna.confidence,
matches: Array.isArray(cassieDna.matches) ? cassieDna.matches : [],
score: Number(securityModel?.score ?? 0),
at: nowIso(),
};

cassieMemory.byMint.set(mint, entry);

const bucket = cassieMemory.bySignature.get(cassieDna.signature) || [];
bucket.unshift(entry);
cassieMemory.bySignature.set(cassieDna.signature, bucket.slice(0, 100));
}

export function getCassieMemoryByMint(mint) {
return cassieMemory.byMint.get(mint) || null;
}

export function getCassieMemoryBySignature(signature) {
return cassieMemory.bySignature.get(signature) || [];
}

export function getCassieMemorySnapshot(limit = 50) {
return Array.from(cassieMemory.byMint.values())
.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
.slice(0, limit);
}
