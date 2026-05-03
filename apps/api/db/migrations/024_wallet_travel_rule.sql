BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS wallet_classifications (
id INTEGER PRIMARY KEY AUTOINCREMENT,
wallet_address TEXT NOT NULL UNIQUE,
wallet_type TEXT NOT NULL DEFAULT 'unknown' CHECK (
wallet_type IN ('self_hosted', 'custodial', 'unknown')
),
verified_owner_profile_id INTEGER,
verification_method TEXT,
verified_at TEXT,
notes TEXT,
metadata_json TEXT,
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (verified_owner_profile_id) REFERENCES compliance_profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_wallet_classifications_wallet_type
ON wallet_classifications(wallet_type);

CREATE INDEX IF NOT EXISTS idx_wallet_classifications_verified_owner_profile_id
ON wallet_classifications(verified_owner_profile_id);

CREATE TABLE IF NOT EXISTS travel_rule_records (
id INTEGER PRIMARY KEY AUTOINCREMENT,
transfer_ref TEXT NOT NULL UNIQUE,

launch_id INTEGER,
trade_id INTEGER,

payer_profile_id INTEGER,
payer_wallet TEXT,
payer_name TEXT,

payee_profile_id INTEGER,
payee_wallet TEXT,
payee_name TEXT,
payee_institution TEXT,

wallet_type TEXT NOT NULL DEFAULT 'unknown' CHECK (
wallet_type IN ('self_hosted', 'custodial', 'unknown')
),

asset_symbol TEXT,
asset_address TEXT,
amount NUMERIC NOT NULL DEFAULT 0,

tracing_info_json TEXT,
status TEXT NOT NULL DEFAULT 'collected' CHECK (
status IN ('collected', 'pending_share', 'shared', 'failed', 'not_required')
),

shared_at TEXT,
notes TEXT,

created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

FOREIGN KEY (launch_id) REFERENCES launches(id) ON DELETE SET NULL,
FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE SET NULL,
FOREIGN KEY (payer_profile_id) REFERENCES compliance_profiles(id) ON DELETE SET NULL,
FOREIGN KEY (payee_profile_id) REFERENCES compliance_profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_travel_rule_records_launch_id
ON travel_rule_records(launch_id);

CREATE INDEX IF NOT EXISTS idx_travel_rule_records_trade_id
ON travel_rule_records(trade_id);

CREATE INDEX IF NOT EXISTS idx_travel_rule_records_payer_profile_id
ON travel_rule_records(payer_profile_id);

CREATE INDEX IF NOT EXISTS idx_travel_rule_records_payee_profile_id
ON travel_rule_records(payee_profile_id);

CREATE INDEX IF NOT EXISTS idx_travel_rule_records_payer_wallet
ON travel_rule_records(payer_wallet);

CREATE INDEX IF NOT EXISTS idx_travel_rule_records_payee_wallet
ON travel_rule_records(payee_wallet);

CREATE INDEX IF NOT EXISTS idx_travel_rule_records_status
ON travel_rule_records(status);

CREATE INDEX IF NOT EXISTS idx_travel_rule_records_created_at
ON travel_rule_records(created_at);

COMMIT;
