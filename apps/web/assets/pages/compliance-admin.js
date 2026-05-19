const todayIso = new Date().toISOString().slice(0, 10)

const state = {
cases: [],
selectedCaseId: null,
selectedCase: null,
filters: {
status: "",
caseType: "",
riskLevel: "",
assignedTo: "",
},
caseLoadingCount: 0,
}

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

newCaseNotificationValue: document.getElementById("newCaseNotificationValue"),
highRiskNotificationValue: document.getElementById("highRiskNotificationValue"),
escalationNotificationValue: document.getElementById("escalationNotificationValue"),

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
}

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max)
}

function arrayify(value) {
return Array.isArray(value) ? value : []
}

function safeNumber(value, fallback = 0) {
const num = Number(value)
return Number.isFinite(num) ? num : fallback
}

function shortenWallet(wallet) {
const value = cleanText(wallet, 200)
if (!value) return "—"
if (value.length <= 14) return value
return `${value.slice(0, 6)}…${value.slice(-6)}`
}

function titleCase(value) {
return cleanText(value, 120)
.replace(/_/g, " ")
.replace(/-/g, " ")
.split(" ")
.filter(Boolean)
.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
.join(" ")
}

function formatDateTime(value) {
const date = new Date(value)
if (!value || Number.isNaN(date.getTime())) return "—"
return date.toLocaleString()
}

function formatNumber(value, fractionDigits = 0) {
const num = Number(value)
if (!Number.isFinite(num)) return "0"

return new Intl.NumberFormat(undefined, {
maximumFractionDigits: fractionDigits,
minimumFractionDigits: fractionDigits,
}).format(num)
}

function setText(el, value) {
if (!el) return
el.textContent = value == null || value === "" ? "—" : String(value)
}

function setValue(el, value) {
if (!el) return
el.value = value == null ? "" : String(value)
}

function stringifyCompact(value) {
if (value == null) return "—"

try {
return JSON.stringify(value)
} catch {
return String(value)
}
}

function ensureComplianceAdminStyles() {
if (document.getElementById("mssComplianceAdminJsStyles")) return

const style = document.createElement("style")
style.id = "mssComplianceAdminJsStyles"
style.textContent = `
.admin-pill {
display: inline-flex;
align-items: center;
gap: 8px;
min-height: 30px;
padding: 0 10px;
border-radius: 999px;
border: 1px solid rgba(115, 185, 255, 0.14);
background: rgba(255, 255, 255, 0.04);
font-size: 10px;
font-weight: 900;
letter-spacing: 0.1em;
text-transform: uppercase;
white-space: nowrap;
}
.admin-pill.good {
color: #7bffb1;
border-color: rgba(123, 255, 177, 0.24);
}
.admin-pill.warn {
color: #ffcf66;
border-color: rgba(255, 207, 102, 0.24);
}
.admin-pill.bad {
color: #ff8787;
border-color: rgba(255, 135, 135, 0.24);
}
.admin-pill.neutral {
color: rgba(198, 211, 226, 0.72);
}
.admin-case-json {
margin-top: 12px;
padding: 12px;
border-radius: 14px;
border: 1px solid rgba(115, 185, 255, 0.10);
background: rgba(2, 6, 14, 0.42);
color: rgba(198, 211, 226, 0.72);
font-size: 12px;
line-height: 1.55;
white-space: pre-wrap;
overflow: auto;
max-height: 220px;
}
`
document.head.appendChild(style)
}

function getApiBase() {
const { protocol, hostname } = window.location
const override = cleanText(window.__API_BASE__ || "", 1000)

if (override) return override.replace(/\/$/, "")

if (
hostname === "127.0.0.1" ||
hostname === "localhost" ||
hostname === "[::1]"
) {
return `${protocol}//${hostname}:8787`
}

if (hostname.includes("-3000.app.github.dev")) {
return `${protocol}//${hostname.replace("-3000.app.github.dev", "-8787.app.github.dev")}`
}

if (hostname.includes("-3001.app.github.dev")) {
return `${protocol}//${hostname.replace("-3001.app.github.dev", "-8787.app.github.dev")}`
}

if (hostname.includes("-4173.app.github.dev")) {
return `${protocol}//${hostname.replace("-4173.app.github.dev", "-8787.app.github.dev")}`
}

if (/:\d+$/.test(window.location.host)) {
return `${protocol}//${hostname}:8787`
}

return `${window.location.origin}`
}

const API_BASE = getApiBase()

async function apiFetch(path, options = {}) {
const response = await fetch(`${API_BASE}${path}`, {
credentials: "include",
headers: {
"Content-Type": "application/json",
...(options.headers || {}),
},
...options,
})

let payload = null

try {
payload = await response.json()
} catch {
payload = null
}

if (!response.ok) {
const error = new Error(
payload?.error || payload?.message || `Request failed (${response.status})`
)
error.status = response.status
error.payload = payload
throw error
}

return payload
}

function setCaseBanner(message = "", variant = "warn") {
if (!els.banner) return

els.banner.textContent = message || ""
els.banner.className = "admin-banner"

if (message) {
els.banner.classList.add("show")
els.banner.classList.add(variant)
}
}

function clearCaseBanner() {
if (!els.banner) return
els.banner.className = "admin-banner"
els.banner.textContent = ""
}

function isCasesLoading() {
return state.caseLoadingCount > 0
}

function refreshApiStatus() {
if (!els.apiStatusChip) return
els.apiStatusChip.textContent = isCasesLoading() ? "Loading" : "Ready"
}

function updateCaseControlDisabledState() {
const disabled = isCasesLoading()

;[
els.refreshCasesButton,
els.applyFiltersButton,
els.approveCaseButton,
els.rejectCaseButton,
els.freezeCaseButton,
els.escalateCaseButton,
els.assignCaseButton,
].forEach((button) => {
if (button) button.disabled = disabled
})
}

function beginCasesLoading() {
state.caseLoadingCount += 1
refreshApiStatus()
updateCaseControlDisabledState()
}

function endCasesLoading() {
state.caseLoadingCount = Math.max(0, state.caseLoadingCount - 1)
refreshApiStatus()
updateCaseControlDisabledState()
}

function getStatusVariant(status) {
const normalized = cleanText(status, 32).toLowerCase()

if (normalized === "approved") return "good"
if (normalized === "rejected" || normalized === "restricted" || normalized === "frozen") {
return "bad"
}
if (normalized === "escalated" || normalized === "pending_info") return "warn"

return "neutral"
}

function getRiskVariant(riskLevel) {
const normalized = cleanText(riskLevel, 32).toLowerCase()

if (normalized === "low") return "good"
if (normalized === "critical" || normalized === "high") return "bad"
if (normalized === "medium") return "warn"

return "neutral"
}

function createPill(text, variant = "neutral") {
const span = document.createElement("span")
span.className = `admin-pill ${variant}`
span.textContent = cleanText(text, 120) || "—"
return span
}

function renderTableEmpty(tbody, colspan, message) {
if (!tbody) return

tbody.innerHTML = ""

const row = document.createElement("tr")
const td = document.createElement("td")

td.colSpan = colspan
td.style.padding = "24px"
td.style.color = "rgba(198, 211, 226, 0.66)"
td.style.textAlign = "center"
td.textContent = message

row.appendChild(td)
tbody.appendChild(row)
}

function getSelectedCase() {
if (!state.selectedCaseId) return null

return (
state.cases.find((item) => Number(item.id) === Number(state.selectedCaseId)) ||
state.selectedCase ||
null
)
}

function getCaseWallet(item = {}) {
return (
cleanText(item.profile?.wallet_address, 200) ||
cleanText(item.wallet_address, 200) ||
cleanText(item.subject_wallet, 200) ||
cleanText(item.target_wallet, 200)
)
}

function getCaseProfileName(item = {}) {
return (
cleanText(item.profile?.entity_name, 200) ||
cleanText(item.profile?.display_name, 200) ||
cleanText(item.profile?.legal_name, 200) ||
cleanText(item.profile_name, 200) ||
cleanText(item.entity_name, 200)
)
}

function getCaseLaunchName(item = {}) {
return (
cleanText(item.launch?.token_name, 200) ||
cleanText(item.launch?.name, 200) ||
cleanText(item.token_name, 200) ||
cleanText(item.launch_name, 200)
)
}

function getCaseLaunchSymbol(item = {}) {
return (
cleanText(item.launch?.symbol, 40) ||
cleanText(item.symbol, 40) ||
cleanText(item.launch_symbol, 40)
)
}

function getCaseStatus(item = {}) {
return cleanText(item.status, 40).toLowerCase() || "unknown"
}

function getCaseRiskLevel(item = {}) {
return cleanText(item.risk_level || item.riskLevel, 40).toLowerCase() || "low"
}

function updateComplianceSummary() {
const openLike = state.cases.filter((item) =>
["open", "pending_info"].includes(getCaseStatus(item))
).length

const escalatedLike = state.cases.filter((item) =>
["escalated", "frozen"].includes(getCaseStatus(item))
).length

const resolvedLike = state.cases.filter((item) =>
["approved", "rejected"].includes(getCaseStatus(item))
).length

const highRiskLike = state.cases.filter((item) =>
["high", "critical"].includes(getCaseRiskLevel(item))
).length

if (els.queueCountChip) {
els.queueCountChip.textContent = `${state.cases.length} case${state.cases.length === 1 ? "" : "s"}`
}

setText(els.openCountValue, String(openLike))
setText(els.escalatedCountValue, String(escalatedLike))
setText(els.resolvedCountValue, String(resolvedLike))

setText(
els.newCaseNotificationValue,
openLike ? `${formatNumber(openLike)} open / pending` : "No open cases"
)
setText(
els.highRiskNotificationValue,
highRiskLike ? `${formatNumber(highRiskLike)} high-risk case${highRiskLike === 1 ? "" : "s"}` : "No high-risk cases"
)
setText(
els.escalationNotificationValue,
escalatedLike
? `${formatNumber(escalatedLike)} escalated / frozen`
: "No escalations"
)

const filterParts = []

if (state.filters.status) filterParts.push(`status:${state.filters.status}`)
if (state.filters.caseType) filterParts.push(`type:${state.filters.caseType}`)
if (state.filters.riskLevel) filterParts.push(`risk:${state.filters.riskLevel}`)
if (state.filters.assignedTo) filterParts.push(`assigned:${state.filters.assignedTo}`)

setText(
els.heroFilterValue,
filterParts.length ? filterParts.join(" • ") : "All cases"
)

const selected = getSelectedCase()

setText(
els.heroSelectedValue,
selected ? `#${selected.id} ${cleanText(selected.case_type, 40)}` : "None selected"
)

setText(
els.heroReviewStateValue,
selected
? cleanText(selected.status, 40) || "Selected"
: state.cases.length
? "Queue loaded"
: "No cases loaded"
)
}

function renderCasesTable() {
const tbody = els.casesTableBody
if (!tbody) return

tbody.innerHTML = ""

if (!state.cases.length) {
renderTableEmpty(
tbody,
7,
"No compliance cases found for the current filter set."
)
return
}

state.cases.forEach((item) => {
const row = document.createElement("tr")

if (Number(item.id) === Number(state.selectedCaseId)) {
row.classList.add("active")
}

const caseType = cleanText(item.case_type, 40) || "case"
const status = getCaseStatus(item)
const riskLevel = getCaseRiskLevel(item)
const wallet = getCaseWallet(item)
const profileName = getCaseProfileName(item)
const launchName = getCaseLaunchName(item) || "—"
const launchSymbol = getCaseLaunchSymbol(item)

const caseCell = document.createElement("td")
caseCell.innerHTML = `
<div style="font-weight: 800;">#${safeNumber(item.id, 0)}</div>
<div class="dim">${titleCase(caseType)}</div>
`

const statusCell = document.createElement("td")
statusCell.appendChild(createPill(titleCase(status), getStatusVariant(status)))

const riskCell = document.createElement("td")
riskCell.appendChild(createPill(titleCase(riskLevel), getRiskVariant(riskLevel)))

const walletCell = document.createElement("td")
walletCell.innerHTML = `
<div class="mono">${wallet ? shortenWallet(wallet) : "—"}</div>
<div class="dim">${profileName || "No profile name"}</div>
`

const launchCell = document.createElement("td")
launchCell.innerHTML = `
<div>${launchName}</div>
<div class="dim">${launchSymbol || "—"}</div>
`

const assignedCell = document.createElement("td")
assignedCell.innerHTML = `
<div>${cleanText(item.assigned_to, 120) || "Unassigned"}</div>
<div class="dim">${cleanText(item.approved_by, 120) || ""}</div>
`

const updatedCell = document.createElement("td")
updatedCell.innerHTML = `
<div>${formatDateTime(item.updated_at || item.created_at)}</div>
<div class="dim">${formatDateTime(item.created_at)}</div>
`

;[
caseCell,
statusCell,
riskCell,
walletCell,
launchCell,
assignedCell,
updatedCell,
].forEach((cell) => row.appendChild(cell))

row.addEventListener("click", async () => {
await loadCaseDetail(item.id)
})

tbody.appendChild(row)
})
}

function renderCaseDetail(item) {
if (!item) {
if (els.caseDetailEmpty) els.caseDetailEmpty.style.display = "grid"
if (els.caseDetailPanel) els.caseDetailPanel.style.display = "none"
return
}

if (els.caseDetailEmpty) els.caseDetailEmpty.style.display = "none"
if (els.caseDetailPanel) els.caseDetailPanel.style.display = "grid"

const caseType = cleanText(item.case_type, 40) || "—"
const status = cleanText(item.status, 40) || "—"
const riskLevel = cleanText(item.risk_level, 40) || "low"
const riskScore = safeNumber(item.risk_score, 0)

setText(els.detailCaseId, `#${item.id}`)
setText(els.detailCaseType, titleCase(caseType))
setText(els.detailStatus, titleCase(status))
setText(els.detailRisk, `${titleCase(riskLevel)} / ${riskScore}`)

setText(els.detailReviewReason, cleanText(item.review_reason, 5000) || "—")

setText(els.detailWallet, getCaseWallet(item) || "—")
setText(els.detailProfileType, cleanText(item.profile?.profile_type, 40) || "—")
setText(els.detailProfileStatus, cleanText(item.profile?.status, 40) || "—")
setText(els.detailProfileRisk, cleanText(item.profile?.risk_rating, 40) || "—")
setText(els.detailCountry, cleanText(item.profile?.country_code, 20) || "—")

setText(
els.detailManualReview,
item.profile?.manual_review_required
? cleanText(item.profile?.manual_review_reason, 500) || "Required"
: "No"
)

setText(els.detailProfileName, getCaseProfileName(item) || "—")

const launchName = getCaseLaunchName(item)
const symbol = getCaseLaunchSymbol(item)

setText(
els.detailLaunchName,
launchName ? `${launchName}${symbol ? ` (${symbol})` : ""}` : "—"
)

setText(
els.detailLaunchStatus,
cleanText(item.launch?.status || item.launch_status, 80) || "—"
)
setText(
els.detailLaunchTemplate,
cleanText(item.launch?.template || item.launch_template, 80) || "—"
)
setText(
els.detailBuilderWallet,
cleanText(item.launch?.builder_wallet || item.builder_wallet, 200) || "—"
)

setValue(els.assignedToInput, cleanText(item.assigned_to, 120))
setValue(els.actionNotes, "")
setValue(
els.escalationRiskLevel,
cleanText(item.risk_level, 32).toLowerCase() || "high"
)
}

function buildCaseQueryString() {
const params = new URLSearchParams()

if (state.filters.status) params.set("status", state.filters.status)
if (state.filters.caseType) params.set("case_type", state.filters.caseType)
if (state.filters.riskLevel) params.set("risk_level", state.filters.riskLevel)
if (state.filters.assignedTo) params.set("assigned_to", state.filters.assignedTo)

return params.toString()
}

async function loadCases() {
beginCasesLoading()

try {
const queryString = buildCaseQueryString()
const payload = await apiFetch(
`/api/compliance-admin/cases${queryString ? `?${queryString}` : ""}`
)

state.cases = arrayify(payload?.cases)

if (state.selectedCaseId) {
const stillExists = state.cases.some(
(item) => Number(item.id) === Number(state.selectedCaseId)
)

if (!stillExists) {
state.selectedCaseId = null
state.selectedCase = null
}
}

const selected = getSelectedCase()
state.selectedCase = selected || null

renderCasesTable()
updateComplianceSummary()

if (state.selectedCaseId && selected) {
await loadCaseDetail(state.selectedCaseId, {
quiet: true,
manageLoading: false,
})
} else {
renderCaseDetail(null)
}

clearCaseBanner()
} catch (error) {
setCaseBanner(error?.message || "Failed to load compliance cases.", "bad")
} finally {
endCasesLoading()
}
}

async function loadCaseDetail(caseId, { quiet = false, manageLoading = true } = {}) {
if (!caseId) return

if (manageLoading) beginCasesLoading()

try {
const payload = await apiFetch(`/api/compliance-admin/cases/${encodeURIComponent(caseId)}`)
const item = payload?.case || null

if (!item) {
throw new Error("Case detail was empty.")
}

state.selectedCaseId = Number(caseId)
state.selectedCase = item

state.cases = state.cases.map((existing) =>
Number(existing.id) === Number(item.id) ? { ...existing, ...item } : existing
)

renderCasesTable()
renderCaseDetail(item)
updateComplianceSummary()

if (!quiet) clearCaseBanner()
} catch (error) {
if (!quiet) {
setCaseBanner(error?.message || "Failed to load case detail.", "bad")
}
} finally {
if (manageLoading) endCasesLoading()
}
}

function syncCaseFiltersFromInputs() {
state.filters.status = cleanText(els.filterStatus?.value, 32).toLowerCase()
state.filters.caseType = cleanText(els.filterCaseType?.value, 32).toLowerCase()
state.filters.riskLevel = cleanText(els.filterRiskLevel?.value, 32).toLowerCase()
state.filters.assignedTo = cleanText(els.filterAssignedTo?.value, 120)
}

function getActionNotes() {
return cleanText(els.actionNotes?.value, 2000)
}

function getActorId() {
return (
cleanText(window.__MSS_ADMIN_ACTOR_ID__, 120) ||
cleanText(localStorage.getItem("mss_admin_actor_id"), 120) ||
"admin"
)
}

async function postCaseAction(path, body = {}, successMessage = "Action completed.") {
if (!state.selectedCaseId) {
setCaseBanner("Select a compliance case first.", "warn")
return
}

const caseId = state.selectedCaseId

beginCasesLoading()

try {
await apiFetch(
`/api/compliance-admin/cases/${encodeURIComponent(caseId)}${path}`,
{
method: "POST",
body: JSON.stringify(body),
}
)

await loadCases()

if (state.selectedCaseId && Number(state.selectedCaseId) === Number(caseId)) {
await loadCaseDetail(caseId, {
quiet: true,
manageLoading: false,
})
}

setCaseBanner(successMessage, "good")
} catch (error) {
setCaseBanner(error?.message || "Case action failed.", "bad")
} finally {
endCasesLoading()
}
}

function bindCaseActions() {
els.applyFiltersButton?.addEventListener("click", async () => {
syncCaseFiltersFromInputs()
await loadCases()
})

;[
els.filterStatus,
els.filterCaseType,
els.filterRiskLevel,
].forEach((input) => {
input?.addEventListener("change", async () => {
syncCaseFiltersFromInputs()
await loadCases()
})
})

els.filterAssignedTo?.addEventListener("keydown", async (event) => {
if (event.key !== "Enter") return
syncCaseFiltersFromInputs()
await loadCases()
})

els.refreshCasesButton?.addEventListener("click", async () => {
await loadCases()
})

els.approveCaseButton?.addEventListener("click", async () => {
await postCaseAction(
"/approve",
{
actor_id: getActorId(),
notes: getActionNotes(),
},
"Compliance case approved."
)
})

els.rejectCaseButton?.addEventListener("click", async () => {
const confirmed = window.confirm("Reject the selected compliance case?")
if (!confirmed) return

await postCaseAction(
"/reject",
{
actor_id: getActorId(),
notes: getActionNotes(),
},
"Compliance case rejected."
)
})

els.freezeCaseButton?.addEventListener("click", async () => {
const confirmed = window.confirm("Freeze the selected compliance case?")
if (!confirmed) return

await postCaseAction(
"/freeze",
{
actor_id: getActorId(),
notes: getActionNotes(),
},
"Compliance case frozen."
)
})

els.escalateCaseButton?.addEventListener("click", async () => {
await postCaseAction(
"/escalate",
{
actor_id: getActorId(),
notes: getActionNotes(),
risk_level: cleanText(els.escalationRiskLevel?.value, 32).toLowerCase() || "high",
},
"Compliance case escalated."
)
})

els.assignCaseButton?.addEventListener("click", async () => {
const assignedTo = cleanText(els.assignedToInput?.value, 120)

if (!assignedTo) {
setCaseBanner("Enter an assignee before assigning the case.", "warn")
return
}

await postCaseAction(
"/assign",
{
actor_id: getActorId(),
assigned_to: assignedTo,
},
"Compliance case assigned."
)
})
}

function initDefaults() {
ensureComplianceAdminStyles()

setValue(els.filterStatus, state.filters.status)
setValue(els.filterCaseType, state.filters.caseType)
setValue(els.filterRiskLevel, state.filters.riskLevel)
setValue(els.filterAssignedTo, state.filters.assignedTo)

renderCaseDetail(null)
updateComplianceSummary()
updateCaseControlDisabledState()
refreshApiStatus()
}

async function init() {
initDefaults()
bindCaseActions()
syncCaseFiltersFromInputs()

await loadCases()
}

init().catch((error) => {
console.error("Failed to initialize compliance admin page", error)
setCaseBanner(error?.message || "Failed to initialize compliance admin page.", "bad")
})