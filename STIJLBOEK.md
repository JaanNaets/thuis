# Stijlboek Thuis

Dit stijlboek is de afspraak voor hoe Thuis eruitziet en aanvoelt. **Raadpleeg het voor je een scherm,
onderdeel of tekst toevoegt of verandert**, en werk het bij als je iets nieuws introduceert.

De stijl volgt moderne SaaS-dashboards, en dan vooral **Bretford** (Dribbble): een lichtgrijs canvas met de
zijbalk erop, één wit paneel met zachte randen, kleine titels, grijze gevulde iconen, ingezette tabellen en één
helder blauw accent. Het mooie zit niet in kleur of versiering, maar in **ritme, uitlijning, zachte lijnen en
vloeiende micro-animaties**.

De bouwstenen staan in code; dit document zegt welke je wanneer gebruikt.

| Wat | Waar |
| --- | --- |
| Kleuren, maten, schaduwen, curves | `src/styles.css`, bovenaan in `:root` |
| Componenten | `src/components/` (vooral `Controls.tsx`, `Page.tsx`, `Motion.tsx`, `Sidebar.tsx`) |
| Navigatie met overgangen | `src/router.tsx` (`Link`, `NavLink`, `useNavigate`) en `src/routes.tsx` |
| Iconen | `src/components/Icon.tsx` |
| Opmaak van bedragen, datums, hoeveelheden | `src/format.ts` |

---

## 1. Principes

1. **Rustig.** Wit en grijs dragen het scherm. Kleur is een signaal, geen decoratie.
2. **Eén accent.** Blauw (`--accent`) voor merk, selectie, info en meldingen. Nergens een tweede accentkleur.
3. **Zwart is de actie.** De hoofdknop is bijna zwart (`btn-primary`), niet blauw.
4. **Dun, zacht en klein.** Lijnen van 1px in lichtgrijs, ruime afrondingen (9–16px), tekst van 13–15px,
   titels die niet schreeuwen (15,5px op tablet).
5. **Grijs is een vlak, geen rand.** Actief, hover, pillen en kopstroken zijn grijze vlakken zonder rand.
6. **Alles lijnt uit.** Eén raster van 4px; kolommen in tabellen staan onder hun kop.
7. **Alles beweegt vloeiend.** Een nieuw scherm vloeit in, een keuze glijdt, een getal rolt. Elke animatie heeft
   een reden, duurt 0,2–0,5 s en gebruikt de vaste curves. Nooit beweging om de beweging.
8. **Mobiel eerst, kiosk mee.** Elk scherm werkt op een gsm met de duim én op de keukentablet met een natte
   vinger (aanraakvlakken van 44px).
9. **Nederlands zoals we het zeggen.** Kort, vriendelijk, "je". Zie [Tekst](#9-tekst).

---

## 2. Tokens

Gebruik altijd de variabele, nooit de kleurcode zelf.

### Kleur

| Variabele | Waarde | Gebruik |
| --- | --- | --- |
| `--canvas` | #f0f0f0 | Achtergrond achter het paneel, waarop de zijbalk staat (enkel tablet) |
| `--background` | #ffffff | Paneel, kaarten, knoppen |
| `--subtle` | #f7f7f7 | Kopstrook van tabellen, notitieblok |
| `--muted` | #f2f2f2 | Pillen (`badge`), secundaire knop, tabs, hover in lijsten |
| `--muted-strong` | #e7e7e7 | Hover van secundaire knoppen, lege streepjes in de meter |
| `--nav-active` | #e2e2e2 | Actief item in de zijbalk |
| `--field` | #fcfcfc | Invoervelden (worden wit bij focus) |
| `--foreground` | #1d1d1f | Hoofdtekst, titels |
| `--text-soft` | #3a3a3c | Tekst in tabelkolommen, menu en knoppen |
| `--muted-foreground` | #8a8a8e | Uitleg, metadata, kolomkoppen, gevulde iconen |
| `--faint` | #b0b0b4 | Chevrons, tellers in de zijbalk, scheidingstekens |
| `--border` | #ebebeb | Randen van paneel en kaarten, lijn onder balken |
| `--divider` | #f1f1f1 | Lijnen tussen rijen en secties (ingezet, raken de rand niet) |
| `--input` | #e6e6e6 | Randen van velden, outline-knoppen en filters |
| `--primary` | #28282a | Hoofdknop, zwevende + knop |
| `--accent` (+ `-soft`, `-line`, `-ink`) | #2f86eb | Blauw: focus, selectie, actieve filter, toasts, automatisch ingevulde velden |
| `--accent-gradient` | #62aefa → #2f80ed | Enkel de icoontegeltjes in kaarttitels |
| `--brand-gradient` | #5b8cff → #4a5ff0 | Enkel het merktegeltje in de zijbalk |
| `--success*`, `--warning*`, `--danger*` | | Status: garantie loopt / bijna op / vervallen |

**Tonen** (`tone-peach`, `tone-butter`, `tone-sage`, `tone-mint`, `tone-sky`, `tone-lilac`, `tone-rose`) zijn de
kleuren van categorieën, tags, plaatsen en leden. Ze geven `--tone`, `--tone-soft`, `--tone-line`, `--tone-mid`
en `--tone-ink`. Gebruik ze **enkel** voor stipjes (`.dot`), avatars, het vierkantje voor een rij (`.row-media`),
de iconen van plaatsen in de zijbalk en tags. Nooit voor knoppen, kaarten of grote vlakken.

### Typografie

- Lettertype: **Inter** (variabel, met optische grootte), letterspatiëring licht negatief (−0,006em, titels
  −0,012 tot −0,025em). Cijfers in kaartnummers en barcodes: Geist Mono (`.mono`).
- Bedragen en aantallen altijd met `font-variant-numeric: tabular-nums` (klassen `.num`, `.row-end`, `.amount-big`).

| Rol | Grootte | Gewicht |
| --- | --- | --- |
| Paginatitel | 15,5px (tablet, in de kopregel), 26px (gsm) | 600 |
| Groot bedrag | 30–38px | 600, −0,03em |
| Kaarttitel | 14px | 500 |
| Gewone tekst | 14px (muis), 15px (aanraking) | 400 |
| Menu in de zijbalk | 13,5px | 450, actief 600 |
| Rijtitel | 14px | 500 |
| Kolomkop, metadata, uitleg | 12,5–13px | 400 |
| Badges, tellers | 11,5–12px | 500 |

### Maten

- Raster van **4px**. Gebruikelijke afstanden: 4, 8, 12, 16, 20, 24, 32.
- Afronding: `--radius-sm` 7 (badges, tags) · `--radius` 9 (knoppen, menu-items, avatar in de balk) ·
  `--radius-md` 10 (velden, filters, tabs, rijen, kopstrook) · `--radius-lg` 14 (kaarten, werkplek) ·
  `--radius-xl` 16 (paneel, onderblad, zoekpalet).
- Schaduw: bijna niets. `--shadow-xs` op knoppen en filters; kaarten hebben enkel een rand. `--shadow-lg` enkel voor
  wat zweeft (zoekpalet, onderblad, keuzelijst, + knop).
- Hoogtes: knop 34px · klein 30px (32px in de balken) · groot 42px · veld 38px. Op aanraakschermen 44/36px.

---

## 3. Layout

### Gsm (smaller dan 768px)

- Witte achtergrond, inhoud met 16px marge.
- **Onderbalk** met vijf tabs (Aankopen, Uitgaven, Voorraad, Kaarten, Meer); een gast heeft er twee (Projecten, Meer).
  Een grijs vlak schuift naar de actieve tab. Wat niet in de onderbalk past (Projecten, Verkopers) en het wisselen
  van huishouden staat bovenaan **Meer** (`PhoneMenu` in `SettingsPage.tsx`).
- **Zwevende + knop** rechtsonder voor de hoofdactie van het scherm.
- **Kleine titelbalk** bovenaan die verschijnt zodra de grote titel uit beeld scrollt (zit in `PageHead`).
- Tabelkolommen verdwijnen: de info staat in de grijze regel onder de titel (`.narrow-only`).

### Tablet en kiosk (vanaf 768px)

```
┌ canvas #f0f0f0 ────────────────────────────────────────────────────────────┐
│ ┌ werkplek ──┐  ┌ paneel (wit, rand, 16px) ──────────────────────────────┐ │
│ │ ▣ Thuis    │  │ Aankopen › Wasmachine                  [+ Nieuw] │ [J] │ │  ← paneelbalk 58px
│ └────────────┘  ├────────────────────────────────────────────────────────┤ │
│  ────────────   │ Wasmachine Bosch Serie 6  uitleg            [Bewerken] │ │  ← kopregel 56px
│ [⌕ Zoeken ⌘K]   ├────────────────────────────┬───────────────────────────┤ │
│ Menu            │ zijkolom (320px)           │ ┌ kaart ────────────────┐ │ │
│ ▮ Aankopen 24   │ secties met                │ │ ▣ Bewijsstukken       │ │ │
│   Uitgaven      │ ingezette lijnen           │ │ ┌ kopstrook ────────┐ │ │ │
│   Voorraad  2   │                            │ │ ingezette rijen       │ │ │
│   Kaarten       │                            │ └───────────────────────┘ │ │
│ Plaatsen        │                            │                           │ │
│ ● Keuken   ⌃    │                            │                           │ │
│ │ Koelkast      │                            │                           │ │
│ ● Berging       │                            │                           │ │
│ + Plaats toev.  │                            │                           │ │
│ ⚙ Instellingen  └────────────────────────────┴───────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Canvas** met links de **zijbalk** (248px, tussen 768 en 1100px enkel iconen: 68px) en rechts een wit
  **paneel** (8px marge, rand `--border`, afronding 16px). Het paneel scrollt zelf; de zijbalk blijft staan.
- **Zijbalk** (`Sidebar.tsx`), van boven naar onder: werkplek in een wit blok (het huishouden; een klik opent een
  menu om te wisselen of een nieuw huishouden te maken), een dun lijntje, het zoekveld (opent het
  [zoekpalet](#zoekpalet-commandpalette)), sectie "Menu" met tellers, sectie "Projecten" (lopende projecten met een
  gekleurd icoon), sectie "Plaatsen" (de plaatsenboom), onderaan Instellingen. Het actieve item is een grijze pil
  (`--nav-active`) die meeglijdt.
- **Paneelbalk** (58px, plakt bovenaan): kruimelpad met `›` links ("Thuis › Voorraad" of "Voorraad › Penne"),
  rechts de hoofdactie, een verticaal lijntje en wie aangemeld is (afgerond vierkantje, linkt naar Instellingen).
- **Kopregel** (56px, lijn eronder over de hele breedte): kleine titel + badge + grijze uitleg links, acties op
  het item rechts (`btn-outline btn-sm`).
- Inhoud daaronder met 20px marge. Detailschermen en Uitgaven gebruiken de [zijkolom](#zijkolom-split).
- Geen + knop: de hoofdactie staat in de paneelbalk.

### Opbouw van elk scherm

```
PageHead                 paneelbalk (kruimelpad, primary, avatar) + kopregel (titel, badge, uitleg, actions)
Tabs                     als er weergaves zijn (Alles 10 · Bijna op 2 · …)
toolbar                  zoeken (+ scanknop)
filters                  filterpillen
card / card table        de inhoud — of .split met zijkolom en kaarten
fab                      + knop (enkel gsm, zelfde actie als primary)
```

---

## 4. Componenten

### Paginakop: `PageHead` (`Page.tsx`)

Elk scherm begint ermee. Hij maakt de paneelbalk en de kopregel (tablet) en de grote titel met kleine titelbalk (gsm).

```tsx
<PageHead
  title="Voorraad"
  badge={<span className="badge badge-warning">2 bijna op</span>}   // optioneel, kort
  description="Wat er in huis is, waar het ligt en wanneer het vervalt"
  back={{ to: "/voorraad", label: "Voorraad" }}                       // enkel op detail- en formulierschermen
  actions={<Link className="btn btn-outline btn-sm" …>Bewerken</Link>} // acties op dit item, rechts in de kopregel
  primary={<Link className="btn btn-primary" …><Icon name="plus" size={16} /> Nieuw item</Link>} // in de paneelbalk
/>
```

- Een overzichtsscherm heeft `primary` (en een `.fab` met dezelfde actie). Een detailscherm heeft `back` en `actions`.
- Formulieren: `back={{ to: -1, label: … }}` (gewoon terug), geen `primary`.
- Beschrijving: één korte zin (op tablet staat ze naast de titel en wordt ze afgekapt), zonder punt als het een opsomming is.

### Zijkolom: `split`

Voor detailschermen en Uitgaven: links de kern, rechts de kaarten (zoals "Product designer" in Bretford).

```tsx
<div className="split">
  <aside className="split-aside">
    <section className="card">…kern: bedrag of voorraad, dl-lijst…</section>
    <section className="card">…nog een sectie…</section>
  </aside>
  <div className="split-main">
    <section className="card"><CardHead … /> …</section>
    …stille knoppen (archiveren, verwijderen)…
  </div>
</div>
```

- Op gsm en smalle tablets staan beide onder elkaar en zijn de secties gewone kaarten.
- Vanaf 960px: zijkolom van 320px met een lijn rechts tot onderaan het paneel; de kaarten in de zijkolom verliezen
  hun rand en worden secties, gescheiden door een ingezette lijn. Zet de `.split` direct in `.page`, na `PageHead`.

### Knoppen

| Klasse | Wanneer |
| --- | --- |
| `btn btn-primary` | De ene hoofdactie per scherm of formulier (Opslaan, Nieuwe aankoop) |
| `btn btn-outline` | Gewone acties naast de hoofdactie (Bewerken, Scannen, Uit foto) |
| `btn btn-ghost` | Stille acties in een rij (−/+ in de stepper, archiveren) |
| `btn btn-danger` | Enkel als bevestiging in het venster "verwijderen?" |
| `btn btn-danger-ghost` | De knop die naar dat venster leidt ("Verwijderen") |
| `btn-sm`, `btn-lg`, `btn-icon`, `btn-block` | Grootte en vorm |

- Icoon links van de tekst, 15–16px. In outline- en ghostknoppen is het icoon **gevuld en grijs**, de tekst donker.
- Knop die iets bewaart: `SubmitButton` (draait een spinner tijdens het bewaren).
- Een knop met enkel een icoon krijgt altijd een `aria-label`.

### Kaart: `card` + `CardHead`

```tsx
<section className="card">
  <CardHead icon="clock" title="Geschiedenis" description="Elke wijziging, met wie en waar" action={…} />
  <ul className="rows">…</ul>            // of <div className="card-body">…</div>
</section>
```

- Rand `--border`, afronding 14px, geen echte schaduw.
- Elke kaart met een titel krijgt het **blauwe icoontegeltje** (20px, `CardHead` doet dat). Titel 14px, gewicht 500.
- Inhoud zonder rijen in `card-body`. Een voetnoot (bv. "Bewaard door Jaan") in `.footnote` (ingezette lijn erboven).
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

- Rijen staan **ingezet** in hun kaart (8px): de lijnen ertussen (`--divider`) raken de rand niet, en hover is een
  afgerond grijs vlak.
- Een rij is 58px hoog, met `row-media` (36px vierkant, of `round` voor personen), titel, grijze regel en rechts
  een waarde of `row-chevron`.
- Rij met eigen knoppen (zoals −/+): de rij zelf is een `div.row`, de link zit in `.row-link`.
- Groeperen: `<li className="group-row"><span className="dot tone-x" /> Voeding <span className="group-count">5</span></li>`
  (een stil grijs label, geen balk).

### Tabel (tablet): `card table` + `table-head` + `col`

Dezelfde rijen worden op tablet een tabel met een **grijze kopstrook binnen de kaart** (afgerond, zonder rand).

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

- Kolommen staan in `styles.css` als `--cols` per tabel (`.table-purchases`, `.table-stock`, `.table-entries`,
  `.table-projects`, `.table-vendors`).
  Een nieuwe tabel krijgt een eigen klasse met `--cols`; de eerste kolom is altijd `minmax(0, 1fr)`.
- Hooguit 4 kolommen tussen 768 en 1100px; extra kolommen krijgen `xl` (verschijnen pas vanaf 1100px).
- Wat op gsm in de grijze regel staat, heeft `narrow-only`; wat enkel in de tabel onder de titel moet, `wide-only`.
- Lege cel: een streepje `—` in `.muted`.

### Tabs met tellers: `Tabs`

```tsx
<Tabs label="Voorraad" value={tab} onChange={setTab}
  tabs={[{ value: "all", label: "Alles", count: 10 }, { value: "low", label: "Bijna op", count: 2 }]} />
```

Een grijze pil met een wit vlak dat naar de actieve tab glijdt; tellers rollen bij een wijziging. Voor
verschillende **weergaves van dezelfde lijst** (of de onderwerpen in Instellingen). Niet voor navigatie naar een
ander scherm.

### Filters: `FilterSelect` en `FilterToggle`

```tsx
<div className="filters">
  <FilterSelect label="Plaats" all="Overal" value={locationId} onChange={setLocationId} options={…} />
  <FilterToggle on={x} onChange={setX}><Icon name="store" size={14} /> Colruyt</FilterToggle>
</div>
```

Witte pil met dunne rand: grijs label, donkere waarde. Een actieve filter kleurt blauw. Filters staan onder het zoekveld.
Een filter waarnaar je vanuit een ander scherm wil linken, staat in het adres (zoals `?plaats=` en `?verkoper=`).

### Segmenten: `Segmented`

Keuze tussen 2–4 opties in een formulier (Betaald door, Voor wie, Soort). Het witte vlak schuift mee.
Meer dan 4 opties: gebruik een `select`.

### Zoekpalet: `CommandPalette`

Opent met **⌘K / Ctrl K** of het zoekveld in de zijbalk (`useSession().openSearch()` vanuit een scherm). Zoekt
zonder op hoofdletters of accenten te letten in schermen, projecten, aankopen, voorraad, kaarten, verkopers en
plaatsen (een gast: enkel zijn projecten en hun aankopen).
Pijltjes kiezen (een grijs vlak glijdt mee), Enter opent, Escape sluit. Iets nieuws dat je moet kunnen vinden?
Voeg het toe als groep in `CommandPalette.tsx`.

### Plaatsenboom (zijbalk)

De hoofdplaatsen met elk een gekleurd gevuld speldje (vaste volgorde van tonen), een pijltje om open te klappen
(de rij groeit van `0fr` naar `1fr`, kinderen schuiven één voor één in) en een hulplijn links van de kinderen.
Een plaats openen = `/voorraad?plaats=<id>`. Onderaan "+ Plaats toevoegen" (naar `/meer?tab=plaatsen`).

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

- De balken lopen over de volle breedte; de inhoud blijft 680px breed (dat regelt `.page.form`).
- Groepeer velden in kaarten (`card form-section`) per onderwerp.
- Velden: 38px hoog, bijna wit (`--field`), afronding 10px, dunne rand; bij focus wit met een blauwe ring.
- Label boven het veld. Optioneel? `<span className="optional">· uitleg</span>` achter het label. Uitleg onder
  een veld in `.hint`.
- Verplichte velden krijgen `required`, geen sterretje.
- **Elk formulier waarin je iets registreert heeft een notitieveld**, en waar het past een verkoper (`VendorField`).
- Automatisch ingevulde velden krijgen klasse `auto` (zacht blauw) tot de gebruiker ze aanpast.
- Fout in een veld: `aria-invalid`. Fout van de server: `<p className="error">` boven de knop.
- Kant-en-klare velden: `VendorField`, `TreeSelect` (categorie, plaats), `TagPicker`, `QuantityField`, `Switch`,
  `ToneSwatches`, `FilePicker`, `ScanButtons`.

### Verdelen: `SplitEditor` en `DefaultSplitField` (`SplitEditor.tsx`)

Elke uitgave (aankoop, terugkerende kost) zegt **wie betaalde** en **hoe het verdeeld wordt**. Altijd met deze
component, nooit met eigen velden.

```tsx
const [split, setSplit] = useState(() => initialSplitState({ meId, people, defaults, existing }));
<section className="card form-section">
  <SplitEditor amount={cents} people={people} pots={pots} meId={meId} value={split} onChange={setSplit} />
</section>
// bij bewaren:
const built = buildSplit(split, cents); // { payments, split } of { error }
```

- `people` en `pots` komen uit `splitCandidates(taxonomy, projectId, full, used)` (`taxonomy.ts`): in een project de
  deelnemers en de kas van dat project, anders de bewoners en de potten van het huishouden.
- Betaald door: segmenten (≤ 4 keuzes) of een keuzelijst; "Meerdere betalers" geeft per betaler een bedrag.
- Verdeling: Gelijk · Procent · Delen · Bedrag, en "Per lijn van het ticket" (`allowLines={false}` bij een vaste kost).
  Tik op een avatar om iemand mee te laten doen of niet (blauw vinkje). Rechts staat meteen wie hoeveel draagt.
- Onderaan één statusregel: groen "Klopt", of rood wat er nog niet klopt. Bewaren kan pas als het klopt.
- De gewone verdeling van een huishouden of project (bv. 60/40) kies je met `DefaultSplitField`
  (`defaultSplitDraft` → `buildDefaultSplit`). Een nieuwe uitgave begint ermee.

### Saldo's en geld: `Ledger.tsx`

Uitgaven en projecten tonen geld met dezelfde onderdelen:

| Component | Wat |
| --- | --- |
| `BalancesCard` | Wie moet wie (voorgestelde overschrijvingen), met "Terugbetaald" en "Lening" |
| `PotsCard` | Potten of de kas van een project: wat erin zit, per lid wat die nog moet bijstorten, Storten/Afhalen |
| `MoneySheet` | Eén onderblad voor elke geldbeweging: terugbetaling, lening, storting, afhaling |
| `EntryRow` | Een uitgave of geldbeweging in een `table-entries` (`inProject` verbergt de projectnaam) |
| `RecurringCard` | Vaste kosten (huur, abonnementen) die zichzelf inboeken |
| `MonthTotal`, `CategoryBars` | Groot totaal dat optelt en balken per categorie |

- "Jij/jou" in plaats van je eigen naam: `useWords(taxonomy)` → "Sam moet jou nog", "Jij moet Sam nog".
- Een negatief saldo van een pot is rood (`.negative`); verder geen kleur op bedragen.

### Verkopers: `VendorLogo`

Het logo van een verkoper in het vierkantje van een rij (`row-media`, op wit en nooit bijgesneden), of anders het
icoon van de soort (winkel, webshop, vakman, dienst, particulier). `className="lg"` voor 52px bovenaan de fiche.
Een verkopersfiche bewaart **nooit een wachtwoord**: enkel klantnummer, op wiens naam en waarmee je aanmeldt.

### Kleine bouwstenen

| Klasse of component | Gebruik |
| --- | --- |
| `AvatarStack` (`ProjectList.tsx`) | Deelnemers naast elkaar, overlappend, "+3" bij veel mensen |
| `.link-quiet` | Link in een `dl` of tekst: geen kleur, een zacht lijntje eronder |
| `.link-button` | Stille blauwe tekstknop rechts naast een label ("Meerdere betalers") |
| `a.note-link` | Een notitieblok dat linkt (de winkel bij een klantenkaart) |
| `.budget` | Balk die volloopt tot het budget; rood erover (`data-over`) |
| `.only-phone` | Enkel op een gsm (bv. `PhoneMenu`) |
| `.field-row-wide` | Twee lange velden (IBAN, ondernemingsnummer) die pas vanaf 560px naast elkaar staan |

### Huishoudens en toegang

- Alles hoort bij het gekozen huishouden. De API krijgt dat mee via `apiUrl()`/`api` (`?hh=`), ook voor `<img>`:
  gebruik dus altijd `apiUrl("/…")` voor een afbeelding of bestand uit de API.
- `useSession()` geeft `full`: `true` = volledige toegang, `false` = **gast** (enkel de projecten waarin die zit).
  Een scherm toont enkel wat een gast mag: geen voorraad, kaarten, verkopers, instellingen van het huishouden,
  en in een project geen knoppen om het project of de deelnemers te beheren. De API weigert het hoe dan ook;
  de app verbergt het zodat een gast nooit tegen een fout aanloopt.
- Een nieuw scherm dat een gast mag openen, staat in `GUEST_PATHS` (`App.tsx`).

### Badges, tags, stipjes, avatars

| Element | Gebruik |
| --- | --- |
| `badge` | Grijze pil zonder rand: neutrale status ("Lid", "inactief") |
| `badge badge-success` | Iets loopt goed (garantie loopt) |
| `badge badge-warning` | Aandacht (bijna op, vervalt binnenkort) |
| `badge badge-danger` | Voorbij (vervallen) |
| `badge badge-accent` | Nieuw of info ("119 connection uploaded" in de referentie) |
| `tag tone-x` | Tags van de gebruiker |
| `dot tone-x` | Categorie of plaats in een lijst |
| `Avatar` | Leden: pastel rondje met een dunne gekleurde letter; `size="sm"` in tekst, gewoon in lijsten, `lg` in kaarten |
| `LevelMeter` | Voorraadniveau t.o.v. het minimum |

Badges zijn kort: 1–3 woorden.

### Meldingen

| Situatie | Component |
| --- | --- |
| Iets is bewaard, verwijderd, verplaatst | `useToast()("Aankoop bewaard")`: lichtblauw met blauwe rand, rechtsonder (tablet) of boven de onderbalk |
| Iets gebeurt of lukte half binnen een formulier | `<Alert tone="busy" \| "ok" \| "partial" \| "none">` |
| Iets kan niet ongedaan gemaakt worden | `useConfirm()({ title, body, confirmLabel, danger: true })` |
| Een korte invoer (hoeveelheid, terugbetaling, naam) | `<Sheet>`: onderblad op gsm, venster op tablet |
| Lijst is leeg | `<EmptyState icon title action>` met één zin uitleg en hooguit één knop (`btn-outline btn-sm`) |
| Lijst laadt | `<SkeletonRows rows={5} />` (verschijnt pas na 0,18 s) |

Toasts zijn de bevestiging na een actie. Elke bewaar-, verwijder- of voorraadactie geeft er één, behalve
−/+ in een lijst: daar is het rollende getal de bevestiging (een toast per tik zou storen).
Tekst: wat er gebeurde, in de verleden tijd of als korte vaststelling ("2 pakken erbij", "Item bijgewerkt").

### Iconen

Twee soorten, inline in `Icon.tsx`:

- **Gevuld voor dingen** (bon, kaart, doos, portefeuille, speld, tandwiel, …): Phosphor "fill" (phosphoricons.com).
  Grijs (`--muted-foreground`) in menu, knoppen en rijen; donker als het item actief is.
- **Lijnen voor richtingen en handelingen** (plus, min, kruis, vinkje, chevrons, pijl, zoeken): Lucide-stijl, 1,9 dik.
- Een nieuw icoon: pad kopiëren van een van beide sites naar de juiste lijst (`FILLED` of `LINES`).
- Maten: 13 (in icoontegel) · 14–16 (knoppen, filters, tekst) · 17 (zijbalk) · 18 (standaard) · 21 (onderbalk).

### Getallen

- Bedragen: `formatCents` → "€ 1.234,56". Datums: `formatDate` → "20 okt 2026". Hoeveelheden: `formatNumber` +
  `unitWord` ("3 flessen").
- Een getal dat kan veranderen terwijl je kijkt (voorraad, tellers): `<Num value={n}>` rolt omhoog of omlaag.
- Een groot totaal dat verschijnt: `useCountUp(cents)` telt op.

---

## 5. Beweging

Curves (in `:root`): `--ease-out` voor bijna alles · `--spring` voor iets dat "klikt" (iconen, schakelaar,
stipjes) · `--ease-in-out` voor heen-en-weer (scanlijn).

### Schermwissels (View Transitions)

Elke navigatie loopt via een **View Transition**. Daarvoor gebruikt de app een data-router (`createBrowserRouter`
in `main.tsx`, routes in `routes.tsx`) en eigen `Link`, `NavLink` en `useNavigate` in `src/router.tsx` die
`viewTransition` standaard aanzetten.

- **Importeer `Link`, `NavLink` en `useNavigate` altijd uit `src/router.tsx`**, nooit uit `react-router`.
  (`useParams`, `useSearchParams`, `useLocation` mogen wel rechtstreeks.)
- Op tablet vloeit **enkel het paneel** over (`view-transition-name: panel`); de zijbalk blijft live, zodat de
  grijze pil naar het nieuwe item glijdt. Op gsm vloeit het scherm over en blijft de onderbalk staan.
- De inhoud van het nieuwe scherm schuift daarbij 5px omhoog (automatisch via `.page`; in een `.split` komen
  zijkolom en kaarten na elkaar).
- Filters in het adres (`setSearchParams`) wisselen **zonder** overgang: dat is geen nieuw scherm.
- Een groot scherm dat apart geladen wordt (kaarten, ±1 MB barcodecode) is een `lazy` route in `routes.tsx`: de
  router wacht tot het geladen is, zodat de overgang vloeiend blijft, en toont zolang een blauw laadstreepje.

### Micro-animaties

| Moment | Animatie | Duur |
| --- | --- | --- |
| Nieuw scherm | paneel vloeit over, inhoud schuift 5px omhoog | 0,26 / 0,45 s |
| Lijst verschijnt | rij na rij (`stagger` + `stagger(i)`), 28 ms tussen rijen, max 14 | 0,45 s |
| Tab, segment, menu, zoekresultaat wisselt | grijs of wit vlak glijdt naar de nieuwe keuze | 0,45–0,5 s |
| Boom klapt open | rij groeit (`grid-template-rows`), kinderen schuiven één voor één in, pijltje draait | 0,4 s |
| Getal verandert | rolt in de richting van de verandering (`Num`) | 0,38 s |
| Totaal verschijnt | telt op (`useCountUp`) | 0,9 s |
| Balk of meter | groeit vanaf links / van onder (`.bar`, `LevelMeter`) | 0,5–1 s |
| Onderblad, venster, zoekpalet | glijdt en schaalt in en uit (`@starting-style`) | 0,35–0,45 s |
| Toast | veert omhoog, glijdt weg | 0,5 / 0,25 s |
| Vinkje | tekent zichzelf (`draw`) | 0,4 s |
| Indrukken | knop schaalt naar 0,97, icoon in menu naar 0,86 | 0,15 s |
| Hover | achtergrond of rand verandert, pijltje schuift 2px, + draait 90° | 0,2–0,35 s |

Regels:

- **`backwards`, nooit `both` of `forwards`.** Een animatie die na afloop een transform laat staan, maakt van het
  element het referentiekader voor vaste elementen (titelbalk, + knop) en breekt die.
- Animeer `transform` en `opacity`. Uitzonderingen: de tablijn/het tabvlak (breedte) en de boom (`grid-template-rows`).
- Eerste keer tonen = rustig. Enkel **veranderingen** krijgen een opvallende animatie (`Num` beweegt pas bij een wijziging).
- Een venster opent met `@starting-style` en sluit met `transition-behavior: allow-discrete` (zie `dialog.sheet`,
  `dialog.palette`): nooit een venster dat zonder animatie verschijnt of verdwijnt.
- "Minder beweging" in het toestel zet alles uit, ook de schermwissels (staat onderaan `styles.css`). Test dat je
  scherm zonder animatie even duidelijk is.

---

## 6. Patronen per soort scherm

**Overzicht** (Aankopen, Voorraad): `PageHead` met `primary` → `Tabs` → zoeken → filters → `card table` → `fab`.

**Detail** (één aankoop, één item): `PageHead` met `back` en `actions` → `split`: in de zijkolom de kern (bedrag of
voorraad + `dl`-lijst met eigenschappen, tags, notitie), rechts kaarten met `CardHead` (bestanden, geschiedenis,
koppelingen) → onderaan rechts stille knoppen (archiveren, `btn-danger-ghost` verwijderen).

**Uitgaven**: `split` met in de zijkolom wie-moet-wie, de potten en de maand; rechts de lijst van de maand en de
terugkerende kosten.

**Project**: `split` met in de zijkolom het totaal (+ budget), wie meedoet (gasten toevoegen in een `Sheet`) en,
bij een eigen saldo, wie-moet-wie en de kas; rechts per categorie, de uitgaven en de vaste kosten; onderaan
archiveren (verwijderen enkel als het project leeg is).

**Verkoper**: `split` met in de zijkolom logo en totaal, contactgegevens, je account, bedrijf en contactpersonen;
rechts klantenkaarten, per jaar, lopende garanties, aankopen, voorraad en vestigingen. Contacten en vestigingen
bewerk je in een `Sheet`.

**Formulier**: zie [Formulier](#formulier). Na bewaren: toast + naar het detailscherm.

**Instellingen**: `Tabs` per onderwerp (in het adres: `/meer?tab=plaatsen`), één kaart per tab, bewerken in een `Sheet`.

---

## 7. Toegankelijkheid

- Aanraakvlakken minstens 44px op aanraakschermen (de klassen regelen dat; maak niets kleiner met inline stijlen).
- Focus is altijd zichtbaar: blauwe ring (`--focus-ring`). Nooit `outline: none` zonder vervanging.
- Iconen zonder tekst: `aria-label`. Decoratieve iconen en tegels: geen label nodig (`aria-hidden` zit in `Icon`).
- Kleur is nooit de enige drager: een badge heeft tekst, een meter heeft een `title`.
- Contrast: tekst op wit is minstens `--muted-foreground`; `--faint` enkel voor iconen en bijzaken.
- Het zoekpalet is een `listbox` met `aria-activedescendant`; dichtgeklapte boomtakken zijn `inert`.

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
- Geen randen rond grijze vlakken (actief item, pil, kopstrook): grijs is een vlak.
- Geen lijnen tussen rijen of secties die tot tegen de rand lopen: ze zijn ingezet.
- Geen tekst onder 11px (11px enkel voor de onderbalk en eenheden in de stepper).
- Geen `animation-fill-mode: both/forwards` (zie Beweging).
- Geen `Link`, `NavLink` of `useNavigate` uit `react-router`: gebruik `src/router.tsx`.
- Geen eigen dialoog of `window.confirm`: gebruik `Sheet` of `useConfirm`.
- Geen nieuwe componentbibliotheek of CSS-framework; bouw op wat hier staat.
- Geen klassenamen die al een component zijn (`alert`, `card`, `row`, `tag`, `badge`, `filter`, `tab`, …) als
  losse toevoeging op iets anders: kies een eigen naam.
- Geen donkere modus (bewuste keuze: Thuis is wit).

---

## 11. Checklist voor elk nieuw onderdeel

Loop deze lijst af voor je iets oplevert:

- [ ] Gebruikt `PageHead`, en waar het past `Tabs`, `filters`, `card`/`CardHead`, `rows`/`table`, `split`.
- [ ] Enkel tokens uit `:root`; geen losse kleurcodes, px-schaduwen of lettertypes.
- [ ] Eén hoofdactie (`btn-primary`), met een `fab` op gsm als het een overzichtsscherm is.
- [ ] Navigatie via `src/router.tsx`; een nieuw scherm staat in `routes.tsx` (en in het zoekpalet als je het moet kunnen vinden).
- [ ] Gevulde iconen voor dingen, lijniconen voor richtingen en handelingen.
- [ ] Notitieveld en (waar het past) verkoper in elk registratieformulier.
- [ ] Lege staat, laadstaat (skeleton) en foutmelding zijn er.
- [ ] Toast na elke actie die iets bewaart of verwijdert (behalve −/+ in een lijst); `useConfirm` voor wat niet terug kan.
- [ ] Animaties enkel uit de tabel in [Beweging](#5-beweging), met `backwards`.
- [ ] Getest op 390px breed (gsm) en 1280px (tablet), en op 820px (tablet rechtop, smalle zijbalk).
- [ ] Werkt voor een gast (`full` is `false`) of is voor een gast verborgen; afbeeldingen uit de API via `apiUrl`.
- [ ] Geen horizontale scroll; lange namen worden netjes afgekapt.
- [ ] Iconknoppen hebben een `aria-label`; alles werkt met het toetsenbord.
- [ ] Teksten volgen [Tekst](#9-tekst).
- [ ] Nieuw patroon nodig? Bouw het als component, en **voeg het toe aan dit stijlboek**.
