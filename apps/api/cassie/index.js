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

const verdict =
securityModel?.score >= 80
? "Hostile Structure Likely"
: securityModel?.score >= 55
? "Elevated Threat Surface"
: securityModel?.score >= 30
? "Caution"
: "Defensive Posture Stable";

const threatLevel =
securityModel?.score >= 80
? "Critical"
: securityModel?.score >= 60
? "High"
: securityModel?.score >= 35
? "Moderate"
: "Low";

const confidenceBase = Math.round(
Math.min(
100,
45 +
Number(activity?.score || 0) * 0.25 +
Number(securityModel?.reputation?.score || 0) * 0.20 +
(memory?.seenCount ? Math.min(memory.seenCount * 4, 15) : 0)
)
);

const coreSignals = [];
const simulationSignals = [];
const riskFactors = [];
const radarSignals = [];

if (securityModel?.hiddenControl?.score >= 40) {
coreSignals.push({
tone: securityModel.hiddenControl.score >= 70 ? "bad" : "warn",
text: `Hidden control risk ${securityModel.hiddenControl.score}/100 with ${securityModel.hiddenControl.linkedWallets ?? 0} linked wallets.`,
});
} else {
coreSignals.push({
tone: "good",
text: "No strong hidden-control dominance detected in current structure.",
});
}

if (securityModel?.developerActivity?.detected) {
coreSignals.push({
tone: securityModel.developerActivity.score >= 65 ? "bad" : "warn",
text: `Possible developer-linked overlap detected across ${securityModel.developerActivity.linkedWallets ?? 0} wallets.`,
});
}

if (securityModel?.freshWalletRisk?.pct >= 20) {
coreSignals.push({
tone: securityModel.freshWalletRisk.score >= 65 ? "bad" : "warn",
text: `Fresh-wallet concentration elevated at ${securityModel.freshWalletRisk.pct}%.`,
});
}

if (securityModel?.liquidityStability?.state === "bad") {
coreSignals.push({
tone: "bad",
text: `Liquidity stability is weak with removable risk marked ${securityModel.liquidityStability.removableRisk}.`,
});
} else if (securityModel?.liquidityStability?.state === "good") {
coreSignals.push({
tone: "good",
text: "Liquidity stability currently reads as comparatively strong.",
});
}

if (simulation?.outcomes?.length) {
for (const item of simulation.outcomes.slice(0, 4)) {
simulationSignals.push({
tone: item.severity === "high" ? "bad" : item.severity === "medium" ? "warn" : "good",
text: item.summary || item.label || "Simulation signal recorded.",
});
}
} else {
simulationSignals.push({
tone: "warn",
text: "No detailed simulation outcomes returned yet.",
});
}

if (securityModel?.trend?.momentum === "Escalating" || securityModel?.trend?.label === "Escalating") {
riskFactors.push({
tone: "bad",
text: `Risk trend is escalating with 1h delta ${securityModel?.trend?.delta1h ?? "—"} and 24h delta ${securityModel?.trend?.delta24h ?? "—"}.`,
});
}

if (Number(concentration?.top10 || 0) >= 55) {
riskFactors.push({
tone: Number(concentration.top10) >= 70 ? "bad" : "warn",
text: `Top10 concentration is ${Number(concentration.top10).toFixed(2)}%, implying whale-dominant structure.`,
});
}

if (Number(concentration?.top1 || 0) >= 25) {
riskFactors.push({
tone: Number(concentration.top1) >= 35 ? "bad" : "warn",
text: `Top1 holder concentration is ${Number(concentration.top1).toFixed(2)}%.`,
});
}

if (!riskFactors.length) {
riskFactors.push({
tone: "good",
text: "No single dominant structural risk factor is overwhelming the current snapshot.",
});
}

if (radar?.signals?.length) {
for (const item of radar.signals.slice(0, 4)) {
radarSignals.push({
tone: item.tone || item.level || "warn",
text: item.text || item.summary || "Cassie radar signal recorded.",
});
}
} else {
radarSignals.push({
tone: "warn",
text: "Cassie radar is active but no additional flagged repeat-patterns were surfaced here.",
});
}

return {
dna: dnaResult.cassieDna,
radar,
simulation,
memory,
synthesis: {
verdict,
threatLevel,
confidence: `${confidenceBase}/100`,
summary:
threatLevel === "Critical"
? "Cassie flags this structure as highly exposed to coordinated manipulation or exploit-style failure modes."
: threatLevel === "High"
? "Cassie sees elevated structural danger and recommends defensive caution before trust is extended."
: threatLevel === "Moderate"
? "Cassie sees mixed structure with caution warranted, but not yet a maximum-danger profile."
: "Cassie sees a comparatively calmer structural profile in the current snapshot.",
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
: (typeof req.__cassieGetSnapshot === "function"
? req.__cassieGetSnapshot()
: null);

res.json({
ok: true,
cassie: snap || { enabled: true },
});
},
};

return { cassie, cassieApi, cassieIntel };
}