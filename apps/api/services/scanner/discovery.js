import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { db as scannerDb } from "../../db.js";

const PROVIDER_NAME = "parsed_block_initialize_mint";

const DEFAULT_POLL_INTERVAL_MS = 8000;
const DEFAULT_STARTUP_SLOT_LOOKBACK = 250;
const DEFAULT_MAX_SLOTS_PER_TICK = 120;
const DEFAULT_MAX_SCANS_PER_TICK = 40;
const DEFAULT_SCAN_CONCURRENCY = 3;
const DEFAULT_BLOCK_LOAD_CONCURRENCY = 6;
const DEFAULT_SEEN_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CACHE_SKIP_WINDOW_MS = 6 * 60 * 60 * 1000;
const DEFAULT_GET_CURRENT_SLOT_TIMEOUT_MS = 5000;
const DEFAULT_GET_SLOTS_TIMEOUT_MS = 6000;
const DEFAULT_LOAD_BLOCK_TIMEOUT_MS = 3500;
const DEFAULT_SCAN_TIMEOUT_MS = 20000;
const DEFAULT_TICK_DEADLINE_MS = 20000;

const INITIALIZE_MINT_TYPES = new Set(["initializeMint", "initializeMint2"]);
const TOKEN_PROGRAM_IDS = new Set([
TOKEN_PROGRAM_ID.toBase58(),
TOKEN_2022_PROGRAM_ID.toBase58(),
]);

function cleanText(value, max = 255) {
return String(value ?? "").trim().slice(0, max);
}

function toInt(value, fallback = 0) {
const num = Number.parseInt(value, 10);
return Number.isFinite(num) ? num : fallback;
}

function nowIso() {
return new Date().toISOString();
}

function ensureFunction(fn, name) {
if (typeof fn !== "function") {
throw new TypeError(`[scanner-discovery] Missing required dependency: ${name}`);
}
}

function buildTimeoutError(label, ms) {
const error = new Error(`[scanner-discovery] Timeout: ${label} exceeded ${ms}ms`);
error.code = "SCANNER_DISCOVERY_TIMEOUT";
error.timeout_ms = ms;
error.label = label;
return error;
}

async function withTimeout(factory, ms, label) {
const safeMs = Math.max(250, toInt(ms, 1000) || 1000);

return await new Promise((resolve, reject) => {
const timer = setTimeout(() => {
reject(buildTimeoutError(label, safeMs));
}, safeMs);

Promise.resolve()
.then(factory)
.then((value) => {
clearTimeout(timer);
resolve(value);
})
.catch((error) => {
clearTimeout(timer);
reject(error);
});
});
}

function isSupportedTokenProgram(programId) {
const safeProgramId = cleanText(programId, 128);
return TOKEN_PROGRAM_IDS.has(safeProgramId);
}

function getInstructionProgramId(instruction = {}) {
return (
cleanText(instruction?.programId?.toBase58?.(), 128) ||
cleanText(instruction?.programId, 128) ||
""
);
}

function isInitializeMintInstruction(instruction = {}) {
const parsedType = cleanText(instruction?.parsed?.type, 64);
const programId = getInstructionProgramId(instruction);

if (!parsedType || !programId) return false;
return isSupportedTokenProgram(programId) && INITIALIZE_MINT_TYPES.has(parsedType);
}

function extractMintFromInstruction(instruction = {}) {
if (!isInitializeMintInstruction(instruction)) return null;

const mint =
cleanText(instruction?.parsed?.info?.mint, 128) ||
cleanText(instruction?.parsed?.info?.account, 128);

return mint || null;
}

function normalizeCandidateMint(mint) {
const safeMint = cleanText(mint, 128);
if (!safeMint) return null;

try {
return new PublicKey(safeMint).toBase58();
} catch {
return null;
}
}

function safeParsedInstructions(transaction = {}) {
const outer = Array.isArray(transaction?.transaction?.message?.instructions)
? transaction.transaction.message.instructions
: [];

const innerSets = Array.isArray(transaction?.meta?.innerInstructions)
? transaction.meta.innerInstructions
: [];

const inner = innerSets.flatMap((set) =>
Array.isArray(set?.instructions) ? set.instructions : []
);

return [...outer, ...inner];
}

function extractCandidatesFromParsedBlock(block = {}, slot = null) {
const txs = Array.isArray(block?.transactions) ? block.transactions : [];
const found = new Map();

for (const tx of txs) {
const signature = cleanText(tx?.transaction?.signatures?.[0], 128) || null;
const instructions = safeParsedInstructions(tx);

for (const instruction of instructions) {
const mintStr = normalizeCandidateMint(extractMintFromInstruction(instruction));
if (!mintStr) continue;

if (!found.has(mintStr)) {
found.set(mintStr, {
mint: mintStr,
slot,
signature,
discovered_at: nowIso(),
source: PROVIDER_NAME,
});
}
}
}

return Array.from(found.values());
}

function isMissingOrSkippedBlockError(error) {
const msg = String(error?.message || error || "").toLowerCase();
return (
msg.includes("was skipped") ||
msg.includes("slot was skipped") ||
msg.includes("missing in long-term storage") ||
msg.includes("block not available") ||
msg.includes("not available for slot")
);
}

function mapWithConcurrency(items, limit, handler) {
const safeItems = Array.isArray(items) ? items : [];
const safeLimit = Math.max(
1,
toInt(limit, DEFAULT_SCAN_CONCURRENCY) || DEFAULT_SCAN_CONCURRENCY
);

if (!safeItems.length) return Promise.resolve([]);

let index = 0;
const results = new Array(safeItems.length);

async function worker() {
while (true) {
const current = index++;
if (current >= safeItems.length) break;

try {
results[current] = await handler(safeItems[current], current);
} catch (error) {
results[current] = {
ok: false,
error: String(error?.message || error),
item: safeItems[current],
};
}
}
}

return Promise.all(Array.from({ length: safeLimit }, () => worker())).then(
() => results
);
}

function dedupeCandidates(candidates = []) {
const map = new Map();

for (const candidate of Array.isArray(candidates) ? candidates : []) {
const mint = normalizeCandidateMint(candidate?.mint);
if (!mint) continue;

if (!map.has(mint)) {
map.set(mint, {
mint,
slot: candidate?.slot ?? null,
signature: cleanText(candidate?.signature, 128) || null,
discovered_at: cleanText(candidate?.discovered_at, 64) || nowIso(),
source: cleanText(candidate?.source, 120) || PROVIDER_NAME,
});
}
}

return Array.from(map.values());
}

function buildEmptyTickSummary() {
return {
started_at: null,
finished_at: null,
slot_start: null,
slot_end: null,
current_slot: null,
last_attempted_slot: null,
deadline_hit: false,
slots_seen: 0,
blocks_loaded: 0,
candidates_found: 0,
candidates_scanned: 0,
candidates_skipped_seen: 0,
candidates_skipped_cached: 0,
candidates_deferred: 0,
pending_candidates_start: 0,
pending_candidates_end: 0,
scan_successes: 0,
scan_failures: 0,
};
}

function buildStatus(state = {}) {
return {
started: Boolean(state.started),
running: Boolean(state.running),
pollIntervalMs: state.pollIntervalMs,
startupSlotLookback: state.startupSlotLookback,
maxSlotsPerTick: state.maxSlotsPerTick,
maxScansPerTick: state.maxScansPerTick,
scanConcurrency: state.scanConcurrency,
blockLoadConcurrency: state.blockLoadConcurrency,
seenTtlMs: state.seenTtlMs,
cacheSkipWindowMs: state.cacheSkipWindowMs,
getCurrentSlotTimeoutMs: state.getCurrentSlotTimeoutMs,
getSlotsTimeoutMs: state.getSlotsTimeoutMs,
loadBlockTimeoutMs: state.loadBlockTimeoutMs,
scanTimeoutMs: state.scanTimeoutMs,
tickDeadlineMs: state.tickDeadlineMs,
debug: Boolean(state.debug),
lastProcessedSlot: state.lastProcessedSlot,
pendingCandidates: state.pendingCandidates?.size || 0,
lastStartedAt: state.lastStartedAt,
lastStoppedAt: state.lastStoppedAt,
lastTickStartedAt: state.lastTickStartedAt,
lastTickFinishedAt: state.lastTickFinishedAt,
lastError: state.lastError || null,
tickCount: state.tickCount || 0,
totalCandidatesFound: state.totalCandidatesFound || 0,
totalCandidatesScanned: state.totalCandidatesScanned || 0,
totalScanSuccesses: state.totalScanSuccesses || 0,
totalScanFailures: state.totalScanFailures || 0,
lastTickSummary: state.lastTickSummary || buildEmptyTickSummary(),
providerName: PROVIDER_NAME,
};
}

export function createScannerDiscoveryService(deps = {}) {
const { connection, rpcRetry, scanSecurityForMint, logger = console } = deps;

ensureFunction(connection?.getSlot?.bind?.(connection), "connection.getSlot");
ensureFunction(connection?.getBlocks?.bind?.(connection), "connection.getBlocks");
ensureFunction(
connection?.getParsedBlock?.bind?.(connection),
"connection.getParsedBlock"
);
ensureFunction(scanSecurityForMint, "scanSecurityForMint");
ensureFunction(rpcRetry, "rpcRetry");

const state = {
started: false,
running: false,
intervalHandle: null,
pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
startupSlotLookback: DEFAULT_STARTUP_SLOT_LOOKBACK,
maxSlotsPerTick: DEFAULT_MAX_SLOTS_PER_TICK,
maxScansPerTick: DEFAULT_MAX_SCANS_PER_TICK,
scanConcurrency: DEFAULT_SCAN_CONCURRENCY,
blockLoadConcurrency: DEFAULT_BLOCK_LOAD_CONCURRENCY,
seenTtlMs: DEFAULT_SEEN_TTL_MS,
cacheSkipWindowMs: DEFAULT_CACHE_SKIP_WINDOW_MS,
getCurrentSlotTimeoutMs: DEFAULT_GET_CURRENT_SLOT_TIMEOUT_MS,
getSlotsTimeoutMs: DEFAULT_GET_SLOTS_TIMEOUT_MS,
loadBlockTimeoutMs: DEFAULT_LOAD_BLOCK_TIMEOUT_MS,
scanTimeoutMs: DEFAULT_SCAN_TIMEOUT_MS,
tickDeadlineMs: DEFAULT_TICK_DEADLINE_MS,
debug:
cleanText(process.env.SCANNER_DISCOVERY_DEBUG || "", 16).toLowerCase() ===
"true",
seenMints: new Map(),
pendingCandidates: new Map(),
lastProcessedSlot: null,
lastStartedAt: null,
lastStoppedAt: null,
lastTickStartedAt: null,
lastTickFinishedAt: null,
lastError: null,
tickCount: 0,
totalCandidatesFound: 0,
totalCandidatesScanned: 0,
totalScanSuccesses: 0,
totalScanFailures: 0,
lastTickSummary: buildEmptyTickSummary(),
};

function debugLog(message, payload = null) {
if (!state.debug) return;

if (payload == null) {
if (typeof logger?.info === "function") {
logger.info(`[scanner-discovery] ${message}`);
}
return;
}

if (typeof logger?.info === "function") {
logger.info(`[scanner-discovery] ${message}`, payload);
}
}

function warnLog(message, payload = null) {
if (typeof logger?.warn === "function") {
if (payload == null) {
logger.warn(`[scanner-discovery] ${message}`);
} else {
logger.warn(`[scanner-discovery] ${message}`, payload);
}
}
}

function errorLog(message, payload = null) {
if (typeof logger?.error === "function") {
if (payload == null) {
logger.error(`[scanner-discovery] ${message}`);
} else {
logger.error(`[scanner-discovery] ${message}`, payload);
}
}
}

function pruneSeenMints() {
const cutoff =
Date.now() - Math.max(60_000, toInt(state.seenTtlMs, DEFAULT_SEEN_TTL_MS));

for (const [mint, ts] of state.seenMints.entries()) {
if (!Number.isFinite(ts) || ts < cutoff) {
state.seenMints.delete(mint);
}
}
}

function markSeen(mintStr) {
state.seenMints.set(mintStr, Date.now());
}

function hasRecentSeen(mintStr) {
pruneSeenMints();
return state.seenMints.has(mintStr);
}

function enqueuePendingCandidates(candidates = []) {
for (const candidate of dedupeCandidates(candidates)) {
const mint = candidate.mint;
if (!mint) continue;
if (hasRecentSeen(mint)) continue;

if (!state.pendingCandidates.has(mint)) {
state.pendingCandidates.set(mint, candidate);
}
}
}

function getCombinedCandidateQueue(newCandidates = []) {
const pending = Array.from(state.pendingCandidates.values());
const combined = dedupeCandidates([...pending, ...newCandidates]);
const safeMaxScans = Math.max(
1,
toInt(state.maxScansPerTick, DEFAULT_MAX_SCANS_PER_TICK) ||
DEFAULT_MAX_SCANS_PER_TICK
);

const ready = combined.slice(0, safeMaxScans);
const deferred = combined.slice(safeMaxScans);

state.pendingCandidates.clear();
enqueuePendingCandidates(deferred);

return {
ready,
deferredCount: deferred.length,
};
}

function isAlreadyCachedRecently(mintStr) {
try {
const row = scannerDb
.prepare(
`
SELECT COALESCE(updated_at, created_at) AS cached_at
FROM scan_cache
WHERE mint = ?
ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, id DESC
LIMIT 1
`
)
.get(mintStr);

if (!row?.cached_at) return false;

const ts = Date.parse(row.cached_at);
if (!Number.isFinite(ts)) return true;

return Date.now() - ts < Math.max(60_000, state.cacheSkipWindowMs);
} catch {
return false;
}
}

async function getCurrentSlot() {
return await withTimeout(
() =>
rpcRetry(() => connection.getSlot("confirmed"), {
tries: 3,
baseDelayMs: 200,
}),
state.getCurrentSlotTimeoutMs,
"getCurrentSlot"
);
}

async function getSlotsToProcess(startSlot, endSlot) {
if (endSlot < startSlot) return [];

try {
return await withTimeout(
() =>
rpcRetry(() => connection.getBlocks(startSlot, endSlot, "confirmed"), {
tries: 2,
baseDelayMs: 250,
}),
state.getSlotsTimeoutMs,
`getBlocks ${startSlot}-${endSlot}`
);
} catch (error) {
warnLog("getBlocks failed, falling back to linear slot range", {
startSlot,
endSlot,
error: String(error?.message || error),
});

const slots = [];
for (let slot = startSlot; slot <= endSlot; slot += 1) {
slots.push(slot);
}
return slots;
}
}

async function loadParsedBlock(slot) {
try {
return await withTimeout(
() =>
rpcRetry(
() =>
connection.getParsedBlock(slot, {
maxSupportedTransactionVersion: 0,
commitment: "confirmed",
transactionDetails: "full",
rewards: false,
}),
{ tries: 2, baseDelayMs: 200 }
),
state.loadBlockTimeoutMs,
`getParsedBlock ${slot}`
);
} catch (error) {
if (isMissingOrSkippedBlockError(error)) {
return null;
}

warnLog("skipping slot after block load failure", {
slot,
error: String(error?.message || error),
});

return null;
}
}

async function scanCandidate(candidate) {
const mintStr = cleanText(candidate?.mint, 128);
if (!mintStr) {
return {
ok: false,
skipped: true,
reason: "invalid_mint",
mint: null,
};
}

if (hasRecentSeen(mintStr)) {
return {
ok: true,
skipped: true,
reason: "recently_seen",
mint: mintStr,
};
}

if (isAlreadyCachedRecently(mintStr)) {
markSeen(mintStr);
return {
ok: true,
skipped: true,
reason: "already_cached",
mint: mintStr,
};
}

let mint = null;
try {
mint = new PublicKey(mintStr);
} catch {
return {
ok: false,
skipped: true,
reason: "invalid_mint",
mint: null,
};
}

try {
const result = await withTimeout(
() =>
scanSecurityForMint({
mint,
mintStr,
source: cleanText(candidate?.source, 120) || PROVIDER_NAME,
slot: candidate?.slot ?? null,
signature: cleanText(candidate?.signature, 128) || null,
discovered_at: cleanText(candidate?.discovered_at, 64) || nowIso(),
}),
state.scanTimeoutMs,
`scanSecurityForMint ${mintStr}`
);

markSeen(mintStr);

return {
ok: true,
skipped: false,
reason: null,
mint: mintStr,
result,
};
} catch (error) {
markSeen(mintStr);

return {
ok: false,
skipped: false,
mint: mintStr,
error: String(error?.message || error),
};
}
}

async function collectCandidatesFromSlots(slots, summary, deadlineAt) {
const safeSlots = Array.isArray(slots) ? slots : [];
const workerCount = Math.max(
1,
Math.min(
safeSlots.length || 1,
toInt(state.blockLoadConcurrency, DEFAULT_BLOCK_LOAD_CONCURRENCY) ||
DEFAULT_BLOCK_LOAD_CONCURRENCY
)
);

const allCandidates = [];
let index = 0;
let lastAttemptedSlot = state.lastProcessedSlot;
let deadlineHit = false;

async function worker() {
while (true) {
if (Date.now() >= deadlineAt) {
deadlineHit = true;
return;
}

const current = index++;
if (current >= safeSlots.length) return;

const slot = safeSlots[current];
lastAttemptedSlot = Math.max(lastAttemptedSlot ?? 0, slot);

debugLog("loading parsed block", { slot });

const block = await loadParsedBlock(slot);
if (!block) continue;

summary.blocks_loaded += 1;

const blockCandidates = extractCandidatesFromParsedBlock(block, slot);
if (blockCandidates.length) {
allCandidates.push(...blockCandidates);
}
}
}

await Promise.all(Array.from({ length: workerCount }, () => worker()));

return {
candidates: allCandidates,
lastAttemptedSlot,
deadlineHit,
};
}

async function runTick({ seedFromCurrentSlot = false } = {}) {
if (state.running) {
return buildStatus(state);
}

state.running = true;
state.lastError = null;
state.lastTickStartedAt = nowIso();
state.tickCount += 1;

const summary = buildEmptyTickSummary();
summary.started_at = state.lastTickStartedAt;
summary.pending_candidates_start = state.pendingCandidates.size;

try {
debugLog("tick start", {
tickCount: state.tickCount,
seedFromCurrentSlot,
});

const currentSlot = await getCurrentSlot();
summary.current_slot = currentSlot;

if (state.lastProcessedSlot == null || seedFromCurrentSlot) {
state.lastProcessedSlot = Math.max(
0,
currentSlot -
Math.max(
1,
toInt(state.startupSlotLookback, DEFAULT_STARTUP_SLOT_LOOKBACK)
)
);
}

const slotStart = state.lastProcessedSlot + 1;
const slotEnd = Math.min(
currentSlot,
slotStart +
Math.max(1, toInt(state.maxSlotsPerTick, DEFAULT_MAX_SLOTS_PER_TICK)) -
1
);

summary.slot_start = slotStart;
summary.slot_end = slotEnd;

debugLog("tick slot window", {
currentSlot,
slotStart,
slotEnd,
lastProcessedSlot: state.lastProcessedSlot,
});

if (slotEnd < slotStart) {
state.lastTickFinishedAt = nowIso();
summary.finished_at = state.lastTickFinishedAt;
summary.pending_candidates_end = state.pendingCandidates.size;
state.lastTickSummary = summary;
return buildStatus(state);
}

const deadlineAt =
Date.now() +
Math.max(1000, toInt(state.tickDeadlineMs, DEFAULT_TICK_DEADLINE_MS));

const slots = await getSlotsToProcess(slotStart, slotEnd);
summary.slots_seen = Array.isArray(slots) ? slots.length : 0;

debugLog("slots fetched", {
requestedStart: slotStart,
requestedEnd: slotEnd,
slotsSeen: summary.slots_seen,
});

const {
candidates: newCandidates,
lastAttemptedSlot,
deadlineHit,
} = await collectCandidatesFromSlots(slots, summary, deadlineAt);

summary.last_attempted_slot = lastAttemptedSlot ?? null;
summary.deadline_hit = Boolean(deadlineHit);

const dedupedNewCandidates = dedupeCandidates(newCandidates);
summary.candidates_found = dedupedNewCandidates.length;
state.totalCandidatesFound += dedupedNewCandidates.length;

const { ready, deferredCount } = getCombinedCandidateQueue(dedupedNewCandidates);
summary.candidates_deferred = deferredCount;

debugLog("candidate summary", {
candidatesFound: summary.candidates_found,
candidatesQueued: ready.length,
candidatesDeferred: deferredCount,
blocksLoaded: summary.blocks_loaded,
deadlineHit,
});

const scanResults = await mapWithConcurrency(
ready,
state.scanConcurrency,
scanCandidate
);

for (const result of scanResults) {
if (!result) continue;

if (result.skipped && result.reason === "recently_seen") {
summary.candidates_skipped_seen += 1;
continue;
}

if (result.skipped && result.reason === "already_cached") {
summary.candidates_skipped_cached += 1;
continue;
}

if (!result.skipped) {
summary.candidates_scanned += 1;
state.totalCandidatesScanned += 1;
}

if (result.ok && !result.skipped) {
summary.scan_successes += 1;
state.totalScanSuccesses += 1;
continue;
}

if (!result.ok) {
summary.scan_failures += 1;
state.totalScanFailures += 1;

warnLog("candidate scan failed", {
mint: result.mint,
error: result.error,
});
}
}

state.lastProcessedSlot = deadlineHit
? Math.max(
state.lastProcessedSlot ?? 0,
lastAttemptedSlot ?? state.lastProcessedSlot ?? 0
)
: slotEnd;

state.lastTickFinishedAt = nowIso();
summary.finished_at = state.lastTickFinishedAt;
summary.pending_candidates_end = state.pendingCandidates.size;
state.lastTickSummary = summary;

debugLog("tick finish", {
lastProcessedSlot: state.lastProcessedSlot,
summary,
});

return buildStatus(state);
} catch (error) {
state.lastError = {
message: String(error?.message || error),
at: nowIso(),
};
state.lastTickFinishedAt = nowIso();
summary.finished_at = state.lastTickFinishedAt;
summary.pending_candidates_end = state.pendingCandidates.size;
state.lastTickSummary = summary;

errorLog("tick failed", error);

return buildStatus(state);
} finally {
state.running = false;
}
}

async function start(options = {}) {
if (state.started) {
return buildStatus(state);
}

state.pollIntervalMs = Math.max(
1000,
toInt(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS) ||
DEFAULT_POLL_INTERVAL_MS
);
state.startupSlotLookback = Math.max(
1,
toInt(options.startupSlotLookback, DEFAULT_STARTUP_SLOT_LOOKBACK) ||
DEFAULT_STARTUP_SLOT_LOOKBACK
);
state.maxSlotsPerTick = Math.max(
1,
toInt(options.maxSlotsPerTick, DEFAULT_MAX_SLOTS_PER_TICK) ||
DEFAULT_MAX_SLOTS_PER_TICK
);
state.maxScansPerTick = Math.max(
1,
toInt(options.maxScansPerTick, DEFAULT_MAX_SCANS_PER_TICK) ||
DEFAULT_MAX_SCANS_PER_TICK
);
state.scanConcurrency = Math.max(
1,
toInt(options.scanConcurrency, DEFAULT_SCAN_CONCURRENCY) ||
DEFAULT_SCAN_CONCURRENCY
);
state.blockLoadConcurrency = Math.max(
1,
toInt(options.blockLoadConcurrency, DEFAULT_BLOCK_LOAD_CONCURRENCY) ||
DEFAULT_BLOCK_LOAD_CONCURRENCY
);
state.seenTtlMs = Math.max(
60_000,
toInt(options.seenTtlMs, DEFAULT_SEEN_TTL_MS) || DEFAULT_SEEN_TTL_MS
);
state.cacheSkipWindowMs = Math.max(
60_000,
toInt(options.cacheSkipWindowMs, DEFAULT_CACHE_SKIP_WINDOW_MS) ||
DEFAULT_CACHE_SKIP_WINDOW_MS
);
state.getCurrentSlotTimeoutMs = Math.max(
1000,
toInt(
options.getCurrentSlotTimeoutMs,
DEFAULT_GET_CURRENT_SLOT_TIMEOUT_MS
) || DEFAULT_GET_CURRENT_SLOT_TIMEOUT_MS
);
state.getSlotsTimeoutMs = Math.max(
1000,
toInt(options.getSlotsTimeoutMs, DEFAULT_GET_SLOTS_TIMEOUT_MS) ||
DEFAULT_GET_SLOTS_TIMEOUT_MS
);
state.loadBlockTimeoutMs = Math.max(
1000,
toInt(options.loadBlockTimeoutMs, DEFAULT_LOAD_BLOCK_TIMEOUT_MS) ||
DEFAULT_LOAD_BLOCK_TIMEOUT_MS
);
state.scanTimeoutMs = Math.max(
1000,
toInt(options.scanTimeoutMs, DEFAULT_SCAN_TIMEOUT_MS) ||
DEFAULT_SCAN_TIMEOUT_MS
);
state.tickDeadlineMs = Math.max(
1000,
toInt(options.tickDeadlineMs, DEFAULT_TICK_DEADLINE_MS) ||
DEFAULT_TICK_DEADLINE_MS
);
state.debug =
options.debug != null
? Boolean(options.debug)
: cleanText(process.env.SCANNER_DISCOVERY_DEBUG || "", 16).toLowerCase() ===
"true";

state.started = true;
state.lastStartedAt = nowIso();
state.lastStoppedAt = null;

await runTick({ seedFromCurrentSlot: true });

state.intervalHandle = setInterval(() => {
runTick().catch((error) => {
state.lastError = {
message: String(error?.message || error),
at: nowIso(),
};

errorLog("interval tick failed", error);
});
}, state.pollIntervalMs);

if (typeof state.intervalHandle?.unref === "function") {
state.intervalHandle.unref();
}

return buildStatus(state);
}

async function stop() {
if (state.intervalHandle) {
clearInterval(state.intervalHandle);
state.intervalHandle = null;
}

state.started = false;
state.running = false;
state.lastStoppedAt = nowIso();

return buildStatus(state);
}

function getStatus() {
return buildStatus(state);
}

return {
start,
stop,
runTick,
getStatus,
};
}

export default {
createScannerDiscoveryService,
};
