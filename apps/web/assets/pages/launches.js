import {
connectWallet as connectAnyWallet,
disconnectWallet as disconnectAnyWallet,
getConnectedWallet,
getConnectedPublicKey,
onWalletChange,
restoreWalletIfTrusted,
getMobileWalletHelpText,
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

function escapeHtml(str) {
return String(str ?? "")
.replaceAll("&", "&amp;")
.replaceAll("<", "&lt;")
.replaceAll(">", "&gt;")
.replaceAll('"', "&quot;")
.replaceAll("'", "&#039;");
}

function stageLabel(status) {
if (status === "commit") return "Commit";
if (status === "countdown") return "Countdown";
if (status === "live") return "Live";
if (status === "graduated") return "Graduated";
if (status === "failed") return "Failed";
if (status === "failed_refunded") return "Refunded";
return "Unknown";
}

function badgeClass(status) {
if (status === "countdown") return "countdown";
if (status === "live" || status === "graduated") return "live";
if (status === "failed") return "failed";
if (status === "failed_refunded") return "refunded";
return "commit";
}

function safeNum(v, fallback = 0) {
const n = Number(v);
return Number.isFinite(n) ? n : fallback;
}

function parseTs(v) {
if (!v) return null;
const ms = Date.parse(String(v).replace(" ", "T") + "Z");
return Number.isFinite(ms) ? ms : null;
}

function getBuilderTrust(score) {
const n = safeNum(score, 0);

if (n >= 80) {
return { label: "Strong", state: "strong" };
}
if (n >= 55) {
return { label: "Moderate", state: "moderate" };
}
return { label: "Early", state: "early" };
}

function fmtSol(n) {
const v = safeNum(n, 0);
return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function shortenWallet(wallet) {
const w = String(wallet || "").trim();
if (!w) return "No wallet connected";
if (w.length <= 12) return w;
return `${w.slice(0, 4)}...${w.slice(-4)}`;
}

function getLogoHtml(launch) {
const imageUrl = String(launch.image_url || "").trim();
return imageUrl
? `<div class="logo-box"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(launch.token_name || "Launch")} logo" /></div>`
: `<div class="logo-box">Logo</div>`;
}

function getTimingMeta(launch) {
const status = launch.status || "commit";
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

if (status === "live") {
return {
label: "Status",
value: "LIVE",
};
}

return {
label: "Status",
value: stageLabel(status),
};
}

function getBuilderBadges(launch) {
const out = [];
if (String(launch.template || "") === "builder") {
if (safeNum(launch.team_allocation_pct) > 0) {
out.push(`<span class="small-chip">Team ${fmtSol(launch.team_allocation_pct)}%</span>`);
}
if (safeNum(launch.builder_bond_sol) > 0) {
out.push(`<span class="small-chip">Bond ${fmtSol(launch.builder_bond_sol)} SOL</span>`);
}
}
return out.join("");
}

function buildCard(launch) {
const name = escapeHtml(launch.token_name || "Untitled Launch");
const symbol = escapeHtml(launch.symbol || "N/A");
const templateRaw = String(launch.template || "—");
const template = escapeHtml(templateRaw.replaceAll("_", " "));
const status = launch.status || "commit";
const builderName = escapeHtml(launch.builder_alias || launch.builder_wallet || "Unknown Builder");
const builderWallet = String(launch.builder_wallet || "").trim();
const builderScore = safeNum(launch.builder_score, 0);
const trust = getBuilderTrust(builderScore);

const committed = safeNum(launch.committed_sol);
const hardCap = safeNum(launch.hard_cap_sol);
const minRaise = safeNum(launch.min_raise_sol);
const participants = safeNum(launch.participants_count);
const percent = clamp(safeNum(launch.commitPercent), 0, 100);
const timing = getTimingMeta(launch);

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

<div class="builder-badges">${getBuilderBadges(launch)}</div>

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
<div class="v">${escapeHtml(timing.value)}</div>
</div>
</div>

<div class="progress-wrap">
<div class="progress-top">
<span>${fmtSol(committed)} / ${fmtSol(hardCap)} SOL committed</span>
<strong>${percent}%</strong>
</div>
<div class="progress">
<div class="progress-fill" style="width:${percent}%;"></div>
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
</div>
</div>

<div class="token-footer">
<div class="meta-line">
<span>Hard Cap: ${fmtSol(hardCap)} SOL</span>
<span>•</span>
<span>Template: ${template}</span>
</div>

<a class="btn primary" href="./launch.html?id=${encodeURIComponent(launch.id)}">View</a>
</div>
</div>
`;
}

function buildQuickButtons(launch) {
const status = String(launch.status || "");
const disabled = status !== "commit" ? "disabled" : "";
const amounts = [0.1, 0.25, 0.5, 0.75, 1];

return amounts.map((amount) => {
return `<button type="button" class="quick-commit-btn" data-launch-id="${launch.id}" data-amount="${amount}" ${disabled}>${amount} SOL</button>`;
}).join("");
}

function buildListRow(launch) {
const name = escapeHtml(launch.token_name || "Untitled Launch");
const symbol = escapeHtml(launch.symbol || "N/A");
const templateRaw = String(launch.template || "—");
const template = escapeHtml(templateRaw.replaceAll("_", " "));
const status = launch.status || "commit";
const builderName = escapeHtml(launch.builder_alias || launch.builder_wallet || "Unknown Builder");
const builderWallet = String(launch.builder_wallet || "").trim();
const builderScore = safeNum(launch.builder_score, 0);
const trust = getBuilderTrust(builderScore);

const committed = safeNum(launch.committed_sol);
const hardCap = safeNum(launch.hard_cap_sol);
const minRaise = safeNum(launch.min_raise_sol);
const participants = safeNum(launch.participants_count);
const percent = clamp(safeNum(launch.commitPercent), 0, 100);
const timing = getTimingMeta(launch);

const builderHtml = builderWallet
? `<a href="./builder.html?wallet=${encodeURIComponent(builderWallet)}" style="color:rgba(255,255,255,.92);text-decoration:none;">${builderName}</a>`
: builderName;

const walletConnected = getConnectedWallet().isConnected;

return `
<div class="list-row">
<div class="list-row-top">
<div class="list-title-wrap">
${getLogoHtml(launch)}
<div style="min-width:0;">
<div class="token-name">${name}</div>
<div class="list-sub">${symbol} • ${template}</div>
<div style="margin-top:8px;font-size:13px;color:rgba(255,255,255,.82);">
${builderHtml} • Score ${builderScore} • ${trust.label}
</div>
<div class="builder-badges" style="margin-top:10px;">${getBuilderBadges(launch)}</div>
</div>
</div>

<div class="list-mid">
<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
<div class="badge ${badgeClass(status)}">${stageLabel(status)}</div>
<div class="small-chip">${escapeHtml(timing.label)}: ${escapeHtml(timing.value)}</div>
</div>

<div class="progress-wrap">
<div class="progress-top">
<span>${fmtSol(committed)} / ${fmtSol(hardCap)} SOL committed</span>
<strong>${percent}%</strong>
</div>
<div class="progress">
<div class="progress-fill" style="width:${percent}%;"></div>
</div>
</div>
</div>

<div class="list-actions">
<div class="quick-row">
${buildQuickButtons(launch)}
</div>
<div style="font-size:12px;color:rgba(255,255,255,.62);">
${walletConnected ? "Quick commit enabled" : "Connect wallet to commit"}
</div>
<a class="btn primary" href="./launch.html?id=${encodeURIComponent(launch.id)}">View</a>
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

let ALL_LAUNCHES = [];
let CURRENT_VIEW = localStorage.getItem("mss_launchpad_view") || "grid";

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

async function loadLaunches() {
const meta = $("listMeta");

try {
if (meta) meta.textContent = "Loading launch data…";

const data = await fetchJson(`/api/launcher/list`);
ALL_LAUNCHES = Array.isArray(data?.all) ? data.all : [];

if (meta) {
meta.textContent = `${ALL_LAUNCHES.length} launch${ALL_LAUNCHES.length === 1 ? "" : "es"} loaded`;
}
} catch (err) {
console.error("Failed to load launches:", err);
ALL_LAUNCHES = [];
if (meta) {
meta.textContent = "Unable to load launch data";
}
}

render();
}

function renderStats(items) {
const activeItems = items.filter((x) => x.status !== "failed_refunded");
const commitCount = activeItems.filter((x) => x.status === "commit").length;
const countdownCount = activeItems.filter((x) => x.status === "countdown").length;
const liveCount = activeItems.filter((x) => x.status === "live").length;

if ($("statCommit")) $("statCommit").textContent = String(commitCount);
if ($("statCountdown")) $("statCountdown").textContent = String(countdownCount);
if ($("statLive")) $("statLive").textContent = String(liveCount);

const countdowns = activeItems
.filter((x) => x.status === "countdown" && x.countdown_ends_at)
.map((x) => ({
symbol: x.symbol || x.token_name || "—",
endsAt: parseTs(x.countdown_ends_at),
}))
.filter((x) => Number.isFinite(x.endsAt))
.sort((a, b) => a.endsAt - b.endsAt);

if ($("statNext")) $("statNext").textContent = countdowns[0]?.symbol || "—";
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
gridBtn.classList.toggle("active", gridView);
listBtn.classList.toggle("active", !gridView);
}

function sortItems(items, sort) {
const out = items.slice();

if (sort === "progress") {
out.sort((a, b) => safeNum(b.commitPercent) - safeNum(a.commitPercent));
} else if (sort === "participants") {
out.sort((a, b) => safeNum(b.participants_count) - safeNum(a.participants_count));
} else if (sort === "ending") {
out.sort((a, b) => {
const aStatus = String(a.status || "");
const bStatus = String(b.status || "");
const aEnd = aStatus === "countdown"
? parseTs(a.countdown_ends_at) ?? Number.MAX_SAFE_INTEGER
: aStatus === "commit"
? parseTs(a.commit_ends_at) ?? Number.MAX_SAFE_INTEGER
: Number.MAX_SAFE_INTEGER;
const bEnd = bStatus === "countdown"
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

function renderListSections(items) {
const sections = [
{ key: "commit", title: "Commit Live Now" },
{ key: "countdown", title: "Launching Soon" },
{ key: "live", title: "Live Tokens" },
];

const html = sections.map((section) => {
const rows = items.filter((x) => x.status === section.key);
if (!rows.length) return "";
return `
<div class="list-section">
<div class="list-section-title">${section.title}</div>
${rows.map(buildListRow).join("")}
</div>
`;
}).join("");

return html || `<div class="empty">No launches found.</div>`;
}

function render() {
const grid = $("launchGrid");
const list = $("launchList");
if (!grid || !list) return;

const q = ($("lSearch")?.value || "").trim().toLowerCase();
const statusFilter = $("lStatus")?.value || "all";
const sort = $("lSort")?.value || "newest";

let items = ALL_LAUNCHES
.filter((x) => x.status !== "failed_refunded");

if (q) {
items = items.filter((x) => {
const hay = [
x.token_name,
x.symbol,
x.builder_alias,
x.builder_wallet,
x.template,
]
.filter(Boolean)
.join(" ")
.toLowerCase();

return hay.includes(q);
});
}

if (statusFilter !== "all") {
items = items.filter((x) => x.status === statusFilter);
}

items = sortItems(items, sort);

renderStats(ALL_LAUNCHES);
applyViewState();

if (!items.length) {
grid.innerHTML = `<div class="empty" style="grid-column:1/-1;">No launches found.</div>`;
list.innerHTML = `<div class="empty">No launches found.</div>`;
bindQuickCommitButtons();
return;
}

grid.innerHTML = items.map(buildCard).join("");

if (statusFilter === "all") {
list.innerHTML = renderListSections(items);
} else {
list.innerHTML = items.map(buildListRow).join("");
}

bindQuickCommitButtons();
}

async function quickCommit(launchId, amount) {
const wallet = getConnectedPublicKey();

if (!wallet) {
setActionStatus("warn", "Connect your wallet before using quick commit.");
return;
}

try {
setActionStatus("warn", `Submitting ${amount} SOL commit...`);

const data = await fetchJson(`/api/launcher/commit`, {
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

setActionStatus(
"good",
`Commit successful.\n\nWallet total: ${data.walletCommittedTotal} SOL\nTotal committed: ${data.totalCommitted} SOL\nParticipants: ${data.participants}`
);

await loadLaunches();
} catch (err) {
console.error(err);
setActionStatus("bad", err.message || "Quick commit failed.");
}
}

function bindQuickCommitButtons() {
document.querySelectorAll(".quick-commit-btn").forEach((btn) => {
btn.onclick = async () => {
const launchId = Number(btn.getAttribute("data-launch-id"));
const amount = Number(btn.getAttribute("data-amount"));
if (!launchId || !amount) return;
await quickCommit(launchId, amount);
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
}

if (disconnectBtn) {
disconnectBtn.style.display = walletState.isConnected ? "inline-flex" : "none";
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
CURRENT_VIEW = "grid";
localStorage.setItem("mss_launchpad_view", CURRENT_VIEW);
render();
});

$("listViewBtn")?.addEventListener("click", () => {
CURRENT_VIEW = "list";
localStorage.setItem("mss_launchpad_view", CURRENT_VIEW);
render();
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

setInterval(render, 1000);
setInterval(loadLaunches, 15000);
}

init();