import { bindSessionUi } from "../auth.js";
import {
connectWallet as connectAnyWallet,
disconnectWallet as disconnectAnyWallet,
getConnectedWallet,
getConnectedPublicKey,
onWalletChange,
restoreWalletIfTrusted,
getMobileWalletHelpText,
} from "../wallet.js";

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

function normalizeWallet(value) {
return String(value || "").trim();
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
if (!w) return "—";
if (w.length <= 12) return w;
return `${w.slice(0, 4)}...${w.slice(-4)}`;
}

function defaultBuilderAlias(wallet) {
const w = String(wallet || "").trim();
if (!w) return "New Builder";
return `Builder ${w.slice(0, 4)}`;
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

let cachedBuilderBond = null;

function getPhantomProvider() {
return window.getPhantomProvider?.() || window.phantom?.solana || window.solana || null;
}

function clearBuilderBondCache() {
cachedBuilderBond = null;
}

function getCachedBuilderBondSignature(values) {
if (!cachedBuilderBond) return "";
if (cachedBuilderBond.wallet !== values.wallet) return "";
if (Number(cachedBuilderBond.builderBond) !== Number(values.builderBond)) return "";
return cachedBuilderBond.txSignature || "";
}

async function fetchJson(path, options = {}) {
const apiBase = getApiBase();
const res = await fetch(`${apiBase}${path}`, options);

let data = null;
try {
data = await res.json();
} catch {
data = null;
}

if (!res.ok || !data?.ok) {
throw new Error(data?.error || `HTTP ${res.status}`);
}

return data;
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
hardCapSol: 200,
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

const TEAM_LABEL_OPTIONS = [
"Team",
"Marketing",
"Treasury",
"Advisors",
"Operations",
"Development",
"Community",
"Custom",
];

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
const builderHighlight = $("builderModeHighlight");

if (builderMode) {
const builderSupply = Number(supplyPreset?.value || tpl.supply);
if (supplyInput) supplyInput.value = String(builderSupply);
if (fixedSupplyField) fixedSupplyField.style.display = "none";
if (builderSupplyField) builderSupplyField.classList.add("show");
if (builderExtras) builderExtras.classList.add("show");
if (builderHighlight) builderHighlight.classList.add("show");
} else {
if (supplyInput) supplyInput.value = String(tpl.supply);
if (fixedSupplyField) fixedSupplyField.style.display = "grid";
if (builderSupplyField) builderSupplyField.classList.remove("show");
if (builderExtras) builderExtras.classList.remove("show");
if (builderHighlight) builderHighlight.classList.remove("show");
}

if ($("minRaiseSol")) $("minRaiseSol").value = String(tpl.minRaiseSol);
if ($("hardCapSol")) $("hardCapSol").value = String(tpl.hardCapSol);

const allocationChip = $("previewAllocationChip");
const templateChip = $("previewTemplateChip");

if (templateChip) {
templateChip.textContent = builderMode ? "Builder Template" : "Template Locked";
}

if (allocationChip) {
allocationChip.textContent = builderMode ? "Reserve Adjusts For Team" : "Fixed Allocation";
}

updateTeamAllocationTotal();
updatePreview();
}

function getWalletValue() {
return getConnectedPublicKey() || "";
}

function getTeamWalletRows() {
return Array.from(document.querySelectorAll(".team-wallet-row"));
}

function getTeamWalletBreakdown() {
return getTeamWalletRows().map((row, index) => {
const labelSelect = row.querySelector(`[data-role="label-select"]`);
const labelCustom = row.querySelector(`[data-role="label-custom"]`);
const walletInput = row.querySelector(`[data-role="wallet"]`);
const allocationInput = row.querySelector(`[data-role="allocation"]`);

const selectedLabel = labelSelect?.value || "";
const label =
selectedLabel === "Custom"
? (labelCustom?.value || "").trim()
: selectedLabel;

return {
index,
label: String(label || "").trim(),
wallet: normalizeWallet(walletInput?.value || ""),
pct: Number(allocationInput?.value || 0),
};
});
}

function getTeamWallets() {
return getTeamWalletBreakdown()
.filter((row) => row.wallet)
.map((row) => row.wallet);
}

function getTeamAllocationTotalValue() {
return getTeamWalletBreakdown().reduce((sum, row) => {
const n = Number(row.pct || 0);
return sum + (Number.isFinite(n) ? n : 0);
}, 0);
}

function updateTeamAllocationTotal() {
const totalEl = $("teamAllocationTotal");
if (!totalEl) return;

const total = getTeamAllocationTotalValue();
const limit = Math.min(Number($("teamAllocation")?.value || 0) || 0, 15);

totalEl.textContent = `${total.toFixed(2)}%`;
totalEl.classList.remove("good", "warn", "bad");

if (total <= 0) {
totalEl.classList.add("good");
return;
}

if (total > 15 || (limit > 0 && total > limit)) {
totalEl.classList.add("bad");
return;
}

if (limit > 0 && total >= limit * 0.85) {
totalEl.classList.add("warn");
return;
}

totalEl.classList.add("good");
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
teamWalletBreakdown: builderMode ? getTeamWalletBreakdown() : [],
teamAllocationTotal: builderMode ? getTeamAllocationTotalValue() : 0,
};
}

function validateForm(values) {
if (!values.wallet) {
throw new Error("Connect your wallet before creating a launch.");
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
throw new Error("Team allocation limit is invalid.");
}

if (values.teamAllocation > 15) {
throw new Error("Team allocation limit cannot exceed 15%.");
}

if (!Number.isFinite(values.teamWalletCount) || values.teamWalletCount < 0 || values.teamWalletCount > 5) {
throw new Error("Team wallet count must be between 0 and 5.");
}

if (values.teamWalletBreakdown.length !== values.teamWalletCount) {
throw new Error("Team wallet rows are not aligned with team wallet count.");
}

const seenWallets = new Set();

for (const row of values.teamWalletBreakdown) {
if (!row.label) {
throw new Error(`Team wallet ${row.index + 1} needs a label.`);
}

if (!row.wallet) {
throw new Error(`Team wallet ${row.index + 1} needs an address.`);
}

if (!Number.isFinite(row.pct) || row.pct <= 0) {
throw new Error(`Team wallet ${row.index + 1} allocation must be greater than 0.`);
}

if (seenWallets.has(row.wallet)) {
throw new Error(`Team wallet ${row.index + 1} duplicates another team wallet.`);
}
seenWallets.add(row.wallet);
}

if (values.teamAllocation === 0 && values.teamWalletCount > 0) {
throw new Error("Set a team allocation limit above 0 if team wallets are being used.");
}

if (values.teamAllocation > 0 && values.teamWalletCount === 0) {
throw new Error("Add at least one team wallet when using team allocation.");
}

if (values.teamAllocationTotal > 15) {
throw new Error("Combined team wallet allocation cannot exceed 15%.");
}

if (values.teamAllocation > 0 && values.teamAllocationTotal > values.teamAllocation) {
throw new Error("Combined team wallet allocation exceeds the team allocation limit.");
}

if (values.teamAllocation > 0 && Math.abs(values.teamAllocationTotal - values.teamAllocation) > 0.000001) {
throw new Error("Combined team wallet allocation must match the team allocation limit exactly.");
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
const walletHint = $("walletHint");

if (!walletInput || !walletPill || !connectBtn || !disconnectBtn) return;

const walletState = getConnectedWallet();

if (walletState.isConnected) {
walletInput.value = walletState.publicKey || "";
walletPill.textContent = `Connected: ${walletState.shortPublicKey}`;
walletInput.readOnly = true;
connectBtn.style.display = "none";
disconnectBtn.style.display = "inline-flex";
if (walletHint) {
walletHint.textContent = `Connected via ${String(walletState.walletName || "wallet").replace(/\b\w/g, (m) => m.toUpperCase())}.`;
}
} else {
walletInput.value = "";
walletPill.textContent = "No wallet connected";
walletInput.readOnly = true;
connectBtn.style.display = "inline-flex";
disconnectBtn.style.display = "none";
if (walletHint) {
walletHint.textContent = "Use Connect Wallet to choose Phantom, Solflare, or Backpack.";
}
}
}

function buildLabelOptionsHtml(selected = "") {
return TEAM_LABEL_OPTIONS.map((option) => {
const isSelected = option === selected ? "selected" : "";
return `<option value="${option}" ${isSelected}>${option}</option>`;
}).join("");
}

function renderTeamWalletInputs() {
const container = $("teamWalletInputs");
const count = Number($("teamWalletCount")?.value || 0);
const existing = getTeamWalletBreakdown();

if (!container) return;
container.innerHTML = "";

for (let i = 0; i < count; i++) {
const prev = existing[i] || { label: "Team", wallet: "", pct: 0 };
const selectedLabel = TEAM_LABEL_OPTIONS.includes(prev.label) ? prev.label : "Custom";
const customLabel = selectedLabel === "Custom" ? prev.label : "";

const row = document.createElement("div");
row.className = "team-wallet-row";
row.innerHTML = `
<div class="field">
<label>Wallet Label</label>
<select data-role="label-select">
${buildLabelOptionsHtml(selectedLabel)}
</select>
<input data-role="label-custom" type="text" placeholder="Custom label" value="${escapeHtmlAttr(customLabel)}" style="${selectedLabel === "Custom" ? "" : "display:none;"}" />
</div>
<div class="field">
<label>Wallet Address</label>
<input data-role="wallet" type="text" placeholder="Team wallet ${i + 1}" value="${escapeHtmlAttr(prev.wallet || "")}" autocomplete="off" />
</div>
<div class="field">
<label>Allocation %</label>
<input data-role="allocation" type="number" min="0" max="15" step="0.1" placeholder="0.0" value="${Number(prev.pct || 0) || ""}" />
</div>
`;

const labelSelect = row.querySelector('[data-role="label-select"]');
const labelCustomInput = row.querySelector('[data-role="label-custom"]');
const walletInput = row.querySelector('[data-role="wallet"]');
const allocationInput = row.querySelector('[data-role="allocation"]');

labelSelect?.addEventListener("change", () => {
const isCustom = labelSelect.value === "Custom";
if (labelCustomInput) {
labelCustomInput.style.display = isCustom ? "" : "none";
}
updatePreview();
updateTeamAllocationTotal();
});

[labelCustomInput, walletInput, allocationInput].forEach((el) => {
el?.addEventListener("input", () => {
updatePreview();
updateTeamAllocationTotal();
});
});

container.appendChild(row);
}

updateTeamAllocationTotal();
updatePreview();
}

function renderPreviewBuilderBlock(values) {
const block = $("previewBuilderBlock");
const allocationEl = $("previewTeamAllocation");
const bondEl = $("previewBuilderBond");
const list = $("previewBuilderList");

if (!block || !allocationEl || !bondEl || !list) return;

if (values.template !== "builder") {
block.classList.remove("show");
list.innerHTML = "";
return;
}

block.classList.add("show");
allocationEl.textContent = `${Number(values.teamAllocation || 0).toFixed(values.teamAllocation % 1 ? 1 : 0)}%`;
bondEl.textContent = formatSol(values.builderBond);

const rows = values.teamWalletBreakdown.filter((row) => row.wallet || row.label || row.pct);

if (!rows.length) {
list.innerHTML = `<div class="preview-builder-row"><span>No visible team wallets set</span><strong>—</strong></div>`;
return;
}

list.innerHTML = rows.map((row, i) => {
const label = row.label || `Wallet ${i + 1}`;
const wallet = row.wallet ? shortenWallet(row.wallet) : "No wallet";
const pct = Number(row.pct || 0).toFixed(row.pct % 1 ? 1 : 0);
return `
<div class="preview-builder-row">
<span>${escapeHtmlText(label)} • ${escapeHtmlText(wallet)}</span>
<strong>${pct}%</strong>
</div>
`;
}).join("");
}

function updatePreview() {
const values = getFormValues();

$("previewName").textContent = values.tokenName || "Untitled Launch";
$("previewSub").textContent = `${values.symbol || "TICK"} • ${normalizeTemplateLabel(values.template)}`;
$("previewMinRaise").textContent = formatSol(values.minRaiseSol);
$("previewHardCap").textContent = formatSol(values.hardCapSol);
$("previewSupply").textContent = formatSupply(values.supply);
$("previewWallet").textContent = values.wallet ? shortenWallet(values.wallet) : "—";
$("previewDesc").textContent =
values.description || "Launch description preview will appear here.";
$("previewBadge").textContent = "Commit";

const flowChip = $("previewFlowChip");
const templateChip = $("previewTemplateChip");
const allocationChip = $("previewAllocationChip");

if (flowChip) {
flowChip.textContent = "Commit → Countdown → Live";
}

if (templateChip) {
templateChip.textContent = values.template === "builder" ? "Builder Template" : "Template Locked";
}

if (allocationChip) {
allocationChip.textContent = values.template === "builder" ? "Reserve Adjusts For Team" : "Fixed Allocation";
}

renderPreviewBuilderBlock(values);

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

async function connectWallet() {
try {
const wallet = await connectAnyWallet();
updateWalletUi();
updatePreview();

if (wallet?.isConnected) {
setStatus("good", `Wallet connected: ${shortenWallet(wallet.publicKey)}`);
return;
}

setStatus("warn", "Wallet connection cancelled.");
} catch (err) {
const msg = err?.message || "Wallet connection failed.";
setStatus("bad", msg.includes("No supported wallet") ? getMobileWalletHelpText() : msg);
}
}

async function disconnectWallet() {
try {
await disconnectAnyWallet();
} catch {
// ignore
}

clearBuilderBondCache();
updateWalletUi();
updatePreview();
setStatus("warn", "Wallet disconnected.");
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

async function getBuilderByWallet(wallet) {
try {
const data = await fetchJson(`/api/builders/${encodeURIComponent(wallet)}`);
return data.builder || null;
} catch (err) {
if (String(err?.message || "").includes("HTTP 404")) {
return null;
}
throw err;
}
}

async function createBuilderProfile(wallet) {
const alias = defaultBuilderAlias(wallet);

const data = await fetchJson(`/api/builders/create`, {
method: "POST",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify({
wallet,
alias,
}),
});

return data.builder;
}

async function ensureBuilderProfile(wallet) {
const existing = await getBuilderByWallet(wallet);
if (existing) return existing;

setStatus("warn", "No builder profile found. Creating one automatically...");
return createBuilderProfile(wallet);
}

async function createLaunch(payload) {
const data = await fetchJson(`/api/launcher/create`, {
method: "POST",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify(payload),
});

return data.launch;
}

async function collectBuilderBond(values) {
if (values.template !== "builder" || Number(values.builderBond) <= 0) {
return "";
}

const cachedSignature = getCachedBuilderBondSignature(values);
if (cachedSignature) {
return cachedSignature;
}

const provider = getPhantomProvider();
if (!provider?.signTransaction) {
throw new Error("Wallet signing is not available for builder bond.");
}

if (!window.solanaWeb3?.Transaction?.from) {
throw new Error("solanaWeb3 is not available on this page.");
}

setStatus("warn", "Preparing builder bond approval...");

const prepare = await fetchJson(`/api/launcher/prepare-builder-bond`, {
method: "POST",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify({
wallet: values.wallet,
builderBondSol: Number(values.builderBond),
}),
});

const transactionBase64 =
prepare.transaction ||
prepare.serializedTransaction ||
prepare.tx ||
"";

if (!transactionBase64) {
throw new Error("Prepared builder bond transaction was not returned by the server.");
}

const txBytes = Uint8Array.from(atob(transactionBase64), (c) => c.charCodeAt(0));
const transaction = window.solanaWeb3.Transaction.from(txBytes);

setStatus("warn", "Awaiting builder bond wallet approval...");
const signedTransaction = await provider.signTransaction(transaction);

const signedBase64 = btoa(
String.fromCharCode(...signedTransaction.serialize())
);

setStatus("warn", "Confirming builder bond...");
const confirm = await fetchJson(`/api/launcher/confirm-builder-bond`, {
method: "POST",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify({
wallet: values.wallet,
builderBondSol: Number(values.builderBond),
signedTransaction: signedBase64,
}),
});

cachedBuilderBond = {
wallet: values.wallet,
builderBond: Number(values.builderBond),
txSignature: confirm.txSignature,
};

return confirm.txSignature;
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

setStatus("warn", "Preparing builder profile...");
await ensureBuilderProfile(values.wallet);

let builderBondTxSignature = "";

if (values.template === "builder" && Number(values.builderBond) > 0) {
builderBondTxSignature = await collectBuilderBond(values);
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
team_wallet_breakdown: values.template === "builder" ? values.teamWalletBreakdown : [],
builder_bond_sol: values.template === "builder" ? Number(values.builderBond) : 0,
builder_bond_tx_signature: builderBondTxSignature,
};

const launch = await createLaunch(payload);

const builderBondNotice =
values.template === "builder" && Number(values.builderBond) > 0
? ` Builder bond confirmed: ${values.builderBond} SOL.`
: "";

setStatus("good", `Launch created successfully. Redirecting to launch #${launch.id}...${builderBondNotice}`);

window.setTimeout(() => {
window.location.href = `./launch.html?id=${encodeURIComponent(launch.id)}`;
}, 700);
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
updateTeamAllocationTotal();
});

el.addEventListener("change", () => {
if (id === "template" || id === "supplyPreset") {
applyTemplateValues();
}
if (id === "teamWalletCount") {
renderTeamWalletInputs();
}
updatePreview();
updateTeamAllocationTotal();
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

onWalletChange(() => {
clearBuilderBondCache();
updateWalletUi();
updatePreview();
});
}

function escapeHtmlAttr(str) {
return String(str ?? "")
.replaceAll("&", "&amp;")
.replaceAll('"', "&quot;")
.replaceAll("<", "&lt;")
.replaceAll(">", "&gt;");
}

function escapeHtmlText(str) {
return String(str ?? "")
.replaceAll("&", "&amp;")
.replaceAll("<", "&lt;")
.replaceAll(">", "&gt;");
}

async function init() {
initSessionUi();
applyTemplateValues();
updateWalletUi();
bindPreview();
bindWalletEvents();
renderTeamWalletInputs();
updatePreview();
updateTeamAllocationTotal();
await restoreWalletIfTrusted();
updateWalletUi();
updatePreview();

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
clearBuilderBondCache();
applyTemplateValues();
renderTeamWalletInputs();
updatePreview();
updateTeamAllocationTotal();
});

$("supplyPreset")?.addEventListener("change", () => {
applyTemplateValues();
updatePreview();
});

$("teamWalletCount")?.addEventListener("change", () => {
renderTeamWalletInputs();
updatePreview();
updateTeamAllocationTotal();
});

$("teamAllocation")?.addEventListener("input", () => {
updateTeamAllocationTotal();
updatePreview();
});

$("builderBond")?.addEventListener("input", () => {
clearBuilderBondCache();
updatePreview();
});
}

init();