function $(id) {
return document.getElementById(id);
}

const API_BASE = "http://127.0.0.1:8787";

function qs(name) {
return new URLSearchParams(window.location.search).get(name);
}

function safeNum(v, fallback = 0) {
const n = Number(v);
return Number.isFinite(n) ? n : fallback;
}

function escapeHtml(str) {
return String(str ?? "")
.replaceAll("&", "&amp;")
.replaceAll("<", "&lt;")
.replaceAll(">", "&gt;")
.replaceAll('"', "&quot;")
.replaceAll("'", "&#039;");
}

function statusLabel(status) {
if (status === "commit") return "Commit";
if (status === "countdown") return "Countdown";
if (status === "live") return "Live";
if (status === "graduated") return "Graduated";
if (status === "failed") return "Failed";
return "Unknown";
}

function badgeClass(status) {
if (status === "countdown") return "countdown";
if (status === "live" || status === "graduated") return "live";
return "commit";
}

function setError(message) {
const el = $("builderStatus");
if (!el) return;
el.className = "status show bad";
el.textContent = message;
}

async function fetchBuilder() {
const wallet = qs("wallet");
if (!wallet) {
throw new Error("Missing builder wallet in URL.");
}

const res = await fetch(`${API_BASE}/api/builders/${encodeURIComponent(wallet)}`);
const data = await res.json().catch(() => null);

if (!res.ok || !data?.ok) {
throw new Error(data?.error || `HTTP ${res.status}`);
}

return data;
}

function renderHeader(builder, totals) {
$("builderAlias").textContent = builder.alias || "Unknown Builder";
$("builderWallet").textContent = builder.wallet || "—";
$("builderScore").textContent = String(safeNum(builder.builder_score, 0));
$("builderTrust").textContent = builder?.trust?.label || "—";
$("builderTrustNote").textContent =
builder?.trust?.label === "Strong"
? "This builder currently shows strong trust alignment across their MSS profile."
: builder?.trust?.label === "Moderate"
? "This builder currently shows moderate trust alignment across their MSS profile."
: "This builder is still early-stage and building trust history within MSS.";

$("statAll").textContent = String(safeNum(totals.all, 0));
$("statLive").textContent = String(safeNum(totals.live, 0));
$("statGraduated").textContent = String(safeNum(totals.graduated, 0));
$("statCommit").textContent = String(safeNum(totals.commit, 0));
$("statCountdown").textContent = String(safeNum(totals.countdown, 0));
$("statFailed").textContent = String(safeNum(totals.failed, 0));
}

function renderLaunches(launches) {
const list = $("launchList");
if (!list) return;

if (!Array.isArray(launches) || !launches.length) {
list.innerHTML = `<div class="empty">This builder has no launches yet.</div>`;
return;
}

list.innerHTML = launches.map((launch) => {
const committed = safeNum(launch.committed_sol, 0);
const hardCap = safeNum(launch.hard_cap_sol, 0);
const participants = safeNum(launch.participants_count, 0);
const minRaise = safeNum(launch.min_raise_sol, 0);

return `
<div class="launch-row">
<div class="launch-top">
<div>
<div class="launch-name">${escapeHtml(launch.token_name || "Untitled Launch")}</div>
<div class="launch-sub">
${escapeHtml(launch.symbol || "—")} • ${escapeHtml(String(launch.template || "—").replaceAll("_", " "))}
</div>
</div>
<div class="badge ${badgeClass(launch.status)}">${statusLabel(launch.status)}</div>
</div>

<div class="row-kv">
<div class="row-box">
<div class="k">Committed</div>
<div class="v">${committed} / ${hardCap} SOL</div>
</div>
<div class="row-box">
<div class="k">Participants</div>
<div class="v">${participants}</div>
</div>
<div class="row-box">
<div class="k">Minimum Raise</div>
<div class="v">${minRaise} SOL</div>
</div>
</div>

<div>
<a class="btn primary" href="./launch.html?id=${encodeURIComponent(launch.id)}">View Launch</a>
</div>
</div>
`;
}).join("");
}

async function init() {
try {
const data = await fetchBuilder();
renderHeader(data.builder, data.totals || {});
renderLaunches(data.launches || []);
} catch (err) {
console.error(err);
setError(err.message || "Failed to load builder profile.");
}
}

init();