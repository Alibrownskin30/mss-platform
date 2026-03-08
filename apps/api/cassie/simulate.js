function safeNum(v, fallback = 0) {
const n = Number(v);
return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
return Math.max(min, Math.min(max, n));
}

function severityFromScore(score) {
if (score >= 75) return "high";
if (score >= 40) return "medium";
return "low";
}

function labelFromScore(score) {
if (score >= 75) return "High Exploitability Surface";
if (score >= 40) return "Moderate Exploitability Surface";
return "Lower Exploitability Surface";
}

export function runCassieSimulation({
token = {},
market = {},
concentration = {},
securityModel = {},
activity = {},
trend = {},
}) {
const mintRevoked = !!token?.safety?.mintRevoked;
const freezeRevoked = !!token?.safety?.freezeRevoked;

const liqUsd = safeNum(market?.liquidityUsd, 0);
const fdv = safeNum(market?.fdv, 0);
const liqFdvPct = safeNum(securityModel?.liquidityStability?.liqFdvPct, fdv > 0 ? (liqUsd / fdv) * 100 : 0);

const top1 = safeNum(concentration?.top1, 0);
const top10 = safeNum(concentration?.top10, 0);

const hiddenControlScore = safeNum(securityModel?.hiddenControl?.score, 0);
const hiddenLinkedWallets = safeNum(securityModel?.hiddenControl?.linkedWallets, 0);

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
const developerLinkedWallets = safeNum(
securityModel?.developerNetwork?.linkedWallets ||
securityModel?.developerActivity?.linkedWallets,
0
);

const walletNetworkConfidence = safeNum(securityModel?.walletNetwork?.confidence, 0);
const walletNetworkControlEstimatePct = safeNum(
securityModel?.walletNetwork?.controlEstimatePct,
0
);
const walletNetworkLinkedWallets = safeNum(
securityModel?.walletNetwork?.linkedWallets,
0
);

const whaleScore = safeNum(securityModel?.whaleActivity?.score, 0);
const syncBurstSize = safeNum(securityModel?.whaleActivity?.syncBurstSize, 0);

const freshWalletPct = safeNum(securityModel?.freshWalletRisk?.pct, 0);
const freshWalletCount = safeNum(securityModel?.freshWalletRisk?.walletCount, 0);

const trendMomentum =
securityModel?.trend?.momentum ||
trend?.momentum ||
trend?.trend?.momentum ||
"Stable";

const trendDelta24 =
safeNum(securityModel?.trend?.delta24h, trend?.change?.["24h"]);

const outcomes = [];

const authorityAbuseScore =
(!mintRevoked ? 55 : 0) + (!freezeRevoked ? 45 : 0);

outcomes.push({
id: "authority_abuse",
label: "Authority Abuse Simulation",
severity: severityFromScore(authorityAbuseScore),
score: clamp(authorityAbuseScore, 0, 100),
possible: !mintRevoked || !freezeRevoked,
summary:
!mintRevoked || !freezeRevoked
? !mintRevoked && !freezeRevoked
? "Mint and freeze authorities remain active, preserving a large post-launch control surface."
: !mintRevoked
? "Mint authority remains active, preserving supply-expansion risk."
: "Freeze authority remains active, preserving transfer-control risk."
: "No live mint or freeze authority exposure detected.",
detail: {
mintAuthorityActive: !mintRevoked,
freezeAuthorityActive: !freezeRevoked,
},
});

let liquidityShockScore = 0;
if (liqUsd <= 0 || liqFdvPct <= 0) liquidityShockScore = 42;
else if (liqFdvPct < 1) liquidityShockScore = 88;
else if (liqFdvPct < 3) liquidityShockScore = 72;
else if (liqFdvPct < 5) liquidityShockScore = 56;
else if (liqFdvPct < 8) liquidityShockScore = 38;
else liquidityShockScore = 18;

outcomes.push({
id: "liquidity_shock",
label: "Liquidity Shock Simulation",
severity: severityFromScore(liquidityShockScore),
score: clamp(liquidityShockScore, 0, 100),
possible: true,
summary:
liqUsd <= 0 || liqFdvPct <= 0
? "Liquidity visibility is limited, so Cassie cannot rule out fragility."
: liqFdvPct < 3
? `Liquidity appears fragile at ${liqFdvPct.toFixed(2)}% of FDV and could break quickly under pressure.`
: liqFdvPct < 8
? `Liquidity appears only moderately resilient at ${liqFdvPct.toFixed(2)}% of FDV.`
: `Liquidity appears more resilient at ${liqFdvPct.toFixed(2)}% of FDV.`,
detail: {
liquidityUsd: liqUsd,
liqFdvPct,
},
});

let concentrationExitScore = 0;
if (top10 >= 80) concentrationExitScore = 90;
else if (top10 >= 70) concentrationExitScore = 80;
else if (top10 >= 55) concentrationExitScore = 64;
else if (top10 >= 40) concentrationExitScore = 42;
else concentrationExitScore = 18;

if (top1 >= 35) concentrationExitScore += 8;
else if (top1 >= 25) concentrationExitScore += 4;

concentrationExitScore = clamp(concentrationExitScore, 0, 100);

outcomes.push({
id: "concentration_exit",
label: "Concentration Exit Simulation",
severity: severityFromScore(concentrationExitScore),
score: concentrationExitScore,
possible: top10 >= 40 || top1 >= 20,
summary:
top10 >= 70
? `Top10 concentration is ${top10.toFixed(2)}%, so coordinated exits could heavily distort price.`
: top10 >= 55
? `Top10 concentration is ${top10.toFixed(2)}%, implying meaningful exit pressure risk.`
: "Holder distribution looks comparatively less exposed to a single concentrated exit wave.",
detail: {
top1,
top10,
},
});

let hiddenControlScoreSim = hiddenControlScore;
if (hiddenLinkedWallets >= 6) hiddenControlScoreSim += 8;
else if (hiddenLinkedWallets >= 3) hiddenControlScoreSim += 4;
hiddenControlScoreSim = clamp(hiddenControlScoreSim, 0, 100);

outcomes.push({
id: "hidden_control_execution",
label: "Hidden Control Execution Simulation",
severity: severityFromScore(hiddenControlScoreSim),
score: hiddenControlScoreSim,
possible: hiddenControlScore >= 25 || hiddenLinkedWallets >= 2,
summary:
hiddenControlScore >= 70
? `Hidden-control score is ${hiddenControlScore}/100 with ${hiddenLinkedWallets} linked wallets, indicating a strong coordinated-structure risk.`
: hiddenControlScore >= 45
? `Hidden-control score is ${hiddenControlScore}/100, suggesting coordinated influence should be treated seriously.`
: "No dominant hidden-control execution pattern is currently leading the simulation.",
detail: {
hiddenControlScore,
hiddenLinkedWallets,
},
});

let developerExitScore = developerConfidence;
if (developerLikelyControlPct >= 45) developerExitScore += 18;
else if (developerLikelyControlPct >= 25) developerExitScore += 10;

if (developerLinkedWallets >= 6) developerExitScore += 8;
else if (developerLinkedWallets >= 3) developerExitScore += 4;

developerExitScore = clamp(developerExitScore, 0, 100);

outcomes.push({
id: "developer_network_exit",
label: "Developer Network Exit Simulation",
severity: severityFromScore(developerExitScore),
score: developerExitScore,
possible: developerConfidence >= 25 || developerLinkedWallets >= 2,
summary:
developerConfidence >= 75
? `Developer-network confidence is ${developerConfidence}/100 with likely coordinated influence around ${developerLikelyControlPct.toFixed(1)}%.`
: developerConfidence >= 55
? `Developer-network confidence is ${developerConfidence}/100, indicating elevated operator-linked exit risk.`
: developerConfidence >= 35
? "Developer-linked behavior is present and should be monitored for coordinated exits."
: "No dominant developer-network exit structure is surfaced in this simulation.",
detail: {
developerConfidence,
developerLikelyControlPct,
developerLinkedWallets,
},
});

let walletNetworkScore = walletNetworkConfidence;
if (walletNetworkControlEstimatePct >= 45) walletNetworkScore += 16;
else if (walletNetworkControlEstimatePct >= 25) walletNetworkScore += 8;

if (walletNetworkLinkedWallets >= 6) walletNetworkScore += 8;
else if (walletNetworkLinkedWallets >= 3) walletNetworkScore += 4;

walletNetworkScore = clamp(walletNetworkScore, 0, 100);

outcomes.push({
id: "wallet_network_coordination",
label: "Wallet Network Coordination Simulation",
severity: severityFromScore(walletNetworkScore),
score: walletNetworkScore,
possible: walletNetworkConfidence >= 25 || walletNetworkLinkedWallets >= 2,
summary:
walletNetworkConfidence >= 75
? `Wallet-control map confidence is ${walletNetworkConfidence}/100 with estimated coordinated influence around ${walletNetworkControlEstimatePct.toFixed(1)}%.`
: walletNetworkConfidence >= 45
? "Wallet-control map suggests a meaningful coordinated-wallet influence pattern."
: "Wallet-control map does not currently indicate dominant coordinated influence.",
detail: {
walletNetworkConfidence,
walletNetworkControlEstimatePct,
walletNetworkLinkedWallets,
},
});

let whaleCascadeScore = whaleScore;
if (syncBurstSize >= 6) whaleCascadeScore += 12;
else if (syncBurstSize >= 3) whaleCascadeScore += 6;

whaleCascadeScore = clamp(whaleCascadeScore, 0, 100);

outcomes.push({
id: "whale_cascade",
label: "Whale Cascade Simulation",
severity: severityFromScore(whaleCascadeScore),
score: whaleCascadeScore,
possible: whaleScore >= 25 || syncBurstSize >= 3,
summary:
whaleScore >= 70
? `Whale pressure is ${whaleScore}/100 with sync burst size ${syncBurstSize}, implying elevated cascade risk.`
: whaleScore >= 40
? "Whale activity is active enough to produce moderate cascade pressure."
: "Whale-coordination pressure is not currently the dominant simulation driver.",
detail: {
whaleScore,
syncBurstSize,
},
});

let trendEscalationScore = 0;
if (trendMomentum === "Escalating") trendEscalationScore = 82;
else if (trendMomentum === "Rising") trendEscalationScore = 62;
else if (trendDelta24 >= 10) trendEscalationScore = 66;
else if (trendDelta24 >= 5) trendEscalationScore = 42;
else if (trendMomentum === "Softening" || trendMomentum === "Cooling") trendEscalationScore = 18;
else trendEscalationScore = 28;

outcomes.push({
id: "trend_escalation",
label: "Trend Escalation Simulation",
severity: severityFromScore(trendEscalationScore),
score: clamp(trendEscalationScore, 0, 100),
possible: true,
summary:
trendMomentum === "Escalating"
? `Risk momentum is escalating with 24h delta ${trendDelta24}.`
: trendMomentum === "Rising"
? `Risk momentum is rising with 24h delta ${trendDelta24}.`
: trendMomentum === "Softening" || trendMomentum === "Cooling"
? "Trend pressure looks softer in the current snapshot."
: "Trend pressure is comparatively stable in the current snapshot.",
detail: {
trendMomentum,
trendDelta24,
},
});

let freshWalletStressScore = 0;
if (freshWalletPct >= 45) freshWalletStressScore = 74;
else if (freshWalletPct >= 25) freshWalletStressScore = 52;
else if (freshWalletPct >= 15) freshWalletStressScore = 34;
else freshWalletStressScore = 16;

outcomes.push({
id: "fresh_wallet_stress",
label: "Fresh Wallet Stress Simulation",
severity: severityFromScore(freshWalletStressScore),
score: clamp(freshWalletStressScore, 0, 100),
possible: freshWalletPct >= 10 || freshWalletCount >= 2,
summary:
freshWalletPct >= 25
? `Fresh-wallet concentration is ${freshWalletPct.toFixed(1)}% across ${freshWalletCount} wallets, increasing trust-quality fragility.`
: "Fresh-wallet pressure is present but not dominant in this simulation.",
detail: {
freshWalletPct,
freshWalletCount,
},
});

const scenarioScores = outcomes.map((o) => safeNum(o.score, 0));
const weightedScore =
scenarioScores.length > 0
? scenarioScores.reduce((a, b) => a + b, 0) / scenarioScores.length
: 0;

const topScenario = [...outcomes].sort((a, b) => safeNum(b.score, 0) - safeNum(a.score, 0))[0] || null;
const highCount = outcomes.filter((o) => o.severity === "high").length;
const mediumCount = outcomes.filter((o) => o.severity === "medium").length;

const simulationScore = clamp(
Math.round(weightedScore + highCount * 4 + mediumCount * 2),
0,
100
);

return {
ok: true,
mode: "safe_read_only",
note:
"Cassie simulation is non-signing and read-only. It does not submit transactions or alter chain state.",
score: simulationScore,
label: labelFromScore(simulationScore),
outcomes,
scenarios: outcomes,
summary:
topScenario
? `Primary simulation driver: ${topScenario.label} (${topScenario.score}/100).`
: "No simulation outcomes were generated.",
meta: {
totalScenarios: outcomes.length,
highSeverityCount: highCount,
mediumSeverityCount: mediumCount,
lowSeverityCount: outcomes.filter((o) => o.severity === "low").length,
},
};
}
