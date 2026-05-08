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

function clampMin(value, min = 0) {
return Math.max(min, toFloat(value, min));
}

function normalizeSnapshot(snapshot = {}) {
return {
token_id: cleanText(snapshot.token_id, 255),
mint_address: cleanText(snapshot.mint_address, 255),
linked_operator_cluster_id: cleanText(snapshot.linked_operator_cluster_id, 255),
operator_quality_score: clampMin(snapshot.operator_quality_score, 0),
insider_sell_score: clampMin(snapshot.insider_sell_score, 0),
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
return {
min_operator_quality_score: safe.min_operator_quality_score,
max_insider_sell_score: safe.max_insider_sell_score,
max_positions_per_operator_cluster: safe.max_positions_per_operator_cluster,
};
}

export function evaluateOperatorGateSync(
snapshot = {},
config = {},
context = {}
) {
const safeConfig = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
const safeSnapshot = normalizeSnapshot(snapshot || {});
const clusterOpenPositionCount = Math.max(
0,
Number.parseInt(context?.cluster_open_position_count ?? 0, 10) || 0
);

if (!safeConfig.enable_operator_filter) {
return {
passed: true,
reasons: [],
snapshot: safeSnapshot,
checks: [],
thresholds: getOperatorGateThresholds(safeConfig),
meta: {
operator_filter_enabled: false,
cluster_open_position_count: clusterOpenPositionCount,
},
};
}

const checks = [
buildCheck(
REASON_CODE.OPERATOR_QUALITY_TOO_LOW,
safeSnapshot.operator_quality_score,
safeConfig.min_operator_quality_score,
"<",
safeSnapshot.operator_quality_score < safeConfig.min_operator_quality_score
),
buildCheck(
REASON_CODE.INSIDER_SELL_RISK_TOO_HIGH,
safeSnapshot.insider_sell_score,
safeConfig.max_insider_sell_score,
">",
safeSnapshot.insider_sell_score > safeConfig.max_insider_sell_score
),
];

if (safeSnapshot.linked_operator_cluster_id) {
checks.push(
buildCheck(
REASON_CODE.OPERATOR_CLUSTER_LIMIT_REACHED,
clusterOpenPositionCount,
safeConfig.max_positions_per_operator_cluster,
">=",
clusterOpenPositionCount >= safeConfig.max_positions_per_operator_cluster
)
);
}

const reasons = collectRejectedReasons(checks);

return {
passed: reasons.length === 0,
reasons,
snapshot: safeSnapshot,
checks,
thresholds: getOperatorGateThresholds(safeConfig),
meta: {
operator_filter_enabled: true,
cluster_open_position_count: clusterOpenPositionCount,
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

let clusterOpenPositionCount = Math.max(
0,
Number.parseInt(context?.cluster_open_position_count ?? 0, 10) || 0
);

if (
safeConfig.enable_operator_filter &&
safeSnapshot.linked_operator_cluster_id &&
context?.cluster_open_position_count == null
) {
clusterOpenPositionCount = await countOpenPositionsForOperatorCluster(
safeSnapshot.linked_operator_cluster_id,
context?.execution_mode || safeConfig.execution_mode || null
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
};
}

return {
passed: Boolean(result.passed),
reasons: ensureReasonCodeArray(result.reasons || []),
rejected_check_count: Number(result?.meta?.rejected_check_count || 0),
total_check_count: Number(result?.meta?.total_check_count || 0),
cluster_open_position_count: Number(result?.meta?.cluster_open_position_count || 0),
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
