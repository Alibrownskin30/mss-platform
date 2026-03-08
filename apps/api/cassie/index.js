import { createCassieMiddleware } from "./middleware.js";
import { buildCassieDna } from "./dna.js";
import {
rememberCassieScan,
getCassieMemoryByMint,
getCassieMemoryBySignature,
getCassieMemorySnapshot,
} from "./memory.js";
import { runCassieRadar } from "./radar.js";
import { runCassieSimulation } from "./simulate.js";

/**
* Cassie — defensive + intelligence layer for MSS Protocol
*
* Defensive:
* - request filtering
* - hostile automation friction
* - honeypot routing
*
* Intelligence:
* - DNA fingerprinting
* - hostile pattern radar
* - safe exploitability simulation
* - runtime memory for repeat structures
*
* Usage:
* const { cassie, cassieApi, cassieIntel } = createCassie();
* app.use(cassie);
* app.get("/api/cassie/status", authRequired, (req, res) => cassieApi.status(req, res));
*/

function safeNum(v, fallback = 0) {
const n = Number(v);
return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
return Math.max(min, Math.min(max, n));
}

function fmtPct(v, dp = 1) {
const n = Number(v);
if (!Number.isFinite(n)) return "0.0%";
return `${n.toFixed(dp)}%`;
}

function severityToTone(severity) {
if (severity === "high" || severity === "critical") return "bad";
if (severity === "medium" || severity === "warn") return "warn";
return "good";
}

function deriveCassieScore({
securityModel = {},
concentration = {},
activity = {},
market = {},
}) {
const riskScore = safeNum(securityModel?.score, 0);
const hiddenControl = safeNum(securityModel?.hiddenControl?.score, 0);
const developerConfidence = safeNum(
securityModel?.developerNetwork?.confidence ||
securityModel?.developerActivity?.confidence,
0
);
const walletConfidence = safeNum(securityModel?.walletNetwork?.confidence, 0);
const top10 = safeNum(concentration?.top10, 0);
const freshWalletPct = safeNum(securityModel?.freshWalletRisk?.pct, 0);
const liquidityFragility = 100 - safeNum(securityModel?.liquidityStability?.score, 0);
const activityScore = safeNum(activity?.score, 0);
const liqUsd = safeNum(market?.liquidityUsd, 0);

let score = 0;
score += riskScore * 0.26;
score += hiddenControl * 0.16;
score += developerConfidence * 0.14;
score += walletConfidence * 0.14;
score += Math.min(top10, 100) * 0.10;
score += Math.min(freshWalletPct * 2, 100) * 0.08;
score += Math.min(liquidityFragility, 100) * 0.07;
score += Math.min(activityScore, 100) * 0.05;

if (liqUsd > 0 && liqUsd < 25000) score += 4;
if (liqUsd > 0 && liqUsd < 10000) score += 4;

return clamp(Math.round(score), 0, 100);
}

function buildThreatMeta(score) {
if (score >= 85) {
return {
verdict: "Hostile Structure Likely",
threatLevel: "Critical",
state: "bad",
recommendedAction: "Avoid / escalate review",
summary:
"Cassie flags this structure as highly exposed to coordinated manipulation or exploit-style failure modes.",
};
}

if (score >= 65) {
return {
verdict: "Elevated Threat Surface",
threatLevel: "High",
state: "bad",
recommendedAction: "Defensive caution",
summary:
"Cassie sees elevated structural danger and recommends defensive caution before trust is extended.",
};
}

if (score >= 40) {
return {
verdict: "Caution",
threatLevel: "Moderate",
state: "warn",
recommendedAction: "Monitor closely",
summary:
"Cassie sees mixed structure with caution warranted, but not yet a maximum-danger profile.",
};
}

return {
verdict: "Defensive Posture Stable",
threatLevel: "Low",
state: "good",
recommendedAction: "Continue monitoring",
summary:
"Cassie sees a comparatively calmer structural profile in the current snapshot.",
};
}

function buildRiskFactors({
token = {},
market = {},
concentration = {},
securityModel = {},
activity = {},
threatMeta = {},
}) {
const out = [];

const mintRevoked = !!token?.safety?.mintRevoked;
const freezeRevoked = !!token?.safety?.freezeRevoked;
const top1 = safeNum(concentration?.top1, 0);
const top10 = safeNum(concentration?.top10, 0);
const hiddenControl = safeNum(securityModel?.hiddenControl?.score, 0);
const developerConfidence = safeNum(securityModel?.developerNetwork?.confidence, 0);
const developerLikelyControlPct = safeNum(
securityModel?.developerNetwork?.likelyControlPct,
0
);
const walletConfidence = safeNum(securityModel?.walletNetwork?.confidence, 0);
const walletControlPct = safeNum(
securityModel?.walletNetwork?.controlEstimatePct,
0
);
const liqFdvPct = safeNum(securityModel?.liquidityStability?.liqFdvPct, 0);
const liqUsd = safeNum(market?.liquidityUsd, 0);
const freshWalletPct = safeNum(securityModel?.freshWalletRisk?.pct, 0);
const whaleScore = safeNum(securityModel?.whaleActivity?.score, 0);
const trendMomentum = securityModel?.trend?.momentum || "Stable";

if (!mintRevoked) {
out.push({
tone: "bad",
severity: "high",
text: "Mint authority is still active.",
});
}

if (!freezeRevoked) {
out.push({
tone: "bad",
severity: "high",
text: "Freeze authority is still active.",
});
}

if (top10 >= 55) {
out.push({
tone: top10 >= 70 ? "bad" : "warn",
severity: top10 >= 70 ? "high" : "medium",
text: `Top10 concentration is ${top10.toFixed(2)}%, implying whale-dominant structure.`,
});
}

if (top1 >= 25) {
out.push({
tone: top1 >= 35 ? "bad" : "warn",
severity: top1 >= 35 ? "high" : "medium",
text: `Top1 holder concentration is ${top1.toFixed(2)}%.`,
});
}

if (hiddenControl >= 40) {
out.push({
tone: hiddenControl >= 70 ? "bad" : "warn",
severity: hiddenControl >= 70 ? "high" : "medium",
text: `Hidden-control score is ${hiddenControl}/100.`,
});
}

if (developerConfidence >= 35) {
out.push({
tone: developerConfidence >= 75 ? "bad" : "warn",
severity: developerConfidence >= 75 ? "high" : "medium",
text:
developerLikelyControlPct > 0
? `Developer-network confidence is ${developerConfidence}/100 with likely coordinated influence around ${fmtPct(developerLikelyControlPct, 1)}.`
: `Developer-network confidence is ${developerConfidence}/100.`,
});
}

if (walletConfidence >= 45) {
out.push({
tone: walletConfidence >= 75 ? "bad" : "warn",
severity: walletConfidence >= 75 ? "high" : "medium",
text:
walletControlPct > 0
? `Wallet-network confidence is ${walletConfidence}/100 with estimated coordinated influence around ${fmtPct(walletControlPct, 1)}.`
: `Wallet-network confidence is ${walletConfidence}/100.`,
});
}

if (freshWalletPct >= 20) {
out.push({
tone: freshWalletPct >= 35 ? "bad" : "warn",
severity: freshWalletPct >= 35 ? "high" : "medium",
text: `Fresh-wallet concentration is elevated at ${fmtPct(freshWalletPct, 1)}.`,
});
}

if (liqFdvPct > 0 && liqFdvPct < 3) {
out.push({
tone: liqFdvPct < 1 ? "bad" : "warn",
severity: liqFdvPct < 1 ? "high" : "medium",
text: `Liquidity appears thin relative to FDV at ${fmtPct(liqFdvPct, 2)}.`,
});
}

if (liqUsd > 0 && liqUsd < 25000) {
out.push({
tone: liqUsd < 10000 ? "bad" : "warn",
severity: liqUsd < 10000 ? "high" : "medium",
text: `Visible liquidity is low at $${liqUsd.toFixed(2)}.`,
});
}

if (whaleScore >= 40) {
out.push({
tone: whaleScore >= 70 ? "bad" : "warn",
severity: whaleScore >= 70 ? "high" : "medium",
text: `Whale coordination pressure is elevated at ${whaleScore}/100.`,
});
}

if (trendMomentum === "Escalating" || trendMomentum === "Rising") {
out.push({
tone: trendMomentum === "Escalating" ? "bad" : "warn",
severity: trendMomentum === "Escalating" ? "high" : "medium",
text: `Risk trend is ${trendMomentum.toLowerCase()}.`,
});
}

if (!out.length) {
out.push({
tone: threatMeta?.state || "good",
severity: "low",
text: "No single dominant structural risk factor is overwhelming the current snapshot.",
});
}

return out;
}

function buildCoreSignals({
securityModel = {},
concentration = {},
}) {
const out = [];

const hiddenControl = safeNum(securityModel?.hiddenControl?.score, 0);
const linkedWallets = safeNum(securityModel?.hiddenControl?.linkedWallets, 0);
const developerDetected = !!securityModel?.developerActivity?.detected;
const developerScore = safeNum(
securityModel?.developerNetwork?.confidence ||
securityModel?.developerActivity?.score,
0
);
const developerWallets = safeNum(
securityModel?.developerNetwork?.linkedWallets ||
securityModel?.developerActivity?.linkedWallets,
0
);
const freshWalletPct = safeNum(securityModel?.freshWalletRisk?.pct, 0);
const liquidityState = securityModel?.liquidityStability?.state || "warn";
const liquidityRemovableRisk =
securityModel?.liquidityStability?.removableRisk || "Unknown";
const walletNetworkConfidence = safeNum(securityModel?.walletNetwork?.confidence, 0);
const walletNetworkControl = safeNum(
securityModel?.walletNetwork?.controlEstimatePct,
0
);
const top10 = safeNum(concentration?.top10, 0);

if (hiddenControl >= 40) {
out.push({
tone: hiddenControl >= 70 ? "bad" : "warn",
text: `Hidden control risk ${hiddenControl}/100 with ${linkedWallets} linked wallets.`,
});
} else {
out.push({
tone: "good",
text: "No strong hidden-control dominance detected in current structure.",
});
}

if (developerDetected) {
out.push({
tone: developerScore >= 65 ? "bad" : "warn",
text: `Developer-linked network detected across ${developerWallets} wallets with confidence ${developerScore}/100.`,
});
} else {
out.push({
tone: "good",
text: "No dominant developer-linked wallet network detected in this snapshot.",
});
}

if (walletNetworkConfidence >= 45) {
out.push({
tone: walletNetworkConfidence >= 75 ? "bad" : "warn",
text:
walletNetworkControl > 0
? `Wallet-control map confidence ${walletNetworkConfidence}/100 with estimated influence around ${fmtPct(walletNetworkControl, 1)}.`
: `Wallet-control map confidence ${walletNetworkConfidence}/100.`,
});
} else {
out.push({
tone: "good",
text: "Wallet-control map does not currently indicate dominant coordinated influence.",
});
}

if (freshWalletPct >= 20) {
out.push({
tone: freshWalletPct >= 35 ? "bad" : "warn",
text: `Fresh-wallet concentration elevated at ${fmtPct(freshWalletPct, 1)}.`,
});
}

if (top10 >= 55) {
out.push({
tone: top10 >= 70 ? "bad" : "warn",
text: `Top10 concentration sits at ${top10.toFixed(2)}%.`,
});
}

if (liquidityState === "bad") {
out.push({
tone: "bad",
text: `Liquidity stability is weak with removable risk marked ${liquidityRemovableRisk}.`,
});
} else if (liquidityState === "good") {
out.push({
tone: "good",
text: "Liquidity stability currently reads as comparatively strong.",
});
} else {
out.push({
tone: "warn",
text: `Liquidity stability is on watch with removable risk marked ${liquidityRemovableRisk}.`,
});
}

return out.slice(0, 6);
}

function buildSimulationSignals(simulation = {}) {
const out = [];
const outcomes = Array.isArray(simulation?.outcomes) ? simulation.outcomes : [];

if (outcomes.length) {
for (const item of outcomes.slice(0, 6)) {
out.push({
tone: severityToTone(item?.severity),
text: item?.summary || item?.label || "Simulation signal recorded.",
});
}
} else {
out.push({
tone: "warn",
text: "No detailed simulation outcomes returned yet.",
});
}

return out;
}

function buildRadarSignals(radar = {}, securityModel = {}, memory = null) {
const out = [];
const radarList = Array.isArray(radar?.signals) ? radar.signals : [];

if (radarList.length) {
for (const item of radarList.slice(0, 5)) {
out.push({
tone: item?.tone || item?.level || "warn",
text: item?.text || item?.summary || "Cassie radar signal recorded.",
});
}
}

const reputationLabel = securityModel?.reputation?.label || "unknown";
const reputationScore = securityModel?.reputation?.score ?? "—";
out.push({
tone:
securityModel?.reputation?.score >= 70
? "good"
: securityModel?.reputation?.score >= 45
? "warn"
: "bad",
text: `Reputation layer reads ${String(reputationLabel).toLowerCase()} at ${reputationScore}/100.`,
});

if (memory?.seenCount) {
out.push({
tone: memory.seenCount >= 4 ? "warn" : "good",
text: `Cassie memory has seen this structure ${memory.seenCount} time(s).`,
});
}

if (!out.length) {
out.push({
tone: "warn",
text: "Cassie radar is active but no additional flagged repeat-patterns were surfaced here.",
});
}

return out.slice(0, 6);
}

export function createCassie(opts = {}) {
const cassie = createCassieMiddleware(opts);

const cassieIntel = {
analyze({
mint,
token = {},
market = {},
concentration = {},
activity = {},
securityModel = {},
trend = {},
}) {
const derivedCassieScore = deriveCassieScore({
securityModel,
concentration,
activity,
market,
});

const threatMeta = buildThreatMeta(derivedCassieScore);

const dnaResult = buildCassieDna({
mint,
token,
market,
concentration,
activity,
securityModel,
trend,
});

const radar = runCassieRadar({
cassieDna: dnaResult.cassieDna,
securityModel,
concentration,
activity,
market,
trend,
});

const simulation = runCassieSimulation({
token,
market,
concentration,
securityModel,
activity,
trend,
});

rememberCassieScan({
mint,
cassieDna: dnaResult.cassieDna,
securityModel,
radar,
simulation,
});

const memory = getCassieMemoryByMint(mint);

const riskFactors = buildRiskFactors({
token,
market,
concentration,
securityModel,
activity,
threatMeta,
});

const coreSignals = buildCoreSignals({
securityModel,
concentration,
});

const simulationSignals = buildSimulationSignals(simulation);
const radarSignals = buildRadarSignals(radar, securityModel, memory);

const confidenceBase = clamp(
Math.round(
Math.min(
100,
48 +
safeNum(activity?.score, 0) * 0.18 +
safeNum(securityModel?.reputation?.score, 0) * 0.14 +
safeNum(securityModel?.developerNetwork?.confidence, 0) * 0.10 +
safeNum(securityModel?.walletNetwork?.confidence, 0) * 0.10 +
(memory?.seenCount ? Math.min(memory.seenCount * 4, 15) : 0) +
Math.min(riskFactors.length * 2, 10)
)
),
0,
99
);

return {
enabled: true,
dna: dnaResult.cassieDna,
radar,
simulation,
memory,
score: derivedCassieScore,
confidence: confidenceBase,
threatLevel: threatMeta.threatLevel,
status: threatMeta.verdict,
state: threatMeta.state,
pattern:
memory?.topPattern ||
dnaResult?.cassieDna?.pattern ||
(safeNum(securityModel?.developerNetwork?.confidence, 0) >= 55
? "Developer-linked control pattern"
: safeNum(securityModel?.walletNetwork?.confidence, 0) >= 55
? "Wallet-network influence pattern"
: safeNum(securityModel?.hiddenControl?.score, 0) >= 40
? "Linked control pattern"
: safeNum(concentration?.top10, 0) >= 55
? "Concentrated holder pattern"
: "No dominant hostile pattern"),
recommendedAction: threatMeta.recommendedAction,
summary: threatMeta.summary,
riskFactors: riskFactors.map((x) => ({
label: x.text,
severity: x.severity || (x.tone === "bad" ? "high" : x.tone === "warn" ? "medium" : "low"),
})),
memoryHits: memory?.hits || [],
simulations: Array.isArray(simulation?.outcomes)
? simulation.outcomes
: [],
radarSignals: Array.isArray(radar?.signals)
? radar.signals
: [],
verdict: threatMeta.verdict,
synthesis: {
verdict: threatMeta.verdict,
threatLevel: threatMeta.threatLevel,
confidence: `${confidenceBase}/100`,
summary: threatMeta.summary,
coreSignals,
simulationSignals,
riskFactors,
radarSignals,
},
};
},

memoryByMint(mint) {
return getCassieMemoryByMint(mint);
},

memoryBySignature(signature) {
return getCassieMemoryBySignature(signature);
},

memorySnapshot(limit = 50) {
return getCassieMemorySnapshot(limit);
},
};

const cassieApi = {
status(req, res) {
const snap =
typeof cassie.getSnapshot === "function"
? cassie.getSnapshot()
: typeof req.__cassieGetSnapshot === "function"
? req.__cassieGetSnapshot()
: null;

res.json({
ok: true,
cassie: snap || { enabled: true },
});
},
};

return { cassie, cassieApi, cassieIntel };
}