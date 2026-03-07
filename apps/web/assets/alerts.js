import { apiGet, apiPost, getApiBase } from "./api.js";

(() => {
const $ = (id) => document.getElementById(id);

function setText(id, v) {
const el = $(id);
if (el) el.textContent = v;
}

function setDot(id, state) {
const el = $(id);
if (!el) return;
el.classList.remove("good", "warn", "bad");
if (state) el.classList.add(state);
}

function shortAddr(s, left = 5, right = 5) {
if (!s || typeof s !== "string") return "—";
if (s.length <= left + right + 3) return s;
return `${s.slice(0, left)}…${s.slice(-right)}`;
}

function fmtDate(s) {
if (!s) return "—";
const d = new Date(`${s}Z`);
if (!Number.isFinite(d.getTime())) return s;
return d.toLocaleString();
}

function getJwt() {
return localStorage.getItem("mssToken");
}

function isLoggedIn() {
return !!getJwt();
}

function renderLoginState() {
if (isLoggedIn()) {
setDot("loginStateDot", "good");
setText("loginStateText", "Logged in");
} else {
setDot("loginStateDot", "warn");
setText("loginStateText", "Login required");
}
}

function renderAlerts(alerts) {
const wrap = $("alertsList");
if (!wrap) return;

if (!Array.isArray(alerts) || !alerts.length) {
wrap.innerHTML = `<div class="empty">No saved alerts yet.</div>`;
return;
}

wrap.innerHTML = "";

for (const a of alerts) {
const el = document.createElement("div");
el.className = "alert-item";

const enabled = Number(a.is_enabled) === 1;
const thresholdText = a.type === "authority" ? "Auto logic" : `${a.direction} ${a.threshold}`;

el.innerHTML = `
<div class="alert-top">
<div>
<div style="font-weight:900; letter-spacing:.2px">${a.type}</div>
<div class="muted mono" style="margin-top:4px">${shortAddr(a.mint, 8, 8)}</div>
</div>
<div class="row">
<span class="badge"><span class="dot ${enabled ? "good" : "warn"}"></span>${enabled ? "Enabled" : "Paused"}</span>
<button class="btn small ghost" data-toggle-id="${a.id}">${enabled ? "Disable" : "Enable"}</button>
</div>
</div>

<div class="alert-meta">
<span class="badge">Threshold: ${thresholdText}</span>
<span class="badge">Created: ${fmtDate(a.created_at)}</span>
<span class="badge">Last Triggered: ${a.last_triggered_at ? fmtDate(a.last_triggered_at) : "Never"}</span>
</div>
`;

wrap.appendChild(el);
}

wrap.querySelectorAll("[data-toggle-id]").forEach((btn) => {
btn.addEventListener("click", async () => {
const id = btn.getAttribute("data-toggle-id");
await toggleAlert(id);
});
});
}

function renderEvents(events) {
const wrap = $("eventsList");
if (!wrap) return;

if (!Array.isArray(events) || !events.length) {
wrap.innerHTML = `<div class="empty">No alert events available yet.</div>`;
return;
}

wrap.innerHTML = "";

for (const ev of events) {
const el = document.createElement("div");
el.className = "event-item";
el.innerHTML = `
<div style="font-weight:800">${ev.type || "Alert Event"}</div>
<div class="muted mono" style="margin-top:4px">${shortAddr(ev.mint, 8, 8)}</div>
<div style="margin-top:8px; line-height:1.5">${ev.message || "—"}</div>
<div class="muted" style="margin-top:8px">${fmtDate(ev.created_at)}</div>
`;
wrap.appendChild(el);
}
}

async function fetchAlerts() {
const jwt = getJwt();
if (!jwt) {
renderAlerts([]);
setText("createStatus", "Login required to manage alerts.");
return [];
}

try {
const data = await apiGet("/api/alerts", { token: jwt });
const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
renderAlerts(alerts);
return alerts;
} catch (e) {
renderAlerts([]);
setText("createStatus", e?.message || "Failed to load alerts.");
return [];
}
}

async function fetchEventsFromAlerts(alerts) {
const wrap = $("eventsList");
if (!wrap) return;

if (!Array.isArray(alerts) || !alerts.length) {
renderEvents([]);
return;
}

const items = [];
for (const a of alerts.slice(0, 8)) {
if (!a.last_triggered_at) continue;
items.push({
mint: a.mint,
type: a.type,
message: `${a.type} alert triggered for ${shortAddr(a.mint, 8, 8)}.`,
created_at: a.last_triggered_at,
});
}

items.sort((a, b) => new Date(b.created_at + "Z") - new Date(a.created_at + "Z"));
renderEvents(items.slice(0, 12));
}

async function refreshAll() {
renderLoginState();
const alerts = await fetchAlerts();
await fetchEventsFromAlerts(alerts);
}

async function toggleAlert(id) {
const jwt = getJwt();
if (!jwt) {
setText("createStatus", "Login required to manage alerts.");
return;
}

try {
await apiPost(`/api/alerts/${id}/toggle`, {}, jwt);
setText("createStatus", "Alert updated.");
await refreshAll();
} catch (e) {
setText("createStatus", e?.message || "Failed to update alert.");
}
}

async function createAlert() {
const jwt = getJwt();
if (!jwt) {
setText("createStatus", "Login required to create alerts.");
return;
}

const mint = ($("mintInput")?.value || "").trim();
const type = $("typeSelect")?.value || "risk_spike";
const direction = $("directionSelect")?.value || "above";
const thresholdRaw = ($("thresholdInput")?.value || "").trim();

if (!mint) {
setText("createStatus", "Enter a token mint.");
return;
}

let threshold = Number(thresholdRaw);
if (type === "authority") {
threshold = 1;
} else if (!Number.isFinite(threshold)) {
setText("createStatus", "Enter a valid threshold.");
return;
}

try {
setText("createStatus", "Creating alert…");
await apiPost("/api/alerts", { mint, type, direction, threshold }, jwt);
setText("createStatus", "Alert created.");
await refreshAll();
} catch (e) {
setText("createStatus", e?.message || "Failed to create alert.");
}
}

function bindUi() {
$("createAlertBtn")?.addEventListener("click", createAlert);
$("refreshAlertsBtn")?.addEventListener("click", refreshAll);

$("typeSelect")?.addEventListener("change", () => {
const type = $("typeSelect")?.value;
const threshold = $("thresholdInput");
if (!threshold) return;

if (type === "authority") {
threshold.value = "";
threshold.placeholder = "Not required for authority alerts";
threshold.disabled = true;
} else {
threshold.disabled = false;
if (type === "risk_spike") threshold.placeholder = "Threshold (e.g. 70)";
else if (type === "whale") threshold.placeholder = "Threshold (e.g. 65)";
else if (type === "liquidity") threshold.placeholder = "Threshold (e.g. 25000)";
else if (type === "top10") threshold.placeholder = "Threshold (e.g. 55)";
else threshold.placeholder = "Threshold";
}
});
}

function init() {
setText("apiMeta", `API: ${getApiBase()}`);
setDot("netDot", "good");
setText("netText", "Online");
bindUi();
refreshAll();
}

if (document.readyState === "loading") {
document.addEventListener("DOMContentLoaded", init);
} else {
init();
}
})();
