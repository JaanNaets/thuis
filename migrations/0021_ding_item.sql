-- De lijst "Ding" (uit het sjabloon Huishouden) heet voortaan "Item": "Item toevoegen".
UPDATE item_types SET name = 'Item' WHERE name = 'Ding';
