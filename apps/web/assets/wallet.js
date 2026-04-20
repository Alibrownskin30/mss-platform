const STORAGE_KEY = "mss_wallet_choice";
const listeners = new Set();
const boundProviders = new WeakMap();

let state = {
walletName: null,
publicKey: null,
provider: null,
};

let sendTransferInFlight = false;
let connectInFlightPromise = null;
let disconnectInFlightPromise = null;
let restoreInFlightPromise = null;
let walletModalPromise = null;

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

function normalizeWalletName(name) {
return String(name || "").trim().toLowerCase();
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
const normalized = normalizeWalletName(name);
return detectWallets().find((w) => normalizeWalletName(w.name) === normalized) || null;
}

function shortenWallet(wallet) {
const w = String(wallet || "").trim();
if (!w) return "—";
if (w.length <= 12) return w;
return `${w.slice(0, 4)}...${w.slice(-4)}`;
}

function setConnected(provider, walletName, publicKey) {
state = {
walletName: walletName ? normalizeWalletName(walletName) : null,
provider,
publicKey: publicKey ? String(publicKey) : null,
};

if (state.walletName) {
localStorage.setItem(STORAGE_KEY, state.walletName);
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

const alreadyBound = boundProviders.get(provider);
if (alreadyBound) return;

const normalizedWalletName = normalizeWalletName(walletName);

const handlers = {
accountChanged(publicKey) {
if (!publicKey) {
clearConnected();
return;
}
setConnected(provider, normalizedWalletName, publicKey.toString());
},
disconnect() {
clearConnected();
},
connect(...args) {
const pk =
args?.[0]?.publicKey?.toString?.() ||
args?.[0]?.toString?.() ||
provider.publicKey?.toString?.() ||
state.publicKey;

if (pk) {
setConnected(provider, normalizedWalletName, pk);
}
},
};

try {
provider.on("accountChanged", handlers.accountChanged);
} catch {
// ignore
}

try {
provider.on("disconnect", handlers.disconnect);
} catch {
// ignore
}

try {
provider.on("connect", handlers.connect);
} catch {
// ignore
}

boundProviders.set(provider, handlers);
}

function openWalletApp(wallet) {
if (!wallet?.mobileOpenUrl) {
throw new Error("No mobile app redirect is available for this wallet.");
}

window.location.href = wallet.mobileOpenUrl;
}

function buildWalletModal() {
if (walletModalPromise) {
return walletModalPromise;
}

const wallets = detectWallets();

walletModalPromise = new Promise((resolve) => {
const existing = document.getElementById("mssWalletModal");
if (existing) existing.remove();

const mobile = isMobileBrowser();

const cleanup = (value) => {
const modal = document.getElementById("mssWalletModal");
if (modal) modal.remove();
walletModalPromise = null;
resolve(value);
};

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
? "On mobile, choosing a wallet can open this page inside that wallet app browser."
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
<div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${
wallet.installed
? "rgba(53,245,163,.95)"
: mobile
? "rgba(58,160,255,.95)"
: "rgba(255,209,102,.95)"
};">
${actionLabel}
</div>
</div>
`;

btn.addEventListener("click", () => {
cleanup(wallet.name);
});

list.appendChild(btn);
});

card.querySelector("#mssWalletModalCancel")?.addEventListener("click", () => {
cleanup(null);
});

overlay.addEventListener("click", (e) => {
if (e.target === overlay) {
cleanup(null);
}
});
});

return walletModalPromise;
}

function getActiveProvider() {
return state.provider || null;
}

function assertConnectedProvider() {
const provider = getActiveProvider();
const publicKey = state.publicKey;

if (!provider || !publicKey) {
throw new Error("Connect your wallet before sending SOL.");
}

if (typeof window.solanaWeb3 === "undefined") {
throw new Error("Solana Web3 library is not available on this page.");
}

return {
provider,
publicKey,
web3: window.solanaWeb3,
};
}

function normalizeLamports(value) {
const n = Number(value);
if (!Number.isFinite(n) || n <= 0) {
throw new Error("Invalid lamports amount.");
}
return Math.round(n);
}

function getDevnetConnection(web3) {
return new web3.Connection(web3.clusterApiUrl("devnet"), {
commitment: "confirmed",
confirmTransactionInitialTimeout: 60000,
});
}

function getPreferredSendMethod(provider, walletName) {
const normalized = normalizeWalletName(walletName);

if (normalized === "backpack" && typeof provider.signAndSendTransaction === "function") {
return "signAndSendTransaction";
}

if (typeof provider.signTransaction === "function") {
return "signTransaction";
}

if (typeof provider.signAndSendTransaction === "function") {
return "signAndSendTransaction";
}

throw new Error("Connected wallet does not support transaction signing.");
}

async function sendWithPreferredMethod({
provider,
transaction,
connection,
walletName,
}) {
const method = getPreferredSendMethod(provider, walletName);

if (method === "signTransaction") {
const signed = await provider.signTransaction(transaction);
return await connection.sendRawTransaction(signed.serialize(), {
skipPreflight: false,
preflightCommitment: "confirmed",
maxRetries: 3,
});
}

const result = await provider.signAndSendTransaction(transaction, {
skipPreflight: false,
preflightCommitment: "confirmed",
maxRetries: 3,
});

if (typeof result === "string") {
return result;
}

return result?.signature || null;
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
if (connectInFlightPromise) {
return connectInFlightPromise;
}

connectInFlightPromise = (async () => {
const selectedName = normalizeWalletName(walletName || (await buildWalletModal()));
if (!selectedName) return getConnectedWallet();

if (
state.provider &&
state.publicKey &&
normalizeWalletName(state.walletName) === selectedName
) {
return getConnectedWallet();
}

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
})();

try {
return await connectInFlightPromise;
} finally {
connectInFlightPromise = null;
}
}

export async function disconnectWallet() {
if (disconnectInFlightPromise) {
return disconnectInFlightPromise;
}

disconnectInFlightPromise = (async () => {
try {
if (state.provider?.disconnect) {
await state.provider.disconnect();
}
} catch {
// ignore
}

clearConnected();
return getConnectedWallet();
})();

try {
return await disconnectInFlightPromise;
} finally {
disconnectInFlightPromise = null;
}
}

export async function restoreWalletIfTrusted() {
if (restoreInFlightPromise) {
return restoreInFlightPromise;
}

restoreInFlightPromise = (async () => {
const preferred = localStorage.getItem(STORAGE_KEY);
if (!preferred) return getConnectedWallet();

if (state.provider && state.publicKey && normalizeWalletName(state.walletName) === normalizeWalletName(preferred)) {
return getConnectedWallet();
}

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
})();

try {
return await restoreInFlightPromise;
} finally {
restoreInFlightPromise = null;
}
}

export async function sendSolTransfer({
destination,
lamports,
}) {
if (sendTransferInFlight) {
throw new Error("A wallet transfer is already awaiting approval.");
}

sendTransferInFlight = true;

try {
const { provider, publicKey, web3 } = assertConnectedProvider();

const cleanDestination = String(destination || "").trim();
if (!cleanDestination) {
throw new Error("Destination wallet is required.");
}

const amountLamports = normalizeLamports(lamports);

const fromPubkey = new web3.PublicKey(publicKey);
const toPubkey = new web3.PublicKey(cleanDestination);
const connection = getDevnetConnection(web3);

const latestBlockhash = await connection.getLatestBlockhash("confirmed");

const transaction = new web3.Transaction({
feePayer: fromPubkey,
recentBlockhash: latestBlockhash.blockhash,
});

transaction.add(
web3.SystemProgram.transfer({
fromPubkey,
toPubkey,
lamports: amountLamports,
})
);

const signature = await sendWithPreferredMethod({
provider,
transaction,
connection,
walletName: state.walletName,
});

if (!signature) {
throw new Error("Wallet did not return a transaction signature.");
}

const confirmation = await connection.confirmTransaction(
{
signature,
blockhash: latestBlockhash.blockhash,
lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
},
"confirmed"
);

if (confirmation?.value?.err) {
throw new Error("Transaction was not confirmed on devnet.");
}

return {
signature,
lamports: amountLamports,
destination: cleanDestination,
};
} finally {
sendTransferInFlight = false;
}
}