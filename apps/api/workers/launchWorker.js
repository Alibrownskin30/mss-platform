import db from "../db/index.js";
import { reconcileLaunchState } from "../routes/launcher.js";

const POLL_INTERVAL_MS = 5000;

let launchWorkerTimer = null;
let launchWorkerRunning = false;

async function getActiveLaunchIds() {
const rows = await db.all(
`
SELECT id
FROM launches
WHERE status IN ('commit', 'countdown', 'failed')
ORDER BY id ASC
`
);

return rows.map((row) => Number(row.id)).filter(Boolean);
}

async function tickLaunchWorker() {
if (launchWorkerRunning) return;
launchWorkerRunning = true;

try {
const launchIds = await getActiveLaunchIds();

for (const launchId of launchIds) {
try {
await reconcileLaunchState(launchId);
} catch (err) {
console.error(`[launchWorker] reconcile failed for launch ${launchId}:`, err);
}
}
} catch (err) {
console.error("[launchWorker] tick failed:", err);
} finally {
launchWorkerRunning = false;
}
}

export function startLaunchWorker() {
if (launchWorkerTimer) {
return launchWorkerTimer;
}

tickLaunchWorker().catch((err) => {
console.error("[launchWorker] initial tick failed:", err);
});

launchWorkerTimer = setInterval(() => {
tickLaunchWorker().catch((err) => {
console.error("[launchWorker] interval tick failed:", err);
});
}, POLL_INTERVAL_MS);

console.log(`[launchWorker] started (${POLL_INTERVAL_MS}ms interval)`);
return launchWorkerTimer;
}

export function stopLaunchWorker() {
if (!launchWorkerTimer) return;

clearInterval(launchWorkerTimer);
launchWorkerTimer = null;
console.log("[launchWorker] stopped");
}
