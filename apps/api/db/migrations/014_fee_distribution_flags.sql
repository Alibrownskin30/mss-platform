ALTER TABLE launches ADD COLUMN fees_distributed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE launches ADD COLUMN fees_distributed_at DATETIME;
ALTER TABLE launches ADD COLUMN fee_distribution_json TEXT;