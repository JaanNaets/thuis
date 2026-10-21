-- Meerdere huishoudens, projecten en een volledige kostenverdeling.
--
-- 1. Huishoudens: alles (leden, indeling, verkopers, voorraad, kaarten, uitgaven) hoort bij één huishouden.
--    Wat er al is, komt in het huishouden "Thuis".
-- 2. Toegang per lid: 'full' = alles in het huishouden; 'projects' = enkel de projecten waarin die zit
--    (bv. vrienden op skireis die zelf aanmelden).
-- 3. Projecten (verbouwing, skireis, ...) met deelnemers, een budget en eventueel een eigen saldo.
-- 4. Uitgaven: meerdere betalers (een lid of een pot), verdelen gelijk / in procent / in delen / in bedragen /
--    per lijn van het ticket, potten (gezamenlijke rekening, spaarpot, reiskas), geldbewegingen
--    (terugbetaling, lening, storting, afhaling) en terugkerende kosten.
--
-- Unieke sleutels gelden nu per huishouden (twee huishoudens mogen allebei "Colruyt" hebben). Dat kan SQLite
-- enkel door tabellen opnieuw op te bouwen. Omdat het hernoemen van een tabel ook de verwijzingen in andere
-- tabellen meeneemt, bouwen we álle tabellen opnieuw op:
--   1. alle oude tabellen opzij (old_*), hun onderlinge verwijzingen gaan mee;
--   2. de nieuwe tabellen maken en vullen;
--   3. de oude tabellen wegdoen, kinderen eerst, zodat er niets "mee" verdwijnt in de nieuwe tabellen;
--   4. de indexen maken.
-- Alles gebeurt in één transactie: lukt één stap niet, dan blijft de database zoals ze was.

PRAGMA defer_foreign_keys = true;

-- ---------- 1. oude tabellen opzij ----------

ALTER TABLE members RENAME TO old_members;
ALTER TABLE categories RENAME TO old_categories;
ALTER TABLE locations RENAME TO old_locations;
ALTER TABLE tags RENAME TO old_tags;
ALTER TABLE taggings RENAME TO old_taggings;
ALTER TABLE vendors RENAME TO old_vendors;
ALTER TABLE vendor_branches RENAME TO old_vendor_branches;
ALTER TABLE vendor_contacts RENAME TO old_vendor_contacts;
ALTER TABLE items RENAME TO old_items;
ALTER TABLE stock_levels RENAME TO old_stock_levels;
ALTER TABLE stock_movements RENAME TO old_stock_movements;
ALTER TABLE purchases RENAME TO old_purchases;
ALTER TABLE purchase_files RENAME TO old_purchase_files;
ALTER TABLE expense_shares RENAME TO old_expense_shares;
ALTER TABLE settlements RENAME TO old_settlements;
ALTER TABLE loyalty_cards RENAME TO old_loyalty_cards;

-- ---------- 2. nieuwe tabellen ----------

CREATE TABLE households (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  -- Standaardverdeling van uitgaven (JSON, zie shared/split.ts). Leeg = gelijk over wie hier woont.
  default_split  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO households (id, name) VALUES ('hh-thuis', 'Thuis');

CREATE TABLE members (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT COLLATE NOCASE,              -- waarmee die aanmeldt; leeg = meldt niet aan
  color         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,       -- woont hier: deelt mee in de uitgaven van het huishouden
  access        TEXT NOT NULL DEFAULT 'full' CHECK (access IN ('full', 'projects')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Wie nu al lid is, behoudt alle toegang.
INSERT INTO members (id, household_id, name, email, color, active, access, created_at)
SELECT id, 'hh-thuis', name, email, color, active, 'full', created_at FROM old_members;

CREATE TABLE categories (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  domain        TEXT NOT NULL,                    -- 'expense' of 'item'
  parent_id     TEXT REFERENCES categories (id) ON DELETE SET NULL,
  -- Vaste sleutel van een startcategorie (bv. 'item-zuivel'), om productgegevens aan te koppelen.
  key           TEXT,
  name          TEXT NOT NULL,
  color         TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO categories (id, household_id, domain, parent_id, key, name, color, sort_order, created_at)
SELECT id, 'hh-thuis', domain, parent_id,
       CASE WHEN id IN (
         'exp-boodschappen', 'exp-wonen', 'exp-energie', 'exp-elektronica', 'exp-huishoudtoestellen', 'exp-meubels',
         'exp-kleding', 'exp-gereedschap', 'exp-tuin', 'exp-auto-fiets', 'exp-restaurant', 'exp-gezondheid',
         'exp-abonnementen', 'exp-reizen', 'exp-cadeaus', 'exp-andere'
       ) OR id GLOB 'item-*' THEN id END,
       name, color, sort_order, created_at
FROM old_categories;

CREATE TABLE locations (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  parent_id     TEXT REFERENCES locations (id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO locations (id, household_id, parent_id, name, sort_order, created_at)
SELECT id, 'hh-thuis', parent_id, name, sort_order, created_at FROM old_locations;

CREATE TABLE tags (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  name          TEXT NOT NULL COLLATE NOCASE,
  color         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO tags (id, household_id, name, color, created_at)
SELECT id, 'hh-thuis', name, color, created_at FROM old_tags;

CREATE TABLE taggings (
  tag_id       TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  entity_type  TEXT NOT NULL,               -- 'purchase', 'item', ...
  entity_id    TEXT NOT NULL,
  PRIMARY KEY (tag_id, entity_type, entity_id)
);

INSERT INTO taggings (tag_id, entity_type, entity_id) SELECT tag_id, entity_type, entity_id FROM old_taggings;

CREATE TABLE vendors (
  id                 TEXT PRIMARY KEY,
  household_id       TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  name               TEXT NOT NULL COLLATE NOCASE,
  kind               TEXT CHECK (kind IN ('store', 'webshop', 'craftsman', 'service', 'private')),
  category_id        TEXT REFERENCES categories (id) ON DELETE SET NULL,
  website            TEXT,
  phone              TEXT,
  email              TEXT,
  notes              TEXT,
  customer_number    TEXT,
  account_member_id  TEXT REFERENCES members (id) ON DELETE SET NULL,
  account_login      TEXT,
  company_number     TEXT,
  iban               TEXT,
  logo_version       INTEGER,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO vendors (id, household_id, name, kind, category_id, website, phone, email, notes, customer_number,
                     account_member_id, account_login, company_number, iban, logo_version, created_at)
SELECT id, 'hh-thuis', name, kind, category_id, website, phone, email, notes, customer_number,
       account_member_id, account_login, company_number, iban, logo_version, created_at
FROM old_vendors;

CREATE TABLE vendor_branches (
  id             TEXT PRIMARY KEY,
  vendor_id      TEXT NOT NULL REFERENCES vendors (id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  street         TEXT,
  postal_code    TEXT,
  city           TEXT,
  country        TEXT,           -- leeg = België
  phone          TEXT,
  email          TEXT,
  opening_hours  TEXT,           -- vrije tekst, bv. "ma–za 8u30–20u"
  notes          TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO vendor_branches SELECT * FROM old_vendor_branches;

CREATE TABLE vendor_contacts (
  id          TEXT PRIMARY KEY,
  vendor_id   TEXT NOT NULL REFERENCES vendors (id) ON DELETE CASCADE,
  branch_id   TEXT REFERENCES vendor_branches (id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  role        TEXT,
  phone       TEXT,
  email       TEXT,
  notes       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO vendor_contacts SELECT * FROM old_vendor_contacts;

CREATE TABLE items (
  id                   TEXT PRIMARY KEY,
  household_id         TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  type                 TEXT NOT NULL DEFAULT 'consumable',  -- 'consumable' (verbruik) of 'asset' (bezit)
  category_id          TEXT REFERENCES categories (id) ON DELETE SET NULL,
  default_location_id  TEXT REFERENCES locations (id) ON DELETE SET NULL,
  unit                 TEXT NOT NULL DEFAULT 'stuk',
  barcode              TEXT,
  brand                TEXT,
  vendor_id            TEXT REFERENCES vendors (id) ON DELETE SET NULL,  -- waar je het meestal koopt
  min_quantity         REAL,                -- onder dit aantal staat het op "bijna op"
  notes                TEXT,
  archived             INTEGER NOT NULL DEFAULT 0,
  created_by           TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO items (id, household_id, name, type, category_id, default_location_id, unit, barcode, brand, vendor_id,
                   min_quantity, notes, archived, created_by, created_at, updated_at)
SELECT id, 'hh-thuis', name, type, category_id, default_location_id, unit, barcode, brand, vendor_id,
       min_quantity, notes, archived, created_by, created_at, updated_at
FROM old_items;

CREATE TABLE stock_levels (
  item_id      TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  location_id  TEXT NOT NULL REFERENCES locations (id),   -- een plaats met voorraad kan je niet verwijderen
  quantity     REAL NOT NULL DEFAULT 0,
  next_expiry  TEXT,                        -- vroegste vervaldatum van wat er ligt (YYYY-MM-DD)
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (item_id, location_id)
);

INSERT INTO stock_levels (item_id, location_id, quantity, next_expiry, updated_at)
SELECT item_id, location_id, quantity, next_expiry, updated_at FROM old_stock_levels;

CREATE TABLE projects (
  id                TEXT PRIMARY KEY,
  household_id      TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT,
  color             TEXT,
  start_on          TEXT,
  end_on            TEXT,
  budget_cents      INTEGER CHECK (budget_cents >= 0),
  -- 1 = eigen saldo (bv. een reis met vrienden: daar reken je apart af);
  -- 0 = de uitgaven tellen mee in het saldo van het huishouden (bv. een verbouwing met z'n tweeën).
  separate_balance  INTEGER NOT NULL DEFAULT 1,
  default_split     TEXT,
  archived          INTEGER NOT NULL DEFAULT 0,
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE project_members (
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  member_id   TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, member_id)
);

-- Een gezamenlijke rekening, spaarpot of reiskas. Een pot kan uitgaven betalen; leden storten erin of halen eruit.
CREATE TABLE pots (
  id             TEXT PRIMARY KEY,
  household_id   TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  project_id     TEXT REFERENCES projects (id) ON DELETE CASCADE,  -- leeg = pot van het huishouden
  name           TEXT NOT NULL,
  color          TEXT,
  opening_cents  INTEGER NOT NULL DEFAULT 0,                       -- beginsaldo, zodat het met de bank klopt
  archived       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE recurring_expenses (
  id             TEXT PRIMARY KEY,
  household_id   TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  project_id     TEXT REFERENCES projects (id) ON DELETE CASCADE,
  description    TEXT NOT NULL,
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
  category_id    TEXT REFERENCES categories (id) ON DELETE SET NULL,
  vendor_id      TEXT REFERENCES vendors (id) ON DELETE SET NULL,
  frequency      TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  start_on       TEXT NOT NULL,          -- eerste keer; elke volgende keer wordt hiervan berekend (geen verschuiving)
  next_on        TEXT NOT NULL,          -- volgende keer dat de uitgave ingeboekt wordt (YYYY-MM-DD)
  end_on         TEXT,                   -- leeg = geen einde
  -- Wie betaalt en hoe het verdeeld wordt: dezelfde vorm als bij een aankoop (JSON, zie shared/split.ts).
  payments       TEXT NOT NULL,
  split          TEXT NOT NULL,
  notes          TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Aankopen zijn de uitgaven van de app.
CREATE TABLE purchases (
  id              TEXT PRIMARY KEY,
  household_id    TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  -- Een project met uitgaven kan je niet verwijderen (enkel archiveren): de uitgaven horen erbij.
  project_id      TEXT REFERENCES projects (id),
  description     TEXT NOT NULL,
  vendor_id       TEXT REFERENCES vendors (id) ON DELETE SET NULL,
  purchased_on    TEXT NOT NULL,          -- YYYY-MM-DD
  amount_cents    INTEGER,                -- bedragen altijd in cent
  category_id     TEXT REFERENCES categories (id) ON DELETE SET NULL,
  -- Hoe het bedrag verdeeld is: equal, percent, shares, exact of lines. Leeg = niet verdeeld.
  split_mode      TEXT CHECK (split_mode IN ('equal', 'percent', 'shares', 'exact', 'lines')),
  recurring_id    TEXT REFERENCES recurring_expenses (id) ON DELETE SET NULL,
  warranty_until  TEXT,                   -- YYYY-MM-DD, leeg = geen garantie
  notes           TEXT,
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO purchases (id, household_id, description, vendor_id, purchased_on, amount_cents, category_id, split_mode,
                       warranty_until, notes, created_by, created_at)
SELECT id, 'hh-thuis', description, vendor_id, purchased_on, amount_cents, category_id,
       CASE split_mode WHEN 'personal' THEN 'equal' WHEN 'custom' THEN 'exact' ELSE split_mode END,
       warranty_until, notes, created_by, created_at
FROM old_purchases;

CREATE TABLE purchase_files (
  id            TEXT PRIMARY KEY,
  purchase_id   TEXT NOT NULL REFERENCES purchases (id) ON DELETE CASCADE,
  r2_key        TEXT NOT NULL,
  filename      TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO purchase_files (id, purchase_id, r2_key, filename, content_type, size_bytes, created_at)
SELECT id, purchase_id, r2_key, filename, content_type, size_bytes, created_at FROM old_purchase_files;

-- Wie betaalde: een lid of een pot, eventueel met meerdere samen.
CREATE TABLE expense_payments (
  purchase_id   TEXT NOT NULL REFERENCES purchases (id) ON DELETE CASCADE,
  member_id     TEXT REFERENCES members (id),
  pot_id        TEXT REFERENCES pots (id),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  CHECK ((member_id IS NULL) != (pot_id IS NULL))
);

-- Aankopen van de gezamenlijke rekening (zonder betaler) worden betaald door een pot "Gezamenlijke rekening".
INSERT INTO pots (id, household_id, name, color)
SELECT 'pot-gezamenlijk', 'hh-thuis', 'Gezamenlijke rekening', 'sky'
WHERE EXISTS (SELECT 1 FROM old_purchases WHERE paid_by IS NULL AND amount_cents > 0);

INSERT INTO expense_payments (purchase_id, member_id, pot_id, amount_cents)
SELECT id, paid_by, CASE WHEN paid_by IS NULL THEN 'pot-gezamenlijk' END, amount_cents
FROM old_purchases WHERE amount_cents > 0;

-- De verdeling: per lid het deel in cent, en de ingave (procent, aantal delen of bedrag) om te kunnen bewerken.
CREATE TABLE expense_shares (
  purchase_id  TEXT NOT NULL REFERENCES purchases (id) ON DELETE CASCADE,
  member_id    TEXT NOT NULL REFERENCES members (id),
  share_cents  INTEGER NOT NULL,
  split_value  REAL,
  PRIMARY KEY (purchase_id, member_id)
);

INSERT INTO expense_shares (purchase_id, member_id, share_cents)
SELECT purchase_id, member_id, share_cents FROM old_expense_shares;

-- Per lijn van het ticket: wie had wat (member_ids is een JSON-lijst; meerdere = gelijk delen).
CREATE TABLE expense_lines (
  id            TEXT PRIMARY KEY,
  purchase_id   TEXT NOT NULL REFERENCES purchases (id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  description   TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL,         -- negatief = korting
  member_ids    TEXT NOT NULL
);

CREATE TABLE stock_movements (
  id           TEXT PRIMARY KEY,
  item_id      TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  location_id  TEXT REFERENCES locations (id) ON DELETE SET NULL,
  delta        REAL NOT NULL,
  reason       TEXT NOT NULL,               -- purchase, add, consume, discard, adjust, move
  purchase_id  TEXT REFERENCES purchases (id) ON DELETE SET NULL,
  vendor_id    TEXT REFERENCES vendors (id) ON DELETE SET NULL,
  expires_on   TEXT,
  note         TEXT,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO stock_movements (id, item_id, location_id, delta, reason, purchase_id, vendor_id, expires_on, note, created_by, created_at)
SELECT id, item_id, location_id, delta, reason, purchase_id, vendor_id, expires_on, note, created_by, created_at
FROM old_stock_movements;

-- Geld dat van iemand (of een pot) naar iemand anders (of een pot) gaat:
-- repayment = terugbetaling, loan = lening of voorschot, deposit = storting in een pot, withdrawal = afhaling.
CREATE TABLE transfers (
  id              TEXT PRIMARY KEY,
  household_id    TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  project_id      TEXT REFERENCES projects (id),
  kind            TEXT NOT NULL CHECK (kind IN ('repayment', 'loan', 'deposit', 'withdrawal')),
  from_member_id  TEXT REFERENCES members (id),
  from_pot_id     TEXT REFERENCES pots (id),
  to_member_id    TEXT REFERENCES members (id),
  to_pot_id       TEXT REFERENCES pots (id),
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  transferred_on  TEXT NOT NULL,
  note            TEXT,
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((from_member_id IS NULL) != (from_pot_id IS NULL)),
  CHECK ((to_member_id IS NULL) != (to_pot_id IS NULL))
);

INSERT INTO transfers (id, household_id, kind, from_member_id, to_member_id, amount_cents, transferred_on, note, created_by, created_at)
SELECT id, 'hh-thuis', 'repayment', from_member_id, to_member_id, amount_cents, settled_on, note, created_by, created_at
FROM old_settlements;

CREATE TABLE loyalty_cards (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  card_number   TEXT NOT NULL,
  format        TEXT NOT NULL,
  color         TEXT,
  notes         TEXT,
  vendor_id     TEXT REFERENCES vendors (id) ON DELETE SET NULL,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO loyalty_cards (id, household_id, name, card_number, format, color, notes, vendor_id, created_by, created_at)
SELECT id, 'hh-thuis', name, card_number, format, color, notes, vendor_id, created_by, created_at FROM old_loyalty_cards;

-- ---------- 3. oude tabellen weg, kinderen eerst ----------

DROP TABLE old_loyalty_cards;
DROP TABLE old_settlements;
DROP TABLE old_stock_movements;
DROP TABLE old_expense_shares;
DROP TABLE old_purchase_files;
DROP TABLE old_purchases;
DROP TABLE old_stock_levels;
DROP TABLE old_items;
DROP TABLE old_vendor_contacts;
DROP TABLE old_vendor_branches;
DROP TABLE old_vendors;
DROP TABLE old_taggings;
DROP TABLE old_tags;
DROP TABLE old_locations;
DROP TABLE old_categories;
DROP TABLE old_members;

-- ---------- 4. indexen ----------

CREATE UNIQUE INDEX idx_members_household_email ON members (household_id, email) WHERE email IS NOT NULL;
CREATE INDEX idx_members_email ON members (email);

CREATE UNIQUE INDEX idx_categories_name ON categories (household_id, domain, ifnull(parent_id, ''), name COLLATE NOCASE);
CREATE UNIQUE INDEX idx_categories_key ON categories (household_id, key) WHERE key IS NOT NULL;
CREATE INDEX idx_categories_parent ON categories (parent_id);

CREATE UNIQUE INDEX idx_locations_name ON locations (household_id, ifnull(parent_id, ''), name COLLATE NOCASE);
CREATE INDEX idx_locations_parent ON locations (parent_id);

CREATE UNIQUE INDEX idx_tags_name ON tags (household_id, name);
CREATE INDEX idx_taggings_entity ON taggings (entity_type, entity_id);

CREATE UNIQUE INDEX idx_vendors_name ON vendors (household_id, name);
CREATE INDEX idx_vendors_category ON vendors (category_id);
CREATE INDEX idx_vendor_branches_vendor ON vendor_branches (vendor_id);
CREATE INDEX idx_vendor_contacts_vendor ON vendor_contacts (vendor_id);

CREATE UNIQUE INDEX idx_items_barcode ON items (household_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX idx_items_household ON items (household_id, archived);
CREATE INDEX idx_items_category ON items (category_id);
CREATE INDEX idx_items_vendor ON items (vendor_id);
CREATE INDEX idx_stock_levels_location ON stock_levels (location_id);
CREATE INDEX idx_stock_movements_item ON stock_movements (item_id, created_at DESC);
CREATE INDEX idx_stock_movements_purchase ON stock_movements (purchase_id);
CREATE INDEX idx_stock_movements_vendor ON stock_movements (vendor_id, created_at DESC);

CREATE INDEX idx_projects_household ON projects (household_id, archived);
CREATE INDEX idx_project_members_member ON project_members (member_id);
CREATE INDEX idx_pots_household ON pots (household_id);
CREATE INDEX idx_recurring_due ON recurring_expenses (active, next_on);

CREATE INDEX idx_purchases_household ON purchases (household_id, purchased_on DESC);
CREATE INDEX idx_purchases_warranty_until ON purchases (warranty_until);
CREATE INDEX idx_purchases_category ON purchases (category_id);
CREATE INDEX idx_purchases_vendor ON purchases (vendor_id);
CREATE INDEX idx_purchases_project ON purchases (project_id);
CREATE UNIQUE INDEX idx_purchases_recurring ON purchases (recurring_id, purchased_on) WHERE recurring_id IS NOT NULL;
CREATE INDEX idx_purchase_files_purchase_id ON purchase_files (purchase_id);

CREATE INDEX idx_expense_payments_purchase ON expense_payments (purchase_id);
CREATE INDEX idx_expense_payments_member ON expense_payments (member_id);
CREATE INDEX idx_expense_payments_pot ON expense_payments (pot_id);
CREATE INDEX idx_expense_shares_member ON expense_shares (member_id);
CREATE INDEX idx_expense_lines_purchase ON expense_lines (purchase_id, position);

CREATE INDEX idx_transfers_household ON transfers (household_id, transferred_on DESC);
CREATE INDEX idx_transfers_project ON transfers (project_id);

CREATE INDEX idx_loyalty_cards_household ON loyalty_cards (household_id);
CREATE INDEX idx_loyalty_cards_vendor ON loyalty_cards (vendor_id);
