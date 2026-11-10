-- Een formulier dat standaard gepland begint (een boodschap, een taak): een nieuwe gebeurtenis ermee staat eerst op
-- Gepland, tot je ze afvinkt. Enkel de start: de status zelf staat op de gebeurtenis.
ALTER TABLE kinds ADD COLUMN planned INTEGER NOT NULL DEFAULT 0;
