import express from "express";
import db from "../db/index.js";
import { getLiquidityLifecycle } from "../services/launcher/liquidityLifecycle.js";

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

const WALLET_BALANCE_ALIAS_GROUPS = {
token_amount: [
"token_amount",
"token_balance",
"balance_tokens",
"wallet_balance_tokens",
],
total_balance: [
"total_balance",
"total_balance_tokens",
"wallet_total_balance",
],
visible_total_balance: [
"visible_total_balance",
"visible_total_tokens",
"wallet_visible_total_balance",
"builder_visible_total_tokens",
],
unlocked_balance: [
"unlocked_balance",
"unlocked_token_balance",
"wallet_unlocked_balance",
],
locked_balance: [
"locked_balance",
"locked_token_balance",
"wallet_locked_balance",
],
sellable_balance: [
"sellable_balance",
"sellable_token_balance",
"wallet_sellable_balance",
],
sol_balance: ["sol_balance", "wallet_sol_balance"],
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

function parseDbTime(value) {
if (!value) return null;
const raw = String(value).trim();
if (!raw) return null;

const hasExplicitTimezone =
/z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw);

if (
!hasExplicitTimezone &&
/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
) {
const sqliteUtc = Date.parse(raw.replace(" ", "T") + "Z");
return Number.isFinite(sqliteUtc) ? sqliteUtc : null;
}

const direct = Date.parse(raw);
return Number.isFinite(direct) ? direct : null;
}

function choosePreferredString(...values) {
for (const value of values) {
const cleaned = cleanText(value, 500);
if (cleaned) return cleaned;
}
return "";
}

function chooseFirstFinite(...values) {
for (const value of values) {
const num = Number(value);
if (Number.isFinite(num)) return num;
}
return null;
}

function inferLaunchPhase(launch = {}) {
const rawStatus = cleanText(launch?.status, 64).toLowerCase();

const countdownStartedMs = parseDbTime(launch?.countdown_started_at);
const countdownEndsMs = parseDbTime(
launch?.countdown_ends_at || launch?.live_at
);
const liveAtMs = parseDbTime(launch?.live_at || launch?.countdown_ends_at);
const mintFinalizedAtMs = parseDbTime(launch?.mint_finalized_at);

const contractAddress = choosePreferredString(
launch?.contract_address,
launch?.token_mint,
launch?.mint_address
);
const reservationStatus = cleanText(
launch?.mint_reservation_status,
64
).toLowerCase();

const hasCountdownWindow =
Number.isFinite(countdownStartedMs) || Number.isFinite(countdownEndsMs);

const hasLiveSignal = Boolean(
contractAddress ||
reservationStatus === "finalized" ||
Number.isFinite(mintFinalizedAtMs)
);

if (rawStatus === "failed_refunded") return "failed_refunded";
if (rawStatus === "failed") return "failed";
if (rawStatus === "graduated") return "graduated";
if (rawStatus === "live") return "live";

if (rawStatus === "building") {
return hasLiveSignal ? "live" : "building";
}

if (rawStatus === "countdown") {
if (Number.isFinite(countdownEndsMs) && Date.now() < countdownEndsMs) {
return "countdown";
}
return hasLiveSignal ? "live" : "building";
}

if (hasCountdownWindow) {
if (Number.isFinite(countdownEndsMs) && Date.now() < countdownEndsMs) {
return "countdown";
}
return hasLiveSignal ? "live" : "building";
}

if (Number.isFinite(liveAtMs) && Date.now() >= liveAtMs && hasLiveSignal) {
return "live";
}

if (hasLiveSignal) {
return "live";
}

return rawStatus || "commit";
}

function buildPhaseMeta(launch = {}) {
const status = inferLaunchPhase(launch);
const marketEnabled = status === "live" || status === "graduated";

return {
status,
market_enabled: marketEnabled,
can_trade: marketEnabled,
is_commit: status === "commit",
is_countdown: status === "countdown",
is_building: status === "building",
is_live: status === "live",
is_graduated: status === "graduated",
is_failed: status === "failed" || status === "failed_refunded",
};
}

function normalizeLaunchForMarket(launch = null) {
if (!launch) return null;
const phase = buildPhaseMeta(launch);
return {
...launch,
status: phase.status,
phase,
};
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
const launchStartMs = parseDbTime(
launch?.live_at || launch?.updated_at || launch?.created_at
);

if (!Number.isFinite(launchStartMs)) return 0;

const now = Date.now();
return Math.max(
0,
Math.floor((now - launchStartMs) / (24 * 60 * 60 * 1000))
);
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

function isMarketTradable(launch) {
return Boolean(buildPhaseMeta(launch).can_trade);
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

async function getLaunchById(launchId) {
const launch = await db.get(`SELECT * FROM launches WHERE id = ?`, [launchId]);
return normalizeLaunchForMarket(launch);
}

async function getTokenByLaunchId(launchId) {
return db.get(
`SELECT * FROM tokens WHERE launch_id = ? ORDER BY id DESC LIMIT 1`,
[launchId]
);
}

async function getPoolByLaunchId(launchId) {
return db.get(
`SELECT * FROM pools WHERE launch_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
[launchId]
);
}

async function getTokenLaunchAndPool(launchId) {
const launch = await getLaunchById(launchId);

if (!launch) {
return { error: "Launch not found" };
}

const token = await getTokenByLaunchId(launchId);
if (!token) {
return { error: "Token not found", launch };
}

const pool = await getPoolByLaunchId(launchId);
if (!pool) {
return { error: "Pool not found", launch, token };
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
walletBalanceColumnsCache = new Set(
rows.map((row) => String(row.name || "").trim())
);
}
return walletBalanceColumnsCache;
}

function getAliasValue(row, aliases = [], fallback = null) {
for (const alias of aliases) {
if (row?.[alias] !== undefined && row?.[alias] !== null) {
return row[alias];
}
}
return fallback;
}

async function getOrCreateWalletBalanceRow(launchId, wallet) {
const walletStr = cleanText(wallet, 120);

let walletBalance = await db.get(
`
SELECT *
FROM wallet_balances
WHERE launch_id = ? AND wallet = ?
ORDER BY id DESC
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
ORDER BY id DESC
LIMIT 1
`,
[launchId, walletStr]
);
}

return walletBalance || null;
}

async function getOrCreateWalletBalance(launchId, wallet) {
const walletRow = await getOrCreateWalletBalanceRow(launchId, wallet);
const columns = await getWalletBalanceColumns();

const tokenAmount = floorToken(
chooseFirstFinite(
getAliasValue(walletRow, WALLET_BALANCE_ALIAS_GROUPS.token_amount),
0
)
);

const totalBalance = floorToken(
chooseFirstFinite(
getAliasValue(walletRow, WALLET_BALANCE_ALIAS_GROUPS.total_balance),
tokenAmount
)
);

const visibleTotalBalance = floorToken(
chooseFirstFinite(
getAliasValue(walletRow, WALLET_BALANCE_ALIAS_GROUPS.visible_total_balance),
totalBalance
)
);

const unlockedBalance = floorToken(
chooseFirstFinite(
getAliasValue(walletRow, WALLET_BALANCE_ALIAS_GROUPS.unlocked_balance),
tokenAmount
)
);

const lockedBalance = floorToken(
chooseFirstFinite(
getAliasValue(walletRow, WALLET_BALANCE_ALIAS_GROUPS.locked_balance),
Math.max(0, visibleTotalBalance - unlockedBalance)
)
);

const sellableBalance = floorToken(
chooseFirstFinite(
getAliasValue(walletRow, WALLET_BALANCE_ALIAS_GROUPS.sellable_balance),
unlockedBalance
)
);

const solBalance = roundSol(
chooseFirstFinite(
getAliasValue(walletRow, WALLET_BALANCE_ALIAS_GROUPS.sol_balance),
0
)
);

return {
wallet: cleanText(wallet, 120),
token_amount: tokenAmount,
total_balance: totalBalance,
visible_total_balance: visibleTotalBalance,
unlocked_balance: unlockedBalance,
locked_balance: lockedBalance,
sellable_balance: sellableBalance,
sol_balance: solBalance,
hasSolBalanceColumn:
columns.has("sol_balance") || columns.has("wallet_sol_balance"),
};
}

function buildWalletState(walletBalance = {}, sellability = null) {
const tokenAmount = floorToken(walletBalance?.token_amount ?? 0);
const visibleTotalBalance = floorToken(
chooseFirstFinite(
walletBalance?.visible_total_balance,
walletBalance?.total_balance,
tokenAmount
)
);
const unlockedBalance = floorToken(
chooseFirstFinite(
sellability?.unlockedBalance,
walletBalance?.unlocked_balance,
tokenAmount
)
);
const lockedBalance = floorToken(
chooseFirstFinite(
sellability?.lockedBalance,
walletBalance?.locked_balance,
Math.max(0, visibleTotalBalance - unlockedBalance)
)
);
const sellableBalance = floorToken(
chooseFirstFinite(
sellability?.sellableBalance,
walletBalance?.sellable_balance,
tokenAmount
)
);

return {
tokenAmount,
totalBalance: visibleTotalBalance,
visibleTotalBalance,
unlockedBalance,
lockedBalance,
sellableBalance,
};
}

async function updateWalletBalanceSnapshot(
launchId,
wallet,
{
tokenAmount = 0,
totalBalance = null,
visibleTotalBalance = null,
unlockedBalance = null,
lockedBalance = null,
sellableBalance = null,
solBalance = null,
} = {}
) {
await getOrCreateWalletBalanceRow(launchId, wallet);

const walletStr = cleanText(wallet, 120);
const columns = await getWalletBalanceColumns();

const normalizedTokenAmount = Math.max(0, floorToken(tokenAmount));
const normalizedVisibleTotalBalance = Math.max(
normalizedTokenAmount,
floorToken(visibleTotalBalance ?? totalBalance ?? normalizedTokenAmount)
);
const normalizedTotalBalance = Math.max(
normalizedTokenAmount,
floorToken(totalBalance ?? normalizedVisibleTotalBalance)
);
const normalizedUnlockedBalance = Math.max(
0,
Math.min(
normalizedVisibleTotalBalance,
floorToken(unlockedBalance ?? normalizedTokenAmount)
)
);
const normalizedLockedBalance = Math.max(
0,
Math.min(
normalizedVisibleTotalBalance,
floorToken(
lockedBalance ??
Math.max(0, normalizedVisibleTotalBalance - normalizedUnlockedBalance)
)
)
);
const normalizedSellableBalance = Math.max(
0,
Math.min(
normalizedVisibleTotalBalance,
floorToken(sellableBalance ?? normalizedUnlockedBalance)
)
);

const updates = [];
const params = [];

const setAliasGroup = (aliases, value, formatter = (v) => v) => {
for (const column of aliases) {
if (!columns.has(column)) continue;
updates.push(`${column} = ?`);
params.push(formatter(value));
}
};

setAliasGroup(
WALLET_BALANCE_ALIAS_GROUPS.token_amount,
normalizedTokenAmount,
floorToken
);
setAliasGroup(
WALLET_BALANCE_ALIAS_GROUPS.total_balance,
normalizedTotalBalance,
floorToken
);
setAliasGroup(
WALLET_BALANCE_ALIAS_GROUPS.visible_total_balance,
normalizedVisibleTotalBalance,
floorToken
);
setAliasGroup(
WALLET_BALANCE_ALIAS_GROUPS.unlocked_balance,
normalizedUnlockedBalance,
floorToken
);
setAliasGroup(
WALLET_BALANCE_ALIAS_GROUPS.locked_balance,
normalizedLockedBalance,
floorToken
);
setAliasGroup(
WALLET_BALANCE_ALIAS_GROUPS.sellable_balance,
normalizedSellableBalance,
floorToken
);

if (solBalance != null) {
setAliasGroup(
WALLET_BALANCE_ALIAS_GROUPS.sol_balance,
roundSol(solBalance),
roundSol
);
}

if (columns.has("updated_at")) {
updates.push("updated_at = CURRENT_TIMESTAMP");
}

if (!updates.length) {
return {
token_amount: normalizedTokenAmount,
total_balance: normalizedTotalBalance,
visible_total_balance: normalizedVisibleTotalBalance,
unlocked_balance: normalizedUnlockedBalance,
locked_balance: normalizedLockedBalance,
sellable_balance: normalizedSellableBalance,
sol_balance: solBalance != null ? roundSol(solBalance) : null,
};
}

params.push(launchId, walletStr);

await db.run(
`
UPDATE wallet_balances
SET ${updates.join(", ")}
WHERE launch_id = ? AND wallet = ?
`,
params
);

return {
token_amount: normalizedTokenAmount,
total_balance: normalizedTotalBalance,
visible_total_balance: normalizedVisibleTotalBalance,
unlocked_balance: normalizedUnlockedBalance,
locked_balance: normalizedLockedBalance,
sellable_balance: normalizedSellableBalance,
sol_balance: solBalance != null ? roundSol(solBalance) : null,
};
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

async function syncLaunchPoolSnapshot(
launchId,
{ solReserve, tokenReserve, price }
) {
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

async function syncLaunchMarketFields(
launchId,
{ solReserve, tokenReserve, price }
) {
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

async function getWalletSellability(
launchId,
launch,
wallet,
walletVisibleTotalBalance
) {
const walletStr = cleanText(wallet, 120);
const builderWallet = await getBuilderWalletByLaunch(launch);
const isBuilderWallet =
Boolean(walletStr) &&
Boolean(builderWallet) &&
walletStr.toLowerCase() === builderWallet.toLowerCase();

const totalBalance = floorToken(walletVisibleTotalBalance);

if (
!isBuilderWallet ||
String(launch?.template || "").toLowerCase() !== "builder"
) {
return {
isBuilderWallet,
vestingActive: false,
totalBalance,
visibleTotalBalance: totalBalance,
unlockedBalance: totalBalance,
lockedBalance: 0,
sellableBalance: totalBalance,
builderVestingPercentUnlocked: 100,
builderVestingDaysLive: getDaysSinceLaunch(launch),
};
}

try {
const lifecycle = await getLiquidityLifecycle(launchId);
const vesting = lifecycle?.builderVesting || null;

const totalAllocation = floorToken(vesting?.totalAllocation ?? 0);
const unlockedAmount = floorToken(vesting?.unlockedAmount ?? 0);
const lockedAmount = floorToken(vesting?.lockedAmount ?? 0);

const builderAllocationHeld = Math.min(
totalBalance,
totalAllocation > 0 ? totalAllocation : totalBalance
);

const visibleLocked = Math.max(
0,
Math.min(
lockedAmount,
Math.max(0, builderAllocationHeld - unlockedAmount)
)
);

const visibleUnlocked = Math.max(0, totalBalance - visibleLocked);
const sellableBalance = visibleUnlocked;

return {
isBuilderWallet: true,
vestingActive: totalAllocation > unlockedAmount || visibleLocked > 0,
totalBalance,
visibleTotalBalance: totalBalance,
unlockedBalance: visibleUnlocked,
lockedBalance: visibleLocked,
sellableBalance,
builderVestingPercentUnlocked:
totalAllocation > 0 ? (unlockedAmount / totalAllocation) * 100 : 0,
builderVestingDaysLive: safeNum(
vesting?.vestedDays,
getDaysSinceLaunch(launch)
),
};
} catch {
return {
isBuilderWallet: true,
vestingActive: false,
totalBalance,
visibleTotalBalance: totalBalance,
unlockedBalance: totalBalance,
lockedBalance: 0,
sellableBalance: totalBalance,
builderVestingPercentUnlocked: 100,
builderVestingDaysLive: getDaysSinceLaunch(launch),
};
}
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
const newSolReserveRaw = k / newTokenReserveRaw;
const grossSolOut = y - newSolReserveRaw;

if (!Number.isFinite(grossSolOut) || grossSolOut <= 0) {
throw new Error("Invalid trade output");
}

const feeSol = grossSolOut * (MSS_TRADING_FEE_PCT / 100);
const netSolOut = grossSolOut - feeSol;

if (!Number.isFinite(netSolOut) || netSolOut <= 0) {
throw new Error("Invalid trade output");
}

const finalSolReserve = newSolReserveRaw;
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

const launch = await getLaunchById(launchIdNum);
if (!launch) {
return res.status(404).json({ error: "Launch not found" });
}

if (!isMarketTradable(launch)) {
return res.status(400).json({
error: "Market is not live",
status: launch.status,
phase: launch.phase,
});
}

const result = await getTokenLaunchAndPool(launchIdNum);

if (result.error) {
return res.status(404).json({ error: result.error });
}

const { token, pool } = result;

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
status: launch.status,
phase: launch.phase,
});
}

const quote = buildBuyQuote({
solIn: requestedSol,
tokenReserve: Number(pool.token_reserve),
solReserve: Number(pool.sol_reserve),
});

let walletBalanceBefore = 0;
let walletVisibleTotalBalanceBefore = 0;
let walletSolBalance = 0;
let walletSolDelta = 0;
let hasSolBalanceColumn = false;

if (walletStr) {
const walletBalance = await getOrCreateWalletBalance(launchIdNum, walletStr);
walletBalanceBefore = safeNum(walletBalance.token_amount, 0);
walletVisibleTotalBalanceBefore = safeNum(
walletBalance.visible_total_balance,
walletBalance.total_balance
);
walletSolBalance = safeNum(walletBalance.sol_balance, 0);
hasSolBalanceColumn = Boolean(walletBalance.hasSolBalanceColumn);
walletSolDelta = await getWalletSolDelta(launchIdNum, walletStr);
}

const walletLimit = buildWalletLimitPayload({
launch,
token,
isBuilderWallet,
walletBalanceBefore:
walletVisibleTotalBalanceBefore || walletBalanceBefore,
tokensAdded: quote.tokensBought,
});

const walletSolBalanceBeforeDisplay = hasSolBalanceColumn
? walletSolBalance
: walletSolDelta;
const walletSolBalanceAfterDisplay = hasSolBalanceColumn
? roundSol(walletSolBalance + quote.walletSolDelta)
: roundSol(walletSolDelta + quote.walletSolDelta);

return res.json({
success: true,
side: "buy",
status: launch.status,
phase: launch.phase,
quote: {
...quote,
maxBuySol,
isBuilderWallet,
walletBalanceBefore,
walletVisibleTotalBalanceBefore,
walletVisibleTotalBalanceAfter: floorToken(
walletVisibleTotalBalanceBefore + quote.tokensBought
),
walletSolBalanceBefore: walletSolBalanceBeforeDisplay,
walletSolBalanceAfter: walletSolBalanceAfterDisplay,
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

const launch = await getLaunchById(launchIdNum);
if (!launch) {
return res.status(404).json({ error: "Launch not found" });
}

if (!isMarketTradable(launch)) {
return res.status(400).json({
error: "Market is not live",
status: launch.status,
phase: launch.phase,
});
}

const result = await getTokenLaunchAndPool(launchIdNum);

if (result.error) {
return res.status(404).json({ error: result.error });
}

const { pool } = result;

const walletStr = cleanText(wallet, 120);
let walletBalanceBefore = null;
let walletVisibleTotalBalanceBefore = null;
let walletBalanceAfter = null;
let walletVisibleTotalBalanceAfter = null;
let walletSolBalance = 0;
let walletSolDelta = 0;
let hasSolBalanceColumn = false;
let sellability = null;

if (walletStr) {
const walletBalance = await getOrCreateWalletBalance(launchIdNum, walletStr);
walletBalanceBefore = safeNum(walletBalance.token_amount, 0);
walletVisibleTotalBalanceBefore = safeNum(
walletBalance.visible_total_balance,
walletBalance.total_balance
);
walletSolBalance = safeNum(walletBalance.sol_balance, 0);
hasSolBalanceColumn = Boolean(walletBalance.hasSolBalanceColumn);
walletSolDelta = await getWalletSolDelta(launchIdNum, walletStr);

sellability = await getWalletSellability(
launchIdNum,
launch,
walletStr,
walletVisibleTotalBalanceBefore || walletBalanceBefore
);

if (
safeNum(sellability?.sellableBalance, walletBalanceBefore) <
requestedTokens
) {
return res.status(400).json({
error: sellability?.vestingActive
? "Insufficient sellable tokens"
: "Insufficient tokens",
walletBalanceBefore,
walletVisibleTotalBalanceBefore,
sellableBalance: floorToken(
sellability?.sellableBalance ?? walletBalanceBefore
),
unlockedBalance: floorToken(
sellability?.unlockedBalance ?? walletBalanceBefore
),
lockedBalance: floorToken(sellability?.lockedBalance ?? 0),
isBuilderWallet: Boolean(sellability?.isBuilderWallet),
vestingActive: Boolean(sellability?.vestingActive),
status: launch.status,
phase: launch.phase,
});
}

walletBalanceAfter = walletBalanceBefore - requestedTokens;
walletVisibleTotalBalanceAfter =
floorToken(
walletVisibleTotalBalanceBefore ?? walletBalanceBefore
) - requestedTokens;
}

const quote = buildSellQuote({
tokensIn: requestedTokens,
tokenReserve: Number(pool.token_reserve),
solReserve: Number(pool.sol_reserve),
});

const walletSolBalanceBeforeDisplay = hasSolBalanceColumn
? walletSolBalance
: walletSolDelta;
const walletSolBalanceAfterDisplay = hasSolBalanceColumn
? roundSol(walletSolBalance + quote.walletSolDelta)
: roundSol(walletSolDelta + quote.walletSolDelta);

return res.json({
success: true,
side: "sell",
status: launch.status,
phase: launch.phase,
quote: {
...quote,
walletBalanceBefore,
walletBalanceAfter,
walletVisibleTotalBalanceBefore,
walletVisibleTotalBalanceAfter,
walletSolBalanceBefore: walletSolBalanceBeforeDisplay,
walletSolBalanceAfter: walletSolBalanceAfterDisplay,
walletSolDeltaBefore: walletSolDelta,
walletSolDeltaAfter: roundSol(walletSolDelta + quote.walletSolDelta),
sellableBalance: floorToken(
sellability?.sellableBalance ?? walletBalanceBefore ?? 0
),
unlockedBalance: floorToken(
sellability?.unlockedBalance ?? walletBalanceBefore ?? 0
),
lockedBalance: floorToken(sellability?.lockedBalance ?? 0),
isBuilderWallet: Boolean(sellability?.isBuilderWallet),
vestingActive: Boolean(sellability?.vestingActive),
builderVestingPercentUnlocked: safeNum(
sellability?.builderVestingPercentUnlocked,
0
),
builderVestingDaysLive: safeNum(
sellability?.builderVestingDaysLive,
0
),
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

const launch = await getLaunchById(launchIdNum);
if (!launch) {
return res.status(404).json({ error: "Launch not found" });
}

if (!isMarketTradable(launch)) {
return res.status(400).json({
error: "Market is not live",
status: launch.status,
phase: launch.phase,
});
}

const result = await getTokenLaunchAndPool(launchIdNum);

if (result.error) {
return res.status(404).json({ error: result.error });
}

const { token, pool } = result;

const builderWallet = await getBuilderWalletByLaunch(launch);
const isBuilderWallet =
Boolean(builderWallet) &&
walletStr.toLowerCase() === builderWallet.toLowerCase();

const maxBuySol = getMaxBuySol(launch, isBuilderWallet);

if (!isBuilderWallet && solIn > maxBuySol) {
return res.status(400).json({
error: "Max buy transaction exceeded",
maxBuySol,
status: launch.status,
phase: launch.phase,
});
}

const quote = buildBuyQuote({
solIn,
tokenReserve: Number(pool.token_reserve),
solReserve: Number(pool.sol_reserve),
});

const walletBalance = await getOrCreateWalletBalance(launchIdNum, walletStr);
const currentBalance = safeNum(walletBalance.token_amount, 0);
const currentVisibleTotalBalance = safeNum(
walletBalance.visible_total_balance,
walletBalance.total_balance
);
const walletSolBalanceBefore = safeNum(walletBalance.sol_balance, 0);
const hasSolBalanceColumn = Boolean(walletBalance.hasSolBalanceColumn);
const walletSolDeltaBefore = await getWalletSolDelta(launchIdNum, walletStr);

const currentSellability = await getWalletSellability(
launchIdNum,
launch,
walletStr,
currentVisibleTotalBalance || currentBalance
);

const currentState = buildWalletState(walletBalance, currentSellability);

const walletLimit = buildWalletLimitPayload({
launch,
token,
isBuilderWallet,
walletBalanceBefore:
currentState.visibleTotalBalance || currentState.tokenAmount,
tokensAdded: quote.tokensBought,
});

if (walletLimit.exceedsMaxWallet) {
return res.status(400).json({
error: "Max wallet limit exceeded",
maxWallet: walletLimit.maxWallet,
maxWalletTokens: walletLimit.maxWalletTokens,
attemptedBalance: walletLimit.walletBalanceAfter,
walletBalanceBefore: walletLimit.walletBalanceBefore,
status: launch.status,
phase: launch.phase,
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

const nextWalletSnapshot = await updateWalletBalanceSnapshot(launchIdNum, walletStr, {
tokenAmount: currentState.tokenAmount + quote.tokensBought,
totalBalance: currentState.visibleTotalBalance + quote.tokensBought,
visibleTotalBalance: currentState.visibleTotalBalance + quote.tokensBought,
unlockedBalance: currentState.unlockedBalance + quote.tokensBought,
lockedBalance: currentState.lockedBalance,
sellableBalance: currentState.sellableBalance + quote.tokensBought,
solBalance: walletSolBalanceBefore + quote.walletSolDelta,
});

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

const walletSolDeltaAfter = roundSol(
walletSolDeltaBefore + quote.walletSolDelta
);
const walletSolBalanceAfter =
nextWalletSnapshot.sol_balance != null
? nextWalletSnapshot.sol_balance
: walletSolDeltaAfter;

const walletSolBalanceBeforeDisplay = hasSolBalanceColumn
? walletSolBalanceBefore
: walletSolDeltaBefore;

return res.json({
success: true,
side: "buy",
status: launch.status,
phase: launch.phase,
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
walletSolBalanceBefore: walletSolBalanceBeforeDisplay,
walletSolBalanceAfter,
maxBuySol,
isBuilderWallet,
...walletLimit,
walletBalanceBefore: currentState.tokenAmount,
walletBalanceAfter: nextWalletSnapshot.token_amount,
walletTotalBalanceAfter: nextWalletSnapshot.total_balance,
walletVisibleTotalBalanceBefore: currentState.visibleTotalBalance,
walletVisibleTotalBalanceAfter: nextWalletSnapshot.visible_total_balance,
walletUnlockedBalanceAfter: nextWalletSnapshot.unlocked_balance,
walletLockedBalanceAfter: nextWalletSnapshot.locked_balance,
walletSellableBalanceAfter: nextWalletSnapshot.sellable_balance,
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

const launch = await getLaunchById(launchIdNum);
if (!launch) {
return res.status(404).json({ error: "Launch not found" });
}

if (!isMarketTradable(launch)) {
return res.status(400).json({
error: "Market is not live",
status: launch.status,
phase: launch.phase,
});
}

const result = await getTokenLaunchAndPool(launchIdNum);

if (result.error) {
return res.status(404).json({ error: result.error });
}

const { token, pool } = result;

const walletBalance = await getOrCreateWalletBalance(launchIdNum, walletStr);
const currentBalance = safeNum(walletBalance.token_amount, 0);
const currentVisibleTotalBalance = safeNum(
walletBalance.visible_total_balance,
walletBalance.total_balance
);
const walletSolBalanceBefore = safeNum(walletBalance.sol_balance, 0);
const hasSolBalanceColumn = Boolean(walletBalance.hasSolBalanceColumn);
const walletSolDeltaBefore = await getWalletSolDelta(launchIdNum, walletStr);

const sellability = await getWalletSellability(
launchIdNum,
launch,
walletStr,
currentVisibleTotalBalance || currentBalance
);

const currentState = buildWalletState(walletBalance, sellability);
const sellableBalance = floorToken(
sellability?.sellableBalance ?? currentState.sellableBalance
);

if (sellableBalance < tokensIn) {
return res.status(400).json({
error: sellability?.vestingActive
? "Insufficient sellable tokens"
: "Insufficient tokens",
walletBalanceBefore: currentBalance,
walletVisibleTotalBalanceBefore: currentVisibleTotalBalance,
sellableBalance,
unlockedBalance: floorToken(
sellability?.unlockedBalance ?? currentState.unlockedBalance
),
lockedBalance: floorToken(
sellability?.lockedBalance ?? currentState.lockedBalance
),
isBuilderWallet: Boolean(sellability?.isBuilderWallet),
vestingActive: Boolean(sellability?.vestingActive),
status: launch.status,
phase: launch.phase,
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

const nextWalletSnapshot = await updateWalletBalanceSnapshot(launchIdNum, walletStr, {
tokenAmount: Math.max(0, currentState.tokenAmount - quote.grossTokensIn),
totalBalance: Math.max(
0,
currentState.visibleTotalBalance - quote.grossTokensIn
),
visibleTotalBalance: Math.max(
0,
currentState.visibleTotalBalance - quote.grossTokensIn
),
unlockedBalance: Math.max(
0,
currentState.unlockedBalance - quote.grossTokensIn
),
lockedBalance: currentState.lockedBalance,
sellableBalance: Math.max(
0,
currentState.sellableBalance - quote.grossTokensIn
),
solBalance: walletSolBalanceBefore + quote.walletSolDelta,
});

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

const walletSolDeltaAfter = roundSol(
walletSolDeltaBefore + quote.walletSolDelta
);
const walletSolBalanceAfter =
nextWalletSnapshot.sol_balance != null
? nextWalletSnapshot.sol_balance
: walletSolDeltaAfter;

const walletSolBalanceBeforeDisplay = hasSolBalanceColumn
? walletSolBalanceBefore
: walletSolDeltaBefore;

return res.json({
success: true,
side: "sell",
status: launch.status,
phase: launch.phase,
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
walletSolBalanceBefore: walletSolBalanceBeforeDisplay,
walletSolBalanceAfter,
walletBalanceBefore: currentState.tokenAmount,
walletBalanceAfter: nextWalletSnapshot.token_amount,
walletTotalBalanceAfter: nextWalletSnapshot.total_balance,
walletVisibleTotalBalanceBefore: currentState.visibleTotalBalance,
walletVisibleTotalBalanceAfter: nextWalletSnapshot.visible_total_balance,
walletUnlockedBalanceAfter: nextWalletSnapshot.unlocked_balance,
walletLockedBalanceAfter: nextWalletSnapshot.locked_balance,
walletSellableBalanceAfter: nextWalletSnapshot.sellable_balance,
sellableBalanceBefore: sellableBalance,
unlockedBalanceBefore: floorToken(
sellability?.unlockedBalance ?? currentState.unlockedBalance
),
lockedBalanceBefore: floorToken(
sellability?.lockedBalance ?? currentState.lockedBalance
),
isBuilderWallet: Boolean(sellability?.isBuilderWallet),
vestingActive: Boolean(sellability?.vestingActive),
builderVestingPercentUnlocked: safeNum(
sellability?.builderVestingPercentUnlocked,
0
),
builderVestingDaysLive: safeNum(
sellability?.builderVestingDaysLive,
0
),
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
