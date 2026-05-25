import express from "express";
import {
clearAdminSessionCookie,
createAdminSessionFromKey,
getAdminGateRuntimeConfig,
getAdminSessionFromRequest,
setAdminSessionCookie,
} from "../middleware/adminGate.js";

const router = express.Router();

const ADMIN_SESSION_ROUTE_VERSION = "20260525-admin-session-full-status-v2";
const ADMIN_LOGIN_PATH = "/admin-login.html";

function clean(value, max = 2000) {
return String(value ?? "").trim().slice(0, max);
}

function applyAdminSessionResponseHeaders(res) {
const currentVary = clean(res.getHeader("Vary"), 500);

res.setHeader(
"Cache-Control",
"no-store, no-cache, must-revalidate, proxy-revalidate"
);
res.setHeader("Pragma", "no-cache");
res.setHeader("Expires", "0");
res.setHeader("Surrogate-Control", "no-store");
res.setHeader("X-MSS-Admin-Session-Route", ADMIN_SESSION_ROUTE_VERSION);
res.setHeader(
"Vary",
currentVary
? `${currentVary}, Cookie`
: "Cookie"
);
}

router.use((req, res, next) => {
applyAdminSessionResponseHeaders(res);
next();
});

function getDefaultAdminPath(scopes = []) {
const scopeSet = new Set(
Array.isArray(scopes)
? scopes
.map((scope) => clean(scope, 64).toLowerCase())
.filter(Boolean)
: []
);

if (scopeSet.has("admin")) {
return "/admin.html";
}

if (scopeSet.has("sentinel_admin")) {
return "/sentinel-admin.html";
}

if (scopeSet.has("compliance_admin")) {
return "/compliance-admin.html";
}

if (scopeSet.has("sentinel_access")) {
return "/sentinel-access-admin.html";
}

return ADMIN_LOGIN_PATH;
}

function unwrapSessionCandidate(session = null) {
if (!session || typeof session !== "object") {
return null;
}

if (session.session && typeof session.session === "object") {
return session.session;
}

return session;
}

function normalizeSession(session = null) {
const source = unwrapSessionCandidate(session);

if (!source) {
return null;
}

const scopes = Array.isArray(source.scopes)
? source.scopes
.map((scope) => clean(scope, 64).toLowerCase())
.filter(Boolean)
: [];

if (!scopes.length) {
return null;
}

return {
actor: clean(source.actor || source.actor_id, 120) || "admin",
scopes,
credential_type:
clean(source.credentialType || source.credential_type, 64) || null,
issued_at: source.issuedAt || source.issued_at || null,
expires_at: source.expiresAt || source.expires_at || null,
};
}

function buildSessionResponse({
runtime,
authenticated = false,
session = null,
redirectPath = null,
} = {}) {
const normalizedSession = normalizeSession(session);
const isAuthenticated = Boolean(authenticated && normalizedSession);

return {
ok: true,
route_version: ADMIN_SESSION_ROUTE_VERSION,
gate_enabled: Boolean(runtime?.enabled),
session_configured: Boolean(runtime?.sessionConfigured),
authentication_required: Boolean(runtime?.enabled),
authenticated: isAuthenticated,
actor: normalizedSession?.actor || null,
scopes: normalizedSession?.scopes || [],
credential_type: normalizedSession?.credential_type || null,
issued_at: normalizedSession?.issued_at || null,
expires_at: normalizedSession?.expires_at || null,
session: isAuthenticated ? normalizedSession : null,
login_path: ADMIN_LOGIN_PATH,
redirect_path:
redirectPath ||
(isAuthenticated
? getDefaultAdminPath(normalizedSession.scopes)
: ADMIN_LOGIN_PATH),
};
}

function buildDisabledGateSession() {
return {
actor: "admin-gate-disabled",
scopes: ["admin"],
credential_type: "gate_disabled",
issued_at: null,
expires_at: null,
};
}

function handleSessionStatus(req, res) {
try {
const runtime = getAdminGateRuntimeConfig();

if (!runtime.enabled) {
return res.json(
buildSessionResponse({
runtime,
authenticated: true,
session: buildDisabledGateSession(),
redirectPath: "/admin.html",
})
);
}

if (!runtime.sessionConfigured) {
return res.json(
buildSessionResponse({
runtime,
authenticated: false,
session: null,
redirectPath: ADMIN_LOGIN_PATH,
})
);
}

const session = getAdminSessionFromRequest(req);

if (!session) {
return res.json(
buildSessionResponse({
runtime,
authenticated: false,
session: null,
redirectPath: ADMIN_LOGIN_PATH,
})
);
}

return res.json(
buildSessionResponse({
runtime,
authenticated: true,
session,
})
);
} catch (error) {
console.error("Admin session check failed", error);

return res.status(500).json({
ok: false,
route_version: ADMIN_SESSION_ROUTE_VERSION,
error: "admin_session_check_failed",
message: "Unable to verify admin session.",
});
}
}

/*
* Primary frontend session-state endpoint.
* Used by admin-login.js and admin-session-guard.js.
*/
router.get("/status", handleSessionStatus);

/*
* Compatibility alias for any existing admin-session callers.
*/
router.get("/session", handleSessionStatus);

router.post("/login", (req, res) => {
try {
const runtime = getAdminGateRuntimeConfig();

if (!runtime.enabled) {
return res.json(
buildSessionResponse({
runtime,
authenticated: true,
session: buildDisabledGateSession(),
redirectPath: "/admin.html",
})
);
}

if (!runtime.sessionConfigured) {
return res.status(503).json({
ok: false,
route_version: ADMIN_SESSION_ROUTE_VERSION,
error: "admin_session_not_configured",
message:
"Admin sessions are not configured. Add ADMIN_SESSION_SECRET to the server environment.",
});
}

const providedKey = clean(
req.body?.key ||
req.body?.admin_key ||
req.body?.access_key ||
req.body?.code,
2000
);

const actor =
clean(req.body?.actor_id || req.body?.actor || "admin", 120) || "admin";

if (!providedKey) {
return res.status(400).json({
ok: false,
route_version: ADMIN_SESSION_ROUTE_VERSION,
error: "admin_key_required",
message: "Enter an admin access key.",
});
}

const loginSession = createAdminSessionFromKey(providedKey, {
actor,
});

if (!loginSession) {
clearAdminSessionCookie(res);

return res.status(401).json({
ok: false,
route_version: ADMIN_SESSION_ROUTE_VERSION,
error: "invalid_admin_key",
message: "Invalid admin access key.",
});
}

const normalizedSession = normalizeSession(loginSession);

if (!normalizedSession) {
clearAdminSessionCookie(res);

console.error(
"Admin login created an invalid session payload without scopes.",
{
hasToken: Boolean(loginSession?.token),
hasNestedSession: Boolean(loginSession?.session),
}
);

return res.status(500).json({
ok: false,
route_version: ADMIN_SESSION_ROUTE_VERSION,
error: "invalid_admin_session_payload",
message: "Unable to create a valid admin session.",
});
}

const token =
clean(loginSession?.token, 12000) ||
clean(loginSession?.session_token, 12000);

if (!token) {
clearAdminSessionCookie(res);

console.error("Admin login session did not include a cookie token.");

return res.status(500).json({
ok: false,
route_version: ADMIN_SESSION_ROUTE_VERSION,
error: "admin_session_token_missing",
message: "Unable to create a valid admin session.",
});
}

setAdminSessionCookie(res, token);

return res.json(
buildSessionResponse({
runtime,
authenticated: true,
session: normalizedSession,
redirectPath: getDefaultAdminPath(normalizedSession.scopes),
})
);
} catch (error) {
console.error("Admin login failed", error);

return res.status(500).json({
ok: false,
route_version: ADMIN_SESSION_ROUTE_VERSION,
error: "admin_login_failed",
message: "Unable to create admin session.",
});
}
});

router.post("/logout", (req, res) => {
try {
clearAdminSessionCookie(res);

return res.json({
ok: true,
route_version: ADMIN_SESSION_ROUTE_VERSION,
authenticated: false,
actor: null,
scopes: [],
session: null,
login_path: ADMIN_LOGIN_PATH,
redirect_path: ADMIN_LOGIN_PATH,
});
} catch (error) {
console.error("Admin logout failed", error);

return res.status(500).json({
ok: false,
route_version: ADMIN_SESSION_ROUTE_VERSION,
error: "admin_logout_failed",
message: "Unable to end admin session.",
});
}
});

export default router;
