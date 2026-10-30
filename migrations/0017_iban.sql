-- Je rekeningnummer (IBAN), om terugbetaald te worden met een betaal-QR (zie shared/payment.ts). Zelf in te vullen
-- bij "Ik"; enkel te zien voor wie met jou een project deelt (in Wie moet wie).
ALTER TABLE people ADD COLUMN iban TEXT;
