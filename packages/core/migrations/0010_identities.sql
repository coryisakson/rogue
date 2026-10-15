-- One person, several sign-in providers: identities hold (provider, provider uid), users hold the profile.
CREATE TABLE identities (
  provider     TEXT NOT NULL,
  provider_uid TEXT NOT NULL,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_uid)
);
CREATE INDEX identities_user ON identities(user_id);
INSERT INTO identities(provider, provider_uid, user_id) SELECT provider, provider_uid, id FROM users;
-- users.provider/provider_uid stay as "first sign-in" info only; they no longer identify the user.
ALTER TABLE users DROP CONSTRAINT users_provider_provider_uid_key;
ALTER TABLE users ALTER COLUMN provider DROP NOT NULL;
ALTER TABLE users ALTER COLUMN provider_uid DROP NOT NULL;
