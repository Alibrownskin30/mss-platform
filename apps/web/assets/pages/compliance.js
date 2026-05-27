import {
connectWallet as connectAnyWallet,
disconnectWallet as disconnectAnyWallet,
getConnectedWallet,
getConnectedPublicKey,
onWalletChange,
restoreWalletIfTrusted,
getMobileWalletHelpText,
} from "../wallet.js";

const PARTICIPANT_ROLE = "participant";
const BUILDER_ROLE = "builder";
const VALID_ROLES = new Set([PARTICIPANT_ROLE, BUILDER_ROLE]);

const ACKNOWLEDGEMENT_FIELDS = Object.freeze({
participant: [
{
id: "ackLauncherTerms",
key: "terms_accepted",
timestampKey: "accepted_terms_at",
label: "I accept the MSS Launcher Terms for participating in this launch.",
error: "Accept the MSS Launcher Terms before continuing.",
},
{
id: "ackLaunchRiskDisclosure",
key: "risk_disclosure_accepted",
timestampKey: "accepted_risk_disclosure_at",
label:
"I understand crypto launches carry significant risk and outcomes are not guaranteed.",
error: "Accept the launch risk disclosure before continuing.",
},
{
id: "ackLaunchRules",
key: "launch_rules_accepted",
timestampKey: "accepted_launch_rules_at",
label:
"I accept the launch rules, allocation conditions and transaction conditions.",
error: "Accept the launch rules and transaction conditions before continuing.",
},
{
id: "ackLaunchNoAdvice",
key: "no_advice_accepted",
timestampKey: "accepted_no_advice_at",
label:
"I understand MSS provides information and infrastructure only, not investment advice.",
error: "Accept the information-only acknowledgement before continuing.",
},
],
builder: [
{
id: "ackLauncherTerms",
key: "terms_accepted",
timestampKey: "accepted_terms_at",
label: "I accept the MSS Launcher Terms for creating this launch.",
error: "Accept the MSS Launcher Terms before continuing.",
},
{
id: "ackLaunchRiskDisclosure",
key: "risk_disclosure_accepted",
timestampKey: "accepted_risk_disclosure_at",
label:
"I understand crypto launches carry significant risk and outcomes are not guaranteed.",
error: "Accept the launch risk disclosure before continuing.",
},
{
id: "ackLaunchRules",
key: "launch_rules_accepted",
timestampKey: "accepted_launch_rules_at",
label:
"I accept the launch rules, allocation conditions, Builder Bond rules and transaction conditions.",
error: "Accept the launch rules and transaction conditions before continuing.",
},
{
id: "ackLaunchNoAdvice",
key: "no_advice_accepted",
timestampKey: "accepted_no_advice_at",
label:
"I understand MSS provides information and infrastructure only, not investment advice.",
error: "Accept the information-only acknowledgement before continuing.",
},
{
id: "ackProjectDisclosure",
key: "project_disclosure_accepted",
timestampKey: "accepted_project_disclosure_at",
label:
"I confirm the project information and declared team wallets supplied are accurate.",
error: "Accept the project information disclosure before continuing.",
},
{
id: "ackProhibitedConduct",
key: "prohibited_conduct_accepted",
timestampKey: "accepted_prohibited_conduct_at",
label:
"I agree not to engage in misleading conduct, undisclosed wallet activity or market manipulation.",
error: "Accept the prohibited conduct acknowledgement before continuing.",
},
],
});

const state = {
mode: PARTICIPANT_ROLE,
wallet: "",
launchId: null,
statusPayload: null,
isSubmitting: false,
statusRequestId: 0,
acknowledgementDrafts: {
participant: {},
builder: {},
},
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
startComplianceButton: document.getElementById("startComplianceButton"),

accessReasonValue: document.getElementById("accessReasonValue"),
modeBucketValue: document.getElementById("modeBucketValue"),
builderBucketValue: document.getElementById("builderBucketValue"),
participantBucketValue: document.getElementById("participantBucketValue"),
jurisdictionBucketValue: document.getElementById("jurisdictionBucketValue"),

blockingSignalsList: document.getElementById("blockingSignalsList"),
blockingSignalsSection: document.getElementById("blockingSignalsSection"),
escalationSignalsList: document.getElementById("escalationSignalsList"),
escalationSignalsSection: document.getElementById("escalationSignalsSection"),

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
authorisedRepresentativesSection: document.getElementById(
"authorisedRepresentativesSection"
),
addBeneficialOwnerButton: document.getElementById("addBeneficialOwnerButton"),
addRepresentativeButton: document.getElementById("addRepresentativeButton"),
};

function $(id) {
return document.getElementById(id);
}

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max);
}

function normalizeRole(value, fallback = PARTICIPANT_ROLE) {
const normalized = cleanText(value, 32).toLowerCase();
return VALID_ROLES.has(normalized) ? normalized : fallback;
}

function normalizeLaunchId(value) {
if (value === undefined || value === null || String(value).trim() === "") {
return null;
}

const launchId = Number.parseInt(value, 10);
return Number.isFinite(launchId) && launchId > 0 ? launchId : null;
}

function shortenWallet(wallet) {
const value = cleanText(wallet, 200);

if (!value) return "Not connected";
if (value.length <= 14) return value;

return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function escapeHtml(value) {
return String(value ?? "")
.replaceAll("&", "&amp;")
.replaceAll("<", "&lt;")
.replaceAll(">", "&gt;")
.replaceAll('"', "&quot;")
.replaceAll("'", "&#039;");
}

function setText(element, value) {
if (element) {
element.textContent = value;
}
}

function setHtml(element, value) {
if (element) {
element.innerHTML = value;
}
}

function setHidden(element, hidden) {
if (!element) return;
element.classList.toggle("hidden", Boolean(hidden));
}

function getSubmitButton() {
return (
document.getElementById("submitComplianceButton") ||
document.getElementById("recordAcknowledgementsButton")
);
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

if (port === "3000") {
return `${protocol}//${hostname}:8787`;
}

if (
hostname === "127.0.0.1" ||
hostname === "localhost" ||
hostname === "[::1]"
) {
return `${protocol}//${hostname}:8787`;
}

if (hostname.includes("-3000.app.github.dev")) {
return `${protocol}//${hostname.replace(
"-3000.app.github.dev",
"-8787.app.github.dev"
)}`;
}

if (hostname.includes("-3001.app.github.dev")) {
return `${protocol}//${hostname.replace(
"-3001.app.github.dev",
"-8787.app.github.dev"
)}`;
}

if (hostname.includes("-4173.app.github.dev")) {
return `${protocol}//${hostname.replace(
"-4173.app.github.dev",
"-8787.app.github.dev"
)}`;
}

return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
}

const API_BASE = getApiBase();

class ApiRequestError extends Error {
constructor(message, status = 500, payload = null) {
super(message || "Request failed.");
this.name = "ApiRequestError";
this.status = Number(status || 500);
this.payload = payload || null;
this.code = cleanText(payload?.code, 120);
}
}

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

if (!response.ok || payload?.ok === false) {
throw new ApiRequestError(
payload?.error ||
payload?.message ||
`Request failed (${response.status})`,
response.status,
payload
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

function getRequiredFields(role = state.mode) {
const normalizedRole = normalizeRole(role);
return ACKNOWLEDGEMENT_FIELDS[normalizedRole];
}

function getRoleDisplayName(role = state.mode) {
return normalizeRole(role) === BUILDER_ROLE ? "Builder" : "Participant";
}

function isWalletBlocked(payload = null) {
if (!payload) return false;

const accessState = cleanText(payload.access_state, 40).toLowerCase();
const blockingSignals = Array.isArray(payload.blocking_signals)
? payload.blocking_signals
: [];

return Boolean(
payload.internal_intervention_active ||
accessState === "blocked" ||
blockingSignals.some((signal) => signal?.blocking === true)
);
}

function isAcknowledgementAccepted(payload = null) {
return Boolean(payload?.acknowledgement_accepted);
}

function resolveAccessState(payload = null) {
if (!state.wallet) return "wallet_required";
if (isWalletBlocked(payload)) return "blocked";
if (isAcknowledgementAccepted(payload)) return "acknowledged";
return "acknowledgement_required";
}

function formatAccessLabel(accessState = "") {
switch (cleanText(accessState, 40).toLowerCase()) {
case "blocked":
return "Wallet Blocked";
case "acknowledged":
return "Terms Recorded";
case "acknowledgement_required":
return "Acknowledgement Required";
case "wallet_required":
default:
return "Connect Wallet";
}
}

function getAccessVariant(payload = null) {
const accessState = resolveAccessState(payload);

if (accessState === "blocked") return "bad";
if (
accessState === "wallet_required" ||
accessState === "acknowledgement_required"
) {
return "warn";
}

return "good";
}

function getPrimaryReason(payload = null) {
const accessState = resolveAccessState(payload);
const serverReason = cleanText(payload?.access_reason, 1000);

if (accessState === "blocked") {
return (
serverReason ||
"This wallet is currently unable to use Launcher transactions. Contact support if you believe this is an error."
);
}

if (accessState === "acknowledged") {
return state.mode === BUILDER_ROLE
? "Required Builder Launcher acknowledgements have been recorded. No identity verification or KYC is required for this flow."
: "Required Participant Launcher acknowledgements have been recorded. No identity verification or KYC is required for this flow.";
}

if (accessState === "acknowledgement_required") {
return state.mode === BUILDER_ROLE
? "No identity verification or KYC is required. Accept the Launcher terms, risk disclosures and builder conduct requirements before creating a launch."
: "No identity verification or KYC is required. Accept the Launcher terms and risk disclosures before committing to a launch.";
}

return "Connect a wallet to review Launcher transaction access and record the required acknowledgements.";
}

function getReturnHref() {
const params = new URLSearchParams(window.location.search);
const suppliedReturnTo = cleanText(params.get("returnTo"), 500);

if (
suppliedReturnTo &&
(suppliedReturnTo.startsWith("./") ||
suppliedReturnTo.startsWith("/")) &&
!suppliedReturnTo.startsWith("//") &&
!suppliedReturnTo.toLowerCase().includes("javascript:")
) {
return suppliedReturnTo;
}

if (state.mode === BUILDER_ROLE) {
return "./launch-create.html";
}

if (state.launchId) {
return `./launch-detail.html?id=${encodeURIComponent(state.launchId)}`;
}

return "./launchpad.html";
}

function getReturnLabel() {
if (state.mode === BUILDER_ROLE) {
return "Return to Launch Creator";
}

if (state.launchId) {
return "Return to Launch";
}

return "Return to Launchpad";
}

function getUrlMode() {
const params = new URLSearchParams(window.location.search);
return normalizeRole(params.get("mode") || params.get("role"));
}

function getUrlWallet() {
return cleanText(
new URLSearchParams(window.location.search).get("wallet"),
120
);
}

function getUrlLaunchId() {
const params = new URLSearchParams(window.location.search);

return normalizeLaunchId(
params.get("launchId") ||
params.get("launch_id") ||
params.get("id")
);
}

function updateUrlState() {
const url = new URL(window.location.href);

url.searchParams.set("mode", state.mode);

if (state.wallet) {
url.searchParams.set("wallet", state.wallet);
} else {
url.searchParams.delete("wallet");
}

if (state.launchId) {
url.searchParams.set("launchId", String(state.launchId));
} else {
url.searchParams.delete("launchId");
}

window.history.replaceState({}, "", url.toString());
}

function rewriteLegacyPageCopy() {
const title = document.querySelector(".hero-panel h1");
const heroCopy = document.querySelector(".hero-panel > p");
const formTitle = document.querySelector(".form-header .section-title");
const formCopy = document.querySelector(".form-header .section-copy");

document.title = "MSS Protocol — Launcher Acknowledgements";

const description = document.querySelector('meta[name="description"]');
if (description) {
description.setAttribute(
"content",
"Record MSS Protocol Launcher acknowledgements for builder and participant transaction flows."
);
}

setText(title, "Launcher acknowledgements and wallet access.");
setText(
heroCopy,
"MSS Launcher uses a low-friction acknowledgement-only transaction flow. No identity verification or KYC is required by default. Wallet transactions remain subject to internal intervention where a genuine risk block is active."
);

setText(formTitle, "Launcher acknowledgements");
setText(
formCopy,
"Select participant or builder mode, connect your wallet, then record the acknowledgements required for that transaction flow."
);

const heroModelValue = document.querySelector(
".hero-point:nth-child(2) .hero-point-value"
);

if (heroModelValue) {
heroModelValue.textContent = "Acknowledgement only";
}
}

function hideLegacyElement(element) {
if (!element) return;

const wrapper =
element.closest(".subsection") ||
element.closest(".field-grid") ||
element.closest(".checkbox-row") ||
element.closest(".field") ||
element;

setHidden(wrapper, true);
}

function suppressLegacyVerificationUi() {
[
els.profileType,
els.countryCode,
els.legalName,
els.displayName,
els.entityName,
els.entityType,
els.entityRegistrationNumber,
els.email,
els.phone,
els.dateOfBirth,
els.riskRating,
els.pepStatus,
els.sanctionsStatus,
els.manualReviewRequired,
els.manualReviewReason,
els.sourceOfFundsSummary,
els.sourceOfWealthSummary,
els.notes,
].forEach(hideLegacyElement);

setHidden(els.entityFields, true);
setHidden(els.beneficialOwnersSection, true);
setHidden(els.authorisedRepresentativesSection, true);
setHidden(els.addBeneficialOwnerButton, true);
setHidden(els.addRepresentativeButton, true);
setHidden(els.startComplianceButton, true);

setHidden(els.escalationSignalsSection, true);
setHtml(els.escalationSignalsList, "");

if (els.loadStatusButton) {
els.loadStatusButton.textContent = "Check Wallet Status";
}
}

function ensureAcknowledgementPanel() {
const form = els.complianceForm;
if (!form) return;

let panel = $("launcherAcknowledgementPanel");

if (!panel) {
panel = document.createElement("section");
panel.id = "launcherAcknowledgementPanel";
panel.className = "subsection launcher-acknowledgement-panel";

panel.innerHTML = `
<div>
<h3 id="launcherAcknowledgementTitle">Terms and risk acknowledgement</h3>
<p id="launcherAcknowledgementCopy">
No identity verification or KYC is required for this flow. Confirm the required Launcher acknowledgements below before continuing.
</p>
</div>

<div
id="launcherAcknowledgementFields"
class="checkbox-row launcher-acknowledgement-fields"
></div>

<div
id="launcherAcknowledgementAcceptedNote"
class="banner hidden"
style="margin-top: 16px; margin-bottom: 0;"
></div>

<div
id="launcherAcknowledgementReturnWrap"
class="footer-actions hidden"
style="margin-top: 16px;"
>
<a
id="launcherAcknowledgementReturnAction"
class="button button-primary"
href="./launchpad.html"
>
Return to Launchpad
</a>
</div>
`;

const footerActions = form.querySelector(".footer-actions");

if (footerActions?.parentNode) {
footerActions.parentNode.insertBefore(panel, footerActions);
} else {
form.appendChild(panel);
}
}

if (!getSubmitButton()) {
const button = document.createElement("button");
button.id = "recordAcknowledgementsButton";
button.className = "button button-primary";
button.type = "submit";
button.textContent = "Record Acknowledgements";

const actions = document.createElement("div");
actions.className = "footer-actions";
actions.appendChild(button);

form.appendChild(actions);
}
}

function captureAcknowledgementDraft() {
const draft = {};

for (const field of getRequiredFields()) {
const input = $(field.id);

if (input) {
draft[field.key] = Boolean(input.checked);
}
}

state.acknowledgementDrafts[state.mode] = draft;
}

function getStoredAcknowledgementValue(field, payload = state.statusPayload) {
if (isAcknowledgementAccepted(payload)) return true;

const acknowledgement = payload?.acknowledgement || null;

return Boolean(
acknowledgement &&
field.timestampKey &&
acknowledgement[field.timestampKey]
);
}

function renderAcknowledgementFields() {
const container = $("launcherAcknowledgementFields");
if (!container) return;

const requiredFields = getRequiredFields();
const draft = state.acknowledgementDrafts[state.mode] || {};
const blocked = isWalletBlocked(state.statusPayload);
const accepted = isAcknowledgementAccepted(state.statusPayload);

container.innerHTML = requiredFields
.map((field) => {
const checked =
accepted ||
getStoredAcknowledgementValue(field) ||
Boolean(draft[field.key]);

return `
<label class="checkbox launcher-acknowledgement-row">
<input
id="${escapeHtml(field.id)}"
data-acknowledgement-key="${escapeHtml(field.key)}"
type="checkbox"
${checked ? "checked" : ""}
${accepted || blocked ? "disabled" : ""}
/>
<span>${escapeHtml(field.label)}</span>
</label>
`;
})
.join("");

for (const field of requiredFields) {
const input = $(field.id);

if (!input) continue;

input.addEventListener("change", () => {
captureAcknowledgementDraft();
clearBanner();
});
}
}

function collectAcknowledgements() {
const acknowledgements = {};

for (const field of getRequiredFields()) {
acknowledgements[field.key] = Boolean($(field.id)?.checked);
}

return acknowledgements;
}

function validateAcknowledgements() {
const acknowledgements = collectAcknowledgements();

for (const field of getRequiredFields()) {
if (!acknowledgements[field.key]) {
throw new Error(field.error);
}
}

return acknowledgements;
}

function renderBlockingSignals(payload = null) {
const signals = Array.isArray(payload?.blocking_signals)
? payload.blocking_signals.filter((signal) => signal?.blocking === true)
: [];

if (!els.blockingSignalsList || !els.blockingSignalsSection) {
return;
}

if (!isWalletBlocked(payload) || !signals.length) {
setHidden(els.blockingSignalsSection, true);
setHtml(els.blockingSignalsList, "");
return;
}

const markup = signals
.map((signal) => {
const message =
cleanText(signal?.message, 500) ||
"This wallet is currently unable to use Launcher transactions.";

return `
<div class="signal-item severity-high">
<div class="signal-item-top">
<strong>Transaction Access</strong>
<span>Internal Intervention</span>
</div>
<div class="signal-item-copy">${escapeHtml(message)}</div>
</div>
`;
})
.join("");

setHtml(els.blockingSignalsList, markup);
setHidden(els.blockingSignalsSection, false);
}

function renderAcceptedReturnAction(payload = null) {
const note = $("launcherAcknowledgementAcceptedNote");
const returnWrap = $("launcherAcknowledgementReturnWrap");
const action = $("launcherAcknowledgementReturnAction");

const accepted = isAcknowledgementAccepted(payload);
const blocked = isWalletBlocked(payload);

if (note) {
note.className = "banner";

if (blocked) {
note.classList.add("show", "bad");
note.textContent =
"Launcher transactions are unavailable for this wallet. Contact support if you believe this is an error.";
} else if (accepted) {
note.classList.add("show", "good");
note.textContent =
"Required Launcher acknowledgements have been recorded for this wallet.";
} else {
note.classList.add("hidden");
note.textContent = "";
}
}

if (action) {
action.href = getReturnHref();
action.textContent = getReturnLabel();
}

if (returnWrap) {
returnWrap.classList.toggle("hidden", !accepted || blocked);
}
}

function updateSubmitButtonState() {
const submitButton = getSubmitButton();
if (!submitButton) return;

const blocked = isWalletBlocked(state.statusPayload);
const accepted = isAcknowledgementAccepted(state.statusPayload);

submitButton.disabled =
state.isSubmitting || !state.wallet || blocked || accepted;

if (accepted) {
submitButton.textContent = "Acknowledgements Recorded";
return;
}

submitButton.textContent =
state.mode === BUILDER_ROLE
? "Record Builder Acknowledgements"
: "Record Participant Acknowledgements";
}

function updateModeUi() {
const isBuilder = state.mode === BUILDER_ROLE;

els.modeParticipantButton?.classList.toggle("active", !isBuilder);
els.modeBuilderButton?.classList.toggle("active", isBuilder);

setText(els.complianceModeChip, isBuilder ? "Builder" : "Participant");
setText(
els.heroAccessScope,
isBuilder
? "Builder Launcher acknowledgements"
: "Participant Launcher acknowledgements"
);
setText(els.summaryModeValue, isBuilder ? "Builder" : "Participant");

setText(
$("launcherAcknowledgementTitle"),
isBuilder
? "Builder terms and conduct acknowledgement"
: "Participant terms and risk acknowledgement"
);

setText(
$("launcherAcknowledgementCopy"),
isBuilder
? "No identity verification or KYC is required for this flow. Confirm the Launcher terms, risk disclosures and builder conduct requirements before creating a launch."
: "No identity verification or KYC is required for this flow. Confirm the Launcher terms and risk disclosures before committing to a launch."
);

renderAcknowledgementFields();
renderAcceptedReturnAction(state.statusPayload);
updateSubmitButtonState();
}

function updateStatusUi(statusPayload = null) {
state.statusPayload = statusPayload || null;

const payloadWallet = cleanText(statusPayload?.wallet, 120);

if (payloadWallet) {
state.wallet = payloadWallet;
}

const variant = getAccessVariant(statusPayload);
const accessState = resolveAccessState(statusPayload);
const accessLabel = formatAccessLabel(accessState);
const reason = getPrimaryReason(statusPayload);
const blocked = isWalletBlocked(statusPayload);

if (els.statusPill) {
els.statusPill.className = `status-pill ${variant}`;
els.statusPill.textContent = accessLabel;
}

setText(els.heroCurrentStage, accessLabel);
setText(els.summaryOutcomeValue, accessLabel);
setText(els.walletStatusCopy, reason);

setText(els.walletValue, shortenWallet(statusPayload?.wallet || state.wallet));
setText(els.countryValue, "Not Required");
setText(els.riskValue, blocked ? "Restricted" : "Not Required");
setText(els.accessValue, accessLabel);

setText(els.builderGateValue, "Acknowledgement Only");
setText(els.participantGateValue, "Acknowledgement Only");

setText(els.modeBucketValue, blocked ? "Blocked" : "Acknowledgement Only");
setText(els.builderBucketValue, "No KYC");
setText(els.participantBucketValue, "No KYC");
setText(els.jurisdictionBucketValue, "Not Collected");
setText(els.accessReasonValue, reason);

renderBlockingSignals(statusPayload);

setHidden(els.escalationSignalsSection, true);
setHtml(els.escalationSignalsList, "");

renderAcknowledgementFields();
renderAcceptedReturnAction(statusPayload);
updateSubmitButtonState();
}

function setLoadingState(isLoading) {
state.isSubmitting = Boolean(isLoading);

if (els.loadStatusButton) {
els.loadStatusButton.disabled = state.isSubmitting;
}

if (els.connectWalletButton) {
els.connectWalletButton.disabled = state.isSubmitting;
}

if (els.modeParticipantButton) {
els.modeParticipantButton.disabled = state.isSubmitting;
}

if (els.modeBuilderButton) {
els.modeBuilderButton.disabled = state.isSubmitting;
}

updateSubmitButtonState();
}

function buildEmptyStatusPayload(message = "") {
return {
ok: true,
wallet: state.wallet || null,
role: state.mode,
mode: state.mode,
launch_id: state.launchId,
compliance_model: "acknowledgement_only",
model: "acknowledgement_only",
identity_verification_required: false,
kyc_required: false,
kyb_required: false,
acknowledgement_required: true,
acknowledgement_accepted: false,
internal_intervention_active: false,
access_state: state.wallet
? "acknowledgement_required"
: "wallet_required",
access_reason:
message ||
(state.wallet
? "Accept the required Launcher acknowledgements before continuing."
: "Connect a wallet to review Launcher access."),
transactional_access: false,
allowed: false,
blocking_signals: [],
escalation_signals: [],
profile: null,
};
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
els.connectWalletButton.textContent = `Disconnect ${shortenWallet(
connectedWallet
)}`;
} else {
els.connectWalletButton.textContent = "Connect Wallet";
}
}

async function loadStatus({ showBannerOnMissing = false } = {}) {
const wallet = cleanText(els.walletAddress?.value || state.wallet, 120);

if (!wallet) {
state.wallet = "";
state.statusPayload = null;

updateStatusUi(
buildEmptyStatusPayload("Connect or paste a wallet address first.")
);

if (showBannerOnMissing) {
setBanner("Connect or paste a wallet address first.", "warn");
} else {
clearBanner();
}

return null;
}

state.wallet = wallet;
updateUrlState();

const requestId = ++state.statusRequestId;
setLoadingState(true);

try {
const query = new URLSearchParams({
wallet,
role: state.mode,
mode: state.mode,
context: state.mode,
surface: "compliance",
});

if (state.launchId) {
query.set("launchId", String(state.launchId));
}

const payload = await apiFetch(`/api/compliance/status?${query.toString()}`);

if (requestId !== state.statusRequestId) {
return null;
}

updateStatusUi(payload);
clearBanner();

return payload;
} catch (error) {
if (requestId !== state.statusRequestId) {
return null;
}

setBanner(
error?.message || "Failed to load Launcher acknowledgement status.",
"bad"
);

updateStatusUi(
buildEmptyStatusPayload(
"Wallet status could not be loaded. Try checking the wallet again."
)
);

return null;
} finally {
if (requestId === state.statusRequestId) {
setLoadingState(false);
}
}
}

async function submitAcknowledgements(event) {
event?.preventDefault();

const wallet = cleanText(els.walletAddress?.value || state.wallet, 120);

if (!wallet) {
setBanner("Connect or paste a wallet address before continuing.", "warn");
return;
}

state.wallet = wallet;

if (isWalletBlocked(state.statusPayload)) {
setBanner(
"This wallet is currently unable to use Launcher transactions. Contact support if you believe this is an error.",
"bad"
);
return;
}

let acknowledgements;

try {
acknowledgements = validateAcknowledgements();
} catch (error) {
setBanner(error?.message || "Accept the required acknowledgements.", "warn");
return;
}

setLoadingState(true);

try {
const payload = {
wallet,
role: state.mode,
mode: state.mode,
context: state.mode,
action:
state.mode === BUILDER_ROLE
? "builder_acknowledgement_submit"
: "participant_acknowledgement_submit",
acknowledgements,
};

if (state.launchId) {
payload.launchId = state.launchId;
}

const response = await apiFetch("/api/compliance/submit", {
method: "POST",
body: JSON.stringify(payload),
});

state.acknowledgementDrafts[state.mode] = {
...acknowledgements,
};

updateStatusUi(response);
updateUrlState();

if (isWalletBlocked(response)) {
setBanner(
"Acknowledgements were recorded, but this wallet is currently unable to use Launcher transactions.",
"bad"
);
return;
}

setBanner(
state.mode === BUILDER_ROLE
? "Builder Launcher acknowledgements recorded. Return to the launch creator to continue."
: "Participant Launcher acknowledgements recorded. Return to the launch to continue.",
"good"
);
} catch (error) {
const payload = error?.payload || null;

if (isWalletBlocked(payload)) {
updateStatusUi(payload);

setBanner(
payload?.error ||
"This wallet is currently unable to use Launcher transactions.",
"bad"
);

return;
}

setBanner(
error?.message || "Failed to save Launcher acknowledgements.",
"bad"
);
} finally {
setLoadingState(false);
}
}

async function handleConnectWallet() {
const connectedWallet = cleanText(getConnectedPublicKey() || "", 120);

if (connectedWallet) {
try {
await disconnectAnyWallet();

state.wallet = "";
state.statusPayload = null;
state.statusRequestId += 1;

if (els.walletAddress) {
els.walletAddress.value = "";
}

syncWalletUi();
updateUrlState();
updateStatusUi(buildEmptyStatusPayload("Wallet disconnected."));
setBanner("Wallet disconnected.", "warn");

return;
} catch (error) {
setBanner(error?.message || "Failed to disconnect wallet.", "bad");
return;
}
}

try {
const wallet = await connectAnyWallet();
const address = cleanText(
wallet?.publicKey || getConnectedPublicKey() || "",
120
);

if (!address) {
throw new Error("Wallet connection did not return an address.");
}

state.wallet = address;

if (els.walletAddress) {
els.walletAddress.value = address;
}

syncWalletUi();
updateUrlState();
clearBanner();

await loadStatus();
} catch (error) {
const message = error?.message || "Failed to connect wallet.";

setBanner(
message.includes("No supported wallet")
? getMobileWalletHelpText()
: message,
"bad"
);
}
}

function bindModeButtons() {
[els.modeParticipantButton, els.modeBuilderButton]
.filter(Boolean)
.forEach((button) => {
if (button.dataset.bound === "1") return;
button.dataset.bound = "1";

button.addEventListener("click", async () => {
if (state.isSubmitting) return;

captureAcknowledgementDraft();

const requestedMode = normalizeRole(button.dataset.mode);

if (requestedMode === state.mode) return;

state.mode = requestedMode;
state.statusPayload = null;

updateUrlState();
updateModeUi();

if (state.wallet || cleanText(els.walletAddress?.value, 120)) {
await loadStatus();
} else {
updateStatusUi(
buildEmptyStatusPayload("Connect a wallet to review Launcher access.")
);
}
});
});
}

function bindInputs() {
if (els.loadStatusButton && els.loadStatusButton.dataset.bound !== "1") {
els.loadStatusButton.dataset.bound = "1";

els.loadStatusButton.addEventListener("click", () => {
void loadStatus({ showBannerOnMissing: true });
});
}

if (els.complianceForm && els.complianceForm.dataset.bound !== "1") {
els.complianceForm.dataset.bound = "1";
els.complianceForm.addEventListener("submit", submitAcknowledgements);
}

if (
els.connectWalletButton &&
els.connectWalletButton.dataset.bound !== "1"
) {
els.connectWalletButton.dataset.bound = "1";
els.connectWalletButton.addEventListener("click", handleConnectWallet);
}

if (els.walletAddress && els.walletAddress.dataset.bound !== "1") {
els.walletAddress.dataset.bound = "1";

els.walletAddress.addEventListener("input", () => {
const nextWallet = cleanText(els.walletAddress?.value, 120);

if (nextWallet === state.wallet) return;

state.wallet = nextWallet;
state.statusPayload = null;
state.statusRequestId += 1;

updateUrlState();

updateStatusUi(
buildEmptyStatusPayload(
state.wallet
? "Check wallet status, then accept the required Launcher acknowledgements."
: "Connect a wallet to review Launcher access."
)
);
});
}
}

function bindWalletSync() {
onWalletChange(async () => {
syncWalletUi();

const wallet = cleanText(getConnectedPublicKey() || "", 120);

if (!wallet) {
state.wallet = "";
state.statusPayload = null;
state.statusRequestId += 1;

if (els.walletAddress) {
els.walletAddress.value = "";
}

updateUrlState();
updateStatusUi(buildEmptyStatusPayload("Wallet disconnected."));
return;
}

state.wallet = wallet;

if (els.walletAddress) {
els.walletAddress.value = wallet;
}

updateUrlState();

try {
await loadStatus();
} catch {
// loadStatus surfaces the user-facing status.
}
});
}

async function init() {
state.mode = getUrlMode();
state.launchId = getUrlLaunchId();

rewriteLegacyPageCopy();
suppressLegacyVerificationUi();
ensureAcknowledgementPanel();

updateModeUi();
bindModeButtons();
bindInputs();
bindWalletSync();

await restoreWalletIfTrusted().catch(() => {});

syncWalletUi();

const connectedWallet = cleanText(getConnectedPublicKey() || "", 120);
const urlWallet = getUrlWallet();
const initialWallet = urlWallet || connectedWallet;

if (initialWallet) {
state.wallet = initialWallet;

if (els.walletAddress) {
els.walletAddress.value = initialWallet;
}

updateUrlState();
await loadStatus();
} else {
updateStatusUi(
buildEmptyStatusPayload(
"Connect a wallet to review Launcher access and record the required acknowledgements."
)
);
}
}

init().catch((error) => {
console.error("Failed to initialize Launcher acknowledgement page", error);

setBanner(
error?.message || "Failed to initialize Launcher acknowledgement page.",
"bad"
);
});
