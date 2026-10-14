-- Phase 0 schema skeleton (design plan sections 5, 5a, 6b). Keep migrations additive and idempotent-safe.
CREATE EXTENSION IF NOT EXISTS vector;

-- Where knowledge comes from. Rights status gates what may be stored or quoted.
CREATE TABLE sources (
  id            BIGSERIAL PRIMARY KEY,
  url           TEXT NOT NULL,
  title         TEXT,
  publisher     TEXT,
  language      TEXT NOT NULL DEFAULT 'und',
  authority     TEXT NOT NULL DEFAULT 'community'
                CHECK (authority IN ('publisher','author','official','community','forum','other')),
  rights_status TEXT NOT NULL DEFAULT 'link_only'
                CHECK (rights_status IN ('authorized','open_license','link_only','none_found')),
  content_hash  TEXT,
  fetched_at    TIMESTAMPTZ,
  policy_version TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (url)
);

-- Explicit permissions granted by a rights holder (publisher portal / outreach), audited.
CREATE TABLE rights_grants (
  id          BIGSERIAL PRIMARY KEY,
  source_id   BIGINT NOT NULL REFERENCES sources(id),
  grantor     TEXT NOT NULL,
  scope       TEXT NOT NULL,
  evidence    TEXT,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);

-- Takedown / opt-out log. Replayed after any restore so removed content never reappears.
CREATE TABLE tombstones (
  id         BIGSERIAL PRIMARY KEY,
  url        TEXT NOT NULL,
  reason     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit trail for agent and admin actions.
CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
