import { db } from "./db.js";

const POLL_SECONDS = Number(process.env.WATCHER_POLL_SECONDS || 60);
const ALERT_COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS || 5 * 60 * 1000);

function nowIso() {
return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// Placeholder notification sink
// Upgrade later to telegram / email / webhook / push
async function notify({ alert, message, meta = null }) {
db.prepare(
`INSERT INTO alert_events (alert_id, mint, message) VALUES (?, ?, ?)`
).run(alert.id, alert.mint, message);

console.log(
`🔔 ALERT [${alert.type}] mint=${alert.mint} user=${alert.user_id} :: ${message}`,
meta || ""
);
}

function parseJsonSafe(v, fallback = null) {
if (!v) return fallback;
try {
return JSON.parse(v);
} catch {
return fallback;
}
}

function safeNum(v, fallback = 0) {
const n = Number(v);
return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
return Math.max(min, Math.min(max, n));
}

function toFixedNum(v, dp = 2) {
const n = Number(v);
if (!Number.isFinite(n)) return null;
return Number(n.toFixed(dp));
}

function cooldownActive(lastTriggeredAt) {
if (!lastTriggeredAt) return false;
const last = new Date(`${lastTriggeredAt}Z`).getTime();
if (!Number.isFinite(last)) return false;
return Date.now() - last < ALERT_COOLDOWN_MS;
}

function buildConcentration(holdersJson) {
const holders = Array.isArray(holdersJson?.holders) ? holdersJson.holders : [];
const pcts = holders.map((h) => safeNum(h?.pctSupply, 0));
const sumTopN = (n) => pcts.slice(0, n).reduce((a, b) => a + b, 0);

return {
top1: sumTopN(1),
top5: sumTopN(5),
top10: sumTopN(10),
top20: sumTopN(20),
};
}

function deriveWalletNetworkFromActivity(activity = {}) {
const clusters = Array.isArray(activity?.clusters) ? activity.clusters : [];
const hidden = activity?.hiddenControl || {};
const developerNetwork = activity?.developerNetwork || {};

const primaryCluster = clusters[0] || null;

const confidence = clamp(
Math.round(
Math.max(
safeNum(activity?.walletNetwork?.confidence, 0),
safeNum(developerNetwork?.confidence, 0),
safeNum(hidden?.score, 0),
safeNum(primaryCluster?.score, 0),
safeNum(activity?.score, 0)
)
),
0,
100
);

const controlEstimatePct = clamp(
Math.max(
safeNum(activity?.walletNetwork?.controlEstimatePct, 0),
safeNum(developerNetwork?.likelyControlPct, 0),
safeNum(hidden?.linkedWalletPct, 0)
),
0,
100
);

const linkedWallets = Math.max(
safeNum(activity?.walletNetwork?.linkedWallets, 0),
safeNum(developerNetwork?.linkedWallets, 0),
safeNum(hidden?.linkedWallets, 0),
safeNum(activity?.clusteredWallets, 0),
safeNum(primaryCluster?.size, 0)
);

const clusterCount = safeNum(activity?.clusterCount, clusters.length);

return {
confidence,
controlEstimatePct,
linkedWallets,
clusterCount,
};
}

async function getLatestRisk(mint) {
const r = db
.prepare(
`SELECT risk_score, whale_score, top10_pct, liq_usd, fdv_usd, created_at
FROM risk_history
WHERE mint = ?
ORDER BY datetime(created_at) DESC
LIMIT 1`
)
.get(mint);

return r || null;
}

async function getLatestScanSnapshot(mint) {
const row = db
.prepare(
`SELECT mint, token_json, market_json, holders_json, cluster_json, security_json, created_at
FROM scan_cache
WHERE mint = ?
ORDER BY datetime(created_at) DESC
LIMIT 1`
)
.get(mint);

if (!row) return null;

return {
mint: row.mint,
created_at: row.created_at,
token: parseJsonSafe(row.token_json, {}),
market: parseJsonSafe(row.market_json, {}),
holders: parseJsonSafe(row.holders_json, {}),
activity: parseJsonSafe(row.cluster_json, {}),
securityModel: parseJsonSafe(row.security_json, {}),
};
}

function buildLiveMetrics(snapshot, latestRiskRow) {
const token = snapshot?.token || {};
const market = snapshot?.market || {};
const holders = snapshot?.holders || {};
const activity = snapshot?.activity || {};
const securityModel = snapshot?.securityModel || {};
const concentration = buildConcentration(holders);

const walletNetwork =
securityModel?.walletNetwork && typeof securityModel.walletNetwork === "object"
? securityModel.walletNetwork
: deriveWalletNetworkFromActivity(activity);

const developerNetwork =
securityModel?.developerNetwork ||
activity?.developerNetwork || {
detected: false,
confidence: 0,
linkedWallets: 0,
likelyControlPct: 0,
};

const hiddenControl =
securityModel?.hiddenControl ||
activity?.hiddenControl || {
score: safeNum(activity?.score, 0),
linkedWallets: safeNum(activity?.clusteredWallets, 0),
linkedWalletPct: 0,
};

const latestRisk = safeNum(
latestRiskRow?.risk_score,
safeNum(securityModel?.score, 0)
);

const whaleScore = safeNum(
latestRiskRow?.whale_score,
safeNum(securityModel?.whaleScore, 0)
);

const liqUsd = safeNum(
latestRiskRow?.liq_usd,
safeNum(market?.liquidityUsd, 0)
);

const fdvUsd = safeNum(
latestRiskRow?.fdv_usd,
safeNum(market?.fdv, 0)
);

const top10Pct = safeNum(
latestRiskRow?.top10_pct,
concentration?.top10
);

const freshWalletRisk = securityModel?.freshWalletRisk || activity?.freshWalletRisk || {};
const whaleActivity = securityModel?.whaleActivity || activity?.whaleActivity || {};
const trendBlock = securityModel?.trend || {};

return {
risk: latestRisk,
whale: whaleScore,
liquidity: liqUsd,
fdv: fdvUsd,
top10: top10Pct,

authorityActive:
!token?.safety?.mintRevoked || !token?.safety?.freezeRevoked,

hiddenControlScore: safeNum(hiddenControl?.score, 0),
linkedWallets: safeNum(hiddenControl?.linkedWallets, 0),
linkedWalletPct: safeNum(hiddenControl?.linkedWalletPct, 0),

freshWalletPct: safeNum(freshWalletRisk?.pct, 0),
freshWalletCount: safeNum(freshWalletRisk?.walletCount, 0),

developerNetworkDetected: !!developerNetwork?.detected,
developerNetworkConfidence: safeNum(developerNetwork?.confidence, 0),
developerNetworkLinkedWallets: safeNum(developerNetwork?.linkedWallets, 0),
developerNetworkLikelyControlPct: safeNum(
developerNetwork?.likelyControlPct,
0
),

walletNetworkConfidence: safeNum(walletNetwork?.confidence, 0),
walletNetworkControlEstimatePct: safeNum(
walletNetwork?.controlEstimatePct,
0
),
walletNetworkLinkedWallets: safeNum(walletNetwork?.linkedWallets, 0),

clusterCount: safeNum(
activity?.clusterCount,
safeNum(walletNetwork?.clusterCount, 0)
),

whaleSyncBurstSize: safeNum(whaleActivity?.syncBurstSize, 0),

trendDelta24: safeNum(trendBlock?.delta24h, 0),
trendMomentum: String(trendBlock?.momentum || "Stable"),
};
}

function getMetricForAlert(alert, metrics) {
switch (alert.type) {
case "risk_spike":
return metrics.risk;
case "whale":
return metrics.whale;
case "liquidity":
return metrics.liquidity;
case "authority":
return metrics.authorityActive ? 1 : 0;
case "top10":
return metrics.top10;
case "hidden_control":
return metrics.hiddenControlScore;
case "fresh_wallets":
return metrics.freshWalletPct;
case "developer_network":
return metrics.developerNetworkConfidence;
case "wallet_network":
return metrics.walletNetworkConfidence;
case "network_control":
return metrics.walletNetworkControlEstimatePct;
case "cluster_growth":
return metrics.clusterCount;
case "linked_wallets":
return metrics.linkedWallets;
case "whale_sync":
return metrics.whaleSyncBurstSize;
case "trend_24h":
return metrics.trendDelta24;
default:
return null;
}
}

function evaluateAlertHit(alert, value) {
if (value == null) return false;
const threshold = Number(alert.threshold);
if (!Number.isFinite(threshold)) return false;

if (alert.direction === "above") return value >= threshold;
if (alert.direction === "below") return value <= threshold;
return false;
}

function buildAlertMessage(alert, metrics, value) {
switch (alert.type) {
case "risk_spike":
return `Risk score ${alert.direction} ${alert.threshold} triggered. Current=${toFixedNum(value, 0)}`;
case "whale":
return `Whale score ${alert.direction} ${alert.threshold} triggered. Current=${toFixedNum(value, 0)}`;
case "liquidity":
return `Liquidity ${alert.direction} ${alert.threshold} triggered. Current=${toFixedNum(value, 2)}`;
case "authority":
return metrics.authorityActive
? "Authority exposure detected. Mint and/or freeze authority is active."
: "Authority exposure cleared. Mint and freeze authority appear revoked.";
case "top10":
return `Top10 holder concentration ${alert.direction} ${alert.threshold} triggered. Current=${toFixedNum(value, 2)}%`;
case "hidden_control":
return `Hidden control score ${alert.direction} ${alert.threshold} triggered. Current=${toFixedNum(value, 0)}`;
case "fresh_wallets":
return `Fresh-wallet concentration ${alert.direction} ${alert.threshold} triggered. Current=${toFixedNum(value, 1)}%`;
case "developer_network":
return `Developer network confidence ${alert.direction} ${alert.threshold} triggered. Current=${toFixedNum(value, 0)}%`;
case "wallet_network":
return `Wallet network confidence ${alert.direction} ${alert.threshold} triggered. Current=${toFixedNum(value, 0)}%`;
case "network_control":
return `Wallet network control estimate ${alert.direction} ${alert.threshold} triggered. Current=${toFixedNum(value, 1)}%`;
case "cluster_growth":
return `Cluster count ${alert.direction} ${alert.threshold} triggered. Current=${toFixedNum(value, 0)}`;
case "linked_wallets":
return `Linked wallets ${alert.direction} ${alert.threshold} triggered. Current=${toFixedNum(value, 0)}`;
case "whale_sync":
return `Whale sync burst ${alert.direction} ${alert.threshold} triggered. Current=${toFixedNum(value, 0)}`;
case "trend_24h":
return `24h risk trend ${alert.direction} ${alert.threshold} triggered. Current=${toFixedNum(value, 1)}`;
default:
return `${alert.type} ${alert.direction} ${alert.threshold} triggered. Current=${toFixedNum(value, 2)}`;
}
}

export function startWatcher() {
setInterval(async () => {
try {
const alerts = db
.prepare(`SELECT * FROM alerts WHERE is_enabled = 1 ORDER BY id DESC LIMIT 500`)
.all();

for (const alert of alerts) {
if (cooldownActive(alert.last_triggered_at)) continue;

const latestRisk = await getLatestRisk(alert.mint);
const latestSnapshot = await getLatestScanSnapshot(alert.mint);

if (!latestRisk && !latestSnapshot) continue;

const metrics = buildLiveMetrics(latestSnapshot, latestRisk);
const value = getMetricForAlert(alert, metrics);

if (value == null) continue;

const hit = evaluateAlertHit(alert, value);
if (!hit) continue;

const message = buildAlertMessage(alert, metrics, value);

await notify({
alert,
message,
meta: {
mint: alert.mint,
value,
threshold: Number(alert.threshold),
direction: alert.direction,
type: alert.type,
metrics,
},
});

db.prepare(`UPDATE alerts SET last_triggered_at = ? WHERE id = ?`).run(
nowIso(),
alert.id
);
}
} catch (e) {
console.warn("Watcher error:", e?.message || e);
}
}, POLL_SECONDS * 1000);

console.log(`🛰️ Alert watcher running (every ${POLL_SECONDS}s)`);
}
