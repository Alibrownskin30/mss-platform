// apps/web/assets/api.js

export function getApiBase() {
// Optional override (do NOT put keys here)
if (window.API_BASE && typeof window.API_BASE === "string") {
return window.API_BASE.replace(/\/+$/, "");
}

// Codespaces auto-detect: web=3000, api=8787
const { protocol, hostname } = window.location;
if (hostname.includes("app.github.dev")) {
return `${protocol}//${hostname.replace("-3000.", "-8787.")}`;
}

// local fallback
return "http://localhost:8787";
}

export async function apiGet(path) {
const base = getApiBase();
const r = await fetch(`${base}${path}`, { cache: "no-store" });
const txt = await r.text();
let j;
try { j = JSON.parse(txt); } catch { j = { error: txt || "Invalid JSON" }; }
if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
return j;
}

export async function apiPost(path, body, token = null) {
const base = getApiBase();
const r = await fetch(`${base}${path}`, {
method: "POST",
headers: {
"Content-Type": "application/json",
...(token ? { Authorization: `Bearer ${token}` } : {}),
},
body: JSON.stringify(body),
});
const txt = await r.text();
let j;
try { j = JSON.parse(txt); } catch { j = { error: txt || "Invalid JSON" }; }
if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
return j;
}
