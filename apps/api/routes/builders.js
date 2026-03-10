import express from "express";
import db from "../db/index.js";

const router = express.Router();

function cleanText(value, max = 280) {
return String(value ?? "").trim().slice(0, max);
}

function cleanHandle(value, max = 120) {
return String(value ?? "")
.trim()
.replace(/^@/, "")
.slice(0, max);
}

// Create builder profile
router.post("/create", async (req, res) => {
try {
const wallet = cleanText(req.body.wallet, 100);
const alias = cleanText(req.body.alias, 40);
const bio = cleanText(req.body.bio, 280);
const avatarUrl = cleanText(req.body.avatar_url, 500);
const twitter = cleanHandle(req.body.twitter, 120);
const telegram = cleanHandle(req.body.telegram, 120);

if (!wallet) {
return res.status(400).json({ ok: false, error: "wallet is required" });
}

if (!alias) {
return res.status(400).json({ ok: false, error: "alias is required" });
}

const existing = await db.get(
`SELECT id, wallet FROM builders WHERE wallet = ?`,
[wallet]
);

if (existing) {
return res.status(409).json({
ok: false,
error: "builder profile already exists for this wallet",
});
}

const result = await db.run(
`
INSERT INTO builders (
wallet, alias, bio, avatar_url, twitter, telegram
) VALUES (?, ?, ?, ?, ?, ?)
`,
[wallet, alias, bio, avatarUrl, twitter, telegram]
);

const builder = await db.get(`SELECT * FROM builders WHERE id = ?`, [
result.lastID,
]);

return res.json({ ok: true, builder });
} catch (err) {
console.error("POST /api/builders/create failed:", err);
return res.status(500).json({ ok: false, error: "internal server error" });
}
});

// Get builder by wallet
router.get("/:wallet", async (req, res) => {
try {
const wallet = cleanText(req.params.wallet, 100);

const builder = await db.get(
`
SELECT
id,
wallet,
alias,
bio,
avatar_url,
twitter,
telegram,
show_projects,
builder_score,
projects_launched,
successful_launches,
created_at,
updated_at
FROM builders
WHERE wallet = ?
`,
[wallet]
);

if (!builder) {
return res.status(404).json({ ok: false, error: "builder not found" });
}

return res.json({ ok: true, builder });
} catch (err) {
console.error("GET /api/builders/:wallet failed:", err);
return res.status(500).json({ ok: false, error: "internal server error" });
}
});

// Update builder profile
router.post("/update", async (req, res) => {
try {
const wallet = cleanText(req.body.wallet, 100);
const alias = cleanText(req.body.alias, 40);
const bio = cleanText(req.body.bio, 280);
const avatarUrl = cleanText(req.body.avatar_url, 500);
const twitter = cleanHandle(req.body.twitter, 120);
const telegram = cleanHandle(req.body.telegram, 120);
const showProjects = req.body.show_projects ? 1 : 0;

if (!wallet) {
return res.status(400).json({ ok: false, error: "wallet is required" });
}

const existing = await db.get(
`SELECT id FROM builders WHERE wallet = ?`,
[wallet]
);

if (!existing) {
return res.status(404).json({ ok: false, error: "builder not found" });
}

await db.run(
`
UPDATE builders
SET
alias = COALESCE(NULLIF(?, ''), alias),
bio = ?,
avatar_url = ?,
twitter = ?,
telegram = ?,
show_projects = ?,
updated_at = CURRENT_TIMESTAMP
WHERE wallet = ?
`,
[alias, bio, avatarUrl, twitter, telegram, showProjects, wallet]
);

const builder = await db.get(`SELECT * FROM builders WHERE wallet = ?`, [
wallet,
]);

return res.json({ ok: true, builder });
} catch (err) {
console.error("POST /api/builders/update failed:", err);
return res.status(500).json({ ok: false, error: "internal server error" });
}
});

export default router;
