import db from "../db/index.js";
import { finalizeLaunch } from "./launcher/finalizeLaunch.js";

const COUNTDOWN_MS = 5 * 60 * 1000;

function parseUtcMs(value) {
if (!value) return null;
const ms = new Date(String(value).replace(" ", "T") + "Z").getTime();
return Number.isFinite(ms) ? ms : null;
}

async function getLaunchById(launchId) {
return db.get(
`
SELECT *
FROM launches
WHERE id = ?
`,
[launchId]
);
}

async function getCommitStats(launchId) {
const totals = await db.get(
`
SELECT
COALESCE(SUM(sol_amount), 0) AS total_committed,
COUNT(DISTINCT wallet) AS participants
FROM commits
WHERE launch_id = ?
`,
[launchId]
);

return {
totalCommitted: Number(totals?.total_committed || 0),
participants: Number(totals?.participants || 0),
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

async function beginCountdownIfNeeded(launchId) {
const launch = await getLaunchById(launchId);
if (!launch || launch.status !== "commit") return launch;

const stats = await syncLaunchStats(launchId);

const hardCap = Number(launch.hard_cap_sol || 0);
const minRaise = Number(launch.min_raise_sol || 0);

const commitEndsAtMs = parseUtcMs(launch.commit_ends_at);
const now = Date.now();
const commitExpired = Number.isFinite(commitEndsAtMs) && now >= commitEndsAtMs;

const shouldStartFromHardCap =
hardCap > 0 && Number(stats.totalCommitted) >= hardCap;

const shouldStartFromCommitExpiry =
commitExpired && minRaise > 0 && Number(stats.totalCommitted) >= minRaise;

if (!shouldStartFromHardCap && !shouldStartFromCommitExpiry) {
return await getLaunchById(launchId);
}

await db.run(
`
UPDATE launches
SET status = 'countdown',
countdown_started_at = CURRENT_TIMESTAMP,
countdown_ends_at = datetime(CURRENT_TIMESTAMP, '+5 minutes'),
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
AND status = 'commit'
`,
[launchId]
);

const refreshed = await getLaunchById(launchId);
console.log(`⏳ Launch ${launchId} entered COUNTDOWN`);
return refreshed;
}

async function markLaunchFailed(launchId) {
await db.run(
`
UPDATE launches
SET status = 'failed',
failed_at = CURRENT_TIMESTAMP,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launchId]
);

return getLaunchById(launchId);
}

async function autoRefundFailedLaunch(launch) {
if (!launch) return;

const launchId = Number(launch.id || 0);
if (!launchId) return;

const refreshed = await getLaunchById(launchId);
if (!refreshed || refreshed.status !== "failed") return;

const commits = await db.all(
`
SELECT wallet, COALESCE(SUM(sol_amount), 0) AS total_committed
FROM commits
WHERE launch_id = ?
GROUP BY wallet
`,
[launchId]
);

const builder =
String(refreshed.template || "") === "builder"
? await db.get(
`
SELECT b.wallet
FROM launches l
JOIN builders b ON b.id = l.builder_id
WHERE l.id = ?
`,
[launchId]
)
: null;

let refundedWallets = 0;
let totalRefunded = 0;

for (const row of commits) {
const wallet = String(row.wallet || "").trim();
const amount = Number(row.total_committed || 0);
if (!wallet || amount <= 0) continue;

await db.run(
`
DELETE FROM commits
WHERE launch_id = ? AND wallet = ?
`,
[launchId, wallet]
);

refundedWallets += 1;
totalRefunded += amount;
}

const shouldRefundBond =
String(refreshed.template || "") === "builder" &&
Number(refreshed.builder_bond_sol || 0) > 0 &&
Number(refreshed.builder_bond_refunded || 0) !== 1 &&
builder?.wallet;

if (shouldRefundBond) {
await db.run(
`
UPDATE launches
SET builder_bond_refunded = 1,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launchId]
);
}

await db.run(
`
UPDATE launches
SET committed_sol = 0,
participants_count = 0,
status = 'failed_refunded',
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launchId]
);

console.log(
`↩️ Launch ${launchId} auto-refunded and closed (${refundedWallets} wallet(s), ${totalRefunded} SOL${
shouldRefundBond ? " + builder bond flagged refunded" : ""
})`
);
}

async function finalizeCountdownLaunch(launch) {
const launchId = Number(launch?.id || 0);
if (!launchId) return;

const refreshed = await getLaunchById(launchId);
if (!refreshed || refreshed.status !== "countdown") return;

const result = await finalizeLaunch(launchId);

if (!result) return;

if (result.ok) {
console.log(`🚀 Launch ${launchId} is now LIVE`);
if (result.allocationsBuilt) {
console.log(`📦 Allocations built for launch ${launchId}`);
}
return;
}

if (result.reason === "minimum raise not met") {
const failedLaunch = await getLaunchById(launchId);
console.log(`❌ Launch ${launchId} failed after countdown`);
await autoRefundFailedLaunch(failedLaunch);
}
}

async function processCommitLaunches() {
const commitLaunches = await db.all(
`
SELECT *
FROM launches
WHERE status = 'commit'
`
);

const now = Date.now();

for (const launch of commitLaunches) {
const launchId = Number(launch.id || 0);
if (!launchId) continue;

const stats = await syncLaunchStats(launchId);
const hardCap = Number(launch.hard_cap_sol || 0);
const minRaise = Number(launch.min_raise_sol || 0);
const commitEndsAtMs = parseUtcMs(launch.commit_ends_at);
const commitExpired = Number.isFinite(commitEndsAtMs) && now >= commitEndsAtMs;

const hitHardCap = hardCap > 0 && Number(stats.totalCommitted) >= hardCap;
const qualifiesAtExpiry =
commitExpired && minRaise > 0 && Number(stats.totalCommitted) >= minRaise;

if (hitHardCap || qualifiesAtExpiry) {
await beginCountdownIfNeeded(launchId);
continue;
}

if (commitExpired && Number(stats.totalCommitted) < minRaise) {
await markLaunchFailed(launchId);
const failedLaunch = await getLaunchById(launchId);
console.log(`❌ Launch ${launchId} failed at commit expiry`);
await autoRefundFailedLaunch(failedLaunch);
}
}
}

async function processCountdownLaunches() {
const countdownLaunches = await db.all(
`
SELECT *
FROM launches
WHERE status = 'countdown'
`
);

const now = Date.now();

for (const launch of countdownLaunches) {
const endsAt = parseUtcMs(launch.countdown_ends_at);
const startedAt = parseUtcMs(launch.countdown_started_at);
const fallbackEndsAt =
Number.isFinite(startedAt) && startedAt > 0
? startedAt + COUNTDOWN_MS
: null;

const target = Number.isFinite(endsAt) ? endsAt : fallbackEndsAt;
if (!Number.isFinite(target)) continue;

if (now >= target) {
await finalizeCountdownLaunch(launch);
}
}
}

async function processFailedLaunches() {
const failedLaunches = await db.all(
`
SELECT *
FROM launches
WHERE status = 'failed'
`
);

for (const launch of failedLaunches) {
await autoRefundFailedLaunch(launch);
}
}

export async function checkLaunchCountdowns() {
try {
await processCommitLaunches();
await processCountdownLaunches();
await processFailedLaunches();
} catch (err) {
console.error("Launch watcher error:", err);
}
}