function clamp(n, a, b) {
return Math.max(a, Math.min(b, n));
}

function safeText(s, fallback = "—") {
if (s == null) return fallback;
const t = String(s).trim();
return t ? t : fallback;
}

function shortAddr(addr, left = 6, right = 6) {
const s = safeText(addr, "");
if (!s) return "—";
if (s.length <= left + right + 3) return s;
return `${s.slice(0, left)}…${s.slice(-right)}`;
}

function fmtUsdCompact(n) {
const v = Number(n);
if (!Number.isFinite(v)) return "—";
const abs = Math.abs(v);
if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
if (abs >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
if (abs >= 1) return `$${v.toFixed(6)}`;
return `$${v.toFixed(8)}`;
}

function fmtPct(n, dp = 2) {
const v = Number(n);
if (!Number.isFinite(v)) return "—";
return `${v.toFixed(dp)}%`;
}

function fmtSignedPct(n, dp = 2) {
const v = Number(n);
if (!Number.isFinite(v)) return "—";
const sign = v > 0 ? "+" : "";
return `${sign}${v.toFixed(dp)}%`;
}

function fitText(ctx, text, maxWidth) {
const s = safeText(text, "—");
if (ctx.measureText(s).width <= maxWidth) return s;

const ell = "…";
let lo = 0;
let hi = s.length;

while (lo < hi) {
const mid = Math.ceil((lo + hi) / 2);
const candidate = s.slice(0, mid) + ell;
if (ctx.measureText(candidate).width <= maxWidth) lo = mid;
else hi = mid - 1;
}

return s.slice(0, lo) + ell;
}

function riskBadgeColors(state) {
const s = String(state || "warn");
if (s === "good") {
return {
bg: "rgba(43,227,138,0.14)",
stroke: "rgba(43,227,138,0.34)",
glow: "rgba(43,227,138,0.20)",
text: "rgba(234,240,255,0.95)",
dot: "rgba(43,227,138,0.95)",
};
}
if (s === "bad") {
return {
bg: "rgba(255,77,109,0.14)",
stroke: "rgba(255,77,109,0.34)",
glow: "rgba(255,77,109,0.18)",
text: "rgba(234,240,255,0.95)",
dot: "rgba(255,77,109,0.95)",
};
}
return {
bg: "rgba(255,200,87,0.14)",
stroke: "rgba(255,200,87,0.34)",
glow: "rgba(255,200,87,0.18)",
text: "rgba(234,240,255,0.95)",
dot: "rgba(255,200,87,0.95)",
};
}

function roundRect(ctx, x, y, w, h, r) {
const radius = clamp(r, 0, Math.min(w, h) / 2);
ctx.beginPath();
ctx.moveTo(x + radius, y);
ctx.arcTo(x + w, y, x + w, y + h, radius);
ctx.arcTo(x + w, y + h, x, y + h, radius);
ctx.arcTo(x, y + h, x, y, radius);
ctx.arcTo(x, y, x + w, y, radius);
ctx.closePath();
}

function drawSoftGlow(ctx, cx, cy, r, color, alpha = 1) {
ctx.save();
ctx.globalAlpha = alpha;
const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
g.addColorStop(0, color);
g.addColorStop(1, "rgba(0,0,0,0)");
ctx.fillStyle = g;
ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
ctx.restore();
}

function drawShieldWatermark(ctx, x, y, size = 92) {
ctx.save();
ctx.globalAlpha = 0.1;

const g = ctx.createRadialGradient(x, y, 8, x, y, size * 0.95);
g.addColorStop(0, "rgba(79,209,255,0.65)");
g.addColorStop(1, "rgba(0,0,0,0)");
ctx.fillStyle = g;
ctx.beginPath();
ctx.arc(x, y, size * 0.9, 0, Math.PI * 2);
ctx.fill();

const w = size;
const h = size * 1.12;
const sx = x - w / 2;
const sy = y - h / 2;

const grad = ctx.createLinearGradient(sx, sy, sx + w, sy + h);
grad.addColorStop(0, "rgba(57,208,200,0.75)");
grad.addColorStop(1, "rgba(120,140,255,0.75)");
ctx.fillStyle = grad;

ctx.beginPath();
ctx.moveTo(sx + w * 0.5, sy);
ctx.lineTo(sx + w * 0.92, sy + h * 0.18);
ctx.lineTo(sx + w * 0.92, sy + h * 0.58);
ctx.lineTo(sx + w * 0.5, sy + h);
ctx.lineTo(sx + w * 0.08, sy + h * 0.58);
ctx.lineTo(sx + w * 0.08, sy + h * 0.18);
ctx.closePath();
ctx.fill();

ctx.globalAlpha = 0.16;
ctx.strokeStyle = "rgba(234,240,255,0.95)";
ctx.lineWidth = Math.max(2, Math.round(size / 18));
ctx.lineCap = "round";
ctx.lineJoin = "round";
ctx.beginPath();
ctx.moveTo(sx + w * 0.33, sy + h * 0.55);
ctx.lineTo(sx + w * 0.46, sy + h * 0.67);
ctx.lineTo(sx + w * 0.70, sy + h * 0.40);
ctx.stroke();

ctx.restore();
}

function normalizePriceChange(pc = {}) {
return {
h1: pc.h1 ?? null,
h24: pc.h24 ?? null,
d7: pc.d7 ?? pc.h168 ?? null,
m30: pc.m30 ?? pc.d30 ?? pc.m1 ?? null,
};
}

function buildPriceChangeLine(pc) {
const c = normalizePriceChange(pc);
const parts = [];
if (c.h1 != null) parts.push(`1h ${fmtSignedPct(c.h1, 2)}`);
if (c.h24 != null) parts.push(`24h ${fmtSignedPct(c.h24, 2)}`);
if (c.d7 != null) parts.push(`7d ${fmtSignedPct(c.d7, 2)}`);
if (c.m30 != null) parts.push(`30d ${fmtSignedPct(c.m30, 2)}`);
return parts.length ? parts.join(" • ") : "—";
}

function compactSignal(label, score) {
const s = Number(score);
const base = safeText(label, "—");
if (!Number.isFinite(s)) return base;
return `${base} (${s}/100)`;
}

export function buildShareCardData(scan) {
const mint = scan?.mint || scan?.token?.mint || "";

const token = scan?.token || {};
const market = scan?.market || {};
const derived = scan?.derived || {};
const risk = derived?.riskModel || {};
const conc = derived?.concentration || {};
const activity = derived?.activity || {};
const trend = scan?.trend || risk?.trend || {};

const name = safeText(
token?.metadata?.name || token?.meta?.name || token?.name || token?.tokenName || market?.baseName,
"—"
);
const symbol = safeText(
token?.metadata?.symbol || token?.meta?.symbol || token?.symbol || token?.tokenSymbol || market?.baseSymbol,
""
);
const tokenLabel = symbol ? `${name} (${symbol})` : name;

const dex = safeText(market?.dex, "—");
const base = safeText(market?.baseSymbol, "");
const quote = safeText(market?.quoteSymbol, "");
const pairText = base && quote ? `${base}/${quote}` : safeText(market?.pair, "—");

const mintRevoked = !!token?.safety?.mintRevoked;
const freezeRevoked = !!token?.safety?.freezeRevoked;

const mintAuthText = mintRevoked ? "Mint Revoked" : "Mint Present";
const freezeAuthText = freezeRevoked ? "Freeze Revoked" : "Freeze Present";
const authLine = `${mintAuthText} • ${freezeAuthText}`;

const price = Number(market?.priceUsd);
const mcapApi = Number(market?.mcapUsd);
const derivedMcap = Number(derived?.derivedMcapUsd);
const mcapUsd =
Number.isFinite(mcapApi) && mcapApi > 0
? mcapApi
: Number.isFinite(derivedMcap) && derivedMcap > 0
? derivedMcap
: NaN;

const hiddenControl = risk?.hiddenControl || {};
const freshWalletRisk = risk?.freshWalletRisk || {};
const liquidityStability = risk?.liquidityStability || {};
const whaleActivity = risk?.whaleActivity || {};
const reputation = risk?.reputation || {};

const clustersCount = Number.isFinite(Number(activity?.clusterCount))
? Number(activity.clusterCount)
: Number.isFinite(Number(activity?.clusters?.length))
? Number(activity.clusters.length)
: 0;

return {
title: "MSS Protocol",
subtitle: "Elite Security Intelligence",

mintShort: shortAddr(mint, 6, 6),
mintFull: mint,

tokenLabel,
dex,
pairText,

priceUsd: Number.isFinite(price) ? fmtUsdCompact(price) : "—",
liquidity: fmtUsdCompact(market?.liquidityUsd),
volume24h: fmtUsdCompact(market?.volume24h),
fdv: fmtUsdCompact(market?.fdv),
mcap: fmtUsdCompact(mcapUsd),

top10: conc?.top10 != null ? fmtPct(conc.top10, 2) : "—",
authLine,

riskScore: risk?.score != null ? `${risk.score}/100` : "—",
riskLabel: safeText(risk?.label?.text, "—"),
signal: safeText(risk?.signal, "—"),
driver: safeText(risk?.primaryDriver, "—"),
state: safeText(risk?.label?.state, "warn"),

priceChangeLine: buildPriceChangeLine(market?.priceChange),
hiddenLine: compactSignal(hiddenControl?.label, hiddenControl?.score),
freshLine: compactSignal(freshWalletRisk?.label, freshWalletRisk?.score),
liqLine: compactSignal(liquidityStability?.label, liquidityStability?.score),
whaleLine: compactSignal(whaleActivity?.label, whaleActivity?.score),
trendLine: [
safeText(trend?.label || risk?.trend?.label, "Stable"),
safeText(trend?.momentum || risk?.trend?.momentum, "Stable"),
].join(" • "),
reputationLine:
reputation?.score != null
? `${safeText(reputation?.label, "—")} • ${reputation.score}/100`
: safeText(reputation?.label, "—"),
clusterLine: `Clusters: ${clustersCount} • Linked wallets: ${safeText(hiddenControl?.linkedWallets, "—")}`,

ts: new Date().toLocaleString(),
};
}

function drawChip(ctx, x, y, text, opts = {}) {
const padX = opts.padX ?? 10;
const h = opts.h ?? 28;
const r = opts.r ?? 999;
const maxW = opts.maxW ?? 9999;

ctx.save();
ctx.font = opts.font ?? "700 12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
const t = fitText(ctx, safeText(text, "—"), maxW - padX * 2);
const w = Math.ceil(ctx.measureText(t).width + padX * 2);

roundRect(ctx, x, y, w, h, r);
ctx.fillStyle = opts.bg ?? "rgba(255,255,255,0.06)";
ctx.fill();
ctx.strokeStyle = opts.stroke ?? "rgba(255,255,255,0.10)";
ctx.lineWidth = 1;
ctx.stroke();

ctx.fillStyle = opts.color ?? "rgba(234,240,255,0.78)";
ctx.fillText(t, x + padX, y + Math.floor(h * 0.68));
ctx.restore();

return w;
}

function drawKpiCard(ctx, x, y, w, h, label, value) {
ctx.save();
roundRect(ctx, x, y, w, h, 16);
ctx.fillStyle = "rgba(0,0,0,0.18)";
ctx.fill();
ctx.strokeStyle = "rgba(255,255,255,0.10)";
ctx.lineWidth = 1;
ctx.stroke();

ctx.fillStyle = "rgba(234,240,255,0.58)";
ctx.font = "800 12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(safeText(label, "—"), x + 14, y + 21);

ctx.fillStyle = "rgba(234,240,255,0.94)";
ctx.font = "900 17px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(fitText(ctx, safeText(value, "—"), w - 28), x + 14, y + 47);

ctx.restore();
}

function drawMiniSignalCard(ctx, x, y, w, h, title, value) {
ctx.save();
roundRect(ctx, x, y, w, h, 14);
ctx.fillStyle = "rgba(255,255,255,0.04)";
ctx.fill();
ctx.strokeStyle = "rgba(255,255,255,0.08)";
ctx.lineWidth = 1;
ctx.stroke();

ctx.fillStyle = "rgba(234,240,255,0.56)";
ctx.font = "800 10px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(fitText(ctx, safeText(title, "—"), w - 24), x + 12, y + 16);

ctx.fillStyle = "rgba(234,240,255,0.92)";
ctx.font = "900 12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(fitText(ctx, safeText(value, "—"), w - 24), x + 12, y + 37);

ctx.restore();
}

function drawKpiGlassPanel(ctx, x, y, w, h) {
ctx.save();
roundRect(ctx, x, y, w, h, 22);
ctx.fillStyle = "rgba(255,255,255,0.04)";
ctx.fill();
ctx.strokeStyle = "rgba(255,255,255,0.10)";
ctx.lineWidth = 1.5;
ctx.stroke();

const g = ctx.createLinearGradient(x, y, x + w, y + h);
g.addColorStop(0, "rgba(0,255,209,0.06)");
g.addColorStop(0.5, "rgba(255,255,255,0.02)");
g.addColorStop(1, "rgba(58,160,255,0.05)");
ctx.fillStyle = g;
ctx.globalAlpha = 0.7;
ctx.fill();

ctx.restore();
}

export async function downloadShareCardPNG(scan, opts = {}) {
const data = buildShareCardData(scan);

const canvas = document.createElement("canvas");
canvas.width = 1200;
canvas.height = 630;
const ctx = canvas.getContext("2d");

const bg = ctx.createLinearGradient(0, 0, 1200, 630);
bg.addColorStop(0, "#070A10");
bg.addColorStop(1, "#0A1022");
ctx.fillStyle = bg;
ctx.fillRect(0, 0, 1200, 630);

drawSoftGlow(ctx, 260, 130, 540, "rgba(57,208,200,0.22)");
drawSoftGlow(ctx, 980, 170, 580, "rgba(120,140,255,0.18)");
drawSoftGlow(ctx, 720, 620, 520, "rgba(255,77,109,0.08)");

const panelX = 54;
const panelY = 42;
const panelW = 1092;
const panelH = 540;

roundRect(ctx, panelX, panelY, panelW, panelH, 24);
ctx.fillStyle = "rgba(255,255,255,0.05)";
ctx.fill();
ctx.strokeStyle = "rgba(255,255,255,0.10)";
ctx.lineWidth = 2;
ctx.stroke();

drawShieldWatermark(ctx, panelX + panelW - 92, panelY + panelH - 90, 92);

const left = panelX + 38;
const top = panelY + 36;

ctx.fillStyle = "rgba(234,240,255,0.92)";
ctx.font = "900 28px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(data.title, left, top);

ctx.fillStyle = "rgba(234,240,255,0.62)";
ctx.font = "700 15px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(data.subtitle, left, top + 26);

ctx.fillStyle = "rgba(234,240,255,0.96)";
ctx.font = "900 38px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText("Token Scan Report", left, top + 82);

ctx.fillStyle = "rgba(234,240,255,0.78)";
ctx.font = "750 17px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(`Token: ${fitText(ctx, data.tokenLabel, 700)}`, left, top + 114);

ctx.fillStyle = "rgba(234,240,255,0.62)";
ctx.font = "650 14px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
ctx.fillText(`mint: ${data.mintShort}`, left, top + 140);

const badge = riskBadgeColors(data.state);
drawSoftGlow(ctx, left + 180, top + 184, 220, badge.glow, 1);

const pillX = left;
const pillY = top + 156;
const pillW = 520;
const pillH = 56;

roundRect(ctx, pillX, pillY, pillW, pillH, 999);
ctx.fillStyle = badge.bg;
ctx.fill();
ctx.strokeStyle = badge.stroke;
ctx.lineWidth = 2;
ctx.stroke();

ctx.beginPath();
ctx.fillStyle = badge.dot;
ctx.arc(pillX + 24, pillY + Math.floor(pillH / 2), 6, 0, Math.PI * 2);
ctx.fill();

ctx.fillStyle = badge.text;
ctx.font = "900 20px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(fitText(ctx, data.riskLabel, 250), pillX + 40, pillY + 36);

ctx.textAlign = "right";
ctx.fillStyle = "rgba(234,240,255,0.92)";
ctx.font = "900 20px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(data.riskScore, pillX + pillW - 22, pillY + 36);
ctx.textAlign = "left";

ctx.fillStyle = "rgba(234,240,255,0.64)";
ctx.font = "700 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(`Primary driver: ${fitText(ctx, data.driver, 520)}`, left, pillY + 84);

ctx.fillStyle = "rgba(234,240,255,0.52)";
ctx.font = "650 13px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(`Trend: ${fitText(ctx, data.trendLine, 520)}`, left, pillY + 104);

ctx.fillStyle = "rgba(234,240,255,0.52)";
ctx.font = "650 13px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(`Price change: ${fitText(ctx, data.priceChangeLine, 720)}`, left, pillY + 124);

const rightColX = panelX + panelW - 380;
const chipY = top + 102;

drawChip(ctx, rightColX, chipY, `DEX: ${data.dex}`, { maxW: 320, h: 28 });
drawChip(ctx, rightColX, chipY + 38, `Pair: ${data.pairText}`, { maxW: 320, h: 28 });
drawChip(ctx, rightColX, chipY + 76, `Signal: ${data.signal}`, { maxW: 320, h: 28 });
drawChip(ctx, rightColX, chipY + 114, data.authLine, { maxW: 320, h: 28 });

const gridX = left;
const gridY = top + 292;
const cardW = 320;
const cardH = 62;
const gapX = 16;
const gapY = 12;

const gridW = cardW * 3 + gapX * 2;
const gridH = cardH * 2 + gapY;
drawKpiGlassPanel(ctx, gridX - 14, gridY - 14, gridW + 28, gridH + 28);

const kpis = [
["Price (USD)", data.priceUsd],
["Liquidity", data.liquidity],
["Volume (24h)", data.volume24h],
["FDV", data.fdv],
["MCap", data.mcap],
["Top10 Holders", data.top10],
];

for (let i = 0; i < kpis.length; i++) {
const col = i % 3;
const row = Math.floor(i / 3);
const x = gridX + col * (cardW + gapX);
const y = gridY + row * (cardH + gapY);
drawKpiCard(ctx, x, y, cardW, cardH, kpis[i][0], kpis[i][1]);
}

const signalY = gridY + gridH + 20;
const signalX = left;
const signalGap = 10;
const signalW = 190;
const signalH = 48;

drawMiniSignalCard(ctx, signalX + (signalW + signalGap) * 0, signalY, signalW, signalH, "Hidden Control", data.hiddenLine);
drawMiniSignalCard(ctx, signalX + (signalW + signalGap) * 1, signalY, signalW, signalH, "Fresh Wallet Risk", data.freshLine);
drawMiniSignalCard(ctx, signalX + (signalW + signalGap) * 2, signalY, signalW, signalH, "Liquidity Stability", data.liqLine);
drawMiniSignalCard(ctx, signalX + (signalW + signalGap) * 3, signalY, signalW, signalH, "Whale Activity", data.whaleLine);
drawMiniSignalCard(ctx, signalX + (signalW + signalGap) * 4, signalY, signalW, signalH, "Reputation", data.reputationLine);

ctx.fillStyle = "rgba(234,240,255,0.42)";
ctx.font = "650 11px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(fitText(ctx, data.clusterLine, 1000), left, signalY + signalH + 16);

const footerY = 602;
ctx.strokeStyle = "rgba(255,255,255,0.08)";
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(54, footerY - 18);
ctx.lineTo(1146, footerY - 18);
ctx.stroke();

ctx.fillStyle = "rgba(234,240,255,0.52)";
ctx.font = "650 13px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.textAlign = "left";
ctx.fillText("Powered by MSS Protocol • Elite Security Layer", 54, footerY);

ctx.textAlign = "right";
ctx.fillStyle = "rgba(234,240,255,0.38)";
ctx.font = "650 12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(data.ts, 1146, footerY);

ctx.textAlign = "left";

const fileMint = (data.mintFull || "mint").slice(0, 8);
const filename = `mss-scan-${fileMint}.png`;

const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.95));
if (!blob) throw new Error("Failed to generate PNG.");

const a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = filename;
document.body.appendChild(a);
a.click();
a.remove();
setTimeout(() => URL.revokeObjectURL(a.href), 2500);

return { ok: true, filename };
}
