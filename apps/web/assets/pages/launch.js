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
const BUILDING_PHASE_REFRESH_INTERVAL_MS = 1800;
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

const hasExplicitTimezone = /z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw);

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

function fmtPct(value, decimals = 0) {
const n = Number(value);
if (!Number.isFinite(n)) return "—";
return `${n.toFixed(decimals).replace(/\.?0+$/, "")}%`;
}

function fmtTokenAmount(value, decimals = 0) {
const n = Number(value);
if (!Number.isFinite(n)) return "—";
return n.toLocaleString(undefined, {
minimumFractionDigits: 0,
maximumFractionDigits: decimals,
});
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
if (status === "building") return "Building";
if (status === "live") return "Live";
if (status === "graduated") return "Graduated";
if (status === "failed") return "Failed";
if (status === "failed_refunded") return "Refunded";
return String(status || "Unknown");
}

function phaseDisplayText(status) {
if (status === "commit") return "Commit";
if (status === "countdown") return "Countdown";
if (status === "building") return "Building";
if (status === "live") return "Live";
if (status === "graduated") return "Graduated";
if (status === "failed") return "Failed";
if (status === "failed_refunded") return "Refunded";
return String(status || "Unknown");
}

function pillClass(status) {
if (status === "commit") return "commit";
if (status === "countdown" || status === "building") return "countdown";
if (status === "live") return "live";
if (status === "graduated") return "graduated";
if (status === "failed" || status === "failed_refunded") return "failed";
return "commit";
}

function isLiveLikeStatus(status) {
const value = String(status || "").toLowerCase();
return value === "live" || value === "graduated";
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

function inferEffectiveLaunchStatus(launchLike = {}, statsLike = {}, lifecycleLike = null) {
const rawStatus = cleanString(launchLike?.status, 64).toLowerCase();
const lifecycleStatus = cleanString(
lifecycleLike?.launchStatus || lifecycleLike?.status || lifecycleLike?.graduationStatus,
64
).toLowerCase();

const contractAddress = choosePreferredString(
launchLike?.contract_address,
launchLike?.mint_address,
lifecycleLike?.contractAddress,
lifecycleLike?.contract_address
);

const mintStatus = cleanString(launchLike?.mint_reservation_status, 64).toLowerCase();
const countdownEndsMs = parseTs(
statsLike?.countdownEndsAt || launchLike?.countdown_ends_at || launchLike?.live_at
);
const now = Date.now();

if (rawStatus === "graduated" || lifecycleStatus === "graduated" || lifecycleLike?.graduated) {
return "graduated";
}

if (rawStatus === "live" || lifecycleStatus === "live") {
return "live";
}

if (
contractAddress &&
(
mintStatus === "finalized" ||
rawStatus === "building" ||
lifecycleStatus === "building" ||
(Number.isFinite(countdownEndsMs) && now >= countdownEndsMs)
)
) {
return "live";
}

if (rawStatus === "building" || lifecycleStatus === "building") {
return "building";
}

if (rawStatus === "countdown") {
return "countdown";
}

if (rawStatus === "failed" || rawStatus === "failed_refunded") {
return rawStatus;
}

if (rawStatus === "commit") {
return "commit";
}

if (Number.isFinite(countdownEndsMs) && now < countdownEndsMs) {
return "countdown";
}

if (contractAddress) {
return "live";
}

return rawStatus || "commit";
}

function sanitizePublicLaunchFields(launchLike = {}, statsLike = {}, lifecycleLike = null) {
const effectiveStatus = inferEffectiveLaunchStatus(launchLike, statsLike, lifecycleLike);
const exposeCa = shouldExposePublicCa(effectiveStatus);
const contractAddress = exposeCa
? choosePreferredString(
launchLike?.contract_address,
launchLike?.mint_address,
lifecycleLike?.contractAddress,
lifecycleLike?.contract_address
)
: "";
const mintStatus = exposeCa ? cleanString(launchLike?.mint_reservation_status, 64).toLowerCase() : "";

return {
...launchLike,
status: effectiveStatus,
contract_address: contractAddress,
reserved_mint_address: "",
reserved_mint_secret: "",
mint_reservation_status: mintStatus,
mint_finalized_at: exposeCa ? cleanString(launchLike?.mint_finalized_at, 200) : "",
};
}

function mergeLaunchTruth(previous = {}, next = {}, statsLike = {}, lifecycleLike = null) {
const prevSanitized = sanitizePublicLaunchFields(previous || {}, statsLike, lifecycleLike);
const nextSanitized = sanitizePublicLaunchFields(next || {}, statsLike, lifecycleLike);

const prevStatus = cleanString(prevSanitized?.mint_reservation_status).toLowerCase();
const nextStatus = cleanString(nextSanitized?.mint_reservation_status).toLowerCase();

const prevContract = cleanString(prevSanitized?.contract_address, 200);
const nextContract = cleanString(nextSanitized?.contract_address, 200);
const lifecycleContract = cleanString(
lifecycleLike?.contractAddress || lifecycleLike?.contract_address,
200
);

const merged = {
...(prevSanitized || {}),
...(nextSanitized || {}),
};

const strongestContract = choosePreferredString(nextContract, prevContract, lifecycleContract);
const effectiveStatus = inferEffectiveLaunchStatus(merged, statsLike, lifecycleLike);
const exposeCa = shouldExposePublicCa(effectiveStatus);

merged.status = effectiveStatus;
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
return {
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
graduationReadiness:
raw.graduationReadiness && typeof raw.graduationReadiness === "object"
? {
...raw.graduationReadiness,
reason: cleanString(raw.graduationReadiness.reason, 500),
}
: null,
builderVesting:
raw.builderVesting && typeof raw.builderVesting === "object"
? { ...raw.builderVesting }
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
const builderBondSol = safeNum(stats?.builderBondSol, safeNum(launch?.builder_bond_sol, 0));
const builderBondRefunded =
safeNum(stats?.builderBondRefunded, safeNum(launch?.builder_bond_refunded, 0)) === 1;
const builderBondPaid = safeNum(stats?.builderBondPaid, safeNum(launch?.builder_bond_paid, 0)) === 1;

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

function getDisplayPhaseStatus(launch, stats, lifecycle = currentLifecycle) {
return inferEffectiveLaunchStatus(launch, stats, lifecycle);
}

function getLaunchStateMessage(launch, stats, lifecycle = null) {
const status = getDisplayPhaseStatus(launch, stats, lifecycle);
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

if (status === "building") {
return {
kind: "warn",
message: "Countdown reached zero. MSS is finalizing mint, liquidity, and live market state.",
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
message: `This launch failed to meet requirements before commit expiry.${bondLine}`,
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

function findFirstElementByIds(ids = []) {
for (const id of ids) {
const el = $(id);
if (el) return el;
}
return null;
}

function setTextByIds(ids, value) {
for (const id of ids) {
const el = $(id);
if (el) el.textContent = value;
}
}

function setHtmlByIds(ids, value) {
for (const id of ids) {
const el = $(id);
if (el) el.innerHTML = value;
}
}

function setValueByIds(ids, value) {
for (const id of ids) {
const el = $(id);
if (el) el.value = value;
}
}

function setWidthByIds(ids, value) {
for (const id of ids) {
const el = $(id);
if (el) el.style.width = value;
}
}

function setHiddenByIds(ids, hidden) {
for (const id of ids) {
const el = $(id);
if (el) el.classList.toggle("hidden", Boolean(hidden));
}
}

function setDisplayByIds(ids, displayValue) {
for (const id of ids) {
const el = $(id);
if (el) el.style.display = displayValue;
}
}

function setStatusPillClasses(el, status) {
if (!el) return;
el.classList.remove("commit", "countdown", "live", "graduated", "failed");
el.classList.add(pillClass(status));
}

function resolveAllocationPct(primary, fallback) {
const n = safeNum(primary, NaN);
if (Number.isFinite(n)) return n;
return safeNum(fallback, 0);
}

function renderBuilderInfo(launch) {
const alias = choosePreferredString(launch.builder_alias, launch.builder_name, "MSS Builder");
const wallet = choosePreferredString(launch.builder_wallet, launch.builder, "");
const trustScore = safeNum(
launch.builder_trust_score,
safeNum(launch.builder_score, safeNum(launch.trust_score, 0))
);
const trust = getBuilderTrust(trustScore);
const isBuilderLaunch = String(launch.template || "").toLowerCase() === "builder";

setTextByIds(["launchTitle", "tokenName", "launchName", "heroTokenName"], launch.token_name || "Unnamed Launch");
setTextByIds(["launchSymbol", "symbolBadge", "heroTokenSymbol"], launch.symbol || "—");
setTextByIds(["builderAlias", "builderAliasStat", "builderNameStat", "builderIdentityName"], alias);
setTextByIds(["builderWalletStat", "builderWallet", "builderAddress", "builderIdentityWallet"], wallet ? shortenWallet(wallet) : "—");
setValueByIds(["builderWalletFull", "builderAddressFull"], wallet);
setTextByIds(["builderTrustStat", "builderTrustLabel", "builderTrustPill"], trust.label);
setTextByIds(["builderTrustNote", "builderTrustSummary"], trust.note);
setTextByIds(["builderTrustScore", "builderScoreStat"], trustScore > 0 ? String(Math.round(trustScore)) : "—");

const builderWalletFullEl = findFirstElementByIds(["builderWalletFullText", "builderAddressFullText"]);
if (builderWalletFullEl) {
builderWalletFullEl.textContent = wallet || "—";
}

setHiddenByIds(
[
"builderInfoSection",
"builderCard",
"builderIdentityCard",
"builderProfileCard",
"builderProfileWrap",
],
!isBuilderLaunch
);
}

function renderAllocationStructure(launch, stats) {
const isBuilderLaunch = String(launch.template || "").toLowerCase() === "builder";
const participantPct = resolveAllocationPct(
stats?.participantAllocationPct,
launch.participant_allocation_pct ?? launch.participants_allocation_pct ?? 45
);
const liquidityPct = resolveAllocationPct(
stats?.liquidityAllocationPct,
launch.liquidity_allocation_pct ?? 20
);
const reservePct = resolveAllocationPct(
stats?.reserveAllocationPct,
launch.reserve_allocation_pct ?? 30
);
const builderPct = isBuilderLaunch
? resolveAllocationPct(stats?.builderAllocationPct, launch.builder_allocation_pct ?? 5)
: 0;

setTextByIds(["participantAllocationPctStat", "participantsAllocationPctStat"], fmtPct(participantPct));
setTextByIds(["liquidityAllocationPctStat", "liquiditySplitPctStat"], fmtPct(liquidityPct));
setTextByIds(["reserveAllocationPctStat", "reserveSplitPctStat"], fmtPct(reservePct));
setTextByIds(["builderAllocationPctStat", "builderSplitPctStat", "teamReservePctStat"], fmtPct(builderPct));

setHiddenByIds(
["builderAllocationCard", "builderAllocationStatWrap", "builderAllocationRow"],
!isBuilderLaunch
);
}

function renderProgressCard(launch, committed, hardCap, minRaise, participants, pct, commitEndsAt, stats) {
const status = getDisplayPhaseStatus(launch, stats);
const countdownEndsAt = getCountdownEndsMs(launch, stats);
const commitStartedAt = parseTs(stats.commitStartedAt || launch.commit_started_at);
const fillDurationMs = getFillDurationMs(launch, stats);
const now = Date.now();

const remainingToMin = Math.max(0, safeNum(minRaise, 0) - safeNum(committed, 0));
const remainingToHardCap = Math.max(0, safeNum(hardCap, 0) - safeNum(committed, 0));
const minMet = safeNum(committed, 0) >= safeNum(minRaise, 0) && safeNum(minRaise, 0) > 0;
const hardCapMet = safeNum(committed, 0) >= safeNum(hardCap, 0) && safeNum(hardCap, 0) > 0;

let primaryCountdownLabel = "Commit ends in";
let primaryCountdownValue = Number.isFinite(commitEndsAt) ? fmtCountdown(commitEndsAt - now) : "—";
let secondaryCountdownLabel = "Fill duration";
let secondaryCountdownValue = Number.isFinite(fillDurationMs) ? fmtDuration(fillDurationMs) : "—";

if (status === "countdown" || status === "building") {
primaryCountdownLabel = status === "countdown" ? "Countdown ends in" : "Finalizing";
primaryCountdownValue =
status === "countdown" && Number.isFinite(countdownEndsAt)
? fmtCountdown(countdownEndsAt - now)
: "In progress";
secondaryCountdownLabel = "Commit window";
secondaryCountdownValue =
Number.isFinite(commitStartedAt) && Number.isFinite(commitEndsAt)
? fmtDuration(commitEndsAt - commitStartedAt)
: "—";
}

if (status === "live" || status === "graduated") {
primaryCountdownLabel = status === "graduated" ? "Launch state" : "Went live";
primaryCountdownValue = status === "graduated" ? "Graduated" : (launch.live_at || stats.liveAt || "Live");
secondaryCountdownLabel = "Commit duration";
secondaryCountdownValue =
Number.isFinite(commitStartedAt) && Number.isFinite(commitEndsAt)
? fmtDuration(commitEndsAt - commitStartedAt)
: "—";
}

if (status === "failed" || status === "failed_refunded") {
primaryCountdownLabel = "Launch state";
primaryCountdownValue = badgeText(status);
secondaryCountdownLabel = "Commit duration";
secondaryCountdownValue =
Number.isFinite(commitStartedAt) && Number.isFinite(commitEndsAt)
? fmtDuration(commitEndsAt - commitStartedAt)
: "—";
}

setTextByIds(["totalCommittedStat", "committedStat", "currentCommittedStat"], fmtSol(committed));
setTextByIds(["progressPercentStat", "fillPctStat", "commitFillStat"], `${pct}%`);
setTextByIds(["remainingToMinRaiseStat", "remainingToMinStat"], minMet ? "Reached" : fmtSol(remainingToMin));
setTextByIds(["remainingToHardCapStat", "remainingToCapStat"], hardCapMet ? "Filled" : fmtSol(remainingToHardCap));
setTextByIds(["participantsCountStat", "participantsTotalStat"], String(participants));
setTextByIds(["progressCountdownLabel", "phaseTimerLabel"], primaryCountdownLabel);
setTextByIds(["progressCountdownValue", "phaseTimerValue", "countdownValue"], primaryCountdownValue);
setTextByIds(["progressSecondaryLabel", "phaseMetaLabel"], secondaryCountdownLabel);
setTextByIds(["progressSecondaryValue", "phaseMetaValue"], secondaryCountdownValue);
setWidthByIds(["launchProgressFill", "commitProgressFill", "heroProgressFill"], `${pct}%`);

const progressBar = findFirstElementByIds(["launchProgressFill", "commitProgressFill", "heroProgressFill"]);
if (progressBar) {
progressBar.setAttribute("aria-valuenow", String(pct));
progressBar.setAttribute("aria-valuemin", "0");
progressBar.setAttribute("aria-valuemax", "100");
}

setTextByIds(["minRaiseStateStat"], minMet ? "Reached" : "Pending");
setTextByIds(["hardCapStateStat"], hardCapMet ? "Filled" : "Open");
}

function renderPhase(launch, committed, minRaise, hardCap, commitEndsAt, stats, lifecycle) {
const status = getDisplayPhaseStatus(launch, stats, lifecycle);
const countdownEndsAt = getCountdownEndsMs(launch, stats);
const caVisible = shouldExposePublicCa(status);
const contractAddress = caVisible
? choosePreferredString(
launch.contract_address,
lifecycle?.contractAddress,
lifecycle?.contract_address
)
: "";
const contractDisplay = contractAddress || "Pending";

setTextByIds(
[
"launchStatusBadge",
"launchStatusPill",
"launchPhasePill",
"launchStatusText2",
"phaseBadge",
"heroPhasePill",
],
phaseDisplayText(status)
);

[
"launchStatusBadge",
"launchStatusPill",
"launchPhasePill",
"launchStatusText2",
"phaseBadge",
"heroPhasePill",
].forEach((id) => setStatusPillClasses($(id), status));

const phaseHeadline = (() => {
if (status === "commit") return "Commit window is open";
if (status === "countdown") return "Launch has entered countdown";
if (status === "building") return "MSS is finalizing launch infrastructure";
if (status === "live") return "Launch is now live";
if (status === "graduated") return "Launch has graduated";
if (status === "failed_refunded") return "Launch closed and refunded";
if (status === "failed") return "Launch did not reach threshold";
return `Launch is ${phaseDisplayText(status).toLowerCase()}`;
})();

const phaseSummary = (() => {
if (status === "commit") {
const minLeft = Math.max(0, safeNum(minRaise, 0) - safeNum(committed, 0));
return minLeft > 0
? `${fmtSol(minLeft)} remains to reach minimum raise.`
: `Minimum raise reached. ${fmtSol(Math.max(0, safeNum(hardCap, 0) - safeNum(committed, 0)))} remains to hard cap.`;
}

if (status === "countdown") {
return Number.isFinite(countdownEndsAt)
? `Countdown ends in ${fmtCountdown(countdownEndsAt - Date.now())}.`
: "Countdown is active.";
}

if (status === "building") {
return "Mint reservation, LP bootstrap, and live market activation are in progress.";
}

if (status === "live") {
if (lifecycle?.graduationReadiness?.ready) {
return "Graduation threshold is currently satisfied.";
}
return lifecycle?.graduationReadiness?.reason || "Live market is active.";
}

if (status === "graduated") {
return lifecycle?.graduationStatus || "Launch completed graduation flow.";
}

if (status === "failed_refunded") {
return "All tracked commitments have been refunded and the launch is closed.";
}

if (status === "failed") {
return "Commit refunds remain available for eligible wallets.";
}

return `Current status: ${phaseDisplayText(status)}.`;
})();

setTextByIds(["phaseHeadline", "phaseTitle", "launchPhaseTitle"], phaseHeadline);
setTextByIds(["phaseSummary", "phaseDescription", "launchPhaseSummary"], phaseSummary);
setTextByIds(["contractAddressText", "contractAddressValue", "launchContractAddress", "contractAddressStat"], contractDisplay);
setTextByIds(["commitEndsValue", "commitEndsAtStat"], Number.isFinite(commitEndsAt) ? new Date(commitEndsAt).toLocaleString() : "—");
setTextByIds(
["countdownEndsValue", "countdownEndsAtStat"],
Number.isFinite(countdownEndsAt) ? new Date(countdownEndsAt).toLocaleString() : "—"
);

const contractRows = ["contractAddressRow", "caRow", "launchCaRow"];
contractRows.forEach((id) => {
const el = $(id);
if (!el) return;
el.classList.toggle("hidden", !caVisible && !contractAddress);
});
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

const [launchRes, commitsRes, reconcileRes] = await Promise.all([
fetchJson(`/api/launcher/${id}`),
fetchJson(`/api/launcher/commits/${id}`),
fetchJson(`/api/launcher/${id}/reconcile`).catch(() => null),
]);

if (requestSeq !== loadRequestSeq) return;

const commitsStats = commitsRes || {};
const baseLaunchRaw = normalizeLaunchData(launchRes?.launch || {});
const reconcileLaunchRaw = normalizeLaunchData(reconcileRes?.launch || {});

const strongestLaunch = mergeLaunchTruth(baseLaunchRaw, reconcileLaunchRaw, commitsStats, currentLifecycle);

currentLaunch = mergeLaunchTruth(currentLaunch || {}, strongestLaunch, commitsStats, currentLifecycle);

currentCommitStats = {
...(currentCommitStats || {}),
...(commitsRes || {}),
...(reconcileRes
? {
status: reconcileRes.status || commitsRes?.status,
totalCommitted: reconcileRes.totalCommitted ?? commitsRes?.totalCommitted,
participants: reconcileRes.participants ?? commitsRes?.participants,
}
: {}),
};

currentLaunch = mergeLaunchTruth(currentLaunch || {}, currentLaunch || {}, currentCommitStats || {}, currentLifecycle);

currentLifecycle = mergeLifecycleTruth(
currentLifecycle,
launchRes?.lifecycle || commitsRes?.lifecycle || reconcileRes?.lifecycle || null
);

currentGraduationPlan =
launchRes?.graduationPlan ||
commitsRes?.graduationPlan ||
reconcileRes?.graduationPlan ||
currentGraduationPlan ||
null;
}

async function loadLifecycleIfNeeded(force = false) {
const id = qs("id");
if (!id) return;
if (!currentLaunch) return;

const effectiveStatus = getDisplayPhaseStatus(currentLaunch, currentCommitStats, currentLifecycle);
const eligibleStatuses = new Set(["countdown", "building", "live", "graduated"]);

if (!eligibleStatuses.has(effectiveStatus)) {
return;
}

if (lifecycleRefreshInFlight) return;
if (!force && effectiveStatus !== "live" && effectiveStatus !== "graduated") return;

lifecycleRefreshInFlight = true;

try {
const lifecycleRes = await fetchJson(`/api/launcher/${id}/lifecycle`).catch(() => null);
if (!lifecycleRes) return;

currentLifecycle = mergeLifecycleTruth(currentLifecycle, lifecycleRes.lifecycle || null);
currentGraduationPlan = lifecycleRes.graduationPlan || currentGraduationPlan || null;

currentLaunch = mergeLaunchTruth(
currentLaunch || {},
{
status: currentLifecycle?.launchStatus || currentLaunch?.status || "",
contract_address: currentLifecycle?.contractAddress || currentLifecycle?.contract_address || currentLaunch?.contract_address || "",
},
currentCommitStats || {},
currentLifecycle
);
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

await refresh({ marketSyncMode: "hard", syncLifecycle: true });
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

const teamAllocationPct = safeNum(stats.teamAllocationPct, safeNum(launch.team_allocation_pct, 0));
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

function buildLifecycleSummaryText(lifecycle, launch) {
if (!lifecycle || !launch) return "";

const parts = [];

if (isLiveLikeStatus(getDisplayPhaseStatus(launch, currentCommitStats, lifecycle))) {
if (safeNum(lifecycle.internalSolReserve, 0) > 0) {
parts.push(`Internal LP reserve: ${fmtSol(lifecycle.internalSolReserve, 4)}`);
}

if (safeNum(lifecycle.totalSupply, 0) > 0 && safeNum(lifecycle.priceSol, 0) > 0) {
parts.push(`Internal price: ${safeNum(lifecycle.priceSol).toFixed(8).replace(/\.?0+$/, "")} SOL`);
}

if (lifecycle.builderVesting?.lockedAmount > 0) {
parts.push(`Builder locked: ${fmtTokenAmount(lifecycle.builderVesting.lockedAmount, 0)} tokens`);
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

const rawStatus = getDisplayPhaseStatus(launch, stats, lifecycle);
const commitOpen = canCommitForStatus(rawStatus);
const refundOpen = canRefundForStatus(rawStatus);
const refundOnly = rawStatus === "failed";

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
amountInput.setAttribute("placeholder", commitOpen ? "0.50" : badgeText(getDisplayPhaseStatus(launch, stats, lifecycle)));
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

async function syncLaunchMarketController(mode = "soft") {
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

if (mode === "hard" && typeof launchMarketController.refreshLaunch === "function") {
await launchMarketController.refreshLaunch({ force: true });
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
currentLaunch || {},
currentCommitStats || {},
currentLifecycle
);
launchMarketController.commitStats = currentCommitStats || {};
if (typeof launchMarketController.applyAll === "function") {
launchMarketController.applyAll();
}
}

if (mode === "hard" && typeof launchMarketController.refreshLaunch === "function") {
await launchMarketController.refreshLaunch({ force: true });
} else if (
mode === "live-only" &&
isLiveLikeStatus(getDisplayPhaseStatus(currentLaunch, currentCommitStats, currentLifecycle)) &&
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
const pct = hardCap > 0 ? Math.max(0, Math.min(100, Math.floor((committed / hardCap) * 100))) : 0;
const displayStatus = getDisplayPhaseStatus(launch, stats, lifecycle);

if ($("launchSubline")) {
const lifecycleText = buildLifecycleSummaryText(lifecycle, launch);
$("launchSubline").textContent = `${launch.symbol || "—"} • ${String(launch.template || "—").replaceAll("_", " ")} • ${phaseDisplayText(displayStatus)}${lifecycleText ? ` • ${lifecycleText}` : ""}`;
}

if ($("launchDesc")) {
$("launchDesc").textContent = launch.description || "No description provided.";
}

if ($("launchStatusText")) {
$("launchStatusText").textContent = phaseDisplayText(displayStatus);
}

updateLifecycleVisibility(displayStatus);
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

if (displayStatus === "failed_refunded") {
setClosureNote(
bondState.refunded
? `This launch failed, all tracked commitments were automatically refunded, the builder bond of ${fmtSol(bondState.amount)} was refunded, and the launch is now closed.`
: bondState.paid
? `This launch failed, all tracked commitments were automatically refunded, and the launch is now closed. A builder bond of ${fmtSol(bondState.amount)} was collected earlier but is not marked refunded.`
: "This launch failed, all tracked commitments were automatically refunded, and the launch is now closed.",
"warn"
);
} else if (displayStatus === "failed" && String(launch.template || "") === "builder") {
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
} else if (displayStatus === "building") {
setClosureNote(
"Countdown has completed and MSS is now finalizing mint assignment, reserve bootstrap, and live market activation.",
"warn"
);
} else if (displayStatus === "live" && lifecycle?.graduationReadiness?.ready) {
setClosureNote(
`Launch is live and currently graduation-ready. Planned split: ${safeNum(lifecycle.raydiumTargetPct, 50)}% Raydium / ${safeNum(lifecycle.mssLockedTargetPct, 50)}% MSS locked.`,
"good"
);
} else if (displayStatus === "graduated") {
setClosureNote(
`Launch has graduated. Liquidity lifecycle status: ${lifecycle?.graduationStatus || "graduated"}.`,
"good"
);
} else {
setClosureNote("");
}

lastRenderedPhaseStatus = displayStatus;
}

async function refresh(options = {}) {
const { marketSyncMode = "soft", syncLifecycle = false } = options;

if (refreshInFlight) return;
refreshInFlight = true;

try {
await loadLaunch();

if (syncLifecycle) {
await loadLifecycleIfNeeded(true);
} else if (currentLifecycle) {
currentLaunch = mergeLaunchTruth(
currentLaunch || {},
{
status: currentLifecycle?.launchStatus || currentLaunch?.status || "",
contract_address: currentLifecycle?.contractAddress || currentLifecycle?.contract_address || currentLaunch?.contract_address || "",
},
currentCommitStats || {},
currentLifecycle
);
}

render();

if (marketSyncMode !== "none") {
await syncLaunchMarketController(marketSyncMode);
}
} finally {
refreshInFlight = false;
}
}

async function refreshStateBeforeAction() {
await refresh({ marketSyncMode: "hard", syncLifecycle: true });
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
await syncLaunchMarketController("hard");
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
await syncLaunchMarketController("hard");
}

setStatus("Wallet disconnected.", "warn");
}

function buildLateRefundMessage(err, fallbackSignature = "") {
const data = err?.data || {};
const refundedSol = data.refundedSol;
const refundTxSignature = data.refundTxSignature || "";
const originalTx = data.txSignature || fallbackSignature || "";
const status = data.status ? `\nLaunch status: ${data.status}` : "";
const refundLine = Number.isFinite(Number(refundedSol)) ? `\nRefunded: ${refundedSol} SOL` : "";
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

if (!canCommitForStatus(getDisplayPhaseStatus(launch, stats, currentLifecycle))) {
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

const destinationWallet = String(prepare.escrowWallet || prepare.destinationWallet || "").trim();

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

await refresh({ marketSyncMode: "hard", syncLifecycle: true });
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
await refresh({ marketSyncMode: "hard", syncLifecycle: true });
} catch (refreshErr) {
console.error(refreshErr);
}
} else {
setStatus(err?.message || "Commit failed.", "bad");
try {
await refresh({ marketSyncMode: "hard", syncLifecycle: true });
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

if (!canRefundForStatus(getDisplayPhaseStatus(launch, stats, currentLifecycle))) {
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

const bondLine =
safeNum(data.builderBondRefunded, 0) > 0
? `\nBuilder bond refunded: ${data.builderBondRefunded} SOL`
: "";

setStatus(
`Refund successful.\n\nRefunded: ${data.refundedSolActual || data.refundedSol} SOL${bondLine}\nTotal committed: ${data.totalCommitted} SOL\nParticipants: ${data.participants}\nTransaction: ${data.refundTxSignature || "Recorded"}`,
"good"
);

await refresh({ marketSyncMode: "hard", syncLifecycle: true });
restartRefreshLoop();
restartLifecycleRefreshLoop();
} catch (err) {
console.error(err);
setStatus(err?.message || "Refund failed.", "bad");
try {
await refresh({ marketSyncMode: "hard", syncLifecycle: true });
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
await syncLaunchMarketController("hard");
});
}

function getDynamicRefreshIntervalMs() {
const displayStatus = getDisplayPhaseStatus(currentLaunch, currentCommitStats, currentLifecycle);
if (displayStatus === "building") return BUILDING_PHASE_REFRESH_INTERVAL_MS;
if (displayStatus === "countdown") return COUNTDOWN_REFRESH_INTERVAL_MS;
if (displayStatus === "commit") return COMMIT_PHASE_REFRESH_INTERVAL_MS;
return BASE_REFRESH_INTERVAL_MS;
}

function restartRefreshLoop() {
if (refreshIntervalId) {
clearInterval(refreshIntervalId);
refreshIntervalId = null;
}

const displayStatus = getDisplayPhaseStatus(currentLaunch, currentCommitStats, currentLifecycle);
const shouldRunBaseLoop =
displayStatus === "commit" ||
displayStatus === "countdown" ||
displayStatus === "building" ||
!currentLaunch?.status;

if (!shouldRunBaseLoop) return;

refreshIntervalId = setInterval(async () => {
if (refreshInFlight || commitActionInFlight || refundActionInFlight || countdownFinalizeInFlight) return;

try {
await refresh({ marketSyncMode: "soft", syncLifecycle: false });
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

if (!isLiveLikeStatus(getDisplayPhaseStatus(currentLaunch, currentCommitStats, currentLifecycle))) return;

lifecycleRefreshIntervalId = setInterval(async () => {
if (refreshInFlight || lifecycleRefreshInFlight) return;

try {
await loadLifecycleIfNeeded(true);
render();
await syncLaunchMarketController("live-only");
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
await refresh({ marketSyncMode: "hard", syncLifecycle: true });
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

const rawStatus = getDisplayPhaseStatus(currentLaunch, currentCommitStats, currentLifecycle);

if (rawStatus === "countdown") {
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

if (rawStatus !== lastRenderedPhaseStatus && !refreshInFlight) {
void refresh({ marketSyncMode: "hard", syncLifecycle: true })
.then(() => {
restartRefreshLoop();
restartLifecycleRefreshLoop();
})
.catch((err) => console.error(err));
}
}, RENDER_TICK_MS);
}

init();