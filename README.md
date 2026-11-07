# Heystack

Onze eigen app voor thuis (het repo en de Worker heten nog `thuis`), volledig op Cloudflare. Ze is **generiek**: je bouwt zelf wat je wil bijhouden, met
één opbouw voor alles.

- **Lijsten** met **dingen**: Wijnen, Voorraad, Wagens, Bezit, Winkels. De dingen van een lijst hebben dezelfde
  velden (jaargang en druiven, merk en nummerplaat), ook velden die de app zelf uitrekent.
- Elke lijst heeft een **logboek** met **gebeurtenissen**: een aankoop, iets gebruikt of gegeten, een dienst (de
  garage, de dokter), een activiteit (werk, sport, slaap), een meting (gewicht, een telling) of een overdracht
  (terugbetaald). Een gebeurtenis heeft lijnen naar dingen: wat erbij kwam, wat eraf ging, waarvoor en waar.
- **Mensen** per lijst (beheerder, lid of gast), en **tags** om lijsten te groeperen (Huis, Jaan, Wijnkelder). Een
  regel op een tag ("Jana altijd beheerder bij Huis") geeft toegang tot elke lijst met die tag.
- Wat je gewoonlijk als aparte lijst bijhoudt, rekent de app zelf uit: **Geld** (uitgaven, jouw deel, Wie moet wie),
  **Voorraad** (wat er is, wat bijna op is), **Eten** (kcal per persoon), **Te doen** en de **Agenda**.

Werkt op de gsm (mobile first, installeerbaar als app) en op een tablet in kioskmodus.

## Hoe het in elkaar zit

```
src/         React-app (wat je op het scherm ziet)
worker/      API op Cloudflare Workers (Hono)
shared/      Types en logica die app en API allebei gebruiken (model, rechten, voorraad, geld, velden)
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
4. **Build command**: leeg laten. **Deploy command**: `npm run deploy` (eerst de tests: faalt er een, dan gaat er niets online; Node-versie in `.node-version`).
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
e-mailadres in, krijgt een code per mail, en komt in de app. Bij **Jouw gegevens** (je letter rechtsboven) staat waarmee je aangemeld bent.

Wie de eerste keer aanmeldt, ziet nog geen lijsten. Maak er een (bv. "Uitgaven" met het sjabloon Uitgaven en de tag
Huis), en voeg de anderen toe bij **Instellen → Mensen** met het e-mailadres waarmee ze aanmelden, of met een regel op
de tag (bij de tag: Altijd erbij).

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
- **Android** (of Chrome en Edge op je computer): tik bij **Jouw gegevens** op **App installeren**, of open het
  menu van de browser (⋮) → **App installeren**.

Open de app één keer met internet. Daarna opent ze ook zonder bereik: wat je eerder bekeek (je lijsten, een ding,
het logboek) blijft op het toestel bewaard. Iets **nieuws** loggen of toevoegen lukt ook offline: het wacht op je
toestel en gaat vanzelf mee zodra je weer internet hebt. Wijzigen en verwijderen vragen internet.

Wil je **meldingen** (een herinnering 's morgens, zie Herinneren en herhalen): zet ze aan bij **Ik → Meldingen**,
op elk toestel apart. Op een iPhone of iPad kan dat enkel vanuit de app op je beginscherm (iOS 16.4 of later).

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

### Lijsten, dingen en het logboek

Een lijst heeft dingen (allemaal met dezelfde velden) en een logboek. Een lijst zonder dingen kan ook: dan is ze
enkel een logboek (Jaan: eten en gewicht). Een nieuwe lijst begin je leeg, uit een sjabloon (Uitgaven zoals
Splitwise, Dieet zoals Yazio) of uit een bestand dat iemand deelde (Instellen → Als sjabloon).

Een gebeurtenis heeft een soort: een van de zes basissoorten, of een eigen soort van de lijst met eigen velden
(Tankbeurt met liter en km, Gegeten met kcal). Haar lijnen wijzen naar dingen, ook in andere lijsten:

| Lijn  | Betekent                     | Voorbeeld                           |
| ----- | ---------------------------- | ----------------------------------- |
| erbij | er komt iets bij             | 6 yoghurt op een kasticket          |
| eraf  | er gaat iets uit             | 300 g pasta gegeten, 1 zak pellets  |
| voor  | waarvoor het was             | een tankbeurt voor de Sprinter      |
| bij   | waar het gebeurde            | bij Colruyt, bij Dr. Peeters        |

Het logboek van een lijst toont wat er in gelogd werd, en ook lijnen van elders die haar dingen raken (een fles wijn
op een kasticket in Voorraad staat ook in het logboek van Wijnen, zonder de rest van dat ticket).

### Wie wat ziet

Je ziet een lijst als je er rechtstreeks bij bent, of via een regel op een tag. Een regel werkt enkel op lijsten waar
wie hem maakte zelf beheerder is, en een rechtstreekse keuze op de lijst wint (ook "geen toegang"). Van een
gebeurtenis in een lijst die je niet ziet, zie je enkel de lijnen naar jouw dingen (een fles erbij), nooit het bedrag
of waar het was.

### Voorraad

Een lijst kan voorraad tellen (Instellen → Voorraad): in welke eenheid een ding telt, wat er in één stuk of
verpakking zit en vanaf wanneer het bijna op is. De voorraad wordt nooit bewaard maar uitgerekend: de laatste telling
plus wat erbij kwam min wat eraf ging, omgerekend (500 g van iets in kg, een zak van 15 kg). De − en + in de lijst
loggen een telling.

### Geld en Wie moet wie

Een aankoop of dienst heeft een bedrag, wie betaalde en met wie het gedeeld is; een lijn kan enkel van één persoon zijn
(het broodje op het gezamenlijke kasticket). Geld toont per maand wat er uitgegeven werd, per soort, lijst en winkel,
met jouw deel, en wie wie nog moet betalen (met een betaal-QR). Terugbetaald loggen is een overdracht.

### Iets loggen

- **Toevoegen** (de + of ⌘K): typ wat er gebeurde ("gegeten pasta 300 g", "tankbeurt sprinter 84,50 52 liter") en kies
  waar; het formulier opent met alles al ingevuld.
- **Typ wat je weet** bovenaan het formulier vult live in: datum en uur, bedrag, de dingen met hoeveelheid en prijs,
  velden van de soort. Pas je zelf iets aan, dan blijft dat staan.
- **Kasticket ✨**: een foto van een kasticket wordt één aankoop met een lijn per product, gekoppeld aan wat je al hebt;
  wat nieuw is, komt in de voorraad. De naam op het ticket wordt onthouden voor de volgende keer.
- Een ding met **Barcode** (Open Food Facts, zonder AI) of **Foto ✨** (etiket of product; de app zegt of het uit een
  databank komt of geschat is).
- Een gedeelde foto (Android: delen met Heystack) wacht tot je ✨ tikt. De AI staat per persoon aan of uit (Jouw gegevens).
- Boodschappen en taken zijn geplande gebeurtenissen: afvinken, en een aankoop van hetzelfde ding vinkt een boodschap
  vanzelf af.

### Herhalen, herinneren en meldingen

Een gebeurtenis kan herhalen (Netflix elke maand: de app logt ze zelf), een geplande taak maakt bij afvinken de
volgende. Om 7 u komt een melding voor datums van dingen (keuring, garantie) en wat vandaag gepland staat. Per lijst
kies je of een nieuwe gebeurtenis een melding geeft, en elk lijst of tag kan je voor jezelf stilzetten.

### Het overzicht

Je overzicht bestaat uit blokken: uitgaven deze maand, Wie moet wie, te doen, bijna op, eten vandaag, wat nu loopt,
snel loggen, één ding, een lijst of een grafiek. Je kan meer overzichten hebben (Keuken, Garage).

### Back-up

Jouw gegevens → Back-up: een bestand met de lijsten die je beheert (dingen, logboek, soorten, tags, weergaven).
Terugzetten maakt altijd een nieuwe kopie; er wordt niets overschreven.
