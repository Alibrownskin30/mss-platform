import {
apiFetch,
arrayify,
cleanText,
formatDateTime,
} from "./admin-core.js"

const ADMIN_SESSION_BASE_PATH = "/api/admin-session"
const ADMIN_SESSION_STATUS_PATH = `${ADMIN_SESSION_BASE_PATH}/status`
const ADMIN_SESSION_LOGIN_PATH = `${ADMIN_SESSION_BASE_PATH}/login`
const ADMIN_ACTOR_STORAGE_KEY = "mss_admin_actor_id"

const ADMIN_PAGE_RULES = Object.freeze({
"admin.html": ["admin"],
"compliance-admin.html": ["admin"],
"sentinel-admin.html": ["admin"],
"sentinel-access-admin.html": [
"admin",
"sentinel_admin",
"sentinel_access",
],
})

const state = {
loading: false,
gateEnabled: true,
sessionConfigured: true,
session: null,
statusPayload: null,
redirectTimer: null,
}

const els = {
form: document.getElementById("adminLoginForm"),
keyInput: document.getElementById("adminLoginKeyInput"),
actorInput: document.getElementById("adminLoginActorInput"),
keyToggleButton: document.getElementById("adminLoginKeyToggleButton"),
submitButton: document.getElementById("adminLoginSubmitButton"),

statusChip: document.getElementById("adminLoginStatusChip"),
banner: document.getElementById("adminLoginBanner"),

existingSessionPanel: document.getElementById("adminExistingSessionPanel"),
existingSessionCopy: document.getElementById("adminExistingSessionCopy"),
continueSessionButton: document.getElementById("adminContinueSessionButton"),
}

function normalizeScopes(scopes) {
return arrayify(scopes)
.map((scope) => cleanText(scope, 64).toLowerCase())
.filter(Boolean)
}

function getStoredActorId() {
try {
return cleanText(localStorage.getItem(ADMIN_ACTOR_STORAGE_KEY), 120)
} catch {
return ""
}
}

function storeActorId(actorId) {
try {
const normalized = cleanText(actorId, 120)

if (!normalized) {
localStorage.removeItem(ADMIN_ACTOR_STORAGE_KEY)
return
}

localStorage.setItem(ADMIN_ACTOR_STORAGE_KEY, normalized)
} catch {}
}

function sleep(ms = 0) {
return new Promise((resolve) => {
window.setTimeout(resolve, Math.max(0, Number(ms) || 0))
})
}

function setStatusChip(label = "Authentication Required", variant = "") {
if (!els.statusChip) return

els.statusChip.textContent = label
els.statusChip.className = "admin-login-chip"

if (variant) {
els.statusChip.classList.add(variant)
}
}

function setBanner(message = "", variant = "warn") {
if (!els.banner) return

els.banner.textContent = message || ""
els.banner.className = "admin-login-banner"

if (message) {
els.banner.classList.add("show")
els.banner.classList.add(variant || "warn")
}
}

function clearBanner() {
setBanner("")
}

function updateControlState() {
const authenticationUnavailable =
!state.gateEnabled || !state.sessionConfigured

const disableForm = state.loading || authenticationUnavailable

if (els.keyInput) {
els.keyInput.disabled = disableForm
}

if (els.actorInput) {
els.actorInput.disabled = disableForm
}

if (els.keyToggleButton) {
els.keyToggleButton.disabled = disableForm
}

if (els.submitButton) {
els.submitButton.disabled = disableForm

if (state.loading) {
els.submitButton.textContent = "Authenticating..."
} else if (!state.gateEnabled) {
els.submitButton.textContent = "Authentication Disabled"
} else if (!state.sessionConfigured) {
els.submitButton.textContent = "Configuration Required"
} else {
els.submitButton.textContent = "Authenticate and Continue"
}
}

if (els.continueSessionButton) {
els.continueSessionButton.disabled = state.loading || !state.session
}
}

function setLoading(loading) {
state.loading = Boolean(loading)
updateControlState()
}

function getSessionCandidates(payload) {
if (!payload || typeof payload !== "object") {
return []
}

return [
payload.session,
payload.admin_session,
payload.data?.session,
payload.session?.session,
payload.admin_session?.session,
payload,
].filter((candidate) => candidate && typeof candidate === "object")
}

function getSessionPayload(payload) {
if (!payload || typeof payload !== "object") {
return null
}

if (payload.authenticated === false) {
return null
}

const candidates = getSessionCandidates(payload)

for (const source of candidates) {
const scopes = normalizeScopes(
source.scopes ||
source.permissions ||
payload.scopes ||
payload.permissions
)

if (!scopes.length) {
continue
}

return {
actor:
cleanText(
source.actor ||
source.actor_id ||
payload.actor ||
payload.actor_id,
120
) || "admin",
scopes,
credentialType: cleanText(
source.credential_type ||
source.credentialType ||
payload.credential_type ||
payload.credentialType,
64
),
issuedAt:
source.issued_at ||
source.issuedAt ||
payload.issued_at ||
payload.issuedAt ||
null,
expiresAt:
source.expires_at ||
source.expiresAt ||
payload.expires_at ||
payload.expiresAt ||
null,
bypass: false,
}
}

return null
}

function sessionHasScope(session, scope) {
const scopes = normalizeScopes(session?.scopes)

return scopes.includes("admin") || scopes.includes(scope)
}

function normalizeAdminPage(value) {
const raw = cleanText(value, 500)

if (!raw) return ""

let pathname = raw

try {
const parsed = new URL(raw, window.location.origin)

if (parsed.origin !== window.location.origin) {
return ""
}

pathname = parsed.pathname
} catch {
pathname = raw
}

const pageName = pathname
.replace(/^\.?\//, "")
.split("/")
.pop()
?.split("?")[0]
?.split("#")[0]

if (!pageName) return ""

return Object.prototype.hasOwnProperty.call(ADMIN_PAGE_RULES, pageName)
? pageName
: ""
}

function getRequestedAdminPage() {
const params = new URLSearchParams(window.location.search)

return normalizeAdminPage(
params.get("redirect") ||
params.get("next") ||
params.get("return_to") ||
""
)
}

function canOpenAdminPage(session, pageName) {
const allowedScopes = ADMIN_PAGE_RULES[pageName] || []

return allowedScopes.some((scope) => sessionHasScope(session, scope))
}

function getDefaultAdminPage(session) {
if (sessionHasScope(session, "admin")) {
return "admin.html"
}

if (sessionHasScope(session, "sentinel_admin")) {
return "sentinel-admin.html"
}

if (sessionHasScope(session, "sentinel_access")) {
return "sentinel-access-admin.html"
}

return ""
}

function getRedirectTarget(session) {
const requestedPage = getRequestedAdminPage()

if (requestedPage && canOpenAdminPage(session, requestedPage)) {
return `./${requestedPage}`
}

const fallbackPage = getDefaultAdminPage(session)

return fallbackPage ? `./${fallbackPage}` : ""
}

function getRequestedRedirectPath() {
const requestedPage = getRequestedAdminPage()

return requestedPage ? `/${requestedPage}` : "/admin.html"
}

function redirectToAdmin(session, { immediate = false } = {}) {
const target = getRedirectTarget(session)

if (!target) {
setBanner(
"Your credential is valid, but it is not assigned to an available administrative surface.",
"warn"
)
return
}

if (state.redirectTimer) {
window.clearTimeout(state.redirectTimer)
state.redirectTimer = null
}

if (immediate) {
window.location.replace(target)
return
}

state.redirectTimer = window.setTimeout(() => {
window.location.replace(target)
}, 450)
}

function hideExistingSession() {
if (els.existingSessionPanel) {
els.existingSessionPanel.classList.remove("show")
}

if (els.existingSessionCopy) {
els.existingSessionCopy.textContent =
"You already have an authenticated administrative session."
}
}

function renderExistingSession(session) {
state.session = session

const actor = cleanText(session?.actor, 120) || "admin"
const expiryText = session?.expiresAt
? formatDateTime(session.expiresAt)
: "the configured session expiry"

setStatusChip("Session Active", "good")

if (els.existingSessionPanel) {
els.existingSessionPanel.classList.add("show")
}

if (els.existingSessionCopy) {
els.existingSessionCopy.textContent =
`Authenticated as ${actor}. This protected session remains active until ${expiryText}.`
}

updateControlState()
}

function renderGateDisabled() {
state.session = {
actor: "local-environment",
scopes: ["admin"],
bypass: true,
expiresAt: null,
}

setStatusChip("Gate Disabled", "warn")

if (els.existingSessionPanel) {
els.existingSessionPanel.classList.add("show")
}

if (els.existingSessionCopy) {
els.existingSessionCopy.textContent =
"Administrative authentication is disabled in this environment. Continue only for local or controlled testing."
}

setBanner(
"Admin gate protection is disabled. Do not deploy this configuration publicly.",
"warn"
)

updateControlState()
}

function renderUnauthenticated() {
state.session = null
hideExistingSession()
setStatusChip("Authentication Required")
updateControlState()
}

function renderSessionNotConfigured() {
state.session = null
hideExistingSession()
setStatusChip("Configuration Required", "bad")
setBanner(
"Admin session authentication is not configured on the API. Add ADMIN_SESSION_SECRET to the environment and restart the backend.",
"bad"
)
updateControlState()
}

function getLoginErrorMessage(error) {
const errorCode = cleanText(
error?.code ||
error?.payload?.error,
160
)

if (errorCode === "admin_gate_disabled" || error?.status === 409) {
return "Admin authentication is disabled in this environment."
}

if (
errorCode === "invalid_admin_key" ||
error?.status === 401 ||
error?.status === 403
) {
return "Invalid admin access key or insufficient access permissions."
}

if (
errorCode === "too_many_admin_login_attempts" ||
error?.status === 429
) {
return "Too many authentication attempts. Wait before trying again."
}

if (
errorCode === "admin_session_not_configured" ||
error?.status === 503
) {
return "The admin session layer is not fully configured on the server."
}

if (errorCode === "admin_session_cookie_not_verified") {
return "The key was accepted, but the protected admin session was not retained. The API session-cookie or domain configuration still needs correction."
}

if (error?.status === 404) {
return "The admin session endpoints have not been wired into the API yet."
}

return error?.message || "Authentication failed."
}

async function adminRequest(path, options = {}) {
return apiFetch(path, {
cache: "no-store",
...options,
headers: {
Accept: "application/json",
"Cache-Control": "no-cache",
...(options.headers || {}),
},
})
}

async function fetchSessionStatus() {
const payload = await adminRequest(
`${ADMIN_SESSION_STATUS_PATH}?nocache=${Date.now()}`
)

state.statusPayload = payload || null
state.gateEnabled = payload?.gate_enabled !== false
state.sessionConfigured = payload?.session_configured !== false

return payload
}

async function loadExistingSession() {
setLoading(true)
clearBanner()

try {
const payload = await fetchSessionStatus()

if (!state.gateEnabled) {
renderGateDisabled()
return state.session
}

if (!state.sessionConfigured) {
renderSessionNotConfigured()
return null
}

const session = getSessionPayload(payload)

if (!session) {
renderUnauthenticated()
return null
}

renderExistingSession(session)

return session
} catch (error) {
state.gateEnabled = true
state.sessionConfigured = true
renderUnauthenticated()

if (error?.status === 404) {
setBanner(
"The login page is ready, but the API admin-session endpoints are not available.",
"warn"
)
return null
}

setBanner(
error?.message || "Unable to verify the current admin session.",
"bad"
)

return null
} finally {
setLoading(false)
}
}

async function verifyAuthenticatedSessionAfterLogin(loginPayload) {
const responseSession = getSessionPayload(loginPayload)
let latestStatusPayload = null

for (let attempt = 0; attempt < 2; attempt += 1) {
if (attempt > 0) {
await sleep(140)
}

latestStatusPayload = await fetchSessionStatus()

if (!state.gateEnabled) {
return {
session: state.session,
statusPayload: latestStatusPayload,
gateDisabled: true,
}
}

if (!state.sessionConfigured) {
return {
session: null,
statusPayload: latestStatusPayload,
sessionNotConfigured: true,
}
}

const verifiedSession = getSessionPayload(latestStatusPayload)

if (verifiedSession) {
return {
session: verifiedSession,
statusPayload: latestStatusPayload,
}
}
}

if (responseSession) {
const error = new Error(
"The server returned a login session, but the browser could not verify the protected session cookie."
)
error.code = "admin_session_cookie_not_verified"
error.payload = latestStatusPayload
throw error
}

const error = new Error(
"The key was accepted, but no authenticated admin session was returned by the API."
)
error.code = "admin_session_cookie_not_verified"
error.payload = latestStatusPayload
throw error
}

async function submitLogin(event) {
event.preventDefault()

if (state.loading) return

if (!state.gateEnabled) {
redirectToAdmin(state.session, { immediate: true })
return
}

if (!state.sessionConfigured) {
renderSessionNotConfigured()
return
}

const adminKey = cleanText(els.keyInput?.value, 2000)

const actorId =
cleanText(els.actorInput?.value, 120) ||
getStoredActorId() ||
"admin"

if (!adminKey) {
setBanner("Enter an authorised admin access key.", "warn")
els.keyInput?.focus()
return
}

setLoading(true)
clearBanner()
setStatusChip("Authenticating")

try {
const loginPayload = await adminRequest(ADMIN_SESSION_LOGIN_PATH, {
method: "POST",
body: JSON.stringify({
key: adminKey,
admin_key: adminKey,
actor: actorId,
actor_id: actorId,
redirect_path: getRequestedRedirectPath(),
}),
})

const verification = await verifyAuthenticatedSessionAfterLogin(loginPayload)

if (verification.gateDisabled) {
renderGateDisabled()
redirectToAdmin(state.session)
return
}

if (verification.sessionNotConfigured) {
renderSessionNotConfigured()
return
}

const session = verification.session

if (!session) {
const error = new Error(
"The API did not return a verified authenticated admin session."
)
error.code = "admin_session_cookie_not_verified"
throw error
}

if (els.keyInput) {
els.keyInput.value = ""
els.keyInput.type = "password"
}

if (els.keyToggleButton) {
els.keyToggleButton.textContent = "Show"
els.keyToggleButton.setAttribute(
"aria-label",
"Show admin access key"
)
}

storeActorId(actorId)
renderExistingSession(session)

const requestedPage = getRequestedAdminPage()

if (requestedPage && !canOpenAdminPage(session, requestedPage)) {
setBanner(
"Authentication succeeded, but this credential cannot open the requested admin surface. Redirecting to the permitted control page.",
"warn"
)
} else {
setBanner("Secure admin session established. Redirecting…", "good")
}

redirectToAdmin(session)
} catch (error) {
renderUnauthenticated()
setStatusChip("Access Denied", "bad")
setBanner(getLoginErrorMessage(error), "bad")

if (els.keyInput) {
els.keyInput.value = ""
els.keyInput.focus()
}
} finally {
setLoading(false)
}
}

function toggleKeyVisibility() {
if (!els.keyInput || !els.keyToggleButton) return

const isVisible = els.keyInput.type === "text"

els.keyInput.type = isVisible ? "password" : "text"
els.keyToggleButton.textContent = isVisible ? "Show" : "Hide"
els.keyToggleButton.setAttribute(
"aria-label",
isVisible ? "Show admin access key" : "Hide admin access key"
)

els.keyInput.focus()
}

function bindActions() {
els.form?.addEventListener("submit", submitLogin)

els.keyToggleButton?.addEventListener("click", () => {
toggleKeyVisibility()
})

els.continueSessionButton?.addEventListener("click", () => {
if (!state.session) return

redirectToAdmin(state.session, { immediate: true })
})
}

function initDefaults() {
const storedActorId = getStoredActorId()

if (els.actorInput && storedActorId) {
els.actorInput.value = storedActorId
}

state.gateEnabled = true
state.sessionConfigured = true
state.session = null
state.statusPayload = null

setStatusChip("Authentication Required")
clearBanner()
hideExistingSession()
setLoading(false)
}

async function init() {
initDefaults()
bindActions()

const session = await loadExistingSession()

if (!session && state.gateEnabled && state.sessionConfigured) {
els.keyInput?.focus()
}
}

init().catch((error) => {
console.error("Failed to initialize admin login page", error)

state.gateEnabled = true
state.sessionConfigured = true
renderUnauthenticated()
setLoading(false)

setBanner(
error?.message || "Failed to initialize secure admin login.",
"bad"
)
})
