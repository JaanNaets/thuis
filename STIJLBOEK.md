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
| Lijsten, velden en items | `src/components/Fields.tsx`, `ItemsView.tsx` en `shared/fields.ts` |
| Rechten | `shared/access.ts` (wat een rol mag, per lijst en per veld) |
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
| `--subtle` | #f7f7f7 | Kopstrook van tabellen |
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
| `--success*`, `--warning*`, `--danger*` | | Status: loopt / bijna voorbij / voorbij |

**Tonen** (`tone-peach`, `tone-butter`, `tone-sage`, `tone-mint`, `tone-sky`, `tone-lilac`, `tone-rose`) zijn de
kleuren van projecten, tags en personen. Ze geven `--tone`, `--tone-soft`, `--tone-line`, `--tone-mid`
en `--tone-ink`. Gebruik ze **enkel** voor stipjes (`.dot`), avatars, het vierkantje voor een rij (`.row-media`),
de iconen van projecten in de zijbalk en tags. Nooit voor knoppen, kaarten of grote vlakken.

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
- **Onderbalk** met drie tabs: **Overzicht**, **Zoeken** (opent het [zoekpalet](#zoekpalet-commandpalette)) en **Ik**.
  Een grijs vlak schuift naar de actieve tab. Een project en een fiche horen bij Overzicht.
- **Zwevende + knop** rechtsonder voor de hoofdactie van het scherm.
- **Kleine titelbalk** bovenaan die verschijnt zodra de grote titel uit beeld scrollt (zit in `PageHead`).
- Tabelkolommen verdwijnen: de info staat in de grijze regel onder de titel (`.narrow-only`).

### Tablet en kiosk (vanaf 768px)

```
┌ canvas #f0f0f0 ────────────────────────────────────────────────────────────┐
│ ┌ werkplek ──┐  ┌ paneel (wit, rand, 16px) ──────────────────────────────┐ │
│ │ ▣ Thuis    │  │ Huishouden › Wijnkelder           [+ Wijn toevoegen] │J│ │  ← paneelbalk 58px
│ └────────────┘  ├────────────────────────────────────────────────────────┤ │
│ [⌕ Zoeken ⌘K]   │ Wijnkelder  uitleg                         [Instellen] │ │  ← kopregel 56px
│ ▮ Overzicht  2  ├────────────────────────────────────────────────────────┤ │
│ Projecten       │ Wijnen 12 · Wijnhuizen 3                               │ │  ← tabs per lijst
│ ● Huishouden ⌃  ├───────────────────────────────┬────────────────────────┤ │
│ │ Wijnkelder    │ zijkolom (320px)              │ ┌ kaart ─────────────┐ │ │
│ │ Fietsen       │ Subprojecten                  │ │ zoeken, filters    │ │ │
│ ● Verbouwing    │ Wie                           │ │ tabel met items    │ │ │
│ + Project       │                               │ └────────────────────┘ │ │
│ ◉ Jaan          └───────────────────────────────┴────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Canvas** met links de **zijbalk** (248px, tussen 768 en 1100px enkel iconen: 68px) en rechts een wit
  **paneel** (8px marge, rand `--border`, afronding 16px). Het paneel scrollt zelf; de zijbalk blijft staan.
- **Zijbalk** (`Sidebar.tsx`), van boven naar onder: "Thuis" in een wit blok (naar het overzicht), het zoekveld
  (opent het [zoekpalet](#zoekpalet-commandpalette)), "Overzicht" met een teller, de
  [projectboom](#projectboom-zijbalk), onderaan jouw naam (naar `/ik`). Het actieve item is een grijze pil
  (`--nav-active`) die meeglijdt.
- **Paneelbalk** (58px, plakt bovenaan): kruimelpad met `›` links ("Huishouden › Wijnkelder"), rechts de
  hoofdactie, een verticaal lijntje en jouw avatar (linkt naar `/ik`).
- **Kopregel** (56px, lijn eronder over de hele breedte): kleine titel + badge + grijze uitleg links, acties op
  het item rechts (`btn-outline btn-sm`).
- Inhoud daaronder met 20px marge. Een project en een fiche gebruiken de [zijkolom](#zijkolom-split).
- Geen + knop: de hoofdactie staat in de paneelbalk.

### Opbouw van elk scherm

```
PageHead                 paneelbalk (kruimelpad, primary, avatar) + kopregel (titel, badge, uitleg, actions)
Tabs                     als er weergaves zijn (Wijnen 12 · Wijnhuizen 3 · …)
toolbar                  zoeken (+ iconknop, bv. importeren)
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
  title="Wijnkelder"
  badge={<span className="badge">Gearchiveerd</span>}                 // optioneel, kort
  description="Wat er in de kelder ligt en wanneer het drinkklaar is"
  back={{ to: `/projecten/${parent.id}`, label: parent.name }}        // het project erboven, of terug
  actions={<Link className="btn btn-outline btn-sm" …>Instellen</Link>} // acties op dit scherm, rechts in de kopregel
  primary={<Link className="btn btn-primary" …><Icon name="plus" size={16} /> Wijn toevoegen</Link>} // in de paneelbalk
/>
```

- Een overzichtsscherm (een project) heeft `primary` (en een `.fab` met dezelfde actie). Een fiche heeft `back` en `actions`.
- Formulieren: `back={{ to: -1, label: … }}` (gewoon terug), geen `primary`.
- Beschrijving: één korte zin (op tablet staat ze naast de titel en wordt ze afgekapt), zonder punt als het een opsomming is.

### Zijkolom: `split`

Voor een fiche en een project: links de kern, rechts de kaarten (zoals "Product designer" in Bretford).

```tsx
<div className="split">
  <aside className="split-aside">
    <section className="card">…kern: foto, dl-lijst met de velden, tags…</section>
    <section className="card">…nog een sectie…</section>
  </aside>
  <div className="split-main">
    <section className="card"><CardHead … /> …</section>
    …stille knoppen (archiveren, verwijderen)…
  </div>
</div>
```

- Op gsm en smalle tablets staan beide onder elkaar en zijn de secties gewone kaarten. Is de rechterkant het
  belangrijkste (de lijst van een project), zet dan `split split-main-first`: onder 960px komt die eerst.
- Vanaf 960px: zijkolom van 320px met een lijn rechts tot onderaan het paneel; de kaarten in de zijkolom verliezen
  hun rand en worden secties, gescheiden door een ingezette lijn. Zet de `.split` direct in `.page`, na `PageHead`.

### Knoppen

| Klasse | Wanneer |
| --- | --- |
| `btn btn-primary` | De ene hoofdactie per scherm of formulier (Opslaan, Nieuw project) |
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
<div className="card table table-items" style={{ "--cols": "minmax(0, 1fr) minmax(0, 160px) 110px" } as CSSProperties}>
  <div className="table-head" aria-hidden="true">
    <span>Wijn</span><span>Wijnhuis</span><span className="end">Jaargang</span>
  </div>
  <ul className="rows stagger">
    <li><Link className="row">
      <span className="cell-main">…<span className="row-meta narrow-only">wijnhuis · jaargang</span></span>
      <span className="col"><span>{house}</span></span>
      <span className="col col-end"><span>{year}</span></span>
    </Link></li>
  </ul>
</div>
```

- Een lijst (`ItemsView`) is `.table-items`: de kolommen komen van de velden met `column` (de naam en
  hooguit twee velden; naast de zijkolom is er niet meer plaats). Getallen (bedrag, getal, score, jaar) zijn 110px
  breed en rechts uitgelijnd (`col-end`), tekst `minmax(0, 160px)`. Daarom staat `--cols` op de tabel zelf.
- Een andere tabel met vaste kolommen krijgt een eigen klasse met `--cols` in `styles.css`; de eerste kolom is
  altijd `minmax(0, 1fr)`.
- Hooguit 4 kolommen tussen 768 en 1100px; extra kolommen krijgen `xl` (verschijnen pas vanaf 1100px).
- Wat op gsm in de grijze regel staat, heeft `narrow-only`; wat enkel in de tabel onder de titel moet, `wide-only`.
- Lege cel: een streepje `—` in `.muted`.

### Tabs met tellers: `Tabs`

```tsx
<Tabs label="Lijsten" value={type.id} onChange={(t) => setParams({ lijst: t }, { replace: true })}
  tabs={types.map((t) => ({ value: t.id, label: t.plural, count: counts[t.id] ?? 0 }))} />
```

Een grijze pil met een wit vlak dat naar de actieve tab glijdt; tellers rollen bij een wijziging. Voor
verschillende **weergaves binnen één scherm** (de lijsten van een project, de onderwerpen bij Instellen). Niet voor
navigatie naar een ander scherm. Zet de gekozen tab in het adres (`?lijst=`, `?tab=`), zodat je ernaar kan linken.

### Filters: `FilterSelect` en `FilterToggle`

```tsx
<div className="filters">
  <FilterSelect label="Druif" all="Alle" value={filters.grape} onChange={…} options={…} />
  <FilterToggle on={now} onChange={setNow}><Icon name="clock" size={14} /> Drinkklaar: nu</FilterToggle>
</div>
```

Witte pil met dunne rand: grijs label, donkere waarde. Een actieve filter kleurt blauw. Filters staan onder het zoekveld.
In `ItemsView` komen ze vanzelf uit de velden met `filter` (een keuzelijst met de waarden die voorkomen; een periode
wordt een schakelaar "Label: nu"), plus Tag en Archief. Toon een filter pas als er iets te kiezen valt.

### Segmenten: `Segmented`

Keuze tussen 2–4 opties in een formulier (Niet zien · Zien · Wijzigen, Gelijk · Procent). Het witte vlak schuift mee.
Meer dan 4 opties: gebruik een `select`.

### Zoekpalet: `CommandPalette`

Opent met **⌘K / Ctrl K**, het zoekveld in de zijbalk of Zoeken in de onderbalk (`useSession().openSearch()` vanuit
een scherm). Zoekt zonder op hoofdletters of accenten te letten in acties, je projecten en (via `/api/search`) de
items die je mag zien. Pijltjes kiezen (een grijs vlak glijdt mee), Enter opent, Escape sluit. Iets nieuws dat je
moet kunnen vinden? Voeg het toe als groep in `CommandPalette.tsx`.

### Projectboom (zijbalk)

Je hoofdprojecten, elk met zijn icoon in zijn toon, een pijltje om de subprojecten open te klappen (de rij
groeit van `0fr` naar `1fr`, kinderen schuiven één voor één in) en een hulplijn links van de kinderen
(`place-link child`). De boom waarin het project zit dat je bekijkt, staat open. Onderaan "+ Project".
Op het overzicht (`Home`) staat dezelfde boom als rijen die inspringen met `--depth`.

### Formulier

```tsx
<form className="form page" onSubmit={…}>
  <PageHead title="Wijn toevoegen" back={{ to: -1, label: "Wijnkelder" }} />
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
- **Een lijst heeft een notitieveld** (een lange tekst); de sjablonen zetten er een klaar. In de fiche komt een
  lange tekst als eigen kaart.
- Automatisch ingevulde velden krijgen klasse `auto` (zacht blauw) tot de gebruiker ze aanpast.
- Fout in een veld: `aria-invalid`. Fout van de server: `<p className="error">` boven de knop.
- Kant-en-klare velden: `FieldInputs` (alle velden van een lijst), `TagPicker`, `Switch`, `ToneSwatches`,
  `IconPicker`, `FilePicker`, `TreeSelect` en `QuantityField`.

### Lijsten en velden: `Fields.tsx`

Alles wat je bijhoudt, is een **item** in een **lijst**: een lijst heeft eigen velden (Wijnen met jaargang en
druiven, Klantenkaarten met een barcode). De lijsten van een project gelden ook in zijn subprojecten. In de code heet
een lijst `item_type` (`ItemType`, `type_id`); in alles wat de gebruiker leest, is het een **lijst**. De veldsoorten
staan in `FIELD_TYPES` (`shared/fields.ts`); een nieuwe veldsoort krijgt daar een type, een controle
(`cleanValue`), een opmaak (`formatFieldValue`) en hier een invoer.

| Component of hulpje | Wat |
| --- | --- |
| `FieldsEditor` (`fieldsDraft` → `buildFields`) | De velden van een lijst: naam en soort veld op één regel, onder ⋯ keuzes, eenheid, verwijzing, codeformaat, kolom, filter, verplicht en uitleg |
| `FieldInputs` (`attributesDraft` → `buildAttributes`) | De velden invullen; korte velden per twee (`.attr-fields`). Een veld dat je niet mag wijzigen, staat er alleen-lezen |
| `AttributeRows` | De ingevulde velden als regels in de `dl` van een fiche; verwijzingen linken naar het item, een webadres toont enkel het domein als link (op een kiosk als tekst) |
| `CodeInput`, `CodeView` | Een barcode of QR-code: typen, formaat kiezen of scannen; groot tonen om te laten scannen (zwart op wit) |
| `ItemSelect` | Een verwijzing naar een item uit een andere lijst (de wijn → het wijnhuis) |
| `SharesField` (`sharesDraft`) | **Eigenaar**: wie welk deel heeft (Gelijk · Procent, samen 100). Leeg = van het project samen |
| `ScoreInput`, `ScoreStars` | Score op 5 met halve sterren (tik nog eens voor een halve) |
| `LabelScanner` | Foto van een etiket: de app vult naam en velden in (zacht blauw, `auto`) en bewaart de foto |
| `ItemPhoto` | De foto van een item bovenaan de fiche: toevoegen, vervangen, weghalen |
| `IconPicker` (`IconPicker.tsx`) | Een icoon kiezen voor een project of lijst (`ICONS` in `shared/templates.ts`) |

- "Eigenaar" is van wie iets is; "Van wie" is enkel de herkomst van iets dat je kreeg.
- Een nieuw project begint met een **sjabloon** (`PROJECT_TEMPLATES` in `shared/templates.ts`, `.template-picker`):
  lijsten met hun velden. Daarna kan je alles aanpassen. Een nieuwe use case begint best als sjabloon.
- Snel veel invullen: "Opslaan en volgende" (`.form-actions`, een `btn-outline` naast de hoofdknop). Een tabel
  importeren (`ImportPage`, `.column-map`: kolom → veld, onthouden per lijst; wat we niet herkennen gaat bij de
  lange tekst) is een eigen scherm.

### Volgorde: `useSortable` (`Sortable.tsx`)

Alles wat de gebruiker zelf ordent (projecten, lijsten, velden), sleep je aan een **greep** (`grip`, links in de rij).
Op het toetsenbord werkt dezelfde greep met ↑ ↓ Home End. Bouw nooit "Hoger/Lager"-knoppen.

```tsx
const sortable = useSortable(order, save, (id) => naamVan(id)); // save zet de nieuwe volgorde meteen, dan pas de API
<ul className="rows">
  {order.map((id) => (
    <li key={id} {...sortable.itemProps(id)}>
      <div className="row">
        <button {...sortable.handleProps(id)}><Icon name="grip" size={16} /></button>
        <Link className="row-link" …>…</Link>
      </div>
    </li>
  ))}
</ul>
{sortable.status}
```

- De gesleepte rij zweeft (`--shadow-lg`) en volgt de vinger; de andere schuiven opzij; dicht bij de rand scrolt
  de lijst mee. Na het loslaten staat alles meteen op zijn plaats.
- Bewaren gebeurt bij het loslaten, zonder toast: de verplaatste rij is de bevestiging (zoals bij −/+). Een fout
  geeft een toast en zet de volgorde terug.
- Een lijst die je niet mag ordenen, toont geen greep.
- Geen `stagger` op een sorteerbare lijst: een verplaatste rij zou opnieuw binnenkomen.
- Wat de volgorde betekent: de projecten bovenaan je overzicht zijn **jouw** volgorde (per persoon); subprojecten
  en lijsten zijn die van het project (enkel met `manage`), en de lijsten bepalen ook de volgorde van de tabs.
- Volgorde is een instelling, geen knop op een overzicht: je projecten bij **Ik**, subprojecten bij **Instellen →
  Algemeen** (`ProjectOrder`), lijsten bij **Instellen → Lijsten**, velden in het formulier van een lijst.

### Regels: `RulesEditor` en `BalanceCard`

Een **regel** laat de app iets doen met de velden van een lijst (`shared/rules.ts`). Een lijst heeft hooguit één
regel; je kiest ze onderaan het formulier van de lijst (`RulesEditor`: een `Segmented`, per rol een veld, en bij
Kosten verdelen de gewone verdeling als `SharesField`). Kies je een regel, dan zoekt de app de passende velden;
wat ontbreekt, komt erbij.

| Regel | Velden | Wat de app doet |
| --- | --- | --- |
| Kosten verdelen (`split`) | Bedrag, Betaald door, Verdeling | Een nieuwe uitgave: jij betaalde, de gewone verdeling (of gelijk over iedereen). Telt mee in Wie moet wie |
| Terugbetalingen (`settle`) | Bedrag, Van, Aan | Telt mee in Wie moet wie; "Terugbetaald" bewaart hier |

- `BalanceCard` ("Wie moet wie") staat in de zijkolom van een project, met alles eronder. Per overschrijving één
  rij: avatar, "Jana moet jou nog", rechts het bedrag, en een `link-button` "Terugbetaald" (een `Sheet` met bedrag
  en datum; minder mag). Niets open: "Alles is verrekend."
- Op gsm komt de kaart vóór de lijst: geef ze `split-lead` (de zijkolom valt open onder 960px).
- "Jij/jou" in plaats van je eigen naam ("Jij moet Jaan nog", "Jana moet jou nog").
- Telt enkel wat je mag zien (de lijst en de velden van de regel); wat verborgen is, telt niet mee.
- Een nieuwe regel (voorraad, ...) komt in `shared/rules.ts` met zijn velden in `RULE_FIELDS`, en in `RulesEditor`.

### Een lijst tonen: `ItemsView`

`<ItemsView project={detail} type={type} />` is één lijst in een project: zoeken, filters uit de velden,
Tag, Archief, een iconknop om te importeren en de tabel `.table-items`. Gebruik ze overal waar items van een lijst
staan; bouw geen eigen lijst.

### Rechten in de app

De API beslist wat iemand mag en weigert de rest. De app **verbergt** wat niet mag, zodat niemand tegen een fout
aanloopt. Wat de app daarvoor krijgt:

| Waar | Wat |
| --- | --- |
| `project.rights` (in `ProjectDetail` en `useSession().projects`) | `manage` (instellen, lijsten, rollen), `members` (mensen), `create`, `delete`, en `items` (standaard Niet zien / Zien / Wijzigen) |
| `type.access`, `type.field_access`, `type.can_create`, `type.can_delete` | Per lijst en per veld wat jij mag (`ItemTypeView`) |
| `item.access`, `item.field_access`, `item.can_delete` | Hetzelfde op de fiche (`ItemDetail`) |

- Een knop die iets toevoegt: enkel bij `can_create`. Bewerken: enkel bij `access === "edit"`. Een veld met
  `field_access` `view` staat alleen-lezen in het formulier; `none` staat er niet.
- Een rol stel je in met `RoleForm`: schakelaars voor het project, een standaard, en per lijst en per veld een
  `Segmented` met "Standaard" erbij (open per lijst met "Per veld", `.role-type`, `.role-fields`).
- Afbeeldingen en bestanden uit de API altijd via `apiUrl("/…")`.

### Kleine bouwstenen

| Klasse of component | Gebruik |
| --- | --- |
| `.link-quiet` | Link in een `dl` of tekst: geen kleur, een zacht lijntje eronder |
| `.link-button` | Stille blauwe tekstknop naast een label ("Per veld", "Wissen") |
| `.tips-block` | Een lange tekst op de fiche, met de regels zoals getypt |
| `.timeline` + `.timeline-date` | Logboek: datum links, notitie rechts |
| `.member-actions` | Rol (een `select`), bewerken en weghalen naast iemand in een lijst |
| `.dashboard` + `.dash-card` + `.dash-head` | Het overzicht: kaarten zo breed als past; de kop opent het project, de rijen eronder de lijsten |
| `.sr-only` | Tekst enkel voor schermlezers (bv. de nieuwe plaats na het verslepen) |

### Badges, tags, stipjes, avatars

| Element | Gebruik |
| --- | --- |
| `badge` | Grijze pil zonder rand: neutrale status ("Lid", "inactief") |
| `badge badge-success` | Iets loopt goed (garantie loopt) |
| `badge badge-warning` | Aandacht (bijna op, vervalt binnenkort) |
| `badge badge-danger` | Voorbij (vervallen) |
| `badge badge-accent` | Nieuw of info ("119 connection uploaded" in de referentie) |
| `tag tone-x` | Tags van de gebruiker |
| `dot tone-x` | De kleur van een project of tag in een lijst |
| `Avatar` | Personen: pastel rondje met een dunne gekleurde letter; `size="sm"` in tekst, gewoon in lijsten, `lg` in kaarten |

Badges zijn kort: 1–3 woorden.

### Meldingen

| Situatie | Component |
| --- | --- |
| Iets is bewaard, verwijderd, verplaatst | `useToast()("Wijn bewaard")`: lichtblauw met blauwe rand, rechtsonder (tablet) of boven de onderbalk |
| Iets gebeurt of lukte half binnen een formulier | `<Alert tone="busy" \| "ok" \| "partial" \| "none">` |
| Iets kan niet ongedaan gemaakt worden | `useConfirm()({ title, body, confirmLabel, danger: true })` |
| Een korte invoer (notitie in het logboek, iemand toevoegen, een tag) | `<Sheet>`: onderblad op gsm, venster op tablet |
| Lijst is leeg | `<EmptyState icon title action>` met één zin uitleg en hooguit één knop (`btn-outline btn-sm`) |
| Lijst laadt | `<SkeletonRows rows={5} />` (verschijnt pas na 0,18 s) |

Toasts zijn de bevestiging na een actie. Elke bewaar- of verwijderactie geeft er één, behalve −/+ in een lijst en
het verslepen van een rij: daar is wat beweegt de bevestiging (een toast per tik zou storen).
Tekst: wat er gebeurde, in de verleden tijd of als korte vaststelling ("12 wijnen toegevoegd", "Rol bijgewerkt").

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
- Een getal dat kan veranderen terwijl je kijkt (tellers): `<Num value={n}>` rolt omhoog of omlaag.
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
- Grote code laad je pas als ze nodig is, met `lazy`: de barcodecode (±1 MB, `Barcode` in `Fields.tsx`) en pdf.js
  (`PdfPages` in `FileViewer`). Een groot scherm kan een `lazy` route in `routes.tsx` zijn: de router wacht tot het
  geladen is, zodat de overgang vloeiend blijft, en toont zolang een blauw laadstreepje.

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
| Rij verslepen | de rij volgt de vinger, de andere schuiven opzij (`useSortable`) | 0,25 s |
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

## 6. Patronen per scherm

**Overzicht** (`/`): `PageHead` met `primary` "Nieuw project" → per project (in de volgorde van de boom) een
`dash-card`: de kop opent het project (met het project erboven en je rol), de rijen eronder openen elke lijst
(`?lijst=`) met het aantal → gearchiveerde projecten apart. Het kruimelpad toont hier enkel "Overzicht".

**Project** (`/projecten/:id`): `PageHead` met `back` (het project erboven), `actions` "Instellen" (enkel met
`manage` of `members`) en `primary` "<Wijn> toevoegen" → `Tabs` per lijst (enkel als er meer dan één is) →
`split split-main-first`: rechts `ItemsView`, in de zijkolom Wie moet wie (als er een lijst met een regel is; op gsm
vóór de lijst), Subprojecten en Wie (met de rol, en "via …" als het lidmaatschap van een project erboven komt) → `fab`. Zonder lijsten: een lege staat met "Lijst maken".

**Fiche** (`/items/:id`): `PageHead` met `back` en `actions` (Bewerken) → `split`: in de zijkolom de foto, de
`dl` met de velden, tags, en per lange tekst een kaart; rechts codes (`CodeView`), wat ernaar verwijst, het
logboek (nieuwste eerst, toevoegen in een `Sheet`) en bestanden → onderaan stille knoppen (archiveren,
`btn-danger-ghost` verwijderen).

**Formulier**: zie [Formulier](#formulier). Een item: eventueel de lijst kiezen, `LabelScanner`, `FieldInputs`,
tags, "Opslaan" en "Opslaan en volgende". Na bewaren: toast + naar de fiche.

**Instellen** (`/projecten/:id/instellingen`): `Tabs` Algemeen · Lijsten · Rollen · Mensen · Tags (in het adres:
`?tab=mensen`), één kaart per tab (Algemeen heeft er ook een voor de volgorde van de subprojecten). Een lijst en een rol zijn eigen formulieren; iemand toevoegen, een persoon of
een tag bewerken gaat in een `Sheet`. Wat je niet mag, zie je niet.

**Ik** (`/ik`): je naam en kleur; je e-mailadres komt van je aanmelding. Daaronder de volgorde van je projecten op
het overzicht.

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
- Knoppen zijn werkwoorden of korte zinnen: "Opslaan", "Wijn toevoegen", "Lijst maken", "Instellen".
- Titels zonder punt. Uitleg in één zin.
- Fouten zeggen wat er is en wat je kan doen: "Er moet altijd iemand overblijven die het project kan instellen."
- Lege staat: wat er hier komt + hoe je begint. "Nog geen wijnen. Voeg er een toe, of importeer ze uit een tabel."
- Wat de gebruiker maakt, heet zoals hij het noemt: de naam van één item van de lijst ("Wijn toevoegen"), niet "item". Het
  algemene woord voor een formulier met eigen velden is **lijst**, nooit "soort", "type" of "categorie".
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
- [ ] Een nieuwe lijst of sjabloon heeft een notitieveld (lange tekst).
- [ ] Lege staat, laadstaat (skeleton) en foutmelding zijn er.
- [ ] Toast na elke actie die iets bewaart of verwijdert (behalve −/+ in een lijst); `useConfirm` voor wat niet terug kan.
- [ ] Animaties enkel uit de tabel in [Beweging](#5-beweging), met `backwards`.
- [ ] Getest op 390px breed (gsm) en 1280px (tablet), en op 820px (tablet rechtop, smalle zijbalk).
- [ ] Volgt de rechten: knoppen enkel bij `can_create`, `access === "edit"`, `can_delete`, `rights.manage` of
      `rights.members`; velden volgens `field_access`. Getest met een rol die enkel mag zien. Afbeeldingen uit de API
      via `apiUrl`.
- [ ] Geen horizontale scroll; lange namen worden netjes afgekapt.
- [ ] Iconknoppen hebben een `aria-label`; alles werkt met het toetsenbord.
- [ ] Teksten volgen [Tekst](#9-tekst).
- [ ] Kan de gebruiker iets zelf ordenen? Dan met `useSortable` (greep + pijltjes), niet met knoppen.
- [ ] Nieuw patroon nodig? Bouw het als component, en **voeg het toe aan dit stijlboek**.
