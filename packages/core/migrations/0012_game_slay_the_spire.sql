-- Game: Slay the Spire: The Board Game (Contention Games, 2024). Identity facts only; rules come from the publisher rulebook via ingest.
INSERT INTO games (slug, name, bgg_id, publisher, year, min_players, max_players) VALUES
  ('slay-the-spire', 'Slay the Spire: The Board Game', 338960, 'Contention Games', 2024, 1, 4)
ON CONFLICT (slug) DO NOTHING;
