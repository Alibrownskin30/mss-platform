import express from "express";
import db from "../db/index.js";
import featureFlags from "../services/compliance/featureFlags.js";
import auditLog from "../services/compliance/auditLog.js";

const router = express.Router();

const PROFILE_TYPES = new Set(["individual", "entity"]);
const PROFILE_STATUSES = new Set([
"not_started",
"pending",
"approved",
"rejected",
"restricted",
]);
const RISK_RATINGS = new Set(["low", "medium", "high", "critical"]);

const {
COMPLIANCE_BUCKETS = {
REQUIRED: "required",
SILENT: "silent",
ESCALATION: "escalation",
},
} = featureFlags;

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max);
}

function cleanWallet(value) {
return cleanText(value, 120);
}

function toBool(value) {
if (
value === true ||
value === 1 ||
value === "1" ||
String(value ?? "").trim().toLowerCase() === "true"
) {
return 1;
}
return 0;
}

function parseJson(value, fallback = null) {
if (!value) return fallback;
try {
return JSON.parse(value);
} catch {
return fallback;
}
}

function normalizeProfileType(value, fallback = "individual") {
const normalized = cleanText(value, 32).toLowerCase();
return PROFILE_TYPES.has(normalized) ? normalized : fallback;
}

function normalizeStatus(value, fallback = "not_started") {
const normalized = cleanText(value, 32).toLowerCase();
return PROFILE_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizeRiskRating(value, fallback = "low") {
const normalized = cleanText(value, 32).toLowerCase();
return RISK_RATINGS.has(normalized) ? normalized : fallback;
}

function normalizeMode(value, fallback = "participant") {
const normalized = cleanText(value, 32).toLowerCase();
if (normalized === "builder") return "builder";
if (normalized === "participant") return "participant";
return fallback;
}

function normalizeBucket(value, fallback = COMPLIANCE_BUCKETS.SILENT) {
const normalized = cleanText(value, 32).toLowerCase();
if (normalized === COMPLIANCE_BUCKETS.REQUIRED) return COMPLIANCE_BUCKETS.REQUIRED;
if (normalized === COMPLIANCE_BUCKETS.SILENT) return COMPLIANCE_BUCKETS.SILENT;
if (normalized === COMPLIANCE_BUCKETS.ESCALATION) return COMPLIANCE_BUCKETS.ESCALATION;
return fallback;
}

function buildModeFlags(config = featureFlags.getComplianceConfig()) {
return {
compliance_mode: config?.mode || null,
compliance_bucket: config?.bucket || null,

builder_bucket: config?.builder?.bucket || null,
participant_bucket: config?.participant?.bucket || null,
jurisdiction_bucket: config?.jurisdiction?.bucket || null,
manual_review_bucket: config?.manualReview?.bucket || null,

builder_gate_enabled: Boolean(config?.builder?.gateEnabled),
participant_gate_enabled: Boolean(config?.participant?.gateEnabled),
manual_review_enabled: Boolean(config?.manualReview?.enabled),
jurisdiction_blocking_enabled: Boolean(config?.jurisdiction?.blockingEnabled),

builder_silent_screening_enabled: Boolean(config?.builder?.silentScreeningEnabled),
participant_silent_screening_enabled: Boolean(config?.participant?.silentScreeningEnabled),
builder_escalation_enabled: Boolean(config?.builder?.escalationEnabled),
participant_escalation_enabled: Boolean(config?.participant?.escalationEnabled),
jurisdiction_escalation_enabled: Boolean(config?.jurisdiction?.escalationEnabled),
};
}

function resolveModeConfig(config, normalizedMode) {
if (normalizedMode === "builder") {
return config?.builder || {};
}
return config?.participant || {};
}

function pushSignal(list, code, severity, message, options = {}) {
list.push({
code,
severity,
source: options.source || "system",
blocking: Boolean(options.blocking),
escalates: Boolean(options.escalates),
message,
});
}

function getAccessReason({
normalizedMode,
requiresApproval,
effectiveStatus,
hasBlockingSignals,
firstBlockingSignal,
hasEscalationSignals,
escalationSignals,
modeBucket,
}) {
const actorLabel = normalizedMode === "builder" ? "Builder" : "Participant";

if (hasBlockingSignals && firstBlockingSignal?.message) {
return firstBlockingSignal.message;
}

if (requiresApproval && effectiveStatus !== "approved") {
if (effectiveStatus === "pending") {
return `${actorLabel} approval is still pending before transactional access opens.`;
}
return `${actorLabel} approval is required before transactional access opens.`;
}

if (hasEscalationSignals && escalationSignals.length) {
return escalationSignals[0].message;
}

if (modeBucket === COMPLIANCE_BUCKETS.SILENT) {
return "Silent monitoring is active. Access remains open unless explicit risk intervention is triggered.";
}

if (modeBucket === COMPLIANCE_BUCKETS.ESCALATION) {
return "Escalation-only monitoring is active. Access remains open until triggered risk conditions require intervention.";
}

return "Compliance checks are clear for the current bucket configuration.";
}

function buildStatusPayload(profile = null, wallet = "", mode = "participant") {
const config = featureFlags.getComplianceConfig();
const normalizedMode = normalizeMode(mode, "participant");
const modeConfig = resolveModeConfig(config, normalizedMode);

const modeBucket = normalizeBucket(
modeConfig?.bucket || config?.bucket,
COMPLIANCE_BUCKETS.SILENT
);
const jurisdictionBucket = normalizeBucket(
config?.jurisdiction?.bucket,
COMPLIANCE_BUCKETS.ESCALATION
);
const manualReviewBucket = normalizeBucket(
config?.manualReview?.bucket,
COMPLIANCE_BUCKETS.ESCALATION
);

const effectiveStatus = normalizeStatus(profile?.status || "not_started");
const riskRating = normalizeRiskRating(profile?.risk_rating || "low");
const manualReviewRequired = Boolean(profile?.manual_review_required);
const sanctionsStatus = Boolean(profile?.sanctions_status);
const pepStatus = Boolean(profile?.pep_status);

const restrictedJurisdictions = Array.isArray(config?.jurisdiction?.restrictedJurisdictions)
? config.jurisdiction.restrictedJurisdictions
: [];
const highRiskJurisdictions = Array.isArray(config?.jurisdiction?.highRiskJurisdictions)
? config.jurisdiction.highRiskJurisdictions
: [];

const countryCode = cleanText(profile?.country_code, 8).toUpperCase();
const isRestrictedJurisdiction = Boolean(
countryCode && restrictedJurisdictions.includes(countryCode)
);
const isHighRiskJurisdiction = Boolean(
countryCode && highRiskJurisdictions.includes(countryCode)
);

const approvalRequired = modeBucket === COMPLIANCE_BUCKETS.REQUIRED;
const silentMonitoring = Boolean(modeConfig?.silentScreeningEnabled);
const escalationEnabled = Boolean(modeConfig?.escalationEnabled);

const statusRejectedOrRestricted =
effectiveStatus === "rejected" || effectiveStatus === "restricted";

const escalationSignals = [];

if (statusRejectedOrRestricted) {
pushSignal(
escalationSignals,
"profile_status_block",
"critical",
`Compliance profile is ${effectiveStatus}. Transactional access is blocked.`,
{
source: "profile",
blocking: true,
escalates: true,
}
);
}

if (sanctionsStatus) {
pushSignal(
escalationSignals,
"sanctions_match",
"critical",
"Sanctions screening is flagged on this profile. Transactional access is blocked.",
{
source: "screening",
blocking: true,
escalates: true,
}
);
}

if (manualReviewRequired) {
if (manualReviewBucket === COMPLIANCE_BUCKETS.REQUIRED) {
pushSignal(
escalationSignals,
"manual_review_required",
"high",
"Manual review is required before transactional access can open.",
{
source: "manual_review",
blocking: true,
escalates: true,
}
);
} else if (manualReviewBucket === COMPLIANCE_BUCKETS.ESCALATION) {
pushSignal(
escalationSignals,
"manual_review_required",
"high",
"Manual review has been triggered and needs intervention before transactional access can continue.",
{
source: "manual_review",
blocking: true,
escalates: true,
}
);
} else {
pushSignal(
escalationSignals,
"manual_review_required",
"medium",
"Manual review is flagged on this profile but is currently being monitored silently.",
{
source: "manual_review",
blocking: false,
escalates: false,
}
);
}
}

if (isRestrictedJurisdiction) {
if (jurisdictionBucket === COMPLIANCE_BUCKETS.REQUIRED) {
pushSignal(
escalationSignals,
"restricted_jurisdiction",
"critical",
`Restricted jurisdiction detected (${countryCode}). Transactional access is blocked.`,
{
source: "jurisdiction",
blocking: true,
escalates: true,
}
);
} else if (jurisdictionBucket === COMPLIANCE_BUCKETS.ESCALATION) {
pushSignal(
escalationSignals,
"restricted_jurisdiction",
"high",
`Restricted jurisdiction detected (${countryCode}). Escalation is required before access can continue.`,
{
source: "jurisdiction",
blocking: true,
escalates: true,
}
);
} else {
pushSignal(
escalationSignals,
"restricted_jurisdiction",
"medium",
`Restricted jurisdiction detected (${countryCode}) and is currently being monitored silently.`,
{
source: "jurisdiction",
blocking: false,
escalates: false,
}
);
}
}

if (isHighRiskJurisdiction) {
if (jurisdictionBucket === COMPLIANCE_BUCKETS.ESCALATION) {
pushSignal(
escalationSignals,
"high_risk_jurisdiction",
"medium",
`High-risk jurisdiction detected (${countryCode}). Review is recommended.`,
{
source: "jurisdiction",
blocking: false,
escalates: true,
}
);
} else {
pushSignal(
escalationSignals,
"high_risk_jurisdiction",
"medium",
`High-risk jurisdiction detected (${countryCode}).`,
{
source: "jurisdiction",
blocking: false,
escalates: false,
}
);
}
}

if (pepStatus) {
pushSignal(
escalationSignals,
"pep_flag",
"medium",
"PEP screening is flagged on this profile.",
{
source: "screening",
blocking: false,
escalates: modeBucket === COMPLIANCE_BUCKETS.ESCALATION,
}
);
}

if (riskRating === "critical") {
pushSignal(
escalationSignals,
"critical_risk_rating",
"critical",
"Critical compliance risk rating detected. Intervention is required before transactional access can continue.",
{
source: "risk",
blocking: true,
escalates: true,
}
);
} else if (riskRating === "high") {
pushSignal(
escalationSignals,
"high_risk_rating",
"high",
"High compliance risk rating detected.",
{
source: "risk",
blocking: false,
escalates: modeBucket === COMPLIANCE_BUCKETS.ESCALATION || escalationEnabled,
}
);
}

const blockingSignals = escalationSignals.filter((signal) => signal.blocking);
const firstBlockingSignal = blockingSignals[0] || null;

const escalatedSignals = escalationSignals.filter((signal) => signal.escalates);
const hasEscalationSignals = escalatedSignals.length > 0;
const hasBlockingSignals = blockingSignals.length > 0;

const profilePresent = Boolean(profile?.id);
const approved = effectiveStatus === "approved";
const pending = effectiveStatus === "pending";
const notStarted = effectiveStatus === "not_started";

const requiredApprovalOutstanding =
approvalRequired && (!profilePresent || !approved);

let accessState = "open";
let transactionalAccess = true;

if (hasBlockingSignals) {
accessState = "blocked";
transactionalAccess = false;
} else if (requiredApprovalOutstanding) {
accessState = pending ? "pending" : "required";
transactionalAccess = false;
} else if (hasEscalationSignals) {
accessState = "watch";
transactionalAccess = true;
} else if (modeBucket === COMPLIANCE_BUCKETS.SILENT) {
accessState = "silent";
transactionalAccess = true;
} else if (modeBucket === COMPLIANCE_BUCKETS.ESCALATION) {
accessState = "watch";
transactionalAccess = true;
}

const accessReason = getAccessReason({
normalizedMode,
requiresApproval: approvalRequired,
effectiveStatus,
hasBlockingSignals,
firstBlockingSignal,
hasEscalationSignals,
escalationSignals: escalatedSignals,
modeBucket,
});

return {
ok: true,
wallet: wallet || null,
mode: normalizedMode,

profile: profile
? {
id: profile.id,
wallet_address: profile.wallet_address,
profile_type: profile.profile_type,
status: effectiveStatus,
risk_rating: riskRating,
legal_name: profile.legal_name,
display_name: profile.display_name,
entity_name: profile.entity_name,
entity_type: profile.entity_type,
email: profile.email,
phone: profile.phone,
country_code: countryCode || null,
pep_status: pepStatus,
sanctions_status: sanctionsStatus,
source_of_funds_summary: profile.source_of_funds_summary || null,
source_of_wealth_summary: profile.source_of_wealth_summary || null,
verification_started_at: profile.verification_started_at || null,
verification_completed_at: profile.verification_completed_at || null,
manual_review_required: manualReviewRequired,
manual_review_reason: profile.manual_review_reason || null,
notes: profile.notes || null,
metadata: parseJson(profile.metadata_json, null),
created_at: profile.created_at || null,
updated_at: profile.updated_at || null,
}
: null,

profile_present: profilePresent,
approved,
pending,
not_started: notStarted,
status: effectiveStatus,
risk_rating: riskRating,

access_state: accessState,
access_reason: accessReason,
transactional_access: transactionalAccess,

approval_required: approvalRequired,
silent_monitoring: silentMonitoring,
escalation_monitoring: escalationEnabled,

escalation_required: hasEscalationSignals,
escalation_signals: escalatedSignals,
blocking_signals: blockingSignals,

manual_review_required: manualReviewRequired,
restricted_jurisdiction: isRestrictedJurisdiction,
high_risk_jurisdiction: isHighRiskJurisdiction,
sanctions_status: sanctionsStatus,
pep_status: pepStatus,

requires_builder_approval:
normalizedMode === "builder" ? Boolean(config?.builder?.gateEnabled) : false,
requires_participant_approval:
normalizedMode === "participant" ? Boolean(config?.participant?.gateEnabled) : false,

high_risk_jurisdictions: highRiskJurisdictions,
restricted_jurisdictions: restrictedJurisdictions,

...buildModeFlags(config),
};
}

async function getProfileByWallet(walletAddress) {
if (!walletAddress) return null;

return db.get(
`
SELECT
id,
wallet_address,
profile_type,
status,
risk_rating,
legal_name,
display_name,
entity_name,
entity_type,
entity_registration_number,
email,
phone,
country_code,
date_of_birth,
pep_status,
sanctions_status,
source_of_funds_summary,
source_of_wealth_summary,
verification_started_at,
verification_completed_at,
manual_review_required,
manual_review_reason,
kyc_provider_ref,
kyb_provider_ref,
notes,
metadata_json,
created_at,
updated_at
FROM compliance_profiles
WHERE wallet_address = ?
LIMIT 1
`,
[walletAddress]
);
}

async function getBeneficialOwners(profileId) {
if (!profileId) return [];

return db.all(
`
SELECT
id,
full_name,
country_code,
date_of_birth,
ownership_pct,
control_basis,
pep_status,
sanctions_status,
verified_at,
notes,
created_at,
updated_at
FROM beneficial_owners
WHERE compliance_profile_id = ?
ORDER BY id ASC
`,
[profileId]
);
}

async function getAuthorisedRepresentatives(profileId) {
if (!profileId) return [];

return db.all(
`
SELECT
id,
full_name,
role_title,
authority_type,
authority_doc_ref,
email,
phone,
country_code,
verified_at,
notes,
created_at,
updated_at
FROM authorised_representatives
WHERE compliance_profile_id = ?
ORDER BY id ASC
`,
[profileId]
);
}

async function upsertProfile({
walletAddress,
profileType,
legalName,
displayName,
entityName,
entityType,
entityRegistrationNumber,
email,
phone,
countryCode,
dateOfBirth,
pepStatus,
sanctionsStatus,
sourceOfFundsSummary,
sourceOfWealthSummary,
status,
riskRating,
manualReviewRequired,
manualReviewReason,
notes,
metadata,
setVerificationStartedAt = false,
setVerificationCompletedAt = false,
}) {
const existing = await getProfileByWallet(walletAddress);
const now = new Date().toISOString();

if (!existing) {
await db.run(
`
INSERT INTO compliance_profiles (
wallet_address,
profile_type,
status,
risk_rating,
legal_name,
display_name,
entity_name,
entity_type,
entity_registration_number,
email,
phone,
country_code,
date_of_birth,
pep_status,
sanctions_status,
source_of_funds_summary,
source_of_wealth_summary,
verification_started_at,
verification_completed_at,
manual_review_required,
manual_review_reason,
notes,
metadata_json,
created_at,
updated_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
`,
[
walletAddress,
profileType,
status,
riskRating,
legalName,
displayName,
entityName,
entityType,
entityRegistrationNumber,
email,
phone,
countryCode,
dateOfBirth,
pepStatus,
sanctionsStatus,
sourceOfFundsSummary,
sourceOfWealthSummary,
setVerificationStartedAt ? now : null,
setVerificationCompletedAt ? now : null,
manualReviewRequired,
manualReviewReason,
notes,
metadata ? JSON.stringify(metadata) : null,
]
);

return getProfileByWallet(walletAddress);
}

const mergedMetadata = {
...(parseJson(existing.metadata_json, {}) || {}),
...(metadata && typeof metadata === "object" ? metadata : {}),
};

await db.run(
`
UPDATE compliance_profiles
SET
profile_type = ?,
status = ?,
risk_rating = ?,
legal_name = ?,
display_name = ?,
entity_name = ?,
entity_type = ?,
entity_registration_number = ?,
email = ?,
phone = ?,
country_code = ?,
date_of_birth = ?,
pep_status = ?,
sanctions_status = ?,
source_of_funds_summary = ?,
source_of_wealth_summary = ?,
verification_started_at = COALESCE(verification_started_at, ?),
verification_completed_at = CASE WHEN ? IS NOT NULL THEN ? ELSE verification_completed_at END,
manual_review_required = ?,
manual_review_reason = ?,
notes = ?,
metadata_json = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[
profileType,
status,
riskRating,
legalName,
displayName,
entityName,
entityType,
entityRegistrationNumber,
email,
phone,
countryCode,
dateOfBirth,
pepStatus,
sanctionsStatus,
sourceOfFundsSummary,
sourceOfWealthSummary,
setVerificationStartedAt ? now : null,
setVerificationCompletedAt ? now : null,
setVerificationCompletedAt ? now : null,
manualReviewRequired,
manualReviewReason,
notes,
Object.keys(mergedMetadata).length ? JSON.stringify(mergedMetadata) : null,
existing.id,
]
);

return getProfileByWallet(walletAddress);
}

async function replaceBeneficialOwners(profileId, owners = []) {
await db.run(`DELETE FROM beneficial_owners WHERE compliance_profile_id = ?`, [
profileId,
]);

for (const owner of owners) {
const fullName = cleanText(owner?.full_name || owner?.fullName, 200);
if (!fullName) continue;

await db.run(
`
INSERT INTO beneficial_owners (
compliance_profile_id,
full_name,
country_code,
date_of_birth,
ownership_pct,
control_basis,
pep_status,
sanctions_status,
verified_at,
notes,
created_at,
updated_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
`,
[
profileId,
fullName,
cleanText(owner?.country_code || owner?.countryCode, 8).toUpperCase() ||
null,
cleanText(owner?.date_of_birth || owner?.dateOfBirth, 40) || null,
Number.isFinite(Number(owner?.ownership_pct ?? owner?.ownershipPct))
? Number(owner?.ownership_pct ?? owner?.ownershipPct)
: 0,
cleanText(owner?.control_basis || owner?.controlBasis, 200) || null,
toBool(owner?.pep_status ?? owner?.pepStatus),
toBool(owner?.sanctions_status ?? owner?.sanctionsStatus),
cleanText(owner?.verified_at || owner?.verifiedAt, 40) || null,
cleanText(owner?.notes, 1000) || null,
]
);
}
}

async function replaceAuthorisedRepresentatives(profileId, reps = []) {
await db.run(
`DELETE FROM authorised_representatives WHERE compliance_profile_id = ?`,
[profileId]
);

for (const rep of reps) {
const fullName = cleanText(rep?.full_name || rep?.fullName, 200);
if (!fullName) continue;

await db.run(
`
INSERT INTO authorised_representatives (
compliance_profile_id,
full_name,
role_title,
authority_type,
authority_doc_ref,
email,
phone,
country_code,
verified_at,
notes,
created_at,
updated_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
`,
[
profileId,
fullName,
cleanText(rep?.role_title || rep?.roleTitle, 120) || null,
cleanText(rep?.authority_type || rep?.authorityType, 120) || null,
cleanText(rep?.authority_doc_ref || rep?.authorityDocRef, 200) || null,
cleanText(rep?.email, 200) || null,
cleanText(rep?.phone, 60) || null,
cleanText(rep?.country_code || rep?.countryCode, 8).toUpperCase() ||
null,
cleanText(rep?.verified_at || rep?.verifiedAt, 40) || null,
cleanText(rep?.notes, 1000) || null,
]
);
}
}

router.get("/status", async (req, res) => {
try {
const wallet = cleanWallet(req.query.wallet);
const mode = normalizeMode(req.query.mode || req.query.context || "participant");

if (!wallet) {
return res.status(400).json({
ok: false,
error: "wallet is required",
...buildModeFlags(),
});
}

const profile = await getProfileByWallet(wallet);
const payload = buildStatusPayload(profile, wallet, mode);

if (profile?.id) {
payload.beneficial_owners = await getBeneficialOwners(profile.id);
payload.authorised_representatives = await getAuthorisedRepresentatives(
profile.id
);
} else {
payload.beneficial_owners = [];
payload.authorised_representatives = [];
}

return res.json(payload);
} catch (error) {
console.error("GET /api/compliance/status failed", error);
return res.status(500).json({
ok: false,
error: "Failed to fetch compliance status",
message: error?.message || String(error),
...buildModeFlags(),
});
}
});

router.post("/start", async (req, res) => {
try {
const wallet = cleanWallet(req.body?.wallet);
const mode = normalizeMode(req.body?.mode || req.body?.context || "participant");
const profileType = normalizeProfileType(req.body?.profile_type);

if (!wallet) {
return res.status(400).json({
ok: false,
error: "wallet is required",
});
}

const before = await getProfileByWallet(wallet);

const profile = await upsertProfile({
walletAddress: wallet,
profileType,
legalName: before?.legal_name || null,
displayName: before?.display_name || null,
entityName: before?.entity_name || null,
entityType: before?.entity_type || null,
entityRegistrationNumber: before?.entity_registration_number || null,
email: before?.email || null,
phone: before?.phone || null,
countryCode: before?.country_code || null,
dateOfBirth: before?.date_of_birth || null,
pepStatus: before?.pep_status || 0,
sanctionsStatus: before?.sanctions_status || 0,
sourceOfFundsSummary: before?.source_of_funds_summary || null,
sourceOfWealthSummary: before?.source_of_wealth_summary || null,
status: before?.status || "pending",
riskRating: before?.risk_rating || "low",
manualReviewRequired: before?.manual_review_required || 0,
manualReviewReason: before?.manual_review_reason || null,
notes: before?.notes || null,
metadata: {
onboarding_mode: mode,
started_via: "api/compliance/start",
},
setVerificationStartedAt: true,
setVerificationCompletedAt: false,
});

await auditLog.logProfileEvent({
actorType: "wallet",
actorId: wallet,
action: before ? "compliance_start_updated" : "compliance_start_created",
profileId: profile.id,
oldState: before,
newState: profile,
notes: `Compliance onboarding started for mode=${mode}`,
});

return res.json(buildStatusPayload(profile, wallet, mode));
} catch (error) {
console.error("POST /api/compliance/start failed", error);
return res.status(500).json({
ok: false,
error: "Failed to start compliance onboarding",
message: error?.message || String(error),
});
}
});

router.post("/submit", async (req, res) => {
try {
const wallet = cleanWallet(req.body?.wallet);
const mode = normalizeMode(req.body?.mode || req.body?.context || "participant");

if (!wallet) {
return res.status(400).json({
ok: false,
error: "wallet is required",
});
}

const before = await getProfileByWallet(wallet);

const profileType = normalizeProfileType(
req.body?.profile_type || before?.profile_type || "individual"
);

const requestedStatus = normalizeStatus(
req.body?.status || (before ? "pending" : "pending"),
"pending"
);

const requestedRisk = normalizeRiskRating(
req.body?.risk_rating || before?.risk_rating || "low",
"low"
);

const profile = await upsertProfile({
walletAddress: wallet,
profileType,
legalName: cleanText(req.body?.legal_name || req.body?.legalName, 200) || null,
displayName:
cleanText(req.body?.display_name || req.body?.displayName, 200) || null,
entityName:
cleanText(req.body?.entity_name || req.body?.entityName, 200) || null,
entityType:
cleanText(req.body?.entity_type || req.body?.entityType, 120) || null,
entityRegistrationNumber:
cleanText(
req.body?.entity_registration_number ||
req.body?.entityRegistrationNumber,
120
) || null,
email: cleanText(req.body?.email, 200) || null,
phone: cleanText(req.body?.phone, 60) || null,
countryCode:
cleanText(req.body?.country_code || req.body?.countryCode, 8).toUpperCase() ||
null,
dateOfBirth:
cleanText(req.body?.date_of_birth || req.body?.dateOfBirth, 40) || null,
pepStatus: toBool(req.body?.pep_status ?? req.body?.pepStatus),
sanctionsStatus: toBool(
req.body?.sanctions_status ?? req.body?.sanctionsStatus
),
sourceOfFundsSummary:
cleanText(
req.body?.source_of_funds_summary || req.body?.sourceOfFundsSummary,
1000
) || null,
sourceOfWealthSummary:
cleanText(
req.body?.source_of_wealth_summary || req.body?.sourceOfWealthSummary,
1000
) || null,
status: requestedStatus,
riskRating: requestedRisk,
manualReviewRequired: toBool(
req.body?.manual_review_required ?? req.body?.manualReviewRequired
),
manualReviewReason:
cleanText(
req.body?.manual_review_reason || req.body?.manualReviewReason,
1000
) || null,
notes: cleanText(req.body?.notes, 2000) || null,
metadata:
req.body?.metadata && typeof req.body.metadata === "object"
? req.body.metadata
: null,
setVerificationStartedAt: true,
setVerificationCompletedAt: requestedStatus === "approved",
});

if (Array.isArray(req.body?.beneficial_owners || req.body?.beneficialOwners)) {
await replaceBeneficialOwners(
profile.id,
req.body?.beneficial_owners || req.body?.beneficialOwners || []
);
}

if (
Array.isArray(
req.body?.authorised_representatives || req.body?.authorisedRepresentatives
)
) {
await replaceAuthorisedRepresentatives(
profile.id,
req.body?.authorised_representatives ||
req.body?.authorisedRepresentatives ||
[]
);
}

const updatedProfile = await getProfileByWallet(wallet);

await auditLog.logProfileEvent({
actorType: "wallet",
actorId: wallet,
action: "compliance_profile_submitted",
profileId: updatedProfile.id,
oldState: before,
newState: updatedProfile,
notes: `Compliance profile submitted for mode=${mode}`,
});

const payload = buildStatusPayload(updatedProfile, wallet, mode);
payload.beneficial_owners = await getBeneficialOwners(updatedProfile.id);
payload.authorised_representatives = await getAuthorisedRepresentatives(
updatedProfile.id
);

return res.json(payload);
} catch (error) {
console.error("POST /api/compliance/submit failed", error);
return res.status(500).json({
ok: false,
error: "Failed to submit compliance profile",
message: error?.message || String(error),
});
}
});

export default router;
