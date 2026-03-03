import { apiGet, apiPost, getApiBase } from "./api.js";
import { SAMPLE_MINT } from "./config.js";
import { $, setText, setBadge } from "./dom.js";
import { renderMarket, renderTokenAuthorities, renderHolders, renderClusters, renderRisk, renderRaw, renderNotes } from "./render.js";
import { computeConcentration, calcRisk } from "./metrics.js";
import { buildActivityFromHolders } from "../activity.js"; // ✅ uses existing apps/web/assets/activity.js

let lastState = {
mint: "",
tokenJson: null,
marketJson: null,
holdersJson: null,
};

async function runScan(mint) {
setBadge("scanDot", "scanStatusText", "warn", "Scanning…");
setText("scanMetaText", `mint: ${mint.slice(0, 4)}…${mint.slice(-4)}`);

try {
const [tokenJson, marketJson, holdersJson] = await Promise.all([
apiGet(`/api/sol/token/${mint}`),
apiGet(`/api/sol/market/${mint}`),
apiGet(`/api/sol/holders/${mint}`),
]);

lastState = { mint, tokenJson, marketJson, holdersJson };

renderTokenAuthorities(tokenJson);
renderMarket(marketJson);

// holders dropdown
const holdersSelect = $("holdersSelect");
const topN = holdersSelect ? Number(holdersSelect.value || 20) : 20;

// render holders + concentration
const conc = renderHolders(holdersJson, topN, computeConcentration);

// clusters (best-effort from holders snapshot)
const activity = buildActivityFromHolders(holdersJson);
renderClusters(activity);

// risk model (uses market + concentration + authorities)
const rm = calcRisk({ tokenJson, marketJson, conc });
renderRisk(rm);

// notes
renderNotes({ tokenJson, marketJson, conc, activity, rm });

// raw json panel
renderRaw({
mint,
token: tokenJson,
market: marketJson,
holders: holdersJson,
derived: { concentration: conc, activity, riskModel: rm },
});

// footer api label
setText("apiMeta", `API: ${getApiBase().replace(/^https?:\/\//, "")}`);

setBadge("scanDot", "scanStatusText", "good", "Scan complete");
} catch (e) {
renderRaw({ mint, error: e?.message || String(e) });
setBadge("scanDot", "scanStatusText", "bad", "Scan error");
}
}

function rerenderHoldersOnly() {
if (!lastState?.holdersJson) return;
const holdersSelect = $("holdersSelect");
const topN = holdersSelect ? Number(holdersSelect.value || 20) : 20;
renderHolders(lastState.holdersJson, topN, computeConcentration);
}

function init() {
const tokenInput = $("tokenInput");
const scanBtn = $("scanBtn");
const demoBtn = $("demoBtn");
const holdersSelect = $("holdersSelect");

if (!tokenInput || !scanBtn) return;

// initial badges
setBadge("netDot", "netText", "good", "Online");
setBadge("scanDot", "scanStatusText", null, "Ready");
setText("apiMeta", `API: ${getApiBase().replace(/^https?:\/\//, "")}`);

scanBtn.addEventListener("click", () => {
const mint = (tokenInput.value || "").trim();
if (!mint) return;
runScan(mint);
});

tokenInput.addEventListener("keydown", (e) => {
if (e.key === "Enter") {
e.preventDefault();
scanBtn.click();
}
});

if (demoBtn) {
demoBtn.addEventListener("click", () => {
tokenInput.value = SAMPLE_MINT;
scanBtn.click();
});
}

if (holdersSelect) {
holdersSelect.addEventListener("change", () => {
rerenderHoldersOnly();
});
}

// Alerts (requires token)
const enableAlertsBtn = $("enableAlertsBtn");
const alertStatus = $("alertStatus");

if (enableAlertsBtn && alertStatus) {
enableAlertsBtn.addEventListener("click", async () => {
const mint = (tokenInput.value || "").trim();
if (!mint) {
alertStatus.textContent = "Scan a token first.";
return;
}

const jwt = localStorage.getItem("mssToken");
if (!jwt) {
alertStatus.textContent = "Login required to enable alerts.";
return;
}

try {
alertStatus.textContent = "Saving alert…";
const data = await apiPost(
"/api/alerts",
{ mint, type: "risk", direction: "up", threshold: 1 },
jwt // ✅ token string
);
if (data?.error) {
alertStatus.textContent = data.error;
return;
}
alertStatus.textContent = "Alerts enabled for this token.";
} catch (err) {
alertStatus.textContent = err?.message || "Failed to save alert.";
}
});
}

// auto-scan ?mint=
const params = new URLSearchParams(window.location.search);
const qMint = params.get("mint");
if (qMint) {
tokenInput.value = qMint;
runScan(qMint);
}
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
