-- MCP OAuth (ADR 0004): authorization codes. Stored only as a SHA-256 hash, 5 minutes, single use (used_at).
-- grant_id names the consent; a reused code revokes every token of that grant.
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash      TEXT PRIMARY KEY,
  grant_id       TEXT NOT NULL,
  client_id      TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri   TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope          TEXT NOT NULL,
  resource       TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS oauth_codes_expires ON oauth_codes(expires_at);
