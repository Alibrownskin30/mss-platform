(function () {
const DEVNET_HOSTS = new Set([
"devnet.mssprotocol.com",
"www.devnet.mssprotocol.com",
]);

const ACCESS_CODES = new Set(["MSSDEVNETSOL"]);

// v4 forces old saved access to refresh once after the MSS logo/theme upgrade.
const STORAGE_KEY = "mss_devnet_access_v4";

const MSS_LOGO_SRC = "/assets/images/mss-logo-mark.png";

const hostname = window.location.hostname.toLowerCase();

if (!DEVNET_HOSTS.has(hostname)) {
return;
}

function getLogoMarkup() {
return `
<img
src="${MSS_LOGO_SRC}"
alt=""
loading="eager"
decoding="async"
onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"
/>
<span class="mss-devnet-mark-fallback" aria-hidden="true"></span>
`;
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

const existingGate = document.getElementById("mssDevnetGate");
if (existingGate) existingGate.remove();

const existingStyle = document.getElementById("mssDevnetGateStyle");
if (existingStyle) existingStyle.remove();

const style = document.createElement("style");
style.id = "mssDevnetGateStyle";
style.textContent = `
.mss-devnet-gate,
.mss-devnet-gate *{
box-sizing:border-box;
}

.mss-devnet-gate{
position:fixed;
inset:0;
z-index:999999;
display:flex;
align-items:center;
justify-content:center;
padding:18px;
color:#f1f7ff;
font-family:Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
background:
radial-gradient(circle at 16% 14%, rgba(18,140,255,.18), transparent 32%),
radial-gradient(circle at 84% 18%, rgba(79,195,255,.13), transparent 30%),
radial-gradient(circle at 50% 92%, rgba(235,215,171,.07), transparent 34%),
linear-gradient(135deg, #02040a 0%, #050914 38%, #07101d 72%, #02040a 100%);
overflow:hidden;
}

.mss-devnet-gate::before{
content:"";
position:absolute;
inset:-2px;
pointer-events:none;
background:
linear-gradient(rgba(255,255,255,.030) 1px, transparent 1px),
linear-gradient(90deg, rgba(255,255,255,.022) 1px, transparent 1px);
background-size:44px 44px;
mask-image:radial-gradient(circle at center, black 0%, transparent 74%);
opacity:.78;
}

.mss-devnet-gate::after{
content:"";
position:absolute;
inset:0;
pointer-events:none;
background:
linear-gradient(90deg, transparent, rgba(79,195,255,.06), transparent),
repeating-linear-gradient(
to bottom,
rgba(255,255,255,.020) 0,
rgba(255,255,255,.020) 1px,
transparent 2px,
transparent 8px
);
mix-blend-mode:screen;
opacity:.42;
}

.mss-devnet-orb{
position:absolute;
width:620px;
height:620px;
border-radius:50%;
filter:blur(10px);
opacity:.52;
pointer-events:none;
background:
radial-gradient(circle at 38% 36%, rgba(79,195,255,.15), transparent 18%),
radial-gradient(circle at 50% 50%, rgba(18,140,255,.28), transparent 54%),
radial-gradient(circle at 50% 50%, rgba(235,215,171,.06), transparent 68%);
border:1px solid rgba(79,195,255,.08);
}

.mss-devnet-orb.one{
left:-230px;
top:-240px;
}

.mss-devnet-orb.two{
right:-250px;
bottom:-270px;
transform:rotate(28deg);
}

.mss-devnet-shell{
position:relative;
z-index:2;
width:min(1180px, 100%);
height:min(730px, calc(100dvh - 36px));
max-height:calc(100dvh - 36px);
display:grid;
grid-template-columns:minmax(0, 1.08fr) minmax(390px, .82fr);
gap:20px;
align-items:stretch;
}

.mss-devnet-panel{
position:relative;
min-width:0;
height:100%;
overflow:hidden;
border:1px solid rgba(115,185,255,.16);
border-radius:30px;
background:
linear-gradient(180deg, rgba(8,14,24,.90), rgba(3,7,15,.95)),
radial-gradient(circle at 22% 0%, rgba(18,140,255,.12), transparent 36%),
radial-gradient(circle at 88% 0%, rgba(235,215,171,.045), transparent 34%);
box-shadow:
0 34px 120px rgba(0,0,0,.64),
0 0 42px rgba(18,140,255,.08),
inset 0 1px 0 rgba(255,255,255,.075);
backdrop-filter:blur(24px);
-webkit-backdrop-filter:blur(24px);
}

.mss-devnet-panel::before{
content:"";
position:absolute;
inset:0;
pointer-events:none;
background:
linear-gradient(135deg, rgba(255,255,255,.09), transparent 22%),
radial-gradient(circle at 80% 0%, rgba(79,195,255,.11), transparent 32%);
}

.mss-devnet-panel::after{
content:"";
position:absolute;
inset:1px;
border-radius:inherit;
pointer-events:none;
border:1px solid rgba(255,255,255,.035);
}

.mss-devnet-panel-inner{
position:relative;
z-index:1;
height:100%;
padding:28px;
display:flex;
flex-direction:column;
min-height:0;
}

.mss-devnet-hero-inner{
justify-content:space-between;
}

.mss-devnet-form-inner{
justify-content:center;
}

.mss-devnet-topline{
display:flex;
align-items:flex-start;
justify-content:space-between;
gap:14px;
margin-bottom:22px;
}

.mss-devnet-logo{
display:inline-flex;
align-items:center;
gap:12px;
min-width:0;
}

.mss-devnet-mark{
width:52px;
height:52px;
border-radius:16px;
position:relative;
display:grid;
place-items:center;
flex:0 0 auto;
overflow:hidden;
background:
radial-gradient(circle at 50% 28%, rgba(79,195,255,.20), transparent 44%),
radial-gradient(circle at 80% 84%, rgba(235,215,171,.08), transparent 46%),
linear-gradient(135deg, rgba(17,24,39,.98), rgba(3,7,15,.98));
border:1px solid rgba(79,195,255,.25);
box-shadow:
0 0 0 1px rgba(235,215,171,.04),
0 0 24px rgba(18,140,255,.18),
0 0 34px rgba(79,195,255,.08),
inset 0 1px 0 rgba(255,255,255,.08);
}

.mss-devnet-mark::before{
content:"";
position:absolute;
inset:0;
pointer-events:none;
background:
linear-gradient(180deg, rgba(255,255,255,.08), transparent 38%),
radial-gradient(circle at 50% 0%, rgba(255,255,255,.08), transparent 48%);
}

.mss-devnet-mark img{
width:38px;
height:38px;
display:block;
position:relative;
z-index:2;
object-fit:contain;
filter:
drop-shadow(0 0 10px rgba(18,140,255,.42))
drop-shadow(0 0 18px rgba(99,220,255,.18));
}

.mss-devnet-mark-fallback{
display:none;
width:30px;
height:30px;
position:relative;
z-index:2;
border-radius:8px;
background:
linear-gradient(180deg, rgba(241,247,255,.96), rgba(200,214,230,.88) 44%, rgba(79,195,255,.86) 72%, rgba(18,140,255,.92));
clip-path:polygon(18% 18%, 82% 18%, 82% 30%, 58% 30%, 58% 82%, 42% 82%, 42% 30%, 18% 30%);
box-shadow:
0 0 12px rgba(79,195,255,.22),
0 0 18px rgba(235,215,171,.08);
}

.mss-devnet-brand{
display:grid;
gap:3px;
}

.mss-devnet-brand strong{
color:#ffffff;
font-size:14px;
line-height:1;
letter-spacing:.09em;
text-transform:uppercase;
}

.mss-devnet-brand span{
color:rgba(198,211,226,.58);
font-size:12px;
font-weight:750;
}

.mss-devnet-status{
display:inline-flex;
align-items:center;
gap:8px;
border:1px solid rgba(79,195,255,.22);
border-radius:999px;
padding:8px 11px;
color:#9fe4ff;
background:rgba(79,195,255,.08);
font-size:11px;
font-weight:950;
letter-spacing:.10em;
text-transform:uppercase;
white-space:nowrap;
}

.mss-devnet-status i{
width:7px;
height:7px;
border-radius:999px;
background:linear-gradient(135deg, #4fc3ff, #ebd7ab);
box-shadow:
0 0 16px rgba(79,195,255,.72),
0 0 20px rgba(235,215,171,.14);
}

.mss-devnet-kicker,
.mss-devnet-form-badge{
display:inline-flex;
width:fit-content;
align-items:center;
gap:9px;
border:1px solid rgba(79,195,255,.22);
border-radius:999px;
padding:8px 12px;
background:rgba(79,195,255,.075);
color:#b9e7ef;
font-size:11px;
font-weight:950;
letter-spacing:.13em;
text-transform:uppercase;
}

.mss-devnet-kicker{
margin-bottom:16px;
}

.mss-devnet-form-badge{
margin-bottom:16px;
}

.mss-devnet-kicker::before{
content:"";
width:7px;
height:7px;
border-radius:999px;
background:linear-gradient(135deg, #4fc3ff, #ebd7ab);
box-shadow:
0 0 16px rgba(79,195,255,.72),
0 0 20px rgba(235,215,171,.14);
}

.mss-devnet-title{
margin:0;
max-width:660px;
font-size:clamp(40px, 4.6vw, 66px);
line-height:.93;
letter-spacing:-.075em;
font-weight:950;
}

.mss-devnet-title span{
display:block;
background:linear-gradient(135deg, #ffffff 0%, #d9e9ff 34%, #4fc3ff 70%, #ebd7ab 100%);
-webkit-background-clip:text;
background-clip:text;
color:transparent;
}

.mss-devnet-subtitle{
max-width:610px;
margin:18px 0 0;
color:rgba(198,211,226,.72);
font-size:clamp(13px, 1.2vw, 15px);
line-height:1.7;
font-weight:650;
}

.mss-devnet-signal-grid{
display:grid;
grid-template-columns:repeat(3, 1fr);
gap:12px;
margin-top:24px;
}

.mss-devnet-signal{
min-height:96px;
border-radius:20px;
border:1px solid rgba(115,185,255,.13);
background:rgba(255,255,255,.04);
padding:15px;
display:flex;
flex-direction:column;
justify-content:space-between;
}

.mss-devnet-signal strong{
display:block;
color:#ffffff;
font-size:18px;
line-height:1;
letter-spacing:-.04em;
}

.mss-devnet-signal span{
color:rgba(198,211,226,.62);
font-size:10.5px;
line-height:1.42;
font-weight:900;
text-transform:uppercase;
letter-spacing:.08em;
}

.mss-devnet-terminal{
margin-top:18px;
border-radius:20px;
border:1px solid rgba(115,185,255,.14);
background:rgba(1,5,13,.56);
overflow:hidden;
}

.mss-devnet-terminal-head{
display:flex;
align-items:center;
justify-content:space-between;
gap:12px;
padding:11px 13px;
border-bottom:1px solid rgba(115,185,255,.10);
color:rgba(198,211,226,.58);
font-size:10.5px;
font-weight:950;
letter-spacing:.12em;
text-transform:uppercase;
}

.mss-devnet-terminal-dots{
display:inline-flex;
gap:6px;
}

.mss-devnet-terminal-dots i{
width:7px;
height:7px;
border-radius:999px;
background:rgba(79,195,255,.38);
}

.mss-devnet-terminal-body{
padding:13px;
display:grid;
gap:8px;
color:rgba(198,211,226,.74);
font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
font-size:11.5px;
line-height:1.45;
}

.mss-devnet-terminal-body div{
display:flex;
gap:10px;
}

.mss-devnet-terminal-body b{
min-width:58px;
color:#9fe4ff;
font-weight:900;
}

.mss-devnet-terminal-body span{
color:rgba(198,211,226,.60);
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
}

.mss-devnet-form-title{
margin:0;
font-size:clamp(30px, 2.8vw, 40px);
line-height:1;
letter-spacing:-.06em;
font-weight:950;
}

.mss-devnet-form-copy{
margin:13px 0 0;
color:rgba(198,211,226,.68);
font-size:14px;
line-height:1.58;
font-weight:650;
}

.mss-devnet-field-label{
display:block;
margin:22px 0 8px;
color:rgba(198,211,226,.56);
font-size:11px;
font-weight:950;
letter-spacing:.12em;
text-transform:uppercase;
}

.mss-devnet-input-wrap{
position:relative;
}

.mss-devnet-input-wrap::before{
content:"";
position:absolute;
inset:-1px;
border-radius:18px;
padding:1px;
background:linear-gradient(135deg, rgba(79,195,255,.44), rgba(18,140,255,.34), rgba(235,215,171,.16));
-webkit-mask:
linear-gradient(#000 0 0) content-box,
linear-gradient(#000 0 0);
-webkit-mask-composite:xor;
mask-composite:exclude;
pointer-events:none;
opacity:.78;
}

.mss-devnet-input{
width:100%;
height:56px;
border:0;
border-radius:18px;
background:rgba(255,255,255,.065);
color:#ffffff;
outline:none;
padding:0 16px;
font-size:15px;
font-weight:950;
letter-spacing:.07em;
text-transform:uppercase;
}

.mss-devnet-input::placeholder{
color:rgba(198,211,226,.34);
}

.mss-devnet-input:focus{
box-shadow:
0 0 0 4px rgba(79,195,255,.10),
0 18px 50px rgba(18,140,255,.12);
}

.mss-devnet-button{
width:100%;
height:56px;
margin-top:13px;
border:0;
border-radius:18px;
cursor:pointer;
background:linear-gradient(135deg, #4fc3ff 0%, #128cff 52%, #ebd7ab 100%);
color:#020814;
box-shadow:
0 18px 46px rgba(18,140,255,.22),
0 14px 40px rgba(0,0,0,.20);
font-size:13px;
font-weight:1000;
letter-spacing:.11em;
text-transform:uppercase;
transition:
transform 160ms ease,
filter 160ms ease,
box-shadow 160ms ease;
}

.mss-devnet-button:hover{
transform:translateY(-1px);
filter:brightness(1.06);
box-shadow:
0 22px 56px rgba(18,140,255,.26),
0 16px 44px rgba(0,0,0,.20);
}

.mss-devnet-error{
min-height:22px;
margin-top:12px;
color:#ff8b8b;
font-size:13px;
font-weight:800;
}

.mss-devnet-error.active{
animation:mssDevnetShake 320ms ease;
}

.mss-devnet-divider{
display:flex;
align-items:center;
gap:12px;
margin:16px 0;
color:rgba(198,211,226,.40);
font-size:11px;
font-weight:950;
letter-spacing:.10em;
text-transform:uppercase;
}

.mss-devnet-divider::before,
.mss-devnet-divider::after{
content:"";
flex:1;
height:1px;
background:linear-gradient(90deg, transparent, rgba(79,195,255,.18), transparent);
}

.mss-devnet-rules{
display:grid;
gap:9px;
margin:0;
padding:0;
list-style:none;
}

.mss-devnet-rules li{
display:flex;
gap:10px;
align-items:flex-start;
color:rgba(198,211,226,.64);
font-size:12px;
line-height:1.48;
font-weight:700;
}

.mss-devnet-rules li::before{
content:"";
width:7px;
height:7px;
margin-top:6px;
flex:0 0 auto;
border-radius:999px;
background:linear-gradient(135deg, #4fc3ff, #ebd7ab);
box-shadow:
0 0 14px rgba(79,195,255,.62),
0 0 18px rgba(235,215,171,.12);
}

.mss-devnet-foot{
margin-top:18px;
border-top:1px solid rgba(198,211,226,.10);
padding-top:15px;
color:rgba(198,211,226,.46);
font-size:11px;
line-height:1.5;
font-weight:750;
}

@keyframes mssDevnetShake{
0%, 100%{ transform:translateX(0); }
22%{ transform:translateX(-6px); }
44%{ transform:translateX(6px); }
66%{ transform:translateX(-4px); }
88%{ transform:translateX(4px); }
}

@media (max-height:720px) and (min-width:981px){
.mss-devnet-shell{
height:calc(100dvh - 28px);
max-height:calc(100dvh - 28px);
}

.mss-devnet-panel-inner{
padding:22px;
}

.mss-devnet-topline{
margin-bottom:15px;
}

.mss-devnet-title{
font-size:clamp(34px, 4.1vw, 54px);
}

.mss-devnet-subtitle{
margin-top:13px;
line-height:1.55;
}

.mss-devnet-signal-grid{
margin-top:18px;
}

.mss-devnet-signal{
min-height:82px;
padding:12px;
}

.mss-devnet-terminal{
margin-top:14px;
}

.mss-devnet-input,
.mss-devnet-button{
height:50px;
}

.mss-devnet-field-label{
margin-top:16px;
}

.mss-devnet-divider{
margin:12px 0;
}

.mss-devnet-foot{
margin-top:12px;
padding-top:12px;
}
}

@media (max-width:980px){
.mss-devnet-gate{
align-items:flex-start;
justify-content:flex-start;
overflow-y:auto;
padding:16px;
min-height:100dvh;
}

.mss-devnet-shell{
width:100%;
height:auto;
max-height:none;
grid-template-columns:1fr;
gap:16px;
}

.mss-devnet-panel{
height:auto;
border-radius:26px;
}

.mss-devnet-panel-inner{
height:auto;
padding:24px;
}

.mss-devnet-form-inner{
justify-content:flex-start;
}

.mss-devnet-topline{
flex-direction:column;
align-items:flex-start;
margin-bottom:26px;
}

.mss-devnet-title{
max-width:none;
font-size:56px;
}

.mss-devnet-subtitle{
font-size:16px;
}

.mss-devnet-signal-grid{
grid-template-columns:1fr;
margin-top:24px;
}

.mss-devnet-terminal{
display:none;
}
}

@media (max-width:560px){
.mss-devnet-gate{
padding:12px;
}

.mss-devnet-panel{
border-radius:24px;
}

.mss-devnet-panel-inner{
padding:22px;
}

.mss-devnet-mark{
width:56px;
height:56px;
border-radius:16px;
}

.mss-devnet-mark img{
width:40px;
height:40px;
}

.mss-devnet-brand strong{
font-size:13px;
}

.mss-devnet-brand span{
font-size:12px;
}

.mss-devnet-title{
font-size:42px;
line-height:.98;
}

.mss-devnet-subtitle{
font-size:14px;
margin-top:14px;
}

.mss-devnet-signal{
min-height:94px;
padding:16px;
}

.mss-devnet-form-title{
font-size:31px;
}

.mss-devnet-input,
.mss-devnet-button{
height:54px;
border-radius:16px;
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
<div class="mss-devnet-panel">
<div class="mss-devnet-panel-inner mss-devnet-hero-inner">
<div>
<div class="mss-devnet-topline">
<div class="mss-devnet-logo" aria-label="MSS Protocol">
<div class="mss-devnet-mark">${getLogoMarkup()}</div>
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

<h1 class="mss-devnet-title" id="mssDevnetGateTitle">
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

<div class="mss-devnet-terminal" aria-hidden="true">
<div class="mss-devnet-terminal-head">
<span>MSS Devnet Monitor</span>
<span class="mss-devnet-terminal-dots"><i></i><i></i><i></i></span>
</div>
<div class="mss-devnet-terminal-body">
<div><b>cluster</b><span>solana.devnet</span></div>
<div><b>access</b><span>private.testing.environment</span></div>
<div><b>mode</b><span>controlled.launcher.validation</span></div>
</div>
</div>
</div>
</div>

<div class="mss-devnet-panel mss-devnet-form-card" role="dialog" aria-modal="true" aria-labelledby="mssDevnetGateTitle">
<div class="mss-devnet-panel-inner mss-devnet-form-inner">
<div>
<div class="mss-devnet-form-badge">Access verification</div>

<h2 class="mss-devnet-form-title">
Enter access code
</h2>

<p class="mss-devnet-form-copy">
Enter the private MSS devnet code to continue into the launcher testing environment.
</p>

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

setTimeout(() => {
input.focus();
}, 100);
}

if (document.readyState === "loading") {
document.addEventListener("DOMContentLoaded", renderGate, { once: true });
} else {
renderGate();
}
})();
