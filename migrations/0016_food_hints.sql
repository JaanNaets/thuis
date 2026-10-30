-- Voeding: de uitleg bij kcal per 100 g en Hoeveel zei "uit de voedingstabel op de verpakking". Een foto van iets
-- zonder verpakking (een kop cappuccino) bleef daardoor leeg; de nieuwe uitleg laat schatten. Enkel als de uitleg nog
-- die van het sjabloon is (wat je zelf aanpaste, blijft).
UPDATE item_types
SET fields = (
      SELECT json_group_array(json(f.value))
      FROM (
        SELECT CASE
                 WHEN json_extract(e.value, '$.hint') = 'energie uit de voedingstabel op de verpakking, per 100 g of 100 ml, in kcal (niet kJ)'
                 THEN json_set(e.value, '$.hint', 'per 100 g of 100 ml, in kcal (niet kJ): van de voedingstabel, anders geschat')
                 WHEN json_extract(e.value, '$.hint') = 'wat je at, in gram (niet de hele verpakking)'
                 THEN json_set(e.value, '$.hint', 'wat je at of dronk, in g of ml (niet de hele verpakking)')
                 ELSE e.value
               END AS value
        FROM json_each(item_types.fields) e
        ORDER BY e.key
      ) f
    )
WHERE fields LIKE '%uit de voedingstabel op de verpakking%' OR fields LIKE '%wat je at, in gram%';
