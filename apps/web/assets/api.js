export function getApiBase() {
// Optional override (do NOT put keys here)
if (window.API_BASE && typeof window.API_BASE === "string" && window.API_BASE.trim()) {
return window.API_BASE.replace(/\/+$/, "");
}

// Codespaces auto-detect: web=3000, api=8787
const { protocol, hostname } = window.location;

// Common patterns:
// - *.app.github.dev
// - *.githubpreview.dev
// We replace the -3000. segment with -8787.
if (hostname.includes("app.github.dev") || hostname.includes("githubpreview.dev")) {
// Only rewrite if it actually looks like the 3000 host
if (hostname.includes("-3000.")) {
return `${protocol}//${hostname.replace("-3000.", "-8787.")}`;
}
// If user opens from a non-3000 preview host, still try same host/8787 rewrite pattern
// (best-effort; user can always set window.API_BASE)
return `${protocol}//${hostname.replace(/-\d+\./, "-8787.")}`;
}

// local fallback
return "http://127.0.0.1:8787";
}

function withTimeout(ms = 12000) {
const controller = new AbortController();
const id = setTimeout(() => controller.abort(), ms);
return { controller, clear: () => clearTimeout(id) };
}

async function safeBody(resp) {
// Prefer JSON if possible, otherwise return text
const ct = (resp.headers.get("content-type") || "").toLowerCase();
const txt = await resp.text();

if (ct.includes("application/json")) {
try {
return JSON.parse(txt);
} catch {
return { error: "Invalid JSON", raw: txt?.slice?.(0, 300) };
}
}

// If API returned HTML (common for proxy errors), keep it short
const looksHtml = txt && /<\/(html|body|head|title)>/i.test(txt);
if (looksHtml) return { error: "Unexpected HTML response from API.", raw: txt.slice(0, 300) };

// Otherwise: plain text
return { error: txt || "Empty response" };
}

function buildHttpError(resp, body) {
const status = resp.status;
const statusText = resp.statusText || "";
const reqId =
resp.headers.get("x-request-id") ||
resp.headers.get("x-vercel-id") ||
resp.headers.get("cf-ray") ||
null;

// Prefer explicit API error field
const apiErr =
(body && typeof body === "object" && (body.error || body.message)) ? (body.error || body.message) : null;

const base = apiErr ? String(apiErr) : `HTTP ${status}${statusText ? ` ${statusText}` : ""}`;

// Add a tiny hint for common failures (professional, not “AI tips”)
let hint = "";
if (status === 401) hint = " (Unauthorized)";
if (status === 403) hint = " (Forbidden)";
if (status === 404) hint = " (Not found)";
if (status === 429) hint = " (Rate limited)";
if (status >= 500) hint = " (Server error)";

const msg = reqId ? `${base}${hint} • req: ${reqId}` : `${base}${hint}`;
return new Error(msg);
}

async function request(method, path, { body = null, token = null, timeoutMs = 12000 } = {}) {
const base = getApiBase();
const url = `${base}${path}`;

const t = withTimeout(timeoutMs);

try {
const headers = {
...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
...(token ? { Authorization: `Bearer ${token}` } : {}),
};

const resp = await fetch(url, {
method,
headers,
cache: "no-store",
signal: t.controller.signal,
...(body != null ? { body: JSON.stringify(body) } : {}),
});

const parsed = await safeBody(resp);

if (!resp.ok) throw buildHttpError(resp, parsed);

return parsed;
} catch (e) {
// Abort => clean timeout message
if (e?.name === "AbortError") throw new Error("API request timed out. Try again.");
// Network error => clean message
const msg = String(e?.message || e);
if (msg.includes("Failed to fetch")) throw new Error("API unreachable. Check API is running on port 8787.");
throw e;
} finally {
t.clear();
}
}

export async function apiGet(path, opts = {}) {
return request("GET", path, opts);
}

export async function apiPost(path, body, token = null, opts = {}) {
return request("POST", path, { ...opts, body, token });
}
