import db from "../db/index.js";
import { reconcileLaunchState } from "../routes/launcher.js";

export async function checkLaunchCountdowns() {
try {
const launches = await db.all(`
SELECT id
FROM launches
WHERE status IN ('commit', 'countdown', 'failed')
ORDER BY id ASC
`);

for (const launch of launches) {
try {
await reconcileLaunchState(launch.id);
} catch (err) {
console.error(`Lifecycle reconcile failed for launch ${launch.id}:`, err);
}
}
} catch (err) {
console.error("Launch watcher error:", err);
}
}