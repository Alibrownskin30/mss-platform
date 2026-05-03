import db from "../../db/index.js";

function cleanText(value, max = 500) {
return String(value ?? "").trim().slice(0, max);
}

function stringifyJson(value) {
if (value === null || value === undefined) return null;
try {
return JSON.stringify(value);
} catch {
return JSON.stringify({ error: "failed_to_serialize" });
}
}

function normalizeObjectId(value) {
if (value === null || value === undefined) return "";
return String(value).trim();
}

function normalizeActorId(value) {
if (value === null || value === undefined || value === "") return null;
return String(value).trim().slice(0, 255) || null;
}

export async function logComplianceEvent({
actorType = "system",
actorId = null,
action,
objectType,
objectId,
oldState = null,
newState = null,
policyVersion = null,
ipAddress = null,
notes = null,
} = {}) {
const normalizedAction = cleanText(action, 120);
const normalizedObjectType = cleanText(objectType, 120);
const normalizedObjectId = normalizeObjectId(objectId);

if (!normalizedAction) {
throw new Error("auditLog.logComplianceEvent requires action");
}

if (!normalizedObjectType) {
throw new Error("auditLog.logComplianceEvent requires objectType");
}

if (!normalizedObjectId) {
throw new Error("auditLog.logComplianceEvent requires objectId");
}

const normalizedActorType = cleanText(actorType || "system", 80) || "system";

const result = await db.run(
`
INSERT INTO compliance_events (
actor_type,
actor_id,
action,
object_type,
object_id,
old_state_json,
new_state_json,
policy_version,
ip_address,
notes
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
[
normalizedActorType,
normalizeActorId(actorId),
normalizedAction,
normalizedObjectType,
normalizedObjectId,
stringifyJson(oldState),
stringifyJson(newState),
cleanText(policyVersion, 120) || null,
cleanText(ipAddress, 120) || null,
cleanText(notes, 2000) || null,
]
);

return {
ok: true,
id: result?.lastID ?? null,
};
}

export async function logCaseEvent({
actorType = "system",
actorId = null,
action,
caseId,
oldState = null,
newState = null,
policyVersion = null,
ipAddress = null,
notes = null,
} = {}) {
return logComplianceEvent({
actorType,
actorId,
action,
objectType: "compliance_case",
objectId: caseId,
oldState,
newState,
policyVersion,
ipAddress,
notes,
});
}

export async function logProfileEvent({
actorType = "system",
actorId = null,
action,
profileId,
oldState = null,
newState = null,
policyVersion = null,
ipAddress = null,
notes = null,
} = {}) {
return logComplianceEvent({
actorType,
actorId,
action,
objectType: "compliance_profile",
objectId: profileId,
oldState,
newState,
policyVersion,
ipAddress,
notes,
});
}

export async function listRecentComplianceEvents({
objectType = null,
objectId = null,
limit = 50,
} = {}) {
const safeLimit = Math.max(1, Math.min(500, Number.parseInt(limit, 10) || 50));
const filters = [];
const params = [];

if (objectType) {
filters.push("object_type = ?");
params.push(cleanText(objectType, 120));
}

if (objectId !== null && objectId !== undefined && objectId !== "") {
filters.push("object_id = ?");
params.push(String(objectId).trim());
}

const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

return db.all(
`
SELECT
id,
actor_type,
actor_id,
action,
object_type,
object_id,
old_state_json,
new_state_json,
policy_version,
ip_address,
notes,
created_at
FROM compliance_events
${whereClause}
ORDER BY id DESC
LIMIT ?
`,
[...params, safeLimit]
);
}

export default {
logComplianceEvent,
logCaseEvent,
logProfileEvent,
listRecentComplianceEvents,
};
