-- Vaste waarden van het geheugen (veldoptie remember_fixed, zie shared/fields.ts): per persoon, lijst en veld, en per
-- keuze bij remember_by (by_value = rememberKey; '' = voor alles). Bv. Hoeveel = 250 g bij Pasta. De laatste waarde
-- (gewoon onthouden) staat niet hier: die komt uit je eigen items.
CREATE TABLE fixed_values (
  person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  type_id    TEXT NOT NULL REFERENCES item_types(id) ON DELETE CASCADE,
  field_key  TEXT NOT NULL,
  by_value   TEXT NOT NULL DEFAULT '',
  value      TEXT NOT NULL,             -- JSON, nagekeken met cleanAttributes
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (person_id, type_id, field_key, by_value)
);
