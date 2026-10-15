-- Rules-chat FAQ: keep the question and the answer (with its sources) so well-rated answers can be shown to everyone.
-- Not linked to any user (chat_answers has no user column). Rows from before this migration have NULL text and never appear.
ALTER TABLE chat_answers ADD COLUMN IF NOT EXISTS question TEXT;
ALTER TABLE chat_answers ADD COLUMN IF NOT EXISTS question_norm TEXT;
ALTER TABLE chat_answers ADD COLUMN IF NOT EXISTS answer TEXT;
ALTER TABLE chat_answers ADD COLUMN IF NOT EXISTS sources JSONB;
CREATE INDEX IF NOT EXISTS chat_answers_faq_idx ON chat_answers(game_slug, question_norm);
-- Admin decision per question: 'hidden' = removed from the public FAQ, 'kept' = looked at and fine, stop flagging.
CREATE TABLE IF NOT EXISTS faq_state (
  game_slug     TEXT NOT NULL,
  question_norm TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('hidden','kept')),
  reason        TEXT,
  decided_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  decided_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_slug, question_norm)
);
