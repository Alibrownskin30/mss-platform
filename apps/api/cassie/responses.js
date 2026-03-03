export async function tarpitSleep(ms) {
await new Promise(r => setTimeout(r, ms));
}

export function respondBlocked(res, info) {
const retry = info?.retryAfterSec ?? 900;
res.setHeader("Retry-After", String(retry));
return res.status(429).json({
ok: false,
error: "Temporarily blocked",
code: "CASSIE_BLOCK",
retry_after_sec: retry
});
}

export function respondChallenge(res, action) {
// Later: hook to real captcha/turnstile; for beta, keep it simple
return res.status(401).json({
ok: false,
error: "Verification required",
code: "CASSIE_CHALLENGE",
kind: action.kind || "stepup"
});
}

export function respondDecoy(res, action) {
// Looks plausible but contains no real data
if (action.profile === "maze") {
return res.status(200).json({
ok: true,
data: [],
meta: {
note: "resource pending sync",
cursor: null,
schema: { items: "[]", cursor: "string|null" }
}
});
}
return res.status(200).json({ ok: true });
}
