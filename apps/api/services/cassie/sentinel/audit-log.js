import db from "../../../db/index.js";
import { SENTINEL_MODE } from "./config.js";
import {
REASON_CODE,
ensureReasonCode,
ensureReasonCodeArray,
} from "./reason-codes.js";

export const AUDIT_EVENT_TYPE = {
SETTINGS_UPDATE: "settings_update",
MODE_CHANGE: "mode_change",
EMERGENCY_STOP: "emergency_stop",
TOKEN_REJECT: "token_reject",
SCOUT_ENTRY: "scout_entry",
SNIPER_ADD: "sniper_add",
PARTIAL_TAKE_PROFIT: "partial_take_profit",
RUNNER_EXIT: "runner_exit",
FULL_EXIT: "full_exit",
KILL_SWITCH: "kill_switch",
};

export const EXECUTION_STATUS = {
PLANNED: "planned",
SIMULATED: "simulated",
SUBMITTED: "submitted",
FILLED: "filled",
FAILED: "failed",
SKIPPED: "skipped",
};

const VALID_EVENT_TYPES = new Set(Object.values(AUDIT_EVENT_TYPE));
const VALID_EXECUTION_STATUSES = new Set(Object.values(EXECUTION_STATUS));
const VALID_MODES = new Set(Object.values(SENTINEL_MODE));

function cleanText(value, max = 255) {
return String(value ?? "").trim().slice(0, max);
}

function toFloat(value, fallback = null) {
const num = Number.parseFloat(value);
return Number.isFinite(num) ? num : fallback;
}

function toInt(value, fallback = null) {
const num = Number.parseInt(value, 10);
return Number.isFinite(num) ? num : fallback;
}

function normalizeEventType(value) {
const normalized = cleanText(value, 64).toLowerCase();
return VALID_EVENT_TYPES.has(normalized)
? normalized
: AUDIT_EVENT_TYPE.SETTINGS_UPDATE;
}

function normalizeExecutionStatus(value) {
const normalized = cleanText(value, 32).toLowerCase();
return VALID_EXECUTION_STATUSES.has(normalized)
? normalized
: EXECUTION_STATUS.PLANNED;
}

function normalizeMode(value, fallback = null) {
const normalized = cleanText(value, 64).toLowerCase();
if (VALID_MODES.has(normalized)) return normalized;
return fallback;
}

function extractSnapshotSummary(snapshot = {}) {
return {
marketcap_usd: toFloat(snapshot.marketcap_usd, null),
liquidity_usd: toFloat(snapshot.liquidity_usd, null),
regime_state: cleanText(snapshot.regime_state, 64) || null,
regime_score: toFloat(snapshot.regime_score, null),
operator_quality_score: toFloat(snapshot.operator_quality_score, null),
hidden_control_risk: toFloat(snapshot.hidden_control_risk, null),
buy_pressure_score: toFloat(snapshot.buy_pressure_score, null),
reclaim_strength_score: toFloat(snapshot.reclaim_strength_score, null),
structural_health_score: toFloat(snapshot.structural_health_score, null),
};
}

function extractActionPayload(payload = {}) {
return {
action_size_usd: toFloat(payload.size_usd ?? payload.action_size_usd, null),
bank_fraction: toFloat(payload.bank_fraction, null),
position_id: toInt(payload.position_id, null),
};
}

function serializeAuditRow(row) {
if (!row) return null;

return {
id: row.id,
event_type: row.event_type,
token_id: row.token_id || null,
mint_address: row.mint_address || null,
position_id: row.position_id == null ? null : Number(row.position_id),
execution_mode: row.execution_mode || null,
decision: row.decision,
reason_codes: safeJsonParse(row.reason_codes, []),
marketcap_usd: row.marketcap_usd == null ? null : Number(row.marketcap_usd),
liquidity_usd: row.liquidity_usd == null ? null : Number(row.liquidity_usd),
regime_state: row.regime_state || null,
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
execution_error: row.execution_error || null,
actor_type: row.actor_type,
actor_id: row.actor_id || null,
created_at: row.created_at || null,
};
}

function safeJsonParse(value, fallback = null) {
if (!value) return fallback;
try {
return JSON.parse(value);
} catch {
return fallback;
}
}

export async function logAuditEvent({
event_type = AUDIT_EVENT_TYPE.SETTINGS_UPDATE,
token_id = null,
mint_address = null,
position_id = null,
execution_mode = null,
decision = "hold",
reason_codes = [],
snapshot_summary = null,
action_payload = null,
execution_status = EXECUTION_STATUS.PLANNED,
execution_error = null,
actor_type = "system",
actor_id = null,
} = {}) {
const eventType = normalizeEventType(event_type);
const snapshot = extractSnapshotSummary(snapshot_summary || {});
const action = extractActionPayload(action_payload || {});
const safeReasonCodes = ensureReasonCodeArray(reason_codes, []);
const safeDecision = cleanText(decision, 64) || "hold";
const safeActorType = cleanText(actor_type, 32) || "system";
const safeActorId = cleanText(actor_id, 255) || null;
const safeMode = normalizeMode(execution_mode, null);
const safePositionId = toInt(position_id, null);

const result = await db.run(
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
eventType,
cleanText(token_id, 255) || null,
cleanText(mint_address, 255) || null,
safePositionId,
safeMode,
safeDecision,
JSON.stringify(safeReasonCodes),
snapshot.marketcap_usd,
snapshot.liquidity_usd,
snapshot.regime_state,
snapshot.regime_score,
snapshot.operator_quality_score,
snapshot.hidden_control_risk,
snapshot.buy_pressure_score,
snapshot.reclaim_strength_score,
snapshot.structural_health_score,
action.action_size_usd,
action.bank_fraction,
normalizeExecutionStatus(execution_status),
cleanText(execution_error, 1000) || null,
safeActorType,
safeActorId,
]
);

return getAuditEventById(result?.lastID);
}

export async function getAuditEventById(eventId) {
const id = toInt(eventId, 0);
if (!id) return null;

const row = await db.get(
`SELECT * FROM cassie_sentinel_audit_events WHERE id = ? LIMIT 1`,
[id]
);

return serializeAuditRow(row);
}

export async function listRecentAuditEvents({
event_type = null,
execution_mode = null,
token_id = null,
position_id = null,
limit = 100,
} = {}) {
const filters = [];
const params = [];

const safeEventType = cleanText(event_type, 64).toLowerCase();
if (safeEventType && VALID_EVENT_TYPES.has(safeEventType)) {
filters.push(`event_type = ?`);
params.push(safeEventType);
}

const safeMode = normalizeMode(execution_mode, null);
if (safeMode) {
filters.push(`execution_mode = ?`);
params.push(safeMode);
}

const safeTokenId = cleanText(token_id, 255);
if (safeTokenId) {
filters.push(`token_id = ?`);
params.push(safeTokenId);
}

const safePositionId = toInt(position_id, null);
if (safePositionId) {
filters.push(`position_id = ?`);
params.push(safePositionId);
}

const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
const safeLimit = Math.max(1, Math.min(500, toInt(limit, 100) || 100));

const rows = await db.all(
`
SELECT *
FROM cassie_sentinel_audit_events
${whereSql}
ORDER BY created_at DESC, id DESC
LIMIT ?
`,
[...params, safeLimit]
);

return rows.map(serializeAuditRow);
}

export async function logSettingsUpdate({
execution_mode = null,
actor_id = null,
reason_codes = [REASON_CODE.SETTINGS_PATCH_APPLIED],
} = {}) {
return logAuditEvent({
event_type: AUDIT_EVENT_TYPE.SETTINGS_UPDATE,
execution_mode,
decision: "settings_update",
reason_codes,
actor_type: "admin",
actor_id,
execution_status: EXECUTION_STATUS.SKIPPED,
});
}

export async function logModeChange({
execution_mode,
actor_id = null,
reason_codes = [REASON_CODE.SENTINEL_MODE_CHANGED],
} = {}) {
return logAuditEvent({
event_type: AUDIT_EVENT_TYPE.MODE_CHANGE,
execution_mode,
decision: "mode_change",
reason_codes,
actor_type: "admin",
actor_id,
execution_status: EXECUTION_STATUS.SKIPPED,
});
}

export async function logEmergencyStop({
actor_id = null,
reason_codes = [REASON_CODE.SENTINEL_EMERGENCY_STOP],
} = {}) {
return logAuditEvent({
event_type: AUDIT_EVENT_TYPE.EMERGENCY_STOP,
execution_mode: SENTINEL_MODE.EMERGENCY_STOP,
decision: "kill_switch",
reason_codes,
actor_type: "admin",
actor_id,
execution_status: EXECUTION_STATUS.SKIPPED,
});
}

export async function logTokenReject({
token_id,
mint_address = null,
execution_mode = null,
reason_codes = [REASON_CODE.TOKEN_REJECTED],
snapshot_summary = null,
actor_id = null,
} = {}) {
return logAuditEvent({
event_type: AUDIT_EVENT_TYPE.TOKEN_REJECT,
token_id,
mint_address,
execution_mode,
decision: "reject",
reason_codes,
snapshot_summary,
actor_type: "system",
actor_id,
execution_status: EXECUTION_STATUS.SKIPPED,
});
}

export async function logScoutEntry({
token_id,
mint_address,
position_id = null,
execution_mode = null,
size_usd = null,
reason_codes = [REASON_CODE.SCOUT_ENTRY_APPROVED],
snapshot_summary = null,
execution_status = EXECUTION_STATUS.PLANNED,
execution_error = null,
actor_id = null,
} = {}) {
return logAuditEvent({
event_type: AUDIT_EVENT_TYPE.SCOUT_ENTRY,
token_id,
mint_address,
position_id,
execution_mode,
decision: "scout_entry",
reason_codes,
snapshot_summary,
action_payload: {
size_usd,
position_id,
},
execution_status,
execution_error,
actor_type: "system",
actor_id,
});
}

export async function logSniperAdd({
token_id,
mint_address,
position_id,
execution_mode = null,
size_usd = null,
reason_codes = [REASON_CODE.SNIPER_ADD_APPROVED],
snapshot_summary = null,
execution_status = EXECUTION_STATUS.PLANNED,
execution_error = null,
actor_id = null,
} = {}) {
return logAuditEvent({
event_type: AUDIT_EVENT_TYPE.SNIPER_ADD,
token_id,
mint_address,
position_id,
execution_mode,
decision: "sniper_add",
reason_codes,
snapshot_summary,
action_payload: {
size_usd,
position_id,
},
execution_status,
execution_error,
actor_type: "system",
actor_id,
});
}

export async function logPartialTakeProfit({
token_id,
mint_address,
position_id,
execution_mode = null,
bank_fraction = 0.5,
reason_codes = [REASON_CODE.PARTIAL_TAKE_PROFIT_EXECUTED],
snapshot_summary = null,
execution_status = EXECUTION_STATUS.PLANNED,
execution_error = null,
actor_id = null,
} = {}) {
return logAuditEvent({
event_type: AUDIT_EVENT_TYPE.PARTIAL_TAKE_PROFIT,
token_id,
mint_address,
position_id,
execution_mode,
decision: "partial_take_profit",
reason_codes,
snapshot_summary,
action_payload: {
position_id,
bank_fraction,
},
execution_status,
execution_error,
actor_type: "system",
actor_id,
});
}

export async function logRunnerExit({
token_id,
mint_address,
position_id,
execution_mode = null,
reason_codes = [REASON_CODE.RUNNER_EXIT_EXECUTED],
snapshot_summary = null,
execution_status = EXECUTION_STATUS.PLANNED,
execution_error = null,
actor_id = null,
} = {}) {
return logAuditEvent({
event_type: AUDIT_EVENT_TYPE.RUNNER_EXIT,
token_id,
mint_address,
position_id,
execution_mode,
decision: "full_exit",
reason_codes,
snapshot_summary,
action_payload: {
position_id,
},
execution_status,
execution_error,
actor_type: "system",
actor_id,
});
}

export async function logFullExit({
token_id,
mint_address,
position_id,
execution_mode = null,
reason_codes = [REASON_CODE.FULL_EXIT_EXECUTED],
snapshot_summary = null,
execution_status = EXECUTION_STATUS.PLANNED,
execution_error = null,
actor_id = null,
} = {}) {
return logAuditEvent({
event_type: AUDIT_EVENT_TYPE.FULL_EXIT,
token_id,
mint_address,
position_id,
execution_mode,
decision: "full_exit",
reason_codes,
snapshot_summary,
action_payload: {
position_id,
},
execution_status,
execution_error,
actor_type: "system",
actor_id,
});
}

export async function logKillSwitch({
execution_mode = null,
reason_codes = [REASON_CODE.KILL_SWITCH_TRIGGERED],
actor_id = null,
} = {}) {
return logAuditEvent({
event_type: AUDIT_EVENT_TYPE.KILL_SWITCH,
execution_mode,
decision: "kill_switch",
reason_codes,
actor_type: "system",
actor_id,
execution_status: EXECUTION_STATUS.SKIPPED,
});
}

export async function logExecutionFailure({
event_type = AUDIT_EVENT_TYPE.FULL_EXIT,
token_id = null,
mint_address = null,
position_id = null,
execution_mode = null,
decision = "hold",
reason_codes = [ensureReasonCode(REASON_CODE.INVALID_POSITION_STATE)],
snapshot_summary = null,
action_payload = null,
execution_error = "Execution failed.",
actor_id = null,
} = {}) {
return logAuditEvent({
event_type,
token_id,
mint_address,
position_id,
execution_mode,
decision,
reason_codes,
snapshot_summary,
action_payload,
execution_status: EXECUTION_STATUS.FAILED,
execution_error,
actor_type: "system",
actor_id,
});
}

export default {
AUDIT_EVENT_TYPE,
EXECUTION_STATUS,
logAuditEvent,
getAuditEventById,
listRecentAuditEvents,
logSettingsUpdate,
logModeChange,
logEmergencyStop,
logTokenReject,
logScoutEntry,
logSniperAdd,
logPartialTakeProfit,
logRunnerExit,
logFullExit,
logKillSwitch,
logExecutionFailure,
};
