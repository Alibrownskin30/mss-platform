import express from "express"
import db from "../db/index.js"
import crypto from "node:crypto"
import { promisify } from "node:util"
import bs58 from "bs58"
import nacl from "tweetnacl"
import { PublicKey } from "@solana/web3.js"

const router = express.Router()

const scryptAsync = promisify(crypto.scrypt)

const AUTH_COOKIE_NAME = "mss_auth"
const AUTH_SESSION_TTL_SEC = 60 * 60 * 24 * 14
const WALLET_CHALLENGE_TTL_SEC = 60 * 10

const AUTH_SECRET =
cleanText(
process.env.MSS_AUTH_SECRET ||
process.env.AUTH_SECRET ||
process.env.SESSION_SECRET,
5000
) || "mss-dev-auth-secret-change-me"

const AUTH_COOKIE_DOMAIN = cleanText(
process.env.MSS_AUTH_COOKIE_DOMAIN || process.env.AUTH_COOKIE_DOMAIN,
253
)

const AUTH_COOKIE_SAMESITE =
cleanText(process.env.MSS_AUTH_COOKIE_SAMESITE || "Lax", 20) || "Lax"

const USER_STATUS_SET = new Set(["active", "disabled", "suspended"])
const USER_ROLE_SET = new Set(["user", "admin", "support"])
const ENTITLEMENT_STATUS_SET = new Set(["active", "expired", "revoked", "scheduled"])

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max)
}

function parseBool(value, fallback = false) {
if (typeof value === "boolean") return value
if (value === 1 || value === "1" || value === "true") return true
if (value === 0 || value === "0" || value === "false") return false
return fallback
}

function nowIso() {
return new Date().toISOString()
}

function addSecondsToIso(baseIso, seconds = 0) {
const ts = new Date(baseIso || Date.now()).getTime()
return new Date(ts + Math.max(0, Number(seconds) || 0) * 1000).toISOString()
}

function addDaysToIso(baseIso, days = 0) {
const ts = new Date(baseIso || Date.now()).getTime()
return new Date(ts + Math.max(0, Number(days) || 0) * 24 * 60 * 60 * 1000).toISOString()
}

function normalizeEmail(email) {
return cleanText(email, 320).toLowerCase()
}

function normalizeDisplayName(value, email = "") {
const cleaned = cleanText(value, 120)
if (cleaned) return cleaned

const safeEmail = normalizeEmail(email)
if (!safeEmail.includes("@")) return ""

return cleanText(safeEmail.split("@")[0], 120)
}

function isValidEmail(email) {
const value = normalizeEmail(email)
return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isValidPassword(password) {
const value = String(password ?? "")
return value.length >= 8 && value.length <= 200
}

function normalizeAccessCodeInput(code) {
return cleanText(code, 128).replace(/\s+/g, "").toUpperCase()
}

function normalizeWalletAddress(value) {
return cleanText(value, 128)
}

function normalizeWalletLabel(value) {
return cleanText(value, 80)
}

function toBase64Url(input) {
return Buffer.from(input)
.toString("base64")
.replace(/\+/g, "-")
.replace(/\//g, "_")
.replace(/=+$/g, "")
}

function fromBase64Url(input) {
const safe = String(input ?? "")
.replace(/-/g, "+")
.replace(/_/g, "/")
const pad = safe.length % 4 === 0 ? "" : "=".repeat(4 - (safe.length % 4))
return Buffer.from(`${safe}${pad}`, "base64")
}

function signValue(value) {
return toBase64Url(
crypto.createHmac("sha256", AUTH_SECRET).update(String(value)).digest()
)
}

function createSignedToken(payload = {}) {
const body = toBase64Url(JSON.stringify(payload))
const signature = signValue(body)
return `${body}.${signature}`
}

function verifySignedToken(token, expectedKind = "") {
const raw = cleanText(token, 10000)
if (!raw || !raw.includes(".")) return null

const parts = raw.split(".")
if (parts.length !== 2) return null

const [body, signature] = parts
if (!body || !signature) return null

const expectedSignature = signValue(body)
const left = Buffer.from(signature)
const right = Buffer.from(expectedSignature)

if (left.length !== right.length) return null
if (!crypto.timingSafeEqual(left, right)) return null

let payload = null
try {
payload = JSON.parse(fromBase64Url(body).toString("utf8"))
} catch {
return null
}

if (!payload || typeof payload !== "object") return null
if (expectedKind && cleanText(payload.kind, 64) !== expectedKind) return null

const exp = Number(payload.exp || 0)
if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return null

return payload
}

function parseCookieHeader(header = "") {
const out = {}

for (const chunk of String(header || "").split(";")) {
const index = chunk.indexOf("=")
if (index === -1) continue

const key = chunk.slice(0, index).trim()
const value = chunk.slice(index + 1).trim()

if (key) out[key] = decodeURIComponent(value)
}

return out
}

function getAuthTokenFromRequest(req) {
const cookies = parseCookieHeader(req?.headers?.cookie || "")
const cookieToken = cleanText(cookies[AUTH_COOKIE_NAME], 12000)
if (cookieToken) return cookieToken

const authHeader = cleanText(req?.headers?.authorization, 12000)
if (authHeader.toLowerCase().startsWith("bearer ")) {
return cleanText(authHeader.slice(7), 12000)
}

return ""
}

function appendSetCookie(res, cookieValue) {
const current = res.getHeader("Set-Cookie")

if (!current) {
res.setHeader("Set-Cookie", [cookieValue])
return
}

if (Array.isArray(current)) {
res.setHeader("Set-Cookie", [...current, cookieValue])
return
}

res.setHeader("Set-Cookie", [current, cookieValue])
}

function buildCookieParts({ token = "", maxAge = 0 } = {}) {
const secure = String(process.env.NODE_ENV || "").toLowerCase() === "production"

return [
`${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
`Max-Age=${maxAge}`,
"Path=/",
"HttpOnly",
`SameSite=${AUTH_COOKIE_SAMESITE}`,
AUTH_COOKIE_DOMAIN ? `Domain=${AUTH_COOKIE_DOMAIN}` : "",
secure ? "Secure" : "",
].filter(Boolean)
}

function setAuthCookie(res, token) {
appendSetCookie(res, buildCookieParts({ token, maxAge: AUTH_SESSION_TTL_SEC }).join("; "))
}

function clearAuthCookie(res) {
appendSetCookie(res, buildCookieParts({ token: "", maxAge: 0 }).join("; "))
}

async function hashPassword(password) {
const salt = crypto.randomBytes(16)
const derived = await scryptAsync(String(password), salt, 64)
return `scrypt$${toBase64Url(salt)}$${toBase64Url(derived)}`
}

async function verifyPassword(password, passwordHash) {
const raw = cleanText(passwordHash, 1000)
const parts = raw.split("$")
if (parts.length !== 3 || parts[0] !== "scrypt") return false

const salt = fromBase64Url(parts[1])
const expected = fromBase64Url(parts[2])
const derived = await scryptAsync(String(password), salt, expected.length)

if (derived.length !== expected.length) return false
return crypto.timingSafeEqual(Buffer.from(derived), Buffer.from(expected))
}

function buildSessionToken(user) {
const loginAt = cleanText(user?.last_login_at, 64) || nowIso()

return createSignedToken({
kind: "mss_session",
user_id: Number(user?.id || 0),
email: normalizeEmail(user?.email),
login_at: loginAt,
iat: Math.floor(Date.now() / 1000),
exp: Math.floor(Date.now() / 1000) + AUTH_SESSION_TTL_SEC,
})
}

function buildWalletChallengeToken({
userId,
walletAddress,
nonce,
issuedAt,
expiresAt,
}) {
return createSignedToken({
kind: "wallet_link_challenge",
user_id: Number(userId || 0),
wallet_address: normalizeWalletAddress(walletAddress),
nonce: cleanText(nonce, 128),
issued_at: cleanText(issuedAt, 64),
expires_at: cleanText(expiresAt, 64),
iat: Math.floor(new Date(issuedAt).getTime() / 1000),
exp: Math.floor(new Date(expiresAt).getTime() / 1000),
})
}

function buildWalletLinkMessage({
email,
walletAddress,
nonce,
issuedAt,
expiresAt,
}) {
return [
"MSS Protocol Sentinel Wallet Link",
"",
`Account: ${normalizeEmail(email)}`,
`Wallet: ${normalizeWalletAddress(walletAddress)}`,
"Purpose: link_wallet",
`Nonce: ${cleanText(nonce, 128)}`,
`Issued At: ${cleanText(issuedAt, 64)}`,
`Expires At: ${cleanText(expiresAt, 64)}`,
].join("\n")
}

function parseWalletLinkMessage(message) {
const raw = String(message ?? "")
const lines = raw.split("\n").map((line) => line.trim())

if (!lines.length || cleanText(lines[0], 200) !== "MSS Protocol Sentinel Wallet Link") {
return null
}

const map = {}

for (const line of lines) {
const index = line.indexOf(":")
if (index === -1) continue

const key = cleanText(line.slice(0, index), 64).toLowerCase()
const value = cleanText(line.slice(index + 1), 1000)

if (key) map[key] = value
}

const account = normalizeEmail(map.account || "")
const walletAddress = normalizeWalletAddress(map.wallet || "")
const purpose = cleanText(map.purpose, 64)
const nonce = cleanText(map.nonce, 128)
const issuedAt = cleanText(map["issued at"], 64)
const expiresAt = cleanText(map["expires at"], 64)

if (!account || !walletAddress || purpose !== "link_wallet" || !nonce || !issuedAt || !expiresAt) {
return null
}

return {
account,
wallet_address: walletAddress,
purpose,
nonce,
issued_at: issuedAt,
expires_at: expiresAt,
}
}

function validateSolanaWalletAddress(walletAddress) {
try {
const key = new PublicKey(walletAddress)
return key.toBase58()
} catch {
return null
}
}

function decodeSignatureBytes(signature, encoding = "") {
const raw = cleanText(signature, 12000)
const normalizedEncoding = cleanText(encoding, 32).toLowerCase()

if (!raw) return null

try {
if (normalizedEncoding === "base64") {
return new Uint8Array(Buffer.from(raw, "base64"))
}

if (normalizedEncoding === "base64url") {
return new Uint8Array(fromBase64Url(raw))
}

if (normalizedEncoding === "hex") {
return new Uint8Array(Buffer.from(raw, "hex"))
}

if (normalizedEncoding === "bs58" || normalizedEncoding === "base58") {
return new Uint8Array(bs58.decode(raw))
}

try {
return new Uint8Array(bs58.decode(raw))
} catch {}

try {
return new Uint8Array(Buffer.from(raw, "base64"))
} catch {}

try {
return new Uint8Array(fromBase64Url(raw))
} catch {}
} catch {
return null
}

return null
}

function verifySolanaDetachedSignature({
walletAddress,
message,
signature,
signatureEncoding = "",
}) {
try {
const publicKey = new PublicKey(walletAddress).toBytes()
const messageBytes = Buffer.from(String(message), "utf8")
const signatureBytes = decodeSignatureBytes(signature, signatureEncoding)

if (!signatureBytes || signatureBytes.length !== nacl.sign.signatureLength) {
return false
}

return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey)
} catch {
return false
}
}

function resolveAccessTierFromCode(codeRow = {}) {
const codeType = cleanText(codeRow.code_type, 64).toLowerCase()
const planKey = cleanText(codeRow.plan_key, 120).toLowerCase()
const planLabel = cleanText(codeRow.plan_label, 120).toLowerCase()

if (codeType === "admin") return "sentinel_internal"

if (
codeType === "partner" ||
codeType === "comp" ||
planKey.includes("early") ||
planLabel.includes("early")
) {
return "sentinel_early"
}

return "sentinel_standard"
}

function isEntitlementActiveNow(row) {
if (!row) return false
if (cleanText(row.status, 32).toLowerCase() !== "active") return false

const now = Date.now()
const startsAt = row.starts_at ? new Date(row.starts_at).getTime() : null
const endsAt = row.ends_at ? new Date(row.ends_at).getTime() : null

if (startsAt && !Number.isNaN(startsAt) && startsAt > now) return false
if (endsAt && !Number.isNaN(endsAt) && endsAt <= now) return false

return true
}

function serializeUser(row) {
if (!row) return null

const status = cleanText(row.status, 32).toLowerCase()
const role = cleanText(row.role, 32).toLowerCase()

return {
id: Number(row.id || 0),
email: normalizeEmail(row.email),
display_name: cleanText(row.display_name, 120) || null,
status: USER_STATUS_SET.has(status) ? status : "active",
role: USER_ROLE_SET.has(role) ? role : "user",
email_verified: Boolean(row.email_verified),
email_verified_at: row.email_verified_at || null,
last_login_at: row.last_login_at || null,
created_at: row.created_at || null,
updated_at: row.updated_at || null,
}
}

function serializeWallet(row) {
if (!row) return null

return {
id: Number(row.id || 0),
wallet_address: cleanText(row.wallet_address, 128) || null,
wallet_label: cleanText(row.wallet_label, 80) || null,
chain: cleanText(row.chain, 32) || "solana",
is_primary: Boolean(row.is_primary),
is_active: Boolean(row.is_active),
linked_at: row.linked_at || null,
disconnected_at: row.disconnected_at || null,
}
}

function serializeEntitlement(row) {
if (!row) return null

const status = cleanText(row.status, 32).toLowerCase()
const normalizedStatus = ENTITLEMENT_STATUS_SET.has(status) ? status : "active"
const startsAt = row.starts_at || null
const endsAt = row.ends_at || null
const planKey = cleanText(row.plan_key, 120) || "sentinel_trial"

return {
id: Number(row.id || 0),
user_id: Number(row.user_id || 0),
source_type: cleanText(row.source_type, 32) || "code",
source_code_id: row.source_code_id == null ? null : Number(row.source_code_id),
plan_key: planKey,
access_tier: cleanText(row.access_tier, 64) || "sentinel_standard",
status: normalizedStatus,
starts_at: startsAt,
ends_at: endsAt,
trial_flag: Boolean(row.trial_flag),
revoke_reason: cleanText(row.revoke_reason, 500) || null,
created_at: row.created_at || null,
updated_at: row.updated_at || null,

product: "sentinel_access",
plan: planKey,
is_active: normalizedStatus === "active" && isEntitlementActiveNow(row),
expires_at: endsAt,
}
}

async function expireStaleEntitlements(userId = null) {
if (userId) {
await db.run(
`
UPDATE sentinel_entitlements
SET
status = 'expired',
updated_at = CURRENT_TIMESTAMP
WHERE user_id = ?
AND status = 'active'
AND ends_at IS NOT NULL
AND datetime(ends_at) <= datetime(CURRENT_TIMESTAMP)
`,
[userId]
)
return
}

await db.run(
`
UPDATE sentinel_entitlements
SET
status = 'expired',
updated_at = CURRENT_TIMESTAMP
WHERE status = 'active'
AND ends_at IS NOT NULL
AND datetime(ends_at) <= datetime(CURRENT_TIMESTAMP)
`
)
}

async function getUserById(userId) {
const id = Number(userId || 0)
if (!id) return null

const row = await db.get(
`
SELECT *
FROM mss_users
WHERE id = ?
LIMIT 1
`,
[id]
)

return serializeUser(row)
}

async function getUserByEmail(email) {
const safeEmail = normalizeEmail(email)
if (!safeEmail) return null

const row = await db.get(
`
SELECT *
FROM mss_users
WHERE email = ?
LIMIT 1
`,
[safeEmail]
)

return serializeUser(row)
}

async function getUserRowByEmail(email) {
const safeEmail = normalizeEmail(email)
if (!safeEmail) return null

return db.get(
`
SELECT *
FROM mss_users
WHERE email = ?
LIMIT 1
`,
[safeEmail]
)
}

async function getActiveWalletForUser(userId) {
const row = await db.get(
`
SELECT *
FROM mss_user_wallets
WHERE user_id = ?
AND is_active = 1
ORDER BY is_primary DESC, datetime(linked_at) DESC, id DESC
LIMIT 1
`,
[userId]
)

return serializeWallet(row)
}

async function listWalletsForUser(userId, limit = 10) {
const safeLimit = Math.max(1, Math.min(Number(limit || 10), 50))

const rows = await db.all(
`
SELECT *
FROM mss_user_wallets
WHERE user_id = ?
ORDER BY is_active DESC, is_primary DESC, datetime(linked_at) DESC, id DESC
LIMIT ?
`,
[userId, safeLimit]
)

return (rows || []).map(serializeWallet).filter(Boolean)
}

async function listEntitlementsForUser(userId, limit = 20) {
await expireStaleEntitlements(userId)

const safeLimit = Math.max(1, Math.min(Number(limit || 20), 100))

const rows = await db.all(
`
SELECT *
FROM sentinel_entitlements
WHERE user_id = ?
ORDER BY
CASE WHEN status = 'active' THEN 0 ELSE 1 END,
datetime(starts_at) DESC,
id DESC
LIMIT ?
`,
[userId, safeLimit]
)

return (rows || []).map(serializeEntitlement).filter(Boolean)
}

async function getActiveEntitlementForUser(userId) {
await expireStaleEntitlements(userId)

const rows = await db.all(
`
SELECT *
FROM sentinel_entitlements
WHERE user_id = ?
AND status = 'active'
ORDER BY datetime(starts_at) DESC, id DESC
LIMIT 10
`,
[userId]
)

const entitlements = (rows || []).map(serializeEntitlement).filter(Boolean)
return entitlements.find((item) => item.is_active) || null
}

async function getSessionUserFromRequest(req) {
const token = getAuthTokenFromRequest(req)
const session = verifySignedToken(token, "mss_session")
if (!session) return null

const user = await getUserById(session.user_id)
if (!user) return null
if (user.status !== "active") return null
if (normalizeEmail(user.email) !== normalizeEmail(session.email)) return null

const tokenLoginAt = cleanText(session.login_at, 64)
const userLoginAt = cleanText(user.last_login_at, 64)
if (!tokenLoginAt || !userLoginAt || tokenLoginAt !== userLoginAt) return null

const activeWallet = await getActiveWalletForUser(user.id)
const activeEntitlement = await getActiveEntitlementForUser(user.id)

return {
user,
active_wallet: activeWallet,
active_entitlement: activeEntitlement,
has_sentinel_access: Boolean(activeEntitlement),
has_linked_wallet: Boolean(activeWallet),
can_continue_to_sentinel: Boolean(activeEntitlement && activeWallet),
}
}

async function requireAuth(req, res, next) {
try {
const auth = await getSessionUserFromRequest(req)

if (!auth?.user) {
clearAuthCookie(res)
return res.status(401).json({
ok: false,
error: "Authentication required",
})
}

req.auth = auth
req.user = auth.user
req.active_wallet = auth.active_wallet
req.active_entitlement = auth.active_entitlement

return next()
} catch (error) {
console.error("Auth middleware failed", error)
return res.status(500).json({
ok: false,
error: "Authentication failed",
message: error?.message || String(error),
})
}
}

async function requireSentinelAccess(req, res, next) {
try {
const auth = await getSessionUserFromRequest(req)

if (!auth?.user) {
clearAuthCookie(res)
return res.status(401).json({
ok: false,
error: "Authentication required",
})
}

if (!auth.has_sentinel_access) {
return res.status(403).json({
ok: false,
error: "Active Sentinel entitlement required",
})
}

if (!auth.active_wallet) {
return res.status(403).json({
ok: false,
error: "Linked Solana wallet required",
})
}

req.auth = auth
req.user = auth.user
req.active_wallet = auth.active_wallet
req.active_entitlement = auth.active_entitlement

return next()
} catch (error) {
console.error("Sentinel access middleware failed", error)
return res.status(500).json({
ok: false,
error: "Sentinel access validation failed",
message: error?.message || String(error),
})
}
}

async function buildAuthResponse(userId) {
const user = await getUserById(userId)
if (!user) return buildUnauthenticatedResponse()

const activeWallet = await getActiveWalletForUser(userId)
const wallets = await listWalletsForUser(userId, 20)
const entitlements = await listEntitlementsForUser(userId, 20)
const activeEntitlement = entitlements.find((item) => item.is_active) || null
const hasSentinelAccess = Boolean(activeEntitlement)
const hasLinkedWallet = Boolean(activeWallet)
const canContinue = Boolean(hasSentinelAccess && hasLinkedWallet)

return {
user,
wallet: activeWallet,
active_wallet: activeWallet,
wallets,
linked_wallets: wallets,

entitlement: activeEntitlement,
active_entitlement: activeEntitlement,
entitlements,

has_sentinel_access: hasSentinelAccess,
has_linked_wallet: hasLinkedWallet,
can_continue_to_sentinel: canContinue,

access: {
has_sentinel_access: hasSentinelAccess,
has_linked_wallet: hasLinkedWallet,
can_continue_to_sentinel: canContinue,
active_entitlement: activeEntitlement,
entitlements,
continue_url: "/sentinel.html",
},
}
}

function buildUnauthenticatedResponse() {
return {
ok: true,
authenticated: false,
user: null,
wallet: null,
active_wallet: null,
wallets: [],
linked_wallets: [],
entitlement: null,
active_entitlement: null,
entitlements: [],
has_sentinel_access: false,
has_linked_wallet: false,
can_continue_to_sentinel: false,
access: {
has_sentinel_access: false,
has_linked_wallet: false,
can_continue_to_sentinel: false,
active_entitlement: null,
entitlements: [],
continue_url: "/sentinel.html",
},
}
}

async function redeemAccessCodeForUser(userId, codeInput) {
const code = normalizeAccessCodeInput(codeInput)

if (!code) {
throw new Error("Access code is required.")
}

await expireStaleEntitlements(userId)

const codeRow = await db.get(
`
SELECT *
FROM sentinel_access_codes
WHERE code = ?
LIMIT 1
`,
[code]
)

if (!codeRow) {
throw new Error("Access code not found.")
}

if (!parseBool(codeRow.is_active, false)) {
throw new Error("Access code is inactive.")
}

if (
codeRow.bound_user_id != null &&
Number(codeRow.bound_user_id) !== Number(userId)
) {
throw new Error("Access code is not assigned to this account.")
}

const now = Date.now()
const startsAtTs = codeRow.starts_at ? new Date(codeRow.starts_at).getTime() : null
const expiresAtTs = codeRow.expires_at ? new Date(codeRow.expires_at).getTime() : null

if (startsAtTs && !Number.isNaN(startsAtTs) && startsAtTs > now) {
throw new Error("Access code is not active yet.")
}

if (expiresAtTs && !Number.isNaN(expiresAtTs) && expiresAtTs <= now) {
throw new Error("Access code has expired.")
}

const priorRedemption = await db.get(
`
SELECT *
FROM sentinel_code_redemptions
WHERE code_id = ?
AND user_id = ?
AND redemption_status = 'success'
LIMIT 1
`,
[codeRow.id, userId]
)

if (priorRedemption) {
throw new Error("This access code has already been redeemed on this account.")
}

const maxRedemptions = Number(codeRow.max_redemptions || 0)
const redeemedCount = Number(codeRow.redeemed_count || 0)

if (maxRedemptions > 0 && redeemedCount >= maxRedemptions) {
throw new Error("Access code redemption limit has been reached.")
}

const activeEntitlementRow = await db.get(
`
SELECT *
FROM sentinel_entitlements
WHERE user_id = ?
AND status = 'active'
ORDER BY datetime(starts_at) DESC, id DESC
LIMIT 1
`,
[userId]
)

const activeEntitlement = serializeEntitlement(activeEntitlementRow)

if (activeEntitlement?.ends_at == null && activeEntitlement?.is_active) {
throw new Error("This account already has permanent Sentinel access.")
}

const durationDays = Math.max(0, Number(codeRow.duration_days || 0))
const derivedTier = resolveAccessTierFromCode(codeRow)
const trialFlag = cleanText(codeRow.code_type, 64).toLowerCase() === "trial" ? 1 : 0
const planKey = cleanText(codeRow.plan_key, 120) || "sentinel_trial"

let entitlementId = null

await db.run("BEGIN IMMEDIATE")

try {
if (activeEntitlement?.id && activeEntitlement.is_active) {
const extensionBase =
activeEntitlement.ends_at && new Date(activeEntitlement.ends_at).getTime() > Date.now()
? activeEntitlement.ends_at
: nowIso()

const nextEndsAt = durationDays > 0 ? addDaysToIso(extensionBase, durationDays) : null

await db.run(
`
UPDATE sentinel_entitlements
SET
source_type = 'code',
source_code_id = ?,
plan_key = ?,
access_tier = ?,
status = 'active',
ends_at = ?,
trial_flag = ?,
granted_by_user_id = ?,
revoked_by_user_id = NULL,
revoke_reason = NULL,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[
codeRow.id,
planKey,
derivedTier,
nextEndsAt,
trialFlag,
codeRow.created_by_user_id ?? null,
activeEntitlement.id,
]
)

entitlementId = activeEntitlement.id
} else {
const startsAt = nowIso()
const endsAt = durationDays > 0 ? addDaysToIso(startsAt, durationDays) : null

const insertResult = await db.run(
`
INSERT INTO sentinel_entitlements (
user_id,
source_type,
source_code_id,
plan_key,
access_tier,
status,
starts_at,
ends_at,
trial_flag,
granted_by_user_id,
created_at,
updated_at
) VALUES (?, 'code', ?, ?, ?, 'active', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
`,
[
userId,
codeRow.id,
planKey,
derivedTier,
startsAt,
endsAt,
trialFlag,
codeRow.created_by_user_id ?? null,
]
)

entitlementId =
Number(insertResult?.lastID || 0) ||
Number(insertResult?.lastId || 0) ||
Number(insertResult?.insertId || 0) ||
null
}

await db.run(
`
UPDATE sentinel_access_codes
SET
redeemed_count = redeemed_count + 1,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[codeRow.id]
)

const activeWallet = await getActiveWalletForUser(userId)

await db.run(
`
INSERT INTO sentinel_code_redemptions (
code_id,
user_id,
entitlement_id,
wallet_address_at_redeem,
redeemed_at,
redemption_status,
created_at,
updated_at
) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'success', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
`,
[
codeRow.id,
userId,
entitlementId,
cleanText(activeWallet?.wallet_address, 128) || null,
]
)

await db.run("COMMIT")
} catch (error) {
try {
await db.run("ROLLBACK")
} catch {}
throw error
}

return getActiveEntitlementForUser(userId)
}

async function handleWalletChallenge(req, res) {
try {
const normalizedWallet = validateSolanaWalletAddress(req.body?.wallet_address)

if (!normalizedWallet) {
return res.status(400).json({
ok: false,
error: "Valid Solana wallet address is required",
})
}

const issuedAt = nowIso()
const expiresAt = addSecondsToIso(issuedAt, WALLET_CHALLENGE_TTL_SEC)
const nonce = crypto.randomBytes(16).toString("hex")

const challengeToken = buildWalletChallengeToken({
userId: req.user.id,
walletAddress: normalizedWallet,
nonce,
issuedAt,
expiresAt,
})

const message = buildWalletLinkMessage({
email: req.user.email,
walletAddress: normalizedWallet,
nonce,
issuedAt,
expiresAt,
})

return res.json({
ok: true,
wallet_address: normalizedWallet,
challenge_token: challengeToken,
nonce,
message,
issued_at: issuedAt,
expires_at: expiresAt,
})
} catch (error) {
console.error("POST /api/auth/wallet/challenge failed", error)
return res.status(500).json({
ok: false,
error: "Failed to create wallet challenge",
message: error?.message || String(error),
})
}
}

async function handleWalletLink(req, res) {
try {
const walletAddress = validateSolanaWalletAddress(
req.body?.wallet_address || req.body?.public_key
)
const challengeToken = cleanText(req.body?.challenge_token, 12000)
const signature = cleanText(req.body?.signature, 12000)
const signatureEncoding = cleanText(req.body?.signature_encoding, 32)
const message = String(req.body?.message ?? "")
const walletLabel = normalizeWalletLabel(req.body?.wallet_label || req.body?.walletLabel)

if (!walletAddress || !signature || !message) {
return res.status(400).json({
ok: false,
error: "wallet_address, message, and signature are required",
})
}

let nonce = ""
let issuedAt = ""
let expiresAt = ""

if (challengeToken) {
const challenge = verifySignedToken(challengeToken, "wallet_link_challenge")

if (!challenge) {
return res.status(400).json({
ok: false,
error: "Wallet challenge is invalid or expired",
})
}

if (Number(challenge.user_id || 0) !== Number(req.user.id)) {
return res.status(403).json({
ok: false,
error: "Wallet challenge does not belong to this account",
})
}

if (validateSolanaWalletAddress(challenge.wallet_address) !== walletAddress) {
return res.status(400).json({
ok: false,
error: "Wallet challenge does not match the provided wallet",
})
}

nonce = cleanText(challenge.nonce, 128)
issuedAt =
cleanText(challenge.issued_at, 64) ||
new Date(Number(challenge.iat || 0) * 1000).toISOString()
expiresAt =
cleanText(challenge.expires_at, 64) ||
new Date(Number(challenge.exp || 0) * 1000).toISOString()
} else {
const parsedMessage = parseWalletLinkMessage(message)

if (!parsedMessage) {
return res.status(400).json({
ok: false,
error: "Signed wallet message is invalid",
})
}

if (normalizeEmail(parsedMessage.account) !== normalizeEmail(req.user.email)) {
return res.status(403).json({
ok: false,
error: "Signed wallet message does not belong to this account",
})
}

if (validateSolanaWalletAddress(parsedMessage.wallet_address) !== walletAddress) {
return res.status(400).json({
ok: false,
error: "Signed wallet message does not match the provided wallet",
})
}

const expiresTs = new Date(parsedMessage.expires_at).getTime()
if (!Number.isFinite(expiresTs) || Number.isNaN(expiresTs) || expiresTs <= Date.now()) {
return res.status(400).json({
ok: false,
error: "Wallet challenge has expired",
})
}

nonce = parsedMessage.nonce
issuedAt = parsedMessage.issued_at
expiresAt = parsedMessage.expires_at
}

const expectedMessage = buildWalletLinkMessage({
email: req.user.email,
walletAddress,
nonce,
issuedAt,
expiresAt,
})

if (String(message) !== expectedMessage) {
return res.status(400).json({
ok: false,
error: "Signed wallet message does not match the expected challenge",
})
}

const verified = verifySolanaDetachedSignature({
walletAddress,
message,
signature,
signatureEncoding,
})

if (!verified) {
return res.status(400).json({
ok: false,
error: "Wallet signature verification failed",
})
}

const otherUserWallet = await db.get(
`
SELECT *
FROM mss_user_wallets
WHERE wallet_address = ?
AND user_id != ?
AND is_active = 1
ORDER BY datetime(linked_at) DESC, id DESC
LIMIT 1
`,
[walletAddress, req.user.id]
)

if (otherUserWallet) {
return res.status(409).json({
ok: false,
error: "This wallet is already linked to another active account",
})
}

await db.run("BEGIN IMMEDIATE")

try {
await db.run(
`
UPDATE mss_user_wallets
SET
is_active = 0,
is_primary = 0,
disconnected_at = COALESCE(disconnected_at, CURRENT_TIMESTAMP),
updated_at = CURRENT_TIMESTAMP
WHERE user_id = ?
AND is_active = 1
`,
[req.user.id]
)

const existingWallet = await db.get(
`
SELECT *
FROM mss_user_wallets
WHERE user_id = ?
AND wallet_address = ?
ORDER BY datetime(linked_at) DESC, id DESC
LIMIT 1
`,
[req.user.id, walletAddress]
)

if (existingWallet?.id) {
await db.run(
`
UPDATE mss_user_wallets
SET
wallet_label = ?,
chain = 'solana',
is_primary = 1,
is_active = 1,
linked_signature = ?,
linked_message = ?,
linked_at = CURRENT_TIMESTAMP,
disconnected_at = NULL,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[
walletLabel || existingWallet.wallet_label || null,
signature,
message,
existingWallet.id,
]
)
} else {
await db.run(
`
INSERT INTO mss_user_wallets (
user_id,
wallet_address,
wallet_label,
chain,
is_primary,
is_active,
linked_signature,
linked_message,
linked_at,
created_at,
updated_at
) VALUES (?, ?, ?, 'solana', 1, 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
`,
[req.user.id, walletAddress, walletLabel || null, signature, message]
)
}

await db.run("COMMIT")
} catch (error) {
try {
await db.run("ROLLBACK")
} catch {}
throw error
}

const payload = await buildAuthResponse(req.user.id)

return res.json({
ok: true,
linked: true,
...payload,
})
} catch (error) {
console.error("POST /api/auth/wallet/link failed", error)
return res.status(500).json({
ok: false,
error: "Failed to link wallet",
message: error?.message || String(error),
})
}
}

router.get("/me", async (req, res) => {
try {
const auth = await getSessionUserFromRequest(req)

if (!auth?.user) {
clearAuthCookie(res)
return res.json(buildUnauthenticatedResponse())
}

const full = await buildAuthResponse(auth.user.id)

return res.json({
ok: true,
authenticated: true,
...full,
})
} catch (error) {
console.error("GET /api/auth/me failed", error)
return res.status(500).json({
ok: false,
error: "Failed to load account state",
message: error?.message || String(error),
})
}
})

router.get("/access/status", async (req, res) => {
try {
const auth = await getSessionUserFromRequest(req)

if (!auth?.user) {
clearAuthCookie(res)
return res.json({
ok: true,
authenticated: false,
has_sentinel_access: false,
has_linked_wallet: false,
can_continue_to_sentinel: false,
entitlement: null,
active_entitlement: null,
entitlements: [],
wallet: null,
active_wallet: null,
})
}

const full = await buildAuthResponse(auth.user.id)

return res.json({
ok: true,
authenticated: true,
...full,
})
} catch (error) {
console.error("GET /api/auth/access/status failed", error)
return res.status(500).json({
ok: false,
error: "Failed to load access status",
message: error?.message || String(error),
})
}
})

router.get("/sentinel-access", requireAuth, async (req, res) => {
try {
const full = await buildAuthResponse(req.user.id)

return res.json({
ok: true,
authenticated: true,
...full,
})
} catch (error) {
console.error("GET /api/auth/sentinel-access failed", error)
return res.status(500).json({
ok: false,
error: "Failed to load Sentinel access",
message: error?.message || String(error),
})
}
})

router.get("/sentinel-gate", requireAuth, async (req, res) => {
try {
const full = await buildAuthResponse(req.user.id)

return res.json({
ok: true,
authenticated: true,
...full,
})
} catch (error) {
console.error("GET /api/auth/sentinel-gate failed", error)
return res.status(500).json({
ok: false,
error: "Failed to load Sentinel gate",
message: error?.message || String(error),
})
}
})

router.post("/register", async (req, res) => {
try {
const email = normalizeEmail(req.body?.email)
const password = String(req.body?.password ?? "")
const displayName = normalizeDisplayName(
req.body?.display_name || req.body?.displayName,
email
)

if (!isValidEmail(email)) {
return res.status(400).json({
ok: false,
error: "Valid email is required",
})
}

if (!isValidPassword(password)) {
return res.status(400).json({
ok: false,
error: "Password must be at least 8 characters",
})
}

const existing = await getUserByEmail(email)
if (existing) {
return res.status(409).json({
ok: false,
error: "An account with that email already exists",
})
}

const passwordHash = await hashPassword(password)
const loginAt = nowIso()

const insertResult = await db.run(
`
INSERT INTO mss_users (
email,
password_hash,
display_name,
status,
role,
email_verified,
last_login_at,
created_at,
updated_at
) VALUES (?, ?, ?, 'active', 'user', 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
`,
[email, passwordHash, displayName || null, loginAt]
)

const userId =
Number(insertResult?.lastID || 0) ||
Number(insertResult?.lastId || 0) ||
Number(insertResult?.insertId || 0)

const user = await getUserById(userId)
const sessionToken = buildSessionToken({
...user,
last_login_at: loginAt,
})

setAuthCookie(res, sessionToken)

const payload = await buildAuthResponse(userId)

return res.status(201).json({
ok: true,
authenticated: true,
...payload,
})
} catch (error) {
console.error("POST /api/auth/register failed", error)
return res.status(500).json({
ok: false,
error: "Failed to register account",
message: error?.message || String(error),
})
}
})

router.post("/login", async (req, res) => {
try {
const email = normalizeEmail(req.body?.email)
const password = String(req.body?.password ?? "")

if (!isValidEmail(email) || !password) {
return res.status(400).json({
ok: false,
error: "Email and password are required",
})
}

const userRow = await getUserRowByEmail(email)
if (!userRow) {
return res.status(401).json({
ok: false,
error: "Invalid email or password",
})
}

const isValid = await verifyPassword(password, userRow.password_hash)
if (!isValid) {
return res.status(401).json({
ok: false,
error: "Invalid email or password",
})
}

const safeUser = serializeUser(userRow)
if (safeUser.status !== "active") {
return res.status(403).json({
ok: false,
error: "Account is not active",
})
}

const loginAt = nowIso()

await db.run(
`
UPDATE mss_users
SET
last_login_at = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[loginAt, safeUser.id]
)

const freshUser = await getUserById(safeUser.id)
const sessionToken = buildSessionToken({
...freshUser,
last_login_at: loginAt,
})

setAuthCookie(res, sessionToken)

const payload = await buildAuthResponse(freshUser.id)

return res.json({
ok: true,
authenticated: true,
...payload,
})
} catch (error) {
console.error("POST /api/auth/login failed", error)
return res.status(500).json({
ok: false,
error: "Failed to sign in",
message: error?.message || String(error),
})
}
})

router.post("/logout", async (req, res) => {
try {
const auth = await getSessionUserFromRequest(req)

if (auth?.user?.id) {
const logoutAt = nowIso()

await db.run(
`
UPDATE mss_users
SET
last_login_at = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[logoutAt, auth.user.id]
)
}

clearAuthCookie(res)

return res.json({
ok: true,
authenticated: false,
})
} catch (error) {
console.error("POST /api/auth/logout failed", error)
clearAuthCookie(res)

return res.json({
ok: true,
authenticated: false,
})
}
})

router.get("/wallets", requireAuth, async (req, res) => {
try {
const wallets = await listWalletsForUser(req.user.id, 20)
const activeWallet = wallets.find((item) => item.is_active) || null

return res.json({
ok: true,
wallets,
linked_wallets: wallets,
wallet: activeWallet,
active_wallet: activeWallet,
})
} catch (error) {
console.error("GET /api/auth/wallets failed", error)
return res.status(500).json({
ok: false,
error: "Failed to load linked wallets",
message: error?.message || String(error),
})
}
})

router.post("/wallet/challenge", requireAuth, handleWalletChallenge)
router.post("/wallet/link/init", requireAuth, handleWalletChallenge)
router.post("/wallet/challenge/start", requireAuth, handleWalletChallenge)

router.post("/wallet/link", requireAuth, handleWalletLink)
router.post("/wallet/verify", requireAuth, handleWalletLink)
router.post("/wallet/link/confirm", requireAuth, handleWalletLink)

router.post("/wallet/disconnect", requireAuth, async (req, res) => {
try {
const requestedWallet = normalizeWalletAddress(req.body?.wallet_address)
const targetWallet = requestedWallet || cleanText(req.active_wallet?.wallet_address, 128)

if (!targetWallet) {
return res.json({
ok: true,
disconnected: false,
wallet: null,
active_wallet: null,
wallets: await listWalletsForUser(req.user.id, 20),
})
}

const walletRow = await db.get(
`
SELECT *
FROM mss_user_wallets
WHERE user_id = ?
AND wallet_address = ?
ORDER BY is_active DESC, is_primary DESC, datetime(linked_at) DESC, id DESC
LIMIT 1
`,
[req.user.id, targetWallet]
)

if (!walletRow) {
return res.status(404).json({
ok: false,
error: "Linked wallet not found on this account",
})
}

await db.run(
`
UPDATE mss_user_wallets
SET
is_active = 0,
is_primary = 0,
disconnected_at = CURRENT_TIMESTAMP,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[walletRow.id]
)

const payload = await buildAuthResponse(req.user.id)

return res.json({
ok: true,
disconnected: true,
...payload,
})
} catch (error) {
console.error("POST /api/auth/wallet/disconnect failed", error)
return res.status(500).json({
ok: false,
error: "Failed to disconnect wallet",
message: error?.message || String(error),
})
}
})

router.post("/access/redeem", requireAuth, async (req, res) => {
try {
const code = normalizeAccessCodeInput(req.body?.code || req.body?.access_code)

if (!code) {
return res.status(400).json({
ok: false,
error: "Access code is required",
})
}

const entitlement = await redeemAccessCodeForUser(req.user.id, code)
const payload = await buildAuthResponse(req.user.id)

return res.json({
ok: true,
redeemed: true,
entitlement,
active_entitlement: entitlement,
...payload,
})
} catch (error) {
console.error("POST /api/auth/access/redeem failed", error)
return res.status(400).json({
ok: false,
error: error?.message || "Failed to redeem access code",
})
}
})

router.post("/redeem", requireAuth, async (req, res) => {
req.url = "/access/redeem"
return router.handle(req, res)
})

export {
getSessionUserFromRequest,
requireAuth,
requireSentinelAccess,
}

export default router
