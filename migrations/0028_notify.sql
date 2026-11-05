-- Een melding bij een nieuw item (zie shared/notify.ts), als JSON: {"to":"all"} of {"to":"field","field":"verdeling"}.
-- NULL = geen melding.
ALTER TABLE item_types ADD COLUMN notify TEXT;
