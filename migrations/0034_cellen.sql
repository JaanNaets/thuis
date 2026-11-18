-- Cellen (shared/cells.ts): een formulier zegt wat het doet met de kolommen van de dingen in zijn lijnen (Zet op,
-- Tel bij, Tel af), en wat een gebeurtenis zo doet, staat in `effects`. Die tabel is afgeleid: de Worker rekent ze uit
-- bij elk bewaren en bouwt ze opnieuw op uit de gebeurtenissen en hun formulieren (worker/cells.ts). De waarde van een
-- cel wordt nooit in het ding bewaard.

-- Wat een formulier doet (JSON, Handeling[]); NULL = enkel wat zijn lijnen altijd doen.
ALTER TABLE kinds ADD COLUMN does TEXT;

CREATE TABLE effects (
  event_id  TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  thing_id  TEXT NOT NULL REFERENCES things (id) ON DELETE CASCADE,
  field     TEXT NOT NULL,                    -- een veld van de lijst van het ding, of '$voorraad'
  op        TEXT NOT NULL CHECK (op IN ('zet', 'bij', 'af')),
  num       REAL,                             -- een getal (tellen, of een getal zetten)
  val       TEXT,                             -- JSON: wat er gezet wordt als het geen getal is
  unit      TEXT,
  expires   TEXT,
  PRIMARY KEY (event_id, position)
);
CREATE INDEX effects_thing ON effects (thing_id, field);
