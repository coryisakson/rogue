-- Thumbs up/down on Discord /ask answers. No question or answer text is stored (privacy): only which game,
-- which Discord message, a salted hash of the Discord user (not reversible to an id) and the verdict.
-- One vote per user per message; voting again replaces it.
CREATE TABLE IF NOT EXISTS discord_answer_ratings (
  id          BIGSERIAL PRIMARY KEY,
  game_slug   TEXT NOT NULL,
  message_id  TEXT NOT NULL,
  user_hash   TEXT NOT NULL,
  helpful     BOOLEAN NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_hash)
);
CREATE INDEX IF NOT EXISTS discord_answer_ratings_game_idx ON discord_answer_ratings (game_slug);
