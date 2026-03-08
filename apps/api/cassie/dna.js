function clamp(n, min, max) {
return Math.max(min, Math.min(max, n));
}

function safeNum(v, fallback = 0) {
const n = Number(v);
return Number.isFinite(n) ? n : fallback;
}

function toFlag(value, yes = "yes", no = "no") {
return value ? yes : no;
}

function buildSignature(parts) {
return `cassie_${parts.join("_").replace(/[^a-zA-Z0-9_]/g, "").toLowerCase()}`;
}

function getRiskClass(score) {
const s = safeNum(score, 0);
if (s >= 80) return "critical";
if (s >= 60) return "high";
if (s >= 40) return "elevated";
return "lower";
}

function getBand(value, bands) {
for (const band of bands) {
if (value >= band.min) return band.label;
}
return bands[bands.length - 1]?.label || "unknown";
}

export function buildCassieDna({
mint,
token = {},
market = {},
concentration = {},
activity = {},
securityModel = {},
trend = {},
}) {
const hiddenControl = securityModel?.hiddenControl || {};
const developerActivity = securityModel?.developerActivity || {};
const developerNetwork = securityModel?.developerNetwork || {};
const walletNetwork = securityModel?.walletNetwork || {};
const freshWalletRisk = securityModel?.freshWalletRisk || {};
const liquidityStability = securityModel?.liquidityStability || {};
const whaleActivity = securityModel?.whaleActivity || {};
const reputation = securityModel?.reputation || {};
const trendBlock = securityModel?.trend || trend?.trend || {};

const riskScore = safeNum(securityModel?.score, 0);
const top10 = safeNum(concentration?.top10, 0);
const top1 = safeNum(concentration?.top1, 0);
const top20 = safeNum(concentration?.top20, 0);

const linkedWallets = safeNum(hiddenControl?.linkedWallets, 0);
const linkedWalletPct = safeNum(hiddenControl?.linkedWalletPct, 0);
const hiddenControlScore = safeNum(hiddenControl?.score, 0);

const freshWalletPct = safeNum(freshWalletRisk?.pct, 0);
const freshWalletCount = safeNum(freshWalletRisk?.walletCount, 0);

const whaleScore = safeNum(whaleActivity?.score ?? securityModel?.whaleScore, 0);
const syncBurstSize = safeNum(whaleActivity?.syncBurstSize, 0);

const liqFdvPct = safeNum(liquidityStability?.liqFdvPct, 0);
const liquidityUsd = safeNum(market?.liquidityUsd, 0);
const fdvUsd = safeNum(market?.fdv, 0);
const volume24h = safeNum(market?.volume24h, 0);

const mintRevoked = !!token?.safety?.mintRevoked;
const freezeRevoked = !!token?.safety?.freezeRevoked;
const sharedFundingDetected = !!hiddenControl?.sharedFundingDetected;

const devDetected =
!!developerNetwork?.detected || !!developerActivity?.detected;
const developerConfidence = safeNum(
developerNetwork?.confidence || developerActivity?.confidence,
0
);
const developerLinkedWallets = safeNum(
developerNetwork?.linkedWallets || developerActivity?.linkedWallets,
0
);
const developerLikelyControlPct = safeNum(
developerNetwork?.likelyControlPct || developerActivity?.likelyControlPct,
0
);

const walletNetworkConfidence = safeNum(walletNetwork?.confidence, 0);
const walletNetworkControlEstimatePct = safeNum(
walletNetwork?.controlEstimatePct,
0
);
const walletNetworkLinkedWallets = safeNum(
walletNetwork?.linkedWallets,
linkedWallets
);

const trendLabel = String(trendBlock?.label || "Stable");
const trendMomentum = String(trendBlock?.momentum || "Stable");
const trendDelta24 = safeNum(trendBlock?.delta24h ?? trend?.change?.["24h"], 0);

const matches = [];

if (hiddenControlScore >= 45) matches.push("cluster_overlap");
if (linkedWallets >= 3) matches.push("linked_wallet_group");
if (linkedWalletPct >= 25) matches.push("linked_wallet_supply_pressure");
if (sharedFundingDetected) matches.push("shared_funding_detected");

if (freshWalletPct >= 20) matches.push("fresh_wallet_density");
if (freshWalletCount >= 3) matches.push("fresh_wallet_cluster_presence");

if (top10 >= 55) matches.push("top10_pressure");
if (top1 >= 25) matches.push("top1_pressure");
if (top20 >= 75) matches.push("top20_pressure");

if (liqFdvPct > 0 && liqFdvPct < 5) matches.push("thin_liquidity_relative_to_fdv");
if (liqFdvPct > 0 && liqFdvPct < 3) matches.push("fragile_liquidity_profile");
if (liquidityUsd > 0 && liquidityUsd < 25000) matches.push("low_visible_liquidity");

if (!mintRevoked || !freezeRevoked) matches.push("authority_control_present");
if (!mintRevoked && !freezeRevoked) matches.push("full_authority_surface");

if (whaleScore >= 65) matches.push("coordinated_whale_pressure");
if (syncBurstSize >= 3) matches.push("synchronized_wallet_activity");

if (devDetected) matches.push("possible_dev_linkage");
if (developerConfidence >= 55) matches.push("developer_network_pattern");
if (developerLikelyControlPct >= 25) matches.push("developer_network_control_pressure");

if (walletNetworkConfidence >= 45) matches.push("wallet_network_pattern");
if (walletNetworkControlEstimatePct >= 25) matches.push("wallet_network_control_pressure");

if (trendLabel === "Escalating" || trendMomentum === "Escalating") {
matches.push("risk_trend_escalating");
} else if (trendMomentum === "Rising" || trendDelta24 >= 10) {
matches.push("risk_trend_rising");
}

if (
(!mintRevoked || !freezeRevoked) &&
liqFdvPct > 0 &&
liqFdvPct < 3
) {
matches.push("authority_plus_thin_liquidity");
}

if (
developerConfidence >= 55 &&
walletNetworkConfidence >= 55
) {
matches.push("developer_and_wallet_network_alignment");
}

if (
hiddenControlScore >= 45 &&
top10 >= 55
) {
matches.push("clustered_concentration_pattern");
}

if (
freshWalletPct >= 20 &&
top10 >= 55
) {
matches.push("fresh_wallet_concentration_pattern");
}

if (
whaleScore >= 65 &&
(trendLabel === "Escalating" || trendMomentum === "Escalating" || trendDelta24 >= 10)
) {
matches.push("whale_pressure_with_risk_acceleration");
}

if (
developerConfidence >= 55 &&
developerLikelyControlPct >= 25 &&
top10 >= 55
) {
matches.push("developer_controlled_concentration_pattern");
}

if (
walletNetworkConfidence >= 55 &&
walletNetworkControlEstimatePct >= 25 &&
linkedWallets >= 3
) {
matches.push("wallet_network_control_map_pattern");
}

const confidence = clamp(
Math.round(
riskScore * 0.20 +
hiddenControlScore * 0.14 +
developerConfidence * 0.13 +
walletNetworkConfidence * 0.13 +
whaleScore * 0.09 +
Math.min(top10, 100) * 0.08 +
Math.min(freshWalletPct * 2, 100) * 0.06 +
Math.min(liqFdvPct > 0 ? 100 - Math.min(liqFdvPct * 8, 100) : 35, 100) * 0.05 +
(sharedFundingDetected ? 5 : 0) +
Math.min(matches.length * 1.4, 10)
),
0,
100
);

const riskClass = getRiskClass(riskScore);

const devPattern = devDetected
? developerConfidence >= 75
? "strong_developer_network"
: developerConfidence >= 55
? "elevated_developer_network"
: "possible_repeat_structure"
: "no_clear_repeat_structure";

const walletNetworkPattern =
walletNetworkConfidence >= 75
? "strong_wallet_network_control"
: walletNetworkConfidence >= 55
? "elevated_wallet_network_control"
: walletNetworkConfidence >= 35
? "weak_wallet_network_signal"
: "no_clear_wallet_network";

const fundingPattern = sharedFundingDetected
? "shared_source_detected"
: "no_shared_source_detected";

const holderPattern =
hiddenControlScore >= 60 || top10 >= 65
? "clustered_distribution"
: top10 >= 45
? "concentrated_distribution"
: "broad_distribution";

const liquidityPattern =
liqFdvPct > 0 && liqFdvPct < 3
? "thin_relative_to_fdv"
: liqFdvPct > 0 && liqFdvPct < 8
? "moderate_depth"
: liqFdvPct >= 8
? "healthy_depth"
: "depth_unknown";

const authorityPattern =
mintRevoked && freezeRevoked
? "revoked"
: !mintRevoked && !freezeRevoked
? "mint_and_freeze_present"
: "partial_control_present";

const whalePattern =
whaleScore >= 70
? "coordinated"
: whaleScore >= 45
? "elevated"
: "normal";

const trendPattern =
trendLabel === "Escalating" || trendMomentum === "Escalating"
? "escalating"
: trendMomentum === "Rising" || trendDelta24 >= 10
? "rising"
: trendMomentum === "Cooling" || trendMomentum === "Softening"
? "cooling"
: "stable";

const combinedPattern =
developerConfidence >= 55 &&
walletNetworkConfidence >= 55 &&
hiddenControlScore >= 45
? "stacked_operator_control"
: (!mintRevoked || !freezeRevoked) && liqFdvPct > 0 && liqFdvPct < 3
? "authority_fragility_stack"
: top10 >= 55 && freshWalletPct >= 20
? "distribution_fragility_stack"
: hiddenControlScore >= 45 && whaleScore >= 65
? "coordination_pressure_stack"
: "no_dominant_stack";

const developerBand = getBand(developerConfidence, [
{ min: 75, label: "strong" },
{ min: 55, label: "elevated" },
{ min: 35, label: "watch" },
{ min: 0, label: "low" },
]);

const walletBand = getBand(walletNetworkConfidence, [
{ min: 75, label: "strong" },
{ min: 55, label: "elevated" },
{ min: 35, label: "watch" },
{ min: 0, label: "low" },
]);

const signature = buildSignature([
riskClass,
devDetected ? "devnet" : "nodevnet",
developerBand,
walletBand,
sharedFundingDetected ? "funded" : "nofund",
hiddenControlScore >= 45 ? "cluster" : "nocluster",
freshWalletPct >= 20 ? "fresh" : "aged",
top10 >= 55 ? "top10heavy" : "top10ok",
walletNetworkControlEstimatePct >= 25 ? "controlmap" : "nocontrolmap",
!mintRevoked || !freezeRevoked ? "authlive" : "authrevoked",
trendPattern,
]);

return {
ok: true,
mint,
cassieDna: {
signature,
riskClass,
devPattern,
walletNetworkPattern,
fundingPattern,
holderPattern,
liquidityPattern,
authorityPattern,
whalePattern,
trendPattern,
combinedPattern,
confidence,
matches,
traits: {
riskScore,
hiddenControlScore,
linkedWallets,
linkedWalletPct,
freshWalletPct,
freshWalletCount,
top1,
top10,
top20,
whaleScore,
syncBurstSize,
liqFdvPct,
liquidityUsd,
fdvUsd,
volume24h,
developerConfidence,
developerLinkedWallets,
developerLikelyControlPct,
walletNetworkConfidence,
walletNetworkControlEstimatePct,
walletNetworkLinkedWallets,
mintRevoked: toFlag(mintRevoked),
freezeRevoked: toFlag(freezeRevoked),
sharedFundingDetected: toFlag(sharedFundingDetected),
trendLabel,
trendMomentum,
trendDelta24,
reputationLabel: String(reputation?.label || "Unknown"),
reputationScore: safeNum(reputation?.score, 0),
primaryDriver: String(securityModel?.primaryDriver || "Unknown"),
},
},
};
}