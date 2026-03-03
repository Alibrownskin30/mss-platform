export function computeConcentration(holders = []) {
const pct = holders.map((h) => Number(h.pctSupply || 0));
const sumTopN = (n) => pct.slice(0, n).reduce((a, b) => a + b, 0);
return {
top1: sumTopN(1),
top5: sumTopN(5),
top10: sumTopN(10),
top20: sumTopN(20),
};
}

export function whaleDominanceScore(top10Pct) {
if (top10Pct == null || Number.isNaN(Number(top10Pct))) return 0;
const t = Number(top10Pct);
return Math.max(0, Math.min(100, Math.round(((t - 15) / 55) * 100)));
}

export function calculateRisk({ safety, top1, top10, liquidity, fdv }) {
let r = 0;

if (!safety?.mintRevoked) r += 18;
if (!safety?.freezeRevoked) r += 22;

if (top1 != null) {
if (top1 > 25) r += 18;
else if (top1 > 15) r += 12;
else if (top1 > 8) r += 6;
}

if (top10 != null) {
if (top10 > 70) r += 22;
else if (top10 > 55) r += 16;
else if (top10 > 40) r += 10;
else if (top10 > 30) r += 6;
}

const liq = Number(liquidity || 0);
const f = Number(fdv || 0);

if (liq <= 0) r += 18;
else if (f > 0) {
const ratio = liq / f;
if (ratio < 0.005) r += 14;
else if (ratio < 0.01) r += 10;
else if (ratio < 0.02) r += 6;
}

return Math.max(0, Math.min(100, Math.round(r)));
}
