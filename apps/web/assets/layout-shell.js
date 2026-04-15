import { bindSessionUi } from "./auth.js";

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
backdrop-filter:blur(16px);
-webkit-backdrop-filter:blur(16px);
background:linear-gradient(180deg, rgba(6,8,13,.92), rgba(6,8,13,.72));
border-bottom:1px solid rgba(255,255,255,.06);
box-shadow:0 10px 34px rgba(0,0,0,.22);
}

.mss-shell-wrap{
width:min(var(--max, 1320px), calc(100% - 32px));
margin:0 auto;
max-width:100%;
min-width:0;
}

.mss-shell-topbar{
display:flex;
align-items:center;
justify-content:space-between;
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
flex:0 1 auto;
color:inherit;
text-decoration:none;
}

.mss-shell-mark{
width:38px;
height:38px;
border-radius:12px;
position:relative;
display:grid;
place-items:center;
flex:0 0 auto;
overflow:hidden;
background:
radial-gradient(circle at 30% 24%, rgba(255,255,255,.18), transparent 34%),
linear-gradient(135deg, rgba(32,35,41,.98), rgba(14,16,20,.98));
border:1px solid rgba(244,222,154,.22);
box-shadow:
0 0 0 1px rgba(244,222,154,.04),
0 0 24px rgba(220,185,106,.08),
inset 0 1px 0 rgba(255,255,255,.08);
}

.mss-shell-mark::before{
content:"";
position:absolute;
inset:7px;
border-radius:9px;
background:linear-gradient(135deg, #dcb96a, #b98531);
opacity:.96;
box-shadow:0 0 12px rgba(244,222,154,.14);
}

.mss-shell-mark::after{
content:"";
position:absolute;
left:16px;
top:17px;
width:8px;
height:4px;
border-left:2px solid rgba(255,255,255,.96);
border-bottom:2px solid rgba(255,255,255,.96);
transform:rotate(-45deg);
opacity:.98;
}

.mss-shell-brand-copy{
min-width:0;
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
}

.mss-shell-navwrap{
display:flex;
align-items:center;
gap:12px;
min-width:0;
margin-left:auto;
max-width:100%;
overflow:hidden;
}

.mss-shell-nav{
display:flex;
align-items:center;
justify-content:flex-end;
gap:8px;
flex-wrap:wrap;
min-width:0;
max-width:100%;
}

.mss-shell-navlink{
display:inline-flex;
align-items:center;
justify-content:center;
gap:8px;
min-height:40px;
padding:0 12px;
border-radius:12px;
color:rgba(255,255,255,.76);
border:1px solid transparent;
font-size:12px;
font-weight:800;
letter-spacing:.10em;
text-transform:uppercase;
white-space:nowrap;
transition:.18s ease;
text-decoration:none;
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
gap:10px;
flex-wrap:wrap;
min-width:0;
}

.mss-shell-social{
display:flex;
align-items:center;
gap:10px;
flex-wrap:wrap;
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
background:rgba(255,255,255,.35);
box-shadow:0 0 0 5px rgba(255,255,255,.05);
flex:0 0 auto;
}

.mss-shell-footer{
margin-top:48px;
border-top:1px solid rgba(255,255,255,.08);
background:rgba(0,0,0,.14);
}

.mss-shell-footer-main{
padding:18px 0;
display:flex;
align-items:center;
justify-content:space-between;
gap:12px;
flex-wrap:wrap;
}

.mss-shell-footer-brand{
display:flex;
align-items:center;
gap:10px;
color:rgba(255,255,255,.88);
font-size:11px;
font-weight:800;
letter-spacing:.18em;
text-transform:uppercase;
min-width:0;
}

.mss-shell-footer-copy{
color:rgba(238,243,251,.44);
font-size:12px;
}

@media (max-width: 860px){
.mss-shell-topbar{
flex-direction:column;
align-items:stretch;
gap:12px;
}

.mss-shell-navwrap{
flex-direction:column;
align-items:stretch;
}

.mss-shell-nav{
flex-wrap:nowrap;
justify-content:flex-start;
overflow-x:auto;
overflow-y:hidden;
-webkit-overflow-scrolling:touch;
padding-bottom:4px;
scrollbar-width:none;
}

.mss-shell-nav::-webkit-scrollbar{
display:none;
}

.mss-shell-auth{
justify-content:flex-start;
}
}

@media (max-width: 520px){
.mss-shell-wrap{
width:min(var(--max, 1320px), calc(100% - 24px));
}

.mss-shell-footer-main{
align-items:flex-start;
}
}
`;
document.head.appendChild(style);
}

function getActiveKey() {
return (document.body?.dataset?.shellActive || "home").trim().toLowerCase();
}

function getSubtitle() {
return (document.body?.dataset?.shellSubtitle || "Blockchain Security Intelligence").trim();
}

function renderHeader() {
const activeKey = getActiveKey();
const subtitle = getSubtitle();

const navHtml = NAV_ITEMS.map((item) => {
const activeClass = item.key === activeKey ? " active" : "";
return `<a class="mss-shell-navlink${activeClass}" href="${item.href}">${item.label}</a>`;
}).join("");

return `
<header class="mss-shell-header" id="mssShellHeader">
<div class="mss-shell-wrap mss-shell-topbar">
<a class="mss-shell-brand" href="./index.html" aria-label="MSS Protocol Home">
<span class="mss-shell-mark" aria-hidden="true"></span>
<div class="mss-shell-brand-copy">
<span class="mss-shell-brand-title">MSS Protocol</span>
<span class="mss-shell-brand-sub">${subtitle}</span>
</div>
</a>

<div class="mss-shell-navwrap">
<nav class="mss-shell-nav" aria-label="Primary">
${navHtml}
</nav>

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
</div>
</header>
`;
}

function renderFooter() {
return `
<footer class="mss-shell-footer" id="mssShellFooter">
<div class="mss-shell-wrap">
<div class="mss-shell-footer-main">
<div class="mss-shell-footer-brand">
<span class="mss-shell-mark" aria-hidden="true"></span>
<span>MSS Protocol</span>
</div>

<div class="mss-shell-social" aria-label="Footer social links">
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

<div class="mss-shell-footer-copy">Blockchain Security Intelligence.</div>
</div>
</div>
</footer>
`;
}

function mountShell() {
if (document.getElementById("mssShellHeader")) return;

ensureStyles();

document.body.insertAdjacentHTML("afterbegin", renderHeader());
document.body.insertAdjacentHTML("beforeend", renderFooter());

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
}

if (document.readyState === "loading") {
document.addEventListener("DOMContentLoaded", mountShell, { once: true });
} else {
mountShell();
}