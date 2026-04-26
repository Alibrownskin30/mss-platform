CREATE TABLE IF NOT EXISTS mint_reservations (
id INTEGER PRIMARY KEY AUTOINCREMENT,
mint_address TEXT NOT NULL UNIQUE,
mint_secret TEXT NOT NULL,
required_tag TEXT NOT NULL DEFAULT 'MSS',
status TEXT NOT NULL DEFAULT 'available',

reserved_for_launch_id INTEGER,
assigned_launch_id INTEGER,

reserved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
assigned_at DATETIME,
finalized_at DATETIME,
consumed_at DATETIME,
failed_at DATETIME,

last_error TEXT,
created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

mint_reservation_attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mint_reservations_status
ON mint_reservations(status);

CREATE INDEX IF NOT EXISTS idx_mint_reservations_required_tag_status
ON mint_reservations(required_tag, status);

CREATE INDEX IF NOT EXISTS idx_mint_reservations_reserved_for_launch
ON mint_reservations(reserved_for_launch_id);

CREATE INDEX IF NOT EXISTS idx_mint_reservations_assigned_launch
ON mint_reservations(assigned_launch_id);
