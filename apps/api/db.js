import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import {
buildSentinelSnapshotFromSecurityScan,
normalizeSentinelSnapshot,
} from "./services/cassie/sentinel/snapshot-normalizer.js";

function cleanText(value, max = 1000) {
return String(value ?? "").trim().slice(0, max);
}

function resolveScannerDbPath() {
const explicitPath = cleanText(
process.env.SCANNER_DB_PATH ||
process.env.MSS_SCANNER_DB_PATH ||
process.env.AUTH_DB_PATH ||
process.env.ALERTS_DB_PATH ||
process.env.MSS_DB_PATH ||
"",
1000
);

if (explicitPath) {
return explicitPath === ":memory:" ? explicitPath : path.resolve(explicitPath);
}

return path.resolve("./mss.sqlite");
}

const DB_PATH = resolveScannerDbPath();

if (DB_PATH !== ":memory:") {
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

export const db = new Database(DB_PATH);

try {
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
} catch (error) {
console.warn("[scanner-db] SQLite pragma setup warning:", error?.message || error);
}

console.log(`[scanner-db] Connected to SQLite database: ${DB_PATH}`);

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
activity_json TEXT,
concentration_json TEXT,
trend_json TEXT,
scan_json TEXT,
security_scan_json TEXT,
sentinel_snapshot_json TEXT,
source TEXT,
execution_mode TEXT,
linked_operator_cluster_id TEXT,
seller_exhaustion_score REAL,
reclaim_strength_score REAL,
buy_pressure_score REAL,
persistence_score REAL,
structural_health_score REAL,
regime_score REAL,
regime_state TEXT,
recent_rug_rate_pct REAL,
reclaim_success_rate_pct REAL,
recent_runner_count REAL,
breakout_follow_through_score REAL,
vertical_extension_score REAL,
insider_sell_score REAL,
liquidity_decay_score REAL,
transfer_restriction_risk REAL,
honeypot_risk REAL,
liquidity_break_risk REAL,
spoofed_volume_risk REAL,
bars_since_launch REAL,
bars_since_local_low REAL,
failed_breakout_count REAL,
current_multiple REAL,
current_value_usd REAL,
slot INTEGER,
signature TEXT,
discovered_at TEXT,
created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scan_cache_mint_time ON scan_cache(mint, created_at);
CREATE INDEX IF NOT EXISTS idx_scan_cache_created_at ON scan_cache(created_at);
`);

function ensureColumn(tableName, columnName, columnType) {
try {
const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
const hasColumn = columns.some((column) => column?.name === columnName);
if (!hasColumn) {
db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
}
} catch (error) {
console.warn(
`[scanner-db] Failed ensuring column ${tableName}.${columnName}:`,
error?.message || error
);
}
}

[
["activity_json", "TEXT"],
["concentration_json", "TEXT"],
["trend_json", "TEXT"],
["scan_json", "TEXT"],
["security_scan_json", "TEXT"],
["sentinel_snapshot_json", "TEXT"],
["source", "TEXT"],
["execution_mode", "TEXT"],
["linked_operator_cluster_id", "TEXT"],
["seller_exhaustion_score", "REAL"],
["reclaim_strength_score", "REAL"],
["buy_pressure_score", "REAL"],
["persistence_score", "REAL"],
["structural_health_score", "REAL"],
["regime_score", "REAL"],
["regime_state", "TEXT"],
["recent_rug_rate_pct", "REAL"],
["reclaim_success_rate_pct", "REAL"],
["recent_runner_count", "REAL"],
["breakout_follow_through_score", "REAL"],
["vertical_extension_score", "REAL"],
["insider_sell_score", "REAL"],
["liquidity_decay_score", "REAL"],
["transfer_restriction_risk", "REAL"],
["honeypot_risk", "REAL"],
["liquidity_break_risk", "REAL"],
["spoofed_volume_risk", "REAL"],
["bars_since_launch", "REAL"],
["bars_since_local_low", "REAL"],
["failed_breakout_count", "REAL"],
["current_multiple", "REAL"],
["current_value_usd", "REAL"],
["slot", "INTEGER"],
["signature", "TEXT"],
["discovered_at", "TEXT"],
["updated_at", "TEXT"],
].forEach(([columnName, columnType]) => {
ensureColumn("scan_cache", columnName, columnType);
});

db.exec(`
CREATE INDEX IF NOT EXISTS idx_scan_cache_mint_updated_time
ON scan_cache(mint, updated_at);

CREATE INDEX IF NOT EXISTS idx_scan_cache_updated_at
ON scan_cache(updated_at);
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
const diff = Math.abs(now - t - targetMs);
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

function safeJsonStringify(value, fallback = {}) {
try {
return JSON.stringify(value ?? fallback);
} catch {
return JSON.stringify(fallback);
}
}

function deriveConcentrationFromHolders(holders = {}) {
const rows = Array.isArray(holders?.holders) ? holders.holders : [];
const pct = rows.map((item) => Number(item?.pctSupply || 0));

const sumTopN = (n) => pct.slice(0, n).reduce((sum, value) => sum + value, 0);

return {
top1: sumTopN(1),
top5: sumTopN(5),
top10: sumTopN(10),
top20: sumTopN(20),
};
}

function getNestedNumber(source, path, fallback = null) {
if (!source || typeof source !== "object") return fallback;

const value = String(path || "")
.split(".")
.filter(Boolean)
.reduce((acc, key) => (acc == null ? undefined : acc[key]), source);

return toNumOrNull(value ?? fallback);
}

function buildCacheScanPayload({
mint,
token = {},
market = {},
holders = {},
concentration = {},
activity = {},
securityModel = {},
cassie = {},
trend = {},
scanMeta = {},
sentinelSnapshot = null,
}) {
const executionMode =
cleanText(
scanMeta.execution_mode ||
sentinelSnapshot?.execution_mode ||
cassie?.execution_mode ||
securityModel?.execution_mode ||
"paper",
64
) || "paper";

const linkedOperatorClusterId =
cleanText(
scanMeta.linked_operator_cluster_id ||
sentinelSnapshot?.linked_operator_cluster_id ||
securityModel?.walletNetwork?.primaryClusterId ||
activity?.primaryClusterId ||
"",
255
) || null;

return {
mint,
token,
market,
holders,
concentration,
activity,
securityModel,
cassie,
trend,
source: cleanText(scanMeta.source || "scanner_cache", 120) || "scanner_cache",
execution_mode: executionMode,
linked_operator_cluster_id: linkedOperatorClusterId,
slot: toNumOrNull(scanMeta.slot),
signature: cleanText(scanMeta.signature, 128) || null,
discovered_at: cleanText(scanMeta.discovered_at, 64) || null,
seller_exhaustion_score: toNumOrNull(sentinelSnapshot?.seller_exhaustion_score),
reclaim_strength_score: toNumOrNull(sentinelSnapshot?.reclaim_strength_score),
buy_pressure_score: toNumOrNull(sentinelSnapshot?.buy_pressure_score),
persistence_score: toNumOrNull(sentinelSnapshot?.persistence_score),
structural_health_score: toNumOrNull(sentinelSnapshot?.structural_health_score),
regime_score: toNumOrNull(sentinelSnapshot?.regime_score),
regime_state: cleanText(sentinelSnapshot?.regime_state, 64) || null,
recent_rug_rate_pct: toNumOrNull(sentinelSnapshot?.recent_rug_rate_pct),
reclaim_success_rate_pct: toNumOrNull(sentinelSnapshot?.reclaim_success_rate_pct),
recent_runner_count: toNumOrNull(sentinelSnapshot?.recent_runner_count),
breakout_follow_through_score: toNumOrNull(
sentinelSnapshot?.breakout_follow_through_score
),
vertical_extension_score: toNumOrNull(sentinelSnapshot?.vertical_extension_score),
insider_sell_score: toNumOrNull(sentinelSnapshot?.insider_sell_score),
liquidity_decay_score: toNumOrNull(sentinelSnapshot?.liquidity_decay_score),
transfer_restriction_risk: toNumOrNull(
sentinelSnapshot?.transfer_restriction_risk
),
honeypot_risk: toNumOrNull(sentinelSnapshot?.honeypot_risk),
liquidity_break_risk: toNumOrNull(sentinelSnapshot?.liquidity_break_risk),
spoofed_volume_risk: toNumOrNull(sentinelSnapshot?.spoofed_volume_risk),
bars_since_launch: toNumOrNull(sentinelSnapshot?.bars_since_launch),
bars_since_local_low: toNumOrNull(sentinelSnapshot?.bars_since_local_low),
failed_breakout_count: toNumOrNull(sentinelSnapshot?.failed_breakout_count),
current_multiple: toNumOrNull(sentinelSnapshot?.current_multiple),
current_value_usd: toNumOrNull(sentinelSnapshot?.current_value_usd),
};
}

function buildSentinelSnapshotForCache({
mint,
token = {},
market = {},
holders = {},
concentration = null,
activity = {},
securityModel = {},
cassie = {},
trend = {},
scanMeta = {},
}) {
const safeConcentration =
concentration && typeof concentration === "object"
? concentration
: deriveConcentrationFromHolders(holders);

try {
return normalizeSentinelSnapshot(
buildSentinelSnapshotFromSecurityScan(
{
mint,
token,
market,
holders,
concentration: safeConcentration,
activity,
securityModel,
cassie,
trend,
execution_mode:
cleanText(scanMeta.execution_mode, 64) ||
cleanText(cassie?.execution_mode, 64) ||
"paper",
linked_operator_cluster_id:
cleanText(scanMeta.linked_operator_cluster_id, 255) ||
cleanText(securityModel?.walletNetwork?.primaryClusterId, 255) ||
cleanText(activity?.primaryClusterId, 255) ||
null,
},
{
source: cleanText(scanMeta.source || "scanner_cache", 120) || "scanner_cache",
execution_mode:
cleanText(scanMeta.execution_mode, 64) ||
cleanText(cassie?.execution_mode, 64) ||
"paper",
}
)
);
} catch {
return normalizeSentinelSnapshot({
source: cleanText(scanMeta.source || "scanner_cache", 120) || "scanner_cache",
token_id: mint,
mint_address: mint,
execution_mode:
cleanText(scanMeta.execution_mode, 64) ||
cleanText(cassie?.execution_mode, 64) ||
"paper",
linked_operator_cluster_id:
cleanText(scanMeta.linked_operator_cluster_id, 255) ||
cleanText(securityModel?.walletNetwork?.primaryClusterId, 255) ||
cleanText(activity?.primaryClusterId, 255) ||
null,
marketcap_usd: toNumOrNull(market?.mcapUsd ?? market?.marketCapUsd),
liquidity_usd: toNumOrNull(market?.liquidityUsd) ?? 0,
current_price: toNumOrNull(market?.priceUsd),
top_holder_pct: toNumOrNull(safeConcentration?.top1),
top_5_holder_pct: toNumOrNull(safeConcentration?.top5),
seller_exhaustion_score: getNestedNumber(
securityModel,
"sellerExhaustion.score",
null
),
reclaim_strength_score: getNestedNumber(
securityModel,
"reclaimStrength.score",
null
),
buy_pressure_score: getNestedNumber(
securityModel,
"buyPressure.score",
null
),
persistence_score: getNestedNumber(securityModel, "reputation.score", null),
structural_health_score: getNestedNumber(
securityModel,
"liquidityStability.score",
null
),
regime_score: toNumOrNull(cassie?.score),
regime_state: null,
vertical_extension_score: toNumOrNull(
securityModel?.verticalExtension?.score
),
insider_sell_score: toNumOrNull(
securityModel?.developerActivity?.score ?? 0
),
liquidity_decay_score: toNumOrNull(
securityModel?.liquidityDecay?.score ??
(securityModel?.liquidityStability?.score != null
? 100 - Number(securityModel.liquidityStability.score)
: null)
),
transfer_restriction_risk: toNumOrNull(token?.freezeAuthority ? 80 : 0),
honeypot_risk: 0,
liquidity_break_risk: 0,
spoofed_volume_risk: 0,
failed_breakout_count: 0,
current_multiple: null,
current_value_usd: null,
});
}
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
concentration = null,
trend = {},
securityModel = {},
cassie = {},
scanMeta = {},
}) {
const safeMint = cleanText(mint, 128);
if (!safeMint) return;

const safeConcentration =
concentration && typeof concentration === "object"
? concentration
: deriveConcentrationFromHolders(holders);

const sentinelSnapshot = buildSentinelSnapshotForCache({
mint: safeMint,
token,
market,
holders,
concentration: safeConcentration,
activity,
securityModel,
cassie,
trend,
scanMeta,
});

const scanPayload = buildCacheScanPayload({
mint: safeMint,
token,
market,
holders,
concentration: safeConcentration,
activity,
securityModel,
cassie,
trend,
scanMeta,
sentinelSnapshot,
});

const serialized = {
token_json: safeJsonStringify(token),
market_json: safeJsonStringify(market),
holders_json: safeJsonStringify(holders),
cluster_json: safeJsonStringify(activity),
activity_json: safeJsonStringify(activity),
concentration_json: safeJsonStringify(safeConcentration),
trend_json: safeJsonStringify(trend),
security_json: safeJsonStringify(securityModel),
cassie_json: safeJsonStringify(cassie),
scan_json: safeJsonStringify(scanPayload),
security_scan_json: safeJsonStringify(scanPayload),
sentinel_snapshot_json: safeJsonStringify(sentinelSnapshot),
};

const latest = db
.prepare(
`
SELECT id
FROM scan_cache
WHERE mint = ?
ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, id DESC
LIMIT 1
`
)
.get(safeMint);

const params = [
serialized.token_json,
serialized.market_json,
serialized.holders_json,
serialized.cluster_json,
serialized.security_json,
serialized.cassie_json,
serialized.activity_json,
serialized.concentration_json,
serialized.trend_json,
serialized.scan_json,
serialized.security_scan_json,
serialized.sentinel_snapshot_json,
cleanText(scanPayload.source, 120) || "scanner_cache",
cleanText(scanPayload.execution_mode, 64) || "paper",
cleanText(scanPayload.linked_operator_cluster_id, 255) || null,
toNumOrNull(scanPayload.seller_exhaustion_score),
toNumOrNull(scanPayload.reclaim_strength_score),
toNumOrNull(scanPayload.buy_pressure_score),
toNumOrNull(scanPayload.persistence_score),
toNumOrNull(scanPayload.structural_health_score),
toNumOrNull(scanPayload.regime_score),
cleanText(scanPayload.regime_state, 64) || null,
toNumOrNull(scanPayload.recent_rug_rate_pct),
toNumOrNull(scanPayload.reclaim_success_rate_pct),
toNumOrNull(scanPayload.recent_runner_count),
toNumOrNull(scanPayload.breakout_follow_through_score),
toNumOrNull(scanPayload.vertical_extension_score),
toNumOrNull(scanPayload.insider_sell_score),
toNumOrNull(scanPayload.liquidity_decay_score),
toNumOrNull(scanPayload.transfer_restriction_risk),
toNumOrNull(scanPayload.honeypot_risk),
toNumOrNull(scanPayload.liquidity_break_risk),
toNumOrNull(scanPayload.spoofed_volume_risk),
toNumOrNull(scanPayload.bars_since_launch),
toNumOrNull(scanPayload.bars_since_local_low),
toNumOrNull(scanPayload.failed_breakout_count),
toNumOrNull(scanPayload.current_multiple),
toNumOrNull(scanPayload.current_value_usd),
toNumOrNull(scanPayload.slot),
cleanText(scanPayload.signature, 128) || null,
cleanText(scanPayload.discovered_at, 64) || null,
];

if (latest?.id) {
db.prepare(
`
UPDATE scan_cache
SET
token_json = ?,
market_json = ?,
holders_json = ?,
cluster_json = ?,
security_json = ?,
cassie_json = ?,
activity_json = ?,
concentration_json = ?,
trend_json = ?,
scan_json = ?,
security_scan_json = ?,
sentinel_snapshot_json = ?,
source = ?,
execution_mode = ?,
linked_operator_cluster_id = ?,
seller_exhaustion_score = ?,
reclaim_strength_score = ?,
buy_pressure_score = ?,
persistence_score = ?,
structural_health_score = ?,
regime_score = ?,
regime_state = ?,
recent_rug_rate_pct = ?,
reclaim_success_rate_pct = ?,
recent_runner_count = ?,
breakout_follow_through_score = ?,
vertical_extension_score = ?,
insider_sell_score = ?,
liquidity_decay_score = ?,
transfer_restriction_risk = ?,
honeypot_risk = ?,
liquidity_break_risk = ?,
spoofed_volume_risk = ?,
bars_since_launch = ?,
bars_since_local_low = ?,
failed_breakout_count = ?,
current_multiple = ?,
current_value_usd = ?,
slot = ?,
signature = ?,
discovered_at = ?,
updated_at = datetime('now')
WHERE id = ?
`
).run(...params, latest.id);

return;
}

db.prepare(
`
INSERT INTO scan_cache (
mint,
token_json,
market_json,
holders_json,
cluster_json,
security_json,
cassie_json,
activity_json,
concentration_json,
trend_json,
scan_json,
security_scan_json,
sentinel_snapshot_json,
source,
execution_mode,
linked_operator_cluster_id,
seller_exhaustion_score,
reclaim_strength_score,
buy_pressure_score,
persistence_score,
structural_health_score,
regime_score,
regime_state,
recent_rug_rate_pct,
reclaim_success_rate_pct,
recent_runner_count,
breakout_follow_through_score,
vertical_extension_score,
insider_sell_score,
liquidity_decay_score,
transfer_restriction_risk,
honeypot_risk,
liquidity_break_risk,
spoofed_volume_risk,
bars_since_launch,
bars_since_local_low,
failed_breakout_count,
current_multiple,
current_value_usd,
slot,
signature,
discovered_at,
created_at,
updated_at
)
VALUES (
?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now')
)
`
).run(safeMint, ...params);
}

export function getLatestRiskSnapshot(mint) {
const row = db
.prepare(
`
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
`
)
.get(mint);

return row || null;
}

export function getPreviousRiskSnapshot(mint, excludeCreatedAt) {
if (!excludeCreatedAt) return null;

const row = db
.prepare(
`
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
`
)
.get(mint, excludeCreatedAt);

return row || null;
}

export function getAlertEvents(alertId, limit = 50) {
return db
.prepare(
`
SELECT id, alert_id, mint, message, created_at
FROM alert_events
WHERE alert_id = ?
ORDER BY datetime(created_at) DESC
LIMIT ?
`
)
.all(alertId, Number(limit));
}

export function pruneRiskHistory({ keepPerMint = 5000, maxAgeDays = 90 } = {}) {
const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000)
.toISOString()
.replace("T", " ")
.slice(0, 19);

db.prepare(
`
DELETE FROM risk_history
WHERE created_at < ?
`
).run(cutoff);

const mints = db
.prepare(
`
SELECT mint, COUNT(*) AS cnt
FROM risk_history
GROUP BY mint
HAVING COUNT(*) > ?
`
)
.all(Number(keepPerMint));

for (const row of mints) {
db.prepare(
`
DELETE FROM risk_history
WHERE id IN (
SELECT id
FROM risk_history
WHERE mint = ?
ORDER BY datetime(created_at) DESC
LIMIT -1 OFFSET ?
)
`
).run(row.mint, Number(keepPerMint));
}
}

export function pruneScanCache({ keepPerMint = 500, maxAgeDays = 30 } = {}) {
const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000)
.toISOString()
.replace("T", " ")
.slice(0, 19);

db.prepare(
`
DELETE FROM scan_cache
WHERE datetime(COALESCE(updated_at, created_at)) < ?
`
).run(cutoff);

const mints = db
.prepare(
`
SELECT mint, COUNT(*) AS cnt
FROM scan_cache
GROUP BY mint
HAVING COUNT(*) > ?
`
)
.all(Number(keepPerMint));

for (const row of mints) {
db.prepare(
`
DELETE FROM scan_cache
WHERE id IN (
SELECT id
FROM scan_cache
WHERE mint = ?
ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, id DESC
LIMIT -1 OFFSET ?
)
`
).run(row.mint, Number(keepPerMint));
}
}

export function getRiskTrend(mint) {
const rows = db
.prepare(
`
SELECT risk_score, whale_score, top10_pct, liq_usd, fdv_usd, created_at
FROM risk_history
WHERE mint = ?
ORDER BY datetime(created_at) DESC
LIMIT 300
`
)
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
