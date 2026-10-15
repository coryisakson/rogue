-- Link Discord ratings to a Rogue account when the voter has signed in with Discord (identities.provider='discord',
-- provider_uid = the Discord user id). Nullable: people who never signed in stay pseudonymous (hash only).
-- ON DELETE CASCADE keeps account deletion (GDPR) complete for linked votes.
ALTER TABLE discord_answer_ratings ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS discord_answer_ratings_user_idx ON discord_answer_ratings (user_id);
