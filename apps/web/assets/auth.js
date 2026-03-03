// apps/web/assets/auth.js
import { apiPost } from "./api.js";

const KEY = "mssToken";

export function getToken() {
return localStorage.getItem(KEY);
}

export function setToken(token) {
localStorage.setItem(KEY, token);
}

export function clearToken() {
localStorage.removeItem(KEY);
}

export async function register(email, password) {
const out = await apiPost("/api/register", { email, password });
if (out?.token) setToken(out.token);
return out;
}

export async function login(email, password) {
const out = await apiPost("/api/login", { email, password });
if (out?.token) setToken(out.token);
return out;
}

export async function createAlert({ mint, type, direction, threshold }) {
const token = getToken();
if (!token) throw new Error("Login required");
return apiPost("/api/alerts", { mint, type, direction, threshold }, token);
}
