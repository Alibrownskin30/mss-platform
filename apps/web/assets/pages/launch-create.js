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

function toBoolean(value) {
if (value === true || value === 1) return true;

const normalized = String(value ?? "")
.trim()
.toLowerCase();

return ["true", "1", "yes", "y", "on", "accepted"].includes(normalized);
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
.replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeWallet(value) {
return String(value || "").trim();
}

function normalizeBuilderAlias(value, fallback = "") {
return String(value || fallback || "")
.trim()
.slice(0, 60);
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
const value = String(wallet || "").trim();

if (!value) return "—";
if (value.length <= 12) return value;

return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function defaultBuilderAlias(wallet) {
const value = String(wallet || "").trim();
if (!value) return "New Builder";

return `Builder ${value.slice(0, 4)}${value.slice(-4)}`;
}

function getBuilderAliasCandidates(wallet, preferredAlias = "") {
const value = String(wallet || "").trim();
const cleanedPreferred = normalizeBuilderAlias(preferredAlias);

if (!value) {
return cleanedPreferred ? [cleanedPreferred] : ["New Builder"];
}

const first4 = value.slice(0, 4);
const last4 = value.slice(-4);
const first6 = value.slice(0, 6);

return Array.from(
new Set(
[
cleanedPreferred,
`Builder ${first4}${last4}`,
`Builder ${first4}-${last4}`,
`Builder ${first6}`,
defaultBuilderAlias(wallet),
]
.map((item) => String(item || "").trim().slice(0, 60))
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
const element = $("createStatus");
if (!element) return;

element.className = `status show ${kind}`;
element.textContent = message;
}

function clearStatus() {
const element = $("createStatus");
if (!element) return;

element.className = "status";
element.textContent = "";
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

if (!/^https?:\/\//i.test(normalized)) {
normalized = `https://${normalized}`;
}

try {
const url = new URL(normalized);

if (!["http:", "https:"].includes(url.protocol)) {
return "";
}

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

class ApiRequestError extends Error {
constructor(message, status = 500, payload = null) {
super(message || "Request failed.");
this.name = "ApiRequestError";
this.status = Number(status || 500);
this.payload = payload || null;
this.code = String(payload?.code || "").trim();
}
}

async function fetchJson(path, options = {}) {
const apiBase = getApiBase();
const response = await fetch(`${apiBase}${path}`, options);

let data = null;

try {
data = await response.json();
} catch {
data = null;
}

if (!response.ok || !data?.ok) {
throw new ApiRequestError(
data?.error || `HTTP ${response.status}`,
response.status,
data
);
}

return data;
}

const SOL_QUOTE_REFRESH_MS = 20000;
const LAUNCH_FEE_PCT = 5;
const BUILDER_BOND_SESSION_STORAGE_KEY = "__mss_pending_builder_bond_v1";

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

const LAUNCHER_ACKNOWLEDGEMENT_FIELDS = [
{
id: "ackLauncherTerms",
key: "terms_accepted",
message: "Accept the MSS Launcher Terms before continuing.",
label: "I accept the MSS Launcher Terms for creating this launch.",
},
{
id: "ackLaunchRiskDisclosure",
key: "risk_disclosure_accepted",
message: "Accept the launch risk disclosure before continuing.",
label:
"I understand crypto launches carry significant risk and outcomes are not guaranteed.",
},
{
id: "ackLaunchRules",
key: "launch_rules_accepted",
message:
"Accept the launch rules and transaction conditions before continuing.",
label:
"I accept the launch rules, allocation conditions, bond rules and transaction conditions.",
},
{
id: "ackLaunchNoAdvice",
key: "no_advice_accepted",
message: "Accept the information-only acknowledgement before continuing.",
label:
"I understand MSS provides information and infrastructure only, not investment advice.",
},
{
id: "ackProjectDisclosure",
key: "project_disclosure_accepted",
message: "Accept the project information disclosure before continuing.",
label:
"I confirm the project information and declared team wallets supplied are accurate.",
},
{
id: "ackProhibitedConduct",
key: "prohibited_conduct_accepted",
message: "Accept the prohibited conduct acknowledgement before continuing.",
label:
"I agree not to engage in misleading conduct, undisclosed wallet activity or market manipulation.",
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

function safeSessionStorageGet(key) {
try {
return window.sessionStorage.getItem(key);
} catch {
return null;
}
}

function safeSessionStorageSet(key, value) {
try {
window.sessionStorage.setItem(key, value);
} catch {
// Session storage is optional protection only.
}
}

function safeSessionStorageRemove(key) {
try {
window.sessionStorage.removeItem(key);
} catch {
// Session storage is optional protection only.
}
}

function getBuilderBondCacheKey(values) {
return JSON.stringify({
wallet: normalizeWallet(values?.wallet || ""),
builderBond: Number(values?.builderBond || 0),
});
}

function readStoredBuilderBond() {
const raw = safeSessionStorageGet(BUILDER_BOND_SESSION_STORAGE_KEY);
if (!raw) return null;

try {
const parsed = JSON.parse(raw);

if (
!parsed ||
typeof parsed !== "object" ||
!parsed.key ||
!parsed.txSignature
) {
return null;
}

return {
key: String(parsed.key),
txSignature: String(parsed.txSignature),
wallet: normalizeWallet(parsed.wallet),
builderBond: Number(parsed.builderBond || 0),
confirmedAt: Number(parsed.confirmedAt || 0),
};
} catch {
return null;
}
}

function rememberConfirmedBuilderBond(values, txSignature) {
const signature = String(txSignature || "").trim();
if (!signature) return;

cachedBuilderBond = {
key: getBuilderBondCacheKey(values),
txSignature: signature,
wallet: normalizeWallet(values?.wallet),
builderBond: Number(values?.builderBond || 0),
confirmedAt: Date.now(),
};

safeSessionStorageSet(
BUILDER_BOND_SESSION_STORAGE_KEY,
JSON.stringify(cachedBuilderBond)
);
}

function clearBuilderBondCache({ forgetConfirmed = false } = {}) {
cachedBuilderBond = null;

if (forgetConfirmed) {
safeSessionStorageRemove(BUILDER_BOND_SESSION_STORAGE_KEY);
}
}

function getCachedBuilderBondSignature(values) {
const key = getBuilderBondCacheKey(values);

if (cachedBuilderBond?.key === key && cachedBuilderBond.txSignature) {
return cachedBuilderBond.txSignature;
}

const stored = readStoredBuilderBond();

if (stored?.key === key && stored.txSignature) {
cachedBuilderBond = stored;
return stored.txSignature;
}

return "";
}

function hasConfirmedBuilderBondForValues(values) {
return Boolean(getCachedBuilderBondSignature(values));
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
const amount = Number(row.pct || 0);
return sum + (Number.isFinite(amount) ? amount : 0);
}, 0);
}

function updateTeamAllocationTotal() {
const totalElement = $("teamAllocationTotal");
if (!totalElement) return;

const total = getTeamAllocationTotalValue();
const limit = Math.min(Number($("teamAllocation")?.value || 0) || 0, 15);

totalElement.textContent = `${total.toFixed(2)}%`;
totalElement.classList.remove("good", "warn", "bad");

if (total <= 0) {
totalElement.classList.add("good");
return;
}

if (total > 15 || (limit > 0 && total > limit)) {
totalElement.classList.add("bad");
return;
}

if (limit > 0 && total >= limit * 0.85) {
totalElement.classList.add("warn");
return;
}

totalElement.classList.add("good");
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

function getCommercialAcknowledgements() {
return {
bondRequired: Boolean($("ackBondRequired")?.checked),
visibilityImmediate: Boolean($("ackVisibilityImmediate")?.checked),
launchFeeLive: Boolean($("ackLaunchFeeLive")?.checked),
};
}

function getLauncherAcknowledgements() {
const acknowledgements = {};

for (const field of LAUNCHER_ACKNOWLEDGEMENT_FIELDS) {
acknowledgements[field.key] = Boolean($(field.id)?.checked);
}

return acknowledgements;
}

function buildLauncherAcknowledgementPayload(values) {
const acknowledgements = values?.launcherAcknowledgements || {};

return {
terms_accepted: Boolean(acknowledgements.terms_accepted),
risk_disclosure_accepted: Boolean(
acknowledgements.risk_disclosure_accepted
),
launch_rules_accepted: Boolean(acknowledgements.launch_rules_accepted),
no_advice_accepted: Boolean(acknowledgements.no_advice_accepted),
project_disclosure_accepted: Boolean(
acknowledgements.project_disclosure_accepted
),
prohibited_conduct_accepted: Boolean(
acknowledgements.prohibited_conduct_accepted
),
};
}

function getFormValues() {
const template = getSelectedTemplate();
const builderMode = template.key === "builder";
const wallet = getConnectedPublicKey() || "";

const supplyValue = builderMode
? Number($("supplyPreset")?.value || template.supply)
: template.supply;

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
template: template.key,
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
minRaiseSol: template.minRaiseSol,
hardCapSol: template.hardCapSol,
builderBond: template.builderBond,
teamWalletCount: builderMode
? Number($("teamWalletCount")?.value || 0)
: 0,
teamAllocation: builderMode
? Number($("teamAllocation")?.value || 0)
: 0,
teamWallets,
teamWalletBreakdown,
teamAllocationTotal,
visibilityAddons,
commercialAcknowledgements: getCommercialAcknowledgements(),
launcherAcknowledgements: getLauncherAcknowledgements(),
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

const normalizedXUrl = values.xUrl
? normalizeUrl(values.xUrl, "x_url")
: "";

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
throw new Error(
"Team wallet rows are not aligned with team wallet count."
);
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

const walletKey = row.wallet.toLowerCase();

if (seenWallets.has(walletKey)) {
throw new Error(
`Team wallet ${row.index + 1} duplicates another team wallet.`
);
}

seenWallets.add(walletKey);
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

if (!values.commercialAcknowledgements.bondRequired) {
throw new Error(
"Confirm the Builder Bond acknowledgement before continuing."
);
}

if (!values.commercialAcknowledgements.visibilityImmediate) {
throw new Error(
"Confirm the Launch Visibility acknowledgement before continuing."
);
}

if (!values.commercialAcknowledgements.launchFeeLive) {
throw new Error(
"Confirm the MSS Launch Fee acknowledgement before continuing."
);
}

for (const field of LAUNCHER_ACKNOWLEDGEMENT_FIELDS) {
if (!values.launcherAcknowledgements[field.key]) {
throw new Error(field.message);
}
}
}

function bindLauncherAcknowledgementInputs() {
for (const field of LAUNCHER_ACKNOWLEDGEMENT_FIELDS) {
const input = $(field.id);

if (!input || input.dataset.bound === "1") continue;

input.dataset.bound = "1";

input.addEventListener("change", () => {
updatePreview();
});
}
}

function ensureLauncherAcknowledgementUi() {
const form = $("launchCreateForm");
if (!form) return;

const missingFields = LAUNCHER_ACKNOWLEDGEMENT_FIELDS.filter(
(field) => !$(field.id)
);

if (!missingFields.length) {
bindLauncherAcknowledgementInputs();
return;
}

let wrapper = $("launcherAcknowledgementPanel");

if (!wrapper) {
wrapper = document.createElement("section");
wrapper.id = "launcherAcknowledgementPanel";
wrapper.className = "checkout-card launcher-acknowledgement-panel";

wrapper.innerHTML = `
<div class="checkout-section-head">
<div>
<div class="admin-kicker">Launcher Acknowledgements</div>
<h3>Terms and risk acknowledgement</h3>
<p>
No ID verification or KYC is required for this launch flow. Before paying the Builder Bond,
confirm the Launcher terms, risk disclosures and builder conduct requirements.
</p>
</div>
</div>
<div id="launcherAcknowledgementFields" class="launcher-acknowledgement-fields"></div>
`;

const createButton = $("createLaunchBtn");
const insertionTarget =
createButton?.closest(".form-actions") ||
createButton?.parentElement ||
null;

if (insertionTarget?.parentNode) {
insertionTarget.parentNode.insertBefore(wrapper, insertionTarget);
} else {
form.appendChild(wrapper);
}
}

const fieldsContainer =
$("launcherAcknowledgementFields") ||
wrapper.querySelector(".launcher-acknowledgement-fields");

if (!fieldsContainer) return;

for (const field of missingFields) {
const row = document.createElement("label");

row.className = "checkout-check-row launcher-acknowledgement-row";
row.innerHTML = `
<input id="${field.id}" type="checkbox" />
<span>${escapeHtmlText(field.label)}</span>
`;

fieldsContainer.appendChild(row);
}

bindLauncherAcknowledgementInputs();
}

function getBuilderStatusPayload() {
return builderComplianceState?.payload || null;
}

function getBuilderLaunchAccess(payload = null) {
const statusPayload = payload || getBuilderStatusPayload();

if (!statusPayload) {
return {
payload: null,
blocked: false,
acknowledgementAccepted: false,
accessState: "unavailable",
accessReason: "",
canProceedToAcknowledgement: true,
};
}

const blockingSignals = Array.isArray(statusPayload.blocking_signals)
? statusPayload.blocking_signals
: [];

const blocked = Boolean(
statusPayload.internal_intervention_active ||
String(statusPayload.access_state || "").toLowerCase() === "blocked" ||
blockingSignals.some((signal) => signal?.blocking === true)
);

const acknowledgementAccepted = Boolean(
statusPayload.acknowledgement_accepted
);

return {
payload: statusPayload,
blocked,
acknowledgementAccepted,
accessState: String(statusPayload.access_state || "").toLowerCase(),
accessReason: String(statusPayload.access_reason || "").trim(),
canProceedToAcknowledgement: !blocked,
};
}

function getBuilderStatusMessage(payload = null) {
const access = getBuilderLaunchAccess(payload);

if (!access.payload) {
return "Wallet status could not be loaded. No identity verification is required, but the transaction will still be checked before payment.";
}

if (access.blocked) {
return (
access.accessReason ||
"This wallet is currently unable to create launches. Contact support if you believe this is an error."
);
}

if (access.acknowledgementAccepted) {
return "Launcher terms have been acknowledged for this wallet. No identity verification is required.";
}

return "No identity verification is required. Accept the Launcher terms and risk acknowledgements below before creating your launch.";
}

function renderBuilderComplianceUi(payload = null) {
const card = $("builderComplianceCard");
const pill = $("builderCompliancePill");
const copy = $("builderComplianceCopy");
const action = $("builderComplianceAction");
const meta = $("builderComplianceMeta");
const connectedWallet = getConnectedPublicKey() || "";

if (!card || !pill || !copy || !action || !meta) return;

const access = getBuilderLaunchAccess(payload);

if (!access.payload && !connectedWallet) {
card.classList.remove("show");
return;
}

card.classList.add("show");
action.style.display = "none";

if (!access.payload) {
pill.className = "status-pill warn";
pill.textContent = "Status Check Pending";
copy.textContent = getBuilderStatusMessage(null);
meta.textContent = connectedWallet
? `Wallet: ${shortenWallet(
connectedWallet
)} • Flow: Acknowledgement only`
: "Connect a wallet to continue";
return;
}

if (access.blocked) {
pill.className = "status-pill bad";
pill.textContent = "Wallet Blocked";
copy.textContent = getBuilderStatusMessage(access.payload);
meta.textContent = `Wallet: ${shortenWallet(
connectedWallet
)} • Launcher transactions unavailable`;
return;
}

if (access.acknowledgementAccepted) {
pill.className = "status-pill good";
pill.textContent = "Terms Recorded";
copy.textContent = getBuilderStatusMessage(access.payload);
meta.textContent = `Wallet: ${shortenWallet(
connectedWallet
)} • No ID / KYC required`;
return;
}

pill.className = "status-pill good";
pill.textContent = "No ID / KYC Required";
copy.textContent = getBuilderStatusMessage(access.payload);
meta.textContent = `Wallet: ${shortenWallet(
connectedWallet
)} • Terms acknowledgement required at checkout`;
}

async function fetchBuilderStatus(wallet, { silent = false } = {}) {
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
)}&role=builder&mode=builder&context=builder&surface=launch_create`
);

builderComplianceState = {
wallet: normalizedWallet,
payload: data,
};

renderBuilderComplianceUi(data);

if (!silent) {
const access = getBuilderLaunchAccess(data);

setStatus(
access.blocked ? "bad" : "good",
getBuilderStatusMessage(data)
);
}

return data;
}

async function refreshBuilderStatus({ silent = false } = {}) {
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
return await fetchBuilderStatus(wallet, { silent });
} catch (err) {
builderComplianceState = {
wallet,
payload: null,
};

renderBuilderComplianceUi(null);

if (!silent) {
setStatus("bad", err?.message || "Unable to load wallet status.");
}

throw err;
}
}

async function requireBuilderLaunchAccess(wallet) {
const payload =
builderComplianceState.wallet === wallet && builderComplianceState.payload
? builderComplianceState.payload
: await fetchBuilderStatus(wallet, { silent: true });

const access = getBuilderLaunchAccess(payload);

if (!access.blocked) {
return payload;
}

throw new ApiRequestError(getBuilderStatusMessage(payload), 403, payload);
}

function updateWalletUi() {
const walletInput = $("wallet");
const walletPill = $("walletPill");
const connectButton = $("connectWalletBtn");
const disconnectButton = $("disconnectWalletBtn");
const walletHint = $("walletHint");

if (!walletInput || !walletPill || !connectButton || !disconnectButton) {
return;
}

const walletState = getConnectedWallet();

if (walletState.isConnected) {
walletInput.value = walletState.publicKey || "";
walletPill.textContent = `Connected: ${walletState.shortPublicKey}`;
walletInput.readOnly = true;
connectButton.style.display = "none";
disconnectButton.style.display = "inline-flex";

if (walletHint) {
walletHint.textContent = `Connected via ${String(
walletState.walletName || "wallet"
).replace(/\b\w/g, (character) => character.toUpperCase())}.`;
}
} else {
walletInput.value = "";
walletPill.textContent = "No wallet connected";
walletInput.readOnly = true;
connectButton.style.display = "inline-flex";
disconnectButton.style.display = "none";

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

for (let index = 0; index < count; index += 1) {
const previous = existing[index] || {
label: "Team",
wallet: "",
pct: 0,
};

const selectedLabel = TEAM_LABEL_OPTIONS.includes(previous.label)
? previous.label
: "Custom";

const customLabel = selectedLabel === "Custom" ? previous.label : "";

const row = document.createElement("div");
row.className = "team-wallet-row";

row.innerHTML = `
<div class="field">
<label>Wallet Label</label>
<select data-role="label-select">
${buildLabelOptionsHtml(selectedLabel)}
</select>
<input
data-role="label-custom"
type="text"
placeholder="Custom label"
value="${escapeHtmlAttr(customLabel)}"
style="${selectedLabel === "Custom" ? "" : "display:none;"}"
/>
</div>
<div class="field">
<label>Wallet Address</label>
<input
data-role="wallet"
type="text"
placeholder="Team wallet ${index + 1}"
value="${escapeHtmlAttr(previous.wallet || "")}"
autocomplete="off"
/>
</div>
<div class="field">
<label>Allocation %</label>
<input
data-role="allocation"
type="number"
min="0"
max="15"
step="0.1"
placeholder="0.0"
value="${Number(previous.pct || 0) || ""}"
/>
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

[labelCustomInput, walletInput, allocationInput].forEach((element) => {
element?.addEventListener("input", () => {
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
const allocationElement = $("previewTeamAllocation");
const bondElement = $("previewBuilderBond");
const list = $("previewBuilderList");

if (!block || !allocationElement || !bondElement || !list) return;

if (values.template !== "builder") {
block.classList.remove("show");
list.innerHTML = "";
return;
}

block.classList.add("show");

allocationElement.textContent = `${Number(values.teamAllocation || 0).toFixed(
values.teamAllocation % 1 ? 1 : 0
)}%`;

bondElement.textContent = formatSol(values.builderBond);

const rows = values.teamWalletBreakdown.filter(
(row) => row.wallet || row.label || row.pct
);

if (!rows.length) {
list.innerHTML =
'<div class="preview-builder-row"><span>No visible team wallets set</span><strong>—</strong></div>';
return;
}

list.innerHTML = rows
.map((row, index) => {
const label = row.label || `Wallet ${index + 1}`;
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
const priceElement = $(addon.priceId);

if (!priceElement) return;

priceElement.textContent = `${formatUsd(
addon.usd,
0
)} • ${getSolEquivalentText(addon.usd)}`;
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

const dueNowUsdEstimate =
solUsd > 0 ? bondUsdEstimate + visibilityTotalUsd : 0;

const dueNowSolEstimate = values.builderBond + visibilitySolEstimate;

const maxLaunchFeeSol =
toNumber(values.hardCapSol, 0) * (LAUNCH_FEE_PCT / 100);

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
solUsd > 0
? `≈ ${formatUsd(bondUsdEstimate, 2)}`
: "USD estimate pending";
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
const solText =
solUsd > 0 ? formatSol(addon.usd / solUsd, 3) : "— SOL";

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
dueNowPrimary.textContent = `${formatUsd(
visibilityTotalUsd,
0
)} + bond quote pending`;
} else {
dueNowPrimary.textContent = formatSol(values.builderBond, 3);
}
}

if (dueNowSecondary) {
dueNowSecondary.textContent =
solUsd > 0
? `${formatSol(dueNowSolEstimate, 3)} total due now`
: `${formatSol(
values.builderBond,
3
)} builder bond • SOL refresh pending for add-ons`;
}

if (launchFeePrimary) {
launchFeePrimary.textContent = `${LAUNCH_FEE_PCT}% of final committed SOL`;
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
dueIfLivePrimary.textContent = `${LAUNCH_FEE_PCT}% of final committed SOL`;
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
)}. Last updated ${new Date(pricingState.fetchedAt).toLocaleTimeString(
[],
{
hour: "2-digit",
minute: "2-digit",
}
)}.`;
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

if (previewName) {
previewName.textContent = values.tokenName || "Untitled Launch";
}

if (previewSub) {
previewSub.textContent = `${
values.symbol || "TICK"
} • ${normalizeTemplateLabel(values.template)}`;
}

if (previewMinRaise) {
previewMinRaise.textContent = formatSol(values.minRaiseSol);
}

if (previewHardCap) {
previewHardCap.textContent = formatSol(values.hardCapSol);
}

if (previewSupply) {
previewSupply.textContent = formatSupply(values.supply);
}

if (previewWallet) {
previewWallet.textContent = values.builderAlias
? `${values.builderAlias}${
values.wallet ? ` • ${shortenWallet(values.wallet)}` : ""
}`
: values.wallet
? shortenWallet(values.wallet)
: "—";
}

if (previewDesc) {
previewDesc.textContent =
values.description || "Launch description preview will appear here.";
}

if (previewBadge) {
previewBadge.textContent = "Commit";
}

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
const image = $("logoPreviewImg");
const placeholder = $("logoPreviewPlaceholder");

if (!image || !placeholder) return;

if (file) {
clearLogoPreviewObjectUrl();

currentLogoPreviewObjectUrl = URL.createObjectURL(file);
image.src = currentLogoPreviewObjectUrl;
image.style.display = "block";
placeholder.style.display = "none";
return;
}

clearLogoPreviewObjectUrl();

if (existingUrl) {
image.src = existingUrl;
image.style.display = "block";
placeholder.style.display = "none";
return;
}

image.removeAttribute("src");
image.style.display = "none";
placeholder.style.display = "grid";
}

function applyTemplateValues() {
const template = getSelectedTemplate();
const builderMode = template.key === "builder";

const supplyInput = $("supply");
const supplyPreset = $("supplyPreset");
const fixedSupplyField = $("fixedSupplyField");
const builderSupplyField = $("builderSupplyField");
const builderHardCapField = $("builderHardCapField");
const builderMinRaiseField = $("builderMinRaiseField");
const builderExtras = $("builderExtras");
const builderHighlight = $("builderModeHighlight");

if (builderMode) {
const builderSupply = Number(supplyPreset?.value || template.supply);

if (supplyInput) {
supplyInput.value = String(builderSupply);
}

if (fixedSupplyField) fixedSupplyField.style.display = "none";
if (builderSupplyField) builderSupplyField.classList.add("show");
if (builderHardCapField) builderHardCapField.classList.add("show");
if (builderMinRaiseField) builderMinRaiseField.classList.add("show");
if (builderExtras) builderExtras.classList.add("show");
if (builderHighlight) builderHighlight.classList.add("show");
} else {
if (supplyInput) {
supplyInput.value = String(template.supply);
}

if (fixedSupplyField) fixedSupplyField.style.display = "grid";
if (builderSupplyField) builderSupplyField.classList.remove("show");
if (builderHardCapField) builderHardCapField.classList.remove("show");
if (builderMinRaiseField) builderMinRaiseField.classList.remove("show");
if (builderExtras) builderExtras.classList.remove("show");
if (builderHighlight) builderHighlight.classList.remove("show");
}

if ($("minRaiseSol")) {
$("minRaiseSol").value = String(template.minRaiseSol);
}

if ($("hardCapSol")) {
$("hardCapSol").value = String(template.hardCapSol);
}

if ($("launchFeeDisplay")) {
$("launchFeeDisplay").value =
`${LAUNCH_FEE_PCT}% of final committed SOL • only if live`;
}

if ($("launchFeeRuleDisplay")) {
$("launchFeeRuleDisplay").value =
`${LAUNCH_FEE_PCT}% of final committed SOL`;
}

if ($("launchFeeSplitDisplay")) {
$("launchFeeSplitDisplay").value =
"60% Core Team Development • 40% MSS Ecosystem Support";
}

if ($("cassieIncludedDisplay")) {
$("cassieIncludedDisplay").value = "Included standard on every launch";
}

syncLaunchBondField(template);
updateTemplateSelectionCards(template.key);
updateTeamAllocationTotal();
updatePreview();
}

async function connectWallet() {
try {
const wallet = await connectAnyWallet();

updateWalletUi();
updatePreview();

if (wallet?.isConnected) {
await refreshBuilderStatus({ silent: true });

const payload = getBuilderStatusPayload();
const access = getBuilderLaunchAccess(payload);

setStatus(
access.blocked ? "bad" : "good",
getBuilderStatusMessage(payload)
);

return;
}

setStatus("warn", "Wallet connection cancelled.");
} catch (err) {
const message = err?.message || "Wallet connection failed.";

setStatus(
"bad",
message.includes("No supported wallet")
? getMobileWalletHelpText()
: message
);
}
}

async function disconnectWallet() {
try {
await disconnectAnyWallet();
} catch {
// Ignore wallet adapter disconnect failures.
}

cachedBuilderBond = null;

builderComplianceState = {
wallet: "",
payload: null,
};

renderBuilderComplianceUi(null);
updateWalletUi();
updatePreview();

setStatus(
"warn",
"Wallet disconnected. Any already confirmed Builder Bond remains recoverable when the same wallet is reconnected."
);
}

async function uploadLogo() {
const file = $("logoInput")?.files?.[0];
if (!file) return null;

const formData = new FormData();
formData.append("logo", file);

const apiBase = getApiBase();

const response = await fetch(`${apiBase}/api/upload/launch-logo`, {
method: "POST",
body: formData,
});

let data = null;

try {
data = await response.json();
} catch {
data = null;
}

if (!response.ok || !data?.ok || !data?.url) {
throw new ApiRequestError(
data?.error || "Logo upload failed.",
response.status,
data
);
}

const url = String(data.url);

if (url.startsWith("http://") || url.startsWith("https://")) {
return url;
}

return `${apiBase}${url}`;
}

async function getBuilderByWallet(wallet) {
try {
const data = await fetchJson(`/api/builders/${encodeURIComponent(wallet)}`);
return data.builder || null;
} catch (err) {
if (
Number(err?.status) === 404 ||
String(err?.message || "").includes("HTTP 404")
) {
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
const data = await fetchJson("/api/builders/create", {
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
const message = String(err?.message || "").toLowerCase();

if (message.includes("already exists") || message.includes("duplicate")) {
const existing = await getBuilderByWallet(wallet);

if (existing) return existing;
}

if (message.includes("alias is already taken")) {
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

async function ensureBuilderProfile(
wallet,
preferredAlias = "",
{ forceCreate = false } = {}
) {
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
return fetchJson("/api/launcher/create", {
method: "POST",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify(payload),
});
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

await ensureBuilderProfile(payload.wallet, payload.builder_alias, {
forceCreate: true,
});

await sleep(300);

return createLaunch(payload);
}
}

function getRefundPayloadData(payload = null) {
const source =
payload?.builderBondRefund ||
payload?.builder_bond_refund ||
payload?.bondRefund ||
payload?.bond_refund ||
payload?.refund ||
payload ||
{};

const refundedSol = toNumber(
source.refundedSol ??
source.refunded_sol ??
source.builderBondRefundedSol ??
source.builder_bond_refunded_sol ??
source.builderBondRefundSol ??
source.builder_bond_refund_sol ??
source.refundSol ??
source.refund_sol,
0
);

const refundConfirmed = Boolean(
refundedSol > 0 ||
toBoolean(
source.builderBondRefunded ??
source.builder_bond_refunded ??
source.refundConfirmed ??
source.refund_confirmed ??
source.refunded
) ||
String(source.refundStatus ?? source.refund_status ?? "")
.trim()
.toLowerCase() === "refunded"
);

const refundQueued = toBoolean(
source.refundQueued ??
source.refund_queued ??
source.builderBondRefundQueued ??
source.builder_bond_refund_queued ??
source.queued
);

const refundReviewRequired = toBoolean(
source.refundReviewRequired ??
source.refund_review_required ??
source.builderBondRefundReviewRequired ??
source.builder_bond_refund_review_required ??
source.reviewRequired ??
source.review_required
);

const refundStatus = String(
source.refundStatus ??
source.refund_status ??
source.builderBondRefundStatus ??
source.builder_bond_refund_status ??
""
).trim();

const refundTxSignature = String(
source.refundTxSignature ??
source.refund_tx_signature ??
source.builderBondRefundTxSignature ??
source.builder_bond_refund_tx_signature ??
""
).trim();

const refundError = String(
source.refundError ??
source.refund_error ??
source.builderBondRefundError ??
source.builder_bond_refund_error ??
""
).trim();

const refundLedgerId =
source.refundLedgerId ??
source.refund_ledger_id ??
source.builderBondRefundLedgerId ??
source.builder_bond_refund_ledger_id ??
null;

const refundProgramReference = String(
source.refundProgramReference ??
source.refund_program_reference ??
source.builderBondRefundProgramReference ??
source.builder_bond_refund_program_reference ??
""
).trim();

const escrowModel = String(
source.escrowModel ??
source.escrow_model ??
source.builderBondEscrowModel ??
source.builder_bond_escrow_model ??
""
).trim();

const normalizedRefundStatus = refundStatus.toLowerCase();

return {
refundedSol,
refundConfirmed,
refundQueued,
refundReviewRequired:
refundReviewRequired ||
normalizedRefundStatus === "review_required" ||
normalizedRefundStatus === "pending_review",
refundStatus,
refundTxSignature,
refundError,
refundLedgerId,
refundProgramReference,
escrowModel,
};
}

function isBlockedBuilderPayload(payload = null) {
const code = String(payload?.code || "").toLowerCase();
const message = String(payload?.error || "").toLowerCase();
const accessState = String(payload?.access_state || "").toLowerCase();

return Boolean(
payload?.internal_intervention_active ||
accessState === "blocked" ||
code.includes("builder_blocked") ||
code.includes("wallet_blocked") ||
code.includes("intervention") ||
(code.includes("builder") && code.includes("blocked")) ||
message.includes("wallet is currently unable") ||
message.includes("builder access is blocked") ||
message.includes("builder is blocked") ||
message.includes("launch creation blocked") ||
message.includes("internal intervention")
);
}

function buildBlockedBuilderOutcome(
err,
values,
confirmedBuilderBondTxSignature = ""
) {
const payload = err?.payload || null;

if (!isBlockedBuilderPayload(payload)) {
return null;
}

const cachedSignature = getCachedBuilderBondSignature(values);

const bondWasTransferred = Boolean(
String(confirmedBuilderBondTxSignature || "").trim() || cachedSignature
);

const refund = getRefundPayloadData(payload);
const bondAmount = Number(values?.builderBond || 0);

if (!bondWasTransferred) {
return {
kind: "bad",
message:
payload?.error ||
"This wallet is currently unable to create launches. No Builder Bond transfer was made.",
};
}

if (refund.refundConfirmed) {
clearBuilderBondCache({ forgetConfirmed: true });

const refundedAmount =
refund.refundedSol > 0 ? refund.refundedSol : bondAmount;

return {
kind: "warn",
message: `Launch creation was blocked before activation. Your ${formatSol(
refundedAmount,
3
)} Builder Bond has been refunded${
refund.refundTxSignature
? `. Refund transaction: ${refund.refundTxSignature}`
: "."
}`,
};
}

if (refund.refundQueued) {
clearBuilderBondCache({ forgetConfirmed: true });

const queueDetail = refund.refundStatus
? ` Status: ${refund.refundStatus}.`
: "";

const ledgerDetail = refund.refundLedgerId
? ` Refund reference: ${refund.refundLedgerId}.`
: "";

return {
kind: "warn",
message: `Launch creation was blocked before activation. Your ${formatSol(
bondAmount,
3
)} Builder Bond refund has been queued.${queueDetail}${ledgerDetail}`,
};
}

if (refund.refundReviewRequired) {
clearBuilderBondCache({ forgetConfirmed: true });

const referenceDetail = refund.refundProgramReference
? ` Reference: ${refund.refundProgramReference}.`
: "";

return {
kind: "warn",
message: `Launch creation was blocked after the Builder Bond was confirmed. The ${formatSol(
bondAmount,
3
)} refund requires processing or review before another launch attempt.${referenceDetail}`,
};
}

if (refund.refundError) {
return {
kind: "bad",
message: `Launch creation was blocked after the Builder Bond transaction. Automatic refund could not be confirmed: ${refund.refundError}. Contact support before retrying.`,
};
}

return {
kind: "bad",
message: `Launch creation was blocked after the ${formatSol(
bondAmount,
3
)} Builder Bond transaction. No confirmed refund status was returned. Contact support before attempting another launch.`,
};
}

function buildPostBondFailureMessage(
err,
values,
confirmedBuilderBondTxSignature = ""
) {
const cachedSignature = getCachedBuilderBondSignature(values);

const signature =
String(confirmedBuilderBondTxSignature || "").trim() || cachedSignature;

if (!signature) {
return err?.message || "Unable to create launch.";
}

return `Your Builder Bond transaction was confirmed, but launch creation did not complete: ${
err?.message || "Unknown launch creation error."
} Do not approve another Builder Bond payment. Retry with the same wallet and bond amount, or contact support if the issue continues. Transaction: ${signature}`;
}

async function collectLaunchBond(values) {
if (Number(values.builderBond) <= 0) {
return "";
}

const cachedSignature = getCachedBuilderBondSignature(values);

if (cachedSignature) {
setStatus(
"warn",
`Reusing previously confirmed ${getLaunchBondLabel().toLowerCase()} transaction. No new bond approval is required.`
);

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

const acknowledgementPayload = buildLauncherAcknowledgementPayload(values);

setStatus(
"warn",
`Preparing ${getLaunchBondLabel().toLowerCase()} approval...`
);

const prepare = await fetchJson("/api/launcher/prepare-builder-bond", {
method: "POST",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify({
wallet: values.wallet,
builderBondSol: Number(values.builderBond),
role: "builder",
acknowledgements: acknowledgementPayload,
...acknowledgementPayload,
}),
});

const transactionBase64 =
prepare.transaction || prepare.serializedTransaction || prepare.tx || "";

if (!transactionBase64) {
throw new Error(
`Prepared ${getLaunchBondLabel().toLowerCase()} transaction was not returned by the server.`
);
}

const transactionBytes = Uint8Array.from(atob(transactionBase64), (char) =>
char.charCodeAt(0)
);

const transaction = window.solanaWeb3.Transaction.from(transactionBytes);

setStatus(
"warn",
`Awaiting ${getLaunchBondLabel().toLowerCase()} wallet approval...`
);

const signedTransaction = await provider.signTransaction(transaction);

const signedBase64 = btoa(
String.fromCharCode(...signedTransaction.serialize())
);

setStatus("warn", `Confirming ${getLaunchBondLabel().toLowerCase()}...`);

const confirm = await fetchJson("/api/launcher/confirm-builder-bond", {
method: "POST",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify({
wallet: values.wallet,
builderBondSol: Number(values.builderBond),
signedTransaction: signedBase64,
role: "builder",
acknowledgements: acknowledgementPayload,
...acknowledgementPayload,
}),
});

if (!confirm.txSignature) {
throw new Error(
"Builder Bond was processed but no confirmed transaction signature was returned."
);
}

rememberConfirmedBuilderBond(values, confirm.txSignature);

return confirm.txSignature;
}

async function fetchOptionalJson(url) {
try {
const response = await fetch(url, { credentials: "include" });

if (!response.ok) return null;

return await response.json().catch(() => null);
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

async function onSubmit(event) {
event.preventDefault();
clearStatus();

const button = $("createLaunchBtn");

let values = null;
let builderBondTxSignature = "";

try {
values = getFormValues();
validateForm(values);

if (button) {
button.disabled = true;
button.textContent = "Creating Launch...";
}

await requireBuilderLaunchAccess(values.wallet);

setStatus("warn", "Preparing builder profile...");
await ensureBuilderProfile(values.wallet, values.builderAlias);

/*
Complete non-financial work before collecting the Builder Bond.
This prevents a logo upload failure from leaving a paid bond without
an attempted launch creation.
*/
setStatus("warn", "Uploading launch media...");
let finalImageUrl = values.imageUrl || "";

const uploadedLogoUrl = await uploadLogo();

if (uploadedLogoUrl) {
finalImageUrl = uploadedLogoUrl;
}

/*
Re-check immediately before the on-chain Builder Bond transaction.
A blocked wallet must not be asked to pay.
*/
await requireBuilderLaunchAccess(values.wallet);

if (Number(values.builderBond) > 0) {
builderBondTxSignature = await collectLaunchBond(values);
}

setStatus("warn", "Creating launch and recording lifecycle state...");

const launcherAcknowledgements =
buildLauncherAcknowledgementPayload(values);

const payload = {
wallet: values.wallet,
role: "builder",
template: values.template,
token_name: values.tokenName,
symbol: values.symbol,
builder_alias: values.builderAlias,
description: values.description,
image_url: finalImageUrl,
website_url: values.websiteUrl
? normalizeUrl(values.websiteUrl, "website_url")
: "",
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
launch_fee_pct: LAUNCH_FEE_PCT,
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
acknowledgements: launcherAcknowledgements,
...launcherAcknowledgements,
commercial_acknowledgements: values.commercialAcknowledgements,
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

clearBuilderBondCache({ forgetConfirmed: true });

setStatus(
"good",
`Launch created successfully. Redirecting to launch #${launch.id}...${launchBondNotice}${visibilityNotice}${mintNotice}`
);

window.setTimeout(() => {
window.location.href = `./launch-detail.html?id=${encodeURIComponent(
launch.id
)}`;
}, 700);
} catch (err) {
const safeValues = values || getFormValues();

const blockedOutcome = buildBlockedBuilderOutcome(
err,
safeValues,
builderBondTxSignature
);

if (blockedOutcome) {
setStatus(blockedOutcome.kind, blockedOutcome.message);

try {
await refreshBuilderStatus({ silent: true });
} catch {
// Keep the confirmed block/refund outcome visible.
}
} else if (
builderBondTxSignature ||
hasConfirmedBuilderBondForValues(safeValues)
) {
setStatus(
"warn",
buildPostBondFailureMessage(err, safeValues, builderBondTxSignature)
);
} else {
setStatus("bad", err?.message || "Unable to create launch.");
}
} finally {
if (button) {
button.disabled = false;
button.textContent = "Create Launch";
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
const element = $(id);

if (!element) continue;

const handler = handleTemplateLinkedChange(id);

element.addEventListener("input", handler);
element.addEventListener("change", handler);
}

const builderAliasInput = $("builderAlias");

if (builderAliasInput) {
builderAliasInput.addEventListener("input", () => {
builderAliasInput.dataset.userEdited = builderAliasInput.value.trim()
? "1"
: "0";
});
}

VISIBILITY_ADDONS.forEach((addon) => {
const checkbox = $(addon.checkboxId);

if (!checkbox) return;

const handler = () => updatePreview();

checkbox.addEventListener("change", handler);
checkbox.addEventListener("input", handler);
});

bindLauncherAcknowledgementInputs();
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
// The launch creator remains wallet-accessible if account UI is absent.
}
}

function bindWalletEvents() {
$("connectWalletBtn")?.addEventListener("click", connectWallet);
$("disconnectWalletBtn")?.addEventListener("click", disconnectWallet);

onWalletChange(async () => {
cachedBuilderBond = null;

updateWalletUi();
updatePreview();

try {
await refreshBuilderStatus({ silent: true });
} catch {
// Passive wallet refresh must not interrupt the form.
}
});
}

async function init() {
ensureLauncherAcknowledgementUi();
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
await refreshBuilderStatus({ silent: true });
} catch {
// Initial status load is non-blocking until a transaction is attempted.
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