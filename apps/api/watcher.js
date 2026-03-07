import {
db,
getLatestRiskSnapshot,
getPreviousRiskSnapshot,
getRiskTrend,
pruneRiskHistory,
} from "./db.js";

const POLL_SECONDS = Number(process.env.WATCHER_POLL_SECONDS || 60);
const ALERT_COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS || 5 * 60 * 1000);
const HISTORY_PRUNE_EVERY_LOOPS = Number(process.env.HISTORY_PRUNE_EVERY_LOOPS || 120);

function nowIso() {
return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function toNum(v) {
const n = Number(v);
return Number.isFinite(n) ? n : null;
}

function fmtNum(v, dp = 2) {
const n = Number(v);
if (!Number.isFinite(n)) return "—";
return n.toFixed(dp);
}

function isCooldownActive(lastTriggeredAt) {
if (!lastTriggeredAt) return false;
const last = new Date(`${lastTriggeredAt}Z`).getTime();
if (!Number.isFinite(last)) return false;
return Date.now() - last < ALERT_COOLDOWN_MS;
}

async function notify({ alert, message }) {
db.prepare(`
INSERT INTO alert_events (alert_id, mint, message)
VALUES (?, ?, ?)
`).run(alert.id, alert.mint, message);

console.log(`🔔 ALERT [${alert.type}] mint=${alert.mint} user=${alert.user_id} :: ${message}`);
}

function buildAuthorityMessage(alert, latest) {
const trend = getRiskTrend(alert.mint);
const risk = latest?.risk_score;
const momentum = trend?.trend?.momentum || "Stable";
return `Authority risk trigger hit. Current risk=${fmtNum(risk, 0)}. Momentum=${momentum}.`;
}

function buildThresholdMessage(alert, value, latest) {
const trend = getRiskTrend(alert.mint);
const risk = latest?.risk_score;
const whale = latest?.whale_score;
const top10 = latest?.top10_pct;
const liq = latest?.liq_usd;

if (alert.type === "risk_spike") {
return `Risk ${alert.direction} ${alert.threshold} triggered. Current=${fmtNum(value, 0)}. 1h=${fmtNum(trend?.change?.["1h"], 1)} 24h=${fmtNum(trend?.change?.["24h"], 1)}.`;
}

if (alert.type === "whale") {
return `Whale score ${alert.direction} ${alert.threshold} triggered. Current=${fmtNum(value, 0)}. Risk=${fmtNum(risk, 0)} Top10=${fmtNum(top10, 2)}%.`;
}

if (alert.type === "liquidity") {
return `Liquidity ${alert.direction} ${alert.threshold} triggered. Current=$${fmtNum(value, 2)}. Risk=${fmtNum(risk, 0)} Whale=${fmtNum(whale, 0)}.`;
}

if (alert.type === "top10") {
return `Top10 concentration ${alert.direction} ${alert.threshold} triggered. Current=${fmtNum(value, 2)}%. Risk=${fmtNum(risk, 0)} Liquidity=$${fmtNum(liq, 2)}.`;
}

return `${alert.type} ${alert.direction} ${alert.threshold} triggered. Current=${fmtNum(value, 2)}.`;
}

function didRiskSpike(latest, previous, threshold) {
const curr = toNum(latest?.risk_score);
const prev = toNum(previous?.risk_score);
if (curr == null) return false;

const absThreshold = Number.isFinite(Number(threshold)) ? Number(threshold) : 0;
if (curr >= absThreshold) return true;

if (prev == null) return false;
return curr - prev >= Math.max(8, absThreshold);
}

function didAuthorityRiskHit(latest, previous) {
const currRisk = toNum(latest?.risk_score);
const prevRisk = toNum(previous?.risk_score);
const currWhale = toNum(latest?.whale_score);

if (currRisk != null && currRisk >= 70) return true;
if (currRisk != null && prevRisk != null && currRisk - prevRisk >= 15) return true;
if (currRisk != null && currWhale != null && currRisk >= 55 && currWhale >= 70) return true;

return false;
}

function getMetricValue(alertType, latest) {
if (alertType === "risk_spike") return toNum(latest?.risk_score);
if (alertType === "whale") return toNum(latest?.whale_score);
if (alertType === "liquidity") return toNum(latest?.liq_usd);
if (alertType === "top10") return toNum(latest?.top10_pct);
if (alertType === "authority") return null;
return null;
}

function isThresholdHit(direction, value, threshold) {
if (value == null) return false;
const t = Number(threshold);
if (!Number.isFinite(t)) return false;
return direction === "above" ? value >= t : value <= t;
}

let loopCount = 0;

export function startWatcher() {
setInterval(async () => {
try {
loopCount += 1;

const alerts = db
.prepare(`
SELECT *
FROM alerts
WHERE is_enabled = 1
ORDER BY id DESC
LIMIT 500
`)
.all();

for (const alert of alerts) {
if (isCooldownActive(alert.last_triggered_at)) continue;

const latest = getLatestRiskSnapshot(alert.mint);
if (!latest) continue;

const previous = getPreviousRiskSnapshot(alert.mint, latest.created_at);

let hit = false;
let value = null;
let message = "";

if (alert.type === "authority") {
hit = didAuthorityRiskHit(latest, previous);
if (hit) {
value = toNum(latest?.risk_score);
message = buildAuthorityMessage(alert, latest);
}
} else if (alert.type === "risk_spike") {
value = getMetricValue(alert.type, latest);
hit = didRiskSpike(latest, previous, alert.threshold) || isThresholdHit(alert.direction, value, alert.threshold);
if (hit) {
message = buildThresholdMessage(alert, value, latest);
}
} else {
value = getMetricValue(alert.type, latest);
hit = isThresholdHit(alert.direction, value, alert.threshold);
if (hit) {
message = buildThresholdMessage(alert, value, latest);
}
}

if (!hit) continue;

await notify({ alert, message });

db.prepare(`
UPDATE alerts
SET last_triggered_at = ?
WHERE id = ?
`).run(nowIso(), alert.id);
}

if (loopCount % HISTORY_PRUNE_EVERY_LOOPS === 0) {
try {
pruneRiskHistory();
} catch (e) {
console.warn("Risk history prune error:", e?.message || e);
}
}
} catch (e) {
console.warn("Watcher error:", e?.message || e);
}
}, POLL_SECONDS * 1000);

console.log(`🛰️ Alert watcher running (every ${POLL_SECONDS}s)`);
}
