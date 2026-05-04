BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS cassie_sentinel_settings (
id INTEGER PRIMARY KEY CHECK (id = 1),

watcher_enabled INTEGER NOT NULL DEFAULT 1,
execution_mode TEXT NOT NULL DEFAULT 'paper'
CHECK (execution_mode IN ('paper', 'armed_mainnet', 'live_mainnet', 'emergency_stop')),

auto_bank_enabled INTEGER NOT NULL DEFAULT 1,
auto_bank_multiple REAL NOT NULL DEFAULT 10,
auto_bank_fraction REAL NOT NULL DEFAULT 0.50,

scout_usd REAL NOT NULL DEFAULT 0.50,
sniper_add_usd REAL NOT NULL DEFAULT 1.00,
max_total_position_usd REAL NOT NULL DEFAULT 1.50,
max_open_positions INTEGER NOT NULL DEFAULT 30,
max_positions_per_operator_cluster INTEGER NOT NULL DEFAULT 2,

max_daily_loss_usd REAL NOT NULL DEFAULT 25,
max_daily_scout_spend_usd REAL NOT NULL DEFAULT 20,
max_daily_sniper_spend_usd REAL NOT NULL DEFAULT 30,
max_consecutive_failures INTEGER NOT NULL DEFAULT 8,
max_tokens_per_hour INTEGER NOT NULL DEFAULT 12,

cooldown_after_close_sec INTEGER NOT NULL DEFAULT 1800,
cooldown_after_invalidation_sec INTEGER NOT NULL DEFAULT 3600,
early_fail_timeout_sec INTEGER NOT NULL DEFAULT 180,
weak_stall_timeout_sec INTEGER NOT NULL DEFAULT 420,
runner_failed_breakout_limit INTEGER NOT NULL DEFAULT 2,

min_operator_quality_score REAL NOT NULL DEFAULT 70,
max_hidden_control_risk REAL NOT NULL DEFAULT 30,
max_contamination_risk REAL NOT NULL DEFAULT 35,
max_wallet_coordination_risk REAL NOT NULL DEFAULT 40,

min_regime_score_for_scout REAL NOT NULL DEFAULT 55,
min_regime_score_for_sniper REAL NOT NULL DEFAULT 65,

max_top_holder_pct REAL NOT NULL DEFAULT 18,
max_top_5_holder_pct REAL NOT NULL DEFAULT 45,
min_liquidity_usd REAL NOT NULL DEFAULT 800,
max_spread_bps REAL NOT NULL DEFAULT 350,
max_price_impact_bps REAL NOT NULL DEFAULT 500,

min_reclaim_strength_score REAL NOT NULL DEFAULT 60,
min_buy_pressure_score REAL NOT NULL DEFAULT 62,
min_persistence_score REAL NOT NULL DEFAULT 58,
min_post_entry_health_score REAL NOT NULL DEFAULT 55,
max_vertical_extension_score_for_add REAL NOT NULL DEFAULT 75,
max_insider_sell_score REAL NOT NULL DEFAULT 45,
max_liquidity_decay_score REAL NOT NULL DEFAULT 50,

risk_off_disable_new_entries INTEGER NOT NULL DEFAULT 1,

enable_scout INTEGER NOT NULL DEFAULT 1,
enable_sniper INTEGER NOT NULL DEFAULT 1,
enable_runner_management INTEGER NOT NULL DEFAULT 1,
enable_market_regime_filter INTEGER NOT NULL DEFAULT 1,
enable_operator_filter INTEGER NOT NULL DEFAULT 1,
enable_hard_rejects INTEGER NOT NULL DEFAULT 1,

created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_by TEXT
);

INSERT OR IGNORE INTO cassie_sentinel_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS cassie_sentinel_positions (
id INTEGER PRIMARY KEY AUTOINCREMENT,

token_id TEXT NOT NULL,
mint_address TEXT NOT NULL,
linked_operator_cluster_id TEXT,

stage TEXT NOT NULL
CHECK (stage IN (
'scout_open',
'sniper_added',
'half_banked_at_10x',
'runner_only',
'closed',
'invalidated'
)),

execution_mode TEXT NOT NULL
CHECK (execution_mode IN ('paper', 'armed_mainnet', 'live_mainnet', 'emergency_stop')),

total_cost_usd REAL NOT NULL DEFAULT 0,
total_size_usd REAL NOT NULL DEFAULT 0,
current_value_usd REAL NOT NULL DEFAULT 0,

units REAL NOT NULL DEFAULT 0,
avg_entry_price REAL,
avg_exit_price REAL,

realized_pnl_usd REAL NOT NULL DEFAULT 0,
unrealized_pnl_usd REAL NOT NULL DEFAULT 0,

has_banked_10x INTEGER NOT NULL DEFAULT 0,
banked_10x_at TEXT,
runner_started_at TEXT,

open_reason_codes TEXT,
close_reason_codes TEXT,

opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
closed_at TEXT,
invalidated_at TEXT,

tx_open_ref TEXT,
tx_add_ref TEXT,
tx_bank_ref TEXT,
tx_close_ref TEXT
);

CREATE INDEX IF NOT EXISTS idx_cassie_sentinel_positions_token
ON cassie_sentinel_positions(token_id);

CREATE INDEX IF NOT EXISTS idx_cassie_sentinel_positions_mint
ON cassie_sentinel_positions(mint_address);

CREATE INDEX IF NOT EXISTS idx_cassie_sentinel_positions_stage
ON cassie_sentinel_positions(stage);

CREATE INDEX IF NOT EXISTS idx_cassie_sentinel_positions_mode
ON cassie_sentinel_positions(execution_mode);

CREATE TABLE IF NOT EXISTS cassie_sentinel_audit_events (
id INTEGER PRIMARY KEY AUTOINCREMENT,

event_type TEXT NOT NULL,
token_id TEXT,
mint_address TEXT,
position_id INTEGER,

execution_mode TEXT,
decision TEXT NOT NULL,
reason_codes TEXT,

marketcap_usd REAL,
liquidity_usd REAL,
regime_state TEXT,
regime_score REAL,
operator_quality_score REAL,
hidden_control_risk REAL,
buy_pressure_score REAL,
reclaim_strength_score REAL,
structural_health_score REAL,

action_size_usd REAL,
bank_fraction REAL,

execution_status TEXT NOT NULL DEFAULT 'planned'
CHECK (execution_status IN ('planned', 'simulated', 'submitted', 'filled', 'failed', 'skipped')),

execution_error TEXT,
actor_type TEXT NOT NULL DEFAULT 'system',
actor_id TEXT,

created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

FOREIGN KEY (position_id) REFERENCES cassie_sentinel_positions(id)
);

CREATE INDEX IF NOT EXISTS idx_cassie_sentinel_audit_type
ON cassie_sentinel_audit_events(event_type);

CREATE INDEX IF NOT EXISTS idx_cassie_sentinel_audit_token
ON cassie_sentinel_audit_events(token_id);

CREATE INDEX IF NOT EXISTS idx_cassie_sentinel_audit_position
ON cassie_sentinel_audit_events(position_id);

CREATE INDEX IF NOT EXISTS idx_cassie_sentinel_audit_created
ON cassie_sentinel_audit_events(created_at DESC);

CREATE TABLE IF NOT EXISTS cassie_sentinel_daily_stats (
id INTEGER PRIMARY KEY AUTOINCREMENT,

stat_date TEXT NOT NULL,
execution_mode TEXT NOT NULL,

scouts_opened INTEGER NOT NULL DEFAULT 0,
sniper_adds INTEGER NOT NULL DEFAULT 0,
positions_closed INTEGER NOT NULL DEFAULT 0,
invalidations INTEGER NOT NULL DEFAULT 0,

daily_scout_spend_usd REAL NOT NULL DEFAULT 0,
daily_sniper_spend_usd REAL NOT NULL DEFAULT 0,
daily_realized_pnl_usd REAL NOT NULL DEFAULT 0,
daily_unrealized_pnl_usd REAL NOT NULL DEFAULT 0,
daily_loss_usd REAL NOT NULL DEFAULT 0,

consecutive_failures INTEGER NOT NULL DEFAULT 0,
recent_rug_rate_pct REAL NOT NULL DEFAULT 0,
reclaim_success_rate_pct REAL NOT NULL DEFAULT 0,
avg_market_liquidity_usd REAL NOT NULL DEFAULT 0,

created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

UNIQUE(stat_date, execution_mode)
);

CREATE INDEX IF NOT EXISTS idx_cassie_sentinel_daily_stats_date_mode
ON cassie_sentinel_daily_stats(stat_date, execution_mode);

CREATE TABLE IF NOT EXISTS cassie_sentinel_token_cooldowns (
token_id TEXT PRIMARY KEY,
mint_address TEXT,
last_close_reason TEXT,
cooldown_until TEXT NOT NULL,
updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cassie_sentinel_token_cooldowns_until
ON cassie_sentinel_token_cooldowns(cooldown_until);

COMMIT;
