import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function cleanText(value, max = 1000) {
return String(value ?? "").trim().slice(0, max);
}

function resolveDbPath() {
const explicitPath = cleanText(
process.env.DB_PATH ||
process.env.LAUNCHER_DB_PATH ||
process.env.MSS_DB_PATH ||
process.env.DATABASE_PATH,
1000
);

if (explicitPath) {
return explicitPath === ":memory:" ? explicitPath : path.resolve(explicitPath);
}

return path.join(__dirname, "launcher.db");
}

function normalizeParams(params = []) {
if (params === undefined || params === null) return [];
return Array.isArray(params) ? params : [params];
}

const dbPath = resolveDbPath();

if (dbPath !== ":memory:") {
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

const rawDb = new Database(dbPath);

try {
rawDb.pragma("foreign_keys = ON");
rawDb.pragma("busy_timeout = 5000");

if (dbPath !== ":memory:") {
rawDb.pragma("journal_mode = WAL");
}
} catch (error) {
console.warn("[db] SQLite pragma setup warning:", error?.message || error);
}

const db = {
get(sql, params = []) {
return rawDb.prepare(sql).get(...normalizeParams(params));
},

all(sql, params = []) {
return rawDb.prepare(sql).all(...normalizeParams(params));
},

run(sql, params = []) {
const result = rawDb.prepare(sql).run(...normalizeParams(params));

return {
...result,
lastID: result.lastInsertRowid,
lastInsertRowid: result.lastInsertRowid,
changes: result.changes,
};
},

exec(sql) {
return rawDb.exec(sql);
},

prepare(sql) {
return rawDb.prepare(sql);
},

transaction(fn) {
return rawDb.transaction(fn);
},

pragma(statement) {
return rawDb.pragma(statement);
},

close() {
return rawDb.close();
},

raw: rawDb,
};

console.log(`[db] Connected to SQLite database: ${dbPath}`);

export { dbPath, rawDb };
export default db;
