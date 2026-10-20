-- Verkopers: winkels, webshops, een vakman, iemand op 2dehands. Eén lijst voor alles,
-- zodat je later per verkoper kan zien wat je er kocht (en wat het kostte).

CREATE TABLE vendors (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  website     TEXT,
  phone       TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE purchases ADD COLUMN vendor_id TEXT REFERENCES vendors (id) ON DELETE SET NULL;
-- Bij een item: waar je het meestal koopt.
ALTER TABLE items ADD COLUMN vendor_id TEXT REFERENCES vendors (id) ON DELETE SET NULL;
-- Bij een voorraadbeweging: waar het gekocht werd.
ALTER TABLE stock_movements ADD COLUMN vendor_id TEXT REFERENCES vendors (id) ON DELETE SET NULL;

-- Bestaande winkelnamen van aankopen worden verkopers ("Colruyt" en "colruyt" worden één verkoper).
INSERT OR IGNORE INTO vendors (id, name)
SELECT lower(hex(randomblob(16))), trim(store)
FROM (SELECT DISTINCT store FROM purchases WHERE store IS NOT NULL AND trim(store) != '');

UPDATE purchases
SET vendor_id = (SELECT v.id FROM vendors v WHERE v.name = trim(purchases.store) COLLATE NOCASE)
WHERE store IS NOT NULL;

ALTER TABLE purchases DROP COLUMN store;

CREATE INDEX idx_purchases_vendor ON purchases (vendor_id);
CREATE INDEX idx_items_vendor ON items (vendor_id);
