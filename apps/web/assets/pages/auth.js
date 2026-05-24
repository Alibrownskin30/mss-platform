const EMPTY_SESSION = {
authenticated: false,
user: null,
wallets: [],
entitlements: [],
activeEntitlement: null,
hasSentinelAccess: false,
raw: null,
}

const state = {
session: { ...EMPTY_SESSION },
authLoadingCount: 0,
walletLoadingCount: 0,
codeLoadingCount: 0,
}

function byId(...ids) {
for (const id of ids) {
const el = document.getElementById(id)

if (el) {
return el
}
}

return null
}

const els = {
banner: byId("authBanner", "pageBanner", "banner"),

signedInAccountStrip: byId("signedInAccountStrip"),
signedInAccountValue: byId("signedInAccountValue"),
accountDetailsPanel: byId("accountDetailsPanel"),

guestPanel: byId("guestPanel"),
redeemPanel: byId("redeemPanel"),
walletPanel: byId("walletPanel"),
readyPanel: byId("readyPanel"),
readyWalletPill: byId("readyWalletPill"),

heroAccountStateValue: byId("heroAccountStateValue"),
heroWalletStateValue: byId("heroWalletStateValue"),
heroAccessStateValue: byId("heroAccessStateValue"),
heroNextStepValue: byId("heroNextStepValue"),

showSignInButton: byId("showSignInButton"),
showRegisterButton: byId("showRegisterButton"),

signInForm: byId("signInForm", "loginForm", "authLoginForm"),
signInEmailInput: byId("signInEmailInput", "loginEmailInput"),
signInPasswordInput: byId("signInPasswordInput", "loginPasswordInput"),

registerForm: byId("registerForm", "authRegisterForm"),
registerDisplayNameInput: byId("registerDisplayNameInput", "registerNameInput"),
registerEmailInput: byId("registerEmailInput"),
registerPasswordInput: byId("registerPasswordInput"),
registerConfirmPasswordInput: byId("registerConfirmPasswordInput"),

redeemAccessCodeForm: byId("redeemAccessCodeForm", "accessCodeForm"),
accessCodeInput: byId("accessCodeInput", "redeemAccessCodeInput"),

sessionAccountValue: byId("sessionAccountValue"),
sessionWalletValue: byId("sessionWalletValue"),
sessionAccessValue: byId("sessionAccessValue"),
sessionExpiryValue: byId("sessionExpiryValue"),
sessionIdentityValue: byId("sessionIdentityValue"),
linkedWalletAddressValue: byId("linkedWalletAddressValue"),
sessionPlanValue: byId("sessionPlanValue"),

walletStatusValue: byId("walletStatusValue"),
walletUpdatedAtValue: byId("walletUpdatedAtValue"),

linkedWalletsList: byId("linkedWalletsList"),
entitlementsList: byId("entitlementsList"),

refreshSessionButton: byId("refreshSessionButton"),
signOutButton: byId("signOutButton", "logoutButton"),
continueToSentinelButton: byId("continueToSentinelButton"),

connectWalletButton: byId("connectWalletButton", "linkWalletButton"),
replaceWalletButton: byId("replaceWalletButton"),
disconnectWalletButton: byId("disconnectWalletButton"),

authStatusChip: byId("authStatusChip"),
accessStatusChip: byId("accessStatusChip"),
walletStatusChip: byId("walletStatusChip"),
}

function getSubmitButton(form, explicitId) {
return byId(explicitId) || form?.querySelector('button[type="submit"]') || null
}

els.signInSubmitButton = getSubmitButton(els.signInForm, "signInSubmitButton")
els.registerSubmitButton = getSubmitButton(els.registerForm, "registerSubmitButton")
els.redeemAccessCodeButton = getSubmitButton(
els.redeemAccessCodeForm,
"redeemAccessCodeButton"
)

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max)
}

function arrayify(value) {
return Array.isArray(value) ? value : []
}

function formatDateTime(value) {
const date = new Date(value)

if (!value || Number.isNaN(date.getTime())) {
return "—"
}

return date.toLocaleString()
}

function setText(el, value) {
if (!el) return

el.textContent = value == null || value === "" ? "—" : String(value)
}

function setValue(el, value) {
if (!el) return

el.value = value == null ? "" : String(value)
}

function setDisabled(el, disabled) {
if (!el) return

el.disabled = Boolean(disabled)
}

function setVisible(el, visible) {
if (!el) return

el.hidden = !Boolean(visible)
}

function shortWallet(address) {
const value = cleanText(address, 200)

if (!value) return "—"
if (value.length <= 14) return value

return `${value.slice(0, 6)}…${value.slice(-6)}`
}

function titleCase(value) {
return cleanText(value, 160)
.replace(/[_-]+/g, " ")
.split(" ")
.filter(Boolean)
.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
.join(" ")
}

function resetSession() {
state.session = {
authenticated: false,
user: null,
wallets: [],
entitlements: [],
activeEntitlement: null,
hasSentinelAccess: false,
raw: null,
}
}

function getApiBase() {
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

const API_BASE = getApiBase()

async function rawApiFetch(path, options = {}) {
const response = await fetch(`${API_BASE}${path}`, {
credentials: "include",
...options,
headers: {
"Content-Type": "application/json",
...(options.headers || {}),
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

throw error
}

return payload
}

async function apiFetchFirst(paths, options = {}, { allowStatuses = [] } = {}) {
let lastError = null

for (let index = 0; index < paths.length; index += 1) {
const path = paths[index]

try {
return await rawApiFetch(path, options)
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

throw lastError || new Error("Request failed.")
}

function beginAuthLoading() {
state.authLoadingCount += 1
updateControlState()
}

function endAuthLoading() {
state.authLoadingCount = Math.max(0, state.authLoadingCount - 1)
updateControlState()
}

function beginWalletLoading() {
state.walletLoadingCount += 1
updateControlState()
}

function endWalletLoading() {
state.walletLoadingCount = Math.max(0, state.walletLoadingCount - 1)
updateControlState()
}

function beginCodeLoading() {
state.codeLoadingCount += 1
updateControlState()
}

function endCodeLoading() {
state.codeLoadingCount = Math.max(0, state.codeLoadingCount - 1)
updateControlState()
}

function isBusy() {
return (
state.authLoadingCount > 0 ||
state.walletLoadingCount > 0 ||
state.codeLoadingCount > 0
)
}

function setBanner(message = "", variant = "warn") {
if (!els.banner) return

els.banner.textContent = message || ""
els.banner.className = "banner"

if (message) {
els.banner.classList.add("show")
els.banner.classList.add(variant)
}
}

function clearBanner() {
if (!els.banner) return

els.banner.className = "banner"
els.banner.textContent = ""
}

function normalizeWallet(wallet) {
if (!wallet || typeof wallet !== "object") {
return null
}

const walletAddress =
cleanText(
wallet.wallet_address ||
wallet.address ||
wallet.public_key ||
wallet.publicKey ||
wallet.wallet ||
"",
200
) || null

if (!walletAddress) {
return null
}

return {
id: wallet.id ?? null,
wallet_address: walletAddress,
wallet_label:
cleanText(wallet.wallet_label || wallet.label || wallet.provider || "Wallet", 120) ||
"Wallet",
chain: cleanText(wallet.chain || "solana", 40) || "solana",
is_primary: Boolean(wallet.is_primary || wallet.primary),
is_active: Boolean(wallet.is_active ?? wallet.active ?? true),
linked_at: wallet.linked_at || wallet.created_at || wallet.updated_at || null,
disconnected_at: wallet.disconnected_at || null,
}
}

function normalizeEntitlement(item) {
if (!item || typeof item !== "object") {
return null
}

const startsAt =
item.starts_at ||
item.active_from ||
item.activated_at ||
null

const endsAt =
item.ends_at ||
item.expires_at ||
item.expires_on ||
null

const status =
cleanText(item.status || "", 64).toLowerCase() ||
"inactive"

const now = Date.now()
const startsTs = startsAt ? new Date(startsAt).getTime() : null
const endsTs = endsAt ? new Date(endsAt).getTime() : null

const startsOkay =
startsTs == null ||
(!Number.isNaN(startsTs) && startsTs <= now)

const endsOkay =
endsTs == null ||
(!Number.isNaN(endsTs) && endsTs > now)

const isActive =
Boolean(item.is_active) ||
Boolean(item.active) ||
(status === "active" && startsOkay && endsOkay)

return {
id: item.id ?? null,
product:
cleanText(item.access_tier || item.product || item.feature_key || "", 120) ||
"sentinel_access",
plan:
cleanText(item.plan_key || item.plan || item.tier || "", 120) ||
"sentinel_trial",
status,
starts_at: startsAt,
ends_at: endsAt,
source_type: cleanText(item.source_type || "", 64) || null,
source_code_id: item.source_code_id ?? null,
revoke_reason: cleanText(item.revoke_reason || "", 500) || null,
trial_flag: Boolean(item.trial_flag),
is_active: isActive,
}
}

function deriveSession(payload) {
const user = payload?.user || payload?.account || null

const wallets = [
...arrayify(payload?.wallets),
payload?.active_wallet || payload?.wallet || null,
]
.map(normalizeWallet)
.filter(Boolean)

const dedupedWallets = []
const walletSeen = new Set()

wallets.forEach((wallet) => {
const key = wallet.wallet_address

if (walletSeen.has(key)) {
return
}

walletSeen.add(key)
dedupedWallets.push(wallet)
})

const entitlementCandidates = [
...arrayify(payload?.entitlements),
payload?.entitlement || null,
payload?.active_entitlement || null,
payload?.access?.entitlement || null,
]
.map(normalizeEntitlement)
.filter(Boolean)

const entitlementSeen = new Set()
const entitlements = []

entitlementCandidates.forEach((entitlement) => {
const key =
entitlement.id != null
? `id:${entitlement.id}`
: `${entitlement.product}:${entitlement.plan}:${entitlement.ends_at || "none"}`

if (entitlementSeen.has(key)) {
return
}

entitlementSeen.add(key)
entitlements.push(entitlement)
})

const activeEntitlement =
entitlements.find((item) => item.is_active) ||
normalizeEntitlement(
payload?.active_entitlement ||
payload?.entitlement ||
payload?.access?.entitlement ||
null
)

const authenticated =
Boolean(payload?.authenticated) ||
Boolean(payload?.ok && user) ||
Boolean(user?.id) ||
Boolean(user?.email)

const hasSentinelAccess =
Boolean(payload?.has_sentinel_access) ||
Boolean(payload?.hasSentinelAccess) ||
Boolean(payload?.access?.has_sentinel_access) ||
Boolean(activeEntitlement?.is_active)

return {
authenticated,
user: user
? {
id: user.id ?? null,
display_name:
cleanText(
user.display_name ||
user.displayName ||
user.name ||
"",
120
) || null,
email: cleanText(user.email || "", 200) || null,
status:
cleanText(user.status || "active", 64).toLowerCase() ||
"active",
role:
cleanText(user.role || "user", 64).toLowerCase() ||
"user",
created_at: user.created_at || user.createdAt || null,
updated_at: user.updated_at || user.updatedAt || null,
}
: null,
wallets: dedupedWallets,
entitlements,
activeEntitlement: activeEntitlement || null,
hasSentinelAccess,
raw: payload || null,
}
}

function getActiveWallet(session = state.session) {
const wallets = arrayify(session?.wallets)

return (
wallets.find((wallet) => wallet.is_active && wallet.is_primary) ||
wallets.find((wallet) => wallet.is_active) ||
wallets.find((wallet) => wallet.is_primary) ||
wallets[0] ||
null
)
}

function getSessionIdentity(session = state.session) {
if (!session?.authenticated) {
return "None"
}

return (
cleanText(session?.user?.display_name || "", 120) ||
cleanText(session?.user?.email || "", 200) ||
(session?.user?.id != null ? `Account #${session.user.id}` : "Signed in account")
)
}

function getGatewayStage(session = state.session) {
const authenticated = Boolean(session?.authenticated)
const hasAccess = Boolean(session?.hasSentinelAccess)
const activeWallet = getActiveWallet(session)

if (!authenticated) {
return {
key: "guest",
label: "Sign in or create account",
}
}

if (!hasAccess) {
return {
key: "redeem",
label: "Redeem access code",
}
}

if (!activeWallet) {
return {
key: "wallet",
label: "Connect wallet",
}
}

return {
key: "ready",
label: "Enter Sentinel Watcher",
}
}

function canContinueToSentinel() {
const stage = getGatewayStage()

return stage.key === "ready"
}

function updateGatewayVisibility() {
const session = state.session
const authenticated = Boolean(session?.authenticated)
const activeWallet = getActiveWallet(session)
const stage = getGatewayStage(session)

setVisible(els.guestPanel, stage.key === "guest")
setVisible(els.redeemPanel, stage.key === "redeem")
setVisible(els.walletPanel, stage.key === "wallet")
setVisible(els.readyPanel, stage.key === "ready")

setVisible(els.signedInAccountStrip, authenticated)
setVisible(els.accountDetailsPanel, authenticated)

if (!authenticated && els.accountDetailsPanel) {
els.accountDetailsPanel.open = false
}

setText(els.heroNextStepValue, stage.label)
setText(els.signedInAccountValue, getSessionIdentity(session))

if (els.readyWalletPill) {
els.readyWalletPill.textContent = activeWallet
? `Wallet · ${shortWallet(activeWallet.wallet_address)}`
: "Wallet Linked"
}
}

function updateControlState() {
const busy = isBusy()
const authenticated = Boolean(state.session?.authenticated)
const activeWallet = getActiveWallet(state.session)
const hasAccess = Boolean(state.session?.hasSentinelAccess)
const stage = getGatewayStage()

setDisabled(els.showSignInButton, busy || authenticated)
setDisabled(els.showRegisterButton, busy || authenticated)

setDisabled(els.signInSubmitButton, busy || authenticated)
setDisabled(els.registerSubmitButton, busy || authenticated)

setDisabled(els.signInEmailInput, busy || authenticated)
setDisabled(els.signInPasswordInput, busy || authenticated)

setDisabled(els.registerDisplayNameInput, busy || authenticated)
setDisabled(els.registerEmailInput, busy || authenticated)
setDisabled(els.registerPasswordInput, busy || authenticated)
setDisabled(els.registerConfirmPasswordInput, busy || authenticated)

setDisabled(
els.redeemAccessCodeButton,
busy || !authenticated || hasAccess || stage.key !== "redeem"
)

setDisabled(
els.accessCodeInput,
busy || !authenticated || hasAccess || stage.key !== "redeem"
)

setDisabled(
els.connectWalletButton,
busy || !authenticated || !hasAccess || Boolean(activeWallet)
)

setDisabled(els.replaceWalletButton, busy || !authenticated)
setDisabled(
els.disconnectWalletButton,
busy || !authenticated || !activeWallet
)

setDisabled(els.refreshSessionButton, busy || !authenticated)
setDisabled(els.signOutButton, busy || !authenticated)
setDisabled(els.continueToSentinelButton, busy || !canContinueToSentinel())

if (els.authStatusChip) {
els.authStatusChip.textContent = busy
? "Loading"
: authenticated
? "Signed In"
: "Guest"
}

if (els.accessStatusChip) {
els.accessStatusChip.textContent = hasAccess ? "Active" : "Inactive"
}

if (els.walletStatusChip) {
els.walletStatusChip.textContent = activeWallet
? shortWallet(activeWallet.wallet_address)
: "No Wallet"
}
}

function renderWallets(session) {
if (!els.linkedWalletsList) return

const wallets = arrayify(session?.wallets)

els.linkedWalletsList.innerHTML = ""

if (!wallets.length) {
const empty = document.createElement("div")

empty.className = "list-empty"
empty.textContent = "No linked wallets yet."

els.linkedWalletsList.appendChild(empty)

return
}

wallets.forEach((wallet) => {
const row = document.createElement("div")
row.className = "list-item"

const head = document.createElement("div")
head.className = "list-item-head"

const title = document.createElement("div")
title.className = "summary-value mono"
title.textContent = shortWallet(wallet.wallet_address)

const pill = document.createElement("span")
pill.className = `pill ${wallet.is_active ? "good" : "neutral"}`
pill.textContent = wallet.is_active
? wallet.is_primary
? "Active / Primary"
: "Active"
: "Inactive"

head.appendChild(title)
head.appendChild(pill)

const copy = document.createElement("div")
copy.className = "summary-copy"
copy.textContent = `${wallet.wallet_label} • ${titleCase(wallet.chain || "solana")}`

const meta = document.createElement("div")
meta.className = "summary-copy"
meta.textContent = wallet.disconnected_at
? `Disconnected ${formatDateTime(wallet.disconnected_at)}`
: `Linked ${formatDateTime(wallet.linked_at)}`

row.appendChild(head)
row.appendChild(copy)
row.appendChild(meta)

els.linkedWalletsList.appendChild(row)
})
}

function renderEntitlements(session) {
if (!els.entitlementsList) return

const entitlements = arrayify(session?.entitlements)

els.entitlementsList.innerHTML = ""

if (!entitlements.length) {
const empty = document.createElement("div")

empty.className = "list-empty"
empty.textContent = "No entitlements on this account yet."

els.entitlementsList.appendChild(empty)

return
}

entitlements.forEach((entitlement) => {
const row = document.createElement("div")
row.className = "list-item"

const head = document.createElement("div")
head.className = "list-item-head"

const title = document.createElement("div")
title.className = "summary-value"
title.textContent = `${titleCase(entitlement.product)} • ${titleCase(entitlement.plan)}`

const pill = document.createElement("span")
pill.className = `pill ${entitlement.is_active ? "good" : "neutral"}`
pill.textContent = entitlement.is_active
? "Active"
: titleCase(entitlement.status || "inactive")

head.appendChild(title)
head.appendChild(pill)

const copy = document.createElement("div")
copy.className = "summary-copy"
copy.textContent = entitlement.ends_at
? `Expires ${formatDateTime(entitlement.ends_at)}`
: "No expiry set"

row.appendChild(head)
row.appendChild(copy)

if (entitlement.revoke_reason) {
const revoke = document.createElement("div")

revoke.className = "summary-copy"
revoke.textContent = `Reason: ${entitlement.revoke_reason}`

row.appendChild(revoke)
}

els.entitlementsList.appendChild(row)
})
}

function renderSession() {
const session = state.session
const authenticated = Boolean(session?.authenticated)
const activeWallet = getActiveWallet(session)
const activeEntitlement = session?.activeEntitlement
const hasAccess = Boolean(session?.hasSentinelAccess)
const identityText = getSessionIdentity(session)

const heroAccount = authenticated ? identityText : "Not signed in"
const heroWallet = activeWallet
? shortWallet(activeWallet.wallet_address)
: "Not connected"

const heroAccess = hasAccess
? titleCase(activeEntitlement?.product || "sentinel access")
: "No entitlement"

setText(els.heroAccountStateValue, heroAccount)
setText(els.heroWalletStateValue, heroWallet)
setText(els.heroAccessStateValue, heroAccess)

setText(els.sessionAccountValue, authenticated ? "Signed in" : "Guest")
setText(els.sessionWalletValue, activeWallet ? "Linked" : "Not connected")
setText(els.sessionAccessValue, hasAccess ? "Active" : "No entitlement")
setText(els.sessionExpiryValue, formatDateTime(activeEntitlement?.ends_at))
setText(els.sessionIdentityValue, identityText)
setText(els.linkedWalletAddressValue, activeWallet?.wallet_address || "—")

setText(
els.sessionPlanValue,
hasAccess
? `${titleCase(activeEntitlement?.product || "sentinel access")} • ${titleCase(
activeEntitlement?.plan || "plan"
)}`
: "—"
)

setText(els.walletStatusValue, activeWallet ? "Connected" : "Not connected")
setText(els.walletUpdatedAtValue, formatDateTime(activeWallet?.linked_at))

renderWallets(session)
renderEntitlements(session)
updateGatewayVisibility()
updateControlState()
}

async function loadSession({ quiet = false } = {}) {
beginAuthLoading()

try {
const result = await apiFetchFirst(
["/api/auth/me"],
{},
{
allowStatuses: [401, 404],
}
)

if (
result?.ok === false &&
(result.allowed_status === 401 || result.allowed_status === 404)
) {
resetSession()
renderSession()

if (!quiet) {
clearBanner()
}

return state.session
}

state.session = deriveSession(result)
renderSession()

if (!quiet) {
clearBanner()
}

return state.session
} catch (error) {
if (!quiet) {
setBanner(error?.message || "Failed to load account session.", "bad")
}

throw error
} finally {
endAuthLoading()
}
}

function activateAuthTab(mode = "signin") {
const isSignIn = mode === "signin"

if (els.showSignInButton) {
els.showSignInButton.classList.toggle("active", isSignIn)
els.showSignInButton.setAttribute(
"aria-selected",
isSignIn ? "true" : "false"
)
}

if (els.showRegisterButton) {
els.showRegisterButton.classList.toggle("active", !isSignIn)
els.showRegisterButton.setAttribute(
"aria-selected",
!isSignIn ? "true" : "false"
)
}

if (els.signInForm) {
els.signInForm.classList.toggle("active", isSignIn)
}

if (els.registerForm) {
els.registerForm.classList.toggle("active", !isSignIn)
}
}

function getWalletProvider() {
const seen = new Set()
const providers = []

const pushProvider = (provider) => {
if (!provider || typeof provider !== "object") return
if (seen.has(provider)) return

seen.add(provider)
providers.push(provider)
}

if (Array.isArray(window.solana?.providers)) {
window.solana.providers.forEach(pushProvider)
}

pushProvider(window.phantom?.solana)
pushProvider(window.solflare)
pushProvider(window.solana)

return (
providers.find(
(provider) =>
provider?.isPhantom &&
typeof provider.signMessage === "function"
) ||
providers.find(
(provider) =>
provider?.isSolflare &&
typeof provider.signMessage === "function"
) ||
providers.find(
(provider) => typeof provider?.signMessage === "function"
) ||
null
)
}

function getWalletProviderLabel(provider) {
if (!provider) return "Wallet"
if (provider.isPhantom) return "Phantom"
if (provider.isSolflare) return "Solflare"

return (
cleanText(provider.name || provider.walletName || "Wallet", 80) ||
"Wallet"
)
}

function getWalletAddressFromConnectResult(result, provider) {
return (
result?.publicKey?.toBase58?.() ||
provider?.publicKey?.toBase58?.() ||
cleanText(result?.publicKey || provider?.publicKey || "", 200) ||
null
)
}

async function signWalletMessage(provider, messageBytes) {
if (typeof provider?.signMessage !== "function") {
throw new Error("Connected wallet does not support message signing.")
}

try {
return await provider.signMessage(messageBytes, "utf8")
} catch {
return provider.signMessage(messageBytes)
}
}

function extractSignatureBytes(signatureResult) {
if (!signatureResult) return null

if (signatureResult instanceof Uint8Array) {
return signatureResult
}

if (signatureResult.signature instanceof Uint8Array) {
return signatureResult.signature
}

if (signatureResult instanceof ArrayBuffer) {
return new Uint8Array(signatureResult)
}

if (signatureResult.signature instanceof ArrayBuffer) {
return new Uint8Array(signatureResult.signature)
}

return null
}

const BASE58_ALPHABET =
"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

function encodeBase58(bytesLike) {
const bytes =
bytesLike instanceof Uint8Array
? bytesLike
: new Uint8Array(bytesLike || [])

if (!bytes.length) {
return ""
}

let zeros = 0

while (zeros < bytes.length && bytes[zeros] === 0) {
zeros += 1
}

let value = 0n

for (const byte of bytes) {
value = (value << 8n) + BigInt(byte)
}

let encoded = ""

while (value > 0n) {
const mod = Number(value % 58n)

encoded = BASE58_ALPHABET[mod] + encoded
value /= 58n
}

return "1".repeat(zeros) + encoded
}

async function connectOrReplaceWallet(mode = "connect") {
if (!state.session?.authenticated) {
setBanner(
"Sign in first, then connect a wallet to your MSS Protocol account.",
"warn"
)

return
}

if (!state.session?.hasSentinelAccess && mode === "connect") {
setBanner(
"Activate Sentinel access before connecting your wallet.",
"warn"
)

return
}

const provider = getWalletProvider()

if (!provider) {
setBanner(
"No Solana wallet detected. Install Phantom or Solflare first.",
"warn"
)

return
}

beginWalletLoading()

try {
const connectionResult = await provider.connect()
const walletAddress = getWalletAddressFromConnectResult(
connectionResult,
provider
)

if (!walletAddress) {
throw new Error("Unable to detect connected wallet address.")
}

const challengePayload = await apiFetchFirst(
["/api/auth/wallet/challenge"],
{
method: "POST",
body: JSON.stringify({
wallet_address: walletAddress,
}),
}
)

const message = cleanText(challengePayload?.message || "", 5000)
const challengeToken = cleanText(
challengePayload?.challenge_token || "",
12000
)

if (!message || !challengeToken) {
throw new Error("Wallet challenge response was incomplete.")
}

const encodedMessage = new TextEncoder().encode(message)
const signatureResult = await signWalletMessage(provider, encodedMessage)
const signatureBytes = extractSignatureBytes(signatureResult)

if (!signatureBytes) {
throw new Error("Wallet signature could not be captured.")
}

const signatureBase58 = encodeBase58(signatureBytes)

if (!signatureBase58) {
throw new Error("Wallet signature encoding failed.")
}

const linkPayload = await apiFetchFirst(
["/api/auth/wallet/link"],
{
method: "POST",
body: JSON.stringify({
wallet_address: walletAddress,
challenge_token: challengeToken,
message,
signature: signatureBase58,
wallet_label: getWalletProviderLabel(provider),
}),
}
)

if (linkPayload?.ok === false) {
throw new Error(linkPayload?.error || "Wallet linking failed.")
}

await loadSession({ quiet: true })

setBanner(
mode === "replace"
? "Wallet replaced successfully."
: "Wallet linked. Sentinel Watcher is ready.",
"good"
)
} catch (error) {
setBanner(error?.message || "Failed to link wallet.", "bad")
} finally {
endWalletLoading()
}
}

async function disconnectActiveWallet() {
if (!state.session?.authenticated) {
setBanner("Sign in first.", "warn")
return
}

const activeWallet = getActiveWallet(state.session)

if (!activeWallet) {
setBanner("No active wallet is linked to this account.", "warn")
return
}

const confirmed = window.confirm(
`Disconnect wallet ${shortWallet(activeWallet.wallet_address)} from this MSS Protocol account?`
)

if (!confirmed) {
return
}

beginWalletLoading()

try {
const payload = await apiFetchFirst(
["/api/auth/wallet/disconnect"],
{
method: "POST",
body: JSON.stringify({
wallet_address: activeWallet.wallet_address,
}),
}
)

if (payload?.ok === false) {
throw new Error(payload?.error || "Wallet disconnect failed.")
}

await loadSession({ quiet: true })

setBanner(
"Wallet disconnected. Connect a wallet to enter Sentinel Watcher.",
"good"
)
} catch (error) {
setBanner(error?.message || "Failed to disconnect wallet.", "bad")
} finally {
endWalletLoading()
}
}

function getProgressMessage() {
const stage = getGatewayStage()

if (stage.key === "redeem") {
return "Signed in. Enter your Sentinel access code to continue."
}

if (stage.key === "wallet") {
return "Access is active. Connect your Solana wallet to continue."
}

if (stage.key === "ready") {
return "Access verified. Sentinel Watcher is ready."
}

return "Sign in to continue."
}

async function handleRegister(event) {
event?.preventDefault?.()

const displayName = cleanText(
els.registerDisplayNameInput?.value,
120
)

const email = cleanText(
els.registerEmailInput?.value,
200
).toLowerCase()

const password = String(els.registerPasswordInput?.value ?? "")
const confirmPassword = String(
els.registerConfirmPasswordInput?.value ??
""
)

if (!email || !password) {
setBanner(
"Enter your email and password to create an MSS Protocol account.",
"warn"
)

return
}

if (password.length < 8) {
setBanner("Password must be at least 8 characters.", "warn")
return
}

if (password !== confirmPassword) {
setBanner("Passwords do not match.", "warn")
return
}

beginAuthLoading()

try {
const payload = await apiFetchFirst(
["/api/auth/register"],
{
method: "POST",
body: JSON.stringify({
email,
password,
display_name: displayName || null,
}),
}
)

if (payload?.ok === false) {
throw new Error(payload?.error || "Registration failed.")
}

setValue(els.registerPasswordInput, "")
setValue(els.registerConfirmPasswordInput, "")

await loadSession({ quiet: true })

setBanner(
"Account created. Enter your Sentinel access code to continue.",
"good"
)
} catch (error) {
setBanner(error?.message || "Failed to create account.", "bad")
} finally {
endAuthLoading()
}
}

async function handleSignIn(event) {
event?.preventDefault?.()

const email = cleanText(
els.signInEmailInput?.value,
200
).toLowerCase()

const password = String(els.signInPasswordInput?.value ?? "")

if (!email || !password) {
setBanner("Enter your email and password to sign in.", "warn")
return
}

beginAuthLoading()

try {
const payload = await apiFetchFirst(
["/api/auth/login"],
{
method: "POST",
body: JSON.stringify({
email,
password,
}),
}
)

if (payload?.ok === false) {
throw new Error(payload?.error || "Sign in failed.")
}

setValue(els.signInPasswordInput, "")

await loadSession({ quiet: true })

setBanner(getProgressMessage(), "good")
} catch (error) {
setBanner(error?.message || "Failed to sign in.", "bad")
} finally {
endAuthLoading()
}
}

async function handleSignOut() {
beginAuthLoading()

try {
await apiFetchFirst(
["/api/auth/logout"],
{
method: "POST",
body: JSON.stringify({}),
},
{
allowStatuses: [404],
}
)

resetSession()
renderSession()
activateAuthTab("signin")

setBanner("Signed out.", "good")
} catch (error) {
setBanner(error?.message || "Failed to sign out.", "bad")
} finally {
endAuthLoading()
}
}

function normalizeAccessCodeForSubmit(value) {
return cleanText(value, 128)
.replace(/\s+/g, "")
.toUpperCase()
}

async function handleRedeemAccessCode(event) {
event?.preventDefault?.()

if (!state.session?.authenticated) {
setBanner(
"Create an account or sign in before redeeming an access code.",
"warn"
)

return
}

const code = normalizeAccessCodeForSubmit(
els.accessCodeInput?.value
)

if (!code) {
setBanner("Enter a valid Sentinel access code.", "warn")
return
}

beginCodeLoading()

try {
const payload = await apiFetchFirst(
["/api/auth/access/redeem"],
{
method: "POST",
body: JSON.stringify({ code }),
}
)

if (payload?.ok === false) {
throw new Error(
payload?.error ||
"Access code redemption failed."
)
}

setValue(els.accessCodeInput, "")

await loadSession({ quiet: true })

const activeWallet = getActiveWallet(state.session)

setBanner(
activeWallet
? "Access activated. Sentinel Watcher is ready."
: "Access activated. Connect your Solana wallet to continue.",
"good"
)
} catch (error) {
setBanner(
error?.message ||
"Failed to redeem access code.",
"bad"
)
} finally {
endCodeLoading()
}
}

function continueToSentinel() {
if (!state.session?.authenticated) {
setBanner("Sign in first.", "warn")
return
}

if (!state.session?.hasSentinelAccess) {
setBanner(
"Redeem an active Sentinel access code before continuing.",
"warn"
)

return
}

if (!getActiveWallet(state.session)) {
setBanner(
"Connect a wallet before entering Sentinel Watcher.",
"warn"
)

return
}

const target =
cleanText(
state.session?.raw?.continue_url ||
state.session?.raw?.access?.continue_url ||
"",
1000
) || "/sentinel.html"

window.location.href = target
}

function bindEvents() {
els.showSignInButton?.addEventListener("click", () => {
activateAuthTab("signin")
})

els.showRegisterButton?.addEventListener("click", () => {
activateAuthTab("register")
})

els.signInForm?.addEventListener("submit", handleSignIn)
els.registerForm?.addEventListener("submit", handleRegister)
els.redeemAccessCodeForm?.addEventListener(
"submit",
handleRedeemAccessCode
)

els.refreshSessionButton?.addEventListener("click", async () => {
try {
await loadSession()
setBanner("Account status refreshed.", "good")
} catch {}
})

els.signOutButton?.addEventListener("click", async () => {
await handleSignOut()
})

els.connectWalletButton?.addEventListener("click", async () => {
await connectOrReplaceWallet("connect")
})

els.replaceWalletButton?.addEventListener("click", async () => {
await connectOrReplaceWallet("replace")
})

els.disconnectWalletButton?.addEventListener("click", async () => {
await disconnectActiveWallet()
})

els.continueToSentinelButton?.addEventListener("click", () => {
continueToSentinel()
})
}

async function init() {
activateAuthTab("signin")
bindEvents()
resetSession()
renderSession()

try {
await loadSession({ quiet: true })
} catch {
resetSession()
renderSession()
setBanner(
"Unable to confirm account session. Sign in to continue.",
"warn"
)
}
}

init().catch((error) => {
console.error("Failed to initialize Sentinel access gateway", error)

setBanner(
error?.message ||
"Failed to initialize Sentinel access gateway.",
"bad"
)
})
