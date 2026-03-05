import { createCassieMiddleware } from "./middleware.js";

/**
* Cassie — defensive middleware for MSS Protocol
* Detect hostile automation → stop it → learn from it → keep real users untouched.
*
* Usage:
* const { cassie, cassieApi } = createCassie();
* app.use(cassie);
* app.get("/api/cassie/status", authRequired, cassieApi.status);
*/
export function createCassie(opts = {}) {
const cassie = createCassieMiddleware(opts);

// Optional internal API helper (keep private/auth-gated in server.js)
const cassieApi = {
status(req, res) {
const snap =
typeof req.__cassieGetSnapshot === "function"
? req.__cassieGetSnapshot()
: null;

res.json({ ok: true, cassie: snap || { enabled: true } });
},
};

return { cassie, cassieApi };
}
