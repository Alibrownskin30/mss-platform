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
const launchStart = new Date(launch.updated_at || launch.created_at).getTime();
const now = Date.now();

if (!Number.isFinite(launchStart)) return 0;

return Math.max(
0,
Math.floor((now - launchStart) / (24 * 60 * 60 * 1000))
);
}

function getMaxWalletPercent(launch, isBuilderWallet = false) {
if (isBuilderWallet) {
return BUILDER_MAX_WALLET_PERCENT;
}

const daysSinceLaunch = getDaysSinceLaunch(launch);
return BASE_MAX_WALLET_PERCENT + (daysSinceLaunch * DAILY_INCREASE_PERCENT);
}

function getMaxBuySol(launch) {
const daysSinceLaunch = getDaysSinceLaunch(launch);

if (daysSinceLaunch <= 0) return 0.5; // Day 1
if (daysSinceLaunch === 1) return 1.0; // Day 2
return 1.0; // Day 3+ for now
}

async function getTokenLaunchAndPool(launchId) {
const launch = await db.get(
`SELECT * FROM launches WHERE id = ?`,
[launchId]
);

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

async function getOrCreateWalletBalance(launchId, wallet) {
let walletBalance = await db.get(
`
SELECT token_amount
FROM wallet_balances
WHERE launch_id = ? AND wallet = ?
`,
[launchId, wallet]
);

if (!walletBalance) {
await db.run(
`
INSERT INTO wallet_balances (launch_id, wallet, token_amount)
VALUES (?, ?, 0)
`,
[launchId, wallet]
);

walletBalance = { token_amount: 0 };
}

return walletBalance;
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
const newSolReserve = y + netSolIn;
const newTokenReserve = k / newSolReserve;
const tokensBoughtRaw = x - newTokenReserve;
const tokensBought = floorToken(tokensBoughtRaw);

if (!Number.isFinite(tokensBought) || tokensBought <= 0) {
throw new Error("Invalid trade output");
}

const normalizedNewTokenReserve = x - tokensBought;
const normalizedK = normalizedNewTokenReserve * newSolReserve;
const price = grossSolIn / tokensBought;

return {
grossSolIn: roundSol(grossSolIn),
feeSol: roundSol(feeSol),
netSolIn: roundSol(netSolIn),
tokensBought,
newSolReserve: roundSol(newSolReserve),
newTokenReserve: floorToken(normalizedNewTokenReserve),
newKValue: String(Math.floor(normalizedK)),
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
const newTokenReserveBeforeFee = x + grossTokensIn;
const newSolReserveBeforeFee = k / newTokenReserveBeforeFee;
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
const finalK = finalTokenReserve * finalSolReserve;
const price = netSolOut / grossTokensIn;

return {
grossTokensIn,
grossSolOut: roundSol(grossSolOut),
feeSol: roundSol(feeSol),
netSolOut: roundSol(netSolOut),
newSolReserve: roundSol(finalSolReserve),
newTokenReserve: floorToken(finalTokenReserve),
newKValue: String(Math.floor(finalK)),
price,
feeBreakdown: getFeeBreakdown(feeSol),
};
}

/*
QUOTE BUY
*/
router.post("/quote-buy", async (req, res) => {
try {
const { launchId, solAmount } = req.body;

if (!launchId || !solAmount) {
return res.status(400).json({ error: "Missing parameters" });
}

const result = await getTokenLaunchAndPool(Number(launchId));

if (result.error) {
return res.status(404).json({ error: result.error });
}

const { pool } = result;
const quote = buildBuyQuote({
solIn: Number(solAmount),
tokenReserve: Number(pool.token_reserve),
solReserve: Number(pool.sol_reserve),
});

return res.json({
success: true,
side: "buy",
quote,
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
const { launchId, tokenAmount } = req.body;

if (!launchId || !tokenAmount) {
return res.status(400).json({ error: "Missing parameters" });
}

const result = await getTokenLaunchAndPool(Number(launchId));

if (result.error) {
return res.status(404).json({ error: result.error });
}

const { pool } = result;
const quote = buildSellQuote({
tokensIn: Number(tokenAmount),
tokenReserve: Number(pool.token_reserve),
solReserve: Number(pool.sol_reserve),
});

return res.json({
success: true,
side: "sell",
quote,
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

const result = await getTokenLaunchAndPool(Number(launchId));

if (result.error) {
return res.status(404).json({ error: result.error });
}

const { launch, token, pool } = result;
const solIn = Number(solAmount);

if (!Number.isFinite(solIn) || solIn <= 0) {
return res.status(400).json({ error: "Invalid solAmount" });
}

const builder = await db.get(
`SELECT wallet FROM builders WHERE id = ?`,
[launch.builder_id]
);

const isBuilderWallet =
builder && String(builder.wallet).trim() === String(wallet).trim();

const maxBuySol = getMaxBuySol(launch);

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

const maxWalletPercent = getMaxWalletPercent(launch, isBuilderWallet);
const maxWallet = Number(token.supply) * maxWalletPercent;

const walletBalance = await getOrCreateWalletBalance(launchId, wallet);
const currentBalance = Number(walletBalance.token_amount);
const nextBalance = currentBalance + quote.tokensBought;

if (nextBalance > maxWallet) {
return res.status(400).json({
error: "Max wallet limit exceeded",
maxWallet,
attemptedBalance: nextBalance,
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
launchId,
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
launchId,
token.id,
wallet,
quote.grossSolIn,
quote.tokensBought,
quote.price,
]
);

await db.run(
`
UPDATE wallet_balances
SET token_amount = ?
WHERE launch_id = ? AND wallet = ?
`,
[nextBalance, launchId, wallet]
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
maxWalletPercent,
maxWallet,
walletBalanceAfter: nextBalance,
isBuilderWallet,
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

const result = await getTokenLaunchAndPool(Number(launchId));

if (result.error) {
return res.status(404).json({ error: result.error });
}

const { token, pool } = result;
const tokensIn = Number(tokenAmount);

if (!Number.isFinite(tokensIn) || tokensIn <= 0) {
return res.status(400).json({ error: "Invalid tokenAmount" });
}

const balance = await db.get(
`
SELECT token_amount
FROM wallet_balances
WHERE launch_id = ? AND wallet = ?
`,
[launchId, wallet]
);

if (!balance || Number(balance.token_amount) < tokensIn) {
return res.status(400).json({ error: "Insufficient tokens" });
}

const currentBalance = Number(balance.token_amount);
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
launchId,
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
launchId,
token.id,
wallet,
quote.netSolOut,
quote.grossTokensIn,
quote.price,
]
);

await db.run(
`
UPDATE wallet_balances
SET token_amount = ?
WHERE launch_id = ? AND wallet = ?
`,
[currentBalance - quote.grossTokensIn, launchId, wallet]
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
walletBalanceAfter: currentBalance - quote.grossTokensIn,
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