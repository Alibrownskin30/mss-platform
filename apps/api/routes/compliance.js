import express from "express";
import db from "../db/index.js";

const router = express.Router();

const LAUNCHER_ACKNOWLEDGEMENT_TABLE = "launcher_acknowledgements";
const INTERNAL_PROFILE_TABLE = "compliance_profiles";

const PARTICIPANT_ROLE = "participant";
const BUILDER_ROLE = "builder";
const VALID_ROLES = new Set([PARTICIPANT_ROLE, BUILDER_ROLE]);

const ACKNOWLEDGEMENT_VERSIONS = Object.freeze({
terms: "launcher_terms_v1",
riskDisclosure: "launcher_risk_disclosure_v1",
launchRules: "launcher_rules_v1",
noAdvice: "launcher_no_investment_advice_v1",
projectDisclosure: "builder_project_disclosure_v1",
prohibitedConduct: "builder_prohibited_conduct_v1",
});

const tableExistsCache = new Map();
const tableColumnsCache = new Map();

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max);
}

function cleanWallet(value) {
return cleanText(value, 120);
}

function toTruthyBoolean(value) {
if (value === true || value === 1) return true;

const normalized = cleanText(value, 32).toLowerCase();

return ["true", "1", "yes", "y", "on", "accepted"].includes(
normalized
);
}

function normalizeStoredRole(value) {
const normalized = cleanText(value, 32).toLowerCase();
return VALID_ROLES.has(normalized) ? normalized : null;
}

function buildRequestError(message, code = "invalid_request", statusCode = 400) {
const error = new Error(message);
error.code = code;
error.statusCode = statusCode;
return error;
}

function resolveRequestRole(value, fallback = PARTICIPANT_ROLE) {
const raw = cleanText(value, 32).toLowerCase();

if (!raw) {
return fallback;
}

if (!VALID_ROLES.has(raw)) {
throw buildRequestError(
"role must be participant or builder",
"invalid_acknowledgement_role",
400
);
}

return raw;
}

function resolveLaunchIdInput(value) {
if (value === undefined || value === null || String(value).trim() === "") {
return null;
}

const launchId = Number.parseInt(value, 10);

if (!Number.isFinite(launchId) || launchId <= 0) {
throw buildRequestError(
"launchId must be valid when supplied",
"invalid_launch_id",
400
);
}

return launchId;
}

async function tableExists(tableName) {
const key = cleanText(tableName, 120);

if (!key) return false;

if (tableExistsCache.has(key)) {
return tableExistsCache.get(key);
}

const row = await db.get(
`
SELECT name
FROM sqlite_master
WHERE type = 'table'
AND name = ?
LIMIT 1
`,
[key]
);

const exists = Boolean(row?.name);
tableExistsCache.set(key, exists);

return exists;
}

async function getTableColumns(tableName) {
const key = cleanText(tableName, 120);

if (!key) return new Set();

if (tableColumnsCache.has(key)) {
return tableColumnsCache.get(key);
}

if (!(await tableExists(key))) {
const empty = new Set();
tableColumnsCache.set(key, empty);
return empty;
}

const rows = await db.all(`PRAGMA table_info(${key})`);
const columns = new Set(
(rows || []).map((row) => cleanText(row?.name, 120)).filter(Boolean)
);

tableColumnsCache.set(key, columns);

return columns;
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

function getAcknowledgementRequirements(role) {
const common = [
{
key: "terms_accepted",
label: "Launcher Terms",
version: ACKNOWLEDGEMENT_VERSIONS.terms,
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
label: "Risk Disclosure",
version: ACKNOWLEDGEMENT_VERSIONS.riskDisclosure,
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
label: "Launch Rules",
version: ACKNOWLEDGEMENT_VERSIONS.launchRules,
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
label: "Information Only / No Investment Advice",
version: ACKNOWLEDGEMENT_VERSIONS.noAdvice,
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

if (role !== BUILDER_ROLE) {
return common;
}

return [
...common,
{
key: "project_disclosure_accepted",
label: "Project Information Accuracy Disclosure",
version: ACKNOWLEDGEMENT_VERSIONS.projectDisclosure,
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
label: "Prohibited Conduct Acknowledgement",
version: ACKNOWLEDGEMENT_VERSIONS.prohibitedConduct,
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

function hasAcknowledgementInput(body = {}, role = PARTICIPANT_ROLE) {
const payload = getAcknowledgementPayload(body);
const requirements = getAcknowledgementRequirements(role);

return requirements.some((requirement) =>
requirement.aliases.some((alias) =>
Object.prototype.hasOwnProperty.call(payload, alias)
)
);
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

function buildAcknowledgementError({
role = PARTICIPANT_ROLE,
message = "",
missing = [],
statusCode = 428,
code = "launcher_acknowledgements_required",
} = {}) {
const normalizedRole = VALID_ROLES.has(role) ? role : PARTICIPANT_ROLE;

const error = new Error(
message ||
`Accept the required ${normalizedRole} launcher acknowledgements before continuing.`
);

error.statusCode = statusCode;
error.code = code;
error.role = normalizedRole;
error.missingAcknowledgements = missing;
error.requiredAcknowledgements = getAcknowledgementRequirements(
normalizedRole
).map((item) => item.key);

return error;
}

function validateAcknowledgements(body = {}, role = PARTICIPANT_ROLE) {
const normalizedRole = VALID_ROLES.has(role) ? role : PARTICIPANT_ROLE;
const payload = getAcknowledgementPayload(body);
const requirements = getAcknowledgementRequirements(normalizedRole);

const accepted = {};
const missing = [];

for (const requirement of requirements) {
const value = readAcknowledgementFlag(payload, requirement.aliases);

accepted[requirement.key] = value;

if (!value) {
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
accepted,
terms_version: ACKNOWLEDGEMENT_VERSIONS.terms,
risk_disclosure_version: ACKNOWLEDGEMENT_VERSIONS.riskDisclosure,
launch_rules_version: ACKNOWLEDGEMENT_VERSIONS.launchRules,
no_advice_version: ACKNOWLEDGEMENT_VERSIONS.noAdvice,
project_disclosure_version:
normalizedRole === BUILDER_ROLE
? ACKNOWLEDGEMENT_VERSIONS.projectDisclosure
: null,
prohibited_conduct_version:
normalizedRole === BUILDER_ROLE
? ACKNOWLEDGEMENT_VERSIONS.prohibitedConduct
: null,
};
}

function serializeAcknowledgement(row) {
if (!row) return null;

return {
id: Number(row.id || 0),
launch_id: row.launch_id == null ? null : Number(row.launch_id),
wallet: cleanWallet(row.wallet) || null,
role: normalizeStoredRole(row.role),
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

function isAcknowledgementAccepted(acknowledgement, role) {
if (!acknowledgement) return false;
if (acknowledgement.role !== role) return false;
if (acknowledgement.status !== "accepted") return false;

const commonAccepted = Boolean(
acknowledgement.accepted_terms_at &&
acknowledgement.accepted_risk_disclosure_at &&
acknowledgement.accepted_launch_rules_at &&
acknowledgement.accepted_no_advice_at
);

if (!commonAccepted) {
return false;
}

if (role === BUILDER_ROLE) {
return Boolean(
acknowledgement.accepted_project_disclosure_at &&
acknowledgement.accepted_prohibited_conduct_at
);
}

return true;
}

async function ensureAcknowledgementStorageAvailable() {
if (!(await tableExists(LAUNCHER_ACKNOWLEDGEMENT_TABLE))) {
throw buildAcknowledgementError({
message:
"Launcher acknowledgement storage is not configured. Apply migration 034 before using the launcher flow.",
statusCode: 503,
code: "launcher_acknowledgements_not_configured",
});
}
}

async function findAcknowledgement({
wallet,
role = PARTICIPANT_ROLE,
launchId = null,
} = {}) {
if (!(await tableExists(LAUNCHER_ACKNOWLEDGEMENT_TABLE))) {
return null;
}

const normalizedWallet = cleanWallet(wallet);

if (!normalizedWallet || !VALID_ROLES.has(role)) return null;

let row = null;

if (launchId == null) {
row = await db.get(
`
SELECT *
FROM ${LAUNCHER_ACKNOWLEDGEMENT_TABLE}
WHERE LOWER(wallet) = LOWER(?)
AND role = ?
AND launch_id IS NULL
ORDER BY id DESC
LIMIT 1
`,
[normalizedWallet, role]
);
} else {
row = await db.get(
`
SELECT *
FROM ${LAUNCHER_ACKNOWLEDGEMENT_TABLE}
WHERE LOWER(wallet) = LOWER(?)
AND role = ?
AND launch_id = ?
ORDER BY id DESC
LIMIT 1
`,
[normalizedWallet, role, launchId]
);
}

return serializeAcknowledgement(row);
}

async function saveAcknowledgement({
wallet,
role = PARTICIPANT_ROLE,
launchId = null,
body = {},
action = "acknowledge",
signatureReference = "",
signatureMessage = "",
} = {}) {
await ensureAcknowledgementStorageAvailable();

const normalizedWallet = cleanWallet(wallet);

if (!normalizedWallet) {
throw buildAcknowledgementError({
role,
message: "wallet is required",
statusCode: 400,
code: "wallet_required",
});
}

if (!VALID_ROLES.has(role)) {
throw buildRequestError(
"role must be participant or builder",
"invalid_acknowledgement_role",
400
);
}

const submission = validateAcknowledgements(body, role);
const columns = await getTableColumns(LAUNCHER_ACKNOWLEDGEMENT_TABLE);

if (!columns.size) {
throw buildAcknowledgementError({
role,
message: "Unable to inspect launcher acknowledgement storage.",
statusCode: 503,
code: "launcher_acknowledgements_not_configured",
});
}

const existing = await findAcknowledgement({
wallet: normalizedWallet,
role,
launchId,
});

const acceptedAt = new Date().toISOString();

const userWritableValues = {
action: cleanText(action, 80) || "acknowledge",
terms_version: submission.terms_version,
risk_disclosure_version: submission.risk_disclosure_version,
launch_rules_version: submission.launch_rules_version,
no_advice_version: submission.no_advice_version,
project_disclosure_version: submission.project_disclosure_version,
prohibited_conduct_version: submission.prohibited_conduct_version,
accepted_terms_at: acceptedAt,
accepted_risk_disclosure_at: acceptedAt,
accepted_launch_rules_at: acceptedAt,
accepted_no_advice_at: acceptedAt,
accepted_project_disclosure_at:
role === BUILDER_ROLE ? acceptedAt : null,
accepted_prohibited_conduct_at:
role === BUILDER_ROLE ? acceptedAt : null,
signature_reference: cleanText(signatureReference, 160) || null,
signature_message: cleanText(signatureMessage, 255) || null,
};

if (existing?.id) {
const assignments = [];
const values = [];

for (const [column, value] of Object.entries(userWritableValues)) {
if (!columns.has(column)) continue;
assignments.push(`${column} = ?`);
values.push(value);
}

if (columns.has("updated_at")) {
assignments.push("updated_at = CURRENT_TIMESTAMP");
}

if (assignments.length) {
await db.run(
`
UPDATE ${LAUNCHER_ACKNOWLEDGEMENT_TABLE}
SET ${assignments.join(", ")}
WHERE id = ?
`,
[...values, existing.id]
);
}

return findAcknowledgement({
wallet: normalizedWallet,
role,
launchId,
});
}

const insertValuesByColumn = {
launch_id: launchId,
wallet: normalizedWallet,
role,
...userWritableValues,
status: "accepted",
escalation_flag: 0,
escalation_reason: null,
};

const insertColumns = [];
const placeholders = [];
const values = [];

for (const [column, value] of Object.entries(insertValuesByColumn)) {
if (!columns.has(column)) continue;

insertColumns.push(column);
placeholders.push("?");
values.push(value);
}

if (columns.has("created_at")) {
insertColumns.push("created_at");
placeholders.push("CURRENT_TIMESTAMP");
}

if (columns.has("updated_at")) {
insertColumns.push("updated_at");
placeholders.push("CURRENT_TIMESTAMP");
}

const insert = await db.run(
`
INSERT INTO ${LAUNCHER_ACKNOWLEDGEMENT_TABLE} (
${insertColumns.join(", ")}
) VALUES (
${placeholders.join(", ")}
)
`,
values
);

const insertedRow = await db.get(
`
SELECT *
FROM ${LAUNCHER_ACKNOWLEDGEMENT_TABLE}
WHERE id = ?
LIMIT 1
`,
[insert.lastID]
);

return serializeAcknowledgement(insertedRow);
}

async function getInternalWalletIntervention(wallet) {
const normalizedWallet = cleanWallet(wallet);

if (!normalizedWallet || !(await tableExists(INTERNAL_PROFILE_TABLE))) {
return {
blocked: false,
reason_code: null,
};
}

const columns = await getTableColumns(INTERNAL_PROFILE_TABLE);

if (!columns.has("wallet_address")) {
return {
blocked: false,
reason_code: null,
};
}

const statusSelect = columns.has("status")
? "status"
: "NULL AS status";
const riskRatingSelect = columns.has("risk_rating")
? "risk_rating"
: "NULL AS risk_rating";
const sanctionsSelect = columns.has("sanctions_status")
? "sanctions_status"
: "0 AS sanctions_status";
const manualReviewSelect = columns.has("manual_review_required")
? "manual_review_required"
: "0 AS manual_review_required";

const row = await db.get(
`
SELECT
${statusSelect},
${riskRatingSelect},
${sanctionsSelect},
${manualReviewSelect}
FROM ${INTERNAL_PROFILE_TABLE}
WHERE LOWER(wallet_address) = LOWER(?)
LIMIT 1
`,
[normalizedWallet]
);

if (!row) {
return {
blocked: false,
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
blocked: Boolean(reasonCode),
reason_code: reasonCode,
};
}

function buildPublicStatusPayload({
wallet,
role,
launchId = null,
acknowledgement = null,
intervention = null,
storageConfigured = false,
} = {}) {
const ackAccepted = isAcknowledgementAccepted(acknowledgement, role);
const blocked = Boolean(intervention?.blocked);
const transactionalAccess = !blocked && ackAccepted;

let accessState = "acknowledgement_required";
let accessReason =
"No identity verification is required. Accept the launcher terms and risk acknowledgements when you proceed.";

if (blocked) {
accessState = "blocked";
accessReason =
"This wallet is currently unable to use Launcher transactions. Contact support if you believe this is an error.";
} else if (ackAccepted) {
accessState = "acknowledged";
accessReason =
"Required launcher acknowledgements have been recorded. No identity verification is required for this flow.";
}

return {
ok: true,
wallet: wallet || null,
mode: role,
role,
launch_id: launchId,

compliance_model: "acknowledgement_only",
model: "acknowledgement_only",

identity_verification_required: false,
kyc_required: false,
kyb_required: false,
full_name_required: false,
legal_name_required: false,
date_of_birth_required: false,
country_required: false,
source_of_funds_required: false,
source_of_wealth_required: false,
document_upload_required: false,

approval_required: false,
requires_builder_approval: false,
requires_participant_approval: false,
builder_gate_enabled: false,
participant_gate_enabled: false,

acknowledgement_storage_configured: storageConfigured,
acknowledgement_required: true,
acknowledgement_accepted: ackAccepted,
acknowledgement,
required_acknowledgements: getAcknowledgementRequirements(role).map(
(item) => ({
key: item.key,
label: item.label,
version: item.version,
})
),
acknowledgement_versions: ACKNOWLEDGEMENT_VERSIONS,

internal_intervention_active: blocked,

access_state: accessState,
access_reason: accessReason,
transactional_access: transactionalAccess,
allowed: transactionalAccess,

silent_monitoring: true,
escalation_monitoring: true,
escalation_required: blocked,
blocking_signals: blocked
? [
{
code: "wallet_intervention_active",
severity: "high",
source: "internal_monitoring",
blocking: true,
escalates: true,
message:
"This wallet is currently unable to use Launcher transactions.",
},
]
: [],
escalation_signals: [],

profile: null,
profile_present: false,
beneficial_owners: [],
authorised_representatives: [],
status: blocked ? "restricted" : ackAccepted ? "approved" : "not_started",
status_meaning: "launcher_acknowledgement_state_not_identity_verification",
};
}

async function buildStatusForRequest({
wallet,
role,
launchId = null,
} = {}) {
const storageConfigured = await tableExists(
LAUNCHER_ACKNOWLEDGEMENT_TABLE
);

const [acknowledgement, intervention] = await Promise.all([
findAcknowledgement({
wallet,
role,
launchId,
}),
getInternalWalletIntervention(wallet),
]);

return buildPublicStatusPayload({
wallet,
role,
launchId,
acknowledgement,
intervention,
storageConfigured,
});
}

function maybeSendPublicRequestError(res, error) {
if (!error?.code) return false;

if (
[
"invalid_acknowledgement_role",
"invalid_launch_id",
"wallet_required",
"launcher_acknowledgements_required",
"launcher_acknowledgements_not_configured",
].includes(error.code)
) {
res.status(Number(error.statusCode) || 400).json({
ok: false,
error: error.message || "Launcher acknowledgement request failed.",
code: error.code,
role: error.role || null,
required_acknowledgements: error.requiredAcknowledgements || [],
missing_acknowledgements: error.missingAcknowledgements || [],
acknowledgement_versions: ACKNOWLEDGEMENT_VERSIONS,
compliance_model: "acknowledgement_only",
identity_verification_required: false,
});

return true;
}

return false;
}

router.get("/status", async (req, res) => {
try {
const wallet = cleanWallet(req.query.wallet);
const role = resolveRequestRole(
req.query.role || req.query.mode || req.query.context || PARTICIPANT_ROLE
);
const launchId = resolveLaunchIdInput(
req.query.launchId ?? req.query.launch_id ?? null
);

if (!wallet) {
return res.status(400).json({
ok: false,
error: "wallet is required",
compliance_model: "acknowledgement_only",
identity_verification_required: false,
});
}

const payload = await buildStatusForRequest({
wallet,
role,
launchId,
});

return res.json(payload);
} catch (error) {
if (maybeSendPublicRequestError(res, error)) {
return;
}

console.error("GET /api/compliance/status failed", error);

return res.status(500).json({
ok: false,
error: "Failed to fetch launcher acknowledgement status",
message: error?.message || String(error),
compliance_model: "acknowledgement_only",
identity_verification_required: false,
});
}
});

router.post("/start", async (req, res) => {
try {
const wallet = cleanWallet(req.body?.wallet);
const role = resolveRequestRole(
req.body?.role || req.body?.mode || req.body?.context || PARTICIPANT_ROLE
);
const launchId = resolveLaunchIdInput(
req.body?.launchId ?? req.body?.launch_id ?? null
);

if (!wallet) {
return res.status(400).json({
ok: false,
error: "wallet is required",
});
}

let acknowledgement = await findAcknowledgement({
wallet,
role,
launchId,
});

if (hasAcknowledgementInput(req.body, role)) {
acknowledgement = await saveAcknowledgement({
wallet,
role,
launchId,
body: req.body,
action: "acknowledgement_start",
});
}

const intervention = await getInternalWalletIntervention(wallet);

return res.json(
buildPublicStatusPayload({
wallet,
role,
launchId,
acknowledgement,
intervention,
storageConfigured: await tableExists(
LAUNCHER_ACKNOWLEDGEMENT_TABLE
),
})
);
} catch (error) {
if (maybeSendPublicRequestError(res, error)) {
return;
}

console.error("POST /api/compliance/start failed", error);

return res.status(500).json({
ok: false,
error: "Failed to initialise launcher acknowledgement flow",
message: error?.message || String(error),
});
}
});

router.post("/submit", async (req, res) => {
try {
const wallet = cleanWallet(req.body?.wallet);
const role = resolveRequestRole(
req.body?.role || req.body?.mode || req.body?.context || PARTICIPANT_ROLE
);
const launchId = resolveLaunchIdInput(
req.body?.launchId ?? req.body?.launch_id ?? null
);

if (!wallet) {
return res.status(400).json({
ok: false,
error: "wallet is required",
});
}

const acknowledgement = await saveAcknowledgement({
wallet,
role,
launchId,
body: req.body,
action: cleanText(req.body?.action, 80) || "acknowledgement_submit",
signatureReference:
cleanText(
req.body?.signature_reference ??
req.body?.signatureReference ??
req.body?.txSignature,
160
) || "",
signatureMessage:
cleanText(
req.body?.signature_message ?? req.body?.signatureMessage,
255
) || "",
});

const intervention = await getInternalWalletIntervention(wallet);

return res.json(
buildPublicStatusPayload({
wallet,
role,
launchId,
acknowledgement,
intervention,
storageConfigured: true,
})
);
} catch (error) {
if (maybeSendPublicRequestError(res, error)) {
return;
}

console.error("POST /api/compliance/submit failed", error);

return res.status(500).json({
ok: false,
error: "Failed to save launcher acknowledgements",
message: error?.message || String(error),
});
}
});

router.get("/acknowledgements/status", async (req, res) => {
try {
const wallet = cleanWallet(req.query.wallet);
const role = resolveRequestRole(
req.query.role || req.query.mode || PARTICIPANT_ROLE
);
const launchId = resolveLaunchIdInput(
req.query.launchId ?? req.query.launch_id ?? null
);

if (!wallet) {
return res.status(400).json({
ok: false,
error: "wallet is required",
});
}

const payload = await buildStatusForRequest({
wallet,
role,
launchId,
});

return res.json(payload);
} catch (error) {
if (maybeSendPublicRequestError(res, error)) {
return;
}

console.error(
"GET /api/compliance/acknowledgements/status failed",
error
);

return res.status(500).json({
ok: false,
error: "Failed to fetch acknowledgement status",
message: error?.message || String(error),
});
}
});

router.post("/acknowledgements", async (req, res) => {
try {
const wallet = cleanWallet(req.body?.wallet);
const role = resolveRequestRole(
req.body?.role || req.body?.mode || PARTICIPANT_ROLE
);
const launchId = resolveLaunchIdInput(
req.body?.launchId ?? req.body?.launch_id ?? null
);

if (!wallet) {
return res.status(400).json({
ok: false,
error: "wallet is required",
});
}

const acknowledgement = await saveAcknowledgement({
wallet,
role,
launchId,
body: req.body,
action: cleanText(req.body?.action, 80) || "acknowledge",
signatureReference:
cleanText(
req.body?.signature_reference ??
req.body?.signatureReference ??
req.body?.txSignature,
160
) || "",
signatureMessage:
cleanText(
req.body?.signature_message ?? req.body?.signatureMessage,
255
) || "",
});

const intervention = await getInternalWalletIntervention(wallet);

return res.json(
buildPublicStatusPayload({
wallet,
role,
launchId,
acknowledgement,
intervention,
storageConfigured: true,
})
);
} catch (error) {
if (maybeSendPublicRequestError(res, error)) {
return;
}

console.error("POST /api/compliance/acknowledgements failed", error);

return res.status(500).json({
ok: false,
error: "Failed to save acknowledgement",
message: error?.message || String(error),
});
}
});

export default router;
