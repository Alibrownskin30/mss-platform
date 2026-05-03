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

function getApiBase() {
const { protocol, hostname } = window.location;
const override = cleanText(window.__API_BASE__ || "", 1000);
if (override) return override.replace(/\/$/, "");

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

if (/:\d+$/.test(window.location.host)) {
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
throw new Error(payload?.error || payload?.message || `Request failed (${response.status})`);
}

return payload;
}

function setBanner(message = "", variant = "warn") {
els.banner.textContent = message || "";
els.banner.className = "banner";
if (message) {
els.banner.classList.add("show");
els.banner.classList.add(variant);
}
}

function clearBanner() {
els.banner.className = "banner";
els.banner.textContent = "";
}

function getStatusVariant(statusPayload) {
const status = cleanText(statusPayload?.status, 32).toLowerCase();
if (status === "approved" && statusPayload?.transactional_access) return "good";
if (status === "rejected" || status === "restricted") return "bad";
return "warn";
}

function getStatusLabel(statusPayload) {
const status = cleanText(statusPayload?.status, 32).toLowerCase();

switch (status) {
case "approved":
return statusPayload?.transactional_access ? "Approved" : "Approved / Gated";
case "pending":
return "Pending Review";
case "rejected":
return "Rejected";
case "restricted":
return "Restricted";
case "not_started":
default:
return "Not Started";
}
}

function updateModeUi() {
const isBuilder = state.mode === "builder";

els.modeParticipantButton.classList.toggle("active", !isBuilder);
els.modeBuilderButton.classList.toggle("active", isBuilder);

els.complianceModeChip.textContent = isBuilder ? "Builder" : "Participant";
els.heroAccessScope.textContent = isBuilder
? "Builder launch access review"
: "Participant access review";
els.summaryModeValue.textContent = isBuilder ? "Builder" : "Participant";

const profileType = cleanText(els.profileType.value, 32).toLowerCase();
const showEntitySections = profileType === "entity";

els.entityFields.classList.toggle("hidden", !showEntitySections);
els.beneficialOwnersSection.classList.toggle("hidden", !showEntitySections);
els.authorisedRepresentativesSection.classList.toggle("hidden", !showEntitySections);
}

function updateStatusUi(statusPayload = null) {
state.statusPayload = statusPayload || null;

const profile = statusPayload?.profile || null;
state.profile = profile;

const variant = getStatusVariant(statusPayload);
const label = getStatusLabel(statusPayload);

els.statusPill.className = `status-pill ${variant}`;
els.statusPill.textContent = label;

els.walletValue.textContent = shortenWallet(statusPayload?.wallet || state.wallet);
els.countryValue.textContent =
cleanText(profile?.country_code, 8).toUpperCase() || "Unknown";
els.riskValue.textContent = cleanText(profile?.risk_rating, 40) || "Low";
els.accessValue.textContent = statusPayload?.transactional_access ? "Enabled" : "Blocked";

els.builderGateValue.textContent = statusPayload?.builder_gate_enabled
? "Enabled"
: "Disabled";
els.participantGateValue.textContent = statusPayload?.participant_gate_enabled
? "Enabled"
: "Disabled";

els.summaryOutcomeValue.textContent = label;
els.heroCurrentStage.textContent = label;

if (!statusPayload?.wallet) {
els.walletStatusCopy.textContent =
"Connect a wallet to load or begin a compliance profile.";
return;
}

if (statusPayload?.restricted_jurisdiction) {
els.walletStatusCopy.textContent =
"This wallet is associated with a restricted jurisdiction under the current compliance policy.";
return;
}

if (profile?.manual_review_required) {
els.walletStatusCopy.textContent =
profile?.manual_review_reason ||
"Manual review is required before transactional access can be enabled.";
return;
}

if (statusPayload?.transactional_access) {
els.walletStatusCopy.textContent =
"This wallet currently satisfies the active compliance gate for the selected access mode.";
return;
}

switch (cleanText(statusPayload?.status, 32).toLowerCase()) {
case "approved":
els.walletStatusCopy.textContent =
"Profile approved, but transactional access remains limited by current gate settings.";
break;
case "pending":
els.walletStatusCopy.textContent =
"Profile submitted and pending review before access can be enabled.";
break;
case "rejected":
els.walletStatusCopy.textContent =
"This profile has been rejected and requires further review before access can resume.";
break;
case "restricted":
els.walletStatusCopy.textContent =
"This profile is currently restricted from transactional launcher access.";
break;
case "not_started":
default:
els.walletStatusCopy.textContent =
"Verification has not been completed for this wallet yet.";
break;
}
}

function setLoadingState(isLoading) {
state.isSubmitting = !!isLoading;
els.loadStatusButton.disabled = isLoading;
els.startComplianceButton.disabled = isLoading;
els.submitComplianceButton.disabled = isLoading;
els.connectWalletButton.disabled = isLoading;
}

function collectCollectionItems(container) {
return Array.from(container.querySelectorAll("[data-item-type]")).map((card) => {
const out = {};
card.querySelectorAll("[data-field]").forEach((field) => {
const key = field.getAttribute("data-field");
if (!key) return;

if (field.type === "checkbox") {
out[key] = field.checked;
} else if (field.tagName === "TEXTAREA" || field.tagName === "INPUT") {
out[key] = field.value;
} else {
out[key] = field.value;
}
});
return out;
});
}

function applyCollectionItems(container, template, items = []) {
container.innerHTML = "";
items.forEach((item) => appendCollectionCard(container, template, item));
}

function appendCollectionCard(container, template, values = {}) {
const fragment = template.content.cloneNode(true);
const card = fragment.querySelector("[data-item-type]");

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

els.profileType.value = cleanText(source.profile_type, 32) || "individual";
els.countryCode.value = cleanText(source.country_code, 8).toUpperCase();
els.legalName.value = cleanText(source.legal_name, 200);
els.displayName.value = cleanText(source.display_name, 200);

els.entityName.value = cleanText(source.entity_name, 200);
els.entityType.value = cleanText(source.entity_type, 120);
els.entityRegistrationNumber.value = cleanText(source.entity_registration_number, 120);

els.email.value = cleanText(source.email, 200);
els.phone.value = cleanText(source.phone, 60);
els.dateOfBirth.value = cleanText(source.date_of_birth, 40);
els.riskRating.value = cleanText(source.risk_rating, 32) || "low";

els.pepStatus.checked = Boolean(source.pep_status);
els.sanctionsStatus.checked = Boolean(source.sanctions_status);
els.manualReviewRequired.checked = Boolean(source.manual_review_required);
els.manualReviewReason.value = cleanText(source.manual_review_reason, 1000);

els.sourceOfFundsSummary.value = cleanText(source.source_of_funds_summary, 1000);
els.sourceOfWealthSummary.value = cleanText(source.source_of_wealth_summary, 1000);
els.notes.value = cleanText(source.notes, 2000);

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
const wallet = cleanText(els.walletAddress.value, 120);

return {
wallet,
mode: state.mode,
profile_type: cleanText(els.profileType.value, 32) || "individual",
country_code: cleanText(els.countryCode.value, 8).toUpperCase(),
legal_name: cleanText(els.legalName.value, 200),
display_name: cleanText(els.displayName.value, 200),

entity_name: cleanText(els.entityName.value, 200),
entity_type: cleanText(els.entityType.value, 120),
entity_registration_number: cleanText(els.entityRegistrationNumber.value, 120),

email: cleanText(els.email.value, 200),
phone: cleanText(els.phone.value, 60),
date_of_birth: cleanText(els.dateOfBirth.value, 40),

risk_rating: cleanText(els.riskRating.value, 32) || "low",

pep_status: toBool(els.pepStatus.checked),
sanctions_status: toBool(els.sanctionsStatus.checked),
manual_review_required: toBool(els.manualReviewRequired.checked),
manual_review_reason: cleanText(els.manualReviewReason.value, 1000),

source_of_funds_summary: cleanText(els.sourceOfFundsSummary.value, 1000),
source_of_wealth_summary: cleanText(els.sourceOfWealthSummary.value, 1000),

notes: cleanText(els.notes.value, 2000),

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

async function loadStatus({ showBannerOnMissing = false } = {}) {
const wallet = cleanText(els.walletAddress.value, 120);

if (!wallet) {
updateStatusUi(null);
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
)}`
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
const wallet = cleanText(els.walletAddress.value, 120);

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
profile_type: cleanText(els.profileType.value, 32) || "individual",
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

async function connectWallet() {
if (!window.solana?.isPhantom) {
setBanner(
"Phantom wallet was not detected. You can still paste a wallet address manually.",
"warn"
);
return;
}

try {
const response = await window.solana.connect();
const wallet = cleanText(response?.publicKey?.toString(), 120);
if (!wallet) {
throw new Error("Wallet connection did not return an address.");
}

els.walletAddress.value = wallet;
state.wallet = wallet;
clearBanner();
await loadStatus();
} catch (error) {
setBanner(error?.message || "Failed to connect wallet.", "bad");
}
}

function bindModeButtons() {
[els.modeParticipantButton, els.modeBuilderButton].forEach((button) => {
button.addEventListener("click", async () => {
const nextMode = cleanText(button.dataset.mode, 32).toLowerCase();
if (!nextMode || nextMode === state.mode) return;

state.mode = nextMode === "builder" ? "builder" : "participant";
updateModeUi();

if (cleanText(els.walletAddress.value, 120)) {
await loadStatus();
} else {
updateStatusUi(null);
}
});
});
}

function bindCollections() {
els.addBeneficialOwnerButton.addEventListener("click", () => {
appendCollectionCard(els.beneficialOwnersCollection, els.beneficialOwnerTemplate);
});

els.addRepresentativeButton.addEventListener("click", () => {
appendCollectionCard(
els.authorisedRepresentativesCollection,
els.representativeTemplate
);
});
}

function bindInputs() {
els.profileType.addEventListener("change", updateModeUi);

els.loadStatusButton.addEventListener("click", () =>
loadStatus({ showBannerOnMissing: true })
);

els.startComplianceButton.addEventListener("click", startCompliance);
els.complianceForm.addEventListener("submit", submitCompliance);
els.connectWalletButton.addEventListener("click", connectWallet);
}

async function init() {
state.mode = getUrlMode();
updateModeUi();
bindModeButtons();
bindCollections();
bindInputs();

const urlWallet = getUrlWallet();
if (urlWallet) {
els.walletAddress.value = urlWallet;
state.wallet = urlWallet;
await loadStatus();
} else {
updateStatusUi({
wallet: "",
profile: null,
status: "not_started",
risk_rating: "low",
transactional_access: false,
builder_gate_enabled: false,
participant_gate_enabled: false,
restricted_jurisdiction: false,
});
}
}

init().catch((error) => {
console.error("Failed to initialize compliance page", error);
setBanner(error?.message || "Failed to initialize compliance page.", "bad");
});
