import db from "../db/index.js";
import { buildLaunchAllocations } from "./launcher/allocationService.js";

async function autoRefundFailedLaunch(launch) {
if (!launch) return;

const launchId = Number(launch.id || 0);
if (!launchId) return;

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
String(launch.template || "") === "builder"
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

for (const row of commits) {
const wallet = String(row.wallet || "").trim();
if (!wallet) continue;
refundedWallets += 1;
}

await db.run(
`
DELETE FROM commits
WHERE launch_id = ?
`,
[launchId]
);

const shouldRefundBond =
String(launch.template || "") === "builder" &&
Number(launch.builder_bond_sol || 0) > 0 &&
Number(launch.builder_bond_refunded || 0) !== 1 &&
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
`↩️ Launch ${launchId} auto-refunded and closed (${refundedWallets} wallet(s)${
shouldRefundBond ? " + builder bond" : ""
})`
);
}

async function finalizeCountdownLaunch(launch) {
const launchId = Number(launch?.id || 0);
if (!launchId) return;

const refreshed = await db.get(
`
SELECT *
FROM launches
WHERE id = ?
`,
[launchId]
);

if (!refreshed || refreshed.status !== "countdown") return;

const totalCommitted = Number(refreshed.committed_sol || 0);
const minRaise = Number(refreshed.min_raise_sol || 0);

if (totalCommitted < minRaise) {
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

const failedLaunch = await db.get(
`
SELECT *
FROM launches
WHERE id = ?
`,
[launchId]
);

console.log(`❌ Launch ${launchId} failed after countdown`);
await autoRefundFailedLaunch(failedLaunch);
return;
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

console.log(`🚀 Launch ${launchId} is now LIVE`);

try {
await buildLaunchAllocations(launchId);
console.log(`📦 Allocations built for launch ${launchId}`);
} catch (err) {
const msg = String(err?.message || err || "");
if (!msg.toLowerCase().includes("allocations already built")) {
console.error(`Allocation build failed for launch ${launchId}`, err);
}
}
}

export async function checkLaunchCountdowns() {
try {
const countdownLaunches = await db.all(
`
SELECT id, countdown_started_at, countdown_ends_at
FROM launches
WHERE status = 'countdown'
`
);

const now = Date.now();

for (const launch of countdownLaunches) {
const endsAt = launch?.countdown_ends_at
? new Date(String(launch.countdown_ends_at).replace(" ", "T") + "Z").getTime()
: null;

const startedAt = launch?.countdown_started_at
? new Date(String(launch.countdown_started_at).replace(" ", "T") + "Z").getTime()
: null;

const fallbackEndsAt =
Number.isFinite(startedAt) && startedAt > 0
? startedAt + 5 * 60 * 1000
: null;

const target = Number.isFinite(endsAt) ? endsAt : fallbackEndsAt;
if (!Number.isFinite(target)) continue;

if (now >= target) {
await finalizeCountdownLaunch(launch);
}
}

const failedLaunchesNeedingRefund = await db.all(
`
SELECT *
FROM launches
WHERE status = 'failed'
`
);

for (const launch of failedLaunchesNeedingRefund) {
await autoRefundFailedLaunch(launch);
}
} catch (err) {
console.error("Launch watcher error:", err);
}
}