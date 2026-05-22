const DEFAULT_CURRENCY = "USD"

export const todayIso = new Date().toISOString().slice(0, 10)

export const ADMIN_GATE_STORAGE_KEY = "mss_admin_gate_key"
export const SENTINEL_ACCESS_ADMIN_KEY_STORAGE_KEY = "mss_sentinel_access_admin_key"

const ADMIN_GATE_HEADER_NAME = "x-admin-key"
const SENTINEL_ACCESS_ADMIN_HEADER_NAME = "x-sentinel-access-admin-key"

const ADMIN_GATE_WINDOW_OVERRIDE_KEYS = [
"__MSS_ADMIN_GATE_KEY__",
"__MSS_ADMIN_KEY__",
"__ADMIN_GATE_KEY__",
]

const SENTINEL_ACCESS_WINDOW_OVERRIDE_KEYS = [
"__SENTINEL_ACCESS_ADMIN_KEY__",
"__MSS_SENTINEL_ACCESS_ADMIN_KEY__",
"__MSS_ADMIN_GATE_KEY__",
"__MSS_ADMIN_KEY__",
]

const adminPromptInFlight = new Map()

export function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max)
}

export function parseBool(value, fallback = false) {
if (typeof value === "boolean") return value

const normalized = cleanText(value, 16).toLowerCase()

if (["true", "1", "yes", "y", "enabled", "on"].includes(normalized)) return true
if (["false", "0", "no", "n", "disabled", "off"].includes(normalized)) return false

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
if (Number.isFinite(num)) return num
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
if (!value || Number.isNaN(date.getTime())) return "—"
return date.toLocaleString()
}

export function formatDate(value) {
const date = new Date(value)
if (!value || Number.isNaN(date.getTime())) return "—"
return date.toLocaleDateString()
}

export function formatCurrency(value, currency = DEFAULT_CURRENCY) {
const num = Number(value)
if (!Number.isFinite(num)) return "$0.00"

return new Intl.NumberFormat(undefined, {
style: "currency",
currency,
maximumFractionDigits: 2,
}).format(num)
}

export function formatSignedCurrency(value, currency = DEFAULT_CURRENCY) {
const num = Number(value)
if (!Number.isFinite(num)) return "$0.00"

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
if (!Number.isFinite(num)) return "0%"
return `${num.toFixed(fractionDigits)}%`
}

export function formatSignedPercent(value, fractionDigits = 1) {
const num = Number(value)
if (!Number.isFinite(num)) return "0%"

const prefix = num > 0 ? "+" : ""
return `${prefix}${num.toFixed(fractionDigits)}%`
}

export function formatNumber(value, fractionDigits = 0) {
const num = Number(value)
if (!Number.isFinite(num)) return "0"

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
if (item) item.disabled = Boolean(disabled)
})
}

export function getApiBase() {
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
return normalized === "/api/compliance-admin" || normalized.startsWith("/api/compliance-admin/")
}

export function isSentinelAccessAdminApiPath(path) {
const normalized = normalizeApiPath(path)
return (
normalized === "/api/sentinel-access-admin" ||
normalized.startsWith("/api/sentinel-access-admin/")
)
}

export function isAdminProtectedApiPath(path) {
return isComplianceAdminApiPath(path) || isSentinelAccessAdminApiPath(path)
}

function readWindowOverride(windowOverrideKey = "") {
const keys = Array.isArray(windowOverrideKey)
? windowOverrideKey
: [windowOverrideKey].filter(Boolean)

for (const key of keys) {
const value = cleanText(window[key] || "", 2000)
if (value) return value
}

return ""
}

export function getStoredAdminKey(storageKey, windowOverrideKey = "") {
const override = readWindowOverride(windowOverrideKey)
if (override) return override

try {
return cleanText(localStorage.getItem(storageKey), 2000)
} catch {
return ""
}
}

export function storeAdminKey(storageKey, value) {
try {
const clean = cleanText(value, 2000)

if (!clean) {
localStorage.removeItem(storageKey)
return
}

localStorage.setItem(storageKey, clean)
} catch {}
}

export function getStoredAdminGateKey() {
return getStoredAdminKey(ADMIN_GATE_STORAGE_KEY, ADMIN_GATE_WINDOW_OVERRIDE_KEYS)
}

export function getStoredSentinelAccessAdminKey() {
return getStoredAdminKey(
SENTINEL_ACCESS_ADMIN_KEY_STORAGE_KEY,
SENTINEL_ACCESS_WINDOW_OVERRIDE_KEYS
)
}

export function getStoredAdminKeyForPath(path) {
if (isSentinelAccessAdminApiPath(path)) {
return getStoredAdminGateKey() || getStoredSentinelAccessAdminKey()
}

if (isComplianceAdminApiPath(path)) {
return getStoredAdminGateKey()
}

return ""
}

export function clearStoredAdminKeyForPath(path) {
if (isSentinelAccessAdminApiPath(path)) {
storeAdminKey(SENTINEL_ACCESS_ADMIN_KEY_STORAGE_KEY, "")
storeAdminKey(ADMIN_GATE_STORAGE_KEY, "")
return
}

if (isComplianceAdminApiPath(path)) {
storeAdminKey(ADMIN_GATE_STORAGE_KEY, "")
}
}

function getAdminAuthContextForPath(path) {
if (isSentinelAccessAdminApiPath(path)) {
return {
storageKey: SENTINEL_ACCESS_ADMIN_KEY_STORAGE_KEY,
windowOverrideKey: SENTINEL_ACCESS_WINDOW_OVERRIDE_KEYS,
promptLabel: "Enter Sentinel Access admin key",
missingKeyMessage: "Sentinel Access admin key is required.",
kind: "sentinel-access-admin",
}
}

if (isComplianceAdminApiPath(path)) {
return {
storageKey: ADMIN_GATE_STORAGE_KEY,
windowOverrideKey: ADMIN_GATE_WINDOW_OVERRIDE_KEYS,
promptLabel: "Enter MSS admin gate key",
missingKeyMessage: "MSS admin gate key is required.",
kind: "admin-gate",
}
}

return null
}

export function getAdminHeadersForPath(path, { overrideKey = "" } = {}) {
if (!isAdminProtectedApiPath(path)) return {}

const key = cleanText(overrideKey, 2000) || getStoredAdminKeyForPath(path)
if (!key) return {}

const headers = {
[ADMIN_GATE_HEADER_NAME]: key,
}

if (isSentinelAccessAdminApiPath(path)) {
headers[SENTINEL_ACCESS_ADMIN_HEADER_NAME] = key
}

return headers
}

async function requestAdminKeyForPath(path) {
const context = getAdminAuthContextForPath(path)

if (!context) return ""

const promptKey = `${context.kind}:${context.storageKey}`

if (adminPromptInFlight.has(promptKey)) {
return adminPromptInFlight.get(promptKey)
}

const task = Promise.resolve().then(() => {
const entered = window.prompt(context.promptLabel)
const clean = cleanText(entered, 2000)

if (clean) {
storeAdminKey(context.storageKey, clean)

if (context.kind === "admin-gate") {
storeAdminKey(ADMIN_GATE_STORAGE_KEY, clean)
}

return clean
}

return ""
})

adminPromptInFlight.set(promptKey, task)

return task.finally(() => {
adminPromptInFlight.delete(promptKey)
})
}

async function apiFetchOnce(path, options = {}, { adminKeyOverride = "" } = {}) {
const adminHeaders = getAdminHeadersForPath(path, {
overrideKey: adminKeyOverride,
})

const response = await fetch(`${API_BASE}${path}`, {
credentials: "include",
headers: {
"Content-Type": "application/json",
...adminHeaders,
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

export async function apiFetch(path, options = {}) {
const {
retryAdminAuth = true,
...fetchOptions
} = options || {}

try {
return await apiFetchOnce(path, fetchOptions)
} catch (error) {
if (!retryAdminAuth || error?.status !== 401 || !isAdminProtectedApiPath(path)) {
throw error
}

clearStoredAdminKeyForPath(path)

const retryKey = await requestAdminKeyForPath(path)
const context = getAdminAuthContextForPath(path)

if (!retryKey) {
const missingError = new Error(context?.missingKeyMessage || "Admin key is required.")
missingError.status = 401
missingError.payload = error?.payload || null
throw missingError
}

return apiFetchOnce(path, fetchOptions, {
adminKeyOverride: retryKey,
})
}
}

export async function apiFetchFirst(paths, options = {}, { allowStatuses = [] } = {}) {
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
if (error?.status === 404 && !isLast) continue

throw error
}
}

throw lastError || new Error("Request failed")
}

function getBannerBaseClass(el) {
if (!el) return "admin-banner"

const stored = cleanText(el.dataset?.bannerBaseClass, 240)
if (stored) return stored

const removable = new Set(["show", "good", "warn", "bad", "neutral"])
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
if (normalized === "critical" || normalized === "high") return "bad"
if (normalized === "medium") return "warn"

return "neutral"
}

export function getPnlVariant(value) {
const num = Number(value)

if (!Number.isFinite(num) || Math.abs(num) < 0.005) return "neutral"

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

el.classList.remove("pnl-good", "pnl-bad", "pnl-neutral", "sentinel-loss-metric")

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

export function createAdminKeyPrompt({
storageKey,
promptLabel = "Enter admin key",
windowOverrideKey = "",
} = {}) {
let promptInFlight = null

return async function requestAdminKey() {
if (promptInFlight) return promptInFlight

promptInFlight = Promise.resolve().then(() => {
const entered = window.prompt(promptLabel)
const clean = cleanText(entered, 2000)

if (clean) {
storeAdminKey(storageKey, clean)
return clean
}

return ""
})

return promptInFlight.finally(() => {
promptInFlight = null
})
}
}

export function createAdminKeyApiFetch({
basePath,
storageKey,
windowOverrideKey = "",
headerName = ADMIN_GATE_HEADER_NAME,
promptLabel = "Enter admin key",
missingKeyMessage = "Admin key is required.",
} = {}) {
const requestAdminKey = createAdminKeyPrompt({
storageKey,
promptLabel,
windowOverrideKey,
})

return async function apiFetchWithAdminKey(
path,
options = {},
{ retryOnUnauthorized = true } = {}
) {
const storedKey = getStoredAdminKey(storageKey, windowOverrideKey)

const headers = {
...(options.headers || {}),
}

if (storedKey) {
headers[headerName] = storedKey

if (basePath === "/api/sentinel-access-admin") {
headers[SENTINEL_ACCESS_ADMIN_HEADER_NAME] = storedKey
}
}

try {
return await apiFetch(`${basePath}${path}`, {
...options,
headers,
retryAdminAuth: false,
})
} catch (error) {
if (retryOnUnauthorized && error?.status === 401) {
storeAdminKey(storageKey, "")

const retryKey = await requestAdminKey()

if (!retryKey) {
throw new Error(missingKeyMessage)
}

return apiFetch(`${basePath}${path}`, {
...options,
headers: {
...(options.headers || {}),
[headerName]: retryKey,
...(basePath === "/api/sentinel-access-admin"
? { [SENTINEL_ACCESS_ADMIN_HEADER_NAME]: retryKey }
: {}),
},
retryAdminAuth: false,
})
}

throw error
}
}
}

export function bindHashTabs({
tabSelector = "[data-mss-admin-tab]",
activeClass = "active",
openDetailsSelector = "details.admin-section",
} = {}) {
document.querySelectorAll(tabSelector).forEach((tab) => {
tab.addEventListener("click", (event) => {
const sectionId = cleanText(tab.getAttribute("data-mss-admin-tab"), 64)
const href = cleanText(tab.getAttribute("href"), 128)

document.querySelectorAll(tabSelector).forEach((candidate) => {
candidate.classList.toggle(
activeClass,
cleanText(candidate.getAttribute("data-mss-admin-tab"), 64) === sectionId
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

target.scrollIntoView({ behavior: "smooth", block: "start" })

try {
window.history.replaceState(null, "", href)
} catch {}
})
})
}
