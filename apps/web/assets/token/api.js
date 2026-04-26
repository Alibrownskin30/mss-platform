export function getApiBase() {
// Optional override (do NOT put keys here)
if (window.API_BASE && typeof window.API_BASE === "string" && window.API_BASE.trim()) {
return window.API_BASE.trim().replace(/\/+$/, "");
}

const { protocol, hostname } = window.location;

if (
hostname === "devnet.mssprotocol.com" ||
hostname === "www.devnet.mssprotocol.com"
) {
return "https://api.devnet.mssprotocol.com";
}



// Codespaces auto-detect: web=3000, api=8787
if (hostname.includes("app.github.dev")) {
return `${protocol}//${hostname.replace("-3000.", "-8787.")}`;
}

// Local dev fallbacks
if (hostname === "localhost" || hostname === "127.0.0.1") {
return "http://127.0.0.1:8787";
}

// Production: if UI is on mssprotocol.com (or www.mssprotocol.com),
// use api.mssprotocol.com for the API.
if (hostname === "mssprotocol.com" || hostname === "www.mssprotocol.com") {
return "https://api.mssprotocol.com";
}

// If you ever host UI on another subdomain, keep API on api.<root-domain>
// e.g. beta.mssprotocol.com -> api.mssprotocol.com
const parts = hostname.split(".");
if (parts.length >= 2) {
const root = parts.slice(-2).join(".");
return `${protocol}//api.${root}`;
}

// Last resort
return "https://api.mssprotocol.com";
}

async function safeJson(resp) {
const txt = await resp.text();
try {
return JSON.parse(txt);
} catch {
return { error: txt || "Invalid JSON" };
}
}

export async function apiGet(path) {
const base = getApiBase();
const r = await fetch(`${base}${path}`, { cache: "no-store" });
const j = await safeJson(r);
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
const j = await safeJson(r);
if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
return j;
}
