CREATE TABLE IF NOT EXISTS mint_reservations (
id INTEGER PRIMARY KEY AUTOINCREMENT,
mint_address TEXT NOT NULL UNIQUE,
mint_secret TEXT NOT NULL,
required_tag TEXT NOT NULL DEFAULT 'MSS',
mint_reservation_attempts INTEGER NOT NULL DEFAULT 0,
status TEXT NOT NULL DEFAULT 'available',
assigned_launch_id INTEGER,
assigned_at TEXT,
consumed_at TEXT,
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mint_reservations_status
ON mint_reservations(status);

CREATE INDEX IF NOT EXISTS idx_mint_reservations_required_tag_status
ON mint_reservations(required_tag, status);
