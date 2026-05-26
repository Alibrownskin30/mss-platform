const ADMIN_SESSION_GUARD_VERSION = "20260526-admin-session-api-v3"

const DEFAULT_LOGIN_PATH = "/admin-login.html"
const DEFAULT_FALLBACK_PATH = "/admin.html"

const ADMIN_SESSION_STATUS_PATH = "/api/admin-session/status"
const ADMIN_SESSION_LOGOUT_PATH = "/api/admin-session/logout"

const ADMIN_SCOPE = "admin"
const COMPLIANCE_ADMIN_SCOPE = "compliance_admin"
const SENTINEL_ADMIN_SCOPE = "sentinel_admin"
const SENTINEL_ACCESS_SCOPE = "sentinel_access"

const VALID_SCOPES = new Set([
ADMIN_SCOPE,
COMPLIANCE_ADMIN_SCOPE,
SENTINEL_ADMIN_SCOPE,
SENTINEL_ACCESS_SCOPE,
])

const state = {
checking: false,
checked: false,
authenticated: false,
session: null,
requiredScope: null,
statusPayload: null,
apiBase: null,
guardVersion: ADMIN_SESSION_GUARD_VERSION,
}

function cleanText(value, max = 1000) {
return String(value ?? "").trim().slice(0, max)
}

function unique(items = []) {
return [...new Set(items.filter(Boolean))]
}

function getApiBase() {
const { protocol, hostname } = window.location

/*
Production admin surfaces must always use the matching API deployment.
This is intentionally resolved before any optional local override so a
stale frontend value cannot send protected session checks to the web host.
*/
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

if (/:\d+$/.test(window.location.host)) {
return `${protocol}//${hostname}:8787`
}

return window.location.origin
}

const API_BASE = getApiBase()

state.apiBase = API_BASE

window.__MSS_ADMIN_GUARD_INFO__ = Object.freeze({
version: ADMIN_SESSION_GUARD_VERSION,
apiBase: API_BASE,
statusPath: ADMIN_SESSION_STATUS_PATH,
})

function normalizeScope(value) {
const normalized = cleanText(value, 64).toLowerCase()

return VALID_SCOPES.has(normalized) ? normalized : null
}

function getPagePathname() {
return cleanText(window.location.pathname, 255).toLowerCase()
}

function isAdminLoginPage() {
return getPagePathname().endsWith("/admin-login.html")
}

function inferRequiredScope() {
const configuredScope =
normalizeScope(document.documentElement?.dataset?.adminScope) ||
normalizeScope(document.body?.dataset?.adminScope) ||
normalizeScope(window.__MSS_ADMIN_REQUIRED_SCOPE__)

if (configuredScope) return configuredScope

const pathname = getPagePathname()

if (pathname.endsWith("/sentinel-access-admin.html")) {
return SENTINEL_ACCESS_SCOPE
}

/*
compliance-admin.html, sentinel-admin.html and sentinel-settings.html
currently rely on master-admin protected backend endpoints.
*/
if (
pathname.endsWith("/compliance-admin.html") ||
pathname.endsWith("/sentinel-admin.html") ||
pathname.endsWith("/sentinel-settings.html") ||
pathname.endsWith("/admin.html")
) {
return ADMIN_SCOPE
}

return ADMIN_SCOPE
}

function getCurrentReturnPath() {
const path = `${window.location.pathname}${window.location.search}${window.location.hash}`

if (path.startsWith("/") && !path.startsWith("//")) {
return path
}

return DEFAULT_FALLBACK_PATH
}

function getSafeLoginPath(value) {
const path = cleanText(value, 255)

if (path.startsWith("/") && !path.startsWith("//")) {
return path
}

return DEFAULT_LOGIN_PATH
}

function getApiHostLabel() {
try {
return new URL(API_BASE).host
} catch {
return API_BASE
}
}

function buildApiUrl(path, { noCache = false } = {}) {
const url = new URL(path, `${API_BASE}/`)

if (noCache) {
url.searchParams.set("guard", ADMIN_SESSION_GUARD_VERSION)
url.searchParams.set("nocache", String(Date.now()))
}

return url.toString()
}

function createHttpError(response, payload) {
const error = new Error(
payload?.message ||
payload?.error ||
`Admin session request failed (${response.status}).`
)

error.status = response.status
error.payload = payload

return error
}

async function requestJson(
path,
options = {},
{
noCache = false,
} = {}
) {
const {
headers: optionHeaders = {},
method: requestedMethod = "GET",
...fetchOptions
} = options

const method = cleanText(requestedMethod, 12).toUpperCase() || "GET"

const headers = {
Accept: "application/json",
...optionHeaders,
}

if (
method !== "GET" &&
method !== "HEAD" &&
!headers["Content-Type"] &&
!headers["content-type"]
) {
headers["Content-Type"] = "application/json"
}

const response = await fetch(buildApiUrl(path, { noCache }), {
credentials: "include",
cache: "no-store",
...fetchOptions,
method,
headers,
})

let payload = null

try {
payload = await response.json()
} catch {
payload = null
}

if (!response.ok) {
throw createHttpError(response, payload)
}

return payload
}

function isAdminSessionStatusPayload(payload) {
return Boolean(
payload &&
typeof payload === "object" &&
payload.ok === true &&
typeof payload.gate_enabled === "boolean" &&
typeof payload.session_configured === "boolean" &&
typeof payload.authenticated === "boolean"
)
}

function getGateDisabledMessage() {
return `The admin API at ${getApiHostLabel()} reported that admin authentication is disabled. Enable ADMIN_GATE_ENABLED on the API deployment before using this protected console.`
}

function getSessionNotConfiguredMessage() {
return `The admin API at ${getApiHostLabel()} has the gate enabled but cannot issue protected sessions. Configure ADMIN_SESSION_SECRET on that API deployment before using this console.`
}

function injectGuardStyles() {
if (document.getElementById("mssAdminSessionGuardStyles")) return

const style = document.createElement("style")
style.id = "mssAdminSessionGuardStyles"
style.textContent = `
html.mss-admin-auth-pending body {
visibility: hidden !important;
pointer-events: none !important;
}

html.mss-admin-auth-authorized body {
visibility: visible !important;
pointer-events: auto !important;
}

html.mss-admin-auth-blocked body > *:not(#mssAdminGuardScreen) {
display: none !important;
}

#mssAdminGuardScreen {
min-height: 100vh;
display: grid;
place-items: center;
padding: 28px;
box-sizing: border-box;
background:
radial-gradient(circle at 50% 16%, rgba(66, 153, 225, 0.12), transparent 34%),
radial-gradient(circle at 80% 4%, rgba(103, 232, 249, 0.06), transparent 28%),
#050811;
color: #f1f5f9;
font-family: Inter, "DM Sans", Arial, sans-serif;
}

.mss-admin-guard-card {
width: min(560px, 100%);
padding: 30px;
border-radius: 22px;
border: 1px solid rgba(118, 185, 255, 0.16);
background: rgba(8, 14, 27, 0.94);
box-shadow: 0 24px 90px rgba(0, 0, 0, 0.42);
}

.mss-admin-guard-eyebrow {
color: rgba(122, 211, 255, 0.9);
font-size: 11px;
font-weight: 800;
letter-spacing: 0.16em;
text-transform: uppercase;
margin-bottom: 13px;
}

.mss-admin-guard-title {
margin: 0 0 10px;
color: #f8fafc;
font-size: clamp(25px, 4vw, 31px);
line-height: 1.15;
font-weight: 800;
}

.mss-admin-guard-copy {
margin: 0 0 24px;
color: rgba(203, 213, 225, 0.74);
font-size: 14px;
line-height: 1.65;
}

.mss-admin-guard-meta {
margin: -10px 0 24px;
padding: 11px 12px;
border-radius: 11px;
border: 1px solid rgba(118, 185, 255, 0.1);
background: rgba(118, 185, 255, 0.045);
color: rgba(148, 180, 214, 0.74);
font-size: 11px;
line-height: 1.55;
word-break: break-word;
}

.mss-admin-guard-actions {
display: flex;
flex-wrap: wrap;
gap: 10px;
}

.mss-admin-guard-button {
min-height: 44px;
padding: 0 17px;
border-radius: 12px;
border: 1px solid rgba(118, 185, 255, 0.2);
background: rgba(118, 185, 255, 0.1);
color: #eef6ff;
cursor: pointer;
font-size: 13px;
font-weight: 750;
letter-spacing: 0.02em;
}

.mss-admin-guard-button.primary {
border-color: rgba(99, 184, 255, 0.42);
background: linear-gradient(
135deg,
rgba(38, 116, 211, 0.92),
rgba(44, 168, 228, 0.86)
);
}
`

document.head.appendChild(style)
}

function lockProtectedPage() {
injectGuardStyles()

document.documentElement.classList.remove(
"mss-admin-auth-authorized",
"mss-admin-auth-blocked"
)

document.documentElement.classList.add("mss-admin-auth-pending")
document.documentElement.dataset.adminProtected = "true"
document.documentElement.setAttribute("aria-busy", "true")
}

function unlockProtectedPage(session) {
document.documentElement.classList.remove(
"mss-admin-auth-pending",
"mss-admin-auth-blocked"
)

document.documentElement.classList.add("mss-admin-auth-authorized")
document.documentElement.dataset.adminAuthorized = "true"
document.documentElement.removeAttribute("aria-busy")

window.__MSS_ADMIN_SESSION__ = session || null

window.dispatchEvent(
new CustomEvent("mss:admin-session-ready", {
detail: {
authenticated: true,
session: session || null,
requiredScope: state.requiredScope,
apiBase: API_BASE,
guardVersion: ADMIN_SESSION_GUARD_VERSION,
},
})
)
}

function buildLoginRedirect(loginPath, reason = "") {
const safePath = getSafeLoginPath(loginPath)
const url = new URL(safePath, window.location.origin)

url.searchParams.set("redirect", getCurrentReturnPath())
url.searchParams.set("scope", state.requiredScope || ADMIN_SCOPE)

if (reason) {
url.searchParams.set("reason", cleanText(reason, 64))
}

return `${url.pathname}${url.search}${url.hash}`
}

function redirectToLogin(loginPath = DEFAULT_LOGIN_PATH, reason = "required") {
const destination = buildLoginRedirect(loginPath, reason)

window.location.replace(destination)
}

function sessionAllowsScope(session, requiredScope) {
const sessionScopes = unique(
Array.isArray(session?.scopes)
? session.scopes.map((scope) => normalizeScope(scope)).filter(Boolean)
: []
)

if (sessionScopes.includes(ADMIN_SCOPE)) {
return true
}

if (requiredScope === SENTINEL_ACCESS_SCOPE) {
return (
sessionScopes.includes(SENTINEL_ACCESS_SCOPE) ||
sessionScopes.includes(SENTINEL_ADMIN_SCOPE)
)
}

if (requiredScope === COMPLIANCE_ADMIN_SCOPE) {
return sessionScopes.includes(COMPLIANCE_ADMIN_SCOPE)
}

if (requiredScope === SENTINEL_ADMIN_SCOPE) {
return sessionScopes.includes(SENTINEL_ADMIN_SCOPE)
}

return false
}

function createElement(tag, className = "", text = "") {
const element = document.createElement(tag)

if (className) element.className = className
if (text) element.textContent = text

return element
}

function renderGuardFailure({
title = "Admin access unavailable",
message = "The admin authentication check could not be completed.",
showLogin = true,
showMeta = false,
} = {}) {
document.documentElement.classList.remove(
"mss-admin-auth-pending",
"mss-admin-auth-authorized"
)

document.documentElement.classList.add("mss-admin-auth-blocked")
document.documentElement.removeAttribute("aria-busy")

const render = () => {
document.getElementById("mssAdminGuardScreen")?.remove()

const screen = createElement("div")
screen.id = "mssAdminGuardScreen"

const card = createElement("section", "mss-admin-guard-card")
const eyebrow = createElement(
"div",
"mss-admin-guard-eyebrow",
"MSS Protocol · Restricted Administration"
)
const heading = createElement("h1", "mss-admin-guard-title", title)
const copy = createElement("p", "mss-admin-guard-copy", message)
const actions = createElement("div", "mss-admin-guard-actions")

card.appendChild(eyebrow)
card.appendChild(heading)
card.appendChild(copy)

if (showMeta) {
const meta = createElement(
"div",
"mss-admin-guard-meta",
`Session API: ${getApiHostLabel()} · Guard build: ${ADMIN_SESSION_GUARD_VERSION}`
)

card.appendChild(meta)
}

const retryButton = createElement(
"button",
"mss-admin-guard-button",
"Retry authentication"
)

retryButton.type = "button"
retryButton.addEventListener("click", () => window.location.reload())

actions.appendChild(retryButton)

if (showLogin) {
const loginButton = createElement(
"button",
"mss-admin-guard-button primary",
"Return to admin sign-in"
)

loginButton.type = "button"
loginButton.addEventListener("click", () => {
redirectToLogin(
state.statusPayload?.login_path || DEFAULT_LOGIN_PATH,
"required"
)
})

actions.prepend(loginButton)
}

card.appendChild(actions)
screen.appendChild(card)

document.body.appendChild(screen)
}

if (document.body) {
render()
} else {
window.addEventListener("DOMContentLoaded", render, { once: true })
}
}

async function loadAdminSessionStatus() {
const payload = await requestJson(
ADMIN_SESSION_STATUS_PATH,
{
method: "GET",
},
{
noCache: true,
}
)

if (!isAdminSessionStatusPayload(payload)) {
throw new Error(
`The session API at ${getApiHostLabel()} returned an invalid admin-session status response.`
)
}

return payload
}

async function logoutAdminSession({ redirect = true } = {}) {
try {
await requestJson(
ADMIN_SESSION_LOGOUT_PATH,
{
method: "POST",
body: JSON.stringify({}),
},
{
noCache: true,
}
)
} finally {
state.authenticated = false
state.session = null
window.__MSS_ADMIN_SESSION__ = null

if (redirect) {
redirectToLogin(
state.statusPayload?.login_path || DEFAULT_LOGIN_PATH,
"logged_out"
)
}
}
}

function bindLogoutButtons() {
const logoutButtons = document.querySelectorAll(
"[data-admin-logout], #adminLogoutButton, #logoutAdminButton"
)

logoutButtons.forEach((button) => {
if (button.dataset.adminLogoutBound === "true") return

button.dataset.adminLogoutBound = "true"

button.addEventListener("click", async (event) => {
event.preventDefault()

button.disabled = true

try {
await logoutAdminSession()
} catch (error) {
console.error("Admin logout failed", error)
button.disabled = false
}
})
})
}

async function requireAdminSession({
requiredScope = inferRequiredScope(),
redirectUnauthenticated = true,
} = {}) {
state.checking = true
state.requiredScope = normalizeScope(requiredScope) || ADMIN_SCOPE

lockProtectedPage()

try {
const payload = await loadAdminSessionStatus()

state.statusPayload = payload || null
state.checked = true

if (payload.gate_enabled !== true) {
renderGuardFailure({
title: "Admin gate is disabled",
message: getGateDisabledMessage(),
showLogin: false,
showMeta: true,
})

return null
}

if (payload.session_configured !== true) {
renderGuardFailure({
title: "Admin session is not configured",
message: getSessionNotConfiguredMessage(),
showLogin: false,
showMeta: true,
})

return null
}

if (!payload.authenticated || !payload.session) {
state.authenticated = false
state.session = null

if (redirectUnauthenticated) {
redirectToLogin(payload.login_path || DEFAULT_LOGIN_PATH, "required")
return null
}

renderGuardFailure({
title: "Admin sign-in required",
message: "A valid admin session is required to open this page.",
showMeta: true,
})

return null
}

if (!sessionAllowsScope(payload.session, state.requiredScope)) {
state.authenticated = false
state.session = payload.session

redirectToLogin(payload.login_path || DEFAULT_LOGIN_PATH, "forbidden")
return null
}

state.authenticated = true
state.session = payload.session

unlockProtectedPage(payload.session)
bindLogoutButtons()

return payload.session
} catch (error) {
console.error("Admin session guard failed", error)

renderGuardFailure({
title: "Authentication check failed",
message:
error?.message ||
"The admin session could not be verified. Check that the API is online and try again.",
showMeta: true,
})

return null
} finally {
state.checking = false
}
}

function initializeAdminSessionGuard() {
if (isAdminLoginPage()) return

requireAdminSession().catch((error) => {
console.error("Failed to initialize admin session guard", error)

renderGuardFailure({
title: "Authentication check failed",
message: "The admin page could not be securely opened.",
showMeta: true,
})
})
}

window.MSSAdminSessionGuard = {
version: ADMIN_SESSION_GUARD_VERSION,
apiBase: API_BASE,
getState() {
return { ...state }
},
requireAdminSession,
logoutAdminSession,
}

initializeAdminSessionGuard()

export {
ADMIN_SCOPE,
COMPLIANCE_ADMIN_SCOPE,
SENTINEL_ADMIN_SCOPE,
SENTINEL_ACCESS_SCOPE,
getApiBase,
inferRequiredScope,
loadAdminSessionStatus,
logoutAdminSession,
requireAdminSession,
}
