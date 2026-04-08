import express from "express";
import launcherDb from "../db/index.js";
import { getChartSnapshot } from "../services/chart-service.js";
import {
getLiquidityLifecycle,
buildGraduationPlanForLaunch,
} from "../services/launcher/liquidityLifecycle.js";

const router = express.Router();

const ALLOWED_INTERVALS = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);

function toNumber(value, fallback = 0) {
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function toInt(value, fallback = 0) {
return Math.max(0, Math.floor(toNumber(value, fallback)));
}

function clampNumber(value, min, max, fallback) {
const num = Number(value);
if (!Number.isFinite(num)) return fallback;
return Math.min(max, Math.max(min, num));
}

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max);
}

function normalizeInterval(raw) {
const interval = String(raw || "1m").trim();
return ALLOWED_INTERVALS.has(interval) ? interval : "1m";
}

function shouldRevealContractAddress(status) {
const normalized = cleanText(status, 64).toLowerCase();
return normalized === "live" || normalized === "graduated";
}

function sanitizeLaunchForResponse(launch = null) {
if (!launch) return null;

const status = cleanText(launch.status, 64).toLowerCase();
const revealContract = shouldRevealContractAddress(status);

return {
...launch,
contract_address: revealContract
? cleanText(launch.contract_address, 120) || null
: null,
mint_address: revealContract
? cleanText(launch.mint_address, 120) || null
: null,
reserved_mint_address: null,
reserved_mint_secret: null,
};
}

function extractGraduationReadiness(lifecycle) {
return lifecycle?.graduationReadiness || null;
}

function normalizeLifecycle(lifecycle = {}) {
if (!lifecycle || typeof lifecycle !== "object") return null;

return {
internal_sol_reserve: toNumber(lifecycle.internal_sol_reserve, 0),
internal_token_reserve: toInt(lifecycle.internal_token_reserve, 0),
implied_marketcap_sol: toNumber(lifecycle.implied_marketcap_sol, 0),

graduation_status:
cleanText(lifecycle.graduation_status, 120) || "internal_live",
graduated: Boolean(lifecycle.graduated),
graduation_reason: cleanText(lifecycle.graduation_reason, 200) || null,
graduated_at: lifecycle.graduated_at || null,

raydium_target_pct: toNumber(lifecycle.raydium_target_pct, 50),
mss_locked_target_pct: toNumber(lifecycle.mss_locked_target_pct, 50),

raydium_pool_id: cleanText(lifecycle.raydium_pool_id, 200) || null,
raydium_sol_migrated: toNumber(lifecycle.raydium_sol_migrated, 0),
raydium_token_migrated: toInt(lifecycle.raydium_token_migrated, 0),
raydium_lp_tokens: cleanText(lifecycle.raydium_lp_tokens, 200) || null,
raydium_migration_tx:
cleanText(lifecycle.raydium_migration_tx, 300) || null,

mss_locked_sol: toNumber(lifecycle.mss_locked_sol, 0),
mss_locked_token: toInt(lifecycle.mss_locked_token, 0),
mss_locked_lp_amount:
cleanText(lifecycle.mss_locked_lp_amount, 200) || null,
lock_status: cleanText(lifecycle.lock_status, 120) || "not_locked",
lock_tx: cleanText(lifecycle.lock_tx, 300) || null,
lock_expires_at: lifecycle.lock_expires_at || null,

graduationReadiness: lifecycle.graduationReadiness || null,
builderVesting: lifecycle.builderVesting || null,
};
}

function normalizeGraduationReadiness(readiness = {}) {
if (!readiness || typeof readiness !== "object") return null;

return {
ready: Boolean(readiness.ready),
reason: cleanText(readiness.reason, 500) || "",
};
}

function normalizeBuilderVestingSummary(raw = {}) {
if (!raw || typeof raw !== "object") return null;

return {
builder_wallet: cleanText(raw.builder_wallet, 120) || null,
total_allocation: toInt(raw.total_allocation, 0),
daily_unlock: toInt(raw.daily_unlock, 0),
unlocked_amount: toInt(raw.unlocked_amount, 0),
locked_amount: toInt(raw.locked_amount, 0),
vesting_start_at: raw.vesting_start_at || null,
created_at: raw.created_at || null,
updated_at: raw.updated_at || null,
vested_days: toInt(raw.vested_days, 0),
};
}

function pickLaunchRow(row) {
if (!row) return null;

const revealContract = shouldRevealContractAddress(row.status);

return {
id: row.id,
token_name: row.token_name,
symbol: row.symbol,
status: row.status,
template: row.template,

contract_address: revealContract
? cleanText(row.contract_address, 120) || null
: null,
mint_address: revealContract
? cleanText(row.contract_address, 120) || null
: null,

builder_wallet: cleanText(row.builder_wallet, 120) || null,
builder_alias: cleanText(row.builder_alias, 120) || null,
builder_score: toNumber(row.builder_score, 0),

website_url: cleanText(row.website_url, 500),
x_url: cleanText(row.x_url, 500),
telegram_url: cleanText(row.telegram_url, 500),
discord_url: cleanText(row.discord_url, 500),

committed_sol: toNumber(row.committed_sol, 0),
participants_count: toInt(row.participants_count, 0),
hard_cap_sol: toNumber(row.hard_cap_sol, 0),

builder_pct: toNumber(row.builder_pct, 0),
team_allocation_pct: toNumber(row.team_allocation_pct, 0),

countdown_started_at: row.countdown_started_at || null,
countdown_ends_at: row.countdown_ends_at || null,
live_at: row.live_at || null,
commit_started_at: row.commit_started_at || null,
commit_ends_at: row.commit_ends_at || null,

supply: toInt(row.supply, 0),
final_supply: toInt(row.final_supply || row.supply, 0),
circulating_supply: toInt(row.circulating_supply, 0),

liquidity: toNumber(row.liquidity, 0),
liquidity_sol: toNumber(row.liquidity, 0),
liquidity_usd: toNumber(row.liquidity_usd, 0),
current_liquidity_usd: toNumber(row.current_liquidity_usd, 0),
};
}

async function safeGetLifecycle(launchId) {
try {
return await getLiquidityLifecycle(launchId);
} catch {
return null;
}
}

async function safeGetGraduationPlan(launchId) {
try {
return await buildGraduationPlanForLaunch(launchId);
} catch {
return null;
}
}

router.get("/:mint", async (req, res) => {
try {
const mint = cleanText(req.params.mint, 120);
const wallet = cleanText(req.query.wallet, 120);

if (!mint) {
return res.status(400).json({
ok: false,
error: "Mint is required",
});
}

const tokenRow = await launcherDb.get(
`
SELECT
id,
launch_id,
name,
symbol,
supply,
mint_address,
created_at
FROM tokens
WHERE mint_address = ?
LIMIT 1
`,
[mint]
);

if (!tokenRow) {
return res.status(404).json({
ok: false,
error: "Token not found for mint",
});
}

const launchRow = await launcherDb.get(
`
SELECT
l.id,
l.token_name,
l.symbol,
l.status,
l.template,
l.contract_address,
l.builder_wallet,
l.website_url,
l.x_url,
l.telegram_url,
l.discord_url,
l.committed_sol,
l.participants_count,
l.hard_cap_sol,
l.builder_pct,
l.team_allocation_pct,
l.countdown_started_at,
l.countdown_ends_at,
l.live_at,
l.commit_started_at,
l.commit_ends_at,
l.supply,
l.final_supply,
l.circulating_supply,
l.liquidity,
l.liquidity_usd,
l.current_liquidity_usd,
b.alias AS builder_alias,
b.builder_score AS builder_score
FROM launches l
LEFT JOIN builders b
ON b.id = l.builder_id
WHERE l.id = ?
LIMIT 1
`,
[tokenRow.launch_id]
);

if (!launchRow) {
return res.status(404).json({
ok: false,
error: "Launch not found for token",
});
}

const interval = normalizeInterval(req.query.interval);
const candleLimit = clampNumber(req.query.candle_limit, 1, 500, 120);
const tradeLimit = clampNumber(req.query.trade_limit, 1, 200, 50);

const fallbackLaunch = pickLaunchRow(launchRow);

const [snapshot, lifecycleRaw, graduationPlan] = await Promise.all([
getChartSnapshot({
db: launcherDb,
launchId: tokenRow.launch_id,
interval,
candleLimit,
tradeLimit,
wallet,
}),
safeGetLifecycle(tokenRow.launch_id),
safeGetGraduationPlan(tokenRow.launch_id),
]);

const lifecycle = normalizeLifecycle(lifecycleRaw);
const graduationReadiness = normalizeGraduationReadiness(
extractGraduationReadiness(lifecycleRaw)
);
const builderVesting = normalizeBuilderVestingSummary(
lifecycleRaw?.builderVesting || {}
);

const snapshotLaunch = sanitizeLaunchForResponse(snapshot?.launch || null);
const resolvedLaunch = snapshotLaunch || fallbackLaunch;

const revealContract = shouldRevealContractAddress(resolvedLaunch?.status);

const resolvedMintAddress =
(revealContract
? cleanText(
tokenRow.mint_address ||
snapshot?.token?.mint_address ||
snapshotLaunch?.mint_address ||
resolvedLaunch?.mint_address,
120
)
: "") || null;

const walletSummary = snapshot?.wallet || {};
const stats = snapshot?.stats || {};

const walletTokenBalance = toInt(
walletSummary.token_balance ??
walletSummary.tokenBalance ??
stats.wallet_token_balance,
0
);

const walletTotalBalance = toInt(
walletSummary.total_balance ??
walletSummary.totalBalance ??
stats.wallet_total_balance ??
walletTokenBalance,
walletTokenBalance
);

const walletSellableBalance = toInt(
walletSummary.sellable_balance ??
walletSummary.sellableBalance ??
walletSummary.sellable_token_balance ??
walletSummary.sellableTokenBalance ??
stats.wallet_sellable_balance ??
stats.wallet_sellable_token_balance ??
walletTokenBalance,
walletTokenBalance
);

const walletUnlockedBalance = toInt(
walletSummary.unlocked_balance ??
walletSummary.unlockedBalance ??
walletSummary.unlocked_token_balance ??
walletSummary.unlockedTokenBalance ??
stats.wallet_unlocked_balance ??
stats.wallet_unlocked_token_balance ??
walletSellableBalance,
walletSellableBalance
);

const walletLockedBalance = toInt(
walletSummary.locked_balance ??
walletSummary.lockedBalance ??
walletSummary.locked_token_balance ??
walletSummary.lockedTokenBalance ??
stats.wallet_locked_balance ??
stats.wallet_locked_token_balance ??
Math.max(0, walletTotalBalance - walletUnlockedBalance),
Math.max(0, walletTotalBalance - walletUnlockedBalance)
);

const walletPositionValueUsd = toNumber(
walletSummary.position_value_usd ??
walletSummary.positionValueUsd ??
stats.wallet_position_value_usd,
0
);

const walletSolBalance = toNumber(
walletSummary.sol_balance ??
walletSummary.solBalance ??
stats.wallet_sol_balance,
0
);

const walletSolDelta = toNumber(
walletSummary.sol_delta ??
walletSummary.solDelta ??
stats.wallet_sol_delta ??
walletSolBalance,
walletSolBalance
);

const walletIsBuilder = Boolean(
walletSummary.wallet_is_builder ??
walletSummary.is_builder_wallet ??
stats.wallet_is_builder ??
stats.is_builder_wallet ??
false
);

const walletVestingActive = Boolean(
walletSummary.wallet_vesting_active ??
walletSummary.vesting_active ??
stats.wallet_vesting_active ??
false
);

return res.json({
ok: true,
success: true,
mint,
wallet: wallet || null,

token: {
id: tokenRow.id,
launch_id: tokenRow.launch_id,
name: tokenRow.name,
symbol: tokenRow.symbol,
ticker: tokenRow.symbol,
supply: toInt(tokenRow.supply, 0),
mint_address: revealContract ? resolvedMintAddress : null,
mint: revealContract ? resolvedMintAddress : null,
created_at: tokenRow.created_at,
},

launch: resolvedLaunch
? {
...resolvedLaunch,
contract_address: revealContract
? cleanText(resolvedLaunch.contract_address, 120) || null
: null,
mint_address: revealContract ? resolvedMintAddress : null,
lifecycle,
graduation_readiness: graduationReadiness,
builder_vesting: builderVesting,
}
: null,

chart: {
stats: snapshot?.stats || {},
candles: snapshot?.candles || [],
trades: snapshot?.trades || [],
},

pool: snapshot?.pool || null,

wallet_summary: {
...(snapshot?.wallet || {}),
token_balance: walletTokenBalance,
tokenBalance: walletTokenBalance,
total_balance: walletTotalBalance,
totalBalance: walletTotalBalance,

sellable_balance: walletSellableBalance,
sellableBalance: walletSellableBalance,
sellable_token_balance: walletSellableBalance,
sellableTokenBalance: walletSellableBalance,

unlocked_balance: walletUnlockedBalance,
unlockedBalance: walletUnlockedBalance,
unlocked_token_balance: walletUnlockedBalance,
unlockedTokenBalance: walletUnlockedBalance,

locked_balance: walletLockedBalance,
lockedBalance: walletLockedBalance,
locked_token_balance: walletLockedBalance,
lockedTokenBalance: walletLockedBalance,

position_value_usd: walletPositionValueUsd,
positionValueUsd: walletPositionValueUsd,

sol_balance: walletSolBalance,
solBalance: walletSolBalance,
sol_delta: walletSolDelta,
solDelta: walletSolDelta,

wallet_is_builder: walletIsBuilder,
is_builder_wallet: walletIsBuilder,
vesting_active: walletVestingActive,
wallet_vesting_active: walletVestingActive,

builder_total_allocation_tokens: toInt(
walletSummary.builder_total_allocation_tokens ??
stats.builder_total_allocation_tokens,
0
),
builder_unlocked_tokens: toInt(
walletSummary.builder_unlocked_tokens ??
stats.builder_unlocked_tokens,
0
),
builder_locked_tokens: toInt(
walletSummary.builder_locked_tokens ??
stats.builder_locked_tokens,
0
),
builder_sellable_tokens: toInt(
walletSummary.builder_sellable_tokens ??
stats.builder_sellable_tokens,
0
),
builder_vesting_percent_unlocked: toNumber(
walletSummary.builder_vesting_percent_unlocked ??
stats.builder_vesting_percent_unlocked,
0
),
builder_vesting_days_live: toInt(
walletSummary.builder_vesting_days_live ??
stats.builder_vesting_days_live,
0
),
},

wallet: {
...(snapshot?.wallet || {}),
token_balance: walletTokenBalance,
tokenBalance: walletTokenBalance,
total_balance: walletTotalBalance,
totalBalance: walletTotalBalance,

sellable_balance: walletSellableBalance,
sellableBalance: walletSellableBalance,
sellable_token_balance: walletSellableBalance,
sellableTokenBalance: walletSellableBalance,

unlocked_balance: walletUnlockedBalance,
unlockedBalance: walletUnlockedBalance,
unlocked_token_balance: walletUnlockedBalance,
unlockedTokenBalance: walletUnlockedBalance,

locked_balance: walletLockedBalance,
lockedBalance: walletLockedBalance,
locked_token_balance: walletLockedBalance,
lockedTokenBalance: walletLockedBalance,

position_value_usd: walletPositionValueUsd,
positionValueUsd: walletPositionValueUsd,

sol_balance: walletSolBalance,
solBalance: walletSolBalance,
sol_delta: walletSolDelta,
solDelta: walletSolDelta,

wallet_is_builder: walletIsBuilder,
is_builder_wallet: walletIsBuilder,
vesting_active: walletVestingActive,
wallet_vesting_active: walletVestingActive,

builder_total_allocation_tokens: toInt(
walletSummary.builder_total_allocation_tokens ??
stats.builder_total_allocation_tokens,
0
),
builder_unlocked_tokens: toInt(
walletSummary.builder_unlocked_tokens ??
stats.builder_unlocked_tokens,
0
),
builder_locked_tokens: toInt(
walletSummary.builder_locked_tokens ??
stats.builder_locked_tokens,
0
),
builder_sellable_tokens: toInt(
walletSummary.builder_sellable_tokens ??
stats.builder_sellable_tokens,
0
),
builder_vesting_percent_unlocked: toNumber(
walletSummary.builder_vesting_percent_unlocked ??
stats.builder_vesting_percent_unlocked,
0
),
builder_vesting_days_live: toInt(
walletSummary.builder_vesting_days_live ??
stats.builder_vesting_days_live,
0
),
},

lifecycle,
graduationPlan,
graduationReadiness: graduationReadiness,

cassie: snapshot?.cassie || {
monitoring_active: true,
phase: String(resolvedLaunch?.status || "").toLowerCase() || "commit",
layer: "market-intelligence",
},
});
} catch (error) {
console.error("GET /api/token-market/:mint failed", error);
return res.status(500).json({
ok: false,
error: "Failed to resolve token market",
message: error?.message || String(error),
});
}
});

export default router;
