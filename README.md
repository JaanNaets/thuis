# Thuis

Onze eigen app voor thuis, volledig op Cloudflare. Ze is volledig **generiek**: je bouwt zelf wat je wil bijhouden.

- **Projecten** en subprojecten: "Huishouden" is gewoon een project, met daaronder bv. "Wijnkelder" en "Fietsen".
- **Mensen met een rol** per project: wat ze mogen zien en wijzigen, tot op het niveau van één veld.
- **Lijsten** met eigen velden (Wijnen met jaargang en druiven, Klantenkaarten met een barcode).
- **Items** in een lijst, met tags, een foto, bestanden en een logboek.

Regels voor een bepaalde use case (kosten verdelen, voorraad, klantenkaarten offline, kastickets lezen) komen er
bovenop, als sjabloon of als eigen onderdeel.

Werkt op de gsm (mobile first, installeerbaar als app) en op een tablet in kioskmodus.

## Hoe het in elkaar zit

```
src/         React-app (wat je op het scherm ziet)
worker/      API op Cloudflare Workers (Hono)
shared/      Types en logica die app en API allebei gebruiken (velden, rechten, sjablonen)
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
zit: één tik en je bent er. Met **Volgorde** sleep je de projecten in de volgorde die jij wil (dat is per persoon);
subprojecten orden je daar ook, als je het project instelt. De volgorde van de lijsten (en dus van de tabs in een
project) sleep je bij **Instellen → Lijsten**, die van de velden in het formulier van een lijst.

### Projecten en subprojecten

Een project is een map voor alles wat bij elkaar hoort: "Huishouden", "Wijnkelder", "Verbouwing". Een project kan
subprojecten hebben, zo diep als je wil. Een nieuw project begint met een **sjabloon** (Leeg project, Huishouden, Wijnkelder,
Koersfietsen, Gedeelde uitgaven, Verzameling) dat de lijsten met hun velden klaarzet. Daarna kan je alles aanpassen bij **Instellen**.

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

Een lijst heeft een naam ("Wijnen"), een naam voor één item ("Wijn", voor de knop "Wijn toevoegen") en velden. Een veld kan zijn: tekst, lange
tekst, getal, bedrag, datum, jaar, periode van jaren (bv. drinkklaar 2026–2032), keuze, meerkeuze, ja/nee, score,
barcode of QR-code, persoon, verwijzing naar een ander item (de wijn → het wijnhuis) of eigenaars (wie welk
deel heeft). Een veld kan een kolom in de lijst zijn, een filter, of verplicht. De lijsten van een project gelden
ook in zijn subprojecten.

### Items

Items voeg je toe in een lijst, of importeer je uit een tabel (Google Sheets als CSV, Excel, of geplakte cellen):
je kiest per kolom welk veld het wordt, en wat we niet herkennen gaat bij de lange tekst. Een item heeft tags,
een foto, bestanden (factuur, handleiding) en een logboek. Weg maar de geschiedenis houden? **Archiveren**.

### Een etiket lezen

Bij een nieuw item kan je een foto van een etiket nemen: de app vult de naam en de velden in (zacht blauw tot je
ze zelf aanpast) en bewaart de foto. Dat gebeurt met Workers AI. Een harde limiet van 50 lezingen per dag
(`AI_DAILY_LIMIT`) zorgt dat je ook op een betaald plan nooit boven de gratis hoeveelheid gaat. Wat de AI zegt,
gaat door dezelfde controle als wat je zelf typt; er wordt nooit iets bewaard zonder dat je op **Opslaan** drukt.

## Hoe de gegevens ingedeeld zijn

| Tabel | Wat |
| ----- | --- |
| `people` | Personen. Met een e-mailadres als ze aanmelden, zonder als ze nooit aanmelden. |
| `projects` | Projecten, als boom (`parent_id`). |
| `roles` | Rollen per project; `rights` zegt wat de rol mag (zie `shared/access.ts`). |
| `memberships` | Wie welke rol heeft in welk project. Geldt ook in de subprojecten. `sort_order` is jouw volgorde op het overzicht. |
| `item_types` | Lijsten: naam, naam van één item en velden (`fields`, als JSON). |
| `items` | Items: naam en de waarden van de velden (`data`, als JSON). |
| `tags` + `item_tags` | Tags per project, en welke items ze hebben. |
| `item_files` | Bestanden bij een item (in R2). De foto staat apart in R2 (`items/<id>/photo`). |
| `item_log` | Het logboek van een item. |
| `ai_usage` | Hoeveel AI-lezingen er vandaag al waren. |

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
