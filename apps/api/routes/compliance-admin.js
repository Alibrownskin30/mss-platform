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

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max);
}

function parseIntSafe(value, fallback = null) {
const num = Number.parseInt(value, 10);
return Number.isFinite(num) ? num : fallback;
}

function normalizeStatus(value, fallback = "open") {
const normalized = cleanText(value, 32).toLowerCase();
return CASE_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizeRiskLevel(value, fallback = "low") {
const normalized = cleanText(value, 32).toLowerCase();
return RISK_LEVELS.has(normalized) ? normalized : fallback;
}

function parseJson(value, fallback = null) {
if (!value) return fallback;
try {
return JSON.parse(value);
} catch {
return fallback;
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
);
}

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

const caseType = cleanText(req.query.case_type || req.query.caseType, 32).toLowerCase();
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

export default router;
