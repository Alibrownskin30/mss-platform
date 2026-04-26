const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

const DEFAULT_REFRESH_MS = 45_000;
const DEFAULT_TIMEOUT_MS = 3_000;
const MAX_STALE_MS = 10 * 60_000;

let cachedSolPrice = {
price: 0,
source: null,
fetchedAt: null,
blockId: null,
priceChange24h: null,
};

let refreshPromise = null;
let watcherStarted = false;
let watcherTimer = null;

function toNumber(value, fallback = 0) {
if (value === null || value === undefined || value === "") return fallback;
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function isFresh(maxAgeMs = DEFAULT_REFRESH_MS) {
if (!cachedSolPrice.price || !cachedSolPrice.fetchedAt) return false;
return Date.now() - cachedSolPrice.fetchedAt < maxAgeMs;
}

function isUsable() {
if (!cachedSolPrice.price || !cachedSolPrice.fetchedAt) return false;
return Date.now() - cachedSolPrice.fetchedAt < MAX_STALE_MS;
}

async function fetchJson(url, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

try {
const response = await fetch(url, {
method: "GET",
headers,
signal: controller.signal,
});

if (!response.ok) {
throw new Error(`HTTP ${response.status}`);
}

return await response.json();
} finally {
clearTimeout(timeout);
}
}

async function fetchFromJupiter() {
const apiKey = process.env.JUPITER_API_KEY || process.env.JUP_API_KEY || "";

if (!apiKey) {
return null;
}

const url = `https://api.jup.ag/price/v3?ids=${encodeURIComponent(
WRAPPED_SOL_MINT
)}`;

const json = await fetchJson(url, {
headers: {
"x-api-key": apiKey,
accept: "application/json",
},
});

const item = json?.[WRAPPED_SOL_MINT];
const price = toNumber(item?.usdPrice, 0);

if (price <= 0) {
return null;
}

return {
price,
source: "jupiter",
blockId: item?.blockId ?? null,
priceChange24h: toNumber(item?.priceChange24h, null),
};
}

async function fetchFromCoinGecko() {
const url =
"https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true";

const headers = {
accept: "application/json",
};

if (process.env.COINGECKO_API_KEY) {
headers["x-cg-demo-api-key"] = process.env.COINGECKO_API_KEY;
}

const json = await fetchJson(url, { headers });
const item = json?.solana;
const price = toNumber(item?.usd, 0);

if (price <= 0) {
return null;
}

return {
price,
source: "coingecko",
blockId: null,
priceChange24h: toNumber(item?.usd_24h_change, null),
};
}

export async function refreshSolUsdPrice({ force = false } = {}) {
if (!force && isFresh()) {
return getSolPriceSnapshot();
}

if (refreshPromise) {
return refreshPromise;
}

refreshPromise = (async () => {
const sources = [fetchFromJupiter, fetchFromCoinGecko];

for (const source of sources) {
try {
const result = await source();

if (result?.price > 0) {
cachedSolPrice = {
price: result.price,
source: result.source,
fetchedAt: Date.now(),
blockId: result.blockId ?? null,
priceChange24h: result.priceChange24h ?? null,
};

return getSolPriceSnapshot();
}
} catch {
// Try next source.
}
}

return getSolPriceSnapshot();
})();

try {
return await refreshPromise;
} finally {
refreshPromise = null;
}
}

export function getCachedSolUsdPrice() {
if (!watcherStarted) {
startSolPriceWatcher();
}

if (!isFresh()) {
refreshSolUsdPrice().catch(() => {});
}

return isUsable() ? cachedSolPrice.price : 0;
}

export function getSolPriceSnapshot() {
return {
sol_usd_price: cachedSolPrice.price || 0,
sol_usd_source: cachedSolPrice.source,
sol_usd_price_updated_at: cachedSolPrice.fetchedAt
? new Date(cachedSolPrice.fetchedAt).toISOString()
: null,
sol_usd_block_id: cachedSolPrice.blockId,
sol_usd_price_change_24h: cachedSolPrice.priceChange24h,
};
}

export function startSolPriceWatcher(intervalMs = DEFAULT_REFRESH_MS) {
if (watcherStarted) return;

watcherStarted = true;

refreshSolUsdPrice({ force: true }).catch(() => {});

watcherTimer = setInterval(() => {
refreshSolUsdPrice({ force: true }).catch(() => {});
}, Math.max(15_000, Number(intervalMs) || DEFAULT_REFRESH_MS));

if (typeof watcherTimer.unref === "function") {
watcherTimer.unref();
}
}

export function stopSolPriceWatcher() {
if (watcherTimer) {
clearInterval(watcherTimer);
}

watcherStarted = false;
watcherTimer = null;
}
