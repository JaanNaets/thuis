-- Een volledig generieke kern. Er is niets speciaals meer achter de schermen:
--
-- - Personen: wie aanmeldt (met e-mailadres) of iemand zonder aanmelding. Wie later een e-mailadres krijgt,
--   blijft dezelfde persoon.
-- - Projecten vormen een boom: een project kan subprojecten hebben. "Huishouden" is gewoon een project.
-- - Rollen horen bij een project en gelden ook in de subprojecten. Een rol zegt wat je met het project mag
--   (instellen, mensen beheren, items toevoegen of verwijderen) en per soort en per veld: niet zien, zien of wijzigen.
-- - Lidmaatschap: een persoon heeft in een project een rol. Die geldt ook in de subprojecten, tenzij de persoon
--   daar een eigen rol heeft (de dichtste wint).
-- - Soorten zijn zelf samengestelde formulieren ("Wijn", "Klantenkaart", "Uitgave"). Een soort hoort bij een project
--   en is te gebruiken in dat project en zijn subprojecten.
-- - Items zijn de dingen zelf: een soort, een naam, waarden voor de velden (JSON), tags, een foto, bestanden en
--   een logboek.
--
-- De app was nog niet in gebruik: de oude tabellen verdwijnen zonder overzetting.

PRAGMA defer_foreign_keys = true;

DROP TABLE IF EXISTS item_owners;
DROP TABLE IF EXISTS item_log;
DROP TABLE IF EXISTS item_links;
DROP TABLE IF EXISTS stock_movements;
DROP TABLE IF EXISTS stock_levels;
DROP TABLE IF EXISTS taggings;
DROP TABLE IF EXISTS expense_lines;
DROP TABLE IF EXISTS expense_payments;
DROP TABLE IF EXISTS expense_shares;
DROP TABLE IF EXISTS transfers;
DROP TABLE IF EXISTS recurring_expenses;
DROP TABLE IF EXISTS purchase_files;
DROP TABLE IF EXISTS purchases;
DROP TABLE IF EXISTS loyalty_cards;
DROP TABLE IF EXISTS items;
DROP TABLE IF EXISTS pots;
DROP TABLE IF EXISTS project_members;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS vendor_branches;
DROP TABLE IF EXISTS vendor_contacts;
DROP TABLE IF EXISTS vendors;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS locations;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS members;
DROP TABLE IF EXISTS households;

CREATE TABLE people (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT UNIQUE,              -- altijd in kleine letters; NULL = meldt (nog) niet aan
  color       TEXT,
  created_by  TEXT,                     -- persoon die deze persoon toevoegde
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE projects (
  id           TEXT PRIMARY KEY,
  parent_id    TEXT REFERENCES projects (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  icon         TEXT,
  color        TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  archived     INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_projects_parent ON projects (parent_id);

CREATE TABLE roles (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  rights      TEXT NOT NULL,            -- JSON, zie shared/access.ts
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_roles_project ON roles (project_id);

CREATE TABLE memberships (
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  person_id   TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  role_id     TEXT NOT NULL REFERENCES roles (id),            -- een rol in gebruik kan je niet verwijderen
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, person_id)
);
CREATE INDEX idx_memberships_person ON memberships (person_id);
CREATE INDEX idx_memberships_role ON memberships (role_id);

CREATE TABLE item_types (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,            -- "Wijn"
  plural      TEXT NOT NULL,            -- "Wijnen"
  name_label  TEXT,                     -- hoe het naamveld heet; leeg = "Naam"
  icon        TEXT,
  fields      TEXT NOT NULL DEFAULT '[]',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_item_types_project ON item_types (project_id);

CREATE TABLE items (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  type_id        TEXT NOT NULL REFERENCES item_types (id),   -- een soort met items kan je niet verwijderen
  name           TEXT NOT NULL,
  data           TEXT NOT NULL DEFAULT '{}',
  photo_version  INTEGER,
  archived       INTEGER NOT NULL DEFAULT 0,
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_items_project ON items (project_id, type_id);
CREATE INDEX idx_items_type ON items (type_id);

CREATE TABLE tags (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name        TEXT NOT NULL COLLATE NOCASE,
  color       TEXT,
  UNIQUE (project_id, name)
);

CREATE TABLE item_tags (
  item_id  TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  tag_id   TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);
CREATE INDEX idx_item_tags_tag ON item_tags (tag_id);

CREATE TABLE item_files (
  id            TEXT PRIMARY KEY,
  item_id       TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  r2_key        TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_item_files_item ON item_files (item_id);

CREATE TABLE item_log (
  id           TEXT PRIMARY KEY,
  item_id      TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  happened_on  TEXT NOT NULL,
  text         TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_item_log_item ON item_log (item_id, happened_on);
