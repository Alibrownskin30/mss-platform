import express from "express";
import db from "../db/index.js";

const router = express.Router();

const BASE_MAX_WALLET_PERCENT = 0.005; // 0.5%
const DAILY_INCREASE_PERCENT = 0.005; // +0.5% per day
const BUILDER_MAX_WALLET_PERCENT = 0.05; // 5%
const MSS_TRADING_FEE_PCT = 1;

const FEE_SPLIT = {
core: 0.5,
buyback: 0.3,
treasury: 0.2,
};

let walletBalanceColumnsCache = null;

function safeNum(value, fallback = 0) {
const n = Number(value);
return Number.isFinite(n) ? n : fallback;
}

function roundSol(value) {
return Number(safeNum(value, 0).toFixed(9));
}

function floorToken(value) {
return Math.floor(safeNum(value, 0));
}

function cleanText(value, max = 200) {
return String(value ?? "").trim().slice(0, max);
}

function getFeeBreakdown(totalFeeSol) {
const fee = roundSol(totalFeeSol);
return {
total: fee,
core: roundSol(fee * FEE_SPLIT.core),
buyback: roundSol(fee * FEE_SPLIT.buyback),
treasury: roundSol(fee * FEE_SPLIT.treasury),
};
}

function parseDbTime(value) {
if (!value) return null;
const raw = String(value).trim();
if (!raw) return null;

const hasExplicitTimezone =
/z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw);

if (!hasExplicitTimezone && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
const sqliteUtc = Date.parse(raw.replace(" ", "T") + "Z");
return Number.isFinite(sqliteUtc) ? sqliteUtc : null;
}

const direct = Date.parse(raw);
return Number.isFinite(direct) ? direct : null;
}

function getDaysSinceLaunch(launch) {
const launchStartMs = parseDbTime(
launch?.live_at || launch?.updated_at || launch?.created_at
);

if (!Number.isFinite(launchStartMs)) return 0;

const now = Date.now();
return Math.max(0, Math.floor((now - launchStartMs) / (24 * 60 * 60 * 1000)));
}

function getMaxWalletPercent(launch, isBuilderWallet = false) {
if (isBuilderWallet) {
return BUILDER_MAX_WALLET_PERCENT;
}

const daysSinceLaunch = getDaysSinceLaunch(launch);
return BASE_MAX_WALLET_PERCENT + daysSinceLaunch * DAILY_INCREASE_PERCENT;
}

function getMaxBuySol(launch, isBuilderWallet = false) {
if (isBuilderWallet) {
return Number.MAX_SAFE_INTEGER;
}

const daysSinceLaunch = getDaysSinceLaunch(launch);

if (daysSinceLaunch <= 0) return 0.5;
if (daysSinceLaunch === 1) return 1.0;
return 1.0;
}

function isLiveLaunch(launch) {
const status = String(launch?.status || "").toLowerCase();
return status === "live" || status === "graduated";
}

function getEffectiveTotalSupply(launch, token) {
return floorToken(
token?.supply ??
launch?.final_supply ??
launch?.circulating_supply ??
launch?.supply ??
0
);
}

function getMaxWalletTokens(launch, token, isBuilderWallet = false) {
const totalSupply = getEffectiveTotalSupply(launch, token);
const maxWalletPercent = getMaxWalletPercent(launch, isBuilderWallet);
return {
totalSupply,
maxWalletPercent,
maxWalletTokens: floorToken(totalSupply * maxWalletPercent),
};
}

async function getTokenLaunchAndPool(launchId) {
const launch = await db.get(`SELECT * FROM launches WHERE id = ?`, [launchId]);

if (!launch) {
return { error: "Launch not found" };
}

const token = await db.get(
`SELECT * FROM tokens WHERE launch_id = ? ORDER BY id DESC LIMIT 1`,
[launchId]
);

if (!token) {
return { error: "Token not found" };
}

const pool = await db.get(
`SELECT * FROM pools WHERE launch_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
[launchId]
);

if (!pool) {
return { error: "Pool not found" };
}

return { launch, token, pool };
}

async function getBuilderWalletByLaunch(launch) {
const direct = cleanText(launch?.builder_wallet || "", 120);
if (direct) return direct;

if (!launch?.builder_id) return "";

const builder = await db.get(`SELECT wallet FROM builders WHERE id = ?`, [
launch.builder_id,
]);

return cleanText(builder?.wallet || "", 120);
}

async function getWalletBalanceColumns() {
if (!walletBalanceColumnsCache) {
const rows = await db.all(`PRAGMA table_info(wallet_balances)`);
walletBalanceColumnsCache = new Set(rows.map((row) => String(row.name || "").trim()));
}
return walletBalanceColumnsCache;
}

async function getOrCreateWalletBalanceRow(launchId, wallet) {
const walletStr = cleanText(wallet, 120);

let walletBalance = await db.get(
`
SELECT *
FROM wallet_balances
WHERE launch_id = ? AND wallet = ?
LIMIT 1
`,
[launchId, walletStr]
);

if (!walletBalance) {
await db.run(
`
INSERT INTO wallet_balances (launch_id, wallet, token_amount)
VALUES (?, ?, 0)
`,
[launchId, walletStr]
);

walletBalance = await db.get(
`
SELECT *
FROM wallet_balances
WHERE launch_id = ? AND wallet = ?
LIMIT 1
`,
[launchId, walletStr]
);
}

return walletBalance || null;
}

async function getOrCreateWalletBalance(launchId, wallet) {
const walletRow = await getOrCreateWalletBalanceRow(launchId, wallet);

return {
wallet: cleanText(wallet, 120),
token_amount: floorToken(walletRow?.token_amount),
sol_balance: safeNum(walletRow?.sol_balance, 0),
};
}

async function setWalletBalance(launchId, wallet, tokenAmount) {
const walletStr = cleanText(wallet, 120);
const nextAmount = Math.max(0, floorToken(tokenAmount));

await db.run(
`
UPDATE wallet_balances
SET token_amount = ?
WHERE launch_id = ? AND wallet = ?
`,
[nextAmount, launchId, walletStr]
);

return nextAmount;
}

async function setWalletSolBalanceIfSupported(launchId, wallet, solBalance) {
const columns = await getWalletBalanceColumns();
if (!columns.has("sol_balance")) return null;

const walletStr = cleanText(wallet, 120);
const nextSolBalance = roundSol(solBalance);

await db.run(
`
UPDATE wallet_balances
SET sol_balance = ?
WHERE launch_id = ? AND wallet = ?
`,
[nextSolBalance, launchId, walletStr]
);

return nextSolBalance;
}

async function syncLaunchLiquidityFields(launchId, solReserve) {
const oneSidedLiquiditySol = roundSol(solReserve);
await db.run(
`
UPDATE launches
SET liquidity = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[oneSidedLiquiditySol, launchId]
);
}

async function syncLaunchPoolSnapshot(launchId, { solReserve, tokenReserve, price }) {
const updates = [];
const values = [];

if (solReserve != null) {
updates.push("internal_pool_sol = ?");
values.push(roundSol(solReserve));
}

if (tokenReserve != null) {
updates.push("internal_pool_tokens = ?");
values.push(floorToken(tokenReserve));
}

if (price != null && Number.isFinite(Number(price))) {
updates.push("price = ?");
values.push(Number(price));
}

updates.push("updated_at = CURRENT_TIMESTAMP");

values.push(launchId);

await db.run(
`
UPDATE launches
SET ${updates.join(", ")}
WHERE id = ?
`,
values
);
}

async function syncLaunchMarketFields(launchId, { solReserve, tokenReserve, price }) {
const circulatingRow = await db.get(
`
SELECT COALESCE(SUM(token_amount), 0) AS total
FROM wallet_balances
WHERE launch_id = ?
`,
[launchId]
);

const circulatingSupply = floorToken(circulatingRow?.total || 0);
const oneSidedLiquiditySol = roundSol(solReserve);
const safePrice = safeNum(price, 0);
const marketCap = safePrice > 0 ? safePrice * circulatingSupply : 0;

const volumeRow = await db.get(
`
SELECT COALESCE(SUM(sol_amount), 0) AS total
FROM trades
WHERE launch_id = ?
AND datetime(created_at) >= datetime('now', '-24 hours')
`,
[launchId]
);

const volume24h = roundSol(volumeRow?.total || 0);

await db.run(
`
UPDATE launches
SET
liquidity = ?,
internal_pool_sol = ?,
internal_pool_tokens = ?,
price = ?,
circulating_supply = ?,
market_cap = ?,
volume_24h = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[
oneSidedLiquiditySol,
oneSidedLiquiditySol,
floorToken(tokenReserve),
safePrice,
circulatingSupply,
marketCap,
volume24h,
launchId,
]
);
}

async function getWalletSolDelta(launchId, wallet) {
const walletStr = cleanText(wallet, 120);
if (!walletStr) return 0;

const rows = await db.all(
`
SELECT side, sol_amount
FROM trades
WHERE launch_id = ? AND wallet = ?
ORDER BY id ASC
`,
[launchId, walletStr]
);

let delta = 0;

for (const row of rows) {
const side = String(row?.side || "").toLowerCase();
const solAmount = safeNum(row?.sol_amount, 0);

if (side === "sell") {
delta += solAmount;
} else {
delta -= solAmount;
}
}

return roundSol(delta);
}

function buildBuyQuote({ solIn, tokenReserve, solReserve }) {
const grossSolIn = safeNum(solIn, 0);
const x = safeNum(tokenReserve, 0);
const y = safeNum(solReserve, 0);

if (grossSolIn <= 0) {
throw new Error("Invalid solAmount");
}

if (x <= 0 || y <= 0) {
throw new Error("Pool reserves are invalid");
}

const feeSol = grossSolIn * (MSS_TRADING_FEE_PCT / 100);
const netSolIn = grossSolIn - feeSol;

if (netSolIn <= 0) {
throw new Error("Trade too small after fee");
}

const k = x * y;
const newSolReserveRaw = y + netSolIn;
const newTokenReserveRaw = k / newSolReserveRaw;
const tokensBought = floorToken(x - newTokenReserveRaw);

if (!Number.isFinite(tokensBought) || tokensBought <= 0) {
throw new Error("Invalid trade output");
}

const newTokenReserve = x - tokensBought;
const newSolReserve = newSolReserveRaw;
const newKValue = String(Math.floor(newTokenReserve * newSolReserve));
const executionPrice = grossSolIn / tokensBought;
const postTradeUnitPrice = newSolReserve / Math.max(newTokenReserve, 1);

return {
grossSolIn: roundSol(grossSolIn),
walletSolDelta: roundSol(-grossSolIn),
feeSol: roundSol(feeSol),
netSolIn: roundSol(netSolIn),
tokensBought,
newSolReserve: roundSol(newSolReserve),
newTokenReserve: floorToken(newTokenReserve),
newKValue,
price: executionPrice,
executionPrice,
postTradeUnitPrice,
feeBreakdown: getFeeBreakdown(feeSol),
};
}

function buildSellQuote({ tokensIn, tokenReserve, solReserve }) {
const grossTokensIn = floorToken(tokensIn);
const x = safeNum(tokenReserve, 0);
const y = safeNum(solReserve, 0);

if (grossTokensIn <= 0) {
throw new Error("Invalid tokenAmount");
}

if (x <= 0 || y <= 0) {
throw new Error("Pool reserves are invalid");
}

const k = x * y;
const newTokenReserveRaw = x + grossTokensIn;
const newSolReserveBeforeFee = k / newTokenReserveRaw;
const grossSolOut = y - newSolReserveBeforeFee;

if (!Number.isFinite(grossSolOut) || grossSolOut <= 0) {
throw new Error("Invalid trade output");
}

const feeSol = grossSolOut * (MSS_TRADING_FEE_PCT / 100);
const netSolOut = grossSolOut - feeSol;

if (!Number.isFinite(netSolOut) || netSolOut <= 0) {
throw new Error("Invalid trade output");
}

const finalSolReserve = y - netSolOut;
const finalTokenReserve = x + grossTokensIn;
const finalK = String(Math.floor(finalTokenReserve * finalSolReserve));
const executionPrice = grossSolOut / grossTokensIn;
const postTradeUnitPrice = finalSolReserve / Math.max(finalTokenReserve, 1);

return {
grossTokensIn,
grossSolOut: roundSol(grossSolOut),
walletSolDelta: roundSol(netSolOut),
feeSol: roundSol(feeSol),
netSolOut: roundSol(netSolOut),
newSolReserve: roundSol(finalSolReserve),
newTokenReserve: floorToken(finalTokenReserve),
newKValue: finalK,
price: executionPrice,
executionPrice,
postTradeUnitPrice,
feeBreakdown: getFeeBreakdown(feeSol),
};
}

function buildWalletLimitPayload({
launch,
token,
isBuilderWallet,
walletBalanceBefore,
tokensAdded = 0,
}) {
const { totalSupply, maxWalletPercent, maxWalletTokens } = getMaxWalletTokens(
launch,
token,
isBuilderWallet
);

const currentBalance = floorToken(walletBalanceBefore);
const afterBalance = floorToken(currentBalance + floorToken(tokensAdded));
const walletCapacityRemaining = Math.max(0, maxWalletTokens - currentBalance);
const exceedsMaxWallet = afterBalance > maxWalletTokens;

return {
totalSupply,
maxWalletPercent,
maxWallet: maxWalletTokens,
maxWalletTokens,
walletBalanceBefore: currentBalance,
walletBalanceAfter: afterBalance,
walletCapacityRemaining,
exceedsMaxWallet,
};
}

router.post("/quote-buy", async (req, res) => {
try {
const { launchId, solAmount, wallet = "" } = req.body;

if (!launchId || !solAmount) {
return res.status(400).json({ error: "Missing parameters" });
}

const launchIdNum = Number(launchId);
const requestedSol = Number(solAmount);

if (!Number.isFinite(launchIdNum) || launchIdNum <= 0) {
return res.status(400).json({ error: "Invalid launchId" });
}

if (!Number.isFinite(requestedSol) || requestedSol <= 0) {
return res.status(400).json({ error: "Invalid solAmount" });
}

const result = await getTokenLaunchAndPool(launchIdNum);

if (result.error) {
return res.status(404).json({ error: result.error });
}

const { launch, token, pool } = result;

if (!isLiveLaunch(launch)) {
return res.status(400).json({ error: "Market is not live" });
}

const walletStr = cleanText(wallet, 120);
const builderWallet = await getBuilderWalletByLaunch(launch);
const isBuilderWallet =
walletStr &&
builderWallet &&
walletStr.toLowerCase() === builderWallet.toLowerCase();

const maxBuySol = getMaxBuySol(launch, isBuilderWallet);

if (!isBuilderWallet && requestedSol > maxBuySol) {
return res.status(400).json({
error: "Max buy transaction exceeded",
maxBuySol,
});
}

const quote = buildBuyQuote({
solIn: requestedSol,
tokenReserve: Number(pool.token_reserve),
solReserve: Number(pool.sol_reserve),
});

let walletBalanceBefore = 0;
let walletSolBalance = 0;
let walletSolDelta = 0;

if (walletStr) {
const walletBalance = await getOrCreateWalletBalance(launchIdNum, walletStr);
walletBalanceBefore = safeNum(walletBalance.token_amount, 0);
walletSolBalance = safeNum(walletBalance.sol_balance, 0);
walletSolDelta = await getWalletSolDelta(launchIdNum, walletStr);
}

const walletLimit = buildWalletLimitPayload({
launch,
token,
isBuilderWallet,
walletBalanceBefore,
tokensAdded: quote.tokensBought,
});

return res.json({
success: true,
side: "buy",
quote: {
...quote,
maxBuySol,
isBuilderWallet,
walletSolBalanceBefore: walletSolBalance,
walletSolBalanceAfter: roundSol(walletSolBalance + quote.walletSolDelta),
walletSolDeltaBefore: walletSolDelta,
walletSolDeltaAfter: roundSol(walletSolDelta + quote.walletSolDelta),
...walletLimit,
},
});
} catch (err) {
console.error("QUOTE BUY ERROR", err);
return res.status(400).json({ error: err.message || "Quote buy failed" });
}
});

router.post("/quote-sell", async (req, res) => {
try {
const { launchId, tokenAmount, wallet = "" } = req.body;

if (!launchId || !tokenAmount) {
return res.status(400).json({ error: "Missing parameters" });
}

const launchIdNum = Number(launchId);
const requestedTokens = floorToken(tokenAmount);

if (!Number.isFinite(launchIdNum) || launchIdNum <= 0) {
return res.status(400).json({ error: "Invalid launchId" });
}

if (!Number.isFinite(requestedTokens) || requestedTokens <= 0) {
return res.status(400).json({ error: "Invalid tokenAmount" });
}

const result = await getTokenLaunchAndPool(launchIdNum);

if (result.error) {
return res.status(404).json({ error: result.error });
}

const { launch, pool } = result;

if (!isLiveLaunch(launch)) {
return res.status(400).json({ error: "Market is not live" });
}

const walletStr = cleanText(wallet, 120);
let walletBalanceBefore = null;
let walletBalanceAfter = null;
let walletSolBalance = 0;
let walletSolDelta = 0;

if (walletStr) {
const walletBalance = await getOrCreateWalletBalance(launchIdNum, walletStr);
walletBalanceBefore = safeNum(walletBalance.token_amount, 0);
walletSolBalance = safeNum(walletBalance.sol_balance, 0);
walletSolDelta = await getWalletSolDelta(launchIdNum, walletStr);

if (walletBalanceBefore < requestedTokens) {
return res.status(400).json({
error: "Insufficient tokens",
walletBalanceBefore,
});
}

walletBalanceAfter = walletBalanceBefore - requestedTokens;
}

const quote = buildSellQuote({
tokensIn: requestedTokens,
tokenReserve: Number(pool.token_reserve),
solReserve: Number(pool.sol_reserve),
});

return res.json({
success: true,
side: "sell",
quote: {
...quote,
walletBalanceBefore,
walletBalanceAfter,
walletSolBalanceBefore: walletSolBalance,
walletSolBalanceAfter: roundSol(walletSolBalance + quote.walletSolDelta),
walletSolDeltaBefore: walletSolDelta,
walletSolDeltaAfter: roundSol(walletSolDelta + quote.walletSolDelta),
},
});
} catch (err) {
console.error("QUOTE SELL ERROR", err);
return res.status(400).json({ error: err.message || "Quote sell failed" });
}
});

router.post("/buy", async (req, res) => {
try {
const { launchId, wallet, solAmount } = req.body;

if (!launchId || !wallet || !solAmount) {
return res.status(400).json({ error: "Missing parameters" });
}

const launchIdNum = Number(launchId);
const walletStr = cleanText(wallet, 120);
const solIn = Number(solAmount);

if (!Number.isFinite(launchIdNum) || launchIdNum <= 0) {
return res.status(400).json({ error: "Invalid launchId" });
}

if (!walletStr) {
return res.status(400).json({ error: "Invalid wallet" });
}

if (!Number.isFinite(solIn) || solIn <= 0) {
return res.status(400).json({ error: "Invalid solAmount" });
}

const result = await getTokenLaunchAndPool(launchIdNum);

if (result.error) {
return res.status(404).json({ error: result.error });
}

const { launch, token, pool } = result;

if (!isLiveLaunch(launch)) {
return res.status(400).json({ error: "Market is not live" });
}

const builderWallet = await getBuilderWalletByLaunch(launch);
const isBuilderWallet =
Boolean(builderWallet) &&
walletStr.toLowerCase() === builderWallet.toLowerCase();

const maxBuySol = getMaxBuySol(launch, isBuilderWallet);

if (!isBuilderWallet && solIn > maxBuySol) {
return res.status(400).json({
error: "Max buy transaction exceeded",
maxBuySol,
});
}

const quote = buildBuyQuote({
solIn,
tokenReserve: Number(pool.token_reserve),
solReserve: Number(pool.sol_reserve),
});

const walletBalance = await getOrCreateWalletBalance(launchIdNum, walletStr);
const currentBalance = safeNum(walletBalance.token_amount, 0);
const walletSolBalanceBefore = safeNum(walletBalance.sol_balance, 0);
const walletSolDeltaBefore = await getWalletSolDelta(launchIdNum, walletStr);

const walletLimit = buildWalletLimitPayload({
launch,
token,
isBuilderWallet,
walletBalanceBefore: currentBalance,
tokensAdded: quote.tokensBought,
});

if (walletLimit.exceedsMaxWallet) {
return res.status(400).json({
error: "Max wallet limit exceeded",
maxWallet: walletLimit.maxWallet,
maxWalletTokens: walletLimit.maxWalletTokens,
attemptedBalance: walletLimit.walletBalanceAfter,
walletBalanceBefore: walletLimit.walletBalanceBefore,
});
}

await db.run("BEGIN TRANSACTION");

try {
await db.run(
`
UPDATE pools
SET token_reserve = ?, sol_reserve = ?, k_value = ?
WHERE launch_id = ? AND id = ?
`,
[
quote.newTokenReserve,
quote.newSolReserve,
quote.newKValue,
launchIdNum,
pool.id,
]
);

await db.run(
`
INSERT INTO trades
(launch_id, token_id, wallet, side, sol_amount, token_amount, price)
VALUES (?, ?, ?, 'buy', ?, ?, ?)
`,
[
launchIdNum,
token.id,
walletStr,
quote.grossSolIn,
quote.tokensBought,
quote.executionPrice,
]
);

const nextBalance = await setWalletBalance(
launchIdNum,
walletStr,
currentBalance + quote.tokensBought
);

const nextWalletSolBalance = await setWalletSolBalanceIfSupported(
launchIdNum,
walletStr,
walletSolBalanceBefore + quote.walletSolDelta
);

await syncLaunchLiquidityFields(launchIdNum, quote.newSolReserve);
await syncLaunchPoolSnapshot(launchIdNum, {
solReserve: quote.newSolReserve,
tokenReserve: quote.newTokenReserve,
price: quote.postTradeUnitPrice,
});
await syncLaunchMarketFields(launchIdNum, {
solReserve: quote.newSolReserve,
tokenReserve: quote.newTokenReserve,
price: quote.postTradeUnitPrice,
});

await db.run("COMMIT");

const walletSolDeltaAfter = roundSol(walletSolDeltaBefore + quote.walletSolDelta);
const walletSolBalanceAfter =
nextWalletSolBalance != null
? nextWalletSolBalance
: roundSol(walletSolBalanceBefore + quote.walletSolDelta);

return res.json({
success: true,
side: "buy",
tokensReceived: quote.tokensBought,
price: quote.executionPrice,
executionPrice: quote.executionPrice,
marketPriceAfter: quote.postTradeUnitPrice,
feePct: MSS_TRADING_FEE_PCT,
feeSol: quote.feeSol,
feeBreakdown: quote.feeBreakdown,
walletSolDelta: quote.walletSolDelta,
walletSolDeltaBefore,
walletSolDeltaAfter,
walletSolBalanceBefore,
walletSolBalanceAfter,
maxBuySol,
isBuilderWallet,
...walletLimit,
walletBalanceBefore: currentBalance,
walletBalanceAfter: nextBalance,
pool: {
sol_reserve: quote.newSolReserve,
token_reserve: quote.newTokenReserve,
k_value: quote.newKValue,
},
});
} catch (innerErr) {
await db.run("ROLLBACK");
throw innerErr;
}
} catch (err) {
console.error("BUY ERROR", err);
return res.status(500).json({ error: err.message || "Buy failed" });
}
});

router.post("/sell", async (req, res) => {
try {
const { launchId, wallet, tokenAmount } = req.body;

if (!launchId || !wallet || !tokenAmount) {
return res.status(400).json({ error: "Missing parameters" });
}

const launchIdNum = Number(launchId);
const walletStr = cleanText(wallet, 120);
const tokensIn = floorToken(tokenAmount);

if (!Number.isFinite(launchIdNum) || launchIdNum <= 0) {
return res.status(400).json({ error: "Invalid launchId" });
}

if (!walletStr) {
return res.status(400).json({ error: "Invalid wallet" });
}

if (!Number.isFinite(tokensIn) || tokensIn <= 0) {
return res.status(400).json({ error: "Invalid tokenAmount" });
}

const result = await getTokenLaunchAndPool(launchIdNum);

if (result.error) {
return res.status(404).json({ error: result.error });
}

const { launch, token, pool } = result;

if (!isLiveLaunch(launch)) {
return res.status(400).json({ error: "Market is not live" });
}

const walletBalance = await getOrCreateWalletBalance(launchIdNum, walletStr);
const currentBalance = safeNum(walletBalance.token_amount, 0);
const walletSolBalanceBefore = safeNum(walletBalance.sol_balance, 0);
const walletSolDeltaBefore = await getWalletSolDelta(launchIdNum, walletStr);

if (currentBalance < tokensIn) {
return res.status(400).json({
error: "Insufficient tokens",
walletBalanceBefore: currentBalance,
});
}

const quote = buildSellQuote({
tokensIn,
tokenReserve: Number(pool.token_reserve),
solReserve: Number(pool.sol_reserve),
});

await db.run("BEGIN TRANSACTION");

try {
await db.run(
`
UPDATE pools
SET token_reserve = ?, sol_reserve = ?, k_value = ?
WHERE launch_id = ? AND id = ?
`,
[
quote.newTokenReserve,
quote.newSolReserve,
quote.newKValue,
launchIdNum,
pool.id,
]
);

await db.run(
`
INSERT INTO trades
(launch_id, token_id, wallet, side, sol_amount, token_amount, price)
VALUES (?, ?, ?, 'sell', ?, ?, ?)
`,
[
launchIdNum,
token.id,
walletStr,
quote.netSolOut,
quote.grossTokensIn,
quote.executionPrice,
]
);

const nextBalance = await setWalletBalance(
launchIdNum,
walletStr,
currentBalance - quote.grossTokensIn
);

const nextWalletSolBalance = await setWalletSolBalanceIfSupported(
launchIdNum,
walletStr,
walletSolBalanceBefore + quote.walletSolDelta
);

await syncLaunchLiquidityFields(launchIdNum, quote.newSolReserve);
await syncLaunchPoolSnapshot(launchIdNum, {
solReserve: quote.newSolReserve,
tokenReserve: quote.newTokenReserve,
price: quote.postTradeUnitPrice,
});
await syncLaunchMarketFields(launchIdNum, {
solReserve: quote.newSolReserve,
tokenReserve: quote.newTokenReserve,
price: quote.postTradeUnitPrice,
});

await db.run("COMMIT");

const walletSolDeltaAfter = roundSol(walletSolDeltaBefore + quote.walletSolDelta);
const walletSolBalanceAfter =
nextWalletSolBalance != null
? nextWalletSolBalance
: roundSol(walletSolBalanceBefore + quote.walletSolDelta);

return res.json({
success: true,
side: "sell",
solReceived: quote.netSolOut,
netSolOut: quote.netSolOut,
grossSolOut: quote.grossSolOut,
feePct: MSS_TRADING_FEE_PCT,
feeSol: quote.feeSol,
feeBreakdown: quote.feeBreakdown,
price: quote.executionPrice,
executionPrice: quote.executionPrice,
marketPriceAfter: quote.postTradeUnitPrice,
walletSolDelta: quote.walletSolDelta,
walletSolDeltaBefore,
walletSolDeltaAfter,
walletSolBalanceBefore,
walletSolBalanceAfter,
walletBalanceBefore: currentBalance,
walletBalanceAfter: nextBalance,
tokenAmountSold: quote.grossTokensIn,
soldTokens: quote.grossTokensIn,
totalSupply: getEffectiveTotalSupply(launch, token),
pool: {
sol_reserve: quote.newSolReserve,
token_reserve: quote.newTokenReserve,
k_value: quote.newKValue,
},
});
} catch (innerErr) {
await db.run("ROLLBACK");
throw innerErr;
}
} catch (err) {
console.error("SELL ERROR", err);
return res.status(500).json({ error: err.message || "Sell failed" });
}
});

export default router;
