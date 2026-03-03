// Upcoming Launches (Demo)
// Renders a launch list with countdowns + links to token profile & join.

function $(id){ return document.getElementById(id); }
function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }

function rankKey(rank){
if(rank === "AAA") return 4;
if(rank === "AA") return 3;
if(rank === "A") return 2;
return 1;
}
function badgeClass(rank){
const r = (rank || "").toLowerCase();
if(r === "aaa") return "aaa";
if(r === "aa") return "aa";
if(r === "a") return "a";
return "risky";
}
function fmtTime(ms){
if(ms <= 0) return "LIVE";
const s = Math.floor(ms/1000);
const m = Math.floor(s/60);
const r = s % 60;
const hh = Math.floor(m/60);
const mm = m % 60;
if(hh > 0) return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
return `${String(mm).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
}

const LAUNCHES = [
{ id:"examplecoin", name:"ExampleCoin", symbol:"EXM", rank:"AAA", stage:"Stage 1", startAt: Date.now() + 18*60*1000, minJoin: 100 },
{ id:"safedog", name:"SafeDog", symbol:"SDOG", rank:"AA", stage:"Stage 2", startAt: Date.now() + 42*60*1000, minJoin: 100 },
{ id:"alphacat", name:"AlphaCat", symbol:"ACAT", rank:"AA", stage:"Stage 1", startAt: Date.now() + 75*60*1000, minJoin: 100 },
{ id:"mssrocket", name:"MSS Rocket", symbol:"ROKT", rank:"A", stage:"Stage 3", startAt: Date.now() + 140*60*1000, minJoin: 100 },
];

function getJoinState(tokenId){
const raw = localStorage.getItem(`mss-join-${tokenId}`);
if(!raw) return null;
try { return JSON.parse(raw); } catch(e){ return null; }
}

function render(){
const grid = $("launchGrid");
if(!grid) return;

const q = ($("lSearch")?.value || "").trim().toLowerCase();
const sort = ($("lSort")?.value || "soonest");

let items = LAUNCHES.slice();

if(q){
items = items.filter(x => x.name.toLowerCase().includes(q) || x.symbol.toLowerCase().includes(q));
}

// decorate with join counts (from localStorage demo state)
items = items.map(x => {
const st = getJoinState(x.id);
const joined = st?.joinedCount ?? Math.floor(Math.random()*60)+10;
return { ...x, joined };
});

if(sort === "soonest"){
items.sort((a,b) => a.startAt - b.startAt);
} else if(sort === "mostJoined"){
items.sort((a,b) => b.joined - a.joined);
} else if(sort === "rank"){
items.sort((a,b) => rankKey(b.rank) - rankKey(a.rank));
}

// stats
$("lActive").textContent = String(items.length);
const next = items[0];
$("lNext").textContent = next ? `${next.symbol}` : "—";

grid.innerHTML = items.map(x => {
const remaining = x.startAt - Date.now();
const pct = clamp((x.joined / x.minJoin) * 100, 0, 100);
const ready = x.joined >= x.minJoin;

return `
<div class="token-card">
<div class="token-head">
<div>
<div class="token-name">${x.name}</div>
<div class="token-symbol">${x.symbol} • ${x.stage}</div>
</div>
<div class="badge ${badgeClass(x.rank)}">${x.rank}</div>
</div>

<div class="kv" style="margin-top:12px;">
<div>
<div class="k">Starts In</div>
<div class="v">${fmtTime(remaining)}</div>
</div>
<div>
<div class="k">Joined</div>
<div class="v">${x.joined}/${x.minJoin} ${ready ? "✅" : ""}</div>
</div>
<div style="grid-column:1/3;">
<div class="progress" style="margin-top:8px;">
<div class="progress-fill" style="width:${pct}%;"></div>
</div>
</div>
</div>

<div class="token-actions">
<a class="btn small primary" href="./token.html?id=${encodeURIComponent(x.id)}">View</a>
<a class="btn small" href="./alerts.html">Alerts</a>
</div>
</div>
`;
}).join("");
}

function init(){
if(!$("launchGrid")) return;
$("lSearch")?.addEventListener("input", render);
$("lSort")?.addEventListener("change", render);
render();
setInterval(render, 1000); // live countdown
}

init();