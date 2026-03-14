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

function fmtDuration(ms) {
if (!Number.isFinite(ms) || ms <= 0) return "00:00";

const totalSeconds = Math.floor(ms / 1000);
const hours = Math.floor(totalSeconds / 3600);
const minutes = Math.floor((totalSeconds % 3600) / 60);
const seconds = totalSeconds % 60;

if (hours > 0) {
return `${hours}h ${minutes}m ${seconds}s`;
}

if (minutes > 0) {
return `${minutes}m ${seconds}s`;
}

return `${seconds}s`;
}

function badgeText(status) {
if (status === "commit") return "Commit";
if (status === "countdown") return "Countdown";
if (status === "live") return "Live";
if (status === "graduated") return "Graduated";
if (status === "failed") return "Failed";
if (status === "failed_refunded") return "Refunded";
return String(status || "Unknown");
}

function pillClass(status) {
if (status === "commit") return "commit";
if (status === "countdown") return "countdown";
if (status === "live") return "live";
if (status === "graduated") return "graduated";
if (status === "failed" || status === "failed_refunded") return "failed";
return "commit";
}

function getBuilderTrust(score) {
const n = safeNum(score, 0);
if (n >= 80) {
return {
label: "Strong",
note: "Builder profile currently shows strong trust alignment.",
};
}
if (n >= 55) {
return {
label: "Moderate",
note: "Builder profile currently shows moderate trust alignment.",
};
}
return {
label: "Early",
note: "Builder profile is still early-stage and building trust history.",
};
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

function setClosureNote(message, type = "") {
const el = $("launchClosureNote");
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

list.innerHTML = items
.map(
(row) => `
<div class="recent-item">
<div style="min-width:0;">
<div class="recent-wallet">${escapeHtml(row.wallet || "Unknown")}</div>
<div class="recent-meta">${escapeHtml(row.created_at || "")}</div>
</div>
<div class="recent-wallet">${safeNum(row.sol_amount)} SOL</div>
</div>
`
)
.join("");
}

function getFillDurationMs(launch, stats) {
const commitStartedAt = parseTs(stats.commitStartedAt || launch.commit_started_at);
const countdownStartedAt = parseTs(stats.countdownStartedAt || launch.countdown_started_at);

if (!Number.isFinite(commitStartedAt) || !Number.isFinite(countdownStartedAt)) {
return null;
}

if (countdownStartedAt <= commitStartedAt) {
return null;
}

return countdownStartedAt - commitStartedAt;
}

function renderTeamWalletBreakdown(launch, stats) {
const wrap = $("builderExtraBlock");
const teamAllocationPctStat = $("teamAllocationPctStat");
const builderBondStat = $("builderBondStat");
const teamWalletBreakdownList = $("teamWalletBreakdownList");

if (!wrap || !teamAllocationPctStat || !builderBondStat || !teamWalletBreakdownList) return;

const isBuilder = String(launch.template || "") === "builder";
if (!isBuilder) {
wrap.classList.add("hidden");
return;
}

wrap.classList.remove("hidden");

const teamAllocationPct = safeNum(
stats.teamAllocationPct,
safeNum(launch.team_allocation_pct, 0)
);
const builderBondSol = safeNum(
stats.builderBondSol,
safeNum(launch.builder_bond_sol, 0)
);
const builderBondRefunded = safeNum(
stats.builderBondRefunded,
safeNum(launch.builder_bond_refunded, 0)
);
const breakdown = Array.isArray(stats.teamWalletBreakdown)
? stats.teamWalletBreakdown
: Array.isArray(launch.team_wallet_breakdown)
? launch.team_wallet_breakdown
: [];

teamAllocationPctStat.textContent = `${teamAllocationPct}%`;

if (builderBondRefunded === 1 || String(launch.status || "") === "failed_refunded") {
builderBondStat.innerHTML = `${builderBondSol} SOL<div style="margin-top:6px;font-size:12px;color:rgba(255,255,255,.62);font-weight:600;">Refunded</div>`;
} else {
builderBondStat.textContent = `${builderBondSol} SOL`;
}

if (!breakdown.length) {
teamWalletBreakdownList.innerHTML = `<div class="recent-item"><div class="recent-meta">No team wallet breakdown set.</div></div>`;
return;
}

teamWalletBreakdownList.innerHTML = breakdown
.map((row, idx) => {
const wallet = escapeHtml(row.wallet || `Team Wallet ${idx + 1}`);
const pct = safeNum(row.pct, row.allocationPct);
const label = escapeHtml(row.label || "");
return `
<div class="recent-item">
<div style="min-width:0;">
<div class="recent-wallet">${wallet}</div>
<div class="recent-meta">${label || "Team wallet allocation"}</div>
</div>
<div class="recent-wallet">${pct}%</div>
</div>
`;
})
.join("");
}

function renderPhase(launch, committed, minRaise, hardCap, commitEndsAt, stats) {
const phaseValue = $("phaseValue");
const phasePill = $("phasePill");
const phaseNote = $("phaseNote");
const timeStat = $("timeStat");

if (!phaseValue || !phasePill || !phaseNote || !timeStat) return;

const status = String(launch.status || "");
const fillDurationMs = getFillDurationMs(launch, stats);

phaseValue.textContent = badgeText(status);
phasePill.textContent = badgeText(status);
phasePill.className = `status-pill ${pillClass(status)}`;

let note = "";

if (status === "commit") {
const minRemaining = Math.max(0, minRaise - committed);
const hardRemaining = Math.max(0, hardCap - committed);
const msLeft = commitEndsAt ? commitEndsAt - Date.now() : null;

timeStat.textContent = Number.isFinite(msLeft) ? fmtCountdown(msLeft) : "COMMIT";

if (committed >= hardCap && hardCap > 0) {
note = "Hard cap reached. Countdown can begin immediately and refunds will close as soon as countdown starts.";
} else if (committed >= minRaise) {
note = `Minimum raise reached. Commit phase remains open for additional participation until hard cap is reached or the commit timer expires. ${hardRemaining} SOL remains until hard cap.`;
} else if (Number.isFinite(msLeft)) {
note = `Commit phase active. ${minRemaining} SOL still needed before launch qualifies for countdown at commit expiry. Refunds are currently allowed. Commit window ends in ${fmtCountdown(msLeft)}.`;
} else {
note = `Commit phase active. ${minRemaining} SOL still needed before launch qualifies for countdown at commit expiry. Refunds are currently allowed.`;
}
} else if (status === "countdown") {
const ends = parseTs(launch.countdown_ends_at);
const msLeft = (ends ?? 0) - Date.now();
timeStat.textContent = fmtCountdown(msLeft);

if (fillDurationMs != null) {
note =
msLeft > 0
? `Commit phase filled in ${fmtDuration(fillDurationMs)}. Countdown is active. Refunds are disabled. Launch will auto-finalize and go live when the timer reaches zero.`
: `Commit phase filled in ${fmtDuration(fillDurationMs)}. Countdown has ended. Waiting for automatic finalize and LP/live transition.`;
} else {
note =
msLeft > 0
? "Countdown is active. Refunds are disabled. Launch will auto-finalize and go live when the timer reaches zero."
: "Countdown has ended. Waiting for automatic finalize and LP/live transition.";
}
} else if (status === "live") {
timeStat.textContent = "LIVE";
note =
fillDurationMs != null
? `Launch is now live. Commit phase filled in ${fmtDuration(fillDurationMs)}. Commit and refund actions are closed, and the launch has moved into live state.`
: "Launch is now live. Commit and refund actions are closed, and the launch has moved into live state.";
} else if (status === "graduated") {
timeStat.textContent = "GRADUATED";
note = "This launch has already completed its launch lifecycle and graduated beyond the initial launch phase.";
} else if (status === "failed") {
timeStat.textContent = "FAILED";
note = "This launch failed to reach minimum raise before commit expiry.";
} else if (status === "failed_refunded") {
timeStat.textContent = "REFUNDED";
note = "This launch failed, all tracked commitments were automatically refunded, and the launch is now closed.";
} else {
timeStat.textContent = badgeText(status);
note = "Launch state loaded.";
}

phaseNote.textContent = note;
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

function renderProgressCard(launch, committed, hardCap, minRaise, participants, pct, commitEndsAt, stats) {
const headline = $("progressHeadline");
const subline = $("progressSubline");
const text = $("progressText");
const pctEl = $("progressPct");
const fill = $("progressFill");
const pill = $("progressStatusPill");
const fillDurationMs = getFillDurationMs(launch, stats);

if (headline) headline.textContent = `${committed} / ${hardCap} SOL committed`;
if (text) text.textContent = `${committed} / ${hardCap} SOL committed`;
if (pctEl) pctEl.textContent = `${pct}%`;
if (fill) fill.style.width = `${pct}%`;

if (pill) {
pill.textContent = badgeText(launch.status);
pill.className = `status-pill ${pillClass(launch.status)}`;
}

if (subline) {
if (launch.status === "commit") {
const minRemaining = Math.max(0, minRaise - committed);
const hardRemaining = Math.max(0, hardCap - committed);
const msLeft = commitEndsAt ? commitEndsAt - Date.now() : null;

if (committed >= hardCap && hardCap > 0) {
subline.textContent = `Hard cap reached • ${participants} participant${participants === 1 ? "" : "s"}`;
} else if (committed >= minRaise) {
subline.textContent = `${hardRemaining} SOL until hard cap • ${participants} participant${participants === 1 ? "" : "s"}${Number.isFinite(msLeft) ? ` • ${fmtCountdown(msLeft)} left` : ""}`;
} else if (Number.isFinite(msLeft)) {
subline.textContent = `${minRemaining} SOL until minimum raise • ${participants} participant${participants === 1 ? "" : "s"} • ${fmtCountdown(msLeft)} left`;
} else {
subline.textContent = `${minRemaining} SOL until minimum raise • ${participants} participant${participants === 1 ? "" : "s"}`;
}
} else if (launch.status === "countdown") {
subline.textContent =
fillDurationMs != null
? `Commit phase filled in ${fmtDuration(fillDurationMs)} • Countdown active • ${participants} participant${participants === 1 ? "" : "s"}`
: `Countdown active • ${participants} participant${participants === 1 ? "" : "s"}`;
} else if (launch.status === "live") {
subline.textContent =
fillDurationMs != null
? `Commit phase filled in ${fmtDuration(fillDurationMs)} • Launch is live • ${participants} participant${participants === 1 ? "" : "s"}`
: `Launch is live • ${participants} participant${participants === 1 ? "" : "s"}`;
} else if (launch.status === "failed") {
subline.textContent = `Launch failed • ${participants} participant${participants === 1 ? "" : "s"}`;
} else if (launch.status === "failed_refunded") {
subline.textContent = "Launch refunded and closed";
} else {
subline.textContent = `Launch status • ${participants} participant${participants === 1 ? "" : "s"}`;
}
}
}

function renderAllocationStructure(launch, stats) {
const participantsPctStat = $("participantsPctStat");
const liquidityPctStat = $("liquidityPctStat");
const reservePctStat = $("reservePctStat");
const builderPctStat = $("builderPctStat");

const participantsPct = safeNum(launch.participants_pct);
const liquidityPct = safeNum(launch.liquidity_pct);
const rawReservePct = safeNum(launch.reserve_pct);
const baseBuilderPct = safeNum(launch.builder_pct);
const isBuilder = String(launch.template || "") === "builder";
const teamAllocationPct = safeNum(
stats.teamAllocationPct,
safeNum(launch.team_allocation_pct, 0)
);
const effectiveReservePct = isBuilder
? Math.max(0, rawReservePct - teamAllocationPct)
: rawReservePct;
const builderBondSol = safeNum(
stats.builderBondSol,
safeNum(launch.builder_bond_sol, 0)
);
const builderBondRefunded = safeNum(
stats.builderBondRefunded,
safeNum(launch.builder_bond_refunded, 0)
);

if (participantsPctStat) participantsPctStat.textContent = `${participantsPct}%`;
if (liquidityPctStat) liquidityPctStat.textContent = `${liquidityPct}%`;
if (reservePctStat) reservePctStat.textContent = `${effectiveReservePct}%`;

if (builderPctStat) {
if (isBuilder) {
builderPctStat.innerHTML = `${baseBuilderPct}%<div style="margin-top:6px;font-size:12px;color:rgba(255,255,255,.62);font-weight:600;">Team ${teamAllocationPct}% • Bond ${builderBondSol} SOL${builderBondRefunded === 1 ? " • Refunded" : ""}</div>`;
} else {
builderPctStat.textContent = `${baseBuilderPct}%`;
}
}
}

function updateWalletUi() {
const walletInput = $("commitWallet");
const walletPill = $("walletPill");
const connectBtn = $("connectWalletBtn");
const disconnectBtn = $("disconnectWalletBtn");
const walletHint = $("walletHint");
const walletState = getConnectedWallet();

if (walletInput) {
walletInput.value = walletState.publicKey || "";
}

if (walletPill) {
walletPill.textContent = walletState.isConnected
? `Connected: ${walletState.shortPublicKey}`
: "No wallet connected";
}

if (connectBtn) {
connectBtn.style.display = walletState.isConnected ? "none" : "inline-flex";
}

if (disconnectBtn) {
disconnectBtn.style.display = walletState.isConnected ? "inline-flex" : "none";
}

if (walletHint) {
walletHint.textContent = walletState.isConnected
? `Connected via ${String(walletState.walletName || "wallet").replace(/\b\w/g, (m) => m.toUpperCase())}.`
: "Use Connect Wallet to choose Phantom, Solflare, or Backpack.";
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
const commitEndsAt = parseTs(stats.commitEndsAt || launch.commit_ends_at);
const pct = hardCap > 0
? Math.max(0, Math.min(100, Math.floor((committed / hardCap) * 100)))
: 0;

$("launchName").textContent = launch.token_name || "Untitled Launch";
$("launchSubline").textContent =
`${launch.symbol || "—"} • ${String(launch.template || "—").replaceAll("_", " ")} • ${badgeText(launch.status)}`;
$("launchDesc").textContent = launch.description || "No description provided.";
$("launchStatusText").textContent = badgeText(launch.status);

renderBuilderInfo(launch);
renderAllocationStructure(launch, stats);
renderTeamWalletBreakdown(launch, stats);

renderLogo(launch.image_url);
renderProgressCard(launch, committed, hardCap, minRaise, participants, pct, commitEndsAt, stats);

$("participantsStat").textContent = String(participants);
$("minRaiseStat").textContent = `${minRaise} SOL`;
$("hardCapStat").textContent = `${hardCap} SOL`;

renderPhase(launch, committed, minRaise, hardCap, commitEndsAt, stats);
renderRecent(stats.recent || []);
updateWalletUi();

const commitBtn = $("commitBtn");
const refundBtn = $("refundBtn");
const startCountdownBtn = $("startCountdownBtn");

const commitOpen = launch.status === "commit";
const refundOpen = launch.status === "commit" || launch.status === "failed";

const canStartCountdown =
launch.status === "commit" &&
committed >= hardCap &&
hardCap > 0;

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

if (launch.status === "failed_refunded") {
const bondRefunded = safeNum(
stats.builderBondRefunded,
safeNum(launch.builder_bond_refunded, 0)
) === 1;

setClosureNote(
bondRefunded
? "This launch failed, all tracked commitments were automatically refunded, the builder bond was refunded, and the launch is now closed."
: "This launch failed, all tracked commitments were automatically refunded, and the launch is now closed.",
"warn"
);
} else {
setClosureNote("");
}
}

async function refresh() {
await loadLaunch();
render();
}

async function connectWallet() {
try {
const wallet = await connectAnyWallet();
updateWalletUi();

if (wallet?.isConnected) {
setStatus(`Wallet connected: ${shortenWallet(wallet.publicKey)}`, "good");
return;
}

setStatus("Wallet connection cancelled.", "warn");
} catch (err) {
const msg = err?.message || "Wallet connection failed.";
setStatus(msg.includes("No supported wallet") ? getMobileWalletHelpText() : msg, "bad");
}
}

async function disconnectWallet() {
try {
await disconnectAnyWallet();
} catch {
// ignore
}

updateWalletUi();
setStatus("Wallet disconnected.", "warn");
}

async function onCommitSubmit(e) {
e.preventDefault();
setStatus("");

const id = qs("id");
const wallet = getConnectedPublicKey() || $("commitWallet")?.value?.trim() || "";
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

const countdownLine =
data.status === "countdown" && data.countdownEndsAt
? `\nCountdown ends at: ${data.countdownEndsAt}`
: "";

setStatus(
`Commit successful.\n\nWallet total: ${data.walletCommittedTotal} SOL\nTotal committed: ${data.totalCommitted} SOL\nParticipants: ${data.participants}${countdownLine}`,
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
const wallet = getConnectedPublicKey() || $("commitWallet")?.value?.trim() || "";

if (!wallet) {
setStatus("Connect your wallet before refunding.", "bad");
return;
}

if (!["commit", "failed"].includes(currentLaunch?.status || "")) {
setStatus("Refunds are only available during commit phase or after failure.", "bad");
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

const bondLine = safeNum(data.builderBondRefunded, 0) > 0
? `\nBuilder bond refunded: ${data.builderBondRefunded} SOL`
: "";

setStatus(
`Refund successful.\n\nRefunded: ${data.refundedSol} SOL${bondLine}\nTotal committed: ${data.totalCommitted} SOL\nParticipants: ${data.participants}`,
"good"
);

await refresh();
} catch (err) {
console.error(err);
setStatus(err.message || "Refund failed.", "bad");
} finally {
if (refundBtn && ["commit", "failed"].includes(currentLaunch?.status || "")) {
refundBtn.disabled = false;
}
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

onWalletChange(() => {
updateWalletUi();
});
}

async function init() {
bindQuickAmounts();
bindWalletEvents();
$("commitForm")?.addEventListener("submit", onCommitSubmit);
$("refundBtn")?.addEventListener("click", refundCommit);
$("startCountdownBtn")?.addEventListener("click", startCountdown);

await restoreWalletIfTrusted();
updateWalletUi();

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
if (["commit", "countdown"].includes(currentLaunch?.status || "")) {
render();
}
}, 1000);
}

init();