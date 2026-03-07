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
