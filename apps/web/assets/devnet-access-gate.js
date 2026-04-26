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

function safeGetStorage(key) {
try {
return window.localStorage.getItem(key);
} catch {
return null;
}
}

function safeSetStorage(key, value) {
try {
window.localStorage.setItem(key, value);
return true;
} catch {
return false;
}
}

function hasAccess() {
return safeGetStorage(STORAGE_KEY) === "granted";
}

function grantAccess() {
safeSetStorage(STORAGE_KEY, "granted");
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

const existing = document.getElementById("mssDevnetGate");
if (existing) existing.remove();

const existingStyle = document.getElementById("mssDevnetGateStyle");
if (existingStyle) existingStyle.remove();

const style = document.createElement("style");
style.id = "mssDevnetGateStyle";
style.textContent = `
.mss-devnet-gate,
.mss-devnet-gate * {
box-sizing: border-box;
}

.mss-devnet-gate {
position: fixed;
inset: 0;
z-index: 999999;
display: grid;
place-items: center;
padding: 28px;
color: #f6f8ff;
font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
background:
radial-gradient(circle at 18% 16%, rgba(39, 136, 255, 0.26), transparent 30%),
radial-gradient(circle at 86% 20%, rgba(223, 180, 86, 0.19), transparent 28%),
radial-gradient(circle at 48% 92%, rgba(72, 199, 255, 0.16), transparent 34%),
linear-gradient(135deg, #02040a 0%, #07101d 38%, #03040a 100%);
overflow: hidden;
}

.mss-devnet-gate::before {
content: "";
position: absolute;
inset: -2px;
pointer-events: none;
background:
linear-gradient(rgba(255, 255, 255, 0.032) 1px, transparent 1px),
linear-gradient(90deg, rgba(255, 255, 255, 0.024) 1px, transparent 1px);
background-size: 44px 44px;
mask-image: radial-gradient(circle at center, black 0%, transparent 74%);
opacity: 0.8;
}

.mss-devnet-gate::after {
content: "";
position: absolute;
inset: 0;
pointer-events: none;
background:
linear-gradient(90deg, transparent, rgba(108, 200, 255, 0.09), transparent),
repeating-linear-gradient(
to bottom,
rgba(255, 255, 255, 0.025) 0,
rgba(255, 255, 255, 0.025) 1px,
transparent 2px,
transparent 8px
);
mix-blend-mode: screen;
opacity: 0.5;
}

.mss-devnet-orb {
position: absolute;
width: 620px;
height: 620px;
border-radius: 50%;
filter: blur(10px);
opacity: 0.62;
pointer-events: none;
background:
radial-gradient(circle at 38% 36%, rgba(118, 216, 255, 0.22), transparent 18%),
radial-gradient(circle at 50% 50%, rgba(12, 38, 76, 0.4), transparent 54%),
radial-gradient(circle at 50% 50%, rgba(220, 181, 89, 0.12), transparent 68%);
border: 1px solid rgba(129, 200, 255, 0.08);
}

.mss-devnet-orb.one {
left: -220px;
top: -230px;
}

.mss-devnet-orb.two {
right: -240px;
bottom: -260px;
transform: rotate(28deg);
}

.mss-devnet-shell {
position: relative;
width: min(1040px, 100%);
display: grid;
grid-template-columns: minmax(0, 1.02fr) minmax(380px, 0.72fr);
gap: 22px;
z-index: 2;
}

.mss-devnet-brief,
.mss-devnet-card {
position: relative;
overflow: hidden;
border: 1px solid rgba(154, 190, 255, 0.18);
background:
linear-gradient(180deg, rgba(11, 18, 34, 0.86), rgba(5, 8, 16, 0.9)),
radial-gradient(circle at 22% 0%, rgba(70, 151, 255, 0.14), transparent 36%);
box-shadow:
0 34px 120px rgba(0, 0, 0, 0.62),
inset 0 1px 0 rgba(255, 255, 255, 0.075);
backdrop-filter: blur(24px);
}

.mss-devnet-brief {
min-height: 560px;
border-radius: 34px;
padding: 34px;
display: flex;
flex-direction: column;
justify-content: space-between;
}

.mss-devnet-card {
border-radius: 34px;
padding: 30px;
align-self: center;
}

.mss-devnet-brief::before,
.mss-devnet-card::before {
content: "";
position: absolute;
inset: 0;
pointer-events: none;
background:
linear-gradient(135deg, rgba(255, 255, 255, 0.1), transparent 22%),
radial-gradient(circle at 80% 0%, rgba(113, 209, 255, 0.13), transparent 32%);
}

.mss-devnet-brief::after,
.mss-devnet-card::after {
content: "";
position: absolute;
inset: 1px;
border-radius: inherit;
pointer-events: none;
border: 1px solid rgba(255, 255, 255, 0.035);
}

.mss-devnet-content {
position: relative;
z-index: 1;
}

.mss-devnet-topline {
display: flex;
align-items: center;
justify-content: space-between;
gap: 16px;
margin-bottom: 36px;
}

.mss-devnet-logo {
display: inline-flex;
align-items: center;
gap: 12px;
min-width: 0;
}

.mss-devnet-mark {
width: 46px;
height: 46px;
border-radius: 16px;
display: grid;
place-items: center;
color: #07101d;
font-size: 14px;
font-weight: 950;
letter-spacing: -0.06em;
background:
linear-gradient(135deg, #f1d28a 0%, #7fd7ff 100%);
box-shadow:
0 14px 34px rgba(56, 181, 255, 0.2),
0 10px 36px rgba(221, 178, 91, 0.12);
}

.mss-devnet-brand {
display: grid;
gap: 2px;
}

.mss-devnet-brand strong {
font-size: 14px;
line-height: 1;
letter-spacing: 0.08em;
text-transform: uppercase;
}

.mss-devnet-brand span {
color: rgba(238, 244, 255, 0.48);
font-size: 12px;
font-weight: 700;
}

.mss-devnet-status {
display: inline-flex;
align-items: center;
gap: 8px;
border: 1px solid rgba(127, 215, 255, 0.24);
border-radius: 999px;
padding: 8px 11px;
color: #a9ddff;
background: rgba(74, 172, 255, 0.075);
font-size: 11px;
font-weight: 900;
letter-spacing: 0.1em;
text-transform: uppercase;
white-space: nowrap;
}

.mss-devnet-status i {
width: 7px;
height: 7px;
border-radius: 999px;
background: #7dd7ff;
box-shadow: 0 0 18px rgba(125, 215, 255, 0.9);
}

.mss-devnet-kicker {
display: inline-flex;
align-items: center;
gap: 9px;
margin-bottom: 18px;
border: 1px solid rgba(219, 181, 96, 0.22);
border-radius: 999px;
padding: 8px 12px;
background: rgba(219, 181, 96, 0.075);
color: #ead49d;
font-size: 11px;
font-weight: 950;
letter-spacing: 0.13em;
text-transform: uppercase;
}

.mss-devnet-kicker::before {
content: "";
width: 7px;
height: 7px;
border-radius: 999px;
background: #e4bd6d;
box-shadow: 0 0 16px rgba(228, 189, 109, 0.72);
}

.mss-devnet-title {
margin: 0;
max-width: 660px;
font-size: clamp(38px, 5.4vw, 72px);
line-height: 0.92;
letter-spacing: -0.075em;
font-weight: 950;
}

.mss-devnet-title span {
display: block;
background: linear-gradient(135deg, #ffffff 0%, #d9e9ff 38%, #e5c173 100%);
-webkit-background-clip: text;
background-clip: text;
color: transparent;
}

.mss-devnet-subtitle {
max-width: 560px;
margin: 20px 0 0;
color: rgba(238, 244, 255, 0.68);
font-size: 15px;
line-height: 1.75;
font-weight: 650;
}

.mss-devnet-signal-grid {
display: grid;
grid-template-columns: repeat(3, 1fr);
gap: 12px;
margin-top: 34px;
}

.mss-devnet-signal {
min-height: 94px;
border-radius: 20px;
border: 1px solid rgba(154, 190, 255, 0.13);
background: rgba(255, 255, 255, 0.045);
padding: 15px;
}

.mss-devnet-signal strong {
display: block;
color: #ffffff;
font-size: 18px;
line-height: 1;
margin-bottom: 9px;
letter-spacing: -0.04em;
}

.mss-devnet-signal span {
color: rgba(238, 244, 255, 0.55);
font-size: 11px;
line-height: 1.45;
font-weight: 800;
text-transform: uppercase;
letter-spacing: 0.08em;
}

.mss-devnet-terminal {
margin-top: 24px;
border-radius: 22px;
border: 1px solid rgba(127, 215, 255, 0.15);
background: rgba(1, 5, 13, 0.56);
overflow: hidden;
}

.mss-devnet-terminal-head {
display: flex;
align-items: center;
justify-content: space-between;
gap: 12px;
padding: 12px 14px;
border-bottom: 1px solid rgba(154, 190, 255, 0.1);
color: rgba(238, 244, 255, 0.5);
font-size: 11px;
font-weight: 900;
letter-spacing: 0.12em;
text-transform: uppercase;
}

.mss-devnet-terminal-dots {
display: inline-flex;
gap: 6px;
}

.mss-devnet-terminal-dots i {
width: 7px;
height: 7px;
border-radius: 999px;
background: rgba(238, 244, 255, 0.28);
}

.mss-devnet-terminal-body {
padding: 14px;
display: grid;
gap: 10px;
color: rgba(238, 244, 255, 0.72);
font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
font-size: 12px;
line-height: 1.5;
}

.mss-devnet-terminal-body div {
display: flex;
gap: 10px;
}

.mss-devnet-terminal-body b {
color: #84dcff;
font-weight: 900;
}

.mss-devnet-terminal-body span {
color: rgba(238, 244, 255, 0.58);
}

.mss-devnet-form-head {
margin-bottom: 22px;
}

.mss-devnet-form-badge {
display: inline-flex;
align-items: center;
gap: 8px;
border-radius: 999px;
border: 1px solid rgba(125, 215, 255, 0.24);
background: rgba(75, 169, 255, 0.08);
color: #9edcff;
padding: 8px 12px;
font-size: 11px;
font-weight: 950;
letter-spacing: 0.12em;
text-transform: uppercase;
margin-bottom: 16px;
}

.mss-devnet-form-title {
margin: 0;
font-size: 34px;
line-height: 1;
letter-spacing: -0.06em;
font-weight: 950;
}

.mss-devnet-form-copy {
margin: 13px 0 0;
color: rgba(238, 244, 255, 0.62);
font-size: 14px;
line-height: 1.65;
font-weight: 650;
}

.mss-devnet-field-label {
display: block;
margin: 20px 0 8px;
color: rgba(238, 244, 255, 0.52);
font-size: 11px;
font-weight: 950;
letter-spacing: 0.12em;
text-transform: uppercase;
}

.mss-devnet-input-wrap {
position: relative;
}

.mss-devnet-input-wrap::before {
content: "";
position: absolute;
inset: -1px;
border-radius: 18px;
padding: 1px;
background: linear-gradient(135deg, rgba(125, 215, 255, 0.46), rgba(228, 189, 109, 0.34), rgba(255, 255, 255, 0.08));
-webkit-mask:
linear-gradient(#000 0 0) content-box,
linear-gradient(#000 0 0);
-webkit-mask-composite: xor;
mask-composite: exclude;
pointer-events: none;
opacity: 0.7;
}

.mss-devnet-input {
width: 100%;
height: 56px;
border: 0;
border-radius: 18px;
background: rgba(255, 255, 255, 0.065);
color: #ffffff;
outline: none;
padding: 0 16px;
font-size: 15px;
font-weight: 950;
letter-spacing: 0.07em;
text-transform: uppercase;
}

.mss-devnet-input::placeholder {
color: rgba(238, 244, 255, 0.32);
}

.mss-devnet-input:focus {
box-shadow:
0 0 0 4px rgba(125, 215, 255, 0.09),
0 18px 50px rgba(44, 158, 255, 0.12);
}

.mss-devnet-button {
width: 100%;
height: 56px;
margin-top: 13px;
border: 0;
border-radius: 18px;
cursor: pointer;
background:
linear-gradient(135deg, #f0d48c 0%, #7ed8ff 100%);
color: #06101d;
box-shadow:
0 18px 46px rgba(71, 184, 255, 0.18),
0 14px 40px rgba(224, 184, 93, 0.12);
font-size: 13px;
font-weight: 1000;
letter-spacing: 0.11em;
text-transform: uppercase;
transition:
transform 160ms ease,
filter 160ms ease,
box-shadow 160ms ease;
}

.mss-devnet-button:hover {
transform: translateY(-1px);
filter: brightness(1.06);
box-shadow:
0 22px 56px rgba(71, 184, 255, 0.24),
0 16px 44px rgba(224, 184, 93, 0.16);
}

.mss-devnet-button:active {
transform: translateY(0);
}

.mss-devnet-error {
min-height: 22px;
margin-top: 12px;
color: #ff8b8b;
font-size: 13px;
font-weight: 800;
}

.mss-devnet-error.active {
animation: mssDevnetShake 320ms ease;
}

.mss-devnet-divider {
display: flex;
align-items: center;
gap: 12px;
margin: 18px 0;
color: rgba(238, 244, 255, 0.34);
font-size: 11px;
font-weight: 900;
letter-spacing: 0.1em;
text-transform: uppercase;
}

.mss-devnet-divider::before,
.mss-devnet-divider::after {
content: "";
flex: 1;
height: 1px;
background: linear-gradient(90deg, transparent, rgba(238, 244, 255, 0.16), transparent);
}

.mss-devnet-rules {
display: grid;
gap: 9px;
margin: 0;
padding: 0;
list-style: none;
}

.mss-devnet-rules li {
display: flex;
gap: 10px;
align-items: flex-start;
color: rgba(238, 244, 255, 0.57);
font-size: 12px;
line-height: 1.5;
font-weight: 700;
}

.mss-devnet-rules li::before {
content: "";
width: 7px;
height: 7px;
margin-top: 6px;
flex: 0 0 auto;
border-radius: 999px;
background: #7ed8ff;
box-shadow: 0 0 14px rgba(126, 216, 255, 0.8);
}

.mss-devnet-foot {
margin-top: 20px;
border-top: 1px solid rgba(238, 244, 255, 0.08);
padding-top: 16px;
color: rgba(238, 244, 255, 0.42);
font-size: 11px;
line-height: 1.55;
font-weight: 750;
}

@keyframes mssDevnetShake {
0%, 100% { transform: translateX(0); }
22% { transform: translateX(-6px); }
44% { transform: translateX(6px); }
66% { transform: translateX(-4px); }
88% { transform: translateX(4px); }
}

@media (max-width: 920px) {
.mss-devnet-shell {
grid-template-columns: 1fr;
}

.mss-devnet-brief {
min-height: auto;
}

.mss-devnet-signal-grid {
grid-template-columns: 1fr;
}
}

@media (max-width: 560px) {
.mss-devnet-gate {
padding: 14px;
place-items: start center;
overflow-y: auto;
}

.mss-devnet-shell {
gap: 14px;
}

.mss-devnet-brief,
.mss-devnet-card {
border-radius: 24px;
padding: 22px;
}

.mss-devnet-topline {
align-items: flex-start;
flex-direction: column;
margin-bottom: 28px;
}

.mss-devnet-title {
font-size: 38px;
}

.mss-devnet-subtitle {
font-size: 13px;
}

.mss-devnet-form-title {
font-size: 29px;
}

.mss-devnet-terminal {
display: none;
}
}
`;

const gate = document.createElement("div");
gate.id = "mssDevnetGate";
gate.className = "mss-devnet-gate";
gate.innerHTML = `
<div class="mss-devnet-orb one"></div>
<div class="mss-devnet-orb two"></div>

<section class="mss-devnet-shell" aria-label="MSS Protocol devnet access">
<div class="mss-devnet-brief">
<div class="mss-devnet-content">
<div class="mss-devnet-topline">
<div class="mss-devnet-logo" aria-label="MSS Protocol">
<div class="mss-devnet-mark">MSS</div>
<div class="mss-devnet-brand">
<strong>MSS Protocol</strong>
<span>Security Intelligence Layer</span>
</div>
</div>

<div class="mss-devnet-status">
<i></i>
Devnet Online
</div>
</div>

<div class="mss-devnet-kicker">Controlled testing environment</div>

<h1 class="mss-devnet-title">
<span>Private devnet</span>
<span>launcher access.</span>
</h1>

<p class="mss-devnet-subtitle">
MSS Protocol devnet is a restricted testing environment for validating launcher flow,
market transition, wallet actions, and platform integrity before broader release.
</p>

<div class="mss-devnet-signal-grid" aria-label="Devnet testing focus">
<div class="mss-devnet-signal">
<strong>01</strong>
<span>Launcher flow validation</span>
</div>
<div class="mss-devnet-signal">
<strong>02</strong>
<span>Wallet and commit testing</span>
</div>
<div class="mss-devnet-signal">
<strong>03</strong>
<span>Live market transition checks</span>
</div>
</div>
</div>

<div class="mss-devnet-content">
<div class="mss-devnet-terminal" aria-hidden="true">
<div class="mss-devnet-terminal-head">
<span>MSS Devnet Monitor</span>
<span class="mss-devnet-terminal-dots"><i></i><i></i><i></i></span>
</div>
<div class="mss-devnet-terminal-body">
<div><b>cluster</b><span>solana.devnet</span></div>
<div><b>api</b><span>api.devnet.mssprotocol.com</span></div>
<div><b>mode</b><span>controlled.launcher.testing</span></div>
</div>
</div>
</div>
</div>

<div class="mss-devnet-card" role="dialog" aria-modal="true" aria-labelledby="mssDevnetGateTitle">
<div class="mss-devnet-content">
<div class="mss-devnet-form-head">
<div class="mss-devnet-form-badge">Access verification</div>

<h2 class="mss-devnet-form-title" id="mssDevnetGateTitle">
Enter access code
</h2>

<p class="mss-devnet-form-copy">
Enter the private MSS devnet code to continue into the launcher testing environment.
</p>
</div>

<label class="mss-devnet-field-label" for="mssDevnetGateInput">
Devnet access code
</label>

<div class="mss-devnet-input-wrap">
<input
class="mss-devnet-input"
id="mssDevnetGateInput"
type="text"
inputmode="text"
autocomplete="off"
spellcheck="false"
placeholder="ACCESS CODE"
aria-label="Devnet access code"
/>
</div>

<button class="mss-devnet-button" id="mssDevnetGateButton">
Enter devnet
</button>

<div class="mss-devnet-error" id="mssDevnetGateError" aria-live="polite"></div>

<div class="mss-devnet-divider">Testing rules</div>

<ul class="mss-devnet-rules">
<li>Use devnet wallets only. Do not use mainnet funds.</li>
<li>Report wallet, commit, countdown, live trading, or mobile issues.</li>
<li>Testing access can be rotated or restricted as needed.</li>
</ul>

<div class="mss-devnet-foot">
Security Intelligence for Transparent Crypto Markets.
</div>
</div>
</div>
</section>
`;

document.head.appendChild(style);
document.body.appendChild(gate);

const input = document.getElementById("mssDevnetGateInput");
const button = document.getElementById("mssDevnetGateButton");
const error = document.getElementById("mssDevnetGateError");

function submitCode() {
const code = normalizeCode(input.value);

error.classList.remove("active");
error.textContent = "";

if (ACCESS_CODES.has(code)) {
unlockPage();
grantAccess();
return;
}

error.textContent = "Invalid access code.";
error.classList.add("active");
input.value = "";
input.focus();

setTimeout(() => {
error.classList.remove("active");
}, 360);
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
