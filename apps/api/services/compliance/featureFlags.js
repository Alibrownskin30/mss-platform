const TRUE_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

export const COMPLIANCE_MODES = Object.freeze({
OFF: "off",
READ_ONLY: "read_only",
GATED: "gated",
FULL: "full",

// New bucket-native values
SILENT: "silent",
REQUIRED: "required",
ESCALATION: "escalation",
});

export const COMPLIANCE_BUCKETS = Object.freeze({
REQUIRED: "required",
SILENT: "silent",
ESCALATION: "escalation",
});

const ALL_MODE_VALUES = new Set(Object.values(COMPLIANCE_MODES));
const ALL_BUCKET_VALUES = new Set(Object.values(COMPLIANCE_BUCKETS));

function normalizeString(value, fallback = "") {
if (value === null || value === undefined) return fallback;
const normalized = String(value).trim().toLowerCase();
return normalized || fallback;
}

function hasExplicitEnv(name) {
return Object.prototype.hasOwnProperty.call(process.env, name);
}

function parseBoolean(value, fallback = false) {
const normalized = normalizeString(value);
if (!normalized) return fallback;
if (TRUE_VALUES.has(normalized)) return true;
if (FALSE_VALUES.has(normalized)) return false;
return fallback;
}

function parseList(value) {
return String(value || "")
.split(",")
.map((entry) => entry.trim().toUpperCase())
.filter(Boolean);
}

function parseComplianceMode(value) {
const normalized = normalizeString(value, COMPLIANCE_MODES.SILENT);
if (ALL_MODE_VALUES.has(normalized)) return normalized;

if (normalized === "readonly") return COMPLIANCE_MODES.READ_ONLY;
if (normalized === "gate" || normalized === "gated_mode") return COMPLIANCE_MODES.GATED;
if (normalized === "strict") return COMPLIANCE_MODES.FULL;

if (normalized === COMPLIANCE_BUCKETS.SILENT) return COMPLIANCE_MODES.SILENT;
if (normalized === COMPLIANCE_BUCKETS.REQUIRED) return COMPLIANCE_MODES.REQUIRED;
if (normalized === COMPLIANCE_BUCKETS.ESCALATION) return COMPLIANCE_MODES.ESCALATION;

return COMPLIANCE_MODES.SILENT;
}

function parseBucket(value, fallback = COMPLIANCE_BUCKETS.SILENT) {
const normalized = normalizeString(value);

if (!normalized) return fallback;
if (ALL_BUCKET_VALUES.has(normalized)) return normalized;

if (normalized === "read_only" || normalized === "readonly" || normalized === "observe_only") {
return COMPLIANCE_BUCKETS.SILENT;
}

if (normalized === "gated" || normalized === "gate" || normalized === "full" || normalized === "strict") {
return COMPLIANCE_BUCKETS.REQUIRED;
}

if (
normalized === "manual_review" ||
normalized === "review" ||
normalized === "escalate" ||
normalized === "escalated"
) {
return COMPLIANCE_BUCKETS.ESCALATION;
}

return fallback;
}

function mapLegacyModeToBucket(mode) {
if (mode === COMPLIANCE_MODES.OFF) return null;
if (mode === COMPLIANCE_MODES.READ_ONLY) return COMPLIANCE_BUCKETS.SILENT;
if (mode === COMPLIANCE_MODES.GATED) return COMPLIANCE_BUCKETS.REQUIRED;
if (mode === COMPLIANCE_MODES.FULL) return COMPLIANCE_BUCKETS.REQUIRED;
if (mode === COMPLIANCE_MODES.SILENT) return COMPLIANCE_BUCKETS.SILENT;
if (mode === COMPLIANCE_MODES.REQUIRED) return COMPLIANCE_BUCKETS.REQUIRED;
if (mode === COMPLIANCE_MODES.ESCALATION) return COMPLIANCE_BUCKETS.ESCALATION;
return COMPLIANCE_BUCKETS.SILENT;
}

function resolveBucket({
explicitBucketEnvNames = [],
legacyRequiredBooleanEnv = "",
fallbackBucket = COMPLIANCE_BUCKETS.SILENT,
}) {
if (isComplianceOff()) return null;

for (const envName of explicitBucketEnvNames) {
if (!envName) continue;
if (!hasExplicitEnv(envName)) continue;

const parsed = parseBucket(process.env[envName], null);
if (parsed) return parsed;
}

if (legacyRequiredBooleanEnv && hasExplicitEnv(legacyRequiredBooleanEnv)) {
return parseBoolean(process.env[legacyRequiredBooleanEnv], false)
? COMPLIANCE_BUCKETS.REQUIRED
: COMPLIANCE_BUCKETS.SILENT;
}

return fallbackBucket;
}

export function getComplianceMode() {
return parseComplianceMode(process.env.COMPLIANCE_MODE);
}

export function isComplianceOff() {
return getComplianceMode() === COMPLIANCE_MODES.OFF;
}

export function isComplianceReadOnly() {
return getComplianceMode() === COMPLIANCE_MODES.READ_ONLY;
}

export function isComplianceGated() {
const mode = getComplianceMode();
return (
mode === COMPLIANCE_MODES.GATED ||
getComplianceBucket() === COMPLIANCE_BUCKETS.REQUIRED
);
}

export function isComplianceFull() {
return getComplianceMode() === COMPLIANCE_MODES.FULL;
}

export function isComplianceSilent() {
return getComplianceBucket() === COMPLIANCE_BUCKETS.SILENT;
}

export function isComplianceRequired() {
return getComplianceBucket() === COMPLIANCE_BUCKETS.REQUIRED;
}

export function isComplianceEscalation() {
return getComplianceBucket() === COMPLIANCE_BUCKETS.ESCALATION;
}

export function getComplianceBucket() {
const mode = getComplianceMode();

if (isComplianceOff()) return null;

if (hasExplicitEnv("COMPLIANCE_BUCKET")) {
return parseBucket(process.env.COMPLIANCE_BUCKET, COMPLIANCE_BUCKETS.SILENT);
}

if (hasExplicitEnv("COMPLIANCE_DEFAULT_BUCKET")) {
return parseBucket(process.env.COMPLIANCE_DEFAULT_BUCKET, COMPLIANCE_BUCKETS.SILENT);
}

return mapLegacyModeToBucket(mode);
}

export function getBuilderComplianceBucket() {
return resolveBucket({
explicitBucketEnvNames: ["COMPLIANCE_BUILDER_BUCKET"],
legacyRequiredBooleanEnv: "COMPLIANCE_REQUIRE_BUILDER_KYB",
fallbackBucket: getComplianceBucket() || COMPLIANCE_BUCKETS.SILENT,
});
}

export function getParticipantComplianceBucket() {
return resolveBucket({
explicitBucketEnvNames: ["COMPLIANCE_PARTICIPANT_BUCKET"],
legacyRequiredBooleanEnv: "COMPLIANCE_REQUIRE_PARTICIPANT_KYC",
fallbackBucket: getComplianceBucket() || COMPLIANCE_BUCKETS.SILENT,
});
}

export function getJurisdictionComplianceBucket() {
return resolveBucket({
explicitBucketEnvNames: ["COMPLIANCE_JURISDICTION_BUCKET"],
legacyRequiredBooleanEnv: "COMPLIANCE_BLOCK_RESTRICTED_JURISDICTIONS",
fallbackBucket: COMPLIANCE_BUCKETS.ESCALATION,
});
}

export function getManualReviewBucket() {
if (isComplianceOff()) return null;

if (!parseBoolean(process.env.COMPLIANCE_ENABLE_MANUAL_REVIEW, true)) {
return null;
}

return resolveBucket({
explicitBucketEnvNames: ["COMPLIANCE_MANUAL_REVIEW_BUCKET"],
fallbackBucket: COMPLIANCE_BUCKETS.ESCALATION,
});
}

export function isBuilderGateEnabled() {
return getBuilderComplianceBucket() === COMPLIANCE_BUCKETS.REQUIRED;
}

export function isParticipantGateEnabled() {
return getParticipantComplianceBucket() === COMPLIANCE_BUCKETS.REQUIRED;
}

export function isBuilderSilentScreeningEnabled() {
const bucket = getBuilderComplianceBucket();
if (!bucket) return false;
return parseBoolean(process.env.COMPLIANCE_ENABLE_BUILDER_SILENT_SCREENING, true);
}

export function isParticipantSilentScreeningEnabled() {
const bucket = getParticipantComplianceBucket();
if (!bucket) return false;
return parseBoolean(process.env.COMPLIANCE_ENABLE_PARTICIPANT_SILENT_SCREENING, true);
}

export function isBuilderEscalationEnabled() {
const bucket = getBuilderComplianceBucket();
if (!bucket) return false;
if (bucket !== COMPLIANCE_BUCKETS.ESCALATION && bucket !== COMPLIANCE_BUCKETS.REQUIRED) {
return false;
}
return parseBoolean(process.env.COMPLIANCE_ENABLE_BUILDER_ESCALATION, true);
}

export function isParticipantEscalationEnabled() {
const bucket = getParticipantComplianceBucket();
if (!bucket) return false;
if (bucket !== COMPLIANCE_BUCKETS.ESCALATION && bucket !== COMPLIANCE_BUCKETS.REQUIRED) {
return false;
}
return parseBoolean(process.env.COMPLIANCE_ENABLE_PARTICIPANT_ESCALATION, true);
}

export function isManualReviewEnabled() {
return Boolean(getManualReviewBucket());
}

export function isJurisdictionBlockingEnabled() {
return getJurisdictionComplianceBucket() === COMPLIANCE_BUCKETS.REQUIRED;
}

export function shouldEscalateRestrictedJurisdiction() {
return getJurisdictionComplianceBucket() === COMPLIANCE_BUCKETS.ESCALATION;
}

export function isAccountingLedgerEnabled() {
return parseBoolean(process.env.COMPLIANCE_ENABLE_ACCOUNTING_LEDGER, true);
}

export function getRestrictedJurisdictions() {
return parseList(process.env.COMPLIANCE_RESTRICTED_JURISDICTIONS);
}

export function getHighRiskJurisdictions() {
return parseList(process.env.COMPLIANCE_HIGH_RISK_JURISDICTIONS);
}

export function getComplianceConfig() {
return {
mode: getComplianceMode(),
bucket: getComplianceBucket(),

builder: {
bucket: getBuilderComplianceBucket(),
gateEnabled: isBuilderGateEnabled(),
silentScreeningEnabled: isBuilderSilentScreeningEnabled(),
escalationEnabled: isBuilderEscalationEnabled(),
},

participant: {
bucket: getParticipantComplianceBucket(),
gateEnabled: isParticipantGateEnabled(),
silentScreeningEnabled: isParticipantSilentScreeningEnabled(),
escalationEnabled: isParticipantEscalationEnabled(),
},

jurisdiction: {
bucket: getJurisdictionComplianceBucket(),
blockingEnabled: isJurisdictionBlockingEnabled(),
escalationEnabled: shouldEscalateRestrictedJurisdiction(),
restrictedJurisdictions: getRestrictedJurisdictions(),
highRiskJurisdictions: getHighRiskJurisdictions(),
},

manualReview: {
bucket: getManualReviewBucket(),
enabled: isManualReviewEnabled(),
},

accountingLedgerEnabled: isAccountingLedgerEnabled(),
};
}

export default {
COMPLIANCE_MODES,
COMPLIANCE_BUCKETS,
getComplianceMode,
getComplianceBucket,
isComplianceOff,
isComplianceReadOnly,
isComplianceGated,
isComplianceFull,
isComplianceSilent,
isComplianceRequired,
isComplianceEscalation,
getBuilderComplianceBucket,
getParticipantComplianceBucket,
getJurisdictionComplianceBucket,
getManualReviewBucket,
isBuilderGateEnabled,
isParticipantGateEnabled,
isBuilderSilentScreeningEnabled,
isParticipantSilentScreeningEnabled,
isBuilderEscalationEnabled,
isParticipantEscalationEnabled,
isManualReviewEnabled,
isJurisdictionBlockingEnabled,
shouldEscalateRestrictedJurisdiction,
isAccountingLedgerEnabled,
getRestrictedJurisdictions,
getHighRiskJurisdictions,
getComplianceConfig,
};
