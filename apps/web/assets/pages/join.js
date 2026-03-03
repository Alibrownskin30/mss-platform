// Fairlaunch Join / Commit Gate (Demo)
// Stores per-token join state in localStorage so it persists across refresh.

function qs(id){ return document.getElementById(id); }

function getTokenId(){
const url = new URL(window.location.href);
return url.searchParams.get("id") || "examplecoin";
}

function loadState(tokenId){
const key = `mss-join-${tokenId}`;
const raw = localStorage.getItem(key);
if(raw){
try { return JSON.parse(raw); } catch(e){}
}
// default demo state (seeded)
return {
minJoin: 100,
joinedCount: 34,
totalCommittedUsd: 340,
launchStartAt: Date.now() + 25 * 60 * 1000, // 25 minutes from now
extensionsUsed: 0,
maxExtensions: 3,
extendMinutes: 10,
myJoined: false,
myCommitUsd: 0
};
}

function saveState(tokenId, state){
localStorage.setItem(`mss-join-${tokenId}`, JSON.stringify(state));
}

function fmtTime(ms){
if(ms <= 0) return "00:00";
const s = Math.floor(ms/1000);
const m = Math.floor(s/60);
const r = s % 60;
const hh = Math.floor(m/60);
const mm = m % 60;
if(hh > 0) return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
return `${String(mm).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
}

function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }

function render(state){
const pct = clamp((state.joinedCount / state.minJoin) * 100, 0, 100);

qs("jCount").textContent = String(state.joinedCount);
qs("jMin").textContent = String(state.minJoin);
qs("jTotal").textContent = `$${state.totalCommittedUsd.toFixed(0)}`;
qs("jPct").textContent = pct.toFixed(0);
qs("jFill").style.width = `${pct}%`;

const ready = state.joinedCount >= state.minJoin;
qs("jStatus").textContent = ready ? "READY" : "NOT READY";

// Buttons
qs("btnJoin").disabled = state.myJoined;
qs("btnLeave").disabled = !state.myJoined;

// Note
qs("jCountdownNote").textContent = ready
? "Minimum met — launch stays on schedule"
: `Auto-extends +${state.extendMinutes}m (used ${state.extensionsUsed}/${state.maxExtensions}) if minimum not met`;
}

function tick(tokenId, state){
const now = Date.now();
let remaining = state.launchStartAt - now;

// If time is up and not enough joins, extend (up to maxExtensions)
if(remaining <= 0 && state.joinedCount < state.minJoin){
if(state.extensionsUsed < state.maxExtensions){
state.extensionsUsed += 1;
state.launchStartAt = Date.now() + state.extendMinutes * 60 * 1000;
saveState(tokenId, state);
} else {
// After max extensions, push the launch date (demo: +24h)
state.launchStartAt = Date.now() + 24 * 60 * 60 * 1000;
state.extensionsUsed = 0; // reset extension counter for the new window
saveState(tokenId, state);
}
remaining = state.launchStartAt - Date.now();
}

qs("jCountdown").textContent = fmtTime(remaining);
}

function bind(tokenId, state){
qs("btnJoin").addEventListener("click", () => {
if(state.myJoined) return;

const commit = Number(qs("commitAmount").value || 10);
if(commit < 10){
alert("Minimum commit is $10.");
return;
}

state.myJoined = true;
state.myCommitUsd = commit;
state.joinedCount += 1;
state.totalCommittedUsd += commit;

saveState(tokenId, state);
render(state);
});

qs("btnLeave").addEventListener("click", () => {
if(!state.myJoined) return;

// Remove your commit (demo only)
state.myJoined = false;
state.joinedCount = Math.max(0, state.joinedCount - 1);
state.totalCommittedUsd = Math.max(0, state.totalCommittedUsd - state.myCommitUsd);
state.myCommitUsd = 0;

saveState(tokenId, state);
render(state);
});
}

function init(){
// only run if token join widgets exist
if(!qs("btnJoin") || !qs("jCount")) return;

const tokenId = getTokenId();
const state = loadState(tokenId);

render(state);
bind(tokenId, state);

setInterval(() => tick(tokenId, state), 500);
}

init();