-- Full-rulebook retrieval index (private working text; never served whole). Keyword + vector, cited by page.
CREATE TABLE chunks (
  id          BIGSERIAL PRIMARY KEY,
  source_id   BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  page        INT NOT NULL,
  ord         INT NOT NULL,
  text        TEXT NOT NULL,
  lang        TEXT NOT NULL DEFAULT 'en',
  tsv         TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED,
  embedding   vector(768),
  embed_model TEXT,
  UNIQUE (source_id, ord)
);
CREATE INDEX chunks_tsv_idx ON chunks USING GIN (tsv);
CREATE INDEX chunks_source_idx ON chunks (source_id);
