-- Formulieren zonder "Werkt als" (shared/model.ts): wat een formulier vraagt, staat in `parts` (geld, naar iemand, een
-- einde, zijn groepen lijnen met naam en lijst; NULL = die van het vertrekpunt `base`). Wat het doet, staat in `does`
-- (shared/cells.ts). Een lijst kan een saldo per persoon bijhouden (`ledger`: welke kolom de persoon is en welke het
-- saldo; Wie moet wie rekent daarmee).
ALTER TABLE kinds ADD COLUMN parts TEXT;
ALTER TABLE lists ADD COLUMN ledger TEXT;
