import { pushEvent, getClient, setBlocked } from "./store.js";
import { CASSIE } from "./config.js";

export function registerHoneypots(app) {
// should never be hit by normal users
app.get("/api/_cassie/diag", (req, res, next) => next()); // real handler is in server.js

// Honey routes (high signal)
app.post("/api/admin/_sync", (req, res) => {
const c = getClient(req);
c.score = Math.min(100, c.score + 40);
c.strikes += 2;
setBlocked(c, CASSIE.blockMs);
pushEvent({ type: "honeypot", path: "/api/admin/_sync", key: c.key, score: c.score });
return res.status(401).end();
});

app.get("/.env", (req, res) => {
const c = getClient(req);
c.score = Math.min(100, c.score + 50);
c.strikes += 3;
setBlocked(c, CASSIE.blockMs);
pushEvent({ type: "honeypot", path: "/.env", key: c.key, score: c.score });
return res.status(404).end();
});

app.get("/wp-admin", (req, res) => res.status(404).end());
app.get("/phpmyadmin", (req, res) => res.status(404).end());
}
