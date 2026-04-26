const DEFAULT_INTERVAL = "1m";

function $(id) {
return document.getElementById(id);
}

function setText(id, value) {
const el = $(id);
if (el) el.textContent = value ?? "—";
}

function getApiBase() {
if (window.API_BASE && typeof window.API_BASE === "string" && window.API_BASE.trim()) {
return window.API_BASE.replace(/\/+$/, "");
}

const { protocol, hostname, port } = window.location;

if (
hostname === "devnet.mssprotocol.com" ||
hostname === "www.devnet.mssprotocol.com"
) {
return "https://api.mssprotocol.com";
}

if (hostname === "mssprotocol.com" || hostname === "www.mssprotocol.com") {
return "https://api.mssprotocol.com";
}

if (hostname === "127.0.0.1" || hostname === "localhost" || port === "3000") {
return `${protocol}//${hostname}:8787`;
}

if (hostname.includes("-3000.app.github.dev")) {
return `${protocol}//${hostname.replace("-3000.app.github.dev", "-8787.app.github.dev")}`;
}

return "";
}

function toNumber(value, fallback = 0) {
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function formatUsd(value, options = {}) {
const num = Number(value);
if (!Number.isFinite(num)) return "—";

if (num > 0 && num < 0.000001) return `$${num.toExponential(2)}`;
if (num < 1) return `$${num.toFixed(options.smallDecimals ?? 8)}`;
if (num < 1000) return `$${num.toFixed(options.decimals ?? 4)}`;

return new Intl.NumberFormat("en-US", {
style: "currency",
currency: "USD",
notation: num >= 1_000_000 ? "compact" : "standard",
maximumFractionDigits: num >= 1_000_000 ? 2 : 0,
}).format(num);
}

function formatCompact(value) {
const num = Number(value);
if (!Number.isFinite(num)) return "—";

return new Intl.NumberFormat("en-US", {
notation: Math.abs(num) >= 10_000 ? "compact" : "standard",
maximumFractionDigits: 2,
}).format(num);
}

function formatPct(value) {
const num = Number(value);
if (!Number.isFinite(num)) return "—";
const sign = num > 0 ? "+" : "";
return `${sign}${num.toFixed(2)}%`;
}

function cleanText(value, fallback = "—") {
const text = String(value ?? "").trim();
return text || fallback;
}

function pickToken(payload = {}) {
return payload.token || payload.launch || payload.market || payload.data?.token || payload.data || {};
}

function pickStats(payload = {}) {
return payload.stats || payload.marketStats || payload.data?.stats || payload.snapshot?.stats || {};
}

function pickSnapshot(payload = {}) {
return payload.snapshot || payload.data?.snapshot || payload || {};
}

function pickLinks(payload = {}) {
const token = pickToken(payload);

return {
website: token.website_url || token.website || payload.website_url || payload.website,
x: token.x_url || token.twitter_url || token.x || payload.x_url || payload.twitter_url,
telegram: token.telegram_url || token.telegram || payload.telegram_url,
discord: token.discord_url || token.discord || payload.discord_url,
};
}

function setMarketVisible(visible) {
const section = $("tokenMarketSection");
if (section) section.style.display = visible ? "" : "none";
}

function renderLinks(payload = {}) {
const container = $("tokenMarketLinks");
if (!container) return;

const links = pickLinks(payload);
const items = [
["Website", links.website],
["X", links.x],
["Telegram", links.telegram],
["Discord", links.discord],
].filter(([, href]) => href && /^https?:\/\//i.test(String(href)));

if (!items.length) {
container.innerHTML = `<span class="launch-link-chip" aria-disabled="true">No external links added</span>`;
return;
}

container.innerHTML = items
.map(([label, href]) => {
const safeHref = String(href).replace(/"/g, "&quot;");
return `<a class="launch-link-chip" href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>`;
})
.join("");
}

function renderMiniChart(payload = {}) {
const chart = $("tokenMarketChartCanvas");
const volume = $("tokenMarketVolumeCanvas");

const candles =
payload.candles ||
payload.snapshot?.candles ||
payload.data?.candles ||
[];

if (!chart) return;

if (!Array.isArray(candles) || !candles.length) {
chart.innerHTML = `
<div style="display:grid;place-items:center;height:100%;min-height:260px;color:rgba(255,255,255,.58);font-size:13px;text-align:center;padding:24px;">
Market chart data will appear after live trading activity is available.
</div>
`;
if (volume) volume.innerHTML = "";
return;
}

const last = candles.slice(-40);
const prices = last.flatMap((c) => [
toNumber(c.high ?? c.h ?? c.close ?? c.c),
toNumber(c.low ?? c.l ?? c.close ?? c.c),
]).filter((n) => Number.isFinite(n) && n > 0);

const max = Math.max(...prices);
const min = Math.min(...prices);
const range = max - min || 1;

chart.innerHTML = `
<div style="height:280px;display:flex;align-items:flex-end;gap:3px;padding:18px;">
${last.map((c) => {
const open = toNumber(c.open ?? c.o ?? c.close ?? c.c);
const close = toNumber(c.close ?? c.c ?? c.open ?? c.o);
const high = toNumber(c.high ?? c.h ?? Math.max(open, close));
const low = toNumber(c.low ?? c.l ?? Math.min(open, close));
const top = ((max - high) / range) * 100;
const bottom = ((low - min) / range) * 100;
const bodyTop = ((max - Math.max(open, close)) / range) * 100;
const bodyBottom = ((Math.min(open, close) - min) / range) * 100;
const up = close >= open;
return `
<div style="position:relative;flex:1;height:100%;min-width:3px;">
<span style="position:absolute;left:50%;top:${top}%;bottom:${bottom}%;width:1px;background:${up ? "rgba(53,245,163,.55)" : "rgba(255,91,107,.55)"};"></span>
<span style="position:absolute;left:20%;right:20%;top:${bodyTop}%;bottom:${bodyBottom}%;min-height:2px;border-radius:999px;background:${up ? "rgba(53,245,163,.88)" : "rgba(255,91,107,.88)"};"></span>
</div>
`;
}).join("")}
</div>
`;

if (volume) {
volume.innerHTML = "";
}
}

function renderPayload(payload = {}, mint = "") {
const token = pickToken(payload);
const stats = pickStats(payload);
const snapshot = pickSnapshot(payload);

const name = cleanText(token.token_name || token.name || snapshot.token_name || snapshot.name, "Token");
const symbol = cleanText(token.symbol || snapshot.symbol, "—");
const contractAddress =
token.contract_address ||
token.mint_address ||
token.token_mint_address ||
token.mint ||
snapshot.contract_address ||
snapshot.mint_address ||
mint;

const price =
stats.price_usd ??
stats.priceUsd ??
snapshot.price_usd ??
snapshot.priceUsd ??
token.price_usd;

const change =
stats.price_change_24h ??
stats.change_24h ??
stats.change24h ??
snapshot.price_change_24h ??
snapshot.change24h;

const liquidity =
stats.liquidity_usd ??
stats.liquidityUsd ??
stats.total_lp_liquidity_usd ??
snapshot.liquidity_usd ??
token.liquidity_usd;

const marketCap =
stats.market_cap_usd ??
stats.marketCapUsd ??
stats.mcap_usd ??
snapshot.market_cap_usd ??
token.market_cap_usd;

const volume =
stats.volume_24h_usd ??
stats.volume24hUsd ??
stats.volume_usd ??
snapshot.volume_24h_usd;

const buys = stats.buys_24h ?? stats.buy_count_24h ?? stats.buys ?? "—";
const sells = stats.sells_24h ?? stats.sell_count_24h ?? stats.sells ?? "—";

const high =
stats.high_24h ??
stats.high24h ??
snapshot.high_24h;

const low =
stats.low_24h ??
stats.low24h ??
snapshot.low_24h;

setText("tokenMarketName", name);
setText("tokenMarketSymbol", symbol);
setText("tokenMarketCaText", contractAddress || "Pending");

setText("tokenMarketStat1Label", "Price");
setText("tokenMarketStat1Value", formatUsd(price));

setText("tokenMarketStat2Label", "24h Change");
setText("tokenMarketStat2Value", formatPct(change));

setText("tokenMarketStat3Label", "Liquidity");
setText("tokenMarketStat3Value", formatUsd(liquidity));

setText("tokenMarketStat4Label", "Market Cap");
setText("tokenMarketStat4Value", formatUsd(marketCap));

setText("tokenMarketVolumeText", `Volume ${formatUsd(volume)}`);
setText("tokenMarketTradesText", `Buys ${formatCompact(buys)} • Sells ${formatCompact(sells)}`);
setText("tokenMarketHighLowText", `H ${formatUsd(high)} • L ${formatUsd(low)}`);

renderLinks(payload);
renderMiniChart(payload);

const copyBtn = $("tokenMarketCaCopyBtn");
if (copyBtn && contractAddress) {
copyBtn.onclick = async () => {
try {
await navigator.clipboard.writeText(contractAddress);
const old = copyBtn.querySelector(".chart-ca-chip-copy")?.textContent;
const label = copyBtn.querySelector(".chart-ca-chip-copy");
if (label) label.textContent = "Copied";
setTimeout(() => {
if (label) label.textContent = old || "Copy";
}, 1200);
} catch {}
};
}
}

async function fetchTokenMarket(mint, interval) {
const apiBase = getApiBase();
if (!apiBase || !mint) return null;

const url = `${apiBase}/api/token-market/${encodeURIComponent(mint)}?interval=${encodeURIComponent(interval || DEFAULT_INTERVAL)}`;

const res = await fetch(url, {
headers: {
Accept: "application/json",
},
});

if (!res.ok) {
throw new Error(`GET /api/token-market/:mint failed with ${res.status}`);
}

return res.json();
}

export async function initTokenMarket(options = {}) {
let mint = cleanText(options.mint || options.tokenMint || "", "");
let interval = DEFAULT_INTERVAL;
let destroyed = false;

const controller = {
async refresh(nextMint = mint) {
mint = cleanText(nextMint || mint, "");

if (destroyed || !mint) {
setMarketVisible(false);
return null;
}

setMarketVisible(true);

try {
const payload = await fetchTokenMarket(mint, interval);
if (!payload || payload.ok === false) {
renderPayload({}, mint);
return payload;
}

renderPayload(payload, mint);
return payload;
} catch (error) {
console.error("GET /api/token-market/:mint failed", error);
renderPayload({}, mint);
return null;
}
},

setMint(nextMint) {
mint = cleanText(nextMint || "", "");
return controller.refresh(mint);
},

setInterval(nextInterval) {
interval = cleanText(nextInterval || DEFAULT_INTERVAL, DEFAULT_INTERVAL);
return controller.refresh(mint);
},

destroy() {
destroyed = true;
},

getState() {
return { mint, interval, destroyed };
},
};

document.querySelectorAll(".token-market-timeframe").forEach((btn) => {
btn.addEventListener("click", () => {
document.querySelectorAll(".token-market-timeframe").forEach((node) => {
node.classList.toggle("active", node === btn);
});

controller.setInterval(btn.dataset.interval || DEFAULT_INTERVAL);
});
});

await controller.refresh(mint);

return controller;
}

export default initTokenMarket;
