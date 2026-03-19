function toNumber(value, fallback = 0) {
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function normalizeTrade(trade = {}) {
return {
timestamp: trade.timestamp || trade.created_at || trade.executed_at || null,
side: String(trade.side || "buy").toLowerCase() === "sell" ? "sell" : "buy",
price: toNumber(trade.price_sol ?? trade.price ?? trade.execution_price, 0),
tokenAmount: toNumber(trade.token_amount ?? trade.amount_token ?? trade.amount, 0),
baseAmount: toNumber(trade.base_amount ?? trade.sol_amount ?? trade.amount_base, 0),
};
}

export function buildMarketStats({
launch = {},
trades = [],
candles = [],
}) {
const normalizedTrades = trades
.map(normalizeTrade)
.filter((trade) => trade.price > 0)
.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

const lastTrade = normalizedTrades[normalizedTrades.length - 1] || null;
const firstTrade = normalizedTrades[0] || null;

const lastPrice = lastTrade?.price || 0;
const openPrice = firstTrade?.price || lastPrice || 0;

const priceChangePct =
openPrice > 0 ? ((lastPrice - openPrice) / openPrice) * 100 : 0;

let volume24h = 0;
let buys24h = 0;
let sells24h = 0;
let high24h = 0;
let low24h = 0;

const now = Date.now();
const dayAgo = now - 24 * 60 * 60 * 1000;

for (const trade of normalizedTrades) {
const ts = new Date(trade.timestamp).getTime();
if (!Number.isFinite(ts) || ts < dayAgo) continue;

volume24h += trade.baseAmount;
buys24h += trade.side === "buy" ? 1 : 0;
sells24h += trade.side === "sell" ? 1 : 0;

if (high24h === 0 || trade.price > high24h) high24h = trade.price;
if (low24h === 0 || trade.price < low24h) low24h = trade.price;
}

if (!high24h && candles.length) {
high24h = Math.max(...candles.map((c) => toNumber(c.high, 0)));
}

if (!low24h && candles.length) {
const lows = candles.map((c) => toNumber(c.low, 0)).filter(Boolean);
low24h = lows.length ? Math.min(...lows) : 0;
}

const circulatingSupply = toNumber(
launch.circulating_supply ?? launch.total_supply ?? launch.supply,
0
);

const marketCap = lastPrice > 0 && circulatingSupply > 0
? lastPrice * circulatingSupply
: 0;

const fdv = lastPrice > 0 && toNumber(launch.total_supply, 0) > 0
? lastPrice * toNumber(launch.total_supply, 0)
: marketCap;

const liquidity = toNumber(
launch.liquidity_usd ??
launch.current_liquidity_usd ??
launch.liquidity ??
0,
0
);

return {
last_price: lastPrice,
open_price: openPrice,
price_change_pct: priceChangePct,
volume_24h: volume24h,
buys_24h: buys24h,
sells_24h: sells24h,
high_24h: high24h,
low_24h: low24h,
liquidity,
market_cap: marketCap,
fdv,
updated_at: new Date().toISOString(),
};
}