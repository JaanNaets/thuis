-- Koppelen (shared/transfer.ts, worker/mirrors.ts): een lijst haalt blijvend dingen uit een andere lijst. Het plan zegt
-- welke dingen (voorwaarden), wat er per veld in komt en hoe keuzes vertalen. Een gekoppeld ding is een gewoon ding in
-- de doellijst (eigen voorraad en logboek) met de koppeling (`mirror_id`) en het ding in de bron (`mirror_of`); geen
-- vreemde sleutel op `mirror_of`: is het origineel weg, dan gaat het gekoppelde ding naar het archief.
CREATE TABLE mirrors (
  id          TEXT PRIMARY KEY,
  list_id     TEXT NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  source_id   TEXT NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  plan        TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (list_id, source_id)
);
CREATE INDEX mirrors_source ON mirrors (source_id);

ALTER TABLE things ADD COLUMN mirror_id TEXT REFERENCES mirrors (id) ON DELETE SET NULL;
ALTER TABLE things ADD COLUMN mirror_of TEXT;
CREATE INDEX things_mirror ON things (mirror_id, mirror_of);
