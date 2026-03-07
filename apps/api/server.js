import "dotenv/config";
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import slowDown from "express-slow-down";

import { Connection, PublicKey } from "@solana/web3.js";
import pkg from "@metaplex-foundation/mpl-token-metadata";
import { AccountLayout } from "@solana/spl-token";

import {
db,
insertRiskPoint,
getRiskTrend,
getAlertEvents,
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

// ---- Security headers ----
app.use(
helmet({
crossOriginResourcePolicy: { policy: "cross-origin" },
})
);

// ---- Body parsing ----
app.use(express.json({ limit: process.env.BODY_LIMIT || "1mb" }));

// ---- CORS ----
const rawOrigins = (process.env.CORS_ORIGINS || "")
.split(",")
.map((s) => s.trim())
.filter(Boolean);

const corsOptions =
NODE_ENV !== "production" || rawOrigins.length === 0
? { origin: true, credentials: false }
: {
origin(origin, cb) {
if (!origin) return cb(null, true);
if (rawOrigins.includes(origin)) return cb(null, true);
return cb(new Error("Not allowed by CORS"));
},
credentials: false,
};

app.use(cors(corsOptions));

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

// ---- Cassie (middleware sits in front of API) ----
const { cassie, cassieApi } = createCassie();
app.use(cassie);

// Honeypots
app.get("/api/_cassie/diag", (req, res) => res.status(404).end());
app.post("/api/admin/_sync", (req, res) => res.status(401).end());

// Optional Cassie status endpoint
app.get("/api/cassie/status", authRequired, (req, res) => cassieApi.status(req, res));

// ---- Solana RPC ----
const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
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
Math.min(8000, baseDelayMs * Math.pow(2, i)) + Math.floor(Math.random() * 200);
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

function enrichSecurityModel({
baseModel,
concentration,
token,
market,
activity,
trend,
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
Math.round(clusterScore * 0.65 + linkedWallets * 3 + Math.max(0, top10 - 35) * 0.35),
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
linkedWallets,
linkedWalletPct:
top10 > 0 ? Math.min(top10, safeNum(activity?.maxClusterSize, 0) * (top10 / 10)) : 0,
sharedFundingDetected: clusterCount >= 1,
};

const developerActivityScore = clamp(
Math.round(hiddenControlScore * 0.55 + (clusterCount >= 2 ? 18 : 0) + (newWalletPct >= 20 ? 12 : 0)),
0,
100
);

const developerActivity = {
detected: developerActivityScore >= 45,
score: developerActivityScore,
label:
developerActivityScore >= 65
? "Developer Overlap Elevated"
: developerActivityScore >= 45
? "Possible Developer Linkage"
: "No Strong Overlap",
linkedWallets,
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
walletCount: Math.round((safeNum(activity?.analyzedWallets, 0) * newWalletPct) / 100),
pct: Number(newWalletPct.toFixed(1)),
};

const liquidityStabilityScore = clamp(
Math.round(
100 -
(liqFdvPct < 1 ? 80 : liqFdvPct < 3 ? 60 : liqFdvPct < 5 ? 40 : liqFdvPct < 10 ? 20 : 8)
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
pressure:
whaleActivityScore >= 70
? "High"
: whaleActivityScore >= 40
? "Moderate"
: "Normal",
syncBurstSize: safeNum(activity?.maxClusterSize, 0),
};

const reputation = getReputationFromTrend(trend, baseModel?.score);

const trendBlock = {
label: trend?.trend?.label || "Stable",
state: trend?.trend?.state || "warn",
momentum: trend?.trend?.momentum || "Stable",
delta1h: trend?.change?.["1h"] ?? null,
delta6h: trend?.change?.["6h"] ?? null,
delta24h: trend?.change?.["24h"] ?? null,
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
freshWalletRisk,
liquidityStability,
whaleActivity,
trend: trendBlock,
reputation,
};
}

// ---- Caches ----
const holdersCache = new Map();
const holdersInFlight = new Map();
const HOLDERS_TTL_MS = 120_000;

const clusterCache = new Map();
const CLUSTER_TTL_MS = 180_000;

const marketCache = new Map();
const MARKET_TTL_MS = 30_000;

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

const info = await rpcRetry(() => connection.getParsedAccountInfo(mint));
if (!info.value) return res.status(404).json({ error: "Mint not found" });

const mintParsed = info.value.data?.parsed?.info;
if (!mintParsed) return res.status(500).json({ error: "Unable to parse mint" });

const mintAuthority = mintParsed.mintAuthority ?? null;
const freezeAuthority = mintParsed.freezeAuthority ?? null;
const supply = mintParsed.supply;
const decimals = mintParsed.decimals;

let metadata = null;
try {
const metaPDA = Metadata.getPDA(mint);
const metaAcc = await rpcRetry(() => Metadata.load(connection, metaPDA));
metadata = metaAcc?.data?.data || null;
} catch {
metadata = null;
}

return res.json({
mint: mint.toBase58(),
chain: "solana",
supply,
decimals,
mintAuthority,
freezeAuthority,
safety: {
mintRevoked: !mintAuthority,
freezeRevoked: !freezeAuthority,
},
metadata,
rpcLabel: "Solana Mainnet (Live)",
source: "onchain",
});
} catch (e) {
return res.status(500).json({ error: String(e?.message || e) });
}
});

// ---------- Market ----------
app.get("/api/sol/market/:mint", async (req, res) => {
try {
const mint = req.params.mint;
const mintPk = assertMint(mint);
if (!mintPk) return res.status(400).json({ error: "Invalid mint" });

const cached = marketCache.get(mint);
if (cached && Date.now() - cached.ts < MARKET_TTL_MS) return res.json(cached.data);

const url = `https://api.dexscreener.com/latest/dex/tokens/${mint}`;
const r = await fetch(url, { timeout: 10_000 });
const j = await r.json();

if (!j?.pairs?.length) {
const out = { found: false };
marketCache.set(mint, { ts: Date.now(), data: out });
return res.json(out);
}

const p = j.pairs[0];
const mcapUsd = p.marketCap ?? p.marketcap ?? p.mcap ?? null;
const pc = p.priceChange || {};

const out = {
found: true,
dex: p.dexId,
pair: p.pairAddress,
priceUsd: p.priceUsd,
fdv: p.fdv ?? null,
mcapUsd: mcapUsd ?? null,
liquidityUsd: p.liquidity?.usd || 0,
volume24h: p.volume?.h24 || 0,
baseSymbol: p.baseToken?.symbol,
quoteSymbol: p.quoteToken?.symbol,
baseName: p.baseToken?.name,
quoteName: p.quoteToken?.name,
priceChange: {
h1: pc.h1 ?? null,
h24: pc.h24 ?? null,
d7: pc.d7 ?? pc.h168 ?? null,
m30: pc.m30 ?? pc.d30 ?? null,
},
};

marketCache.set(mint, { ts: Date.now(), data: out });
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

const cached = holdersCache.get(mintStr);
if (cached && Date.now() - cached.ts < HOLDERS_TTL_MS) return res.json(cached.data);

if (holdersInFlight.has(mintStr)) {
const data = await holdersInFlight.get(mintStr);
return res.json(data);
}

const task = (async () => {
const [supplyResp, largest] = await Promise.all([
rpcRetry(() => connection.getTokenSupply(mint)),
rpcRetry(() => connection.getTokenLargestAccounts(mint)),
]);

const totalUi = supplyResp?.value?.uiAmount ?? null;
const decimals = supplyResp?.value?.decimals ?? null;

const top = (largest?.value || []).slice(0, 20);
const tokenAccPubkeys = top.map((a) => new PublicKey(a.address));

const accInfos = await rpcRetry(() => connection.getMultipleAccountsInfo(tokenAccPubkeys));

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
const pct = totalUi && ui != null && totalUi > 0 ? (ui / totalUi) * 100 : null;

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
const data = await task;
holdersInFlight.delete(mintStr);
return res.json(data);
} catch (e) {
holdersInFlight.delete(mintStr);
if (isRateLimitError(e)) {
return res.status(429).json({ error: "RPC rate limited (429). Try again shortly." });
}
return res.status(500).json({ error: String(e?.message || e) });
}
});

// ---------- Cluster Intelligence ----------
app.get("/api/sol/cluster/:mint", async (req, res) => {
const mintStr = req.params.mint;
try {
const mint = assertMint(mintStr);
if (!mint) return res.status(400).json({ error: "Invalid mint" });

const cached = clusterCache.get(mintStr);
if (cached && Date.now() - cached.ts < CLUSTER_TTL_MS) return res.json(cached.data);

let holdersData = holdersCache.get(mintStr)?.data;

if (!holdersData) {
const largest = await rpcRetry(() => connection.getTokenLargestAccounts(mint));
const top = (largest?.value || []).slice(0, 20);
const tokenAccPubkeys = top.map((a) => new PublicKey(a.address));
const accInfos = await rpcRetry(() => connection.getMultipleAccountsInfo(tokenAccPubkeys));

const owners = accInfos.map((info) => {
try {
if (!info?.data || info.data.length !== AccountLayout.span) return null;
const decoded = AccountLayout.decode(info.data);
return new PublicKey(decoded.owner).toBase58();
} catch {
return null;
}
});

holdersData = { holders: top.map((a, i) => ({ owner: owners[i] })) };
}

const owners = (holdersData?.holders || []).map((h) => h.owner).filter(Boolean);
const intel = await getClusterIntel({ connection, rpcRetry, owners });

clusterCache.set(mintStr, { ts: Date.now(), data: intel });
return res.json(intel);
} catch (e) {
if (isRateLimitError(e)) {
return res.status(429).json({ error: "RPC rate limited (429). Try again shortly." });
}
return res.status(500).json({ error: String(e?.message || e) });
}
});

// ---------- MSS Security Intelligence ----------
app.get("/api/sol/security/:mint", async (req, res) => {
const mintStr = req.params.mint;

try {
const mint = assertMint(mintStr);
if (!mint) return res.status(400).json({ error: "Invalid mint" });

const [tokenJson, marketJson, holdersJson, clusterJson] = await Promise.all([
(async () => {
const info = await rpcRetry(() => connection.getParsedAccountInfo(mint));
if (!info.value) return null;

const mintParsed = info.value.data?.parsed?.info;
if (!mintParsed) return null;

const mintAuthority = mintParsed.mintAuthority ?? null;
const freezeAuthority = mintParsed.freezeAuthority ?? null;
const supply = mintParsed.supply;
const decimals = mintParsed.decimals;

let metadata = null;
try {
const metaPDA = Metadata.getPDA(mint);
const metaAcc = await rpcRetry(() => Metadata.load(connection, metaPDA));
metadata = metaAcc?.data?.data || null;
} catch {
metadata = null;
}

return {
mint: mint.toBase58(),
chain: "solana",
supply,
decimals,
mintAuthority,
freezeAuthority,
safety: {
mintRevoked: !mintAuthority,
freezeRevoked: !freezeAuthority,
},
metadata,
rpcLabel: "Solana Mainnet (Live)",
source: "onchain",
};
})(),

(async () => {
const cached = marketCache.get(mintStr);
if (cached && Date.now() - cached.ts < MARKET_TTL_MS) return cached.data;

const url = `https://api.dexscreener.com/latest/dex/tokens/${mintStr}`;
const r = await fetch(url, { timeout: 10_000 });
const j = await r.json();

if (!j?.pairs?.length) return { found: false };

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
})(),

(async () => {
const cached = holdersCache.get(mintStr);
if (cached && Date.now() - cached.ts < HOLDERS_TTL_MS) return cached.data;

const [supplyResp, largest] = await Promise.all([
rpcRetry(() => connection.getTokenSupply(mint)),
rpcRetry(() => connection.getTokenLargestAccounts(mint)),
]);

const totalUi = supplyResp?.value?.uiAmount ?? null;
const decimals = supplyResp?.value?.decimals ?? null;

const top = (largest?.value || []).slice(0, 20);
const tokenAccPubkeys = top.map((a) => new PublicKey(a.address));
const accInfos = await rpcRetry(() => connection.getMultipleAccountsInfo(tokenAccPubkeys));

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
const pct = totalUi && ui != null && totalUi > 0 ? (ui / totalUi) * 100 : null;

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
})(),

(async () => {
const cached = clusterCache.get(mintStr);
if (cached && Date.now() - cached.ts < CLUSTER_TTL_MS) return cached.data;

const owners = (holdersCache.get(mintStr)?.data?.holders || [])
.map((h) => h.owner)
.filter(Boolean);

const intel = await getClusterIntel({ connection, rpcRetry, owners });
clusterCache.set(mintStr, { ts: Date.now(), data: intel });
return intel;
})(),
]);

if (!tokenJson || !holdersJson) {
return res.status(404).json({ error: "Mint not found" });
}

const holders = Array.isArray(holdersJson?.holders) ? holdersJson.holders : [];
const pct = holders.map((h) => Number(h.pctSupply || 0));
const sumTopN = (n) => pct.slice(0, n).reduce((a, b) => a + b, 0);

const concentration = {
top1: sumTopN(1),
top5: sumTopN(5),
top10: sumTopN(10),
top20: sumTopN(20),
};

const activity = clusterJson || {};
const baseSecurityModel = buildSecurityModel({
concentration,
token: tokenJson,
activity,
});

const trend = getRiskTrend(mintStr);
const securityModel = enrichSecurityModel({
baseModel: baseSecurityModel,
concentration,
token: tokenJson,
market: marketJson || {},
activity,
trend,
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
});
} catch (e) {
if (isRateLimitError(e)) {
return res.status(429).json({ error: "RPC rate limited (429). Try again shortly." });
}
return res.status(500).json({ error: String(e?.message || e) });
}
});

// ---------- Share Summary ----------
app.get("/api/sol/share-summary/:mint", async (req, res) => {
const mintStr = req.params.mint;

try {
const mint = assertMint(mintStr);
if (!mint) return res.status(400).json({ error: "Invalid mint" });

const [tokenJson, marketJson, holdersJson, clusterJson] = await Promise.all([
(async () => {
const info = await rpcRetry(() => connection.getParsedAccountInfo(mint));
if (!info.value) return null;

const mintParsed = info.value.data?.parsed?.info;
if (!mintParsed) return null;

const mintAuthority = mintParsed.mintAuthority ?? null;
const freezeAuthority = mintParsed.freezeAuthority ?? null;
const supply = mintParsed.supply;
const decimals = mintParsed.decimals;

let metadata = null;
try {
const metaPDA = Metadata.getPDA(mint);
const metaAcc = await rpcRetry(() => Metadata.load(connection, metaPDA));
metadata = metaAcc?.data?.data || null;
} catch {
metadata = null;
}

return {
mint: mint.toBase58(),
chain: "solana",
supply,
decimals,
mintAuthority,
freezeAuthority,
safety: {
mintRevoked: !mintAuthority,
freezeRevoked: !freezeAuthority,
},
metadata,
};
})(),

(async () => {
const cached = marketCache.get(mintStr);
if (cached && Date.now() - cached.ts < MARKET_TTL_MS) return cached.data;

const url = `https://api.dexscreener.com/latest/dex/tokens/${mintStr}`;
const r = await fetch(url, { timeout: 10_000 });
const j = await r.json();

if (!j?.pairs?.length) return { found: false };

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
})(),

(async () => {
const cached = holdersCache.get(mintStr);
if (cached && Date.now() - cached.ts < HOLDERS_TTL_MS) return cached.data;

const [supplyResp, largest] = await Promise.all([
rpcRetry(() => connection.getTokenSupply(mint)),
rpcRetry(() => connection.getTokenLargestAccounts(mint)),
]);

const totalUi = supplyResp?.value?.uiAmount ?? null;
const decimals = supplyResp?.value?.decimals ?? null;

const top = (largest?.value || []).slice(0, 20);
const tokenAccPubkeys = top.map((a) => new PublicKey(a.address));
const accInfos = await rpcRetry(() => connection.getMultipleAccountsInfo(tokenAccPubkeys));

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
const pct = totalUi && ui != null && totalUi > 0 ? (ui / totalUi) * 100 : null;

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
})(),

(async () => {
const cached = clusterCache.get(mintStr);
if (cached && Date.now() - cached.ts < CLUSTER_TTL_MS) return cached.data;

const owners = (holdersCache.get(mintStr)?.data?.holders || [])
.map((h) => h.owner)
.filter(Boolean);

const intel = await getClusterIntel({ connection, rpcRetry, owners });
clusterCache.set(mintStr, { ts: Date.now(), data: intel });
return intel;
})(),
]);

if (!tokenJson || !holdersJson) {
return res.status(404).json({ error: "Mint not found" });
}

const holders = Array.isArray(holdersJson?.holders) ? holdersJson.holders : [];
const pct = holders.map((h) => Number(h.pctSupply || 0));
const sumTopN = (n) => pct.slice(0, n).reduce((a, b) => a + b, 0);

const concentration = {
top1: sumTopN(1),
top5: sumTopN(5),
top10: sumTopN(10),
top20: sumTopN(20),
};

const baseSecurityModel = buildSecurityModel({
concentration,
token: tokenJson,
activity: clusterJson || {},
});

const trend = getRiskTrend(mintStr);
const securityModel = enrichSecurityModel({
baseModel: baseSecurityModel,
concentration,
token: tokenJson,
market: marketJson || {},
activity: clusterJson || {},
trend,
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
liquidityUsd,
top10Pct: top10,
liquidityText: fmtUsdCompact(liquidityUsd),
top10Text: `${top10.toFixed(2)}%`,
imageUrl: `${req.protocol}://${req.get("host")}/api/sol/share-image/${mintStr}`,
scanUrl: `https://www.mssprotocol.com/token.html?mint=${encodeURIComponent(mintStr)}`,
});
} catch (e) {
if (isRateLimitError(e)) {
return res.status(429).json({ error: "RPC rate limited (429). Try again shortly." });
}
return res.status(500).json({ error: String(e?.message || e) });
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
if (!mint || risk == null) return res.status(400).json({ error: "Missing mint/risk" });

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

const allowedTypes = new Set(["risk_spike", "whale", "liquidity", "authority", "top10"]);
const allowedDirections = new Set(["above", "below"]);
if (!allowedTypes.has(type)) return res.status(400).json({ error: "Invalid type" });
if (!allowedDirections.has(direction)) return res.status(400).json({ error: "Invalid direction" });

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
const row = db.prepare(`SELECT * FROM alerts WHERE id = ? AND user_id = ?`).get(id, req.user.id);
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
const row = db.prepare(`SELECT * FROM alerts WHERE id = ? AND user_id = ?`).get(id, req.user.id);
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
console.log(`🛡️ Cassie: enabled (defensive middleware)`);
});

startWatcher();