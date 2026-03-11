CREATE TABLE IF NOT EXISTS trades (
id INTEGER PRIMARY KEY AUTOINCREMENT,
launch_id INTEGER NOT NULL,
token_id INTEGER NOT NULL,
wallet TEXT NOT NULL,
side TEXT NOT NULL,
sol_amount REAL NOT NULL,
token_amount REAL NOT NULL,
price REAL NOT NULL,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (launch_id) REFERENCES launches(id),
FOREIGN KEY (token_id) REFERENCES tokens(id)
);

CREATE INDEX IF NOT EXISTS idx_trades_launch_id ON trades(launch_id);
CREATE INDEX IF NOT EXISTS idx_trades_token_id ON trades(token_id);