-- Meldingen en herhalen.
--
-- Een toestel dat meldingen wil (web push): het adres bij de pushdienst van de browser en de sleutels om de melding
-- voor dat toestel te versleutelen. Geen wachtwoord of geheim van de gebruiker; uitzetten verwijdert de rij.
CREATE TABLE push_subscriptions (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX push_subscriptions_person ON push_subscriptions (person_id);

-- Een item dat zich herhaalt (de huur, elke maand): op `next_on` maakt de app 's morgens een nieuw item zoals dit, met
-- de rechten van wie het instelde.
CREATE TABLE repeats (
  item_id    TEXT PRIMARY KEY REFERENCES items (id) ON DELETE CASCADE,
  every_n    INTEGER NOT NULL,
  every_unit TEXT NOT NULL,
  next_on    TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX repeats_next ON repeats (next_on);
