-- Verwijzingen die tellen (shared/effects.ts): wat een item aan andere items deed (bv. voorraad eraf), als JSON, om
-- bij wijzigen enkel het verschil toe te passen en bij verwijderen terug te draaien.
ALTER TABLE items ADD COLUMN applied TEXT;
