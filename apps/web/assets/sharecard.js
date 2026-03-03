function drawRoundedRect(ctx, x, y, w, h, r) {
const rr = Math.min(r, w / 2, h / 2);
ctx.beginPath();
ctx.moveTo(x + rr, y);
ctx.arcTo(x + w, y, x + w, y + h, rr);
ctx.arcTo(x + w, y + h, x, y + h, rr);
ctx.arcTo(x, y + h, x, y, rr);
ctx.arcTo(x, y, x + w, y, rr);
ctx.closePath();
}

function fmtUsd(n) {
const v = Number(n);
if (!Number.isFinite(v) || v <= 0) return "—";
if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
if (v >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
return `$${v.toFixed(2)}`;
}

function fmtPct(n) {
const v = Number(n);
if (!Number.isFinite(v)) return "—";
return `${v.toFixed(2)}%`;
}

function shortAddr(s, left = 8, right = 8) {
if (!s) return "—";
const str = String(s);
if (str.length <= left + right + 3) return str;
return `${str.slice(0, left)}…${str.slice(-right)}`;
}

export function renderShareCardToCanvas({
canvas,
mint,
riskLabel,
riskScore,
whaleScore,
top10,
liquidityUsd,
fdv,
}) {
const ctx = canvas.getContext("2d");

canvas.width = 1200;
canvas.height = 675;

const bg = ctx.createLinearGradient(0, 0, 1200, 675);
bg.addColorStop(0, "#05070c");
bg.addColorStop(1, "#070a12");
ctx.fillStyle = bg;
ctx.fillRect(0, 0, 1200, 675);

const glow1 = ctx.createRadialGradient(260, 90, 0, 260, 90, 520);
glow1.addColorStop(0, "rgba(0,255,209,0.22)");
glow1.addColorStop(1, "rgba(0,255,209,0)");
ctx.fillStyle = glow1;
ctx.fillRect(0, 0, 1200, 675);

const glow2 = ctx.createRadialGradient(980, 130, 0, 980, 130, 520);
glow2.addColorStop(0, "rgba(58,160,255,0.18)");
glow2.addColorStop(1, "rgba(58,160,255,0)");
ctx.fillStyle = glow2;
ctx.fillRect(0, 0, 1200, 675);

ctx.fillStyle = "rgba(255,255,255,0.06)";
ctx.strokeStyle = "rgba(255,255,255,0.10)";
ctx.lineWidth = 2;
drawRoundedRect(ctx, 70, 70, 1060, 535, 26);
ctx.fill();
ctx.stroke();

const mark = ctx.createLinearGradient(0, 0, 1, 1);
mark.addColorStop(0, "rgba(0,255,209,0.95)");
mark.addColorStop(1, "rgba(58,160,255,0.95)");
ctx.fillStyle = mark;
drawRoundedRect(ctx, 110, 110, 54, 54, 16);
ctx.fill();

ctx.fillStyle = "rgba(255,255,255,0.92)";
ctx.font = "800 34px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
ctx.fillText("MSS Protocol — Token Scan", 180, 150);

ctx.fillStyle = "rgba(255,255,255,0.65)";
ctx.font = "500 18px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
ctx.fillText("Structural risk intelligence snapshot", 180, 178);

const label = riskLabel || "—";
const score = Number.isFinite(Number(riskScore)) ? `${riskScore}/100` : "—";
const whale = Number.isFinite(Number(whaleScore)) ? `${whaleScore}/100` : "—";

let pill = "rgba(255,209,102,0.14)";
let pillBorder = "rgba(255,209,102,0.22)";
let pillDot = "#ffd166";
if (String(label).toLowerCase().includes("high")) { pill = "rgba(255,91,107,0.14)"; pillBorder="rgba(255,91,107,0.22)"; pillDot="#ff5b6b"; }
if (String(label).toLowerCase().includes("lower")) { pill = "rgba(53,245,163,0.12)"; pillBorder="rgba(53,245,163,0.18)"; pillDot="#35f5a3"; }

ctx.fillStyle = pill;
ctx.strokeStyle = pillBorder;
ctx.lineWidth = 2;
drawRoundedRect(ctx, 110, 215, 520, 70, 22);
ctx.fill();
ctx.stroke();

ctx.fillStyle = pillDot;
ctx.beginPath();
ctx.arc(142, 250, 7, 0, Math.PI * 2);
ctx.fill();

ctx.fillStyle = "rgba(255,255,255,0.92)";
ctx.font = "800 22px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
ctx.fillText(`${label}`, 160, 257);

ctx.fillStyle = "rgba(255,255,255,0.68)";
ctx.font = "600 16px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
ctx.fillText(`Risk: ${score} • Whale: ${whale}`, 160, 280);

const blocks = [
{ k: "Top10", v: fmtPct(top10) },
{ k: "Liquidity", v: fmtUsd(liquidityUsd) },
{ k: "FDV", v: fmtUsd(fdv) },
];

let x = 110;
for (const b of blocks) {
ctx.fillStyle = "rgba(255,255,255,0.045)";
ctx.strokeStyle = "rgba(255,255,255,0.09)";
ctx.lineWidth = 2;
drawRoundedRect(ctx, x, 320, 320, 120, 22);
ctx.fill();
ctx.stroke();

ctx.fillStyle = "rgba(255,255,255,0.62)";
ctx.font = "700 16px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
ctx.fillText(b.k, x + 22, 360);

ctx.fillStyle = "rgba(255,255,255,0.92)";
ctx.font = "900 30px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
ctx.fillText(b.v, x + 22, 405);

x += 370;
}

const ts = new Date().toLocaleString();
ctx.fillStyle = "rgba(255,255,255,0.65)";
ctx.font = "600 16px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New";
ctx.fillText(`Mint: ${shortAddr(mint, 10, 10)}`, 110, 520);

ctx.fillStyle = "rgba(255,255,255,0.55)";
ctx.font = "600 14px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
ctx.fillText(ts, 110, 548);

ctx.fillStyle = "rgba(255,255,255,0.80)";
ctx.font = "800 18px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
ctx.fillText("Powered by MSS Protocol", 900, 548);
}

export async function downloadCanvasPng(canvas, filename = "mss-scan-card.png") {
return new Promise((resolve) => {
canvas.toBlob((blob) => {
const a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = filename;
document.body.appendChild(a);
a.click();
a.remove();
setTimeout(() => URL.revokeObjectURL(a.href), 1200);
resolve(true);
}, "image/png");
});
}
