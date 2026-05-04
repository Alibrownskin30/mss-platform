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

if (
hostname === "devnet.mssprotocol.com" ||
hostname === "www.devnet.mssprotocol.com"
) {
return "https://api.devnet.mssprotocol.com";
}

if (port === "3000") {
return `${protocol}//${hostname}:8787`;
}

if (hostname.includes("-3000.app.github.dev")) {
return `${protocol}//${hostname.replace(
"-3000.app.github.dev",
"-8787.app.github.dev"
)}`;
}

return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
}

function sleep(ms) {
return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function toNumber(value, fallback = 0) {
if (value === null || value === undefined || value === "") return fallback;
const num = Number(value);
return Number.isFinite(num) ? num : fallback;
}

function normalizeSymbol(value) {
return String(value || "")
.toUpperCase()
.replace(/[^A-Z0-9]/g, "")
.slice(0, 12);
}

function normalizeTemplateLabel(value) {
return String(value || "")
.replaceAll("_", " ")
.replace(/\b\w/g, (m) => m.toUpperCase());
}

function normalizeWallet(value) {
return String(value || "").trim();
}

function normalizeBuilderAlias(value, fallback = "") {
return String(value || fallback || "").trim().slice(0, 60);
}

function formatSupply(value) {
const num = Number(value);
if (!Number.isFinite(num) || num <= 0) return "—";
return num.toLocaleString("en-AU");
}

function formatSol(value, maxDecimals = 2) {
const num = Number(value);
if (!Number.isFinite(num) || num < 0) return "— SOL";

return `${num.toLocaleString("en-AU", {
minimumFractionDigits: 0,
maximumFractionDigits: maxDecimals,
})} SOL`;
}

function formatUsd(value, maxDecimals = 2) {
const num = Number(value);
if (!Number.isFinite(num) || num < 0) return "$0";

return num.toLocaleString("en-AU", {
style: "currency",
currency: "USD",
minimumFractionDigits: 0,
maximumFractionDigits: maxDecimals,
});
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
return `Builder ${w.slice(0, 4)}${w.slice(-4)}`;
}

function getBuilderAliasCandidates(wallet, preferredAlias = "") {
const w = String(wallet || "").trim();
const cleanedPreferred = normalizeBuilderAlias(preferredAlias);

if (!w) return cleanedPreferred ? [cleanedPreferred] : ["New Builder"];

const first4 = w.slice(0, 4);
const last4 = w.slice(-4);
const first6 = w.slice(0, 6);

return Array.from(
new Set(
[
cleanedPreferred,
`Builder ${first4}${last4}`,
`Builder ${first4}-${last4}`,
`Builder ${first6}`,
defaultBuilderAlias(wallet),
]
.map((value) => String(value || "").trim().slice(0, 60))
.filter(Boolean)
)
);
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

function isBuilderNotFoundMessage(message) {
const text = String(message || "").toLowerCase();
return (
text.includes("builder not found") ||
text.includes("builder profile not found")
);
}

function getLaunchBondLabel() {
return "Builder Bond";
}

function getInjectedWalletProvider() {
const walletState = getConnectedWallet?.() || {};

const candidates = [
walletState?.provider,
walletState?.wallet,
walletState?.adapter,
window.getPhantomProvider?.(),
window.phantom?.solana,
window.backpack?.solana,
window.solflare,
window.solana,
];

return (
candidates.find(
(provider) => provider && typeof provider.signTransaction === "function"
) || null
);
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

if (
typeKey === "x_url" &&
!(host.includes("x.com") || host.includes("twitter.com"))
) {
return "";
}

if (
typeKey === "telegram_url" &&
!(host.includes("t.me") || host.includes("telegram.me"))
) {
return "";
}

if (
typeKey === "discord_url" &&
!(host.includes("discord.gg") || host.includes("discord.com"))
) {
return "";
}

return url.toString();
} catch {
return "";
}
}

const SOL_QUOTE_REFRESH_MS = 20000;
const BUILDER_ALLOWED_HARD_CAPS = [250, 500, 750, 1000];
const BUILDER_SOFT_CAP_BY_HARD_CAP = {
250: 200,
500: 300,
750: 400,
1000: 500,
};
const DEFAULT_BUILDER_HARD_CAP_SOL = 250;
const MIN_LAUNCH_BOND_SOL = 3;
const MAX_LAUNCH_BOND_SOL = 25;

const TEMPLATE_CONFIG = {
degen_zone: {
supply: 1000000000,
minRaiseSol: 55,
hardCapSol: 75,
},
meme_lite: {
supply: 1000000000,
minRaiseSol: 60,
hardCapSol: 100,
},
meme_pro: {
supply: 1000000000,
minRaiseSol: 75,
hardCapSol: 200,
},
community: {
supply: 1000000000,
minRaiseSol: 75,
hardCapSol: 200,
},
builder: {
supply: 1000000000,
minRaiseSol: BUILDER_SOFT_CAP_BY_HARD_CAP[DEFAULT_BUILDER_HARD_CAP_SOL],
hardCapSol: DEFAULT_BUILDER_HARD_CAP_SOL,
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

const VISIBILITY_ADDONS = [
{
key: "coming_soon_spotlight",
label: "Coming Soon Spotlight",
usd: 99,
checkboxId: "addOnComingSoon",
cardId: "addOnCardComingSoon",
priceId: "addOnComingSoonPrice",
},
{
key: "commit_opens_spotlight",
label: "Commit Opens Spotlight",
usd: 149,
checkboxId: "addOnCommitOpens",
cardId: "addOnCardCommitOpens",
priceId: "addOnCommitOpensPrice",
},
{
key: "priority_placement",
label: "Priority Placement",
usd: 249,
checkboxId: "addOnPriorityPlacement",
cardId: "addOnCardPriorityPlacement",
priceId: "addOnPriorityPlacementPrice",
},
{
key: "community_distribution",
label: "Community Distribution",
usd: 129,
checkboxId: "addOnCommunityDistribution",
cardId: "addOnCardCommunityDistribution",
priceId: "addOnCommunityDistributionPrice",
},
];

let cachedBuilderBond = null;
let currentLogoPreviewObjectUrl = "";
let quoteRefreshIntervalId = null;
let pricingState = {
solUsd: null,
fetchedAt: 0,
isLoading: false,
};
let builderComplianceState = {
wallet: "",
payload: null,
};

function clearBuilderBondCache() {
cachedBuilderBond = null;
}

function getBuilderBondCacheKey(values) {
return JSON.stringify({
wallet: values.wallet || "",
template: values.template || "",
tokenName: values.tokenName || "",
symbol: values.symbol || "",
supply: Number(values.supply || 0),
minRaiseSol: Number(values.minRaiseSol || 0),
hardCapSol: Number(values.hardCapSol || 0),
builderBond: Number(values.builderBond || 0),
teamAllocation: Number(values.teamAllocation || 0),
teamWalletCount: Number(values.teamWalletCount || 0),
teamWallets: Array.isArray(values.teamWallets) ? values.teamWallets : [],
teamWalletBreakdown: Array.isArray(values.teamWalletBreakdown)
? values.teamWalletBreakdown
: [],
});
}

function getCachedBuilderBondSignature(values) {
if (!cachedBuilderBond) return "";
if (cachedBuilderBond.key !== getBuilderBondCacheKey(values)) return "";
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

function normalizeBuilderHardCap(raw) {
const parsed = Number(raw);
if (BUILDER_ALLOWED_HARD_CAPS.includes(parsed)) {
return parsed;
}
return DEFAULT_BUILDER_HARD_CAP_SOL;
}

function normalizeBuilderMinRaise(_raw, hardCap) {
const normalizedHardCap = normalizeBuilderHardCap(hardCap);
return (
BUILDER_SOFT_CAP_BY_HARD_CAP[normalizedHardCap] ||
BUILDER_SOFT_CAP_BY_HARD_CAP[DEFAULT_BUILDER_HARD_CAP_SOL]
);
}

function getRequiredLaunchBondSol({ minRaiseSol }) {
const softCap = Number(minRaiseSol);
if (!Number.isFinite(softCap) || softCap <= 0) {
return MIN_LAUNCH_BOND_SOL;
}

return Math.min(
MAX_LAUNCH_BOND_SOL,
Math.max(MIN_LAUNCH_BOND_SOL, Math.ceil(softCap * 0.05))
);
}

function updateBuilderResolvedInputs() {
const builderHardCapInput = $("builderHardCapSol");
const builderMinRaiseInput = $("builderMinRaiseSol");

if (!builderHardCapInput || !builderMinRaiseInput) {
const fallbackHardCap = DEFAULT_BUILDER_HARD_CAP_SOL;
return {
hardCapSol: fallbackHardCap,
minRaiseSol: BUILDER_SOFT_CAP_BY_HARD_CAP[fallbackHardCap],
};
}

const hardCapSol = normalizeBuilderHardCap(builderHardCapInput.value);
builderHardCapInput.value = String(hardCapSol);

const minRaiseSol = normalizeBuilderMinRaise(
builderMinRaiseInput.value,
hardCapSol
);
builderMinRaiseInput.min = String(minRaiseSol);
builderMinRaiseInput.max = String(minRaiseSol);
builderMinRaiseInput.value = String(minRaiseSol);
builderMinRaiseInput.readOnly = true;

return {
hardCapSol,
minRaiseSol,
};
}

function syncLaunchBondField(values) {
const builderBondInput = $("builderBond");
if (!builderBondInput) return;

builderBondInput.value = String(values.builderBond);
builderBondInput.min = String(values.builderBond);
builderBondInput.max = String(values.builderBond);
builderBondInput.readOnly = true;
}

function getSelectedTemplate() {
const key = $("template")?.value || "meme_lite";
const base = TEMPLATE_CONFIG[key] || TEMPLATE_CONFIG.meme_lite;

if (key !== "builder") {
const templateValues = {
key,
...base,
};

return {
...templateValues,
builderBond: getRequiredLaunchBondSol(templateValues),
};
}

const resolvedBuilder = updateBuilderResolvedInputs();

const templateValues = {
key,
...base,
hardCapSol: resolvedBuilder.hardCapSol,
minRaiseSol: resolvedBuilder.minRaiseSol,
};

return {
...templateValues,
builderBond: getRequiredLaunchBondSol(templateValues),
};
}

function getTeamWalletRows() {
return Array.from(document.querySelectorAll(".team-wallet-row"));
}

function getTeamWalletBreakdown() {
return getTeamWalletRows().map((row, index) => {
const labelSelect = row.querySelector('[data-role="label-select"]');
const labelCustom = row.querySelector('[data-role="label-custom"]');
const walletInput = row.querySelector('[data-role="wallet"]');
const allocationInput = row.querySelector('[data-role="allocation"]');

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

function getSelectedVisibilityAddons() {
return VISIBILITY_ADDONS.filter((addon) => $(addon.checkboxId)?.checked).map(
(addon) => ({ ...addon })
);
}

function maybeSeedBuilderAlias() {
const input = $("builderAlias");
if (!input) return;

const wallet = getConnectedPublicKey() || "";
const current = String(input.value || "").trim();
const userEdited = input.dataset.userEdited === "1";

if (!wallet) {
if (!userEdited && !current) {
input.value = "";
}
return;
}

if (!current || (!userEdited && current === defaultBuilderAlias(wallet))) {
input.value = defaultBuilderAlias(wallet);
input.dataset.userEdited = "0";
}
}

function getFormValues() {
const tpl = getSelectedTemplate();
const builderMode = tpl.key === "builder";
const wallet = getConnectedPublicKey() || "";
const supplyValue = builderMode
? Number($("supplyPreset")?.value || tpl.supply)
: tpl.supply;

const teamWalletBreakdown = builderMode ? getTeamWalletBreakdown() : [];
const teamWallets = builderMode ? getTeamWallets() : [];
const teamAllocationTotal = builderMode ? getTeamAllocationTotalValue() : 0;
const visibilityAddons = getSelectedVisibilityAddons().map((addon) => {
const solEstimate =
pricingState.solUsd && pricingState.solUsd > 0
? addon.usd / pricingState.solUsd
: 0;

return {
key: addon.key,
label: addon.label,
usd: addon.usd,
sol_estimate: solEstimate,
};
});

return {
wallet,
template: tpl.key,
tokenName: $("tokenName")?.value.trim() || "",
symbol: normalizeSymbol($("symbol")?.value || ""),
builderAlias: normalizeBuilderAlias(
$("builderAlias")?.value || "",
defaultBuilderAlias(wallet)
),
description: $("description")?.value.trim() || "",
imageUrl: $("imageUrl")?.value.trim() || "",
websiteUrl: $("websiteUrl")?.value.trim() || "",
xUrl: $("xUrl")?.value.trim() || "",
telegramUrl: $("telegramUrl")?.value.trim() || "",
discordUrl: $("discordUrl")?.value.trim() || "",
supply: supplyValue,
minRaiseSol: tpl.minRaiseSol,
hardCapSol: tpl.hardCapSol,
builderBond: tpl.builderBond,
teamWalletCount: builderMode ? Number($("teamWalletCount")?.value || 0) : 0,
teamAllocation: builderMode ? Number($("teamAllocation")?.value || 0) : 0,
teamWallets,
teamWalletBreakdown,
teamAllocationTotal,
visibilityAddons,
acknowledgements: {
bondRequired: Boolean($("ackBondRequired")?.checked),
visibilityImmediate: Boolean($("ackVisibilityImmediate")?.checked),
launchFeeLive: Boolean($("ackLaunchFeeLive")?.checked),
},
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

if (!values.builderAlias) {
throw new Error("Builder alias is required.");
}

if (!values.description) {
throw new Error("Description is required.");
}

if (!Number.isFinite(Number(values.supply)) || Number(values.supply) <= 0) {
throw new Error("Template supply is invalid.");
}

if (
!Number.isFinite(Number(values.minRaiseSol)) ||
Number(values.minRaiseSol) <= 0
) {
throw new Error("Template minimum raise is invalid.");
}

if (
!Number.isFinite(Number(values.hardCapSol)) ||
Number(values.hardCapSol) <= 0
) {
throw new Error("Template hard cap is invalid.");
}

if (Number(values.minRaiseSol) >= Number(values.hardCapSol)) {
throw new Error(
"Template configuration is invalid: minimum raise must stay below hard cap."
);
}

const normalizedWebsiteUrl = values.websiteUrl
? normalizeUrl(values.websiteUrl, "website_url")
: "";
const normalizedXUrl = values.xUrl ? normalizeUrl(values.xUrl, "x_url") : "";
const normalizedTelegramUrl = values.telegramUrl
? normalizeUrl(values.telegramUrl, "telegram_url")
: "";
const normalizedDiscordUrl = values.discordUrl
? normalizeUrl(values.discordUrl, "discord_url")
: "";

if (values.websiteUrl && !normalizedWebsiteUrl) {
throw new Error("Website URL is invalid.");
}

if (values.xUrl && !normalizedXUrl) {
throw new Error("X URL is invalid.");
}

if (values.telegramUrl && !normalizedTelegramUrl) {
throw new Error("Telegram URL is invalid.");
}

if (values.discordUrl && !normalizedDiscordUrl) {
throw new Error("Discord URL is invalid.");
}

if (values.template === "builder") {
if (!BUILDER_ALLOWED_HARD_CAPS.includes(Number(values.hardCapSol))) {
throw new Error(
`Builder hard cap must be one of ${BUILDER_ALLOWED_HARD_CAPS.join(
", "
)} SOL.`
);
}

const expectedBuilderSoftCap =
BUILDER_SOFT_CAP_BY_HARD_CAP[Number(values.hardCapSol)] || 0;

if (Number(values.minRaiseSol) !== expectedBuilderSoftCap) {
throw new Error(
`Builder minimum raise must match the locked soft cap for ${values.hardCapSol} SOL.`
);
}

if (!Number.isFinite(values.teamAllocation) || values.teamAllocation < 0) {
throw new Error("Team allocation limit is invalid.");
}

if (values.teamAllocation > 15) {
throw new Error("Team allocation limit cannot exceed 15%.");
}

if (
!Number.isFinite(values.teamWalletCount) ||
values.teamWalletCount < 0 ||
values.teamWalletCount > 5
) {
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
throw new Error(
`Team wallet ${row.index + 1} allocation must be greater than 0.`
);
}

if (seenWallets.has(row.wallet)) {
throw new Error(
`Team wallet ${row.index + 1} duplicates another team wallet.`
);
}
seenWallets.add(row.wallet);
}

if (values.teamAllocation === 0 && values.teamWalletCount > 0) {
throw new Error(
"Set a team allocation limit above 0 if team wallets are being used."
);
}

if (values.teamAllocation > 0 && values.teamWalletCount === 0) {
throw new Error("Add at least one team wallet when using team allocation.");
}

if (values.teamAllocationTotal > 15) {
throw new Error("Combined team wallet allocation cannot exceed 15%.");
}

if (
values.teamAllocation > 0 &&
values.teamAllocationTotal > values.teamAllocation
) {
throw new Error(
"Combined team wallet allocation exceeds the team allocation limit."
);
}

if (
values.teamAllocation > 0 &&
Math.abs(values.teamAllocationTotal - values.teamAllocation) > 0.000001
) {
throw new Error(
"Combined team wallet allocation must match the team allocation limit exactly."
);
}
}

const expectedLaunchBond = getRequiredLaunchBondSol(values);
if (
!Number.isFinite(values.builderBond) ||
Number(values.builderBond) !== expectedLaunchBond
) {
throw new Error(
`${getLaunchBondLabel()} must be exactly ${expectedLaunchBond} SOL for this template.`
);
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

if (!values.acknowledgements.bondRequired) {
throw new Error("Confirm the Builder Bond acknowledgement before continuing.");
}

if (!values.acknowledgements.visibilityImmediate) {
throw new Error(
"Confirm the Launch Visibility acknowledgement before continuing."
);
}

if (!values.acknowledgements.launchFeeLive) {
throw new Error("Confirm the MSS Launch Fee acknowledgement before continuing.");
}
}

function buildCompliancePageUrl(wallet = "") {
const params = new URLSearchParams();
params.set("mode", "builder");
if (wallet) {
params.set("wallet", wallet);
}
return `./compliance.html?${params.toString()}`;
}

function getBuilderCompliancePayload() {
return builderComplianceState?.payload || null;
}

function isBuilderComplianceApproved(payload = null) {
const statusPayload = payload || getBuilderCompliancePayload();
if (!statusPayload) return false;

const builderGateEnabled = Boolean(
statusPayload.builder_gate_enabled || statusPayload.requires_builder_approval
);

if (!builderGateEnabled) {
return true;
}

if (statusPayload.restricted_jurisdiction) {
return false;
}

if (statusPayload.profile?.manual_review_required) {
return false;
}

return String(statusPayload.status || "").toLowerCase() === "approved";
}

function getBuilderComplianceMessage(payload = null) {
const statusPayload = payload || getBuilderCompliancePayload();
if (!statusPayload) {
return "Builder verification is required before launch creation.";
}

const builderGateEnabled = Boolean(
statusPayload.builder_gate_enabled || statusPayload.requires_builder_approval
);

if (!builderGateEnabled) {
return "Builder verification gate is currently disabled.";
}

if (statusPayload.restricted_jurisdiction) {
return "Builder access is restricted for the current jurisdiction.";
}

if (statusPayload.profile?.manual_review_required) {
return (
statusPayload.profile?.manual_review_reason ||
"Builder profile is in manual review."
);
}

const status = String(statusPayload.status || "").toLowerCase();

if (status === "approved") {
return "Builder profile approved. Launch creation is enabled.";
}

if (status === "pending") {
return "Builder verification is pending review before launch creation can proceed.";
}

if (status === "rejected") {
return "Builder verification was rejected. Review the compliance profile before trying again.";
}

if (status === "restricted") {
return "Builder profile is currently restricted from launch creation.";
}

return "Complete builder verification before creating a launch.";
}

function renderBuilderComplianceUi(payload = null) {
const card = $("builderComplianceCard");
const pill = $("builderCompliancePill");
const copy = $("builderComplianceCopy");
const action = $("builderComplianceAction");
const meta = $("builderComplianceMeta");
const actionLink = buildCompliancePageUrl(getConnectedPublicKey() || "");

const builderGateEnabled = Boolean(
payload?.builder_gate_enabled || payload?.requires_builder_approval
);

const approved = isBuilderComplianceApproved(payload);
const message = getBuilderComplianceMessage(payload);

const status = String(payload?.status || "").toLowerCase();
let pillText = "Builder Verification";
let pillClass = "warn";

if (!builderGateEnabled) {
pillText = "Verification Optional";
pillClass = "good";
} else if (approved) {
pillText = "Approved";
pillClass = "good";
} else if (status === "pending") {
pillText = "Pending Review";
pillClass = "warn";
} else if (status === "rejected" || status === "restricted") {
pillText = status === "restricted" ? "Restricted" : "Rejected";
pillClass = "bad";
} else {
pillText = "Verification Required";
pillClass = "warn";
}

if (card) {
card.classList.toggle("show", Boolean(payload) || builderGateEnabled);
}

if (pill) {
pill.className = `status-pill ${pillClass}`;
pill.textContent = pillText;
}

if (copy) {
copy.textContent = message;
}

if (meta) {
const country = String(payload?.profile?.country_code || "").toUpperCase();
const risk = String(payload?.profile?.risk_rating || "low");
const detailParts = [];

if (country) detailParts.push(`Country: ${country}`);
if (risk) detailParts.push(`Risk: ${risk}`);
if (builderGateEnabled) {
detailParts.push(`Access: ${approved ? "Allowed" : "Blocked"}`);
} else {
detailParts.push("Access: Open");
}

meta.textContent = detailParts.join(" • ");
}

if (action) {
if (!builderGateEnabled) {
action.style.display = "none";
} else {
action.style.display = "";
action.href = actionLink;
action.textContent = approved
? "Review Compliance Profile"
: "Complete Builder Verification";
}
}
}

async function fetchBuilderComplianceStatus(wallet, { silent = false } = {}) {
const normalizedWallet = normalizeWallet(wallet);
if (!normalizedWallet) {
builderComplianceState = {
wallet: "",
payload: null,
};
renderBuilderComplianceUi(null);
return null;
}

const data = await fetchJson(
`/api/compliance/status?wallet=${encodeURIComponent(
normalizedWallet
)}&mode=builder`
);

builderComplianceState = {
wallet: normalizedWallet,
payload: data,
};

renderBuilderComplianceUi(data);

if (!silent) {
if (isBuilderComplianceApproved(data)) {
setStatus("good", getBuilderComplianceMessage(data));
} else if (data?.builder_gate_enabled || data?.requires_builder_approval) {
setStatus("warn", getBuilderComplianceMessage(data));
}
}

return data;
}

async function refreshBuilderComplianceStatus({ silent = false } = {}) {
const wallet = getConnectedPublicKey() || "";
if (!wallet) {
builderComplianceState = {
wallet: "",
payload: null,
};
renderBuilderComplianceUi(null);
return null;
}

try {
return await fetchBuilderComplianceStatus(wallet, { silent });
} catch (err) {
renderBuilderComplianceUi(null);

if (!silent) {
setStatus(
"bad",
err?.message || "Unable to load builder compliance status."
);
}

throw err;
}
}

async function requireApprovedBuilderCompliance(wallet, { redirect = false } = {}) {
const payload =
builderComplianceState.wallet === wallet && builderComplianceState.payload
? builderComplianceState.payload
: await fetchBuilderComplianceStatus(wallet, { silent: true });

if (isBuilderComplianceApproved(payload)) {
return payload;
}

const message = getBuilderComplianceMessage(payload);
setStatus("warn", `${message} Open the compliance page to continue.`);

if (redirect) {
window.location.href = buildCompliancePageUrl(wallet);
}

throw new Error(message);
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
walletHint.textContent = `Connected via ${String(
walletState.walletName || "wallet"
).replace(/\b\w/g, (m) => m.toUpperCase())}.`;
}
} else {
walletInput.value = "";
walletPill.textContent = "No wallet connected";
walletInput.readOnly = true;
connectBtn.style.display = "inline-flex";
disconnectBtn.style.display = "none";
if (walletHint) {
walletHint.textContent =
"Use Connect Wallet to choose Phantom, Solflare, or Backpack.";
}
}

maybeSeedBuilderAlias();
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
const selectedLabel = TEAM_LABEL_OPTIONS.includes(prev.label)
? prev.label
: "Custom";
const customLabel = selectedLabel === "Custom" ? prev.label : "";

const row = document.createElement("div");
row.className = "team-wallet-row";
row.innerHTML = `
<div class="field">
<label>Wallet Label</label>
<select data-role="label-select">
${buildLabelOptionsHtml(selectedLabel)}
</select>
<input data-role="label-custom" type="text" placeholder="Custom label" value="${escapeHtmlAttr(
customLabel
)}" style="${selectedLabel === "Custom" ? "" : "display:none;"}" />
</div>
<div class="field">
<label>Wallet Address</label>
<input data-role="wallet" type="text" placeholder="Team wallet ${
i + 1
}" value="${escapeHtmlAttr(prev.wallet || "")}" autocomplete="off" />
</div>
<div class="field">
<label>Allocation %</label>
<input data-role="allocation" type="number" min="0" max="15" step="0.1" placeholder="0.0" value="${
Number(prev.pct || 0) || ""
}" />
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
clearBuilderBondCache();
updatePreview();
updateTeamAllocationTotal();
});

[labelCustomInput, walletInput, allocationInput].forEach((el) => {
el?.addEventListener("input", () => {
clearBuilderBondCache();
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
allocationEl.textContent = `${Number(values.teamAllocation || 0).toFixed(
values.teamAllocation % 1 ? 1 : 0
)}%`;
bondEl.textContent = formatSol(values.builderBond);

const rows = values.teamWalletBreakdown.filter(
(row) => row.wallet || row.label || row.pct
);

if (!rows.length) {
list.innerHTML = `<div class="preview-builder-row"><span>No visible team wallets set</span><strong>—</strong></div>`;
return;
}

list.innerHTML = rows
.map((row, i) => {
const label = row.label || `Wallet ${i + 1}`;
const wallet = row.wallet ? shortenWallet(row.wallet) : "No wallet";
const pct = Number(row.pct || 0).toFixed(row.pct % 1 ? 1 : 0);
return `
<div class="preview-builder-row">
<span>${escapeHtmlText(label)} • ${escapeHtmlText(wallet)}</span>
<strong>${pct}%</strong>
</div>
`;
})
.join("");
}

function clearLogoPreviewObjectUrl() {
if (currentLogoPreviewObjectUrl) {
URL.revokeObjectURL(currentLogoPreviewObjectUrl);
currentLogoPreviewObjectUrl = "";
}
}

function updateTemplateSelectionCards(templateKey) {
document.querySelectorAll("[data-template-card]").forEach((card) => {
card.classList.toggle(
"active",
card.getAttribute("data-template-card") === templateKey
);
});
}

function updateVisibilitySelectionCards() {
VISIBILITY_ADDONS.forEach((addon) => {
const card = $(addon.cardId);
const checkbox = $(addon.checkboxId);
if (!card || !checkbox) return;
card.classList.toggle("is-selected", Boolean(checkbox.checked));
});
}

function getSolEquivalentText(usdValue) {
const solUsd = toNumber(pricingState.solUsd, 0);
if (solUsd <= 0) return "— SOL";
return formatSol(usdValue / solUsd, 3);
}

function updateAddonPriceLabels() {
VISIBILITY_ADDONS.forEach((addon) => {
const priceEl = $(addon.priceId);
if (!priceEl) return;
priceEl.textContent = `${formatUsd(addon.usd, 0)} • ${getSolEquivalentText(
addon.usd
)}`;
});
}

function renderCheckoutSummary(values) {
const bondPrimary = $("checkoutBondPrimary");
const bondSecondary = $("checkoutBondSecondary");
const visibilityTotalPrimary = $("checkoutVisibilityTotalPrimary");
const visibilityTotalSecondary = $("checkoutVisibilityTotalSecondary");
const visibilityItems = $("checkoutVisibilityItems");
const dueNowPrimary = $("checkoutDueNowPrimary");
const dueNowSecondary = $("checkoutDueNowSecondary");
const launchFeePrimary = $("checkoutLaunchFeePrimary");
const launchFeeSecondary = $("checkoutLaunchFeeSecondary");
const dueIfLivePrimary = $("checkoutDueIfLivePrimary");
const dueIfLiveSecondary = $("checkoutDueIfLiveSecondary");
const launchName = $("checkoutLaunchName");
const launchSub = $("checkoutLaunchSub");
const bondBadge = $("checkoutBuilderBondBadge");
const quoteNote = $("checkoutQuoteRefreshNote");

const visibilityAddons = values.visibilityAddons || [];
const visibilityTotalUsd = visibilityAddons.reduce(
(sum, addon) => sum + toNumber(addon.usd, 0),
0
);
const solUsd = toNumber(pricingState.solUsd, 0);
const bondUsdEstimate = solUsd > 0 ? values.builderBond * solUsd : 0;
const visibilitySolEstimate = solUsd > 0 ? visibilityTotalUsd / solUsd : 0;
const dueNowUsdEstimate = solUsd > 0 ? bondUsdEstimate + visibilityTotalUsd : 0;
const dueNowSolEstimate = values.builderBond + visibilitySolEstimate;
const maxLaunchFeeSol = toNumber(values.hardCapSol, 0) * 0.03;
const maxLaunchFeeUsd = solUsd > 0 ? maxLaunchFeeSol * solUsd : 0;

if (launchName) {
launchName.textContent = values.tokenName || "Untitled Launch";
}

if (launchSub) {
launchSub.textContent = `${normalizeTemplateLabel(values.template)} • ${
values.symbol || "Ticker Pending"
}`;
}

if (bondBadge) {
bondBadge.textContent = `${getLaunchBondLabel()} Required`;
}

if (bondPrimary) {
bondPrimary.textContent = formatSol(values.builderBond, 3);
}

if (bondSecondary) {
bondSecondary.textContent =
solUsd > 0 ? `≈ ${formatUsd(bondUsdEstimate, 2)}` : "USD estimate pending";
}

if (visibilityTotalPrimary) {
visibilityTotalPrimary.textContent = formatUsd(visibilityTotalUsd, 0);
}

if (visibilityTotalSecondary) {
visibilityTotalSecondary.textContent =
solUsd > 0
? `${formatUsd(visibilityTotalUsd, 0)} • ${formatSol(
visibilitySolEstimate,
3
)}`
: `${formatUsd(visibilityTotalUsd, 0)} • — SOL`;
}

if (visibilityItems) {
if (!visibilityAddons.length) {
visibilityItems.innerHTML = `
<div class="checkout-list-item">
<span>No visibility items selected</span>
<strong>$0</strong>
</div>
`;
} else {
visibilityItems.innerHTML = visibilityAddons
.map((addon) => {
const solText = solUsd > 0 ? formatSol(addon.usd / solUsd, 3) : "— SOL";
return `
<div class="checkout-list-item">
<span>${escapeHtmlText(addon.label)}</span>
<strong>${escapeHtmlText(
`${formatUsd(addon.usd, 0)} • ${solText}`
)}</strong>
</div>
`;
})
.join("");
}
}

if (dueNowPrimary) {
if (solUsd > 0) {
dueNowPrimary.textContent = formatUsd(dueNowUsdEstimate, 2);
} else if (visibilityTotalUsd > 0) {
dueNowPrimary.textContent = `${formatUsd(visibilityTotalUsd, 0)} + bond quote pending`;
} else {
dueNowPrimary.textContent = formatSol(values.builderBond, 3);
}
}

if (dueNowSecondary) {
dueNowSecondary.textContent =
solUsd > 0
? `${formatSol(dueNowSolEstimate, 3)} total due now`
: `${formatSol(values.builderBond, 3)} builder bond • SOL refresh pending for add-ons`;
}

if (launchFeePrimary) {
launchFeePrimary.textContent = "3% of final committed SOL";
}

if (launchFeeSecondary) {
launchFeeSecondary.textContent =
maxLaunchFeeSol > 0
? solUsd > 0
? `At hard cap: ${formatSol(maxLaunchFeeSol, 3)} • ≈ ${formatUsd(
maxLaunchFeeUsd,
2
)}`
: `At hard cap: ${formatSol(maxLaunchFeeSol, 3)}`
: "Estimated from final raise once available";
}

if (dueIfLivePrimary) {
dueIfLivePrimary.textContent = "3% of final committed SOL";
}

if (dueIfLiveSecondary) {
dueIfLiveSecondary.textContent =
maxLaunchFeeSol > 0
? solUsd > 0
? `At hard cap: ${formatSol(maxLaunchFeeSol, 3)} • ≈ ${formatUsd(
maxLaunchFeeUsd,
2
)}`
: `At hard cap: ${formatSol(maxLaunchFeeSol, 3)}`
: "Settles only if the launch goes live";
}

if (quoteNote) {
if (solUsd > 0 && pricingState.fetchedAt) {
quoteNote.textContent = `USD prices are fixed. SOL equivalents refresh automatically every 20 seconds with market price. Current SOL/USD: ${formatUsd(
solUsd,
2
)}. Last updated ${new Date(pricingState.fetchedAt).toLocaleTimeString([], {
hour: "2-digit",
minute: "2-digit",
})}.`;
} else {
quoteNote.textContent =
"USD prices are fixed. SOL equivalents refresh automatically every 20 seconds when quote data is available.";
}
}
}

function updatePreview() {
const values = getFormValues();

const previewName = $("previewName");
const previewSub = $("previewSub");
const previewMinRaise = $("previewMinRaise");
const previewHardCap = $("previewHardCap");
const previewSupply = $("previewSupply");
const previewWallet = $("previewWallet");
const previewDesc = $("previewDesc");
const previewBadge = $("previewBadge");

if (previewName) previewName.textContent = values.tokenName || "Untitled Launch";
if (previewSub) {
previewSub.textContent = `${values.symbol || "TICK"} • ${normalizeTemplateLabel(
values.template
)}`;
}
if (previewMinRaise) previewMinRaise.textContent = formatSol(values.minRaiseSol);
if (previewHardCap) previewHardCap.textContent = formatSol(values.hardCapSol);
if (previewSupply) previewSupply.textContent = formatSupply(values.supply);
if (previewWallet) {
previewWallet.textContent = values.builderAlias
? `${values.builderAlias}${values.wallet ? ` • ${shortenWallet(values.wallet)}` : ""}`
: values.wallet
? shortenWallet(values.wallet)
: "—";
}
if (previewDesc) {
previewDesc.textContent =
values.description || "Launch description preview will appear here.";
}
if (previewBadge) previewBadge.textContent = "Commit";

const flowChip = $("previewFlowChip");
const templateChip = $("previewTemplateChip");
const allocationChip = $("previewAllocationChip");

if (flowChip) {
flowChip.textContent = "Commit → Countdown → Building → Live";
}

if (templateChip) {
templateChip.textContent =
values.template === "builder" ? "Builder Template" : "Template Locked";
}

if (allocationChip) {
allocationChip.textContent =
values.template === "builder"
? "Builder Controls Active"
: "1 SOL Max Commit";
}

renderPreviewBuilderBlock(values);
syncLaunchBondField(values);
updateTemplateSelectionCards(values.template);
updateVisibilitySelectionCards();
updateAddonPriceLabels();
renderCheckoutSummary(values);

const file = $("logoInput")?.files?.[0];
const existingUrl = values.imageUrl;
const img = $("logoPreviewImg");
const placeholder = $("logoPreviewPlaceholder");

if (!img || !placeholder) return;

if (file) {
clearLogoPreviewObjectUrl();
currentLogoPreviewObjectUrl = URL.createObjectURL(file);
img.src = currentLogoPreviewObjectUrl;
img.style.display = "block";
placeholder.style.display = "none";
return;
}

clearLogoPreviewObjectUrl();

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

function applyTemplateValues() {
const tpl = getSelectedTemplate();
const builderMode = tpl.key === "builder";

const supplyInput = $("supply");
const supplyPreset = $("supplyPreset");
const fixedSupplyField = $("fixedSupplyField");
const builderSupplyField = $("builderSupplyField");
const builderHardCapField = $("builderHardCapField");
const builderMinRaiseField = $("builderMinRaiseField");
const builderExtras = $("builderExtras");
const builderHighlight = $("builderModeHighlight");

if (builderMode) {
const builderSupply = Number(supplyPreset?.value || tpl.supply);
if (supplyInput) supplyInput.value = String(builderSupply);

if (fixedSupplyField) fixedSupplyField.style.display = "none";
if (builderSupplyField) builderSupplyField.classList.add("show");
if (builderHardCapField) builderHardCapField.classList.add("show");
if (builderMinRaiseField) builderMinRaiseField.classList.add("show");
if (builderExtras) builderExtras.classList.add("show");
if (builderHighlight) builderHighlight.classList.add("show");
} else {
if (supplyInput) supplyInput.value = String(tpl.supply);

if (fixedSupplyField) fixedSupplyField.style.display = "grid";
if (builderSupplyField) builderSupplyField.classList.remove("show");
if (builderHardCapField) builderHardCapField.classList.remove("show");
if (builderMinRaiseField) builderMinRaiseField.classList.remove("show");
if (builderExtras) builderExtras.classList.remove("show");
if (builderHighlight) builderHighlight.classList.remove("show");
}

if ($("minRaiseSol")) $("minRaiseSol").value = String(tpl.minRaiseSol);
if ($("hardCapSol")) $("hardCapSol").value = String(tpl.hardCapSol);

if ($("launchFeeDisplay")) {
$("launchFeeDisplay").value = "3% of final committed SOL • only if live";
}
if ($("launchFeeRuleDisplay")) {
$("launchFeeRuleDisplay").value = "3% of final committed SOL";
}
if ($("launchFeeSplitDisplay")) {
$("launchFeeSplitDisplay").value =
"60% Core Team Development • 40% MSS Ecosystem Support";
}
if ($("cassieIncludedDisplay")) {
$("cassieIncludedDisplay").value =
"Included standard on every launch";
}

syncLaunchBondField(tpl);
updateTemplateSelectionCards(tpl.key);
updateTeamAllocationTotal();
updatePreview();
}

async function connectWallet() {
try {
const wallet = await connectAnyWallet();
updateWalletUi();
updatePreview();

if (wallet?.isConnected) {
await refreshBuilderComplianceStatus({ silent: true });

const compliancePayload = getBuilderCompliancePayload();
if (isBuilderComplianceApproved(compliancePayload)) {
setStatus("good", `Wallet connected: ${shortenWallet(wallet.publicKey)}`);
} else {
setStatus("warn", getBuilderComplianceMessage(compliancePayload));
}
return;
}

setStatus("warn", "Wallet connection cancelled.");
} catch (err) {
const msg = err?.message || "Wallet connection failed.";
setStatus(
"bad",
msg.includes("No supported wallet") ? getMobileWalletHelpText() : msg
);
}
}

async function disconnectWallet() {
try {
await disconnectAnyWallet();
} catch {
// ignore
}

clearBuilderBondCache();
builderComplianceState = {
wallet: "",
payload: null,
};
renderBuilderComplianceUi(null);
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

async function createBuilderProfile(wallet, preferredAlias = "") {
const aliases = getBuilderAliasCandidates(wallet, preferredAlias);
let lastError = null;

for (const alias of aliases) {
try {
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

return data.builder || null;
} catch (err) {
const message = String(err?.message || "");

if (
message.toLowerCase().includes("already exists") ||
message.toLowerCase().includes("duplicate")
) {
const existing = await getBuilderByWallet(wallet);
if (existing) return existing;
}

if (message.toLowerCase().includes("alias is already taken")) {
lastError = err;
continue;
}

throw err;
}
}

if (lastError) {
throw lastError;
}

throw new Error("Builder profile could not be created automatically.");
}

async function ensureBuilderProfile(wallet, preferredAlias = "", { forceCreate = false } = {}) {
if (!wallet) {
throw new Error("Builder wallet is required.");
}

if (!forceCreate) {
const existing = await getBuilderByWallet(wallet);
if (existing) return existing;
}

setStatus("warn", "No builder profile found. Creating one automatically...");
const created = await createBuilderProfile(wallet, preferredAlias);

if (created) {
return created;
}

await sleep(250);

const retry = await getBuilderByWallet(wallet);
if (retry) return retry;

throw new Error("Builder profile could not be created automatically.");
}

async function createLaunch(payload) {
const data = await fetchJson(`/api/launcher/create`, {
method: "POST",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify(payload),
});

return data;
}

async function createLaunchWithBuilderFallback(payload) {
try {
return await createLaunch(payload);
} catch (err) {
if (!isBuilderNotFoundMessage(err?.message)) {
throw err;
}

setStatus(
"warn",
"Builder profile was missing during launch creation. Rebuilding profile and retrying..."
);
await ensureBuilderProfile(payload.wallet, payload.builder_alias, { forceCreate: true });
await sleep(300);

return createLaunch(payload);
}
}

async function collectLaunchBond(values) {
if (Number(values.builderBond) <= 0) {
return "";
}

const cachedSignature = getCachedBuilderBondSignature(values);
if (cachedSignature) {
return cachedSignature;
}

const provider = getInjectedWalletProvider();
if (!provider?.signTransaction) {
throw new Error(
`${getLaunchBondLabel()} signing is not available for this wallet session.`
);
}

if (!window.solanaWeb3?.Transaction?.from) {
throw new Error("solanaWeb3 is not available on this page.");
}

setStatus("warn", `Preparing ${getLaunchBondLabel().toLowerCase()} approval...`);

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
prepare.transaction || prepare.serializedTransaction || prepare.tx || "";

if (!transactionBase64) {
throw new Error(
`Prepared ${getLaunchBondLabel().toLowerCase()} transaction was not returned by the server.`
);
}

const txBytes = Uint8Array.from(atob(transactionBase64), (c) =>
c.charCodeAt(0)
);
const transaction = window.solanaWeb3.Transaction.from(txBytes);

setStatus("warn", `Awaiting ${getLaunchBondLabel().toLowerCase()} wallet approval...`);
const signedTransaction = await provider.signTransaction(transaction);

const signedBase64 = btoa(String.fromCharCode(...signedTransaction.serialize()));

setStatus("warn", `Confirming ${getLaunchBondLabel().toLowerCase()}...`);
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
key: getBuilderBondCacheKey(values),
txSignature: confirm.txSignature,
};

return confirm.txSignature;
}

async function fetchOptionalJson(url) {
try {
const res = await fetch(url, { credentials: "include" });
if (!res.ok) return null;
return await res.json().catch(() => null);
} catch {
return null;
}
}

function extractSolUsdFromPayload(payload) {
if (!payload || typeof payload !== "object") return null;

const candidates = [
payload.solUsd,
payload.sol_usd,
payload.price,
payload.usd,
payload.data?.solUsd,
payload.data?.sol_usd,
payload.data?.price,
payload.data?.usd,
payload.quote?.solUsd,
payload.quote?.sol_usd,
payload.quote?.price,
payload.quote?.usd,
payload.market?.solUsd,
payload.market?.sol_usd,
];

for (const candidate of candidates) {
const num = Number(candidate);
if (Number.isFinite(num) && num > 0) {
return num;
}
}

const globalQuote = Number(window.__MSS_SOL_USD__ || 0);
if (Number.isFinite(globalQuote) && globalQuote > 0) {
return globalQuote;
}

return null;
}

async function fetchSolUsdQuote() {
const apiBase = getApiBase();
const endpoints = [
`${apiBase}/api/launcher/checkout-quote`,
`${apiBase}/api/pricing/sol-usd`,
`${apiBase}/api/market/sol-usd`,
`${apiBase}/api/market/sol-price`,
`${apiBase}/api/quote/sol-usd`,
];

for (const url of endpoints) {
const payload = await fetchOptionalJson(url);
const solUsd = extractSolUsdFromPayload(payload);
if (solUsd) {
return solUsd;
}
}

return null;
}

async function refreshPricingQuote({ silent = false } = {}) {
if (pricingState.isLoading) return pricingState.solUsd;
pricingState.isLoading = true;

try {
const solUsd = await fetchSolUsdQuote();
if (solUsd && Number.isFinite(solUsd) && solUsd > 0) {
pricingState.solUsd = solUsd;
pricingState.fetchedAt = Date.now();
}
updatePreview();
return pricingState.solUsd;
} catch (err) {
if (!silent) {
console.error("pricing quote refresh failed:", err);
}
updatePreview();
return pricingState.solUsd;
} finally {
pricingState.isLoading = false;
}
}

function startPricingQuoteLoop() {
if (quoteRefreshIntervalId) {
clearInterval(quoteRefreshIntervalId);
quoteRefreshIntervalId = null;
}

quoteRefreshIntervalId = window.setInterval(() => {
void refreshPricingQuote({ silent: true });
}, SOL_QUOTE_REFRESH_MS);
}

function stopPricingQuoteLoop() {
if (quoteRefreshIntervalId) {
clearInterval(quoteRefreshIntervalId);
quoteRefreshIntervalId = null;
}
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

await requireApprovedBuilderCompliance(values.wallet);

setStatus("warn", "Preparing builder profile...");
await ensureBuilderProfile(values.wallet, values.builderAlias);

let builderBondTxSignature = "";
if (Number(values.builderBond) > 0) {
builderBondTxSignature = await collectLaunchBond(values);
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
builder_alias: values.builderAlias,
description: values.description,
image_url: finalImageUrl,
website_url: values.websiteUrl ? normalizeUrl(values.websiteUrl, "website_url") : "",
x_url: values.xUrl ? normalizeUrl(values.xUrl, "x_url") : "",
telegram_url: values.telegramUrl
? normalizeUrl(values.telegramUrl, "telegram_url")
: "",
discord_url: values.discordUrl
? normalizeUrl(values.discordUrl, "discord_url")
: "",
supply: Number(values.supply),
min_raise_sol: Number(values.minRaiseSol),
hard_cap_sol: Number(values.hardCapSol),
team_allocation_pct:
values.template === "builder" ? Number(values.teamAllocation) : 0,
team_wallets: values.template === "builder" ? values.teamWallets : [],
team_wallet_breakdown:
values.template === "builder" ? values.teamWalletBreakdown : [],
builder_bond_sol: Number(values.builderBond),
builder_bond_tx_signature: builderBondTxSignature,
launch_fee_pct: 3,
launch_fee_split: {
core_team_development_pct: 60,
mss_ecosystem_support_pct: 40,
},
cassie_monitoring_included: true,
launch_visibility_addons: values.visibilityAddons.map((addon) => ({
key: addon.key,
label: addon.label,
usd_price: Number(addon.usd),
sol_estimate: toNumber(addon.sol_estimate, 0),
})),
pricing_quote: {
sol_usd: toNumber(pricingState.solUsd, 0),
quoted_at: pricingState.fetchedAt || null,
},
acknowledgements: values.acknowledgements,
};

const result = await createLaunchWithBuilderFallback(payload);
const launch = result?.launch || null;
const mintReservation = result?.mintReservation || null;

if (!launch?.id) {
throw new Error("Launch was created but no launch id was returned.");
}

const launchBondNotice =
Number(values.builderBond) > 0
? ` ${getLaunchBondLabel()} confirmed: ${values.builderBond} SOL.`
: "";

const visibilityNotice = values.visibilityAddons.length
? ` Visibility selected: ${values.visibilityAddons.length} item${
values.visibilityAddons.length === 1 ? "" : "s"
}.`
: "";

const mintNotice = mintReservation?.reservedMintAddress
? ` Reserved mint: ${mintReservation.reservedMintAddress}.`
: "";

setStatus(
"good",
`Launch created successfully. Redirecting to launch #${
launch.id
}...${launchBondNotice}${visibilityNotice}${mintNotice}`
);

clearBuilderBondCache();

window.setTimeout(() => {
window.location.href = `./launch-detail.html?id=${encodeURIComponent(
launch.id
)}`;
}, 700);
} catch (err) {
const values = getFormValues();
const compliancePayload = getBuilderCompliancePayload();
const shouldRouteToCompliance =
values.wallet &&
compliancePayload &&
!isBuilderComplianceApproved(compliancePayload);

setStatus("bad", err?.message || "Unable to create launch.");

if (shouldRouteToCompliance) {
window.setTimeout(() => {
window.location.href = buildCompliancePageUrl(values.wallet);
}, 800);
}
} finally {
if (btn) {
btn.disabled = false;
btn.textContent = "Create Launch";
}
}
}

function handleTemplateLinkedChange(sourceId) {
return () => {
if (
sourceId === "template" ||
sourceId === "supplyPreset" ||
sourceId === "builderHardCapSol" ||
sourceId === "builderMinRaiseSol"
) {
applyTemplateValues();
}

if (sourceId === "teamWalletCount") {
renderTeamWalletInputs();
}

if (
sourceId === "template" ||
sourceId === "builderHardCapSol" ||
sourceId === "builderMinRaiseSol" ||
sourceId === "builderBond" ||
sourceId === "teamWalletCount" ||
sourceId === "teamAllocation"
) {
clearBuilderBondCache();
}

updatePreview();
updateTeamAllocationTotal();
};
}

function bindPreview() {
const ids = [
"template",
"tokenName",
"symbol",
"builderAlias",
"description",
"imageUrl",
"logoInput",
"websiteUrl",
"xUrl",
"telegramUrl",
"discordUrl",
"supplyPreset",
"builderHardCapSol",
"builderMinRaiseSol",
"teamWalletCount",
"teamAllocation",
"builderBond",
"ackBondRequired",
"ackVisibilityImmediate",
"ackLaunchFeeLive",
];

for (const id of ids) {
const el = $(id);
if (!el) continue;

const handler = handleTemplateLinkedChange(id);
el.addEventListener("input", handler);
el.addEventListener("change", handler);
}

const builderAliasInput = $("builderAlias");
if (builderAliasInput) {
builderAliasInput.addEventListener("input", () => {
builderAliasInput.dataset.userEdited = builderAliasInput.value.trim() ? "1" : "0";
});
}

VISIBILITY_ADDONS.forEach((addon) => {
const checkbox = $(addon.checkboxId);
if (!checkbox) return;
const handler = () => updatePreview();
checkbox.addEventListener("change", handler);
checkbox.addEventListener("input", handler);
});
}

function bindTemplateCards() {
document.querySelectorAll("[data-template-card]").forEach((card) => {
if (card.dataset.bound === "1") return;
card.dataset.bound = "1";

card.addEventListener("click", () => {
const key = card.getAttribute("data-template-card") || "";
const select = $("template");
if (!select || !key) return;
select.value = key;
clearBuilderBondCache();
applyTemplateValues();
});
});
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

$("builderComplianceAction")?.addEventListener("click", (event) => {
const wallet = getConnectedPublicKey() || "";
event.currentTarget.href = buildCompliancePageUrl(wallet);
});

onWalletChange(async () => {
clearBuilderBondCache();
updateWalletUi();
updatePreview();

try {
await refreshBuilderComplianceStatus({ silent: true });
} catch {
// ignore on passive wallet state changes
}
});
}

async function init() {
initSessionUi();
applyTemplateValues();
updateWalletUi();
bindPreview();
bindTemplateCards();
bindWalletEvents();
renderTeamWalletInputs();
updatePreview();
updateTeamAllocationTotal();
renderBuilderComplianceUi(null);

await restoreWalletIfTrusted();
updateWalletUi();
updatePreview();

try {
await refreshBuilderComplianceStatus({ silent: true });
} catch {
// ignore on initial passive load
}

await refreshPricingQuote({ silent: true });
startPricingQuoteLoop();

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

window.addEventListener("beforeunload", () => {
clearLogoPreviewObjectUrl();
stopPricingQuoteLoop();
});
}

init();