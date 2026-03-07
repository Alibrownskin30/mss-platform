import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "./db.js";

const NODE_ENV = process.env.NODE_ENV || "development";
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

const JWT_ISSUER = process.env.JWT_ISSUER || "mssprotocol";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "mss-users";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "30d";

const CAPTCHA_REQUIRED = String(process.env.CAPTCHA_REQUIRED || "false").toLowerCase() === "true";
const TURNSTILE_SECRET = String(process.env.TURNSTILE_SECRET || "").trim();

function assertStrongJwtSecret() {
if (NODE_ENV === "production") {
const s = String(process.env.JWT_SECRET || "").trim();
if (s.length < 32) {
throw new Error("JWT_SECRET missing/too short for production. Use 32+ characters.");
}
if (s === "dev_secret_change_me") {
throw new Error("JWT_SECRET is still default. Set a real secret.");
}
}
}

assertStrongJwtSecret();

function normalizeEmail(email) {
return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isStrongPassword(pw) {
const s = String(pw || "");
if (s.length < 8) return false;
if (s.length > 200) return false;
return true;
}

function signToken(user) {
const payload = { id: user.id, email: user.email };

return jwt.sign(payload, JWT_SECRET, {
algorithm: "HS256",
expiresIn: JWT_EXPIRES_IN,
issuer: JWT_ISSUER,
audience: JWT_AUDIENCE,
});
}

function bearerFromHeader(req) {
const header = String(req.headers.authorization || "");
const parts = header.split(" ");
if (parts.length !== 2) return null;
if (parts[0] !== "Bearer") return null;
const token = parts[1].trim();
return token || null;
}

async function verifyTurnstileToken(token, remoteip) {
if (!TURNSTILE_SECRET) {
if (CAPTCHA_REQUIRED) {
throw new Error("Captcha is required but TURNSTILE_SECRET is not configured.");
}
return { ok: true, skipped: true };
}

if (!token) {
if (CAPTCHA_REQUIRED) {
return { ok: false, error: "Missing verification token" };
}
return { ok: true, skipped: true };
}

try {
const body = new URLSearchParams();
body.set("secret", TURNSTILE_SECRET);
body.set("response", token);
if (remoteip) body.set("remoteip", remoteip);

const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
method: "POST",
headers: { "Content-Type": "application/x-www-form-urlencoded" },
body: body.toString(),
});

const json = await resp.json().catch(() => null);

if (!json?.success) {
return { ok: false, error: "Human verification failed" };
}

return { ok: true };
} catch {
if (CAPTCHA_REQUIRED) {
return { ok: false, error: "Human verification failed" };
}
return { ok: true, skipped: true };
}
}

async function assertHuman(req) {
const website = String(req.body?.website || "").trim(); // honeypot
if (website) {
return { ok: false, error: "Verification failed" };
}

const humanCheck = req.body?.humanCheck;
const turnstileToken = String(req.body?.turnstileToken || "").trim();

if (CAPTCHA_REQUIRED) {
if (!humanCheck) {
return { ok: false, error: "Please confirm you are human" };
}

const verified = await verifyTurnstileToken(turnstileToken, req.ip);
if (!verified.ok) return verified;
return { ok: true };
}

if (humanCheck === false) {
return { ok: false, error: "Please confirm you are human" };
}

return { ok: true };
}

export async function register(req, res) {
try {
const human = await assertHuman(req);
if (!human.ok) return res.status(400).json({ error: human.error });

const emailRaw = req.body?.email;
const password = req.body?.password;

const email = normalizeEmail(emailRaw);
if (!email || !password) return res.status(400).json({ error: "Missing email/password" });
if (!isValidEmail(email)) return res.status(400).json({ error: "Invalid email" });
if (!isStrongPassword(password)) return res.status(400).json({ error: "Password too weak" });

const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
if (existing) return res.status(400).json({ error: "Email already registered" });

const rounds = NODE_ENV === "production" ? 12 : 10;
const password_hash = await bcrypt.hash(String(password), rounds);

const info = db
.prepare(`INSERT INTO users (email, password_hash) VALUES (?, ?)`)
.run(email, password_hash);

const user = { id: info.lastInsertRowid, email };
const token = signToken(user);
return res.json({ ok: true, token, user });
} catch (e) {
return res.status(500).json({ error: String(e?.message || e) });
}
}

export async function login(req, res) {
try {
const human = await assertHuman(req);
if (!human.ok) return res.status(400).json({ error: human.error });

const emailRaw = req.body?.email;
const password = req.body?.password;

const email = normalizeEmail(emailRaw);
if (!email || !password) return res.status(400).json({ error: "Missing email/password" });
if (!isValidEmail(email)) return res.status(401).json({ error: "Invalid credentials" });

const user = db.prepare(`SELECT id, email, password_hash FROM users WHERE email = ?`).get(email);

if (!user) return res.status(401).json({ error: "Invalid credentials" });

const ok = await bcrypt.compare(String(password), user.password_hash);
if (!ok) return res.status(401).json({ error: "Invalid credentials" });

const token = signToken(user);
return res.json({ ok: true, token, user: { id: user.id, email: user.email } });
} catch (e) {
return res.status(500).json({ error: String(e?.message || e) });
}
}

export function authRequired(req, res, next) {
try {
const token = bearerFromHeader(req);
if (!token) return res.status(401).json({ error: "Missing auth token" });

const payload = jwt.verify(token, JWT_SECRET, {
algorithms: ["HS256"],
issuer: JWT_ISSUER,
audience: JWT_AUDIENCE,
});

req.user = { id: payload.id, email: payload.email };
return next();
} catch {
return res.status(401).json({ error: "Invalid/expired token" });
}
}
