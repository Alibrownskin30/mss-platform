import { db } from "./db.js";

const POLL_SECONDS = Number(process.env.WATCHER_POLL_SECONDS || 60);

function nowIso() {
return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// Placeholder notification (upgrade later)
async function notify({ alert, message }) {
db.prepare(`INSERT INTO alert_events (alert_id, mint, message) VALUES (?, ?, ?)`).run(
alert.id,
alert.mint,
message
);
console.log(`🔔 ALERT [${alert.type}] mint=${alert.mint} user=${alert.user_id} :: ${message}`);
}

async function getLatestRisk(mint) {
const r = db
.prepare(
`SELECT risk_score, whale_score, top10_pct, liq_usd, fdv_usd, created_at
FROM risk_history WHERE mint = ? ORDER BY datetime(created_at) DESC LIMIT 1`
)
.get(mint);
return r || null;
}

export function startWatcher() {
setInterval(async () => {
try {
const alerts = db
.prepare(`SELECT * FROM alerts WHERE is_enabled = 1 ORDER BY id DESC LIMIT 500`)
.all();

for (const a of alerts) {
// simple cooldown
if (a.last_triggered_at) {
const last = new Date(a.last_triggered_at + "Z").getTime();
if (Date.now() - last < 5 * 60 * 1000) continue; // 5 min cooldown
}

const latest = await getLatestRisk(a.mint);
if (!latest) continue;

let value = null;
if (a.type === "risk_spike") value = Number(latest.risk_score);
if (a.type === "whale") value = Number(latest.whale_score ?? 0);
if (a.type === "liquidity") value = Number(latest.liq_usd ?? 0);
if (a.type === "authority") value = null; // reserved for future (authority polling)

if (value == null) continue;

const hit =
a.direction === "above" ? value >= Number(a.threshold) : value <= Number(a.threshold);

if (!hit) continue;

const message = `${a.type} ${a.direction} ${a.threshold} triggered. Current=${value}`;
await notify({ alert: a, message });

db.prepare(`UPDATE alerts SET last_triggered_at = ? WHERE id = ?`).run(nowIso(), a.id);
}
} catch (e) {
console.warn("Watcher error:", e?.message || e);
}
}, POLL_SECONDS * 1000);

console.log(`🛰️ Alert watcher running (every ${POLL_SECONDS}s)`);
}
