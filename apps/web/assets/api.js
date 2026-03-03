export function getApiBase() {
if (typeof window !== "undefined" && window.API_BASE && String(window.API_BASE).trim() !== "") {
return String(window.API_BASE).trim().replace(/\/+$/, "");
}

const { protocol, hostname } = window.location;

if (hostname.includes("app.github.dev")) {
return `${protocol}//${hostname.replace("-3000.", "-8787.")}`;
}

return "http://127.0.0.1:8787";
}

const API_BASE = getApiBase();

export async function apiGet(path, opts = {}) {
const res = await fetch(`${API_BASE}${path}`, {
method: "GET",
...opts,
});
if (!res.ok) throw new Error(`API error: ${res.status}`);
return res.json();
}

export async function apiPost(path, body, { token } = {}) {
const headers = { "Content-Type": "application/json" };
if (token) headers.Authorization = `Bearer ${token}`;

const res = await fetch(`${API_BASE}${path}`, {
method: "POST",
headers,
body: JSON.stringify(body ?? {}),
});

// Alerts/auth routes might return JSON errors
const text = await res.text();
let json;
try {
json = text ? JSON.parse(text) : {};
} catch {
json = { ok: false, raw: text };
}

if (!res.ok) {
const msg = json?.error || `API error: ${res.status}`;
throw new Error(msg);
}

return json;
}
