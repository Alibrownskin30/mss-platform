import {
connectWallet as connectAnyWallet,
disconnectWallet as disconnectAnyWallet,
getConnectedWallet,
getConnectedPublicKey,
onWalletChange,
restoreWalletIfTrusted,
getMobileWalletHelpText,
} from "../wallet.js";
import { initLaunchMarket } from "../../js/launch-market.js";

const BASE_REFRESH_INTERVAL_MS = 15000;
const COMMIT_PHASE_REFRESH_INTERVAL_MS = 15000;
const COUNTDOWN_REFRESH_INTERVAL_MS = 2500;
const BUILDING_PHASE_REFRESH_INTERVAL_MS = 1800;
const RENDER_TICK_MS = 1000;
const FORCE_FINALIZE_COOLDOWN_MS = 8000;
const LIVE_LIFECYCLE_REFRESH_INTERVAL_MS = 20000;
const LAUNCH_PAGE_INIT_KEY = "__mssLaunchPageInit_v4";
const COMMIT_DEDUP_WINDOW_MS = 2000;

const PARTICIPANT_ROLE = "participant";
const ACKNOWLEDGEMENT_MODEL = "acknowledgement_only";
const PARTICIPANT_ACKNOWLEDGEMENT_FIELDS = [
{
id: "ackParticipantTerms",
key: "terms_accepted",
message: "Accept the MSS Launcher Terms before committing.",
label: "I accept the MSS Launcher Terms for participating in this launch.",
},
{
id: "ackParticipantRiskDisclosure",
key: "risk_disclosure_accepted",
message: "Accept the launch risk disclosure before committing.",
label: "I understand crypto launches involve significant risk and outcomes are not guaranteed.",
},
{
id: "ackParticipantLaunchRules",
key: "launch_rules_accepted",
message: "Accept the launch rules and transaction conditions before committing.",
label: "I accept the launch rules, allocation conditions and transaction conditions.",
},
{
id: "ackParticipantNoAdvice",
key: "no_advice_accepted",
message: "Accept the information-only acknowledgement before committing.",
label: "I understand MSS provides information and infrastructure only, not investment advice.",
},
];

const LIVE_LIQUIDITY_TARGET_PCT = 100;
const PROTOCOL_RESERVE_HELD_PCT = 0;
const FORMER_RESERVE_BURNED = true;
const UNUSED_PARTICIPANT_ALLOCATION_BURNED = true;
const BUILDER_LP_FEE_RIGHTS_PCT = 100;
const MSS_LP_FEE_RIGHTS_PCT = 0;
const BUILDER_LP_FEE_RIGHTS_VIA_DISTRIBUTOR = true;
const LP_FEE_CONTROL_MODE_DEFAULT = "distributor_only";
const LP_FEE_DISTRIBUTION_MODEL_DEFAULT = "builder_via_mss_distributor";
const LP_FEE_BENEFICIARY_TYPE_DEFAULT = "builder";
const LP_FEE_CONTROLLER_TYPE_DEFAULT = "mss_distributor";

/*
launch-market.js owns the live terminal and market shell.
launch.js must not write to these IDs or it will create UI ownership drift.
*/
const MARKET_OWNED_TEXT_IDS = new Set([
"launchStatusText",
"launchStatusText2",
"launchMarketModeText",
"marketStatusLabel",
"marketOverlayEyebrow",
"marketOverlayTitle",
"phaseValueMirror",
"launchStatusBoardValue",
"launchCommandPhase",
"launchCommandStatus",
"phaseNoteMirror",
"launchStatusBoardNote",
"launchCommandText",
"launchStatusBoardAccess",
"launchCommandMarket",
"launchTerminalModeLabel",
"launchTerminalPhaseLabel",
"launchOverviewAccessText",
"phasePillMirror",
"launchStatusBadge",
"launchStatusPill",
"phaseHeadline",
"phaseSummary",
"launchTokenName",
"launchTokenNameMirror",
"launchCommandTitle",
"launchTokenSymbol",
"launchBuilderLabel",
"launchBuilderWalletShort",
"launchBuilderTierText",
"launchTokenLogo",
"builderAlias",
"builderScoreStat",
"launchCommandBuilder",
"launchCommandScore",
"launchStatusBoardBuilderWallet",
"launchSubline",
"launchCaText",
"chartCaChipText",
"contractAddressText",
"contractAddressValue",
"launchContractAddress",
"contractAddressStat",
"launchStatusBoardCa",
"launchCaState",
"walletTokenBalanceValue",
"walletPositionValueValue",
"walletSolBalanceValue",
"launchWalletSummaryText",
"launchWalletPositionText",
"launchWalletLimitText",
"marketAccessTierLabel",
"marketAccessStatePill",
"marketAccessLimitValue",
"marketAccessHoldingValue",
"marketAccessRemainingValue",
"marketTotalSupplyValue",
"marketAccessSchedule",
"launchAccessModeText",
"lifecycleStatusValue",
"lifecycleStatusPill",
"lifecycleReservesValue",
"lifecycleSplitValue",
"lifecycleLockValue",
"lifecycleRaydiumValue",
"builderVestValue",
"graduationReadinessValue",
"graduationReadinessNote",
"launchGraduationReadinessText",
"launchLpInternalText",
"launchLockedLpText",
"launchMigrationStateText",
"launchCassieVerdictText",
"launchCassiePrimaryText",
"launchCassiePatternText",
]);

const MARKET_OWNED_HIDDEN_IDS = new Set(["contractAddressRow"]);
const MARKET_OWNED_CLASS_IDS = new Set([
"launchPhaseBadge",
"launchStatusBadge",
"launchStatusPill",
"phasePillMirror",
]);

function $(id) {
return document.getElementById(id);
}

function $all(selector) {
return Array.from(document.querySelectorAll(selector));
}

function isMarketOwnedTextId(id) {
return MARKET_OWNED_TEXT_IDS.has(String(id || ""));
}

function isMarketOwnedHiddenId(id) {
return MARKET_OWNED_HIDDEN_IDS.has(String(id || ""));
}

function isMarketOwnedClassId(id) {
return MARKET_OWNED_CLASS_IDS.has(String(id || ""));
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
const text = cleanString(value);
if (text) return text;
}

return "";
}

function choosePreferredArray(...values) {
for (const value of values) {
if (Array.isArray(value) && value.length) return value;
}

return [];
}

function toTruthyBoolean(value) {
if (value === true || value === 1) return true;
const raw = String(value ?? "").trim().toLowerCase();
return ["true", "1", "yes", "y", "on", "accepted"].includes(raw);
}

function isFalseLike(value) {
const raw = String(value ?? "").trim().toLowerCase();
return value === false || value === 0 || raw === "0" || raw === "false" || raw === "no";
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

const seconds = Math.floor(ms / 1000);
const hours = Math.floor(seconds / 3600);
const minutes = Math.floor((seconds % 3600) / 60);
const remainder = seconds % 60;

if (hours > 0) {
return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
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
const amount = Number(solAmount);

if (!Number.isFinite(amount) || amount <= 0) {
throw new Error("Invalid SOL amount.");
}

return Math.round(amount * 1_000_000_000);
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
const value = safeNum(score, 0);

if (value >= 80) {
return {
label: "Strong",
note: "Builder profile currently shows strong trust alignment.",
};
}

if (value >= 55) {
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
const value = String(wallet || "").trim();
if (!value) return "No wallet connected";
if (value.length <= 12) return value;
return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function humanizeTemplate(value) {
const raw = cleanString(value, 120);
if (!raw) return "Standard";
return raw.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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

function isMarketBootstrappedFalse(launchLike = {}, lifecycleLike = null) {
return isFalseLike(
launchLike?.market_bootstrapped ??
lifecycleLike?.market_bootstrapped ??
lifecycleLike?.marketBootstrapped
);
}

function resolveCanonicalLaunchStatus(launchLike = {}, statsLike = {}, lifecycleLike = null) {
const rawStatus = normalizePhaseStatus(launchLike?.status);
const lifecycleStatus = normalizePhaseStatus(
lifecycleLike?.launchStatus || lifecycleLike?.launch_status || lifecycleLike?.status || ""
);
const contractAddress = choosePreferredString(
launchLike?.contract_address,
launchLike?.mint_address,
launchLike?.token_mint,
launchLike?.mint,
lifecycleLike?.contractAddress,
lifecycleLike?.contract_address
);
const mintStatus = cleanString(launchLike?.mint_reservation_status, 64).toLowerCase();
const mintFinalizedAtMs = parseTs(launchLike?.mint_finalized_at);
const countdownStartedMs = parseTs(statsLike?.countdownStartedAt || launchLike?.countdown_started_at);
const countdownEndsMs = parseTs(
statsLike?.countdownEndsAt || launchLike?.countdown_ends_at || launchLike?.live_at
);
const hasCountdownWindow = Number.isFinite(countdownStartedMs) || Number.isFinite(countdownEndsMs);
const hasLiveSignal = Boolean(contractAddress || mintStatus === "finalized" || Number.isFinite(mintFinalizedAtMs));
const now = Date.now();

if (rawStatus === "graduated" || lifecycleStatus === "graduated") return "graduated";
if (rawStatus === "failed_refunded" || lifecycleStatus === "failed_refunded") return "failed_refunded";
if (rawStatus === "failed" || lifecycleStatus === "failed") return "failed";

if (rawStatus === "live" || lifecycleStatus === "live") {
return isMarketBootstrappedFalse(launchLike, lifecycleLike) ? "building" : "live";
}

/* Finalization owns live promotion; protected phases cannot promote from CA/mint clues. */
if (rawStatus === "building" || lifecycleStatus === "building") return "building";

if (rawStatus === "countdown" || lifecycleStatus === "countdown") {
return Number.isFinite(countdownEndsMs) && now >= countdownEndsMs ? "building" : "countdown";
}

if (rawStatus === "commit" || lifecycleStatus === "commit") return "commit";

if (hasCountdownWindow) {
return Number.isFinite(countdownEndsMs) && now >= countdownEndsMs ? "building" : "countdown";
}

/* Legacy-only fallback for rows with no lifecycle phase stored. */
if (!rawStatus && !lifecycleStatus && hasLiveSignal) return "live";

return "commit";
}

function sanitizePublicLaunchFields(launchLike = {}, statsLike = {}, lifecycleLike = null) {
const effectiveStatus = resolveCanonicalLaunchStatus(launchLike, statsLike, lifecycleLike);
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

return {
...launchLike,
status: effectiveStatus,
contract_address: contractAddress,
mint_address: exposeCa ? choosePreferredString(launchLike?.mint_address, contractAddress) : "",
token_mint: exposeCa ? choosePreferredString(launchLike?.token_mint, contractAddress) : "",
mint: exposeCa ? choosePreferredString(launchLike?.mint, contractAddress) : "",
reserved_mint_address: "",
reserved_mint_secret: "",
reserved_mint_public_key: "",
reserved_mint_private_key: "",
reserved_mint_keypair: "",
mint_reservation_status: exposeCa ? cleanString(launchLike?.mint_reservation_status, 64).toLowerCase() : "",
mint_finalized_at: exposeCa ? cleanString(launchLike?.mint_finalized_at, 200) : "",
market_bootstrapped:
launchLike?.market_bootstrapped ??
lifecycleLike?.market_bootstrapped ??
lifecycleLike?.marketBootstrapped ??
null,
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
mint_reservation_status: cleanString(raw?.mint_reservation_status, 64).toLowerCase(),
mint_finalized_at: cleanString(raw?.mint_finalized_at, 200),
market_bootstrapped: raw?.market_bootstrapped ?? null,
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

function mergeLaunchTruth(previous = {}, next = {}, statsLike = {}, lifecycleLike = null) {
const prev = normalizeLaunchData(previous || {});
const incoming = normalizeLaunchData(next || {});
const merged = { ...prev, ...incoming };
const lifecycleContract = cleanString(lifecycleLike?.contractAddress || lifecycleLike?.contract_address, 200);

for (const field of [
"token_name",
"symbol",
"template",
"builder_alias",
"builder_name",
"image_url",
"description",
"commit_started_at",
"commit_ends_at",
"countdown_started_at",
"countdown_ends_at",
"live_at",
"created_at",
"updated_at",
"failed_at",
"mint_finalized_at",
"mint_reservation_status",
]) {
merged[field] = choosePreferredString(incoming[field], prev[field]);
}

merged.builder_wallet = choosePreferredString(
incoming.builder_wallet,
prev.builder_wallet,
lifecycleLike?.builderWallet,
lifecycleLike?.builder_wallet
);
merged.team_wallet_breakdown = choosePreferredArray(
incoming.team_wallet_breakdown,
prev.team_wallet_breakdown
);
merged.market_bootstrapped =
incoming?.market_bootstrapped ??
prev?.market_bootstrapped ??
lifecycleLike?.market_bootstrapped ??
lifecycleLike?.marketBootstrapped ??
null;

const strongestContract = choosePreferredString(
incoming?.contract_address,
incoming?.mint_address,
incoming?.token_mint,
incoming?.mint,
prev?.contract_address,
prev?.mint_address,
prev?.token_mint,
prev?.mint,
lifecycleContract
);

merged.contract_address = strongestContract;
merged.mint_address = choosePreferredString(incoming?.mint_address, prev?.mint_address, strongestContract);
merged.token_mint = choosePreferredString(incoming?.token_mint, prev?.token_mint, strongestContract);
merged.mint = choosePreferredString(incoming?.mint, prev?.mint, strongestContract);
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
marketcapSol: safeNum(raw.thresholds.marketcapSol ?? raw.thresholds.marketcap_sol, 0),
volume24hSol: safeNum(raw.thresholds.volume24hSol ?? raw.thresholds.volume_24h_sol, 0),
minHolders: safeNum(raw.thresholds.minHolders ?? raw.thresholds.min_holders, 0),
minLiveMinutes: safeNum(raw.thresholds.minLiveMinutes ?? raw.thresholds.min_live_minutes, 0),
lockDays: safeNum(raw.thresholds.lockDays ?? raw.thresholds.lock_days, 0),
}
: null,
};
}

function normalizeBuilderVestingData(raw = {}) {
if (!raw || typeof raw !== "object") return null;

return {
...raw,
builderWallet: choosePreferredString(raw.builderWallet, raw.builder_wallet),
totalAllocation: safeNum(raw.totalAllocation ?? raw.total_allocation, 0),
dailyUnlock: safeNum(raw.dailyUnlock ?? raw.daily_unlock, 0),
unlockedAmount: safeNum(raw.unlockedAmount ?? raw.unlocked_amount, 0),
lockedAmount: safeNum(raw.lockedAmount ?? raw.locked_amount, 0),
vestingStartAt: cleanString(raw.vestingStartAt ?? raw.vesting_start_at, 200),
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
launchStatus: cleanString(raw.launchStatus ?? raw.launch_status ?? raw.status, 64).toLowerCase(),
contractAddress: cleanString(raw.contractAddress ?? raw.contract_address, 200),
contract_address: cleanString(raw.contract_address ?? raw.contractAddress, 200),
builderWallet: cleanString(raw.builderWallet ?? raw.builder_wallet, 200),
builder_wallet: cleanString(raw.builder_wallet ?? raw.builderWallet, 200),
marketBootstrapped: raw.marketBootstrapped ?? raw.market_bootstrapped ?? null,
market_bootstrapped: raw.market_bootstrapped ?? raw.marketBootstrapped ?? null,
internalSolReserve: safeNum(raw.internalSolReserve ?? raw.internal_sol_reserve, 0),
internalTokenReserve: safeNum(raw.internalTokenReserve ?? raw.internal_token_reserve, 0),
totalSupply: safeNum(raw.totalSupply ?? raw.total_supply, 0),
priceSol: safeNum(raw.priceSol ?? raw.price_sol, 0),
volume24hSol: safeNum(raw.volume24hSol ?? raw.volume_24h_sol, 0),
lockedLpAmount: safeNum(raw.lockedLpAmount ?? raw.locked_lp_amount, 0),
mssLockedLpAmount: safeNum(raw.mssLockedLpAmount ?? raw.mss_locked_lp_amount, 0),
mssLockedLpSol: safeNum(raw.mssLockedLpSol ?? raw.mss_locked_lp_sol, 0),
lockedSolReserve: safeNum(raw.lockedSolReserve ?? raw.locked_sol_reserve, 0),
raydiumTargetPct: safeNum(raw.raydiumTargetPct ?? raw.raydium_target_pct, LIVE_LIQUIDITY_TARGET_PCT),
mssLockedTargetPct: safeNum(raw.mssLockedTargetPct ?? raw.mss_locked_target_pct, 0),
liveLiquidityTargetPct: safeNum(
raw.liveLiquidityTargetPct ?? raw.live_liquidity_target_pct,
safeNum(raw.raydiumTargetPct ?? raw.raydium_target_pct, LIVE_LIQUIDITY_TARGET_PCT)
),
protocolReserveHeldPct: safeNum(
raw.protocolReserveHeldPct ?? raw.protocol_reserve_held_pct,
PROTOCOL_RESERVE_HELD_PCT
),
formerReserveBurned: raw.formerReserveBurned ?? raw.former_reserve_burned ?? FORMER_RESERVE_BURNED,
unusedParticipantAllocationBurned:
raw.unusedParticipantAllocationBurned ??
raw.unused_participant_allocation_burned ??
UNUSED_PARTICIPANT_ALLOCATION_BURNED,
graduationStatus: cleanString(raw.graduationStatus ?? raw.graduation_status, 120),
graduationReason: cleanString(raw.graduationReason ?? raw.graduation_reason, 200),
raydiumPoolId: cleanString(raw.raydiumPoolId ?? raw.raydium_pool_id, 300),
raydiumSolMigrated: safeNum(raw.raydiumSolMigrated ?? raw.raydium_sol_migrated, 0),
raydiumTokenMigrated: safeNum(raw.raydiumTokenMigrated ?? raw.raydium_token_migrated, 0),
raydiumMigrationTx: cleanString(raw.raydiumMigrationTx ?? raw.raydium_migration_tx, 300),
lockStatus: cleanString(raw.lockStatus ?? raw.lock_status, 120),
updated_at: cleanString(raw.updated_at, 200),
lpFeeBeneficiaryWallet: cleanString(raw.lpFeeBeneficiaryWallet ?? raw.lp_fee_beneficiary_wallet, 200),
lpFeeBeneficiaryType:
cleanString(raw.lpFeeBeneficiaryType ?? raw.lp_fee_beneficiary_type, 120) ||
LP_FEE_BENEFICIARY_TYPE_DEFAULT,
lpFeeControllerType:
cleanString(raw.lpFeeControllerType ?? raw.lp_fee_controller_type, 120) ||
LP_FEE_CONTROLLER_TYPE_DEFAULT,
lpFeeControlMode:
cleanString(raw.lpFeeControlMode ?? raw.lp_fee_control_mode, 120) ||
LP_FEE_CONTROL_MODE_DEFAULT,
lpFeeDistributionModel:
cleanString(raw.lpFeeDistributionModel ?? raw.lp_fee_distribution_model, 160) ||
LP_FEE_DISTRIBUTION_MODEL_DEFAULT,
lpFeeSource: cleanString(raw.lpFeeSource ?? raw.lp_fee_source, 120),
lpFeeDistributorEnabled: toTruthyBoolean(raw.lpFeeDistributorEnabled ?? raw.lp_fee_distributor_enabled),
lpFeeDistributorStatus: cleanString(raw.lpFeeDistributorStatus ?? raw.lp_fee_distributor_status, 120),
lpFeeDistributorAddress: cleanString(raw.lpFeeDistributorAddress ?? raw.lp_fee_distributor_address, 300),
lpFeeDistributorProgram: cleanString(raw.lpFeeDistributorProgram ?? raw.lp_fee_distributor_program, 300),
lpFeeDistributorProgramId: cleanString(raw.lpFeeDistributorProgramId ?? raw.lp_fee_distributor_program_id, 300),
lpFeeDistributorVault: cleanString(raw.lpFeeDistributorVault ?? raw.lp_fee_distributor_vault, 300),
lpFeeDistributorTx: cleanString(raw.lpFeeDistributorTx ?? raw.lp_fee_distributor_tx, 300),
lpFeeLastDistributedAt: raw.lpFeeLastDistributedAt ?? raw.lp_fee_last_distributed_at ?? null,
builderLpFeeRightsPct: safeNum(raw.builderLpFeeRightsPct ?? raw.builder_lp_fee_rights_pct, BUILDER_LP_FEE_RIGHTS_PCT),
mssLpFeeRightsPct: safeNum(raw.mssLpFeeRightsPct ?? raw.mss_lp_fee_rights_pct, MSS_LP_FEE_RIGHTS_PCT),
builderLpFeeRightsViaDistributor:
raw.builderLpFeeRightsViaDistributor ??
raw.builder_lp_fee_rights_via_distributor ??
BUILDER_LP_FEE_RIGHTS_VIA_DISTRIBUTOR,
builderCanRemoveLp: toTruthyBoolean(raw.builderCanRemoveLp ?? raw.builder_can_remove_lp),
builderCanClaimLpFees: toTruthyBoolean(raw.builderCanClaimLpFees ?? raw.builder_can_claim_lp_fees),
externalMarketVenue: cleanString(raw.externalMarketVenue ?? raw.external_market_venue, 120),
externalMarketMode: cleanString(raw.externalMarketMode ?? raw.external_market_mode, 120),
graduationReadiness: normalizeGraduationReadinessData(raw.graduationReadiness || raw.graduation_readiness || null),
builderVesting: normalizeBuilderVestingData(raw.builderVesting || raw.builder_vesting || null),
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
graduationReadiness: incoming?.graduationReadiness || prev?.graduationReadiness || null,
builderVesting: incoming?.builderVesting || prev?.builderVesting || null,
};
}

function resolveLiveLiquidityTargetPct(lifecycle = null, plan = null) {
return safeNum(
lifecycle?.liveLiquidityTargetPct ??
lifecycle?.raydiumTargetPct ??
plan?.liveLiquidityTargetPct ??
plan?.raydiumSplitPct ??
plan?.raydiumTargetPct,
LIVE_LIQUIDITY_TARGET_PCT
);
}

function resolveProtocolReserveHeldPct(lifecycle = null, plan = null) {
return safeNum(
lifecycle?.protocolReserveHeldPct ?? plan?.protocolReserveHeldPct,
PROTOCOL_RESERVE_HELD_PCT
);
}

function resolveBuilderLpFeeRightsPct(lifecycle = null) {
return safeNum(lifecycle?.builderLpFeeRightsPct, BUILDER_LP_FEE_RIGHTS_PCT);
}

function resolveMssLpFeeRightsPct(lifecycle = null) {
return safeNum(lifecycle?.mssLpFeeRightsPct, MSS_LP_FEE_RIGHTS_PCT);
}

function hasFormerReserveBurned(lifecycle = null, plan = null) {
const value = lifecycle?.formerReserveBurned ?? plan?.formerReserveBurned;
return value == null ? FORMER_RESERVE_BURNED : toTruthyBoolean(value);
}

function hasUnusedParticipantAllocationBurned(lifecycle = null, plan = null) {
const value =
lifecycle?.unusedParticipantAllocationBurned ?? plan?.unusedParticipantAllocationBurned;
return value == null ? UNUSED_PARTICIPANT_ALLOCATION_BURNED : toTruthyBoolean(value);
}

function usesDistributorLpFeeControl(lifecycle = null) {
const mode = cleanString(lifecycle?.lpFeeControlMode, 120);
if (mode) return mode === LP_FEE_CONTROL_MODE_DEFAULT;
return BUILDER_LP_FEE_RIGHTS_VIA_DISTRIBUTOR;
}

function setTextByIds(ids, value) {
for (const id of ids) {
if (isMarketOwnedTextId(id)) continue;
const el = $(id);
if (el) el.textContent = value;
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
if (isMarketOwnedHiddenId(id)) continue;
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
if (!el || isMarketOwnedTextId(el.id) || isMarketOwnedClassId(el.id)) return;
el.classList.remove("commit", "countdown", "live", "graduated", "failed");
el.classList.add(pillClass(status));
}

function setLaunchPhaseBadgeClass(el, status) {
if (!el || isMarketOwnedClassId(el.id)) return;

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
else if (status === "failed" || status === "failed_refunded") el.classList.add("phase-failed");
else el.classList.add("phase-commit");
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

if (preserveManual && el.textContent && el.dataset.autoState !== "1") return;

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
if (!el || el.dataset.autoState !== "1") return;
el.className = "status";
el.textContent = "";
el.dataset.autoState = "";
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

function getLaunchBondLabel() {
return "Launch bond";
}

function buildCompliancePageUrl(wallet = "", mode = PARTICIPANT_ROLE) {
const params = new URLSearchParams();
params.set("mode", mode);
if (wallet) params.set("wallet", wallet);
const launchId = qs("id");
if (launchId) params.set("launchId", launchId);
return `./compliance.html?${params.toString()}`;
}

function buildParticipantAcknowledgementPayload() {
const out = {};

for (const field of PARTICIPANT_ACKNOWLEDGEMENT_FIELDS) {
out[field.key] = Boolean($(field.id)?.checked);
}

return out;
}

function validateParticipantAcknowledgements() {
const acknowledgements = buildParticipantAcknowledgementPayload();

for (const field of PARTICIPANT_ACKNOWLEDGEMENT_FIELDS) {
if (!acknowledgements[field.key]) {
throw new Error(field.message);
}
}

return acknowledgements;
}

function ensureParticipantAcknowledgementUi() {
const form = $("commitForm");
if (!form) return;

let panel = $("participantAcknowledgementPanel");

if (!panel) {
panel = document.createElement("section");
panel.id = "participantAcknowledgementPanel";
panel.className = "access-card participant-acknowledgement-panel";
panel.innerHTML = `
<div class="access-card-head">
<div>
<div class="panel-kicker">Participant Acknowledgements</div>
<h4>Terms and risk acknowledgement</h4>
<p class="recent-meta">No ID verification or signup is required for the standard commit flow. Confirm the launcher terms before a transaction is prepared.</p>
</div>
</div>
<div id="participantAcknowledgementFields" class="participant-acknowledgement-fields"></div>
`;

const actionStack = form.querySelector(".action-stack");
if (actionStack) {
form.insertBefore(panel, actionStack);
} else {
form.appendChild(panel);
}
}

const container = $("participantAcknowledgementFields") || panel;

for (const field of PARTICIPANT_ACKNOWLEDGEMENT_FIELDS) {
if ($(field.id)) continue;

const row = document.createElement("label");
row.className = "checkout-check-row participant-acknowledgement-row";
row.innerHTML = `
<input id="${field.id}" type="checkbox" />
<span>${escapeHtml(field.label)}</span>
`;
container.appendChild(row);
}

for (const field of PARTICIPANT_ACKNOWLEDGEMENT_FIELDS) {
const checkbox = $(field.id);
if (!checkbox || checkbox.dataset.bound === "1") continue;

checkbox.dataset.bound = "1";
checkbox.addEventListener("change", () => {
if (currentLaunch && currentCommitStats) render();
});
}
}

function normalizeParticipantAccessPayload(payload = {}, wallet = "") {
const blockingSignals = Array.isArray(payload?.blocking_signals) ? payload.blocking_signals : [];
const accessState = cleanString(payload?.access_state, 40).toLowerCase();
const blocked = Boolean(
toTruthyBoolean(payload?.internal_intervention_active) ||
accessState === "blocked" ||
blockingSignals.some((signal) => toTruthyBoolean(signal?.blocking))
);

return {
...payload,
wallet: cleanString(payload?.wallet, 120) || cleanString(wallet, 120),
role: PARTICIPANT_ROLE,
mode: PARTICIPANT_ROLE,
compliance_model: ACKNOWLEDGEMENT_MODEL,
identity_verification_required: false,
kyc_required: false,
blocked,
acknowledgement_accepted: toTruthyBoolean(payload?.acknowledgement_accepted),
access_state: accessState || (blocked ? "blocked" : "acknowledgement_required"),
};
}

function getCurrentParticipantCompliancePayload() {
return currentParticipantCompliance?.payload || null;
}

function isParticipantInterventionBlocked(payload = null) {
return Boolean((payload || getCurrentParticipantCompliancePayload())?.blocked);
}

function getParticipantComplianceMessage(payload = null) {
const statusPayload = payload || getCurrentParticipantCompliancePayload();

if (!statusPayload) {
return "No ID verification or signup is required. Accept the Launcher terms and risk acknowledgements before committing.";
}

if (statusPayload.blocked) {
return (
cleanString(statusPayload.access_reason, 500) ||
"This wallet is currently unable to use Launcher transactions. Contact support if you believe this is an error."
);
}

if (statusPayload.acknowledgement_accepted) {
return "Required Launcher acknowledgements have been recorded for this wallet. No ID verification is required for this flow.";
}

return "No ID verification or signup is required. Accept the Launcher terms and risk acknowledgements below before committing.";
}

function renderParticipantComplianceUi(payload = null) {
const statusPayload = payload || getCurrentParticipantCompliancePayload();
const wallet = cleanString(statusPayload?.wallet, 120) || getConnectedPublicKey() || "";
const blocked = isParticipantInterventionBlocked(statusPayload);
const acknowledged = Boolean(statusPayload?.acknowledgement_accepted);
const message = getParticipantComplianceMessage(statusPayload);

const card = $("participantComplianceCard");
const pill = $("participantCompliancePill");
const statusTextEl = $("participantComplianceStatusText") || $("participantComplianceCopy");
const summaryEl = $("participantComplianceSummary") || $("participantComplianceMeta");
const action = $("participantComplianceAction");
const marketComplianceCard = $("marketComplianceCard");
const marketComplianceStatusText = $("marketComplianceStatusText");
const marketComplianceSummary = $("marketComplianceSummary");

const shouldShow = Boolean(wallet || statusPayload);
if (card) {
card.classList.toggle("hidden", !shouldShow);
card.classList.toggle("show", shouldShow);
}

let pillText = "Terms Required";
let pillClass = "warn";

if (blocked) {
pillText = "Wallet Blocked";
pillClass = "bad";
} else if (acknowledged) {
pillText = "Terms Recorded";
pillClass = "good";
} else {
pillText = "No ID / KYC Required";
pillClass = "good";
}

if (pill) {
pill.className = `status-pill ${pillClass}`;
pill.textContent = pillText;
}

if (statusTextEl) statusTextEl.textContent = message;

if (summaryEl) {
summaryEl.textContent = wallet
? `Wallet: ${shortenWallet(wallet)} • Flow: Acknowledgement only${blocked ? " • Access blocked" : ""}`
: "Connect a wallet to continue";
}

if (action) {
action.href = buildCompliancePageUrl(wallet, PARTICIPANT_ROLE);
action.textContent = blocked ? "Review Access Status" : "Review Terms";
action.style.display = wallet ? "" : "none";
}

if (marketComplianceCard) {
marketComplianceCard.classList.toggle("hidden", !shouldShow);
}

if (marketComplianceStatusText) marketComplianceStatusText.textContent = pillText;
if (marketComplianceSummary) marketComplianceSummary.textContent = message;
}

async function fetchParticipantComplianceStatus(wallet, { silent = false } = {}) {
const normalizedWallet = cleanString(wallet, 120);
const launchId = qs("id");

if (!normalizedWallet) {
currentParticipantCompliance = { wallet: "", payload: null };
renderParticipantComplianceUi(null);
return null;
}

const launchParam = launchId ? `&launchId=${encodeURIComponent(launchId)}` : "";
const data = await fetchJson(
`/api/compliance/status?wallet=${encodeURIComponent(normalizedWallet)}&role=${PARTICIPANT_ROLE}&mode=${PARTICIPANT_ROLE}${launchParam}`
);

const payload = normalizeParticipantAccessPayload(data, normalizedWallet);
currentParticipantCompliance = { wallet: normalizedWallet, payload };
renderParticipantComplianceUi(payload);

if (!silent) {
setStatus(getParticipantComplianceMessage(payload), payload.blocked ? "bad" : "good");
}

return payload;
}

async function refreshParticipantComplianceStatus({ silent = false } = {}) {
const wallet = getConnectedPublicKey() || $("commitWallet")?.value?.trim() || "";

if (!wallet) {
currentParticipantCompliance = { wallet: "", payload: null };
renderParticipantComplianceUi(null);
return null;
}

if (participantComplianceRefreshInFlight) return currentParticipantCompliance?.payload || null;

participantComplianceRefreshInFlight = true;

try {
return await fetchParticipantComplianceStatus(wallet, { silent });
} catch (err) {
if (!silent) setStatus(err?.message || "Unable to load wallet access status.", "bad");
throw err;
} finally {
participantComplianceRefreshInFlight = false;
}
}

async function requireParticipantTransactionAccess(wallet) {
const normalizedWallet = cleanString(wallet, 120);
const payload =
currentParticipantCompliance.wallet === normalizedWallet && currentParticipantCompliance.payload
? currentParticipantCompliance.payload
: await fetchParticipantComplianceStatus(normalizedWallet, { silent: true });

if (!isParticipantInterventionBlocked(payload)) return payload;

renderParticipantComplianceUi(payload);
throw new Error(getParticipantComplianceMessage(payload));
}

function getBuilderBondState(launch, stats) {
const builderBondSol = safeNum(
stats?.builderBondSol,
safeNum(stats?.launchBondSol, safeNum(launch?.builder_bond_sol, safeNum(launch?.launch_bond_sol, 0)))
);
const builderBondRefunded =
safeNum(
stats?.builderBondRefunded,
safeNum(stats?.launchBondRefunded, safeNum(launch?.builder_bond_refunded, safeNum(launch?.launch_bond_refunded, 0)))
) === 1;
const builderBondPaid =
safeNum(
stats?.builderBondPaid,
safeNum(stats?.launchBondPaid, safeNum(launch?.builder_bond_paid, safeNum(launch?.launch_bond_paid, 0)))
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

function getDisplayPhaseStatus(launch, stats, lifecycle = currentLifecycle) {
return resolveCanonicalLaunchStatus(launch, stats, lifecycle);
}

function getLaunchStateMessage(launch, stats, lifecycle = null) {
const status = getDisplayPhaseStatus(launch, stats, lifecycle);
const bondState = getBuilderBondState(launch, stats);
const readiness = lifecycle?.graduationReadiness || null;
const bondLabel = getLaunchBondLabel();

if (status === "commit") {
return {
kind: "warn",
message: "Commit phase is open. Max commit is 1 SOL per wallet. Accept the Launcher terms before a transaction is prepared.",
};
}

if (status === "countdown") {
const ends = getCountdownEndsMs(launch, stats);
const timePart = Number.isFinite(ends) ? ` Countdown ends in ${fmtCountdown(ends - Date.now())}.` : "";
return {
kind: "warn",
message: `Launch is in countdown lock. Commits and refunds are closed.${timePart}`,
};
}

if (status === "building") {
return {
kind: "warn",
message: "Countdown reached zero. MSS is finalizing mint, Raydium liquidity routing, and live market state.",
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
message: `Launch is now live. Live liquidity routes to Raydium and commit/refund actions are closed.${readinessLine}`,
};
}

if (status === "graduated") {
return {
kind: "good",
message: "This launch has graduated. Trading remains external and lifecycle visibility stays attached to the launch.",
};
}

if (status === "failed_refunded") {
const bondLine = bondState.refunded && bondState.amount > 0
? ` ${bondLabel} of ${fmtSol(bondState.amount)} was refunded as well.`
: "";

return {
kind: "warn",
message: `This launch failed and all tracked commits were refunded. This launch is now closed.${bondLine}`,
};
}

if (status === "failed") {
const bondLine = bondState.paid && !bondState.refunded && bondState.amount > 0
? ` ${bondLabel} of ${fmtSol(bondState.amount)} is still awaiting failed-launch handling.`
: "";

return {
kind: "warn",
message: `This launch failed to meet requirements before commit expiry.${bondLine}`,
};
}

return { kind: "warn", message: `Launch status: ${badgeText(status)}` };
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
const isLiveLike = String(status || "") === "live" || String(status || "") === "graduated";

if (commitProgressSection) commitProgressSection.classList.toggle("hidden", isLiveLike);
if (recentCommitsSection) recentCommitsSection.classList.toggle("hidden", isLiveLike);
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
return [...$all('[data-role="wallet-pill"]'), ...($("walletPillMirror") ? [$("walletPillMirror")] : [])].filter(Boolean);
}

function getWalletHints() {
return [...$all('[data-role="wallet-hint"]'), ...($("walletHint") ? [$("walletHint")] : [])].filter(Boolean);
}

function getWalletInputs() {
return [...$all('[data-role="wallet-input"]'), ...($("commitWallet") ? [$("commitWallet")] : [])].filter(Boolean);
}

function renderRecent(items) {
const list = $("recentList");
if (!list) return;

if (!Array.isArray(items) || !items.length) {
list.innerHTML = '<div class="recent-item"><div class="recent-meta">No commits yet.</div></div>';
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

if (!Number.isFinite(commitStartedAt) || !Number.isFinite(countdownStartedAt)) return null;
if (countdownStartedAt <= commitStartedAt) return null;
return countdownStartedAt - commitStartedAt;
}

function renderBuilderInfo(launch) {
const alias = choosePreferredString(launch.builder_alias, launch.builder_name, "MSS Builder");
const wallet = choosePreferredString(launch.builder_wallet, launch.builder, "");
const trustScore = safeNum(launch.builder_trust_score, safeNum(launch.builder_score, safeNum(launch.trust_score, 0)));
const trust = getBuilderTrust(trustScore);

setHiddenByIds(["builderInfoSection", "builderCard", "builderProfileWrap"], false);
setTextByIds(["launchBuilderAliasText"], alias);
setTextByIds(["launchBuilderIntelSub"], trust.note);
setTextByIds(["launchBuilderTrustPill"], trust.label);
setTextByIds(["launchBuilderScoreText"], trustScore > 0 ? String(Math.round(trustScore)) : "—");

const badgeCount = pickFiniteNumber(launch.builder_badges_count, launch.builder_badge_count, launch.badge_count, launch.badges_unlocked);
const liveLaunchCount = pickFiniteNumber(launch.builder_live_launches, launch.live_launches_count, launch.builder_live_count);
const totalLaunchCount = pickFiniteNumber(launch.builder_total_launches, launch.total_launches_count, launch.builder_launch_count);

setTextByIds(["launchBuilderBadgesText"], badgeCount != null ? String(Math.round(badgeCount)) : "—");
setTextByIds(["launchBuilderLiveCountText"], liveLaunchCount != null ? String(Math.round(liveLaunchCount)) : "—");
setTextByIds(["launchBuilderLaunchCountText"], totalLaunchCount != null ? String(Math.round(totalLaunchCount)) : "—");

const builderProfileHref = wallet ? `./builder.html?wallet=${encodeURIComponent(wallet)}` : "./builder.html";
setHrefByIds(["launchBuilderProfileBtn2"], builderProfileHref);

const builderCopyBtn = $("launchBuilderCopyWalletBtn");
if (builderCopyBtn) {
builderCopyBtn.classList.toggle("hidden", !wallet);
builderCopyBtn.disabled = !wallet;
}
}

function renderCommandSurfaceMeta(launch, stats = currentCommitStats, lifecycle = currentLifecycle) {
const status = getDisplayPhaseStatus(launch, stats, lifecycle);
const bondState = getBuilderBondState(launch, stats);
const feePct = safeNum(stats?.launchFeePct, safeNum(launch?.launch_fee_pct, 5));
const totalFeeSol = safeNum(stats?.feeTotal, safeNum(launch?.fee_total_sol, 0));
const coreFeeSol = safeNum(stats?.coreFee ?? stats?.founderFee, safeNum(launch?.core_fee_sol ?? launch?.founder_fee_sol, 0));
const ecosystemSupportFeeSol = safeNum(
stats?.ecosystemSupportFee ?? stats?.ecosystemFee ?? stats?.buybackFee,
safeNum(launch?.ecosystem_support_fee_sol ?? launch?.buyback_fee_sol, 0)
);
const reserveHeldSol = safeNum(stats?.protocolReserveHeldSol, safeNum(launch?.protocol_reserve_held_sol, 0));
const netRaiseAfterFee = safeNum(stats?.netRaiseAfterFee ?? stats?.netRaise, safeNum(launch?.net_raise_after_fee_sol ?? launch?.net_raise_sol, 0));
const liveLiquidityFunding = safeNum(
stats?.raydiumLiquidityFundingSol ?? stats?.liveLiquidityFundingSol ?? lifecycle?.raydiumSolMigrated,
safeNum(launch?.raydium_liquidity_sol ?? launch?.liquidity, 0)
);
const liveLiquidityTargetPct = resolveLiveLiquidityTargetPct(lifecycle, currentGraduationPlan);
const reserveHeldPct = resolveProtocolReserveHeldPct(lifecycle, currentGraduationPlan);

setTextByIds(["launchStatusBoardStatus"], phaseDisplayText(status));
setTextByIds(["launchFeePctStat"], fmtPct(feePct, 0));
setTextByIds(["totalFeeSolStat"], totalFeeSol > 0 ? fmtSol(totalFeeSol, 4) : "—");
setTextByIds(["founderFeeSolStat"], coreFeeSol > 0 ? fmtSol(coreFeeSol, 4) : "—");
setTextByIds(["buybackFeeSolStat"], ecosystemSupportFeeSol > 0 ? fmtSol(ecosystemSupportFeeSol, 4) : "—");
setTextByIds(["treasuryFeeSolStat"], reserveHeldSol > 0 ? fmtSol(reserveHeldSol, 4) : `${fmtPct(reserveHeldPct, 0)} held`);
setTextByIds(["netRaiseAfterFeeStat"], netRaiseAfterFee > 0 ? fmtSol(netRaiseAfterFee, 4) : "—");
setTextByIds(["liquidityFundingStat"], liveLiquidityFunding > 0 ? fmtSol(liveLiquidityFunding, 4) : `${fmtPct(liveLiquidityTargetPct, 0)} Raydium`);

const bondText = bondState.amount > 0
? bondState.refunded
? `${fmtSol(bondState.amount)} refunded`
: bondState.paid
? `${fmtSol(bondState.amount)} collected`
: `${fmtSol(bondState.amount)} pending`
: "No bond";

setTextByIds(["builderBondStat"], bondText);
}

function formatAllocationStatText(value, fallbackText = "—") {
const numeric = Number(value);
return Number.isFinite(numeric) && numeric > 0 ? fmtPct(numeric) : fallbackText;
}

function renderAllocationStructure(launch, stats) {
const isBuilderLaunch = String(launch.template || "").toLowerCase() === "builder";
const participantPct = pickFiniteNumber(
stats?.participantAllocationPct,
launch.participant_allocation_pct,
launch.participants_allocation_pct,
launch.participants_pct
);
const liquidityPct = pickFiniteNumber(
stats?.liquidityAllocationPct,
launch.liquidity_allocation_pct,
launch.liquidity_pct
);
const builderPct = isBuilderLaunch
? pickFiniteNumber(stats?.builderAllocationPct, launch.builder_allocation_pct, launch.builder_pct, 5)
: null;
const protocolReserveHeldPct = resolveProtocolReserveHeldPct(currentLifecycle, currentGraduationPlan);

const participantText = Number.isFinite(participantPct) ? fmtPct(participantPct) : "LP Based";
const liquidityText = Number.isFinite(liquidityPct) ? fmtPct(liquidityPct) : "LP Based";
const reserveText = `${fmtPct(protocolReserveHeldPct, 0)} held`;
const builderText = isBuilderLaunch ? formatAllocationStatText(builderPct, "5%") : "—";

setTextByIds(["participantAllocationPctStat"], participantText);
setTextByIds(["liquidityAllocationPctStat"], liquidityText);
setTextByIds(["reserveAllocationPctStat"], reserveText);
setTextByIds(["builderAllocationPctStat"], builderText);
setHiddenByIds(["builderAllocationStatWrap"], !isBuilderLaunch);
setTextByIds(["launchOverviewTemplateText"], humanizeTemplate(launch.template));

const raiseStructureParts = [
"Participants priced from final raise",
`${fmtPct(resolveLiveLiquidityTargetPct(currentLifecycle, currentGraduationPlan), 0)} live liquidity routed to Raydium`,
protocolReserveHeldPct > 0 ? `${reserveText} protocol reserve` : "No protocol reserve held",
];

if (hasFormerReserveBurned(currentLifecycle, currentGraduationPlan)) {
raiseStructureParts.push("Former reserve burned");
}

if (hasUnusedParticipantAllocationBurned(currentLifecycle, currentGraduationPlan)) {
raiseStructureParts.push("Unused participant allocation burned");
}

setTextByIds(["launchRaiseStructureText"], raiseStructureParts.join(" • "));

const bondState = getBuilderBondState(launch, stats);
const teamAllocationPct = safeNum(stats?.teamAllocationPct, safeNum(launch?.team_allocation_pct, 0));
const parts = [];

if (isBuilderLaunch) {
parts.push(builderText !== "—" ? `${builderText} Builder` : "Builder Launch");
if (teamAllocationPct > 0) parts.push(`${fmtPct(teamAllocationPct)} Team`);
} else {
parts.push("Public Launch");
}

if (bondState.amount > 0) {
if (bondState.refunded) parts.push(`${getLaunchBondLabel()} ${fmtSol(bondState.amount)} Refunded`);
else if (bondState.paid) parts.push(`${getLaunchBondLabel()} ${fmtSol(bondState.amount)} Collected`);
else parts.push(`${getLaunchBondLabel()} ${fmtSol(bondState.amount)} Pending`);
}

if (usesDistributorLpFeeControl(currentLifecycle)) {
parts.push("Builder LP fees via MSS distributor");
}

setTextByIds(["launchBuilderControlsText"], parts.join(" • "));
}

function renderTeamWalletBreakdown(launch, stats) {
const wrap = $("builderExtraBlock");
const teamAllocationPctStat = $("teamAllocationPctStat");
const builderBondStat = $("builderBondStat");
const teamWalletBreakdownList = $("teamWalletBreakdownList");

if (!wrap || !teamAllocationPctStat || !builderBondStat || !teamWalletBreakdownList) return;

const isBuilder = String(launch.template || "") === "builder";
const bondState = getBuilderBondState(launch, stats);

if (!isBuilder && bondState.amount <= 0) {
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

if (!isBuilder) {
teamWalletBreakdownList.innerHTML = '<div class="recent-item"><div class="recent-meta">No visible team wallet breakdown for this template.</div></div>';
return;
}

if (!breakdown.length) {
teamWalletBreakdownList.innerHTML = '<div class="recent-item"><div class="recent-meta">No team wallet breakdown set.</div></div>';
return;
}

teamWalletBreakdownList.innerHTML = breakdown
.map((row, index) => {
const wallet = escapeHtml(row.wallet || `Team Wallet ${index + 1}`);
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
const status = getDisplayPhaseStatus(launch, currentCommitStats, lifecycle);

if (isLiveLikeStatus(status)) {
const raydiumPoolId = cleanString(lifecycle.raydiumPoolId, 300);
const raydiumLiquiditySol = safeNum(lifecycle.raydiumSolMigrated, safeNum(lifecycle.internalSolReserve, 0));
const builderLpFeeRightsPct = resolveBuilderLpFeeRightsPct(lifecycle);

if (raydiumPoolId) parts.push(`Raydium pool: ${shortenWallet(raydiumPoolId)}`);
if (raydiumLiquiditySol > 0) parts.push(`Raydium liquidity: ${fmtSol(raydiumLiquiditySol, 4)}`);
if (usesDistributorLpFeeControl(lifecycle)) parts.push(`Builder LP fees: ${fmtPct(builderLpFeeRightsPct, 0)} via MSS distributor`);
if (hasFormerReserveBurned(lifecycle, currentGraduationPlan)) parts.push("Former reserve burned");
if (hasUnusedParticipantAllocationBurned(lifecycle, currentGraduationPlan)) parts.push("Unused participant allocation burned");
if (safeNum(lifecycle?.builderVesting?.lockedAmount, 0) > 0) {
parts.push(`Builder locked: ${fmtTokenAmount(lifecycle.builderVesting.lockedAmount, 0)} tokens`);
}
if (lifecycle.graduationReadiness?.ready) parts.push("Graduation-ready");
}

return parts.join(" • ");
}

function renderOverviewPanels(launch, stats, lifecycle) {
const status = getDisplayPhaseStatus(launch, stats, lifecycle);
const builderAlias = choosePreferredString(launch.builder_alias, launch.builder_name, "MSS Builder");
const totalCommitted = safeNum(stats?.totalCommitted, safeNum(launch?.committed_sol, 0));
const hardCap = safeNum(stats?.hardCap, safeNum(launch?.hard_cap_sol, 0));
const minRaise = safeNum(stats?.minRaise, safeNum(launch?.min_raise_sol, 0));
const templateText = humanizeTemplate(launch.template);
const tokenName = getLaunchDisplayName(launch);
const lifecycleSummary = buildLifecycleSummaryText(lifecycle, launch);
const walletState = getConnectedWallet();

setTextByIds(["launchWalletAccessText"], walletState.isConnected ? walletState.shortPublicKey : "Not Connected");
setTextByIds(["launchOverviewTemplateText"], templateText);
setTextByIds(
["launchLifecycleSummaryText"],
status === "commit"
? "Commit → Countdown → Building → Live"
: status === "countdown"
? "Countdown Locked"
: status === "building"
? "Bootstrapping"
: status === "live"
? "Live Market"
: status === "graduated"
? "Graduated"
: status === "failed_refunded"
? "Closed & Refunded"
: "Failed"
);

let overviewCopy = `${tokenName} is running through MSS ${templateText.toLowerCase()} infrastructure with public builder identity linked to ${builderAlias}.`;

if (status === "commit") {
overviewCopy += ` ${fmtSol(Math.max(0, minRaise - totalCommitted))} remains to minimum raise and ${fmtSol(Math.max(0, hardCap - totalCommitted))} remains to hard cap.`;
} else if (status === "countdown") {
overviewCopy += " Commit phase is closed and countdown lock is controlling the transition into market activation.";
} else if (status === "building") {
overviewCopy += " MSS is finalizing mint assignment, Raydium route state and live market activation.";
} else if (status === "live" || status === "graduated") {
overviewCopy += " Live market state is active through Raydium, former reserve is not held on-platform and lifecycle visibility remains attached to this terminal.";
} else if (status === "failed_refunded") {
overviewCopy += " The launch failed and tracked commitments have already been refunded.";
} else if (status === "failed") {
overviewCopy += " The launch failed to satisfy launch requirements and refund handling remains the primary action path.";
}

setTextByIds(["launchOverviewCopy"], overviewCopy);
setTextByIds(["launchSubline"], `${getDisplaySymbol(launch.symbol)} • ${templateText} • ${phaseDisplayText(status)}${lifecycleSummary ? ` • ${lifecycleSummary}` : ""}`);

if ($("launchDesc")) $("launchDesc").textContent = launch.description || "No description provided.";

const builderWallet = choosePreferredString(launch.builder_wallet, lifecycle?.builderWallet, lifecycle?.builder_wallet);
setHrefByIds(["launchBuilderProfileBtn"], builderWallet ? `./builder.html?wallet=${encodeURIComponent(builderWallet)}` : "./builder.html");
}

function renderProgressCard(launch, committed, hardCap, minRaise, participants, pct, commitEndsAt, stats) {
const status = getDisplayPhaseStatus(launch, stats, currentLifecycle);
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

if (status === "countdown" || status === "building") {
primaryCountdownLabel = status === "countdown" ? "Countdown ends in" : "Finalizing";
primaryCountdownValue = status === "countdown" && Number.isFinite(countdownEndsAt)
? fmtCountdown(countdownEndsAt - now)
: "In progress";
}

if (status === "live" || status === "graduated") {
primaryCountdownLabel = status === "graduated" ? "Launch state" : "Went live";
primaryCountdownValue = status === "graduated" ? "Graduated" : launch.live_at || stats.liveAt || "Live";
}

if (status === "failed" || status === "failed_refunded") {
primaryCountdownLabel = "Launch state";
primaryCountdownValue = badgeText(status);
}

setTextByIds(["totalCommittedStat", "committedStat", "currentCommittedStat"], fmtSol(committed));
setTextByIds(["progressPercentStat", "fillPctStat", "commitFillStat"], `${pct}%`);
setTextByIds(["remainingToMinRaiseStat", "remainingToMinStat"], minMet ? "Reached" : fmtSol(remainingToMin));
setTextByIds(["remainingToHardCapStat", "remainingToCapStat"], hardCapMet ? "Filled" : fmtSol(remainingToHardCap));
setTextByIds(["participantsCountStat", "participantsTotalStat"], String(participants));
setTextByIds(["progressCountdownLabel", "phaseTimerLabel"], primaryCountdownLabel);
setTextByIds(["progressCountdownValue", "phaseTimerValue", "countdownValue"], primaryCountdownValue);
setWidthByIds(["launchProgressFill", "commitProgressFill", "heroProgressFill"], `${pct}%`);

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
phaseMetaLabel.textContent = status === "countdown" || status === "building" ? "Commit window" : "Fill duration";
phaseMetaValue.textContent = status === "countdown" || status === "building"
? Number.isFinite(commitStartedAt) && Number.isFinite(commitEndsAt)
? fmtDuration(commitEndsAt - commitStartedAt)
: "—"
: fmtDuration(fillDurationMs);
} else {
phaseMetaLabel.textContent = "Commit window";
phaseMetaValue.textContent = Number.isFinite(commitStartedAt) && Number.isFinite(commitEndsAt)
? fmtDuration(commitEndsAt - commitStartedAt)
: "—";
}
}
}

function renderPhase(launch, committed, minRaise, hardCap, commitEndsAt, stats, lifecycle) {
const status = getDisplayPhaseStatus(launch, stats, lifecycle);
const countdownEndsAt = getCountdownEndsMs(launch, stats);
const caVisible = shouldExposePublicCa(status);

setTextByIds(["launchStatusBadge", "launchStatusPill", "phaseBadge"], phaseDisplayText(status));
["launchStatusBadge", "launchStatusPill", "phaseBadge", "phasePillMirror"].forEach((id) => setStatusPillClasses($(id), status));

const phaseHeadline =
status === "commit"
? "Commit window is open"
: status === "countdown"
? "Launch has entered countdown lock"
: status === "building"
? "MSS is finalizing launch infrastructure"
: status === "live"
? "Launch is now live"
: status === "graduated"
? "Launch has graduated"
: status === "failed_refunded"
? "Launch closed and refunded"
: "Launch did not reach threshold";

let phaseSummary = "";

if (status === "commit") {
const minLeft = Math.max(0, safeNum(minRaise, 0) - safeNum(committed, 0));
phaseSummary = minLeft > 0
? `${fmtSol(minLeft)} remains to reach minimum raise.`
: `Minimum raise reached. ${fmtSol(Math.max(0, safeNum(hardCap, 0) - safeNum(committed, 0)))} remains to hard cap.`;
} else if (status === "countdown") {
phaseSummary = Number.isFinite(countdownEndsAt)
? `Countdown lock ends in ${fmtCountdown(countdownEndsAt - Date.now())}.`
: "Countdown lock is active.";
} else if (status === "building") {
phaseSummary = "Mint reservation, Raydium liquidity routing and live market activation are in progress.";
} else if (status === "live") {
phaseSummary = lifecycle?.graduationReadiness?.ready
? "Graduation threshold is currently satisfied."
: lifecycle?.graduationReadiness?.reason || "Live market is active through Raydium.";
} else if (status === "graduated") {
phaseSummary = lifecycle?.graduationStatus || "Launch completed graduation flow.";
} else if (status === "failed_refunded") {
phaseSummary = "All tracked commitments have been refunded and the launch is closed.";
} else if (status === "failed") {
phaseSummary = "Commit refunds remain available for eligible wallets.";
}

setTextByIds(["phaseHeadline"], phaseHeadline);
setTextByIds(["phaseSummary"], phaseSummary);
setTextByIds(["commitEndsAtStat"], Number.isFinite(commitEndsAt) ? new Date(commitEndsAt).toLocaleString() : "—");
setTextByIds(["countdownEndsAtStat"], Number.isFinite(countdownEndsAt) ? new Date(countdownEndsAt).toLocaleString() : "—");

setLaunchPhaseBadgeClass($("launchPhaseBadge"), status);
setHiddenByIds(["contractAddressRow"], !caVisible);
setTextByIds(["phasePillMirror"], phaseDisplayText(status));
}

let currentLaunch = null;
let currentCommitStats = null;
let currentLifecycle = null;
let currentGraduationPlan = null;
let currentParticipantCompliance = { wallet: "", payload: null };
let refreshIntervalId = null;
let renderIntervalId = null;
let lifecycleRefreshIntervalId = null;
let loadRequestSeq = 0;
let commitActionInFlight = false;
let refundActionInFlight = false;
let walletActionInFlight = false;
let refreshInFlight = false;
let lifecycleRefreshInFlight = false;
let participantComplianceRefreshInFlight = false;
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
const error = new Error(data?.error || `HTTP ${res.status}`);
error.data = data;
error.status = res.status;
error.code = data?.code || "";
throw error;
}

return data;
}

async function defaultSaveLinksWithWallet(launchId, payload) {
const wallet = getConnectedPublicKey() || "";
if (!wallet) throw new Error("Connect wallet first");

return fetchJson(`/api/launcher/${encodeURIComponent(launchId)}/links`, {
method: "PATCH",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ ...payload, wallet }),
});
}

async function loadLaunch() {
const id = qs("id");
if (!id) throw new Error("Missing launch id in URL.");

const requestSeq = ++loadRequestSeq;
const [launchRes, commitsRes, reconcileRes] = await Promise.all([
fetchJson(`/api/launcher/${id}`),
fetchJson(`/api/launcher/commits/${id}`),
fetchJson(`/api/launcher/${id}/reconcile`, { method: "POST" }).catch(() => null),
]);

if (requestSeq !== loadRequestSeq) return;

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

const baseLaunchRaw = normalizeLaunchData(launchRes?.launch || {});
const reconcileLaunchRaw = normalizeLaunchData(reconcileRes?.launch || {});
const strongestLaunch = mergeLaunchTruth(baseLaunchRaw, reconcileLaunchRaw, currentCommitStats || {}, currentLifecycle);
currentLaunch = mergeLaunchTruth(currentLaunch || {}, strongestLaunch, currentCommitStats || {}, currentLifecycle);
currentLifecycle = mergeLifecycleTruth(
currentLifecycle,
launchRes?.lifecycle || commitsRes?.lifecycle || reconcileRes?.lifecycle || null
);
currentLaunch = mergeLaunchTruth(currentLaunch || {}, currentLaunch || {}, currentCommitStats || {}, currentLifecycle);
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
if (!id || !currentLaunch || lifecycleRefreshInFlight) return;

const status = getDisplayPhaseStatus(currentLaunch, currentCommitStats, currentLifecycle);
if (!["countdown", "building", "live", "graduated"].includes(status)) return;
if (!force && status !== "live" && status !== "graduated") return;

lifecycleRefreshInFlight = true;

try {
const lifecycleRes = await fetchJson(`/api/launcher/${id}/lifecycle`).catch(() => null);
if (!lifecycleRes) return;

currentLifecycle = mergeLifecycleTruth(currentLifecycle, lifecycleRes.lifecycle || null);
currentGraduationPlan = lifecycleRes.graduationPlan || lifecycleRes.graduation_plan || currentGraduationPlan || null;
currentLaunch = mergeLaunchTruth(
currentLaunch || {},
{
status: currentLifecycle?.launchStatus || currentLaunch?.status || "",
contract_address: currentLifecycle?.contractAddress || currentLifecycle?.contract_address || currentLaunch?.contract_address || "",
market_bootstrapped:
currentLifecycle?.marketBootstrapped ?? currentLifecycle?.market_bootstrapped ?? currentLaunch?.market_bootstrapped ?? null,
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
if (now - lastForcedFinalizeAt < FORCE_FINALIZE_COOLDOWN_MS) return;

countdownFinalizeInFlight = true;
lastForcedFinalizeAt = now;

try {
try {
await fetchJson(`/api/launcher/${id}/finalize`, { method: "POST" });
} catch (err) {
console.warn("launch.js finalize attempt did not complete:", err?.message || err);
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
const quickButtons = Array.from(document.querySelectorAll(".quick button[data-amount]"));
const acknowledgementPanel = $("participantAcknowledgementPanel");
const stateInfo = getLaunchStateMessage(launch, stats, lifecycle);
const status = getDisplayPhaseStatus(launch, stats, lifecycle);
const refundOpen = canRefundForStatus(status);
const participantBlocked = status === "commit" && isParticipantInterventionBlocked();
const commitOpen = canCommitForStatus(status) && !participantBlocked;
const refundOnly = status === "failed";
const shouldShowForm = commitOpen || refundOpen || participantBlocked;

if (commitForm) commitForm.style.display = shouldShowForm ? "" : "none";
if (walletField) walletField.style.display = shouldShowForm ? "" : "none";
if (amountField) amountField.style.display = commitOpen ? "" : "none";
if (quickWrap) quickWrap.style.display = commitOpen ? "" : "none";
if (actionStack) actionStack.style.display = shouldShowForm ? "" : "none";
if (acknowledgementPanel) acknowledgementPanel.style.display = commitOpen ? "" : "none";

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
amountInput.setAttribute("placeholder", commitOpen ? "0.50" : participantBlocked ? "Access blocked" : badgeText(status));
}

quickButtons.forEach((button) => {
button.disabled = !commitOpen || commitActionInFlight;
});

if (participantBlocked) {
setStatus(getParticipantComplianceMessage(), "bad", { auto: true, preserveManual: true });
return;
}

if (refundOnly) {
setStatus("Launch failed. Refund remains available for wallets with tracked commit balance.", "warn", {
auto: true,
preserveManual: true,
});
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
if (!id || !$("marketCard")) return;

const connectedWallet = getConnectedPublicKey() || "";
const participantCompliance = getCurrentParticipantCompliancePayload();

if (!launchMarketController) {
launchMarketController = await initLaunchMarket({
launchId: Number(id),
connectedWallet,
launch: currentLaunch || null,
commitStats: currentCommitStats || {},
lifecycle: currentLifecycle || null,
graduationPlan: currentGraduationPlan || null,
participantCompliance,
saveLinks: defaultSaveLinksWithWallet,
});

launchMarketController.participantCompliance = participantCompliance;
launchMarketController.graduationPlan = currentGraduationPlan || null;

if (typeof launchMarketController.setComplianceState === "function") {
launchMarketController.setComplianceState(participantCompliance);
}

if (mode === "hard" && typeof launchMarketController.refreshLaunch === "function") {
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
launchMarketController.participantCompliance = participantCompliance;
launchMarketController.graduationPlan = currentGraduationPlan || launchMarketController.graduationPlan || null;

if (typeof launchMarketController.setComplianceState === "function") {
launchMarketController.setComplianceState(participantCompliance);
}

const controllerPhaseBefore = launchMarketController.phase || "";
const localPhaseNow = getDisplayPhaseStatus(currentLaunch, currentCommitStats, currentLifecycle);

if (typeof launchMarketController.setBaseState === "function") {
launchMarketController.setBaseState(currentLaunch || null, currentCommitStats || {}, {
lifecycle: currentLifecycle || null,
participantCompliance,
restartPolling: mode === "hard" || walletChanged || controllerPhaseBefore !== localPhaseNow,
});
} else {
launchMarketController.launch = mergeLaunchTruth(
launchMarketController.launch || {},
currentLaunch || {},
currentCommitStats || {},
currentLifecycle
);
launchMarketController.commitStats = currentCommitStats || {};
launchMarketController.lifecycle = currentLifecycle || null;

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

updateLifecycleVisibility(displayStatus);
renderBuilderInfo(launch);
renderCommandSurfaceMeta(launch, stats, lifecycle);
renderAllocationStructure(launch, stats);
renderTeamWalletBreakdown(launch, stats);
renderProgressCard(launch, committed, hardCap, minRaise, participants, pct, commitEndsAt, stats);
renderOverviewPanels(launch, stats, lifecycle);
renderPhase(launch, committed, minRaise, hardCap, commitEndsAt, stats, lifecycle);
renderRecent(stats.recent || []);
renderParticipantComplianceUi();
updateWalletUi();
renderActionPanelState(launch, stats, lifecycle);

if (displayStatus === "failed_refunded") {
setClosureNote(
bondState.refunded
? `This launch failed, all tracked commitments were refunded, the ${getLaunchBondLabel().toLowerCase()} of ${fmtSol(bondState.amount)} was refunded, and the launch is now closed.`
: bondState.paid
? `This launch failed, all tracked commitments were refunded, and the launch is now closed. A collected ${getLaunchBondLabel().toLowerCase()} of ${fmtSol(bondState.amount)} is not marked refunded.`
: "This launch failed, all tracked commitments were refunded, and the launch is now closed.",
"warn"
);
} else if (displayStatus === "failed") {
if (bondState.paid && !bondState.refunded) {
setClosureNote(
`This launch failed. Commit refunds are available and the collected ${getLaunchBondLabel().toLowerCase()} of ${fmtSol(bondState.amount)} should be handled by the failed-launch refund flow.`,
"warn"
);
} else {
setClosureNote("This launch failed. Eligible tracked commits can be refunded.", "warn");
}
} else if (displayStatus === "building") {
setClosureNote(
"Countdown has completed and MSS is now finalizing mint assignment, Raydium liquidity routing and live market activation.",
"warn"
);
} else if (displayStatus === "live") {
const liveLiquidityPct = resolveLiveLiquidityTargetPct(lifecycle, currentGraduationPlan);
const reserveHeldPct = resolveProtocolReserveHeldPct(lifecycle, currentGraduationPlan);
const builderLpFeeRightsPct = resolveBuilderLpFeeRightsPct(lifecycle);
const mssLpFeeRightsPct = resolveMssLpFeeRightsPct(lifecycle);
const readinessNote = lifecycle?.graduationReadiness?.ready
? " Graduation threshold is currently satisfied."
: lifecycle?.graduationReadiness?.reason
? ` ${lifecycle.graduationReadiness.reason}`
: "";

setClosureNote(
`Launch is live. ${fmtPct(liveLiquidityPct, 0)} of live liquidity routes to Raydium, ${fmtPct(reserveHeldPct, 0)} of protocol reserve is held, former reserve is burned, and LP-fee rights are ${fmtPct(builderLpFeeRightsPct, 0)} builder / ${fmtPct(mssLpFeeRightsPct, 0)} MSS with builder rights routed through MSS distributor control.${readinessNote}`,
"good"
);
} else if (displayStatus === "graduated") {
setClosureNote(
"Launch has graduated. External venue remains Raydium, former reserve remains burned, and builder LP-fee rights continue through MSS distributor control.",
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
market_bootstrapped:
currentLifecycle?.marketBootstrapped ?? currentLifecycle?.market_bootstrapped ?? currentLaunch?.market_bootstrapped ?? null,
},
currentCommitStats || {},
currentLifecycle
);
}

render();
if (marketSyncMode !== "none") await syncLaunchMarketController(marketSyncMode);
} finally {
refreshInFlight = false;
}
}

async function refreshStateBeforeAction() {
await refresh({ marketSyncMode: "hard", syncLifecycle: true });
return { launch: currentLaunch, stats: currentCommitStats };
}

async function connectWallet() {
if (walletActionInFlight) return;

walletActionInFlight = true;
updateWalletUi();

try {
const wallet = await connectAnyWallet();
updateWalletUi();

if (wallet?.isConnected) {
try {
await refreshParticipantComplianceStatus({ silent: true });
} catch (err) {
console.error(err);
}

const payload = getCurrentParticipantCompliancePayload();
setStatus(
payload?.blocked ? getParticipantComplianceMessage(payload) : `Wallet connected: ${shortenWallet(wallet.publicKey)}`,
payload?.blocked ? "bad" : "good"
);

await syncLaunchMarketController("hard");
return;
}

setStatus("Wallet connection cancelled.", "warn");
} catch (err) {
const message = err?.message || "Wallet connection failed.";
setStatus(message.includes("No supported wallet") ? getMobileWalletHelpText() : message, "bad");
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
// Ignore wallet adapter disconnect failures.
} finally {
walletActionInFlight = false;
currentParticipantCompliance = { wallet: "", payload: null };
renderParticipantComplianceUi(null);
updateWalletUi();
if (currentLaunch && currentCommitStats) render();
await syncLaunchMarketController("hard");
}

setStatus("Wallet disconnected.", "warn");
}

function getInjectedWalletProvider() {
const walletState = getConnectedWallet?.() || {};
const candidates = [
walletState?.provider,
walletState?.wallet,
walletState?.adapter,
window.getPhantomProvider?.(),
window.phantom?.solana,
window.backpack?.solana,
window.solflare,
window.solana,
];

return candidates.find((provider) => provider && typeof provider.signTransaction === "function") || null;
}

async function signPreparedCommitTransaction(transactionBase64) {
const provider = getInjectedWalletProvider();

if (!provider?.signTransaction) {
throw new Error("Commit transaction signing is not available for this wallet session.");
}

if (!window.solanaWeb3?.Transaction?.from) {
throw new Error("solanaWeb3 is not available on this page.");
}

const txBytes = Uint8Array.from(atob(transactionBase64), (character) => character.charCodeAt(0));
const transaction = window.solanaWeb3.Transaction.from(txBytes);
const signedTransaction = await provider.signTransaction(transaction);

return btoa(String.fromCharCode(...signedTransaction.serialize()));
}

function isPostTransferRefundResponse(error) {
const data = error?.data || {};
return Boolean(
Number(error?.status) === 409 &&
(data.refundQueued ||
data.refundStatus ||
data.refundTxSignature ||
Object.prototype.hasOwnProperty.call(data, "refundedSol") ||
data.refundError)
);
}

function buildRejectedCommitRefundMessage(error) {
const data = error?.data || {};
const lines = [error?.message || "Commit could not be accepted after transaction submission."];

if (data.status) lines.push(`Launch status: ${data.status}`);

if (data.refundQueued) {
lines.push(`Refund queued: ${data.refundStatus || "pending"}`);
if (data.refundProgramReference) lines.push(`Refund reference: ${data.refundProgramReference}`);
} else if (safeNum(data.refundedSol, 0) > 0 || data.refundTxSignature) {
lines.push(`Refunded: ${safeNum(data.refundedSol, 0)} SOL`);
if (data.refundTxSignature) lines.push(`Refund transaction: ${data.refundTxSignature}`);
} else if (data.refundError) {
lines.push(`Automatic refund could not be confirmed: ${data.refundError}`);
lines.push("Contact support before retrying.");
}

if (data.txSignature) lines.push(`Original transaction: ${data.txSignature}`);
return lines.join("\n");
}

async function onCommitSubmit(event) {
event.preventDefault();
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

if (lastCommitIntentKey === intentKey && now - lastCommitIntentAt < COMMIT_DEDUP_WINDOW_MS) return;
lastCommitIntentKey = intentKey;
lastCommitIntentAt = now;

commitActionInFlight = true;
render();

try {
const latest = await refreshStateBeforeAction();
const launch = latest.launch;
const stats = latest.stats;

if (!launch) throw new Error("Launch not found.");

if (!canCommitForStatus(getDisplayPhaseStatus(launch, stats, currentLifecycle))) {
const stateInfo = getLaunchStateMessage(launch, stats, currentLifecycle);
setStatus(stateInfo.message, stateInfo.kind);
return;
}

await requireParticipantTransactionAccess(wallet);
const acknowledgements = validateParticipantAcknowledgements();

setStatus("Preparing secure commit request…", "warn");

const prepare = await fetchJson("/api/launcher/prepare-commit", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({
launchId: Number(id),
wallet,
solAmount,
role: PARTICIPANT_ROLE,
acknowledgements,
}),
});

const preparedTransaction = prepare.transaction || prepare.serializedTransaction || prepare.tx || "";
if (!preparedTransaction) {
throw new Error("Prepared commit transaction was not returned by the server.");
}

setStatus("Awaiting wallet approval…", "warn");
const signedTransaction = await signPreparedCommitTransaction(preparedTransaction);

setStatus("Submitting and verifying on-chain commit…", "warn");
const data = await fetchJson("/api/launcher/confirm-commit", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({
launchId: Number(id),
wallet,
solAmount,
signedTransaction,
role: PARTICIPANT_ROLE,
acknowledgements,
}),
});

const countdownLine = data.status === "countdown" && data.countdownEndsAt
? `\nCountdown ends at: ${data.countdownEndsAt}`
: "";

setStatus(
`Commit successful.\n\nWallet total: ${data.walletCommittedTotal} SOL\nTotal committed: ${data.totalCommitted} SOL\nParticipants: ${data.participants}\nTransaction: ${data.txSignature || "Confirmed"}${countdownLine}`,
"good"
);

if ($("commitAmount")) $("commitAmount").value = "";

await refreshParticipantComplianceStatus({ silent: true }).catch(() => null);
await refresh({ marketSyncMode: "hard", syncLifecycle: true });
restartRefreshLoop();
restartLifecycleRefreshLoop();
} catch (err) {
console.error(err);

if (isPostTransferRefundResponse(err)) {
setStatus(buildRejectedCommitRefundMessage(err), err?.data?.refundError ? "bad" : "warn");
} else {
setStatus(err?.message || "Commit failed.", "bad");
}

try {
await refreshParticipantComplianceStatus({ silent: true });
await refresh({ marketSyncMode: "hard", syncLifecycle: true });
} catch (refreshErr) {
console.error(refreshErr);
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

if (!launch) throw new Error("Launch not found.");

if (!canRefundForStatus(getDisplayPhaseStatus(launch, stats, currentLifecycle))) {
const stateInfo = getLaunchStateMessage(launch, stats, currentLifecycle);
setStatus(stateInfo.message, stateInfo.kind);
return;
}

const data = await fetchJson("/api/launcher/refund", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ launchId: Number(id), wallet }),
});

if (data.refundQueued) {
setStatus(
`Refund queued.\n\nStatus: ${data.refundStatus || "pending"}${data.refundProgramReference ? `\nReference: ${data.refundProgramReference}` : ""}`,
"warn"
);
} else {
const bondLine = safeNum(data.builderBondRefunded, safeNum(data.launchBondRefunded, 0)) > 0
? `\n${getLaunchBondLabel()} refunded: ${safeNum(data.builderBondRefunded, safeNum(data.launchBondRefunded, 0))} SOL`
: "";

setStatus(
`Refund successful.\n\nRefunded: ${data.refundedSolActual || data.refundedSol} SOL${bondLine}\nTotal committed: ${data.totalCommitted} SOL\nParticipants: ${data.participants}\nTransaction: ${data.refundTxSignature || "Recorded"}`,
"good"
);
}

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
document.querySelectorAll(".quick button[data-amount]").forEach((button) => {
if (button.dataset.quickBound === "1") return;

button.dataset.quickBound = "1";
button.addEventListener("click", () => {
if (button.disabled || commitActionInFlight) return;
const amount = button.getAttribute("data-amount") || "";
if ($("commitAmount")) $("commitAmount").value = amount;
});
});
}

function bindWalletButtons() {
for (const button of getConnectButtons()) {
if (button.dataset.walletBound === "1") continue;
button.dataset.walletBound = "1";
button.addEventListener("click", connectWallet);
}

for (const button of getDisconnectButtons()) {
if (button.dataset.walletBound === "1") continue;
button.dataset.walletBound = "1";
button.addEventListener("click", disconnectWallet);
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

const participantComplianceAction = $("participantComplianceAction");

if (participantComplianceAction && participantComplianceAction.dataset.bound !== "1") {
participantComplianceAction.dataset.bound = "1";
participantComplianceAction.addEventListener("click", (event) => {
const wallet = getConnectedPublicKey() || "";
event.currentTarget.href = buildCompliancePageUrl(wallet, PARTICIPANT_ROLE);
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

try {
await refreshParticipantComplianceStatus({ silent: true });
} catch (err) {
console.error(err);
}

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
const shouldRunBaseLoop = ["commit", "countdown", "building"].includes(displayStatus) || !currentLaunch?.status;

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

function updateWalletUi() {
const walletState = getConnectedWallet();
const walletText = walletState.publicKey || "";
const walletPillText = walletState.isConnected ? `Connected: ${walletState.shortPublicKey}` : "No wallet connected";
const walletHintText = walletState.isConnected
? `Connected via ${String(walletState.walletName || "wallet").replace(/\b\w/g, (letter) => letter.toUpperCase())}.`
: "Use Connect Wallet to choose Phantom, Solflare, or Backpack.";

for (const input of getWalletInputs()) input.value = walletText;
for (const pill of getWalletPills()) pill.textContent = walletPillText;

for (const button of getConnectButtons()) {
button.style.display = walletState.isConnected ? "none" : "inline-flex";
button.disabled = walletActionInFlight;
}

for (const button of getDisconnectButtons()) {
button.style.display = walletState.isConnected ? "inline-flex" : "none";
button.disabled = walletActionInFlight;
}

for (const hint of getWalletHints()) hint.textContent = walletHintText;

for (const badge of $all('[data-role="wallet-badge"]')) {
badge.classList.remove("is-connected", "is-disconnected");
badge.classList.add(walletState.isConnected ? "is-connected" : "is-disconnected");

let dotEl = badge.querySelector(".terminal-wallet-badge-dot");
let labelEl = badge.querySelector(".terminal-wallet-badge-label");

if (!dotEl || !labelEl) {
badge.innerHTML = '<span class="terminal-wallet-badge-dot"></span><span class="terminal-wallet-badge-label"></span>';
dotEl = badge.querySelector(".terminal-wallet-badge-dot");
labelEl = badge.querySelector(".terminal-wallet-badge-label");
}

if (labelEl) labelEl.textContent = walletState.isConnected ? "Wallet Connected" : "Wallet Disconnected";
}

setTextByIds(["launchWalletAccessText"], walletState.isConnected ? walletState.shortPublicKey : "Not Connected");
}

async function init() {
if (window[LAUNCH_PAGE_INIT_KEY]) return;

window[LAUNCH_PAGE_INIT_KEY] = true;
window.API_BASE = getApiBase();

ensureParticipantAcknowledgementUi();
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
await refreshParticipantComplianceStatus({ silent: true });
} catch (err) {
console.error(err);
}

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

const status = getDisplayPhaseStatus(currentLaunch, currentCommitStats, currentLifecycle);

if (status === "countdown" || status === "building") {
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