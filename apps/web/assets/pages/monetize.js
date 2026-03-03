// Monetisation core (Demo)
// Plan + credits stored in localStorage.
// Later: swap this logic to wallet payments (SOL/MSS) + server verification.

(function(){
const KEY = "mss-account";
const DEFAULT = { plan: "free", credits: 0, updatedAt: Date.now() };

function load(){
const raw = localStorage.getItem(KEY);
if(!raw) return { ...DEFAULT };
try { return { ...DEFAULT, ...JSON.parse(raw) }; } catch(e){ return { ...DEFAULT }; }
}
function save(state){
state.updatedAt = Date.now();
localStorage.setItem(KEY, JSON.stringify(state));
}

// Public helpers
window.MSS = window.MSS || {};
window.MSS.account = {
get: () => load(),
setPlan: (plan) => { const s=load(); s.plan=plan; save(s); },
addCredits: (n) => { const s=load(); s.credits = Math.max(0, (s.credits||0)+n); save(s); },
spendCredit: () => { const s=load(); if((s.credits||0)<=0) return false; s.credits -= 1; save(s); return true; },
requirePlan: (min) => {
const order = { free:0, pro:1, whale:2 };
const s = load();
return order[s.plan] >= order[min];
}
};

// Simple modal checkout (demo)
window.MSS.checkout = function({ title, desc, priceUsd, onSuccess }){
const overlay = document.createElement("div");
overlay.className = "modal-overlay";
overlay.innerHTML = `
<div class="modal">
<div class="modal-head">
<div class="modal-title">${title}</div>
<button class="btn small" id="mClose">✕</button>
</div>
<div class="muted">${desc}</div>

<div class="card soft" style="margin-top:12px;">
<div class="k">Pay with</div>
<div class="payrow">
<button class="btn small" id="paySOL">SOL (demo)</button>
<button class="btn small" id="payMSS">MSS token (demo)</button>
</div>
<div class="pricebox" style="margin-top:10px;">$${priceUsd} USD</div>
<div class="muted" style="margin-top:8px;">This is UI-only right now. Next step: real wallet payment + verification.</div>
</div>

<div class="token-actions" style="margin-top:14px;">
<button class="btn primary" id="mConfirm">Confirm (Demo)</button>
<button class="btn" id="mCancel">Cancel</button>
</div>
</div>
`;
document.body.appendChild(overlay);

const close = () => overlay.remove();
overlay.querySelector("#mClose").onclick = close;
overlay.querySelector("#mCancel").onclick = close;
overlay.onclick = (e) => { if(e.target === overlay) close(); };

overlay.querySelector("#mConfirm").onclick = () => {
close();
if(typeof onSuccess === "function") onSuccess();
};
};
})();