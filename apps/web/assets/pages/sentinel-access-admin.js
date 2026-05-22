import {
apiFetch,
arrayify,
cleanText,
createPill,
formatDateTime,
formatNumber,
renderTableEmpty,
safeNumber,
setBanner,
clearBanner,
setDisabled,
setText,
setValue,
shortenWallet,
titleCase,
} from "./admin-core.js"

const REQUIRED_ADMIN_SCOPE = "sentinel_access"
const ADMIN_SESSION_READY_EVENT = "mss:admin-session-ready"

const state = {
adminSession: null,
summary: null,
codes: [],
redemptions: [],
entitlements: [],
selectedCodeId: null,
selectedCode: null,
selectedCodeRedemptions: [],
selectedCodeEntitlements: [],
loadingCount: 0,
filters: {
codeState: "",
codeType: "",
planKey: "",
boundUserId: "",
redemptionCode: "",
redemptionUserId: "",
redemptionStatus: "",
},
}

const els = {
apiStatusChip: document.getElementById("apiStatusChip"),
sentinelAccessStateChip: document.getElementById("sentinelAccessStateChip"),
sentinelAccessBanner: document.getElementById("sentinelAccessBanner"),

refreshSentinelAccessAdminButton: document.getElementById(
"refreshSentinelAccessAdminButton"
),
createSentinelAccessCodeButton: document.getElementById(
"createSentinelAccessCodeButton"
),

sentinelAccessTotalCodesValue: document.getElementById(
"sentinelAccessTotalCodesValue"
),
sentinelAccessActiveCodesValue: document.getElementById(
"sentinelAccessActiveCodesValue"
),
sentinelAccessRedeemedCodesValue: document.getElementById(
"sentinelAccessRedeemedCodesValue"
),
sentinelAccessLiveEntitlementsValue: document.getElementById(
"sentinelAccessLiveEntitlementsValue"
),

sentinelAccessCustomCodeInput: document.getElementById(
"sentinelAccessCustomCodeInput"
),
sentinelAccessCodeTypeInput: document.getElementById(
"sentinelAccessCodeTypeInput"
),
sentinelAccessMaxRedemptionsInput: document.getElementById(
"sentinelAccessMaxRedemptionsInput"
),
sentinelAccessPlanKeyInput: document.getElementById(
"sentinelAccessPlanKeyInput"
),
sentinelAccessPlanLabelInput: document.getElementById(
"sentinelAccessPlanLabelInput"
),
sentinelAccessDurationDaysInput: document.getElementById(
"sentinelAccessDurationDaysInput"
),
sentinelAccessBoundUserIdInput: document.getElementById(
"sentinelAccessBoundUserIdInput"
),
sentinelAccessStartsAtInput: document.getElementById(
"sentinelAccessStartsAtInput"
),
sentinelAccessExpiresAtInput: document.getElementById(
"sentinelAccessExpiresAtInput"
),
sentinelAccessCreatedByUserIdInput: document.getElementById(
"sentinelAccessCreatedByUserIdInput"
),
sentinelAccessNotesInput: document.getElementById(
"sentinelAccessNotesInput"
),
sentinelAccessGeneratedCodeValue: document.getElementById(
"sentinelAccessGeneratedCodeValue"
),
sentinelAccessActorIdInput: document.getElementById(
"sentinelAccessActorIdInput"
),

sentinelAccessCodesActiveFilter: document.getElementById(
"sentinelAccessCodesActiveFilter"
),
sentinelAccessCodesTypeFilter: document.getElementById(
"sentinelAccessCodesTypeFilter"
),
sentinelAccessCodesPlanFilter: document.getElementById(
"sentinelAccessCodesPlanFilter"
),
sentinelAccessCodesBoundUserFilter: document.getElementById(
"sentinelAccessCodesBoundUserFilter"
),
refreshSentinelAccessCodesButton: document.getElementById(
"refreshSentinelAccessCodesButton"
),
sentinelAccessCodesTableBody: document.getElementById(
"sentinelAccessCodesTableBody"
),

sentinelAccessRedemptionsCodeFilter: document.getElementById(
"sentinelAccessRedemptionsCodeFilter"
),
sentinelAccessRedemptionsUserFilter: document.getElementById(
"sentinelAccessRedemptionsUserFilter"
),
sentinelAccessRedemptionsStatusFilter: document.getElementById(
"sentinelAccessRedemptionsStatusFilter"
),
refreshSentinelAccessRedemptionsButton: document.getElementById(
"refreshSentinelAccessRedemptionsButton"
),
sentinelAccessRedemptionsTableBody: document.getElementById(
"sentinelAccessRedemptionsTableBody"
),

sentinelAccessCodeDetailEmpty: document.getElementById(
"sentinelAccessCodeDetailEmpty"
),
sentinelAccessCodeDetailPanel: document.getElementById(
"sentinelAccessCodeDetailPanel"
),

sentinelAccessDetailCodeId: document.getElementById(
"sentinelAccessDetailCodeId"
),
sentinelAccessDetailCodeValue: document.getElementById(
"sentinelAccessDetailCodeValue"
),
sentinelAccessDetailCodeType: document.getElementById(
"sentinelAccessDetailCodeType"
),
sentinelAccessDetailCodeState: document.getElementById(
"sentinelAccessDetailCodeState"
),
sentinelAccessDetailPlanKey: document.getElementById(
"sentinelAccessDetailPlanKey"
),
sentinelAccessDetailPlanLabel: document.getElementById(
"sentinelAccessDetailPlanLabel"
),
sentinelAccessDetailDurationDays: document.getElementById(
"sentinelAccessDetailDurationDays"
),
sentinelAccessDetailMaxRedemptions: document.getElementById(
"sentinelAccessDetailMaxRedemptions"
),
sentinelAccessDetailRedeemedCount: document.getElementById(
"sentinelAccessDetailRedeemedCount"
),
sentinelAccessDetailBoundUserId: document.getElementById(
"sentinelAccessDetailBoundUserId"
),
sentinelAccessDetailStartsAt: document.getElementById(
"sentinelAccessDetailStartsAt"
),
sentinelAccessDetailExpiresAt: document.getElementById(
"sentinelAccessDetailExpiresAt"
),
sentinelAccessDetailCreatedByUserId: document.getElementById(
"sentinelAccessDetailCreatedByUserId"
),
sentinelAccessDetailCreatedAt: document.getElementById(
"sentinelAccessDetailCreatedAt"
),
sentinelAccessDetailUpdatedAt: document.getElementById(
"sentinelAccessDetailUpdatedAt"
),
sentinelAccessDetailLatestRedemptionAt: document.getElementById(
"sentinelAccessDetailLatestRedemptionAt"
),
sentinelAccessDetailNotes: document.getElementById(
"sentinelAccessDetailNotes"
),

sentinelAccessCodeActionActorIdInput: document.getElementById(
"sentinelAccessCodeActionActorIdInput"
),
sentinelAccessCodeActionNotesInput: document.getElementById(
"sentinelAccessCodeActionNotesInput"
),
sentinelAccessCopyCodeButton: document.getElementById(
"sentinelAccessCopyCodeButton"
),
sentinelAccessDeactivateCodeButton: document.getElementById(
"sentinelAccessDeactivateCodeButton"
),
sentinelAccessActivateCodeButton: document.getElementById(
"sentinelAccessActivateCodeButton"
),
sentinelAccessRefreshSelectedCodeButton: document.getElementById(
"sentinelAccessRefreshSelectedCodeButton"
),
}

function parseBool(value, fallback = false) {
if (typeof value === "boolean") return value

if (typeof value === "number") {
return value !== 0
}

const normalized = cleanText(value, 32).toLowerCase()

if (["true", "1", "yes", "y", "enabled", "on", "active"].includes(normalized)) {
return true
}

if (["false", "0", "no", "n", "disabled", "off", "inactive"].includes(normalized)) {
return false
}

return fallback
}

function isLoading() {
return state.loadingCount > 0
}

function setSentinelAccessBanner(message = "", variant = "warn") {
setBanner(els.sentinelAccessBanner, message, variant)
}

function clearSentinelAccessBanner() {
clearBanner(els.sentinelAccessBanner)
}

function refreshApiStatus() {
const label = isLoading() ? "Loading" : "Ready"

setText(els.apiStatusChip, label)
setText(els.sentinelAccessStateChip, label)
}

function updateControlDisabledState() {
const disabled = isLoading()
const hasSelectedCode = Boolean(state.selectedCodeId)

setDisabled(
[
els.refreshSentinelAccessAdminButton,
els.createSentinelAccessCodeButton,
els.refreshSentinelAccessCodesButton,
els.refreshSentinelAccessRedemptionsButton,
],
disabled
)

setDisabled(
[
els.sentinelAccessCopyCodeButton,
els.sentinelAccessDeactivateCodeButton,
els.sentinelAccessActivateCodeButton,
els.sentinelAccessRefreshSelectedCodeButton,
],
disabled || !hasSelectedCode
)
}

function beginLoading() {
state.loadingCount += 1
refreshApiStatus()
updateControlDisabledState()
}

function endLoading() {
state.loadingCount = Math.max(0, state.loadingCount - 1)
refreshApiStatus()
updateControlDisabledState()
}

function getSessionActorId() {
return (
cleanText(state.adminSession?.actor, 120) ||
cleanText(window.__MSS_ADMIN_SESSION__?.actor, 120) ||
"admin"
)
}

function applyAuthenticatedActorToInputs() {
const actorId = getSessionActorId()

setValue(els.sentinelAccessActorIdInput, actorId)
setValue(els.sentinelAccessCodeActionActorIdInput, actorId)

;[
els.sentinelAccessActorIdInput,
els.sentinelAccessCodeActionActorIdInput,
].forEach((input) => {
if (!input) return

input.readOnly = true
input.title = "Audit actor is taken from the authenticated admin session."
input.setAttribute("aria-readonly", "true")
})
}

function acceptAdminSession(session) {
if (!session || !Array.isArray(session.scopes)) return null

state.adminSession = session
applyAuthenticatedActorToInputs()

return session
}

function getExistingAdminSession() {
const session = window.__MSS_ADMIN_SESSION__

if (session?.scopes?.length) {
return acceptAdminSession(session)
}

const guardState = window.MSSAdminSessionGuard?.getState?.()

if (guardState?.authenticated && guardState?.session) {
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

if (session) {
resolve(session)
}
}

window.addEventListener(ADMIN_SESSION_READY_EVENT, onReady, {
once: true,
})
})
}

function handleAdminApiAuthorizationError(error) {
if (error?.status === 401) {
setSentinelAccessBanner(
"Your admin session has expired. Returning to secure sign-in.",
"bad"
)

window.MSSAdminSessionGuard
?.requireAdminSession?.({
requiredScope: REQUIRED_ADMIN_SCOPE,
redirectUnauthenticated: true,
})
.catch(() => {})

return
}

if (error?.status === 403) {
setSentinelAccessBanner(
"Your authenticated admin session does not have permission to manage Sentinel access codes.",
"bad"
)
}
}

async function apiFetchSentinelAccessAdmin(path, options = {}) {
try {
return await apiFetch(`/api/sentinel-access-admin${path}`, options)
} catch (error) {
handleAdminApiAuthorizationError(error)
throw error
}
}

function getOptionalNumber(inputEl, fallback, label, options = {}) {
if (!inputEl) return fallback

const raw = cleanText(inputEl.value, 120)

if (!raw.length) return fallback

const value = Number(raw)

if (!Number.isFinite(value)) {
throw new Error(`${label} must be a valid number.`)
}

if (options.min != null && value < options.min) {
throw new Error(`${label} must be at least ${options.min}.`)
}

if (options.max != null && value > options.max) {
throw new Error(`${label} must be no more than ${options.max}.`)
}

return value
}

function coerceDateTimeLocalToIso(value) {
const raw = cleanText(value, 120)

if (!raw) return null

const date = new Date(raw)

if (Number.isNaN(date.getTime())) return null

return date.toISOString()
}

function getSentinelAccessCreateActorId() {
return getSessionActorId()
}

function getSentinelAccessActionActorId() {
return getSessionActorId()
}

function getSentinelAccessActionNotes() {
return cleanText(els.sentinelAccessCodeActionNotesInput?.value, 2000)
}

function getSentinelAccessCodeState(code) {
const explicit = cleanText(code?.state, 64).toLowerCase()

if (explicit) return explicit

const isActive = parseBool(code?.is_active, false)
const redeemedCount = safeNumber(code?.redeemed_count, 0)
const maxRedemptions = safeNumber(code?.max_redemptions, 0)
const now = Date.now()

const startsAtTs = code?.starts_at
? new Date(code.starts_at).getTime()
: null

const expiresAtTs = code?.expires_at
? new Date(code.expires_at).getTime()
: null

if (!isActive) return "inactive"

if (startsAtTs && !Number.isNaN(startsAtTs) && startsAtTs > now) {
return "scheduled"
}

if (expiresAtTs && !Number.isNaN(expiresAtTs) && expiresAtTs <= now) {
return "expired"
}

if (maxRedemptions > 0 && redeemedCount >= maxRedemptions) {
return "exhausted"
}

return "active"
}

function getSentinelAccessStateVariant(codeState) {
const normalized = cleanText(codeState, 64).toLowerCase()

if (normalized === "active") return "good"
if (normalized === "scheduled" || normalized === "exhausted") return "warn"
if (normalized === "inactive") return "bad"
if (normalized === "expired") return "neutral"

return "neutral"
}

function getRedemptionStatusVariant(status) {
const normalized = cleanText(status, 64).toLowerCase()

if (normalized === "success") return "good"
if (normalized === "failed") return "bad"

return "neutral"
}

function isLiveEntitlement(entitlement) {
const status = cleanText(entitlement?.status, 64).toLowerCase()

if (status !== "active") return false

const now = Date.now()

const startsAt = entitlement?.starts_at
? new Date(entitlement.starts_at).getTime()
: null

const endsAt = entitlement?.ends_at
? new Date(entitlement.ends_at).getTime()
: null

if (startsAt && !Number.isNaN(startsAt) && startsAt > now) return false
if (endsAt && !Number.isNaN(endsAt) && endsAt <= now) return false

return true
}

function updateSentinelAccessSummary() {
const summary = state.summary || {}

const fallbackActiveCodes = state.codes.filter((code) => {
return getSentinelAccessCodeState(code) === "active"
}).length

const fallbackRedeemedCount = state.codes.reduce((total, code) => {
return total + safeNumber(code?.redeemed_count, 0)
}, 0)

const totalCodes = safeNumber(
summary.total_codes ?? summary.totalCodes,
state.codes.length
)

const activeCodes = safeNumber(
summary.active_codes ?? summary.activeCodes,
fallbackActiveCodes
)

const redeemedCount = safeNumber(
summary.total_redemptions ??
summary.totalRedemptions ??
summary.redeemed_codes ??
summary.redeemedCodes,
fallbackRedeemedCount
)

const liveEntitlements = state.entitlements.filter(isLiveEntitlement).length

setText(els.sentinelAccessTotalCodesValue, formatNumber(totalCodes, 0))
setText(els.sentinelAccessActiveCodesValue, formatNumber(activeCodes, 0))
setText(els.sentinelAccessRedeemedCodesValue, formatNumber(redeemedCount, 0))
setText(
els.sentinelAccessLiveEntitlementsValue,
formatNumber(liveEntitlements, 0)
)
}

function syncFiltersFromInputs() {
state.filters.codeState = cleanText(
els.sentinelAccessCodesActiveFilter?.value,
64
).toLowerCase()

state.filters.codeType = cleanText(
els.sentinelAccessCodesTypeFilter?.value,
64
).toLowerCase()

state.filters.planKey = cleanText(
els.sentinelAccessCodesPlanFilter?.value,
120
)

state.filters.boundUserId = cleanText(
els.sentinelAccessCodesBoundUserFilter?.value,
64
)

state.filters.redemptionCode = cleanText(
els.sentinelAccessRedemptionsCodeFilter?.value,
128
)

state.filters.redemptionUserId = cleanText(
els.sentinelAccessRedemptionsUserFilter?.value,
64
)

state.filters.redemptionStatus = cleanText(
els.sentinelAccessRedemptionsStatusFilter?.value,
64
).toLowerCase()
}

function filterCodes(items) {
return arrayify(items).filter((code) => {
const codeState = getSentinelAccessCodeState(code)
const wantedState = cleanText(state.filters.codeState, 64).toLowerCase()
const wantedType = cleanText(state.filters.codeType, 64).toLowerCase()
const wantedPlan = cleanText(state.filters.planKey, 120).toLowerCase()
const wantedBoundUserId = cleanText(state.filters.boundUserId, 64)

if (wantedState === "active" && codeState !== "active") return false
if (wantedState === "inactive" && codeState === "active") return false

if (
wantedType &&
cleanText(code.code_type, 64).toLowerCase() !== wantedType
) {
return false
}

if (wantedPlan) {
const haystack = [
cleanText(code.plan_key, 120),
cleanText(code.plan_label, 120),
cleanText(code.code, 128),
]
.join(" ")
.toLowerCase()

if (!haystack.includes(wantedPlan)) return false
}

if (
wantedBoundUserId &&
String(code.bound_user_id || "") !== wantedBoundUserId
) {
return false
}

return true
})
}

function filterRedemptions(items) {
return arrayify(items).filter((redemption) => {
const wantedCode = cleanText(
state.filters.redemptionCode,
128
).toLowerCase()

const wantedUserId = cleanText(state.filters.redemptionUserId, 64)
const wantedStatus = cleanText(
state.filters.redemptionStatus,
64
).toLowerCase()

if (wantedCode) {
const haystack = [
cleanText(redemption.code, 128),
cleanText(redemption.wallet_address_at_redeem, 200),
]
.join(" ")
.toLowerCase()

if (!haystack.includes(wantedCode)) return false
}

if (
wantedUserId &&
String(redemption.user_id || "") !== wantedUserId
) {
return false
}

if (
wantedStatus &&
cleanText(redemption.redemption_status, 64).toLowerCase() !==
wantedStatus
) {
return false
}

return true
})
}

function buildCodesQueryString() {
const params = new URLSearchParams()

if (state.filters.codeType) {
params.set("code_type", state.filters.codeType)
}

if (state.filters.boundUserId) {
params.set("bound_user_id", state.filters.boundUserId)
}

if (state.filters.planKey) {
params.set("search", state.filters.planKey)
}

params.set("limit", "500")

return params.toString()
}

function buildRedemptionsQueryString() {
const params = new URLSearchParams()

if (state.filters.redemptionUserId) {
params.set("user_id", state.filters.redemptionUserId)
}

params.set("limit", "500")

return params.toString()
}

function renderCodesTable() {
const tbody = els.sentinelAccessCodesTableBody

if (!tbody) return

tbody.innerHTML = ""

if (!state.codes.length) {
renderTableEmpty(
tbody,
8,
"No Sentinel access codes found for the current filter set."
)
return
}

state.codes.forEach((code) => {
const row = document.createElement("tr")

if (Number(code.id) === Number(state.selectedCodeId)) {
row.classList.add("active")
}

const codeState = getSentinelAccessCodeState(code)

const codeCell = document.createElement("td")
codeCell.innerHTML = `
<div class="mono" style="font-weight:700;">${cleanText(code.code, 128) || "—"}</div>
<div class="dim">${cleanText(code.notes, 120) || ""}</div>
`

const typeCell = document.createElement("td")
typeCell.appendChild(
createPill(titleCase(code.code_type || "trial"), "neutral")
)

const planCell = document.createElement("td")
planCell.innerHTML = `
<div>${cleanText(code.plan_label, 120) || "—"}</div>
<div class="dim">${cleanText(code.plan_key, 120) || "—"}</div>
`

const stateCell = document.createElement("td")
stateCell.appendChild(
createPill(
titleCase(codeState),
getSentinelAccessStateVariant(codeState)
)
)

const usageCell = document.createElement("td")
const redeemedCount = safeNumber(code.redeemed_count, 0)
const maxRedemptions = safeNumber(code.max_redemptions, 0)

usageCell.innerHTML = `
<div>${formatNumber(redeemedCount, 0)} / ${formatNumber(maxRedemptions, 0)}</div>
<div class="dim">${formatNumber(Math.max(0, maxRedemptions - redeemedCount), 0)} remaining</div>
`

const boundCell = document.createElement("td")
boundCell.innerHTML = `
<div>${code.bound_user_id ? `#${code.bound_user_id}` : "Unbound"}</div>
<div class="dim">${cleanText(code.bound_user_email, 160) || ""}</div>
`

const windowCell = document.createElement("td")
windowCell.innerHTML = `
<div>${code.starts_at ? `Starts ${formatDateTime(code.starts_at)}` : "Starts immediately"}</div>
<div class="dim">${code.expires_at ? `Expires ${formatDateTime(code.expires_at)}` : "No absolute expiry"}</div>
`

const updatedCell = document.createElement("td")
updatedCell.innerHTML = `
<div>${formatDateTime(code.updated_at || code.created_at)}</div>
<div class="dim">${formatDateTime(code.created_at)}</div>
`

;[
codeCell,
typeCell,
planCell,
stateCell,
usageCell,
boundCell,
windowCell,
updatedCell,
].forEach((cell) => row.appendChild(cell))

row.addEventListener("click", async () => {
await loadCodeDetail(code.id)
})

tbody.appendChild(row)
})
}

function renderRedemptionsTable() {
const tbody = els.sentinelAccessRedemptionsTableBody

if (!tbody) return

tbody.innerHTML = ""

if (!state.redemptions.length) {
renderTableEmpty(
tbody,
6,
"No Sentinel access redemptions found for the current filter set."
)
return
}

state.redemptions.forEach((redemption) => {
const row = document.createElement("tr")

const redeemedAtCell = document.createElement("td")
redeemedAtCell.innerHTML = `
<div>${formatDateTime(redemption.redeemed_at || redemption.created_at)}</div>
<div class="dim">#${safeNumber(redemption.id, 0)}</div>
`

const codeCell = document.createElement("td")
codeCell.innerHTML = `
<div class="mono">${cleanText(redemption.code, 128) || "—"}</div>
<div class="dim">Code #${safeNumber(redemption.code_id, 0)}</div>
`

const userCell = document.createElement("td")
userCell.innerHTML = `
<div>${redemption.user_id ? `#${redemption.user_id}` : "—"}</div>
<div class="dim">${cleanText(redemption.user_email, 160) || ""}</div>
`

const entitlementCell = document.createElement("td")
entitlementCell.textContent = redemption.entitlement_id
? `#${redemption.entitlement_id}`
: "—"

const walletCell = document.createElement("td")
walletCell.innerHTML = `
<div class="mono">${
redemption.wallet_address_at_redeem
? shortenWallet(redemption.wallet_address_at_redeem)
: "—"
}</div>
<div class="dim">${cleanText(redemption.wallet_address_at_redeem, 200) || ""}</div>
`

const statusCell = document.createElement("td")
statusCell.appendChild(
createPill(
titleCase(redemption.redemption_status || "unknown"),
getRedemptionStatusVariant(redemption.redemption_status)
)
)

;[
redeemedAtCell,
codeCell,
userCell,
entitlementCell,
walletCell,
statusCell,
].forEach((cell) => row.appendChild(cell))

tbody.appendChild(row)
})
}

function renderCodeDetail(code, redemptions = [], entitlements = []) {
if (!code) {
if (els.sentinelAccessCodeDetailEmpty) {
els.sentinelAccessCodeDetailEmpty.style.display = "grid"
}

if (els.sentinelAccessCodeDetailPanel) {
els.sentinelAccessCodeDetailPanel.style.display = "none"
}

updateControlDisabledState()
return
}

if (els.sentinelAccessCodeDetailEmpty) {
els.sentinelAccessCodeDetailEmpty.style.display = "none"
}

if (els.sentinelAccessCodeDetailPanel) {
els.sentinelAccessCodeDetailPanel.style.display = "grid"
}

const codeState = getSentinelAccessCodeState(code)

const latestRedemption =
arrayify(redemptions)
.slice()
.sort((a, b) => {
const aTs = new Date(
a?.redeemed_at || a?.created_at || 0
).getTime()

const bTs = new Date(
b?.redeemed_at || b?.created_at || 0
).getTime()

return bTs - aTs
})[0] || null

setText(els.sentinelAccessDetailCodeId, code.id ? `#${code.id}` : "—")
setText(
els.sentinelAccessDetailCodeValue,
cleanText(code.code, 128) || "—"
)
setText(
els.sentinelAccessDetailCodeType,
titleCase(code.code_type || "trial")
)
setText(els.sentinelAccessDetailCodeState, titleCase(codeState))
setText(
els.sentinelAccessDetailPlanKey,
cleanText(code.plan_key, 120) || "—"
)
setText(
els.sentinelAccessDetailPlanLabel,
cleanText(code.plan_label, 120) || "—"
)
setText(
els.sentinelAccessDetailDurationDays,
formatNumber(code.duration_days, 0)
)
setText(
els.sentinelAccessDetailMaxRedemptions,
formatNumber(code.max_redemptions, 0)
)

setText(
els.sentinelAccessDetailRedeemedCount,
`${formatNumber(code.redeemed_count, 0)}${
entitlements.length
? ` • ${entitlements.length} entitlement${entitlements.length === 1 ? "" : "s"}`
: ""
}`
)

setText(
els.sentinelAccessDetailBoundUserId,
code.bound_user_id
? `#${code.bound_user_id}${
code.bound_user_email ? ` • ${code.bound_user_email}` : ""
}`
: "Unbound"
)

setText(els.sentinelAccessDetailStartsAt, formatDateTime(code.starts_at))
setText(els.sentinelAccessDetailExpiresAt, formatDateTime(code.expires_at))

setText(
els.sentinelAccessDetailCreatedByUserId,
code.created_by_user_id ? `#${code.created_by_user_id}` : "—"
)

setText(
els.sentinelAccessDetailCreatedAt,
formatDateTime(code.created_at)
)

setText(
els.sentinelAccessDetailUpdatedAt,
formatDateTime(code.updated_at)
)

setText(
els.sentinelAccessDetailLatestRedemptionAt,
latestRedemption
? `${formatDateTime(
latestRedemption.redeemed_at || latestRedemption.created_at
)}${
latestRedemption.user_id
? ` • #${latestRedemption.user_id}`
: ""
}`
: "—"
)

setText(
els.sentinelAccessDetailNotes,
cleanText(code.notes, 5000) || "—"
)

applyAuthenticatedActorToInputs()
updateControlDisabledState()
}

async function loadSummary({ manageLoading = true } = {}) {
if (manageLoading) beginLoading()

try {
const payload = await apiFetchSentinelAccessAdmin("/summary")

state.summary = payload?.summary || null

updateSentinelAccessSummary()

return state.summary
} finally {
if (manageLoading) endLoading()
}
}

async function loadCodes({ manageLoading = true } = {}) {
if (manageLoading) beginLoading()

try {
const queryString = buildCodesQueryString()

const payload = await apiFetchSentinelAccessAdmin(
`/codes${queryString ? `?${queryString}` : ""}`
)

state.codes = filterCodes(payload?.codes)

if (state.selectedCodeId) {
const stillVisible = state.codes.some(
(code) => Number(code.id) === Number(state.selectedCodeId)
)

if (!stillVisible) {
state.selectedCodeId = null
state.selectedCode = null
state.selectedCodeRedemptions = []
state.selectedCodeEntitlements = []
}
}

renderCodesTable()

renderCodeDetail(
state.selectedCode,
state.selectedCodeRedemptions,
state.selectedCodeEntitlements
)

updateSentinelAccessSummary()

return state.codes
} finally {
if (manageLoading) endLoading()
}
}

async function loadRedemptions({ manageLoading = true } = {}) {
if (manageLoading) beginLoading()

try {
const queryString = buildRedemptionsQueryString()

const payload = await apiFetchSentinelAccessAdmin(
`/redemptions${queryString ? `?${queryString}` : ""}`
)

state.redemptions = filterRedemptions(payload?.redemptions)

renderRedemptionsTable()
updateSentinelAccessSummary()

return state.redemptions
} finally {
if (manageLoading) endLoading()
}
}

async function loadEntitlements({ manageLoading = true } = {}) {
if (manageLoading) beginLoading()

try {
const payload = await apiFetchSentinelAccessAdmin(
"/entitlements?limit=500"
)

state.entitlements = arrayify(payload?.entitlements)

updateSentinelAccessSummary()

return state.entitlements
} finally {
if (manageLoading) endLoading()
}
}

async function loadCodeDetail(
codeId,
{ quiet = false, manageLoading = true } = {}
) {
if (!codeId) return null

if (manageLoading) beginLoading()

try {
const payload = await apiFetchSentinelAccessAdmin(
`/codes/${encodeURIComponent(codeId)}`
)

const code = payload?.code || null

if (!code) {
throw new Error("Access code detail was empty.")
}

state.selectedCodeId = Number(codeId)
state.selectedCode = code
state.selectedCodeRedemptions = arrayify(payload?.redemptions)
state.selectedCodeEntitlements = arrayify(payload?.entitlements)

state.codes = state.codes.map((item) =>
Number(item.id) === Number(code.id) ? code : item
)

renderCodesTable()

renderCodeDetail(
state.selectedCode,
state.selectedCodeRedemptions,
state.selectedCodeEntitlements
)

if (!quiet) {
clearSentinelAccessBanner()
}

return code
} catch (error) {
if (!quiet) {
setSentinelAccessBanner(
error?.message || "Failed to load Sentinel access code.",
"bad"
)
}

throw error
} finally {
if (manageLoading) endLoading()
}
}

async function loadBundle({ showSuccess = false } = {}) {
beginLoading()

try {
syncFiltersFromInputs()

await loadSummary({ manageLoading: false })
await loadCodes({ manageLoading: false })
await loadRedemptions({ manageLoading: false })
await loadEntitlements({ manageLoading: false })

if (state.selectedCodeId) {
await loadCodeDetail(state.selectedCodeId, {
quiet: true,
manageLoading: false,
}).catch(() => {})
}

clearSentinelAccessBanner()

if (showSuccess) {
setSentinelAccessBanner("Sentinel access data refreshed.", "good")
}
} catch (error) {
setSentinelAccessBanner(
error?.message || "Failed to load Sentinel access data.",
"bad"
)
} finally {
endLoading()
}
}

function buildCreatePayload() {
const customCode = cleanText(
els.sentinelAccessCustomCodeInput?.value,
128
).toUpperCase()

const codeType =
cleanText(els.sentinelAccessCodeTypeInput?.value, 64).toLowerCase() ||
"trial"

const maxRedemptions = getOptionalNumber(
els.sentinelAccessMaxRedemptionsInput,
1,
"Max Redemptions",
{ min: 1 }
)

const planKey =
cleanText(els.sentinelAccessPlanKeyInput?.value, 120) ||
"sentinel_trial"

const planLabel =
cleanText(els.sentinelAccessPlanLabelInput?.value, 120) ||
"Early Access Trial"

const durationDays = getOptionalNumber(
els.sentinelAccessDurationDaysInput,
7,
"Duration Days",
{ min: 0 }
)

const boundUserId = cleanText(
els.sentinelAccessBoundUserIdInput?.value,
64
)

const createdByUserId = cleanText(
els.sentinelAccessCreatedByUserIdInput?.value,
64
)

const startsAt = coerceDateTimeLocalToIso(
els.sentinelAccessStartsAtInput?.value
)

const expiresAt = coerceDateTimeLocalToIso(
els.sentinelAccessExpiresAtInput?.value
)

const notes =
cleanText(els.sentinelAccessNotesInput?.value, 2000) || null

if (
startsAt &&
expiresAt &&
new Date(startsAt).getTime() >= new Date(expiresAt).getTime()
) {
throw new Error("Absolute Expiry must be later than Starts At.")
}

return {
quantity: 1,
prefix: "MSS",
custom_code: customCode || null,
code_type: codeType,
plan_key: planKey,
plan_label: planLabel,
duration_days: durationDays,
max_redemptions: maxRedemptions,
bound_user_id: boundUserId ? Number(boundUserId) : null,
starts_at: startsAt,
expires_at: expiresAt,
created_by_user_id: createdByUserId ? Number(createdByUserId) : null,
notes,
actor_id: getSentinelAccessCreateActorId(),
is_active: true,
}
}

async function createAccessCode() {
beginLoading()

try {
const body = buildCreatePayload()

const payload = await apiFetchSentinelAccessAdmin("/codes", {
method: "POST",
body: JSON.stringify(body),
})

const createdCodes = arrayify(payload?.codes)
const createdCode = createdCodes[0] || null

if (createdCode?.code) {
setValue(els.sentinelAccessGeneratedCodeValue, createdCode.code)
}

await loadSummary({ manageLoading: false })
await loadCodes({ manageLoading: false })
await loadRedemptions({ manageLoading: false })
await loadEntitlements({ manageLoading: false })

if (createdCode?.id) {
await loadCodeDetail(createdCode.id, {
quiet: true,
manageLoading: false,
})
}

setValue(els.sentinelAccessCustomCodeInput, "")
setValue(els.sentinelAccessNotesInput, "")

setSentinelAccessBanner(
createdCode?.code
? `Sentinel access code created: ${createdCode.code}`
: "Sentinel access code created.",
"good"
)
} catch (error) {
setSentinelAccessBanner(
error?.message || "Failed to create Sentinel access code.",
"bad"
)
} finally {
endLoading()
}
}

async function postCodeAction(
path,
successMessage = "Sentinel access code updated."
) {
const code = state.selectedCode

if (!code?.id) {
setSentinelAccessBanner("Select a Sentinel access code first.", "warn")
return
}

beginLoading()

try {
await apiFetchSentinelAccessAdmin(
`/codes/${encodeURIComponent(code.id)}${path}`,
{
method: "POST",
body: JSON.stringify({
actor_id: getSentinelAccessActionActorId(),
notes: getSentinelAccessActionNotes(),
}),
}
)

await loadSummary({ manageLoading: false })
await loadCodes({ manageLoading: false })
await loadRedemptions({ manageLoading: false })
await loadEntitlements({ manageLoading: false })

await loadCodeDetail(code.id, {
quiet: true,
manageLoading: false,
})

setSentinelAccessBanner(successMessage, "good")
} catch (error) {
setSentinelAccessBanner(
error?.message || "Failed to update access code.",
"bad"
)
} finally {
endLoading()
}
}

async function copySelectedCode() {
const codeValue = cleanText(state.selectedCode?.code, 128)

if (!codeValue) {
setSentinelAccessBanner("Select a Sentinel access code first.", "warn")
return
}

try {
if (navigator.clipboard?.writeText) {
await navigator.clipboard.writeText(codeValue)
setSentinelAccessBanner("Access code copied to clipboard.", "good")
return
}
} catch {}

window.prompt("Copy Sentinel access code", codeValue)
setSentinelAccessBanner("Access code ready to copy.", "good")
}

function buildDefaults() {
applyAuthenticatedActorToInputs()

if (!cleanText(els.sentinelAccessPlanKeyInput?.value, 120)) {
setValue(els.sentinelAccessPlanKeyInput, "sentinel_trial")
}

if (!cleanText(els.sentinelAccessPlanLabelInput?.value, 120)) {
setValue(els.sentinelAccessPlanLabelInput, "Early Access Trial")
}

if (!cleanText(els.sentinelAccessCodeTypeInput?.value, 64)) {
setValue(els.sentinelAccessCodeTypeInput, "trial")
}

if (!cleanText(els.sentinelAccessMaxRedemptionsInput?.value, 16)) {
setValue(els.sentinelAccessMaxRedemptionsInput, "1")
}

if (!cleanText(els.sentinelAccessDurationDaysInput?.value, 16)) {
setValue(els.sentinelAccessDurationDaysInput, "7")
}
}

function bindFilterShortcuts() {
;[
els.sentinelAccessCodesPlanFilter,
els.sentinelAccessCodesBoundUserFilter,
].forEach((input) => {
input?.addEventListener("keydown", async (event) => {
if (event.key !== "Enter") return

syncFiltersFromInputs()
await loadCodes()
})
})

;[
els.sentinelAccessRedemptionsCodeFilter,
els.sentinelAccessRedemptionsUserFilter,
].forEach((input) => {
input?.addEventListener("keydown", async (event) => {
if (event.key !== "Enter") return

syncFiltersFromInputs()
await loadRedemptions()
})
})

;[
els.sentinelAccessCodesActiveFilter,
els.sentinelAccessCodesTypeFilter,
].forEach((input) => {
input?.addEventListener("change", async () => {
syncFiltersFromInputs()
await loadCodes()
})
})

els.sentinelAccessRedemptionsStatusFilter?.addEventListener(
"change",
async () => {
syncFiltersFromInputs()
await loadRedemptions()
}
)
}

function bindActions() {
els.refreshSentinelAccessAdminButton?.addEventListener("click", async () => {
syncFiltersFromInputs()
await loadBundle({ showSuccess: true })
})

els.createSentinelAccessCodeButton?.addEventListener("click", async () => {
await createAccessCode()
})

els.refreshSentinelAccessCodesButton?.addEventListener("click", async () => {
beginLoading()

try {
syncFiltersFromInputs()
await loadCodes({ manageLoading: false })
clearSentinelAccessBanner()
} catch (error) {
setSentinelAccessBanner(
error?.message || "Failed to refresh access codes.",
"bad"
)
} finally {
endLoading()
}
})

els.refreshSentinelAccessRedemptionsButton?.addEventListener(
"click",
async () => {
beginLoading()

try {
syncFiltersFromInputs()
await loadRedemptions({ manageLoading: false })
clearSentinelAccessBanner()
} catch (error) {
setSentinelAccessBanner(
error?.message || "Failed to refresh redemptions.",
"bad"
)
} finally {
endLoading()
}
}
)

els.sentinelAccessCopyCodeButton?.addEventListener("click", async () => {
await copySelectedCode()
})

els.sentinelAccessDeactivateCodeButton?.addEventListener(
"click",
async () => {
const confirmed = window.confirm(
"Deactivate the selected Sentinel access code?"
)

if (!confirmed) return

await postCodeAction(
"/disable",
"Sentinel access code deactivated."
)
}
)

els.sentinelAccessActivateCodeButton?.addEventListener("click", async () => {
await postCodeAction(
"/enable",
"Sentinel access code reactivated."
)
})

els.sentinelAccessRefreshSelectedCodeButton?.addEventListener(
"click",
async () => {
if (!state.selectedCodeId) {
setSentinelAccessBanner(
"Select a Sentinel access code first.",
"warn"
)
return
}

beginLoading()

try {
await loadCodeDetail(state.selectedCodeId, {
quiet: true,
manageLoading: false,
})

clearSentinelAccessBanner()
} catch (error) {
setSentinelAccessBanner(
error?.message || "Failed to refresh selected access code.",
"bad"
)
} finally {
endLoading()
}
}
)

bindFilterShortcuts()
}

function initDefaults() {
buildDefaults()
updateSentinelAccessSummary()
renderCodesTable()
renderRedemptionsTable()
renderCodeDetail(null)
refreshApiStatus()
updateControlDisabledState()
}

async function init() {
initDefaults()
bindActions()
syncFiltersFromInputs()

await waitForAuthenticatedAdminSession()

buildDefaults()

await loadBundle()
}

init().catch((error) => {
console.error("Failed to initialize Sentinel access admin page", error)

setSentinelAccessBanner(
error?.message || "Failed to initialize Sentinel access admin.",
"bad"
)
})
