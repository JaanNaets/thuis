-- Verkopers krijgen een volledige fiche: soort, logo, je account daar, bedrijfsgegevens,
-- contactpersonen en vestigingen. Klantenkaarten horen voortaan bij een verkoper.

-- Soort: store (winkel), webshop, craftsman (vakman), service (dienst), private (particulier). Leeg = onbekend.
ALTER TABLE vendors ADD COLUMN kind TEXT CHECK (kind IN ('store', 'webshop', 'craftsman', 'service', 'private'));
-- Wat je er meestal koopt: een uitgavencategorie. Een nieuwe aankoop bij deze verkoper krijgt die alvast.
ALTER TABLE vendors ADD COLUMN category_id TEXT REFERENCES categories (id) ON DELETE SET NULL;
ALTER TABLE vendors ADD COLUMN email TEXT;

-- Je account bij deze verkoper. Nooit een wachtwoord: enkel waarmee je aanmeldt.
ALTER TABLE vendors ADD COLUMN customer_number TEXT;
ALTER TABLE vendors ADD COLUMN account_member_id TEXT REFERENCES members (id) ON DELETE SET NULL;
ALTER TABLE vendors ADD COLUMN account_login TEXT;

-- Bedrijfsgegevens, zoals ze op een factuur staan.
ALTER TABLE vendors ADD COLUMN company_number TEXT;  -- ondernemingsnummer, bv. 0123456789 (= btw-nummer zonder BE)
ALTER TABLE vendors ADD COLUMN iban TEXT;             -- zonder spaties, in hoofdletters

-- Logo in R2 (vendors/<id>/logo). De versie verandert bij elke nieuwe upload, zodat de browser het nieuwe toont.
ALTER TABLE vendors ADD COLUMN logo_version INTEGER;

CREATE INDEX idx_vendors_category ON vendors (category_id);
-- Voor "wat kwam er van hier in de voorraad" op de pagina van een verkoper.
CREATE INDEX idx_stock_movements_vendor ON stock_movements (vendor_id, created_at DESC);

-- Vestigingen: Colruyt Halle, Colruyt Lembeek, ...
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

CREATE INDEX idx_vendor_branches_vendor ON vendor_branches (vendor_id);

-- Contactpersonen, eventueel bij een vestiging.
CREATE TABLE vendor_contacts (
  id          TEXT PRIMARY KEY,
  vendor_id   TEXT NOT NULL REFERENCES vendors (id) ON DELETE CASCADE,
  branch_id   TEXT REFERENCES vendor_branches (id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  role        TEXT,              -- bv. "zaakvoerder", "dossierbeheerder"
  phone       TEXT,
  email       TEXT,
  notes       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_vendor_contacts_vendor ON vendor_contacts (vendor_id);

-- Een klantenkaart hoort bij een verkoper (een verkoper kan er meerdere hebben).
ALTER TABLE loyalty_cards ADD COLUMN vendor_id TEXT REFERENCES vendors (id) ON DELETE SET NULL;
CREATE INDEX idx_loyalty_cards_vendor ON loyalty_cards (vendor_id);

-- Kaarten die exact zo heten als een verkoper, horen er meteen bij.
UPDATE loyalty_cards
SET vendor_id = (SELECT v.id FROM vendors v WHERE v.name = trim(loyalty_cards.name) COLLATE NOCASE);
