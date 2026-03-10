import express from "express";
import db from "../db/index.js";

const router = express.Router();

function cleanText(value, max = 280) {
return String(value ?? "").trim().slice(0, max);
}

function getTemplateConfig(template) {
const configs = {
degen: {
launch_type: "degen",
supply: "100000000",
min_raise_sol: 10,
hard_cap_sol: 20,
liquidity_pct: 15,
participants_pct: 50,
reserve_pct: 30,
builder_pct: 5,
},
meme_lite: {
launch_type: "main",
supply: "100000000",
min_raise_sol: 25,
hard_cap_sol: 50,
liquidity_pct: 15,
participants_pct: 50,
reserve_pct: 30,
builder_pct: 5,
},
meme_pro: {
launch_type: "main",
supply: "1000000000",
min_raise_sol: 50,
hard_cap_sol: 100,
liquidity_pct: 15,
participants_pct: 50,
reserve_pct: 30,
builder_pct: 5,
},
builder: {
launch_type: "main",
supply: "100000000",
min_raise_sol: 100,
hard_cap_sol: 300,
liquidity_pct: 20,
participants_pct: 45,
reserve_pct: 25,
builder_pct: 10,
},
};

return configs[template] || null;
}

//
// CREATE LAUNCH
//
router.post("/create", async (req, res) => {
try {
const wallet = cleanText(req.body.wallet, 100);
const template = cleanText(req.body.template, 40);
const tokenName = cleanText(req.body.token_name, 60);
const symbol = cleanText(req.body.symbol, 20).toUpperCase();
const description = cleanText(req.body.description, 500);
const imageUrl = cleanText(req.body.image_url, 500);

if (!wallet) {
return res.status(400).json({ ok: false, error: "wallet is required" });
}

if (!template) {
return res.status(400).json({ ok: false, error: "template is required" });
}

if (!tokenName) {
return res.status(400).json({ ok: false, error: "token_name is required" });
}

if (!symbol) {
return res.status(400).json({ ok: false, error: "symbol is required" });
}

const builder = await db.get(
`SELECT id, wallet, alias FROM builders WHERE wallet = ?`,
[wallet]
);

if (!builder) {
return res.status(404).json({ ok: false, error: "builder profile not found" });
}

const cfg = getTemplateConfig(template);

if (!cfg) {
return res.status(400).json({ ok: false, error: "invalid template" });
}

const result = await db.run(
`
INSERT INTO launches (
builder_id,
launch_type,
template,
token_name,
symbol,
description,
image_url,
supply,
min_raise_sol,
hard_cap_sol,
launch_fee_pct,
liquidity_pct,
participants_pct,
reserve_pct,
builder_pct,
status
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')
`,
[
builder.id,
cfg.launch_type,
template,
tokenName,
symbol,
description,
imageUrl,
cfg.supply,
cfg.min_raise_sol,
cfg.hard_cap_sol,
5,
cfg.liquidity_pct,
cfg.participants_pct,
cfg.reserve_pct,
cfg.builder_pct,
]
);

const launch = await db.get(`SELECT * FROM launches WHERE id = ?`, [
result.lastID,
]);

return res.json({ ok: true, launch });

} catch (err) {
console.error("POST /api/launcher/create failed:", err);
return res.status(500).json({ ok: false, error: "internal server error" });
}
});

//
// GET LAUNCH BY ID
//
router.get("/:id", async (req, res) => {
try {
const id = Number(req.params.id);

const launch = await db.get(
`
SELECT
l.*,
b.wallet AS builder_wallet,
b.alias AS builder_alias,
b.builder_score
FROM launches l
JOIN builders b ON b.id = l.builder_id
WHERE l.id = ?
`,
[id]
);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

return res.json({ ok: true, launch });

} catch (err) {
console.error("GET /api/launcher/:id failed:", err);
return res.status(500).json({ ok: false, error: "internal server error" });
}
});

//
// COMMIT TO LAUNCH
//
router.post("/commit", async (req, res) => {
try {
const launchId = Number(req.body.launch_id);
const wallet = String(req.body.wallet || "").trim();
const solAmount = Number(req.body.sol_amount);

if (!launchId || !wallet || !solAmount) {
return res.status(400).json({ ok: false, error: "missing fields" });
}

const launch = await db.get(
`SELECT * FROM launches WHERE id = ?`,
[launchId]
);

if (!launch) {
return res.status(404).json({ ok: false, error: "launch not found" });
}

if (launch.status !== "queued" && launch.status !== "committing") {
return res.status(400).json({ ok: false, error: "launch not accepting commits" });
}

const newTotal = launch.committed_sol + solAmount;

if (newTotal > launch.hard_cap_sol) {
return res.status(400).json({ ok: false, error: "hard cap exceeded" });
}

await db.run(
`
INSERT INTO commitments (launch_id, wallet, sol_amount)
VALUES (?, ?, ?)
`,
[launchId, wallet, solAmount]
);

await db.run(
`
UPDATE launches
SET
committed_sol = ?,
participants_count = participants_count + 1,
status = 'committing',
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[newTotal, launchId]
);

const updatedLaunch = await db.get(
`SELECT * FROM launches WHERE id = ?`,
[launchId]
);

return res.json({ ok: true, launch: updatedLaunch });

} catch (err) {
console.error("POST /api/launcher/commit failed:", err);
return res.status(500).json({ ok: false, error: "internal server error" });
}
});

export default router;