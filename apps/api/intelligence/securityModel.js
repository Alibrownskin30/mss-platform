function clamp(n, a, b) {
return Math.max(a, Math.min(b, n));
}

function band(score) {
if (score >= 80) return { text: "Critical Risk", state: "bad", signal: "High Alert" };
if (score >= 60) return { text: "High Risk", state: "bad", signal: "High Alert" };
if (score >= 40) return { text: "Elevated Risk", state: "warn", signal: "Caution" };
return { text: "Lower Exposure", state: "good", signal: "Normal" };
}

function repBand(score) {
if (score >= 70) return "Established";
if (score >= 45) return "Developing";
return "Unproven";
}

export function buildSecurityModel({
concentration,
token,
activity,
market,
trend,
}) {
const signals = [];
const top1 = Number(concentration?.top1 || 0);
const top10 = Number(concentration?.top10 || 0);
const top20 = Number(concentration?.top20 || 0);

const mintRevoked = !!token?.safety?.mintRevoked;
const freezeRevoked = !!token?.safety?.freezeRevoked;

const liq = Number(market?.liquidityUsd || 0);
const fdv = Number(market?.fdv || 0);
const vol24 = Number(market?.volume24h || 0);
const liqFdvPct = fdv > 0 ? (liq / fdv) * 100 : 0;
const volLiq = liq > 0 ? vol24 / liq : 0;

const hiddenControlScore = Number(activity?.hiddenControl?.score || 0);
const linkedWallets = Number(activity?.hiddenControl?.linkedWallets || 0);
const linkedWalletPct = Number(activity?.hiddenControl?.linkedWalletPct || 0);

const freshWalletPct = Number(activity?.freshWalletRisk?.pct || 0);
const freshWalletCount = Number(activity?.freshWalletRisk?.walletCount || 0);

const developerLinked = !!activity?.developer?.overlapDetected;
const developerLinkedWallets = Number(activity?.developer?.linkedWalletsEstimate || 0);

const developerNetworkDetected = !!activity?.developerNetwork?.detected;
const developerNetworkConfidence = Number(activity?.developerNetwork?.confidence || 0);
const developerNetworkLinkedWallets = Number(activity?.developerNetwork?.linkedWallets || 0);
const developerNetworkLikelyControlPct = Number(activity?.developerNetwork?.likelyControlPct || 0);
const developerNetworkFundingShared = !!activity?.developerNetwork?.fundingSourceShared;
const developerNetworkLabel = activity?.developerNetwork?.label || "No Clear Developer Network";
const developerNetworkState = activity?.developerNetwork?.state || "good";
const developerNetworkNotes = Array.isArray(activity?.developerNetwork?.notes)
? activity.developerNetwork.notes
: [];

const walletNetwork = activity?.walletNetwork || {};
const walletNetworkConfidence = Number(walletNetwork?.confidence || 0);
const walletNetworkConfidenceLabel = walletNetwork?.confidenceLabel || "Low";
const walletNetworkControlEstimatePct = Number(walletNetwork?.controlEstimatePct || 0);
const walletNetworkPrimaryWallet = walletNetwork?.primaryWallet || null;
const walletNetworkPrimaryClusterId = walletNetwork?.primaryClusterId || null;
const walletNetworkRole = walletNetwork?.role || "Observed wallet";
const walletNetworkSharedFundingDetected = !!walletNetwork?.sharedFundingDetected;

const syncBurstSize = Number(activity?.whaleActivity?.syncBurstSize || 0);

let score = 0;

if (!mintRevoked) {
score += 16;
signals.push("Mint authority active");
}

if (!freezeRevoked) {
score += 12;
signals.push("Freeze authority active");
}

if (top1 > 35) {
score += 12;
signals.push("Top holder concentration elevated");
} else if (top1 > 20) {
score += 6;
}

if (top10 > 55) {
score += 14;
signals.push("Top10 concentration elevated");
} else if (top10 > 40) {
score += 8;
}

if (top20 > 75) {
score += 6;
}

if (hiddenControlScore >= 70) {
score += 22;
signals.push("Hidden control structure detected");
} else if (hiddenControlScore >= 45) {
score += 12;
signals.push("Wallet linkage pattern detected");
} else if (hiddenControlScore >= 25) {
score += 5;
}

if (freshWalletPct >= 45) {
score += 12;
signals.push("Fresh wallet concentration elevated");
} else if (freshWalletPct >= 20) {
score += 6;
}

if (developerNetworkDetected) {
if (developerNetworkConfidence >= 75) {
score += 18;
signals.push("Strong developer-linked wallet network detected");
} else if (developerNetworkConfidence >= 55) {
score += 12;
signals.push("Elevated developer-linked wallet network detected");
} else {
score += 7;
signals.push("Weak developer linkage pattern detected");
}

if (developerNetworkLikelyControlPct >= 40) {
score += 8;
signals.push("Developer-linked network controls meaningful wallet share");
} else if (developerNetworkLikelyControlPct >= 20) {
score += 4;
}

if (developerNetworkFundingShared) {
score += 4;
}
} else if (developerLinked) {
score += 8;
signals.push("Possible developer-linked holder overlap");
}

if (walletNetworkConfidence >= 75) {
score += 10;
signals.push("Wallet network control confidence is high");
} else if (walletNetworkConfidence >= 45) {
score += 5;
signals.push("Wallet network control structure detected");
}

if (walletNetworkControlEstimatePct >= 45) {
score += 8;
signals.push("Wallet network suggests concentrated coordinated influence");
} else if (walletNetworkControlEstimatePct >= 25) {
score += 4;
}

if (walletNetworkSharedFundingDetected && !developerNetworkFundingShared) {
score += 3;
}

let liquidityStability = {
score: 70,
label: "Stable",
state: "good",
liqFdvPct: Number(liqFdvPct.toFixed(2)),
removableRisk: "Unknown",
};

if (!(liq > 0) || !(fdv > 0)) {
liquidityStability = {
score: 35,
label: "Unknown",
state: "warn",
liqFdvPct: 0,
removableRisk: "Unknown",
};
score += 8;
} else if (liqFdvPct < 1) {
liquidityStability = {
score: 12,
label: "Weak",
state: "bad",
liqFdvPct: Number(liqFdvPct.toFixed(2)),
removableRisk: "High",
};
score += 14;
signals.push("Liquidity thin vs valuation");
} else if (liqFdvPct < 3) {
liquidityStability = {
score: 28,
label: "Fragile",
state: "warn",
liqFdvPct: Number(liqFdvPct.toFixed(2)),
removableRisk: "Moderate",
};
score += 9;
} else if (liqFdvPct < 8) {
liquidityStability = {
score: 55,
label: "Watchlist",
state: "warn",
liqFdvPct: Number(liqFdvPct.toFixed(2)),
removableRisk: "Moderate",
};
score += 4;
}

const whalePressureScore = clamp(
Math.round((Math.max(0, syncBurstSize - 2) * 8) + Math.max(0, volLiq - 1) * 4),
0,
100
);

let whaleActivity = {
score: whalePressureScore,
label: "Normal",
state: "good",
syncBurstSize,
pressure: "Balanced",
};

if (whalePressureScore >= 65) {
whaleActivity = {
score: whalePressureScore,
label: "Elevated",
state: "bad",
syncBurstSize,
pressure: "Coordinated / heavy flow",
};
score += 10;
signals.push("Elevated whale coordination or churn");
} else if (whalePressureScore >= 35) {
whaleActivity = {
score: whalePressureScore,
label: "Watchlist",
state: "warn",
syncBurstSize,
pressure: "Active",
};
score += 5;
}

const trend24 = Number(trend?.change?.["24h"] ?? 0);
let trendLabel = "Stable";

if (trend24 >= 10) {
trendLabel = "Escalating";
score += 4;
signals.push("Risk trend increasing");
} else if (trend24 <= -10) {
trendLabel = "Improving";
}

score = clamp(Math.round(score), 0, 100);

const headline = band(score);
const whaleDominance = clamp(Math.round((top10 / 80) * 100), 0, 100);

const reputationBase = 100 - Math.round(
(score * 0.52) +
(hiddenControlScore * 0.18) +
(freshWalletPct * 0.10) +
(developerNetworkDetected ? Math.max(6, developerNetworkConfidence * 0.12) : developerLinked ? 6 : 0) +
(walletNetworkConfidence >= 45 ? Math.max(4, walletNetworkConfidence * 0.08) : 0)
);

const reputationScore = clamp(reputationBase, 0, 100);
const reputation = {
score: reputationScore,
label: repBand(reputationScore),
};

const primaryDriver =
!mintRevoked || !freezeRevoked
? "Authority Control"
: developerNetworkDetected && developerNetworkConfidence >= 55
? "Developer Network"
: walletNetworkConfidence >= 60
? "Wallet Network"
: hiddenControlScore >= 45
? "Hidden Control"
: top10 >= 55
? "Holder Distribution"
: liquidityStability.state !== "good"
? "Liquidity Stability"
: whaleActivity.score >= 35
? "Whale Activity"
: "Market Structure";

return {
score,
label: headline,
signal: headline.signal,
primaryDriver,
whaleScore: whaleDominance,
liqFdvPct: Number(liqFdvPct.toFixed(2)),
volLiq: Number(volLiq.toFixed(2)),
hiddenControl: {
score: hiddenControlScore,
label: activity?.hiddenControl?.label || "Low",
state: activity?.hiddenControl?.state || "good",
linkedWallets,
linkedWalletPct,
sharedFundingDetected: !!activity?.hiddenControl?.sharedFundingDetected,
note: activity?.hiddenControl?.note || "—",
},
developerActivity: {
detected: developerNetworkDetected || developerLinked,
linkedWallets: developerNetworkDetected
? developerNetworkLinkedWallets
: developerLinkedWallets,
label: developerNetworkDetected
? developerNetworkLabel
: activity?.developer?.label || "No clear overlap",
state: developerNetworkDetected
? developerNetworkState
: developerLinked
? "warn"
: "good",
confidence: developerNetworkDetected ? developerNetworkConfidence : null,
likelyControlPct: developerNetworkDetected ? developerNetworkLikelyControlPct : 0,
fundingSourceShared: developerNetworkDetected ? developerNetworkFundingShared : false,
notes: developerNetworkDetected ? developerNetworkNotes : [],
},
developerNetwork: {
detected: developerNetworkDetected,
confidence: developerNetworkConfidence,
label: developerNetworkLabel,
state: developerNetworkState,
linkedWallets: developerNetworkLinkedWallets,
likelyControlPct: developerNetworkLikelyControlPct,
fundingSourceShared: developerNetworkFundingShared,
notes: developerNetworkNotes,
},
walletNetwork: {
primaryWallet: walletNetworkPrimaryWallet,
primaryClusterId: walletNetworkPrimaryClusterId,
role: walletNetworkRole,
confidence: walletNetworkConfidence,
confidenceLabel: walletNetworkConfidenceLabel,
controlEstimatePct: walletNetworkControlEstimatePct,
sharedFundingDetected: walletNetworkSharedFundingDetected,
},
freshWalletRisk: {
walletCount: freshWalletCount,
pct: freshWalletPct,
label: activity?.freshWalletRisk?.label || "Low",
state: activity?.freshWalletRisk?.state || "good",
},
liquidityStability,
whaleActivity,
trend: {
label: trendLabel,
state: trendLabel === "Escalating" ? "bad" : trendLabel === "Improving" ? "good" : "warn",
latest: Number(trend?.latest?.risk ?? score),
delta1h: trend?.change?.["1h"] ?? null,
delta6h: trend?.change?.["6h"] ?? null,
delta24h: trend?.change?.["24h"] ?? null,
momentum: trend?.momentum || "Stable",
},
reputation,
signals,
};
}
