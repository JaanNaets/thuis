-- Jouw eigen volgorde van de projecten bovenaan je overzicht. Het overzicht is persoonlijk: wie in meerdere
-- projecten zit, zet ze zelf in de volgorde die hij wil. Subprojecten en soorten houden hun gedeelde sort_order.
ALTER TABLE memberships ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
