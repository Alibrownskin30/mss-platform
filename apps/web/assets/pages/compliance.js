import {
connectWallet as connectAnyWallet,
disconnectWallet as disconnectAnyWallet,
getConnectedWallet,
getConnectedPublicKey,
onWalletChange,
restoreWalletIfTrusted,
getMobileWalletHelpText,
} from "../wallet.js";

const state = {
mode: "participant",
wallet: "",
profile: null,
statusPayload: null,
isSubmitting: false,
};

const els = {
connectWalletButton: document.getElementById("connectWalletButton"),
complianceModeChip: document.getElementById("complianceModeChip"),
heroAccessScope: document.getElementById("heroAccessScope"),
heroCurrentStage: document.getElementById("heroCurrentStage"),

statusPill: document.getElementById("statusPill"),
walletStatusCopy: document.getElementById("walletStatusCopy"),
walletValue: document.getElementById("walletValue"),
countryValue: document.getElementById("countryValue"),
riskValue: document.getElementById("riskValue"),
accessValue: document.getElementById("accessValue"),

builderGateValue: document.getElementById("builderGateValue"),
participantGateValue: document.getElementById("participantGateValue"),

summaryModeValue: document.getElementById("summaryModeValue"),
summaryOutcomeValue: document.getElementById("summaryOutcomeValue"),

banner: document.getElementById("banner"),

modeParticipantButton: document.getElementById("modeParticipantButton"),
modeBuilderButton: document.getElementById("modeBuilderButton"),

walletAddress: document.getElementById("walletAddress"),
loadStatusButton: document.getElementById("loadStatusButton"),

complianceForm: document.getElementById("complianceForm"),
profileType: document.getElementById("profileType"),
countryCode: document.getElementById("countryCode"),
legalName: document.getElementById("legalName"),
displayName: document.getElementById("displayName"),

entityFields: document.getElementById("entityFields"),
entityName: document.getElementById("entityName"),
entityType: document.getElementById("entityType"),
entityRegistrationNumber: document.getElementById("entityRegistrationNumber"),

email: document.getElementById("email"),
phone: document.getElementById("phone"),
dateOfBirth: document.getElementById("dateOfBirth"),
riskRating: document.getElementById("riskRating"),

pepStatus: document.getElementById("pepStatus"),
sanctionsStatus: document.getElementById("sanctionsStatus"),
manualReviewRequired: document.getElementById("manualReviewRequired"),
manualReviewReason: document.getElementById("manualReviewReason"),

sourceOfFundsSummary: document.getElementById("sourceOfFundsSummary"),
sourceOfWealthSummary: document.getElementById("sourceOfWealthSummary"),
notes: document.getElementById("notes"),

beneficialOwnersSection: document.getElementById("beneficialOwnersSection"),
beneficialOwnersCollection: document.getElementById("beneficialOwnersCollection"),
addBeneficialOwnerButton: document.getElementById("addBeneficialOwnerButton"),
beneficialOwnerTemplate: document.getElementById("beneficialOwnerTemplate"),

authorisedRepresentativesSection: document.getElementById(
"authorisedRepresentativesSection"
),
authorisedRepresentativesCollection: document.getElementById(
"authorisedRepresentativesCollection"
),
addRepresentativeButton: document.getElementById("addRepresentativeButton"),
representativeTemplate: document.getElementById("representativeTemplate"),

startComplianceButton: document.getElementById("startComplianceButton"),
submitComplianceButton: document.getElementById("submitComplianceButton"),

// Optional newer placeholders. Safe if absent.
accessReasonValue: document.getElementById("accessReasonValue"),
modeBucketValue: document.getElementById("modeBucketValue"),
builderBucketValue: document.getElementById("builderBucketValue"),
participantBucketValue: document.getElementById("participantBucketValue"),
jurisdictionBucketValue: document.getElementById("jurisdictionBucketValue"),
escalationSignalsList: document.getElementById("escalationSignalsList"),
blockingSignalsList: document.getElementById("blockingSignalsList"),
escalationSignalsSection: document.getElementById("escalationSignalsSection"),
blockingSignalsSection: document.getElementById("blockingSignalsSection"),
};

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max);
}

function toBool(value) {
return value === true || value === 1 || value === "1";
}

function shortenWallet(wallet) {
const value = cleanText(wallet, 200);
if (!value) return "Not connected";
if (value.length <= 14) return value;
return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function setText(el, value) {
if (el) el.textContent = value;
}

function setHtml(el, value) {
if (el) el.innerHTML = value;
}

function setHidden(el, hidden) {
if (!el) return;
el.classList.toggle("hidden", Boolean(hidden));
}

function escapeHtml(value) {
return String(value ?? "")
.replaceAll("&", "&amp;")
.replaceAll("<", "&lt;")
.replaceAll(">", "&gt;")
.replaceAll('"', "&quot;")
.replaceAll("'", "&#039;");
}

function getApiBase() {
const { protocol, hostname, port } = window.location;
const override = cleanText(window.__API_BASE__ || "", 1000);

if (override) {
return override.replace(/\/$/, "");
}

if (
hostname === "devnet.mssprotocol.com" ||
hostname === "www.devnet.mssprotocol.com"
) {
return "https://api.devnet.mssprotocol.com";
}

if (
hostname === "127.0.0.1" ||
hostname === "localhost" ||
hostname === "[::1]"
) {
return `${protocol}//${hostname}:8787`;
}

if (hostname.includes("-3000.app.github.dev")) {
return `${protocol}//${hostname.replace("-3000.app.github.dev", "-8787.app.github.dev")}`;
}

if (hostname.includes("-3001.app.github.dev")) {
return `${protocol}//${hostname.replace("-3001.app.github.dev", "-8787.app.github.dev")}`;
}

if (hostname.includes("-4173.app.github.dev")) {
return `${protocol}//${hostname.replace("-4173.app.github.dev", "-8787.app.github.dev")}`;
}

if (port && port !== "80" && port !== "443") {
return `${protocol}//${hostname}:8787`;
}

return `${window.location.origin}`;
}

const API_BASE = getApiBase();

async function apiFetch(path, options = {}) {
const response = await fetch(`${API_BASE}${path}`, {
credentials: "include",
headers: {
"Content-Type": "application/json",
...(options.headers || {}),
},
...options,
});

let payload = null;
try {
payload = await response.json();
} catch {
payload = null;
}

if (!response.ok) {
throw new Error(
payload?.error || payload?.message || `Request failed (${response.status})`
);
}

return payload;
}

function setBanner(message = "", variant = "warn") {
if (!els.banner) return;
els.banner.textContent = message || "";
els.banner.className = "banner";
if (message) {
els.banner.classList.add("show");
els.banner.classList.add(variant);
}
}

function clearBanner() {
if (!els.banner) return;
els.banner.className = "banner";
els.banner.textContent = "";
}

function formatBucketLabel(value = "") {
const normalized = cleanText(value, 32).toLowerCase();

if (normalized === "required") return "Required";
if (normalized === "silent") return "Silent";
if (normalized === "escalation") return "Escalation";
if (normalized === "read_only") return "Read Only";
if (normalized === "off") return "Off";
return "Unknown";
}

function normalizeAccessState(payload = null) {
const explicit = cleanText(payload?.access_state, 32).toLowerCase();
if (explicit) return explicit;

const transactionalAccess = Boolean(payload?.transactional_access);
const status = cleanText(payload?.status, 32).toLowerCase();
const approvalRequired = Boolean(
payload?.approval_required ??
payload?.builder_gate_enabled ??
payload?.participant_gate_enabled
);
const restrictedJurisdiction = Boolean(payload?.restricted_jurisdiction);
const manualReviewRequired = Boolean(
payload?.manual_review_required || payload?.profile?.manual_review_required
);
const escalationRequired = Boolean(payload?.escalation_required);
const silentMonitoring = Boolean(payload?.silent_monitoring);

if (!transactionalAccess) {
if (restrictedJurisdiction || manualReviewRequired || status === "rejected" || status === "restricted") {
return "blocked";
}
if (status === "pending") return "pending";
if (approvalRequired) return "required";
return "blocked";
}

if (escalationRequired) return "watch";
if (silentMonitoring) return "silent";
if (approvalRequired && status === "approved") return "approved";
return "open";
}

function formatAccessLabel(accessState = "") {
switch (cleanText(accessState, 32).toLowerCase()) {
case "blocked":
return "Access Blocked";
case "pending":
return "Pending Review";
case "required":
return "Verification Required";
case "watch":
return "Monitoring Watch";
case "silent":
return "Silent Monitoring";
case "approved":
return "Approved";
case "open":
default:
return "Access Open";
}
}

function getAccessVariant(payload = null) {
const accessState = normalizeAccessState(payload);

if (accessState === "blocked") return "bad";
if (accessState === "pending" || accessState === "required") return "warn";
if (accessState === "watch") return "warn";
return "good";
}

function getPrimaryReason(payload = null) {
const accessReason = cleanText(payload?.access_reason, 1000);
if (accessReason) return accessReason;

const accessState = normalizeAccessState(payload);
const modeLabel = state.mode === "builder" ? "Builder" : "Participant";
const status = cleanText(payload?.status, 32).toLowerCase();
const restrictedJurisdiction = Boolean(payload?.restricted_jurisdiction);
const manualReviewRequired = Boolean(
payload?.manual_review_required || payload?.profile?.manual_review_required
);

if (restrictedJurisdiction) {
return "This wallet is associated with a restricted jurisdiction under the current policy.";
}

if (manualReviewRequired) {
return (
cleanText(payload?.profile?.manual_review_reason, 1000) ||
"Manual review is required before access can continue."
);
}

if (accessState === "blocked") {
return `${modeLabel} access is currently blocked.`;
}

if (accessState === "pending") {
return `${modeLabel} verification is pending review before transactional access can open.`;
}

if (accessState === "required") {
return `${modeLabel} verification is required before transactional access can open.`;
}

if (accessState === "watch") {
return "Escalation-only monitoring is active. Access remains open unless triggered risk conditions require intervention.";
}

if (accessState === "silent") {
return "Silent monitoring is active. Access remains open unless explicit risk intervention is triggered.";
}

if (status === "approved" && payload?.transactional_access) {
return "This wallet currently satisfies the active compliance access policy.";
}

return "Connect a wallet or load a profile to review compliance access.";
}

function renderSignalList(container, section, items, emptyText) {
if (!container) return;

if (!Array.isArray(items) || !items.length) {
setHtml(
container,
`<div class="signal-empty">${escapeHtml(emptyText)}</div>`
);
if (section) section.classList.add("hidden");
return;
}

if (section) section.classList.remove("hidden");

const markup = items
.map((item) => {
const severity = cleanText(item?.severity, 32).toLowerCase() || "medium";
const code = cleanText(item?.code, 80) || "signal";
const message = cleanText(item?.message, 1000) || "No detail available.";
const source = cleanText(item?.source, 80) || "system";

return `
<div class="signal-item severity-${escapeHtml(severity)}">
<div class="signal-item-top">
<strong>${escapeHtml(code.replaceAll("_", " "))}</strong>
<span>${escapeHtml(source)}</span>
</div>
<div class="signal-item-copy">${escapeHtml(message)}</div>
</div>
`;
})
.join("");

setHtml(container, markup);
}

function updateModeUi() {
const isBuilder = state.mode === "builder";
const profileType = cleanText(els.profileType?.value, 32).toLowerCase();
const showEntitySections = profileType === "entity";

els.modeParticipantButton?.classList.toggle("active", !isBuilder);
els.modeBuilderButton?.classList.toggle("active", isBuilder);

setText(els.complianceModeChip, isBuilder ? "Builder" : "Participant");
setText(
els.heroAccessScope,
isBuilder ? "Builder launch access review" : "Participant access review"
);
setText(els.summaryModeValue, isBuilder ? "Builder" : "Participant");

if (els.startComplianceButton) {
els.startComplianceButton.textContent = isBuilder
? "Start Builder Review"
: "Start Participant Review";
}

if (els.submitComplianceButton) {
els.submitComplianceButton.textContent = isBuilder
? "Submit Builder Profile"
: "Submit Participant Profile";
}

setHidden(els.entityFields, !showEntitySections);
setHidden(els.beneficialOwnersSection, !showEntitySections);
setHidden(els.authorisedRepresentativesSection, !showEntitySections);
}

function updateStatusUi(statusPayload = null) {
state.statusPayload = statusPayload || null;
state.profile = statusPayload?.profile || null;

const variant = getAccessVariant(statusPayload);
const accessState = normalizeAccessState(statusPayload);
const accessLabel = formatAccessLabel(accessState);
const reason = getPrimaryReason(statusPayload);

if (els.statusPill) {
els.statusPill.className = `status-pill ${variant}`;
els.statusPill.textContent = accessLabel;
}

setText(els.heroCurrentStage, accessLabel);
setText(els.summaryOutcomeValue, accessLabel);
setText(els.walletStatusCopy, reason);

setText(els.walletValue, shortenWallet(statusPayload?.wallet || state.wallet));
setText(
els.countryValue,
cleanText(statusPayload?.profile?.country_code, 8).toUpperCase() || "Unknown"
);
setText(
els.riskValue,
cleanText(statusPayload?.profile?.risk_rating, 40) || "Low"
);
setText(els.accessValue, accessLabel);

setText(
els.builderGateValue,
formatBucketLabel(
statusPayload?.builder_bucket ||
(statusPayload?.builder_gate_enabled ? "required" : "silent")
)
);
setText(
els.participantGateValue,
formatBucketLabel(
statusPayload?.participant_bucket ||
(statusPayload?.participant_gate_enabled ? "required" : "silent")
)
);

setText(
els.modeBucketValue,
formatBucketLabel(statusPayload?.compliance_bucket)
);
setText(
els.builderBucketValue,
formatBucketLabel(statusPayload?.builder_bucket)
);
setText(
els.participantBucketValue,
formatBucketLabel(statusPayload?.participant_bucket)
);
setText(
els.jurisdictionBucketValue,
formatBucketLabel(statusPayload?.jurisdiction_bucket)
);
setText(els.accessReasonValue, reason);

renderSignalList(
els.blockingSignalsList,
els.blockingSignalsSection,
statusPayload?.blocking_signals || [],
"No blocking signals are active."
);

renderSignalList(
els.escalationSignalsList,
els.escalationSignalsSection,
statusPayload?.escalation_signals || [],
"No escalation signals are active."
);
}

function setLoadingState(isLoading) {
state.isSubmitting = Boolean(isLoading);

if (els.loadStatusButton) els.loadStatusButton.disabled = isLoading;
if (els.startComplianceButton) els.startComplianceButton.disabled = isLoading;
if (els.submitComplianceButton) els.submitComplianceButton.disabled = isLoading;
if (els.connectWalletButton) els.connectWalletButton.disabled = isLoading;
}

function collectCollectionItems(container) {
if (!container) return [];

return Array.from(container.querySelectorAll("[data-item-type]")).map((card) => {
const out = {};
card.querySelectorAll("[data-field]").forEach((field) => {
const key = field.getAttribute("data-field");
if (!key) return;

if (field.type === "checkbox") {
out[key] = field.checked;
} else {
out[key] = field.value;
}
});
return out;
});
}

function applyCollectionItems(container, template, items = []) {
if (!container || !template) return;
container.innerHTML = "";
items.forEach((item) => appendCollectionCard(container, template, item));
}

function appendCollectionCard(container, template, values = {}) {
if (!container || !template) return;

const fragment = template.content.cloneNode(true);
const card = fragment.querySelector("[data-item-type]");
if (!card) return;

card.querySelectorAll("[data-field]").forEach((field) => {
const key = field.getAttribute("data-field");
const value = values?.[key];

if (field.type === "checkbox") {
field.checked = Boolean(value);
} else if (value !== null && value !== undefined) {
field.value = value;
}
});

const removeButton = card.querySelector("[data-remove-item]");
if (removeButton) {
removeButton.addEventListener("click", () => {
card.remove();
});
}

container.appendChild(card);
}

function populateForm(profile = null, statusPayload = null) {
const source = profile || {};

if (els.profileType) {
els.profileType.value = cleanText(source.profile_type, 32) || "individual";
}
if (els.countryCode) {
els.countryCode.value = cleanText(source.country_code, 8).toUpperCase();
}
if (els.legalName) {
els.legalName.value = cleanText(source.legal_name, 200);
}
if (els.displayName) {
els.displayName.value = cleanText(source.display_name, 200);
}

if (els.entityName) {
els.entityName.value = cleanText(source.entity_name, 200);
}
if (els.entityType) {
els.entityType.value = cleanText(source.entity_type, 120);
}
if (els.entityRegistrationNumber) {
els.entityRegistrationNumber.value = cleanText(
source.entity_registration_number,
120
);
}

if (els.email) {
els.email.value = cleanText(source.email, 200);
}
if (els.phone) {
els.phone.value = cleanText(source.phone, 60);
}
if (els.dateOfBirth) {
els.dateOfBirth.value = cleanText(source.date_of_birth, 40);
}
if (els.riskRating) {
els.riskRating.value = cleanText(source.risk_rating, 32) || "low";
}

if (els.pepStatus) {
els.pepStatus.checked = Boolean(source.pep_status);
}
if (els.sanctionsStatus) {
els.sanctionsStatus.checked = Boolean(source.sanctions_status);
}
if (els.manualReviewRequired) {
els.manualReviewRequired.checked = Boolean(source.manual_review_required);
}
if (els.manualReviewReason) {
els.manualReviewReason.value = cleanText(source.manual_review_reason, 1000);
}

if (els.sourceOfFundsSummary) {
els.sourceOfFundsSummary.value = cleanText(source.source_of_funds_summary, 1000);
}
if (els.sourceOfWealthSummary) {
els.sourceOfWealthSummary.value = cleanText(
source.source_of_wealth_summary,
1000
);
}
if (els.notes) {
els.notes.value = cleanText(source.notes, 2000);
}

applyCollectionItems(
els.beneficialOwnersCollection,
els.beneficialOwnerTemplate,
statusPayload?.beneficial_owners || []
);

applyCollectionItems(
els.authorisedRepresentativesCollection,
els.representativeTemplate,
statusPayload?.authorised_representatives || []
);

updateModeUi();
}

function buildPayload() {
const wallet = cleanText(els.walletAddress?.value, 120);

return {
wallet,
mode: state.mode,
context: state.mode,
profile_type: cleanText(els.profileType?.value, 32) || "individual",
country_code: cleanText(els.countryCode?.value, 8).toUpperCase(),
legal_name: cleanText(els.legalName?.value, 200),
display_name: cleanText(els.displayName?.value, 200),

entity_name: cleanText(els.entityName?.value, 200),
entity_type: cleanText(els.entityType?.value, 120),
entity_registration_number: cleanText(
els.entityRegistrationNumber?.value,
120
),

email: cleanText(els.email?.value, 200),
phone: cleanText(els.phone?.value, 60),
date_of_birth: cleanText(els.dateOfBirth?.value, 40),

risk_rating: cleanText(els.riskRating?.value, 32) || "low",

pep_status: toBool(els.pepStatus?.checked),
sanctions_status: toBool(els.sanctionsStatus?.checked),
manual_review_required: toBool(els.manualReviewRequired?.checked),
manual_review_reason: cleanText(els.manualReviewReason?.value, 1000),

source_of_funds_summary: cleanText(els.sourceOfFundsSummary?.value, 1000),
source_of_wealth_summary: cleanText(els.sourceOfWealthSummary?.value, 1000),

notes: cleanText(els.notes?.value, 2000),

beneficial_owners: collectCollectionItems(els.beneficialOwnersCollection),
authorised_representatives: collectCollectionItems(
els.authorisedRepresentativesCollection
),
};
}

function getUrlMode() {
const mode = cleanText(
new URLSearchParams(window.location.search).get("mode"),
32
).toLowerCase();

return mode === "builder" ? "builder" : "participant";
}

function getUrlWallet() {
return cleanText(new URLSearchParams(window.location.search).get("wallet"), 120);
}

function syncWalletUi() {
const walletState = getConnectedWallet?.() || {};
const connectedWallet = cleanText(
walletState?.publicKey || getConnectedPublicKey() || "",
120
);

if (els.walletAddress && connectedWallet) {
els.walletAddress.value = connectedWallet;
}

if (!els.connectWalletButton) return;

if (connectedWallet) {
els.connectWalletButton.textContent = `Disconnect ${shortenWallet(connectedWallet)}`;
} else {
els.connectWalletButton.textContent = "Connect Wallet";
}
}

async function loadStatus({ showBannerOnMissing = false } = {}) {
const wallet = cleanText(els.walletAddress?.value, 120);

if (!wallet) {
updateStatusUi({
wallet: "",
profile: null,
status: "not_started",
transactional_access: false,
access_state: "required",
access_reason: "Connect or paste a wallet address first.",
builder_bucket: "silent",
participant_bucket: "silent",
compliance_bucket: "silent",
blocking_signals: [],
escalation_signals: [],
});

if (showBannerOnMissing) {
setBanner("Connect or paste a wallet address first.", "warn");
} else {
clearBanner();
}
return;
}

setLoadingState(true);

try {
const payload = await apiFetch(
`/api/compliance/status?wallet=${encodeURIComponent(wallet)}&mode=${encodeURIComponent(
state.mode
)}&context=${encodeURIComponent(state.mode)}&surface=compliance`
);

state.wallet = wallet;
updateStatusUi(payload);
populateForm(payload.profile, payload);
clearBanner();
} catch (error) {
setBanner(error?.message || "Failed to load compliance status.", "bad");
} finally {
setLoadingState(false);
}
}

async function startCompliance() {
const wallet = cleanText(els.walletAddress?.value, 120);

if (!wallet) {
setBanner("Connect or paste a wallet address before starting verification.", "warn");
return;
}

setLoadingState(true);

try {
const payload = await apiFetch("/api/compliance/start", {
method: "POST",
body: JSON.stringify({
wallet,
mode: state.mode,
context: state.mode,
profile_type: cleanText(els.profileType?.value, 32) || "individual",
}),
});

state.wallet = wallet;
updateStatusUi(payload);
populateForm(payload.profile, payload);
setBanner("Compliance onboarding started for this wallet.", "good");
} catch (error) {
setBanner(error?.message || "Failed to start compliance onboarding.", "bad");
} finally {
setLoadingState(false);
}
}

async function submitCompliance(event) {
event.preventDefault();

const payload = buildPayload();
if (!payload.wallet) {
setBanner("Wallet address is required before submitting the profile.", "warn");
return;
}

setLoadingState(true);

try {
const response = await apiFetch("/api/compliance/submit", {
method: "POST",
body: JSON.stringify(payload),
});

state.wallet = payload.wallet;
updateStatusUi(response);
populateForm(response.profile, response);
setBanner("Compliance profile submitted successfully.", "good");
} catch (error) {
setBanner(error?.message || "Failed to submit compliance profile.", "bad");
} finally {
setLoadingState(false);
}
}

async function handleConnectWallet() {
const connectedWallet = cleanText(getConnectedPublicKey() || "", 120);

if (connectedWallet) {
try {
await disconnectAnyWallet();
if (els.walletAddress) {
els.walletAddress.value = "";
}
state.wallet = "";
syncWalletUi();
updateStatusUi({
wallet: "",
profile: null,
status: "not_started",
transactional_access: false,
access_state: "required",
access_reason: "Wallet disconnected.",
builder_bucket: "silent",
participant_bucket: "silent",
compliance_bucket: "silent",
blocking_signals: [],
escalation_signals: [],
});
setBanner("Wallet disconnected.", "warn");
return;
} catch (error) {
setBanner(error?.message || "Failed to disconnect wallet.", "bad");
return;
}
}

try {
const wallet = await connectAnyWallet();
const address = cleanText(wallet?.publicKey || getConnectedPublicKey() || "", 120);

if (!address) {
throw new Error("Wallet connection did not return an address.");
}

if (els.walletAddress) {
els.walletAddress.value = address;
}

state.wallet = address;
syncWalletUi();
clearBanner();
await loadStatus();
} catch (error) {
const message = error?.message || "Failed to connect wallet.";
setBanner(
message.includes("No supported wallet") ? getMobileWalletHelpText() : message,
"bad"
);
}
}

function bindModeButtons() {
[els.modeParticipantButton, els.modeBuilderButton]
.filter(Boolean)
.forEach((button) => {
button.addEventListener("click", async () => {
const nextMode = cleanText(button.dataset.mode, 32).toLowerCase();
if (!nextMode || nextMode === state.mode) return;

state.mode = nextMode === "builder" ? "builder" : "participant";
updateModeUi();

if (cleanText(els.walletAddress?.value, 120)) {
await loadStatus();
} else {
updateStatusUi({
wallet: "",
profile: null,
status: "not_started",
transactional_access: false,
access_state: "required",
access_reason: "Connect or paste a wallet address first.",
builder_bucket: "silent",
participant_bucket: "silent",
compliance_bucket: "silent",
blocking_signals: [],
escalation_signals: [],
});
}
});
});
}

function bindCollections() {
els.addBeneficialOwnerButton?.addEventListener("click", () => {
appendCollectionCard(els.beneficialOwnersCollection, els.beneficialOwnerTemplate);
});

els.addRepresentativeButton?.addEventListener("click", () => {
appendCollectionCard(
els.authorisedRepresentativesCollection,
els.representativeTemplate
);
});
}

function bindInputs() {
els.profileType?.addEventListener("change", updateModeUi);

els.loadStatusButton?.addEventListener("click", () =>
loadStatus({ showBannerOnMissing: true })
);

els.startComplianceButton?.addEventListener("click", startCompliance);
els.complianceForm?.addEventListener("submit", submitCompliance);
els.connectWalletButton?.addEventListener("click", handleConnectWallet);
}

function bindWalletSync() {
onWalletChange(async () => {
syncWalletUi();

const wallet = cleanText(getConnectedPublicKey() || "", 120);
if (!wallet) {
return;
}

if (els.walletAddress) {
els.walletAddress.value = wallet;
}

state.wallet = wallet;

try {
await loadStatus();
} catch {
// handled in loadStatus
}
});
}

async function init() {
state.mode = getUrlMode();
updateModeUi();
bindModeButtons();
bindCollections();
bindInputs();
bindWalletSync();

await restoreWalletIfTrusted().catch(() => {});
syncWalletUi();

const connectedWallet = cleanText(getConnectedPublicKey() || "", 120);
const urlWallet = getUrlWallet();
const initialWallet = urlWallet || connectedWallet;

if (initialWallet && els.walletAddress) {
els.walletAddress.value = initialWallet;
state.wallet = initialWallet;
await loadStatus();
} else {
updateStatusUi({
wallet: "",
profile: null,
status: "not_started",
transactional_access: false,
access_state: "required",
access_reason: "Connect a wallet to load or begin a compliance profile.",
builder_bucket: "silent",
participant_bucket: "silent",
compliance_bucket: "silent",
blocking_signals: [],
escalation_signals: [],
});
}
}

init().catch((error) => {
console.error("Failed to initialize compliance page", error);
setBanner(error?.message || "Failed to initialize compliance page.", "bad");
});
