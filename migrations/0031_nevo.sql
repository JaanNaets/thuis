-- NEVO-online (RIVM, zie shared/nevo.ts): de voedingswaarde van gewone voedingsmiddelen, per 100 g, ongewijzigd uit het
-- bestand van het RIVM. Niet in git (het repo is publiek; de gegevens zijn van het RIVM): scripts/nevo.mjs maakt
-- data/nevo.sql, en dat zet je in de databank (lokaal en online). Leeg = geen NEVO.
CREATE TABLE nevo_foods (
  code INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kcal REAL,
  fat REAL,
  saturated REAL,
  carbs REAL,
  sugars REAL,
  fiber REAL,
  protein REAL,
  synonym TEXT,
  version TEXT NOT NULL
);
