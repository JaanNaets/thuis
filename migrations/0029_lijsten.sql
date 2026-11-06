-- Het nieuwe model: lijsten met dingen, mensen en tags; elke lijst heeft een logboek met gebeurtenissen, en een
-- gebeurtenis heeft lijnen naar de dingen die ze raakt (zie CLAUDE.md). De oude tabellen (projecten, lijsten, items)
-- blijven voorlopig staan; de app gebruikt ze niet meer.

CREATE TABLE lists (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,                -- "Wijnen"
  one         TEXT,                         -- hoe één ding heet ("Wijn"); NULL = een lijst zonder dingen (enkel een logboek)
  icon        TEXT,
  color       TEXT,
  fields      TEXT NOT NULL DEFAULT '[]',   -- de velden van de dingen (FieldDef[], shared/fields.ts)
  stock       TEXT,                         -- telt voorraad (StockDef, shared/stock.ts) of NULL
  notify      TEXT,                         -- melding bij een nieuwe gebeurtenis (shared/notify.ts) of NULL
  archived    INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT NOT NULL REFERENCES people (id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Wie bij een lijst kan, rechtstreeks. 'geen' = uitzondering op een regel van een tag.
CREATE TABLE list_people (
  list_id     TEXT NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  person_id   TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('beheerder', 'lid', 'gast', 'geen')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (list_id, person_id)
);
CREATE INDEX list_people_person ON list_people (person_id);

-- Jouw volgorde van de lijsten (in de zijbalk en op het overzicht).
CREATE TABLE list_order (
  person_id   TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  list_id     TEXT NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  PRIMARY KEY (person_id, list_id)
);

CREATE TABLE list_tags (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT,
  created_by  TEXT NOT NULL REFERENCES people (id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE list_tag_links (
  list_id     TEXT NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  tag_id      TEXT NOT NULL REFERENCES list_tags (id) ON DELETE CASCADE,
  PRIMARY KEY (list_id, tag_id)
);
CREATE INDEX list_tag_links_tag ON list_tag_links (tag_id);

-- Een regel: deze persoon krijgt deze rol op elke lijst met de tag, waar wie de regel maakte (created_by)
-- rechtstreeks beheerder is.
CREATE TABLE tag_rules (
  tag_id      TEXT NOT NULL REFERENCES list_tags (id) ON DELETE CASCADE,
  person_id   TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('beheerder', 'lid', 'gast')),
  created_by  TEXT NOT NULL REFERENCES people (id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tag_id, person_id)
);

-- Een eigen soort gebeurtenis (Gegeten, Carwash, Proeverij): een variant van een basissoort, met eigen velden.
CREATE TABLE kinds (
  id          TEXT PRIMARY KEY,
  list_id     TEXT NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  base        TEXT NOT NULL CHECK (base IN ('aankoop', 'gebruik', 'dienst', 'activiteit', 'meting', 'overdracht')),
  name        TEXT NOT NULL,
  icon        TEXT,
  fields      TEXT NOT NULL DEFAULT '[]',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX kinds_list ON kinds (list_id);

CREATE TABLE things (
  id             TEXT PRIMARY KEY,
  list_id        TEXT NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  data           TEXT NOT NULL DEFAULT '{}',
  part_of        TEXT REFERENCES things (id) ON DELETE SET NULL,
  photo_version  INTEGER,
  archived       INTEGER NOT NULL DEFAULT 0,
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX things_list ON things (list_id, archived, name);
CREATE INDEX things_part ON things (part_of);

CREATE TABLE events (
  id             TEXT PRIMARY KEY,
  list_id        TEXT NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,             -- een basissoort ('aankoop') of de id van een eigen soort
  base           TEXT NOT NULL CHECK (base IN ('aankoop', 'gebruik', 'dienst', 'activiteit', 'meting', 'overdracht')),
  name           TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'gebeurd' CHECK (status IN ('gebeurd', 'gepland', 'afgevinkt')),
  at             TEXT NOT NULL,             -- 'YYYY-MM-DD' of 'YYYY-MM-DDTHH:MM' (tijd in België)
  end_at         TEXT,                      -- een activiteit: tot wanneer (leeg met een uur = loopt nog)
  amount         INTEGER,                   -- cent
  paid_by        TEXT REFERENCES people (id) ON DELETE SET NULL,
  split          TEXT,                      -- JSON [{ person_id, share }] in procent
  to_person      TEXT REFERENCES people (id) ON DELETE SET NULL,
  data           TEXT NOT NULL DEFAULT '{}',
  repeat         TEXT,                      -- JSON { every: { n, unit }, next_on }
  done_by        TEXT,                      -- afgevinkt door deze gebeurtenis (een aankoop)
  photo_version  INTEGER,
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX events_list_at ON events (list_id, at);
CREATE INDEX events_status ON events (status, at);

CREATE TABLE lines (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  role        TEXT NOT NULL CHECK (role IN ('in', 'uit', 'voor', 'bij')),
  thing_id    TEXT REFERENCES things (id) ON DELETE SET NULL,
  text        TEXT,                         -- geen ding: vrije tekst (een broodje)
  amount      REAL,
  unit        TEXT,
  price       INTEGER,                      -- cent, voor deze lijn
  expires     TEXT,                         -- houdbaar tot (YYYY-MM-DD)
  owner       TEXT REFERENCES people (id) ON DELETE SET NULL  -- enkel van deze persoon (niet verdeeld)
);
CREATE INDEX lines_event ON lines (event_id, position);
CREATE INDEX lines_thing ON lines (thing_id);

-- Bestanden bij een ding of een gebeurtenis (in R2).
CREATE TABLE attachments (
  id            TEXT PRIMARY KEY,
  owner_kind    TEXT NOT NULL CHECK (owner_kind IN ('thing', 'event')),
  owner_id      TEXT NOT NULL,
  filename      TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  r2_key        TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX attachments_owner ON attachments (owner_kind, owner_id);

-- Bewaarde weergaven: van één lijst (dingen of logboek) of over alle lijsten (list_id NULL).
CREATE TABLE saved_views (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  list_id     TEXT REFERENCES lists (id) ON DELETE CASCADE,
  target      TEXT NOT NULL CHECK (target IN ('dingen', 'logboek')),
  name        TEXT NOT NULL,
  def         TEXT NOT NULL,
  shared      INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX saved_views_list ON saved_views (list_id);
