import {
arrayify,
cleanText,
createAdminKeyApiFetch,
formatDateTime,
formatNumber,
formatSignedCurrency,
safeNumber,
setBanner,
setText,
titleCase,
todayIso,
} from "./admin-core.js"

const state = {
loadingCount: 0,
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
adminEscalatedCasesValue: document.getElementById("adminEscalatedCasesValue"),
adminResolvedCasesValue: document.getElementById("adminResolvedCasesValue"),
adminTotalCasesValue: document.getElementById("adminTotalCasesValue"),

adminSentinelModeValue: document.getElementById("adminSentinelModeValue"),
adminSentinelOpenPositionsValue: document.getElementById("adminSentinelOpenPositionsValue"),
adminSentinelRealizedPnlValue: document.getElementById("adminSentinelRealizedPnlValue"),
adminSentinelKillSwitchValue: document.getElementById("adminSentinelKillSwitchValue"),

adminAccessTotalCodesValue: document.getElementById("adminAccessTotalCodesValue"),
adminAccessActiveCodesValue: document.getElementById("adminAccessActiveCodesValue"),
adminAccessRedemptionsValue: document.getElementById("adminAccessRedemptionsValue"),
adminAccessEntitlementsValue: document.getElementById("adminAccessEntitlementsValue"),

adminNotificationsList: document.getElementById("adminNotificationsList"),
adminApiStatusValue: document.getElementById("adminApiStatusValue"),
adminUpdatedAtValue: document.getElementById("adminUpdatedAtValue"),
}

const apiFetchComplianceAdmin = createAdminKeyApiFetch({
basePath: "/api/compliance-admin",
storageKey: "mss_admin_key",
windowOverrideKey: "__MSS_ADMIN_KEY__",
headerName: "x-admin-key",
promptLabel: "Enter MSS admin key",
missingKeyMessage: "MSS admin key is required.",
})

const apiFetchSentinelAccessAdmin = createAdminKeyApiFetch({
basePath: "/api/sentinel-access-admin",
storageKey: "mss_sentinel_access_admin_key",
windowOverrideKey: "__SENTINEL_ACCESS_ADMIN_KEY__",
headerName: "x-admin-key",
promptLabel: "Enter Sentinel Access admin key",
missingKeyMessage: "Sentinel Access admin key is required.",
})

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
els.refreshAdminButton.textContent = loading ? "Refreshing..." : "Refresh Admin Snapshot"
}

setText(els.adminApiStatusValue, loading ? "Loading" : "Ready")
}

function isLiveEntitlement(entitlement) {
const status = cleanText(entitlement?.status, 64).toLowerCase()
if (status !== "active") return false

const now = Date.now()
const startsAt = entitlement?.starts_at ? new Date(entitlement.starts_at).getTime() : null
const endsAt = entitlement?.ends_at ? new Date(entitlement.ends_at).getTime() : null

if (startsAt && !Number.isNaN(startsAt) && startsAt > now) return false
if (endsAt && !Number.isNaN(endsAt) && endsAt <= now) return false

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
const summary = getSentinelSummary(payload)
return summary.pnl || {}
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
const payload = await apiFetchComplianceAdmin(`/sentinel/status?${params.toString()}`)
state.sentinel = payload || null
return state.sentinel
} catch (error) {
if (error?.status !== 404) throw error

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

setText(els.adminOpenCasesValue, formatNumber(openLike))
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

setText(els.adminSentinelModeValue, titleCase(mode) || "Paper")
setText(els.adminSentinelOpenPositionsValue, formatNumber(openPositions))
setText(els.adminSentinelRealizedPnlValue, formatSignedCurrency(realizedPnl))
setText(els.adminSentinelKillSwitchValue, killSwitchActive ? "Active" : "Inactive")

els.adminSentinelRealizedPnlValue?.classList.remove("pnl-good", "pnl-bad", "pnl-neutral")

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

const totalCodes = safeNumber(summary.total_codes ?? summary.totalCodes, 0)
const activeCodes = safeNumber(summary.active_codes ?? summary.activeCodes, 0)
const redemptions = safeNumber(
summary.total_redemptions ??
summary.totalRedemptions ??
summary.redeemed_codes ??
summary.redeemedCodes,
0
)
const liveEntitlements = state.accessEntitlements.filter(isLiveEntitlement).length

setText(els.adminAccessTotalCodesValue, formatNumber(totalCodes))
setText(els.adminAccessActiveCodesValue, formatNumber(activeCodes))
setText(els.adminAccessRedemptionsValue, formatNumber(redemptions))
setText(els.adminAccessEntitlementsValue, formatNumber(liveEntitlements))

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
const activeCodes = safeNumber(accessSummary.active_codes ?? accessSummary.activeCodes, 0)
const liveEntitlements = state.accessEntitlements.filter(isLiveEntitlement).length

state.errors.forEach((error) => {
notifications.push({
title: `${titleCase(error.scope)} snapshot error`,
copy: error.message,
priority: "bad",
})
})

if (escalatedLike > 0) {
notifications.push({
title: `${escalatedLike} compliance case${escalatedLike === 1 ? "" : "s"} need priority review`,
copy: "Escalated or frozen compliance cases should be reviewed before normal queue items.",
priority: "bad",
})
}

if (openLike > 0) {
notifications.push({
title: `${openLike} compliance case${openLike === 1 ? "" : "s"} open or pending`,
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
copy: "Paper mode remains the correct default while devnet/staging observation and audit accuracy are being proven.",
priority: "good",
})
}

if (activeCodes > 0 || liveEntitlements > 0) {
notifications.push({
title: "Sentinel tester access is active",
copy: `${formatNumber(activeCodes)} active code${activeCodes === 1 ? "" : "s"} and ${formatNumber(liveEntitlements)} live entitlement${liveEntitlements === 1 ? "" : "s"} are currently visible.`,
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

function renderNotifications() {
const host = els.adminNotificationsList
if (!host) return

const notifications = buildNotifications()

host.innerHTML = ""

notifications.forEach((item) => {
const node = document.createElement("div")
node.className = "admin-notification"

const chipVariant = item.priority === "bad" ? "bad" : item.priority === "good" ? "good" : "warn"
const chipLabel = item.priority === "bad" ? "Priority" : item.priority === "good" ? "Clear" : "Review"

node.innerHTML = `
<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
<div>
<div class="admin-notification-title">${cleanText(item.title, 180)}</div>
<div class="admin-notification-copy">${cleanText(item.copy, 500)}</div>
</div>
<span class="admin-chip chip ${chipVariant}">${chipLabel}</span>
</div>
`

host.appendChild(node)
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

renderSnapshot()

if (state.errors.length) {
setAdminBanner(
`${state.errors.length} admin surface${state.errors.length === 1 ? "" : "s"} could not be loaded. Review notifications below.`,
"bad"
)
} else if (showSuccess) {
setAdminBanner("Admin snapshot refreshed.", "good")
} else {
setAdminBanner("")
}
} catch (error) {
setAdminBanner(error?.message || "Failed to load admin snapshot.", "bad")
} finally {
endLoading()
}
}

function bindActions() {
els.refreshAdminButton?.addEventListener("click", async () => {
await loadAdminSnapshot({ showSuccess: true })
})
}

function initEmptyState() {
setChip(els.complianceHealthChip, "Loading", "warn")
setChip(els.sentinelHealthChip, "Loading", "warn")
setChip(els.accessHealthChip, "Loading", "warn")

setText(els.adminOpenCasesValue, "—")
setText(els.adminEscalatedCasesValue, "—")
setText(els.adminResolvedCasesValue, "—")
setText(els.adminTotalCasesValue, "—")

setText(els.adminSentinelModeValue, "—")
setText(els.adminSentinelOpenPositionsValue, "—")
setText(els.adminSentinelRealizedPnlValue, "—")
setText(els.adminSentinelKillSwitchValue, "—")

setText(els.adminAccessTotalCodesValue, "—")
setText(els.adminAccessActiveCodesValue, "—")
setText(els.adminAccessRedemptionsValue, "—")
setText(els.adminAccessEntitlementsValue, "—")

setText(els.adminApiStatusValue, "Idle")
setText(els.adminUpdatedAtValue, "—")
setAdminBanner("")
}

async function init() {
initEmptyState()
bindActions()
refreshLoadingUi()

await loadAdminSnapshot()
}

init().catch((error) => {
console.error("Failed to initialize admin page", error)
setAdminBanner(error?.message || "Failed to initialize admin page.", "bad")
})
