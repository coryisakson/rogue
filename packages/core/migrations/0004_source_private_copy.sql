-- Where our private (never served) cached copy of a fetched source lives, plus extracted-text location.
ALTER TABLE sources ADD COLUMN private_path TEXT;
ALTER TABLE sources ADD COLUMN text_path TEXT;
ALTER TABLE sources ADD COLUMN page_count INTEGER;
ALTER TABLE sources ADD COLUMN content_type TEXT;
