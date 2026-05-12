function ensureFunction(fn, name) {
if (typeof fn !== "function") {
throw new TypeError(`[security-scan] Missing required dependency: ${name}`);
}
}

function cleanText(value, max = 255) {
return String(value ?? "").trim().slice(0, max);
}

function toNumOrNull(value) {
if (value == null || value === "") return null;
const num = Number(value);
return Number.isFinite(num) ? num : null;
}

function buildNotFoundError(message = "Mint not found") {
const error = new Error(message);
error.statusCode = 404;
return error;
}

function normalizeMarketPayload(market) {
if (market && typeof market === "object" && market.found) {
return market;
}
return { found: false };
}

function normalizeActivityPayload(activity) {
return activity && typeof activity === "object" ? activity : {};
}

function buildFallbackSecurityModel(base = {}) {
return {
score: Number.isFinite(Number(base?.score)) ? Number(base.score) : 0,
label:
base?.label && typeof base.label === "object"
? base.label
: { text: "Unknown", state: "warn" },
...base,
};
}

function buildFallbackConcentration() {
return {
top1: 0,
top5: 0,
top10: 0,
top20: 0,
};
}

export function createSecurityScanService(deps = {}) {
const {
fetchTokenData,
fetchMarketData,
fetchHoldersData,
fetchClusterData,
buildConcentration,
getRiskTrend,
buildSecurityModel,
enrichSecurityModel,
buildCassieIntelFallback,
cassieIntel,
upsertScanCache,
} = deps;

ensureFunction(fetchTokenData, "fetchTokenData");
ensureFunction(fetchMarketData, "fetchMarketData");
ensureFunction(fetchHoldersData, "fetchHoldersData");
ensureFunction(fetchClusterData, "fetchClusterData");
ensureFunction(buildConcentration, "buildConcentration");
ensureFunction(getRiskTrend, "getRiskTrend");
ensureFunction(buildSecurityModel, "buildSecurityModel");
ensureFunction(enrichSecurityModel, "enrichSecurityModel");
ensureFunction(buildCassieIntelFallback, "buildCassieIntelFallback");
ensureFunction(upsertScanCache, "upsertScanCache");

return async function scanSecurityForMint({
mint,
mintStr,
source = null,
slot = null,
signature = null,
discovered_at = null,
execution_mode = null,
linked_operator_cluster_id = null,
} = {}) {
if (!mint) {
throw new Error("scanSecurityForMint requires a valid mint");
}

const safeMintStr = cleanText(mintStr || mint?.toBase58?.() || "", 128);
if (!safeMintStr) {
throw new Error("scanSecurityForMint requires mintStr");
}

const [tokenResult, marketResult, holdersResult, clusterResult] =
await Promise.allSettled([
fetchTokenData(mint, safeMintStr),
fetchMarketData(safeMintStr),
fetchHoldersData(mint, safeMintStr),
fetchClusterData(mint, safeMintStr),
]);

if (tokenResult.status === "rejected") {
throw tokenResult.reason;
}

if (holdersResult.status === "rejected") {
throw holdersResult.reason;
}

const tokenJson = tokenResult.value;
const holdersJson = holdersResult.value;

if (!tokenJson || !holdersJson) {
throw buildNotFoundError("Mint not found");
}

const market =
marketResult.status === "fulfilled"
? normalizeMarketPayload(marketResult.value)
: { found: false };

const activity =
clusterResult.status === "fulfilled"
? normalizeActivityPayload(clusterResult.value)
: {};

let concentration;
try {
concentration = buildConcentration(holdersJson);
} catch {
concentration = buildFallbackConcentration();
}

let trend;
try {
trend = getRiskTrend(safeMintStr) || {};
} catch {
trend = {};
}

let baseSecurityModel;
try {
baseSecurityModel = buildSecurityModel({
concentration,
token: tokenJson,
activity,
market,
trend,
});
} catch {
baseSecurityModel = buildFallbackSecurityModel();
}

let securityModel;
try {
securityModel = enrichSecurityModel({
baseModel: baseSecurityModel,
concentration,
token: tokenJson,
market,
activity,
trend,
holdersJson,
});
} catch {
securityModel = buildFallbackSecurityModel(baseSecurityModel);
}

let cassieIntelResult = null;

try {
if (typeof cassieIntel?.analyze === "function") {
cassieIntelResult = cassieIntel.analyze({
mint: safeMintStr,
token: tokenJson,
market,
concentration,
activity,
securityModel,
trend,
});
} else {
cassieIntelResult = buildCassieIntelFallback({
token: tokenJson,
market,
concentration,
activity,
trend,
securityModel,
});
}
} catch {
cassieIntelResult = buildCassieIntelFallback({
token: tokenJson,
market,
concentration,
activity,
trend,
securityModel,
});
}

try {
await Promise.resolve(
upsertScanCache({
mint: safeMintStr,
token: tokenJson,
market,
holders: holdersJson,
activity,
concentration,
trend,
securityModel,
cassie: cassieIntelResult,
scanMeta: {
source: cleanText(source, 120) || "security_scan",
slot: toNumOrNull(slot),
signature: cleanText(signature, 128) || null,
discovered_at: cleanText(discovered_at, 64) || null,
execution_mode:
cleanText(execution_mode, 64) ||
cleanText(cassieIntelResult?.execution_mode, 64) ||
null,
linked_operator_cluster_id:
cleanText(linked_operator_cluster_id, 255) ||
cleanText(activity?.primaryClusterId, 255) ||
cleanText(securityModel?.walletNetwork?.primaryClusterId, 255) ||
null,
},
})
);
} catch {
// cache persistence is best-effort and should not fail the scan response
}

return {
ok: true,
mint: safeMintStr,
token: tokenJson,
market,
holders: holdersJson,
concentration,
activity,
trend,
securityModel,
cassie: cassieIntelResult,
};
};
}

export default {
createSecurityScanService,
};
