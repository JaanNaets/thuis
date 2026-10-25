-- Flexibele projecten en wie eigenaar is.
--
-- - Een project kiest zijn onderdelen: uitgaven (zoals een reis of een verbouwing) en/of dingen (een verzameling:
--   de wijnkelder, de koersfietsen), met eigen velden per project (jaargang, druiven, framemaat, …).
-- - Per deelnemer: doet volledig mee ('all'), of ziet enkel zijn deel ('own'): de dingen waarvan die mede-eigenaar
--   is en de uitgaven waarin die zelf deelt.
-- - Elk ding kan eigenaars hebben, in procent (samen 100). Zonder eigenaars is het van het huishouden samen.

ALTER TABLE projects ADD COLUMN template TEXT;                                   -- wine, bikes, custom, … (leeg = gewoon project)
ALTER TABLE projects ADD COLUMN track_expenses INTEGER NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN track_items INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN item_type TEXT CHECK (item_type IN ('consumable', 'asset'));
ALTER TABLE projects ADD COLUMN item_unit TEXT;                                  -- standaard eenheid: fles, stuk
ALTER TABLE projects ADD COLUMN fields TEXT;                                     -- JSON: de eigen velden (shared/fields.ts)

ALTER TABLE project_members ADD COLUMN scope TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'own'));

ALTER TABLE items ADD COLUMN project_id TEXT REFERENCES projects (id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN attributes TEXT;                                    -- JSON: waarden van de eigen velden
ALTER TABLE items ADD COLUMN photo_version INTEGER;                              -- foto (bv. het etiket) in R2; null = geen

CREATE INDEX idx_items_project ON items (project_id) WHERE project_id IS NOT NULL;

CREATE TABLE item_owners (
  item_id    TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  share      REAL NOT NULL CHECK (share > 0 AND share <= 100),                 -- procent
  PRIMARY KEY (item_id, member_id)
);

CREATE INDEX idx_item_owners_member ON item_owners (member_id);
