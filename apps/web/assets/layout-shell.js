const NAV_ITEMS = [
{ key: "home", label: "Home", href: "./index.html" },
{ key: "scanner", label: "Scanner", href: "./token.html" },
{ key: "launchpad", label: "Launchpad", href: "./launchpad.html" },
{ key: "explore", label: "Explore", href: "./explore.html" },
{ key: "alerts", label: "Alerts", href: "./alerts.html" },
{ key: "methodology", label: "Methodology", href: "./methodology.html" },
{ key: "legal", label: "Legal", href: "./legal.html" },
];

const X_URL = "https://x.com/MssProtocol";
const TG_URL = "https://t.me/mssprotocol";

function ensureStyles() {
if (document.getElementById("mss-shell-styles")) return;

const style = document.createElement("style");
style.id = "mss-shell-styles";
style.textContent = `
.mss-shell-header{
position:sticky;
top:0;
z-index:1000;
backdrop-filter:blur(18px);
-webkit-backdrop-filter:blur(18px);
background:
radial-gradient(900px 160px at 0% 0%, rgba(244,222,154,.06), transparent 40%),
radial-gradient(720px 140px at 100% 0%, rgba(182,190,203,.05), transparent 42%),
linear-gradient(180deg, rgba(7,8,12,.94), rgba(7,8,12,.78));
border-bottom:1px solid rgba(255,255,255,.06);
box-shadow:
0 16px 40px rgba(0,0,0,.24),
inset 0 -1px 0 rgba(255,255,255,.02);
overflow:hidden;
}

.mss-shell-header::before{
content:"";
position:absolute;
inset:0 0 auto 0;
height:1px;
background:linear-gradient(90deg, rgba(255,255,255,0), rgba(244,222,154,.30), rgba(182,190,203,.18), rgba(255,255,255,0));
opacity:.95;
pointer-events:none;
}

.mss-shell-header::after{
content:"";
position:absolute;
inset:0;
pointer-events:none;
background:
linear-gradient(180deg, rgba(255,255,255,.03), transparent 28%);
opacity:.9;
}

.mss-shell-wrap{
width:min(var(--max, 1320px), calc(100% - 32px));
margin:0 auto;
max-width:100%;
min-width:0;
position:relative;
z-index:1;
}

.mss-shell-topbar{
display:grid;
grid-template-columns:minmax(210px, 280px) minmax(0,1fr) auto;
align-items:center;
gap:16px;
padding:14px 0;
max-width:100%;
min-width:0;
}

.mss-shell-brand{
display:flex;
align-items:center;
gap:12px;
min-width:0;
max-width:100%;
color:inherit;
text-decoration:none;
}

.mss-shell-mark{
width:40px;
height:40px;
border-radius:12px;
position:relative;
display:grid;
place-items:center;
flex:0 0 auto;
overflow:hidden;
background:
radial-gradient(circle at 30% 24%, rgba(255,255,255,.18), transparent 36%),
linear-gradient(135deg, rgba(28,32,38,.98), rgba(12,14,18,.98));
border:1px solid rgba(244,222,154,.20);
box-shadow:
0 0 0 1px rgba(244,222,154,.03),
0 0 24px rgba(220,185,106,.08),
inset 0 1px 0 rgba(255,255,255,.07);
}

.mss-shell-mark::before{
content:"";
position:absolute;
inset:0;
pointer-events:none;
background:linear-gradient(180deg, rgba(255,255,255,.06), transparent 38%);
}

.mss-shell-mark svg{
width:24px;
height:24px;
display:block;
position:relative;
z-index:1;
filter:drop-shadow(0 0 12px rgba(244,222,154,.16));
}

.mss-shell-brand-copy{
min-width:0;
max-width:100%;
}

.mss-shell-brand-title{
display:block;
font-size:13px;
font-weight:900;
letter-spacing:.16em;
text-transform:uppercase;
line-height:1.1;
white-space:nowrap;
overflow:hidden;
text-overflow:ellipsis;
color:#eef3fb;
}

.mss-shell-brand-sub{
display:block;
margin-top:3px;
font-size:11px;
color:rgba(238,243,251,.44);
letter-spacing:.12em;
text-transform:uppercase;
line-height:1.2;
white-space:nowrap;
overflow:hidden;
text-overflow:ellipsis;
max-width:100%;
}

.mss-shell-navwrap{
min-width:0;
max-width:100%;
overflow:hidden;
}

.mss-shell-nav{
display:flex;
align-items:center;
justify-content:center;
gap:8px;
flex-wrap:nowrap;
min-width:0;
max-width:100%;
overflow-x:auto;
overflow-y:hidden;
padding-bottom:2px;
scrollbar-width:none;
-webkit-overflow-scrolling:touch;
}

.mss-shell-nav::-webkit-scrollbar{
display:none;
}

.mss-shell-navlink{
display:inline-flex;
align-items:center;
justify-content:center;
gap:8px;
min-height:40px;
padding:0 11px;
border-radius:12px;
color:rgba(255,255,255,.76);
border:1px solid transparent;
font-size:11px;
font-weight:800;
letter-spacing:.11em;
text-transform:uppercase;
white-space:nowrap;
transition:.18s ease;
text-decoration:none;
flex:0 0 auto;
}

.mss-shell-navlink:hover{
color:#fff;
border-color:rgba(255,255,255,.10);
background:rgba(255,255,255,.04);
}

.mss-shell-navlink.active{
color:#fff;
border-color:rgba(244,222,154,.20);
background:linear-gradient(180deg, rgba(220,185,106,.10), rgba(220,185,106,.04));
box-shadow:0 0 16px rgba(244,222,154,.06);
}

.mss-shell-auth{
display:flex;
align-items:center;
justify-content:flex-end;
gap:10px;
flex-wrap:nowrap;
min-width:0;
}

.mss-shell-social{
display:flex;
align-items:center;
gap:10px;
flex-wrap:nowrap;
flex:0 0 auto;
}

.mss-shell-icon{
width:40px;
height:40px;
border-radius:12px;
display:inline-flex;
align-items:center;
justify-content:center;
border:1px solid rgba(255,255,255,.10);
background:rgba(255,255,255,.04);
color:rgba(255,255,255,.82);
transition:.18s ease;
box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
flex:0 0 auto;
text-decoration:none;
}

.mss-shell-icon:hover{
transform:translateY(-1px);
color:#fff;
border-color:rgba(244,222,154,.18);
background:rgba(220,185,106,.08);
box-shadow:0 0 18px rgba(244,222,154,.08);
}

.mss-shell-session,
.mss-shell-logout{
display:inline-flex;
align-items:center;
justify-content:center;
gap:8px;
min-height:40px;
padding:0 12px;
border-radius:12px;
border:1px solid rgba(255,255,255,.10);
background:rgba(255,255,255,.04);
color:#eef3fb;
font-weight:800;
font-size:11px;
letter-spacing:.12em;
text-transform:uppercase;
cursor:pointer;
transition:.18s ease;
white-space:nowrap;
box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
flex:0 0 auto;
}

.mss-shell-session:hover,
.mss-shell-logout:hover{
transform:translateY(-1px);
border-color:rgba(255,255,255,.16);
background:rgba(255,255,255,.06);
}

.mss-shell-logout{
border-color:rgba(255,91,107,.20);
background:rgba(255,91,107,.08);
}

.mss-shell-status-dot{
width:7px;
height:7px;
border-radius:999px;
background:rgba(244,222,154,.92);
box-shadow:0 0 0 5px rgba(244,222,154,.08);
flex:0 0 auto;
}

.mss-shell-footer{
margin-top:56px;
border-top:1px solid rgba(255,255,255,.08);
background:
radial-gradient(900px 180px at 0% 0%, rgba(220,185,106,.06), transparent 38%),
linear-gradient(180deg, rgba(8,10,14,.84), rgba(8,10,14,.62));
position:relative;
overflow:hidden;
}

.mss-shell-footer::before{
content:"";
position:absolute;
inset:0 0 auto 0;
height:1px;
background:linear-gradient(90deg, rgba(255,255,255,0), rgba(244,222,154,.28), rgba(255,255,255,0));
opacity:.9;
}

.mss-shell-footer-main{
display:grid;
grid-template-columns:minmax(0,1.2fr) minmax(220px,.8fr) minmax(220px,.8fr) minmax(220px,.9fr);
gap:18px;
padding:28px 0 18px;
align-items:start;
}

.mss-shell-footer-brandblock{
min-width:0;
}

.mss-shell-footer-brand{
display:flex;
align-items:center;
gap:12px;
min-width:0;
}

.mss-shell-footer-brandtext{
min-width:0;
}

.mss-shell-footer-title{
color:#eef3fb;
font-size:13px;
font-weight:900;
letter-spacing:.16em;
text-transform:uppercase;
line-height:1.1;
}

.mss-shell-footer-sub{
margin-top:4px;
color:rgba(238,243,251,.46);
font-size:11px;
letter-spacing:.12em;
text-transform:uppercase;
}

.mss-shell-footer-copy{
margin-top:14px;
color:rgba(238,243,251,.62);
font-size:13px;
line-height:1.7;
max-width:420px;
}

.mss-shell-footer-col{
min-width:0;
}

.mss-shell-footer-heading{
color:#eef3fb;
font-size:11px;
font-weight:900;
letter-spacing:.14em;
text-transform:uppercase;
margin-bottom:12px;
}

.mss-shell-footer-links{
display:grid;
gap:10px;
}

.mss-shell-footer-link{
color:rgba(238,243,251,.62);
font-size:13px;
line-height:1.45;
text-decoration:none;
transition:.16s ease;
width:max-content;
max-width:100%;
}

.mss-shell-footer-link:hover{
color:#fff;
}

.mss-shell-footer-note{
color:rgba(238,243,251,.56);
font-size:13px;
line-height:1.65;
}

.mss-shell-footer-socials{
display:flex;
align-items:center;
gap:10px;
flex-wrap:wrap;
margin-top:12px;
}

.mss-shell-footer-bottom{
display:flex;
align-items:center;
justify-content:space-between;
gap:12px;
flex-wrap:wrap;
padding:16px 0 22px;
border-top:1px solid rgba(255,255,255,.06);
}

.mss-shell-footer-bottomline{
color:rgba(238,243,251,.44);
font-size:12px;
line-height:1.5;
}

.mss-shell-footer-badges{
display:flex;
align-items:center;
gap:8px;
flex-wrap:wrap;
}

.mss-shell-footer-badge{
display:inline-flex;
align-items:center;
gap:8px;
min-height:32px;
padding:0 11px;
border-radius:999px;
border:1px solid rgba(255,255,255,.10);
background:rgba(255,255,255,.04);
color:rgba(255,255,255,.76);
font-size:11px;
font-weight:800;
letter-spacing:.08em;
text-transform:uppercase;
white-space:nowrap;
}

.mss-shell-footer-badge-dot{
width:7px;
height:7px;
border-radius:999px;
background:rgba(244,222,154,.88);
box-shadow:0 0 12px rgba(244,222,154,.30);
flex:0 0 auto;
}

@media (max-width: 1240px){
.mss-shell-topbar{
grid-template-columns:minmax(180px, 250px) minmax(0,1fr) auto;
gap:12px;
}

.mss-shell-navlink{
padding:0 10px;
font-size:10px;
}

.mss-shell-session,
.mss-shell-logout{
padding:0 11px;
font-size:10px;
}
}

@media (max-width: 1080px){
.mss-shell-footer-main{
grid-template-columns:repeat(2, minmax(0,1fr));
}
}

@media (max-width: 980px){
.mss-shell-topbar{
grid-template-columns:1fr;
align-items:stretch;
}

.mss-shell-brand{
width:100%;
}

.mss-shell-navwrap{
width:100%;
}

.mss-shell-nav{
justify-content:flex-start;
}

.mss-shell-auth{
justify-content:flex-start;
flex-wrap:wrap;
}
}

@media (max-width: 860px){
.mss-shell-footer-main{
grid-template-columns:1fr;
}

.mss-shell-footer-bottom{
align-items:flex-start;
flex-direction:column;
}
}

@media (max-width: 520px){
.mss-shell-wrap{
width:min(var(--max, 1320px), calc(100% - 24px));
}

.mss-shell-brand-sub{
display:none;
}
}
`;
document.head.appendChild(style);
}

function getShieldSvg() {
return `
<svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
<path
d="M32 6L49.5 12.8V28.6C49.5 39.4 42.8 49.2 32 54C21.2 49.2 14.5 39.4 14.5 28.6V12.8L32 6Z"
fill="url(#mssShieldFill)"
stroke="rgba(255,248,222,.92)"
stroke-width="2.2"
/>
<path
d="M21 39.5V21.8L27.2 31.1L32 24.5L36.8 31.1L43 21.8V39.5"
stroke="rgba(16,18,22,.96)"
stroke-width="4"
stroke-linecap="round"
stroke-linejoin="round"
/>
<defs>
<linearGradient id="mssShieldFill" x1="16" y1="10" x2="48" y2="54" gradientUnits="userSpaceOnUse">
<stop stop-color="#f4de9a"/>
<stop offset="0.52" stop-color="#dcb96a"/>
<stop offset="1" stop-color="#a97526"/>
</linearGradient>
</defs>
</svg>
`;
}

function getActiveKey(options = {}) {
return String(
options.activeNav ||
document.body?.dataset?.shellActive ||
"home"
).trim().toLowerCase();
}

function getSubtitle(options = {}) {
return String(
options.pageSubtitle ||
options.pageLabel ||
document.body?.dataset?.shellSubtitle ||
"Blockchain Security Intelligence"
).trim();
}

function getFooterYear() {
return new Date().getFullYear();
}

function renderHeader(options = {}) {
const activeKey = getActiveKey(options);
const subtitle = getSubtitle(options);

const navHtml = NAV_ITEMS.map((item) => {
const activeClass = item.key === activeKey ? " active" : "";
return `<a class="mss-shell-navlink${activeClass}" href="${item.href}">${item.label}</a>`;
}).join("");

return `
<header class="mss-shell-header" id="mssShellHeader">
<div class="mss-shell-wrap mss-shell-topbar">
<a class="mss-shell-brand" href="./index.html" aria-label="MSS Protocol Home">
<span class="mss-shell-mark" aria-hidden="true">${getShieldSvg()}</span>
<div class="mss-shell-brand-copy">
<span class="mss-shell-brand-title">MSS Protocol</span>
<span class="mss-shell-brand-sub">${subtitle}</span>
</div>
</a>

<div class="mss-shell-navwrap">
<nav class="mss-shell-nav" aria-label="Primary">
${navHtml}
</nav>
</div>

<div class="mss-shell-auth">
<div class="mss-shell-social" aria-label="Social links">
<a
class="mss-shell-icon"
href="${X_URL}"
target="_blank"
rel="noopener noreferrer"
aria-label="MSS Protocol on X"
title="X"
>
<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
<path d="M18.9 2H22l-6.77 7.73L23.2 22h-6.25l-4.9-7.41L5.56 22H2.44l7.24-8.27L1.2 2h6.4l4.42 6.73L18.9 2zM17.8 20h1.73L6.27 3.9H4.41L17.8 20z"/>
</svg>
</a>

<a
class="mss-shell-icon"
href="${TG_URL}"
target="_blank"
rel="noopener noreferrer"
aria-label="MSS Protocol Telegram community"
title="Telegram"
>
<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
<path d="M21.5 4.5 3.9 11.3c-1.2.5-1.2 1.2-.2 1.5l4.5 1.4 1.7 5.3c.2.7.1 1 .9 1 .6 0 .8-.3 1.1-.6l2.2-2.1 4.6 3.4c.8.5 1.4.2 1.6-.8l3-14c.3-1.2-.5-1.8-1.6-1.3zm-10.8 9.2 8.8-5.6c.4-.3.8-.1.5.2l-7.3 6.6-.3 3.1-1.7-4.3z"/>
</svg>
</a>
</div>

<button id="sessionPill" class="mss-shell-session" type="button" title="Login">
<span id="sessionDot" class="mss-shell-status-dot"></span>
<span id="sessionText">Login</span>
</button>

<button id="logoutBtn" class="mss-shell-logout" type="button" style="display:none;">Logout</button>
</div>
</div>
</header>
`;
}

function renderFooter() {
const year = getFooterYear();

return `
<footer class="mss-shell-footer" id="mssShellFooter">
<div class="mss-shell-wrap">
<div class="mss-shell-footer-main">
<div class="mss-shell-footer-brandblock">
<div class="mss-shell-footer-brand">
<span class="mss-shell-mark" aria-hidden="true">${getShieldSvg()}</span>
<div class="mss-shell-footer-brandtext">
<div class="mss-shell-footer-title">MSS Protocol</div>
<div class="mss-shell-footer-sub">Market Safety Standard</div>
</div>
</div>

<div class="mss-shell-footer-copy">
Blockchain security intelligence for transparent crypto markets. Built to surface structural risk, wallet-linked behavior, and clearer launch visibility through an institutional-grade command layer.
</div>
</div>

<div class="mss-shell-footer-col">
<div class="mss-shell-footer-heading">Platform</div>
<div class="mss-shell-footer-links">
<a class="mss-shell-footer-link" href="./token.html">Scanner</a>
<a class="mss-shell-footer-link" href="./launchpad.html">Launchpad</a>
<a class="mss-shell-footer-link" href="./explore.html">Explore</a>
<a class="mss-shell-footer-link" href="./alerts.html">Alerts</a>
</div>
</div>

<div class="mss-shell-footer-col">
<div class="mss-shell-footer-heading">Framework</div>
<div class="mss-shell-footer-links">
<a class="mss-shell-footer-link" href="./methodology.html">Methodology</a>
<a class="mss-shell-footer-link" href="./legal.html">Legal</a>
<a class="mss-shell-footer-link" href="./login.html">Account Access</a>
</div>
</div>

<div class="mss-shell-footer-col">
<div class="mss-shell-footer-heading">Official Channels</div>
<div class="mss-shell-footer-note">
Follow only official MSS Protocol channels for product updates, launch visibility, and community announcements.
</div>

<div class="mss-shell-footer-socials" aria-label="Footer social links">
<a
class="mss-shell-icon"
href="${X_URL}"
target="_blank"
rel="noopener noreferrer"
aria-label="MSS Protocol on X"
title="X"
>
<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
<path d="M18.9 2H22l-6.77 7.73L23.2 22h-6.25l-4.9-7.41L5.56 22H2.44l7.24-8.27L1.2 2h6.4l4.42 6.73L18.9 2zM17.8 20h1.73L6.27 3.9H4.41L17.8 20z"/>
</svg>
</a>

<a
class="mss-shell-icon"
href="${TG_URL}"
target="_blank"
rel="noopener noreferrer"
aria-label="MSS Protocol Telegram community"
title="Telegram"
>
<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
<path d="M21.5 4.5 3.9 11.3c-1.2.5-1.2 1.2-.2 1.5l4.5 1.4 1.7 5.3c.2.7.1 1 .9 1 .6 0 .8-.3 1.1-.6l2.2-2.1 4.6 3.4c.8.5 1.4.2 1.6-.8l3-14c.3-1.2-.5-1.8-1.6-1.3zm-10.8 9.2 8.8-5.6c.4-.3.8-.1.5.2l-7.3 6.6-.3 3.1-1.7-4.3z"/>
</svg>
</a>
</div>
</div>
</div>

<div class="mss-shell-footer-bottom">
<div class="mss-shell-footer-bottomline">
© ${year} MSS Protocol. All rights reserved.
</div>

<div class="mss-shell-footer-badges">
<span class="mss-shell-footer-badge">
<span class="mss-shell-footer-badge-dot"></span>
Blockchain Security Intelligence
</span>
<span class="mss-shell-footer-badge">Institutional Signal Layer</span>
</div>
</div>
</div>
</footer>
`;
}

function resolveTarget(targetId, fallbackPosition) {
if (targetId) {
const target = document.getElementById(targetId);
if (target) return { mode: "target", node: target };
}
return { mode: "body", position: fallbackPosition };
}

function injectMarkup(targetConfig, markup) {
if (targetConfig.mode === "target" && targetConfig.node) {
targetConfig.node.innerHTML = markup;
return;
}

if (targetConfig.position === "afterbegin") {
document.body.insertAdjacentHTML("afterbegin", markup);
} else {
document.body.insertAdjacentHTML("beforeend", markup);
}
}

export async function mountLayoutShell(options = {}) {
ensureStyles();

const headerTarget = resolveTarget(options.headerTargetId, "afterbegin");
const footerTarget = resolveTarget(options.footerTargetId, "beforeend");

if (headerTarget.mode === "target") {
if (!headerTarget.node.querySelector("#mssShellHeader")) {
injectMarkup(headerTarget, renderHeader(options));
}
} else if (!document.getElementById("mssShellHeader")) {
injectMarkup(headerTarget, renderHeader(options));
}

if (footerTarget.mode === "target") {
if (!footerTarget.node.querySelector("#mssShellFooter")) {
injectMarkup(footerTarget, renderFooter());
}
} else if (!document.getElementById("mssShellFooter")) {
injectMarkup(footerTarget, renderFooter());
}

return {
header: document.getElementById("mssShellHeader"),
footer: document.getElementById("mssShellFooter"),
};
}

export const renderLayoutShell = mountLayoutShell;
export const initLayoutShell = mountLayoutShell;
export default mountLayoutShell;

if (document.readyState === "loading") {
document.addEventListener("DOMContentLoaded", () => {
const shouldAutoMount =
document.body?.dataset?.shellAuto === "true" &&
!document.getElementById("mssShellHeader");

if (shouldAutoMount) {
void mountLayoutShell({});
}
}, { once: true });
} else if (document.body?.dataset?.shellAuto === "true" && !document.getElementById("mssShellHeader")) {
void mountLayoutShell({});
}
