import { isSensitiveRoute, isHoneyRouteCandidate } from "./routes.js";
import { banTemporarily } from "./store.js";

export async function decideAction({ key, req, meta, verdict }) {
const s = verdict.score;

// Hard confirmed hostile triggers -> block
if (verdict.signals?.payload?.includes("ssrf") && isSensitiveRoute(req.path)) {
const blockInfo = await banTemporarily(key, 60 * 30, "SSRF signature on sensitive route");
return { type: "BLOCK", blockInfo };
}

// High risk: decoy if probing / enum
if (s >= 80 && (verdict.reasons.includes("endpoint enumeration") || verdict.reasons.includes("404 enumeration pattern"))) {
return { type: "DECOY", profile: "maze" };
}

// Medium-high: tarpit
if (s >= 65) {
return { type: "TARPIT", delayMs: 2500, respond: null };
}

// Medium: challenge only on sensitive routes
if (s >= 45 && isSensitiveRoute(req.path)) {
return { type: "CHALLENGE", kind: "stepup" };
}

// Low-medium: throttle
if (s >= 30) {
return { type: "THROTTLE", delayMs: 300 };
}

return { type: "ALLOW" };
}
