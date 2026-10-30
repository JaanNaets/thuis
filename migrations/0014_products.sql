-- Productinfo uit Open Food Facts (zie shared/product.ts), even bijgehouden: hetzelfde product of dezelfde zoekvraag
-- vraagt de app niet opnieuw op. `data` is null als er niets gevonden werd (dan vragen we het pas na een dag opnieuw).
CREATE TABLE products (
  key        TEXT PRIMARY KEY,           -- "code:3017620422003" of "zoek:nutella|ferrero"
  data       TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Automatisch lezen met AI, per persoon per dag: zo gebruikt niemand de foto's van een ander op.
CREATE TABLE ai_usage_people (
  day       TEXT NOT NULL,              -- YYYY-MM-DD (UTC)
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  calls     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, person_id)
);
