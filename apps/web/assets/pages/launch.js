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
const LAUNCH_PAGE_INIT_KEY = "__mssLaunchPageInit_v3";
const COMMIT_DEDUP_WINDOW_MS = 2000;

function $(id) {
return document.getElementById(id);
}

function $all(selector) {
return Array.from(document.querySelectorAll(selector));
}

function getApiBase() {
const { protocol, hostname, port } = window.location;

if (
hostname === "devnet.mssprotocol.com" ||
hostname === "www.devnet.mssprotocol.com"
) {
return "https://api.devnet.mssprotocol.com";
}

if (port === "3000") {
return `${protocol}//${hostname}:8787`;
}

if (hostname.includes("-3000.app.github.dev")) {
return `${protocol}//${hostname.replace(
"-3000.app.github.dev",
"-8787.app.github.dev"
)}`;
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

function safeNum(value, fallback = 0) {
const n = Number(value);
return Number.isFinite(n) ? n : fallback;
}

function pickFiniteNumber(...values) {
for (const value of values) {
const n = Number(value);
if (Number.isFinite(n)) return n;
}

return null;
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

function choosePreferredArray(...values) {
for (const value of values) {
if (Array.isArray(value) && value.length) return value;
}

return [];
}

function parseTs(value) {
if (!value) return null;

const raw = String(value).trim();
if (!raw) return null;

const hasExplicitTimezone =
/z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw);

if (
!hasExplicitTimezone &&
/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
) {
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
return badgeText(status);
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

function humanizeTemplate(value) {
const raw = cleanString(value, 120);
if (!raw) return "Standard";
return raw.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function getLaunchDisplayName(launchLike = {}) {
return choosePreferredString(
launchLike?.token_name,
launchLike?.name,
launchLike?.symbol,
"Unnamed Launch"
);
}

function getDisplaySymbol(value, fallback = "—") {
const raw = choosePreferredString(value);
if (!raw) return fallback;
return raw.replace(/^\$+/, "") || fallback;
}

function shouldExposePublicCa(status) {
const normalized = cleanString(status, 64).toLowerCase();
return normalized === "live" || normalized === "graduated";
}

function normalizePhaseStatus(value) {
const normalized = cleanString(value, 64).toLowerCase();

if (normalized === "graduated" || normalized === "surged") return "graduated";
if (normalized === "live" || normalized === "trading") return "live";

if (
normalized === "building" ||
normalized === "bootstrap" ||
normalized === "bootstrapping" ||
normalized === "deploying" ||
normalized === "finalizing" ||
normalized === "finalising"
) {
return "building";
}

if (normalized === "countdown" || normalized === "pre_live" || normalized === "prelive") {
return "countdown";
}

if (normalized === "failed_refunded" || normalized === "refunded") {
return "failed_refunded";
}

if (normalized === "failed" || normalized === "cancelled" || normalized === "canceled") {
return "failed";
}

if (
normalized === "commit" ||
normalized === "committing" ||
normalized === "open" ||
normalized === "pending" ||
normalized === "created" ||
normalized === "draft"
) {
return "commit";
}

return "";
}

function resolveCanonicalLaunchStatus(
launchLike = {},
statsLike = {},
lifecycleLike = null
) {
const rawStatus = normalizePhaseStatus(launchLike?.status);
const lifecycleStatus = normalizePhaseStatus(
lifecycleLike?.launchStatus ||
lifecycleLike?.launch_status ||
lifecycleLike?.status ||
""
);

const contractAddress = choosePreferredString(
launchLike?.contract_address,
launchLike?.mint_address,
launchLike?.token_mint,
launchLike?.mint,
lifecycleLike?.contractAddress,
lifecycleLike?.contract_address
);

const mintStatus = cleanString(
launchLike?.mint_reservation_status,
64
).toLowerCase();

const mintFinalizedAtMs = parseTs(launchLike?.mint_finalized_at);

const countdownStartedMs = parseTs(
statsLike?.countdownStartedAt || launchLike?.countdown_started_at
);
const countdownEndsMs = parseTs(
statsLike?.countdownEndsAt ||
launchLike?.countdown_ends_at ||
launchLike?.live_at
);
const commitEndMs = parseTs(
statsLike?.commitEndsAt || launchLike?.commit_ends_at
);

const hasCountdownWindow =
Number.isFinite(countdownStartedMs) || Number.isFinite(countdownEndsMs);

const hasLiveSignal = Boolean(
contractAddress ||
mintStatus === "finalized" ||
Number.isFinite(mintFinalizedAtMs)
);

const now = Date.now();

if (rawStatus === "graduated" || lifecycleStatus === "graduated") {
return "graduated";
}

if (rawStatus === "failed_refunded" || lifecycleStatus === "failed_refunded") {
return "failed_refunded";
}

if (rawStatus === "failed" || lifecycleStatus === "failed") {
return "failed";
}

if (rawStatus === "live" || lifecycleStatus === "live") {
return "live";
}

/*
Protected phase rule:
countdown/building must never promote to live from CA/mint/finalized signals.
finalizeLaunch.js owns true live promotion.
*/
if (rawStatus === "building" || lifecycleStatus === "building") {
return "building";
}

if (rawStatus === "countdown" || lifecycleStatus === "countdown") {
if (Number.isFinite(countdownEndsMs) && now >= countdownEndsMs) {
return "building";
}

return "countdown";
}

if (rawStatus === "commit" || lifecycleStatus === "commit") {
return "commit";
}

if (hasCountdownWindow) {
if (Number.isFinite(countdownEndsMs) && now >= countdownEndsMs) {
return "building";
}

return "countdown";
}

if (
Number.isFinite(commitEndMs) &&
Number.isFinite(countdownEndsMs) &&
now >= commitEndMs &&
now < countdownEndsMs
) {
return "countdown";
}

/*
Legacy fallback only:
Old rows with no protected phase may infer live from finalized mint/CA data.
Never override countdown/building/failed states.
*/
if (!rawStatus && !lifecycleStatus && hasLiveSignal) {
return "live";
}

return "commit";
}

function sanitizePublicLaunchFields(
launchLike = {},
statsLike = {},
lifecycleLike = null
) {
const effectiveStatus = resolveCanonicalLaunchStatus(
launchLike,
statsLike,
lifecycleLike
);
const exposeCa = shouldExposePublicCa(effectiveStatus);

const contractAddress = exposeCa
? choosePreferredString(
launchLike?.contract_address,
launchLike?.mint_address,
launchLike?.token_mint,
launchLike?.mint,
lifecycleLike?.contractAddress,
lifecycleLike?.contract_address
)
: "";

const mintStatus = exposeCa
? cleanString(launchLike?.mint_reservation_status, 64).toLowerCase()
: "";

return {
...launchLike,
status: effectiveStatus,

contract_address: contractAddress,
mint_address: exposeCa
? choosePreferredString(launchLike?.mint_address, contractAddress)
: "",
token_mint: exposeCa
? choosePreferredString(launchLike?.token_mint, contractAddress)
: "",
mint: exposeCa
? choosePreferredString(launchLike?.mint, contractAddress)
: "",

reserved_mint_address: "",
reserved_mint_secret: "",
reserved_mint_public_key: "",
reserved_mint_private_key: "",
reserved_mint_keypair: "",

mint_reservation_status: mintStatus,
mint_finalized_at: exposeCa
? cleanString(launchLike?.mint_finalized_at, 200)
: "",
};
}

function normalizeLaunchData(raw = {}) {
return {
...raw,
status: cleanString(raw?.status, 64),
symbol: cleanString(raw?.symbol, 64),
token_name: cleanString(raw?.token_name, 200),
template: cleanString(raw?.template, 120),
builder_name: cleanString(raw?.builder_name, 200),
builder_wallet: cleanString(raw?.builder_wallet, 200),
builder_alias: cleanString(raw?.builder_alias, 200),
image_url: cleanString(raw?.image_url, 4000),
description: cleanString(raw?.description, 10000),

contract_address: cleanString(raw?.contract_address, 200),
mint_address: cleanString(raw?.mint_address, 200),
token_mint: cleanString(raw?.token_mint, 200),
mint: cleanString(raw?.mint, 200),

reserved_mint_address: cleanString(raw?.reserved_mint_address, 200),
reserved_mint_secret: cleanString(raw?.reserved_mint_secret, 20000),
reserved_mint_public_key: cleanString(raw?.reserved_mint_public_key, 200),
reserved_mint_private_key: cleanString(raw?.reserved_mint_private_key, 20000),
reserved_mint_keypair: cleanString(raw?.reserved_mint_keypair, 20000),

mint_reservation_status: cleanString(
raw?.mint_reservation_status,
64
).toLowerCase(),
mint_finalized_at: cleanString(raw?.mint_finalized_at, 200),

commit_started_at: cleanString(raw?.commit_started_at, 200),
commit_ends_at: cleanString(raw?.commit_ends_at, 200),
countdown_started_at: cleanString(raw?.countdown_started_at, 200),
countdown_ends_at: cleanString(raw?.countdown_ends_at, 200),
live_at: cleanString(raw?.live_at, 200),
failed_at: cleanString(raw?.failed_at, 200),
created_at: cleanString(raw?.created_at, 200),
updated_at: cleanString(raw?.updated_at, 200),

team_wallet_breakdown: choosePreferredArray(raw?.team_wallet_breakdown),
};
}

function mergeLaunchTruth(
previous = {},
next = {},
statsLike = {},
lifecycleLike = null
) {
const prevSanitized = normalizeLaunchData(previous || {});
const nextSanitized = normalizeLaunchData(next || {});

const lifecycleContract = cleanString(
lifecycleLike?.contractAddress || lifecycleLike?.contract_address,
200
);

const merged = {
...prevSanitized,
...nextSanitized,
};

merged.token_name = choosePreferredString(
nextSanitized?.token_name,
prevSanitized?.token_name
);
merged.symbol = choosePreferredString(
nextSanitized?.symbol,
prevSanitized?.symbol
);
merged.template = choosePreferredString(
nextSanitized?.template,
prevSanitized?.template
);
merged.builder_alias = choosePreferredString(
nextSanitized?.builder_alias,
prevSanitized?.builder_alias
);
merged.builder_name = choosePreferredString(
nextSanitized?.builder_name,
prevSanitized?.builder_name
);
merged.builder_wallet = choosePreferredString(
nextSanitized?.builder_wallet,
prevSanitized?.builder_wallet,
lifecycleLike?.builderWallet,
lifecycleLike?.builder_wallet
);
merged.image_url = choosePreferredString(
nextSanitized?.image_url,
prevSanitized?.image_url
);
merged.description = choosePreferredString(
nextSanitized?.description,
prevSanitized?.description
);
merged.team_wallet_breakdown = choosePreferredArray(
nextSanitized?.team_wallet_breakdown,
prevSanitized?.team_wallet_breakdown
);

merged.commit_started_at = choosePreferredString(
nextSanitized?.commit_started_at,
prevSanitized?.commit_started_at
);
merged.commit_ends_at = choosePreferredString(
nextSanitized?.commit_ends_at,
prevSanitized?.commit_ends_at
);
merged.countdown_started_at = choosePreferredString(
nextSanitized?.countdown_started_at,
prevSanitized?.countdown_started_at
);
merged.countdown_ends_at = choosePreferredString(
nextSanitized?.countdown_ends_at,
prevSanitized?.countdown_ends_at
);
merged.live_at = choosePreferredString(
nextSanitized?.live_at,
prevSanitized?.live_at,
merged.countdown_ends_at
);
merged.created_at = choosePreferredString(
nextSanitized?.created_at,
prevSanitized?.created_at
);
merged.updated_at = choosePreferredString(
nextSanitized?.updated_at,
prevSanitized?.updated_at
);
merged.failed_at = choosePreferredString(
nextSanitized?.failed_at,
prevSanitized?.failed_at
);
merged.mint_finalized_at = choosePreferredString(
nextSanitized?.mint_finalized_at,
prevSanitized?.mint_finalized_at
);

const strongestContract = choosePreferredString(
nextSanitized?.contract_address,
nextSanitized?.mint_address,
nextSanitized?.token_mint,
nextSanitized?.mint,
prevSanitized?.contract_address,
prevSanitized?.mint_address,
prevSanitized?.token_mint,
prevSanitized?.mint,
lifecycleContract
);

merged.contract_address = strongestContract;
merged.mint_address = choosePreferredString(
nextSanitized?.mint_address,
prevSanitized?.mint_address,
strongestContract
);
merged.token_mint = choosePreferredString(
nextSanitized?.token_mint,
prevSanitized?.token_mint,
strongestContract
);
merged.mint = choosePreferredString(
nextSanitized?.mint,
prevSanitized?.mint,
strongestContract
);

merged.mint_reservation_status = choosePreferredString(
nextSanitized?.mint_reservation_status,
prevSanitized?.mint_reservation_status
);

merged.status = resolveCanonicalLaunchStatus(merged, statsLike, lifecycleLike);

return sanitizePublicLaunchFields(merged, statsLike, lifecycleLike);
}

function normalizeGraduationReadinessData(raw = {}) {
if (!raw || typeof raw !== "object") return null;

return {
...raw,
ready: Boolean(raw.ready),
reason: cleanString(raw.reason, 500),
thresholds:
raw.thresholds && typeof raw.thresholds === "object"
? {
...raw.thresholds,
marketcapSol: safeNum(
raw.thresholds.marketcapSol ?? raw.thresholds.marketcap_sol,
0
),
volume24hSol: safeNum(
raw.thresholds.volume24hSol ?? raw.thresholds.volume24h_sol,
0
),
minHolders: safeNum(
raw.thresholds.minHolders ?? raw.thresholds.min_holders,
0
),
minLiveMinutes: safeNum(
raw.thresholds.minLiveMinutes ??
raw.thresholds.min_live_minutes,
0
),
lockDays: safeNum(
raw.thresholds.lockDays ?? raw.thresholds.lock_days,
0
),
}
: null,
};
}

function normalizeBuilderVestingData(raw = {}) {
if (!raw || typeof raw !== "object") return null;

return {
...raw,
builderWallet: choosePreferredString(
raw.builderWallet,
raw.builder_wallet
),
totalAllocation: safeNum(raw.totalAllocation ?? raw.total_allocation, 0),
dailyUnlock: safeNum(raw.dailyUnlock ?? raw.daily_unlock, 0),
unlockedAmount: safeNum(raw.unlockedAmount ?? raw.unlocked_amount, 0),
lockedAmount: safeNum(raw.lockedAmount ?? raw.locked_amount, 0),
vestingStartAt: cleanString(
raw.vestingStartAt ?? raw.vesting_start_at,
200
),
createdAt: cleanString(raw.createdAt ?? raw.created_at, 200),
updatedAt: cleanString(raw.updatedAt ?? raw.updated_at, 200),
vestedDays: safeNum(raw.vestedDays ?? raw.vested_days, 0),
};
}

function normalizeLifecycleData(raw = {}) {
if (!raw || typeof raw !== "object") return null;

return {
...raw,
status: cleanString(raw.status, 64).toLowerCase(),
launchStatus: cleanString(
raw.launchStatus ?? raw.launch_status ?? raw.status,
64
).toLowerCase(),
contractAddress: cleanString(
raw.contractAddress ?? raw.contract_address,
200
),
contract_address: cleanString(
raw.contract_address ?? raw.contractAddress,
200
),
builderWallet: cleanString(raw.builderWallet ?? raw.builder_wallet, 200),
builder_wallet: cleanString(raw.builder_wallet ?? raw.builderWallet, 200),
internalSolReserve: safeNum(
raw.internalSolReserve ?? raw.internal_sol_reserve,
0
),
internalTokenReserve: safeNum(
raw.internalTokenReserve ?? raw.internal_token_reserve,
0
),
totalSupply: safeNum(raw.totalSupply ?? raw.total_supply, 0),
priceSol: safeNum(raw.priceSol ?? raw.price_sol, 0),
volume24hSol: safeNum(raw.volume24hSol ?? raw.volume_24h_sol, 0),
lockedLpAmount: safeNum(raw.lockedLpAmount ?? raw.locked_lp_amount, 0),
mssLockedLpAmount: safeNum(
raw.mssLockedLpAmount ?? raw.mss_locked_lp_amount,
0
),
mssLockedLpSol: safeNum(
raw.mssLockedLpSol ?? raw.mss_locked_lp_sol,
0
),
lockedSolReserve: safeNum(
raw.lockedSolReserve ?? raw.locked_sol_reserve,
0
),
raydiumTargetPct: safeNum(
raw.raydiumTargetPct ?? raw.raydium_target_pct,
0
),
mssLockedTargetPct: safeNum(
raw.mssLockedTargetPct ?? raw.mss_locked_target_pct,
0
),
graduationStatus: cleanString(
raw.graduationStatus ?? raw.graduation_status,
120
),
graduationReason: cleanString(
raw.graduationReason ?? raw.graduation_reason,
200
),
raydiumPoolId: cleanString(
raw.raydiumPoolId ?? raw.raydium_pool_id,
300
),
lockStatus: cleanString(raw.lockStatus ?? raw.lock_status, 120),
updated_at: cleanString(raw.updated_at, 200),
graduationReadiness: normalizeGraduationReadinessData(
raw.graduationReadiness || raw.graduation_readiness || null
),
builderVesting: normalizeBuilderVestingData(
raw.builderVesting || raw.builder_vesting || null
),
};
}

function mergeLifecycleTruth(previous = null, next = null) {
if (!previous && !next) return null;
if (!previous) return normalizeLifecycleData(next);
if (!next) return normalizeLifecycleData(previous);

const prev = normalizeLifecycleData(previous);
const incoming = normalizeLifecycleData(next);

return {
...prev,
...incoming,
graduationReadiness:
incoming?.graduationReadiness || prev?.graduationReadiness || null,
builderVesting:
incoming?.builderVesting || prev?.builderVesting || null,
};
}

function setTextByIds(ids, value) {
for (const id of ids) {
const el = $(id);
if (el) el.textContent = value;
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

function setHrefByIds(ids, value) {
for (const id of ids) {
const el = $(id);
if (el) el.setAttribute("href", value);
}
}

function setStatusPillClasses(el, status) {
if (!el) return;
el.classList.remove("commit", "countdown", "live", "graduated", "failed");
el.classList.add(pillClass(status));
}

function setLaunchPhaseBadgeClass(el, status) {
if (!el) return;

el.classList.remove(
"phase-commit",
"phase-countdown",
"phase-building",
"phase-live",
"phase-graduated",
"phase-failed"
);

if (status === "commit") el.classList.add("phase-commit");
else if (status === "countdown") el.classList.add("phase-countdown");
else if (status === "building") el.classList.add("phase-building");
else if (status === "live") el.classList.add("phase-live");
else if (status === "graduated") el.classList.add("phase-graduated");
else if (status === "failed" || status === "failed_refunded") {
el.classList.add("phase-failed");
} else {
el.classList.add("phase-commit");
}
}

async function copyTextToClipboard(value) {
const text = String(value || "").trim();
if (!text) throw new Error("Nothing to copy.");

if (navigator.clipboard?.writeText) {
await navigator.clipboard.writeText(text);
return;
}

const textarea = document.createElement("textarea");
textarea.value = text;
textarea.setAttribute("readonly", "");
textarea.style.position = "fixed";
textarea.style.opacity = "0";
textarea.style.pointerEvents = "none";
document.body.appendChild(textarea);
textarea.select();
document.execCommand("copy");
textarea.remove();
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

function getLaunchBondLabel(launch) {
return String(launch?.template || "").toLowerCase() === "builder"
? "Builder bond"
: "Launch bond";
}

function getBuilderBondState(launch, stats) {
const builderBondSol = safeNum(
stats?.builderBondSol,
safeNum(
stats?.launchBondSol,
safeNum(
launch?.builder_bond_sol,
safeNum(launch?.launch_bond_sol, 0)
)
)
);
const builderBondRefunded =
safeNum(
stats?.builderBondRefunded,
safeNum(
stats?.launchBondRefunded,
safeNum(
launch?.builder_bond_refunded,
safeNum(launch?.launch_bond_refunded, 0)
)
)
) === 1;
const builderBondPaid =
safeNum(
stats?.builderBondPaid,
safeNum(
stats?.launchBondPaid,
safeNum(
launch?.builder_bond_paid,
safeNum(launch?.launch_bond_paid, 0)
)
)
) === 1;

return {
amount: builderBondSol,
paid: builderBondPaid,
refunded: builderBondRefunded,
pending:
builderBondSol > 0 && !builderBondPaid && !builderBondRefunded,
};
}

function getCountdownEndsMs(launch, stats) {
return parseTs(
stats?.countdownEndsAt || launch?.countdown_ends_at || launch?.live_at
);
}

function getCommitEndsMs(launch, stats) {
return parseTs(stats?.commitEndsAt || launch?.commit_ends_at);
}

function getDisplayPhaseStatus(launch, stats, lifecycle = currentLifecycle) {
return resolveCanonicalLaunchStatus(launch, stats, lifecycle);
}

function getLaunchStateMessage(launch, stats, lifecycle = null) {
const status = getDisplayPhaseStatus(launch, stats, lifecycle);
const bondState = getBuilderBondState(launch, stats);
const readiness = lifecycle?.graduationReadiness || null;
const bondLabel = getLaunchBondLabel(launch);

if (status === "commit") {
return {
kind: "warn",
message: "Commit phase is open. Max commit is 1 SOL per wallet.",
};
}

if (status === "countdown") {
const ends = getCountdownEndsMs(launch, stats);
const timePart = Number.isFinite(ends)
? ` Countdown ends in ${fmtCountdown(ends - Date.now())}.`
: "";

return {
kind: "warn",
message: `Launch is in countdown lock. Commits and refunds are closed.${timePart}`,
};
}

if (status === "building") {
return {
kind: "warn",
message:
"Countdown reached zero. MSS is finalizing mint, liquidity, and live market state.",
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
message: `Launch is now live. Participant allocations are fully unlocked and commit/refund actions are closed.${readinessLine}`,
};
}

if (status === "graduated") {
return {
kind: "good",
message:
"This launch has already graduated beyond the initial launch flow.",
};
}

if (status === "failed_refunded") {
const bondLine =
bondState.refunded && bondState.amount > 0
? ` ${bondLabel} of ${fmtSol(bondState.amount)} was refunded as well.`
: "";

return {
kind: "warn",
message: `This launch failed and all tracked commits were refunded. This launch is now closed.${bondLine}`,
};
}

if (status === "failed") {
const bondLine =
bondState.paid && !bondState.refunded && bondState.amount > 0
? ` ${bondLabel} of ${fmtSol(bondState.amount)} is still awaiting failed-launch handling.`
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

function updateLifecycleVisibility(status) {
const commitProgressSection = $("commitProgressSection");
const recentCommitsSection = $("recentCommitsSection");
const isLiveLike =
String(status || "") === "live" || String(status || "") === "graduated";

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
...($("connectWalletBtnMirror") ? [$("connectWalletBtnMirror")] : []),
...($("launchConnectWalletBtn") ? [$("launchConnectWalletBtn")] : []),
].filter(Boolean);
}

function getDisconnectButtons() {
return [
...$all('[data-role="wallet-disconnect"]'),
...($("disconnectWalletBtnMirror") ? [$("disconnectWalletBtnMirror")] : []),
...($("launchDisconnectWalletBtn") ? [$("launchDisconnectWalletBtn")] : []),
].filter(Boolean);
}

function getWalletPills() {
return [
...$all('[data-role="wallet-pill"]'),
...($("walletPillMirror") ? [$("walletPillMirror")] : []),
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

function renderRecent(items) {
const list = $("recentList");
if (!list) return;

if (!Array.isArray(items) || !items.length) {
list.innerHTML =
`<div class="recent-item"><div class="recent-meta">No commits yet.</div></div>`;
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
const commitStartedAt = parseTs(
stats.commitStartedAt || launch.commit_started_at
);
const countdownStartedAt = parseTs(
stats.countdownStartedAt || launch.countdown_started_at
);

if (
!Number.isFinite(commitStartedAt) ||
!Number.isFinite(countdownStartedAt)
) {
return null;
}

if (countdownStartedAt <= commitStartedAt) return null;
return countdownStartedAt - commitStartedAt;
}

function renderBuilderInfo(launch) {
const alias = choosePreferredString(
launch.builder_alias,
launch.builder_name,
"MSS Builder"
);
const wallet = choosePreferredString(launch.builder_wallet, launch.builder, "");
const trustScore = safeNum(
launch.builder_trust_score,
safeNum(launch.builder_score, safeNum(launch.trust_score, 0))
);
const trust = getBuilderTrust(trustScore);
const isBuilderLaunch =
String(launch.template || "").toLowerCase() === "builder";

const badgeCount = pickFiniteNumber(
launch.builder_badges_count,
launch.builder_badge_count,
launch.badge_count,
launch.badges_unlocked
);
const liveLaunchCount = pickFiniteNumber(
launch.builder_live_launches,
launch.live_launches_count,
launch.builder_live_count
);
const totalLaunchCount = pickFiniteNumber(
launch.builder_total_launches,
launch.total_launches_count,
launch.builder_launch_count
);

setHiddenByIds(
["builderInfoSection", "builderCard", "builderProfileWrap"],
!isBuilderLaunch
);

setTextByIds(["launchBuilderAliasText"], alias);
setTextByIds(["launchBuilderIntelSub"], trust.note);
setTextByIds(["launchBuilderTrustPill"], trust.label);
setTextByIds(
["launchBuilderScoreText"],
trustScore > 0 ? String(Math.round(trustScore)) : "—"
);
setTextByIds(
["launchBuilderBadgesText"],
badgeCount != null ? String(Math.round(badgeCount)) : "—"
);
setTextByIds(
["launchBuilderLiveCountText"],
liveLaunchCount != null ? String(Math.round(liveLaunchCount)) : "—"
);
setTextByIds(
["launchBuilderLaunchCountText"],
totalLaunchCount != null ? String(Math.round(totalLaunchCount)) : "—"
);

const builderProfileHref = wallet
? `./builder.html?wallet=${encodeURIComponent(wallet)}`
: "./builder.html";
setHrefByIds(["launchBuilderProfileBtn2"], builderProfileHref);

const launchCommandBuilder = $("launchCommandBuilder");
if (launchCommandBuilder) launchCommandBuilder.textContent = alias;

const launchCommandScore = $("launchCommandScore");
if (launchCommandScore) {
launchCommandScore.textContent =
trustScore > 0 ? String(Math.round(trustScore)) : "—";
}
}

function resolveAllocationPct(primary, fallback) {
const n = safeNum(primary, NaN);
if (Number.isFinite(n)) return n;
return safeNum(fallback, 0);
}

function formatAllocationStatText(value, fallbackText = "—") {
const numeric = Number(value);
return Number.isFinite(numeric) && numeric > 0 ? fmtPct(numeric) : fallbackText;
}

function renderAllocationStructure(launch, stats) {
const isBuilderLaunch =
String(launch.template || "").toLowerCase() === "builder";

const participantPct = pickFiniteNumber(
stats?.participantAllocationPct,
launch.participant_allocation_pct,
launch.participants_allocation_pct,
launch.participants_pct
);
const liquidityPct = pickFiniteNumber(
stats?.liquidityAllocationPct,
launch.liquidity_allocation_pct,
launch.liquidity_pct,
20
);
const reservePct = pickFiniteNumber(
stats?.reserveAllocationPct,
launch.reserve_allocation_pct,
launch.reserve_pct
);
const builderPct = isBuilderLaunch
? pickFiniteNumber(
stats?.builderAllocationPct,
launch.builder_allocation_pct,
launch.builder_pct,
5
)
: null;

const participantText = Number.isFinite(participantPct)
? fmtPct(participantPct)
: "LP Based";
const liquidityText = Number.isFinite(liquidityPct)
? fmtPct(liquidityPct)
: "20%";
const reserveText = Number.isFinite(reservePct)
? fmtPct(reservePct)
: "Managed";
const builderText = isBuilderLaunch
? formatAllocationStatText(builderPct, "5%")
: "—";

setTextByIds(["participantAllocationPctStat"], participantText);
setTextByIds(["liquidityAllocationPctStat"], liquidityText);
setTextByIds(["reserveAllocationPctStat"], reserveText);
setTextByIds(["builderAllocationPctStat"], builderText);

setHiddenByIds(["builderAllocationStatWrap"], !isBuilderLaunch);

setTextByIds(["launchOverviewTemplateText"], humanizeTemplate(launch.template));

const raiseStructureParts = [
"Participants priced from final raise",
`${liquidityText} LP`,
Number.isFinite(reservePct) && reservePct > 0
? `${reserveText} Reserve`
: "Reserve custody active",
];
setTextByIds(["launchRaiseStructureText"], raiseStructureParts.join(" • "));

const bondState = getBuilderBondState(launch, stats);
const teamAllocationPct = safeNum(
stats?.teamAllocationPct,
safeNum(launch?.team_allocation_pct, 0)
);
const bondLabel = getLaunchBondLabel(launch);

const parts = [];

if (isBuilderLaunch) {
parts.push(builderText !== "—" ? `${builderText} Builder` : "Builder Launch");
if (teamAllocationPct > 0) {
parts.push(`${fmtPct(teamAllocationPct)} Team`);
}
} else {
parts.push("Public Launch");
}

if (bondState.amount > 0) {
if (bondState.refunded) {
parts.push(`${bondLabel} ${fmtSol(bondState.amount)} Refunded`);
} else if (bondState.paid) {
parts.push(`${bondLabel} ${fmtSol(bondState.amount)} Collected`);
} else {
parts.push(`${bondLabel} ${fmtSol(bondState.amount)} Pending`);
}
}

setTextByIds(["launchBuilderControlsText"], parts.join(" • "));
}

function renderTeamWalletBreakdown(launch, stats) {
const wrap = $("builderExtraBlock");
const teamAllocationPctStat = $("teamAllocationPctStat");
const builderBondStat = $("builderBondStat");
const teamWalletBreakdownList = $("teamWalletBreakdownList");

if (
!wrap ||
!teamAllocationPctStat ||
!builderBondStat ||
!teamWalletBreakdownList
) {
return;
}

const isBuilder = String(launch.template || "") === "builder";
const bondState = getBuilderBondState(launch, stats);

if (!isBuilder && bondState.amount <= 0) {
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

teamAllocationPctStat.textContent = `${teamAllocationPct}%`;

if (bondState.refunded) {
builderBondStat.innerHTML =
`${fmtSol(bondState.amount)}<div style="margin-top:6px;font-size:12px;color:rgba(255,255,255,.62);font-weight:600;">Refunded</div>`;
} else if (bondState.paid) {
builderBondStat.innerHTML =
`${fmtSol(bondState.amount)}<div style="margin-top:6px;font-size:12px;color:rgba(255,255,255,.62);font-weight:600;">Collected</div>`;
} else if (bondState.pending) {
builderBondStat.innerHTML =
`${fmtSol(bondState.amount)}<div style="margin-top:6px;font-size:12px;color:rgba(255,255,255,.62);font-weight:600;">Pending</div>`;
} else {
builderBondStat.textContent = fmtSol(bondState.amount);
}

if (!isBuilder) {
teamWalletBreakdownList.innerHTML =
`<div class="recent-item"><div class="recent-meta">No visible team wallet breakdown for this template.</div></div>`;
return;
}

if (!breakdown.length) {
teamWalletBreakdownList.innerHTML =
`<div class="recent-item"><div class="recent-meta">No team wallet breakdown set.</div></div>`;
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

if (
isLiveLikeStatus(
getDisplayPhaseStatus(launch, currentCommitStats, lifecycle)
)
) {
if (safeNum(lifecycle.internalSolReserve, 0) > 0) {
parts.push(`Internal LP reserve: ${fmtSol(lifecycle.internalSolReserve, 4)}`);
}

if (
safeNum(lifecycle.totalSupply, 0) > 0 &&
safeNum(lifecycle.priceSol, 0) > 0
) {
parts.push(
`Internal price: ${safeNum(lifecycle.priceSol).toFixed(8).replace(/\.?0+$/, "")} SOL`
);
}

if (safeNum(lifecycle?.builderVesting?.lockedAmount, 0) > 0) {
parts.push(
`Builder locked: ${fmtTokenAmount(lifecycle.builderVesting.lockedAmount, 0)} tokens`
);
}

if (lifecycle.graduationReadiness?.ready) {
parts.push("Graduation-ready");
}
}

return parts.join(" • ");
}

function renderOverviewPanels(launch, stats, lifecycle) {
const status = getDisplayPhaseStatus(launch, stats, lifecycle);
const trustScore = pickFiniteNumber(
launch.builder_trust_score,
launch.builder_score,
launch.trust_score
);
const builderAlias = choosePreferredString(
launch.builder_alias,
launch.builder_name,
"MSS Builder"
);
const totalCommitted = safeNum(
stats?.totalCommitted,
safeNum(launch?.committed_sol, 0)
);
const hardCap = safeNum(
stats?.hardCap,
safeNum(launch?.hard_cap_sol, 0)
);
const minRaise = safeNum(
stats?.minRaise,
safeNum(launch?.min_raise_sol, 0)
);
const templateText = humanizeTemplate(launch.template);
const tokenName = getLaunchDisplayName(launch);
const lifecycleSummary = buildLifecycleSummaryText(lifecycle, launch);

const walletState = getConnectedWallet();
setTextByIds(
["launchWalletAccessText"],
walletState.isConnected ? walletState.shortPublicKey : "Not Connected"
);

setTextByIds(["launchOverviewTemplateText"], templateText);
setTextByIds(
["launchLifecycleSummaryText"],
(() => {
if (status === "commit") return "Commit → Countdown → Building → Live";
if (status === "countdown") return "Countdown Locked";
if (status === "building") return "Bootstrapping";
if (status === "live") return "Live Market";
if (status === "graduated") return "Graduated";
if (status === "failed_refunded") return "Closed & Refunded";
if (status === "failed") return "Failed";
return phaseDisplayText(status);
})()
);

const overviewCopy = (() => {
const base =
`${tokenName} is running through MSS ${templateText.toLowerCase()} infrastructure with public builder identity linked to ${builderAlias}.`;

if (status === "commit") {
return `${base} ${fmtSol(Math.max(0, minRaise - totalCommitted))} remains to minimum raise and ${fmtSol(Math.max(0, hardCap - totalCommitted))} remains to hard cap.`;
}

if (status === "countdown") {
return `${base} Commit phase is closed and countdown lock is now controlling the transition into market activation.`;
}

if (status === "building") {
return `${base} MSS is finalizing mint assignment, internal liquidity bootstrap, and live market state.`;
}

if (status === "live" || status === "graduated") {
return `${base} Live market state is active, participant allocations are fully unlocked, and downstream lifecycle visibility remains attached to the same terminal.`;
}

if (status === "failed_refunded") {
return `${base} The launch failed and tracked commitments have already been refunded.`;
}

if (status === "failed") {
return `${base} The launch failed to satisfy launch requirements and refund handling remains the primary action path.`;
}

return base;
})();

setTextByIds(["launchOverviewCopy"], overviewCopy);

if ($("launchSubline")) {
$("launchSubline").textContent =
`${getDisplaySymbol(launch.symbol)} • ${templateText} • ${phaseDisplayText(status)}${lifecycleSummary ? ` • ${lifecycleSummary}` : ""}`;
}

if ($("launchDesc")) {
$("launchDesc").textContent =
launch.description || "No description provided.";
}

const overviewAccess = $("launchOverviewAccessText");
if (overviewAccess) {
overviewAccess.textContent =
status === "live"
? "Live Access"
: status === "graduated"
? "Graduated"
: status === "building"
? "Bootstrapping"
: status === "countdown"
? "Countdown Locked"
: "Pre-Live";
}

const builderProfileHref = choosePreferredString(
launch.builder_wallet,
lifecycle?.builderWallet,
lifecycle?.builder_wallet
)
? `./builder.html?wallet=${encodeURIComponent(
choosePreferredString(
launch.builder_wallet,
lifecycle?.builderWallet,
lifecycle?.builder_wallet
)
)}`
: "./builder.html";

setHrefByIds(["launchBuilderProfileBtn"], builderProfileHref);

const builderAliasChip = $("builderAlias");
if (builderAliasChip && !builderAliasChip.textContent.trim()) {
builderAliasChip.textContent = builderAlias;
}

const builderScoreChip = $("builderScoreStat");
if (builderScoreChip && !builderScoreChip.textContent.trim()) {
builderScoreChip.textContent =
trustScore != null && trustScore > 0
? String(Math.round(trustScore))
: "—";
}
}

function renderProgressCard(
launch,
committed,
hardCap,
minRaise,
participants,
pct,
commitEndsAt,
stats
) {
const status = getDisplayPhaseStatus(launch, stats, currentLifecycle);
const countdownEndsAt = getCountdownEndsMs(launch, stats);
const commitStartedAt = parseTs(
stats.commitStartedAt || launch.commit_started_at
);
const fillDurationMs = getFillDurationMs(launch, stats);
const now = Date.now();

const remainingToMin = Math.max(0, safeNum(minRaise, 0) - safeNum(committed, 0));
const remainingToHardCap = Math.max(0, safeNum(hardCap, 0) - safeNum(committed, 0));
const minMet = safeNum(committed, 0) >= safeNum(minRaise, 0) && safeNum(minRaise, 0) > 0;
const hardCapMet = safeNum(committed, 0) >= safeNum(hardCap, 0) && safeNum(hardCap, 0) > 0;

let primaryCountdownLabel = "Commit ends in";
let primaryCountdownValue = Number.isFinite(commitEndsAt)
? fmtCountdown(commitEndsAt - now)
: "—";

if (status === "countdown" || status === "building") {
primaryCountdownLabel =
status === "countdown" ? "Countdown ends in" : "Finalizing";
primaryCountdownValue =
status === "countdown" && Number.isFinite(countdownEndsAt)
? fmtCountdown(countdownEndsAt - now)
: "In progress";
}

if (status === "live" || status === "graduated") {
primaryCountdownLabel = status === "graduated" ? "Launch state" : "Went live";
primaryCountdownValue =
status === "graduated"
? "Graduated"
: launch.live_at || stats.liveAt || "Live";
}

if (status === "failed" || status === "failed_refunded") {
primaryCountdownLabel = "Launch state";
primaryCountdownValue = badgeText(status);
}

setTextByIds(
["totalCommittedStat", "committedStat", "currentCommittedStat"],
fmtSol(committed)
);
setTextByIds(
["progressPercentStat", "fillPctStat", "commitFillStat"],
`${pct}%`
);
setTextByIds(
["remainingToMinRaiseStat", "remainingToMinStat"],
minMet ? "Reached" : fmtSol(remainingToMin)
);
setTextByIds(
["remainingToHardCapStat", "remainingToCapStat"],
hardCapMet ? "Filled" : fmtSol(remainingToHardCap)
);
setTextByIds(
["participantsCountStat", "participantsTotalStat"],
String(participants)
);
setTextByIds(
["progressCountdownLabel", "phaseTimerLabel"],
primaryCountdownLabel
);
setTextByIds(
["progressCountdownValue", "phaseTimerValue", "countdownValue"],
primaryCountdownValue
);
setWidthByIds(
["launchProgressFill", "commitProgressFill", "heroProgressFill"],
`${pct}%`
);

const progressBar = $("launchProgressFill");
if (progressBar) {
progressBar.setAttribute("aria-valuenow", String(pct));
progressBar.setAttribute("aria-valuemin", "0");
progressBar.setAttribute("aria-valuemax", "100");
}

setTextByIds(["minRaiseStateStat"], minMet ? "Reached" : "Pending");
setTextByIds(["hardCapStateStat"], hardCapMet ? "Filled" : "Open");

setTextByIds(["launchOverviewMinRaiseText"], fmtSol(minRaise));
setTextByIds(["launchOverviewParticipantsText"], String(participants));

if ($("participantsStat")) $("participantsStat").textContent = String(participants);
if ($("minRaiseStat")) $("minRaiseStat").textContent = fmtSol(minRaise);
if ($("hardCapStat")) $("hardCapStat").textContent = fmtSol(hardCap);

const phaseMetaLabel = $("phaseMetaLabel");
const phaseMetaValue = $("phaseMetaValue");

if (phaseMetaLabel && phaseMetaValue) {
if (Number.isFinite(fillDurationMs)) {
phaseMetaLabel.textContent =
status === "countdown" || status === "building"
? "Commit window"
: "Fill duration";
phaseMetaValue.textContent =
status === "countdown" || status === "building"
? Number.isFinite(commitStartedAt) && Number.isFinite(commitEndsAt)
? fmtDuration(commitEndsAt - commitStartedAt)
: "—"
: fmtDuration(fillDurationMs);
} else {
phaseMetaLabel.textContent = "Commit window";
phaseMetaValue.textContent =
Number.isFinite(commitStartedAt) && Number.isFinite(commitEndsAt)
? fmtDuration(commitEndsAt - commitStartedAt)
: "—";
}
}
}

function renderPhase(launch, committed, minRaise, hardCap, commitEndsAt, stats, lifecycle) {
const status = getDisplayPhaseStatus(launch, stats, lifecycle);
const countdownEndsAt = getCountdownEndsMs(launch, stats);
const caVisible = shouldExposePublicCa(status);

setTextByIds(
["launchStatusBadge", "launchStatusPill", "phaseBadge"],
phaseDisplayText(status)
);

["launchStatusBadge", "launchStatusPill", "phaseBadge", "phasePillMirror"].forEach(
(id) => setStatusPillClasses($(id), status)
);

const phaseHeadline = (() => {
if (status === "commit") return "Commit window is open";
if (status === "countdown") return "Launch has entered countdown lock";
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
? `Countdown lock ends in ${fmtCountdown(countdownEndsAt - Date.now())}.`
: "Countdown lock is active.";
}

if (status === "building") {
return "Mint reservation, LP bootstrap, and live market activation are in progress.";
}

if (status === "live") {
if (lifecycle?.graduationReadiness?.ready) {
return "Graduation threshold is currently satisfied.";
}

return lifecycle?.graduationReadiness?.reason || "Live market is active and participant allocations are fully unlocked.";
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

setTextByIds(["phaseHeadline"], phaseHeadline);
setTextByIds(["phaseSummary"], phaseSummary);
setTextByIds(
["commitEndsAtStat"],
Number.isFinite(commitEndsAt) ? new Date(commitEndsAt).toLocaleString() : "—"
);
setTextByIds(
["countdownEndsAtStat"],
Number.isFinite(countdownEndsAt)
? new Date(countdownEndsAt).toLocaleString()
: "—"
);

const phaseBadgeEl = $("launchPhaseBadge");
if (phaseBadgeEl) {
setLaunchPhaseBadgeClass(phaseBadgeEl, status);
}

const contractRow = $("contractAddressRow");
if (contractRow) {
contractRow.classList.toggle("hidden", !caVisible);
}

const phasePillMirror = $("phasePillMirror");
if (phasePillMirror) {
phasePillMirror.textContent = phaseDisplayText(status);
}
}

function renderCommandSurfaceMeta(launch) {
const builderAlias = choosePreferredString(
launch.builder_alias,
launch.builder_name,
"MSS Builder"
);
const trustScore = pickFiniteNumber(
launch.builder_trust_score,
launch.builder_score,
launch.trust_score
);

const builderEl = $("launchCommandBuilder");
if (builderEl) builderEl.textContent = builderAlias;

const scoreEl = $("launchCommandScore");
if (scoreEl) {
scoreEl.textContent =
trustScore > 0 ? String(Math.round(trustScore)) : "—";
}
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
let lastCommitIntentKey = "";
let lastCommitIntentAt = 0;

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
fetchJson(`/api/launcher/${id}/reconcile`, {
method: "POST",
}).catch(() => null),
]);

if (requestSeq !== loadRequestSeq) return;

currentCommitStats = {
...(currentCommitStats || {}),
...(commitsRes || {}),
...(reconcileRes
? {
status: reconcileRes.status || commitsRes?.status,
totalCommitted:
reconcileRes.totalCommitted ?? commitsRes?.totalCommitted,
participants:
reconcileRes.participants ?? commitsRes?.participants,
}
: {}),
};

const baseLaunchRaw = normalizeLaunchData(launchRes?.launch || {});
const reconcileLaunchRaw = normalizeLaunchData(reconcileRes?.launch || {});

const strongestLaunch = mergeLaunchTruth(
baseLaunchRaw,
reconcileLaunchRaw,
currentCommitStats || {},
currentLifecycle
);

currentLaunch = mergeLaunchTruth(
currentLaunch || {},
strongestLaunch,
currentCommitStats || {},
currentLifecycle
);

currentLifecycle = mergeLifecycleTruth(
currentLifecycle,
launchRes?.lifecycle ||
commitsRes?.lifecycle ||
reconcileRes?.lifecycle ||
null
);

currentLaunch = mergeLaunchTruth(
currentLaunch || {},
currentLaunch || {},
currentCommitStats || {},
currentLifecycle
);

currentGraduationPlan =
launchRes?.graduationPlan ||
launchRes?.graduation_plan ||
commitsRes?.graduationPlan ||
commitsRes?.graduation_plan ||
reconcileRes?.graduationPlan ||
reconcileRes?.graduation_plan ||
currentGraduationPlan ||
null;
}

async function loadLifecycleIfNeeded(force = false) {
const id = qs("id");
if (!id || !currentLaunch) return;

const effectiveStatus = getDisplayPhaseStatus(
currentLaunch,
currentCommitStats,
currentLifecycle
);

const eligibleStatuses = new Set([
"countdown",
"building",
"live",
"graduated",
]);

if (!eligibleStatuses.has(effectiveStatus)) {
return;
}

if (lifecycleRefreshInFlight) return;

if (!force && effectiveStatus !== "live" && effectiveStatus !== "graduated") {
return;
}

lifecycleRefreshInFlight = true;

try {
const lifecycleRes = await fetchJson(
`/api/launcher/${id}/lifecycle`
).catch(() => null);

if (!lifecycleRes) return;

currentLifecycle = mergeLifecycleTruth(
currentLifecycle,
lifecycleRes.lifecycle || null
);

currentGraduationPlan =
lifecycleRes.graduationPlan ||
lifecycleRes.graduation_plan ||
currentGraduationPlan ||
null;

currentLaunch = mergeLaunchTruth(
currentLaunch || {},
{
status: currentLifecycle?.launchStatus || currentLaunch?.status || "",
contract_address:
currentLifecycle?.contractAddress ||
currentLifecycle?.contract_address ||
currentLaunch?.contract_address ||
"",
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
if (!id || countdownFinalizeInFlight) return;

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
console.warn(
"launch.js finalize attempt did not complete:",
err?.message || err
);
}

await refresh({ marketSyncMode: "hard", syncLifecycle: true });
} finally {
countdownFinalizeInFlight = false;
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
const quickButtons = Array.from(
document.querySelectorAll(".quick button[data-amount]")
);
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
amountInput.setAttribute(
"placeholder",
commitOpen ? "0.50" : badgeText(rawStatus)
);
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
setStatus(stateInfo.message, stateInfo.kind, {
auto: true,
preserveManual: true,
});
} else {
clearAutoStatus();
}
}

async function syncLaunchMarketController(mode = "soft") {
const id = qs("id");
if (!id || !$("marketCard")) return;

const connectedWallet = getConnectedPublicKey() || "";

if (!launchMarketController) {
launchMarketController = await initLaunchMarket({
launchId: Number(id),
connectedWallet,
launch: currentLaunch || null,
commitStats: currentCommitStats || {},
saveLinks: defaultSaveLinksWithWallet,
});

if (
mode === "hard" &&
typeof launchMarketController.refreshLaunch === "function"
) {
await launchMarketController.refreshLaunch({ force: true });
}

return;
}

const previousWallet = launchMarketController.connectedWallet || "";
const walletChanged = previousWallet !== connectedWallet;

if (walletChanged && typeof launchMarketController.setConnectedWallet === "function") {
launchMarketController.setConnectedWallet(connectedWallet);
} else {
launchMarketController.connectedWallet = connectedWallet;
}

launchMarketController.saveLinks = defaultSaveLinksWithWallet;

const controllerPhaseBefore = launchMarketController.phase || "";
const localPhaseNow = getDisplayPhaseStatus(
currentLaunch,
currentCommitStats,
currentLifecycle
);

if (typeof launchMarketController.setBaseState === "function") {
launchMarketController.setBaseState(
currentLaunch || null,
currentCommitStats || {},
{
restartPolling:
mode === "hard" ||
walletChanged ||
controllerPhaseBefore !== localPhaseNow,
}
);
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

if (
mode === "hard" &&
typeof launchMarketController.refreshLaunch === "function"
) {
await launchMarketController.refreshLaunch({ force: true });
} else if (
mode === "live-only" &&
isLiveLikeStatus(
getDisplayPhaseStatus(currentLaunch, currentCommitStats, currentLifecycle)
) &&
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
const bondLabel = getLaunchBondLabel(launch);

const committed = safeNum(
stats.totalCommitted,
safeNum(launch.committed_sol)
);
const hardCap = safeNum(
stats.hardCap,
safeNum(launch.hard_cap_sol)
);
const minRaise = safeNum(
stats.minRaise,
safeNum(launch.min_raise_sol)
);
const participants = safeNum(
stats.participants,
safeNum(launch.participants_count)
);
const commitEndsAt = getCommitEndsMs(launch, stats);
const pct =
hardCap > 0
? Math.max(0, Math.min(100, Math.floor((committed / hardCap) * 100)))
: 0;
const displayStatus = getDisplayPhaseStatus(launch, stats, lifecycle);

updateLifecycleVisibility(displayStatus);
renderBuilderInfo(launch);
renderCommandSurfaceMeta(launch);
renderAllocationStructure(launch, stats);
renderTeamWalletBreakdown(launch, stats);
renderProgressCard(
launch,
committed,
hardCap,
minRaise,
participants,
pct,
commitEndsAt,
stats
);
renderOverviewPanels(launch, stats, lifecycle);
renderPhase(
launch,
committed,
minRaise,
hardCap,
commitEndsAt,
stats,
lifecycle
);
renderRecent(stats.recent || []);
updateWalletUi();
renderActionPanelState(launch, stats, lifecycle);

if (displayStatus === "failed_refunded") {
setClosureNote(
bondState.refunded
? `This launch failed, all tracked commitments were automatically refunded, the ${bondLabel.toLowerCase()} of ${fmtSol(bondState.amount)} was refunded, and the launch is now closed.`
: bondState.paid
? `This launch failed, all tracked commitments were automatically refunded, and the launch is now closed. A collected ${bondLabel.toLowerCase()} of ${fmtSol(bondState.amount)} is not marked refunded.`
: "This launch failed, all tracked commitments were automatically refunded, and the launch is now closed.",
"warn"
);
} else if (displayStatus === "failed") {
if (bondState.paid && !bondState.refunded) {
setClosureNote(
`This launch failed. Commit refunds are available and the collected ${bondLabel.toLowerCase()} of ${fmtSol(bondState.amount)} should be handled by the failed-launch refund flow.`,
"warn"
);
} else if (bondState.pending) {
setClosureNote(
`This launch failed. No collected ${bondLabel.toLowerCase()} is recorded on this launch.`,
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
contract_address:
currentLifecycle?.contractAddress ||
currentLifecycle?.contract_address ||
currentLaunch?.contract_address ||
"",
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

setStatus(
msg.includes("No supported wallet") ? getMobileWalletHelpText() : msg,
"bad"
);
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
const refundLine = Number.isFinite(Number(refundedSol))
? `\nRefunded: ${refundedSol} SOL`
: "";
const originalTxLine = originalTx
? `\nOriginal transaction: ${originalTx}`
: "";
const refundTxLine = refundTxSignature
? `\nRefund transaction: ${refundTxSignature}`
: "";

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

const intentKey = `${id}:${wallet}:${solAmount}`;
const now = Date.now();

if (
lastCommitIntentKey === intentKey &&
now - lastCommitIntentAt < COMMIT_DEDUP_WINDOW_MS
) {
return;
}

lastCommitIntentKey = intentKey;
lastCommitIntentAt = now;

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

await refresh({ marketSyncMode: "hard", syncLifecycle: true });
restartRefreshLoop();
restartLifecycleRefreshLoop();
} catch (err) {
console.error(err);

const lateRefund =
Number(err?.status) === 409 &&
(err?.data?.refundTxSignature ||
Number.isFinite(Number(err?.data?.refundedSol)));

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
safeNum(data.builderBondRefunded, safeNum(data.launchBondRefunded, 0)) > 0
? `\n${getLaunchBondLabel(launch)} refunded: ${safeNum(data.builderBondRefunded, safeNum(data.launchBondRefunded, 0))} SOL`
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
if (btn.dataset.quickBound === "1") return;

btn.dataset.quickBound = "1";

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

function bindUtilityButtons() {
const builderCopyBtn = $("launchBuilderCopyWalletBtn");

if (builderCopyBtn && builderCopyBtn.dataset.bound !== "1") {
builderCopyBtn.dataset.bound = "1";

builderCopyBtn.addEventListener("click", async () => {
try {
const builderWallet = choosePreferredString(
currentLaunch?.builder_wallet,
currentLifecycle?.builderWallet,
currentLifecycle?.builder_wallet
);

if (!builderWallet) {
setStatus("Builder wallet is not available.", "warn");
return;
}

await copyTextToClipboard(builderWallet);
setStatus("Builder wallet copied.", "good");
} catch (err) {
setStatus(err?.message || "Copy failed.", "bad");
}
});
}
}

function bindWalletEvents() {
bindWalletButtons();
bindUtilityButtons();

if (walletChangeBound) return;

walletChangeBound = true;

onWalletChange(async () => {
updateWalletUi();

if (currentLaunch && currentCommitStats) render();

await syncLaunchMarketController("hard");
});
}

function getDynamicRefreshIntervalMs() {
const displayStatus = getDisplayPhaseStatus(
currentLaunch,
currentCommitStats,
currentLifecycle
);

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

const displayStatus = getDisplayPhaseStatus(
currentLaunch,
currentCommitStats,
currentLifecycle
);

const shouldRunBaseLoop =
displayStatus === "commit" ||
displayStatus === "countdown" ||
displayStatus === "building" ||
!currentLaunch?.status;

if (!shouldRunBaseLoop) return;

refreshIntervalId = setInterval(async () => {
if (
refreshInFlight ||
commitActionInFlight ||
refundActionInFlight ||
countdownFinalizeInFlight
) {
return;
}

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

if (
!isLiveLikeStatus(
getDisplayPhaseStatus(currentLaunch, currentCommitStats, currentLifecycle)
)
) {
return;
}

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
badge.classList.add(
walletState.isConnected ? "is-connected" : "is-disconnected"
);

let dotEl = badge.querySelector(".terminal-wallet-badge-dot");
let labelEl = badge.querySelector(".terminal-wallet-badge-label");

if (!dotEl || !labelEl) {
badge.innerHTML =
`<span class="terminal-wallet-badge-dot"></span><span class="terminal-wallet-badge-label"></span>`;
dotEl = badge.querySelector(".terminal-wallet-badge-dot");
labelEl = badge.querySelector(".terminal-wallet-badge-label");
}

if (labelEl) {
labelEl.textContent = walletState.isConnected
? "Wallet Connected"
: "Wallet Disconnected";
}
}

setTextByIds(
["launchWalletAccessText"],
walletState.isConnected ? walletState.shortPublicKey : "Not Connected"
);
}

async function init() {
if (window[LAUNCH_PAGE_INIT_KEY]) return;

window[LAUNCH_PAGE_INIT_KEY] = true;
window.API_BASE = getApiBase();

bindQuickAmounts();
bindWalletEvents();

const commitForm = $("commitForm");
if (commitForm && commitForm.dataset.bound !== "1") {
commitForm.dataset.bound = "1";
commitForm.addEventListener("submit", onCommitSubmit);
}

const refundBtn = $("refundBtn");
if (refundBtn && refundBtn.dataset.bound !== "1") {
refundBtn.dataset.bound = "1";
refundBtn.addEventListener("click", refundCommit);
}

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

const rawStatus = getDisplayPhaseStatus(
currentLaunch,
currentCommitStats,
currentLifecycle
);

if (rawStatus === "countdown" || rawStatus === "building") {
const countdownEndsMs = getCountdownEndsMs(
currentLaunch,
currentCommitStats
);

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