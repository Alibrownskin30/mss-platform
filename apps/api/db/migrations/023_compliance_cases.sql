BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS compliance_cases (
id INTEGER PRIMARY KEY AUTOINCREMENT,
case_type TEXT NOT NULL CHECK (
case_type IN ('customer', 'builder', 'launch', 'transaction')
),
compliance_profile_id INTEGER,
launch_id INTEGER,

status TEXT NOT NULL DEFAULT 'open' CHECK (
status IN ('open', 'pending_info', 'approved', 'rejected', 'escalated', 'frozen')
),

risk_score REAL NOT NULL DEFAULT 0,
risk_level TEXT NOT NULL DEFAULT 'low' CHECK (
risk_level IN ('low', 'medium', 'high', 'critical')
),

review_reason TEXT,
resolution_note TEXT,

assigned_to TEXT,
approved_by TEXT,

approved_at TEXT,
rejected_at TEXT,
frozen_at TEXT,
escalated_at TEXT,

created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

FOREIGN KEY (compliance_profile_id) REFERENCES compliance_profiles(id) ON DELETE SET NULL,
FOREIGN KEY (launch_id) REFERENCES launches(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_compliance_cases_case_type
ON compliance_cases(case_type);

CREATE INDEX IF NOT EXISTS idx_compliance_cases_status
ON compliance_cases(status);

CREATE INDEX IF NOT EXISTS idx_compliance_cases_risk_level
ON compliance_cases(risk_level);

CREATE INDEX IF NOT EXISTS idx_compliance_cases_profile_id
ON compliance_cases(compliance_profile_id);

CREATE INDEX IF NOT EXISTS idx_compliance_cases_launch_id
ON compliance_cases(launch_id);

CREATE INDEX IF NOT EXISTS idx_compliance_cases_created_at
ON compliance_cases(created_at);

CREATE TABLE IF NOT EXISTS compliance_events (
id INTEGER PRIMARY KEY AUTOINCREMENT,

actor_type TEXT NOT NULL,
actor_id TEXT,

action TEXT NOT NULL,

object_type TEXT NOT NULL,
object_id TEXT NOT NULL,

old_state_json TEXT,
new_state_json TEXT,

policy_version TEXT,
ip_address TEXT,
notes TEXT,

created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_compliance_events_actor_type
ON compliance_events(actor_type);

CREATE INDEX IF NOT EXISTS idx_compliance_events_action
ON compliance_events(action);

CREATE INDEX IF NOT EXISTS idx_compliance_events_object
ON compliance_events(object_type, object_id);

CREATE INDEX IF NOT EXISTS idx_compliance_events_created_at
ON compliance_events(created_at);

COMMIT;
