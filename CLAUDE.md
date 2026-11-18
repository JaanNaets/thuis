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

- **Bouw altijd generiek.** Een vraag voor één geval (boodschappen, de wijnkelder, Jana) wordt een eigenschap die voor
  elke lijst, soort, gebeurtenis of blok werkt (zoals `planned` op een actie, niet een knop Boodschap). Het geval
  zelf is dan instellen of gegevens, geen code. Nooit een lijst, soort, persoon of id in de code.
- Navigeren altijd met `Link`, `NavLink` en `useNavigate` uit `src/router.tsx` (vloeiende schermwissels), nooit
  rechtstreeks uit `react-router`. Een nieuw scherm komt in `src/routes.tsx`.
- Bedragen in cent, datums als `YYYY-MM-DD` (een tijdstip `YYYY-MM-DDTHH:MM`, tijd in België). Opmaak via `src/format.ts`.

### Het model (`shared/model.ts`, `migrations/0029_lijsten.sql`)

- Er zijn enkel **lijsten** (`lists`). Een lijst heeft **dingen** (`things`, allemaal met dezelfde velden: `fields`;
  `one` = hoe één ding heet, leeg = een lijst zonder dingen), altijd een **logboek** met **gebeurtenissen**
  (`events`), **mensen** (`list_people`) en **tags** (`list_tags`, `list_tag_links`). Geen projecten, geen lijsten in
  lijsten: tags groeperen, een lijst kan meer tags hebben. Wie de gebruiker leest, zegt "lijst", "ding", "logboek" en
  "formulier" (een soort; het woord "soort" staat nergens in de interface).
- Een gebeurtenis heeft een **formulier** (`kinds`; in de code soms nog "soort"). Een formulier is velden plus
  **onderdelen** (`parts`: `money` = bedrag, wie betaalde, verdeling en een prijs per lijn; `to` = naar iemand, een
  overdracht; `duration` = een einde, een activiteit of timer; `groups` = zijn **groepen lijnen** met een naam en
  eventueel één lijst: Wat, Waar, "Ruimte uit Huis") plus **handelingen** (`does`, zie Cellen). Er is geen "Werkt als"
  meer: de zes **vertrekpunten** (`BASES`: aankoop, gebruik, dienst, activiteit, meting, overdracht, met `baseParts` en
  `presetDoes`) zijn enkel waar een nieuw formulier mee begint, en de formulieren van een lijst zonder eigen formulieren.
  Een formulier zonder eigen onderdelen (`parts` NULL) volgt zijn vertrekpunt (`kindInfo`). **De code vraagt nooit "is dit
  een aankoop?"** maar wat het formulier vraagt of doet: `parts.money`, `parts.duration`, `buysWith` (kasticket,
  afvinken), `movesStock`, `formEats`, `stockOp`. Kiezen gebeurt in `FormPicker`: de formulieren van de lijst, zonder
  eigen de vertrekpunten, de rest onder Ander formulier (`formsOf`). **Lijnen** (`lines`) staan in de groep van hun rol
  (`in`, `uit`, `voor`, `bij`; `bij` = waar of bij wie, enkel met de hele gebeurtenis te zien), naar een ding of als
  tekst, met hoeveel, eenheid, prijs, houdbaar tot en eventueel `owner` (enkel van die persoon); wat een lijn doet,
  zeggen de handelingen, niet haar rol. Een groep uit één lijst kiest enkel daaruit (de server kijkt het na). Status:
  `gebeurd`, `gepland` (te doen, boodschappen), `afgevinkt` (een boodschap die gekocht is: telt niet mee). Een formulier
  kan gepland beginnen (`kinds.planned`, `startsPlanned`, `actionPlans`): zo is Boodschappen een lijst zonder dingen met
  een formulier Boodschap, die op Gepland opent.
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

- **Cellen** (`shared/cells.ts`, `worker/cells.ts`, getest): een formulier zegt wat het doet met de kolommen van de
  dingen in zijn lijnen (`kinds.does`, handelingen in "Wat het doet": welke lijn, welke kolom, **Zet op**, **Tel bij**
  of **Tel af**, met een veld, de datum, het bedrag, hoeveel of de prijs, of een vaste waarde). Schilderwerk zet de
  Kleur van de Ruimte; een Tankbeurt zet de Km-stand. Wat een gebeurtenis zo doet, staat in `effects` (afgeleid: bij
  elk bewaren uitgerekend met `rebuildEffects`, opnieuw voor alle gebeurtenissen van een formulier dat verandert, en
  helemaal opnieuw als `EFFECTS_VERSION` verandert). De waarde van een cel is wat in het ding stond of de laatste Zet,
  plus wat er daarna bij en af ging, in volgorde van de datum en enkel `gebeurd` (`foldCell`); ze komt bij het lezen
  in de waarden van het ding (`withCells`: lijst, fiche, weergaven, agenda, herinneringen, koppelingen). Een cel die
  het logboek invult en die je in het ding aanpast, wordt een **Aanpassing** (`ADJUST`: een gebeurtenis die zet). Wie
  bewaart, moet de lijst van wat het formulier invult mogen wijzigen (`touchesCell`). **Een nieuwe plek die
  gebeurtenissen of lijnen schrijft, roept `rebuildEffects` op.**
- **Voorraad** (`shared/stock.ts`, `stock` op een lijst): een cel (`STOCK`) zoals de andere: een aankoop telt bij,
  gebruik telt af en een telling (een meting `voor` het ding) zet (`presetDoes`), enkel `gebeurd`, omgerekend met
  `convert` (`shared/units.ts`: kg/g/l/ml/stuk, een verpakking). Bijna op onder het minimum; zonder minimum enkel in een
  lijst met een minimumveld en als er ooit iets was.
- **Geld** (`shared/ledger.ts`, `shared/cells.ts`): ook een cel. Een lijst met een **saldo per persoon** (`ledger`:
  welke kolom de persoon is en welke het saldo; Instellen → Tellen) heeft een rij per persoon; ontbreekt die, dan maakt
  `rebuildEffects` ze. Handelingen op personen (`rows`: `payer`, `sharers`, `to`; `BALANCE` = het saldo van de lijst van
  de gebeurtenis): wie betaalde telt het bedrag bij, wie deelt zijn deel af (`sharesOf`: lijnen met `owner` zijn van die
  persoon, de rest volgens `split`, tot op de cent), naar wie een overdracht gaat telt het af. Wie moet wie telt de
  saldo's van alle lijsten met een saldo die je ziet samen (`balanceOf`, `settleUp`); Terugbetaald logt een overdracht in
  zo'n lijst. Een nieuwe uitgave in een lijst waar meer mensen loggen, is standaard gelijk verdeeld over hen
  (`defaultSharers`), zoals in Splitwise; eten en een overdracht nooit vanzelf.
- **Eten** (`shared/food.ts`): een formulier dat eet (`formEats`: zonder geld, en het trekt af van de voorraad of heeft
  kcal) met kcal (in het formulier, of uit een ding met kcal per 100 g × gram van de lijnen die eraf gaan; `isFood`).
- **Berekeningen** (veldsoort `calc`, `shared/calc.ts`) enkel binnen het ding; geen verwijzende berekeningen meer.
- Een **logboek als tabel** (`shared/logview.ts`: `logFields`, `logItem`) zodat filters, weergaven
  (`shared/views.ts`) en grafieken (`shared/charts.ts`) ook op gebeurtenissen werken.

### Eén ingang

- **Palet** (`CommandPalette`, `GET /me/targets`, `shared/targets.ts`): zoeken en toevoegen; de + is voor wat er
  gebeurde, in drie groepen: **Loggen** (formulieren; noemt je tekst een ding, dan "Uit eten · Het Forum" met dat ding
  als lijn), **Nieuw** (een ding in een lijst) en **Openen**. De rest van de tekst gaat als `?tekst=` naar het
  formulier. Op een lijst opent de + hetzelfde palet, enkel voor die lijst (`PaletteScope`). **Stap voor stap**
  (`shared/steps.ts`, getest): na "Uit eten · Het Forum" of Nieuw vul je veld na veld in het palet in, met suggesties;
  leeg is overslaan, na het laatste bewaar je (`eventBody`, `thingBody`: zoals het formulier, met de gelijke verdeling)
  met Ongedaan maken; Alles invullen opent het formulier met wat er al staat (`prefillOf`, `?vooraf=`). Een
  foto bij de + gaat mee naar het gekozen formulier (`putShared`, `?foto=gedeeld`, `&lezen=1`).
- **Lijsten tonen** (per persoon, `hidden` in `app_settings`, `PUT /me/hidden`): niet in het menu of niet bij de +; in
  het menu ook een hele tag (haar groep, schakelaar op de tagpagina). Je volgorde van de tags staat in `tag_order`
  (`orderTags`, `PUT /me/tag-order`, Lijsten → Volgorde);
  zoeken, Verbanden en keuzelijsten tonen ze altijd. Een **tag** toont al de dingen van haar lijsten samen
  (`tagView` in `shared/blocks.ts`, getest: zoeken, de gedeelde kolommen en rechts de lijst; alle wijnen over Wijnen,
  Geproefd en de gedeelde kelder); een weergave over meer lijsten heeft daarvoor de kolom Lijst (`LIST_KEY`). Alles op één plek: **Lijsten** (`/lijsten`, `ListsPage`): één pagina met je lijsten per tag (de naam opent de lijst,
  ▸ toont haar verbanden), wie erbij is, per lijst Menu, Toevoegen en Meldingen (stilzetten, `mutedBy` in
  `shared/apps.ts`), je volgorde, en op tablet ook de kaart.
- **Typ wat je weet** (`shared/parse.ts`, getest): tekst live naar de gebeurtenis (datum, uur, bedrag, dingen met
  hoeveelheid en prijs, velden van de soort); enkel wat de tekst zette verandert mee. Dingen komen van
  `GET /things?in=` (met `usual`: de rol die ze meestal hebben, Colruyt = bij).
- **Waarmee je logt** (`logForms`, getest; `LogButtons` op een ding en bovenaan het logboek, en in het palet): de eigen
  formulieren van de lijst en, telt ze voorraad, de formulieren die de voorraad veranderen van lijsten die zelf geen
  voorraad tellen (Aankoop in Uitgaven, Boodschap, Gegeten). Een aankoop logt in de lijst van wie meebetaalt (Uitgaven = met Jana), de
  lijnen bepalen welke voorraad stijgt (Chablis in Wijnen); een kasticket gaat naar een lijst met een eigen aankoop
  (`receiptLists`). Een formulier van elders krijgt `?nieuw=<lijst>` (`logPath`): iets nieuws dat erbij komt (een wijn
  die er nog niet staat) staat dan standaard op Nieuw in die lijst (`defaultNew` in `LinesEditor`), niet bij gepland;
  noemt Typ wat je weet dan geen ding dat erbij komt, dan wordt de rest van de tekst zo'n nieuwe lijn, niet de omschrijving.
- **De AI is altijd zichtbaar**: elke knop die ze gebruikt draagt ✨ (`AiMark`), ze start nooit vanzelf (enkel na een
  tik of de schakelaar Lezen met AI in de fotokiezer, `PhotoButton`), per persoon aan of uit (`useAiBudget`: 25 per
  persoon per dag, 50 samen). Welke formulieren een foto lezen: per lijst (`lists.read_photo`, `shared/photoread.ts`;
  standaard dingen, soorten met geld of voedingswaarden). Een foto lezen voor een gebeurtenis
  (`POST /lists/:id/events/read-photo` met de soort): een aankoop is een kasticket (`shared/receipt.ts`): één aankoop
  met een lijn per product, koppelt enkel aan dingen die de lezer ziet, bewaart niets; een soort met voedingswaarden
  herkent een gerecht en schat (dat zegt de app); een andere soort vult haar velden met wat er echt staat. Van een
  kasticket wordt de naam op het ticket onthouden (`POST /things/:id/alias`, een tekstveld met `aliases`; een nieuw ding
  met een andere naam krijgt hem bij het maken, `new_thing.alias`): Go-tan wok wordt de volgende keer vanzelf Noedels. Een ding van een foto (`POST /lists/:id/things/read-photo`) of barcode (Open Food Facts,
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
  (formulier, meteen bewaren met Ongedaan maken, tellen, timer); formulier en bewaren kunnen ook gepland (`planned`,
  `canPlan`: een boodschap, iets te doen). Geen vaste blokken of voorbeelden; oude blokken
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
- **Toevoegen uit andere lijst** (`shared/transfer.ts`, getest; `FromListPage`): dingen uit een bron met voorwaarden
  (zoals een weergave), per veld een veld van de bron, een vaste waarde of een verwijzing naar het origineel, keuzes
  vertaald. Drie manieren (`TRANSFER_MODES`): kopiëren en verplaatsen (het ding zelf, dezelfde id) zijn eenmalig
  (`POST /lists/:id/things/from`); **koppelen** is blijvend (`mirrors`, `things.mirror_id`/`mirror_of`,
  `PUT|DELETE /lists/:id/mirrors/:bron`): `worker/mirrors.ts` werkt de doellijst bij na elke wijziging aan de dingen of
  velden van een lijst (`syncFrom`, ook langs koppelingen na elkaar) en elk kwartier (`syncAll`), met de rechten die
  wie koppelde nu heeft (beheerder van beide, anders staat ze stil), zonder kringen (`makesCycle`). Een gekoppeld ding
  is een eigen ding; de naam en de gekoppelde velden volgen de bron (`syncChanges`, `linkedKeys`) en zijn in de
  doellijst niet te wijzigen of te verwijderen; wat niet meer voldoet, gaat naar het archief. De server rekent elk plan
  opnieuw uit (`cleanPlan`) en elke waarde gaat door `prepareData`.
- **Sjablonen** (`shared/catalog.ts`): enkel Lege lijst, Uitgaven (Splitwise: een rij per persoon met een saldo,
  Aankoop en Terugbetaling) en Dieet (Yazio), zo eenvoudig mogelijk;
  geen sjabloon per geval. **Sjabloon delen** (`shared/template-file.ts`, Uit bestand): de opbouw van een lijst (ook
  wie een melding krijgt), zonder dingen of mensen.
- De oude tabellen (projecten, items, …) staan er nog maar worden niet meer gebruikt; ze gaan weg in een latere
  migratie.
- **Offline** (`sw/sw.js`): de service worker bewaart wat je eerder bekeek voor de GET-routes in `OFFLINE_API` (jij, borden
  en weergaven, een lijst met dingen en logboek, een ding, een gebeurtenis, wat een formulier nodig heeft); wat je dan
  bewaart, wacht in `src/outbox.ts`. Een nieuw scherm dat offline moet openen, zet zijn route daar (`test/sw.test.ts`
  kijkt na dat elk patroon een echte route is). Verander je de routes, geef `DATA_CACHE` dan een nieuwe naam.
- Bewaar nooit een wachtwoord, enkel bv. een klantnummer en waarmee je aanmeldt.
- Schemawijziging = nieuw bestand in `migrations/` (nooit een bestaand aanpassen); eerst lokaal testen met
  `npm run db:migrate:local`. Een push naar `main` rolt uit en voert de migratie online uit (een andere tak rolt
  nooit uit: `scripts/only-main.mjs`).
- Gedeelde types en logica in `shared/`, met tests in `test/` (`npm test`).
- Controle voor oplevering: `npx tsc -b`, `npm test`, `npm run build`.
