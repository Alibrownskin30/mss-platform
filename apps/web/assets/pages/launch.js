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
import { initLaunchMarket } from "../../js/launch-market.js";

const BASE_REFRESH_INTERVAL_MS = 15000;
const COMMIT_PHASE_REFRESH_INTERVAL_MS = 15000;
const COUNTDOWN_REFRESH_INTERVAL_MS = 2500;
const RENDER_TICK_MS = 1000;
const FORCE_FINALIZE_COOLDOWN_MS = 8000;
const LIVE_LIFECYCLE_REFRESH_INTERVAL_MS = 20000;

function $(id) {
return document.getElementById(id);
}

function $all(selector) {
return Array.from(document.querySelectorAll(selector));
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

if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
if (minutes > 0) return `${minutes}m ${seconds}s`;
return `${seconds}s`;
}

function fmtSol(value, decimals = 2) {
const n = Number(value);
if (!Number.isFinite(n)) return "—";
return `${n.toFixed(decimals).replace(/\.?0+$/, "")} SOL`;
}

function solToLamports(solAmount) {
const n = Number(solAmount);
if (!Number.isFinite(n) || n <= 0) {
throw new Error("Invalid SOL amount.");
}
return Math.round(n * 1_000_000_000);
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

function phaseDisplayText(status) {
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

function isLiveLikeStatus(status) {
const value = String(status || "").toLowerCase();
return value === "live" || value === "graduated";
}

function isCountdownStatus(status) {
return String(status || "").toLowerCase() === "countdown";
}

function isCommitStatus(status) {
return String(status || "").toLowerCase() === "commit";
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

function cleanString(value, max = 10000) {
return String(value ?? "").trim().slice(0, max);
}

function choosePreferredString(...values) {
for (const value of values) {
const s = cleanString(value);
if (s) return s;
}
return "";
}

function shouldExposePublicCa(status) {
const normalized = cleanString(status, 64).toLowerCase();
return normalized === "live" || normalized === "graduated";
}

function sanitizePublicLaunchFields(launchLike = {}) {
const status = cleanString(launchLike?.status, 64).toLowerCase();
const exposeCa = shouldExposePublicCa(status);
const contractAddress = exposeCa
? cleanString(launchLike?.contract_address, 200)
: "";
const mintStatus = exposeCa
? cleanString(launchLike?.mint_reservation_status, 64).toLowerCase()
: "";

return {
...launchLike,
contract_address: contractAddress,
reserved_mint_address: "",
reserved_mint_secret: "",
mint_reservation_status: mintStatus,
mint_finalized_at: exposeCa ? cleanString(launchLike?.mint_finalized_at, 200) : "",
};
}

function mergeLaunchTruth(previous = {}, next = {}) {
const prevSanitized = sanitizePublicLaunchFields(previous || {});
const nextSanitized = sanitizePublicLaunchFields(next || {});

const prevStatus = cleanString(prevSanitized?.mint_reservation_status).toLowerCase();
const nextStatus = cleanString(nextSanitized?.mint_reservation_status).toLowerCase();

const prevContract = cleanString(prevSanitized?.contract_address, 200);
const nextContract = cleanString(nextSanitized?.contract_address, 200);

const merged = {
...(prevSanitized || {}),
...(nextSanitized || {}),
};

const strongestContract = choosePreferredString(nextContract, prevContract);
const exposeCa = shouldExposePublicCa(merged?.status);

merged.reserved_mint_address = "";
merged.reserved_mint_secret = "";

if (exposeCa) {
merged.contract_address = strongestContract;
const finalizedWins =
nextStatus === "finalized" ||
prevStatus === "finalized" ||
Boolean(strongestContract);

merged.mint_reservation_status = finalizedWins
? "finalized"
: choosePreferredString(nextStatus, prevStatus);

if (!merged.mint_finalized_at && finalizedWins) {
merged.mint_finalized_at = choosePreferredString(
nextSanitized?.mint_finalized_at,
prevSanitized?.mint_finalized_at,
nextSanitized?.updated_at,
prevSanitized?.updated_at
);
}
} else {
merged.contract_address = "";
merged.mint_reservation_status = "";
merged.mint_finalized_at = "";
}

return merged;
}

function normalizeLaunchData(raw = {}) {
const normalized = {
...raw,
status: cleanString(raw?.status, 64),
symbol: cleanString(raw?.symbol, 64),
token_name: cleanString(raw?.token_name, 200),
builder_wallet: cleanString(raw?.builder_wallet, 200),
builder_alias: cleanString(raw?.builder_alias, 200),
image_url: cleanString(raw?.image_url, 4000),
description: cleanString(raw?.description, 10000),
contract_address: cleanString(raw?.contract_address, 200),
reserved_mint_address: cleanString(raw?.reserved_mint_address, 200),
reserved_mint_secret: cleanString(raw?.reserved_mint_secret, 20000),
mint_reservation_status: cleanString(raw?.mint_reservation_status, 64).toLowerCase(),
mint_finalized_at: cleanString(raw?.mint_finalized_at, 200),
};

return sanitizePublicLaunchFields(normalized);
}

function normalizeLifecycleData(raw = {}) {
if (!raw || typeof raw !== "object") return null;

return {
...raw,
launchStatus: cleanString(raw.launchStatus, 64).toLowerCase(),
contractAddress: cleanString(raw.contractAddress, 200),
builderWallet: cleanString(raw.builderWallet, 200),
graduationStatus: cleanString(raw.graduationStatus, 120),
graduationReason: cleanString(raw.graduationReason, 200),
raydiumPoolId: cleanString(raw.raydiumPoolId, 300),
lockStatus: cleanString(raw.lockStatus, 120),
graduationReadiness: raw.graduationReadiness && typeof raw.graduationReadiness === "object"
? {
...raw.graduationReadiness,
reason: cleanString(raw.graduationReadiness.reason, 500),
}
: null,
builderVesting: raw.builderVesting && typeof raw.builderVesting === "object"
? {
...raw.builderVesting,
}
: null,
};
}

function mergeLifecycleTruth(previous = null, next = null) {
if (!previous && !next) return null;
if (!previous) return normalizeLifecycleData(next);
if (!next) return normalizeLifecycleData(previous);

return {
...normalizeLifecycleData(previous),
...normalizeLifecycleData(next),
};
}

function setStatus(message, type = "", options = {}) {
const el = $("commitStatus");
if (!el) return;

const { auto = false, preserveManual = false } = options;

if (preserveManual && el.textContent && el.dataset.autoState !== "1") {
return;
}

el.className = "status";
el.dataset.autoState = auto ? "1" : "";

if (!message) {
el.textContent = "";
return;
}

if (type === "good") el.classList.add("good");
if (type === "bad") el.classList.add("bad");
if (type === "warn") el.classList.add("warn");
el.textContent = message;
}

function clearAutoStatus() {
const el = $("commitStatus");
if (!el) return;
if (el.dataset.autoState === "1") {
el.className = "status";
el.textContent = "";
el.dataset.autoState = "";
}
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

function getBuilderBondState(launch, stats) {
const builderBondSol = safeNum(
stats?.builderBondSol,
safeNum(launch?.builder_bond_sol, 0)
);
const builderBondRefunded = safeNum(
stats?.builderBondRefunded,
safeNum(launch?.builder_bond_refunded, 0)
) === 1;
const builderBondPaid = safeNum(
stats?.builderBondPaid,
safeNum(launch?.builder_bond_paid, 0)
) === 1;

return {
amount: builderBondSol,
paid: builderBondPaid,
refunded: builderBondRefunded,
pending: builderBondSol > 0 && !builderBondPaid && !builderBondRefunded,
};
}

function getCountdownEndsMs(launch, stats) {
return parseTs(stats?.countdownEndsAt || launch?.countdown_ends_at || launch?.live_at);
}

function getCommitEndsMs(launch, stats) {
return parseTs(stats?.commitEndsAt || launch?.commit_ends_at);
}

function getLaunchStateMessage(launch, stats, lifecycle = null) {
const status = String(launch?.status || "");
const bondState = getBuilderBondState(launch, stats);
const readiness = lifecycle?.graduationReadiness || null;

if (status === "commit") {
return {
kind: "warn",
message: "Commit phase is open.",
};
}

if (status === "countdown") {
const ends = getCountdownEndsMs(launch, stats);
const timePart = Number.isFinite(ends)
? ` Countdown ends in ${fmtCountdown(ends - Date.now())}.`
: "";
return {
kind: "warn",
message: `Launch moved to countdown. Commits and refunds are closed.${timePart}`,
};
}

if (status === "live") {
const readinessLine = readiness
? readiness.ready
? " Graduation threshold is currently satisfied."
: readiness.reason
? ` ${readiness.reason}`
: ""
: "";
return {
kind: "good",
message: `Launch is now live. Commit and refund actions are closed.${readinessLine}`,
};
}

if (status === "graduated") {
return {
kind: "good",
message: "This launch has already graduated beyond the initial launch flow.",
};
}

if (status === "failed_refunded") {
const bondLine =
bondState.refunded && bondState.amount > 0
? ` Builder bond of ${fmtSol(bondState.amount)} was refunded as well.`
: "";
return {
kind: "warn",
message: `This launch failed and all tracked commits were refunded. This launch is now closed.${bondLine}`,
};
}

if (status === "failed") {
const bondLine =
bondState.paid && !bondState.refunded && bondState.amount > 0
? ` Builder bond of ${fmtSol(bondState.amount)} is still awaiting failed-launch handling.`
: "";
return {
kind: "warn",
message: `This launch failed to reach requirements before commit expiry.${bondLine}`,
};
}

return {
kind: "warn",
message: `Launch status: ${badgeText(status)}`,
};
}

function canCommitForStatus(status) {
return String(status || "") === "commit";
}

function canRefundForStatus(status) {
return ["commit", "failed"].includes(String(status || ""));
}

function hideLaunchEconomicsBlock() {
const sectionTitle = Array.from(document.querySelectorAll(".section-title")).find(
(el) => String(el.textContent || "").trim().toLowerCase() === "launch economics"
);

const economicsGrid = document.querySelector(".economics-grid");

if (sectionTitle) {
const wrapper = sectionTitle.parentElement;
if (wrapper) wrapper.style.display = "none";
}

if (economicsGrid) {
const wrapper = economicsGrid.parentElement;
if (wrapper) wrapper.style.display = "none";
}
}

function updateLifecycleVisibility(status) {
const commitProgressSection = $("commitProgressSection");
const recentCommitsSection = $("recentCommitsSection");

const isLiveLike = String(status || "") === "live" || String(status || "") === "graduated";

if (commitProgressSection) {
commitProgressSection.classList.toggle("hidden", isLiveLike);
}

if (recentCommitsSection) {
recentCommitsSection.classList.toggle("hidden", isLiveLike);
}
}

function getConnectButtons() {
return [
...$all('[data-role="wallet-connect"]'),
...($("connectWalletBtn") ? [$("connectWalletBtn")] : []),
].filter(Boolean);
}

function getDisconnectButtons() {
return [
...$all('[data-role="wallet-disconnect"]'),
...($("disconnectWalletBtn") ? [$("disconnectWalletBtn")] : []),
].filter(Boolean);
}

function getWalletPills() {
return [
...$all('[data-role="wallet-pill"]'),
...($("walletPill") ? [$("walletPill")] : []),
].filter(Boolean);
}

function getWalletHints() {
return [
...$all('[data-role="wallet-hint"]'),
...($("walletHint") ? [$("walletHint")] : []),
].filter(Boolean);
}

function getWalletInputs() {
return [
...$all('[data-role="wallet-input"]'),
...($("commitWallet") ? [$("commitWallet")] : []),
].filter(Boolean);
}

let currentLaunch = null;
let currentCommitStats = null;
let currentLifecycle = null;
let currentGraduationPlan = null;
let refreshIntervalId = null;
let renderIntervalId = null;
let lifecycleRefreshIntervalId = null;
let loadRequestSeq = 0;
let commitActionInFlight = false;
let refundActionInFlight = false;
let walletActionInFlight = false;
let refreshInFlight = false;
let lifecycleRefreshInFlight = false;
let launchMarketController = null;
let lastRenderedPhaseStatus = "";
let countdownRefreshRequested = false;
let countdownFinalizeInFlight = false;
let lastForcedFinalizeAt = 0;
let walletChangeBound = false;

async function fetchJson(path, options = {}) {
const apiBase = getApiBase();
const res = await fetch(`${apiBase}${path}`, options);
const data = await res.json().catch(() => null);

if (!res.ok || (data && data.ok === false)) {
const err = new Error(data?.error || `HTTP ${res.status}`);
err.data = data;
err.status = res.status;
throw err;
}

return data;
}

async function defaultSaveLinksWithWallet(launchId, payload) {
const wallet = getConnectedPublicKey() || "";

if (!wallet) {
throw new Error("Connect wallet first");
}

return fetchJson(`/api/launcher/${encodeURIComponent(launchId)}/links`, {
method: "PATCH",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify({
...payload,
wallet,
}),
});
}

async function loadLaunch() {
const id = qs("id");
if (!id) {
throw new Error("Missing launch id in URL.");
}

const requestSeq = ++loadRequestSeq;

const [launchRes, commitsRes] = await Promise.all([
fetchJson(`/api/launcher/${id}`),
fetchJson(`/api/launcher/commits/${id}`),
]);

if (requestSeq !== loadRequestSeq) return;

const incomingLaunch = normalizeLaunchData(launchRes?.launch || {});
currentLaunch = mergeLaunchTruth(currentLaunch || {}, incomingLaunch);
currentCommitStats = commitsRes || {};
currentLifecycle = mergeLifecycleTruth(
currentLifecycle,
launchRes?.lifecycle || commitsRes?.lifecycle || null
);
currentGraduationPlan =
launchRes?.graduationPlan ||
commitsRes?.graduationPlan ||
currentGraduationPlan ||
null;
}

async function loadLifecycleIfNeeded(force = false) {
const id = qs("id");
if (!id) return;
if (!currentLaunch) return;
if (!isLiveLikeStatus(currentLaunch?.status) && !isCountdownStatus(currentLaunch?.status)) return;
if (lifecycleRefreshInFlight) return;
if (!force && !isLiveLikeStatus(currentLaunch?.status)) return;

lifecycleRefreshInFlight = true;

try {
const lifecycleRes = await fetchJson(`/api/launcher/${id}/lifecycle`).catch(() => null);
if (!lifecycleRes) return;

currentLifecycle = mergeLifecycleTruth(currentLifecycle, lifecycleRes.lifecycle || null);
currentGraduationPlan = lifecycleRes.graduationPlan || currentGraduationPlan || null;
} finally {
lifecycleRefreshInFlight = false;
}
}

async function forceCountdownFinalization() {
const id = qs("id");
if (!id) return;
if (countdownFinalizeInFlight) return;

const now = Date.now();
if (now - lastForcedFinalizeAt < FORCE_FINALIZE_COOLDOWN_MS) {
return;
}

countdownFinalizeInFlight = true;
lastForcedFinalizeAt = now;

try {
try {
await fetchJson(`/api/launcher/${id}/finalize`, {
method: "POST",
});
} catch (err) {
console.warn("launch.js finalize attempt did not complete:", err?.message || err);
}

await refresh({ syncMarket: true, syncLifecycle: true });
} finally {
countdownFinalizeInFlight = false;
}
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
<div class="recent-wallet">${escapeHtml(shortenWallet(row.wallet || "Unknown"))}</div>
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

if (countdownStartedAt <= commitStartedAt) return null;
return countdownStartedAt - commitStartedAt;
}

function getCurrentLaunchEconomicsElements() {
return {
launchFeePctEl: $("launchFeePctStat"),
totalFeeSolEl: $("totalFeeSolStat"),
founderFeeSolEl: $("founderFeeSolStat"),
buybackFeeSolEl: $("buybackFeeSolStat"),
treasuryFeeSolEl: $("treasuryFeeSolStat"),
netRaiseAfterFeeEl: $("netRaiseAfterFeeStat"),
liquidityFundingEl: $("liquidityFundingStat"),
};
}

function buildFeeBreakdown(launch, committed) {
const launchFeePct = safeNum(launch.launch_fee_pct, 5);
const totalCommitted = safeNum(committed, 0);
const feeTotal = totalCommitted * (launchFeePct / 100);
const coreFee = feeTotal * 0.5;
const buybackFee = feeTotal * 0.3;
const treasuryFee = feeTotal * 0.2;
const netRaiseAfterFee = totalCommitted - feeTotal;
const liquidityFunding = netRaiseAfterFee;

return {
launchFeePct,
totalCommitted,
feeTotal,
coreFee,
buybackFee,
treasuryFee,
netRaiseAfterFee,
liquidityFunding,
};
}

function renderLaunchEconomics(launch, committed) {
const {
launchFeePctEl,
totalFeeSolEl,
founderFeeSolEl,
buybackFeeSolEl,
treasuryFeeSolEl,
netRaiseAfterFeeEl,
liquidityFundingEl,
} = getCurrentLaunchEconomicsElements();

if (
!launchFeePctEl ||
!totalFeeSolEl ||
!founderFeeSolEl ||
!buybackFeeSolEl ||
!treasuryFeeSolEl ||
!netRaiseAfterFeeEl ||
!liquidityFundingEl
) {
return;
}

const fee = buildFeeBreakdown(launch, committed);

launchFeePctEl.textContent = `${fee.launchFeePct}%`;
totalFeeSolEl.textContent = fmtSol(fee.feeTotal);
founderFeeSolEl.textContent = fmtSol(fee.coreFee);
buybackFeeSolEl.textContent = fmtSol(fee.buybackFee);
treasuryFeeSolEl.textContent = fmtSol(fee.treasuryFee);
netRaiseAfterFeeEl.textContent = fmtSol(fee.netRaiseAfterFee);
liquidityFundingEl.textContent = fmtSol(fee.liquidityFunding);
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
const breakdown = Array.isArray(stats.teamWalletBreakdown)
? stats.teamWalletBreakdown
: Array.isArray(launch.team_wallet_breakdown)
? launch.team_wallet_breakdown
: [];
const bondState = getBuilderBondState(launch, stats);

teamAllocationPctStat.textContent = `${teamAllocationPct}%`;

if (bondState.refunded) {
builderBondStat.innerHTML = `${fmtSol(bondState.amount)}<div style="margin-top:6px;font-size:12px;color:rgba(255,255,255,.62);font-weight:600;">Refunded</div>`;
} else if (bondState.paid) {
builderBondStat.innerHTML = `${fmtSol(bondState.amount)}<div style="margin-top:6px;font-size:12px;color:rgba(255,255,255,.62);font-weight:600;">Collected</div>`;
} else if (bondState.pending) {
builderBondStat.innerHTML = `${fmtSol(bondState.amount)}<div style="margin-top:6px;font-size:12px;color:rgba(255,255,255,.62);font-weight:600;">Pending</div>`;
} else {
builderBondStat.textContent = fmtSol(bondState.amount);
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

function renderPhase(launch, committed, minRaise, hardCap, commitEndsAt, stats, lifecycle = null) {
const phaseValue = $("phaseValue");
const phasePill = $("phasePill");
const phaseNote = $("phaseNote");
const timeStat = $("timeStat");

if (!phaseValue || !phasePill || !phaseNote || !timeStat) return;

const status = String(launch.status || "");
const fillDurationMs = getFillDurationMs(launch, stats);
const isBuilder = String(launch.template || "") === "builder";
const bondState = getBuilderBondState(launch, stats);
const readiness = lifecycle?.graduationReadiness || null;

phaseValue.textContent = phaseDisplayText(status);
phasePill.textContent = phaseDisplayText(status);
phasePill.className = `status-pill ${pillClass(status)}`;

let note = "";

if (status === "commit") {
const minRemaining = Math.max(0, minRaise - committed);
const hardRemaining = Math.max(0, hardCap - committed);
const msLeft = commitEndsAt ? commitEndsAt - Date.now() : null;

timeStat.textContent = Number.isFinite(msLeft) ? fmtCountdown(msLeft) : "COMMIT";

if (committed >= hardCap && hardCap > 0) {
note = "Hard cap reached. Countdown has been triggered automatically and refunds are now closing.";
} else if (committed >= minRaise) {
note = `Minimum raise reached. Commit phase remains open for additional participation until hard cap is reached or the commit timer expires. ${hardRemaining} SOL remains until hard cap.`;
} else if (Number.isFinite(msLeft)) {
note = `Commit phase active. ${minRemaining} SOL still needed before launch qualifies for countdown at commit expiry. Refunds are currently allowed. Commit window ends in ${fmtCountdown(msLeft)}.`;
} else {
note = `Commit phase active. ${minRemaining} SOL still needed before launch qualifies for countdown at commit expiry. Refunds are currently allowed.`;
}

if (isBuilder) {
if (bondState.paid) {
note += ` Builder bond of ${fmtSol(bondState.amount)} has been collected.`;
} else if (bondState.pending) {
note += ` Builder bond of ${fmtSol(bondState.amount)} is not marked as collected yet.`;
}
}
} else if (status === "countdown") {
const ends = getCountdownEndsMs(launch, stats);
const msLeft = (ends ?? 0) - Date.now();
timeStat.textContent = fmtCountdown(msLeft);

if (fillDurationMs != null) {
note =
msLeft > 0
? `Commit phase filled in ${fmtDuration(fillDurationMs)}. Countdown is active. Refunds are disabled. Launch will auto-finalize and go live when the timer reaches zero.`
: `Commit phase filled in ${fmtDuration(fillDurationMs)}. Countdown has ended. Finalizing live transition now.`;
} else {
note =
msLeft > 0
? "Countdown is active. Refunds are disabled. Launch will auto-finalize and go live when the timer reaches zero."
: "Countdown has ended. Finalizing live transition now.";
}

if (isBuilder && bondState.paid) {
note += ` Builder bond of ${fmtSol(bondState.amount)} remains locked while the launch progresses.`;
}
} else if (status === "live") {
timeStat.textContent = "LIVE";
note =
fillDurationMs != null
? `Launch is now live. Commit phase filled in ${fmtDuration(fillDurationMs)}. Commit and refund actions are closed, and the launch has moved into live state.`
: "Launch is now live. Commit and refund actions are closed, and the launch has moved into live state.";

if (isBuilder && bondState.paid && !bondState.refunded) {
note += ` Builder bond of ${fmtSol(bondState.amount)} was collected during launch setup.`;
}

if (readiness) {
note += readiness.ready
? " Graduation conditions are currently satisfied."
: readiness.reason
? ` ${readiness.reason}`
: "";
}
} else if (status === "graduated") {
timeStat.textContent = "GRADUATED";
note = "This launch has already completed its launch lifecycle and graduated beyond the initial launch phase.";

if (lifecycle?.graduationStatus) {
note += ` Liquidity lifecycle status: ${lifecycle.graduationStatus}.`;
}
} else if (status === "failed") {
timeStat.textContent = "FAILED";
note = "This launch failed to reach minimum raise before commit expiry.";

if (isBuilder) {
if (bondState.refunded) {
note += ` Builder bond of ${fmtSol(bondState.amount)} has already been refunded.`;
} else if (bondState.paid) {
note += ` Builder bond of ${fmtSol(bondState.amount)} was collected and is eligible for refund handling.`;
} else if (bondState.pending) {
note += " No collected builder bond is recorded for refund.";
}
}
} else if (status === "failed_refunded") {
timeStat.textContent = "REFUNDED";
note = "This launch failed, all tracked commitments were automatically refunded, and the launch is now closed.";

if (isBuilder) {
if (bondState.refunded) {
note += ` Builder bond of ${fmtSol(bondState.amount)} was also refunded.`;
} else if (bondState.paid) {
note += " Builder bond was collected earlier but is not marked refunded.";
} else if (bondState.pending) {
note += " No collected builder bond was recorded on this launch.";
}
}
} else {
timeStat.textContent = phaseDisplayText(status);
note = "Launch state loaded.";
}

phaseNote.textContent = note;
}

function renderBuilderInfo(launch) {
const builderAliasEl = $("builderAlias");
const builderScoreEl = $("builderScore");
const launchBuilderLabelEl = $("launchBuilderLabel");

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

if (launchBuilderLabelEl) {
launchBuilderLabelEl.textContent = launch.builder_alias || "Builder";
}
}

function renderProgressCard(launch, committed, hardCap, minRaise, participants, pct, commitEndsAt, stats) {
const headline = $("progressHeadline");
const subline = $("progressSubline");
const text = $("progressText");
const pctEl = $("progressPct");
const fill = $("progressFill");
const pill = $("progressStatusPill");
const fillDurationMs = getFillDurationMs(launch, stats);
const isBuilder = String(launch.template || "") === "builder";
const bondState = getBuilderBondState(launch, stats);

if (headline) headline.textContent = `${committed} / ${hardCap} SOL committed`;
if (text) text.textContent = `${committed} / ${hardCap} SOL committed`;
if (pctEl) pctEl.textContent = `${pct}%`;
if (fill) fill.style.width = `${pct}%`;

if (pill) {
pill.textContent = phaseDisplayText(launch.status);
pill.className = `status-pill ${pillClass(launch.status)}`;
}

if (!subline) return;

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

if (isBuilder) {
if (bondState.paid) {
subline.textContent += " • Bond collected";
} else if (bondState.pending) {
subline.textContent += " • Bond pending";
}
}
} else if (launch.status === "countdown") {
subline.textContent =
fillDurationMs != null
? `Commit phase filled in ${fmtDuration(fillDurationMs)} • Countdown active • ${participants} participant${participants === 1 ? "" : "s"}`
: `Countdown active • ${participants} participant${participants === 1 ? "" : "s"}`;

if (isBuilder && bondState.paid) {
subline.textContent += " • Bond locked";
}
} else if (launch.status === "live") {
subline.textContent =
fillDurationMs != null
? `Commit phase filled in ${fmtDuration(fillDurationMs)} • Launch is live • ${participants} participant${participants === 1 ? "" : "s"}`
: `Launch is live • ${participants} participant${participants === 1 ? "" : "s"}`;

if (isBuilder && bondState.paid) {
subline.textContent += " • Bond collected";
}
} else if (launch.status === "failed") {
subline.textContent = `Launch failed • ${participants} participant${participants === 1 ? "" : "s"}`;

if (isBuilder) {
if (bondState.refunded) {
subline.textContent += " • Bond refunded";
} else if (bondState.paid) {
subline.textContent += " • Bond collected";
} else if (bondState.pending) {
subline.textContent += " • Bond not collected";
}
}
} else if (launch.status === "failed_refunded") {
subline.textContent = "Launch refunded and closed";

if (isBuilder) {
if (bondState.refunded) {
subline.textContent += " • Bond refunded";
} else if (bondState.paid) {
subline.textContent += " • Bond collected";
} else if (bondState.pending) {
subline.textContent += " • No bond collected";
}
}
} else {
subline.textContent = `Launch status • ${participants} participant${participants === 1 ? "" : "s"}`;
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
const bondState = getBuilderBondState(launch, stats);

if (participantsPctStat) participantsPctStat.textContent = `${participantsPct}%`;
if (liquidityPctStat) liquidityPctStat.textContent = `${liquidityPct}%`;
if (reservePctStat) reservePctStat.textContent = `${effectiveReservePct}%`;

if (!builderPctStat) return;

if (isBuilder) {
let bondLabel = `Bond ${fmtSol(bondState.amount)}`;
if (bondState.refunded) {
bondLabel += " • Refunded";
} else if (bondState.paid) {
bondLabel += " • Collected";
} else if (bondState.pending) {
bondLabel += " • Pending";
}

builderPctStat.innerHTML = `${baseBuilderPct}%<div style="margin-top:6px;font-size:12px;color:rgba(255,255,255,.62);font-weight:600;">Team ${teamAllocationPct}% • ${bondLabel}</div>`;
} else {
builderPctStat.textContent = `${baseBuilderPct}%`;
}
}

function buildLifecycleSummaryText(lifecycle, launch) {
if (!lifecycle || !launch) return "";

const parts = [];

if (isLiveLikeStatus(launch.status)) {
if (safeNum(lifecycle.internalSolReserve, 0) > 0) {
parts.push(`Internal LP reserve: ${fmtSol(lifecycle.internalSolReserve, 4)}`);
}

if (safeNum(lifecycle.totalSupply, 0) > 0 && safeNum(lifecycle.priceSol, 0) > 0) {
parts.push(`Internal price: ${safeNum(lifecycle.priceSol).toFixed(8).replace(/\.?0+$/, "")} SOL`);
}

if (lifecycle.builderVesting?.lockedAmount > 0) {
parts.push(`Builder locked: ${safeNum(lifecycle.builderVesting.lockedAmount, 0)} tokens`);
}

if (lifecycle.graduationReadiness?.ready) {
parts.push("Graduation-ready");
}
}

return parts.join(" • ");
}

function updateWalletUi() {
const walletState = getConnectedWallet();
const walletText = walletState.publicKey || "";
const walletPillText = walletState.isConnected
? `Connected: ${walletState.shortPublicKey}`
: "No wallet connected";
const walletHintText = walletState.isConnected
? `Connected via ${String(walletState.walletName || "wallet").replace(/\b\w/g, (m) => m.toUpperCase())}.`
: "Use Connect Wallet to choose Phantom, Solflare, or Backpack.";

for (const input of getWalletInputs()) {
input.value = walletText;
}

for (const pill of getWalletPills()) {
pill.textContent = walletPillText;
}

for (const btn of getConnectButtons()) {
btn.style.display = walletState.isConnected ? "none" : "inline-flex";
btn.disabled = walletActionInFlight;
}

for (const btn of getDisconnectButtons()) {
btn.style.display = walletState.isConnected ? "inline-flex" : "none";
btn.disabled = walletActionInFlight;
}

for (const hint of getWalletHints()) {
hint.textContent = walletHintText;
}

const badgeEls = $all('[data-role="wallet-badge"]');
for (const badge of badgeEls) {
badge.classList.remove("is-connected", "is-disconnected");
badge.classList.add(walletState.isConnected ? "is-connected" : "is-disconnected");
badge.textContent = walletState.isConnected ? "Wallet Connected" : "Wallet Disconnected";
}
}

function renderActionPanelState(launch, stats, lifecycle = null) {
const commitForm = $("commitForm");
const commitBtn = $("commitBtn");
const refundBtn = $("refundBtn");
const amountInput = $("commitAmount");
const amountField = amountInput?.closest(".field") || null;
const quickWrap = document.querySelector(".quick");
const walletField = $("commitWallet")?.closest(".field") || null;
const actionStack = commitBtn?.closest(".action-stack") || null;
const quickButtons = Array.from(document.querySelectorAll(".quick button[data-amount]"));
const stateInfo = getLaunchStateMessage(launch, stats, lifecycle);

const status = String(launch.status || "");
const commitOpen = canCommitForStatus(status);
const refundOpen = canRefundForStatus(status);
const refundOnly = status === "failed";

if (commitForm) commitForm.style.display = commitOpen || refundOpen ? "" : "none";
if (walletField) walletField.style.display = commitOpen || refundOpen ? "" : "none";
if (amountField) amountField.style.display = commitOpen ? "" : "none";
if (quickWrap) quickWrap.style.display = commitOpen ? "" : "none";
if (actionStack) actionStack.style.display = commitOpen || refundOpen ? "" : "none";

if (commitBtn) {
commitBtn.style.display = commitOpen ? "inline-flex" : "none";
commitBtn.disabled = !commitOpen || commitActionInFlight;
}

if (refundBtn) {
refundBtn.style.display = refundOpen ? "inline-flex" : "none";
refundBtn.disabled = !refundOpen || refundActionInFlight;
}

if (amountInput) {
amountInput.disabled = !commitOpen || commitActionInFlight;
amountInput.setAttribute("placeholder", commitOpen ? "0.50" : badgeText(status));
}

quickButtons.forEach((btn) => {
btn.disabled = !commitOpen || commitActionInFlight;
});

if (refundOnly) {
setStatus(
"Launch failed. Refund remains available for wallets with tracked commit balance.",
"warn",
{ auto: true, preserveManual: true }
);
return;
}

if (!commitOpen) {
setStatus(stateInfo.message, stateInfo.kind, { auto: true, preserveManual: true });
} else {
clearAutoStatus();
}
}

async function syncLaunchMarketController(forceRefresh = false) {
const id = qs("id");
if (!id) return;
if (!$("marketCard")) return;

const connectedWallet = getConnectedPublicKey() || "";

if (!launchMarketController) {
launchMarketController = await initLaunchMarket({
launchId: Number(id),
connectedWallet,
launch: currentLaunch || null,
commitStats: currentCommitStats || {},
saveLinks: defaultSaveLinksWithWallet,
});

if (forceRefresh && typeof launchMarketController.setBaseState === "function") {
launchMarketController.setBaseState(currentLaunch || null, currentCommitStats || {}, { restartPolling: true });
if (
isLiveLikeStatus(currentLaunch?.status) &&
typeof launchMarketController.refreshLiveMarketOnly === "function"
) {
await launchMarketController.refreshLiveMarketOnly({ force: true });
}
}
return;
}

launchMarketController.setConnectedWallet(connectedWallet);
launchMarketController.saveLinks = defaultSaveLinksWithWallet;

if (typeof launchMarketController.setBaseState === "function") {
launchMarketController.setBaseState(currentLaunch || null, currentCommitStats || {}, { restartPolling: true });
} else {
launchMarketController.launch = mergeLaunchTruth(
launchMarketController.launch || {},
currentLaunch || {}
);
launchMarketController.commitStats = currentCommitStats || {};
if (typeof launchMarketController.applyAll === "function") {
launchMarketController.applyAll();
}
}

if (
forceRefresh &&
isLiveLikeStatus(currentLaunch?.status) &&
typeof launchMarketController.refreshLiveMarketOnly === "function"
) {
await launchMarketController.refreshLiveMarketOnly({ force: true });
}
}

function render() {
if (!currentLaunch || !currentCommitStats) return;

const launch = currentLaunch;
const stats = currentCommitStats;
const lifecycle = currentLifecycle;
const bondState = getBuilderBondState(launch, stats);

const committed = safeNum(stats.totalCommitted, safeNum(launch.committed_sol));
const hardCap = safeNum(stats.hardCap, safeNum(launch.hard_cap_sol));
const minRaise = safeNum(stats.minRaise, safeNum(launch.min_raise_sol));
const participants = safeNum(stats.participants, safeNum(launch.participants_count));
const commitEndsAt = getCommitEndsMs(launch, stats);
const pct = hardCap > 0
? Math.max(0, Math.min(100, Math.floor((committed / hardCap) * 100)))
: 0;

if ($("launchSubline")) {
const lifecycleText = buildLifecycleSummaryText(lifecycle, launch);
$("launchSubline").textContent =
`${launch.symbol || "—"} • ${String(launch.template || "—").replaceAll("_", " ")} • ${phaseDisplayText(launch.status)}${lifecycleText ? ` • ${lifecycleText}` : ""}`;
}

if ($("launchDesc")) {
$("launchDesc").textContent = launch.description || "No description provided.";
}

if ($("launchStatusText")) {
$("launchStatusText").textContent = phaseDisplayText(launch.status);
}

updateLifecycleVisibility(launch.status);
renderBuilderInfo(launch);
renderAllocationStructure(launch, stats);
renderLaunchEconomics(launch, committed);
renderTeamWalletBreakdown(launch, stats);
renderLogo(launch.image_url);
renderProgressCard(launch, committed, hardCap, minRaise, participants, pct, commitEndsAt, stats);

if ($("participantsStat")) $("participantsStat").textContent = String(participants);
if ($("minRaiseStat")) $("minRaiseStat").textContent = `${minRaise} SOL`;
if ($("hardCapStat")) $("hardCapStat").textContent = `${hardCap} SOL`;

renderPhase(launch, committed, minRaise, hardCap, commitEndsAt, stats, lifecycle);
renderRecent(stats.recent || []);
updateWalletUi();
renderActionPanelState(launch, stats, lifecycle);

if (launch.status === "failed_refunded") {
setClosureNote(
bondState.refunded
? `This launch failed, all tracked commitments were automatically refunded, the builder bond of ${fmtSol(bondState.amount)} was refunded, and the launch is now closed.`
: bondState.paid
? `This launch failed, all tracked commitments were automatically refunded, and the launch is now closed. A builder bond of ${fmtSol(bondState.amount)} was collected earlier but is not marked refunded.`
: "This launch failed, all tracked commitments were automatically refunded, and the launch is now closed.",
"warn"
);
} else if (launch.status === "failed" && String(launch.template || "") === "builder") {
if (bondState.paid && !bondState.refunded) {
setClosureNote(
`This builder launch failed. Commit refunds are available and the collected builder bond of ${fmtSol(bondState.amount)} should be handled by the failed-launch refund flow.`,
"warn"
);
} else if (bondState.pending) {
setClosureNote(
"This builder launch failed. No collected builder bond is recorded on this launch.",
"warn"
);
} else {
setClosureNote("");
}
} else if (launch.status === "live" && lifecycle?.graduationReadiness?.ready) {
setClosureNote(
`Launch is live and currently graduation-ready. Planned split: ${safeNum(lifecycle.raydiumTargetPct, 50)}% Raydium / ${safeNum(lifecycle.mssLockedTargetPct, 50)}% MSS locked.`,
"good"
);
} else if (launch.status === "graduated") {
setClosureNote(
`Launch has graduated. Liquidity lifecycle status: ${lifecycle?.graduationStatus || "graduated"}.`,
"good"
);
} else {
setClosureNote("");
}

lastRenderedPhaseStatus = String(launch.status || "");
}

async function refresh(options = {}) {
const { syncMarket = true, syncLifecycle = false } = options;

if (refreshInFlight) return;
refreshInFlight = true;

try {
await loadLaunch();

if (syncLifecycle) {
await loadLifecycleIfNeeded(true);
}

render();

if (syncMarket) {
await syncLaunchMarketController(true);
}
} finally {
refreshInFlight = false;
}
}

async function refreshStateBeforeAction() {
await refresh({ syncMarket: true, syncLifecycle: true });
return {
launch: currentLaunch,
stats: currentCommitStats,
};
}

async function connectWallet() {
if (walletActionInFlight) return;
walletActionInFlight = true;
updateWalletUi();

try {
const wallet = await connectAnyWallet();
updateWalletUi();

if (wallet?.isConnected) {
setStatus(`Wallet connected: ${shortenWallet(wallet.publicKey)}`, "good");
await syncLaunchMarketController(true);
return;
}

setStatus("Wallet connection cancelled.", "warn");
} catch (err) {
const msg = err?.message || "Wallet connection failed.";
setStatus(msg.includes("No supported wallet") ? getMobileWalletHelpText() : msg, "bad");
} finally {
walletActionInFlight = false;
updateWalletUi();
if (currentLaunch && currentCommitStats) render();
}
}

async function disconnectWallet() {
if (walletActionInFlight) return;
walletActionInFlight = true;
updateWalletUi();

try {
await disconnectAnyWallet();
} catch {
// no-op
} finally {
walletActionInFlight = false;
updateWalletUi();
if (currentLaunch && currentCommitStats) render();
await syncLaunchMarketController(true);
}

setStatus("Wallet disconnected.", "warn");
}

function buildLateRefundMessage(err, fallbackSignature = "") {
const data = err?.data || {};
const refundedSol = data.refundedSol;
const refundTxSignature = data.refundTxSignature || "";
const originalTx = data.txSignature || fallbackSignature || "";
const status = data.status ? `\nLaunch status: ${data.status}` : "";
const refundLine = Number.isFinite(Number(refundedSol))
? `\nRefunded: ${refundedSol} SOL`
: "";
const originalTxLine = originalTx ? `\nOriginal transaction: ${originalTx}` : "";
const refundTxLine = refundTxSignature ? `\nRefund transaction: ${refundTxSignature}` : "";

return `${err.message || "Commit could not be completed."}${status}${refundLine}${originalTxLine}${refundTxLine}`;
}

async function onCommitSubmit(e) {
e.preventDefault();
if (commitActionInFlight) return;

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

commitActionInFlight = true;
render();

let transferSignature = "";

try {
const latest = await refreshStateBeforeAction();
const launch = latest.launch;
const stats = latest.stats;

if (!launch) {
throw new Error("Launch not found.");
}

if (!canCommitForStatus(launch.status)) {
const stateInfo = getLaunchStateMessage(launch, stats, currentLifecycle);
setStatus(stateInfo.message, stateInfo.kind);
return;
}

setStatus("Preparing secure commit request…", "warn");

const prepare = await fetchJson(`/api/launcher/prepare-commit`, {
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

const destinationWallet = String(
prepare.escrowWallet || prepare.destinationWallet || ""
).trim();

if (!destinationWallet) {
throw new Error("Escrow wallet was not returned by the server.");
}

const lamports = solToLamports(solAmount);

setStatus("Awaiting wallet approval…", "warn");

const transfer = await sendSolTransfer({
destination: destinationWallet,
lamports,
});

transferSignature = transfer.signature || "";

setStatus("Verifying on-chain transfer…", "warn");

const data = await fetchJson(`/api/launcher/confirm-commit`, {
method: "POST",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify({
launchId: Number(id),
wallet,
solAmount,
txSignature: transferSignature,
}),
});

const countdownLine =
data.status === "countdown" && data.countdownEndsAt
? `\nCountdown ends at: ${data.countdownEndsAt}`
: "";

setStatus(
`Commit successful.\n\nWallet total: ${data.walletCommittedTotal} SOL\nTotal committed: ${data.totalCommitted} SOL\nParticipants: ${data.participants}\nTransaction: ${data.txSignature || transferSignature}${countdownLine}`,
"good"
);

if ($("commitAmount")) {
$("commitAmount").value = "";
}

await refresh({ syncMarket: true, syncLifecycle: true });
restartRefreshLoop();
restartLifecycleRefreshLoop();
} catch (err) {
console.error(err);

const lateRefund =
Number(err?.status) === 409 &&
(err?.data?.refundTxSignature || Number.isFinite(Number(err?.data?.refundedSol)));

if (lateRefund) {
setStatus(buildLateRefundMessage(err, transferSignature), "warn");
try {
await refresh({ syncMarket: true, syncLifecycle: true });
} catch (refreshErr) {
console.error(refreshErr);
}
} else {
setStatus(err?.message || "Commit failed.", "bad");
try {
await refresh({ syncMarket: true, syncLifecycle: true });
} catch (refreshErr) {
console.error(refreshErr);
}
}

restartRefreshLoop();
restartLifecycleRefreshLoop();
} finally {
commitActionInFlight = false;
render();
}
}

async function refundCommit() {
if (refundActionInFlight) return;

setStatus("");

const id = qs("id");
const wallet = getConnectedPublicKey() || $("commitWallet")?.value?.trim() || "";

if (!wallet) {
setStatus("Connect your wallet before refunding.", "bad");
return;
}

refundActionInFlight = true;
render();

try {
const latest = await refreshStateBeforeAction();
const launch = latest.launch;
const stats = latest.stats;

if (!launch) {
throw new Error("Launch not found.");
}

if (!canRefundForStatus(launch.status)) {
const stateInfo = getLaunchStateMessage(launch, stats, currentLifecycle);
setStatus(stateInfo.message, stateInfo.kind);
return;
}

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
`Refund successful.\n\nRefunded: ${data.refundedSolActual || data.refundedSol} SOL${bondLine}\nTotal committed: ${data.totalCommitted} SOL\nParticipants: ${data.participants}\nTransaction: ${data.refundTxSignature || "Recorded"}`,
"good"
);

await refresh({ syncMarket: true, syncLifecycle: true });
restartRefreshLoop();
restartLifecycleRefreshLoop();
} catch (err) {
console.error(err);
setStatus(err?.message || "Refund failed.", "bad");
try {
await refresh({ syncMarket: true, syncLifecycle: true });
} catch (refreshErr) {
console.error(refreshErr);
}
restartRefreshLoop();
restartLifecycleRefreshLoop();
} finally {
refundActionInFlight = false;
render();
}
}

function bindQuickAmounts() {
document.querySelectorAll(".quick button[data-amount]").forEach((btn) => {
btn.addEventListener("click", () => {
if (btn.disabled || commitActionInFlight) return;
const amount = btn.getAttribute("data-amount") || "";
if ($("commitAmount")) $("commitAmount").value = amount;
});
});
}

function bindWalletButtons() {
for (const btn of getConnectButtons()) {
if (btn.dataset.walletBound === "1") continue;
btn.dataset.walletBound = "1";
btn.addEventListener("click", connectWallet);
}

for (const btn of getDisconnectButtons()) {
if (btn.dataset.walletBound === "1") continue;
btn.dataset.walletBound = "1";
btn.addEventListener("click", disconnectWallet);
}
}

function bindWalletEvents() {
bindWalletButtons();

if (walletChangeBound) return;
walletChangeBound = true;

onWalletChange(async () => {
updateWalletUi();
if (currentLaunch && currentCommitStats) render();
await syncLaunchMarketController(true);
});
}

function getDynamicRefreshIntervalMs() {
const status = String(currentLaunch?.status || "").toLowerCase();
if (status === "countdown") return COUNTDOWN_REFRESH_INTERVAL_MS;
if (status === "commit") return COMMIT_PHASE_REFRESH_INTERVAL_MS;
return BASE_REFRESH_INTERVAL_MS;
}

function restartRefreshLoop() {
if (refreshIntervalId) {
clearInterval(refreshIntervalId);
refreshIntervalId = null;
}

const status = String(currentLaunch?.status || "").toLowerCase();
const shouldRunBaseLoop =
status === "commit" ||
status === "countdown" ||
!currentLaunch?.status;

if (!shouldRunBaseLoop) return;

refreshIntervalId = setInterval(async () => {
if (refreshInFlight || commitActionInFlight || refundActionInFlight || countdownFinalizeInFlight) return;

try {
await refresh({ syncMarket: false, syncLifecycle: false });
} catch (err) {
console.error(err);
}
}, getDynamicRefreshIntervalMs());
}

function restartLifecycleRefreshLoop() {
if (lifecycleRefreshIntervalId) {
clearInterval(lifecycleRefreshIntervalId);
lifecycleRefreshIntervalId = null;
}

if (!isLiveLikeStatus(currentLaunch?.status)) return;

lifecycleRefreshIntervalId = setInterval(async () => {
if (refreshInFlight || lifecycleRefreshInFlight) return;

try {
await loadLifecycleIfNeeded(true);
render();
} catch (err) {
console.error(err);
}
}, LIVE_LIFECYCLE_REFRESH_INTERVAL_MS);
}

async function init() {
window.API_BASE = getApiBase();

hideLaunchEconomicsBlock();
bindQuickAmounts();
bindWalletEvents();
$("commitForm")?.addEventListener("submit", onCommitSubmit);
$("refundBtn")?.addEventListener("click", refundCommit);

await restoreWalletIfTrusted();
updateWalletUi();

try {
await refresh({ syncMarket: true, syncLifecycle: true });
} catch (err) {
console.error(err);
setStatus(err?.message || "Failed to load launch.", "bad");
}

restartRefreshLoop();
restartLifecycleRefreshLoop();

if (renderIntervalId) clearInterval(renderIntervalId);

renderIntervalId = setInterval(() => {
if (!currentLaunch || !currentCommitStats) return;

render();

const status = String(currentLaunch.status || "");

if (status === "countdown") {
const countdownEndsMs = getCountdownEndsMs(currentLaunch, currentCommitStats);
if (
Number.isFinite(countdownEndsMs) &&
countdownEndsMs <= Date.now() &&
!refreshInFlight &&
!countdownRefreshRequested &&
!countdownFinalizeInFlight
) {
countdownRefreshRequested = true;
void forceCountdownFinalization()
.catch((err) => console.error(err))
.finally(() => {
countdownRefreshRequested = false;
restartRefreshLoop();
restartLifecycleRefreshLoop();
});
}
}

if (status !== lastRenderedPhaseStatus && !refreshInFlight) {
void refresh({ syncMarket: true, syncLifecycle: true })
.then(() => {
restartRefreshLoop();
restartLifecycleRefreshLoop();
})
.catch((err) => console.error(err));
}
}, RENDER_TICK_MS);
}

init();