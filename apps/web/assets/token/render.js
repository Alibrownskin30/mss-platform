import { $, setText, setBadge } from "./dom.js";
import { fmtUsd, fmtNum, fmtPct, shortAddr } from "./format.js";

export function renderMarket(marketJson) {
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

export function renderTokenAuthorities(tokenJson) {
const mintAuthority = tokenJson?.mintAuthority ? shortAddr(tokenJson.mintAuthority, 6, 6) : "Revoked/None";
const freezeAuthority = tokenJson?.freezeAuthority ? shortAddr(tokenJson.freezeAuthority, 6, 6) : "Revoked/None";

setText("mintAuthority", mintAuthority);
setText("freezeAuthority", freezeAuthority);
setText("tokenProgram", "SPL Token");

// keep hidden label
setText("rpcLabel", "RPC: hidden");
}

export function renderHolders(holdersJson, topN = 20, computeConcentration) {
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

export function renderClusters(activity) {
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

export function renderRisk(rm) {
setText("riskScore", `${rm.score}`);
setText("whaleScore", `${rm.whaleScore}`);
setText("riskSignal", rm.signal);
setBadge("riskDot", "riskText", rm.label.state, rm.label.text);
}

export function renderNotes({ tokenJson, marketJson, conc, activity, rm }) {
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

setText("notesText", notes.join(" "));
}

export function renderRaw(obj) {
const pre = $("rawJson");
if (!pre) return;
pre.textContent = JSON.stringify(obj, null, 2);
}
