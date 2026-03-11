import db from "../db/index.js";

const COUNTDOWN_MS = 5 * 60 * 1000;

export async function checkLaunchCountdowns() {
try {
const launches = await db.all(`
SELECT id, countdown_start
FROM launches
WHERE status = 'countdown'
`);

const now = Date.now();

for (const launch of launches) {
const start = new Date(launch.countdown_start).getTime();

if (!start) continue;

const diff = now - start;

if (diff >= COUNTDOWN_MS) {
await db.run(
`
UPDATE launches
SET status = 'live',
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launch.id]
);

console.log(`Launch ${launch.id} is now LIVE`);
}
}
} catch (err) {
console.error("Launch watcher error:", err);
}
}