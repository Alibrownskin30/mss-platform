import { getCachedSolUsdPrice, getSolPriceSnapshot } from "./sol-price.js";

function toNumber(value, fallback = 0) {
if (value === null || value === undefined || value === "") return fallback;
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function chooseFirstPositive(...values) {
for (const value of values) {
const num = toNumber(value, 0);
if (num > 0) return num;
}

return 0;
}

function normalizeTrade(trade = {}) {
const tokenAmount = toNumber(
trade.token_amount ?? trade.amount_token ?? trade.amount,
0
);
const baseAmountSol = toNumber(
trade.base_amount ?? trade.sol_amount ?? trade.amount_base,
0
);

const explicitPriceSol = toNumber(
trade.price_sol ?? trade.price ?? trade.execution_price,
0
);

const derivedPriceSol =
tokenAmount > 0 && baseAmountSol > 0 ? baseAmountSol / tokenAmount : 0;

return {
timestamp: trade.timestamp || trade.created_at || trade.executed_at || null,
side: String(trade.side || "buy").toLowerCase() === "sell" ? "sell" : "buy",
priceSol: explicitPriceSol > 0 ? explicitPriceSol : derivedPriceSol,
tokenAmount,
baseAmountSol,
};
}

function getLastNonZeroCandleClose(candles = []) {
for (let i = candles.length - 1; i >= 0; i -= 1) {
const close = toNumber(candles[i]?.close, 0);
if (close > 0) return close;
}

return 0;
}

function getFirstNonZeroCandleOpen(candles = []) {
for (let i = 0; i < candles.length; i += 1) {
const open = toNumber(candles[i]?.open, 0);
if (open > 0) return open;
}

return 0;
}

function getHighLowFromCandles(candles = []) {
let high = 0;
let low = 0;

for (const candle of candles) {
const candleHigh = toNumber(candle?.high, 0);
const candleLow = toNumber(candle?.low, 0);

if (candleHigh > 0) {
high = high === 0 ? candleHigh : Math.max(high, candleHigh);
}

if (candleLow > 0) {
low = low === 0 ? candleLow : Math.min(low, candleLow);
}
}

return { high, low };
}

function getPoolSpotPriceSol({ launch = {}, pool = {} }) {
const poolSolReserve = toNumber(
pool.sol_reserve ??
launch.sol_reserve ??
launch.internal_pool_sol ??
launch.liquidity_sol ??
launch.liquidity,
0
);

const poolTokenReserve = toNumber(
pool.token_reserve ?? launch.token_reserve ?? launch.internal_pool_tokens,
0
);

if (poolSolReserve <= 0 || poolTokenReserve <= 0) return 0;

return poolSolReserve / poolTokenReserve;
}

function inferSolUsdPrice({ launch = {}, pool = {}, fallback = 0 }) {
const liveCachedSolUsd = getCachedSolUsdPrice();
if (liveCachedSolUsd > 0) {
return liveCachedSolUsd;
}

const launchSolUsd = toNumber(launch.sol_usd_price, 0);
if (launchSolUsd > 0) {
return launchSolUsd;
}

const launchLiquidityUsd = toNumber(
launch.current_liquidity_usd ?? launch.liquidity_usd,
0
);

const poolSolReserve = toNumber(
pool.sol_reserve ??
launch.sol_reserve ??
launch.internal_pool_sol ??
launch.liquidity_sol ??
launch.liquidity,
0
);

if (launchLiquidityUsd > 0 && poolSolReserve > 0) {
const impliedSolUsd = launchLiquidityUsd / (poolSolReserve * 2);
if (impliedSolUsd > 0) return impliedSolUsd;
}

return toNumber(fallback, 0);
}

export function buildMarketStats({
launch = {},
pool = {},
trades = [],
candles = [],
}) {
const normalizedTrades = trades
.map(normalizeTrade)
.filter((trade) => trade.priceSol > 0)
.sort((a, b) => {
const aTime = new Date(a.timestamp).getTime();
const bTime = new Date(b.timestamp).getTime();

const safeA = Number.isFinite(aTime) ? aTime : 0;
const safeB = Number.isFinite(bTime) ? bTime : 0;

return safeA - safeB;
});

const now = Date.now();
const dayAgo = now - 24 * 60 * 60 * 1000;

const trades24h = normalizedTrades.filter((trade) => {
const ts = new Date(trade.timestamp).getTime();
return Number.isFinite(ts) && ts >= dayAgo;
});

const lastTrade = normalizedTrades[normalizedTrades.length - 1] || null;
const firstTrade24h = trades24h[0] || null;
const firstTradeOverall = normalizedTrades[0] || null;

const candleLastClose = getLastNonZeroCandleClose(candles);
const candleFirstOpen = getFirstNonZeroCandleOpen(candles);
const candleHighLow = getHighLowFromCandles(candles);

const launchPriceSol = toNumber(launch.price_sol ?? launch.price, 0);
const poolSpotPriceSol = getPoolSpotPriceSol({ launch, pool });

const lastPriceSol = chooseFirstPositive(
lastTrade?.priceSol,
candleLastClose,
launchPriceSol,
poolSpotPriceSol
);

const openPriceSol = chooseFirstPositive(
firstTrade24h?.priceSol,
firstTradeOverall?.priceSol,
candleFirstOpen,
launchPriceSol,
poolSpotPriceSol,
lastPriceSol
);

const priceChangePct =
openPriceSol > 0 ? ((lastPriceSol - openPriceSol) / openPriceSol) * 100 : 0;

let volume24hSol = 0;
let buys24h = 0;
let sells24h = 0;
let high24hSol = 0;
let low24hSol = 0;

for (const trade of trades24h) {
volume24hSol += trade.baseAmountSol;
buys24h += trade.side === "buy" ? 1 : 0;
sells24h += trade.side === "sell" ? 1 : 0;

if (trade.priceSol > 0) {
high24hSol =
high24hSol === 0 ? trade.priceSol : Math.max(high24hSol, trade.priceSol);
low24hSol =
low24hSol === 0 ? trade.priceSol : Math.min(low24hSol, trade.priceSol);
}
}

if (!high24hSol) {
high24hSol = chooseFirstPositive(candleHighLow.high, lastPriceSol);
}

if (!low24hSol) {
low24hSol = chooseFirstPositive(candleHighLow.low, lastPriceSol);
}

const totalSupply = toNumber(
launch.total_supply ?? launch.final_supply ?? launch.supply,
0
);

const circulatingSupply = toNumber(
launch.circulating_supply ?? totalSupply,
0
);

const poolSolReserve = toNumber(
pool.sol_reserve ??
launch.sol_reserve ??
launch.internal_pool_sol ??
launch.liquidity_sol ??
launch.liquidity,
0
);

const poolTokenReserve = toNumber(
pool.token_reserve ?? launch.token_reserve ?? launch.internal_pool_tokens,
0
);

const liquidityUsdDirect = toNumber(
launch.current_liquidity_usd ?? launch.liquidity_usd,
0
);

const solUsdPrice = inferSolUsdPrice({
launch,
pool,
fallback: 0,
});

const solPriceSnapshot = getSolPriceSnapshot();

const priceUsd =
lastPriceSol > 0 && solUsdPrice > 0 ? lastPriceSol * solUsdPrice : 0;

const openPriceUsd =
openPriceSol > 0 && solUsdPrice > 0 ? openPriceSol * solUsdPrice : 0;

const marketCapSol =
lastPriceSol > 0 && circulatingSupply > 0
? lastPriceSol * circulatingSupply
: 0;

const marketCapUsd =
priceUsd > 0 && circulatingSupply > 0
? priceUsd * circulatingSupply
: 0;

const fdvSol =
lastPriceSol > 0 && totalSupply > 0 ? lastPriceSol * totalSupply : marketCapSol;

const fdvUsd =
priceUsd > 0 && totalSupply > 0 ? priceUsd * totalSupply : marketCapUsd;

const liquiditySol = poolSolReserve > 0 ? poolSolReserve : 0;
const totalLpLiquiditySol = liquiditySol > 0 ? liquiditySol * 2 : 0;

const liquidityUsd =
liquiditySol > 0 && solUsdPrice > 0
? liquiditySol * solUsdPrice
: liquidityUsdDirect > 0
? liquidityUsdDirect / 2
: 0;

const totalLpLiquidityUsd =
totalLpLiquiditySol > 0 && solUsdPrice > 0
? totalLpLiquiditySol * solUsdPrice
: liquidityUsdDirect > 0
? liquidityUsdDirect
: 0;

const volume24hUsd =
volume24hSol > 0 && solUsdPrice > 0 ? volume24hSol * solUsdPrice : 0;

const high24hUsd =
high24hSol > 0 && solUsdPrice > 0 ? high24hSol * solUsdPrice : 0;

const low24hUsd =
low24hSol > 0 && solUsdPrice > 0 ? low24hSol * solUsdPrice : 0;

const tradeCount24h = buys24h + sells24h;

return {
price: lastPriceSol,
price_sol: lastPriceSol,
price_usd: priceUsd,

open_price: openPriceSol,
open_price_sol: openPriceSol,
open_price_usd: openPriceUsd,

price_change_pct: priceChangePct,

high_24h: high24hSol,
high_24h_sol: high24hSol,
high_24h_usd: high24hUsd,

low_24h: low24hSol,
low_24h_sol: low24hSol,
low_24h_usd: low24hUsd,

volume_24h: volume24hSol,
volume_24h_sol: volume24hSol,
volume_24h_usd: volume24hUsd,

buys_24h: buys24h,
sells_24h: sells24h,

trades_24h: tradeCount24h,
tx_count_24h: tradeCount24h,
trade_count_24h: tradeCount24h,
trade_count_total: normalizedTrades.length,
trades_total: normalizedTrades.length,

liquidity: liquiditySol,
liquidity_sol: liquiditySol,
liquidity_usd: liquidityUsd,

total_lp_liquidity_sol: totalLpLiquiditySol,
total_lp_liquidity_usd: totalLpLiquidityUsd,

market_cap: marketCapSol,
market_cap_sol: marketCapSol,
market_cap_usd: marketCapUsd,

fdv: fdvSol,
fdv_sol: fdvSol,
fdv_usd: fdvUsd,

circulating_supply: circulatingSupply,
total_supply: totalSupply,

pool_sol_reserve: poolSolReserve,
pool_token_reserve: poolTokenReserve,

sol_usd_price: solUsdPrice,
sol_usd_source: solPriceSnapshot.sol_usd_source,
sol_usd_price_updated_at: solPriceSnapshot.sol_usd_price_updated_at,
sol_usd_block_id: solPriceSnapshot.sol_usd_block_id,
sol_usd_price_change_24h: solPriceSnapshot.sol_usd_price_change_24h,

updated_at: new Date().toISOString(),
};
}
