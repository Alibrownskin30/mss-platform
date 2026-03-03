export function computeConcentration(holders = []) {
const pct = holders.map((h) => Number(h.pctSupply || 0));
const sumTopN = (n) => pct.slice(0, n).reduce((a, b) => a + b, 0);
return { top1: sumTopN(1), top5: sumTopN(5), top10: sumTopN(10), top20: sumTopN(20) };
}

export function calcRisk({ tokenJson, marketJson, conc }) {
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
score >= 75 ? { text: "High Risk", state: "bad" } :
score >= 45 ? { text: "Moderate Risk", state: "warn" } :
{ text: "Lower Risk", state: "good" };

const primaryDriver =
(!mintRevoked || !freezeRevoked) ? "Authority Control"
: (liqFdvPct > 0 && liqFdvPct < 3) ? "Liquidity Depth"
: (top10 >= 55) ? "Holder Distribution"
: "Volume Integrity";

const whaleScore = Math.max(0, Math.min(100, Math.round((Number(conc?.top10 || 0) / 80) * 100)));

const signal =
label.state === "bad" ? "High Alert" :
label.state === "warn" ? "Caution" :
"Normal";

return { score, label, primaryDriver, whaleScore, signal, liqFdvPct, volLiq };
}
