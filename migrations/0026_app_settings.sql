-- De app instellen (zie shared/apps.ts): je eigen apps (iconen met een eigen bestemming), je snelkoppelingen en wat er
-- met een gedeelde foto gebeurt, als JSON. NULL = vanzelf. Waar de app opent, is per toestel en staat niet hier.
ALTER TABLE people ADD COLUMN app_settings TEXT;
