import { createEliteChartRenderer } from "./chart-renderer.js";

const PHASES = {
COMMIT: "commit",
COUNTDOWN: "countdown",
LIVE: "live",
};

const EXTERNAL_LINK_TYPES = [
{ key: "website_url", label: "Website", icon: "◉" },
{ key: "x_url", label: "X", icon: "𝕏" },
{ key: "telegram_url", label: "Telegram", icon: "✈" },
{ key: "discord_url", label: "Discord", icon: "◎" },
];

function $(id) {
return document.getElementById(id);
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
const num = Number(value || 0);
const {
minimumFractionDigits = 0,
maximumFractionDigits = 2,
} = options;

return new Intl.NumberFormat(undefined, {
minimumFractionDigits,
maximumFractionDigits,
}).format(num);
}

function formatCompactNumber(value, options = {}) {
const num = Number(value || 0);
const {
minimumFractionDigits = 0,
maximumFractionDigits = 2,
} = options;

return new Intl.NumberFormat(undefined, {
notation: "compact",
minimumFractionDigits,
maximumFractionDigits,
}).format(num);
}

function formatPercent(value, maximumFractionDigits = 2) {
const num = Number(value || 0);
return `${formatNumber(num, { maximumFractionDigits })}%`;
}

function formatSol(value, maximumFractionDigits = 2) {
const num = Number(value || 0);
return `${formatNumber(num, { maximumFractionDigits })} SOL`;
}

function formatUsd(value, maximumFractionDigits = 2) {
const num = Number(value || 0);
return new Intl.NumberFormat(undefined, {
style: "currency",
currency: "USD",
maximumFractionDigits,
}).format(num);
}

function normalizeUrl(raw, typeKey = "") {
const value = String(raw || "").trim();
if (!value) return "";
if (/^javascript:/i.test(value) || /^data:/i.test(value)) return "";

let normalized = value;
if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;

try {
const url = new URL(normalized);
if (!["http:", "https:"].includes(url.protocol)) return "";
const host = url.hostname.toLowerCase();

if (typeKey === "x_url" && !(host.includes("x.com") || host.includes("twitter.com"))) return "";
if (typeKey === "telegram_url" && !(host.includes("t.me") || host.includes("telegram.me"))) return "";
if (typeKey === "discord_url" && !(host.includes("discord.gg") || host.includes("discord.com"))) return "";

return url.toString();
} catch {
return "";
}
}

function parseDateMs(value) {
if (!value) return null;
const ms = new Date(value).getTime();
return Number.isFinite(ms) ? ms : null;
}

function getNowMs() {
return Date.now();
}

function inferPhase(launch) {
const explicit = String(launch?.status || "").toLowerCase();
if ([PHASES.COMMIT, PHASES.COUNTDOWN, PHASES.LIVE].includes(explicit)) {
return explicit;
}

const now = getNowMs();
const countdownStart = parseDateMs(launch?.countdown_start_at);
const tradingOpen = parseDateMs(launch?.trading_open_at);

if (tradingOpen && now >= tradingOpen) return PHASES.LIVE;
if (countdownStart && tradingOpen && now >= countdownStart && now < tradingOpen) {
return PHASES.COUNTDOWN;
}
return PHASES.COMMIT;
}

function getPhaseMeta(phase) {
switch (phase) {
case PHASES.COUNTDOWN:
return {
badgeText: "COUNTDOWN",
statusText: "Trading Countdown",
marketModeText: "Arming",
overlayEyebrow: "TRADING COUNTDOWN",
overlayTitle: "Trading Opens In",
overlayText: "Commit phase closed. Market activation is imminent.",
};
case PHASES.LIVE:
return {
badgeText: "LIVE",
statusText: "Live Trading",
marketModeText: "Active",
overlayEyebrow: "LIVE",
overlayTitle: "Live Trading",
overlayText: "Market is now open.",
};
case PHASES.COMMIT:
default:
return {
badgeText: "COMMIT",
statusText: "Commit Phase",
marketModeText: "Pre-Live",
overlayEyebrow: "COMMIT PHASE",
overlayTitle: "Commit Phase In Progress",
overlayText: "Trading is not open yet. Commitments are being collected before market activation.",
};
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

function setButtonCopiedState(button, originalHtml, copiedText = "Copied") {
if (!button) return;
button.innerHTML = copiedText;
window.setTimeout(() => {
button.innerHTML = originalHtml;
}, 1200);
}

function updatePhaseClasses(phase) {
const marketCard = $("marketCard");
const launchPhaseBadge = $("launchPhaseBadge");
const marketStatusPill = $("marketStatusPill");
const marketStatusDot = $("marketStatusDot");

const phaseClasses = ["phase-commit", "phase-countdown", "phase-live"];

for (const el of [marketCard, launchPhaseBadge, marketStatusPill, marketStatusDot]) {
if (!el) continue;
el.classList.remove(...phaseClasses);
el.classList.add(`phase-${phase}`);
}
}

function updatePhaseContent(phase) {
const meta = getPhaseMeta(phase);

const launchPhaseBadgeText = $("launchPhaseBadgeText");
const launchStatusText = $("launchStatusText");
const launchMarketModeText = $("launchMarketModeText");
const marketStatusLabel = $("marketStatusLabel");
const marketOverlayEyebrow = $("marketOverlayEyebrow");
const marketOverlayTitle = $("marketOverlayTitle");
const marketOverlayText = $("marketOverlayText");

if (launchPhaseBadgeText) launchPhaseBadgeText.textContent = meta.badgeText;
if (launchStatusText) launchStatusText.textContent = meta.statusText;
if (launchMarketModeText) launchMarketModeText.textContent = meta.marketModeText;
if (marketStatusLabel) marketStatusLabel.textContent = meta.statusText;
if (marketOverlayEyebrow) marketOverlayEyebrow.textContent = meta.overlayEyebrow;
if (marketOverlayTitle) marketOverlayTitle.textContent = meta.overlayTitle;
if (marketOverlayText) marketOverlayText.textContent = meta.overlayText;

const marketTimeframes = $("marketTimeframes");
const marketLiveLayer = $("marketLiveLayer");
const marketCountdownBox = $("marketCountdownBox");
const marketOverlay = $("marketOverlay");

if (marketTimeframes) {
marketTimeframes.classList.toggle("disabled", phase !== PHASES.LIVE);
}

if (marketLiveLayer) {
marketLiveLayer.classList.toggle("hidden", phase !== PHASES.LIVE);
}

if (marketCountdownBox) {
marketCountdownBox.classList.toggle("hidden", phase !== PHASES.COUNTDOWN);
}

if (marketOverlay) {
marketOverlay.classList.remove("overlay-commit", "overlay-countdown", "overlay-live");
marketOverlay.classList.add(`overlay-${phase}`);
}
}

function updateTokenIdentity(launch) {
const launchTokenName = $("launchTokenName");
const launchTokenSymbol = $("launchTokenSymbol");
const launchBuilderWalletShort = $("launchBuilderWalletShort");
const launchTokenLogo = $("launchTokenLogo");

if (launchTokenName) launchTokenName.textContent = launch?.name || "Token Name";

if (launchTokenSymbol) {
const symbol = String(launch?.symbol || "TOKEN").replace(/^\$/, "");
launchTokenSymbol.textContent = `$${symbol}`;
}

if (launchBuilderWalletShort) {
const builderShort = shortAddress(launch?.builder_wallet || "");
launchBuilderWalletShort.textContent = builderShort || "Pending";
}

if (launchTokenLogo) {
const symbol = String(launch?.symbol || "M").trim();
launchTokenLogo.textContent = (symbol[0] || "M").toUpperCase();
}
}

function updateContractAddress(launch) {
const ca = String(launch?.contract_address || "").trim() || "Pending";
const short = ca === "Pending" ? "Pending" : shortAddress(ca);

const launchCaText = $("launchCaText");
const chartCaChipText = $("chartCaChipText");
const launchCaState = $("launchCaState");

if (launchCaText) launchCaText.textContent = short;
if (chartCaChipText) chartCaChipText.textContent = short;
if (launchCaState) launchCaState.textContent = ca === "Pending" ? "Pending" : "Ready";

const launchCaCopyBtn = $("launchCaCopyBtn");
const chartCaCopyBtn = $("chartCaCopyBtn");

if (launchCaCopyBtn) launchCaCopyBtn.dataset.copyValue = ca === "Pending" ? "" : ca;
if (chartCaCopyBtn) chartCaCopyBtn.dataset.copyValue = ca === "Pending" ? "" : ca;
}

function renderExternalLinks(launch) {
const launchExternalLinks = $("launchExternalLinks");
if (!launchExternalLinks) return;

const links = [];

for (const item of EXTERNAL_LINK_TYPES) {
const normalized = normalizeUrl(launch?.[item.key], item.key);
if (!normalized) continue;

links.push({
label: item.label,
icon: item.icon,
url: normalized,
});
}

if (!links.length) {
launchExternalLinks.innerHTML = `<span class="launch-link-chip" aria-disabled="true">No external links added</span>`;
return;
}

launchExternalLinks.innerHTML = links
.map(
(item) => `
<a
class="launch-link-chip"
href="${escapeHtml(item.url)}"
target="_blank"
rel="noopener noreferrer"
>
<span>${escapeHtml(item.icon)}</span>
<span>${escapeHtml(item.label)}</span>
</a>
`
)
.join("");
}

function updateStatsForCommit(launch) {
const committedSol = Number(launch?.committed_sol ?? launch?.commit_total_sol ?? 0) || 0;
const participantCount = Number(launch?.participant_count ?? launch?.participants ?? 0) || 0;
const hardCapSol = Number(launch?.hard_cap_sol ?? launch?.hard_cap ?? 0) || 0;
const progress = hardCapSol > 0 ? Math.min(100, (committedSol / hardCapSol) * 100) : 0;

$("stat1Label").textContent = "Committed";
$("stat1Value").textContent = formatSol(committedSol, 2);

$("stat2Label").textContent = "Participants";
$("stat2Value").textContent = formatNumber(participantCount, { maximumFractionDigits: 0 });

$("stat3Label").textContent = "Hard Cap";
$("stat3Value").textContent = hardCapSol > 0 ? formatSol(hardCapSol, 2) : "—";

$("stat4Label").textContent = "Progress";
$("stat4Value").textContent = formatPercent(progress, 1);
}

function updateStatsForCountdown(launch) {
const committedSol = Number(launch?.committed_sol ?? launch?.commit_total_sol ?? 0) || 0;
const participantCount = Number(launch?.participant_count ?? launch?.participants ?? 0) || 0;

const openAtMs = parseDateMs(launch?.trading_open_at);
const openAtText = openAtMs
? new Date(openAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
: "Pending";

const remaining = getCountdownParts(launch);
const remainingText = remaining.totalMs > 0
? `${String(remaining.minutes).padStart(2, "0")}:${String(remaining.seconds).padStart(2, "0")}`
: "00:00";

$("stat1Label").textContent = "Committed";
$("stat1Value").textContent = formatSol(committedSol, 2);

$("stat2Label").textContent = "Participants";
$("stat2Value").textContent = formatNumber(participantCount, { maximumFractionDigits: 0 });

$("stat3Label").textContent = "Opens At";
$("stat3Value").textContent = openAtText;

$("stat4Label").textContent = "Time Left";
$("stat4Value").textContent = remainingText;
}

function updateStatsForLive(stats = {}) {
const lastPrice = Number(stats?.last_price ?? stats?.price ?? 0) || 0;
const priceChangePct = Number(stats?.price_change_pct ?? stats?.change_pct ?? 0) || 0;
const liquidity = Number(stats?.liquidity ?? stats?.liquidity_usd ?? 0) || 0;
const marketCap = Number(stats?.market_cap ?? stats?.marketcap ?? stats?.fdv ?? 0) || 0;

$("stat1Label").textContent = "Price";
$("stat1Value").textContent = lastPrice > 0 ? formatNumber(lastPrice, { maximumFractionDigits: 8 }) : "—";

$("stat2Label").textContent = "Change";
$("stat2Value").textContent = `${priceChangePct >= 0 ? "+" : ""}${formatPercent(priceChangePct, 2)}`;

$("stat3Label").textContent = "Liquidity";
$("stat3Value").textContent = liquidity > 0 ? formatUsd(liquidity, 0) : "—";

$("stat4Label").textContent = "Market Cap";
$("stat4Value").textContent = marketCap > 0 ? formatUsd(marketCap, 0) : "—";
}

function getCountdownParts(launch) {
const tradingOpenMs = parseDateMs(launch?.trading_open_at);
if (!tradingOpenMs) return { totalMs: 0, minutes: 0, seconds: 0 };

const diff = Math.max(0, tradingOpenMs - getNowMs());
const minutes = Math.floor(diff / 60000);
const seconds = Math.floor((diff % 60000) / 1000);

return { totalMs: diff, minutes, seconds };
}

function updateCountdownUi(launch) {
const marketCountdownValue = $("marketCountdownValue");
if (!marketCountdownValue) return;

const { minutes, seconds } = getCountdownParts(launch);
marketCountdownValue.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function setManageLinksVisibility(launch, connectedWallet) {
const button = $("manageLaunchLinksBtn");
if (!button) return;

const builderWallet = String(launch?.builder_wallet || "").trim().toLowerCase();
const wallet = String(connectedWallet || "").trim().toLowerCase();
const canManage = Boolean(builderWallet && wallet && builderWallet === wallet);

button.classList.toggle("hidden", !canManage);
}

function fillLinksModal(launch) {
$("linkWebsiteInput").value = launch?.website_url || "";
$("linkXInput").value = launch?.x_url || "";
$("linkTelegramInput").value = launch?.telegram_url || "";
$("linkDiscordInput").value = launch?.discord_url || "";
}

function getLinksPayloadFromModal() {
return {
website_url: normalizeUrl($("linkWebsiteInput")?.value || "", "website_url"),
x_url: normalizeUrl($("linkXInput")?.value || "", "x_url"),
telegram_url: normalizeUrl($("linkTelegramInput")?.value || "", "telegram_url"),
discord_url: normalizeUrl($("linkDiscordInput")?.value || "", "discord_url"),
};
}

function openLinksModal() {
$("launchLinksModal")?.classList.remove("hidden");
}

function closeLinksModal() {
$("launchLinksModal")?.classList.add("hidden");
}

async function fetchJson(url, options = {}) {
const response = await fetch(url, { credentials: "include", ...options });
if (!response.ok) {
const text = await response.text().catch(() => "");
throw new Error(text || `Request failed (${response.status})`);
}
return response.json();
}

async function defaultFetchLaunch(launchId) {
return fetchJson(`/api/launcher/${encodeURIComponent(launchId)}`);
}

async function defaultFetchChartStats(launchId) {
try {
return await fetchJson(`/api/chart/${encodeURIComponent(launchId)}/stats`);
} catch {
return {};
}
}

async function defaultFetchChartCandles(launchId, interval = "1m", limit = 120) {
try {
return await fetchJson(
`/api/chart/${encodeURIComponent(launchId)}/candles?interval=${encodeURIComponent(interval)}&limit=${encodeURIComponent(limit)}`
);
} catch {
return { candles: [] };
}
}

async function defaultFetchChartTrades(launchId, limit = 50) {
try {
return await fetchJson(
`/api/chart/${encodeURIComponent(launchId)}/trades?limit=${encodeURIComponent(limit)}`
);
} catch {
return { trades: [] };
}
}

async function defaultFetchChartSnapshot(launchId, interval = "1m", candleLimit = 120, tradeLimit = 50) {
const [statsPayload, candlesPayload, tradesPayload] = await Promise.all([
defaultFetchChartStats(launchId),
defaultFetchChartCandles(launchId, interval, candleLimit),
defaultFetchChartTrades(launchId, tradeLimit),
]);

return {
stats: statsPayload?.stats || statsPayload || {},
candles: candlesPayload?.candles || candlesPayload?.data || [],
trades: tradesPayload?.trades || tradesPayload?.data || [],
};
}

async function defaultSaveLinks(launchId, payload) {
return fetchJson(`/api/launcher/${encodeURIComponent(launchId)}/links`, {
method: "PATCH",
headers: { "Content-Type": "application/json" },
body: JSON.stringify(payload),
});
}

class LaunchMarketController {
constructor(options = {}) {
this.launchId = options.launchId || "";
this.connectedWallet = options.connectedWallet || "";
this.fetchLaunch = options.fetchLaunch || defaultFetchLaunch;
this.fetchChartStats = options.fetchChartStats || defaultFetchChartStats;
this.fetchChartCandles = options.fetchChartCandles || defaultFetchChartCandles;
this.fetchChartTrades = options.fetchChartTrades || defaultFetchChartTrades;
this.fetchChartSnapshot = options.fetchChartSnapshot || defaultFetchChartSnapshot;
this.saveLinks = options.saveLinks || defaultSaveLinks;
this.onPhaseChange = typeof options.onPhaseChange === "function" ? options.onPhaseChange : null;

this.launch = options.launch || null;
this.stats = options.stats || {};
this.candles = [];
this.trades = [];
this.phase = PHASES.COMMIT;
this.currentInterval = options.initialInterval || "1m";
this.candleLimit = Number(options.candleLimit || 120);
this.tradeLimit = Number(options.tradeLimit || 50);

this.commitPollMs = Number(options.commitPollMs || 15000);
this.countdownPollMs = Number(options.countdownPollMs || 5000);
this.livePollMs = Number(options.livePollMs || 8000);

this.refreshTimer = null;
this.countdownTimer = null;
this.chartRenderer = null;

this._boundHandleManageLinksClick = this.handleManageLinksClick.bind(this);
this._boundHandleSaveLinksClick = this.handleSaveLinksClick.bind(this);
this._boundHandleCloseLinksClick = this.handleCloseLinksClick.bind(this);
this._boundHandleBackdropClick = this.handleBackdropClick.bind(this);
this._boundHandleCaCopy = this.handleCaCopy.bind(this);
this._boundHandleTimeframeClick = this.handleTimeframeClick.bind(this);
}

async init() {
this.bindEvents();
this.mountChartRenderer();

if (!this.launch && this.launchId) {
await this.refreshLaunch();
} else {
this.applyAll();
}

this.startPollingLoop();
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

mountChartRenderer() {
const chartHost = $("marketChartCanvas");
const volumeHost = $("marketVolumeCanvas");

if (!chartHost || !volumeHost) return;

const tooltipHost = document.createElement("div");
tooltipHost.id = "eliteChartTooltip";
tooltipHost.style.position = "absolute";
tooltipHost.style.top = "12px";
tooltipHost.style.left = "12px";
tooltipHost.style.zIndex = "3";
tooltipHost.style.pointerEvents = "none";
chartHost.parentNode?.appendChild(tooltipHost);

this.chartRenderer = createEliteChartRenderer({
chartHost,
volumeHost,
tooltipHost,
});
}

bindEvents() {
$("manageLaunchLinksBtn")?.addEventListener("click", this._boundHandleManageLinksClick);
$("saveLaunchLinksBtn")?.addEventListener("click", this._boundHandleSaveLinksClick);
$("closeLaunchLinksModalBtn")?.addEventListener("click", this._boundHandleCloseLinksClick);
$("launchLinksModal")?.addEventListener("click", this._boundHandleBackdropClick);

$("launchCaCopyBtn")?.addEventListener("click", this._boundHandleCaCopy);
$("chartCaCopyBtn")?.addEventListener("click", this._boundHandleCaCopy);

document.querySelectorAll(".market-timeframe").forEach((btn) => {
btn.addEventListener("click", this._boundHandleTimeframeClick);
});
}

unbindEvents() {
$("manageLaunchLinksBtn")?.removeEventListener("click", this._boundHandleManageLinksClick);
$("saveLaunchLinksBtn")?.removeEventListener("click", this._boundHandleSaveLinksClick);
$("closeLaunchLinksModalBtn")?.removeEventListener("click", this._boundHandleCloseLinksClick);
$("launchLinksModal")?.removeEventListener("click", this._boundHandleBackdropClick);

$("launchCaCopyBtn")?.removeEventListener("click", this._boundHandleCaCopy);
$("chartCaCopyBtn")?.removeEventListener("click", this._boundHandleCaCopy);

document.querySelectorAll(".market-timeframe").forEach((btn) => {
btn.removeEventListener("click", this._boundHandleTimeframeClick);
});
}

stopTimers() {
if (this.refreshTimer) {
clearInterval(this.refreshTimer);
this.refreshTimer = null;
}
if (this.countdownTimer) {
clearInterval(this.countdownTimer);
this.countdownTimer = null;
}
}

startPollingLoop() {
this.stopTimers();

const refreshEvery = this.phase === PHASES.COMMIT
? this.commitPollMs
: this.phase === PHASES.COUNTDOWN
? this.countdownPollMs
: this.livePollMs;

this.refreshTimer = setInterval(async () => {
try {
await this.refreshLaunch();
} catch (error) {
console.error("launch-market refresh failed:", error);
}
}, refreshEvery);

if (this.phase === PHASES.COUNTDOWN) {
this.startCountdownTicker();
}
}

startCountdownTicker() {
if (this.countdownTimer) clearInterval(this.countdownTimer);

updateCountdownUi(this.launch);

this.countdownTimer = setInterval(async () => {
updateCountdownUi(this.launch);
const nextPhase = inferPhase(this.launch);
if (nextPhase !== this.phase) {
await this.refreshLaunch();
}
}, 1000);
}

async loadLiveChartData() {
if (!this.launchId) return;

const payload = await this.fetchChartSnapshot(
this.launchId,
this.currentInterval,
this.candleLimit,
this.tradeLimit
);

this.stats = payload?.stats || {};
this.candles = payload?.candles || [];
this.trades = payload?.trades || [];

if (this.chartRenderer) {
this.chartRenderer.setInterval(this.currentInterval);
this.chartRenderer.setData({
candles: this.candles,
trades: this.trades,
stats: this.stats,
});
}
}

async refreshLiveChartDataOnly() {
if (!this.launchId || this.phase !== PHASES.LIVE) return;

const payload = await this.fetchChartSnapshot(
this.launchId,
this.currentInterval,
this.candleLimit,
this.tradeLimit
);

this.stats = payload?.stats || {};
this.candles = payload?.candles || [];
this.trades = payload?.trades || [];

updateStatsForLive(this.stats);

if (this.chartRenderer) {
this.chartRenderer.updateData({
candles: this.candles,
trades: this.trades,
stats: this.stats,
});
}
}

async refreshLaunch() {
if (!this.launchId) return;

const payload = await this.fetchLaunch(this.launchId);
this.launch = payload?.launch || payload;

const previousPhase = this.phase;
this.phase = inferPhase(this.launch);

if (this.phase === PHASES.LIVE) {
await this.loadLiveChartData();
}

this.applyAll();

if (previousPhase !== this.phase) {
this.startPollingLoop();
}
}

applyAll() {
if (!this.launch) return;

const previousPhase = this.phase;
this.phase = inferPhase(this.launch);

updateTokenIdentity(this.launch);
updateContractAddress(this.launch);
renderExternalLinks(this.launch);
setManageLinksVisibility(this.launch, this.connectedWallet);
updatePhaseClasses(this.phase);
updatePhaseContent(this.phase);

if (this.phase === PHASES.COMMIT) {
updateStatsForCommit(this.launch);
} else if (this.phase === PHASES.COUNTDOWN) {
updateStatsForCountdown(this.launch);
updateCountdownUi(this.launch);
} else {
updateStatsForLive(this.stats);
if (this.chartRenderer) {
this.chartRenderer.setInterval(this.currentInterval);
this.chartRenderer.setData({
candles: this.candles,
trades: this.trades,
stats: this.stats,
});
}
}

if (previousPhase !== this.phase && this.onPhaseChange) {
this.onPhaseChange(this.phase, this.launch, this.stats);
}
}

setConnectedWallet(wallet) {
this.connectedWallet = wallet || "";
if (this.launch) setManageLinksVisibility(this.launch, this.connectedWallet);
}

async handleManageLinksClick() {
if (!this.launch) return;
fillLinksModal(this.launch);
openLinksModal();
}

handleCloseLinksClick() {
closeLinksModal();
}

handleBackdropClick(event) {
const modal = $("launchLinksModal");
if (!modal || modal.classList.contains("hidden")) return;

if (event.target === modal || event.target.classList.contains("launch-links-modal-backdrop")) {
closeLinksModal();
}
}

async handleSaveLinksClick() {
const saveBtn = $("saveLaunchLinksBtn");
if (!saveBtn || !this.launchId) return;

const originalText = saveBtn.textContent;
saveBtn.disabled = true;
saveBtn.textContent = "Saving...";

try {
const payload = getLinksPayloadFromModal();
const result = await this.saveLinks(this.launchId, payload);
this.launch = result?.launch || { ...this.launch, ...payload };
renderExternalLinks(this.launch);
closeLinksModal();
} catch (error) {
console.error("save links failed:", error);
alert(error?.message || "Failed to save links.");
} finally {
saveBtn.disabled = false;
saveBtn.textContent = originalText;
}
}

async handleCaCopy(event) {
const button = event.currentTarget;
if (!button) return;

const fullValue = button.dataset.copyValue || "";
const ok = await copyText(fullValue);
if (!ok) return;

const originalHtml = button.innerHTML;
setButtonCopiedState(button, originalHtml);
}

async handleTimeframeClick(event) {
const btn = event.currentTarget;
const timeframesWrap = $("marketTimeframes");
if (!btn || !timeframesWrap || timeframesWrap.classList.contains("disabled")) return;

document.querySelectorAll(".market-timeframe").forEach((el) => {
el.classList.remove("active");
});
btn.classList.add("active");

this.currentInterval = btn.dataset.interval || "1m";

if (this.chartRenderer) {
this.chartRenderer.setInterval(this.currentInterval);
}

if (this.phase === PHASES.LIVE) {
try {
await this.loadLiveChartData();
updateStatsForLive(this.stats);
} catch (error) {
console.error("timeframe refresh failed:", error);
}
}
}
}

export function createLaunchMarketController(options = {}) {
return new LaunchMarketController(options);
}

export async function initLaunchMarket(options = {}) {
const controller = new LaunchMarketController(options);
await controller.init();
return controller;
}

window.MSSLaunchMarket = {
createLaunchMarketController,
initLaunchMarket,
};
