import express from "express";
import {
clearAdminSessionCookie,
createAdminSessionFromKey,
getAdminGateRuntimeConfig,
getAdminSessionFromRequest,
setAdminSessionCookie,
} from "../middleware/adminGate.js";

const router = express.Router();

function clean(value, max = 2000) {
return String(value ?? "").trim().slice(0, max);
}

function getDefaultAdminPath(scopes = []) {
const scopeSet = new Set(
Array.isArray(scopes)
? scopes.map((scope) => clean(scope, 64).toLowerCase()).filter(Boolean)
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

return "/admin-login.html";
}

function normalizeSession(session = null) {
if (!session || typeof session !== "object") {
return null;
}

const scopes = Array.isArray(session.scopes)
? session.scopes.map((scope) => clean(scope, 64).toLowerCase()).filter(Boolean)
: [];

if (!scopes.length) {
return null;
}

return {
actor: clean(session.actor || session.actor_id, 120) || "admin",
scopes,
credential_type:
clean(session.credentialType || session.credential_type, 64) || null,
issued_at: session.issuedAt || session.issued_at || null,
expires_at: session.expiresAt || session.expires_at || null,
};
}

function buildSessionResponse({
runtime,
authenticated = false,
session = null,
redirectPath = null,
} = {}) {
const normalizedSession = normalizeSession(session);

return {
ok: true,
gate_enabled: Boolean(runtime?.enabled),
session_configured: Boolean(runtime?.sessionConfigured),
authentication_required: Boolean(runtime?.enabled),
authenticated: Boolean(authenticated && normalizedSession),
actor: normalizedSession?.actor || null,
scopes: normalizedSession?.scopes || [],
credential_type: normalizedSession?.credential_type || null,
issued_at: normalizedSession?.issued_at || null,
expires_at: normalizedSession?.expires_at || null,
session: normalizedSession,
redirect_path:
redirectPath ||
(authenticated && normalizedSession
? getDefaultAdminPath(normalizedSession.scopes)
: "/admin-login.html"),
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
return res.json({
ok: true,
gate_enabled: true,
session_configured: false,
authentication_required: true,
authenticated: false,
actor: null,
scopes: [],
credential_type: null,
issued_at: null,
expires_at: null,
session: null,
redirect_path: "/admin-login.html",
});
}

const session = getAdminSessionFromRequest(req);

if (!session) {
return res.json(
buildSessionResponse({
runtime,
authenticated: false,
session: null,
redirectPath: "/admin-login.html",
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
error: "invalid_admin_key",
message: "Invalid admin access key.",
});
}

setAdminSessionCookie(res, loginSession.token);

return res.json(
buildSessionResponse({
runtime,
authenticated: true,
session: loginSession,
redirectPath: getDefaultAdminPath(loginSession.scopes),
})
);
} catch (error) {
console.error("Admin login failed", error);

return res.status(500).json({
ok: false,
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
authenticated: false,
actor: null,
scopes: [],
session: null,
redirect_path: "/admin-login.html",
});
} catch (error) {
console.error("Admin logout failed", error);

return res.status(500).json({
ok: false,
error: "admin_logout_failed",
message: "Unable to end admin session.",
});
}
});

export default router;
