const STORAGE_KEY = "mss_wallet_choice";
const listeners = new Set();

let state = {
walletName: null,
publicKey: null,
provider: null,
};

function emitChange() {
const snapshot = getConnectedWallet();
for (const cb of listeners) {
try {
cb(snapshot);
} catch {
// ignore listener errors
}
}
}

function isMobileBrowser() {
const ua = navigator.userAgent || "";
return /Android|iPhone|iPad|iPod/i.test(ua);
}

function getCurrentUrl() {
return window.location.href;
}

function encodeUrl(url) {
return encodeURIComponent(url);
}

function getPhantomProvider() {
if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
if (window.solana?.isPhantom) return window.solana;
return null;
}

function getSolflareProvider() {
if (window.solflare?.isSolflare) return window.solflare;
if (window.solflare?.solana?.isSolflare) return window.solflare.solana;
if (window.solana?.isSolflare) return window.solana;
return null;
}

function getBackpackProvider() {
if (window.backpack?.solana) return window.backpack.solana;
if (window.xnft?.solana) return window.xnft.solana;
if (window.solana?.isBackpack) return window.solana;
return null;
}

function getPhantomBrowseUrl(targetUrl = getCurrentUrl()) {
return `https://phantom.app/ul/browse/${encodeUrl(targetUrl)}?ref=${encodeUrl(window.location.origin)}`;
}

function getSolflareBrowseUrl(targetUrl = getCurrentUrl()) {
return `https://solflare.com/ul/v1/browse/${encodeUrl(targetUrl)}?ref=${encodeUrl(window.location.origin)}`;
}

function getBackpackBrowseUrl(targetUrl = getCurrentUrl()) {
return `https://backpack.app/ul/browse?url=${encodeUrl(targetUrl)}&ref=${encodeUrl(window.location.origin)}`;
}

function detectWallets() {
const wallets = [];

const phantom = getPhantomProvider();
if (phantom) {
wallets.push({
name: "phantom",
label: "Phantom",
provider: phantom,
installed: true,
installUrl: "https://phantom.app/",
mobileOpenUrl: getPhantomBrowseUrl(),
});
}

const solflare = getSolflareProvider();
if (solflare && !wallets.some((w) => w.provider === solflare)) {
wallets.push({
name: "solflare",
label: "Solflare",
provider: solflare,
installed: true,
installUrl: "https://solflare.com/",
mobileOpenUrl: getSolflareBrowseUrl(),
});
}

const backpack = getBackpackProvider();
if (backpack && !wallets.some((w) => w.provider === backpack)) {
wallets.push({
name: "backpack",
label: "Backpack",
provider: backpack,
installed: true,
installUrl: "https://backpack.app/",
mobileOpenUrl: getBackpackBrowseUrl(),
});
}

if (!wallets.some((w) => w.name === "phantom")) {
wallets.push({
name: "phantom",
label: "Phantom",
provider: null,
installed: false,
installUrl: "https://phantom.app/",
mobileOpenUrl: getPhantomBrowseUrl(),
});
}

if (!wallets.some((w) => w.name === "solflare")) {
wallets.push({
name: "solflare",
label: "Solflare",
provider: null,
installed: false,
installUrl: "https://solflare.com/",
mobileOpenUrl: getSolflareBrowseUrl(),
});
}

if (!wallets.some((w) => w.name === "backpack")) {
wallets.push({
name: "backpack",
label: "Backpack",
provider: null,
installed: false,
installUrl: "https://backpack.app/",
mobileOpenUrl: getBackpackBrowseUrl(),
});
}

return wallets;
}

function getWalletByName(name) {
return detectWallets().find((w) => w.name === name) || null;
}

function shortenWallet(wallet) {
const w = String(wallet || "").trim();
if (!w) return "—";
if (w.length <= 12) return w;
return `${w.slice(0, 4)}...${w.slice(-4)}`;
}

function setConnected(provider, walletName, publicKey) {
state = {
walletName,
provider,
publicKey: publicKey ? String(publicKey) : null,
};

if (walletName) {
localStorage.setItem(STORAGE_KEY, walletName);
} else {
localStorage.removeItem(STORAGE_KEY);
}

emitChange();
}

function clearConnected() {
state = {
walletName: null,
publicKey: null,
provider: null,
};
localStorage.removeItem(STORAGE_KEY);
emitChange();
}

function bindProviderEvents(provider, walletName) {
if (!provider?.on) return;

try {
provider.on("accountChanged", (publicKey) => {
if (!publicKey) {
clearConnected();
return;
}
setConnected(provider, walletName, publicKey.toString());
});
} catch {
// ignore
}

try {
provider.on("disconnect", () => {
clearConnected();
});
} catch {
// ignore
}

try {
provider.on("connect", (...args) => {
const pk =
args?.[0]?.publicKey?.toString?.() ||
args?.[0]?.toString?.() ||
provider.publicKey?.toString?.() ||
state.publicKey;

if (pk) {
setConnected(provider, walletName, pk);
}
});
} catch {
// ignore
}
}

function openWalletApp(wallet) {
if (!wallet?.mobileOpenUrl) {
throw new Error("No mobile app redirect is available for this wallet.");
}

window.location.href = wallet.mobileOpenUrl;
}

function buildWalletModal() {
const wallets = detectWallets();

return new Promise((resolve) => {
const existing = document.getElementById("mssWalletModal");
if (existing) existing.remove();

const mobile = isMobileBrowser();

const overlay = document.createElement("div");
overlay.id = "mssWalletModal";
overlay.style.position = "fixed";
overlay.style.inset = "0";
overlay.style.background = "rgba(0,0,0,.55)";
overlay.style.backdropFilter = "blur(10px)";
overlay.style.zIndex = "9999";
overlay.style.display = "grid";
overlay.style.placeItems = "center";
overlay.style.padding = "18px";

const card = document.createElement("div");
card.style.width = "100%";
card.style.maxWidth = "420px";
card.style.border = "1px solid rgba(255,255,255,.10)";
card.style.borderRadius = "22px";
card.style.padding = "18px";
card.style.background = "linear-gradient(180deg, rgba(17,21,30,.96), rgba(8,10,16,.98))";
card.style.boxShadow = "0 24px 60px rgba(0,0,0,.45)";
card.innerHTML = `
<div style="font-size:20px;font-weight:800;color:rgba(255,255,255,.92);margin-bottom:8px;">Connect Wallet</div>
<div style="font-size:13px;line-height:1.55;color:rgba(255,255,255,.68);margin-bottom:14px;">
Choose a supported Solana wallet for MSS launch actions.
</div>
<div id="mssWalletModalList" style="display:grid;gap:10px;"></div>
<div style="margin-top:14px;font-size:12px;line-height:1.5;color:rgba(255,255,255,.48);">
${
mobile
? "On mobile, choosing a wallet can open this page inside that wallet app."
: "Desktop wallets usually need the browser extension installed and unlocked."
}
</div>
<button id="mssWalletModalCancel" type="button" style="margin-top:14px;width:100%;min-height:46px;border-radius:14px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:rgba(255,255,255,.92);font-weight:800;cursor:pointer;">Cancel</button>
`;

overlay.appendChild(card);
document.body.appendChild(overlay);

const list = card.querySelector("#mssWalletModalList");

wallets.forEach((wallet) => {
const actionLabel = wallet.installed
? "Connect"
: mobile
? "Open in App"
: "Install";

const subLabel = wallet.installed
? "Detected in this browser"
: mobile
? "Open this page in the wallet app browser"
: "Not detected";

const btn = document.createElement("button");
btn.type = "button";
btn.style.width = "100%";
btn.style.minHeight = "52px";
btn.style.borderRadius = "14px";
btn.style.border = "1px solid rgba(255,255,255,.12)";
btn.style.background = "rgba(255,255,255,.05)";
btn.style.color = "rgba(255,255,255,.92)";
btn.style.cursor = "pointer";
btn.style.textAlign = "left";
btn.style.padding = "12px 14px";

btn.innerHTML = `
<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;">
<div>
<div style="font-weight:800;">${wallet.label}</div>
<div style="font-size:12px;color:rgba(255,255,255,.58);margin-top:3px;">
${subLabel}
</div>
</div>
<div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${wallet.installed ? "rgba(53,245,163,.95)" : mobile ? "rgba(58,160,255,.95)" : "rgba(255,209,102,.95)"};">
${actionLabel}
</div>
</div>
`;

btn.addEventListener("click", () => {
overlay.remove();
resolve(wallet.name);
});

list.appendChild(btn);
});

card.querySelector("#mssWalletModalCancel")?.addEventListener("click", () => {
overlay.remove();
resolve(null);
});

overlay.addEventListener("click", (e) => {
if (e.target === overlay) {
overlay.remove();
resolve(null);
}
});
});
}

export function getAvailableWallets() {
return detectWallets().map((w) => ({
name: w.name,
label: w.label,
installed: !!w.installed,
mobileOpenUrl: w.mobileOpenUrl || null,
}));
}

export function getConnectedWallet() {
return {
walletName: state.walletName,
publicKey: state.publicKey,
shortPublicKey: shortenWallet(state.publicKey),
isConnected: !!state.publicKey,
};
}

export function getConnectedPublicKey() {
return state.publicKey || null;
}

export function onWalletChange(cb) {
if (typeof cb !== "function") {
return () => {};
}
listeners.add(cb);
return () => listeners.delete(cb);
}

export function getMobileWalletHelpText() {
return "No supported wallet detected in this browser. On mobile, choose a wallet to open this page inside Phantom, Solflare, or Backpack.";
}

export async function connectWallet(walletName = null) {
const selectedName = walletName || (await buildWalletModal());
if (!selectedName) return getConnectedWallet();

const wallet = getWalletByName(selectedName);
if (!wallet) {
throw new Error("Selected wallet is not available.");
}

if (!wallet.installed || !wallet.provider) {
if (isMobileBrowser()) {
openWalletApp(wallet);
return getConnectedWallet();
}
throw new Error(`${wallet.label} is not installed in this browser.`);
}

const resp = await wallet.provider.connect();
const publicKey =
resp?.publicKey?.toString?.() ||
wallet.provider?.publicKey?.toString?.() ||
null;

if (!publicKey) {
throw new Error(`${wallet.label} connected but no public key was returned.`);
}

bindProviderEvents(wallet.provider, wallet.name);
setConnected(wallet.provider, wallet.name, publicKey);

return getConnectedWallet();
}

export async function disconnectWallet() {
try {
if (state.provider?.disconnect) {
await state.provider.disconnect();
}
} catch {
// ignore
}

clearConnected();
return getConnectedWallet();
}

export async function restoreWalletIfTrusted() {
const preferred = localStorage.getItem(STORAGE_KEY);
if (!preferred) return getConnectedWallet();

const wallet = getWalletByName(preferred);
if (!wallet?.installed || !wallet.provider?.connect) {
return getConnectedWallet();
}

try {
const resp = await wallet.provider.connect({ onlyIfTrusted: true });
const publicKey =
resp?.publicKey?.toString?.() ||
wallet.provider?.publicKey?.toString?.() ||
null;

if (!publicKey) return getConnectedWallet();

bindProviderEvents(wallet.provider, wallet.name);
setConnected(wallet.provider, wallet.name, publicKey);
} catch {
// ignore
}

return getConnectedWallet();
}