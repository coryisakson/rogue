-- Scout result for a game request: ranked document candidates from the publisher page and terms-of-use flags.
ALTER TABLE game_requests ADD COLUMN IF NOT EXISTS scout JSONB;
