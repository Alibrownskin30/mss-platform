const state = {
clients: new Map(), // key -> { score, strikes, blockedUntil, lastSeen, reqs:[] , inflight }
events: [], // rolling log (small)
};

const MAX_EVENTS = 400;

function now() { return Date.now(); }

export function clientKey(req) {
// Trust proxy enabled in server.js
const ip = (req.ip || "").trim();
const ua = String(req.headers["user-agent"] || "").slice(0, 180);
const auth = String(req.headers.authorization || "");
const hasToken = auth.startsWith("Bearer ") ? "jwt" : "none";
// You can extend: session cookie hash, etc.
return `${ip}|${hasToken}|${ua}`;
}

export function getClient(req) {
const key = clientKey(req);
let c = state.clients.get(key);
if (!c) {
c = { key, score: 0, strikes: 0, blockedUntil: 0, lastSeen: now(), reqs: [], inflight: 0 };
state.clients.set(key, c);
}
c.lastSeen = now();
return c;
}

export function pushEvent(ev) {
state.events.push({ ts: now(), ...ev });
if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
}

export function setBlocked(client, ms) {
const until = now() + ms;
client.blockedUntil = Math.max(client.blockedUntil || 0, until);
}

export function isBlocked(client) {
return (client.blockedUntil || 0) > now();
}

export function addReq(client, windowMs) {
const t = now();
client.reqs.push(t);
// prune old
const cutoff = t - windowMs;
while (client.reqs.length && client.reqs[0] < cutoff) client.reqs.shift();
return client.reqs.length;
}

export function getCassieSnapshot() {
// small safe snapshot
const totalClients = state.clients.size;
const blocked = [...state.clients.values()].filter((c) => isBlocked(c)).length;
const top = [...state.clients.values()]
.sort((a, b) => (b.score + b.strikes * 10) - (a.score + a.strikes * 10))
.slice(0, 15)
.map((c) => ({
score: c.score,
strikes: c.strikes,
blockedUntil: c.blockedUntil,
lastSeen: c.lastSeen,
inflight: c.inflight,
key: c.key.slice(0, 120),
}));

return { totalClients, blocked, top, events: state.events.slice(-120) };
}
