import { CASSIE } from "./config.js";
import { getClient, addReq, isBlocked, setBlocked, pushEvent } from "./store.js";
import { computeRiskDelta } from "./score.js";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function routeGroup(req) {
const p = String(req.path || "");
if (CASSIE.sensitivePrefixes.some((x) => p.startsWith(x))) return "sensitive";
if (CASSIE.scanPrefixes.some((x) => p.startsWith(x))) return "scan";
return "default";
}

function limitsFor(group) {
return CASSIE.limits[group] || CASSIE.limits.default;
}

function concFor(group) {
return CASSIE.concurrency[group] || CASSIE.concurrency.default;
}

function shouldIgnore(req) {
const p = String(req.path || "");
return p === "/" || p === "/health";
}

export function createCassieMiddleware() {
return async function cassie(req, res, next) {
try {
if (shouldIgnore(req)) return next();

const group = routeGroup(req);
const lim = limitsFor(group);
const concMax = concFor(group);

const client = getClient(req);

// hard block
if (isBlocked(client)) {
pushEvent({ type: "blocked", group, path: req.path, key: client.key });
return res.status(429).json({ error: "Too many requests" });
}

// concurrency cap (prevents parallel floods)
if (client.inflight >= concMax) {
client.score += 8;
// tarpit a bit (doesn't punish real users hard)
await sleep(300 + Math.floor(Math.random() * 250));
return res.status(429).json({ error: "Too many requests" });
}

client.inflight++;

// rate window
const n = addReq(client, lim.windowMs);
if (n > lim.max) {
client.score += 12;
client.strikes += 1;
// soft throttle
await sleep(250 + Math.floor(Math.random() * 400));
if (client.score >= CASSIE.scoreBlock) {
setBlocked(client, CASSIE.blockMs);
pushEvent({ type: "block-escalate", group, path: req.path, score: client.score, key: client.key });
client.inflight--;
return res.status(429).json({ error: "Too many requests" });
}
}

// Measure response outcome for scoring
const started = Date.now();
res.on("finish", async () => {
try {
const sc = res.statusCode;
const delta = computeRiskDelta(req, { routeGroup: group, statusCode: sc });

// decay score slowly so normal users recover
client.score = Math.max(0, Math.round(client.score * 0.92));
client.score = Math.min(100, client.score + delta);

const ms = Date.now() - started;

// Actions
if (client.score >= CASSIE.scoreBlock) {
setBlocked(client, client.strikes >= 3 ? CASSIE.banEscalationMs : CASSIE.blockMs);
pushEvent({ type: "block", group, path: req.path, status: sc, ms, score: client.score, key: client.key });
} else if (client.score >= CASSIE.scoreTarpit) {
pushEvent({ type: "tarpit", group, path: req.path, status: sc, ms, score: client.score, key: client.key });
} else if (client.score >= CASSIE.scoreChallenge) {
pushEvent({ type: "challenge", group, path: req.path, status: sc, ms, score: client.score, key: client.key });
} else if (client.score >= CASSIE.scoreThrottle) {
pushEvent({ type: "throttle", group, path: req.path, status: sc, ms, score: client.score, key: client.key });
}
} finally {
client.inflight = Math.max(0, client.inflight - 1);
}
});

// Challenge / tarpit gates (ONLY on sensitive routes)
if (group === "sensitive") {
if (client.score >= CASSIE.scoreTarpit) {
// tarpit: waste hostile automation time (safe delay)
await sleep(1200 + Math.floor(Math.random() * 900));
} else if (client.score >= CASSIE.scoreChallenge) {
// light challenge: require a simple header (you can later replace with captcha / turnstile)
const header = String(req.headers["x-mss-human"] || "");
if (!header) {
client.score += 10;
client.strikes += 1;
return res.status(429).json({ error: "Verification required" });
}
}
}

return next();
} catch (e) {
// Fail-open for most endpoints to avoid outages, but still safe:
// You can tighten later for admin routes.
return next();
}
};
}
