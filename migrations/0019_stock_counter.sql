-- Voorraad (sjabloon Huishouden): Aantal krijgt − en + in de lijst, en kan je bijtellen met scannen of een kasticket.
-- Enkel in lijsten met "Bijna op onder" (een voorraad), en enkel het getal Aantal.
UPDATE item_types
SET fields = (
      SELECT json_group_array(json(f.value))
      FROM (
        SELECT CASE
                 WHEN json_extract(e.value, '$.key') = 'aantal' AND json_extract(e.value, '$.type') = 'number'
                 THEN json_set(e.value, '$.counter', json('true'))
                 ELSE e.value
               END AS value
        FROM json_each(item_types.fields) e
        ORDER BY e.key
      ) f
    )
WHERE fields LIKE '%"key":"bijna_op"%' AND fields LIKE '%"key":"aantal"%';
