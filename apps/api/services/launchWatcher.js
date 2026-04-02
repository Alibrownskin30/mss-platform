import db from "../db/index.js";
import { finalizeLaunch } from "./launcher/finalizeLaunch.js";

const COUNTDOWN_MINUTES = 2;
const COUNTDOWN_MS = COUNTDOWN_MINUTES * 60 * 1000;
const WATCH_INTERVAL_MS = 2500;

function parseUtcMs(value) {
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

function cleanText(value, max = 200) {
return String(value ?? "").trim().slice(0, max);
}

function isTransientFinalizeError(err) {
const msg = String(err?.message || err || "").toLowerCase();

return (
msg.includes("fetch failed") ||
msg.includes("und_err_socket") ||
msg.includes("socket") ||
msg.includes("timeout") ||
msg.includes("econnreset") ||
msg.includes("429") ||
msg.includes("too many requests") ||
msg.includes("block height exceeded") ||
msg.includes("blockhash not found") ||
msg.includes("failed to get recent blockhash")
);
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
countdown_started_at = COALESCE(countdown_started_at, CURRENT_TIMESTAMP),
countdown_ends_at = COALESCE(
countdown_ends_at,
datetime(CURRENT_TIMESTAMP, '+${COUNTDOWN_MINUTES} minutes')
),
live_at = COALESCE(
live_at,
datetime(CURRENT_TIMESTAMP, '+${COUNTDOWN_MINUTES} minutes')
),
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

async function forceLaunchLiveIfFinalized(launchId) {
const latest = await getLaunchById(launchId);
if (!latest) return null;

const contractAddress = cleanText(latest.contract_address, 140);
const mintReservationStatus = cleanText(
latest.mint_reservation_status,
40
).toLowerCase();

if (
latest.status !== "live" &&
latest.status !== "graduated" &&
contractAddress &&
mintReservationStatus === "finalized"
) {
await db.run(
`
UPDATE launches
SET status = 'live',
live_at = COALESCE(live_at, CURRENT_TIMESTAMP),
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launchId]
);

return getLaunchById(launchId);
}

return latest;
}

async function finalizeCountdownLaunch(launch) {
const launchId = Number(launch?.id || 0);
if (!launchId) return;

const refreshed = await getLaunchById(launchId);
if (!refreshed || refreshed.status !== "countdown") return;

const endsAt = parseUtcMs(refreshed.countdown_ends_at);
const startedAt = parseUtcMs(refreshed.countdown_started_at);
const fallbackEndsAt =
Number.isFinite(startedAt) && startedAt > 0
? startedAt + COUNTDOWN_MS
: null;

const target = Number.isFinite(endsAt) ? endsAt : fallbackEndsAt;
if (!Number.isFinite(target) || Date.now() < target) return;

try {
const result = await finalizeLaunch(launchId);
const latestAfterFinalize = await forceLaunchLiveIfFinalized(launchId);

if (!result) {
if (
latestAfterFinalize?.status === "live" ||
latestAfterFinalize?.status === "graduated"
) {
console.log(`🚀 Launch ${launchId} is now LIVE`);
}
return;
}

if (result.ok) {
console.log(`🚀 Launch ${launchId} is now LIVE`);
if (result.allocationsBuilt) {
console.log(`📦 Allocations built for launch ${launchId}`);
}
return;
}

if (
latestAfterFinalize?.status === "live" ||
latestAfterFinalize?.status === "graduated"
) {
console.log(`🚀 Launch ${launchId} is now LIVE`);
return;
}

if (result.reason === "countdown not finished") {
return;
}

if (result.reason === "minimum raise not met") {
await markLaunchFailed(launchId);
console.log(`❌ Launch ${launchId} failed after countdown`);
return;
}

if (result.reason === "builder bond not paid") {
await markLaunchFailed(launchId);
console.log(`❌ Launch ${launchId} failed due to builder bond requirement`);
return;
}

if (result.reason) {
console.log(`⚠️ Launch ${launchId} finalize returned: ${result.reason}`);
return;
}

const latest = await getLaunchById(launchId);
if (latest?.status === "countdown") {
console.warn(
`⚠️ Launch ${launchId} remains in countdown after finalize attempt`
);
}
} catch (err) {
if (isTransientFinalizeError(err)) {
console.warn(
`⚠️ Launch ${launchId} finalize hit transient RPC issue:`,
err?.message || err
);
return;
}

console.error(`Launch ${launchId} finalize crashed:`, err);
throw err;
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
const commitExpired =
Number.isFinite(commitEndsAtMs) && now >= commitEndsAtMs;

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
if (now < target) continue;

await finalizeCountdownLaunch(launch);
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

export function startLaunchWatcher() {
if (globalThis.__mssLaunchWatcherStarted) return;
globalThis.__mssLaunchWatcherStarted = true;

setTimeout(() => {
void checkLaunchCountdowns();
}, 1000);

setInterval(() => {
void checkLaunchCountdowns();
}, WATCH_INTERVAL_MS);
}
