import { $, setText, setPill } from "./dom.js";
import { fmtUsd, fmtNum, fmtPct, shortAddr } from "./format.js";
import { computeConcentration, whaleDominanceScore, calculateRisk } from "./metrics.js";

export function renderToken(tokenJson) {
if (tokenJson?.rpc) setText("rpcText", tokenJson.rpc);

setText("decimalsText", tokenJson?.decimals != null ? String(tokenJson.decimals) : "—");
setText("supplyText", tokenJson?.supply != null ? fmtNum(Number(tokenJson.supply)) : "—");

const mintRevoked = !!tokenJson?.safety?.mintRevoked;
const freezeRevoked = !!tokenJson?.safety?.freezeRevoked;

setPill("mintAuthPill",
mintRevoked ? "Mint Authority: Revoked" : "Mint Authority: Present/Unknown",
mintRevoked ? "good" : "warn"
);

setPill("freezeAuthPill",
freezeRevoked ? "Freeze Authority: Revoked" : "Freeze Authority: Present/Unknown",
freezeRevoked ? "good" : "warn"
);
}

export function renderMarket(marketJson) {
if (!marketJson?.found) {
setText("priceUsd", "—");
setText("pairText", "Pair: —");
setText("liqUsd", "—");
setText("vol24h", "Vol 24h: —");
setText("fdvUsd", "—");
setText("mcapUsd", "MCap: —");
setPill("dexPill", "DEX: —", "muted");
return;
}

setText("priceUsd", marketJson?.priceUsd != null ? `$${Number(marketJson.priceUsd).toFixed(6)}` : "—");

const pair = marketJson?.pair ? shortAddr(String(marketJson.pair), 4, 4) : "—";
const base = marketJson?.baseSymbol || "—";
const quote = marketJson?.quoteSymbol || "—";
setText("pairText", marketJson?.pair ? `Pair: ${base}/${quote} (${pair})` : "Pair: —");

setText("liqUsd", fmtUsd(marketJson?.liquidityUsd));
setText("vol24h", `Vol 24h: ${fmtUsd(marketJson?.volume24h)}`);
setText("fdvUsd", fmtUsd(marketJson?.fdv));

setPill("dexPill", marketJson?.dex ? `DEX: ${marketJson.dex}` : "DEX: —", marketJson?.dex ? "good" : "muted");
}

export function renderMcap({ marketJson, totalSupplyUi }) {
const priceUsd = Number(marketJson?.priceUsd || 0);
const supplyUi = Number(totalSupplyUi || 0);
const mcap = priceUsd > 0 && supplyUi > 0 ? priceUsd * supplyUi : 0;
setText("mcapUsd", mcap ? `MCap: ${fmtUsd(mcap)}` : "MCap: —");
}

export function renderHolders(holdersJson) {
const tbody = $("holdersTbody");
const details = $("holdersDetails");
const hint = $("holdersHint");

if (hint) hint.textContent = "";

if (!holdersJson?.found || !Array.isArray(holdersJson?.holders)) {
if (hint) hint.textContent = holdersJson?.error ? `Holder data unavailable: ${holdersJson.error}` : "Holder data unavailable.";
if (tbody) tbody.innerHTML = "";
if (details) details.open = false;
return { top1: null, top10: null, totalSupplyUi: null };
}

const conc = computeConcentration(holdersJson.holders);

setText("chipTop1", `Top1: ${fmtPct(conc.top1)}`);
setText("chipTop5", `Top5: ${fmtPct(conc.top5)}`);
setText("chipTop10", `Top10: ${fmtPct(conc.top10)}`);
setText("chipTop20", `Top20: ${fmtPct(conc.top20)}`);

const whale = whaleDominanceScore(conc.top10);
setText("chipWhale", `Whale Dominance: ${whale}/100`);

if (tbody) {
tbody.innerHTML = "";
for (const h of holdersJson.holders) {
const tr = document.createElement("tr");

const tdRank = document.createElement("td");
tdRank.textContent = String(h.rank ?? "");
tr.appendChild(tdRank);

const tdWallet = document.createElement("td");
const wallet = h.owner || h.tokenAccount;
tdWallet.textContent = shortAddr(wallet, 5, 5);
tdWallet.title = wallet;
tr.appendChild(tdWallet);

const tdAmt = document.createElement("td");
tdAmt.textContent = h.uiAmount != null ? fmtNum(Number(h.uiAmount)) : "—";
tr.appendChild(tdAmt);

const tdPct = document.createElement("td");
tdPct.textContent = h.pctSupply != null ? fmtPct(h.pctSupply) : "—";
tr.appendChild(tdPct);

tbody.appendChild(tr);
}
}

if (hint) hint.textContent = `Holders: loaded (top ${holdersJson.holders.length}).`;
if (details) details.open = true;

return {
top1: conc.top1,
top10: conc.top10,
totalSupplyUi: holdersJson?.totalSupplyUi ?? null
};
}

export function renderRisk({ tokenJson, marketJson, top1, top10 }) {
const riskEl = $("riskScore");
const labelEl = $("riskLabel");
if (!riskEl && !labelEl) return;

const risk = calculateRisk({
safety: tokenJson?.safety,
top1,
top10,
liquidity: marketJson?.liquidityUsd || 0,
fdv: marketJson?.fdv || 0,
});

if (riskEl) riskEl.textContent = `${risk}/100`;

let label = "Low Risk";
if (risk > 70) label = "High Risk";
else if (risk > 40) label = "Moderate Risk";
if (labelEl) labelEl.textContent = label;
}

export function renderRaw(rawObj) {
const pre = $("rawJson");
if (!pre) return;
pre.textContent = JSON.stringify(rawObj, null, 2);
}
