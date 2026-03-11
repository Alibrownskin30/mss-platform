function $(id) {
return document.getElementById(id);
}

const API_BASE = "http://127.0.0.1:8787";

const TEMPLATE_CONFIG = {
degen: {
name: "Degen",
description: "Fast-entry degen launch profile with lower raise thresholds and tighter cap.",
minRaise: 10,
hardCap: 50,
participantsPct: 45,
liquidityPct: 20,
reservePct: 30,
builderPct: 5,
},
meme_lite: {
name: "Meme Lite",
description: "Standard community launch flow with balanced raise thresholds and broad participation.",
minRaise: 20,
hardCap: 100,
participantsPct: 45,
liquidityPct: 20,
reservePct: 30,
builderPct: 5,
},
meme_pro: {
name: "Meme Pro",
description: "Larger meme launch profile designed for stronger raises and broader early traction.",
minRaise: 50,
hardCap: 200,
participantsPct: 45,
liquidityPct: 20,
reservePct: 30,
builderPct: 5,
},
builder: {
name: "Builder",
description: "Higher-trust builder launch profile with larger raise range and premium structure.",
minRaise: 100,
hardCap: 300,
participantsPct: 45,
liquidityPct: 20,
reservePct: 30,
builderPct: 5,
},
};

function setStatus(message, type = "") {
const el = $("formStatus");
if (!el) return;

el.className = "status";
if (!message) {
el.textContent = "";
return;
}

if (type === "good") el.classList.add("good");
if (type === "bad") el.classList.add("bad");
el.textContent = message;
}

function escapeHtml(str) {
return String(str ?? "")
.replaceAll("&", "&amp;")
.replaceAll("<", "&lt;")
.replaceAll(">", "&gt;")
.replaceAll('"', "&quot;")
.replaceAll("'", "&#039;");
}

function renderTemplateSummary() {
const key = $("template")?.value || "meme_lite";
const cfg = TEMPLATE_CONFIG[key] || TEMPLATE_CONFIG.meme_lite;

$("templateName").textContent = cfg.name;
$("templateMeta").textContent = cfg.description;
$("minRaiseStat").textContent = `${cfg.minRaise} SOL`;
$("hardCapStat").textContent = `${cfg.hardCap} SOL`;
$("participantsStat").textContent = `${cfg.participantsPct}%`;
$("liquidityStat").textContent = `${cfg.liquidityPct}%`;
$("reserveStat").textContent = `${cfg.reservePct}%`;
$("builderStat").textContent = `${cfg.builderPct}%`;
}

function renderLogoPreviewFromUrl(url) {
const preview = $("logoPreview");
if (!preview) return;

const clean = String(url || "").trim();
if (!clean) {
preview.innerHTML = "No image selected";
return;
}

preview.innerHTML = `<img src="${escapeHtml(clean)}" alt="Logo preview" />`;
}

function handleFilePreview(file) {
const preview = $("logoPreview");
if (!preview) return;
if (!file) {
preview.innerHTML = "No image selected";
return;
}

const reader = new FileReader();
reader.onload = () => {
const result = String(reader.result || "");
preview.innerHTML = `<img src="${escapeHtml(result)}" alt="Logo preview" />`;
};
reader.readAsDataURL(file);
}

async function createLaunch(payload) {
const res = await fetch(`${API_BASE}/api/launcher/create`, {
method: "POST",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify(payload),
});

const data = await res.json().catch(() => null);

if (!res.ok || !data?.ok) {
throw new Error(data?.error || `HTTP ${res.status}`);
}

return data;
}

function getPayload() {
return {
wallet: $("wallet")?.value?.trim() || "",
template: $("template")?.value?.trim() || "",
token_name: $("token_name")?.value?.trim() || "",
symbol: ($("symbol")?.value?.trim() || "").toUpperCase(),
description: $("description")?.value?.trim() || "",
image_url: $("image_url")?.value?.trim() || "",
};
}

async function onSubmit(event) {
event.preventDefault();
setStatus("");

const btn = $("createBtn");
if (btn) btn.disabled = true;

try {
const payload = getPayload();

if (!payload.wallet) throw new Error("Builder wallet is required.");
if (!payload.template) throw new Error("Template is required.");
if (!payload.token_name) throw new Error("Token name is required.");
if (!payload.symbol) throw new Error("Symbol is required.");

const data = await createLaunch(payload);
const launch = data.launch || {};

setStatus(
`Launch created successfully.\n\nLaunch ID: ${launch.id}\nStatus: ${launch.status}\nTemplate: ${launch.template}\nMin Raise: ${launch.min_raise_sol} SOL\nHard Cap: ${launch.hard_cap_sol} SOL`,
"good"
);

window.scrollTo({ top: 0, behavior: "smooth" });
} catch (err) {
console.error(err);
setStatus(err.message || "Failed to create launch.", "bad");
} finally {
if (btn) btn.disabled = false;
}
}

function init() {
$("template")?.addEventListener("change", renderTemplateSummary);

$("logoFile")?.addEventListener("change", (e) => {
const file = e.target.files?.[0];
handleFilePreview(file);
});

$("image_url")?.addEventListener("input", (e) => {
const url = e.target.value;
if (String(url || "").trim()) {
renderLogoPreviewFromUrl(url);
}
});

$("launchForm")?.addEventListener("submit", onSubmit);

renderTemplateSummary();
}

init();