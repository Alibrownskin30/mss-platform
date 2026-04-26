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
if (value === null || value === undefined || value === "") return fallback;
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

if (
!hasExplicitTimezone &&
/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
) {
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
timestamp: Number.isFinite(timestampMs) ? toIsoString(timestampMs) : null,
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

function buildCandlePayload({
bucketStart,
open,
high,
low,
close,
volumeBase = 0,
volumeToken = 0,
buys = 0,
sells = 0,
tradeCount = 0,
buyVolumeBase = 0,
sellVolumeBase = 0,
buyVolumeToken = 0,
sellVolumeToken = 0,
firstTradeAt = null,
lastTradeAt = null,
isSynthetic = false,
}) {
const safeOpen = round(open);
const safeHigh = round(high);
const safeLow = round(low);
const safeClose = round(close);
const safeVolumeBase = round(volumeBase);
const safeVolumeToken = round(volumeToken);

const vwap =
safeVolumeToken > 0 ? round(safeVolumeBase / safeVolumeToken) : safeClose;

const change = round(safeClose - safeOpen);
const changePct =
safeOpen > 0 ? round(((safeClose - safeOpen) / safeOpen) * 100, 8) : 0;

return {
bucket_start: toIsoString(bucketStart),
open: safeOpen,
high: safeHigh,
low: safeLow,
close: safeClose,

volume_base: safeVolumeBase,
volume_sol: safeVolumeBase,
volume_token: safeVolumeToken,

buys,
sells,
trade_count: tradeCount,

buy_volume_base: round(buyVolumeBase),
buy_volume_sol: round(buyVolumeBase),
sell_volume_base: round(sellVolumeBase),
sell_volume_sol: round(sellVolumeBase),
buy_volume_token: round(buyVolumeToken),
sell_volume_token: round(sellVolumeToken),

vwap,
first_trade_at: firstTradeAt,
last_trade_at: lastTradeAt,

change,
change_pct: changePct,
is_bullish: safeClose >= safeOpen,
is_synthetic: Boolean(isSynthetic),
};
}

function createBucket(bucketStart, trade) {
return {
bucketStart,
open: trade.price,
high: trade.price,
low: trade.price,
close: trade.price,

volumeBase: round(trade.baseAmount),
volumeToken: round(trade.tokenAmount),

buys: trade.side === "buy" ? 1 : 0,
sells: trade.side === "sell" ? 1 : 0,
tradeCount: 1,

buyVolumeBase: round(trade.side === "buy" ? trade.baseAmount : 0),
sellVolumeBase: round(trade.side === "sell" ? trade.baseAmount : 0),
buyVolumeToken: round(trade.side === "buy" ? trade.tokenAmount : 0),
sellVolumeToken: round(trade.side === "sell" ? trade.tokenAmount : 0),

firstTradeAt: trade.timestamp,
lastTradeAt: trade.timestamp,
};
}

function updateBucket(bucket, trade) {
bucket.high = Math.max(bucket.high, trade.price);
bucket.low = Math.min(bucket.low, trade.price);
bucket.close = trade.price;

bucket.volumeBase = round(bucket.volumeBase + trade.baseAmount);
bucket.volumeToken = round(bucket.volumeToken + trade.tokenAmount);

bucket.tradeCount += 1;
bucket.lastTradeAt = trade.timestamp;

if (trade.side === "buy") {
bucket.buys += 1;
bucket.buyVolumeBase = round(bucket.buyVolumeBase + trade.baseAmount);
bucket.buyVolumeToken = round(bucket.buyVolumeToken + trade.tokenAmount);
} else {
bucket.sells += 1;
bucket.sellVolumeBase = round(bucket.sellVolumeBase + trade.baseAmount);
bucket.sellVolumeToken = round(bucket.sellVolumeToken + trade.tokenAmount);
}
}

function finalizeBucket(bucket) {
return buildCandlePayload({
bucketStart: bucket.bucketStart,
open: bucket.open,
high: bucket.high,
low: bucket.low,
close: bucket.close,
volumeBase: bucket.volumeBase,
volumeToken: bucket.volumeToken,
buys: bucket.buys,
sells: bucket.sells,
tradeCount: bucket.tradeCount,
buyVolumeBase: bucket.buyVolumeBase,
sellVolumeBase: bucket.sellVolumeBase,
buyVolumeToken: bucket.buyVolumeToken,
sellVolumeToken: bucket.sellVolumeToken,
firstTradeAt: bucket.firstTradeAt,
lastTradeAt: bucket.lastTradeAt,
isSynthetic: false,
});
}

function normalizeExistingCandle(candle = {}) {
const bucketStartMs = toTimestampMs(candle.bucket_start);
const open = toNumber(candle.open, 0);
const high = toNumber(candle.high, open);
const low = toNumber(candle.low, open);
const close = toNumber(candle.close, open);

const volumeBase = toNumber(
candle.volume_base ?? candle.volume_sol,
0
);
const volumeToken = toNumber(candle.volume_token, 0);

const buys = Math.max(0, Math.floor(toNumber(candle.buys, 0)));
const sells = Math.max(0, Math.floor(toNumber(candle.sells, 0)));

return buildCandlePayload({
bucketStart: bucketStartMs,
open,
high,
low,
close,
volumeBase,
volumeToken,
buys,
sells,
tradeCount: Math.max(
0,
Math.floor(toNumber(candle.trade_count, buys + sells))
),
buyVolumeBase: toNumber(
candle.buy_volume_base ?? candle.buy_volume_sol,
0
),
sellVolumeBase: toNumber(
candle.sell_volume_base ?? candle.sell_volume_sol,
0
),
buyVolumeToken: toNumber(candle.buy_volume_token, 0),
sellVolumeToken: toNumber(candle.sell_volume_token, 0),
firstTradeAt: candle.first_trade_at || null,
lastTradeAt: candle.last_trade_at || null,
isSynthetic: Boolean(candle.is_synthetic),
});
}

function createSyntheticCandle(bucketStart, carryPrice) {
const carry = round(carryPrice);

return buildCandlePayload({
bucketStart,
open: carry,
high: carry,
low: carry,
close: carry,
volumeBase: 0,
volumeToken: 0,
buys: 0,
sells: 0,
tradeCount: 0,
buyVolumeBase: 0,
sellVolumeBase: 0,
buyVolumeToken: 0,
sellVolumeToken: 0,
firstTradeAt: null,
lastTradeAt: null,
isSynthetic: true,
});
}

export function buildCandlesFromTrades(trades = [], interval = "1m") {
const normalizedInterval = normalizeInterval(interval);
const bucketMap = new Map();

const normalizedTrades = (Array.isArray(trades) ? trades : [])
.map(normalizeTrade)
.filter((trade) => Number.isFinite(trade.timestampMs) && trade.price > 0)
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
.sort((a, b) => a.bucketStart - b.bucketStart)
.map(finalizeBucket);
}

export function fillMissingCandles(candles = [], interval = "1m", limit = 120) {
if (!Array.isArray(candles) || !candles.length) return [];

const normalizedInterval = normalizeInterval(interval);
const ms = INTERVAL_TO_MS[normalizedInterval];
const safeLimit = Math.max(1, Math.floor(toNumber(limit, 120)));

const sorted = [...candles]
.filter((candle) => Number.isFinite(toTimestampMs(candle?.bucket_start)))
.sort((a, b) => toTimestampMs(a.bucket_start) - toTimestampMs(b.bucket_start));

if (!sorted.length) return [];

const out = [];
let prev = null;

for (const candle of sorted) {
const normalizedCandle = normalizeExistingCandle(candle);
const currentTs = toTimestampMs(normalizedCandle.bucket_start);

if (prev) {
const prevTs = toTimestampMs(prev.bucket_start);
let nextTs = prevTs + ms;

while (nextTs < currentTs) {
out.push(createSyntheticCandle(nextTs, prev.close));

if (out.length > safeLimit * 2) {
out.splice(0, out.length - safeLimit * 2);
}

nextTs += ms;
}
}

out.push(normalizedCandle);

if (out.length > safeLimit * 2) {
out.splice(0, out.length - safeLimit * 2);
}

prev = normalizedCandle;
}

return out.slice(-safeLimit);
}

export function getIntervalMs(interval = "1m") {
return INTERVAL_TO_MS[normalizeInterval(interval)];
}
