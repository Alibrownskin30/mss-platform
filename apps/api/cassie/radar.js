function safeNum(v, fallback = 0) {
const n = Number(v);
return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
return Math.max(min, Math.min(max, n));
}

function toneFromScore(score) {
if (score >= 75) return "bad";
if (score >= 45) return "warn";
return "good";
}

export function runCassieRadar({
cassieDna,
securityModel = {},
concentration = {},
activity = {},
market = {},
trend = {},
}) {
const matches = Array.isArray(cassieDna?.matches) ? cassieDna.matches : [];
const riskScore = safeNum(securityModel?.score, 0);
const top10 = safeNum(concentration?.top10, 0);
const top1 = safeNum(concentration?.top1, 0);
const confidence = safeNum(cassieDna?.confidence, 0);

const hiddenControlScore = safeNum(securityModel?.hiddenControl?.score, 0);
const linkedWallets = safeNum(securityModel?.hiddenControl?.linkedWallets, 0);

const developerConfidence = safeNum(
securityModel?.developerNetwork?.confidence ||
securityModel?.developerActivity?.confidence,
0
);
const developerLikelyControlPct = safeNum(
securityModel?.developerNetwork?.likelyControlPct ||
securityModel?.developerActivity?.likelyControlPct,
0
);

const walletNetworkConfidence = safeNum(
securityModel?.walletNetwork?.confidence,
0
);
const walletNetworkControlEstimatePct = safeNum(
securityModel?.walletNetwork?.controlEstimatePct,
0
);

const liqFdvPct = safeNum(
securityModel?.liquidityStability?.liqFdvPct,
0
);
const liquidityUsd = safeNum(market?.liquidityUsd, 0);

const whaleScore = safeNum(securityModel?.whaleActivity?.score, 0);
const syncBurstSize = safeNum(securityModel?.whaleActivity?.syncBurstSize, 0);
const freshWalletPct = safeNum(securityModel?.freshWalletRisk?.pct, 0);
const clusterCount = safeNum(activity?.clusterCount, 0);

const trendMomentum =
securityModel?.trend?.momentum ||
trend?.momentum ||
trend?.trend?.momentum ||
"Stable";

const trend24 = safeNum(
securityModel?.trend?.delta24h,
trend?.change?.["24h"]
);

const triggeredRules = [];
const signals = [];

const pushRule = (rule, score, text) => {
triggeredRules.push(rule);
signals.push({
rule,
score,
tone: toneFromScore(score),
text,
});
};

if (matches.includes("cluster_overlap") && matches.includes("shared_funding_detected")) {
pushRule(
"linked_cluster_with_shared_funding",
78,
"Cassie matched linked cluster overlap together with shared-funding fingerprints."
);
}

if (matches.includes("fresh_wallet_density") && matches.includes("top10_pressure")) {
pushRule(
"fresh_wallet_concentration_pattern",
66,
"Cassie matched fresh-wallet density combined with concentrated holder pressure."
);
}

if (
matches.includes("authority_control_present") &&
matches.includes("thin_liquidity_relative_to_fdv")
) {
pushRule(
"authority_plus_thin_liquidity_pattern",
82,
"Authority persistence is paired with thin liquidity relative to FDV."
);
}

if (
matches.includes("coordinated_whale_pressure") &&
matches.includes("risk_trend_escalating")
) {
pushRule(
"whale_pressure_with_risk_acceleration",
76,
"Coordinated whale pressure is appearing alongside accelerating risk trend."
);
}

if (developerConfidence >= 75 && developerLikelyControlPct >= 25) {
pushRule(
"developer_network_control_pattern",
88,
`Developer-network confidence is ${developerConfidence}/100 with likely coordinated influence around ${developerLikelyControlPct.toFixed(1)}%.`
);
} else if (developerConfidence >= 55) {
pushRule(
"developer_network_watch_pattern",
66,
`Developer-network confidence is elevated at ${developerConfidence}/100.`
);
}

if (walletNetworkConfidence >= 75 && walletNetworkControlEstimatePct >= 25) {
pushRule(
"wallet_network_control_pattern",
84,
`Wallet-network confidence is ${walletNetworkConfidence}/100 with estimated coordinated influence around ${walletNetworkControlEstimatePct.toFixed(1)}%.`
);
} else if (walletNetworkConfidence >= 55) {
pushRule(
"wallet_network_watch_pattern",
61,
`Wallet-network confidence is elevated at ${walletNetworkConfidence}/100.`
);
}

if (hiddenControlScore >= 70 && linkedWallets >= 4) {
pushRule(
"high_hidden_control_pattern",
80,
`Hidden-control score is ${hiddenControlScore}/100 across ${linkedWallets} linked wallets.`
);
} else if (hiddenControlScore >= 45 && linkedWallets >= 3) {
pushRule(
"moderate_hidden_control_pattern",
58,
`Hidden-control score is ${hiddenControlScore}/100 with visible wallet linkage.`
);
}

if (top10 >= 70 && top1 >= 25) {
pushRule(
"extreme_holder_concentration_pattern",
79,
`Top10 concentration is ${top10.toFixed(2)}% and Top1 concentration is ${top1.toFixed(2)}%.`
);
} else if (top10 >= 55) {
pushRule(
"holder_concentration_watch_pattern",
56,
`Top10 concentration is elevated at ${top10.toFixed(2)}%.`
);
}

if (liqFdvPct > 0 && liqFdvPct < 3 && liquidityUsd < 25000) {
pushRule(
"fragile_liquidity_pattern",
liqFdvPct < 1 ? 82 : 63,
`Liquidity appears fragile at ${liqFdvPct.toFixed(2)}% of FDV with visible liquidity around $${liquidityUsd.toFixed(2)}.`
);
}

if (freshWalletPct >= 25 && clusterCount >= 2) {
pushRule(
"fresh_wallet_cluster_pattern",
64,
`Fresh-wallet concentration is ${freshWalletPct.toFixed(1)}% with ${clusterCount} detected clusters.`
);
}

if (whaleScore >= 65 && syncBurstSize >= 3) {
pushRule(
"coordinated_whale_burst_pattern",
74,
`Whale score is ${whaleScore}/100 with synchronized activity burst size ${syncBurstSize}.`
);
} else if (whaleScore >= 40) {
pushRule(
"whale_watch_pattern",
52,
`Whale pressure is elevated at ${whaleScore}/100.`
);
}

if (
trendMomentum === "Escalating" ||
trendMomentum === "Rising" ||
trend24 >= 10
) {
pushRule(
"trend_escalation_pattern",
trendMomentum === "Escalating" || trend24 >= 10 ? 72 : 55,
`Risk trend is ${String(trendMomentum).toLowerCase()} with 24h delta ${trend24}.`
);
}

let radarScore = Math.round(
riskScore * 0.22 +
confidence * 0.14 +
hiddenControlScore * 0.12 +
developerConfidence * 0.13 +
walletNetworkConfidence * 0.13 +
Math.min(top10, 100) * 0.08 +
Math.min(freshWalletPct * 2, 100) * 0.06 +
Math.min(whaleScore, 100) * 0.06 +
triggeredRules.length * 3
);

radarScore = clamp(radarScore, 0, 100);

let label = "Low Concern";
let state = "good";

if (radarScore >= 75) {
label = "High Threat Pattern";
state = "bad";
} else if (radarScore >= 45) {
label = "Elevated Threat Pattern";
state = "warn";
}

if (!signals.length) {
signals.push({
rule: "no_major_pattern_match",
score: radarScore,
tone: state,
text: "No strong hostile structural pattern match detected in this scan.",
});
}

return {
score: radarScore,
label,
state,
triggeredRules,
note:
triggeredRules.length > 0
? "Cassie matched one or more hostile structural patterns."
: "No strong hostile structural pattern match detected in this scan.",
signals,
summary:
triggeredRules.length > 0
? `Cassie radar matched ${triggeredRules.length} structural pattern${triggeredRules.length === 1 ? "" : "s"}.`
: "Cassie radar did not find a dominant repeat-threat pattern in this snapshot.",
};
}
