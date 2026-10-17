-- An admin replaced this source with another site (Game sources page). The recheck must not bring it back to 'available' just because the old link still serves the same file.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ NULL;
