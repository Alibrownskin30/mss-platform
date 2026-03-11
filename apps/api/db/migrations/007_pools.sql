CREATE TABLE IF NOT EXISTS pools (
id INTEGER PRIMARY KEY AUTOINCREMENT,
launch_id INTEGER NOT NULL,
token_id INTEGER NOT NULL,
token_reserve REAL NOT NULL,
sol_reserve REAL NOT NULL,
k_value REAL NOT NULL,
status TEXT DEFAULT 'active',
created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (launch_id) REFERENCES launches(id),
FOREIGN KEY (token_id) REFERENCES tokens(id)
);

CREATE INDEX IF NOT EXISTS idx_pools_launch_id ON pools(launch_id);
CREATE INDEX IF NOT EXISTS idx_pools_token_id ON pools(token_id);