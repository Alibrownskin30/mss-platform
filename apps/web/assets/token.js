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
const devDetected =
typeof devNet?.detected === "boolean"
? devNet.detected
: Number(devNet?.confidence || 0) >= 35;
const devConfidence = Number(devNet?.confidence || 0);
const devLikelyControlPct = Number(devNet?.likelyControlPct || 0);
const devNotes = Array.isArray(devNet?.notes) ? devNet.notes : [];

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

let verdict = "Monitor";
if (
riskScore >= 75 ||
hiddenControlScore >= 70 ||
(!mintRevoked && !freezeRevoked) ||
devConfidence >= 75
) {
verdict = "High Risk Structure";
} else if (
riskScore <= 35 &&
hiddenControlScore < 35 &&
mintRevoked &&
freezeRevoked &&
!devDetected
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
devConfidence >= 75
) {
threat = "Elevated";
} else if (
riskScore <= 35 &&
top10 < 40 &&
liqFdvPct >= 5 &&
mintRevoked &&
freezeRevoked &&
!devDetected
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
Math.min(Math.round(devConfidence * 0.1), 8)
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
freshWalletRisk: {},
liquidityStability: {},
whaleActivity: {},
trend: trend || {},
reputation: {},
};
}

renderClusters(activity, rm);

const derivedMcapUsd = deriveMcapUsd({ marketJson, holdersJson, tokenJson });
renderMarket(marketJson, derivedMcapUsd);

setText("riskScore", `${rm.score ?? "—"}`);
setText("whaleScore", `${rm.whaleScore ?? "—"}`);
setText("riskSignal", rm.signal || "—");
setBadge("riskBadge", "riskDot", "riskText", rm?.label?.state || "warn", rm?.label?.text || "—");

renderRiskMeter(rm);
renderPhase2Signals(rm);
renderTrendChart(rm?.trend || trend);

setText("notesText", buildNotes({ tokenJson, marketJson, conc, activity, rm }));

const scanObj = {
mint,
token: tokenJson,
market: marketJson,
holders: holdersJson,
trend: rm?.trend || trend,
derived: {
concentration: conc,
activity,
riskModel: rm,
derivedMcapUsd,
},
};

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
};

setText("riskScore", `${rm.score ?? "—"}`);
setText("whaleScore", `${rm.whaleScore ?? "—"}`);
setText("riskSignal", rm.signal || "—");
setBadge("riskBadge", "riskDot", "riskText", rm?.label?.state || "warn", rm?.label?.text || "—");

renderRiskMeter(rm);
renderPhase2Signals(rm);
renderClusters(last.derived?.activity || {}, rm);
renderTrendChart(last.trend || rm?.trend || {});

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