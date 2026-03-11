import fs from "fs/promises";
import path from "path";
import db from "./index.js";

const migrationsDir = path.resolve("apps/api/db/migrations");

async function ensureMigrationsTable() {
await db.exec(`
CREATE TABLE IF NOT EXISTS migrations (
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT NOT NULL UNIQUE,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);
}

async function runMigrations() {
await ensureMigrationsTable();

const appliedRows = await db.all(`SELECT name FROM migrations`);
const applied = new Set(appliedRows.map((r) => r.name));

const files = (await fs.readdir(migrationsDir))
.filter((f) => f.endsWith(".sql"))
.sort();

for (const file of files) {
if (applied.has(file)) {
console.log(`Skipped migration (already applied): ${file}`);
continue;
}

const fullPath = path.join(migrationsDir, file);
const sql = await fs.readFile(fullPath, "utf8");

await db.exec(sql);

await db.run(`INSERT INTO migrations (name) VALUES (?)`, [file]);

console.log(`Applied migration: ${file}`);
}

console.log("Migrations complete");
process.exit(0);
}

runMigrations().catch((err) => {
console.error("Migration failed:", err);
process.exit(1);
});