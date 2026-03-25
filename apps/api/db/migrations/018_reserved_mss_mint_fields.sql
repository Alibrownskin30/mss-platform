ALTER TABLE launches ADD COLUMN reserved_mint_address TEXT;
ALTER TABLE launches ADD COLUMN reserved_mint_secret TEXT;
ALTER TABLE launches ADD COLUMN mint_reservation_status TEXT;
ALTER TABLE launches ADD COLUMN mint_required_tag TEXT DEFAULT 'MSS';
ALTER TABLE launches ADD COLUMN mint_reservation_attempts INTEGER DEFAULT 0;
ALTER TABLE launches ADD COLUMN mint_reserved_at TEXT;
ALTER TABLE launches ADD COLUMN mint_finalized_at TEXT;
