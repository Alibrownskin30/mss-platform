ALTER TABLE commits ADD COLUMN tx_signature TEXT;
ALTER TABLE commits ADD COLUMN tx_status TEXT DEFAULT 'pending';
ALTER TABLE commits ADD COLUMN verified_at DATETIME;

CREATE UNIQUE INDEX IF NOT EXISTS idx_commits_signature ON commits(tx_signature);
