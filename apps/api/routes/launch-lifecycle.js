import express from "express";
import {
getLiquidityLifecycle,
syncLiquidityLifecycle,
buildGraduationPlanForLaunch,
markLaunchGraduatedLifecycle,
} from "../services/launcher/liquidityLifecycle.js";

const router = express.Router();

function parseLaunchId(raw) {
const id = Number.parseInt(String(raw || ""), 10);
return Number.isFinite(id) && id > 0 ? id : null;
}

router.get("/:launchId", async (req, res) => {
try {
const launchId = parseLaunchId(req.params.launchId);

if (!launchId) {
return res.status(400).json({
ok: false,
error: "Invalid launch id",
});
}

const lifecycle = await getLiquidityLifecycle(launchId);

return res.json({
ok: true,
launch_id: launchId,
lifecycle,
});
} catch (error) {
console.error("GET /api/launch-lifecycle/:launchId failed", error);
return res.status(500).json({
ok: false,
error: error?.message || "Failed to fetch launch lifecycle",
});
}
});

router.post("/:launchId/sync", async (req, res) => {
try {
const launchId = parseLaunchId(req.params.launchId);

if (!launchId) {
return res.status(400).json({
ok: false,
error: "Invalid launch id",
});
}

const lifecycle = await syncLiquidityLifecycle(launchId);

return res.json({
ok: true,
launch_id: launchId,
lifecycle,
});
} catch (error) {
console.error("POST /api/launch-lifecycle/:launchId/sync failed", error);
return res.status(500).json({
ok: false,
error: error?.message || "Failed to sync launch lifecycle",
});
}
});

router.get("/:launchId/graduation-plan", async (req, res) => {
try {
const launchId = parseLaunchId(req.params.launchId);

if (!launchId) {
return res.status(400).json({
ok: false,
error: "Invalid launch id",
});
}

const plan = await buildGraduationPlanForLaunch(launchId);

return res.json({
ok: true,
launch_id: launchId,
plan,
});
} catch (error) {
console.error("GET /api/launch-lifecycle/:launchId/graduation-plan failed", error);
return res.status(500).json({
ok: false,
error: error?.message || "Failed to build graduation plan",
});
}
});

router.post("/:launchId/mark-graduated", async (req, res) => {
try {
const launchId = parseLaunchId(req.params.launchId);

if (!launchId) {
return res.status(400).json({
ok: false,
error: "Invalid launch id",
});
}

const lifecycle = await markLaunchGraduatedLifecycle({
launchId,
reason: req.body?.reason || "manual",
raydiumPoolId: req.body?.raydiumPoolId || "",
raydiumMigrationTx: req.body?.raydiumMigrationTx || "",
lockTx: req.body?.lockTx || "",
raydiumLpTokens: req.body?.raydiumLpTokens || "",
mssLockedLpAmount: req.body?.mssLockedLpAmount || "",
lockExpiresAt: req.body?.lockExpiresAt || "",
});

return res.json({
ok: true,
launch_id: launchId,
lifecycle,
});
} catch (error) {
console.error("POST /api/launch-lifecycle/:launchId/mark-graduated failed", error);
return res.status(500).json({
ok: false,
error: error?.message || "Failed to mark launch graduated lifecycle",
});
}
});

export default router;
