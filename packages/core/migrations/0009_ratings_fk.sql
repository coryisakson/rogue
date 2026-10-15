-- GDPR: ratings must disappear with the account. user_id was TEXT with no FK; make it BIGINT -> users(id) ON DELETE CASCADE.
-- Rows that cannot belong to a real user (non-numeric or orphaned) are removed first; they would violate the FK.
DELETE FROM claim_ratings WHERE user_id !~ '^[0-9]+$';
DELETE FROM claim_ratings WHERE user_id::bigint NOT IN (SELECT id FROM users);
ALTER TABLE claim_ratings ALTER COLUMN user_id TYPE BIGINT USING user_id::bigint;
ALTER TABLE claim_ratings ADD CONSTRAINT claim_ratings_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
