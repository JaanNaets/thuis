# Thuis

Onze eigen huishoud-app, volledig op Cloudflare. Onderdelen:

- **Aankopen**: kastickets en facturen bewaren (foto of PDF), met garantie-opvolging.
- **Uitgaven**: wie betaalde wat, wie wie nog hoeveel moet, en waar het geld per maand naartoe gaat.
- **Voorraad**: wat er in huis is en waar, met vervaldatums, "bijna op" en een logboek van elke wijziging.
- **Klantenkaarten**: barcode tonen aan de kassa, ook **zonder internet**. Inlezen met de camera of uit een
  foto of screenshot.
- **Meer**: wie er in huis woont, verkopers, en de indeling in categorieën, plaatsen en tags.

Overal waar je iets registreert (een aankoop, een item, een aanvulling van de voorraad, een terugbetaling, een
kaart) kan je een **notitie** kwijt, en waar het past ook de **verkoper**.

Werkt op de gsm (mobile first, installeerbaar als app) en op een tablet in kioskmodus.

## Hoe het in elkaar zit

```
src/         React-app (wat je op het scherm ziet)
worker/      API op Cloudflare Workers (Hono)
shared/      Types en logica die app en API allebei gebruiken (verdelen, voorraad, ticketlezer)
migrations/  Databaseschema (D1), één SQL-bestand per wijziging
sw/          Service worker: zorgt dat klantenkaarten offline werken
```

| Onderdeel      | Cloudflare-dienst                                     |
| -------------- | ----------------------------------------------------- |
| App + API      | Workers (één Worker, statische bestanden + `/api/*`)  |
| Gegevens       | D1 `huishouden-db`                                    |
| Foto's en PDF's | R2 `huishouden-bestanden`                            |
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
5. Tests draaien (ticketlezer, verdelen, voorraad):
   ```sh
   npm test
   ```

Kastickets van foto's lezen gebeurt met Workers AI, en dat draait altijd bij Cloudflare. Met gewoon
`npm run dev` lezen PDF's wel automatisch, maar foto's niet. Wil je dat lokaal ook testen, gebruik dan
`npx wrangler login` en daarna `npm run dev:ai`.

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
   iedereen in het huishouden in, en sla op.

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
e-mailadres in, krijgt een code per mail, en komt in de app. Onderaan staat "Aangemeld als …".

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

Open de app één keer met internet. Daarna werken je klantenkaarten ook in een winkel zonder bereik.

## 5. Tablet in kioskmodus

1. Open op de tablet één keer `https://thuis.<jouw-subdomein>.workers.dev/?kiosk=1` en meld je aan.
   Kioskmodus blijft op dat toestel aan (uitzetten met `?kiosk=0`).
2. Vergrendel de tablet op de app:
   - **Android**: [Fully Kiosk Browser](https://www.fully-kiosk.com) met dezelfde URL als startpagina.
     Zet "Keep Screen On" aan en geef toestemming voor de camera (foto's van kastickets).
   - **iPad**: voeg de app toe aan het beginscherm, open ze, en zet **Begeleide toegang** aan
     (Instellingen → Toegankelijkheid). Drie keer op de zijknop drukken start ze.

In kioskmodus:

- keert de app na 5 minuten zonder aanraking terug naar het startscherm en ververst ze de gegevens;
- worden bestanden in de app zelf geopend, nooit in een nieuw tabblad;
- staat er geen "Aangemeld als" onderaan.

## Kastickets automatisch lezen

Zodra je bij een nieuwe aankoop een foto of PDF kiest, vult de app de winkel, de datum, het bedrag en de
categorie in. Automatisch ingevulde velden zijn geel tot je ze zelf aanpast. Er wordt nooit iets opgeslagen
zonder dat je op **Opslaan** drukt.

Van gratis naar (bijna) gratis:

1. **PDF met tekst** (webshopfacturen): de app haalt de tekst eruit en leest die met gewone code
   (`shared/receipt.ts`). Dat is gratis en exact.
2. **Foto, of een gescande PDF**: de Worker laat een verkleinde afbeelding lezen door Workers AI
   (`worker/routes/receipts.ts`). Een ticket kost ±20-30 *neurons*, en de gratis hoeveelheid is
   10.000 neurons per dag.
3. **Altijd code achteraf**: wat de AI zegt, wordt nagekeken. Een datum in de toekomst, een negatief bedrag
   of een onbekende categorie wordt weggegooid in plaats van ingevuld.
4. **Categorie uit jullie eigen geschiedenis**: kochten jullie al eerder iets bij dezelfde winkel, dan
   krijgt het die categorie.

Een harde limiet van 50 AI-lezingen per dag (`AI_DAILY_LIMIT`) zorgt dat je ook op een betaald plan nooit
boven de gratis hoeveelheid gaat. Op het gratis plan kan het sowieso niets kosten.

Leest de code een winkel niet? Voeg ze toe aan de lijst `STORES` in `shared/receipt.ts`, en voeg bij
voorkeur een test toe in `test/receipt.test.ts`.

## Wie betaalde wat

Bij elke aankoop kies je wie betaalde en voor wie het was:

- **Iedereen**: gelijk verdeeld over wie in huis woont. Een cent die niet deelbaar is, draagt wie betaalde.
- **Enkel mij**: persoonlijk, telt niet mee in wat de anderen moeten.
- **Aangepast**: je typt zelf wie hoeveel draagt (samen moet het precies het bedrag zijn).
- **Gezamenlijk**: betaald van de gemeenschappelijke rekening. Telt niet mee.

Onder **Uitgaven** zie je wie wie nog hoeveel moet. Heb je het overgeschreven, druk dan op **Terugbetaald**
(minder mag ook: dan blijft de rest openstaan). Iemand die al eens aangemeld heeft, is vanzelf lid. Je partner
voeg je vooraf toe bij **Meer → Huishouden**, met het e-mailadres waarmee die later aanmeldt.

## Voorraad

- **Verbruik** (melk, wasmiddel, ...) raakt op; **Bezit** (wasmachine, boormachine, ...) blijft.
- Elk item ligt op een of meer **plaatsen** (Keuken › Koelkast). Met − en + in de lijst pas je de voorraad
  meteen aan: − neemt eerst weg wat het eerst vervalt.
- Stel **"bijna op onder"** in, dan verschijnt het item in de filter **Bijna op**. Dat is meteen je boodschappenlijst.
- **Scannen** zoekt het product eerst in jullie eigen voorraad, en anders gratis in
  [Open Food Facts](https://world.openfoodfacts.org) (naam, merk, categorie). Geen AI, geen kosten.
- Een aankoop met garantie kan je **in voorraad zetten**. Zo hangt het toestel aan zijn kasticket en garantie.
- Iets weg uit huis maar wil je de geschiedenis houden? **Archiveren** in plaats van verwijderen.

## Verkopers

Een verkoper is een winkel, een webshop, een vakman of iemand op 2dehands. Typ de naam bij een aankoop: bestaande
verkopers verschijnen terwijl je typt, een nieuwe naam wordt vanzelf een nieuwe verkoper. Hoofdletters maken niet
uit ("colruyt" en "Colruyt" zijn dezelfde).

Je vult een verkoper in bij:

- een **aankoop**: waar je het kocht (de ticketlezer vult hem in);
- een **voorraaditem**: waar je het meestal koopt;
- **Erbij** in de voorraad: waar je het deze keer kocht (staat in de geschiedenis).

Bij **Meer → Verkopers** geef je een verkoper een website, telefoonnummer en notitie (klantnummer,
contactpersoon, ...), en zie je al je aankopen bij die verkoper.

## Klantenkaart uit een foto

Bij een nieuwe kaart kan je **Scannen** (camera) of **Uit foto** kiezen. Uit foto werkt met een foto van de
kaart, maar ook met een screenshot uit de app van de winkel. Het lezen gebeurt volledig op je toestel.

## Hoe de gegevens ingedeeld zijn

De database is gebouwd om later uit te breiden tot een volledige "home ERP" (agenda, onderhoud, budgetten, ...):

| Tabel | Wat |
| ----- | --- |
| `members` | Wie in het huishouden woont. Gekoppeld aan het e-mailadres van de login. |
| `vendors` | Verkopers: winkels, webshops, vakmensen. Aankopen, items en voorraadbewegingen verwijzen ernaar. |
| `categories` | Eén boom per **domein**: `expense` (aankopen) en `item` (voorraad). Later kan er een domein bij. |
| `locations` | Plaatsen in huis, ook een boom. |
| `tags` + `taggings` | Vrije labels op om het even wat (`entity_type` = `purchase`, `item`, ...). |
| `purchases` | Aankopen en uitgaven, met `paid_by` en `split_mode`. |
| `expense_shares` | Wie welk deel van een aankoop draagt. Samen altijd het volledige bedrag. |
| `settlements` | Terugbetalingen tussen leden. |
| `items` | Producten en bezittingen, met type, eenheid, barcode en minimum. |
| `stock_levels` | Hoeveel er nu op elke plaats ligt. |
| `stock_movements` | Logboek van elke voorraadwijziging; wordt nooit aangepast. Kan naar een aankoop verwijzen. |

Opsommingen (zoals het type van een item of de reden van een beweging) controleert de Worker, niet de database.
Zo kan er later een waarde bij zonder de tabel te herbouwen.

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

- **Bedragen** staan in cent in de database (`64900` = € 649,00). Zo vermijd je afrondingsfouten.
- **Foto's** worden in de browser verkleind tot max. 2000 px voor de upload.
- **Barcodes** worden altijd zwart op wit getoond: kassascanners lezen gekleurde codes slecht.
- **Ontwerp**: wit en strak, in de stijl van shadcn/ui, met lettertype Geist. De kleuren en maten staan als
  variabelen bovenaan `src/styles.css`, de animatiecurves ook (`--ease-out`, `--spring`). Wie in de instellingen
  van zijn toestel "minder beweging" aanzet, krijgt geen animaties.
- **Offline**: alleen klantenkaarten. Al de rest bekijken of aanpassen vraagt internet.
- De R2-bucket staat in de regio *ENAM* (Noord-Amerika). Wil je je bestanden in Europa, maak dan een
  nieuwe bucket aan met `npx wrangler r2 bucket create huishouden-bestanden-eu --jurisdiction eu`. Pas daarna
  in `wrangler.jsonc` de `bucket_name` aan en voeg `"jurisdiction": "eu"` toe. Doe dat bij voorkeur voor je
  echte bestanden uploadt.
