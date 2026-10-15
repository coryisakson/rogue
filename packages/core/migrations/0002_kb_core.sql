-- KB core (design plan section 5): games, editions, documents (links + hashes, never hosted rulebooks),
-- and claims. A claim is a small statement of fact in our own words and MUST cite a source.

CREATE TABLE games (
  id          BIGSERIAL PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  bgg_id      INTEGER UNIQUE,
  publisher   TEXT,
  year        INTEGER,
  min_players SMALLINT,
  max_players SMALLINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A rules version of a game. superseded_by lets old rules stay queryable but clearly marked.
CREATE TABLE editions (
  id            BIGSERIAL PRIMARY KEY,
  game_id       BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  language      TEXT NOT NULL DEFAULT 'en',
  released      DATE,
  superseded_by BIGINT REFERENCES editions(id),
  UNIQUE (game_id, label, language)
);

-- What a source document is about (a rulebook for edition X). The bytes are not stored here.
CREATE TABLE documents (
  id         BIGSERIAL PRIMARY KEY,
  source_id  BIGINT NOT NULL REFERENCES sources(id),
  edition_id BIGINT REFERENCES editions(id),
  kind       TEXT NOT NULL CHECK (kind IN ('rulebook','faq','errata','quickstart','forum_post','article','other')),
  UNIQUE (source_id, edition_id)
);

-- Claims are the unit of knowledge. topic examples: 'setup', 'player_count_variant', 'component'.
-- player_count NULL means "applies to every player count".
CREATE TABLE claims (
  id            BIGSERIAL PRIMARY KEY,
  edition_id    BIGINT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  topic         TEXT NOT NULL,
  player_count  SMALLINT,
  body          TEXT NOT NULL,
  language      TEXT NOT NULL DEFAULT 'en',
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','rejected','superseded')),
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every claim needs at least one citation before it may be published (enforced by the trigger below).
CREATE TABLE citations (
  id          BIGSERIAL PRIMARY KEY,
  claim_id    BIGINT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  document_id BIGINT NOT NULL REFERENCES documents(id),
  locator     TEXT,            -- page / section, e.g. "p.4 Setup"
  quote       TEXT,            -- short quote only, within policy limits
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX claims_edition_topic ON claims (edition_id, topic, status);
CREATE INDEX citations_claim ON citations (claim_id);

CREATE FUNCTION require_citation_to_publish() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'published' AND NOT EXISTS (SELECT 1 FROM citations WHERE claim_id = NEW.id) THEN
    RAISE EXCEPTION 'claim % cannot be published without a citation', NEW.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER claims_need_citation
  BEFORE INSERT OR UPDATE OF status ON claims
  FOR EACH ROW EXECUTE FUNCTION require_citation_to_publish();
