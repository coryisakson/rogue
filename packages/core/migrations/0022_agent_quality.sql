-- Agent jobs (Nanobot sidecar), page text quality, page repairs and text variants of rulebooks.

-- One row per piece of AI work. The web app owns the queue; agents only act through propose-only tools tied to a running job.
CREATE TABLE IF NOT EXISTS agent_jobs (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('quality_curate','scout_variants')),
  source_id   BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','needs_human','failed')),
  attempts    INT NOT NULL DEFAULT 0,
  not_before  TIMESTAMPTZ NOT NULL DEFAULT now(),
  summary     TEXT,
  error       TEXT,
  result      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
-- At most one open job per kind and source (double clicks, re-index loops and sweeps cannot pile up).
CREATE UNIQUE INDEX IF NOT EXISTS agent_jobs_one_open ON agent_jobs (kind, source_id) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS agent_jobs_status_idx ON agent_jobs (status, not_before);

-- Deterministic text quality per page of a source (written by the indexer from packages/core/src/quality).
CREATE TABLE IF NOT EXISTS page_quality (
  source_id BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  page      INT NOT NULL,
  score     REAL NOT NULL,
  verdict   TEXT NOT NULL CHECK (verdict IN ('ok','suspect','garbled','empty')),
  issues    JSONB NOT NULL DEFAULT '[]'::jsonb,
  content_hash TEXT,
  -- auto = as extracted; repaired = better text from re-OCR or an accepted agent repair; unusable = agent judged it unreadable, page is not indexed; reviewed = agent looked, could not fix, page stays indexed at low weight
  state     TEXT NOT NULL DEFAULT 'auto' CHECK (state IN ('auto','repaired','unusable','reviewed')),
  note      TEXT,
  PRIMARY KEY (source_id, page)
);

-- Better text for a page. Keyed by the file hash so a changed rulebook never inherits repairs made for the old file.
CREATE TABLE IF NOT EXISTS page_overrides (
  source_id    BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  page         INT NOT NULL,
  content_hash TEXT NOT NULL,
  text         TEXT NOT NULL,
  method       TEXT NOT NULL CHECK (method IN ('ocr','agent')),
  actor        TEXT NOT NULL,
  score_before REAL,
  score_after  REAL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, page)
);

-- Retrieval multiplier input: the page's quality score at index time (NULL = not scored).
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS quality REAL;

-- Text versions (HTML/plain text) of a rulebook PDF found by the Scout.
CREATE TABLE IF NOT EXISTS text_variants (
  id                BIGSERIAL PRIMARY KEY,
  source_id         BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  url               TEXT NOT NULL,
  variant_source_id BIGINT REFERENCES sources(id) ON DELETE SET NULL,
  status            TEXT NOT NULL CHECK (status IN ('accepted','needs_human','rejected')),
  coverage          REAL,
  size_ratio        REAL,
  reason            TEXT,
  proposed_by       TEXT NOT NULL,
  decided_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, url)
);
