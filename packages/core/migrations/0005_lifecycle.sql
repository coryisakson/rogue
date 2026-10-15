-- Lifecycle (docs/CURATION_POLICY.md): dead sources are marked, never deleted; wrong claims are rated down or
-- rejected with proof; takedowns are a manual-trigger, one-command purge.

ALTER TABLE sources ADD COLUMN availability TEXT NOT NULL DEFAULT 'available'
  CHECK (availability IN ('available','unavailable','changed'));
ALTER TABLE sources ADD COLUMN last_checked_at TIMESTAMPTZ;
ALTER TABLE sources ADD COLUMN unavailable_since TIMESTAMPTZ;

ALTER TABLE claims DROP CONSTRAINT claims_status_check;
ALTER TABLE claims ADD CONSTRAINT claims_status_check
  CHECK (status IN ('draft','needs_review','published','rejected','superseded'));
ALTER TABLE claims ADD COLUMN rejected_reason TEXT;
ALTER TABLE claims ADD COLUMN rejected_by TEXT;
ALTER TABLE claims ADD COLUMN verified_at TIMESTAMPTZ;

-- 1-5 star ratings from signed-in users (user_id is the auth subject; one rating per user per claim).
CREATE TABLE claim_ratings (
  claim_id   BIGINT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  stars      SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (claim_id, user_id)
);

-- A rejection needs evidence: what proved the claim wrong, and which model(s) said so.
CREATE TABLE claim_disproofs (
  id         BIGSERIAL PRIMARY KEY,
  claim_id   BIGINT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  evidence   TEXT NOT NULL,
  source_id  BIGINT REFERENCES sources(id),
  locator    TEXT,
  verdicts   JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{model, verdict, at}], frontier model last
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE takedown_requests (
  id          BIGSERIAL PRIMARY KEY,
  requester   TEXT NOT NULL,
  scope_url   TEXT,
  scope_game  TEXT,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','purged','declined')),
  summary     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  purged_at   TIMESTAMPTZ
);

-- Users can nominate a replacement for an unavailable source; the Curator checks it through the rights gate.
CREATE TABLE source_suggestions (
  id         BIGSERIAL PRIMARY KEY,
  game_id    BIGINT REFERENCES games(id),
  url        TEXT NOT NULL,
  note       TEXT,
  suggested_by TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','accepted','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
