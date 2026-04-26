function hideTokenMarketSection() {
const section = document.getElementById("tokenMarketSection");

if (section) {
section.style.display = "none";
section.setAttribute("aria-hidden", "true");
}
}

export async function initTokenMarket() {
hideTokenMarketSection();

return {
refresh() {
hideTokenMarketSection();
return null;
},

setMint() {
hideTokenMarketSection();
return null;
},

setInterval() {
hideTokenMarketSection();
return null;
},

destroy() {
hideTokenMarketSection();
},

getState() {
return {
disabled: true,
reason: "Scanner token market chart disabled for external token scans",
};
},
};
}

export default initTokenMarket;
