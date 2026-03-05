function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

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

function fillRounded(ctx, x, y, w, h, r, fillStyle) {
roundRect(ctx, x, y, w, h, r);
ctx.fillStyle = fillStyle;
ctx.fill();
}

function strokeRounded(ctx, x, y, w, h, r, strokeStyle, lineWidth = 1) {
roundRect(ctx, x, y, w, h, r);
ctx.strokeStyle = strokeStyle;
ctx.lineWidth = lineWidth;
ctx.stroke();
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

// High-end “orb” background: subtle noise + thin grid + vignette
function drawPremiumBackdrop(ctx, w, h) {
// Base gradient
const bg = ctx.createLinearGradient(0, 0, w, h);
bg.addColorStop(0, "#05070d");
bg.addColorStop(0.55, "#070b16");
bg.addColorStop(1, "#090f24");
ctx.fillStyle = bg;
ctx.fillRect(0, 0, w, h);

// Orbs
drawSoftGlow(ctx, 240, 120, 520, "rgba(0,255,209,0.16)");
drawSoftGlow(ctx, w - 220, 140, 560, "rgba(58,160,255,0.14)");
drawSoftGlow(ctx, w * 0.62, h + 40, 520, "rgba(255,91,107,0.06)");

// Thin grid
ctx.save();
ctx.globalAlpha = 0.08;
ctx.strokeStyle = "rgba(255,255,255,0.18)";
ctx.lineWidth = 1;
const step = 56;
for (let x = 0; x <= w; x += step) {
ctx.beginPath();
ctx.moveTo(x + 0.5, 0);
ctx.lineTo(x + 0.5, h);
ctx.stroke();
}
for (let y = 0; y <= h; y += step) {
ctx.beginPath();
ctx.moveTo(0, y + 0.5);
ctx.lineTo(w, y + 0.5);
ctx.stroke();
}
ctx.restore();

// Vignette
ctx.save();
const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
vg.addColorStop(0, "rgba(0,0,0,0)");
vg.addColorStop(1, "rgba(0,0,0,0.55)");
ctx.fillStyle = vg;
ctx.fillRect(0, 0, w, h);
ctx.restore();
}

// Clean shield mark (subtle watermark)
function drawShieldWatermark(ctx, x, y, size = 92) {
ctx.save();
ctx.globalAlpha = 0.10;

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
grad.addColorStop(0, "rgba(0,255,209,0.65)");
grad.addColorStop(1, "rgba(58,160,255,0.65)");
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
ctx.strokeStyle = "rgba(234,240,255,0.90)";
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

function riskBadgeColors(state) {
const s = String(state || "warn");
if (s === "good") return {
bg: "rgba(53,245,163,0.12)",
stroke: "rgba(53,245,163,0.30)",
glow: "rgba(53,245,163,0.18)",
text: "rgba(234,240,255,0.96)",
dot: "rgba(53,245,163,0.95)"
};
if (s === "bad") return {
bg: "rgba(255,91,107,0.12)",
stroke: "rgba(255,91,107,0.30)",
glow: "rgba(255,91,107,0.16)",
text: "rgba(234,240,255,0.96)",
dot: "rgba(255,91,107,0.95)"
};
return {
bg: "rgba(255,209,102,0.12)",
stroke: "rgba(255,209,102,0.30)",
glow: "rgba(255,209,102,0.16)",
text: "rgba(234,240,255,0.96)",
dot: "rgba(255,209,102,0.95)"
};
}

// Draw a premium “glass” panel with inner highlight
function drawGlassPanel(ctx, x, y, w, h, r) {
// Base glass
const glass = ctx.createLinearGradient(x, y, x + w, y + h);
glass.addColorStop(0, "rgba(255,255,255,0.060)");
glass.addColorStop(0.45, "rgba(255,255,255,0.042)");
glass.addColorStop(1, "rgba(255,255,255,0.030)");
fillRounded(ctx, x, y, w, h, r, glass);

// Border
strokeRounded(ctx, x, y, w, h, r, "rgba(255,255,255,0.10)", 2);

// Inner highlight (top edge)
ctx.save();
ctx.globalAlpha = 0.9;
roundRect(ctx, x + 2, y + 2, w - 4, h - 4, r - 1);
ctx.clip();
const hi = ctx.createLinearGradient(x, y, x, y + h);
hi.addColorStop(0, "rgba(255,255,255,0.10)");
hi.addColorStop(0.25, "rgba(255,255,255,0.02)");
hi.addColorStop(1, "rgba(255,255,255,0.00)");
ctx.fillStyle = hi;
ctx.fillRect(x, y, w, h);
ctx.restore();
}

function drawPill(ctx, x, y, w, h, bg, stroke) {
fillRounded(ctx, x, y, w, h, 999, bg);
strokeRounded(ctx, x, y, w, h, 999, stroke, 2);
}

function drawChip(ctx, x, y, text, opts = {}) {
const padX = opts.padX ?? 12;
const h = opts.h ?? 30;
const r = opts.r ?? 999;
const maxW = opts.maxW ?? 9999;

ctx.save();
ctx.font = opts.font ?? "800 12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
const t = safeText(text, "—");
const wText = Math.min(maxW - padX * 2, ctx.measureText(t).width);
const w = Math.ceil(wText + padX * 2);

// Slightly more premium chip fill
const chip = ctx.createLinearGradient(x, y, x + w, y + h);
chip.addColorStop(0, opts.bg ?? "rgba(255,255,255,0.055)");
chip.addColorStop(1, opts.bg2 ?? "rgba(255,255,255,0.035)");
fillRounded(ctx, x, y, w, h, r, chip);
strokeRounded(ctx, x, y, w, h, r, opts.stroke ?? "rgba(255,255,255,0.10)", 1);

ctx.fillStyle = opts.color ?? "rgba(234,240,255,0.78)";
ctx.fillText(fitText(ctx, t, w - padX * 2), x + padX, y + Math.floor(h * 0.69));
ctx.restore();

return w;
}

function drawKpiCard(ctx, x, y, w, h, label, value) {
ctx.save();

// card glass
const g = ctx.createLinearGradient(x, y, x + w, y + h);
g.addColorStop(0, "rgba(0,0,0,0.24)");
g.addColorStop(1, "rgba(0,0,0,0.16)");
fillRounded(ctx, x, y, w, h, 18, g);
strokeRounded(ctx, x, y, w, h, 18, "rgba(255,255,255,0.10)", 1);

// subtle top highlight
ctx.save();
roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 17);
ctx.clip();
const hi = ctx.createLinearGradient(x, y, x, y + h);
hi.addColorStop(0, "rgba(255,255,255,0.10)");
hi.addColorStop(0.22, "rgba(255,255,255,0.03)");
hi.addColorStop(1, "rgba(255,255,255,0.00)");
ctx.fillStyle = hi;
ctx.fillRect(x, y, w, h);
ctx.restore();

ctx.fillStyle = "rgba(234,240,255,0.58)";
ctx.font = "900 12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(safeText(label, "—"), x + 16, y + 24);

ctx.fillStyle = "rgba(234,240,255,0.95)";
ctx.font = "950 20px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(fitText(ctx, safeText(value, "—"), w - 32), x + 16, y + 52);

ctx.restore();
}

function drawBrandMark(ctx, x, y) {
// Minimal “MSS” accent badge (premium, not loud)
ctx.save();
const w = 54, h = 24;
const bg = ctx.createLinearGradient(x, y, x + w, y + h);
bg.addColorStop(0, "rgba(0,255,209,0.20)");
bg.addColorStop(1, "rgba(58,160,255,0.18)");
fillRounded(ctx, x, y, w, h, 999, bg);
strokeRounded(ctx, x, y, w, h, 999, "rgba(255,255,255,0.14)", 1);

ctx.fillStyle = "rgba(234,240,255,0.92)";
ctx.font = "900 12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.textAlign = "center";
ctx.fillText("MSS", x + w / 2, y + 16);
ctx.textAlign = "left";
ctx.restore();
}

export function buildShareCardData(scan) {
const mint = scan?.mint || scan?.token?.mint || "";

const token = scan?.token || {};
const market = scan?.market || {};
const derived = scan?.derived || {};
const risk = derived?.riskModel || {};
const conc = derived?.concentration || {};
const activity = derived?.activity || {};

const name = safeText(
token?.metadata?.name || token?.meta?.name || token?.name || token?.tokenName,
"—"
);
const symbol = safeText(
token?.metadata?.symbol || token?.meta?.symbol || token?.symbol || token?.tokenSymbol,
""
);
const tokenLabel = symbol ? `${name} (${symbol})` : name;

const dex = safeText(market?.dex, "—");
const base = safeText(market?.baseSymbol, "");
const quote = safeText(market?.quoteSymbol, "");
const pairText = (base && quote) ? `${base}/${quote}` : safeText(market?.pair, "—");

const mintRevoked = !!token?.safety?.mintRevoked;
const freezeRevoked = !!token?.safety?.freezeRevoked;

const mintAuthText = mintRevoked ? "Mint: Revoked" : "Mint: Present/Unknown";
const freezeAuthText = freezeRevoked ? "Freeze: Revoked" : "Freeze: Present/Unknown";
const authLine = `${mintAuthText} • ${freezeAuthText}`;

const price = Number(market?.priceUsd);
const mcapApi = Number(market?.mcapUsd);
const derivedMcap = Number(derived?.derivedMcapUsd);
const mcapUsd = (Number.isFinite(mcapApi) && mcapApi > 0)
? mcapApi
: (Number.isFinite(derivedMcap) && derivedMcap > 0 ? derivedMcap : NaN);

const clustersCount = Number.isFinite(Number(activity?.clustersCount)) ? Number(activity.clustersCount) : 0;
const sybil = Number.isFinite(Number(activity?.sybilScore0to100)) ? Number(activity.sybilScore0to100) : null;

const clusterLine = sybil == null
? `Clusters: ${clustersCount}`
: `Clusters: ${clustersCount} • Sybil: ${sybil}/100`;

const priceChangeLine = buildPriceChangeLine(market?.priceChange);

// Deterministic timestamp for consistent output
const ts = new Date();
const tsText = `${ts.toLocaleDateString()} ${ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

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
clusterLine,

riskScore: risk?.score != null ? `${risk.score}/100` : "—",
riskLabel: safeText(risk?.label?.text, "—"),
signal: safeText(risk?.signal, "—"),
driver: safeText(risk?.primaryDriver, "—"),
state: safeText(risk?.label?.state, "warn"),

priceChangeLine,

ts: tsText,
};
}

export async function downloadShareCardPNG(scan, opts = {}) {
const data = buildShareCardData(scan);

const canvas = document.createElement("canvas");
canvas.width = 1200;
canvas.height = 630;
const ctx = canvas.getContext("2d");

// ===== Premium Backdrop =====
drawPremiumBackdrop(ctx, canvas.width, canvas.height);

// ===== Outer panel geometry =====
const panelX = 54, panelY = 54, panelW = 1092, panelH = 535;
drawGlassPanel(ctx, panelX, panelY, panelW, panelH, 26);

// Watermark (bottom-right inside panel)
drawShieldWatermark(ctx, panelX + panelW - 94, panelY + panelH - 86, 110);

// ===== Header layout =====
const left = panelX + 44;
const top = panelY + 44;

// Brand mark
drawBrandMark(ctx, left, top - 18);

// Title
ctx.fillStyle = "rgba(234,240,255,0.92)";
ctx.font = "950 30px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(data.title, left + 70, top);

ctx.fillStyle = "rgba(234,240,255,0.62)";
ctx.font = "800 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(data.subtitle, left + 70, top + 22);

// Divider line under header
ctx.save();
ctx.globalAlpha = 0.9;
ctx.strokeStyle = "rgba(255,255,255,0.08)";
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(panelX + 36, top + 44);
ctx.lineTo(panelX + panelW - 36, top + 44);
ctx.stroke();
ctx.restore();

// ===== Primary report heading =====
ctx.fillStyle = "rgba(234,240,255,0.96)";
ctx.font = "980 42px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText("Token Scan Report", left, top + 100);

// Token label
ctx.fillStyle = "rgba(234,240,255,0.78)";
ctx.font = "850 18px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(`Token: ${fitText(ctx, data.tokenLabel, 780)}`, left, top + 134);

// Mint line
ctx.fillStyle = "rgba(234,240,255,0.58)";
ctx.font = "700 14px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
ctx.fillText(`mint: ${data.mintShort}`, left, top + 158);

// ===== Risk Pill =====
const badge = riskBadgeColors(data.state);
drawSoftGlow(ctx, left + 190, top + 220, 240, badge.glow, 1);

const pillX = left;
const pillY = top + 182;
const pillW = 548;
const pillH = 60;

// pill background
drawPill(ctx, pillX, pillY, pillW, pillH, badge.bg, badge.stroke);

// dot
ctx.beginPath();
ctx.fillStyle = badge.dot;
ctx.arc(pillX + 26, pillY + Math.floor(pillH / 2), 6.5, 0, Math.PI * 2);
ctx.fill();

// risk label
ctx.fillStyle = badge.text;
ctx.font = "950 21px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(fitText(ctx, data.riskLabel, 320), pillX + 44, pillY + 38);

// score
ctx.textAlign = "right";
ctx.fillStyle = "rgba(234,240,255,0.92)";
ctx.font = "980 21px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(data.riskScore, pillX + pillW - 22, pillY + 38);
ctx.textAlign = "left";

// ===== Meta lines under pill =====
ctx.fillStyle = "rgba(234,240,255,0.66)";
ctx.font = "850 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(`Primary driver: ${fitText(ctx, data.driver, 548)}`, left, pillY + 86);

ctx.fillStyle = "rgba(234,240,255,0.52)";
ctx.font = "750 13px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(`Cluster signal: ${fitText(ctx, data.clusterLine, 548)}`, left, pillY + 108);

ctx.fillStyle = "rgba(234,240,255,0.52)";
ctx.font = "750 13px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(`Price change: ${fitText(ctx, data.priceChangeLine, 740)}`, left, pillY + 130);

// ===== Right-side chips =====
const rightColX = panelX + panelW - 44 - 430;
const chipY = top + 96;

// Header chips (consistent widths, premium feel)
drawChip(ctx, rightColX, chipY, `DEX: ${data.dex}`, { maxW: 430, h: 30 });
drawChip(ctx, rightColX, chipY + 38, `Pair: ${data.pairText}`, { maxW: 430, h: 30 });
drawChip(ctx, rightColX, chipY + 76, `Signal: ${data.signal}`, { maxW: 430, h: 30 });
drawChip(ctx, rightColX, chipY + 114, data.authLine, { maxW: 430, h: 30 });

// ===== KPI Grid (2 rows x 3 cols) =====
const gridX = left;
const gridY = top + 330;
const cardW = 334;
const cardH = 70;
const gapX = 18;
const gapY = 14;

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

// ===== Footer strip =====
const footerY = 606;

ctx.save();
ctx.strokeStyle = "rgba(255,255,255,0.08)";
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(54, footerY - 18);
ctx.lineTo(1146, footerY - 18);
ctx.stroke();
ctx.restore();

ctx.fillStyle = "rgba(234,240,255,0.52)";
ctx.font = "750 13px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.textAlign = "left";
ctx.fillText("Powered by MSS Protocol • Security Layer", 54, footerY);

ctx.textAlign = "right";
ctx.fillStyle = "rgba(234,240,255,0.38)";
ctx.font = "700 12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(data.ts, 1146, footerY);
ctx.textAlign = "left";

// ===== Download =====
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