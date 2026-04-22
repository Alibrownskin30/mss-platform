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
html.mss-shell-lock,
body.mss-shell-lock{
overflow:hidden;
overscroll-behavior:none;
}

body.mss-shell-lock{
touch-action:none;
padding-right:var(--mss-shell-scrollbar-width, 0px);
}

#layoutShellHeader:empty{
display:block;
min-height:72px;
}

#layoutShellFooter:empty{
display:block;
}

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
overflow:visible;
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
background:linear-gradient(180deg, rgba(255,255,255,.03), transparent 28%);
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
grid-template-columns:minmax(0,1fr) auto auto;
align-items:center;
gap:14px;
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

.mss-shell-page-pill{
display:inline-flex;
align-items:center;
justify-content:center;
gap:8px;
min-height:40px;
padding:0 14px;
border-radius:999px;
border:1px solid rgba(255,255,255,.10);
background:rgba(255,255,255,.04);
color:rgba(255,255,255,.84);
font-size:11px;
font-weight:800;
letter-spacing:.12em;
text-transform:uppercase;
white-space:nowrap;
box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
}

.mss-shell-page-pill-dot{
width:7px;
height:7px;
border-radius:999px;
background:rgba(244,222,154,.92);
box-shadow:0 0 0 5px rgba(244,222,154,.08);
flex:0 0 auto;
}

.mss-shell-menu-toggle{
display:inline-flex;
align-items:center;
justify-content:center;
gap:10px;
min-height:42px;
padding:0 14px;
border-radius:14px;
border:1px solid rgba(255,255,255,.10);
background:rgba(255,255,255,.04);
color:#eef3fb;
font-size:11px;
font-weight:900;
letter-spacing:.14em;
text-transform:uppercase;
cursor:pointer;
transition:.18s ease;
box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
white-space:nowrap;
}

.mss-shell-menu-toggle:hover{
transform:translateY(-1px);
border-color:rgba(244,222,154,.18);
background:rgba(220,185,106,.08);
box-shadow:0 0 18px rgba(244,222,154,.08);
}

.mss-shell-menu-toggle[aria-expanded="true"]{
color:#fff;
border-color:rgba(244,222,154,.20);
background:linear-gradient(180deg, rgba(220,185,106,.10), rgba(220,185,106,.04));
box-shadow:0 0 18px rgba(244,222,154,.08);
}

.mss-shell-menu-toggle-bars{
display:grid;
gap:4px;
width:14px;
flex:0 0 auto;
}

.mss-shell-menu-toggle-bars span{
display:block;
width:14px;
height:2px;
border-radius:999px;
background:currentColor;
opacity:.92;
transform-origin:center;
transition:transform .18s ease, opacity .18s ease;
}

.mss-shell-menu-toggle[aria-expanded="true"] .mss-shell-menu-toggle-bars span:nth-child(1){
transform:translateY(6px) rotate(45deg);
}

.mss-shell-menu-toggle[aria-expanded="true"] .mss-shell-menu-toggle-bars span:nth-child(2){
opacity:0;
}

.mss-shell-menu-toggle[aria-expanded="true"] .mss-shell-menu-toggle-bars span:nth-child(3){
transform:translateY(-6px) rotate(-45deg);
}

.mss-shell-drawer{
position:fixed;
inset:0;
z-index:1200;
pointer-events:none;
}

.mss-shell-drawer.is-open{
pointer-events:auto;
}

.mss-shell-drawer-backdrop{
position:absolute;
inset:0;
background:rgba(4,6,10,.62);
backdrop-filter:blur(14px);
-webkit-backdrop-filter:blur(14px);
opacity:0;
transition:opacity .24s ease;
}

.mss-shell-drawer.is-open .mss-shell-drawer-backdrop{
opacity:1;
}

.mss-shell-drawer-panel{
position:absolute;
top:0;
right:0;
height:100dvh;
width:min(430px, calc(100vw - 22px));
max-width:100%;
display:flex;
flex-direction:column;
background:
radial-gradient(720px 220px at 0% 0%, rgba(244,222,154,.08), transparent 42%),
radial-gradient(560px 180px at 100% 0%, rgba(182,190,203,.06), transparent 38%),
linear-gradient(180deg, rgba(10,12,18,.98), rgba(7,8,12,.98));
border-left:1px solid rgba(255,255,255,.08);
box-shadow:
-24px 0 60px rgba(0,0,0,.34),
inset 1px 0 0 rgba(255,255,255,.03);
transform:translateX(108%);
transition:transform .28s cubic-bezier(.22,.8,.22,1);
overflow:hidden;
}

.mss-shell-drawer.is-open .mss-shell-drawer-panel{
transform:translateX(0);
}

.mss-shell-drawer-panel::before{
content:"";
position:absolute;
inset:0 0 auto 0;
height:1px;
background:linear-gradient(90deg, rgba(255,255,255,0), rgba(244,222,154,.24), rgba(255,255,255,0));
opacity:.9;
pointer-events:none;
}

.mss-shell-drawer-head{
display:flex;
align-items:flex-start;
justify-content:space-between;
gap:14px;
padding:18px 18px 16px;
border-bottom:1px solid rgba(255,255,255,.06);
}

.mss-shell-drawer-brand{
display:flex;
align-items:flex-start;
gap:12px;
min-width:0;
flex:1 1 auto;
}

.mss-shell-drawer-title{
display:block;
color:#eef3fb;
font-size:13px;
font-weight:900;
letter-spacing:.16em;
text-transform:uppercase;
line-height:1.2;
}

.mss-shell-drawer-sub{
display:block;
margin-top:5px;
color:rgba(238,243,251,.46);
font-size:11px;
letter-spacing:.12em;
text-transform:uppercase;
line-height:1.35;
word-break:break-word;
}

.mss-shell-drawer-close{
display:inline-flex;
align-items:center;
justify-content:center;
width:42px;
height:42px;
border-radius:12px;
border:1px solid rgba(255,255,255,.10);
background:rgba(255,255,255,.04);
color:#eef3fb;
cursor:pointer;
transition:.18s ease;
flex:0 0 auto;
}

.mss-shell-drawer-close:hover{
transform:translateY(-1px);
border-color:rgba(244,222,154,.18);
background:rgba(220,185,106,.08);
}

.mss-shell-drawer-scroll{
flex:1 1 auto;
min-height:0;
overflow:auto;
padding:18px;
scrollbar-width:thin;
scrollbar-color:rgba(255,255,255,.18) transparent;
}

.mss-shell-drawer-block + .mss-shell-drawer-block{
margin-top:18px;
}

.mss-shell-drawer-label{
display:flex;
align-items:center;
gap:8px;
margin-bottom:10px;
color:rgba(238,243,251,.46);
font-size:10px;
font-weight:900;
letter-spacing:.16em;
text-transform:uppercase;
}

.mss-shell-drawer-label::before{
content:"";
width:7px;
height:7px;
border-radius:999px;
background:rgba(244,222,154,.9);
box-shadow:0 0 0 5px rgba(244,222,154,.08);
flex:0 0 auto;
}

.mss-shell-drawer-nav{
display:grid;
gap:10px;
}

.mss-shell-drawer-link{
display:flex;
align-items:center;
justify-content:space-between;
gap:14px;
min-height:54px;
padding:0 16px;
border-radius:16px;
border:1px solid rgba(255,255,255,.08);
background:rgba(255,255,255,.03);
color:rgba(255,255,255,.82);
text-decoration:none;
transition:.18s ease;
box-shadow:inset 0 1px 0 rgba(255,255,255,.03);
}

.mss-shell-drawer-link:hover{
transform:translateX(-2px);
color:#fff;
border-color:rgba(255,255,255,.14);
background:rgba(255,255,255,.05);
}

.mss-shell-drawer-link.active{
color:#fff;
border-color:rgba(244,222,154,.20);
background:linear-gradient(180deg, rgba(220,185,106,.10), rgba(220,185,106,.04));
box-shadow:0 0 16px rgba(244,222,154,.06);
}

.mss-shell-drawer-link-main{
display:flex;
align-items:center;
gap:12px;
min-width:0;
}

.mss-shell-drawer-link-index{
width:26px;
height:26px;
border-radius:999px;
display:inline-flex;
align-items:center;
justify-content:center;
border:1px solid rgba(255,255,255,.10);
background:rgba(255,255,255,.04);
color:rgba(255,255,255,.56);
font-size:10px;
font-weight:900;
letter-spacing:.08em;
flex:0 0 auto;
}

.mss-shell-drawer-link.active .mss-shell-drawer-link-index{
color:#11151c;
background:linear-gradient(135deg, rgba(244,222,154,.98), rgba(220,185,106,.94));
border-color:rgba(244,222,154,.22);
}

.mss-shell-drawer-link-text{
min-width:0;
}

.mss-shell-drawer-link-title{
display:block;
font-size:13px;
font-weight:800;
letter-spacing:.06em;
text-transform:uppercase;
line-height:1.2;
color:inherit;
}

.mss-shell-drawer-link-sub{
display:block;
margin-top:4px;
color:rgba(255,255,255,.48);
font-size:11px;
letter-spacing:.08em;
text-transform:uppercase;
line-height:1.2;
}

.mss-shell-drawer-link-arrow{
color:rgba(255,255,255,.34);
font-size:16px;
flex:0 0 auto;
}

.mss-shell-account-card{
display:grid;
gap:10px;
padding:14px;
border-radius:18px;
border:1px solid rgba(255,255,255,.08);
background:rgba(255,255,255,.03);
box-shadow:inset 0 1px 0 rgba(255,255,255,.03);
}

.mss-shell-account-copy{
color:rgba(238,243,251,.58);
font-size:12px;
line-height:1.6;
}

.mss-shell-session,
.mss-shell-logout{
display:inline-flex;
align-items:center;
justify-content:center;
gap:8px;
min-height:44px;
padding:0 14px;
border-radius:14px;
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
width:100%;
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

.mss-shell-social-grid{
display:grid;
grid-template-columns:repeat(2, minmax(0,1fr));
gap:10px;
}

.mss-shell-social-card{
display:flex;
align-items:center;
gap:12px;
min-height:54px;
padding:0 14px;
border-radius:16px;
border:1px solid rgba(255,255,255,.08);
background:rgba(255,255,255,.03);
color:rgba(255,255,255,.84);
text-decoration:none;
transition:.18s ease;
box-shadow:inset 0 1px 0 rgba(255,255,255,.03);
}

.mss-shell-social-card:hover{
transform:translateY(-1px);
color:#fff;
border-color:rgba(244,222,154,.18);
background:rgba(220,185,106,.08);
box-shadow:0 0 18px rgba(244,222,154,.08);
}

.mss-shell-social-card-icon{
width:38px;
height:38px;
border-radius:12px;
display:inline-flex;
align-items:center;
justify-content:center;
border:1px solid rgba(255,255,255,.10);
background:rgba(255,255,255,.04);
color:inherit;
flex:0 0 auto;
}

.mss-shell-social-card-text{
min-width:0;
}

.mss-shell-social-card-title{
display:block;
font-size:12px;
font-weight:800;
letter-spacing:.10em;
text-transform:uppercase;
color:inherit;
line-height:1.2;
}

.mss-shell-social-card-sub{
display:block;
margin-top:4px;
color:rgba(255,255,255,.46);
font-size:11px;
letter-spacing:.06em;
text-transform:uppercase;
line-height:1.2;
}

.mss-shell-drawer-foot{
padding:16px 18px 18px;
border-top:1px solid rgba(255,255,255,.06);
background:linear-gradient(180deg, rgba(255,255,255,.01), rgba(255,255,255,.02));
}

.mss-shell-drawer-foot-badges{
display:flex;
align-items:center;
gap:8px;
flex-wrap:wrap;
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

.mss-shell-footer-badges,
.mss-shell-drawer-foot-badges{
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

@media (max-width: 1080px){
.mss-shell-footer-main{
grid-template-columns:repeat(2, minmax(0,1fr));
}
}

@media (max-width: 860px){
#layoutShellHeader:empty{
min-height:68px;
}

.mss-shell-footer-main{
grid-template-columns:1fr;
}

.mss-shell-footer-bottom{
align-items:flex-start;
flex-direction:column;
}

.mss-shell-topbar{
grid-template-columns:minmax(0,1fr) auto;
}

.mss-shell-page-pill{
display:none;
}
}

@media (max-width: 640px){
.mss-shell-wrap{
width:min(var(--max, 1320px), calc(100% - 24px));
}

.mss-shell-brand-sub{
display:none;
}

.mss-shell-drawer-panel{
width:min(100vw, 100%);
}

.mss-shell-social-grid{
grid-template-columns:1fr;
}

.mss-shell-menu-toggle{
min-width:42px;
padding:0 12px;
}

.mss-shell-menu-toggle-label{
display:none;
}
}
`;
document.head.appendChild(style);
}

function primeShellPlaceholders() {
const headerTarget = document.getElementById("layoutShellHeader");
if (headerTarget && !headerTarget.innerHTML.trim()) {
headerTarget.style.display = "block";
headerTarget.style.minHeight = "72px";
}
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

function getPageTitle(options = {}) {
return String(
options.pageTitle ||
options.pageLabel ||
"MSS Protocol"
).trim();
}

function getFooterYear() {
return new Date().getFullYear();
}

function getNavMeta(key) {
const meta = {
home: "Protocol overview",
scanner: "Token intelligence",
launchpad: "Launch command",
explore: "Market discovery",
alerts: "Monitoring layer",
methodology: "Scoring framework",
legal: "Policy and terms",
};
return meta[key] || "MSS navigation";
}

function renderDrawerNav(activeKey) {
return NAV_ITEMS.map((item, index) => {
const activeClass = item.key === activeKey ? " active" : "";
return `
<a class="mss-shell-drawer-link${activeClass}" href="${item.href}" data-shell-close="true">
<span class="mss-shell-drawer-link-main">
<span class="mss-shell-drawer-link-index">${String(index + 1).padStart(2, "0")}</span>
<span class="mss-shell-drawer-link-text">
<span class="mss-shell-drawer-link-title">${item.label}</span>
<span class="mss-shell-drawer-link-sub">${getNavMeta(item.key)}</span>
</span>
</span>
<span class="mss-shell-drawer-link-arrow">→</span>
</a>
`;
}).join("");
}

function renderHeader(options = {}) {
const activeKey = getActiveKey(options);
const subtitle = getSubtitle(options);
const pageTitle = getPageTitle(options);
const activeLabel = NAV_ITEMS.find((item) => item.key === activeKey)?.label || "Menu";

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

<div class="mss-shell-page-pill" aria-label="Current section">
<span class="mss-shell-page-pill-dot"></span>
<span>${activeLabel}</span>
</div>

<button
id="mssShellMenuToggle"
class="mss-shell-menu-toggle"
type="button"
aria-expanded="false"
aria-controls="mssShellDrawer"
aria-label="Open navigation menu"
>
<span class="mss-shell-menu-toggle-bars" aria-hidden="true">
<span></span>
<span></span>
<span></span>
</span>
<span class="mss-shell-menu-toggle-label">Menu</span>
</button>
</div>

<div class="mss-shell-drawer" id="mssShellDrawer" aria-hidden="true">
<div class="mss-shell-drawer-backdrop" data-shell-close="true"></div>

<aside class="mss-shell-drawer-panel" role="dialog" aria-modal="true" aria-label="Site navigation">
<div class="mss-shell-drawer-head">
<div class="mss-shell-drawer-brand">
<span class="mss-shell-mark" aria-hidden="true">${getShieldSvg()}</span>
<div>
<span class="mss-shell-drawer-title">MSS Protocol</span>
<span class="mss-shell-drawer-sub">${pageTitle}</span>
</div>
</div>

<button
id="mssShellDrawerClose"
class="mss-shell-drawer-close"
type="button"
aria-label="Close navigation menu"
>
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
<path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
</svg>
</button>
</div>

<div class="mss-shell-drawer-scroll">
<div class="mss-shell-drawer-block">
<div class="mss-shell-drawer-label">Navigate</div>
<nav class="mss-shell-drawer-nav" aria-label="Primary">
${renderDrawerNav(activeKey)}
</nav>
</div>

<div class="mss-shell-drawer-block">
<div class="mss-shell-drawer-label">Account Access</div>
<div class="mss-shell-account-card">
<div class="mss-shell-account-copy">
Open account access, session controls, and wallet-linked product entry from one command surface.
</div>
<button id="sessionPill" class="mss-shell-session" type="button" title="Login">
<span id="sessionDot" class="mss-shell-status-dot"></span>
<span id="sessionText">Login</span>
</button>
<button id="logoutBtn" class="mss-shell-logout" type="button" style="display:none;">Logout</button>
</div>
</div>

<div class="mss-shell-drawer-block">
<div class="mss-shell-drawer-label">Official Channels</div>
<div class="mss-shell-social-grid" aria-label="Social links">
<a
class="mss-shell-social-card"
href="${X_URL}"
target="_blank"
rel="noopener noreferrer"
aria-label="MSS Protocol on X"
>
<span class="mss-shell-social-card-icon">
<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
<path d="M18.9 2H22l-6.77 7.73L23.2 22h-6.25l-4.9-7.41L5.56 22H2.44l7.24-8.27L1.2 2h6.4l4.42 6.73L18.9 2zM17.8 20h1.73L6.27 3.9H4.41L17.8 20z"/>
</svg>
</span>
<span class="mss-shell-social-card-text">
<span class="mss-shell-social-card-title">X</span>
<span class="mss-shell-social-card-sub">Official feed</span>
</span>
</a>

<a
class="mss-shell-social-card"
href="${TG_URL}"
target="_blank"
rel="noopener noreferrer"
aria-label="MSS Protocol Telegram community"
>
<span class="mss-shell-social-card-icon">
<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
<path d="M21.5 4.5 3.9 11.3c-1.2.5-1.2 1.2-.2 1.5l4.5 1.4 1.7 5.3c.2.7.1 1 .9 1 .6 0 .8-.3 1.1-.6l2.2-2.1 4.6 3.4c.8.5 1.4.2 1.6-.8l3-14c.3-1.2-.5-1.8-1.6-1.3zm-10.8 9.2 8.8-5.6c.4-.3.8-.1.5.2l-7.3 6.6-.3 3.1-1.7-4.3z"/>
</svg>
</span>
<span class="mss-shell-social-card-text">
<span class="mss-shell-social-card-title">Telegram</span>
<span class="mss-shell-social-card-sub">Official community</span>
</span>
</a>
</div>
</div>
</div>

<div class="mss-shell-drawer-foot">
<div class="mss-shell-drawer-foot-badges">
<span class="mss-shell-footer-badge">
<span class="mss-shell-footer-badge-dot"></span>
Blockchain Security Intelligence
</span>
<span class="mss-shell-footer-badge">Institutional Signal Layer</span>
</div>
</div>
</aside>
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

function setBodyScrollLock(open) {
const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
document.documentElement.style.setProperty("--mss-shell-scrollbar-width", `${scrollbarWidth}px`);

document.documentElement.classList.toggle("mss-shell-lock", open);
document.body.classList.toggle("mss-shell-lock", open);

if (!open) {
document.body.style.paddingRight = "";
}
}

function bindShellInteractions(header) {
if (!header || header.dataset.shellBound === "1") return;
header.dataset.shellBound = "1";

const drawer = header.querySelector("#mssShellDrawer");
const toggle = header.querySelector("#mssShellMenuToggle");
const closeBtn = header.querySelector("#mssShellDrawerClose");
const closeTargets = Array.from(header.querySelectorAll("[data-shell-close='true']"));

if (!drawer || !toggle) return;

let lastFocusedElement = null;

const setOpen = (open) => {
drawer.classList.toggle("is-open", open);
drawer.setAttribute("aria-hidden", open ? "false" : "true");
toggle.setAttribute("aria-expanded", open ? "true" : "false");
setBodyScrollLock(open);

if (open) {
lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : toggle;
window.requestAnimationFrame(() => {
closeBtn?.focus?.({ preventScroll: true });
});
} else {
window.requestAnimationFrame(() => {
(lastFocusedElement || toggle)?.focus?.({ preventScroll: true });
});
}
};

toggle.addEventListener("click", () => {
const willOpen = !drawer.classList.contains("is-open");
setOpen(willOpen);
});

closeBtn?.addEventListener("click", () => {
setOpen(false);
});

closeTargets.forEach((node) => {
node.addEventListener("click", () => {
setOpen(false);
});
});

drawer.addEventListener("click", (event) => {
const target = event.target;
if (!(target instanceof HTMLElement)) return;
if (target.dataset.shellClose === "true") {
setOpen(false);
}
});

header.addEventListener("keydown", (event) => {
if (event.key === "Escape" && drawer.classList.contains("is-open")) {
setOpen(false);
}
});

window.addEventListener("resize", () => {
if (!drawer.classList.contains("is-open")) return;
const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
document.documentElement.style.setProperty("--mss-shell-scrollbar-width", `${scrollbarWidth}px`);
});
}

export async function mountLayoutShell(options = {}) {
ensureStyles();
primeShellPlaceholders();

const headerTarget = resolveTarget(options.headerTargetId, "afterbegin");
const footerTarget = resolveTarget(options.footerTargetId, "beforeend");

if (headerTarget.mode === "target") {
if (!headerTarget.node.querySelector("#mssShellHeader")) {
injectMarkup(headerTarget, renderHeader(options));
}
headerTarget.node.style.minHeight = "";
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

const header = document.getElementById("mssShellHeader");
const footer = document.getElementById("mssShellFooter");

bindShellInteractions(header);

return { header, footer };
}

export const renderLayoutShell = mountLayoutShell;
export const initLayoutShell = mountLayoutShell;
export default mountLayoutShell;

ensureStyles();
primeShellPlaceholders();

if (document.readyState === "loading") {
document.addEventListener(
"DOMContentLoaded",
() => {
const shouldAutoMount =
document.body?.dataset?.shellAuto === "true" &&
!document.getElementById("mssShellHeader");

if (shouldAutoMount) {
void mountLayoutShell({});
}
},
{ once: true }
);
} else if (document.body?.dataset?.shellAuto === "true" && !document.getElementById("mssShellHeader")) {
void mountLayoutShell({});
}
