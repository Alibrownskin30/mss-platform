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
const freshWalletRisk = securityModel?.freshWalletRisk || {};
const liquidityStability = securityModel?.liquidityStability || {};
const whaleActivity = securityModel?.whaleActivity || {};
const reputation = securityModel?.reputation || {};
const trendBlock = securityModel?.trend || trend?.trend || {};

const riskScore = safeNum(securityModel?.score, 0);
const top10 = safeNum(concentration?.top10, 0);
const top1 = safeNum(concentration?.top1, 0);
const linkedWallets = safeNum(hiddenControl?.linkedWallets, 0);
const hiddenControlScore = safeNum(hiddenControl?.score, 0);
const freshWalletPct = safeNum(freshWalletRisk?.pct, 0);
const whaleScore = safeNum(whaleActivity?.score ?? securityModel?.whaleScore, 0);
const liqFdvPct = safeNum(liquidityStability?.liqFdvPct, 0);

const mintRevoked = !!token?.safety?.mintRevoked;
const freezeRevoked = !!token?.safety?.freezeRevoked;
const sharedFundingDetected = !!hiddenControl?.sharedFundingDetected;
const devDetected = !!developerActivity?.detected;

const trendLabel = String(trendBlock?.label || "Stable");
const trendMomentum = String(trendBlock?.momentum || "Stable");

const matches = [];

if (hiddenControlScore >= 45) matches.push("cluster_overlap");
if (linkedWallets >= 3) matches.push("linked_wallet_group");
if (sharedFundingDetected) matches.push("shared_funding_detected");
if (freshWalletPct >= 20) matches.push("fresh_wallet_density");
if (top10 >= 55) matches.push("top10_pressure");
if (top1 >= 25) matches.push("top1_pressure");
if (liqFdvPct > 0 && liqFdvPct < 5) matches.push("thin_liquidity_relative_to_fdv");
if (!mintRevoked || !freezeRevoked) matches.push("authority_control_present");
if (whaleScore >= 65) matches.push("coordinated_whale_pressure");
if (devDetected) matches.push("possible_dev_linkage");
if (trendLabel === "Escalating" || trendMomentum === "Escalating") matches.push("risk_trend_escalating");

const confidence = clamp(
Math.round(
riskScore * 0.35 +
hiddenControlScore * 0.2 +
whaleScore * 0.15 +
Math.min(top10, 100) * 0.12 +
Math.min(freshWalletPct * 2, 100) * 0.1 +
(sharedFundingDetected ? 8 : 0)
),
0,
100
);

const riskClass = getRiskClass(riskScore);

const devPattern = devDetected
? "possible_repeat_structure"
: "no_clear_repeat_structure";

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
: liqFdvPct < 8
? "moderate_depth"
: "healthy_depth";

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

const signature = buildSignature([
riskClass,
devDetected ? "dev" : "nodev",
sharedFundingDetected ? "funded" : "nofund",
hiddenControlScore >= 45 ? "cluster" : "nocluster",
freshWalletPct >= 20 ? "fresh" : "aged",
top10 >= 55 ? "top10heavy" : "top10ok",
!mintRevoked || !freezeRevoked ? "authlive" : "authrevoked",
trendLabel,
]);

return {
ok: true,
mint,
cassieDna: {
signature,
riskClass,
devPattern,
fundingPattern,
holderPattern,
liquidityPattern,
authorityPattern,
whalePattern,
confidence,
matches,
traits: {
riskScore,
hiddenControlScore,
linkedWallets,
freshWalletPct,
top1,
top10,
whaleScore,
liqFdvPct,
mintRevoked: toFlag(mintRevoked),
freezeRevoked: toFlag(freezeRevoked),
trendLabel,
trendMomentum,
reputationLabel: String(reputation?.label || "Unknown"),
},
},
};
}
