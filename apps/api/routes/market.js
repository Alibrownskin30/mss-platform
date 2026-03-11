import express from "express";
import db from "../db/index.js";

const router = express.Router();

const BASE_MAX_WALLET_PERCENT = 0.005; // 0.5%
const DAILY_INCREASE_PERCENT = 0.005; // +0.5% per day
const BUILDER_MAX_WALLET_PERCENT = 0.05; // 5%

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
`SELECT * FROM tokens WHERE launch_id = ?`,
[launchId]
);

if (!token) {
return { error: "Token not found" };
}

const pool = await db.get(
`SELECT * FROM pools WHERE launch_id = ? AND status = 'active'`,
[launchId]
);

if (!pool) {
return { error: "Pool not found" };
}

return { launch, token, pool };
}

/*
BUY TOKENS
*/
router.post("/buy", async (req, res) => {
try {
const { launchId, wallet, solAmount } = req.body;

if (!launchId || !wallet || !solAmount) {
return res.status(400).json({ error: "Missing parameters" });
}

const result = await getTokenLaunchAndPool(launchId);

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
maxBuySol
});
}

const tokenReserve = Number(pool.token_reserve);
const solReserve = Number(pool.sol_reserve);
const k = Number(pool.k_value);

// 1% trading fee
const solAfterFee = solIn * 0.99;

const newSolReserve = solReserve + solAfterFee;
const newTokenReserve = k / newSolReserve;
const tokensBought = tokenReserve - newTokenReserve;

if (!Number.isFinite(tokensBought) || tokensBought <= 0) {
return res.status(400).json({ error: "Invalid trade output" });
}

const maxWalletPercent = getMaxWalletPercent(launch, isBuilderWallet);
const maxWallet = Number(token.supply) * maxWalletPercent;

let walletBalance = await db.get(
`SELECT token_amount FROM wallet_balances
WHERE launch_id = ? AND wallet = ?`,
[launchId, wallet]
);

if (!walletBalance) {
await db.run(
`INSERT INTO wallet_balances (launch_id, wallet, token_amount)
VALUES (?, ?, 0)`,
[launchId, wallet]
);

walletBalance = { token_amount: 0 };
}

const currentBalance = Number(walletBalance.token_amount);

if (currentBalance + tokensBought > maxWallet) {
return res.status(400).json({
error: "Max wallet limit exceeded",
maxWallet,
attemptedBalance: currentBalance + tokensBought
});
}

const price = solIn / tokensBought;

await db.run(
`UPDATE pools
SET token_reserve = ?, sol_reserve = ?
WHERE launch_id = ?`,
[newTokenReserve, newSolReserve, launchId]
);

await db.run(
`INSERT INTO trades
(launch_id, token_id, wallet, side, sol_amount, token_amount, price)
VALUES (?, ?, ?, 'buy', ?, ?, ?)`,
[
launchId,
token.id,
wallet,
solIn,
tokensBought,
price
]
);

await db.run(
`UPDATE wallet_balances
SET token_amount = token_amount + ?
WHERE launch_id = ? AND wallet = ?`,
[tokensBought, launchId, wallet]
);

return res.json({
success: true,
side: "buy",
tokensReceived: tokensBought,
price,
maxBuySol,
maxWalletPercent,
maxWallet,
walletBalanceAfter: currentBalance + tokensBought,
isBuilderWallet,
pool: {
sol_reserve: newSolReserve,
token_reserve: newTokenReserve
}
});

} catch (err) {
console.error("BUY ERROR", err);
return res.status(500).json({ error: "Buy failed" });
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

const result = await getTokenLaunchAndPool(launchId);

if (result.error) {
return res.status(404).json({ error: result.error });
}

const { token, pool } = result;

const tokensIn = Number(tokenAmount);

if (!Number.isFinite(tokensIn) || tokensIn <= 0) {
return res.status(400).json({ error: "Invalid tokenAmount" });
}

const balance = await db.get(
`SELECT token_amount FROM wallet_balances
WHERE launch_id = ? AND wallet = ?`,
[launchId, wallet]
);

if (!balance || Number(balance.token_amount) < tokensIn) {
return res.status(400).json({ error: "Insufficient tokens" });
}

const tokenReserve = Number(pool.token_reserve);
const solReserve = Number(pool.sol_reserve);
const k = Number(pool.k_value);

// 1% trading fee
const tokensAfterFee = tokensIn * 0.99;

const newTokenReserve = tokenReserve + tokensAfterFee;
const newSolReserve = k / newTokenReserve;
const solReceived = solReserve - newSolReserve;

if (!Number.isFinite(solReceived) || solReceived <= 0) {
return res.status(400).json({ error: "Invalid trade output" });
}

const price = solReceived / tokensIn;

await db.run(
`UPDATE pools
SET token_reserve = ?, sol_reserve = ?
WHERE launch_id = ?`,
[newTokenReserve, newSolReserve, launchId]
);

await db.run(
`INSERT INTO trades
(launch_id, token_id, wallet, side, sol_amount, token_amount, price)
VALUES (?, ?, ?, 'sell', ?, ?, ?)`,
[
launchId,
token.id,
wallet,
solReceived,
tokensIn,
price
]
);

await db.run(
`UPDATE wallet_balances
SET token_amount = token_amount - ?
WHERE launch_id = ? AND wallet = ?`,
[tokensIn, launchId, wallet]
);

return res.json({
success: true,
side: "sell",
solReceived,
price,
walletBalanceAfter: Number(balance.token_amount) - tokensIn,
pool: {
sol_reserve: newSolReserve,
token_reserve: newTokenReserve
}
});

} catch (err) {
console.error("SELL ERROR", err);
return res.status(500).json({ error: "Sell failed" });
}
});

export default router;