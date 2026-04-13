const DEFAULTS = {
pricePaddingPct: 0.08,
volumePaddingPct: 0.15,
candleGap: 3,
wickWidth: 1,
maxCandles: 160,
minVisibleCandles: 24,
maxVisibleCandles: 240,
rightAxisWidth: 76,
leftPadding: 10,
topPadding: 16,
bottomPricePadding: 26,
bottomVolumePadding: 22,
};

function toNumber(value, fallback = 0) {
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
return Math.min(max, Math.max(min, value));
}

function formatPrice(value) {
const num = toNumber(value, 0);
if (num >= 1) return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
if (num >= 0.01) return num.toLocaleString(undefined, { maximumFractionDigits: 6 });
return num.toLocaleString(undefined, { maximumFractionDigits: 10 });
}

function formatCompact(value) {
return new Intl.NumberFormat(undefined, {
notation: "compact",
maximumFractionDigits: 2,
}).format(toNumber(value, 0));
}

function formatAxisTime(value, interval = "1m") {
const d = new Date(value);
if (!Number.isFinite(d.getTime())) return "";

if (interval === "1d") {
return d.toLocaleDateString([], { month: "short", day: "2-digit" });
}

if (interval === "4h" || interval === "1h") {
return d.toLocaleString([], {
month: "short",
day: "2-digit",
hour: "2-digit",
});
}

return d.toLocaleTimeString([], {
hour: "2-digit",
minute: "2-digit",
});
}

function getCanvasSize(canvas) {
const rect = canvas.getBoundingClientRect();
const dpr = window.devicePixelRatio || 1;
const width = Math.max(1, Math.floor(rect.width));
const height = Math.max(1, Math.floor(rect.height));

const nextW = Math.floor(width * dpr);
const nextH = Math.floor(height * dpr);

if (canvas.width !== nextW || canvas.height !== nextH) {
canvas.width = nextW;
canvas.height = nextH;
}

return { width, height, dpr };
}

function createCanvas(host, className = "") {
const canvas = document.createElement("canvas");
if (className) canvas.className = className;
canvas.style.width = "100%";
canvas.style.height = "100%";
canvas.style.display = "block";
host.innerHTML = "";
host.appendChild(canvas);
return canvas;
}

function resolveCandle(item = {}) {
const time = item.time || item.bucket_start || item.timestamp || item.open_time || null;
const open = toNumber(item.open);
const high = toNumber(item.high);
const low = toNumber(item.low);
const close = toNumber(item.close);

return {
time,
open,
high,
low,
close,
volumeBase: toNumber(item.volume_base ?? item.volume ?? item.base_volume ?? 0),
volumeToken: toNumber(item.volume_token ?? item.token_volume ?? 0),
buys: toNumber(item.buys ?? 0),
sells: toNumber(item.sells ?? 0),
};
}

function resolveTrade(item = {}) {
return {
time: item.time || item.timestamp || null,
side: String(item.side || "").toLowerCase() === "sell" ? "sell" : "buy",
price: toNumber(item.price ?? item.price_sol ?? item.execution_price ?? 0),
tokenAmount: toNumber(item.token_amount ?? item.amount ?? 0),
baseAmount: toNumber(item.base_amount ?? item.sol_amount ?? item.quote_amount ?? 0),
};
}

function rgba(hexOrRgb, alpha) {
if (hexOrRgb.startsWith("rgba")) return hexOrRgb;
if (hexOrRgb.startsWith("rgb(")) {
return hexOrRgb.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
}
if (hexOrRgb.startsWith("#")) {
const hex = hexOrRgb.slice(1);
const normalized = hex.length === 3
? hex.split("").map((x) => x + x).join("")
: hex;
const int = parseInt(normalized, 16);
const r = (int >> 16) & 255;
const g = (int >> 8) & 255;
const b = int & 255;
return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
return hexOrRgb;
}

export class EliteChartRenderer {
constructor(options = {}) {
this.chartHost = options.chartHost;
this.volumeHost = options.volumeHost;
this.tooltipHost = options.tooltipHost || null;

this.options = { ...DEFAULTS, ...(options.options || {}) };

this.chartCanvas = null;
this.volumeCanvas = null;
this.chartCtx = null;
this.volumeCtx = null;

this.candles = [];
this.trades = [];
this.stats = {};

this.activeIndex = -1;
this.activeInterval = "1m";
this.resizeObserver = null;
this.visibleCandles = [];
this.viewportStart = 0;
this.viewportCount = this.options.maxCandles;
this.isDragging = false;
this.dragStartX = 0;
this.dragStartViewport = 0;

this.lastChartSize = { width: 1, height: 1, dpr: 1 };
this.lastVolumeSize = { width: 1, height: 1, dpr: 1 };
this.lastChartPlot = null;
this.lastVolumePlot = null;
this.lastPriceBounds = null;
this.lastVolumeBounds = null;

this.palette = {
up: "#35f5a3",
down: "#ff5b6b",
grid: "rgba(255,255,255,.06)",
gridStrong: "rgba(255,255,255,.10)",
text: "rgba(255,255,255,.74)",
faint: "rgba(255,255,255,.42)",
line: "rgba(255,255,255,.16)",
crosshair: "rgba(255,255,255,.20)",
lastPrice: "rgba(255,255,255,.92)",
volume: "rgba(255,255,255,.18)",
bgPanel: "rgba(7,11,18,.92)",
white: "#ffffff",
};
}

mount() {
if (!this.chartHost || !this.volumeHost) {
throw new Error("EliteChartRenderer requires chartHost and volumeHost.");
}

this.chartCanvas = createCanvas(this.chartHost, "elite-chart-canvas");
this.volumeCanvas = createCanvas(this.volumeHost, "elite-volume-canvas");

this.chartCtx = this.chartCanvas.getContext("2d");
this.volumeCtx = this.volumeCanvas.getContext("2d");

this.bindEvents();
this.observeResize();
this.draw();
}

destroy() {
this.unbindEvents();

if (this.resizeObserver) {
this.resizeObserver.disconnect();
this.resizeObserver = null;
}

if (this.tooltipHost) {
this.tooltipHost.innerHTML = "";
this.tooltipHost.style.transform = "";
}
}

bindEvents() {
this.handlePointerMove = this.onPointerMove.bind(this);
this.handlePointerLeave = this.onPointerLeave.bind(this);
this.handleWheel = this.onWheel.bind(this);
this.handlePointerDown = this.onPointerDown.bind(this);
this.handlePointerUp = this.onPointerUp.bind(this);
this.handlePointerDrag = this.onPointerDrag.bind(this);
this.handleDblClick = this.onDoubleClick.bind(this);

this.chartCanvas.addEventListener("mousemove", this.handlePointerMove);
this.chartCanvas.addEventListener("mouseleave", this.handlePointerLeave);
this.volumeCanvas.addEventListener("mousemove", this.handlePointerMove);
this.volumeCanvas.addEventListener("mouseleave", this.handlePointerLeave);

this.chartCanvas.addEventListener("wheel", this.handleWheel, { passive: false });
this.volumeCanvas.addEventListener("wheel", this.handleWheel, { passive: false });

this.chartCanvas.addEventListener("mousedown", this.handlePointerDown);
this.volumeCanvas.addEventListener("mousedown", this.handlePointerDown);
window.addEventListener("mouseup", this.handlePointerUp);
window.addEventListener("mousemove", this.handlePointerDrag);

this.chartCanvas.addEventListener("dblclick", this.handleDblClick);
this.volumeCanvas.addEventListener("dblclick", this.handleDblClick);
}

unbindEvents() {
if (!this.chartCanvas || !this.volumeCanvas) return;

this.chartCanvas.removeEventListener("mousemove", this.handlePointerMove);
this.chartCanvas.removeEventListener("mouseleave", this.handlePointerLeave);
this.volumeCanvas.removeEventListener("mousemove", this.handlePointerMove);
this.volumeCanvas.removeEventListener("mouseleave", this.handlePointerLeave);

this.chartCanvas.removeEventListener("wheel", this.handleWheel);
this.volumeCanvas.removeEventListener("wheel", this.handleWheel);

this.chartCanvas.removeEventListener("mousedown", this.handlePointerDown);
this.volumeCanvas.removeEventListener("mousedown", this.handlePointerDown);
window.removeEventListener("mouseup", this.handlePointerUp);
window.removeEventListener("mousemove", this.handlePointerDrag);

this.chartCanvas.removeEventListener("dblclick", this.handleDblClick);
this.volumeCanvas.removeEventListener("dblclick", this.handleDblClick);
}

observeResize() {
if (!window.ResizeObserver) return;

this.resizeObserver = new ResizeObserver(() => this.draw());
this.resizeObserver.observe(this.chartHost);
this.resizeObserver.observe(this.volumeHost);
}

setInterval(interval) {
this.activeInterval = interval || "1m";
this.draw();
}

setData({ candles = [], trades = [], stats = {} } = {}) {
this.candles = candles
.map(resolveCandle)
.filter((c) => c.time && Number.isFinite(new Date(c.time).getTime()) && Number.isFinite(c.close));

this.trades = trades
.map(resolveTrade)
.filter((t) => t.time && Number.isFinite(new Date(t.time).getTime()) && Number.isFinite(t.price));

this.candles.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
this.trades.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

this.stats = stats || {};
this.activeIndex = -1;
this.fitToLatest();
this.draw();
}

updateData(partial = {}) {
if (partial.candles) {
this.candles = partial.candles
.map(resolveCandle)
.filter((c) => c.time && Number.isFinite(new Date(c.time).getTime()) && Number.isFinite(c.close));
this.candles.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

if (partial.trades) {
this.trades = partial.trades
.map(resolveTrade)
.filter((t) => t.time && Number.isFinite(new Date(t.time).getTime()) && Number.isFinite(t.price));
this.trades.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

if (partial.stats) {
this.stats = partial.stats || {};
}

const anchoredToRight = this.viewportStart + this.viewportCount >= this.candles.length - 2;

if (anchoredToRight) {
this.fitToLatest(this.viewportCount);
} else {
this.viewportStart = clamp(
this.viewportStart,
0,
Math.max(0, this.candles.length - this.viewportCount)
);
}

this.draw();
}

fitToLatest(visibleCount = this.options.maxCandles) {
const total = this.candles.length;
const count = clamp(
Math.floor(visibleCount || this.options.maxCandles),
this.options.minVisibleCandles,
this.options.maxVisibleCandles
);

this.viewportCount = Math.min(total || count, count);
this.viewportStart = Math.max(0, total - this.viewportCount);
}

getVisibleCandles() {
if (!this.candles.length) return [];

const start = clamp(this.viewportStart, 0, Math.max(0, this.candles.length - 1));
const count = clamp(
this.viewportCount,
this.options.minVisibleCandles,
this.options.maxVisibleCandles
);

return this.candles.slice(start, start + count);
}

getCandleSlot(plotWidth, candleCount) {
return plotWidth / Math.max(candleCount, 1);
}

getBodyWidth(slot) {
const gap = slot > 18 ? this.options.candleGap : slot > 10 ? 2 : 1;
return Math.max(2, slot - gap);
}

getChartPlotArea(width, height) {
const left = this.options.leftPadding;
const right = Math.max(left + 50, width - this.options.rightAxisWidth);
const top = this.options.topPadding;
const bottom = Math.max(top + 40, height - this.options.bottomPricePadding);

return {
left,
right,
top,
bottom,
width: Math.max(1, right - left),
height: Math.max(1, bottom - top),
};
}

getVolumePlotArea(width, height) {
const left = this.options.leftPadding;
const right = Math.max(left + 50, width - this.options.rightAxisWidth);
const top = 10;
const bottom = Math.max(top + 20, height - this.options.bottomVolumePadding);

return {
left,
right,
top,
bottom,
width: Math.max(1, right - left),
height: Math.max(1, bottom - top),
};
}

priceToY(price, bounds, plot) {
const range = bounds.max - bounds.min || 1;
const pct = (price - bounds.min) / range;
return plot.bottom - plot.height * pct;
}

volumeToY(volume, bounds, plot) {
const range = bounds.max - bounds.min || 1;
const pct = (volume - bounds.min) / range;
return plot.bottom - plot.height * pct;
}

xForIndex(index, plot, candleCount) {
const slot = this.getCandleSlot(plot.width, candleCount);
return plot.left + index * slot + slot / 2;
}

onPointerMove(event) {
if (!this.visibleCandles.length || this.isDragging) return;

const targetCanvas = event.currentTarget === this.volumeCanvas ? this.volumeCanvas : this.chartCanvas;
const rect = targetCanvas.getBoundingClientRect();
const plot = targetCanvas === this.volumeCanvas ? this.lastVolumePlot : this.lastChartPlot;
if (!plot) return;

const x = event.clientX - rect.left;

if (x < plot.left || x > plot.right) {
this.activeIndex = -1;
this.draw();
return;
}

const candleWidth = plot.width / Math.max(this.visibleCandles.length, 1);
const index = clamp(
Math.floor((x - plot.left) / candleWidth),
0,
this.visibleCandles.length - 1
);

this.activeIndex = index;
this.draw();
}

onPointerLeave() {
if (this.isDragging) return;
this.activeIndex = -1;
this.draw();
}

onPointerDown(event) {
if (!this.visibleCandles.length) return;
this.isDragging = true;
this.dragStartX = event.clientX;
this.dragStartViewport = this.viewportStart;
}

onPointerUp() {
this.isDragging = false;
}

onPointerDrag(event) {
if (!this.isDragging || !this.visibleCandles.length || !this.lastChartPlot) return;

const candleWidth = this.lastChartPlot.width / Math.max(this.visibleCandles.length, 1);
if (!candleWidth) return;

const deltaPx = event.clientX - this.dragStartX;
const deltaCandles = Math.round(deltaPx / candleWidth);

this.viewportStart = clamp(
this.dragStartViewport - deltaCandles,
0,
Math.max(0, this.candles.length - this.viewportCount)
);

this.activeIndex = -1;
this.draw();
}

onWheel(event) {
if (!this.candles.length || !this.lastChartPlot) return;
event.preventDefault();

const rect = event.currentTarget.getBoundingClientRect();
const plot = event.currentTarget === this.volumeCanvas ? this.lastVolumePlot : this.lastChartPlot;
if (!plot) return;

const pointerX = clamp(event.clientX - rect.left, plot.left, plot.right);
const pointerRatio = plot.width > 0 ? (pointerX - plot.left) / plot.width : 1;
const centerIndex = this.viewportStart + Math.floor(pointerRatio * this.viewportCount);

const zoomStep = event.deltaY > 0 ? 8 : -8;
const maxVisible = Math.min(this.options.maxVisibleCandles, Math.max(this.candles.length, this.options.minVisibleCandles));
const nextCount = clamp(
this.viewportCount + zoomStep,
this.options.minVisibleCandles,
maxVisible
);

this.viewportCount = nextCount;
this.viewportStart = clamp(
Math.round(centerIndex - pointerRatio * this.viewportCount),
0,
Math.max(0, this.candles.length - this.viewportCount)
);

this.activeIndex = -1;
this.draw();
}

onDoubleClick() {
this.fitToLatest();
this.activeIndex = -1;
this.draw();
}

draw() {
if (!this.chartCanvas || !this.volumeCanvas || !this.chartCtx || !this.volumeCtx) return;

const chartSize = getCanvasSize(this.chartCanvas);
const volumeSize = getCanvasSize(this.volumeCanvas);

this.lastChartSize = chartSize;
this.lastVolumeSize = volumeSize;
this.lastChartPlot = this.getChartPlotArea(chartSize.width, chartSize.height);
this.lastVolumePlot = this.getVolumePlotArea(volumeSize.width, volumeSize.height);

this.chartCtx.setTransform(chartSize.dpr, 0, 0, chartSize.dpr, 0, 0);
this.volumeCtx.setTransform(volumeSize.dpr, 0, 0, volumeSize.dpr, 0, 0);

this.clear(this.chartCtx, chartSize.width, chartSize.height);
this.clear(this.volumeCtx, volumeSize.width, volumeSize.height);

if (!this.candles.length) {
this.drawEmpty(chartSize, volumeSize);
return;
}

const visibleCandles = this.getVisibleCandles();
this.visibleCandles = visibleCandles;

const priceBounds = this.getPriceBounds(visibleCandles);
const volumeBounds = this.getVolumeBounds(visibleCandles);

this.lastPriceBounds = priceBounds;
this.lastVolumeBounds = volumeBounds;

this.drawChartGrid(chartSize);
this.drawVolumeGrid(volumeSize);
this.drawCandles(chartSize, visibleCandles, priceBounds);
this.drawVolumes(volumeSize, visibleCandles, volumeBounds);
this.drawAxes(chartSize, priceBounds);
this.drawXAxis(volumeSize, visibleCandles);
this.drawVolumeAxis(volumeSize, volumeBounds);
this.drawTradeMarkers(chartSize, visibleCandles, priceBounds);
this.drawLastPriceLine(chartSize, visibleCandles, priceBounds);

if (this.activeIndex >= 0 && this.activeIndex < visibleCandles.length) {
this.drawCrosshair(chartSize, volumeSize, visibleCandles, priceBounds, this.activeIndex);
this.drawTooltip(visibleCandles[this.activeIndex], false);
} else {
this.drawTooltip(visibleCandles[visibleCandles.length - 1], true);
}
}

clear(ctx, width, height) {
ctx.clearRect(0, 0, width, height);
}

drawEmpty(chartSize, volumeSize) {
const drawLabel = (ctx, width, height, title, subtitle) => {
ctx.save();
ctx.fillStyle = "rgba(255,255,255,.86)";
ctx.font = "700 20px Inter, system-ui, sans-serif";
ctx.textAlign = "center";
ctx.fillText(title, width / 2, height / 2 - 8);

ctx.fillStyle = "rgba(255,255,255,.55)";
ctx.font = "500 13px Inter, system-ui, sans-serif";
ctx.fillText(subtitle, width / 2, height / 2 + 18);
ctx.restore();
};

drawLabel(
this.chartCtx,
chartSize.width,
chartSize.height,
"Waiting for market data",
"Candles will appear once live trading begins."
);

drawLabel(
this.volumeCtx,
volumeSize.width,
volumeSize.height,
"Volume pending",
"Executed trades will populate this area."
);
}

getPriceBounds(candles) {
let high = -Infinity;
let low = Infinity;

for (const candle of candles) {
high = Math.max(high, candle.high, candle.open, candle.close);
low = Math.min(low, candle.low, candle.open, candle.close);
}

if (!Number.isFinite(high) || !Number.isFinite(low)) {
high = 1;
low = 0;
}

if (high === low) {
high *= 1.02;
low *= 0.98;
}

const range = high - low;
const pad = range * this.options.pricePaddingPct;

return {
min: Math.max(0, low - pad),
max: high + pad,
};
}

getVolumeBounds(candles) {
const max = Math.max(0, ...candles.map((c) => c.volumeBase));
const padded = max * (1 + this.options.volumePaddingPct);

return {
min: 0,
max: padded || 1,
};
}

drawChartGrid(size) {
const ctx = this.chartCtx;
const rows = 5;
const cols = Math.max(4, Math.min(8, Math.floor(this.visibleCandles.length / 24) + 4));
const plot = this.lastChartPlot;

ctx.save();
ctx.strokeStyle = this.palette.grid;
ctx.lineWidth = 1;

for (let i = 0; i <= rows; i += 1) {
const y = Math.round(plot.top + (plot.height / rows) * i) + 0.5;
ctx.beginPath();
ctx.moveTo(plot.left, y);
ctx.lineTo(plot.right, y);
ctx.stroke();
}

for (let i = 0; i <= cols; i += 1) {
const x = Math.round(plot.left + (plot.width / cols) * i) + 0.5;
ctx.beginPath();
ctx.moveTo(x, plot.top);
ctx.lineTo(x, plot.bottom);
ctx.stroke();
}

ctx.restore();
}

drawVolumeGrid(size) {
const ctx = this.volumeCtx;
const plot = this.lastVolumePlot;

ctx.save();
ctx.strokeStyle = "rgba(255,255,255,.05)";
ctx.lineWidth = 1;

const y = Math.round(plot.top + plot.height * 0.5) + 0.5;
ctx.beginPath();
ctx.moveTo(plot.left, y);
ctx.lineTo(plot.right, y);
ctx.stroke();

ctx.restore();
}

drawCandles(size, candles, bounds) {
const ctx = this.chartCtx;
const plot = this.lastChartPlot;
const candleSlot = this.getCandleSlot(plot.width, candles.length);
const bodyWidth = this.getBodyWidth(candleSlot);

ctx.save();

candles.forEach((candle, index) => {
const centerX = this.xForIndex(index, plot, candles.length);
const openY = this.priceToY(candle.open, bounds, plot);
const highY = this.priceToY(candle.high, bounds, plot);
const lowY = this.priceToY(candle.low, bounds, plot);
const closeY = this.priceToY(candle.close, bounds, plot);

const isUp = candle.close >= candle.open;
const color = isUp ? this.palette.up : this.palette.down;

ctx.strokeStyle = color;
ctx.lineWidth = this.options.wickWidth;
ctx.beginPath();
ctx.moveTo(Math.round(centerX) + 0.5, highY);
ctx.lineTo(Math.round(centerX) + 0.5, lowY);
ctx.stroke();

const bodyTop = Math.min(openY, closeY);
const bodyHeight = Math.max(2, Math.abs(closeY - openY));
const bodyLeft = centerX - bodyWidth / 2;

ctx.fillStyle = rgba(color, 0.88);
ctx.fillRect(bodyLeft, bodyTop, bodyWidth, bodyHeight);

ctx.strokeStyle = rgba(color, 1);
ctx.lineWidth = 1;
ctx.strokeRect(
bodyLeft + 0.5,
bodyTop + 0.5,
Math.max(1, bodyWidth - 1),
Math.max(1, bodyHeight - 1)
);

if (this.activeIndex === index) {
ctx.strokeStyle = rgba("#ffffff", 0.18);
ctx.lineWidth = 1;
ctx.strokeRect(bodyLeft - 1.5, bodyTop - 1.5, bodyWidth + 3, bodyHeight + 3);
}
});

ctx.restore();
}

drawVolumes(size, candles, bounds) {
const ctx = this.volumeCtx;
const plot = this.lastVolumePlot;
const slot = this.getCandleSlot(plot.width, candles.length);
const barWidth = this.getBodyWidth(slot);

ctx.save();

candles.forEach((candle, index) => {
const centerX = this.xForIndex(index, plot, candles.length);
const left = centerX - barWidth / 2;
const top = this.volumeToY(candle.volumeBase, bounds, plot);
const barHeight = Math.max(2, plot.bottom - top);
const isUp = candle.close >= candle.open;
const color = isUp ? rgba(this.palette.up, 0.28) : rgba(this.palette.down, 0.28);

ctx.fillStyle = color;
ctx.fillRect(left, top, barWidth, barHeight);
});

ctx.restore();
}

drawAxes(size, bounds) {
const ctx = this.chartCtx;
const plot = this.lastChartPlot;
const levels = 5;

ctx.save();
ctx.fillStyle = this.palette.text;
ctx.font = "500 11px Inter, system-ui, sans-serif";
ctx.textAlign = "right";

for (let i = 0; i < levels; i += 1) {
const pct = i / (levels - 1);
const price = bounds.max - (bounds.max - bounds.min) * pct;
const y = plot.top + plot.height * pct;
ctx.fillText(formatPrice(price), size.width - 8, y + 4);
}

ctx.restore();
}

drawXAxis(size, candles) {
if (!candles.length) return;

const ctx = this.volumeCtx;
const plot = this.lastVolumePlot;
const targetPixelSpacing = 110;
const labelCount = Math.max(2, Math.floor(plot.width / targetPixelSpacing));
const labelsToShow = Math.min(labelCount, candles.length);
if (labelsToShow <= 1) return;

ctx.save();
ctx.fillStyle = this.palette.faint;
ctx.font = "500 10px Inter, system-ui, sans-serif";
ctx.textAlign = "center";

const used = new Set();

for (let i = 0; i < labelsToShow; i += 1) {
const idx = Math.round((i * (candles.length - 1)) / Math.max(labelsToShow - 1, 1));
if (used.has(idx)) continue;
used.add(idx);

const x = this.xForIndex(idx, plot, candles.length);
const label = formatAxisTime(candles[idx]?.time, this.activeInterval);
ctx.fillText(label, x, size.height - 6);
}

ctx.restore();
}

drawVolumeAxis(size, bounds) {
const ctx = this.volumeCtx;

ctx.save();
ctx.fillStyle = this.palette.faint;
ctx.font = "500 11px Inter, system-ui, sans-serif";
ctx.textAlign = "right";

ctx.fillText(formatCompact(bounds.max), size.width - 8, 16);
ctx.fillText("0", size.width - 8, size.height - 28);

ctx.restore();
}

drawLastPriceLine(size, candles, bounds) {
const last = candles[candles.length - 1];
if (!last) return;

const ctx = this.chartCtx;
const plot = this.lastChartPlot;
const y = this.priceToY(last.close, bounds, plot);

ctx.save();
ctx.setLineDash([6, 5]);
ctx.strokeStyle = rgba(this.palette.lastPrice, 0.34);
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(plot.left, y + 0.5);
ctx.lineTo(plot.right, y + 0.5);
ctx.stroke();
ctx.setLineDash([]);

const label = formatPrice(last.close);
ctx.font = "700 11px Inter, system-ui, sans-serif";
const labelWidth = ctx.measureText(label).width + 16;
const x = Math.max(plot.right + 4, size.width - labelWidth - 8);
const h = 22;

ctx.fillStyle = this.palette.bgPanel;
ctx.strokeStyle = rgba(this.palette.lastPrice, 0.24);
ctx.lineWidth = 1;
this.roundRect(ctx, x, y - h / 2, labelWidth, h, 10);
ctx.fill();
ctx.stroke();

ctx.fillStyle = this.palette.white;
ctx.textAlign = "center";
ctx.fillText(label, x + labelWidth / 2, y + 4);

ctx.restore();
}

drawTradeMarkers(size, candles, bounds) {
if (!this.trades.length || !candles.length) return;

const ctx = this.chartCtx;
const plot = this.lastChartPlot;
const candleTimes = candles
.map((c) => new Date(c.time).getTime())
.filter((t) => Number.isFinite(t));

if (!candleTimes.length) return;

const minTime = candleTimes[0];
const maxTime = candleTimes[candleTimes.length - 1] || minTime;
const range = Math.max(1, maxTime - minTime);

ctx.save();

for (const trade of this.trades.slice(-30)) {
const time = new Date(trade.time).getTime();
if (!Number.isFinite(time)) continue;
if (time < minTime || time > maxTime) continue;

const x = plot.left + ((time - minTime) / range) * plot.width;
const y = this.priceToY(trade.price, bounds, plot);
const color = trade.side === "sell" ? this.palette.down : this.palette.up;

ctx.fillStyle = rgba(color, 0.95);
ctx.beginPath();
ctx.arc(x, y, 3, 0, Math.PI * 2);
ctx.fill();

ctx.strokeStyle = rgba("#ffffff", 0.65);
ctx.lineWidth = 1;
ctx.stroke();
}

ctx.restore();
}

drawCrosshair(chartSize, volumeSize, candles, bounds, index) {
const candle = candles[index];
if (!candle) return;

const chartCtx = this.chartCtx;
const volumeCtx = this.volumeCtx;
const plot = this.lastChartPlot;
const volumePlot = this.lastVolumePlot;
const x = this.xForIndex(index, plot, candles.length);
const y = this.priceToY(candle.close, bounds, plot);

chartCtx.save();
chartCtx.strokeStyle = this.palette.crosshair;
chartCtx.lineWidth = 1;
chartCtx.setLineDash([4, 4]);

chartCtx.beginPath();
chartCtx.moveTo(x + 0.5, plot.top);
chartCtx.lineTo(x + 0.5, plot.bottom);
chartCtx.stroke();

chartCtx.beginPath();
chartCtx.moveTo(plot.left, y + 0.5);
chartCtx.lineTo(plot.right, y + 0.5);
chartCtx.stroke();
chartCtx.restore();

volumeCtx.save();
volumeCtx.strokeStyle = this.palette.crosshair;
volumeCtx.lineWidth = 1;
volumeCtx.setLineDash([4, 4]);
volumeCtx.beginPath();
volumeCtx.moveTo(x + 0.5, volumePlot.top);
volumeCtx.lineTo(x + 0.5, volumePlot.bottom);
volumeCtx.stroke();
volumeCtx.restore();
}

drawTooltip(candle, pinned = false) {
if (!this.tooltipHost) return;

if (!candle) {
this.tooltipHost.innerHTML = "";
return;
}

const changePct = candle.open > 0 ? ((candle.close - candle.open) / candle.open) * 100 : 0;
const changeText = `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;

const timeValue = candle.time ? new Date(candle.time) : null;
const timeText =
timeValue && Number.isFinite(timeValue.getTime())
? timeValue.toLocaleString([], {
month: "short",
day: "2-digit",
hour: "2-digit",
minute: "2-digit",
})
: "—";

this.tooltipHost.innerHTML = `
<div class="elite-chart-tooltip-card ${pinned ? "is-pinned" : ""}">
<div class="elite-chart-tooltip-time">${timeText}</div>
<div class="elite-chart-tooltip-grid">
<div><span>Open</span><strong>${formatPrice(candle.open)}</strong></div>
<div><span>High</span><strong>${formatPrice(candle.high)}</strong></div>
<div><span>Low</span><strong>${formatPrice(candle.low)}</strong></div>
<div><span>Close</span><strong>${formatPrice(candle.close)}</strong></div>
<div><span>Volume</span><strong>${formatCompact(candle.volumeBase)}</strong></div>
<div><span>Change</span><strong>${changeText}</strong></div>
</div>
</div>
`;

const hostRect = this.chartHost?.getBoundingClientRect?.();
if (!hostRect) return;

if (pinned || this.activeIndex < 0 || !this.visibleCandles.length || !this.lastChartPlot) {
this.tooltipHost.style.transform = "translate(0px, 0px)";
return;
}

const x = this.xForIndex(this.activeIndex, this.lastChartPlot, this.visibleCandles.length);

const tooltipCard = this.tooltipHost.firstElementChild;
const tooltipWidth = tooltipCard?.getBoundingClientRect?.().width || 220;
const desiredLeft = clamp(
x - tooltipWidth / 2,
10,
Math.max(10, hostRect.width - tooltipWidth - 10)
);

this.tooltipHost.style.transform = `translate(${Math.round(desiredLeft)}px, 0px)`;
}

roundRect(ctx, x, y, width, height, radius) {
const r = Math.min(radius, width / 2, height / 2);
ctx.beginPath();
ctx.moveTo(x + r, y);
ctx.arcTo(x + width, y, x + width, y + height, r);
ctx.arcTo(x + width, y + height, x, y + height, r);
ctx.arcTo(x, y + height, x, y, r);
ctx.arcTo(x, y, x + width, y, r);
ctx.closePath();
}
}

export function createEliteChartRenderer(options = {}) {
const renderer = new EliteChartRenderer(options);
renderer.mount();
return renderer;
}
