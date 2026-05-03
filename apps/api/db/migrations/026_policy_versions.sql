BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS policy_versions (
id INTEGER PRIMARY KEY AUTOINCREMENT,
policy_type TEXT NOT NULL,
version TEXT NOT NULL,
approved_by TEXT,
approved_at TEXT,
effective_at TEXT,
document_hash TEXT,
notes TEXT,
metadata_json TEXT,
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_versions_type_version
ON policy_versions(policy_type, version);

CREATE INDEX IF NOT EXISTS idx_policy_versions_policy_type
ON policy_versions(policy_type);

CREATE INDEX IF NOT EXISTS idx_policy_versions_effective_at
ON policy_versions(effective_at);

CREATE INDEX IF NOT EXISTS idx_policy_versions_created_at
ON policy_versions(created_at);

COMMIT;
