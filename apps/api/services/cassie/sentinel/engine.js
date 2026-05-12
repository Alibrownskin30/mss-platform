import {
SENTINEL_MODE,
loadSentinelConfig,
getEffectiveSentinelConfig,
normalizeSentinelConfig,
} from "./config.js";
import { processPaperSnapshots } from "./paper-engine.js";

const DEFAULT_TICK_INTERVAL_MS = 5000;

const engineState = {
started: false,
running: false,
interval_ms: DEFAULT_TICK_INTERVAL_MS,
timer: null,

snapshot_provider: null,
snapshot_provider_name: null,
last_provider_meta: null,

last_started_at: null,
last_stopped_at: null,
last_tick_started_at: null,
last_tick_finished_at: null,
last_error: null,

tick_count: 0,
total_snapshots_seen: 0,
total_snapshots_processed: 0,

current_mode: SENTINEL_MODE.PAPER,
watcher_enabled: false,

last_tick_summary: null,
};

function nowIso() {
return new Date().toISOString();
}

function cleanText(value, max = 255) {
return String(value ?? "").trim().slice(0, max);
}

function toInt(value, fallback = 0) {
const num = Number.parseInt(value, 10);
return Number.isFinite(num) ? num : fallback;
}

function sleep(ms = 0) {
return new Promise((resolve) =>
setTimeout(resolve, Math.max(0, toInt(ms, 0)))
);
}

function serializeError(error) {
if (!error) return null;
return {
message: cleanText(error?.message || String(error), 2000),
stack: cleanText(error?.stack || "", 8000) || null,
};
}

function normalizeSnapshotsPayload(payload) {
if (Array.isArray(payload)) {
return {
snapshots: payload,
meta: null,
};
}

if (payload && typeof payload === "object") {
return {
snapshots: Array.isArray(payload.snapshots) ? payload.snapshots : [],
meta: payload.meta ?? null,
};
}

return {
snapshots: [],
meta: null,
};
}

function buildEmptySummary(extra = {}) {
return {
total: 0,
scout_entry: 0,
sniper_add: 0,
partial_take_profit: 0,
full_exit: 0,
reject: 0,
watchlist: 0,
hold: 0,
kill_switch: 0,
simulated: 0,
skipped: 0,
audit_events: 0,
positions_touched: 0,
execution_mode: null,
watcher_enabled: false,
snapshots_seen: 0,
snapshots_processed: 0,
provider_name: null,
provider_meta: null,
skipped_reason: null,
error: null,
...extra,
};
}

function summarizeResults(results = []) {
const safeResults = Array.isArray(results) ? results : [];
const summary = buildEmptySummary({ total: safeResults.length });
const touchedPositionIds = new Set();

for (const item of safeResults) {
const decision = cleanText(
item?.decision || item?.evaluation?.decision,
64
).toLowerCase();

if (Object.prototype.hasOwnProperty.call(summary, decision)) {
summary[decision] += 1;
}

if (item?.simulated) {
summary.simulated += 1;
}

if (item?.skipped) {
summary.skipped += 1;
}

if (item?.audit_event?.id) {
summary.audit_events += 1;
}

const positionId =
item?.position?.id ||
item?.evaluation?.position?.id ||
item?.audit_event?.position_id ||
null;

if (positionId) {
touchedPositionIds.add(String(positionId));
}
}

summary.positions_touched = touchedPositionIds.size;
return summary;
}

function getUnsupportedModeResults(snapshots = [], mode = SENTINEL_MODE.PAPER) {
return (Array.isArray(snapshots) ? snapshots : []).map((snapshot) => ({
ok: true,
execution_mode: mode,
simulated: false,
skipped: true,
reason: "execution_mode_not_implemented",
evaluation: {
decision: "watchlist",
reason_codes: [],
snapshot,
position: null,
meta: {
halt_reason: "engine_mode_not_implemented",
},
},
audit_event: null,
}));
}

async function resolveSnapshots({
snapshots = null,
provider = null,
config = null,
context = {},
} = {}) {
if (Array.isArray(snapshots)) {
return {
snapshots,
meta: {
source: "direct_input",
},
};
}

const activeProvider = provider || engineState.snapshot_provider;
if (typeof activeProvider !== "function") {
return {
snapshots: [],
meta: {
source: "no_provider",
},
};
}

const payload = await activeProvider({
config,
mode: config?.execution_mode || SENTINEL_MODE.PAPER,
watcher_enabled: Boolean(config?.watcher_enabled),
context: {
...context,
execution_mode: config?.execution_mode || SENTINEL_MODE.PAPER,
},
now: nowIso(),
});

return normalizeSnapshotsPayload(payload);
}

function armEngineInterval() {
if (engineState.timer) {
clearInterval(engineState.timer);
engineState.timer = null;
}

engineState.timer = setInterval(() => {
tickLoop().catch((error) => {
engineState.last_error = serializeError(error);
console.error("Sentinel engine interval tick crashed", error);
});
}, engineState.interval_ms);

if (typeof engineState.timer?.unref === "function") {
engineState.timer.unref();
}
}

export function setSentinelSnapshotProvider(
providerFn,
providerName = "custom_provider"
) {
if (typeof providerFn !== "function") {
throw new Error("Sentinel snapshot provider must be a function.");
}

engineState.snapshot_provider = providerFn;
engineState.snapshot_provider_name =
cleanText(providerName, 120) || "custom_provider";

return getSentinelEngineStatus();
}

export function clearSentinelSnapshotProvider() {
engineState.snapshot_provider = null;
engineState.snapshot_provider_name = null;
engineState.last_provider_meta = null;
return getSentinelEngineStatus();
}

export function getSentinelEngineStatus() {
return {
started: engineState.started,
running: engineState.running,
interval_ms: engineState.interval_ms,
snapshot_provider_name: engineState.snapshot_provider_name,
last_provider_meta: engineState.last_provider_meta,
last_started_at: engineState.last_started_at,
last_stopped_at: engineState.last_stopped_at,
last_tick_started_at: engineState.last_tick_started_at,
last_tick_finished_at: engineState.last_tick_finished_at,
last_error: engineState.last_error,
tick_count: engineState.tick_count,
total_snapshots_seen: engineState.total_snapshots_seen,
total_snapshots_processed: engineState.total_snapshots_processed,
current_mode: engineState.current_mode,
watcher_enabled: engineState.watcher_enabled,
last_tick_summary: engineState.last_tick_summary,
};
}

export async function runSentinelTick({
snapshots = null,
provider = null,
configOverride = null,
context = {},
} = {}) {
if (engineState.running) {
return {
ok: false,
skipped: true,
reason: "tick_already_running",
status: getSentinelEngineStatus(),
};
}

engineState.running = true;
engineState.last_tick_started_at = nowIso();
engineState.last_error = null;

try {
const loadedConfig = configOverride
? normalizeSentinelConfig(configOverride)
: await loadSentinelConfig();

const effectiveConfig = getEffectiveSentinelConfig(loadedConfig);

engineState.current_mode =
effectiveConfig.execution_mode || SENTINEL_MODE.PAPER;
engineState.watcher_enabled = Boolean(effectiveConfig.watcher_enabled);

if (!effectiveConfig.watcher_enabled) {
const summary = buildEmptySummary({
execution_mode: effectiveConfig.execution_mode,
watcher_enabled: false,
provider_name: engineState.snapshot_provider_name,
provider_meta: null,
skipped_reason: "watcher_disabled",
});

engineState.tick_count += 1;
engineState.last_provider_meta = null;
engineState.last_tick_summary = summary;
engineState.last_tick_finished_at = nowIso();

return {
ok: true,
skipped: true,
reason: "watcher_disabled",
execution_mode: effectiveConfig.execution_mode,
watcher_enabled: false,
snapshots_seen: 0,
snapshots_processed: 0,
results: [],
summary,
};
}

const resolved = await resolveSnapshots({
snapshots,
provider,
config: effectiveConfig,
context,
});

const safeSnapshots = Array.isArray(resolved?.snapshots)
? resolved.snapshots
: [];
const providerMeta = resolved?.meta ?? null;

engineState.last_provider_meta = providerMeta;
engineState.total_snapshots_seen += safeSnapshots.length;

let results = [];

switch (effectiveConfig.execution_mode) {
case SENTINEL_MODE.PAPER: {
results = await processPaperSnapshots(safeSnapshots, effectiveConfig, {
...context,
execution_mode: SENTINEL_MODE.PAPER,
});
break;
}

case SENTINEL_MODE.ARMED_MAINNET:
case SENTINEL_MODE.LIVE_MAINNET:
case SENTINEL_MODE.EMERGENCY_STOP:
default: {
results = getUnsupportedModeResults(
safeSnapshots,
effectiveConfig.execution_mode || SENTINEL_MODE.PAPER
);
break;
}
}

engineState.total_snapshots_processed += safeSnapshots.length;
engineState.tick_count += 1;

const summary = {
...summarizeResults(results),
execution_mode: effectiveConfig.execution_mode,
watcher_enabled: true,
snapshots_seen: safeSnapshots.length,
snapshots_processed: safeSnapshots.length,
provider_name: engineState.snapshot_provider_name,
provider_meta: providerMeta,
};

engineState.last_tick_summary = summary;
engineState.last_tick_finished_at = nowIso();

return {
ok: true,
skipped: false,
execution_mode: effectiveConfig.execution_mode,
watcher_enabled: true,
snapshots_seen: safeSnapshots.length,
snapshots_processed: safeSnapshots.length,
provider_name: engineState.snapshot_provider_name,
provider_meta: providerMeta,
results,
summary,
};
} catch (error) {
engineState.last_error = serializeError(error);
engineState.tick_count += 1;
engineState.last_tick_summary = buildEmptySummary({
execution_mode: engineState.current_mode,
watcher_enabled: engineState.watcher_enabled,
provider_name: engineState.snapshot_provider_name,
provider_meta: engineState.last_provider_meta,
error: engineState.last_error?.message || "unknown_error",
});
engineState.last_tick_finished_at = nowIso();

return {
ok: false,
skipped: false,
error: engineState.last_error,
status: getSentinelEngineStatus(),
};
} finally {
engineState.running = false;
}
}

async function tickLoop() {
const result = await runSentinelTick();
if (!result?.ok) {
console.error("Sentinel engine tick failed", result?.error || result);
}
}

export async function startSentinelEngine({
intervalMs = DEFAULT_TICK_INTERVAL_MS,
provider = null,
providerName = null,
runImmediate = true,
} = {}) {
if (provider) {
setSentinelSnapshotProvider(provider, providerName || "runtime_provider");
}

const safeInterval = Math.max(
1000,
toInt(intervalMs, DEFAULT_TICK_INTERVAL_MS)
);
engineState.interval_ms = safeInterval;

if (engineState.started) {
armEngineInterval();
return getSentinelEngineStatus();
}

engineState.started = true;
engineState.last_started_at = nowIso();
engineState.last_stopped_at = null;
engineState.last_error = null;

if (runImmediate) {
await tickLoop();
}

armEngineInterval();

return getSentinelEngineStatus();
}

export async function stopSentinelEngine({ waitForActiveTick = true } = {}) {
if (engineState.timer) {
clearInterval(engineState.timer);
engineState.timer = null;
}

if (waitForActiveTick && engineState.running) {
for (let i = 0; i < 50; i += 1) {
if (!engineState.running) break;
await sleep(100);
}
}

engineState.started = false;
engineState.last_stopped_at = nowIso();

return getSentinelEngineStatus();
}

export function isSentinelEngineStarted() {
return Boolean(engineState.started);
}

export function isSentinelEngineRunning() {
return Boolean(engineState.running);
}

export default {
setSentinelSnapshotProvider,
clearSentinelSnapshotProvider,
getSentinelEngineStatus,
runSentinelTick,
startSentinelEngine,
stopSentinelEngine,
isSentinelEngineStarted,
isSentinelEngineRunning,
};
