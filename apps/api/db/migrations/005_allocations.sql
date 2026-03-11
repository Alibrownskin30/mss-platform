CREATE TABLE IF NOT EXISTS allocations (
id INTEGER PRIMARY KEY AUTOINCREMENT,
launch_id INTEGER NOT NULL,
wallet TEXT NOT NULL,
allocation_type TEXT NOT NULL, -- participant | builder | reserve | liquidity
token_amount TEXT NOT NULL,
sol_amount REAL NOT NULL DEFAULT 0,
created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (launch_id) REFERENCES launches(id)
);

CREATE INDEX IF NOT EXISTS idx_allocations_launch_id ON allocations(launch_id);
CREATE INDEX IF NOT EXISTS idx_allocations_wallet ON allocations(wallet);