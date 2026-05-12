import { db as scannerDb } from "../../../db.js";
import { SENTINEL_MODE } from "./config.js";
import {
buildSentinelSnapshotFromSecurityScan,
normalizeSentinelSnapshot,
normalizeSentinelSnapshots,
isUsableSentinelSnapshot,
summarizeSentinelSnapshot,
} from "./snapshot-normalizer.js";

export const DEFAULT_SNAPSHOT_PROVIDER_LIMIT = 100;
export const DEFAULT_SNAPSHOT_PROVIDER_MAX_AGE_MINUTES = 30;

function cleanText(value, max = 255) {
return String(value ?? "").trim().slice(0, max);
}

function toFloat(value, fallback = null) {
const num = Number.parseFloat(value);
return Number.isFinite(num) ? num : fallback;
}

function toInt(value, fallback = null) {
const num = Number.parseInt(value, 10);
return Number.isFinite(num) ? num : fallback;
}

function safeJsonParse(value, fallback = null) {
if (value == null) return fallback;
if (typeof value === "object") return value;

const raw = String(value).trim();
if (!raw) return fallback;

try {
return JSON.parse(raw);
} catch {
return fallback;
}
}

function getPath(source, path) {
if (!source || typeof source !== "object") return undefined;
return String(path || "")
.split(".")
.filter(Boolean)
.reduce((acc, key) => (acc == null ? undefined : acc[key]), source);
}

function firstValue(source, paths = [], fallback = undefined) {
for (const path of paths) {
const value = getPath(source, path);
if (value != null && value !== "") return value;
}
return fallback;
}

function firstText(source, paths = [], fallback = "") {
const value = firstValue(source, paths, fallback);
return cleanText(value, 500);
}

function firstNumber(source, paths = [], fallback = null) {
const value = firstValue(source, paths, fallback);
return toFloat(value, fallback);
}

function resolveExecutionMode(...values) {
for (const value of values) {
const mode = cleanText(value, 64).toLowerCase();
if (mode) return mode;
}
return SENTINEL_MODE.PAPER;
}

function normalizeLimit(value, fallback = DEFAULT_SNAPSHOT_PROVIDER_LIMIT) {
return Math.max(1, Math.min(500, toInt(value, fallback) || fallback));
}

function normalizeMaxAgeMinutes(
value,
fallback = DEFAULT_SNAPSHOT_PROVIDER_MAX_AGE_MINUTES
) {
return Math.max(1, toInt(value, fallback) || fallback);
}

function rowTimestampMs(row = {}) {
const candidates = [
row.updated_at,
row.created_at,
row.scanned_at,
row.last_seen_at,
row.detected_at,
row.ts,
];

for (const value of candidates) {
if (value == null) continue;
const parsed = new Date(value).getTime();
if (!Number.isNaN(parsed)) return parsed;
}

return 0;
}

function isRowFreshEnough(
row = {},
maxAgeMinutes = DEFAULT_SNAPSHOT_PROVIDER_MAX_AGE_MINUTES
) {
const safeMaxAgeMinutes = normalizeMaxAgeMinutes(maxAgeMinutes);
const ts = rowTimestampMs(row);
if (!ts) return true;

const ageMs = Date.now() - ts;
return ageMs <= safeMaxAgeMinutes * 60 * 1000;
}

function sortRowsNewestFirst(rows = []) {
return [...(Array.isArray(rows) ? rows : [])].sort(
(a, b) => rowTimestampMs(b) - rowTimestampMs(a)
);
}

function extractJsonPayload(row = {}, keys = []) {
for (const key of keys) {
if (!(key in row)) continue;
const parsed = safeJsonParse(row[key], null);
if (parsed && typeof parsed === "object") return parsed;
}
return null;
}

function extractMintFromRow(row = {}) {
return (
firstText(row, [
"mint",
"token_id",
"mint_address",
"address",
"tokenMint",
"base_mint",
]) || null
);
}

function extractScanObjectFromRow(row = {}) {
const mint = extractMintFromRow(row);

const rawScan =
extractJsonPayload(row, [
"scan_json",
"scan_result_json",
"snapshot_json",
"payload_json",
"security_scan_json",
"result_json",
]) || null;

if (
rawScan &&
typeof rawScan === "object" &&
(rawScan.mint || rawScan.token || rawScan.market)
) {
return {
...rawScan,
mint: cleanText(rawScan.mint || mint, 255) || mint,
execution_mode: resolveExecutionMode(
rawScan.execution_mode,
row.execution_mode,
row.mode
),
};
}

const token =
extractJsonPayload(row, [
"token_json",
"token",
"token_payload_json",
"token_data_json",
]) || {};

const market =
extractJsonPayload(row, [
"market_json",
"market",
"market_payload_json",
"market_data_json",
]) || {};

const holders =
extractJsonPayload(row, [
"holders_json",
"holders",
"holders_payload_json",
]) || {};

const concentration =
extractJsonPayload(row, ["concentration_json", "concentration"]) || {};

const activity =
extractJsonPayload(row, [
"activity_json",
"activity",
"cluster_json",
"clusters_json",
]) || {};

const securityModel =
extractJsonPayload(row, [
"security_model_json",
"security_json",
"securityModel",
"security_model",
]) || {};

const cassie =
extractJsonPayload(row, ["cassie_json", "cassie", "cassie_payload_json"]) || {};

const trend =
extractJsonPayload(row, ["trend_json", "trend"]) || {};

return {
mint,
token: {
mint,
mintAuthority: firstValue(row, ["mint_authority", "mintAuthority"], null),
freezeAuthority: firstValue(
row,
["freeze_authority", "freezeAuthority"],
null
),
...token,
},
market: {
mcapUsd:
firstNumber(row, ["marketcap_usd", "mcap_usd", "market_cap_usd"], null) ??
firstNumber(market, ["mcapUsd", "marketCapUsd"], null),
liquidityUsd:
firstNumber(row, ["liquidity_usd", "liq_usd"], null) ??
firstNumber(market, ["liquidityUsd"], null),
priceUsd:
firstNumber(row, ["price_usd", "current_price_usd"], null) ??
firstNumber(market, ["priceUsd"], null),
fdv:
firstNumber(row, ["fdv", "fdv_usd"], null) ??
firstNumber(market, ["fdv"], null),
spreadBps:
firstNumber(row, ["spread_bps", "spread_bps_value"], null) ??
firstNumber(market, ["spreadBps", "spread_bps"], null),
priceImpactBps:
firstNumber(row, ["price_impact_bps"], null) ??
firstNumber(market, ["priceImpactBps", "price_impact_bps"], null),
...market,
},
holders,
concentration: {
top1:
firstNumber(row, ["top_holder_pct", "top1_pct", "top1"], null) ??
firstNumber(concentration, ["top1"], null),
top5:
firstNumber(row, ["top_5_holder_pct", "top5_pct", "top5"], null) ??
firstNumber(concentration, ["top5"], null),
top10:
firstNumber(row, ["top10_pct", "top_10_holder_pct", "top10"], null) ??
firstNumber(concentration, ["top10"], null),
...concentration,
},
activity: {
score:
firstNumber(row, ["cluster_score", "activity_score"], null) ??
firstNumber(activity, ["score"], null),
clusterCount:
firstNumber(row, ["cluster_count"], null) ??
firstNumber(activity, ["clusterCount"], null),
clusteredWallets:
firstNumber(row, ["clustered_wallets"], null) ??
firstNumber(activity, ["clusteredWallets"], null),
maxClusterSize:
firstNumber(row, ["max_cluster_size"], null) ??
firstNumber(activity, ["maxClusterSize"], null),
newWalletPct:
firstNumber(row, ["fresh_wallet_pct", "new_wallet_pct"], null) ??
firstNumber(activity, ["newWalletPct"], null),
...activity,
},
securityModel: {
score:
firstNumber(row, ["risk_score", "security_score"], null) ??
firstNumber(securityModel, ["score"], null),
...securityModel,
},
cassie,
trend,
execution_mode: resolveExecutionMode(row.execution_mode, row.mode),
linked_operator_cluster_id:
firstText(row, ["linked_operator_cluster_id", "operator_cluster_id"], "") ||
null,
seller_exhaustion_score: firstNumber(row, ["seller_exhaustion_score"], null),
reclaim_strength_score: firstNumber(row, ["reclaim_strength_score"], null),
buy_pressure_score: firstNumber(row, ["buy_pressure_score"], null),
persistence_score: firstNumber(row, ["persistence_score"], null),
structural_health_score: firstNumber(row, ["structural_health_score"], null),
regime_score: firstNumber(row, ["regime_score"], null),
regime_state: firstText(row, ["regime_state"], "") || null,
recent_rug_rate_pct: firstNumber(row, ["recent_rug_rate_pct"], null),
reclaim_success_rate_pct: firstNumber(
row,
["reclaim_success_rate_pct"],
null
),
recent_runner_count: firstNumber(row, ["recent_runner_count"], null),
breakout_follow_through_score: firstNumber(
row,
["breakout_follow_through_score"],
null
),
vertical_extension_score: firstNumber(row, ["vertical_extension_score"], null),
operator_quality_score: firstNumber(row, ["operator_quality_score"], null),
hidden_control_risk: firstNumber(row, ["hidden_control_risk"], null),
contamination_risk: firstNumber(row, ["contamination_risk"], null),
wallet_coordination_risk: firstNumber(
row,
["wallet_coordination_risk"],
null
),
insider_sell_score:
firstNumber(row, ["insider_sell_score", "dev_sell_score"], null) ?? 0,
liquidity_decay_score: firstNumber(row, ["liquidity_decay_score"], null),
transfer_restriction_risk: firstNumber(
row,
["transfer_restriction_risk"],
null
),
honeypot_risk: firstNumber(row, ["honeypot_risk"], null),
liquidity_break_risk: firstNumber(row, ["liquidity_break_risk"], null),
spoofed_volume_risk: firstNumber(row, ["spoofed_volume_risk"], null),
bars_since_launch: firstNumber(row, ["bars_since_launch"], null),
bars_since_local_low: firstNumber(row, ["bars_since_local_low"], null),
failed_breakout_count: firstNumber(row, ["failed_breakout_count"], null),
current_multiple: firstNumber(row, ["current_multiple"], null),
current_value_usd: firstNumber(row, ["current_value_usd"], null),
};
}

function buildSnapshotFromRow(row = {}, options = {}) {
const directSnapshot =
extractJsonPayload(row, ["sentinel_snapshot_json", "sentinel_json"]) || null;

const execution_mode = resolveExecutionMode(
options.execution_mode,
row.execution_mode,
row.mode
);

if (directSnapshot && typeof directSnapshot === "object") {
return normalizeSentinelSnapshot(
{
...directSnapshot,
source: cleanText(directSnapshot.source, 120) || "sentinel_cache",
execution_mode,
},
options
);
}

const scan = extractScanObjectFromRow(row);
return buildSentinelSnapshotFromSecurityScan(scan, {
source: "scanner_cache",
execution_mode,
min_liquidity_usd: options.min_liquidity_usd,
});
}

function dedupeSnapshotsByToken(snapshots = []) {
const map = new Map();

for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
const tokenId = cleanText(snapshot?.token_id || snapshot?.mint_address, 255);
if (!tokenId) continue;
if (!map.has(tokenId)) {
map.set(tokenId, snapshot);
}
}

return Array.from(map.values());
}

function filterSnapshots(snapshots = [], options = {}) {
const minLiquidityUsd = Math.max(0, toFloat(options.min_liquidity_usd, 0) || 0);
const requireUsable = options.require_usable !== false;

return (Array.isArray(snapshots) ? snapshots : []).filter((snapshot) => {
if (requireUsable && !isUsableSentinelSnapshot(snapshot)) return false;
if (minLiquidityUsd > 0 && Number(snapshot?.liquidity_usd || 0) < minLiquidityUsd) {
return false;
}
return true;
});
}

function resolveContextArray(context = {}, keys = []) {
for (const key of keys) {
const value = context?.[key];
if (Array.isArray(value)) return value;
}
return null;
}

export function summarizeSnapshotBatch(snapshots = []) {
const safeSnapshots = Array.isArray(snapshots) ? snapshots : [];

return {
total: safeSnapshots.length,
token_ids: safeSnapshots.map((item) => item.token_id).filter(Boolean),
summaries: safeSnapshots.slice(0, 20).map((item) => summarizeSentinelSnapshot(item)),
};
}

export function buildSnapshotsFromRows(rows = [], options = {}) {
const normalized = [];
const sortedRows = sortRowsNewestFirst(rows);

for (const row of sortedRows) {
try {
if (!isRowFreshEnough(row, options.max_age_minutes)) continue;
const snapshot = buildSnapshotFromRow(row, options);
if (snapshot) normalized.push(snapshot);
} catch {
// skip malformed rows safely
}
}

return dedupeSnapshotsByToken(
filterSnapshots(normalizeSentinelSnapshots(normalized, options), options)
);
}

export function buildSnapshotsFromScans(scans = [], options = {}) {
const snapshots = (Array.isArray(scans) ? scans : []).map((scan) =>
buildSentinelSnapshotFromSecurityScan(scan, {
source: cleanText(options.source, 120) || "scan_list",
execution_mode:
cleanText(options.execution_mode, 64) || SENTINEL_MODE.PAPER,
min_liquidity_usd: options.min_liquidity_usd,
})
);

return dedupeSnapshotsByToken(
filterSnapshots(normalizeSentinelSnapshots(snapshots, options), options)
);
}

export function readRecentScanCacheRows({
limit = DEFAULT_SNAPSHOT_PROVIDER_LIMIT,
} = {}) {
const safeLimit = normalizeLimit(limit);

const candidateQueries = [
`SELECT * FROM scan_cache ORDER BY updated_at DESC LIMIT ?`,
`SELECT * FROM scan_cache ORDER BY created_at DESC LIMIT ?`,
`SELECT * FROM scan_cache ORDER BY id DESC LIMIT ?`,
];

let lastError = null;

for (const sql of candidateQueries) {
try {
return scannerDb.prepare(sql).all(safeLimit);
} catch (error) {
lastError = error;
}
}

if (lastError) throw lastError;
return [];
}

export async function loadScannerCacheSnapshots({
limit = DEFAULT_SNAPSHOT_PROVIDER_LIMIT,
max_age_minutes = DEFAULT_SNAPSHOT_PROVIDER_MAX_AGE_MINUTES,
min_liquidity_usd = 0,
execution_mode = SENTINEL_MODE.PAPER,
} = {}) {
const rows = readRecentScanCacheRows({ limit });

return buildSnapshotsFromRows(rows, {
max_age_minutes,
min_liquidity_usd,
execution_mode,
});
}

export function createScannerCacheSnapshotProvider(providerOptions = {}) {
const baseOptions = {
limit: DEFAULT_SNAPSHOT_PROVIDER_LIMIT,
max_age_minutes: DEFAULT_SNAPSHOT_PROVIDER_MAX_AGE_MINUTES,
min_liquidity_usd: 0,
require_usable: true,
execution_mode: SENTINEL_MODE.PAPER,
...providerOptions,
};

return async function scannerCacheSnapshotProvider(runtime = {}) {
const config = runtime?.config || {};
const context = runtime?.context || {};

const execution_mode = resolveExecutionMode(
config.execution_mode,
baseOptions.execution_mode,
SENTINEL_MODE.PAPER
);

const min_liquidity_usd =
toFloat(context.min_liquidity_usd, null) ??
toFloat(context.snapshot_min_liquidity_usd, null) ??
toFloat(baseOptions.min_liquidity_usd, null) ??
toFloat(config.min_liquidity_usd, null) ??
0;

const max_age_minutes =
toInt(context.max_age_minutes, null) ??
toInt(context.snapshot_max_age_minutes, null) ??
toInt(baseOptions.max_age_minutes, null) ??
DEFAULT_SNAPSHOT_PROVIDER_MAX_AGE_MINUTES;

const limit =
toInt(context.limit, null) ??
toInt(context.snapshot_limit, null) ??
toInt(baseOptions.limit, null) ??
DEFAULT_SNAPSHOT_PROVIDER_LIMIT;

const require_usable =
context.require_usable == null
? baseOptions.require_usable !== false
: Boolean(context.require_usable);

const directSnapshots = resolveContextArray(context, [
"snapshots",
"sentinel_snapshots",
]);

if (directSnapshots) {
const snapshots = dedupeSnapshotsByToken(
filterSnapshots(
normalizeSentinelSnapshots(directSnapshots, {
execution_mode,
}),
{
min_liquidity_usd,
require_usable,
}
)
);

return {
snapshots,
meta: {
source: "context.snapshots",
summary: summarizeSnapshotBatch(snapshots),
},
};
}

const directScans = resolveContextArray(context, ["scans", "security_scans"]);
if (directScans) {
const snapshots = buildSnapshotsFromScans(directScans, {
source: "context.scans",
execution_mode,
min_liquidity_usd,
require_usable,
});

return {
snapshots,
meta: {
source: "context.scans",
summary: summarizeSnapshotBatch(snapshots),
},
};
}

const directRows = resolveContextArray(context, [
"scan_cache_rows",
"rows",
"scan_rows",
]);

if (directRows) {
const snapshots = buildSnapshotsFromRows(directRows, {
max_age_minutes,
min_liquidity_usd,
execution_mode,
require_usable,
});

return {
snapshots,
meta: {
source: "context.scan_cache_rows",
summary: summarizeSnapshotBatch(snapshots),
},
};
}

const snapshots = await loadScannerCacheSnapshots({
limit,
max_age_minutes,
min_liquidity_usd,
execution_mode,
});

return {
snapshots,
meta: {
source: "scanner_cache",
summary: summarizeSnapshotBatch(snapshots),
},
};
};
}

export const scannerCacheSnapshotProvider = createScannerCacheSnapshotProvider();

export default {
DEFAULT_SNAPSHOT_PROVIDER_LIMIT,
DEFAULT_SNAPSHOT_PROVIDER_MAX_AGE_MINUTES,
summarizeSnapshotBatch,
buildSnapshotsFromRows,
buildSnapshotsFromScans,
readRecentScanCacheRows,
loadScannerCacheSnapshots,
createScannerCacheSnapshotProvider,
scannerCacheSnapshotProvider,
};
