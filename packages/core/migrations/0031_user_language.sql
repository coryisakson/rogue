-- Per-user language (Cory 2026-10-16). NULL = not chosen: the language cookie, then the browser's Accept-Language decide.
ALTER TABLE users ADD COLUMN IF NOT EXISTS language TEXT NULL CHECK (language IN ('en', 'de', 'zh', 'es', 'it'));

-- Keyword search by chunk language: chunks.tsv used 'simple' (no stemming) for every chunk. Rebuild it with the chunk's own
-- config (german/spanish/italian/english; zh and anything else stay 'simple', zh relies on vectors). The CASE must match
-- tsConfigSql('lang') in packages/core/src/chat/search-lang.ts (a test checks this). Rewrites the chunks table once.
DROP INDEX IF EXISTS chunks_tsv_idx;
ALTER TABLE chunks DROP COLUMN tsv;
ALTER TABLE chunks ADD COLUMN tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector(CASE lower(split_part(lang, '-', 1)) WHEN 'en' THEN 'english'::regconfig WHEN 'de' THEN 'german'::regconfig WHEN 'es' THEN 'spanish'::regconfig WHEN 'it' THEN 'italian'::regconfig ELSE 'simple'::regconfig END, text)) STORED;
CREATE INDEX chunks_tsv_idx ON chunks USING GIN (tsv);
