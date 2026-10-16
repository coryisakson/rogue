-- The Terms Agent judgement runs as a Nanobot agent job (ADR 0002). Its job belongs to a game request, not to a source,
-- so a job now points at exactly one of the two.
ALTER TABLE agent_jobs ALTER COLUMN source_id DROP NOT NULL;
ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS request_id BIGINT REFERENCES game_requests(id) ON DELETE CASCADE;
ALTER TABLE agent_jobs DROP CONSTRAINT IF EXISTS agent_jobs_target_check;
ALTER TABLE agent_jobs ADD CONSTRAINT agent_jobs_target_check CHECK (num_nonnulls(source_id, request_id) = 1);
ALTER TABLE agent_jobs DROP CONSTRAINT IF EXISTS agent_jobs_kind_check;
ALTER TABLE agent_jobs ADD CONSTRAINT agent_jobs_kind_check CHECK (kind IN ('quality_curate','scout_variants','librarian_draft','terms_judge'));
-- At most one open job per kind and request (same rule as agent_jobs_one_open for sources).
CREATE UNIQUE INDEX IF NOT EXISTS agent_jobs_one_open_request ON agent_jobs (kind, request_id) WHERE status IN ('queued','running') AND request_id IS NOT NULL;
