-- Phase 1 exit test: every document, chunk and published fact traces to a source that passed the rights gate,
-- and ingestion of anything without that is blocked by the database itself (not only by app code).
-- "Permitted" = fetched under a recorded Jurisdiction Policy version, OR an active rights grant, OR an authorized/open_license source.
CREATE FUNCTION source_is_permitted(sid BIGINT) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM sources s WHERE s.id = sid AND (
      s.policy_version IS NOT NULL
      OR s.rights_status IN ('authorized','open_license')
      OR EXISTS (SELECT 1 FROM rights_grants g WHERE g.source_id = s.id AND g.revoked_at IS NULL)))
$$ LANGUAGE sql STABLE;

CREATE FUNCTION require_permitted_source() RETURNS trigger AS $$
BEGIN
  IF NOT source_is_permitted(NEW.source_id) THEN
    RAISE EXCEPTION 'source % has no rights-gate record or grant; ingestion blocked', NEW.source_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER documents_need_permitted_source BEFORE INSERT ON documents FOR EACH ROW EXECUTE FUNCTION require_permitted_source();
CREATE TRIGGER chunks_need_permitted_source BEFORE INSERT ON chunks FOR EACH ROW EXECUTE FUNCTION require_permitted_source();

-- Audit view: should always be empty. Each row is one broken link in the chain claim -> citation -> document -> source/edition -> rights.
CREATE VIEW provenance_violations AS
  SELECT 'claim_without_citation' AS problem, 'claim' AS kind, c.id AS ref FROM claims c
    WHERE c.status = 'published' AND NOT EXISTS (SELECT 1 FROM citations ci WHERE ci.claim_id = c.id)
  UNION ALL
  SELECT 'citation_without_permitted_source', 'claim', ci.claim_id FROM citations ci
    JOIN documents d ON d.id = ci.document_id JOIN claims c ON c.id = ci.claim_id
    WHERE c.status = 'published' AND NOT source_is_permitted(d.source_id)
  UNION ALL
  SELECT 'citation_document_has_no_edition', 'claim', ci.claim_id FROM citations ci
    JOIN documents d ON d.id = ci.document_id JOIN claims c ON c.id = ci.claim_id
    WHERE c.status = 'published' AND d.edition_id IS NULL
  UNION ALL
  SELECT 'chunk_without_permitted_source', 'chunk', ch.id FROM chunks ch WHERE NOT source_is_permitted(ch.source_id)
  UNION ALL
  SELECT 'document_without_permitted_source', 'document', d.id FROM documents d WHERE NOT source_is_permitted(d.source_id);
