import db from "../../../db/index.js";

export const SENTINEL_MODE = {
PAPER: "paper",
ARMED_MAINNET: "armed_mainnet",
LIVE_MAINNET: "live_mainnet",
EMERGENCY_STOP: "emergency_stop",
};

export const DEFAULT_SENTINEL_CONFIG = {
watcher_enabled: true,
execution_mode: SENTINEL_MODE.PAPER,

auto_bank_enabled: true,
auto_bank_multiple: 10,
auto_bank_fraction: 0.5,

scout_usd: 0.5,
sniper_add_usd: 1.0,
max_total_position_usd: 1.5,
max_open_positions: 30,
max_positions_per_operator_cluster: 2,

max_daily_loss_usd: 25,
max_daily_scout_spend_usd: 20,
max_daily_sniper_spend_usd: 30,
max_consecutive_failures: 8,
max_tokens_per_hour: 12,

cooldown_after_close_sec: 1800,
cooldown_after_invalidation_sec: 3600,
early_fail_timeout_sec: 180,
weak_stall_timeout_sec: 420,
runner_failed_breakout_limit: 2,

min_operator_quality_score: 70,
max_hidden_control_risk: 30,
max_contamination_risk: 35,
max_wallet_coordination_risk: 40,

min_regime_score_for_scout: 55,
min_regime_score_for_sniper: 65,

max_top_holder_pct: 18,
max_top_5_holder_pct: 45,
min_liquidity_usd: 800,
max_spread_bps: 350,
max_price_impact_bps: 500,

min_reclaim_strength_score: 60,
min_buy_pressure_score: 62,
min_persistence_score: 58,
min_post_entry_health_score: 55,
max_vertical_extension_score_for_add: 75,
max_insider_sell_score: 45,
max_liquidity_decay_score: 50,

risk_off_disable_new_entries: true,

enable_scout: true,
enable_sniper: true,
enable_runner_management: true,
enable_market_regime_filter: true,
enable_operator_filter: true,
enable_hard_rejects: true,
};

const BOOLEAN_FIELDS = new Set([
"watcher_enabled",
"auto_bank_enabled",
"risk_off_disable_new_entries",
"enable_scout",
"enable_sniper",
"enable_runner_management",
"enable_market_regime_filter",
"enable_operator_filter",
"enable_hard_rejects",
]);

const INTEGER_FIELDS = new Set([
"max_open_positions",
"max_positions_per_operator_cluster",
"max_consecutive_failures",
"max_tokens_per_hour",
"cooldown_after_close_sec",
"cooldown_after_invalidation_sec",
"early_fail_timeout_sec",
"weak_stall_timeout_sec",
"runner_failed_breakout_limit",
]);

const FLOAT_FIELDS = new Set([
"auto_bank_multiple",
"auto_bank_fraction",
"scout_usd",
"sniper_add_usd",
"max_total_position_usd",
"max_daily_loss_usd",
"max_daily_scout_spend_usd",
"max_daily_sniper_spend_usd",
"min_operator_quality_score",
"max_hidden_control_risk",
"max_contamination_risk",
"max_wallet_coordination_risk",
"min_regime_score_for_scout",
"min_regime_score_for_sniper",
"max_top_holder_pct",
"max_top_5_holder_pct",
"min_liquidity_usd",
"max_spread_bps",
"max_price_impact_bps",
"min_reclaim_strength_score",
"min_buy_pressure_score",
"min_persistence_score",
"min_post_entry_health_score",
"max_vertical_extension_score_for_add",
"max_insider_sell_score",
"max_liquidity_decay_score",
]);

function cleanMode(value) {
const mode = String(value ?? "").trim().toLowerCase();
return Object.values(SENTINEL_MODE).includes(mode) ? mode : SENTINEL_MODE.PAPER;
}

function toBool(value, fallback = false) {
if (typeof value === "boolean") return value;
if (value === 1 || value === "1" || value === "true") return true;
if (value === 0 || value === "0" || value === "false") return false;
return fallback;
}

function toInt(value, fallback = 0) {
const num = Number.parseInt(value, 10);
return Number.isFinite(num) ? num : fallback;
}

function toFloat(value, fallback = 0) {
const num = Number.parseFloat(value);
return Number.isFinite(num) ? num : fallback;
}

function normalizeField(key, value, fallbackValue) {
if (key === "execution_mode") {
return cleanMode(value ?? fallbackValue);
}

if (BOOLEAN_FIELDS.has(key)) {
return toBool(value, Boolean(fallbackValue));
}

if (INTEGER_FIELDS.has(key)) {
return toInt(value, toInt(fallbackValue, 0));
}

if (FLOAT_FIELDS.has(key)) {
return toFloat(value, toFloat(fallbackValue, 0));
}

return value ?? fallbackValue;
}

function applyClampRules(config) {
const next = { ...config };

next.auto_bank_multiple = Math.max(1, next.auto_bank_multiple);
next.auto_bank_fraction = Math.min(1, Math.max(0.01, next.auto_bank_fraction));

next.scout_usd = Math.max(0.01, next.scout_usd);
next.sniper_add_usd = Math.max(0.01, next.sniper_add_usd);
next.max_total_position_usd = Math.max(
Math.max(next.scout_usd, next.sniper_add_usd),
next.max_total_position_usd
);

next.max_open_positions = Math.max(1, next.max_open_positions);
next.max_positions_per_operator_cluster = Math.max(
1,
next.max_positions_per_operator_cluster
);

next.max_daily_loss_usd = Math.max(0, next.max_daily_loss_usd);
next.max_daily_scout_spend_usd = Math.max(0, next.max_daily_scout_spend_usd);
next.max_daily_sniper_spend_usd = Math.max(0, next.max_daily_sniper_spend_usd);
next.max_consecutive_failures = Math.max(0, next.max_consecutive_failures);
next.max_tokens_per_hour = Math.max(0, next.max_tokens_per_hour);

next.cooldown_after_close_sec = Math.max(0, next.cooldown_after_close_sec);
next.cooldown_after_invalidation_sec = Math.max(
0,
next.cooldown_after_invalidation_sec
);
next.early_fail_timeout_sec = Math.max(0, next.early_fail_timeout_sec);
next.weak_stall_timeout_sec = Math.max(0, next.weak_stall_timeout_sec);
next.runner_failed_breakout_limit = Math.max(0, next.runner_failed_breakout_limit);

[
"min_operator_quality_score",
"max_hidden_control_risk",
"max_contamination_risk",
"max_wallet_coordination_risk",
"min_regime_score_for_scout",
"min_regime_score_for_sniper",
"max_top_holder_pct",
"max_top_5_holder_pct",
"min_reclaim_strength_score",
"min_buy_pressure_score",
"min_persistence_score",
"min_post_entry_health_score",
"max_vertical_extension_score_for_add",
"max_insider_sell_score",
"max_liquidity_decay_score",
].forEach((field) => {
next[field] = Math.min(100, Math.max(0, next[field]));
});

next.min_liquidity_usd = Math.max(0, next.min_liquidity_usd);
next.max_spread_bps = Math.max(0, next.max_spread_bps);
next.max_price_impact_bps = Math.max(0, next.max_price_impact_bps);

return next;
}

export function normalizeSentinelConfig(raw = {}) {
const merged = { ...DEFAULT_SENTINEL_CONFIG, ...(raw || {}) };
const normalized = {};

for (const [key, defaultValue] of Object.entries(DEFAULT_SENTINEL_CONFIG)) {
normalized[key] = normalizeField(key, merged[key], defaultValue);
}

normalized.execution_mode = cleanMode(normalized.execution_mode);

return applyClampRules(normalized);
}

export function getDefaultSentinelConfig() {
return normalizeSentinelConfig(DEFAULT_SENTINEL_CONFIG);
}

export async function loadSentinelConfig() {
const row = await db.get(`SELECT * FROM cassie_sentinel_settings WHERE id = 1`);
return normalizeSentinelConfig(row || {});
}

export async function getSentinelExecutionMode() {
const config = await loadSentinelConfig();
return config.execution_mode;
}

export async function isSentinelWatcherEnabled() {
const config = await loadSentinelConfig();
return Boolean(config.watcher_enabled);
}

export async function isSentinelEmergencyStopActive() {
const mode = await getSentinelExecutionMode();
return mode === SENTINEL_MODE.EMERGENCY_STOP;
}

export function isPaperMode(config) {
return cleanMode(config?.execution_mode) === SENTINEL_MODE.PAPER;
}

export function isArmedMainnetMode(config) {
return cleanMode(config?.execution_mode) === SENTINEL_MODE.ARMED_MAINNET;
}

export function isLiveMainnetMode(config) {
return cleanMode(config?.execution_mode) === SENTINEL_MODE.LIVE_MAINNET;
}

export function isEmergencyStopMode(config) {
return cleanMode(config?.execution_mode) === SENTINEL_MODE.EMERGENCY_STOP;
}

export function canEvaluateSentinel(config) {
const safe = normalizeSentinelConfig(config || {});
return safe.watcher_enabled === true;
}

export function canOpenNewPositions(config) {
const safe = normalizeSentinelConfig(config || {});
if (!safe.watcher_enabled) return false;
if (safe.execution_mode === SENTINEL_MODE.EMERGENCY_STOP) return false;
return true;
}

export function getEffectiveSentinelConfig(config) {
const safe = normalizeSentinelConfig(config || {});

if (safe.execution_mode !== SENTINEL_MODE.EMERGENCY_STOP) {
return safe;
}

return {
...safe,
watcher_enabled: true,
enable_scout: false,
enable_sniper: false,
};
}

export default {
SENTINEL_MODE,
DEFAULT_SENTINEL_CONFIG,
normalizeSentinelConfig,
getDefaultSentinelConfig,
loadSentinelConfig,
getSentinelExecutionMode,
isSentinelWatcherEnabled,
isSentinelEmergencyStopActive,
isPaperMode,
isArmedMainnetMode,
isLiveMainnetMode,
isEmergencyStopMode,
canEvaluateSentinel,
canOpenNewPositions,
getEffectiveSentinelConfig,
};
