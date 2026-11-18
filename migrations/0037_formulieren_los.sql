-- Formulieren los van lijsten, met hun eigen logboek (shared/model.ts).
--
-- - Een formulier (`kinds`) hoort niet meer bij een lijst: het heeft eigen mensen (`form_people`, dezelfde rollen als
--   een lijst) en tags (`form_tag_links`; een regel op een tag geldt ook hier), wie een melding krijgt (`notify`) en of
--   het een foto leest (`reads`). Het neemt de mensen, tags en instellingen over van de lijst waar het bij hoorde.
-- - Een gebeurtenis hoort bij haar formulier (`events.kind`), niet meer bij een lijst: het logboek van een formulier is
--   alles wat ermee gelogd werd; dat van een lijst is wat haar items raakt (een weergave).
-- - Een gebeurtenis met een vertrekpunt (aankoop, gebruik, …) krijgt het eigen formulier met dat vertrekpunt van haar
--   lijst, of anders een nieuw formulier. Een telling met − en + (een meting zonder velden) wordt een Aanpassing.
-- - Wat een formulier met geld in een lijst met een saldo per persoon deed, staat nu uitdrukkelijk in zijn handelingen.
-- - Een lijst zonder items bestond enkel voor haar logboek en gaat weg; haar formulieren blijven.
PRAGMA defer_foreign_keys = true;

-- Waar elk formulier vandaan komt (enkel tijdens deze migratie).
CREATE TABLE form_origin (form_id TEXT PRIMARY KEY, list_id TEXT NOT NULL);
INSERT INTO form_origin (form_id, list_id) SELECT id, list_id FROM kinds;

-- Gebeurtenissen met een vertrekpunt: het eerste eigen formulier met dat vertrekpunt van hun lijst.
UPDATE events SET kind = (
  SELECT k.id FROM kinds k WHERE k.list_id = events.list_id AND k.base = events.kind ORDER BY k.sort_order, k.name LIMIT 1
)
WHERE kind IN ('aankoop', 'gebruik', 'dienst', 'activiteit', 'meting', 'overdracht')
  AND EXISTS (SELECT 1 FROM kinds k WHERE k.list_id = events.list_id AND k.base = events.kind)
  AND NOT (kind = 'meting' AND data = '{}' AND NOT EXISTS (SELECT 1 FROM lines l WHERE l.event_id = events.id AND (l.role != 'voor' OR l.amount IS NULL)));

-- Een telling met − en +: een Aanpassing van de voorraad.
UPDATE events SET kind = 'aanpassing', name = CASE WHEN name = '' THEN 'Telling' ELSE name END
WHERE kind = 'meting' AND data = '{}' AND EXISTS (SELECT 1 FROM lines l WHERE l.event_id = events.id)
  AND NOT EXISTS (SELECT 1 FROM lines l WHERE l.event_id = events.id AND (l.role != 'voor' OR l.amount IS NULL));

-- De rest: een nieuw formulier per lijst en vertrekpunt.
INSERT INTO form_origin (form_id, list_id)
  SELECT DISTINCT list_id || '-' || kind, list_id FROM events WHERE kind IN ('aankoop', 'gebruik', 'dienst', 'activiteit', 'meting', 'overdracht');

CREATE TABLE kinds_new (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  icon        TEXT,
  base        TEXT NOT NULL CHECK (base IN ('aankoop', 'gebruik', 'dienst', 'activiteit', 'meting', 'overdracht')),
  fields      TEXT NOT NULL DEFAULT '[]',
  goal        INTEGER,                      -- iets dat loopt: na zoveel minuten een melding (16 u vasten)
  planned     INTEGER NOT NULL DEFAULT 0,
  parts       TEXT,                         -- onderdelen (JSON); NULL = die van het vertrekpunt
  does        TEXT,                         -- handelingen (JSON, shared/cells.ts)
  notify      TEXT,                         -- een melding bij iets nieuws (shared/alerts.ts) of NULL
  reads       INTEGER,                      -- een foto lezen met AI: 1 aan, 0 uit, NULL de standaard
  archived    INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT NOT NULL REFERENCES people (id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO kinds_new (id, name, icon, base, fields, goal, planned, parts, does, notify, reads, created_by, created_at)
  SELECT k.id, k.name, k.icon, k.base, k.fields, k.goal, k.planned, k.parts, k.does, l.notify,
    CASE WHEN EXISTS (SELECT 1 FROM json_each(json_extract(l.read_photo, '$.on')) WHERE value = k.id) THEN 1
         WHEN EXISTS (SELECT 1 FROM json_each(json_extract(l.read_photo, '$.off')) WHERE value = k.id) THEN 0 END,
    l.created_by, k.created_at
  FROM kinds k JOIN lists l ON l.id = k.list_id;

INSERT INTO kinds_new (id, name, icon, base, fields, notify, reads, created_by)
  SELECT o.form_id,
    CASE e.kind WHEN 'aankoop' THEN 'Aankoop' WHEN 'gebruik' THEN 'Gebruik' WHEN 'dienst' THEN 'Dienst'
      WHEN 'activiteit' THEN 'Activiteit' WHEN 'meting' THEN 'Meting' ELSE 'Overdracht' END,
    CASE e.kind WHEN 'aankoop' THEN 'cart' WHEN 'gebruik' THEN 'package' WHEN 'dienst' THEN 'wrench'
      WHEN 'activiteit' THEN 'clock' WHEN 'meting' THEN 'weight' ELSE 'transfer' END,
    e.kind,
    CASE WHEN e.kind = 'meting' THEN '[{"key":"waarde","label":"Waarde","type":"number"}]' ELSE '[]' END,
    l.notify,
    CASE WHEN EXISTS (SELECT 1 FROM json_each(json_extract(l.read_photo, '$.on')) WHERE value = e.kind) THEN 1
         WHEN EXISTS (SELECT 1 FROM json_each(json_extract(l.read_photo, '$.off')) WHERE value = e.kind) THEN 0 END,
    l.created_by
  FROM (SELECT DISTINCT list_id, kind FROM events WHERE kind IN ('aankoop', 'gebruik', 'dienst', 'activiteit', 'meting', 'overdracht')) e
  JOIN lists l ON l.id = e.list_id
  JOIN form_origin o ON o.form_id = e.list_id || '-' || e.kind;

UPDATE events SET kind = list_id || '-' || kind WHERE kind IN ('aankoop', 'gebruik', 'dienst', 'activiteit', 'meting', 'overdracht');

-- Geld in een lijst met een saldo per persoon: uitdrukkelijk in de handelingen (wie betaalde telt bij, wie deelt of
-- naar wie telt af), met de onderdelen van het vertrekpunt erbij.
UPDATE kinds_new SET
  parts = CASE base
    WHEN 'aankoop' THEN '{"money":true,"to":false,"duration":false,"groups":[{"role":"in","label":"Wat","list":null},{"role":"bij","label":"Waar","list":null}]}'
    WHEN 'dienst' THEN '{"money":true,"to":false,"duration":false,"groups":[{"role":"voor","label":"Voor","list":null},{"role":"bij","label":"Bij","list":null}]}'
    ELSE '{"money":true,"to":true,"duration":false,"groups":[]}' END,
  does = (
    SELECT json_group_array(json(value)) FROM (
      SELECT value FROM json_each(CASE base
        WHEN 'aankoop' THEN '[{"rows":{"from":"lines","role":"in"},"list":null,"field":"$voorraad","op":"bij","value":{"from":"qty"}}]'
        ELSE '[]' END)
      UNION ALL SELECT json_object('rows', json_object('from', 'payer'), 'list', o.list_id, 'field', '$saldo', 'op', 'bij', 'value', json_object('from', 'amount'))
      UNION ALL SELECT json_object('rows', json_object('from', CASE base WHEN 'overdracht' THEN 'to' ELSE 'sharers' END), 'list', o.list_id, 'field', '$saldo', 'op', 'af', 'value', json_object('from', 'amount'))
      UNION ALL SELECT value FROM json_each(COALESCE(kinds_new.does, '[]'))
    )
  )
FROM form_origin o JOIN lists l ON l.id = o.list_id
WHERE o.form_id = kinds_new.id AND l.ledger IS NOT NULL AND kinds_new.parts IS NULL AND kinds_new.base IN ('aankoop', 'dienst', 'overdracht');

DROP TABLE kinds;
ALTER TABLE kinds_new RENAME TO kinds;

-- Wie bij een formulier kan (zoals bij een lijst), en zijn tags.
CREATE TABLE form_people (
  form_id     TEXT NOT NULL REFERENCES kinds (id) ON DELETE CASCADE,
  person_id   TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('beheerder', 'lid', 'gast', 'geen')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (form_id, person_id)
);
CREATE INDEX form_people_person ON form_people (person_id);
INSERT INTO form_people (form_id, person_id, role)
  SELECT o.form_id, lp.person_id, lp.role FROM form_origin o JOIN list_people lp ON lp.list_id = o.list_id;

CREATE TABLE form_tag_links (
  form_id  TEXT NOT NULL REFERENCES kinds (id) ON DELETE CASCADE,
  tag_id   TEXT NOT NULL REFERENCES list_tags (id) ON DELETE CASCADE,
  PRIMARY KEY (form_id, tag_id)
);
CREATE INDEX form_tag_links_tag ON form_tag_links (tag_id);
INSERT INTO form_tag_links (form_id, tag_id)
  SELECT o.form_id, t.tag_id FROM form_origin o JOIN list_tag_links t ON t.list_id = o.list_id;

-- Gebeurtenissen zonder lijst (en hun lijnen en veranderingen opnieuw, omdat ze naar de gebeurtenis wijzen).
CREATE TABLE events_copy AS SELECT * FROM events;
CREATE TABLE lines_copy AS SELECT * FROM lines;
CREATE TABLE effects_copy AS SELECT * FROM effects;
DROP TABLE effects;
DROP TABLE lines;
DROP TABLE events;

CREATE TABLE events (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,             -- het formulier (of 'aanpassing')
  base           TEXT NOT NULL CHECK (base IN ('aankoop', 'gebruik', 'dienst', 'activiteit', 'meting', 'overdracht')),
  name           TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'gebeurd' CHECK (status IN ('gebeurd', 'gepland', 'afgevinkt')),
  at             TEXT NOT NULL,
  end_at         TEXT,
  amount         INTEGER,
  paid_by        TEXT REFERENCES people (id) ON DELETE SET NULL,
  split          TEXT,
  to_person      TEXT REFERENCES people (id) ON DELETE SET NULL,
  data           TEXT NOT NULL DEFAULT '{}',
  repeat         TEXT,
  done_by        TEXT,
  photo_version  INTEGER,
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO events (id, kind, base, name, status, at, end_at, amount, paid_by, split, to_person, data, repeat, done_by, photo_version, created_by, created_at, updated_at)
  SELECT id, kind, base, name, status, at, end_at, amount, paid_by, split, to_person, data, repeat, done_by, photo_version, created_by, created_at, updated_at FROM events_copy;
CREATE INDEX events_kind_at ON events (kind, at);
CREATE INDEX events_status ON events (status, at);

CREATE TABLE lines (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  role        TEXT NOT NULL CHECK (role IN ('in', 'uit', 'voor', 'bij')),
  item_id     TEXT REFERENCES items (id) ON DELETE SET NULL,
  text        TEXT,
  amount      REAL,
  unit        TEXT,
  price       INTEGER,
  expires     TEXT,
  owner       TEXT REFERENCES people (id) ON DELETE SET NULL
);
INSERT INTO lines (id, event_id, position, role, item_id, text, amount, unit, price, expires, owner)
  SELECT id, event_id, position, role, item_id, text, amount, unit, price, expires, owner FROM lines_copy;
CREATE INDEX lines_event ON lines (event_id, position);
CREATE INDEX lines_item ON lines (item_id);

CREATE TABLE effects (
  event_id  TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  item_id   TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  field     TEXT NOT NULL,
  op        TEXT NOT NULL CHECK (op IN ('zet', 'bij', 'af')),
  num       REAL,
  val       TEXT,
  unit      TEXT,
  expires   TEXT,
  PRIMARY KEY (event_id, position)
);
INSERT INTO effects (event_id, position, item_id, field, op, num, val, unit, expires)
  SELECT event_id, position, item_id, field, op, num, val, unit, expires FROM effects_copy;
CREATE INDEX effects_item ON effects (item_id, field);

DROP TABLE events_copy;
DROP TABLE lines_copy;
DROP TABLE effects_copy;

-- Een lijst zonder items bestond enkel voor haar logboek: haar formulieren hebben haar mensen en tags overgenomen.
DELETE FROM lists WHERE one IS NULL;

DROP TABLE form_origin;

-- Een melding bij iets nieuws hoort nu bij een formulier (overgenomen hierboven), niet meer bij een lijst.
UPDATE lists SET notify = NULL;

-- Wat gebeurtenissen doen, opnieuw uitrekenen (worker/cells.ts).
UPDATE settings SET value = '0' WHERE key = 'effects_version';
