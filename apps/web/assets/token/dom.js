export const $ = (id) => document.getElementById(id);

export function setText(id, value) {
const el = $(id);
if (el) el.textContent = value;
}

export function setPill(id, text, state = "muted") {
const el = $(id);
if (!el) return;
el.textContent = text;

el.classList.remove("pill--good", "pill--bad", "pill--warn", "pill--muted");
if (state === "good") el.classList.add("pill--good");
else if (state === "bad") el.classList.add("pill--bad");
else if (state === "warn") el.classList.add("pill--warn");
else el.classList.add("pill--muted");
}

export function setStatus({ ok, msg, ms }) {
const dot = $("statusDot");
const text = $("statusText");
const time = $("statusTime");

if (dot) {
dot.classList.remove("dot--good", "dot--bad", "dot--warn", "dot--muted");
dot.classList.add(ok === true ? "dot--good" : ok === false ? "dot--bad" : "dot--warn");
}
if (text) text.textContent = msg || "";
if (time) time.textContent = ms != null ? `(${ms}ms)` : "";
}