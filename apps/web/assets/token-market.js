import { createEliteChartRenderer } from "./chart-renderer.js";

const PHASES = {
COMMIT: "commit",
COUNTDOWN: "countdown",
LIVE: "live",
};

const LINK_TYPES = [
{ key: "website_url", label: "Website", icon: "◉" },
{ key: "x_url", label: "X", icon: "𝕏" },
{ key: "telegram_url", label: "Telegram", icon: "✈" },
{ key: "discord_url", label: "Discord", icon: "◎" },
];

function $(id) {
return document.getElementById(id);
}

function toNumber(value, fallback = 0) {
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function shortAddress(value, left = 6, right = 4) {
if (!value || typeof value !== "string") return "Pending";
if (value.length <= left + right + 3) return value;
return `${value.slice(0, left)}...${value.slice(-right)}`;
}

function escapeHtml(value) {
return String(value ?? "")
.replaceAll("&", "&amp;")
.replaceAll("<", "&lt;")
.replaceAll(">", "&gt;")
.replaceAll('"', "&quot;")
.replaceAll("'", "&#39;");
}

function formatNumber(value, options = {}) {
const num = toNumber(value, 0);
const { minimumFractionDigits = 0, maximumFractionDigits = 2 } = options;

return new Intl.NumberFormat(undefined, {
minimumFractionDigits,
maximumFractionDigits,
}).format(num);
}

function formatCompactNumber(value, options = {}) {
const num = toNumber(value, 0);
const { minimumFractionDigits = 0, maximumFractionDigits = 2 } = options;

return new Intl.NumberFormat(undefined, {
notation: "compact",
minimumFractionDigits,
maximumFractionDigits,
}).format(num);
}

function formatPercent(value, maximumFractionDigits = 2) {
const num = toNumber(value, 0);
return `${formatNumber(num, { maximumFractionDigits })}%`;
}

function formatUsd(value, maximumFractionDigits = 2) {
const num = toNumber(value, 0);
return new Intl.NumberFormat(undefined, {
style: "currency",
currency: "USD",
maximumFractionDigits,
}).format(num);
}

function formatDateTime(value) {
if (!value) return "—";
const d = new Date(value);
if (!Number.isFinite(d.getTime())) return "—";
return d.toLocaleString([], {
month: "short",
day: "2-digit",
hour: "2-digit",
minute: "2-digit",
});
}

function normalizeUrl(raw) {
const value = String(raw || "").trim();
if (!value) return "";
if (/^javascript:/i.test(value) || /^data:/i.test(value)) return "";

let normalized = value;
if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;

try {
const url = new URL(normalized);
if (!["http:", "https:"].includes(url.protocol)) return "";
return url.toString();
} catch {
return "";
}
}

async function copyText(text) {
const value = String(text || "").trim();
if (!value || value === "Pending") return false;

try {
await navigator.clipboard.writeText(value);
return true;
} catch {
try {
const input = document.createElement("textarea");
input.value = value;
input.setAttribute("readonly", "");
input.style.position = "absolute";
input.style.left = "-9999px";
document.body.appendChild(input);
input.select();
const ok = document.execCommand("copy");
document.body.removeChild(input);
return ok;
} catch {
return false;
}
}
}

function setCopiedState(button, originalHtml, copiedText = "Copied") {
if (!button) return;
button.innerHTML = copiedText;
window.setTimeout(() => {
button.innerHTML = originalHtml;
}, 1200);
}

function inferPhase(launch) {
const status = String(launch?.status || "").toLowerCase();
if ([PHASES.COMMIT, PHASES.COUNTDOWN, PHASES.LIVE].includes(status)) return status;

const now = Date.now();
const countdownStart = launch?.countdown_started_at
? new Date(launch.countdown_started_at).getTime()
: null;
const liveAt = launch?.live_at
? new Date(launch.live_at).getTime()
: launch?.countdown_ends_at
? new Date(launch.countdown_ends_at).getTime()
: null;

if (liveAt && now >= liveAt) return PHASES.LIVE;
if (countdownStart && liveAt && now >= countdownStart && now < liveAt) return PHASES.COUNTDOWN;
return PHASES.COMMIT;
}

function getPhaseMeta(phase) {
switch (phase) {
case PHASES.COUNTDOWN:
return {
badgeText: "COUNTDOWN",
statusText: "Trading Countdown",
overlayEyebrow: "TRADING COUNTDOWN",
overlayTitle: "Trading Opens In",
overlayText: "Commit phase closed. Market activation is imminent.",
};
case PHASES.COMMIT:
return {
badgeText: "COMMIT",
statusText: "Commit Phase",
overlayEyebrow: "COMMIT PHASE",
overlayTitle: "Commit Phase In Progress",
overlayText: "Trading is not open yet.",
};
case PHASES.LIVE:
default:
return {
badgeText: "LIVE",
statusText: "Live Trading",
overlayEyebrow: "LIVE MARKET",
overlayTitle: "Live Trading",
overlayText: "Market is active.",
};
}
}

async function fetchJson(url) {
const res = await fetch(url, { credentials: "include" });
if (!res.ok) {
const text = await res.text().catch(() => "");
throw new Error(text || `Request failed (${res.status})`);
}
return res.json();
}

function ensureTooltipHost() {
let el = $("tokenMarketTooltip");
if (el) return el;

const liveLayer = $("tokenMarketLiveLayer");
if (!liveLayer) return null;

el = document.createElement("div");
el.id = "tokenMarketTooltip";
el.style.position = "absolute";
el.style.top = "12px";
el.style.left = "12px";
el.style.zIndex = "3";
el.style.pointerEvents = "none";
liveLayer.appendChild(el);
return el;
}

class TokenMarketController {
constructor(options = {}) {
this.mint = options.mint || "";
this.initialInterval = options.initialInterval || "1m";
this.currentInterval = this.initialInterval;
this.candleLimit = Number(options.candleLimit || 120);
this.tradeLimit = Number(options.tradeLimit || 50);
this.pollMs = Number(options.pollMs || 8000);
this.onLoaded = typeof options.onLoaded === "function" ? options.onLoaded : null;

this.payload = null;
this.phase = PHASES.LIVE;
this.pollTimer = null;
this.countdownTimer = null;
this.chartRenderer = null;

this._boundCopyCa = this.handleCopyCa.bind(this);
this._boundTimeframeClick = this.handleTimeframeClick.bind(this);
}

async init() {
this.bindEvents();
this.mountRenderer();

if (this.mint) {
await this.loadForMint(this.mint);
} else {
this.showEmptyState();
}

return this;
}

destroy() {
this.stopTimers();
this.unbindEvents();
if (this.chartRenderer) {
this.chartRenderer.destroy();
this.chartRenderer = null;
}
}

bindEvents() {
$("tokenMarketCaCopyBtn")?.addEventListener("click", this._boundCopyCa);
document.querySelectorAll(".token-market-timeframe").forEach((btn) => {
btn.addEventListener("click", this._boundTimeframeClick);
});
}

unbindEvents() {
$("tokenMarketCaCopyBtn")?.removeEventListener("click", this._boundCopyCa);
document.querySelectorAll(".token-market-timeframe").forEach((btn) => {
btn.removeEventListener("click", this._boundTimeframeClick);
});
}

stopTimers() {
if (this.pollTimer) {
clearInterval(this.pollTimer);
this.pollTimer = null;
}
if (this.countdownTimer) {
clearInterval(this.countdownTimer);
this.countdownTimer = null;
}
}

mountRenderer() {
const chartHost = $("tokenMarketChartCanvas");
const volumeHost = $("tokenMarketVolumeCanvas");
if (!chartHost || !volumeHost) return;

this.chartRenderer = createEliteChartRenderer({
chartHost,
volumeHost,
tooltipHost: ensureTooltipHost(),
});
this.chartRenderer.setInterval(this.currentInterval);
}

async loadForMint(mint) {
this.mint = mint;
const qs = new URLSearchParams({
interval: this.currentInterval,
candle_limit: String(this.candleLimit),
trade_limit: String(this.tradeLimit),
});

const payload = await fetchJson(
`${window.API_BASE || ""}/api/token-market/${encodeURIComponent(mint)}?${qs.toString()}`
);

this.payload = payload;
this.phase = inferPhase(payload?.launch || {});
this.renderAll();
this.startTimers();

if (this.onLoaded) {
this.onLoaded(payload);
}

return payload;
}

async refresh() {
if (!this.mint) return;
try {
await this.loadForMint(this.mint);
} catch (error) {
console.error("token-market refresh failed:", error);
}
}

startTimers() {
this.stopTimers();

if (this.phase === PHASES.COUNTDOWN) {
this.updateCountdownUi();
this.countdownTimer = setInterval(() => {
this.updateCountdownUi();

const nextPhase = inferPhase(this.payload?.launch || {});
if (nextPhase !== this.phase) {
this.refresh();
}
}, 1000);
}

this.pollTimer = setInterval(() => {
this.refresh();
}, this.phase === PHASES.LIVE ? this.pollMs : 5000);
}

renderAll() {
const launch = this.payload?.launch || {};
const token = this.payload?.token || {};
const chart = this.payload?.chart || {};
const stats = chart?.stats || {};
const candles = chart?.candles || [];
const trades = chart?.trades || [];

this.renderVisibility(true);
this.renderHeader(token, launch);
this.renderPhase();
this.renderLinks(launch);
this.renderStats(stats, launch);
this.renderChart(candles, trades, stats);

if (this.phase === PHASES.COUNTDOWN) {
this.updateCountdownUi();
}
}

renderVisibility(visible) {
const root = $("tokenMarketSection");
if (!root) return;
root.style.display = visible ? "" : "none";
}

renderHeader(token, launch) {
const name = launch?.token_name || token?.name || "Token";
const symbol = launch?.symbol || token?.symbol || "TOKEN";
const ca = String(launch?.contract_address || token?.mint_address || "").trim() || "Pending";

$("tokenMarketName") && ($("tokenMarketName").textContent = name);
$("tokenMarketSymbol") && ($("tokenMarketSymbol").textContent = `$${String(symbol).replace(/^\$/, "")}`);

const caText = $("tokenMarketCaText");
if (caText) caText.textContent = ca === "Pending" ? "Pending" : shortAddress(ca);

const copyBtn = $("tokenMarketCaCopyBtn");
if (copyBtn) copyBtn.dataset.copyValue = ca === "Pending" ? "" : ca;
}

renderPhase() {
const meta = getPhaseMeta(this.phase);
const card = $("tokenMarketCard");
const badge = $("tokenMarketStatusPill");
const dot = $("tokenMarketStatusDot");
const label = $("tokenMarketStatusLabel");
const overlay = $("tokenMarketOverlay");
const eyebrow = $("tokenMarketOverlayEyebrow");
const title = $("tokenMarketOverlayTitle");
const text = $("tokenMarketOverlayText");
const countdownBox = $("tokenMarketCountdownBox");
const liveLayer = $("tokenMarketLiveLayer");
const timeframes = $("tokenMarketTimeframes");

const phaseClasses = ["phase-commit", "phase-countdown", "phase-live"];
[card, badge, dot].forEach((el) => {
if (!el) return;
el.classList.remove(...phaseClasses);
el.classList.add(`phase-${this.phase}`);
});

if (label) label.textContent = meta.statusText;
if (eyebrow) eyebrow.textContent = meta.overlayEyebrow;
if (title) title.textContent = meta.overlayTitle;
if (text) text.textContent = meta.overlayText;

if (countdownBox) countdownBox.classList.toggle("hidden", this.phase !== PHASES.COUNTDOWN);
if (overlay) overlay.classList.toggle("hidden", this.phase === PHASES.LIVE);
if (liveLayer) liveLayer.classList.toggle("hidden", false);
if (timeframes) timeframes.classList.toggle("disabled", this.phase !== PHASES.LIVE);
}

renderLinks(launch) {
const wrap = $("tokenMarketLinks");
if (!wrap) return;

const links = LINK_TYPES.map((item) => {
const url = normalizeUrl(launch?.[item.key]);
return url ? { ...item, url } : null;
}).filter(Boolean);

if (!links.length) {
wrap.innerHTML = `<span class="launch-link-chip" aria-disabled="true">No external links added</span>`;
return;
}

wrap.innerHTML = links.map((item) => `
<a
class="launch-link-chip"
href="${escapeHtml(item.url)}"
target="_blank"
rel="noopener noreferrer"
>
<span>${escapeHtml(item.icon)}</span>
<span>${escapeHtml(item.label)}</span>
</a>
`).join("");
}

renderStats(stats, launch) {
const phase = this.phase;

if (phase === PHASES.COMMIT) {
$("tokenMarketStat1Label").textContent = "Committed";
$("tokenMarketStat1Value").textContent = `${formatNumber(launch?.committed_sol || 0, { maximumFractionDigits: 2 })} SOL`;

$("tokenMarketStat2Label").textContent = "Participants";
$("tokenMarketStat2Value").textContent = formatNumber(launch?.participants_count || launch?.participant_count || 0, { maximumFractionDigits: 0 });

$("tokenMarketStat3Label").textContent = "Hard Cap";
$("tokenMarketStat3Value").textContent = launch?.hard_cap_sol ? `${formatNumber(launch.hard_cap_sol, { maximumFractionDigits: 2 })} SOL` : "—";

const progress = launch?.hard_cap_sol > 0
? ((toNumber(launch.committed_sol, 0) / toNumber(launch.hard_cap_sol, 1)) * 100)
: 0;

$("tokenMarketStat4Label").textContent = "Progress";
$("tokenMarketStat4Value").textContent = formatPercent(progress, 1);
return;
}

if (phase === PHASES.COUNTDOWN) {
$("tokenMarketStat1Label").textContent = "Committed";
$("tokenMarketStat1Value").textContent = `${formatNumber(launch?.committed_sol || 0, { maximumFractionDigits: 2 })} SOL`;

$("tokenMarketStat2Label").textContent = "Participants";
$("tokenMarketStat2Value").textContent = formatNumber(launch?.participants_count || launch?.participant_count || 0, { maximumFractionDigits: 0 });

$("tokenMarketStat3Label").textContent = "Opens At";
$("tokenMarketStat3Value").textContent = formatDateTime(launch?.live_at || launch?.countdown_ends_at);

$("tokenMarketStat4Label").textContent = "Time Left";
$("tokenMarketStat4Value").textContent = this.getCountdownText();
return;
}

$("tokenMarketStat1Label").textContent = "Price";
$("tokenMarketStat1Value").textContent =
toNumber(stats?.last_price, 0) > 0
? formatNumber(stats.last_price, { maximumFractionDigits: 8 })
: "—";

$("tokenMarketStat2Label").textContent = "Change";
$("tokenMarketStat2Value").textContent =
`${toNumber(stats?.price_change_pct, 0) >= 0 ? "+" : ""}${formatPercent(stats?.price_change_pct || 0, 2)}`;

$("tokenMarketStat3Label").textContent = "Liquidity";
$("tokenMarketStat3Value").textContent =
toNumber(stats?.liquidity, 0) > 0 ? formatUsd(stats.liquidity, 0) : "—";

$("tokenMarketStat4Label").textContent = "Market Cap";
$("tokenMarketStat4Value").textContent =
toNumber(stats?.market_cap, 0) > 0 ? formatUsd(stats.market_cap, 0) : "—";

const vol = $("tokenMarketVolumeText");
const trades = $("tokenMarketTradesText");
const highLow = $("tokenMarketHighLowText");

if (vol) {
vol.textContent = `Volume ${toNumber(stats?.volume_24h, 0) > 0 ? formatCompactNumber(stats.volume_24h) : "—"}`;
}
if (trades) {
trades.textContent = `Buys ${formatNumber(stats?.buys_24h || 0, { maximumFractionDigits: 0 })} • Sells ${formatNumber(stats?.sells_24h || 0, { maximumFractionDigits: 0 })}`;
}
if (highLow) {
highLow.textContent = `H ${toNumber(stats?.high_24h, 0) > 0 ? formatNumber(stats.high_24h, { maximumFractionDigits: 8 }) : "—"} • L ${toNumber(stats?.low_24h, 0) > 0 ? formatNumber(stats.low_24h, { maximumFractionDigits: 8 }) : "—"}`;
}
}

renderChart(candles, trades, stats) {
if (!this.chartRenderer) return;

this.chartRenderer.setInterval(this.currentInterval);
this.chartRenderer.setData({
candles: candles || [],
trades: trades || [],
stats: stats || {},
});
}

getCountdownMs() {
const launch = this.payload?.launch || {};
const target = launch?.live_at || launch?.countdown_ends_at;
if (!target) return 0;
const ms = new Date(target).getTime() - Date.now();
return Math.max(0, ms);
}

getCountdownText() {
const diff = this.getCountdownMs();
const minutes = Math.floor(diff / 60000);
const seconds = Math.floor((diff % 60000) / 1000);
return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

updateCountdownUi() {
const el = $("tokenMarketCountdownValue");
if (el) el.textContent = this.getCountdownText();

if (this.phase === PHASES.COUNTDOWN) {
const stat4 = $("tokenMarketStat4Value");
if (stat4) stat4.textContent = this.getCountdownText();
}
}

showEmptyState() {
this.renderVisibility(false);
}

async handleCopyCa(event) {
const button = event.currentTarget;
if (!button) return;

const fullValue = button.dataset.copyValue || "";
const ok = await copyText(fullValue);
if (!ok) return;

const originalHtml = button.innerHTML;
setCopiedState(button, originalHtml);
}

async handleTimeframeClick(event) {
const btn = event.currentTarget;
const wrap = $("tokenMarketTimeframes");
if (!btn || !wrap || wrap.classList.contains("disabled")) return;

document.querySelectorAll(".token-market-timeframe").forEach((el) => {
el.classList.remove("active");
});
btn.classList.add("active");

this.currentInterval = btn.dataset.interval || "1m";

try {
await this.loadForMint(this.mint);
} catch (error) {
console.error("token-market timeframe refresh failed:", error);
}
}
}

export function createTokenMarketController(options = {}) {
return new TokenMarketController(options);
}

export async function initTokenMarket(options = {}) {
const controller = new TokenMarketController(options);
await controller.init();
return controller;
}

window.MSSTokenMarket = {
createTokenMarketController,
initTokenMarket,
};
