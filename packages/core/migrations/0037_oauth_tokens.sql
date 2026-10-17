-- MCP OAuth (ADR 0004): access (1 hour) and refresh (30 days, rotated on use) tokens, stored only as SHA-256 hashes.
-- One grant (consent) has many rows over time; revoking a grant sets revoked_at on all of them. Account deletion cascades.
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id           BIGSERIAL PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  kind         TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  grant_id     TEXT NOT NULL,
  client_id    TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope        TEXT NOT NULL,
  resource     TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS oauth_tokens_grant ON oauth_tokens(grant_id);
CREATE INDEX IF NOT EXISTS oauth_tokens_user ON oauth_tokens(user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS oauth_tokens_expires ON oauth_tokens(expires_at);
