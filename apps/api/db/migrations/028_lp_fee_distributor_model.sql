BEGIN TRANSACTION;

ALTER TABLE launches ADD COLUMN lp_fee_beneficiary_wallet TEXT;
ALTER TABLE launches ADD COLUMN lp_fee_beneficiary_type TEXT DEFAULT 'builder';
ALTER TABLE launches ADD COLUMN lp_fee_controller_type TEXT DEFAULT 'mss_distributor';
ALTER TABLE launches ADD COLUMN lp_fee_distribution_model TEXT DEFAULT 'raydium_lp_fees_to_builder_via_mss_distributor';
ALTER TABLE launches ADD COLUMN lp_fee_source TEXT DEFAULT 'raydium_lp';
ALTER TABLE launches ADD COLUMN lp_fee_distributor_enabled INTEGER DEFAULT 1;
ALTER TABLE launches ADD COLUMN lp_fee_distributor_status TEXT DEFAULT 'pending';
ALTER TABLE launches ADD COLUMN lp_fee_distributor_address TEXT;
ALTER TABLE launches ADD COLUMN lp_fee_distributor_program TEXT;
ALTER TABLE launches ADD COLUMN lp_fee_distributor_tx TEXT;
ALTER TABLE launches ADD COLUMN lp_fee_last_distributed_at TEXT;
ALTER TABLE launches ADD COLUMN lp_fee_last_distribution_tx TEXT;
ALTER TABLE launches ADD COLUMN lp_fee_total_distributed_sol REAL DEFAULT 0;
ALTER TABLE launches ADD COLUMN lp_fee_pending_sol REAL DEFAULT 0;
ALTER TABLE launches ADD COLUMN builder_can_remove_lp INTEGER DEFAULT 0;
ALTER TABLE launches ADD COLUMN builder_receives_lp_fees INTEGER DEFAULT 1;
ALTER TABLE launches ADD COLUMN builder_lp_fee_wallet TEXT;
ALTER TABLE launches ADD COLUMN launch_fee_model TEXT DEFAULT 'successful_launch_fee';
ALTER TABLE launches ADD COLUMN launch_fee_notes TEXT;

ALTER TABLE launch_liquidity_lifecycle ADD COLUMN lp_fee_beneficiary_wallet TEXT;
ALTER TABLE launch_liquidity_lifecycle ADD COLUMN lp_fee_beneficiary_type TEXT DEFAULT 'builder';
ALTER TABLE launch_liquidity_lifecycle ADD COLUMN lp_fee_controller_type TEXT DEFAULT 'mss_distributor';
ALTER TABLE launch_liquidity_lifecycle ADD COLUMN lp_fee_distribution_model TEXT DEFAULT 'raydium_lp_fees_to_builder_via_mss_distributor';
ALTER TABLE launch_liquidity_lifecycle ADD COLUMN lp_fee_source TEXT DEFAULT 'raydium_lp';
ALTER TABLE launch_liquidity_lifecycle ADD COLUMN lp_fee_distributor_enabled INTEGER DEFAULT 1;
ALTER TABLE launch_liquidity_lifecycle ADD COLUMN lp_fee_distributor_status TEXT DEFAULT 'pending';
ALTER TABLE launch_liquidity_lifecycle ADD COLUMN lp_fee_distributor_address TEXT;
ALTER TABLE launch_liquidity_lifecycle ADD COLUMN lp_fee_distributor_program TEXT;
ALTER TABLE launch_liquidity_lifecycle ADD COLUMN lp_fee_distributor_tx TEXT;
ALTER TABLE launch_liquidity_lifecycle ADD COLUMN lp_fee_last_distributed_at TEXT;
ALTER TABLE launch_liquidity_lifecycle ADD COLUMN lp_fee_last_distribution_tx TEXT;
ALTER TABLE launch_liquidity_lifecycle ADD COLUMN lp_fee_total_distributed_sol REAL DEFAULT 0;
ALTER TABLE launch_liquidity_lifecycle ADD COLUMN lp_fee_pending_sol REAL DEFAULT 0;
ALTER TABLE launch_liquidity_lifecycle ADD COLUMN builder_can_remove_lp INTEGER DEFAULT 0;
ALTER TABLE launch_liquidity_lifecycle ADD COLUMN builder_receives_lp_fees INTEGER DEFAULT 1;
ALTER TABLE launch_liquidity_lifecycle ADD COLUMN builder_lp_fee_wallet TEXT;

CREATE TABLE IF NOT EXISTS lp_fee_distribution_events (
id INTEGER PRIMARY KEY AUTOINCREMENT,
launch_id INTEGER NOT NULL,
beneficiary_wallet TEXT,
beneficiary_type TEXT DEFAULT 'builder',
controller_type TEXT DEFAULT 'mss_distributor',
distribution_model TEXT DEFAULT 'raydium_lp_fees_to_builder_via_mss_distributor',
fee_source TEXT DEFAULT 'raydium_lp',
distributor_address TEXT,
distributor_program TEXT,
amount_sol REAL NOT NULL DEFAULT 0,
amount_lamports INTEGER NOT NULL DEFAULT 0,
tx_signature TEXT,
status TEXT NOT NULL DEFAULT 'pending',
error_text TEXT,
metadata_json TEXT,
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
distributed_at TEXT,
FOREIGN KEY (launch_id) REFERENCES launches(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lp_fee_distribution_events_launch
ON lp_fee_distribution_events (launch_id);

CREATE INDEX IF NOT EXISTS idx_lp_fee_distribution_events_status
ON lp_fee_distribution_events (status);

UPDATE launches
SET
lp_fee_beneficiary_wallet = COALESCE(NULLIF(TRIM(lp_fee_beneficiary_wallet), ''), NULLIF(TRIM(builder_wallet), '')),
lp_fee_beneficiary_type = COALESCE(NULLIF(TRIM(lp_fee_beneficiary_type), ''), 'builder'),
lp_fee_controller_type = COALESCE(NULLIF(TRIM(lp_fee_controller_type), ''), 'mss_distributor'),
lp_fee_distribution_model = COALESCE(NULLIF(TRIM(lp_fee_distribution_model), ''), 'raydium_lp_fees_to_builder_via_mss_distributor'),
lp_fee_source = COALESCE(NULLIF(TRIM(lp_fee_source), ''), 'raydium_lp'),
lp_fee_distributor_enabled = COALESCE(lp_fee_distributor_enabled, 1),
lp_fee_distributor_status = COALESCE(NULLIF(TRIM(lp_fee_distributor_status), ''), 'pending'),
lp_fee_total_distributed_sol = COALESCE(lp_fee_total_distributed_sol, 0),
lp_fee_pending_sol = COALESCE(lp_fee_pending_sol, 0),
builder_can_remove_lp = 0,
builder_receives_lp_fees = 1,
builder_lp_fee_wallet = COALESCE(NULLIF(TRIM(builder_lp_fee_wallet), ''), NULLIF(TRIM(builder_wallet), '')),
launch_fee_model = COALESCE(NULLIF(TRIM(launch_fee_model), ''), 'successful_launch_fee'),
launch_fee_notes = COALESCE(
NULLIF(TRIM(launch_fee_notes), ''),
'Launch fee is handled separately. Raydium LP fee rights are routed to the builder through an MSS-controlled distributor layer. Builders cannot remove LP directly.'
);

UPDATE launch_liquidity_lifecycle
SET
lp_fee_beneficiary_wallet = COALESCE(
NULLIF(TRIM(lp_fee_beneficiary_wallet), ''),
(
SELECT COALESCE(
NULLIF(TRIM(launches.builder_lp_fee_wallet), ''),
NULLIF(TRIM(launches.builder_wallet), '')
)
FROM launches
WHERE launches.id = launch_liquidity_lifecycle.launch_id
)
),
lp_fee_beneficiary_type = COALESCE(NULLIF(TRIM(lp_fee_beneficiary_type), ''), 'builder'),
lp_fee_controller_type = COALESCE(NULLIF(TRIM(lp_fee_controller_type), ''), 'mss_distributor'),
lp_fee_distribution_model = COALESCE(NULLIF(TRIM(lp_fee_distribution_model), ''), 'raydium_lp_fees_to_builder_via_mss_distributor'),
lp_fee_source = COALESCE(NULLIF(TRIM(lp_fee_source), ''), 'raydium_lp'),
lp_fee_distributor_enabled = COALESCE(lp_fee_distributor_enabled, 1),
lp_fee_distributor_status = COALESCE(NULLIF(TRIM(lp_fee_distributor_status), ''), 'pending'),
lp_fee_total_distributed_sol = COALESCE(lp_fee_total_distributed_sol, 0),
lp_fee_pending_sol = COALESCE(lp_fee_pending_sol, 0),
builder_can_remove_lp = 0,
builder_receives_lp_fees = 1,
builder_lp_fee_wallet = COALESCE(
NULLIF(TRIM(builder_lp_fee_wallet), ''),
(
SELECT COALESCE(
NULLIF(TRIM(launches.builder_lp_fee_wallet), ''),
NULLIF(TRIM(launches.builder_wallet), '')
)
FROM launches
WHERE launches.id = launch_liquidity_lifecycle.launch_id
)
);

COMMIT;
