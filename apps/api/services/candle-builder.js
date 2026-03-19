const INTERVAL_TO_MS = {
"1m": 60_000,
"5m": 5 * 60_000,
"15m": 15 * 60_000,
"1h": 60 * 60_000,
"4h": 4 * 60 * 60_000,
"1d": 24 * 60 * 60_000,
};

function toNumber(value, fallback = 0) {
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function normalizeTrade(trade = {}) {
const timestamp =
trade.timestamp ||
trade.created_at ||
trade.executed_at ||
null;

return {
id: trade.id || null,
timestamp,
side: String(trade.side || "buy").toLowerCase() === "sell" ? "sell" : "buy",
price: toNumber(trade.price_sol ?? trade.price ?? trade.execution_price, 0),
tokenAmount: toNumber(trade.token_amount ?? trade.amount_token ?? trade.amount, 0),
baseAmount: toNumber(trade.base_amount ?? trade.sol_amount ?? trade.amount_base, 0),
};
}

function getBucketStart(timestamp, interval) {
const ms = INTERVAL_TO_MS[interval] || INTERVAL_TO_MS["1m"];
const time = new Date(timestamp).getTime();
if (!Number.isFinite(time)) return null;
return Math.floor(time / ms) * ms;
}

export function buildCandlesFromTrades(trades = [], interval = "1m") {
const bucketMap = new Map();

const normalized = trades
.map(normalizeTrade)
.filter((trade) => trade.timestamp && trade.price > 0)
.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

for (const trade of normalized) {
const bucketStart = getBucketStart(trade.timestamp, interval);
if (!bucketStart) continue;

const key = String(bucketStart);
const existing = bucketMap.get(key);

if (!existing) {
bucketMap.set(key, {
bucket_start: new Date(bucketStart).toISOString(),
open: trade.price,
high: trade.price,
low: trade.price,
close: trade.price,
volume_base: trade.baseAmount,
volume_token: trade.tokenAmount,
buys: trade.side === "buy" ? 1 : 0,
sells: trade.side === "sell" ? 1 : 0,
});
continue;
}

existing.high = Math.max(existing.high, trade.price);
existing.low = Math.min(existing.low, trade.price);
existing.close = trade.price;
existing.volume_base += trade.baseAmount;
existing.volume_token += trade.tokenAmount;
existing.buys += trade.side === "buy" ? 1 : 0;
existing.sells += trade.side === "sell" ? 1 : 0;
}

return Array.from(bucketMap.values()).sort(
(a, b) => new Date(a.bucket_start).getTime() - new Date(b.bucket_start).getTime()
);
}

export function fillMissingCandles(candles = [], interval = "1m", limit = 120) {
if (!candles.length) return [];

const ms = INTERVAL_TO_MS[interval] || INTERVAL_TO_MS["1m"];
const sorted = [...candles].sort(
(a, b) => new Date(a.bucket_start).getTime() - new Date(b.bucket_start).getTime()
);

const out = [];
let prev = null;

for (const candle of sorted) {
const currentTs = new Date(candle.bucket_start).getTime();

if (prev) {
let nextTs = new Date(prev.bucket_start).getTime() + ms;
while (nextTs < currentTs) {
out.push({
bucket_start: new Date(nextTs).toISOString(),
open: prev.close,
high: prev.close,
low: prev.close,
close: prev.close,
volume_base: 0,
volume_token: 0,
buys: 0,
sells: 0,
});
nextTs += ms;
}
}

out.push(candle);
prev = candle;
}

return out.slice(-limit);
}

export function getIntervalMs(interval = "1m") {
return INTERVAL_TO_MS[interval] || INTERVAL_TO_MS["1m"];
}
