# Thuis: werkafspraken

App voor thuis op Cloudflare (Workers, D1, R2): projecten, mensen met rollen, en items met eigen velden. Alles in het Nederlands (Vlaams, "je"): code-commentaar, teksten,
commits en uitleg.

## Ontwerp: lees eerst het stijlboek

**Lees `STIJLBOEK.md` voor je een scherm, component, formulier of tekst toevoegt of verandert, en volg het.**

- Gebruik de bestaande componenten (`src/components/`) en tokens (`:root` in `src/styles.css`); verzin geen
  nieuwe kleuren, maten of patronen.
- Loop de checklist onderaan het stijlboek af voor je iets oplevert.
- Geen uitleg in de interface (stijlboek, principe 11): geen ondertitel die herhaalt, geen uitlegzin onder een veld,
  schakelaar of kaart, geen "· optioneel", geen tellers of rollen als bijlabel, een lege staat is een titel en één
  knop. Snapt iemand het niet zonder uitleg, verbeter dan het label of de opbouw.
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
- Een verwijzing (`item`, `items`) wijst naar `ref_type` en eventueel meer lijsten (`ref_also`, uit eender welk
  project dat de bewerker ziet); gebruik altijd `refLists(def)`, nooit enkel `ref_type`. Met `free` mag één
  verwijzing ook vrije tekst zijn (`{ text }`, geen verwijzing: niets na te kijken, af te trekken of over te nemen).
  De keuzes komen per bladzijde (`GET /items?type=…`, met `more`); is een lijst groter, dan zoekt de server (`q`,
  `nameMatches`), vindt hij de namen in een getypte tekst (`in`, `nameIn`, voor snel invullen) en de naam van wat al
  gekozen is (`ids`). Nooit alle items van een lijst naar de browser sturen.
- Velden van een item gaan altijd door `prepareData`: `cleanAttributes` (`shared/fields.ts`), dan `mergeEditable`
  (velden die je niet mag wijzigen, houden hun waarde), verwijzingen naar personen en items gecontroleerd. Wat je
  terugstuurt, gaat door `visibleData`. Wat van buiten komt (ids van lijsten, tags, rollen, personen) controleer je
  tegen de keten van het project (`access.chain`). Uitzondering: een verwijzing of samenvatting mag ook naar een lijst
  in een ander project die de bewerker ziet (`fieldListsFor` → `visibleLists`); wie de items leest, ziet er enkel
  van wat hij in dat project mag zien (namen, opzoeken, samenvatten en "verwijst hiernaar" kijken per item na).
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
- **Snel invullen** (`shared/quickfill.ts`, `POST /projects/:id/items/read`): getypte tekst eerst met code naar de
  velden (getest in `test/quickfill.test.ts`); enkel een hele zin gaat naar de AI (zelfde `useAiBudget` als een foto),
  en wat de code vond, wint. Alles daarna gewoon door het formulier en `prepareData`.
- **Productinfo** (`shared/product.ts`, `worker/products.ts`): Open Food Facts krijgt enkel een barcode of een
  productnaam, nooit iets van de gebruiker; resultaten staan 30 dagen in `products`. Liever geen match dan een
  verkeerd product (`bestMatch`), en de app toont altijd of iets uit de databank komt of geschat is.
- **Weergaven** (`shared/views.ts`: filters, sortering, kolommen, groeperen, als agenda; de volgorde altijd met
  `orderItems`, optellen enkel waar het zin heeft: `canSum`) en de **agenda** (`shared/agenda.ts`,
  velden met `agenda`) zijn generiek over alle veldsoorten. Een weergave is geen beveiliging: wat iemand niet mag zien,
  krijgt hij niet, en een voorwaarde daarop telt voor hem niet mee. `/agenda` kijkt per item de rechten in zijn
  project na. Wat binnenkomt, gaat door `cleanView`.
- **Met subprojecten** (`?sub=1`, `tree` in een weergave): de items van een lijst ook uit de subprojecten
  (`itemsIn` in `worker/routes/items.ts`), elk met de rechten van de lezer in zijn eigen project (daar kan hij een
  andere rol hebben). Een subproject kiest lijsten van erboven als tab (`shown_lists`, `PUT /projects/:id/shown`,
  enkel lijsten uit de keten erboven die je ziet).
- **Overzicht** (`shared/overview.ts`, `people.overview`, `PUT /me/overview`): per persoon blokken (project met
  verborgen lijsten en per lijst eventueel een weergave om te tellen, lijst, snel toevoegen, totaal, waarde van een
  item; een lijst met een bewaarde weergave en als aantal of als items, elk blok eventueel breed), enkel ids,
  nagekeken met `cleanBlocks`. Een lijstblok haalt enkel
  de eerste items en het aantal (`GET /projects/:id/items?type=&view=&limit=`, met `count`), nooit de hele lijst. Een
  blok haalt zijn inhoud op met de gewone routes (dus met de rechten van de lezer); `null` = vanzelf (`defaultBlocks`:
  elk project, of bij meer dan `DEFAULT_ALL` enkel die bovenaan). `GET /me/overview` geeft enkel de lijsten van de
  projecten in de blokken (`blockProjects`, of `?projects=`). Opstarten blijft licht bij 1000 projecten: geen lijst
  of boom die alles tegelijk tekent (de zijbalk tekent een tak pas als hij open gaat).
- **Verbanden** (`shared/links.ts`, `worker/routes/links.ts`, `/projecten/:id/verbanden` en `/verbanden` voor het hele web
  over al je projecten): worden nooit bewaard, maar afgeleid uit de velden, berekeningen en totalen die de lezer
  ziet (`listLinks`, met `visibleFields` en `visibleTotals`). **Verbanden gaan altijd mee**: elke eigenschap van
  `FieldDef`, `TotalDef` en elke soort berekening staat in `FIELD_LINKS`, `TOTAL_LINKS` of `CALC_LINKS` (TypeScript
  weigert te bouwen tot een nieuwe erin staat); wat lijsten verbindt (`true`), toont `listLinks`, met een voorbeeld in
  `test/links.test.ts`. Een kaart is één project met hoogstens `MAX_COLUMNS` subprojecten en `MAX_OUTSIDE` lijsten van
  elders, met een vast aantal vragen aan de databank (ook bij 1000 projecten). De schikking is een vaste regel
  (`layoutLinks`): een rij per lijst waar iets toekomt, kolommen per project. **Problemen** (`adjustProblems`): wie
  een item met een verwijzing die telt mag bewaren, maar het getal aan de andere kant niet mag wijzigen (dichtste rol
  per project); enkel voor wie de mensen in beide projecten beheert, met twee vragen aan de databank.
- **Verwijzingen die tellen** (`adjust`, `shared/effects.ts`, `worker/effects.ts`): wat een item aan andere items deed,
  staat in `items.applied` (nooit naar de browser). Bewaren past enkel het verschil toe, in dezelfde batch, en weigert
  als de bewerker dat getal daar niet mag wijzigen; verwijderen draait terug waar het mag. Overnemen (`copy`) gebeurt
  in het formulier en gaat daarna door `prepareData` zoals alles.
- **Herinneren en herhalen** (`shared/remind.ts`, `worker/cron.ts`, elke ochtend): een melding gaat enkel naar wie
  het item en de datum (en alles waarvan ze afhangt) nu mag zien; een herhaling maakt het nieuwe item met de rechten
  die wie ze instelde nu heeft, door `prepareData`, en stopt als dat niet meer mag. Meldingen (web push,
  `shared/webpush.ts`) gaan enkel naar de pushdiensten van de browsers (`isPushEndpoint`).
- **Back-up** (`shared/backup.ts`, `worker/routes/backup.ts`, op Jouw gegevens): enkel de projecten waar je alles
  beheert (`manage` én `members`), met wat je ziet (`visibleFields`, `visibleData`, `visibleTotals`); nooit `applied`,
  een rekeningnummer of andermans eigen weergaven. Terugzetten maakt altijd een nieuwe kopie (`freshIds`, `remap`) en
  kijkt alles na zoals bij gewoon invoeren (`cleanTypeFields`, `cleanAttributes`, personen uit het project,
  verwijzingen die bestaan en die je ziet); wat niet klopt, valt weg. Foto's en bestanden enkel uit items die nog
  bestaan en die je ziet. **Een nieuwe tabel of kolom neem je mee in de back-up** (of zeg in `BACKUP_TABLES` waarom
  niet; `test/backup.test.ts` leest de migraties na).
- Bewaar nooit een wachtwoord, enkel bv. een klantnummer en waarmee je aanmeldt.
- Schemawijziging = nieuw bestand in `migrations/` (nooit een bestaand aanpassen); eerst lokaal testen met
  `npm run db:migrate:local`. Een push naar `main` rolt uit en voert de migratie online uit.
- Gedeelde types en logica in `shared/`, met tests in `test/` (`npm test`).
- Controle voor oplevering: `npx tsc -b`, `npm test`, `npm run build`.
