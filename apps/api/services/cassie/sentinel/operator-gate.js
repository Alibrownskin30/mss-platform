import { getEffectiveSentinelConfig, normalizeSentinelConfig } from "./config.js";
import { REASON_CODE, ensureReasonCodeArray } from "./reason-codes.js";
import { countOpenPositionsForOperatorCluster } from "./position-store.js";

const OPERATOR_GATE_REASON_SET = new Set([
REASON_CODE.OPERATOR_QUALITY_TOO_LOW,
REASON_CODE.INSIDER_SELL_RISK_TOO_HIGH,
REASON_CODE.OPERATOR_CLUSTER_LIMIT_REACHED,
]);

function cleanText(value, max = 255) {
return String(value ?? "").trim().slice(0, max);
}

function toFloat(value, fallback = 0) {
const num = Number.parseFloat(value);
return Number.isFinite(num) ? num : fallback;
}

function toInt(value, fallback = 0) {
const num = Number.parseInt(value, 10);
return Number.isFinite(num) ? num : fallback;
}

function clampMin(value, min = 0) {
return Math.max(min, toFloat(value, min));
}

function firstNonEmpty(...values) {
for (const value of values) {
const cleaned = cleanText(value, 255);
if (cleaned) return cleaned;
}
return "";
}

function firstFiniteNumber(...values) {
for (const value of values) {
const num = Number.parseFloat(value);
if (Number.isFinite(num)) return num;
}
return null;
}

function isPaperMode(config = {}) {
return cleanText(config.execution_mode, 64).toLowerCase() === "paper";
}

function normalizeSnapshot(snapshot = {}) {
const operatorQualityScore = firstFiniteNumber(
snapshot.operator_quality_score,
snapshot.operatorQualityScore,
snapshot.operator_score,
snapshot.operatorScore,
snapshot.operator_quality,
snapshot.operatorQuality
);

const insiderSellScore = firstFiniteNumber(
snapshot.insider_sell_score,
snapshot.insiderSellScore,
snapshot.insider_sell_risk,
snapshot.insiderSellRisk,
snapshot.insider_risk_score,
snapshot.insiderRiskScore
);

return {
token_id: firstNonEmpty(snapshot.token_id, snapshot.tokenId, snapshot.mint_address, snapshot.mintAddress),
mint_address: firstNonEmpty(snapshot.mint_address, snapshot.mintAddress, snapshot.token_id, snapshot.tokenId),
linked_operator_cluster_id: firstNonEmpty(
snapshot.linked_operator_cluster_id,
snapshot.linkedOperatorClusterId,
snapshot.operator_cluster_id,
snapshot.operatorClusterId,
snapshot.cluster_id,
snapshot.clusterId
),
operator_quality_score: clampMin(operatorQualityScore, 0),
insider_sell_score: clampMin(insiderSellScore, 0),
};
}

function buildCheck(code, actual, threshold, comparator, rejected) {
return {
code,
actual,
threshold,
comparator,
rejected: Boolean(rejected),
};
}

function collectRejectedReasons(checks = []) {
return checks.filter((check) => check.rejected).map((check) => check.code);
}

export function getOperatorGateReasonCodes() {
return Array.from(OPERATOR_GATE_REASON_SET);
}

export function isOperatorGateReason(code) {
return OPERATOR_GATE_REASON_SET.has(cleanText(code, 128));
}

export function filterOperatorGateReasons(reasonCodes = []) {
return ensureReasonCodeArray(reasonCodes).filter((code) => isOperatorGateReason(code));
}

export function getOperatorGateThresholds(config = {}) {
const safe = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
const paperMode = isPaperMode(safe);

return {
execution_mode: safe.execution_mode,
paper_mode_relaxed: paperMode,
min_operator_quality_score: paperMode
? Math.min(safe.min_operator_quality_score, 55)
: safe.min_operator_quality_score,
max_insider_sell_score: paperMode
? Math.max(safe.max_insider_sell_score, 65)
: safe.max_insider_sell_score,
max_positions_per_operator_cluster: paperMode
? Math.max(safe.max_positions_per_operator_cluster, 4)
: safe.max_positions_per_operator_cluster,
};
}

export function evaluateOperatorGateSync(
snapshot = {},
config = {},
context = {}
) {
const safeConfig = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
const safeSnapshot = normalizeSnapshot(snapshot || {});
const thresholds = getOperatorGateThresholds(safeConfig);

const clusterOpenPositionCount = Math.max(
0,
toInt(context?.cluster_open_position_count, 0)
);

if (!safeConfig.enable_operator_filter) {
return {
passed: true,
reasons: [],
snapshot: safeSnapshot,
checks: [],
thresholds,
meta: {
operator_filter_enabled: false,
execution_mode: safeConfig.execution_mode,
paper_mode_relaxed: Boolean(thresholds.paper_mode_relaxed),
cluster_open_position_count: clusterOpenPositionCount,
},
};
}

const checks = [
buildCheck(
REASON_CODE.OPERATOR_QUALITY_TOO_LOW,
safeSnapshot.operator_quality_score,
thresholds.min_operator_quality_score,
"<",
safeSnapshot.operator_quality_score < thresholds.min_operator_quality_score
),
buildCheck(
REASON_CODE.INSIDER_SELL_RISK_TOO_HIGH,
safeSnapshot.insider_sell_score,
thresholds.max_insider_sell_score,
">",
safeSnapshot.insider_sell_score > thresholds.max_insider_sell_score
),
];

if (safeSnapshot.linked_operator_cluster_id) {
checks.push(
buildCheck(
REASON_CODE.OPERATOR_CLUSTER_LIMIT_REACHED,
clusterOpenPositionCount,
thresholds.max_positions_per_operator_cluster,
">=",
clusterOpenPositionCount >= thresholds.max_positions_per_operator_cluster
)
);
}

const reasons = collectRejectedReasons(checks);

return {
passed: reasons.length === 0,
reasons,
snapshot: safeSnapshot,
checks,
thresholds,
meta: {
operator_filter_enabled: true,
execution_mode: safeConfig.execution_mode,
paper_mode_relaxed: Boolean(thresholds.paper_mode_relaxed),
cluster_open_position_count: clusterOpenPositionCount,
linked_operator_cluster_id: safeSnapshot.linked_operator_cluster_id || null,
total_check_count: checks.length,
rejected_check_count: reasons.length,
},
};
}

export async function evaluateOperatorGate(
snapshot = {},
config = {},
context = {}
) {
const safeConfig = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
const safeSnapshot = normalizeSnapshot(snapshot || {});
const thresholds = getOperatorGateThresholds(safeConfig);

let clusterOpenPositionCount = Math.max(
0,
toInt(context?.cluster_open_position_count, 0)
);

if (
safeConfig.enable_operator_filter &&
safeSnapshot.linked_operator_cluster_id &&
context?.cluster_open_position_count == null
) {
clusterOpenPositionCount = await countOpenPositionsForOperatorCluster(
safeSnapshot.linked_operator_cluster_id,
context?.execution_mode || thresholds.execution_mode || null
);
}

return evaluateOperatorGateSync(safeSnapshot, safeConfig, {
cluster_open_position_count: clusterOpenPositionCount,
});
}

export async function passesOperatorGate(
snapshot = {},
config = {},
context = {}
) {
const result = await evaluateOperatorGate(snapshot, config, context);
return Boolean(result.passed);
}

export function summarizeOperatorGate(result = null) {
if (!result) {
return {
passed: true,
reasons: [],
rejected_check_count: 0,
total_check_count: 0,
cluster_open_position_count: 0,
execution_mode: null,
paper_mode_relaxed: false,
linked_operator_cluster_id: null,
};
}

return {
passed: Boolean(result.passed),
reasons: ensureReasonCodeArray(result.reasons || []),
rejected_check_count: toInt(result?.meta?.rejected_check_count, 0),
total_check_count: toInt(result?.meta?.total_check_count, 0),
cluster_open_position_count: toInt(result?.meta?.cluster_open_position_count, 0),
execution_mode: cleanText(result?.meta?.execution_mode, 64) || null,
paper_mode_relaxed: Boolean(result?.meta?.paper_mode_relaxed),
linked_operator_cluster_id:
cleanText(result?.meta?.linked_operator_cluster_id, 255) || null,
};
}

export default {
getOperatorGateReasonCodes,
isOperatorGateReason,
filterOperatorGateReasons,
getOperatorGateThresholds,
evaluateOperatorGateSync,
evaluateOperatorGate,
passesOperatorGate,
summarizeOperatorGate,
};
