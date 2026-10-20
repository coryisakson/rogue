-- Derived output versions (ADR 0008, docs/DERIVED_OUTPUTS.md). Idempotent.
-- One row per game for its setup one-pager and player aid: the version, when it was built and from what (basis = the
-- game's available sources with their content hash, plus the published claim ids). The version goes up only when
-- basis_hash changes. Old versions are not kept (Cory 2026-10-19): the row is overwritten in place, no history table.
CREATE TABLE IF NOT EXISTS game_outputs (
  game_slug  TEXT PRIMARY KEY REFERENCES games(slug) ON DELETE CASCADE ON UPDATE CASCADE,
  version    INT NOT NULL DEFAULT 1 CHECK (version >= 1),
  built_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  basis_hash TEXT NOT NULL,
  basis      JSONB NOT NULL
);
