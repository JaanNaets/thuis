# Thuis

Onze eigen app voor thuis, volledig op Cloudflare. Ze is volledig **generiek**: je bouwt zelf wat je wil bijhouden.

- **Projecten** en subprojecten: "Huishouden" is gewoon een project, met daaronder bv. "Wijnkelder" en "Fietsen".
- **Mensen met een rol** per project: wat ze mogen zien en wijzigen, tot op het niveau van één veld.
- **Lijsten** met eigen velden (Wijnen met jaargang en druiven, Klantenkaarten met een barcode), ook velden die de
  app zelf uitrekent (de waarde van je kelder, wanneer het volgende onderhoud is, een eigen formule).
- **Totalen** op een lijst: de som, het gemiddelde of het aantal, per dag, week, maand of jaar, met een doel (de kcal
  van vandaag, wat je deze maand uitgaf).
- **Items** in een lijst, met tags, een foto, bestanden en een logboek.

Regels voor een bepaalde use case (kosten verdelen, voorraad, calorieën, klantenkaarten offline, kastickets lezen)
komen er bovenop: als sjabloon met deze bouwstenen, of als eigen onderdeel.

Werkt op de gsm (mobile first, installeerbaar als app) en op een tablet in kioskmodus.

## Hoe het in elkaar zit

```
src/         React-app (wat je op het scherm ziet)
worker/      API op Cloudflare Workers (Hono)
shared/      Types en logica die app en API allebei gebruiken (velden, berekeningen, rechten, sjablonen)
migrations/  Databaseschema (D1), één SQL-bestand per wijziging
sw/          Service worker: de app opent ook zonder internet
STIJLBOEK.md Hoe de app eruitziet en aanvoelt: lees dit voor je iets bouwt
```

| Onderdeel      | Cloudflare-dienst                                     |
| -------------- | ----------------------------------------------------- |
| App + API      | Workers (één Worker, statische bestanden + `/api/*`)  |
| Gegevens       | D1 `huishouden-db`                                    |
| Foto's en bestanden | R2 `huishouden-bestanden`                        |
| Aanmelden      | Cloudflare Access                                     |

## 1. Lokaal draaien

Je hebt [Node.js](https://nodejs.org) 20 of nieuwer nodig.

1. Afhankelijkheden installeren:
   ```sh
   npm install
   ```
2. Lokale instellingen aanmaken. Lokaal is er geen Access, dus je geeft zelf op wie "aangemeld" is:
   ```sh
   cp .dev.vars.example .dev.vars
   ```
   Zet in `.dev.vars` je eigen e-mailadres bij `DEV_USER`.
3. De lokale database aanmaken:
   ```sh
   npm run db:migrate:local
   ```
4. Starten:
   ```sh
   npm run dev
   ```
   Open http://localhost:5173. Alles (database en bestanden) draait lokaal en raakt je echte gegevens niet.
   Als iemand anders testen: stuur de header `X-Dev-User: ander@example.com` mee (werkt enkel lokaal).
5. Tests draaien (velden, importeren, rechten):
   ```sh
   npm test
   ```

Een etiket lezen gebeurt met Workers AI, en dat draait altijd bij Cloudflare. Met gewoon `npm run dev` werkt
dat niet. Wil je dat lokaal ook testen, gebruik dan `npx wrangler login` en daarna `npm run dev:ai`.

## 2. Online zetten

De database en de opslag bestaan al in je Cloudflare-account. Je moet de app alleen nog uitrollen.

### Aanbevolen: automatisch bij elke push (Workers Builds)

1. Ga in het Cloudflare-dashboard naar **Workers & Pages** → **Create** → **Import a repository**.
2. Kies de GitHub-repo `thuis`. Staat ze er niet tussen? Dan heeft de Cloudflare-app op GitHub enkel
   toegang tot andere repo's. Ga naar https://github.com/settings/installations → **Cloudflare Workers and
   Pages** → **Configure**, voeg bij **Repository access** de repo `thuis` toe, sla op en herlaad de pagina
   in Cloudflare.
3. Projectnaam: `thuis`. Die moet gelijk zijn aan `name` in `wrangler.jsonc`.
4. **Build command**: leeg laten. **Deploy command**: `npm run deploy`.
5. Klik op **Save and Deploy**.

Vanaf nu wordt elke push naar `main` automatisch uitgerold. `npm run deploy` bouwt de app, past nieuwe
databasemigraties toe en rolt daarna uit.

> Faalt de stap met `d1 migrations apply` op een rechtenfout? Geef het API-token van de build dan ook
> **D1: Edit**-rechten (Worker → Settings → Builds → API token).

### Of: vanaf je eigen computer

```sh
npx wrangler login
npm run deploy
```

Na het uitrollen staat de app op `https://thuis.<jouw-subdomein>.workers.dev`. De API weigert alles
tot je stap 3 gedaan hebt. Dat is bewust: zonder login kan niemand aan je gegevens.

## 3. Aanmelden met Cloudflare Access

Cloudflare Access is de portier vóór de app. Wie de link opent, krijgt eerst een loginscherm, en enkel de
e-mailadressen die je toelaat komen erdoor. De app controleert daarna zelf nog eens of Access de bezoeker
echt binnenliet (`worker/auth.ts`). Daarvoor heeft ze twee gegevens nodig: het **team domain** en de
**AUD-tag**. Zolang die ontbreken, weigert de app elke aanvraag.

### A. Inloggen met een code per e-mail (eenmalig)

1. Open in het Cloudflare-dashboard **Zero Trust** (in het menu links). De eerste keer kies je een
   teamnaam (bv. `naets`) en het gratis plan (tot 50 gebruikers).
2. Ga naar **Integrations** → **Identity providers** → **Add new identity provider** → **One-time PIN**.

   Zo log je in met een code die je per mail krijgt. Wie in de app moet, heeft geen Cloudflare-account nodig.

### B. Access aanzetten op de app

3. Ga naar **Workers & Pages** → `thuis` → **Settings** → **Domains & Routes**. Staat daar geen knop voor
   Access, kijk dan in het tabblad **Access** van de Worker.
4. Klik bij `workers.dev` op **Enable Cloudflare Access**.
5. In het venster dat verschijnt staan twee waarden. Kopieer ze:
   - `TEAM_DOMAIN`, bv. `https://naets.cloudflareaccess.com`
   - `POLICY_AUD`, een lange code van letters en cijfers
6. Klik op **Manage Cloudflare Access**. Kies in de policy voor **Emails**, vul de e-mailadressen van
   iedereen in die de app mag gebruiken in, en sla op.

### C. Langer ingelogd blijven

Standaard moet je elke dag opnieuw inloggen. Voor de kiosk-tablet is dat onwerkbaar.

7. **Zero Trust** → **Access controls** → **Applications** → de app van `thuis` → **Configure** →
   **Session Duration**: 1 month → opslaan.
8. **Zero Trust** → **Access controls** → **Access settings** → **Global session duration**: 1 month.

### D. De app de twee waarden geven

9. Vul ze in `wrangler.jsonc` in bij `vars`:
   ```jsonc
   "vars": {
     "TEAM_DOMAIN": "https://naets.cloudflareaccess.com",
     "POLICY_AUD": "…"
   }
   ```
10. Commit en push. Workers Builds rolt de app daarna vanzelf opnieuw uit.

Venster gemist? Je vindt de waarden ook terug:

- AUD-tag: **Zero Trust** → **Access controls** → **Applications** → de app van `thuis` → **Configure** →
  **Application Audience (AUD) Tag**.
- Team domain: **Zero Trust** → **Settings** → **Team name**. Het team domain is
  `https://<teamnaam>.cloudflareaccess.com`.

### Testen

Open `https://thuis.<jouw-subdomein>.workers.dev`. Je krijgt het loginscherm van Cloudflare, vult je
e-mailadres in, krijgt een code per mail, en komt in de app. Bij **Ik** staat waarmee je aangemeld bent.

Wie de eerste keer aanmeldt, ziet nog geen projecten. Maak er een (bv. "Huishouden" met het sjabloon
Huishouden), en voeg de anderen toe bij **Instellen → Mensen** met het e-mailadres waarmee ze aanmelden.

### Lukt inloggen niet?

Het loginscherm zegt altijd "A code has been emailed", ook als Cloudflare niets verstuurt. Komt er geen
code, controleer dan:

- **De regel in de policy is "Emails", niet "Emails ending in".** Die laatste vergelijkt enkel het domein
  (`outlook.com`), waardoor je eigen adres niet herkend wordt.
- **De login methods van de app:** Zero Trust → Access controls → Applications → de app van `thuis` →
  Configure → Login methods. Daar moet **One-time PIN** aan staan.
- **Outlook.com** houdt de mail soms tegen. Voeg `noreply@notify.cloudflare.com` toe aan je veilige
  afzenders, of gebruik een ander adres (bv. Gmail) dat ook in de policy staat.

## 4. Op je gsm zetten

- **iPhone**: open de app in Safari → deelknop → **Zet op beginscherm**.
- **Android**: open de app in Chrome → ⋮ → **App installeren**.

Open de app één keer met internet. Daarna opent ze ook zonder bereik, maar je gegevens laden pas met
internet. Klantenkaarten offline tonen komt terug als regel bovenop de kern.

## 5. Tablet in kioskmodus

1. Open op de tablet één keer `https://thuis.<jouw-subdomein>.workers.dev/?kiosk=1` en meld je aan.
   Kioskmodus blijft op dat toestel aan (uitzetten met `?kiosk=0`).
2. Vergrendel de tablet op de app:
   - **Android**: [Fully Kiosk Browser](https://www.fully-kiosk.com) met dezelfde URL als startpagina.
     Zet "Keep Screen On" aan en geef toestemming voor de camera (scannen, foto's van etiketten).
   - **iPad**: voeg de app toe aan het beginscherm, open ze, en zet **Begeleide toegang** aan
     (Instellingen → Toegankelijkheid). Drie keer op de zijknop drukken start ze.

In kioskmodus:

- keert de app na 5 minuten zonder aanraking terug naar het startscherm en ververst ze de gegevens;
- worden bestanden in de app zelf geopend, nooit in een nieuw tabblad;
- staat er geen "Aangemeld als" onderaan.

## Hoe het werkt

### Het overzicht

De startpagina toont per project een kaart met zijn lijsten (Wijnen, Klantenkaarten, Voorraad, ...) en hoeveel erin
zit: één tik en je bent er. De volgorde van je projecten sleep je bij **Ik** (dat is per persoon); die van de
subprojecten bij **Instellen → Algemeen**, als je het project instelt. De volgorde van de lijsten (en dus van de tabs
in een project) sleep je bij **Instellen → Lijsten**, die van de velden in het formulier van een lijst.

### Wie betaalde wat

Kosten verdelen is gebouwd uit gewone velden en een **totaal dat verrekent** (zie Totalen); de sjablonen Huishouden
en Gedeelde uitgaven zetten het klaar.

- **Uitgaven**: elke uitgave heeft een bedrag, wie betaalde en een verdeling. Betaald door **begint met jou**, en een
  lege verdeling wordt de gewone verdeling van de lijst (bv. 60/40), of gelijk over iedereen in het project. Een cent
  die niet deelbaar is, draagt wie betaalde. Het totaal: de som van Bedrag apart per Betaald door, tegenover Verdeling.
- **Terugbetalingen**: geld van iemand aan iemand anders (Van tegenover Aan).

Op het project staat dan **Wie moet wie**: zo weinig mogelijk overschrijvingen, met alles uit het project en zijn
subprojecten (en uit lijsten in andere projecten als je die bij het totaal kiest). Heb je het overgeschreven, druk dan op **Terugbetaald** (minder mag ook: dan blijft de rest openstaan).
Is er nog geen lijst Terugbetalingen, dan zet wie het project instelt ze daar met één knop klaar. Wat je niet mag zien
(een lijst, of het bedrag), telt voor jou niet mee.

### Projecten en subprojecten

Een project is een map voor alles wat bij elkaar hoort: "Huishouden", "Wijnkelder", "Verbouwing". Een project kan
subprojecten hebben, zo diep als je wil. Een nieuw project begint met een **sjabloon** (Leeg project, Huishouden, Wijnkelder,
Koersfietsen, Gedeelde uitgaven, Voeding, Verzameling) dat de lijsten met hun velden klaarzet. Daarna kan je alles aanpassen bij **Instellen**.
Losse lijsten (Onderhoud, Abonnementen, Recepten, Reizen, Contacten, Taken, ...) voeg je toe bij **Instellen →
Lijsten → Uit sjabloon**.

### Sjablonen delen

Heb je een project goed ingericht, dan kan je het delen: **Instellen → Algemeen → Delen als sjabloon** bewaart een
bestand (`.thuis.json`) met de lijsten, velden, berekeningen en totalen van het project en zijn subprojecten. Er staan
**geen** items, mensen, rollen, tags of verdelingen in. Eén lijst delen kan ook, onderaan het formulier van die lijst.

Wie het bestand krijgt, kiest bij **Nieuw project → Uit een bestand**, of voegt de lijsten toe aan een bestaand
project bij **Instellen → Lijsten → Uit sjabloon → Uit een bestand**. Verwijst een lijst naar een andere (de wijnen
naar de verkopers) en bestaat die erboven al, dan wordt die gebruikt. De app en de API kijken alles na wat binnenkomt.

### Mensen en rollen

Elk project heeft rollen. Er zijn er drie om mee te beginnen:

| Rol | Mag |
| --- | --- |
| Beheerder | Alles: het project instellen, mensen toevoegen, items toevoegen, wijzigen en verwijderen |
| Lid | Items toevoegen, wijzigen en verwijderen |
| Lezer | Enkel bekijken |

Een rol maak of pas je aan bij **Instellen → Rollen**: per lijst en zelfs per veld kies je **Niet zien**, **Zien**
of **Wijzigen** (bv. een proever die de wijnen ziet maar de aankoopprijs niet). Een rol geldt ook in de
subprojecten, tenzij je iemand daar een andere rol geeft.

Iemand toevoegen doe je bij **Instellen → Mensen**: met een e-mailadres (die persoon meldt later zelf aan; dat
adres moet dan ook in de Access-policy staan), of zonder, voor iemand die nooit aanmeldt maar wel ergens bij
hoort (bv. als eigenaar van een fiets). Er blijft altijd minstens één beheerder over.

### Lijsten en velden

Een lijst heeft een naam ("Wijnen"), een naam voor één item ("Wijn", voor de knop "Wijn toevoegen") en velden. Een
veld kan zijn:

| Groep | Veldsoorten |
| --- | --- |
| Tekst | tekst, lange tekst, webadres, e-mail, telefoon, adres (opent een kaart), barcode of QR-code |
| Getallen en geld | getal (met eenheid), bedrag, score op 5 |
| Datum en tijd | datum, periode van datums (een reis), uur, duur ("1 u 30 min"), jaar, periode van jaren (drinkklaar 2026–2032), herhaling ("elke 6 maanden") |
| Keuzes en lijstjes | keuzelijst, meerdere waarden, ja/nee, takenlijst (afvinken op de fiche) |
| Mensen en verwijzingen | persoon, personen, eigenaars (wie welk deel heeft), verwijzing en verwijzingen naar andere items |
| Berekenen | een berekening (zie hieronder) |

Een veld kan een kolom in de lijst zijn, een filter, of verplicht. Een datum kan **beginnen met vandaag** (een nieuw
item krijgt de datum van vandaag), een persoon kan **beginnen met jou**, en een verdeling kan zich **zelf invullen**
(de gewone verdeling, of gelijk over iedereen). Bij het kiezen van een veldsoort staat telkens wat ze doet. De
lijsten van een project gelden ook in zijn subprojecten.

Een verwijzing kan ook naar een lijst in een **ander project** wijzen (bv. de Verkopers van Huishouden vanuit een los
project), als je dat project ziet. Wie er niet in zit, ziet bij dat veld "Verborgen" en kan er niets kiezen.

### Berekeningen

Een berekening rekent de app zelf uit; je vult ze nooit in. Er zijn acht soorten, elk met een voorbeeld in de app:

- **Rekensom**: Aantal × Prijs, of Totaal × 1,21 (op een andere berekening verder bouwen mag).
- **Formule**: een eigen som met velden tussen [ ], zoals `[kcal per 100 g] × [Hoeveel] ÷ 100`. Ook haakjes,
  `afronden(x; 1)`, `min(a; b)`, `max(a; b)` en `als([Aantal] < 3; dan; anders)`. Tik op een veld om het in te
  voegen; de app bewaart de formule zo dat ze blijft kloppen als je een veld hernoemt. Een getal naast een bedrag telt
  in euro (`[Prijs] + 2` is twee euro meer).
- **Vergelijking**: ja als Aantal ≤ Bijna op onder (zo zie en filter je wat je moet kopen).
- **Dagen tot** een datum ("over 12 dagen"), **tijd sinds** een datum of jaar ("10 jaar"), en **datum plus**
  een vaste tijd of een herhaling (laatst onderhouden + elk jaar = volgende keer).
- **Uit een gelinkt item**: een veld van het item waarnaar een verwijzing wijst (het land van het wijnhuis).
- **Samenvatten**: hoeveel, de som, het gemiddelde, het kleinste of het grootste van gelinkte items, of van de
  items die naar dit item verwijzen (wat je bij een verkoper uitgaf, en wanneer het laatst), ook vanuit een
  subproject of een ander project.

Een berekening telt enkel wat jij mag zien: mag je een veld waarvan ze afhangt niet zien, dan blijft ze leeg. De
uitleg (i) naast een berekening zegt wat ze uitrekent.

### Totalen

Onderaan het formulier van een lijst stel je **totalen** in (hooguit vier): wat (de som, het gemiddelde, het
kleinste, het grootste of hoeveel items), van welk getal, bedrag of duur (ook een berekening), en over welke periode:
alles samen, of per dag, week, maand of jaar volgens een datumveld. Verder:

- **Waar**: enkel dit project, of met de subprojecten.
- **Ook uit**: lijsten uit andere projecten met dezelfde velden (bv. de Voeding van twee mensen, of de uitgaven van
  Huishouden én een skireis). Wie niet in dat andere project zit, ziet er niets van mee.
- **Apart per** persoon, eigenaar of keuze (een bedrag met een verdeling telt per persoon zijn deel), eventueel
  **tegenover** een tweede veld: een saldo (betaald door − verdeling = wie nog geld krijgt).
- **Verrekenen**: zo'n saldo tussen personen wordt Wie moet wie op het project.
- Een **doel**: "niet meer dan" (een budget, je calorieën) of "minstens" (stappen, water).

Op het project staan ze boven de lijst die openstaat: het getal van vandaag (of deze week, maand, jaar), een balk
naar het doel, staafjes voor de vorige periodes en per persoon of keuze. De API rekent ze uit zoals jij de items
ziet, per project met jouw rol daar: een totaal op een veld dat je niet mag zien, krijg je niet.

Het sjabloon **Voeding** zet dit klaar voor calorieën: een lijst Eten met de datum (begint met vandaag), de maaltijd,
kcal per 100 g, hoeveel gram, en Kcal als formule, met het totaal "Kcal per dag". Een foto van de verpakking vult de
naam en de kcal per 100 g in (zie hieronder); een doel stel je zelf in bij het totaal.

### Items

Items voeg je toe in een lijst, of importeer je uit een tabel (Google Sheets als CSV, Excel, of geplakte cellen):
je kiest per kolom welk veld het wordt, en wat we niet herkennen gaat bij de lange tekst. Een item heeft tags,
een foto, bestanden (factuur, handleiding) en een logboek. Weg maar de geschiedenis houden? **Archiveren**.

### Opnieuw

Iets dat je vaker toevoegt (hetzelfde ontbijt, dezelfde fles), hoef je niet opnieuw in te vullen: **Opnieuw** op de
fiche maakt een nieuw item met dezelfde waarden, en in een nieuw formulier stelt de naam eerdere items voor. Een datum
die met vandaag begint, wordt vandaag. Gratis, zonder AI.

### Een foto lezen: etiket, kasticket, factuur, product

Bij een nieuw item kan je een foto nemen van een etiket, typeplaatje, **kasticket of factuur**, of een PDF kiezen: de
app vult de naam en de velden in (zacht blauw tot je ze zelf aanpast) en bewaart de foto (en de PDF bij de bestanden).
Dat gebeurt met Workers AI. Bij een kasticket neemt ze het totaal, de datum van aankoop en de winkel. Een verwijzing
zoals **Verkoper** koppelt ze op naam aan een verkoper die je al hebt ("COLRUYT LAAGSTE PRIJZEN HALLE" → Colruyt);
staat de winkel er nog niet in, dan voeg je ze met één tik toe. Wat de AI zegt, gaat door dezelfde controle als wat
je zelf typt; er wordt nooit iets bewaard zonder dat je op **Opslaan** drukt.

Heeft een lijst velden **uit productinfo** (zoals kcal per 100 g bij Voeding), dan zoekt de app echte gegevens op in
[Open Food Facts](https://world.openfoodfacts.org), een open en gratis databank, zo zuinig mogelijk:

1. **Barcode**: scan ze, of trek een foto waarop ze staat. De app leest ze zelf (zonder AI) en het product is exact.
2. **Foto zonder barcode**: de AI herkent wat erop staat. Een gekend product (bv. Nutella van Ferrero) zoekt de app
   op naam en merk op in Open Food Facts; een gerecht of iets dat niet gevonden wordt, blijft een schatting. De app
   zegt altijd welk van de twee, en welk product ze vond. Hoeveel je at, blijft een schatting: kijk het na.

Open Food Facts krijgt enkel een barcode of een productnaam, nooit iets van jou. Wat de app opzocht, onthoudt ze 30
dagen (tabel `products`). De AI heeft een harde limiet: 25 foto's per persoon en 50 samen per dag
(`AI_PERSON_LIMIT`, `AI_DAILY_LIMIT`), ruim binnen de gratis hoeveelheid van Workers AI.

## Hoe de gegevens ingedeeld zijn

| Tabel | Wat |
| ----- | --- |
| `people` | Personen. Met een e-mailadres als ze aanmelden, zonder als ze nooit aanmelden. |
| `projects` | Projecten, als boom (`parent_id`). |
| `roles` | Rollen per project; `rights` zegt wat de rol mag (zie `shared/access.ts`). |
| `memberships` | Wie welke rol heeft in welk project. Geldt ook in de subprojecten. `sort_order` is jouw volgorde op het overzicht. |
| `item_types` | Lijsten: naam, naam van één item, velden (`fields`, met de berekeningen, zie `shared/calc.ts`) en totalen (`totals`, zie `shared/totals.ts`), als JSON. |
| `items` | Items: naam en de waarden van de velden (`data`, als JSON). |
| `tags` + `item_tags` | Tags per project, en welke items ze hebben. |
| `item_files` | Bestanden bij een item (in R2). De foto staat apart in R2 (`items/<id>/photo`). |
| `item_log` | Het logboek van een item. |
| `ai_usage`, `ai_usage_people` | Hoeveel AI-lezingen er vandaag al waren, samen en per persoon. |
| `products` | Productinfo uit Open Food Facts (op barcode of naam), 30 dagen bijgehouden. |

Velden en rechten controleert de Worker, niet de database (`shared/fields.ts` en `shared/access.ts`). Zo kan er
later een veldsoort of recht bij zonder de tabellen te herbouwen.

## De database aanpassen

Elke schemawijziging is een nieuw SQL-bestand in `migrations/`. Pas nooit een bestaand bestand aan.

1. Nieuwe migratie aanmaken:
   ```sh
   npx wrangler d1 migrations create huishouden-db korte_omschrijving
   ```
2. Schrijf je SQL in het nieuwe bestand.
3. Lokaal toepassen en testen:
   ```sh
   npm run db:migrate:local
   ```
4. Push. `npm run deploy` past de migratie online toe.

Pas je `wrangler.jsonc` aan (bv. een nieuwe binding)? Draai dan `npm run cf-typegen`, zodat de types kloppen.

## Goed om te weten

- **Bedragen** staan in cent (`64900` = € 649,00). Zo vermijd je afrondingsfouten.
- **Foto's** worden in de browser verkleind tot max. 2000 px voor de upload.
- **Barcodes** worden altijd zwart op wit getoond: kassascanners lezen gekleurde codes slecht.
- **Ontwerp**: zie [STIJLBOEK.md](STIJLBOEK.md). Daar staat hoe elk scherm, onderdeel en elke tekst eruitziet,
  met een checklist voor nieuwe onderdelen. Raadpleeg het altijd voor je iets aan de app verandert.
- **Offline**: alleen klantenkaarten. Al de rest bekijken of aanpassen vraagt internet.
- De R2-bucket staat in de regio *ENAM* (Noord-Amerika). Wil je je bestanden in Europa, maak dan een
  nieuwe bucket aan met `npx wrangler r2 bucket create huishouden-bestanden-eu --jurisdiction eu`. Pas daarna
  in `wrangler.jsonc` de `bucket_name` aan en voeg `"jurisdiction": "eu"` toe. Doe dat bij voorkeur voor je
  echte bestanden uploadt.
