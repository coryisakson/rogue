-- The Scout's page judgement (which publisher-page links are this game's rulebook, FAQ or errata) runs as a Nanobot agent
-- job on a game request (ADR 0002). Only the job-kind list changes; request jobs exist since 0024.
ALTER TABLE agent_jobs DROP CONSTRAINT IF EXISTS agent_jobs_kind_check;
ALTER TABLE agent_jobs ADD CONSTRAINT agent_jobs_kind_check CHECK (kind IN ('quality_curate','scout_variants','librarian_draft','terms_judge','scout_judge'));
