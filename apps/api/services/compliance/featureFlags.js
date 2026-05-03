const TRUE_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

export const COMPLIANCE_MODES = Object.freeze({
OFF: "off",
READ_ONLY: "read_only",
GATED: "gated",
FULL: "full",
});

function normalizeString(value, fallback = "") {
if (value === null || value === undefined) return fallback;
const normalized = String(value).trim().toLowerCase();
return normalized || fallback;
}

function parseBoolean(value, fallback = false) {
const normalized = normalizeString(value);
if (!normalized) return fallback;
if (TRUE_VALUES.has(normalized)) return true;
if (FALSE_VALUES.has(normalized)) return false;
return fallback;
}

function parseComplianceMode(value) {
const normalized = normalizeString(value, COMPLIANCE_MODES.OFF);
if (Object.values(COMPLIANCE_MODES).includes(normalized)) {
return normalized;
}
return COMPLIANCE_MODES.OFF;
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
return getComplianceMode() === COMPLIANCE_MODES.GATED;
}

export function isComplianceFull() {
return getComplianceMode() === COMPLIANCE_MODES.FULL;
}

export function isBuilderGateEnabled() {
if (isComplianceOff() || isComplianceReadOnly()) return false;
return parseBoolean(process.env.COMPLIANCE_REQUIRE_BUILDER_KYB, true);
}

export function isParticipantGateEnabled() {
if (isComplianceOff() || isComplianceReadOnly()) return false;
return parseBoolean(process.env.COMPLIANCE_REQUIRE_PARTICIPANT_KYC, true);
}

export function isManualReviewEnabled() {
if (isComplianceOff()) return false;
return parseBoolean(process.env.COMPLIANCE_ENABLE_MANUAL_REVIEW, true);
}

export function isJurisdictionBlockingEnabled() {
if (isComplianceOff()) return false;
return parseBoolean(
process.env.COMPLIANCE_BLOCK_RESTRICTED_JURISDICTIONS,
true
);
}

export function isAccountingLedgerEnabled() {
return parseBoolean(process.env.COMPLIANCE_ENABLE_ACCOUNTING_LEDGER, true);
}

export function getRestrictedJurisdictions() {
const raw = process.env.COMPLIANCE_RESTRICTED_JURISDICTIONS || "";
return raw
.split(",")
.map((value) => value.trim().toUpperCase())
.filter(Boolean);
}

export function getHighRiskJurisdictions() {
const raw = process.env.COMPLIANCE_HIGH_RISK_JURISDICTIONS || "";
return raw
.split(",")
.map((value) => value.trim().toUpperCase())
.filter(Boolean);
}

export function getComplianceConfig() {
return {
mode: getComplianceMode(),
builderGateEnabled: isBuilderGateEnabled(),
participantGateEnabled: isParticipantGateEnabled(),
manualReviewEnabled: isManualReviewEnabled(),
jurisdictionBlockingEnabled: isJurisdictionBlockingEnabled(),
accountingLedgerEnabled: isAccountingLedgerEnabled(),
restrictedJurisdictions: getRestrictedJurisdictions(),
highRiskJurisdictions: getHighRiskJurisdictions(),
};
}

export default {
COMPLIANCE_MODES,
getComplianceMode,
isComplianceOff,
isComplianceReadOnly,
isComplianceGated,
isComplianceFull,
isBuilderGateEnabled,
isParticipantGateEnabled,
isManualReviewEnabled,
isJurisdictionBlockingEnabled,
isAccountingLedgerEnabled,
getRestrictedJurisdictions,
getHighRiskJurisdictions,
getComplianceConfig,
};
