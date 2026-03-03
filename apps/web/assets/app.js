document.addEventListener("DOMContentLoaded", () => {
const btn = document.getElementById("scanBtn");
const input = document.getElementById("tokenInput");
const results = document.getElementById("results");

if (!btn) return;

btn.addEventListener("click", () => {
const address = input.value.trim();

if (!address) {
alert("Paste a Solana token address");
return;
}

// Mock scan result (Step 1)
const mock = {
name: "Urban Pancake",
symbol: "UPAN",
supply: "1,000,000,000",
mint: "Revoked",
lp: "Locked",
score: "82 / 100",
flags: [
"Mint authority revoked",
"LP locked 90%",
"No freeze authority",
"Fresh deploy (2h old)"
]
};

document.getElementById("r-name").innerText = mock.name;
document.getElementById("r-symbol").innerText = mock.symbol;
document.getElementById("r-supply").innerText = mock.supply;
document.getElementById("r-mint").innerText = mock.mint;
document.getElementById("r-lp").innerText = mock.lp;
document.getElementById("r-score").innerText = mock.score;

const flagsEl = document.getElementById("r-flags");
flagsEl.innerHTML = "";
mock.flags.forEach(f => {
const li = document.createElement("li");
li.textContent = f;
flagsEl.appendChild(li);
});

results.classList.remove("hidden");
});
});