CREATE TABLE IF NOT EXISTS builder_bond_refund_ledger (
id INTEGER PRIMARY KEY AUTOINCREMENT,
wallet TEXT NOT NULL,
bond_tx_signature TEXT NOT NULL UNIQUE,
bond_sol REAL NOT NULL DEFAULT 0,
bond_lamports INTEGER NOT NULL DEFAULT 0,
bond_escrow_address TEXT,
status TEXT NOT NULL DEFAULT 'pending',
reason_code TEXT,
request_action TEXT,
refund_tx_signature TEXT,
relayer_wallet TEXT,
source_wallet TEXT,
refund_attempts INTEGER NOT NULL DEFAULT 0,
last_error TEXT,
requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
last_attempt_at TEXT,
refunded_at TEXT,
failed_at TEXT,
created_at TEXT DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_builder_bond_refund_wallet
ON builder_bond_refund_ledger(wallet);

CREATE INDEX IF NOT EXISTS idx_builder_bond_refund_status
ON builder_bond_refund_ledger(status);

CREATE INDEX IF NOT EXISTS idx_builder_bond_refund_created_at
ON builder_bond_refund_ledger(created_at);
