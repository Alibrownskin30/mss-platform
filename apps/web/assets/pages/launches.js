import {
connectWallet as connectAnyWallet,
disconnectWallet as disconnectAnyWallet,
getConnectedWallet,
getConnectedPublicKey,
onWalletChange,
restoreWalletIfTrusted,
getMobileWalletHelpText,
sendSolTransfer,
} from "../wallet.js";

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

function clamp(n, min, max) {
return Math.max(min, Math.min(max, n));
}

function safeNum(v, fallback = 0) {
const n = Number(v);
return Number.isFinite(n) ? n : fallback;
}

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max);
}

function escapeHtml(str) {
return String(str ?? "")
.replaceAll("&", "&amp;")
.replaceAll("<", "&lt;")
.replaceAll(">", "&gt;")
.replaceAll('"', "&quot;")
.replaceAll("'", "&#039;");
}

function normalizeStatus(status) {
return String(status || "").trim().toLowerCase();
}

function normalizeView(view) {
return view === "list" ? "list" : "grid";
}

function parseTs(v) {
if (!v) return null;
const raw = String(v).trim();
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

function fmtTime(ms) {
if (!Number.isFinite(ms)) return "—";
if (ms <= 0) return "00:00";

const s = Math.floor(ms / 1000);
const h = Math.floor(s / 3600);
const m = Math.floor((s % 3600) / 60);
const r = s % 60;

if (h > 0) {
return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function fmtSol(n, decimals = 2) {
const v = safeNum(n, 0);
return Number.isInteger(v) ? String(v) : v.toFixed(decimals).replace(/\.?0+$/, "");
}

function shortenWallet(wallet) {
const w = String(wallet || "").trim();
if (!w) return "No wallet connected";
if (w.length <= 12) return w;
return `${w.slice(0, 4)}...${w.slice(-4)}`;
}

function stageLabel(status) {
const s = normalizeStatus(status);
if (s === "commit") return "Commit";
if (s === "countdown") return "Countdown";
if (s === "building") return "Building";
if (s === "live") return "Live";
if (s === "graduated") return "Graduated";
if (s === "failed") return "Failed";
if (s === "failed_refunded") return "Refunded";
return "Unknown";
}

function badgeClass(status) {
const s = normalizeStatus(status);
if (s === "countdown" || s === "building") return "countdown";
if (s === "live" || s === "graduated") return "live";
if (s === "failed" || s === "failed_refunded") return "failed";
return "commit";
}

function getBuilderTrust(score) {
const n = safeNum(score, 0);
if (n >= 80) return { label: "Strong" };
if (n >= 55) return { label: "Moderate" };
return { label: "Early" };
}

function isCurrentFieldStatus(status) {
const s = normalizeStatus(status);
return s === "commit" || s === "countdown" || s === "building" || s === "live";
}

function isHistoricalStatus(status) {
const s = normalizeStatus(status);
return s === "graduated" || s === "failed" || s === "failed_refunded";
}

function isActiveStatus(status) {
return isCurrentFieldStatus(status);
}

function isQuickCommitPhase(status) {
return normalizeStatus(status) === "commit";
}

function matchesStatusFilter(launch, statusFilter) {
if (statusFilter === "all") return true;

const status = normalizeStatus(launch?.status);

if (statusFilter === "live") {
return status === "live";
}

if (statusFilter === "failed") {
return status === "failed" || status === "failed_refunded";
}

if (statusFilter === "history") {
return isHistoricalStatus(status);
}

return status === statusFilter;
}

function getLogoHtml(launch) {
const imageUrl = String(launch.image_url || "").trim();
return imageUrl
? `<div class="logo-box"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(launch.token_name || "Launch")} logo" loading="lazy" decoding="async" /></div>`
: `<div class="logo-box">Logo</div>`;
}

function getCommitPercent(launch) {
const explicit = safeNum(launch.commitPercent, -1);
if (explicit >= 0) return clamp(explicit, 0, 100);

const committed = safeNum(launch.committed_sol, 0);
const hardCap = safeNum(launch.hard_cap_sol, 0);
if (hardCap <= 0) return 0;

return clamp((committed / hardCap) * 100, 0, 100);
}

function getSoftCapPercent(launch) {
const committed = safeNum(launch.committed_sol, 0);
const minRaise = safeNum(launch.min_raise_sol, 0);
if (minRaise <= 0) return 0;
return clamp((committed / minRaise) * 100, 0, 999);
}

function getPhasePriority(status) {
const s = normalizeStatus(status);
if (s === "building") return 6;
if (s === "countdown") return 5;
if (s === "commit") return 4;
if (s === "live") return 3;
if (s === "graduated") return 2;
if (s === "failed" || s === "failed_refunded") return 1;
return 0;
}

function getLiveTimingValue(launch) {
const status = normalizeStatus(launch.status);
const commitEndsAt = parseTs(launch.commit_ends_at);
const countdownEndsAt = parseTs(launch.countdown_ends_at);

if (status === "commit") {
return {
label: "Commit Ends",
value: fmtTime((commitEndsAt ?? 0) - Date.now()),
};
}

if (status === "countdown") {
return {
label: "Countdown",
value: fmtTime((countdownEndsAt ?? 0) - Date.now()),
};
}

if (status === "building") {
return {
label: "Status",
value: "BUILDING",
};
}

if (status === "live") {
return {
label: "Status",
value: "LIVE",
};
}

if (status === "graduated") {
return {
label: "Status",
value: "GRADUATED",
};
}

if (status === "failed_refunded") {
return {
label: "Status",
value: "Refunded",
};
}

if (status === "failed") {
return {
label: "Status",
value: "Failed",
};
}

return {
label: "Status",
value: stageLabel(status),
};
}

function getTimingMeta(launch) {
const live = getLiveTimingValue(launch);

return {
label: live.label,
value: live.value,
endAt:
live.label === "Commit Ends"
? parseTs(launch.commit_ends_at)
: live.label === "Countdown"
? parseTs(launch.countdown_ends_at)
: null,
};
}

function getLaunchStateNote(launch) {
const status = normalizeStatus(launch.status);
const committed = safeNum(launch.committed_sol, 0);
const minRaise = safeNum(launch.min_raise_sol, 0);
const hardCap = safeNum(launch.hard_cap_sol, 0);
const softCapPct = getSoftCapPercent(launch);
const progressPct = getCommitPercent(launch);

if (status === "building") {
return "Countdown is complete. MSS is finalizing mint, liquidity bootstrap, and live transition.";
}

if (status === "countdown") {
return "Commit closed. Launch is arming for market activation.";
}

if (status === "commit") {
if (minRaise > 0 && committed >= minRaise) {
return "Minimum raise satisfied. Launch is pushing toward hard cap.";
}
if (softCapPct >= 70) {
return "Commit momentum is building toward minimum raise.";
}
return "Commit window is active and accepting participants.";
}

if (status === "live") {
return "Launch is live and trading on the internal market.";
}

if (status === "graduated") {
return "Launch has graduated beyond the initial launch cycle.";
}

if (status === "failed") {
return "Launch failed to meet requirements before closure.";
}

if (status === "failed_refunded") {
return "Launch failed and tracked commits were refunded.";
}

if (hardCap > 0 && progressPct >= 100) {
return "Launch reached hard cap.";
}

return "Launch status is being tracked.";
}

function getBuilderBadges(launch) {
const out = [];
if (String(launch.template || "") === "builder") {
if (safeNum(launch.team_allocation_pct) > 0) {
out.push(`<span class="small-chip">Team ${fmtSol(launch.team_allocation_pct)}%</span>`);
}
if (safeNum(launch.builder_bond_sol) > 0) {
const refunded = safeNum(launch.builder_bond_refunded, 0) === 1;
out.push(`<span class="small-chip">Bond ${fmtSol(launch.builder_bond_sol)} SOL${refunded ? " • Refunded" : ""}</span>`);
}
}
return out.join("");
}

function getSafeguardsHtml(launch) {
const safeguards = [
"Min Raise Enforced",
"Hard Cap Locked",
"Countdown Protection",
"Max Wallet Rule",
];

const status = normalizeStatus(launch.status);
if (["commit", "countdown", "failed", "failed_refunded"].includes(status)) {
safeguards.push("Refund Path");
}

if (safeNum(launch.builder_bond_sol) > 0) {
safeguards.push("Builder Bond");
}

return `
<div class="safeguards">
${safeguards.map((label) => `<span class="safe-chip">${escapeHtml(label)}</span>`).join("")}
</div>
`;
}

function trendingScore(launch) {
const participants = safeNum(launch.participants_count, 0);
const progress = getCommitPercent(launch);
const committed = safeNum(launch.committed_sol, 0);
const minRaise = safeNum(launch.min_raise_sol, 0);
const hardCap = safeNum(launch.hard_cap_sol, 0);
const status = normalizeStatus(launch.status);
const countdownEndsAt = parseTs(launch.countdown_ends_at);
const commitEndsAt = parseTs(launch.commit_ends_at);
const now = Date.now();

const nearSoftCapBoost =
minRaise > 0 && committed >= minRaise
? 24
: minRaise > 0
? clamp((committed / minRaise) * 18, 0, 18)
: 0;

const nearHardCapBoost =
hardCap > 0
? clamp((committed / hardCap) * 22, 0, 22)
: 0;

let urgencyBoost = 0;
if (status === "countdown" && countdownEndsAt) {
const remaining = Math.max(0, countdownEndsAt - now);
urgencyBoost =
remaining <= 30 * 60 * 1000
? 18
: remaining <= 2 * 60 * 60 * 1000
? 12
: 8;
} else if (status === "building") {
urgencyBoost = 20;
} else if (status === "commit" && commitEndsAt) {
const remaining = Math.max(0, commitEndsAt - now);
urgencyBoost =
remaining <= 2 * 60 * 60 * 1000
? 9
: remaining <= 12 * 60 * 60 * 1000
? 5
: 0;
}

const statusBoost =
status === "building"
? 32
: status === "countdown"
? 30
: status === "commit"
? 18
: status === "live"
? 12
: 0;

return (
progress * 1.35 +
participants * 2.8 +
committed * 0.95 +
nearSoftCapBoost +
nearHardCapBoost +
urgencyBoost +
statusBoost
);
}

function compareTrending(a, b) {
const phaseDelta = getPhasePriority(b.status) - getPhasePriority(a.status);
if (phaseDelta !== 0) return phaseDelta;

const trendDelta = trendingScore(b) - trendingScore(a);
if (trendDelta !== 0) return trendDelta;

return safeNum(b.id) - safeNum(a.id);
}

function getFeedLines(launch) {
const recent = Array.isArray(launch.recent) ? launch.recent.slice(0, 3) : [];

if (!recent.length) {
return `<div class="feed-line"><span>No recent commits</span><span>—</span></div>`;
}

return recent
.map((row) => {
const wallet = shortenWallet(row.wallet || "");
const amount = fmtSol(row.sol_amount);
return `<div class="feed-line"><span>${escapeHtml(wallet)} committed</span><span>${amount} SOL</span></div>`;
})
.join("");
}

function buildQuickButtons(launch) {
if (!isQuickCommitPhase(launch?.status)) {
return "";
}

const amounts = [0.1, 0.25, 0.5, 0.75, 1];

return amounts
.map((amount) => {
return `<button type="button" class="quick-commit-btn" data-launch-id="${launch.id}" data-amount="${amount}">${amount} SOL</button>`;
})
.join("");
}

function buildQuickCommitBlock(launch, { featured = false, listMode = false } = {}) {
if (!isQuickCommitPhase(launch?.status)) {
return "";
}

const walletConnected = getConnectedWallet().isConnected;
const buttons = buildQuickButtons(launch);

if (!buttons) return "";

if (featured) {
return `
<div class="featured-quick-shell">
<div class="quick-title">Featured Quick Commit</div>
<div class="quick-row" style="margin-top:10px;">
${buttons}
</div>
<div style="margin-top:10px;font-size:12px;color:rgba(255,255,255,.62);">
${walletConnected ? "Connected wallet can commit directly into the featured launch." : "Connect wallet to enable featured quick commit."}
</div>
</div>
`;
}

if (listMode) {
return `
<div class="quick-row">
${buttons}
</div>
<div style="font-size:12px;color:rgba(255,255,255,.62);">
${walletConnected ? "Quick commit enabled" : "Connect wallet to commit"}
</div>
`;
}

return `
<div class="quick-commit">
<div class="quick-title">Quick Commit</div>
<div class="quick-row">
${buttons}
</div>
<div style="margin-top:8px;font-size:12px;color:rgba(255,255,255,.62);">
${walletConnected ? "Connected wallet can quick commit from this card." : "Connect wallet to enable quick commit."}
</div>
</div>
`;
}

function getLaunchHref(launchId) {
return `./launch.html?id=${encodeURIComponent(launchId)}`;
}

function buildCard(launch) {
const name = escapeHtml(launch.token_name || "Untitled Launch");
const symbol = escapeHtml(launch.symbol || "N/A");
const templateRaw = String(launch.template || "—");
const template = escapeHtml(templateRaw.replaceAll("_", " "));
const status = normalizeStatus(launch.status || "commit");
const builderName = escapeHtml(launch.builder_alias || launch.builder_wallet || "Unknown Builder");
const builderWallet = String(launch.builder_wallet || "").trim();
const builderScore = safeNum(launch.builder_score, 0);
const trust = getBuilderTrust(builderScore);

const committed = safeNum(launch.committed_sol);
const hardCap = safeNum(launch.hard_cap_sol);
const minRaise = safeNum(launch.min_raise_sol);
const participants = safeNum(launch.participants_count);
const percent = clamp(getCommitPercent(launch), 0, 100);
const softCapPercent = getSoftCapPercent(launch);
const timing = getTimingMeta(launch);
const stateNote = getLaunchStateNote(launch);
const momentumScore = Math.round(trendingScore(launch));

const builderHtml = builderWallet
? `<a href="./builder.html?wallet=${encodeURIComponent(builderWallet)}" style="color:rgba(255,255,255,.92);text-decoration:none;">${builderName}</a>`
: builderName;

return `
<div class="token-card">
<div class="token-head">
<div style="display:flex;gap:12px;align-items:flex-start;min-width:0;">
${getLogoHtml(launch)}
<div style="min-width:0;">
<div class="token-name">${name}</div>
<div class="token-symbol">${symbol} • ${template}</div>
</div>
</div>
<div class="badge ${badgeClass(status)}">${stageLabel(status)}</div>
</div>

<div class="meta-line" style="position:relative;z-index:1;color:rgba(255,255,255,.74);">
<span>${escapeHtml(stateNote)}</span>
</div>

<div class="builder-badges">${getBuilderBadges(launch)}</div>
${getSafeguardsHtml(launch)}

<div class="kv">
<div>
<div class="k">Builder</div>
<div class="v" style="font-size:16px;">${builderHtml}</div>
<div style="margin-top:6px;font-size:12px;color:rgba(255,255,255,.68);">
Score ${builderScore} • ${trust.label}
</div>
</div>
<div>
<div class="k">${escapeHtml(timing.label)}</div>
<div
class="v"
data-timing-label="${escapeHtml(timing.label)}"
data-status="${escapeHtml(status)}"
${timing.endAt ? `data-end-at="${timing.endAt}"` : ""}
>${escapeHtml(timing.value)}</div>
</div>
</div>

<div class="progress-wrap">
<div class="progress-top">
<span>${fmtSol(committed)} / ${fmtSol(hardCap)} SOL committed</span>
<strong>${percent}%</strong>
</div>
<div class="progress">
<div class="progress-fill ${percent >= 70 ? "hot" : ""}" style="width:${percent}%;"></div>
</div>
</div>

<div class="kv">
<div>
<div class="k">Participants</div>
<div class="v">${participants}</div>
</div>
<div>
<div class="k">Minimum Raise</div>
<div class="v">${fmtSol(minRaise)} SOL</div>
<div style="margin-top:6px;font-size:12px;color:rgba(255,255,255,.62);">
${minRaise > 0 ? `${Math.round(softCapPercent)}% of min raise` : "No minimum raise"}
</div>
</div>
</div>

<div class="live-feed">
${getFeedLines(launch)}
</div>

${buildQuickCommitBlock(launch)}

<div class="token-footer">
<div class="meta-line">
<span>Hard Cap: ${fmtSol(hardCap)} SOL</span>
<span>•</span>
<span>Template: ${template}</span>
<span>•</span>
<span>Momentum ${momentumScore}</span>
</div>

<a class="btn primary" href="${getLaunchHref(launch.id)}">View</a>
</div>
</div>
`;
}

function buildListRow(launch) {
const name = escapeHtml(launch.token_name || "Untitled Launch");
const symbol = escapeHtml(launch.symbol || "N/A");
const templateRaw = String(launch.template || "—");
const template = escapeHtml(templateRaw.replaceAll("_", " "));
const status = normalizeStatus(launch.status || "commit");
const builderName = escapeHtml(launch.builder_alias || launch.builder_wallet || "Unknown Builder");
const builderWallet = String(launch.builder_wallet || "").trim();
const builderScore = safeNum(launch.builder_score, 0);
const trust = getBuilderTrust(builderScore);

const committed = safeNum(launch.committed_sol);
const hardCap = safeNum(launch.hard_cap_sol);
const minRaise = safeNum(launch.min_raise_sol);
const participants = safeNum(launch.participants_count);
const percent = clamp(getCommitPercent(launch), 0, 100);
const timing = getTimingMeta(launch);
const momentumScore = Math.round(trendingScore(launch));
const stateNote = getLaunchStateNote(launch);

const builderHtml = builderWallet
? `<a href="./builder.html?wallet=${encodeURIComponent(builderWallet)}" style="color:rgba(255,255,255,.92);text-decoration:none;">${builderName}</a>`
: builderName;

return `
<div class="list-row">
<div class="list-row-top">
<div class="list-title-wrap">
<div style="display:flex;gap:12px;align-items:flex-start;min-width:0;">
${getLogoHtml(launch)}
<div style="min-width:0;">
<div class="token-name">${name}</div>
<div class="list-sub">${symbol} • ${template}</div>
<div style="margin-top:8px;font-size:13px;color:rgba(255,255,255,.82);">
${builderHtml} • Score ${builderScore} • ${trust.label}
</div>
<div style="margin-top:8px;font-size:12px;color:rgba(255,255,255,.62);line-height:1.5;">
${escapeHtml(stateNote)}
</div>
<div class="builder-badges" style="margin-top:10px;">${getBuilderBadges(launch)}</div>
<div style="margin-top:10px;">${getSafeguardsHtml(launch)}</div>
</div>
</div>
</div>

<div class="list-mid">
<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
<div class="badge ${badgeClass(status)}">${stageLabel(status)}</div>
<div
class="small-chip"
data-timing-chip="1"
data-timing-label="${escapeHtml(timing.label)}"
data-status="${escapeHtml(status)}"
${timing.endAt ? `data-end-at="${timing.endAt}"` : ""}
>${escapeHtml(timing.label)}: ${escapeHtml(timing.value)}</div>
<div class="small-chip">Momentum ${momentumScore}</div>
</div>

<div class="progress-wrap">
<div class="progress-top">
<span>${fmtSol(committed)} / ${fmtSol(hardCap)} SOL committed</span>
<strong>${percent}%</strong>
</div>
<div class="progress">
<div class="progress-fill ${percent >= 70 ? "hot" : ""}" style="width:${percent}%;"></div>
</div>
</div>

<div class="live-feed">
${getFeedLines(launch)}
</div>
</div>

<div class="list-actions">
${buildQuickCommitBlock(launch, { listMode: true })}
<a class="btn primary" href="${getLaunchHref(launch.id)}">View</a>
</div>
</div>

<div class="list-stats">
<div class="list-stat">
<div class="k">Participants</div>
<div class="v">${participants}</div>
</div>
<div class="list-stat">
<div class="k">Minimum Raise</div>
<div class="v">${fmtSol(minRaise)} SOL</div>
</div>
<div class="list-stat">
<div class="k">Hard Cap</div>
<div class="v">${fmtSol(hardCap)} SOL</div>
</div>
<div class="list-stat">
<div class="k">Progress</div>
<div class="v">${percent}%</div>
</div>
<div class="list-stat">
<div class="k">Template</div>
<div class="v">${template}</div>
</div>
</div>

<div class="list-footer">
<div class="meta-line">
<span>${escapeHtml(launch.description || "No description provided.")}</span>
</div>
</div>
</div>
`;
}

function buildGridSections(activeItems, historyItems = []) {
const sections = [
{
key: "countdown",
title: "Launching Soon",
items: activeItems.filter((x) => normalizeStatus(x.status) === "countdown"),
},
{
key: "building",
title: "Building Market",
items: activeItems.filter((x) => normalizeStatus(x.status) === "building"),
},
{
key: "commit",
title: "Commit Live Now",
items: activeItems.filter((x) => normalizeStatus(x.status) === "commit"),
},
{
key: "live",
title: "Live Tokens",
items: activeItems.filter((x) => normalizeStatus(x.status) === "live"),
},
{
key: "history",
title: "Historical Archive",
items: historyItems.filter((x) => isHistoricalStatus(x.status)),
},
];

const html = sections
.map((section) => {
if (!section.items.length) return "";
return `
<div class="list-section-title" style="grid-column:1/-1; margin:4px 2px 2px;">
${section.title}
</div>
${section.items.map(buildCard).join("")}
`;
})
.join("");

return html || `<div class="launch-empty-state" style="grid-column:1/-1;">No launches found.</div>`;
}

function renderListSections(activeItems, historyItems = []) {
const sections = [
{
key: "countdown",
title: "Launching Soon",
items: activeItems.filter((x) => normalizeStatus(x.status) === "countdown"),
},
{
key: "building",
title: "Building Market",
items: activeItems.filter((x) => normalizeStatus(x.status) === "building"),
},
{
key: "commit",
title: "Commit Live Now",
items: activeItems.filter((x) => normalizeStatus(x.status) === "commit"),
},
{
key: "live",
title: "Live Tokens",
items: activeItems.filter((x) => normalizeStatus(x.status) === "live"),
},
{
key: "history",
title: "Historical Archive",
items: historyItems.filter((x) => isHistoricalStatus(x.status)),
},
];

const html = sections
.map((section) => {
if (!section.items.length) return "";
return `
<div class="list-section">
<div class="list-section-title">${section.title}</div>
${section.items.map(buildListRow).join("")}
</div>
`;
})
.join("");

return html || `<div class="launch-empty-state">No launches found.</div>`;
}

function getFeaturedCandidate(items) {
const active = items.filter((x) => isActiveStatus(x.status)).slice().sort(compareTrending);
return active[0] || items[0] || null;
}

function renderFeaturedLaunch(items) {
const mount = $("featuredLaunchMount");
if (!mount) return;

const featured = getFeaturedCandidate(items);
if (!featured) {
mount.className = "featured-placeholder";
mount.innerHTML = `No featured launch available right now.`;
return;
}

mount.className = "featured-placeholder featured-live";

const name = escapeHtml(featured.token_name || "Untitled Launch");
const symbol = escapeHtml(featured.symbol || "N/A");
const template = escapeHtml(String(featured.template || "—").replaceAll("_", " "));
const status = normalizeStatus(featured.status);
const builderName = escapeHtml(featured.builder_alias || featured.builder_wallet || "Unknown Builder");
const builderWallet = String(featured.builder_wallet || "").trim();
const builderScore = safeNum(featured.builder_score, 0);
const trust = getBuilderTrust(builderScore);
const committed = safeNum(featured.committed_sol);
const hardCap = safeNum(featured.hard_cap_sol);
const minRaise = safeNum(featured.min_raise_sol);
const participants = safeNum(featured.participants_count);
const percent = clamp(getCommitPercent(featured), 0, 100);
const timing = getTimingMeta(featured);
const stateNote = getLaunchStateNote(featured);
const momentumScore = Math.round(trendingScore(featured));

const builderHtml = builderWallet
? `<a href="./builder.html?wallet=${encodeURIComponent(builderWallet)}" style="color:rgba(255,255,255,.92);text-decoration:none;">${builderName}</a>`
: builderName;

mount.innerHTML = `
<div class="featured-shell">
<div class="featured-main">
<div class="featured-main-top">
<div class="featured-main-meta">
${getLogoHtml(featured)}
<div style="min-width:0;">
<div class="token-name">${name}</div>
<div class="token-symbol">${symbol} • ${template}</div>
<div style="margin-top:8px;font-size:13px;color:rgba(255,255,255,.82);">
${builderHtml} • Score ${builderScore} • ${trust.label}
</div>
</div>
</div>
<div class="badge ${badgeClass(status)}">${stageLabel(status)}</div>
</div>

<div class="featured-main-copy">
${escapeHtml(stateNote)}
</div>

<div class="builder-badges">${getBuilderBadges(featured)}</div>
${getSafeguardsHtml(featured)}

<div class="progress-wrap">
<div class="progress-top">
<span>${fmtSol(committed)} / ${fmtSol(hardCap)} SOL committed</span>
<strong>${percent}%</strong>
</div>
<div class="progress">
<div class="progress-fill ${percent >= 70 ? "hot" : ""}" style="width:${percent}%;"></div>
</div>
</div>

<div class="live-feed">
${getFeedLines(featured)}
</div>
</div>

<div class="featured-side">
<div class="featured-side-grid">
<div class="featured-stat-card">
<div class="k">Timing</div>
<div
class="v"
data-timing-label="${escapeHtml(timing.label)}"
data-status="${escapeHtml(status)}"
${timing.endAt ? `data-end-at="${timing.endAt}"` : ""}
>${escapeHtml(timing.value)}</div>
</div>

<div class="featured-stat-card">
<div class="k">Momentum</div>
<div class="v">${momentumScore}</div>
</div>

<div class="featured-stat-card">
<div class="k">Participants</div>
<div class="v">${participants}</div>
</div>

<div class="featured-stat-card">
<div class="k">Min Raise</div>
<div class="v">${fmtSol(minRaise)} SOL</div>
</div>
</div>

${buildQuickCommitBlock(featured, { featured: true })}

<a class="btn primary featured-open-btn" href="${getLaunchHref(featured.id)}">Open Launch Terminal</a>
</div>
</div>
`;
}

const RECENT_CACHE = new Map();
const RECENT_CACHE_TTL_MS = 15000;
const RECENT_FETCH_LIMIT = 12;

let ALL_LAUNCHES = [];
let HISTORY_LAUNCHES = [];
let CURRENT_VIEW = normalizeView(localStorage.getItem("mss_launchpad_view"));
const PREV_PROGRESS = new Map();
let loadLaunchesInFlight = false;
let quickCommitInFlight = false;
let liveTimerIntervalId = null;
let fullRefreshIntervalId = null;

function setActionStatus(kind, message) {
const el = $("launchActionStatus");
if (!el) return;

if (!message) {
el.className = "status-banner";
el.textContent = "";
return;
}

el.className = `status-banner show ${kind}`;
el.textContent = message;
}

async function fetchJson(path, options = {}) {
const apiBase = getApiBase();
const res = await fetch(`${apiBase}${path}`, options);
const data = await res.json().catch(() => null);

if (!res.ok || (data && data.ok === false)) {
throw new Error(data?.error || `HTTP ${res.status}`);
}

return data;
}

function uniqueById(items) {
const seen = new Set();
const out = [];

for (const item of Array.isArray(items) ? items : []) {
const id = Number(item?.id);
if (!Number.isFinite(id)) continue;
if (seen.has(id)) continue;
seen.add(id);
out.push(item);
}

return out;
}

function mergeLaunchSources(primary, secondary) {
return uniqueById([
...(Array.isArray(primary) ? primary : []),
...(Array.isArray(secondary) ? secondary : []),
]);
}

async function enrichRecent(allLaunches) {
const now = Date.now();

const active = allLaunches
.filter((x) => isActiveStatus(x.status))
.slice()
.sort(compareTrending);

const topIdsToRefresh = active
.slice(0, RECENT_FETCH_LIMIT)
.map((launch) => Number(launch.id))
.filter((id) => Number.isFinite(id));

await Promise.all(
topIdsToRefresh.map(async (launchId) => {
const cached = RECENT_CACHE.get(launchId);
if (cached && now - cached.updatedAt < RECENT_CACHE_TTL_MS) {
return;
}

try {
const stats = await fetchJson(`/api/launcher/commits/${launchId}`);
RECENT_CACHE.set(launchId, {
updatedAt: Date.now(),
recent: Array.isArray(stats.recent) ? stats.recent : [],
});
} catch {
if (!RECENT_CACHE.has(launchId)) {
RECENT_CACHE.set(launchId, {
updatedAt: Date.now(),
recent: [],
});
}
}
})
);

return allLaunches.map((launch) => {
const cached = RECENT_CACHE.get(Number(launch.id));
return {
...launch,
recent: Array.isArray(cached?.recent) ? cached.recent : [],
};
});
}

async function loadLaunches() {
if (loadLaunchesInFlight) return;
loadLaunchesInFlight = true;

const meta = $("listMeta");

try {
if (meta) meta.textContent = "Loading launch field and archive…";

const data = await fetchJson(`/api/launcher/list`);

const rawAll = Array.isArray(data?.all) ? data.all : [];
const rawHistory = Array.isArray(data?.history) ? data.history : [];
const combined = mergeLaunchSources(rawAll, rawHistory);

let fieldLaunches = combined.filter((x) => isCurrentFieldStatus(x.status));
let historyLaunches = combined.filter((x) => isHistoricalStatus(x.status));

fieldLaunches = await enrichRecent(fieldLaunches);

for (const launch of fieldLaunches) {
const prev = PREV_PROGRESS.get(launch.id);
const next = getCommitPercent(launch);
launch.bumped = prev != null && next > prev;
PREV_PROGRESS.set(launch.id, next);
}

ALL_LAUNCHES = uniqueById(fieldLaunches);
HISTORY_LAUNCHES = uniqueById(historyLaunches);

if (meta) {
meta.textContent = `${ALL_LAUNCHES.length} active • ${HISTORY_LAUNCHES.length} history`;
}
} catch (err) {
console.error("Failed to load launches:", err);
ALL_LAUNCHES = [];
HISTORY_LAUNCHES = [];
if (meta) {
meta.textContent = "Unable to load launch field";
}
} finally {
loadLaunchesInFlight = false;
}

render();
}

function renderStats(items) {
const commitCount = items.filter((x) => normalizeStatus(x.status) === "commit").length;
const queueCount = items.filter((x) => {
const s = normalizeStatus(x.status);
return s === "countdown" || s === "building";
}).length;
const liveCount = items.filter((x) => normalizeStatus(x.status) === "live").length;

if ($("statCommit")) $("statCommit").textContent = String(commitCount);
if ($("statCountdown")) $("statCountdown").textContent = String(queueCount);
if ($("statLive")) $("statLive").textContent = String(liveCount);

const trending = items.slice().sort(compareTrending)[0];

if ($("statTrending")) {
$("statTrending").textContent = trending?.symbol || trending?.token_name || "—";
}
}

function applyViewState() {
const grid = $("launchGrid");
const list = $("launchList");
const gridBtn = $("gridViewBtn");
const listBtn = $("listViewBtn");

if (!grid || !list || !gridBtn || !listBtn) return;

const gridView = CURRENT_VIEW === "grid";

grid.classList.toggle("hidden", !gridView);
list.classList.toggle("hidden", gridView);

grid.style.display = gridView ? "grid" : "none";
list.style.display = gridView ? "grid" : "none";

grid.setAttribute("aria-hidden", gridView ? "false" : "true");
list.setAttribute("aria-hidden", gridView ? "true" : "false");

gridBtn.classList.toggle("active", gridView);
listBtn.classList.toggle("active", !gridView);

gridBtn.setAttribute("aria-pressed", gridView ? "true" : "false");
listBtn.setAttribute("aria-pressed", gridView ? "false" : "true");
}

function setCurrentView(view) {
CURRENT_VIEW = normalizeView(view);
localStorage.setItem("mss_launchpad_view", CURRENT_VIEW);
applyViewState();
render();
}

function sortItems(items, sort) {
const out = items.slice();

if (sort === "trending") {
out.sort(compareTrending);
} else if (sort === "progress") {
out.sort((a, b) => getCommitPercent(b) - getCommitPercent(a) || compareTrending(a, b));
} else if (sort === "participants") {
out.sort((a, b) => safeNum(b.participants_count) - safeNum(a.participants_count) || compareTrending(a, b));
} else if (sort === "ending") {
out.sort((a, b) => {
const aStatus = normalizeStatus(a.status);
const bStatus = normalizeStatus(b.status);

const aEnd =
aStatus === "countdown"
? parseTs(a.countdown_ends_at) ?? Number.MAX_SAFE_INTEGER
: aStatus === "commit"
? parseTs(a.commit_ends_at) ?? Number.MAX_SAFE_INTEGER
: Number.MAX_SAFE_INTEGER;

const bEnd =
bStatus === "countdown"
? parseTs(b.countdown_ends_at) ?? Number.MAX_SAFE_INTEGER
: bStatus === "commit"
? parseTs(b.commit_ends_at) ?? Number.MAX_SAFE_INTEGER
: Number.MAX_SAFE_INTEGER;

return aEnd - bEnd;
});
} else {
out.sort((a, b) => safeNum(b.id) - safeNum(a.id));
}

return out;
}

function updateLiveTimers() {
document.querySelectorAll("[data-end-at]").forEach((el) => {
const endAt = Number(el.getAttribute("data-end-at"));
const label = el.getAttribute("data-timing-label") || "Status";

if (!Number.isFinite(endAt)) return;

const nextValue = fmtTime(endAt - Date.now());

if (el.hasAttribute("data-timing-chip")) {
el.textContent = `${label}: ${nextValue}`;
} else {
el.textContent = nextValue;
}
});
}

function renderEmptyState() {
const grid = $("launchGrid");
const list = $("launchList");
if (!grid || !list) return;

grid.innerHTML = `<div class="launch-empty-state" style="grid-column:1/-1;">No launches found.</div>`;
list.innerHTML = `<div class="launch-empty-state">No launches found.</div>`;
bindQuickCommitButtons();
}

function render() {
const grid = $("launchGrid");
const list = $("launchList");
if (!grid || !list) return;

const q = cleanText($("lSearch")?.value || "", 120).toLowerCase();
const statusFilter = $("lStatus")?.value || "all";
const sort = $("lSort")?.value || "trending";

let activeItems = ALL_LAUNCHES.slice();
let historyItems = HISTORY_LAUNCHES.slice();

if (q) {
const matchesQuery = (x) => {
const hay = [
x.token_name,
x.symbol,
x.builder_alias,
x.builder_wallet,
x.template,
x.description,
]
.filter(Boolean)
.join(" ")
.toLowerCase();

return hay.includes(q);
};

activeItems = activeItems.filter(matchesQuery);
historyItems = historyItems.filter(matchesQuery);
}

activeItems = sortItems(activeItems, sort);
historyItems = sortItems(historyItems, sort);

renderStats(ALL_LAUNCHES);
renderFeaturedLaunch(activeItems.length ? activeItems : historyItems);
applyViewState();

if (statusFilter === "all") {
if (!activeItems.length && !historyItems.length) {
renderEmptyState();
return;
}

grid.innerHTML = buildGridSections(activeItems, historyItems);
list.innerHTML = renderListSections(activeItems, historyItems);
bindQuickCommitButtons();
updateLiveTimers();
return;
}

const combined = [...activeItems, ...historyItems];
const items = combined.filter((x) => matchesStatusFilter(x, statusFilter));

if (!items.length) {
renderEmptyState();
return;
}

grid.innerHTML = items.map(buildCard).join("");
list.innerHTML = items.map(buildListRow).join("");

bindQuickCommitButtons();
updateLiveTimers();
}

async function quickCommit(launchId, amount, btn = null) {
if (quickCommitInFlight) return;

const wallet = getConnectedPublicKey();

if (!wallet) {
setActionStatus("warn", "Connect your wallet before using quick commit.");
return;
}

quickCommitInFlight = true;

const originalText = btn ? btn.textContent : "";
const allQuickButtons = Array.from(
document.querySelectorAll(`.quick-commit-btn[data-launch-id="${Number(launchId)}"]`)
);

try {
allQuickButtons.forEach((el) => {
el.disabled = true;
el.classList.add("is-loading");
});

if (btn) {
btn.textContent = "Opening Wallet...";
}

setActionStatus("warn", `Preparing ${amount} SOL quick commit...`);

const prepare = await fetchJson(`/api/launcher/prepare-commit`, {
method: "POST",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify({
launchId: Number(launchId),
wallet,
solAmount: Number(amount),
}),
});

const destinationWallet = String(
prepare.escrowWallet || prepare.destinationWallet || prepare.to || ""
).trim();

if (!destinationWallet) {
throw new Error("Escrow wallet was not returned by the server.");
}

const lamports = Math.round(Number(amount) * 1_000_000_000);
if (!Number.isFinite(lamports) || lamports <= 0) {
throw new Error("Invalid quick commit amount.");
}

if (btn) {
btn.textContent = "Approve in Wallet...";
}

setActionStatus("warn", "Awaiting wallet approval...");

const transfer = await sendSolTransfer({
destination: destinationWallet,
lamports,
});

if (!transfer?.signature) {
throw new Error("Wallet transaction failed.");
}

if (btn) {
btn.textContent = "Confirming...";
}

setActionStatus("warn", "Confirming quick commit...");

const data = await fetchJson(`/api/launcher/confirm-commit`, {
method: "POST",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify({
launchId: Number(launchId),
wallet,
solAmount: Number(amount),
txSignature: transfer.signature,
}),
});

const countdownLine =
data.status === "countdown" && data.countdownEndsAt
? `\nCountdown ends at: ${data.countdownEndsAt}`
: "";

setActionStatus(
"good",
`Quick commit confirmed.\n\nCommitted: ${amount} SOL\nWallet total: ${data.walletCommittedTotal} SOL\nTotal committed: ${data.totalCommitted} SOL\nParticipants: ${data.participants}${countdownLine}`
);

if (btn) {
btn.textContent = "Confirmed";
btn.classList.add("is-success");
}

await loadLaunches();
} catch (err) {
console.error(err);
setActionStatus("bad", err.message || "Quick commit failed.");
} finally {
quickCommitInFlight = false;

setTimeout(() => {
allQuickButtons.forEach((el) => {
const launch = ALL_LAUNCHES.find((x) => Number(x.id) === Number(el.getAttribute("data-launch-id")));
const isCommitOpen = isQuickCommitPhase(launch?.status);
el.disabled = !isCommitOpen;
el.classList.remove("is-loading");
});

if (btn) {
btn.textContent = originalText || `${amount} SOL`;
btn.classList.remove("is-success");
}
}, 900);
}
}

function bindQuickCommitButtons() {
document.querySelectorAll(".quick-commit-btn").forEach((btn) => {
btn.onclick = async () => {
if (btn.disabled || quickCommitInFlight) return;

const launchId = Number(btn.getAttribute("data-launch-id"));
const amount = Number(btn.getAttribute("data-amount"));

if (!launchId || !amount) return;

await quickCommit(launchId, amount, btn);
};
});
}

function updateWalletUi() {
const walletState = getConnectedWallet();
const pill = $("lpWalletPill");
const connectBtn = $("lpConnectWalletBtn");
const disconnectBtn = $("lpDisconnectWalletBtn");

if (pill) {
pill.textContent = walletState.isConnected
? `Connected: ${walletState.shortPublicKey || shortenWallet(walletState.publicKey)}`
: "No wallet connected";
}

if (connectBtn) {
connectBtn.style.display = walletState.isConnected ? "none" : "inline-flex";
connectBtn.disabled = quickCommitInFlight;
}

if (disconnectBtn) {
disconnectBtn.style.display = walletState.isConnected ? "inline-flex" : "none";
disconnectBtn.disabled = quickCommitInFlight;
}
}

async function connectWallet() {
try {
const wallet = await connectAnyWallet();
updateWalletUi();
render();

if (wallet?.isConnected) {
setActionStatus("good", `Wallet connected: ${shortenWallet(wallet.publicKey)}`);
return;
}

setActionStatus("warn", "Wallet connection cancelled.");
} catch (err) {
const msg = err?.message || "Wallet connection failed.";
setActionStatus("bad", msg.includes("No supported wallet") ? getMobileWalletHelpText() : msg);
}
}

async function disconnectWallet() {
try {
await disconnectAnyWallet();
} catch {
// ignore
}

updateWalletUi();
render();
setActionStatus("warn", "Wallet disconnected.");
}

function bindViewToggle() {
$("gridViewBtn")?.addEventListener("click", () => {
setCurrentView("grid");
});

$("listViewBtn")?.addEventListener("click", () => {
setCurrentView("list");
});
}

function bindWalletControls() {
$("lpConnectWalletBtn")?.addEventListener("click", connectWallet);
$("lpDisconnectWalletBtn")?.addEventListener("click", disconnectWallet);

onWalletChange(() => {
updateWalletUi();
render();
});
}

async function init() {
if (!$("launchGrid") || !$("launchList")) return;

$("lSearch")?.addEventListener("input", render);
$("lStatus")?.addEventListener("change", render);
$("lSort")?.addEventListener("change", render);

bindViewToggle();
bindWalletControls();

await restoreWalletIfTrusted();
updateWalletUi();
applyViewState();

await loadLaunches();

if (liveTimerIntervalId) clearInterval(liveTimerIntervalId);
if (fullRefreshIntervalId) clearInterval(fullRefreshIntervalId);

liveTimerIntervalId = setInterval(() => {
updateLiveTimers();
}, 1000);

fullRefreshIntervalId = setInterval(() => {
if (document.hidden || quickCommitInFlight) return;
void loadLaunches();
}, 7000);
}

init();
