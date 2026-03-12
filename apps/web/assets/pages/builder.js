function $(id) {
return document.getElementById(id);
}

function getApiBase() {
const { protocol, hostname, port } = window.location;
if (port === "3000") {
return `${protocol}//${hostname}:8787`;
}
return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
}

function getPhantomProvider() {
if ("phantom" in window && window.phantom?.solana?.isPhantom) {
return window.phantom.solana;
}
if (window.solana?.isPhantom) {
return window.solana;
}
return null;
}

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
if (status === "failed") return "failed";
return "commit";
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

function getWalletFromUrlOrProvider() {
const fromUrl = qs("wallet");
if (fromUrl) return fromUrl;

const provider = getPhantomProvider();
return (
provider?.publicKey?.toString?.() ||
window.phantom?.solana?.publicKey?.toString?.() ||
window.solana?.publicKey?.toString?.() ||
""
);
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

function ensureEditUi() {
const heroCard = document.querySelector(".hero .card");
if (!heroCard) return;

if ($("builderEditWrap")) return;

const meta = heroCard.querySelector(".meta");
if (!meta) return;

const wrap = document.createElement("div");
wrap.id = "builderEditWrap";
wrap.style.marginTop = "18px";
wrap.innerHTML = `
<div style="display:grid;gap:10px;max-width:420px;">
<label for="builderAliasInput" style="font-size:12px;font-weight:700;color:rgba(255,255,255,.78);letter-spacing:.06em;text-transform:uppercase;">
Edit Alias
</label>
<div style="display:flex;gap:10px;flex-wrap:wrap;">
<input
id="builderAliasInput"
type="text"
maxlength="60"
placeholder="Builder alias"
style="flex:1 1 240px;min-height:42px;padding:0 14px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:rgba(255,255,255,.92);outline:none;"
/>
<button id="saveBuilderAliasBtn" class="btn primary" type="button">Save Alias</button>
</div>
<div style="font-size:12px;color:rgba(255,255,255,.50);">
Alias editing is wallet-based for now.
</div>
</div>
`;

meta.insertAdjacentElement("afterend", wrap);
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

ensureEditUi();

const aliasInput = $("builderAliasInput");
if (aliasInput) {
aliasInput.value = builder.alias || "";
}
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

function renderNoWalletState() {
$("builderAlias").textContent = "No Builder Selected";
$("builderWallet").textContent = "—";
$("builderScore").textContent = "—";
$("builderTrust").textContent = "—";
$("builderTrustNote").textContent =
"Connect your wallet in a supported browser, or open this page from a builder link to view a builder profile.";

$("statAll").textContent = "0";
$("statLive").textContent = "0";
$("statGraduated").textContent = "0";
$("statCommit").textContent = "0";
$("statCountdown").textContent = "0";
$("statFailed").textContent = "0";

const list = $("launchList");
if (list) {
list.innerHTML = `<div class="empty">No builder wallet detected. Open a builder profile from launchpad, or connect Phantom and return here.</div>`;
}

setStatus("No builder wallet was detected for this page.", "warn");
}

function bindAliasSave(wallet) {
const btn = $("saveBuilderAliasBtn");
const input = $("builderAliasInput");
if (!btn || !input || !wallet) return;

btn.onclick = async () => {
const alias = String(input.value || "").trim();

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
const builder = await updateBuilderAlias(wallet, alias);
$("builderAlias").textContent = builder.alias || "Unknown Builder";
input.value = builder.alias || "";
setStatus("Builder alias updated successfully.", "warn");
} catch (err) {
console.error(err);
setStatus(err.message || "Failed to update builder alias.", "bad");
} finally {
btn.disabled = false;
btn.textContent = oldText;
}
};
}

async function init() {
try {
clearStatus();

const wallet = getWalletFromUrlOrProvider();
if (!wallet) {
renderNoWalletState();
return;
}

const data = await fetchBuilder(wallet);
renderHeader(data.builder, data.totals || {});
renderLaunches(data.launches || []);
bindAliasSave(wallet);
} catch (err) {
console.error(err);
setStatus(err.message || "Failed to load builder profile.", "bad");
}
}

init();