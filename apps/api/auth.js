// apps/api/auth.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

function signToken(user) {
return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
}

export async function register(req, res) {
try {
const { email, password } = req.body || {};
if (!email || !password) return res.status(400).json({ error: "Missing email/password" });

const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
if (existing) return res.status(400).json({ error: "Email already registered" });

const password_hash = await bcrypt.hash(password, 10);
const info = db.prepare(`INSERT INTO users (email, password_hash) VALUES (?, ?)`).run(email, password_hash);

const user = { id: info.lastInsertRowid, email };
const token = signToken(user);
return res.json({ ok: true, token, user });
} catch (e) {
return res.status(500).json({ error: String(e?.message || e) });
}
}

export async function login(req, res) {
try {
const { email, password } = req.body || {};
if (!email || !password) return res.status(400).json({ error: "Missing email/password" });

const user = db.prepare(`SELECT id, email, password_hash FROM users WHERE email = ?`).get(email);
if (!user) return res.status(401).json({ error: "Invalid credentials" });

const ok = await bcrypt.compare(password, user.password_hash);
if (!ok) return res.status(401).json({ error: "Invalid credentials" });

const token = signToken(user);
return res.json({ ok: true, token, user: { id: user.id, email: user.email } });
} catch (e) {
return res.status(500).json({ error: String(e?.message || e) });
}
}

export function authRequired(req, res, next) {
try {
const header = req.headers.authorization || "";
const [, token] = header.split(" ");
if (!token) return res.status(401).json({ error: "Missing auth token" });

const payload = jwt.verify(token, JWT_SECRET);
req.user = { id: payload.id, email: payload.email };
return next();
} catch {
return res.status(401).json({ error: "Invalid/expired token" });
}
}
