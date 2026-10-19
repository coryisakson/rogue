-- Source authority chosen by an admin (task wiki-publisher, Cory 2026-10-19). Some games are published ONLY as a wiki, so an
-- admin may attest that a wiki is the publisher's official documentation (authority 'publisher'); admin-added links get an
-- Authority choice too. Ingest writes sources.authority from these columns (apps/web/src/lib/ingest.ts). Idempotent.

-- Admin-added links. Rows added before 0043 were ingested as 'publisher' (the old ingest default): keep that for them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'runtime_sources' AND column_name = 'authority') THEN
    ALTER TABLE runtime_sources ADD COLUMN authority TEXT NOT NULL DEFAULT 'community'
      CHECK (authority IN ('publisher','official','community'));
    UPDATE runtime_sources SET authority = 'publisher';
  END IF;
END $$;

-- Wiki imports: community unless the admin ticked "This wiki is the publisher's official documentation".
ALTER TABLE wiki_crawls ADD COLUMN IF NOT EXISTS authority TEXT NOT NULL DEFAULT 'community';
ALTER TABLE wiki_crawls DROP CONSTRAINT IF EXISTS wiki_crawls_authority_check;
ALTER TABLE wiki_crawls ADD CONSTRAINT wiki_crawls_authority_check CHECK (authority IN ('publisher','community'));
