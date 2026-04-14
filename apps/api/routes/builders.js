import express from "express";
import db from "../db/index.js";

const router = express.Router();

function cleanText(value, max = 280) {
return String(value ?? "").trim().slice(0, max);
}

function normalizeAlias(value) {
return cleanText(value, 60).replace(/\s+/g, " ");
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

function normalizeStatus(value) {
return cleanText(value, 40).toLowerCase();
}

function safeNum(v, fallback = 0) {
const n = Number(v);
return Number.isFinite(n) ? n : fallback;
}

function safeInt(v, fallback = 0) {
return Math.max(0, Math.floor(safeNum(v, fallback)));
}

function formatCount(value) {
return safeInt(value, 0).toLocaleString("en-US");
}

function formatNumber(value, decimals = 1) {
return safeNum(value, 0).toLocaleString("en-US", {
minimumFractionDigits: 0,
maximumFractionDigits: decimals,
});
}

function isLiveLikeStatus(status) {
const normalized = normalizeStatus(status);
return normalized === "live" || normalized === "graduated";
}

function isBuilderTemplate(template) {
return cleanText(template, 40).toLowerCase() === "builder";
}

function buildTrust(score) {
const n = safeNum(score, 0);
if (n >= 80) return { label: "Strong", state: "good" };
if (n >= 55) return { label: "Moderate", state: "warn" };
return { label: "Early", state: "neutral" };
}

function buildProfileTier(score) {
const n = safeNum(score, 0);
if (n >= 80) return "elite";
if (n >= 55) return "established";
return "early";
}

function buildCommitPercent(committed, hardCap) {
const totalCommitted = safeNum(committed, 0);
const totalHardCap = safeNum(hardCap, 0);
if (totalHardCap <= 0) return 0;
return Math.max(
0,
Math.min(100, Number(((totalCommitted / totalHardCap) * 100).toFixed(1)))
);
}

function shapeBuilder(row, extra = {}) {
const builderScore = safeNum(row?.builder_score, 0);

return {
...row,
builder_score: builderScore,
trust: buildTrust(builderScore),
profile_tier: buildProfileTier(builderScore),
...extra,
};
}

function shapeLaunch(row) {
const committedSol = safeNum(row?.committed_sol, 0);
const minRaiseSol = safeNum(row?.min_raise_sol, 0);
const hardCapSol = safeNum(row?.hard_cap_sol, 0);
const participantsCount = safeInt(row?.participants_count, 0);
const builderBondSol = safeNum(row?.builder_bond_sol, 0);
const builderBondRefunded = safeInt(row?.builder_bond_refunded, 0);
const teamAllocationPct = safeNum(row?.team_allocation_pct, 0);
const status = normalizeStatus(row?.status);

return {
...row,
status,
committed_sol: committedSol,
min_raise_sol: minRaiseSol,
hard_cap_sol: hardCapSol,
participants_count: participantsCount,
builder_bond_sol: builderBondSol,
builder_bond_refunded: builderBondRefunded,
team_allocation_pct: teamAllocationPct,
commit_percent: buildCommitPercent(committedSol, hardCapSol),
min_raise_reached: minRaiseSol > 0 && committedSol >= minRaiseSol,
hard_cap_reached: hardCapSol > 0 && committedSol >= hardCapSol,
is_live_like: isLiveLikeStatus(status),
is_builder_template: isBuilderTemplate(row?.template),
has_team_structure: teamAllocationPct > 0,
has_builder_bond: builderBondSol > 0,
};
}

function buildBuilderStatsFromLaunches(launches = []) {
const rows = Array.isArray(launches) ? launches.map(shapeLaunch) : [];

const totalLaunches = rows.length;
const commitLaunches = rows.filter((x) => x.status === "commit").length;
const countdownLaunches = rows.filter((x) => x.status === "countdown").length;
const liveLaunches = rows.filter((x) => x.status === "live").length;
const graduatedLaunches = rows.filter((x) => x.status === "graduated").length;
const failedLaunches = rows.filter((x) => x.status === "failed").length;
const refundedLaunches = rows.filter((x) => x.status === "failed_refunded").length;
const liveLikeLaunches = rows.filter((x) => x.is_live_like).length;
const activePipelineLaunches = rows.filter(
(x) => x.status === "commit" || x.status === "countdown"
).length;

const totalCommittedSol = rows.reduce((sum, x) => sum + safeNum(x.committed_sol, 0), 0);
const totalParticipants = rows.reduce((sum, x) => sum + safeInt(x.participants_count, 0), 0);
const maxParticipants = rows.reduce(
(max, x) => Math.max(max, safeInt(x.participants_count, 0)),
0
);

const launchesReachingMinRaise = rows.filter((x) => x.min_raise_reached).length;
const launchesHittingHardCap = rows.filter((x) => x.hard_cap_reached).length;
const builderTemplateLaunches = rows.filter((x) => x.is_builder_template).length;
const bondedLaunches = rows.filter((x) => x.has_builder_bond).length;
const structuredTeamLaunches = rows.filter((x) => x.has_team_structure).length;

return {
total_launches: totalLaunches,
commit_launches: commitLaunches,
countdown_launches: countdownLaunches,
live_launches: liveLaunches,
graduated_launches: graduatedLaunches,
failed_launches: failedLaunches,
failed_refunded_launches: refundedLaunches,
live_like_launches: liveLikeLaunches,
active_pipeline_launches: activePipelineLaunches,
total_committed_sol: Number(totalCommittedSol.toFixed(4)),
total_participants: totalParticipants,
average_participants:
totalLaunches > 0 ? Number((totalParticipants / totalLaunches).toFixed(2)) : 0,
max_participants: maxParticipants,
launches_reaching_min_raise: launchesReachingMinRaise,
launches_hitting_hard_cap: launchesHittingHardCap,
builder_template_launches: builderTemplateLaunches,
bonded_launches: bondedLaunches,
structured_team_launches: structuredTeamLaunches,
};
}

function buildBuilderStatsFromAggregateRow(row) {
return {
total_launches: safeInt(row?.total_launches, 0),
commit_launches: safeInt(row?.commit_launches, 0),
countdown_launches: safeInt(row?.countdown_launches, 0),
live_launches: safeInt(row?.live_launches, 0),
graduated_launches: safeInt(row?.graduated_launches, 0),
failed_launches: safeInt(row?.failed_launches, 0),
failed_refunded_launches: safeInt(row?.failed_refunded_launches, 0),
live_like_launches:
safeInt(row?.live_launches, 0) + safeInt(row?.graduated_launches, 0),
active_pipeline_launches:
safeInt(row?.commit_launches, 0) + safeInt(row?.countdown_launches, 0),
total_committed_sol: safeNum(row?.total_committed_sol, 0),
total_participants: safeInt(row?.total_participants, 0),
average_participants:
safeInt(row?.total_launches, 0) > 0
? Number(
(
safeInt(row?.total_participants, 0) /
safeInt(row?.total_launches, 0)
).toFixed(2)
)
: 0,
max_participants: safeInt(row?.max_participants, 0),
launches_reaching_min_raise: safeInt(row?.launches_reaching_min_raise, 0),
launches_hitting_hard_cap: safeInt(row?.launches_hitting_hard_cap, 0),
builder_template_launches: safeInt(row?.builder_template_launches, 0),
bonded_launches: safeInt(row?.bonded_launches, 0),
structured_team_launches: safeInt(row?.structured_team_launches, 0),
};
}

function makeProgressText(current, target, suffix = "") {
const value = safeNum(current, 0);
const goal = safeNum(target, 0);

if (goal <= 0) return "";

if (suffix === " SOL") {
return `${formatNumber(Math.min(value, goal), 1)} / ${formatNumber(goal, 1)}${suffix}`;
}

return `${formatCount(Math.min(value, goal))} / ${formatCount(goal)}${suffix}`;
}

function buildBuilderBadges(builder, stats) {
const score = safeNum(builder?.builder_score, 0);
const failedClosed =
safeInt(stats.failed_launches, 0) + safeInt(stats.failed_refunded_launches, 0);

const definitions = [
{
id: "profile_active",
label: "Profile Active",
description: "Builder profile is active on MSS.",
category: "identity",
tier: "base",
state: "good",
current: 1,
target: 1,
alwaysUnlocked: true,
progressText: "Active",
},
{
id: "trusted_builder",
label: "Trusted Builder",
description: "Reached the Moderate trust threshold.",
category: "trust",
tier: "bronze",
state: "warn",
current: score,
target: 55,
progressText: `${Math.min(Math.round(score), 55)} / 55`,
},
{
id: "strong_builder",
label: "Strong Builder",
description: "Reached the Strong trust threshold.",
category: "trust",
tier: "gold",
state: "good",
current: score,
target: 80,
progressText: `${Math.min(Math.round(score), 80)} / 80`,
},
{
id: "first_launch",
label: "First Launch",
description: "Created the first launch on MSS.",
category: "execution",
tier: "base",
state: "good",
current: stats.total_launches,
target: 1,
progressText: makeProgressText(stats.total_launches, 1),
},
{
id: "repeat_builder",
label: "Repeat Builder",
description: "Created at least 3 launches.",
category: "execution",
tier: "bronze",
state: "warn",
current: stats.total_launches,
target: 3,
progressText: makeProgressText(stats.total_launches, 3),
},
{
id: "launch_commander",
label: "Launch Commander",
description: "Created at least 5 launches.",
category: "execution",
tier: "gold",
state: "good",
current: stats.total_launches,
target: 5,
progressText: makeProgressText(stats.total_launches, 5),
},
{
id: "live_market",
label: "Live Market",
description: "Took a launch into live market state.",
category: "market",
tier: "bronze",
state: "good",
current: stats.live_like_launches,
target: 1,
progressText: makeProgressText(stats.live_like_launches, 1),
},
{
id: "graduated_launch",
label: "Graduated Launch",
description: "Completed the first graduation lifecycle.",
category: "market",
tier: "silver",
state: "good",
current: stats.graduated_launches,
target: 1,
progressText: makeProgressText(stats.graduated_launches, 1),
},
{
id: "graduation_streak",
label: "Graduation Streak",
description: "Completed 3 graduated launches.",
category: "market",
tier: "gold",
state: "good",
current: stats.graduated_launches,
target: 3,
progressText: makeProgressText(stats.graduated_launches, 3),
},
{
id: "community_pull",
label: "Community Pull",
description: "Attracted at least 25 total participants across launches.",
category: "traction",
tier: "silver",
state: "warn",
current: stats.total_participants,
target: 25,
progressText: makeProgressText(stats.total_participants, 25),
},
{
id: "capital_flow",
label: "Capital Flow",
description: "Drove 100 SOL or more in committed capital.",
category: "traction",
tier: "gold",
state: "good",
current: stats.total_committed_sol,
target: 100,
progressText: makeProgressText(stats.total_committed_sol, 100, " SOL"),
},
{
id: "hard_cap_hit",
label: "Hard Cap Hit",
description: "Reached hard cap on at least one launch.",
category: "execution",
tier: "silver",
state: "good",
current: stats.launches_hitting_hard_cap,
target: 1,
progressText: makeProgressText(stats.launches_hitting_hard_cap, 1),
},
{
id: "bonded_builder",
label: "Bonded Builder",
description: "Completed at least one bonded builder launch.",
category: "structure",
tier: "bronze",
state: "warn",
current: stats.bonded_launches,
target: 1,
progressText: makeProgressText(stats.bonded_launches, 1),
},
{
id: "structured_team",
label: "Structured Team",
description: "Used structured team allocation on a launch.",
category: "structure",
tier: "bronze",
state: "warn",
current: stats.structured_team_launches,
target: 1,
progressText: makeProgressText(stats.structured_team_launches, 1),
},
{
id: "active_pipeline",
label: "Active Pipeline",
description: "Has at least one launch in commit or countdown.",
category: "pipeline",
tier: "base",
state: "warn",
current: stats.active_pipeline_launches,
target: 1,
progressText: makeProgressText(stats.active_pipeline_launches, 1),
},
{
id: "clean_record",
label: "Clean Record",
description: "Reached 3 launches without any failed or refunded closures.",
category: "consistency",
tier: "gold",
state: "good",
current: stats.total_launches >= 3 && failedClosed === 0 ? 1 : 0,
target: 1,
progressText:
stats.total_launches >= 3 && failedClosed === 0
? "Unlocked"
: failedClosed > 0
? "Requires 3 launches with no failed closures"
: `${formatCount(Math.min(stats.total_launches, 3))} / 3 launches`,
},
];

return definitions.map((def, index) => {
const current = safeNum(def.current, 0);
const target = safeNum(def.target, 0);
const unlocked = Boolean(def.alwaysUnlocked || (target > 0 && current >= target));

return {
id: def.id,
label: def.label,
description: def.description,
category: def.category,
tier: def.tier,
state: unlocked ? def.state : "neutral",
unlocked,
progress_current: current,
progress_target: target || null,
progress_text: def.progressText,
order: index + 1,
};
});
}

function buildBuilderProfileData(builder, stats) {
const badges = buildBuilderBadges(builder, stats);
const achievements = badges.filter((badge) => badge.unlocked);
const lockedAchievements = badges.filter((badge) => !badge.unlocked);
const completionPct =
badges.length > 0
? Number(((achievements.length / badges.length) * 100).toFixed(1))
: 0;

const highlights = achievements
.filter((badge) => badge.id !== "profile_active")
.slice(0, 4)
.map((badge) => badge.label);

return {
profile_summary: {
profile_tier: buildProfileTier(builder?.builder_score),
trust_label: buildTrust(builder?.builder_score).label,
score: safeNum(builder?.builder_score, 0),
total_launches: safeInt(stats.total_launches, 0),
live_launches: safeInt(stats.live_launches, 0),
graduated_launches: safeInt(stats.graduated_launches, 0),
active_pipeline_launches: safeInt(stats.active_pipeline_launches, 0),
total_committed_sol: safeNum(stats.total_committed_sol, 0),
total_participants: safeInt(stats.total_participants, 0),
average_participants: safeNum(stats.average_participants, 0),
unlocked_badges: achievements.length,
total_badges: badges.length,
completion_pct: completionPct,
},
badge_summary: {
unlocked: achievements.length,
locked: lockedAchievements.length,
total: badges.length,
completion_pct: completionPct,
},
badges,
achievements,
highlights,
};
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

const emptyStats = buildBuilderStatsFromLaunches([]);
const profileData = buildBuilderProfileData(builder, emptyStats);

return res.json({
ok: true,
builder: shapeBuilder(builder, profileData),
});
} catch (err) {
console.error("POST /api/builders/create failed:", err);
return res.status(500).json({ ok: false, error: "internal server error" });
}
});

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

const stats = buildBuilderStatsFromLaunches(launches);
const profileData = buildBuilderProfileData(updated, stats);

return res.json({
ok: true,
builder: shapeBuilder(updated, profileData),
});
} catch (err) {
console.error("POST /api/builders/update failed:", err);
return res.status(500).json({ ok: false, error: "internal server error" });
}
});

router.get("/list", async (_req, res) => {
try {
const rows = await db.all(
`
SELECT
b.*,
COUNT(l.id) AS total_launches,
COALESCE(SUM(CASE WHEN l.status = 'commit' THEN 1 ELSE 0 END), 0) AS commit_launches,
COALESCE(SUM(CASE WHEN l.status = 'countdown' THEN 1 ELSE 0 END), 0) AS countdown_launches,
COALESCE(SUM(CASE WHEN l.status = 'live' THEN 1 ELSE 0 END), 0) AS live_launches,
COALESCE(SUM(CASE WHEN l.status = 'graduated' THEN 1 ELSE 0 END), 0) AS graduated_launches,
COALESCE(SUM(CASE WHEN l.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_launches,
COALESCE(SUM(CASE WHEN l.status = 'failed_refunded' THEN 1 ELSE 0 END), 0) AS failed_refunded_launches,
COALESCE(SUM(COALESCE(l.committed_sol, 0)), 0) AS total_committed_sol,
COALESCE(SUM(COALESCE(l.participants_count, 0)), 0) AS total_participants,
COALESCE(MAX(COALESCE(l.participants_count, 0)), 0) AS max_participants,
COALESCE(SUM(CASE
WHEN COALESCE(l.min_raise_sol, 0) > 0 AND COALESCE(l.committed_sol, 0) >= COALESCE(l.min_raise_sol, 0)
THEN 1 ELSE 0 END), 0) AS launches_reaching_min_raise,
COALESCE(SUM(CASE
WHEN COALESCE(l.hard_cap_sol, 0) > 0 AND COALESCE(l.committed_sol, 0) >= COALESCE(l.hard_cap_sol, 0)
THEN 1 ELSE 0 END), 0) AS launches_hitting_hard_cap,
COALESCE(SUM(CASE WHEN l.template = 'builder' THEN 1 ELSE 0 END), 0) AS builder_template_launches,
COALESCE(SUM(CASE WHEN COALESCE(l.builder_bond_sol, 0) > 0 THEN 1 ELSE 0 END), 0) AS bonded_launches,
COALESCE(SUM(CASE WHEN COALESCE(l.team_allocation_pct, 0) > 0 THEN 1 ELSE 0 END), 0) AS structured_team_launches
FROM builders b
LEFT JOIN launches l ON l.builder_id = b.id
GROUP BY b.id
ORDER BY b.builder_score DESC, total_launches DESC, b.id DESC
`
);

const builders = rows.map((row) => {
const stats = buildBuilderStatsFromAggregateRow(row);
const profileData = buildBuilderProfileData(row, stats);

return shapeBuilder(row, {
total_launches: safeInt(row.total_launches, 0),
profile_summary: profileData.profile_summary,
badge_summary: profileData.badge_summary,
badge_preview: profileData.achievements.slice(0, 4),
highlights: profileData.highlights,
});
});

return res.json({ ok: true, builders });
} catch (err) {
console.error("GET /api/builders/list failed:", err);
return res.status(500).json({ ok: false, error: "internal server error" });
}
});

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

const launchesRaw = await db.all(
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

const launches = launchesRaw.map(shapeLaunch);
const stats = buildBuilderStatsFromLaunches(launches);
const profileData = buildBuilderProfileData(builder, stats);

const totals = {
all: safeInt(stats.total_launches, 0),
commit: safeInt(stats.commit_launches, 0),
countdown: safeInt(stats.countdown_launches, 0),
live: safeInt(stats.live_launches, 0),
graduated: safeInt(stats.graduated_launches, 0),
failed: safeInt(stats.failed_launches, 0),
failed_refunded: safeInt(stats.failed_refunded_launches, 0),
};

return res.json({
ok: true,
builder: shapeBuilder(builder, profileData),
totals,
profile_summary: profileData.profile_summary,
badge_summary: profileData.badge_summary,
badges: profileData.badges,
achievements: profileData.achievements,
highlights: profileData.highlights,
launches,
});
} catch (err) {
console.error("GET /api/builders/:wallet failed:", err);
return res.status(500).json({ ok: false, error: "internal server error" });
}
});

export default router;
