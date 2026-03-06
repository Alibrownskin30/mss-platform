import { apiGet, apiPost, getApiBase } from "./api.js";
import { buildActivityFromHolders } from "./activity.js";
import { downloadShareCardPNG } from "./sharecard.js";

(() => {
const $ = (id) => document.getElementById(id);

const SAMPLE_MINT = "So11111111111111111111111111111111111111112";

const fmtUsd = (n) => {
if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
const v = Number(n);
if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
if (v >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
if (v >= 1) return `$${v.toFixed(6)}`;
return `$${v.toFixed(8)}`;
};

const fmtNum = (n) => {
if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
const v = Number(n);
if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
return `${v.toFixed(2)}`;
};

const fmtPct = (n, dp = 2) => {
if (n == null || Number.isNaN(Number(n))) return "—";
return `${Number(n).toFixed(dp)}%`;
};

const fmtSignedPct = (n, dp = 2) => {
if (n == null || Number.isNaN(Number(n))) return "—";
const v = Number(n);
const sign = v > 0 ? "+" : "";
return `${sign}${v.toFixed(dp)}%`;
};

const shortAddr = (s, left = 5, right = 5) => {
if (!s || typeof s !== "string") return "—";
if (s.length <= left + right + 3) return s;
return `${s.slice(0, left)}…${s.slice(-right)}`;
};

function setText(id, v) {
const el = $(id);
if (el) el.textContent = v;
}

function setDot(dotId, state) {
const dot = $(dotId);
if (!dot) return;
dot.classList.remove("good", "warn", "bad");
if (state) dot.classList.add(state);
}

function setBadge(_badgeId, dotId, textId, state, text) {
setDot(dotId, state);
setText(textId, text);
}

function setVisible(id, visible) {
const el = $(id);
if (!el) return;
el.style.display = visible ? "" : "none";
}

function hasNumber(v) {
return v != null && v !== "" && !Number.isNaN(Number(v));
}

function getTokenDisplay(scanObj) {
const token = scanObj?.token || {};
const market = scanObj?.market || {};
const risk = scanObj?.derived?.riskModel || {};

const name =
token?.metadata?.name ||
token?.meta?.name ||
token?.name ||
token?.tokenName ||
"";

const symbol =
token?.metadata?.symbol ||
token?.meta?.symbol ||
token?.symbol ||
token?.tokenSymbol ||
market?.baseSymbol ||
"";

const riskText = risk?.label?.text || "—";

return {
name: String(name || "").trim(),
symbol: String(symbol || "").trim(),
riskText: String(riskText || "—").trim(),
};
}

// ---- Concentration / Risk ----
function computeConcentration(holders = []) {
const pct = holders.map((h) => Number(h.pctSupply || 0));
const sumTopN = (n) => pct.slice(0, n).reduce((a, b) => a + b, 0);
return {
top1: sumTopN(1),
top5: sumTopN(5),
top10: sumTopN(10),
top20: sumTopN(20),
};
}

function calcRisk({ tokenJson, marketJson, conc }) {
const mintRevoked = !!tokenJson?.safety?.mintRevoked;
const freezeRevoked = !!tokenJson?.safety?.freezeRevoked;

const top1 = Number(conc?.top1 || 0);
const top10 = Number(conc?.top10 || 0);

const liq = Number(marketJson?.liquidityUsd || 0);
const fdv = Number(marketJson?.fdv || 0);
const vol = Number(marketJson?.volume24h || 0);

const liqFdvPct = fdv > 0 ? (liq / fdv) * 100 : 0;
const volLiq = liq > 0 ? vol / liq : 0;

let score = 0;

if (!mintRevoked) score += 18;
if (!freezeRevoked) score += 18;

if (fdv > 0 && liq > 0) {
if (liqFdvPct < 1) score += 18;
else if (liqFdvPct < 3) score += 14;
else if (liqFdvPct < 5) score += 10;
else if (liqFdvPct < 10) score += 6;
else score += 3;
} else {
score += 14;
}

if (top1 > 45) score += 16;
else if (top1 > 35) score += 12;
else if (top1 > 25) score += 9;
else if (top1 > 15) score += 5;
else score += 2;

if (top10 > 70) score += 12;
else if (top10 > 55) score += 10;
else if (top10 > 40) score += 6;
else if (top10 > 30) score += 3;
else score += 1;

if (volLiq > 6) score += 6;
else if (volLiq > 3) score += 5;
else if (volLiq > 1.5) score += 3;
else score += 1;

score = Math.max(0, Math.min(100, Math.round(score)));

const label =
score >= 75
? { text: "High Risk", state: "bad" }
: score >= 45
? { text: "Elevated Risk", state: "warn" }
: { text: "Lower Exposure", state: "good" };

const primaryDriver =
!mintRevoked || !freezeRevoked
? "Authority Control"
: liqFdvPct > 0 && liqFdvPct < 3
? "Liquidity Depth"
: top10 >= 55
? "Holder Distribution"
: "Volume Integrity";

const whaleScore = Math.max(
0,
Math.min(100, Math.round((Number(conc?.top10 || 0) / 80) * 100))
);

const signal =
label.state === "bad"
? "High Alert"
: label.state === "warn"
? "Caution"
: "Normal";

return { score, label, primaryDriver, whaleScore, signal, liqFdvPct, volLiq };
}

// ---- Derived MCap fallback ----
function getSupplyUi({ holdersJson, tokenJson }) {
const directCandidates = [
holdersJson?.totalSupplyUi,
holdersJson?.supplyUi,
holdersJson?.totalSupply,
tokenJson?.totalSupplyUi,
tokenJson?.supplyUi,
tokenJson?.uiSupply,
];

for (const c of directCandidates) {
const v = Number(c);
if (Number.isFinite(v) && v > 0) return v;
}

const raw = Number(tokenJson?.supply);
const dec = Number(tokenJson?.decimals);
if (Number.isFinite(raw) && raw > 0 && Number.isFinite(dec) && dec >= 0 && dec <= 18) {
if (raw > 1e10) return raw / Math.pow(10, dec);
return raw;
}

return 0;
}

function deriveMcapUsd({ marketJson, holdersJson, tokenJson }) {
const price = Number(marketJson?.priceUsd || 0);
if (!(price > 0)) return 0;

const supplyUi = getSupplyUi({ holdersJson, tokenJson });
if (!(supplyUi > 0)) return 0;

return price * supplyUi;
}

// ---- Price Change UI ----
function normalizePriceChange(marketJson) {
const pc = marketJson?.priceChange || {};
return {
h1: pc.h1 ?? null,
h24: pc.h24 ?? null,
d7: pc.d7 ?? pc.h168 ?? null,
m30: pc.m30 ?? pc.d30 ?? null,
};
}

function renderPriceChange(marketJson) {
const pc = normalizePriceChange(marketJson);

const setPc = (id, val) => {
const el = $(id);
if (!el) return;

el.classList.remove("up", "down", "flat");

if (val == null || Number.isNaN(Number(val))) {
el.textContent = "—";
el.classList.add("flat");
return;
}

const v = Number(val);
el.textContent = fmtSignedPct(v, 2);

if (v > 0) el.classList.add("up");
else if (v < 0) el.classList.add("down");
else el.classList.add("flat");
};

setPc("pc1h", pc.h1);
setPc("pc1d", pc.h24);
setPc("pc1w", pc.d7);
setPc("pc1m", pc.m30);

setVisible("chip1w", hasNumber(pc.d7));
setVisible("chip1m", hasNumber(pc.m30));
}

// ---- Render ----
function renderMarket(marketJson, derivedMcapUsd = 0) {
if (!marketJson?.found) {
setText("priceUsd", "$—");
setText("pricePair", "Pair: —");
setText("liqUsd", "$—");
setText("liqMeta", "Vol 24h: —");
setText("fdvUsd", "$—");
setText("mcapUsd", derivedMcapUsd > 0 ? `MCap: ${fmtUsd(derivedMcapUsd)}` : "MCap: —");
setText("dexName", "—");
setText("pairName", "—");
renderPriceChange({ priceChange: {} });
return;
}

setText(
"priceUsd",
marketJson?.priceUsd != null ? `$${Number(marketJson.priceUsd).toFixed(6)}` : "$—"
);

const pairShort = marketJson?.pair ? shortAddr(String(marketJson.pair), 4, 4) : "—";
const base = marketJson?.baseSymbol || "—";
const quote = marketJson?.quoteSymbol || "—";
setText("pricePair", marketJson?.pair ? `Pair: ${base}/${quote} (${pairShort})` : "Pair: —");

setText("liqUsd", fmtUsd(marketJson?.liquidityUsd));
setText("liqMeta", `Vol 24h: ${fmtUsd(marketJson?.volume24h)}`);
setText("fdvUsd", fmtUsd(marketJson?.fdv));

const apiMcap = Number(marketJson?.mcapUsd || 0);
const mcap = apiMcap > 0 ? apiMcap : derivedMcapUsd;
setText("mcapUsd", mcap > 0 ? `MCap: ${fmtUsd(mcap)}` : "MCap: —");

setText("dexName", marketJson?.dex || "—");
setText("pairName", marketJson?.pair ? pairShort : "—");

renderPriceChange(marketJson);
}

function renderTokenAuthorities(tokenJson) {
const mintAuthority = tokenJson?.mintAuthority
? shortAddr(tokenJson.mintAuthority, 6, 6)
: "Revoked/None";
const freezeAuthority = tokenJson?.freezeAuthority
? shortAddr(tokenJson.freezeAuthority, 6, 6)
: "Revoked/None";

setText("mintAuthority", mintAuthority);
setText("freezeAuthority", freezeAuthority);
setText("tokenProgram", tokenJson?.program || "SPL Token");
setText("rpcLabel", "RPC: hidden");
}

function renderHolders(holdersJson, topN = 20) {
const holders = Array.isArray(holdersJson?.holders) ? holdersJson.holders : [];
setText("holdersCount", holders.length ? String(holders.length) : "—");

const tbody = $("holdersTable");
if (tbody) {
tbody.innerHTML = "";
const shown = holders.slice(0, topN);

if (!shown.length) {
tbody.innerHTML = `
<tr>
<td class="muted">—</td>
<td class="muted">No data yet</td>
<td class="muted right">—</td>
<td class="muted right">—</td>
</tr>`;
} else {
for (const h of shown) {
const wallet = h.owner || h.tokenAccount;
const uiAmt = h.uiAmount != null ? fmtNum(Number(h.uiAmount)) : "—";
const pctSupply = h.pctSupply != null ? fmtPct(h.pctSupply) : "—";

const tr = document.createElement("tr");
tr.innerHTML = `
<td class="mono">${h.rank ?? ""}</td>
<td class="mono" title="${wallet}">${shortAddr(wallet, 6, 6)}</td>
<td class="right mono">${uiAmt}</td>
<td class="right mono">${pctSupply}</td>`;
tbody.appendChild(tr);
}
}
}

if (holders.length) {
const conc = computeConcentration(holders);
setText("top1", fmtPct(conc.top1));
setText("top5", fmtPct(conc.top5));
setText("top10", fmtPct(conc.top10));
setText("top20", fmtPct(conc.top20));
setText("holdersLoaded", `Loaded: top ${Math.min(topN, holders.length)}`);
return conc;
}

setText("top1", "—");
setText("top5", "—");
setText("top10", "—");
setText("top20", "—");
setText("holdersLoaded", "—");
return { top1: 0, top5: 0, top10: 0, top20: 0 };
}

function renderClusters(activity) {
setText("clusterScore", `${activity.sybilScore0to100}`);
setText("clusterLabel", activity.signalText);
setText("sybilScore", `${activity.sybilScore0to100} /100`);
setText("clustersCount", String(activity.clustersCount));
setText("whaleFlow1h", activity.whaleFlow1hPct == null ? "—" : fmtPct(activity.whaleFlow1hPct, 3));
setText("whaleFlow24h", activity.whaleFlow24hPct == null ? "—" : fmtPct(activity.whaleFlow24hPct, 3));

const body = $("clusterTableBody");
if (body) {
body.innerHTML = "";
if (!activity.clusters.length) {
body.innerHTML = `
<tr>
<td class="muted">—</td>
<td class="muted">—</td>
<td class="muted">—</td>
<td class="muted">No strong cluster evidence detected in this snapshot.</td>
</tr>`;
} else {
for (const c of activity.clusters) {
const tr = document.createElement("tr");
tr.innerHTML = `
<td class="mono">${c.id}</td>
<td class="mono">${c.wallets}</td>
<td class="mono">${c.score}</td>
<td>${c.evidence}</td>`;
body.appendChild(tr);
}
}
}

setText(
"clusterMeta",
`Confidence: ${activity.meta.confidence} • Analyzed: ${activity.meta.analyzedWallets} • Parsed tx: ${activity.meta.parsedTx}`
);
}

function renderRaw(obj) {
const pre = $("rawJson");
if (!pre) return;
pre.textContent = JSON.stringify(obj, null, 2);
}

function buildNotes({ tokenJson, marketJson, conc, activity, rm }) {
const notes = [];

if (!tokenJson?.safety?.mintRevoked || !tokenJson?.safety?.freezeRevoked) {
notes.push("Authority controls are present (mint and/or freeze).");
} else {
notes.push("Mint & freeze authority appear revoked.");
}

if (Number(conc?.top1 || 0) > 35) notes.push("Top1 concentration is high — watch for control risk.");
if (Number(conc?.top10 || 0) > 55) notes.push("Top10 concentration suggests whale dominance.");

if (marketJson?.found && Number(marketJson?.liquidityUsd || 0) > 0 && Number(marketJson?.fdv || 0) > 0) {
const liqFdv = (Number(marketJson.liquidityUsd) / Number(marketJson.fdv)) * 100;
if (liqFdv < 3) notes.push("Liquidity depth is thin relative to valuation.");
}

if (activity?.sybilScore0to100 >= 40) notes.push("Distribution shows structuring/coordinated patterns (best-effort).");

notes.push(`Primary driver: ${rm.primaryDriver}.`);

return notes.join(" ");
}

async function bestEffortRecordRisk({ mint, rm, conc, marketJson }) {
try {
await apiPost("/api/sol/risk-record", {
mint,
risk: rm.score,
whale: rm.whaleScore,
top10: Number(conc?.top10 || 0),
liqUsd: Number(marketJson?.liquidityUsd || 0),
fdvUsd: Number(marketJson?.fdv || 0),
});
} catch {
// silent
}
}

async function runScan(mint) {
setBadge(null, "scanDot", "scanStatusText", "warn", "Scanning…");
setText("scanMetaText", `mint: ${mint.slice(0, 4)}…${mint.slice(-4)}`);

try {
const [tokenJson, marketJson, holdersJson] = await Promise.all([
apiGet(`/api/sol/token/${mint}`),
apiGet(`/api/sol/market/${mint}`),
apiGet(`/api/sol/holders/${mint}`),
]);

renderTokenAuthorities(tokenJson);

const holdersSelect = $("holdersSelect");
const topN = holdersSelect ? Number(holdersSelect.value || 20) : 20;
const conc = renderHolders(holdersJson, topN);

const activity = buildActivityFromHolders(holdersJson);
renderClusters(activity);

const rm = calcRisk({ tokenJson, marketJson, conc });

const derivedMcapUsd = deriveMcapUsd({ marketJson, holdersJson, tokenJson });
renderMarket(marketJson, derivedMcapUsd);

setText("riskScore", `${rm.score}`);
setText("whaleScore", `${rm.whaleScore}`);
setText("riskSignal", rm.signal);
setBadge("riskBadge", "riskDot", "riskText", rm.label.state, rm.label.text);

setText("notesText", buildNotes({ tokenJson, marketJson, conc, activity, rm }));

const scanObj = {
mint,
token: tokenJson,
market: marketJson,
holders: holdersJson,
derived: { concentration: conc, activity, riskModel: rm, derivedMcapUsd },
};

window.__MSS_LAST_SCAN__ = scanObj;
renderRaw(scanObj);

try {
const url = new URL(window.location.href);
url.searchParams.set("mint", mint);
window.history.replaceState({}, "", url.toString());
} catch {
// ignore
}

setText("apiMeta", `API: ${getApiBase()}`);
setBadge(null, "scanDot", "scanStatusText", "good", "Scan complete");

bestEffortRecordRisk({ mint, rm, conc, marketJson });
} catch (e) {
renderRaw({ mint, error: e?.message || String(e) });
setBadge(null, "scanDot", "scanStatusText", "bad", "Scan error");
renderPriceChange({ priceChange: {} });
}
}

function init() {
const tokenInput = $("tokenInput");
const scanBtn = $("scanBtn");
const demoBtn = $("demoBtn");

if (!tokenInput || !scanBtn) return;

const holdersSelect = $("holdersSelect");
if (holdersSelect) {
holdersSelect.addEventListener("change", () => {
const last = window.__MSS_LAST_SCAN__;
if (!last?.holders || !last?.token || !last?.market) return;

const topN = Number(holdersSelect.value || 20);
const conc = renderHolders(last.holders, topN);

const rm = calcRisk({ tokenJson: last.token, marketJson: last.market, conc });
setText("riskScore", `${rm.score}`);
setText("whaleScore", `${rm.whaleScore}`);
setText("riskSignal", rm.signal);
setBadge("riskBadge", "riskDot", "riskText", rm.label.state, rm.label.text);

const notes = buildNotes({
tokenJson: last.token,
marketJson: last.market,
conc,
activity: last.derived?.activity,
rm,
});
setText("notesText", notes);

last.derived = last.derived || {};
last.derived.concentration = conc;
last.derived.riskModel = rm;
window.__MSS_LAST_SCAN__ = last;
renderRaw(last);
});
}

scanBtn.addEventListener("click", () => {
const mint = (tokenInput.value || "").trim();
if (!mint) return;
runScan(mint);
});

tokenInput.addEventListener("keydown", (e) => {
if (e.key === "Enter") {
e.preventDefault();
scanBtn.click();
}
});

if (demoBtn) {
demoBtn.addEventListener("click", () => {
tokenInput.value = SAMPLE_MINT;
scanBtn.click();
});
}

const saveShareBtn = $("saveShareBtn");
if (saveShareBtn) {
saveShareBtn.addEventListener("click", async () => {
const scanObj = window.__MSS_LAST_SCAN__;
if (!scanObj) {
alert("Scan a token first.");
return;
}
try {
await downloadShareCardPNG(scanObj);
} catch (err) {
alert(err?.message || "Failed to generate share card.");
}
});
}

const shareXBtn = $("shareXBtn");
if (shareXBtn) {
shareXBtn.addEventListener("click", async () => {
const scanObj = window.__MSS_LAST_SCAN__;
if (!scanObj?.mint) {
alert("Scan a token first.");
return;
}

try {
await downloadShareCardPNG(scanObj);
} catch (err) {
alert(err?.message || "Failed to generate share card.");
return;
}

const scanUrl = `${window.location.origin}/token.html?mint=${encodeURIComponent(scanObj.mint)}`;

const info = getTokenDisplay(scanObj);
const tokenLine = info.symbol
? `$${info.symbol}`
: (info.name || `Mint ${scanObj.mint.slice(0, 4)}…${scanObj.mint.slice(-4)}`);

const text =
`MSS Protocol Security Scan\n` +
`${tokenLine}\n` +
`Risk: ${info.riskText}\n` +
`Full scan:`;

const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
text
)}&url=${encodeURIComponent(scanUrl)}`;

window.open(intent, "_blank", "noopener,noreferrer");
});
}

const enableAlertsBtn = $("enableAlertsBtn");
const alertStatus = $("alertStatus");

if (enableAlertsBtn && alertStatus) {
enableAlertsBtn.addEventListener("click", async () => {
const mint = (tokenInput.value || "").trim();
if (!mint) {
alertStatus.textContent = "Scan a token first.";
return;
}

const jwt = localStorage.getItem("mssToken");
if (!jwt) {
alertStatus.textContent = "Login required to enable alerts.";
return;
}

try {
alertStatus.textContent = "Saving alert…";

const data = await apiPost(
"/api/alerts",
{ mint, type: "risk_spike", direction: "above", threshold: 70 },
jwt
);

if (data?.error) {
alertStatus.textContent = data.error;
return;
}

alertStatus.textContent = "Alerts enabled for this token.";
} catch (err) {
alertStatus.textContent = err?.message || "Failed to save alert.";
}
});
}

setBadge(null, "netDot", "netText", "good", "Online");
setBadge(null, "scanDot", "scanStatusText", null, "Ready");
setText("apiMeta", `API: ${getApiBase()}`);

const params = new URLSearchParams(window.location.search);
const qMint = params.get("mint");
if (qMint) {
tokenInput.value = qMint;
runScan(qMint);
}
}

if (document.readyState === "loading") {
document.addEventListener("DOMContentLoaded", init);
} else {
init();
}
})();