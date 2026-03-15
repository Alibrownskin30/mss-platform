ALTER TABLE launches ADD COLUMN final_supply TEXT;
ALTER TABLE launches ADD COLUMN unsold_participant_tokens_burned TEXT;
ALTER TABLE launches ADD COLUMN unused_bonus_tokens_burned TEXT;
ALTER TABLE launches ADD COLUMN internal_pool_sol REAL;
ALTER TABLE launches ADD COLUMN internal_pool_tokens TEXT;
ALTER TABLE launches ADD COLUMN raydium_liquidity_tokens_reserved TEXT;
ALTER TABLE launches ADD COLUMN launch_result_json TEXT;