import { getEffectiveSentinelConfig, normalizeSentinelConfig } from "./config.js";
import { REASON_CODE, ensureReasonCodeArray } from "./reason-codes.js";
import { countOpenPositionsForOperatorCluster } from "./position-store.js";

const OPERATOR_GATE_REASON_SET = new Set([
REASON_CODE.OPERATOR_QUALITY_TOO_LOW,
REASON_CODE.INSIDER_SELL_RISK_TOO_HIGH,
REASON_CODE.OPERATOR_CLUSTER_LIMIT_REACHED,
]);

const PLACEHOLDER_CLUSTER_IDS = new Set([
"",
"-",
"—",
"--",
"unknown",
"n/a",
"na",
"none",
"null",
"undefined",
"unclustered",
"unassigned",
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

function clampScore(value, fallback = 0) {
return Math.min(100, Math.max(0, toFloat(value, fallback)));
}

function firstDefined(...values) {
for (const value of values) {
if (value !== undefined && value !== null && value !== "") {
return value;
}
}
return undefined;
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

function resolveExecutionMode(...values) {
for (const value of values) {
const mode = cleanText(value, 64).toLowerCase();
if (mode) return mode;
}
return null;
}

function isPaperMode(executionMode) {
return cleanText(executionMode, 64).toLowerCase() === "paper";
}

function normalizeNullableScore(value) {
const num = firstFiniteNumber(value);
if (num == null) return null;
return clampScore(num, 0);
}

function normalizeClusterId(value) {
const cleaned = cleanText(value, 255);
if (!cleaned) return "";
if (PLACEHOLDER_CLUSTER_IDS.has(cleaned.toLowerCase())) return "";
return cleaned;
}

function normalizeSnapshot(snapshot = {}) {
const tokenId = firstNonEmpty(
snapshot.token_id,
snapshot.tokenId,
snapshot.mint_address,
snapshot.mintAddress,
snapshot.mint
);

const mintAddress = firstNonEmpty(
snapshot.mint_address,
snapshot.mintAddress,
snapshot.mint,
snapshot.token_id,
snapshot.tokenId
);

const executionMode =
resolveExecutionMode(
snapshot.execution_mode,
snapshot.executionMode,
snapshot.mode
) || null;

const linkedOperatorClusterId = normalizeClusterId(
firstDefined(
snapshot.linked_operator_cluster_id,
snapshot.linkedOperatorClusterId,
snapshot.operator_cluster_id,
snapshot.operatorClusterId,
snapshot.cluster_id,
snapshot.clusterId,
snapshot.primary_cluster_id,
snapshot.primaryClusterId,
snapshot.activity?.primaryClusterId,
snapshot.walletNetwork?.primaryClusterId,
snapshot.wallet_network?.primary_cluster_id,
snapshot.securityModel?.walletNetwork?.primaryClusterId
)
);

const operatorQualityScore = firstFiniteNumber(
snapshot.operator_quality_score,
snapshot.operatorQualityScore,
snapshot.operator_score,
snapshot.operatorScore,
snapshot.operator_quality,
snapshot.operatorQuality,
snapshot.deployer_quality_score,
snapshot.deployerQualityScore,
snapshot.builder_quality_score,
snapshot.builderQualityScore,
snapshot.securityModel?.reputation?.score,
snapshot.reputation?.score
);

const insiderSellScore = firstFiniteNumber(
snapshot.insider_sell_score,
snapshot.insiderSellScore,
snapshot.insider_sell_risk,
snapshot.insiderSellRisk,
snapshot.insider_sell_risk_score,
snapshot.insiderSellRiskScore,
snapshot.insider_risk_score,
snapshot.insiderRiskScore,
snapshot.securityModel?.developerActivity?.score
);

return {
...snapshot,
token_id: tokenId || mintAddress || "",
mint_address: mintAddress || tokenId || "",
execution_mode: executionMode,
linked_operator_cluster_id: linkedOperatorClusterId,
operator_quality_score: normalizeNullableScore(operatorQualityScore),
insider_sell_score: normalizeNullableScore(insiderSellScore),
};
}

function buildCheck(code, actual, threshold, comparator, rejected, missing = false) {
return {
code,
actual,
threshold,
comparator,
rejected: Boolean(rejected),
missing: Boolean(missing),
};
}

function collectRejectedReasons(checks = []) {
return checks.filter((check) => check.rejected).map((check) => check.code);
}

function collectMissingMetrics(checks = []) {
return checks.filter((check) => check.missing).map((check) => check.code);
}

export function getOperatorGateReasonCodes() {
return Array.from(OPERATOR_GATE_REASON_SET);
}

export function isOperatorGateReason(code) {
return OPERATOR_GATE_REASON_SET.has(cleanText(code, 128));
}

export function filterOperatorGateReasons(reasonCodes = []) {
return ensureReasonCodeArray(reasonCodes).filter((code) =>
isOperatorGateReason(code)
);
}

export function getOperatorGateThresholds(config = {}, runtime = {}) {
const runtimeExecutionMode = resolveExecutionMode(
runtime?.execution_mode,
config?.execution_mode
);

const safe = getEffectiveSentinelConfig(
normalizeSentinelConfig({
...(config || {}),
...(runtimeExecutionMode ? { execution_mode: runtimeExecutionMode } : {}),
})
);

const executionMode = runtimeExecutionMode || safe.execution_mode;
const paperMode = isPaperMode(executionMode);

return {
execution_mode: executionMode,
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
const safeSnapshot = normalizeSnapshot(snapshot || {});
const executionMode =
resolveExecutionMode(
context?.execution_mode,
safeSnapshot.execution_mode,
config?.execution_mode
) || "paper";

const safeConfig = getEffectiveSentinelConfig(
normalizeSentinelConfig({
...(config || {}),
execution_mode: executionMode,
})
);

const thresholds = getOperatorGateThresholds(safeConfig, {
execution_mode: executionMode,
});

const clusterOpenPositionCount = Math.max(
0,
toInt(context?.cluster_open_position_count, 0)
);

if (!safeConfig.enable_operator_filter) {
return {
passed: true,
reasons: [],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
checks: [],
thresholds,
meta: {
operator_filter_enabled: false,
execution_mode: thresholds.execution_mode,
paper_mode_relaxed: Boolean(thresholds.paper_mode_relaxed),
cluster_open_position_count: clusterOpenPositionCount,
linked_operator_cluster_id: safeSnapshot.linked_operator_cluster_id || null,
total_check_count: 0,
rejected_check_count: 0,
missing_metrics: [],
},
};
}

const checks = [
buildCheck(
REASON_CODE.OPERATOR_QUALITY_TOO_LOW,
safeSnapshot.operator_quality_score,
thresholds.min_operator_quality_score,
"<",
safeSnapshot.operator_quality_score != null &&
safeSnapshot.operator_quality_score < thresholds.min_operator_quality_score,
safeSnapshot.operator_quality_score == null
),
buildCheck(
REASON_CODE.INSIDER_SELL_RISK_TOO_HIGH,
safeSnapshot.insider_sell_score,
thresholds.max_insider_sell_score,
">",
safeSnapshot.insider_sell_score != null &&
safeSnapshot.insider_sell_score > thresholds.max_insider_sell_score,
safeSnapshot.insider_sell_score == null
),
];

if (safeSnapshot.linked_operator_cluster_id) {
checks.push(
buildCheck(
REASON_CODE.OPERATOR_CLUSTER_LIMIT_REACHED,
clusterOpenPositionCount,
thresholds.max_positions_per_operator_cluster,
">=",
clusterOpenPositionCount >= thresholds.max_positions_per_operator_cluster,
false
)
);
}

const reasons = collectRejectedReasons(checks);
const missingMetrics = collectMissingMetrics(checks);

return {
passed: reasons.length === 0,
reasons,
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
checks,
thresholds,
meta: {
operator_filter_enabled: true,
execution_mode: thresholds.execution_mode,
paper_mode_relaxed: Boolean(thresholds.paper_mode_relaxed),
cluster_open_position_count: clusterOpenPositionCount,
linked_operator_cluster_id: safeSnapshot.linked_operator_cluster_id || null,
total_check_count: checks.length,
rejected_check_count: reasons.length,
missing_metrics: missingMetrics,
},
};
}

export async function evaluateOperatorGate(
snapshot = {},
config = {},
context = {}
) {
const safeSnapshot = normalizeSnapshot(snapshot || {});
const executionMode =
resolveExecutionMode(
context?.execution_mode,
safeSnapshot.execution_mode,
config?.execution_mode
) || "paper";

const safeConfig = getEffectiveSentinelConfig(
normalizeSentinelConfig({
...(config || {}),
execution_mode: executionMode,
})
);

const thresholds = getOperatorGateThresholds(safeConfig, {
execution_mode: executionMode,
});

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
executionMode || thresholds.execution_mode || null
);
}

return evaluateOperatorGateSync(safeSnapshot, safeConfig, {
execution_mode: executionMode || thresholds.execution_mode || null,
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
missing_metrics: [],
};
}

return {
passed: Boolean(result.passed),
reasons: ensureReasonCodeArray(result.reasons || []),
rejected_check_count: toInt(result?.meta?.rejected_check_count, 0),
total_check_count: toInt(result?.meta?.total_check_count, 0),
cluster_open_position_count: toInt(
result?.meta?.cluster_open_position_count,
0
),
execution_mode: cleanText(result?.meta?.execution_mode, 64) || null,
paper_mode_relaxed: Boolean(result?.meta?.paper_mode_relaxed),
linked_operator_cluster_id:
cleanText(result?.meta?.linked_operator_cluster_id, 255) || null,
missing_metrics: ensureReasonCodeArray(result?.meta?.missing_metrics || []),
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
