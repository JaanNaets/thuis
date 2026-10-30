-- Totalen op een lijst (zie shared/totals.ts): bv. "Kcal per dag" of "Uitgaven per maand", eventueel met een doel.
-- Een JSON-lijst; de Worker kijkt ze na tegen de velden van de lijst.
ALTER TABLE item_types ADD COLUMN totals TEXT NOT NULL DEFAULT '[]';
