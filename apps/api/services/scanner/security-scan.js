function ensureFunction(fn, name) {
if (typeof fn !== "function") {
throw new TypeError(`[security-scan] Missing required dependency: ${name}`);
}
}

function buildNotFoundError(message = "Mint not found") {
const error = new Error(message);
error.statusCode = 404;
return error;
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

return async function scanSecurityForMint({ mint, mintStr }) {
if (!mint) {
throw new Error("scanSecurityForMint requires a valid mint");
}

const safeMintStr = String(mintStr || mint?.toBase58?.() || "").trim();
if (!safeMintStr) {
throw new Error("scanSecurityForMint requires mintStr");
}

const [tokenJson, marketJson, holdersJson, clusterJson] = await Promise.all([
fetchTokenData(mint, safeMintStr),
fetchMarketData(safeMintStr),
fetchHoldersData(mint, safeMintStr),
fetchClusterData(mint, safeMintStr),
]);

if (!tokenJson || !holdersJson) {
throw buildNotFoundError("Mint not found");
}

const concentration = buildConcentration(holdersJson);
const activity = clusterJson || {};
const market = marketJson || {};
const trend = getRiskTrend(safeMintStr);

const baseSecurityModel = buildSecurityModel({
concentration,
token: tokenJson,
activity,
market,
trend,
});

const securityModel = enrichSecurityModel({
baseModel: baseSecurityModel,
concentration,
token: tokenJson,
market,
activity,
trend,
holdersJson,
});

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

upsertScanCache({
mint: safeMintStr,
token: tokenJson,
market: market.found ? market : { found: false },
holders: holdersJson,
activity,
securityModel,
cassie: cassieIntelResult,
});

return {
ok: true,
mint: safeMintStr,
token: tokenJson,
market: market.found ? market : { found: false },
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
