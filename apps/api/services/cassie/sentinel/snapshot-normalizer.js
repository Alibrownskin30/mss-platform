import { SENTINEL_MODE } from "./config.js";

export const SENTINEL_SNAPSHOT_VERSION = 1;

export const MARKET_REGIME = {
RISK_OFF: "risk_off",
CAUTIOUS: "cautious",
NEUTRAL: "neutral",
FAVORABLE: "favorable",
HIGH_OPPORTUNITY: "high_opportunity",
};

const VALID_MODES = new Set(Object.values(SENTINEL_MODE));
const VALID_REGIME_STATES = new Set(Object.values(MARKET_REGIME));

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

function clamp(value, min = 0, max = 100) {
const num = toFloat(value, min);
return Math.min(max, Math.max(min, num));
}

function safeBool(value, fallback = false) {
if (typeof value === "boolean") return value;
const normalized = cleanText(value, 16).toLowerCase();
if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
if (normalized === "false" || normalized === "0" || normalized === "no") return false;
return fallback;
}

function getPath(source, path) {
if (!source || typeof source !== "object") return undefined;
return String(path || "")
.split(".")
.filter(Boolean)
.reduce((acc, key) => (acc == null ? undefined : acc[key]), source);
}

function firstText(source, paths = [], fallback = "") {
for (const path of paths) {
const value = getPath(source, path);
const text = cleanText(value, 500);
if (text) return text;
}
return fallback;
}

function firstNumber(source, paths = [], fallback = null) {
for (const path of paths) {
const value = getPath(source, path);
const num = toFloat(value, null);
if (num != null) return num;
}
return fallback;
}

function firstInteger(source, paths = [], fallback = null) {
for (const path of paths) {
const value = getPath(source, path);
const num = toInt(value, null);
if (num != null) return num;
}
return fallback;
}

function firstBoolean(source, paths = [], fallback = false) {
for (const path of paths) {
const value = getPath(source, path);
if (value != null) return safeBool(value, fallback);
}
return fallback;
}

function normalizeMode(value, fallback = SENTINEL_MODE.PAPER) {
const normalized = cleanText(value, 64).toLowerCase();
return VALID_MODES.has(normalized) ? normalized : fallback;
}

function normalizeRegimeState(value, fallback = null) {
const normalized = cleanText(value, 64).toLowerCase();
return VALID_REGIME_STATES.has(normalized) ? normalized : fallback;
}

function getLiquidityScore(avgMarketLiquidityUsd, baselineLiquidityUsd = 800) {
const avg = Math.max(0, toFloat(avgMarketLiquidityUsd, 0));
const baseline = Math.max(1, toFloat(baselineLiquidityUsd, 800));
const ratio = avg / baseline;

if (ratio >= 2) return 100;
if (ratio >= 1.5) return 85;
if (ratio >= 1.0) return 70;
if (ratio >= 0.75) return 55;
if (ratio >= 0.5) return 35;
return 15;
}

function getRunnerScore(recentRunnerCount) {
const count = Math.max(0, toFloat(recentRunnerCount, 0));
if (count >= 10) return 100;
return clamp(count * 10, 0, 100);
}

export function deriveRegimeScore(input = {}) {
const provided = toFloat(input.regime_score, null);
if (provided != null) {
return {
score: clamp(provided, 0, 100),
used_provided_score: true,
components: {
provided_regime_score: clamp(provided, 0, 100),
},
};
}

const reclaimScore =
toFloat(input.reclaim_success_rate_pct, null) == null
? 50
: clamp(input.reclaim_success_rate_pct, 0, 100);

const inverseRugScore =
toFloat(input.recent_rug_rate_pct, null) == null
? 50
: clamp(100 - toFloat(input.recent_rug_rate_pct, 0), 0, 100);

const liquidityScore = getLiquidityScore(
input.avg_market_liquidity_usd,
Math.max(800, toFloat(input.min_liquidity_usd, 800))
);

const runnerScore = getRunnerScore(input.recent_runner_count);

const followThroughScore =
toFloat(input.breakout_follow_through_score, null) == null
? 50
: clamp(input.breakout_follow_through_score, 0, 100);

const weighted =
reclaimScore * 0.4 +
inverseRugScore * 0.25 +
liquidityScore * 0.2 +
runnerScore * 0.1 +
followThroughScore * 0.05;

return {
score: clamp(weighted, 0, 100),
used_provided_score: false,
components: {
reclaim_success_score: reclaimScore,
inverse_rug_score: inverseRugScore,
liquidity_score: liquidityScore,
runner_score: runnerScore,
breakout_follow_through_score: followThroughScore,
},
};
}

export function deriveRegimeState(regimeScore) {
const score = clamp(regimeScore, 0, 100);

if (score < 35) return MARKET_REGIME.RISK_OFF;
if (score < 55) return MARKET_REGIME.CAUTIOUS;
if (score < 70) return MARKET_REGIME.NEUTRAL;
if (score < 85) return MARKET_REGIME.FAVORABLE;
return MARKET_REGIME.HIGH_OPPORTUNITY;
}

export function deriveWalletCoordinationRisk(input = {}) {
const explicit = toFloat(input.wallet_coordination_risk, null);
if (explicit != null) return clamp(explicit, 0, 100);

const clusterScore = clamp(input.cluster_score ?? input.activity_score ?? 0, 0, 100);
const whaleActivityScore = clamp(input.whale_activity_score ?? 0, 0, 100);
const walletNetworkRiskScore = clamp(input.wallet_network_risk_score ?? 0, 0, 100);
const walletNetworkConfidence = clamp(input.wallet_network_confidence ?? 0, 0, 100);

const weighted =
clusterScore * 0.4 +
whaleActivityScore * 0.25 +
walletNetworkRiskScore * 0.2 +
walletNetworkConfidence * 0.15;

return clamp(weighted, 0, 100);
}

export function deriveOperatorQualityScore(input = {}) {
const explicit = toFloat(input.operator_quality_score, null);
if (explicit != null) return clamp(explicit, 0, 100);

const reputationScore = clamp(input.reputation_score ?? 50, 0, 100);
const hiddenControlRisk = clamp(input.hidden_control_risk ?? 0, 0, 100);
const contaminationRisk = clamp(input.contamination_risk ?? 0, 0, 100);
const insiderSellScore = clamp(input.insider_sell_score ?? 0, 0, 100);
const walletCoordinationRisk = clamp(input.wallet_coordination_risk ?? 0, 0, 100);

const score =
reputationScore * 0.55 +
(100 - hiddenControlRisk) * 0.15 +
(100 - contaminationRisk) * 0.1 +
(100 - insiderSellScore) * 0.1 +
(100 - walletCoordinationRisk) * 0.1;

return clamp(score, 0, 100);
}

export function deriveSellerExhaustionScore(input = {}) {
const explicit = toFloat(input.seller_exhaustion_score, null);
if (explicit != null) return clamp(explicit, 0, 100);

const sellPressureScore = toFloat(input.sell_pressure_score, null);
if (sellPressureScore != null) {
return clamp(100 - sellPressureScore, 0, 100);
}

const reclaimStrength = clamp(input.reclaim_strength_score ?? 50, 0, 100);
const buyPressure = clamp(input.buy_pressure_score ?? 50, 0, 100);
const liquidityDecay = clamp(input.liquidity_decay_score ?? 0, 0, 100);

const score =
reclaimStrength * 0.45 +
buyPressure * 0.2 +
(100 - liquidityDecay) * 0.35;

return clamp(score, 0, 100);
}

export function deriveStructuralHealthScore(input = {}) {
const explicit = toFloat(input.structural_health_score, null);
if (explicit != null) return clamp(explicit, 0, 100);

const reclaimStrength = clamp(input.reclaim_strength_score ?? 50, 0, 100);
const buyPressure = clamp(input.buy_pressure_score ?? 50, 0, 100);
const persistence = clamp(input.persistence_score ?? 50, 0, 100);
const hiddenControlRisk = clamp(input.hidden_control_risk ?? 0, 0, 100);
const liquidityDecay = clamp(input.liquidity_decay_score ?? 0, 0, 100);
const verticalExtension = clamp(input.vertical_extension_score ?? 0, 0, 100);

const weighted =
reclaimStrength * 0.25 +
buyPressure * 0.2 +
persistence * 0.25 +
(100 - hiddenControlRisk) * 0.1 +
(100 - liquidityDecay) * 0.1 +
(100 - verticalExtension) * 0.1;

return clamp(weighted, 0, 100);
}

export function buildSentinelSnapshotFromSecurityScan(scan = {}, options = {}) {
const mint =
cleanText(scan.mint, 255) ||
cleanText(scan.token?.mint, 255) ||
cleanText(scan.mint_address, 255);

const market = scan.market || {};
const concentration = scan.concentration || {};
const activity = scan.activity || {};
const securityModel = scan.securityModel || {};
const trend = scan.trend || {};
const cassie = scan.cassie || {};
const walletNetwork = securityModel.walletNetwork || {};
const hiddenControl = securityModel.hiddenControl || {};
const developerNetwork = securityModel.developerNetwork || {};
const freshWalletRisk = securityModel.freshWalletRisk || {};
const whaleActivity = securityModel.whaleActivity || {};
const liquidityStability = securityModel.liquidityStability || {};
const reputation = securityModel.reputation || {};

return normalizeSentinelSnapshot(
{
version: SENTINEL_SNAPSHOT_VERSION,
source: cleanText(options.source, 120) || "security_scan",
token_id: mint,
mint_address: mint,

execution_mode:
cleanText(options.execution_mode, 64) ||
cleanText(scan.execution_mode, 64) ||
SENTINEL_MODE.PAPER,

linked_operator_cluster_id:
cleanText(scan.linked_operator_cluster_id, 255) ||
cleanText(walletNetwork.primaryClusterId, 255),

marketcap_usd:
toFloat(market.mcapUsd, null) ??
toFloat(market.marketCapUsd, null) ??
toFloat(market.fdv, null),

liquidity_usd: toFloat(market.liquidityUsd, 0),
current_price:
toFloat(market.priceUsd, null) ??
toFloat(scan.current_price, null) ??
null,

top_holder_pct: toFloat(concentration.top1, 0),
top_5_holder_pct: toFloat(concentration.top5, 0),

hidden_control_risk: toFloat(hiddenControl.score, null),
contamination_risk:
toFloat(scan.contamination_risk, null) ??
toFloat(freshWalletRisk.score, null) ??
null,
wallet_coordination_risk:
toFloat(scan.wallet_coordination_risk, null) ??
toFloat(walletNetwork.riskScore, null) ??
toFloat(activity.score, null) ??
toFloat(whaleActivity.score, null) ??
null,

operator_quality_score:
toFloat(scan.operator_quality_score, null) ??
toFloat(reputation.score, null) ??
null,
insider_sell_score:
toFloat(scan.insider_sell_score, null) ??
toFloat(scan.dev_sell_score, null) ??
0,

regime_score:
toFloat(scan.regime_score, null) ??
toFloat(trend?.latest?.risk, null) == null
? null
: clamp(100 - toFloat(trend?.latest?.risk, 0), 0, 100),
regime_state: cleanText(scan.regime_state, 64) || null,

recent_rug_rate_pct: toFloat(scan.recent_rug_rate_pct, null),
reclaim_success_rate_pct: toFloat(scan.reclaim_success_rate_pct, null),
avg_market_liquidity_usd:
toFloat(scan.avg_market_liquidity_usd, null) ??
toFloat(market.liquidityUsd, null) ??
null,
recent_runner_count: toFloat(scan.recent_runner_count, null),
breakout_follow_through_score:
toFloat(scan.breakout_follow_through_score, null) ??
toFloat(whaleActivity.score, null) ??
null,

seller_exhaustion_score: toFloat(scan.seller_exhaustion_score, null),
reclaim_strength_score:
toFloat(scan.reclaim_strength_score, null) ??
toFloat(trend?.change?.["1h"], null) != null
? clamp(50 + toFloat(trend?.change?.["1h"], 0), 0, 100)
: null,
buy_pressure_score:
toFloat(scan.buy_pressure_score, null) ??
toFloat(whaleActivity.score, null) ??
null,
persistence_score:
toFloat(scan.persistence_score, null) ??
toFloat(reputation.score, null) ??
null,
structural_health_score:
toFloat(scan.structural_health_score, null) ??
toFloat(liquidityStability.score, null) ??
null,

vertical_extension_score: toFloat(scan.vertical_extension_score, null),
liquidity_decay_score:
toFloat(scan.liquidity_decay_score, null) ??
clamp(100 - toFloat(liquidityStability.score, 50), 0, 100),

transfer_restriction_risk:
toFloat(scan.transfer_restriction_risk, null) ??
(scan.token?.freezeAuthority ? 80 : 0),
honeypot_risk: toFloat(scan.honeypot_risk, 0),
liquidity_break_risk: toFloat(scan.liquidity_break_risk, 0),
spoofed_volume_risk: toFloat(scan.spoofed_volume_risk, 0),

bars_since_launch: toInt(scan.bars_since_launch, null),
bars_since_local_low: toInt(scan.bars_since_local_low, null),
failed_breakout_count: toInt(scan.failed_breakout_count, 0),

current_multiple: toFloat(scan.current_multiple, null),
current_value_usd: toFloat(scan.current_value_usd, null),

flags: {
from_security_scan: true,
cassie_enabled: Boolean(cassie?.enabled),
},

raw: scan,
},
options
);
}

export function normalizeSentinelSnapshot(input = {}, options = {}) {
const source = input && typeof input === "object" ? input : {};
const minLiquidityUsd = Math.max(
0,
toFloat(
options.min_liquidity_usd ??
firstNumber(source, ["min_liquidity_usd"], 800),
800
)
);

const tokenId =
firstText(source, [
"token_id",
"mint_address",
"mint",
"address",
"token.mint",
"raw.mint",
]) || "";

const mintAddress =
firstText(source, [
"mint_address",
"mint",
"address",
"token_id",
"token.mint",
"raw.mint",
]) || tokenId;

const hiddenControlRisk = clamp(
firstNumber(source, [
"hidden_control_risk",
"securityModel.hiddenControl.score",
"hiddenControl.score",
"raw.securityModel.hiddenControl.score",
], 0) ?? 0,
0,
100
);

const contaminationRisk = clamp(
firstNumber(source, [
"contamination_risk",
"securityModel.contamination.score",
"raw.securityModel.contamination.score",
"securityModel.freshWalletRisk.score",
"raw.securityModel.freshWalletRisk.score",
], 0) ?? 0,
0,
100
);

const walletCoordinationRisk = deriveWalletCoordinationRisk({
wallet_coordination_risk: firstNumber(source, [
"wallet_coordination_risk",
"activity.score",
"securityModel.walletNetwork.riskScore",
"securityModel.whaleActivity.score",
"raw.activity.score",
"raw.securityModel.walletNetwork.riskScore",
"raw.securityModel.whaleActivity.score",
], null),
cluster_score: firstNumber(source, ["activity.score", "raw.activity.score"], 0),
whale_activity_score: firstNumber(source, [
"securityModel.whaleActivity.score",
"raw.securityModel.whaleActivity.score",
], 0),
wallet_network_risk_score: firstNumber(source, [
"securityModel.walletNetwork.riskScore",
"raw.securityModel.walletNetwork.riskScore",
], 0),
wallet_network_confidence: firstNumber(source, [
"securityModel.walletNetwork.confidence",
"raw.securityModel.walletNetwork.confidence",
], 0),
});

const insiderSellScore = clamp(
firstNumber(source, [
"insider_sell_score",
"dev_sell_score",
"developer_sell_score",
"raw.insider_sell_score",
], 0) ?? 0,
0,
100
);

const reclaimStrengthScore = clamp(
firstNumber(source, [
"reclaim_strength_score",
"reclaim_score",
"raw.reclaim_strength_score",
], 50) ?? 50,
0,
100
);

const buyPressureScore = clamp(
firstNumber(source, [
"buy_pressure_score",
"buy_pressure",
"raw.buy_pressure_score",
], 50) ?? 50,
0,
100
);

const persistenceScore = clamp(
firstNumber(source, [
"persistence_score",
"raw.persistence_score",
"securityModel.reputation.score",
"raw.securityModel.reputation.score",
], 50) ?? 50,
0,
100
);

const liquidityDecayScore = clamp(
firstNumber(source, [
"liquidity_decay_score",
"raw.liquidity_decay_score",
], 0) ?? 0,
0,
100
);

const verticalExtensionScore = clamp(
firstNumber(source, [
"vertical_extension_score",
"extension_score",
"raw.vertical_extension_score",
], 0) ?? 0,
0,
100
);

const structuralHealthScore = deriveStructuralHealthScore({
structural_health_score: firstNumber(source, [
"structural_health_score",
"securityModel.liquidityStability.score",
"raw.structural_health_score",
"raw.securityModel.liquidityStability.score",
], null),
reclaim_strength_score: reclaimStrengthScore,
buy_pressure_score: buyPressureScore,
persistence_score: persistenceScore,
hidden_control_risk: hiddenControlRisk,
liquidity_decay_score: liquidityDecayScore,
vertical_extension_score: verticalExtensionScore,
});

const avgMarketLiquidityUsd =
firstNumber(source, [
"avg_market_liquidity_usd",
"market.liquidityUsd",
"raw.avg_market_liquidity_usd",
"raw.market.liquidityUsd",
], null) ?? null;

const regimeDerived = deriveRegimeScore({
regime_score: firstNumber(source, ["regime_score", "raw.regime_score"], null),
recent_rug_rate_pct: firstNumber(source, [
"recent_rug_rate_pct",
"raw.recent_rug_rate_pct",
], null),
reclaim_success_rate_pct: firstNumber(source, [
"reclaim_success_rate_pct",
"raw.reclaim_success_rate_pct",
], null),
avg_market_liquidity_usd: avgMarketLiquidityUsd,
recent_runner_count: firstNumber(source, [
"recent_runner_count",
"raw.recent_runner_count",
], null),
breakout_follow_through_score: firstNumber(source, [
"breakout_follow_through_score",
"raw.breakout_follow_through_score",
], null),
min_liquidity_usd: minLiquidityUsd,
});

const regimeState =
normalizeRegimeState(
firstText(source, ["regime_state", "raw.regime_state"], "")
) || deriveRegimeState(regimeDerived.score);

const normalized = {
version: SENTINEL_SNAPSHOT_VERSION,
source:
firstText(source, ["source", "raw.source"], "") ||
cleanText(options.source, 120) ||
"unknown",

token_id: tokenId,
mint_address: mintAddress,

execution_mode: normalizeMode(
firstText(source, ["execution_mode", "mode", "raw.execution_mode"], ""),
cleanText(options.execution_mode, 64) || SENTINEL_MODE.PAPER
),

linked_operator_cluster_id: firstText(source, [
"linked_operator_cluster_id",
"operator_cluster_id",
"walletNetwork.primaryClusterId",
"securityModel.walletNetwork.primaryClusterId",
"raw.linked_operator_cluster_id",
"raw.securityModel.walletNetwork.primaryClusterId",
], "") || null,

marketcap_usd: Math.max(
0,
firstNumber(source, [
"marketcap_usd",
"marketcap",
"mcap",
"market.mcapUsd",
"market.marketCapUsd",
"raw.marketcap_usd",
"raw.market.mcapUsd",
], 0) ?? 0
),
liquidity_usd: Math.max(
0,
firstNumber(source, [
"liquidity_usd",
"market.liquidityUsd",
"raw.liquidity_usd",
"raw.market.liquidityUsd",
], 0) ?? 0
),
current_price:
firstNumber(source, [
"current_price",
"price_now",
"current_price_usd",
"price",
"market.priceUsd",
"raw.current_price",
"raw.market.priceUsd",
], null) ?? null,

spread_bps: Math.max(
0,
firstNumber(source, [
"spread_bps",
"spreadBps",
"execution.spreadBps",
"raw.spread_bps",
], 0) ?? 0
),
price_impact_bps: Math.max(
0,
firstNumber(source, [
"price_impact_bps",
"priceImpactBps",
"execution.priceImpactBps",
"raw.price_impact_bps",
], 0) ?? 0
),

top_holder_pct: clamp(
firstNumber(source, [
"top_holder_pct",
"concentration.top1",
"raw.top_holder_pct",
"raw.concentration.top1",
], 0) ?? 0,
0,
100
),
top_5_holder_pct: clamp(
firstNumber(source, [
"top_5_holder_pct",
"top5_holder_pct",
"concentration.top5",
"raw.top_5_holder_pct",
"raw.concentration.top5",
], 0) ?? 0,
0,
100
),

transfer_restriction_risk: clamp(
firstNumber(source, [
"transfer_restriction_risk",
"raw.transfer_restriction_risk",
], 0) ?? 0,
0,
100
),
honeypot_risk: clamp(
firstNumber(source, ["honeypot_risk", "raw.honeypot_risk"], 0) ?? 0,
0,
100
),
liquidity_break_risk: clamp(
firstNumber(source, [
"liquidity_break_risk",
"raw.liquidity_break_risk",
], 0) ?? 0,
0,
100
),
spoofed_volume_risk: clamp(
firstNumber(source, [
"spoofed_volume_risk",
"raw.spoofed_volume_risk",
], 0) ?? 0,
0,
100
),

hidden_control_risk: hiddenControlRisk,
contamination_risk: contaminationRisk,
wallet_coordination_risk: walletCoordinationRisk,

operator_quality_score: deriveOperatorQualityScore({
operator_quality_score: firstNumber(source, [
"operator_quality_score",
"raw.operator_quality_score",
], null),
reputation_score: firstNumber(source, [
"securityModel.reputation.score",
"reputation.score",
"raw.securityModel.reputation.score",
], 50),
hidden_control_risk: hiddenControlRisk,
contamination_risk: contaminationRisk,
insider_sell_score: insiderSellScore,
wallet_coordination_risk: walletCoordinationRisk,
}),

insider_sell_score: insiderSellScore,

regime_score: regimeDerived.score,
regime_state: regimeState,
recent_rug_rate_pct:
firstNumber(source, [
"recent_rug_rate_pct",
"raw.recent_rug_rate_pct",
], null) ?? null,
reclaim_success_rate_pct:
firstNumber(source, [
"reclaim_success_rate_pct",
"raw.reclaim_success_rate_pct",
], null) ?? null,
avg_market_liquidity_usd: avgMarketLiquidityUsd,
recent_runner_count:
firstNumber(source, [
"recent_runner_count",
"raw.recent_runner_count",
], null) ?? null,
breakout_follow_through_score:
firstNumber(source, [
"breakout_follow_through_score",
"raw.breakout_follow_through_score",
], null) ?? null,

seller_exhaustion_score: deriveSellerExhaustionScore({
seller_exhaustion_score: firstNumber(source, [
"seller_exhaustion_score",
"raw.seller_exhaustion_score",
], null),
sell_pressure_score: firstNumber(source, [
"sell_pressure_score",
"raw.sell_pressure_score",
], null),
reclaim_strength_score: reclaimStrengthScore,
buy_pressure_score: buyPressureScore,
liquidity_decay_score: liquidityDecayScore,
}),

reclaim_strength_score: reclaimStrengthScore,
buy_pressure_score: buyPressureScore,
persistence_score: persistenceScore,
structural_health_score: structuralHealthScore,

vertical_extension_score: verticalExtensionScore,
liquidity_decay_score: liquidityDecayScore,

bars_since_launch: Math.max(
0,
firstInteger(source, [
"bars_since_launch",
"raw.bars_since_launch",
], 0) ?? 0
),
bars_since_local_low: Math.max(
0,
firstInteger(source, [
"bars_since_local_low",
"raw.bars_since_local_low",
], 0) ?? 0
),
failed_breakout_count: Math.max(
0,
firstInteger(source, [
"failed_breakout_count",
"raw.failed_breakout_count",
], 0) ?? 0
),

current_value_usd:
firstNumber(source, [
"current_value_usd",
"position_value_usd",
"raw.current_value_usd",
], null) ?? null,
current_multiple:
firstNumber(source, [
"current_multiple",
"raw.current_multiple",
], null) ?? null,

has_live_position_context: firstBoolean(source, [
"has_live_position_context",
"raw.has_live_position_context",
], false),

raw: source,
meta: {
snapshot_version: SENTINEL_SNAPSHOT_VERSION,
used_provided_regime_score: Boolean(regimeDerived.used_provided_score),
regime_components: regimeDerived.components,
has_token_id: Boolean(tokenId),
has_mint_address: Boolean(mintAddress),
},
};

return normalized;
}

export function normalizeSentinelSnapshots(input = [], options = {}) {
return (Array.isArray(input) ? input : [])
.map((item) => normalizeSentinelSnapshot(item, options))
.filter((item) => isUsableSentinelSnapshot(item));
}

export function isUsableSentinelSnapshot(snapshot = {}) {
const tokenId = cleanText(snapshot.token_id, 255);
const mintAddress = cleanText(snapshot.mint_address, 255);
return Boolean(tokenId || mintAddress);
}

export function summarizeSentinelSnapshot(snapshot = {}) {
const safe = normalizeSentinelSnapshot(snapshot);

return {
token_id: safe.token_id || null,
mint_address: safe.mint_address || null,
execution_mode: safe.execution_mode,
linked_operator_cluster_id: safe.linked_operator_cluster_id || null,

marketcap_usd: safe.marketcap_usd,
liquidity_usd: safe.liquidity_usd,
current_price: safe.current_price,

regime_state: safe.regime_state,
regime_score: safe.regime_score,

operator_quality_score: safe.operator_quality_score,
hidden_control_risk: safe.hidden_control_risk,
contamination_risk: safe.contamination_risk,
wallet_coordination_risk: safe.wallet_coordination_risk,
insider_sell_score: safe.insider_sell_score,

seller_exhaustion_score: safe.seller_exhaustion_score,
reclaim_strength_score: safe.reclaim_strength_score,
buy_pressure_score: safe.buy_pressure_score,
persistence_score: safe.persistence_score,
structural_health_score: safe.structural_health_score,
vertical_extension_score: safe.vertical_extension_score,
liquidity_decay_score: safe.liquidity_decay_score,

top_holder_pct: safe.top_holder_pct,
top_5_holder_pct: safe.top_5_holder_pct,

transfer_restriction_risk: safe.transfer_restriction_risk,
honeypot_risk: safe.honeypot_risk,
liquidity_break_risk: safe.liquidity_break_risk,
spoofed_volume_risk: safe.spoofed_volume_risk,

failed_breakout_count: safe.failed_breakout_count,
bars_since_launch: safe.bars_since_launch,
bars_since_local_low: safe.bars_since_local_low,
};
}

export default {
SENTINEL_SNAPSHOT_VERSION,
MARKET_REGIME,
deriveRegimeScore,
deriveRegimeState,
deriveWalletCoordinationRisk,
deriveOperatorQualityScore,
deriveSellerExhaustionScore,
deriveStructuralHealthScore,
buildSentinelSnapshotFromSecurityScan,
normalizeSentinelSnapshot,
normalizeSentinelSnapshots,
isUsableSentinelSnapshot,
summarizeSentinelSnapshot,
};
