-- Regels worden totalen (zie shared/totals.ts). Kosten verdelen en Terugbetalingen zijn nu een saldo dat verrekent
-- (Wie moet wie); wat de regel invulde, doen de velden zelf: Betaald door begint met jou, en een lege verdeling wordt
-- de gewone verdeling (of gelijk over iedereen).
--
-- De kolom rules blijft staan (de app gebruikt ze niet meer): zo kan je nog terug. Een latere migratie ruimt ze op.

-- Kosten verdelen: velden die zelf invullen, en een totaal dat verrekent (wie betaalde − de verdeling).
UPDATE item_types
SET fields = (
      SELECT json_group_array(json(f.value))
      FROM (
        SELECT CASE json_extract(e.value, '$.key')
                 WHEN json_extract(item_types.rules, '$[0].payer') THEN json_set(e.value, '$.me', json('true'))
                 WHEN json_extract(item_types.rules, '$[0].for') THEN
                   CASE WHEN json_type(item_types.rules, '$[0].default') = 'array'
                     THEN json_set(e.value, '$.fill', json('true'), '$.default_shares', json(json_extract(item_types.rules, '$[0].default')))
                     ELSE json_set(e.value, '$.fill', json('true'))
                   END
                 ELSE e.value
               END AS value
        FROM json_each(item_types.fields) e
        ORDER BY e.key
      ) f
    ),
    totals = json_insert(totals, '$[#]', json_object(
      'id', 'saldo', 'agg', 'sum', 'field', json_extract(rules, '$[0].amount'), 'period', 'all',
      'by', json_extract(rules, '$[0].payer'), 'against', json_extract(rules, '$[0].for'),
      'settle', json('true'), 'scope', 'tree'))
WHERE json_extract(rules, '$[0].kind') = 'split';

-- Terugbetalingen: wat Van gaf, telt voor hem; wat Aan kreeg, tegen hem.
UPDATE item_types
SET totals = json_insert(totals, '$[#]', json_object(
      'id', 'saldo', 'agg', 'sum', 'field', json_extract(rules, '$[0].amount'), 'period', 'all',
      'by', json_extract(rules, '$[0].from'), 'against', json_extract(rules, '$[0].to'),
      'settle', json('true'), 'scope', 'tree'))
WHERE json_extract(rules, '$[0].kind') = 'settle';
