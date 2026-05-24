ALTER TABLE mss_users
ADD COLUMN legacy_scanner_user_id INTEGER;

ALTER TABLE mss_users
ADD COLUMN legacy_scanner_linked_at TEXT;

ALTER TABLE mss_users
ADD COLUMN legacy_scanner_link_method TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mss_users_legacy_scanner_user_id_unique
ON mss_users (legacy_scanner_user_id)
WHERE legacy_scanner_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mss_users_legacy_scanner_linked_at
ON mss_users (legacy_scanner_linked_at);