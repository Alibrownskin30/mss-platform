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
return "Unknown";
}

function badgeClass(status) {
if (status === "countdown") return "countdown";
if (status === "live") return "live";
if (status === "graduated") return "live";
if (status === "failed") return "failed";
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

function getCommitEndsAt(launch) {
return (
parseTs(launch.commit_ends_at) ||
parseTs(launch.commitEndsAt) ||
parseTs(launch.commit_expires_at) ||
null
);
}

function getCountdownEndsAt(launch) {
return (
parseTs(launch.countdown_ends_at) ||
parseTs(launch.countdownEndsAt) ||
null
);
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

const commitEndsAt = getCommitEndsAt(launch);
const countdownEndsAt = getCountdownEndsAt(launch);

const commitRemaining = commitEndsAt ? commitEndsAt - Date.now() : null;
const countdownRemaining = countdownEndsAt ? countdownEndsAt - Date.now() : null;

let timeLabel = "—";
let timeHeading = "Committed";

if (status === "commit") {
if (Number.isFinite(commitRemaining)) {
timeHeading = "Commit Time Left";
timeLabel = fmtTime(commitRemaining);
} else {
timeHeading = "Committed";
timeLabel = `${fmtSol(committed)} / ${fmtSol(hardCap)} SOL`;
}
} else if (status === "countdown") {
timeHeading = "Time Left";
timeLabel = fmtTime(countdownRemaining);
} else if (status === "live") {
timeHeading = "Status";
timeLabel = "LIVE";
} else if (status === "graduated") {
timeHeading = "Status";
timeLabel = "GRADUATED";
} else if (status === "failed") {
timeHeading = "Status";
timeLabel = "FAILED";
}

const imageUrl = String(launch.image_url || "").trim();
const logoHtml = imageUrl
? `<img src="${escapeHtml(imageUrl)}" alt="${name} logo" style="width:52px;height:52px;border-radius:14px;object-fit:cover;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.04);" />`
: `<div style="width:52px;height:52px;border-radius:14px;border:1px solid rgba(255,255,255,.10);display:grid;place-items:center;background:rgba(255,255,255,.04);color:rgba(255,255,255,.36);font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;">Logo</div>`;

const builderHtml = builderWallet
? `<a href="./builder.html?wallet=${encodeURIComponent(builderWallet)}" style="color:rgba(255,255,255,.92);text-decoration:none;">${builderName}</a>`
: builderName;

return `
<div class="token-card">
<div class="token-head">
<div style="display:flex;gap:12px;align-items:flex-start;min-width:0;">
${logoHtml}
<div style="min-width:0;">
<div class="token-name">${name}</div>
<div class="token-symbol">${symbol} • ${template}</div>
</div>
</div>
<div class="badge ${badgeClass(status)}">${stageLabel(status)}</div>
</div>

<div class="kv">
<div>
<div class="k">Builder</div>
<div class="v" style="font-size:16px;">${builderHtml}</div>
<div style="margin-top:6px;font-size:12px;color:rgba(255,255,255,.68);">
Score ${builderScore} • ${trust.label}
</div>
</div>
<div>
<div class="k">${escapeHtml(timeHeading)}</div>
<div class="v">${escapeHtml(timeLabel)}</div>
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

let ALL_LAUNCHES = [];

async function loadLaunches() {
const meta = $("listMeta");
const apiBase = getApiBase();

try {
if (meta) meta.textContent = "Loading launch data…";

const res = await fetch(`${apiBase}/api/launcher/list`, {
method: "GET",
headers: { "Content-Type": "application/json" },
});

let data = null;
try {
data = await res.json();
} catch {
data = null;
}

if (!res.ok || !data?.ok) {
throw new Error(data?.error || `HTTP ${res.status}`);
}

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
const commitCount = items.filter((x) => x.status === "commit").length;
const countdownCount = items.filter((x) => x.status === "countdown").length;
const liveCount = items.filter((x) => x.status === "live").length;

if ($("statCommit")) $("statCommit").textContent = String(commitCount);
if ($("statCountdown")) $("statCountdown").textContent = String(countdownCount);
if ($("statLive")) $("statLive").textContent = String(liveCount);

const timed = items
.map((x) => {
const status = x.status || "commit";
const commitEndsAt = getCommitEndsAt(x);
const countdownEndsAt = getCountdownEndsAt(x);

let endsAt = null;
if (status === "countdown") endsAt = countdownEndsAt;
if (status === "commit") endsAt = commitEndsAt;

return {
symbol: x.symbol || x.token_name || "—",
endsAt,
};
})
.filter((x) => Number.isFinite(x.endsAt))
.sort((a, b) => a.endsAt - b.endsAt);

if ($("statNext")) $("statNext").textContent = timed[0]?.symbol || "—";
}

function render() {
const grid = $("launchGrid");
if (!grid) return;

const q = ($("lSearch")?.value || "").trim().toLowerCase();
const statusFilter = $("lStatus")?.value || "all";
const sort = $("lSort")?.value || "newest";

let items = ALL_LAUNCHES.slice();

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

if (sort === "progress") {
items.sort((a, b) => safeNum(b.commitPercent) - safeNum(a.commitPercent));
} else if (sort === "participants") {
items.sort((a, b) => safeNum(b.participants_count) - safeNum(a.participants_count));
} else if (sort === "ending") {
items.sort((a, b) => {
const aStatus = a.status || "commit";
const bStatus = b.status || "commit";

const aEnd = aStatus === "countdown"
? (getCountdownEndsAt(a) ?? Number.MAX_SAFE_INTEGER)
: (getCommitEndsAt(a) ?? Number.MAX_SAFE_INTEGER);

const bEnd = bStatus === "countdown"
? (getCountdownEndsAt(b) ?? Number.MAX_SAFE_INTEGER)
: (getCommitEndsAt(b) ?? Number.MAX_SAFE_INTEGER);

return aEnd - bEnd;
});
} else {
items.sort((a, b) => safeNum(b.id) - safeNum(a.id));
}

renderStats(ALL_LAUNCHES);

if (!items.length) {
grid.innerHTML = `
<div class="empty" style="grid-column:1/-1;">
No launches found.
</div>
`;
return;
}

grid.innerHTML = items.map(buildCard).join("");
}

function init() {
if (!$("launchGrid")) return;

$("lSearch")?.addEventListener("input", render);
$("lStatus")?.addEventListener("change", render);
$("lSort")?.addEventListener("change", render);

loadLaunches();
setInterval(render, 1000);
setInterval(loadLaunches, 15000);
}

init();