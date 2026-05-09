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

function clampMin(value, min = 0) {
return Math.max(min, toFloat(value, min));
}

function isPaperMode(config = {}) {
return cleanText(config.execution_mode, 64).toLowerCase() === "paper";
}

function normalizeSnapshot(snapshot = {}) {
return {
token_id: cleanText(snapshot.token_id, 255),
mint_address: cleanText(snapshot.mint_address, 255),

marketcap_usd: clampMin(snapshot.marketcap_usd, 0),
liquidity_usd: clampMin(snapshot.liquidity_usd, 0),
spread_bps: clampMin(snapshot.spread_bps, 0),
price_impact_bps: clampMin(snapshot.price_impact_bps, 0),

top_holder_pct: clampMin(snapshot.top_holder_pct, 0),
top_5_holder_pct: clampMin(snapshot.top_5_holder_pct, 0),

transfer_restriction_risk: clampMin(snapshot.transfer_restriction_risk, 0),
honeypot_risk: clampMin(snapshot.honeypot_risk, 0),
liquidity_break_risk: clampMin(snapshot.liquidity_break_risk, 0),
spoofed_volume_risk: clampMin(snapshot.spoofed_volume_risk, 0),

hidden_control_risk: clampMin(snapshot.hidden_control_risk, 0),
contamination_risk: clampMin(snapshot.contamination_risk, 0),
wallet_coordination_risk: clampMin(snapshot.wallet_coordination_risk, 0),

bars_since_launch: clampMin(snapshot.bars_since_launch, 0),
bars_since_local_low: clampMin(snapshot.bars_since_local_low, 0),
failed_breakout_count: clampMin(snapshot.failed_breakout_count, 0),
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

function evaluateRiskChecks(snapshot, thresholds) {
const checks = [];

checks.push(
buildCheck(
REASON_CODE.TRANSFER_RESTRICTION_RISK,
snapshot.transfer_restriction_risk,
thresholds.transfer_restriction_risk_gte,
">=",
snapshot.transfer_restriction_risk >= thresholds.transfer_restriction_risk_gte
)
);

checks.push(
buildCheck(
REASON_CODE.HONEYPOT_RISK,
snapshot.honeypot_risk,
thresholds.honeypot_risk_gte,
">=",
snapshot.honeypot_risk >= thresholds.honeypot_risk_gte
)
);

checks.push(
buildCheck(
REASON_CODE.LIQUIDITY_BREAK_RISK,
snapshot.liquidity_break_risk,
thresholds.liquidity_break_risk_gte,
">=",
snapshot.liquidity_break_risk >= thresholds.liquidity_break_risk_gte
)
);

checks.push(
buildCheck(
REASON_CODE.SPOOFED_VOLUME_RISK,
snapshot.spoofed_volume_risk,
thresholds.spoofed_volume_risk_gte,
">=",
snapshot.spoofed_volume_risk >= thresholds.spoofed_volume_risk_gte
)
);

return checks;
}

function evaluateLiquidityChecks(snapshot, thresholds) {
const checks = [];

checks.push(
buildCheck(
REASON_CODE.LOW_LIQUIDITY,
snapshot.liquidity_usd,
thresholds.min_liquidity_usd,
"<",
snapshot.liquidity_usd < thresholds.min_liquidity_usd
)
);

checks.push(
buildCheck(
REASON_CODE.WIDE_SPREAD,
snapshot.spread_bps,
thresholds.max_spread_bps,
">",
snapshot.spread_bps > thresholds.max_spread_bps
)
);

checks.push(
buildCheck(
REASON_CODE.HIGH_PRICE_IMPACT,
snapshot.price_impact_bps,
thresholds.max_price_impact_bps,
">",
snapshot.price_impact_bps > thresholds.max_price_impact_bps
)
);

return checks;
}

function evaluateHolderChecks(snapshot, thresholds) {
const checks = [];

checks.push(
buildCheck(
REASON_CODE.TOP_HOLDER_TOO_CONCENTRATED,
snapshot.top_holder_pct,
thresholds.max_top_holder_pct,
">",
snapshot.top_holder_pct > thresholds.max_top_holder_pct
)
);

checks.push(
buildCheck(
REASON_CODE.TOP5_TOO_CONCENTRATED,
snapshot.top_5_holder_pct,
thresholds.max_top_5_holder_pct,
">",
snapshot.top_5_holder_pct > thresholds.max_top_5_holder_pct
)
);

return checks;
}

function evaluateControlChecks(snapshot, thresholds) {
const checks = [];

checks.push(
buildCheck(
REASON_CODE.HIDDEN_CONTROL_TOO_HIGH,
snapshot.hidden_control_risk,
thresholds.max_hidden_control_risk,
">",
snapshot.hidden_control_risk > thresholds.max_hidden_control_risk
)
);

checks.push(
buildCheck(
REASON_CODE.CONTAMINATION_TOO_HIGH,
snapshot.contamination_risk,
thresholds.max_contamination_risk,
">",
snapshot.contamination_risk > thresholds.max_contamination_risk
)
);

checks.push(
buildCheck(
REASON_CODE.COORDINATION_RISK_TOO_HIGH,
snapshot.wallet_coordination_risk,
thresholds.max_wallet_coordination_risk,
">",
snapshot.wallet_coordination_risk > thresholds.max_wallet_coordination_risk
)
);

return checks;
}

function collectRejectedReasons(allChecks = []) {
return allChecks.filter((check) => check.rejected).map((check) => check.code);
}

export function getHardRejectReasonCodes() {
return Array.from(HARD_REJECT_REASON_SET);
}

export function isHardRejectReason(code) {
return HARD_REJECT_REASON_SET.has(cleanText(code, 128));
}

export function filterHardRejectReasons(reasonCodes = []) {
return ensureReasonCodeArray(reasonCodes).filter((code) => isHardRejectReason(code));
}

export function getHardRejectThresholds(config = {}) {
const safe = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
const paperMode = isPaperMode(safe);

return {
execution_mode: safe.execution_mode,
paper_mode_relaxed: paperMode,

transfer_restriction_risk_gte: 80,
honeypot_risk_gte: 80,
liquidity_break_risk_gte: 80,
spoofed_volume_risk_gte: 75,

min_liquidity_usd: safe.min_liquidity_usd,
max_spread_bps: safe.max_spread_bps,
max_price_impact_bps: safe.max_price_impact_bps,

max_top_holder_pct: paperMode ? Math.max(safe.max_top_holder_pct, 45) : safe.max_top_holder_pct,
max_top_5_holder_pct: paperMode ? Math.max(safe.max_top_5_holder_pct, 70) : safe.max_top_5_holder_pct,

max_hidden_control_risk: paperMode ? Math.max(safe.max_hidden_control_risk, 65) : safe.max_hidden_control_risk,
max_contamination_risk: paperMode ? Math.max(safe.max_contamination_risk, 65) : safe.max_contamination_risk,
max_wallet_coordination_risk: paperMode ? Math.max(safe.max_wallet_coordination_risk, 70) : safe.max_wallet_coordination_risk,
};
}

export function evaluateHardRejects(snapshot = {}, config = {}) {
const safeConfig = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));
const safeSnapshot = normalizeSnapshot(snapshot || {});
const thresholds = getHardRejectThresholds(safeConfig);

if (!safeConfig.enable_hard_rejects) {
return {
rejected: false,
reasons: [],
snapshot: safeSnapshot,
checks: [],
thresholds,
meta: {
hard_rejects_enabled: false,
execution_mode: safeConfig.execution_mode,
paper_mode_relaxed: Boolean(thresholds.paper_mode_relaxed),
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

return {
rejected: reasons.length > 0,
reasons,
snapshot: safeSnapshot,
checks,
thresholds,
meta: {
hard_rejects_enabled: true,
rejected_check_count: reasons.length,
total_check_count: checks.length,
execution_mode: safeConfig.execution_mode,
paper_mode_relaxed: Boolean(thresholds.paper_mode_relaxed),
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
rejected_check_count: 0,
total_check_count: 0,
execution_mode: null,
paper_mode_relaxed: false,
};
}

return {
rejected: Boolean(result.rejected),
reasons: ensureReasonCodeArray(result.reasons || []),
rejected_check_count: toInt(result?.meta?.rejected_check_count, 0),
total_check_count: toInt(result?.meta?.total_check_count, 0),
execution_mode: cleanText(result?.meta?.execution_mode, 64) || null,
paper_mode_relaxed: Boolean(result?.meta?.paper_mode_relaxed),
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
