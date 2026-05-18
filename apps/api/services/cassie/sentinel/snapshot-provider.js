import { db as scannerDb } from "../../../db.js";
import { SENTINEL_MODE } from "./config.js";
import { listOpenPositions } from "./position-store.js";
import {
buildSentinelSnapshotFromSecurityScan,
normalizeSentinelSnapshot,
normalizeSentinelSnapshots,
isUsableSentinelSnapshot,
summarizeSentinelSnapshot,
} from "./snapshot-normalizer.js";

export const DEFAULT_SNAPSHOT_PROVIDER_LIMIT = 100;
export const DEFAULT_SNAPSHOT_PROVIDER_MAX_AGE_MINUTES = 30;
export const DEFAULT_OPEN_POSITION_LIMIT = 250;
export const DEFAULT_OPEN_POSITION_MAX_AGE_MINUTES = 7 * 24 * 60;
export const DEFAULT_PRICE_FETCH_TIMEOUT_MS = 4500;
export const DEFAULT_DEXSCREENER_BATCH_SIZE = 30;
export const DEFAULT_JUPITER_BATCH_SIZE = 50;

export const DEFAULT_DISCOVERY_POOL_LIMIT = 750;
export const DEFAULT_DISCOVERY_MAX_AGE_MINUTES = 14 * 24 * 60;
export const DEFAULT_DISCOVERY_LIMIT_PER_UNIVERSE = 40;

export const SENTINEL_DISCOVERY_UNIVERSE = Object.freeze({
RECENT: "recent_scanner_flow",
NEW_LOW_CAPS: "new_low_caps",
LIQUIDITY_RISERS: "liquidity_risers",
UNUSUAL_VOLUME: "unusual_volume",
MOMENTUM_MOVERS: "momentum_movers",
CLEAN_RECLAIMS: "clean_reclaims",
STRUCTURAL_CANDIDATES: "structural_candidates",
OPEN_POSITIONS: "open_positions",
RISK_MONITOR: "risk_monitor",
});

export const DEFAULT_DISCOVERY_UNIVERSES = Object.freeze([
SENTINEL_DISCOVERY_UNIVERSE.RECENT,
SENTINEL_DISCOVERY_UNIVERSE.NEW_LOW_CAPS,
SENTINEL_DISCOVERY_UNIVERSE.LIQUIDITY_RISERS,
SENTINEL_DISCOVERY_UNIVERSE.UNUSUAL_VOLUME,
SENTINEL_DISCOVERY_UNIVERSE.MOMENTUM_MOVERS,
SENTINEL_DISCOVERY_UNIVERSE.CLEAN_RECLAIMS,
SENTINEL_DISCOVERY_UNIVERSE.STRUCTURAL_CANDIDATES,
SENTINEL_DISCOVERY_UNIVERSE.OPEN_POSITIONS,
SENTINEL_DISCOVERY_UNIVERSE.RISK_MONITOR,
]);

const DEFAULT_DEXSCREENER_TOKENS_URL =
"https://api.dexscreener.com/tokens/v1/solana";

const DEFAULT_JUPITER_PRICE_URLS = [
"https://api.jup.ag/price/v3",
"https://lite-api.jup.ag/price/v3",
];

function envValue(key, fallback = null) {
if (typeof process === "undefined" || !process.env) return fallback;
return process.env[key] ?? fallback;
}

function cleanText(value, max = 255) {
return String(value ?? "").trim().slice(0, max);
}

function toFloat(value, fallback = null) {
if (typeof value === "number") {
return Number.isFinite(value) ? value : fallback;
}

if (value == null) return fallback;

const raw = String(value).trim();
if (!raw) return fallback;

const cleaned = raw.replace(/,/g, "");
const direct = Number.parseFloat(cleaned);
if (Number.isFinite(direct)) return direct;

const match = cleaned.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i);
if (!match) return fallback;

const parsed = Number.parseFloat(match[0]);
return Number.isFinite(parsed) ? parsed : fallback;
}

function toInt(value, fallback = null) {
const num = Number.parseInt(value, 10);
return Number.isFinite(num) ? num : fallback;
}

function toBool(value, fallback = false) {
if (typeof value === "boolean") return value;
const normalized = cleanText(value, 16).toLowerCase();

if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
if (["false", "0", "no", "n", "off"].includes(normalized)) return false;

return fallback;
}

function safeJsonParse(value, fallback = null) {
if (value == null) return fallback;
if (typeof value === "object") return value;

const raw = String(value).trim();
if (!raw) return fallback;

try {
return JSON.parse(raw);
} catch {
return fallback;
}
}

function isPlainObject(value) {
return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getPath(source, path) {
if (!source || typeof source !== "object") return undefined;

return String(path || "")
.split(".")
.filter(Boolean)
.reduce((acc, key) => (acc == null ? undefined : acc[key]), source);
}

function firstValue(source, paths = [], fallback = undefined) {
for (const path of paths) {
const value = getPath(source, path);
if (value != null && value !== "") return value;
}

return fallback;
}

function firstText(source, paths = [], fallback = "") {
const value = firstValue(source, paths, fallback);
return cleanText(value, 500);
}

function firstNumber(source, paths = [], fallback = null) {
for (const path of paths) {
const value = getPath(source, path);
const parsed = toFloat(value, null);
if (parsed != null && Number.isFinite(parsed)) return parsed;
}

return fallback;
}

function firstNumberFromSources(sources = [], paths = [], fallback = null) {
for (const source of sources) {
if (!source || typeof source !== "object") continue;
const parsed = firstNumber(source, paths, null);
if (parsed != null && Number.isFinite(parsed)) return parsed;
}

return fallback;
}

function firstTextFromSources(sources = [], paths = [], fallback = "") {
for (const source of sources) {
if (!source || typeof source !== "object") continue;
const parsed = firstText(source, paths, "");
if (parsed) return parsed;
}

return fallback;
}

function positiveNumber(value, fallback = null) {
const num = toFloat(value, null);
if (num != null && Number.isFinite(num) && num > 0) return num;
return fallback;
}

function zeroOrPositive(value, fallback = null) {
const num = toFloat(value, null);
if (num != null && Number.isFinite(num) && num >= 0) return num;
return fallback;
}

function clampScore(value, fallback = 0) {
const num = toFloat(value, fallback);
return Math.max(0, Math.min(100, Number.isFinite(num) ? num : fallback));
}

function resolveExecutionMode(...values) {
for (const value of values) {
const mode = cleanText(value, 64).toLowerCase();
if (mode) return mode;
}

return SENTINEL_MODE.PAPER;
}

function normalizeLimit(value, fallback = DEFAULT_SNAPSHOT_PROVIDER_LIMIT) {
return Math.max(1, Math.min(2000, toInt(value, fallback) || fallback));
}

function normalizeMaxAgeMinutes(
value,
fallback = DEFAULT_SNAPSHOT_PROVIDER_MAX_AGE_MINUTES
) {
return Math.max(1, toInt(value, fallback) || fallback);
}

function normalizeOpenPositionLimit(
value,
fallback = DEFAULT_OPEN_POSITION_LIMIT
) {
return Math.max(1, Math.min(1000, toInt(value, fallback) || fallback));
}

function normalizeBatchSize(value, fallback, max) {
return Math.max(1, Math.min(max, toInt(value, fallback) || fallback));
}

function normalizeDiscoveryLimit(value, fallback = DEFAULT_DISCOVERY_POOL_LIMIT) {
return Math.max(1, Math.min(2500, toInt(value, fallback) || fallback));
}

function normalizeDiscoveryLimitPerUniverse(
value,
fallback = DEFAULT_DISCOVERY_LIMIT_PER_UNIVERSE
) {
return Math.max(1, Math.min(250, toInt(value, fallback) || fallback));
}

function rowTimestampMs(row = {}) {
const candidates = [
row.updated_at,
row.last_updated_at,
row.last_scanned_at,
row.scanned_at,
row.created_at,
row.last_seen_at,
row.detected_at,
row.timestamp,
row.ts,
];

for (const value of candidates) {
if (value == null) continue;
const parsed = new Date(value).getTime();
if (!Number.isNaN(parsed)) return parsed;
}

return 0;
}

function isRowFreshEnough(
row = {},
maxAgeMinutes = DEFAULT_SNAPSHOT_PROVIDER_MAX_AGE_MINUTES
) {
const safeMaxAgeMinutes = normalizeMaxAgeMinutes(maxAgeMinutes);
const ts = rowTimestampMs(row);

if (!ts) return true;

const ageMs = Date.now() - ts;
return ageMs <= safeMaxAgeMinutes * 60 * 1000;
}

function sortRowsNewestFirst(rows = []) {
return [...(Array.isArray(rows) ? rows : [])].sort(
(a, b) => rowTimestampMs(b) - rowTimestampMs(a)
);
}

function extractJsonPayload(row = {}, keys = []) {
for (const key of keys) {
if (!(key in row)) continue;

const parsed = safeJsonParse(row[key], null);
if (parsed && typeof parsed === "object") return parsed;
}

return null;
}

function extractMintFromRow(row = {}) {
return (
firstText(row, [
"mint",
"token_id",
"mint_address",
"address",
"tokenMint",
"token_mint",
"base_mint",
"baseMint",
]) || null
);
}

function getStructuredPayloads(row = {}) {
const rawScan =
extractJsonPayload(row, [
"scan_json",
"scan_result_json",
"snapshot_json",
"payload_json",
"security_scan_json",
"result_json",
"raw_json",
"raw",
]) || {};

const token =
extractJsonPayload(row, [
"token_json",
"token",
"token_payload_json",
"token_data_json",
]) || {};

const market =
extractJsonPayload(row, [
"market_json",
"market",
"market_payload_json",
"market_data_json",
]) || {};

const holders =
extractJsonPayload(row, [
"holders_json",
"holders",
"holders_payload_json",
]) || {};

const concentration =
extractJsonPayload(row, ["concentration_json", "concentration"]) || {};

const activity =
extractJsonPayload(row, [
"activity_json",
"activity",
"cluster_json",
"clusters_json",
]) || {};

const securityModel =
extractJsonPayload(row, [
"security_model_json",
"security_json",
"securityModel",
"security_model",
]) || {};

const cassie =
extractJsonPayload(row, [
"cassie_json",
"cassie",
"cassie_payload_json",
]) || {};

const trend = extractJsonPayload(row, ["trend_json", "trend"]) || {};

return {
rawScan: isPlainObject(rawScan) ? rawScan : {},
token: isPlainObject(token) ? token : {},
market: isPlainObject(market) ? market : {},
holders: isPlainObject(holders) ? holders : {},
concentration: isPlainObject(concentration) ? concentration : {},
activity: isPlainObject(activity) ? activity : {},
securityModel: isPlainObject(securityModel) ? securityModel : {},
cassie: isPlainObject(cassie) ? cassie : {},
trend: isPlainObject(trend) ? trend : {},
};
}

function resolveMarketPriceUsd({
row = {},
rawScan = {},
token = {},
market = {},
} = {}) {
return firstNumberFromSources(
[
row,
market,
rawScan,
rawScan.market,
rawScan.raw,
rawScan.raw?.market,
token,
rawScan.token,
],
[
"price_usd",
"priceUsd",
"price",
"current_price_usd",
"currentPriceUsd",
"current_price",
"currentPrice",
"price_now",
"priceNow",
"market_price_usd",
"marketPriceUsd",
"token_price_usd",
"tokenPriceUsd",
"usd_price",
"usdPrice",
"market.price_usd",
"market.priceUsd",
"market.price",
"market.current_price_usd",
"market.currentPriceUsd",
"market.current_price",
"market.currentPrice",
"market.price_now",
"market.priceNow",
"market.token_price_usd",
"market.tokenPriceUsd",
"market.usd_price",
"market.usdPrice",
"market.usd.price",
"market.price.usd",
"raw.price_usd",
"raw.priceUsd",
"raw.current_price_usd",
"raw.currentPriceUsd",
"raw.price_now",
"raw.priceNow",
"raw.market.price_usd",
"raw.market.priceUsd",
"raw.market.current_price_usd",
"raw.market.currentPriceUsd",
"raw.market.price_now",
"raw.market.priceNow",
],
null
);
}

function resolveMarketcapUsd({ row = {}, rawScan = {}, market = {} } = {}) {
return firstNumberFromSources(
[row, market, rawScan, rawScan.market, rawScan.raw, rawScan.raw?.market],
[
"marketcap_usd",
"marketcapUsd",
"market_cap_usd",
"marketCapUsd",
"mcap_usd",
"mcapUsd",
"fdv_usd",
"fdvUsd",
"fdv",
"market.marketcap_usd",
"market.marketcapUsd",
"market.market_cap_usd",
"market.marketCapUsd",
"market.mcap_usd",
"market.mcapUsd",
"market.fdv_usd",
"market.fdvUsd",
"market.fdv",
"raw.marketcap_usd",
"raw.marketcapUsd",
"raw.market.marketcap_usd",
"raw.market.marketcapUsd",
"raw.market.mcapUsd",
"raw.market.fdv",
],
null
);
}

function resolveLiquidityUsd({ row = {}, rawScan = {}, market = {} } = {}) {
return firstNumberFromSources(
[row, market, rawScan, rawScan.market, rawScan.raw, rawScan.raw?.market],
[
"liquidity_usd",
"liquidityUsd",
"liq_usd",
"liqUsd",
"market_liquidity_usd",
"marketLiquidityUsd",
"avg_market_liquidity_usd",
"avgMarketLiquidityUsd",
"market.liquidity_usd",
"market.liquidityUsd",
"market.liquidity.usd",
"raw.liquidity_usd",
"raw.liquidityUsd",
"raw.market.liquidity_usd",
"raw.market.liquidityUsd",
"raw.market.liquidity.usd",
],
null
);
}

function resolveVolumeUsd({ row = {}, rawScan = {}, market = {}, trend = {} } = {}) {
return firstNumberFromSources(
[row, market, trend, rawScan, rawScan.market, rawScan.trend, rawScan.raw, rawScan.raw?.market],
[
"volume_usd",
"volumeUsd",
"volume_24h_usd",
"volume24hUsd",
"volume24h",
"volume_h24",
"volumeH24",
"recent_volume_usd",
"recentVolumeUsd",
"market.volume_usd",
"market.volumeUsd",
"market.volume24h",
"market.volume_24h_usd",
"market.volume.h24",
"trend.volume_usd",
"trend.volumeUsd",
"trend.volume_24h_usd",
"raw.volume_usd",
"raw.volumeUsd",
"raw.market.volume_usd",
"raw.market.volumeUsd",
"raw.market.volume.h24",
],
null
);
}

function resolveVolumeChangePct({
row = {},
rawScan = {},
market = {},
trend = {},
activity = {},
} = {}) {
return firstNumberFromSources(
[row, trend, activity, market, rawScan, rawScan.trend, rawScan.activity, rawScan.market],
[
"volume_change_pct",
"volumeChangePct",
"volume_change_24h_pct",
"volumeChange24hPct",
"volume_delta_pct",
"volumeDeltaPct",
"unusual_volume_pct",
"unusualVolumePct",
"market.volume_change_pct",
"market.volumeChangePct",
"trend.volume_change_pct",
"trend.volumeChangePct",
"activity.volume_change_pct",
"activity.volumeChangePct",
],
null
);
}

function resolveVolumeAnomalyScore({
row = {},
rawScan = {},
trend = {},
activity = {},
securityModel = {},
} = {}) {
return firstNumberFromSources(
[row, trend, activity, securityModel, rawScan, rawScan.trend, rawScan.activity],
[
"volume_anomaly_score",
"volumeAnomalyScore",
"unusual_volume_score",
"unusualVolumeScore",
"relative_volume_score",
"relativeVolumeScore",
"trend.volume_anomaly_score",
"trend.volumeAnomalyScore",
"activity.volume_anomaly_score",
"activity.volumeAnomalyScore",
"securityModel.volumeAnomaly.score",
],
null
);
}

function resolveLiquidityChangePct({
row = {},
rawScan = {},
market = {},
trend = {},
activity = {},
} = {}) {
return firstNumberFromSources(
[row, market, trend, activity, rawScan, rawScan.market, rawScan.trend],
[
"liquidity_change_pct",
"liquidityChangePct",
"liquidity_change_24h_pct",
"liquidityChange24hPct",
"liquidity_delta_pct",
"liquidityDeltaPct",
"lp_growth_pct",
"lpGrowthPct",
"market.liquidity_change_pct",
"market.liquidityChangePct",
"trend.liquidity_change_pct",
"trend.liquidityChangePct",
],
null
);
}

function resolvePriceChangePct({
row = {},
rawScan = {},
market = {},
trend = {},
} = {}) {
return firstNumberFromSources(
[row, market, trend, rawScan, rawScan.market, rawScan.trend],
[
"price_change_pct",
"priceChangePct",
"price_change_24h_pct",
"priceChange24hPct",
"price_change_1h_pct",
"priceChange1hPct",
"market.price_change_pct",
"market.priceChangePct",
"market.priceChange.h24",
"market.priceChange.h1",
"trend.price_change_pct",
"trend.priceChangePct",
],
null
);
}

function resolveTxnCount24h({ row = {}, rawScan = {}, market = {}, activity = {} } = {}) {
const buys = firstNumberFromSources(
[row, market, activity, rawScan, rawScan.market, rawScan.activity],
[
"buys_24h",
"buys24h",
"txns.h24.buys",
"market.txns.h24.buys",
"activity.buys_24h",
"activity.buys24h",
],
null
);

const sells = firstNumberFromSources(
[row, market, activity, rawScan, rawScan.market, rawScan.activity],
[
"sells_24h",
"sells24h",
"txns.h24.sells",
"market.txns.h24.sells",
"activity.sells_24h",
"activity.sells24h",
],
null
);

const direct = firstNumberFromSources(
[row, market, activity, rawScan, rawScan.market, rawScan.activity],
[
"txns_24h",
"txns24h",
"trade_count_24h",
"tradeCount24h",
"market.txns_24h",
"market.txns24h",
"activity.txns_24h",
"activity.txns24h",
],
null
);

if (direct != null) return direct;
if (buys != null || sells != null) {
return Math.max(0, toFloat(buys, 0) || 0) + Math.max(0, toFloat(sells, 0) || 0);
}

return null;
}

function resolveFdUsd({ row = {}, rawScan = {}, market = {} } = {}) {
return firstNumberFromSources(
[row, market, rawScan, rawScan.market, rawScan.raw, rawScan.raw?.market],
[
"fdv",
"fdv_usd",
"fdvUsd",
"fully_diluted_value_usd",
"fullyDilutedValueUsd",
"market.fdv",
"market.fdv_usd",
"market.fdvUsd",
"raw.fdv",
"raw.fdvUsd",
"raw.market.fdv",
"raw.market.fdvUsd",
],
null
);
}

function resolveSpreadBps({ row = {}, rawScan = {}, market = {} } = {}) {
return firstNumberFromSources(
[row, market, rawScan, rawScan.market, rawScan.raw, rawScan.raw?.market],
[
"spread_bps",
"spreadBps",
"spread_bps_value",
"market.spread_bps",
"market.spreadBps",
"raw.spread_bps",
"raw.spreadBps",
"raw.market.spread_bps",
"raw.market.spreadBps",
],
null
);
}

function resolvePriceImpactBps({
row = {},
rawScan = {},
market = {},
} = {}) {
return firstNumberFromSources(
[row, market, rawScan, rawScan.market, rawScan.raw, rawScan.raw?.market],
[
"price_impact_bps",
"priceImpactBps",
"market.price_impact_bps",
"market.priceImpactBps",
"raw.price_impact_bps",
"raw.priceImpactBps",
"raw.market.price_impact_bps",
"raw.market.priceImpactBps",
],
null
);
}

function resolveCurrentValueUsd({ row = {}, rawScan = {} } = {}) {
return firstNumberFromSources(
[row, rawScan, rawScan.raw, rawScan.market, rawScan.raw?.market],
[
"current_value_usd",
"currentValueUsd",
"position_value_usd",
"positionValueUsd",
"market_value_usd",
"marketValueUsd",
"raw.current_value_usd",
"raw.currentValueUsd",
"raw.position_value_usd",
"raw.positionValueUsd",
"market.current_value_usd",
"market.currentValueUsd",
"market.position_value_usd",
"market.positionValueUsd",
],
null
);
}

function resolveCurrentMultiple({ row = {}, rawScan = {} } = {}) {
return firstNumberFromSources(
[row, rawScan, rawScan.raw, rawScan.market, rawScan.raw?.market],
[
"current_multiple",
"currentMultiple",
"multiple",
"pnl_multiple",
"pnlMultiple",
"performance_multiple",
"performanceMultiple",
"raw.current_multiple",
"raw.currentMultiple",
"market.current_multiple",
"market.currentMultiple",
],
null
);
}

function extractScanObjectFromRow(row = {}) {
const mint = extractMintFromRow(row);
const {
rawScan,
token,
market,
holders,
concentration,
activity,
securityModel,
cassie,
trend,
} = getStructuredPayloads(row);

const rawToken = isPlainObject(rawScan.token) ? rawScan.token : {};
const rawMarket = isPlainObject(rawScan.market) ? rawScan.market : {};
const rawHolders = isPlainObject(rawScan.holders) ? rawScan.holders : {};
const rawConcentration = isPlainObject(rawScan.concentration)
? rawScan.concentration
: {};
const rawActivity = isPlainObject(rawScan.activity) ? rawScan.activity : {};
const rawSecurityModel = isPlainObject(rawScan.securityModel)
? rawScan.securityModel
: isPlainObject(rawScan.security_model)
? rawScan.security_model
: {};
const rawCassie = isPlainObject(rawScan.cassie) ? rawScan.cassie : {};
const rawTrend = isPlainObject(rawScan.trend) ? rawScan.trend : {};

const resolvedMint =
firstTextFromSources(
[row, rawScan, rawToken, token],
[
"mint",
"mint_address",
"token_id",
"address",
"tokenMint",
"token_mint",
"base_mint",
"baseMint",
],
""
) ||
mint ||
null;

const executionMode = resolveExecutionMode(
rawScan.execution_mode,
row.execution_mode,
row.mode
);

const priceUsd = resolveMarketPriceUsd({ row, rawScan, token, market });
const marketcapUsd = resolveMarketcapUsd({ row, rawScan, market });
const liquidityUsd = resolveLiquidityUsd({ row, rawScan, market });
const fdv = resolveFdUsd({ row, rawScan, market });
const spreadBps = resolveSpreadBps({ row, rawScan, market });
const priceImpactBps = resolvePriceImpactBps({ row, rawScan, market });
const currentValueUsd = resolveCurrentValueUsd({ row, rawScan });
const currentMultiple = resolveCurrentMultiple({ row, rawScan });

const volumeUsd = resolveVolumeUsd({ row, rawScan, market, trend });
const volumeChangePct = resolveVolumeChangePct({
row,
rawScan,
market,
trend,
activity,
});
const volumeAnomalyScore = resolveVolumeAnomalyScore({
row,
rawScan,
trend,
activity,
securityModel,
});
const liquidityChangePct = resolveLiquidityChangePct({
row,
rawScan,
market,
trend,
activity,
});
const priceChangePct = resolvePriceChangePct({ row, rawScan, market, trend });
const txns24h = resolveTxnCount24h({ row, rawScan, market, activity });

const rowTs = rowTimestampMs(row);
const createdAt =
row.created_at ||
row.detected_at ||
row.scanned_at ||
rawScan.created_at ||
rawScan.detected_at ||
null;
const updatedAt =
row.updated_at ||
row.last_updated_at ||
row.last_scanned_at ||
row.scanned_at ||
rawScan.updated_at ||
rawScan.last_scanned_at ||
createdAt ||
null;

return {
...rawScan,
mint: resolvedMint,
mint_address: resolvedMint,
token_id:
cleanText(rawScan.token_id || row.token_id || resolvedMint, 255) ||
resolvedMint,

created_at: createdAt,
updated_at: updatedAt,
row_timestamp_ms: rowTs || null,

token: {
...token,
...rawToken,
mint: resolvedMint,
mint_address: resolvedMint,
token_id:
cleanText(
rawToken.token_id || token.token_id || row.token_id || resolvedMint,
255
) || resolvedMint,
mintAuthority:
firstValue(row, ["mint_authority", "mintAuthority"], null) ??
rawToken.mintAuthority ??
rawToken.mint_authority ??
token.mintAuthority ??
token.mint_authority ??
null,
freezeAuthority:
firstValue(row, ["freeze_authority", "freezeAuthority"], null) ??
rawToken.freezeAuthority ??
rawToken.freeze_authority ??
token.freezeAuthority ??
token.freeze_authority ??
null,
},

market: {
...market,
...rawMarket,

mcapUsd: marketcapUsd ?? rawMarket.mcapUsd ?? market.mcapUsd ?? null,
marketCapUsd:
marketcapUsd ?? rawMarket.marketCapUsd ?? market.marketCapUsd ?? null,
marketcap_usd:
marketcapUsd ?? rawMarket.marketcap_usd ?? market.marketcap_usd ?? null,

liquidityUsd:
liquidityUsd ?? rawMarket.liquidityUsd ?? market.liquidityUsd ?? null,
liquidity_usd:
liquidityUsd ?? rawMarket.liquidity_usd ?? market.liquidity_usd ?? null,

priceUsd: priceUsd ?? rawMarket.priceUsd ?? market.priceUsd ?? null,
price_usd: priceUsd ?? rawMarket.price_usd ?? market.price_usd ?? null,
currentPriceUsd:
priceUsd ?? rawMarket.currentPriceUsd ?? market.currentPriceUsd ?? null,
current_price_usd:
priceUsd ??
rawMarket.current_price_usd ??
market.current_price_usd ??
null,
price_now: priceUsd ?? rawMarket.price_now ?? market.price_now ?? null,

fdv: fdv ?? rawMarket.fdv ?? market.fdv ?? null,
fdvUsd: fdv ?? rawMarket.fdvUsd ?? market.fdvUsd ?? null,
fdv_usd: fdv ?? rawMarket.fdv_usd ?? market.fdv_usd ?? null,

spreadBps: spreadBps ?? rawMarket.spreadBps ?? market.spreadBps ?? null,
spread_bps:
spreadBps ?? rawMarket.spread_bps ?? market.spread_bps ?? null,

priceImpactBps:
priceImpactBps ??
rawMarket.priceImpactBps ??
market.priceImpactBps ??
null,
price_impact_bps:
priceImpactBps ??
rawMarket.price_impact_bps ??
market.price_impact_bps ??
null,

volumeUsd: volumeUsd ?? rawMarket.volumeUsd ?? market.volumeUsd ?? null,
volume_usd: volumeUsd ?? rawMarket.volume_usd ?? market.volume_usd ?? null,
volume24h: volumeUsd ?? rawMarket.volume24h ?? market.volume24h ?? null,
volume_24h_usd:
volumeUsd ?? rawMarket.volume_24h_usd ?? market.volume_24h_usd ?? null,

volumeChangePct:
volumeChangePct ??
rawMarket.volumeChangePct ??
market.volumeChangePct ??
null,
volume_change_pct:
volumeChangePct ??
rawMarket.volume_change_pct ??
market.volume_change_pct ??
null,

liquidityChangePct:
liquidityChangePct ??
rawMarket.liquidityChangePct ??
market.liquidityChangePct ??
null,
liquidity_change_pct:
liquidityChangePct ??
rawMarket.liquidity_change_pct ??
market.liquidity_change_pct ??
null,

priceChangePct:
priceChangePct ??
rawMarket.priceChangePct ??
market.priceChangePct ??
null,
price_change_pct:
priceChangePct ??
rawMarket.price_change_pct ??
market.price_change_pct ??
null,

txns24h: txns24h ?? rawMarket.txns24h ?? market.txns24h ?? null,
txns_24h: txns24h ?? rawMarket.txns_24h ?? market.txns_24h ?? null,
},

holders: {
...holders,
...rawHolders,
},

concentration: {
...concentration,
...rawConcentration,
top1:
firstNumber(row, ["top_holder_pct", "top1_pct", "top1"], null) ??
firstNumber(rawConcentration, ["top1", "top1_pct"], null) ??
firstNumber(concentration, ["top1", "top1_pct"], null),
top5:
firstNumber(row, ["top_5_holder_pct", "top5_pct", "top5"], null) ??
firstNumber(rawConcentration, ["top5", "top5_pct"], null) ??
firstNumber(concentration, ["top5", "top5_pct"], null),
top10:
firstNumber(row, ["top10_pct", "top_10_holder_pct", "top10"], null) ??
firstNumber(rawConcentration, ["top10", "top10_pct"], null) ??
firstNumber(concentration, ["top10", "top10_pct"], null),
},

activity: {
...activity,
...rawActivity,
score:
firstNumber(row, ["cluster_score", "activity_score"], null) ??
firstNumber(rawActivity, ["score"], null) ??
firstNumber(activity, ["score"], null),
clusterCount:
firstNumber(row, ["cluster_count"], null) ??
firstNumber(rawActivity, ["clusterCount", "cluster_count"], null) ??
firstNumber(activity, ["clusterCount", "cluster_count"], null),
clusteredWallets:
firstNumber(row, ["clustered_wallets"], null) ??
firstNumber(
rawActivity,
["clusteredWallets", "clustered_wallets"],
null
) ??
firstNumber(activity, ["clusteredWallets", "clustered_wallets"], null),
maxClusterSize:
firstNumber(row, ["max_cluster_size"], null) ??
firstNumber(rawActivity, ["maxClusterSize", "max_cluster_size"], null) ??
firstNumber(activity, ["maxClusterSize", "max_cluster_size"], null),
newWalletPct:
firstNumber(row, ["fresh_wallet_pct", "new_wallet_pct"], null) ??
firstNumber(
rawActivity,
["newWalletPct", "fresh_wallet_pct", "new_wallet_pct"],
null
) ??
firstNumber(
activity,
["newWalletPct", "fresh_wallet_pct", "new_wallet_pct"],
null
),
},

securityModel: {
...securityModel,
...rawSecurityModel,
score:
firstNumber(row, ["risk_score", "security_score"], null) ??
firstNumber(rawSecurityModel, ["score"], null) ??
firstNumber(securityModel, ["score"], null),
},

cassie: {
...cassie,
...rawCassie,
},

trend: {
...trend,
...rawTrend,
volumeAnomalyScore:
volumeAnomalyScore ??
rawTrend.volumeAnomalyScore ??
trend.volumeAnomalyScore ??
null,
volume_anomaly_score:
volumeAnomalyScore ??
rawTrend.volume_anomaly_score ??
trend.volume_anomaly_score ??
null,
volumeChangePct:
volumeChangePct ??
rawTrend.volumeChangePct ??
trend.volumeChangePct ??
null,
volume_change_pct:
volumeChangePct ??
rawTrend.volume_change_pct ??
trend.volume_change_pct ??
null,
liquidityChangePct:
liquidityChangePct ??
rawTrend.liquidityChangePct ??
trend.liquidityChangePct ??
null,
liquidity_change_pct:
liquidityChangePct ??
rawTrend.liquidity_change_pct ??
trend.liquidity_change_pct ??
null,
priceChangePct:
priceChangePct ??
rawTrend.priceChangePct ??
trend.priceChangePct ??
null,
price_change_pct:
priceChangePct ??
rawTrend.price_change_pct ??
trend.price_change_pct ??
null,
},

source: cleanText(rawScan.source || row.source || "scanner_cache", 120),
execution_mode: executionMode,

linked_operator_cluster_id:
firstTextFromSources(
[row, rawScan],
["linked_operator_cluster_id", "operator_cluster_id"],
""
) || null,

price_usd: priceUsd,
priceUsd,
price_now: priceUsd,
priceNow: priceUsd,
current_price: priceUsd,
currentPrice: priceUsd,
current_price_usd: priceUsd,
currentPriceUsd: priceUsd,

marketcap_usd: marketcapUsd,
marketcapUsd,
liquidity_usd: liquidityUsd,
liquidityUsd,
fdv_usd: fdv,
fdvUsd: fdv,
spread_bps: spreadBps,
spreadBps,
price_impact_bps: priceImpactBps,
priceImpactBps,

volume_usd: volumeUsd,
volumeUsd,
volume_24h_usd: volumeUsd,
volume24hUsd: volumeUsd,
volume_change_pct: volumeChangePct,
volumeChangePct,
volume_anomaly_score: volumeAnomalyScore,
volumeAnomalyScore,
liquidity_change_pct: liquidityChangePct,
liquidityChangePct,
price_change_pct: priceChangePct,
priceChangePct,
txns_24h: txns24h,
txns24h,

seller_exhaustion_score: firstNumberFromSources(
[row, rawScan],
["seller_exhaustion_score", "sellerExhaustionScore"],
null
),
reclaim_strength_score: firstNumberFromSources(
[row, rawScan],
["reclaim_strength_score", "reclaimStrengthScore"],
null
),
buy_pressure_score: firstNumberFromSources(
[row, rawScan],
["buy_pressure_score", "buyPressureScore"],
null
),
persistence_score: firstNumberFromSources(
[row, rawScan],
["persistence_score", "persistenceScore"],
null
),
structural_health_score: firstNumberFromSources(
[row, rawScan],
["structural_health_score", "structuralHealthScore"],
null
),
regime_score: firstNumberFromSources(
[row, rawScan],
["regime_score", "regimeScore", "market_regime_score", "marketRegimeScore"],
null
),
regime_state:
firstTextFromSources(
[row, rawScan],
["regime_state", "regimeState", "market_regime", "marketRegime"],
""
) || null,

recent_rug_rate_pct: firstNumberFromSources(
[row, rawScan],
["recent_rug_rate_pct", "recentRugRatePct"],
null
),
reclaim_success_rate_pct: firstNumberFromSources(
[row, rawScan],
["reclaim_success_rate_pct", "reclaimSuccessRatePct"],
null
),
recent_runner_count: firstNumberFromSources(
[row, rawScan],
["recent_runner_count", "recentRunnerCount"],
null
),
breakout_follow_through_score: firstNumberFromSources(
[row, rawScan],
["breakout_follow_through_score", "breakoutFollowThroughScore"],
null
),
vertical_extension_score: firstNumberFromSources(
[row, rawScan],
["vertical_extension_score", "verticalExtensionScore"],
null
),
operator_quality_score: firstNumberFromSources(
[row, rawScan],
["operator_quality_score", "operatorQualityScore"],
null
),
hidden_control_risk: firstNumberFromSources(
[row, rawScan],
["hidden_control_risk", "hiddenControlRisk"],
null
),
contamination_risk: firstNumberFromSources(
[row, rawScan],
["contamination_risk", "contaminationRisk"],
null
),
wallet_coordination_risk: firstNumberFromSources(
[row, rawScan],
["wallet_coordination_risk", "walletCoordinationRisk"],
null
),
insider_sell_score:
firstNumberFromSources(
[row, rawScan],
["insider_sell_score", "insiderSellScore", "dev_sell_score", "devSellScore"],
null
) ?? 0,
liquidity_decay_score: firstNumberFromSources(
[row, rawScan],
["liquidity_decay_score", "liquidityDecayScore"],
null
),
transfer_restriction_risk: firstNumberFromSources(
[row, rawScan],
["transfer_restriction_risk", "transferRestrictionRisk"],
null
),
honeypot_risk: firstNumberFromSources(
[row, rawScan],
["honeypot_risk", "honeypotRisk"],
null
),
liquidity_break_risk: firstNumberFromSources(
[row, rawScan],
["liquidity_break_risk", "liquidityBreakRisk"],
null
),
spoofed_volume_risk: firstNumberFromSources(
[row, rawScan],
["spoofed_volume_risk", "spoofedVolumeRisk"],
null
),

bars_since_launch: firstNumberFromSources(
[row, rawScan],
["bars_since_launch", "barsSinceLaunch"],
null
),
bars_since_local_low: firstNumberFromSources(
[row, rawScan],
["bars_since_local_low", "barsSinceLocalLow"],
null
),
failed_breakout_count: firstNumberFromSources(
[row, rawScan],
["failed_breakout_count", "failedBreakoutCount"],
null
),

current_multiple: currentMultiple,
currentMultiple,
current_value_usd: currentValueUsd,
currentValueUsd,
position_value_usd: currentValueUsd,
positionValueUsd: currentValueUsd,
};
}

function buildSnapshotFromRow(row = {}, options = {}) {
const directSnapshot =
extractJsonPayload(row, ["sentinel_snapshot_json", "sentinel_json"]) || null;

const execution_mode = resolveExecutionMode(
options.execution_mode,
row.execution_mode,
row.mode
);

if (directSnapshot && typeof directSnapshot === "object") {
const priceUsd =
resolveMarketPriceUsd({
row,
rawScan: directSnapshot,
market: directSnapshot.market || {},
}) ??
directSnapshot.price_usd ??
directSnapshot.priceUsd ??
null;

return normalizeSentinelSnapshot(
{
...directSnapshot,
source: cleanText(directSnapshot.source, 120) || "sentinel_cache",
execution_mode,
price_usd: priceUsd,
priceUsd,
price_now: priceUsd,
priceNow: priceUsd,
current_price: priceUsd,
currentPrice: priceUsd,
current_price_usd: priceUsd,
currentPriceUsd: priceUsd,
created_at:
directSnapshot.created_at ||
row.created_at ||
row.detected_at ||
row.scanned_at ||
null,
updated_at:
directSnapshot.updated_at ||
row.updated_at ||
row.last_updated_at ||
row.last_scanned_at ||
row.scanned_at ||
row.created_at ||
null,
row_timestamp_ms: rowTimestampMs(row) || directSnapshot.row_timestamp_ms || null,
market: {
...(directSnapshot.market || {}),
price_usd:
priceUsd ??
directSnapshot.market?.price_usd ??
directSnapshot.market?.priceUsd ??
null,
priceUsd:
priceUsd ??
directSnapshot.market?.priceUsd ??
directSnapshot.market?.price_usd ??
null,
current_price:
priceUsd ??
directSnapshot.market?.current_price ??
directSnapshot.market?.priceUsd ??
null,
currentPrice:
priceUsd ??
directSnapshot.market?.currentPrice ??
directSnapshot.market?.priceUsd ??
null,
price_now:
priceUsd ??
directSnapshot.market?.price_now ??
directSnapshot.market?.priceUsd ??
null,
},
},
options
);
}

const scan = extractScanObjectFromRow(row);

return buildSentinelSnapshotFromSecurityScan(scan, {
source: "scanner_cache",
execution_mode,
min_liquidity_usd: options.min_liquidity_usd,
});
}

function dedupeSnapshotsByToken(snapshots = []) {
const map = new Map();

for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
const tokenId = cleanText(snapshot?.token_id || snapshot?.mint_address, 255);
if (!tokenId) continue;
if (!map.has(tokenId)) {
map.set(tokenId, snapshot);
}
}

return Array.from(map.values());
}

function mergeDiscoveryMeta(existing = {}, next = {}) {
const existingUniverses = Array.isArray(existing.discovery_universes)
? existing.discovery_universes
: [];
const nextUniverses = Array.isArray(next.discovery_universes)
? next.discovery_universes
: [];

return {
...existing,
...next,
discovery_universes: uniqueCleanList([...existingUniverses, ...nextUniverses]),
discovery_scores: {
...(existing.discovery_scores || {}),
...(next.discovery_scores || {}),
},
discovery_ranks: {
...(existing.discovery_ranks || {}),
...(next.discovery_ranks || {}),
},
};
}

function mergeSnapshotsByToken(snapshotGroups = []) {
const map = new Map();

for (const group of snapshotGroups) {
for (const snapshot of Array.isArray(group) ? group : []) {
const tokenId = cleanText(snapshot?.token_id || snapshot?.mint_address, 255);
if (!tokenId) continue;

const existing = map.get(tokenId);

map.set(tokenId, {
...(existing || {}),
...(snapshot || {}),
market: {
...(existing?.market || {}),
...(snapshot?.market || {}),
},
trend: {
...(existing?.trend || {}),
...(snapshot?.trend || {}),
},
activity: {
...(existing?.activity || {}),
...(snapshot?.activity || {}),
},
meta: mergeDiscoveryMeta(existing?.meta || {}, snapshot?.meta || {}),
});
}
}

return Array.from(map.values());
}

function filterSnapshots(snapshots = [], options = {}) {
const minLiquidityUsd = Math.max(0, toFloat(options.min_liquidity_usd, 0) || 0);
const requireUsable = options.require_usable !== false;

return (Array.isArray(snapshots) ? snapshots : []).filter((snapshot) => {
if (requireUsable && !isUsableSentinelSnapshot(snapshot)) return false;

if (
minLiquidityUsd > 0 &&
Number(snapshot?.liquidity_usd || snapshot?.liquidityUsd || 0) <
minLiquidityUsd
) {
return false;
}

return true;
});
}

function resolveContextArray(context = {}, keys = []) {
for (const key of keys) {
const value = context?.[key];
if (Array.isArray(value)) return value;
}

return null;
}

function chunkArray(items = [], size = 50) {
const chunks = [];
const safeSize = Math.max(1, toInt(size, 50) || 50);

for (let i = 0; i < items.length; i += safeSize) {
chunks.push(items.slice(i, i + safeSize));
}

return chunks;
}

function uniqueCleanList(items = []) {
const seen = new Set();
const out = [];

for (const item of Array.isArray(items) ? items : []) {
const value = cleanText(item, 255);
if (!value || seen.has(value)) continue;
seen.add(value);
out.push(value);
}

return out;
}

function getScanCacheColumns() {
try {
const rows = scannerDb.prepare(`PRAGMA table_info(scan_cache)`).all();
return new Set(rows.map((row) => row.name).filter(Boolean));
} catch {
return new Set();
}
}

function getPreferredScanCacheOrderColumn(columns = new Set()) {
const candidates = [
"updated_at",
"last_updated_at",
"last_scanned_at",
"scanned_at",
"created_at",
"last_seen_at",
"detected_at",
"id",
];

for (const candidate of candidates) {
if (columns.has(candidate)) return candidate;
}

return null;
}

function readScanCacheRowsForTokens(tokens = [], { limitPerColumn = 500 } = {}) {
const safeTokens = uniqueCleanList(tokens);
if (!safeTokens.length) return [];

const columns = getScanCacheColumns();
if (!columns.size) return [];

const lookupColumns = [
"mint",
"token_id",
"mint_address",
"address",
"tokenMint",
"token_mint",
"base_mint",
"baseMint",
].filter((column) => columns.has(column));

if (!lookupColumns.length) return [];

const orderColumn = getPreferredScanCacheOrderColumn(columns);
const orderSql = orderColumn ? ` ORDER BY ${orderColumn} DESC` : "";
const rows = [];
const seenRowKeys = new Set();
const chunks = chunkArray(safeTokens, 80);

for (const column of lookupColumns) {
for (const chunk of chunks) {
const placeholders = chunk.map(() => "?").join(",");
const safeLimit = Math.max(1, toInt(limitPerColumn, 500) || 500);

try {
const result = scannerDb
.prepare(
`
SELECT *
FROM scan_cache
WHERE ${column} IN (${placeholders})
${orderSql}
LIMIT ?
`
)
.all(...chunk, safeLimit);

for (const row of result) {
const rowKey =
row.id != null
? `id:${row.id}`
: `${extractMintFromRow(row) || ""}:${rowTimestampMs(row)}`;

if (seenRowKeys.has(rowKey)) continue;
seenRowKeys.add(rowKey);
rows.push(row);
}
} catch {
// Keep provider resilient across scanner schema variants.
}
}
}

return sortRowsNewestFirst(rows);
}

function getPositionToken(position = {}) {
return cleanText(position.token_id || position.mint_address, 255);
}

function getPositionMint(position = {}) {
return cleanText(position.mint_address || position.token_id, 255);
}

function getPositionLookupTokens(positions = []) {
const tokens = [];

for (const position of Array.isArray(positions) ? positions : []) {
const token = getPositionToken(position);
const mint = getPositionMint(position);

if (token) tokens.push(token);
if (mint) tokens.push(mint);
}

return uniqueCleanList(tokens);
}

async function getJsonWithTimeout(url, { headers = {}, timeoutMs = 4500 } = {}) {
if (typeof fetch !== "function") {
throw new Error("Global fetch is not available in this Node runtime.");
}

const controller =
typeof AbortController === "function" ? new AbortController() : null;
const timer = controller
? setTimeout(() => controller.abort(), Math.max(500, timeoutMs))
: null;

try {
const response = await fetch(url, {
method: "GET",
headers,
signal: controller?.signal,
});

if (!response.ok) {
throw new Error(`HTTP ${response.status} from ${url}`);
}

return response.json();
} finally {
if (timer) clearTimeout(timer);
}
}

function getLivePriceProviderOrder(options = {}) {
const configured = cleanText(
options.live_price_provider_order ||
envValue("SENTINEL_PRICE_PROVIDER_ORDER", "") ||
"",
255
);

const raw = configured || "dexscreener,jupiter";

return raw
.split(",")
.map((item) => cleanText(item, 64).toLowerCase())
.filter(Boolean);
}

function getJupiterPriceUrls(options = {}) {
const configured =
cleanText(options.jupiter_price_url, 500) ||
cleanText(envValue("SENTINEL_JUPITER_PRICE_URL", ""), 500) ||
cleanText(envValue("JUPITER_PRICE_API_URL", ""), 500);

const urls = configured ? [configured] : DEFAULT_JUPITER_PRICE_URLS;

return uniqueCleanList(urls);
}

function getJupiterApiKey() {
return (
cleanText(envValue("JUPITER_API_KEY", ""), 500) ||
cleanText(envValue("JUPITER_PRICE_API_KEY", ""), 500) ||
cleanText(envValue("SENTINEL_JUPITER_API_KEY", ""), 500) ||
""
);
}

function parseJupiterPricePayload(payload = {}, ids = []) {
const prices = new Map();

for (const id of ids) {
const row = payload?.[id];
const priceUsd = positiveNumber(
row?.usdPrice ?? row?.priceUsd ?? row?.price,
null
);

if (!priceUsd) continue;

prices.set(id, {
token_id: id,
mint_address: id,
price_usd: priceUsd,
source: "jupiter",
block_id: row?.blockId ?? row?.block_id ?? null,
decimals: row?.decimals ?? null,
price_change_24h: toFloat(row?.priceChange24h, null),
liquidity_usd: null,
marketcap_usd: null,
fdv_usd: null,
raw: row,
});
}

return prices;
}

async function fetchJupiterPrices(tokenIds = [], options = {}) {
const ids = uniqueCleanList(tokenIds);
const prices = new Map();

if (!ids.length) return prices;

const batchSize = normalizeBatchSize(
options.jupiter_batch_size || envValue("SENTINEL_JUPITER_BATCH_SIZE", null),
DEFAULT_JUPITER_BATCH_SIZE,
50
);
const timeoutMs = Math.max(
500,
toInt(
options.price_fetch_timeout_ms ||
envValue("SENTINEL_PRICE_FETCH_TIMEOUT_MS", null),
DEFAULT_PRICE_FETCH_TIMEOUT_MS
) || DEFAULT_PRICE_FETCH_TIMEOUT_MS
);
const urls = getJupiterPriceUrls(options);
const apiKey = getJupiterApiKey();

for (const chunk of chunkArray(ids, batchSize)) {
let chunkResolved = false;

for (const baseUrl of urls) {
try {
const url = new URL(baseUrl);
url.searchParams.set("ids", chunk.join(","));

const headers = {
accept: "application/json",
};

if (apiKey) {
headers["x-api-key"] = apiKey;
}

const payload = await getJsonWithTimeout(url.toString(), {
headers,
timeoutMs,
});

const parsed = parseJupiterPricePayload(payload, chunk);

for (const [token, price] of parsed.entries()) {
prices.set(token, price);
}

chunkResolved = true;
break;
} catch {
// Try next Jupiter URL/fallback.
}
}

if (!chunkResolved) {
continue;
}
}

return prices;
}

function getDexScreenerPairToken(pair = {}, requested = new Set()) {
const base = cleanText(pair?.baseToken?.address, 255);
const quote = cleanText(pair?.quoteToken?.address, 255);

if (base && requested.has(base)) return base;
if (quote && requested.has(quote)) return quote;

return base || quote || "";
}

function scoreDexScreenerPair(pair = {}) {
const liquidity = Math.max(0, toFloat(pair?.liquidity?.usd, 0) || 0);
const volume24h = Math.max(0, toFloat(pair?.volume?.h24, 0) || 0);
const txns24h =
Math.max(0, toInt(pair?.txns?.h24?.buys, 0) || 0) +
Math.max(0, toInt(pair?.txns?.h24?.sells, 0) || 0);

return liquidity * 1000 + volume24h + txns24h;
}

function parseDexScreenerPairs(payload = [], ids = []) {
const prices = new Map();
const requested = new Set(ids);

for (const pair of Array.isArray(payload) ? payload : []) {
const token = getDexScreenerPairToken(pair, requested);
if (!token) continue;

const priceUsd = positiveNumber(pair?.priceUsd, null);
if (!priceUsd) continue;

const score = scoreDexScreenerPair(pair);
const existing = prices.get(token);

if (existing && existing.score >= score) continue;

prices.set(token, {
token_id: token,
mint_address: token,
price_usd: priceUsd,
source: "dexscreener",
dex_id: pair?.dexId || null,
pair_address: pair?.pairAddress || null,
pair_url: pair?.url || null,
liquidity_usd: toFloat(pair?.liquidity?.usd, null),
marketcap_usd: toFloat(pair?.marketCap, null),
fdv_usd: toFloat(pair?.fdv, null),
price_change_24h: toFloat(pair?.priceChange?.h24, null),
volume_24h: toFloat(pair?.volume?.h24, null),
volume_usd: toFloat(pair?.volume?.h24, null),
txns_24h:
Math.max(0, toInt(pair?.txns?.h24?.buys, 0) || 0) +
Math.max(0, toInt(pair?.txns?.h24?.sells, 0) || 0),
score,
raw: pair,
});
}

return prices;
}

async function fetchDexScreenerPrices(tokenIds = [], options = {}) {
const ids = uniqueCleanList(tokenIds);
const prices = new Map();

if (!ids.length) return prices;

const batchSize = normalizeBatchSize(
options.dexscreener_batch_size ||
envValue("SENTINEL_DEXSCREENER_BATCH_SIZE", null),
DEFAULT_DEXSCREENER_BATCH_SIZE,
30
);
const timeoutMs = Math.max(
500,
toInt(
options.price_fetch_timeout_ms ||
envValue("SENTINEL_PRICE_FETCH_TIMEOUT_MS", null),
DEFAULT_PRICE_FETCH_TIMEOUT_MS
) || DEFAULT_PRICE_FETCH_TIMEOUT_MS
);

const baseUrl =
cleanText(options.dexscreener_tokens_url, 500) ||
cleanText(envValue("SENTINEL_DEXSCREENER_TOKENS_URL", ""), 500) ||
DEFAULT_DEXSCREENER_TOKENS_URL;

for (const chunk of chunkArray(ids, batchSize)) {
try {
const url = `${baseUrl.replace(/\/+$/, "")}/${chunk
.map((item) => encodeURIComponent(item))
.join(",")}`;

const payload = await getJsonWithTimeout(url, {
headers: {
accept: "application/json",
},
timeoutMs,
});

const parsed = parseDexScreenerPairs(payload, chunk);

for (const [token, price] of parsed.entries()) {
prices.set(token, price);
}
} catch {
// Keep Sentinel running even if external pricing misses/fails.
}
}

return prices;
}

async function fetchLivePrices(tokenIds = [], options = {}) {
const ids = uniqueCleanList(tokenIds);
const livePrices = new Map();
const errors = [];

if (!ids.length) {
return {
prices: livePrices,
meta: {
requested: 0,
resolved: 0,
providers: [],
errors,
},
};
}

const enabled = toBool(
options.live_price_enabled ??
envValue("SENTINEL_LIVE_PRICE_ENABLED", "true"),
true
);

if (!enabled) {
return {
prices: livePrices,
meta: {
requested: ids.length,
resolved: 0,
providers: [],
skipped: true,
reason: "live_price_disabled",
errors,
},
};
}

const providerOrder = getLivePriceProviderOrder(options);

for (const provider of providerOrder) {
const missing = ids.filter((id) => !livePrices.has(id));
if (!missing.length) break;

try {
const providerPrices =
provider === "jupiter"
? await fetchJupiterPrices(missing, options)
: provider === "dexscreener"
? await fetchDexScreenerPrices(missing, options)
: new Map();

for (const [token, price] of providerPrices.entries()) {
if (!livePrices.has(token)) {
livePrices.set(token, price);
}
}
} catch (error) {
errors.push({
provider,
message: cleanText(error?.message || String(error), 1000),
});
}
}

return {
prices: livePrices,
meta: {
requested: ids.length,
resolved: livePrices.size,
providers: providerOrder,
errors,
},
};
}

function getSnapshotToken(snapshot = {}) {
return cleanText(snapshot?.token_id || snapshot?.mint_address, 255);
}

function indexSnapshotsByToken(snapshots = []) {
const map = new Map();

for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
const token = getSnapshotToken(snapshot);
if (!token) continue;
map.set(token, snapshot);
}

return map;
}

function getSnapshotPrice(snapshot = {}) {
return positiveNumber(
snapshot?.price_now ??
snapshot?.current_price ??
snapshot?.price_usd ??
snapshot?.priceUsd ??
snapshot?.market?.priceUsd ??
snapshot?.market?.price_usd ??
snapshot?.market?.currentPriceUsd ??
snapshot?.market?.current_price_usd,
null
);
}

function getSnapshotMarketcap(snapshot = {}) {
return zeroOrPositive(
snapshot?.marketcap_usd ??
snapshot?.marketcapUsd ??
snapshot?.market?.marketcap_usd ??
snapshot?.market?.marketcapUsd ??
snapshot?.market?.mcapUsd ??
snapshot?.market?.fdv,
null
);
}

function getSnapshotLiquidity(snapshot = {}) {
return zeroOrPositive(
snapshot?.liquidity_usd ??
snapshot?.liquidityUsd ??
snapshot?.market?.liquidity_usd ??
snapshot?.market?.liquidityUsd ??
snapshot?.market?.liquidity?.usd,
null
);
}

function getSnapshotVolumeUsd(snapshot = {}) {
return zeroOrPositive(
snapshot?.volume_usd ??
snapshot?.volumeUsd ??
snapshot?.volume_24h_usd ??
snapshot?.volume24hUsd ??
snapshot?.market?.volume_usd ??
snapshot?.market?.volumeUsd ??
snapshot?.market?.volume24h ??
snapshot?.market?.volume?.h24,
null
);
}

function getSnapshotLiquidityChangePct(snapshot = {}) {
return toFloat(
snapshot?.liquidity_change_pct ??
snapshot?.liquidityChangePct ??
snapshot?.market?.liquidity_change_pct ??
snapshot?.market?.liquidityChangePct ??
snapshot?.trend?.liquidity_change_pct ??
snapshot?.trend?.liquidityChangePct,
null
);
}

function getSnapshotVolumeAnomaly(snapshot = {}) {
return clampScore(
snapshot?.volume_anomaly_score ??
snapshot?.volumeAnomalyScore ??
snapshot?.trend?.volume_anomaly_score ??
snapshot?.trend?.volumeAnomalyScore ??
snapshot?.activity?.volume_anomaly_score ??
snapshot?.activity?.volumeAnomalyScore,
0
);
}

function getSnapshotVolumeChangePct(snapshot = {}) {
return toFloat(
snapshot?.volume_change_pct ??
snapshot?.volumeChangePct ??
snapshot?.trend?.volume_change_pct ??
snapshot?.trend?.volumeChangePct ??
snapshot?.market?.volume_change_pct ??
snapshot?.market?.volumeChangePct,
null
);
}

function getSnapshotPriceChangePct(snapshot = {}) {
return toFloat(
snapshot?.price_change_pct ??
snapshot?.priceChangePct ??
snapshot?.market?.price_change_pct ??
snapshot?.market?.priceChangePct ??
snapshot?.market?.priceChange?.h24 ??
snapshot?.trend?.price_change_pct ??
snapshot?.trend?.priceChangePct,
null
);
}

function getSnapshotTimestampMs(snapshot = {}) {
const candidates = [
snapshot.updated_at,
snapshot.last_updated_at,
snapshot.last_scanned_at,
snapshot.scanned_at,
snapshot.created_at,
snapshot.detected_at,
snapshot.row_timestamp_ms,
snapshot.timestamp,
];

for (const value of candidates) {
if (value == null) continue;
if (typeof value === "number" && Number.isFinite(value)) return value;

const parsed = new Date(value).getTime();
if (!Number.isNaN(parsed)) return parsed;
}

return 0;
}

function getPositionCostBasis(position = {}) {
const units = Math.max(0, toFloat(position.units, 0) || 0);
const entryPrice = positiveNumber(position.avg_entry_price, null);

if (units > 0 && entryPrice) {
return Math.max(0, units * entryPrice);
}

return Math.max(0, toFloat(position.total_cost_usd, 0) || 0);
}

function patchSnapshotForOpenPosition({
snapshot = null,
position = {},
livePrice = null,
executionMode = SENTINEL_MODE.PAPER,
} = {}) {
const tokenId = getPositionToken(position);
const mintAddress = getPositionMint(position) || tokenId;

if (!tokenId && !mintAddress) return null;

const base = snapshot && typeof snapshot === "object" ? snapshot : {};
const livePriceUsd = positiveNumber(livePrice?.price_usd, null);
const cachedPriceUsd = getSnapshotPrice(base);
const priceUsd = livePriceUsd ?? cachedPriceUsd ?? null;

const units = Math.max(0, toFloat(position.units, 0) || 0);
const totalCostUsd = Math.max(0, toFloat(position.total_cost_usd, 0) || 0);
const remainingCostBasisUsd = getPositionCostBasis(position);

const currentValueUsd =
priceUsd && units > 0
? Math.max(0, units * priceUsd)
: positiveNumber(base.current_value_usd, null) ??
positiveNumber(base.currentValueUsd, null) ??
positiveNumber(base.position_value_usd, null) ??
positiveNumber(position.current_value_usd, null) ??
null;

const currentMultiple =
currentValueUsd != null && totalCostUsd > 0
? currentValueUsd / totalCostUsd
: positiveNumber(base.current_multiple, null) ??
positiveNumber(base.currentMultiple, null) ??
null;

const market = {
...(base.market || {}),
};

if (priceUsd) {
market.priceUsd = priceUsd;
market.price_usd = priceUsd;
market.currentPriceUsd = priceUsd;
market.current_price_usd = priceUsd;
market.current_price = priceUsd;
market.price_now = priceUsd;
}

if (livePrice?.liquidity_usd != null) {
market.liquidityUsd = Math.max(0, toFloat(livePrice.liquidity_usd, 0) || 0);
market.liquidity_usd = market.liquidityUsd;
}

if (livePrice?.marketcap_usd != null) {
market.mcapUsd = Math.max(0, toFloat(livePrice.marketcap_usd, 0) || 0);
market.marketCapUsd = market.mcapUsd;
market.marketcap_usd = market.mcapUsd;
}

if (livePrice?.fdv_usd != null) {
market.fdv = Math.max(0, toFloat(livePrice.fdv_usd, 0) || 0);
market.fdvUsd = market.fdv;
market.fdv_usd = market.fdv;
}

if (livePrice?.volume_usd != null || livePrice?.volume_24h != null) {
market.volumeUsd = Math.max(
0,
toFloat(livePrice.volume_usd ?? livePrice.volume_24h, 0) || 0
);
market.volume_usd = market.volumeUsd;
market.volume24h = market.volumeUsd;
}

return normalizeSentinelSnapshot(
{
...base,
source: livePriceUsd
? "open_position_live_price"
: base.source || "open_position_scanner_cache",
token_id: tokenId || mintAddress,
mint_address: mintAddress || tokenId,
execution_mode: executionMode,

price_usd: priceUsd,
priceUsd: priceUsd,
price_now: priceUsd,
priceNow: priceUsd,
current_price: priceUsd,
currentPrice: priceUsd,
current_price_usd: priceUsd,
currentPriceUsd: priceUsd,

current_value_usd: currentValueUsd,
currentValueUsd: currentValueUsd,
position_value_usd: currentValueUsd,
positionValueUsd: currentValueUsd,
current_multiple: currentMultiple,
currentMultiple: currentMultiple,

has_live_position_context: true,
position_id: position.id || null,
position_stage: position.stage || null,
position_units: units,
position_total_cost_usd: totalCostUsd,
position_remaining_cost_basis_usd: remainingCostBasisUsd,
position_avg_entry_price:
position.avg_entry_price == null
? null
: Math.max(0, toFloat(position.avg_entry_price, 0) || 0),

market,

raw: {
...(base.raw || {}),
open_position: {
id: position.id || null,
stage: position.stage || null,
execution_mode: position.execution_mode || executionMode,
total_cost_usd: totalCostUsd,
current_value_usd: currentValueUsd,
units,
avg_entry_price: position.avg_entry_price ?? null,
remaining_cost_basis_usd: remainingCostBasisUsd,
},
live_price: livePrice || null,
},

meta: {
...(base.meta || {}),
has_live_position_context: true,
has_live_price: Boolean(livePriceUsd),
live_price_source: livePrice?.source || null,
live_price_updated_at: livePriceUsd ? new Date().toISOString() : null,
discovery_universes: uniqueCleanList([
...(base.meta?.discovery_universes || []),
SENTINEL_DISCOVERY_UNIVERSE.OPEN_POSITIONS,
]),
},
},
{
execution_mode: executionMode,
min_liquidity_usd: 0,
}
);
}

function patchSnapshotsWithOpenPositions({
snapshots = [],
positions = [],
livePrices = new Map(),
executionMode = SENTINEL_MODE.PAPER,
} = {}) {
const byToken = indexSnapshotsByToken(snapshots);
let patchedCount = 0;
let livePricePatchedCount = 0;

for (const position of Array.isArray(positions) ? positions : []) {
const token = getPositionToken(position);
const mint = getPositionMint(position);
if (!token && !mint) continue;

const existing =
byToken.get(token) ||
byToken.get(mint) ||
null;

const livePrice =
livePrices.get(token) ||
livePrices.get(mint) ||
null;

const patched = patchSnapshotForOpenPosition({
snapshot: existing,
position,
livePrice,
executionMode,
});

if (!patched) continue;

const key = getSnapshotToken(patched);
if (!key) continue;

byToken.set(key, patched);
patchedCount += 1;

if (positiveNumber(livePrice?.price_usd, null)) {
livePricePatchedCount += 1;
}
}

return {
snapshots: Array.from(byToken.values()),
patched_count: patchedCount,
live_price_patched_count: livePricePatchedCount,
};
}

function resolveDiscoveryUniverses(value = null) {
const raw =
Array.isArray(value)
? value
: cleanText(value, 1000)
? cleanText(value, 1000).split(",")
: DEFAULT_DISCOVERY_UNIVERSES;

const allowed = new Set(Object.values(SENTINEL_DISCOVERY_UNIVERSE));

const universes = uniqueCleanList(raw)
.map((item) => cleanText(item, 120).toLowerCase())
.filter((item) => allowed.has(item));

return universes.length ? universes : [...DEFAULT_DISCOVERY_UNIVERSES];
}

function getDiscoveryScore(snapshot = {}, universe = SENTINEL_DISCOVERY_UNIVERSE.RECENT) {
const mcap = getSnapshotMarketcap(snapshot);
const liquidity = getSnapshotLiquidity(snapshot);
const volume = getSnapshotVolumeUsd(snapshot);
const volumeAnomaly = getSnapshotVolumeAnomaly(snapshot);
const volumeChange = getSnapshotVolumeChangePct(snapshot);
const liquidityChange = getSnapshotLiquidityChangePct(snapshot);
const priceChange = getSnapshotPriceChangePct(snapshot);
const ts = getSnapshotTimestampMs(snapshot);

const sellerExhaustion = clampScore(
snapshot.seller_exhaustion_score ?? snapshot.sellerExhaustionScore,
0
);
const reclaimStrength = clampScore(
snapshot.reclaim_strength_score ?? snapshot.reclaimStrengthScore,
0
);
const buyPressure = clampScore(snapshot.buy_pressure_score ?? snapshot.buyPressureScore, 0);
const persistence = clampScore(snapshot.persistence_score ?? snapshot.persistenceScore, 0);
const structuralHealth = clampScore(
snapshot.structural_health_score ?? snapshot.structuralHealthScore,
0
);
const regimeScore = clampScore(snapshot.regime_score ?? snapshot.regimeScore, 0);
const operatorQuality = clampScore(
snapshot.operator_quality_score ?? snapshot.operatorQualityScore,
0
);
const top5 = zeroOrPositive(snapshot.top_5_holder_pct ?? snapshot.top5HolderPct, 100);
const top1 = zeroOrPositive(snapshot.top_holder_pct ?? snapshot.topHolderPct, 100);
const contamination = clampScore(
snapshot.contamination_risk ?? snapshot.contaminationRisk,
0
);
const hiddenControl = clampScore(
snapshot.hidden_control_risk ?? snapshot.hiddenControlRisk,
0
);
const coordination = clampScore(
snapshot.wallet_coordination_risk ?? snapshot.walletCoordinationRisk,
0
);
const liquidityDecay = clampScore(
snapshot.liquidity_decay_score ?? snapshot.liquidityDecayScore,
0
);

if (universe === SENTINEL_DISCOVERY_UNIVERSE.NEW_LOW_CAPS) {
const lowCapFit =
mcap != null && mcap > 0
? Math.max(0, 100 - Math.min(100, (mcap / 25000) * 100))
: 0;
const freshBonus = ts ? Math.min(40, Math.max(0, (Date.now() - ts) / -900000 + 40)) : 0;
return lowCapFit + freshBonus + buyPressure * 0.35 + persistence * 0.25;
}

if (universe === SENTINEL_DISCOVERY_UNIVERSE.LIQUIDITY_RISERS) {
return (
Math.max(0, liquidityChange ?? 0) * 1.5 +
Math.log10(Math.max(1, liquidity || 0)) * 12 +
structuralHealth * 0.3 -
liquidityDecay * 0.4
);
}

if (universe === SENTINEL_DISCOVERY_UNIVERSE.UNUSUAL_VOLUME) {
return (
volumeAnomaly * 1.2 +
Math.max(0, volumeChange ?? 0) * 0.8 +
Math.log10(Math.max(1, volume || 0)) * 10 +
buyPressure * 0.25
);
}

if (universe === SENTINEL_DISCOVERY_UNIVERSE.MOMENTUM_MOVERS) {
return (
Math.max(0, priceChange ?? 0) * 0.8 +
buyPressure * 0.8 +
persistence * 0.6 +
regimeScore * 0.4 +
Math.log10(Math.max(1, volume || 0)) * 6
);
}

if (universe === SENTINEL_DISCOVERY_UNIVERSE.CLEAN_RECLAIMS) {
return (
sellerExhaustion * 0.75 +
reclaimStrength * 0.95 +
buyPressure * 0.7 +
persistence * 0.65 +
structuralHealth * 0.75 +
operatorQuality * 0.35 -
contamination * 0.8 -
hiddenControl * 0.45 -
coordination * 0.3
);
}

if (universe === SENTINEL_DISCOVERY_UNIVERSE.STRUCTURAL_CANDIDATES) {
return (
structuralHealth * 1.1 +
operatorQuality * 0.7 +
regimeScore * 0.5 +
persistence * 0.45 -
Math.max(0, top1 - 20) * 1.2 -
Math.max(0, top5 - 45) * 1.4 -
contamination * 0.65 -
hiddenControl * 0.6
);
}

if (universe === SENTINEL_DISCOVERY_UNIVERSE.OPEN_POSITIONS) {
return (
Number(Boolean(snapshot.has_live_position_context)) * 100 +
Math.max(0, (snapshot.current_multiple || snapshot.currentMultiple || 0) * 15) +
Math.max(-50, toFloat(snapshot.current_value_usd, 0) - toFloat(snapshot.position_total_cost_usd, 0))
);
}

if (universe === SENTINEL_DISCOVERY_UNIVERSE.RISK_MONITOR) {
return (
top5 * 0.9 +
top1 * 0.7 +
contamination * 1.2 +
hiddenControl * 1.1 +
coordination * 0.9 +
liquidityDecay * 0.7
);
}

return ts || 0;
}

function snapshotMatchesDiscoveryUniverse(
snapshot = {},
universe = SENTINEL_DISCOVERY_UNIVERSE.RECENT
) {
const token = getSnapshotToken(snapshot);
if (!token) return false;

const mcap = getSnapshotMarketcap(snapshot);
const liquidity = getSnapshotLiquidity(snapshot);
const volume = getSnapshotVolumeUsd(snapshot);
const volumeAnomaly = getSnapshotVolumeAnomaly(snapshot);
const volumeChange = getSnapshotVolumeChangePct(snapshot);
const liquidityChange = getSnapshotLiquidityChangePct(snapshot);
const priceChange = getSnapshotPriceChangePct(snapshot);

const top5 = zeroOrPositive(snapshot.top_5_holder_pct ?? snapshot.top5HolderPct, null);
const top1 = zeroOrPositive(snapshot.top_holder_pct ?? snapshot.topHolderPct, null);
const contamination = clampScore(snapshot.contamination_risk ?? snapshot.contaminationRisk, 0);
const hiddenControl = clampScore(snapshot.hidden_control_risk ?? snapshot.hiddenControlRisk, 0);
const coordination = clampScore(
snapshot.wallet_coordination_risk ?? snapshot.walletCoordinationRisk,
0
);
const sellerExhaustion = clampScore(
snapshot.seller_exhaustion_score ?? snapshot.sellerExhaustionScore,
0
);
const reclaimStrength = clampScore(
snapshot.reclaim_strength_score ?? snapshot.reclaimStrengthScore,
0
);
const buyPressure = clampScore(snapshot.buy_pressure_score ?? snapshot.buyPressureScore, 0);
const persistence = clampScore(snapshot.persistence_score ?? snapshot.persistenceScore, 0);
const structuralHealth = clampScore(
snapshot.structural_health_score ?? snapshot.structuralHealthScore,
0
);
const operatorQuality = clampScore(
snapshot.operator_quality_score ?? snapshot.operatorQualityScore,
0
);

if (universe === SENTINEL_DISCOVERY_UNIVERSE.RECENT) return true;

if (universe === SENTINEL_DISCOVERY_UNIVERSE.NEW_LOW_CAPS) {
return mcap != null && mcap > 0 && mcap <= 50000;
}

if (universe === SENTINEL_DISCOVERY_UNIVERSE.LIQUIDITY_RISERS) {
return (
(liquidityChange != null && liquidityChange > 0) ||
(liquidity != null && liquidity >= 500)
);
}

if (universe === SENTINEL_DISCOVERY_UNIVERSE.UNUSUAL_VOLUME) {
return (
volumeAnomaly >= 55 ||
(volumeChange != null && volumeChange >= 50) ||
(volume != null && volume >= 1000)
);
}

if (universe === SENTINEL_DISCOVERY_UNIVERSE.MOMENTUM_MOVERS) {
return (
(priceChange != null && priceChange > 0) ||
buyPressure >= 55 ||
persistence >= 55
);
}

if (universe === SENTINEL_DISCOVERY_UNIVERSE.CLEAN_RECLAIMS) {
return (
sellerExhaustion >= 45 &&
reclaimStrength >= 45 &&
buyPressure >= 45 &&
persistence >= 45
);
}

if (universe === SENTINEL_DISCOVERY_UNIVERSE.STRUCTURAL_CANDIDATES) {
return (
structuralHealth >= 45 ||
operatorQuality >= 55 ||
(top5 != null && top5 <= 55 && top1 != null && top1 <= 30)
);
}

if (universe === SENTINEL_DISCOVERY_UNIVERSE.OPEN_POSITIONS) {
return Boolean(snapshot.has_live_position_context || snapshot.position_id);
}

if (universe === SENTINEL_DISCOVERY_UNIVERSE.RISK_MONITOR) {
return (
(top5 != null && top5 >= 65) ||
(top1 != null && top1 >= 35) ||
contamination >= 45 ||
hiddenControl >= 45 ||
coordination >= 45
);
}

return true;
}

function tagSnapshotForDiscovery(snapshot = {}, universe, score, rank) {
return {
...snapshot,
meta: {
...(snapshot.meta || {}),
discovery_universes: uniqueCleanList([
...(snapshot.meta?.discovery_universes || []),
universe,
]),
discovery_scores: {
...(snapshot.meta?.discovery_scores || {}),
[universe]: score,
},
discovery_ranks: {
...(snapshot.meta?.discovery_ranks || {}),
[universe]: rank,
},
primary_discovery_universe:
snapshot.meta?.primary_discovery_universe || universe,
},
};
}

function selectDiscoverySnapshots(snapshots = [], options = {}) {
const universes = resolveDiscoveryUniverses(options.discovery_universes);
const perUniverseLimit = normalizeDiscoveryLimitPerUniverse(
options.discovery_limit_per_universe,
DEFAULT_DISCOVERY_LIMIT_PER_UNIVERSE
);

const selections = [];
const universeMeta = {};

for (const universe of universes) {
const ranked = (Array.isArray(snapshots) ? snapshots : [])
.filter((snapshot) => snapshotMatchesDiscoveryUniverse(snapshot, universe))
.map((snapshot) => ({
snapshot,
score: getDiscoveryScore(snapshot, universe),
}))
.sort((a, b) => {
if (b.score !== a.score) return b.score - a.score;
return getSnapshotTimestampMs(b.snapshot) - getSnapshotTimestampMs(a.snapshot);
});

const selected = ranked.slice(0, perUniverseLimit);

universeMeta[universe] = {
matched: ranked.length,
selected: selected.length,
top_preview: selected.slice(0, 10).map((item, index) => ({
rank: index + 1,
token_id: getSnapshotToken(item.snapshot),
score: Number(item.score.toFixed(4)),
marketcap_usd: getSnapshotMarketcap(item.snapshot),
liquidity_usd: getSnapshotLiquidity(item.snapshot),
volume_usd: getSnapshotVolumeUsd(item.snapshot),
top_5_holder_pct:
item.snapshot.top_5_holder_pct ?? item.snapshot.top5HolderPct ?? null,
})),
};

selected.forEach((item, index) => {
selections.push(tagSnapshotForDiscovery(item.snapshot, universe, item.score, index + 1));
});
}

return {
snapshots: mergeSnapshotsByToken([selections]),
meta: {
universes,
limit_per_universe: perUniverseLimit,
universe_meta: universeMeta,
},
};
}

export function summarizeSnapshotBatch(snapshots = []) {
const safeSnapshots = Array.isArray(snapshots) ? snapshots : [];

return {
total: safeSnapshots.length,
token_ids: safeSnapshots.map((item) => item.token_id).filter(Boolean),
summaries: safeSnapshots
.slice(0, 20)
.map((item) => summarizeSentinelSnapshot(item)),
};
}

export function buildSnapshotsFromRows(rows = [], options = {}) {
const normalized = [];
const sortedRows = sortRowsNewestFirst(rows);

for (const row of sortedRows) {
try {
if (!isRowFreshEnough(row, options.max_age_minutes)) continue;

const snapshot = buildSnapshotFromRow(row, options);
if (snapshot) normalized.push(snapshot);
} catch {
// Skip malformed rows safely.
}
}

return dedupeSnapshotsByToken(
filterSnapshots(normalizeSentinelSnapshots(normalized, options), options)
);
}

export function buildSnapshotsFromScans(scans = [], options = {}) {
const snapshots = (Array.isArray(scans) ? scans : []).map((scan) =>
buildSentinelSnapshotFromSecurityScan(scan, {
source: cleanText(options.source, 120) || "scan_list",
execution_mode:
cleanText(options.execution_mode, 64) || SENTINEL_MODE.PAPER,
min_liquidity_usd: options.min_liquidity_usd,
})
);

return dedupeSnapshotsByToken(
filterSnapshots(normalizeSentinelSnapshots(snapshots, options), options)
);
}

export function readRecentScanCacheRows({
limit = DEFAULT_SNAPSHOT_PROVIDER_LIMIT,
} = {}) {
const safeLimit = normalizeLimit(limit);

const candidateQueries = [
`SELECT * FROM scan_cache ORDER BY updated_at DESC LIMIT ?`,
`SELECT * FROM scan_cache ORDER BY last_updated_at DESC LIMIT ?`,
`SELECT * FROM scan_cache ORDER BY last_scanned_at DESC LIMIT ?`,
`SELECT * FROM scan_cache ORDER BY scanned_at DESC LIMIT ?`,
`SELECT * FROM scan_cache ORDER BY created_at DESC LIMIT ?`,
`SELECT * FROM scan_cache ORDER BY id DESC LIMIT ?`,
];

let lastError = null;

for (const sql of candidateQueries) {
try {
return scannerDb.prepare(sql).all(safeLimit);
} catch (error) {
lastError = error;
}
}

if (lastError) throw lastError;
return [];
}

export async function loadScannerCacheSnapshots({
limit = DEFAULT_SNAPSHOT_PROVIDER_LIMIT,
max_age_minutes = DEFAULT_SNAPSHOT_PROVIDER_MAX_AGE_MINUTES,
min_liquidity_usd = 0,
execution_mode = SENTINEL_MODE.PAPER,
} = {}) {
const rows = readRecentScanCacheRows({ limit });

return buildSnapshotsFromRows(rows, {
max_age_minutes,
min_liquidity_usd,
execution_mode,
});
}

export function createScannerCacheSnapshotProvider(providerOptions = {}) {
const baseOptions = {
limit: DEFAULT_SNAPSHOT_PROVIDER_LIMIT,
max_age_minutes: DEFAULT_SNAPSHOT_PROVIDER_MAX_AGE_MINUTES,
min_liquidity_usd: 0,
require_usable: true,
execution_mode: SENTINEL_MODE.PAPER,

include_open_positions: true,
open_position_limit: DEFAULT_OPEN_POSITION_LIMIT,
open_position_max_age_minutes: DEFAULT_OPEN_POSITION_MAX_AGE_MINUTES,
live_price_enabled: true,

include_discovery_universes: true,
discovery_pool_limit: DEFAULT_DISCOVERY_POOL_LIMIT,
discovery_max_age_minutes: DEFAULT_DISCOVERY_MAX_AGE_MINUTES,
discovery_limit_per_universe: DEFAULT_DISCOVERY_LIMIT_PER_UNIVERSE,
discovery_universes: DEFAULT_DISCOVERY_UNIVERSES,

...providerOptions,
};

return async function scannerCacheSnapshotProvider(runtime = {}) {
const config = runtime?.config || {};
const context = runtime?.context || {};

const execution_mode = resolveExecutionMode(
context.execution_mode,
config.execution_mode,
baseOptions.execution_mode,
SENTINEL_MODE.PAPER
);

const min_liquidity_usd =
toFloat(context.min_liquidity_usd, null) ??
toFloat(context.snapshot_min_liquidity_usd, null) ??
toFloat(baseOptions.min_liquidity_usd, null) ??
0;

const max_age_minutes =
toInt(context.max_age_minutes, null) ??
toInt(context.snapshot_max_age_minutes, null) ??
toInt(baseOptions.max_age_minutes, null) ??
DEFAULT_SNAPSHOT_PROVIDER_MAX_AGE_MINUTES;

const open_position_max_age_minutes =
toInt(context.open_position_max_age_minutes, null) ??
toInt(context.snapshot_open_position_max_age_minutes, null) ??
toInt(baseOptions.open_position_max_age_minutes, null) ??
DEFAULT_OPEN_POSITION_MAX_AGE_MINUTES;

const discovery_max_age_minutes =
toInt(context.discovery_max_age_minutes, null) ??
toInt(context.snapshot_discovery_max_age_minutes, null) ??
toInt(baseOptions.discovery_max_age_minutes, null) ??
DEFAULT_DISCOVERY_MAX_AGE_MINUTES;

const limit =
toInt(context.limit, null) ??
toInt(context.snapshot_limit, null) ??
toInt(baseOptions.limit, null) ??
DEFAULT_SNAPSHOT_PROVIDER_LIMIT;

const discovery_pool_limit = normalizeDiscoveryLimit(
context.discovery_pool_limit ??
context.snapshot_discovery_pool_limit ??
baseOptions.discovery_pool_limit,
DEFAULT_DISCOVERY_POOL_LIMIT
);

const discovery_limit_per_universe = normalizeDiscoveryLimitPerUniverse(
context.discovery_limit_per_universe ??
context.snapshot_discovery_limit_per_universe ??
baseOptions.discovery_limit_per_universe,
DEFAULT_DISCOVERY_LIMIT_PER_UNIVERSE
);

const open_position_limit = normalizeOpenPositionLimit(
context.open_position_limit ??
context.snapshot_open_position_limit ??
baseOptions.open_position_limit,
DEFAULT_OPEN_POSITION_LIMIT
);

const require_usable =
context.require_usable == null
? baseOptions.require_usable !== false
: Boolean(context.require_usable);

const include_open_positions =
context.include_open_positions == null
? baseOptions.include_open_positions !== false
: Boolean(context.include_open_positions);

const include_discovery_universes =
context.include_discovery_universes == null
? baseOptions.include_discovery_universes !== false
: Boolean(context.include_discovery_universes);

const discovery_universes = resolveDiscoveryUniverses(
context.discovery_universes ??
context.snapshot_discovery_universes ??
baseOptions.discovery_universes
);

const directSnapshots = resolveContextArray(context, [
"snapshots",
"sentinel_snapshots",
]);

if (directSnapshots) {
const snapshots = dedupeSnapshotsByToken(
filterSnapshots(
normalizeSentinelSnapshots(directSnapshots, {
execution_mode,
}),
{
min_liquidity_usd,
require_usable,
}
)
);

return {
snapshots,
meta: {
source: "context.snapshots",
summary: summarizeSnapshotBatch(snapshots),
},
};
}

const directScans = resolveContextArray(context, ["scans", "security_scans"]);

if (directScans) {
const snapshots = buildSnapshotsFromScans(directScans, {
source: "context.scans",
execution_mode,
min_liquidity_usd,
require_usable,
});

return {
snapshots,
meta: {
source: "context.scans",
summary: summarizeSnapshotBatch(snapshots),
},
};
}

const directRows = resolveContextArray(context, [
"scan_cache_rows",
"rows",
"scan_rows",
]);

if (directRows) {
const directRowSnapshots = buildSnapshotsFromRows(directRows, {
max_age_minutes,
min_liquidity_usd,
execution_mode,
require_usable,
});

const discoverySelection = include_discovery_universes
? selectDiscoverySnapshots(directRowSnapshots, {
discovery_universes,
discovery_limit_per_universe,
})
: {
snapshots: [],
meta: null,
};

const snapshots = include_discovery_universes
? mergeSnapshotsByToken([directRowSnapshots, discoverySelection.snapshots])
: directRowSnapshots;

return {
snapshots,
meta: {
source: "context.scan_cache_rows",
discovery: discoverySelection.meta,
summary: summarizeSnapshotBatch(snapshots),
},
};
}

const recentRows = readRecentScanCacheRows({ limit });
const discoveryRows = include_discovery_universes
? readRecentScanCacheRows({ limit: discovery_pool_limit })
: [];

const recentSnapshots = buildSnapshotsFromRows(recentRows, {
max_age_minutes,
min_liquidity_usd,
execution_mode,
require_usable,
});

const discoveryPoolSnapshots = include_discovery_universes
? buildSnapshotsFromRows(discoveryRows, {
max_age_minutes: discovery_max_age_minutes,
min_liquidity_usd: 0,
execution_mode,
require_usable,
})
: [];

const discoverySelection = include_discovery_universes
? selectDiscoverySnapshots(discoveryPoolSnapshots, {
discovery_universes,
discovery_limit_per_universe,
})
: {
snapshots: [],
meta: null,
};

let openPositions = [];
let openPositionRows = [];
let livePriceResult = {
prices: new Map(),
meta: {
requested: 0,
resolved: 0,
providers: [],
errors: [],
},
};

if (include_open_positions) {
try {
openPositions = await listOpenPositions(
execution_mode,
open_position_limit
);
} catch {
openPositions = [];
}

const openPositionTokens = getPositionLookupTokens(openPositions);

openPositionRows = readScanCacheRowsForTokens(openPositionTokens, {
limitPerColumn: Math.max(open_position_limit * 3, 500),
});

livePriceResult = await fetchLivePrices(openPositionTokens, {
...baseOptions,
...context,
execution_mode,
});
}

const openPositionSnapshots = buildSnapshotsFromRows(openPositionRows, {
max_age_minutes: open_position_max_age_minutes,
min_liquidity_usd: 0,
execution_mode,
require_usable,
});

const mergedSnapshots = mergeSnapshotsByToken([
recentSnapshots,
discoverySelection.snapshots,
openPositionSnapshots,
]);

const patched = patchSnapshotsWithOpenPositions({
snapshots: mergedSnapshots,
positions: openPositions,
livePrices: livePriceResult.prices,
executionMode: execution_mode,
});

const snapshots = dedupeSnapshotsByToken(
filterSnapshots(normalizeSentinelSnapshots(patched.snapshots, {
execution_mode,
}), {
min_liquidity_usd,
require_usable,
})
);

return {
snapshots,
meta: {
source: include_open_positions
? "scanner_cache_with_open_position_tracking"
: "scanner_cache",
recent_rows: recentRows.length,
discovery_rows: discoveryRows.length,
discovery_pool_snapshots: discoveryPoolSnapshots.length,
discovery_universes_enabled: include_discovery_universes,
discovery_universes,
discovery_limit_per_universe,
discovery: discoverySelection.meta,
open_positions_loaded: openPositions.length,
open_position_rows_found: openPositionRows.length,
open_position_snapshots_found: openPositionSnapshots.length,
open_position_snapshots_patched: patched.patched_count,
live_price_patched_positions: patched.live_price_patched_count,
live_prices_requested: livePriceResult.meta.requested,
live_prices_resolved: livePriceResult.meta.resolved,
live_price_providers: livePriceResult.meta.providers,
live_price_errors: livePriceResult.meta.errors,
merged_rows: recentRows.length + discoveryRows.length + openPositionRows.length,
include_open_positions,
max_age_minutes,
discovery_max_age_minutes,
open_position_max_age_minutes,
min_liquidity_usd,
summary: summarizeSnapshotBatch(snapshots),
},
};
};
}

export const scannerCacheSnapshotProvider = createScannerCacheSnapshotProvider();

export default {
DEFAULT_SNAPSHOT_PROVIDER_LIMIT,
DEFAULT_SNAPSHOT_PROVIDER_MAX_AGE_MINUTES,
DEFAULT_OPEN_POSITION_LIMIT,
DEFAULT_OPEN_POSITION_MAX_AGE_MINUTES,
DEFAULT_DISCOVERY_POOL_LIMIT,
DEFAULT_DISCOVERY_MAX_AGE_MINUTES,
DEFAULT_DISCOVERY_LIMIT_PER_UNIVERSE,
SENTINEL_DISCOVERY_UNIVERSE,
DEFAULT_DISCOVERY_UNIVERSES,
summarizeSnapshotBatch,
buildSnapshotsFromRows,
buildSnapshotsFromScans,
readRecentScanCacheRows,
loadScannerCacheSnapshots,
createScannerCacheSnapshotProvider,
scannerCacheSnapshotProvider,
};