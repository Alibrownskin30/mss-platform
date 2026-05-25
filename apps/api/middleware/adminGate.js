import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const DEFAULT_ADMIN_HEADER = "x-admin-key";
const DEFAULT_SESSION_COOKIE_NAME = "mss_admin_session";
const DEFAULT_SESSION_TTL_HOURS = 12;
const DEFAULT_SESSION_VERSION = "v1";
const DEFAULT_SESSION_COOKIE_SAME_SITE = "lax";

const ADMIN_SCOPE = "admin";
const COMPLIANCE_ADMIN_SCOPE = "compliance_admin";
const SENTINEL_ADMIN_SCOPE = "sentinel_admin";
const SENTINEL_ACCESS_SCOPE = "sentinel_access";

const VALID_ADMIN_SCOPES = new Set([
ADMIN_SCOPE,
COMPLIANCE_ADMIN_SCOPE,
SENTINEL_ADMIN_SCOPE,
SENTINEL_ACCESS_SCOPE,
]);

const MASTER_ADMIN_ENV_KEYS = [
"ADMIN_GATE_KEY",
"MSS_ADMIN_KEY",
"ADMIN_KEYS",
];

const COMPLIANCE_ADMIN_ENV_KEYS = [
"COMPLIANCE_ADMIN_KEY",
];

const SENTINEL_ADMIN_ENV_KEYS = [
"SENTINEL_ADMIN_KEY",
];

const SENTINEL_ACCESS_ADMIN_ENV_KEYS = [
"SENTINEL_ACCESS_ADMIN_KEY",
];

function clean(value, max = 2000) {
return String(value ?? "").trim().slice(0, max);
}

function parseBool(value, fallback = false) {
if (typeof value === "boolean") return value;

const normalized = clean(value, 32).toLowerCase();

if (["true", "1", "yes", "y", "enabled", "on"].includes(normalized)) {
return true;
}

if (["false", "0", "no", "n", "disabled", "off"].includes(normalized)) {
return false;
}

return fallback;
}

function clampNumber(value, min, max, fallback) {
const num = Number(value);

if (!Number.isFinite(num)) return fallback;

return Math.max(min, Math.min(max, num));
}

function splitKeys(value) {
return clean(value, 10000)
.split(",")
.map((item) => clean(item, 2000))
.filter(Boolean);
}

function unique(items = []) {
return [...new Set(items.filter(Boolean))];
}

function normalizeScopes(scopes = []) {
return unique(
(Array.isArray(scopes) ? scopes : [])
.map((scope) => clean(scope, 64).toLowerCase())
.filter((scope) => VALID_ADMIN_SCOPES.has(scope))
);
}

function getEnvKeys(...envNames) {
const keys = [];

envNames.forEach((name) => {
keys.push(...splitKeys(process.env[name]));
});

return unique(keys);
}

function getMasterAdminKeys() {
return getEnvKeys(...MASTER_ADMIN_ENV_KEYS);
}

function getComplianceAdminKeys() {
return getEnvKeys(...COMPLIANCE_ADMIN_ENV_KEYS);
}

function getSentinelAdminKeys() {
return getEnvKeys(...SENTINEL_ADMIN_ENV_KEYS);
}

function getSentinelAccessAdminKeys() {
return getEnvKeys(...SENTINEL_ACCESS_ADMIN_ENV_KEYS);
}

function secureCompare(left, right) {
const leftBuffer = Buffer.from(String(left || ""), "utf8");
const rightBuffer = Buffer.from(String(right || ""), "utf8");

if (leftBuffer.length !== rightBuffer.length) {
return false;
}

return timingSafeEqual(leftBuffer, rightBuffer);
}

function keyMatchesAny(providedKey, allowedKeys = []) {
const normalizedKey = clean(providedKey, 2000);

if (!normalizedKey) return false;

return allowedKeys.some((allowedKey) =>
secureCompare(normalizedKey, allowedKey)
);
}

function getRequestAdminKey(req, headerName = DEFAULT_ADMIN_HEADER) {
const headerValue =
req.get(headerName) ||
req.get("x-mss-admin-key") ||
req.get("authorization") ||
"";

const cleaned = clean(headerValue, 3000);

if (!cleaned) return "";

if (cleaned.toLowerCase().startsWith("bearer ")) {
return clean(cleaned.slice(7), 2000);
}

return cleaned;
}

function getCookieValue(req, cookieName) {
const rawCookieHeader = clean(req.headers?.cookie || "", 20000);

if (!rawCookieHeader || !cookieName) return "";

const cookieParts = rawCookieHeader.split(";");

for (const part of cookieParts) {
const separatorIndex = part.indexOf("=");

if (separatorIndex < 0) continue;

const key = clean(part.slice(0, separatorIndex), 200);
const rawValue = part.slice(separatorIndex + 1);

if (key !== cookieName) continue;

try {
return clean(decodeURIComponent(rawValue), 10000);
} catch {
return clean(rawValue, 10000);
}
}

return "";
}

function getRequestFromContext(context = null) {
if (!context) return null;

if (context.headers && typeof context.headers === "object") {
return context;
}

if (context.req?.headers && typeof context.req.headers === "object") {
return context.req;
}

return null;
}

function getRequestHostname(context = null) {
const req = getRequestFromContext(context);

const hostname =
clean(req?.hostname, 255).toLowerCase() ||
clean(req?.headers?.host, 255).toLowerCase();

if (!hostname) return "";

return hostname.split(":")[0];
}

function requestUsesHttps(context = null) {
const req = getRequestFromContext(context);

if (!req) return false;
if (req.secure === true) return true;

const forwardedProto = clean(
req.headers?.["x-forwarded-proto"],
64
)
.split(",")[0]
.trim()
.toLowerCase();

return forwardedProto === "https";
}

function normalizeCookieDomain(value) {
let domain = clean(value, 255).toLowerCase();

if (!domain) return "";

domain = domain
.replace(/^https?:\/\//, "")
.split("/")[0]
.split(":")[0]
.trim();

if (!domain) return "";

if (
domain === "localhost" ||
domain === "127.0.0.1" ||
domain === "[::1]"
) {
return "";
}

if (!domain.startsWith(".")) {
domain = `.${domain}`;
}

if (!/^\.[a-z0-9.-]+$/.test(domain)) {
return "";
}

return domain;
}

function inferSharedAdminCookieDomain(context = null) {
const hostname = getRequestHostname(context);

if (hostname === "api.devnet.mssprotocol.com") {
return ".devnet.mssprotocol.com";
}

if (hostname === "api.mssprotocol.com") {
return ".mssprotocol.com";
}

return "";
}

function getAdminSessionCookieDomain(context = null) {
const configuredDomain = normalizeCookieDomain(
process.env.ADMIN_SESSION_COOKIE_DOMAIN ||
process.env.MSS_ADMIN_SESSION_COOKIE_DOMAIN
);

if (configuredDomain) {
return configuredDomain;
}

return inferSharedAdminCookieDomain(context);
}

function getAdminSessionCookieName() {
const configuredName = clean(process.env.ADMIN_SESSION_COOKIE_NAME, 120);

if (!configuredName) return DEFAULT_SESSION_COOKIE_NAME;

if (!/^[a-zA-Z0-9_-]+$/.test(configuredName)) {
return DEFAULT_SESSION_COOKIE_NAME;
}

return configuredName;
}

function getAdminSessionSecret() {
return clean(process.env.ADMIN_SESSION_SECRET, 10000);
}

function getAdminSessionVersion() {
return (
clean(process.env.ADMIN_SESSION_VERSION, 64) ||
DEFAULT_SESSION_VERSION
);
}

function getAdminSessionTtlMs() {
const hours = clampNumber(
process.env.ADMIN_SESSION_TTL_HOURS,
0.25,
168,
DEFAULT_SESSION_TTL_HOURS
);

return Math.round(hours * 60 * 60 * 1000);
}

function getAdminSessionCookieOptions(context = null) {
const nodeEnv = clean(process.env.NODE_ENV, 32).toLowerCase();

const secureDefault =
nodeEnv === "production" || requestUsesHttps(context);

let secure = parseBool(
process.env.ADMIN_SESSION_COOKIE_SECURE,
secureDefault
);

const configuredSameSite = clean(
process.env.ADMIN_SESSION_COOKIE_SAME_SITE ||
process.env.ADMIN_SESSION_COOKIE_SAMESITE,
20
).toLowerCase();

const sameSite = ["strict", "lax", "none"].includes(configuredSameSite)
? configuredSameSite
: DEFAULT_SESSION_COOKIE_SAME_SITE;

if (sameSite === "none") {
secure = true;
}

const domain = getAdminSessionCookieDomain(context);

return {
httpOnly: true,
secure,
sameSite,
path: "/",
maxAge: getAdminSessionTtlMs(),
...(domain ? { domain } : {}),
};
}

function getCookieClearDomains(context = null) {
const hostname = getRequestHostname(context);
const configuredDomain = getAdminSessionCookieDomain(context);

const domains = [null];

if (configuredDomain) {
domains.push(configuredDomain);
}

if (hostname === "api.devnet.mssprotocol.com") {
domains.push(".devnet.mssprotocol.com");
domains.push(".mssprotocol.com");
}

if (hostname === "api.mssprotocol.com") {
domains.push(".mssprotocol.com");
}

const seen = new Set();

return domains.filter((domain) => {
const key = domain || "__host_only__";

if (seen.has(key)) return false;

seen.add(key);
return true;
});
}

function clearAdminSessionCookieVariants(res, context = null) {
const cookieName = getAdminSessionCookieName();
const options = getAdminSessionCookieOptions(context);

const clearBaseOptions = {
httpOnly: options.httpOnly,
secure: options.secure,
sameSite: options.sameSite,
path: options.path,
};

getCookieClearDomains(context).forEach((domain) => {
res.clearCookie(cookieName, {
...clearBaseOptions,
...(domain ? { domain } : {}),
});
});
}

function encodeSessionPayload(payload) {
return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeSessionPayload(encodedPayload) {
try {
const raw = Buffer.from(encodedPayload, "base64url").toString("utf8");
return JSON.parse(raw);
} catch {
return null;
}
}

function signSessionPayload(encodedPayload, secret) {
return createHmac("sha256", secret)
.update(encodedPayload)
.digest("base64url");
}

function isGateEnabled() {
return parseBool(process.env.ADMIN_GATE_ENABLED, false);
}

function isDevBypassEnabled() {
return parseBool(process.env.ADMIN_GATE_DEV_BYPASS, false);
}

function isLocalRequest(req) {
const host = clean(req.hostname || req.headers.host || "", 255).toLowerCase();
const ip = clean(req.ip || req.socket?.remoteAddress || "", 255);

return (
host.includes("localhost") ||
host.includes("127.0.0.1") ||
host.includes("[::1]") ||
ip === "::1" ||
ip === "127.0.0.1" ||
ip === "::ffff:127.0.0.1"
);
}

function sessionAllowsScope(session, acceptedSessionScopes = []) {
if (!session?.scopes?.length) return false;

const allowedScopes = normalizeScopes(acceptedSessionScopes);

return allowedScopes.some((scope) => session.scopes.includes(scope));
}

function buildUnauthorizedPayload(scope = ADMIN_SCOPE) {
return {
ok: false,
error: "admin_gate_required",
message:
scope === SENTINEL_ACCESS_SCOPE
? "Sentinel Access admin authentication is required."
: "Admin authentication is required.",
scope,
login_required: true,
login_path: "/admin-login.html",
};
}

function buildForbiddenPayload(scope = ADMIN_SCOPE) {
return {
ok: false,
error: "admin_gate_forbidden",
message:
scope === SENTINEL_ACCESS_SCOPE
? "You do not have permission to manage Sentinel Access."
: "You do not have permission to access this admin surface.",
scope,
};
}

function buildNotConfiguredPayload(scope = ADMIN_SCOPE) {
return {
ok: false,
error: "admin_gate_not_configured",
message: "Admin gate is enabled but no valid admin key is configured.",
scope,
};
}

export function getAdminGateRuntimeConfig(context = null) {
const cookieOptions = getAdminSessionCookieOptions(context);

return {
enabled: isGateEnabled(),
sessionConfigured: Boolean(getAdminSessionSecret()),
cookieName: getAdminSessionCookieName(),
cookieDomain: cookieOptions.domain || null,
cookieSameSite: cookieOptions.sameSite,
cookieSecure: cookieOptions.secure,
sessionVersion: getAdminSessionVersion(),
sessionTtlMs: getAdminSessionTtlMs(),
};
}

export function verifyAdminLoginKey(providedKey) {
const key = clean(providedKey, 2000);

if (!key) return null;

const scopes = new Set();
let credentialType = null;

if (keyMatchesAny(key, getMasterAdminKeys())) {
credentialType = "master_admin";
scopes.add(ADMIN_SCOPE);
scopes.add(COMPLIANCE_ADMIN_SCOPE);
scopes.add(SENTINEL_ADMIN_SCOPE);
scopes.add(SENTINEL_ACCESS_SCOPE);
}

if (keyMatchesAny(key, getComplianceAdminKeys())) {
credentialType = credentialType || "compliance_admin";
scopes.add(COMPLIANCE_ADMIN_SCOPE);
}

if (keyMatchesAny(key, getSentinelAdminKeys())) {
credentialType = credentialType || "sentinel_admin";
scopes.add(SENTINEL_ADMIN_SCOPE);
scopes.add(SENTINEL_ACCESS_SCOPE);
}

if (keyMatchesAny(key, getSentinelAccessAdminKeys())) {
credentialType = credentialType || "sentinel_access";
scopes.add(SENTINEL_ACCESS_SCOPE);
}

const normalizedScopes = normalizeScopes([...scopes]);

if (!normalizedScopes.length) {
return null;
}

return {
ok: true,
credentialType,
scopes: normalizedScopes,
isMasterAdmin: normalizedScopes.includes(ADMIN_SCOPE),
};
}

export function createAdminSessionToken({
actor = "admin",
scopes = [ADMIN_SCOPE],
} = {}) {
const secret = getAdminSessionSecret();

if (!secret) {
throw new Error(
"ADMIN_SESSION_SECRET is required before admin sessions can be issued."
);
}

const normalizedScopes = normalizeScopes(scopes);

if (!normalizedScopes.length) {
throw new Error("At least one valid admin session scope is required.");
}

const issuedAt = Date.now();
const expiresAt = issuedAt + getAdminSessionTtlMs();

const payload = {
version: 1,
session_version: getAdminSessionVersion(),
actor: clean(actor, 120) || "admin",
scopes: normalizedScopes,
issued_at: issuedAt,
expires_at: expiresAt,
session_id: randomBytes(24).toString("hex"),
};

const encodedPayload = encodeSessionPayload(payload);
const signature = signSessionPayload(encodedPayload, secret);

return {
token: `${encodedPayload}.${signature}`,
payload,
};
}

export function createAdminSessionFromKey(
providedKey,
{ actor = "admin" } = {}
) {
const verified = verifyAdminLoginKey(providedKey);

if (!verified) return null;

const session = createAdminSessionToken({
actor,
scopes: verified.scopes,
});

return {
ok: true,
credentialType: verified.credentialType,
credential_type: verified.credentialType,
scopes: verified.scopes,
actor: session.payload.actor,
issuedAt: session.payload.issued_at,
issued_at: session.payload.issued_at,
expiresAt: session.payload.expires_at,
expires_at: session.payload.expires_at,
sessionId: session.payload.session_id,
session_id: session.payload.session_id,
token: session.token,
};
}

export function getAdminSessionFromRequest(req) {
const secret = getAdminSessionSecret();

if (!secret) return null;

const cookieName = getAdminSessionCookieName();
const token = getCookieValue(req, cookieName);

if (!token) return null;

const parts = token.split(".");

if (parts.length !== 2) return null;

const [encodedPayload, providedSignature] = parts;
const expectedSignature = signSessionPayload(encodedPayload, secret);

if (!secureCompare(providedSignature, expectedSignature)) {
return null;
}

const payload = decodeSessionPayload(encodedPayload);

if (!payload || payload.version !== 1) {
return null;
}

if (clean(payload.session_version, 64) !== getAdminSessionVersion()) {
return null;
}

const expiresAt = Number(payload.expires_at);

if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
return null;
}

const scopes = normalizeScopes(payload.scopes);

if (!scopes.length) {
return null;
}

return {
ok: true,
actor: clean(payload.actor, 120) || "admin",
scopes,
issuedAt: Number(payload.issued_at) || null,
issued_at: Number(payload.issued_at) || null,
expiresAt,
expires_at: expiresAt,
sessionId: clean(payload.session_id, 120) || null,
session_id: clean(payload.session_id, 120) || null,
};
}

export function setAdminSessionCookie(res, token, req = null) {
const context = req || res;
const cookieName = getAdminSessionCookieName();
const cookieOptions = getAdminSessionCookieOptions(context);

clearAdminSessionCookieVariants(res, context);

res.cookie(cookieName, clean(token, 10000), cookieOptions);
}

export function clearAdminSessionCookie(res, req = null) {
clearAdminSessionCookieVariants(res, req || res);
}

export function createAdminGate({
scope = ADMIN_SCOPE,
envKeys = MASTER_ADMIN_ENV_KEYS,
sessionScopes = [ADMIN_SCOPE],
headerName = DEFAULT_ADMIN_HEADER,
allowWhenDisabled = true,
} = {}) {
return function adminGateMiddleware(req, res, next) {
if (req.method === "OPTIONS") {
return next();
}

const enabled = isGateEnabled();

if (!enabled && allowWhenDisabled) {
return next();
}

if (isDevBypassEnabled() && isLocalRequest(req)) {
req.adminGate = {
ok: true,
scope,
actor: "local-dev-bypass",
authType: "dev_bypass",
scopes: normalizeScopes(sessionScopes),
};

return next();
}

const allowedKeys = getEnvKeys(...envKeys);

if (!allowedKeys.length) {
return res.status(503).json(buildNotConfiguredPayload(scope));
}

const session = getAdminSessionFromRequest(req);

if (session && sessionAllowsScope(session, sessionScopes)) {
req.adminGate = {
ok: true,
scope,
actor: session.actor,
authType: "session",
scopes: session.scopes,
sessionId: session.sessionId,
expiresAt: session.expiresAt,
};

return next();
}

const providedKey = getRequestAdminKey(req, headerName);

if (!providedKey) {
return res.status(401).json(buildUnauthorizedPayload(scope));
}

if (!keyMatchesAny(providedKey, allowedKeys)) {
return res.status(403).json(buildForbiddenPayload(scope));
}

req.adminGate = {
ok: true,
scope,
actor: clean(
req.get("x-admin-actor") || req.get("x-actor-id") || "admin",
120
),
authType: "header_key",
keySource: headerName,
scopes: normalizeScopes(sessionScopes),
};

return next();
};
}

export const requireAdminGate = createAdminGate({
scope: ADMIN_SCOPE,
envKeys: MASTER_ADMIN_ENV_KEYS,
sessionScopes: [ADMIN_SCOPE],
});

export const requireComplianceAdminGate = createAdminGate({
scope: COMPLIANCE_ADMIN_SCOPE,
envKeys: [
...MASTER_ADMIN_ENV_KEYS,
...COMPLIANCE_ADMIN_ENV_KEYS,
],
sessionScopes: [
ADMIN_SCOPE,
COMPLIANCE_ADMIN_SCOPE,
],
});

export const requireSentinelAdminGate = createAdminGate({
scope: SENTINEL_ADMIN_SCOPE,
envKeys: [
...MASTER_ADMIN_ENV_KEYS,
...SENTINEL_ADMIN_ENV_KEYS,
],
sessionScopes: [
ADMIN_SCOPE,
SENTINEL_ADMIN_SCOPE,
],
});

export const requireSentinelAccessAdminGate = createAdminGate({
scope: SENTINEL_ACCESS_SCOPE,
envKeys: [
...MASTER_ADMIN_ENV_KEYS,
...SENTINEL_ADMIN_ENV_KEYS,
...SENTINEL_ACCESS_ADMIN_ENV_KEYS,
],
sessionScopes: [
ADMIN_SCOPE,
SENTINEL_ADMIN_SCOPE,
SENTINEL_ACCESS_SCOPE,
],
});

/*
`/api/compliance-admin` currently contains both compliance and Sentinel admin
endpoints. Until that router is split into individually scoped surfaces,
only the master admin key/session is allowed through this shared gate.
This avoids an access-code management key accidentally controlling Sentinel
runtime or compliance actions.
*/
export const requireAnyAdminGate = createAdminGate({
scope: ADMIN_SCOPE,
envKeys: MASTER_ADMIN_ENV_KEYS,
sessionScopes: [ADMIN_SCOPE],
});

export default createAdminGate;
