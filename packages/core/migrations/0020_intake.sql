-- Game intake (Cory 2026-10-15): a request can start from a name picked in a search list, or from free-text details,
-- with no rulebook link. The Scout (or the admin, by hand) fills the link in later.
ALTER TABLE game_requests ALTER COLUMN rulebook_url DROP NOT NULL;
ALTER TABLE game_requests ALTER COLUMN publisher DROP NOT NULL;
ALTER TABLE game_requests ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'link';  -- link | pick | details
ALTER TABLE game_requests ADD COLUMN IF NOT EXISTS bgg_id INTEGER;
ALTER TABLE game_requests ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE game_requests ADD COLUMN IF NOT EXISTS stage TEXT;      -- queue stage text shown to requester and admin
ALTER TABLE game_requests DROP CONSTRAINT IF EXISTS game_requests_status_check;
-- submitted -> (pick: queued -> scouting) -> checked -> approved; details requests go to 'manual' (admin searches by hand)
ALTER TABLE game_requests ADD CONSTRAINT game_requests_status_check CHECK (status IN ('submitted','queued','manual','checked','approved','rejected'));
DROP INDEX IF EXISTS game_requests_open_url;
CREATE UNIQUE INDEX IF NOT EXISTS game_requests_open_url ON game_requests (rulebook_url) WHERE rulebook_url IS NOT NULL AND status IN ('submitted','queued','manual','checked','approved');
CREATE UNIQUE INDEX IF NOT EXISTS game_requests_open_bgg ON game_requests (bgg_id) WHERE bgg_id IS NOT NULL AND status IN ('submitted','queued','manual','checked','approved');
