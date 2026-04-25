import { createEliteChartRenderer } from "../assets/chart-renderer.js";

const PHASES = {
COMMIT: "commit",
COUNTDOWN: "countdown",
BUILDING: "building",
LIVE: "live",
};

const TRADE_MODES = {
BUY: "buy",
SELL: "sell",
};

const EXTERNAL_LINK_TYPES = [
{ key: "website_url", label: "Website", icon: "◉" },
{ key: "x_url", label: "X", icon: "𝕏" },
{ key: "telegram_url", label: "Telegram", icon: "✈" },
{ key: "discord_url", label: "Discord", icon: "◎" },
];

const BASE_MAX_WALLET_PERCENT = 0.5;
const DAILY_INCREASE_PERCENT = 0.5;
const BUILDER_MAX_WALLET_PERCENT = 5;

function $(id) {
return document.getElementById(id);
}

function getApiBase() {
const { protocol, hostname, port } = window.location;

if (port === "3000") {
return `${protocol}//${hostname}:8787`;
}

if (hostname.includes("-3000.app.github.dev")) {
return `${protocol}//${hostname.replace("-3000.app.github.dev", "-8787.app.github.dev")}`;
}

return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
}

function toNumber(value, fallback = 0) {
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function toInt(value, fallback = 0) {
return Math.max(0, Math.floor(toNumber(value, fallback)));
}

function cleanString(value, max = 2000) {
return String(value ?? "").trim().slice(0, max);
}

function shortAddress(value, left = 6, right = 4) {
if (!value || typeof value !== "string") return "Pending";
if (value.length <= left + right + 3) return value;
return `${value.slice(0, left)}...${value.slice(-right)}`;
}

function escapeHtml(value) {
return String(value ?? "")
.replaceAll("&", "&amp;")
.replaceAll("<", "&lt;")
.replaceAll(">", "&gt;")
.replaceAll('"', "&quot;")
.replaceAll("'", "&#39;");
}

function formatNumber(value, options = {}) {
const num = toNumber(value, 0);
const {
minimumFractionDigits = 0,
maximumFractionDigits = 2,
} = options;

return new Intl.NumberFormat(undefined, {
minimumFractionDigits,
maximumFractionDigits,
}).format(num);
}

function formatPercent(value, maximumFractionDigits = 2) {
const num = toNumber(value, 0);
return `${formatNumber(num, { maximumFractionDigits })}%`;
}

function formatSol(value, maximumFractionDigits = 4) {
const num = toNumber(value, 0);
return `${formatNumber(num, { maximumFractionDigits })} SOL`;
}

function formatUsd(value, maximumFractionDigits = 2) {
const num = toNumber(value, 0);
return new Intl.NumberFormat(undefined, {
style: "currency",
currency: "USD",
minimumFractionDigits: 0,
maximumFractionDigits,
}).format(num);
}

function formatUsdCompact(value, maximumFractionDigits = 2) {
const num = toNumber(value, 0);
if (num <= 0) return "$0";
return new Intl.NumberFormat(undefined, {
style: "currency",
currency: "USD",
notation: "compact",
minimumFractionDigits: 0,
maximumFractionDigits,
}).format(num);
}

function formatPriceSol(value) {
const num = toNumber(value, 0);
if (num <= 0) return "—";
if (num >= 1) return formatNumber(num, { maximumFractionDigits: 4 });
if (num >= 0.01) return formatNumber(num, { maximumFractionDigits: 6 });
return formatNumber(num, { maximumFractionDigits: 10 });
}

function formatPriceUsd(value) {
const num = toNumber(value, 0);
if (num <= 0) return "—";
if (num >= 1) return formatUsd(num, 4);
if (num >= 0.01) return formatUsd(num, 6);
return formatUsd(num, 8);
}

function formatTokenAmount(value, maximumFractionDigits = 0) {
const num = toNumber(value, 0);
return formatNumber(num, { maximumFractionDigits });
}

function formatDateTime(value) {
if (!value) return "—";
const d = new Date(value);
if (!Number.isFinite(d.getTime())) return "—";
return d.toLocaleString([], {
month: "short",
day: "2-digit",
hour: "2-digit",
minute: "2-digit",
});
}

function formatRelativeTime(value) {
if (!value) return "—";
const ts = parseDateMs(value);
if (!ts) return "—";

const diffMs = Date.now() - ts;
const abs = Math.abs(diffMs);
const future = diffMs < 0;

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

let text = "just now";

if (abs >= day) {
text = `${Math.floor(abs / day)}d`;
} else if (abs >= hour) {
text = `${Math.floor(abs / hour)}h`;
} else if (abs >= minute) {
text = `${Math.floor(abs / minute)}m`;
}

return future ? `in ${text}` : `${text} ago`;
}

function normalizeUrl(raw, typeKey = "") {
const value = String(raw || "").trim();
if (!value) return "";
if (/^javascript:/i.test(value) || /^data:/i.test(value)) return "";

let normalized = value;
if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;

try {
const url = new URL(normalized);
if (!["http:", "https:"].includes(url.protocol)) return "";

const host = url.hostname.toLowerCase();

if (typeKey === "x_url" && !(host.includes("x.com") || host.includes("twitter.com"))) return "";
if (typeKey === "telegram_url" && !(host.includes("t.me") || host.includes("telegram.me"))) return "";
if (typeKey === "discord_url" && !(host.includes("discord.gg") || host.includes("discord.com"))) return "";

return url.toString();
} catch {
return "";
}
}

function parseDateMs(value) {
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

function getNowMs() {
return Date.now();
}

function choosePreferredNonEmpty(...values) {
for (const value of values) {
const cleaned = cleanString(value, 2000);
if (cleaned) return cleaned;
}
return "";
}

function firstFinite(...values) {
for (const value of values) {
const num = Number(value);
if (Number.isFinite(num)) return num;
}
return null;
}

function firstPositive(...values) {
for (const value of values) {
const num = Number(value);
if (Number.isFinite(num) && num > 0) return num;
}
return null;
}

function getLaunchDisplayName(launch = {}, tokenPayload = null) {
return choosePreferredNonEmpty(
launch?.token_name,
tokenPayload?.token?.name,
tokenPayload?.launch?.token_name,
tokenPayload?.launch?.name,
"Unnamed Launch"
);
}

function getLaunchSymbol(launch = {}, tokenPayload = null) {
const raw = choosePreferredNonEmpty(
launch?.symbol,
tokenPayload?.token?.symbol,
tokenPayload?.token?.ticker,
tokenPayload?.launch?.symbol,
"MSS"
);
return raw.replace(/^\$+/, "") || "MSS";
}

function getInitials(...values) {
const text = choosePreferredNonEmpty(...values);
if (!text) return "M";
const cleaned = text.replace(/[^a-zA-Z0-9 ]/g, " ").trim();
if (!cleaned) return "M";
const parts = cleaned.split(/\s+/).filter(Boolean);
if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
return cleaned.slice(0, 2).toUpperCase();
}

function formatUsdThenSol(usdValue, solValue, { compactUsd = false, solDecimals = 4 } = {}) {
const usd = toNumber(usdValue, 0);
const sol = toNumber(solValue, 0);

if (usd > 0 && sol > 0) {
return `${compactUsd ? formatUsdCompact(usd, 2) : formatUsd(usd, 4)} • ${formatSol(sol, solDecimals)}`;
}

if (usd > 0) {
return compactUsd ? formatUsdCompact(usd, 2) : formatUsd(usd, 4);
}

if (sol > 0) {
return formatSol(sol, solDecimals);
}

return "—";
}

function normalizeGraduationReadinessPayload(raw = {}) {
if (!raw || typeof raw !== "object") return null;

return {
ready: Boolean(raw.ready),
reason: cleanString(raw.reason, 500) || "",
thresholds:
raw.thresholds && typeof raw.thresholds === "object"
? {
marketcapSol: toNumber(raw.thresholds.marketcapSol ?? raw.thresholds.marketcap_sol, 0),
volume24hSol: toNumber(raw.thresholds.volume24hSol ?? raw.thresholds.volume24h_sol, 0),
minHolders: toInt(raw.thresholds.minHolders ?? raw.thresholds.min_holders, 0),
minLiveMinutes: toInt(raw.thresholds.minLiveMinutes ?? raw.thresholds.min_live_minutes, 0),
lockDays: toInt(raw.thresholds.lockDays ?? raw.thresholds.lock_days, 0),
}
: null,
metrics:
raw.metrics && typeof raw.metrics === "object"
? {
marketcapSol: toNumber(raw.metrics.marketcapSol ?? raw.metrics.marketcap_sol, 0),
volume24hSol: toNumber(raw.metrics.volume24hSol ?? raw.metrics.volume24h_sol, 0),
holderCount: toInt(raw.metrics.holderCount ?? raw.metrics.holder_count, 0),
liveMinutes: toInt(raw.metrics.liveMinutes ?? raw.metrics.live_minutes, 0),
solReserve: toNumber(raw.metrics.solReserve ?? raw.metrics.sol_reserve, 0),
tokenReserve: toInt(raw.metrics.tokenReserve ?? raw.metrics.token_reserve, 0),
priceSol: toNumber(raw.metrics.priceSol ?? raw.metrics.price_sol, 0),
totalSupply: toInt(raw.metrics.totalSupply ?? raw.metrics.total_supply, 0),
}
: null,
checks:
raw.checks && typeof raw.checks === "object"
? {
liveStatus: Boolean(raw.checks.liveStatus ?? raw.checks.live_status),
marketcapReached: Boolean(raw.checks.marketcapReached ?? raw.checks.marketcap_reached),
volumeReached: Boolean(raw.checks.volumeReached ?? raw.checks.volume_reached),
holdersReached: Boolean(raw.checks.holdersReached ?? raw.checks.holders_reached),
minimumLiveWindowReached: Boolean(
raw.checks.minimumLiveWindowReached ?? raw.checks.minimum_live_window_reached
),
hasReserves: Boolean(raw.checks.hasReserves ?? raw.checks.has_reserves),
alreadyGraduated: Boolean(raw.checks.alreadyGraduated ?? raw.checks.already_graduated),
}
: null,
};
}

function normalizeBuilderVestingPayload(raw = {}) {
if (!raw || typeof raw !== "object") {
return {
builderWallet: "",
totalAllocation: 0,
dailyUnlock: 0,
unlockedAmount: 0,
lockedAmount: 0,
vestingStartAt: null,
createdAt: null,
updatedAt: null,
vestedDays: 0,
};
}

return {
builderWallet: choosePreferredNonEmpty(raw.builderWallet, raw.builder_wallet),
totalAllocation: toInt(raw.totalAllocation ?? raw.total_allocation, 0),
dailyUnlock: toInt(raw.dailyUnlock ?? raw.daily_unlock, 0),
unlockedAmount: toInt(raw.unlockedAmount ?? raw.unlocked_amount, 0),
lockedAmount: toInt(raw.lockedAmount ?? raw.locked_amount, 0),
vestingStartAt: raw.vestingStartAt ?? raw.vesting_start_at ?? null,
createdAt: raw.createdAt ?? raw.created_at ?? null,
updatedAt: raw.updatedAt ?? raw.updated_at ?? null,
vestedDays: toInt(raw.vestedDays ?? raw.vested_days, 0),
};
}

function normalizeLifecyclePayload(raw = {}) {
if (!raw || typeof raw !== "object") return null;

const builderVesting = normalizeBuilderVestingPayload(
raw.builderVesting || raw.builder_vesting || {}
);

return {
launchStatus: cleanString(raw.launchStatus ?? raw.launch_status, 80).toLowerCase(),
internalSolReserve: toNumber(raw.internalSolReserve ?? raw.internal_sol_reserve, 0),
internalTokenReserve: toInt(raw.internalTokenReserve ?? raw.internal_token_reserve, 0),
impliedMarketcapSol: toNumber(raw.impliedMarketcapSol ?? raw.implied_marketcap_sol, 0),
graduationStatus:
cleanString(raw.graduationStatus ?? raw.graduation_status, 120) || "internal_live",
graduated: Boolean(raw.graduated),
graduationReason:
cleanString(raw.graduationReason ?? raw.graduation_reason, 200) || null,
graduatedAt: raw.graduatedAt ?? raw.graduated_at ?? null,
raydiumTargetPct: toNumber(raw.raydiumTargetPct ?? raw.raydium_target_pct, 50),
mssLockedTargetPct: toNumber(raw.mssLockedTargetPct ?? raw.mss_locked_target_pct, 50),
raydiumPoolId: cleanString(raw.raydiumPoolId ?? raw.raydium_pool_id, 240),
raydiumSolMigrated: toNumber(raw.raydiumSolMigrated ?? raw.raydium_sol_migrated, 0),
raydiumTokenMigrated: toInt(raw.raydiumTokenMigrated ?? raw.raydium_token_migrated, 0),
raydiumLpTokens: cleanString(raw.raydiumLpTokens ?? raw.raydium_lp_tokens, 240),
raydiumMigrationTx: cleanString(raw.raydiumMigrationTx ?? raw.raydium_migration_tx, 240),
mssLockedSol: toNumber(raw.mssLockedSol ?? raw.mss_locked_sol, 0),
mssLockedToken: toInt(raw.mssLockedToken ?? raw.mss_locked_token, 0),
mssLockedLpAmount: cleanString(raw.mssLockedLpAmount ?? raw.mss_locked_lp_amount, 240),
lockStatus: cleanString(raw.lockStatus ?? raw.lock_status, 120) || "not_locked",
lockTx: cleanString(raw.lockTx ?? raw.lock_tx, 240),
lockExpiresAt: raw.lockExpiresAt ?? raw.lock_expires_at ?? null,
graduationReadiness: normalizeGraduationReadinessPayload(
raw.graduationReadiness || raw.graduation_readiness || null
),
builderVesting,
};
}

function normalizeGraduationPlanPayload(raw = {}) {
if (!raw || typeof raw !== "object") return null;

return {
raydiumSplitPct: toNumber(raw.raydiumSplitPct ?? raw.raydium_split_pct ?? raw.raydiumTargetPct ?? raw.raydium_target_pct, 50),
mssLockedSplitPct: toNumber(raw.mssLockedSplitPct ?? raw.mss_locked_split_pct ?? raw.mssLockedTargetPct ?? raw.mss_locked_target_pct, 50),
marketcapThresholdSol: toNumber(raw.marketcapThresholdSol ?? raw.marketcap_threshold_sol, 0),
volume24hThresholdSol: toNumber(raw.volume24hThresholdSol ?? raw.volume24h_threshold_sol, 0),
minHolders: toInt(raw.minHolders ?? raw.min_holders, 0),
minLiveMinutes: toInt(raw.minLiveMinutes ?? raw.min_live_minutes, 0),
lockDays: toInt(raw.lockDays ?? raw.lock_days, 0),
};
}

function buildLaunchPatchFromTokenPayload(tokenPayload = {}) {
const token = tokenPayload?.token || {};
const launch = tokenPayload?.launch || {};
const stats = tokenPayload?.stats || {};

return normalizeLaunchTruth({
token_name: choosePreferredNonEmpty(
launch?.token_name,
launch?.name,
token?.name
),
symbol: choosePreferredNonEmpty(
launch?.symbol,
token?.symbol,
token?.ticker
),
builder_wallet: choosePreferredNonEmpty(
launch?.builder_wallet
),
builder_alias: choosePreferredNonEmpty(
launch?.builder_alias
),
builder_score: firstPositive(
launch?.builder_score,
stats?.builder_score
) ?? 0,
image_url: choosePreferredNonEmpty(
launch?.image_url,
token?.image_url,
token?.logo_uri,
token?.logo
),
description: choosePreferredNonEmpty(
launch?.description
),
website_url: choosePreferredNonEmpty(
launch?.website_url
),
x_url: choosePreferredNonEmpty(
launch?.x_url
),
telegram_url: choosePreferredNonEmpty(
launch?.telegram_url
),
discord_url: choosePreferredNonEmpty(
launch?.discord_url
),
final_supply: choosePreferredNonEmpty(
token?.supply,
token?.total_supply,
stats?.total_supply,
launch?.final_supply
),
supply: choosePreferredNonEmpty(
token?.supply,
token?.total_supply,
stats?.total_supply,
launch?.supply
),
contract_address: choosePreferredNonEmpty(
launch?.contract_address,
token?.mint_address,
token?.mint,
tokenPayload?.mint_address,
tokenPayload?.mint
),
mint_address: choosePreferredNonEmpty(
token?.mint_address,
token?.mint,
tokenPayload?.mint_address,
tokenPayload?.mint,
launch?.mint_address
),
price: firstPositive(
launch?.price,
stats?.price,
stats?.price_sol
) ?? 0,
market_cap: firstPositive(
launch?.market_cap,
stats?.market_cap,
stats?.market_cap_sol
) ?? 0,
liquidity: firstPositive(
launch?.liquidity,
stats?.liquidity,
stats?.liquidity_sol
) ?? 0,
volume_24h: firstPositive(
launch?.volume_24h,
stats?.volume_24h,
stats?.volume_24h_sol
) ?? 0,
status: choosePreferredNonEmpty(
launch?.status
),
live_at: choosePreferredNonEmpty(
launch?.live_at
),
countdown_started_at: choosePreferredNonEmpty(
launch?.countdown_started_at
),
countdown_ends_at: choosePreferredNonEmpty(
launch?.countdown_ends_at
),
commit_started_at: choosePreferredNonEmpty(
launch?.commit_started_at
),
commit_ends_at: choosePreferredNonEmpty(
launch?.commit_ends_at
),
template: cleanString(launch?.template, 80),
});
}

function buildLaunchPatchFromCommitStats(commitStats = {}) {
return normalizeLaunchTruth({
status: choosePreferredNonEmpty(
commitStats?.status
),
committed_sol: firstFinite(
commitStats?.totalCommitted,
commitStats?.committed_sol
) ?? 0,
participants_count: firstFinite(
commitStats?.participants,
commitStats?.participants_count
) ?? 0,
hard_cap_sol: firstFinite(
commitStats?.hardCap,
commitStats?.hard_cap_sol,
commitStats?.hard_cap
) ?? 0,
min_raise_sol: firstFinite(
commitStats?.minRaise,
commitStats?.min_raise_sol,
commitStats?.min_raise
) ?? 0,
commit_started_at: choosePreferredNonEmpty(
commitStats?.commitStartedAt,
commitStats?.commit_started_at
),
commit_ends_at: choosePreferredNonEmpty(
commitStats?.commitEndsAt,
commitStats?.commit_ends_at
),
countdown_started_at: choosePreferredNonEmpty(
commitStats?.countdownStartedAt,
commitStats?.countdown_started_at
),
countdown_ends_at: choosePreferredNonEmpty(
commitStats?.countdownEndsAt,
commitStats?.countdown_ends_at
),
live_at: choosePreferredNonEmpty(
commitStats?.liveAt,
commitStats?.live_at,
commitStats?.countdownEndsAt,
commitStats?.countdown_ends_at
),
builder_wallet: choosePreferredNonEmpty(
commitStats?.builderWallet,
commitStats?.builder_wallet
),
builder_alias: choosePreferredNonEmpty(
commitStats?.builderAlias,
commitStats?.builder_alias
),
builder_score: firstFinite(
commitStats?.builderScore,
commitStats?.builder_score
) ?? 0,
website_url: choosePreferredNonEmpty(
commitStats?.websiteUrl,
commitStats?.website_url
),
x_url: choosePreferredNonEmpty(
commitStats?.xUrl,
commitStats?.x_url
),
telegram_url: choosePreferredNonEmpty(
commitStats?.telegramUrl,
commitStats?.telegram_url
),
discord_url: choosePreferredNonEmpty(
commitStats?.discordUrl,
commitStats?.discord_url
),
});
}

function setText(id, value) {
const el = typeof id === "string" ? $(id) : id;
if (el) el.textContent = value;
}

function setTextMany(ids, value) {
ids.forEach((id) => setText(id, value));
}

function setHtml(id, value) {
const el = typeof id === "string" ? $(id) : id;
if (el) el.innerHTML = value;
}

function toggleHidden(id, hidden) {
const el = typeof id === "string" ? $(id) : id;
if (el) el.classList.toggle("hidden", Boolean(hidden));
}

function setTitleMany(ids, value) {
ids.forEach((id) => {
const el = $(id);
if (el) {
if (value) {
el.setAttribute("title", value);
} else {
el.removeAttribute("title");
}
}
});
}

function normalizeLaunchTruth(raw = {}) {
return {
...(raw || {}),
status: cleanString(raw?.status, 64).toLowerCase(),
contract_address: cleanString(raw?.contract_address, 200),
mint_address: cleanString(raw?.mint_address, 200),
reserved_mint_address: cleanString(raw?.reserved_mint_address, 200),
mint_reservation_status: cleanString(raw?.mint_reservation_status, 64).toLowerCase(),
live_at: raw?.live_at || null,
countdown_started_at: raw?.countdown_started_at || null,
countdown_ends_at: raw?.countdown_ends_at || null,
commit_started_at: raw?.commit_started_at || null,
commit_ends_at: raw?.commit_ends_at || null,
created_at: raw?.created_at || null,
updated_at: raw?.updated_at || null,
final_supply: raw?.final_supply ?? "",
supply: raw?.supply ?? "",
builder_wallet: cleanString(raw?.builder_wallet, 200),
builder_alias: cleanString(raw?.builder_alias, 200),
builder_score: toNumber(raw?.builder_score, 0),
token_name: cleanString(raw?.token_name, 200),
symbol: cleanString(raw?.symbol, 80),
website_url: cleanString(raw?.website_url, 500),
x_url: cleanString(raw?.x_url, 500),
telegram_url: cleanString(raw?.telegram_url, 500),
discord_url: cleanString(raw?.discord_url, 500),
description: cleanString(raw?.description, 4000),
image_url: cleanString(raw?.image_url, 2000),
committed_sol: toNumber(raw?.committed_sol, 0),
participants_count: toNumber(raw?.participants_count, 0),
hard_cap_sol: toNumber(raw?.hard_cap_sol, 0),
min_raise_sol: toNumber(raw?.min_raise_sol, 0),
price: toNumber(raw?.price, 0),
market_cap: toNumber(raw?.market_cap, 0),
liquidity: toNumber(raw?.liquidity, 0),
volume_24h: toNumber(raw?.volume_24h, 0),
template: cleanString(raw?.template, 80),
};
}

function mergeLaunchTruth(previous = {}, incoming = {}) {
const prev = normalizeLaunchTruth(previous || {});
const next = normalizeLaunchTruth(incoming || {});

const prevContract = choosePreferredNonEmpty(prev.contract_address, prev.mint_address);
const nextContract = choosePreferredNonEmpty(next.contract_address, next.mint_address);
const strongestContract = choosePreferredNonEmpty(nextContract, prevContract);

const merged = {
...prev,
...next,
};

merged.status = choosePreferredNonEmpty(next.status, prev.status);
merged.token_name = choosePreferredNonEmpty(next.token_name, prev.token_name);
merged.symbol = choosePreferredNonEmpty(next.symbol, prev.symbol);
merged.builder_wallet = choosePreferredNonEmpty(next.builder_wallet, prev.builder_wallet);
merged.builder_alias = choosePreferredNonEmpty(next.builder_alias, prev.builder_alias);
merged.template = choosePreferredNonEmpty(next.template, prev.template);
merged.description = choosePreferredNonEmpty(next.description, prev.description);
merged.image_url = choosePreferredNonEmpty(next.image_url, prev.image_url);
merged.website_url = choosePreferredNonEmpty(next.website_url, prev.website_url);
merged.x_url = choosePreferredNonEmpty(next.x_url, prev.x_url);
merged.telegram_url = choosePreferredNonEmpty(next.telegram_url, prev.telegram_url);
merged.discord_url = choosePreferredNonEmpty(next.discord_url, prev.discord_url);
merged.final_supply = choosePreferredNonEmpty(next.final_supply, prev.final_supply, next.supply, prev.supply);
merged.supply = choosePreferredNonEmpty(next.supply, prev.supply, next.final_supply, prev.final_supply);

merged.commit_started_at = choosePreferredNonEmpty(next.commit_started_at, prev.commit_started_at) || null;
merged.commit_ends_at = choosePreferredNonEmpty(next.commit_ends_at, prev.commit_ends_at) || null;
merged.countdown_started_at = choosePreferredNonEmpty(next.countdown_started_at, prev.countdown_started_at) || null;
merged.countdown_ends_at = choosePreferredNonEmpty(next.countdown_ends_at, prev.countdown_ends_at) || null;
merged.live_at = choosePreferredNonEmpty(next.live_at, prev.live_at, merged.countdown_ends_at) || null;
merged.created_at = choosePreferredNonEmpty(next.created_at, prev.created_at) || null;
merged.updated_at = choosePreferredNonEmpty(next.updated_at, prev.updated_at) || null;

merged.builder_score =
firstFinite(next.builder_score, prev.builder_score) ??
toNumber(next.builder_score ?? prev.builder_score, 0);

merged.hard_cap_sol =
firstFinite(next.hard_cap_sol, prev.hard_cap_sol) ??
toNumber(next.hard_cap_sol ?? prev.hard_cap_sol, 0);

merged.min_raise_sol =
firstFinite(next.min_raise_sol, prev.min_raise_sol) ??
toNumber(next.min_raise_sol ?? prev.min_raise_sol, 0);

merged.committed_sol =
firstFinite(next.committed_sol, prev.committed_sol) ??
toNumber(next.committed_sol ?? prev.committed_sol, 0);

merged.participants_count =
firstFinite(next.participants_count, prev.participants_count) ??
toNumber(next.participants_count ?? prev.participants_count, 0);

merged.price =
firstFinite(next.price, prev.price) ??
toNumber(next.price ?? prev.price, 0);

merged.market_cap =
firstFinite(next.market_cap, prev.market_cap) ??
toNumber(next.market_cap ?? prev.market_cap, 0);

merged.liquidity =
firstFinite(next.liquidity, prev.liquidity) ??
toNumber(next.liquidity ?? prev.liquidity, 0);

merged.volume_24h =
firstFinite(next.volume_24h, prev.volume_24h) ??
toNumber(next.volume_24h ?? prev.volume_24h, 0);

merged.contract_address = strongestContract;
merged.mint_address = choosePreferredNonEmpty(next.mint_address, prev.mint_address, strongestContract);
merged.reserved_mint_address = choosePreferredNonEmpty(next.reserved_mint_address, prev.reserved_mint_address);
merged.mint_reservation_status = choosePreferredNonEmpty(
next.mint_reservation_status,
prev.mint_reservation_status
);

return normalizeLaunchTruth(merged);
}

function resolveCanonicalPhase(launch = {}) {
const truth = normalizeLaunchTruth(launch || {});
const explicit = cleanString(truth?.status, 64).toLowerCase();
const now = getNowMs();

const countdownStartMs = parseDateMs(truth?.countdown_started_at);
const countdownEndMs = parseDateMs(truth?.countdown_ends_at || truth?.live_at);
const commitEndMs = parseDateMs(truth?.commit_ends_at);

const contractAddress = choosePreferredNonEmpty(
truth?.contract_address,
truth?.mint_address
);
const reservationStatus = cleanString(truth?.mint_reservation_status, 64).toLowerCase();

const hasLiveSignal = Boolean(
contractAddress ||
reservationStatus === "finalized"
);

if (explicit === "graduated") return PHASES.LIVE;
if (explicit === "live") return PHASES.LIVE;

if (explicit === "building") {
return PHASES.BUILDING;
}

if (explicit === "countdown") {
if (countdownEndMs && now >= countdownEndMs) return PHASES.BUILDING;
return PHASES.COUNTDOWN;
}

if (explicit === "failed" || explicit === "failed_refunded") {
return PHASES.COMMIT;
}

if (explicit === "commit") {
return PHASES.COMMIT;
}

if (countdownStartMs || countdownEndMs) {
if (countdownEndMs && now >= countdownEndMs) {
return hasLiveSignal ? PHASES.LIVE : PHASES.BUILDING;
}
return PHASES.COUNTDOWN;
}

if (hasLiveSignal) {
return PHASES.LIVE;
}

if (commitEndMs && now >= commitEndMs && countdownEndMs && now < countdownEndMs) {
return PHASES.COUNTDOWN;
}

return PHASES.COMMIT;
}

function canonicalizeLaunchTruth(launch = {}, commitStats = {}) {
const merged = mergeLaunchTruth(
normalizeLaunchTruth(launch || {}),
buildLaunchPatchFromCommitStats(commitStats || {})
);

const explicit = cleanString(merged.status, 64).toLowerCase();
const phase = resolveCanonicalPhase(merged);

if (explicit === "graduated") {
merged.status = "graduated";
return merged;
}

if (explicit === "failed" || explicit === "failed_refunded") {
merged.status = explicit;
return merged;
}

if (phase === PHASES.LIVE) {
merged.status = "live";
} else if (phase === PHASES.BUILDING) {
merged.status = "building";
} else if (phase === PHASES.COUNTDOWN) {
merged.status = "countdown";
} else {
merged.status = "commit";
}

return normalizeLaunchTruth(merged);
}

function isLaunchLiveLike(launch = {}, commitStats = {}) {
return resolveCanonicalPhase(canonicalizeLaunchTruth(launch, commitStats)) === PHASES.LIVE;
}

function isLaunchBuilding(launch = {}, commitStats = {}) {
return resolveCanonicalPhase(canonicalizeLaunchTruth(launch, commitStats)) === PHASES.BUILDING;
}

function getDaysSinceLive(launch = {}) {
const liveStartMs = parseDateMs(launch?.live_at || launch?.updated_at || launch?.created_at);
if (!liveStartMs) return 0;
return Math.max(0, Math.floor((Date.now() - liveStartMs) / 86400000));
}

function getLocalMaxWalletPercent(launch = {}, connectedWallet = "") {
const builderWallet = String(launch?.builder_wallet || "").trim().toLowerCase();
const currentWallet = String(connectedWallet || "").trim().toLowerCase();
const isBuilderWallet = Boolean(builderWallet && currentWallet && builderWallet === currentWallet);

if (isBuilderWallet) return BUILDER_MAX_WALLET_PERCENT;

const days = getDaysSinceLive(launch);
return BASE_MAX_WALLET_PERCENT + (days * DAILY_INCREASE_PERCENT);
}

function inferPhase(launch, commitStats = {}) {
return resolveCanonicalPhase(canonicalizeLaunchTruth(launch, commitStats));
}

function getVisualPhase(phase) {
return phase === PHASES.BUILDING ? PHASES.COUNTDOWN : phase;
}

function getPhaseLabel(phase) {
switch (phase) {
case PHASES.COUNTDOWN:
return "Countdown";
case PHASES.BUILDING:
return "Building";
case PHASES.LIVE:
return "Live";
case PHASES.COMMIT:
default:
return "Commit";
}
}

function getPhaseAccessLabel(phase) {
switch (phase) {
case PHASES.COUNTDOWN:
return "Countdown Locked";
case PHASES.BUILDING:
return "Bootstrapping";
case PHASES.LIVE:
return "Live Access";
case PHASES.COMMIT:
default:
return "Pre-Live";
}
}

function getPhaseNote(phase, launch = {}, commitStats = {}) {
if (phase === PHASES.COUNTDOWN) {
const countdownText = getCountdownText(launch, commitStats);
return countdownText !== "00:00"
? `Commit closed. Live transition opens in ${countdownText}.`
: "Commit closed. Launch is transitioning to live.";
}

if (phase === PHASES.BUILDING) {
return "Countdown reached zero. MSS is finalizing mint, liquidity, and live market state.";
}

if (phase === PHASES.LIVE) {
return "Live market access is active.";
}

return "Commit phase is active and accepting structured commitments.";
}

function getPhaseMeta(phase) {
switch (phase) {
case PHASES.BUILDING:
return {
badgeText: "BUILDING",
statusText: "Building",
marketModeText: "Bootstrapping",
overlayEyebrow: "MARKET BOOTSTRAP",
overlayTitle: "Building Live Market",
overlayText: "Countdown has ended. Final mint, liquidity, and market state are being finalized.",
overlaySubtext: "Contract address and live pricing will appear once bootstrap completes.",
marketTitle: "Market Bootstrap",
};
case PHASES.COUNTDOWN:
return {
badgeText: "COUNTDOWN",
statusText: "Countdown",
marketModeText: "Countdown Locked",
overlayEyebrow: "TRADING COUNTDOWN",
overlayTitle: "Trading Opens In",
overlayText: "",
overlaySubtext: "Market activation is imminent.",
marketTitle: "Launch Countdown",
};
case PHASES.LIVE:
return {
badgeText: "LIVE",
statusText: "Live",
marketModeText: "Live Access",
overlayEyebrow: "LIVE MARKET",
overlayTitle: "Live Trading",
overlayText: "Market is now open.",
overlaySubtext: "",
marketTitle: "Live Market",
};
case PHASES.COMMIT:
default:
return {
badgeText: "COMMIT",
statusText: "Commit",
marketModeText: "Pre-Live",
overlayEyebrow: "COMMIT PHASE",
overlayTitle: "Commit Phase In Progress",
overlayText: "Trading is not open yet. Commitments are being collected before market activation.",
overlaySubtext: "",
marketTitle: "Commit Activity",
};
}
}

function getCassieMeta(phase, launch = {}, tokenPayload = {}, chartStats = {}) {
const cassie = tokenPayload?.cassie || {};
const priceChangePct = toNumber(chartStats?.price_change_pct, 0);
const buys24h = toNumber(chartStats?.buys_24h, 0);
const sells24h = toNumber(chartStats?.sells_24h, 0);
const builderWallet = String(launch?.builder_wallet || "").trim();
const builderScore = toNumber(launch?.builder_score, 0);

let state = cassie?.monitoring_active ? "Monitoring" : "Standby";
let badge = "LIVE INTELLIGENCE";
let riskState = "Watching";
let builderSignal = builderWallet ? "Linked" : "Pending";
let structureSignal = "Reviewing";
let marketSignal = "Standby";
let note =
"CassIE is attached to this launch and continuously surfaces builder, structure and live market intelligence as the lifecycle progresses.";

if (builderScore >= 80) {
builderSignal = "Strong";
} else if (builderScore >= 55) {
builderSignal = "Moderate";
} else if (builderWallet) {
builderSignal = "Early";
}

if (phase === PHASES.COMMIT) {
state = cassie?.monitoring_active ? "Monitoring" : "Standby";
badge = "STRUCTURE WATCH";
riskState = "Watching";
structureSignal = "Commit Review";
marketSignal = "Pre-Live";
note =
"CassIE is monitoring builder-linked signals, launch structure, wallet concentration, and commit integrity before market activation.";
} else if (phase === PHASES.COUNTDOWN) {
state = "Monitoring";
badge = "OPENING WATCH";
riskState = "Elevated";
structureSignal = "Countdown Armed";
marketSignal = "Opening Soon";
note =
"CassIE is tracking countdown integrity, final participation posture, and opening conditions before live trading begins.";
} else if (phase === PHASES.BUILDING) {
state = "Monitoring";
badge = "BOOTSTRAP WATCH";
riskState = "Elevated";
structureSignal = "Finalizing";
marketSignal = "Building Market";
note =
"CassIE is tracking final mint assignment, pool bootstrap, and post-countdown launch state while the market is being brought live.";
} else if (phase === PHASES.LIVE) {
state = cassie?.monitoring_active ? "Monitoring" : "Live";

const elevatedFlow =
Math.abs(priceChangePct) >= 25 || Math.abs(buys24h - sells24h) >= 10;

riskState = elevatedFlow ? "Elevated" : "Normal";
structureSignal = "Live";
marketSignal = elevatedFlow ? "Active Flow" : "Balanced";

note = elevatedFlow
? "CassIE has detected elevated live market activity. Review price movement, flow imbalance, and execution details before confirming."
: "CassIE is actively monitoring live flow, price behaviour, and structure changes as this market trades.";
}

return {
state,
badge,
riskState,
builderSignal,
structureSignal,
marketSignal,
note,
};
}

function renderCassiePanel(phase, launch = {}, tokenPayload = {}, chartStats = {}) {
const cassieMeta = getCassieMeta(phase, launch, tokenPayload, chartStats);
setText("cassieState", cassieMeta.state);
setText("cassieBadgeText", cassieMeta.badge);
setText("cassieRiskState", cassieMeta.riskState);
setText("cassieBuilderSignal", cassieMeta.builderSignal);
setText("cassieStructureSignal", cassieMeta.structureSignal);
setText("cassieMarketSignal", cassieMeta.marketSignal);
setText("cassieNote", cassieMeta.note);

setText("launchCassieVerdictText", cassieMeta.badge);
setText("launchCassiePrimaryText", cassieMeta.note);
setText(
"launchCassiePatternText",
`${cassieMeta.builderSignal} Builder • ${cassieMeta.structureSignal} • ${cassieMeta.marketSignal}`
);
}

async function copyText(text) {
const value = String(text || "").trim();
if (!value || value === "Pending") return false;

try {
await navigator.clipboard.writeText(value);
return true;
} catch {
try {
const input = document.createElement("textarea");
input.value = value;
input.setAttribute("readonly", "");
input.style.position = "absolute";
input.style.left = "-9999px";
document.body.appendChild(input);
input.select();
const ok = document.execCommand("copy");
document.body.removeChild(input);
return ok;
} catch {
return false;
}
}
}

function setButtonCopiedState(button, originalHtml, copiedText = "Copied") {
if (!button) return;
button.innerHTML = copiedText;
window.setTimeout(() => {
button.innerHTML = originalHtml;
}, 1200);
}

function updatePhaseClasses(phase) {
const marketCard = $("marketCard");
const launchPhaseBadge = $("launchPhaseBadge");
const marketStatusPill = $("marketStatusPill");
const marketStatusDot = $("marketStatusDot");
const tradePanelPhasePill = $("tradePanelPhasePill");
const launchTokenHero = $("launchTokenHero");

const visualPhase = getVisualPhase(phase);
const phaseClasses = ["phase-commit", "phase-countdown", "phase-live"];

for (const el of [marketCard, launchPhaseBadge, marketStatusPill, marketStatusDot, tradePanelPhasePill, launchTokenHero]) {
if (!el) continue;
el.classList.remove(...phaseClasses);
el.classList.add(`phase-${visualPhase}`);
}

if (marketCard) {
marketCard.dataset.phase = phase;
}
if (launchTokenHero) {
launchTokenHero.dataset.phase = phase;
}
}

function updatePhaseContent(phase, launch = {}, commitStats = {}, lifecycle = null) {
const meta = getPhaseMeta(phase);
const phaseLabel = getPhaseLabel(phase);
const accessLabel = getPhaseAccessLabel(phase);
const phaseNote = getPhaseNote(phase, launch, commitStats);

setText("launchPhaseBadgeText", meta.badgeText);
setTextMany(["launchStatusText", "launchStatusText2"], meta.statusText);
setText("launchMarketModeText", meta.marketModeText);
setText("marketStatusLabel", phase === PHASES.LIVE ? "Live Trading" : meta.statusText);
setText("marketOverlayEyebrow", meta.overlayEyebrow);
setText("marketOverlayTitle", meta.overlayTitle);

setTextMany(
["phaseValueMirror", "launchStatusBoardValue", "launchCommandPhase", "launchCommandStatus", "launchStatusBoardStatus"],
phaseLabel
);
setTextMany(
["phaseNoteMirror", "launchStatusBoardNote", "launchCommandText"],
phaseNote
);
setTextMany(
["launchStatusBoardAccess", "launchCommandMarket", "launchTerminalModeLabel"],
accessLabel
);
setText("launchTerminalPhaseLabel", `Phase • ${meta.badgeText}`);

const marketTitleEl = document.querySelector(".market-card-title");
if (marketTitleEl) {
marketTitleEl.textContent = meta.marketTitle;
}

const marketOverlayText = $("marketOverlayText");
if (marketOverlayText) {
marketOverlayText.textContent = meta.overlayText;
marketOverlayText.classList.toggle("hidden", !meta.overlayText);
}

const marketCountdownSubtext = document.querySelector(".market-countdown-subtext");
if (marketCountdownSubtext) {
marketCountdownSubtext.textContent = meta.overlaySubtext || "Market activation is imminent.";
}

const marketTimeframes = $("marketTimeframes");
const marketLiveLayer = $("marketLiveLayer");
const marketCountdownBox = $("marketCountdownBox");
const marketOverlay = $("marketOverlay");

if (marketTimeframes) {
marketTimeframes.classList.toggle("disabled", phase !== PHASES.LIVE);
}

toggleHidden(marketLiveLayer, phase !== PHASES.LIVE);
toggleHidden(marketCountdownBox, !(phase === PHASES.COUNTDOWN));

if (marketOverlay) {
marketOverlay.classList.remove("overlay-commit", "overlay-countdown", "overlay-live");
marketOverlay.classList.add(`overlay-${getVisualPhase(phase)}`);
marketOverlay.classList.toggle("hidden", phase === PHASES.LIVE);
}
}

function updateTokenIdentity(launch, tokenPayload = null) {
const tokenName = getLaunchDisplayName(launch, tokenPayload);
const tokenSymbol = getLaunchSymbol(launch, tokenPayload);
const builderWallet = choosePreferredNonEmpty(
launch?.builder_wallet,
tokenPayload?.launch?.builder_wallet
);
const builderAlias = choosePreferredNonEmpty(
launch?.builder_alias,
tokenPayload?.launch?.builder_alias,
"Builder"
);
const builderScore = toNumber(
launch?.builder_score ?? tokenPayload?.launch?.builder_score,
0
);

const initials = getInitials(tokenSymbol, tokenName);

setTextMany(["launchTokenName", "launchTokenNameMirror"], tokenName);
setText("launchTokenSymbol", tokenSymbol);
setText("launchBuilderLabel", builderAlias);
setText("launchBuilderWalletShort", builderWallet ? shortAddress(builderWallet) : "Pending");
setText("launchTokenLogo", initials);

setText("builderAlias", builderAlias);
setText("builderScoreStat", builderScore > 0 ? formatNumber(builderScore, { maximumFractionDigits: 0 }) : "—");

const tier =
builderScore >= 80
? "Strong"
: builderScore >= 55
? "Moderate"
: builderWallet
? "Early"
: "Pending";

setText("launchBuilderTierText", tier);

const nameEl = $("launchTokenName");
if (nameEl) {
nameEl.title = tokenName;
}
}

function resolveContractAddress(launch = {}, tokenPayload = {}, commitStats = {}) {
const phase = inferPhase(launch, commitStats);
const contractAddress = choosePreferredNonEmpty(
launch?.contract_address,
launch?.mint_address,
tokenPayload?.token?.mint_address,
tokenPayload?.token?.mint,
tokenPayload?.mint_address,
tokenPayload?.mint
);

if (phase !== PHASES.LIVE) {
return {
value: "",
state: "Hidden",
};
}

if (contractAddress) {
return {
value: contractAddress,
state: "Ready",
};
}

return {
value: "",
state: "Pending",
};
}

function updateContractAddress(launch, tokenPayload = null, commitStats = {}) {
const resolved = resolveContractAddress(launch || {}, tokenPayload || {}, commitStats || {});
const fullValue = resolved.value || "";
const shortValue = fullValue ? shortAddress(fullValue) : (resolved.state === "Hidden" ? "Hidden until live" : resolved.state);

setTextMany(
[
"launchCaText",
"chartCaChipText",
"contractAddressText",
"contractAddressValue",
"launchContractAddress",
"contractAddressStat",
"launchStatusBoardCa",
],
shortValue
);

setText("launchCaState", resolved.state);

setTitleMany(
[
"launchCaText",
"chartCaChipText",
"contractAddressText",
"contractAddressValue",
"launchContractAddress",
"contractAddressStat",
"launchStatusBoardCa",
],
fullValue || ""
);

const launchCaCopyBtn = $("launchCaCopyBtn");
const chartCaCopyBtn = $("chartCaCopyBtn");

if (launchCaCopyBtn) {
launchCaCopyBtn.dataset.copyValue = fullValue;
launchCaCopyBtn.disabled = !fullValue;
}
if (chartCaCopyBtn) {
chartCaCopyBtn.dataset.copyValue = fullValue;
chartCaCopyBtn.disabled = !fullValue;
}
}

function renderExternalLinks(launch) {
const launchExternalLinks = $("launchExternalLinks");
if (!launchExternalLinks) return;

const links = [];

for (const item of EXTERNAL_LINK_TYPES) {
const normalized = normalizeUrl(launch?.[item.key], item.key);
if (!normalized) continue;

links.push({
label: item.label,
icon: item.icon,
url: normalized,
});
}

if (!links.length) {
launchExternalLinks.innerHTML = `<span class="launch-link-chip" aria-disabled="true">No external links added</span>`;
return;
}

launchExternalLinks.innerHTML = links
.map(
(item) => `
<a
class="launch-link-chip"
href="${escapeHtml(item.url)}"
target="_blank"
rel="noopener noreferrer"
>
<span>${escapeHtml(item.icon)}</span>
<span>${escapeHtml(item.label)}</span>
</a>
`
)
.join("");
}

function getCommitMetrics(launch, commitStats = {}) {
const committedSol = toNumber(
commitStats?.totalCommitted ??
launch?.committed_sol ??
launch?.commit_total_sol,
0
);

const participantCount = toNumber(
commitStats?.participants ??
launch?.participants_count ??
launch?.participant_count ??
launch?.participants,
0
);

const hardCapSol = toNumber(
commitStats?.hardCap ??
launch?.hard_cap_sol ??
launch?.hard_cap,
0
);

const minRaiseSol = toNumber(
commitStats?.minRaise ??
launch?.min_raise_sol ??
launch?.min_raise,
0
);

const countdownEndsAt =
commitStats?.countdownEndsAt ||
launch?.countdown_ends_at ||
launch?.live_at;

return {
committedSol,
participantCount,
hardCapSol,
minRaiseSol,
countdownEndsAt,
};
}

function updateStatsForCommit(launch, commitStats = {}) {
const { committedSol, participantCount, hardCapSol, minRaiseSol } = getCommitMetrics(launch, commitStats);
const progress = hardCapSol > 0 ? Math.min(100, (committedSol / hardCapSol) * 100) : 0;

setText("stat1Label", "Committed Capital");
setText("stat1Value", formatSol(committedSol, 2));

setText("stat2Label", "Participant Count");
setText("stat2Value", formatNumber(participantCount, { maximumFractionDigits: 0 }));

setText("stat3Label", "Minimum Raise");
setText("stat3Value", minRaiseSol > 0 ? formatSol(minRaiseSol, 2) : "—");

setText("stat4Label", "Fill Progress");
setText("stat4Value", formatPercent(progress, 1));
}

function updateStatsForCountdown(launch, commitStats = {}) {
const { committedSol, participantCount, hardCapSol } = getCommitMetrics(launch, commitStats);

setText("stat1Label", "Committed Capital");
setText("stat1Value", formatSol(committedSol, 2));

setText("stat2Label", "Participant Count");
setText("stat2Value", formatNumber(participantCount, { maximumFractionDigits: 0 }));

setText("stat3Label", "Hard Cap");
setText("stat3Value", hardCapSol > 0 ? formatSol(hardCapSol, 2) : "—");

setText("stat4Label", "Countdown");
setText("stat4Value", getCountdownText(launch, commitStats));
}

function updateStatsForBuilding(launch, lifecycle = null) {
setText("stat1Label", "Market State");
setText("stat1Value", "Building");

setText("stat2Label", "Mint Status");
const ca = choosePreferredNonEmpty(launch?.contract_address, launch?.mint_address);
setText("stat2Value", ca ? shortAddress(ca) : "Pending");

setText("stat3Label", "Bootstrap Liquidity");
const liq = toNumber(
lifecycle?.internalSolReserve ??
launch?.internal_pool_sol ??
launch?.liquidity,
0
);
setText("stat3Value", liq > 0 ? formatSol(liq, 4) : "Pending");

setText("stat4Label", "Execution");
setText("stat4Value", "Bootstrapping");
}

function getLiveStats(tokenPayload = {}, chartStats = {}, launch = {}, lifecycle = null) {
const tokenStats = tokenPayload?.stats || {};
const stats = { ...chartStats, ...tokenStats };

const solUsdPrice = toNumber(
stats?.sol_usd_price ??
tokenPayload?.launch?.sol_usd_price ??
tokenPayload?.stats?.sol_usd_price,
0
);

const priceUsd = toNumber(stats?.price_usd, 0);

const fallbackPriceSol = toNumber(
stats?.price_sol ??
stats?.price ??
tokenPayload?.launch?.price ??
launch?.price ??
lifecycle?.priceSol,
0
);

const resolvedPriceUsd =
priceUsd > 0
? priceUsd
: (fallbackPriceSol > 0 && solUsdPrice > 0 ? fallbackPriceSol * solUsdPrice : 0);

const marketCapUsd = toNumber(stats?.market_cap_usd, 0);

const fallbackMarketCapSol = toNumber(
stats?.market_cap_sol ??
stats?.market_cap ??
tokenPayload?.launch?.market_cap ??
launch?.market_cap ??
lifecycle?.marketcapSol,
0
);

const resolvedMarketCapUsd =
marketCapUsd > 0
? marketCapUsd
: (fallbackMarketCapSol > 0 && solUsdPrice > 0 ? fallbackMarketCapSol * solUsdPrice : 0);

const liquidityUsd = toNumber(stats?.liquidity_usd, 0);

const fallbackLiquiditySol = toNumber(
stats?.liquidity_sol ??
stats?.liquidity ??
tokenPayload?.launch?.liquidity_sol ??
tokenPayload?.launch?.liquidity ??
launch?.liquidity ??
launch?.internal_pool_sol ??
lifecycle?.internalSolReserve,
0
);

const resolvedLiquidityUsd =
liquidityUsd > 0
? liquidityUsd
: (fallbackLiquiditySol > 0 && solUsdPrice > 0 ? fallbackLiquiditySol * solUsdPrice : 0);

const volume24hUsd = toNumber(stats?.volume_24h_usd, 0);

const fallbackVolume24hSol = toNumber(
stats?.volume_24h_sol ??
stats?.volume_24h ??
tokenPayload?.launch?.volume_24h ??
launch?.volume_24h ??
lifecycle?.volume24hSol,
0
);

const resolvedVolume24hUsd =
volume24hUsd > 0
? volume24hUsd
: (fallbackVolume24hSol > 0 && solUsdPrice > 0 ? fallbackVolume24hSol * solUsdPrice : 0);

return {
priceUsd: resolvedPriceUsd,
marketCapUsd: resolvedMarketCapUsd,
liquidityUsd: resolvedLiquidityUsd,
volume24hUsd: resolvedVolume24hUsd,
priceSol: fallbackPriceSol,
marketCapSol: fallbackMarketCapSol,
liquiditySol: fallbackLiquiditySol,
volume24hSol: fallbackVolume24hSol,
solUsdPrice,
};
}

function updateStatsForLive(tokenPayload = {}, chartStats = {}, launch = {}, lifecycle = null) {
const liveStats = getLiveStats(tokenPayload, chartStats, launch, lifecycle);

setText("stat1Label", "Spot Price");
setText(
"stat1Value",
liveStats.priceUsd > 0 || liveStats.priceSol > 0
? `${liveStats.priceUsd > 0 ? formatPriceUsd(liveStats.priceUsd) : "—"}${liveStats.priceSol > 0 ? ` • ${formatPriceSol(liveStats.priceSol)} SOL` : ""}`
: "—"
);

setText("stat2Label", "Market Cap");
setText(
"stat2Value",
formatUsdThenSol(liveStats.marketCapUsd, liveStats.marketCapSol, {
compactUsd: true,
solDecimals: 4,
})
);

setText("stat3Label", "Liquidity");
setText(
"stat3Value",
formatUsdThenSol(liveStats.liquidityUsd, liveStats.liquiditySol, {
compactUsd: true,
solDecimals: 4,
})
);

setText("stat4Label", "24H Volume");
setText(
"stat4Value",
formatUsdThenSol(liveStats.volume24hUsd, liveStats.volume24hSol, {
compactUsd: true,
solDecimals: 4,
})
);
}

function getCountdownParts(launch, commitStats = {}) {
const merged = canonicalizeLaunchTruth(launch, commitStats);
const target =
commitStats?.countdownEndsAt ||
merged?.live_at ||
merged?.countdown_ends_at;

const tradingOpenMs = parseDateMs(target);
if (!tradingOpenMs) return { totalMs: 0, minutes: 0, seconds: 0 };

const diff = Math.max(0, tradingOpenMs - getNowMs());
const minutes = Math.floor(diff / 60000);
const seconds = Math.floor((diff % 60000) / 1000);

return { totalMs: diff, minutes, seconds };
}

function getCountdownText(launch, commitStats = {}) {
const { totalMs, minutes, seconds } = getCountdownParts(launch, commitStats);
if (totalMs <= 0) return "00:00";
return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateCountdownUi(launch, commitStats = {}) {
setText("marketCountdownValue", getCountdownText(launch, commitStats));

if ($("stat4Value") && inferPhase(launch, commitStats) === PHASES.COUNTDOWN) {
setText("stat4Value", getCountdownText(launch, commitStats));
}
}

function setManageLinksVisibility(launch, connectedWallet, commitStats = {}) {
const button = $("manageLaunchLinksBtn");
if (!button) return;

const builderWallet = String(launch?.builder_wallet || "").trim().toLowerCase();
const wallet = String(connectedWallet || "").trim().toLowerCase();
const canManage = Boolean(
inferPhase(launch, commitStats) === PHASES.LIVE &&
builderWallet &&
wallet &&
builderWallet === wallet
);

button.classList.toggle("hidden", !canManage);
}

function fillLinksModal(launch) {
if ($("linkWebsiteInput")) $("linkWebsiteInput").value = launch?.website_url || "";
if ($("linkXInput")) $("linkXInput").value = launch?.x_url || "";
if ($("linkTelegramInput")) $("linkTelegramInput").value = launch?.telegram_url || "";
if ($("linkDiscordInput")) $("linkDiscordInput").value = launch?.discord_url || "";
}

function openLinksModal() {
$("launchLinksModal")?.classList.remove("hidden");
}

function closeLinksModal() {
$("launchLinksModal")?.classList.add("hidden");
}

function setTradeMessage(text = "", type = "neutral") {
const el = $("tradePanelMessage");
if (!el) return;

if (!text) {
el.classList.add("hidden");
el.textContent = "";
el.dataset.state = "";
return;
}

el.classList.remove("hidden");
el.textContent = text;
el.dataset.state = type;
}

function resolveTradesFromPayload(payload = {}) {
const snapshotTrades = Array.isArray(payload?.tokenTrades) ? payload.tokenTrades : [];
const genericTrades = Array.isArray(payload?.trades) ? payload.trades : [];
const tokenPayloadTrades = Array.isArray(payload?.tokenPayload?.recent_trades) ? payload.tokenPayload.recent_trades : [];
const tokenPayloadTradesAlt = Array.isArray(payload?.tokenPayload?.trades) ? payload.tokenPayload.trades : [];
const tokenStatsTrades = Array.isArray(payload?.tokenPayload?.stats?.recent_trades) ? payload.tokenPayload.stats.recent_trades : [];
const chartStatsTrades = Array.isArray(payload?.chartStats?.recent_trades) ? payload.chartStats.recent_trades : [];

return snapshotTrades.length
? snapshotTrades
: genericTrades.length
? genericTrades
: tokenPayloadTrades.length
? tokenPayloadTrades
: tokenPayloadTradesAlt.length
? tokenPayloadTradesAlt
: tokenStatsTrades.length
? tokenStatsTrades
: chartStatsTrades;
}

function renderRecentTrades(trades = [], tokenPayload = {}, chartStats = {}) {
const list = $("recentTradesList");
if (!list) return;

if (!Array.isArray(trades) || !trades.length) {
list.innerHTML = `<div class="recent-trades-empty">No trades yet.</div>`;
return;
}

const solUsdPrice = toNumber(
tokenPayload?.stats?.sol_usd_price ??
chartStats?.sol_usd_price,
0
);

const ordered = [...trades].sort((a, b) => {
const aTs = parseDateMs(a?.created_at || a?.timestamp || a?.time) || 0;
const bTs = parseDateMs(b?.created_at || b?.timestamp || b?.time) || 0;
return bTs - aTs;
});

list.innerHTML = ordered
.slice(0, 50)
.map((trade) => {
const side = String(trade?.side || trade?.type || "").toLowerCase() || "trade";
const wallet = shortAddress(String(trade?.wallet || trade?.owner || ""));
const solAmountNum = toNumber(trade?.sol_amount ?? trade?.base_amount ?? trade?.solAmount, 0);
const tokenAmountNum = toNumber(trade?.token_amount ?? trade?.tokenAmount ?? trade?.amount, 0);
const priceSolNum = toNumber(trade?.price ?? trade?.price_sol, 0);
const tradeUsdValue = solUsdPrice > 0 ? solAmountNum * solUsdPrice : 0;
const createdAt = trade?.created_at || trade?.timestamp || trade?.time || "";
const relativeTime = formatRelativeTime(createdAt);

return `
<div class="recent-trade-row side-${escapeHtml(side)}">
<div class="recent-trade-main">
<div class="recent-trade-side side-${escapeHtml(side)}">${escapeHtml(side.toUpperCase() || "TRADE")}</div>
<div class="recent-trade-wallet">${escapeHtml(wallet)}</div>
<div class="recent-trade-sub">${escapeHtml(relativeTime)}</div>
</div>
<div class="recent-trade-metrics">
<div class="recent-trade-value">${escapeHtml(formatSol(solAmountNum, 4))}</div>
<div class="recent-trade-sub">${tradeUsdValue > 0 ? escapeHtml(formatUsd(tradeUsdValue, 2)) : escapeHtml(`${formatTokenAmount(tokenAmountNum, 0)} tokens`)}</div>
</div>
<div class="recent-trade-meta">
<div class="recent-trade-price">@ ${escapeHtml(priceSolNum > 0 ? `${formatPriceSol(priceSolNum)} SOL` : "—")}</div>
<div class="recent-trade-time">${escapeHtml(formatDateTime(createdAt))}</div>
</div>
</div>
`;
})
.join("");
}

function setTradePanelVisibility(phase) {
const tradePanelCard = $("tradePanelCard");
const recentTradesCard = $("recentTradesCard");
const tradePanelPhasePill = $("tradePanelPhasePill");
const tradeSubmitBtn = $("tradeSubmitBtn");
const quickBuyRow = $("tradeQuickBuyRow");
const quickSellRow = $("tradeQuickSellRow");

if (!tradePanelCard || !recentTradesCard || !tradePanelPhasePill) return;

const isLive = phase === PHASES.LIVE;
tradePanelCard.classList.toggle("hidden", !isLive);
recentTradesCard.classList.toggle("hidden", !isLive);

tradePanelPhasePill.classList.remove("phase-commit", "phase-countdown", "phase-live");
tradePanelPhasePill.classList.add(`phase-${getVisualPhase(phase)}`);
tradePanelPhasePill.textContent =
phase === PHASES.LIVE
? "Market Active"
: phase === PHASES.BUILDING
? "Building"
: phase === PHASES.COUNTDOWN
? "Countdown"
: "Market Locked";

if (tradeSubmitBtn) {
tradeSubmitBtn.disabled = !isLive;
}

toggleHidden(quickBuyRow, !isLive);
toggleHidden(quickSellRow, !isLive);
}

function updateTradeTabUi(mode) {
const buyTab = $("tradeTabBuy");
const sellTab = $("tradeTabSell");
const amountLabel = $("tradeAmountLabel");
const amountInput = $("tradeAmountInput");
const primaryLabel = $("tradeQuotePrimaryLabel");
const walletLimitLabel = $("tradeQuoteWalletLimitLabel");
const quickBuyRow = $("tradeQuickBuyRow");
const quickSellRow = $("tradeQuickSellRow");

if (buyTab) buyTab.classList.toggle("active", mode === TRADE_MODES.BUY);
if (sellTab) sellTab.classList.toggle("active", mode === TRADE_MODES.SELL);

if (amountLabel) {
amountLabel.textContent = mode === TRADE_MODES.BUY ? "Amount (SOL)" : "Amount (Tokens)";
}

if (amountInput) {
amountInput.placeholder = mode === TRADE_MODES.BUY ? "0.00" : "0";
}

if (primaryLabel) {
primaryLabel.textContent = "You Receive";
}

if (walletLimitLabel) {
walletLimitLabel.textContent = mode === TRADE_MODES.BUY ? "Wallet Limit After" : "Balance After";
}

toggleHidden(quickBuyRow, mode !== TRADE_MODES.BUY);
toggleHidden(quickSellRow, mode !== TRADE_MODES.SELL);
}

function resetTradeQuoteUi() {
setText("tradeQuotePrimaryValue", "—");
setText("tradeQuotePriceValue", "—");
setText("tradeQuoteFeeValue", "—");
setText("tradeQuoteWalletLimitValue", "—");
}

function syncMarketShellLayout() {
const shell = $("launchMarketShell");
const market = $("marketCard");
const hero = document.querySelector(".launch-hero-shell");
if (!shell || !market || !hero) return;

const wrap = shell.querySelector(".launch-market-wrap");
if (!wrap) return;

if (wrap.firstElementChild !== hero) {
wrap.prepend(hero);
}

if (hero.nextElementSibling !== market) {
wrap.insertBefore(market, hero.nextElementSibling);
}
}

function syncChartSizing(phase) {
const chartShell = $("marketChartShell");
const chartCanvas = $("marketChartCanvas");
const volumeCanvas = $("marketVolumeCanvas");

if (!chartShell || !chartCanvas || !volumeCanvas) return;

if (phase === PHASES.LIVE) {
chartShell.style.minHeight = "450px";
chartCanvas.style.height = "330px";
volumeCanvas.style.height = "104px";
} else if (phase === PHASES.BUILDING) {
chartShell.style.minHeight = "390px";
chartCanvas.style.height = "260px";
volumeCanvas.style.height = "84px";
} else if (phase === PHASES.COUNTDOWN) {
chartShell.style.minHeight = "370px";
chartCanvas.style.height = "245px";
volumeCanvas.style.height = "80px";
} else {
chartShell.style.minHeight = "345px";
chartCanvas.style.height = "225px";
volumeCanvas.style.height = "72px";
}
}

function syncTerminalPresentation(phase, launch = {}, chartStats = {}, tokenPayload = {}) {
const marketCard = $("marketCard");
const tradePanelCard = $("tradePanelCard");
const recentTradesCard = $("recentTradesCard");
const walletSummary = $("marketWalletSummary");
const accessCard = $("marketAccessCard");

const priceChangePct = toNumber(chartStats?.price_change_pct, 0);
const flowImbalance = Math.abs(
toNumber(chartStats?.buys_24h, 0) - toNumber(chartStats?.sells_24h, 0)
);
const builderScore = toNumber(launch?.builder_score ?? tokenPayload?.launch?.builder_score, 0);

const tone =
phase !== PHASES.LIVE
? "prelive"
: Math.abs(priceChangePct) >= 25 || flowImbalance >= 10
? "elevated"
: builderScore >= 80
? "strong"
: "neutral";

for (const el of [marketCard, tradePanelCard, recentTradesCard, walletSummary, accessCard]) {
if (!el) continue;
el.dataset.phase = phase;
el.dataset.tone = tone;
}
}

function getWalletSummaryData(tokenPayload = {}, chartStats = {}, fallbackTokenBalance = null) {
const wallet = tokenPayload?.wallet || tokenPayload?.position || {};
const stats = tokenPayload?.stats || {};
const chartWallet = chartStats?.wallet || {};

const tokenBalanceRaw = firstFinite(
wallet?.token_balance,
wallet?.tokenBalance,
wallet?.balance_tokens,
wallet?.balance,
wallet?.wallet_token_balance,
chartWallet?.token_balance,
chartWallet?.tokenBalance,
tokenPayload?.wallet_token_balance,
tokenPayload?.walletBalance,
tokenPayload?.position?.token_balance,
stats?.wallet_token_balance,
stats?.wallet_balance_tokens,
stats?.walletBalance,
chartStats?.wallet_token_balance,
chartStats?.wallet_balance_tokens,
chartStats?.walletBalance,
fallbackTokenBalance
);

const tokenBalance = Math.max(0, toInt(tokenBalanceRaw ?? 0, 0));

const totalBalanceRaw = firstFinite(
wallet?.total_balance,
wallet?.totalBalance,
wallet?.wallet_total_balance,
chartWallet?.total_balance,
tokenPayload?.wallet_total_balance,
stats?.wallet_total_balance,
chartStats?.wallet_total_balance,
tokenBalance
);

const totalBalance = Math.max(tokenBalance, toInt(totalBalanceRaw ?? tokenBalance, tokenBalance));

const unlockedBalanceRaw = firstFinite(
wallet?.unlocked_balance,
wallet?.unlockedBalance,
wallet?.builder_unlocked_tokens,
wallet?.sellable_balance,
wallet?.sellableBalance,
wallet?.wallet_unlocked_balance,
wallet?.wallet_sellable_balance,
chartWallet?.unlocked_balance,
chartWallet?.sellable_balance,
tokenPayload?.wallet_unlocked_balance,
tokenPayload?.wallet_sellable_balance,
stats?.wallet_unlocked_balance,
stats?.wallet_sellable_balance,
chartStats?.wallet_unlocked_balance,
chartStats?.wallet_sellable_balance,
tokenBalance
);

const unlockedBalance = Math.max(0, toInt(unlockedBalanceRaw ?? tokenBalance, tokenBalance));

const lockedBalanceRaw = firstFinite(
wallet?.locked_balance,
wallet?.lockedBalance,
wallet?.builder_locked_tokens,
wallet?.wallet_locked_balance,
chartWallet?.locked_balance,
tokenPayload?.wallet_locked_balance,
stats?.wallet_locked_balance,
chartStats?.wallet_locked_balance,
Math.max(0, totalBalance - unlockedBalance)
);

const lockedBalance = Math.max(0, toInt(lockedBalanceRaw ?? Math.max(0, totalBalance - unlockedBalance), 0));

const sellableBalanceRaw = firstFinite(
wallet?.sellable_balance,
wallet?.sellableBalance,
wallet?.builder_sellable_tokens,
wallet?.wallet_sellable_balance,
chartWallet?.sellable_balance,
tokenPayload?.wallet_sellable_balance,
stats?.wallet_sellable_balance,
chartStats?.wallet_sellable_balance,
unlockedBalance,
tokenBalance - lockedBalance
);

const sellableBalance = Math.max(
0,
Math.min(
tokenBalance || totalBalance,
toInt(sellableBalanceRaw ?? unlockedBalance, unlockedBalance)
)
);

const priceUsd = toNumber(stats?.price_usd ?? chartStats?.price_usd, 0);

const positionValueUsdRaw = firstFinite(
wallet?.position_value_usd,
wallet?.positionValueUsd,
wallet?.wallet_position_value_usd,
chartWallet?.position_value_usd,
tokenPayload?.wallet_position_value_usd,
stats?.wallet_position_value_usd,
chartStats?.wallet_position_value_usd,
sellableBalance * priceUsd
);

const positionValueUsd = Math.max(0, toNumber(positionValueUsdRaw ?? 0, 0));

const solBalanceRaw = firstFinite(
wallet?.sol_balance,
wallet?.solBalance,
wallet?.wallet_sol_balance,
wallet?.walletSolBalance,
wallet?.sol_after,
wallet?.solAfter,
chartWallet?.sol_balance,
chartWallet?.wallet_sol_balance,
tokenPayload?.wallet_sol_balance,
tokenPayload?.walletSolBalance,
stats?.wallet_sol_balance,
stats?.walletSolBalance,
chartStats?.wallet_sol_balance,
chartStats?.walletSolBalance,
chartStats?.wallet_sol_after,
chartStats?.walletSolAfter,
wallet?.sol_delta,
wallet?.solDelta,
tokenPayload?.wallet_sol_delta,
chartStats?.wallet_sol_delta,
0
);

const solBalance = Math.max(0, toNumber(solBalanceRaw ?? 0, 0));

const solDelta = toNumber(
firstFinite(
wallet?.sol_delta,
wallet?.solDelta,
tokenPayload?.wallet_sol_delta,
stats?.wallet_sol_delta,
chartStats?.wallet_sol_delta,
solBalance
) ?? solBalance,
solBalance
);

const isBuilderWallet = Boolean(
wallet?.is_builder_wallet ??
tokenPayload?.wallet_is_builder ??
chartStats?.wallet_is_builder ??
false
);

const vestingActive = Boolean(
wallet?.vesting_active ??
tokenPayload?.wallet_vesting_active ??
chartStats?.wallet_vesting_active ??
false
);

const builderVestingPercentUnlocked = toNumber(
wallet?.builder_vesting_percent_unlocked ??
tokenPayload?.builder_vesting_percent_unlocked ??
chartStats?.builder_vesting_percent_unlocked,
0
);

const builderVestingDaysLive = toNumber(
wallet?.builder_vesting_days_live ??
tokenPayload?.builder_vesting_days_live ??
chartStats?.builder_vesting_days_live,
0
);

return {
tokenBalance,
totalBalance,
unlockedBalance,
lockedBalance,
sellableBalance,
positionValueUsd,
solBalance,
solDelta,
isBuilderWallet,
vestingActive,
builderVestingPercentUnlocked,
builderVestingDaysLive,
};
}

function updateWalletSummary(phase, connectedWallet, tokenPayload = {}, chartStats = {}, fallbackTokenBalance = null) {
const wrap = $("marketWalletSummary");
const tokenBalanceEl = $("walletTokenBalanceValue");
const positionValueEl = $("walletPositionValueValue");
const solBalanceEl = $("walletSolBalanceValue");

if (!wrap || !tokenBalanceEl || !positionValueEl || !solBalanceEl) return;

const show = phase === PHASES.LIVE;
wrap.classList.toggle("hidden", !show);

if (!show) return;

const summary = getWalletSummaryData(tokenPayload, chartStats, fallbackTokenBalance);
const hasWallet = Boolean(String(connectedWallet || "").trim());

if (!hasWallet) {
tokenBalanceEl.textContent = "Connect wallet";
positionValueEl.textContent = "—";
solBalanceEl.textContent = "—";
setText("launchWalletSummaryText", "Not Connected");
setText("launchWalletPositionText", "Connect Wallet");
setText("launchWalletLimitText", "—");
return;
}

if (summary.isBuilderWallet && (summary.vestingActive || summary.lockedBalance > 0)) {
tokenBalanceEl.innerHTML = `
<div>${formatTokenAmount(summary.sellableBalance, 0)} unlocked</div>
<div style="margin-top:4px;font-size:12px;opacity:.68;">
${formatTokenAmount(summary.lockedBalance, 0)} locked • ${formatPercent(summary.builderVestingPercentUnlocked, 1)}
</div>
`;
} else {
tokenBalanceEl.textContent = `${formatTokenAmount(summary.tokenBalance, 0)} tokens`;
}

positionValueEl.textContent = summary.positionValueUsd > 0 ? formatUsd(summary.positionValueUsd, 2) : "$0";
solBalanceEl.textContent = formatSol(summary.solBalance, 4);

setText("launchWalletSummaryText", shortAddress(connectedWallet));
setText(
"launchWalletPositionText",
summary.positionValueUsd > 0 ? formatUsd(summary.positionValueUsd, 2) : `${formatTokenAmount(summary.sellableBalance || summary.tokenBalance, 0)} tokens`
);
setText(
"launchWalletLimitText",
summary.isBuilderWallet
? `${formatTokenAmount(summary.sellableBalance, 0)} unlocked`
: `${formatTokenAmount(summary.tokenBalance, 0)} tokens`
);
}

function updateAccessCard(
phase,
launch = {},
tokenPayload = {},
chartStats = {},
quotePayload = null,
connectedWallet = "",
fallbackTokenBalance = null
) {
const card = $("marketAccessCard");
const tierLabel = $("marketAccessTierLabel");
const statePill = $("marketAccessStatePill");
const limitValue = $("marketAccessLimitValue");
const holdingValue = $("marketAccessHoldingValue");
const remainingValue = $("marketAccessRemainingValue");
const totalSupplyValue = $("marketTotalSupplyValue");
const schedule = $("marketAccessSchedule");

if (!card || !tierLabel || !statePill || !limitValue || !holdingValue || !remainingValue || !totalSupplyValue || !schedule) {
return;
}

const show = phase === PHASES.LIVE;
card.classList.toggle("hidden", !show);
if (!show) return;

const walletSummary = getWalletSummaryData(tokenPayload, chartStats, fallbackTokenBalance);
const totalSupply = toInt(
firstFinite(
tokenPayload?.token?.supply,
tokenPayload?.token?.total_supply,
tokenPayload?.stats?.total_supply,
chartStats?.total_supply,
launch?.final_supply,
launch?.supply
) ?? 0,
0
);

const backendMaxWallet = toInt(
firstFinite(
quotePayload?.quote?.maxWallet,
quotePayload?.quote?.maxWalletTokens,
quotePayload?.maxWallet,
quotePayload?.maxWalletTokens
) ?? 0,
0
);

const localMaxWalletPct = getLocalMaxWalletPercent(launch, connectedWallet);
const localMaxWalletTokens = totalSupply > 0
? Math.floor((totalSupply * localMaxWalletPct) / 100)
: 0;

const maxWalletTokens = backendMaxWallet > 0 ? backendMaxWallet : localMaxWalletTokens;
const effectiveHolding = walletSummary.isBuilderWallet
? walletSummary.sellableBalance
: walletSummary.tokenBalance;
const remaining = maxWalletTokens > 0
? Math.max(0, maxWalletTokens - effectiveHolding)
: 0;

statePill.classList.remove("is-open", "is-restricted");
statePill.classList.add("is-open");

const hasRestriction = localMaxWalletPct > 0 || maxWalletTokens > 0 || walletSummary.isBuilderWallet;

if (walletSummary.isBuilderWallet) {
statePill.textContent = "Vesting";
} else if (hasRestriction) {
statePill.textContent = "Capped";
} else {
statePill.textContent = "Open";
}

tierLabel.textContent = walletSummary.isBuilderWallet
? "Builder Vesting Controls"
: hasRestriction
? "Wallet Access Controls"
: "Open Access";

limitValue.textContent = maxWalletTokens > 0
? `${formatTokenAmount(maxWalletTokens, 0)} tokens`
: hasRestriction
? `${formatPercent(localMaxWalletPct, 2)} max wallet`
: "Open";

if (walletSummary.isBuilderWallet && (walletSummary.vestingActive || walletSummary.lockedBalance > 0)) {
holdingValue.innerHTML = `
<div>${formatTokenAmount(walletSummary.sellableBalance, 0)} unlocked</div>
<div style="margin-top:4px;font-size:12px;opacity:.68;">
${formatTokenAmount(walletSummary.lockedBalance, 0)} locked
</div>
`;
} else if (totalSupply > 0 && effectiveHolding > 0) {
const holdingPct = (effectiveHolding / totalSupply) * 100;
holdingValue.innerHTML = `
<div>${formatTokenAmount(effectiveHolding, 0)} tokens</div>
<div style="margin-top:4px;font-size:12px;opacity:.68;">${formatPercent(holdingPct, 3)}</div>
`;
} else {
holdingValue.textContent = `${formatTokenAmount(effectiveHolding, 0)} tokens`;
}

remainingValue.textContent = maxWalletTokens > 0
? `${formatTokenAmount(remaining, 0)} tokens`
: hasRestriction
? `${formatPercent(localMaxWalletPct, 2)} policy`
: "Unlimited";

totalSupplyValue.textContent = totalSupply > 0
? `${formatTokenAmount(totalSupply, 0)} tokens`
: "Pending";

if (walletSummary.isBuilderWallet) {
schedule.textContent =
`Builder vesting releases at 0.5% of total supply per day until the full 5% allocation is unlocked. Currently unlocked: ${formatPercent(walletSummary.builderVestingPercentUnlocked, 1)}.`;
} else if (hasRestriction) {
schedule.textContent = totalSupply > 0
? `Wallet concentration controls remain active. Current cap is ${formatPercent(localMaxWalletPct, 2)} of total supply.`
: `Wallet concentration controls remain active. Current cap is ${formatPercent(localMaxWalletPct, 2)} of total supply, with token-cap figures pending supply resolution.`;
} else {
schedule.textContent = "No wallet concentration limit detected for the current live phase.";
}

setText(
"launchAccessModeText",
walletSummary.isBuilderWallet ? "Builder Vesting" : hasRestriction ? "Controlled Access" : "Open Access"
);
}

function clearLiveOnlyUi() {
toggleHidden("marketWalletSummary", true);
toggleHidden("marketAccessCard", true);

setText("walletTokenBalanceValue", "—");
setText("walletPositionValueValue", "—");
setText("walletSolBalanceValue", "—");

setText("marketAccessLimitValue", "—");
setText("marketAccessHoldingValue", "—");
setText("marketAccessRemainingValue", "—");
setText("marketTotalSupplyValue", "—");
setText("marketAccessSchedule", "Allocation controls active.");

const recentTradesList = $("recentTradesList");
if (recentTradesList) {
recentTradesList.innerHTML = `<div class="recent-trades-empty">No trades yet.</div>`;
}

setTradeMessage("");
resetTradeQuoteUi();

setText("launchWalletSummaryText", "Not Connected");
setText("launchWalletPositionText", "Pre-Live");
setText("launchWalletLimitText", "Rule Based");
}

function getLifecycleStatusTone(status = "") {
const normalized = cleanString(status, 80).toLowerCase();
if (normalized === "graduated") return "good";
if (normalized === "ready") return "warn";
if (normalized.includes("pending")) return "warn";
return "neutral";
}

function renderLifecycleCard(lifecycle = null, graduationPlan = null, phase = PHASES.COMMIT) {
const section = $("lifecycleSection");
if (!section) return;

const lifecycleSafe = normalizeLifecyclePayload(lifecycle || {}) || {
graduationStatus: phase === PHASES.LIVE ? "internal_live" : "pending",
internalSolReserve: 0,
internalTokenReserve: 0,
raydiumTargetPct: 50,
mssLockedTargetPct: 50,
builderVesting: normalizeBuilderVestingPayload({}),
graduationReadiness: null,
graduated: false,
};
const graduationPlanSafe = normalizeGraduationPlanPayload(graduationPlan || {}) || null;

const statusValue = $("lifecycleStatusValue");
const statusPill = $("lifecycleStatusPill");
const reservesValue = $("lifecycleReservesValue");
const splitValue = $("lifecycleSplitValue");
const lockValue = $("lifecycleLockValue");
const raydiumValue = $("lifecycleRaydiumValue");
const builderVestValue = $("builderVestValue");
const readinessValue = $("graduationReadinessValue");
const readinessNote = $("graduationReadinessNote");
const graduateBtn = $("graduateDevnetBtn");
const graduationProof = $("graduationProofList");

const readiness = lifecycleSafe?.graduationReadiness || null;
const statusText = cleanString(
lifecycleSafe?.graduationStatus ||
(phase === PHASES.LIVE ? "internal_live" : "pending"),
80
) || "pending";

if (statusValue) {
statusValue.textContent = statusText.replaceAll("_", " ");
}

if (statusPill) {
statusPill.textContent = statusText.replaceAll("_", " ");
statusPill.className = `status-pill ${getLifecycleStatusTone(statusText) === "good" ? "live" : getLifecycleStatusTone(statusText) === "warn" ? "countdown" : "commit"}`;
}

const internalSol = toNumber(lifecycleSafe?.internalSolReserve, 0);
const internalTokens = toInt(lifecycleSafe?.internalTokenReserve, 0);

if (reservesValue) {
reservesValue.innerHTML = `
<div>${formatSol(internalSol, 4)}</div>
<div style="margin-top:4px;font-size:12px;opacity:.68;">${formatTokenAmount(internalTokens, 0)} tokens</div>
`;
}

const raydiumPct = toNumber(
lifecycleSafe?.raydiumTargetPct ?? graduationPlanSafe?.raydiumSplitPct,
50
);
const mssPct = toNumber(
lifecycleSafe?.mssLockedTargetPct ?? graduationPlanSafe?.mssLockedSplitPct,
50
);

if (splitValue) {
splitValue.innerHTML = `
<div>Raydium ${formatPercent(raydiumPct, 0)}</div>
<div style="margin-top:4px;font-size:12px;opacity:.68;">MSS locked ${formatPercent(mssPct, 0)}</div>
`;
}

const lockStatus = cleanString(lifecycleSafe?.lockStatus, 80) || "not_locked";
const lockTx = cleanString(lifecycleSafe?.lockTx, 240);
const lockExpiry = lifecycleSafe?.lockExpiresAt || null;

if (lockValue) {
lockValue.innerHTML = `
<div>${escapeHtml(lockStatus.replaceAll("_", " "))}</div>
<div style="margin-top:4px;font-size:12px;opacity:.68;">
${lockTx ? escapeHtml(shortAddress(lockTx, 10, 8)) : "No lock proof yet"}
${lockExpiry ? ` • ${escapeHtml(formatDateTime(lockExpiry))}` : ""}
</div>
`;
}

const raydiumPoolId = cleanString(lifecycleSafe?.raydiumPoolId, 240);
const raydiumMigrationTx = cleanString(lifecycleSafe?.raydiumMigrationTx, 240);
const raydiumSolMigrated = toNumber(lifecycleSafe?.raydiumSolMigrated, 0);
const raydiumTokenMigrated = toInt(lifecycleSafe?.raydiumTokenMigrated, 0);

if (raydiumValue) {
raydiumValue.innerHTML = `
<div>${raydiumPoolId ? escapeHtml(shortAddress(raydiumPoolId, 10, 8)) : "Pending"}</div>
<div style="margin-top:4px;font-size:12px;opacity:.68;">
${raydiumMigrationTx ? `${escapeHtml(shortAddress(raydiumMigrationTx, 10, 8))} • ` : ""}${escapeHtml(formatSol(raydiumSolMigrated, 4))} / ${escapeHtml(formatTokenAmount(raydiumTokenMigrated, 0))} tokens
</div>
`;
}

const vest = lifecycleSafe?.builderVesting || normalizeBuilderVestingPayload({});
const unlockedAmount = toInt(vest?.unlockedAmount, 0);
const lockedAmount = toInt(vest?.lockedAmount, 0);
const vestedDays = toInt(vest?.vestedDays, 0);
const totalAllocation = toInt(vest?.totalAllocation, 0);
const percentUnlocked = totalAllocation > 0 ? (unlockedAmount / totalAllocation) * 100 : 0;

if (builderVestValue) {
builderVestValue.innerHTML = `
<div>${formatTokenAmount(unlockedAmount, 0)} unlocked</div>
<div style="margin-top:4px;font-size:12px;opacity:.68;">${formatTokenAmount(lockedAmount, 0)} locked • day ${Math.max(1, vestedDays || 1)} • ${formatPercent(percentUnlocked, 1)}</div>
`;
}

if (readinessValue) {
readinessValue.textContent = readiness?.ready ? "Ready" : "Not Ready";
}

if (readinessNote) {
const thresholdText = readiness?.thresholds
? `MC ${formatNumber(readiness.thresholds.marketcapSol, { maximumFractionDigits: 0 })} SOL • Vol ${formatNumber(readiness.thresholds.volume24hSol, { maximumFractionDigits: 0 })} SOL • Holders ${formatNumber(readiness.thresholds.minHolders, { maximumFractionDigits: 0 })}`
: "";

readinessNote.textContent =
readiness?.ready
? "Graduation thresholds satisfied."
: lifecycleSafe?.graduated
? "Launch has already graduated."
: thresholdText || "Graduation conditions are still being monitored.";
}

if (graduateBtn) {
const canShow =
phase === PHASES.LIVE &&
Boolean(readiness?.ready) &&
!Boolean(lifecycleSafe?.graduated);

graduateBtn.classList.toggle("hidden", !canShow);
graduateBtn.disabled = !canShow || graduateBtn.dataset.busy === "1";
}

if (graduationProof) {
const items = [];

items.push(`
<div class="recent-item">
<div>
<div class="recent-wallet">Graduation Readiness</div>
<div class="recent-meta">${escapeHtml(readiness?.ready ? "Ready for graduation execution" : "Awaiting graduation conditions")}</div>
</div>
<div class="recent-wallet">${escapeHtml(readiness?.ready ? "READY" : "PENDING")}</div>
</div>
`);

if (raydiumPoolId || raydiumMigrationTx) {
items.push(`
<div class="recent-item">
<div>
<div class="recent-wallet">Raydium Migration</div>
<div class="recent-meta">${escapeHtml(raydiumMigrationTx || "Migration proof recorded")}</div>
</div>
<div class="recent-wallet">${escapeHtml(raydiumPoolId ? shortAddress(raydiumPoolId, 10, 8) : "Tracked")}</div>
</div>
`);
}

if (lockTx || lifecycleSafe?.mssLockedLpAmount) {
items.push(`
<div class="recent-item">
<div>
<div class="recent-wallet">MSS Lock Proof</div>
<div class="recent-meta">${escapeHtml(lockTx || "Lock metadata recorded")}</div>
</div>
<div class="recent-wallet">${escapeHtml(cleanString(lifecycleSafe?.mssLockedLpAmount, 80) || "Tracked")}</div>
</div>
`);
}

graduationProof.innerHTML = items.join("");
}

setText("launchGraduationReadinessText", readiness?.ready ? "Ready" : "Monitoring");
setText("launchLpInternalText", internalSol > 0 ? formatSol(internalSol, 4) : "Pending");
setText("launchLockedLpText", cleanString(lifecycleSafe?.lockStatus, 80) || "Pending");
setText("launchMigrationStateText", statusText.replaceAll("_", " "));
}

async function fetchJson(path, options = {}) {
const apiBase = window.API_BASE || getApiBase();

const response = await fetch(`${apiBase}${path}`, {
credentials: "include",
...options,
});

const json = await response.json().catch(() => null);

if (!response.ok) {
throw new Error(
json?.error ||
json?.message ||
`Request failed (${response.status})`
);
}

if (json && json.ok === false) {
throw new Error(json.error || json.message || "Request failed");
}

return json ?? {};
}

async function defaultFetchLaunch(launchId) {
return fetchJson(`/api/launcher/${encodeURIComponent(launchId)}`);
}

async function defaultFetchCommitStats(launchId) {
try {
return await fetchJson(`/api/launcher/commits/${encodeURIComponent(launchId)}`);
} catch {
return {};
}
}

async function defaultFetchTokenStats(launchId, wallet = "") {
try {
const qs = wallet ? `?wallet=${encodeURIComponent(wallet)}` : "";
return await fetchJson(`/api/token/${encodeURIComponent(launchId)}${qs}`);
} catch {
return {};
}
}

async function defaultFetchLifecycle(launchId) {
try {
return await fetchJson(`/api/launcher/${encodeURIComponent(launchId)}/lifecycle`);
} catch {
return {};
}
}

async function defaultFetchMarketSnapshot(launchId, interval = "1m", candleLimit = 120, tradeLimit = 50, wallet = "") {
const walletQs = wallet ? `&wallet=${encodeURIComponent(wallet)}` : "";

const [tokenPayload, snapshotPayload] = await Promise.all([
defaultFetchTokenStats(launchId, wallet),
fetchJson(
`/api/chart/${encodeURIComponent(launchId)}/snapshot?interval=${encodeURIComponent(interval)}&candle_limit=${encodeURIComponent(candleLimit)}&trade_limit=${encodeURIComponent(tradeLimit)}${walletQs}`
).catch(() => ({})),
]);

return {
tokenPayload: tokenPayload || {},
tokenTrades: resolveTradesFromPayload({
tokenPayload,
chartStats: snapshotPayload?.stats || {},
tokenTrades: snapshotPayload?.trades || [],
trades: snapshotPayload?.trades || [],
}),
chartStats: snapshotPayload?.stats || {},
candles: snapshotPayload?.candles || [],
chartLaunch: snapshotPayload?.launch || null,
pool: snapshotPayload?.pool || null,
wallet: snapshotPayload?.wallet || null,
cassie: snapshotPayload?.cassie || null,
};
}

async function defaultSaveLinks(launchId, payload) {
return fetchJson(`/api/launcher/${encodeURIComponent(launchId)}/links`, {
method: "PATCH",
headers: { "Content-Type": "application/json" },
body: JSON.stringify(payload),
});
}

async function defaultQuoteBuy(launchId, solAmount, wallet = "") {
return fetchJson(`/api/market/quote-buy`, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ launchId, solAmount, wallet }),
});
}

async function defaultQuoteSell(launchId, tokenAmount, wallet = "") {
return fetchJson(`/api/market/quote-sell`, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ launchId, tokenAmount, wallet }),
});
}

async function defaultExecuteBuy(launchId, wallet, solAmount) {
return fetchJson(`/api/market/buy`, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ launchId, wallet, solAmount }),
});
}

async function defaultExecuteSell(launchId, wallet, tokenAmount) {
return fetchJson(`/api/market/sell`, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ launchId, wallet, tokenAmount }),
});
}

async function defaultGraduateDevnet(launchId, payload = {}) {
return fetchJson(`/api/launcher/${encodeURIComponent(launchId)}/graduate-devnet`, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify(payload),
});
}

class LaunchMarketController {
constructor(options = {}) {
this.launchId = options.launchId || "";
this.connectedWallet = options.connectedWallet || "";
this.fetchLaunch = options.fetchLaunch || defaultFetchLaunch;
this.fetchCommitStats = options.fetchCommitStats || defaultFetchCommitStats;
this.fetchTokenStats = options.fetchTokenStats || defaultFetchTokenStats;
this.fetchLifecycle = options.fetchLifecycle || defaultFetchLifecycle;
this.fetchMarketSnapshot = options.fetchMarketSnapshot || defaultFetchMarketSnapshot;
this.saveLinks = options.saveLinks || defaultSaveLinks;
this.quoteBuy = options.quoteBuy || defaultQuoteBuy;
this.quoteSell = options.quoteSell || defaultQuoteSell;
this.executeBuy = options.executeBuy || defaultExecuteBuy;
this.executeSell = options.executeSell || defaultExecuteSell;
this.graduateDevnet = options.graduateDevnet || defaultGraduateDevnet;
this.onPhaseChange = typeof options.onPhaseChange === "function" ? options.onPhaseChange : null;

this.launch = options.launch ? canonicalizeLaunchTruth(options.launch, options.commitStats || {}) : null;
this.commitStats = options.commitStats || {};
this.lifecycle = null;
this.graduationPlan = null;
this.phase = PHASES.COMMIT;
this.currentInterval = options.initialInterval || "1m";
this.candleLimit = Number(options.candleLimit || 180);

this.commitPollMs = Number(options.commitPollMs || 15000);
this.countdownPollMs = Number(options.countdownPollMs || 2500);
this.buildingPollMs = Number(options.buildingPollMs || 1800);
this.livePollMs = Number(options.livePollMs || 6000);

this.tokenPayload = {};
this.chartStats = {};
this.candles = [];
this.trades = [];
this.pool = null;

this.tradeMode = TRADE_MODES.BUY;
this.lastQuote = null;
this.tradeBusy = false;
this.quoteBusy = false;
this.walletTokenBalanceFallback = 0;

this.refreshTimer = null;
this.countdownTimer = null;
this.chartRenderer = null;

this._liveRefreshInFlight = null;
this._launchRefreshInFlight = null;
this._timeframeRefreshInFlight = null;
this._walletRefreshTimeout = null;
this._destroyed = false;

this._boundHandleManageLinksClick = this.handleManageLinksClick.bind(this);
this._boundHandleSaveLinksClick = this.handleSaveLinksClick.bind(this);
this._boundHandleCloseLinksClick = this.handleCloseLinksClick.bind(this);
this._boundHandleBackdropClick = this.handleBackdropClick.bind(this);
this._boundHandleCaCopy = this.handleCaCopy.bind(this);
this._boundHandleTimeframeClick = this.handleTimeframeClick.bind(this);
this._boundHandleTradeTabClick = this.handleTradeTabClick.bind(this);
this._boundHandleTradeQuickClick = this.handleTradeQuickClick.bind(this);
this._boundHandleTradeSubmitClick = this.handleTradeSubmitClick.bind(this);
this._boundHandleTradeAmountInput = this.handleTradeAmountInput.bind(this);
this._boundHandleGraduateDevnetClick = this.handleGraduateDevnetClick.bind(this);
}

async init() {
this.bindEvents();
this.mountChartRenderer();
updateTradeTabUi(this.tradeMode);
resetTradeQuoteUi();

if (!this.launch && this.launchId) {
await this.refreshLaunch({ force: true });
} else {
this.launch = canonicalizeLaunchTruth(this.launch || {}, this.commitStats || {});
this.applyAll();
}

this.startPollingLoop();
return this;
}

destroy() {
this._destroyed = true;
this.stopTimers();
this.unbindEvents();

if (this._walletRefreshTimeout) {
clearTimeout(this._walletRefreshTimeout);
this._walletRefreshTimeout = null;
}

if (this.chartRenderer) {
this.chartRenderer.destroy();
this.chartRenderer = null;
}
}

mountChartRenderer() {
const chartHost = $("marketChartCanvas");
const volumeHost = $("marketVolumeCanvas");

if (!chartHost || !volumeHost) return;

let tooltipHost = $("eliteChartTooltip");
if (!tooltipHost) {
tooltipHost = document.createElement("div");
tooltipHost.id = "eliteChartTooltip";
tooltipHost.style.position = "absolute";
tooltipHost.style.top = "12px";
tooltipHost.style.left = "12px";
tooltipHost.style.zIndex = "3";
tooltipHost.style.pointerEvents = "none";
chartHost.parentNode?.appendChild(tooltipHost);
}

this.chartRenderer = createEliteChartRenderer({
chartHost,
volumeHost,
tooltipHost,
});
}

bindEvents() {
$("manageLaunchLinksBtn")?.addEventListener("click", this._boundHandleManageLinksClick);
$("saveLaunchLinksBtn")?.addEventListener("click", this._boundHandleSaveLinksClick);
$("closeLaunchLinksModalBtn")?.addEventListener("click", this._boundHandleCloseLinksClick);
$("launchLinksModal")?.addEventListener("click", this._boundHandleBackdropClick);

$("launchCaCopyBtn")?.addEventListener("click", this._boundHandleCaCopy);
$("chartCaCopyBtn")?.addEventListener("click", this._boundHandleCaCopy);
$("graduateDevnetBtn")?.addEventListener("click", this._boundHandleGraduateDevnetClick);

document.querySelectorAll(".market-timeframe").forEach((btn) => {
btn.addEventListener("click", this._boundHandleTimeframeClick);
});

$("tradeTabBuy")?.addEventListener("click", this._boundHandleTradeTabClick);
$("tradeTabSell")?.addEventListener("click", this._boundHandleTradeTabClick);
$("tradeSubmitBtn")?.addEventListener("click", this._boundHandleTradeSubmitClick);
$("tradeAmountInput")?.addEventListener("input", this._boundHandleTradeAmountInput);
document.querySelectorAll(".trade-quick-btn").forEach((btn) => {
btn.addEventListener("click", this._boundHandleTradeQuickClick);
});
}

unbindEvents() {
$("manageLaunchLinksBtn")?.removeEventListener("click", this._boundHandleManageLinksClick);
$("saveLaunchLinksBtn")?.removeEventListener("click", this._boundHandleSaveLinksClick);
$("closeLaunchLinksModalBtn")?.removeEventListener("click", this._boundHandleCloseLinksClick);
$("launchLinksModal")?.removeEventListener("click", this._boundHandleBackdropClick);

$("launchCaCopyBtn")?.removeEventListener("click", this._boundHandleCaCopy);
$("chartCaCopyBtn")?.removeEventListener("click", this._boundHandleCaCopy);
$("graduateDevnetBtn")?.removeEventListener("click", this._boundHandleGraduateDevnetClick);

document.querySelectorAll(".market-timeframe").forEach((btn) => {
btn.removeEventListener("click", this._boundHandleTimeframeClick);
});

$("tradeTabBuy")?.removeEventListener("click", this._boundHandleTradeTabClick);
$("tradeTabSell")?.removeEventListener("click", this._boundHandleTradeTabClick);
$("tradeSubmitBtn")?.removeEventListener("click", this._boundHandleTradeSubmitClick);
$("tradeAmountInput")?.removeEventListener("input", this._boundHandleTradeAmountInput);
document.querySelectorAll(".trade-quick-btn").forEach((btn) => {
btn.removeEventListener("click", this._boundHandleTradeQuickClick);
});
}

stopTimers() {
if (this.refreshTimer) {
clearInterval(this.refreshTimer);
this.refreshTimer = null;
}
if (this.countdownTimer) {
clearInterval(this.countdownTimer);
this.countdownTimer = null;
}
}

startPollingLoop() {
this.stopTimers();

if (this.phase === PHASES.COUNTDOWN) {
this.refreshTimer = setInterval(async () => {
try {
await this.refreshLaunch({ force: true });
} catch (error) {
console.error("launch-market countdown refresh failed:", error);
}
}, this.countdownPollMs);

this.startCountdownTicker();
return;
}

if (this.phase === PHASES.BUILDING) {
this.refreshTimer = setInterval(async () => {
try {
await this.refreshLaunch({ force: true });
} catch (error) {
console.error("launch-market building refresh failed:", error);
}
}, this.buildingPollMs);
return;
}

if (this.phase !== PHASES.LIVE) {
this.refreshTimer = setInterval(async () => {
try {
await this.refreshLaunch({ force: false });
} catch (error) {
console.error("launch-market commit refresh failed:", error);
}
}, this.commitPollMs);
return;
}

this.refreshTimer = setInterval(async () => {
try {
await this.refreshLiveMarketOnly({ force: true });
} catch (error) {
console.error("launch-market live refresh failed:", error);
}
}, this.livePollMs);
}

startCountdownTicker() {
if (this.countdownTimer) clearInterval(this.countdownTimer);

updateCountdownUi(this.launch, this.commitStats);

this.countdownTimer = setInterval(() => {
this.launch = canonicalizeLaunchTruth(this.launch || {}, this.commitStats || {});
updateCountdownUi(this.launch, this.commitStats);

const nextPhase = inferPhase(this.launch, this.commitStats);
if (nextPhase !== this.phase) {
const previousPhase = this.phase;
this.phase = nextPhase;
this.applyAll(previousPhase);
this.startPollingLoop();

if (nextPhase === PHASES.LIVE) {
void this.refreshLiveMarketOnly({ force: true, previousPhaseOverride: previousPhase }).catch((error) => {
console.error("countdown to live refresh failed:", error);
});
}

if (nextPhase === PHASES.BUILDING) {
void this.refreshLaunch({ force: true }).catch((error) => {
console.error("countdown to building refresh failed:", error);
});
}
}
}, 1000);
}

applySnapshotPayload(payload = {}) {
this.tokenPayload = payload?.tokenPayload || {};
this.chartStats = payload?.chartStats || {};
this.candles = payload?.candles || [];
this.trades = resolveTradesFromPayload({
tokenPayload: this.tokenPayload,
chartStats: this.chartStats,
tokenTrades: payload?.tokenTrades || [],
trades: payload?.trades || [],
});
this.pool = payload?.pool || null;

const tokenLaunchPatch = buildLaunchPatchFromTokenPayload(this.tokenPayload);

if (payload?.chartLaunch) {
this.launch = mergeLaunchTruth(this.launch || {}, payload.chartLaunch);
}

if (!this.lifecycle) {
this.lifecycle = normalizeLifecyclePayload(
this.tokenPayload?.lifecycle ||
this.tokenPayload?.launch?.lifecycle ||
null
);
}

if (!this.graduationPlan) {
this.graduationPlan = normalizeGraduationPlanPayload(
this.tokenPayload?.graduationPlan ||
this.tokenPayload?.graduation_plan ||
null
);
}

this.launch = mergeLaunchTruth(this.launch || {}, tokenLaunchPatch);
this.launch = canonicalizeLaunchTruth(this.launch || {}, this.commitStats || {});

const liveWalletSummary = getWalletSummaryData(
this.tokenPayload,
this.chartStats,
this.walletTokenBalanceFallback
);

if (liveWalletSummary.tokenBalance > 0 || this.walletTokenBalanceFallback <= 0) {
this.walletTokenBalanceFallback = liveWalletSummary.tokenBalance;
}
}

async refreshLifecycleOnly() {
if (!this.launchId) return;

const payload = await this.fetchLifecycle(this.launchId);
this.lifecycle = normalizeLifecyclePayload(payload?.lifecycle || null);
this.graduationPlan = normalizeGraduationPlanPayload(payload?.graduationPlan || payload?.graduation_plan || null);
}

async refreshLiveMarketOnly({ force = false, previousPhaseOverride = null } = {}) {
if (!this.launchId) return;
if (!force && this.phase !== PHASES.LIVE) return;

if (this._liveRefreshInFlight) {
return this._liveRefreshInFlight;
}

this._liveRefreshInFlight = (async () => {
const [payload] = await Promise.all([
this.fetchMarketSnapshot(
this.launchId,
this.currentInterval,
this.candleLimit,
50,
this.connectedWallet || ""
),
this.refreshLifecycleOnly().catch(() => null),
]);

if (this._destroyed) return;

this.applySnapshotPayload(payload);
this.applyAll(previousPhaseOverride);
if (this.startPollingLoop) this.startPollingLoop();

if (this.chartRenderer) {
this.chartRenderer.setInterval(this.currentInterval);
if (typeof this.chartRenderer.updateData === "function") {
this.chartRenderer.updateData({
candles: this.candles,
trades: this.trades,
stats: this.chartStats,
});
} else if (typeof this.chartRenderer.setData === "function") {
this.chartRenderer.setData({
candles: this.candles,
trades: this.trades,
stats: this.chartStats,
});
}
}
})();

try {
return await this._liveRefreshInFlight;
} finally {
this._liveRefreshInFlight = null;
}
}

async refreshLaunch({ force = false } = {}) {
if (!this.launchId) return;

if (this._launchRefreshInFlight) {
return this._launchRefreshInFlight;
}

this._launchRefreshInFlight = (async () => {
const previousPhase = this.phase;

const [launchPayload, commitStatsPayload, lifecyclePayload, tokenPayload] = await Promise.all([
this.fetchLaunch(this.launchId),
this.fetchCommitStats(this.launchId),
this.fetchLifecycle(this.launchId).catch(() => ({})),
this.fetchTokenStats(this.launchId, this.connectedWallet || "").catch(() => ({})),
]);

if (this._destroyed) return;

const incomingLaunch = normalizeLaunchTruth(launchPayload?.launch || launchPayload || {});
const commitStatsPatch = buildLaunchPatchFromCommitStats(commitStatsPayload || {});
const tokenLaunchPatch = buildLaunchPatchFromTokenPayload(tokenPayload || {});

this.tokenPayload = tokenPayload || this.tokenPayload || {};
this.commitStats = commitStatsPayload || {};

this.launch = mergeLaunchTruth(this.launch || {}, incomingLaunch);
this.launch = mergeLaunchTruth(this.launch || {}, commitStatsPatch);
this.launch = mergeLaunchTruth(this.launch || {}, tokenLaunchPatch);
this.launch = canonicalizeLaunchTruth(this.launch || {}, this.commitStats || {});

this.lifecycle = normalizeLifecyclePayload(
lifecyclePayload?.lifecycle ||
tokenPayload?.lifecycle ||
tokenPayload?.launch?.lifecycle ||
null
);
this.graduationPlan = normalizeGraduationPlanPayload(
lifecyclePayload?.graduationPlan ||
lifecyclePayload?.graduation_plan ||
tokenPayload?.graduationPlan ||
tokenPayload?.graduation_plan ||
null
);

const nextPhase = inferPhase(this.launch, this.commitStats);
this.phase = nextPhase;

if (nextPhase === PHASES.LIVE) {
await this.refreshLiveMarketOnly({ force: true, previousPhaseOverride: previousPhase });
} else {
this.applyAll(previousPhase);
}

if (previousPhase !== this.phase || force) {
this.startPollingLoop();
}
})();

try {
return await this._launchRefreshInFlight;
} finally {
this._launchRefreshInFlight = null;
}
}

applyAll(previousPhaseOverride = null) {
if (!this.launch) return;

this.launch = canonicalizeLaunchTruth(this.launch || {}, this.commitStats || {});
const previousPhase = previousPhaseOverride ?? this.phase;
this.phase = inferPhase(this.launch, this.commitStats);

updateTokenIdentity(this.launch, this.tokenPayload);
updateContractAddress(this.launch, this.tokenPayload, this.commitStats);
renderExternalLinks(this.launch);
setManageLinksVisibility(this.launch, this.connectedWallet, this.commitStats);
updatePhaseClasses(this.phase);
updatePhaseContent(this.phase, this.launch, this.commitStats, this.lifecycle);
setTradePanelVisibility(this.phase);
syncMarketShellLayout();
syncChartSizing(this.phase);
syncTerminalPresentation(this.phase, this.launch, this.chartStats, this.tokenPayload);

const builderWallet = choosePreferredNonEmpty(
this.launch?.builder_wallet,
this.tokenPayload?.launch?.builder_wallet
);
setText("launchStatusBoardBuilderWallet", builderWallet ? shortAddress(builderWallet) : "Pending");

if (this.phase === PHASES.COMMIT) {
clearLiveOnlyUi();
updateStatsForCommit(this.launch, this.commitStats);
renderCassiePanel(this.phase, this.launch, this.tokenPayload, this.chartStats);
} else if (this.phase === PHASES.COUNTDOWN) {
clearLiveOnlyUi();
updateStatsForCountdown(this.launch, this.commitStats);
updateCountdownUi(this.launch, this.commitStats);
renderCassiePanel(this.phase, this.launch, this.tokenPayload, this.chartStats);
} else if (this.phase === PHASES.BUILDING) {
clearLiveOnlyUi();
updateStatsForBuilding(this.launch, this.lifecycle);
renderCassiePanel(this.phase, this.launch, this.tokenPayload, this.chartStats);
} else {
updateStatsForLive(this.tokenPayload, this.chartStats, this.launch, this.lifecycle);
updateWalletSummary(
this.phase,
this.connectedWallet,
this.tokenPayload,
this.chartStats,
this.walletTokenBalanceFallback
);
updateAccessCard(
this.phase,
this.launch,
this.tokenPayload,
this.chartStats,
this.lastQuote,
this.connectedWallet,
this.walletTokenBalanceFallback
);
renderRecentTrades(this.trades, this.tokenPayload, this.chartStats);
renderCassiePanel(this.phase, this.launch, this.tokenPayload, this.chartStats);

if (this.chartRenderer) {
this.chartRenderer.setInterval(this.currentInterval);
if (typeof this.chartRenderer.setData === "function") {
this.chartRenderer.setData({
candles: this.candles,
trades: this.trades,
stats: this.chartStats,
});
} else if (typeof this.chartRenderer.updateData === "function") {
this.chartRenderer.updateData({
candles: this.candles,
trades: this.trades,
stats: this.chartStats,
});
}
}
}

renderLifecycleCard(this.lifecycle, this.graduationPlan, this.phase);

this.syncSellQuickButtons();
this.renderTradePanel();

if (previousPhase !== this.phase && this.onPhaseChange) {
this.onPhaseChange(this.phase, this.launch, this.tokenPayload, this.chartStats);
}
}

getWalletTokenBalance() {
const summary = getWalletSummaryData(
this.tokenPayload,
this.chartStats,
this.walletTokenBalanceFallback
);
return Math.max(summary.sellableBalance, summary.tokenBalance > 0 && summary.sellableBalance <= 0 ? summary.tokenBalance : 0);
}

syncSellQuickButtons() {
const sellButtons = Array.from(document.querySelectorAll("#tradeQuickSellRow .trade-quick-btn"));
if (!sellButtons.length) return;

const balance = this.getWalletTokenBalance();

sellButtons.forEach((btn) => {
const pct = toNumber(btn.dataset.pct, 0);
btn.disabled = this.phase !== PHASES.LIVE || balance <= 0 || pct <= 0 || this.tradeBusy || this.quoteBusy;
});
}

renderTradePanel() {
updateTradeTabUi(this.tradeMode);

const submitBtn = $("tradeSubmitBtn");
const amount = this.getTradeAmountValue();
const hasAmount = amount > 0;

if (submitBtn) {
submitBtn.disabled = this.phase !== PHASES.LIVE || this.tradeBusy || this.quoteBusy || !hasAmount;
submitBtn.textContent = this.lastQuote
? this.tradeMode === TRADE_MODES.BUY
? "Execute Buy"
: "Execute Sell"
: this.tradeMode === TRADE_MODES.BUY
? "Preview Buy"
: "Preview Sell";
}
}

setConnectedWallet(wallet) {
this.connectedWallet = wallet || "";
this.lastQuote = null;
resetTradeQuoteUi();
setTradeMessage("");

if (this.launch) setManageLinksVisibility(this.launch, this.connectedWallet, this.commitStats);

if (this.phase === PHASES.LIVE) {
updateWalletSummary(
this.phase,
this.connectedWallet,
this.tokenPayload,
this.chartStats,
this.walletTokenBalanceFallback
);
updateAccessCard(
this.phase,
this.launch,
this.tokenPayload,
this.chartStats,
this.lastQuote,
this.connectedWallet,
this.walletTokenBalanceFallback
);
this.syncSellQuickButtons();
this.renderTradePanel();

if (this._walletRefreshTimeout) {
clearTimeout(this._walletRefreshTimeout);
}

this._walletRefreshTimeout = setTimeout(() => {
void this.refreshLiveMarketOnly({ force: true }).catch((error) => {
console.error("wallet sync refresh failed:", error);
});
}, 250);
return;
}

if (this._walletRefreshTimeout) {
clearTimeout(this._walletRefreshTimeout);
}

this._walletRefreshTimeout = setTimeout(() => {
void this.refreshLaunch({ force: true }).catch((error) => {
console.error("wallet metadata refresh failed:", error);
});
}, 250);
}

async handleManageLinksClick() {
if (!this.launch) return;
fillLinksModal(this.launch);
openLinksModal();
}

handleCloseLinksClick() {
closeLinksModal();
}

handleBackdropClick(event) {
const modal = $("launchLinksModal");
if (!modal || modal.classList.contains("hidden")) return;

if (event.target === modal || event.target.classList.contains("launch-links-modal-backdrop")) {
closeLinksModal();
}
}

async handleSaveLinksClick() {
const saveBtn = $("saveLaunchLinksBtn");
if (!saveBtn || !this.launchId) return;

const originalText = saveBtn.textContent;
saveBtn.disabled = true;
saveBtn.textContent = "Saving...";

try {
const payload = {
website_url: normalizeUrl($("linkWebsiteInput")?.value || "", "website_url"),
x_url: normalizeUrl($("linkXInput")?.value || "", "x_url"),
telegram_url: normalizeUrl($("linkTelegramInput")?.value || "", "telegram_url"),
discord_url: normalizeUrl($("linkDiscordInput")?.value || "", "discord_url"),
wallet: this.connectedWallet || "",
};
const result = await this.saveLinks(this.launchId, payload);
this.launch = mergeLaunchTruth(this.launch || {}, result?.launch || payload);
this.launch = canonicalizeLaunchTruth(this.launch || {}, this.commitStats || {});
renderExternalLinks(this.launch);
setManageLinksVisibility(this.launch, this.connectedWallet, this.commitStats);
closeLinksModal();
} catch (error) {
console.error("save links failed:", error);
alert(error?.message || "Failed to save links.");
} finally {
saveBtn.disabled = false;
saveBtn.textContent = originalText;
}
}

async handleCaCopy(event) {
const button = event.currentTarget;
if (!button) return;

const fullValue = button.dataset.copyValue || "";
const ok = await copyText(fullValue);
if (!ok) return;

const originalHtml = button.innerHTML;
setButtonCopiedState(button, originalHtml);
}

async handleTimeframeClick(event) {
const btn = event.currentTarget;
const timeframesWrap = $("marketTimeframes");
if (!btn || !timeframesWrap || timeframesWrap.classList.contains("disabled")) return;

if (this._timeframeRefreshInFlight) return;

document.querySelectorAll(".market-timeframe").forEach((el) => {
el.classList.remove("active");
});
btn.classList.add("active");

this.currentInterval = btn.dataset.interval || "1m";
this.lastQuote = null;
resetTradeQuoteUi();
setTradeMessage("");

if (this.chartRenderer) {
this.chartRenderer.setInterval(this.currentInterval);
}

if (this.phase === PHASES.LIVE) {
this._timeframeRefreshInFlight = this.refreshLiveMarketOnly({ force: true })
.catch((error) => {
console.error("timeframe refresh failed:", error);
})
.finally(() => {
this._timeframeRefreshInFlight = null;
});

await this._timeframeRefreshInFlight;
} else {
this.renderTradePanel();
}
}

handleTradeTabClick(event) {
const id = event.currentTarget?.id;
this.tradeMode = id === "tradeTabSell" ? TRADE_MODES.SELL : TRADE_MODES.BUY;
this.lastQuote = null;
resetTradeQuoteUi();
setTradeMessage("");
updateTradeTabUi(this.tradeMode);
this.syncSellQuickButtons();
this.renderTradePanel();
}

handleTradeQuickClick(event) {
if (this.tradeBusy || this.quoteBusy) return;

const input = $("tradeAmountInput");
if (!input) return;

if (this.tradeMode === TRADE_MODES.BUY) {
const amount = event.currentTarget?.dataset?.amount || "";
input.value = amount;
this.lastQuote = null;
resetTradeQuoteUi();
setTradeMessage("");
this.renderTradePanel();
return;
}

const pct = toNumber(event.currentTarget?.dataset?.pct, 0);
const balance = this.getWalletTokenBalance();

if (pct > 0 && balance > 0) {
input.value = String(Math.max(0, Math.floor((balance * pct) / 100)));
this.lastQuote = null;
resetTradeQuoteUi();
setTradeMessage("");
this.renderTradePanel();
}
}

handleTradeAmountInput() {
this.lastQuote = null;
setTradeMessage("");
resetTradeQuoteUi();
this.renderTradePanel();
}

getTradeAmountValue() {
const input = $("tradeAmountInput");
return toNumber(input?.value || 0, 0);
}

async getTradeQuote() {
const amount = this.getTradeAmountValue();
if (amount <= 0) {
throw new Error(this.tradeMode === TRADE_MODES.BUY ? "Enter a SOL amount" : "Enter a token amount");
}

if (this.tradeMode === TRADE_MODES.BUY) {
return this.quoteBuy(this.launchId, amount, this.connectedWallet || "");
}

return this.quoteSell(this.launchId, amount, this.connectedWallet || "");
}

applyQuoteToUi(quotePayload) {
const quote = quotePayload?.quote || quotePayload || {};
this.lastQuote = quotePayload;

if (this.tradeMode === TRADE_MODES.BUY) {
setText("tradeQuotePrimaryValue", `${formatTokenAmount(quote?.tokensBought || quote?.tokenOut || 0, 0)} tokens`);
setText("tradeQuotePriceValue", quote?.price > 0 ? `${formatPriceSol(quote.price)} SOL` : "—");
setText("tradeQuoteFeeValue", formatSol(quote?.feeSol || quote?.fee_sol || 0, 6));

if ($("tradeQuoteWalletLimitValue")) {
if (quote?.maxWallet || quote?.maxWalletTokens) {
const maxWalletTokens = toInt(quote?.maxWallet ?? quote?.maxWalletTokens, 0);
const maxWalletText = formatTokenAmount(maxWalletTokens, 0);
const afterText =
quote?.walletBalanceAfter != null
? ` / After ${formatTokenAmount(quote.walletBalanceAfter, 0)}`
: "";
$("tradeQuoteWalletLimitValue").textContent = `${maxWalletText}${afterText}`;
} else if (quote?.walletBalanceAfter != null) {
$("tradeQuoteWalletLimitValue").textContent = `After ${formatTokenAmount(quote.walletBalanceAfter, 0)}`;
} else {
$("tradeQuoteWalletLimitValue").textContent = "Applies";
}
}
} else {
setText("tradeQuotePrimaryValue", formatSol(quote?.netSolOut || quote?.solOut || quote?.solReceived || 0, 6));
setText("tradeQuotePriceValue", quote?.price > 0 ? `${formatPriceSol(quote.price)} SOL` : "—");
setText("tradeQuoteFeeValue", formatSol(quote?.feeSol || quote?.fee_sol || 0, 6));
setText(
"tradeQuoteWalletLimitValue",
quote?.walletBalanceAfter != null
? `${formatTokenAmount(quote.walletBalanceAfter, 0)} tokens`
: "—"
);

if (quote?.walletBalanceBefore != null) {
this.walletTokenBalanceFallback = toNumber(quote.walletBalanceBefore, this.walletTokenBalanceFallback);
}
}

updateAccessCard(
this.phase,
this.launch,
this.tokenPayload,
this.chartStats,
quotePayload,
this.connectedWallet,
this.walletTokenBalanceFallback
);

this.renderTradePanel();
}

async executeTrade() {
const amount = this.getTradeAmountValue();
if (amount <= 0) {
throw new Error(this.tradeMode === TRADE_MODES.BUY ? "Enter a SOL amount" : "Enter a token amount");
}
if (!this.connectedWallet) {
throw new Error("Connect wallet first");
}

if (this.tradeMode === TRADE_MODES.BUY) {
return this.executeBuy(this.launchId, this.connectedWallet, amount);
}

return this.executeSell(this.launchId, this.connectedWallet, amount);
}

async handleTradeSubmitClick() {
if (this.phase !== PHASES.LIVE || this.tradeBusy || this.quoteBusy) return;

const submitBtn = $("tradeSubmitBtn");
const originalText = submitBtn?.textContent || "Preview Buy";

try {
setTradeMessage("");

if (!this.lastQuote) {
if (!this.connectedWallet) {
throw new Error("Connect wallet first");
}

this.quoteBusy = true;
this.renderTradePanel();

if (submitBtn) {
submitBtn.textContent = this.tradeMode === TRADE_MODES.BUY ? "Preparing Buy Preview..." : "Preparing Sell Preview...";
}

const quotePayload = await this.getTradeQuote();
this.applyQuoteToUi(quotePayload);
setTradeMessage(
this.tradeMode === TRADE_MODES.BUY
? "Buy preview ready. Review execution details and submit again to execute."
: "Sell preview ready. Review execution details and submit again to execute.",
"success"
);
return;
}

this.tradeBusy = true;
this.renderTradePanel();

if (submitBtn) {
submitBtn.textContent = this.tradeMode === TRADE_MODES.BUY ? "Executing Buy..." : "Executing Sell...";
}

const inputAmount = this.getTradeAmountValue();
const result = await this.executeTrade();

if (this.tradeMode === TRADE_MODES.BUY) {
this.walletTokenBalanceFallback = toNumber(
result?.walletBalanceAfter,
this.walletTokenBalanceFallback + toNumber(result?.tokensReceived ?? result?.tokenOut, 0)
);
} else {
this.walletTokenBalanceFallback = toNumber(
result?.walletBalanceAfter,
Math.max(0, this.walletTokenBalanceFallback - toNumber(inputAmount, 0))
);
}

const message =
this.tradeMode === TRADE_MODES.BUY
? `Buy Executed\nReceived: ${formatTokenAmount(result?.tokensReceived || result?.tokenOut || 0, 0)} tokens\nPaid: ${formatSol(inputAmount, 6)}\nFee: ${formatSol(result?.feeSol || result?.fee_sol || 0, 6)}`
: `Sell Executed\nReceived: ${formatSol(result?.solReceived || result?.netSolOut || result?.solOut || 0, 6)}\nSold: ${formatTokenAmount(inputAmount, 0)} tokens\nFee: ${formatSol(result?.feeSol || result?.fee_sol || 0, 6)}`;

setTradeMessage(message, "success");

this.lastQuote = null;
resetTradeQuoteUi();

const input = $("tradeAmountInput");
if (input) input.value = "";

await this.refreshLiveMarketOnly({ force: true });
this.renderTradePanel();
} catch (error) {
console.error("trade submit failed:", error);
setTradeMessage(error?.message || "Trade failed", "error");
} finally {
this.quoteBusy = false;
this.tradeBusy = false;
if (submitBtn) submitBtn.textContent = originalText;
this.renderTradePanel();
}
}

async handleGraduateDevnetClick() {
const btn = $("graduateDevnetBtn");
if (!btn || !this.launchId) return;
if (btn.dataset.busy === "1") return;

const originalText = btn.textContent;
btn.dataset.busy = "1";
btn.disabled = true;
btn.textContent = "Graduating...";

try {
const result = await this.graduateDevnet(this.launchId, {
reason: "devnet_manual_override",
});

this.lifecycle = normalizeLifecyclePayload(result?.lifecycle || this.lifecycle || null);
if (result?.launch) {
this.launch = mergeLaunchTruth(this.launch || {}, result.launch);
this.launch = canonicalizeLaunchTruth(this.launch || {}, this.commitStats || {});
}

setTradeMessage("Launch marked as graduated on devnet.", "success");
await this.refreshLaunch({ force: true });
} catch (error) {
console.error("graduate devnet failed:", error);
setTradeMessage(error?.message || "Failed to mark launch graduated.", "error");
} finally {
btn.dataset.busy = "0";
btn.disabled = false;
btn.textContent = originalText;
this.applyAll();
}
}

setBaseState(launch, commitStats = {}, options = {}) {
const previousPhase = this.phase;
this.commitStats = commitStats || this.commitStats || {};
this.launch = canonicalizeLaunchTruth(
mergeLaunchTruth(this.launch || {}, launch || {}),
this.commitStats || {}
);
this.applyAll(previousPhase);

if (options.restartPolling) {
this.startPollingLoop();
}
}
}

export function createLaunchMarketController(options = {}) {
return new LaunchMarketController(options);
}

export async function initLaunchMarket(options = {}) {
const controller = new LaunchMarketController(options);
await controller.init();
return controller;
}

window.MSSLaunchMarket = {
createLaunchMarketController,
initLaunchMarket,
};