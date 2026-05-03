BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS crypto_accounting_ledger (
id INTEGER PRIMARY KEY AUTOINCREMENT,

wallet_type TEXT NOT NULL CHECK (
wallet_type IN ('revenue', 'treasury', 'buyback', 'ops', 'burn', 'liquidity', 'builder_bond', 'unknown')
),
wallet_address TEXT,

tx_hash TEXT,
event_type TEXT NOT NULL CHECK (
event_type IN (
'receive',
'send',
'swap',
'buyback',
'burn',
'refund',
'fee',
'expense',
'internal_transfer',
'liquidity_add',
'liquidity_remove',
'builder_bond_receive',
'builder_bond_refund',
'builder_bond_forfeit'
)
),

asset_symbol TEXT NOT NULL,
asset_address TEXT,
amount NUMERIC NOT NULL DEFAULT 0,

counter_asset_symbol TEXT,
counter_asset_address TEXT,
counter_amount NUMERIC,

aud_unit_price_at_tx NUMERIC NOT NULL DEFAULT 0,
aud_total_value_at_tx NUMERIC NOT NULL DEFAULT 0,
aud_counter_value_at_tx NUMERIC,

source_event TEXT,
source_ref_type TEXT,
source_ref_id TEXT,

launch_id INTEGER,
trade_id INTEGER,

notes TEXT,
metadata_json TEXT,

created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

FOREIGN KEY (launch_id) REFERENCES launches(id) ON DELETE SET NULL,
FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_crypto_accounting_ledger_wallet_type
ON crypto_accounting_ledger(wallet_type);

CREATE INDEX IF NOT EXISTS idx_crypto_accounting_ledger_wallet_address
ON crypto_accounting_ledger(wallet_address);

CREATE INDEX IF NOT EXISTS idx_crypto_accounting_ledger_tx_hash
ON crypto_accounting_ledger(tx_hash);

CREATE INDEX IF NOT EXISTS idx_crypto_accounting_ledger_event_type
ON crypto_accounting_ledger(event_type);

CREATE INDEX IF NOT EXISTS idx_crypto_accounting_ledger_asset_symbol
ON crypto_accounting_ledger(asset_symbol);

CREATE INDEX IF NOT EXISTS idx_crypto_accounting_ledger_launch_id
ON crypto_accounting_ledger(launch_id);

CREATE INDEX IF NOT EXISTS idx_crypto_accounting_ledger_trade_id
ON crypto_accounting_ledger(trade_id);

CREATE INDEX IF NOT EXISTS idx_crypto_accounting_ledger_source_ref
ON crypto_accounting_ledger(source_ref_type, source_ref_id);

CREATE INDEX IF NOT EXISTS idx_crypto_accounting_ledger_created_at
ON crypto_accounting_ledger(created_at);

COMMIT;
