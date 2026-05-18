import { getEffectiveSentinelConfig, normalizeSentinelConfig } from "./config.js";
import { REASON_CODE, ensureReasonCodeArray } from "./reason-codes.js";

const CODE = {
TRANSFER_RESTRICTION_RISK:
REASON_CODE.TRANSFER_RESTRICTION_RISK || "TRANSFER_RESTRICTION_RISK",
HONEYPOT_RISK: REASON_CODE.HONEYPOT_RISK || "HONEYPOT_RISK",
LIQUIDITY_BREAK_RISK:
REASON_CODE.LIQUIDITY_BREAK_RISK || "LIQUIDITY_BREAK_RISK",
SPOOFED_VOLUME_RISK:
REASON_CODE.SPOOFED_VOLUME_RISK || "SPOOFED_VOLUME_RISK",
LOW_LIQUIDITY: REASON_CODE.LOW_LIQUIDITY || "LOW_LIQUIDITY",
WIDE_SPREAD: REASON_CODE.WIDE_SPREAD || "WIDE_SPREAD",
HIGH_PRICE_IMPACT:
REASON_CODE.HIGH_PRICE_IMPACT || "HIGH_PRICE_IMPACT",
TOP_HOLDER_TOO_CONCENTRATED:
REASON_CODE.TOP_HOLDER_TOO_CONCENTRATED ||
"TOP_HOLDER_TOO_CONCENTRATED",
TOP5_TOO_CONCENTRATED:
REASON_CODE.TOP5_TOO_CONCENTRATED || "TOP5_TOO_CONCENTRATED",
HIDDEN_CONTROL_TOO_HIGH:
REASON_CODE.HIDDEN_CONTROL_TOO_HIGH || "HIDDEN_CONTROL_TOO_HIGH",
CONTAMINATION_TOO_HIGH:
REASON_CODE.CONTAMINATION_TOO_HIGH || "CONTAMINATION_TOO_HIGH",
COORDINATION_RISK_TOO_HIGH:
REASON_CODE.COORDINATION_RISK_TOO_HIGH ||
"COORDINATION_RISK_TOO_HIGH",

MISSING_TOKEN_ID: REASON_CODE.MISSING_TOKEN_ID || "MISSING_TOKEN_ID",
MISSING_MARKET_DATA:
REASON_CODE.MISSING_MARKET_DATA || "MISSING_MARKET_DATA",
MISSING_PRICE_DATA:
REASON_CODE.MISSING_PRICE_DATA || "MISSING_PRICE_DATA",
MISSING_LIQUIDITY_DATA:
REASON_CODE.MISSING_LIQUIDITY_DATA || "MISSING_LIQUIDITY_DATA",
MISSING_HOLDER_CONCENTRATION:
REASON_CODE.MISSING_HOLDER_CONCENTRATION ||
"MISSING_HOLDER_CONCENTRATION",

ULTRA_LOW_LIQUIDITY:
REASON_CODE.ULTRA_LOW_LIQUIDITY || "ULTRA_LOW_LIQUIDITY",
MICROCAP_LIQUIDITY_TRAP:
REASON_CODE.MICROCAP_LIQUIDITY_TRAP || "MICROCAP_LIQUIDITY_TRAP",
CONCENTRATION_LIQUIDITY_TRAP:
REASON_CODE.CONCENTRATION_LIQUIDITY_TRAP ||
"CONCENTRATION_LIQUIDITY_TRAP",
EXTREME_TOP5_CONCENTRATION:
REASON_CODE.EXTREME_TOP5_CONCENTRATION ||
"EXTREME_TOP5_CONCENTRATION",
EXTREME_TOP_HOLDER_CONCENTRATION:
REASON_CODE.EXTREME_TOP_HOLDER_CONCENTRATION ||
"EXTREME_TOP_HOLDER_CONCENTRATION",
CRITICAL_TOP5_SUPPLY_CONTROL:
REASON_CODE.CRITICAL_TOP5_SUPPLY_CONTROL ||
"CRITICAL_TOP5_SUPPLY_CONTROL",

INSIDER_SELL_RISK:
REASON_CODE.INSIDER_SELL_RISK || "INSIDER_SELL_RISK",
LIQUIDITY_DECAY_RISK:
REASON_CODE.LIQUIDITY_DECAY_RISK || "LIQUIDITY_DECAY_RISK",
VERTICAL_EXTENSION_RISK:
REASON_CODE.VERTICAL_EXTENSION_RISK || "VERTICAL_EXTENSION_RISK",
REPEATED_BREAKOUT_FAILURE:
REASON_CODE.REPEATED_BREAKOUT_FAILURE || "REPEATED_BREAKOUT_FAILURE",
OPERATOR_QUALITY_TOO_LOW:
REASON_CODE.OPERATOR_QUALITY_TOO_LOW || "OPERATOR_QUALITY_TOO_LOW",
STRUCTURAL_HEALTH_TOO_LOW:
REASON_CODE.STRUCTURAL_HEALTH_TOO_LOW || "STRUCTURAL_HEALTH_TOO_LOW",
};

const HARD_REJECT_REASON_SET = new Set(Object.values(CODE));

const DEFAULT_STRICT_THRESHOLDS = {
transfer_restriction_risk_gte: 80,
honeypot_risk_gte: 80,
liquidity_break_risk_gte: 80,
spoofed_volume_risk_gte: 75,

min_liquidity_usd_floor: 25,
ultra_low_liquidity_usd_lte: 5,
microcap_liquidity_trap_liquidity_usd_lte: 25,
microcap_liquidity_trap_marketcap_usd_lte: 5000,

max_top_holder_pct_ceiling: 35,
max_top_5_holder_pct_ceiling: 65,
extreme_top_holder_pct_gte: 50,
extreme_top_5_holder_pct_gte: 80,
critical_top_5_holder_pct_gte: 90,

max_hidden_control_risk_ceiling: 45,
max_contamination_risk_ceiling: 45,
max_wallet_coordination_risk_ceiling: 45,

insider_sell_score_gte: 45,
liquidity_decay_score_gte: 60,
vertical_extension_score_gte: 85,
failed_breakout_count_gte: 3,

min_operator_quality_score_floor: 35,
min_structural_health_score_floor: 20,
};

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

function normalizeNullableCount(value) {
const num = firstFiniteNumber(value);
if (num == null) return null;
return Math.max(0, Math.floor(num));
}

function pickNested(source, path) {
if (!source || typeof source !== "object") return undefined;

return String(path || "")
.split(".")
.filter(Boolean)
.reduce((acc, key) => (acc == null ? undefined : acc[key]), source);
}

function firstPathNumber(source, paths = []) {
for (const path of paths) {
const value = pickNested(source, path);
const parsed = firstFiniteNumber(value);
if (parsed != null) return parsed;
}
return null;
}

function isOpenPositionContext(snapshot = {}) {
return Boolean(
snapshot.has_live_position_context ||
snapshot.position_id ||
snapshot.position_stage ||
snapshot.raw?.open_position?.id
);
}

function normalizeSnapshot(snapshot = {}) {
const tokenId = firstNonEmpty(
snapshot.token_id,
snapshot.tokenId,
snapshot.mint_address,
snapshot.mintAddress,
snapshot.mint,
snapshot.address
);

const mintAddress = firstNonEmpty(
snapshot.mint_address,
snapshot.mintAddress,
snapshot.mint,
snapshot.address,
snapshot.token_id,
snapshot.tokenId
);

const executionMode =
resolveExecutionMode(
snapshot.execution_mode,
snapshot.executionMode,
snapshot.mode
) || null;

const priceUsd = firstFiniteNumber(
snapshot.price_usd,
snapshot.priceUsd,
snapshot.current_price_usd,
snapshot.currentPriceUsd,
snapshot.current_price,
snapshot.currentPrice,
snapshot.market?.price_usd,
snapshot.market?.priceUsd,
snapshot.market?.current_price_usd,
snapshot.market?.currentPriceUsd,
snapshot.market?.current_price,
snapshot.market?.currentPrice,
snapshot.market?.price?.usd,
snapshot.market?.usd?.price,
snapshot.raw?.price_usd,
snapshot.raw?.priceUsd,
snapshot.raw?.market?.price_usd,
snapshot.raw?.market?.priceUsd
);

const liquidityUsd = firstFiniteNumber(
snapshot.liquidity_usd,
snapshot.liquidityUsd,
snapshot.liq_usd,
snapshot.liqUsd,
snapshot.market_liquidity_usd,
snapshot.marketLiquidityUsd,
snapshot.market?.liquidity_usd,
snapshot.market?.liquidityUsd,
snapshot.market?.liquidity?.usd,
snapshot.liquidity?.usd,
snapshot.raw?.liquidity_usd,
snapshot.raw?.liquidityUsd,
snapshot.raw?.market?.liquidity_usd,
snapshot.raw?.market?.liquidityUsd,
snapshot.raw?.market?.liquidity?.usd
);

const marketcapUsd = firstFiniteNumber(
snapshot.marketcap_usd,
snapshot.marketcapUsd,
snapshot.market_cap_usd,
snapshot.marketCapUsd,
snapshot.mcap_usd,
snapshot.mcapUsd,
snapshot.fdv_usd,
snapshot.fdvUsd,
snapshot.fdv,
snapshot.market?.marketcap_usd,
snapshot.market?.marketcapUsd,
snapshot.market?.market_cap_usd,
snapshot.market?.marketCapUsd,
snapshot.market?.mcap_usd,
snapshot.market?.mcapUsd,
snapshot.market?.fdv_usd,
snapshot.market?.fdvUsd,
snapshot.market?.fdv,
snapshot.raw?.marketcap_usd,
snapshot.raw?.marketcapUsd,
snapshot.raw?.market?.marketcap_usd,
snapshot.raw?.market?.marketcapUsd,
snapshot.raw?.market?.fdv
);

const spreadBps = firstFiniteNumber(
snapshot.spread_bps,
snapshot.spreadBps,
snapshot.market?.spread_bps,
snapshot.market?.spreadBps,
snapshot.raw?.spread_bps,
snapshot.raw?.spreadBps,
snapshot.raw?.market?.spread_bps,
snapshot.raw?.market?.spreadBps
);

const priceImpactBps = firstFiniteNumber(
snapshot.price_impact_bps,
snapshot.priceImpactBps,
snapshot.market?.price_impact_bps,
snapshot.market?.priceImpactBps,
snapshot.raw?.price_impact_bps,
snapshot.raw?.priceImpactBps,
snapshot.raw?.market?.price_impact_bps,
snapshot.raw?.market?.priceImpactBps
);

const topHolderPct = firstFiniteNumber(
snapshot.top_holder_pct,
snapshot.topHolderPct,
snapshot.top1_holder_pct,
snapshot.top1HolderPct,
snapshot.top1_pct,
snapshot.top1Pct,
snapshot.concentration?.top1,
snapshot.concentration?.top1_pct,
snapshot.holders?.top1,
snapshot.holders?.top1_pct,
snapshot.securityModel?.holderConcentration?.top1,
snapshot.securityModel?.holder_concentration?.top1
);

const top5HolderPct = firstFiniteNumber(
snapshot.top_5_holder_pct,
snapshot.top5_holder_pct,
snapshot.top5HolderPct,
snapshot.top5_pct,
snapshot.top5Pct,
snapshot.concentration?.top5,
snapshot.concentration?.top5_pct,
snapshot.holders?.top5,
snapshot.holders?.top5_pct,
snapshot.securityModel?.holderConcentration?.top5,
snapshot.securityModel?.holder_concentration?.top5
);

const top10HolderPct = firstFiniteNumber(
snapshot.top_10_holder_pct,
snapshot.top10_holder_pct,
snapshot.top10HolderPct,
snapshot.top10_pct,
snapshot.top10Pct,
snapshot.concentration?.top10,
snapshot.concentration?.top10_pct,
snapshot.holders?.top10,
snapshot.holders?.top10_pct
);

const transferRestrictionRisk = firstFiniteNumber(
snapshot.transfer_restriction_risk,
snapshot.transferRestrictionRisk,
snapshot.transfer_restriction_score,
snapshot.transferRestrictionScore,
snapshot.token?.transfer_restriction_risk,
snapshot.securityModel?.transferRestrictionRisk?.score,
snapshot.securityModel?.transferRestriction?.score,
snapshot.securityModel?.transfer_restriction_risk,
snapshot.securityModel?.transfer_restriction?.score
);

const honeypotRisk = firstFiniteNumber(
snapshot.honeypot_risk,
snapshot.honeypotRisk,
snapshot.honeypot_score,
snapshot.honeypotScore,
snapshot.token?.honeypot_risk,
snapshot.securityModel?.honeypotRisk?.score,
snapshot.securityModel?.honeypot?.score,
snapshot.securityModel?.honeypot_risk
);

const liquidityBreakRisk = firstFiniteNumber(
snapshot.liquidity_break_risk,
snapshot.liquidityBreakRisk,
snapshot.liquidity_break_score,
snapshot.liquidityBreakScore,
snapshot.securityModel?.liquidityBreakRisk?.score,
snapshot.securityModel?.liquidity_break_risk,
snapshot.securityModel?.liquidityStability?.score != null
? 100 - Number(snapshot.securityModel.liquidityStability.score)
: null,
snapshot.securityModel?.liquidity_stability?.score != null
? 100 - Number(snapshot.securityModel.liquidity_stability.score)
: null
);

const spoofedVolumeRisk = firstFiniteNumber(
snapshot.spoofed_volume_risk,
snapshot.spoofedVolumeRisk,
snapshot.spoofed_volume_score,
snapshot.spoofedVolumeScore,
snapshot.wash_trading_risk,
snapshot.washTradingRisk,
snapshot.securityModel?.spoofedVolumeRisk?.score,
snapshot.securityModel?.spoofed_volume_risk,
snapshot.securityModel?.washTradingRisk?.score,
snapshot.securityModel?.wash_trading_risk
);

const hiddenControlRisk = firstFiniteNumber(
snapshot.hidden_control_risk,
snapshot.hiddenControlRisk,
snapshot.hidden_control_score,
snapshot.hiddenControlScore,
snapshot.hidden_control?.score,
snapshot.securityModel?.hiddenControl?.score,
snapshot.securityModel?.hidden_control?.score,
snapshot.securityModel?.hidden_control_risk
);

const contaminationRisk = firstFiniteNumber(
snapshot.contamination_risk,
snapshot.contaminationRisk,
snapshot.contamination_score,
snapshot.contaminationScore,
snapshot.contamination?.score,
snapshot.securityModel?.contaminationRisk?.score,
snapshot.securityModel?.contamination?.score,
snapshot.securityModel?.contamination_risk
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
snapshot.securityModel?.wallet_network?.risk_score,
snapshot.activity?.coordinationRisk,
snapshot.activity?.coordination_risk,
snapshot.activity?.score
);

const insiderSellScore = firstFiniteNumber(
snapshot.insider_sell_score,
snapshot.insiderSellScore,
snapshot.dev_sell_score,
snapshot.devSellScore,
snapshot.operator_sell_score,
snapshot.operatorSellScore,
snapshot.activity?.insiderSellScore,
snapshot.activity?.insider_sell_score,
snapshot.securityModel?.insiderSellRisk?.score,
snapshot.securityModel?.insider_sell_risk,
snapshot.securityModel?.devSellRisk?.score
);

const liquidityDecayScore = firstFiniteNumber(
snapshot.liquidity_decay_score,
snapshot.liquidityDecayScore,
snapshot.lp_decay_score,
snapshot.lpDecayScore,
snapshot.liquidity?.decay_score,
snapshot.market?.liquidity_decay_score,
snapshot.market?.liquidityDecayScore,
snapshot.securityModel?.liquidityDecayRisk?.score,
snapshot.securityModel?.liquidity_decay_risk
);

const verticalExtensionScore = firstFiniteNumber(
snapshot.vertical_extension_score,
snapshot.verticalExtensionScore,
snapshot.parabolic_extension_score,
snapshot.parabolicExtensionScore,
snapshot.trend?.verticalExtensionScore,
snapshot.trend?.vertical_extension_score,
snapshot.securityModel?.verticalExtensionRisk?.score
);

const operatorQualityScore = firstFiniteNumber(
snapshot.operator_quality_score,
snapshot.operatorQualityScore,
snapshot.operator_score,
snapshot.operatorScore,
snapshot.securityModel?.operatorQuality?.score,
snapshot.securityModel?.operator_quality?.score
);

const structuralHealthScore = firstFiniteNumber(
snapshot.structural_health_score,
snapshot.structuralHealthScore,
snapshot.health_score,
snapshot.healthScore,
snapshot.securityModel?.structuralHealth?.score,
snapshot.securityModel?.structural_health?.score
);

const failedBreakoutCount = firstFiniteNumber(
snapshot.failed_breakout_count,
snapshot.failedBreakoutCount,
snapshot.trend?.failed_breakout_count,
snapshot.trend?.failedBreakoutCount
);

const barsSinceLaunch = firstFiniteNumber(
snapshot.bars_since_launch,
snapshot.barsSinceLaunch,
snapshot.age_bars,
snapshot.ageBars
);

const barsSinceLocalLow = firstFiniteNumber(
snapshot.bars_since_local_low,
snapshot.barsSinceLocalLow
);

const recentVolumeUsd = firstPathNumber(snapshot, [
"recent_volume_usd",
"recentVolumeUsd",
"volume_usd",
"volumeUsd",
"market.volume_usd",
"market.volumeUsd",
"market.volume.h24",
"market.volume24h",
"raw.market.volume_usd",
"raw.market.volumeUsd",
]);

const volumeAnomalyScore = firstPathNumber(snapshot, [
"volume_anomaly_score",
"volumeAnomalyScore",
"unusual_volume_score",
"unusualVolumeScore",
"trend.volume_anomaly_score",
"trend.volumeAnomalyScore",
"activity.volume_anomaly_score",
"activity.volumeAnomalyScore",
]);

return {
...snapshot,
token_id: tokenId || mintAddress || "",
mint_address: mintAddress || tokenId || "",
execution_mode: executionMode,

price_usd: normalizeNullableMin(priceUsd),
current_price_usd: normalizeNullableMin(priceUsd),

marketcap_usd: normalizeNullableMin(marketcapUsd),
liquidity_usd: normalizeNullableMin(liquidityUsd),
spread_bps: normalizeNullableMin(spreadBps),
price_impact_bps: normalizeNullableMin(priceImpactBps),

top_holder_pct: normalizeNullableScore(topHolderPct),
top_5_holder_pct: normalizeNullableScore(top5HolderPct),
top_10_holder_pct: normalizeNullableScore(top10HolderPct),

transfer_restriction_risk: normalizeNullableScore(transferRestrictionRisk),
honeypot_risk: normalizeNullableScore(honeypotRisk),
liquidity_break_risk: normalizeNullableScore(liquidityBreakRisk),
spoofed_volume_risk: normalizeNullableScore(spoofedVolumeRisk),

hidden_control_risk: normalizeNullableScore(hiddenControlRisk),
contamination_risk: normalizeNullableScore(contaminationRisk),
wallet_coordination_risk: normalizeNullableScore(walletCoordinationRisk),
insider_sell_score: normalizeNullableScore(insiderSellScore),
liquidity_decay_score: normalizeNullableScore(liquidityDecayScore),
vertical_extension_score: normalizeNullableScore(verticalExtensionScore),

operator_quality_score: normalizeNullableScore(operatorQualityScore),
structural_health_score: normalizeNullableScore(structuralHealthScore),

bars_since_launch: normalizeNullableMin(barsSinceLaunch),
bars_since_local_low: normalizeNullableMin(barsSinceLocalLow),
failed_breakout_count: normalizeNullableCount(failedBreakoutCount),

recent_volume_usd: normalizeNullableMin(recentVolumeUsd),
volume_anomaly_score: normalizeNullableScore(volumeAnomalyScore),
open_position_context: isOpenPositionContext(snapshot),
};
}

function buildCheck({
code,
actual = null,
threshold = null,
comparator = "exists",
enabled = true,
triggered = false,
missing = false,
severity = "hard",
note = null,
}) {
return {
code,
actual,
threshold,
comparator,
enabled: Boolean(enabled),
triggered: Boolean(triggered),
rejected: Boolean(enabled && triggered && severity === "hard"),
advisory: Boolean((!enabled && triggered) || (triggered && severity !== "hard")),
missing: Boolean(missing),
severity,
note,
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

function lessThanOrEqual(actual, threshold) {
return actual != null && threshold != null && actual <= threshold;
}

function safeThreshold(value, fallback) {
const num = firstFiniteNumber(value);
return num == null ? fallback : num;
}

function minPositiveThreshold(value, floor) {
const num = firstFiniteNumber(value);
if (num == null || num <= 0) return floor;
return Math.max(num, floor);
}

function maxStrictThreshold(value, ceiling) {
const num = firstFiniteNumber(value);
if (num == null || num <= 0) return ceiling;
return Math.min(num, ceiling);
}

function evaluateIdentityChecks(snapshot) {
return [
buildCheck({
code: CODE.MISSING_TOKEN_ID,
actual: snapshot.token_id || snapshot.mint_address || null,
threshold: "required",
comparator: "exists",
enabled: true,
triggered: !snapshot.token_id && !snapshot.mint_address,
missing: true,
note: "No token identifier was present on the Sentinel snapshot.",
}),
];
}

function evaluateMissingDataChecks(snapshot, thresholds) {
const positionContext = Boolean(snapshot.open_position_context);

return [
buildCheck({
code: CODE.MISSING_MARKET_DATA,
actual:
snapshot.marketcap_usd == null && snapshot.liquidity_usd == null
? null
: "present",
threshold: "marketcap_or_liquidity_required",
comparator: "exists",
enabled: Boolean(thresholds.reject_missing_market_data && !positionContext),
triggered: snapshot.marketcap_usd == null && snapshot.liquidity_usd == null,
missing: true,
severity: positionContext ? "advisory" : "hard",
note: "Market data is missing, so Sentinel cannot safely price or risk-rank the token.",
}),
buildCheck({
code: CODE.MISSING_PRICE_DATA,
actual: snapshot.price_usd,
threshold: "required",
comparator: "exists",
enabled: Boolean(thresholds.reject_missing_price_data && !positionContext),
triggered: snapshot.price_usd == null,
missing: true,
severity: positionContext ? "advisory" : "hard",
note: "Price is missing, so Sentinel cannot calculate sane entry size or PnL.",
}),
buildCheck({
code: CODE.MISSING_LIQUIDITY_DATA,
actual: snapshot.liquidity_usd,
threshold: "required",
comparator: "exists",
enabled: Boolean(thresholds.reject_missing_liquidity_data && !positionContext),
triggered: snapshot.liquidity_usd == null,
missing: true,
severity: positionContext ? "advisory" : "hard",
note: "Liquidity is missing, so Sentinel cannot assess exit quality.",
}),
buildCheck({
code: CODE.MISSING_HOLDER_CONCENTRATION,
actual:
snapshot.top_holder_pct == null && snapshot.top_5_holder_pct == null
? null
: "present",
threshold: "top_holder_or_top5_required",
comparator: "exists",
enabled: Boolean(thresholds.reject_missing_holder_data && !positionContext),
triggered: snapshot.top_holder_pct == null && snapshot.top_5_holder_pct == null,
missing: true,
severity: positionContext ? "advisory" : "hard",
note: "Holder concentration is missing, so Sentinel cannot detect supply-control risk.",
}),
];
}

function evaluateRiskChecks(snapshot, thresholds) {
return [
buildCheck({
code: CODE.TRANSFER_RESTRICTION_RISK,
actual: snapshot.transfer_restriction_risk,
threshold: thresholds.transfer_restriction_risk_gte,
comparator: ">=",
enabled: true,
triggered: greaterThanOrEqual(
snapshot.transfer_restriction_risk,
thresholds.transfer_restriction_risk_gte
),
missing: snapshot.transfer_restriction_risk == null,
}),
buildCheck({
code: CODE.HONEYPOT_RISK,
actual: snapshot.honeypot_risk,
threshold: thresholds.honeypot_risk_gte,
comparator: ">=",
enabled: true,
triggered: greaterThanOrEqual(snapshot.honeypot_risk, thresholds.honeypot_risk_gte),
missing: snapshot.honeypot_risk == null,
}),
buildCheck({
code: CODE.LIQUIDITY_BREAK_RISK,
actual: snapshot.liquidity_break_risk,
threshold: thresholds.liquidity_break_risk_gte,
comparator: ">=",
enabled: true,
triggered: greaterThanOrEqual(
snapshot.liquidity_break_risk,
thresholds.liquidity_break_risk_gte
),
missing: snapshot.liquidity_break_risk == null,
}),
buildCheck({
code: CODE.SPOOFED_VOLUME_RISK,
actual: snapshot.spoofed_volume_risk,
threshold: thresholds.spoofed_volume_risk_gte,
comparator: ">=",
enabled: true,
triggered: greaterThanOrEqual(
snapshot.spoofed_volume_risk,
thresholds.spoofed_volume_risk_gte
),
missing: snapshot.spoofed_volume_risk == null,
}),
];
}

function evaluateLiquidityChecks(snapshot, thresholds) {
return [
buildCheck({
code: CODE.LOW_LIQUIDITY,
actual: snapshot.liquidity_usd,
threshold: thresholds.min_liquidity_usd,
comparator: "<",
enabled: Boolean(thresholds.enable_liquidity_checks),
triggered: lessThan(snapshot.liquidity_usd, thresholds.min_liquidity_usd),
missing: snapshot.liquidity_usd == null,
}),
buildCheck({
code: CODE.ULTRA_LOW_LIQUIDITY,
actual: snapshot.liquidity_usd,
threshold: thresholds.ultra_low_liquidity_usd_lte,
comparator: "<=",
enabled: true,
triggered: lessThanOrEqual(
snapshot.liquidity_usd,
thresholds.ultra_low_liquidity_usd_lte
),
missing: snapshot.liquidity_usd == null,
note: "Ultra-low liquidity is blocked even in paper mode because it creates fake fills and misleading PnL.",
}),
buildCheck({
code: CODE.WIDE_SPREAD,
actual: snapshot.spread_bps,
threshold: thresholds.max_spread_bps,
comparator: ">",
enabled: Boolean(thresholds.enable_liquidity_checks),
triggered: greaterThan(snapshot.spread_bps, thresholds.max_spread_bps),
missing: snapshot.spread_bps == null,
}),
buildCheck({
code: CODE.HIGH_PRICE_IMPACT,
actual: snapshot.price_impact_bps,
threshold: thresholds.max_price_impact_bps,
comparator: ">",
enabled: Boolean(thresholds.enable_liquidity_checks),
triggered: greaterThan(snapshot.price_impact_bps, thresholds.max_price_impact_bps),
missing: snapshot.price_impact_bps == null,
}),
];
}

function evaluateHolderChecks(snapshot, thresholds) {
return [
buildCheck({
code: CODE.TOP_HOLDER_TOO_CONCENTRATED,
actual: snapshot.top_holder_pct,
threshold: thresholds.max_top_holder_pct,
comparator: ">",
enabled: Boolean(thresholds.enable_holder_checks),
triggered: greaterThan(snapshot.top_holder_pct, thresholds.max_top_holder_pct),
missing: snapshot.top_holder_pct == null,
}),
buildCheck({
code: CODE.TOP5_TOO_CONCENTRATED,
actual: snapshot.top_5_holder_pct,
threshold: thresholds.max_top_5_holder_pct,
comparator: ">",
enabled: Boolean(thresholds.enable_holder_checks),
triggered: greaterThan(snapshot.top_5_holder_pct, thresholds.max_top_5_holder_pct),
missing: snapshot.top_5_holder_pct == null,
}),
buildCheck({
code: CODE.EXTREME_TOP_HOLDER_CONCENTRATION,
actual: snapshot.top_holder_pct,
threshold: thresholds.extreme_top_holder_pct_gte,
comparator: ">=",
enabled: true,
triggered: greaterThanOrEqual(
snapshot.top_holder_pct,
thresholds.extreme_top_holder_pct_gte
),
missing: snapshot.top_holder_pct == null,
note: "Extreme single-holder concentration is blocked regardless of mode.",
}),
buildCheck({
code: CODE.EXTREME_TOP5_CONCENTRATION,
actual: snapshot.top_5_holder_pct,
threshold: thresholds.extreme_top_5_holder_pct_gte,
comparator: ">=",
enabled: true,
triggered: greaterThanOrEqual(
snapshot.top_5_holder_pct,
thresholds.extreme_top_5_holder_pct_gte
),
missing: snapshot.top_5_holder_pct == null,
note: "Extreme top-5 concentration is blocked regardless of mode.",
}),
buildCheck({
code: CODE.CRITICAL_TOP5_SUPPLY_CONTROL,
actual: snapshot.top_5_holder_pct,
threshold: thresholds.critical_top_5_holder_pct_gte,
comparator: ">=",
enabled: true,
triggered: greaterThanOrEqual(
snapshot.top_5_holder_pct,
thresholds.critical_top_5_holder_pct_gte
),
missing: snapshot.top_5_holder_pct == null,
note: "Critical top-5 supply control is treated as a hard supply-control reject.",
}),
];
}

function evaluateControlChecks(snapshot, thresholds) {
return [
buildCheck({
code: CODE.HIDDEN_CONTROL_TOO_HIGH,
actual: snapshot.hidden_control_risk,
threshold: thresholds.max_hidden_control_risk,
comparator: ">",
enabled: true,
triggered: greaterThan(snapshot.hidden_control_risk, thresholds.max_hidden_control_risk),
missing: snapshot.hidden_control_risk == null,
}),
buildCheck({
code: CODE.CONTAMINATION_TOO_HIGH,
actual: snapshot.contamination_risk,
threshold: thresholds.max_contamination_risk,
comparator: ">",
enabled: true,
triggered: greaterThan(snapshot.contamination_risk, thresholds.max_contamination_risk),
missing: snapshot.contamination_risk == null,
}),
buildCheck({
code: CODE.COORDINATION_RISK_TOO_HIGH,
actual: snapshot.wallet_coordination_risk,
threshold: thresholds.max_wallet_coordination_risk,
comparator: ">",
enabled: true,
triggered: greaterThan(
snapshot.wallet_coordination_risk,
thresholds.max_wallet_coordination_risk
),
missing: snapshot.wallet_coordination_risk == null,
}),
];
}

function evaluateManipulationChecks(snapshot, thresholds) {
const concentrationLiquidityTrap =
(snapshot.top_5_holder_pct != null &&
snapshot.top_5_holder_pct >= thresholds.concentration_liquidity_trap_top5_gte &&
snapshot.liquidity_usd != null &&
snapshot.liquidity_usd <= thresholds.concentration_liquidity_trap_liquidity_lte) ||
(snapshot.top_holder_pct != null &&
snapshot.top_holder_pct >= thresholds.concentration_liquidity_trap_top1_gte &&
snapshot.liquidity_usd != null &&
snapshot.liquidity_usd <= thresholds.concentration_liquidity_trap_liquidity_lte);

const microcapLiquidityTrap =
snapshot.liquidity_usd != null &&
snapshot.marketcap_usd != null &&
snapshot.liquidity_usd <= thresholds.microcap_liquidity_trap_liquidity_usd_lte &&
snapshot.marketcap_usd <= thresholds.microcap_liquidity_trap_marketcap_usd_lte;

return [
buildCheck({
code: CODE.CONCENTRATION_LIQUIDITY_TRAP,
actual: {
top_holder_pct: snapshot.top_holder_pct,
top_5_holder_pct: snapshot.top_5_holder_pct,
liquidity_usd: snapshot.liquidity_usd,
},
threshold: {
top1_gte: thresholds.concentration_liquidity_trap_top1_gte,
top5_gte: thresholds.concentration_liquidity_trap_top5_gte,
liquidity_lte: thresholds.concentration_liquidity_trap_liquidity_lte,
},
comparator: "combined",
enabled: true,
triggered: concentrationLiquidityTrap,
missing:
snapshot.liquidity_usd == null ||
(snapshot.top_holder_pct == null && snapshot.top_5_holder_pct == null),
note: "High concentration combined with weak liquidity is treated as a manipulation trap.",
}),
buildCheck({
code: CODE.MICROCAP_LIQUIDITY_TRAP,
actual: {
marketcap_usd: snapshot.marketcap_usd,
liquidity_usd: snapshot.liquidity_usd,
},
threshold: {
marketcap_lte: thresholds.microcap_liquidity_trap_marketcap_usd_lte,
liquidity_lte: thresholds.microcap_liquidity_trap_liquidity_usd_lte,
},
comparator: "combined",
enabled: true,
triggered: microcapLiquidityTrap,
missing: snapshot.marketcap_usd == null || snapshot.liquidity_usd == null,
note: "Tiny market cap plus tiny liquidity can create fake paper wins and impossible exits.",
}),
buildCheck({
code: CODE.INSIDER_SELL_RISK,
actual: snapshot.insider_sell_score,
threshold: thresholds.insider_sell_score_gte,
comparator: ">=",
enabled: true,
triggered: greaterThanOrEqual(
snapshot.insider_sell_score,
thresholds.insider_sell_score_gte
),
missing: snapshot.insider_sell_score == null,
}),
buildCheck({
code: CODE.LIQUIDITY_DECAY_RISK,
actual: snapshot.liquidity_decay_score,
threshold: thresholds.liquidity_decay_score_gte,
comparator: ">=",
enabled: true,
triggered: greaterThanOrEqual(
snapshot.liquidity_decay_score,
thresholds.liquidity_decay_score_gte
),
missing: snapshot.liquidity_decay_score == null,
}),
buildCheck({
code: CODE.VERTICAL_EXTENSION_RISK,
actual: snapshot.vertical_extension_score,
threshold: thresholds.vertical_extension_score_gte,
comparator: ">=",
enabled: true,
triggered: greaterThanOrEqual(
snapshot.vertical_extension_score,
thresholds.vertical_extension_score_gte
),
missing: snapshot.vertical_extension_score == null,
}),
buildCheck({
code: CODE.REPEATED_BREAKOUT_FAILURE,
actual: snapshot.failed_breakout_count,
threshold: thresholds.failed_breakout_count_gte,
comparator: ">=",
enabled: true,
triggered: greaterThanOrEqual(
snapshot.failed_breakout_count,
thresholds.failed_breakout_count_gte
),
missing: snapshot.failed_breakout_count == null,
}),
buildCheck({
code: CODE.OPERATOR_QUALITY_TOO_LOW,
actual: snapshot.operator_quality_score,
threshold: thresholds.min_operator_quality_score,
comparator: "<",
enabled: true,
triggered: lessThan(
snapshot.operator_quality_score,
thresholds.min_operator_quality_score
),
missing: snapshot.operator_quality_score == null,
}),
buildCheck({
code: CODE.STRUCTURAL_HEALTH_TOO_LOW,
actual: snapshot.structural_health_score,
threshold: thresholds.min_structural_health_score,
comparator: "<",
enabled: true,
triggered: lessThan(
snapshot.structural_health_score,
thresholds.min_structural_health_score
),
missing: snapshot.structural_health_score == null,
}),
];
}

function collectRejectedReasons(allChecks = []) {
return Array.from(
new Set(allChecks.filter((check) => check.rejected).map((check) => check.code))
);
}

function collectAdvisoryReasons(allChecks = []) {
return Array.from(
new Set(allChecks.filter((check) => check.advisory).map((check) => check.code))
);
}

function collectMissingMetrics(allChecks = []) {
return Array.from(
new Set(
allChecks
.filter((check) => check.enabled && check.missing)
.map((check) => check.code)
)
);
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

const executionMode = runtimeExecutionMode || safe.execution_mode || "paper";

const minLiquidityUsd = minPositiveThreshold(
safe.min_liquidity_usd,
DEFAULT_STRICT_THRESHOLDS.min_liquidity_usd_floor
);

const maxTopHolderPct = maxStrictThreshold(
safe.max_top_holder_pct,
DEFAULT_STRICT_THRESHOLDS.max_top_holder_pct_ceiling
);

const maxTop5HolderPct = maxStrictThreshold(
safe.max_top_5_holder_pct,
DEFAULT_STRICT_THRESHOLDS.max_top_5_holder_pct_ceiling
);

const maxHiddenControlRisk = maxStrictThreshold(
safe.max_hidden_control_risk,
DEFAULT_STRICT_THRESHOLDS.max_hidden_control_risk_ceiling
);

const maxContaminationRisk = maxStrictThreshold(
safe.max_contamination_risk,
DEFAULT_STRICT_THRESHOLDS.max_contamination_risk_ceiling
);

const maxWalletCoordinationRisk = maxStrictThreshold(
safe.max_wallet_coordination_risk,
DEFAULT_STRICT_THRESHOLDS.max_wallet_coordination_risk_ceiling
);

return {
execution_mode: executionMode,
paper_mode_relaxed: false,

transfer_restriction_risk_gte: safeThreshold(
safe.transfer_restriction_risk_gte,
DEFAULT_STRICT_THRESHOLDS.transfer_restriction_risk_gte
),
honeypot_risk_gte: safeThreshold(
safe.honeypot_risk_gte,
DEFAULT_STRICT_THRESHOLDS.honeypot_risk_gte
),
liquidity_break_risk_gte: safeThreshold(
safe.liquidity_break_risk_gte,
DEFAULT_STRICT_THRESHOLDS.liquidity_break_risk_gte
),
spoofed_volume_risk_gte: safeThreshold(
safe.spoofed_volume_risk_gte,
DEFAULT_STRICT_THRESHOLDS.spoofed_volume_risk_gte
),

min_liquidity_usd: minLiquidityUsd,
ultra_low_liquidity_usd_lte:
DEFAULT_STRICT_THRESHOLDS.ultra_low_liquidity_usd_lte,
max_spread_bps: minPositiveThreshold(safe.max_spread_bps, 350),
max_price_impact_bps: minPositiveThreshold(safe.max_price_impact_bps, 500),

max_top_holder_pct: maxTopHolderPct,
max_top_5_holder_pct: maxTop5HolderPct,
extreme_top_holder_pct_gte:
DEFAULT_STRICT_THRESHOLDS.extreme_top_holder_pct_gte,
extreme_top_5_holder_pct_gte:
DEFAULT_STRICT_THRESHOLDS.extreme_top_5_holder_pct_gte,
critical_top_5_holder_pct_gte:
DEFAULT_STRICT_THRESHOLDS.critical_top_5_holder_pct_gte,

max_hidden_control_risk: maxHiddenControlRisk,
max_contamination_risk: maxContaminationRisk,
max_wallet_coordination_risk: maxWalletCoordinationRisk,

concentration_liquidity_trap_top1_gte: 35,
concentration_liquidity_trap_top5_gte: 65,
concentration_liquidity_trap_liquidity_lte: Math.max(
100,
minLiquidityUsd
),

microcap_liquidity_trap_liquidity_usd_lte:
DEFAULT_STRICT_THRESHOLDS.microcap_liquidity_trap_liquidity_usd_lte,
microcap_liquidity_trap_marketcap_usd_lte:
DEFAULT_STRICT_THRESHOLDS.microcap_liquidity_trap_marketcap_usd_lte,

insider_sell_score_gte: maxStrictThreshold(
safe.max_insider_sell_score,
DEFAULT_STRICT_THRESHOLDS.insider_sell_score_gte
),
liquidity_decay_score_gte: maxStrictThreshold(
safe.max_liquidity_decay_score,
DEFAULT_STRICT_THRESHOLDS.liquidity_decay_score_gte
),
vertical_extension_score_gte: maxStrictThreshold(
safe.max_vertical_extension_score_for_add,
DEFAULT_STRICT_THRESHOLDS.vertical_extension_score_gte
),
failed_breakout_count_gte:
DEFAULT_STRICT_THRESHOLDS.failed_breakout_count_gte,

min_operator_quality_score: Math.max(
safeThreshold(
safe.min_operator_quality_score,
DEFAULT_STRICT_THRESHOLDS.min_operator_quality_score_floor
),
DEFAULT_STRICT_THRESHOLDS.min_operator_quality_score_floor
),
min_structural_health_score: Math.max(
safeThreshold(
safe.min_post_entry_health_score,
DEFAULT_STRICT_THRESHOLDS.min_structural_health_score_floor
),
DEFAULT_STRICT_THRESHOLDS.min_structural_health_score_floor
),

reject_missing_market_data: true,
reject_missing_price_data: true,
reject_missing_liquidity_data: true,
reject_missing_holder_data: true,

enable_liquidity_checks: true,
enable_holder_checks: true,
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
paper_mode_relaxed: false,
open_position_context: Boolean(safeSnapshot.open_position_context),
missing_metrics: [],
},
};
}

const identityChecks = evaluateIdentityChecks(safeSnapshot);
const missingDataChecks = evaluateMissingDataChecks(safeSnapshot, thresholds);
const riskChecks = evaluateRiskChecks(safeSnapshot, thresholds);
const liquidityChecks = evaluateLiquidityChecks(safeSnapshot, thresholds);
const holderChecks = evaluateHolderChecks(safeSnapshot, thresholds);
const controlChecks = evaluateControlChecks(safeSnapshot, thresholds);
const manipulationChecks = evaluateManipulationChecks(safeSnapshot, thresholds);

const checks = [
...identityChecks,
...missingDataChecks,
...riskChecks,
...liquidityChecks,
...holderChecks,
...controlChecks,
...manipulationChecks,
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
paper_mode_relaxed: false,
open_position_context: Boolean(safeSnapshot.open_position_context),
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
open_position_context: false,
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
paper_mode_relaxed: false,
open_position_context: Boolean(result?.meta?.open_position_context),
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
