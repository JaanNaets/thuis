# Stijlboek Thuis

Dit stijlboek is de afspraak voor hoe Thuis eruitziet en aanvoelt. **Raadpleeg het voor je een scherm,
onderdeel of tekst toevoegt of verandert**, en werk het bij als je iets nieuws introduceert.

De stijl heet **Glas**: héél minimalistisch en strak, met een subtiel "liquid glass" voor wat zweeft. Een koel
lichtgrijs canvas met de zijbalk erop, één wit paneel zonder rand, grote rustige titels, grijze vlakken in plaats
van lijnen, zwart voor de actie en glas enkel waar iets boven de inhoud ligt (de balken, de gekozen tab, een
onderblad). Het mooie zit niet in kleur of versiering, maar in **ritme, uitlijning, zachte vlakken en verende
micro-animaties**. Het ontwerp van elk scherm (gsm en desktop) staat op het canvas "Glas: alle schermen".

De bouwstenen staan in code; dit document zegt welke je wanneer gebruikt.

| Wat | Waar |
| --- | --- |
| Kleuren, maten, schaduwen, curves | `src/styles.css`, bovenaan in `:root` |
| Componenten | `src/components/` (vooral `Controls.tsx`, `Page.tsx`, `Motion.tsx`, `Sidebar.tsx`) |
| Lijsten, velden en items | `src/components/Fields.tsx`, `ItemsView.tsx` en `shared/fields.ts` |
| Berekeningen | `src/components/CalcEditor.tsx` en `shared/calc.ts` |
| Sjablonen (ingebouwd en gedeeld) | `shared/templates.ts`, `shared/template-file.ts` en `src/components/TemplateShare.tsx` |
| Rechten | `shared/access.ts` (wat een rol mag, per lijst en per veld) |
| Navigatie met overgangen | `src/router.tsx` (`Link`, `NavLink`, `useNavigate`) en `src/routes.tsx` |
| Iconen | `src/components/Icon.tsx` |
| Opmaak van bedragen, datums, hoeveelheden | `src/format.ts` |

---

## 1. Principes

1. **Rustig.** Wit en grijs dragen het scherm. Kleur is een signaal, geen decoratie.
2. **Eén accent.** Blauw (`--accent`) enkel voor focus, info, automatisch ingevuld en stille tekstknoppen. Nergens
   een tweede accentkleur.
3. **Zwart is de actie.** De hoofdknop is zwart (`btn-primary`), net als de + knop, het merktegeltje, een
   aangezette schakelaar en een gekozen icoon.
4. **Glas enkel voor wat zweeft.** De paneelbalk, de onderbalk, de terugknop op gsm, de gekozen tab of segment,
   de secundaire knop, een toast, een onderblad en het zoekpalet. Nooit voor een vlak waar gewoon inhoud op staat.
5. **Grijs is een vlak, geen rand.** Velden, pillen, sporen van tabs en groepen in een formulier zijn doorschijnende
   grijze vlakken zonder rand. Lijnen zijn haarfijn en enkel tussen rijen en secties.
6. **Groot en zacht.** Grote titels (32px op tablet), ruime afrondingen (12–24px, knoppen zijn pillen), tekst van
   13–15px.
7. **Alles lijnt uit.** Eén raster van 4px; de tekst van een sectie staat onder de paginatitel; kolommen in tabellen
   staan onder hun kop.
8. **Alles beweegt, en veert.** Een nieuw scherm vloeit in, een keuze veert naar haar plaats, een knop veert bij
   indrukken. Elke animatie heeft een reden, duurt 0,2–0,6 s en gebruikt de vaste curves. Nooit beweging om de
   beweging.
9. **Mobiel eerst, kiosk mee.** Elk scherm werkt op een gsm met de duim én op de keukentablet met een natte
   vinger (aanraakvlakken van 44px).
10. **Nederlands zoals we het zeggen.** Kort, vriendelijk, "je". Zie [Tekst](#9-tekst).

---

## 2. Tokens

Gebruik altijd de variabele, nooit de kleurcode zelf.

### Kleur

De grijzen zijn doorschijnend (`rgb(118 118 128 / …)`): zo werkt hetzelfde vlak op wit én op een grijze groep.

| Variabele | Waarde | Gebruik |
| --- | --- | --- |
| `--canvas` | #eef0f2 | Koel grijs achter het paneel, waarop de zijbalk staat (enkel tablet) |
| `--background` | #ffffff | Paneel, kaarten, wit kaartje in een groep |
| `--group` | grijs 4,5% | Een groep velden in een formulier, een instelling |
| `--subtle` | grijs 6% | Zacht vlak: lege staat, foto zonder foto, bestanden, lange tekst, melding |
| `--field` (+ `-hover`) | grijs 8% (12%) | Invoervelden (worden wit bij focus) |
| `--muted` (+ `-strong`) | grijs 10% (16%) | Pillen, zachte knoppen, filters, tags, sporen van tabs en segmenten (hover) |
| `--hover`, `--press` | zwart 2,5% / 5,5% | Hover van een rij; ingedrukt, gekozen zoekresultaat, actieve tab onderaan |
| `--glass`, `--glass-bar`, `--glass-strong` | wit 82→60%, 90→76%, 94→84% | Glas: knoppen en gekozen dingen; balken boven scrollende inhoud; toast, onderblad, kleine pillen |
| `--glass-blur`, `--glass-edge`, `--glass-shadow` | | Hoort altijd bij glas: vervaging, witte rand, glanslijn en zachte schaduw |
| `--foreground` | #1d1d1f | Hoofdtekst, titels |
| `--text-soft` | #3a3a3c | Tekst in menu en zachte knoppen |
| `--muted-foreground` | #6b6b70 | Uitleg, metadata, kolomkoppen, placeholders (haalt 4,5:1) |
| `--faint` | #a1a1a6 | Enkel iconen en bijzaken (greep, ster uit), nooit tekst |
| `--divider` | zwart 5% | Haarlijn tussen rijen en secties (raakt de rand niet) |
| `--border` (+ `-strong`) | | Zeldzaam: een stippellijn (berekening, "+ tag"), de hulplijn in de boom |
| `--primary` | #1d1d1f | Hoofdknop, + knop, merktegeltje, schakelaar aan, gekozen icoon of sjabloon |
| `--accent` (+ `-soft`, `-line`, `-ink`) | #2f86eb | Blauw: focusring, info, automatisch ingevulde velden, stille tekstknoppen |
| `--destructive` | #c62a2f | Verwijderen, foutmeldingen (haalt 4,5:1) |
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
| Paginatitel | 32px (tablet), 30px (gsm) | 650, −0,03em |
| Groot bedrag | 30–38px | 600, −0,03em |
| Titel van een kaart of sectie | 15,5px | 600 |
| Titel in een onderblad | 20px | 650 |
| Gewone tekst | 14px (muis), 15px (aanraking) | 400 |
| Menu in de zijbalk | 13,5px | 450, actief 600 |
| Rijtitel, knop, label | 13,5–14,5px | 550 |
| Kolomkop, metadata, uitleg | 12,5–13,5px | 400–550 |
| Badges, tellers | 11,5–12px | 500 |

### Maten

- Raster van **4px**. Gebruikelijke afstanden: 4, 8, 12, 16, 20, 24, 32.
- Afronding: `--radius-sm` 8 (badges) · `--radius` 10 (menu-items, tegels) · `--radius-md` 12 (velden, zoekveld) ·
  `--radius-lg` 14 (rijen, spoor van tabs en segmenten, wit kaartje in een groep) · `--radius-xl` 20 (kaarten, lege
  staat) · `--radius-2xl` 24 (groepen in een formulier, zoekpalet) · `--radius-panel` 18 (paneel, paneelbalk) ·
  `--radius-pill` (knoppen, filters, tags, onderbalk, toast).
- Schaduw: zacht en ver. `--shadow-card` voor een kaart (een haarfijne rand van schaduw), `--shadow-inset` voor een
  wit kaartje in een grijze groep, `--shadow-primary` onder zwart, `--glass-shadow` onder glas en `--shadow-lg` enkel
  voor wat zweeft (zoekpalet, venster, de gesleepte rij).
- Hoogtes: knop 38px · klein 32px · groot 48px · in de balken 40px · veld 42px. Op aanraakschermen 44/36/52px.

---

## 3. Layout

### Gsm (smaller dan 768px)

- Witte achtergrond, inhoud met 16px marge, een grote titel (30px).
- **Onderbalk**: een zwevende glazen pil (20px van de randen) met drie tabs: **Overzicht**, **Zoeken** (opent het
  [zoekpalet](#zoekpalet-commandpalette)) en **Ik**. Een grijs vlak veert naar de actieve tab. Een project en een
  fiche horen bij Overzicht.
- **Zwevende + knop** (zwart, 56px) rechts boven de onderbalk voor de hoofdactie van het scherm.
- **Terug** is een glazen pil die linksboven zweeft. Zodra de grote titel uit beeld scrollt, krimpt ze tot een
  rondje en verschijnt de titel in een glazen pilletje in het midden (zit in `PageHead`).
- Tabelkolommen verdwijnen: de info staat in de grijze regel onder de titel (`.narrow-only`).

### Tablet en kiosk (vanaf 768px)

```
┌ canvas #eef0f2 ────────────────────────────────────────────────────────────┐
│ ▣ Thuis          ┌ paneel (wit, geen rand, 18px) ─────────────────────────┐ │
│ [⌕ Zoeken  ⌘K]   │ ╭ glas ────────────────────────────────────────────╮ │ │
│ ◖Overzicht  4◗   │ │ Slachterijstraat 1 › Wijnkelder  (+ Wijn toevoegen) J│ │ │  ← paneelbalk 60px, zweeft
│ Projecten        │ ╰──────────────────────────────────────────────────╯ │ │
│ ● Slachterijstr. │ Wijnkelder                              (Instellen)    │ │  ← titel 32px, uitleg eronder
│ │ Wijnkelder     │ uitleg                                                 │ │
│ │ Huishouden     │ [ Wijnen 12 · Wijnhuizen 3 ]                           │ │  ← tabs per lijst
│ ● Test           │ zijkolom (320px)        zoeken, filters                │ │
│ + Project        │ Wie moet wie            Wijn          Wijnhuis   Jaar  │ │
│                  │ ───────────             ─────────────────────────────  │ │
│                  │ Subprojecten            rijen …                        │ │
│ ◉ Jaan           └────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Canvas** met links de **zijbalk** (248px, tussen 768 en 1100px enkel iconen: 68px) en rechts een wit
  **paneel** (10px marge, geen rand, afronding 18px). Het paneel scrollt zelf; de zijbalk blijft staan.
- **Zijbalk** (`Sidebar.tsx`), van boven naar onder: het zwarte merktegeltje met "Thuis" (naar het overzicht), het
  zoekveld als grijs vlak (opent het [zoekpalet](#zoekpalet-commandpalette)), "Overzicht" met een teller, de
  [projectboom](#projectboom-zijbalk), onderaan jouw naam (naar `/ik`). Het actieve item ligt onder een **glazen
  lens** die meeveert.
- **Paneelbalk** (60px, een glazen balk die 10px van de randen zweeft en blijft staan; de inhoud scrollt eronder
  door): kruimelpad met `›` links ("Slachterijstraat 1 › Wijnkelder"), rechts de hoofdactie (zwarte pil, 40px) en
  jouw letter in een glazen rondje (naar `/ik`).
- **Kop**: een grote titel (32px) + badge, de uitleg eronder in grijs, acties op het item rechts (`btn-outline
  btn-sm`, glas). Geen lijn eronder.
- Inhoud daaronder met 20px marge. Een project en een fiche gebruiken de [zijkolom](#zijkolom-split).
- Geen + knop: de hoofdactie staat in de paneelbalk.

### Opbouw van elk scherm

```
PageHead                 paneelbalk (kruimelpad, primary, avatar) + kop (titel, badge, uitleg, actions)
Tabs                     als er weergaves zijn (Wijnen 12 · Wijnhuizen 3 · …)
toolbar                  zoeken (+ iconknop, bv. importeren)
filters                  filterpillen
card / card table        de inhoud — of .split met zijkolom en secties
fab                      + knop (enkel gsm, zelfde actie als primary)
```

---

## 4. Componenten

### Paginakop: `PageHead` (`Page.tsx`)

Elk scherm begint ermee. Hij maakt de glazen paneelbalk en de kop met de grote titel (tablet), en de grote titel
met de zwevende terugknop en het titelpilletje (gsm).

```tsx
<PageHead
  title="Wijnkelder"
  badge={<span className="badge">Gearchiveerd</span>}                 // optioneel, kort
  description="Wat er in de kelder ligt en wanneer het drinkklaar is"
  back={{ to: `/projecten/${parent.id}`, label: parent.name }}        // het project erboven, of terug
  actions={<Link className="btn btn-outline btn-sm" …>Instellen</Link>} // acties op dit scherm, rechts naast de titel
  primary={<Link className="btn btn-primary" …><Icon name="plus" size={16} /> Wijn toevoegen</Link>} // in de paneelbalk
/>
```

- Een overzichtsscherm (een project) heeft `primary` (en een `.fab` met dezelfde actie). Een fiche heeft `back` en `actions`.
- Formulieren: `back={{ to: -1, label: … }}` (gewoon terug), geen `primary`.
- Beschrijving: één korte zin, in grijs onder de titel, zonder punt als het een opsomming is.

### Zijkolom: `split`

Voor een fiche en een project: links de kern, rechts de lijst of de rest.

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

- In een `.split` is een `card` **geen kaart maar een sectie**: geen vlak, geen schaduw, een haarlijn ertussen. De
  tekst van een sectie staat onder de paginatitel; wat geen kaart is (knoppen, een lege staat, het zoekveld) schuift
  vanzelf mee in.
- Op gsm en smalle tablets staan beide onder elkaar. Is de rechterkant het belangrijkste (de lijst van een
  project), zet dan `split split-main-first`: onder 960px komt die eerst.
- Vanaf 960px: zijkolom van 320px, zonder lijn ernaast. Zet de `.split` direct in `.page`, na `PageHead`.

### Knoppen

Alle knoppen zijn **pillen**. Indrukken veert terug (schaal 0,96).

| Klasse | Wanneer |
| --- | --- |
| `btn btn-primary` | De ene hoofdactie per scherm of formulier (Opslaan, Nieuw project): zwart met een glanslijn |
| `btn btn-outline` | Gewone acties naast de hoofdactie (Bewerken, Instellen, Notitie): **glas**, komt 1px omhoog bij aanwijzen |
| `btn btn-ghost` | Stille acties in een rij (archiveren, sluiten) |
| `btn` | Een zachte grijze pil (zelden; liever een van de andere) |
| `btn btn-danger` | Enkel als bevestiging in het venster "verwijderen?" |
| `btn btn-danger-ghost` | De knop die naar dat venster leidt ("Verwijderen") |
| `btn-sm`, `btn-lg`, `btn-icon`, `btn-block` | Grootte en vorm (een iconknop is rond) |

- Icoon links van de tekst, 15–16px, in de kleur van de tekst. In een ghostknop is het icoon grijs.
- Knop die iets bewaart: `SubmitButton` (draait een spinner tijdens het bewaren). Onderaan een formulier is die op
  tablet een pil, op gsm over de hele breedte.
- Een knop met enkel een icoon krijgt altijd een `aria-label`.

### Kaart, groep en sectie: `card` + `CardHead`

```tsx
<section className="card">
  <CardHead title="Geschiedenis" description="Elke wijziging, met wie en waar" action={…} />
  <ul className="rows">…</ul>            // of <div className="card-body">…</div>
</section>
```

Hetzelfde `card` ziet er anders uit naargelang waar het staat; je kiest dat niet zelf:

| Waar | Hoe |
| --- | --- |
| Overzicht en elders | **Kaart**: wit, afronding 20px, `--shadow-card`; een projectkaart komt 2px omhoog bij aanwijzen |
| In een formulier (`.page.form`) en bij Instellen | **Groep**: een grijs vlak (`--group`), afronding 24px, geen schaduw |
| In een `.split` (project, fiche) | **Sectie**: geen vlak, een haarlijn tussen secties |

- `CardHead`: titel 15,5px, gewicht 600, een korte grijze uitleg eronder, eventueel een actie rechts (glazen knop).
  Geen icoon.
- Inhoud zonder rijen in `card-body`. Een voetnoot (bv. "Bewaard door Jaan") in `.footnote` (ingezette lijn erboven).
- Een lijstje witte kaartjes in een groep (velden van een lijst, kolommen bij importeren, per veld bij een rol):
  wit, afronding 14–20px, `--shadow-inset`.
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

- Rijen staan **ingezet** in hun kaart (6px): de haarlijnen ertussen (`--divider`) raken de rand niet, en hover is
  een afgerond zacht vlak (14px).
- Een rij is 60px hoog, met `row-media` (36px tegel zonder rand, in de toon van het project, of `round` voor
  personen), titel (550), grijze regel en rechts een waarde of `row-chevron` (schuift 3px bij aanwijzen).
- Rij met eigen knoppen (zoals −/+): de rij zelf is een `div.row`, de link zit in `.row-link`.
- Groeperen: `<li className="group-row"><span className="dot tone-x" /> Voeding <span className="group-count">5</span></li>`
  (een stil grijs label, geen balk).

### Tabel (tablet): `card table` + `table-head` + `col`

Dezelfde rijen worden op tablet een tabel; de kolomkoppen staan erboven als **stille grijze tekst** (geen strook).

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

Een grijs spoor met een glazen witte duim die naar de actieve tab **veert**; tellers rollen bij een wijziging. Voor
verschillende **weergaves binnen één scherm** (de lijsten van een project, de onderwerpen bij Instellen). Niet voor
navigatie naar een ander scherm. Zet de gekozen tab in het adres (`?lijst=`, `?tab=`), zodat je ernaar kan linken.

### Filters: `FilterSelect` en `FilterToggle`

```tsx
<div className="filters">
  <FilterSelect label="Druif" all="Alle" value={filters.grape} onChange={…} options={…} />
  <FilterToggle on={now} onChange={setNow}><Icon name="clock" size={14} /> Drinkklaar: nu</FilterToggle>
</div>
```

Een grijze pil zonder rand: grijs label, donkere waarde. Een actieve filter komt naar voren als **glas**. Filters
staan onder het zoekveld.
In `ItemsView` komen ze vanzelf uit de velden met `filter` (een keuzelijst met de waarden die voorkomen; een periode
wordt een schakelaar "Label: nu"), plus Tag en Archief. Toon een filter pas als er iets te kiezen valt.

### Segmenten: `Segmented`

Keuze tussen 2–4 opties in een formulier (Niet zien · Zien · Wijzigen, Gelijk · Procent). Zoals tabs: een grijs spoor
met een glazen duim die meeveert. Meer dan 4 opties: gebruik een `select`.

### Zoekpalet: `CommandPalette`

Opent met **⌘K / Ctrl K**, het zoekveld in de zijbalk of Zoeken in de onderbalk (`useSession().openSearch()` vanuit
een scherm): een glazen venster boven een zacht vervaagd scherm. Zoekt zonder op hoofdletters of accenten te letten
in acties, je projecten en (via `/api/search`) de items die je mag zien. Pijltjes kiezen (een grijs vlak glijdt
mee), Enter opent, Escape sluit. Iets nieuws dat je moet kunnen vinden? Voeg het toe als groep in
`CommandPalette.tsx`.

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
- Groepeer velden per onderwerp in `card form-section`: in een formulier wordt dat vanzelf een **grijze groep**.
- Velden: 42px hoog, een grijs vlak (`--field`) zonder rand, afronding 12px; bij aanwijzen iets donkerder, bij focus
  wit met een blauwe ring.
- Schakelaars onder elkaar krijgen vanzelf een haarlijn ertussen.
- Label boven het veld. Optioneel? `<span className="optional">· uitleg</span>` achter het label. Uitleg onder
  een veld in `.hint`.
- Verplichte velden krijgen `required`, geen sterretje.
- **Een lijst heeft een notitieveld** (een lange tekst); de sjablonen zetten er een klaar. In de fiche komt een
  lange tekst als eigen kaart.
- Automatisch ingevulde velden krijgen klasse `auto` (zacht blauw) tot de gebruiker ze aanpast.
- Fout in een veld: `aria-invalid`. Fout van de server: `<p className="error">` boven de knop.
- Kant-en-klare velden: `FieldInputs` (alle velden van een lijst), `TagPicker`, `Switch`, `ToneSwatches`,
  `IconPicker`, `FilePicker`, `TreeSelect` en `QuantityField`. Uitleg bij een label: `Tip`.

### Lijsten en velden: `Fields.tsx`

Alles wat je bijhoudt, is een **item** in een **lijst**: een lijst heeft eigen velden (Wijnen met jaargang en
druiven, Klantenkaarten met een barcode). De lijsten van een project gelden ook in zijn subprojecten. In de code heet
een lijst `item_type` (`ItemType`, `type_id`); in alles wat de gebruiker leest, is het een **lijst**. De veldsoorten
staan in `FIELD_TYPES` (`shared/fields.ts`), elk met een groep (`FIELD_GROUPS`) en één zin uitleg; een nieuwe
veldsoort krijgt daar een type, een controle (`cleanValue`), een opmaak (`formatFieldValue`), tekst lezen
(`parseFieldText`) en hier een invoer.

| Groep | Veldsoorten |
| --- | --- |
| Tekst | Tekst, Lange tekst, Webadres, E-mail, Telefoon, Adres, Barcode of QR-code |
| Getallen en geld | Getal (met eenheid), Bedrag, Score op 5 |
| Datum en tijd | Datum, Periode (van–tot datums), Uur, Duur, Jaar, Van–tot (jaren), Herhaling ("elke 3 maanden") |
| Keuzes en lijstjes | Keuzelijst, Meerdere waarden, Ja of nee, Takenlijst |
| Mensen en verwijzingen | Persoon, Personen, Personen met aandeel, Verwijzing, Verwijzingen |
| Berekenen | Berekening (zie hieronder) |

| Component of hulpje | Wat |
| --- | --- |
| `FieldsEditor` (`fieldsDraft` → `buildFields`) | De velden van een lijst, elk een wit kaartje in de groep: naam en soort veld (gegroepeerd) op één regel, onder ⋯ de uitleg bij die soort, keuzes, eenheid, verwijzing, codeformaat, wat een berekening uitrekent, kolom, filter, verplicht, uitleg, en wat het veld zelf invult (Begint met vandaag, Begint met jou, Leeg = verdelen met de gewone verdeling) |
| `FieldInputs` (`attributesDraft` → `buildAttributes`) | De velden invullen; korte velden per twee (`.attr-fields`). Een veld dat je niet mag wijzigen, staat er alleen-lezen. Een berekening staat er als `.calc-output` (stippellijn) en rekent mee terwijl je typt |
| `AttributeRows` | De ingevulde velden als regels in de `dl` van een fiche; verwijzingen linken naar het item, een webadres toont enkel het domein als link, e-mail en telefoon openen mail of telefoon, een adres een kaart (op een kiosk als tekst). Bij een berekening een `Tip` met wat ze uitrekent |
| `ChecklistInput`, `ChecklistView` | Takenlijst (`.checklist`): invullen met altijd een lege regel onderaan; op de fiche een eigen kaart waar je meteen afvinkt (bewaart zonder het formulier) |
| `PeoplePicker` | Personen aanvinken: `tag person-chip` (een tag met avatar) |
| `ItemsSelect` | Meerdere items uit een andere lijst: kleine tags met een kruisje (`.ref-chips`), een keuzelijst eronder |
| `CodeInput`, `CodeView` | Een barcode of QR-code: typen, formaat kiezen of scannen; groot tonen om te laten scannen (zwart op wit) |
| `ItemSelect` | Een verwijzing naar een item uit een andere lijst (de wijn → het wijnhuis) |
| `SharesField` (`sharesDraft`) | **Eigenaar**: wie welk deel heeft (Gelijk · Procent, samen 100). Leeg = van het project samen |
| `ScoreInput`, `ScoreStars` | Score op 5 met halve sterren (tik nog eens voor een halve) |
| `LabelScanner` | Foto van een etiket: de app vult naam en velden in (zacht blauw, `auto`) en bewaart de foto |
| `ItemPhoto` | De foto van een item bovenaan de fiche: toevoegen, vervangen, weghalen. Nog geen foto: een zacht vlak met een glazen knop erop |
| `IconPicker` (`IconPicker.tsx`) | Een icoon kiezen voor een project of lijst (`ICONS` in `shared/templates.ts`): grijze tegeltjes, het gekozen is zwart |

- "Eigenaar" is van wie iets is; "Van wie" is enkel de herkomst van iets dat je kreeg.
- Herhaling (`.interval-input`): "elke [3] [maanden]". Duur typ je vrij ("1u30", "90", "1,5 uur"); onder het veld
  staat wat de app las ("= 1 u 30 min") als dat anders is dan wat je typte.
- Een datum kan **Begint met vandaag** hebben (`today`, schakelaar onder ⋯): een nieuw item krijgt de datum van
  vandaag in het formulier (wat je at, een uitgave). Je ziet ze staan en past ze aan; de API vult niets stil in.
- Een nieuw project begint met een **sjabloon** (`PROJECT_TEMPLATES` in `shared/templates.ts`, `.template-picker`):
  lijsten met hun velden. Niet gekozen is een sjabloon een zacht grijs vlak; gekozen komt het naar voren als glas
  met een zwart icoontegeltje. Daarna kan je alles aanpassen. Een nieuwe use case begint best als sjabloon, gebouwd
  uit de bouwstenen (velden, formule, totalen): **Voeding** is een lijst Eten met kcal per 100 g × Hoeveel als
  formule en het totaal "Kcal per dag"; **Gedeelde uitgaven** is Betaald door, een Verdeling en een totaal dat
  verrekent. Geen eigen code. Losse
  lijsten (Onderhoud, Abonnementen, Recepten, Reizen, Contacten, Taken) staan in `LIST_TEMPLATES`; je voegt ze toe
  bij **Instellen → Lijsten → Uit sjabloon**.
- Snel veel invullen: "Opslaan en volgende" (`.form-actions`, een `btn-outline` naast de hoofdknop). Een tabel
  importeren (`ImportPage`, `.column-map`: kolom → veld, onthouden per lijst; wat we niet herkennen gaat bij de
  lange tekst) is een eigen scherm.

### Berekeningen: `CalcEditor`

Een veld van de soort **Berekening** rekent de app zelf uit, bij het lezen (niets wordt bewaard). Bewust een handvol
soorten, elk met één vraag (`CALC_KINDS` in `shared/calc.ts`, met uitleg):

| Soort | Voorbeeld |
| --- | --- |
| Rekensom | Aantal × Prijs; Totaal × 1,21 (een berekening op een berekening mag) |
| Formule | `[kcal per 100 g] × [Hoeveel] ÷ 100`; met haakjes, `afronden`, `min`, `max` en `als` (`shared/formula.ts`) |
| Vergelijking (ja/nee) | Aantal ≤ Bijna op onder → "Kopen" |
| Dagen tot | Garantie tot → "over 138 dagen", "vandaag", "3 dagen geleden" |
| Tijd sinds | Jaargang → "10 jaar" |
| Datum plus | Laatst onderhouden + Herhaling → Volgend onderhoud |
| Uit een gelinkt item | Via de Verwijzing Wijnhuis: zijn Land |
| Samenvatten | Hoeveel, som, gemiddelde, kleinste, grootste: van de items in een Verwijzing(en)-veld, of van de items die hiernaar verwijzen (wat je bij een verkoper uitgaf) |

- `CalcEditor` staat onder ⋯ van het veld: eerst de soort (met de uitleg eronder), dan per soort de velden. Elke
  keuzelijst toont enkel velden die passen.
- Een formule typ je zoals je ze leest (`.formula-input`): velden tussen [ ] met hun **naam**, × en ÷ mogen. Onder
  het vak staan de velden als kleine tags (`.formula-fields`): een tik voegt `[Naam]` in waar de cursor staat. Bewaard
  wordt ze met de sleutels (hernoemen breekt niets). Nooit `eval`: een eigen ontleder, met fouten in gewone woorden
  ("de formule stopt te vroeg", "gebruik ; tussen de delen"). Wat nog niet klopt, staat er meteen onder in rood (`previewCalcs`);
  de API kijkt hetzelfde na (`checkCalcs`) en weigert een kring.
- De uitkomst toont zoals een veld van die soort (bedrag, datum, ja/nee, getal met eenheid); een opgezocht webadres
  is een link. Ze kan een kolom of filter zijn.
- Rechten: een berekening telt enkel wat jij mag zien. Mag je een veld waarvan ze afhangt niet zien, dan blijft
  ze leeg (ook een som over gelinkte items als je bij één ervan het veld niet ziet).
- Opzoeken en samenvatten rekent de API uit (`worker/compute.ts`); in het formulier staan die er niet, op de fiche wel.

### Totalen: `TotalsEditor` en `TotalsCards`

Een **totaal** vat de items van een lijst samen (`shared/totals.ts`): de som, het gemiddelde, het kleinste, het
grootste of hoeveel, van een getal, bedrag of duur (ook een berekening), alles samen of per dag, week (vanaf
maandag), maand of jaar volgens een datumveld. Eventueel apart per persoon, eigenaar of keuze, en met een doel
("niet meer dan" of "minstens"). Hooguit vier per lijst. "Kcal per dag", "Uitgaven per maand per persoon",
"Gemiddelde score" en Wie moet wie zijn hetzelfde onderdeel.

- **Waar**: dit project, of met de subprojecten. **Ook uit**: lijsten uit andere projecten met dezelfde velden (op
  sleutel, van dezelfde soort; een lijst uit hetzelfde sjabloon past altijd). Hooguit vijf.
- **Tegenover** (een saldo): per persoon of keuze de som bij Apart per, min die bij Tegenover. Betaald door tegenover
  Verdeling = wie nog geld krijgt (+) of moet (−).
- **Verrekenen**: een saldo van een bedrag tussen personen (Apart per en Tegenover zijn een Persoon of Personen met
  aandeel), alles samen, met de subprojecten. Dat is Wie moet wie; het krijgt geen eigen kaart.

| Waar | Hoe |
| --- | --- |
| Formulier van een lijst, groep "Totalen" (onder de velden) | `TotalsEditor`: per totaal een wit kaartje: de naam (leeg = een naam uit wat het telt, als placeholder), Wat, Van, Periode en Waar (`Segmented`), Volgens, Apart per, Tegenover (bij een som per persoon of keuze), Doel (soort + getal), de schakelaar Verrekenen (als het kan), en Ook uit (`tag-picker`: "Uitgaven · Skireis", enkel lijsten die passen). "Totaal toevoegen" als `btn-outline btn-sm` |
| Project, zijkolom, bovenaan (`split-lead`) | `TotalsCards`: per totaal een sectie. Titel = naam, uitleg = de periode en waar ("Vandaag · met subprojecten · ook uit andere projecten"). Een groot getal (32px, 600, telt op met `useCountUp`), de doelbalk (`.total-bar`, groeit vanaf links), staafjes per periode (`.total-history`: de huidige zwart, boven de grens rood, het doel als stippellijn) en per persoon of keuze (`.total-groups`; bij een saldo met + of −) |

- Enkel de lijst die openstaat: wissel je van tab, dan wisselen de totalen mee.
- De API rekent uit (`/projects/:id/totals`), per lezer: elk item met jouw rechten in zijn project. Wat je daar niet
  mag zien (het project, de lijst, een veld van het totaal of iets waarvan het afhangt), telt niet; zit je niet in
  het andere project, dan telt er niets van. Een totaal op een veld dat je in het project zelf niet mag zien, stuurt
  de API niet mee (`visibleTotals`). Zonder archief.
- Kleur: zwart is gewoon; rood (`--danger-solid`) enkel boven een "niet meer dan"; groen (`--success-solid`) als
  "minstens" gehaald is. De tekst eronder zegt het ook ("Nog 307 kcal tot 1.800 kcal", "120 kcal boven 1.800 kcal").
- Getallen via `formatTotal` (`src/format.ts`): duizendtallen, vanaf 100 zonder kommagetal. Bedragen en duur zoals
  overal (`formatCents`, `formatDuration`).
- Bij een bedrag met een verdeling ("apart per Verdeling") telt per persoon zijn deel.

### Uitleg: `Tip`

`<Tip text="…" label="Hoe Totaal berekend wordt" />` is een kleine (i) naast een label: de uitleg verschijnt in
een zwart ballonnetje bij aanwijzen, focus of tikken (gsm), en sluit met Escape, ergens anders tikken of scrollen.

- Enkel waar uitleg echt helpt en niet in één `.hint` past: bij een berekening (wat ze uitrekent), bij een keuze
  die je moet begrijpen ("Welke items" bij samenvatten).
- Uitleg die iedereen nodig heeft, staat gewoon als `.hint` onder het veld; verberg ze niet in een `Tip`.
- Op een `label` werkt de (i) zonder het veld te focussen.

### Sjablonen delen: `ShareTemplate` en `TemplateFilePicker` (`TemplateShare.tsx`)

Een project (met zijn subprojecten) of één lijst kan je delen als bestand (`.thuis.json`, `shared/template-file.ts`):
de lijsten, velden, berekeningen en totalen, **zonder** items, mensen, rollen, tags, gewone verdelingen of lijsten
uit andere projecten bij "ook uit". Een sjabloon van vroeger met regels wordt bij het inlezen velden en een totaal.

| Waar | Wat |
| --- | --- |
| Instellen → Algemeen, kaart "Delen als sjabloon" | `ShareTemplate`: "Als bestand bewaren", en op een gsm ook "Delen…" (deelmenu). Niet op een kiosk |
| Formulier van een lijst, kaart "Deze lijst delen" | Dezelfde knoppen, voor één lijst (met de lijsten waarnaar ze verwijst) |
| Nieuw project → "Uit een bestand" | Kies het bestand; naam, icoon, kleur en beschrijving komen eruit, wat erin zit staat in `.template-file` |
| Instellen → Lijsten → "Uit sjabloon" | Een `Sheet`: bovenaan "Uit een bestand…", daaronder de ingebouwde lijsten (een badge "Staat er al" als die naam al bestaat) |

- Een lijst die meekomt omdat ernaar verwezen wordt (de Verkopers bij Wijnen), wordt bij het importeren hergebruikt
  als er erboven al een lijst met die naam is.
- Wat binnenkomt, kijkt zowel de app als de API na; een verwijzing kan enkel naar een lijst uit het sjabloon of uit
  de eigen keten. Wat niet klopt, valt weg in plaats van alles te weigeren (behalve een kapot bestand).

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

- De gesleepte rij zweeft (wit, `--shadow-lg`) en volgt de vinger; de andere schuiven opzij; dicht bij de rand scrolt
  de lijst mee. Na het loslaten staat alles meteen op zijn plaats.
- Bewaren gebeurt bij het loslaten, zonder toast: de verplaatste rij is de bevestiging (zoals bij −/+). Een fout
  geeft een toast en zet de volgorde terug.
- Een lijst die je niet mag ordenen, toont geen greep.
- Geen `stagger` op een sorteerbare lijst: een verplaatste rij zou opnieuw binnenkomen.
- Wat de volgorde betekent: de projecten bovenaan je overzicht zijn **jouw** volgorde (per persoon); subprojecten
  en lijsten zijn die van het project (enkel met `manage`), en de lijsten bepalen ook de volgorde van de tabs.
- Volgorde is een instelling, geen knop op een overzicht: je projecten bij **Ik**, subprojecten bij **Instellen →
  Algemeen** (`ProjectOrder`), lijsten bij **Instellen → Lijsten**, velden in het formulier van een lijst.

### Kosten verdelen: `BalanceCard`

Kosten verdelen is geen apart onderdeel meer, maar velden en een totaal dat verrekent (de sjablonen Uitgaven en
Terugbetalingen zetten het klaar):

| Lijst | Velden | Totaal |
| --- | --- | --- |
| Uitgaven | Bedrag, Betaald door (**Begint met jou**), Verdeling (**Leeg = verdelen**, met de gewone verdeling) | Som van Bedrag apart per Betaald door, tegenover Verdeling, verrekenen |
| Terugbetalingen | Bedrag, Van, Aan (twee personen) | Som van Bedrag apart per Van, tegenover Aan, verrekenen. "Terugbetaald" bewaart hier |

- Wat velden zelf invullen (`applyFieldDefaults`): een Persoon met "Begint met jou" krijgt bij een nieuw item jou
  (als je in het project zit); Personen met aandeel met "Leeg = verdelen" krijgt de gewone verdeling, anders gelijk
  over iedereen. De API doet hetzelfde bij bewaren en importeren; wat ingevuld is, blijft.
- Een bedrag verdeelt tot op de cent (`splitCents`): de cent die overschiet, draagt wie betaalde. Een uitgave telt
  enkel mee als ze een bedrag, iemand die betaalde en een verdeling heeft (anders kwam het niet op 0 uit).

- `BalanceCard` ("Wie moet wie") staat in de zijkolom van een project, met alles eronder. Per overschrijving één
  rij: avatar, "Jana moet jou nog", rechts het bedrag, en een `link-button` "Terugbetaald" (een `Sheet` met bedrag
  en datum; minder mag). Niets open: "Alles is verrekend."
- Op gsm komt de kaart vóór de lijst: geef ze `split-lead` (de zijkolom valt open onder 960px).
- "Jij/jou" in plaats van je eigen naam ("Jij moet Jaan nog", "Jana moet jou nog").
- Telt enkel wat je mag zien (de lijst en de velden van het totaal, per project); wat verborgen is, telt niet mee.
- Een nieuwe use case (voorraad, ...) bouw je eerst uit velden, berekeningen en totalen, als sjabloon. Pas als dat
  echt niet gaat, een eigen onderdeel bovenop de kern.

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
  `Segmented` met "Standaard" erbij (open per lijst met "Per veld", `.role-type`; de velden in een wit kaartje,
  `.role-fields`).
- Afbeeldingen en bestanden uit de API altijd via `apiUrl("/…")`.

### Kleine bouwstenen

| Klasse of component | Gebruik |
| --- | --- |
| `.link-quiet` | Link in een `dl` of tekst: geen kleur, een zacht lijntje eronder |
| `.link-button` | Stille blauwe tekstknop naast een label ("Per veld", "Wissen") |
| `.tips-block` | Een lange tekst op de fiche, met de regels zoals getypt |
| `.timeline` + `.timeline-date` | Logboek: datum links, notitie rechts |
| `.member-actions` | Rol (een `select`), bewerken en weghalen naast iemand in een lijst |
| `.dashboard` + `.dash-card` + `.dash-head` | Het overzicht: zachte witte kaarten zo breed als past, die 2px omhoog komen bij aanwijzen; de kop opent het project, de rijen eronder de lijsten |
| `.sr-only` | Tekst enkel voor schermlezers (bv. de nieuwe plaats na het verslepen) |

### Badges, tags, stipjes, avatars

| Element | Gebruik |
| --- | --- |
| `badge` | Grijs vlak zonder rand: neutrale status ("Lid", "inactief") |
| `badge badge-success` | Iets loopt goed (garantie loopt) |
| `badge badge-warning` | Aandacht (bijna op, vervalt binnenkort) |
| `badge badge-danger` | Voorbij (vervallen) |
| `badge badge-accent` | Nieuw of info |
| `tag tone-x` | Tags van de gebruiker: pillen, niet gekozen grijs, gekozen in de kleur van de tag (met een vinkje) |
| `dot tone-x` | De kleur van een project of tag in een lijst |
| `Avatar` | Personen: pastel rondje met een dunne gekleurde letter; `size="sm"` in tekst, gewoon in lijsten, `lg` in kaarten |

Badges zijn kort: 1–3 woorden.

### Meldingen

| Situatie | Component |
| --- | --- |
| Iets is bewaard, verwijderd, verplaatst | `useToast()("Wijn bewaard")`: een glazen pil met een zwart rondje (rood bij `"alert"`), rechtsonder (tablet) of boven de onderbalk |
| Iets gebeurt of lukte half binnen een formulier | `<Alert tone="busy" \| "ok" \| "partial" \| "none">`: een zacht vlak zonder rand |
| Iets kan niet ongedaan gemaakt worden | `useConfirm()({ title, body, confirmLabel, danger: true })` |
| Een korte invoer (notitie in het logboek, iemand toevoegen, een tag) | `<Sheet>`: een glazen onderblad dat los onderaan zweeft (gsm), een glazen venster in het midden (tablet) |
| Lijst is leeg | `<EmptyState icon title action>`: een zacht vlak met een glazen icoontegel, één zin uitleg en hooguit één knop (`btn-outline btn-sm`) |
| Lijst laadt | `<SkeletonRows rows={5} />` (verschijnt pas na 0,18 s) |

Toasts zijn de bevestiging na een actie. Elke bewaar- of verwijderactie geeft er één, behalve −/+ in een lijst en
het verslepen van een rij: daar is wat beweegt de bevestiging (een toast per tik zou storen).
Tekst: wat er gebeurde, in de verleden tijd of als korte vaststelling ("12 wijnen toegevoegd", "Rol bijgewerkt").

### Iconen

Twee soorten, inline in `Icon.tsx`:

- **Gevuld voor dingen** (bon, kaart, doos, portefeuille, speld, tandwiel, …): Phosphor "fill" (phosphoricons.com).
  Grijs (`--muted-foreground`) in menu en ghostknoppen; in de kleur van de tekst in een knop; donker als het item
  actief is.
- **Lijnen voor richtingen en handelingen** (plus, min, kruis, vinkje, chevrons, pijl, zoeken, downloaden, delen,
  uitleg (i)): Lucide-stijl, 1,9 dik.
- Een nieuw icoon: pad kopiëren van een van beide sites naar de juiste lijst (`FILLED` of `LINES`).
- Maten: 12 (in de toast) · 14–16 (knoppen, filters, tekst) · 17 (zijbalk) · 18 (standaard) · 21 (onderbalk).

### Getallen

- Bedragen: `formatCents` → "€ 1.234,56". Datums: `formatDate` → "20 okt 2026". Hoeveelheden: `formatNumber` +
  `unitWord` ("3 flessen").
- Een getal dat kan veranderen terwijl je kijkt (tellers): `<Num value={n}>` rolt omhoog of omlaag.
- Een groot totaal dat verschijnt: `useCountUp(cents)` telt op.

---

## 5. Beweging

Curves (in `:root`): `--ease-out` voor bijna alles · `--spring` voor iets dat naar zijn plaats **veert** (de glazen
duim van tabs en segmenten, de lens in de zijbalk, het vlak in de onderbalk, de schakelaar, iconen) ·
`--ease-in-out` voor heen-en-weer (scanlijn).

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
| Tab, segment, menu wisselt | de glazen duim of lens veert naar de nieuwe keuze (`--spring`) | 0,55 s |
| Zoekresultaat wisselt | grijs vlak glijdt mee | 0,3 s |
| Terug (gsm) bij scrollen | pil krimpt tot rondje, titelpilletje veert in | 0,45 s |
| Boom klapt open | rij groeit (`grid-template-rows`), kinderen schuiven één voor één in, pijltje draait | 0,4 s |
| Getal verandert | rolt in de richting van de verandering (`Num`) | 0,38 s |
| Totaal verschijnt | telt op (`useCountUp`) | 0,9 s |
| Balk of meter | groeit vanaf links / van onder (`.total-bar`, `.total-history`, `LevelMeter`) | 0,5–1 s |
| Onderblad, venster, zoekpalet | glijdt (onderblad) of veert (venster, palet) in en uit (`@starting-style`) | 0,4–0,6 s |
| Toast | veert omhoog, glijdt weg | 0,55 / 0,25 s |
| Vinkje | tekent zichzelf (`draw`) | 0,4 s |
| Rij verslepen | de rij volgt de vinger, de andere schuiven opzij (`useSortable`) | 0,25 s |
| Indrukken | knop, filter en tag schalen naar 0,96 en veren terug, icoon in menu naar 0,86 | 0,35 s |
| Hover | vlak wordt iets donkerder, glazen knop en projectkaart komen 1–2px omhoog, pijltje schuift 3px, + draait 90° | 0,2–0,45 s |

Regels:

- **`backwards`, nooit `both` of `forwards`.** Een animatie die na afloop een transform laat staan, maakt van het
  element het referentiekader voor vaste elementen (terugknop, titelpilletje, + knop) en breekt die.
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
`split split-main-first`: rechts `ItemsView`, in de zijkolom de totalen van de open lijst en Wie moet wie (als er
een lijst is die verrekent; op gsm beide vóór de lijst), Subprojecten en Wie (met de rol, en "via …" als het lidmaatschap van een project erboven komt) → `fab`. Zonder lijsten: een lege staat met "Lijst maken".

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
- Contrast: tekst haalt 4,5:1, ook op een grijs vlak; dus minstens `--muted-foreground` (ook voor placeholders en
  kolomkoppen). `--faint` enkel voor iconen en bijzaken.
- Glas is nooit de enige drager van tekst: wat erop staat, is donker genoeg, ook als het toestel geen vervaging kan.
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
- Geen gekleurde kaarten, geen verlopen behalve het glas.
- Geen glas op een vlak waar gewoon inhoud op staat (een kaart, een groep, een rij): glas is voor wat zweeft of
  gekozen is.
- Geen tweede hoofdknop op één scherm.
- Geen randen rond grijze vlakken (velden, pillen, groepen): grijs is een vlak.
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
- [ ] Enkel tokens uit `:root`; geen losse kleurcodes, px-schaduwen of lettertypes. Glas enkel voor wat zweeft of
      gekozen is.
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
- [ ] Moet iets uitgelegd worden? Eerst een `.hint`; een `Tip` enkel waar de uitleg niet in één regel past.
- [ ] Nieuw patroon nodig? Bouw het als component, en **voeg het toe aan dit stijlboek**.
