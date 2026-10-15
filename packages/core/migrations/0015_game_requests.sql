-- Add-game flow: a signed-in user proposes a game + publisher rulebook link; code checks rights (robots, TDM, opt-out);
-- an admin approves; only then the host is allowlisted, the game created and the rulebook ingested.
CREATE TABLE IF NOT EXISTS game_requests (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,   -- GDPR: deleting the account keeps the request, drops the link
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  publisher    TEXT NOT NULL,
  year         INTEGER,
  language     TEXT NOT NULL DEFAULT 'en',
  rulebook_url TEXT NOT NULL,
  found_on     TEXT,
  status       TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','checked','approved','rejected')),
  report       JSONB,                 -- Rights Officer result: verdict + findings
  progress     TEXT,                  -- ingest / index / librarian pipeline after approval
  decided_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  decided_at   TIMESTAMPTZ,
  reject_reason TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_requests_status_idx ON game_requests (status);
-- One open request per rulebook link.
CREATE UNIQUE INDEX IF NOT EXISTS game_requests_open_url ON game_requests (rulebook_url) WHERE status IN ('submitted','checked','approved');

-- Hosts approved by a human through a request; merged into the static allowlist at runtime.
CREATE TABLE IF NOT EXISTS approved_hosts (
  host        TEXT PRIMARY KEY,
  request_id  BIGINT REFERENCES game_requests(id) ON DELETE SET NULL,
  approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
