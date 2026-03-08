import Database from "better-sqlite3";

const DB_PATH = process.env.DB_PATH || "./mss.sqlite";
export const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

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
type TEXT NOT NULL,
direction TEXT NOT NULL,
threshold REAL NOT NULL,
is_enabled INTEGER NOT NULL DEFAULT 1,
created_at TEXT NOT NULL DEFAULT (datetime('now')),
last_triggered_at TEXT,
FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_mint ON alerts(mint);
CREATE INDEX IF NOT EXISTS idx_alerts_enabled ON alerts(is_enabled);

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
CREATE INDEX IF NOT EXISTS idx_risk_created_at ON risk_history(created_at);

CREATE TABLE IF NOT EXISTS alert_events (
id INTEGER PRIMARY KEY AUTOINCREMENT,
alert_id INTEGER NOT NULL,
mint TEXT NOT NULL,
message TEXT NOT NULL,
created_at TEXT NOT NULL DEFAULT (datetime('now')),
FOREIGN KEY(alert_id) REFERENCES alerts(id)
);

CREATE INDEX IF NOT EXISTS idx_alert_events_alert ON alert_events(alert_id);
CREATE INDEX IF NOT EXISTS idx_alert_events_mint_time ON alert_events(mint, created_at);

CREATE TABLE IF NOT EXISTS scan_cache (
id INTEGER PRIMARY KEY AUTOINCREMENT,
mint TEXT NOT NULL,
token_json TEXT,
market_json TEXT,
holders_json TEXT,
cluster_json TEXT,
security_json TEXT,
cassie_json TEXT,
created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scan_cache_mint_time ON scan_cache(mint, created_at);
CREATE INDEX IF NOT EXISTS idx_scan_cache_created_at ON scan_cache(created_at);
`);

function toNumOrNull(v) {
if (v == null || v === "") return null;
const n = Number(v);
return Number.isFinite(n) ? n : null;
}

function cleanDelta(v) {
return Number.isFinite(Number(v)) ? Number(Number(v).toFixed(1)) : null;
}

function cleanPctDelta(v) {
return Number.isFinite(Number(v)) ? Number(Number(v).toFixed(2)) : null;
}

function parseDbTime(s) {
const t = new Date(`${s}Z`).getTime();
return Number.isFinite(t) ? t : null;
}

function findClosestRow(rows, targetMinutes) {
const targetMs = targetMinutes * 60 * 1000;
const now = Date.now();
let best = null;
let bestDiff = Infinity;

for (const r of rows) {
const t = parseDbTime(r.created_at);
if (!t) continue;
const diff = Math.abs((now - t) - targetMs);
if (diff < bestDiff) {
bestDiff = diff;
best = r;
}
}

return best;
}

function avg(values) {
const clean = values.filter((v) => Number.isFinite(Number(v))).map(Number);
if (!clean.length) return null;
return clean.reduce((a, b) => a + b, 0) / clean.length;
}

export function insertRiskPoint({ mint, risk, whale, top10, liqUsd, fdvUsd }) {
const stmt = db.prepare(`
INSERT INTO risk_history (mint, risk_score, whale_score, top10_pct, liq_usd, fdv_usd)
VALUES (?, ?, ?, ?, ?, ?)
`);

stmt.run(
String(mint),
Number(risk),
toNumOrNull(whale),
toNumOrNull(top10),
toNumOrNull(liqUsd),
toNumOrNull(fdvUsd)
);
}

export function upsertScanCache({
mint,
token = {},
market = {},
holders = {},
activity = {},
securityModel = {},
cassie = {},
}) {
if (!mint) return;

db.prepare(`
INSERT INTO scan_cache (
mint,
token_json,
market_json,
holders_json,
cluster_json,
security_json,
cassie_json
)
VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
String(mint),
JSON.stringify(token ?? {}),
JSON.stringify(market ?? {}),
JSON.stringify(holders ?? {}),
JSON.stringify(activity ?? {}),
JSON.stringify(securityModel ?? {}),
JSON.stringify(cassie ?? {})
);
}

export function getLatestRiskSnapshot(mint) {
const row = db
.prepare(`
SELECT
risk_score,
whale_score,
top10_pct,
liq_usd,
fdv_usd,
created_at
FROM risk_history
WHERE mint = ?
ORDER BY datetime(created_at) DESC
LIMIT 1
`)
.get(mint);

return row || null;
}

export function getPreviousRiskSnapshot(mint, excludeCreatedAt) {
if (!excludeCreatedAt) return null;

const row = db
.prepare(`
SELECT
risk_score,
whale_score,
top10_pct,
liq_usd,
fdv_usd,
created_at
FROM risk_history
WHERE mint = ? AND created_at < ?
ORDER BY datetime(created_at) DESC
LIMIT 1
`)
.get(mint, excludeCreatedAt);

return row || null;
}

export function getAlertEvents(alertId, limit = 50) {
return db
.prepare(`
SELECT id, alert_id, mint, message, created_at
FROM alert_events
WHERE alert_id = ?
ORDER BY datetime(created_at) DESC
LIMIT ?
`)
.all(alertId, Number(limit));
}

export function pruneRiskHistory({ keepPerMint = 5000, maxAgeDays = 90 } = {}) {
const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000)
.toISOString()
.replace("T", " ")
.slice(0, 19);

db.prepare(`
DELETE FROM risk_history
WHERE created_at < ?
`).run(cutoff);

const mints = db.prepare(`
SELECT mint, COUNT(*) AS cnt
FROM risk_history
GROUP BY mint
HAVING COUNT(*) > ?
`).all(Number(keepPerMint));

for (const row of mints) {
db.prepare(`
DELETE FROM risk_history
WHERE id IN (
SELECT id
FROM risk_history
WHERE mint = ?
ORDER BY datetime(created_at) DESC
LIMIT -1 OFFSET ?
)
`).run(row.mint, Number(keepPerMint));
}
}

export function pruneScanCache({ keepPerMint = 500, maxAgeDays = 30 } = {}) {
const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000)
.toISOString()
.replace("T", " ")
.slice(0, 19);

db.prepare(`
DELETE FROM scan_cache
WHERE created_at < ?
`).run(cutoff);

const mints = db.prepare(`
SELECT mint, COUNT(*) AS cnt
FROM scan_cache
GROUP BY mint
HAVING COUNT(*) > ?
`).all(Number(keepPerMint));

for (const row of mints) {
db.prepare(`
DELETE FROM scan_cache
WHERE id IN (
SELECT id
FROM scan_cache
WHERE mint = ?
ORDER BY datetime(created_at) DESC
LIMIT -1 OFFSET ?
)
`).run(row.mint, Number(keepPerMint));
}
}

export function getRiskTrend(mint) {
const rows = db
.prepare(`
SELECT risk_score, whale_score, top10_pct, liq_usd, fdv_usd, created_at
FROM risk_history
WHERE mint = ?
ORDER BY datetime(created_at) DESC
LIMIT 300
`)
.all(mint);

const latest = rows[0] || null;
if (!latest) {
return {
ok: true,
found: false,
points: 0,
};
}

const h1 = findClosestRow(rows, 60);
const h6 = findClosestRow(rows, 360);
const h24 = findClosestRow(rows, 1440);

const delta = (a, b, key) =>
a && b && Number.isFinite(Number(a[key])) && Number.isFinite(Number(b[key]))
? Number(a[key]) - Number(b[key])
: null;

const risk1h = cleanDelta(delta(latest, h1, "risk_score"));
const risk6h = cleanDelta(delta(latest, h6, "risk_score"));
const risk24h = cleanDelta(delta(latest, h24, "risk_score"));

const whale1h = cleanDelta(delta(latest, h1, "whale_score"));
const whale24h = cleanDelta(delta(latest, h24, "whale_score"));

const top10_1h = cleanPctDelta(delta(latest, h1, "top10_pct"));
const top10_24h = cleanPctDelta(delta(latest, h24, "top10_pct"));

const liq24h = cleanDelta(delta(latest, h24, "liq_usd"));

const ref = risk6h ?? risk1h ?? 0;
let momentum = "Stable";
let label = "Stable";
let state = "warn";

if (ref >= 15) {
momentum = "Escalating";
label = "Escalating";
state = "bad";
} else if (ref >= 6) {
momentum = "Rising";
label = "Rising";
state = "warn";
} else if (ref <= -10) {
momentum = "Stabilising";
label = "Cooling";
state = "good";
} else if (ref <= -4) {
momentum = "Softening";
label = "Softening";
state = "good";
}

const recentSlice = rows.slice(0, Math.min(rows.length, 12));
const avgRisk = avg(recentSlice.map((r) => r.risk_score));
const avgWhale = avg(recentSlice.map((r) => r.whale_score));
const avgTop10 = avg(recentSlice.map((r) => r.top10_pct));

return {
ok: true,
found: true,
points: rows.length,
latest: {
risk: Number(latest.risk_score),
whale: toNumOrNull(latest.whale_score),
top10: toNumOrNull(latest.top10_pct),
liqUsd: toNumOrNull(latest.liq_usd),
fdvUsd: toNumOrNull(latest.fdv_usd),
at: latest.created_at,
},
change: {
"1h": risk1h,
"6h": risk6h,
"24h": risk24h,
whale1h,
whale24h,
top10_1h,
top10_24h,
liq24h,
},
trend: {
label,
state,
momentum,
delta1h: risk1h,
delta6h: risk6h,
delta24h: risk24h,
},
averages: {
risk: avgRisk != null ? Number(avgRisk.toFixed(1)) : null,
whale: avgWhale != null ? Number(avgWhale.toFixed(1)) : null,
top10: avgTop10 != null ? Number(avgTop10.toFixed(2)) : null,
},
};
}
