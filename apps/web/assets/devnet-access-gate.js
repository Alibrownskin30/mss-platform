(function () {
const DEVNET_HOSTS = new Set([
"devnet.mssprotocol.com",
"www.devnet.mssprotocol.com",
]);

const ACCESS_CODES = new Set(["MSSDEVNETSOL"]);

const STORAGE_KEY = "mss_devnet_access_v1";

const hostname = window.location.hostname.toLowerCase();

if (!DEVNET_HOSTS.has(hostname)) {
return;
}

function normalizeCode(value) {
return String(value || "")
.trim()
.toUpperCase()
.replace(/\s+/g, "");
}

function hasAccess() {
return localStorage.getItem(STORAGE_KEY) === "granted";
}

function grantAccess() {
localStorage.setItem(STORAGE_KEY, "granted");
window.location.reload();
}

if (hasAccess()) {
return;
}

function lockPage() {
document.documentElement.style.overflow = "hidden";
document.body.style.overflow = "hidden";
}

function unlockPage() {
document.documentElement.style.overflow = "";
document.body.style.overflow = "";
}

function renderGate() {
lockPage();

const style = document.createElement("style");
style.textContent = `
.mss-devnet-gate {
position: fixed;
inset: 0;
z-index: 999999;
display: flex;
align-items: center;
justify-content: center;
padding: 24px;
background:
radial-gradient(circle at 18% 18%, rgba(50, 170, 255, 0.18), transparent 34%),
radial-gradient(circle at 82% 82%, rgba(222, 184, 92, 0.16), transparent 34%),
linear-gradient(135deg, #04060d 0%, #09111f 48%, #020308 100%);
color: #f4f7fb;
font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.mss-devnet-gate::before {
content: "";
position: absolute;
inset: 0;
pointer-events: none;
background:
linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
background-size: 42px 42px;
mask-image: radial-gradient(circle at center, black 0%, transparent 72%);
}

.mss-devnet-gate-card {
position: relative;
width: min(460px, 100%);
border: 1px solid rgba(150, 185, 255, 0.22);
background: rgba(7, 12, 24, 0.9);
box-shadow:
0 24px 90px rgba(0, 0, 0, 0.6),
inset 0 1px 0 rgba(255, 255, 255, 0.06);
backdrop-filter: blur(22px);
border-radius: 26px;
padding: 30px;
overflow: hidden;
}

.mss-devnet-gate-card::before {
content: "";
position: absolute;
inset: 0;
pointer-events: none;
background:
linear-gradient(135deg, rgba(255,255,255,0.08), transparent 26%),
radial-gradient(circle at 80% 0%, rgba(125, 205, 255, 0.12), transparent 34%);
}

.mss-devnet-gate-content {
position: relative;
z-index: 1;
}

.mss-devnet-gate-badge {
display: inline-flex;
align-items: center;
gap: 8px;
padding: 7px 11px;
border-radius: 999px;
border: 1px solid rgba(92, 190, 255, 0.28);
background: rgba(70, 154, 255, 0.08);
color: #9fd7ff;
font-size: 12px;
font-weight: 800;
letter-spacing: 0.12em;
text-transform: uppercase;
margin-bottom: 18px;
}

.mss-devnet-gate-title {
margin: 0;
font-size: 31px;
line-height: 1.05;
letter-spacing: -0.045em;
font-weight: 850;
}

.mss-devnet-gate-copy {
margin: 14px 0 22px;
color: rgba(244, 247, 251, 0.72);
font-size: 14px;
line-height: 1.6;
}

.mss-devnet-gate-input {
width: 100%;
height: 52px;
box-sizing: border-box;
border-radius: 15px;
border: 1px solid rgba(180, 205, 255, 0.18);
background: rgba(255, 255, 255, 0.055);
color: #ffffff;
outline: none;
padding: 0 15px;
font-size: 15px;
font-weight: 800;
letter-spacing: 0.045em;
text-transform: uppercase;
}

.mss-devnet-gate-input::placeholder {
color: rgba(244, 247, 251, 0.36);
}

.mss-devnet-gate-input:focus {
border-color: rgba(87, 190, 255, 0.72);
box-shadow: 0 0 0 4px rgba(87, 190, 255, 0.11);
}

.mss-devnet-gate-button {
width: 100%;
height: 52px;
margin-top: 12px;
border: 0;
border-radius: 15px;
cursor: pointer;
background: linear-gradient(135deg, #d9b86c, #8ad8ff);
color: #07101d;
font-size: 14px;
font-weight: 950;
letter-spacing: 0.08em;
text-transform: uppercase;
transition: transform 160ms ease, filter 160ms ease;
}

.mss-devnet-gate-button:hover {
transform: translateY(-1px);
filter: brightness(1.05);
}

.mss-devnet-gate-error {
min-height: 20px;
margin-top: 12px;
color: #ff7d7d;
font-size: 13px;
font-weight: 750;
}

.mss-devnet-gate-note {
margin-top: 18px;
color: rgba(244, 247, 251, 0.46);
font-size: 12px;
line-height: 1.5;
}

@media (max-width: 520px) {
.mss-devnet-gate {
padding: 16px;
align-items: stretch;
}

.mss-devnet-gate-card {
margin: auto 0;
padding: 24px;
border-radius: 22px;
}

.mss-devnet-gate-title {
font-size: 27px;
}
}
`;

const gate = document.createElement("div");
gate.className = "mss-devnet-gate";
gate.innerHTML = `
<div class="mss-devnet-gate-card" role="dialog" aria-modal="true" aria-labelledby="mssDevnetGateTitle">
<div class="mss-devnet-gate-content">
<div class="mss-devnet-gate-badge">MSS Devnet Access</div>

<h1 class="mss-devnet-gate-title" id="mssDevnetGateTitle">
Private devnet testing
</h1>

<p class="mss-devnet-gate-copy">
Enter the access code provided by MSS Protocol to continue into the devnet launcher.
</p>

<input
class="mss-devnet-gate-input"
id="mssDevnetGateInput"
type="text"
inputmode="text"
autocomplete="off"
spellcheck="false"
placeholder="ACCESS CODE"
aria-label="Devnet access code"
/>

<button class="mss-devnet-gate-button" id="mssDevnetGateButton">
Enter devnet
</button>

<div class="mss-devnet-gate-error" id="mssDevnetGateError" aria-live="polite"></div>

<div class="mss-devnet-gate-note">
Devnet is for controlled testing only. Do not use mainnet funds.
</div>
</div>
</div>
`;

document.head.appendChild(style);
document.body.appendChild(gate);

const input = document.getElementById("mssDevnetGateInput");
const button = document.getElementById("mssDevnetGateButton");
const error = document.getElementById("mssDevnetGateError");

function submitCode() {
const code = normalizeCode(input.value);

if (ACCESS_CODES.has(code)) {
unlockPage();
grantAccess();
return;
}

error.textContent = "Invalid access code.";
input.value = "";
input.focus();
}

button.addEventListener("click", submitCode);

input.addEventListener("keydown", (event) => {
if (event.key === "Enter") {
submitCode();
}
});

setTimeout(() => input.focus(), 100);
}

if (document.readyState === "loading") {
document.addEventListener("DOMContentLoaded", renderGate, { once: true });
} else {
renderGate();
}
})();
