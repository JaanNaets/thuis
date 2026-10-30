-- Instellingen en gegevens van de app zelf (geen gebruikersgegevens): bv. de dagkoersen van de ECB.
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
