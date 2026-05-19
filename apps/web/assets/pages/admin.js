const todayIso = new Date().toISOString().slice(0, 10)

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

const SENTINEL_ACCESS_ADMIN_KEY_STORAGE_KEY = "mss_sentinel_access_admin_key"
let sentinelAccessAdminKeyPromptInFlight = null

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max)
}

function safeNumber(value, fallback = 0) {
const num = Number(value)
return Number.isFinite(num) ? num : fallback
}

function arrayify(value) {
return Array.isArray(value) ? value : []
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

function formatNumber(value, fractionDigits = 0) {
const num = Number(value)
if (!Number.isFinite(num)) return "0"

return new Intl.NumberFormat(undefined, {
maximumFractionDigits: fractionDigits,
minimumFractionDigits: fractionDigits,
}).format(num)
}

function formatCurrency(value) {
const num = Number(value)
if (!Number.isFinite(num)) return "$0.00"

return new Intl.NumberFormat(undefined, {
style: "currency",
currency: "USD",
maximumFractionDigits: 2,
}).format(num)
}

function formatSignedCurrency(value) {
const num = Number(value)
if (!Number.isFinite(num)) return "$0.00"

const abs = Math.abs(num)
const formatted = new Intl.NumberFormat(undefined, {
style: "currency",
currency: "USD",
maximumFractionDigits: 2,
}).format(abs)

if (num > 0) return `+${formatted}`
if (num < 0) return `-${formatted}`
return formatted
}

function formatDateTime(value) {
const date = new Date(value)
if (!value || Number.isNaN(date.getTime())) return "—"
return date.toLocaleString()
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

return window.location.origin
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

function getStoredSentinelAccessAdminKey() {
const override = cleanText(window.__SENTINEL_ACCESS_ADMIN_KEY__ || "", 2000)
if (override) return override

try {
return cleanText(localStorage.getItem(SENTINEL_ACCESS_ADMIN_KEY_STORAGE_KEY), 2000)
} catch {
return ""
}
}

function storeSentinelAccessAdminKey(value) {
try {
const clean = cleanText(value, 2000)

if (!clean) {
localStorage.removeItem(SENTINEL_ACCESS_ADMIN_KEY_STORAGE_KEY)
return
}

localStorage.setItem(SENTINEL_ACCESS_ADMIN_KEY_STORAGE_KEY, clean)
} catch {}
}

function requestSentinelAccessAdminKey() {
if (sentinelAccessAdminKeyPromptInFlight) {
return sentinelAccessAdminKeyPromptInFlight
}

sentinelAccessAdminKeyPromptInFlight = Promise.resolve().then(() => {
const entered = window.prompt("Enter Sentinel Access admin key")
const clean = cleanText(entered, 2000)

if (clean) {
storeSentinelAccessAdminKey(clean)
return clean
}

return ""
})

return sentinelAccessAdminKeyPromptInFlight.finally(() => {
sentinelAccessAdminKeyPromptInFlight = null
})
}

async function apiFetchSentinelAccessAdmin(path, options = {}, { retryOnUnauthorized = true } = {}) {
const storedKey = getStoredSentinelAccessAdminKey()
const headers = {
...(options.headers || {}),
}

if (storedKey) {
headers["x-admin-key"] = storedKey
}

try {
return await apiFetch(`/api/sentinel-access-admin${path}`, {
...options,
headers,
})
} catch (error) {
if (retryOnUnauthorized && error?.status === 401) {
storeSentinelAccessAdminKey("")
const retryKey = await requestSentinelAccessAdminKey()

if (!retryKey) {
throw new Error("Sentinel Access admin key is required.")
}

return apiFetch(`/api/sentinel-access-admin${path}`, {
...options,
headers: {
...(options.headers || {}),
"x-admin-key": retryKey,
},
})
}

throw error
}
}

function setText(el, value) {
if (!el) return
el.textContent = value == null || value === "" ? "—" : String(value)
}

function setBanner(message = "", variant = "good") {
if (!els.adminBanner) return

els.adminBanner.textContent = message || ""
els.adminBanner.className = "admin-banner"

if (message) {
els.adminBanner.classList.add("show")
els.adminBanner.classList.add(variant)
}
}

function setChip(el, label, variant = "warn") {
if (!el) return

el.textContent = label || "Unknown"
el.className = "admin-chip"

if (variant) {
el.classList.add(variant)
}
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
const loading = state.loadingCount > 0

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
})
}

async function loadComplianceSnapshot() {
const payload = await apiFetch("/api/compliance-admin/cases")
state.cases = arrayify(payload?.cases)
return state.cases
}

async function loadSentinelSnapshot() {
const params = new URLSearchParams()
params.set("period", "daily")
params.set("date", todayIso)
params.set("mode", "paper")

const payload = await apiFetch(`/api/compliance-admin/sentinel/status?${params.toString()}`)
state.sentinel = payload || null
return state.sentinel
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
const cases = state.cases

const openLike = cases.filter((item) =>
["open", "pending_info"].includes(cleanText(item.status, 32).toLowerCase())
).length

const escalatedLike = cases.filter((item) =>
["escalated", "frozen"].includes(cleanText(item.status, 32).toLowerCase())
).length

const resolvedLike = cases.filter((item) =>
["approved", "rejected"].includes(cleanText(item.status, 32).toLowerCase())
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
const settings = payload.settings || {}
const summary = payload.summary || {}
const pnl = summary.pnl || {}

const mode =
cleanText(settings.execution_mode, 64) ||
cleanText(summary.execution_mode, 64) ||
"paper"

const openPositions = safeNumber(
summary.open_positions ?? summary.openPositions ?? pnl.open_positions,
0
)

const realizedPnl = safeNumber(
summary.period_realized_pnl_usd ??
pnl.realized_pnl_usd ??
summary.daily_realized_pnl_usd ??
summary.dailyRealizedPnlUsd,
0
)

const killSwitchActive = Boolean(
summary.kill_switch_active ??
summary.killSwitchActive ??
cleanText(settings.execution_mode, 64) === "emergency_stop"
)

setText(els.adminSentinelModeValue, titleCase(mode) || "Paper")
setText(els.adminSentinelOpenPositionsValue, formatNumber(openPositions))
setText(els.adminSentinelRealizedPnlValue, formatSignedCurrency(realizedPnl))
setText(els.adminSentinelKillSwitchValue, killSwitchActive ? "Active" : "Inactive")

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
const totalCodes = safeNumber(summary.total_codes, 0)
const activeCodes = safeNumber(summary.active_codes, 0)
const redemptions = safeNumber(summary.total_redemptions, 0)
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

const cases = state.cases
const openLike = cases.filter((item) =>
["open", "pending_info"].includes(cleanText(item.status, 32).toLowerCase())
).length
const escalatedLike = cases.filter((item) =>
["escalated", "frozen"].includes(cleanText(item.status, 32).toLowerCase())
).length

const sentinelSummary = state.sentinel?.summary || {}
const sentinelSettings = state.sentinel?.settings || {}
const sentinelMode =
cleanText(sentinelSettings.execution_mode, 64) ||
cleanText(sentinelSummary.execution_mode, 64) ||
"paper"
const killSwitchActive = Boolean(
sentinelSummary.kill_switch_active ??
sentinelSummary.killSwitchActive ??
sentinelMode === "emergency_stop"
)

const accessSummary = state.accessSummary || {}
const activeCodes = safeNumber(accessSummary.active_codes, 0)
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
<span class="admin-chip ${chipVariant}">${chipLabel}</span>
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
setBanner(
`${state.errors.length} admin surface${state.errors.length === 1 ? "" : "s"} could not be loaded. Review notifications below.`,
"bad"
)
} else if (showSuccess) {
setBanner("Admin snapshot refreshed.", "good")
} else {
setBanner("")
}
} catch (error) {
setBanner(error?.message || "Failed to load admin snapshot.", "bad")
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
}

async function init() {
initEmptyState()
bindActions()
refreshLoadingUi()

await loadAdminSnapshot()
}

init().catch((error) => {
console.error("Failed to initialize admin page", error)
setBanner(error?.message || "Failed to initialize admin page.", "bad")
})