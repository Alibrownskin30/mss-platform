const DEFAULT_CURRENCY = "USD"

export const todayIso = new Date().toISOString().slice(0, 10)

export const ADMIN_SESSION_STATUS_PATH = "/api/admin-session/status"
export const ADMIN_SESSION_LOGIN_PATH = "/api/admin-session/login"
export const ADMIN_SESSION_LOGOUT_PATH = "/api/admin-session/logout"
export const ADMIN_SESSION_READY_EVENT = "mss:admin-session-ready"
export const ADMIN_SESSION_INVALID_EVENT = "mss:admin-session-invalid"

/*
Retained as compatibility exports while older admin controllers are replaced.
These identifiers are no longer used to read or store browser credentials.
*/
export const ADMIN_GATE_STORAGE_KEY = "mss_admin_gate_key"
export const SENTINEL_ACCESS_ADMIN_KEY_STORAGE_KEY =
"mss_sentinel_access_admin_key"

const LEGACY_ADMIN_STORAGE_KEYS = [
ADMIN_GATE_STORAGE_KEY,
SENTINEL_ACCESS_ADMIN_KEY_STORAGE_KEY,
]

const LEGACY_BROWSER_ADMIN_HEADERS = new Set([
"x-admin-key",
"x-mss-admin-key",
"x-sentinel-admin-key",
"x-sentinel-access-admin-key",
])

let cachedAdminSession = null

export function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max)
}

export function parseBool(value, fallback = false) {
if (typeof value === "boolean") return value

const normalized = cleanText(value, 16).toLowerCase()

if (["true", "1", "yes", "y", "enabled", "on"].includes(normalized)) {
return true
}

if (["false", "0", "no", "n", "disabled", "off"].includes(normalized)) {
return false
}

return fallback
}

export function arrayify(value) {
return Array.isArray(value) ? value : []
}

export function safeNumber(value, fallback = 0) {
const num = Number(value)
return Number.isFinite(num) ? num : fallback
}

export function firstFiniteNumber(values = [], fallback = 0) {
for (const value of values) {
if (value == null || value === "") continue

const num = Number(value)

if (Number.isFinite(num)) {
return num
}
}

return fallback
}

export function shortenWallet(wallet, front = 6, back = 6) {
const value = cleanText(wallet, 200)

if (!value) return "—"
if (value.length <= front + back + 2) return value

return `${value.slice(0, front)}…${value.slice(-back)}`
}

export function titleCase(value) {
return cleanText(value, 120)
.replace(/_/g, " ")
.replace(/-/g, " ")
.split(" ")
.filter(Boolean)
.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
.join(" ")
}

export function formatDateTime(value) {
const date = new Date(value)

if (!value || Number.isNaN(date.getTime())) {
return "—"
}

return date.toLocaleString()
}

export function formatDate(value) {
const date = new Date(value)

if (!value || Number.isNaN(date.getTime())) {
return "—"
}

return date.toLocaleDateString()
}

export function formatCurrency(value, currency = DEFAULT_CURRENCY) {
const num = Number(value)

if (!Number.isFinite(num)) {
return "$0.00"
}

return new Intl.NumberFormat(undefined, {
style: "currency",
currency,
maximumFractionDigits: 2,
}).format(num)
}

export function formatSignedCurrency(value, currency = DEFAULT_CURRENCY) {
const num = Number(value)

if (!Number.isFinite(num)) {
return "$0.00"
}

const abs = Math.abs(num)

const formatted = new Intl.NumberFormat(undefined, {
style: "currency",
currency,
maximumFractionDigits: 2,
}).format(abs)

if (num > 0) return `+${formatted}`
if (num < 0) return `-${formatted}`

return formatted
}

export function formatPercent(value, fractionDigits = 1) {
const num = Number(value)

if (!Number.isFinite(num)) {
return "0%"
}

return `${num.toFixed(fractionDigits)}%`
}

export function formatSignedPercent(value, fractionDigits = 1) {
const num = Number(value)

if (!Number.isFinite(num)) {
return "0%"
}

const prefix = num > 0 ? "+" : ""

return `${prefix}${num.toFixed(fractionDigits)}%`
}

export function formatNumber(value, fractionDigits = 0) {
const num = Number(value)

if (!Number.isFinite(num)) {
return "0"
}

return new Intl.NumberFormat(undefined, {
maximumFractionDigits: fractionDigits,
minimumFractionDigits: fractionDigits,
}).format(num)
}

export function stringifyCompact(value) {
if (value == null) return "—"

try {
return JSON.stringify(value)
} catch {
return String(value)
}
}

export function setText(el, value) {
if (!el) return

el.textContent = value == null || value === "" ? "—" : String(value)
}

export function setValue(el, value) {
if (!el) return

el.value = value == null ? "" : String(value)
}

export function setBoolSelect(el, value) {
if (!el) return

el.value = String(Boolean(value))
}

export function setVisible(el, visible, display = "") {
if (!el) return

el.style.display = visible ? display : "none"
}

export function setDisabled(items = [], disabled = false) {
arrayify(items).forEach((item) => {
if (item) {
item.disabled = Boolean(disabled)
}
})
}

/*
Frontend and API are separate services on deployed environments:
- devnet.mssprotocol.com -> api.devnet.mssprotocol.com
- mssprotocol.com / www -> api.mssprotocol.com

Local and Codespaces environments continue to use the local API port.
*/
export function getApiBase() {
const { protocol, hostname } = window.location
const override = cleanText(window.__API_BASE__ || "", 1000)

if (override) {
return override.replace(/\/$/, "")
}

if (
hostname === "127.0.0.1" ||
hostname === "localhost" ||
hostname === "[::1]"
) {
return `${protocol}//${hostname}:8787`
}

if (hostname.includes("-3000.app.github.dev")) {
return `${protocol}//${hostname.replace(
"-3000.app.github.dev",
"-8787.app.github.dev"
)}`
}

if (hostname.includes("-3001.app.github.dev")) {
return `${protocol}//${hostname.replace(
"-3001.app.github.dev",
"-8787.app.github.dev"
)}`
}

if (hostname.includes("-4173.app.github.dev")) {
return `${protocol}//${hostname.replace(
"-4173.app.github.dev",
"-8787.app.github.dev"
)}`
}

if (
hostname === "devnet.mssprotocol.com" ||
hostname === "www.devnet.mssprotocol.com"
) {
return "https://api.devnet.mssprotocol.com"
}

if (
hostname === "mssprotocol.com" ||
hostname === "www.mssprotocol.com"
) {
return "https://api.mssprotocol.com"
}

if (/:\d+$/.test(window.location.host)) {
return `${protocol}//${hostname}:8787`
}

return window.location.origin
}

export const API_BASE = getApiBase()

function normalizeApiPath(path) {
const raw = cleanText(path, 2000)

if (!raw) return ""

try {
if (raw.startsWith("http://") || raw.startsWith("https://")) {
return new URL(raw).pathname
}
} catch {}

return raw.split("?")[0]
}

export function isComplianceAdminApiPath(path) {
const normalized = normalizeApiPath(path)

return (
normalized === "/api/compliance-admin" ||
normalized.startsWith("/api/compliance-admin/")
)
}

export function isSentinelAccessAdminApiPath(path) {
const normalized = normalizeApiPath(path)

return (
normalized === "/api/sentinel-access-admin" ||
normalized.startsWith("/api/sentinel-access-admin/")
)
}

export function isAdminSessionApiPath(path) {
const normalized = normalizeApiPath(path)

return (
normalized === "/api/admin-session/status" ||
normalized === "/api/admin-session/login" ||
normalized === "/api/admin-session/logout"
)
}

export function isAdminProtectedApiPath(path) {
return (
isComplianceAdminApiPath(path) ||
isSentinelAccessAdminApiPath(path)
)
}

function normalizeScopes(scopes) {
return arrayify(scopes)
.map((scope) => cleanText(scope, 64).toLowerCase())
.filter(Boolean)
}

function normalizeAdminSession(session) {
if (!session || typeof session !== "object") {
return null
}

const scopes = normalizeScopes(session.scopes)

if (!scopes.length) {
return null
}

return {
actor:
cleanText(session.actor || session.actor_id, 120) ||
"admin",
scopes,
issued_at:
session.issued_at ??
session.issuedAt ??
null,
expires_at:
session.expires_at ??
session.expiresAt ??
null,
}
}

export function setAdminSessionSnapshot(session = null) {
const normalized = normalizeAdminSession(session)

cachedAdminSession = normalized

if (normalized) {
window.__MSS_ADMIN_SESSION__ = normalized
} else {
window.__MSS_ADMIN_SESSION__ = null
}

return normalized
}

export function getAdminSessionSnapshot() {
const windowSession = normalizeAdminSession(window.__MSS_ADMIN_SESSION__)

if (windowSession) {
cachedAdminSession = windowSession
return windowSession
}

const guardSession = normalizeAdminSession(
window.MSSAdminSessionGuard?.getState?.()?.session
)

if (guardSession) {
cachedAdminSession = guardSession
return guardSession
}

return cachedAdminSession
}

export function getAdminSessionActorId(fallback = "admin") {
const session = getAdminSessionSnapshot()

return cleanText(session?.actor, 120) || cleanText(fallback, 120) || "admin"
}

export function sessionHasAdminScope(scope = "admin", session = null) {
const normalizedSession =
normalizeAdminSession(session) ||
getAdminSessionSnapshot()

const requiredScope = cleanText(scope, 64).toLowerCase()

if (!normalizedSession?.scopes?.length || !requiredScope) {
return false
}

if (normalizedSession.scopes.includes("admin")) {
return true
}

return normalizedSession.scopes.includes(requiredScope)
}

export function purgeLegacyAdminCredentials() {
try {
LEGACY_ADMIN_STORAGE_KEYS.forEach((storageKey) => {
localStorage.removeItem(storageKey)
})
} catch {}
}

/*
Compatibility no-ops. Shared admin code no longer reads, stores, prompts for,
or injects raw admin credentials in the browser.
*/
export function getStoredAdminKey() {
purgeLegacyAdminCredentials()
return ""
}

export function storeAdminKey() {
purgeLegacyAdminCredentials()
return false
}

export function getStoredAdminGateKey() {
purgeLegacyAdminCredentials()
return ""
}

export function getStoredSentinelAccessAdminKey() {
purgeLegacyAdminCredentials()
return ""
}

export function getStoredAdminKeyForPath() {
purgeLegacyAdminCredentials()
return ""
}

export function clearStoredAdminKeyForPath() {
purgeLegacyAdminCredentials()
}

export function getAdminHeadersForPath() {
purgeLegacyAdminCredentials()
return {}
}

function sanitizeBrowserHeaders(path, headers = {}) {
const safeHeaders = {
...(headers || {}),
}

if (!isAdminProtectedApiPath(path)) {
return safeHeaders
}

Object.keys(safeHeaders).forEach((headerName) => {
if (LEGACY_BROWSER_ADMIN_HEADERS.has(headerName.toLowerCase())) {
delete safeHeaders[headerName]
}
})

return safeHeaders
}

function emitAdminSessionInvalid(path, error) {
if (!isAdminProtectedApiPath(path)) {
return
}

window.dispatchEvent(
new CustomEvent(ADMIN_SESSION_INVALID_EVENT, {
detail: {
path: normalizeApiPath(path),
status: error?.status || null,
payload: error?.payload || null,
},
})
)
}

export async function apiFetch(path, options = {}) {
const {
retryAdminAuth: _removedLegacyRetryOption,
...fetchOptions
} = options || {}

const safeHeaders = sanitizeBrowserHeaders(path, fetchOptions.headers)

const response = await fetch(`${API_BASE}${path}`, {
credentials: "include",
...fetchOptions,
headers: {
"Content-Type": "application/json",
...safeHeaders,
},
})

let payload = null

try {
payload = await response.json()
} catch {
payload = null
}

if (!response.ok) {
const error = new Error(
payload?.message ||
payload?.error ||
`Request failed (${response.status})`
)

error.status = response.status
error.payload = payload

if (
isAdminProtectedApiPath(path) &&
(response.status === 401 || response.status === 403)
) {
emitAdminSessionInvalid(path, error)
}

throw error
}

return payload
}

export async function apiFetchFirst(
paths,
options = {},
{ allowStatuses = [] } = {}
) {
let lastError = null

for (let index = 0; index < paths.length; index += 1) {
const path = paths[index]

try {
return await apiFetch(path, options)
} catch (error) {
lastError = error

if (allowStatuses.includes(error?.status)) {
return {
ok: false,
allowed_status: error.status,
payload: error.payload || null,
}
}

const isLast = index === paths.length - 1

if (error?.status === 404 && !isLast) {
continue
}

throw error
}
}

throw lastError || new Error("Request failed")
}

export async function loadAdminSessionStatus() {
const payload = await apiFetch(ADMIN_SESSION_STATUS_PATH)

const session = payload?.authenticated
? setAdminSessionSnapshot(payload.session)
: setAdminSessionSnapshot(null)

return {
...payload,
session,
}
}

export async function logoutAdminSession() {
try {
return await apiFetch(ADMIN_SESSION_LOGOUT_PATH, {
method: "POST",
body: JSON.stringify({}),
})
} finally {
setAdminSessionSnapshot(null)
purgeLegacyAdminCredentials()
}
}

function getBannerBaseClass(el) {
if (!el) return "admin-banner"

const stored = cleanText(el.dataset?.bannerBaseClass, 240)

if (stored) {
return stored
}

const removable = new Set([
"show",
"good",
"warn",
"bad",
"neutral",
])

const baseClasses = Array.from(el.classList || []).filter((className) => {
return !removable.has(className)
})

const baseClass = baseClasses.length
? baseClasses.join(" ")
: "admin-banner"

el.dataset.bannerBaseClass = baseClass

return baseClass
}

export function setBanner(el, message = "", variant = "warn") {
if (!el) return

const baseClass = getBannerBaseClass(el)

el.textContent = message || ""
el.className = baseClass

if (message) {
el.classList.add("show")
el.classList.add(variant || "warn")
}
}

export function clearBanner(el) {
if (!el) return

const baseClass = getBannerBaseClass(el)

el.className = baseClass
el.textContent = ""
}

export function createBannerController(el) {
return {
set(message = "", variant = "warn") {
setBanner(el, message, variant)
},
clear() {
clearBanner(el)
},
}
}

export function createPill(text, variant = "neutral") {
const span = document.createElement("span")

span.className = `pill admin-pill ${variant}`
span.textContent = cleanText(text, 120) || "—"

return span
}

export function renderTableEmpty(tbody, colspan, message) {
if (!tbody) return

tbody.innerHTML = ""

const row = document.createElement("tr")
const td = document.createElement("td")

td.colSpan = colspan
td.className = "admin-table-empty"
td.style.padding = "24px"
td.style.color = "var(--muted)"
td.style.textAlign = "center"
td.textContent = message

row.appendChild(td)
tbody.appendChild(row)
}

export function getStatusVariant(status) {
const normalized = cleanText(status, 32).toLowerCase()

if (
[
"approved",
"active",
"success",
"filled",
"simulated",
"live",
"clear",
"ready",
"enabled",
].includes(normalized)
) {
return "good"
}

if (
[
"rejected",
"restricted",
"frozen",
"inactive",
"failed",
"invalidated",
"emergency_stop",
"bad",
"critical",
"high",
"error",
"disabled",
].includes(normalized)
) {
return "bad"
}

if (
[
"pending",
"pending_info",
"scheduled",
"exhausted",
"planned",
"submitted",
"armed_mainnet",
"medium",
"warn",
"warning",
"loading",
"review",
].includes(normalized)
) {
return "warn"
}

return "neutral"
}

export function getRiskVariant(riskLevel) {
const normalized = cleanText(riskLevel, 32).toLowerCase()

if (normalized === "low") return "good"

if (normalized === "critical" || normalized === "high") {
return "bad"
}

if (normalized === "medium") return "warn"

return "neutral"
}

export function getPnlVariant(value) {
const num = Number(value)

if (!Number.isFinite(num) || Math.abs(num) < 0.005) {
return "neutral"
}

return num > 0 ? "good" : "bad"
}

export function getPnlClass(value) {
const variant = getPnlVariant(value)

if (variant === "good") return "pnl-good"
if (variant === "bad") return "pnl-bad"

return "pnl-neutral"
}

export function setMoneyTone(el, value, { lossPositive = false } = {}) {
if (!el) return

el.classList.remove(
"pnl-good",
"pnl-bad",
"pnl-neutral",
"sentinel-loss-metric"
)

const num = Number(value)

if (!Number.isFinite(num) || Math.abs(num) < 0.005) {
el.classList.add("pnl-neutral")
return
}

if (lossPositive) {
el.classList.add(num > 0 ? "pnl-bad" : "pnl-neutral")
el.classList.add("sentinel-loss-metric")
return
}

el.classList.add(num > 0 ? "pnl-good" : "pnl-bad")
}

export function createLoadingCounter({ onChange } = {}) {
let count = 0

function notify() {
if (typeof onChange === "function") {
onChange(count)
}
}

return {
begin() {
count += 1
notify()
},
end() {
count = Math.max(0, count - 1)
notify()
},
isLoading() {
return count > 0
},
getCount() {
return count
},
}
}

/*
Compatibility wrappers for any controller not yet replaced.
They no longer request, store, or transmit raw keys. Protected requests
authenticate only through the signed HTTP-only admin session cookie.
*/
export function createAdminKeyPrompt() {
return async function requestRemovedBrowserAdminKey() {
const error = new Error(
"Browser admin-key prompts have been removed. Sign in through the secure admin login page."
)

error.status = 401
error.code = "admin_session_required"

throw error
}
}

export function createAdminKeyApiFetch({ basePath = "" } = {}) {
const safeBasePath = cleanText(basePath, 500)

return async function apiFetchWithAdminSession(path, options = {}) {
return apiFetch(`${safeBasePath}${path}`, options)
}
}

export function bindHashTabs({
tabSelector = "[data-mss-admin-tab]",
activeClass = "active",
openDetailsSelector = "details.admin-section",
} = {}) {
document.querySelectorAll(tabSelector).forEach((tab) => {
tab.addEventListener("click", (event) => {
const sectionId = cleanText(
tab.getAttribute("data-mss-admin-tab"),
64
)

const href = cleanText(tab.getAttribute("href"), 128)

document.querySelectorAll(tabSelector).forEach((candidate) => {
candidate.classList.toggle(
activeClass,
cleanText(
candidate.getAttribute("data-mss-admin-tab"),
64
) === sectionId
)
})

if (!href.startsWith("#")) return

const target = document.getElementById(href.slice(1))

if (!target) return

event.preventDefault()

const sectionDetails = target.querySelector(openDetailsSelector)

if (sectionDetails) {
sectionDetails.open = true
}

target.scrollIntoView({
behavior: "smooth",
block: "start",
})

try {
window.history.replaceState(null, "", href)
} catch {}
})
})
}

purgeLegacyAdminCredentials()

window.addEventListener(ADMIN_SESSION_READY_EVENT, (event) => {
setAdminSessionSnapshot(event?.detail?.session || null)
})
