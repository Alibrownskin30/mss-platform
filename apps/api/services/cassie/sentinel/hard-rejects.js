import { getEffectiveSentinelConfig, normalizeSentinelConfig } from "./config.js";
import { REASON_CODE, ensureReasonCodeArray } from "./reason-codes.js";

const HARD_REJECT_REASON_SET = new Set([
REASON_CODE.TRANSFER_RESTRICTION_RISK,
REASON_CODE.HONEYPOT_RISK,
REASON_CODE.LIQUIDITY_BREAK_RISK,
REASON_CODE.SPOOFED_VOLUME_RISK,
REASON_CODE.LOW_LIQUIDITY,
REASON_CODE.WIDE_SPREAD,
REASON_CODE.HIGH_PRICE_IMPACT,
REASON_CODE.TOP_HOLDER_TOO_CONCENTRATED,
REASON_CODE.TOP5_TOO_CONCENTRATED,
REASON_CODE.HIDDEN_CONTROL_TOO_HIGH,
REASON_CODE.CONTAMINATION_TOO_HIGH,
REASON_CODE.COORDINATION_RISK_TOO_HIGH,
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

function normalizeNullableMin(value) {
const num = firstFiniteNumber(value);
if (num == null) return null;
return Math.max(0, num);
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

const liquidityUsd = firstFiniteNumber(
snapshot.liquidity_usd,
snapshot.liquidityUsd,
snapshot.market?.liquidity_usd,
snapshot.market?.liquidityUsd,
snapshot.market?.liquidity?.usd,
snapshot.liquidity?.usd,
snapshot.market?.found ? snapshot.market?.liquidityUsd : null
);

const marketcapUsd = firstFiniteNumber(
snapshot.marketcap_usd,
snapshot.marketcapUsd,
snapshot.market_cap_usd,
snapshot.marketCapUsd,
snapshot.mcap_usd,
snapshot.mcapUsd,
snapshot.market?.marketcap_usd,
snapshot.market?.marketcapUsd,
snapshot.market?.mcap_usd,
snapshot.market?.mcapUsd,
snapshot.market?.fdv
);

const spreadBps = firstFiniteNumber(
snapshot.spread_bps,
snapshot.spreadBps,
snapshot.market?.spread_bps,
snapshot.market?.spreadBps
);

const priceImpactBps = firstFiniteNumber(
snapshot.price_impact_bps,
snapshot.priceImpactBps,
snapshot.market?.price_impact_bps,
snapshot.market?.priceImpactBps
);

const topHolderPct = firstFiniteNumber(
snapshot.top_holder_pct,
snapshot.topHolderPct,
snapshot.top1_holder_pct,
snapshot.top1HolderPct,
snapshot.concentration?.top1,
snapshot.holders?.top1
);

const top5HolderPct = firstFiniteNumber(
snapshot.top_5_holder_pct,
snapshot.top5_holder_pct,
snapshot.top5HolderPct,
snapshot.concentration?.top5,
snapshot.holders?.top5
);

const transferRestrictionRisk = firstFiniteNumber(
snapshot.transfer_restriction_risk,
snapshot.transferRestrictionRisk,
snapshot.transfer_restriction_score,
snapshot.transferRestrictionScore,
snapshot.token?.transfer_restriction_risk,
snapshot.securityModel?.transferRestrictionRisk?.score,
snapshot.securityModel?.transferRestriction?.score
);

const honeypotRisk = firstFiniteNumber(
snapshot.honeypot_risk,
snapshot.honeypotRisk,
snapshot.honeypot_score,
snapshot.honeypotScore,
snapshot.token?.honeypot_risk,
snapshot.securityModel?.honeypotRisk?.score,
snapshot.securityModel?.honeypot?.score
);

const liquidityBreakRisk = firstFiniteNumber(
snapshot.liquidity_break_risk,
snapshot.liquidityBreakRisk,
snapshot.liquidity_break_score,
snapshot.liquidityBreakScore,
snapshot.securityModel?.liquidityBreakRisk?.score,
snapshot.securityModel?.liquidityStability?.score != null
? 100 - Number(snapshot.securityModel.liquidityStability.score)
: null
);

const spoofedVolumeRisk = firstFiniteNumber(
snapshot.spoofed_volume_risk,
snapshot.spoofedVolumeRisk,
snapshot.spoofed_volume_score,
snapshot.spoofedVolumeScore,
snapshot.securityModel?.spoofedVolumeRisk?.score,
snapshot.securityModel?.washTradingRisk?.score
);

const hiddenControlRisk = firstFiniteNumber(
snapshot.hidden_control_risk,
snapshot.hiddenControlRisk,
snapshot.hidden_control_score,
snapshot.hiddenControlScore,
snapshot.hidden_control?.score,
snapshot.securityModel?.hiddenControl?.score
);

const contaminationRisk = firstFiniteNumber(
snapshot.contamination_risk,
snapshot.contaminationRisk,
snapshot.contamination_score,
snapshot.contaminationScore,
snapshot.contamination?.score,
snapshot.securityModel?.contaminationRisk?.score
);

const walletCoordinationRisk = firstFiniteNumber(
snapshot.wallet_coordination_risk,
snapshot.walletCoordinationRisk,
snapshot.coordination_risk,
snapshot.coordinationRisk,
snapshot.wallet_network_risk,
snapshot.walletNetworkRisk,
snapshot.wallet_network?.risk_score,
snapshot.walletNetwork?.riskScore,
snapshot.securityModel?.walletNetwork?.riskScore,
snapshot.activity?.score
);

return {
...snapshot,
token_id: tokenId || mintAddress || "",
mint_address: mintAddress || tokenId || "",
execution_mode: executionMode,

marketcap_usd: normalizeNullableMin(marketcapUsd),
liquidity_usd: normalizeNullableMin(liquidityUsd),
spread_bps: normalizeNullableMin(spreadBps),
price_impact_bps: normalizeNullableMin(priceImpactBps),

top_holder_pct: normalizeNullableScore(topHolderPct),
top_5_holder_pct: normalizeNullableScore(top5HolderPct),

transfer_restriction_risk: normalizeNullableScore(transferRestrictionRisk),
honeypot_risk: normalizeNullableScore(honeypotRisk),
liquidity_break_risk: normalizeNullableScore(liquidityBreakRisk),
spoofed_volume_risk: normalizeNullableScore(spoofedVolumeRisk),

hidden_control_risk: normalizeNullableScore(hiddenControlRisk),
contamination_risk: normalizeNullableScore(contaminationRisk),
wallet_coordination_risk: normalizeNullableScore(walletCoordinationRisk),

bars_since_launch: normalizeNullableMin(
firstDefined(snapshot.bars_since_launch, snapshot.barsSinceLaunch)
),
bars_since_local_low: normalizeNullableMin(
firstDefined(snapshot.bars_since_local_low, snapshot.barsSinceLocalLow)
),
failed_breakout_count: normalizeNullableMin(
firstDefined(snapshot.failed_breakout_count, snapshot.failedBreakoutCount)
),
};
}

function buildCheck(
code,
actual,
threshold,
comparator,
enabled,
triggered,
missing = false
) {
return {
code,
actual,
threshold,
comparator,
enabled: Boolean(enabled),
triggered: Boolean(triggered),
rejected: Boolean(enabled && triggered),
advisory: Boolean(!enabled && triggered),
missing: Boolean(missing),
};
}

function greaterThanOrEqual(actual, threshold) {
return actual != null && threshold != null && actual >= threshold;
}

function greaterThan(actual, threshold) {
return actual != null && threshold != null && actual > threshold;
}

function lessThan(actual, threshold) {
return actual != null && threshold != null && actual < threshold;
}

function evaluateRiskChecks(snapshot, thresholds) {
return [
buildCheck(
REASON_CODE.TRANSFER_RESTRICTION_RISK,
snapshot.transfer_restriction_risk,
thresholds.transfer_restriction_risk_gte,
">=",
true,
greaterThanOrEqual(
snapshot.transfer_restriction_risk,
thresholds.transfer_restriction_risk_gte
),
snapshot.transfer_restriction_risk == null
),
buildCheck(
REASON_CODE.HONEYPOT_RISK,
snapshot.honeypot_risk,
thresholds.honeypot_risk_gte,
">=",
true,
greaterThanOrEqual(snapshot.honeypot_risk, thresholds.honeypot_risk_gte),
snapshot.honeypot_risk == null
),
buildCheck(
REASON_CODE.LIQUIDITY_BREAK_RISK,
snapshot.liquidity_break_risk,
thresholds.liquidity_break_risk_gte,
">=",
true,
greaterThanOrEqual(
snapshot.liquidity_break_risk,
thresholds.liquidity_break_risk_gte
),
snapshot.liquidity_break_risk == null
),
buildCheck(
REASON_CODE.SPOOFED_VOLUME_RISK,
snapshot.spoofed_volume_risk,
thresholds.spoofed_volume_risk_gte,
">=",
true,
greaterThanOrEqual(
snapshot.spoofed_volume_risk,
thresholds.spoofed_volume_risk_gte
),
snapshot.spoofed_volume_risk == null
),
];
}

function evaluateLiquidityChecks(snapshot, thresholds) {
return [
buildCheck(
REASON_CODE.LOW_LIQUIDITY,
snapshot.liquidity_usd,
thresholds.min_liquidity_usd,
"<",
Boolean(thresholds.enable_liquidity_checks),
lessThan(snapshot.liquidity_usd, thresholds.min_liquidity_usd),
snapshot.liquidity_usd == null
),
buildCheck(
REASON_CODE.WIDE_SPREAD,
snapshot.spread_bps,
thresholds.max_spread_bps,
">",
Boolean(thresholds.enable_liquidity_checks),
greaterThan(snapshot.spread_bps, thresholds.max_spread_bps),
snapshot.spread_bps == null
),
buildCheck(
REASON_CODE.HIGH_PRICE_IMPACT,
snapshot.price_impact_bps,
thresholds.max_price_impact_bps,
">",
Boolean(thresholds.enable_liquidity_checks),
greaterThan(snapshot.price_impact_bps, thresholds.max_price_impact_bps),
snapshot.price_impact_bps == null
),
];
}

function evaluateHolderChecks(snapshot, thresholds) {
return [
buildCheck(
REASON_CODE.TOP_HOLDER_TOO_CONCENTRATED,
snapshot.top_holder_pct,
thresholds.max_top_holder_pct,
">",
Boolean(thresholds.enable_holder_checks),
greaterThan(snapshot.top_holder_pct, thresholds.max_top_holder_pct),
snapshot.top_holder_pct == null
),
buildCheck(
REASON_CODE.TOP5_TOO_CONCENTRATED,
snapshot.top_5_holder_pct,
thresholds.max_top_5_holder_pct,
">",
Boolean(thresholds.enable_holder_checks),
greaterThan(snapshot.top_5_holder_pct, thresholds.max_top_5_holder_pct),
snapshot.top_5_holder_pct == null
),
];
}

function evaluateControlChecks(snapshot, thresholds) {
return [
buildCheck(
REASON_CODE.HIDDEN_CONTROL_TOO_HIGH,
snapshot.hidden_control_risk,
thresholds.max_hidden_control_risk,
">",
true,
greaterThan(snapshot.hidden_control_risk, thresholds.max_hidden_control_risk),
snapshot.hidden_control_risk == null
),
buildCheck(
REASON_CODE.CONTAMINATION_TOO_HIGH,
snapshot.contamination_risk,
thresholds.max_contamination_risk,
">",
true,
greaterThan(snapshot.contamination_risk, thresholds.max_contamination_risk),
snapshot.contamination_risk == null
),
buildCheck(
REASON_CODE.COORDINATION_RISK_TOO_HIGH,
snapshot.wallet_coordination_risk,
thresholds.max_wallet_coordination_risk,
">",
true,
greaterThan(
snapshot.wallet_coordination_risk,
thresholds.max_wallet_coordination_risk
),
snapshot.wallet_coordination_risk == null
),
];
}

function collectRejectedReasons(allChecks = []) {
return allChecks.filter((check) => check.rejected).map((check) => check.code);
}

function collectAdvisoryReasons(allChecks = []) {
return allChecks.filter((check) => check.advisory).map((check) => check.code);
}

function collectMissingMetrics(allChecks = []) {
return allChecks.filter((check) => check.enabled && check.missing).map((check) => check.code);
}

export function getHardRejectReasonCodes() {
return Array.from(HARD_REJECT_REASON_SET);
}

export function isHardRejectReason(code) {
return HARD_REJECT_REASON_SET.has(cleanText(code, 128));
}

export function filterHardRejectReasons(reasonCodes = []) {
return ensureReasonCodeArray(reasonCodes).filter((code) =>
isHardRejectReason(code)
);
}

export function getHardRejectThresholds(config = {}, runtime = {}) {
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

transfer_restriction_risk_gte: paperMode ? 95 : 80,
honeypot_risk_gte: paperMode ? 92 : 80,
liquidity_break_risk_gte: paperMode ? 92 : 80,
spoofed_volume_risk_gte: paperMode ? 90 : 75,

min_liquidity_usd: safe.min_liquidity_usd,
max_spread_bps: safe.max_spread_bps,
max_price_impact_bps: safe.max_price_impact_bps,

max_top_holder_pct: safe.max_top_holder_pct,
max_top_5_holder_pct: safe.max_top_5_holder_pct,

max_hidden_control_risk: paperMode
? Math.max(safe.max_hidden_control_risk, 97)
: safe.max_hidden_control_risk,
max_contamination_risk: paperMode
? Math.max(safe.max_contamination_risk, 97)
: safe.max_contamination_risk,
max_wallet_coordination_risk: paperMode
? Math.max(safe.max_wallet_coordination_risk, 97)
: safe.max_wallet_coordination_risk,

enable_liquidity_checks: !paperMode,
enable_holder_checks: !paperMode,
};
}

export function evaluateHardRejects(snapshot = {}, config = {}) {
const safeSnapshot = normalizeSnapshot(snapshot || {});
const executionMode =
resolveExecutionMode(safeSnapshot.execution_mode, config?.execution_mode) ||
"paper";

const safeConfig = getEffectiveSentinelConfig(
normalizeSentinelConfig({
...(config || {}),
execution_mode: executionMode,
})
);

const thresholds = getHardRejectThresholds(safeConfig, {
execution_mode: executionMode,
});

if (!safeConfig.enable_hard_rejects) {
return {
rejected: false,
reasons: [],
advisory_reasons: [],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
checks: [],
thresholds,
meta: {
hard_rejects_enabled: false,
rejected_check_count: 0,
advisory_check_count: 0,
total_check_count: 0,
execution_mode: thresholds.execution_mode,
paper_mode_relaxed: Boolean(thresholds.paper_mode_relaxed),
missing_metrics: [],
},
};
}

const riskChecks = evaluateRiskChecks(safeSnapshot, thresholds);
const liquidityChecks = evaluateLiquidityChecks(safeSnapshot, thresholds);
const holderChecks = evaluateHolderChecks(safeSnapshot, thresholds);
const controlChecks = evaluateControlChecks(safeSnapshot, thresholds);

const checks = [
...riskChecks,
...liquidityChecks,
...holderChecks,
...controlChecks,
];

const reasons = collectRejectedReasons(checks);
const advisoryReasons = collectAdvisoryReasons(checks);
const missingMetrics = collectMissingMetrics(checks);

return {
rejected: reasons.length > 0,
reasons,
advisory_reasons: advisoryReasons,
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
checks,
thresholds,
meta: {
hard_rejects_enabled: true,
rejected_check_count: reasons.length,
advisory_check_count: advisoryReasons.length,
total_check_count: checks.length,
execution_mode: thresholds.execution_mode,
paper_mode_relaxed: Boolean(thresholds.paper_mode_relaxed),
missing_metrics: missingMetrics,
},
};
}

export function passesHardRejects(snapshot = {}, config = {}) {
return !evaluateHardRejects(snapshot, config).rejected;
}

export function summarizeHardRejects(result = null) {
if (!result) {
return {
rejected: false,
reasons: [],
advisory_reasons: [],
rejected_check_count: 0,
advisory_check_count: 0,
total_check_count: 0,
execution_mode: null,
paper_mode_relaxed: false,
missing_metrics: [],
};
}

return {
rejected: Boolean(result.rejected),
reasons: ensureReasonCodeArray(result.reasons || []),
advisory_reasons: ensureReasonCodeArray(result.advisory_reasons || []),
rejected_check_count: toInt(result?.meta?.rejected_check_count, 0),
advisory_check_count: toInt(result?.meta?.advisory_check_count, 0),
total_check_count: toInt(result?.meta?.total_check_count, 0),
execution_mode: cleanText(result?.meta?.execution_mode, 64) || null,
paper_mode_relaxed: Boolean(result?.meta?.paper_mode_relaxed),
missing_metrics: ensureReasonCodeArray(result?.meta?.missing_metrics || []),
};
}

export default {
getHardRejectReasonCodes,
isHardRejectReason,
filterHardRejectReasons,
getHardRejectThresholds,
evaluateHardRejects,
passesHardRejects,
summarizeHardRejects,
};
