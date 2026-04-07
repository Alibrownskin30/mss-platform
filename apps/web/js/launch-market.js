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

const BASE_MAX_WALLET_PERCENT = 0.5;
const DAILY_INCREASE_PERCENT = 0.5;
const BUILDER_MAX_WALLET_PERCENT = 5;

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

function toInt(value, fallback = 0) {
return Math.max(0, Math.floor(toNumber(value, fallback)));
}

function cleanString(value, max = 2000) {
return String(value ?? "").trim().slice(0, max);
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

function choosePreferredNonEmpty(...values) {
for (const value of values) {
const cleaned = cleanString(value, 2000);
if (cleaned) return cleaned;
}
return "";
}

function normalizeLaunchTruth(raw = {}) {
return {
...(raw || {}),
status: cleanString(raw?.status, 64).toLowerCase(),
contract_address: cleanString(raw?.contract_address, 200),
mint_address: cleanString(raw?.mint_address, 200),
reserved_mint_address: cleanString(raw?.reserved_mint_address, 200),
mint_reservation_status: cleanString(raw?.mint_reservation_status, 64).toLowerCase(),
live_at: raw?.live_at || null,
countdown_started_at: raw?.countdown_started_at || null,
countdown_ends_at: raw?.countdown_ends_at || null,
commit_started_at: raw?.commit_started_at || null,
commit_ends_at: raw?.commit_ends_at || null,
created_at: raw?.created_at || null,
updated_at: raw?.updated_at || null,
final_supply: raw?.final_supply ?? "",
supply: raw?.supply ?? "",
builder_wallet: cleanString(raw?.builder_wallet, 200),
builder_alias: cleanString(raw?.builder_alias, 200),
builder_score: toNumber(raw?.builder_score, 0),
token_name: cleanString(raw?.token_name, 200),
symbol: cleanString(raw?.symbol, 80),
website_url: cleanString(raw?.website_url, 500),
x_url: cleanString(raw?.x_url, 500),
telegram_url: cleanString(raw?.telegram_url, 500),
discord_url: cleanString(raw?.discord_url, 500),
};
}

function mergeLaunchTruth(previous = {}, incoming = {}) {
const prev = normalizeLaunchTruth(previous || {});
const next = normalizeLaunchTruth(incoming || {});

const merged = {
...prev,
...next,
};

const prevStatus = cleanString(prev.status, 64).toLowerCase();
const nextStatus = cleanString(next.status, 64).toLowerCase();

const prevContract = choosePreferredNonEmpty(prev.contract_address, prev.mint_address);
const nextContract = choosePreferredNonEmpty(next.contract_address, next.mint_address);
const strongestContract = choosePreferredNonEmpty(nextContract, prevContract);

merged.contract_address = strongestContract;
merged.mint_address = choosePreferredNonEmpty(next.mint_address, prev.mint_address, strongestContract);
merged.reserved_mint_address = choosePreferredNonEmpty(next.reserved_mint_address, prev.reserved_mint_address);
merged.mint_reservation_status = choosePreferredNonEmpty(
next.mint_reservation_status,
prev.mint_reservation_status
);

const hasFinalizedSignal =
merged.mint_reservation_status === "finalized" ||
Boolean(strongestContract);

if (hasFinalizedSignal) {
if (prevStatus === "graduated" || nextStatus === "graduated") {
merged.status = "graduated";
} else if (prevStatus === "live" || nextStatus === "live") {
merged.status = "live";
} else {
const liveAtMs = parseDateMs(next.live_at || prev.live_at);
const countdownEndsMs = parseDateMs(next.countdown_ends_at || prev.countdown_ends_at);
const now = Date.now();

if ((liveAtMs && now >= liveAtMs) || (countdownEndsMs && now >= countdownEndsMs)) {
merged.status = "live";
}
}
}

return merged;
}

function isLaunchLiveLike(launch = {}) {
const status = cleanString(launch?.status, 64).toLowerCase();
if (status === "live" || status === "graduated") return true;

const contractAddress = choosePreferredNonEmpty(
launch?.contract_address,
launch?.mint_address
);
const reservationStatus = cleanString(launch?.mint_reservation_status, 64).toLowerCase();
const liveAtMs = parseDateMs(launch?.live_at || launch?.countdown_ends_at);

if (contractAddress && reservationStatus === "finalized") return true;
if (contractAddress && liveAtMs && Date.now() >= liveAtMs) return true;

return false;
}

function getDaysSinceLive(launch = {}) {
const liveStartMs = parseDateMs(launch?.live_at || launch?.updated_at || launch?.created_at);
if (!liveStartMs) return 0;
return Math.max(0, Math.floor((Date.now() - liveStartMs) / 86400000));
}

function getLocalMaxWalletPercent(launch = {}, connectedWallet = "") {
const builderWallet = String(launch?.builder_wallet || "").trim().toLowerCase();
const currentWallet = String(connectedWallet || "").trim().toLowerCase();
const isBuilderWallet = Boolean(builderWallet && currentWallet && builderWallet === currentWallet);

if (isBuilderWallet) return BUILDER_MAX_WALLET_PERCENT;

const days = getDaysSinceLive(launch);
return BASE_MAX_WALLET_PERCENT + (days * DAILY_INCREASE_PERCENT);
}

function inferPhase(launch) {
const explicit = String(launch?.status || "").toLowerCase();

if (explicit === "live" || explicit === "graduated") return PHASES.LIVE;
if (explicit === PHASES.COUNTDOWN) {
if (isLaunchLiveLike(launch)) return PHASES.LIVE;
return PHASES.COUNTDOWN;
}
if (explicit === PHASES.COMMIT) return PHASES.COMMIT;

if (isLaunchLiveLike(launch)) return PHASES.LIVE;

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
statusText: "Countdown",
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
const accessMode = $("launchAccessModeText");

if (launchPhaseBadgeText) launchPhaseBadgeText.textContent = meta.badgeText;
if (launchStatusText) launchStatusText.textContent = meta.statusText;
if (launchMarketModeText) launchMarketModeText.textContent = meta.marketModeText;
if (marketStatusLabel) marketStatusLabel.textContent = phase === PHASES.LIVE ? "Live Trading" : meta.statusText;
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

if (accessMode) {
accessMode.textContent =
phase === PHASES.LIVE
? "Live Access"
: phase === PHASES.COUNTDOWN
? "Countdown Locked"
: "Pre-Live";
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

function resolveContractAddress(launch = {}, tokenPayload = {}) {
const phase = inferPhase(launch);
const contractAddress = choosePreferredNonEmpty(
launch?.contract_address,
launch?.mint_address,
tokenPayload?.token?.mint_address,
tokenPayload?.token?.mint,
tokenPayload?.mint_address,
tokenPayload?.mint
);

const reservedMintAddress = cleanString(launch?.reserved_mint_address, 200);
const reservationStatus = cleanString(launch?.mint_reservation_status, 64).toLowerCase();

if (phase !== PHASES.LIVE) {
return {
value: "",
state: "Pending",
};
}

if (contractAddress) {
return {
value: contractAddress,
state: "Ready",
};
}

if (reservationStatus === "finalized" && reservedMintAddress) {
return {
value: reservedMintAddress,
state: "Ready",
};
}

return {
value: "",
state: "Pending",
};
}

function updateContractAddress(launch, tokenPayload = null) {
const resolved = resolveContractAddress(launch || {}, tokenPayload || {});
const ca = resolved.value || "Pending";
const short = ca === "Pending" ? "Pending" : shortAddress(ca);

const launchCaText = $("launchCaText");
const chartCaChipText = $("chartCaChipText");
const launchCaState = $("launchCaState");

if (launchCaText) launchCaText.textContent = short;
if (chartCaChipText) chartCaChipText.textContent = short;
if (launchCaState) launchCaState.textContent = resolved.state;

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

function getLiveStats(tokenPayload = {}, chartStats = {}, launch = {}) {
const tokenStats = tokenPayload?.stats || {};
const stats = { ...chartStats, ...tokenStats };

const solUsdPrice = toNumber(
stats?.sol_usd_price ??
tokenPayload?.launch?.sol_usd_price ??
tokenPayload?.stats?.sol_usd_price,
0
);

const priceUsd = toNumber(
stats?.price_usd,
0
);

const fallbackPriceSol = toNumber(
stats?.price_sol ??
tokenPayload?.launch?.price ??
launch?.price,
0
);

const resolvedPriceUsd =
priceUsd > 0
? priceUsd
: (fallbackPriceSol > 0 && solUsdPrice > 0 ? fallbackPriceSol * solUsdPrice : 0);

const marketCapUsd = toNumber(
stats?.market_cap_usd,
0
);

const fallbackMarketCapSol = toNumber(
stats?.market_cap ??
tokenPayload?.launch?.market_cap ??
launch?.market_cap,
0
);

const resolvedMarketCapUsd =
marketCapUsd > 0
? marketCapUsd
: (fallbackMarketCapSol > 0 && solUsdPrice > 0 ? fallbackMarketCapSol * solUsdPrice : 0);

const liquidityUsd = toNumber(
stats?.liquidity_usd,
0
);

const fallbackLiquiditySol = toNumber(
stats?.liquidity_sol ??
stats?.liquidity ??
tokenPayload?.launch?.liquidity_sol ??
tokenPayload?.launch?.liquidity ??
launch?.liquidity,
0
);

const resolvedLiquidityUsd =
liquidityUsd > 0
? liquidityUsd
: (fallbackLiquiditySol > 0 && solUsdPrice > 0 ? fallbackLiquiditySol * solUsdPrice : 0);

const volume24hUsd = toNumber(
stats?.volume_24h_usd,
0
);

const fallbackVolume24hSol = toNumber(
stats?.volume_24h ??
tokenPayload?.launch?.volume_24h ??
launch?.volume_24h,
0
);

const resolvedVolume24hUsd =
volume24hUsd > 0
? volume24hUsd
: (fallbackVolume24hSol > 0 && solUsdPrice > 0 ? fallbackVolume24hSol * solUsdPrice : 0);

return {
priceUsd: resolvedPriceUsd,
marketCapUsd: resolvedMarketCapUsd,
liquidityUsd: resolvedLiquidityUsd,
volume24hUsd: resolvedVolume24hUsd,
};
}

function updateStatsForLive(tokenPayload = {}, chartStats = {}, launch = {}) {
const liveStats = getLiveStats(tokenPayload, chartStats, launch);

if ($("stat1Label")) $("stat1Label").textContent = "Price";
if ($("stat1Value")) $("stat1Value").textContent = liveStats.priceUsd > 0 ? formatPriceUsd(liveStats.priceUsd) : "—";

if ($("stat2Label")) $("stat2Label").textContent = "Market Cap";
if ($("stat2Value")) $("stat2Value").textContent = liveStats.marketCapUsd > 0 ? formatUsdCompact(liveStats.marketCapUsd, 2) : "—";

if ($("stat3Label")) $("stat3Label").textContent = "Liquidity";
if ($("stat3Value")) $("stat3Value").textContent = liveStats.liquidityUsd > 0 ? formatUsdCompact(liveStats.liquidityUsd, 2) : "—";

if ($("stat4Label")) $("stat4Label").textContent = "24H Volume";
if ($("stat4Value")) $("stat4Value").textContent = liveStats.volume24hUsd > 0 ? formatUsdCompact(liveStats.volume24hUsd, 2) : "—";
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
const canManage = Boolean(
inferPhase(launch) === PHASES.LIVE &&
builderWallet &&
wallet &&
builderWallet === wallet
);

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

if (quickSellRow) {
quickSellRow.classList.toggle("hidden", !isLive);
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
chartShell.style.minHeight = "430px";
chartCanvas.style.height = "310px";
volumeCanvas.style.height = "96px";
} else if (phase === PHASES.COUNTDOWN) {
chartShell.style.minHeight = "360px";
chartCanvas.style.height = "240px";
volumeCanvas.style.height = "80px";
} else {
chartShell.style.minHeight = "340px";
chartCanvas.style.height = "220px";
volumeCanvas.style.height = "72px";
}
}

function getWalletSummaryData(tokenPayload = {}, chartStats = {}, fallbackTokenBalance = null) {
const wallet = tokenPayload?.wallet || tokenPayload?.position || {};
const stats = tokenPayload?.stats || {};

const tokenBalance = Math.max(
0,
toInt(
wallet?.token_balance ??
wallet?.tokenBalance ??
wallet?.balance_tokens ??
wallet?.balance ??
tokenPayload?.wallet_token_balance ??
tokenPayload?.walletBalance ??
tokenPayload?.position?.token_balance ??
chartStats?.wallet_token_balance ??
chartStats?.wallet_balance_tokens ??
fallbackTokenBalance ??
0,
0
)
);

const totalBalance = Math.max(
tokenBalance,
toInt(
wallet?.total_balance ??
wallet?.totalBalance ??
tokenPayload?.wallet_total_balance ??
chartStats?.wallet_total_balance ??
tokenBalance,
tokenBalance
)
);

const unlockedBalance = Math.max(
0,
toInt(
wallet?.unlocked_balance ??
wallet?.unlockedBalance ??
wallet?.sellable_balance ??
wallet?.sellableBalance ??
tokenPayload?.wallet_unlocked_balance ??
tokenPayload?.wallet_sellable_balance ??
chartStats?.wallet_unlocked_balance ??
chartStats?.wallet_sellable_balance ??
tokenBalance,
tokenBalance
)
);

const lockedBalance = Math.max(
0,
toInt(
wallet?.locked_balance ??
wallet?.lockedBalance ??
tokenPayload?.wallet_locked_balance ??
chartStats?.wallet_locked_balance ??
Math.max(0, totalBalance - unlockedBalance),
Math.max(0, totalBalance - unlockedBalance)
)
);

const sellableBalance = Math.max(
0,
Math.min(
tokenBalance,
toInt(
wallet?.sellable_balance ??
wallet?.sellableBalance ??
tokenPayload?.wallet_sellable_balance ??
chartStats?.wallet_sellable_balance ??
unlockedBalance,
unlockedBalance
)
)
);

const priceUsd = toNumber(stats?.price_usd ?? chartStats?.price_usd, 0);

const positionValueUsd = toNumber(
wallet?.position_value_usd ??
wallet?.positionValueUsd ??
tokenPayload?.wallet_position_value_usd ??
chartStats?.wallet_position_value_usd ??
(tokenBalance * priceUsd),
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

const solDelta = toNumber(
wallet?.sol_delta ??
wallet?.solDelta ??
tokenPayload?.wallet_sol_delta ??
chartStats?.wallet_sol_delta ??
solBalance,
solBalance
);

const isBuilderWallet = Boolean(
wallet?.is_builder_wallet ??
tokenPayload?.wallet_is_builder ??
chartStats?.wallet_is_builder ??
false
);

const vestingActive = Boolean(
wallet?.vesting_active ??
tokenPayload?.wallet_vesting_active ??
chartStats?.wallet_vesting_active ??
false
);

return {
tokenBalance,
totalBalance,
unlockedBalance,
lockedBalance,
sellableBalance,
positionValueUsd,
solBalance,
solDelta,
isBuilderWallet,
vestingActive,
};
}

function updateWalletSummary(phase, connectedWallet, tokenPayload = {}, chartStats = {}, fallbackTokenBalance = null) {
const wrap = $("marketWalletSummary");
const tokenBalanceEl = $("walletTokenBalanceValue");
const positionValueEl = $("walletPositionValueValue");
const solBalanceEl = $("walletSolBalanceValue");

if (!wrap || !tokenBalanceEl || !positionValueEl || !solBalanceEl) return;

const show = phase === PHASES.LIVE;
wrap.classList.toggle("hidden", !show);

if (!show) return;

const summary = getWalletSummaryData(tokenPayload, chartStats, fallbackTokenBalance);
const hasWallet = Boolean(String(connectedWallet || "").trim());

if (!hasWallet) {
tokenBalanceEl.textContent = "Connect wallet";
positionValueEl.textContent = "—";
solBalanceEl.textContent = "—";
return;
}

if (summary.isBuilderWallet && summary.vestingActive) {
tokenBalanceEl.innerHTML = `
<div>${formatTokenAmount(summary.sellableBalance, 0)} sellable</div>
<div style="margin-top:4px;font-size:12px;opacity:.68;">
${formatTokenAmount(summary.lockedBalance, 0)} locked
</div>
`;
} else {
tokenBalanceEl.textContent = `${formatTokenAmount(summary.tokenBalance, 0)} tokens`;
}

positionValueEl.textContent = summary.positionValueUsd > 0 ? formatUsd(summary.positionValueUsd, 2) : "$0";
solBalanceEl.textContent = formatSol(summary.solBalance, 4);
}

function updateAccessCard(
phase,
launch = {},
tokenPayload = {},
chartStats = {},
quotePayload = null,
connectedWallet = "",
fallbackTokenBalance = null
) {
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

const walletSummary = getWalletSummaryData(tokenPayload, chartStats, fallbackTokenBalance);
const totalSupply = toInt(
tokenPayload?.token?.supply ??
launch?.final_supply ??
launch?.supply ??
chartStats?.total_supply,
0
);

const backendMaxWallet = toInt(
quotePayload?.quote?.maxWallet ??
quotePayload?.quote?.maxWalletTokens ??
quotePayload?.maxWallet ??
quotePayload?.maxWalletTokens,
0
);

const localMaxWalletPct = getLocalMaxWalletPercent(launch, connectedWallet);
const localMaxWalletTokens = totalSupply > 0
? Math.floor((totalSupply * localMaxWalletPct) / 100)
: 0;

const maxWalletTokens = backendMaxWallet > 0 ? backendMaxWallet : localMaxWalletTokens;
const effectiveHolding = walletSummary.isBuilderWallet && walletSummary.vestingActive
? walletSummary.sellableBalance
: walletSummary.tokenBalance;
const remaining = maxWalletTokens > 0
? Math.max(0, maxWalletTokens - effectiveHolding)
: 0;

statePill.classList.remove("is-open", "is-restricted");
statePill.classList.add("is-open");

tierLabel.textContent = walletSummary.isBuilderWallet
? "Builder Access Controls"
: maxWalletTokens > 0
? "Wallet Access Controls"
: "Open Access";

statePill.textContent = "Live";

limitValue.textContent = maxWalletTokens > 0
? `${formatTokenAmount(maxWalletTokens, 0)} tokens`
: "Open";

if (walletSummary.isBuilderWallet && walletSummary.vestingActive) {
holdingValue.innerHTML = `
<div>${formatTokenAmount(walletSummary.sellableBalance, 0)} sellable</div>
<div style="margin-top:4px;font-size:12px;opacity:.68;">
${formatTokenAmount(walletSummary.lockedBalance, 0)} locked
</div>
`;
} else {
holdingValue.textContent = `${formatTokenAmount(walletSummary.tokenBalance, 0)} tokens`;
}

remainingValue.textContent = maxWalletTokens > 0
? `${formatTokenAmount(remaining, 0)} tokens`
: "Unlimited";

totalSupplyValue.textContent = totalSupply > 0
? `${formatTokenAmount(totalSupply, 0)} tokens`
: "—";

if (walletSummary.isBuilderWallet && walletSummary.vestingActive) {
schedule.textContent = `Builder vesting is active. Only unlocked tokens are treated as currently sellable. Current public cap is ${formatPercent(localMaxWalletPct, 2)} of total supply, while builder holdings are tracked separately.`;
} else {
schedule.textContent = maxWalletTokens > 0
? `Wallet concentration controls remain active. Current cap is ${formatPercent(localMaxWalletPct, 2)} of total supply.`
: "No wallet concentration limit detected for the current live phase.";
}
}

function clearLiveOnlyUi() {
const walletSummary = $("marketWalletSummary");
const accessCard = $("marketAccessCard");
const recentTradesList = $("recentTradesList");

if (walletSummary) walletSummary.classList.add("hidden");
if (accessCard) accessCard.classList.add("hidden");

if ($("walletTokenBalanceValue")) $("walletTokenBalanceValue").textContent = "—";
if ($("walletPositionValueValue")) $("walletPositionValueValue").textContent = "—";
if ($("walletSolBalanceValue")) $("walletSolBalanceValue").textContent = "—";

if ($("marketAccessLimitValue")) $("marketAccessLimitValue").textContent = "—";
if ($("marketAccessHoldingValue")) $("marketAccessHoldingValue").textContent = "—";
if ($("marketAccessRemainingValue")) $("marketAccessRemainingValue").textContent = "—";
if ($("marketTotalSupplyValue")) $("marketTotalSupplyValue").textContent = "—";
if ($("marketAccessSchedule")) $("marketAccessSchedule").textContent = "Allocation controls active.";

if (recentTradesList) {
recentTradesList.innerHTML = `<div class="recent-trades-empty">No trades yet.</div>`;
}

setTradeMessage("");
resetTradeQuoteUi();
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

async function defaultFetchTokenStats(launchId, wallet = "") {
try {
const qs = wallet ? `?wallet=${encodeURIComponent(wallet)}` : "";
return await fetchJson(`/api/token/${encodeURIComponent(launchId)}${qs}`);
} catch {
return {};
}
}

async function defaultFetchChartStats(launchId, wallet = "") {
try {
const qs = wallet ? `?wallet=${encodeURIComponent(wallet)}` : "";
return await fetchJson(`/api/chart/${encodeURIComponent(launchId)}/stats${qs}`);
} catch {
return {};
}
}

async function defaultFetchMarketSnapshot(launchId, interval = "1m", candleLimit = 120, tradeLimit = 50, wallet = "") {
const walletQs = wallet ? `&wallet=${encodeURIComponent(wallet)}` : "";

const [tokenPayload, snapshotPayload] = await Promise.all([
defaultFetchTokenStats(launchId, wallet),
fetchJson(
`/api/chart/${encodeURIComponent(launchId)}/snapshot?interval=${encodeURIComponent(interval)}&candle_limit=${encodeURIComponent(candleLimit)}&trade_limit=${encodeURIComponent(tradeLimit)}${walletQs}`
).catch(() => ({})),
]);

return {
tokenPayload: tokenPayload || {},
tokenTrades: snapshotPayload?.trades || [],
chartStats: snapshotPayload?.stats || {},
candles: snapshotPayload?.candles || [],
chartLaunch: snapshotPayload?.launch || null,
pool: snapshotPayload?.pool || null,
wallet: snapshotPayload?.wallet || null,
cassie: snapshotPayload?.cassie || null,
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
this.fetchChartStats = options.fetchChartStats || defaultFetchChartStats;
this.fetchMarketSnapshot = options.fetchMarketSnapshot || defaultFetchMarketSnapshot;
this.saveLinks = options.saveLinks || defaultSaveLinks;
this.quoteBuy = options.quoteBuy || defaultQuoteBuy;
this.quoteSell = options.quoteSell || defaultQuoteSell;
this.executeBuy = options.executeBuy || defaultExecuteBuy;
this.executeSell = options.executeSell || defaultExecuteSell;
this.onPhaseChange = typeof options.onPhaseChange === "function" ? options.onPhaseChange : null;

this.launch = options.launch ? normalizeLaunchTruth(options.launch) : null;
this.commitStats = options.commitStats || {};
this.phase = PHASES.COMMIT;
this.currentInterval = options.initialInterval || "1m";
this.candleLimit = Number(options.candleLimit || 180);

this.commitPollMs = Number(options.commitPollMs || 15000);
this.countdownPollMs = Number(options.countdownPollMs || 2500);
this.livePollMs = Number(options.livePollMs || 6000);

this.tokenPayload = {};
this.chartStats = {};
this.candles = [];
this.trades = [];
this.pool = null;

this.tradeMode = TRADE_MODES.BUY;
this.lastQuote = null;
this.tradeBusy = false;
this.quoteBusy = false;
this.walletTokenBalanceFallback = 0;

this.refreshTimer = null;
this.countdownTimer = null;
this.chartRenderer = null;

this._liveRefreshInFlight = null;
this._launchRefreshInFlight = null;
this._timeframeRefreshInFlight = null;
this._walletRefreshTimeout = null;
this._destroyed = false;

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
this._destroyed = true;
this.stopTimers();
this.unbindEvents();

if (this._walletRefreshTimeout) {
clearTimeout(this._walletRefreshTimeout);
this._walletRefreshTimeout = null;
}

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

if (this.phase === PHASES.COUNTDOWN) {
this.refreshTimer = setInterval(async () => {
try {
await this.refreshLaunch({ force: true });
} catch (error) {
console.error("launch-market countdown refresh failed:", error);
}
}, this.countdownPollMs);

this.startCountdownTicker();
return;
}

if (this.phase !== PHASES.LIVE) {
this.refreshTimer = setInterval(async () => {
try {
await this.refreshLaunch({ force: false });
} catch (error) {
console.error("launch-market commit refresh failed:", error);
}
}, this.commitPollMs);
return;
}

this.refreshTimer = setInterval(async () => {
try {
await this.refreshLiveMarketOnly();
} catch (error) {
console.error("launch-market live refresh failed:", error);
}
}, this.livePollMs);
}

startCountdownTicker() {
if (this.countdownTimer) clearInterval(this.countdownTimer);

updateCountdownUi(this.launch, this.commitStats);

this.countdownTimer = setInterval(() => {
updateCountdownUi(this.launch, this.commitStats);

const nextPhase = inferPhase(this.launch);
if (nextPhase !== this.phase) {
this.phase = nextPhase;
this.applyAll();

if (nextPhase === PHASES.LIVE) {
void this.refreshLiveMarketOnly({ force: true }).catch((error) => {
console.error("countdown to live refresh failed:", error);
});
this.startPollingLoop();
}
}
}, 1000);
}

setBaseState(launch = null, commitStats = null, options = {}) {
const previousPhase = this.phase;

if (launch) {
this.launch = mergeLaunchTruth(this.launch || {}, launch);
}

if (commitStats && typeof commitStats === "object") {
this.commitStats = commitStats;
}

this.applyAll();

if (options.restartPolling !== false && previousPhase !== this.phase) {
this.startPollingLoop();
}
}

applySnapshotPayload(payload = {}) {
this.tokenPayload = payload?.tokenPayload || {};
this.chartStats = payload?.chartStats || {};
this.candles = payload?.candles || [];
this.trades = payload?.tokenTrades || payload?.trades || [];
this.pool = payload?.pool || null;

if (payload?.chartLaunch) {
this.launch = mergeLaunchTruth(this.launch || {}, payload.chartLaunch);
}

const liveWalletSummary = getWalletSummaryData(
this.tokenPayload,
this.chartStats,
this.walletTokenBalanceFallback
);

if (liveWalletSummary.tokenBalance > 0 || this.walletTokenBalanceFallback <= 0) {
this.walletTokenBalanceFallback = liveWalletSummary.tokenBalance;
}
}

async refreshLiveMarketOnly({ force = false } = {}) {
if (!this.launchId) return;
if (!force && this.phase !== PHASES.LIVE) return;

if (this._liveRefreshInFlight) {
return this._liveRefreshInFlight;
}

this._liveRefreshInFlight = (async () => {
const payload = await this.fetchMarketSnapshot(
this.launchId,
this.currentInterval,
this.candleLimit,
50,
this.connectedWallet || ""
);

if (this._destroyed) return;

this.applySnapshotPayload(payload);
this.phase = inferPhase(this.launch);
this.applyAll();

if (this.chartRenderer) {
this.chartRenderer.setInterval(this.currentInterval);
if (typeof this.chartRenderer.updateData === "function") {
this.chartRenderer.updateData({
candles: this.candles,
trades: this.trades,
stats: this.chartStats,
});
} else if (typeof this.chartRenderer.setData === "function") {
this.chartRenderer.setData({
candles: this.candles,
trades: this.trades,
stats: this.chartStats,
});
}
}
})();

try {
return await this._liveRefreshInFlight;
} finally {
this._liveRefreshInFlight = null;
}
}

async refreshLaunch({ force = false } = {}) {
if (!this.launchId) return;

if (this._launchRefreshInFlight) {
return this._launchRefreshInFlight;
}

this._launchRefreshInFlight = (async () => {
const [launchPayload, commitStatsPayload] = await Promise.all([
this.fetchLaunch(this.launchId),
this.fetchCommitStats(this.launchId),
]);

if (this._destroyed) return;

const incomingLaunch = normalizeLaunchTruth(launchPayload?.launch || launchPayload || {});
const previousPhase = this.phase;

this.launch = mergeLaunchTruth(this.launch || {}, incomingLaunch);
this.commitStats = commitStatsPayload || {};
this.phase = inferPhase(this.launch);

if (this.phase === PHASES.LIVE) {
await this.refreshLiveMarketOnly({ force: true });
} else {
this.applyAll();
}

if (previousPhase !== this.phase || force) {
this.startPollingLoop();
}
})();

try {
return await this._launchRefreshInFlight;
} finally {
this._launchRefreshInFlight = null;
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
clearLiveOnlyUi();
updateStatsForCommit(this.launch, this.commitStats);
renderCassiePanel(this.phase, this.launch, this.tokenPayload, this.chartStats);
} else if (this.phase === PHASES.COUNTDOWN) {
clearLiveOnlyUi();
updateStatsForCountdown(this.launch, this.commitStats);
updateCountdownUi(this.launch, this.commitStats);
renderCassiePanel(this.phase, this.launch, this.tokenPayload, this.chartStats);
} else {
updateStatsForLive(this.tokenPayload, this.chartStats, this.launch);
updateWalletSummary(
this.phase,
this.connectedWallet,
this.tokenPayload,
this.chartStats,
this.walletTokenBalanceFallback
);
updateAccessCard(
this.phase,
this.launch,
this.tokenPayload,
this.chartStats,
this.lastQuote,
this.connectedWallet,
this.walletTokenBalanceFallback
);
renderRecentTrades(this.trades, this.tokenPayload, this.chartStats);
renderCassiePanel(this.phase, this.launch, this.tokenPayload, this.chartStats);

if (this.chartRenderer) {
this.chartRenderer.setInterval(this.currentInterval);
if (typeof this.chartRenderer.setData === "function") {
this.chartRenderer.setData({
candles: this.candles,
trades: this.trades,
stats: this.chartStats,
});
} else if (typeof this.chartRenderer.updateData === "function") {
this.chartRenderer.updateData({
candles: this.candles,
trades: this.trades,
stats: this.chartStats,
});
}
}
}

this.syncSellQuickButtons();
this.renderTradePanel();

if (previousPhase !== this.phase && this.onPhaseChange) {
this.onPhaseChange(this.phase, this.launch, this.tokenPayload, this.chartStats);
}
}

getWalletTokenBalance() {
return getWalletSummaryData(
this.tokenPayload,
this.chartStats,
this.walletTokenBalanceFallback
).sellableBalance;
}

syncSellQuickButtons() {
const sellButtons = Array.from(document.querySelectorAll("#tradeQuickSellRow .trade-quick-btn"));
if (!sellButtons.length) return;

const balance = this.getWalletTokenBalance();

sellButtons.forEach((btn) => {
const pct = toNumber(btn.dataset.pct, 0);
btn.disabled = this.phase !== PHASES.LIVE || balance <= 0 || pct <= 0 || this.tradeBusy || this.quoteBusy;
});
}

renderTradePanel() {
updateTradeTabUi(this.tradeMode);

const submitBtn = $("tradeSubmitBtn");
const amount = this.getTradeAmountValue();
const hasAmount = amount > 0;

if (submitBtn) {
submitBtn.disabled = this.phase !== PHASES.LIVE || this.tradeBusy || this.quoteBusy || !hasAmount;
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
this.lastQuote = null;
resetTradeQuoteUi();
setTradeMessage("");

if (this.launch) setManageLinksVisibility(this.launch, this.connectedWallet);

if (this.phase === PHASES.LIVE) {
updateWalletSummary(
this.phase,
this.connectedWallet,
this.tokenPayload,
this.chartStats,
this.walletTokenBalanceFallback
);
updateAccessCard(
this.phase,
this.launch,
this.tokenPayload,
this.chartStats,
this.lastQuote,
this.connectedWallet,
this.walletTokenBalanceFallback
);
this.syncSellQuickButtons();
this.renderTradePanel();

if (this._walletRefreshTimeout) {
clearTimeout(this._walletRefreshTimeout);
}

this._walletRefreshTimeout = setTimeout(() => {
void this.refreshLiveMarketOnly({ force: true }).catch((error) => {
console.error("wallet sync refresh failed:", error);
});
}, 250);
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
this.launch = mergeLaunchTruth(this.launch || {}, result?.launch || payload);
renderExternalLinks(this.launch);
setManageLinksVisibility(this.launch, this.connectedWallet);
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

if (this._timeframeRefreshInFlight) return;

document.querySelectorAll(".market-timeframe").forEach((el) => {
el.classList.remove("active");
});
btn.classList.add("active");

this.currentInterval = btn.dataset.interval || "1m";
this.lastQuote = null;
resetTradeQuoteUi();
setTradeMessage("");

if (this.chartRenderer) {
this.chartRenderer.setInterval(this.currentInterval);
}

if (this.phase === PHASES.LIVE) {
this._timeframeRefreshInFlight = this.refreshLiveMarketOnly({ force: true })
.catch((error) => {
console.error("timeframe refresh failed:", error);
})
.finally(() => {
this._timeframeRefreshInFlight = null;
});

await this._timeframeRefreshInFlight;
} else {
this.renderTradePanel();
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
if (this.tradeBusy || this.quoteBusy) return;

const input = $("tradeAmountInput");
if (!input) return;

if (this.tradeMode === TRADE_MODES.BUY) {
const amount = event.currentTarget?.dataset?.amount || "";
input.value = amount;
this.lastQuote = null;
resetTradeQuoteUi();
setTradeMessage("");
this.renderTradePanel();
return;
}

const pct = toNumber(event.currentTarget?.dataset?.pct, 0);
const balance = this.getWalletTokenBalance();

if (pct > 0 && balance > 0) {
input.value = String(Math.max(0, Math.floor((balance * pct) / 100)));
this.lastQuote = null;
resetTradeQuoteUi();
setTradeMessage("");
this.renderTradePanel();
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
? `${formatTokenAmount(quote.walletBalanceAfter, 0)} tokens`
: "—";
}

if (quote?.walletBalanceBefore != null) {
this.walletTokenBalanceFallback = toNumber(quote.walletBalanceBefore, this.walletTokenBalanceFallback);
}
}

updateAccessCard(
this.phase,
this.launch,
this.tokenPayload,
this.chartStats,
quotePayload,
this.connectedWallet,
this.walletTokenBalanceFallback
);

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
if (this.phase !== PHASES.LIVE || this.tradeBusy || this.quoteBusy) return;

const submitBtn = $("tradeSubmitBtn");
const originalText = submitBtn?.textContent || "Preview Buy";

try {
setTradeMessage("");

if (!this.lastQuote) {
if (!this.connectedWallet) {
throw new Error("Connect wallet first");
}

this.quoteBusy = true;
this.renderTradePanel();

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

this.tradeBusy = true;
this.renderTradePanel();

if (submitBtn) {
submitBtn.textContent = this.tradeMode === TRADE_MODES.BUY ? "Executing Buy..." : "Executing Sell...";
}

const inputAmount = this.getTradeAmountValue();
const result = await this.executeTrade();

if (this.tradeMode === TRADE_MODES.BUY) {
this.walletTokenBalanceFallback = toNumber(
result?.walletBalanceAfter,
this.walletTokenBalanceFallback + toNumber(result?.tokensReceived, 0)
);
} else {
this.walletTokenBalanceFallback = toNumber(
result?.walletBalanceAfter,
Math.max(0, this.walletTokenBalanceFallback - toNumber(inputAmount, 0))
);
}

const message =
this.tradeMode === TRADE_MODES.BUY
? `Buy Executed\nReceived: ${formatTokenAmount(result?.tokensReceived || 0, 0)} tokens\nPaid: ${formatSol(inputAmount, 6)}\nFee: ${formatSol(result?.feeSol || 0, 6)}`
: `Sell Executed\nReceived: ${formatSol(result?.solReceived || result?.netSolOut || 0, 6)}\nSold: ${formatTokenAmount(inputAmount, 0)} tokens\nFee: ${formatSol(result?.feeSol || 0, 6)}`;

setTradeMessage(message, "success");

this.lastQuote = null;
resetTradeQuoteUi();

const input = $("tradeAmountInput");
if (input) input.value = "";

await this.refreshLiveMarketOnly({ force: true });
this.renderTradePanel();
} catch (error) {
console.error("trade submit failed:", error);
setTradeMessage(error?.message || "Trade failed", "error");
} finally {
this.quoteBusy = false;
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