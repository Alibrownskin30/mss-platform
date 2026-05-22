import express from "express"
import crypto from "node:crypto"
import db from "../db/index.js"

const router = express.Router()

const CODE_TYPE_SET = new Set(["trial", "partner", "comp", "admin", "standard"])
const ENTITLEMENT_STATUS_SET = new Set([
"active",
"expired",
"revoked",
"scheduled",
])
const REDEMPTION_STATUS_SET = new Set(["success", "failed", "revoked"])

const TABLE_INFO_SQL = {
sentinel_access_codes: `PRAGMA table_info(sentinel_access_codes)`,
sentinel_code_redemptions: `PRAGMA table_info(sentinel_code_redemptions)`,
sentinel_entitlements: `PRAGMA table_info(sentinel_entitlements)`,
cassie_admin_audit_log: `PRAGMA table_info(cassie_admin_audit_log)`,
mss_users: `PRAGMA table_info(mss_users)`,
}

const ACCESS_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max)
}

function parseIntSafe(value, fallback = null) {
const num = Number.parseInt(value, 10)
return Number.isFinite(num) ? num : fallback
}

function parseBool(value, fallback = false) {
if (typeof value === "boolean") return value
if (value === 1 || value === "1" || value === "true") return true
if (value === 0 || value === "0" || value === "false") return false
return fallback
}

function parseJson(value, fallback = null) {
if (value == null || value === "") return fallback
if (typeof value === "object") return value

try {
return JSON.parse(value)
} catch {
return fallback
}
}

function normalizeCodeType(value, fallback = "trial") {
const normalized = cleanText(value, 64).toLowerCase()
return CODE_TYPE_SET.has(normalized) ? normalized : fallback
}

function normalizeEntitlementStatus(value, fallback = "active") {
const normalized = cleanText(value, 64).toLowerCase()
return ENTITLEMENT_STATUS_SET.has(normalized) ? normalized : fallback
}

function normalizeAccessCodeInput(code) {
return cleanText(code, 128).replace(/\s+/g, "").toUpperCase()
}

function getInsertId(result) {
return (
Number(result?.lastID || 0) ||
Number(result?.lastId || 0) ||
Number(result?.insertId || 0) ||
Number(result?.lastInsertRowid || 0) ||
null
)
}

function buildCodeState(row = {}) {
const isActive = parseBool(row?.is_active, false)
const redeemedCount = Number(row?.redeemed_count || 0)
const maxRedemptions = Number(row?.max_redemptions || 0)
const now = Date.now()

const startsAtTs = row?.starts_at ? new Date(row.starts_at).getTime() : null
const expiresAtTs = row?.expires_at
? new Date(row.expires_at).getTime()
: null

if (!isActive) return "inactive"
if (startsAtTs && !Number.isNaN(startsAtTs) && startsAtTs > now) {
return "scheduled"
}
if (expiresAtTs && !Number.isNaN(expiresAtTs) && expiresAtTs <= now) {
return "expired"
}
if (maxRedemptions > 0 && redeemedCount >= maxRedemptions) {
return "exhausted"
}

return "active"
}

function isLiveEntitlement(row = {}) {
const status = cleanText(row?.status, 64).toLowerCase()

if (status !== "active") return false

const now = Date.now()
const startsAtTs = row?.starts_at ? new Date(row.starts_at).getTime() : null
const endsAtTs = row?.ends_at ? new Date(row.ends_at).getTime() : null

if (startsAtTs && !Number.isNaN(startsAtTs) && startsAtTs > now) {
return false
}

if (endsAtTs && !Number.isNaN(endsAtTs) && endsAtTs <= now) {
return false
}

return true
}

function serializeCode(row) {
if (!row) return null

return {
id: Number(row.id || 0),
code: cleanText(row.code, 128) || null,
code_type: cleanText(row.code_type, 64) || "trial",
plan_key: cleanText(row.plan_key, 120) || null,
plan_label: cleanText(row.plan_label, 120) || null,
duration_days: Number(row.duration_days || 0),
max_redemptions: Number(row.max_redemptions || 0),
redeemed_count: Number(row.redeemed_count || 0),
remaining_redemptions: Math.max(
0,
Number(row.max_redemptions || 0) - Number(row.redeemed_count || 0)
),
bound_user_id:
row.bound_user_id == null ? null : Number(row.bound_user_id),
bound_user_email: cleanText(row.bound_user_email, 320) || null,
is_active: parseBool(row.is_active, false),
starts_at: row.starts_at || null,
expires_at: row.expires_at || null,
notes: cleanText(row.notes, 2000) || null,
metadata: parseJson(row.metadata_json, null),
created_by_user_id:
row.created_by_user_id == null
? null
: Number(row.created_by_user_id),
created_at: row.created_at || null,
updated_at: row.updated_at || null,
state: buildCodeState(row),
}
}

function serializeRedemption(row) {
if (!row) return null

const redemptionStatus = cleanText(
row.redemption_status,
64
).toLowerCase()

return {
id: Number(row.id || 0),
code_id: Number(row.code_id || 0),
code: cleanText(row.code, 128) || null,
user_id: Number(row.user_id || 0),
user_email: cleanText(row.user_email, 320) || null,
entitlement_id:
row.entitlement_id == null ? null : Number(row.entitlement_id),
wallet_address_at_redeem:
cleanText(row.wallet_address_at_redeem, 128) || null,
redeemed_at: row.redeemed_at || null,
redemption_status: REDEMPTION_STATUS_SET.has(redemptionStatus)
? redemptionStatus
: "success",
created_at: row.created_at || null,
updated_at: row.updated_at || null,
}
}

function serializeEntitlement(row) {
if (!row) return null

const status = cleanText(row.status, 64).toLowerCase()

return {
id: Number(row.id || 0),
user_id: Number(row.user_id || 0),
user_email: cleanText(row.user_email, 320) || null,
source_type: cleanText(row.source_type, 64) || null,
source_code_id:
row.source_code_id == null ? null : Number(row.source_code_id),
plan_key: cleanText(row.plan_key, 120) || null,
access_tier: cleanText(row.access_tier, 120) || null,
status: ENTITLEMENT_STATUS_SET.has(status) ? status : "active",
starts_at: row.starts_at || null,
ends_at: row.ends_at || null,
trial_flag: parseBool(row.trial_flag, false),
revoke_reason: cleanText(row.revoke_reason, 500) || null,
created_at: row.created_at || null,
updated_at: row.updated_at || null,
}
}

function serializeAudit(row) {
if (!row) return null

return {
id: Number(row.id || 0),
actor_type: cleanText(row.actor_type, 120) || null,
actor_id: cleanText(row.actor_id, 255) || null,
action: cleanText(row.action, 120) || null,
status: cleanText(row.status, 64) || null,
target_type: cleanText(row.target_type, 120) || null,
target_id: cleanText(row.target_id, 255) || null,
notes: cleanText(row.notes, 2000) || null,
details_json: parseJson(row.details_json, null),
metadata_json: parseJson(row.metadata_json, null),
payload_json: parseJson(row.payload_json, null),
old_state_json: parseJson(row.old_state_json, null),
new_state_json: parseJson(row.new_state_json, null),
created_at: row.created_at || null,
}
}

async function tableExists(tableName) {
const row = await db.get(
`
SELECT name
FROM sqlite_master
WHERE type = 'table'
AND name = ?
LIMIT 1
`,
[tableName]
)

return Boolean(row?.name)
}

async function getTableColumns(tableName) {
const sql = TABLE_INFO_SQL[tableName]

if (!sql) return new Set()

try {
const rows = await db.all(sql)

return new Set((rows || []).map((row) => row?.name).filter(Boolean))
} catch {
return new Set()
}
}

function randomCodeChunk(length = 4) {
let out = ""

while (out.length < length) {
const buffer = crypto.randomBytes(length)

for (const byte of buffer) {
out += ACCESS_CODE_ALPHABET[byte % ACCESS_CODE_ALPHABET.length]

if (out.length >= length) break
}
}

return out
}

async function codeExists(code) {
const row = await db.get(
`
SELECT id
FROM sentinel_access_codes
WHERE code = ?
LIMIT 1
`,
[normalizeAccessCodeInput(code)]
)

return Boolean(row?.id)
}

async function generateUniqueAccessCode(prefix = "MSS") {
const cleanPrefix =
cleanText(prefix, 24).replace(/[^A-Za-z0-9]/g, "").toUpperCase() ||
"MSS"

for (let attempt = 0; attempt < 20; attempt += 1) {
const candidate = `${cleanPrefix}-${randomCodeChunk(4)}-${randomCodeChunk(
4
)}-${randomCodeChunk(4)}`

if (!(await codeExists(candidate))) {
return candidate
}
}

throw new Error("Failed to generate a unique access code")
}

async function resolveBoundUser({ boundUserId, boundEmail } = {}) {
const id = parseIntSafe(boundUserId, null)

if (id) {
const row = await db.get(
`
SELECT id, email
FROM mss_users
WHERE id = ?
LIMIT 1
`,
[id]
)

if (!row) {
throw new Error("Bound user was not found")
}

return {
id: Number(row.id),
email: cleanText(row.email, 320).toLowerCase() || null,
}
}

const email = cleanText(boundEmail, 320).toLowerCase()

if (email) {
const row = await db.get(
`
SELECT id, email
FROM mss_users
WHERE email = ?
LIMIT 1
`,
[email]
)

if (!row) {
throw new Error("Bound user email was not found")
}

return {
id: Number(row.id),
email: cleanText(row.email, 320).toLowerCase() || null,
}
}

return {
id: null,
email: null,
}
}

/*
This router must remain mounted behind requireSentinelAccessAdminGate in
server.js. The extra local guard below prevents accidental unprotected
mounting from silently exposing tester-access controls.
*/
function requireMountedAdminGate(req, res, next) {
if (req.adminGate?.ok) {
return next()
}

return res.status(401).json({
ok: false,
error: "admin_session_required",
message: "Authenticated Sentinel Access administration is required.",
login_required: true,
login_path: "/admin-login.html",
})
}

function getActorId(req) {
return cleanText(req.adminGate?.actor, 255) || "authenticated-admin"
}

function getAdminAuditContext(req) {
return {
auth_type: cleanText(req.adminGate?.authType, 64) || "unknown",
scope: cleanText(req.adminGate?.scope, 64) || "sentinel_access",
session_id: cleanText(req.adminGate?.sessionId, 120) || null,
scopes: Array.isArray(req.adminGate?.scopes)
? req.adminGate.scopes.map((scope) => cleanText(scope, 64)).filter(Boolean)
: [],
}
}

async function listCodes({ limit = 100, filters = {} } = {}) {
const sqlFilters = []
const params = []

const stateFilter = cleanText(filters.state, 32).toLowerCase()
const codeType = cleanText(filters.code_type, 64).toLowerCase()
const isActiveFilter =
filters.is_active == null || filters.is_active === ""
? null
: parseBool(filters.is_active, false)
const boundUserId = parseIntSafe(filters.bound_user_id, null)
const search = cleanText(filters.search, 128).toUpperCase()

if (codeType) {
sqlFilters.push(`c.code_type = ?`)
params.push(codeType)
}

if (isActiveFilter != null) {
sqlFilters.push(`c.is_active = ?`)
params.push(isActiveFilter ? 1 : 0)
}

if (boundUserId) {
sqlFilters.push(`c.bound_user_id = ?`)
params.push(boundUserId)
}

if (search) {
sqlFilters.push(`(
UPPER(c.code) LIKE ?
OR UPPER(COALESCE(c.plan_key, '')) LIKE ?
OR UPPER(COALESCE(c.plan_label, '')) LIKE ?
OR UPPER(COALESCE(u.email, '')) LIKE ?
)`)

params.push(
`%${search}%`,
`%${search}%`,
`%${search}%`,
`%${search}%`
)
}

const whereSql = sqlFilters.length
? `WHERE ${sqlFilters.join(" AND ")}`
: ""

const rows = await db.all(
`
SELECT
c.*,
u.email AS bound_user_email
FROM sentinel_access_codes c
LEFT JOIN mss_users u
ON u.id = c.bound_user_id
${whereSql}
ORDER BY datetime(c.created_at) DESC, c.id DESC
LIMIT ?
`,
[...params, Math.max(1, Math.min(Number(limit || 100), 500))]
)

let items = (rows || []).map(serializeCode)

if (stateFilter) {
items = items.filter(
(item) => cleanText(item.state, 32).toLowerCase() === stateFilter
)
}

return items
}

async function getCodeById(codeId) {
const row = await db.get(
`
SELECT
c.*,
u.email AS bound_user_email
FROM sentinel_access_codes c
LEFT JOIN mss_users u
ON u.id = c.bound_user_id
WHERE c.id = ?
LIMIT 1
`,
[codeId]
)

return serializeCode(row)
}

async function listRedemptions({
limit = 100,
codeId = null,
userId = null,
} = {}) {
const filters = []
const params = []

if (codeId) {
filters.push(`r.code_id = ?`)
params.push(codeId)
}

if (userId) {
filters.push(`r.user_id = ?`)
params.push(userId)
}

const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : ""

const rows = await db.all(
`
SELECT
r.*,
c.code,
u.email AS user_email
FROM sentinel_code_redemptions r
LEFT JOIN sentinel_access_codes c
ON c.id = r.code_id
LEFT JOIN mss_users u
ON u.id = r.user_id
${whereSql}
ORDER BY datetime(r.redeemed_at) DESC, r.id DESC
LIMIT ?
`,
[...params, Math.max(1, Math.min(Number(limit || 100), 500))]
)

return (rows || []).map(serializeRedemption)
}

async function listEntitlements({
limit = 100,
codeId = null,
userId = null,
status = null,
} = {}) {
const filters = []
const params = []

if (codeId) {
filters.push(`e.source_code_id = ?`)
params.push(codeId)
}

if (userId) {
filters.push(`e.user_id = ?`)
params.push(userId)
}

const normalizedStatus = cleanText(status, 64).toLowerCase()

if (normalizedStatus && ENTITLEMENT_STATUS_SET.has(normalizedStatus)) {
filters.push(`e.status = ?`)
params.push(normalizedStatus)
}

const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : ""

const rows = await db.all(
`
SELECT
e.*,
u.email AS user_email
FROM sentinel_entitlements e
LEFT JOIN mss_users u
ON u.id = e.user_id
${whereSql}
ORDER BY datetime(e.created_at) DESC, e.id DESC
LIMIT ?
`,
[...params, Math.max(1, Math.min(Number(limit || 100), 500))]
)

return (rows || []).map(serializeEntitlement)
}

async function listAccessAudit({
limit = 100,
codeId = null,
action = null,
actorId = null,
status = null,
targetType = null,
} = {}) {
if (!(await tableExists("cassie_admin_audit_log"))) {
return []
}

const filters = [`action LIKE 'sentinel_access_%'`]
const params = []

if (codeId != null) {
filters.push(`target_id = ?`)
params.push(String(codeId))
}

const safeAction = cleanText(action, 120)

if (safeAction) {
filters.push(`action = ?`)
params.push(safeAction)
}

const safeActorId = cleanText(actorId, 255)

if (safeActorId) {
filters.push(`actor_id = ?`)
params.push(safeActorId)
}

const safeStatus = cleanText(status, 64)

if (safeStatus) {
filters.push(`status = ?`)
params.push(safeStatus)
}

const safeTargetType = cleanText(targetType, 120)

if (safeTargetType) {
filters.push(`target_type = ?`)
params.push(safeTargetType)
}

const rows = await db.all(
`
SELECT *
FROM cassie_admin_audit_log
WHERE ${filters.join(" AND ")}
ORDER BY datetime(created_at) DESC, id DESC
LIMIT ?
`,
[...params, Math.max(1, Math.min(Number(limit || 100), 500))]
)

return (rows || []).map(serializeAudit)
}

async function insertAdminAudit({
action,
actorId = "authenticated-admin",
status = "ok",
notes = null,
targetType = null,
targetId = null,
details = null,
oldState = null,
newState = null,
} = {}) {
if (!(await tableExists("cassie_admin_audit_log"))) {
return
}

const columns = await getTableColumns("cassie_admin_audit_log")

if (!columns.size) return

const candidateValues = {
actor_type: "admin",
actor_id: cleanText(actorId, 255) || "authenticated-admin",
action: cleanText(action, 120),
status: cleanText(status, 64),
target_type: cleanText(targetType, 120) || null,
target_id: targetId == null ? null : cleanText(String(targetId), 255),
notes: notes ? cleanText(notes, 2000) : null,
details_json: JSON.stringify(details ?? {}),
metadata_json: JSON.stringify(details ?? {}),
payload_json: JSON.stringify(details ?? {}),
old_state_json: JSON.stringify(oldState ?? null),
new_state_json: JSON.stringify(newState ?? null),
}

const insertColumns = []
const placeholders = []
const values = []

for (const [column, value] of Object.entries(candidateValues)) {
if (!columns.has(column)) continue

insertColumns.push(column)
placeholders.push("?")
values.push(value)
}

if (columns.has("created_at")) {
insertColumns.push("created_at")
placeholders.push("CURRENT_TIMESTAMP")
}

if (!insertColumns.length) return

await db.run(
`
INSERT INTO cassie_admin_audit_log (
${insertColumns.join(", ")}
) VALUES (
${placeholders.join(", ")}
)
`,
values
)
}

function validateTimeWindow({ startsAt, expiresAt }) {
if (!startsAt || !expiresAt) return

const startTs = new Date(startsAt).getTime()
const endTs = new Date(expiresAt).getTime()

if (Number.isNaN(startTs) || Number.isNaN(endTs)) {
throw new Error("starts_at and expires_at must be valid ISO dates")
}

if (endTs <= startTs) {
throw new Error("expires_at must be later than starts_at")
}
}

router.use(requireMountedAdminGate)

router.get("/summary", async (req, res) => {
try {
const [codes, redemptions, entitlements] = await Promise.all([
listCodes({ limit: 500 }),
listRedemptions({ limit: 500 }),
listEntitlements({ limit: 500 }),
])

const summary = {
total_codes: codes.length,
active_codes: codes.filter((item) => item.state === "active").length,
scheduled_codes: codes.filter((item) => item.state === "scheduled")
.length,
exhausted_codes: codes.filter((item) => item.state === "exhausted")
.length,
expired_codes: codes.filter((item) => item.state === "expired").length,
inactive_codes: codes.filter((item) => item.state === "inactive").length,
total_redemptions: redemptions.length,
active_entitlements: entitlements.filter(
(item) => item.status === "active"
).length,
live_entitlements: entitlements.filter(isLiveEntitlement).length,
revoked_entitlements: entitlements.filter(
(item) => item.status === "revoked"
).length,
expired_entitlements: entitlements.filter(
(item) => item.status === "expired"
).length,
scheduled_entitlements: entitlements.filter(
(item) => item.status === "scheduled"
).length,
}

return res.json({
ok: true,
summary,
})
} catch (error) {
console.error("GET /api/sentinel-access-admin/summary failed", error)

return res.status(500).json({
ok: false,
error: "Failed to load Sentinel access summary",
message: error?.message || String(error),
})
}
})

router.get("/codes", async (req, res) => {
try {
const limit = Math.max(
1,
Math.min(parseIntSafe(req.query.limit, 100) || 100, 500)
)

const codes = await listCodes({
limit,
filters: {
state: req.query.state,
code_type: req.query.code_type,
is_active: req.query.is_active,
bound_user_id: req.query.bound_user_id,
search: req.query.search,
},
})

return res.json({
ok: true,
count: codes.length,
codes,
})
} catch (error) {
console.error("GET /api/sentinel-access-admin/codes failed", error)

return res.status(500).json({
ok: false,
error: "Failed to load Sentinel access codes",
message: error?.message || String(error),
})
}
})

router.get("/codes/:id", async (req, res) => {
try {
const id = parseIntSafe(req.params.id, null)

if (!id) {
return res.status(400).json({
ok: false,
error: "Valid code id is required",
})
}

const code = await getCodeById(id)

if (!code) {
return res.status(404).json({
ok: false,
error: "Access code not found",
})
}

const [redemptions, entitlements, audit] = await Promise.all([
listRedemptions({ limit: 100, codeId: id }),
listEntitlements({ limit: 100, codeId: id }),
listAccessAudit({ limit: 100, codeId: id }),
])

return res.json({
ok: true,
code,
redemptions,
entitlements,
audit,
})
} catch (error) {
console.error("GET /api/sentinel-access-admin/codes/:id failed", error)

return res.status(500).json({
ok: false,
error: "Failed to load Sentinel access code detail",
message: error?.message || String(error),
})
}
})

router.post("/codes", async (req, res) => {
try {
const actorId = getActorId(req)
const auditContext = getAdminAuditContext(req)
const notes = cleanText(req.body?.notes, 2000) || null

const quantity = Math.max(
1,
Math.min(parseIntSafe(req.body?.quantity, 1) || 1, 100)
)

const prefix = cleanText(req.body?.prefix, 24) || "MSS"
const codeType = normalizeCodeType(req.body?.code_type, "trial")
const planKey =
cleanText(req.body?.plan_key, 120) || "sentinel_early_access"
const planLabel =
cleanText(req.body?.plan_label, 120) || "Sentinel Early Access"
const durationDays = Math.max(
0,
parseIntSafe(req.body?.duration_days, 7) ?? 7
)
const maxRedemptions = Math.max(
1,
parseIntSafe(req.body?.max_redemptions, 1) ?? 1
)
const isActive = parseBool(req.body?.is_active, true)
const startsAt = cleanText(req.body?.starts_at, 64) || null
const expiresAt = cleanText(req.body?.expires_at, 64) || null

const metadata =
req.body?.metadata_json != null
? parseJson(req.body.metadata_json, {})
: req.body?.metadata != null
? req.body.metadata
: {}

const customCode = normalizeAccessCodeInput(req.body?.custom_code)

validateTimeWindow({ startsAt, expiresAt })

if (customCode && quantity !== 1) {
return res.status(400).json({
ok: false,
error: "custom_code can only be used when quantity is 1",
})
}

const boundUser = await resolveBoundUser({
boundUserId: req.body?.bound_user_id,
boundEmail: req.body?.bound_user_email || req.body?.bound_email,
})

if (customCode && (await codeExists(customCode))) {
return res.status(409).json({
ok: false,
error: "Access code already exists",
})
}

const columns = await getTableColumns("sentinel_access_codes")

if (!columns.size) {
throw new Error("Unable to inspect sentinel_access_codes schema")
}

const createdCodes = []

await db.run("BEGIN IMMEDIATE")

try {
for (let index = 0; index < quantity; index += 1) {
const code = customCode || (await generateUniqueAccessCode(prefix))

const fieldMap = {
code,
code_type: codeType,
plan_key: planKey,
plan_label: planLabel,
duration_days: durationDays,
max_redemptions: maxRedemptions,
redeemed_count: 0,
bound_user_id: boundUser.id,
is_active: isActive ? 1 : 0,
starts_at: startsAt,
expires_at: expiresAt,
notes,
metadata_json: JSON.stringify(metadata ?? {}),
created_by_user_id: parseIntSafe(
req.body?.created_by_user_id,
null
),
}

const insertColumns = []
const placeholders = []
const values = []

for (const [column, value] of Object.entries(fieldMap)) {
if (!columns.has(column)) continue

insertColumns.push(column)
placeholders.push("?")
values.push(value)
}

if (columns.has("created_at")) {
insertColumns.push("created_at")
placeholders.push("CURRENT_TIMESTAMP")
}

if (columns.has("updated_at")) {
insertColumns.push("updated_at")
placeholders.push("CURRENT_TIMESTAMP")
}

const result = await db.run(
`
INSERT INTO sentinel_access_codes (
${insertColumns.join(", ")}
) VALUES (
${placeholders.join(", ")}
)
`,
values
)

const insertedId = getInsertId(result)
const inserted = await getCodeById(insertedId)

if (inserted) {
createdCodes.push(inserted)
}
}

await db.run("COMMIT")
} catch (error) {
try {
await db.run("ROLLBACK")
} catch {}

throw error
}

await insertAdminAudit({
action: "sentinel_access_code_created",
actorId,
status: "ok",
notes,
targetType: "sentinel_access_code",
targetId: createdCodes.length === 1 ? createdCodes[0]?.id : "batch",
details: {
...auditContext,
quantity,
code_type: codeType,
plan_key: planKey,
max_redemptions: maxRedemptions,
duration_days: durationDays,
bound_user_id: boundUser.id,
},
newState: createdCodes,
})

return res.status(201).json({
ok: true,
count: createdCodes.length,
codes: createdCodes,
})
} catch (error) {
console.error("POST /api/sentinel-access-admin/codes failed", error)

return res.status(500).json({
ok: false,
error: "Failed to create Sentinel access code(s)",
message: error?.message || String(error),
})
}
})

router.patch("/codes/:id", async (req, res) => {
try {
const actorId = getActorId(req)
const auditContext = getAdminAuditContext(req)
const id = parseIntSafe(req.params.id, null)

if (!id) {
return res.status(400).json({
ok: false,
error: "Valid code id is required",
})
}

const before = await getCodeById(id)

if (!before) {
return res.status(404).json({
ok: false,
error: "Access code not found",
})
}

const boundUser = await resolveBoundUser({
boundUserId: req.body?.bound_user_id,
boundEmail: req.body?.bound_user_email || req.body?.bound_email,
})

const columns = await getTableColumns("sentinel_access_codes")

if (!columns.size) {
throw new Error("Unable to inspect sentinel_access_codes schema")
}

const patch = {}
let auditNotes = cleanText(req.body?.notes, 2000) || before.notes || null

if ("code_type" in (req.body || {})) {
patch.code_type = normalizeCodeType(
req.body?.code_type,
before.code_type || "trial"
)
}

if ("plan_key" in (req.body || {})) {
patch.plan_key = cleanText(req.body?.plan_key, 120) || null
}

if ("plan_label" in (req.body || {})) {
patch.plan_label = cleanText(req.body?.plan_label, 120) || null
}

if ("duration_days" in (req.body || {})) {
const value = parseIntSafe(req.body?.duration_days, null)

if (value == null || value < 0) {
return res.status(400).json({
ok: false,
error: "duration_days must be zero or greater",
})
}

patch.duration_days = value
}

if ("max_redemptions" in (req.body || {})) {
const value = parseIntSafe(req.body?.max_redemptions, null)

if (value == null || value < 1) {
return res.status(400).json({
ok: false,
error: "max_redemptions must be at least 1",
})
}

if (value < Number(before.redeemed_count || 0)) {
return res.status(400).json({
ok: false,
error: "max_redemptions cannot be lower than redeemed_count",
})
}

patch.max_redemptions = value
}

if ("is_active" in (req.body || {})) {
patch.is_active = parseBool(req.body?.is_active, before.is_active)
? 1
: 0
}

if ("starts_at" in (req.body || {})) {
patch.starts_at = cleanText(req.body?.starts_at, 64) || null
}

if ("expires_at" in (req.body || {})) {
patch.expires_at = cleanText(req.body?.expires_at, 64) || null
}

if ("notes" in (req.body || {})) {
patch.notes = cleanText(req.body?.notes, 2000) || null
auditNotes = patch.notes
}

if (
"metadata" in (req.body || {}) ||
"metadata_json" in (req.body || {})
) {
const metadata =
req.body?.metadata_json != null
? parseJson(req.body.metadata_json, {})
: parseJson(req.body.metadata, {})

patch.metadata_json = JSON.stringify(metadata ?? {})
}

if (
"bound_user_id" in (req.body || {}) ||
"bound_user_email" in (req.body || {}) ||
"bound_email" in (req.body || {})
) {
patch.bound_user_id = boundUser.id
}

validateTimeWindow({
startsAt: "starts_at" in patch ? patch.starts_at : before.starts_at,
expiresAt:
"expires_at" in patch ? patch.expires_at : before.expires_at,
})

if (!Object.keys(patch).length) {
return res.status(400).json({
ok: false,
error: "No valid fields were provided for update",
})
}

const assignments = []
const values = []

for (const [column, value] of Object.entries(patch)) {
if (!columns.has(column)) continue

assignments.push(`${column} = ?`)
values.push(value)
}

if (columns.has("updated_at")) {
assignments.push(`updated_at = CURRENT_TIMESTAMP`)
}

if (!assignments.length) {
return res.status(400).json({
ok: false,
error: "No writable fields are available in sentinel_access_codes",
})
}

await db.run(
`
UPDATE sentinel_access_codes
SET ${assignments.join(", ")}
WHERE id = ?
`,
[...values, id]
)

const after = await getCodeById(id)

await insertAdminAudit({
action: "sentinel_access_code_updated",
actorId,
status: "ok",
notes: auditNotes,
targetType: "sentinel_access_code",
targetId: id,
details: auditContext,
oldState: before,
newState: after,
})

return res.json({
ok: true,
code: after,
})
} catch (error) {
console.error("PATCH /api/sentinel-access-admin/codes/:id failed", error)

return res.status(500).json({
ok: false,
error: "Failed to update Sentinel access code",
message: error?.message || String(error),
})
}
})

router.post("/codes/:id/bind-user", async (req, res) => {
try {
const actorId = getActorId(req)
const auditContext = getAdminAuditContext(req)
const id = parseIntSafe(req.params.id, null)
const notes =
cleanText(req.body?.notes, 2000) || "Access code bound to user"

if (!id) {
return res.status(400).json({
ok: false,
error: "Valid code id is required",
})
}

const before = await getCodeById(id)

if (!before) {
return res.status(404).json({
ok: false,
error: "Access code not found",
})
}

const boundUser = await resolveBoundUser({
boundUserId: req.body?.bound_user_id,
boundEmail: req.body?.bound_user_email || req.body?.bound_email,
})

if (!boundUser.id) {
return res.status(400).json({
ok: false,
error: "bound_user_id or bound_user_email is required",
})
}

await db.run(
`
UPDATE sentinel_access_codes
SET
bound_user_id = ?,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[boundUser.id, id]
)

const after = await getCodeById(id)

await insertAdminAudit({
action: "sentinel_access_code_bound",
actorId,
status: "ok",
notes,
targetType: "sentinel_access_code",
targetId: id,
oldState: before,
newState: after,
details: {
...auditContext,
bound_user_id: boundUser.id,
bound_user_email: boundUser.email,
},
})

return res.json({
ok: true,
code: after,
})
} catch (error) {
console.error(
"POST /api/sentinel-access-admin/codes/:id/bind-user failed",
error
)

return res.status(500).json({
ok: false,
error: "Failed to bind Sentinel access code to user",
message: error?.message || String(error),
})
}
})

router.post("/codes/:id/unbind-user", async (req, res) => {
try {
const actorId = getActorId(req)
const auditContext = getAdminAuditContext(req)
const id = parseIntSafe(req.params.id, null)
const notes =
cleanText(req.body?.notes, 2000) || "Access code unbound from user"

if (!id) {
return res.status(400).json({
ok: false,
error: "Valid code id is required",
})
}

const before = await getCodeById(id)

if (!before) {
return res.status(404).json({
ok: false,
error: "Access code not found",
})
}

await db.run(
`
UPDATE sentinel_access_codes
SET
bound_user_id = NULL,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[id]
)

const after = await getCodeById(id)

await insertAdminAudit({
action: "sentinel_access_code_unbound",
actorId,
status: "ok",
notes,
targetType: "sentinel_access_code",
targetId: id,
details: auditContext,
oldState: before,
newState: after,
})

return res.json({
ok: true,
code: after,
})
} catch (error) {
console.error(
"POST /api/sentinel-access-admin/codes/:id/unbind-user failed",
error
)

return res.status(500).json({
ok: false,
error: "Failed to unbind Sentinel access code from user",
message: error?.message || String(error),
})
}
})

router.post("/codes/:id/disable", async (req, res) => {
try {
const actorId = getActorId(req)
const auditContext = getAdminAuditContext(req)
const id = parseIntSafe(req.params.id, null)
const notes = cleanText(req.body?.notes, 2000) || null

if (!id) {
return res.status(400).json({
ok: false,
error: "Valid code id is required",
})
}

const before = await getCodeById(id)

if (!before) {
return res.status(404).json({
ok: false,
error: "Access code not found",
})
}

await db.run(
`
UPDATE sentinel_access_codes
SET
is_active = 0,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[id]
)

const after = await getCodeById(id)

await insertAdminAudit({
action: "sentinel_access_code_disabled",
actorId,
status: "ok",
notes,
targetType: "sentinel_access_code",
targetId: id,
details: auditContext,
oldState: before,
newState: after,
})

return res.json({
ok: true,
code: after,
})
} catch (error) {
console.error(
"POST /api/sentinel-access-admin/codes/:id/disable failed",
error
)

return res.status(500).json({
ok: false,
error: "Failed to disable Sentinel access code",
message: error?.message || String(error),
})
}
})

router.post("/codes/:id/enable", async (req, res) => {
try {
const actorId = getActorId(req)
const auditContext = getAdminAuditContext(req)
const id = parseIntSafe(req.params.id, null)
const notes = cleanText(req.body?.notes, 2000) || null

if (!id) {
return res.status(400).json({
ok: false,
error: "Valid code id is required",
})
}

const before = await getCodeById(id)

if (!before) {
return res.status(404).json({
ok: false,
error: "Access code not found",
})
}

await db.run(
`
UPDATE sentinel_access_codes
SET
is_active = 1,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[id]
)

const after = await getCodeById(id)

await insertAdminAudit({
action: "sentinel_access_code_enabled",
actorId,
status: "ok",
notes,
targetType: "sentinel_access_code",
targetId: id,
details: auditContext,
oldState: before,
newState: after,
})

return res.json({
ok: true,
code: after,
})
} catch (error) {
console.error(
"POST /api/sentinel-access-admin/codes/:id/enable failed",
error
)

return res.status(500).json({
ok: false,
error: "Failed to enable Sentinel access code",
message: error?.message || String(error),
})
}
})

router.post("/codes/:id/revoke", async (req, res) => {
try {
const actorId = getActorId(req)
const auditContext = getAdminAuditContext(req)
const id = parseIntSafe(req.params.id, null)
const notes =
cleanText(req.body?.notes, 2000) || "Access code revoked by admin"

if (!id) {
return res.status(400).json({
ok: false,
error: "Valid code id is required",
})
}

const before = await getCodeById(id)

if (!before) {
return res.status(404).json({
ok: false,
error: "Access code not found",
})
}

const beforeEntitlements = await listEntitlements({
limit: 200,
codeId: id,
})

await db.run("BEGIN IMMEDIATE")

try {
await db.run(
`
UPDATE sentinel_access_codes
SET
is_active = 0,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`,
[id]
)

await db.run(
`
UPDATE sentinel_entitlements
SET
status = 'revoked',
revoke_reason = ?,
updated_at = CURRENT_TIMESTAMP
WHERE source_code_id = ?
AND status IN ('active', 'scheduled')
`,
[notes, id]
)

await db.run(
`
UPDATE sentinel_code_redemptions
SET
redemption_status = 'revoked',
updated_at = CURRENT_TIMESTAMP
WHERE code_id = ?
AND redemption_status = 'success'
`,
[id]
)

await db.run("COMMIT")
} catch (error) {
try {
await db.run("ROLLBACK")
} catch {}

throw error
}

const [after, entitlements, redemptions] = await Promise.all([
getCodeById(id),
listEntitlements({ limit: 200, codeId: id }),
listRedemptions({ limit: 200, codeId: id }),
])

await insertAdminAudit({
action: "sentinel_access_code_revoked",
actorId,
status: "ok",
notes,
targetType: "sentinel_access_code",
targetId: id,
details: auditContext,
oldState: {
code: before,
entitlements: beforeEntitlements,
},
newState: {
code: after,
entitlements,
redemptions,
},
})

return res.json({
ok: true,
code: after,
entitlements,
redemptions,
})
} catch (error) {
console.error(
"POST /api/sentinel-access-admin/codes/:id/revoke failed",
error
)

return res.status(500).json({
ok: false,
error: "Failed to revoke Sentinel access code",
message: error?.message || String(error),
})
}
})

router.get("/redemptions", async (req, res) => {
try {
const limit = Math.max(
1,
Math.min(parseIntSafe(req.query.limit, 100) || 100, 500)
)

const codeId = parseIntSafe(req.query.code_id, null)
const userId = parseIntSafe(req.query.user_id, null)

const redemptions = await listRedemptions({
limit,
codeId,
userId,
})

return res.json({
ok: true,
count: redemptions.length,
redemptions,
})
} catch (error) {
console.error("GET /api/sentinel-access-admin/redemptions failed", error)

return res.status(500).json({
ok: false,
error: "Failed to load Sentinel code redemptions",
message: error?.message || String(error),
})
}
})

router.get("/entitlements", async (req, res) => {
try {
const limit = Math.max(
1,
Math.min(parseIntSafe(req.query.limit, 100) || 100, 500)
)

const codeId = parseIntSafe(req.query.code_id, null)
const userId = parseIntSafe(req.query.user_id, null)
const status = normalizeEntitlementStatus(req.query.status, "")

const entitlements = await listEntitlements({
limit,
codeId,
userId,
status,
})

return res.json({
ok: true,
count: entitlements.length,
entitlements,
})
} catch (error) {
console.error("GET /api/sentinel-access-admin/entitlements failed", error)

return res.status(500).json({
ok: false,
error: "Failed to load Sentinel entitlements",
message: error?.message || String(error),
})
}
})

router.get("/audit", async (req, res) => {
try {
const limit = Math.max(
1,
Math.min(parseIntSafe(req.query.limit, 100) || 100, 500)
)

const codeId = parseIntSafe(req.query.code_id, null)

const audit = await listAccessAudit({
limit,
codeId,
action: req.query.action,
actorId: req.query.actor_id,
status: req.query.status,
targetType: req.query.target_type,
})

return res.json({
ok: true,
count: audit.length,
audit,
})
} catch (error) {
console.error("GET /api/sentinel-access-admin/audit failed", error)

return res.status(500).json({
ok: false,
error: "Failed to load Sentinel access audit",
message: error?.message || String(error),
})
}
})

router.post("/codes/:id/revoke-entitlements", async (req, res) => {
try {
const actorId = getActorId(req)
const auditContext = getAdminAuditContext(req)
const id = parseIntSafe(req.params.id, null)
const notes = cleanText(req.body?.notes, 2000) || "Revoked by admin"

if (!id) {
return res.status(400).json({
ok: false,
error: "Valid code id is required",
})
}

const code = await getCodeById(id)

if (!code) {
return res.status(404).json({
ok: false,
error: "Access code not found",
})
}

const beforeEntitlements = await listEntitlements({
limit: 200,
codeId: id,
})

await db.run("BEGIN IMMEDIATE")

try {
await db.run(
`
UPDATE sentinel_entitlements
SET
status = 'revoked',
revoke_reason = ?,
updated_at = CURRENT_TIMESTAMP
WHERE source_code_id = ?
AND status IN ('active', 'scheduled')
`,
[notes, id]
)

await db.run(
`
UPDATE sentinel_code_redemptions
SET
redemption_status = 'revoked',
updated_at = CURRENT_TIMESTAMP
WHERE code_id = ?
AND redemption_status = 'success'
`,
[id]
)

await db.run("COMMIT")
} catch (error) {
try {
await db.run("ROLLBACK")
} catch {}

throw error
}

const [entitlements, redemptions] = await Promise.all([
listEntitlements({ limit: 100, codeId: id }),
listRedemptions({ limit: 100, codeId: id }),
])

await insertAdminAudit({
action: "sentinel_access_entitlements_revoked",
actorId,
status: "ok",
notes,
targetType: "sentinel_access_code",
targetId: id,
details: auditContext,
oldState: {
source_code_id: id,
entitlements: beforeEntitlements,
},
newState: {
source_code_id: id,
entitlements,
redemptions,
},
})

return res.json({
ok: true,
code,
entitlements,
redemptions,
})
} catch (error) {
console.error(
"POST /api/sentinel-access-admin/codes/:id/revoke-entitlements failed",
error
)

return res.status(500).json({
ok: false,
error: "Failed to revoke entitlements for this access code",
message: error?.message || String(error),
})
}
})

export default router
