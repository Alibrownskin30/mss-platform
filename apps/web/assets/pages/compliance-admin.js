const state = {
cases: [],
selectedCaseId: null,
selectedCase: null,
loading: false,
filters: {
status: "",
caseType: "",
riskLevel: "",
assignedTo: "",
},
};

const els = {
queueCountChip: document.getElementById("queueCountChip"),
apiStatusChip: document.getElementById("apiStatusChip"),
refreshCasesButton: document.getElementById("refreshCasesButton"),

heroFilterValue: document.getElementById("heroFilterValue"),
heroSelectedValue: document.getElementById("heroSelectedValue"),
heroReviewStateValue: document.getElementById("heroReviewStateValue"),

openCountValue: document.getElementById("openCountValue"),
escalatedCountValue: document.getElementById("escalatedCountValue"),
resolvedCountValue: document.getElementById("resolvedCountValue"),

banner: document.getElementById("banner"),

filterStatus: document.getElementById("filterStatus"),
filterCaseType: document.getElementById("filterCaseType"),
filterRiskLevel: document.getElementById("filterRiskLevel"),
filterAssignedTo: document.getElementById("filterAssignedTo"),
applyFiltersButton: document.getElementById("applyFiltersButton"),

casesTableBody: document.getElementById("casesTableBody"),

caseDetailEmpty: document.getElementById("caseDetailEmpty"),
caseDetailPanel: document.getElementById("caseDetailPanel"),

detailCaseId: document.getElementById("detailCaseId"),
detailCaseType: document.getElementById("detailCaseType"),
detailStatus: document.getElementById("detailStatus"),
detailRisk: document.getElementById("detailRisk"),
detailReviewReason: document.getElementById("detailReviewReason"),

detailWallet: document.getElementById("detailWallet"),
detailProfileType: document.getElementById("detailProfileType"),
detailProfileStatus: document.getElementById("detailProfileStatus"),
detailProfileRisk: document.getElementById("detailProfileRisk"),
detailCountry: document.getElementById("detailCountry"),
detailManualReview: document.getElementById("detailManualReview"),
detailProfileName: document.getElementById("detailProfileName"),

detailLaunchName: document.getElementById("detailLaunchName"),
detailLaunchStatus: document.getElementById("detailLaunchStatus"),
detailLaunchTemplate: document.getElementById("detailLaunchTemplate"),
detailBuilderWallet: document.getElementById("detailBuilderWallet"),

assignedToInput: document.getElementById("assignedToInput"),
actionNotes: document.getElementById("actionNotes"),
escalationRiskLevel: document.getElementById("escalationRiskLevel"),

approveCaseButton: document.getElementById("approveCaseButton"),
rejectCaseButton: document.getElementById("rejectCaseButton"),
freezeCaseButton: document.getElementById("freezeCaseButton"),
escalateCaseButton: document.getElementById("escalateCaseButton"),
assignCaseButton: document.getElementById("assignCaseButton"),
};

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max);
}

function shortenWallet(wallet) {
const value = cleanText(wallet, 200);
if (!value) return "—";
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

function setLoading(isLoading) {
state.loading = Boolean(isLoading);
els.apiStatusChip.textContent = isLoading ? "Loading" : "Ready";

[
els.refreshCasesButton,
els.applyFiltersButton,
els.approveCaseButton,
els.rejectCaseButton,
els.freezeCaseButton,
els.escalateCaseButton,
els.assignCaseButton,
].forEach((button) => {
if (button) button.disabled = isLoading;
});
}

function getStatusVariant(status) {
const normalized = cleanText(status, 32).toLowerCase();
if (normalized === "approved") return "good";
if (normalized === "rejected" || normalized === "restricted" || normalized === "frozen") {
return "bad";
}
return "warn";
}

function getRiskVariant(riskLevel) {
const normalized = cleanText(riskLevel, 32).toLowerCase();
if (normalized === "low") return "good";
if (normalized === "critical" || normalized === "high") return "bad";
return "warn";
}

function formatDateTime(value) {
const date = new Date(value);
if (!value || Number.isNaN(date.getTime())) return "—";
return date.toLocaleString();
}

function getSelectedCase() {
if (!state.selectedCaseId) return null;
return state.cases.find((item) => Number(item.id) === Number(state.selectedCaseId)) || null;
}

function updateSummary() {
const openLike = state.cases.filter((item) =>
["open", "pending_info"].includes(cleanText(item.status, 32).toLowerCase())
).length;

const escalatedLike = state.cases.filter((item) =>
["escalated", "frozen"].includes(cleanText(item.status, 32).toLowerCase())
).length;

const resolvedLike = state.cases.filter((item) =>
["approved", "rejected"].includes(cleanText(item.status, 32).toLowerCase())
).length;

els.queueCountChip.textContent = `${state.cases.length} case${state.cases.length === 1 ? "" : "s"}`;
els.openCountValue.textContent = String(openLike);
els.escalatedCountValue.textContent = String(escalatedLike);
els.resolvedCountValue.textContent = String(resolvedLike);

const filterParts = [];
if (state.filters.status) filterParts.push(`status:${state.filters.status}`);
if (state.filters.caseType) filterParts.push(`type:${state.filters.caseType}`);
if (state.filters.riskLevel) filterParts.push(`risk:${state.filters.riskLevel}`);
if (state.filters.assignedTo) filterParts.push(`assigned:${state.filters.assignedTo}`);
els.heroFilterValue.textContent = filterParts.length ? filterParts.join(" • ") : "All cases";

const selected = getSelectedCase();
els.heroSelectedValue.textContent = selected
? `#${selected.id} ${cleanText(selected.case_type, 40)}`
: "None selected";

els.heroReviewStateValue.textContent = selected
? cleanText(selected.status, 40) || "Selected"
: state.cases.length
? "Queue loaded"
: "No cases loaded";
}

function createPill(text, variant = "neutral") {
const span = document.createElement("span");
span.className = `pill ${variant}`;
span.textContent = text;
return span;
}

function renderCasesTable() {
els.casesTableBody.innerHTML = "";

if (!state.cases.length) {
const row = document.createElement("tr");
row.innerHTML = `
<td colspan="7" style="padding:24px; color:var(--muted); text-align:center;">
No compliance cases found for the current filter set.
</td>
`;
els.casesTableBody.appendChild(row);
return;
}

state.cases.forEach((item) => {
const row = document.createElement("tr");
if (Number(item.id) === Number(state.selectedCaseId)) {
row.classList.add("active");
}

const caseType = cleanText(item.case_type, 40) || "case";
const status = cleanText(item.status, 40) || "unknown";
const riskLevel = cleanText(item.risk_level, 40) || "low";
const wallet = cleanText(item.profile?.wallet_address, 200);
const launchName = cleanText(item.launch?.token_name, 120) || "—";
const launchSymbol = cleanText(item.launch?.symbol, 40);

const caseCell = document.createElement("td");
caseCell.innerHTML = `
<div style="font-weight:700;">#${item.id}</div>
<div class="dim">${caseType}</div>
`;

const statusCell = document.createElement("td");
statusCell.appendChild(createPill(status, getStatusVariant(status)));

const riskCell = document.createElement("td");
riskCell.appendChild(createPill(riskLevel, getRiskVariant(riskLevel)));

const walletCell = document.createElement("td");
walletCell.innerHTML = `
<div class="mono">${wallet ? shortenWallet(wallet) : "—"}</div>
<div class="dim">
${cleanText(item.profile?.entity_name || item.profile?.display_name || item.profile?.legal_name, 120) || "No profile name"}
</div>
`;

const launchCell = document.createElement("td");
launchCell.innerHTML = `
<div>${launchName}</div>
<div class="dim">${launchSymbol || "—"}</div>
`;

const assignedCell = document.createElement("td");
assignedCell.innerHTML = `
<div>${cleanText(item.assigned_to, 120) || "Unassigned"}</div>
<div class="dim">${cleanText(item.approved_by, 120) || ""}</div>
`;

const updatedCell = document.createElement("td");
updatedCell.innerHTML = `
<div>${formatDateTime(item.updated_at || item.created_at)}</div>
<div class="dim">${formatDateTime(item.created_at)}</div>
`;

row.appendChild(caseCell);
row.appendChild(statusCell);
row.appendChild(riskCell);
row.appendChild(walletCell);
row.appendChild(launchCell);
row.appendChild(assignedCell);
row.appendChild(updatedCell);

row.addEventListener("click", async () => {
await loadCaseDetail(item.id);
});

els.casesTableBody.appendChild(row);
});
}

function renderCaseDetail(item) {
if (!item) {
els.caseDetailEmpty.style.display = "grid";
els.caseDetailPanel.style.display = "none";
return;
}

els.caseDetailEmpty.style.display = "none";
els.caseDetailPanel.style.display = "grid";

els.detailCaseId.textContent = `#${item.id}`;
els.detailCaseType.textContent = cleanText(item.case_type, 40) || "—";
els.detailStatus.textContent = cleanText(item.status, 40) || "—";
els.detailRisk.textContent = `${cleanText(item.risk_level, 40) || "low"} / ${Number(item.risk_score || 0)}`;

els.detailReviewReason.textContent = cleanText(item.review_reason, 5000) || "—";

els.detailWallet.textContent = cleanText(item.profile?.wallet_address, 200) || "—";
els.detailProfileType.textContent = cleanText(item.profile?.profile_type, 40) || "—";
els.detailProfileStatus.textContent = cleanText(item.profile?.status, 40) || "—";
els.detailProfileRisk.textContent = cleanText(item.profile?.risk_rating, 40) || "—";
els.detailCountry.textContent = cleanText(item.profile?.country_code, 20) || "—";
els.detailManualReview.textContent = item.profile?.manual_review_required
? cleanText(item.profile?.manual_review_reason, 500) || "Required"
: "No";

const profileName =
cleanText(item.profile?.entity_name, 200) ||
cleanText(item.profile?.display_name, 200) ||
cleanText(item.profile?.legal_name, 200) ||
"—";
els.detailProfileName.textContent = profileName;

const launchName = cleanText(item.launch?.token_name, 200);
const symbol = cleanText(item.launch?.symbol, 40);
els.detailLaunchName.textContent = launchName
? `${launchName}${symbol ? ` (${symbol})` : ""}`
: "—";

els.detailLaunchStatus.textContent = cleanText(item.launch?.status, 80) || "—";
els.detailLaunchTemplate.textContent = cleanText(item.launch?.template, 80) || "—";
els.detailBuilderWallet.textContent = cleanText(item.launch?.builder_wallet, 200) || "—";

els.assignedToInput.value = cleanText(item.assigned_to, 120);
els.actionNotes.value = "";
els.escalationRiskLevel.value =
cleanText(item.risk_level, 32).toLowerCase() || "high";
}

function buildQueryString() {
const params = new URLSearchParams();

if (state.filters.status) params.set("status", state.filters.status);
if (state.filters.caseType) params.set("case_type", state.filters.caseType);
if (state.filters.riskLevel) params.set("risk_level", state.filters.riskLevel);
if (state.filters.assignedTo) params.set("assigned_to", state.filters.assignedTo);

return params.toString();
}

async function loadCases() {
setLoading(true);
try {
const queryString = buildQueryString();
const payload = await apiFetch(
`/api/compliance-admin/cases${queryString ? `?${queryString}` : ""}`
);

state.cases = Array.isArray(payload?.cases) ? payload.cases : [];

if (state.selectedCaseId) {
const stillExists = state.cases.some(
(item) => Number(item.id) === Number(state.selectedCaseId)
);
if (!stillExists) {
state.selectedCaseId = null;
state.selectedCase = null;
}
}

renderCasesTable();
updateSummary();

if (state.selectedCaseId) {
const selected = getSelectedCase();
if (selected) {
await loadCaseDetail(selected.id, { quiet: true });
} else {
renderCaseDetail(null);
}
} else {
renderCaseDetail(null);
}

clearBanner();
} catch (error) {
setBanner(error?.message || "Failed to load compliance cases.", "bad");
} finally {
setLoading(false);
}
}

async function loadCaseDetail(caseId, { quiet = false } = {}) {
if (!caseId) return;

setLoading(true);
try {
const payload = await apiFetch(`/api/compliance-admin/cases/${encodeURIComponent(caseId)}`);
const item = payload?.case || null;

if (!item) {
throw new Error("Case detail was empty.");
}

state.selectedCaseId = Number(caseId);
state.selectedCase = item;

renderCasesTable();
renderCaseDetail(item);
updateSummary();

if (!quiet) {
clearBanner();
}
} catch (error) {
if (!quiet) {
setBanner(error?.message || "Failed to load case detail.", "bad");
}
} finally {
setLoading(false);
}
}

function syncFiltersFromInputs() {
state.filters.status = cleanText(els.filterStatus.value, 32).toLowerCase();
state.filters.caseType = cleanText(els.filterCaseType.value, 32).toLowerCase();
state.filters.riskLevel = cleanText(els.filterRiskLevel.value, 32).toLowerCase();
state.filters.assignedTo = cleanText(els.filterAssignedTo.value, 120);
}

function getActionNotes() {
return cleanText(els.actionNotes.value, 2000);
}

function getActorId() {
return "admin";
}

async function postCaseAction(path, body = {}, successMessage = "Action completed.") {
if (!state.selectedCaseId) {
setBanner("Select a compliance case first.", "warn");
return;
}

setLoading(true);
try {
await apiFetch(
`/api/compliance-admin/cases/${encodeURIComponent(state.selectedCaseId)}${path}`,
{
method: "POST",
body: JSON.stringify(body),
}
);

await loadCases();
await loadCaseDetail(state.selectedCaseId, { quiet: true });
setBanner(successMessage, "good");
} catch (error) {
setBanner(error?.message || "Case action failed.", "bad");
} finally {
setLoading(false);
}
}

function bindActions() {
els.applyFiltersButton.addEventListener("click", async () => {
syncFiltersFromInputs();
await loadCases();
});

els.refreshCasesButton.addEventListener("click", async () => {
await loadCases();
});

els.approveCaseButton.addEventListener("click", async () => {
await postCaseAction(
"/approve",
{
actor_id: getActorId(),
notes: getActionNotes(),
},
"Compliance case approved."
);
});

els.rejectCaseButton.addEventListener("click", async () => {
await postCaseAction(
"/reject",
{
actor_id: getActorId(),
notes: getActionNotes(),
},
"Compliance case rejected."
);
});

els.freezeCaseButton.addEventListener("click", async () => {
await postCaseAction(
"/freeze",
{
actor_id: getActorId(),
notes: getActionNotes(),
},
"Compliance case frozen."
);
});

els.escalateCaseButton.addEventListener("click", async () => {
await postCaseAction(
"/escalate",
{
actor_id: getActorId(),
notes: getActionNotes(),
risk_level: cleanText(els.escalationRiskLevel.value, 32).toLowerCase() || "high",
},
"Compliance case escalated."
);
});

els.assignCaseButton.addEventListener("click", async () => {
const assignedTo = cleanText(els.assignedToInput.value, 120);
if (!assignedTo) {
setBanner("Enter an assignee before assigning the case.", "warn");
return;
}

await postCaseAction(
"/assign",
{
actor_id: getActorId(),
assigned_to: assignedTo,
},
"Compliance case assigned."
);
});
}

async function init() {
bindActions();
syncFiltersFromInputs();
await loadCases();
}

init().catch((error) => {
console.error("Failed to initialize compliance admin page", error);
setBanner(error?.message || "Failed to initialize compliance admin page.", "bad");
});
