import { apiPost } from "./api.js";

const TOKEN_KEY = "mssToken";
const EMAIL_KEY = "mssUserEmail";

function saveSession(token, email) {
localStorage.setItem(TOKEN_KEY, token);
if (email) localStorage.setItem(EMAIL_KEY, email);
}

export function getToken() {
return localStorage.getItem(TOKEN_KEY);
}

export function getUserEmail() {
return localStorage.getItem(EMAIL_KEY);
}

export function isLoggedIn() {
return !!getToken();
}

export function logout() {
localStorage.removeItem(TOKEN_KEY);
localStorage.removeItem(EMAIL_KEY);
}

export async function login({
email,
password,
humanCheck = false,
website = "",
turnstileToken = "",
}) {
const data = await apiPost("/api/login", {
email,
password,
humanCheck,
website,
turnstileToken,
});

if (!data?.token) {
throw new Error(data?.error || "Login failed.");
}

saveSession(data.token, data?.user?.email || email || "");
return data;
}

export async function register({
email,
password,
humanCheck = false,
website = "",
turnstileToken = "",
}) {
const data = await apiPost("/api/register", {
email,
password,
humanCheck,
website,
turnstileToken,
});

if (!data?.token) {
throw new Error(data?.error || "Registration failed.");
}

saveSession(data.token, data?.user?.email || email || "");
return data;
}

export function bindSessionUi({
sessionPillId = "sessionPill",
sessionDotId = "sessionDot",
sessionTextId = "sessionText",
logoutBtnId = "logoutBtn",
loggedOutHref = "./login.html",
loggedInHref = "./index.html#access",
onLogout = null,
} = {}) {
const pill = document.getElementById(sessionPillId);
const dot = document.getElementById(sessionDotId);
const text = document.getElementById(sessionTextId);
const logoutBtn = document.getElementById(logoutBtnId);

function render() {
const token = getToken();
const email = getUserEmail();

if (token) {
if (dot) {
dot.classList.remove("warn");
dot.classList.add("good");
}
if (text) text.textContent = "Account";
if (pill) {
pill.setAttribute("title", email || "Logged in");
pill.setAttribute("aria-label", email ? `Account: ${email}` : "Account");
}
if (logoutBtn) logoutBtn.style.display = "inline-flex";
} else {
if (dot) {
dot.classList.remove("good");
dot.classList.add("warn");
}
if (text) text.textContent = "Login";
if (pill) {
pill.setAttribute("title", "Login");
pill.setAttribute("aria-label", "Login");
}
if (logoutBtn) logoutBtn.style.display = "none";
}
}

if (pill) {
pill.addEventListener("click", () => {
window.location.href = isLoggedIn() ? loggedInHref : loggedOutHref;
});
}

if (logoutBtn) {
logoutBtn.addEventListener("click", () => {
logout();
render();
if (typeof onLogout === "function") onLogout();
});
}

render();
}
