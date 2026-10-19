-- Teller per dag voor het automatisch lezen met AI, zodat we nooit boven de gratis hoeveelheid gaan.
CREATE TABLE ai_usage (
  day   TEXT PRIMARY KEY,               -- YYYY-MM-DD (UTC, zoals de gratis hoeveelheid van Workers AI)
  calls INTEGER NOT NULL DEFAULT 0
);
