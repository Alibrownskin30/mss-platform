CREATE TABLE IF NOT EXISTS launches (
id INTEGER PRIMARY KEY AUTOINCREMENT,
builder_id INTEGER NOT NULL,
launch_type TEXT NOT NULL, -- main | degen
template TEXT NOT NULL, -- degen | meme_lite | meme_pro | builder
token_name TEXT NOT NULL,
symbol TEXT NOT NULL,
description TEXT DEFAULT '',
image_url TEXT DEFAULT '',
supply TEXT NOT NULL,
min_raise_sol REAL NOT NULL,
hard_cap_sol REAL NOT NULL,
committed_sol REAL NOT NULL DEFAULT 0,
participants_count INTEGER NOT NULL DEFAULT 0,
launch_fee_pct REAL NOT NULL DEFAULT 5,
liquidity_pct REAL NOT NULL,
participants_pct REAL NOT NULL,
reserve_pct REAL NOT NULL,
builder_pct REAL NOT NULL,
status TEXT NOT NULL DEFAULT 'queued', -- queued | committing | countdown | live | graduated | failed
created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (builder_id) REFERENCES builders(id)
);

CREATE INDEX IF NOT EXISTS idx_launches_builder_id ON launches(builder_id);
CREATE INDEX IF NOT EXISTS idx_launches_status ON launches(status);
