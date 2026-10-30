# Thuis: werkafspraken

App voor thuis op Cloudflare (Workers, D1, R2): projecten, mensen met rollen, en items met eigen velden. Alles in het Nederlands (Vlaams, "je"): code-commentaar, teksten,
commits en uitleg.

## Ontwerp: lees eerst het stijlboek

**Lees `STIJLBOEK.md` voor je een scherm, component, formulier of tekst toevoegt of verandert, en volg het.**

- Gebruik de bestaande componenten (`src/components/`) en tokens (`:root` in `src/styles.css`); verzin geen
  nieuwe kleuren, maten of patronen.
- Loop de checklist onderaan het stijlboek af voor je iets oplevert.
- Introduceer je toch een nieuw patroon, bouw het dan als component en voeg het toe aan `STIJLBOEK.md`.
- Bekijk het resultaat op gsm (390px) en tablet (1280px en 820px) voor je het oplevert.

## Code

- Navigeren altijd met `Link`, `NavLink` en `useNavigate` uit `src/router.tsx` (vloeiende schermwissels), nooit
  rechtstreeks uit `react-router`. Een nieuw scherm komt in `src/routes.tsx`.

- Bedragen in cent, datums als `YYYY-MM-DD`. Opmaak via `src/format.ts`.
- Alles is een **project** (een boom: `parent_id`), ook "Huishouden": achter de schermen is geen enkel project
  speciaal. Een persoon (`people`) krijgt per project een **rol** (`memberships`); die geldt ook in de subprojecten,
  tenzij er dichter een eigen lidmaatschap is. Wat een rol mag, staat in `shared/access.ts`: `manage`, `members`,
  `create`, `delete`, en per lijst en per veld Niet zien / Zien / Wijzigen. Een lijst heet in de code `item_type`;
  in alles wat de gebruiker leest is het een **lijst** (nooit "soort").
- Elke route die iets van een project raakt, haalt eerst de toegang op met `requireProject` (of `projectAccess`) uit
  `worker/context.ts`, en een item met `requireItem` (`worker/routes/items.ts`). Geen lidmaatschap = 404 "niet
  gevonden"; ontbreekt een recht, dan `need(access, …)` of een `ForbiddenError`. Bij twijfel: weigeren.
- Velden van een item gaan altijd door `prepareData`: `cleanAttributes` (`shared/fields.ts`), dan `mergeEditable`
  (velden die je niet mag wijzigen, houden hun waarde), verwijzingen naar personen en items gecontroleerd. Wat je
  terugstuurt, gaat door `visibleData`. Wat van buiten komt (ids van lijsten, tags, rollen, personen) controleer je
  tegen de keten van het project (`access.chain`).
- Er moet altijd iemand overblijven die het hoofdproject kan instellen (`assertKeepsAdmin`), en enkel wie zelf
  `manage` heeft, geeft een rol met `manage` (`assertRoleAllowed`).
- Een use case (verdelen, voorraad, calorieën, …) bouw je bovenop de kern, niet erin: uit velden (die zelf invullen
  wat leeg is: `applyFieldDefaults`), berekeningen en **totalen** op een lijst (`shared/totals.ts`, nagekeken met
  `cleanTotals`, gefilterd met `visibleTotals`), als sjabloon (`shared/templates.ts`). Kosten verdelen is zo een
  totaal dat verrekent (`settle`: Wie moet wie). Een totaal rekent de API uit per lezer (`itemsAsSeen` in
  `worker/compute.ts`): elk item met de rechten van de lezer in zijn eigen project, ook bij subprojecten en lijsten
  uit andere projecten ("ook uit", nagekeken met `checkSources`).
- Een **berekening** (veldsoort `calc`, `shared/calc.ts`) wordt nooit bewaard: de API kijkt ze na met `checkCalcs`
  en rekent ze uit bij het lezen (`withCalcs` in `worker/compute.ts`), enkel op wat de lezer mag zien. Opzoeken en
  samenvatten halen andere items op en kijken per item project, lijst en veld na.
- **Sjablonen delen** (`shared/template-file.ts`): een bestand zonder items, mensen, rollen of standaardverdelingen.
  Wat binnenkomt, gaat door `parseTemplateFile`; verwijzingen wijzen enkel naar lijsten uit het sjabloon (in hetzelfde
  project of erboven) of uit de eigen keten (`planTemplate` → `resolveTemplateLists`); wat niet klopt, valt weg.
- Bewaar nooit een wachtwoord, enkel bv. een klantnummer en waarmee je aanmeldt.
- Schemawijziging = nieuw bestand in `migrations/` (nooit een bestaand aanpassen); eerst lokaal testen met
  `npm run db:migrate:local`. Een push naar `main` rolt uit en voert de migratie online uit.
- Gedeelde types en logica in `shared/`, met tests in `test/` (`npm test`).
- Controle voor oplevering: `npx tsc -b`, `npm test`, `npm run build`.
