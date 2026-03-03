import { CASSIE } from "./config.js";

function hasBadHeaders(req) {
const ua = String(req.headers["user-agent"] || "").toLowerCase();
if (!ua) return 8;
if (ua.includes("python") || ua.includes("curl") || ua.includes("httpclient")) return 10;
return 0;
}

function looksLikeProbing(req) {
const p = String(req.path || "");
// These are common probe targets; scoring only, not blocking by itself
if (p.includes(".env") || p.includes("wp-admin") || p.includes("phpmyadmin")) return 20;
return 0;
}

function payloadSuspicion(req) {
const ct = String(req.headers["content-type"] || "").toLowerCase();
if (!ct.includes("application/json")) return 0;

const body = req.body;
if (!body || typeof body !== "object") return 0;

const s = JSON.stringify(body).toLowerCase();
// lightweight markers (defensive)
const markers = ["<script", "union select", " or 1=1", "sleep(", "information_schema", "169.254.169.254", "file://", "gopher://"];
let hit = 0;
for (const m of markers) if (s.includes(m)) hit += 12;
return Math.min(40, hit);
}

export function computeRiskDelta(req, { routeGroup, statusCode }) {
let d = 0;

d += hasBadHeaders(req);
d += looksLikeProbing(req);
d += payloadSuspicion(req);

// Sensitive routes: stricter
if (routeGroup === "sensitive") d += 6;

// Error patterns can indicate probing
if (statusCode === 401 || statusCode === 403) d += 6;
if (statusCode === 404) d += 4;
if (statusCode >= 500) d += 10;

// Header size sanity
const approxHeaderBytes = Object.entries(req.headers || {}).reduce(
(acc, [k, v]) => acc + String(k).length + String(v || "").length,
0
);
if (approxHeaderBytes > CASSIE.maxHeaderBytes) d += 18;

return d;
}
