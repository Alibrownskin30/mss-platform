export function isSensitiveRoute(path) {
return (
path.startsWith("/api/auth") ||
path.startsWith("/api/alerts") ||
path.startsWith("/api/admin")
);
}