CREATE TABLE IF NOT EXISTS commits (
id INTEGER PRIMARY KEY AUTOINCREMENT,
launch_id INTEGER NOT NULL,
wallet TEXT NOT NULL,
sol_amount REAL NOT NULL,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_commits_launch ON commits(launch_id);
CREATE INDEX idx_commits_wallet ON commits(wallet);