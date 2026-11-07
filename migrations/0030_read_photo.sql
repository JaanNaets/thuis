-- Welke formulieren van een lijst een foto lezen met de AI (shared/photoread.ts): JSON { on: [...], off: [...] } met
-- "dingen" of de id van een soort ("aankoop", of een eigen soort). NULL = de standaard.
ALTER TABLE lists ADD COLUMN read_photo TEXT;
