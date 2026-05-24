import {
ADMIN_SESSION_INVALID_EVENT,
ADMIN_SESSION_READY_EVENT,
apiFetch,
arrayify,
cleanText,
createPill,
formatDateTime,
formatNumber,
getAdminSessionSnapshot,
getRiskVariant,
getStatusVariant,
renderTableEmpty,
safeNumber,
setAdminSessionSnapshot,
setBanner,
setText,
setValue,
shortenWallet,
titleCase,
} from "./admin-core.js"

const REQUIRED_ADMIN_SCOPE = "admin"

const state = {
adminSession: null,
reauthPending: false,
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
complianceNotificationValue: document.getElementById(
"complianceNotificationValue"
),

newCaseNotificationValue: document.getElementById(
"newCaseNotificationValue"
),
highRiskNotificationValue: document.getElementById(
"highRiskNotificationValue"
),
escalationNotificationValue: document.getElementById(
"escalationNotificationValue"
),

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

function normalizeScopes(scopes) {
return arrayify(scopes)
.map((scope) => cleanText(scope, 64).toLowerCase())
.filter(Boolean)
}

function sessionAllowsComplianceAdmin(session) {
return normalizeScopes(session?.scopes).includes(REQUIRED_ADMIN_SCOPE)
}

function acceptAdminSession(session) {
if (!sessionAllowsComplianceAdmin(session)) {
return null
}

state.adminSession = session
setAdminSessionSnapshot(session)

return session
}

function getExistingAdminSession() {
const storedSession = getAdminSessionSnapshot()

if (storedSession && sessionAllowsComplianceAdmin(storedSession)) {
return acceptAdminSession(storedSession)
}

const guardState = window.MSSAdminSessionGuard?.getState?.()

if (
guardState?.authenticated &&
guardState?.session &&
sessionAllowsComplianceAdmin(guardState.session)
) {
return acceptAdminSession(guardState.session)
}

return null
}

function waitForAuthenticatedAdminSession() {
const existingSession = getExistingAdminSession()

if (existingSession) {
return Promise.resolve(existingSession)
}

return new Promise((resolve) => {
const onReady = (event) => {
const session = acceptAdminSession(event?.detail?.session || null)

if (!session) return

window.removeEventListener(ADMIN_SESSION_READY_EVENT, onReady)
resolve(session)
}

window.addEventListener(ADMIN_SESSION_READY_EVENT, onReady)

const retrySession = getExistingAdminSession()

if (retrySession) {
window.removeEventListener(ADMIN_SESSION_READY_EVENT, onReady)
resolve(retrySession)
}
})
}

function ensureComplianceAdminStyles() {
if (document.getElementById("mssComplianceAdminJsStyles")) return

const style = document.createElement("style")
style.id = "mssComplianceAdminJsStyles"
style.textContent = `
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

function setCaseBanner(message = "", variant = "warn") {
setBanner(els.banner, message, variant)
}

function clearCaseBanner() {
setBanner(els.banner, "")
}

function isAuthorizationError(error) {
return [401, 403].includes(Number(error?.status))
}

function handleAdminApiAuthorizationError(error) {
if (!isAuthorizationError(error)) {
return false
}

if (state.reauthPending) {
return true
}

state.reauthPending = true
state.adminSession = null
setAdminSessionSnapshot(null)

const message =
error?.status === 403
? "Your admin session does not have permission to manage compliance cases."
: "Your admin session has expired. Returning to secure sign-in."

setCaseBanner(message, "bad")

const guard = window.MSSAdminSessionGuard

if (guard?.requireAdminSession) {
guard
.requireAdminSession({
requiredScope: REQUIRED_ADMIN_SCOPE,
redirectUnauthenticated: true,
})
.catch(() => {})
.finally(() => {
state.reauthPending = false
})
}

return true
}

async function apiFetchComplianceAdmin(path, options = {}) {
try {
return await apiFetch(`/api/compliance-admin${path}`, options)
} catch (error) {
handleAdminApiAuthorizationError(error)
throw error
}
}

function getSessionActorId() {
return (
cleanText(state.adminSession?.actor, 120) ||
cleanText(getAdminSessionSnapshot()?.actor, 120) ||
"admin"
)
}

function isCasesLoading() {
return state.caseLoadingCount > 0
}

function refreshApiStatus() {
setText(els.apiStatusChip, isCasesLoading() ? "Loading" : "Ready")
}

function updateCaseControlDisabledState() {
const loading = isCasesLoading()
const hasSelectedCase = Boolean(state.selectedCaseId)

;[
els.refreshCasesButton,
els.applyFiltersButton,
].forEach((button) => {
if (button) {
button.disabled = loading
}
})

;[
els.approveCaseButton,
els.rejectCaseButton,
els.freezeCaseButton,
els.escalateCaseButton,
els.assignCaseButton,
].forEach((button) => {
if (button) {
button.disabled = loading || !hasSelectedCase
}
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

function getSelectedCase() {
if (!state.selectedCaseId) return null

return (
state.cases.find(
(item) => Number(item.id) === Number(state.selectedCaseId)
) ||
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
return (
cleanText(item.risk_level || item.riskLevel, 40).toLowerCase() || "low"
)
}

function getEscalationRiskInputValue(item = {}) {
const riskLevel = getCaseRiskLevel(item)

if (["medium", "high", "critical"].includes(riskLevel)) {
return riskLevel
}

return "high"
}

function createStackedCell({
primary = "—",
secondary = "",
mono = false,
strong = false,
} = {}) {
const cell = document.createElement("td")

const primaryLine = document.createElement("div")
primaryLine.textContent = primary || "—"

if (mono) {
primaryLine.classList.add("mono")
}

if (strong) {
primaryLine.style.fontWeight = "800"
}

cell.appendChild(primaryLine)

if (secondary) {
const secondaryLine = document.createElement("div")
secondaryLine.className = "dim"
secondaryLine.textContent = secondary
cell.appendChild(secondaryLine)
}

return cell
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
els.queueCountChip.textContent = `${state.cases.length} case${
state.cases.length === 1 ? "" : "s"
}`
}

setText(els.openCountValue, formatNumber(openLike))
setText(els.escalatedCountValue, formatNumber(escalatedLike))
setText(els.resolvedCountValue, formatNumber(resolvedLike))

setText(
els.complianceNotificationValue,
escalatedLike
? `${formatNumber(escalatedLike)} priority`
: openLike
? `${formatNumber(openLike)} awaiting review`
: "Queue clear"
)

setText(
els.newCaseNotificationValue,
openLike ? `${formatNumber(openLike)} open / pending` : "No open cases"
)

setText(
els.highRiskNotificationValue,
highRiskLike
? `${formatNumber(highRiskLike)} high-risk case${
highRiskLike === 1 ? "" : "s"
}`
: "No high-risk cases"
)

setText(
els.escalationNotificationValue,
escalatedLike
? `${formatNumber(escalatedLike)} escalated / frozen`
: "No escalations"
)

const filterParts = []

if (state.filters.status) {
filterParts.push(`status:${state.filters.status}`)
}

if (state.filters.caseType) {
filterParts.push(`type:${state.filters.caseType}`)
}

if (state.filters.riskLevel) {
filterParts.push(`risk:${state.filters.riskLevel}`)
}

if (state.filters.assignedTo) {
filterParts.push(`assigned:${state.filters.assignedTo}`)
}

setText(
els.heroFilterValue,
filterParts.length ? filterParts.join(" • ") : "All cases"
)

const selected = getSelectedCase()

setText(
els.heroSelectedValue,
selected
? `#${selected.id} ${titleCase(
cleanText(selected.case_type, 40) || "case"
)}`
: "None selected"
)

setText(
els.heroReviewStateValue,
selected
? titleCase(getCaseStatus(selected))
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

const caseCell = createStackedCell({
primary: `#${safeNumber(item.id, 0)}`,
secondary: titleCase(caseType),
strong: true,
})

const statusCell = document.createElement("td")
statusCell.appendChild(
createPill(titleCase(status), getStatusVariant(status))
)

const riskCell = document.createElement("td")
riskCell.appendChild(
createPill(titleCase(riskLevel), getRiskVariant(riskLevel))
)

const walletCell = createStackedCell({
primary: wallet ? shortenWallet(wallet) : "—",
secondary: profileName || "No profile name",
mono: true,
})

const launchCell = createStackedCell({
primary: launchName,
secondary: launchSymbol || "—",
})

const assignedCell = createStackedCell({
primary: cleanText(item.assigned_to, 120) || "Unassigned",
secondary: cleanText(item.approved_by, 120),
})

const updatedCell = createStackedCell({
primary: formatDateTime(item.updated_at || item.created_at),
secondary: formatDateTime(item.created_at),
})

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
if (els.caseDetailEmpty) {
els.caseDetailEmpty.style.display = "grid"
}

if (els.caseDetailPanel) {
els.caseDetailPanel.style.display = "none"
}

updateCaseControlDisabledState()

return
}

if (els.caseDetailEmpty) {
els.caseDetailEmpty.style.display = "none"
}

if (els.caseDetailPanel) {
els.caseDetailPanel.style.display = "grid"
}

const caseType = cleanText(item.case_type, 40) || "—"
const status = getCaseStatus(item)
const riskLevel = getCaseRiskLevel(item)
const riskScore = safeNumber(item.risk_score, 0)

setText(els.detailCaseId, `#${item.id}`)
setText(els.detailCaseType, titleCase(caseType))
setText(els.detailStatus, titleCase(status))
setText(els.detailRisk, `${titleCase(riskLevel)} / ${riskScore}`)

setText(
els.detailReviewReason,
cleanText(item.review_reason, 5000) || "—"
)

setText(els.detailWallet, getCaseWallet(item) || "—")

setText(
els.detailProfileType,
titleCase(cleanText(item.profile?.profile_type, 40) || "—")
)

setText(
els.detailProfileStatus,
titleCase(cleanText(item.profile?.status, 40) || "—")
)

setText(
els.detailProfileRisk,
titleCase(cleanText(item.profile?.risk_rating, 40) || "—")
)

setText(
els.detailCountry,
cleanText(item.profile?.country_code, 20) || "—"
)

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
titleCase(
cleanText(item.launch?.status || item.launch_status, 80) || "—"
)
)

setText(
els.detailLaunchTemplate,
titleCase(
cleanText(item.launch?.template || item.launch_template, 80) || "—"
)
)

setText(
els.detailBuilderWallet,
cleanText(item.launch?.builder_wallet || item.builder_wallet, 200) || "—"
)

setValue(els.assignedToInput, cleanText(item.assigned_to, 120))
setValue(els.actionNotes, "")
setValue(els.escalationRiskLevel, getEscalationRiskInputValue(item))

updateCaseControlDisabledState()
}

function buildCaseQueryString() {
const params = new URLSearchParams()

if (state.filters.status) {
params.set("status", state.filters.status)
}

if (state.filters.caseType) {
params.set("case_type", state.filters.caseType)
}

if (state.filters.riskLevel) {
params.set("risk_level", state.filters.riskLevel)
}

if (state.filters.assignedTo) {
params.set("assigned_to", state.filters.assignedTo)
}

return params.toString()
}

async function fetchCaseDetailData(caseId) {
const payload = await apiFetchComplianceAdmin(
`/cases/${encodeURIComponent(caseId)}`
)

const item = payload?.case || null

if (!item) {
throw new Error("Case detail was empty.")
}

state.selectedCaseId = Number(caseId)
state.selectedCase = item

state.cases = state.cases.map((existing) =>
Number(existing.id) === Number(item.id)
? { ...existing, ...item }
: existing
)

renderCasesTable()
renderCaseDetail(item)
updateComplianceSummary()

return item
}

async function fetchCasesData() {
const queryString = buildCaseQueryString()

const payload = await apiFetchComplianceAdmin(
`/cases${queryString ? `?${queryString}` : ""}`
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

renderCasesTable()
updateComplianceSummary()

if (state.selectedCaseId) {
await fetchCaseDetailData(state.selectedCaseId)
} else {
renderCaseDetail(null)
}

return state.cases
}

async function loadCases({
showSuccess = false,
manageLoading = true,
} = {}) {
if (manageLoading) {
beginCasesLoading()
}

try {
await fetchCasesData()

if (showSuccess) {
setCaseBanner("Compliance cases refreshed.", "good")
} else {
clearCaseBanner()
}

return state.cases
} catch (error) {
if (!handleAdminApiAuthorizationError(error)) {
setCaseBanner(
error?.message || "Failed to load compliance cases.",
"bad"
)
}

return null
} finally {
if (manageLoading) {
endCasesLoading()
}
}
}

async function loadCaseDetail(
caseId,
{ quiet = false, manageLoading = true } = {}
) {
if (!caseId) return null

if (manageLoading) {
beginCasesLoading()
}

try {
const item = await fetchCaseDetailData(caseId)

if (!quiet) {
clearCaseBanner()
}

return item
} catch (error) {
if (!handleAdminApiAuthorizationError(error) && !quiet) {
setCaseBanner(
error?.message || "Failed to load case detail.",
"bad"
)
}

return null
} finally {
if (manageLoading) {
endCasesLoading()
}
}
}

function syncCaseFiltersFromInputs() {
state.filters.status = cleanText(
els.filterStatus?.value,
32
).toLowerCase()

state.filters.caseType = cleanText(
els.filterCaseType?.value,
32
).toLowerCase()

state.filters.riskLevel = cleanText(
els.filterRiskLevel?.value,
32
).toLowerCase()

state.filters.assignedTo = cleanText(
els.filterAssignedTo?.value,
120
)
}

function getActionNotes() {
return cleanText(els.actionNotes?.value, 2000)
}

async function postCaseAction(
path,
body = {},
successMessage = "Action completed."
) {
if (!state.selectedCaseId) {
setCaseBanner("Select a compliance case first.", "warn")
return
}

const caseId = state.selectedCaseId

beginCasesLoading()

try {
await apiFetchComplianceAdmin(
`/cases/${encodeURIComponent(caseId)}${path}`,
{
method: "POST",
body: JSON.stringify({
...body,
actor_id: getSessionActorId(),
}),
}
)

await fetchCasesData()

setCaseBanner(successMessage, "good")
} catch (error) {
if (!handleAdminApiAuthorizationError(error)) {
setCaseBanner(error?.message || "Case action failed.", "bad")
}
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
await loadCases({ showSuccess: true })
})

els.approveCaseButton?.addEventListener("click", async () => {
await postCaseAction(
"/approve",
{
notes: getActionNotes(),
},
"Compliance case approved."
)
})

els.rejectCaseButton?.addEventListener("click", async () => {
const confirmed = window.confirm(
"Reject the selected compliance case?"
)

if (!confirmed) return

await postCaseAction(
"/reject",
{
notes: getActionNotes(),
},
"Compliance case rejected."
)
})

els.freezeCaseButton?.addEventListener("click", async () => {
const confirmed = window.confirm(
"Freeze the selected compliance case?"
)

if (!confirmed) return

await postCaseAction(
"/freeze",
{
notes: getActionNotes(),
},
"Compliance case frozen."
)
})

els.escalateCaseButton?.addEventListener("click", async () => {
await postCaseAction(
"/escalate",
{
notes: getActionNotes(),
risk_level:
cleanText(els.escalationRiskLevel?.value, 32).toLowerCase() ||
"high",
},
"Compliance case escalated."
)
})

els.assignCaseButton?.addEventListener("click", async () => {
const assignedTo = cleanText(els.assignedToInput?.value, 120)

if (!assignedTo) {
setCaseBanner(
"Enter an assignee before assigning the case.",
"warn"
)

return
}

await postCaseAction(
"/assign",
{
assigned_to: assignedTo,
notes: getActionNotes(),
},
"Compliance case assigned."
)
})

window.addEventListener(ADMIN_SESSION_INVALID_EVENT, (event) => {
const detail = event?.detail || {}

handleAdminApiAuthorizationError({
status: detail.status || 401,
payload: detail.payload || null,
})
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
clearCaseBanner()
}

async function init() {
initDefaults()
bindCaseActions()
syncCaseFiltersFromInputs()

await waitForAuthenticatedAdminSession()
await loadCases()
}

init().catch((error) => {
console.error("Failed to initialize compliance admin page", error)

if (!handleAdminApiAuthorizationError(error)) {
setCaseBanner(
error?.message || "Failed to initialize compliance admin page.",
"bad"
)
}
})
