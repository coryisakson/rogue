-- The Librarian (cited-claim drafting) runs as a Nanobot agent job too (ADR 0002). Progress lives in agent_jobs.result.
ALTER TABLE agent_jobs DROP CONSTRAINT IF EXISTS agent_jobs_kind_check;
ALTER TABLE agent_jobs ADD CONSTRAINT agent_jobs_kind_check CHECK (kind IN ('quality_curate','scout_variants','librarian_draft'));
