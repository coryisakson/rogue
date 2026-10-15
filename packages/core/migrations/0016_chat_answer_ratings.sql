-- Helpful / not helpful votes on rules-chat answers shown on the website.
-- No question or answer text is stored (privacy): only the game, which answer id and the voter's account.
-- Deleting the account deletes its votes (GDPR). One vote per user per answer; voting again replaces it.
CREATE TABLE IF NOT EXISTS chat_answers (
  id          BIGSERIAL PRIMARY KEY,
  game_slug   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_answer_ratings (
  answer_id   BIGINT NOT NULL REFERENCES chat_answers(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  helpful     BOOLEAN NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (answer_id, user_id)
);
