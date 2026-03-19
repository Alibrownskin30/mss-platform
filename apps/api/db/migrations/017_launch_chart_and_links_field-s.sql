ALTER TABLE launches ADD COLUMN contract_address TEXT;
ALTER TABLE launches ADD COLUMN builder_wallet TEXT;
ALTER TABLE launches ADD COLUMN website_url TEXT;
ALTER TABLE launches ADD COLUMN x_url TEXT;
ALTER TABLE launches ADD COLUMN telegram_url TEXT;
ALTER TABLE launches ADD COLUMN discord_url TEXT;
ALTER TABLE launches ADD COLUMN circulating_supply REAL DEFAULT 0;
ALTER TABLE launches ADD COLUMN liquidity REAL DEFAULT 0;
ALTER TABLE launches ADD COLUMN liquidity_usd REAL DEFAULT 0;
ALTER TABLE launches ADD COLUMN current_liquidity_usd REAL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_trades_launch_id_created_at
ON trades (launch_id, created_at);