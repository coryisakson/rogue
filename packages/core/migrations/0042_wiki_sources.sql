-- Wiki sources (task wiki-import, ADR 0006). A game's rules may live only in a wiki (BookStack, MediaWiki): each wiki page
-- becomes one source with document kind 'wiki' (lower authority weight, AGENTS.md 2b). Idempotent.

-- Document kind 'wiki' next to rulebook/faq/...
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_kind_check;
ALTER TABLE documents ADD CONSTRAINT documents_kind_check CHECK (kind IN ('rulebook','faq','errata','quickstart','forum_post','article','wiki','other'));

-- One wiki import (crawl) of a game: the crawl plan (queue, seen URLs) is stored after every page so a restart resumes it.
CREATE TABLE IF NOT EXISTS wiki_crawls (
  id          BIGSERIAL PRIMARY KEY,
  game_slug   TEXT NOT NULL,
  start_url   TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('pages','site')),
  publisher   TEXT NOT NULL,
  language    TEXT NOT NULL,
  force       BOOLEAN NOT NULL DEFAULT false,
  status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','stopped','failed')),
  plan        JSONB NOT NULL,                               -- packages/core/src/wiki/crawl.ts CrawlPlan
  counts      JSONB NOT NULL DEFAULT '{}'::jsonb,           -- imported / unchanged / failed / taken down / discovered
  progress    TEXT,
  request_id  BIGINT REFERENCES game_requests(id) ON DELETE SET NULL,  -- a wiki-only game request that started it
  started_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wiki_crawls_game ON wiki_crawls (game_slug, id DESC);
-- One crawl per game at a time.
CREATE UNIQUE INDEX IF NOT EXISTS wiki_crawls_one_running ON wiki_crawls (game_slug) WHERE status = 'running';

-- A game request may give a wiki start URL instead of a rulebook link; the Rights Officer and terms checks then run on the wiki host.
ALTER TABLE game_requests ADD COLUMN IF NOT EXISTS wiki_url TEXT;
