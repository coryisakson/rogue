-- Game sources (task game-sources, 2026-10-17). Rules links an admin added to an EXISTING game from /admin/sources, after the
-- same rights gates as a new game (Rights Officer probe; terms confirmation for a new host). allSeeds() merges these rows into
-- the seed list so ingest, recheck and the curator see them like the static seeds. The fetched document still lives in
-- `sources`; this table only remembers what was added, by whom, and (for a replacement) which source it replaced.
CREATE TABLE IF NOT EXISTS runtime_sources (
  id                 BIGSERIAL PRIMARY KEY,
  game_slug          TEXT NOT NULL,
  url                TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  publisher          TEXT NOT NULL,
  language           TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('rulebook','faq','errata','other')),
  edition_label      TEXT NOT NULL,
  found_on           TEXT,
  replaces_source_id BIGINT REFERENCES sources(id) ON DELETE SET NULL,  -- the source marked unavailable by "Replace source"
  report             JSONB,                                             -- Rights Officer probe result at the time it was added
  progress           TEXT,                                              -- ingest / index / Librarian pipeline
  added_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runtime_sources_game ON runtime_sources (game_slug);
