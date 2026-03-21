function toNumber(value, fallback = 0) {
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function normalizeTrade(trade = {}) {
return {
timestamp: trade.timestamp || trade.created_at || trade.executed_at || null,
side: String(trade.side || "buy").toLowerCase() === "sell" ? "sell" : "buy",
priceSol: toNumber(trade.price_sol ?? trade.price ?? trade.execution_price, 0),
tokenAmount: toNumber(trade.token_amount ?? trade.amount_token ?? trade.amount, 0),
baseAmountSol: toNumber(trade.base_amount ?? trade.sol_amount ?? trade.amount_base, 0),
};
}

function inferSolUsdPrice({
launch = {},
lastPriceSol = 0,
fallback = 0,
}) {
const liquiditySol = toNumber(
launch.liquidity_sol ??
launch.internal_pool_sol ??
launch.liquidity ??
0,
0
);

const liquidityUsd = toNumber(
launch.current_liquidity_usd ??
launch.liquidity_usd ??
0,
0
);

// If liquidity is stored as one-sided SOL and USD, derive SOL/USD from that.
// If liquidity USD represents the total LP and liquiditySol is one-sided pool SOL,
// then total SOL-side equivalent is liquiditySol * 2.
if (liquidityUsd > 0 && liquiditySol > 0) {
const totalLiquiditySolEquivalent = liquiditySol * 2;
if (totalLiquiditySolEquivalent > 0) {
return liquidityUsd / totalLiquiditySolEquivalent;
}
}

return toNumber(launch.sol_usd_price, fallback);
}

export function buildMarketStats({
launch = {},
trades = [],
candles = [],
}) {
const normalizedTrades = trades
.map(normalizeTrade)
.filter((trade) => trade.priceSol > 0)
.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

const now = Date.now();
const dayAgo = now - 24 * 60 * 60 * 1000;

const lastTrade = normalizedTrades[normalizedTrades.length - 1] || null;

const trades24h = normalizedTrades.filter((trade) => {
const ts = new Date(trade.timestamp).getTime();
return Number.isFinite(ts) && ts >= dayAgo;
});

const firstTrade24h = trades24h[0] || null;
const firstTradeOverall = normalizedTrades[0] || null;

const lastPriceSol = toNumber(lastTrade?.priceSol, 0);
const openPriceSol = toNumber(
firstTrade24h?.priceSol ?? firstTradeOverall?.priceSol ?? lastPriceSol,
0
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

if (high24hSol === 0 || trade.priceSol > high24hSol) high24hSol = trade.priceSol;
if (low24hSol === 0 || trade.priceSol < low24hSol) low24hSol = trade.priceSol;
}

if (!high24hSol && candles.length) {
high24hSol = Math.max(...candles.map((c) => toNumber(c.high, 0)));
}

if (!low24hSol && candles.length) {
const lows = candles.map((c) => toNumber(c.low, 0)).filter((v) => v > 0);
low24hSol = lows.length ? Math.min(...lows) : 0;
}

const totalSupply = toNumber(
launch.total_supply ?? launch.final_supply ?? launch.supply,
0
);

const circulatingSupply = toNumber(
launch.circulating_supply ?? totalSupply,
0
);

const liquiditySol = toNumber(
launch.liquidity_sol ??
launch.internal_pool_sol ??
launch.liquidity ??
0,
0
);

const liquidityUsdDirect = toNumber(
launch.current_liquidity_usd ?? launch.liquidity_usd,
0
);

const solUsdPrice = inferSolUsdPrice({
launch,
lastPriceSol,
fallback: 0,
});

const priceUsd = lastPriceSol > 0 && solUsdPrice > 0 ? lastPriceSol * solUsdPrice : 0;
const openPriceUsd = openPriceSol > 0 && solUsdPrice > 0 ? openPriceSol * solUsdPrice : 0;

const marketCapSol =
lastPriceSol > 0 && circulatingSupply > 0 ? lastPriceSol * circulatingSupply : 0;

const marketCapUsd =
priceUsd > 0 && circulatingSupply > 0 ? priceUsd * circulatingSupply : 0;

const fdvSol =
lastPriceSol > 0 && totalSupply > 0 ? lastPriceSol * totalSupply : marketCapSol;

const fdvUsd =
priceUsd > 0 && totalSupply > 0 ? priceUsd * totalSupply : marketCapUsd;

const liquidityUsd =
liquidityUsdDirect > 0
? liquidityUsdDirect
: liquiditySol > 0 && solUsdPrice > 0
? liquiditySol * 2 * solUsdPrice
: 0;

const volume24hUsd =
volume24hSol > 0 && solUsdPrice > 0 ? volume24hSol * solUsdPrice : 0;

const high24hUsd =
high24hSol > 0 && solUsdPrice > 0 ? high24hSol * solUsdPrice : 0;

const low24hUsd =
low24hSol > 0 && solUsdPrice > 0 ? low24hSol * solUsdPrice : 0;

return {
price_sol: lastPriceSol,
price_usd: priceUsd,
open_price_sol: openPriceSol,
open_price_usd: openPriceUsd,

price_change_pct: priceChangePct,

high_24h_sol: high24hSol,
high_24h_usd: high24hUsd,
low_24h_sol: low24hSol,
low_24h_usd: low24hUsd,

volume_24h_sol: volume24hSol,
volume_24h_usd: volume24hUsd,

buys_24h: buys24h,
sells_24h: sells24h,
trade_count_24h: buys24h + sells24h,
trade_count_total: normalizedTrades.length,

liquidity_sol: liquiditySol * 2,
liquidity_usd: liquidityUsd,

market_cap_sol: marketCapSol,
market_cap_usd: marketCapUsd,

fdv_sol: fdvSol,
fdv_usd: fdvUsd,

circulating_supply: circulatingSupply,
total_supply: totalSupply,

sol_usd_price: solUsdPrice,
updated_at: new Date().toISOString(),
};
}