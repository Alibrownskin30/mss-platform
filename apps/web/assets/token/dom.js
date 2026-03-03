export const $ = (id) => document.getElementById(id);

export function setText(id, value) {
const el = $(id);
if (el) el.textContent = value;
}

export function setDot(dotId, state) {
const dot = $(dotId);
if (!dot) return;
dot.classList.remove("good", "warn", "bad");
if (state) dot.classList.add(state);
}

export function setBadge(dotId, textId, state, text) {
setDot(dotId, state);
setText(textId, text);
}
