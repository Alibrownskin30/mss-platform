import express from "express";
import db from "../db/index.js";

const router = express.Router();

function cleanText(value, max = 280) {
return String(value ?? "").trim().slice(0, max);
}

function normalizeAlias(value) {
return cleanText(value, 60).replace(/\s+/g, " ");
}

function safeNum(v, fallback = 0) {
const n = Number(v);
return Number.isFinite(n) ? n : fallback;
}

function buildTrust(score) {
const n = safeNum(score, 0);
if (n >= 80) return { label: "Strong", state: "good" };
if (n >= 55) return { label: "Moderate", state: "warn" };
return { label: "Early", state: "neutral" };
}

function shapeBuilder(row) {
return {
...row,
builder_score: safeNum(row?.builder_score, 0),
trust: buildTrust(row?.builder_score),
};
}

function validateAlias(alias) {
const cleanAlias = normalizeAlias(alias);

if (!cleanAlias) {
throw new Error("alias is required");
}

if (cleanAlias.length < 2) {
throw new Error("alias must be at least 2 characters");
}

if (cleanAlias.length > 60) {
throw new Error("alias is too long");
}

return cleanAlias;
}

async function getAliasOwner(alias) {
const cleanAlias = normalizeAlias(alias);
if (!cleanAlias) return null;

return db.get(
`
SELECT *
FROM builders
WHERE LOWER(alias) = LOWER(?)
LIMIT 1
`,
[cleanAlias]
);
}

//
// CREATE BUILDER PROFILE
//
router.post("/create", async (req, res) => {
try {
const wallet = cleanText(req.body.wallet, 100);
let alias;

try {
alias = validateAlias(req.body.alias);
} catch (err) {
return res.status(400).json({ ok: false, error: err.message });
}

if (!wallet) {
return res.status(400).json({ ok: false, error: "wallet is required" });
}

const existing = await db.get(
`SELECT id FROM builders WHERE wallet = ?`,
[wallet]
);

if (existing) {
return res.status(400).json({
ok: false,
error: "builder profile already exists for this wallet",
});
}

const aliasOwner = await getAliasOwner(alias);
if (aliasOwner) {
return res.status(400).json({
ok: false,
error: "builder alias is already taken",
});
}

const result = await db.run(
`
INSERT INTO builders (
wallet,
alias,
builder_score
) VALUES (?, ?, ?)
`,
[wallet, alias, 50]
);

const builder = await db.get(
`SELECT * FROM builders WHERE id = ?`,
[result.lastID]
);

return res.json({ ok: true, builder: shapeBuilder(builder) });
} catch (err) {
console.error("POST /api/builders/create failed:", err);
return res.status(500).json({ ok: false, error: "internal server error" });
}
});

//
// UPDATE BUILDER PROFILE
//
router.post("/update", async (req, res) => {
try {
const wallet = cleanText(req.body.wallet, 100);
let alias;

try {
alias = validateAlias(req.body.alias);
} catch (err) {
return res.status(400).json({ ok: false, error: err.message });
}

if (!wallet) {
return res.status(400).json({ ok: false, error: "wallet is required" });
}

const existing = await db.get(
`SELECT * FROM builders WHERE wallet = ?`,
[wallet]
);

if (!existing) {
return res.status(404).json({ ok: false, error: "builder not found" });
}

const aliasOwner = await getAliasOwner(alias);
if (aliasOwner && aliasOwner.id !== existing.id) {
return res.status(400).json({
ok: false,
error: "builder alias is already taken",
});
}

await db.run(
`
UPDATE builders
SET alias = ?
WHERE wallet = ?
`,
[alias, wallet]
);

const updated = await db.get(
`SELECT * FROM builders WHERE wallet = ?`,
[wallet]
);

return res.json({
ok: true,
builder: shapeBuilder(updated),
});
} catch (err) {
console.error("POST /api/builders/update failed:", err);
return res.status(500).json({ ok: false, error: "internal server error" });
}
});

//
// LIST BUILDERS
//
router.get("/list", async (_req, res) => {
try {
const rows = await db.all(
`
SELECT
b.*,
COUNT(l.id) AS total_launches
FROM builders b
LEFT JOIN launches l ON l.builder_id = b.id
GROUP BY b.id
ORDER BY b.builder_score DESC, b.id DESC
`
);

const builders = rows.map((row) => ({
...shapeBuilder(row),
total_launches: safeNum(row.total_launches, 0),
}));

return res.json({ ok: true, builders });
} catch (err) {
console.error("GET /api/builders/list failed:", err);
return res.status(500).json({ ok: false, error: "internal server error" });
}
});

//
// GET BUILDER PROFILE + LAUNCHES BY WALLET
//
router.get("/:wallet", async (req, res) => {
try {
const wallet = cleanText(req.params.wallet, 100);

if (!wallet) {
return res.status(400).json({ ok: false, error: "wallet is required" });
}

const builder = await db.get(
`
SELECT *
FROM builders
WHERE wallet = ?
`,
[wallet]
);

if (!builder) {
return res.status(404).json({ ok: false, error: "builder not found" });
}

const launches = await db.all(
`
SELECT
l.*,
b.alias AS builder_alias,
b.wallet AS builder_wallet,
b.builder_score
FROM launches l
JOIN builders b ON b.id = l.builder_id
WHERE b.wallet = ?
ORDER BY l.id DESC
`,
[wallet]
);

const totals = {
all: launches.length,
commit: launches.filter((x) => x.status === "commit").length,
countdown: launches.filter((x) => x.status === "countdown").length,
live: launches.filter((x) => x.status === "live").length,
graduated: launches.filter((x) => x.status === "graduated").length,
failed: launches.filter((x) => x.status === "failed").length,
failed_refunded: launches.filter((x) => x.status === "failed_refunded").length,
};

return res.json({
ok: true,
builder: shapeBuilder(builder),
totals,
launches: launches.map((launch) => ({
...launch,
committed_sol: safeNum(launch.committed_sol, 0),
min_raise_sol: safeNum(launch.min_raise_sol, 0),
hard_cap_sol: safeNum(launch.hard_cap_sol, 0),
participants_count: safeNum(launch.participants_count, 0),
builder_bond_sol: safeNum(launch.builder_bond_sol, 0),
team_allocation_pct: safeNum(launch.team_allocation_pct, 0),
})),
});
} catch (err) {
console.error("GET /api/builders/:wallet failed:", err);
return res.status(500).json({ ok: false, error: "internal server error" });
}
});

export default router;