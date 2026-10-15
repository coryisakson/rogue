-- Minimal accounts: identity comes from an OAuth provider, we store no passwords.
CREATE TABLE users (
  id           BIGSERIAL PRIMARY KEY,
  provider     TEXT NOT NULL,
  provider_uid TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);
-- Only the SHA-256 of the session token is stored, so a database leak does not leak live sessions.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_expires ON sessions(expires_at);
