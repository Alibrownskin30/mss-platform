import { bindSessionUi } from "../auth.js";

function $(id) {
return document.getElementById(id);
}

function getApiBase() {
const { protocol, hostname, port } = window.location;
if (port === "3000") {
return `${protocol}//${hostname}:8787`;
}
return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
}

function normalizeSymbol(v) {
return String(v || "")
.toUpperCase()
.replace(/[^A-Z0-9]/g, "")
.slice(0, 12);
}

function normalizeTemplateLabel(v) {
return String(v || "")
.replaceAll("_", " ")
.replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatSupply(v) {
const n = Number(v);
if (!Number.isFinite(n) || n <= 0) return "—";
return n.toLocaleString("en-AU");
}

function formatSol(v) {
const n = Number(v);
if (!Number.isFinite(n) || n <= 0) return "— SOL";
return `${n} SOL`;
}

function shortenWallet(wallet) {
const w = String(wallet || "").trim();
if (w.length <= 12) return w;
return `${w.slice(0, 4)}...${w.slice(-4)}`;
}

function setStatus(kind, message) {
const el = $("createStatus");
if (!el) return;
el.className = `status show ${kind}`;
el.textContent = message;
}

function clearStatus() {
const el = $("createStatus");
if (!el) return;
el.className = "status";
el.textContent = "";
}

const TEMPLATE_CONFIG = {
meme_lite: {
supply: 1000000000,
minRaiseSol: 20,
hardCapSol: 100,
},
meme_pro: {
supply: 1000000000,
minRaiseSol: 50,
hardCapSol: 250,
},
builder: {
supply: 1000000000,
minRaiseSol: 50,
hardCapSol: 250,
},
community: {
supply: 1000000000,
minRaiseSol: 40,
hardCapSol: 200,
},
degen_zone: {
supply: 1000000000,
minRaiseSol: 10,
hardCapSol: 50,
},
};

let connectedWallet = null;

function getSelectedTemplate() {
const key = $("template")?.value || "meme_lite";
return {
key,
...(TEMPLATE_CONFIG[key] || TEMPLATE_CONFIG.meme_lite),
};
}

function isBuilderTemplate() {
return getSelectedTemplate().key === "builder";
}

function applyTemplateValues() {
const tpl = getSelectedTemplate();
const builderMode = isBuilderTemplate();
const supplyInput = $("supply");
const supplyPreset = $("supplyPreset");
const fixedSupplyField = $("fixedSupplyField");
const builderSupplyField = $("builderSupplyField");
const builderExtras = $("builderExtras");

if (builderMode) {
const builderSupply = Number(supplyPreset?.value || tpl.supply);
if (supplyInput) supplyInput.value = String(builderSupply);
if (fixedSupplyField) fixedSupplyField.style.display = "none";
if (builderSupplyField) builderSupplyField.classList.add("show");
if (builderExtras) builderExtras.classList.add("show");
} else {
if (supplyInput) supplyInput.value = String(tpl.supply);
if (fixedSupplyField) fixedSupplyField.style.display = "grid";
if (builderSupplyField) builderSupplyField.classList.remove("show");
if (builderExtras) builderExtras.classList.remove("show");
}

if ($("minRaiseSol")) $("minRaiseSol").value = String(tpl.minRaiseSol);
if ($("hardCapSol")) $("hardCapSol").value = String(tpl.hardCapSol);
}

function getWalletValue() {
const inputWallet = $("wallet")?.value.trim() || "";
return connectedWallet || inputWallet;
}

function getTeamWallets() {
const inputs = Array.from(document.querySelectorAll("#teamWalletInputs input"));
return inputs.map((input) => input.value.trim()).filter(Boolean);
}

function getFormValues() {
const tpl = getSelectedTemplate();
const builderMode = isBuilderTemplate();
const supplyValue = builderMode
? Number($("supplyPreset")?.value || tpl.supply)
: tpl.supply;

return {
wallet: getWalletValue(),
template: tpl.key,
tokenName: $("tokenName")?.value.trim() || "",
symbol: normalizeSymbol($("symbol")?.value || ""),
description: $("description")?.value.trim() || "",
imageUrl: $("imageUrl")?.value.trim() || "",
supply: supplyValue,
minRaiseSol: tpl.minRaiseSol,
hardCapSol: tpl.hardCapSol,
teamWalletCount: builderMode ? Number($("teamWalletCount")?.value || 0) : 0,
teamAllocation: builderMode ? Number($("teamAllocation")?.value || 0) : 0,
builderBond: builderMode ? Number($("builderBond")?.value || 0) : 0,
teamWallets: builderMode ? getTeamWallets() : [],
};
}

function validateForm(values) {
if (!values.wallet) {
throw new Error("Builder wallet is required. Connect Phantom or enter a wallet manually for testing.");
}

if (values.wallet.length < 6) {
throw new Error("Builder wallet looks too short.");
}

if (!values.tokenName) {
throw new Error("Token name is required.");
}

if (values.tokenName.length < 2) {
throw new Error("Token name must be at least 2 characters.");
}

if (!values.symbol) {
throw new Error("Symbol is required.");
}

if (values.symbol.length < 2) {
throw new Error("Symbol must be at least 2 characters.");
}

if (!values.description) {
throw new Error("Description is required.");
}

if (!Number.isFinite(Number(values.supply)) || Number(values.supply) <= 0) {
throw new Error("Template supply is invalid.");
}

if (!Number.isFinite(Number(values.minRaiseSol)) || Number(values.minRaiseSol) <= 0) {
throw new Error("Template minimum raise is invalid.");
}

if (!Number.isFinite(Number(values.hardCapSol)) || Number(values.hardCapSol) <= 0) {
throw new Error("Template hard cap is invalid.");
}

if (Number(values.minRaiseSol) > Number(values.hardCapSol)) {
throw new Error("Template configuration is invalid: min raise exceeds hard cap.");
}

if (values.template === "builder") {
if (!Number.isFinite(values.teamAllocation) || values.teamAllocation < 0) {
throw new Error("Team allocation is invalid.");
}

if (values.teamAllocation > 15) {
throw new Error("Team allocation cannot exceed 15%.");
}

if (!Number.isFinite(values.teamWalletCount) || values.teamWalletCount < 0 || values.teamWalletCount > 5) {
throw new Error("Team wallet count must be between 0 and 5.");
}

if (values.teamWallets.length !== values.teamWalletCount) {
throw new Error("Please fill in all team wallet fields or reduce the team wallet count.");
}

if (!Number.isFinite(values.builderBond) || values.builderBond < 5) {
throw new Error("Builder bond must be at least 5 SOL.");
}
}

const logoFile = $("logoInput")?.files?.[0];
if (logoFile) {
const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
if (!allowed.includes(logoFile.type)) {
throw new Error("Logo file type must be PNG, JPG, WEBP, or GIF.");
}

const maxBytes = 5 * 1024 * 1024;
if (logoFile.size > maxBytes) {
throw new Error("Logo must be 5MB or smaller.");
}
}

if (values.imageUrl) {
try {
new URL(values.imageUrl);
} catch {
throw new Error("Existing image URL is invalid.");
}
}
}

function updateWalletUi() {
const walletInput = $("wallet");
const walletPill = $("walletPill");
const connectBtn = $("connectWalletBtn");
const disconnectBtn = $("disconnectWalletBtn");

if (!walletInput || !walletPill || !connectBtn || !disconnectBtn) return;

if (connectedWallet) {
walletInput.value = connectedWallet;
walletPill.textContent = `Connected: ${shortenWallet(connectedWallet)}`;
walletInput.readOnly = true;
connectBtn.style.display = "none";
disconnectBtn.style.display = "inline-flex";
} else {
walletPill.textContent = "No wallet connected";
walletInput.readOnly = false;
connectBtn.style.display = "inline-flex";
disconnectBtn.style.display = "none";
}
}

function renderTeamWalletInputs() {
const container = $("teamWalletInputs");
const count = Number($("teamWalletCount")?.value || 0);

if (!container) return;
container.innerHTML = "";

for (let i = 0; i < count; i++) {
const input = document.createElement("input");
input.type = "text";
input.placeholder = `Team Wallet ${i + 1}`;
input.autocomplete = "off";
input.addEventListener("input", updatePreview);
container.appendChild(input);
}
}

function updatePreview() {
const values = getFormValues();

$("previewName").textContent = values.tokenName || "Untitled Launch";
$("previewSub").textContent = `${values.symbol || "TICK"} • ${normalizeTemplateLabel(values.template)}`;
$("previewMinRaise").textContent = formatSol(values.minRaiseSol);
$("previewHardCap").textContent = formatSol(values.hardCapSol);
$("previewSupply").textContent = formatSupply(values.supply);
$("previewWallet").textContent = values.wallet || "—";
$("previewDesc").textContent =
values.description || "Launch description preview will appear here.";
$("previewBadge").textContent = "Commit";

const file = $("logoInput")?.files?.[0];
const existingUrl = values.imageUrl;
const img = $("logoPreviewImg");
const placeholder = $("logoPreviewPlaceholder");

if (!img || !placeholder) return;

if (file) {
const objectUrl = URL.createObjectURL(file);
img.src = objectUrl;
img.style.display = "block";
placeholder.style.display = "none";
return;
}

if (existingUrl) {
img.src = existingUrl;
img.style.display = "block";
placeholder.style.display = "none";
return;
}

img.removeAttribute("src");
img.style.display = "none";
placeholder.style.display = "grid";
}

function getPhantomProvider() {
if ("phantom" in window && window.phantom?.solana?.isPhantom) {
return window.phantom.solana;
}
if (window.solana?.isPhantom) {
return window.solana;
}
return null;
}

async function connectWallet() {
const provider = getPhantomProvider();

if (!provider) {
setStatus("bad", "Phantom wallet not detected. Install Phantom or use manual wallet input for testing.");
return;
}

try {
const resp = await provider.connect();
connectedWallet = resp?.publicKey?.toString() || null;
updateWalletUi();
updatePreview();
setStatus("good", `Wallet connected: ${shortenWallet(connectedWallet)}`);
} catch (err) {
setStatus("bad", err?.message || "Wallet connection failed.");
}
}

async function disconnectWallet() {
const provider = getPhantomProvider();

try {
if (provider?.disconnect) {
await provider.disconnect();
}
} catch {
// ignore
}

connectedWallet = null;
updateWalletUi();
updatePreview();
setStatus("warn", "Wallet disconnected. Manual wallet entry is available for testing.");
}

async function restoreWalletIfTrusted() {
const provider = getPhantomProvider();
if (!provider) return;

try {
const resp = await provider.connect({ onlyIfTrusted: true });
connectedWallet = resp?.publicKey?.toString() || null;
updateWalletUi();
updatePreview();
} catch {
// ignore
}
}

async function uploadLogo() {
const file = $("logoInput")?.files?.[0];
if (!file) return null;

const formData = new FormData();
formData.append("logo", file);

const apiBase = getApiBase();
const res = await fetch(`${apiBase}/api/upload/launch-logo`, {
method: "POST",
body: formData,
});

let data = null;
try {
data = await res.json();
} catch {
data = null;
}

if (!res.ok || !data?.ok || !data?.url) {
throw new Error(data?.error || "Logo upload failed.");
}

const url = String(data.url);
if (url.startsWith("http://") || url.startsWith("https://")) return url;
return `${apiBase}${url}`;
}

async function createLaunch(payload) {
const apiBase = getApiBase();

const res = await fetch(`${apiBase}/api/launcher/create`, {
method: "POST",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify(payload),
});

let data = null;
try {
data = await res.json();
} catch {
data = null;
}

if (!res.ok || !data?.ok || !data?.launch?.id) {
throw new Error(data?.error || "Launch creation failed.");
}

return data.launch;
}

async function onSubmit(e) {
e.preventDefault();
clearStatus();

const btn = $("createLaunchBtn");

try {
const values = getFormValues();
validateForm(values);

if (btn) {
btn.disabled = true;
btn.textContent = "Creating Launch...";
}

setStatus("warn", "Uploading logo and creating launch...");

let finalImageUrl = values.imageUrl || "";
const uploadedLogoUrl = await uploadLogo();
if (uploadedLogoUrl) {
finalImageUrl = uploadedLogoUrl;
}

const payload = {
wallet: values.wallet,
template: values.template,
token_name: values.tokenName,
symbol: values.symbol,
description: values.description,
image_url: finalImageUrl,
supply: Number(values.supply),
min_raise_sol: Number(values.minRaiseSol),
hard_cap_sol: Number(values.hardCapSol),
team_allocation_pct: values.template === "builder" ? Number(values.teamAllocation) : 0,
team_wallets: values.template === "builder" ? values.teamWallets : [],
builder_bond_sol: values.template === "builder" ? Number(values.builderBond) : 0,
};

const launch = await createLaunch(payload);

setStatus("good", `Launch created successfully. Redirecting to launch #${launch.id}...`);

window.setTimeout(() => {
window.location.href = `./launch.html?id=${encodeURIComponent(launch.id)}`;
}, 500);
} catch (err) {
setStatus("bad", err?.message || "Unable to create launch.");
} finally {
if (btn) {
btn.disabled = false;
btn.textContent = "Create Launch";
}
}
}

function bindPreview() {
const ids = [
"wallet",
"template",
"tokenName",
"symbol",
"description",
"imageUrl",
"logoInput",
"supplyPreset",
"teamWalletCount",
"teamAllocation",
"builderBond",
];

for (const id of ids) {
const el = $(id);
if (!el) continue;
el.addEventListener("input", () => {
if (id === "template" || id === "supplyPreset") {
applyTemplateValues();
}
if (id === "teamWalletCount") {
renderTeamWalletInputs();
}
updatePreview();
});
el.addEventListener("change", () => {
if (id === "template" || id === "supplyPreset") {
applyTemplateValues();
}
if (id === "teamWalletCount") {
renderTeamWalletInputs();
}
updatePreview();
});
}
}

function initSessionUi() {
try {
bindSessionUi({
sessionPillId: "sessionPill",
sessionDotId: "sessionDot",
sessionTextId: "sessionText",
logoutBtnId: "logoutBtn",
loggedOutHref: "./login.html",
loggedInHref: "./index.html#access",
onLogout() {
window.location.reload();
},
});
} catch {
// ignore
}
}

function bindWalletEvents() {
$("connectWalletBtn")?.addEventListener("click", connectWallet);
$("disconnectWalletBtn")?.addEventListener("click", disconnectWallet);

const provider = getPhantomProvider();
if (provider?.on) {
provider.on("accountChanged", (publicKey) => {
connectedWallet = publicKey ? publicKey.toString() : null;
updateWalletUi();
updatePreview();
});

provider.on("disconnect", () => {
connectedWallet = null;
updateWalletUi();
updatePreview();
});
}
}

function init() {
initSessionUi();
applyTemplateValues();
updateWalletUi();
bindPreview();
bindWalletEvents();
renderTeamWalletInputs();
updatePreview();
restoreWalletIfTrusted();

const form = $("launchCreateForm");
if (form) {
form.addEventListener("submit", onSubmit);
}

const symbolInput = $("symbol");
if (symbolInput) {
symbolInput.addEventListener("input", () => {
symbolInput.value = normalizeSymbol(symbolInput.value);
updatePreview();
});
}

$("template")?.addEventListener("change", () => {
applyTemplateValues();
renderTeamWalletInputs();
updatePreview();
});

$("supplyPreset")?.addEventListener("change", () => {
applyTemplateValues();
updatePreview();
});

$("teamWalletCount")?.addEventListener("change", () => {
renderTeamWalletInputs();
updatePreview();
});
}

init();