import crypto from "crypto";

function sha(s) {
return crypto.createHash("sha256").update(String(s)).digest("hex");
}

function getIp(req) {
// trust proxy must be enabled
const xf = req.headers["x-forwarded-for"];
if (xf) return String(xf).split(",")[0].trim();
return req.ip || req.connection?.remoteAddress || "0.0.0.0";
}

export function getClientMeta(req) {
const ip = getIp(req);
const ua = String(req.headers["user-agent"] || "");
const accept = String(req.headers["accept"] || "");
const lang = String(req.headers["accept-language"] || "");
const auth = String(req.headers["authorization"] || "");
const hasAuth = auth.startsWith("Bearer ");
const authState = hasAuth ? "bearer" : "anon";

return {
ip,
ua,
accept,
lang,
authState,
method: req.method,
path: req.path,
};
}

export function getClientKey(req) {
const meta = getClientMeta(req);
// Keep it stable but not overly invasive:
// ip + ua + accept + authState + coarse path group
const pathGroup = meta.path.split("/").slice(0, 3).join("/");
return sha(`${meta.ip}|${meta.ua}|${meta.accept}|${meta.authState}|${pathGroup}`);
}
