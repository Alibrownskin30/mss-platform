BEGIN TRANSACTION;

-- MSS account layer
CREATE TABLE IF NOT EXISTS mss_users (
id INTEGER PRIMARY KEY AUTOINCREMENT,
email TEXT NOT NULL UNIQUE,
password_hash TEXT NOT NULL,
display_name TEXT,
status TEXT NOT NULL DEFAULT 'active',
role TEXT NOT NULL DEFAULT 'user',
email_verified INTEGER NOT NULL DEFAULT 0,
email_verified_at TEXT,
last_login_at TEXT,
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
CHECK (status IN ('active', 'disabled', 'suspended')),
CHECK (role IN ('user', 'admin', 'support'))
);

CREATE INDEX IF NOT EXISTS idx_mss_users_status ON mss_users(status);
CREATE INDEX IF NOT EXISTS idx_mss_users_role ON mss_users(role);

-- One account can swap wallets over time, but only one active wallet should be linked at once.
CREATE TABLE IF NOT EXISTS mss_user_wallets (
id INTEGER PRIMARY KEY AUTOINCREMENT,
user_id INTEGER NOT NULL,
wallet_address TEXT NOT NULL,
wallet_label TEXT,
chain TEXT NOT NULL DEFAULT 'solana',
is_primary INTEGER NOT NULL DEFAULT 1,
is_active INTEGER NOT NULL DEFAULT 1,
linked_signature TEXT,
linked_message TEXT,
linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
disconnected_at TEXT,
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (user_id) REFERENCES mss_users(id) ON DELETE CASCADE,
CHECK (chain IN ('solana')),
CHECK (is_primary IN (0, 1)),
CHECK (is_active IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_mss_user_wallets_user_id
ON mss_user_wallets(user_id);

CREATE INDEX IF NOT EXISTS idx_mss_user_wallets_wallet_address
ON mss_user_wallets(wallet_address);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mss_user_wallets_active_wallet_unique
ON mss_user_wallets(wallet_address)
WHERE is_active = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mss_user_wallets_one_active_wallet_per_user
ON mss_user_wallets(user_id)
WHERE is_active = 1;

-- Access codes for manual grants, early tester trials, paid passes, partner grants, etc.
CREATE TABLE IF NOT EXISTS sentinel_access_codes (
id INTEGER PRIMARY KEY AUTOINCREMENT,
code TEXT NOT NULL UNIQUE,
code_type TEXT NOT NULL DEFAULT 'trial',
plan_key TEXT NOT NULL DEFAULT 'sentinel_trial',
plan_label TEXT NOT NULL DEFAULT 'Sentinel Trial',
duration_days INTEGER NOT NULL DEFAULT 7,
max_redemptions INTEGER NOT NULL DEFAULT 1,
redeemed_count INTEGER NOT NULL DEFAULT 0,
is_active INTEGER NOT NULL DEFAULT 1,
starts_at TEXT,
expires_at TEXT,
notes TEXT,
created_by_user_id INTEGER,
bound_user_id INTEGER,
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (created_by_user_id) REFERENCES mss_users(id) ON DELETE SET NULL,
FOREIGN KEY (bound_user_id) REFERENCES mss_users(id) ON DELETE SET NULL,
CHECK (code_type IN ('trial', 'promo', 'comp', 'paid', 'partner', 'admin')),
CHECK (duration_days >= 0),
CHECK (max_redemptions >= 1),
CHECK (redeemed_count >= 0),
CHECK (is_active IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_sentinel_access_codes_active
ON sentinel_access_codes(is_active);

CREATE INDEX IF NOT EXISTS idx_sentinel_access_codes_plan_key
ON sentinel_access_codes(plan_key);

CREATE INDEX IF NOT EXISTS idx_sentinel_access_codes_bound_user_id
ON sentinel_access_codes(bound_user_id);

-- Account-owned Sentinel access
CREATE TABLE IF NOT EXISTS sentinel_entitlements (
id INTEGER PRIMARY KEY AUTOINCREMENT,
user_id INTEGER NOT NULL,
source_type TEXT NOT NULL DEFAULT 'code',
source_code_id INTEGER,
plan_key TEXT NOT NULL DEFAULT 'sentinel_trial',
access_tier TEXT NOT NULL DEFAULT 'sentinel_standard',
status TEXT NOT NULL DEFAULT 'active',
starts_at TEXT NOT NULL,
ends_at TEXT,
trial_flag INTEGER NOT NULL DEFAULT 0,
granted_by_user_id INTEGER,
revoked_by_user_id INTEGER,
revoke_reason TEXT,
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (user_id) REFERENCES mss_users(id) ON DELETE CASCADE,
FOREIGN KEY (source_code_id) REFERENCES sentinel_access_codes(id) ON DELETE SET NULL,
FOREIGN KEY (granted_by_user_id) REFERENCES mss_users(id) ON DELETE SET NULL,
FOREIGN KEY (revoked_by_user_id) REFERENCES mss_users(id) ON DELETE SET NULL,
CHECK (source_type IN ('code', 'manual', 'subscription', 'admin_grant')),
CHECK (access_tier IN ('sentinel_standard', 'sentinel_early', 'sentinel_internal')),
CHECK (status IN ('active', 'expired', 'revoked', 'scheduled')),
CHECK (trial_flag IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_sentinel_entitlements_user_id
ON sentinel_entitlements(user_id);

CREATE INDEX IF NOT EXISTS idx_sentinel_entitlements_status
ON sentinel_entitlements(status);

CREATE INDEX IF NOT EXISTS idx_sentinel_entitlements_plan_key
ON sentinel_entitlements(plan_key);

CREATE INDEX IF NOT EXISTS idx_sentinel_entitlements_user_status
ON sentinel_entitlements(user_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sentinel_entitlements_one_active_per_user
ON sentinel_entitlements(user_id)
WHERE status = 'active';

-- Redemption history and abuse control
CREATE TABLE IF NOT EXISTS sentinel_code_redemptions (
id INTEGER PRIMARY KEY AUTOINCREMENT,
code_id INTEGER NOT NULL,
user_id INTEGER NOT NULL,
entitlement_id INTEGER,
wallet_address_at_redeem TEXT,
redeemed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
redemption_status TEXT NOT NULL DEFAULT 'success',
failure_reason TEXT,
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (code_id) REFERENCES sentinel_access_codes(id) ON DELETE CASCADE,
FOREIGN KEY (user_id) REFERENCES mss_users(id) ON DELETE CASCADE,
FOREIGN KEY (entitlement_id) REFERENCES sentinel_entitlements(id) ON DELETE SET NULL,
CHECK (redemption_status IN ('success', 'rejected', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_sentinel_code_redemptions_code_id
ON sentinel_code_redemptions(code_id);

CREATE INDEX IF NOT EXISTS idx_sentinel_code_redemptions_user_id
ON sentinel_code_redemptions(user_id);

CREATE INDEX IF NOT EXISTS idx_sentinel_code_redemptions_entitlement_id
ON sentinel_code_redemptions(entitlement_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sentinel_code_redemptions_code_user_unique
ON sentinel_code_redemptions(code_id, user_id);

-- updated_at triggers
CREATE TRIGGER IF NOT EXISTS trg_mss_users_updated_at
AFTER UPDATE ON mss_users
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
UPDATE mss_users
SET updated_at = CURRENT_TIMESTAMP
WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_mss_user_wallets_updated_at
AFTER UPDATE ON mss_user_wallets
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
UPDATE mss_user_wallets
SET updated_at = CURRENT_TIMESTAMP
WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_sentinel_access_codes_updated_at
AFTER UPDATE ON sentinel_access_codes
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
UPDATE sentinel_access_codes
SET updated_at = CURRENT_TIMESTAMP
WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_sentinel_entitlements_updated_at
AFTER UPDATE ON sentinel_entitlements
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
UPDATE sentinel_entitlements
SET updated_at = CURRENT_TIMESTAMP
WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_sentinel_code_redemptions_updated_at
AFTER UPDATE ON sentinel_code_redemptions
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
UPDATE sentinel_code_redemptions
SET updated_at = CURRENT_TIMESTAMP
WHERE id = NEW.id;
END;

COMMIT;
