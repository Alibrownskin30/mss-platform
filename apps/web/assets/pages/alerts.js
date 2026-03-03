// Alerts Subscription (Demo) + Paywall (Pro required)
// Stores subscription state locally with a 30-day expiry.

function $(id){ return document.getElementById(id); }

const KEY = "mss-alerts-sub";

function load(){
const raw = localStorage.getItem(KEY);
if(!raw) return null;
try { return JSON.parse(raw); } catch(e){ return null; }
}
function save(obj){
localStorage.setItem(KEY, JSON.stringify(obj));
}
function clear(){
localStorage.removeItem(KEY);
}
function fmtTime(ms){
if(ms <= 0) return "Expired";
const d = Math.floor(ms / (24*60*60*1000));
const h = Math.floor((ms % (24*60*60*1000)) / (60*60*1000));
return d > 0 ? `${d}d ${h}h` : `${Math.floor(ms/60000)}m`;
}

function planPrice(plan){
if(plan === "basic") return 9;
if(plan === "pro") return 19;
return 49;
}

function render(){
const sub = load();
if(!$("aStatus")) return;

if(!sub){
$("aStatus").textContent = "Inactive";
$("aExpires").textContent = "—";
return;
}

const remaining = sub.expiresAt - Date.now();
$("aStatus").textContent = remaining > 0 ? `Active (${sub.plan})` : "Expired";
$("aExpires").textContent = fmtTime(remaining);
}

function init(){
if(!$("btnSub")) return;

// -------- Paywall gate (Pro+) --------
if(window.MSS?.account && !window.MSS.account.requirePlan("pro")){
window.MSS.checkout({
title: "Upgrade to Pro for Alerts",
desc: "Alerts are Pro+ only. Upgrade to unlock launch + stage notifications.",
priceUsd: 19,
onSuccess: () => {
window.MSS.account.setPlan("pro");
alert("✅ Upgraded to Pro (demo). Refreshing…");
window.location.reload();
}
});
return; // stop page init until upgraded
}
// -----------------------------------

const planEl = $("plan");
const priceBox = $("priceBox");

function updatePrice(){
const price = planPrice(planEl.value);
priceBox.textContent = `$${price} / month`;
}
planEl.addEventListener("change", updatePrice);
updatePrice();

$("btnSub").addEventListener("click", () => {
const tg = ($("tgUser").value || "").trim();
if(!tg || !tg.startsWith("@")){
alert("Enter a Telegram username starting with @");
return;
}

const plan = planEl.value;
const renew = $("renew").value;

// 30 days
const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

save({ tg, plan, renew, expiresAt, createdAt: Date.now() });
alert("Subscription activated (demo). Next: SOL/MSS payment + real Telegram bot.");
render();
});

$("btnCancel").addEventListener("click", () => {
clear();
alert("Subscription cancelled (demo).");
render();
});

$("btnTest").addEventListener("click", () => {
const sub = load();
if(!sub){
alert("No subscription. Activate first.");
return;
}
alert(`✅ TEST ALERT (demo)\nSending to: ${sub.tg}\nPlan: ${sub.plan}\nEvent: New launch scheduled in 10 minutes`);
});

render();
setInterval(render, 1000 * 30);
}

init();