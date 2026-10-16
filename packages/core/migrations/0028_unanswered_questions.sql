-- Ask questions that got no answer (refusal, no sources found, error, empty). They join the poorly rated answers in the
-- admin improvement queue (/admin/faq) with reason 'no_answer'. Same privacy as chat_answers: question text, game and
-- channel only, never the user. Repeats of the same question per game are merged: ask_count + last_seen.
CREATE TABLE IF NOT EXISTS unanswered_questions (
  game_slug     TEXT NOT NULL,
  question_norm TEXT NOT NULL,
  question      TEXT NOT NULL,
  channels      TEXT[] NOT NULL DEFAULT '{}',
  last_kind     TEXT NOT NULL CHECK (last_kind IN ('error','empty','no_sources','refusal')),
  ask_count     INTEGER NOT NULL DEFAULT 1,
  first_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL = open in the queue. 'resolved' reopens if the question fails again; 'dismissed' stays closed.
  status        TEXT CHECK (status IN ('resolved','dismissed')),
  decided_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  decided_at    TIMESTAMPTZ,
  PRIMARY KEY (game_slug, question_norm)
);
CREATE INDEX IF NOT EXISTS unanswered_questions_open_idx ON unanswered_questions (last_seen DESC) WHERE status IS NULL;
