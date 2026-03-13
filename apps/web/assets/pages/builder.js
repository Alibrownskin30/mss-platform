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
if (status === "failed_refunded") return "Refunded";
return "Unknown";
}

function badgeClass(status) {
if (status === "countdown") return "countdown";
if (status === "live" || status === "graduated") return "live";
if (status === "failed") return "failed";
if (status === "failed_refunded") return "live";
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

function getConnectedWallet() {
const provider = getPhantomProvider();
return (
provider?.publicKey?.toString?.() ||
window.phantom?.solana?.publicKey?.toString?.() ||
window.solana?.publicKey?.toString?.() ||
""
);
}

function getWalletFromUrlOrProvider() {
const fromUrl = qs("wallet");
if (fromUrl) return fromUrl;
return getConnectedWallet();
}

function shortenWallet(wallet) {
const w = String(wallet || "").trim();
if (!w) return "—";
if (w.length <= 12) return w;
return `${w.slice(0, 4)}...${w.slice(-4)}`;
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
$("statFailed").textContent = String(
safeNum(totals.failed, 0) + safeNum(totals.failed_refunded, 0)
);

const aliasInput = $("builderAliasInput");
if (aliasInput) {
aliasInput.value = builder.alias || "";
}
}

function renderEditState(profileWallet) {
const editCard = $("editProfileCard");
const connectedWallet = getConnectedWallet();

if (!editCard) return;

if (connectedWallet && profileWallet && connectedWallet === profileWallet) {
editCard.classList.remove("hidden");
} else {
editCard.classList.add("hidden");
}
}

function renderBuilderMeta(launch) {
const isBuilder = String(launch.template || "") === "builder";
if (!isBuilder) return "";

const teamAllocation = safeNum(launch.team_allocation_pct, 0);
const builderBond = safeNum(launch.builder_bond_sol, 0);

return `
<div class="row-box">
<div class="k">Builder Controls</div>
<div class="v">Team ${teamAllocation}% • Bond ${builderBond} SOL</div>
</div>
`;
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
const status = String(launch.status || "");
const template = escapeHtml(String(launch.template || "—").replaceAll("_", " "));

const statusNote =
status === "failed_refunded"
? `<div style="margin-top:10px;font-size:12px;color:rgba(255,255,255,.70);">This failed launch has already been refunded and closed.</div>`
: "";

return `
<div class="launch-row">
<div class="launch-top">
<div>
<div class="launch-name">${escapeHtml(launch.token_name || "Untitled Launch")}</div>
<div class="launch-sub">
${escapeHtml(launch.symbol || "—")} • ${template}
</div>
</div>
<div class="badge ${badgeClass(status)}">${statusLabel(status)}</div>
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
${renderBuilderMeta(launch)}
</div>

${statusNote}

<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
<div style="font-size:12px;color:rgba(255,255,255,.62);">
Launch ID #${safeNum(launch.id, 0)} • Status ${statusLabel(status)}
</div>
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

renderEditState("");
setStatus("No builder wallet was detected for this page.", "warn");
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
const builder = await updateBuilderAlias(wallet, alias);
$("builderAlias").textContent = builder.alias || "Unknown Builder";
input.value = builder.alias || "";
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
renderEditState(String(data.builder?.wallet || ""));
renderLaunches(data.launches || []);
bindAliasSave(String(data.builder?.wallet || wallet));
} catch (err) {
console.error(err);
setStatus(err.message || "Failed to load builder profile.", "bad");
}

const provider = getPhantomProvider();
if (provider?.on) {
provider.on("accountChanged", () => {
const profileWallet = $("builderWallet")?.textContent?.trim() || "";
renderEditState(profileWallet);
});

provider.on("connect", () => {
const profileWallet = $("builderWallet")?.textContent?.trim() || "";
renderEditState(profileWallet);
});

provider.on("disconnect", () => {
renderEditState("");
});
}
}

init();