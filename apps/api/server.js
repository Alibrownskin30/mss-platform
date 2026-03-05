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

import { db, insertRiskPoint, getRiskTrend } from "./db.js";
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
// DO NOT disable CSP unless you truly need it. Helmet doesn't set CSP unless configured.
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

// Honeypots (keep boring)
app.get("/api/_cassie/diag", (req, res) => res.status(404).end());
app.post("/api/admin/_sync", (req, res) => res.status(401).end());

// Optional Cassie status endpoint (auth-gated)
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
const delay = Math.min(8000, baseDelayMs * Math.pow(2, i)) + Math.floor(Math.random() * 200);
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

// ---------- Market (Dexscreener) ----------
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

// ✅ normalized for UI/sharecard
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

// ---------- Holders (Top 20 + owner wallet) ----------
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
if (isRateLimitError(e))
return res.status(429).json({ error: "RPC rate limited (429). Try again shortly." });
return res.status(500).json({ error: String(e?.message || e) });
}
});

// ---------- Cluster Intelligence (on-chain heuristic) ----------
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
if (isRateLimitError(e))
return res.status(429).json({ error: "RPC rate limited (429). Try again shortly." });
return res.status(500).json({ error: String(e?.message || e) });
}
});

// ---------- MSS Security Intelligence (derived from cluster + holders + authorities) ----------
// This endpoint is optional for now; it returns the security model only.
// Your UI can call it later, or you can keep using the existing endpoints and compute client-side.
app.get("/api/sol/security/:mint", async (req, res) => {
const mintStr = req.params.mint;

try {
const mint = assertMint(mintStr);
if (!mint) return res.status(400).json({ error: "Invalid mint" });

// Pull base data (reuse caches where possible)
const [tokenJson, holdersJson, clusterJson] = await Promise.all([
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

// For cluster, we need owners from top holders
const owners =
(holdersCache.get(mintStr)?.data?.holders || [])
.map((h) => h.owner)
.filter(Boolean) || [];

const intel = await getClusterIntel({ connection, rpcRetry, owners });

clusterCache.set(mintStr, { ts: Date.now(), data: intel });
return intel;
})(),
]);

if (!tokenJson || !holdersJson) return res.status(404).json({ error: "Mint not found" });

// Concentration
const holders = Array.isArray(holdersJson?.holders) ? holdersJson.holders : [];
const pct = holders.map((h) => Number(h.pctSupply || 0));
const sumTopN = (n) => pct.slice(0, n).reduce((a, b) => a + b, 0);

const concentration = {
top1: sumTopN(1),
top5: sumTopN(5),
top10: sumTopN(10),
top20: sumTopN(20),
};

// activity is whatever cluster.json returns (your existing structure)
const activity = clusterJson || {};

const securityModel = buildSecurityModel({
concentration,
token: tokenJson,
activity,
});

return res.json({
ok: true,
mint: mintStr,
concentration,
securityModel,
});
} catch (e) {
if (isRateLimitError(e))
return res.status(429).json({ error: "RPC rate limited (429). Try again shortly." });
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

// ---------- Alerts (auth required) ----------
app.get("/api/alerts", authRequired, (req, res) => {
const rows = db
.prepare(
`SELECT id, mint, type, direction, threshold, is_enabled, created_at, last_triggered_at
FROM alerts WHERE user_id = ? ORDER BY id DESC`
)
.all(req.user.id);

res.json({ ok: true, alerts: rows });
});

app.post("/api/alerts", authRequired, (req, res) => {
const { mint, type, direction, threshold } = req.body || {};
if (!mint || !type || !direction || threshold == null)
return res.status(400).json({ error: "Missing fields" });

// Minimal validation (keeps it robust without being annoying)
const allowedTypes = new Set(["risk_spike", "whale", "liquidity", "authority"]);
const allowedDirections = new Set(["above", "below"]);
if (!allowedTypes.has(type)) return res.status(400).json({ error: "Invalid type" });
if (!allowedDirections.has(direction)) return res.status(400).json({ error: "Invalid direction" });

const info = db
.prepare(
`INSERT INTO alerts (user_id, mint, type, direction, threshold)
VALUES (?, ?, ?, ?, ?)`
)
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

// ---- Start ----
app.listen(PORT, "0.0.0.0", () => {
console.log(`✅ MSS API running on http://0.0.0.0:${PORT}`);
console.log(`🔒 RPC hidden (label only)`);
console.log(`🛡️ Cassie: enabled (defensive middleware)`);
});

startWatcher();