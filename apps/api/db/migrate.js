import fs from "fs/promises";
import path from "path";
import db from "./index.js";

const migrationsDir = path.resolve("apps/api/db/migrations");

async function runMigrations() {
const files = (await fs.readdir(migrationsDir))
.filter((f) => f.endsWith(".sql"))
.sort();

for (const file of files) {
const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
await db.exec(sql);
console.log(`Applied migration: ${file}`);
}

console.log("Migrations complete");
process.exit(0);
}

runMigrations();
