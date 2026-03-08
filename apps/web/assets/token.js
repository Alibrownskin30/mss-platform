import { apiGet, apiPost, getApiBase } from "./api.js";
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

const fmtSigned = (n, dp = 1) => {
if (n == null || Number.isNaN(Number(n))) return "—";
const v = Number(n);
const sign = v > 0 ? "+" : "";
return `${sign}${v.toFixed(dp)}`;
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

function setHtml(id, v) {
const el = $(id);
if (el) el.innerHTML = v;
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

function pctBand(score) {
if (score >= 75) return { label: "High", state: "bad" };
if (score >= 45) return { label: "Moderate", state: "warn" };
return { label: "Low", state: "good" };
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
market?.baseName ||
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
symbol: String(symbol || "").trim().toUpperCase(),
riskText: String(riskText || "—").trim(),
};
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

function renderClusters(activity, rm) {
const hidden = rm?.hiddenControl || {};
const score = Number(hidden?.score ?? activity?.score ?? 0);
const label = hidden?.label || activity?.label || "—";

setText("clusterScore", hasNumber(score) ? `${score}` : "—");
setText("clusterLabel", label || "—");
setText("sybilScore", hasNumber(score) ? `${score} /100` : "—");
setText("clustersCount", String(activity?.clusterCount ?? activity?.clusters?.length ?? 0));
setText(
"whaleFlow1h",
rm?.whaleActivity?.syncBurstSize == null ? "—" : String(rm.whaleActivity.syncBurstSize)
);
setText("whaleFlow24h", hidden?.linkedWallets == null ? "—" : String(hidden.linkedWallets));

const body = $("clusterTableBody");
if (body) {
body.innerHTML = "";
const rows = Array.isArray(activity?.clusters) ? activity.clusters : [];

if (!rows.length) {
body.innerHTML = `
<tr>
<td class="muted">—</td>
<td class="muted">—</td>
<td class="muted">—</td>
<td class="muted">No strong cluster evidence detected in this snapshot.</td>
</tr>`;
} else {
for (let i = 0; i < rows.length; i++) {
const c = rows[i];
const evidence = [];
if (c?.payer) evidence.push(`Shared payer ${shortAddr(c.payer, 5, 5)}`);
if (c?.size) evidence.push(`${c.size} linked wallets`);
if (Array.isArray(c?.members) && c.members.length) evidence.push("Linked holder group");

const tr = document.createElement("tr");
tr.innerHTML = `
<td class="mono">${c.id || `C${i + 1}`}</td>
<td class="mono">${c.size ?? c.walletCount ?? "—"}</td>
<td class="mono">${c.score ?? "—"}</td>
<td>${evidence.join(" • ") || "Linked wallet pattern detected."}</td>`;
body.appendChild(tr);
}
}
}

setText(
"clusterMeta",
`Analyzed: ${activity?.analyzedWallets ?? "—"} • Linked wallets: ${
hidden?.linkedWallets ?? activity?.clusteredWallets ?? "—"
} • Fresh wallets: ${fmtPct(rm?.freshWalletRisk?.pct ?? activity?.newWalletPct ?? null, 1)}`
);
}

function renderWalletNetwork(scanObj) {
const activity = scanObj?.derived?.activity || {};
const rm = scanObj?.derived?.riskModel || {};
const conc = scanObj?.derived?.concentration || {};
const holders = Array.isArray(scanObj?.holders?.holders) ? scanObj.holders.holders : [];

const hidden = rm?.hiddenControl || {};
const devNet = rm?.developerNetwork || rm?.developerActivity || {};
const walletNet = rm?.walletNetwork || activity?.walletNetwork || {};
const clusters = Array.isArray(activity?.clusters) ? activity.clusters : [];

const primaryCluster =
clusters.find((c) => c?.id === walletNet?.primaryClusterId) ||
clusters[0] ||
null;

const primaryMembers = Array.isArray(primaryCluster?.members) ? primaryCluster.members : [];
const primaryWallet = walletNet?.primaryWallet || primaryCluster?.payer || primaryMembers[0] || null;

let holderControlledPct = 0;
if (primaryMembers.length && holders.length) {
const memberSet = new Set(primaryMembers);
holderControlledPct = holders
.filter((h) => h?.owner && memberSet.has(h.owner))
.reduce((sum, h) => sum + Number(h?.pctSupply || 0), 0);
}

const likelyControlPct =
Number(walletNet?.controlEstimatePct || 0) ||
Number(devNet?.likelyControlPct || 0) ||
Number(hidden?.linkedWalletPct || 0) ||
Number(holderControlledPct || 0) ||
Number(conc?.top10 || 0);

const linkedWallets =
Number(walletNet?.linkedWallets || 0) ||
Number(devNet?.linkedWallets || 0) ||
Number(hidden?.linkedWallets || 0) ||
Number(activity?.clusteredWallets || 0) ||
primaryMembers.length;

const confidenceScore =
Number(walletNet?.confidence || 0) ||
Number(devNet?.confidence || 0) ||
Number(primaryCluster?.score || 0) ||
Number(hidden?.score || 0) ||
Number(activity?.score || 0) ||
0;

const confidenceLabel =
walletNet?.confidenceLabel ||
(confidenceScore >= 75 ? "High" : confidenceScore >= 45 ? "Moderate" : "Low");

const role =
walletNet?.role ||
(devNet?.detected && confidenceScore >= 75
? "Likely operator"
: devNet?.detected
? "Probable linked wallet"
: primaryCluster?.payer
? "Shared payer / controller"
: primaryMembers.length >= 2
? "Lead linked wallet"
: "Observed wallet");

setText("netPrimary", primaryWallet ? shortAddr(primaryWallet, 6, 6) : "—");
setText("netCluster", walletNet?.primaryClusterId || primaryCluster?.id || "—");
setText("netRole", role);
setText("netLinkedCount", linkedWallets > 0 ? `${linkedWallets} Wallets` : "—");
setText("netLinked", linkedWallets > 0 ? String(linkedWallets) : "—");
setText(
"netFunding",
walletNet?.sharedFundingDetected || hidden?.sharedFundingDetected ? "Detected" : "Not detected"
);
setText("netControlPct", likelyControlPct > 0 ? fmtPct(likelyControlPct, 1) : "—");
setText("netConfidence", confidenceScore > 0 ? `${confidenceLabel} (${confidenceScore}%)` : "—");
}

function renderWalletGraph(scanObj) {
const root = $("walletGraph");
if (!root) return;

const activity = scanObj?.derived?.activity || {};
const rm = scanObj?.derived?.riskModel || {};
const walletNet = rm?.walletNetwork || activity?.walletNetwork || {};
const clusters = Array.isArray(activity?.clusters) ? activity.clusters : [];

const primaryCluster =
clusters.find((c) => c?.id === walletNet?.primaryClusterId) ||
clusters[0] ||
null;

const primaryWallet =
walletNet?.primaryWallet ||
primaryCluster?.payer ||
primaryCluster?.members?.[0] ||
null;

const role = walletNet?.role || "Observed wallet";
const confidence = Number(walletNet?.confidence || 0);
const confidenceLabel =
walletNet?.confidenceLabel ||
(confidence >= 75 ? "High" : confidence >= 45 ? "Moderate" : "Low");

if (!primaryWallet) {
root.innerHTML = `
<div class="wallet-graph-center">
<div class="title">Primary Wallet</div>
<div class="value">No graph yet</div>
<div class="meta">Scan a token to render the wallet control map.</div>
</div>`;
return;
}

const primaryMembers = Array.isArray(primaryCluster?.members) ? primaryCluster.members : [];

const memberCards = primaryMembers.slice(0, 8).map((wallet, i) => {
const isPrimary = wallet === primaryWallet;

return `
<div class="wallet-node">
<div class="node-top">
<div class="node-id">${isPrimary ? "Primary" : `Linked ${i + 1}`}</div>
<div class="node-score">${confidence || "—"}%</div>
</div>
<div class="node-wallet mono">${shortAddr(wallet, 6, 6)}</div>
<div class="node-sub">${isPrimary ? role : "Linked wallet in primary cluster"}</div>
</div>`;
}).join("");

const fallbackClusterCards = clusters.slice(0, 6).map((c) => {
const memberCount = Array.isArray(c?.members) ? c.members.length : Number(c?.size || 0);
const walletLabel = c?.payer ? shortAddr(c.payer, 6, 6) : "No payer";
const score = Number(c?.score || 0);
const sub = c?.id === (walletNet?.primaryClusterId || primaryCluster?.id)
? `${memberCount} wallets • primary linked cluster`
: `${memberCount} wallets • linked cluster`;

return `
<div class="wallet-node">
<div class="node-top">
<div class="node-id">${c?.id || "Cluster"}</div>
<div class="node-score">${score}/100</div>
</div>
<div class="node-wallet mono">${walletLabel}</div>
<div class="node-sub">${sub}</div>
</div>`;
}).join("");

root.innerHTML = `
<div class="wallet-graph-center">
<div class="title">Primary Wallet</div>
<div class="value mono">${shortAddr(primaryWallet, 6, 6)}</div>
<div class="meta">${role} • ${confidenceLabel} confidence ${confidence ? `(${confidence}%)` : ""}</div>
</div>
<div class="wallet-graph-links">
${memberCards || fallbackClusterCards || `
<div class="wallet-node">
<div class="node-top">
<div class="node-id">Cluster</div>
<div class="node-score">—</div>
</div>
<div class="node-wallet">No linked clusters</div>
<div class="node-sub">No graphable wallet structure in this snapshot.</div>
</div>`}
</div>`;
}

function renderRiskMeter(rm) {
const fill = $("riskMeterFill");
const score = Number(rm?.score ?? 0);
const state = rm?.label?.state || "warn";

if (fill) {
fill.style.width = `${Math.max(0, Math.min(100, score))}%`;
fill.classList.remove("good", "warn", "bad");
fill.classList.add(state);
}

setText("riskTrendLabel", rm?.trend?.label || "—");
setText("riskTrendMomentum", rm?.trend?.momentum || "—");
setText("riskTrend1h", fmtSigned(rm?.trend?.delta1h, 1));
setText("riskTrend24h", fmtSigned(rm?.trend?.delta24h, 1));
setText("reputationLabel", rm?.reputation?.label || "—");
setText("reputationScore", rm?.reputation?.score != null ? `${rm.reputation.score}/100` : "—");

setText("riskTrendLabel2", rm?.trend?.label || "—");
setText("reputationLabel2", rm?.reputation?.label || "—");
setText("reputationScore2", rm?.reputation?.score != null ? `${rm.reputation.score}/100` : "—");
}

function renderPhase2Signals(rm) {
setText("hiddenControlLabel", rm?.hiddenControl?.label || "—");
setText(
"hiddenControlScore",
rm?.hiddenControl?.score != null ? `${rm.hiddenControl.score}/100` : "—"
);
setText(
"hiddenControlLinked",
rm?.hiddenControl?.linkedWallets != null ? String(rm.hiddenControl.linkedWallets) : "—"
);
setText(
"hiddenControlSupply",
rm?.hiddenControl?.linkedWalletPct != null ? fmtPct(rm.hiddenControl.linkedWalletPct, 1) : "—"
);
setText("sharedFunding", rm?.hiddenControl?.sharedFundingDetected ? "Detected" : "Not detected");

const dev = rm?.developerNetwork || rm?.developerActivity || {};
const devLabel = dev?.label || "—";
const devDetected =
typeof dev?.detected === "boolean"
? dev.detected
: Number(dev?.confidence || 0) >= 35;

const devWallets =
dev?.linkedWallets != null
? String(dev.linkedWallets)
: rm?.developerActivity?.linkedWallets != null
? String(rm.developerActivity.linkedWallets)
: "—";

let devDetectedText = "No";
if (devDetected) {
if (dev?.confidence != null) devDetectedText = `Yes • ${dev.confidence}%`;
else devDetectedText = "Yes";
}

setText("devActivityLabel", devLabel);
setText("devActivityDetected", devDetectedText);
setText("devActivityWallets", devWallets);

setText("freshWalletLabel", rm?.freshWalletRisk?.label || "—");
setText(
"freshWalletCount",
rm?.freshWalletRisk?.walletCount != null ? String(rm.freshWalletRisk.walletCount) : "—"
);
setText("freshWalletPct", rm?.freshWalletRisk?.pct != null ? fmtPct(rm.freshWalletRisk.pct, 1) : "—");

setText("liqStabilityLabel", rm?.liquidityStability?.label || "—");
setText(
"liqStabilityScore",
rm?.liquidityStability?.score != null ? `${rm.liquidityStability.score}/100` : "—"
);
setText(
"liqFdvPct",
rm?.liquidityStability?.liqFdvPct != null ? fmtPct(rm.liquidityStability.liqFdvPct, 2) : "—"
);
setText("liqRemovable", rm?.liquidityStability?.removableRisk || "—");

setText("whaleActivityLabel", rm?.whaleActivity?.label || "—");
setText(
"whaleActivityScore",
rm?.whaleActivity?.score != null ? `${rm.whaleActivity.score}/100` : "—"
);
setText("whalePressure", rm?.whaleActivity?.pressure || "—");
setText(
"whaleSync",
rm?.whaleActivity?.syncBurstSize != null ? String(rm.whaleActivity.syncBurstSize) : "—"
);
}

function renderTrendChart(trend) {
const svg = $("riskTrendChart");
if (!svg) return;

const latest = Number(trend?.latest?.risk);
const d1 = Number(trend?.change?.["1h"]);
const d6 = Number(trend?.change?.["6h"]);
const d24 = Number(trend?.change?.["24h"]);

const points = [
Number.isFinite(latest - d24) ? latest - d24 : null,
Number.isFinite(latest - d6) ? latest - d6 : null,
Number.isFinite(latest - d1) ? latest - d1 : null,
Number.isFinite(latest) ? latest : null,
].filter((v) => Number.isFinite(v));

if (!points.length) {
svg.innerHTML = "";
return;
}

const width = 100;
const height = 36;
const min = Math.min(...points, 0);
const max = Math.max(...points, 100);
const range = Math.max(1, max - min);

const coords = points
.map((v, i) => {
const x = (i / Math.max(1, points.length - 1)) * width;
const y = height - ((v - min) / range) * height;
return `${x},${y}`;
})
.join(" ");

svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
svg.innerHTML = `
<polyline
fill="none"
stroke="rgba(0,255,209,0.95)"
stroke-width="2.5"
points="${coords}"
/>`;
}

function renderRaw(obj) {
const pre = $("rawJson");
if (!pre) return;
pre.textContent = JSON.stringify(obj, null, 2);
}

function buildNotes({ tokenJson, marketJson, conc, activity, rm }) {
const notes = [];
const devNet = rm?.developerNetwork || rm?.developerActivity || {};
const devConfidence = Number(devNet?.confidence || 0);
const walletNet = rm?.walletNetwork || activity?.walletNetwork || {};

if (!tokenJson?.safety?.mintRevoked || !tokenJson?.safety?.freezeRevoked) {
notes.push("Authority controls are present (mint and/or freeze).");
} else {
notes.push("Mint & freeze authority appear revoked.");
}

if (Number(conc?.top1 || 0) > 35) notes.push("Top1 concentration is high — watch for control risk.");
if (Number(conc?.top10 || 0) > 55) notes.push("Top10 concentration suggests whale dominance.");

if (
marketJson?.found &&
Number(marketJson?.liquidityUsd || 0) > 0 &&
Number(marketJson?.fdv || 0) > 0
) {
const liqFdv = (Number(marketJson.liquidityUsd) / Number(marketJson.fdv)) * 100;
if (liqFdv < 3) notes.push("Liquidity depth is thin relative to valuation.");
}

if (Number(rm?.hiddenControl?.score || 0) >= 45) {
notes.push("Linked wallet behavior suggests hidden control or coordinated structure.");
}

if (Number(rm?.freshWalletRisk?.pct || 0) >= 20) {
notes.push("Fresh-wallet concentration is elevated.");
}

if (devNet?.detected || devConfidence >= 35) {
const devLabel = devNet?.label || "Developer-linked network";
if (devNet?.likelyControlPct != null && Number(devNet.likelyControlPct) > 0) {
notes.push(`${devLabel} detected with likely coordinated control around ${fmtPct(devNet.likelyControlPct, 1)}.`);
} else {
notes.push(`${devLabel} detected in current wallet structure.`);
}
}

if (Number(walletNet?.confidence || 0) >= 45) {
const controlPct = Number(walletNet?.controlEstimatePct || 0);
notes.push(
controlPct > 0
? `Wallet network control confidence is elevated with estimated influence around ${fmtPct(controlPct, 1)}.`
: "Wallet network control confidence is elevated."
);
}

if (rm?.liquidityStability?.state === "bad") {
notes.push("Liquidity stability appears weak.");
}

if (rm?.trend?.label === "Escalating" || rm?.trend?.momentum === "Escalating") {
notes.push("Risk trend is increasing versus prior snapshots.");
}

if (!notes.length && Number(activity?.score || 0) >= 40) {
notes.push("Distribution shows structuring/coordinated patterns (best-effort).");
}

notes.push(`Primary driver: ${rm?.primaryDriver || "—"}.`);

return notes.join(" ");
}

function cassieToneByState(state) {
if (state === "good") return "good";
if (state === "bad") return "bad";
return "warn";
}

function renderCassieList(id, items) {
const el = $(id);
if (!el) return;

if (!Array.isArray(items) || !items.length) {
el.innerHTML = `<li class="warn">No output available yet.</li>`;
return;
}

el.innerHTML = items
.map(
(item) => `<li class="${item.tone || "warn"}">${String(item.text || "").trim()}</li>`
)
.join("");
}

function buildCassieModel({ tokenJson, marketJson, conc, activity, rm, trend }) {
const itemsSignals = [];
const itemsSims = [];
const itemsRiskFactors = [];
const itemsRadar = [];

const riskScore = Number(rm?.score || 0);
const whaleScore = Number(rm?.whaleScore || 0);
const top10 = Number(conc?.top10 || 0);
const top1 = Number(conc?.top1 || 0);
const liquidityUsd = Number(marketJson?.liquidityUsd || 0);
const fdvUsd = Number(marketJson?.fdv || 0);
const liqFdvPct = fdvUsd > 0 ? (liquidityUsd / fdvUsd) * 100 : 0;
const hiddenControlScore = Number(rm?.hiddenControl?.score || 0);
const freshPct = Number(rm?.freshWalletRisk?.pct || 0);
const linkedWallets = Number(rm?.hiddenControl?.linkedWallets || 0);
const clusterCount = Number(activity?.clusterCount ?? activity?.clusters?.length ?? 0);
const momentum = rm?.trend?.momentum || trend?.trend?.momentum || "Stable";
const mintRevoked = !!tokenJson?.safety?.mintRevoked;
const freezeRevoked = !!tokenJson?.safety?.freezeRevoked;

const devNet = rm?.developerNetwork || rm?.developerActivity || {};
const walletNet = rm?.walletNetwork || activity?.walletNetwork || {};
const devDetected =
typeof devNet?.detected === "boolean"
? devNet.detected
: Number(devNet?.confidence || 0) >= 35;
const devConfidence = Number(devNet?.confidence || 0);
const devLikelyControlPct = Number(devNet?.likelyControlPct || 0);
const devNotes = Array.isArray(devNet?.notes) ? devNet.notes : [];
const walletNetConfidence = Number(walletNet?.confidence || 0);
const walletNetControlPct = Number(walletNet?.controlEstimatePct || 0);

if (mintRevoked && freezeRevoked) {
itemsSignals.push({ tone: "good", text: "Critical authorities appear revoked." });
} else {
itemsSignals.push({ tone: "bad", text: "Authority controls remain present." });
}

if (top10 >= 55) {
itemsSignals.push({ tone: "bad", text: `Top10 concentration is elevated at ${fmtPct(top10)}.` });
} else if (top10 >= 35) {
itemsSignals.push({ tone: "warn", text: `Top10 concentration is moderate at ${fmtPct(top10)}.` });
} else {
itemsSignals.push({ tone: "good", text: `Top10 concentration is relatively contained at ${fmtPct(top10)}.` });
}

if (hiddenControlScore >= 70) {
itemsSignals.push({ tone: "bad", text: "Cassie sees strong hidden-control structure risk." });
} else if (hiddenControlScore >= 40) {
itemsSignals.push({ tone: "warn", text: "Cassie sees elevated linked-wallet structure risk." });
} else {
itemsSignals.push({ tone: "good", text: "Linked-wallet structure risk is currently low." });
}

if (devDetected) {
if (devConfidence >= 75) {
itemsSignals.push({ tone: "bad", text: "Cassie detects a strong developer-linked wallet network." });
} else if (devConfidence >= 55) {
itemsSignals.push({ tone: "warn", text: "Cassie detects elevated developer-linked wallet coordination." });
} else {
itemsSignals.push({ tone: "warn", text: "Cassie detects weak developer-linkage signals." });
}
} else {
itemsSignals.push({ tone: "good", text: "No strong developer-linked wallet network is dominant in this snapshot." });
}

if (walletNetConfidence >= 75) {
itemsSignals.push({ tone: "bad", text: "Wallet control map shows high-confidence coordinated influence." });
} else if (walletNetConfidence >= 45) {
itemsSignals.push({ tone: "warn", text: "Wallet control map shows moderate coordinated influence." });
} else {
itemsSignals.push({ tone: "good", text: "Wallet control map does not show dominant coordinated influence." });
}

if (momentum === "Escalating" || momentum === "Rising") {
itemsSignals.push({ tone: "bad", text: `Risk momentum is ${momentum.toLowerCase()}.` });
} else if (momentum === "Cooling" || momentum === "Softening" || momentum === "Stabilising") {
itemsSignals.push({ tone: "good", text: `Risk momentum is ${momentum.toLowerCase()}.` });
} else {
itemsSignals.push({ tone: "warn", text: "Risk momentum is stable but should continue to be monitored." });
}

if (liqFdvPct < 1) {
itemsSims.push({ tone: "bad", text: "Low liquidity depth suggests fast slippage under exit pressure." });
} else if (liqFdvPct < 3) {
itemsSims.push({ tone: "warn", text: "Liquidity depth looks fragile under concentrated selling." });
} else {
itemsSims.push({ tone: "good", text: "Liquidity depth appears more resilient to moderate pressure." });
}

if (!mintRevoked) {
itemsSims.push({ tone: "bad", text: "Mint-authority persistence increases supply-expansion simulation risk." });
} else {
itemsSims.push({ tone: "good", text: "Supply-expansion simulation risk is lower with mint authority revoked." });
}

if (!freezeRevoked) {
itemsSims.push({ tone: "bad", text: "Freeze-authority persistence increases transfer-control simulation risk." });
} else {
itemsSims.push({ tone: "good", text: "Transfer-restriction simulation risk is lower with freeze authority revoked." });
}

if (devDetected && devLikelyControlPct >= 35) {
itemsSims.push({
tone: "bad",
text: `Developer-network exit simulation suggests heavy pressure if linked wallets control ~${fmtPct(devLikelyControlPct, 1)} of analyzed structure.`,
});
} else if (devDetected) {
itemsSims.push({
tone: "warn",
text: "Developer-linked wallet behavior should be monitored for coordinated exits.",
});
}

if (walletNetControlPct >= 35) {
itemsSims.push({
tone: "bad",
text: `Wallet-network exit simulation indicates meaningful pressure if the mapped network unwinds ~${fmtPct(walletNetControlPct, 1)} of supply influence.`,
});
} else if (walletNetConfidence >= 45) {
itemsSims.push({
tone: "warn",
text: "Mapped wallet network should be monitored for synchronized selling pressure.",
});
}

if (top1 >= 25 && whaleScore >= 60) {
itemsSims.push({ tone: "bad", text: "Whale-led dump simulation impact appears severe." });
} else if (top1 >= 15 || whaleScore >= 45) {
itemsSims.push({ tone: "warn", text: "Whale-led dump simulation impact appears moderate." });
} else {
itemsSims.push({ tone: "good", text: "Whale-led dump simulation impact appears more contained." });
}

if (!mintRevoked || !freezeRevoked) {
itemsRiskFactors.push({ tone: "bad", text: "Authority persistence remains a primary structural risk." });
}
if (top10 >= 55) {
itemsRiskFactors.push({ tone: "bad", text: "Holder concentration is high enough to influence market behavior materially." });
}
if (hiddenControlScore >= 40 || linkedWallets >= 3 || clusterCount >= 2) {
itemsRiskFactors.push({ tone: "warn", text: "Wallet clustering suggests potential coordinated control or distribution structuring." });
}
if (freshPct >= 20) {
itemsRiskFactors.push({ tone: "warn", text: "Fresh-wallet participation is elevated and may reduce trust quality." });
}
if (devDetected) {
itemsRiskFactors.push({
tone: devConfidence >= 55 ? "bad" : "warn",
text:
devLikelyControlPct > 0
? `Developer-linked network confidence is ${devConfidence || "notable"} with likely control around ${fmtPct(devLikelyControlPct, 1)}.`
: `${devNet?.label || "Developer-linked behavior"} is present in the current signal mix.`,
});
}
if (walletNetConfidence >= 45) {
itemsRiskFactors.push({
tone: walletNetConfidence >= 75 ? "bad" : "warn",
text:
walletNetControlPct > 0
? `Wallet control map confidence is ${walletNetConfidence}% with estimated influence around ${fmtPct(walletNetControlPct, 1)}.`
: "Wallet control map shows meaningful coordinated influence.",
});
}
if (liqFdvPct < 3) {
itemsRiskFactors.push({ tone: "bad", text: "Liquidity depth is thin relative to valuation." });
}
if (!itemsRiskFactors.length) {
itemsRiskFactors.push({ tone: "good", text: "No major structural red flags dominate the current snapshot." });
}

itemsRadar.push({
tone: cassieToneByState(rm?.reputation?.state),
text: `Reputation layer reads ${String(rm?.reputation?.label || "unknown").toLowerCase()} at ${rm?.reputation?.score ?? "—"}/100.`,
});
itemsRadar.push({
tone: riskScore >= 70 ? "bad" : riskScore >= 45 ? "warn" : "good",
text: `Composite risk score is ${riskScore}/100 with signal "${rm?.signal || "—"}".`,
});
itemsRadar.push({
tone: linkedWallets >= 3 ? "warn" : "good",
text: `Cassie mapped ${linkedWallets} linked wallets across ${clusterCount} detected cluster group(s).`,
});
itemsRadar.push({
tone: marketJson?.found ? "good" : "warn",
text: marketJson?.found
? `Live market context loaded from ${marketJson?.dex || "market source"}.`
: "Market context is limited for this token right now.",
});

if (devDetected && devNotes.length) {
itemsRadar.push({
tone: devConfidence >= 55 ? "warn" : "good",
text: devNotes[0],
});
}

if (walletNetConfidence >= 45) {
itemsRadar.push({
tone: walletNetConfidence >= 75 ? "warn" : "good",
text: `Wallet control map confidence is ${walletNetConfidence}% with role "${walletNet?.role || "Observed wallet"}".`,
});
}

let verdict = "Monitor";
if (
riskScore >= 75 ||
hiddenControlScore >= 70 ||
(!mintRevoked && !freezeRevoked) ||
devConfidence >= 75 ||
walletNetConfidence >= 80
) {
verdict = "High Risk Structure";
} else if (
riskScore <= 35 &&
hiddenControlScore < 35 &&
mintRevoked &&
freezeRevoked &&
!devDetected &&
walletNetConfidence < 45
) {
verdict = "Structurally Stronger";
}

let threat = "Moderate";
if (
riskScore >= 75 ||
top10 >= 60 ||
liqFdvPct < 1 ||
hiddenControlScore >= 70 ||
momentum === "Escalating" ||
devConfidence >= 75 ||
walletNetConfidence >= 75
) {
threat = "Elevated";
} else if (
riskScore <= 35 &&
top10 < 40 &&
liqFdvPct >= 5 &&
mintRevoked &&
freezeRevoked &&
!devDetected &&
walletNetConfidence < 45
) {
threat = "Lower";
}

const confidenceNum = Math.max(
35,
Math.min(
95,
55 +
(marketJson?.found ? 8 : 0) +
(Array.isArray(activity?.clusters) ? 6 : 0) +
(trend?.found ? 10 : 0) +
(Array.isArray(itemsRiskFactors) ? Math.min(itemsRiskFactors.length * 3, 12) : 0) +
Math.min(Math.round(devConfidence * 0.1), 8) +
Math.min(Math.round(walletNetConfidence * 0.08), 6)
)
);

const summary = [
`Cassie synthesises this token as ${verdict.toLowerCase()}.`,
`Current threat outlook is ${threat.toLowerCase()}.`,
mintRevoked && freezeRevoked
? "Authority posture is cleaner."
: "Authority persistence remains a material concern.",
top10 >= 55
? "Concentration is materially elevated."
: "Concentration is not the dominant driver right now.",
hiddenControlScore >= 40
? "Linked-wallet structure contributes meaningfully to the read."
: "Linked-wallet structure is not the dominant driver at this time.",
devDetected
? "Developer-network signals contribute to the current read."
: "Developer-network signals are not dominant right now.",
walletNetConfidence >= 45
? "Wallet control map increases structural confidence in the read."
: "Wallet control map is not yet a dominant driver.",
].join(" ");

return {
verdict,
threat,
confidenceText: `${confidenceNum}%`,
summary,
itemsSignals,
itemsSims,
itemsRiskFactors,
itemsRadar,
};
}

function renderCassie(scanObj) {
const tokenJson = scanObj?.token || {};
const marketJson = scanObj?.market || {};
const conc = scanObj?.derived?.concentration || {};
const activity = scanObj?.derived?.activity || {};
const rm = scanObj?.derived?.riskModel || {};
const trend = scanObj?.trend || rm?.trend || {};

const cassie = buildCassieModel({
tokenJson,
marketJson,
conc,
activity,
rm,
trend,
});

setText("cassieVerdict", cassie.verdict);
setText("cassieThreat", cassie.threat);
setText("cassieConfidence", cassie.confidenceText);
setText("cassieSummary", cassie.summary);

renderCassieList("cassieSignalsList", cassie.itemsSignals);
renderCassieList("cassieSimList", cassie.itemsSims);
renderCassieList("cassieRiskFactorsList", cassie.itemsRiskFactors);
renderCassieList("cassieRadarList", cassie.itemsRadar);
}

function renderThreatRadar(scanObj) {
const token = scanObj?.token || {};
const market = scanObj?.market || {};
const rm = scanObj?.derived?.riskModel || {};
const conc = scanObj?.derived?.concentration || {};

const top10 = Number(conc?.top10 || 0);
const hiddenControlScore = Number(rm?.hiddenControl?.score || 0);
const devConfidence = Number(rm?.developerNetwork?.confidence || rm?.developerActivity?.confidence || 0);
const walletNetConfidence = Number(rm?.walletNetwork?.confidence || 0);
const walletNetControlPct = Number(rm?.walletNetwork?.controlEstimatePct || 0);
const whaleScore = Number(rm?.whaleActivity?.score || rm?.whaleScore || 0);
const freshPct = Number(rm?.freshWalletRisk?.pct || 0);

const liqUsd = Number(market?.liquidityUsd || 0);
const fdv = Number(market?.fdv || 0);
const liqFdvPct = fdv > 0 ? (liqUsd / fdv) * 100 : 0;

const mintRevoked = !!token?.safety?.mintRevoked;
const freezeRevoked = !!token?.safety?.freezeRevoked;

const devExitRisk = Math.max(
0,
Math.min(100, Math.round(devConfidence * 0.55 + hiddenControlScore * 0.2 + walletNetControlPct * 0.45))
);

const liquidityPullRisk = Math.max(
0,
Math.min(
100,
Math.round(
(mintRevoked ? 0 : 28) +
(freezeRevoked ? 0 : 16) +
(liqFdvPct < 1 ? 42 : liqFdvPct < 3 ? 28 : liqFdvPct < 6 ? 16 : 6) +
(devConfidence >= 55 ? 10 : 0)
)
)
);

const whaleDumpRisk = Math.max(
0,
Math.min(100, Math.round(whaleScore * 0.55 + top10 * 0.4 + walletNetConfidence * 0.15))
);

const authorityAbuseRisk = Math.max(
0,
Math.min(100, Math.round((mintRevoked ? 8 : 58) + (freezeRevoked ? 4 : 28)))
);

const freshWalletSwarmRisk = Math.max(
0,
Math.min(100, Math.round(freshPct * 1.65 + (hiddenControlScore >= 45 ? 10 : 0)))
);

const networkControlRisk = Math.max(
0,
Math.min(100, Math.round(walletNetConfidence * 0.6 + walletNetControlPct * 0.65 + hiddenControlScore * 0.2))
);

const paintRadar = (mainId, subId, score, lowText, midText, highText) => {
const el = $(mainId);
if (!el) return;
const band = pctBand(score);
el.classList.remove("good", "warn", "bad");
el.classList.add(band.state);
el.textContent = `${band.label} (${score}%)`;
setText(
subId,
band.state === "good" ? lowText : band.state === "warn" ? midText : highText
);
};

paintRadar(
"radarDevExit",
"radarDevExitSub",
devExitRisk,
"Developer-exit profile currently looks lower risk.",
"Developer-exit profile should be watched.",
"Developer-exit profile looks elevated."
);

paintRadar(
"radarLiquidityPull",
"radarLiquidityPullSub",
liquidityPullRisk,
"Liquidity-pull profile currently looks lower risk.",
"Liquidity-pull profile should be watched.",
"Liquidity-pull profile looks elevated."
);

paintRadar(
"radarWhaleDump",
"radarWhaleDumpSub",
whaleDumpRisk,
"Coordinated dump profile currently looks lower risk.",
"Coordinated dump profile should be watched.",
"Coordinated dump profile looks elevated."
);

paintRadar(
"radarAuthorityAbuse",
"radarAuthorityAbuseSub",
authorityAbuseRisk,
"Authority-abuse surface currently looks lower risk.",
"Authority-abuse surface should be watched.",
"Authority-abuse surface looks elevated."
);

paintRadar(
"radarFreshSwarm",
"radarFreshSwarmSub",
freshWalletSwarmRisk,
"Fresh-wallet swarm risk currently looks lower.",
"Fresh-wallet swarm risk is notable.",
"Fresh-wallet swarm risk looks elevated."
);

paintRadar(
"radarNetworkControl",
"radarNetworkControlSub",
networkControlRisk,
"Network-control profile currently looks lower risk.",
"Network-control profile should be watched.",
"Network-control profile looks elevated."
);
}

function renderSimulationOutlook(scanObj) {
const token = scanObj?.token || {};
const market = scanObj?.market || {};
const rm = scanObj?.derived?.riskModel || {};
const conc = scanObj?.derived?.concentration || {};

const devConfidence = Number(rm?.developerNetwork?.confidence || rm?.developerActivity?.confidence || 0);
const devControl = Number(rm?.developerNetwork?.likelyControlPct || 0);
const walletNetControl = Number(rm?.walletNetwork?.controlEstimatePct || 0);
const whaleScore = Number(rm?.whaleActivity?.score || rm?.whaleScore || 0);
const top10 = Number(conc?.top10 || 0);
const liqUsd = Number(market?.liquidityUsd || 0);
const fdv = Number(market?.fdv || 0);
const liqFdvPct = fdv > 0 ? (liqUsd / fdv) * 100 : 0;
const mintRevoked = !!token?.safety?.mintRevoked;
const freezeRevoked = !!token?.safety?.freezeRevoked;

const devExitImpact = Math.max(
0,
Math.min(95, Math.round(devConfidence * 0.38 + devControl * 0.9 + walletNetControl * 0.35))
);
const liquidityShock = Math.max(
0,
Math.min(95, Math.round((liqFdvPct < 1 ? 78 : liqFdvPct < 3 ? 58 : liqFdvPct < 6 ? 34 : 16)))
);
const coordinatedDump = Math.max(
0,
Math.min(95, Math.round(whaleScore * 0.45 + top10 * 0.42 + walletNetControl * 0.25))
);
const authorityAbuse = Math.max(
0,
Math.min(95, Math.round((mintRevoked ? 6 : 58) + (freezeRevoked ? 4 : 22)))
);

setText("simDevExitImpact", devExitImpact ? `-${devExitImpact}%` : "—");
setText(
"simDevExitSub",
devExitImpact
? `Estimated pressure if mapped developer/network wallets unwind coordinated exposure.`
: "No simulation loaded yet."
);

setText("simLiquidityShock", liquidityShock ? `-${liquidityShock}%` : "—");
setText(
"simLiquidityShockSub",
liquidityShock
? `Estimated impact under a sharp liquidity fragility event based on current depth.`
: "No simulation loaded yet."
);

setText("simCoordinatedDump", coordinatedDump ? `-${coordinatedDump}%` : "—");
setText(
"simCoordinatedDumpSub",
coordinatedDump
? `Estimated impact under synchronized whale or linked-network selling pressure.`
: "No simulation loaded yet."
);

setText("simAuthorityAbuse", authorityAbuse ? `${authorityAbuse}%` : "—");
setText(
"simAuthorityAbuseSub",
authorityAbuse
? `Authority abuse exposure if mint/freeze permissions are used against holders.`
: "No simulation loaded yet."
);
}

function resetPhase4() {
setText("netPrimary", "—");
setText("netCluster", "—");
setText("netRole", "—");
setText("netLinkedCount", "—");
setText("netLinked", "—");
setText("netFunding", "—");
setText("netControlPct", "—");
setText("netConfidence", "—");

setHtml(
"walletGraph",
`<div class="wallet-graph-center">
<div class="title">Primary Wallet</div>
<div class="value">No graph yet</div>
<div class="meta">Scan a token to render the wallet control map.</div>
</div>`
);

const radarIds = [
["radarDevExit", "radarDevExitSub"],
["radarLiquidityPull", "radarLiquidityPullSub"],
["radarWhaleDump", "radarWhaleDumpSub"],
["radarAuthorityAbuse", "radarAuthorityAbuseSub"],
["radarFreshSwarm", "radarFreshSwarmSub"],
["radarNetworkControl", "radarNetworkControlSub"],
];

for (const [mainId, subId] of radarIds) {
const el = $(mainId);
if (el) {
el.classList.remove("good", "warn", "bad");
el.classList.add("warn");
el.textContent = "—";
}
setText(subId, "No radar data yet.");
}

setText("simDevExitImpact", "—");
setText("simDevExitSub", "No simulation loaded yet.");
setText("simLiquidityShock", "—");
setText("simLiquidityShockSub", "No simulation loaded yet.");
setText("simCoordinatedDump", "—");
setText("simCoordinatedDumpSub", "No simulation loaded yet.");
setText("simAuthorityAbuse", "—");
setText("simAuthorityAbuseSub", "No simulation loaded yet.");
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
const [securityJson, holdersJson] = await Promise.all([
apiGet(`/api/sol/security/${mint}`),
apiGet(`/api/sol/holders/${mint}`),
]);

const tokenJson = securityJson?.token || {};
const marketJson = securityJson?.market || {};
const activity = securityJson?.activity || {};
const trend = securityJson?.trend || {};

renderTokenAuthorities(tokenJson);

const holdersSelect = $("holdersSelect");
const topN = holdersSelect ? Number(holdersSelect.value || 20) : 20;
const holderConc = renderHolders(holdersJson, topN);
const backendConc = securityJson?.concentration || {};
const conc = {
top1: hasNumber(backendConc.top1) ? Number(backendConc.top1) : Number(holderConc.top1 || 0),
top5: hasNumber(backendConc.top5) ? Number(backendConc.top5) : Number(holderConc.top5 || 0),
top10: hasNumber(backendConc.top10) ? Number(backendConc.top10) : Number(holderConc.top10 || 0),
top20: hasNumber(backendConc.top20) ? Number(backendConc.top20) : Number(holderConc.top20 || 0),
};

setText("top1", fmtPct(conc.top1));
setText("top5", fmtPct(conc.top5));
setText("top10", fmtPct(conc.top10));
setText("top20", fmtPct(conc.top20));

let rm = securityJson?.securityModel || null;
if (!rm || typeof rm.score !== "number") {
rm = {
score: 0,
label: { text: "Unknown", state: "warn" },
signal: "—",
primaryDriver: "—",
whaleScore: 0,
hiddenControl: {},
developerActivity: {},
developerNetwork: {},
walletNetwork: {},
freshWalletRisk: {},
liquidityStability: {},
whaleActivity: {},
trend: trend || {},
reputation: {},
};
}

const derivedMcapUsd = deriveMcapUsd({ marketJson, holdersJson, tokenJson });

const scanObj = {
mint,
token: tokenJson,
market: marketJson,
holders: holdersJson,
rawTrend: trend,
trend: rm?.trend || trend,
derived: {
concentration: conc,
activity,
riskModel: rm,
derivedMcapUsd,
},
};

renderClusters(activity, rm);
renderWalletNetwork(scanObj);
renderWalletGraph(scanObj);
renderMarket(marketJson, derivedMcapUsd);

setText("riskScore", `${rm.score ?? "—"}`);
setText("whaleScore", `${rm.whaleScore ?? "—"}`);
setText("riskSignal", rm.signal || "—");
setBadge("riskBadge", "riskDot", "riskText", rm?.label?.state || "warn", rm?.label?.text || "—");

renderRiskMeter(rm);
renderPhase2Signals(rm);
renderTrendChart(trend);
renderThreatRadar(scanObj);
renderSimulationOutlook(scanObj);

setText("notesText", buildNotes({ tokenJson, marketJson, conc, activity, rm }));

window.__MSS_LAST_SCAN__ = scanObj;
renderCassie(scanObj);
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
const svg = $("riskTrendChart");
if (svg) svg.innerHTML = "";

resetPhase4();

setText("cassieVerdict", "Unavailable");
setText("cassieThreat", "Unavailable");
setText("cassieConfidence", "—");
setText("cassieSummary", "Cassie could not complete synthesis because the token scan failed.");
renderCassieList("cassieSignalsList", [{ tone: "bad", text: "Cassie scan unavailable." }]);
renderCassieList("cassieSimList", [{ tone: "warn", text: "No simulation outlook available." }]);
renderCassieList("cassieRiskFactorsList", [{ tone: "warn", text: "No risk-factor synthesis available." }]);
renderCassieList("cassieRadarList", [{ tone: "warn", text: "No operational notes available." }]);
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
const holderConc = renderHolders(last.holders, topN);
const backendConc = last.derived?.concentration || {};
const conc = {
top1: hasNumber(backendConc.top1) ? Number(backendConc.top1) : Number(holderConc.top1 || 0),
top5: hasNumber(backendConc.top5) ? Number(backendConc.top5) : Number(holderConc.top5 || 0),
top10: hasNumber(backendConc.top10) ? Number(backendConc.top10) : Number(holderConc.top10 || 0),
top20: hasNumber(backendConc.top20) ? Number(backendConc.top20) : Number(holderConc.top20 || 0),
};

setText("top1", fmtPct(conc.top1));
setText("top5", fmtPct(conc.top5));
setText("top10", fmtPct(conc.top10));
setText("top20", fmtPct(conc.top20));

const rm = last.derived?.riskModel || {
score: 0,
label: { text: "Unknown", state: "warn" },
signal: "—",
whaleScore: 0,
developerNetwork: {},
walletNetwork: {},
};

setText("riskScore", `${rm.score ?? "—"}`);
setText("whaleScore", `${rm.whaleScore ?? "—"}`);
setText("riskSignal", rm.signal || "—");
setBadge("riskBadge", "riskDot", "riskText", rm?.label?.state || "warn", rm?.label?.text || "—");

renderRiskMeter(rm);
renderPhase2Signals(rm);
renderClusters(last.derived?.activity || {}, rm);
renderWalletNetwork(last);
renderWalletGraph(last);
renderTrendChart(last.rawTrend || last.trend || {});
renderThreatRadar(last);
renderSimulationOutlook(last);

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
window.__MSS_LAST_SCAN__ = last;
renderCassie(last);
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

const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(scanUrl)}`;

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

resetPhase4();

renderCassieList("cassieSignalsList", [{ tone: "warn", text: "No scan loaded yet." }]);
renderCassieList("cassieSimList", [{ tone: "warn", text: "No simulation outlook yet." }]);
renderCassieList("cassieRiskFactorsList", [{ tone: "warn", text: "No risk factors yet." }]);
renderCassieList("cassieRadarList", [{ tone: "warn", text: "No operational notes yet." }]);

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