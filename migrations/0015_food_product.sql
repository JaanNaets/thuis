-- Lijsten uit het sjabloon Voeding: "kcal per 100 g" komt uit productinfo (een barcode of een herkend product vult
-- het in met echte gegevens, zie shared/product.ts).
UPDATE item_types
SET fields = (
      SELECT json_group_array(json(f.value))
      FROM (
        SELECT CASE
                 WHEN json_extract(e.value, '$.key') = 'kcal_100' AND json_extract(e.value, '$.type') = 'number'
                      AND json_extract(e.value, '$.product') IS NULL
                 THEN json_set(e.value, '$.product', 'kcal')
                 ELSE e.value
               END AS value
        FROM json_each(item_types.fields) e
        ORDER BY e.key
      ) f
    )
WHERE fields LIKE '%"kcal_100"%';
