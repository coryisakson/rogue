-- Terms Agent result for a game request: which site's terms were read, the verdict and the lines behind it.
ALTER TABLE game_requests ADD COLUMN IF NOT EXISTS terms_check JSONB;
