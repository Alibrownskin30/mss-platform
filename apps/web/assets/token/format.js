export function fmtUsd(n) {
if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
const v = Number(n);
if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
if (v >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
if (v >= 1) return `$${v.toFixed(6)}`;
return `$${v.toFixed(8)}`;
}

export function fmtNum(n) {
if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
const v = Number(n);
if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
return `${v.toFixed(2)}`;
}

export function fmtPct(n, dp = 2) {
if (n == null || Number.isNaN(Number(n))) return "—";
return `${Number(n).toFixed(dp)}%`;
}

export function shortAddr(s, left = 5, right = 5) {
if (!s || typeof s !== "string") return "—";
if (s.length <= left + right + 3) return s;
return `${s.slice(0, left)}…${s.slice(-right)}`;
}
