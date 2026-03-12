import express from "express";
import db from "../db/index.js";
import { buildLaunchAllocations } from "../services/launcher/allocationService.js";

const router = express.Router();

const COUNTDOWN_MINUTES = 5;
const MAX_WALLET_COMMIT_SOL = 1;
const MAX_TEAM_WALLETS = 5;
const MAX_TEAM_ALLOCATION_PCT = 15;
const MIN_BUILDER_BOND_SOL = 5;

const LAUNCH_FEE_SPLIT = {
founder: 0.5,
buyback: 0.3,
treasury: 0.2,
};

function cleanText(value, max = 280) {
return String(value ?? "").trim().slice(0, max);
}

function cleanSymbol(value, max = 20) {
return String(value ?? "")
.toUpperCase()
.replace(/[^A-Z0-9]/g, "")
.slice(0, max);
}

function safeNumber(value, fallback = 0) {
const n = Number(value);
return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
return Math.max(min, Math.min(max, n));
}

function parseTeamWallets(input) {
if (!input) return [];
if (Array.isArray(input)) {
return input
.map((v) => cleanText(v, 120))
.filter(Boolean)
.slice(0, MAX_TEAM_WALLETS);
}

try {
const parsed = JSON.parse(String(input));
if (Array.isArray(parsed)) {
return parsed
.map((v) => cleanText(v, 120))
.filter(Boolean)
.slice(0, MAX_TEAM_WALLETS);
}
} catch {
// ignore
}

return [];
}

function getTemplateConfig(template) {
const configs = {
degen: {
launch_type: "degen",
supply: "1000000000",
min_raise_sol: 10,
hard_cap_sol: 50,
liquidity_pct: 20,
participants_pct: 45,
reserve_pct: 30,
builder_pct: 5,
},
degen_zone: {
launch_type: "degen",
supply: "1000000000",
min_raise_sol: 10,
hard_cap_sol: 50,
liquidity_pct: 20,
participants_pct: 45,
reserve_pct: 30,
builder_pct: 5,
},
meme_lite: {
launch_type: "main",
supply: "1000000000",
min_raise_sol: 20,
hard_cap_sol: 100,
liquidity_pct: 20,
participants_pct: 45,
reserve_pct: 30,
builder_pct: 5,
},
meme_pro: {
launch_type: "main",
supply: "1000000000",
min_raise_sol: 50,
hard_cap_sol: 200,
liquidity_pct: 20,
participants_pct: 45,
reserve_pct: 30,
builder_pct: 5,
},
builder: {
launch_type: "main",
supply: "1000000000",
min_raise_sol: 50,
hard_cap_sol: 250,
liquidity_pct: 20,
participants_pct: 45,
reserve_pct: 30,
builder_pct: 5,
},
community: {
launch_type: "main",
supply: "1000000000",
min_raise_sol: 40,
hard_cap_sol: 200,
liquidity_pct: 20,
participants_pct: 45,
reserve_pct: 30,
builder_pct: 5,
},
};

return configs[template] || null;
}

function buildCommitPercent(totalCommitted, hardCap) {
const total = Number(totalCommitted || 0);
const cap = Number(hardCap || 0);
if (cap <= 0) return 0;
return Math.max(0, Math.min(100, Math.floor((total / cap) * 100)));
}

function buildFeeBreakdown(totalCommitted, launchFeePct = 5) {
const feeTotal = totalCommitted * (Number(launchFeePct) / 100);
const founderFee = feeTotal * LAUNCH_FEE_SPLIT.founder;
const buybackFee = feeTotal * LAUNCH_FEE_SPLIT.buyback;
const treasuryFee = feeTotal * LAUNCH_FEE_SPLIT.treasury;
const netRaiseAfterFee = totalCommitted - feeTotal;

return {
launchFeePct: Number(launchFeePct),
totalCommitted,
feeTotal,
founderFee,
buybackFee,
treasuryFee,
netRaiseAfterFee,
};
}

function shapeBuilderConfig(template, reqBody) {
if (template !== "builder") {
return {
team_allocation_pct: 0,
team_wallets: [],
builder_bond_sol: 0,
};
}

const teamAllocationPct = safeNumber(reqBody.team_allocation_pct, reqBody.teamAllocation);
const builderBondSol = safeNumber(reqBody.builder_bond_sol, reqBody.builderBond);
const teamWallets = parseTeamWallets(reqBody.team_wallets ?? reqBody.teamWallets);

return {
team_allocation_pct: clamp(teamAllocationPct, 0, MAX_TEAM_ALLOCATION_PCT),
team_wallets: teamWallets,
builder_bond_sol: builderBondSol,
};
}

function validateBuilderConfig(template, cfg, builderCfg) {
if (!cfg) {
throw new Error("invalid template");
}

if (Number(cfg.min_raise_sol) <= 0) {
throw new Error("invalid minimum raise");
}

if (Number(cfg.hard_cap_sol) <= Number(cfg.min_raise_sol)) {
throw new Error("hard cap must be greater than minimum raise");
}

if (template !== "builder") {
return;
}

if (!Number.isFinite(builderCfg.team_allocation_pct) || builderCfg.team_allocation_pct < 0) {
throw new Error("invalid team allocation");
}

if (builderCfg.team_allocation_pct > MAX_TEAM_ALLOCATION_PCT) {
throw new Error(`team allocation cannot exceed ${MAX_TEAM_ALLOCATION_PCT}%`);
}

if (!Array.isArray(builderCfg.team_wallets)) {
throw new Error("team wallets must be an array");
}

if (builderCfg.team_wallets.length > MAX_TEAM_WALLETS) {
throw new Error(`team wallets cannot exceed ${MAX_TEAM_WALLETS}`);
}

if (builderCfg.team_wallets.some((wallet) => !wallet)) {
throw new Error("invalid team wallet entry");
}

if (!Number.isFinite(builderCfg.builder_bond_sol) || builderCfg.builder_bond_sol < MIN_BUILDER_BOND_SOL) {
throw new Error(`builder bond must be at least ${MIN_BUILDER_BOND_SOL} SOL`);
}
}

function shapeLaunchForList(row) {
const totalCommitted = Number(row.committed_sol || 0);
const hardCap = Number(row.hard_cap_sol || 0);

return {
id: row.id,
token_name: row.token_name,
symbol: row.symbol,
description: row.description,
image_url: row.image_url,
template: row.template,
launch_type: row.launch_type,
status: row.status,
min_raise_sol: Number(row.min_raise_sol || 0),
hard_cap_sol: hardCap,
committed_sol: totalCommitted,
participants_count: Number(row.participants_count || 0),
launch_fee_pct: Number(row.launch_fee_pct || 0),
liquidity_pct: Number(row.liquidity_pct || 0),
participants_pct: Number(row.participants_pct || 0),
reserve_pct: Number(row.reserve_pct || 0),
builder_pct: Number(row.builder_pct || 0),
countdown_started_at: row.countdown_started_at || null,
countdown_ends_at: row.countdown_ends_at || null,
live_at: row.live_at || null,
builder_wallet: row.builder_wallet || null,
builder_alias: row.builder_alias || null,
builder_score: row.builder_score ?? null,
commitPercent: buildCommitPercent(totalCommitted, hardCap),
};
}

async function getLaunchById(launchId) {
return db.get(`SELECT * FROM launches WHERE id = ?`, [launchId]);
}

async function getBuilderByWallet(wallet) {
return db.get(
`SELECT id, wallet, alias FROM builders WHERE wallet = ?`,
[wallet]
);
}

async function getCommitStats(launchId) {
const totalRow = await db.get(
`
SELECT COALESCE(SUM(sol_amount), 0) AS total
FROM commits
WHERE launch_id = ?
`,
[launchId]
);

const participantsRow = await db.get(
`
SELECT COUNT(DISTINCT wallet) AS wallets
FROM commits
WHERE launch_id = ?
`,
[launchId]
);

return {
totalCommitted: Number(totalRow?.total || 0),
participants: Number(participantsRow?.wallets || 0),
};
}

async function syncLaunchStats(launchId) {
const stats = await getCommitStats(launchId);

await db.run(
`
UPDATE launches
SET committed_sol = ?,
participants_count = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[stats.totalCommitted, stats.participants, launchId]
);

return stats;
}

async function beginCountdown(launchId) {
await db.run(
`
UPDATE launches
SET status = 'countdown',
countdown_started_at = CURRENT_TIMESTAMP,
countdown_ends_at = datetime(CURRENT_TIMESTAMP, '+${COUNTDOWN_MINUTES} minutes'),
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launchId]
);

return getLaunchById(launchId);
}

//
// CREATE LAUNCH
//
router.post("/create", async (req, res) => {
try {
const wallet = cleanText(req.body.wallet, 100);
const template = cleanText(req.body.template, 40);
const tokenName = cleanText(req.body.token_name, 60);
const symbol = cleanSymbol(req.body.symbol, 20);
const description = cleanText(req.body.description, 500);
const imageUrl = cleanText(req.body.image_url, 500);

if (!wallet) {
return res.status(400).json({ ok: false, error: "wallet is required" });
}

if (!template) {
return res.status(400).json({ ok: false, error: "template is required" });
}

if (!tokenName) {
return res.status(400).json({ ok: false, error: "token_name is required" });
}

if (!symbol) {
return res.status(400).json({ ok: false, error: "symbol is required" });
}

const builder = await getBuilderByWallet(wallet);

if (!builder) {
return res.status(404).json({
ok: false,
error: "builder profile not found",
});
}

const cfg = getTemplateConfig(template);
const builderCfg = shapeBuilderConfig(template, req.body);

try {
validateBuilderConfig(template, cfg, builderCfg);
} catch (validationErr) {
return res.status(400).json({
ok: false,
error: validationErr.message,
});
}

const result = await db.run(
`
INSERT INTO launches (
builder_id,
launch_type,
template,
token_name,
symbol,
description,
image_url,
supply,
min_raise_sol,
hard_cap_sol,
launch_fee_pct,
liquidity_pct,
participants_pct,
reserve_pct,
builder_pct,
committed_sol,
participants_count,
status
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'commit')
`,
[
builder.id,
cfg.launch_type,
template,
tokenName,
symbol,
description,
imageUrl,
template === "builder" ? String(req.body.supply || cfg.supply) : cfg.supply,
cfg.min_raise_sol,
cfg.hard_cap_sol,
5,
cfg.liquidity_pct,
cfg.participants_pct,
cfg.reserve_pct,
cfg.builder_pct,
]
);

const launch = await getLaunchById(result.lastID);

return res.json({
ok: true,
launch,
builderConfig: builderCfg,
});
} catch (err) {
console.error("POST /api/launcher/create failed:", err);
return res.status(500).json({ ok: false, error: "internal server error" });
}
});

//
// COMMIT TO LAUNCH
// multiple commits allowed, max 1 SOL total per wallet
//
router.post("/commit", async (req, res) => {
try {
const launchId = Number(req.body.launchId);
const wallet = cleanText(req.body.wallet, 100);
const solAmount = Number(req.body.solAmount);

if (!launchId || !wallet || !Number.isFinite(solAmount)) {
return res.status(400).json({ ok: false, error: "missing or invalid fields" });
}

if (solAmount <= 0) {
return res.status(400).json({ ok: false, error: "solAmount must be greater than 0" });
}

const launch = await getLaunchById(launchId);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (launch.status !== "commit") {
return res.status(400).json({ ok: false, error: "commit phase closed" });
}

if (Number(launch.min_raise_sol) <= 0) {
return res.status(400).json({ ok: false, error: "invalid minimum raise" });
}

if (Number(launch.hard_cap_sol) <= Number(launch.min_raise_sol)) {
return res.status(400).json({
ok: false,
error: "hard cap must be greater than minimum raise",
});
}

const existing = await db.get(
`
SELECT COALESCE(SUM(sol_amount), 0) AS total
FROM commits
WHERE launch_id = ? AND wallet = ?
`,
[launchId, wallet]
);

const currentWalletTotal = Number(existing?.total || 0);

if (currentWalletTotal + solAmount > MAX_WALLET_COMMIT_SOL) {
return res.status(400).json({
ok: false,
error: `max commit per wallet is ${MAX_WALLET_COMMIT_SOL} SOL`,
});
}

const currentLaunchTotal = Number(launch.committed_sol || 0);
const hardCap = Number(launch.hard_cap_sol || 0);

if (currentLaunchTotal + solAmount > hardCap) {
return res.status(400).json({
ok: false,
error: "hard cap reached",
});
}

await db.run(
`
INSERT INTO commits (launch_id, wallet, sol_amount)
VALUES (?, ?, ?)
`,
[launchId, wallet, solAmount]
);

const stats = await syncLaunchStats(launchId);
let updatedLaunch = await getLaunchById(launchId);

if (
updatedLaunch.status === "commit" &&
Number(stats.totalCommitted) >= Number(updatedLaunch.min_raise_sol)
) {
updatedLaunch = await beginCountdown(launchId);
}

return res.json({
ok: true,
launchId,
wallet,
walletCommittedTotal: currentWalletTotal + solAmount,
totalCommitted: stats.totalCommitted,
participants: stats.participants,
minRaise: Number(updatedLaunch.min_raise_sol),
hardCap: Number(updatedLaunch.hard_cap_sol),
commitPercent: buildCommitPercent(
stats.totalCommitted,
updatedLaunch.hard_cap_sol
),
status: updatedLaunch.status,
countdownEndsAt: updatedLaunch.countdown_ends_at || null,
});
} catch (err) {
console.error("POST /api/launcher/commit failed:", err);
return res.status(500).json({ ok: false, error: "commit failed" });
}
});

//
// REFUND FULL WALLET COMMIT
// refunds allowed ONLY during commit phase
//
router.post("/refund", async (req, res) => {
try {
const launchId = Number(req.body.launchId);
const wallet = cleanText(req.body.wallet, 100);

if (!launchId || !wallet) {
return res.status(400).json({
ok: false,
error: "launchId and wallet are required",
});
}

const launch = await getLaunchById(launchId);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (launch.status !== "commit") {
return res.status(400).json({
ok: false,
error: "refunds are only allowed during commit phase",
});
}

const walletCommit = await db.get(
`
SELECT COALESCE(SUM(sol_amount), 0) AS total
FROM commits
WHERE launch_id = ? AND wallet = ?
`,
[launchId, wallet]
);

const refundAmount = Number(walletCommit?.total || 0);

if (refundAmount <= 0) {
return res.status(400).json({ ok: false, error: "nothing to refund" });
}

await db.run(
`
DELETE FROM commits
WHERE launch_id = ? AND wallet = ?
`,
[launchId, wallet]
);

const stats = await syncLaunchStats(launchId);
const updatedLaunch = await getLaunchById(launchId);

return res.json({
ok: true,
launchId,
wallet,
refundedSol: refundAmount,
totalCommitted: stats.totalCommitted,
participants: stats.participants,
commitPercent: buildCommitPercent(
stats.totalCommitted,
updatedLaunch.hard_cap_sol
),
status: updatedLaunch.status,
});
} catch (err) {
console.error("POST /api/launcher/refund failed:", err);
return res.status(500).json({ ok: false, error: "refund failed" });
}
});

//
// START COUNTDOWN MANUALLY
// allowed once min raise is reached
//
router.post("/:id/start-countdown", async (req, res) => {
try {
const launchId = Number(req.params.id);
const launch = await getLaunchById(launchId);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (launch.status !== "commit") {
return res.status(400).json({
ok: false,
error: "countdown can only start from commit phase",
});
}

if (Number(launch.min_raise_sol) <= 0) {
return res.status(400).json({ ok: false, error: "invalid minimum raise" });
}

if (Number(launch.hard_cap_sol) <= Number(launch.min_raise_sol)) {
return res.status(400).json({
ok: false,
error: "hard cap must be greater than minimum raise",
});
}

const stats = await syncLaunchStats(launchId);
const minRaise = Number(launch.min_raise_sol);

if (stats.totalCommitted < minRaise) {
return res.status(400).json({
ok: false,
error: "min raise not reached",
});
}

const updatedLaunch = await beginCountdown(launchId);

return res.json({
ok: true,
launchId,
status: updatedLaunch.status,
countdownStartedAt: updatedLaunch.countdown_started_at,
countdownEndsAt: updatedLaunch.countdown_ends_at,
totalCommitted: stats.totalCommitted,
participants: stats.participants,
commitPercent: buildCommitPercent(
stats.totalCommitted,
updatedLaunch.hard_cap_sol
),
});
} catch (err) {
console.error("POST /api/launcher/:id/start-countdown failed:", err);
return res.status(500).json({ ok: false, error: "failed to start countdown" });
}
});

//
// CANCEL COUNTDOWN BACK TO COMMIT
//
router.post("/:id/cancel-countdown", async (req, res) => {
try {
const launchId = Number(req.params.id);
const launch = await getLaunchById(launchId);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (launch.status !== "countdown") {
return res.status(400).json({ ok: false, error: "launch is not in countdown" });
}

await db.run(
`
UPDATE launches
SET status = 'commit',
countdown_started_at = NULL,
countdown_ends_at = NULL,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launchId]
);

const updatedLaunch = await getLaunchById(launchId);

return res.json({
ok: true,
launchId,
status: updatedLaunch.status,
});
} catch (err) {
console.error("POST /api/launcher/:id/cancel-countdown failed:", err);
return res.status(500).json({ ok: false, error: "failed to cancel countdown" });
}
});

//
// FINALIZE LIVE LAUNCH
// only after countdown has ended
//
router.post("/:id/finalize", async (req, res) => {
try {
const launchId = Number(req.params.id);
let launch = await getLaunchById(launchId);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (launch.status !== "countdown") {
return res.status(400).json({ ok: false, error: "launch is not in countdown" });
}

const countdownCheck = await db.get(
`
SELECT
CASE
WHEN countdown_ends_at IS NOT NULL AND datetime('now') >= datetime(countdown_ends_at)
THEN 1 ELSE 0
END AS ready
FROM launches
WHERE id = ?
`,
[launchId]
);

if (!countdownCheck || Number(countdownCheck.ready) !== 1) {
return res.status(400).json({
ok: false,
error: "countdown has not finished yet",
});
}

const stats = await syncLaunchStats(launchId);
launch = await getLaunchById(launchId);

if (Number(launch.min_raise_sol) <= 0) {
return res.status(400).json({ ok: false, error: "invalid minimum raise" });
}

if (Number(launch.hard_cap_sol) <= Number(launch.min_raise_sol)) {
return res.status(400).json({
ok: false,
error: "hard cap must be greater than minimum raise",
});
}

if (Number(stats.totalCommitted) < Number(launch.min_raise_sol)) {
return res.status(400).json({
ok: false,
error: "min raise no longer satisfied",
});
}

await db.run(
`
UPDATE launches
SET status = 'live',
live_at = CURRENT_TIMESTAMP,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launchId]
);

const updatedLaunch = await getLaunchById(launchId);
const allocationResult = await buildLaunchAllocations(launchId);
const feeBreakdown = buildFeeBreakdown(
Number(stats.totalCommitted),
Number(updatedLaunch.launch_fee_pct || 5)
);

return res.json({
ok: true,
launchId,
status: updatedLaunch.status,
liveAt: updatedLaunch.live_at || null,
totalCommitted: stats.totalCommitted,
participants: stats.participants,
commitPercent: buildCommitPercent(
stats.totalCommitted,
updatedLaunch.hard_cap_sol
),
feeBreakdown,
execution: allocationResult,
});
} catch (err) {
console.error("POST /api/launcher/:id/finalize failed:", err);
return res.status(400).json({
ok: false,
error: err.message || "finalize failed",
});
}
});

//
// LIST LAUNCHES FOR UI
//
router.get("/list", async (_req, res) => {
try {
const rows = await db.all(
`
SELECT
l.*,
b.wallet AS builder_wallet,
b.alias AS builder_alias,
b.builder_score
FROM launches l
JOIN builders b ON b.id = l.builder_id
ORDER BY l.id DESC
`
);

const shaped = rows.map(shapeLaunchForList);

const grouped = {
commit: shaped.filter((x) => x.status === "commit"),
countdown: shaped.filter((x) => x.status === "countdown"),
live: shaped.filter((x) => x.status === "live"),
};

return res.json({
ok: true,
launches: grouped,
all: shaped,
});
} catch (err) {
console.error("GET /api/launcher/list failed:", err);
return res.status(500).json({ ok: false, error: "failed to fetch launches" });
}
});

//
// GET COMMIT STATS
//
router.get("/commits/:launchId", async (req, res) => {
try {
const launchId = Number(req.params.launchId);

if (!launchId) {
return res.status(400).json({ ok: false, error: "invalid launchId" });
}

const launch = await getLaunchById(launchId);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

const stats = await getCommitStats(launchId);

const recent = await db.all(
`
SELECT wallet, sol_amount, created_at
FROM commits
WHERE launch_id = ?
ORDER BY id DESC
LIMIT 25
`,
[launchId]
);

return res.json({
ok: true,
launchId,
status: launch.status,
minRaise: Number(launch.min_raise_sol),
hardCap: Number(launch.hard_cap_sol),
totalCommitted: stats.totalCommitted,
participants: stats.participants,
commitPercent: buildCommitPercent(
stats.totalCommitted,
launch.hard_cap_sol
),
countdownStartedAt: launch.countdown_started_at || null,
countdownEndsAt: launch.countdown_ends_at || null,
recent,
});
} catch (err) {
console.error("GET /api/launcher/commits/:launchId failed:", err);
return res.status(500).json({ ok: false, error: "failed to fetch commit stats" });
}
});

//
// EXECUTE LIVE LAUNCH ALLOCATIONS
// kept for compatibility, but only allowed once launch is live
//
router.post("/:id/execute", async (req, res) => {
try {
const launchId = Number(req.params.id);
const launch = await getLaunchById(launchId);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (launch.status !== "live") {
return res.status(400).json({
ok: false,
error: "launch must be live before allocations can be built",
});
}

const stats = await syncLaunchStats(launchId);
const allocationResult = await buildLaunchAllocations(launchId);
const feeBreakdown = buildFeeBreakdown(
Number(stats.totalCommitted),
Number(launch.launch_fee_pct || 5)
);

const updatedLaunch = await getLaunchById(launchId);

return res.json({
ok: true,
execution: allocationResult,
feeBreakdown,
launch: updatedLaunch,
});
} catch (err) {
console.error("POST /api/launcher/:id/execute failed:", err);
return res.status(400).json({ ok: false, error: err.message });
}
});

//
// GET ALLOCATIONS FOR A LAUNCH
//
router.get("/:id/allocations", async (req, res) => {
try {
const launchId = Number(req.params.id);

const rows = await db.all(
`SELECT * FROM allocations WHERE launch_id = ? ORDER BY id ASC`,
[launchId]
);

return res.json({ ok: true, allocations: rows });
} catch (err) {
console.error("GET /api/launcher/:id/allocations failed:", err);
return res.status(500).json({ ok: false, error: "internal server error" });
}
});

//
// GET LAUNCH BY ID
//
router.get("/:id", async (req, res) => {
try {
const id = Number(req.params.id);

const launch = await db.get(
`
SELECT
l.*,
b.wallet AS builder_wallet,
b.alias AS builder_alias,
b.builder_score
FROM launches l
JOIN builders b ON b.id = l.builder_id
WHERE l.id = ?
`,
[id]
);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

return res.json({
ok: true,
launch: {
...launch,
commitPercent: buildCommitPercent(
launch.committed_sol,
launch.hard_cap_sol
),
},
});
} catch (err) {
console.error("GET /api/launcher/:id failed:", err);
return res.status(500).json({ ok: false, error: "internal server error" });
}
});

export default router;