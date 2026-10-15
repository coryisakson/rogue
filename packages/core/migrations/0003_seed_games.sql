-- Seed: well-known games only (identity facts: name, publisher, year, player counts). No rules text.
INSERT INTO games (slug, name, bgg_id, publisher, year, min_players, max_players) VALUES
  ('catan', 'CATAN', 13, 'KOSMOS / CATAN Studio', 1995, 3, 4),
  ('carcassonne', 'Carcassonne', 822, 'Hans im Glück', 2000, 2, 5),
  ('ticket-to-ride', 'Ticket to Ride', 9209, 'Days of Wonder', 2004, 2, 5),
  ('pandemic', 'Pandemic', 30549, 'Z-Man Games', 2008, 2, 4),
  ('wingspan', 'Wingspan', 266192, 'Stonemaier Games', 2019, 1, 5),
  ('azul', 'Azul', 230802, 'Plan B Games', 2017, 2, 4)
ON CONFLICT (slug) DO NOTHING;
