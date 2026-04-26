import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import db, { dbPath } from "./index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationsDir = path.join(__dirname, "migrations");

async function ensureMigrationsTable() {
await db.exec(`
CREATE TABLE IF NOT EXISTS migrations (
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT NOT NULL UNIQUE,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);
}

function stripLeadingSqlComments(sql = "") {
return String(sql)
.replace(/^\s*--.*$/gm, "")
.replace(/\/\*[\s\S]*?\*\//g, "")
.trim();
}

function hasExplicitTransaction(sql = "") {
const clean = stripLeadingSqlComments(sql);
return /^BEGIN\b/i.test(clean) || /\bBEGIN\s+TRANSACTION\b/i.test(clean);
}

async function runMigrationFile({ file, sql }) {
const migrationOwnsTransaction = hasExplicitTransaction(sql);

if (migrationOwnsTransaction) {
await db.exec(sql);
await db.run(`INSERT INTO migrations (name) VALUES (?)`, [file]);
return;
}

await db.exec("BEGIN");

try {
await db.exec(sql);
await db.run(`INSERT INTO migrations (name) VALUES (?)`, [file]);
await db.exec("COMMIT");
} catch (error) {
await db.exec("ROLLBACK");
throw error;
}
}

async function runMigrations() {
console.log(`[migrate] Database: ${dbPath}`);
console.log(`[migrate] Migrations directory: ${migrationsDir}`);

await ensureMigrationsTable();

const appliedRows = await db.all(`SELECT name FROM migrations`);
const applied = new Set(appliedRows.map((r) => r.name));

const files = (await fs.readdir(migrationsDir))
.filter((f) => f.endsWith(".sql"))
.sort();

for (const file of files) {
if (applied.has(file)) {
console.log(`[migrate] Skipped: ${file}`);
continue;
}

const fullPath = path.join(migrationsDir, file);
const sql = await fs.readFile(fullPath, "utf8");

try {
await runMigrationFile({ file, sql });
console.log(`[migrate] Applied: ${file}`);
} catch (error) {
console.error(`[migrate] Failed at ${file}:`, error);
throw error;
}
}

console.log("[migrate] Migrations complete");
}

runMigrations()
.then(() => {
process.exit(0);
})
.catch((err) => {
console.error("[migrate] Migration failed:", err);
process.exit(1);
});
