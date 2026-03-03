// Create Wizard Logic (page-specific)
// No need to modify app.js for this page.

function fmtUSD(n){
const v = Number(n || 0);
return v.toLocaleString(undefined, { style:"currency", currency:"USD", maximumFractionDigits: 6 });
}

function fmtNum(n){
const v = Number(n || 0);
return v.toLocaleString();
}

function calc(){
const supply = Number(document.getElementById("supply").value);
const startMc = Number(document.getElementById("startMc").value);
const lpUsd = Number(document.getElementById("lpUsd").value);

// price = market cap / supply
const price = startMc / supply;

// tokens paired with LP (rough: LP USD / price)
const lpTokens = lpUsd / price;

const liqRatio = (lpUsd / startMc) * 100;

document.getElementById("outPrice").textContent = `$${price.toFixed(8)}`;
document.getElementById("outLpTokens").textContent = `${fmtNum(Math.floor(lpTokens))}`;
document.getElementById("outLiqRatio").textContent = `${liqRatio.toFixed(1)}%`;
document.getElementById("outStages").textContent = `Stage 1 (0–72h) → Stage 2 (72h–7d) → Stage 3 (7–30d) → Open`;
}

function exportJSON(){
const payload = {
name: document.getElementById("name").value.trim(),
symbol: document.getElementById("symbol").value.trim(),
supply: Number(document.getElementById("supply").value),
decimals: Number(document.getElementById("decimals").value),
startMarketCapUsd: Number(document.getElementById("startMc").value),
liquidityUsd: Number(document.getElementById("lpUsd").value),
week1SellTaxPct: Number(document.getElementById("tax").value),
stage1MaxWalletPct: Number(document.getElementById("maxWallet").value),
socials: {
x: document.getElementById("x").value.trim(),
tg: document.getElementById("tg").value.trim(),
web: document.getElementById("web").value.trim()
},
description: document.getElementById("desc").value.trim(),
createdAt: new Date().toISOString(),
stagePlan: {
stage1: "0-72h",
stage2: "72h-7d",
stage3: "7d-30d",
open: "30d+"
}
};

const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
const url = URL.createObjectURL(blob);

const a = document.createElement("a");
a.href = url;
a.download = `${payload.symbol || "token"}-mss-config.json`;
a.click();

URL.revokeObjectURL(url);
}

function preview(){
alert("Next: this will auto-generate a token profile page preview using your inputs.");
}

["supply","startMc","lpUsd","tax","maxWallet"].forEach(id => {
document.getElementById(id).addEventListener("change", calc);
});

document.getElementById("btnExport").addEventListener("click", exportJSON);
document.getElementById("btnPreview").addEventListener("click", preview);

// initial calc
calc();