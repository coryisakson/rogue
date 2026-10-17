-- Admin-editable settings (/admin/settings): models, endpoints and API keys. Resolution everywhere is
-- app_settings value, else env var, else code default; an empty table behaves exactly like env-only config.
-- `key` is the env var name it overrides (e.g. ROGUE_AI_CHAT_MODEL). Secret values are AES-256-GCM encrypted with the
-- backup key ('enc:v1:' prefix) and never logged; changes are recorded in audit_log (values only for non-secrets).
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  is_secret  BOOLEAN NOT NULL DEFAULT false,
  updated_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
