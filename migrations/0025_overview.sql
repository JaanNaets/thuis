-- Wat op je overzicht staat (zie shared/overview.ts): blokken in jouw volgorde, als JSON. NULL = vanzelf.
ALTER TABLE people ADD COLUMN overview TEXT;
