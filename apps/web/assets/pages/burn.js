// Burn dashboard logic (Demo)

function $(id){ return document.getElementById(id); }

function nextMonday8UTC(){
const now = new Date();
// get UTC day (0 Sun..6 Sat)
const day = now.getUTCDay();
const diff = (8 - day) % 7; // days until next Monday (1). We'll compute properly below.
// Better: compute next Monday explicitly
const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 0, 0));
// Move to Monday
const currentDay = d.getUTCDay();
const daysToMon = (1 - currentDay + 7) % 7;
d.setUTCDate(d.getUTCDate() + daysToMon);
// If already past this week's Monday 8 UTC, add 7 days
if(d.getTime() <= now.getTime()){
d.setUTCDate(d.getUTCDate() + 7);
}
return d;
}

function fmtCountdown(ms){
if(ms <= 0) return "00:00:00";
const s = Math.floor(ms/1000);
const h = Math.floor(s/3600);
const m = Math.floor((s%3600)/60);
const r = s%60;
return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
}

function loadBurnState(){
const raw = localStorage.getItem("mss-burn-state");
if(raw){
try { return JSON.parse(raw); } catch(e){}
}
// demo numbers
return {
created: 6,
feesTotalUsd: 1299,
burnedTotalUsd: 820,
weekAllocationUsd: 210,
history: [
{ date:"2026-02-03", amountUsd: 180, tx:"(proof later)" },
{ date:"2026-02-10", amountUsd: 210, tx:"(proof later)" },
{ date:"2026-02-17", amountUsd: 230, tx:"(proof later)" },
{ date:"2026-02-24", amountUsd: 200, tx:"(proof later)" },
]
};
}

function renderTable(state){
const wrap = $("bTable");
if(!wrap) return;
const rows = state.history.map(h => `
<tr>
<td>${h.date}</td>
<td>$${Number(h.amountUsd).toFixed(0)}</td>
<td class="muted">${h.tx}</td>
</tr>
`).join("");

wrap.innerHTML = `
<table style="width:100%; border-collapse:collapse;">
<thead>
<tr>
<th style="text-align:left; padding:10px; border-bottom:1px solid var(--border);">Date (UTC)</th>
<th style="text-align:left; padding:10px; border-bottom:1px solid var(--border);">Burned</th>
<th style="text-align:left; padding:10px; border-bottom:1px solid var(--border);">Proof</th>
</tr>
</thead>
<tbody>${rows}</tbody>
</table>
`;
}

function init(){
if(!$("bNext")) return;

const state = loadBurnState();

$("bCreated").textContent = String(state.created);
$("bFees").textContent = `$${Number(state.feesTotalUsd).toFixed(0)}`;
$("bBurned").textContent = `$${Number(state.burnedTotalUsd).toFixed(0)}`;
$("bWeek").textContent = `$${Number(state.weekAllocationUsd).toFixed(0)}`;

renderTable(state);

const next = nextMonday8UTC();
function tick(){
const ms = next.getTime() - Date.now();
$("bNext").textContent = fmtCountdown(ms);
}
tick();
setInterval(tick, 1000);
}

init();