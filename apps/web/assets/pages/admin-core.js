const DEFAULT_CURRENCY = "USD"

export const todayIso = new Date().toISOString().slice(0, 10)

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

export async function apiFetch(path, options = {}) {
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

export function setBanner(el, message = "", variant = "warn") {
if (!el) return

el.textContent = message || ""
el.className = "banner"

if (message) {
el.classList.add("show")
el.classList.add(variant)
}
}

export function clearBanner(el) {
if (!el) return

el.className = "banner"
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
span.className = `pill ${variant}`
span.textContent = cleanText(text, 120) || "—"
return span
}

export function renderTableEmpty(tbody, colspan, message) {
if (!tbody) return

tbody.innerHTML = ""

const row = document.createElement("tr")
const td = document.createElement("td")

td.colSpan = colspan
td.style.padding = "24px"
td.style.color = "var(--muted)"
td.style.textAlign = "center"
td.textContent = message

row.appendChild(td)
tbody.appendChild(row)
}

export function getStatusVariant(status) {
const normalized = cleanText(status, 32).toLowerCase()

if (["approved", "active", "success", "filled", "simulated", "live"].includes(normalized)) {
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

export function getStoredAdminKey(storageKey, windowOverrideKey = "") {
const override = windowOverrideKey ? cleanText(window[windowOverrideKey] || "", 2000) : ""
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
headerName = "x-admin-key",
promptLabel = "Enter admin key",
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
}

try {
return await apiFetch(`${basePath}${path}`, {
...options,
headers,
})
} catch (error) {
if (retryOnUnauthorized && error?.status === 401) {
storeAdminKey(storageKey, "")

const retryKey = await requestAdminKey()

if (!retryKey) {
throw new Error("Admin key is required.")
}

return apiFetch(`${basePath}${path}`, {
...options,
headers: {
...(options.headers || {}),
[headerName]: retryKey,
},
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
