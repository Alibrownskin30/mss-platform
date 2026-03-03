import { apiGet, apiPost, getApiBase } from "./api.js";
import { buildActivityFromHolders } from "./activity.js";

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
// 0..100 (higher = riskier)
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

// Authority control
if (!mintRevoked) score += 18;
if (!freezeRevoked) score += 18;

// Liquidity depth
if (fdv > 0 && liq > 0) {
if (liqFdvPct < 1) score += 18;
else if (liqFdvPct < 3) score += 14;
else if (liqFdvPct < 5) score += 10;
else if (liqFdvPct < 10) score += 6;
else score += 3;
} else {
score += 14;
}

// Holder distribution
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

// Volume/liquidity churn
if (volLiq > 6) score += 6;
else if (volLiq > 3) score += 5;
else if (volLiq > 1.5) score += 3;
else score += 1;

score = Math.max(0, Math.min(100, Math.round(score)));

const label =
score >= 75
? { text: "High Risk", state: "bad" }
: score >= 45
? { text: "Moderate Risk", state: "warn" }
: { text: "Lower Risk", state: "good" };

const primaryDriver =
!mintRevoked || !freezeRevoked
? "Authority Control"
: liqFdvPct > 0 && liqFdvPct < 3
? "Liquidity Depth"
: top10 >= 55
? "Holder Distribution"
: "Volume Integrity";

const whaleScore = Math.max(0, Math.min(100, Math.round((Number(conc?.top10 || 0) / 80) * 100)));

const signal = label.state === "bad" ? "High Alert" : label.state === "warn" ? "Caution" : "Normal";

return { score, label, primaryDriver, whaleScore, signal };
}

function renderMarket(marketJson) {
if (!marketJson?.found) {
setText("priceUsd", "$—");
setText("pricePair", "Pair: —");
setText("liqUsd", "$—");
setText("liqMeta", "Vol 24h: —");
setText("fdvUsd", "$—");
setText("mcapUsd", "MCap: —");
setText("dexName", "—");
setText("pairName", "—");
return;
}

setText("priceUsd", marketJson?.priceUsd != null ? `$${Number(marketJson.priceUsd).toFixed(6)}` : "$—");

const pairShort = marketJson?.pair ? shortAddr(String(marketJson.pair), 4, 4) : "—";
const base = marketJson?.baseSymbol || "—";
const quote = marketJson?.quoteSymbol || "—";
setText("pricePair", marketJson?.pair ? `Pair: ${base}/${quote} (${pairShort})` : "Pair: —");

setText("liqUsd", fmtUsd(marketJson?.liquidityUsd));
setText("liqMeta", `Vol 24h: ${fmtUsd(marketJson?.volume24h)}`);

setText("fdvUsd", fmtUsd(marketJson?.fdv));
setText("mcapUsd", marketJson?.mcapUsd ? `MCap: ${fmtUsd(marketJson.mcapUsd)}` : "MCap: —");

setText("dexName", marketJson?.dex || "—");
setText("pairName", marketJson?.pair ? pairShort : "—");
}

function renderTokenAuthorities(tokenJson) {
const mintAuthority = tokenJson?.mintAuthority ? shortAddr(tokenJson.mintAuthority, 6, 6) : "Revoked/None";
const freezeAuthority = tokenJson?.freezeAuthority ? shortAddr(tokenJson.freezeAuthority, 6, 6) : "Revoked/None";

setText("mintAuthority", mintAuthority);
setText("freezeAuthority", freezeAuthority);
setText("tokenProgram", "SPL Token");
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
<td class="right mono">${pctSupply}</td>
`;
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
// chips
setText("clusterScore", `${activity.sybilScore0to100}`);
setText("clusterLabel", activity.signalText);
setText("sybilScore", `${activity.sybilScore0to100} /100`);
setText("clustersCount", String(activity.clustersCount));
setText("whaleFlow1h", activity.whaleFlow1hPct == null ? "—" : fmtPct(activity.whaleFlow1hPct, 3));
setText("whaleFlow24h", activity.whaleFlow24hPct == null ? "—" : fmtPct(activity.whaleFlow24hPct, 3));

// Evidence table
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
<td>${c.evidence}</td>
`;
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
renderMarket(marketJson);

const holdersSelect = $("holdersSelect");
const topN = holdersSelect ? Number(holdersSelect.value || 20) : 20;

const conc = renderHolders(holdersJson, topN);

const activity = buildActivityFromHolders(holdersJson);
renderClusters(activity);

const rm = calcRisk({ tokenJson, marketJson, conc });
setText("riskScore", `${rm.score}`); // HTML already shows /100
setText("whaleScore", `${rm.whaleScore}`); // HTML already shows /100
setText("riskSignal", rm.signal);
setBadge("riskBadge", "riskDot", "riskText", rm.label.state, rm.label.text);

setText("notesText", buildNotes({ tokenJson, marketJson, conc, activity, rm }));

renderRaw({
mint,
token: tokenJson,
market: marketJson,
holders: holdersJson,
derived: { concentration: conc, activity, riskModel: rm },
});

setText("apiMeta", `API: ${getApiBase()}`);
setBadge(null, "scanDot", "scanStatusText", "good", "Scan complete");
} catch (e) {
renderRaw({ mint, error: e?.message || String(e) });
setBadge(null, "scanDot", "scanStatusText", "bad", "Scan error");
}
}

function init() {
const tokenInput = $("tokenInput");
const scanBtn = $("scanBtn");
const demoBtn = $("demoBtn");

if (!tokenInput || !scanBtn) return;

// holders dropdown
const holdersSelect = $("holdersSelect");
if (holdersSelect) {
holdersSelect.addEventListener("change", () => {
const mint = (tokenInput.value || "").trim();
if (mint) runScan(mint);
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

// Alerts (requires token)
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
const data = await apiPost("/api/alerts", { mint, type: "risk", direction: "up", threshold: 1 }, { token: jwt });
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

// initial
setBadge(null, "netDot", "netText", "good", "Online");
setBadge(null, "scanDot", "scanStatusText", null, "Ready");
setText("apiMeta", `API: ${getApiBase()}`);

// auto-scan ?mint=
const params = new URLSearchParams(window.location.search);
const qMint = params.get("mint");
if (qMint) {
tokenInput.value = qMint;
runScan(qMint);
}
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
})();
