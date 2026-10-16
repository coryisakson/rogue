-- Game: Azul (Michael Kiesling, Plan B Games / Next Move, 2017). Identity facts only; rules come from ingested rulebooks.
INSERT INTO games (slug, name, bgg_id, publisher, year, min_players, max_players) VALUES
  ('azul', 'Azul', 230802, 'Plan B Games', 2017, 2, 4)
ON CONFLICT (slug) DO NOTHING;
