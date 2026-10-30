-- Bewaarde weergaven van een lijst: filters, sortering en kolommen (zie shared/views.ts), voor jezelf of (zonder
-- person_id) voor iedereen in het project.
CREATE TABLE views (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  type_id    TEXT NOT NULL REFERENCES item_types (id) ON DELETE CASCADE,
  person_id  TEXT REFERENCES people (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  def        TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX views_list ON views (project_id, type_id);
