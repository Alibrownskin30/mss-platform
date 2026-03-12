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

function escapeHtml(str) {
return String(str ?? "")
.replaceAll("&", "&amp;")
.replaceAll("<", "&lt;")
.replaceAll(">", "&gt;")
.replaceAll('"', "&quot;")
.replaceAll("'", "&#039;");
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

function fmtCountdown(ms) {
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

function badgeText(status) {
if (status === "commit") return "Commit";
if (status === "countdown") return "Countdown";
if (status === "live") return "Live";
if (status === "graduated") return "Graduated";
if (status === "failed") return "Failed";
return String(status || "Unknown");
}

function getBuilderTrust(score) {
const n = safeNum(score, 0);
if (n >= 80) return { label: "Strong", note: "Builder profile currently shows strong trust alignment." };
if (n >= 55) return { label: "Moderate", note: "Builder profile currently shows moderate trust alignment." };
return { label: "Early", note: "Builder profile is still early-stage and building trust history." };
}

function shortenWallet(wallet) {
const w = String(wallet || "").trim();
if (!w) return "No wallet connected";
if (w.length <= 12) return w;
return `${w.slice(0, 4)}...${w.slice(-4)}`;
}

function setStatus(message, type = "") {
const el = $("commitStatus");
if (!el) return;

el.className = "status";
if (!message) {
el.textContent = "";
return;
}

if (type === "good") el.classList.add("good");
if (type === "bad") el.classList.add("bad");
if (type === "warn") el.classList.add("warn");
el.textContent = message;
}

let currentLaunch = null;
let currentCommitStats = null;
let connectedWallet = null;

async function fetchJson(path, options = {}) {
const apiBase = getApiBase();
const res = await fetch(`${apiBase}${path}`, options);
const data = await res.json().catch(() => null);

if (!res.ok || (data && data.ok === false)) {
throw new Error(data?.error || `HTTP ${res.status}`);
}

return data;
}

async function loadLaunch() {
const id = qs("id");
if (!id) {
throw new Error("Missing launch id in URL.");
}

const [launchRes, commitsRes] = await Promise.all([
fetchJson(`/api/launcher/${id}`),
fetchJson(`/api/launcher/commits/${id}`),
]);

currentLaunch = launchRes.launch;
currentCommitStats = commitsRes;
}

function renderLogo(url) {
const box = $("launchLogo");
if (!box) return;

const clean = String(url || "").trim();
if (!clean) {
box.innerHTML = "No Image";
return;
}

box.innerHTML = `<img src="${escapeHtml(clean)}" alt="Launch logo" />`;
}

function renderRecent(items) {
const list = $("recentList");
if (!list) return;

if (!Array.isArray(items) || !items.length) {
list.innerHTML = `<div class="recent-item"><div class="recent-meta">No commits yet.</div></div>`;
return;
}

list.innerHTML = items.map((row) => `
<div class="recent-item">
<div>
<div class="recent-wallet">${escapeHtml(row.wallet || "Unknown")}</div>
<div class="recent-meta">${escapeHtml(row.created_at || "")}</div>
</div>
<div class="recent-wallet">${safeNum(row.sol_amount)} SOL</div>
</div>
`).join("");
}

function renderPhase(launch, committed, minRaise) {
const phaseValue = $("phaseValue");
const phasePill = $("phasePill");
const phaseNote = $("phaseNote");
const timeStat = $("timeStat");

if (!phaseValue || !phasePill || !phaseNote || !timeStat) return;

const status = launch.status;
phaseValue.textContent = badgeText(status);
phasePill.textContent = badgeText(status);
phasePill.className = `status-pill ${status || ""}`;

if (status === "commit") {
const minRemaining = Math.max(0, minRaise - committed);
timeStat.textContent = "COMMIT";
if (committed >= minRaise) {
phaseNote.textContent =
"Minimum raise reached. Countdown can now begin. Refunds stay enabled until countdown starts.";
} else {
phaseNote.textContent =
`Commit phase active. ${minRemaining} SOL still needed before countdown can begin. Refunds are currently allowed.`;
}
return;
}

if (status === "countdown") {
const ends = parseTs(launch.countdown_ends_at);
const msLeft = (ends ?? 0) - Date.now();
const shown = fmtCountdown(msLeft);
timeStat.textContent = shown;
phaseNote.textContent =
msLeft > 0
? `Countdown is active. Refunds are disabled. Launch will auto-finalize and go live when the timer reaches zero.`
: `Countdown has ended. Waiting for automatic finalize and LP/live transition.`;
return;
}

if (status === "live") {
timeStat.textContent = "LIVE";
phaseNote.textContent =
"Launch is now live. Commit and refund actions are closed, and the launch has moved into live state.";
return;
}

if (status === "graduated") {
timeStat.textContent = "GRADUATED";
phaseNote.textContent =
"This launch has already completed its launch lifecycle and graduated beyond the initial launch phase.";
return;
}

if (status === "failed") {
timeStat.textContent = "FAILED";
phaseNote.textContent =
"This launch failed to meet required conditions. Refund handling should be completed according to final MSS failure rules.";
return;
}

timeStat.textContent = badgeText(status);
phaseNote.textContent = "Launch state loaded.";
}

function renderBuilderInfo(launch) {
const builderAliasEl = $("builderAlias");
const builderScoreEl = $("builderScore");

if (!builderAliasEl || !builderScoreEl) return;

const builderScore = safeNum(launch.builder_score, 0);
const builderTrust = getBuilderTrust(builderScore);
const builderAlias = escapeHtml(launch.builder_alias || launch.builder_wallet || "Unknown");
const builderWallet = String(launch.builder_wallet || "").trim();

if (builderWallet) {
builderAliasEl.innerHTML = `<a href="./builder.html?wallet=${encodeURIComponent(builderWallet)}" style="color:rgba(255,255,255,.92);text-decoration:none;">${builderAlias}</a> • Score ${builderScore} • ${builderTrust.label}`;
} else {
builderAliasEl.textContent = `${launch.builder_alias || launch.builder_wallet || "Unknown"} • Score ${builderScore} • ${builderTrust.label}`;
}

builderScoreEl.textContent = `${builderScore} (${builderTrust.label})`;
}

function renderProgressCard(launch, committed, hardCap, minRaise, participants, pct) {
const headline = $("progressHeadline");
const subline = $("progressSubline");
const text = $("progressText");
const pctEl = $("progressPct");
const fill = $("progressFill");
const pill = $("progressStatusPill");

if (headline) headline.textContent = `${committed} / ${hardCap} SOL committed`;
if (text) text.textContent = `${committed} / ${hardCap} SOL committed`;
if (pctEl) pctEl.textContent = `${pct}%`;
if (fill) fill.style.width = `${pct}%`;

if (pill) {
pill.textContent = badgeText(launch.status);
pill.className = `status-pill ${launch.status || "commit"}`;
}

if (subline) {
if (launch.status === "commit") {
const minRemaining = Math.max(0, minRaise - committed);
subline.textContent =
committed >= minRaise
? `Minimum raise reached • ${participants} participant${participants === 1 ? "" : "s"}`
: `${minRemaining} SOL until minimum raise • ${participants} participant${participants === 1 ? "" : "s"}`;
} else if (launch.status === "countdown") {
subline.textContent = `Countdown active • ${participants} participant${participants === 1 ? "" : "s"}`;
} else if (launch.status === "live") {
subline.textContent = `Launch is live • ${participants} participant${participants === 1 ? "" : "s"}`;
} else {
subline.textContent = `Launch status • ${participants} participant${participants === 1 ? "" : "s"}`;
}
}
}

function updateWalletUi() {
const walletInput = $("commitWallet");
const walletPill = $("walletPill");
const connectBtn = $("connectWalletBtn");
const disconnectBtn = $("disconnectWalletBtn");

if (walletInput) {
walletInput.value = connectedWallet || "";
}

if (walletPill) {
walletPill.textContent = connectedWallet
? `Connected: ${shortenWallet(connectedWallet)}`
: "No wallet connected";
}

if (connectBtn) {
connectBtn.style.display = connectedWallet ? "none" : "inline-flex";
}

if (disconnectBtn) {
disconnectBtn.style.display = connectedWallet ? "inline-flex" : "none";
}
}

function render() {
if (!currentLaunch || !currentCommitStats) return;

const launch = currentLaunch;
const stats = currentCommitStats;

const committed = safeNum(stats.totalCommitted, safeNum(launch.committed_sol));
const hardCap = safeNum(stats.hardCap, safeNum(launch.hard_cap_sol));
const minRaise = safeNum(stats.minRaise, safeNum(launch.min_raise_sol));
const participants = safeNum(stats.participants, safeNum(launch.participants_count));
const pct = hardCap > 0
? Math.max(0, Math.min(100, Math.floor((committed / hardCap) * 100)))
: 0;

$("launchName").textContent = launch.token_name || "Untitled Launch";
$("launchSubline").textContent =
`${launch.symbol || "—"} • ${String(launch.template || "—").replaceAll("_", " ")} • ${badgeText(launch.status)}`;
$("launchDesc").textContent = launch.description || "No description provided.";
$("launchStatusText").textContent = badgeText(launch.status);

renderBuilderInfo(launch);

$("participantsPctStat").textContent = `${safeNum(launch.participants_pct)}%`;
$("liquidityPctStat").textContent = `${safeNum(launch.liquidity_pct)}%`;
$("reservePctStat").textContent = `${safeNum(launch.reserve_pct)}%`;
$("builderPctStat").textContent = `${safeNum(launch.builder_pct)}%`;

renderLogo(launch.image_url);
renderProgressCard(launch, committed, hardCap, minRaise, participants, pct);

$("participantsStat").textContent = String(participants);
$("minRaiseStat").textContent = `${minRaise} SOL`;
$("hardCapStat").textContent = `${hardCap} SOL`;

renderPhase(launch, committed, minRaise);
renderRecent(stats.recent || []);
updateWalletUi();

const commitBtn = $("commitBtn");
const refundBtn = $("refundBtn");
const startCountdownBtn = $("startCountdownBtn");

const commitOpen = launch.status === "commit";
const refundOpen = launch.status === "commit";
const canStartCountdown =
launch.status === "commit" && committed >= minRaise && minRaise > 0;

if (commitBtn) {
commitBtn.style.display = commitOpen ? "inline-flex" : "none";
commitBtn.disabled = !commitOpen;
}

if (refundBtn) {
refundBtn.style.display = refundOpen ? "inline-flex" : "none";
refundBtn.disabled = !refundOpen;
}

if (startCountdownBtn) {
startCountdownBtn.style.display = canStartCountdown ? "inline-flex" : "none";
startCountdownBtn.disabled = !canStartCountdown;
}
}

async function refresh() {
await loadLaunch();
render();
}

async function connectWallet() {
const provider = getPhantomProvider();

if (!provider) {
setStatus("Phantom wallet not detected. Install Phantom to continue.", "bad");
return;
}

try {
const resp = await provider.connect();
connectedWallet = resp?.publicKey?.toString() || null;
updateWalletUi();
setStatus(`Wallet connected: ${shortenWallet(connectedWallet)}`, "good");
} catch (err) {
setStatus(err?.message || "Wallet connection failed.", "bad");
}
}

async function disconnectWallet() {
const provider = getPhantomProvider();

try {
if (provider?.disconnect) {
await provider.disconnect();
}
} catch {
// ignore
}

connectedWallet = null;
updateWalletUi();
setStatus("Wallet disconnected.", "warn");
}

async function restoreWalletIfTrusted() {
const provider = getPhantomProvider();
if (!provider) return;

try {
const resp = await provider.connect({ onlyIfTrusted: true });
connectedWallet = resp?.publicKey?.toString() || null;
updateWalletUi();
} catch {
// ignore
}
}

async function onCommitSubmit(e) {
e.preventDefault();
setStatus("");

const id = qs("id");
const wallet = connectedWallet || $("commitWallet")?.value?.trim() || "";
const solAmount = Number($("commitAmount")?.value);

if (!wallet) {
setStatus("Connect your wallet before committing.", "bad");
return;
}

if (!Number.isFinite(solAmount) || solAmount <= 0) {
setStatus("Enter a valid SOL amount.", "bad");
return;
}

const btn = $("commitBtn");
if (btn) btn.disabled = true;

try {
const data = await fetchJson(`/api/launcher/commit`, {
method: "POST",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify({
launchId: Number(id),
wallet,
solAmount,
}),
});

setStatus(
`Commit successful.\n\nWallet total: ${data.walletCommittedTotal} SOL\nTotal committed: ${data.totalCommitted} SOL\nParticipants: ${data.participants}`,
"good"
);

await refresh();
} catch (err) {
console.error(err);
setStatus(err.message || "Commit failed.", "bad");
} finally {
if (btn && currentLaunch?.status === "commit") btn.disabled = false;
}
}

async function refundCommit() {
setStatus("");

const id = qs("id");
const wallet = connectedWallet || $("commitWallet")?.value?.trim() || "";

if (!wallet) {
setStatus("Connect your wallet before refunding.", "bad");
return;
}

if (currentLaunch?.status !== "commit") {
setStatus("Refunds are only available during commit phase.", "bad");
return;
}

const refundBtn = $("refundBtn");
if (refundBtn) refundBtn.disabled = true;

try {
const data = await fetchJson(`/api/launcher/refund`, {
method: "POST",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify({
launchId: Number(id),
wallet,
}),
});

setStatus(
`Refund successful.\n\nRefunded: ${data.refundedSol} SOL\nTotal committed: ${data.totalCommitted} SOL\nParticipants: ${data.participants}`,
"good"
);

await refresh();
} catch (err) {
console.error(err);
setStatus(err.message || "Refund failed.", "bad");
} finally {
if (refundBtn && currentLaunch?.status === "commit") refundBtn.disabled = false;
}
}

async function startCountdown() {
setStatus("");

const id = qs("id");
const btn = $("startCountdownBtn");
if (btn) btn.disabled = true;

try {
const data = await fetchJson(`/api/launcher/${id}/start-countdown`, {
method: "POST",
headers: {
"Content-Type": "application/json",
},
});

setStatus(
`Countdown started.\n\nTotal committed: ${data.totalCommitted} SOL\nParticipants: ${data.participants}\nCountdown ends at: ${data.countdownEndsAt}`,
"good"
);

await refresh();
} catch (err) {
console.error(err);
setStatus(err.message || "Failed to start countdown.", "bad");
} finally {
if (btn) btn.disabled = false;
}
}

function bindQuickAmounts() {
document.querySelectorAll(".quick button[data-amount]").forEach((btn) => {
btn.addEventListener("click", () => {
const amount = btn.getAttribute("data-amount") || "";
if ($("commitAmount")) $("commitAmount").value = amount;
});
});
}

function bindWalletEvents() {
$("connectWalletBtn")?.addEventListener("click", connectWallet);
$("disconnectWalletBtn")?.addEventListener("click", disconnectWallet);

const provider = getPhantomProvider();
if (provider?.on) {
provider.on("accountChanged", (publicKey) => {
connectedWallet = publicKey ? publicKey.toString() : null;
updateWalletUi();
});

provider.on("disconnect", () => {
connectedWallet = null;
updateWalletUi();
});

provider.on("connect", (publicKey) => {
connectedWallet = publicKey?.publicKey?.toString?.() || provider.publicKey?.toString?.() || connectedWallet;
updateWalletUi();
});
}
}

async function init() {
bindQuickAmounts();
bindWalletEvents();
$("commitForm")?.addEventListener("submit", onCommitSubmit);
$("refundBtn")?.addEventListener("click", refundCommit);
$("startCountdownBtn")?.addEventListener("click", startCountdown);

await restoreWalletIfTrusted();

try {
await refresh();
} catch (err) {
console.error(err);
setStatus(err.message || "Failed to load launch.", "bad");
}

setInterval(async () => {
try {
await refresh();
} catch (err) {
console.error(err);
}
}, 5000);

setInterval(() => {
if (currentLaunch?.status === "countdown") {
render();
}
}, 1000);
}

init();