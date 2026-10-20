-- "Review and update this game" runs (docs/DERIVED_OUTPUTS.md, apps/web/src/lib/game-update.ts). Idempotent.
-- One background job per game: recheck, re-ingest, extract review, Librarian, supersede, rebuild. The step list with each
-- step's outcome is saved after every step, so a run interrupted by a restart resumes (same pattern as wiki_crawls).
CREATE TABLE IF NOT EXISTS game_updates (
  id          BIGSERIAL PRIMARY KEY,
  game_slug   TEXT NOT NULL REFERENCES games(slug) ON DELETE CASCADE ON UPDATE CASCADE,
  status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed','stopped')),
  steps       JSONB NOT NULL,                               -- packages/core/src/game-update.ts StepRecord[]
  redraft     BOOLEAN NOT NULL DEFAULT false,               -- admin ticked "redraft": Librarian also on drafted sources
  progress    TEXT,
  started_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS game_updates_game ON game_updates (game_slug, id DESC);
-- One run per game at a time.
CREATE UNIQUE INDEX IF NOT EXISTS game_updates_one_running ON game_updates (game_slug) WHERE status = 'running';
