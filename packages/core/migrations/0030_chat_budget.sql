-- Rules-chat cost watch: tokens per answer (rewrite + rerank + answer calls) so /admin can show 'Chat tokens today'.
-- standalone_question is the follow-up rewritten using the thread; same privacy as question (no user link, NULL when question is NULL).
ALTER TABLE chat_answers ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER;
ALTER TABLE chat_answers ADD COLUMN IF NOT EXISTS completion_tokens INTEGER;
ALTER TABLE chat_answers ADD COLUMN IF NOT EXISTS standalone_question TEXT;
CREATE INDEX IF NOT EXISTS chat_answers_created_idx ON chat_answers(created_at);
