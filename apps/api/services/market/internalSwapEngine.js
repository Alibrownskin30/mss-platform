import db from "../../db/index.js";

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

function assertPositive(value, label) {
const n = Number(value);
if (!Number.isFinite(n) || n <= 0) {
throw new Error(`${label} must be greater than 0`);
}
return n;
}

function cleanWallet(value) {
return String(value || "").trim();
}

async function getTokenByLaunchId(launchId) {
return db.get(
`
SELECT *
FROM tokens
WHERE launch_id = ?
ORDER BY id DESC
LIMIT 1
`,
[launchId]
);
}

async function getActivePoolByLaunchId(launchId) {
return db.get(
`
SELECT *
FROM pools
WHERE launch_id = ?
AND status = 'active'
ORDER BY id DESC
LIMIT 1
`,
[launchId]
);
}

async function getWalletTokenBalance(launchId, wallet) {
const row = await db.get(
`
SELECT token_amount
FROM wallet_balances
WHERE launch_id = ?
AND wallet = ?
LIMIT 1
`,
[launchId, wallet]
);

return floorToken(row?.token_amount);
}

async function upsertWalletTokenBalance(launchId, wallet, nextAmount) {
const normalizedAmount = Math.max(0, floorToken(nextAmount));

const existing = await db.get(
`
SELECT id
FROM wallet_balances
WHERE launch_id = ?
AND wallet = ?
LIMIT 1
`,
[launchId, wallet]
);

if (existing) {
await db.run(
`
UPDATE wallet_balances
SET token_amount = ?
WHERE id = ?
`,
[normalizedAmount, existing.id]
);
return normalizedAmount;
}

await db.run(
`
INSERT INTO wallet_balances (
launch_id,
wallet,
token_amount
) VALUES (?, ?, ?)
`,
[launchId, wallet, normalizedAmount]
);

return normalizedAmount;
}

async function recordTrade({
launchId,
tokenId,
wallet,
side,
solAmount,
tokenAmount,
price,
}) {
await db.run(
`
INSERT INTO trades (
launch_id,
token_id,
wallet,
side,
sol_amount,
token_amount,
price,
created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`,
[
launchId,
tokenId,
wallet,
side,
roundSol(solAmount),
floorToken(tokenAmount),
Number(price),
]
);
}

async function updatePool({
poolId,
tokenReserve,
solReserve,
}) {
const normalizedTokenReserve = Math.max(0, floorToken(tokenReserve));
const normalizedSolReserve = roundSol(solReserve);
const kValue = Number(normalizedTokenReserve) * Number(normalizedSolReserve);

await db.run(
`
UPDATE pools
SET token_reserve = ?,
sol_reserve = ?,
k_value = ?
WHERE id = ?
`,
[
normalizedTokenReserve,
normalizedSolReserve,
kValue,
poolId,
]
);
}

function buildFeeBreakdown(feeSol) {
const total = safeNum(feeSol, 0);

return {
total: roundSol(total),
core: roundSol(total * FEE_SPLIT.core),
buyback: roundSol(total * FEE_SPLIT.buyback),
treasury: roundSol(total * FEE_SPLIT.treasury),
};
}

function quoteBuy({
solIn,
tokenReserve,
solReserve,
}) {
const grossSolIn = assertPositive(solIn, "solIn");
const x = assertPositive(tokenReserve, "tokenReserve");
const y = assertPositive(solReserve, "solReserve");

const feeSol = grossSolIn * (MSS_TRADING_FEE_PCT / 100);
const netSolIn = grossSolIn - feeSol;

if (netSolIn <= 0) {
throw new Error("net SOL after fee must be greater than 0");
}

const k = x * y;
const newSolReserveRaw = y + netSolIn;
const newTokenReserveRaw = k / newSolReserveRaw;
const tokenOut = floorToken(x - newTokenReserveRaw);

if (tokenOut <= 0) {
throw new Error("trade size too small");
}

const tokenReserveAfter = Math.max(0, floorToken(x - tokenOut));
const solReserveAfter = roundSol(newSolReserveRaw);
const effectivePrice = grossSolIn / tokenOut;

return {
side: "buy",
grossSolIn: roundSol(grossSolIn),
feeSol: roundSol(feeSol),
netSolIn: roundSol(netSolIn),
tokenOut,
tokenReserveAfter,
solReserveAfter,
price: Number(effectivePrice),
feeBreakdown: buildFeeBreakdown(feeSol),
};
}

function quoteSell({
tokenIn,
tokenReserve,
solReserve,
}) {
const grossTokenIn = floorToken(assertPositive(tokenIn, "tokenIn"));
const x = assertPositive(tokenReserve, "tokenReserve");
const y = assertPositive(solReserve, "solReserve");

const k = x * y;
const newTokenReserveBeforeFee = x + grossTokenIn;
const newSolReserveBeforeFee = k / newTokenReserveBeforeFee;
const grossSolOut = y - newSolReserveBeforeFee;

if (grossSolOut <= 0) {
throw new Error("trade size too small");
}

const feeSol = grossSolOut * (MSS_TRADING_FEE_PCT / 100);
const netSolOut = grossSolOut - feeSol;

if (netSolOut <= 0) {
throw new Error("net SOL after fee must be greater than 0");
}

const effectivePrice = netSolOut / grossTokenIn;

return {
side: "sell",
tokenIn: grossTokenIn,
grossSolOut: roundSol(grossSolOut),
feeSol: roundSol(feeSol),
netSolOut: roundSol(netSolOut),
tokenReserveAfter: floorToken(newTokenReserveBeforeFee),
solReserveAfter: roundSol(y - netSolOut),
price: Number(effectivePrice),
feeBreakdown: buildFeeBreakdown(feeSol),
};
}

export async function quoteInternalBuy({ launchId, solAmount }) {
const token = await getTokenByLaunchId(launchId);
const pool = await getActivePoolByLaunchId(launchId);

if (!token) throw new Error("token not found");
if (!pool) throw new Error("active pool not found");

return {
token,
pool,
quote: quoteBuy({
solIn: solAmount,
tokenReserve: safeNum(pool.token_reserve, 0),
solReserve: safeNum(pool.sol_reserve, 0),
}),
};
}

export async function quoteInternalSell({ launchId, tokenAmount }) {
const token = await getTokenByLaunchId(launchId);
const pool = await getActivePoolByLaunchId(launchId);

if (!token) throw new Error("token not found");
if (!pool) throw new Error("active pool not found");

return {
token,
pool,
quote: quoteSell({
tokenIn: tokenAmount,
tokenReserve: safeNum(pool.token_reserve, 0),
solReserve: safeNum(pool.sol_reserve, 0),
}),
};
}

export async function executeInternalBuy({
launchId,
wallet,
solAmount,
}) {
const normalizedWallet = cleanWallet(wallet);
if (!normalizedWallet) throw new Error("wallet is required");

const token = await getTokenByLaunchId(launchId);
const pool = await getActivePoolByLaunchId(launchId);

if (!token) throw new Error("token not found");
if (!pool) throw new Error("active pool not found");

const quoted = quoteBuy({
solIn: solAmount,
tokenReserve: safeNum(pool.token_reserve, 0),
solReserve: safeNum(pool.sol_reserve, 0),
});

await updatePool({
poolId: pool.id,
tokenReserve: quoted.tokenReserveAfter,
solReserve: quoted.solReserveAfter,
});

const currentBalance = await getWalletTokenBalance(launchId, normalizedWallet);
const nextBalance = await upsertWalletTokenBalance(
launchId,
normalizedWallet,
currentBalance + quoted.tokenOut
);

await recordTrade({
launchId,
tokenId: token.id,
wallet: normalizedWallet,
side: "buy",
solAmount: quoted.grossSolIn,
tokenAmount: quoted.tokenOut,
price: quoted.price,
});

return {
ok: true,
side: "buy",
wallet: normalizedWallet,
launchId,
tokenId: token.id,
tokenAmount: quoted.tokenOut,
solAmount: quoted.grossSolIn,
feeSol: quoted.feeSol,
price: quoted.price,
feeBreakdown: quoted.feeBreakdown,
balances: {
tokenBalance: nextBalance,
},
pool: {
tokenReserve: quoted.tokenReserveAfter,
solReserve: quoted.solReserveAfter,
},
};
}

export async function executeInternalSell({
launchId,
wallet,
tokenAmount,
}) {
const normalizedWallet = cleanWallet(wallet);
if (!normalizedWallet) throw new Error("wallet is required");

const token = await getTokenByLaunchId(launchId);
const pool = await getActivePoolByLaunchId(launchId);

if (!token) throw new Error("token not found");
if (!pool) throw new Error("active pool not found");

const currentBalance = await getWalletTokenBalance(launchId, normalizedWallet);
const tokenIn = floorToken(tokenAmount);

if (tokenIn <= 0) {
throw new Error("tokenAmount must be greater than 0");
}

if (currentBalance < tokenIn) {
throw new Error("insufficient token balance");
}

const quoted = quoteSell({
tokenIn,
tokenReserve: safeNum(pool.token_reserve, 0),
solReserve: safeNum(pool.sol_reserve, 0),
});

await updatePool({
poolId: pool.id,
tokenReserve: quoted.tokenReserveAfter,
solReserve: quoted.solReserveAfter,
});

const nextBalance = await upsertWalletTokenBalance(
launchId,
normalizedWallet,
currentBalance - tokenIn
);

await recordTrade({
launchId,
tokenId: token.id,
wallet: normalizedWallet,
side: "sell",
solAmount: quoted.netSolOut,
tokenAmount: tokenIn,
price: quoted.price,
});

return {
ok: true,
side: "sell",
wallet: normalizedWallet,
launchId,
tokenId: token.id,
tokenAmount: tokenIn,
solAmount: quoted.netSolOut,
feeSol: quoted.feeSol,
price: quoted.price,
feeBreakdown: quoted.feeBreakdown,
balances: {
tokenBalance: nextBalance,
},
pool: {
tokenReserve: quoted.tokenReserveAfter,
solReserve: quoted.solReserveAfter,
},
};
}
