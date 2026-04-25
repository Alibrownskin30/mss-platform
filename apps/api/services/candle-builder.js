const INTERVAL_TO_MS = {
"1m": 60_000,
"5m": 5 * 60_000,
"15m": 15 * 60_000,
"30m": 30 * 60_000,
"1h": 60 * 60_000,
"4h": 4 * 60 * 60_000,
"1d": 24 * 60 * 60_000,
};

function toNumber(value, fallback = 0) {
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function round(value, decimals = 12) {
const num = toNumber(value, 0);
if (!Number.isFinite(num)) return 0;
return Number(num.toFixed(decimals));
}

function normalizeInterval(interval = "1m") {
return INTERVAL_TO_MS[interval] ? interval : "1m";
}

function toTimestampMs(value) {
if (value == null || value === "") return null;

if (value instanceof Date) {
const ms = value.getTime();
return Number.isFinite(ms) ? ms : null;
}

if (typeof value === "number") {
if (!Number.isFinite(value)) return null;
return value > 1e12 ? Math.floor(value) : Math.floor(value * 1000);
}

const raw = String(value).trim();
if (!raw) return null;

if (/^\d+$/.test(raw)) {
const numeric = Number(raw);
if (!Number.isFinite(numeric)) return null;
return numeric > 1e12 ? Math.floor(numeric) : Math.floor(numeric * 1000);
}

const hasExplicitTimezone =
/z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw);

if (!hasExplicitTimezone && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
const sqliteUtc = Date.parse(raw.replace(" ", "T") + "Z");
return Number.isFinite(sqliteUtc) ? sqliteUtc : null;
}

const parsed = Date.parse(raw);
return Number.isFinite(parsed) ? parsed : null;
}

function toIsoString(timestampMs) {
return Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : null;
}

function normalizeSide(value) {
return String(value || "buy").toLowerCase() === "sell" ? "sell" : "buy";
}

function derivePrice(trade = {}) {
const directPrice = toNumber(
trade.price_sol ?? trade.price ?? trade.execution_price,
0
);

if (directPrice > 0) {
return directPrice;
}

const baseAmount = toNumber(
trade.base_amount ?? trade.sol_amount ?? trade.amount_base,
0
);
const tokenAmount = toNumber(
trade.token_amount ?? trade.amount_token ?? trade.amount,
0
);

if (baseAmount > 0 && tokenAmount > 0) {
return baseAmount / tokenAmount;
}

return 0;
}

function normalizeTrade(trade = {}) {
const timestampRaw =
trade.timestamp ??
trade.created_at ??
trade.executed_at ??
trade.time ??
null;

const timestampMs = toTimestampMs(timestampRaw);
const price = derivePrice(trade);
const tokenAmount = toNumber(
trade.token_amount ?? trade.amount_token ?? trade.amount,
0
);
const baseAmount = toNumber(
trade.base_amount ?? trade.sol_amount ?? trade.amount_base,
0
);

return {
id: trade.id ?? null,
timestamp: timestampMs ? toIsoString(timestampMs) : null,
timestampMs,
side: normalizeSide(trade.side),
price,
tokenAmount,
baseAmount,
};
}

function getBucketStart(timestamp, interval) {
const normalizedInterval = normalizeInterval(interval);
const ms = INTERVAL_TO_MS[normalizedInterval];
const time = toTimestampMs(timestamp);
if (!Number.isFinite(time)) return null;
return Math.floor(time / ms) * ms;
}

function createBucket(bucketStart, trade) {
return {
bucket_start: toIsoString(bucketStart),
open: trade.price,
high: trade.price,
low: trade.price,
close: trade.price,
volume_base: round(trade.baseAmount),
volume_token: round(trade.tokenAmount),
buys: trade.side === "buy" ? 1 : 0,
sells: trade.side === "sell" ? 1 : 0,
trade_count: 1,
buy_volume_base: round(trade.side === "buy" ? trade.baseAmount : 0),
sell_volume_base: round(trade.side === "sell" ? trade.baseAmount : 0),
buy_volume_token: round(trade.side === "buy" ? trade.tokenAmount : 0),
sell_volume_token: round(trade.side === "sell" ? trade.tokenAmount : 0),
vwap_numerator: round(trade.price * trade.baseAmount),
first_trade_at: trade.timestamp,
last_trade_at: trade.timestamp,
};
}

function updateBucket(bucket, trade) {
bucket.high = Math.max(bucket.high, trade.price);
bucket.low = Math.min(bucket.low, trade.price);
bucket.close = trade.price;
bucket.volume_base = round(bucket.volume_base + trade.baseAmount);
bucket.volume_token = round(bucket.volume_token + trade.tokenAmount);
bucket.trade_count += 1;
bucket.last_trade_at = trade.timestamp;

if (trade.side === "buy") {
bucket.buys += 1;
bucket.buy_volume_base = round(bucket.buy_volume_base + trade.baseAmount);
bucket.buy_volume_token = round(bucket.buy_volume_token + trade.tokenAmount);
} else {
bucket.sells += 1;
bucket.sell_volume_base = round(bucket.sell_volume_base + trade.baseAmount);
bucket.sell_volume_token = round(bucket.sell_volume_token + trade.tokenAmount);
}

bucket.vwap_numerator = round(bucket.vwap_numerator + trade.price * trade.baseAmount);
}

function finalizeBucket(bucket) {
const volumeBase = toNumber(bucket.volume_base, 0);
const open = toNumber(bucket.open, 0);
const close = toNumber(bucket.close, 0);

return {
bucket_start: bucket.bucket_start,
open: round(bucket.open),
high: round(bucket.high),
low: round(bucket.low),
close: round(bucket.close),
volume_base: round(bucket.volume_base),
volume_token: round(bucket.volume_token),
buys: bucket.buys,
sells: bucket.sells,
trade_count: bucket.trade_count,
buy_volume_base: round(bucket.buy_volume_base),
sell_volume_base: round(bucket.sell_volume_base),
buy_volume_token: round(bucket.buy_volume_token),
sell_volume_token: round(bucket.sell_volume_token),
vwap: volumeBase > 0 ? round(bucket.vwap_numerator / volumeBase) : round(close),
first_trade_at: bucket.first_trade_at,
last_trade_at: bucket.last_trade_at,
change: round(close - open),
change_pct: open > 0 ? round(((close - open) / open) * 100, 8) : 0,
is_bullish: close >= open,
};
}

export function buildCandlesFromTrades(trades = [], interval = "1m") {
const normalizedInterval = normalizeInterval(interval);
const bucketMap = new Map();

const normalizedTrades = (Array.isArray(trades) ? trades : [])
.map(normalizeTrade)
.filter((trade) => trade.timestampMs && trade.price > 0)
.sort((a, b) => {
if (a.timestampMs !== b.timestampMs) {
return a.timestampMs - b.timestampMs;
}
return String(a.id || "").localeCompare(String(b.id || ""));
});

for (const trade of normalizedTrades) {
const bucketStart = getBucketStart(trade.timestampMs, normalizedInterval);
if (!Number.isFinite(bucketStart)) continue;

const key = String(bucketStart);
const existing = bucketMap.get(key);

if (!existing) {
bucketMap.set(key, createBucket(bucketStart, trade));
continue;
}

updateBucket(existing, trade);
}

return Array.from(bucketMap.values())
.sort(
(a, b) =>
toTimestampMs(a.bucket_start) - toTimestampMs(b.bucket_start)
)
.map(finalizeBucket);
}

export function fillMissingCandles(candles = [], interval = "1m", limit = 120) {
if (!Array.isArray(candles) || !candles.length) return [];

const normalizedInterval = normalizeInterval(interval);
const ms = INTERVAL_TO_MS[normalizedInterval];

const sorted = [...candles]
.filter((candle) => Number.isFinite(toTimestampMs(candle?.bucket_start)))
.sort(
(a, b) =>
toTimestampMs(a.bucket_start) - toTimestampMs(b.bucket_start)
);

if (!sorted.length) return [];

const out = [];
let prev = null;

for (const candle of sorted) {
const currentTs = toTimestampMs(candle.bucket_start);

if (prev) {
let nextTs = toTimestampMs(prev.bucket_start) + ms;

while (nextTs < currentTs) {
const carry = round(prev.close);
out.push({
bucket_start: toIsoString(nextTs),
open: carry,
high: carry,
low: carry,
close: carry,
volume_base: 0,
volume_token: 0,
buys: 0,
sells: 0,
trade_count: 0,
buy_volume_base: 0,
sell_volume_base: 0,
buy_volume_token: 0,
sell_volume_token: 0,
vwap: carry,
first_trade_at: null,
last_trade_at: null,
change: 0,
change_pct: 0,
is_bullish: true,
});
nextTs += ms;
}
}

out.push({
bucket_start: candle.bucket_start,
open: round(candle.open),
high: round(candle.high),
low: round(candle.low),
close: round(candle.close),
volume_base: round(candle.volume_base),
volume_token: round(candle.volume_token),
buys: toNumber(candle.buys, 0),
sells: toNumber(candle.sells, 0),
trade_count: toNumber(candle.trade_count, toNumber(candle.buys, 0) + toNumber(candle.sells, 0)),
buy_volume_base: round(candle.buy_volume_base),
sell_volume_base: round(candle.sell_volume_base),
buy_volume_token: round(candle.buy_volume_token),
sell_volume_token: round(candle.sell_volume_token),
vwap: round(
candle.vwap != null
? candle.vwap
: candle.close
),
first_trade_at: candle.first_trade_at || null,
last_trade_at: candle.last_trade_at || null,
change: round(
candle.change != null
? candle.change
: toNumber(candle.close, 0) - toNumber(candle.open, 0)
),
change_pct: round(
candle.change_pct != null
? candle.change_pct
: toNumber(candle.open, 0) > 0
? ((toNumber(candle.close, 0) - toNumber(candle.open, 0)) / toNumber(candle.open, 0)) * 100
: 0,
8
),
is_bullish:
typeof candle.is_bullish === "boolean"
? candle.is_bullish
: toNumber(candle.close, 0) >= toNumber(candle.open, 0),
});

prev = candle;
}

const safeLimit = Math.max(1, Math.floor(toNumber(limit, 120)));
return out.slice(-safeLimit);
}

export function getIntervalMs(interval = "1m") {
return INTERVAL_TO_MS[normalizeInterval(interval)];
}
