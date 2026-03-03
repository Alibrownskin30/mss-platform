import "dotenv/config";
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { Connection, PublicKey } from "@solana/web3.js";
import pkg from "@metaplex-foundation/mpl-token-metadata";
import { AccountLayout } from "@solana/spl-token";

import { db, insertRiskPoint, getRiskTrend } from "./db.js";
import { register, login, authRequired } from "./auth.js";
import { startWatcher } from "./watcher.js";
import { getClusterIntel } from "./cluster.js";

// ✅ Cassie
import { cassieMiddleware, registerCassieHoneypots, cassieDiagHandler } from "./cassie/index.js";

const { Metadata } = pkg;

const app = express();
const PORT = process.env.PORT || 8787;

// IMPORTANT: behind Codespaces / reverse proxy
app.set("trust proxy", 1);

// CORS (safer defaults in production)
const isProd = process.env.NODE_ENV === "production";
const corsOrigin =
process.env.CORS_ORIGIN?.trim() ||
(isProd ? "" : true); // dev: allow; prod: require explicit origin

app.use(
cors({
origin: corsOrigin || false,
credentials: true,
})
);

// Body limits (parser bombs)
app.use(express.json({ limit: "1mb" }));

// ✅ Cassie FIRST (protect everything below)
app.use(cassieMiddleware());

// ✅ Cassie honeypots (should be early, before real routes)
registerCassieHoneypots(app);

// OPTIONAL: internal diagnostics (lock this down)
// Use: curl -H "Authorization: Bearer <ADMIN_KEY>" /api/_cassie/diag
app.get("/api/_cassie/diag", (req, res) => cassieDiagHandler(req, res));

// Auth
app.post("/api/register", register);
app.post("/api/login", login);

// Solana RPC (Helius if SOLANA_RPC set)
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

// Caches
const holdersCache = new Map();
const holdersInFlight = new Map();
const HOLDERS_TTL_MS = 120_000;

const clusterCache = new Map(); // mint -> {ts,data}
const CLUSTER_TTL_MS = 180_000; // 3 mins

// Health
app.get("/health", (req, res) => {
res.json({
ok: true,
service: "mss-api",
port: Number(PORT),
rpcLabel: "Solana Mainnet (Live)",
});
});

app.get("/", (req, res) => {
res.json({ ok: true, service: "mss-api" });
});

// ---------- Token Safety + metadata ----------
app.get("/api/sol/token/:mint", async (req, res) => {
try {
const mint = new PublicKey(req.params.mint);

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
const url = `https://api.dexscreener.com/latest/dex/tokens/${mint}`;
const r = await fetch(url, { timeout: 10_000 });
const j = await r.json();

if (!j?.pairs?.length) return res.json({ found: false });

const p = j.pairs[0];
return res.json({
found: true,
dex: p.dexId,
pair: p.pairAddress,
priceUsd: p.priceUsd,
fdv: p.fdv,
liquidityUsd: p.liquidity?.usd || 0,
volume24h: p.volume?.h24 || 0,
baseSymbol: p.baseToken?.symbol,
quoteSymbol: p.quoteToken?.symbol,
});
} catch (e) {
return res.status(500).json({ error: String(e?.message || e) });
}
});

// ---------- Holders (Top 20 + owner wallet) ----------
app.get("/api/sol/holders/:mint", async (req, res) => {
const mintStr = req.params.mint;

try {
const cached = holdersCache.get(mintStr);
if (cached && Date.now() - cached.ts < HOLDERS_TTL_MS) return res.json(cached.data);

if (holdersInFlight.has(mintStr)) {
const data = await holdersInFlight.get(mintStr);
return res.json(data);
}

const task = (async () => {
const mint = new PublicKey(mintStr);

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
if (!info?.data) return null;
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

const out = { found: true, mint: mint.toBase58(), decimals, totalSupplyUi: totalUi, holders };

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

// ---------- Cluster Intelligence (NEW) ----------
app.get("/api/sol/cluster/:mint", async (req, res) => {
const mintStr = req.params.mint;
try {
const cached = clusterCache.get(mintStr);
if (cached && Date.now() - cached.ts < CLUSTER_TTL_MS) return res.json(cached.data);

// Get owners from holders endpoint logic (reuse cached if exists)
let holdersData = holdersCache.get(mintStr)?.data;
if (!holdersData) {
const mint = new PublicKey(mintStr);
const largest = await rpcRetry(() => connection.getTokenLargestAccounts(mint));
const top = (largest?.value || []).slice(0, 20);
const tokenAccPubkeys = top.map((a) => new PublicKey(a.address));
const accInfos = await rpcRetry(() => connection.getMultipleAccountsInfo(tokenAccPubkeys));

const owners = accInfos.map((info) => {
try {
if (!info?.data) return null;
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

// Start
app.listen(PORT, "0.0.0.0", () => {
console.log(`✅ MSS API running on http://0.0.0.0:${PORT}`);
console.log(`🔒 RPC hidden (label only)`);
});

startWatcher();
