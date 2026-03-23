import express from "express";
import launcherDb from "../db/index.js";
import {
getChartCandles,
getChartTrades,
getChartStats,
getChartSnapshot,
} from "../services/chart-service.js";

const router = express.Router();

const ALLOWED_INTERVALS = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);

function clampInt(value, fallback, min, max) {
const num = Number.parseInt(value, 10);
if (!Number.isFinite(num)) return fallback;
return Math.min(max, Math.max(min, num));
}

function parseLaunchId(raw) {
const launchId = Number.parseInt(String(raw || ""), 10);
if (!Number.isFinite(launchId) || launchId <= 0) {
return null;
}
return launchId;
}

function normalizeInterval(raw) {
const interval = String(raw || "1m").trim();
if (!ALLOWED_INTERVALS.has(interval)) {
return "1m";
}
return interval;
}

function cleanWallet(raw) {
return String(raw ?? "").trim().slice(0, 120);
}

router.get("/:launchId/candles", async (req, res) => {
try {
const launchId = parseLaunchId(req.params.launchId);
const interval = normalizeInterval(req.query.interval);
const limit = clampInt(req.query.limit, 120, 1, 500);

if (!launchId) {
return res.status(400).json({
ok: false,
error: "Invalid launch id",
});
}

const payload = await getChartCandles({
db: launcherDb,
launchId,
interval,
limit,
});

return res.json({
ok: true,
launch_id: launchId,
interval,
candles: payload?.candles || [],
});
} catch (error) {
console.error("GET /api/chart/:launchId/candles failed", error);
return res.status(500).json({
ok: false,
error: error?.message || "Failed to fetch candles",
});
}
});

router.get("/:launchId/trades", async (req, res) => {
try {
const launchId = parseLaunchId(req.params.launchId);
const limit = clampInt(req.query.limit, 50, 1, 200);

if (!launchId) {
return res.status(400).json({
ok: false,
error: "Invalid launch id",
});
}

const payload = await getChartTrades({
db: launcherDb,
launchId,
limit,
});

return res.json({
ok: true,
launch_id: launchId,
trades: payload?.trades || [],
});
} catch (error) {
console.error("GET /api/chart/:launchId/trades failed", error);
return res.status(500).json({
ok: false,
error: error?.message || "Failed to fetch trades",
});
}
});

router.get("/:launchId/stats", async (req, res) => {
try {
const launchId = parseLaunchId(req.params.launchId);
const wallet = cleanWallet(req.query.wallet);

if (!launchId) {
return res.status(400).json({
ok: false,
error: "Invalid launch id",
});
}

const payload = await getChartStats({
db: launcherDb,
launchId,
wallet,
});

return res.json({
ok: true,
launch_id: launchId,
stats: payload?.stats || {},
launch: payload?.launch || null,
token: payload?.token || null,
pool: payload?.pool || null,
wallet: payload?.wallet || null,
cassie: payload?.cassie || null,
});
} catch (error) {
console.error("GET /api/chart/:launchId/stats failed", error);
return res.status(500).json({
ok: false,
error: error?.message || "Failed to fetch chart stats",
});
}
});

router.get("/:launchId/snapshot", async (req, res) => {
try {
const launchId = parseLaunchId(req.params.launchId);
const interval = normalizeInterval(req.query.interval);
const candleLimit = clampInt(req.query.candle_limit, 120, 1, 500);
const tradeLimit = clampInt(req.query.trade_limit, 50, 1, 200);
const wallet = cleanWallet(req.query.wallet);

if (!launchId) {
return res.status(400).json({
ok: false,
error: "Invalid launch id",
});
}

const payload = await getChartSnapshot({
db: launcherDb,
launchId,
interval,
candleLimit,
tradeLimit,
wallet,
});

return res.json({
ok: true,
launch_id: launchId,
interval,
launch: payload?.launch || null,
token: payload?.token || null,
pool: payload?.pool || null,
wallet: payload?.wallet || null,
stats: payload?.stats || {},
candles: payload?.candles || [],
trades: payload?.trades || [],
cassie: payload?.cassie || null,
});
} catch (error) {
console.error("GET /api/chart/:launchId/snapshot failed", error);
return res.status(500).json({
ok: false,
error: error?.message || "Failed to fetch chart snapshot",
});
}
});

export default router;
