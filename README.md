# Huishouden

Onze eigen huishoud-app, volledig op Cloudflare. Eerste onderdelen:

- **Aankopen**: kastickets en facturen bewaren (foto of PDF), met garantie-opvolging.
- **Klantenkaarten**: barcode tonen aan de kassa, ook **zonder internet**.

Werkt op de gsm (mobile first, installeerbaar als app) en op een tablet in kioskmodus.

## Hoe het in elkaar zit

```
src/         React-app (wat je op het scherm ziet)
worker/      API op Cloudflare Workers (Hono)
shared/      Types die app en API allebei gebruiken
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
5. Tests draaien (de ticketlezer):
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
2. Kies de GitHub-repo `huishouden`.
3. Projectnaam: `huishouden`. Die moet gelijk zijn aan `name` in `wrangler.jsonc`.
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

Na het uitrollen staat de app op `https://huishouden.<jouw-subdomein>.workers.dev`. De API weigert alles
tot je stap 3 gedaan hebt. Dat is bewust: zonder login kan niemand aan je gegevens.

## 3. Aanmelden met Cloudflare Access

1. Ga naar **Workers & Pages** → `huishouden` → **Settings** → **Domains & Routes**.
2. Klik bij `workers.dev` op **Enable Cloudflare Access**.
3. Klik op **Manage Cloudflare Access** en zet in de policy de e-mailadressen van iedereen in het huishouden.
4. Noteer de twee waarden die Access toont:
   - **Team domain**, bv. `https://jullie-team.cloudflareaccess.com`
   - **Application Audience (AUD) Tag**, een lange code
5. Vul ze in `wrangler.jsonc` in bij `vars`:
   ```jsonc
   "vars": {
     "TEAM_DOMAIN": "https://jullie-team.cloudflareaccess.com",
     "POLICY_AUD": "…"
   }
   ```
6. Commit en push (of `npm run deploy`).
7. Zet bij de Access-applicatie de **session duration** op een maand. Anders moet de kiosk-tablet
   elke dag opnieuw inloggen.

De Worker controleert zelf het ondertekende Access-token (`worker/auth.ts`). Wie Access probeert te
omzeilen, komt er dus niet in.

## 4. Op je gsm zetten

- **iPhone**: open de app in Safari → deelknop → **Zet op beginscherm**.
- **Android**: open de app in Chrome → ⋮ → **App installeren**.

Open de app één keer met internet. Daarna werken je klantenkaarten ook in een winkel zonder bereik.

## 5. Tablet in kioskmodus

1. Open op de tablet één keer `https://huishouden.<jouw-subdomein>.workers.dev/?kiosk=1` en meld je aan.
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
- **Barcodes** worden altijd zwart op wit getoond: kassascanners lezen pastel slecht.
- **Offline**: alleen klantenkaarten. Aankopen bekijken of toevoegen vraagt internet.
- De R2-bucket staat in de regio *ENAM* (Noord-Amerika). Wil je je bestanden in Europa, maak dan een
  nieuwe bucket aan met `npx wrangler r2 bucket create huishouden-bestanden-eu --jurisdiction eu`. Pas daarna
  in `wrangler.jsonc` de `bucket_name` aan en voeg `"jurisdiction": "eu"` toe. Doe dat bij voorkeur voor je
  echte bestanden uploadt.
