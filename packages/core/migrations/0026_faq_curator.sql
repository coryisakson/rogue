-- The FAQ Curator merges duplicate player questions of one game into canonical answers as a Nanobot agent job (ADR 0002).
-- Its job belongs to a game, so a job now points at exactly one of source, game request or game.
ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS game_slug TEXT;
ALTER TABLE agent_jobs DROP CONSTRAINT IF EXISTS agent_jobs_target_check;
ALTER TABLE agent_jobs ADD CONSTRAINT agent_jobs_target_check CHECK (num_nonnulls(source_id, request_id, game_slug) = 1);
ALTER TABLE agent_jobs DROP CONSTRAINT IF EXISTS agent_jobs_kind_check;
ALTER TABLE agent_jobs ADD CONSTRAINT agent_jobs_kind_check CHECK (kind IN ('quality_curate','scout_variants','librarian_draft','terms_judge','scout_judge','faq_curate'));
-- At most one open job per kind and game (same rule as for sources and requests).
CREATE UNIQUE INDEX IF NOT EXISTS agent_jobs_one_open_game ON agent_jobs (kind, game_slug) WHERE status IN ('queued','running') AND game_slug IS NOT NULL;

-- Canonical FAQ entries. Provenance rule: no row without at least one citation and one merged player question.
-- Rows are public only once their job has finished; a finished job with entries replaces the game's older entries.
CREATE TABLE IF NOT EXISTS faq_canonical (
  id            BIGSERIAL PRIMARY KEY,
  game_slug     TEXT NOT NULL,
  job_id        BIGINT REFERENCES agent_jobs(id) ON DELETE SET NULL,
  question      TEXT NOT NULL CHECK (length(question) BETWEEN 1 AND 200),
  answer        TEXT NOT NULL CHECK (length(answer) BETWEEN 1 AND 600),
  sources       JSONB NOT NULL CHECK (jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) >= 1),
  source_qnorms TEXT[] NOT NULL CHECK (cardinality(source_qnorms) >= 1),
  status        TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS faq_canonical_game_idx ON faq_canonical (game_slug, status);
