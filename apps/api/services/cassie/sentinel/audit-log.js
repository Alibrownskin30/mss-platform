import db from "../../../db/index.js";
import { SENTINEL_MODE } from "./config.js";
import { REASON_CODE, ensureReasonCodeArray } from "./reason-codes.js";

export const AUDIT_EVENT_TYPE = {
DECISION: "decision",
SETTINGS_UPDATE: "settings_update",
MODE_CHANGE: "mode_change",
EMERGENCY_STOP: "emergency_stop",
TOKEN_REJECT: "token_reject",
WATCHLIST: "watchlist",
HOLD: "hold",
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

function firstDefined(...values) {
for (const value of values) {
if (value !== undefined && value !== null && value !== "") {
return value;
}
}
return undefined;
}

function safeJsonParse(value, fallback = null) {
if (!value) return fallback;
if (typeof value === "object") return value;
try {
return JSON.parse(value);
} catch {
return fallback;
}
}

function getInsertId(result) {
const candidate =
result?.lastID ??
result?.lastId ??
result?.lastInsertRowid ??
result?.insertId ??
null;

const id = Number(candidate);
return Number.isFinite(id) && id > 0 ? id : null;
}

function normalizeEventType(value) {
const normalized = cleanText(value, 64).toLowerCase();
return VALID_EVENT_TYPES.has(normalized)
? normalized
: AUDIT_EVENT_TYPE.DECISION;
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

function normalizeDecision(value, fallback = "hold") {
return cleanText(value, 64).toLowerCase() || fallback;
}

function normalizeActorType(value, fallback = "system") {
return cleanText(value, 32).toLowerCase() || fallback;
}

function extractSnapshotSummary(snapshot = {}) {
return {
marketcap_usd: toFloat(
firstDefined(snapshot.marketcap_usd, snapshot.marketcapUsd, snapshot.mcap_usd, snapshot.mcapUsd),
null
),
liquidity_usd: toFloat(
firstDefined(snapshot.liquidity_usd, snapshot.liquidityUsd, snapshot.market?.liquidity_usd, snapshot.market?.liquidityUsd),
null
),
regime_state: cleanText(
firstDefined(snapshot.regime_state, snapshot.regimeState),
64
) || null,
regime_score: toFloat(
firstDefined(snapshot.regime_score, snapshot.regimeScore),
null
),
operator_quality_score: toFloat(
firstDefined(snapshot.operator_quality_score, snapshot.operatorQualityScore),
null
),
hidden_control_risk: toFloat(
firstDefined(snapshot.hidden_control_risk, snapshot.hiddenControlRisk),
null
),
buy_pressure_score: toFloat(
firstDefined(snapshot.buy_pressure_score, snapshot.buyPressureScore),
null
),
reclaim_strength_score: toFloat(
firstDefined(snapshot.reclaim_strength_score, snapshot.reclaimStrengthScore),
null
),
structural_health_score: toFloat(
firstDefined(snapshot.structural_health_score, snapshot.structuralHealthScore),
null
),
};
}

function extractActionPayload(payload = {}) {
return {
action_size_usd: toFloat(
firstDefined(payload.size_usd, payload.action_size_usd),
null
),
bank_fraction: toFloat(payload.bank_fraction, null),
position_id: toInt(payload.position_id, null),
};
}

function serializeAuditRow(row) {
if (!row) return null;

return {
id: toInt(row.id, null),
event_type: cleanText(row.event_type, 64) || null,
token_id: cleanText(row.token_id, 255) || null,
mint_address: cleanText(row.mint_address, 255) || null,
position_id: row.position_id == null ? null : Number(row.position_id),
execution_mode: cleanText(row.execution_mode, 64) || null,
decision: cleanText(row.decision, 64) || null,
reason_codes: ensureReasonCodeArray(safeJsonParse(row.reason_codes, []), []),
marketcap_usd: row.marketcap_usd == null ? null : Number(row.marketcap_usd),
liquidity_usd: row.liquidity_usd == null ? null : Number(row.liquidity_usd),
regime_state: cleanText(row.regime_state, 64) || null,
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
execution_status: cleanText(row.execution_status, 32) || null,
execution_error: cleanText(row.execution_error, 1000) || null,
actor_type: cleanText(row.actor_type, 32) || null,
actor_id: cleanText(row.actor_id, 255) || null,
created_at: row.created_at || null,
};
}

export async function logAuditEvent({
event_type = AUDIT_EVENT_TYPE.DECISION,
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
const safeDecision = normalizeDecision(decision, "hold");
const safeActorType = normalizeActorType(actor_type, "system");
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

const eventId = getInsertId(result);
return eventId ? getAuditEventById(eventId) : null;
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
mint_address = null,
position_id = null,
decision = null,
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

const safeMintAddress = cleanText(mint_address, 255);
if (safeMintAddress) {
filters.push(`mint_address = ?`);
params.push(safeMintAddress);
}

const safePositionId = toInt(position_id, null);
if (safePositionId) {
filters.push(`position_id = ?`);
params.push(safePositionId);
}

const safeDecision = cleanText(decision, 64).toLowerCase();
if (safeDecision) {
filters.push(`decision = ?`);
params.push(safeDecision);
}

const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
const safeLimit = Math.max(1, Math.min(500, toInt(limit, 100) || 100));

const rows = await db.all(
`
SELECT *
FROM cassie_sentinel_audit_events
${whereSql}
ORDER BY datetime(created_at) DESC, id DESC
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

export async function logWatchlist({
token_id,
mint_address = null,
position_id = null,
execution_mode = null,
reason_codes = [],
snapshot_summary = null,
execution_status = EXECUTION_STATUS.SIMULATED,
execution_error = null,
actor_id = null,
} = {}) {
return logAuditEvent({
event_type: AUDIT_EVENT_TYPE.WATCHLIST,
token_id,
mint_address,
position_id,
execution_mode,
decision: "watchlist",
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

export async function logHold({
token_id,
mint_address = null,
position_id = null,
execution_mode = null,
reason_codes = [],
snapshot_summary = null,
execution_status = EXECUTION_STATUS.SIMULATED,
execution_error = null,
actor_id = null,
} = {}) {
return logAuditEvent({
event_type: AUDIT_EVENT_TYPE.HOLD,
token_id,
mint_address,
position_id,
execution_mode,
decision: "hold",
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
reason_codes = [REASON_CODE.INVALID_POSITION_STATE],
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
logWatchlist,
logHold,
logScoutEntry,
logSniperAdd,
logPartialTakeProfit,
logRunnerExit,
logFullExit,
logKillSwitch,
logExecutionFailure,
};
