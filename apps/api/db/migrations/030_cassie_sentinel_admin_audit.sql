BEGIN TRANSACTION;

INSERT OR IGNORE INTO cassie_sentinel_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS cassie_admin_audit_log (
id INTEGER PRIMARY KEY AUTOINCREMENT,
actor_type TEXT NOT NULL DEFAULT 'admin',
actor_id TEXT,
action TEXT NOT NULL,
status TEXT NOT NULL DEFAULT 'ok',
target_type TEXT,
target_id TEXT,
notes TEXT,
details_json TEXT,
metadata_json TEXT,
payload_json TEXT,
old_state_json TEXT,
new_state_json TEXT,
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cassie_admin_audit_created_at
ON cassie_admin_audit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cassie_admin_audit_action
ON cassie_admin_audit_log(action);

CREATE INDEX IF NOT EXISTS idx_cassie_admin_audit_actor
ON cassie_admin_audit_log(actor_id);

CREATE INDEX IF NOT EXISTS idx_cassie_admin_audit_target
ON cassie_admin_audit_log(target_type, target_id);

COMMIT;
