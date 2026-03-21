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

const direct = Date.parse(raw);
if (Number.isFinite(direct)) return direct;

const sqliteUtc = Date.parse(raw.replace(" ", "T") + "Z");
if (Number.isFinite(sqliteUtc)) return sqliteUtc;

const sqliteLocal = Date.parse(raw.replace(" ", "T"));
return Number.isFinite(sqliteLocal) ? sqliteLocal : null;
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
primaryLabel.textContent = mode === TRADE_MODES.BUY ? "You Receive" : "You Receive";
}

if (walletLimitLabel) {
walletLimitLabel.textContent = mode === TRADE_MODES.BUY ? "Capacity After" : "Balance After";
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

function syncMarketShellLayout(phase) {
const shell = document.querySelector(".launch-market-wrap");
const hero = document.querySelector(".launch-hero-shell");
const market = $("marketCard");

if (!shell || !hero || !market) return;

if (phase === PHASES.COUNTDOWN || phase === PHASES.LIVE) {
if (shell.firstElementChild !== market) {
shell.prepend(market);
}
market.classList.add("market-priority");
} else {
if (shell.firstElementChild !== hero) {
shell.prepend(hero);
shell.appendChild(market);
}
market.classList.remove("market-priority");
}
}

function syncChartSizing(phase) {
const chartShell = $("marketChartShell");
const chartCanvas = $("marketChartCanvas");
const volumeCanvas = $("marketVolumeCanvas");

if (!chartShell || !chartCanvas || !volumeCanvas) return;

if (phase === PHASES.LIVE) {
chartShell.style.minHeight = "620px";
chartCanvas.style.height = "440px";
volumeCanvas.style.height = "140px";
} else if (phase === PHASES.COUNTDOWN) {
chartShell.style.minHeight = "520px";
chartCanvas.style.height = "360px";
volumeCanvas.style.height = "120px";
} else {
chartShell.style.minHeight = "460px";
chartCanvas.style.height = "340px";
volumeCanvas.style.height = "120px";
}
}

function getWalletSnapshot(tokenPayload = {}, chartStats = {}, launch = {}, connectedWallet = "") {
const token = tokenPayload?.token || {};
const stats = tokenPayload?.stats || {};
const walletBlock =
tokenPayload?.wallet ||
tokenPayload?.position ||
tokenPayload?.holder ||
tokenPayload?.portfolio ||
{};

const tokenBalance = toNumber(
walletBlock?.token_balance ??
walletBlock?.tokenBalance ??
walletBlock?.balance_tokens ??
walletBlock?.balance ??
walletBlock?.tokens ??
0,
0
);

const solBalance = toNumber(
walletBlock?.sol_balance ??
walletBlock?.solBalance ??
walletBlock?.base_balance ??
0,
0
);

const priceUsd = toNumber(stats?.price_usd ?? chartStats?.price_usd, 0);
const priceSol = toNumber(stats?.price_sol ?? chartStats?.price_sol, 0);

const tokenValueUsd = toNumber(
walletBlock?.position_value_usd ??
walletBlock?.token_value_usd ??
walletBlock?.usd_value ??
0,
0
) || (tokenBalance > 0 && priceUsd > 0 ? tokenBalance * priceUsd : 0);

const tokenValueSol = toNumber(
walletBlock?.position_value_sol ??
walletBlock?.token_value_sol ??
0,
0
) || (tokenBalance > 0 && priceSol > 0 ? tokenBalance * priceSol : 0);

const totalSupply = toNumber(
token?.total_supply ??
token?.supply ??
stats?.total_supply ??
chartStats?.total_supply ??
launch?.total_supply ??
0,
0
);

const explicitHoldingPct = toNumber(
walletBlock?.holding_pct ??
walletBlock?.holding_percent ??
walletBlock?.wallet_percent ??
0,
0
);

const holdingPct = explicitHoldingPct > 0
? explicitHoldingPct
: totalSupply > 0 && tokenBalance > 0
? (tokenBalance / totalSupply) * 100
: 0;

const accessLimitPct = toNumber(
launch?.max_wallet_pct ??
stats?.max_wallet_pct ??
tokenPayload?.market?.max_wallet_pct ??
chartStats?.max_wallet_pct ??
0,
0
);

const maxWalletTokens = toNumber(
walletBlock?.max_wallet_tokens ??
walletBlock?.maxWalletTokens ??
(accessLimitPct > 0 && totalSupply > 0 ? (accessLimitPct / 100) * totalSupply : 0),
0
);

const remainingCapacityPct =
accessLimitPct > 0
? Math.max(0, accessLimitPct - holdingPct)
: 0;

const remainingCapacityTokens =
maxWalletTokens > 0
? Math.max(0, maxWalletTokens - tokenBalance)
: 0;

const restrictionSchedule =
tokenPayload?.market?.restriction_schedule ||
tokenPayload?.market?.schedule ||
launch?.restriction_schedule ||
launch?.max_wallet_schedule ||
(accessLimitPct > 0
? "Expands by schedule until Open Market."
: "Allocation restriction removed.");

const isConnected = Boolean(String(connectedWallet || "").trim());

return {
isConnected,
tokenBalance,
solBalance,
tokenValueUsd,
tokenValueSol,
totalSupply,
holdingPct,
accessLimitPct,
maxWalletTokens,
remainingCapacityPct,
remainingCapacityTokens,
restrictionSchedule,
};
}

function getAccessTierMeta(walletSnapshot = {}) {
const limit = toNumber(walletSnapshot.accessLimitPct, 0);

if (!(limit > 0)) {
return {
title: "Open Market",
state: "Fully Open",
accessText: "Open Market",
note: "Allocation restriction removed. Trading is fully open.",
isOpen: true,
};
}

if (limit <= 0.5) {
return {
title: "Controlled Access I",
state: "Restricted",
accessText: "Controlled Access I",
note: walletSnapshot.restrictionSchedule || "Early controlled allocation tier active.",
isOpen: false,
};
}

if (limit <= 1) {
return {
title: "Controlled Access II",
state: "Restricted",
accessText: "Controlled Access II",
note: walletSnapshot.restrictionSchedule || "Controlled allocation tier active.",
isOpen: false,
};
}

if (limit <= 2) {
return {
title: "Controlled Access III",
state: "Restricted",
accessText: "Controlled Access III",
note: walletSnapshot.restrictionSchedule || "Expanded controlled allocation tier active.",
isOpen: false,
};
}

return {
title: "Controlled Access IV",
state: "Restricted",
accessText: "Controlled Access IV",
note: walletSnapshot.restrictionSchedule || "Controlled allocation tier remains active.",
isOpen: false,
};
}

function renderWalletSummary(phase, walletSnapshot = {}) {
const summary = $("marketWalletSummary");
const tokenBalanceValue = $("walletTokenBalanceValue");
const positionValueValue = $("walletPositionValueValue");
const solBalanceValue = $("walletSolBalanceValue");

if (!summary || !tokenBalanceValue || !positionValueValue || !solBalanceValue) return;

if (phase !== PHASES.LIVE || !walletSnapshot.isConnected) {
summary.classList.add("hidden");
tokenBalanceValue.textContent = "—";
positionValueValue.textContent = "—";
solBalanceValue.textContent = "—";
return;
}

summary.classList.remove("hidden");
tokenBalanceValue.textContent = walletSnapshot.tokenBalance > 0
? formatTokenAmount(walletSnapshot.tokenBalance, 0)
: "0";

positionValueValue.textContent =
walletSnapshot.tokenValueUsd > 0 || walletSnapshot.tokenValueSol > 0
? formatDualMetric(
walletSnapshot.tokenValueUsd > 0 ? formatUsdCompact(walletSnapshot.tokenValueUsd, 2) : "—",
walletSnapshot.tokenValueSol > 0 ? formatSol(walletSnapshot.tokenValueSol, 2) : ""
)
: "—";

solBalanceValue.textContent = walletSnapshot.solBalance > 0
? formatSol(walletSnapshot.solBalance, 4)
: "0 SOL";
}

function renderAccessCard(phase, walletSnapshot = {}) {
const card = $("marketAccessCard");
const accessModeText = $("launchAccessModeText");
const tierLabel = $("marketAccessTierLabel");
const statePill = $("marketAccessStatePill");
const limitValue = $("marketAccessLimitValue");
const holdingValue = $("marketAccessHoldingValue");
const remainingValue = $("marketAccessRemainingValue");
const totalSupplyValue = $("marketTotalSupplyValue");
const schedule = $("marketAccessSchedule");

if (
!card ||
!accessModeText ||
!tierLabel ||
!statePill ||
!limitValue ||
!holdingValue ||
!remainingValue ||
!totalSupplyValue ||
!schedule
) {
return;
}

const tier = getAccessTierMeta(walletSnapshot);

const shouldShow = phase === PHASES.COUNTDOWN || phase === PHASES.LIVE;
card.classList.toggle("hidden", !shouldShow);

accessModeText.textContent = tier.accessText;
tierLabel.textContent = tier.title;
statePill.textContent = tier.state;
statePill.classList.toggle("is-open", tier.isOpen);

limitValue.textContent = walletSnapshot.accessLimitPct > 0
? `${formatPercent(walletSnapshot.accessLimitPct, 2)} • ${formatTokenAmount(walletSnapshot.maxWalletTokens, 0)}`
: "None";

holdingValue.textContent = walletSnapshot.isConnected
? `${formatPercent(walletSnapshot.holdingPct, 3)} • ${formatTokenAmount(walletSnapshot.tokenBalance, 0)}`
: "Connect wallet";

remainingValue.textContent = walletSnapshot.accessLimitPct > 0
? walletSnapshot.isConnected
? `${formatPercent(walletSnapshot.remainingCapacityPct, 3)} • ${formatTokenAmount(walletSnapshot.remainingCapacityTokens, 0)}`
: formatPercent(walletSnapshot.accessLimitPct, 2)
: "Unlimited";

totalSupplyValue.textContent = walletSnapshot.totalSupply > 0
? formatTokenAmount(walletSnapshot.totalSupply, 0)
: "—";

schedule.textContent = tier.note;
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
this.walletSnapshot = getWalletSnapshot({}, {}, this.launch, this.connectedWallet);

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

rebuildWalletSnapshot() {
this.walletSnapshot = getWalletSnapshot(
this.tokenPayload,
this.chartStats,
this.launch,
this.connectedWallet
);
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

this.rebuildWalletSnapshot();

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
this.rebuildWalletSnapshot();

updateTokenIdentity(this.launch, this.tokenPayload);
updateContractAddress(this.launch, this.tokenPayload);
updatePhaseClasses(this.phase);
updatePhaseContent(this.phase);
setTradePanelVisibility(this.phase);
syncMarketShellLayout(this.phase);
syncChartSizing(this.phase);
updateStatsForLive(this.tokenPayload, this.chartStats);
renderWalletSummary(this.phase, this.walletSnapshot);
renderAccessCard(this.phase, this.walletSnapshot);
renderRecentTrades(this.trades, this.tokenPayload, this.chartStats);
renderCassiePanel(this.phase, this.launch, this.tokenPayload, this.chartStats);

if (this.chartRenderer) {
this.chartRenderer.updateData({
candles: this.candles,
trades: this.trades,
stats: this.chartStats,
});
}

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
} else {
this.rebuildWalletSnapshot();
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
this.rebuildWalletSnapshot();

updateTokenIdentity(this.launch, this.tokenPayload);
updateContractAddress(this.launch, this.tokenPayload);
renderExternalLinks(this.launch);
setManageLinksVisibility(this.launch, this.connectedWallet);
updatePhaseClasses(this.phase);
updatePhaseContent(this.phase);
setTradePanelVisibility(this.phase);
syncMarketShellLayout(this.phase);
syncChartSizing(this.phase);

if (this.phase === PHASES.COMMIT) {
updateStatsForCommit(this.launch, this.commitStats);
renderWalletSummary(this.phase, this.walletSnapshot);
renderAccessCard(this.phase, this.walletSnapshot);
renderCassiePanel(this.phase, this.launch, this.tokenPayload, this.chartStats);
} else if (this.phase === PHASES.COUNTDOWN) {
updateStatsForCountdown(this.launch, this.commitStats);
updateCountdownUi(this.launch, this.commitStats);
renderWalletSummary(this.phase, this.walletSnapshot);
renderAccessCard(this.phase, this.walletSnapshot);
renderCassiePanel(this.phase, this.launch, this.tokenPayload, this.chartStats);
} else {
updateStatsForLive(this.tokenPayload, this.chartStats);
renderWalletSummary(this.phase, this.walletSnapshot);
renderAccessCard(this.phase, this.walletSnapshot);
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

this.renderTradePanel();

if (previousPhase !== this.phase && this.onPhaseChange) {
this.onPhaseChange(this.phase, this.launch, this.tokenPayload, this.chartStats);
}
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
this.rebuildWalletSnapshot();
if (this.launch) setManageLinksVisibility(this.launch, this.connectedWallet);
renderWalletSummary(this.phase, this.walletSnapshot);
renderAccessCard(this.phase, this.walletSnapshot);
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
renderWalletSummary(this.phase, this.walletSnapshot);
renderAccessCard(this.phase, this.walletSnapshot);
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
this.renderTradePanel();
}

handleTradeQuickClick(event) {
const input = $("tradeAmountInput");
if (!input) return;

if (this.tradeMode === TRADE_MODES.BUY) {
const amount = event.currentTarget?.dataset?.amount || "";
if (!amount) return;
input.value = amount;
this.handleTradeAmountInput();
return;
}

const pct = toNumber(event.currentTarget?.dataset?.pct, 0);
if (!(pct > 0)) return;

const tokenBalance = toNumber(this.walletSnapshot?.tokenBalance, 0);
const amount = tokenBalance * (pct / 100);
input.value = amount > 0 ? String(amount) : "";
this.handleTradeAmountInput();
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
} else if (this.walletSnapshot.accessLimitPct > 0) {
$("tradeQuoteWalletLimitValue").textContent = `${formatPercent(this.walletSnapshot.remainingCapacityPct, 3)} remaining`;
} else {
$("tradeQuoteWalletLimitValue").textContent = "Open";
}
}
} else {
if ($("tradeQuotePrimaryValue")) {
$("tradeQuotePrimaryValue").textContent = formatSol(quote?.netSolOut || quote?.solOut || 0, 6);
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