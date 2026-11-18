# Heystack: werkafspraken

Heystack (het repo, de Worker en de databank heten nog `thuis`) is onze app op Cloudflare (Workers, D1, R2): lijsten met items,
formulieren met een logboek, mensen per lijst en per formulier, tags om te groeperen. Alles in het Nederlands (Vlaams, "je"): code-commentaar, teksten, commits en uitleg.

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
  elke lijst, formulier, gebeurtenis of blok werkt (zoals `planned` op een actie, niet een knop Boodschap). Het geval
  zelf is dan instellen of gegevens, geen code. Nooit een lijst, formulier, persoon of id in de code.
- Navigeren altijd met `Link`, `NavLink` en `useNavigate` uit `src/router.tsx` (vloeiende schermwissels), nooit
  rechtstreeks uit `react-router`. Een nieuw scherm komt in `src/routes.tsx`.
- Bedragen in cent, datums als `YYYY-MM-DD` (een tijdstip `YYYY-MM-DDTHH:MM`, tijd in België). Opmaak via `src/format.ts`.

### Het model (`shared/model.ts`, `migrations/0029_lijsten.sql`, `0037_formulieren_los.sql`)

- Er zijn **lijsten** (`lists`) en **formulieren** (`kinds`; in de code soms nog "soort"), los van elkaar. Een lijst
  heeft **items** (`items`, allemaal met dezelfde velden: `fields`; `one` = hoe één item heet, altijd ingevuld),
  **mensen** (`list_people`) en **tags** (`list_tags`, `list_tag_links`). Een formulier heeft zijn eigen **mensen**
  (`form_people`, dezelfde rollen), **tags** (`form_tag_links`, dezelfde tags), een melding (`notify`), of het een foto
  leest (`reads`) en een **logboek**: alles wat ermee gelogd werd (**gebeurtenissen**, `events.kind`; een gebeurtenis
  hoort bij geen lijst). Het logboek van een lijst is wat haar items raakte: een lijn of een veranderde cel
  (`touchesLists` in `worker/events-view.ts`). Geen projecten, geen lijsten in lijsten: tags groeperen (lijsten én
  formulieren), een lijst kan meer tags hebben. Wie de gebruiker leest, zegt "lijst", "item", "formulier" en "logboek"
  (het woord "soort" staat nergens in de interface). Een formulier staat op `/formulieren/:id` (logboek, Loggen,
  Instellen: `FormSettings`), loggen op `/loggen?formulier=…`; het menu heeft onder Formulieren je formulieren.
- Een formulier is velden plus
  **onderdelen** (`parts`: `money` = bedrag, wie betaalde, verdeling en een prijs per lijn; `to` = naar iemand, een
  overdracht; `duration` = een einde, een activiteit of timer; `groups` = zijn **groepen lijnen** met een naam en de
  lijsten waaruit ze kiezen, `lists` (leeg: uit elke lijst; van vroeger één `list`): Wat, Waar, "Ruimte uit Huis", "Fles
  uit Wijnen of de Gedeelde wijnkelder") plus **handelingen** (`does`, zie Cellen). Er is geen "Werkt als"
  meer: de zes **vertrekpunten** (`BASES`: aankoop, gebruik, dienst, activiteit, meting, overdracht, met `baseParts` en
  `presetDoes`) zijn enkel waar een nieuw formulier mee begint. Een formulier zonder eigen onderdelen (`parts` NULL) volgt
  zijn vertrekpunt (`kindInfo`). **De code vraagt nooit "is dit
  een aankoop?"** maar wat het formulier vraagt of doet: `parts.money`, `parts.duration`, `buysWith` (kasticket,
  afvinken), `movesStock`, `formEats`, `stockOp`. Wat een formulier invult, zeggen zijn groepen en handelingen
  (`fillsLists`); kiezen gebeurt in `FormPicker`: de formulieren die de lijst invullen, de rest onder Ander formulier
  (`formsOf`). Twee formulieren voeg je samen in Instellen (`POST /forms/:id/merge`, `mergeKinds`: het logboek, de
  mensen, de tags, de velden, groepen en handelingen komen bij het ene, het andere verdwijnt). **Lijnen** (`lines`) staan in de groep van hun rol
  (`in`, `uit`, `voor`, `bij`; `bij` = waar of bij wie, enkel met de hele gebeurtenis te zien), naar een item of als
  tekst, met hoeveel, eenheid, prijs, houdbaar tot en eventueel `owner` (enkel van die persoon); wat een lijn doet,
  zeggen de handelingen, niet haar rol. Een groep met lijsten kiest enkel daaruit (de server kijkt het na). Status:
  `gebeurd`, `gepland` (te doen, boodschappen), `afgevinkt` (een boodschap die gekocht is: telt niet mee). Een formulier
  kan gepland beginnen (`kinds.planned`, `startsPlanned`, `actionPlans`): zo is Boodschap een formulier dat op Gepland
  opent.
- Kastickets, boodschappen en eten zijn **geen lijsten** maar gebeurtenissen (Uitgaven is een lijst met een rij per
  persoon, zie Geld). Er zijn ook geen vaste
  pagina's (Geld, Voorraad, Eten, Te doen, Agenda): dat zijn **borden** met weergaven (bronnen: logboek, items,
  voorraad, saldo, voeding, datums; uitgerekend in `worker/routes/insights.ts`, `GET /insights/view`). Je borden staan
  met naam en icoon in het menu, in jouw volgorde (`placesOf`: `/` en `/bord/:id`; ⋯ → Volgorde); Alle lijsten staat niet
  tussen de borden maar bovenaan de lijsten (`LINKS_PLACE`: `/lijsten`, je lijsten en hun verbanden).
- Items houden bij het overzetten de id van hun oude item (foto's in R2: `items/{id}/photo`); een gebeurtenis
  gebruikt `events/{id}/photo` (`worker/media.ts`).

### Rechten (`shared/rights.ts`, `worker/access.ts`)

- Vaste rollen per lijst en per formulier: **beheerder** (instellen, mensen), **lid** (items toevoegen of ermee loggen),
  **gast** (kijken), en rechtstreeks **geen** (een uitzondering). Er zijn geen rechten per veld. Mensen en tags van
  beide gaan door `worker/members.ts`; wie je bij een lijst zet, komt ook bij de formulieren die ze invullen en die jij
  beheert (`addPerson`).
- Een **regel op een tag** (`tag_rules`, "Jana altijd beheerder bij Huis") geeft een rol op elke lijst en elk formulier
  met die tag, maar enkel waar wie de regel maakte zelf rechtstreeks beheerder is; wie een tag zet, ziet wie er zo bij
  komt; een rechtstreekse rij wint, ook `geen`. Uitgerekend in één vraag: `seenLists`, `seenForms`, samen `seenAll`.
- Elke route haalt eerst de toegang op: `requireList`, `requireItem`, `requireForm` (geen toegang = 404 "niet
  gevonden"), daarna `needEdit` of `needManage`. Bij twijfel: weigeren. Er blijft altijd een rechtstreekse beheerder
  (`keepsAdmin`).
- **Gebeurtenissen zien** (`eventRole` in `shared/rights.ts`, getest; de geraakte lijsten met `touchedLists`): raakt
  een gebeurtenis lijsten (een lijn `in`/`uit`/`voor` naar een item, of een cel die ze veranderde), dan zie je ze
  helemaal als je het formulier ziet én minstens één van die lijsten; raakt ze geen lijst (Sport), dan volgt ze het
  formulier. Wat Jaan uit zijn eigen Wijnen dronk, ziet Rik dus niet, ook al loggen ze met hetzelfde Gedronken; een
  aankoop die het saldo in Uitgaven raakt, ziet Jana wel. Een Aanpassing: wie de lijst van haar item ziet. Zie je het
  formulier niet, dan zie je enkel de lijnen en cellen van lijsten die je ziet (in het logboek van die lijst, als
  "gedeeltelijk": zonder bedrag, naam of andere lijnen); een lijn `bij` enkel met de hele gebeurtenis (anders ziet Jana
  via Dr. Peeters het doktersbezoek van Jaan). Dezelfde regel geldt voor meldingen en herinneringen. Zie `lineVisible`,
  `viewEvents`.
- Velden van een item of formulier gaan altijd door `prepareData` (`worker/prepare.ts`): `cleanAttributes`, enkel gekende
  personen, verwijzingen enkel naar items die de bewerker ziet. Lijstvelden door `cleanListFields`
  (`shared/listdef.ts`).

### Wat afgeleid wordt (nooit bewaard)

- **Cellen** (`shared/cells.ts`, `worker/cells.ts`, getest): een formulier zegt wat het doet met de kolommen van de
  items in zijn lijnen (`kinds.does`, handelingen in "Wat het doet": welke lijn, welke kolom, **Zet op**, **Tel bij**
  of **Tel af**, met een veld, de datum, het bedrag, hoeveel of de prijs, of een vaste waarde). Schilderwerk zet de
  Kleur van de Ruimte; een Tankbeurt zet de Km-stand. Wat een gebeurtenis zo doet, staat in `effects` (afgeleid: bij
  elk bewaren uitgerekend met `rebuildEffects`, opnieuw voor alle gebeurtenissen van een formulier dat verandert, en
  helemaal opnieuw als `EFFECTS_VERSION` verandert). De waarde van een cel is wat in het item stond of de laatste Zet,
  plus wat er daarna bij en af ging, in volgorde van de datum en enkel `gebeurd` (`foldCell`); ze komt bij het lezen
  in de waarden van het item (`withCells`: lijst, fiche, weergaven, agenda, herinneringen, koppelingen). Een cel die
  het logboek invult en die je in het item aanpast, wordt een **Aanpassing** (`ADJUST`: een gebeurtenis die zet). Wie
  bewaart, moet de lijst van wat het formulier invult mogen wijzigen (`touchesCell`). **Een nieuwe plek die
  gebeurtenissen of lijnen schrijft, roept `rebuildEffects` op.**
- **Voorraad** (`shared/stock.ts`, `stock` op een lijst): een cel (`STOCK`) zoals de andere: een aankoop telt bij,
  gebruik telt af en een telling (een meting `voor` het item) zet (`presetDoes`), enkel `gebeurd`, omgerekend met
  `convert` (`shared/units.ts`: kg/g/l/ml/stuk, een verpakking). Bijna op onder het minimum; zonder minimum enkel in een
  lijst met een minimumveld en als er ooit iets was.
- **Geld** (`shared/ledger.ts`, `shared/cells.ts`): ook een cel. Een lijst met een **saldo per persoon** (`ledger`:
  welke kolom de persoon is en welke het saldo; Instellen → Tellen) heeft een rij per persoon; ontbreekt die, dan maakt
  `rebuildEffects` ze. Handelingen op personen (`rows`: `payer`, `sharers`, `to`; `BALANCE` = het saldo, altijd in een
  gekozen lijst met een saldo per persoon): wie betaalde telt het bedrag bij, wie deelt zijn deel af (`sharesOf`: lijnen
  met `owner` zijn van die persoon, de rest volgens `split`, tot op de cent), naar wie een overdracht gaat telt het af.
  Wie moet wie telt de saldo's van alle lijsten met een saldo die je ziet samen (`balanceOf`, `settleUp`); Terugbetaald
  logt een overdracht met een formulier dat het saldo van zo'n lijst bijhoudt (`POST /lists/:id/settle-form` zoekt of
  maakt Terugbetaling). Een nieuwe uitgave met een formulier waarmee meer mensen loggen, is standaard gelijk verdeeld
  over hen (`defaultSharers`), zoals in Splitwise; eten en een overdracht nooit vanzelf.
- **Eten** (`shared/food.ts`): een formulier dat eet (`formEats`: zonder geld, en het trekt af van de voorraad of heeft
  kcal) met kcal (in het formulier, of uit een item met kcal per 100 g × gram van de lijnen die eraf gaan; `isFood`).
- **Berekeningen** (veldsoort `calc`, `shared/calc.ts`) enkel binnen het item; geen verwijzende berekeningen meer.
- Een **logboek als tabel** (`shared/logview.ts`: `logFields`, `logItem`) zodat filters, weergaven
  (`shared/views.ts`) en grafieken (`shared/charts.ts`) ook op gebeurtenissen werken.
- **De items als tabel** (`ItemsView`, `shared/views.ts`, getest): filteren op elk veld (ook een getal tussen twee
  waarden en datums: vandaag, gisteren, eergisteren, morgen, overmorgen, deze/vorige/volgende week, maand, kwartaal of
  jaar, de laatste of komende … dagen/weken/maanden/jaren, … geleden, langer dan … geleden, op een datum, tussen twee
  datums; `PERIODS`, `PERIOD_UNITS`, `periodRange`), sorteren op een kolomkop of op meer kolommen na elkaar (Filters),
  kolommen tonen, verbergen en ordenen (`ColumnsEditor`, de pil Kolommen; met veel kolommen scrolt de tabel opzij),
  groeperen, als agenda, en dat bewaren als weergave.

### Eén ingang

- **Palet** (`CommandPalette`, `GET /me/targets`, `shared/targets.ts`): zoeken en toevoegen; de + is voor wat er
  gebeurde, in drie groepen: **Loggen** (formulieren; noemt je tekst een item, dan "Uit eten · Het Forum" met dat item
  als lijn), **Nieuw** (een item in een lijst, of een nieuwe lijst of formulier) en **Openen** (ook formulieren). De rest
  van de tekst gaat als `?tekst=` naar het formulier. Op een lijst opent de + hetzelfde palet, enkel voor die lijst (`PaletteScope`). **Stap voor stap**
  (`shared/steps.ts`, getest): na "Uit eten · Het Forum" of Nieuw vul je veld na veld in het palet in, met suggesties;
  leeg is overslaan, na het laatste bewaar je (`eventBody`, `itemBody`: zoals het formulier, met de gelijke verdeling)
  met Ongedaan maken; Alles invullen opent het formulier met wat er al staat (`prefillOf`, `?vooraf=`). Een
  foto bij de + gaat mee naar het gekozen formulier (`putShared`, `?foto=gedeeld`, `&lezen=1`).
- **Lijsten tonen** (per persoon, `hidden` in `app_settings`, `PUT /me/hidden`): niet in het menu of niet bij de +; in
  het menu ook een hele tag (haar groep, schakelaar op de tagpagina). Je volgorde van de tags staat in `tag_order`
  (`orderTags`, `PUT /me/tag-order`, Lijsten → Volgorde);
  zoeken, Verbanden en keuzelijsten tonen ze altijd. Een **tag** toont al de items van haar lijsten samen
  (`tagView` in `shared/blocks.ts`, getest: zoeken, de gedeelde kolommen en rechts de lijst; alle wijnen over Wijnen,
  Geproefd en de gedeelde kelder); een weergave over meer lijsten heeft daarvoor de kolom Lijst (`LIST_KEY`). Alles op één plek: **Lijsten** (`/lijsten`, `ListsPage`): één pagina met je lijsten per tag (de naam opent de lijst,
  ▸ toont haar verbanden), wie erbij is, per lijst Menu en Toevoegen, je volgorde, en op tablet ook de kaart.
  Meldingen zet je per formulier stil (⋯ van het formulier, `mutedBy` in `shared/apps.ts`) of per tag.
- **Typ wat je weet** (`shared/parse.ts`, getest): tekst live naar de gebeurtenis (datum, uur, bedrag, items met
  hoeveelheid en prijs, velden van het formulier); enkel wat de tekst zette verandert mee. Items komen van
  `GET /items?in=` (met `usual`: de rol die ze meestal hebben, Colruyt = bij).
- **Waarmee je logt** (`logForms`, getest; `LogButtons` op een item en bovenaan het logboek, en in het palet): de
  formulieren die de lijst uitdrukkelijk invullen eerst en, telt ze voorraad, de formulieren die de voorraad veranderen
  (Aankoop, Boodschap, Gegeten). Een aankoop houdt het saldo bij in Uitgaven (een handeling), de lijnen bepalen welke
  voorraad stijgt (Chablis in Wijnen); een kasticket gaat naar een formulier dat koopt (`receiptForms`). Vanuit een
  lijst krijgt het formulier `?nieuw=<lijst>` (`logPath`): iets nieuws dat erbij komt (een wijn die er nog niet staat)
  staat dan standaard op Nieuw in die lijst (`defaultNew` in `LinesEditor`), niet bij gepland; noemt Typ wat je weet dan
  geen item dat erbij komt, dan wordt de rest van de tekst zo'n nieuwe lijn, niet de omschrijving. Het oude adres
  `/lijsten/:id/loggen?soort=` stuurt door naar `/loggen?formulier=…&nieuw=…`.
- **De AI is altijd zichtbaar**: elke knop die ze gebruikt draagt ✨ (`AiMark`), ze start nooit vanzelf (enkel na een
  tik of de schakelaar Lezen met AI in de fotokiezer, `PhotoButton`), per persoon aan of uit (`useAiBudget`: 25 per
  persoon per dag, 50 samen). Of een foto gelezen wordt: per formulier (`kinds.reads`, `formReads`) en per lijst voor
  een nieuw item (`lists.read_photo`, `shared/photoread.ts`); standaard items en formulieren met geld of
  voedingswaarden. Een foto lezen voor een gebeurtenis (`POST /forms/:id/read-photo`): een formulier dat koopt leest
  een kasticket (`shared/receipt.ts`): één aankoop met een lijn per product, koppelt enkel aan items die de lezer ziet,
  bewaart niets; een formulier met voedingswaarden herkent een gerecht en schat (dat zegt de app); een ander vult zijn
  velden met wat er echt staat. Van een
  kasticket wordt de naam op het ticket onthouden (`POST /items/:id/alias`, een tekstveld met `aliases`; een nieuw item
  met een andere naam krijgt hem bij het maken, `new_item.alias`): Go-tan wok wordt de volgende keer vanzelf Noedels. Een item van een foto (`POST /lists/:id/items/read-photo`) of barcode (Open Food Facts,
  zonder AI); de app toont altijd of iets uit een databank komt of geschat is.
- **Productinfo**: Open Food Facts krijgt enkel een barcode of productnaam, nooit iets van de gebruiker; NEVO
  (`shared/nevo.ts`, `nevoMatch` op hoofdwoord en synoniemen) zonder netwerk, met `nevoCredit`. NEVO staat in D1
  (`nevo_foods`), **nooit in git** (het repo is publiek, de gegevens zijn van het RIVM): `node scripts/nevo.mjs
  data/<bestand>.csv <versie>` maakt `data/nevo.sql` (data/ staat in .gitignore), dat je lokaal en online uitvoert.

### De rest

- **Herhalen en herinneren** (`worker/cron.ts`, elk kwartier): een gebeurde gebeurtenis met `repeat` krijgt kopieën tot
  vandaag met de rechten die wie ze maakte nu heeft (stopt als dat niet meer mag); een geplande met `repeat` maakt de
  volgende bij afvinken. Om 7 u herinneringen voor datums van items en wat vandaag gepland staat. Een timer is een
  activiteit zonder einde (`POST /events/:id/stop`, `kinds.goal` voor een melding).
- **Melding bij iets nieuws** (`shared/alerts.ts`, `notify` op een formulier, `worker/notify-events.ts`): aan iedereen
  die het formulier ziet of aan wie in de verdeling staat; nooit aan wie het logde of wie het formulier of een tag ervan
  stilzette.
- **Overzicht** (`shared/board.ts`, `shared/blocks.ts`): borden (naam, icoon) met blokken van twee soorten. Een **weergave** is een
  zin: bron (logboek, items, voorraad, saldo's, voeding, alles met een datum) + lijsten + voorwaarden (`ViewDef`) +
  tellen (`Tally`) + één van elf vormen (`SHOWS`, ook Agenda) + voorwaarden op wat je ziet (`Rule`: een rij kleuren, bovenaan, verbergen; het blok
  verbergen als er niets is; de uitkomst kleuren). De server rekent ze uit met de rechten van de lezer
  (`GET /insights/view`, `evaluateView`); met een periode blader je (`viewSpan`, `?periode=`), een agenda per maand.
  Een **actie** logt: een formulier (`actionForm`; van vroeger een lijst met een vertrekpunt), vooraf ingevulde velden en wat een tik doet
  (formulier, meteen bewaren met Ongedaan maken, tellen, timer); formulier en bewaren kunnen ook gepland (`planned`,
  `canPlan`: een boodschap, iets te doen). Geen vaste blokken of voorbeelden; oude blokken
  (todo, money, stock, quick, chart, …) worden bij het lezen een gelijke zin (`upgradeBlock`). Automatisaties (iets
  dat zelf handelt) zijn voor later. Opstarten blijft licht: elk blok haalt zijn eigen inhoud.
- **App** (`shared/apps.ts`): eigen apps, snelkoppelingen (een bord, een lijst, loggen met een formulier, een nieuw
  item), wat een gedeelde foto doet (een kasticket met een formulier dat koopt); enkel naar wat je bereikt
  (`keepReachable`, dat ook een bestemming van vroeger omzet met `legacyForm`).
- **Verbanden** (`shared/links.ts`, `GET /insights/links`, op `/lijsten`: Lijst of Kaart): hoe je lijsten samenhangen
  (verwijzingen, met welke items, de weergaven), met de formulieren als eigen punten (`formNode`: `form:<id>`, op de
  kaart in de kolom Formulieren, in de lijst een groep; een spoor naar elke lijst die een formulier invult of met lijnen
  raakt), enkel wat de lezer ziet, met wat voor iemand niet werkt. Zoeken (`searchLinks`), groeperen, sorteren en selecteren (`betweenSelection`) zitten in `shared/links.ts`
  (getest); de keuze staat in het adres (`?lijst=`, `?keuze=`, `?groep=`, `?sort=`). **Een nieuwe
  eigenschap van een veld, lijst, formulier, gebeurtenis, lijn of blok beslis je in de `…_LINKS`-tabellen** (TypeScript
  dwingt het af; wat verbindt, krijgt een voorbeeld in `test/links.test.ts`).
- **Back-up** (`shared/backup.ts`, `worker/routes/backup.ts`, versie 4): de lijsten en formulieren die je beheert (met
  het logboek van die formulieren en de Aanpassingen in die lijsten); terugzetten maakt altijd een nieuwe kopie en kijkt
  alles na; een back-up van vroeger wordt bij het lezen omgezet (`fromV2`, `fromV3`, zoals de migraties). **Een nieuwe tabel of kolom neem je mee in de back-up** (of zeg in `BACKUP_TABLES`
  waarom niet; `test/backup.test.ts` leest de migraties na).
- **Toevoegen uit andere lijst** (`shared/transfer.ts`, getest; `FromListPage`): items uit een bron met voorwaarden
  (zoals een weergave), per veld een veld van de bron, een vaste waarde of een verwijzing naar het origineel, keuzes
  vertaald. Drie manieren (`TRANSFER_MODES`): kopiëren en verplaatsen (het item zelf, dezelfde id) zijn eenmalig
  (`POST /lists/:id/items/from`); **koppelen** is blijvend (`mirrors`, `items.mirror_id`/`mirror_of`,
  `PUT|DELETE /lists/:id/mirrors/:bron`): `worker/mirrors.ts` werkt de doellijst bij na elke wijziging aan de items of
  velden van een lijst (`syncFrom`, ook langs koppelingen na elkaar) en elk kwartier (`syncAll`), met de rechten die
  wie koppelde nu heeft (beheerder van beide, anders staat ze stil), zonder kringen (`makesCycle`). Een gekoppeld item
  is een eigen item; de naam en de gekoppelde velden volgen de bron (`syncChanges`, `linkedKeys`) en zijn in de
  doellijst niet te wijzigen of te verwijderen; wat niet meer voldoet, gaat naar het archief. De server rekent elk plan
  opnieuw uit (`cleanPlan`) en elke waarde gaat door `prepareData`.
- **Sjablonen** (`shared/catalog.ts`): enkel Lege lijst, Uitgaven (Splitwise: een rij per persoon met een saldo,
  Aankoop en Terugbetaling die het saldo bijhouden) en Dieet (Yazio: enkel de formulieren Gegeten en Gewicht), zo
  eenvoudig mogelijk; geen sjabloon per geval. De formulieren van een sjabloon zijn gewone formulieren (jij beheerder,
  de tags van de lijst). **Sjabloon delen** (`shared/template-file.ts`, Uit bestand): de opbouw van een lijst met de
  formulieren die haar invullen (ook wie een melding krijgt), zonder items of mensen.
- **Offline** (`sw/sw.js`): de service worker bewaart wat je eerder bekeek voor de GET-routes in `OFFLINE_API` (jij, borden
  en weergaven, een lijst met items en logboek, een formulier met zijn logboek, een item, een gebeurtenis, wat loggen
  nodig heeft); wat je dan
  bewaart, wacht in `src/outbox.ts`. Een nieuw scherm dat offline moet openen, zet zijn route daar (`test/sw.test.ts`
  kijkt na dat elk patroon een echte route is). Verander je de routes, geef `DATA_CACHE` dan een nieuwe naam.
- Bewaar nooit een wachtwoord, enkel bv. een klantnummer en waarmee je aanmeldt.
- Schemawijziging = nieuw bestand in `migrations/` (nooit een bestaand aanpassen); eerst lokaal testen met
  `npm run db:migrate:local`. Een push naar `main` rolt uit en voert de migratie online uit (een andere tak rolt
  nooit uit: `scripts/only-main.mjs`).
- Gedeelde types en logica in `shared/`, met tests in `test/` (`npm test`).
- Controle voor oplevering: `npx tsc -b`, `npm test`, `npm run build`.
