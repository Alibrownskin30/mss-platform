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

function cleanText(value, max = 200) {
return String(value ?? "").trim().slice(0, max);
}

function parseDbTime(value) {
if (!value) return null;
const raw = String(value).trim();
if (!raw) return null;

const hasExplicitTimezone =
/z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw);

if (!hasExplicitTimezone && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
const sqliteUtc = Date.parse(raw.replace(" ", "T") + "Z");
return Number.isFinite(sqliteUtc) ? sqliteUtc : null;
}

const direct = Date.parse(raw);
return Number.isFinite(direct) ? direct : null;
}

function inferRevealStatus(launch = null) {
if (!launch) return "";

const rawStatus = cleanText(launch.status, 64).toLowerCase();
if (rawStatus === "graduated") return "graduated";
if (rawStatus === "live") return "live";

const contractAddress = cleanText(
launch.contract_address || launch.mint_address,
200
);
const reservationStatus = cleanText(launch.mint_reservation_status, 64).toLowerCase();
const liveAtMs = parseDbTime(launch.live_at || launch.countdown_ends_at);

if (contractAddress && reservationStatus === "finalized") return "live";
if (contractAddress && liveAtMs && Date.now() >= liveAtMs) return "live";

return rawStatus;
}

function sanitizeLaunchForResponse(launch = null) {
if (!launch) return null;

const inferredStatus = inferRevealStatus(launch);
const revealContract = inferredStatus === "live" || inferredStatus === "graduated";

return {
...launch,
status: inferredStatus || launch.status || null,
contract_address: revealContract ? launch.contract_address || null : null,
mint_address: revealContract ? launch.mint_address || null : null,
reserved_mint_address: null,
reserved_mint_secret: null,
mint_reservation_status: revealContract
? cleanText(launch.mint_reservation_status, 64) || null
: null,
};
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
success: true,
launch_id: launchId,
interval,
candles: payload?.candles || [],
launch: sanitizeLaunchForResponse(payload?.launch || null),
token: payload?.token || null,
pool: payload?.pool || null,
stats: payload?.stats || {},
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
success: true,
launch_id: launchId,
trades: payload?.trades || [],
launch: sanitizeLaunchForResponse(payload?.launch || null),
token: payload?.token || null,
pool: payload?.pool || null,
stats: payload?.stats || {},
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
success: true,
launch_id: launchId,
stats: payload?.stats || {},
launch: sanitizeLaunchForResponse(payload?.launch || null),
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
success: true,
launch_id: launchId,
interval,
launch: sanitizeLaunchForResponse(payload?.launch || null),
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
