import {
ADMIN_SESSION_INVALID_EVENT,
ADMIN_SESSION_READY_EVENT,
apiFetch,
arrayify,
cleanText,
formatDateTime,
formatNumber,
formatSignedCurrency,
getAdminSessionSnapshot,
safeNumber,
setAdminSessionSnapshot,
setBanner,
setText,
titleCase,
todayIso,
} from "./admin-core.js"

const REQUIRED_ADMIN_SCOPE = "admin"

const state = {
adminSession: null,
loadingCount: 0,
reauthPending: false,
cases: [],
sentinel: null,
accessSummary: null,
accessEntitlements: [],
errors: [],
}

const els = {
refreshAdminButton: document.getElementById("refreshAdminButton"),
adminBanner: document.getElementById("adminBanner"),

complianceHealthChip: document.getElementById("complianceHealthChip"),
sentinelHealthChip: document.getElementById("sentinelHealthChip"),
accessHealthChip: document.getElementById("accessHealthChip"),

adminOpenCasesValue: document.getElementById("adminOpenCasesValue"),
adminOpenCasesValueMirror: document.getElementById("adminOpenCasesValueMirror"),
adminEscalatedCasesValue: document.getElementById("adminEscalatedCasesValue"),
adminResolvedCasesValue: document.getElementById("adminResolvedCasesValue"),
adminTotalCasesValue: document.getElementById("adminTotalCasesValue"),

adminSentinelModeValue: document.getElementById("adminSentinelModeValue"),
adminSentinelModeValueMirror: document.getElementById(
"adminSentinelModeValueMirror"
),
adminSentinelOpenPositionsValue: document.getElementById(
"adminSentinelOpenPositionsValue"
),
adminSentinelRealizedPnlValue: document.getElementById(
"adminSentinelRealizedPnlValue"
),
adminSentinelKillSwitchValue: document.getElementById(
"adminSentinelKillSwitchValue"
),

adminAccessTotalCodesValue: document.getElementById(
"adminAccessTotalCodesValue"
),
adminAccessTotalCodesValueMirror: document.getElementById(
"adminAccessTotalCodesValueMirror"
),
adminAccessActiveCodesValue: document.getElementById(
"adminAccessActiveCodesValue"
),
adminAccessRedemptionsValue: document.getElementById(
"adminAccessRedemptionsValue"
),
adminAccessEntitlementsValue: document.getElementById(
"adminAccessEntitlementsValue"
),
adminAccessEntitlementsValueMirror: document.getElementById(
"adminAccessEntitlementsValueMirror"
),

adminNotificationsList: document.getElementById("adminNotificationsList"),
adminApiStatusValue: document.getElementById("adminApiStatusValue"),
adminUpdatedAtValue: document.getElementById("adminUpdatedAtValue"),
}

function normalizeScopes(scopes) {
return arrayify(scopes)
.map((scope) => cleanText(scope, 64).toLowerCase())
.filter(Boolean)
}

function sessionAllowsAdmin(session) {
return normalizeScopes(session?.scopes).includes(REQUIRED_ADMIN_SCOPE)
}

function acceptAdminSession(session) {
if (!sessionAllowsAdmin(session)) {
return null
}

state.adminSession = session
setAdminSessionSnapshot(session)

return session
}

function getExistingAdminSession() {
const currentSnapshot = getAdminSessionSnapshot()

if (currentSnapshot && sessionAllowsAdmin(currentSnapshot)) {
return acceptAdminSession(currentSnapshot)
}

const guardState = window.MSSAdminSessionGuard?.getState?.()

if (
guardState?.authenticated &&
guardState?.session &&
sessionAllowsAdmin(guardState.session)
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

function setAdminBanner(message = "", variant = "good") {
setBanner(els.adminBanner, message, variant)
}

function setChip(el, label, variant = "warn") {
if (!el) return

el.textContent = label || "Unknown"
el.className = "admin-chip chip"

if (variant) {
el.classList.add(variant)
}
}

function setTextAcross(elements = [], value) {
elements.forEach((element) => {
setText(element, value)
})
}

function isLoading() {
return state.loadingCount > 0
}

function beginLoading() {
state.loadingCount += 1
refreshLoadingUi()
}

function endLoading() {
state.loadingCount = Math.max(0, state.loadingCount - 1)
refreshLoadingUi()
}

function refreshLoadingUi() {
const loading = isLoading()

if (els.refreshAdminButton) {
els.refreshAdminButton.disabled = loading
els.refreshAdminButton.textContent = loading
? "Refreshing..."
: "Refresh Snapshot"
}

setText(els.adminApiStatusValue, loading ? "Loading" : "Ready")
}

function handleAdminApiAuthorizationError(error) {
if (![401, 403].includes(Number(error?.status))) {
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
? "Your admin session does not have permission to open this command center."
: "Your admin session has expired. Returning to secure sign-in."

setAdminBanner(message, "bad")

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

async function apiFetchSentinelAccessAdmin(path, options = {}) {
try {
return await apiFetch(`/api/sentinel-access-admin${path}`, options)
} catch (error) {
handleAdminApiAuthorizationError(error)
throw error
}
}

function isLiveEntitlement(entitlement) {
const status = cleanText(entitlement?.status, 64).toLowerCase()

if (status !== "active") {
return false
}

const now = Date.now()

const startsAt = entitlement?.starts_at
? new Date(entitlement.starts_at).getTime()
: null

const endsAt = entitlement?.ends_at
? new Date(entitlement.ends_at).getTime()
: null

if (startsAt && !Number.isNaN(startsAt) && startsAt > now) {
return false
}

if (endsAt && !Number.isNaN(endsAt) && endsAt <= now) {
return false
}

return true
}

function addError(scope, error) {
state.errors.push({
scope,
message: error?.message || "Request failed.",
status: error?.status || null,
payload: error?.payload || null,
})
}

function getCaseStatus(item) {
return cleanText(item?.status, 32).toLowerCase()
}

function normalizeMode(mode) {
return cleanText(mode, 64).toLowerCase() || "paper"
}

function getSentinelMode(payload = state.sentinel || {}) {
const settings = payload.settings || {}
const summary = payload.summary || {}
const engine = payload.engine || {}

return normalizeMode(
settings.execution_mode ||
summary.execution_mode ||
summary.executionMode ||
engine.current_mode ||
engine.currentMode ||
"paper"
)
}

function getSentinelSummary(payload = state.sentinel || {}) {
return payload.summary || {}
}

function getSentinelPnl(payload = state.sentinel || {}) {
return getSentinelSummary(payload).pnl || {}
}

function getSentinelOpenPositions(payload = state.sentinel || {}) {
const summary = getSentinelSummary(payload)
const pnl = getSentinelPnl(payload)

return safeNumber(
summary.open_positions ??
summary.openPositions ??
pnl.open_positions ??
pnl.openPositions,
0
)
}

function getSentinelRealizedPnl(payload = state.sentinel || {}) {
const summary = getSentinelSummary(payload)
const pnl = getSentinelPnl(payload)

return safeNumber(
summary.period_realized_pnl_usd ??
summary.periodRealizedPnlUsd ??
pnl.realized_pnl_usd ??
pnl.realizedPnlUsd ??
summary.daily_realized_pnl_usd ??
summary.dailyRealizedPnlUsd,
0
)
}

function getSentinelKillSwitch(payload = state.sentinel || {}) {
const settings = payload.settings || {}
const summary = getSentinelSummary(payload)
const mode = getSentinelMode(payload)

return Boolean(
summary.kill_switch_active ??
summary.killSwitchActive ??
settings.kill_switch_active ??
settings.killSwitchActive ??
mode === "emergency_stop"
)
}

async function loadComplianceSnapshot() {
const payload = await apiFetchComplianceAdmin("/cases")

state.cases = arrayify(payload?.cases)

return state.cases
}

async function loadSentinelSnapshot() {
const params = new URLSearchParams()

params.set("period", "daily")
params.set("date", todayIso)
params.set("mode", "paper")

try {
const payload = await apiFetchComplianceAdmin(
`/sentinel/status?${params.toString()}`
)

state.sentinel = payload || null

return state.sentinel
} catch (error) {
if (error?.status !== 404) {
throw error
}

const [settingsPayload, summaryPayload] = await Promise.all([
apiFetchComplianceAdmin("/sentinel/settings"),
apiFetchComplianceAdmin(`/sentinel/summary?${params.toString()}`),
])

state.sentinel = {
ok: true,
settings: settingsPayload?.settings || null,
engine: settingsPayload?.engine || summaryPayload?.engine || null,
summary: summaryPayload?.summary || null,
}

return state.sentinel
}
}

async function loadAccessSnapshot() {
const [summaryPayload, entitlementsPayload] = await Promise.all([
apiFetchSentinelAccessAdmin("/summary"),
apiFetchSentinelAccessAdmin("/entitlements?limit=500"),
])

state.accessSummary = summaryPayload?.summary || null
state.accessEntitlements = arrayify(entitlementsPayload?.entitlements)

return {
summary: state.accessSummary,
entitlements: state.accessEntitlements,
}
}

function renderComplianceSnapshot() {
const cases = arrayify(state.cases)

const openLike = cases.filter((item) =>
["open", "pending_info"].includes(getCaseStatus(item))
).length

const escalatedLike = cases.filter((item) =>
["escalated", "frozen"].includes(getCaseStatus(item))
).length

const resolvedLike = cases.filter((item) =>
["approved", "rejected"].includes(getCaseStatus(item))
).length

setTextAcross(
[els.adminOpenCasesValue, els.adminOpenCasesValueMirror],
formatNumber(openLike)
)

setText(els.adminEscalatedCasesValue, formatNumber(escalatedLike))
setText(els.adminResolvedCasesValue, formatNumber(resolvedLike))
setText(els.adminTotalCasesValue, formatNumber(cases.length))

if (state.errors.some((item) => item.scope === "compliance")) {
setChip(els.complianceHealthChip, "Error", "bad")
return
}

if (escalatedLike > 0) {
setChip(els.complianceHealthChip, `${escalatedLike} Priority`, "bad")
} else if (openLike > 0) {
setChip(els.complianceHealthChip, `${openLike} Open`, "warn")
} else {
setChip(els.complianceHealthChip, "Clear", "good")
}
}

function renderSentinelSnapshot() {
const payload = state.sentinel || {}
const mode = getSentinelMode(payload)
const openPositions = getSentinelOpenPositions(payload)
const realizedPnl = getSentinelRealizedPnl(payload)
const killSwitchActive = getSentinelKillSwitch(payload)
const modeLabel = titleCase(mode) || "Paper"

setTextAcross(
[els.adminSentinelModeValue, els.adminSentinelModeValueMirror],
modeLabel
)

setText(els.adminSentinelOpenPositionsValue, formatNumber(openPositions))
setText(els.adminSentinelRealizedPnlValue, formatSignedCurrency(realizedPnl))
setText(
els.adminSentinelKillSwitchValue,
killSwitchActive ? "Active" : "Inactive"
)

els.adminSentinelRealizedPnlValue?.classList.remove(
"pnl-good",
"pnl-bad",
"pnl-neutral"
)

if (els.adminSentinelRealizedPnlValue) {
if (realizedPnl > 0) {
els.adminSentinelRealizedPnlValue.classList.add("pnl-good")
} else if (realizedPnl < 0) {
els.adminSentinelRealizedPnlValue.classList.add("pnl-bad")
} else {
els.adminSentinelRealizedPnlValue.classList.add("pnl-neutral")
}
}

if (state.errors.some((item) => item.scope === "sentinel")) {
setChip(els.sentinelHealthChip, "Error", "bad")
return
}

if (killSwitchActive || mode === "emergency_stop") {
setChip(els.sentinelHealthChip, "Emergency", "bad")
} else if (mode === "live_mainnet") {
setChip(els.sentinelHealthChip, "Live", "good")
} else if (mode === "armed_mainnet") {
setChip(els.sentinelHealthChip, "Armed", "warn")
} else {
setChip(els.sentinelHealthChip, "Paper", "good")
}
}

function renderAccessSnapshot() {
const summary = state.accessSummary || {}

const totalCodes = safeNumber(
summary.total_codes ?? summary.totalCodes,
0
)

const activeCodes = safeNumber(
summary.active_codes ?? summary.activeCodes,
0
)

const redemptions = safeNumber(
summary.total_redemptions ??
summary.totalRedemptions ??
summary.redeemed_codes ??
summary.redeemedCodes,
0
)

const liveEntitlements = state.accessEntitlements.filter(
isLiveEntitlement
).length

setTextAcross(
[els.adminAccessTotalCodesValue, els.adminAccessTotalCodesValueMirror],
formatNumber(totalCodes)
)

setText(els.adminAccessActiveCodesValue, formatNumber(activeCodes))
setText(els.adminAccessRedemptionsValue, formatNumber(redemptions))

setTextAcross(
[
els.adminAccessEntitlementsValue,
els.adminAccessEntitlementsValueMirror,
],
formatNumber(liveEntitlements)
)

if (state.errors.some((item) => item.scope === "access")) {
setChip(els.accessHealthChip, "Error", "bad")
return
}

if (liveEntitlements > 0) {
setChip(els.accessHealthChip, `${liveEntitlements} Live`, "good")
} else if (activeCodes > 0) {
setChip(els.accessHealthChip, `${activeCodes} Active`, "warn")
} else {
setChip(els.accessHealthChip, "No Live Access", "warn")
}
}

function buildNotifications() {
const notifications = []
const cases = arrayify(state.cases)

const openLike = cases.filter((item) =>
["open", "pending_info"].includes(getCaseStatus(item))
).length

const escalatedLike = cases.filter((item) =>
["escalated", "frozen"].includes(getCaseStatus(item))
).length

const sentinelMode = getSentinelMode(state.sentinel || {})
const killSwitchActive = getSentinelKillSwitch(state.sentinel || {})

const accessSummary = state.accessSummary || {}

const activeCodes = safeNumber(
accessSummary.active_codes ?? accessSummary.activeCodes,
0
)

const liveEntitlements = state.accessEntitlements.filter(
isLiveEntitlement
).length

state.errors.forEach((error) => {
notifications.push({
title: `${titleCase(error.scope)} snapshot error`,
copy: error.message,
priority: "bad",
})
})

if (escalatedLike > 0) {
notifications.push({
title: `${escalatedLike} compliance case${
escalatedLike === 1 ? "" : "s"
} need priority review`,
copy: "Escalated or frozen compliance cases should be reviewed before normal queue items.",
priority: "bad",
})
}

if (openLike > 0) {
notifications.push({
title: `${openLike} compliance case${
openLike === 1 ? "" : "s"
} open or pending`,
copy: "The compliance queue has items waiting for manual action or additional review.",
priority: "warn",
})
}

if (killSwitchActive) {
notifications.push({
title: "Sentinel emergency stop is active",
copy: "Sentinel is currently in a stopped or restricted operating posture. Review Sentinel settings before changing execution mode.",
priority: "bad",
})
} else if (sentinelMode === "live_mainnet") {
notifications.push({
title: "Sentinel is in Live Mainnet mode",
copy: "Live mode should only remain active when backend execution routing and risk controls are intentionally enabled.",
priority: "good",
})
} else if (sentinelMode === "armed_mainnet") {
notifications.push({
title: "Sentinel is armed for mainnet",
copy: "Armed mode should be monitored closely before any transition to live execution.",
priority: "warn",
})
} else {
notifications.push({
title: "Sentinel is running in paper posture",
copy: "Paper mode remains the correct default while devnet and staging observation, mark-to-market behaviour, and audit accuracy are being proven.",
priority: "good",
})
}

if (activeCodes > 0 || liveEntitlements > 0) {
notifications.push({
title: "Sentinel tester access is active",
copy: `${formatNumber(activeCodes)} active code${
activeCodes === 1 ? "" : "s"
} and ${formatNumber(liveEntitlements)} live entitlement${
liveEntitlements === 1 ? "" : "s"
} are currently visible.`,
priority: "good",
})
}

if (!notifications.length) {
notifications.push({
title: "No priority admin notifications",
copy: "Compliance, Sentinel, and access-code surfaces loaded without high-priority alerts.",
priority: "good",
})
}

return notifications
}

function createNotificationNode(item) {
const notification = document.createElement("div")
notification.className = "admin-notification"

const row = document.createElement("div")
row.style.display = "flex"
row.style.alignItems = "flex-start"
row.style.justifyContent = "space-between"
row.style.gap = "12px"

const copyWrap = document.createElement("div")

const title = document.createElement("div")
title.className = "admin-notification-title"
title.textContent = cleanText(item.title, 180)

const copy = document.createElement("div")
copy.className = "admin-notification-copy"
copy.textContent = cleanText(item.copy, 500)

copyWrap.appendChild(title)
copyWrap.appendChild(copy)

const chip = document.createElement("span")

const chipVariant =
item.priority === "bad"
? "bad"
: item.priority === "good"
? "good"
: "warn"

const chipLabel =
item.priority === "bad"
? "Priority"
: item.priority === "good"
? "Clear"
: "Review"

chip.className = `admin-chip chip ${chipVariant}`
chip.textContent = chipLabel

row.appendChild(copyWrap)
row.appendChild(chip)
notification.appendChild(row)

return notification
}

function renderNotifications() {
const host = els.adminNotificationsList

if (!host) return

const notifications = buildNotifications()

host.innerHTML = ""

notifications.forEach((item) => {
host.appendChild(createNotificationNode(item))
})
}

function renderSnapshot() {
renderComplianceSnapshot()
renderSentinelSnapshot()
renderAccessSnapshot()
renderNotifications()

setText(els.adminUpdatedAtValue, formatDateTime(new Date().toISOString()))
}

async function loadAdminSnapshot({ showSuccess = false } = {}) {
beginLoading()
state.errors = []

try {
const results = await Promise.allSettled([
loadComplianceSnapshot(),
loadSentinelSnapshot(),
loadAccessSnapshot(),
])

const scopes = ["compliance", "sentinel", "access"]

results.forEach((result, index) => {
if (result.status === "rejected") {
addError(scopes[index], result.reason)
}
})

if (
state.errors.some((error) =>
[401, 403].includes(Number(error.status))
)
) {
return
}

renderSnapshot()

if (state.errors.length) {
setAdminBanner(
`${state.errors.length} admin surface${
state.errors.length === 1 ? "" : "s"
} could not be loaded. Review notifications below.`,
"bad"
)
} else if (showSuccess) {
setAdminBanner("Admin snapshot refreshed.", "good")
} else {
setAdminBanner("")
}
} catch (error) {
if (!handleAdminApiAuthorizationError(error)) {
setAdminBanner(
error?.message || "Failed to load admin snapshot.",
"bad"
)
}
} finally {
endLoading()
}
}

function bindActions() {
els.refreshAdminButton?.addEventListener("click", async () => {
await loadAdminSnapshot({ showSuccess: true })
})

window.addEventListener(ADMIN_SESSION_INVALID_EVENT, (event) => {
const detail = event?.detail || {}

handleAdminApiAuthorizationError({
status: detail.status || 401,
payload: detail.payload || null,
})
})
}

function initEmptyState() {
setChip(els.complianceHealthChip, "Loading", "warn")
setChip(els.sentinelHealthChip, "Loading", "warn")
setChip(els.accessHealthChip, "Loading", "warn")

setTextAcross(
[els.adminOpenCasesValue, els.adminOpenCasesValueMirror],
"—"
)

setText(els.adminEscalatedCasesValue, "—")
setText(els.adminResolvedCasesValue, "—")
setText(els.adminTotalCasesValue, "—")

setTextAcross(
[els.adminSentinelModeValue, els.adminSentinelModeValueMirror],
"—"
)

setText(els.adminSentinelOpenPositionsValue, "—")
setText(els.adminSentinelRealizedPnlValue, "—")
setText(els.adminSentinelKillSwitchValue, "—")

setTextAcross(
[els.adminAccessTotalCodesValue, els.adminAccessTotalCodesValueMirror],
"—"
)

setText(els.adminAccessActiveCodesValue, "—")
setText(els.adminAccessRedemptionsValue, "—")

setTextAcross(
[
els.adminAccessEntitlementsValue,
els.adminAccessEntitlementsValueMirror,
],
"—"
)

setText(els.adminApiStatusValue, "Idle")
setText(els.adminUpdatedAtValue, "—")
setAdminBanner("")
}

async function init() {
initEmptyState()
bindActions()
refreshLoadingUi()

await waitForAuthenticatedAdminSession()
await loadAdminSnapshot()
}

init().catch((error) => {
console.error("Failed to initialize admin page", error)

if (!handleAdminApiAuthorizationError(error)) {
setAdminBanner(
error?.message || "Failed to initialize admin page.",
"bad"
)
}
})
