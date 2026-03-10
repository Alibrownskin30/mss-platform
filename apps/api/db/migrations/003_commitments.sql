CREATE TABLE IF NOT EXISTS commitments (
id INTEGER PRIMARY KEY AUTOINCREMENT,
launch_id INTEGER NOT NULL,
wallet TEXT NOT NULL,
sol_amount REAL NOT NULL,
created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (launch_id) REFERENCES launches(id)
);

CREATE INDEX IF NOT EXISTS idx_commitments_launch_id ON commitments(launch_id);
CREATE INDEX IF NOT EXISTS idx_commitments_wallet ON commitments(wallet);
