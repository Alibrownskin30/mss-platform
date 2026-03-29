BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS builder_vesting (
id INTEGER PRIMARY KEY AUTOINCREMENT,
launch_id INTEGER NOT NULL UNIQUE,
builder_wallet TEXT,
total_allocation INTEGER NOT NULL DEFAULT 0,
daily_unlock INTEGER NOT NULL DEFAULT 0,
unlocked_amount INTEGER NOT NULL DEFAULT 0,
locked_amount INTEGER NOT NULL DEFAULT 0,
vesting_start_at TEXT,
created_at TEXT DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (launch_id) REFERENCES launches(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_builder_vesting_launch_id
ON builder_vesting(launch_id);

CREATE INDEX IF NOT EXISTS idx_builder_vesting_wallet
ON builder_vesting(builder_wallet);

CREATE TABLE IF NOT EXISTS launch_liquidity_lifecycle (
id INTEGER PRIMARY KEY AUTOINCREMENT,
launch_id INTEGER NOT NULL UNIQUE,
internal_sol_reserve REAL NOT NULL DEFAULT 0,
internal_token_reserve INTEGER NOT NULL DEFAULT 0,
implied_marketcap_sol REAL NOT NULL DEFAULT 0,

graduation_status TEXT NOT NULL DEFAULT 'internal_live',
graduated INTEGER NOT NULL DEFAULT 0,
graduation_reason TEXT,
graduated_at TEXT,

raydium_target_pct REAL NOT NULL DEFAULT 50,
mss_locked_target_pct REAL NOT NULL DEFAULT 50,

raydium_pool_id TEXT,
raydium_sol_migrated REAL NOT NULL DEFAULT 0,
raydium_token_migrated INTEGER NOT NULL DEFAULT 0,
raydium_lp_tokens TEXT,
raydium_migration_tx TEXT,

mss_locked_sol REAL NOT NULL DEFAULT 0,
mss_locked_token INTEGER NOT NULL DEFAULT 0,
mss_locked_lp_amount TEXT,
lock_status TEXT NOT NULL DEFAULT 'not_locked',
lock_tx TEXT,
lock_expires_at TEXT,

created_at TEXT DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

FOREIGN KEY (launch_id) REFERENCES launches(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_launch_liquidity_lifecycle_launch_id
ON launch_liquidity_lifecycle(launch_id);

CREATE INDEX IF NOT EXISTS idx_launch_liquidity_lifecycle_status
ON launch_liquidity_lifecycle(graduation_status);

COMMIT;
