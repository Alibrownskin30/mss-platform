import {
getConnectedWallet as getConnectedWalletState,
getConnectedPublicKey,
onWalletChange,
restoreWalletIfTrusted,
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

function qs(name) {
return new URLSearchParams(window.location.search).get(name);
}

function safeNum(v, fallback = 0) {
const n = Number(v);
return Number.isFinite(n) ? n : fallback;
}

function safeInt(v, fallback = 0) {
return Math.max(0, Math.floor(safeNum(v, fallback)));
}

function clamp(n, min, max) {
return Math.max(min, Math.min(max, n));
}

function cleanText(value, max = 280) {
return String(value ?? "").trim().slice(0, max);
}

function normalizeWalletKey(value) {
return cleanText(value, 120).toLowerCase();
}

function escapeHtml(str) {
return String(str ?? "")
.replaceAll("&", "&amp;")
.replaceAll("<", "&lt;")
.replaceAll(">", "&gt;")
.replaceAll('"', "&quot;")
.replaceAll("'", "&#039;");
}

function normalizeStatus(value) {
return cleanText(value, 40).toLowerCase();
}

function statusLabel(status) {
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

function fmtSol(value, decimals = 2) {
const n = safeNum(value, 0);
return `${n.toFixed(decimals).replace(/\.?0+$/, "")} SOL`;
}

function fmtPct(value, decimals = 0) {
const n = safeNum(value, 0);
return `${n.toFixed(decimals).replace(/\.?0+$/, "")}%`;
}

function fmtCount(value) {
return safeInt(value, 0).toLocaleString("en-US");
}

function shortenWallet(wallet) {
const w = cleanText(wallet, 120);
if (!w) return "—";
if (w.length <= 12) return w;
return `${w.slice(0, 4)}...${w.slice(-4)}`;
}

function titleCase(value) {
return cleanText(value, 80)
.replaceAll("_", " ")
.replace(/\b\w/g, (m) => m.toUpperCase());
}

function getConnectedWallet() {
return getConnectedPublicKey() || "";
}

function getWalletFromUrlOrProvider() {
const fromUrl = qs("wallet");
if (fromUrl) return fromUrl;
return getConnectedWallet();
}

function getTrustProfile(score) {
const n = safeNum(score, 0);

if (n >= 80) {
return {
label: "Strong",
tier: "Prime",
note: "This builder currently shows strong trust alignment across their MSS profile.",
state: "good",
};
}

if (n >= 55) {
return {
label: "Moderate",
tier: "Verified",
note: "This builder currently shows moderate trust alignment across their MSS profile.",
state: "warn",
};
}

return {
label: "Early",
tier: "Emerging",
note: "This builder is still early-stage and building trust history within MSS.",
state: "neutral",
};
}

function getProfileTierLabel(value) {
const normalized = cleanText(value, 40).toLowerCase();
if (normalized === "elite") return "Elite";
if (normalized === "established") return "Established";
if (normalized === "early") return "Early";
return titleCase(value || "Early");
}

function getBadgeIcon(raw = {}) {
const explicit = cleanText(raw.icon || raw.short || raw.emoji, 8);
if (explicit) return explicit;

const key = cleanText(raw.key || raw.id || raw.slug, 80).toLowerCase();
const label = cleanText(raw.label || raw.name || raw.title, 80).toLowerCase();
const category = cleanText(raw.category || raw.tier, 40).toLowerCase();

if (key.includes("trust") || key.includes("profile") || label.includes("trust")) return "TR";
if (key.includes("graduat") || label.includes("graduat")) return "GR";
if (key.includes("bond") || label.includes("bond")) return "BD";
if (key.includes("team") || label.includes("team")) return "TM";
if (key.includes("capital") || label.includes("capital")) return "CM";
if (key.includes("community") || label.includes("community") || label.includes("crowd")) return "CS";
if (key.includes("launch") || label.includes("launch")) return "LN";
if (category.includes("market")) return "MK";
if (category.includes("trust")) return "TR";

return "BD";
}

function normalizeBadge(raw = {}) {
const key = cleanText(raw.key || raw.id || raw.slug || raw.label || raw.name, 80);
const name = cleanText(raw.label || raw.name || raw.title || key || "Badge", 80);
const description = cleanText(raw.description || raw.desc || "Badge progress.", 240);
const icon = getBadgeIcon(raw);
const tier = cleanText(raw.tier || raw.category || "Core", 40) || "Core";
const category = cleanText(raw.category || raw.tier || "general", 40) || "general";
const unlocked = Boolean(raw.unlocked ?? raw.is_unlocked ?? raw.earned ?? false);
const state = cleanText(raw.state || (unlocked ? "good" : "neutral"), 20) || "neutral";
const order = safeInt(raw.order, 0);

const current = safeNum(raw.progress_current ?? raw.current, 0);
const target = Math.max(1, safeNum(raw.progress_target ?? raw.target, 1));

const progressPct =
raw.progress_pct != null || raw.progressPct != null
? clamp(safeNum(raw.progress_pct ?? raw.progressPct, 0), 0, 100)
: clamp((current / target) * 100, 0, 100);

const progressLabel =
cleanText(raw.progress_text || raw.progress_label || raw.progressLabel, 120) ||
(unlocked ? "Unlocked" : `${Math.min(current, target)} / ${target}`);

return {
key,
name,
description,
icon,
tier,
category,
unlocked,
state,
order,
current,
target,
progress_pct: progressPct,
progress_label: progressLabel,
};
}

function createFallbackBadges(builder, launches, totals) {
const score = safeNum(builder?.builder_score, 0);
const defs = [
{
key: "profile_active",
label: "Profile Active",
description: "Builder profile is active on MSS.",
category: "identity",
tier: "Base",
state: "good",
progress_current: 1,
progress_target: 1,
unlocked: true,
progress_text: "Active",
order: 1,
},
{
key: "trusted_builder",
label: "Trusted Builder",
description: "Reached the Moderate trust threshold.",
category: "trust",
tier: "Bronze",
state: score >= 55 ? "warn" : "neutral",
progress_current: score,
progress_target: 55,
unlocked: score >= 55,
progress_text: `${Math.min(Math.round(score), 55)} / 55`,
order: 2,
},
{
key: "strong_builder",
label: "Strong Builder",
description: "Reached the Strong trust threshold.",
category: "trust",
tier: "Gold",
state: score >= 80 ? "good" : "neutral",
progress_current: score,
progress_target: 80,
unlocked: score >= 80,
progress_text: `${Math.min(Math.round(score), 80)} / 80`,
order: 3,
},
{
key: "first_launch",
label: "First Launch",
description: "Created the first launch on MSS.",
category: "execution",
tier: "Base",
state: safeInt(totals.all, 0) >= 1 ? "good" : "neutral",
progress_current: safeInt(totals.all, 0),
progress_target: 1,
unlocked: safeInt(totals.all, 0) >= 1,
progress_text: `${Math.min(safeInt(totals.all, 0), 1)} / 1`,
order: 4,
},
{
key: "live_market",
label: "Live Market",
description: "Took a launch into live or graduated market state.",
category: "market",
tier: "Bronze",
state: safeInt(totals.live_or_graduated, 0) >= 1 ? "good" : "neutral",
progress_current: safeInt(totals.live_or_graduated, 0),
progress_target: 1,
unlocked: safeInt(totals.live_or_graduated, 0) >= 1,
progress_text: `${Math.min(safeInt(totals.live_or_graduated, 0), 1)} / 1`,
order: 5,
},
{
key: "graduated_launch",
label: "Graduated Launch",
description: "Completed at least one graduation cycle.",
category: "market",
tier: "Silver",
state: safeInt(totals.graduated, 0) >= 1 ? "good" : "neutral",
progress_current: safeInt(totals.graduated, 0),
progress_target: 1,
unlocked: safeInt(totals.graduated, 0) >= 1,
progress_text: `${Math.min(safeInt(totals.graduated, 0), 1)} / 1`,
order: 6,
},
];

return defs.map(normalizeBadge);
}

function normalizeBadges(data, builder, launches, totals) {
const backendBadges =
Array.isArray(data?.badges) ? data.badges
: Array.isArray(data?.builder?.badges) ? data.builder.badges
: Array.isArray(data?.badge_catalog) ? data.badge_catalog
: Array.isArray(data?.badgeCatalog) ? data.badgeCatalog
: null;

if (backendBadges?.length) {
return backendBadges.map(normalizeBadge).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

return createFallbackBadges(builder, launches, totals);
}

function normalizeAchievements(data, badges) {
const backendAchievements =
Array.isArray(data?.achievements) ? data.achievements
: Array.isArray(data?.builder?.achievements) ? data.builder.achievements
: null;

if (backendAchievements?.length) {
return backendAchievements
.map((item) => normalizeBadge({ ...item, unlocked: true, progress_text: item?.progress_text || "Unlocked" }))
.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

return badges.filter((badge) => badge.unlocked);
}

function normalizeLaunch(launch = {}) {
const committed = safeNum(launch.committed_sol, 0);
const minRaise = safeNum(launch.min_raise_sol, 0);
const hardCap = safeNum(launch.hard_cap_sol, 0);
const participants = safeInt(launch.participants_count, 0);
const teamAllocation = safeNum(launch.team_allocation_pct, 0);
const builderBond = safeNum(launch.builder_bond_sol, 0);
const builderBondRefunded = safeInt(launch.builder_bond_refunded, 0);
const status = normalizeStatus(launch.status);
const commitPercent =
launch.commit_percent != null
? clamp(safeNum(launch.commit_percent, 0), 0, 100)
: hardCap > 0
? clamp((committed / hardCap) * 100, 0, 100)
: 0;

return {
...launch,
status,
committed_sol: committed,
min_raise_sol: minRaise,
hard_cap_sol: hardCap,
participants_count: participants,
team_allocation_pct: teamAllocation,
builder_bond_sol: builderBond,
builder_bond_refunded: builderBondRefunded,
commit_percent: commitPercent,
min_raise_reached:
launch.min_raise_reached != null
? Boolean(launch.min_raise_reached)
: minRaise > 0 && committed >= minRaise,
hard_cap_reached:
launch.hard_cap_reached != null
? Boolean(launch.hard_cap_reached)
: hardCap > 0 && committed >= hardCap,
};
}

function summarizeLaunches(launches = []) {
const rows = Array.isArray(launches) ? launches.map(normalizeLaunch) : [];

const commit = rows.filter((x) => x.status === "commit").length;
const countdown = rows.filter((x) => x.status === "countdown").length;
const live = rows.filter((x) => x.status === "live").length;
const graduated = rows.filter((x) => x.status === "graduated").length;
const failed = rows.filter((x) => x.status === "failed").length;
const failedRefunded = rows.filter((x) => x.status === "failed_refunded").length;
const liveOrGraduated = live + graduated;
const activePipeline = commit + countdown;

const totalCommittedSol = rows.reduce((sum, launch) => sum + safeNum(launch.committed_sol, 0), 0);
const totalParticipants = rows.reduce((sum, launch) => sum + safeInt(launch.participants_count, 0), 0);
const bondedLaunches = rows.filter((x) => safeNum(x.builder_bond_sol, 0) > 0).length;
const teamAllocationLaunches = rows.filter((x) => safeNum(x.team_allocation_pct, 0) > 0).length;

return {
all: rows.length,
commit,
countdown,
live,
graduated,
failed,
failed_refunded: failedRefunded,
failed_closed: failed + failedRefunded,
live_or_graduated: liveOrGraduated,
active_pipeline: activePipeline,
total_committed_sol: Number(totalCommittedSol.toFixed(4)),
total_participants: totalParticipants,
bonded_launches: bondedLaunches,
team_allocation_launches: teamAllocationLaunches,
};
}

async function fetchBuilder(wallet) {
const apiBase = getApiBase();
const res = await fetch(`${apiBase}/api/builders/${encodeURIComponent(wallet)}`);

let data = null;
try {
data = await res.json();
} catch {
data = null;
}

if (!res.ok || !data?.ok) {
throw new Error(data?.error || `HTTP ${res.status}`);
}

return data;
}

async function updateBuilderAlias(wallet, alias) {
const apiBase = getApiBase();
const res = await fetch(`${apiBase}/api/builders/update`, {
method: "POST",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify({
wallet,
alias,
}),
});

let data = null;
try {
data = await res.json();
} catch {
data = null;
}

if (!res.ok || !data?.ok || !data?.builder) {
throw new Error(data?.error || "Failed to update builder alias.");
}

return data.builder;
}

function setStatus(message, kind = "bad") {
const el = $("builderStatus");
if (!el) return;

el.className = `status show ${kind}`;
el.textContent = message;
}

function clearStatus() {
const el = $("builderStatus");
if (!el) return;

el.className = "status";
el.textContent = "";
}

function renderEditState(profileWallet) {
const editCard = $("editProfileCard");
const connectedWallet = getConnectedWallet();

if (!editCard) return;

if (
connectedWallet &&
profileWallet &&
normalizeWalletKey(connectedWallet) === normalizeWalletKey(profileWallet)
) {
editCard.classList.remove("hidden");
} else {
editCard.classList.add("hidden");
}
}

function renderProfileHighlights(data, builder, totals, achievements, badges) {
const wrap = $("profileHighlights");
if (!wrap) return;

const backendHighlights = Array.isArray(data?.highlights)
? data.highlights
: Array.isArray(data?.builder?.highlights)
? data.builder.highlights
: [];

const labels = backendHighlights.length
? backendHighlights
: (() => {
const trust = getTrustProfile(builder?.builder_score);
const out = [trust.tier];

if (safeInt(totals.live_or_graduated, 0) > 0) {
out.push(`${totals.live_or_graduated} Live`);
}

if (safeInt(totals.graduated, 0) > 0) {
out.push(`${totals.graduated} Graduated`);
}

const unlocked = badges.filter((x) => x.unlocked).length;
if (unlocked > 0) {
out.push(`${unlocked} Badges`);
}

if (safeInt(totals.bonded_launches, 0) > 0) {
out.push("Bonded Builder");
}

if (!out.length && achievements.length) {
out.push("Achievement Profile");
}

return out;
})();

if (!labels.length) {
wrap.innerHTML = `<span class="highlight-chip">No achievements yet</span>`;
return;
}

wrap.innerHTML = labels
.slice(0, 6)
.map((label) => `<span class="highlight-chip">${escapeHtml(label)}</span>`)
.join("");
}

function renderHeader(data, builder, totals, achievements, badges) {
const trust = getTrustProfile(builder?.builder_score);
const profileSummary =
data?.profile_summary ||
builder?.profile_summary || {
profile_tier: builder?.profile_tier || "early",
completion_pct:
badges.length > 0 ? Number(((badges.filter((x) => x.unlocked).length / badges.length) * 100).toFixed(1)) : 0,
unlocked_badges: badges.filter((x) => x.unlocked).length,
total_badges: badges.length,
};

const badgeSummary =
data?.badge_summary ||
builder?.badge_summary || {
unlocked: badges.filter((x) => x.unlocked).length,
total: badges.length,
completion_pct: profileSummary.completion_pct || 0,
};

$("builderAlias").textContent = builder?.alias || "Unknown Builder";
$("builderWallet").textContent = builder?.wallet || "—";
$("builderScore").textContent = String(safeNum(builder?.builder_score, 0));
$("builderTrust").textContent = trust.label;
$("profileTier").textContent = getProfileTierLabel(profileSummary.profile_tier || builder?.profile_tier);
$("builderTrustNote").textContent = trust.note;

$("statAll").textContent = String(safeInt(totals.all, 0));
$("statLive").textContent = String(safeInt(totals.live_or_graduated, 0));
$("statGraduated").textContent = String(safeInt(totals.graduated, 0));
$("statCommit").textContent = String(safeInt(totals.active_pipeline, 0));
$("statFailed").textContent = String(safeInt(totals.failed_closed, 0));

$("badgeUnlockedCount").textContent = String(safeInt(badgeSummary.unlocked, 0));
$("badgeTotalCount").textContent = String(safeInt(badgeSummary.total, badges.length));
$("profileCompletion").textContent = `${Math.round(safeNum(badgeSummary.completion_pct ?? profileSummary.completion_pct, 0))}% Complete`;

$("badgeCompletionPct").textContent = `${Math.round(safeNum(badgeSummary.completion_pct ?? profileSummary.completion_pct, 0))}%`;
$("statCountdown").textContent = String(safeInt(totals.active_pipeline, 0));
$("totalCommittedSol").textContent = fmtSol(totals.total_committed_sol, 2);
$("totalParticipants").textContent = fmtCount(totals.total_participants);
$("publicTrustTier").textContent = getProfileTierLabel(profileSummary.profile_tier || builder?.profile_tier || trust.tier);

const aliasInput = $("builderAliasInput");
if (aliasInput) {
aliasInput.value = builder?.alias || "";
}

renderProfileHighlights(data, builder, totals, achievements, badges);
}

function renderAchievements(achievements) {
const el = $("achievementList");
if (!el) return;

if (!Array.isArray(achievements) || !achievements.length) {
el.innerHTML = `<div class="empty">No achievements unlocked yet.</div>`;
return;
}

el.innerHTML = achievements
.map((achievement) => {
return `
<div class="achievement-card">
<div class="achievement-top">
<div class="achievement-badge">${escapeHtml(achievement.icon || "AC")}</div>
<div class="achievement-state">${escapeHtml(achievement.progress_label || "Unlocked")}</div>
</div>

<div class="achievement-title">${escapeHtml(achievement.name || "Achievement")}</div>
<div class="achievement-desc">${escapeHtml(achievement.description || "Achievement unlocked.")}</div>

<div class="achievement-meta">
<span class="mini-chip">${escapeHtml(titleCase(achievement.tier || "Achievement"))}</span>
<span class="mini-chip">${escapeHtml(titleCase(achievement.category || "Unlocked"))}</span>
</div>
</div>
`;
})
.join("");
}

function renderBadgeGrid(badges) {
const el = $("badgeGrid");
if (!el) return;

if (!Array.isArray(badges) || !badges.length) {
el.innerHTML = `<div class="empty">No badge catalogue available yet.</div>`;
return;
}

el.innerHTML = badges
.map((badge) => {
const width = clamp(safeNum(badge.progress_pct, 0), 0, 100);

return `
<div class="badge-card ${badge.unlocked ? "is-unlocked" : "is-locked"}">
<div class="badge-card-top">
<div class="badge-icon">${escapeHtml(badge.icon || "BD")}</div>
<div class="badge-tier">${escapeHtml(titleCase(badge.tier || "Core"))}</div>
</div>

<div class="badge-name">${escapeHtml(badge.name || "Badge")}</div>
<div class="badge-desc">${escapeHtml(badge.description || "Badge progress.")}</div>

<div class="badge-progress">
<div class="progress-meta">
<span>${escapeHtml(badge.progress_label || "In progress")}</span>
<span>${Math.round(width)}%</span>
</div>
<div class="progress">
<div class="progress-fill" style="width:${width}%;"></div>
</div>
</div>
</div>
`;
})
.join("");
}

function renderLaunchMetaChips(launch) {
const chips = [];
const status = normalizeStatus(launch.status);

if (String(launch.template || "") === "builder") {
chips.push(`<span class="mini-chip">Builder Launch</span>`);
}

if (safeNum(launch.team_allocation_pct, 0) > 0) {
chips.push(`<span class="mini-chip">Team ${fmtPct(launch.team_allocation_pct)}</span>`);
}

if (safeNum(launch.builder_bond_sol, 0) > 0) {
const refunded = safeInt(launch.builder_bond_refunded, 0) === 1;
chips.push(`<span class="mini-chip">Bond ${fmtSol(launch.builder_bond_sol)}${refunded ? " • Refunded" : ""}</span>`);
}

if (launch.min_raise_reached) {
chips.push(`<span class="mini-chip">Min Raise Reached</span>`);
}

if (launch.hard_cap_reached) {
chips.push(`<span class="mini-chip">Hard Cap Hit</span>`);
}

if (status === "live" || status === "graduated") {
chips.push(`<span class="mini-chip">Market Active</span>`);
}

return chips.join("");
}

function renderLaunchNote(launch) {
const status = normalizeStatus(launch.status);

if (status === "commit") {
return "This launch is currently open for commitments.";
}

if (status === "countdown") {
return "This launch has reached countdown and is arming for market activation.";
}

if (status === "building") {
return "This launch is finalizing infrastructure between countdown and live state.";
}

if (status === "live") {
return "This launch is now live on the MSS internal market.";
}

if (status === "graduated") {
return "This launch has completed the initial lifecycle and moved into graduated state.";
}

if (status === "failed_refunded") {
return "This failed launch has already been refunded and closed.";
}

if (status === "failed") {
return "This launch failed to reach minimum raise and remains in failed state until refund handling is complete.";
}

return "Launch lifecycle data is being tracked.";
}

function renderLaunches(launches) {
const list = $("launchList");
if (!list) return;

if (!Array.isArray(launches) || !launches.length) {
list.innerHTML = `<div class="empty">This builder has no launches yet.</div>`;
return;
}

list.innerHTML = launches
.map((rawLaunch) => {
const launch = normalizeLaunch(rawLaunch);
const committed = safeNum(launch.committed_sol, 0);
const hardCap = safeNum(launch.hard_cap_sol, 0);
const participants = safeInt(launch.participants_count, 0);
const minRaise = safeNum(launch.min_raise_sol, 0);
const status = launch.status;
const template = escapeHtml(String(launch.template || "—").replaceAll("_", " "));
const progressPct = clamp(safeNum(launch.commit_percent, 0), 0, 100);

return `
<div class="launch-row">
<div class="launch-top">
<div>
<div class="launch-name">${escapeHtml(launch.token_name || "Untitled Launch")}</div>
<div class="launch-sub">
${escapeHtml(launch.symbol || "—")} • ${template} • Launch #${safeInt(launch.id, 0)}
</div>
</div>
<div class="badge ${badgeClass(status)}">${statusLabel(status)}</div>
</div>

<div class="launch-chip-row">
${renderLaunchMetaChips(launch)}
</div>

<div class="launch-progress">
<div class="launch-progress-top">
<span>${fmtSol(committed)} / ${fmtSol(hardCap)} committed</span>
<strong>${Math.round(progressPct)}%</strong>
</div>
<div class="progress">
<div class="progress-fill" style="width:${progressPct}%;"></div>
</div>
</div>

<div class="launch-metrics">
<div class="launch-metric">
<div class="k">Committed</div>
<div class="v">${fmtSol(committed)}</div>
</div>
<div class="launch-metric">
<div class="k">Participants</div>
<div class="v">${fmtCount(participants)}</div>
</div>
<div class="launch-metric">
<div class="k">Minimum Raise</div>
<div class="v">${fmtSol(minRaise)}</div>
</div>
<div class="launch-metric">
<div class="k">Hard Cap</div>
<div class="v">${fmtSol(hardCap)}</div>
</div>
</div>

<div class="launch-note">${escapeHtml(renderLaunchNote(launch))}</div>

<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;position:relative;z-index:1;">
<div style="font-size:12px;color:rgba(255,255,255,.62);">
Builder score at render: ${safeNum(launch.builder_score, 0)} • Public status ${statusLabel(status)}
</div>
<a class="btn primary" href="./launch.html?id=${encodeURIComponent(launch.id)}">View Launch</a>
</div>
</div>
`;
})
.join("");
}

function renderNoWalletState() {
$("builderAlias").textContent = "No Builder Selected";
$("builderWallet").textContent = "—";
$("builderScore").textContent = "—";
$("builderTrust").textContent = "—";
$("profileTier").textContent = "—";
$("builderTrustNote").textContent =
"Connect Phantom, Solflare, or Backpack, or open this page from a builder link to view a builder profile.";

$("statAll").textContent = "0";
$("statLive").textContent = "0";
$("statGraduated").textContent = "0";
$("statCommit").textContent = "0";
$("statFailed").textContent = "0";

$("badgeUnlockedCount").textContent = "0";
$("badgeTotalCount").textContent = "0";
$("profileCompletion").textContent = "0% Complete";

$("badgeCompletionPct").textContent = "0%";
$("statCountdown").textContent = "0";
$("totalCommittedSol").textContent = "0 SOL";
$("totalParticipants").textContent = "0";
$("publicTrustTier").textContent = "—";

const highlightWrap = $("profileHighlights");
if (highlightWrap) {
highlightWrap.innerHTML = `<span class="highlight-chip">No achievements yet</span>`;
}

const achievementList = $("achievementList");
if (achievementList) {
achievementList.innerHTML = `<div class="empty">No builder wallet detected. Open a builder profile from launchpad, or connect Phantom, Solflare, or Backpack and return here.</div>`;
}

const badgeGrid = $("badgeGrid");
if (badgeGrid) {
badgeGrid.innerHTML = `<div class="empty">Badge catalogue unavailable until a builder profile is loaded.</div>`;
}

const list = $("launchList");
if (list) {
list.innerHTML = `<div class="empty">No builder wallet detected. Open a builder profile from launchpad, or connect Phantom, Solflare, or Backpack and return here.</div>`;
}

renderEditState("");
setStatus("No builder wallet was detected for this page.", "warn");
}

let currentProfileWallet = "";
let currentProfileLockedToUrl = Boolean(qs("wallet"));

async function loadProfile(wallet, { showLoadError = true } = {}) {
clearStatus();

if (!wallet) {
renderNoWalletState();
return;
}

const data = await fetchBuilder(wallet);
const builder = data?.builder || {};
const launches = Array.isArray(data?.launches) ? data.launches.map(normalizeLaunch) : [];
const derivedTotals = summarizeLaunches(launches);
const backendTotals = data?.totals || {};

const totals = {
...derivedTotals,
...backendTotals,
live_or_graduated:
safeInt(backendTotals.live, 0) + safeInt(backendTotals.graduated, 0) > 0
? safeInt(backendTotals.live, 0) + safeInt(backendTotals.graduated, 0)
: derivedTotals.live_or_graduated,
failed_closed:
safeInt(backendTotals.failed, 0) + safeInt(backendTotals.failed_refunded, 0) > 0
? safeInt(backendTotals.failed, 0) + safeInt(backendTotals.failed_refunded, 0)
: derivedTotals.failed_closed,
active_pipeline:
safeInt(backendTotals.commit, 0) + safeInt(backendTotals.countdown, 0) > 0
? safeInt(backendTotals.commit, 0) + safeInt(backendTotals.countdown, 0)
: derivedTotals.active_pipeline,
};

const badges = normalizeBadges(data, builder, launches, totals);
const achievements = normalizeAchievements(data, badges);

currentProfileWallet = cleanText(builder.wallet || wallet, 120);

renderHeader(data, builder, totals, achievements, badges);
renderEditState(currentProfileWallet);
renderAchievements(achievements);
renderBadgeGrid(badges);
renderLaunches(launches);
bindAliasSave(currentProfileWallet);

if (showLoadError === false) {
clearStatus();
}
}

function bindAliasSave(wallet) {
const btn = $("saveBuilderAliasBtn");
const input = $("builderAliasInput");
if (!btn || !input || !wallet) return;

btn.onclick = async () => {
const alias = String(input.value || "").trim().replace(/\s+/g, " ");

if (!alias) {
setStatus("Alias is required.", "bad");
return;
}

if (alias.length < 2) {
setStatus("Alias must be at least 2 characters.", "bad");
return;
}

btn.disabled = true;
const oldText = btn.textContent;
btn.textContent = "Saving...";

try {
await updateBuilderAlias(wallet, alias);
await loadProfile(wallet, { showLoadError: false });
setStatus("Builder alias updated successfully.", "good");
} catch (err) {
console.error(err);
setStatus(err.message || "Failed to update builder alias.", "bad");
} finally {
btn.disabled = false;
btn.textContent = oldText;
}
};
}

async function handleWalletDrivenRefresh() {
const connectedWallet = getConnectedWallet();

if (!currentProfileLockedToUrl) {
if (!connectedWallet) {
renderNoWalletState();
return;
}

try {
await loadProfile(connectedWallet, { showLoadError: false });
} catch (err) {
console.error(err);
setStatus(err.message || "Failed to refresh builder profile.", "bad");
}
return;
}

renderEditState(currentProfileWallet);
}

async function init() {
try {
await restoreWalletIfTrusted();

const wallet = getWalletFromUrlOrProvider();
if (!wallet) {
renderNoWalletState();
} else {
await loadProfile(wallet, { showLoadError: false });
}
} catch (err) {
console.error(err);
setStatus(err.message || "Failed to load builder profile.", "bad");
}

onWalletChange(() => {
void handleWalletDrivenRefresh();
});

const state = getConnectedWalletState();
if (state?.isConnected) {
renderEditState(currentProfileWallet);
}
}

init();
