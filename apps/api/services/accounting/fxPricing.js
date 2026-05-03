import db from "../../db/index.js";

function toNumber(value, fallback = 0) {
if (value === null || value === undefined || value === "") return fallback;
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function cleanSymbol(value) {
return String(value ?? "").trim().toUpperCase();
}

function getEnvNumber(name, fallback = 0) {
return toNumber(process.env[name], fallback);
}

export function getConfiguredUsdToAudRate(fallback = 0) {
return toNumber(
process.env.FX_USD_TO_AUD ??
process.env.USD_TO_AUD_RATE ??
process.env.AUD_PER_USD,
fallback
);
}

export async function getLatestSolUsdPrice(fallback = 0) {
try {
const row = await db.get(
`
SELECT sol_usd_price
FROM launches
WHERE sol_usd_price IS NOT NULL
AND CAST(sol_usd_price AS REAL) > 0
ORDER BY id DESC
LIMIT 1
`
);

return toNumber(row?.sol_usd_price, fallback);
} catch {
return fallback;
}
}

export async function getLatestPricingSnapshot({
solUsdFallback = 0,
usdToAudFallback = 0,
} = {}) {
const solUsdPrice = await getLatestSolUsdPrice(solUsdFallback);
const usdToAudRate = getConfiguredUsdToAudRate(usdToAudFallback);

return {
solUsdPrice,
usdToAudRate,
sources: {
solUsdPrice: solUsdPrice > 0 ? "launches.sol_usd_price" : "fallback",
usdToAudRate:
usdToAudRate > 0
? "env.FX_USD_TO_AUD|USD_TO_AUD_RATE|AUD_PER_USD"
: "fallback",
},
};
}

export function convertUsdToAud(usdAmount, usdToAudRate = 0) {
const safeUsd = toNumber(usdAmount, 0);
const safeRate = toNumber(usdToAudRate, 0);
if (safeUsd <= 0 || safeRate <= 0) return 0;
return safeUsd * safeRate;
}

export function convertSolToAud(solAmount, solUsdPrice = 0, usdToAudRate = 0) {
const safeSol = toNumber(solAmount, 0);
const safeSolUsd = toNumber(solUsdPrice, 0);
const safeUsdToAud = toNumber(usdToAudRate, 0);

if (safeSol <= 0 || safeSolUsd <= 0 || safeUsdToAud <= 0) return 0;
return safeSol * safeSolUsd * safeUsdToAud;
}

export function resolveAudUnitPrice({
assetSymbol,
explicitAudUnitPrice = 0,
explicitUsdUnitPrice = 0,
solUsdPrice = 0,
usdToAudRate = 0,
} = {}) {
const directAud = toNumber(explicitAudUnitPrice, 0);
if (directAud > 0) return directAud;

const symbol = cleanSymbol(assetSymbol);
const safeUsdToAud = toNumber(usdToAudRate, 0);

if (symbol === "SOL") {
return convertUsdToAud(toNumber(solUsdPrice, 0), safeUsdToAud);
}

const directUsd = toNumber(explicitUsdUnitPrice, 0);
if (directUsd > 0 && safeUsdToAud > 0) {
return convertUsdToAud(directUsd, safeUsdToAud);
}

return 0;
}

export async function resolveAudPricingSnapshot({
assetSymbol,
amount = 0,
explicitAudUnitPrice = 0,
explicitUsdUnitPrice = 0,
solUsdPrice = null,
usdToAudRate = null,
} = {}) {
const pricing = await getLatestPricingSnapshot({
solUsdFallback: toNumber(solUsdPrice, 0),
usdToAudFallback: toNumber(usdToAudRate, 0),
});

const effectiveSolUsdPrice =
toNumber(solUsdPrice, 0) > 0 ? toNumber(solUsdPrice, 0) : pricing.solUsdPrice;

const effectiveUsdToAudRate =
toNumber(usdToAudRate, 0) > 0
? toNumber(usdToAudRate, 0)
: pricing.usdToAudRate;

const audUnitPrice = resolveAudUnitPrice({
assetSymbol,
explicitAudUnitPrice,
explicitUsdUnitPrice,
solUsdPrice: effectiveSolUsdPrice,
usdToAudRate: effectiveUsdToAudRate,
});

const safeAmount = toNumber(amount, 0);

return {
assetSymbol: cleanSymbol(assetSymbol),
amount: safeAmount,
audUnitPrice,
audTotalValue: safeAmount > 0 && audUnitPrice > 0 ? safeAmount * audUnitPrice : 0,
solUsdPrice: effectiveSolUsdPrice,
usdToAudRate: effectiveUsdToAudRate,
sources: pricing.sources,
};
}

export function buildZeroAudPricingSnapshot({
assetSymbol,
amount = 0,
} = {}) {
return {
assetSymbol: cleanSymbol(assetSymbol),
amount: toNumber(amount, 0),
audUnitPrice: 0,
audTotalValue: 0,
solUsdPrice: 0,
usdToAudRate: 0,
sources: {
solUsdPrice: "none",
usdToAudRate: "none",
},
};
}

export default {
getConfiguredUsdToAudRate,
getLatestSolUsdPrice,
getLatestPricingSnapshot,
convertUsdToAud,
convertSolToAud,
resolveAudUnitPrice,
resolveAudPricingSnapshot,
buildZeroAudPricingSnapshot,
};
