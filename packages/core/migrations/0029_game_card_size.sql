-- Default player-aid size per game (/games/[slug]/aid). NULL = poker card. Keys match CARD_SIZES in packages/core/src/aid/aid.ts.
ALTER TABLE games ADD COLUMN IF NOT EXISTS card_size TEXT CHECK (card_size IN ('poker','mini','tarot','page','letter'));
