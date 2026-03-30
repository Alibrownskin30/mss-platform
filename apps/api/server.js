import "dotenv/config";
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import slowDown from "express-slow-down";
import builderRoutes from "./routes/builders.js";
import launcherRoutes from "./routes/launcher.js";
import cilaRoutes from "./routes/cila.js";
import { checkLaunchCountdowns } from "./services/launchWatcher.js";
import marketRoutes from "./routes/market.js";
import tokenRoutes from "./routes/token.js";
import { startGraduationWatcher } from "./services/launcher/graduationWatcher.js";
import uploadRoutes from "./routes/upload.js";
import { startLaunchWorker } from "./workers/launchWorker.js";
import chartRoutes from "./routes/chart.js";
import tokenMarketRoutes from "./routes/token-market.js";
import launchLifecycleRoutes from "./routes/launch-lifecycle.js";

import { Connection, PublicKey } from "@solana/web3.js";
import pkg from "@metaplex-foundation/mpl-token-metadata";
import {
AccountLayout,
TOKEN_PROGRAM_ID,
TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

import {
db,
insertRiskPoint,
getRiskTrend,
getAlertEvents,
upsertScanCache,
} from "./db.js";
import { register, login, authRequired } from "./auth.js";
import { startWatcher } from "./watcher.js";
import { getClusterIntel } from "./cluster.js";
import { createCassie } from "./cassie/index.js";
import { buildSecurityModel } from "./intelligence/securityModel.js";

const { Metadata } = pkg;

const app = express();
const PORT = process.env.PORT || 8787;

app.set("trust proxy", 1);
app.disable("x-powered-by");

const NODE_ENV = process.env.NODE_ENV || "development";

const TOKEN_PROGRAM_IDS = new Set([
TOKEN_PROGRAM_ID.toBase58(),
TOKEN_2022_PROGRAM_ID.toBase58(),
]);

class InvalidMintError extends Error {
constructor(message, statusCode = 400) {
super(message);
this.name = "InvalidMintError";
this.statusCode = statusCode;
}
}

// ---- Security headers ----
app.use(
helmet({
crossOriginResourcePolicy: { policy: "cross-origin" },
})
);

// ---- Body parsing ----
app.use(express.json({ limit: process.env.BODY_LIMIT || "1mb" }));
app.use(express.urlencoded({ extended: true, limit: process.env.BODY_LIMIT || "1mb" }));

// ---- CORS ----
const rawOrigins = (process.env.CORS_ORIGINS || "")
.split(",")
.map((s) => s.trim())
.filter(Boolean);

const defaultDevOrigins = [
"http://127.0.0.1:3000",
"http://localhost:3000",
];

const allowedOrigins =
NODE_ENV !== "production"
? Array.from(new Set([...defaultDevOrigins, ...rawOrigins]))
: rawOrigins;

const corsOptions = {
origin(origin, cb) {
if (!origin) return cb(null, true);

if (NODE_ENV !== "production") {
if (allowedOrigins.includes(origin)) return cb(null, true);
return cb(null, true);
}

if (allowedOrigins.includes(origin)) return cb(null, true);
return cb(new Error("Not allowed by CORS"));
},
credentials: true,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

// ---- Uploads ----
app.use("/api/upload", uploadRoutes);
app.use("/uploads", express.static("uploads"));

// ---- Baseline abuse protection (global) ----
const limiter = rateLimit({
windowMs: 60 * 1000,
limit: Number(process.env.RATE_LIMIT_RPM || 240),
standardHeaders: true,
legacyHeaders: false,
message: { error: "Too many requests. Try again shortly." },
});

const speed = slowDown({
windowMs: 60 * 1000,
delayAfter: Number(process.env.SLOWDOWN_AFTER || 120),
delayMs: () => Number(process.env.SLOWDOWN_DELAY_MS || 200),
validate: { delayMs: false },
});

app.use(limiter);
app.use(speed);

// ---- Auth route-specific protection (stronger) ----
const authLimiter = rateLimit({
windowMs: 15 * 60 * 1000,
limit: Number(process.env.AUTH_RATE_LIMIT_15M || 25),
standardHeaders: true,
legacyHeaders: false,
message: { error: "Too many attempts. Try again later." },
});

const authSlow = slowDown({
windowMs: 15 * 60 * 1000,
delayAfter: Number(process.env.AUTH_SLOWDOWN_AFTER_15M || 10),
delayMs: () => Number(process.env.AUTH_SLOWDOWN_DELAY_MS || 500),
validate: { delayMs: false },
});

// ---- Cassie (middleware + intel layer) ----
const { cassie, cassieApi, cassieIntel } = createCassie();
app.use(cassie);

// ---- Route mounts (after protection middleware) ----
app.use("/api/builders", builderRoutes);
app.use("/api/launcher", launcherRoutes);
app.use("/api/launch-lifecycle", launchLifecycleRoutes);
app.use("/api/chart", chartRoutes);
app.use("/api/token-market", tokenMarketRoutes);
app.use("/api/token", tokenRoutes);
app.use("/api/market", marketRoutes);
app.use("/api/cila", cilaRoutes);

// Honeypots
app.get("/api/_cassie/diag", (req, res) => res.status(404).end());
app.post("/api/admin/_sync", (req, res) => res.status(401).end());

// ---- Solana RPC ----
const RPC = process.env.SOLANA_RPC || process.env.RPC_URL || "https://api.devnet.solana.com";
const connection = new Connection(RPC, "confirmed");

// ---- Helpers ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRateLimitError(e) {
const msg = String(e?.message || e || "").toLowerCase();
return msg.includes("429") || msg.includes("too many requests");
}

async function rpcRetry(fn, { tries = 6, baseDelayMs = 300 } = {}) {
let lastErr;
for (let i = 0; i < tries; i++) {
try {
return await fn();
} catch (e) {
lastErr = e;
const delay =
Math.min(8000, baseDelayMs * Math.pow(2, i)) +
Math.floor(Math.random() * 200);
if (isRateLimitError(e)) await sleep(delay);
else await sleep(150);
}
}
throw lastErr;
}

function assertMint(mintStr) {
try {
return new PublicKey(mintStr);
} catch {
return null;
}
}

function isMintValidationError(error) {
return error instanceof InvalidMintError;
}

function mintErrorMessage(error) {
const raw = String(error?.message || error || "");
const lower = raw.toLowerCase();

if (lower.includes("could not be unpacked")) {
return "Address is not a valid SPL token mint";
}
if (lower.includes("failed to find account")) {
return "Mint not found";
}
if (lower.includes("invalid param")) {
return "Invalid token mint";
}
return raw || "Invalid token mint";
}

function respondMintRouteError(res, error) {
if (isRateLimitError(error)) {
return res.status(429).json({ error: "RPC rate limited (429). Try again shortly." });
}

if (isMintValidationError(error)) {
return res.status(error.statusCode || 400).json({ error: mintErrorMessage(error) });
}

const friendly = mintErrorMessage(error);
if (friendly !== String(error?.message || error || "")) {
return res.status(400).json({ error: friendly });
}

return res.status(500).json({ error: String(error?.message || error) });
}

function fmtUsdCompact(n) {
const v = Number(n);
if (!Number.isFinite(v)) return "—";
const abs = Math.abs(v);
if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
if (abs >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
if (abs >= 1) return `$${v.toFixed(6)}`;
return `$${v.toFixed(8)}`;
}

function safeNum(v, fallback = 0) {
const n = Number(v);
return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
return Math.max(min, Math.min(max, n));
}

function titleCase(s) {
return String(s || "")
.replace(/[_-]+/g, " ")
.replace(/\s+/g, " ")
.trim()
.replace(/\b\w/g, (m) => m.toUpperCase());
}

function toPct(n, dp = 1) {
const v = Number(n);
if (!Number.isFinite(v)) return 0;
return Number(v.toFixed(dp));
}

function getReputationFromTrend(trend, latestRisk) {
const risk = safeNum(latestRisk, 0);
const momentum = trend?.trend?.momentum || "Stable";

let score = 100 - risk;
if (momentum === "Escalating") score -= 15;
else if (momentum === "Rising") score -= 8;
else if (momentum === "Cooling") score += 6;
else if (momentum === "Softening") score += 4;

score = clamp(Math.round(score), 0, 100);

let label = "Weak";
let state = "bad";
if (score >= 75) {
label = "Strong";
state = "good";
} else if (score >= 50) {
label = "Moderate";
state = "warn";
}

return { score, label, state };
}

function buildWalletNetwork({
activity,
holdersJson,
concentration,
securityModel,
}) {
const clusters = Array.isArray(activity?.clusters) ? activity.clusters : [];
const holders = Array.isArray(holdersJson?.holders) ? holdersJson.holders : [];
const hiddenControl = securityModel?.hiddenControl || {};
const developerNetwork = securityModel?.developerNetwork || {};

const primaryCluster =
clusters[0] ||
(developerNetwork?.groups?.length
? {
id: "C1",
payer: developerNetwork.groups[0]?.payer || null,
members: developerNetwork.groups[0]?.members || [],
size: developerNetwork.groups[0]?.size || 0,
score: clamp(
40 + (developerNetwork.groups[0]?.size || 0) * 10,
0,
100
),
}
: null);

const primaryMembers = Array.isArray(primaryCluster?.members)
? primaryCluster.members
: [];
const primaryWallet =
primaryCluster?.payer ||
developerNetwork?.groups?.[0]?.payer ||
primaryMembers[0] ||
null;

let memberSupplyPct = 0;
if (primaryMembers.length && holders.length) {
const memberSet = new Set(primaryMembers);
memberSupplyPct = holders
.filter((h) => h?.owner && memberSet.has(h.owner))
.reduce((sum, h) => sum + safeNum(h?.pctSupply, 0), 0);
}

const linkedWallets =
safeNum(developerNetwork?.linkedWallets, 0) ||
safeNum(hiddenControl?.linkedWallets, 0) ||
safeNum(activity?.clusteredWallets, 0) ||
primaryMembers.length;

const controlEstimatePct = clamp(
Math.max(
safeNum(developerNetwork?.likelyControlPct, 0),
safeNum(hiddenControl?.linkedWalletPct, 0),
memberSupplyPct,
0
),
0,
100
);

const confidence = clamp(
Math.round(
Math.max(
safeNum(developerNetwork?.confidence, 0),
safeNum(primaryCluster?.score, 0),
safeNum(hiddenControl?.score, 0),
safeNum(activity?.score, 0)
)
),
0,
100
);

const confidenceLabel =
confidence >= 75 ? "High" : confidence >= 45 ? "Moderate" : "Low";

const role =
developerNetwork?.detected && confidence >= 75
? "Likely operator"
: developerNetwork?.detected
? "Probable linked wallet"
: primaryCluster?.payer
? "Shared payer / controller"
: primaryMembers.length >= 2
? "Lead linked wallet"
: "Observed wallet";

const riskScore = clamp(
Math.round(
confidence * 0.55 +
controlEstimatePct * 0.45 +
Math.max(0, safeNum(concentration?.top10, 0) - 35) * 0.35
),
0,
100
);

const riskLabel =
riskScore >= 75
? "High Control Risk"
: riskScore >= 45
? "Moderate Control Risk"
: "Low Control Risk";
const riskState = riskScore >= 75 ? "bad" : riskScore >= 45 ? "warn" : "good";

return {
primaryWallet,
primaryClusterId: primaryCluster?.id || "—",
role,
linkedWallets,
sharedFundingDetected: !!hiddenControl?.sharedFundingDetected,
controlEstimatePct: toPct(controlEstimatePct, 1),
confidence,
confidenceLabel,
riskScore,
riskLabel,
riskState,
note:
confidence >= 75
? "Wallet control map indicates high-confidence coordinated influence."
: confidence >= 45
? "Wallet control map indicates moderate coordinated influence."
: "Wallet control map does not currently indicate dominant coordinated influence.",
};
}

function enrichSecurityModel({
baseModel,
concentration,
token,
market,
activity,
trend,
holdersJson,
}) {
const top10 = safeNum(concentration?.top10, 0);
const liqUsd = safeNum(market?.liquidityUsd, 0);
const fdv = safeNum(market?.fdv, 0);
const liqFdvPct = fdv > 0 ? (liqUsd / fdv) * 100 : 0;
const clusterScore = safeNum(activity?.score, 0);
const clusterCount = safeNum(activity?.clusterCount, 0);
const linkedWallets = safeNum(activity?.clusteredWallets, 0);
const newWalletPct = safeNum(activity?.newWalletPct, 0);

const hiddenControlScore = clamp(
Math.round(
clusterScore * 0.65 +
linkedWallets * 3 +
Math.max(0, top10 - 35) * 0.35
),
0,
100
);

const hiddenControl = {
score: hiddenControlScore,
label:
hiddenControlScore >= 70
? "High Hidden Control"
: hiddenControlScore >= 40
? "Elevated Hidden Control"
: "Low Hidden Control",
state:
hiddenControlScore >= 70
? "bad"
: hiddenControlScore >= 40
? "warn"
: "good",
linkedWallets,
linkedWalletPct:
top10 > 0
? Math.min(top10, safeNum(activity?.maxClusterSize, 0) * (top10 / 10))
: 0,
sharedFundingDetected: clusterCount >= 1,
};

const developerActivityScore = clamp(
Math.round(
hiddenControlScore * 0.55 +
(clusterCount >= 2 ? 18 : 0) +
(newWalletPct >= 20 ? 12 : 0)
),
0,
100
);

const existingDeveloperActivity = baseModel?.developerActivity || {};
const existingDeveloperNetwork = baseModel?.developerNetwork || {};

const developerActivity = {
detected:
existingDeveloperActivity?.detected != null
? !!existingDeveloperActivity.detected
: developerActivityScore >= 45,
score: developerActivityScore,
confidence:
existingDeveloperActivity?.confidence != null
? safeNum(existingDeveloperActivity.confidence, 0)
: null,
label:
existingDeveloperActivity?.label ||
(developerActivityScore >= 65
? "Developer Overlap Elevated"
: developerActivityScore >= 45
? "Possible Developer Linkage"
: "No Strong Overlap"),
state:
existingDeveloperActivity?.state ||
(developerActivityScore >= 45 ? "warn" : "good"),
linkedWallets:
existingDeveloperActivity?.linkedWallets != null
? safeNum(existingDeveloperActivity.linkedWallets, 0)
: linkedWallets,
likelyControlPct:
existingDeveloperActivity?.likelyControlPct != null
? safeNum(existingDeveloperActivity.likelyControlPct, 0)
: 0,
fundingSourceShared:
existingDeveloperActivity?.fundingSourceShared != null
? !!existingDeveloperActivity.fundingSourceShared
: false,
notes: Array.isArray(existingDeveloperActivity?.notes)
? existingDeveloperActivity.notes
: [],
};

const developerNetwork = {
detected:
existingDeveloperNetwork?.detected != null
? !!existingDeveloperNetwork.detected
: developerActivity.detected,
confidence: safeNum(existingDeveloperNetwork?.confidence, 0),
label: existingDeveloperNetwork?.label || developerActivity.label,
state: existingDeveloperNetwork?.state || developerActivity.state,
linkedWallets:
existingDeveloperNetwork?.linkedWallets != null
? safeNum(existingDeveloperNetwork.linkedWallets, 0)
: developerActivity.linkedWallets,
likelyControlPct:
existingDeveloperNetwork?.likelyControlPct != null
? safeNum(existingDeveloperNetwork.likelyControlPct, 0)
: developerActivity.likelyControlPct,
fundingSourceShared:
existingDeveloperNetwork?.fundingSourceShared != null
? !!existingDeveloperNetwork.fundingSourceShared
: developerActivity.fundingSourceShared,
notes: Array.isArray(existingDeveloperNetwork?.notes)
? existingDeveloperNetwork.notes
: developerActivity.notes,
groups: Array.isArray(existingDeveloperNetwork?.groups)
? existingDeveloperNetwork.groups
: [],
};

const freshWalletRiskScore = clamp(
Math.round(newWalletPct * 1.8 + (newWalletPct >= 20 ? 10 : 0)),
0,
100
);

const freshWalletRisk = {
score: freshWalletRiskScore,
label:
freshWalletRiskScore >= 65
? "High Fresh Wallet Risk"
: freshWalletRiskScore >= 35
? "Moderate Fresh Wallet Risk"
: "Low Fresh Wallet Risk",
state:
freshWalletRiskScore >= 65
? "bad"
: freshWalletRiskScore >= 35
? "warn"
: "good",
walletCount: Math.round(
(safeNum(activity?.analyzedWallets, 0) * newWalletPct) / 100
),
pct: Number(newWalletPct.toFixed(1)),
};

const liquidityStabilityScore = clamp(
Math.round(
100 -
(liqFdvPct < 1
? 80
: liqFdvPct < 3
? 60
: liqFdvPct < 5
? 40
: liqFdvPct < 10
? 20
: 8)
),
0,
100
);

const liquidityStability = {
score: liquidityStabilityScore,
label:
liquidityStabilityScore >= 70
? "Stable"
: liquidityStabilityScore >= 40
? "Fragile"
: "Weak",
state:
liquidityStabilityScore >= 70
? "good"
: liquidityStabilityScore >= 40
? "warn"
: "bad",
liqFdvPct: Number(liqFdvPct.toFixed(2)),
removableRisk:
liquidityStabilityScore >= 70
? "Lower"
: liquidityStabilityScore >= 40
? "Moderate"
: "Elevated",
};

const whaleActivityScore = clamp(
Math.round(
safeNum(baseModel?.whaleScore, 0) * 0.55 +
clusterScore * 0.35 +
(safeNum(activity?.maxClusterSize, 0) >= 3 ? 10 : 0)
),
0,
100
);

const whaleActivity = {
score: whaleActivityScore,
label:
whaleActivityScore >= 70
? "High Whale Coordination"
: whaleActivityScore >= 40
? "Elevated Whale Activity"
: "Normal Whale Activity",
state:
whaleActivityScore >= 70
? "bad"
: whaleActivityScore >= 40
? "warn"
: "good",
pressure:
whaleActivityScore >= 70
? "High"
: whaleActivityScore >= 40
? "Moderate"
: "Normal",
syncBurstSize: safeNum(activity?.maxClusterSize, 0),
};

const walletNetwork = buildWalletNetwork({
activity,
holdersJson,
concentration,
securityModel: {
...baseModel,
hiddenControl,
developerNetwork,
},
});

const reputation = getReputationFromTrend(trend, baseModel?.score);

const trendBlock = {
label: trend?.trend?.label || "Stable",
state: trend?.trend?.state || "warn",
momentum: trend?.trend?.momentum || "Stable",
latest: safeNum(trend?.latest?.risk, safeNum(baseModel?.score, 0)),
delta1h: trend?.change?.["1h"] ?? null,
delta6h: trend?.change?.["6h"] ?? null,
delta24h: trend?.change?.["24h"] ?? null,
found: !!trend?.found,
};

const signal =
safeNum(baseModel?.score, 0) >= 75
? "High Alert"
: safeNum(baseModel?.score, 0) >= 45
? "Caution"
: "Normal";

return {
...baseModel,
signal,
hiddenControl,
developerActivity,
developerNetwork,
walletNetwork,
freshWalletRisk,
liquidityStability,
whaleActivity,
trend: trendBlock,
reputation,
};
}

function buildCassieIntelFallback({
token,
market,
concentration,
activity,
trend,
securityModel,
}) {
const riskScore = safeNum(securityModel?.score, 0);
const top10 = safeNum(concentration?.top10, 0);
const top1 = safeNum(concentration?.top1, 0);
const liqUsd = safeNum(market?.liquidityUsd, 0);
const liqFdvPct = safeNum(securityModel?.liquidityStability?.liqFdvPct, 0);
const hiddenControlScore = safeNum(securityModel?.hiddenControl?.score, 0);
const freshWalletPct = safeNum(securityModel?.freshWalletRisk?.pct, 0);
const whaleActivityScore = safeNum(securityModel?.whaleActivity?.score, 0);
const linkedWallets = safeNum(securityModel?.hiddenControl?.linkedWallets, 0);
const clusterCount = safeNum(activity?.clusterCount, 0);
const hasMintAuthority = !!token?.mintAuthority;
const hasFreezeAuthority = !!token?.freezeAuthority;
const momentum =
securityModel?.trend?.momentum || trend?.trend?.momentum || "Stable";
const devConfidence = safeNum(
securityModel?.developerNetwork?.confidence ||
securityModel?.developerActivity?.confidence,
0
);
const devLikelyControlPct = safeNum(
securityModel?.developerNetwork?.likelyControlPct ||
securityModel?.developerActivity?.likelyControlPct,
0
);
const walletNetConfidence = safeNum(
securityModel?.walletNetwork?.confidence,
0
);
const walletNetControlPct = safeNum(
securityModel?.walletNetwork?.controlEstimatePct,
0
);

const riskFactors = [];

if (hasMintAuthority) {
riskFactors.push({
code: "mint_authority_present",
label: "Mint authority still present",
severity: "high",
});
}

if (hasFreezeAuthority) {
riskFactors.push({
code: "freeze_authority_present",
label: "Freeze authority still present",
severity: "high",
});
}

if (top1 >= 35) {
riskFactors.push({
code: "top1_concentration",
label: `Top1 concentration elevated (${top1.toFixed(2)}%)`,
severity: top1 >= 50 ? "high" : "medium",
});
}

if (top10 >= 55) {
riskFactors.push({
code: "top10_concentration",
label: `Top10 concentration elevated (${top10.toFixed(2)}%)`,
severity: top10 >= 75 ? "high" : "medium",
});
}

if (hiddenControlScore >= 40) {
riskFactors.push({
code: "hidden_control",
label: `Hidden control pressure detected (${hiddenControlScore}/100)`,
severity: hiddenControlScore >= 70 ? "high" : "medium",
});
}

if (linkedWallets >= 3 || clusterCount >= 2) {
riskFactors.push({
code: "linked_wallet_pattern",
label: `Linked wallet pattern detected (${linkedWallets} linked / ${clusterCount} clusters)`,
severity: linkedWallets >= 6 ? "high" : "medium",
});
}

if (freshWalletPct >= 20) {
riskFactors.push({
code: "fresh_wallet_risk",
label: `Fresh-wallet concentration elevated (${freshWalletPct.toFixed(1)}%)`,
severity: freshWalletPct >= 35 ? "high" : "medium",
});
}

if (liqFdvPct > 0 && liqFdvPct < 3) {
riskFactors.push({
code: "thin_liquidity",
label: `Liquidity thin relative to FDV (${liqFdvPct.toFixed(2)}%)`,
severity: liqFdvPct < 1 ? "high" : "medium",
});
}

if (liqUsd > 0 && liqUsd < 25000) {
riskFactors.push({
code: "low_liquidity",
label: `Low visible liquidity (${fmtUsdCompact(liqUsd)})`,
severity: liqUsd < 10000 ? "high" : "medium",
});
}

if (whaleActivityScore >= 40) {
riskFactors.push({
code: "whale_coordination",
label: `Whale coordination pressure elevated (${whaleActivityScore}/100)`,
severity: whaleActivityScore >= 70 ? "high" : "medium",
});
}

if (devConfidence >= 35) {
riskFactors.push({
code: "developer_network",
label:
devLikelyControlPct > 0
? `Developer-linked network confidence ${devConfidence}/100 with likely control around ${devLikelyControlPct.toFixed(1)}%`
: `Developer-linked network detected (${devConfidence}/100)`,
severity: devConfidence >= 75 ? "high" : "medium",
});
}

if (walletNetConfidence >= 45) {
riskFactors.push({
code: "wallet_network",
label:
walletNetControlPct > 0
? `Wallet control map confidence ${walletNetConfidence}/100 with estimated influence around ${walletNetControlPct.toFixed(1)}%`
: `Wallet control map shows coordinated influence (${walletNetConfidence}/100)`,
severity: walletNetConfidence >= 75 ? "high" : "medium",
});
}

if (momentum === "Escalating" || momentum === "Rising") {
riskFactors.push({
code: "risk_trend_up",
label: `Risk trend ${momentum.toLowerCase()}`,
severity: momentum === "Escalating" ? "high" : "medium",
});
}

const radarSignals = [
{
key: "structural_control",
label: "Structural Control",
value: clamp(Math.round((hiddenControlScore + top10) / 2), 0, 100),
},
{
key: "wallet_coordination",
label: "Wallet Coordination",
value: clamp(
Math.round(
(safeNum(activity?.score, 0) + whaleActivityScore + walletNetConfidence) / 3
),
0,
100
),
},
{
key: "liquidity_fragility",
label: "Liquidity Fragility",
value: clamp(
100 - safeNum(securityModel?.liquidityStability?.score, 0),
0,
100
),
},
{
key: "fresh_wallet_pressure",
label: "Fresh Wallet Pressure",
value: clamp(Math.round(freshWalletPct * 2), 0, 100),
},
{
key: "developer_network",
label: "Developer Network",
value: clamp(Math.round(devConfidence), 0, 100),
},
{
key: "network_control",
label: "Network Control",
value: clamp(
Math.round(walletNetConfidence * 0.6 + walletNetControlPct * 0.4),
0,
100
),
},
{
key: "trend_escalation",
label: "Trend Escalation",
value:
momentum === "Escalating"
? 90
: momentum === "Rising"
? 65
: momentum === "Softening" || momentum === "Cooling"
? 20
: 35,
},
];

const memoryHits = [];
if (hasMintAuthority || hasFreezeAuthority) {
memoryHits.push({
tag: "Authority-Controlled Launch Pattern",
confidence: hasMintAuthority && hasFreezeAuthority ? 86 : 72,
note: "Authority permissions remain active and preserve post-launch control surface.",
});
}

if (hiddenControlScore >= 55 && top10 >= 55) {
memoryHits.push({
tag: "Structured Holder Control Pattern",
confidence: 84,
note: "High concentration combined with linked-wallet behavior suggests coordinated supply control.",
});
}

if (freshWalletPct >= 20 && clusterCount >= 2) {
memoryHits.push({
tag: "Fresh Wallet Distribution Pattern",
confidence: 74,
note: "Fresh-wallet participation appears elevated alongside clustering signals.",
});
}

if (devConfidence >= 55) {
memoryHits.push({
tag: "Developer Network Control Pattern",
confidence: clamp(Math.round(devConfidence), 0, 99),
note:
devLikelyControlPct > 0
? `Developer-linked network appears meaningful, with likely control around ${devLikelyControlPct.toFixed(1)}%.`
: "Developer-linked network confidence is elevated in this snapshot.",
});
}

if (walletNetConfidence >= 55) {
memoryHits.push({
tag: "Wallet Network Influence Pattern",
confidence: clamp(Math.round(walletNetConfidence), 0, 99),
note:
walletNetControlPct > 0
? `Wallet control map indicates coordinated influence around ${walletNetControlPct.toFixed(1)}%.`
: "Wallet control map indicates elevated coordinated influence.",
});
}

const simulations = [
{
name: "Authority Abuse Simulation",
result:
hasMintAuthority || hasFreezeAuthority
? "Exposure present"
: "No live authority exposure detected",
severity: hasMintAuthority || hasFreezeAuthority ? "high" : "low",
},
{
name: "Liquidity Shock Simulation",
result:
liqUsd <= 0
? "Market liquidity unavailable"
: liqFdvPct < 3
? "High slippage / fragility profile"
: liqFdvPct < 7
? "Moderate fragility profile"
: "More resilient liquidity profile",
severity: liqFdvPct < 3 ? "high" : liqFdvPct < 7 ? "medium" : "low",
},
{
name: "Concentration Exit Simulation",
result:
top10 >= 70
? "Large-holder exit could heavily distort price"
: top10 >= 50
? "Moderate-to-high concentration exit risk"
: "Lower concentrated exit pressure",
severity: top10 >= 70 ? "high" : top10 >= 50 ? "medium" : "low",
},
{
name: "Coordination Stress Simulation",
result:
hiddenControlScore >= 70
? "Coordinated wallet behavior highly concerning"
: hiddenControlScore >= 40
? "Coordinated behavior should be monitored"
: "Low coordination stress detected",
severity:
hiddenControlScore >= 70
? "high"
: hiddenControlScore >= 40
? "medium"
: "low",
},
{
name: "Developer Exit Simulation",
result:
devConfidence >= 75
? "Developer-linked network unwind could trigger severe pressure"
: devConfidence >= 45
? "Developer-linked network unwind could trigger moderate pressure"
: "No strong developer-exit stress detected",
severity: devConfidence >= 75 ? "high" : devConfidence >= 45 ? "medium" : "low",
},
{
name: "Wallet Network Control Simulation",
result:
walletNetConfidence >= 75
? "Wallet control map indicates severe coordinated influence risk"
: walletNetConfidence >= 45
? "Wallet control map indicates moderate coordinated influence risk"
: "Wallet control map does not currently indicate dominant coordinated influence",
severity:
walletNetConfidence >= 75
? "high"
: walletNetConfidence >= 45
? "medium"
: "low",
},
];

let cassieScore = 0;
cassieScore += riskScore * 0.25;
cassieScore += hiddenControlScore * 0.16;
cassieScore += safeNum(activity?.score, 0) * 0.12;
cassieScore += Math.min(top10, 100) * 0.12;
cassieScore += Math.min(freshWalletPct * 2, 100) * 0.08;
cassieScore +=
(100 - safeNum(securityModel?.liquidityStability?.score, 0)) * 0.09;
cassieScore += devConfidence * 0.09;
cassieScore += walletNetConfidence * 0.09;
cassieScore = clamp(Math.round(cassieScore), 0, 100);

let threatLevel = "Low";
let status = "Clear";
let action = "Continue monitoring";
let state = "good";

if (cassieScore >= 75) {
threatLevel = "High";
status = "Hostile Structure";
action = "Avoid / escalate review";
state = "bad";
} else if (cassieScore >= 50) {
threatLevel = "Elevated";
status = "Caution";
action = "Monitor closely";
state = "warn";
}

const pattern =
memoryHits[0]?.tag ||
(walletNetConfidence >= 55
? "Wallet network influence pattern"
: devConfidence >= 55
? "Developer-linked control pattern"
: hiddenControlScore >= 40
? "Linked control pattern"
: top10 >= 55
? "Concentrated holder pattern"
: "No dominant hostile pattern");

const summaryParts = [];
if (hasMintAuthority || hasFreezeAuthority)
summaryParts.push("authority exposure remains live");
if (top10 >= 55) summaryParts.push("holder concentration is elevated");
if (hiddenControlScore >= 40)
summaryParts.push("linked-wallet behavior is visible");
if (freshWalletPct >= 20)
summaryParts.push("fresh-wallet participation is elevated");
if (liqFdvPct > 0 && liqFdvPct < 3)
summaryParts.push("liquidity appears thin versus valuation");
if (devConfidence >= 45)
summaryParts.push("developer-network confidence is elevated");
if (walletNetConfidence >= 45)
summaryParts.push("wallet control-map confidence is elevated");
if (momentum === "Escalating" || momentum === "Rising") {
summaryParts.push(`risk trend is ${momentum.toLowerCase()}`);
}

const summary = summaryParts.length
? `Cassie identifies ${summaryParts.join(", ")}.`
: "Cassie does not currently see a dominant hostile structure in this snapshot.";

return {
enabled: true,
score: cassieScore,
confidence: clamp(
Math.round(58 + riskFactors.length * 5 + memoryHits.length * 4),
0,
99
),
threatLevel,
status,
state,
pattern,
recommendedAction: action,
summary,
riskFactors,
memoryHits,
simulations,
radarSignals,
verdict:
cassieScore >= 75
? "Hostile Structure"
: cassieScore >= 50
? "Caution"
: "Clear",
};
}

// ---- Cassie status + memory endpoints ----
app.get("/api/cassie/status", authRequired, (req, res) =>
cassieApi.status(req, res)
);

app.get("/api/cassie/memory", authRequired, (req, res) => {
try {
const limit = clamp(Number(req.query.limit || 50), 1, 200);
const out =
typeof cassieIntel?.memorySnapshot === "function"
? cassieIntel.memorySnapshot(limit)
: [];
return res.json({ ok: true, items: out });
} catch (e) {
return res.status(500).json({ error: String(e?.message || e) });
}
});

app.get("/api/cassie/memory/mint/:mint", authRequired, (req, res) => {
try {
const out =
typeof cassieIntel?.memoryByMint === "function"
? cassieIntel.memoryByMint(req.params.mint)
: null;
return res.json({ ok: true, item: out || null });
} catch (e) {
return res.status(500).json({ error: String(e?.message || e) });
}
});

app.get("/api/cassie/memory/signature/:signature", authRequired, (req, res) => {
try {
const out =
typeof cassieIntel?.memoryBySignature === "function"
? cassieIntel.memoryBySignature(req.params.signature)
: null;
return res.json({ ok: true, item: out || null });
} catch (e) {
return res.status(500).json({ error: String(e?.message || e) });
}
});

// ---- Caches ----
const holdersCache = new Map();
const holdersInFlight = new Map();
const HOLDERS_TTL_MS = 120_000;

const clusterCache = new Map();
const CLUSTER_TTL_MS = 180_000;

const marketCache = new Map();
const MARKET_TTL_MS = 30_000;

const mintProfileCache = new Map();
const MINT_PROFILE_TTL_MS = 120_000;

// ---- Shared data loaders ----
async function fetchMintProfile(mint, mintStr) {
const cached = mintProfileCache.get(mintStr);
if (cached && Date.now() - cached.ts < MINT_PROFILE_TTL_MS) {
return cached.data;
}

const parsedInfo = await rpcRetry(() => connection.getParsedAccountInfo(mint));
if (!parsedInfo?.value) {
throw new InvalidMintError("Mint not found", 404);
}

const ownerProgram = parsedInfo.value.owner?.toBase58?.() || null;

if (ownerProgram && !TOKEN_PROGRAM_IDS.has(ownerProgram)) {
throw new InvalidMintError("Address is not a supported SPL token mint", 400);
}

const parsed = parsedInfo.value.data?.parsed || null;
const parsedType = parsed?.type || null;
const mintParsed = parsed?.info || null;

if (mintParsed && parsedType === "mint") {
const out = {
mint: mint.toBase58(),
ownerProgram,
parsedType,
mintAuthority: mintParsed.mintAuthority ?? null,
freezeAuthority: mintParsed.freezeAuthority ?? null,
supply: mintParsed.supply,
decimals: mintParsed.decimals,
isToken2022: ownerProgram === TOKEN_2022_PROGRAM_ID.toBase58(),
};

mintProfileCache.set(mintStr, { ts: Date.now(), data: out });
return out;
}

const rawInfo = await rpcRetry(() => connection.getAccountInfo(mint));
if (!rawInfo) {
throw new InvalidMintError("Mint not found", 404);
}

const rawOwnerProgram = rawInfo.owner?.toBase58?.() || ownerProgram || null;
if (rawOwnerProgram && !TOKEN_PROGRAM_IDS.has(rawOwnerProgram)) {
throw new InvalidMintError("Address is not a supported SPL token mint", 400);
}

const dataLength = rawInfo.data?.length || 0;

if (dataLength < 82) {
throw new InvalidMintError("Address is not a valid SPL token mint", 400);
}

const out = {
mint: mint.toBase58(),
ownerProgram: rawOwnerProgram,
parsedType: "mint-raw",
mintAuthority: null,
freezeAuthority: null,
supply: null,
decimals: null,
isToken2022: rawOwnerProgram === TOKEN_2022_PROGRAM_ID.toBase58(),
};

mintProfileCache.set(mintStr, { ts: Date.now(), data: out });
return out;
}

async function fetchTokenData(mint, mintStr = mint.toBase58()) {
const profile = await fetchMintProfile(mint, mintStr);

let metadata = null;
try {
const metaPDA = Metadata.getPDA(mint);
const metaAcc = await rpcRetry(() => Metadata.load(connection, metaPDA));
metadata = metaAcc?.data?.data || null;
} catch {
metadata = null;
}

let supply = profile.supply;
let decimals = profile.decimals;
const mintAuthority = profile.mintAuthority;
const freezeAuthority = profile.freezeAuthority;

if (supply == null || decimals == null) {
try {
const supplyResp = await rpcRetry(() => connection.getTokenSupply(mint));
supply = supplyResp?.value?.amount ?? null;
decimals = supplyResp?.value?.decimals ?? null;
} catch {
}
}

return {
mint: mint.toBase58(),
chain: "solana",
supply,
decimals,
mintAuthority,
freezeAuthority,
program: profile.isToken2022 ? "Token-2022" : "SPL Token",
safety: {
mintRevoked: !mintAuthority,
freezeRevoked: !freezeAuthority,
},
metadata,
rpcLabel: "Solana Mainnet (Live)",
source: "onchain",
};
}

async function fetchMarketData(mintStr) {
const cached = marketCache.get(mintStr);
if (cached && Date.now() - cached.ts < MARKET_TTL_MS) return cached.data;

const url = `https://api.dexscreener.com/latest/dex/tokens/${mintStr}`;
const r = await fetch(url, { timeout: 10_000 });
const j = await r.json();

if (!j?.pairs?.length) {
const out = { found: false };
marketCache.set(mintStr, { ts: Date.now(), data: out });
return out;
}

const p = j.pairs[0];
const out = {
found: true,
dex: p.dexId,
pair: p.pairAddress,
priceUsd: p.priceUsd,
fdv: p.fdv ?? null,
mcapUsd: p.marketCap ?? p.marketcap ?? p.mcap ?? null,
liquidityUsd: p.liquidity?.usd || 0,
volume24h: p.volume?.h24 || 0,
baseSymbol: p.baseToken?.symbol,
quoteSymbol: p.quoteToken?.symbol,
baseName: p.baseToken?.name,
quoteName: p.quoteToken?.name,
priceChange: {
h1: p.priceChange?.h1 ?? null,
h24: p.priceChange?.h24 ?? null,
d7: p.priceChange?.d7 ?? p.priceChange?.h168 ?? null,
m30: p.priceChange?.m30 ?? p.priceChange?.d30 ?? null,
},
};

marketCache.set(mintStr, { ts: Date.now(), data: out });
return out;
}

async function fetchHoldersData(mint, mintStr) {
const cached = holdersCache.get(mintStr);
if (cached && Date.now() - cached.ts < HOLDERS_TTL_MS) return cached.data;

if (holdersInFlight.has(mintStr)) {
return holdersInFlight.get(mintStr);
}

const task = (async () => {
await fetchMintProfile(mint, mintStr);

let supplyResp;
let largest;

try {
[supplyResp, largest] = await Promise.all([
rpcRetry(() => connection.getTokenSupply(mint)),
rpcRetry(() => connection.getTokenLargestAccounts(mint)),
]);
} catch (error) {
throw new InvalidMintError(mintErrorMessage(error), 400);
}

const totalUi = supplyResp?.value?.uiAmount ?? null;
const decimals = supplyResp?.value?.decimals ?? null;

const top = (largest?.value || []).slice(0, 20);
const tokenAccPubkeys = top.map((a) => new PublicKey(a.address));
const accInfos = await rpcRetry(() =>
connection.getMultipleAccountsInfo(tokenAccPubkeys)
);

const owners = accInfos.map((info) => {
try {
if (!info?.data || info.data.length !== AccountLayout.span) return null;
const decoded = AccountLayout.decode(info.data);
return new PublicKey(decoded.owner).toBase58();
} catch {
return null;
}
});

const holders = top.map((a, i) => {
const ui = a.uiAmount ?? null;
const pct =
totalUi && ui != null && totalUi > 0 ? (ui / totalUi) * 100 : null;

return {
rank: i + 1,
tokenAccount: a.address,
owner: owners[i],
uiAmount: ui,
amount: a.amount,
pctSupply: pct,
};
});

const out = {
found: true,
mint: mint.toBase58(),
decimals,
totalSupplyUi: totalUi,
holders,
};

holdersCache.set(mintStr, { ts: Date.now(), data: out });
return out;
})();

holdersInFlight.set(mintStr, task);

try {
const out = await task;
holdersInFlight.delete(mintStr);
return out;
} catch (e) {
holdersInFlight.delete(mintStr);
throw e;
}
}

async function fetchClusterData(mint, mintStr) {
const cached = clusterCache.get(mintStr);
if (cached && Date.now() - cached.ts < CLUSTER_TTL_MS) return cached.data;

let holdersData = holdersCache.get(mintStr)?.data;
if (!holdersData) {
holdersData = await fetchHoldersData(mint, mintStr);
}

const owners = (holdersData?.holders || []).map((h) => h.owner).filter(Boolean);
const intel = await getClusterIntel({ connection, rpcRetry, owners });
clusterCache.set(mintStr, { ts: Date.now(), data: intel });
return intel;
}

function buildConcentration(holdersJson) {
const holders = Array.isArray(holdersJson?.holders) ? holdersJson.holders : [];
const pct = holders.map((h) => Number(h.pctSupply || 0));
const sumTopN = (n) => pct.slice(0, n).reduce((a, b) => a + b, 0);

return {
top1: sumTopN(1),
top5: sumTopN(5),
top10: sumTopN(10),
top20: sumTopN(20),
};
}

// ---- Health ----
app.get("/health", (req, res) => {
res.json({
ok: true,
service: "mss-api",
env: NODE_ENV,
port: Number(PORT),
rpcLabel: "Solana Mainnet (Live)",
});
});

app.get("/", (req, res) => {
res.json({ ok: true, service: "mss-api" });
});

// ---- Auth ----
app.post("/api/register", authLimiter, authSlow, register);
app.post("/api/login", authLimiter, authSlow, login);

// ---------- Token Safety + metadata ----------
app.get("/api/sol/token/:mint", async (req, res) => {
try {
const mint = assertMint(req.params.mint);
if (!mint) return res.status(400).json({ error: "Invalid mint" });

const tokenJson = await fetchTokenData(mint, req.params.mint);
if (!tokenJson) return res.status(404).json({ error: "Mint not found" });

return res.json(tokenJson);
} catch (e) {
return respondMintRouteError(res, e);
}
});

// ---------- Market ----------
app.get("/api/sol/market/:mint", async (req, res) => {
try {
const mintStr = req.params.mint;
const mint = assertMint(mintStr);
if (!mint) return res.status(400).json({ error: "Invalid mint" });

const out = await fetchMarketData(mintStr);
return res.json(out);
} catch (e) {
return res.status(500).json({ error: String(e?.message || e) });
}
});

// ---------- Holders ----------
app.get("/api/sol/holders/:mint", async (req, res) => {
const mintStr = req.params.mint;

try {
const mint = assertMint(mintStr);
if (!mint) return res.status(400).json({ error: "Invalid mint" });

const data = await fetchHoldersData(mint, mintStr);
return res.json(data);
} catch (e) {
return respondMintRouteError(res, e);
}
});

// ---------- Cluster Intelligence ----------
app.get("/api/sol/cluster/:mint", async (req, res) => {
const mintStr = req.params.mint;

try {
const mint = assertMint(mintStr);
if (!mint) return res.status(400).json({ error: "Invalid mint" });

await fetchMintProfile(mint, mintStr);
const intel = await fetchClusterData(mint, mintStr);
return res.json(intel);
} catch (e) {
return respondMintRouteError(res, e);
}
});

// ---------- MSS Security Intelligence ----------
app.get("/api/sol/security/:mint", async (req, res) => {
const mintStr = req.params.mint;

try {
const mint = assertMint(mintStr);
if (!mint) return res.status(400).json({ error: "Invalid mint" });

const [tokenJson, marketJson, holdersJson, clusterJson] = await Promise.all([
fetchTokenData(mint, mintStr),
fetchMarketData(mintStr),
fetchHoldersData(mint, mintStr),
fetchClusterData(mint, mintStr),
]);

if (!tokenJson || !holdersJson) {
return res.status(404).json({ error: "Mint not found" });
}

const concentration = buildConcentration(holdersJson);
const activity = clusterJson || {};
const trend = getRiskTrend(mintStr);

const baseSecurityModel = buildSecurityModel({
concentration,
token: tokenJson,
activity,
market: marketJson || {},
trend,
});

const securityModel = enrichSecurityModel({
baseModel: baseSecurityModel,
concentration,
token: tokenJson,
market: marketJson || {},
activity,
trend,
holdersJson,
});

let cassieIntelResult = null;

try {
if (typeof cassieIntel?.analyze === "function") {
cassieIntelResult = cassieIntel.analyze({
mint: mintStr,
token: tokenJson,
market: marketJson || {},
concentration,
activity,
securityModel,
trend,
});
} else {
cassieIntelResult = buildCassieIntelFallback({
token: tokenJson,
market: marketJson || {},
concentration,
activity,
trend,
securityModel,
});
}
} catch {
cassieIntelResult = buildCassieIntelFallback({
token: tokenJson,
market: marketJson || {},
concentration,
activity,
trend,
securityModel,
});
}

upsertScanCache({
mint: mintStr,
token: tokenJson,
market: marketJson || { found: false },
holders: holdersJson,
activity,
securityModel,
cassie: cassieIntelResult,
});

return res.json({
ok: true,
mint: mintStr,
token: tokenJson,
market: marketJson || { found: false },
holders: holdersJson,
concentration,
activity,
trend,
securityModel,
cassie: cassieIntelResult,
});
} catch (e) {
return respondMintRouteError(res, e);
}
});

// ---------- Share Summary ----------
app.get("/api/sol/share-summary/:mint", async (req, res) => {
const mintStr = req.params.mint;

try {
const mint = assertMint(mintStr);
if (!mint) return res.status(400).json({ error: "Invalid mint" });

const [tokenJson, marketJson, holdersJson, clusterJson] = await Promise.all([
fetchTokenData(mint, mintStr),
fetchMarketData(mintStr),
fetchHoldersData(mint, mintStr),
fetchClusterData(mint, mintStr),
]);

if (!tokenJson || !holdersJson) {
return res.status(404).json({ error: "Mint not found" });
}

const concentration = buildConcentration(holdersJson);
const trend = getRiskTrend(mintStr);

const baseSecurityModel = buildSecurityModel({
concentration,
token: tokenJson,
activity: clusterJson || {},
market: marketJson || {},
trend,
});

const securityModel = enrichSecurityModel({
baseModel: baseSecurityModel,
concentration,
token: tokenJson,
market: marketJson || {},
activity: clusterJson || {},
trend,
holdersJson,
});

const cassie =
typeof cassieIntel?.analyze === "function"
? cassieIntel.analyze({
mint: mintStr,
token: tokenJson,
market: marketJson || {},
concentration,
activity: clusterJson || {},
securityModel,
trend,
})
: buildCassieIntelFallback({
token: tokenJson,
market: marketJson || {},
concentration,
activity: clusterJson || {},
trend,
securityModel,
});

const name = tokenJson?.metadata?.name || marketJson?.baseName || "Unknown Token";
const symbol = tokenJson?.metadata?.symbol || marketJson?.baseSymbol || "TOKEN";

const liquidityUsd = Number(marketJson?.liquidityUsd || 0);
const top10 = Number(concentration?.top10 || 0);

return res.json({
ok: true,
mint: mintStr,
name: String(name).trim(),
symbol: String(symbol).trim().toUpperCase(),
riskLabel: securityModel?.label?.text || "Unknown",
riskState: securityModel?.label?.state || "warn",
riskScore: Number(securityModel?.score ?? 0),
cassieVerdict: cassie?.verdict || titleCase(cassie?.status || "Unknown"),
cassieThreat: cassie?.threatLevel || "Unknown",
cassieScore: Number(cassie?.score ?? 0),
liquidityUsd,
top10Pct: top10,
liquidityText: fmtUsdCompact(liquidityUsd),
top10Text: `${top10.toFixed(2)}%`,
imageUrl: `${req.protocol}://${req.get("host")}/api/sol/share-image/${mintStr}`,
scanUrl: `https://www.mssprotocol.com/token.html?mint=${encodeURIComponent(mintStr)}`,
});
} catch (e) {
return respondMintRouteError(res, e);
}
});

// ---------- Share Image ----------
app.get("/api/sol/share-image/:mint", async (req, res) => {
try {
return res.redirect(302, "https://www.mssprotocol.com/images/mss-share-card.png");
} catch (e) {
return res.status(500).json({ error: String(e?.message || e) });
}
});

// ---------- Risk Record ----------
app.post("/api/sol/risk-record", (req, res) => {
try {
const { mint, risk, whale, top10, liqUsd, fdvUsd } = req.body || {};
if (!mint || risk == null) {
return res.status(400).json({ error: "Missing mint/risk" });
}

insertRiskPoint({ mint, risk, whale, top10, liqUsd, fdvUsd });
return res.json({ ok: true });
} catch (e) {
return res.status(500).json({ error: String(e?.message || e) });
}
});

// ---------- Risk Trend ----------
app.get("/api/sol/risk-trend/:mint", (req, res) => {
try {
const mint = req.params.mint;
return res.json(getRiskTrend(mint));
} catch (e) {
return res.status(500).json({ error: String(e?.message || e) });
}
});

// ---------- Alerts ----------
app.get("/api/alerts", authRequired, (req, res) => {
const rows = db
.prepare(`
SELECT id, mint, type, direction, threshold, is_enabled, created_at, last_triggered_at
FROM alerts
WHERE user_id = ?
ORDER BY id DESC
`)
.all(req.user.id);

res.json({ ok: true, alerts: rows });
});

app.post("/api/alerts", authRequired, (req, res) => {
const { mint, type, direction, threshold } = req.body || {};
if (!mint || !type || !direction || threshold == null) {
return res.status(400).json({ error: "Missing fields" });
}

const allowedTypes = new Set([
"risk_spike",
"whale",
"liquidity",
"authority",
"top10",
"hidden_control",
"fresh_wallets",
"developer_network",
"wallet_network",
"network_control",
"cluster_growth",
"linked_wallets",
"whale_sync",
"trend_24h",
]);

const allowedDirections = new Set(["above", "below"]);

if (!allowedTypes.has(type)) {
return res.status(400).json({ error: "Invalid type" });
}
if (!allowedDirections.has(direction)) {
return res.status(400).json({ error: "Invalid direction" });
}

const info = db
.prepare(`
INSERT INTO alerts (user_id, mint, type, direction, threshold)
VALUES (?, ?, ?, ?, ?)
`)
.run(req.user.id, mint, type, direction, Number(threshold));

return res.json({ ok: true, id: info.lastInsertRowid });
});

app.post("/api/alerts/:id/toggle", authRequired, (req, res) => {
const id = Number(req.params.id);
const row = db
.prepare(`SELECT * FROM alerts WHERE id = ? AND user_id = ?`)
.get(id, req.user.id);

if (!row) return res.status(404).json({ error: "Not found" });

const next = row.is_enabled ? 0 : 1;
db.prepare(`UPDATE alerts SET is_enabled = ? WHERE id = ?`).run(next, id);
res.json({ ok: true, is_enabled: next });
});

// ---------- Alert Events ----------
app.get("/api/alert-events", authRequired, (req, res) => {
try {
const limit = clamp(Number(req.query.limit || 50), 1, 200);

const rows = db
.prepare(`
SELECT
ev.id,
ev.alert_id,
ev.mint,
ev.message,
ev.created_at,
a.type,
a.direction,
a.threshold
FROM alert_events ev
INNER JOIN alerts a ON a.id = ev.alert_id
WHERE a.user_id = ?
ORDER BY datetime(ev.created_at) DESC
LIMIT ?
`)
.all(req.user.id, limit);

return res.json({ ok: true, events: rows });
} catch (e) {
return res.status(500).json({ error: String(e?.message || e) });
}
});

app.get("/api/alerts/:id/events", authRequired, (req, res) => {
try {
const id = Number(req.params.id);
const row = db
.prepare(`SELECT * FROM alerts WHERE id = ? AND user_id = ?`)
.get(id, req.user.id);

if (!row) return res.status(404).json({ error: "Not found" });

const events = getAlertEvents(id, 100);
return res.json({ ok: true, events });
} catch (e) {
return res.status(500).json({ error: String(e?.message || e) });
}
});

// ---- Start ----
app.listen(PORT, "0.0.0.0", () => {
console.log(`✅ MSS API running on http://0.0.0.0:${PORT}`);
console.log(`🔒 RPC hidden (label only)`);
console.log(`🛡️ Cassie: enabled (defensive middleware + intel layer)`);
});

startLaunchWorker();
startWatcher();
startGraduationWatcher();
checkLaunchCountdowns().catch((err) => {
console.error("Initial launch countdown check failed:", err);
});