import express from "express";
import db from "../db/index.js";
import auditLog from "../services/compliance/auditLog.js";

const router = express.Router();

const CASE_STATUSES = new Set([
"open",
"pending_info",
"approved",
"rejected",
"escalated",
"frozen",
]);

const RISK_LEVELS = new Set(["low", "medium", "high", "critical"]);

const SENTINEL_MODES = new Set([
"paper",
"armed_mainnet",
"live_mainnet",
"emergency_stop",
]);

const SENTINEL_POSITION_STAGES = new Set([
"scout_open",
"sniper_added",
"half_banked_at_10x",
"runner_only",
"closed",
"invalidated",
]);

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
]);

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max);
}

function parseIntSafe(value, fallback = null) {
const num = Number.parseInt(value, 10);
return Number.isFinite(num) ? num : fallback;
}

function parseFloatSafe(value, fallback = null) {
const num = Number.parseFloat(value);
return Number.isFinite(num) ? num : fallback;
}

function parseBoolSafe(value, fallback = false) {
if (typeof value === "boolean") return value;
if (value === 1 || value === "1" || value === "true") return true;
if (value === 0 || value === "0" || value === "false") return false;
return fallback;
}

function normalizeStatus(value, fallback = "open") {
const normalized = cleanText(value, 32).toLowerCase();
return CASE_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizeRiskLevel(value, fallback = "low") {
const normalized = cleanText(value, 32).toLowerCase();
return RISK_LEVELS.has(normalized) ? normalized : fallback;
}

function normalizeSentinelMode(value, fallback = "paper") {
const normalized = cleanText(value, 64).toLowerCase();
return SENTINEL_MODES.has(normalized) ? normalized : fallback;
}

function parseJson(value, fallback = null) {
if (!value) return fallback;
try {
return JSON.parse(value);
} catch {
return fallback;
}
}

function todayUtcDate() {
return new Date().toISOString().slice(0, 10);
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
);
}

async function getSentinelSettingsRow() {
return db.get(`SELECT * FROM cassie_sentinel_settings WHERE id = 1`);
}

function serializeSentinelSettings(row) {
if (!row) return null;
return {
watcher_enabled: Boolean(row.watcher_enabled),
execution_mode: row.execution_mode,
auto_bank_enabled: Boolean(row.auto_bank_enabled),
auto_bank_multiple: Number(row.auto_bank_multiple ?? 10),
auto_bank_fraction: Number(row.auto_bank_fraction ?? 0.5),

scout_usd: Number(row.scout_usd ?? 0.5),
sniper_add_usd: Number(row.sniper_add_usd ?? 1.0),
max_total_position_usd: Number(row.max_total_position_usd ?? 1.5),
max_open_positions: Number(row.max_open_positions ?? 30),
max_positions_per_operator_cluster: Number(row.max_positions_per_operator_cluster ?? 2),

max_daily_loss_usd: Number(row.max_daily_loss_usd ?? 25),
max_daily_scout_spend_usd: Number(row.max_daily_scout_spend_usd ?? 20),
max_daily_sniper_spend_usd: Number(row.max_daily_sniper_spend_usd ?? 30),
max_consecutive_failures: Number(row.max_consecutive_failures ?? 8),
max_tokens_per_hour: Number(row.max_tokens_per_hour ?? 12),

cooldown_after_close_sec: Number(row.cooldown_after_close_sec ?? 1800),
cooldown_after_invalidation_sec: Number(row.cooldown_after_invalidation_sec ?? 3600),
early_fail_timeout_sec: Number(row.early_fail_timeout_sec ?? 180),
weak_stall_timeout_sec: Number(row.weak_stall_timeout_sec ?? 420),
runner_failed_breakout_limit: Number(row.runner_failed_breakout_limit ?? 2),

min_operator_quality_score: Number(row.min_operator_quality_score ?? 70),
max_hidden_control_risk: Number(row.max_hidden_control_risk ?? 30),
max_contamination_risk: Number(row.max_contamination_risk ?? 35),
max_wallet_coordination_risk: Number(row.max_wallet_coordination_risk ?? 40),

min_regime_score_for_scout: Number(row.min_regime_score_for_scout ?? 55),
min_regime_score_for_sniper: Number(row.min_regime_score_for_sniper ?? 65),

max_top_holder_pct: Number(row.max_top_holder_pct ?? 18),
max_top_5_holder_pct: Number(row.max_top_5_holder_pct ?? 45),
min_liquidity_usd: Number(row.min_liquidity_usd ?? 800),
max_spread_bps: Number(row.max_spread_bps ?? 350),
max_price_impact_bps: Number(row.max_price_impact_bps ?? 500),

min_reclaim_strength_score: Number(row.min_reclaim_strength_score ?? 60),
min_buy_pressure_score: Number(row.min_buy_pressure_score ?? 62),
min_persistence_score: Number(row.min_persistence_score ?? 58),
min_post_entry_health_score: Number(row.min_post_entry_health_score ?? 55),
max_vertical_extension_score_for_add: Number(row.max_vertical_extension_score_for_add ?? 75),
max_insider_sell_score: Number(row.max_insider_sell_score ?? 45),
max_liquidity_decay_score: Number(row.max_liquidity_decay_score ?? 50),

risk_off_disable_new_entries: Boolean(row.risk_off_disable_new_entries),

enable_scout: Boolean(row.enable_scout),
enable_sniper: Boolean(row.enable_sniper),
enable_runner_management: Boolean(row.enable_runner_management),
enable_market_regime_filter: Boolean(row.enable_market_regime_filter),
enable_operator_filter: Boolean(row.enable_operator_filter),
enable_hard_rejects: Boolean(row.enable_hard_rejects),

created_at: row.created_at,
updated_at: row.updated_at,
updated_by: row.updated_by,
};
}

function serializeSentinelPosition(row) {
if (!row) return null;
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
};
}

function serializeSentinelAuditRow(row) {
if (!row) return null;
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
};
}

async function insertSentinelAuditEvent(payload = {}) {
const reasonCodes = Array.isArray(payload.reason_codes) ? payload.reason_codes : [];
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
);
}

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
};

router.get("/cases", async (req, res) => {
try {
const limit = Math.max(
1,
Math.min(500, parseIntSafe(req.query.limit, 100) || 100)
);

const filters = [];
const params = [];

const status = cleanText(req.query.status, 32).toLowerCase();
if (CASE_STATUSES.has(status)) {
filters.push("c.status = ?");
params.push(status);
}

const caseType = cleanText(
req.query.case_type || req.query.caseType,
32
).toLowerCase();
if (caseType) {
filters.push("c.case_type = ?");
params.push(caseType);
}

const riskLevel = cleanText(
req.query.risk_level || req.query.riskLevel,
32
).toLowerCase();
if (RISK_LEVELS.has(riskLevel)) {
filters.push("c.risk_level = ?");
params.push(riskLevel);
}

const profileId = parseIntSafe(
req.query.compliance_profile_id || req.query.profile_id || req.query.profileId
);
if (profileId) {
filters.push("c.compliance_profile_id = ?");
params.push(profileId);
}

const launchId = parseIntSafe(req.query.launch_id || req.query.launchId);
if (launchId) {
filters.push("c.launch_id = ?");
params.push(launchId);
}

const assignedTo = cleanText(req.query.assigned_to || req.query.assignedTo, 120);
if (assignedTo) {
filters.push("c.assigned_to = ?");
params.push(assignedTo);
}

const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

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
);

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
});
} catch (error) {
console.error("GET /api/compliance-admin/cases failed", error);
return res.status(500).json({
ok: false,
error: "Failed to fetch compliance cases",
message: error?.message || String(error),
});
}
});

router.get("/cases/:id", async (req, res) => {
try {
const caseId = parseIntSafe(req.params.id);

if (!caseId) {
return res.status(400).json({
ok: false,
error: "Valid case id is required",
});
}

const row = await getCaseById(caseId);

if (!row) {
return res.status(404).json({
ok: false,
error: "Compliance case not found",
});
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
});
} catch (error) {
console.error("GET /api/compliance-admin/cases/:id failed", error);
return res.status(500).json({
ok: false,
error: "Failed to fetch compliance case",
message: error?.message || String(error),
});
}
});

router.post("/cases/:id/approve", async (req, res) => {
try {
const caseId = parseIntSafe(req.params.id);
const actorId = cleanText(req.body?.actor_id || req.body?.actorId, 120) || "admin";
const notes = cleanText(req.body?.notes, 2000) || null;

if (!caseId) {
return res.status(400).json({
ok: false,
error: "Valid case id is required",
});
}

const before = await getCaseById(caseId);
if (!before) {
return res.status(404).json({
ok: false,
error: "Compliance case not found",
});
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
);

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
);
}

const after = await getCaseById(caseId);

await auditLog.logCaseEvent({
actorType: "admin",
actorId,
action: "case_approved",
caseId,
oldState: before,
newState: after,
notes,
});

return res.json({
ok: true,
case: after,
});
} catch (error) {
console.error("POST /api/compliance-admin/cases/:id/approve failed", error);
return res.status(500).json({
ok: false,
error: "Failed to approve compliance case",
message: error?.message || String(error),
});
}
});

router.post("/cases/:id/reject", async (req, res) => {
try {
const caseId = parseIntSafe(req.params.id);
const actorId = cleanText(req.body?.actor_id || req.body?.actorId, 120) || "admin";
const notes = cleanText(req.body?.notes, 2000) || null;

if (!caseId) {
return res.status(400).json({
ok: false,
error: "Valid case id is required",
});
}

const before = await getCaseById(caseId);
if (!before) {
return res.status(404).json({
ok: false,
error: "Compliance case not found",
});
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
);

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
);
}

const after = await getCaseById(caseId);

await auditLog.logCaseEvent({
actorType: "admin",
actorId,
action: "case_rejected",
caseId,
oldState: before,
newState: after,
notes,
});

return res.json({
ok: true,
case: after,
});
} catch (error) {
console.error("POST /api/compliance-admin/cases/:id/reject failed", error);
return res.status(500).json({
ok: false,
error: "Failed to reject compliance case",
message: error?.message || String(error),
});
}
});

router.post("/cases/:id/freeze", async (req, res) => {
try {
const caseId = parseIntSafe(req.params.id);
const actorId = cleanText(req.body?.actor_id || req.body?.actorId, 120) || "admin";
const notes = cleanText(req.body?.notes, 2000) || null;

if (!caseId) {
return res.status(400).json({
ok: false,
error: "Valid case id is required",
});
}

const before = await getCaseById(caseId);
if (!before) {
return res.status(404).json({
ok: false,
error: "Compliance case not found",
});
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
);

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
);
}

const after = await getCaseById(caseId);

await auditLog.logCaseEvent({
actorType: "admin",
actorId,
action: "case_frozen",
caseId,
oldState: before,
newState: after,
notes,
});

return res.json({
ok: true,
case: after,
});
} catch (error) {
console.error("POST /api/compliance-admin/cases/:id/freeze failed", error);
return res.status(500).json({
ok: false,
error: "Failed to freeze compliance case",
message: error?.message || String(error),
});
}
});

router.post("/cases/:id/assign", async (req, res) => {
try {
const caseId = parseIntSafe(req.params.id);
const actorId = cleanText(req.body?.actor_id || req.body?.actorId, 120) || "admin";
const assignedTo = cleanText(req.body?.assigned_to || req.body?.assignedTo, 120);

if (!caseId) {
return res.status(400).json({
ok: false,
error: "Valid case id is required",
});
}

if (!assignedTo) {
return res.status(400).json({
ok: false,
error: "assigned_to is required",
});
}

const before = await getCaseById(caseId);
if (!before) {
return res.status(404).json({
ok: false,
error: "Compliance case not found",
});
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
);

const after = await getCaseById(caseId);

await auditLog.logCaseEvent({
actorType: "admin",
actorId,
action: "case_assigned",
caseId,
oldState: before,
newState: after,
notes: `Assigned to ${assignedTo}`,
});

return res.json({
ok: true,
case: after,
});
} catch (error) {
console.error("POST /api/compliance-admin/cases/:id/assign failed", error);
return res.status(500).json({
ok: false,
error: "Failed to assign compliance case",
message: error?.message || String(error),
});
}
});

router.post("/cases/:id/escalate", async (req, res) => {
try {
const caseId = parseIntSafe(req.params.id);
const actorId = cleanText(req.body?.actor_id || req.body?.actorId, 120) || "admin";
const notes = cleanText(req.body?.notes, 2000) || null;
const riskLevel = normalizeRiskLevel(req.body?.risk_level || req.body?.riskLevel, "high");

if (!caseId) {
return res.status(400).json({
ok: false,
error: "Valid case id is required",
});
}

const before = await getCaseById(caseId);
if (!before) {
return res.status(404).json({
ok: false,
error: "Compliance case not found",
});
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
);

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
);
}

const after = await getCaseById(caseId);

await auditLog.logCaseEvent({
actorType: "admin",
actorId,
action: "case_escalated",
caseId,
oldState: before,
newState: after,
notes,
});

return res.json({
ok: true,
case: after,
});
} catch (error) {
console.error("POST /api/compliance-admin/cases/:id/escalate failed", error);
return res.status(500).json({
ok: false,
error: "Failed to escalate compliance case",
message: error?.message || String(error),
});
}
});

// Sentinel Watcher admin routes

router.get("/sentinel/settings", async (req, res) => {
try {
const row = await getSentinelSettingsRow();
return res.json({
ok: true,
settings: serializeSentinelSettings(row),
});
} catch (error) {
console.error("GET /api/compliance-admin/sentinel/settings failed", error);
return res.status(500).json({
ok: false,
error: "Failed to load Sentinel settings",
message: error?.message || String(error),
});
}
});

router.patch("/sentinel/settings", async (req, res) => {
try {
const body = req.body || {};
const updates = [];
const values = [];

for (const [field, rule] of Object.entries(SENTINEL_PATCH_FIELDS)) {
if (!(field in body)) continue;

let parsed;
if (rule.type === "boolean") {
parsed = parseBoolSafe(body[field], false) ? 1 : 0;
} else if (rule.type === "int") {
parsed = parseIntSafe(body[field], null);
} else if (rule.type === "float") {
parsed = parseFloatSafe(body[field], null);
} else {
parsed = body[field];
}

if (parsed == null || Number.isNaN(parsed)) {
return res.status(400).json({
ok: false,
error: `Invalid value for ${field}`,
});
}

if (typeof parsed === "number") {
if (rule.min != null && parsed < rule.min) {
return res.status(400).json({
ok: false,
error: `${field} is below minimum allowed value`,
});
}
if (rule.max != null && parsed > rule.max) {
return res.status(400).json({
ok: false,
error: `${field} is above maximum allowed value`,
});
}
}

updates.push(`${field} = ?`);
values.push(parsed);
}

if (!updates.length) {
return res.status(400).json({
ok: false,
error: "No valid Sentinel settings fields were provided",
});
}

const actorId =
cleanText(req.body?.actor_id || req.headers["x-admin-actor"] || "admin", 255) ||
"admin";

updates.push(`updated_at = CURRENT_TIMESTAMP`);
updates.push(`updated_by = ?`);
values.push(actorId);
values.push(1);

await db.run(
`UPDATE cassie_sentinel_settings SET ${updates.join(", ")} WHERE id = ?`,
values
);

const updated = await getSentinelSettingsRow();

await insertSentinelAuditEvent({
event_type: "settings_update",
execution_mode: updated?.execution_mode || "paper",
decision: "settings_update",
reason_codes: ["SENTINEL_SETTINGS_PATCH"],
actor_type: "admin",
actor_id: actorId,
execution_status: "skipped",
});

return res.json({
ok: true,
settings: serializeSentinelSettings(updated),
});
} catch (error) {
console.error("PATCH /api/compliance-admin/sentinel/settings failed", error);
return res.status(500).json({
ok: false,
error: "Failed to update Sentinel settings",
message: error?.message || String(error),
});
}
});

router.post("/sentinel/mode", async (req, res) => {
try {
const current = await getSentinelSettingsRow();
if (!current) {
return res.status(404).json({
ok: false,
error: "Sentinel settings record not found",
});
}

const requestedMode = normalizeSentinelMode(req.body?.execution_mode, "");
const reason = cleanText(req.body?.reason || "", 500);
const confirmLive = parseBoolSafe(req.body?.confirm_live, false);
const actorId =
cleanText(req.body?.actor_id || req.headers["x-admin-actor"] || "admin", 255) ||
"admin";

if (!SENTINEL_MODES.has(requestedMode)) {
return res.status(400).json({
ok: false,
error: "Invalid Sentinel execution mode",
});
}

if (
(requestedMode === "armed_mainnet" || requestedMode === "live_mainnet") &&
!confirmLive
) {
return res.status(400).json({
ok: false,
error: "confirm_live=true is required before switching into mainnet execution",
});
}

if (current.execution_mode === requestedMode) {
return res.json({
ok: true,
previous_mode: current.execution_mode,
current_mode: current.execution_mode,
unchanged: true,
});
}

await db.run(
`
UPDATE cassie_sentinel_settings
SET execution_mode = ?,
updated_at = CURRENT_TIMESTAMP,
updated_by = ?
WHERE id = 1
`,
[requestedMode, actorId]
);

await insertSentinelAuditEvent({
event_type: "mode_change",
execution_mode: requestedMode,
decision: "mode_change",
reason_codes: reason ? [reason] : ["SENTINEL_MODE_CHANGE"],
actor_type: "admin",
actor_id: actorId,
execution_status: "skipped",
});

return res.json({
ok: true,
previous_mode: current.execution_mode,
current_mode: requestedMode,
});
} catch (error) {
console.error("POST /api/compliance-admin/sentinel/mode failed", error);
return res.status(500).json({
ok: false,
error: "Failed to switch Sentinel execution mode",
message: error?.message || String(error),
});
}
});

router.post("/sentinel/emergency-stop", async (req, res) => {
try {
const enabled = parseBoolSafe(req.body?.enabled, false);
const reason = cleanText(req.body?.reason || "", 500);
const actorId =
cleanText(req.body?.actor_id || req.headers["x-admin-actor"] || "admin", 255) ||
"admin";

if (!enabled) {
return res.status(400).json({
ok: false,
error:
"Emergency stop endpoint only enables stop. Use /sentinel/mode to restore a mode.",
});
}

const current = await getSentinelSettingsRow();

await db.run(
`
UPDATE cassie_sentinel_settings
SET execution_mode = 'emergency_stop',
updated_at = CURRENT_TIMESTAMP,
updated_by = ?
WHERE id = 1
`,
[actorId]
);

await insertSentinelAuditEvent({
event_type: "emergency_stop",
execution_mode: "emergency_stop",
decision: "kill_switch",
reason_codes: reason ? [reason] : ["SENTINEL_EMERGENCY_STOP"],
actor_type: "admin",
actor_id: actorId,
execution_status: "skipped",
});

return res.json({
ok: true,
previous_mode: current?.execution_mode || null,
current_mode: "emergency_stop",
});
} catch (error) {
console.error("POST /api/compliance-admin/sentinel/emergency-stop failed", error);
return res.status(500).json({
ok: false,
error: "Failed to activate Sentinel emergency stop",
message: error?.message || String(error),
});
}
});

router.get("/sentinel/positions", async (req, res) => {
try {
const limit = Math.min(parseIntSafe(req.query.limit, 50) || 50, 250);
const filters = [];
const params = [];

const stage = cleanText(req.query.stage || "", 64).toLowerCase();
const mode = cleanText(req.query.mode || "", 64).toLowerCase();
const tokenId = cleanText(req.query.token_id || "", 255);
const mintAddress = cleanText(req.query.mint_address || "", 255);

if (stage) {
if (stage === "open") {
filters.push(
`stage IN ('scout_open','sniper_added','half_banked_at_10x','runner_only')`
);
} else if (SENTINEL_POSITION_STAGES.has(stage)) {
filters.push(`stage = ?`);
params.push(stage);
} else {
return res.status(400).json({
ok: false,
error: "Invalid stage filter",
});
}
}

if (mode) {
if (!SENTINEL_MODES.has(mode)) {
return res.status(400).json({
ok: false,
error: "Invalid mode filter",
});
}
filters.push(`execution_mode = ?`);
params.push(mode);
}

if (tokenId) {
filters.push(`token_id = ?`);
params.push(tokenId);
}

if (mintAddress) {
filters.push(`mint_address = ?`);
params.push(mintAddress);
}

const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
const rows = await db.all(
`
SELECT *
FROM cassie_sentinel_positions
${whereSql}
ORDER BY opened_at DESC, id DESC
LIMIT ?
`,
[...params, limit]
);

return res.json({
ok: true,
positions: rows.map(serializeSentinelPosition),
});
} catch (error) {
console.error("GET /api/compliance-admin/sentinel/positions failed", error);
return res.status(500).json({
ok: false,
error: "Failed to load Sentinel positions",
message: error?.message || String(error),
});
}
});

router.get("/sentinel/positions/:id", async (req, res) => {
try {
const id = parseIntSafe(req.params.id, null);
if (!id) {
return res.status(400).json({
ok: false,
error: "Invalid Sentinel position id",
});
}

const position = await db.get(
`SELECT * FROM cassie_sentinel_positions WHERE id = ?`,
[id]
);

if (!position) {
return res.status(404).json({
ok: false,
error: "Sentinel position not found",
});
}

const audit = await db.all(
`
SELECT *
FROM cassie_sentinel_audit_events
WHERE position_id = ?
ORDER BY created_at DESC, id DESC
LIMIT 200
`,
[id]
);

return res.json({
ok: true,
position: serializeSentinelPosition(position),
audit: audit.map(serializeSentinelAuditRow),
});
} catch (error) {
console.error("GET /api/compliance-admin/sentinel/positions/:id failed", error);
return res.status(500).json({
ok: false,
error: "Failed to load Sentinel position detail",
message: error?.message || String(error),
});
}
});

router.get("/sentinel/audit", async (req, res) => {
try {
const limit = Math.min(parseIntSafe(req.query.limit, 100) || 100, 500);
const filters = [];
const params = [];

const eventType = cleanText(req.query.event_type || "", 64).toLowerCase();
const decision = cleanText(req.query.decision || "", 64).toLowerCase();
const executionStatus = cleanText(req.query.execution_status || "", 32).toLowerCase();
const tokenId = cleanText(req.query.token_id || "", 255);
const positionId = parseIntSafe(req.query.position_id, null);

if (eventType) {
if (!SENTINEL_AUDIT_EVENT_TYPES.has(eventType)) {
return res.status(400).json({
ok: false,
error: "Invalid Sentinel audit event_type filter",
});
}
filters.push(`event_type = ?`);
params.push(eventType);
}

if (decision) {
filters.push(`decision = ?`);
params.push(decision);
}

if (executionStatus) {
filters.push(`execution_status = ?`);
params.push(executionStatus);
}

if (tokenId) {
filters.push(`token_id = ?`);
params.push(tokenId);
}

if (positionId) {
filters.push(`position_id = ?`);
params.push(positionId);
}

const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
const rows = await db.all(
`
SELECT *
FROM cassie_sentinel_audit_events
${whereSql}
ORDER BY created_at DESC, id DESC
LIMIT ?
`,
[...params, limit]
);

return res.json({
ok: true,
audit: rows.map(serializeSentinelAuditRow),
});
} catch (error) {
console.error("GET /api/compliance-admin/sentinel/audit failed", error);
return res.status(500).json({
ok: false,
error: "Failed to load Sentinel audit log",
message: error?.message || String(error),
});
}
});

router.get("/sentinel/stats/daily", async (req, res) => {
try {
const date = cleanText(req.query.date || todayUtcDate(), 32);
const mode = normalizeSentinelMode(req.query.mode || "paper", "paper");

const row = await db.get(
`
SELECT *
FROM cassie_sentinel_daily_stats
WHERE stat_date = ?
AND execution_mode = ?
`,
[date, mode]
);

return res.json({
ok: true,
stats: row
? {
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
created_at: row.created_at,
updated_at: row.updated_at,
}
: null,
});
} catch (error) {
console.error("GET /api/compliance-admin/sentinel/stats/daily failed", error);
return res.status(500).json({
ok: false,
error: "Failed to load Sentinel daily stats",
message: error?.message || String(error),
});
}
});

router.get("/sentinel/summary", async (req, res) => {
try {
const settings = await getSentinelSettingsRow();
const executionMode = settings?.execution_mode || "paper";
const statDate = todayUtcDate();

const openRow = await db.get(
`
SELECT COUNT(*) AS count
FROM cassie_sentinel_positions
WHERE stage IN ('scout_open','sniper_added','half_banked_at_10x','runner_only')
AND execution_mode = ?
`,
[executionMode]
);

const daily = await db.get(
`
SELECT *
FROM cassie_sentinel_daily_stats
WHERE stat_date = ?
AND execution_mode = ?
`,
[statDate, executionMode]
);

return res.json({
ok: true,
summary: {
watcher_enabled: Boolean(settings?.watcher_enabled),
execution_mode: executionMode,
kill_switch_active: executionMode === "emergency_stop",
open_positions: Number(openRow?.count ?? 0),
daily_realized_pnl_usd: Number(daily?.daily_realized_pnl_usd ?? 0),
daily_unrealized_pnl_usd: Number(daily?.daily_unrealized_pnl_usd ?? 0),
daily_loss_usd: Number(daily?.daily_loss_usd ?? 0),
consecutive_failures: Number(daily?.consecutive_failures ?? 0),
reclaim_success_rate_pct: Number(daily?.reclaim_success_rate_pct ?? 0),
recent_rug_rate_pct: Number(daily?.recent_rug_rate_pct ?? 0),
avg_market_liquidity_usd: Number(daily?.avg_market_liquidity_usd ?? 0),
stat_date: statDate,
},
});
} catch (error) {
console.error("GET /api/compliance-admin/sentinel/summary failed", error);
return res.status(500).json({
ok: false,
error: "Failed to load Sentinel summary",
message: error?.message || String(error),
});
}
});

export default router;
