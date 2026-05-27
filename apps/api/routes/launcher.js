import express from "express";
import {
Connection,
Keypair,
PublicKey,
SystemProgram,
Transaction,
TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";
import db from "../db/index.js";
import { buildLaunchAllocations } from "../services/launcher/allocationService.js";
import { verifyCommitTransfer } from "../services/launcher/commitVerifier.js";
import { finalizeLaunch } from "../services/launcher/finalizeLaunch.js";
import {
bootstrapLiveMarket,
claimReservedMintForLaunch,
topUpMintReservationPool,
} from "../services/launcher/mintLifecycle.js";
import {
getLiquidityLifecycle,
syncLiquidityLifecycle,
buildGraduationPlanForLaunch,
markLaunchGraduatedLifecycle,
} from "../services/launcher/liquidityLifecycle.js";

const router = express.Router();

const COMMIT_PHASE_MINUTES = 2;
const COUNTDOWN_MINUTES = 2;
const MAX_WALLET_COMMIT_SOL = 1;
const MAX_TEAM_WALLETS = 5;
const MAX_TEAM_ALLOCATION_PCT = 15;
const MIN_LAUNCH_BOND_SOL = 3;
const MAX_LAUNCH_BOND_SOL = 25;
const TEAM_PCT_PRECISION = 6;
const RECONCILE_INTERVAL_MS = 15000;
const REQUIRED_MINT_TAG = "MSS";
const RESERVED_MINT_MAX_ATTEMPTS = 1000000;
const LAUNCH_FEE_PCT = 5;
const REFUND_FEE_BUFFER_LAMPORTS = 10000;
const REFUND_WORKER_BATCH_SIZE = 10;

const LAUNCH_ACKNOWLEDGEMENT_TABLE = "launcher_acknowledgements";
const INTERNAL_COMPLIANCE_PROFILE_TABLE = "compliance_profiles";
const BUILDER_BOND_REFUND_TABLE = "builder_bond_refund_ledger";

const PARTICIPANT_ACKNOWLEDGEMENT_ROLE = "participant";
const BUILDER_ACKNOWLEDGEMENT_ROLE = "builder";

const LAUNCH_ACKNOWLEDGEMENT_VERSIONS = Object.freeze({
terms: "launcher_terms_v1",
riskDisclosure: "launcher_risk_disclosure_v1",
launchRules: "launcher_rules_v1",
noAdvice: "launcher_no_investment_advice_v1",
projectDisclosure: "builder_project_disclosure_v1",
prohibitedConduct: "builder_prohibited_conduct_v1",
});

const REFUND_LEDGER_PENDING_SHARED_STATUS = "pending_shared_refund";
const REFUND_LEDGER_PENDING_SHARED_LEGACY_STATUS =
"pending_shared_wallet_refund";
const REFUND_LEDGER_PENDING_PROGRAM_STATUS = "pending_program_refund";
const REFUND_LEDGER_PROCESSING_STATUS = "processing";
const REFUND_LEDGER_REFUNDED_STATUS = "refunded";
const REFUND_LEDGER_FAILED_STATUS = "failed";
const REFUND_LEDGER_CANCELLED_STATUS = "cancelled";

const REFUND_REQUEST_KIND_MANUAL = "manual_refund";
const REFUND_REQUEST_KIND_AUTO_FAILED = "failed_launch_auto";
const REFUND_REQUEST_KIND_LATE_REJECTED = "late_rejected_commit";

const BUILDER_BOND_REFUND_PENDING_STATUS = "pending";
const BUILDER_BOND_REFUND_PROCESSING_STATUS = "processing";
const BUILDER_BOND_REFUND_REFUNDED_STATUS = "refunded";
const BUILDER_BOND_REFUND_FAILED_STATUS = "failed";

const BUILDER_ALLOWED_HARD_CAPS = [250, 500, 750, 1000];
const BUILDER_SOFT_CAP_BY_HARD_CAP = {
250: 200,
500: 300,
750: 400,
1000: 500,
};

const LAUNCH_FEE_SPLIT = {
coreTeamDevelopment: 0.6,
ecosystemSupport: 0.4,
};

const MEMO_PROGRAM_ID = new PublicKey(
"MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

const reconcileLocks = new Map();
const finalizeLocks = new Map();
const refundExecutionLocks = new Map();
const tableExistsCache = new Map();
const tableColumnsCache = new Map();

function cleanText(value, max = 280) {
return String(value ?? "").trim().slice(0, max);
}

function cleanSymbol(value, max = 20) {
return String(value ?? "")
.toUpperCase()
.replace(/[^A-Z0-9]/g, "")
.slice(0, max);
}

function safeNumber(value, fallback = 0) {
const n = Number(value);
return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
return Math.max(min, Math.min(max, n));
}

function roundPct(value) {
return Number(Number(value || 0).toFixed(TEAM_PCT_PRECISION));
}

function approxEqual(a, b, epsilon = 0.000001) {
return Math.abs(Number(a || 0) - Number(b || 0)) <= epsilon;
}

function parseJsonMaybe(input, fallback = null) {
if (input == null || input === "") return fallback;
if (typeof input === "object") return input;

try {
return JSON.parse(String(input));
} catch {
return fallback;
}
}

async function tableExists(tableName) {
const key = String(tableName || "").trim();
if (!key) return false;

if (tableExistsCache.has(key)) {
return tableExistsCache.get(key);
}

const row = await db.get(
`
SELECT name
FROM sqlite_master
WHERE type = 'table' AND name = ?
LIMIT 1
`,
[key]
);

const exists = Boolean(row?.name);
tableExistsCache.set(key, exists);
return exists;
}

async function getTableColumns(tableName) {
const key = String(tableName || "").trim();
if (!key) return new Set();

if (tableColumnsCache.has(key)) {
return tableColumnsCache.get(key);
}

const rows = await db.all(`PRAGMA table_info(${key})`);
const columns = new Set(rows.map((row) => String(row.name || "").trim()));
tableColumnsCache.set(key, columns);
return columns;
}

async function refundLedgerTableExists() {
return tableExists("launch_refund_ledger");
}

async function builderBondRefundLedgerTableExists() {
return tableExists(BUILDER_BOND_REFUND_TABLE);
}

function normalizeWallet(value) {
return cleanText(value, 120);
}

function normalizeWalletKey(value) {
return normalizeWallet(value).toLowerCase();
}

function dedupeWalletEntries(wallets = []) {
const seen = new Set();
const out = [];

for (const wallet of wallets) {
const w = normalizeWallet(wallet);
if (!w) continue;
if (seen.has(w)) continue;
seen.add(w);
out.push(w);
}

return out;
}

function parseTeamWallets(input) {
if (!input) return [];

if (Array.isArray(input)) {
return dedupeWalletEntries(input).slice(0, MAX_TEAM_WALLETS);
}

const parsed = parseJsonMaybe(input, []);
if (Array.isArray(parsed)) {
return dedupeWalletEntries(parsed).slice(0, MAX_TEAM_WALLETS);
}

return [];
}

function parseTeamWalletBreakdown(input) {
if (!input) return [];

const raw = Array.isArray(input) ? input : parseJsonMaybe(input, []);
if (!Array.isArray(raw)) return [];

const seen = new Set();
const out = [];

for (const entry of raw) {
if (!entry || typeof entry !== "object") continue;

const wallet = normalizeWallet(entry.wallet ?? entry.address ?? entry.pubkey);
const pct = roundPct(entry.pct ?? entry.percent ?? entry.percentage);

if (!wallet) continue;
if (!Number.isFinite(pct) || pct <= 0) continue;
if (seen.has(wallet)) continue;

seen.add(wallet);
out.push({ wallet, pct, label: cleanText(entry.label, 80) });
}

return out.slice(0, MAX_TEAM_WALLETS);
}

function buildEqualBreakdown(wallets, totalPct) {
const cleanWallets = dedupeWalletEntries(wallets).slice(0, MAX_TEAM_WALLETS);
const pct = roundPct(totalPct);

if (!cleanWallets.length || pct <= 0) return [];

const perWallet = roundPct(pct / cleanWallets.length);
const out = cleanWallets.map((wallet, index) => ({
wallet,
pct:
index === cleanWallets.length - 1
? roundPct(pct - perWallet * (cleanWallets.length - 1))
: perWallet,
}));

return out.filter((x) => x.pct > 0);
}

function normalizeSupply(value, fallback) {
const raw = String(value ?? fallback ?? "").trim();
if (!raw) return String(fallback ?? "1000000000");

const digits = raw.replace(/[^\d]/g, "");
if (!digits) return String(fallback ?? "1000000000");

return digits;
}

function safeJsonParseArray(value) {
const parsed = parseJsonMaybe(value, []);
return Array.isArray(parsed) ? parsed : [];
}

function isBuilderTemplate(value) {
const template =
typeof value === "string" ? value : String(value?.template || "").trim();

return template === "builder";
}

function chooseFirstProvided(...values) {
for (const value of values) {
if (value !== undefined && value !== null && String(value).trim() !== "") {
return value;
}
}
return null;
}

function parseOptionalFiniteNumber(value) {
if (value === undefined || value === null || String(value).trim() === "") {
return null;
}

const num = Number(value);
if (!Number.isFinite(num)) return Number.NaN;
return num;
}

function getBuilderHardCapInput(reqBody = {}) {
return chooseFirstProvided(
reqBody.hard_cap_sol,
reqBody.hardCapSol,
reqBody.hard_cap,
reqBody.hardCap,
reqBody.builder_hard_cap_sol,
reqBody.builderHardCapSol,
reqBody.cap_sol,
reqBody.capSol
);
}

function getBuilderMinRaiseInput(reqBody = {}) {
return chooseFirstProvided(
reqBody.min_raise_sol,
reqBody.minRaiseSol,
reqBody.min_raise,
reqBody.minRaise,
reqBody.soft_cap_sol,
reqBody.softCapSol,
reqBody.soft_cap,
reqBody.softCap
);
}

function getExpectedBuilderSoftCap(hardCap) {
return BUILDER_SOFT_CAP_BY_HARD_CAP[Number(hardCap)] || null;
}

function getRequiredLaunchBondSol(softCap) {
const numericSoftCap = Number(softCap);
if (!Number.isFinite(numericSoftCap) || numericSoftCap <= 0) {
return MIN_LAUNCH_BOND_SOL;
}

return Math.min(
MAX_LAUNCH_BOND_SOL,
Math.max(MIN_LAUNCH_BOND_SOL, Math.ceil(numericSoftCap * 0.05))
);
}

function getTemplateConfig(template, reqBody = {}) {
const configs = {
degen: {
launch_type: "degen",
supply: "1000000000",
min_raise_sol: 55,
hard_cap_sol: 75,
liquidity_pct: 20,
participants_pct: 45,
reserve_pct: 30,
builder_pct: 5,
},
degen_zone: {
launch_type: "degen",
supply: "1000000000",
min_raise_sol: 55,
hard_cap_sol: 75,
liquidity_pct: 20,
participants_pct: 45,
reserve_pct: 30,
builder_pct: 5,
},
meme_lite: {
launch_type: "main",
supply: "1000000000",
min_raise_sol: 60,
hard_cap_sol: 100,
liquidity_pct: 20,
participants_pct: 45,
reserve_pct: 30,
builder_pct: 5,
},
meme_pro: {
launch_type: "main",
supply: "1000000000",
min_raise_sol: 75,
hard_cap_sol: 200,
liquidity_pct: 20,
participants_pct: 45,
reserve_pct: 30,
builder_pct: 5,
},
builder: {
launch_type: "main",
supply: "1000000000",
min_raise_sol: 200,
hard_cap_sol: 250,
liquidity_pct: 20,
participants_pct: 45,
reserve_pct: 30,
builder_pct: 5,
},
community: {
launch_type: "main",
supply: "1000000000",
min_raise_sol: 75,
hard_cap_sol: 200,
liquidity_pct: 20,
participants_pct: 45,
reserve_pct: 30,
builder_pct: 5,
},
};

const base = configs[template] || null;
if (!base) return null;

if (!isBuilderTemplate(template)) {
return base;
}

const hardCapInput = getBuilderHardCapInput(reqBody);
const minRaiseInput = getBuilderMinRaiseInput(reqBody);

const parsedHardCap = parseOptionalFiniteNumber(hardCapInput);
const parsedMinRaise = parseOptionalFiniteNumber(minRaiseInput);

if (Number.isNaN(parsedHardCap)) {
throw new Error("builder hard cap must be a valid number");
}

if (Number.isNaN(parsedMinRaise)) {
throw new Error("builder minimum raise must be a valid number");
}

if (
parsedHardCap != null &&
!BUILDER_ALLOWED_HARD_CAPS.includes(parsedHardCap)
) {
throw new Error(
`builder hard cap must be one of ${BUILDER_ALLOWED_HARD_CAPS.join(", ")} SOL`
);
}

const hardCap = parsedHardCap != null ? parsedHardCap : base.hard_cap_sol;
const expectedSoftCap = getExpectedBuilderSoftCap(hardCap);

if (!expectedSoftCap) {
throw new Error(
`builder hard cap must be one of ${BUILDER_ALLOWED_HARD_CAPS.join(", ")} SOL`
);
}

const minRaise = parsedMinRaise != null ? parsedMinRaise : expectedSoftCap;

return {
...base,
min_raise_sol: minRaise,
hard_cap_sol: hardCap,
};
}

function buildCommitPercent(totalCommitted, hardCap) {
const total = Number(totalCommitted || 0);
const cap = Number(hardCap || 0);
if (cap <= 0) return 0;
return Math.max(0, Math.min(100, Math.floor((total / cap) * 100)));
}

function buildFeeBreakdown(totalCommitted, launchFeePct = LAUNCH_FEE_PCT) {
const total = safeNumber(totalCommitted, 0);
const feePct = safeNumber(launchFeePct, LAUNCH_FEE_PCT);
const feeTotal = total * (feePct / 100);
const coreTeamDevelopmentFee =
feeTotal * LAUNCH_FEE_SPLIT.coreTeamDevelopment;
const ecosystemSupportFee = feeTotal * LAUNCH_FEE_SPLIT.ecosystemSupport;
const netRaiseAfterFee = total - feeTotal;

return {
launchFeePct: feePct,
totalCommitted: total,
feeTotal,
coreTeamDevelopmentFee,
ecosystemSupportFee,
netRaiseAfterFee,
split: {
coreTeamDevelopmentPct: LAUNCH_FEE_SPLIT.coreTeamDevelopment * 100,
ecosystemSupportPct: LAUNCH_FEE_SPLIT.ecosystemSupport * 100,
},

coreFee: coreTeamDevelopmentFee,
founderFee: coreTeamDevelopmentFee,
treasuryFee: ecosystemSupportFee,
buybackFee: 0,
netRaise: netRaiseAfterFee,
};
}

function shapeBuilderConfig(template, reqBody) {
const launchBondSol = safeNumber(
chooseFirstProvided(
reqBody.builder_bond_sol,
reqBody.builderBond,
reqBody.launch_bond_sol,
reqBody.launchBondSol,
reqBody.launchBond
),
0
);

if (!isBuilderTemplate(template)) {
return {
team_allocation_pct: 0,
team_wallets: [],
team_wallet_breakdown: [],
builder_bond_sol: launchBondSol,
};
}

const teamAllocationPct = clamp(
safeNumber(reqBody.team_allocation_pct, reqBody.teamAllocation),
0,
MAX_TEAM_ALLOCATION_PCT
);

const rawTeamWallets = parseTeamWallets(
reqBody.team_wallets ?? reqBody.teamWallets
);

let breakdown = parseTeamWalletBreakdown(
reqBody.team_wallet_breakdown ?? reqBody.teamWalletBreakdown
);

let teamWallets = rawTeamWallets;

if (!breakdown.length && teamWallets.length && teamAllocationPct > 0) {
breakdown = buildEqualBreakdown(teamWallets, teamAllocationPct);
}

if (breakdown.length) {
teamWallets = dedupeWalletEntries(breakdown.map((x) => x.wallet));
}

return {
team_allocation_pct: teamAllocationPct,
team_wallets: teamWallets.slice(0, MAX_TEAM_WALLETS),
team_wallet_breakdown: breakdown.slice(0, MAX_TEAM_WALLETS),
builder_bond_sol: launchBondSol,
};
}

function validateBuilderConfig(template, cfg, builderCfg) {
if (!cfg) {
throw new Error("invalid template");
}

if (Number(cfg.min_raise_sol) <= 0) {
throw new Error("invalid minimum raise");
}

if (Number(cfg.hard_cap_sol) <= Number(cfg.min_raise_sol)) {
throw new Error("hard cap must be greater than minimum raise");
}

const expectedLaunchBondSol = getRequiredLaunchBondSol(cfg.min_raise_sol);

if (
!Number.isFinite(builderCfg.builder_bond_sol) ||
Number(builderCfg.builder_bond_sol) !== expectedLaunchBondSol
) {
throw new Error(
`launch bond must be exactly ${expectedLaunchBondSol} SOL for this template`
);
}

if (!isBuilderTemplate(template)) {
return;
}

if (!BUILDER_ALLOWED_HARD_CAPS.includes(Number(cfg.hard_cap_sol))) {
throw new Error(
`builder hard cap must be one of ${BUILDER_ALLOWED_HARD_CAPS.join(", ")} SOL`
);
}

const expectedSoftCap = getExpectedBuilderSoftCap(cfg.hard_cap_sol);

if (!expectedSoftCap || Number(cfg.min_raise_sol) !== expectedSoftCap) {
throw new Error(
`builder minimum raise must match the locked soft cap for ${cfg.hard_cap_sol} SOL`
);
}

if (
!Number.isFinite(builderCfg.team_allocation_pct) ||
builderCfg.team_allocation_pct < 0
) {
throw new Error("invalid team allocation");
}

if (builderCfg.team_allocation_pct > MAX_TEAM_ALLOCATION_PCT) {
throw new Error(`team allocation cannot exceed ${MAX_TEAM_ALLOCATION_PCT}%`);
}

if (!Array.isArray(builderCfg.team_wallets)) {
throw new Error("team wallets must be an array");
}

if (builderCfg.team_wallets.length > MAX_TEAM_WALLETS) {
throw new Error(`team wallets cannot exceed ${MAX_TEAM_WALLETS}`);
}

if (builderCfg.team_wallets.some((wallet) => !wallet)) {
throw new Error("invalid team wallet entry");
}

if (!Array.isArray(builderCfg.team_wallet_breakdown)) {
throw new Error("team wallet breakdown must be an array");
}

if (builderCfg.team_wallet_breakdown.length > MAX_TEAM_WALLETS) {
throw new Error(
`team wallet breakdown cannot exceed ${MAX_TEAM_WALLETS}`
);
}

const breakdownWallets = new Set();
let breakdownTotal = 0;

for (const entry of builderCfg.team_wallet_breakdown) {
if (!entry || typeof entry !== "object") {
throw new Error("invalid team wallet breakdown entry");
}

const wallet = normalizeWallet(entry.wallet);
const pct = Number(entry.pct);

if (!wallet) {
throw new Error("team wallet breakdown wallet is required");
}

if (breakdownWallets.has(wallet)) {
throw new Error("duplicate wallet in team wallet breakdown");
}

if (!Number.isFinite(pct) || pct <= 0) {
throw new Error("team wallet breakdown pct must be greater than 0");
}

breakdownWallets.add(wallet);
breakdownTotal += pct;
}

breakdownTotal = roundPct(breakdownTotal);

const teamWalletSet = new Set(builderCfg.team_wallets);

for (const wallet of breakdownWallets) {
if (!teamWalletSet.has(wallet)) {
throw new Error("team wallet breakdown must match team wallets");
}
}

if (builderCfg.team_allocation_pct === 0) {
if (
builderCfg.team_wallets.length ||
builderCfg.team_wallet_breakdown.length
) {
throw new Error("team wallets are not allowed when team allocation is 0");
}
} else {
if (!builderCfg.team_wallets.length) {
throw new Error("team wallets are required for builder launches");
}

if (!builderCfg.team_wallet_breakdown.length) {
throw new Error(
"team wallet breakdown is required for builder launches"
);
}

if (!approxEqual(breakdownTotal, builderCfg.team_allocation_pct)) {
throw new Error("team wallet breakdown must equal team allocation");
}
}
}

function parseDbTime(value) {
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

function isExplicitFalseish(value) {
if (value === false || value === 0) return true;
const raw = String(value ?? "").trim().toLowerCase();
return raw === "0" || raw === "false" || raw === "no";
}

function isMarketBootstrapPending(row = {}) {
return isExplicitFalseish(row?.market_bootstrapped);
}

function parseLaunchJsonFields(row) {
const parsedTeamWallets = Array.isArray(row?.team_wallets)
? row.team_wallets
: safeJsonParseArray(row?.team_wallets);

const parsedTeamWalletBreakdown = Array.isArray(row?.team_wallet_breakdown)
? row.team_wallet_breakdown
: safeJsonParseArray(row?.team_wallet_breakdown);

const contractAddress = cleanText(row?.contract_address, 120);
const mintAddress = cleanText(
row?.mint_address ?? row?.contract_address,
120
);
const tokenMint = cleanText(
row?.token_mint ?? row?.mint_address ?? row?.contract_address,
120
);
const mint = cleanText(
row?.mint ?? row?.token_mint ?? row?.mint_address ?? row?.contract_address,
120
);

return {
...row,
team_allocation_pct: Number(row?.team_allocation_pct || 0),
builder_bond_sol: Number(row?.builder_bond_sol || 0),
builder_bond_refunded: Number(row?.builder_bond_refunded || 0),
builder_bond_paid: Number(row?.builder_bond_paid || 0),
builder_bond_tx_signature: cleanText(row?.builder_bond_tx_signature, 140),
team_wallets: parsedTeamWallets,
team_wallet_breakdown: parsedTeamWalletBreakdown,
contract_address: contractAddress,
mint_address: mintAddress,
token_mint: tokenMint,
mint,
reserved_mint_address: cleanText(row?.reserved_mint_address, 120),
mint_reservation_status: cleanText(row?.mint_reservation_status, 40),
mint_required_tag: cleanText(row?.mint_required_tag, 32) || REQUIRED_MINT_TAG,
mint_reservation_attempts: Number(row?.mint_reservation_attempts || 0),
mint_reserved_at: row?.mint_reserved_at || null,
mint_finalized_at: row?.mint_finalized_at || null,
website_url: cleanText(row?.website_url, 500),
x_url: cleanText(row?.x_url, 500),
telegram_url: cleanText(row?.telegram_url, 500),
discord_url: cleanText(row?.discord_url, 500),
builder_wallet: cleanText(row?.builder_wallet, 120),
builder_alias: cleanText(row?.builder_alias, 120),
builder_score: Number(row?.builder_score || 0),
market_bootstrapped: row?.market_bootstrapped,
commit_escrow_address: cleanText(row?.commit_escrow_address, 120),
launch_escrow_address: cleanText(row?.launch_escrow_address, 120),
escrow_vault_address: cleanText(row?.escrow_vault_address, 120),
escrow_address: cleanText(row?.escrow_address, 120),
escrow_wallet: cleanText(row?.escrow_wallet, 120),
vault_address: cleanText(row?.vault_address, 120),
commit_escrow_model: cleanText(row?.commit_escrow_model, 80),
escrow_model: cleanText(row?.escrow_model, 80),
escrow_type: cleanText(row?.escrow_type, 80),
funds_model: cleanText(row?.funds_model, 80),
};
}

function getRestrictedCommitWalletSet(row) {
const launch = parseLaunchJsonFields(row);
const out = new Set();

const builderWallet = normalizeWalletKey(launch.builder_wallet);
if (builderWallet) {
out.add(builderWallet);
}

for (const wallet of Array.isArray(launch.team_wallets) ? launch.team_wallets : []) {
const normalized = normalizeWalletKey(wallet);
if (normalized) {
out.add(normalized);
}
}

for (const entry of Array.isArray(launch.team_wallet_breakdown)
? launch.team_wallet_breakdown
: []) {
const normalized = normalizeWalletKey(entry?.wallet);
if (normalized) {
out.add(normalized);
}
}

return out;
}

function isRestrictedCommitWallet(launch, wallet) {
const normalizedWallet = normalizeWalletKey(wallet);
if (!normalizedWallet) return false;
return getRestrictedCommitWalletSet(launch).has(normalizedWallet);
}

function getRestrictedCommitWalletError() {
return "builder and declared team wallets cannot participate in the commit phase";
}

function computeCanonicalLaunchStatus(row) {
const launch = parseLaunchJsonFields(row);
const rawStatus = cleanText(launch.status, 40).toLowerCase();
const countdownStartedMs = parseDbTime(launch.countdown_started_at);
const countdownEndsMs = parseDbTime(launch.countdown_ends_at || launch.live_at);
const hasCountdownWindow =
Number.isFinite(countdownStartedMs) || Number.isFinite(countdownEndsMs);

const contractAddress = cleanText(
launch.contract_address ||
launch.mint_address ||
launch.token_mint ||
launch.mint,
120
);
const mintReservationStatus = cleanText(
launch.mint_reservation_status,
40
).toLowerCase();
const mintFinalizedAtMs = parseDbTime(launch.mint_finalized_at);
const marketBootstrapPending = isMarketBootstrapPending(launch);

const hasLiveSignal = Boolean(
contractAddress ||
mintReservationStatus === "finalized" ||
Number.isFinite(mintFinalizedAtMs)
);

if (rawStatus === "failed" || rawStatus === "failed_refunded") {
return rawStatus;
}

if (rawStatus === "graduated") {
return "graduated";
}

if (rawStatus === "live") {
return marketBootstrapPending ? "building" : "live";
}

if (rawStatus === "building") {
return "building";
}

if (rawStatus === "countdown") {
if (Number.isFinite(countdownEndsMs) && Date.now() >= countdownEndsMs) {
return "building";
}
return "countdown";
}

if (rawStatus === "commit") {
if (hasCountdownWindow) {
if (Number.isFinite(countdownEndsMs) && Date.now() >= countdownEndsMs) {
return "building";
}
return "countdown";
}
return "commit";
}

if (hasCountdownWindow) {
if (Number.isFinite(countdownEndsMs) && Date.now() >= countdownEndsMs) {
return "building";
}
return "countdown";
}

if (hasLiveSignal) {
return marketBootstrapPending ? "building" : "live";
}

return rawStatus || "commit";
}

function applyCanonicalLaunchTruth(row) {
if (!row) return null;
const parsed = parseLaunchJsonFields(row);

return {
...parsed,
status: computeCanonicalLaunchStatus(parsed),
};
}

function shouldRevealContractAddress(status) {
const normalized = cleanText(status, 40).toLowerCase();
return normalized === "live" || normalized === "graduated";
}

function sanitizeLaunchForPublic(row, { includeMintMeta = false } = {}) {
const parsed = applyCanonicalLaunchTruth(row);
const revealCa = shouldRevealContractAddress(parsed?.status);

const publicContractAddress = revealCa
? cleanText(
parsed?.contract_address ||
parsed?.mint_address ||
parsed?.token_mint ||
parsed?.mint,
120
) || null
: null;

const publicMintAddress = revealCa
? cleanText(parsed?.mint_address || publicContractAddress, 120) ||
publicContractAddress
: null;

const publicTokenMint = revealCa
? cleanText(parsed?.token_mint || publicMintAddress || publicContractAddress, 120) ||
publicContractAddress
: null;

const publicMint = revealCa
? cleanText(
parsed?.mint ||
publicTokenMint ||
publicMintAddress ||
publicContractAddress,
120
) || publicContractAddress
: null;

return {
...parsed,
contract_address: publicContractAddress,
mint_address: publicMintAddress,
token_mint: publicTokenMint,
mint: publicMint,
reserved_mint_address: null,
reserved_mint_secret: null,
mint_reservation_status: revealCa
? cleanText(parsed?.mint_reservation_status, 40) || null
: null,
mint_reservation_attempts:
revealCa && includeMintMeta
? Number(parsed?.mint_reservation_attempts || 0)
: 0,
mint_reserved_at:
revealCa && includeMintMeta ? parsed?.mint_reserved_at || null : null,
mint_finalized_at: revealCa ? parsed?.mint_finalized_at || null : null,
};
}

function hasCollectedBuilderBond(row) {
const launch = parseLaunchJsonFields(row);

return Boolean(
Number(launch.builder_bond_paid || 0) === 1 ||
cleanText(launch.builder_bond_tx_signature || "", 140)
);
}

function requiresBuilderBond(row) {
const launch = parseLaunchJsonFields(row);
return Number(launch.builder_bond_sol || 0) > 0;
}

function isBuilderBondSatisfied(row) {
const launch = parseLaunchJsonFields(row);
if (!requiresBuilderBond(launch)) return true;
return Number(launch.builder_bond_paid || 0) === 1;
}

function isValidSolanaAddress(value) {
try {
new PublicKey(String(value || "").trim());
return true;
} catch {
return false;
}
}

function isLikelyBlockhashExpiredError(err) {
const msg = String(err?.message || err || "").toLowerCase();
return msg.includes("blockhash not found") || msg.includes("block height exceeded");
}

function isTransientFinalizeError(err) {
const msg = String(err?.message || err || "").toLowerCase();

return (
msg.includes("fetch failed") ||
msg.includes("und_err_socket") ||
msg.includes("socket") ||
msg.includes("timeout") ||
msg.includes("econnreset") ||
msg.includes("429") ||
msg.includes("too many requests") ||
msg.includes("block height exceeded") ||
msg.includes("blockhash not found") ||
msg.includes("failed to get recent blockhash")
);
}

function normalizePublicLink(raw, typeKey = "") {
const value = cleanText(raw, 500);
if (!value) return "";
if (/^javascript:/i.test(value) || /^data:/i.test(value)) return "";

let normalized = value;
if (!/^https?:\/\//i.test(normalized)) {
normalized = `https://${normalized}`;
}

try {
const url = new URL(normalized);
if (!["http:", "https:"].includes(url.protocol)) return "";

const host = url.hostname.toLowerCase();

if (typeKey === "x_url" && !(host.includes("x.com") || host.includes("twitter.com"))) {
return "";
}
if (
typeKey === "telegram_url" &&
!(host.includes("t.me") || host.includes("telegram.me"))
) {
return "";
}
if (
typeKey === "discord_url" &&
!(host.includes("discord.gg") || host.includes("discord.com"))
) {
return "";
}

return url.toString();
} catch {
return "";
}
}

function shapeLaunchForList(row) {
const parsed = sanitizeLaunchForPublic(row);
const totalCommitted = Number(parsed.committed_sol || 0);
const hardCap = Number(parsed.hard_cap_sol || 0);
const rawStatus = cleanText(row?.status || parsed?.status, 40).toLowerCase();

return {
id: parsed.id,
token_name: parsed.token_name,
symbol: parsed.symbol,
description: parsed.description,
image_url: parsed.image_url,
template: parsed.template,
launch_type: parsed.launch_type,
raw_status: rawStatus,
status: parsed.status,
min_raise_sol: Number(parsed.min_raise_sol || 0),
hard_cap_sol: hardCap,
committed_sol: totalCommitted,
participants_count: Number(parsed.participants_count || 0),
launch_fee_pct: Number(parsed.launch_fee_pct || LAUNCH_FEE_PCT),
liquidity_pct: Number(parsed.liquidity_pct || 0),
participants_pct: Number(parsed.participants_pct || 0),
reserve_pct: Number(parsed.reserve_pct || 0),
builder_pct: Number(parsed.builder_pct || 0),
team_allocation_pct: Number(parsed.team_allocation_pct || 0),
team_wallets: parsed.team_wallets,
team_wallet_breakdown: parsed.team_wallet_breakdown,
builder_bond_sol: Number(parsed.builder_bond_sol || 0),
builder_bond_refunded: Number(parsed.builder_bond_refunded || 0),
builder_bond_paid: Number(parsed.builder_bond_paid || 0),
market_bootstrapped: parsed.market_bootstrapped,
contract_address: parsed.contract_address || null,
mint_address: parsed.mint_address || null,
token_mint: parsed.token_mint || null,
mint: parsed.mint || null,
reserved_mint_address: null,
mint_reservation_status: null,
mint_required_tag: parsed.mint_required_tag || REQUIRED_MINT_TAG,
mint_reservation_attempts: 0,
mint_reserved_at: null,
mint_finalized_at: shouldRevealContractAddress(parsed.status)
? parsed.mint_finalized_at || null
: null,
commit_started_at: parsed.commit_started_at || null,
commit_ends_at: parsed.commit_ends_at || null,
countdown_started_at: parsed.countdown_started_at || null,
countdown_ends_at: parsed.countdown_ends_at || null,
live_at: parsed.live_at || null,
failed_at: parsed.failed_at || null,
builder_wallet: parsed.builder_wallet || null,
builder_alias: parsed.builder_alias || null,
builder_score: parsed.builder_score ?? null,
website_url: parsed.website_url || "",
x_url: parsed.x_url || "",
telegram_url: parsed.telegram_url || "",
discord_url: parsed.discord_url || "",
commitPercent: buildCommitPercent(totalCommitted, hardCap),
};
}

function isCurrentListStatus(status) {
const s = cleanText(status, 40).toLowerCase();
return s === "commit" || s === "countdown" || s === "building" || s === "live";
}

function isHistoricalListStatus(status) {
const s = cleanText(status, 40).toLowerCase();
return s === "graduated" || s === "failed" || s === "failed_refunded";
}

function getRpcUrl() {
return (
cleanText(process.env.SOLANA_RPC, 500) ||
cleanText(process.env.RPC_URL, 500) ||
"https://api.devnet.solana.com"
);
}

function decodeKeypairRaw(raw, label = "private key") {
try {
if (raw.startsWith("[")) {
const arr = JSON.parse(raw);
if (!Array.isArray(arr) || !arr.length) {
throw new Error("invalid secret key array");
}
return Keypair.fromSecretKey(Uint8Array.from(arr));
}

return Keypair.fromSecretKey(bs58.decode(raw));
} catch (err) {
throw new Error(`${label} is invalid: ${err?.message || err}`);
}
}

function maybeGetKeypairFromEnv(envNames = [], label = "private key") {
for (const envName of envNames) {
const raw = cleanText(process.env[envName], 5000);
if (!raw) continue;
return decodeKeypairRaw(raw, `${envName}`);
}
return null;
}

function getEscrowWallet() {
const wallet = cleanText(process.env.ESCROW_WALLET, 120);
if (!wallet) {
throw new Error("ESCROW_WALLET is not configured");
}
return wallet;
}

function getBuilderBondEscrowWallet() {
return (
cleanText(process.env.BUILDER_BOND_ESCROW_WALLET, 120) ||
getEscrowWallet()
);
}

function getEscrowKeypair() {
const keypair = maybeGetKeypairFromEnv(
["LAUNCH_ESCROW_PRIVATE_KEY", "ESCROW_PRIVATE_KEY"],
"launch escrow signer"
);

if (!keypair) {
throw new Error(
"LAUNCH_ESCROW_PRIVATE_KEY or ESCROW_PRIVATE_KEY is not configured"
);
}

return keypair;
}

function getBuilderBondEscrowKeypair() {
const keypair = maybeGetKeypairFromEnv(
[
"BUILDER_BOND_ESCROW_PRIVATE_KEY",
"LAUNCH_ESCROW_PRIVATE_KEY",
"ESCROW_PRIVATE_KEY",
],
"builder bond escrow signer"
);

if (!keypair) {
throw new Error(
"BUILDER_BOND_ESCROW_PRIVATE_KEY, LAUNCH_ESCROW_PRIVATE_KEY, or ESCROW_PRIVATE_KEY is not configured"
);
}

return keypair;
}

function getRelayerKeypair(fallback = null) {
return (
maybeGetKeypairFromEnv(
["RELAYER_PRIVATE_KEY", "REFUND_RELAYER_PRIVATE_KEY"],
"relayer signer"
) || fallback
);
}

function resolveLaunchCommitEscrow(launch = null) {
const defaultAddress = getEscrowWallet();

const explicitAddress = cleanText(
chooseFirstProvided(
launch?.commit_escrow_address,
launch?.launch_escrow_address,
launch?.escrow_vault_address,
launch?.escrow_address,
launch?.vault_address,
launch?.escrow_wallet
),
120
);

const modelHint = cleanText(
chooseFirstProvided(
launch?.commit_escrow_model,
launch?.escrow_model,
launch?.escrow_type,
launch?.funds_model
),
80
).toLowerCase();

let model = "shared_wallet";

if (
modelHint.includes("vault") ||
modelHint.includes("program") ||
modelHint.includes("pda")
) {
model = "launch_vault";
} else if (explicitAddress && explicitAddress !== defaultAddress) {
model = "launch_vault";
}

const address = explicitAddress || defaultAddress;

if (!address || !isValidSolanaAddress(address)) {
throw new Error("launch commit escrow address is invalid");
}

return {
address,
model,
};
}

function solToLamports(solAmount) {
return Math.round(Number(solAmount) * 1_000_000_000);
}

function buildLaunchBondReference(wallet) {
return `mss-launch-bond-${cleanText(wallet, 80)}`;
}

function buildCommitReference(launchId) {
return `mss-launch-${launchId}`;
}

function buildRefundProgramReference(launchId, wallet) {
const suffix =
normalizeWallet(wallet).replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "wallet";
return `mss-refund-${launchId}-${suffix}`;
}

function toTruthyBoolean(value) {
if (value === true || value === 1) return true;
const raw = String(value ?? "").trim().toLowerCase();
return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

function normalizeAcknowledgementRole(value) {
const normalized = cleanText(value, 40).toLowerCase();

if (normalized === PARTICIPANT_ACKNOWLEDGEMENT_ROLE) {
return PARTICIPANT_ACKNOWLEDGEMENT_ROLE;
}

if (normalized === BUILDER_ACKNOWLEDGEMENT_ROLE) {
return BUILDER_ACKNOWLEDGEMENT_ROLE;
}

return null;
}

function buildInternalWalletInterventionError({
wallet,
role,
action = "launcher_transaction",
} = {}) {
const normalizedRole =
normalizeAcknowledgementRole(role) || PARTICIPANT_ACKNOWLEDGEMENT_ROLE;

const err = new Error(
"This wallet is currently unable to use Launcher transactions. Contact support if you believe this is an error."
);

err.statusCode = 403;
err.code = "launcher_wallet_intervention_active";
err.role = normalizedRole;
err.action = cleanText(action, 80) || "launcher_transaction";
err.wallet = normalizeWallet(wallet);
err.internalInterventionActive = true;

return err;
}

async function getInternalWalletIntervention(wallet) {
const normalizedWallet = normalizeWallet(wallet);

if (
!normalizedWallet ||
!(await tableExists(INTERNAL_COMPLIANCE_PROFILE_TABLE))
) {
return {
record_present: false,
blocked: false,
state: "clear",
reason_code: null,
};
}

const row = await db.get(
`
SELECT
id,
status,
risk_rating,
sanctions_status,
manual_review_required
FROM ${INTERNAL_COMPLIANCE_PROFILE_TABLE}
WHERE LOWER(wallet_address) = LOWER(?)
LIMIT 1
`,
[normalizedWallet]
);

if (!row) {
return {
record_present: false,
blocked: false,
state: "clear",
reason_code: null,
};
}

const status = cleanText(row.status, 40).toLowerCase();
const riskRating = cleanText(row.risk_rating, 40).toLowerCase();
const sanctionsFlag = toTruthyBoolean(row.sanctions_status);
const manualIntervention = toTruthyBoolean(row.manual_review_required);

let reasonCode = null;

if (status === "rejected" || status === "restricted") {
reasonCode = "profile_intervention";
} else if (riskRating === "critical") {
reasonCode = "critical_risk_intervention";
} else if (sanctionsFlag) {
reasonCode = "screening_intervention";
} else if (manualIntervention) {
reasonCode = "manual_intervention";
}

return {
record_present: true,
blocked: Boolean(reasonCode),
state: reasonCode ? "blocked" : "monitored",
reason_code: reasonCode,
};
}

async function requireNoInternalWalletIntervention({
wallet,
role,
action = "launcher_transaction",
} = {}) {
const intervention = await getInternalWalletIntervention(wallet);

if (intervention.blocked) {
throw buildInternalWalletInterventionError({
wallet,
role,
action,
});
}

return intervention;
}

function maybeSendInternalWalletInterventionError(res, err) {
if (!err || err.code !== "launcher_wallet_intervention_active") {
return false;
}

res.status(Number(err.statusCode) || 403).json({
ok: false,
error:
err.message ||
"This wallet is currently unable to use Launcher transactions.",
code: err.code,
role: err.role || null,
action: err.action || null,
internalInterventionActive: true,
acknowledgementModel: "acknowledgement_only",
identityVerificationRequired: false,
});

return true;
}

function getAcknowledgementPayload(body = {}) {
const candidate =
body?.acknowledgements ??
body?.acknowledgments ??
body?.launcher_acknowledgements ??
body?.launcherAcknowledgements ??
body?.launcher_acknowledgments ??
body?.launcherAcknowledgments;

if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
return candidate;
}

return body && typeof body === "object" ? body : {};
}

function readAcknowledgementFlag(payload, aliases = []) {
for (const alias of aliases) {
if (
Object.prototype.hasOwnProperty.call(payload, alias) &&
toTruthyBoolean(payload[alias])
) {
return true;
}
}

return false;
}

function buildAcknowledgementRequirements(role) {
const common = [
{
key: "terms_accepted",
label: "Launcher terms",
aliases: [
"terms_accepted",
"termsAccepted",
"accept_terms",
"acceptTerms",
"launcher_terms_accepted",
"launcherTermsAccepted",
],
},
{
key: "risk_disclosure_accepted",
label: "Risk disclosure",
aliases: [
"risk_disclosure_accepted",
"riskDisclosureAccepted",
"accept_risk_disclosure",
"acceptRiskDisclosure",
"launch_risk_accepted",
"launchRiskAccepted",
],
},
{
key: "launch_rules_accepted",
label: "Launch rules and transaction conditions",
aliases: [
"launch_rules_accepted",
"launchRulesAccepted",
"rules_accepted",
"rulesAccepted",
"allocation_rules_accepted",
"allocationRulesAccepted",
],
},
{
key: "no_advice_accepted",
label: "No investment advice acknowledgement",
aliases: [
"no_advice_accepted",
"noAdviceAccepted",
"not_investment_advice_accepted",
"notInvestmentAdviceAccepted",
"information_only_accepted",
"informationOnlyAccepted",
],
},
];

if (role !== BUILDER_ACKNOWLEDGEMENT_ROLE) {
return common;
}

return [
...common,
{
key: "project_disclosure_accepted",
label: "Project information accuracy disclosure",
aliases: [
"project_disclosure_accepted",
"projectDisclosureAccepted",
"project_information_accepted",
"projectInformationAccepted",
"builder_project_disclosure_accepted",
"builderProjectDisclosureAccepted",
],
},
{
key: "prohibited_conduct_accepted",
label: "Prohibited conduct acknowledgement",
aliases: [
"prohibited_conduct_accepted",
"prohibitedConductAccepted",
"market_manipulation_prohibited_accepted",
"marketManipulationProhibitedAccepted",
"builder_conduct_accepted",
"builderConductAccepted",
],
},
];
}

function hasAcknowledgementInput(body = {}, role = PARTICIPANT_ACKNOWLEDGEMENT_ROLE) {
const payload = getAcknowledgementPayload(body);
const requirements = buildAcknowledgementRequirements(role);

return requirements.some((requirement) =>
requirement.aliases.some((alias) =>
Object.prototype.hasOwnProperty.call(payload, alias)
)
);
}

function buildAcknowledgementError({
role,
missing = [],
message = "",
statusCode = 428,
code = "launcher_acknowledgements_required",
} = {}) {
const normalizedRole =
normalizeAcknowledgementRole(role) || PARTICIPANT_ACKNOWLEDGEMENT_ROLE;

const err = new Error(
message ||
`Accept the required ${normalizedRole} launcher acknowledgements before continuing.`
);

err.statusCode = statusCode;
err.code = code;
err.role = normalizedRole;
err.requiredAcknowledgements = buildAcknowledgementRequirements(
normalizedRole
).map((item) => item.key);
err.missingAcknowledgements = missing;

return err;
}

function validateAcknowledgementInput(body = {}, { role } = {}) {
const normalizedRole = normalizeAcknowledgementRole(role);

if (!normalizedRole) {
throw buildAcknowledgementError({
role: PARTICIPANT_ACKNOWLEDGEMENT_ROLE,
message: "invalid launcher acknowledgement role",
statusCode: 400,
code: "invalid_acknowledgement_role",
});
}

const payload = getAcknowledgementPayload(body);
const requirements = buildAcknowledgementRequirements(normalizedRole);
const values = {};
const missing = [];

for (const requirement of requirements) {
values[requirement.key] = readAcknowledgementFlag(
payload,
requirement.aliases
);

if (!values[requirement.key]) {
missing.push(requirement.key);
}
}

if (missing.length) {
throw buildAcknowledgementError({
role: normalizedRole,
missing,
});
}

return {
role: normalizedRole,
...values,
terms_version: LAUNCH_ACKNOWLEDGEMENT_VERSIONS.terms,
risk_disclosure_version: LAUNCH_ACKNOWLEDGEMENT_VERSIONS.riskDisclosure,
launch_rules_version: LAUNCH_ACKNOWLEDGEMENT_VERSIONS.launchRules,
no_advice_version: LAUNCH_ACKNOWLEDGEMENT_VERSIONS.noAdvice,
project_disclosure_version:
normalizedRole === BUILDER_ACKNOWLEDGEMENT_ROLE
? LAUNCH_ACKNOWLEDGEMENT_VERSIONS.projectDisclosure
: null,
prohibited_conduct_version:
normalizedRole === BUILDER_ACKNOWLEDGEMENT_ROLE
? LAUNCH_ACKNOWLEDGEMENT_VERSIONS.prohibitedConduct
: null,
};
}

async function ensureAcknowledgementStorageAvailable() {
if (!(await tableExists(LAUNCH_ACKNOWLEDGEMENT_TABLE))) {
throw buildAcknowledgementError({
role: PARTICIPANT_ACKNOWLEDGEMENT_ROLE,
message:
"Launcher acknowledgements are not configured yet. Apply the launcher acknowledgement migration before using launch transactions.",
statusCode: 503,
code: "launcher_acknowledgements_not_configured",
});
}
}

function serializeLauncherAcknowledgement(row) {
if (!row) return null;

return {
id: Number(row.id || 0),
launch_id: row.launch_id == null ? null : Number(row.launch_id),
wallet: cleanText(row.wallet, 120) || null,
role: normalizeAcknowledgementRole(row.role),
action: cleanText(row.action, 80) || null,
terms_version: cleanText(row.terms_version, 120) || null,
risk_disclosure_version: cleanText(row.risk_disclosure_version, 120) || null,
launch_rules_version: cleanText(row.launch_rules_version, 120) || null,
no_advice_version: cleanText(row.no_advice_version, 120) || null,
project_disclosure_version:
cleanText(row.project_disclosure_version, 120) || null,
prohibited_conduct_version:
cleanText(row.prohibited_conduct_version, 120) || null,
accepted_terms_at: row.accepted_terms_at || null,
accepted_risk_disclosure_at: row.accepted_risk_disclosure_at || null,
accepted_launch_rules_at: row.accepted_launch_rules_at || null,
accepted_no_advice_at: row.accepted_no_advice_at || null,
accepted_project_disclosure_at:
row.accepted_project_disclosure_at || null,
accepted_prohibited_conduct_at:
row.accepted_prohibited_conduct_at || null,
signature_reference: cleanText(row.signature_reference, 160) || null,
signature_message: cleanText(row.signature_message, 255) || null,
status: cleanText(row.status, 40).toLowerCase() || "accepted",
escalation_flag: Number(row.escalation_flag || 0),
escalation_reason: cleanText(row.escalation_reason, 500) || null,
created_at: row.created_at || null,
updated_at: row.updated_at || null,
};
}

function isAcknowledgementSatisfied(row, role) {
const acknowledgement = serializeLauncherAcknowledgement(row);
const normalizedRole = normalizeAcknowledgementRole(role);

if (!acknowledgement || !normalizedRole) return false;
if (acknowledgement.role !== normalizedRole) return false;
if (acknowledgement.status !== "accepted") return false;

const commonAccepted = Boolean(
acknowledgement.accepted_terms_at &&
acknowledgement.accepted_risk_disclosure_at &&
acknowledgement.accepted_launch_rules_at &&
acknowledgement.accepted_no_advice_at
);

if (!commonAccepted) return false;

if (normalizedRole === BUILDER_ACKNOWLEDGEMENT_ROLE) {
return Boolean(
acknowledgement.accepted_project_disclosure_at &&
acknowledgement.accepted_prohibited_conduct_at
);
}

return true;
}

async function findLauncherAcknowledgement({
wallet,
role,
launchId = null,
} = {}) {
await ensureAcknowledgementStorageAvailable();

const normalizedWallet = normalizeWallet(wallet);
const normalizedRole = normalizeAcknowledgementRole(role);

if (!normalizedWallet || !normalizedRole) return null;

let row;

if (launchId == null) {
row = await db.get(
`
SELECT *
FROM ${LAUNCH_ACKNOWLEDGEMENT_TABLE}
WHERE LOWER(wallet) = LOWER(?)
AND role = ?
AND launch_id IS NULL
ORDER BY id DESC
LIMIT 1
`,
[normalizedWallet, normalizedRole]
);
} else {
row = await db.get(
`
SELECT *
FROM ${LAUNCH_ACKNOWLEDGEMENT_TABLE}
WHERE LOWER(wallet) = LOWER(?)
AND role = ?
AND launch_id = ?
ORDER BY id DESC
LIMIT 1
`,
[normalizedWallet, normalizedRole, Number(launchId)]
);
}

return serializeLauncherAcknowledgement(row);
}

async function saveLauncherAcknowledgement({
wallet,
role,
launchId = null,
body = {},
action = "",
signatureReference = "",
signatureMessage = "",
} = {}) {
await ensureAcknowledgementStorageAvailable();

const normalizedWallet = normalizeWallet(wallet);
const normalizedRole = normalizeAcknowledgementRole(role);

if (!normalizedWallet) {
throw buildAcknowledgementError({
role: normalizedRole || PARTICIPANT_ACKNOWLEDGEMENT_ROLE,
message: "wallet is required for launcher acknowledgements",
statusCode: 400,
code: "wallet_required",
});
}

const accepted = validateAcknowledgementInput(body, {
role: normalizedRole,
});

const columns = await getTableColumns(LAUNCH_ACKNOWLEDGEMENT_TABLE);

if (!columns.size) {
throw buildAcknowledgementError({
role: normalizedRole,
message: "Unable to inspect launcher acknowledgement storage.",
statusCode: 503,
code: "launcher_acknowledgements_not_configured",
});
}

const existing = await findLauncherAcknowledgement({
wallet: normalizedWallet,
role: normalizedRole,
launchId,
});

const acceptedAt = new Date().toISOString();

const valuesByColumn = {
launch_id: launchId == null ? null : Number(launchId),
wallet: normalizedWallet,
role: normalizedRole,
action: cleanText(action, 80) || null,
terms_version: accepted.terms_version,
risk_disclosure_version: accepted.risk_disclosure_version,
launch_rules_version: accepted.launch_rules_version,
no_advice_version: accepted.no_advice_version,
project_disclosure_version: accepted.project_disclosure_version,
prohibited_conduct_version: accepted.prohibited_conduct_version,
accepted_terms_at: acceptedAt,
accepted_risk_disclosure_at: acceptedAt,
accepted_launch_rules_at: acceptedAt,
accepted_no_advice_at: acceptedAt,
accepted_project_disclosure_at:
normalizedRole === BUILDER_ACKNOWLEDGEMENT_ROLE ? acceptedAt : null,
accepted_prohibited_conduct_at:
normalizedRole === BUILDER_ACKNOWLEDGEMENT_ROLE ? acceptedAt : null,
signature_reference: cleanText(signatureReference, 160) || null,
signature_message: cleanText(signatureMessage, 255) || null,
status: "accepted",
escalation_flag: 0,
escalation_reason: null,
};

if (existing?.id) {
const assignments = [];
const values = [];

for (const [column, value] of Object.entries(valuesByColumn)) {
if (!columns.has(column)) continue;
if (column === "launch_id" || column === "wallet" || column === "role") {
continue;
}

assignments.push(`${column} = ?`);
values.push(value);
}

if (columns.has("updated_at")) {
assignments.push("updated_at = CURRENT_TIMESTAMP");
}

if (assignments.length) {
await db.run(
`
UPDATE ${LAUNCH_ACKNOWLEDGEMENT_TABLE}
SET ${assignments.join(", ")}
WHERE id = ?
`,
[...values, existing.id]
);
}

return findLauncherAcknowledgement({
wallet: normalizedWallet,
role: normalizedRole,
launchId,
});
}

const insertColumns = [];
const placeholders = [];
const insertValues = [];

for (const [column, value] of Object.entries(valuesByColumn)) {
if (!columns.has(column)) continue;

insertColumns.push(column);
placeholders.push("?");
insertValues.push(value);
}

if (columns.has("created_at")) {
insertColumns.push("created_at");
placeholders.push("CURRENT_TIMESTAMP");
}

if (columns.has("updated_at")) {
insertColumns.push("updated_at");
placeholders.push("CURRENT_TIMESTAMP");
}

const result = await db.run(
`
INSERT INTO ${LAUNCH_ACKNOWLEDGEMENT_TABLE} (
${insertColumns.join(", ")}
) VALUES (
${placeholders.join(", ")}
)
`,
insertValues
);

const row = await db.get(
`
SELECT *
FROM ${LAUNCH_ACKNOWLEDGEMENT_TABLE}
WHERE id = ?
LIMIT 1
`,
[result.lastID]
);

return serializeLauncherAcknowledgement(row);
}

async function requireStoredLauncherAcknowledgement({
wallet,
role,
launchId = null,
} = {}) {
const acknowledgement = await findLauncherAcknowledgement({
wallet,
role,
launchId,
});

if (!isAcknowledgementSatisfied(acknowledgement, role)) {
throw buildAcknowledgementError({
role,
});
}

return acknowledgement;
}

async function ensureLauncherAcknowledgementForAction({
wallet,
role,
launchId = null,
body = {},
action = "",
signatureReference = "",
signatureMessage = "",
} = {}) {
if (hasAcknowledgementInput(body, role)) {
return saveLauncherAcknowledgement({
wallet,
role,
launchId,
body,
action,
signatureReference,
signatureMessage,
});
}

return requireStoredLauncherAcknowledgement({
wallet,
role,
launchId,
});
}

async function attachLauncherAcknowledgementSignature({
wallet,
role,
launchId = null,
action = "",
signatureReference = "",
signatureMessage = "",
} = {}) {
const acknowledgement = await requireStoredLauncherAcknowledgement({
wallet,
role,
launchId,
});

const columns = await getTableColumns(LAUNCH_ACKNOWLEDGEMENT_TABLE);
const assignments = [];
const values = [];

if (columns.has("action")) {
assignments.push("action = ?");
values.push(cleanText(action, 80) || acknowledgement.action || null);
}

if (columns.has("signature_reference")) {
assignments.push("signature_reference = ?");
values.push(cleanText(signatureReference, 160) || null);
}

if (columns.has("signature_message")) {
assignments.push("signature_message = ?");
values.push(cleanText(signatureMessage, 255) || null);
}

if (columns.has("updated_at")) {
assignments.push("updated_at = CURRENT_TIMESTAMP");
}

if (assignments.length) {
await db.run(
`
UPDATE ${LAUNCH_ACKNOWLEDGEMENT_TABLE}
SET ${assignments.join(", ")}
WHERE id = ?
`,
[...values, acknowledgement.id]
);
}

return findLauncherAcknowledgement({
wallet,
role,
launchId,
});
}

function maybeSendAcknowledgementError(res, err) {
if (!err) return false;

if (
err.code === "launcher_acknowledgements_required" ||
err.code === "launcher_acknowledgements_not_configured" ||
err.code === "invalid_acknowledgement_role"
) {
res.status(Number(err.statusCode) || 428).json({
ok: false,
error: err.message || "launcher acknowledgements are required",
code: err.code,
role: err.role || null,
requiredAcknowledgements: err.requiredAcknowledgements || [],
missingAcknowledgements: err.missingAcknowledgements || [],
versions: LAUNCH_ACKNOWLEDGEMENT_VERSIONS,
acknowledgementModel: "acknowledgement_only",
identityVerificationRequired: false,
});

return true;
}

return false;
}

function normalizeRefundLedgerStatus(status = "") {
const normalized = cleanText(status, 80).toLowerCase();

if (normalized === REFUND_LEDGER_PENDING_SHARED_LEGACY_STATUS) {
return REFUND_LEDGER_PENDING_SHARED_STATUS;
}

return normalized;
}

function resolveRefundLedgerPendingStatus(escrowModel = "shared_wallet") {
return escrowModel === "launch_vault"
? REFUND_LEDGER_PENDING_PROGRAM_STATUS
: REFUND_LEDGER_PENDING_SHARED_STATUS;
}

function normalizeRefundLedgerRow(row) {
if (!row) return null;

return {
...row,
launch_id: safeNumber(row.launch_id, 0),
wallet: cleanText(row.wallet, 120),
status: normalizeRefundLedgerStatus(row.status),
request_kind: cleanText(row.request_kind, 80).toLowerCase(),
refund_reason: cleanText(row.refund_reason, 500),
escrow_model: cleanText(row.escrow_model, 80).toLowerCase(),
escrow_address: cleanText(row.escrow_address, 120),
refund_sol: safeNumber(row.refund_sol, 0),
refund_lamports: safeNumber(row.refund_lamports, 0),
commit_total_sol: safeNumber(row.commit_total_sol, 0),
commit_count: safeNumber(row.commit_count, 0),
latest_commit_tx_signature: cleanText(row.latest_commit_tx_signature, 140),
refund_tx_signature: cleanText(row.refund_tx_signature, 140),
program_instruction_ref: cleanText(row.program_instruction_ref, 160),
relayer_wallet: cleanText(row.relayer_wallet, 120),
source_wallet: cleanText(row.source_wallet, 120),
refund_attempts: safeNumber(row.refund_attempts, 0),
last_error: cleanText(row.last_error, 500),
requested_at: row.requested_at || null,
refunded_at: row.refunded_at || null,
failed_at: row.failed_at || null,
created_at: row.created_at || null,
updated_at: row.updated_at || null,
last_attempt_at: row.last_attempt_at || null,
};
}

function buildRefundExecutionLockKey(launchId, wallet) {
return `${Number(launchId || 0)}:${normalizeWalletKey(wallet)}`;
}

function buildBuilderBondRefundLockKey(txSignature) {
return `builder-bond:${cleanText(txSignature, 140)}`;
}

async function runRefundExecutionLocked(lockKey, fn) {
if (refundExecutionLocks.has(lockKey)) {
return refundExecutionLocks.get(lockKey);
}

const promise = (async () => fn())();
refundExecutionLocks.set(lockKey, promise);

try {
return await promise;
} finally {
refundExecutionLocks.delete(lockKey);
}
}

function normalizeBuilderBondRefundRow(row) {
if (!row) return null;

return {
...row,
id: Number(row.id || 0),
wallet: cleanText(row.wallet, 120),
bond_tx_signature: cleanText(row.bond_tx_signature, 140),
bond_sol: safeNumber(row.bond_sol, 0),
bond_lamports: safeNumber(row.bond_lamports, 0),
bond_escrow_address: cleanText(row.bond_escrow_address, 120),
status:
cleanText(row.status, 40).toLowerCase() ||
BUILDER_BOND_REFUND_PENDING_STATUS,
reason_code: cleanText(row.reason_code, 120),
request_action: cleanText(row.request_action, 120),
refund_tx_signature: cleanText(row.refund_tx_signature, 140),
relayer_wallet: cleanText(row.relayer_wallet, 120),
source_wallet: cleanText(row.source_wallet, 120),
refund_attempts: safeNumber(row.refund_attempts, 0),
last_error: cleanText(row.last_error, 500),
requested_at: row.requested_at || null,
last_attempt_at: row.last_attempt_at || null,
refunded_at: row.refunded_at || null,
failed_at: row.failed_at || null,
created_at: row.created_at || null,
updated_at: row.updated_at || null,
};
}

function buildBuilderBondRefundError({
message = "",
code = "builder_bond_refund_failed",
statusCode = 409,
refund = null,
} = {}) {
const err = new Error(message || "Builder bond refund could not be processed.");
err.code = code;
err.statusCode = statusCode;
err.builderBondRefund = refund;
return err;
}

async function ensureBuilderBondRefundStorageAvailable() {
if (!(await builderBondRefundLedgerTableExists())) {
throw buildBuilderBondRefundError({
message:
"Builder bond refund storage is not configured. Apply the builder bond refund migration before processing blocked-builder bond refunds.",
code: "builder_bond_refund_not_configured",
statusCode: 503,
});
}
}

async function getBuilderBondRefundBySignature(txSignature) {
await ensureBuilderBondRefundStorageAvailable();

const signature = cleanText(txSignature, 140);
if (!signature) return null;

const row = await db.get(
`
SELECT *
FROM ${BUILDER_BOND_REFUND_TABLE}
WHERE bond_tx_signature = ?
LIMIT 1
`,
[signature]
);

return normalizeBuilderBondRefundRow(row);
}

async function assertBuilderBondTransactionUsable(txSignature) {
if (!(await builderBondRefundLedgerTableExists())) {
return;
}

const refund = await getBuilderBondRefundBySignature(txSignature);

if (!refund) return;

if (refund.status === BUILDER_BOND_REFUND_REFUNDED_STATUS) {
throw buildBuilderBondRefundError({
message:
"This launch bond transaction has already been refunded and cannot be used to create a launch.",
code: "builder_bond_already_refunded",
statusCode: 409,
refund,
});
}

if (refund.status === BUILDER_BOND_REFUND_PROCESSING_STATUS) {
throw buildBuilderBondRefundError({
message:
"This launch bond refund is currently processing and cannot be used to create a launch.",
code: "builder_bond_refund_processing",
statusCode: 409,
refund,
});
}
}

async function claimBuilderBondRefundProcessing({
wallet,
builderBondSol,
bondTxSignature,
reasonCode = "wallet_intervention_active",
requestAction = "builder_bond_refund",
} = {}) {
await ensureBuilderBondRefundStorageAvailable();

const normalizedWallet = normalizeWallet(wallet);
const signature = cleanText(bondTxSignature, 140);
const normalizedBondSol = safeNumber(builderBondSol, 0);

if (!normalizedWallet || !signature || normalizedBondSol <= 0) {
throw buildBuilderBondRefundError({
message:
"Valid builder wallet, launch bond amount, and bond transaction signature are required.",
code: "invalid_builder_bond_refund_request",
statusCode: 400,
});
}

let existing = await getBuilderBondRefundBySignature(signature);

if (existing?.status === BUILDER_BOND_REFUND_REFUNDED_STATUS) {
return {
ledger: existing,
alreadyRefunded: true,
};
}

if (existing?.status === BUILDER_BOND_REFUND_PROCESSING_STATUS) {
throw buildBuilderBondRefundError({
message:
"This launch bond refund is already processing. Review its refund status before retrying.",
code: "builder_bond_refund_processing",
statusCode: 409,
refund: existing,
});
}

if (!existing) {
try {
const insert = await db.run(
`
INSERT INTO ${BUILDER_BOND_REFUND_TABLE} (
wallet,
bond_tx_signature,
bond_sol,
bond_lamports,
bond_escrow_address,
status,
reason_code,
request_action,
refund_attempts,
requested_at,
last_attempt_at,
created_at,
updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
`,
[
normalizedWallet,
signature,
normalizedBondSol,
solToLamports(normalizedBondSol),
getBuilderBondEscrowWallet(),
BUILDER_BOND_REFUND_PROCESSING_STATUS,
cleanText(reasonCode, 120) || "wallet_intervention_active",
cleanText(requestAction, 120) || "builder_bond_refund",
]
);

const created = await db.get(
`
SELECT *
FROM ${BUILDER_BOND_REFUND_TABLE}
WHERE id = ?
LIMIT 1
`,
[insert.lastID]
);

return {
ledger: normalizeBuilderBondRefundRow(created),
alreadyRefunded: false,
};
} catch (err) {
const message = String(err?.message || "").toLowerCase();

if (!message.includes("unique") && !message.includes("constraint")) {
throw err;
}

existing = await getBuilderBondRefundBySignature(signature);

if (existing?.status === BUILDER_BOND_REFUND_REFUNDED_STATUS) {
return {
ledger: existing,
alreadyRefunded: true,
};
}

throw buildBuilderBondRefundError({
message:
"This launch bond refund is already being handled. Review its refund status before retrying.",
code: "builder_bond_refund_processing",
statusCode: 409,
refund: existing,
});
}
}

await db.run(
`
UPDATE ${BUILDER_BOND_REFUND_TABLE}
SET
wallet = ?,
bond_sol = ?,
bond_lamports = ?,
bond_escrow_address = ?,
status = ?,
reason_code = ?,
request_action = ?,
refund_attempts = COALESCE(refund_attempts, 0) + 1,
last_attempt_at = CURRENT_TIMESTAMP,
last_error = NULL,
failed_at = NULL,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[
normalizedWallet,
normalizedBondSol,
solToLamports(normalizedBondSol),
getBuilderBondEscrowWallet(),
BUILDER_BOND_REFUND_PROCESSING_STATUS,
cleanText(reasonCode, 120) || "wallet_intervention_active",
cleanText(requestAction, 120) || "builder_bond_refund",
existing.id,
]
);

const refreshed = await db.get(
`
SELECT *
FROM ${BUILDER_BOND_REFUND_TABLE}
WHERE id = ?
LIMIT 1
`,
[existing.id]
);

return {
ledger: normalizeBuilderBondRefundRow(refreshed),
alreadyRefunded: false,
};
}

async function markBuilderBondRefundRefunded(
ledgerId,
{ refundTransfer = null } = {}
) {
if (!ledgerId) return null;

await db.run(
`
UPDATE ${BUILDER_BOND_REFUND_TABLE}
SET
status = ?,
refund_tx_signature = ?,
relayer_wallet = ?,
source_wallet = ?,
refunded_at = CURRENT_TIMESTAMP,
last_error = NULL,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[
BUILDER_BOND_REFUND_REFUNDED_STATUS,
cleanText(refundTransfer?.signature, 140) || null,
cleanText(refundTransfer?.feePayer, 120) || null,
cleanText(refundTransfer?.sourceWallet, 120) || null,
ledgerId,
]
);

const row = await db.get(
`
SELECT *
FROM ${BUILDER_BOND_REFUND_TABLE}
WHERE id = ?
LIMIT 1
`,
[ledgerId]
);

return normalizeBuilderBondRefundRow(row);
}

async function markBuilderBondRefundFailed(ledgerId, errorMessage = "") {
if (!ledgerId) return null;

await db.run(
`
UPDATE ${BUILDER_BOND_REFUND_TABLE}
SET
status = ?,
last_error = ?,
failed_at = CURRENT_TIMESTAMP,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[
BUILDER_BOND_REFUND_FAILED_STATUS,
cleanText(errorMessage, 500) || "builder bond refund failed",
ledgerId,
]
);

const row = await db.get(
`
SELECT *
FROM ${BUILDER_BOND_REFUND_TABLE}
WHERE id = ?
LIMIT 1
`,
[ledgerId]
);

return normalizeBuilderBondRefundRow(row);
}

async function getCommitRowsForLaunch(launchId) {
return db.all(
`
SELECT wallet, sol_amount, tx_signature, created_at
FROM commits
WHERE launch_id = ?
ORDER BY id DESC
`,
[launchId]
);
}

function buildCommitAggregates(rows = []) {
const map = new Map();

for (const row of Array.isArray(rows) ? rows : []) {
const wallet = normalizeWallet(row?.wallet);
if (!wallet) continue;

const key = normalizeWalletKey(wallet);
if (!map.has(key)) {
map.set(key, {
wallet,
commit_total_sol: 0,
commit_count: 0,
latest_commit_tx_signature: cleanText(row?.tx_signature, 140) || null,
last_commit_created_at: row?.created_at || null,
});
}

const entry = map.get(key);
entry.commit_total_sol = Number(
(entry.commit_total_sol + safeNumber(row?.sol_amount, 0)).toFixed(9)
);
entry.commit_count += 1;

if (!entry.latest_commit_tx_signature && row?.tx_signature) {
entry.latest_commit_tx_signature = cleanText(row.tx_signature, 140);
}

if (!entry.last_commit_created_at && row?.created_at) {
entry.last_commit_created_at = row.created_at;
}
}

return Array.from(map.values());
}

async function getLaunchCommitAggregates(launchId) {
const rows = await getCommitRowsForLaunch(launchId);
return buildCommitAggregates(rows);
}

async function getWalletCommitAggregate(launchId, wallet) {
const normalizedWallet = normalizeWallet(wallet);
if (!normalizedWallet) return null;

const rows = await db.all(
`
SELECT wallet, sol_amount, tx_signature, created_at
FROM commits
WHERE launch_id = ? AND wallet = ?
ORDER BY id DESC
`,
[launchId, normalizedWallet]
);

const aggregates = buildCommitAggregates(rows);
return aggregates[0] || null;
}

async function findLatestRefundLedgerEntry(launchId, wallet, { statuses = [] } = {}) {
if (!(await refundLedgerTableExists())) return null;

const normalizedWallet = normalizeWallet(wallet);
if (!launchId || !normalizedWallet) return null;

const requestedStatusList = Array.isArray(statuses)
? statuses.map((status) => cleanText(status, 80).toLowerCase()).filter(Boolean)
: [];

const expandedStatusSet = new Set(requestedStatusList);
if (expandedStatusSet.has(REFUND_LEDGER_PENDING_SHARED_STATUS)) {
expandedStatusSet.add(REFUND_LEDGER_PENDING_SHARED_LEGACY_STATUS);
}

const statusList = Array.from(expandedStatusSet);
const statusClause = statusList.length
? `AND LOWER(status) IN (${statusList.map(() => "?").join(", ")})`
: "";

const row = await db.get(
`
SELECT *
FROM launch_refund_ledger
WHERE launch_id = ?
AND LOWER(wallet) = LOWER(?)
${statusClause}
ORDER BY id DESC
LIMIT 1
`,
[launchId, normalizedWallet, ...statusList]
);

return normalizeRefundLedgerRow(row);
}

async function upsertRefundLedgerEntry({
launchId,
wallet,
status = "",
requestKind = REFUND_REQUEST_KIND_MANUAL,
reason = "",
escrowModel = "shared_wallet",
escrowAddress = "",
refundSol = 0,
commitTotalSol = 0,
commitCount = 0,
latestCommitTxSignature = "",
programInstructionRef = "",
}) {
if (!(await refundLedgerTableExists())) return null;

const normalizedWallet = normalizeWallet(wallet);
if (!launchId || !normalizedWallet) return null;

const normalizedStatus =
cleanText(status, 80).toLowerCase() ||
resolveRefundLedgerPendingStatus(escrowModel);

const normalizedEscrowModel = cleanText(escrowModel, 80).toLowerCase() || "shared_wallet";
const normalizedEscrowAddress = cleanText(escrowAddress, 120);
const normalizedReason = cleanText(reason, 500);
const normalizedRequestKind =
cleanText(requestKind, 80).toLowerCase() || REFUND_REQUEST_KIND_MANUAL;
const normalizedRefundSol = safeNumber(refundSol, safeNumber(commitTotalSol, 0));
const normalizedCommitTotalSol = safeNumber(commitTotalSol, normalizedRefundSol);
const normalizedCommitCount = Math.max(0, Math.floor(safeNumber(commitCount, 0)));
const normalizedLatestCommitTxSignature = cleanText(latestCommitTxSignature, 140);
const normalizedProgramInstructionRef =
cleanText(programInstructionRef, 160) ||
(normalizedEscrowModel === "launch_vault"
? buildRefundProgramReference(launchId, normalizedWallet)
: "");
const refundLamports = solToLamports(normalizedRefundSol);

const existingActive = await findLatestRefundLedgerEntry(launchId, normalizedWallet, {
statuses: [
REFUND_LEDGER_PENDING_SHARED_STATUS,
REFUND_LEDGER_PENDING_PROGRAM_STATUS,
REFUND_LEDGER_PROCESSING_STATUS,
],
});

if (existingActive?.id) {
await db.run(
`
UPDATE launch_refund_ledger
SET status = ?,
request_kind = ?,
refund_reason = ?,
escrow_model = ?,
escrow_address = ?,
refund_sol = ?,
refund_lamports = ?,
commit_total_sol = ?,
commit_count = ?,
latest_commit_tx_signature = COALESCE(?, latest_commit_tx_signature),
program_instruction_ref = COALESCE(program_instruction_ref, ?),
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[
normalizedStatus,
normalizedRequestKind,
normalizedReason,
normalizedEscrowModel,
normalizedEscrowAddress,
normalizedRefundSol,
refundLamports,
normalizedCommitTotalSol,
normalizedCommitCount,
normalizedLatestCommitTxSignature || null,
normalizedProgramInstructionRef || null,
existingActive.id,
]
);

const refreshed = await db.get(
`SELECT * FROM launch_refund_ledger WHERE id = ? LIMIT 1`,
[existingActive.id]
);

return normalizeRefundLedgerRow(refreshed);
}

const insert = await db.run(
`
INSERT INTO launch_refund_ledger (
launch_id,
wallet,
status,
request_kind,
refund_reason,
escrow_model,
escrow_address,
refund_sol,
refund_lamports,
commit_total_sol,
commit_count,
latest_commit_tx_signature,
program_instruction_ref,
requested_at,
created_at,
updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
`,
[
launchId,
normalizedWallet,
normalizedStatus,
normalizedRequestKind,
normalizedReason,
normalizedEscrowModel,
normalizedEscrowAddress,
normalizedRefundSol,
refundLamports,
normalizedCommitTotalSol,
normalizedCommitCount,
normalizedLatestCommitTxSignature || null,
normalizedProgramInstructionRef || null,
]
);

const row = await db.get(
`SELECT * FROM launch_refund_ledger WHERE id = ? LIMIT 1`,
[insert.lastID]
);

return normalizeRefundLedgerRow(row);
}

async function markRefundLedgerProcessing(ledgerId) {
if (!(await refundLedgerTableExists()) || !ledgerId) return null;

await db.run(
`
UPDATE launch_refund_ledger
SET status = ?,
refund_attempts = COALESCE(refund_attempts, 0) + 1,
last_attempt_at = CURRENT_TIMESTAMP,
last_error = NULL,
failed_at = NULL,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[REFUND_LEDGER_PROCESSING_STATUS, ledgerId]
);

const row = await db.get(
`SELECT * FROM launch_refund_ledger WHERE id = ? LIMIT 1`,
[ledgerId]
);

return normalizeRefundLedgerRow(row);
}

async function markRefundLedgerRefunded(ledgerId, { refundTransfer = null, refundSol = null } = {}) {
if (!(await refundLedgerTableExists()) || !ledgerId) return null;

const normalizedRefundSol = refundSol == null ? null : safeNumber(refundSol, 0);
const refundLamports =
normalizedRefundSol == null ? null : solToLamports(normalizedRefundSol);

await db.run(
`
UPDATE launch_refund_ledger
SET status = ?,
refund_tx_signature = ?,
relayer_wallet = ?,
source_wallet = ?,
refund_sol = COALESCE(?, refund_sol),
refund_lamports = COALESCE(?, refund_lamports),
refunded_at = CURRENT_TIMESTAMP,
last_error = NULL,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[
REFUND_LEDGER_REFUNDED_STATUS,
cleanText(refundTransfer?.signature, 140) || null,
cleanText(refundTransfer?.feePayer, 120) || null,
cleanText(refundTransfer?.sourceWallet, 120) || null,
normalizedRefundSol,
refundLamports,
ledgerId,
]
);

const row = await db.get(
`SELECT * FROM launch_refund_ledger WHERE id = ? LIMIT 1`,
[ledgerId]
);

return normalizeRefundLedgerRow(row);
}

async function markRefundLedgerFailed(ledgerId, errorMessage = "") {
if (!(await refundLedgerTableExists()) || !ledgerId) return null;

await db.run(
`
UPDATE launch_refund_ledger
SET status = ?,
last_error = ?,
failed_at = CURRENT_TIMESTAMP,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[
REFUND_LEDGER_FAILED_STATUS,
cleanText(errorMessage, 500) || "refund execution failed",
ledgerId,
]
);

const row = await db.get(
`SELECT * FROM launch_refund_ledger WHERE id = ? LIMIT 1`,
[ledgerId]
);

return normalizeRefundLedgerRow(row);
}

async function markRefundLedgerCancelled(ledgerId, reason = "") {
if (!(await refundLedgerTableExists()) || !ledgerId) return null;

await db.run(
`
UPDATE launch_refund_ledger
SET status = ?,
last_error = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[
REFUND_LEDGER_CANCELLED_STATUS,
cleanText(reason, 500) || "refund no longer required",
ledgerId,
]
);

const row = await db.get(
`SELECT * FROM launch_refund_ledger WHERE id = ? LIMIT 1`,
[ledgerId]
);

return normalizeRefundLedgerRow(row);
}

async function listRefundLedgerForLaunch(launchId) {
if (!(await refundLedgerTableExists())) return [];

const rows = await db.all(
`
SELECT *
FROM launch_refund_ledger
WHERE launch_id = ?
ORDER BY id DESC
`,
[launchId]
);

return rows.map((row) => normalizeRefundLedgerRow(row));
}

async function queueWalletRefundLedger({
launchId,
launch = null,
wallet,
solAmount = 0,
latestCommitTxSignature = "",
commitCount = 0,
requestKind = REFUND_REQUEST_KIND_MANUAL,
reason = "",
forcedStatus = "",
}) {
if (!(await refundLedgerTableExists())) return null;

const resolvedLaunch = launch || (await getLaunchById(launchId));
const launchEscrow = resolveLaunchCommitEscrow(resolvedLaunch);

const aggregate =
safeNumber(solAmount, 0) > 0 && safeNumber(commitCount, 0) > 0
? null
: await getWalletCommitAggregate(launchId, wallet);

const refundSol = safeNumber(solAmount, safeNumber(aggregate?.commit_total_sol, 0));
const normalizedCommitCount = Math.max(
0,
Math.floor(safeNumber(commitCount, safeNumber(aggregate?.commit_count, 0)))
);
const latestCommitSignature =
cleanText(latestCommitTxSignature, 140) ||
cleanText(aggregate?.latest_commit_tx_signature, 140);

if (refundSol <= 0) return null;

const status =
cleanText(forcedStatus, 80).toLowerCase() ||
resolveRefundLedgerPendingStatus(launchEscrow.model);

return upsertRefundLedgerEntry({
launchId,
wallet,
status,
requestKind,
reason,
escrowModel: launchEscrow.model,
escrowAddress: launchEscrow.address,
refundSol,
commitTotalSol: refundSol,
commitCount: normalizedCommitCount,
latestCommitTxSignature: latestCommitSignature,
programInstructionRef:
launchEscrow.model === "launch_vault"
? buildRefundProgramReference(launchId, wallet)
: "",
});
}

async function queueFailedLaunchRefundLedgerEntries(launchId) {
if (!(await refundLedgerTableExists())) return [];

const launch = await getLaunchById(launchId);
if (!launch) return [];

const aggregates = await getLaunchCommitAggregates(launchId);
const queued = [];

for (const aggregate of aggregates) {
if (safeNumber(aggregate?.commit_total_sol, 0) <= 0) continue;

const entry = await queueWalletRefundLedger({
launchId,
launch,
wallet: aggregate.wallet,
solAmount: aggregate.commit_total_sol,
latestCommitTxSignature: aggregate.latest_commit_tx_signature || "",
commitCount: aggregate.commit_count || 0,
requestKind: REFUND_REQUEST_KIND_AUTO_FAILED,
reason: "launch failed before live and refund is pending",
});

if (entry) {
queued.push(entry);
}
}

return queued;
}

async function safeQueueFailedLaunchRefunds(launchId) {
try {
return await queueFailedLaunchRefundLedgerEntries(launchId);
} catch (err) {
console.error(`Failed to queue refund ledger entries for launch ${launchId}:`, err);
return [];
}
}

function isDevnetEnvironment() {
const rpc = getRpcUrl().toLowerCase();
return rpc.includes("devnet");
}

function extractGraduationReadiness(lifecycle) {
return lifecycle?.graduationReadiness || null;
}

async function buildEscrowTransferTransaction({
wallet,
solAmount,
reference,
destinationWallet = "",
}) {
const escrowWallet = cleanText(destinationWallet, 120) || getEscrowWallet();

if (!isValidSolanaAddress(escrowWallet)) {
throw new Error("escrow destination is invalid");
}

const expectedLamports = solToLamports(solAmount);

const connection = new Connection(getRpcUrl(), "confirmed");
const fromPubkey = new PublicKey(wallet);
const escrowPubkey = new PublicKey(escrowWallet);

const transaction = new Transaction();

transaction.add(
SystemProgram.transfer({
fromPubkey,
toPubkey: escrowPubkey,
lamports: expectedLamports,
})
);

transaction.add(
new TransactionInstruction({
keys: [],
programId: MEMO_PROGRAM_ID,
data: Buffer.from(reference, "utf8"),
})
);

const { blockhash, lastValidBlockHeight } =
await connection.getLatestBlockhash("confirmed");

transaction.feePayer = fromPubkey;
transaction.recentBlockhash = blockhash;

const transactionBase64 = Buffer.from(
transaction.serialize({
requireAllSignatures: false,
verifySignatures: false,
})
).toString("base64");

return {
escrowWallet,
expectedLamports,
reference,
transaction: transactionBase64,
blockhash,
lastValidBlockHeight,
};
}

async function sendRefundTransfer({ launch = null, destinationWallet, solAmount }) {
const destination = String(destinationWallet || "").trim();
if (!isValidSolanaAddress(destination)) {
console.log("Skipping refund for non-wallet address:", destination);
return null;
}

const launchEscrow = resolveLaunchCommitEscrow(launch);

if (launchEscrow.model === "launch_vault") {
throw new Error(
"launch uses a program-controlled escrow vault and refund execution must be handled by the vault program route"
);
}

const rpcUrl = getRpcUrl();
const connection = new Connection(rpcUrl, "confirmed");
const escrowKeypair = getEscrowKeypair();
const relayerKeypair = getRelayerKeypair(escrowKeypair);

const configuredSourceWallet = escrowKeypair.publicKey.toBase58();
if (configuredSourceWallet !== launchEscrow.address) {
throw new Error(
"configured shared escrow signer does not match the launch commit escrow destination"
);
}

const lamports = solToLamports(solAmount);
if (!Number.isFinite(lamports) || lamports <= 0) {
throw new Error("invalid refund lamports");
}

const destinationPubkey = new PublicKey(destination);
const { blockhash, lastValidBlockHeight } =
await connection.getLatestBlockhash("confirmed");

const escrowBalance = await connection.getBalance(
escrowKeypair.publicKey,
"confirmed"
);

if (escrowBalance < lamports + REFUND_FEE_BUFFER_LAMPORTS) {
throw new Error(
`escrow wallet lacks fee reserve for full refund: balance=${escrowBalance}, refund=${lamports}`
);
}

const tx = new Transaction({
feePayer: relayerKeypair.publicKey,
recentBlockhash: blockhash,
}).add(
SystemProgram.transfer({
fromPubkey: escrowKeypair.publicKey,
toPubkey: destinationPubkey,
lamports,
})
);

const signers =
relayerKeypair.publicKey.toBase58() === escrowKeypair.publicKey.toBase58()
? [escrowKeypair]
: [relayerKeypair, escrowKeypair];

const signature = await connection.sendTransaction(tx, signers, {
skipPreflight: false,
preflightCommitment: "confirmed",
});

const confirmation = await connection.confirmTransaction(
{
signature,
blockhash,
lastValidBlockHeight,
},
"confirmed"
);

if (confirmation?.value?.err) {
throw new Error("refund transfer confirmation failed");
}

return {
signature,
refundedSol: solAmount,
refundedLamports: lamports,
feePayer: relayerKeypair.publicKey.toBase58(),
sourceWallet: escrowKeypair.publicKey.toBase58(),
};
}

async function sendBuilderBondRefundTransfer({
destinationWallet,
solAmount,
}) {
const destination = normalizeWallet(destinationWallet);

if (!isValidSolanaAddress(destination)) {
throw new Error("builder bond refund destination wallet is invalid");
}

const sourceAddress = getBuilderBondEscrowWallet();

if (!isValidSolanaAddress(sourceAddress)) {
throw new Error("builder bond escrow wallet is invalid");
}

const connection = new Connection(getRpcUrl(), "confirmed");
const sourceKeypair = getBuilderBondEscrowKeypair();
const relayerKeypair = getRelayerKeypair(sourceKeypair);

if (sourceKeypair.publicKey.toBase58() !== sourceAddress) {
throw new Error(
"configured builder bond escrow signer does not match BUILDER_BOND_ESCROW_WALLET"
);
}

const lamports = solToLamports(solAmount);
if (!Number.isFinite(lamports) || lamports <= 0) {
throw new Error("invalid builder bond refund amount");
}

const feePayerIsSource =
relayerKeypair.publicKey.toBase58() === sourceKeypair.publicKey.toBase58();

const sourceBalance = await connection.getBalance(
sourceKeypair.publicKey,
"confirmed"
);

const requiredSourceBalance =
lamports + (feePayerIsSource ? REFUND_FEE_BUFFER_LAMPORTS : 0);

if (sourceBalance < requiredSourceBalance) {
throw new Error(
`builder bond escrow lacks funds for full refund: balance=${sourceBalance}, refund=${lamports}`
);
}

const { blockhash, lastValidBlockHeight } =
await connection.getLatestBlockhash("confirmed");

const tx = new Transaction({
feePayer: relayerKeypair.publicKey,
recentBlockhash: blockhash,
}).add(
SystemProgram.transfer({
fromPubkey: sourceKeypair.publicKey,
toPubkey: new PublicKey(destination),
lamports,
})
);

const signers = feePayerIsSource
? [sourceKeypair]
: [relayerKeypair, sourceKeypair];

const signature = await connection.sendTransaction(tx, signers, {
skipPreflight: false,
preflightCommitment: "confirmed",
});

const confirmation = await connection.confirmTransaction(
{
signature,
blockhash,
lastValidBlockHeight,
},
"confirmed"
);

if (confirmation?.value?.err) {
throw new Error("builder bond refund transaction confirmation failed");
}

return {
signature,
refundedSol: Number(solAmount),
refundedLamports: lamports,
feePayer: relayerKeypair.publicKey.toBase58(),
sourceWallet: sourceKeypair.publicKey.toBase58(),
destinationWallet: destination,
};
}

async function executeBuilderBondRefundNow({
wallet,
builderBondSol,
bondTxSignature,
reasonCode = "wallet_intervention_active",
requestAction = "builder_bond_refund",
} = {}) {
const normalizedWallet = normalizeWallet(wallet);
const signature = cleanText(bondTxSignature, 140);
const lockKey = buildBuilderBondRefundLockKey(signature);

return runRefundExecutionLocked(lockKey, async () => {
const attachedLaunch = await db.get(
`
SELECT id
FROM launches
WHERE builder_bond_tx_signature = ?
LIMIT 1
`,
[signature]
);

if (attachedLaunch?.id) {
throw buildBuilderBondRefundError({
message:
"This launch bond has already been attached to a launch and cannot be refunded through the unused blocked-builder refund path.",
code: "builder_bond_attached_to_launch",
statusCode: 409,
});
}

const claimed = await claimBuilderBondRefundProcessing({
wallet: normalizedWallet,
builderBondSol,
bondTxSignature: signature,
reasonCode,
requestAction,
});

if (claimed.alreadyRefunded) {
return {
ledger: claimed.ledger,
refundTransfer: {
signature: claimed.ledger.refund_tx_signature || null,
refundedSol: claimed.ledger.bond_sol,
refundedLamports: claimed.ledger.bond_lamports,
feePayer: claimed.ledger.relayer_wallet || null,
sourceWallet: claimed.ledger.source_wallet || null,
destinationWallet: claimed.ledger.wallet,
},
alreadyRefunded: true,
};
}

let ledger = claimed.ledger;

try {
const refundTransfer = await sendBuilderBondRefundTransfer({
destinationWallet: normalizedWallet,
solAmount: builderBondSol,
});

ledger = await markBuilderBondRefundRefunded(ledger.id, {
refundTransfer,
});

return {
ledger,
refundTransfer,
alreadyRefunded: false,
};
} catch (err) {
if (ledger?.id) {
await markBuilderBondRefundFailed(
ledger.id,
err?.message || "builder bond refund failed"
);
}

throw err;
}
});
}

function buildBlockedBuilderBondRefundResponse({
intervention,
refundResult,
builderBondSol,
bondTxSignature,
} = {}) {
return {
ok: false,
error:
"This builder wallet is currently blocked from creating launches. The unused launch bond payment has been refunded.",
code: "launcher_wallet_intervention_active",
role: BUILDER_ACKNOWLEDGEMENT_ROLE,
internalInterventionActive: true,
interventionReasonCode: intervention?.reason_code || null,
acknowledgementModel: "acknowledgement_only",
identityVerificationRequired: false,
builderBondSol: Number(builderBondSol || 0),
launchBondSol: Number(builderBondSol || 0),
bondTxSignature: bondTxSignature || null,
refundStatus:
refundResult?.ledger?.status || BUILDER_BOND_REFUND_REFUNDED_STATUS,
refundTxSignature: refundResult?.refundTransfer?.signature || null,
refundedSol: Number(refundResult?.refundTransfer?.refundedSol || 0),
refundLedgerId: refundResult?.ledger?.id || null,
refundAlreadyCompleted: Boolean(refundResult?.alreadyRefunded),
};
}

function maybeSendBuilderBondRefundError(res, err) {
if (
!err ||
![
"builder_bond_refund_not_configured",
"builder_bond_refund_processing",
"builder_bond_already_refunded",
"builder_bond_attached_to_launch",
"invalid_builder_bond_refund_request",
].includes(err.code)
) {
return false;
}

res.status(Number(err.statusCode) || 409).json({
ok: false,
error: err.message || "Builder bond refund could not proceed.",
code: err.code,
builderBondRefund: err.builderBondRefund || null,
});

return true;
}

async function executeSharedWalletRefundNow({
launchId,
launch = null,
wallet,
solAmount,
txSignature = "",
requestKind = REFUND_REQUEST_KIND_MANUAL,
reason = "",
}) {
const lockKey = buildRefundExecutionLockKey(launchId, wallet);

return runRefundExecutionLocked(lockKey, async () => {
const resolvedLaunch = launch || (await getLaunchById(launchId));
let ledger = await queueWalletRefundLedger({
launchId,
launch: resolvedLaunch,
wallet,
solAmount,
latestCommitTxSignature: txSignature,
requestKind,
reason,
forcedStatus: REFUND_LEDGER_PROCESSING_STATUS,
});

try {
const refundTransfer = await sendRefundTransfer({
launch: resolvedLaunch,
destinationWallet: wallet,
solAmount,
});

if (ledger?.id) {
ledger = await markRefundLedgerRefunded(ledger.id, {
refundTransfer,
refundSol: solAmount,
});
}

return {
ledger,
refundTransfer,
};
} catch (err) {
if (ledger?.id) {
await markRefundLedgerFailed(
ledger.id,
err?.message || "refund transfer failed"
);
}
throw err;
}
});
}

async function processPendingSharedRefundLedgerEntry(entry) {
const normalizedEntry = normalizeRefundLedgerRow(entry);
if (!normalizedEntry?.id) return null;

const launch = await getLaunchById(normalizedEntry.launch_id);
if (!launch) {
await markRefundLedgerFailed(
normalizedEntry.id,
"launch not found for refund processing"
);
return null;
}

const aggregate = await getWalletCommitAggregate(
normalizedEntry.launch_id,
normalizedEntry.wallet
);

if (!aggregate || safeNumber(aggregate.commit_total_sol, 0) <= 0) {
await markRefundLedgerCancelled(
normalizedEntry.id,
"no remaining wallet commits to refund"
);
return null;
}

const refundSol = safeNumber(
aggregate.commit_total_sol,
normalizedEntry.refund_sol
);

try {
const { refundTransfer } = await executeSharedWalletRefundNow({
launchId: normalizedEntry.launch_id,
launch,
wallet: normalizedEntry.wallet,
solAmount: refundSol,
txSignature: normalizedEntry.latest_commit_tx_signature || "",
requestKind:
normalizedEntry.request_kind || REFUND_REQUEST_KIND_AUTO_FAILED,
reason:
normalizedEntry.refund_reason || "automatic failed-launch refund",
});

await db.run(
`
DELETE FROM commits
WHERE launch_id = ? AND wallet = ?
`,
[normalizedEntry.launch_id, normalizedEntry.wallet]
);

const stats = await syncLaunchStats(normalizedEntry.launch_id);
const refreshedLaunch = await getLaunchById(normalizedEntry.launch_id);

if (
refreshedLaunch &&
refreshedLaunch.status === "failed" &&
Number(stats.totalCommitted || 0) <= 0
) {
await maybeMarkLaunchFailedRefunded(normalizedEntry.launch_id);
}

return refundTransfer;
} catch {
return null;
}
}

async function processPendingSharedRefundLedgers(limit = REFUND_WORKER_BATCH_SIZE) {
if (!(await refundLedgerTableExists())) return;

const rows = await db.all(
`
SELECT *
FROM launch_refund_ledger
WHERE LOWER(status) IN (?, ?)
ORDER BY id ASC
LIMIT ?
`,
[
REFUND_LEDGER_PENDING_SHARED_STATUS,
REFUND_LEDGER_PENDING_SHARED_LEGACY_STATUS,
limit,
]
);

for (const row of rows) {
try {
await processPendingSharedRefundLedgerEntry(row);
} catch (err) {
console.error(`Refund ledger worker failed for ledger ${row?.id}:`, err);
}
}
}

async function refundLedgerWorkerTick() {
try {
await processPendingSharedRefundLedgers();
} catch (err) {
console.error("Refund ledger worker tick failed:", err);
}
}

async function refundRejectedCommit({
launchId,
launch = null,
wallet,
solAmount,
txSignature,
reason,
status = "",
logLabel = "Late confirm refund failed",
}) {
const resolvedLaunchId = Number(launch?.id || launchId || 0);
const launchEscrow = resolveLaunchCommitEscrow(launch);

if (launchEscrow.model === "launch_vault") {
const ledger = await queueWalletRefundLedger({
launchId: resolvedLaunchId,
launch,
wallet,
solAmount,
latestCommitTxSignature: txSignature,
requestKind: REFUND_REQUEST_KIND_LATE_REJECTED,
reason: reason || "late rejected commit refund pending",
forcedStatus: REFUND_LEDGER_PENDING_PROGRAM_STATUS,
});

return {
httpStatus: 409,
body: {
ok: false,
error: reason || "commit could not be accepted and refund is queued",
status: status || null,
txSignature: txSignature || null,
refundedSol: 0,
refundTxSignature: null,
refundQueued: true,
refundStatus: ledger?.status || REFUND_LEDGER_PENDING_PROGRAM_STATUS,
refundLedgerId: ledger?.id || null,
refundProgramReference: ledger?.program_instruction_ref || null,
escrowModel: launchEscrow.model,
escrowAddress: launchEscrow.address,
},
};
}

try {
const { ledger, refundTransfer } = await executeSharedWalletRefundNow({
launchId: resolvedLaunchId,
launch,
wallet,
solAmount,
txSignature,
requestKind: REFUND_REQUEST_KIND_LATE_REJECTED,
reason: reason || "late rejected commit refund",
});

return {
httpStatus: 409,
body: {
ok: false,
error: reason || "commit could not be accepted and was refunded",
status: status || null,
txSignature: txSignature || null,
refundedSol: refundTransfer?.refundedSol || solAmount,
refundTxSignature: refundTransfer?.signature || null,
refundQueued: false,
refundStatus: ledger?.status || REFUND_LEDGER_REFUNDED_STATUS,
refundLedgerId: ledger?.id || null,
},
};
} catch (refundErr) {
console.error(`${logLabel}:`, refundErr);

return {
httpStatus: 409,
body: {
ok: false,
error: reason || "commit could not be accepted after transfer verification",
status: status || null,
txSignature: txSignature || null,
refundedSol: 0,
refundTxSignature: null,
refundQueued: false,
refundError: refundErr?.message || "refund transfer failed",
},
};
}
}

async function getLaunchById(launchId) {
return db.get(`SELECT * FROM launches WHERE id = ?`, [launchId]);
}

async function getLaunchWithBuilderById(launchId) {
return db.get(
`
SELECT
l.*,
b.wallet AS builder_wallet,
b.alias AS builder_alias,
b.builder_score
FROM launches l
LEFT JOIN builders b
ON b.id = l.builder_id
WHERE l.id = ?
LIMIT 1
`,
[launchId]
);
}

async function getBuilderByWallet(wallet) {
return db.get(
`SELECT id, wallet, alias FROM builders WHERE wallet = ?`,
[wallet]
);
}

async function getBuilderByAlias(alias) {
return db.get(
`
SELECT id, wallet, alias
FROM builders
WHERE LOWER(alias) = LOWER(?)
LIMIT 1
`,
[alias]
);
}

function buildDefaultBuilderAlias(wallet) {
const cleanWallet = normalizeWallet(wallet);
if (!cleanWallet) return "New Builder";

const first = cleanWallet.slice(0, 4);
const last = cleanWallet.slice(-4);

return cleanText(`Builder ${first}${last}`, 60) || "New Builder";
}

function buildBuilderAliasVariant(baseAlias, suffix) {
if (!suffix || suffix <= 1) {
return cleanText(baseAlias, 60);
}

const suffixText = ` ${suffix}`;
const trimmedBase = cleanText(
String(baseAlias || "").slice(0, Math.max(1, 60 - suffixText.length)),
60 - suffixText.length
);

return cleanText(`${trimmedBase}${suffixText}`, 60);
}

async function ensureBuilderProfileForWallet(wallet) {
const cleanWallet = normalizeWallet(wallet);
if (!cleanWallet) {
throw new Error("wallet is required");
}

const existing = await getBuilderByWallet(cleanWallet);
if (existing) {
return existing;
}

const baseAlias = buildDefaultBuilderAlias(cleanWallet);

for (let suffix = 1; suffix <= 500; suffix += 1) {
const alias = buildBuilderAliasVariant(baseAlias, suffix);
const aliasOwner = await getBuilderByAlias(alias);

if (
aliasOwner &&
normalizeWalletKey(aliasOwner.wallet) !== normalizeWalletKey(cleanWallet)
) {
continue;
}

try {
const insert = await db.run(
`
INSERT INTO builders (
wallet,
alias,
builder_score
) VALUES (?, ?, ?)
`,
[cleanWallet, alias, 50]
);

const created = await db.get(
`SELECT id, wallet, alias FROM builders WHERE id = ? LIMIT 1`,
[insert.lastID]
);

if (created) {
return created;
}
} catch (err) {
const msg = String(err?.message || "").toLowerCase();

if (
msg.includes("unique") ||
msg.includes("constraint") ||
msg.includes("already exists")
) {
const recovered = await getBuilderByWallet(cleanWallet);
if (recovered) {
return recovered;
}
continue;
}

throw err;
}
}

const recovered = await getBuilderByWallet(cleanWallet);
if (recovered) {
return recovered;
}

throw new Error("builder profile could not be created automatically");
}

async function getBuilderWalletForLaunch(launchId) {
return db.get(
`
SELECT b.wallet
FROM launches l
JOIN builders b ON b.id = l.builder_id
WHERE l.id = ?
`,
[launchId]
);
}

async function getCommitStats(launchId) {
const totalRow = await db.get(
`
SELECT COALESCE(SUM(sol_amount), 0) AS total
FROM commits
WHERE launch_id = ?
`,
[launchId]
);

const participantsRow = await db.get(
`
SELECT COUNT(DISTINCT wallet) AS wallets
FROM commits
WHERE launch_id = ?
`,
[launchId]
);

return {
totalCommitted: Number(totalRow?.total || 0),
participants: Number(participantsRow?.wallets || 0),
};
}

async function syncLaunchStats(launchId) {
const stats = await getCommitStats(launchId);

await db.run(
`
UPDATE launches
SET committed_sol = ?,
participants_count = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[stats.totalCommitted, stats.participants, launchId]
);

return stats;
}

async function safeSyncLifecycle(launchId) {
try {
return await syncLiquidityLifecycle(launchId);
} catch (err) {
console.warn(`Lifecycle sync skipped for launch ${launchId}:`, err?.message || err);
return null;
}
}

async function safeGetLifecycle(launchId) {
try {
return await getLiquidityLifecycle(launchId);
} catch {
return null;
}
}

async function safeGetGraduationPlan(launchId) {
try {
return await buildGraduationPlanForLaunch(launchId);
} catch {
return null;
}
}

async function forceLaunchStatus(launchId, status) {
await db.run(
`
UPDATE launches
SET status = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[status, launchId]
);

return getLaunchById(launchId);
}

async function normalizeLifecycleState(launchId) {
let launch = await getLaunchById(launchId);
if (!launch) return null;

const storedStatus = cleanText(launch.status, 40).toLowerCase();
const canonicalStatus = computeCanonicalLaunchStatus(launch);

if (
canonicalStatus &&
canonicalStatus !== storedStatus &&
[
"commit",
"countdown",
"building",
"live",
"graduated",
"failed",
"failed_refunded",
].includes(canonicalStatus)
) {
launch = await forceLaunchStatus(launchId, canonicalStatus);
}

return applyCanonicalLaunchTruth(launch);
}

async function beginCountdown(launchId) {
const launch = await getLaunchById(launchId);
if (!launch) return null;

if (!isBuilderBondSatisfied(launch)) {
throw new Error("launch bond not satisfied");
}

if (launch.status === "countdown") {
return applyCanonicalLaunchTruth(launch);
}

if (launch.status === "building") {
return applyCanonicalLaunchTruth(launch);
}

if (launch.status === "live" || launch.status === "graduated") {
return applyCanonicalLaunchTruth(launch);
}

await db.run(
`
UPDATE launches
SET status = 'countdown',
countdown_started_at = CURRENT_TIMESTAMP,
countdown_ends_at = datetime(CURRENT_TIMESTAMP, '+${COUNTDOWN_MINUTES} minutes'),
live_at = datetime(CURRENT_TIMESTAMP, '+${COUNTDOWN_MINUTES} minutes'),
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launchId]
);

return applyCanonicalLaunchTruth(await getLaunchById(launchId));
}

async function markLaunchFailed(launchId) {
await db.run(
`
UPDATE launches
SET status = 'failed',
failed_at = CURRENT_TIMESTAMP,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launchId]
);

await safeQueueFailedLaunchRefunds(launchId);

return applyCanonicalLaunchTruth(await getLaunchById(launchId));
}

async function maybeMarkLaunchFailedRefunded(launchId) {
const stats = await getCommitStats(launchId);

if (Number(stats.totalCommitted || 0) > 0) {
return applyCanonicalLaunchTruth(await getLaunchById(launchId));
}

await db.run(
`
UPDATE launches
SET status = 'failed_refunded',
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launchId]
);

return applyCanonicalLaunchTruth(await getLaunchById(launchId));
}

async function runFinalizeLaunchOnce(launchId) {
if (finalizeLocks.has(launchId)) {
return finalizeLocks.get(launchId);
}

const promise = (async () => {
const launch = await getLaunchById(launchId);
if (!launch) {
return { ok: false, reason: "launch not found" };
}

const status = cleanText(launch.status, 40).toLowerCase();
if (status === "live" || status === "graduated") {
return { ok: true, skipped: true, reason: "already live" };
}

try {
const result = await finalizeLaunch(launchId);
return result || { ok: false, reason: "unknown finalize result" };
} catch (err) {
if (isTransientFinalizeError(err)) {
console.warn(
`Finalize retry deferred for launch ${launchId}:`,
err?.message || err
);
return { ok: false, reason: "transient finalize error", transient: true };
}
throw err;
}
})();

finalizeLocks.set(launchId, promise);

try {
return await promise;
} finally {
finalizeLocks.delete(launchId);
}
}

async function finalizeLaunchIfReady(launchId) {
let launch = await getLaunchById(launchId);
if (!launch) return null;

const canonicalStatus = computeCanonicalLaunchStatus(launch);
if (!["countdown", "building"].includes(canonicalStatus)) {
return applyCanonicalLaunchTruth(launch);
}

if (canonicalStatus === "countdown") {
const countdownCheck = await db.get(
`
SELECT CASE
WHEN countdown_ends_at IS NOT NULL AND datetime('now') >= datetime(countdown_ends_at)
THEN 1 ELSE 0
END AS ready
FROM launches
WHERE id = ?
`,
[launchId]
);

if (!countdownCheck || Number(countdownCheck.ready) !== 1) {
return applyCanonicalLaunchTruth(launch);
}
}

const latestBeforeFinalize = await getLaunchById(launchId);
if (!latestBeforeFinalize) return null;

if (
latestBeforeFinalize.status === "live" ||
latestBeforeFinalize.status === "graduated"
) {
await safeSyncLifecycle(launchId);
return applyCanonicalLaunchTruth(latestBeforeFinalize);
}

const result = await runFinalizeLaunchOnce(launchId);
const latest = await getLaunchById(launchId);

if (!latest) return null;

const latestCanonical = computeCanonicalLaunchStatus(latest);

if (latestCanonical === "live" || latestCanonical === "graduated") {
await safeSyncLifecycle(launchId);
return applyCanonicalLaunchTruth(latest);
}

if (result?.ok && (result?.stage === "building" || latestCanonical === "building")) {
await safeSyncLifecycle(launchId);
return applyCanonicalLaunchTruth(latest);
}

if (result?.ok) {
await safeSyncLifecycle(launchId);
return applyCanonicalLaunchTruth(latest);
}

if (result?.reason === "countdown not finished" || result?.transient) {
return applyCanonicalLaunchTruth(latest);
}

if (
result?.reason === "minimum raise not met" ||
result?.reason === "launch bond not paid" ||
result?.reason === "builder bond not paid"
) {
await markLaunchFailed(launchId);
return applyCanonicalLaunchTruth(await getLaunchById(launchId));
}

if (result?.stage === "building" || latestCanonical === "building") {
await safeSyncLifecycle(launchId);
return applyCanonicalLaunchTruth(latest);
}

if (result?.reason) {
console.warn(`Launch ${launchId} finalize returned: ${result.reason}`);
}

return applyCanonicalLaunchTruth(latest);
}

async function reconcileLaunchStateInternal(launchId) {
let launch = await getLaunchById(launchId);
if (!launch) return null;

launch = await normalizeLifecycleState(launchId);
if (!launch) return null;

if (
["commit", "countdown", "building"].includes(String(launch.status || "")) &&
requiresBuilderBond(launch) &&
!isBuilderBondSatisfied(launch)
) {
await markLaunchFailed(launchId);
return applyCanonicalLaunchTruth(await getLaunchById(launchId));
}

if (launch.status === "commit") {
const stats = await syncLaunchStats(launchId);
launch = applyCanonicalLaunchTruth(await getLaunchById(launchId));

const minRaise = Number(launch.min_raise_sol || 0);
const hardCap = Number(launch.hard_cap_sol || 0);

const commitExpiredCheck = await db.get(
`
SELECT CASE
WHEN commit_ends_at IS NOT NULL AND datetime('now') >= datetime(commit_ends_at)
THEN 1 ELSE 0
END AS expired
FROM launches
WHERE id = ?
`,
[launchId]
);

const commitExpired = Number(commitExpiredCheck?.expired || 0) === 1;

if (Number(stats.totalCommitted) >= hardCap && hardCap > 0) {
return beginCountdown(launchId);
}

if (commitExpired) {
if (Number(stats.totalCommitted) >= minRaise && minRaise > 0) {
return beginCountdown(launchId);
}

await markLaunchFailed(launchId);
return applyCanonicalLaunchTruth(await getLaunchById(launchId));
}

return launch;
}

if (launch.status === "countdown" || launch.status === "building") {
return finalizeLaunchIfReady(launchId);
}

if (launch.status === "live" || launch.status === "graduated") {
await safeSyncLifecycle(launchId);
return applyCanonicalLaunchTruth(launch);
}

if (launch.status === "failed" || launch.status === "failed_refunded") {
return applyCanonicalLaunchTruth(launch);
}

return applyCanonicalLaunchTruth(launch);
}

export async function reconcileLaunchState(launchId) {
if (reconcileLocks.has(launchId)) {
return reconcileLocks.get(launchId);
}

const promise = (async () => {
return reconcileLaunchStateInternal(launchId);
})();

reconcileLocks.set(launchId, promise);

try {
return await promise;
} finally {
reconcileLocks.delete(launchId);
}
}

async function reconcileActiveLaunchesWorker() {
try {
const rows = await db.all(
`
SELECT id
FROM launches
WHERE status IN ('commit', 'countdown', 'building', 'live', 'graduated')
ORDER BY id ASC
`
);

for (const row of rows) {
try {
await reconcileLaunchState(Number(row.id));
} catch (err) {
console.error(`Launch reconcile worker failed for launch ${row.id}:`, err);
}
}
} catch (err) {
console.error("Launch reconcile worker tick failed:", err);
}
}

function startLaunchReconcileWorker() {
if (globalThis.__mssLaunchReconcileWorkerStarted) return;
globalThis.__mssLaunchReconcileWorkerStarted = true;

setTimeout(() => {
void reconcileActiveLaunchesWorker();
void refundLedgerWorkerTick();
void topUpMintReservationPool({
requiredTag: REQUIRED_MINT_TAG,
targetSize: 10,
batchSize: 2,
maxAttempts: RESERVED_MINT_MAX_ATTEMPTS,
}).catch((err) => {
console.error("Initial mint pool warmup failed:", err);
});
}, 3000);

setInterval(() => {
void reconcileActiveLaunchesWorker();
void refundLedgerWorkerTick();
}, RECONCILE_INTERVAL_MS);
}

router.get("/acknowledgements/status", async (req, res) => {
try {
const wallet = normalizeWallet(req.query.wallet);
const role = normalizeAcknowledgementRole(req.query.role);
const launchIdRaw = cleanText(req.query.launchId ?? req.query.launch_id, 40);
const launchId = launchIdRaw ? Number(launchIdRaw) : null;

if (!wallet || !role) {
return res.status(400).json({
ok: false,
error: "wallet and valid role are required",
});
}

if (launchIdRaw && (!Number.isFinite(launchId) || launchId <= 0)) {
return res.status(400).json({
ok: false,
error: "launchId must be valid when supplied",
});
}

const acknowledgement = await findLauncherAcknowledgement({
wallet,
role,
launchId,
});

return res.json({
ok: true,
wallet,
role,
launchId,
acknowledgement,
accepted: isAcknowledgementSatisfied(acknowledgement, role),
requiredAcknowledgements: buildAcknowledgementRequirements(role).map(
(item) => item.key
),
versions: LAUNCH_ACKNOWLEDGEMENT_VERSIONS,
model: "acknowledgement_only",
identityVerificationRequired: false,
});
} catch (err) {
if (maybeSendAcknowledgementError(res, err)) {
return;
}

console.error("GET /api/launcher/acknowledgements/status failed:", err);
return res.status(500).json({
ok: false,
error: err.message || "failed to fetch launcher acknowledgement status",
});
}
});

router.post("/acknowledgements", async (req, res) => {
try {
const wallet = normalizeWallet(req.body.wallet);
const role = normalizeAcknowledgementRole(req.body.role);
const launchIdRaw = cleanText(req.body.launchId ?? req.body.launch_id, 40);
const launchId = launchIdRaw ? Number(launchIdRaw) : null;

if (!wallet || !role) {
return res.status(400).json({
ok: false,
error: "wallet and valid role are required",
});
}

if (launchIdRaw && (!Number.isFinite(launchId) || launchId <= 0)) {
return res.status(400).json({
ok: false,
error: "launchId must be valid when supplied",
});
}

const acknowledgement = await saveLauncherAcknowledgement({
wallet,
role,
launchId,
body: req.body,
action: cleanText(req.body.action, 80) || "acknowledge",
});

return res.json({
ok: true,
wallet,
role,
launchId,
acknowledgement,
accepted: true,
requiredAcknowledgements: buildAcknowledgementRequirements(role).map(
(item) => item.key
),
versions: LAUNCH_ACKNOWLEDGEMENT_VERSIONS,
model: "acknowledgement_only",
identityVerificationRequired: false,
});
} catch (err) {
if (maybeSendAcknowledgementError(res, err)) {
return;
}

console.error("POST /api/launcher/acknowledgements failed:", err);
return res.status(500).json({
ok: false,
error: err.message || "failed to save launcher acknowledgements",
});
}
});

router.get("/builder-bond-refunds/status", async (req, res) => {
try {
const wallet = normalizeWallet(req.query.wallet);
const bondTxSignature = cleanText(
req.query.txSignature ?? req.query.bond_tx_signature,
140
);

if (!wallet || !bondTxSignature) {
return res.status(400).json({
ok: false,
error: "wallet and bond transaction signature are required",
});
}

const refund = await getBuilderBondRefundBySignature(bondTxSignature);

if (
!refund ||
normalizeWalletKey(refund.wallet) !== normalizeWalletKey(wallet)
) {
return res.status(404).json({
ok: false,
error: "builder bond refund record not found",
});
}

return res.json({
ok: true,
refund,
});
} catch (err) {
if (maybeSendBuilderBondRefundError(res, err)) {
return;
}

console.error("GET /api/launcher/builder-bond-refunds/status failed:", err);
return res.status(500).json({
ok: false,
error: err.message || "failed to load builder bond refund status",
});
}
});

router.post("/builder-bond-refunds/retry", async (req, res) => {
try {
const wallet = normalizeWallet(req.body.wallet);
const builderBondSol = Number(
req.body.builderBondSol ??
req.body.builder_bond_sol ??
req.body.launchBondSol ??
req.body.launch_bond_sol
);
const bondTxSignature = cleanText(
req.body.txSignature ??
req.body.tx_signature ??
req.body.bondTxSignature ??
req.body.bond_tx_signature,
140
);

if (!wallet || !Number.isFinite(builderBondSol) || !bondTxSignature) {
return res.status(400).json({
ok: false,
error: "wallet, launch bond amount, and bond transaction signature are required",
});
}

if (
builderBondSol < MIN_LAUNCH_BOND_SOL ||
builderBondSol > MAX_LAUNCH_BOND_SOL
) {
return res.status(400).json({
ok: false,
error: `launch bond must be between ${MIN_LAUNCH_BOND_SOL} and ${MAX_LAUNCH_BOND_SOL} SOL`,
});
}

const intervention = await getInternalWalletIntervention(wallet);

if (!intervention.blocked) {
return res.status(403).json({
ok: false,
error:
"This refund endpoint is reserved for unused launch bonds belonging to internally blocked builder wallets.",
code: "blocked_builder_refund_not_available",
});
}

await verifyCommitTransfer({
txSignature: bondTxSignature,
expectedSender: wallet,
expectedDestination: getBuilderBondEscrowWallet(),
expectedLamports: solToLamports(builderBondSol),
reference: buildLaunchBondReference(wallet),
});

const refundResult = await executeBuilderBondRefundNow({
wallet,
builderBondSol,
bondTxSignature,
reasonCode: intervention.reason_code || "wallet_intervention_active",
requestAction: "retry_blocked_builder_bond_refund",
});

return res.json({
ok: true,
message: "Unused blocked-builder launch bond refunded.",
refund: refundResult.ledger,
refundTxSignature: refundResult.refundTransfer?.signature || null,
refundedSol: refundResult.refundTransfer?.refundedSol || 0,
refundAlreadyCompleted: Boolean(refundResult.alreadyRefunded),
});
} catch (err) {
if (maybeSendBuilderBondRefundError(res, err)) {
return;
}

console.error("POST /api/launcher/builder-bond-refunds/retry failed:", err);
return res.status(500).json({
ok: false,
error: err.message || "failed to retry builder bond refund",
});
}
});

router.post("/prepare-builder-bond", async (req, res) => {
try {
const wallet = cleanText(req.body.wallet, 100);
const builderBondSol = Number(
req.body.builderBondSol ??
req.body.builder_bond_sol ??
req.body.launchBondSol ??
req.body.launch_bond_sol
);

if (!wallet || !Number.isFinite(builderBondSol)) {
return res.status(400).json({ ok: false, error: "missing or invalid fields" });
}

if (
builderBondSol < MIN_LAUNCH_BOND_SOL ||
builderBondSol > MAX_LAUNCH_BOND_SOL
) {
return res.status(400).json({
ok: false,
error: `launch bond must be between ${MIN_LAUNCH_BOND_SOL} and ${MAX_LAUNCH_BOND_SOL} SOL`,
});
}

await requireNoInternalWalletIntervention({
wallet,
role: BUILDER_ACKNOWLEDGEMENT_ROLE,
action: "prepare_builder_bond",
});

const acknowledgement = await saveLauncherAcknowledgement({
wallet,
role: BUILDER_ACKNOWLEDGEMENT_ROLE,
launchId: null,
body: req.body,
action: "prepare_builder_bond",
signatureMessage: buildLaunchBondReference(wallet),
});

const prepared = await buildEscrowTransferTransaction({
wallet,
solAmount: builderBondSol,
reference: buildLaunchBondReference(wallet),
destinationWallet: getBuilderBondEscrowWallet(),
});

return res.json({
ok: true,
wallet,
builderBondSol,
launchBondSol: builderBondSol,
acknowledgement,
acknowledgementModel: "acknowledgement_only",
identityVerificationRequired: false,
...prepared,
});
} catch (err) {
if (maybeSendInternalWalletInterventionError(res, err)) {
return;
}

if (maybeSendAcknowledgementError(res, err)) {
return;
}

console.error("POST /api/launcher/prepare-builder-bond failed:", err);
return res.status(500).json({
ok: false,
error: err.message || "failed to prepare launch bond",
});
}
});

router.post("/confirm-builder-bond", async (req, res) => {
try {
const wallet = cleanText(req.body.wallet, 100);
const builderBondSol = Number(
req.body.builderBondSol ??
req.body.builder_bond_sol ??
req.body.launchBondSol ??
req.body.launch_bond_sol
);
const txSignatureInput = cleanText(req.body.txSignature, 140);
const signedTransactionBase64 = cleanText(
req.body.signedTransaction ?? req.body.signedBase64 ?? req.body.signedTx,
50000
);

if (
!wallet ||
!Number.isFinite(builderBondSol) ||
(!txSignatureInput && !signedTransactionBase64)
) {
return res.status(400).json({ ok: false, error: "missing or invalid fields" });
}

if (
builderBondSol < MIN_LAUNCH_BOND_SOL ||
builderBondSol > MAX_LAUNCH_BOND_SOL
) {
return res.status(400).json({
ok: false,
error: `launch bond must be between ${MIN_LAUNCH_BOND_SOL} and ${MAX_LAUNCH_BOND_SOL} SOL`,
});
}

const transactionAlreadySubmittedByWallet = Boolean(txSignatureInput);
let acknowledgement = null;

if (!transactionAlreadySubmittedByWallet) {
await requireNoInternalWalletIntervention({
wallet,
role: BUILDER_ACKNOWLEDGEMENT_ROLE,
action: "confirm_builder_bond",
});

acknowledgement = await ensureLauncherAcknowledgementForAction({
wallet,
role: BUILDER_ACKNOWLEDGEMENT_ROLE,
launchId: null,
body: req.body,
action: "confirm_builder_bond",
signatureMessage: buildLaunchBondReference(wallet),
});
}

let txSignature = txSignatureInput;

if (!txSignature) {
const connection = new Connection(getRpcUrl(), "confirmed");
const rawSignedTx = Buffer.from(signedTransactionBase64, "base64");

try {
const decodedTx = Transaction.from(rawSignedTx);
const sigBuf = decodedTx.signatures?.[0]?.signature;
if (sigBuf) {
txSignature = bs58.encode(sigBuf);
}
} catch {}

try {
txSignature = await connection.sendRawTransaction(rawSignedTx, {
skipPreflight: false,
preflightCommitment: "confirmed",
});
} catch (sendErr) {
if (isLikelyBlockhashExpiredError(sendErr)) {
return res.status(409).json({
ok: false,
error: "launch bond approval expired. please prepare and approve the launch bond again",
});
}
throw sendErr;
}

const confirmation = await connection.confirmTransaction(txSignature, "confirmed");
if (confirmation?.value?.err) {
throw new Error("signed launch bond transaction confirmation failed");
}
}

const existingLaunch = await db.get(
`SELECT id FROM launches WHERE builder_bond_tx_signature = ? LIMIT 1`,
[txSignature]
);

if (existingLaunch) {
return res.status(400).json({
ok: false,
error: "launch bond transaction already attached to another launch",
});
}

await verifyCommitTransfer({
txSignature,
expectedSender: wallet,
expectedDestination: getBuilderBondEscrowWallet(),
expectedLamports: solToLamports(builderBondSol),
reference: buildLaunchBondReference(wallet),
});

const intervention = await getInternalWalletIntervention(wallet);

if (intervention.blocked) {
const refundResult = await executeBuilderBondRefundNow({
wallet,
builderBondSol,
bondTxSignature: txSignature,
reasonCode: intervention.reason_code || "wallet_intervention_active",
requestAction: "confirm_builder_bond_blocked",
});

return res.status(409).json(
buildBlockedBuilderBondRefundResponse({
intervention,
refundResult,
builderBondSol,
bondTxSignature: txSignature,
})
);
}

await assertBuilderBondTransactionUsable(txSignature);

try {
acknowledgement = await ensureLauncherAcknowledgementForAction({
wallet,
role: BUILDER_ACKNOWLEDGEMENT_ROLE,
launchId: null,
body: req.body,
action: "confirm_builder_bond",
signatureMessage: buildLaunchBondReference(wallet),
});
} catch (acknowledgementErr) {
if (
acknowledgementErr?.code === "launcher_acknowledgements_required" ||
acknowledgementErr?.code === "launcher_acknowledgements_not_configured"
) {
const refundResult = await executeBuilderBondRefundNow({
wallet,
builderBondSol,
bondTxSignature: txSignature,
reasonCode: "builder_acknowledgements_missing",
requestAction: "confirm_builder_bond_acknowledgement_refund",
});

return res.status(409).json({
ok: false,
error:
"Required builder acknowledgements were not completed before the launch bond payment. The unused launch bond has been refunded.",
code: acknowledgementErr.code,
role: BUILDER_ACKNOWLEDGEMENT_ROLE,
requiredAcknowledgements:
acknowledgementErr.requiredAcknowledgements || [],
missingAcknowledgements:
acknowledgementErr.missingAcknowledgements || [],
versions: LAUNCH_ACKNOWLEDGEMENT_VERSIONS,
acknowledgementModel: "acknowledgement_only",
identityVerificationRequired: false,
refundStatus:
refundResult?.ledger?.status || BUILDER_BOND_REFUND_REFUNDED_STATUS,
refundTxSignature: refundResult?.refundTransfer?.signature || null,
refundedSol: Number(refundResult?.refundTransfer?.refundedSol || 0),
refundLedgerId: refundResult?.ledger?.id || null,
});
}

throw acknowledgementErr;
}

acknowledgement = await attachLauncherAcknowledgementSignature({
wallet,
role: BUILDER_ACKNOWLEDGEMENT_ROLE,
launchId: null,
action: "confirm_builder_bond",
signatureReference: txSignature,
signatureMessage: buildLaunchBondReference(wallet),
});

return res.json({
ok: true,
wallet,
builderBondSol,
launchBondSol: builderBondSol,
txSignature,
builderBondPaid: 1,
launchBondPaid: 1,
acknowledgement,
acknowledgementModel: "acknowledgement_only",
identityVerificationRequired: false,
});
} catch (err) {
if (maybeSendInternalWalletInterventionError(res, err)) {
return;
}

if (maybeSendBuilderBondRefundError(res, err)) {
return;
}

if (maybeSendAcknowledgementError(res, err)) {
return;
}

console.error("POST /api/launcher/confirm-builder-bond failed:", err);
return res.status(400).json({
ok: false,
error: err.message || "launch bond verification failed",
});
}
});

router.post("/create", async (req, res) => {
try {
const wallet = cleanText(req.body.wallet, 100);
const template = cleanText(req.body.template, 40);
const tokenName = cleanText(req.body.token_name, 60);
const symbol = cleanSymbol(req.body.symbol, 20);
const description = cleanText(req.body.description, 500);
const imageUrl = cleanText(req.body.image_url, 500);
const builderBondTxSignature = cleanText(
req.body.builder_bond_tx_signature ?? req.body.builderBondTxSignature,
140
);

if (!wallet) {
return res.status(400).json({ ok: false, error: "wallet is required" });
}

if (!template) {
return res.status(400).json({ ok: false, error: "template is required" });
}

if (!tokenName) {
return res.status(400).json({ ok: false, error: "token_name is required" });
}

if (!symbol) {
return res.status(400).json({ ok: false, error: "symbol is required" });
}

let cfg;
try {
cfg = getTemplateConfig(template, req.body);
} catch (configErr) {
return res.status(400).json({
ok: false,
error: configErr.message || "invalid builder config",
});
}

const builderCfg = shapeBuilderConfig(template, req.body);

try {
validateBuilderConfig(template, cfg, builderCfg);
} catch (validationErr) {
return res.status(400).json({
ok: false,
error: validationErr.message,
});
}

const initialBuilderIntervention = await getInternalWalletIntervention(wallet);

if (initialBuilderIntervention.blocked) {
if (!builderBondTxSignature) {
throw buildInternalWalletInterventionError({
wallet,
role: BUILDER_ACKNOWLEDGEMENT_ROLE,
action: "launch_create",
});
}

await verifyCommitTransfer({
txSignature: builderBondTxSignature,
expectedSender: wallet,
expectedDestination: getBuilderBondEscrowWallet(),
expectedLamports: solToLamports(builderCfg.builder_bond_sol),
reference: buildLaunchBondReference(wallet),
});

const refundResult = await executeBuilderBondRefundNow({
wallet,
builderBondSol: builderCfg.builder_bond_sol,
bondTxSignature: builderBondTxSignature,
reasonCode:
initialBuilderIntervention.reason_code || "wallet_intervention_active",
requestAction: "launch_create_blocked",
});

return res.status(409).json(
buildBlockedBuilderBondRefundResponse({
intervention: initialBuilderIntervention,
refundResult,
builderBondSol: builderCfg.builder_bond_sol,
bondTxSignature: builderBondTxSignature,
})
);
}

validateAcknowledgementInput(req.body, {
role: BUILDER_ACKNOWLEDGEMENT_ROLE,
});

if (!builderBondTxSignature) {
return res.status(400).json({
ok: false,
error: "launch bond transaction is required",
});
}

await assertBuilderBondTransactionUsable(builderBondTxSignature);

const existingLaunchWithBondTx = await db.get(
`SELECT id FROM launches WHERE builder_bond_tx_signature = ? LIMIT 1`,
[builderBondTxSignature]
);

if (existingLaunchWithBondTx) {
return res.status(400).json({
ok: false,
error: "launch bond transaction already used by another launch",
});
}

await verifyCommitTransfer({
txSignature: builderBondTxSignature,
expectedSender: wallet,
expectedDestination: getBuilderBondEscrowWallet(),
expectedLamports: solToLamports(builderCfg.builder_bond_sol),
reference: buildLaunchBondReference(wallet),
});

const finalBuilderIntervention = await getInternalWalletIntervention(wallet);

if (finalBuilderIntervention.blocked) {
const refundResult = await executeBuilderBondRefundNow({
wallet,
builderBondSol: builderCfg.builder_bond_sol,
bondTxSignature: builderBondTxSignature,
reasonCode:
finalBuilderIntervention.reason_code || "wallet_intervention_active",
requestAction: "launch_create_blocked_after_verification",
});

return res.status(409).json(
buildBlockedBuilderBondRefundResponse({
intervention: finalBuilderIntervention,
refundResult,
builderBondSol: builderCfg.builder_bond_sol,
bondTxSignature: builderBondTxSignature,
})
);
}

let builder;
try {
builder = await ensureBuilderProfileForWallet(wallet);
} catch (builderErr) {
return res.status(400).json({
ok: false,
error:
builderErr.message || "builder profile could not be created automatically",
});
}

const builderBondPaid = 1;
const finalBuilderBondTxSignature = builderBondTxSignature;

const result = await db.run(
`
INSERT INTO launches (
builder_id,
launch_type,
template,
token_name,
symbol,
description,
image_url,
supply,
min_raise_sol,
hard_cap_sol,
launch_fee_pct,
liquidity_pct,
participants_pct,
reserve_pct,
builder_pct,
team_allocation_pct,
team_wallets,
team_wallet_breakdown,
builder_bond_sol,
builder_bond_refunded,
builder_bond_paid,
builder_bond_tx_signature,
reserved_mint_address,
reserved_mint_secret,
mint_reservation_status,
mint_required_tag,
mint_reservation_attempts,
mint_reserved_at,
commit_started_at,
commit_ends_at,
countdown_started_at,
countdown_ends_at,
live_at,
failed_at,
committed_sol,
participants_count,
status
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, NULL, 'pending', ?, 0, NULL, CURRENT_TIMESTAMP, datetime(CURRENT_TIMESTAMP, '+${COMMIT_PHASE_MINUTES} minutes'), NULL, NULL, NULL, NULL, 0, 0, 'commit')
`,
[
builder.id,
cfg.launch_type,
template,
tokenName,
symbol,
description,
imageUrl,
isBuilderTemplate(template)
? normalizeSupply(req.body.supply, cfg.supply)
: cfg.supply,
cfg.min_raise_sol,
cfg.hard_cap_sol,
LAUNCH_FEE_PCT,
cfg.liquidity_pct,
cfg.participants_pct,
cfg.reserve_pct,
cfg.builder_pct,
builderCfg.team_allocation_pct,
JSON.stringify(builderCfg.team_wallets),
JSON.stringify(builderCfg.team_wallet_breakdown),
builderCfg.builder_bond_sol,
builderBondPaid,
finalBuilderBondTxSignature,
REQUIRED_MINT_TAG,
]
);

const acknowledgement = await saveLauncherAcknowledgement({
wallet,
role: BUILDER_ACKNOWLEDGEMENT_ROLE,
launchId: result.lastID,
body: req.body,
action: "launch_create",
signatureReference: builderBondTxSignature,
signatureMessage: buildLaunchBondReference(wallet),
});

let reservation = {
requiredTag: REQUIRED_MINT_TAG,
reservedMintAddress: null,
attempts: 0,
status: "pending",
source: "pending",
};

try {
const claimed = await claimReservedMintForLaunch(result.lastID, REQUIRED_MINT_TAG);
reservation = {
requiredTag: claimed.requiredTag,
reservedMintAddress: null,
attempts: 0,
status: claimed.status || "reserved",
source: claimed.source || "pool",
};
} catch (reservationErr) {
console.warn(
`Launch ${result.lastID} created without immediate mint reservation:`,
reservationErr?.message || reservationErr
);

void topUpMintReservationPool({
requiredTag: REQUIRED_MINT_TAG,
targetSize: 10,
batchSize: 2,
maxAttempts: RESERVED_MINT_MAX_ATTEMPTS,
}).catch((err) => {
console.error("Mint pool async top-up after create failed:", err);
});
}

const launch = await getLaunchWithBuilderById(result.lastID);

return res.json({
ok: true,
launch: sanitizeLaunchForPublic(launch),
builderConfig: builderCfg,
templateConfig: {
min_raise_sol: Number(cfg.min_raise_sol || 0),
hard_cap_sol: Number(cfg.hard_cap_sol || 0),
liquidity_pct: Number(cfg.liquidity_pct || 0),
participants_pct: Number(cfg.participants_pct || 0),
reserve_pct: Number(cfg.reserve_pct || 0),
builder_pct: Number(cfg.builder_pct || 0),
},
mintReservation: reservation,
acknowledgement,
acknowledgementModel: "acknowledgement_only",
identityVerificationRequired: false,
});
} catch (err) {
if (maybeSendInternalWalletInterventionError(res, err)) {
return;
}

if (maybeSendBuilderBondRefundError(res, err)) {
return;
}

if (maybeSendAcknowledgementError(res, err)) {
return;
}

console.error("POST /api/launcher/create failed:", err);
return res
.status(500)
.json({ ok: false, error: err.message || "internal server error" });
}
});

router.post("/prepare-commit", async (req, res) => {
try {
const launchId = Number(req.body.launchId);
const wallet = cleanText(req.body.wallet, 100);
const solAmount = Number(req.body.solAmount);

if (!launchId || !wallet || !Number.isFinite(solAmount)) {
return res.status(400).json({ ok: false, error: "missing or invalid fields" });
}

if (solAmount <= 0) {
return res.status(400).json({ ok: false, error: "solAmount must be greater than 0" });
}

let launch = await reconcileLaunchState(launchId);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (launch.status !== "commit") {
return res.status(400).json({ ok: false, error: "commit phase closed" });
}

if (!isBuilderBondSatisfied(launch)) {
return res.status(400).json({ ok: false, error: "launch bond not satisfied" });
}

if (isRestrictedCommitWallet(launch, wallet)) {
return res.status(400).json({
ok: false,
error: getRestrictedCommitWalletError(),
});
}

await requireNoInternalWalletIntervention({
wallet,
role: PARTICIPANT_ACKNOWLEDGEMENT_ROLE,
action: "prepare_commit",
});

const acknowledgement = await saveLauncherAcknowledgement({
wallet,
role: PARTICIPANT_ACKNOWLEDGEMENT_ROLE,
launchId,
body: req.body,
action: "prepare_commit",
signatureMessage: buildCommitReference(launchId),
});

const existing = await db.get(
`
SELECT COALESCE(SUM(sol_amount), 0) AS total
FROM commits
WHERE launch_id = ? AND wallet = ?
`,
[launchId, wallet]
);

const currentWalletTotal = Number(existing?.total || 0);

if (currentWalletTotal + solAmount > MAX_WALLET_COMMIT_SOL) {
return res.status(400).json({
ok: false,
error: `max commit per wallet is ${MAX_WALLET_COMMIT_SOL} SOL`,
});
}

const currentLaunchTotal = Number(launch.committed_sol || 0);
const hardCap = Number(launch.hard_cap_sol || 0);

if (currentLaunchTotal + solAmount > hardCap) {
return res.status(400).json({
ok: false,
error: "hard cap reached",
});
}

const launchEscrow = resolveLaunchCommitEscrow(launch);
const reference = buildCommitReference(launchId);

const prepared = await buildEscrowTransferTransaction({
wallet,
solAmount,
reference,
destinationWallet: launchEscrow.address,
});

return res.json({
ok: true,
launchId,
wallet,
...prepared,
escrowModel: launchEscrow.model,
maxWalletCommitSol: MAX_WALLET_COMMIT_SOL,
currentWalletCommitted: currentWalletTotal,
remainingWalletCommit: Math.max(0, MAX_WALLET_COMMIT_SOL - currentWalletTotal),
status: launch.status,
commitEndsAt: launch.commit_ends_at || null,
acknowledgement,
acknowledgementModel: "acknowledgement_only",
identityVerificationRequired: false,
});
} catch (err) {
if (maybeSendInternalWalletInterventionError(res, err)) {
return;
}

if (maybeSendAcknowledgementError(res, err)) {
return;
}

console.error("POST /api/launcher/prepare-commit failed:", err);
return res.status(500).json({
ok: false,
error: err.message || "failed to prepare commit",
});
}
});

router.post("/confirm-commit", async (req, res) => {
try {
const launchId = Number(req.body.launchId);
const wallet = cleanText(req.body.wallet, 100);
const solAmount = Number(req.body.solAmount);
const txSignatureInput = cleanText(req.body.txSignature, 140);
const signedTransactionBase64 = cleanText(
req.body.signedTransaction ?? req.body.signedBase64 ?? req.body.signedTx,
50000
);

if (
!launchId ||
!wallet ||
!Number.isFinite(solAmount) ||
(!txSignatureInput && !signedTransactionBase64)
) {
return res.status(400).json({ ok: false, error: "missing or invalid fields" });
}

if (solAmount <= 0) {
return res.status(400).json({ ok: false, error: "solAmount must be greater than 0" });
}

const txWasAlreadySentByWallet = Boolean(txSignatureInput);
let launch = await reconcileLaunchState(launchId);
const initialLaunch = launch;
let acknowledgement = null;

if (!launch && !txWasAlreadySentByWallet) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (launch && launch.status !== "commit" && !txWasAlreadySentByWallet) {
return res.status(400).json({ ok: false, error: "commit phase closed" });
}

if (launch && !isBuilderBondSatisfied(launch) && !txWasAlreadySentByWallet) {
return res.status(400).json({ ok: false, error: "launch bond not satisfied" });
}

if (launch && isRestrictedCommitWallet(launch, wallet) && !txWasAlreadySentByWallet) {
return res.status(400).json({
ok: false,
error: getRestrictedCommitWalletError(),
});
}

if (!txWasAlreadySentByWallet) {
await requireNoInternalWalletIntervention({
wallet,
role: PARTICIPANT_ACKNOWLEDGEMENT_ROLE,
action: "confirm_commit",
});

acknowledgement = await ensureLauncherAcknowledgementForAction({
wallet,
role: PARTICIPANT_ACKNOWLEDGEMENT_ROLE,
launchId,
body: req.body,
action: "confirm_commit",
signatureMessage: buildCommitReference(launchId),
});
}

let txSignature = txSignatureInput;

if (!txSignature) {
const existing = await db.get(
`
SELECT COALESCE(SUM(sol_amount), 0) AS total
FROM commits
WHERE launch_id = ? AND wallet = ?
`,
[launchId, wallet]
);

const currentWalletTotal = Number(existing?.total || 0);

if (currentWalletTotal + solAmount > MAX_WALLET_COMMIT_SOL) {
return res.status(400).json({
ok: false,
error: `max commit per wallet is ${MAX_WALLET_COMMIT_SOL} SOL`,
});
}

const currentLaunchTotal = Number(launch?.committed_sol || 0);
const hardCap = Number(launch?.hard_cap_sol || 0);

if (currentLaunchTotal + solAmount > hardCap) {
return res.status(400).json({
ok: false,
error: "hard cap reached",
});
}

const connection = new Connection(getRpcUrl(), "confirmed");
const rawSignedTx = Buffer.from(signedTransactionBase64, "base64");

try {
txSignature = await connection.sendRawTransaction(rawSignedTx, {
skipPreflight: false,
preflightCommitment: "confirmed",
});
} catch (sendErr) {
if (isLikelyBlockhashExpiredError(sendErr)) {
return res.status(409).json({
ok: false,
error: "commit approval expired. please prepare the commit again",
});
}
throw sendErr;
}

const confirmation = await connection.confirmTransaction(txSignature, "confirmed");
if (confirmation?.value?.err) {
throw new Error("signed transaction confirmation failed");
}
}

const reusedTx = await db.get(
`
SELECT id FROM commits
WHERE tx_signature = ?
LIMIT 1
`,
[txSignature]
);

if (reusedTx) {
return res.status(400).json({ ok: false, error: "transaction already used" });
}

const launchEscrow = resolveLaunchCommitEscrow(launch || initialLaunch);
const expectedLamports = solToLamports(solAmount);

await verifyCommitTransfer({
txSignature,
expectedSender: wallet,
expectedDestination: launchEscrow.address,
expectedLamports,
reference: buildCommitReference(launchId),
});

launch = await reconcileLaunchState(launchId);

if (!launch) {
const refunded = await refundRejectedCommit({
launchId,
launch: initialLaunch,
wallet,
solAmount,
txSignature,
reason: "launch not found after transfer verification",
logLabel: "Late confirm refund failed after missing launch",
});
return res.status(refunded.httpStatus).json(refunded.body);
}

if (launch.status !== "commit") {
const refunded = await refundRejectedCommit({
launchId,
launch,
wallet,
solAmount,
txSignature,
reason: "commit phase closed before confirmation completed",
status: launch.status,
logLabel: "Late confirm refund failed after commit phase closure",
});
return res.status(refunded.httpStatus).json(refunded.body);
}

if (!isBuilderBondSatisfied(launch)) {
const refunded = await refundRejectedCommit({
launchId,
launch,
wallet,
solAmount,
txSignature,
reason: "launch bond no longer satisfied",
status: launch.status,
logLabel: "Late confirm refund failed after launch bond check",
});
return res.status(refunded.httpStatus).json(refunded.body);
}

if (isRestrictedCommitWallet(launch, wallet)) {
const refunded = await refundRejectedCommit({
launchId,
launch,
wallet,
solAmount,
txSignature,
reason: getRestrictedCommitWalletError(),
status: launch.status,
logLabel: "Late confirm refund failed after restricted wallet commit check",
});
return res.status(refunded.httpStatus).json(refunded.body);
}

try {
await requireNoInternalWalletIntervention({
wallet,
role: PARTICIPANT_ACKNOWLEDGEMENT_ROLE,
action: "confirm_commit",
});
} catch (interventionErr) {
if (interventionErr?.code === "launcher_wallet_intervention_active") {
const refunded = await refundRejectedCommit({
launchId,
launch,
wallet,
solAmount,
txSignature,
reason:
interventionErr.message ||
"This wallet is currently unable to use Launcher transactions.",
status: launch.status,
logLabel: "Late confirm refund failed after internal wallet intervention check",
});

return res.status(refunded.httpStatus).json({
...refunded.body,
code: interventionErr.code,
role: PARTICIPANT_ACKNOWLEDGEMENT_ROLE,
internalInterventionActive: true,
acknowledgementModel: "acknowledgement_only",
identityVerificationRequired: false,
});
}

throw interventionErr;
}

try {
acknowledgement = await ensureLauncherAcknowledgementForAction({
wallet,
role: PARTICIPANT_ACKNOWLEDGEMENT_ROLE,
launchId,
body: req.body,
action: "confirm_commit",
signatureReference: txSignature,
signatureMessage: buildCommitReference(launchId),
});

acknowledgement = await attachLauncherAcknowledgementSignature({
wallet,
role: PARTICIPANT_ACKNOWLEDGEMENT_ROLE,
launchId,
action: "confirm_commit",
signatureReference: txSignature,
signatureMessage: buildCommitReference(launchId),
});
} catch (acknowledgementErr) {
if (
acknowledgementErr?.code === "launcher_acknowledgements_required" ||
acknowledgementErr?.code === "launcher_acknowledgements_not_configured"
) {
const refunded = await refundRejectedCommit({
launchId,
launch,
wallet,
solAmount,
txSignature,
reason:
acknowledgementErr.message ||
"required launcher acknowledgements were not confirmed before commit acceptance",
status: launch.status,
logLabel: "Late confirm refund failed after acknowledgement check",
});

return res.status(refunded.httpStatus).json({
...refunded.body,
code: acknowledgementErr.code || null,
role: acknowledgementErr.role || PARTICIPANT_ACKNOWLEDGEMENT_ROLE,
requiredAcknowledgements:
acknowledgementErr.requiredAcknowledgements || [],
missingAcknowledgements:
acknowledgementErr.missingAcknowledgements || [],
versions: LAUNCH_ACKNOWLEDGEMENT_VERSIONS,
acknowledgementModel: "acknowledgement_only",
identityVerificationRequired: false,
});
}

throw acknowledgementErr;
}

const existing = await db.get(
`
SELECT COALESCE(SUM(sol_amount), 0) AS total
FROM commits
WHERE launch_id = ? AND wallet = ?
`,
[launchId, wallet]
);

const currentWalletTotal = Number(existing?.total || 0);

if (currentWalletTotal + solAmount > MAX_WALLET_COMMIT_SOL) {
const refunded = await refundRejectedCommit({
launchId,
launch,
wallet,
solAmount,
txSignature,
reason: `max commit per wallet is ${MAX_WALLET_COMMIT_SOL} SOL`,
status: launch.status,
logLabel: "Late confirm refund failed after wallet max check",
});
return res.status(refunded.httpStatus).json(refunded.body);
}

const currentLaunchTotal = Number(launch.committed_sol || 0);
const hardCap = Number(launch.hard_cap_sol || 0);

if (currentLaunchTotal + solAmount > hardCap) {
const refunded = await refundRejectedCommit({
launchId,
launch,
wallet,
solAmount,
txSignature,
reason: "hard cap reached before confirmation completed",
status: launch.status,
logLabel: "Late confirm refund failed after hard cap check",
});
return res.status(refunded.httpStatus).json(refunded.body);
}

await db.run(
`
INSERT INTO commits (
launch_id,
wallet,
sol_amount,
tx_signature,
tx_status,
verified_at
) VALUES (?, ?, ?, ?, 'confirmed', CURRENT_TIMESTAMP)
`,
[launchId, wallet, solAmount, txSignature]
);

const stats = await syncLaunchStats(launchId);
let updatedLaunch = await getLaunchById(launchId);

if (
Number(stats.totalCommitted) >= Number(updatedLaunch.hard_cap_sol || 0) &&
Number(updatedLaunch.hard_cap_sol || 0) > 0 &&
updatedLaunch.status === "commit"
) {
updatedLaunch = await beginCountdown(launchId);
} else {
updatedLaunch = await reconcileLaunchState(launchId);
}

return res.json({
ok: true,
launchId,
wallet,
txSignature,
walletCommittedTotal: currentWalletTotal + solAmount,
totalCommitted: stats.totalCommitted,
participants: stats.participants,
minRaise: Number(updatedLaunch.min_raise_sol),
hardCap: Number(updatedLaunch.hard_cap_sol),
commitPercent: buildCommitPercent(
stats.totalCommitted,
updatedLaunch.hard_cap_sol
),
status: updatedLaunch.status,
commitEndsAt: updatedLaunch.commit_ends_at || null,
countdownEndsAt: updatedLaunch.countdown_ends_at || null,
liveAt: updatedLaunch.live_at || null,
acknowledgement,
acknowledgementModel: "acknowledgement_only",
identityVerificationRequired: false,
});
} catch (err) {
if (maybeSendInternalWalletInterventionError(res, err)) {
return;
}

if (maybeSendAcknowledgementError(res, err)) {
return;
}

console.error("POST /api/launcher/confirm-commit failed:", err);
return res.status(400).json({
ok: false,
error: err.message || "commit verification failed",
});
}
});

router.post("/commit", (_req, res) => {
return res.status(410).json({
ok: false,
error: "direct commit is deprecated. use prepare-commit and confirm-commit",
});
});

router.post("/refund", async (req, res) => {
try {
const launchId = Number(req.body.launchId);
const wallet = cleanText(req.body.wallet, 100);

if (!launchId || !wallet) {
return res.status(400).json({
ok: false,
error: "launchId and wallet are required",
});
}

let launch = await reconcileLaunchState(launchId);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (!["commit", "failed"].includes(launch.status)) {
return res.status(400).json({
ok: false,
error: "refunds are only allowed during commit phase or after a failed launch",
});
}

const walletCommit = await db.get(
`
SELECT COALESCE(SUM(sol_amount), 0) AS total
FROM commits
WHERE launch_id = ? AND wallet = ?
`,
[launchId, wallet]
);

const refundAmount = Number(walletCommit?.total || 0);

if (refundAmount <= 0) {
return res.status(400).json({ ok: false, error: "nothing to refund" });
}

const launchEscrow = resolveLaunchCommitEscrow(launch);

if (launchEscrow.model === "launch_vault") {
const ledger = await queueWalletRefundLedger({
launchId,
launch,
wallet,
solAmount: refundAmount,
requestKind: REFUND_REQUEST_KIND_MANUAL,
reason:
launch.status === "failed"
? "failed launch refund requested"
: "commit-phase refund requested",
forcedStatus: REFUND_LEDGER_PENDING_PROGRAM_STATUS,
});

const stats = await getCommitStats(launchId);

return res.status(202).json({
ok: true,
launchId,
wallet,
refundQueued: true,
refundStatus: ledger?.status || REFUND_LEDGER_PENDING_PROGRAM_STATUS,
refundLedgerId: ledger?.id || null,
refundProgramReference: ledger?.program_instruction_ref || null,
refundedSol: 0,
refundedSolActual: 0,
builderBondRefunded: 0,
refundTxSignature: null,
totalCommitted: stats.totalCommitted,
participants: stats.participants,
commitPercent: buildCommitPercent(stats.totalCommitted, launch.hard_cap_sol),
status: launch.status,
escrowModel: launchEscrow.model,
escrowAddress: launchEscrow.address,
});
}

const { ledger, refundTransfer } = await executeSharedWalletRefundNow({
launchId,
launch,
wallet,
solAmount: refundAmount,
requestKind: REFUND_REQUEST_KIND_MANUAL,
reason:
launch.status === "failed"
? "failed launch refund requested"
: "commit-phase refund requested",
});

await db.run(
`
DELETE FROM commits
WHERE launch_id = ? AND wallet = ?
`,
[launchId, wallet]
);

const stats = await syncLaunchStats(launchId);
launch = applyCanonicalLaunchTruth(await getLaunchById(launchId));

if (launch.status === "failed" && Number(stats.totalCommitted) <= 0) {
launch = await maybeMarkLaunchFailedRefunded(launchId);
}

return res.json({
ok: true,
launchId,
wallet,
refundedSol: refundAmount,
refundedSolActual: refundTransfer?.refundedSol || 0,
builderBondRefunded: 0,
refundTxSignature: refundTransfer?.signature || null,
refundLedgerId: ledger?.id || null,
refundStatus: ledger?.status || REFUND_LEDGER_REFUNDED_STATUS,
totalCommitted: stats.totalCommitted,
participants: stats.participants,
commitPercent: buildCommitPercent(stats.totalCommitted, launch.hard_cap_sol),
status: launch.status,
});
} catch (err) {
console.error("POST /api/launcher/refund failed:", err);
return res.status(500).json({ ok: false, error: err.message || "refund failed" });
}
});

router.post("/:id/start-countdown", async (req, res) => {
try {
const launchId = Number(req.params.id);
let launch = await reconcileLaunchState(launchId);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (launch.status !== "commit") {
return res.status(400).json({
ok: false,
error: "countdown can only start from commit phase",
});
}

if (!isBuilderBondSatisfied(launch)) {
return res.status(400).json({ ok: false, error: "launch bond not satisfied" });
}

if (Number(launch.min_raise_sol) <= 0) {
return res.status(400).json({ ok: false, error: "invalid minimum raise" });
}

if (Number(launch.hard_cap_sol) <= Number(launch.min_raise_sol)) {
return res.status(400).json({
ok: false,
error: "hard cap must be greater than minimum raise",
});
}

const stats = await syncLaunchStats(launchId);
const minRaise = Number(launch.min_raise_sol);

if (stats.totalCommitted < minRaise) {
return res.status(400).json({
ok: false,
error: "min raise not reached",
});
}

const updatedLaunch = await beginCountdown(launchId);

return res.json({
ok: true,
launchId,
status: updatedLaunch.status,
countdownStartedAt: updatedLaunch.countdown_started_at,
countdownEndsAt: updatedLaunch.countdown_ends_at,
liveAt: updatedLaunch.live_at,
totalCommitted: stats.totalCommitted,
participants: stats.participants,
commitPercent: buildCommitPercent(
stats.totalCommitted,
updatedLaunch.hard_cap_sol
),
});
} catch (err) {
console.error("POST /api/launcher/:id/start-countdown failed:", err);
return res.status(500).json({
ok: false,
error: err.message || "failed to start countdown",
});
}
});

router.post("/:id/cancel-countdown", async (req, res) => {
try {
const launchId = Number(req.params.id);
const launch = await getLaunchById(launchId);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (computeCanonicalLaunchStatus(launch) !== "countdown") {
return res.status(400).json({ ok: false, error: "launch is not in countdown" });
}

const commitStillOpenCheck = await db.get(
`
SELECT CASE
WHEN commit_ends_at IS NOT NULL AND datetime('now') < datetime(commit_ends_at)
THEN 1 ELSE 0
END AS still_open
FROM launches
WHERE id = ?
`,
[launchId]
);

if (Number(commitStillOpenCheck?.still_open || 0) !== 1) {
return res.status(400).json({
ok: false,
error: "commit window has already expired",
});
}

await db.run(
`
UPDATE launches
SET status = 'commit',
countdown_started_at = NULL,
countdown_ends_at = NULL,
live_at = NULL,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[launchId]
);

const updatedLaunch = applyCanonicalLaunchTruth(await getLaunchById(launchId));

return res.json({
ok: true,
launchId,
status: updatedLaunch.status,
commitEndsAt: updatedLaunch.commit_ends_at || null,
});
} catch (err) {
console.error("POST /api/launcher/:id/cancel-countdown failed:", err);
return res.status(500).json({ ok: false, error: "failed to cancel countdown" });
}
});

router.post("/:id/finalize", async (req, res) => {
try {
const launchId = Number(req.params.id);

if (!launchId) {
return res.status(400).json({ ok: false, error: "invalid launch id" });
}

let launch = await reconcileLaunchState(launchId);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (!["countdown", "building", "live", "graduated"].includes(launch.status)) {
return res.status(400).json({
ok: false,
error: "launch is not ready to finalize",
});
}

let finalizeResult = null;
if (launch.status === "countdown" || launch.status === "building") {
finalizeResult = await runFinalizeLaunchOnce(launchId);
launch = await reconcileLaunchState(launchId);
}

const finalLaunch = applyCanonicalLaunchTruth(await getLaunchById(launchId));
const stats = await syncLaunchStats(launchId);
const lifecycle = await safeSyncLifecycle(launchId);
const graduationPlan = await safeGetGraduationPlan(launchId);
const feeBreakdown = buildFeeBreakdown(
Number(stats.totalCommitted),
Number(finalLaunch?.launch_fee_pct || LAUNCH_FEE_PCT)
);

return res.json({
ok: true,
launchId,
status: finalLaunch?.status || launch.status,
liveAt: finalLaunch?.live_at || null,
totalCommitted: stats.totalCommitted,
participants: stats.participants,
commitPercent: buildCommitPercent(
stats.totalCommitted,
finalLaunch?.hard_cap_sol
),
feeBreakdown,
lifecycle,
graduationPlan,
finalizeResult:
finalizeResult || {
ok: finalLaunch?.status === "live" || finalLaunch?.status === "graduated",
reason:
finalLaunch?.status === "live" || finalLaunch?.status === "graduated"
? "reconciled finalize state"
: finalLaunch?.status === "building"
? "building"
: "countdown not finished",
stage:
finalLaunch?.status === "live" || finalLaunch?.status === "graduated"
? "live"
: finalLaunch?.status === "building"
? "building"
: "countdown",
},
});
} catch (err) {
console.error("POST /api/launcher/:id/finalize failed:", err);
return res.status(400).json({
ok: false,
error: err.message || "finalize failed",
});
}
});

router.post("/:id/reconcile", async (req, res) => {
try {
const launchId = Number(req.params.id);

if (!launchId) {
return res.status(400).json({ ok: false, error: "invalid launch id" });
}

const launch = await reconcileLaunchState(launchId);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

const hydratedLaunch = await getLaunchWithBuilderById(launchId);
const publicLaunch = sanitizeLaunchForPublic(hydratedLaunch || launch);
const stats = await getCommitStats(launchId);
const lifecycle = await safeSyncLifecycle(launchId);
const graduationPlan = await safeGetGraduationPlan(launchId);

return res.json({
ok: true,
launch: publicLaunch,
status: publicLaunch.status,
totalCommitted: stats.totalCommitted,
participants: stats.participants,
commitPercent: buildCommitPercent(
stats.totalCommitted,
publicLaunch.hard_cap_sol
),
lifecycle,
graduationPlan,
});
} catch (err) {
console.error("POST /api/launcher/:id/reconcile failed:", err);
return res.status(500).json({
ok: false,
error: err.message || "reconcile failed",
});
}
});

router.get("/:id/lifecycle", async (req, res) => {
try {
const launchId = Number(req.params.id);

if (!launchId) {
return res.status(400).json({ ok: false, error: "invalid launch id" });
}

const launch = await reconcileLaunchState(launchId);
if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

const lifecycle = await safeSyncLifecycle(launchId);
const graduationPlan = await safeGetGraduationPlan(launchId);

return res.json({
ok: true,
launchId,
status: launch.status,
lifecycle,
graduationPlan,
graduationReadiness: extractGraduationReadiness(lifecycle),
});
} catch (err) {
console.error("GET /api/launcher/:id/lifecycle failed:", err);
return res.status(500).json({
ok: false,
error: err.message || "failed to fetch lifecycle",
});
}
});

router.post("/:id/graduate-devnet", async (req, res) => {
try {
const launchId = Number(req.params.id);

if (!launchId) {
return res.status(400).json({ ok: false, error: "invalid launch id" });
}

if (!isDevnetEnvironment()) {
return res.status(403).json({
ok: false,
error: "graduate-devnet is only available on devnet environments",
});
}

const launch = await reconcileLaunchState(launchId);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (launch.status !== "live" && launch.status !== "graduated") {
return res.status(400).json({
ok: false,
error: "launch must be live before devnet graduation override",
});
}

const lifecycle = await safeSyncLifecycle(launchId);
const readiness = extractGraduationReadiness(lifecycle);

if (launch.status !== "graduated" && !readiness?.ready) {
return res.status(409).json({
ok: false,
error: "launch is not graduation-ready yet",
lifecycle,
graduationReadiness: readiness,
});
}

const updatedLifecycle = await markLaunchGraduatedLifecycle({
launchId,
reason: cleanText(req.body.reason || "devnet_manual_override", 120),
raydiumPoolId: cleanText(req.body.raydiumPoolId || "", 200),
raydiumMigrationTx: cleanText(req.body.raydiumMigrationTx || "", 500),
lockTx: cleanText(req.body.lockTx || "", 500),
raydiumLpTokens: cleanText(req.body.raydiumLpTokens || "", 500),
mssLockedLpAmount: cleanText(req.body.mssLockedLpAmount || "", 500),
lockExpiresAt: cleanText(req.body.lockExpiresAt || "", 120),
});

const updatedLaunch = await getLaunchWithBuilderById(launchId);
const graduationPlan = await safeGetGraduationPlan(launchId);

return res.json({
ok: true,
launch: sanitizeLaunchForPublic(updatedLaunch || launch),
lifecycle: updatedLifecycle,
graduationPlan,
mode: "devnet_override",
});
} catch (err) {
console.error("POST /api/launcher/:id/graduate-devnet failed:", err);
return res.status(500).json({
ok: false,
error: err.message || "failed to mark launch graduated on devnet",
});
}
});

router.patch("/:id/links", async (req, res) => {
try {
const launchId = Number(req.params.id);
const wallet = cleanText(req.body.wallet, 120);

if (!launchId) {
return res.status(400).json({ ok: false, error: "invalid launch id" });
}

if (!wallet) {
return res.status(400).json({ ok: false, error: "wallet is required" });
}

const hydratedLaunch = await getLaunchWithBuilderById(launchId);

if (!hydratedLaunch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

const builderWallet = cleanText(hydratedLaunch.builder_wallet, 120).toLowerCase();
const requestWallet = wallet.toLowerCase();

if (!builderWallet || builderWallet !== requestWallet) {
return res.status(403).json({
ok: false,
error: "only the builder wallet can manage launch links",
});
}

const websiteUrl = normalizePublicLink(req.body.website_url, "website_url");
const xUrl = normalizePublicLink(req.body.x_url, "x_url");
const telegramUrl = normalizePublicLink(req.body.telegram_url, "telegram_url");
const discordUrl = normalizePublicLink(req.body.discord_url, "discord_url");

await db.run(
`
UPDATE launches
SET website_url = ?,
x_url = ?,
telegram_url = ?,
discord_url = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[websiteUrl, xUrl, telegramUrl, discordUrl, launchId]
);

const updatedLaunch = await getLaunchWithBuilderById(launchId);

return res.json({
ok: true,
launch: sanitizeLaunchForPublic(updatedLaunch),
});
} catch (err) {
console.error("PATCH /api/launcher/:id/links failed:", err);
return res.status(500).json({
ok: false,
error: err.message || "failed to save launch links",
});
}
});

router.post("/:id/bootstrap-market", async (req, res) => {
try {
const launchId = Number(req.params.id);

if (!launchId) {
return res.status(400).json({ ok: false, error: "invalid launch id" });
}

const launchBefore = await getLaunchById(launchId);
if (!launchBefore) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

const result = await bootstrapLiveMarket(launchId);
const reconciledLaunch = await reconcileLaunchState(launchId);
const hydratedLaunch = await getLaunchWithBuilderById(launchId);
const publicLaunch = sanitizeLaunchForPublic(
hydratedLaunch || reconciledLaunch || launchBefore
);
const lifecycle = await safeSyncLifecycle(launchId);
const graduationPlan = await safeGetGraduationPlan(launchId);

return res.json({
ok: true,
launch: publicLaunch,
result,
lifecycle,
graduationPlan,
});
} catch (err) {
console.error("POST /api/launcher/:id/bootstrap-market failed:", err);
return res.status(400).json({
ok: false,
error: err.message || "market bootstrap failed",
});
}
});

router.get("/list", async (_req, res) => {
try {
const activeRows = await db.all(
`
SELECT id
FROM launches
WHERE status IN ('commit', 'countdown', 'building', 'live', 'graduated')
ORDER BY id ASC
`
);

for (const row of activeRows) {
try {
await reconcileLaunchState(Number(row.id));
} catch (err) {
console.error(`Launch list reconcile failed for launch ${row.id}:`, err);
}
}

const rows = await db.all(
`
SELECT
l.*,
b.wallet AS builder_wallet,
b.alias AS builder_alias,
b.builder_score
FROM launches l
LEFT JOIN builders b ON b.id = l.builder_id
ORDER BY l.id DESC
`
);

const shaped = rows
.filter((row) => isBuilderBondSatisfied(row))
.map(shapeLaunchForList);

const current = shaped.filter((x) => isCurrentListStatus(x.status));
const history = shaped.filter((x) => isHistoricalListStatus(x.status));

const grouped = {
commit: current.filter((x) => x.status === "commit"),
countdown: current.filter((x) => x.status === "countdown"),
building: current.filter((x) => x.status === "building"),
live: current.filter((x) => x.status === "live"),
graduated: history.filter((x) => x.status === "graduated"),
failed: history.filter(
(x) => x.status === "failed" || x.status === "failed_refunded"
),
};

return res.json({
ok: true,
launches: grouped,
all: current,
history,
});
} catch (err) {
console.error("GET /api/launcher/list failed:", err);
return res.status(500).json({
ok: false,
error: err.message || "failed to fetch launches",
});
}
});

router.get("/commits/:launchId", async (req, res) => {
try {
const launchId = Number(req.params.launchId);

if (!launchId) {
return res.status(400).json({ ok: false, error: "invalid launchId" });
}

const reconciledLaunch = await reconcileLaunchState(launchId);

if (!reconciledLaunch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

const hydratedLaunch = await getLaunchWithBuilderById(launchId);
const parsedLaunch = sanitizeLaunchForPublic(hydratedLaunch || reconciledLaunch, {
includeMintMeta: false,
});
const stats = await getCommitStats(launchId);
const lifecycle = await safeSyncLifecycle(launchId);
const graduationPlan = await safeGetGraduationPlan(launchId);

const recent = await db.all(
`
SELECT wallet, sol_amount, created_at, tx_signature, tx_status, verified_at
FROM commits
WHERE launch_id = ?
ORDER BY id DESC
LIMIT 25
`,
[launchId]
);

return res.json({
ok: true,
launchId,
status: parsedLaunch.status,
minRaise: Number(parsedLaunch.min_raise_sol),
hardCap: Number(parsedLaunch.hard_cap_sol),
totalCommitted: stats.totalCommitted,
participants: stats.participants,
commitPercent: buildCommitPercent(
stats.totalCommitted,
parsedLaunch.hard_cap_sol
),
marketBootstrapped: parsedLaunch.market_bootstrapped,
market_bootstrapped: parsedLaunch.market_bootstrapped,
contractAddress: parsedLaunch.contract_address || null,
contract_address: parsedLaunch.contract_address || null,
mintAddress: parsedLaunch.mint_address || null,
mint_address: parsedLaunch.mint_address || null,
tokenMint: parsedLaunch.token_mint || null,
token_mint: parsedLaunch.token_mint || null,
mint: parsedLaunch.mint || null,
reservedMintAddress: null,
mintReservationStatus: null,
mintRequiredTag: parsedLaunch.mint_required_tag || REQUIRED_MINT_TAG,
mintReservationAttempts: 0,
mintReservedAt: null,
mintFinalizedAt: shouldRevealContractAddress(parsedLaunch.status)
? parsedLaunch.mint_finalized_at || null
: null,
commitStartedAt: parsedLaunch.commit_started_at || null,
commitEndsAt: parsedLaunch.commit_ends_at || null,
countdownStartedAt: parsedLaunch.countdown_started_at || null,
countdownEndsAt: parsedLaunch.countdown_ends_at || null,
liveAt: parsedLaunch.live_at || null,
failedAt: parsedLaunch.failed_at || null,
teamAllocationPct: Number(parsedLaunch.team_allocation_pct || 0),
teamWallets: parsedLaunch.team_wallets,
teamWalletBreakdown: parsedLaunch.team_wallet_breakdown,
builderBondSol: Number(parsedLaunch.builder_bond_sol || 0),
builderBondRefunded: Number(parsedLaunch.builder_bond_refunded || 0),
builderBondPaid: Number(parsedLaunch.builder_bond_paid || 0),
builderWallet: parsedLaunch.builder_wallet || null,
builderAlias: parsedLaunch.builder_alias || null,
builderScore: Number(parsedLaunch.builder_score || 0),
websiteUrl: parsedLaunch.website_url || "",
xUrl: parsedLaunch.x_url || "",
telegramUrl: parsedLaunch.telegram_url || "",
discordUrl: parsedLaunch.discord_url || "",
lifecycle,
graduationPlan,
recent,
acknowledgementModel: "acknowledgement_only",
identityVerificationRequired: false,
});
} catch (err) {
console.error("GET /api/launcher/commits/:launchId failed:", err);
return res.status(500).json({ ok: false, error: "failed to fetch commit stats" });
}
});

router.get("/:id/refunds", async (req, res) => {
try {
const launchId = Number(req.params.id);

if (!launchId) {
return res.status(400).json({ ok: false, error: "invalid launch id" });
}

const launch = await getLaunchById(launchId);
if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

const refunds = await listRefundLedgerForLaunch(launchId);

return res.json({
ok: true,
launchId,
status: computeCanonicalLaunchStatus(launch),
refunds,
});
} catch (err) {
console.error("GET /api/launcher/:id/refunds failed:", err);
return res.status(500).json({
ok: false,
error: err.message || "failed to fetch refund ledger",
});
}
});

router.post("/:id/execute", async (_req, res) => {
try {
const launchId = Number(_req.params.id);

const launch = await reconcileLaunchState(launchId);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (
launch.status !== "building" &&
launch.status !== "live" &&
launch.status !== "graduated"
) {
return res.status(400).json({
ok: false,
error: "launch must be building, live, or graduated before allocations can be built",
});
}

const stats = await syncLaunchStats(launchId);
const allocationResult = await buildLaunchAllocations(launchId);
const lifecycle = await safeSyncLifecycle(launchId);
const graduationPlan = await safeGetGraduationPlan(launchId);
const feeBreakdown = buildFeeBreakdown(
Number(stats.totalCommitted),
Number(launch.launch_fee_pct || LAUNCH_FEE_PCT)
);

const updatedLaunch = sanitizeLaunchForPublic(await getLaunchWithBuilderById(launchId));

return res.json({
ok: true,
execution: allocationResult,
feeBreakdown,
lifecycle,
graduationPlan,
launch: updatedLaunch,
});
} catch (err) {
console.error("POST /api/launcher/:id/execute failed:", err);
return res.status(400).json({ ok: false, error: err.message });
}
});

router.get("/:id/allocations", async (req, res) => {
try {
const launchId = Number(req.params.id);

const rows = await db.all(
`SELECT * FROM allocations WHERE launch_id = ? ORDER BY id ASC`,
[launchId]
);

return res.json({ ok: true, allocations: rows });
} catch (err) {
console.error("GET /api/launcher/:id/allocations failed:", err);
return res.status(500).json({ ok: false, error: "internal server error" });
}
});

router.get("/:id", async (req, res) => {
try {
const id = Number(req.params.id);

const reconciledLaunch = await reconcileLaunchState(id);

if (!reconciledLaunch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

const hydratedLaunch = await getLaunchWithBuilderById(id);
const parsedLaunch = sanitizeLaunchForPublic(hydratedLaunch || reconciledLaunch);
const lifecycle = await safeSyncLifecycle(id);
const graduationPlan = await safeGetGraduationPlan(id);

return res.json({
ok: true,
launch: {
...parsedLaunch,
commitPercent: buildCommitPercent(
parsedLaunch.committed_sol,
parsedLaunch.hard_cap_sol
),
},
lifecycle,
graduationPlan,
acknowledgementModel: "acknowledgement_only",
identityVerificationRequired: false,
});
} catch (err) {
console.error("GET /api/launcher/:id failed:", err);
return res.status(500).json({ ok: false, error: "internal server error" });
}
});

startLaunchReconcileWorker();

export default router;