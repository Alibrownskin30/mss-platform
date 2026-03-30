import db from "../db/index.js";
import { finalizeLaunch } from "./launcher/finalizeLaunch.js";

const COUNTDOWN_MINUTES = 2;
const COUNTDOWN_MS = COUNTDOWN_MINUTES * 60 * 1000;

function parseUtcMs(value) {
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
countdown_ends_at = datetime(CURRENT_TIMESTAMP, '+${COUNTDOWN_MINUTES} minutes'),
live_at = datetime(CURRENT_TIMESTAMP, '+${COUNTDOWN_MINUTES} minutes'),
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
console.log(`❌ Launch ${launchId} failed after countdown`);
}

if (result.reason && result.reason !== "countdown not finished") {
console.log(`⚠️ Launch ${launchId} finalize returned: ${result.reason}`);
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
console.log(`❌ Launch ${launchId} failed at commit expiry`);
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
return;
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
