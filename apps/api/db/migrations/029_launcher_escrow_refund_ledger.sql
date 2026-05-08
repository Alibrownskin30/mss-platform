BEGIN;

CREATE TABLE IF NOT EXISTS launch_escrow_vaults (
id INTEGER PRIMARY KEY AUTOINCREMENT,
launch_id INTEGER NOT NULL UNIQUE,
escrow_model TEXT NOT NULL DEFAULT 'launch_vault',
refund_mode TEXT NOT NULL DEFAULT 'vault_program',
status TEXT NOT NULL DEFAULT 'pending',
vault_address TEXT,
commit_destination_address TEXT,
bond_destination_address TEXT,
vault_program_id TEXT,
vault_pda TEXT,
vault_bump INTEGER,
fee_relayer_address TEXT,
metadata_json TEXT,
created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (launch_id) REFERENCES launches(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_launch_escrow_vaults_status
ON launch_escrow_vaults(status);

CREATE INDEX IF NOT EXISTS idx_launch_escrow_vaults_vault_address
ON launch_escrow_vaults(vault_address);

CREATE TABLE IF NOT EXISTS launch_refund_ledger (
id INTEGER PRIMARY KEY AUTOINCREMENT,
launch_id INTEGER NOT NULL,
wallet TEXT NOT NULL,
status TEXT NOT NULL DEFAULT 'pending',
commit_count INTEGER NOT NULL DEFAULT 0,
committed_sol REAL NOT NULL DEFAULT 0,
committed_lamports INTEGER NOT NULL DEFAULT 0,
refundable_sol REAL NOT NULL DEFAULT 0,
refundable_lamports INTEGER NOT NULL DEFAULT 0,
refunded_sol REAL NOT NULL DEFAULT 0,
refunded_lamports INTEGER NOT NULL DEFAULT 0,
source_commit_tx_signature TEXT,
source_commit_tx_signatures_json TEXT,
escrow_source_address TEXT,
relayer_fee_payer TEXT,
claim_token TEXT,
claimed_at DATETIME,
refund_requested_at DATETIME,
refund_processed_at DATETIME,
refund_tx_signature TEXT,
refund_attempts INTEGER NOT NULL DEFAULT 0,
last_error TEXT,
metadata_json TEXT,
created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
UNIQUE (launch_id, wallet),
FOREIGN KEY (launch_id) REFERENCES launches(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_launch_refund_ledger_launch_status
ON launch_refund_ledger(launch_id, status);

CREATE INDEX IF NOT EXISTS idx_launch_refund_ledger_status
ON launch_refund_ledger(status);

CREATE INDEX IF NOT EXISTS idx_launch_refund_ledger_wallet
ON launch_refund_ledger(wallet);

CREATE TABLE IF NOT EXISTS launch_refund_events (
id INTEGER PRIMARY KEY AUTOINCREMENT,
launch_id INTEGER NOT NULL,
ledger_id INTEGER,
wallet TEXT NOT NULL,
event_type TEXT NOT NULL,
event_status TEXT NOT NULL DEFAULT 'ok',
tx_signature TEXT,
details_json TEXT,
created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (launch_id) REFERENCES launches(id) ON DELETE CASCADE,
FOREIGN KEY (ledger_id) REFERENCES launch_refund_ledger(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_launch_refund_events_launch_id
ON launch_refund_events(launch_id);

CREATE INDEX IF NOT EXISTS idx_launch_refund_events_ledger_id
ON launch_refund_events(ledger_id);

CREATE INDEX IF NOT EXISTS idx_launch_refund_events_wallet
ON launch_refund_events(wallet);

COMMIT;
