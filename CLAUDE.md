# Heystack: werkafspraken

Heystack (het repo, de Worker en de databank heten nog `thuis`) is onze app op Cloudflare (Workers, D1, R2): lijsten met dingen en een logboek, mensen per lijst, tags om te
groeperen. Alles in het Nederlands (Vlaams, "je"): code-commentaar, teksten, commits en uitleg.

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
- Bedragen in cent, datums als `YYYY-MM-DD` (een tijdstip `YYYY-MM-DDTHH:MM`, tijd in België). Opmaak via `src/format.ts`.

### Het model (`shared/model.ts`, `migrations/0029_lijsten.sql`)

- Er zijn enkel **lijsten** (`lists`). Een lijst heeft **dingen** (`things`, allemaal met dezelfde velden: `fields`;
  `one` = hoe één ding heet, leeg = een lijst zonder dingen), altijd een **logboek** met **gebeurtenissen**
  (`events`), **mensen** (`list_people`) en **tags** (`list_tags`, `list_tag_links`). Geen projecten, geen lijsten in
  lijsten: tags groeperen, een lijst kan meer tags hebben. Wie de gebruiker leest, zegt "lijst", "ding" en "logboek".
- Een gebeurtenis heeft een **soort**: één van zes basissoorten (`BASES`: aankoop, gebruik, dienst, activiteit, meting,
  overdracht) of een eigen soort van een lijst (`kinds`, met eigen velden; Gegeten, Tankbeurt). Ze heeft **lijnen**
  (`lines`): `in` (erbij), `uit` (eraf), `voor` (waarvoor, de wagen) en `bij` (waar, de winkel), naar een ding of als
  tekst, met hoeveel, eenheid, prijs, houdbaar tot en eventueel `owner` (enkel van die persoon). Status: `gebeurd`,
  `gepland` (te doen, boodschappen), `afgevinkt` (een boodschap die gekocht is: telt niet mee).
- Uitgaven, kastickets, boodschappen en eten zijn **geen lijsten** maar gebeurtenissen. Er zijn ook geen vaste
  pagina's (Geld, Voorraad, Eten, Te doen, Agenda): dat zijn **borden** met weergaven (bronnen: logboek, dingen,
  voorraad, saldo, voeding, datums; uitgerekend in `worker/routes/insights.ts`, `GET /insights/view`). Je borden staan
  met naam en icoon in het menu, in jouw volgorde (`placesOf`: `/` en `/bord/:id`; ⋯ → Volgorde); Alle lijsten staat niet
  tussen de borden maar bovenaan de lijsten (`LINKS_PLACE`: `/lijsten`, je lijsten en hun verbanden).
- Dingen houden bij het overzetten de id van hun oude item (foto's in R2: `items/{id}/photo`); een gebeurtenis
  gebruikt `events/{id}/photo` (`worker/media.ts`).

### Rechten (`shared/rights.ts`, `worker/access.ts`)

- Vaste rollen per lijst: **beheerder** (instellen, mensen), **lid** (dingen en loggen), **gast** (kijken), en
  rechtstreeks **geen** (een uitzondering). Er zijn geen rechten per veld.
- Een **regel op een tag** (`tag_rules`, "Jana altijd beheerder bij Huis") geeft een rol op elke lijst met die tag,
  maar enkel waar wie de regel maakte zelf rechtstreeks beheerder is; wie een tag zet, ziet wie er zo bij komt; een
  rechtstreekse rij op de lijst wint, ook `geen`. Uitgerekend in één vraag: `seenLists` (wat iemand ziet, met rol).
- Elke route haalt eerst de toegang op: `requireList`, `requireThing` (geen toegang = 404 "niet gevonden"), daarna
  `needEdit` of `needManage`. Bij twijfel: weigeren. Er blijft altijd een rechtstreekse beheerder (`keepsAdmin`).
- **Lijnen zien**: een lijn `in`/`uit`/`voor` is ook zichtbaar voor wie de lijst van het ding ziet (in het logboek
  van die lijst, als "gedeeltelijk": zonder bedrag, naam of andere lijnen); een lijn `bij` enkel met de hele
  gebeurtenis (anders ziet Jana via Dr. Peeters het doktersbezoek van Jaan). Zie `lineVisible`, `viewEvents`.
- Velden van een ding of soort gaan altijd door `prepareData` (`worker/prepare.ts`): `cleanAttributes`, enkel gekende
  personen, verwijzingen enkel naar dingen die de bewerker ziet. Lijstvelden door `cleanListFields`
  (`shared/listdef.ts`).

### Wat afgeleid wordt (nooit bewaard)

- **Voorraad** (`shared/stock.ts`, `stock` op een lijst): de laatste telling (een meting `voor` het ding) plus `in`
  min `uit`, enkel `gebeurd`, omgerekend met `convert` (`shared/units.ts`: kg/g/l/ml/stuk, een verpakking). Bijna op
  onder het minimum; zonder minimum enkel in een lijst met een minimumveld en als er ooit iets was.
- **Geld** (`shared/ledger.ts`): `sharesOf` (lijnen met `owner` zijn van die persoon, de rest volgens `split`, anders
  van wie betaalde), `netBalance` en `settleUp` voor Wie moet wie; een overdracht verrekent.
- **Eten** (`shared/food.ts`): een gebruik met kcal (in de soort, of uit een ding met kcal per 100 g × gram; `isFood`).
- **Berekeningen** (veldsoort `calc`, `shared/calc.ts`) enkel binnen het ding; geen verwijzende berekeningen meer.
- Een **logboek als tabel** (`shared/logview.ts`: `logFields`, `logItem`) zodat filters, weergaven
  (`shared/views.ts`) en grafieken (`shared/charts.ts`) ook op gebeurtenissen werken.

### Eén ingang

- **Palet** (`CommandPalette`, `GET /me/targets`, `shared/targets.ts`): zoeken en toevoegen; de rest van de tekst gaat
  als `?tekst=` naar het formulier. Op een lijst opent de + hetzelfde palet, enkel voor die lijst (`PaletteScope`). Een
  foto bij de + gaat mee naar het gekozen formulier (`putShared`, `?foto=gedeeld`, `&lezen=1`).
- **Lijsten tonen** (per persoon, `hidden` in `app_settings`, `PUT /me/hidden`): niet in het menu of niet bij de +;
  zoeken, Verbanden en keuzelijsten tonen ze altijd. Alles op één plek: **Lijsten** (`/lijsten`, `ListsPage`): één pagina met je lijsten per tag (de naam opent de lijst,
  ▸ toont haar verbanden), wie erbij is, per lijst Menu, Toevoegen en Meldingen (stilzetten, `mutedBy` in
  `shared/apps.ts`), je volgorde, en op tablet ook de kaart.
- **Typ wat je weet** (`shared/parse.ts`, getest): tekst live naar de gebeurtenis (datum, uur, bedrag, dingen met
  hoeveelheid en prijs, velden van de soort); enkel wat de tekst zette verandert mee. Dingen komen van
  `GET /things?in=` (met `usual`: de rol die ze meestal hebben, Colruyt = bij).
- **De AI is altijd zichtbaar**: elke knop die ze gebruikt draagt ✨ (`AiMark`), ze start nooit vanzelf (enkel na een
  tik of de schakelaar Lezen met AI in de fotokiezer, `PhotoButton`), per persoon aan of uit (`useAiBudget`: 25 per
  persoon per dag, 50 samen). Welke formulieren een foto lezen: per lijst (`lists.read_photo`, `shared/photoread.ts`;
  standaard dingen, soorten met geld of voedingswaarden). Een foto lezen voor een gebeurtenis
  (`POST /lists/:id/events/read-photo` met de soort): een aankoop is een kasticket (`shared/receipt.ts`): één aankoop
  met een lijn per product, koppelt enkel aan dingen die de lezer ziet, bewaart niets; een soort met voedingswaarden
  herkent een gerecht en schat (dat zegt de app); een andere soort vult haar velden met wat er echt staat. Van een
  kasticket wordt de naam op het ticket onthouden (`POST /things/:id/alias`, een tekstveld met `aliases`). Een ding van een foto (`POST /lists/:id/things/read-photo`) of barcode (Open Food Facts,
  zonder AI); de app toont altijd of iets uit een databank komt of geschat is.
- **Productinfo**: Open Food Facts krijgt enkel een barcode of productnaam, nooit iets van de gebruiker; NEVO
  (`shared/nevo.ts`, `nevoMatch` op hoofdwoord en synoniemen) zonder netwerk, met `nevoCredit`. NEVO staat in D1
  (`nevo_foods`), **nooit in git** (het repo is publiek, de gegevens zijn van het RIVM): `node scripts/nevo.mjs
  data/<bestand>.csv <versie>` maakt `data/nevo.sql` (data/ staat in .gitignore), dat je lokaal en online uitvoert.

### De rest

- **Herhalen en herinneren** (`worker/cron.ts`, elk kwartier): een gebeurde gebeurtenis met `repeat` krijgt kopieën tot
  vandaag met de rechten die wie ze maakte nu heeft (stopt als dat niet meer mag); een geplande met `repeat` maakt de
  volgende bij afvinken. Om 7 u herinneringen voor datums van dingen en wat vandaag gepland staat. Een timer is een
  activiteit zonder einde (`POST /events/:id/stop`, `kinds.goal` voor een melding).
- **Melding bij iets nieuws** (`shared/alerts.ts`, `notify` op een lijst): aan iedereen die de lijst ziet of aan wie in
  de verdeling staat; nooit aan wie het logde of wie de lijst of tag stilzette.
- **Overzicht** (`shared/board.ts`, `shared/blocks.ts`): borden (naam, icoon) met blokken van twee soorten. Een **weergave** is een
  zin: bron (logboek, dingen, voorraad, saldo's, voeding, alles met een datum) + lijsten + voorwaarden (`ViewDef`) +
  tellen (`Tally`) + één van elf vormen (`SHOWS`, ook Agenda) + voorwaarden op wat je ziet (`Rule`: een rij kleuren, bovenaan, verbergen; het blok
  verbergen als er niets is; de uitkomst kleuren). De server rekent ze uit met de rechten van de lezer
  (`GET /insights/view`, `evaluateView`); met een periode blader je (`viewSpan`, `?periode=`), een agenda per maand.
  Een **actie** logt: soort, vooraf ingevulde velden en wat een tik doet
  (formulier, meteen bewaren met Ongedaan maken, tellen, timer). Geen vaste blokken of voorbeelden; oude blokken
  (todo, money, stock, quick, chart, …) worden bij het lezen een gelijke zin (`upgradeBlock`). Automatisaties (iets
  dat zelf handelt) zijn voor later. Opstarten blijft licht: elk blok haalt zijn eigen inhoud.
- **App** (`shared/apps.ts`): eigen apps, snelkoppelingen, wat een gedeelde foto doet; enkel naar wat je bereikt
  (`keepReachable`).
- **Verbanden** (`shared/links.ts`, `GET /insights/links`, op `/lijsten`: Lijst of Kaart): hoe je lijsten samenhangen (verwijzingen,
  wat er gelogd is tussen lijsten, met welke dingen, de weergaven), enkel wat de lezer ziet, met wat voor iemand niet
  werkt. Zoeken (`searchLinks`), groeperen, sorteren en selecteren (`betweenSelection`) zitten in `shared/links.ts`
  (getest); de keuze staat in het adres (`?lijst=`, `?keuze=`, `?groep=`, `?sort=`). **Een nieuwe
  eigenschap van een veld, lijst, soort, gebeurtenis, lijn of blok beslis je in de `…_LINKS`-tabellen** (TypeScript
  dwingt het af; wat verbindt, krijgt een voorbeeld in `test/links.test.ts`).
- **Back-up** (`shared/backup.ts`, `worker/routes/backup.ts`): de lijsten die je beheert; terugzetten maakt altijd een
  nieuwe kopie en kijkt alles na. **Een nieuwe tabel of kolom neem je mee in de back-up** (of zeg in `BACKUP_TABLES`
  waarom niet; `test/backup.test.ts` leest de migraties na).
- **Sjabloon delen** (`shared/template-file.ts`): de opbouw van een lijst, zonder dingen of mensen.
- De oude tabellen (projecten, items, …) staan er nog maar worden niet meer gebruikt; ze gaan weg in een latere
  migratie.
- Bewaar nooit een wachtwoord, enkel bv. een klantnummer en waarmee je aanmeldt.
- Schemawijziging = nieuw bestand in `migrations/` (nooit een bestaand aanpassen); eerst lokaal testen met
  `npm run db:migrate:local`. Een push naar `main` rolt uit en voert de migratie online uit (een andere tak rolt
  nooit uit: `scripts/only-main.mjs`).
- Gedeelde types en logica in `shared/`, met tests in `test/` (`npm test`).
- Controle voor oplevering: `npx tsc -b`, `npm test`, `npm run build`.
