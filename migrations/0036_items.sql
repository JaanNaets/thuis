-- "Item" in plaats van "ding", ook in de databank: `things` heet nu `items`, een lijn en een verandering wijzen naar
-- `item_id`, een bestand hoort bij een 'item' en een bewaarde weergave toont 'items'.
--
-- Het oude model (projecten, soorten en items van voor 0029_lijsten) wordt sindsdien nergens meer gebruikt en gaat
-- weg: zijn gegevens staan al in de lijsten, en de naam `items` is nu voor de items van een lijst.
PRAGMA defer_foreign_keys = true;

DROP TABLE IF EXISTS fixed_values;
DROP TABLE IF EXISTS item_tags;
DROP TABLE IF EXISTS item_files;
DROP TABLE IF EXISTS item_log;
DROP TABLE IF EXISTS repeats;
DROP TABLE IF EXISTS views;
DROP TABLE IF EXISTS shown_lists;
DROP TABLE IF EXISTS items;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS item_types;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS projects;

ALTER TABLE things RENAME TO items;
DROP INDEX IF EXISTS things_list;
DROP INDEX IF EXISTS things_part;
DROP INDEX IF EXISTS things_mirror;
CREATE INDEX items_list ON items (list_id, archived, name);
CREATE INDEX items_part ON items (part_of);
CREATE INDEX items_mirror ON items (mirror_id, mirror_of);

ALTER TABLE lines RENAME COLUMN thing_id TO item_id;
DROP INDEX IF EXISTS lines_thing;
CREATE INDEX lines_item ON lines (item_id);

ALTER TABLE effects RENAME COLUMN thing_id TO item_id;
DROP INDEX IF EXISTS effects_thing;
CREATE INDEX effects_item ON effects (item_id, field);

-- Bestanden bij een item of een gebeurtenis (in R2; de sleutels blijven `items/<id>/…`).
CREATE TABLE attachments_new (
  id            TEXT PRIMARY KEY,
  owner_kind    TEXT NOT NULL CHECK (owner_kind IN ('item', 'event')),
  owner_id      TEXT NOT NULL,
  filename      TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  r2_key        TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO attachments_new (id, owner_kind, owner_id, filename, content_type, size_bytes, r2_key, created_by, created_at)
  SELECT id, CASE owner_kind WHEN 'thing' THEN 'item' ELSE owner_kind END, owner_id, filename, content_type, size_bytes, r2_key, created_by, created_at
  FROM attachments;
DROP TABLE attachments;
ALTER TABLE attachments_new RENAME TO attachments;
CREATE INDEX attachments_owner ON attachments (owner_kind, owner_id);

-- Bewaarde weergaven: van de items of van het logboek.
CREATE TABLE saved_views_new (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  list_id     TEXT REFERENCES lists (id) ON DELETE CASCADE,
  target      TEXT NOT NULL CHECK (target IN ('items', 'logboek')),
  name        TEXT NOT NULL,
  def         TEXT NOT NULL,
  shared      INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO saved_views_new (id, owner_id, list_id, target, name, def, shared, sort_order, created_at)
  SELECT id, owner_id, list_id, CASE target WHEN 'dingen' THEN 'items' ELSE target END, name, def, shared, sort_order, created_at
  FROM saved_views;
DROP TABLE saved_views;
ALTER TABLE saved_views_new RENAME TO saved_views;
CREATE INDEX saved_views_list ON saved_views (list_id);

-- Welke formulieren een foto lezen: het formulier om een item toe te voegen heet nu "items".
UPDATE lists SET read_photo = replace(read_photo, '"dingen"', '"items"') WHERE read_photo IS NOT NULL;
