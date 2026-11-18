-- Groepen lijnen met een eigen sleutel: een formulier kan zoveel groepen hebben als het wil, ook met dezelfde rol
-- (Wagen én Bestuurder, allebei Waarover). Een lijn onthoudt haar groep (`grp`, de `key` van een groep in
-- `kinds.parts`); de rol blijft op de lijn (wie ze ziet, of ze een lijst raakt). Wat er al was: de groep is de rol,
-- zoals de groepen van vroeger hun rol als sleutel krijgen (`cleanParts`) en handelingen van vroeger (`rows.role`)
-- bij het lezen naar die groep wijzen (`readDoes`).
ALTER TABLE lines ADD COLUMN grp TEXT;
UPDATE lines SET grp = role;
