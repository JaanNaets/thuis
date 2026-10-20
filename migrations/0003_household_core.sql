-- De basis voor een volledige "home ERP": wie in het huishouden zit, één gedeelde indeling
-- (categorieën, plaatsen, tags), voorraad met een logboek van elke beweging, en wie wat betaalde.
--
-- Keuzes:
-- - Opsommingen (type, reden, ...) worden in de Worker gecontroleerd, niet met CHECK. Zo kan er later
--   een waarde bij zonder dat SQLite de hele tabel moet herbouwen.
-- - Categorieën en plaatsen zijn bomen (parent_id). Een categorie hoort bij één domein:
--   'expense' (aankopen en uitgaven) of 'item' (voorraad). Later kunnen er domeinen bij.
-- - Tags zijn gedeeld over alles heen; `taggings` koppelt ze aan om het even welk soort rij.

-- ---------- leden van het huishouden ----------

CREATE TABLE members (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT UNIQUE COLLATE NOCASE,   -- waarmee die persoon aanmeldt; leeg voor wie (nog) niet aanmeldt
  color       TEXT,                         -- toon: peach, butter, sage, mint, sky, lilac, rose
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- indeling ----------

CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  domain      TEXT NOT NULL,                -- 'expense' of 'item'
  parent_id   TEXT REFERENCES categories (id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  color       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_categories_name ON categories (domain, ifnull(parent_id, ''), name COLLATE NOCASE);
CREATE INDEX idx_categories_parent ON categories (parent_id);

CREATE TABLE locations (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT REFERENCES locations (id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_locations_name ON locations (ifnull(parent_id, ''), name COLLATE NOCASE);
CREATE INDEX idx_locations_parent ON locations (parent_id);

CREATE TABLE tags (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE taggings (
  tag_id       TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  entity_type  TEXT NOT NULL,               -- 'purchase', 'item', ...
  entity_id    TEXT NOT NULL,
  PRIMARY KEY (tag_id, entity_type, entity_id)
);

CREATE INDEX idx_taggings_entity ON taggings (entity_type, entity_id);

-- ---------- voorraad ----------

-- Een product of bezitting. Hoeveel er is en waar, staat in stock_levels.
CREATE TABLE items (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  type                 TEXT NOT NULL DEFAULT 'consumable',  -- 'consumable' (verbruik) of 'asset' (bezit)
  category_id          TEXT REFERENCES categories (id) ON DELETE SET NULL,
  default_location_id  TEXT REFERENCES locations (id) ON DELETE SET NULL,
  unit                 TEXT NOT NULL DEFAULT 'stuk',
  barcode              TEXT UNIQUE,
  brand                TEXT,
  min_quantity         REAL,                -- onder dit aantal staat het op "bijna op"
  notes                TEXT,
  archived             INTEGER NOT NULL DEFAULT 0,
  created_by           TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_items_category ON items (category_id);

-- Huidige voorraad per plaats. Wordt bijgewerkt samen met elke rij in stock_movements.
CREATE TABLE stock_levels (
  item_id      TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  location_id  TEXT NOT NULL REFERENCES locations (id),   -- een plaats met voorraad kan je niet verwijderen
  quantity     REAL NOT NULL DEFAULT 0,
  next_expiry  TEXT,                        -- vroegste vervaldatum van wat er ligt (YYYY-MM-DD)
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (item_id, location_id)
);

CREATE INDEX idx_stock_levels_location ON stock_levels (location_id);

-- Logboek: elke wijziging van de voorraad, nooit aangepast of overschreven.
CREATE TABLE stock_movements (
  id           TEXT PRIMARY KEY,
  item_id      TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  location_id  TEXT REFERENCES locations (id) ON DELETE SET NULL,
  delta        REAL NOT NULL,
  reason       TEXT NOT NULL,               -- purchase, add, consume, discard, adjust, move
  purchase_id  TEXT REFERENCES purchases (id) ON DELETE SET NULL,
  expires_on   TEXT,
  note         TEXT,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_stock_movements_item ON stock_movements (item_id, created_at DESC);
CREATE INDEX idx_stock_movements_purchase ON stock_movements (purchase_id);

-- ---------- wie betaalde wat ----------

ALTER TABLE purchases ADD COLUMN category_id TEXT REFERENCES categories (id) ON DELETE SET NULL;
ALTER TABLE purchases ADD COLUMN paid_by TEXT REFERENCES members (id);  -- NULL = gezamenlijke rekening
ALTER TABLE purchases ADD COLUMN split_mode TEXT;                        -- equal, personal, custom

-- Wie welk deel van een aankoop draagt. Samen altijd gelijk aan amount_cents.
CREATE TABLE expense_shares (
  purchase_id  TEXT NOT NULL REFERENCES purchases (id) ON DELETE CASCADE,
  member_id    TEXT NOT NULL REFERENCES members (id),
  share_cents  INTEGER NOT NULL,
  PRIMARY KEY (purchase_id, member_id)
);

CREATE INDEX idx_expense_shares_member ON expense_shares (member_id);

-- Terugbetalingen tussen leden ("ik stort je de 42 euro").
CREATE TABLE settlements (
  id              TEXT PRIMARY KEY,
  from_member_id  TEXT NOT NULL REFERENCES members (id),
  to_member_id    TEXT NOT NULL REFERENCES members (id),
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  settled_on      TEXT NOT NULL,
  note            TEXT,
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_settlements_settled_on ON settlements (settled_on DESC);

-- ---------- startindeling ----------

INSERT INTO categories (id, domain, name, color, sort_order) VALUES
  ('exp-boodschappen', 'expense', 'Boodschappen', 'sage', 10),
  ('exp-wonen', 'expense', 'Wonen', 'peach', 20),
  ('exp-energie', 'expense', 'Energie & water', 'butter', 30),
  ('exp-elektronica', 'expense', 'Elektronica', 'sky', 40),
  ('exp-huishoudtoestellen', 'expense', 'Huishoudtoestellen', 'mint', 50),
  ('exp-meubels', 'expense', 'Meubels', 'peach', 60),
  ('exp-kleding', 'expense', 'Kleding', 'rose', 70),
  ('exp-gereedschap', 'expense', 'Gereedschap', 'butter', 80),
  ('exp-tuin', 'expense', 'Tuin', 'sage', 90),
  ('exp-auto-fiets', 'expense', 'Auto & fiets', 'sky', 100),
  ('exp-restaurant', 'expense', 'Restaurant & uit', 'rose', 110),
  ('exp-gezondheid', 'expense', 'Gezondheid', 'mint', 120),
  ('exp-abonnementen', 'expense', 'Abonnementen', 'lilac', 130),
  ('exp-reizen', 'expense', 'Reizen', 'sky', 140),
  ('exp-cadeaus', 'expense', 'Cadeaus', 'lilac', 150),
  ('exp-andere', 'expense', 'Andere', 'butter', 999);

INSERT INTO categories (id, domain, parent_id, name, color, sort_order) VALUES
  ('item-voeding', 'item', NULL, 'Voeding', 'sage', 10),
  ('item-groenten-fruit', 'item', 'item-voeding', 'Groenten & fruit', NULL, 10),
  ('item-zuivel', 'item', 'item-voeding', 'Zuivel & eieren', NULL, 20),
  ('item-vlees-vis', 'item', 'item-voeding', 'Vlees & vis', NULL, 30),
  ('item-brood-ontbijt', 'item', 'item-voeding', 'Brood & ontbijt', NULL, 40),
  ('item-pasta-conserven', 'item', 'item-voeding', 'Pasta, rijst & conserven', NULL, 50),
  ('item-diepvries', 'item', 'item-voeding', 'Diepvries', NULL, 60),
  ('item-snacks', 'item', 'item-voeding', 'Snacks & snoep', NULL, 70),
  ('item-kruiden', 'item', 'item-voeding', 'Kruiden & sauzen', NULL, 80),
  ('item-dranken', 'item', NULL, 'Dranken', 'sky', 20),
  ('item-huishouden', 'item', NULL, 'Huishouden', 'mint', 30),
  ('item-schoonmaak', 'item', 'item-huishouden', 'Schoonmaak', NULL, 10),
  ('item-was', 'item', 'item-huishouden', 'Was', NULL, 20),
  ('item-papier', 'item', 'item-huishouden', 'Papier & folie', NULL, 30),
  ('item-verzorging', 'item', NULL, 'Verzorging', 'rose', 40),
  ('item-medicijnen', 'item', NULL, 'Medicijnen', 'lilac', 50),
  ('item-huisdier', 'item', NULL, 'Huisdier', 'butter', 60),
  ('item-toestellen', 'item', NULL, 'Toestellen', 'sky', 70),
  ('item-gereedschap', 'item', NULL, 'Gereedschap', 'peach', 80),
  ('item-andere', 'item', NULL, 'Andere', 'butter', 999);

INSERT INTO locations (id, parent_id, name, sort_order) VALUES
  ('loc-keuken', NULL, 'Keuken', 10),
  ('loc-koelkast', 'loc-keuken', 'Koelkast', 10),
  ('loc-diepvries', 'loc-keuken', 'Diepvries', 20),
  ('loc-voorraadkast', 'loc-keuken', 'Voorraadkast', 30),
  ('loc-badkamer', NULL, 'Badkamer', 20),
  ('loc-berging', NULL, 'Berging', 30),
  ('loc-garage', NULL, 'Garage', 40);

-- ---------- bestaande aankopen omzetten ----------

-- Zelf getypte categorieën die nog niet bestaan, worden een eigen categorie.
INSERT OR IGNORE INTO categories (id, domain, name, sort_order)
SELECT 'exp-' || lower(hex(randomblob(8))), 'expense', trim(category), 500
FROM (SELECT DISTINCT category FROM purchases WHERE category IS NOT NULL AND trim(category) != '');

UPDATE purchases
SET category_id = (
  SELECT c.id FROM categories c
  WHERE c.domain = 'expense' AND c.parent_id IS NULL AND c.name = trim(purchases.category) COLLATE NOCASE
)
WHERE category IS NOT NULL;

ALTER TABLE purchases DROP COLUMN category;

CREATE INDEX idx_purchases_category ON purchases (category_id);
CREATE INDEX idx_purchases_paid_by ON purchases (paid_by);
