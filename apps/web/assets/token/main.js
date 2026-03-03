import { ENDPOINTS, SAMPLE_MINT } from "./config.js";
import { $, setText, setPill, setStatus } from "./dom.js";
import { fetchRetry, safeJson } from "./api.js";
import { renderToken, renderMarket, renderMcap, renderHolders, renderRisk, renderRaw } from "./render.js";

async function runScan(mint) {
const t0 = performance.now();
setStatus({ ok: null, msg: "Scanning…", ms: null });

// Reset key UI
setText("priceUsd", "—");
setText("pairText", "Pair: —");
setText("liqUsd", "—");
setText("vol24h", "Vol 24h: —");
setText("fdvUsd", "—");
setText("mcapUsd", "MCap: —");
setText("supplyText", "—");
setText("decimalsText", "—");
setPill("mintAuthPill", "Mint Authority: —", "muted");
setPill("freezeAuthPill", "Freeze Authority: —", "muted");
setPill("dexPill", "DEX: —", "muted");

setText("chipTop1", "Top1: —");
setText("chipTop5", "Top5: —");
setText("chipTop10", "Top10: —");
setText("chipTop20", "Top20: —");
setText("chipWhale", "Whale Dominance: —/100");

try {
// Token + Market in parallel
const [tokenResp, marketResp] = await Promise.all([
fetchRetry(ENDPOINTS.token(mint), { tries: 4, baseDelay: 250 }),
fetchRetry(ENDPOINTS.market(mint), { tries: 3, baseDelay: 250 }),
]);

const tokenJson = await safeJson(tokenResp);
const marketJson = await safeJson(marketResp);

renderToken(tokenJson);
renderMarket(marketJson);

// Holders (separate)
let holdersJson = null;
let top1 = null;
let top10 = null;
let totalSupplyUi = null;

try {
const holdersResp = await fetchRetry(ENDPOINTS.holders(mint), { tries: 4, baseDelay: 350 });
holdersJson = await safeJson(holdersResp);

const conc = renderHolders(holdersJson);
top1 = conc.top1;
top10 = conc.top10;
totalSupplyUi = conc.totalSupplyUi;
} catch (e) {
holdersJson = { found: false, error: e?.message || String(e) };
renderHolders(holdersJson);
}

// Market cap (derived)
renderMcap({ marketJson, totalSupplyUi });

// Risk
renderRisk({ tokenJson, marketJson, top1, top10 });

// Raw JSON panel
renderRaw({ mint, token: tokenJson, market: marketJson, holders: holdersJson });

const ms = Math.round(performance.now() - t0);
setStatus({ ok: true, msg: "Scan complete", ms });
} catch (e) {
const ms = Math.round(performance.now() - t0);
setStatus({ ok: false, msg: "Scan failed — check API server", ms });
renderRaw({ error: e?.message || String(e), mint });
}
}

function init() {
const mintInput = $("mintInput");
const scanBtn = $("scanBtn");
const pasteBtn = $("pasteBtn");
const sampleBtn = $("sampleBtn");
const retryHoldersBtn = $("retryHoldersBtn");

if (!mintInput || !scanBtn) return;

scanBtn.addEventListener("click", async () => {
const mint = (mintInput.value || "").trim();
if (!mint) {
setStatus({ ok: false, msg: "Paste a Solana mint first.", ms: null });
return;
}
await runScan(mint);
});

if (pasteBtn) {
pasteBtn.addEventListener("click", async () => {
try {
const txt = (await navigator.clipboard.readText()).trim();
if (txt) mintInput.value = txt;
} catch {
setStatus({ ok: false, msg: "Clipboard blocked by browser permissions.", ms: null });
}
});
}

if (sampleBtn) {
sampleBtn.addEventListener("click", () => {
mintInput.value = SAMPLE_MINT;
});
}

if (retryHoldersBtn) {
retryHoldersBtn.addEventListener("click", async () => {
const mint = (mintInput.value || "").trim();
if (!mint) return;
await runScan(mint);
});
}

mintInput.addEventListener("keydown", (e) => {
if (e.key === "Enter") {
e.preventDefault();
scanBtn.click();
}
});

setStatus({ ok: null, msg: "Ready", ms: null });
}

if (document.readyState === "loading") {
document.addEventListener("DOMContentLoaded", init);
} else {
init();
}
