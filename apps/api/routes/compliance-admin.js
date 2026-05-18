import express from "express"
import db from "../db/index.js"
import auditLog from "../services/compliance/auditLog.js"
import {
DEFAULT_SENTINEL_CONFIG,
normalizeSentinelConfig,
} from "../services/cassie/sentinel/config.js"
import {
REASON_CODE,
ensureReasonCodeArray,
} from "../services/cassie/sentinel/reason-codes.js"
import { getSentinelEngineStatus } from "../services/cassie/sentinel/engine.js"

const router = express.Router()

const CASE_STATUSES = new Set([
"open",
"pending_info",
"approved",
"rejected",
"escalated",
"frozen",
])

const RISK_LEVELS = new Set(["low", "medium", "high", "critical"])

const SENTINEL_MODES = new Set([
"paper",
"armed_mainnet",
"live_mainnet",
"emergency_stop",
])

const SENTINEL_POSITION_STAGES = new Set([
"scout_open",
"sniper_added",
"half_banked_at_10x",
"runner_only",
"closed",
"invalidated",
])

const SENTINEL_HISTORY_POSITION_STAGES = new Set(["closed", "invalidated"])

const SENTINEL_POSITION_SCOPES = new Set(["open", "history", "all"])

const SENTINEL_SUMMARY_PERIODS = new Set([
"daily",
"weekly",
"monthly",
"overall",
])

const SENTINEL_AUDIT_EVENT_TYPES = new Set([
"settings_update",
"mode_change",
"emergency_stop",
"token_reject",
"scout_entry",
"sniper_add",
"partial_take_profit",
"runner_exit",
"full_exit",
"kill_switch",
"watchlist",
"hold",
"decision",
])

const SENTINEL_AUDIT_EXECUTION_STATUSES = new Set([
"planned",
"simulated",
"submitted",
"filled",
"failed",
"skipped",
])

const SENTINEL_AUDIT_ACTOR_TYPES = new Set(["system", "admin", "user"])

const SENTINEL_SETTINGS_FIELDS = Object.keys(DEFAULT_SENTINEL_CONFIG)

const SENTINEL_PATCH_FIELDS = {
watcher_enabled: { type: "boolean" },
auto_bank_enabled: { type: "boolean" },
auto_bank_multiple: { type: "float", min: 1, max: 1000 },
auto_bank_fraction: { type: "float", min: 0.01, max: 1 },

scout_usd: { type: "float", min: 0.01, max: 100000 },
sniper_add_usd: { type: "float", min: 0.01, max: 100000 },
max_total_position_usd: { type: "float", min: 0.01, max: 1000000 },
max_open_positions: { type: "int", min: 1, max: 10000 },
max_positions_per_operator_cluster: { type: "int", min: 1, max: 1000 },

max_daily_loss_usd: { type: "float", min: 0, max: 1000000 },
max_daily_scout_spend_usd: { type: "float", min: 0, max: 1000000 },
max_daily_sniper_spend_usd: { type: "float", min: 0, max: 1000000 },
max_consecutive_failures: { type: "int", min: 0, max: 1000 },
max_tokens_per_hour: { type: "int", min: 0, max: 10000 },

cooldown_after_close_sec: { type: "int", min: 0, max: 604800 },
cooldown_after_invalidation_sec: { type: "int", min: 0, max: 604800 },
early_fail_timeout_sec: { type: "int", min: 0, max: 86400 },
weak_stall_timeout_sec: { type: "int", min: 0, max: 86400 },
runner_failed_breakout_limit: { type: "int", min: 0, max: 100 },

min_operator_quality_score: { type: "float", min: 0, max: 100 },
max_hidden_control_risk: { type: "float", min: 0, max: 100 },
max_contamination_risk: { type: "float", min: 0, max: 100 },
max_wallet_coordination_risk: { type: "float", min: 0, max: 100 },
min_regime_score_for_scout: { type: "float", min: 0, max: 100 },
min_regime_score_for_sniper: { type: "float", min: 0, max: 100 },

max_top_holder_pct: { type: "float", min: 0, max: 100 },
max_top_5_holder_pct: { type: "float", min: 0, max: 100 },
min_liquidity_usd: { type: "float", min: 0, max: 1000000000 },
max_spread_bps: { type: "float", min: 0, max: 100000 },
max_price_impact_bps: { type: "float", min: 0, max: 100000 },

min_reclaim_strength_score: { type: "float", min: 0, max: 100 },
min_buy_pressure_score: { type: "float", min: 0, max: 100 },
min_persistence_score: { type: "float", min: 0, max: 100 },
min_post_entry_health_score: { type: "float", min: 0, max: 100 },
max_vertical_extension_score_for_add: { type: "float", min: 0, max: 100 },
max_insider_sell_score: { type: "float", min: 0, max: 100 },
max_liquidity_decay_score: { type: "float", min: 0, max: 100 },

risk_off_disable_new_entries: { type: "boolean" },

enable_scout: { type: "boolean" },
enable_sniper: { type: "boolean" },
enable_runner_management: { type: "boolean" },
enable_market_regime_filter: { type: "boolean" },
enable_operator_filter: { type: "boolean" },
enable_hard_rejects: { type: "boolean" },
}

const TABLE_INFO_SQL = {
cassie_sentinel_settings: `PRAGMA table_info(cassie_sentinel_settings)`,
cassie_admin_audit_log: `PRAGMA table_info(cassie_admin_audit_log)`,
}

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max)
}

function parseIntSafe(value, fallback = null) {
const num = Number.parseInt(value, 10)
return Number.isFinite(num) ? num : fallback
}

function parseFloatSafe(value, fallback = null) {
const num = Number.parseFloat(value)
return Number.isFinite(num) ? num : fallback
}

function parseBoolSafe(value, fallback = false) {
if (typeof value === "boolean") return value
if (value === 1 || value === "1" || value === "true") return true
if (value === 0 || value === "0" || value === "false") return false
return fallback
}

function normalizeRiskLevel(value, fallback = "low") {
const normalized = cleanText(value, 32).toLowerCase()
return RISK_LEVELS.has(normalized) ? normalized : fallback
}

function normalizeSentinelMode(value, fallback = "paper") {
const normalized = cleanText(value, 64).toLowerCase()
return SENTINEL_MODES.has(normalized) ? normalized : fallback
}

function normalizeSentinelPositionScope(value, fallback = "open") {
const normalized = cleanText(value, 32).toLowerCase()
return SENTINEL_POSITION_SCOPES.has(normalized) ? normalized : fallback
}

function normalizeSentinelSummaryPeriod(value, fallback = "daily") {
const normalized = cleanText(value, 32).toLowerCase()
return SENTINEL_SUMMARY_PERIODS.has(normalized) ? normalized : fallback
}

function normalizeSentinelAuditActorType(value, fallback = "") {
const normalized = cleanText(value, 32).toLowerCase()
return SENTINEL_AUDIT_ACTOR_TYPES.has(normalized) ? normalized : fallback
}

function normalizeSentinelAuditExecutionStatus(value, fallback = "") {
const normalized = cleanText(value, 32).toLowerCase()
return SENTINEL_AUDIT_EXECUTION_STATUSES.has(normalized)
? normalized
: fallback
}

function parseJson(value, fallback = null) {
if (!value) return fallback
if (typeof value === "object") return value

try {
return JSON.parse(value)
} catch {
return fallback
}
}

function todayUtcDate() {
return new Date().toISOString().slice(0, 10)
}

function isDateOnly(value) {
return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))
}

function parseDateOnly(value, fallback = todayUtcDate()) {
const cleaned = cleanText(value, 32)
return isDateOnly(cleaned) ? cleaned : fallback
}

function dateOnlyToUtcDate(dateOnly) {
const safe = parseDateOnly(dateOnly)
const [year, month, day] = safe.split("-").map((part) => Number(part))
return new Date(Date.UTC(year, month - 1, day))
}

function utcDateToDateOnly(date) {
return date.toISOString().slice(0, 10)
}

function addUtcDays(dateOnly, days) {
const date = dateOnlyToUtcDate(dateOnly)
date.setUTCDate(date.getUTCDate() + Number(days || 0))
return utcDateToDateOnly(date)
}

function getSentinelPeriodRange(period = "daily", anchorDate = todayUtcDate()) {
const normalizedPeriod = normalizeSentinelSummaryPeriod(period, "daily")
const endDate = parseDateOnly(anchorDate)

if (normalizedPeriod === "overall") {
return {
period: normalizedPeriod,
start_date: null,
end_date: endDate,
label: "Overall",
rolling_days: null,
}
}

if (normalizedPeriod === "weekly") {
return {
period: normalizedPeriod,
start_date: addUtcDays(endDate, -6),
end_date: endDate,
label: "Weekly",
rolling_days: 7,
}
}

if (normalizedPeriod === "monthly") {
return {
period: normalizedPeriod,
start_date: addUtcDays(endDate, -29),
end_date: endDate,
label: "Monthly",
rolling_days: 30,
}
}

return {
period: "daily",
start_date: endDate,
end_date: endDate,
label: "Daily",
rolling_days: 1,
}
}

function toDbValue(value) {
if (typeof value === "boolean") return value ? 1 : 0
return value
}

function parsePatchFieldValue(rawValue, rule) {
if (rule.type === "boolean") {
return parseBoolSafe(rawValue, false)
}

if (rule.type === "int") {
const parsed = parseIntSafe(rawValue, null)
if (parsed == null) return null
return parsed
}

if (rule.type === "float") {
const parsed = parseFloatSafe(rawValue, null)
if (parsed == null) return null
return parsed
}

return rawValue
}

function isOutOfRange(value, rule = {}) {
if (typeof value !== "number") return false
if (rule.min != null && value < rule.min) return true
if (rule.max != null && value > rule.max) return true
return false
}

function computeChangedFields(before = {}, after = {}) {
return SENTINEL_SETTINGS_FIELDS.filter(
(field) => JSON.stringify(before?.[field]) !== JSON.stringify(after?.[field])
)
}

function serializeSentinelSettings(row) {
const normalized = normalizeSentinelConfig({
...DEFAULT_SENTINEL_CONFIG,
...(row || {}),
})

return {
...normalized,
created_at: row?.created_at || null,
updated_at: row?.updated_at || null,
updated_by: row?.updated_by || null,
}
}

function compactLastError(error = null) {
if (!error) return null

if (typeof error === "string") {
return cleanText(error, 1000)
}

if (typeof error === "object") {
return {
message: cleanText(error.message || error.error || "Unknown Sentinel error", 1000),
code: cleanText(error.code || error.name || "", 120) || null,
at: error.at || error.created_at || error.timestamp || null,
}
}

return cleanText(error, 1000)
}

function compactLastTickSummary(summary = null) {
if (!summary || typeof summary !== "object") return null

return {
total: Number(summary.total ?? 0),
scout_entry: Number(summary.scout_entry ?? 0),
sniper_add: Number(summary.sniper_add ?? 0),
partial_take_profit: Number(summary.partial_take_profit ?? 0),
full_exit: Number(summary.full_exit ?? 0),
reject: Number(summary.reject ?? 0),
watchlist: Number(summary.watchlist ?? 0),
hold: Number(summary.hold ?? 0),
kill_switch: Number(summary.kill_switch ?? 0),
simulated: Number(summary.simulated ?? 0),
skipped: Number(summary.skipped ?? 0),
audit_events: Number(summary.audit_events ?? 0),
positions_touched: Number(summary.positions_touched ?? 0),
execution_mode: cleanText(summary.execution_mode, 64) || null,
watcher_enabled:
summary.watcher_enabled == null ? null : Boolean(summary.watcher_enabled),
snapshots_seen: Number(summary.snapshots_seen ?? 0),
snapshots_processed: Number(summary.snapshots_processed ?? 0),
provider_name: cleanText(summary.provider_name || summary.providerName, 160) || null,
live_prices_resolved: Number(summary.live_prices_resolved ?? 0),
live_prices_requested: Number(summary.live_prices_requested ?? 0),
error: summary.error ? cleanText(summary.error, 1000) : null,
}
}

function compactSentinelEngineStatus(engine = null) {
if (!engine || typeof engine !== "object") {
return {
started: false,
running: false,
tick_count: 0,
snapshot_provider_name: null,
last_tick_started_at: null,
last_tick_finished_at: null,
last_error: null,
last_tick_summary: null,
current_mode: null,
}
}

return {
started: Boolean(engine.started ?? engine.is_started ?? engine.engine_started),
running: Boolean(engine.running ?? engine.is_running ?? engine.engine_running),
tick_count: Number(engine.tick_count ?? engine.tickCount ?? engine.total_ticks ?? 0),
snapshot_provider_name:
cleanText(
engine.snapshot_provider_name ||
engine.snapshotProviderName ||
engine.provider_name ||
engine.providerName,
160
) || null,
last_tick_started_at:
engine.last_tick_started_at || engine.lastTickStartedAt || null,
last_tick_finished_at:
engine.last_tick_finished_at || engine.lastTickFinishedAt || null,
last_error: compactLastError(engine.last_error || engine.lastError || null),
last_tick_summary: compactLastTickSummary(
engine.last_tick_summary || engine.lastTickSummary || null
),
current_mode: cleanText(engine.current_mode || engine.currentMode, 64) || null,
}
}

function getCompactSentinelEngineStatus() {
return compactSentinelEngineStatus(getSentinelEngineStatus())
}

function getRemainingCostBasisUsdFromRow(row) {
const units = Number(row?.units ?? 0)
const avgEntryPrice =
row?.avg_entry_price == null ? null : Number(row.avg_entry_price)
const currentValueUsd = Number(row?.current_value_usd ?? 0)
const unrealizedPnlUsd = Number(row?.unrealized_pnl_usd ?? 0)
const totalCostUsd = Number(row?.total_cost_usd ?? 0)
const hasBanked10x = Boolean(row?.has_banked_10x)

if (
Number.isFinite(units) &&
units > 0 &&
Number.isFinite(avgEntryPrice) &&
avgEntryPrice >= 0
) {
return Math.max(0, units * avgEntryPrice)
}

const derived = currentValueUsd - unrealizedPnlUsd
if (Number.isFinite(derived) && derived >= 0) {
return derived
}

if (hasBanked10x) {
return Math.max(0, totalCostUsd * 0.5)
}

return Math.max(0, totalCostUsd)
}

function serializeSentinelPosition(row) {
if (!row) return null

return {
id: row.id,
token_id: row.token_id,
mint_address: row.mint_address,
linked_operator_cluster_id: row.linked_operator_cluster_id,
stage: row.stage,
execution_mode: row.execution_mode,

total_cost_usd: Number(row.total_cost_usd ?? 0),
total_size_usd: Number(row.total_size_usd ?? 0),
current_value_usd: Number(row.current_value_usd ?? 0),
remaining_cost_basis_usd: getRemainingCostBasisUsdFromRow(row),

units: Number(row.units ?? 0),
avg_entry_price: row.avg_entry_price == null ? null : Number(row.avg_entry_price),
avg_exit_price: row.avg_exit_price == null ? null : Number(row.avg_exit_price),

realized_pnl_usd: Number(row.realized_pnl_usd ?? 0),
unrealized_pnl_usd: Number(row.unrealized_pnl_usd ?? 0),

has_banked_10x: Boolean(row.has_banked_10x),
banked_10x_at: row.banked_10x_at,
runner_started_at: row.runner_started_at,

open_reason_codes: parseJson(row.open_reason_codes, []),
close_reason_codes: parseJson(row.close_reason_codes, []),

opened_at: row.opened_at,
closed_at: row.closed_at,
invalidated_at: row.invalidated_at,

tx_open_ref: row.tx_open_ref,
tx_add_ref: row.tx_add_ref,
tx_bank_ref: row.tx_bank_ref,
tx_close_ref: row.tx_close_ref,
}
}

function serializeSentinelAuditRow(row) {
if (!row) return null

return {
id: row.id,
event_type: row.event_type,
token_id: row.token_id,
mint_address: row.mint_address,
position_id: row.position_id,
execution_mode: row.execution_mode,
decision: row.decision,
reason_codes: parseJson(row.reason_codes, []),
marketcap_usd: row.marketcap_usd == null ? null : Number(row.marketcap_usd),
liquidity_usd: row.liquidity_usd == null ? null : Number(row.liquidity_usd),
regime_state: row.regime_state,
regime_score: row.regime_score == null ? null : Number(row.regime_score),
operator_quality_score:
row.operator_quality_score == null ? null : Number(row.operator_quality_score),
hidden_control_risk:
row.hidden_control_risk == null ? null : Number(row.hidden_control_risk),
buy_pressure_score:
row.buy_pressure_score == null ? null : Number(row.buy_pressure_score),
reclaim_strength_score:
row.reclaim_strength_score == null ? null : Number(row.reclaim_strength_score),
structural_health_score:
row.structural_health_score == null ? null : Number(row.structural_health_score),
action_size_usd: row.action_size_usd == null ? null : Number(row.action_size_usd),
bank_fraction: row.bank_fraction == null ? null : Number(row.bank_fraction),
execution_status: row.execution_status,
execution_error: row.execution_error,
actor_type: row.actor_type,
actor_id: row.actor_id,
created_at: row.created_at,
}
}

function serializeAdminAuditRow(row) {
if (!row) return null

const out = {}
for (const [key, value] of Object.entries(row)) {
if (key.endsWith("_json")) {
out[key] = parseJson(value, value)
continue
}
out[key] = value
}
return out
}

function buildEmptySentinelDailyStats(statDate = todayUtcDate(), executionMode = "paper") {
return {
id: null,
stat_date: statDate,
execution_mode: executionMode,
scouts_opened: 0,
sniper_adds: 0,
positions_closed: 0,
invalidations: 0,
daily_scout_spend_usd: 0,
daily_sniper_spend_usd: 0,
daily_realized_pnl_usd: 0,
daily_unrealized_pnl_usd: 0,
daily_loss_usd: 0,
consecutive_failures: 0,
recent_rug_rate_pct: 0,
reclaim_success_rate_pct: 0,
avg_market_liquidity_usd: 0,
created_at: null,
updated_at: null,
}
}

function buildEmptySentinelPeriodStats({
period = "daily",
statDate = todayUtcDate(),
executionMode = "paper",
} = {}) {
const range = getSentinelPeriodRange(period, statDate)

return {
period: range.period,
label: range.label,
rolling_days: range.rolling_days,
start_date: range.start_date,
end_date: range.end_date,
execution_mode: executionMode,
rows_count: 0,
scouts_opened: 0,
sniper_adds: 0,
positions_closed: 0,
invalidations: 0,
scout_spend_usd: 0,
sniper_spend_usd: 0,
total_spend_usd: 0,
realized_pnl_usd: 0,
unrealized_pnl_usd: 0,
open_unrealized_pnl_usd: 0,
net_pnl_usd: 0,
loss_usd: 0,
consecutive_failures: 0,
recent_rug_rate_pct: 0,
reclaim_success_rate_pct: 0,
avg_market_liquidity_usd: 0,
note:
"Realized PnL and spend are period-based. Unrealized PnL reflects currently open Sentinel positions.",
}
}

function serializeSentinelDailyStats(row) {
if (!row) return null

return {
id: row.id,
stat_date: row.stat_date,
execution_mode: row.execution_mode,
scouts_opened: Number(row.scouts_opened ?? 0),
sniper_adds: Number(row.sniper_adds ?? 0),
positions_closed: Number(row.positions_closed ?? 0),
invalidations: Number(row.invalidations ?? 0),
daily_scout_spend_usd: Number(row.daily_scout_spend_usd ?? 0),
daily_sniper_spend_usd: Number(row.daily_sniper_spend_usd ?? 0),
daily_realized_pnl_usd: Number(row.daily_realized_pnl_usd ?? 0),
daily_unrealized_pnl_usd: Number(row.daily_unrealized_pnl_usd ?? 0),
daily_loss_usd: Number(row.daily_loss_usd ?? 0),
consecutive_failures: Number(row.consecutive_failures ?? 0),
recent_rug_rate_pct: Number(row.recent_rug_rate_pct ?? 0),
reclaim_success_rate_pct: Number(row.reclaim_success_rate_pct ?? 0),
avg_market_liquidity_usd: Number(row.avg_market_liquidity_usd ?? 0),
created_at: row.created_at || null,
updated_at: row.updated_at || null,
}
}

async function getCaseById(caseId) {
return db.get(
`
SELECT
c.id,
c.case_type,
c.compliance_profile_id,
c.launch_id,
c.status,
c.risk_score,
c.risk_level,
c.review_reason,
c.resolution_note,
c.assigned_to,
c.approved_by,
c.approved_at,
c.rejected_at,
c.frozen_at,
c.escalated_at,
c.created_at,
c.updated_at,

p.wallet_address,
p.profile_type,
p.legal_name,
p.display_name,
p.entity_name,
p.entity_type,
p.country_code,
p.status AS profile_status,
p.risk_rating AS profile_risk_rating,
p.manual_review_required,
p.manual_review_reason,
p.metadata_json AS profile_metadata_json,

l.token_name,
l.symbol,
l.status AS launch_status,
l.template,
l.builder_wallet
FROM compliance_cases c
LEFT JOIN compliance_profiles p
ON p.id = c.compliance_profile_id
LEFT JOIN launches l
ON l.id = c.launch_id
WHERE c.id = ?
LIMIT 1
`,
[caseId]
)
}

async function tableExists(tableName) {
const row = await db.get(
`
SELECT name
FROM sqlite_master
WHERE type = 'table'
AND name = ?
LIMIT 1
`,
[tableName]
)

return Boolean(row?.name)
}

async function getTableColumns(tableName) {
const sql = TABLE_INFO_SQL[tableName]
if (!sql) return new Set()

try {
const rows = await db.all(sql)
return new Set((rows || []).map((row) => row?.name).filter(Boolean))
} catch {
return new Set()
}
}

async function getSentinelSettingsRow() {
await ensureSentinelSettingsRow()
return db.get(`SELECT * FROM cassie_sentinel_settings WHERE id = 1`)
}

async function ensureSentinelSettingsRow(actorId = "system") {
const exists = await tableExists("cassie_sentinel_settings")
if (!exists) {
throw new Error("cassie_sentinel_settings table is missing")
}

const row = await db.get(`SELECT * FROM cassie_sentinel_settings WHERE id = 1`)
if (row) return row

await upsertSentinelSettingsRecord(DEFAULT_SENTINEL_CONFIG, actorId)
return db.get(`SELECT * FROM cassie_sentinel_settings WHERE id = 1`)
}

async function upsertSentinelSettingsRecord(settings = {}, actorId = "system") {
const normalized = normalizeSentinelConfig({
...DEFAULT_SENTINEL_CONFIG,
...(settings || {}),
})

const columns = await getTableColumns("cassie_sentinel_settings")
if (!columns.size) {
throw new Error("Unable to inspect cassie_sentinel_settings schema")
}

const existing = await db.get(`SELECT id FROM cassie_sentinel_settings WHERE id = 1`)

const fieldMap = {
id: 1,
...normalized,
updated_by: cleanText(actorId, 255) || "system",
}

if (existing?.id) {
const updateColumns = Object.keys(fieldMap).filter(
(column) => column !== "id" && columns.has(column)
)

const assignments = updateColumns.map((column) => `${column} = ?`)
const params = updateColumns.map((column) => toDbValue(fieldMap[column]))

if (columns.has("updated_at")) {
assignments.push(`updated_at = CURRENT_TIMESTAMP`)
}

await db.run(
`UPDATE cassie_sentinel_settings SET ${assignments.join(", ")} WHERE id = 1`,
params
)

return
}

const insertColumns = Object.keys(fieldMap).filter((column) => columns.has(column))
const insertPlaceholders = insertColumns.map(() => "?")
const insertParams = insertColumns.map((column) => toDbValue(fieldMap[column]))

if (columns.has("created_at")) {
insertColumns.push("created_at")
insertPlaceholders.push("CURRENT_TIMESTAMP")
}

if (columns.has("updated_at")) {
insertColumns.push("updated_at")
insertPlaceholders.push("CURRENT_TIMESTAMP")
}

await db.run(
`
INSERT INTO cassie_sentinel_settings (
${insertColumns.join(", ")}
) VALUES (
${insertPlaceholders.join(", ")}
)
`,
insertParams
)
}

async function insertSentinelAuditEvent(payload = {}) {
if (!(await tableExists("cassie_sentinel_audit_events"))) {
return
}

const reasonCodes = ensureReasonCodeArray(payload.reason_codes, [])

await db.run(
`
INSERT INTO cassie_sentinel_audit_events (
event_type,
token_id,
mint_address,
position_id,
execution_mode,
decision,
reason_codes,
marketcap_usd,
liquidity_usd,
regime_state,
regime_score,
operator_quality_score,
hidden_control_risk,
buy_pressure_score,
reclaim_strength_score,
structural_health_score,
action_size_usd,
bank_fraction,
execution_status,
execution_error,
actor_type,
actor_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
[
cleanText(payload.event_type || "settings_update", 64),
payload.token_id || null,
payload.mint_address || null,
payload.position_id || null,
payload.execution_mode || null,
cleanText(payload.decision || "hold", 64),
JSON.stringify(reasonCodes),
payload.marketcap_usd ?? null,
payload.liquidity_usd ?? null,
payload.regime_state || null,
payload.regime_score ?? null,
payload.operator_quality_score ?? null,
payload.hidden_control_risk ?? null,
payload.buy_pressure_score ?? null,
payload.reclaim_strength_score ?? null,
payload.structural_health_score ?? null,
payload.action_size_usd ?? null,
payload.bank_fraction ?? null,
cleanText(payload.execution_status || "planned", 32),
payload.execution_error ? cleanText(payload.execution_error, 1000) : null,
cleanText(payload.actor_type || "system", 32),
payload.actor_id ? cleanText(payload.actor_id, 255) : null,
]
)
}

async function insertCassieAdminAudit({
action,
actorId = "admin",
status = "ok",
notes = null,
targetType = null,
targetId = null,
details = null,
oldState = null,
newState = null,
} = {}) {
if (!(await tableExists("cassie_admin_audit_log"))) {
return
}

const columns = await getTableColumns("cassie_admin_audit_log")
if (!columns.size) return

const candidateValues = {
actor_type: "admin",
actor_id: cleanText(actorId, 255) || "admin",
action: cleanText(action, 120),
status: cleanText(status, 64),
target_type: cleanText(targetType, 120) || null,
target_id: targetId == null ? null : cleanText(String(targetId), 255),
notes: notes ? cleanText(notes, 2000) : null,
details_json: JSON.stringify(details ?? {}),
metadata_json: JSON.stringify(details ?? {}),
payload_json: JSON.stringify(details ?? {}),
old_state_json: JSON.stringify(oldState ?? null),
new_state_json: JSON.stringify(newState ?? null),
}

const insertColumns = []
const placeholders = []
const values = []

for (const [column, value] of Object.entries(candidateValues)) {
if (!columns.has(column)) continue
insertColumns.push(column)
placeholders.push("?")
values.push(value)
}

if (columns.has("created_at")) {
insertColumns.push("created_at")
placeholders.push("CURRENT_TIMESTAMP")
}

if (!insertColumns.length) return

await db.run(
`
INSERT INTO cassie_admin_audit_log (
${insertColumns.join(", ")}
) VALUES (
${placeholders.join(", ")}
)
`,
values
)
}

async function getSentinelDailyStatsRow(statDate, executionMode) {
return db.get(
`
SELECT *
FROM cassie_sentinel_daily_stats
WHERE stat_date = ?
AND execution_mode = ?
LIMIT 1
`,
[statDate, executionMode]
)
}

async function getSentinelOpenPositionCount(executionMode) {
const row = await db.get(
`
SELECT COUNT(*) AS count
FROM cassie_sentinel_positions
WHERE stage IN ('scout_open','sniper_added','half_banked_at_10x','runner_only')
AND execution_mode = ?
`,
[executionMode]
)

return Number(row?.count ?? 0)
}

async function getSentinelOpenPositionSummary(executionMode) {
if (!(await tableExists("cassie_sentinel_positions"))) {
return {
open_positions: 0,
open_total_cost_usd: 0,
open_current_value_usd: 0,
open_realized_pnl_usd: 0,
open_unrealized_pnl_usd: 0,
open_remaining_cost_basis_usd: 0,
}
}

const row = await db.get(
`
SELECT
COUNT(*) AS open_positions,
COALESCE(SUM(total_cost_usd), 0) AS open_total_cost_usd,
COALESCE(SUM(current_value_usd), 0) AS open_current_value_usd,
COALESCE(SUM(realized_pnl_usd), 0) AS open_realized_pnl_usd,
COALESCE(SUM(unrealized_pnl_usd), 0) AS open_unrealized_pnl_usd,
COALESCE(SUM(
CASE
WHEN units IS NOT NULL
AND units > 0
AND avg_entry_price IS NOT NULL
AND avg_entry_price >= 0
THEN units * avg_entry_price
ELSE total_cost_usd
END
), 0) AS open_remaining_cost_basis_usd
FROM cassie_sentinel_positions
WHERE stage IN ('scout_open','sniper_added','half_banked_at_10x','runner_only')
AND execution_mode = ?
`,
[executionMode]
)

return {
open_positions: Number(row?.open_positions ?? 0),
open_total_cost_usd: Number(row?.open_total_cost_usd ?? 0),
open_current_value_usd: Number(row?.open_current_value_usd ?? 0),
open_realized_pnl_usd: Number(row?.open_realized_pnl_usd ?? 0),
open_unrealized_pnl_usd: Number(row?.open_unrealized_pnl_usd ?? 0),
open_remaining_cost_basis_usd: Number(row?.open_remaining_cost_basis_usd ?? 0),
}
}

async function getSentinelPeriodStats({
period = "daily",
statDate = todayUtcDate(),
executionMode = "paper",
} = {}) {
const range = getSentinelPeriodRange(period, statDate)
const empty = buildEmptySentinelPeriodStats({
period: range.period,
statDate: range.end_date,
executionMode,
})

if (!(await tableExists("cassie_sentinel_daily_stats"))) {
return empty
}

const filters = [`execution_mode = ?`]
const params = [executionMode]

if (range.period !== "overall") {
filters.push(`stat_date >= ?`)
params.push(range.start_date)
filters.push(`stat_date <= ?`)
params.push(range.end_date)
}

const whereSql = `WHERE ${filters.join(" AND ")}`

const aggregate = await db.get(
`
SELECT
COUNT(*) AS rows_count,
MIN(stat_date) AS first_stat_date,
MAX(stat_date) AS last_stat_date,
COALESCE(SUM(scouts_opened), 0) AS scouts_opened,
COALESCE(SUM(sniper_adds), 0) AS sniper_adds,
COALESCE(SUM(positions_closed), 0) AS positions_closed,
COALESCE(SUM(invalidations), 0) AS invalidations,
COALESCE(SUM(daily_scout_spend_usd), 0) AS scout_spend_usd,
COALESCE(SUM(daily_sniper_spend_usd), 0) AS sniper_spend_usd,
COALESCE(SUM(daily_realized_pnl_usd), 0) AS realized_pnl_usd,
COALESCE(SUM(daily_loss_usd), 0) AS loss_usd,
COALESCE(AVG(recent_rug_rate_pct), 0) AS recent_rug_rate_pct,
COALESCE(AVG(reclaim_success_rate_pct), 0) AS reclaim_success_rate_pct,
COALESCE(AVG(avg_market_liquidity_usd), 0) AS avg_market_liquidity_usd
FROM cassie_sentinel_daily_stats
${whereSql}
`,
params
)

const latest = await db.get(
`
SELECT *
FROM cassie_sentinel_daily_stats
${whereSql}
ORDER BY stat_date DESC, id DESC
LIMIT 1
`,
params
)

const openSummary = await getSentinelOpenPositionSummary(executionMode)

const rowsCount = Number(aggregate?.rows_count ?? 0)
if (!rowsCount) {
return {
...empty,
...openSummary,
unrealized_pnl_usd: Number(openSummary.open_unrealized_pnl_usd ?? 0),
open_unrealized_pnl_usd: Number(openSummary.open_unrealized_pnl_usd ?? 0),
net_pnl_usd: Number(openSummary.open_unrealized_pnl_usd ?? 0),
}
}

const realizedPnlUsd = Number(aggregate?.realized_pnl_usd ?? 0)
const openUnrealizedPnlUsd = Number(openSummary.open_unrealized_pnl_usd ?? 0)

return {
period: range.period,
label: range.label,
rolling_days: range.rolling_days,
start_date: range.period === "overall" ? aggregate?.first_stat_date || null : range.start_date,
end_date: aggregate?.last_stat_date || range.end_date,
execution_mode: executionMode,
rows_count: rowsCount,
scouts_opened: Number(aggregate?.scouts_opened ?? 0),
sniper_adds: Number(aggregate?.sniper_adds ?? 0),
positions_closed: Number(aggregate?.positions_closed ?? 0),
invalidations: Number(aggregate?.invalidations ?? 0),
scout_spend_usd: Number(aggregate?.scout_spend_usd ?? 0),
sniper_spend_usd: Number(aggregate?.sniper_spend_usd ?? 0),
total_spend_usd:
Number(aggregate?.scout_spend_usd ?? 0) +
Number(aggregate?.sniper_spend_usd ?? 0),
realized_pnl_usd: realizedPnlUsd,
latest_daily_unrealized_pnl_usd: Number(latest?.daily_unrealized_pnl_usd ?? 0),
unrealized_pnl_usd: openUnrealizedPnlUsd,
open_unrealized_pnl_usd: openUnrealizedPnlUsd,
net_pnl_usd: realizedPnlUsd + openUnrealizedPnlUsd,
loss_usd: Number(aggregate?.loss_usd ?? 0),
consecutive_failures: Number(latest?.consecutive_failures ?? 0),
recent_rug_rate_pct: Number(aggregate?.recent_rug_rate_pct ?? 0),
reclaim_success_rate_pct: Number(aggregate?.reclaim_success_rate_pct ?? 0),
avg_market_liquidity_usd: Number(aggregate?.avg_market_liquidity_usd ?? 0),
...openSummary,
note:
"Realized PnL and spend are period-based. Unrealized PnL reflects currently open Sentinel positions.",
}
}

async function buildSentinelStatusPayload({
period = "daily",
date = todayUtcDate(),
mode = null,
} = {}) {
const settingsRow = await getSentinelSettingsRow()
const settings = serializeSentinelSettings(settingsRow)
const executionMode = mode && SENTINEL_MODES.has(mode) ? mode : settings.execution_mode
const engine = getCompactSentinelEngineStatus()
const statDate = parseDateOnly(date)
const openPositions = await getSentinelOpenPositionCount(executionMode)
const dailyRow = await getSentinelDailyStatsRow(statDate, executionMode)
const daily =
serializeSentinelDailyStats(dailyRow) ||
buildEmptySentinelDailyStats(statDate, executionMode)
const periodSummary = await getSentinelPeriodStats({
period,
statDate,
executionMode,
})

return {
settings,
engine,
summary: {
watcher_enabled: Boolean(settings.watcher_enabled),
execution_mode: executionMode,
settings_execution_mode: settings.execution_mode,
kill_switch_active: settings.execution_mode === "emergency_stop",
open_positions: openPositions,

selected_period: periodSummary.period,
selected_period_label: periodSummary.label,
selected_period_start_date: periodSummary.start_date,
selected_period_end_date: periodSummary.end_date,

period_realized_pnl_usd: Number(periodSummary.realized_pnl_usd ?? 0),
period_unrealized_pnl_usd: Number(periodSummary.unrealized_pnl_usd ?? 0),
period_net_pnl_usd: Number(periodSummary.net_pnl_usd ?? 0),
period_loss_usd: Number(periodSummary.loss_usd ?? 0),
period_scout_spend_usd: Number(periodSummary.scout_spend_usd ?? 0),
period_sniper_spend_usd: Number(periodSummary.sniper_spend_usd ?? 0),
period_total_spend_usd: Number(periodSummary.total_spend_usd ?? 0),
period_scouts_opened: Number(periodSummary.scouts_opened ?? 0),
period_sniper_adds: Number(periodSummary.sniper_adds ?? 0),
period_positions_closed: Number(periodSummary.positions_closed ?? 0),
period_invalidations: Number(periodSummary.invalidations ?? 0),

daily_realized_pnl_usd: Number(daily.daily_realized_pnl_usd ?? 0),
daily_unrealized_pnl_usd: Number(daily.daily_unrealized_pnl_usd ?? 0),
daily_loss_usd: Number(daily.daily_loss_usd ?? 0),
consecutive_failures: Number(daily.consecutive_failures ?? 0),
reclaim_success_rate_pct: Number(daily.reclaim_success_rate_pct ?? 0),
recent_rug_rate_pct: Number(daily.recent_rug_rate_pct ?? 0),
avg_market_liquidity_usd: Number(daily.avg_market_liquidity_usd ?? 0),
stat_date: daily.stat_date,

pnl: periodSummary,

last_tick_started_at: engine?.last_tick_started_at || null,
last_tick_finished_at: engine?.last_tick_finished_at || null,
last_error: engine?.last_error || null,
last_tick_summary: engine?.last_tick_summary || null,
},
}
}

async function listSentinelAdminAudit({
limit = 100,
action = "",
actorId = "",
targetType = "",
} = {}) {
if (!(await tableExists("cassie_admin_audit_log"))) {
return []
}

const columns = await getTableColumns("cassie_admin_audit_log")
if (!columns.size) return []

const filters = []
const params = []

if (action && columns.has("action")) {
filters.push(`action = ?`)
params.push(cleanText(action, 120))
}

if (actorId && columns.has("actor_id")) {
filters.push(`actor_id = ?`)
params.push(cleanText(actorId, 255))
}

if (targetType && columns.has("target_type")) {
filters.push(`target_type = ?`)
params.push(cleanText(targetType, 120))
}

const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
const orderSql = columns.has("created_at")
? `ORDER BY datetime(created_at) DESC, id DESC`
: `ORDER BY id DESC`

const rows = await db.all(
`
SELECT *
FROM cassie_admin_audit_log
${whereSql}
${orderSql}
LIMIT ?
`,
[...params, limit]
)

return rows.map(serializeAdminAuditRow)
}

router.get("/cases", async (req, res) => {
try {
const limit = Math.max(
1,
Math.min(500, parseIntSafe(req.query.limit, 100) || 100)
)

const filters = []
const params = []

const status = cleanText(req.query.status, 32).toLowerCase()
if (CASE_STATUSES.has(status)) {
filters.push("c.status = ?")
params.push(status)
}

const caseType = cleanText(
req.query.case_type || req.query.caseType,
32
).toLowerCase()
if (caseType) {
filters.push("c.case_type = ?")
params.push(caseType)
}

const riskLevel = cleanText(
req.query.risk_level || req.query.riskLevel,
32
).toLowerCase()
if (RISK_LEVELS.has(riskLevel)) {
filters.push("c.risk_level = ?")
params.push(riskLevel)
}

const profileId = parseIntSafe(
req.query.compliance_profile_id || req.query.profile_id || req.query.profileId
)
if (profileId) {
filters.push("c.compliance_profile_id = ?")
params.push(profileId)
}

const launchId = parseIntSafe(req.query.launch_id || req.query.launchId)
if (launchId) {
filters.push("c.launch_id = ?")
params.push(launchId)
}

const assignedTo = cleanText(req.query.assigned_to || req.query.assignedTo, 120)
if (assignedTo) {
filters.push("c.assigned_to = ?")
params.push(assignedTo)
}

const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : ""

const rows = await db.all(
`
SELECT
c.id,
c.case_type,
c.compliance_profile_id,
c.launch_id,
c.status,
c.risk_score,
c.risk_level,
c.review_reason,
c.resolution_note,
c.assigned_to,
c.approved_by,
c.approved_at,
c.rejected_at,
c.frozen_at,
c.escalated_at,
c.created_at,
c.updated_at,

p.wallet_address,
p.profile_type,
p.legal_name,
p.display_name,
p.entity_name,
p.entity_type,
p.country_code,
p.status AS profile_status,
p.risk_rating AS profile_risk_rating,
p.manual_review_required,
p.manual_review_reason,

l.token_name,
l.symbol,
l.status AS launch_status,
l.template,
l.builder_wallet
FROM compliance_cases c
LEFT JOIN compliance_profiles p
ON p.id = c.compliance_profile_id
LEFT JOIN launches l
ON l.id = c.launch_id
${whereClause}
ORDER BY c.id DESC
LIMIT ?
`,
[...params, limit]
)

return res.json({
ok: true,
count: rows.length,
cases: rows.map((row) => ({
id: row.id,
case_type: row.case_type,
compliance_profile_id: row.compliance_profile_id,
launch_id: row.launch_id,
status: row.status,
risk_score: Number(row.risk_score || 0),
risk_level: row.risk_level,
review_reason: row.review_reason || null,
resolution_note: row.resolution_note || null,
assigned_to: row.assigned_to || null,
approved_by: row.approved_by || null,
approved_at: row.approved_at || null,
rejected_at: row.rejected_at || null,
frozen_at: row.frozen_at || null,
escalated_at: row.escalated_at || null,
created_at: row.created_at || null,
updated_at: row.updated_at || null,
profile: row.compliance_profile_id
? {
id: row.compliance_profile_id,
wallet_address: row.wallet_address || null,
profile_type: row.profile_type || null,
legal_name: row.legal_name || null,
display_name: row.display_name || null,
entity_name: row.entity_name || null,
entity_type: row.entity_type || null,
country_code: row.country_code || null,
status: row.profile_status || null,
risk_rating: row.profile_risk_rating || null,
manual_review_required: Boolean(row.manual_review_required),
manual_review_reason: row.manual_review_reason || null,
}
: null,
launch: row.launch_id
? {
id: row.launch_id,
token_name: row.token_name || null,
symbol: row.symbol || null,
status: row.launch_status || null,
template: row.template || null,
builder_wallet: row.builder_wallet || null,
}
: null,
})),
})
} catch (error) {
console.error("GET /api/compliance-admin/cases failed", error)
return res.status(500).json({
ok: false,
error: "Failed to fetch compliance cases",
message: error?.message || String(error),
})
}
})

router.get("/cases/:id", async (req, res) => {
try {
const caseId = parseIntSafe(req.params.id)

if (!caseId) {
return res.status(400).json({
ok: false,
error: "Valid case id is required",
})
}

const row = await getCaseById(caseId)

if (!row) {
return res.status(404).json({
ok: false,
error: "Compliance case not found",
})
}

return res.json({
ok: true,
case: {
id: row.id,
case_type: row.case_type,
compliance_profile_id: row.compliance_profile_id,
launch_id: row.launch_id,
status: row.status,
risk_score: Number(row.risk_score || 0),
risk_level: row.risk_level,
review_reason: row.review_reason || null,
resolution_note: row.resolution_note || null,
assigned_to: row.assigned_to || null,
approved_by: row.approved_by || null,
approved_at: row.approved_at || null,
rejected_at: row.rejected_at || null,
frozen_at: row.frozen_at || null,
escalated_at: row.escalated_at || null,
created_at: row.created_at || null,
updated_at: row.updated_at || null,
profile: row.compliance_profile_id
? {
id: row.compliance_profile_id,
wallet_address: row.wallet_address || null,
profile_type: row.profile_type || null,
legal_name: row.legal_name || null,
display_name: row.display_name || null,
entity_name: row.entity_name || null,
entity_type: row.entity_type || null,
country_code: row.country_code || null,
status: row.profile_status || null,
risk_rating: row.profile_risk_rating || null,
manual_review_required: Boolean(row.manual_review_required),
manual_review_reason: row.manual_review_reason || null,
metadata: parseJson(row.profile_metadata_json, null),
}
: null,
launch: row.launch_id
? {
id: row.launch_id,
token_name: row.token_name || null,
symbol: row.symbol || null,
status: row.launch_status || null,
template: row.template || null,
builder_wallet: row.builder_wallet || null,
}
: null,
},
})
} catch (error) {
console.error("GET /api/compliance-admin/cases/:id failed", error)
return res.status(500).json({
ok: false,
error: "Failed to fetch compliance case",
message: error?.message || String(error),
})
}
})

router.post("/cases/:id/approve", async (req, res) => {
try {
const caseId = parseIntSafe(req.params.id)
const actorId = cleanText(req.body?.actor_id || req.body?.actorId, 120) || "admin"
const notes = cleanText(req.body?.notes, 2000) || null

if (!caseId) {
return res.status(400).json({
ok: false,
error: "Valid case id is required",
})
}

const before = await getCaseById(caseId)
if (!before) {
return res.status(404).json({
ok: false,
error: "Compliance case not found",
})
}

await db.run(
`
UPDATE compliance_cases
SET
status = 'approved',
approved_by = ?,
approved_at = CURRENT_TIMESTAMP,
resolution_note = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[actorId, notes, caseId]
)

if (before.compliance_profile_id) {
await db.run(
`
UPDATE compliance_profiles
SET
status = 'approved',
manual_review_required = 0,
manual_review_reason = NULL,
verification_completed_at = COALESCE(verification_completed_at, CURRENT_TIMESTAMP),
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[before.compliance_profile_id]
)
}

const after = await getCaseById(caseId)

await auditLog.logCaseEvent({
actorType: "admin",
actorId,
action: "case_approved",
caseId,
oldState: before,
newState: after,
notes,
})

return res.json({
ok: true,
case: after,
})
} catch (error) {
console.error("POST /api/compliance-admin/cases/:id/approve failed", error)
return res.status(500).json({
ok: false,
error: "Failed to approve compliance case",
message: error?.message || String(error),
})
}
})

router.post("/cases/:id/reject", async (req, res) => {
try {
const caseId = parseIntSafe(req.params.id)
const actorId = cleanText(req.body?.actor_id || req.body?.actorId, 120) || "admin"
const notes = cleanText(req.body?.notes, 2000) || null

if (!caseId) {
return res.status(400).json({
ok: false,
error: "Valid case id is required",
})
}

const before = await getCaseById(caseId)
if (!before) {
return res.status(404).json({
ok: false,
error: "Compliance case not found",
})
}

await db.run(
`
UPDATE compliance_cases
SET
status = 'rejected',
rejected_at = CURRENT_TIMESTAMP,
resolution_note = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[notes, caseId]
)

if (before.compliance_profile_id) {
await db.run(
`
UPDATE compliance_profiles
SET
status = 'rejected',
manual_review_required = 1,
manual_review_reason = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[notes || "Compliance case rejected", before.compliance_profile_id]
)
}

const after = await getCaseById(caseId)

await auditLog.logCaseEvent({
actorType: "admin",
actorId,
action: "case_rejected",
caseId,
oldState: before,
newState: after,
notes,
})

return res.json({
ok: true,
case: after,
})
} catch (error) {
console.error("POST /api/compliance-admin/cases/:id/reject failed", error)
return res.status(500).json({
ok: false,
error: "Failed to reject compliance case",
message: error?.message || String(error),
})
}
})

router.post("/cases/:id/freeze", async (req, res) => {
try {
const caseId = parseIntSafe(req.params.id)
const actorId = cleanText(req.body?.actor_id || req.body?.actorId, 120) || "admin"
const notes = cleanText(req.body?.notes, 2000) || null

if (!caseId) {
return res.status(400).json({
ok: false,
error: "Valid case id is required",
})
}

const before = await getCaseById(caseId)
if (!before) {
return res.status(404).json({
ok: false,
error: "Compliance case not found",
})
}

await db.run(
`
UPDATE compliance_cases
SET
status = 'frozen',
frozen_at = CURRENT_TIMESTAMP,
resolution_note = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[notes, caseId]
)

if (before.compliance_profile_id) {
await db.run(
`
UPDATE compliance_profiles
SET
status = 'restricted',
manual_review_required = 1,
manual_review_reason = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[notes || "Profile frozen pending compliance review", before.compliance_profile_id]
)
}

const after = await getCaseById(caseId)

await auditLog.logCaseEvent({
actorType: "admin",
actorId,
action: "case_frozen",
caseId,
oldState: before,
newState: after,
notes,
})

return res.json({
ok: true,
case: after,
})
} catch (error) {
console.error("POST /api/compliance-admin/cases/:id/freeze failed", error)
return res.status(500).json({
ok: false,
error: "Failed to freeze compliance case",
message: error?.message || String(error),
})
}
})

router.post("/cases/:id/assign", async (req, res) => {
try {
const caseId = parseIntSafe(req.params.id)
const actorId = cleanText(req.body?.actor_id || req.body?.actorId, 120) || "admin"
const assignedTo = cleanText(req.body?.assigned_to || req.body?.assignedTo, 120)

if (!caseId) {
return res.status(400).json({
ok: false,
error: "Valid case id is required",
})
}

if (!assignedTo) {
return res.status(400).json({
ok: false,
error: "assigned_to is required",
})
}

const before = await getCaseById(caseId)
if (!before) {
return res.status(404).json({
ok: false,
error: "Compliance case not found",
})
}

await db.run(
`
UPDATE compliance_cases
SET
assigned_to = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[assignedTo, caseId]
)

const after = await getCaseById(caseId)

await auditLog.logCaseEvent({
actorType: "admin",
actorId,
action: "case_assigned",
caseId,
oldState: before,
newState: after,
notes: `Assigned to ${assignedTo}`,
})

return res.json({
ok: true,
case: after,
})
} catch (error) {
console.error("POST /api/compliance-admin/cases/:id/assign failed", error)
return res.status(500).json({
ok: false,
error: "Failed to assign compliance case",
message: error?.message || String(error),
})
}
})

router.post("/cases/:id/escalate", async (req, res) => {
try {
const caseId = parseIntSafe(req.params.id)
const actorId = cleanText(req.body?.actor_id || req.body?.actorId, 120) || "admin"
const notes = cleanText(req.body?.notes, 2000) || null
const riskLevel = normalizeRiskLevel(
req.body?.risk_level || req.body?.riskLevel,
"high"
)

if (!caseId) {
return res.status(400).json({
ok: false,
error: "Valid case id is required",
})
}

const before = await getCaseById(caseId)
if (!before) {
return res.status(404).json({
ok: false,
error: "Compliance case not found",
})
}

await db.run(
`
UPDATE compliance_cases
SET
status = 'escalated',
risk_level = ?,
escalated_at = CURRENT_TIMESTAMP,
resolution_note = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[riskLevel, notes, caseId]
)

if (before.compliance_profile_id) {
await db.run(
`
UPDATE compliance_profiles
SET
manual_review_required = 1,
risk_rating = ?,
manual_review_reason = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[riskLevel, notes || "Compliance case escalated", before.compliance_profile_id]
)
}

const after = await getCaseById(caseId)

await auditLog.logCaseEvent({
actorType: "admin",
actorId,
action: "case_escalated",
caseId,
oldState: before,
newState: after,
notes,
})

return res.json({
ok: true,
case: after,
})
} catch (error) {
console.error("POST /api/compliance-admin/cases/:id/escalate failed", error)
return res.status(500).json({
ok: false,
error: "Failed to escalate compliance case",
message: error?.message || String(error),
})
}
})

router.get("/sentinel/status", async (req, res) => {
try {
const period = normalizeSentinelSummaryPeriod(req.query.period, "daily")
const date = parseDateOnly(req.query.date || todayUtcDate())
const payload = await buildSentinelStatusPayload({ period, date })

return res.json({
ok: true,
...payload,
})
} catch (error) {
console.error("GET /api/compliance-admin/sentinel/status failed", error)
return res.status(500).json({
ok: false,
error: "Failed to load Sentinel status",
message: error?.message || String(error),
})
}
})

router.get("/sentinel/settings", async (req, res) => {
try {
const row = await getSentinelSettingsRow()

return res.json({
ok: true,
settings: serializeSentinelSettings(row),
engine: getCompactSentinelEngineStatus(),
})
} catch (error) {
console.error("GET /api/compliance-admin/sentinel/settings failed", error)
return res.status(500).json({
ok: false,
error: "Failed to load Sentinel settings",
message: error?.message || String(error),
})
}
})

router.patch("/sentinel/settings", async (req, res) => {
try {
const actorId =
cleanText(req.body?.actor_id || req.headers["x-admin-actor"] || "admin", 255) ||
"admin"
const notes = cleanText(req.body?.notes || "", 2000) || null
const currentRow = await getSentinelSettingsRow()
const before = serializeSentinelSettings(currentRow)

const patch = {}
for (const [field, rule] of Object.entries(SENTINEL_PATCH_FIELDS)) {
if (!(field in (req.body || {}))) continue

const parsed = parsePatchFieldValue(req.body[field], rule)
if (parsed == null || isOutOfRange(parsed, rule)) {
return res.status(400).json({
ok: false,
error: `Invalid value for ${field}`,
})
}

patch[field] = parsed
}

if (!Object.keys(patch).length) {
return res.status(400).json({
ok: false,
error: "No valid Sentinel settings fields were provided",
})
}

const next = normalizeSentinelConfig({
...before,
...patch,
})

await upsertSentinelSettingsRecord(next, actorId)

const updatedRow = await getSentinelSettingsRow()
const updated = serializeSentinelSettings(updatedRow)
const changedFields = computeChangedFields(before, updated)

await insertSentinelAuditEvent({
event_type: "settings_update",
execution_mode: updated.execution_mode,
decision: "settings_update",
reason_codes: [REASON_CODE.SETTINGS_PATCH_APPLIED],
actor_type: "admin",
actor_id: actorId,
execution_status: "skipped",
})

await insertCassieAdminAudit({
action: "sentinel_settings_updated",
actorId,
status: "ok",
notes,
targetType: "sentinel_settings",
targetId: "1",
details: {
changed_fields: changedFields,
},
oldState: before,
newState: updated,
})

return res.json({
ok: true,
changed_fields: changedFields,
settings: updated,
engine: getCompactSentinelEngineStatus(),
})
} catch (error) {
console.error("PATCH /api/compliance-admin/sentinel/settings failed", error)
return res.status(500).json({
ok: false,
error: "Failed to update Sentinel settings",
message: error?.message || String(error),
})
}
})

router.post("/sentinel/mode", async (req, res) => {
try {
const actorId =
cleanText(req.body?.actor_id || req.headers["x-admin-actor"] || "admin", 255) ||
"admin"
const notes = cleanText(req.body?.notes || "", 2000) || null
const reason = cleanText(req.body?.reason || "", 500) || null
const confirmLive = parseBoolSafe(req.body?.confirm_live, false)
const requestedMode = normalizeSentinelMode(req.body?.execution_mode, "")

if (!SENTINEL_MODES.has(requestedMode)) {
return res.status(400).json({
ok: false,
error: "Invalid Sentinel execution mode",
})
}

if (
(requestedMode === "armed_mainnet" || requestedMode === "live_mainnet") &&
!confirmLive
) {
return res.status(400).json({
ok: false,
error: "confirm_live=true is required before switching into mainnet execution",
})
}

const currentRow = await getSentinelSettingsRow()
const before = serializeSentinelSettings(currentRow)

if (before.execution_mode === requestedMode) {
return res.json({
ok: true,
previous_mode: before.execution_mode,
current_mode: before.execution_mode,
unchanged: true,
settings: before,
engine: getCompactSentinelEngineStatus(),
})
}

const next = normalizeSentinelConfig({
...before,
execution_mode: requestedMode,
})

await upsertSentinelSettingsRecord(next, actorId)

const updatedRow = await getSentinelSettingsRow()
const updated = serializeSentinelSettings(updatedRow)

await insertSentinelAuditEvent({
event_type: "mode_change",
execution_mode: updated.execution_mode,
decision: "mode_change",
reason_codes: [REASON_CODE.SENTINEL_MODE_CHANGED],
actor_type: "admin",
actor_id: actorId,
execution_status: "skipped",
execution_error: reason || null,
})

await insertCassieAdminAudit({
action: "sentinel_mode_changed",
actorId,
status: "ok",
notes: notes || reason,
targetType: "sentinel_settings",
targetId: "1",
details: {
previous_mode: before.execution_mode,
current_mode: updated.execution_mode,
confirm_live: Boolean(confirmLive),
},
oldState: before,
newState: updated,
})

return res.json({
ok: true,
previous_mode: before.execution_mode,
current_mode: updated.execution_mode,
settings: updated,
engine: getCompactSentinelEngineStatus(),
})
} catch (error) {
console.error("POST /api/compliance-admin/sentinel/mode failed", error)
return res.status(500).json({
ok: false,
error: "Failed to switch Sentinel execution mode",
message: error?.message || String(error),
})
}
})

router.post("/sentinel/emergency-stop", async (req, res) => {
try {
const enabled = parseBoolSafe(req.body?.enabled, false)
const actorId =
cleanText(req.body?.actor_id || req.headers["x-admin-actor"] || "admin", 255) ||
"admin"
const notes = cleanText(req.body?.notes || "", 2000) || null
const reason = cleanText(req.body?.reason || "", 500) || null

if (!enabled) {
return res.status(400).json({
ok: false,
error:
"Emergency stop endpoint only enables stop. Use /sentinel/mode to restore a mode.",
})
}

const currentRow = await getSentinelSettingsRow()
const before = serializeSentinelSettings(currentRow)

if (before.execution_mode !== "emergency_stop") {
const next = normalizeSentinelConfig({
...before,
execution_mode: "emergency_stop",
})

await upsertSentinelSettingsRecord(next, actorId)
}

const updatedRow = await getSentinelSettingsRow()
const updated = serializeSentinelSettings(updatedRow)

await insertSentinelAuditEvent({
event_type: "emergency_stop",
execution_mode: "emergency_stop",
decision: "kill_switch",
reason_codes: [REASON_CODE.SENTINEL_EMERGENCY_STOP],
actor_type: "admin",
actor_id: actorId,
execution_status: "skipped",
execution_error: reason || null,
})

await insertCassieAdminAudit({
action: "sentinel_emergency_stop_enabled",
actorId,
status: "ok",
notes: notes || reason,
targetType: "sentinel_settings",
targetId: "1",
details: {
previous_mode: before.execution_mode,
current_mode: "emergency_stop",
},
oldState: before,
newState: updated,
})

return res.json({
ok: true,
previous_mode: before.execution_mode,
current_mode: updated.execution_mode,
settings: updated,
engine: getCompactSentinelEngineStatus(),
})
} catch (error) {
console.error("POST /api/compliance-admin/sentinel/emergency-stop failed", error)
return res.status(500).json({
ok: false,
error: "Failed to activate Sentinel emergency stop",
message: error?.message || String(error),
})
}
})

router.get("/sentinel/admin-audit", async (req, res) => {
try {
const limit = Math.max(1, Math.min(500, parseIntSafe(req.query.limit, 100) || 100))
const action = cleanText(req.query.action || "", 120)
const actorId = cleanText(req.query.actor_id || "", 255)
const targetType = cleanText(req.query.target_type || "", 120)

const audit = await listSentinelAdminAudit({
limit,
action,
actorId,
targetType,
})

return res.json({
ok: true,
count: audit.length,
audit,
})
} catch (error) {
console.error("GET /api/compliance-admin/sentinel/admin-audit failed", error)
return res.status(500).json({
ok: false,
error: "Failed to load Sentinel admin audit log",
message: error?.message || String(error),
})
}
})

router.get("/sentinel/audit/admin", async (req, res) => {
try {
const limit = Math.max(1, Math.min(500, parseIntSafe(req.query.limit, 100) || 100))
const action = cleanText(req.query.action || "", 120)
const actorId = cleanText(req.query.actor_id || "", 255)
const targetType = cleanText(req.query.target_type || "", 120)

const audit = await listSentinelAdminAudit({
limit,
action,
actorId,
targetType,
})

return res.json({
ok: true,
count: audit.length,
audit,
})
} catch (error) {
console.error("GET /api/compliance-admin/sentinel/audit/admin failed", error)
return res.status(500).json({
ok: false,
error: "Failed to load Sentinel admin audit log",
message: error?.message || String(error),
})
}
})

router.get("/sentinel/positions", async (req, res) => {
try {
const limit = Math.max(1, Math.min(parseIntSafe(req.query.limit, 50) || 50, 250))
const filters = []
const params = []

const rawScope = cleanText(req.query.scope || "", 32).toLowerCase()
if (rawScope && !SENTINEL_POSITION_SCOPES.has(rawScope)) {
return res.status(400).json({
ok: false,
error: "Invalid scope filter",
})
}
const scope = normalizeSentinelPositionScope(rawScope || "open", "open")

const stage = cleanText(req.query.stage || "", 64).toLowerCase()
const outcome = cleanText(req.query.outcome || "", 64).toLowerCase()
const mode = cleanText(req.query.mode || "", 64).toLowerCase()
const tokenId = cleanText(req.query.token_id || "", 255)
const mintAddress = cleanText(req.query.mint_address || "", 255)

if (mode) {
if (!SENTINEL_MODES.has(mode)) {
return res.status(400).json({
ok: false,
error: "Invalid mode filter",
})
}
filters.push(`execution_mode = ?`)
params.push(mode)
}

if (tokenId) {
filters.push(`token_id = ?`)
params.push(tokenId)
}

if (mintAddress) {
filters.push(`mint_address = ?`)
params.push(mintAddress)
}

if (stage) {
if (stage === "open") {
filters.push(
`stage IN ('scout_open','sniper_added','half_banked_at_10x','runner_only')`
)
} else if (SENTINEL_POSITION_STAGES.has(stage)) {
filters.push(`stage = ?`)
params.push(stage)
} else {
return res.status(400).json({
ok: false,
error: "Invalid stage filter",
})
}
} else if (outcome) {
if (!SENTINEL_HISTORY_POSITION_STAGES.has(outcome)) {
return res.status(400).json({
ok: false,
error: "Invalid outcome filter",
})
}
filters.push(`stage = ?`)
params.push(outcome)
} else if (scope === "open") {
filters.push(
`stage IN ('scout_open','sniper_added','half_banked_at_10x','runner_only')`
)
} else if (scope === "history") {
filters.push(`stage IN ('closed','invalidated')`)
}

const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
const rows = await db.all(
`
SELECT *
FROM cassie_sentinel_positions
${whereSql}
ORDER BY datetime(
CASE
WHEN stage IN ('closed', 'invalidated')
THEN COALESCE(invalidated_at, closed_at, opened_at)
ELSE COALESCE(opened_at, closed_at, invalidated_at)
END
) DESC, id DESC
LIMIT ?
`,
[...params, limit]
)

return res.json({
ok: true,
scope,
count: rows.length,
positions: rows.map(serializeSentinelPosition),
})
} catch (error) {
console.error("GET /api/compliance-admin/sentinel/positions failed", error)
return res.status(500).json({
ok: false,
error: "Failed to load Sentinel positions",
message: error?.message || String(error),
})
}
})

router.get("/sentinel/positions/:id", async (req, res) => {
try {
const id = parseIntSafe(req.params.id, null)
const auditLimit = Math.max(
1,
Math.min(parseIntSafe(req.query.audit_limit, 200) || 200, 500)
)

if (!id) {
return res.status(400).json({
ok: false,
error: "Invalid Sentinel position id",
})
}

const position = await db.get(
`SELECT * FROM cassie_sentinel_positions WHERE id = ?`,
[id]
)

if (!position) {
return res.status(404).json({
ok: false,
error: "Sentinel position not found",
})
}

const audit = await db.all(
`
SELECT *
FROM cassie_sentinel_audit_events
WHERE position_id = ?
ORDER BY datetime(created_at) DESC, id DESC
LIMIT ?
`,
[id, auditLimit]
)

return res.json({
ok: true,
position: serializeSentinelPosition(position),
audit: audit.map(serializeSentinelAuditRow),
})
} catch (error) {
console.error("GET /api/compliance-admin/sentinel/positions/:id failed", error)
return res.status(500).json({
ok: false,
error: "Failed to load Sentinel position detail",
message: error?.message || String(error),
})
}
})

router.get("/sentinel/audit", async (req, res) => {
try {
const limit = Math.max(1, Math.min(parseIntSafe(req.query.limit, 100) || 100, 500))
const filters = []
const params = []

const eventType = cleanText(req.query.event_type || "", 64).toLowerCase()
const decision = cleanText(req.query.decision || "", 64).toLowerCase()

const rawExecutionStatus = cleanText(req.query.execution_status || "", 32).toLowerCase()
if (rawExecutionStatus && !SENTINEL_AUDIT_EXECUTION_STATUSES.has(rawExecutionStatus)) {
return res.status(400).json({
ok: false,
error: "Invalid execution_status filter",
})
}
const executionStatus = normalizeSentinelAuditExecutionStatus(rawExecutionStatus, "")

const mode = cleanText(req.query.mode || "", 64).toLowerCase()
const tokenId = cleanText(req.query.token_id || "", 255)
const mintAddress = cleanText(req.query.mint_address || "", 255)

const rawActorType = cleanText(req.query.actor_type || "", 32).toLowerCase()
if (rawActorType && !SENTINEL_AUDIT_ACTOR_TYPES.has(rawActorType)) {
return res.status(400).json({
ok: false,
error: "Invalid actor_type filter",
})
}
const actorType = normalizeSentinelAuditActorType(rawActorType, "")

const actorId = cleanText(req.query.actor_id || "", 255)
const reasonCode = cleanText(req.query.reason_code || "", 128)
const positionId = parseIntSafe(req.query.position_id, null)

if (eventType) {
if (!SENTINEL_AUDIT_EVENT_TYPES.has(eventType)) {
return res.status(400).json({
ok: false,
error: "Invalid Sentinel audit event_type filter",
})
}
filters.push(`event_type = ?`)
params.push(eventType)
}

if (decision) {
filters.push(`decision = ?`)
params.push(decision)
}

if (executionStatus) {
filters.push(`execution_status = ?`)
params.push(executionStatus)
}

if (mode) {
if (!SENTINEL_MODES.has(mode)) {
return res.status(400).json({
ok: false,
error: "Invalid mode filter",
})
}
filters.push(`execution_mode = ?`)
params.push(mode)
}

if (tokenId) {
filters.push(`token_id = ?`)
params.push(tokenId)
}

if (mintAddress) {
filters.push(`mint_address = ?`)
params.push(mintAddress)
}

if (actorType) {
filters.push(`actor_type = ?`)
params.push(actorType)
}

if (actorId) {
filters.push(`actor_id = ?`)
params.push(actorId)
}

if (reasonCode) {
filters.push(`reason_codes LIKE ?`)
params.push(`%"${reasonCode}"%`)
}

if (positionId) {
filters.push(`position_id = ?`)
params.push(positionId)
}

const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
const rows = await db.all(
`
SELECT *
FROM cassie_sentinel_audit_events
${whereSql}
ORDER BY datetime(created_at) DESC, id DESC
LIMIT ?
`,
[...params, limit]
)

return res.json({
ok: true,
count: rows.length,
audit: rows.map(serializeSentinelAuditRow),
})
} catch (error) {
console.error("GET /api/compliance-admin/sentinel/audit failed", error)
return res.status(500).json({
ok: false,
error: "Failed to load Sentinel audit log",
message: error?.message || String(error),
})
}
})

router.get("/sentinel/stats/daily", async (req, res) => {
try {
const date = parseDateOnly(req.query.date || todayUtcDate())
const mode = normalizeSentinelMode(req.query.mode || "paper", "paper")

const row = await getSentinelDailyStatsRow(date, mode)
const stats = serializeSentinelDailyStats(row) || buildEmptySentinelDailyStats(date, mode)

return res.json({
ok: true,
stats,
})
} catch (error) {
console.error("GET /api/compliance-admin/sentinel/stats/daily failed", error)
return res.status(500).json({
ok: false,
error: "Failed to load Sentinel daily stats",
message: error?.message || String(error),
})
}
})

router.get("/sentinel/stats/summary", async (req, res) => {
try {
const period = normalizeSentinelSummaryPeriod(req.query.period, "daily")
const date = parseDateOnly(req.query.date || todayUtcDate())
const mode = normalizeSentinelMode(req.query.mode || "paper", "paper")
const stats = await getSentinelPeriodStats({
period,
statDate: date,
executionMode: mode,
})

return res.json({
ok: true,
stats,
})
} catch (error) {
console.error("GET /api/compliance-admin/sentinel/stats/summary failed", error)
return res.status(500).json({
ok: false,
error: "Failed to load Sentinel period stats",
message: error?.message || String(error),
})
}
})

router.get("/sentinel/summary", async (req, res) => {
try {
const period = normalizeSentinelSummaryPeriod(req.query.period, "daily")
const date = parseDateOnly(req.query.date || todayUtcDate())
const requestedMode = cleanText(req.query.mode || "", 64).toLowerCase()
const mode = SENTINEL_MODES.has(requestedMode) ? requestedMode : null
const payload = await buildSentinelStatusPayload({ period, date, mode })

return res.json({
ok: true,
summary: payload.summary,
engine: payload.engine,
})
} catch (error) {
console.error("GET /api/compliance-admin/sentinel/summary failed", error)
return res.status(500).json({
ok: false,
error: "Failed to load Sentinel summary",
message: error?.message || String(error),
})
}
})

export default router