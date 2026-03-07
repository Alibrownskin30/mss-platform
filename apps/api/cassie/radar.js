function safeNum(v, fallback = 0) {
const n = Number(v);
return Number.isFinite(n) ? n : fallback;
}

export function runCassieRadar({ cassieDna, securityModel = {}, concentration = {} }) {
const matches = Array.isArray(cassieDna?.matches) ? cassieDna.matches : [];
const riskScore = safeNum(securityModel?.score, 0);
const top10 = safeNum(concentration?.top10, 0);
const confidence = safeNum(cassieDna?.confidence, 0);

const triggeredRules = [];

if (matches.includes("cluster_overlap") && matches.includes("shared_funding_detected")) {
triggeredRules.push("linked_cluster_with_shared_funding");
}

if (matches.includes("fresh_wallet_density") && matches.includes("top10_pressure")) {
triggeredRules.push("fresh_wallet_concentration_pattern");
}

if (matches.includes("authority_control_present") && matches.includes("thin_liquidity_relative_to_fdv")) {
triggeredRules.push("authority_plus_thin_liquidity_pattern");
}

if (matches.includes("coordinated_whale_pressure") && matches.includes("risk_trend_escalating")) {
triggeredRules.push("whale_pressure_with_risk_acceleration");
}

let radarScore = Math.round(
riskScore * 0.45 +
confidence * 0.3 +
Math.min(top10, 100) * 0.1 +
triggeredRules.length * 7
);

radarScore = Math.max(0, Math.min(100, radarScore));

let label = "Low Concern";
let state = "good";

if (radarScore >= 75) {
label = "High Threat Pattern";
state = "bad";
} else if (radarScore >= 45) {
label = "Elevated Threat Pattern";
state = "warn";
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
};
}
