import { createEliteChartRenderer } from "../assets/chart-renderer.js";

const PHASES = {
COMMIT: "commit",
COUNTDOWN: "countdown",
LIVE: "live",
};

const TRADE_MODES = {
BUY: "buy",
SELL: "sell",
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

function getApiBase() {
const { protocol, hostname, port } = window.location;

if (port === "3000") {
return `${protocol}//${hostname}:8787`;
}

if (hostname.includes("-3000.app.github.dev")) {
return `${protocol}//${hostname.replace("-3000.app.github.dev", "-8787.app.github.dev")}`;
}

return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
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
const {
minimumFractionDigits = 0,
maximumFractionDigits = 2,
} = options;

return new Intl.NumberFormat(undefined, {
minimumFractionDigits,
maximumFractionDigits,
}).format(num);
}

function formatPercent(value, maximumFractionDigits = 2) {
const num = toNumber(value, 0);
return `${formatNumber(num, { maximumFractionDigits })}%`;
}

function formatSol(value, maximumFractionDigits = 4) {
const num = toNumber(value, 0);
return `${formatNumber(num, { maximumFractionDigits })} SOL`;
}

function formatUsd(value, maximumFractionDigits = 2) {
const num = toNumber(value, 0);
return new Intl.NumberFormat(undefined, {
style: "currency",
currency: "USD",
minimumFractionDigits: 0,
maximumFractionDigits,
}).format(num);
}

function formatUsdCompact(value, maximumFractionDigits = 2) {
const num = toNumber(value, 0);
if (num <= 0) return "$0";
return new Intl.NumberFormat(undefined, {
style: "currency",
currency: "USD",
notation: "compact",
minimumFractionDigits: 0,
maximumFractionDigits,
}).format(num);
}

function formatPriceSol(value) {
const num = toNumber(value, 0);
if (num <= 0) return "—";
if (num >= 1) return formatNumber(num, { maximumFractionDigits: 4 });
if (num >= 0.01) return formatNumber(num, { maximumFractionDigits: 6 });
return formatNumber(num, { maximumFractionDigits: 10 });
}

function formatPriceUsd(value) {
const num = toNumber(value, 0);
if (num <= 0) return "—";
if (num >= 1) return formatUsd(num, 4);
if (num >= 0.01) return formatUsd(num, 6);
return formatUsd(num, 8);
}

function formatTokenAmount(value, maximumFractionDigits = 0) {
const num = toNumber(value, 0);
return formatNumber(num, { maximumFractionDigits });
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

function formatDualMetric(primaryValue, secondaryValue) {
if (!primaryValue && !secondaryValue) return "—";
if (!secondaryValue) return primaryValue || "—";
return `${primaryValue}\n${secondaryValue}`;
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
const raw = String(value).trim();
if (!raw) return null;

const hasExplicitTimezone =
/z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw);

if (!hasExplicitTimezone && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
const sqliteUtc = Date.parse(raw.replace(" ", "T") + "Z");
return Number.isFinite(sqliteUtc) ? sqliteUtc : null;
}

const direct = Date.parse(raw);
return Number.isFinite(direct) ? direct : null;
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
const countdownStart = parseDateMs(launch?.countdown_started_at);
const tradingOpen = parseDateMs(launch?.live_at || launch?.countdown_ends_at);

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
overlayText: "",
overlaySubtext: "Market activation is imminent.",
};
case PHASES.LIVE:
return {
badgeText: "LIVE",
statusText: "Live Trading",
marketModeText: "Active",
overlayEyebrow: "LIVE MARKET",
overlayTitle: "Live Trading",
overlayText: "Market is now open.",
overlaySubtext: "",
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
overlaySubtext: "",
};
}
}

function getCassieMeta(phase, launch = {}, tokenPayload = {}, chartStats = {}) {
const cassie = tokenPayload?.cassie || {};
const priceChangePct = toNumber(chartStats?.price_change_pct, 0);
const buys24h = toNumber(chartStats?.buys_24h, 0);
const sells24h = toNumber(chartStats?.sells_24h, 0);
const builderWallet = String(launch?.builder_wallet || "").trim();
const builderScore = toNumber(launch?.builder_score, 0);

let state = cassie?.monitoring_active ? "Monitoring" : "Standby";
let badge = "LIVE INTELLIGENCE";
let riskState = "Watching";
let builderSignal = builderWallet ? "Linked" : "Pending";
let structureSignal = "Reviewing";
let marketSignal = "Standby";
let note =
"CassIE is attached to this launch and continuously surfaces builder, structure, and live market intelligence as the lifecycle progresses.";

if (builderScore >= 80) {
builderSignal = "Strong";
} else if (builderScore >= 55) {
builderSignal = "Moderate";
} else if (builderWallet) {
builderSignal = "Early";
}

if (phase === PHASES.COMMIT) {
state = cassie?.monitoring_active ? "Monitoring" : "Standby";
badge = "STRUCTURE WATCH";
riskState = "Watching";
structureSignal = "Commit Review";
marketSignal = "Pre-Live";
note =
"CassIE is monitoring builder-linked signals, launch structure, wallet concentration, and commit integrity before market activation.";
} else if (phase === PHASES.COUNTDOWN) {
state = "Monitoring";
badge = "OPENING WATCH";
riskState = "Elevated";
structureSignal = "Countdown Armed";
marketSignal = "Opening Soon";
note =
"CassIE is tracking countdown integrity, final participation posture, and opening conditions before live trading begins.";
} else if (phase === PHASES.LIVE) {
state = cassie?.monitoring_active ? "Monitoring" : "Live";
badge = "LIVE INTELLIGENCE";

const elevatedFlow =
Math.abs(priceChangePct) >= 25 || Math.abs(buys24h - sells24h) >= 10;

riskState = elevatedFlow ? "Elevated" : "Normal";
structureSignal = "Live";
marketSignal = elevatedFlow ? "Active Flow" : "Balanced";

note = elevatedFlow
? "CassIE has detected elevated live market activity. Review price movement, flow imbalance, and execution details before confirming."
: "CassIE is actively monitoring live flow, price behaviour, and structure changes as this market trades.";
}

return {
state,
badge,
riskState,
builderSignal,
structureSignal,
marketSignal,
note,
};
}

function renderCassiePanel(phase, launch = {}, tokenPayload = {}, chartStats = {}) {
const stateEl = $("cassieState");
const badgeEl = $("cassieBadgeText");
const riskEl = $("cassieRiskState");
const builderEl = $("cassieBuilderSignal");
const structureEl = $("cassieStructureSignal");
const marketEl = $("cassieMarketSignal");
const noteEl = $("cassieNote");

if (!stateEl && !badgeEl && !riskEl && !builderEl && !structureEl && !marketEl && !noteEl) {
return;
}

const cassieMeta = getCassieMeta(phase, launch, tokenPayload, chartStats);

if (stateEl) stateEl.textContent = cassieMeta.state;
if (badgeEl) badgeEl.textContent = cassieMeta.badge;
if (riskEl) riskEl.textContent = cassieMeta.riskState;
if (builderEl) builderEl.textContent = cassieMeta.builderSignal;
if (structureEl) structureEl.textContent = cassieMeta.structureSignal;
if (marketEl) marketEl.textContent = cassieMeta.marketSignal;
if (noteEl) noteEl.textContent = cassieMeta.note;
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
const launchStatusText = $("launchStatusText2");
const launchMarketModeText = $("launchMarketModeText");
const marketStatusLabel = $("marketStatusLabel");
const marketOverlayEyebrow = $("marketOverlayEyebrow");
const marketOverlayTitle = $("marketOverlayTitle");
const marketOverlayText = $("marketOverlayText");
const marketCountdownSubtext = document.querySelector(".market-countdown-subtext");

if (launchPhaseBadgeText) launchPhaseBadgeText.textContent = meta.badgeText;
if (launchStatusText) launchStatusText.textContent = meta.statusText;
if (launchMarketModeText) launchMarketModeText.textContent = meta.marketModeText;
if (marketStatusLabel) marketStatusLabel.textContent = meta.statusText;
if (marketOverlayEyebrow) marketOverlayEyebrow.textContent = meta.overlayEyebrow;
if (marketOverlayTitle) marketOverlayTitle.textContent = meta.overlayTitle;
if (marketOverlayText) {
marketOverlayText.textContent = meta.overlayText;
marketOverlayText.classList.toggle("hidden", !meta.overlayText);
}
if (marketCountdownSubtext) {
marketCountdownSubtext.textContent = meta.overlaySubtext || "Market activation is imminent.";
}

const marketTimeframes = $("marketTimeframes");
const marketLiveLayer = $("marketLiveLayer");
const marketCountdownBox = $("marketCountdownBox");
const marketOverlay = $("marketOverlay");
const accessMode = $("launchAccessModeText");

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
marketOverlay.classList.toggle("hidden", phase === PHASES.LIVE);
}

if (accessMode) {
accessMode.textContent = phase === PHASES.LIVE ? "Live Access" : phase === PHASES.COUNTDOWN ? "Countdown Locked" : "Pre-Live";
}
}

function updateTokenIdentity(launch, tokenPayload = null) {
const launchTokenName = $("launchTokenName");
const launchTokenSymbol = $("launchTokenSymbol");
const launchBuilderWalletShort = $("launchBuilderWalletShort");
const launchTokenLogo = $("launchTokenLogo");

const tokenName =
launch?.token_name ||
tokenPayload?.token?.name ||
"Token Name";

const tokenSymbol = String(
launch?.symbol ||
tokenPayload?.token?.symbol ||
tokenPayload?.token?.ticker ||
"TOKEN"
).replace(/^\$/, "");

const builderWallet = launch?.builder_wallet || "";

if (launchTokenName) launchTokenName.textContent = tokenName;
if (launchTokenSymbol) launchTokenSymbol.textContent = `$${tokenSymbol}`;
if (launchBuilderWalletShort) {
launchBuilderWalletShort.textContent = shortAddress(builderWallet || "") || "Pending";
}
if (launchTokenLogo) {
launchTokenLogo.textContent = (tokenSymbol[0] || "M").toUpperCase();
}
}

function updateContractAddress(launch, tokenPayload = null) {
const ca = String(
launch?.contract_address ||
launch?.mint_address ||
tokenPayload?.token?.mint_address ||
tokenPayload?.token?.mint ||
""
).trim() || "Pending";

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

function getCommitMetrics(launch, commitStats = {}) {
const committedSol = toNumber(
commitStats?.totalCommitted ??
launch?.committed_sol ??
launch?.commit_total_sol,
0
);

const participantCount = toNumber(
commitStats?.participants ??
launch?.participants_count ??
launch?.participant_count ??
launch?.participants,
0
);

const hardCapSol = toNumber(
commitStats?.hardCap ??
launch?.hard_cap_sol ??
launch?.hard_cap,
0
);

const minRaiseSol = toNumber(
commitStats?.minRaise ??
launch?.min_raise_sol ??
launch?.min_raise,
0
);

const countdownEndsAt =
commitStats?.countdownEndsAt ||
launch?.countdown_ends_at ||
launch?.live_at;

return {
committedSol,
participantCount,
hardCapSol,
minRaiseSol,
countdownEndsAt,
};
}

function updateStatsForCommit(launch, commitStats = {}) {
const { committedSol, participantCount, hardCapSol } = getCommitMetrics(launch, commitStats);
const progress = hardCapSol > 0 ? Math.min(100, (committedSol / hardCapSol) * 100) : 0;

if ($("stat1Label")) $("stat1Label").textContent = "Committed";
if ($("stat1Value")) $("stat1Value").textContent = formatSol(committedSol, 2);

if ($("stat2Label")) $("stat2Label").textContent = "Participants";
if ($("stat2Value")) $("stat2Value").textContent = formatNumber(participantCount, { maximumFractionDigits: 0 });

if ($("stat3Label")) $("stat3Label").textContent = "Hard Cap";
if ($("stat3Value")) $("stat3Value").textContent = hardCapSol > 0 ? formatSol(hardCapSol, 2) : "—";

if ($("stat4Label")) $("stat4Label").textContent = "Progress";
if ($("stat4Value")) $("stat4Value").textContent = formatPercent(progress, 1);
}

function updateStatsForCountdown(launch, commitStats = {}) {
const { committedSol, participantCount, countdownEndsAt } = getCommitMetrics(launch, commitStats);

if ($("stat1Label")) $("stat1Label").textContent = "Committed";
if ($("stat1Value")) $("stat1Value").textContent = formatSol(committedSol, 2);

if ($("stat2Label")) $("stat2Label").textContent = "Participants";
if ($("stat2Value")) $("stat2Value").textContent = formatNumber(participantCount, { maximumFractionDigits: 0 });

if ($("stat3Label")) $("stat3Label").textContent = "Opens At";
if ($("stat3Value")) $("stat3Value").textContent = formatDateTime(countdownEndsAt);

if ($("stat4Label")) $("stat4Label").textContent = "Time Left";
if ($("stat4Value")) $("stat4Value").textContent = getCountdownText(launch, commitStats);
}

function updateStatsForLive(tokenPayload = {}, chartStats = {}) {
const tokenStats = tokenPayload?.stats || {};

const priceUsd = toNumber(tokenStats?.price_usd ?? chartStats?.price_usd, 0);
const priceSol = toNumber(tokenStats?.price_sol ?? chartStats?.price_sol, 0);

const marketCapUsd = toNumber(tokenStats?.market_cap_usd ?? chartStats?.market_cap_usd, 0);
const marketCapSol = toNumber(tokenStats?.market_cap_sol ?? chartStats?.market_cap_sol, 0);

const liquidityUsd = toNumber(tokenStats?.liquidity_usd ?? chartStats?.liquidity_usd, 0);
const liquiditySol = toNumber(tokenStats?.liquidity_sol ?? chartStats?.liquidity_sol, 0);

const volume24hUsd = toNumber(tokenStats?.volume_24h_usd ?? chartStats?.volume_24h_usd, 0);
const volume24hSol = toNumber(tokenStats?.volume_24h_sol ?? chartStats?.volume_24h_sol, 0);

if ($("stat1Label")) $("stat1Label").textContent = "Price";
if ($("stat1Value")) {
$("stat1Value").textContent = formatDualMetric(
priceUsd > 0 ? formatPriceUsd(priceUsd) : "—",
priceSol > 0 ? `${formatPriceSol(priceSol)} SOL` : ""
);
}

if ($("stat2Label")) $("stat2Label").textContent = "Market Cap";
if ($("stat2Value")) {
$("stat2Value").textContent = formatDualMetric(
marketCapUsd > 0 ? formatUsdCompact(marketCapUsd, 2) : "—",
marketCapSol > 0 ? formatSol(marketCapSol, 2) : ""
);
}

if ($("stat3Label")) $("stat3Label").textContent = "Liquidity";
if ($("stat3Value")) {
$("stat3Value").textContent = formatDualMetric(
liquidityUsd > 0 ? formatUsdCompact(liquidityUsd, 2) : "—",
liquiditySol > 0 ? formatSol(liquiditySol, 2) : ""
);
}

if ($("stat4Label")) $("stat4Label").textContent = "24H Volume";
if ($("stat4Value")) {
$("stat4Value").textContent = formatDualMetric(
volume24hUsd > 0 ? formatUsdCompact(volume24hUsd, 2) : "—",
volume24hSol > 0 ? formatSol(volume24hSol, 2) : ""
);
}
}

function getCountdownParts(launch, commitStats = {}) {
const target =
commitStats?.countdownEndsAt ||
launch?.live_at ||
launch?.countdown_ends_at;

const tradingOpenMs = parseDateMs(target);
if (!tradingOpenMs) return { totalMs: 0, minutes: 0, seconds: 0 };

const diff = Math.max(0, tradingOpenMs - getNowMs());
const minutes = Math.floor(diff / 60000);
const seconds = Math.floor((diff % 60000) / 1000);

return { totalMs: diff, minutes, seconds };
}

function getCountdownText(launch, commitStats = {}) {
const { totalMs, minutes, seconds } = getCountdownParts(launch, commitStats);
if (totalMs <= 0) return "00:00";
return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateCountdownUi(launch, commitStats = {}) {
const marketCountdownValue = $("marketCountdownValue");
if (marketCountdownValue) {
marketCountdownValue.textContent = getCountdownText(launch, commitStats);
}

if ($("stat4Value") && inferPhase(launch) === PHASES.COUNTDOWN) {
$("stat4Value").textContent = getCountdownText(launch, commitStats);
}
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
if ($("linkWebsiteInput")) $("linkWebsiteInput").value = launch?.website_url || "";
if ($("linkXInput")) $("linkXInput").value = launch?.x_url || "";
if ($("linkTelegramInput")) $("linkTelegramInput").value = launch?.telegram_url || "";
if ($("linkDiscordInput")) $("linkDiscordInput").value = launch?.discord_url || "";
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

function setTradeMessage(text = "", type = "neutral") {
const el = $("tradePanelMessage");
if (!el) return;

if (!text) {
el.classList.add("hidden");
el.textContent = "";
el.dataset.state = "";
return;
}

el.classList.remove("hidden");
el.textContent = text;
el.dataset.state = type;
}

function renderRecentTrades(trades = [], tokenPayload = {}, chartStats = {}) {
const list = $("recentTradesList");
if (!list) return;

if (!Array.isArray(trades) || !trades.length) {
list.innerHTML = `<div class="recent-trades-empty">No trades yet.</div>`;
return;
}

const solUsdPrice = toNumber(
tokenPayload?.stats?.sol_usd_price ??
chartStats?.sol_usd_price,
0
);

const ordered = [...trades].reverse();

list.innerHTML = ordered
.slice(0, 50)
.map((trade) => {
const side = String(trade?.side || "").toLowerCase();
const wallet = shortAddress(String(trade?.wallet || ""));
const solAmountNum = toNumber(trade?.sol_amount ?? trade?.base_amount, 0);
const tokenAmountNum = toNumber(trade?.token_amount, 0);
const priceSolNum = toNumber(trade?.price ?? trade?.price_sol, 0);
const tradeUsdValue = solUsdPrice > 0 ? solAmountNum * solUsdPrice : 0;
const createdAt = formatDateTime(trade?.created_at || trade?.timestamp);

return `
<div class="recent-trade-row side-${escapeHtml(side)}">
<div class="recent-trade-main">
<div class="recent-trade-side side-${escapeHtml(side)}">${escapeHtml(side.toUpperCase() || "TRADE")}</div>
<div class="recent-trade-wallet">${escapeHtml(wallet)}</div>
</div>
<div class="recent-trade-metrics">
<div class="recent-trade-value">${escapeHtml(formatSol(solAmountNum, 4))}</div>
<div class="recent-trade-sub">${tradeUsdValue > 0 ? escapeHtml(formatUsd(tradeUsdValue, 2)) : escapeHtml(`${formatTokenAmount(tokenAmountNum, 0)} tokens`)}</div>
</div>
<div class="recent-trade-meta">
<div class="recent-trade-price">@ ${escapeHtml(priceSolNum > 0 ? `${formatPriceSol(priceSolNum)} SOL` : "—")}</div>
<div class="recent-trade-time">${escapeHtml(createdAt)}</div>
</div>
</div>
`;
})
.join("");
}

function setTradePanelVisibility(phase) {
const tradePanelCard = $("tradePanelCard");
const recentTradesCard = $("recentTradesCard");
const tradePanelPhasePill = $("tradePanelPhasePill");
const tradeSubmitBtn = $("tradeSubmitBtn");
const quickBuyRow = $("tradeQuickBuyRow");
const quickSellRow = $("tradeQuickSellRow");

if (!tradePanelCard || !recentTradesCard || !tradePanelPhasePill) return;

const isLive = phase === PHASES.LIVE;
tradePanelCard.classList.toggle("hidden", !isLive);
recentTradesCard.classList.toggle("hidden", !isLive);

tradePanelPhasePill.classList.remove("phase-commit", "phase-countdown", "phase-live");
tradePanelPhasePill.classList.add(`phase-${phase}`);
tradePanelPhasePill.textContent =
phase === PHASES.LIVE
? "Market Active"
: phase === PHASES.COUNTDOWN
? "Countdown"
: "Market Locked";

if (tradeSubmitBtn) {
tradeSubmitBtn.disabled = !isLive;
}

if (quickBuyRow) {
quickBuyRow.classList.toggle("hidden", !isLive);
}

if (quickSellRow && phase !== PHASES.LIVE) {
quickSellRow.classList.add("hidden");
}
}

function updateTradeTabUi(mode) {
const buyTab = $("tradeTabBuy");
const sellTab = $("tradeTabSell");
const amountLabel = $("tradeAmountLabel");
const amountInput = $("tradeAmountInput");
const primaryLabel = $("tradeQuotePrimaryLabel");
const walletLimitLabel = $("tradeQuoteWalletLimitLabel");
const quickBuyRow = $("tradeQuickBuyRow");
const quickSellRow = $("tradeQuickSellRow");

if (buyTab) buyTab.classList.toggle("active", mode === TRADE_MODES.BUY);
if (sellTab) sellTab.classList.toggle("active", mode === TRADE_MODES.SELL);

if (amountLabel) {
amountLabel.textContent = mode === TRADE_MODES.BUY ? "Amount (SOL)" : "Amount (Tokens)";
}

if (amountInput) {
amountInput.placeholder = mode === TRADE_MODES.BUY ? "0.00" : "0";
}

if (primaryLabel) {
primaryLabel.textContent = "You Receive";
}

if (walletLimitLabel) {
walletLimitLabel.textContent = mode === TRADE_MODES.BUY ? "Wallet Limit After" : "Balance After";
}

if (quickBuyRow) {
quickBuyRow.classList.toggle("hidden", mode !== TRADE_MODES.BUY);
}

if (quickSellRow) {
quickSellRow.classList.toggle("hidden", mode !== TRADE_MODES.SELL);
}
}

function resetTradeQuoteUi() {
if ($("tradeQuotePrimaryValue")) $("tradeQuotePrimaryValue").textContent = "—";
if ($("tradeQuotePriceValue")) $("tradeQuotePriceValue").textContent = "—";
if ($("tradeQuoteFeeValue")) $("tradeQuoteFeeValue").textContent = "—";
if ($("tradeQuoteWalletLimitValue")) $("tradeQuoteWalletLimitValue").textContent = "—";
}

function syncMarketShellLayout() {
const shell = $("launchMarketShell");
const market = $("marketCard");
const hero = document.querySelector(".launch-hero-shell");
if (!shell || !market || !hero) return;

const wrap = shell.querySelector(".launch-market-wrap");
if (!wrap) return;

if (wrap.firstElementChild !== hero) {
wrap.prepend(hero);
}

if (hero.nextElementSibling !== market) {
wrap.insertBefore(market, hero.nextElementSibling);
}
}

function syncChartSizing(phase) {
const chartShell = $("marketChartShell");
const chartCanvas = $("marketChartCanvas");
const volumeCanvas = $("marketVolumeCanvas");

if (!chartShell || !chartCanvas || !volumeCanvas) return;

if (phase === PHASES.LIVE) {
chartShell.style.minHeight = "700px";
chartCanvas.style.height = "500px";
volumeCanvas.style.height = "180px";
} else if (phase === PHASES.COUNTDOWN) {
chartShell.style.minHeight = "560px";
chartCanvas.style.height = "380px";
volumeCanvas.style.height = "140px";
} else {
chartShell.style.minHeight = "500px";
chartCanvas.style.height = "340px";
volumeCanvas.style.height = "120px";
}
}

function getWalletSummaryData(tokenPayload = {}, chartStats = {}) {
const wallet = tokenPayload?.wallet || tokenPayload?.position || {};
const stats = tokenPayload?.stats || {};

const tokenBalance = toNumber(
wallet?.token_balance ??
wallet?.tokenBalance ??
tokenPayload?.wallet_token_balance ??
chartStats?.wallet_token_balance ??
0,
0
);

const positionValueUsd = toNumber(
wallet?.position_value_usd ??
wallet?.positionValueUsd ??
tokenPayload?.wallet_position_value_usd ??
chartStats?.wallet_position_value_usd ??
tokenBalance * toNumber(stats?.price_usd ?? chartStats?.price_usd, 0),
0
);

const solBalance = toNumber(
wallet?.sol_balance ??
wallet?.solBalance ??
tokenPayload?.wallet_sol_balance ??
chartStats?.wallet_sol_balance ??
0,
0
);

return {
tokenBalance,
positionValueUsd,
solBalance,
};
}

function updateWalletSummary(phase, connectedWallet, tokenPayload = {}, chartStats = {}) {
const wrap = $("marketWalletSummary");
const tokenBalanceEl = $("walletTokenBalanceValue");
const positionValueEl = $("walletPositionValueValue");
const solBalanceEl = $("walletSolBalanceValue");

if (!wrap || !tokenBalanceEl || !positionValueEl || !solBalanceEl) return;

const show = phase === PHASES.LIVE;
wrap.classList.toggle("hidden", !show);

if (!show) return;

const summary = getWalletSummaryData(tokenPayload, chartStats);
const hasWallet = Boolean(String(connectedWallet || "").trim());

tokenBalanceEl.textContent = hasWallet ? `${formatTokenAmount(summary.tokenBalance, 0)} tokens` : "Connect wallet";
positionValueEl.textContent = hasWallet ? (summary.positionValueUsd > 0 ? formatUsd(summary.positionValueUsd, 2) : "$0") : "—";
solBalanceEl.textContent = hasWallet ? formatSol(summary.solBalance, 4) : "—";
}

function updateAccessCard(phase, launch = {}, tokenPayload = {}, chartStats = {}, quotePayload = null) {
const card = $("marketAccessCard");
const tierLabel = $("marketAccessTierLabel");
const statePill = $("marketAccessStatePill");
const limitValue = $("marketAccessLimitValue");
const holdingValue = $("marketAccessHoldingValue");
const remainingValue = $("marketAccessRemainingValue");
const totalSupplyValue = $("marketTotalSupplyValue");
const schedule = $("marketAccessSchedule");

if (!card || !tierLabel || !statePill || !limitValue || !holdingValue || !remainingValue || !totalSupplyValue || !schedule) {
return;
}

const show = phase === PHASES.LIVE;
card.classList.toggle("hidden", !show);
if (!show) return;

const walletSummary = getWalletSummaryData(tokenPayload, chartStats);
const totalSupply = toNumber(
tokenPayload?.token?.supply ??
launch?.supply ??
chartStats?.supply,
0
);

const maxWalletPct = toNumber(
launch?.max_wallet_pct ??
tokenPayload?.stats?.max_wallet_pct ??
chartStats?.max_wallet_pct,
0
);

const quotedMaxWallet = toNumber(
quotePayload?.quote?.maxWallet ??
quotePayload?.maxWallet,
0
);

const maxWalletTokens = quotedMaxWallet > 0
? quotedMaxWallet
: maxWalletPct > 0 && totalSupply > 0
? (totalSupply * maxWalletPct) / 100
: 0;

const remaining = maxWalletTokens > 0
? Math.max(0, maxWalletTokens - walletSummary.tokenBalance)
: 0;

tierLabel.textContent = maxWalletTokens > 0 ? "Wallet Access Controls" : "Open Access";
statePill.textContent = "Live";
statePill.classList.add("is-open");

limitValue.textContent = maxWalletTokens > 0
? `${formatTokenAmount(maxWalletTokens, 0)} tokens`
: "Open";

holdingValue.textContent = `${formatTokenAmount(walletSummary.tokenBalance, 0)} tokens`;
remainingValue.textContent = maxWalletTokens > 0
? `${formatTokenAmount(remaining, 0)} tokens`
: "Unlimited";

totalSupplyValue.textContent = totalSupply > 0
? `${formatTokenAmount(totalSupply, 0)} tokens`
: "—";

schedule.textContent = maxWalletPct > 0
? `Wallet concentration controls remain active. Current cap is ${formatPercent(maxWalletPct, 2)} of total supply.`
: "No wallet concentration limit detected for the current live phase.";
}

async function fetchJson(path, options = {}) {
const apiBase = window.API_BASE || getApiBase();

const response = await fetch(`${apiBase}${path}`, {
credentials: "include",
...options,
});

const json = await response.json().catch(() => null);

if (!response.ok) {
throw new Error(
json?.error ||
json?.message ||
`Request failed (${response.status})`
);
}

if (json && json.ok === false) {
throw new Error(json.error || json.message || "Request failed");
}

return json ?? {};
}

async function defaultFetchLaunch(launchId) {
return fetchJson(`/api/launcher/${encodeURIComponent(launchId)}`);
}

async function defaultFetchCommitStats(launchId) {
try {
return await fetchJson(`/api/launcher/commits/${encodeURIComponent(launchId)}`);
} catch {
return {};
}
}

async function defaultFetchTokenStats(launchId) {
try {
return await fetchJson(`/api/token/${encodeURIComponent(launchId)}`);
} catch {
return {};
}
}

async function defaultFetchTokenTrades(launchId) {
try {
return await fetchJson(`/api/token/${encodeURIComponent(launchId)}/trades`);
} catch {
return { trades: [] };
}
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

async function defaultFetchMarketSnapshot(launchId, interval = "1m", candleLimit = 120, tradeLimit = 50) {
const [tokenPayload, snapshotPayload] = await Promise.all([
defaultFetchTokenStats(launchId),
fetchJson(
`/api/chart/${encodeURIComponent(launchId)}/snapshot?interval=${encodeURIComponent(interval)}&candle_limit=${encodeURIComponent(candleLimit)}&trade_limit=${encodeURIComponent(tradeLimit)}`
).catch(() => ({})),
]);

return {
tokenPayload: tokenPayload || {},
tokenTrades: snapshotPayload?.trades || [],
chartStats: snapshotPayload?.stats || {},
candles: snapshotPayload?.candles || [],
chartLaunch: snapshotPayload?.launch || null,
};
}

async function defaultSaveLinks(launchId, payload) {
return fetchJson(`/api/launcher/${encodeURIComponent(launchId)}/links`, {
method: "PATCH",
headers: { "Content-Type": "application/json" },
body: JSON.stringify(payload),
});
}

async function defaultQuoteBuy(launchId, solAmount, wallet = "") {
return fetchJson(`/api/market/quote-buy`, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ launchId, solAmount, wallet }),
});
}

async function defaultQuoteSell(launchId, tokenAmount, wallet = "") {
return fetchJson(`/api/market/quote-sell`, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ launchId, tokenAmount, wallet }),
});
}

async function defaultExecuteBuy(launchId, wallet, solAmount) {
return fetchJson(`/api/market/buy`, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ launchId, wallet, solAmount }),
});
}

async function defaultExecuteSell(launchId, wallet, tokenAmount) {
return fetchJson(`/api/market/sell`, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ launchId, wallet, tokenAmount }),
});
}

class LaunchMarketController {
constructor(options = {}) {
this.launchId = options.launchId || "";
this.connectedWallet = options.connectedWallet || "";
this.fetchLaunch = options.fetchLaunch || defaultFetchLaunch;
this.fetchCommitStats = options.fetchCommitStats || defaultFetchCommitStats;
this.fetchTokenStats = options.fetchTokenStats || defaultFetchTokenStats;
this.fetchTokenTrades = options.fetchTokenTrades || defaultFetchTokenTrades;
this.fetchChartStats = options.fetchChartStats || defaultFetchChartStats;
this.fetchChartCandles = options.fetchChartCandles || defaultFetchChartCandles;
this.fetchMarketSnapshot = options.fetchMarketSnapshot || defaultFetchMarketSnapshot;
this.saveLinks = options.saveLinks || defaultSaveLinks;
this.quoteBuy = options.quoteBuy || defaultQuoteBuy;
this.quoteSell = options.quoteSell || defaultQuoteSell;
this.executeBuy = options.executeBuy || defaultExecuteBuy;
this.executeSell = options.executeSell || defaultExecuteSell;
this.onPhaseChange = typeof options.onPhaseChange === "function" ? options.onPhaseChange : null;

this.launch = options.launch || null;
this.commitStats = options.commitStats || {};
this.phase = PHASES.COMMIT;
this.currentInterval = options.initialInterval || "1m";
this.candleLimit = Number(options.candleLimit || 180);

this.commitPollMs = Number(options.commitPollMs || 15000);
this.countdownPollMs = Number(options.countdownPollMs || 1000);
this.livePollMs = Number(options.livePollMs || 6000);

this.tokenPayload = {};
this.chartStats = {};
this.candles = [];
this.trades = [];

this.tradeMode = TRADE_MODES.BUY;
this.lastQuote = null;
this.tradeBusy = false;

this.refreshTimer = null;
this.countdownTimer = null;
this.chartRenderer = null;

this._boundHandleManageLinksClick = this.handleManageLinksClick.bind(this);
this._boundHandleSaveLinksClick = this.handleSaveLinksClick.bind(this);
this._boundHandleCloseLinksClick = this.handleCloseLinksClick.bind(this);
this._boundHandleBackdropClick = this.handleBackdropClick.bind(this);
this._boundHandleCaCopy = this.handleCaCopy.bind(this);
this._boundHandleTimeframeClick = this.handleTimeframeClick.bind(this);
this._boundHandleTradeTabClick = this.handleTradeTabClick.bind(this);
this._boundHandleTradeQuickClick = this.handleTradeQuickClick.bind(this);
this._boundHandleTradeSubmitClick = this.handleTradeSubmitClick.bind(this);
this._boundHandleTradeAmountInput = this.handleTradeAmountInput.bind(this);
}

async init() {
this.bindEvents();
this.mountChartRenderer();
updateTradeTabUi(this.tradeMode);
resetTradeQuoteUi();

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

let tooltipHost = $("eliteChartTooltip");
if (!tooltipHost) {
tooltipHost = document.createElement("div");
tooltipHost.id = "eliteChartTooltip";
tooltipHost.style.position = "absolute";
tooltipHost.style.top = "12px";
tooltipHost.style.left = "12px";
tooltipHost.style.zIndex = "3";
tooltipHost.style.pointerEvents = "none";
chartHost.parentNode?.appendChild(tooltipHost);
}

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

$("tradeTabBuy")?.addEventListener("click", this._boundHandleTradeTabClick);
$("tradeTabSell")?.addEventListener("click", this._boundHandleTradeTabClick);
$("tradeSubmitBtn")?.addEventListener("click", this._boundHandleTradeSubmitClick);
$("tradeAmountInput")?.addEventListener("input", this._boundHandleTradeAmountInput);
document.querySelectorAll(".trade-quick-btn").forEach((btn) => {
btn.addEventListener("click", this._boundHandleTradeQuickClick);
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

$("tradeTabBuy")?.removeEventListener("click", this._boundHandleTradeTabClick);
$("tradeTabSell")?.removeEventListener("click", this._boundHandleTradeTabClick);
$("tradeSubmitBtn")?.removeEventListener("click", this._boundHandleTradeSubmitClick);
$("tradeAmountInput")?.removeEventListener("input", this._boundHandleTradeAmountInput);
document.querySelectorAll(".trade-quick-btn").forEach((btn) => {
btn.removeEventListener("click", this._boundHandleTradeQuickClick);
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

const refreshEvery =
this.phase === PHASES.COMMIT
? this.commitPollMs
: this.phase === PHASES.COUNTDOWN
? this.countdownPollMs
: this.livePollMs;

this.refreshTimer = setInterval(async () => {
try {
if (this.phase === PHASES.LIVE) {
await this.refreshLiveMarketOnly();
} else {
await this.refreshLaunch();
}
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

updateCountdownUi(this.launch, this.commitStats);

this.countdownTimer = setInterval(async () => {
updateCountdownUi(this.launch, this.commitStats);
const nextPhase = inferPhase(this.launch);
if (nextPhase !== this.phase) {
await this.refreshLaunch();
}
}, 1000);
}

async loadLiveMarketData() {
if (!this.launchId) return;

const payload = await this.fetchMarketSnapshot(
this.launchId,
this.currentInterval,
this.candleLimit,
50
);

this.tokenPayload = payload?.tokenPayload || {};
this.chartStats = payload?.chartStats || {};
this.candles = payload?.candles || [];
this.trades = payload?.tokenTrades || payload?.trades || [];

if (payload?.chartLaunch && !this.launch?.contract_address) {
this.launch = { ...payload.chartLaunch, ...this.launch };
}

renderRecentTrades(this.trades, this.tokenPayload, this.chartStats);
renderCassiePanel(this.phase, this.launch, this.tokenPayload, this.chartStats);

if (this.chartRenderer) {
this.chartRenderer.setInterval(this.currentInterval);
this.chartRenderer.setData({
candles: this.candles,
trades: this.trades,
stats: this.chartStats,
});
}
}

async refreshLiveMarketOnly() {
if (!this.launchId || this.phase !== PHASES.LIVE) return;

const [launchPayload, commitStats, payload] = await Promise.all([
this.fetchLaunch(this.launchId),
this.fetchCommitStats(this.launchId),
this.fetchMarketSnapshot(this.launchId, this.currentInterval, this.candleLimit, 50),
]);

this.launch = { ...(payload?.chartLaunch || {}), ...(launchPayload?.launch || launchPayload || this.launch || {}) };
this.commitStats = commitStats || {};
this.tokenPayload = payload?.tokenPayload || {};
this.chartStats = payload?.chartStats || {};
this.candles = payload?.candles || [];
this.trades = payload?.tokenTrades || payload?.trades || [];

this.phase = inferPhase(this.launch);

updateTokenIdentity(this.launch, this.tokenPayload);
updateContractAddress(this.launch, this.tokenPayload);
updatePhaseClasses(this.phase);
updatePhaseContent(this.phase);
setTradePanelVisibility(this.phase);
syncMarketShellLayout();
syncChartSizing(this.phase);
updateStatsForLive(this.tokenPayload, this.chartStats);
updateWalletSummary(this.phase, this.connectedWallet, this.tokenPayload, this.chartStats);
updateAccessCard(this.phase, this.launch, this.tokenPayload, this.chartStats, this.lastQuote);
renderRecentTrades(this.trades, this.tokenPayload, this.chartStats);
renderCassiePanel(this.phase, this.launch, this.tokenPayload, this.chartStats);

if (this.chartRenderer) {
this.chartRenderer.updateData({
candles: this.candles,
trades: this.trades,
stats: this.chartStats,
});
}

this.syncSellQuickButtons();
this.renderTradePanel();
}

async refreshLaunch() {
if (!this.launchId) return;

const [launchPayload, commitStatsPayload] = await Promise.all([
this.fetchLaunch(this.launchId),
this.fetchCommitStats(this.launchId),
]);

this.launch = launchPayload?.launch || launchPayload;
this.commitStats = commitStatsPayload || {};

const previousPhase = this.phase;
this.phase = inferPhase(this.launch);

if (this.phase === PHASES.LIVE) {
await this.loadLiveMarketData();
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

updateTokenIdentity(this.launch, this.tokenPayload);
updateContractAddress(this.launch, this.tokenPayload);
renderExternalLinks(this.launch);
setManageLinksVisibility(this.launch, this.connectedWallet);
updatePhaseClasses(this.phase);
updatePhaseContent(this.phase);
setTradePanelVisibility(this.phase);
syncMarketShellLayout();
syncChartSizing(this.phase);

if (this.phase === PHASES.COMMIT) {
updateStatsForCommit(this.launch, this.commitStats);
renderCassiePanel(this.phase, this.launch, this.tokenPayload, this.chartStats);
} else if (this.phase === PHASES.COUNTDOWN) {
updateStatsForCountdown(this.launch, this.commitStats);
updateCountdownUi(this.launch, this.commitStats);
renderCassiePanel(this.phase, this.launch, this.tokenPayload, this.chartStats);
} else {
updateStatsForLive(this.tokenPayload, this.chartStats);
updateWalletSummary(this.phase, this.connectedWallet, this.tokenPayload, this.chartStats);
updateAccessCard(this.phase, this.launch, this.tokenPayload, this.chartStats, this.lastQuote);
renderRecentTrades(this.trades, this.tokenPayload, this.chartStats);
renderCassiePanel(this.phase, this.launch, this.tokenPayload, this.chartStats);
if (this.chartRenderer) {
this.chartRenderer.setInterval(this.currentInterval);
this.chartRenderer.setData({
candles: this.candles,
trades: this.trades,
stats: this.chartStats,
});
}
}

this.syncSellQuickButtons();
this.renderTradePanel();

if (previousPhase !== this.phase && this.onPhaseChange) {
this.onPhaseChange(this.phase, this.launch, this.tokenPayload, this.chartStats);
}
}

getWalletTokenBalance() {
return getWalletSummaryData(this.tokenPayload, this.chartStats).tokenBalance;
}

syncSellQuickButtons() {
const sellButtons = Array.from(document.querySelectorAll("#tradeQuickSellRow .trade-quick-btn"));
if (!sellButtons.length) return;

const balance = this.getWalletTokenBalance();

sellButtons.forEach((btn) => {
const pct = toNumber(btn.dataset.pct, 0);
btn.disabled = this.phase !== PHASES.LIVE || balance <= 0 || pct <= 0;
});
}

renderTradePanel() {
updateTradeTabUi(this.tradeMode);

const submitBtn = $("tradeSubmitBtn");
if (submitBtn) {
submitBtn.disabled = this.phase !== PHASES.LIVE || this.tradeBusy;
submitBtn.textContent = this.lastQuote
? this.tradeMode === TRADE_MODES.BUY
? "Execute Buy"
: "Execute Sell"
: this.tradeMode === TRADE_MODES.BUY
? "Preview Buy"
: "Preview Sell";
}
}

setConnectedWallet(wallet) {
this.connectedWallet = wallet || "";
if (this.launch) setManageLinksVisibility(this.launch, this.connectedWallet);
if (this.phase === PHASES.LIVE) {
updateWalletSummary(this.phase, this.connectedWallet, this.tokenPayload, this.chartStats);
this.syncSellQuickButtons();
}
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
await this.loadLiveMarketData();
updateStatsForLive(this.tokenPayload, this.chartStats);
updateWalletSummary(this.phase, this.connectedWallet, this.tokenPayload, this.chartStats);
renderCassiePanel(this.phase, this.launch, this.tokenPayload, this.chartStats);
} catch (error) {
console.error("timeframe refresh failed:", error);
}
}
}

handleTradeTabClick(event) {
const id = event.currentTarget?.id;
this.tradeMode = id === "tradeTabSell" ? TRADE_MODES.SELL : TRADE_MODES.BUY;
this.lastQuote = null;
resetTradeQuoteUi();
setTradeMessage("");
updateTradeTabUi(this.tradeMode);
this.syncSellQuickButtons();
this.renderTradePanel();
}

handleTradeQuickClick(event) {
const input = $("tradeAmountInput");
if (!input) return;

if (this.tradeMode === TRADE_MODES.BUY) {
const amount = event.currentTarget?.dataset?.amount || "";
input.value = amount;
return;
}

const pct = toNumber(event.currentTarget?.dataset?.pct, 0);
const balance = this.getWalletTokenBalance();
if (pct > 0 && balance > 0) {
input.value = String((balance * pct) / 100);
}
}

handleTradeAmountInput() {
this.lastQuote = null;
setTradeMessage("");
resetTradeQuoteUi();
this.renderTradePanel();
}

getTradeAmountValue() {
const input = $("tradeAmountInput");
return toNumber(input?.value || 0, 0);
}

async getTradeQuote() {
const amount = this.getTradeAmountValue();
if (amount <= 0) {
throw new Error(this.tradeMode === TRADE_MODES.BUY ? "Enter a SOL amount" : "Enter a token amount");
}

if (this.tradeMode === TRADE_MODES.BUY) {
return this.quoteBuy(this.launchId, amount, this.connectedWallet || "");
}

return this.quoteSell(this.launchId, amount, this.connectedWallet || "");
}

applyQuoteToUi(quotePayload) {
const quote = quotePayload?.quote || quotePayload || {};
this.lastQuote = quotePayload;

if (this.tradeMode === TRADE_MODES.BUY) {
if ($("tradeQuotePrimaryValue")) {
$("tradeQuotePrimaryValue").textContent = `${formatTokenAmount(quote?.tokensBought || 0, 0)} tokens`;
}
if ($("tradeQuotePriceValue")) {
$("tradeQuotePriceValue").textContent = quote?.price > 0 ? `${formatPriceSol(quote.price)} SOL` : "—";
}
if ($("tradeQuoteFeeValue")) {
$("tradeQuoteFeeValue").textContent = formatSol(quote?.feeSol || 0, 6);
}
if ($("tradeQuoteWalletLimitValue")) {
if (quote?.maxWallet) {
const maxWalletText = formatTokenAmount(quote.maxWallet, 0);
const afterText =
quote?.walletBalanceAfter != null
? ` / After ${formatTokenAmount(quote.walletBalanceAfter, 0)}`
: "";
$("tradeQuoteWalletLimitValue").textContent = `${maxWalletText}${afterText}`;
} else {
$("tradeQuoteWalletLimitValue").textContent = "Applies";
}
}
} else {
if ($("tradeQuotePrimaryValue")) {
$("tradeQuotePrimaryValue").textContent = formatSol(quote?.netSolOut || 0, 6);
}
if ($("tradeQuotePriceValue")) {
$("tradeQuotePriceValue").textContent = quote?.price > 0 ? `${formatPriceSol(quote.price)} SOL` : "—";
}
if ($("tradeQuoteFeeValue")) {
$("tradeQuoteFeeValue").textContent = formatSol(quote?.feeSol || 0, 6);
}
if ($("tradeQuoteWalletLimitValue")) {
$("tradeQuoteWalletLimitValue").textContent =
quote?.walletBalanceAfter != null
? formatTokenAmount(quote.walletBalanceAfter, 0)
: "—";
}
}

updateAccessCard(this.phase, this.launch, this.tokenPayload, this.chartStats, quotePayload);
this.renderTradePanel();
}

async executeTrade() {
const amount = this.getTradeAmountValue();
if (amount <= 0) {
throw new Error(this.tradeMode === TRADE_MODES.BUY ? "Enter a SOL amount" : "Enter a token amount");
}
if (!this.connectedWallet) {
throw new Error("Connect wallet first");
}

if (this.tradeMode === TRADE_MODES.BUY) {
return this.executeBuy(this.launchId, this.connectedWallet, amount);
}

return this.executeSell(this.launchId, this.connectedWallet, amount);
}

async handleTradeSubmitClick() {
if (this.phase !== PHASES.LIVE || this.tradeBusy) return;

const submitBtn = $("tradeSubmitBtn");
const originalText = submitBtn?.textContent || "Preview Buy";

try {
this.tradeBusy = true;
this.renderTradePanel();
setTradeMessage("");

if (!this.lastQuote) {
if (!this.connectedWallet) {
throw new Error("Connect wallet first");
}

if (submitBtn) {
submitBtn.textContent = this.tradeMode === TRADE_MODES.BUY ? "Preparing Buy Preview..." : "Preparing Sell Preview...";
}

const quotePayload = await this.getTradeQuote();
this.applyQuoteToUi(quotePayload);
setTradeMessage(
this.tradeMode === TRADE_MODES.BUY
? "Buy preview ready. Review execution details and submit again to execute."
: "Sell preview ready. Review execution details and submit again to execute.",
"success"
);
return;
}

if (submitBtn) {
submitBtn.textContent = this.tradeMode === TRADE_MODES.BUY ? "Executing Buy..." : "Executing Sell...";
}

const result = await this.executeTrade();

const message =
this.tradeMode === TRADE_MODES.BUY
? `Buy Executed\nReceived: ${formatTokenAmount(result?.tokensReceived || 0, 0)} tokens\nPaid: ${formatSol(this.getTradeAmountValue(), 6)}\nFee: ${formatSol(result?.feeSol || 0, 6)}`
: `Sell Executed\nReceived: ${formatSol(result?.solReceived || 0, 6)}\nSold: ${formatTokenAmount(this.getTradeAmountValue(), 0)} tokens\nFee: ${formatSol(result?.feeSol || 0, 6)}`;

setTradeMessage(message, "success");

this.lastQuote = null;
resetTradeQuoteUi();

const input = $("tradeAmountInput");
if (input) input.value = "";

await this.refreshLiveMarketOnly();
this.renderTradePanel();
} catch (error) {
console.error("trade submit failed:", error);
setTradeMessage(error?.message || "Trade failed", "error");
} finally {
this.tradeBusy = false;
if (submitBtn) submitBtn.textContent = originalText;
this.renderTradePanel();
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