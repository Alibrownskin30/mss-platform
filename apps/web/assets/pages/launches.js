function $(id) {
return document.getElementById(id);
}

function clamp(n, min, max) {
return Math.max(min, Math.min(max, n));
}

function fmtTime(ms) {
if (!Number.isFinite(ms)) return "—";
if (ms <= 0) return "LIVE";

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
return "Unknown";
}

function badgeClass(status) {
if (status === "countdown") return "countdown";
if (status === "live") return "live";
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

function buildCard(launch) {
const name = escapeHtml(launch.token_name || "Untitled Launch");
const symbol = escapeHtml(launch.symbol || "N/A");
const template = escapeHtml(launch.template || "—");
const status = launch.status || "commit";
const builder = escapeHtml(launch.builder_alias || launch.builder_wallet || "Unknown Builder");
const committed = safeNum(launch.committed_sol);
const hardCap = safeNum(launch.hard_cap_sol);
const minRaise = safeNum(launch.min_raise_sol);
const participants = safeNum(launch.participants_count);
const percent = clamp(safeNum(launch.commitPercent), 0, 100);

const countdownEndsAt = parseTs(launch.countdown_ends_at);
const remaining = countdownEndsAt ? countdownEndsAt - Date.now() : null;

let timeLabel = "—";
if (status === "countdown") {
timeLabel = fmtTime(remaining);
} else if (status === "live") {
timeLabel = "LIVE";
} else {
timeLabel = `${committed} / ${hardCap} SOL`;
}

return `
<div class="token-card">
<div class="token-head">
<div>
<div class="token-name">${name}</div>
<div class="token-symbol">${symbol} • ${template.replaceAll("_", " ")}</div>
</div>
<div class="badge ${badgeClass(status)}">${stageLabel(status)}</div>
</div>

<div class="kv">
<div>
<div class="k">Builder</div>
<div class="v" style="font-size:16px;">${builder}</div>
</div>
<div>
<div class="k">${status === "countdown" ? "Time Left" : status === "live" ? "Status" : "Committed"}</div>
<div class="v">${escapeHtml(timeLabel)}</div>
</div>
</div>

<div class="progress-wrap">
<div class="progress-top">
<span>${committed} / ${hardCap} SOL committed</span>
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
<div class="v">${minRaise} SOL</div>
</div>
</div>

<div class="token-footer">
<div class="meta-line">
<span>Hard Cap: ${hardCap} SOL</span>
<span>•</span>
<span>Template: ${template.replaceAll("_", " ")}</span>
</div>

<a class="btn primary" href="./launch.html?id=${encodeURIComponent(launch.id)}">View</a>
</div>
</div>
`;
}

let ALL_LAUNCHES = [];

async function loadLaunches() {
const meta = $("listMeta");
try {
if (meta) meta.textContent = "Loading launch data…";

const res = await fetch("http://127.0.0.1:8787/api/launcher/list", {
method: "GET",
headers: { "Content-Type": "application/json" },
});

if (!res.ok) {
throw new Error(`HTTP ${res.status}`);
}

const data = await res.json();
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

$("statCommit").textContent = String(commitCount);
$("statCountdown").textContent = String(countdownCount);
$("statLive").textContent = String(liveCount);

const countdowns = items
.filter((x) => x.status === "countdown" && x.countdown_ends_at)
.map((x) => ({
symbol: x.symbol || x.token_name || "—",
endsAt: parseTs(x.countdown_ends_at),
}))
.filter((x) => Number.isFinite(x.endsAt))
.sort((a, b) => a.endsAt - b.endsAt);

$("statNext").textContent = countdowns[0]?.symbol || "—";
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
const aEnd = parseTs(a.countdown_ends_at) ?? Number.MAX_SAFE_INTEGER;
const bEnd = parseTs(b.countdown_ends_at) ?? Number.MAX_SAFE_INTEGER;
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