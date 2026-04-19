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

function normalizeLaunchStatus(launch = null) {
if (!launch) return "";

const rawStatus = cleanText(launch.status, 64).toLowerCase();

if (
rawStatus === "commit" ||
rawStatus === "countdown" ||
rawStatus === "building" ||
rawStatus === "live" ||
rawStatus === "graduated" ||
rawStatus === "failed" ||
rawStatus === "failed_refunded"
) {
return rawStatus;
}

return rawStatus || "commit";
}

function shouldRevealContractAddress(status) {
const normalized = cleanText(status, 64).toLowerCase();
return normalized === "live" || normalized === "graduated";
}

function sanitizeLaunchForResponse(launch = null) {
if (!launch) return null;

const normalizedStatus = normalizeLaunchStatus(launch);
const revealContract = shouldRevealContractAddress(normalizedStatus);

return {
...launch,
status: normalizedStatus || launch.status || null,
contract_address: revealContract
? cleanText(launch.contract_address, 120) || null
: null,
mint_address: revealContract
? cleanText(launch.mint_address, 120) || null
: null,
reserved_mint_address: null,
reserved_mint_secret: null,
mint_reservation_status: revealContract
? cleanText(launch.mint_reservation_status, 64) || null
: null,
};
}

function sanitizeTokenForResponse(token = null, launch = null) {
if (!token) return null;

const normalizedStatus = normalizeLaunchStatus(launch);
const revealContract = shouldRevealContractAddress(normalizedStatus);

return {
...token,
mint_address: revealContract
? cleanText(token.mint_address, 120) || null
: null,
mint: revealContract
? cleanText(token.mint || token.mint_address, 120) || null
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

const sanitizedLaunch = sanitizeLaunchForResponse(payload?.launch || null);

return res.json({
ok: true,
success: true,
launch_id: launchId,
interval,
candles: payload?.candles || [],
launch: sanitizedLaunch,
token: sanitizeTokenForResponse(payload?.token || null, sanitizedLaunch),
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

const sanitizedLaunch = sanitizeLaunchForResponse(payload?.launch || null);

return res.json({
ok: true,
success: true,
launch_id: launchId,
trades: payload?.trades || [],
launch: sanitizedLaunch,
token: sanitizeTokenForResponse(payload?.token || null, sanitizedLaunch),
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

const sanitizedLaunch = sanitizeLaunchForResponse(payload?.launch || null);

return res.json({
ok: true,
success: true,
launch_id: launchId,
stats: payload?.stats || {},
launch: sanitizedLaunch,
token: sanitizeTokenForResponse(payload?.token || null, sanitizedLaunch),
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

const sanitizedLaunch = sanitizeLaunchForResponse(payload?.launch || null);

return res.json({
ok: true,
success: true,
launch_id: launchId,
interval,
launch: sanitizedLaunch,
token: sanitizeTokenForResponse(payload?.token || null, sanitizedLaunch),
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
