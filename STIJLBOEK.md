# Stijlboek Thuis

Dit stijlboek is de afspraak voor hoe Thuis eruitziet en aanvoelt. **Raadpleeg het voor je een scherm,
onderdeel of tekst toevoegt of verandert**, en werk het bij als je iets nieuws introduceert.

De stijl volgt moderne SaaS-dashboards (referentie: Bretford en Arcline op Dribbble): een rustig grijs
canvas, een wit paneel, dunne lijnen, kleine maten, één blauw accent. Het mooie zit niet in kleur of
versiering, maar in **ritme, uitlijning en zachte micro-animaties**.

De bouwstenen staan in code; dit document zegt welke je wanneer gebruikt.

| Wat | Waar |
| --- | --- |
| Kleuren, maten, schaduwen, curves | `src/styles.css`, bovenaan in `:root` |
| Componenten | `src/components/` (vooral `Controls.tsx`, `Page.tsx`, `Motion.tsx`) |
| Iconen | `src/components/Icon.tsx` |
| Opmaak van bedragen, datums, hoeveelheden | `src/format.ts` |

---

## 1. Principes

1. **Rustig.** Wit en grijs dragen het scherm. Kleur is een signaal, geen decoratie.
2. **Eén accent.** Blauw (`--accent`) voor merk, selectie, info en meldingen. Nergens een tweede accentkleur.
3. **Zwart is de actie.** De hoofdknop is bijna zwart (`btn-primary`), niet blauw.
4. **Dun en klein.** Lijnen van 1px, tekst van 13–15px, titels die niet schreeuwen.
5. **Alles lijnt uit.** Eén raster van 4px; kolommen in tabellen staan onder hun kop.
6. **Beweging is afwerking.** Elke animatie heeft een reden (iets verschijnt, verandert of bevestigt), duurt
   0,2–0,5 s en gebruikt de vaste curves. Nooit beweging om de beweging.
7. **Mobiel eerst, kiosk mee.** Elk scherm werkt op een gsm met de duim én op de keukentablet met een natte
   vinger (aanraakvlakken van 44px).
8. **Nederlands zoals we het zeggen.** Kort, vriendelijk, "je". Zie [Tekst](#9-tekst).

---

## 2. Tokens

Gebruik altijd de variabele, nooit de kleurcode zelf.

### Kleur

| Variabele | Gebruik |
| --- | --- |
| `--canvas` | Achtergrond achter het paneel (enkel tablet) |
| `--background` | Paneel, kaarten, invoervelden |
| `--subtle` | Hover van rijen, kopstrook van tabellen, notitieblok |
| `--muted` | Zachte vlakken: secundaire knop, segmentbalk, tellers in tabs |
| `--muted-strong` | Hover van secundaire knoppen, lege streepjes in de meter |
| `--foreground` | Hoofdtekst, titels |
| `--text-soft` | Tekst in tabelkolommen en menu |
| `--muted-foreground` | Uitleg, metadata, labels in filters |
| `--faint` | Iconen in velden, tellers in de zijbalk, scheidingstekens |
| `--border` / `--border-strong` | Lijnen van kaarten / randen van knoppen en tags |
| `--primary` | Hoofdknop, zwevende + knop, actieve tablijn |
| `--accent`, `--accent-soft`, `--accent-line`, `--accent-ink` | Blauw: focus, selectie, badge "nieuw", toasts, automatisch ingevulde velden |
| `--success*`, `--warning*`, `--danger*` | Status: garantie loopt / bijna op / vervallen |

**Tonen** (`tone-peach`, `tone-butter`, `tone-sage`, `tone-mint`, `tone-sky`, `tone-lilac`, `tone-rose`) zijn de
kleuren van categorieën, tags en leden. Ze geven `--tone`, `--tone-soft`, `--tone-line` en `--tone-ink`.
Gebruik ze **enkel** voor stipjes (`.dot`), avatars, het vierkantje voor een rij (`.row-media`) en tags. Nooit
voor knoppen, kaarten of grote vlakken.

### Typografie

- Lettertype: **Inter** (variabel, met optische grootte). Cijfers in kaartnummers en barcodes: Geist Mono (`.mono`).
- Bedragen en aantallen altijd met `font-variant-numeric: tabular-nums` (klassen `.num`, `.row-end`, `.amount-big`).

| Rol | Grootte | Gewicht |
| --- | --- | --- |
| Paginatitel | 22px (tablet), 26px (gsm) | 600, letterspatiëring −0,02em |
| Groot bedrag | 30–38px | 600, −0,03em |
| Kaarttitel | 14px | 600 |
| Gewone tekst | 14px (muis), 15px (aanraking) | 400 |
| Rijtitel | 14,5px | 500 |
| Metadata, uitleg, labels | 13–13,5px | 400–500 |
| Badges, tellers | 12px | 500 |

### Maten

- Raster van **4px**. Gebruikelijke afstanden: 4, 8, 12, 16, 20, 24, 32.
- Afronding: `--radius-sm` 6 (badges, kleine knoppen) · `--radius` 8 (knoppen, velden) · `--radius-md` 10
  (filters, meldingen) · `--radius-lg` 12 (kaarten) · `--radius-panel` 14 (het paneel) · `--radius-xl` 16 (onderblad).
- Schaduw: `--shadow-xs` op alles wat op het paneel ligt (kaarten, knoppen, velden). `--shadow-lg` enkel voor
  wat zweeft (toast, onderblad, keuzelijst, + knop).
- Hoogtes: knop 36px · klein 32px · groot 42px. Op aanraakschermen automatisch 44/36px.

---

## 3. Layout

### Gsm (smaller dan 768px)

- Witte achtergrond, inhoud met 16px marge.
- **Onderbalk** met vijf tabs (Aankopen, Uitgaven, Voorraad, Kaarten, Meer). Een grijs vlak schuift naar de actieve tab.
- **Zwevende + knop** rechtsonder voor de hoofdactie van het scherm.
- **Kleine titelbalk** bovenaan die verschijnt zodra de grote titel uit beeld scrollt (zit in `PageHead`).
- Tabelkolommen verdwijnen: de info staat in de grijze regel onder de titel (`.narrow-only`).

### Tablet en kiosk (vanaf 768px)

- Grijs **canvas** met links de **zijbalk** en rechts een wit **paneel** (8px marge, rand, afronding 14px). Het
  paneel scrollt zelf; de zijbalk blijft staan.
- Zijbalk: werkplek ("Thuis") bovenaan, sectie "Menu" met tellers, onderaan Instellingen en wie aangemeld is.
  Tussen 768 en 1100px enkel iconen.
- **Paneelbalk** bovenaan het paneel: kruimelpad links ("Thuis / Voorraad / Penne"), acties op het item rechts.
- Geen + knop: de hoofdactie staat rechts in de paginakop.

### Opbouw van elk scherm

```
PageHead                 titel (+ badge), uitleg, hoofdactie
Tabs                     als er weergaves zijn (Alles 10 · Bijna op 2 · …)
toolbar                  zoeken (+ scanknop)
filters                  filterpillen
card / card table        de inhoud
fab                      + knop (enkel gsm, zelfde actie als primary)
```

---

## 4. Componenten

### Paginakop: `PageHead` (`Page.tsx`)

Elk scherm begint ermee. Hij maakt ook de paneelbalk (tablet) en de kleine titelbalk (gsm).

```tsx
<PageHead
  title="Voorraad"
  badge={<span className="badge badge-warning">2 bijna op</span>}   // optioneel, kort
  description="Wat er in huis is, waar het ligt en wanneer het vervalt"
  back={{ to: "/voorraad", label: "Voorraad" }}                       // enkel op detail- en formulierschermen
  actions={<Link className="btn btn-outline btn-sm" …>Bewerken</Link>} // acties op dit item
  primary={<Link className="btn btn-primary" …><Icon name="plus" size={16} /> Nieuw item</Link>}
/>
```

- Een overzichtsscherm heeft `primary` (en een `.fab` met dezelfde actie). Een detailscherm heeft `back` en `actions`.
- Formulieren: `back={{ to: -1, label: … }}` (gewoon terug), geen `primary`.
- Beschrijving: één zin, zonder punt aan het einde als het een opsomming is.

### Knoppen

| Klasse | Wanneer |
| --- | --- |
| `btn btn-primary` | De ene hoofdactie per scherm of formulier (Opslaan, Nieuwe aankoop) |
| `btn btn-outline` | Gewone acties naast de hoofdactie (Bewerken, Scannen, Uit foto) |
| `btn btn-ghost` | Stille acties in een rij (−/+ in de stepper, archiveren) |
| `btn btn-danger` | Enkel als bevestiging in het venster "verwijderen?" |
| `btn btn-danger-ghost` | De knop die naar dat venster leidt ("Verwijderen") |
| `btn-sm`, `btn-lg`, `btn-icon`, `btn-block` | Grootte en vorm |

- Icoon links van de tekst, 16px (`<Icon name="plus" size={16} />`).
- Knop die iets bewaart: `SubmitButton` (draait een spinner tijdens het bewaren).
- Een knop met enkel een icoon krijgt altijd een `aria-label`.

### Kaart: `card` + `CardHead`

```tsx
<section className="card">
  <CardHead icon="clock" title="Geschiedenis" description="Elke wijziging, met wie en waar" action={…} />
  <ul className="rows">…</ul>            // of <div className="card-body">…</div>
</section>
```

- Elke kaart met een titel krijgt het **blauwe icoontegeltje** (`CardHead` doet dat).
- Inhoud zonder rijen in `card-body`. Een voetnoot (bv. "Bewaard door Jaan") in `.footnote`.
- Een kaart is nooit gekleurd. Kleur zit in wat erin staat.

### Lijst: `rows` en `row`

```tsx
<div className="card">
  <ul className="rows stagger">
    {items.map((x, i) => (
      <li key={x.id} style={stagger(i)}>
        <Link to={…} className="row">
          <span className="cell-main">
            <span className={`row-media tone-${tone}`}><Icon name="receipt" size={17} /></span>
            <span className="row-main">
              <span className="row-title">{x.title}</span>
              <span className="row-meta"><span>{meta}</span></span>
            </span>
          </span>
          <span className="row-end">{formatCents(x.amount)}</span>
        </Link>
      </li>
    ))}
  </ul>
</div>
```

- Een rij is 60px hoog, met `row-media` (38px vierkant, of `round` voor personen), titel, grijze regel en rechts
  een waarde of `row-chevron`.
- Rij met eigen knoppen (zoals −/+): de rij zelf is een `div.row`, de link zit in `.row-link`.
- Groeperen: `<li className="group-row"><span className="dot tone-x" /> Voeding <span className="group-count">5</span></li>`.

### Tabel (tablet): `card table` + `table-head` + `col`

Dezelfde rijen worden op tablet een tabel met een grijze kopstrook.

```tsx
<div className="card table table-purchases">
  <div className="table-head" aria-hidden="true">
    <span>Aankoop</span><span>Verkoper</span><span>Datum</span><span className="xl">Garantie</span><span className="end">Bedrag</span>
  </div>
  <ul className="rows stagger">
    <li><Link className="row">
      <span className="cell-main">…<span className="row-meta narrow-only">verkoper · datum</span></span>
      <span className="col"><span>{vendor}</span></span>
      <span className="col"><span>{date}</span></span>
      <span className="col xl">{badge}</span>
      <span className="row-end">{amount}</span>
    </Link></li>
  </ul>
</div>
```

- Kolommen staan in `styles.css` als `--cols` per tabel (`.table-purchases`, `.table-stock`, `.table-entries`).
  Een nieuwe tabel krijgt een eigen klasse met `--cols`; de eerste kolom is altijd `minmax(0, 1fr)`.
- Hooguit 4 kolommen tussen 768 en 1100px; extra kolommen krijgen `xl` (verschijnen pas vanaf 1100px).
- Wat op gsm in de grijze regel staat, heeft `narrow-only`; wat enkel in de tabel onder de titel moet, `wide-only`.
- Lege cel: een streepje `—` in `.muted`.

### Tabs met tellers: `Tabs`

```tsx
<Tabs label="Voorraad" value={tab} onChange={setTab}
  tabs={[{ value: "all", label: "Alles", count: 10 }, { value: "low", label: "Bijna op", count: 2 }]} />
```

Voor verschillende **weergaves van dezelfde lijst**. De lijn schuift mee, tellers rollen bij een wijziging.
Niet voor navigatie naar een ander scherm.

### Filters: `FilterSelect` en `FilterToggle`

```tsx
<div className="filters">
  <FilterSelect label="Plaats" all="Overal" value={locationId} onChange={setLocationId} options={…} />
  <FilterToggle on={x} onChange={setX}><Icon name="store" size={14} /> Colruyt</FilterToggle>
</div>
```

Grijs label, donkere waarde. Een actieve filter kleurt blauw. Filters staan onder het zoekveld.

### Segmenten: `Segmented`

Keuze tussen 2–4 opties in een formulier (Betaald door, Voor wie, Soort). Het witte vlak schuift mee.
Meer dan 4 opties: gebruik een `select`.

### Formulier

```tsx
<form className="form page" onSubmit={…}>
  <PageHead title="Nieuw item" back={{ to: -1, label: "Voorraad" }} />
  <section className="card form-section">
    <label className="field">
      <span className="label">Naam</span>
      <input required … />
    </label>
    <div className="field-row">…twee velden naast elkaar…</div>
    <label className="field">
      <span className="label"><Icon name="note" size={15} /> Notitie</span>
      <textarea … />
    </label>
  </section>
  <SubmitButton busy={saving} className="btn btn-primary btn-lg">Opslaan</SubmitButton>
</form>
```

- Groepeer velden in kaarten (`card form-section`) per onderwerp.
- Label boven het veld. Optioneel? `<span className="optional">· uitleg</span>` achter het label. Uitleg onder
  een veld in `.hint`.
- Verplichte velden krijgen `required`, geen sterretje.
- **Elk formulier waarin je iets registreert heeft een notitieveld**, en waar het past een verkoper (`VendorField`).
- Automatisch ingevulde velden krijgen klasse `auto` (zacht blauw) tot de gebruiker ze aanpast.
- Fout in een veld: `aria-invalid`. Fout van de server: `<p className="error">` boven de knop.
- Kant-en-klare velden: `VendorField`, `TreeSelect` (categorie, plaats), `TagPicker`, `QuantityField`, `Switch`,
  `ToneSwatches`, `FilePicker`, `ScanButtons`.

### Badges, tags, stipjes, avatars

| Element | Gebruik |
| --- | --- |
| `badge badge-success` | Iets loopt goed (garantie loopt) |
| `badge badge-warning` | Aandacht (bijna op, vervalt binnenkort) |
| `badge badge-danger` | Voorbij (vervallen) |
| `badge badge-accent` | Nieuw of info |
| `badge badge-secondary` | Neutrale status (inactief, gezamenlijk) |
| `tag tone-x` | Tags van de gebruiker |
| `dot tone-x` | Categorie of plaats in een lijst |
| `Avatar` | Leden; `size="sm"` in tekst, gewoon in lijsten, `lg` in kaarten |
| `LevelMeter` | Voorraadniveau t.o.v. het minimum |

Badges zijn kort: 1–3 woorden.

### Meldingen

| Situatie | Component |
| --- | --- |
| Iets is bewaard, verwijderd, verplaatst | `useToast()("Aankoop bewaard")`: blauw, rechtsonder (tablet) of boven de onderbalk |
| Iets gebeurt of lukte half binnen een formulier | `<Alert tone="busy" \| "ok" \| "partial" \| "none">` |
| Iets kan niet ongedaan gemaakt worden | `useConfirm()({ title, body, confirmLabel, danger: true })` |
| Een korte invoer (hoeveelheid, terugbetaling, naam) | `<Sheet>`: onderblad op gsm, venster op tablet |
| Lijst is leeg | `<EmptyState icon title action>` met één zin uitleg en hooguit één knop (`btn-outline btn-sm`) |
| Lijst laadt | `<SkeletonRows rows={5} />` (verschijnt pas na 0,18 s) |

Toasts zijn de bevestiging na een actie. Elke bewaar-, verwijder- of voorraadactie geeft er één, behalve
−/+ in een lijst: daar is het rollende getal de bevestiging (een toast per tik zou storen).
Tekst: wat er gebeurde, in de verleden tijd of als korte vaststelling ("2 pakken erbij", "Item bijgewerkt").

### Iconen

- Lucide-stijl, lijndikte 1,8, inline in `Icon.tsx`. Een nieuw icoon voeg je daar toe (pad van lucide.dev).
- Maten: 13 (in icoontegel) · 14–16 (in knoppen, filters, tekst) · 18 (standaard) · 20 (onderbalk).
- Iconen zijn grijs (`--muted-foreground` of `--faint`), behalve in een knop of tegel.

### Getallen

- Bedragen: `formatCents` → "€ 1.234,56". Datums: `formatDate` → "20 okt 2026". Hoeveelheden: `formatNumber` +
  `unitWord` ("3 flessen").
- Een getal dat kan veranderen terwijl je kijkt (voorraad, tellers): `<Num value={n}>` rolt omhoog of omlaag.
- Een groot totaal dat verschijnt: `useCountUp(cents)` telt op.

---

## 5. Beweging

Curves (in `:root`): `--ease-out` voor bijna alles · `--spring` voor iets dat "klikt" (iconen, schakelaar,
stipjes) · `--ease-in-out` voor heen-en-weer (scanlijn).

| Moment | Animatie | Duur |
| --- | --- | --- |
| Nieuw scherm | inhoud schuift 6px omhoog en verschijnt (automatisch via `.page`) | 0,4 s |
| Lijst verschijnt | rij na rij (`stagger` + `stagger(i)`), 28 ms tussen rijen, max 14 | 0,45 s |
| Tab, segment, menu wisselt | vlak of lijn schuift naar de nieuwe keuze | 0,45 s |
| Getal verandert | rolt in de richting van de verandering (`Num`) | 0,38 s |
| Totaal verschijnt | telt op (`useCountUp`) | 0,9 s |
| Balk of meter | groeit vanaf links / van onder (`.bar`, `LevelMeter`) | 0,5–1 s |
| Onderblad, venster | glijdt in en uit (`Sheet`, bevestigen) | 0,45 s |
| Toast | veert omhoog, glijdt weg | 0,5 / 0,25 s |
| Vinkje | tekent zichzelf (`draw`) | 0,4 s |
| Indrukken | knop schaalt naar 0,97 | 0,15 s |
| Hover | achtergrond of rand verandert, pijltje schuift 2px | 0,2 s |

Regels:

- **`backwards`, nooit `both` of `forwards`.** Een animatie die na afloop een transform laat staan, maakt van het
  element het referentiekader voor vaste elementen (titelbalk, + knop) en breekt die.
- Animeer `transform` en `opacity`, geen breedte, hoogte of marges (behalve de tablijn).
- Eerste keer tonen = rustig. Enkel **veranderingen** krijgen een opvallende animatie (`Num` beweegt pas bij een wijziging).
- "Minder beweging" in het toestel zet alles uit (staat onderaan `styles.css`). Test dat je scherm zonder animatie
  even duidelijk is.

---

## 6. Patronen per soort scherm

**Overzicht** (Aankopen, Voorraad): `PageHead` met `primary` → `Tabs` → zoeken → filters → `card table` → `fab`.

**Detail** (één aankoop, één item): `PageHead` met `back` en `actions` → `detail-grid` met links de kern (bedrag of
voorraad + `dl`-lijst met eigenschappen) en rechts kaarten met `CardHead` (bestanden, geschiedenis, koppelingen) →
onderaan stille knoppen (archiveren, `btn-danger-ghost` verwijderen).

**Formulier**: zie [Formulier](#formulier). Na bewaren: toast + naar het detailscherm.

**Instellingen**: `Tabs` per onderwerp, één kaart per tab, bewerken in een `Sheet`.

---

## 7. Toegankelijkheid

- Aanraakvlakken minstens 44px op aanraakschermen (de klassen regelen dat; maak niets kleiner met inline stijlen).
- Focus is altijd zichtbaar: blauwe ring (`--focus-ring`). Nooit `outline: none` zonder vervanging.
- Iconen zonder tekst: `aria-label`. Decoratieve iconen en tegels: geen label nodig (`aria-hidden` zit in `Icon`).
- Kleur is nooit de enige drager: een badge heeft tekst, een meter heeft een `title`.
- Contrast: tekst op wit is minstens `--muted-foreground`; `--faint` enkel voor iconen en bijzaken.

---

## 8. Kiosk

- Alles bedienbaar met een vinger, zonder hover.
- Na 5 minuten terug naar het begin (zit in `App.tsx`); bouw nooit iets dat daardoor halverwege kapot gaat
  (formulieren bewaren niets automatisch, en dat is goed).
- Bestanden openen in de app (`FileViewer`), nooit in een nieuw tabblad.

---

## 9. Tekst

- Nederlands zoals in Vlaanderen gesproken, met **je/jij**. "Kastickets", "gsm", "verkoper".
- Knoppen zijn werkwoorden of korte zinnen: "Opslaan", "Nieuwe aankoop", "In voorraad zetten", "Terugbetaald".
- Titels zonder punt. Uitleg in één zin.
- Fouten zeggen wat er is en wat je kan doen: "Er ligt nog voorraad op deze plaats. Verplaats die eerst."
- Lege staat: wat er hier komt + hoe je begint. "Nog geen aankopen. Trek een foto van een kasticket: de app vult de rest in."
- Datums als "20 okt 2026", bedragen als "€ 1.234,56", hoeveelheden met het juiste meervoud ("1 fles", "3 flessen").
- Geen jargon ("API", "sync", "entity"), geen uitroeptekens, geen emoji.

---

## 10. Niet doen

- Geen nieuwe kleuren, schaduwen of afrondingen buiten de tokens.
- Geen gekleurde kaarten, geen verlopen behalve het merktegeltje en de icoontegels.
- Geen tweede hoofdknop op één scherm.
- Geen tekst onder 11px (11px enkel voor de onderbalk en eenheden in de stepper).
- Geen `animation-fill-mode: both/forwards` (zie Beweging).
- Geen eigen dialoog of `window.confirm`: gebruik `Sheet` of `useConfirm`.
- Geen nieuwe componentbibliotheek of CSS-framework; bouw op wat hier staat.
- Geen klassenamen die al een component zijn (`alert`, `card`, `row`, `tag`, `badge`, `filter`, `tab`, …) als
  losse toevoeging op iets anders: kies een eigen naam.
- Geen donkere modus (bewuste keuze: Thuis is wit).

---

## 11. Checklist voor elk nieuw onderdeel

Loop deze lijst af voor je iets oplevert:

- [ ] Gebruikt `PageHead`, en waar het past `Tabs`, `filters`, `card`/`CardHead`, `rows`/`table`.
- [ ] Enkel tokens uit `:root`; geen losse kleurcodes, px-schaduwen of lettertypes.
- [ ] Eén hoofdactie (`btn-primary`), met een `fab` op gsm als het een overzichtsscherm is.
- [ ] Notitieveld en (waar het past) verkoper in elk registratieformulier.
- [ ] Lege staat, laadstaat (skeleton) en foutmelding zijn er.
- [ ] Toast na elke actie die iets bewaart of verwijdert (behalve −/+ in een lijst); `useConfirm` voor wat niet terug kan.
- [ ] Animaties enkel uit de tabel in [Beweging](#5-beweging), met `backwards`.
- [ ] Getest op 390px breed (gsm) en 1280px (tablet), en op 820px (tablet rechtop, smalle zijbalk).
- [ ] Geen horizontale scroll; lange namen worden netjes afgekapt.
- [ ] Iconknoppen hebben een `aria-label`; alles werkt met het toetsenbord.
- [ ] Teksten volgen [Tekst](#9-tekst).
- [ ] Nieuw patroon nodig? Bouw het als component, en **voeg het toe aan dit stijlboek**.
