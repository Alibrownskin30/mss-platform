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
if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
if (v >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
if (v >= 1) return `$${v.toFixed(4)}`;
return `$${v.toFixed(8)}`;
}

function fmtPct(n, dp = 2) {
const v = Number(n);
if (!Number.isFinite(v)) return "—";
return `${v.toFixed(dp)}%`;
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
if (s === "good") return {
bg: "rgba(43,227,138,0.14)",
stroke: "rgba(43,227,138,0.32)",
glow: "rgba(43,227,138,0.18)",
text: "rgba(234,240,255,0.94)"
};
if (s === "bad") return {
bg: "rgba(255,77,109,0.14)",
stroke: "rgba(255,77,109,0.32)",
glow: "rgba(255,77,109,0.18)",
text: "rgba(234,240,255,0.94)"
};
return {
bg: "rgba(255,200,87,0.14)",
stroke: "rgba(255,200,87,0.32)",
glow: "rgba(255,200,87,0.16)",
text: "rgba(234,240,255,0.94)"
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

function drawGlow(ctx, x, y, w, h, color) {
const g = ctx.createRadialGradient(
x + w * 0.30, y + h * 0.40, 10,
x + w * 0.30, y + h * 0.40, Math.max(w, h)
);
g.addColorStop(0, color);
g.addColorStop(1, "rgba(0,0,0,0)");
ctx.fillStyle = g;
ctx.fillRect(x - 40, y - 40, w + 80, h + 80);
}

// Simple shield watermark (vector)
function drawShieldWatermark(ctx, x, y, size = 86) {
ctx.save();
ctx.globalAlpha = 0.14;

// outer glow
const g = ctx.createRadialGradient(x, y, 6, x, y, size * 0.9);
g.addColorStop(0, "rgba(79,209,255,0.55)");
g.addColorStop(1, "rgba(0,0,0,0)");
ctx.fillStyle = g;
ctx.beginPath();
ctx.arc(x, y, size * 0.9, 0, Math.PI * 2);
ctx.fill();

// shield shape
ctx.globalAlpha = 0.18;
const w = size, h = size * 1.1;
const sx = x - w / 2;
const sy = y - h / 2;

const grad = ctx.createLinearGradient(sx, sy, sx + w, sy + h);
grad.addColorStop(0, "rgba(57,208,200,0.70)");
grad.addColorStop(1, "rgba(120,140,255,0.70)");
ctx.fillStyle = grad;

ctx.beginPath();
// shield polygon
ctx.moveTo(sx + w * 0.5, sy);
ctx.lineTo(sx + w * 0.92, sy + h * 0.18);
ctx.lineTo(sx + w * 0.92, sy + h * 0.58);
ctx.lineTo(sx + w * 0.5, sy + h);
ctx.lineTo(sx + w * 0.08, sy + h * 0.58);
ctx.lineTo(sx + w * 0.08, sy + h * 0.18);
ctx.closePath();
ctx.fill();

// check mark
ctx.globalAlpha = 0.22;
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

export function buildShareCardData(scan) {
const mint = scan?.mint || scan?.token?.mint || "";

const token = scan?.token || {};
const market = scan?.market || {};
const derived = scan?.derived || {};
const risk = derived?.riskModel || {};
const conc = derived?.concentration || {};
const activity = derived?.activity || {};

const name = safeText(token?.name || token?.tokenName || token?.meta?.name, "—");
const symbol = safeText(token?.symbol || token?.tokenSymbol || token?.meta?.symbol, "");
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
const supplyUi = Number(token?.supplyUi ?? token?.supply ?? derived?.supplyUi);
const mcapDerived = (Number.isFinite(price) && Number.isFinite(supplyUi)) ? price * supplyUi : NaN;
const mcapUsd = Number.isFinite(mcapApi) && mcapApi > 0 ? mcapApi : mcapDerived;

const clustersCount = Number.isFinite(Number(activity?.clustersCount)) ? Number(activity.clustersCount) : 0;
const sybil = Number.isFinite(Number(activity?.sybilScore0to100)) ? Number(activity.sybilScore0to100) : null;
const clusterSignal = safeText(activity?.signalText, "—");

const clusterLine = sybil == null
? `Clusters: ${clustersCount}`
: `Clusters: ${clustersCount} • Sybil: ${sybil}/100`;

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
clusterSignal,

riskScore: risk?.score != null ? `${risk.score}/100` : "—",
riskLabel: safeText(risk?.label?.text, "—"),
signal: safeText(risk?.signal, "—"),
driver: safeText(risk?.primaryDriver, "—"),
state: safeText(risk?.label?.state, "warn"),

ts: new Date().toLocaleString(),
};
}

export async function downloadShareCardPNG(scan, opts = {}) {
const data = buildShareCardData(scan);

const canvas = document.createElement("canvas");
canvas.width = 1200;
canvas.height = 630;
const ctx = canvas.getContext("2d");

// Background
const bg = ctx.createLinearGradient(0, 0, 1200, 630);
bg.addColorStop(0, "#070A10");
bg.addColorStop(1, "#0A1022");
ctx.fillStyle = bg;
ctx.fillRect(0, 0, 1200, 630);

// Soft glows
const glow1 = ctx.createRadialGradient(280, 140, 10, 280, 140, 520);
glow1.addColorStop(0, "rgba(57,208,200,0.20)");
glow1.addColorStop(1, "rgba(57,208,200,0)");
ctx.fillStyle = glow1;
ctx.fillRect(0, 0, 1200, 630);

const glow2 = ctx.createRadialGradient(940, 180, 10, 940, 180, 540);
glow2.addColorStop(0, "rgba(120,140,255,0.18)");
glow2.addColorStop(1, "rgba(120,140,255,0)");
ctx.fillStyle = glow2;
ctx.fillRect(0, 0, 1200, 630);

// Panel
const panelX = 60, panelY = 70, panelW = 1080, panelH = 490;
roundRect(ctx, panelX, panelY, panelW, panelH, 22);
ctx.fillStyle = "rgba(255,255,255,0.05)";
ctx.fill();
ctx.lineWidth = 2;
ctx.strokeStyle = "rgba(255,255,255,0.10)";
ctx.stroke();

// ✅ Watermark shield (bottom-right, subtle)
drawShieldWatermark(ctx, 1085, 500, 96);

// Header (text-only)
ctx.fillStyle = "rgba(234,240,255,0.92)";
ctx.font = "800 26px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(data.title, 92, 126);

ctx.fillStyle = "rgba(234,240,255,0.62)";
ctx.font = "600 16px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(data.subtitle, 92, 152);

// Main title
ctx.fillStyle = "rgba(234,240,255,0.94)";
ctx.font = "900 44px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText("Token Scan Report", 92, 226);

// Token + mint lines
ctx.fillStyle = "rgba(234,240,255,0.78)";
ctx.font = "700 18px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(`Token: ${fitText(ctx, data.tokenLabel, 720)}`, 92, 262);

ctx.fillStyle = "rgba(234,240,255,0.70)";
ctx.font = "650 16px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
ctx.fillText(`mint: ${data.mintShort}`, 92, 292);

// Risk badge
const badge = riskBadgeColors(data.state);
drawGlow(ctx, 92, 312, 420, 56, badge.glow);

roundRect(ctx, 92, 316, 420, 56, 999);
ctx.fillStyle = badge.bg;
ctx.fill();
ctx.strokeStyle = badge.stroke;
ctx.lineWidth = 2;
ctx.stroke();

ctx.fillStyle = badge.text;
ctx.font = "900 20px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(fitText(ctx, data.riskLabel, 240), 114, 350);

ctx.fillStyle = "rgba(234,240,255,0.90)";
ctx.font = "900 20px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(data.riskScore, 350, 350);

// Driver + Cluster signal lines (clean)
ctx.fillStyle = "rgba(234,240,255,0.60)";
ctx.font = "650 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(`Primary driver: ${data.driver}`, 92, 386);

ctx.fillStyle = "rgba(234,240,255,0.55)";
ctx.font = "650 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(`Cluster signal: ${data.clusterSignal}`, 92, 406);

// KPI cards (3 x 3)
const kpis = [
{ k: "DEX • Pair", v: `${data.dex} • ${data.pairText}` },
{ k: "Price", v: data.priceUsd },
{ k: "Liquidity", v: data.liquidity },

{ k: "Volume 24h", v: data.volume24h },
{ k: "FDV", v: data.fdv },
{ k: "MCap", v: data.mcap },

{ k: "Top10 Holders", v: data.top10 },
{ k: "Clusters", v: data.clusterLine },
{ k: "Authorities", v: data.authLine },
];

const startX = 92;
const startY = 420;
const colW = 340;
const rowH = 74;

for (let i = 0; i < kpis.length; i++) {
const col = i % 3;
const row = Math.floor(i / 3);
const x = startX + col * colW;
const y = startY + row * rowH;

roundRect(ctx, x, y, 320, 62, 16);
ctx.fillStyle = "rgba(0,0,0,0.18)";
ctx.fill();
ctx.strokeStyle = "rgba(255,255,255,0.08)";
ctx.lineWidth = 1;
ctx.stroke();

ctx.fillStyle = "rgba(234,240,255,0.62)";
ctx.font = "800 12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(kpis[i].k, x + 16, y + 22);

ctx.fillStyle = "rgba(234,240,255,0.92)";
ctx.font = "900 16px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(fitText(ctx, kpis[i].v, 290), x + 16, y + 46);
}

// Bottom line
ctx.fillStyle = "rgba(234,240,255,0.55)";
ctx.font = "650 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText("Powered by MSS Protocol • Elite Security Layer", 92, 582);

// Timestamp right
ctx.textAlign = "right";
ctx.fillStyle = "rgba(234,240,255,0.42)";
ctx.font = "650 13px system-ui, -apple-system, Segoe UI, Roboto, Arial";
ctx.fillText(data.ts, 1140, 582);
ctx.textAlign = "left";

// Download
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
