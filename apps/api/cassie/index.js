import { createCassieMiddleware } from "./middleware.js";
import { buildCassieDna } from "./dna.js";
import {
rememberCassieScan,
getCassieMemoryByMint,
getCassieMemoryBySignature,
getCassieMemorySnapshot,
} from "./memory.js";
import { runCassieRadar } from "./radar.js";
import { runCassieSimulation } from "./simulate.js";

/**
* Cassie — defensive + intelligence layer for MSS Protocol
*
* Defensive:
* - request filtering
* - hostile automation friction
* - honeypot routing
*
* Intelligence:
* - DNA fingerprinting
* - hostile pattern radar
* - safe exploitability simulation
* - runtime memory for repeat structures
*
* Usage:
* const { cassie, cassieApi, cassieIntel } = createCassie();
* app.use(cassie);
* app.get("/api/cassie/status", authRequired, cassieApi.status);
*/
export function createCassie(opts = {}) {
const cassie = createCassieMiddleware(opts);

const cassieIntel = {
analyze({
mint,
token = {},
market = {},
concentration = {},
activity = {},
securityModel = {},
trend = {},
}) {
const dnaResult = buildCassieDna({
mint,
token,
market,
concentration,
activity,
securityModel,
trend,
});

const radar = runCassieRadar({
cassieDna: dnaResult.cassieDna,
securityModel,
concentration,
});

const simulation = runCassieSimulation({
token,
market,
concentration,
securityModel,
});

rememberCassieScan({
mint,
cassieDna: dnaResult.cassieDna,
securityModel,
});

const memory = getCassieMemoryByMint(mint);

return {
dna: dnaResult.cassieDna,
radar,
simulation,
memory,
};
},

memoryByMint(mint) {
return getCassieMemoryByMint(mint);
},

memoryBySignature(signature) {
return getCassieMemoryBySignature(signature);
},

memorySnapshot(limit = 50) {
return getCassieMemorySnapshot(limit);
},
};

const cassieApi = {
status(req, res) {
const snap =
typeof req.__cassieGetSnapshot === "function"
? req.__cassieGetSnapshot()
: null;

res.json({
ok: true,
cassie: snap || { enabled: true },
});
},
};

return { cassie, cassieApi, cassieIntel };
}
