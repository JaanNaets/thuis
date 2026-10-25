-- Regels op een lijst (zie shared/rules.ts): bv. "Kosten verdelen" op Uitgaven, of "Terugbetalingen".
-- Een JSON-lijst; de Worker kijkt ze na tegen de velden van de lijst.
ALTER TABLE item_types ADD COLUMN rules TEXT NOT NULL DEFAULT '[]';

-- Uitgaven uit het sjabloon (bedrag, betaald door, verdeling) krijgen meteen de regel Kosten verdelen.
UPDATE item_types
SET rules = '[{"kind":"split","amount":"bedrag","payer":"betaald_door","for":"verdeling"}]'
WHERE rules = '[]'
  AND EXISTS (SELECT 1 FROM json_each(item_types.fields) WHERE json_extract(value, '$.key') = 'bedrag' AND json_extract(value, '$.type') = 'money')
  AND EXISTS (SELECT 1 FROM json_each(item_types.fields) WHERE json_extract(value, '$.key') = 'betaald_door' AND json_extract(value, '$.type') = 'person')
  AND EXISTS (SELECT 1 FROM json_each(item_types.fields) WHERE json_extract(value, '$.key') = 'verdeling' AND json_extract(value, '$.type') = 'share');
