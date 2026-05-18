import {
canOpenNewPositions,
getEffectiveSentinelConfig,
normalizeSentinelConfig,
} from "./config.js";
import { REASON_CODE, ensureReasonCodeArray } from "./reason-codes.js";
import { evaluateHardRejects } from "./hard-rejects.js";
import { evaluateOperatorGate } from "./operator-gate.js";
import { evaluateRegimeGate } from "./regime.js";
import { evaluateScoutEntry } from "./scout.js";
import { evaluateSniperAdd } from "./sniper.js";
import { evaluateEarlyExit } from "./exits.js";
import { evaluateRunnerExit } from "./runner.js";
import { evaluateKillSwitch } from "./kill-switch.js";

export const SENTINEL_DECISION = {
REJECT: "reject",
WATCHLIST: "watchlist",
SCOUT_ENTRY: "scout_entry",
SNIPER_ADD: "sniper_add",
HOLD: "hold",
PARTIAL_TAKE_PROFIT: "partial_take_profit",
FULL_EXIT: "full_exit",
KILL_SWITCH: "kill_switch",
};

const VALID_DECISIONS = new Set(Object.values(SENTINEL_DECISION));

const CRITICAL_ENTRY_METRICS = [
"liquidity_usd",
"top_holder_pct",
"top_5_holder_pct",
];

const MISSING_DATA_REASON_CODES = new Set([
REASON_CODE.MISSING_TOKEN_ID || "MISSING_TOKEN_ID",
REASON_CODE.MISSING_MARKET_DATA || "MISSING_MARKET_DATA",
REASON_CODE.MISSING_PRICE_DATA || "MISSING_PRICE_DATA",
REASON_CODE.MISSING_LIQUIDITY_DATA || "MISSING_LIQUIDITY_DATA",
REASON_CODE.MISSING_HOLDER_CONCENTRATION || "MISSING_HOLDER_CONCENTRATION",
]);

function cleanText(value, max = 255) {
return String(value ?? "").trim().slice(0, max);
}

function toFloat(value, fallback = 0) {
if (typeof value === "number") {
return Number.isFinite(value) ? value : fallback;
}

if (value == null) return fallback;

const raw = String(value).trim();
if (!raw) return fallback;

const cleaned = raw.replace(/,/g, "");
const num = Number.parseFloat(cleaned);
return Number.isFinite(num) ? num : fallback;
}

function toInt(value, fallback = 0) {
const num = Number.parseInt(value, 10);
return Number.isFinite(num) ? num : fallback;
}

function toNullableFloat(value) {
if (value === undefined || value === null || value === "") return null;
const num = toFloat(value, null);
return Number.isFinite(num) ? num : null;
}

function normalizeMinNumber(value) {
const num = toNullableFloat(value);
return num == null ? null : Math.max(0, num);
}

function normalizeScore(value) {
const num = toNullableFloat(value);
return num == null ? null : Math.min(100, Math.max(0, num));
}

function normalizeDecision(value, fallback = SENTINEL_DECISION.WATCHLIST) {
const normalized = cleanText(value, 64).toLowerCase();
return VALID_DECISIONS.has(normalized) ? normalized : fallback;
}

function firstDefined(...values) {
for (const value of values) {
if (value !== undefined && value !== null && value !== "") {
return value;
}
}
return undefined;
}

function resolveExecutionMode(...values) {
for (const value of values) {
const mode = cleanText(value, 64).toLowerCase();
if (mode) return mode;
}
return null;
}

function getPath(source, path) {
if (!source || typeof source !== "object") return undefined;

return String(path || "")
.split(".")
.filter(Boolean)
.reduce((acc, key) => (acc == null ? undefined : acc[key]), source);
}

function firstPathValue(source = {}, paths = []) {
for (const path of paths) {
const value = getPath(source, path);
if (value !== undefined && value !== null && value !== "") {
return value;
}
}

return undefined;
}

function metricValue(snapshot = {}, paths = []) {
return firstPathValue(snapshot, paths);
}

function uniqueReasonCodes(reasonCodes = []) {
return ensureReasonCodeArray(reasonCodes, []).filter(
(code, index, array) => array.indexOf(code) === index
);
}

function withFallbackReason(reasonCodes = [], fallback = REASON_CODE.TOKEN_REJECTED) {
const safe = uniqueReasonCodes(reasonCodes);
if (safe.length) return safe;
return uniqueReasonCodes([fallback || "TOKEN_REJECTED"]);
}

function withInvalidationReason(reasonCodes = []) {
const safe = uniqueReasonCodes(reasonCodes);
const invalidationReason =
cleanText(REASON_CODE.INVALIDATION_EXIT, 128) || "INVALIDATION_EXIT";

if (invalidationReason && !safe.includes(invalidationReason)) {
safe.unshift(invalidationReason);
}

return safe.length
? safe
: [REASON_CODE.FULL_EXIT_EXECUTED || "FULL_EXIT_EXECUTED"];
}

function normalizeSnapshot(snapshot = {}) {
const tokenId = cleanText(
firstDefined(
snapshot.token_id,
snapshot.tokenId,
snapshot.mint,
snapshot.mint_address,
snapshot.mintAddress
),
255
);

const mintAddress = cleanText(
firstDefined(
snapshot.mint_address,
snapshot.mintAddress,
snapshot.mint,
snapshot.token_id,
snapshot.tokenId
),
255
);

const liquidityUsd = normalizeMinNumber(
metricValue(snapshot, [
"liquidity_usd",
"liquidityUsd",
"liq_usd",
"liqUsd",
"market_liquidity_usd",
"marketLiquidityUsd",
"market.liquidity_usd",
"market.liquidityUsd",
"market.liquidity.usd",
"raw.liquidity_usd",
"raw.liquidityUsd",
"raw.market.liquidity_usd",
"raw.market.liquidityUsd",
"raw.market.liquidity.usd",
])
);

const marketcapUsd = normalizeMinNumber(
metricValue(snapshot, [
"marketcap_usd",
"marketcapUsd",
"market_cap_usd",
"marketCapUsd",
"mcap_usd",
"mcapUsd",
"fdv_usd",
"fdvUsd",
"fdv",
"market.marketcap_usd",
"market.marketcapUsd",
"market.market_cap_usd",
"market.marketCapUsd",
"market.mcap_usd",
"market.mcapUsd",
"market.fdv",
"market.fdv_usd",
"market.fdvUsd",
"raw.marketcap_usd",
"raw.marketcapUsd",
"raw.market.marketcap_usd",
"raw.market.marketcapUsd",
"raw.market.fdv",
])
);

const spreadBps = normalizeMinNumber(
metricValue(snapshot, [
"spread_bps",
"spreadBps",
"market.spread_bps",
"market.spreadBps",
"raw.spread_bps",
"raw.spreadBps",
"raw.market.spread_bps",
"raw.market.spreadBps",
])
);

const priceImpactBps = normalizeMinNumber(
metricValue(snapshot, [
"price_impact_bps",
"priceImpactBps",
"market.price_impact_bps",
"market.priceImpactBps",
"raw.price_impact_bps",
"raw.priceImpactBps",
"raw.market.price_impact_bps",
"raw.market.priceImpactBps",
])
);

const topHolderPct = normalizeScore(
metricValue(snapshot, [
"top_holder_pct",
"topHolderPct",
"top1_holder_pct",
"top1HolderPct",
"top1_pct",
"top1Pct",
"concentration.top1",
"concentration.top1_pct",
"holders.top1",
"holders.top1_pct",
"securityModel.holderConcentration.top1",
"securityModel.holder_concentration.top1",
])
);

const top5HolderPct = normalizeScore(
metricValue(snapshot, [
"top_5_holder_pct",
"top5_holder_pct",
"top5HolderPct",
"top5_pct",
"top5Pct",
"concentration.top5",
"concentration.top5_pct",
"holders.top5",
"holders.top5_pct",
"securityModel.holderConcentration.top5",
"securityModel.holder_concentration.top5",
])
);

const transferRestrictionRisk = normalizeScore(
metricValue(snapshot, [
"transfer_restriction_risk",
"transferRestrictionRisk",
"transfer_restriction_score",
"transferRestrictionScore",
"token.transfer_restriction_risk",
"securityModel.transferRestrictionRisk.score",
"securityModel.transferRestriction.score",
"securityModel.transfer_restriction_risk",
"securityModel.transfer_restriction.score",
])
);

const honeypotRisk = normalizeScore(
metricValue(snapshot, [
"honeypot_risk",
"honeypotRisk",
"honeypot_score",
"honeypotScore",
"token.honeypot_risk",
"securityModel.honeypotRisk.score",
"securityModel.honeypot.score",
"securityModel.honeypot_risk",
])
);

const liquidityBreakRisk = normalizeScore(
metricValue(snapshot, [
"liquidity_break_risk",
"liquidityBreakRisk",
"liquidity_break_score",
"liquidityBreakScore",
"securityModel.liquidityBreakRisk.score",
"securityModel.liquidity_break_risk",
])
);

const spoofedVolumeRisk = normalizeScore(
metricValue(snapshot, [
"spoofed_volume_risk",
"spoofedVolumeRisk",
"spoofed_volume_score",
"spoofedVolumeScore",
"wash_trading_risk",
"washTradingRisk",
"securityModel.spoofedVolumeRisk.score",
"securityModel.spoofed_volume_risk",
"securityModel.washTradingRisk.score",
"securityModel.wash_trading_risk",
])
);

const hiddenControlRisk = normalizeScore(
metricValue(snapshot, [
"hidden_control_risk",
"hiddenControlRisk",
"hidden_control_score",
"hiddenControlScore",
"hidden_control.score",
"securityModel.hiddenControl.score",
"securityModel.hidden_control.score",
"securityModel.hidden_control_risk",
])
);

const contaminationRisk = normalizeScore(
metricValue(snapshot, [
"contamination_risk",
"contaminationRisk",
"contamination_score",
"contaminationScore",
"contamination.score",
"securityModel.contaminationRisk.score",
"securityModel.contamination.score",
"securityModel.freshWalletRisk.score",
"securityModel.contamination_risk",
])
);

const walletCoordinationRisk = normalizeScore(
metricValue(snapshot, [
"wallet_coordination_risk",
"walletCoordinationRisk",
"coordination_risk",
"coordinationRisk",
"wallet_network_risk",
"walletNetworkRisk",
"wallet_network.risk_score",
"walletNetwork.riskScore",
"securityModel.walletNetwork.riskScore",
"securityModel.wallet_network.risk_score",
"activity.coordinationRisk",
"activity.coordination_risk",
"activity.score",
])
);

const insiderSellScore = normalizeScore(
metricValue(snapshot, [
"insider_sell_score",
"insiderSellScore",
"dev_sell_score",
"devSellScore",
"developer_sell_score",
"operator_sell_score",
"operatorSellScore",
"activity.insiderSellScore",
"activity.insider_sell_score",
"securityModel.insiderSellRisk.score",
"securityModel.insider_sell_risk",
"securityModel.devSellRisk.score",
])
);

const liquidityDecayScore = normalizeScore(
metricValue(snapshot, [
"liquidity_decay_score",
"liquidityDecayScore",
"lp_decay_score",
"lpDecayScore",
"market.liquidity_decay_score",
"market.liquidityDecayScore",
"securityModel.liquidityDecayRisk.score",
"securityModel.liquidity_decay_risk",
])
);

const structuralHealthScore = normalizeScore(
metricValue(snapshot, [
"structural_health_score",
"structuralHealthScore",
"health_score",
"healthScore",
"securityModel.structuralHealth.score",
"securityModel.structural_health.score",
])
);

const verticalExtensionScore = normalizeScore(
metricValue(snapshot, [
"vertical_extension_score",
"verticalExtensionScore",
"parabolic_extension_score",
"parabolicExtensionScore",
"trend.verticalExtensionScore",
"trend.vertical_extension_score",
"securityModel.verticalExtensionRisk.score",
])
);

return {
...snapshot,
token_id: tokenId || mintAddress || "",
mint_address: mintAddress || tokenId || "",
execution_mode:
resolveExecutionMode(
snapshot.execution_mode,
snapshot.executionMode,
snapshot.mode
) || null,
linked_operator_cluster_id: cleanText(
firstDefined(
snapshot.linked_operator_cluster_id,
snapshot.linkedOperatorClusterId,
snapshot.operator_cluster_id,
snapshot.operatorClusterId,
snapshot.primary_cluster_id,
snapshot.primaryClusterId
),
255
),

marketcap_usd: marketcapUsd,
liquidity_usd: liquidityUsd,
spread_bps: spreadBps,
price_impact_bps: priceImpactBps,

top_holder_pct: topHolderPct,
top_5_holder_pct: top5HolderPct,

transfer_restriction_risk: transferRestrictionRisk,
honeypot_risk: honeypotRisk,
liquidity_break_risk: liquidityBreakRisk,
spoofed_volume_risk: spoofedVolumeRisk,

hidden_control_risk: hiddenControlRisk,
contamination_risk: contaminationRisk,
wallet_coordination_risk: walletCoordinationRisk,
insider_sell_score: insiderSellScore,
liquidity_decay_score: liquidityDecayScore,
structural_health_score: structuralHealthScore,
vertical_extension_score: verticalExtensionScore,

current_multiple:
firstDefined(snapshot.current_multiple, snapshot.currentMultiple) == null
? null
: Math.max(
0,
toFloat(
firstDefined(snapshot.current_multiple, snapshot.currentMultiple),
0
)
),
current_value_usd:
firstDefined(snapshot.current_value_usd, snapshot.currentValueUsd) == null
? null
: Math.max(
0,
toFloat(
firstDefined(snapshot.current_value_usd, snapshot.currentValueUsd),
0
)
),
};
}

function normalizePosition(position = {}) {
if (!position || typeof position !== "object") return null;

const tokenId = cleanText(
firstDefined(
position.token_id,
position.tokenId,
position.mint,
position.mint_address,
position.mintAddress
),
255
);

const mintAddress = cleanText(
firstDefined(
position.mint_address,
position.mintAddress,
position.mint,
position.token_id,
position.tokenId
),
255
);

return {
...position,
id: toInt(position.id, 0) || null,
token_id: tokenId || mintAddress || "",
mint_address: mintAddress || tokenId || "",
stage: cleanText(position.stage, 64),
execution_mode:
resolveExecutionMode(
position.execution_mode,
position.executionMode,
position.mode
) || null,
linked_operator_cluster_id: cleanText(
firstDefined(
position.linked_operator_cluster_id,
position.linkedOperatorClusterId,
position.operator_cluster_id,
position.operatorClusterId,
position.primary_cluster_id,
position.primaryClusterId
),
255
),
total_size_usd: Math.max(0, toFloat(position.total_size_usd, 0)),
total_cost_usd: Math.max(0, toFloat(position.total_cost_usd, 0)),
current_value_usd: Math.max(0, toFloat(position.current_value_usd, 0)),
has_banked_10x: Boolean(position.has_banked_10x),
};
}

function normalizeContext(context = {}) {
return {
...context,
execution_mode:
resolveExecutionMode(
context.execution_mode,
context.executionMode,
context.mode
) || null,
position_id: toInt(context.position_id, 0) || null,
};
}

function buildSnapshotWithGateOverrides(snapshot = {}, gateResult = null) {
return normalizeSnapshot({
...(snapshot || {}),
regime_state: gateResult?.snapshot?.regime_state ?? snapshot?.regime_state ?? null,
regime_score: gateResult?.snapshot?.regime_score ?? snapshot?.regime_score ?? null,
execution_mode:
gateResult?.snapshot?.execution_mode ?? snapshot?.execution_mode ?? null,
});
}

function mergeStages(stages = {}) {
return {
kill_switch: stages.kill_switch || null,
hard_rejects: stages.hard_rejects || null,
critical_safety: stages.critical_safety || null,
operator_gate: stages.operator_gate || null,
regime_gate: stages.regime_gate || null,
scout: stages.scout || null,
sniper: stages.sniper || null,
exits: stages.exits || null,
runner: stages.runner || null,
};
}

function buildBaseResult({
decision = SENTINEL_DECISION.WATCHLIST,
reason_codes = [],
size_usd = null,
bank_fraction = null,
snapshot = null,
position = null,
meta = {},
stages = {},
} = {}) {
return {
decision: normalizeDecision(decision),
reason_codes: ensureReasonCodeArray(reason_codes, []),
size_usd: size_usd == null ? null : Math.max(0, toFloat(size_usd, 0)),
bank_fraction:
bank_fraction == null
? null
: Math.min(1, Math.max(0, toFloat(bank_fraction, 0))),
snapshot: snapshot ? normalizeSnapshot(snapshot) : null,
position: position ? normalizePosition(position) : null,
meta: {
...meta,
stages: mergeStages(stages),
},
};
}

function deriveCurrentMultiple(position = {}, snapshot = {}) {
const explicitMultiple = toFloat(
firstDefined(snapshot.current_multiple, snapshot.currentMultiple),
null
);
if (explicitMultiple != null && explicitMultiple > 0) {
return explicitMultiple;
}

const currentValueUsd = Math.max(
0,
toFloat(
firstDefined(snapshot.current_value_usd, snapshot.currentValueUsd),
position.current_value_usd || 0
)
);
const totalCostUsd = Math.max(0.0000001, toFloat(position.total_cost_usd, 0));

return currentValueUsd / totalCostUsd;
}

function shouldAttemptTakeProfit(position = {}, snapshot = {}, config = {}) {
if (!position?.id) return false;
if (position.has_banked_10x) return false;
if (!config?.auto_bank_enabled) return false;

const multiple = deriveCurrentMultiple(position, snapshot);
return multiple >= Math.max(1, toFloat(config.auto_bank_multiple, 10));
}

function getTakeProfitReasonCodes(position = {}, snapshot = {}, config = {}) {
if (!config?.auto_bank_enabled) {
return [REASON_CODE.AUTO_BANK_DISABLED || "AUTO_BANK_DISABLED"];
}

if (position?.has_banked_10x) {
return [REASON_CODE.ALREADY_BANKED || "ALREADY_BANKED"];
}

const multiple = deriveCurrentMultiple(position, snapshot);
if (multiple >= Math.max(1, toFloat(config.auto_bank_multiple, 10))) {
return [REASON_CODE.TEN_X_REACHED || "TEN_X_REACHED"];
}

return [REASON_CODE.TEN_X_NOT_REACHED || "TEN_X_NOT_REACHED"];
}

function hasUsableTokenReference(snapshot = {}, position = null) {
if (cleanText(snapshot?.token_id, 255)) return true;
if (cleanText(snapshot?.mint_address, 255)) return true;
if (cleanText(position?.token_id, 255)) return true;
if (cleanText(position?.mint_address, 255)) return true;
return false;
}

function getCriticalMissingMetrics(snapshot = {}) {
const missing = [];

for (const metric of CRITICAL_ENTRY_METRICS) {
if (snapshot?.[metric] == null) {
missing.push(metric);
}
}

return missing;
}

function buildCriticalCheck(code, actual, threshold, comparator, triggered, missing = false) {
return {
code,
actual,
threshold,
comparator,
triggered: Boolean(triggered),
missing: Boolean(missing),
};
}

function evaluateCriticalSafety(snapshot = {}, config = {}, { includeMissing = false } = {}) {
const safeSnapshot = normalizeSnapshot(snapshot || {});
const safeConfig = getEffectiveSentinelConfig(normalizeSentinelConfig(config || {}));

const checks = [];

checks.push(
buildCriticalCheck(
REASON_CODE.LOW_LIQUIDITY || "LOW_LIQUIDITY",
safeSnapshot.liquidity_usd,
safeConfig.min_liquidity_usd,
"<",
safeSnapshot.liquidity_usd != null &&
safeConfig.min_liquidity_usd != null &&
safeSnapshot.liquidity_usd < safeConfig.min_liquidity_usd,
safeSnapshot.liquidity_usd == null
)
);

checks.push(
buildCriticalCheck(
REASON_CODE.TOP_HOLDER_TOO_CONCENTRATED || "TOP_HOLDER_TOO_CONCENTRATED",
safeSnapshot.top_holder_pct,
safeConfig.max_top_holder_pct,
">",
safeSnapshot.top_holder_pct != null &&
safeConfig.max_top_holder_pct != null &&
safeSnapshot.top_holder_pct > safeConfig.max_top_holder_pct,
safeSnapshot.top_holder_pct == null
)
);

checks.push(
buildCriticalCheck(
REASON_CODE.TOP5_TOO_CONCENTRATED || "TOP5_TOO_CONCENTRATED",
safeSnapshot.top_5_holder_pct,
safeConfig.max_top_5_holder_pct,
">",
safeSnapshot.top_5_holder_pct != null &&
safeConfig.max_top_5_holder_pct != null &&
safeSnapshot.top_5_holder_pct > safeConfig.max_top_5_holder_pct,
safeSnapshot.top_5_holder_pct == null
)
);

checks.push(
buildCriticalCheck(
REASON_CODE.HIDDEN_CONTROL_TOO_HIGH || "HIDDEN_CONTROL_TOO_HIGH",
safeSnapshot.hidden_control_risk,
safeConfig.max_hidden_control_risk,
">",
safeSnapshot.hidden_control_risk != null &&
safeConfig.max_hidden_control_risk != null &&
safeSnapshot.hidden_control_risk > safeConfig.max_hidden_control_risk,
safeSnapshot.hidden_control_risk == null
)
);

checks.push(
buildCriticalCheck(
REASON_CODE.CONTAMINATION_TOO_HIGH || "CONTAMINATION_TOO_HIGH",
safeSnapshot.contamination_risk,
safeConfig.max_contamination_risk,
">",
safeSnapshot.contamination_risk != null &&
safeConfig.max_contamination_risk != null &&
safeSnapshot.contamination_risk > safeConfig.max_contamination_risk,
safeSnapshot.contamination_risk == null
)
);

checks.push(
buildCriticalCheck(
REASON_CODE.COORDINATION_RISK_TOO_HIGH || "COORDINATION_RISK_TOO_HIGH",
safeSnapshot.wallet_coordination_risk,
safeConfig.max_wallet_coordination_risk,
">",
safeSnapshot.wallet_coordination_risk != null &&
safeConfig.max_wallet_coordination_risk != null &&
safeSnapshot.wallet_coordination_risk > safeConfig.max_wallet_coordination_risk,
safeSnapshot.wallet_coordination_risk == null
)
);

checks.push(
buildCriticalCheck(
REASON_CODE.TRANSFER_RESTRICTION_RISK || "TRANSFER_RESTRICTION_RISK",
safeSnapshot.transfer_restriction_risk,
80,
">=",
safeSnapshot.transfer_restriction_risk != null &&
safeSnapshot.transfer_restriction_risk >= 80,
safeSnapshot.transfer_restriction_risk == null
)
);

checks.push(
buildCriticalCheck(
REASON_CODE.HONEYPOT_RISK || "HONEYPOT_RISK",
safeSnapshot.honeypot_risk,
80,
">=",
safeSnapshot.honeypot_risk != null && safeSnapshot.honeypot_risk >= 80,
safeSnapshot.honeypot_risk == null
)
);

checks.push(
buildCriticalCheck(
REASON_CODE.LIQUIDITY_BREAK_RISK || "LIQUIDITY_BREAK_RISK",
safeSnapshot.liquidity_break_risk,
80,
">=",
safeSnapshot.liquidity_break_risk != null &&
safeSnapshot.liquidity_break_risk >= 80,
safeSnapshot.liquidity_break_risk == null
)
);

checks.push(
buildCriticalCheck(
REASON_CODE.SPOOFED_VOLUME_RISK || "SPOOFED_VOLUME_RISK",
safeSnapshot.spoofed_volume_risk,
75,
">=",
safeSnapshot.spoofed_volume_risk != null &&
safeSnapshot.spoofed_volume_risk >= 75,
safeSnapshot.spoofed_volume_risk == null
)
);

checks.push(
buildCriticalCheck(
REASON_CODE.HIGH_PRICE_IMPACT || "HIGH_PRICE_IMPACT",
safeSnapshot.price_impact_bps,
safeConfig.max_price_impact_bps,
">",
safeSnapshot.price_impact_bps != null &&
safeConfig.max_price_impact_bps != null &&
safeSnapshot.price_impact_bps > safeConfig.max_price_impact_bps,
safeSnapshot.price_impact_bps == null
)
);

checks.push(
buildCriticalCheck(
REASON_CODE.WIDE_SPREAD || "WIDE_SPREAD",
safeSnapshot.spread_bps,
safeConfig.max_spread_bps,
">",
safeSnapshot.spread_bps != null &&
safeConfig.max_spread_bps != null &&
safeSnapshot.spread_bps > safeConfig.max_spread_bps,
safeSnapshot.spread_bps == null
)
);

const triggeredReasons = checks
.filter((check) => check.triggered)
.map((check) => check.code);

const missingMetrics = getCriticalMissingMetrics(safeSnapshot);
const missingReasons = includeMissing && missingMetrics.length
? [
REASON_CODE.LOW_LIQUIDITY || "LOW_LIQUIDITY",
REASON_CODE.TOP_HOLDER_TOO_CONCENTRATED || "TOP_HOLDER_TOO_CONCENTRATED",
REASON_CODE.TOP5_TOO_CONCENTRATED || "TOP5_TOO_CONCENTRATED",
]
: [];

const reasons = uniqueReasonCodes([...triggeredReasons, ...missingReasons]);

return {
rejected: reasons.length > 0,
reasons,
checks,
missing_metrics: missingMetrics,
meta: {
include_missing: Boolean(includeMissing),
critical_check_count: checks.length,
triggered_check_count: triggeredReasons.length,
missing_metric_count: missingMetrics.length,
},
};
}

function stripMissingOnlyHardRejectsForOpenPosition(hardRejectResult = null) {
if (!hardRejectResult || typeof hardRejectResult !== "object") {
return hardRejectResult;
}

const originalReasons = uniqueReasonCodes(hardRejectResult.reasons || []);
const safetyReasons = originalReasons.filter(
(reason) => !MISSING_DATA_REASON_CODES.has(cleanText(reason, 128))
);

const checks = Array.isArray(hardRejectResult.checks) ? hardRejectResult.checks : [];
const nonMissingRejectedChecks = checks.filter((check) => {
if (!check?.rejected) return false;

const code = cleanText(check.code, 128);
if (MISSING_DATA_REASON_CODES.has(code)) return false;

return !check.missing;
});

const finalReasons = uniqueReasonCodes([
...safetyReasons,
...nonMissingRejectedChecks.map((check) => check.code),
]);

return {
...hardRejectResult,
rejected: finalReasons.length > 0,
reasons: finalReasons,
advisory_reasons: uniqueReasonCodes([
...(hardRejectResult.advisory_reasons || []),
...originalReasons.filter((reason) =>
MISSING_DATA_REASON_CODES.has(cleanText(reason, 128))
),
]),
meta: {
...(hardRejectResult.meta || {}),
open_position_missing_only_filter_applied: true,
original_rejected: Boolean(hardRejectResult.rejected),
original_reasons: originalReasons,
filtered_missing_reasons: originalReasons.filter((reason) =>
MISSING_DATA_REASON_CODES.has(cleanText(reason, 128))
),
rejected_check_count: finalReasons.length,
},
};
}

function combineSafetyReasons(hardRejectResult = null, criticalSafety = null) {
return uniqueReasonCodes([
...(hardRejectResult?.reasons || []),
...(criticalSafety?.reasons || []),
]);
}

function isSafetyRejected(hardRejectResult = null, criticalSafety = null) {
return Boolean(hardRejectResult?.rejected || criticalSafety?.rejected);
}

function getSafetyMeta({
haltReason = "hard_rejects",
executionMode = "paper",
criticalSafety = null,
hardRejects = null,
extra = {},
} = {}) {
return {
halt_reason: haltReason,
execution_mode: executionMode,
entry_eligible: false,
discovery_only: true,
hard_rejected: Boolean(hardRejects?.rejected),
critical_safety_rejected: Boolean(criticalSafety?.rejected),
critical_missing_metrics: criticalSafety?.missing_metrics || [],
...extra,
};
}

export async function evaluateToken(snapshot = {}, config = {}, context = {}) {
const safeSnapshot = normalizeSnapshot(snapshot || {});
const safeConfig = getEffectiveSentinelConfig(
normalizeSentinelConfig(config || {})
);
const safeContext = normalizeContext(context || {});
const safePosition = normalizePosition(safeContext.position || null);

const executionMode =
safeContext.execution_mode ||
safeSnapshot.execution_mode ||
safePosition?.execution_mode ||
safeConfig.execution_mode ||
"paper";

const stages = {};
const hasPosition = Boolean(safePosition?.id);

if (!hasUsableTokenReference(safeSnapshot, safePosition)) {
return buildBaseResult({
decision: hasPosition ? SENTINEL_DECISION.HOLD : SENTINEL_DECISION.WATCHLIST,
reason_codes: [REASON_CODE.INVALID_TOKEN_SNAPSHOT || "INVALID_TOKEN_SNAPSHOT"],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: "invalid_snapshot",
execution_mode: executionMode,
entry_eligible: false,
discovery_only: true,
},
stages,
});
}

stages.kill_switch = await evaluateKillSwitch(
safeContext.day_stats || safeContext.dayStats || safeContext,
{
...safeConfig,
execution_mode: executionMode,
}
);

if (stages.kill_switch?.active) {
return buildBaseResult({
decision: SENTINEL_DECISION.KILL_SWITCH,
reason_codes: ensureReasonCodeArray(
stages.kill_switch.reasons || [REASON_CODE.KILL_SWITCH_TRIGGERED || "KILL_SWITCH_TRIGGERED"]
),
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: "kill_switch",
execution_mode: executionMode,
entry_eligible: false,
discovery_only: true,
},
stages,
});
}

const rawHardRejects = evaluateHardRejects(
{
...safeSnapshot,
execution_mode: executionMode,
},
{
...safeConfig,
execution_mode: executionMode,
}
);

stages.hard_rejects = hasPosition
? stripMissingOnlyHardRejectsForOpenPosition(rawHardRejects)
: rawHardRejects;

stages.critical_safety = evaluateCriticalSafety(
{
...safeSnapshot,
execution_mode: executionMode,
},
{
...safeConfig,
execution_mode: executionMode,
},
{
includeMissing: !hasPosition,
}
);

if (!hasPosition) {
if (isSafetyRejected(stages.hard_rejects, stages.critical_safety)) {
return buildBaseResult({
decision: SENTINEL_DECISION.REJECT,
reason_codes: withFallbackReason(
combineSafetyReasons(stages.hard_rejects, stages.critical_safety),
REASON_CODE.TOKEN_REJECTED || "TOKEN_REJECTED"
),
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: null,
meta: getSafetyMeta({
haltReason: "hard_rejects",
executionMode,
criticalSafety: stages.critical_safety,
hardRejects: stages.hard_rejects,
}),
stages,
});
}

stages.operator_gate = await evaluateOperatorGate(
{
...safeSnapshot,
execution_mode: executionMode,
},
{
...safeConfig,
execution_mode: executionMode,
},
{
...safeContext,
execution_mode: executionMode,
}
);

if (!stages.operator_gate?.passed) {
return buildBaseResult({
decision: SENTINEL_DECISION.REJECT,
reason_codes:
stages.operator_gate.reasons || [REASON_CODE.OPERATOR_QUALITY_TOO_LOW || "OPERATOR_QUALITY_TOO_LOW"],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: null,
meta: {
halt_reason: "operator_gate",
execution_mode: executionMode,
entry_eligible: false,
discovery_only: true,
},
stages,
});
}

if (!canOpenNewPositions({ ...safeConfig, execution_mode: executionMode })) {
return buildBaseResult({
decision: SENTINEL_DECISION.WATCHLIST,
reason_codes: [REASON_CODE.WATCHLIST_ONLY || "WATCHLIST_ONLY"],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: null,
meta: {
halt_reason: "new_entries_disabled",
execution_mode: executionMode,
entry_eligible: false,
discovery_only: true,
},
stages,
});
}

stages.regime_gate = await evaluateRegimeGate(
{
...safeSnapshot,
execution_mode: executionMode,
},
{
...safeConfig,
execution_mode: executionMode,
},
{
...safeContext,
execution_mode: executionMode,
action_type: "scout",
}
);

if (!stages.regime_gate?.passed) {
return buildBaseResult({
decision: SENTINEL_DECISION.WATCHLIST,
reason_codes:
stages.regime_gate.reasons || [REASON_CODE.REGIME_SCORE_TOO_LOW || "REGIME_SCORE_TOO_LOW"],
snapshot: buildSnapshotWithGateOverrides(
{
...safeSnapshot,
execution_mode: executionMode,
},
stages.regime_gate
),
position: null,
meta: {
halt_reason: "regime_gate",
execution_mode: executionMode,
entry_eligible: false,
discovery_only: true,
},
stages,
});
}

stages.scout = await evaluateScoutEntry(
{
...safeSnapshot,
execution_mode: executionMode,
},
{
...safeConfig,
execution_mode: executionMode,
},
{
...safeContext,
execution_mode: executionMode,
}
);

if (stages.scout?.allow) {
return buildBaseResult({
decision: SENTINEL_DECISION.SCOUT_ENTRY,
reason_codes:
stages.scout.reasons || [REASON_CODE.SCOUT_ENTRY_APPROVED || "SCOUT_ENTRY_APPROVED"],
size_usd: stages.scout.size_usd,
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: null,
meta: {
halt_reason: null,
execution_mode: executionMode,
entry_eligible: true,
discovery_only: false,
},
stages,
});
}

return buildBaseResult({
decision: SENTINEL_DECISION.WATCHLIST,
reason_codes: stages.scout?.reasons || [REASON_CODE.WATCHLIST_ONLY || "WATCHLIST_ONLY"],
size_usd: stages.scout?.size_usd ?? null,
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: null,
meta: {
halt_reason: "scout",
execution_mode: executionMode,
entry_eligible: false,
discovery_only: true,
},
stages,
});
}

if (isSafetyRejected(stages.hard_rejects, stages.critical_safety)) {
const reasons = combineSafetyReasons(stages.hard_rejects, stages.critical_safety);

return buildBaseResult({
decision: SENTINEL_DECISION.FULL_EXIT,
reason_codes: withInvalidationReason(
withFallbackReason(reasons, REASON_CODE.FULL_EXIT_EXECUTED || "FULL_EXIT_EXECUTED")
),
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: getSafetyMeta({
haltReason: "hard_rejects",
executionMode,
criticalSafety: stages.critical_safety,
hardRejects: stages.hard_rejects,
extra: {
invalidate: true,
exit_type: "invalidated",
risk_action: "unsafe_position_invalidation",
entry_eligible: false,
discovery_only: true,
},
}),
stages,
});
}

stages.exits = await evaluateEarlyExit(
{
...safeSnapshot,
execution_mode: executionMode,
},
safePosition,
{
...safeConfig,
execution_mode: executionMode,
},
{
...safeContext,
execution_mode: executionMode,
position_id: safePosition.id,
}
);

if (stages.exits?.exit) {
return buildBaseResult({
decision: SENTINEL_DECISION.FULL_EXIT,
reason_codes:
stages.exits.reasons || [REASON_CODE.FULL_EXIT_EXECUTED || "FULL_EXIT_EXECUTED"],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: "exits",
execution_mode: executionMode,
invalidate: Boolean(stages.exits.invalidate),
exit_type: stages.exits?.meta?.exit_type || null,
entry_eligible: false,
discovery_only: true,
},
stages,
});
}

if (shouldAttemptTakeProfit(safePosition, safeSnapshot, safeConfig)) {
return buildBaseResult({
decision: SENTINEL_DECISION.PARTIAL_TAKE_PROFIT,
reason_codes: getTakeProfitReasonCodes(
safePosition,
safeSnapshot,
safeConfig
),
bank_fraction: Math.min(
1,
Math.max(0.01, toFloat(safeConfig.auto_bank_fraction, 0.5))
),
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: null,
execution_mode: executionMode,
entry_eligible: false,
discovery_only: false,
},
stages,
});
}

if (safePosition.has_banked_10x) {
if (!safeConfig.enable_runner_management) {
return buildBaseResult({
decision: SENTINEL_DECISION.HOLD,
reason_codes: [REASON_CODE.HOLD_POSITION || "HOLD_POSITION"],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: "runner_disabled",
execution_mode: executionMode,
entry_eligible: false,
discovery_only: false,
},
stages,
});
}

stages.runner = await evaluateRunnerExit(
{
...safeSnapshot,
execution_mode: executionMode,
},
safePosition,
{
...safeConfig,
execution_mode: executionMode,
},
{
...safeContext,
execution_mode: executionMode,
position_id: safePosition.id,
}
);

if (stages.runner?.exit) {
return buildBaseResult({
decision: SENTINEL_DECISION.FULL_EXIT,
reason_codes:
stages.runner.reasons || [REASON_CODE.RUNNER_EXIT_EXECUTED || "RUNNER_EXIT_EXECUTED"],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: "runner",
execution_mode: executionMode,
entry_eligible: false,
discovery_only: false,
},
stages,
});
}

return buildBaseResult({
decision: SENTINEL_DECISION.HOLD,
reason_codes: stages.runner?.reasons || [REASON_CODE.RUNNER_HEALTHY || "RUNNER_HEALTHY"],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: null,
execution_mode: executionMode,
entry_eligible: false,
discovery_only: false,
},
stages,
});
}

stages.operator_gate = await evaluateOperatorGate(
{
...safeSnapshot,
execution_mode: executionMode,
},
{
...safeConfig,
execution_mode: executionMode,
},
{
...safeContext,
execution_mode: executionMode,
}
);

if (!stages.operator_gate?.passed) {
return buildBaseResult({
decision: SENTINEL_DECISION.HOLD,
reason_codes: stages.operator_gate.reasons || [REASON_CODE.HOLD_POSITION || "HOLD_POSITION"],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: "operator_gate",
execution_mode: executionMode,
entry_eligible: false,
discovery_only: false,
},
stages,
});
}

if (!safeConfig.enable_sniper) {
return buildBaseResult({
decision: SENTINEL_DECISION.HOLD,
reason_codes: [REASON_CODE.HOLD_POSITION || "HOLD_POSITION"],
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: "sniper_disabled",
execution_mode: executionMode,
entry_eligible: false,
discovery_only: false,
},
stages,
});
}

stages.regime_gate = await evaluateRegimeGate(
{
...safeSnapshot,
execution_mode: executionMode,
},
{
...safeConfig,
execution_mode: executionMode,
},
{
...safeContext,
execution_mode: executionMode,
action_type: "sniper",
}
);

if (!stages.regime_gate?.passed) {
return buildBaseResult({
decision: SENTINEL_DECISION.HOLD,
reason_codes:
stages.regime_gate.reasons || [REASON_CODE.REGIME_SCORE_TOO_LOW || "REGIME_SCORE_TOO_LOW"],
snapshot: buildSnapshotWithGateOverrides(
{
...safeSnapshot,
execution_mode: executionMode,
},
stages.regime_gate
),
position: safePosition,
meta: {
halt_reason: "regime_gate",
execution_mode: executionMode,
entry_eligible: false,
discovery_only: false,
},
stages,
});
}

stages.sniper = await evaluateSniperAdd(
{
...safeSnapshot,
execution_mode: executionMode,
},
safePosition,
{
...safeConfig,
execution_mode: executionMode,
},
{
...safeContext,
execution_mode: executionMode,
position_id: safePosition.id,
}
);

if (stages.sniper?.allow) {
return buildBaseResult({
decision: SENTINEL_DECISION.SNIPER_ADD,
reason_codes:
stages.sniper.reasons || [REASON_CODE.SNIPER_ADD_APPROVED || "SNIPER_ADD_APPROVED"],
size_usd: stages.sniper.size_usd,
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: null,
execution_mode: executionMode,
entry_eligible: true,
discovery_only: false,
},
stages,
});
}

return buildBaseResult({
decision: SENTINEL_DECISION.HOLD,
reason_codes: stages.sniper?.reasons || [REASON_CODE.HOLD_POSITION || "HOLD_POSITION"],
size_usd: stages.sniper?.size_usd ?? null,
snapshot: {
...safeSnapshot,
execution_mode: executionMode,
},
position: safePosition,
meta: {
halt_reason: "sniper",
execution_mode: executionMode,
entry_eligible: false,
discovery_only: false,
},
stages,
});
}

export async function evaluateTokenDecision(
snapshot = {},
config = {},
context = {}
) {
return evaluateToken(snapshot, config, context);
}

export async function shouldRejectToken(
snapshot = {},
config = {},
context = {}
) {
const result = await evaluateToken(snapshot, config, context);
return result.decision === SENTINEL_DECISION.REJECT;
}

export async function shouldOpenScout(
snapshot = {},
config = {},
context = {}
) {
const result = await evaluateToken(snapshot, config, context);
return result.decision === SENTINEL_DECISION.SCOUT_ENTRY;
}

export async function shouldAddSniper(
snapshot = {},
config = {},
context = {}
) {
const result = await evaluateToken(snapshot, config, context);
return result.decision === SENTINEL_DECISION.SNIPER_ADD;
}

export async function shouldTakeProfit(
snapshot = {},
config = {},
context = {}
) {
const result = await evaluateToken(snapshot, config, context);
return result.decision === SENTINEL_DECISION.PARTIAL_TAKE_PROFIT;
}

export async function shouldExitPosition(
snapshot = {},
config = {},
context = {}
) {
const result = await evaluateToken(snapshot, config, context);
return result.decision === SENTINEL_DECISION.FULL_EXIT;
}

export function summarizeEvaluation(result = null) {
if (!result) {
return {
decision: SENTINEL_DECISION.WATCHLIST,
reason_codes: [],
size_usd: null,
bank_fraction: null,
halt_reason: null,
invalidate: false,
exit_type: null,
execution_mode: null,
entry_eligible: false,
discovery_only: false,
};
}

return {
decision: normalizeDecision(result.decision, SENTINEL_DECISION.WATCHLIST),
reason_codes: ensureReasonCodeArray(result.reason_codes || []),
size_usd:
result.size_usd == null ? null : Math.max(0, toFloat(result.size_usd, 0)),
bank_fraction:
result.bank_fraction == null
? null
: Math.min(1, Math.max(0, toFloat(result.bank_fraction, 0))),
halt_reason: cleanText(result?.meta?.halt_reason, 64) || null,
invalidate: Boolean(result?.meta?.invalidate),
exit_type: cleanText(result?.meta?.exit_type, 32) || null,
execution_mode: cleanText(result?.meta?.execution_mode, 64) || null,
entry_eligible: Boolean(result?.meta?.entry_eligible),
discovery_only: Boolean(result?.meta?.discovery_only),
};
}

export default {
SENTINEL_DECISION,
evaluateToken,
evaluateTokenDecision,
shouldRejectToken,
shouldOpenScout,
shouldAddSniper,
shouldTakeProfit,
shouldExitPosition,
summarizeEvaluation,
};