-- Web-page sources have no pages: chunks keep the section heading so chat can cite it by name.
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS locator TEXT;
