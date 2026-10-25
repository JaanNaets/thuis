-- Bezit: wat je hebt (gekocht, gekregen of al lang in huis), met de kosten die eraan hangen,
-- wat erbij hoort, een logboek, en voor verbruik de prijs per eenheid om te vergelijken.
--
-- - Een uitgave kan aan een of meer dingen hangen (item_links), met een rol: de aankoop zelf, bijgekocht
--   (voorraad aangevuld, met het aantal), onderhoud, herstelling, onderdeel of een andere kost.
--   Een etentje of een massage hangt nergens aan: dat blijft gewoon een uitgave.
-- - "Hoort bij" (parent_id): pellets bij de kachel, stofzuigerzakken bij de stofzuiger.
-- - Het logboek (item_log) houdt bij wat er met een ding gebeurde; de notitie van het item is "goed om te weten".

ALTER TABLE items ADD COLUMN parent_id TEXT REFERENCES items (id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN origin TEXT CHECK (origin IN ('bought', 'gift', 'had'));
ALTER TABLE items ADD COLUMN origin_note TEXT;                                  -- van wie gekregen, waar vandaan
ALTER TABLE items ADD COLUMN acquired_on TEXT;                                  -- sinds wanneer (YYYY-MM-DD)
ALTER TABLE items ADD COLUMN value_cents INTEGER CHECK (value_cents >= 0);      -- geschatte waarde (bv. gekregen)
ALTER TABLE items ADD COLUMN content_amount REAL CHECK (content_amount > 0);    -- inhoud per eenheid: 15 (kg per zak)
ALTER TABLE items ADD COLUMN content_unit TEXT;                                 -- kg, g, l, ml

CREATE INDEX idx_items_parent ON items (parent_id) WHERE parent_id IS NOT NULL;

CREATE TABLE item_links (
  id            TEXT PRIMARY KEY,
  item_id       TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  purchase_id   TEXT NOT NULL REFERENCES purchases (id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('purchase', 'refill', 'maintenance', 'repair', 'part', 'other')),
  quantity      REAL CHECK (quantity > 0),             -- bij bijkopen: hoeveel, in de eenheid van het item
  amount_cents  INTEGER CHECK (amount_cents >= 0),     -- wat dit item ervan kostte; leeg = het hele bedrag
  note          TEXT,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_item_links_item ON item_links (item_id);
CREATE INDEX idx_item_links_purchase ON item_links (purchase_id);

CREATE TABLE item_log (
  id           TEXT PRIMARY KEY,
  item_id      TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  happened_on  TEXT NOT NULL,
  text         TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_item_log_item ON item_log (item_id, happened_on DESC);

-- Wat al vanuit een aankoop in voorraad gezet werd, wordt een koppeling.
INSERT INTO item_links (id, item_id, purchase_id, role, quantity, created_by, created_at)
SELECT lower(hex(randomblob(16))), m.item_id, m.purchase_id,
       CASE WHEN i.type = 'asset' THEN 'purchase' ELSE 'refill' END,
       CASE WHEN i.type = 'asset' THEN NULL ELSE SUM(m.delta) END,
       MIN(m.created_by), MIN(m.created_at)
FROM stock_movements m
JOIN items i ON i.id = m.item_id
JOIN purchases p ON p.id = m.purchase_id
WHERE m.reason = 'purchase' AND m.delta > 0
GROUP BY m.item_id, m.purchase_id;

-- Een bezit met een aankoop is gekocht, op de datum van die aankoop.
UPDATE items
SET origin = 'bought',
    acquired_on = (SELECT MIN(p.purchased_on) FROM item_links l JOIN purchases p ON p.id = l.purchase_id
                   WHERE l.item_id = items.id AND l.role = 'purchase')
WHERE type = 'asset' AND EXISTS (SELECT 1 FROM item_links l WHERE l.item_id = items.id AND l.role = 'purchase');
