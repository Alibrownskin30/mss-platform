import { createCassieMiddleware } from "./middleware.js";
import { registerHoneypots } from "./honeypots.js";
import { getCassieSnapshot } from "./store.js";

/**
* Mounted early in server.js:
* app.use(cassieMiddleware())
* registerCassieHoneypots(app)
*/
export function cassieMiddleware() {
return createCassieMiddleware();
}

export function registerCassieHoneypots(app) {
registerHoneypots(app);
}

/**
* Minimal diag endpoint (lock behind ADMIN_KEY env).
* Use: Authorization: Bearer <ADMIN_KEY>
*/
export function cassieDiagHandler(req, res) {
const adminKey = process.env.CASSIE_ADMIN_KEY;
if (!adminKey) return res.status(404).end();

const auth = String(req.headers.authorization || "");
const ok = auth === `Bearer ${adminKey}`;
if (!ok) return res.status(404).end();

return res.json({ ok: true, cassie: getCassieSnapshot() });
}
