import express from "express";
import launcherDb from "../db/index.js";
import {
getChartCandles,
getChartTrades,
getChartStats,
getChartSnapshot,
} from "../services/chart-service.js";

const router = express.Router();

function clampInt(value, fallback, min, max) {
const num = Number.parseInt(value, 10);
if (!Number.isFinite(num)) return fallback;
return Math.min(max, Math.max(min, num));
}

router.get("/:launchId/candles", async (req, res) => {
try {
const { launchId } = req.params;
const interval = String(req.query.interval || "1m");
const limit = clampInt(req.query.limit, 120, 1, 500);

const payload = await getChartCandles({
db: launcherDb,
launchId,
interval,
limit,
});

return res.json({
ok: true,
launch_id: Number(launchId),
interval,
candles: payload.candles || [],
});
} catch (error) {
console.error("GET /api/chart/:launchId/candles failed", error);
return res.status(500).json({
ok: false,
error: "Failed to fetch candles",
});
}
});

router.get("/:launchId/trades", async (req, res) => {
try {
const { launchId } = req.params;
const limit = clampInt(req.query.limit, 50, 1, 200);

const payload = await getChartTrades({
db: launcherDb,
launchId,
limit,
});

return res.json({
ok: true,
launch_id: Number(launchId),
trades: payload.trades || [],
});
} catch (error) {
console.error("GET /api/chart/:launchId/trades failed", error);
return res.status(500).json({
ok: false,
error: "Failed to fetch trades",
});
}
});

router.get("/:launchId/stats", async (req, res) => {
try {
const { launchId } = req.params;

const payload = await getChartStats({
db: launcherDb,
launchId,
});

return res.json({
ok: true,
launch_id: Number(launchId),
stats: payload.stats || {},
});
} catch (error) {
console.error("GET /api/chart/:launchId/stats failed", error);
return res.status(500).json({
ok: false,
error: "Failed to fetch chart stats",
});
}
});

router.get("/:launchId/snapshot", async (req, res) => {
try {
const { launchId } = req.params;
const interval = String(req.query.interval || "1m");
const candleLimit = clampInt(req.query.candle_limit, 120, 1, 500);
const tradeLimit = clampInt(req.query.trade_limit, 50, 1, 200);

const payload = await getChartSnapshot({
db: launcherDb,
launchId,
interval,
candleLimit,
tradeLimit,
});

return res.json({
ok: true,
launch_id: Number(launchId),
launch: payload.launch || null,
stats: payload.stats || {},
candles: payload.candles || [],
trades: payload.trades || [],
});
} catch (error) {
console.error("GET /api/chart/:launchId/snapshot failed", error);
return res.status(500).json({
ok: false,
error: "Failed to fetch chart snapshot",
});
}
});

export default router;