export function detectPayloadSignatures(req) {
// We only flag patterns. We do not exploit anything. No hack-back.
const tags = [];
const path = String(req.originalUrl || req.url || "");
const q = req.query ? JSON.stringify(req.query) : "";
const ct = String(req.headers["content-type"] || "");

// body might not be available if not parsed; safe check
let body = "";
try { body = req.body ? JSON.stringify(req.body) : ""; } catch {}

const blob = `${path}\n${q}\n${body}`.toLowerCase();

// basic markers
if (/(<script|onerror=|onload=|javascript:)/.test(blob)) tags.push("xss");
if (/(union\s+select|or\s+1=1|sleep\(|benchmark\(|information_schema)/.test(blob)) tags.push("sqli");
if (/(http:\/\/127\.0\.0\.1|http:\/\/localhost|169\.254\.169\.254|file:\/\/|gopher:\/\/)/.test(blob)) tags.push("ssrf");
if (/(\/etc\/passwd|..\/..\/|%2e%2e%2f)/.test(blob)) tags.push("traversal");
if (/(\\u0000|\x00)/.test(blob)) tags.push("nullbyte");

return { hit: tags.length > 0, tags };
}
