-- Concurrent seeders (or retried requests) must not create duplicate claims.
DELETE FROM claims a USING claims b WHERE a.id > b.id AND a.edition_id = b.edition_id AND a.body = b.body;
CREATE UNIQUE INDEX claims_edition_body_unique ON claims (edition_id, md5(body));
