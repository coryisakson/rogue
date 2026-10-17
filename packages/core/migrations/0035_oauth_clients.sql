-- MCP OAuth (ADR 0004): apps registered through RFC 7591 dynamic client registration. Public clients only (no secrets).
-- client_name is chosen by the client and unverified; the consent screen says so.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id     TEXT PRIMARY KEY,
  client_name   TEXT NOT NULL,
  redirect_uris TEXT[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 10),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
