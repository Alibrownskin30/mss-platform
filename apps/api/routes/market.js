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

function getDaysSinceLaunch(launch) {
const launchStart = new Date(
launch.live_at || launch.updated_at || launch.created_at
).getTime();

if (!Number.isFinite(launchStart)) return 0;

const now = Date.now();
return Math.max(0, Math.floor((now - launchStart) / (24 * 60 * 60 * 1000)));
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

if (daysSinceLaunch <= 0) return 0.5; // day 1
if (daysSinceLaunch === 1) return 1.0; // day 2
return 1.0;
}

function isLiveLaunch(launch) {
return String(launch?.status || "").toLowerCase() === "live";
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
const direct = cleanText(launch?.builder_wallet || "");
if (direct) return direct;

if (!launch?.builder_id) return "";

const builder = await db.get(
`SELECT wallet FROM builders WHERE id = ?`,
[launch.builder_id]
);

return cleanText(builder?.wallet || "");
}

async function getOrCreateWalletBalance(launchId, wallet) {
const walletStr = cleanText(wallet, 120);

let walletBalance = await db.get(
`
SELECT token_amount
FROM wallet_balances
WHERE launch_id = ? AND wallet = ?
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

walletBalance = { token_amount: 0 };
}

return {
wallet: walletStr,
token_amount: floorToken(walletBalance.token_amount),
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
const price = grossSolIn / tokensBought;

return {
grossSolIn: roundSol(grossSolIn),
feeSol: roundSol(feeSol),
netSolIn: roundSol(netSolIn),
tokensBought,
newSolReserve: roundSol(newSolReserve),
newTokenReserve: floorToken(newTokenReserve),
newKValue,
price,
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
const price = netSolOut / grossTokensIn;

return {
grossTokensIn,
grossSolOut: roundSol(grossSolOut),
feeSol: roundSol(feeSol),
netSolOut: roundSol(netSolOut),
newSolReserve: roundSol(finalSolReserve),
newTokenReserve: floorToken(finalTokenReserve),
newKValue: finalK,
price,
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

/*
QUOTE BUY
*/
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
if (walletStr) {
const walletBalance = await getOrCreateWalletBalance(launchIdNum, walletStr);
walletBalanceBefore = safeNum(walletBalance.token_amount, 0);
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
...walletLimit,
},
});
} catch (err) {
console.error("QUOTE BUY ERROR", err);
return res.status(400).json({ error: err.message || "Quote buy failed" });
}
});

/*
QUOTE SELL
*/
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

if (walletStr) {
const walletBalance = await getOrCreateWalletBalance(launchIdNum, walletStr);
walletBalanceBefore = safeNum(walletBalance.token_amount, 0);

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
},
});
} catch (err) {
console.error("QUOTE SELL ERROR", err);
return res.status(400).json({ error: err.message || "Quote sell failed" });
}
});

/*
BUY TOKENS
*/
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
builderWallet &&
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
quote.price,
]
);

const nextBalance = await setWalletBalance(
launchIdNum,
walletStr,
currentBalance + quote.tokensBought
);

return res.json({
success: true,
side: "buy",
tokensReceived: quote.tokensBought,
price: quote.price,
feePct: MSS_TRADING_FEE_PCT,
feeSol: quote.feeSol,
feeBreakdown: quote.feeBreakdown,
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
} catch (err) {
console.error("BUY ERROR", err);
return res.status(500).json({ error: err.message || "Buy failed" });
}
});

/*
SELL TOKENS
*/
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
quote.price,
]
);

const nextBalance = await setWalletBalance(
launchIdNum,
walletStr,
currentBalance - quote.grossTokensIn
);

return res.json({
success: true,
side: "sell",
solReceived: quote.netSolOut,
grossSolOut: quote.grossSolOut,
feePct: MSS_TRADING_FEE_PCT,
feeSol: quote.feeSol,
feeBreakdown: quote.feeBreakdown,
price: quote.price,
walletBalanceBefore: currentBalance,
walletBalanceAfter: nextBalance,
pool: {
sol_reserve: quote.newSolReserve,
token_reserve: quote.newTokenReserve,
k_value: quote.newKValue,
},
});
} catch (err) {
console.error("SELL ERROR", err);
return res.status(500).json({ error: err.message || "Sell failed" });
}
});

export default router;