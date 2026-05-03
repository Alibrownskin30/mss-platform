BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS compliance_profiles (
id INTEGER PRIMARY KEY AUTOINCREMENT,
wallet_address TEXT NOT NULL UNIQUE,
profile_type TEXT NOT NULL DEFAULT 'individual' CHECK (profile_type IN ('individual', 'entity')),
status TEXT NOT NULL DEFAULT 'not_started' CHECK (
status IN ('not_started', 'pending', 'approved', 'rejected', 'restricted')
),
risk_rating TEXT NOT NULL DEFAULT 'low' CHECK (
risk_rating IN ('low', 'medium', 'high', 'critical')
),

legal_name TEXT,
display_name TEXT,
entity_name TEXT,
entity_type TEXT,
entity_registration_number TEXT,

email TEXT,
phone TEXT,
country_code TEXT,
date_of_birth TEXT,

pep_status INTEGER NOT NULL DEFAULT 0 CHECK (pep_status IN (0, 1)),
sanctions_status INTEGER NOT NULL DEFAULT 0 CHECK (sanctions_status IN (0, 1)),

source_of_funds_summary TEXT,
source_of_wealth_summary TEXT,

verification_started_at TEXT,
verification_completed_at TEXT,

manual_review_required INTEGER NOT NULL DEFAULT 0 CHECK (manual_review_required IN (0, 1)),
manual_review_reason TEXT,

kyc_provider_ref TEXT,
kyb_provider_ref TEXT,

notes TEXT,
metadata_json TEXT,

created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_compliance_profiles_status
ON compliance_profiles(status);

CREATE INDEX IF NOT EXISTS idx_compliance_profiles_risk_rating
ON compliance_profiles(risk_rating);

CREATE INDEX IF NOT EXISTS idx_compliance_profiles_country_code
ON compliance_profiles(country_code);

CREATE INDEX IF NOT EXISTS idx_compliance_profiles_manual_review_required
ON compliance_profiles(manual_review_required);

CREATE TABLE IF NOT EXISTS beneficial_owners (
id INTEGER PRIMARY KEY AUTOINCREMENT,
compliance_profile_id INTEGER NOT NULL,
full_name TEXT NOT NULL,
country_code TEXT,
date_of_birth TEXT,
ownership_pct REAL NOT NULL DEFAULT 0,
control_basis TEXT,
pep_status INTEGER NOT NULL DEFAULT 0 CHECK (pep_status IN (0, 1)),
sanctions_status INTEGER NOT NULL DEFAULT 0 CHECK (sanctions_status IN (0, 1)),
verified_at TEXT,
notes TEXT,
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (compliance_profile_id) REFERENCES compliance_profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_beneficial_owners_profile_id
ON beneficial_owners(compliance_profile_id);

CREATE INDEX IF NOT EXISTS idx_beneficial_owners_country_code
ON beneficial_owners(country_code);

CREATE TABLE IF NOT EXISTS authorised_representatives (
id INTEGER PRIMARY KEY AUTOINCREMENT,
compliance_profile_id INTEGER NOT NULL,
full_name TEXT NOT NULL,
role_title TEXT,
authority_type TEXT,
authority_doc_ref TEXT,
email TEXT,
phone TEXT,
country_code TEXT,
verified_at TEXT,
notes TEXT,
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (compliance_profile_id) REFERENCES compliance_profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_authorised_representatives_profile_id
ON authorised_representatives(compliance_profile_id);

CREATE INDEX IF NOT EXISTS idx_authorised_representatives_country_code
ON authorised_representatives(country_code);

COMMIT;
