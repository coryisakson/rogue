-- Admin capture from the browser (Cory 2026-10-18): a source whose text an admin pasted or sent with the bookmarklet because
-- Rogue cannot fetch the page itself (bot wall). NULL capture_method = fetched by Rogue. Shown as "Manual capture by <admin> on <date>".
ALTER TABLE sources ADD COLUMN IF NOT EXISTS capture_method TEXT NULL CHECK (capture_method IS NULL OR capture_method IN ('manual_capture'));
ALTER TABLE sources ADD COLUMN IF NOT EXISTS captured_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ NULL;
