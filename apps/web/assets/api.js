export function getApiBase() {
if (window.API_BASE && typeof window.API_BASE === "string" && window.API_BASE.trim()) {
return window.API_BASE.replace(/\/+$/, "");
}

const { protocol, hostname } = window.location;

if (
hostname === "mssprotocol.com" ||
hostname === "www.mssprotocol.com" ||
hostname.endsWith(".mssprotocol.com")
) {
return "https://api.mssprotocol.com";
}

if (hostname.includes("app.github.dev") || hostname.includes("githubpreview.dev")) {
if (hostname.includes("-3000.")) {
return `${protocol}//${hostname.replace("-3000.", "-8787.")}`;
}
return `${protocol}//${hostname.replace(/-\d+\./, "-8787.")}`;
}

return "http://127.0.0.1:8787";
}

function withTimeout(ms = 12000) {
const controller = new AbortController();
const id = setTimeout(() => controller.abort(), ms);
return { controller, clear: () => clearTimeout(id) };
}

async function safeBody(resp) {
const ct = (resp.headers.get("content-type") || "").toLowerCase();
const txt = await resp.text();

if (ct.includes("application/json")) {
try {
return JSON.parse(txt);
} catch {
return { error: "Invalid JSON", raw: txt?.slice?.(0, 300) };
}
}

const looksHtml = txt && /<\/(html|body|head|title)>/i.test(txt);
if (looksHtml) return { error: "Unexpected HTML response from API.", raw: txt.slice(0, 300) };

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

const apiErr =
body && typeof body === "object" && (body.error || body.message)
? body.error || body.message
: null;

const base = apiErr ? String(apiErr) : `HTTP ${status}${statusText ? ` ${statusText}` : ""}`;

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
if (e?.name === "AbortError") throw new Error("API request timed out. Try again.");
const msg = String(e?.message || e);
if (msg.includes("Failed to fetch")) throw new Error("API unreachable.");
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
