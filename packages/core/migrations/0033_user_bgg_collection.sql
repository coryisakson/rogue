-- BGG collection (task bgg-collection, 2026-10-17). The user's own BGG username (typed, not verified: it never gates
-- private or write features, docs/BGG_NOTES.md) and their last imported owned-games list. Only id, name and year per
-- game are stored (BGG: store only what the feature needs). Rows go with the user (ON DELETE CASCADE).
ALTER TABLE users ADD COLUMN IF NOT EXISTS bgg_username TEXT NULL CHECK (bgg_username IS NULL OR length(bgg_username) BETWEEN 1 AND 64);

CREATE TABLE IF NOT EXISTS bgg_collections (
  user_id     BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  username    TEXT NULL,                                  -- the BGG username at import time (NULL for a CSV upload)
  source      TEXT NOT NULL CHECK (source IN ('api', 'csv')),
  items       JSONB NOT NULL DEFAULT '[]'::jsonb,         -- [{bggId, name, year}]
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Per-username cache lookup for API imports (lower(username), newest first).
CREATE INDEX IF NOT EXISTS bgg_collections_username ON bgg_collections (lower(username), fetched_at DESC) WHERE source = 'api';
