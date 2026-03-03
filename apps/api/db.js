// apps/api/db.js
import Database from "better-sqlite3";

const DB_PATH = process.env.DB_PATH || "./mss.sqlite";
export const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
id INTEGER PRIMARY KEY AUTOINCREMENT,
email TEXT UNIQUE NOT NULL,
password_hash TEXT NOT NULL,
created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
id INTEGER PRIMARY KEY AUTOINCREMENT,
user_id INTEGER NOT NULL,
mint TEXT NOT NULL,
type TEXT NOT NULL, -- risk_spike | whale | liquidity | authority
direction TEXT NOT NULL, -- above | below
threshold REAL NOT NULL,
is_enabled INTEGER NOT NULL DEFAULT 1,
created_at TEXT NOT NULL DEFAULT (datetime('now')),
last_triggered_at TEXT,
FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_mint ON alerts(mint);

CREATE TABLE IF NOT EXISTS risk_history (
id INTEGER PRIMARY KEY AUTOINCREMENT,
mint TEXT NOT NULL,
risk_score REAL NOT NULL,
whale_score REAL,
top10_pct REAL,
liq_usd REAL,
fdv_usd REAL,
created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_risk_mint_time ON risk_history(mint, created_at);

CREATE TABLE IF NOT EXISTS alert_events (
id INTEGER PRIMARY KEY AUTOINCREMENT,
alert_id INTEGER NOT NULL,
mint TEXT NOT NULL,
message TEXT NOT NULL,
created_at TEXT NOT NULL DEFAULT (datetime('now')),
FOREIGN KEY(alert_id) REFERENCES alerts(id)
);
`);

export function insertRiskPoint({ mint, risk, whale, top10, liqUsd, fdvUsd }) {
const stmt = db.prepare(`
INSERT INTO risk_history (mint, risk_score, whale_score, top10_pct, liq_usd, fdv_usd)
VALUES (?, ?, ?, ?, ?, ?)
`);
stmt.run(mint, Number(risk), Number(whale ?? null), Number(top10 ?? null), Number(liqUsd ?? null), Number(fdvUsd ?? null));
}

export function getRiskTrend(mint) {
const rows = db
.prepare(
`SELECT risk_score, created_at
FROM risk_history
WHERE mint = ?
ORDER BY datetime(created_at) DESC
LIMIT 200`
)
.all(mint);

function findClosest(targetMinutes) {
const targetMs = targetMinutes * 60 * 1000;
const now = Date.now();
let best = null;
let bestDiff = Infinity;
for (const r of rows) {
const t = new Date(r.created_at + "Z").getTime();
const diff = Math.abs((now - t) - targetMs);
if (diff < bestDiff) {
bestDiff = diff;
best = r;
}
}
return best;
}

const latest = rows[0] || null;
if (!latest) return { ok: true, found: false, points: 0 };

const h1 = findClosest(60);
const h6 = findClosest(360);
const h24 = findClosest(1440);

const delta = (a, b) => (a && b ? Number(a.risk_score) - Number(b.risk_score) : null);

const d1 = delta(latest, h1);
const d6 = delta(latest, h6);
const d24 = delta(latest, h24);

let momentum = "Stable";
const ref = d6 ?? d1 ?? 0;
if (ref >= 15) momentum = "Escalating";
else if (ref <= -10) momentum = "Stabilising";

return {
ok: true,
found: true,
points: rows.length,
latest: { risk: Number(latest.risk_score), at: latest.created_at },
change: {
"1h": d1,
"6h": d6,
"24h": d24,
},
momentum,
};
}
