-- Lijsten van erboven die een subproject toont, ook zonder items erin: bv. Uitgaven van het huishouden als tab in
-- Pelletkachel, zodat je de kosten van de kachel daar ingeeft (en ze meetellen in Wie moet wie erboven).
-- Verdwijnt het project of de lijst, dan ook de rij.
CREATE TABLE shown_lists (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  type_id    TEXT NOT NULL REFERENCES item_types (id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, type_id)
);
CREATE INDEX shown_lists_type ON shown_lists (type_id);
