ALTER TABLE sentinel_access_codes
ADD COLUMN created_for_label TEXT;

ALTER TABLE sentinel_access_codes
ADD COLUMN campaign_label TEXT;

ALTER TABLE sentinel_access_codes
ADD COLUMN revoked_at TEXT;

ALTER TABLE sentinel_access_codes
ADD COLUMN revoked_by TEXT;

ALTER TABLE sentinel_access_codes
ADD COLUMN revocation_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_sentinel_access_codes_created_for_label
ON sentinel_access_codes(created_for_label);

CREATE INDEX IF NOT EXISTS idx_sentinel_access_codes_campaign_label
ON sentinel_access_codes(campaign_label);

CREATE INDEX IF NOT EXISTS idx_sentinel_access_codes_revoked_at
ON sentinel_access_codes(revoked_at);
