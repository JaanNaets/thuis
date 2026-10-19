-- Aankopen: één rij per aankoop, met optioneel een of meer bewijsstukken.
CREATE TABLE purchases (
  id            TEXT PRIMARY KEY,
  description   TEXT NOT NULL,
  store         TEXT,
  purchased_on  TEXT NOT NULL,          -- YYYY-MM-DD
  amount_cents  INTEGER,                -- bedragen altijd in cent, nooit als float
  category      TEXT,
  warranty_until TEXT,                  -- YYYY-MM-DD, NULL = geen garantie
  notes         TEXT,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_purchases_purchased_on ON purchases (purchased_on DESC);
CREATE INDEX idx_purchases_warranty_until ON purchases (warranty_until);

-- Bewijsstukken (foto's, PDF's). Het bestand zelf staat in R2, hier alleen de metadata.
CREATE TABLE purchase_files (
  id            TEXT PRIMARY KEY,
  purchase_id   TEXT NOT NULL REFERENCES purchases (id) ON DELETE CASCADE,
  r2_key        TEXT NOT NULL,
  filename      TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_purchase_files_purchase_id ON purchase_files (purchase_id);

-- Klantenkaarten. `format` volgt de namen van de Barcode Detection API (ean_13, qr_code, ...).
CREATE TABLE loyalty_cards (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  card_number   TEXT NOT NULL,
  format        TEXT NOT NULL,
  color         TEXT,
  notes         TEXT,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
