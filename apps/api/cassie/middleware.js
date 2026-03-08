function now() {
return Date.now();
}

function clamp(n, a, b) {
return Math.max(a, Math.min(b, n));
}

function sleep(ms) {
return new Promise((r) => setTimeout(r, ms));
}

function safeStr(v, maxLen = 8000) {
if (v == null) return "";
const s = String(v);
return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function pickFirstIp(req) {
const xf = req.headers["x-forwarded-for"];
if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
return req.ip || req.connection?.remoteAddress || "0.0.0.0";
}

function stableKey(req) {
const ip = pickFirstIp(req);

const cookie = safeStr(req.headers.cookie || "");
const m = cookie.match(/(?:^|;\s*)mss_sid=([^;]+)/i);
const sid = m ? m[1] : "";

const ua = safeStr(req.headers["user-agent"] || "", 256);
const al = safeStr(req.headers["accept-language"] || "", 128);

const auth = safeStr(req.headers.authorization || "", 64);
const hasAuth = auth.startsWith("Bearer ") ? "b1" : "b0";

if (sid) return `sid:${sid}`;
return `ip:${ip}|ua:${ua}|al:${al}|${hasAuth}`;
}

function isSensitiveRoute(path = "") {
return (
path.startsWith("/api/login") ||
path.startsWith("/api/register") ||
path.startsWith("/api/alerts") ||
path.startsWith("/api/alert-events") ||
path.startsWith("/api/sol/risk-record") ||
path.startsWith("/api/cassie/status")
);
}

function isHoneyRoute(path = "") {
return path === "/api/_cassie/diag" || path === "/api/admin/_sync";
}

function looksLikeBotUA(ua = "") {
const u = ua.toLowerCase();
const bad = [
"python-requests",
"curl/",
"wget/",
"scrapy",
"httpclient",
"libwww",
"go-http-client",
"axios/",
"node-fetch",
"undici",
"okhttp",
"java/",
"postmanruntime",
"insomnia",
"headless",
"selenium",
"playwright",
"puppeteer",
"phantomjs",
"sqlmap",
"nikto",
"nmap",
];
return bad.some((k) => u.includes(k));
}

function looksLikeScannerPath(path = "") {
const p = String(path || "").toLowerCase();
const probes = [
"/.env",
"/config",
"/debug",
"/server-status",
"/actuator",
"/swagger",
"/openapi",
"/graphql",
"/phpmyadmin",
"/wp-admin",
"/wp-login",
"/.git",
"/admin",
"/backup",
"/console",
"/cgi-bin",
"/boaform",
"/vendor/phpunit",
];
return probes.some((x) => p.includes(x));
}

function suspiciousHeaders(req) {
const ua = safeStr(req.headers["user-agent"] || "");
const accept = safeStr(req.headers.accept || "");
const ct = safeStr(req.headers["content-type"] || "");
const secFetchSite = safeStr(req.headers["sec-fetch-site"] || "");
const secFetchMode = safeStr(req.headers["sec-fetch-mode"] || "");

let score = 0;

if (!ua) score += 10;
if (!accept) score += 4;

if (req.method === "POST" && !ct.includes("application/json")) score += 6;
if (accept && accept.length < 8) score += 3;

const browserLike =
ua.includes("Mozilla") ||
ua.includes("Chrome") ||
ua.includes("Safari") ||
ua.includes("Firefox") ||
ua.includes("Edg");

if (browserLike && !secFetchSite) score += 2;
if (browserLike && !secFetchMode) score += 2;

return score;
}

function payloadRisk(req) {
let blob = "";
try {
if (req.body && typeof req.body === "object") blob = JSON.stringify(req.body);
else blob = safeStr(req.body || "");
} catch {
blob = "";
}
blob = blob.toLowerCase();
if (!blob) return 0;

let score = 0;

const sqli = [
"' or 1=1",
"\" or 1=1",
" union select ",
"sleep(",
"benchmark(",
"-- ",
"/*",
"*/",
];
if (sqli.some((m) => blob.includes(m))) score += 22;

const xss = [
"<script",
"onerror=",
"onload=",
"javascript:",
"document.cookie",
"window.location",
];
if (xss.some((m) => blob.includes(m))) score += 18;

const ssrf = [
"http://127.0.0.1",
"http://localhost",
"169.254.169.254",
"file://",
"gopher://",
"ftp://",
];
if (ssrf.some((m) => blob.includes(m))) score += 22;

const traversal = ["../", "..\\", "%2e%2e", "%2f", "%5c"];
if (traversal.some((m) => blob.includes(m))) score += 18;

if (blob.length > 6000) score += 12;

return score;
}

function routeProbeRisk(req) {
const path = safeStr(req.path || "");
const q = safeStr(req.url || "");

let score = 0;

const probes = [
"/.env",
"/wp-admin",
"/wp-login",
"/phpmyadmin",
"/admin",
"/graphql",
"/actuator",
"/.git",
"/server-status",
"/debug",
"/swagger",
"/openapi",
];
if (probes.some((p) => q.toLowerCase().includes(p))) score += 18;

if (path.includes("..") || path.includes("%2e%2e") || path.includes("\\") || path.includes("%5c")) score += 20;

return score;
}

function parseCsvEnv(envVal = "") {
return String(envVal || "")
.split(",")
.map((s) => s.trim())
.filter(Boolean);
}

function ipInAllowlist(ip, list) {
if (!ip || !list?.length) return false;
return list.includes(ip);
}

function hostInAllowlist(host, allowSubstrings) {
if (!host || !allowSubstrings?.length) return false;
const h = String(host).toLowerCase();
return allowSubstrings.some((sub) => h.includes(String(sub).toLowerCase()));
}

function readEnvNumber(env, keys, fallback) {
for (const k of keys) {
const v = env[k];
if (v == null || String(v).trim() === "") continue;
const n = Number(v);
if (Number.isFinite(n)) return n;
}
return fallback;
}

function defaultConfigFromEnv() {
const env = process.env || {};
const enabled = String(env.CASSIE_ENABLED ?? "true").toLowerCase() !== "false";

const THROTTLE_AT = readEnvNumber(env, ["CASSIE_THROTTLE_AT", "CASSIE_SCORE_THROTTLE"], 30);
const TARPIT_AT = readEnvNumber(env, ["CASSIE_TARPIT_AT", "CASSIE_SCORE_TARPIT"], 50);
const BLOCK_AT = readEnvNumber(env, ["CASSIE_BLOCK_AT", "CASSIE_SCORE_BLOCK"], 70);

const THROTTLE_DELAY_MS = readEnvNumber(env, ["CASSIE_THROTTLE_DELAY_MS"], 160);
const TARPIT_DELAY_MS = readEnvNumber(env, ["CASSIE_TARPIT_DELAY_MS"], 1200);

const TEMP_BAN_MS = readEnvNumber(env, ["CASSIE_TEMP_BAN_MS"], 15 * 60 * 1000);
const HONEY_BAN_MS = readEnvNumber(env, ["CASSIE_HONEY_BAN_MS"], 24 * 60 * 60 * 1000);
const legacyBanSec = readEnvNumber(env, ["CASSIE_BLOCK_TTL_SEC"], null);
const TEMP_BAN_MS_FINAL = legacyBanSec != null ? legacyBanSec * 1000 : TEMP_BAN_MS;

const WINDOW_MS = readEnvNumber(env, ["CASSIE_WINDOW_MS"], 20_000);
const MAX_REQ_WINDOW = readEnvNumber(env, ["CASSIE_MAX_REQ_WINDOW"], 60);
const MAX_PARALLEL = readEnvNumber(env, ["CASSIE_MAX_PARALLEL"], 8);

const STORE_TTL_MS = readEnvNumber(env, ["CASSIE_STORE_TTL_MS"], 20 * 60 * 1000);
const CLEANUP_EVERY_MS = readEnvNumber(env, ["CASSIE_CLEANUP_EVERY_MS"], 60_000);

const ALLOWLIST_IPS = parseCsvEnv(env.CASSIE_ALLOWLIST_IPS || "");
const ALLOWLIST_HOSTS = parseCsvEnv(env.CASSIE_ALLOWLIST_HOSTS || "");

const SHADOW_BAN = String(env.CASSIE_SHADOW_BAN ?? "true").toLowerCase() === "true";

return {
enabled,
thresholds: { THROTTLE_AT, TARPIT_AT, BLOCK_AT },
delays: { THROTTLE_DELAY_MS, TARPIT_DELAY_MS },
bans: { TEMP_BAN_MS: TEMP_BAN_MS_FINAL, HONEY_BAN_MS },
windows: { WINDOW_MS, MAX_REQ_WINDOW, MAX_PARALLEL },
store: { STORE_TTL_MS, CLEANUP_EVERY_MS },
allow: { ALLOWLIST_IPS, ALLOWLIST_HOSTS },
shadow: { SHADOW_BAN },
};
}

export function createCassieMiddleware(userOpts = {}) {
const cfg = defaultConfigFromEnv();

const opts = {
...cfg,
...userOpts,
thresholds: { ...cfg.thresholds, ...(userOpts.thresholds || {}) },
delays: { ...cfg.delays, ...(userOpts.delays || {}) },
bans: { ...cfg.bans, ...(userOpts.bans || {}) },
windows: { ...cfg.windows, ...(userOpts.windows || {}) },
store: { ...cfg.store, ...(userOpts.store || {}) },
allow: { ...cfg.allow, ...(userOpts.allow || {}) },
shadow: { ...cfg.shadow, ...(userOpts.shadow || {}) },
};

const clients = new Map();
const global = {
startedAt: new Date().toISOString(),
total: 0,
blocked: 0,
tarpit: 0,
throttled: 0,
allow: 0,
honeypotHits: 0,
watch: 0,
uniqueClients: 0,
};

function getClient(key) {
const t = now();
let c = clients.get(key);
if (!c) {
c = {
key,
score: 0,
state: "allow",
lastSeen: t,
inFlight: 0,
recentReq: [],
recent404: [],
recent401: [],
ban: null,
lastDecision: "ALLOW",
lastReason: "init",
userAgent: "",
ip: "",
hits: { honeypot: 0 },
};
clients.set(key, c);
global.uniqueClients = clients.size;
}
c.lastSeen = t;
return c;
}

const cleanupTimer = setInterval(() => {
const t = now();
for (const [k, c] of clients.entries()) {
if (t - c.lastSeen > opts.store.STORE_TTL_MS) clients.delete(k);
}
global.uniqueClients = clients.size;
}, opts.store.CLEANUP_EVERY_MS);
cleanupTimer.unref?.();

function scoreClient(req, client) {
const t = now();
const path = safeStr(req.path || "");
const ua = safeStr(req.headers["user-agent"] || "");
const host = safeStr(req.headers.host || "");
const ip = pickFirstIp(req);

client.userAgent = ua.slice(0, 160);
client.ip = ip;

const w = opts.windows.WINDOW_MS;
client.recentReq = client.recentReq.filter((ts) => t - ts <= w);
client.recent404 = client.recent404.filter((ts) => t - ts <= w);
client.recent401 = client.recent401.filter((ts) => t - ts <= w);

client.recentReq.push(t);

let score = client.score;

if (client.recentReq.length > opts.windows.MAX_REQ_WINDOW) score += 12;
if (client.inFlight > opts.windows.MAX_PARALLEL) score += 14;
if (looksLikeBotUA(ua)) score += 14;
if (looksLikeScannerPath(path)) score += 20;

score += suspiciousHeaders(req);
score += routeProbeRisk(req);
score += payloadRisk(req);

if (isSensitiveRoute(path)) score += 8;
if (isHoneyRoute(path)) score += 50;

const quietMs = t - (client.recentReq[0] || t);
if (quietMs > w / 2) score -= 2;

if (
ipInAllowlist(ip, opts.allow.ALLOWLIST_IPS) ||
hostInAllowlist(host, opts.allow.ALLOWLIST_HOSTS)
) {
score = Math.min(score, 8);
}

score = clamp(Math.round(score), 0, 100);
client.score = score;
return score;
}

function decide(score, client) {
if (client.ban && now() < client.ban.until) {
return { action: "BLOCK", reason: client.ban.reason };
}

const { THROTTLE_AT, TARPIT_AT, BLOCK_AT } = opts.thresholds;

if (score >= BLOCK_AT) return { action: "BLOCK", reason: "risk_threshold" };
if (score >= TARPIT_AT) return { action: "TARPIT", reason: "risk_threshold" };
if (score >= THROTTLE_AT) return { action: "THROTTLE", reason: "risk_threshold" };
return { action: "ALLOW", reason: "ok" };
}

function ban(client, ms, reason) {
client.ban = { until: now() + ms, reason };
}

function getSnapshot(limit = 20) {
const tracked = [];
let activeBans = 0;

for (const c of clients.values()) {
if (c.ban && now() < c.ban.until) activeBans++;

tracked.push({
key: c.key,
ip: c.ip || "—",
state: c.state || "allow",
score: c.score || 0,
inFlight: c.inFlight || 0,
reqWindow: c.recentReq?.length || 0,
recent404: c.recent404?.length || 0,
recent401: c.recent401?.length || 0,
honeypotHits: c.hits?.honeypot || 0,
lastDecision: c.lastDecision || "ALLOW",
lastReason: c.lastReason || "ok",
bannedUntil: c.ban?.until ? new Date(c.ban.until).toISOString() : null,
lastSeen: c.lastSeen ? new Date(c.lastSeen).toISOString() : null,
userAgent: c.userAgent || "",
});
}

tracked.sort((a, b) => {
if (b.score !== a.score) return b.score - a.score;
return (b.reqWindow || 0) - (a.reqWindow || 0);
});

return {
enabled: !!opts.enabled,
startedAt: global.startedAt,
trackedClients: clients.size,
activeBans,
counters: global,
thresholds: opts.thresholds,
windows: opts.windows,
delays: opts.delays,
topActors: tracked.slice(0, limit),
generatedAt: new Date().toISOString(),
};
}

function shadowDeny(req, res) {
res.setHeader("Cache-Control", "no-store");
if (req.method === "GET") return res.status(200).json({ ok: true });
return res.status(204).end();
}

async function cassie(req, res, next) {
req.__cassieGetSnapshot = getSnapshot;

if (!opts.enabled) return next();

global.total += 1;

const key = stableKey(req);
const client = getClient(key);

if (isHoneyRoute(req.path || "")) {
client.hits.honeypot += 1;
client.score = clamp(client.score + 50, 0, 100);
client.state = "blocked";
client.lastDecision = "BLOCK";
client.lastReason = "honeypot_hit";
global.honeypotHits += 1;
ban(client, opts.bans.HONEY_BAN_MS, "honeypot_hit");
global.blocked += 1;
return res.status(404).end();
}

if (client.ban && now() < client.ban.until) {
client.state = "blocked";
client.lastDecision = "BLOCK";
client.lastReason = client.ban.reason || "active_ban";
global.blocked += 1;
return opts.shadow.SHADOW_BAN
? shadowDeny(req, res)
: res.status(403).json({ error: "Access denied." });
}

client.inFlight += 1;

const score = scoreClient(req, client);
const decision = decide(score, client);

if (decision.action === "BLOCK") {
ban(client, opts.bans.TEMP_BAN_MS, decision.reason);
client.inFlight = Math.max(0, client.inFlight - 1);
client.state = "blocked";
client.lastDecision = "BLOCK";
client.lastReason = decision.reason;
global.blocked += 1;
return opts.shadow.SHADOW_BAN
? shadowDeny(req, res)
: res.status(403).json({ error: "Access denied." });
}

if (decision.action === "TARPIT") {
client.state = "tarpit";
client.lastDecision = "TARPIT";
client.lastReason = decision.reason;
global.tarpit += 1;
const jitter = Math.floor(Math.random() * 600);
await sleep(opts.delays.TARPIT_DELAY_MS + jitter);
} else if (decision.action === "THROTTLE") {
client.state = "throttle";
client.lastDecision = "THROTTLE";
client.lastReason = decision.reason;
global.throttled += 1;
const jitter = Math.floor(Math.random() * 140);
await sleep(opts.delays.THROTTLE_DELAY_MS + jitter);
} else {
client.state = score >= Math.max(12, opts.thresholds.THROTTLE_AT - 12) ? "watch" : "allow";
client.lastDecision = "ALLOW";
client.lastReason = score >= Math.max(12, opts.thresholds.THROTTLE_AT - 12) ? "watch" : "ok";
if (client.state === "watch") global.watch += 1;
else global.allow += 1;
}

res.on("finish", () => {
client.inFlight = Math.max(0, client.inFlight - 1);

const t = now();
const code = Number(res.statusCode || 0);

if (code === 404) client.recent404.push(t);
if (code === 401) client.recent401.push(t);

client.recent404 = client.recent404.filter((ts) => t - ts <= opts.windows.WINDOW_MS);
client.recent401 = client.recent401.filter((ts) => t - ts <= opts.windows.WINDOW_MS);

if (client.recent404.length >= 8) client.score = clamp(client.score + 12, 0, 100);
if (client.recent401.length >= 6) client.score = clamp(client.score + 12, 0, 100);

if (client.recent404.length >= 10 && client.recent401.length >= 8) {
client.score = clamp(client.score + 20, 0, 100);
}

if (client.score >= opts.thresholds.BLOCK_AT) {
ban(client, opts.bans.TEMP_BAN_MS, "post_response_escalation");
client.state = "blocked";
client.lastDecision = "BLOCK";
client.lastReason = "post_response_escalation";
} else if (client.score >= opts.thresholds.TARPIT_AT) {
client.state = "tarpit";
} else if (client.score >= opts.thresholds.THROTTLE_AT) {
client.state = "throttle";
} else if (client.score >= Math.max(12, opts.thresholds.THROTTLE_AT - 12)) {
client.state = "watch";
} else {
client.state = "allow";
}
});

return next();
}

cassie.getSnapshot = getSnapshot;
return cassie;
}
