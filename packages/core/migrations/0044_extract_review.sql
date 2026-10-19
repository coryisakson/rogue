-- Extract review (ADR 0005, Reviewer skill extract_review per ADR 0007). Idempotent.
-- A new agent job kind; the chosen page text reuses page_overrides (method 'extract'), so loadSourcePages and indexSource
-- pick it up unchanged. page_extract records which pages code was unsure about and what the agent chose, keyed by file hash.
ALTER TABLE agent_jobs DROP CONSTRAINT IF EXISTS agent_jobs_kind_check;
ALTER TABLE agent_jobs ADD CONSTRAINT agent_jobs_kind_check CHECK (kind IN ('quality_curate','scout_variants','librarian_draft','terms_judge','scout_judge','faq_curate','extract_review'));

ALTER TABLE page_overrides DROP CONSTRAINT IF EXISTS page_overrides_method_check;
ALTER TABLE page_overrides ADD CONSTRAINT page_overrides_method_check CHECK (method IN ('ocr','agent','extract'));

CREATE TABLE IF NOT EXISTS page_extract (
  source_id    BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  page         INT NOT NULL,
  content_hash TEXT NOT NULL,
  -- What ingest stored for the page: the PDF text layer or OCR text.
  stored       TEXT NOT NULL CHECK (stored IN ('text_layer','ocr')),
  -- Why code was unsure (garbled, disagree, table, short).
  reasons      TEXT[] NOT NULL DEFAULT '{}',
  -- The accepted agent choice; NULL until reviewed.
  choice       TEXT CHECK (choice IN ('text_layer','ocr','merge')),
  reason       TEXT,
  created_by   TEXT,
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, page)
);
