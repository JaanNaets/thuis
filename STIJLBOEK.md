# Stijlboek Thuis

Dit stijlboek is de afspraak voor hoe Thuis eruitziet en aanvoelt. **Raadpleeg het voor je een scherm,
onderdeel of tekst toevoegt of verandert**, en werk het bij als je iets nieuws introduceert.

De stijl volgt de designtaal van Biohoeve (beheer en mijn): **een warme grijze schil met de pagina op één wit
paneel**, links het menu, rechts het werk. Strak en stil: dekkende haarlijnen van 1 px, kaarten met een ring in
plaats van een schaduw, een wit vlak dat naar je keuze glijdt, en één accent: **geel (#f7ff8b) als vlak met zwarte
tekst** voor de hoofdactie. Op de gsm een kop bovenaan en een onderbalk onderaan, allebei op de schil. Wat iets
onderscheidt, is zijn plaats, zijn lijn en zijn beweging, niet versiering.

De bouwstenen staan in code; dit document zegt welke je wanneer gebruikt.

| Wat | Waar |
| --- | --- |
| Kleuren, maten, schaduwen, curves, duren | `src/styles.css`, bovenaan in `:root` |
| Componenten | `src/components/` (vooral `Controls.tsx`, `Page.tsx`, `Motion.tsx`, `Sidebar.tsx`, `MenuSheet.tsx`, `Sheet.tsx`) |
| De schil (zijbalk, onderbalk, menublad, de +) | `src/App.tsx`, `src/shell.ts` (`useAddAction`, `PhoneAdd`) |
| Lijsten, velden en dingen | `src/components/Fields.tsx`, `ThingsView.tsx` en `shared/fields.ts` |
| Berekeningen | `src/components/CalcEditor.tsx` en `shared/calc.ts` |
| Sjabloon delen | `shared/template-file.ts` |
| Rechten | `shared/rights.ts` (wat een rol mag) |
| Navigatie met overgangen | `src/router.tsx` (`Link`, `NavLink`, `useNavigate`) en `src/routes.tsx` |
| Iconen | `src/components/Icon.tsx` |
| Opmaak van bedragen, datums, hoeveelheden | `src/format.ts` |
| Toestel: kiosk, online, app installeren, aanraken | `src/device.ts` (`isKiosk`, `useOnline`, `useInstall`, `isTouch`) |

---

## 1. Principes

1. **Rustig.** Wit en grijs dragen het scherm. Kleur is een signaal, geen decoratie.
2. **Eén accent: geel als vlak.** `--brand` (#f7ff8b) enkel als vlak met zwarte tekst: de hoofdknop, de + in de
   onderbalk, het merktegeltje, een zachte tint voor wat de app invulde. **Nooit als tekst, icoon of dunne lijn**
   (op wit haalt geel geen contrast). Nergens een tweede accentkleur.
3. **Zwart voor de kleine bediening.** Een aangezette schakelaar, een vinkje, vandaag in de kalender, een gekozen
   icoon en de reeks van nu in een grafiek zijn zwart (`--primary`).
4. **Alles hangt ergens aan.** Een menu, een blad of een melding komt uit een rand (de onderbalk, de onderrand van
   het scherm), niet als los ding dat ergens zweeft. Er is geen zwevende knop: de + zit in de onderbalk.
5. **Lijnen lopen door.** Eén dekkende haarlijn (`--line`) rond het paneel, boven de onderbalk en rond een blad.
   Een rand is een ring van 1 px als schaduw (`--shadow-card`, `--shadow-surface`), geen `border`, behalve bij een
   veld en een knop met rand. Geen schaduw rond het paneel; echte schaduw enkel voor wat erover ligt.
6. **Kiezen is een wit vlak.** Waar je kiest (tabs, segmenten, het menu, de onderbalk, een filter), verhuist een wit
   vlak met een ring (`--surface` + `--shadow-surface`) naar je keuze; er kleurt geen andere knop in.
7. **Strak en klein.** Paginatitel 24px vet, knoppen en velden 32px (40px op een aanraakscherm), afrondingen uit één
   schaal (10, 14, 18, 20). Elk raakvlak is minstens 44px (`--hit`), ook als de knop kleiner is.
8. **Beweging speelt één keer, kort.** Kleur en hover in 150 ms, een vlak glijdt in 320 ms, een blad komt in 300 ms
   en gaat in 200 ms, zonder nawiebelen. Nooit beweging bij het scrollen, nooit om de beweging.
9. **Mobiel eerst, kiosk mee.** Elk scherm werkt op een gsm met de duim én op de keukentablet met een natte
   vinger.
10. **Nederlands zoals we het zeggen.** Kort, vriendelijk, "je". Zie [Tekst](#9-tekst).
11. **Geen uitleg in de interface.** Geen ondertitel die herhaalt wat het kruimelpad of de titel al zegt, geen
    uitlegzin onder een veld of kaart, geen "· optioneel", geen tellers of rollen als bijlabel. Snapt iemand een
    scherm niet zonder uitleg, dan is de opbouw of het label fout: maak het label duidelijker, zet iets op een
    betere plaats, of laat het weg. Grijze tekst onder een titel is enkel voor **gegevens** (de beschrijving van
    een lijst, je e-mailadres, "2 van 3 klaar", "Deze maand") of een **toestand** (een fout, "enkel zien").
    Uitleg op vraag kan enkel bij een berekening (`Tip`) of als titel van een keuze in een `select`.
12. **Elk gegeven staat één keer op het scherm.** Wat in de zijkolom staat, staat niet nog eens in de kaarten.

---

## 2. Tokens

Gebruik altijd de variabele, nooit de kleurcode zelf. De waarden komen uit de maten van Biohoeve.

### Kleur

De grijzen in het paneel zijn doorschijnend zwart (`rgb(0 0 0 / …)`): zo werkt hetzelfde vlak op wit én op een
grijze groep. Lijnen zijn dekkend.

| Variabele | Waarde | Gebruik |
| --- | --- | --- |
| `--canvas` | #f2f2ef | De schil: achter het paneel, de zijbalk, op gsm de kop, de onderbalk en het menublad |
| `--background` | #ffffff | Het paneel, de pagina op gsm, kaarten |
| `--surface` (+ `--shadow-surface`) | #ffffff | Het witte vlak: wat gekozen is (tab, segment, menu-item, filter), wat erover ligt (blad, palet, melding, keuzelijst) |
| `--group` | zwart 2,5% | Een groep velden in een formulier, een instelling |
| `--subtle` | zwart 3% | Zacht vlak: lege staat, bestanden, lange tekst |
| `--muted` (+ `-strong`, `-solid`) | zwart 4,5% (7,5%; dekkend #f5f5f5) | Zachte knoppen, filters, tags, sporen van tabs en segmenten |
| `--field` | #ffffff | Invoervelden: wit met een rand (`--input`) |
| `--hover`, `--press` | zwart 4% / 5,5% | Hover van een rij of menu-item; ingedrukt |
| `--bar`, `--bar-blur`, `--bar-line` | schil 95%, waas 8px, zwart 6% | Enkel de kop en de onderbalk op gsm (boven scrollende inhoud) |
| `--foreground` | #0a0a0a | Hoofdtekst, titels |
| `--text-soft` | #404040 | Tekst in menu en zachte knoppen |
| `--muted-foreground` | #6b6b6b | Gegevens, kolomkoppen, placeholders (haalt 4,5:1 op wit én op de schil) |
| `--faint` | #a3a3a3 | Enkel iconen en bijzaken (greep, ster uit), nooit tekst |
| `--line` | #e3e3e1 | De dekkende haarlijn: rond het paneel, boven de onderbalk |
| `--border` (+ `-strong`), `--input` | #e5e5e5 (#d4d4d4) | Velden, een knop met rand, de onderlijn van een tekstlink, stippellijnen |
| `--divider` | zwart 6% | Haarlijn tussen rijen en secties in een kaart (raakt de rand niet) |
| `--brand` (+ `-hover`, `-press`, `-edge`, `-foreground`) | #f7ff8b | De hoofdknop, de +, het merktegeltje; altijd met zwarte tekst en een randje (`--brand-edge`) |
| `--accent-soft`, `--accent-line` | geel, zacht | Wat de app invulde (`auto`, `.tag.is-filled`), tekstselectie |
| `--primary` | #0a0a0a | Schakelaar aan, vinkje, vandaag, gekozen icoon of sjabloon, de reeks van nu |
| `--destructive` (+ `-soft`) | #c10007 | Verwijderen (rode tekst op een rode tint van 10%), foutmeldingen |
| `--ring`, `--focus-ring`, `--focus-outline` | #a1a1a1 | Focus: een grijze rand met een ring van 3px op knoppen en velden, elders een omlijning |
| `--success*`, `--warning*`, `--danger*` | | Status: loopt / bijna voorbij / voorbij |

**Grafiekkleuren** (`--chart-1` … `--chart-8`, `--chart-other`, `--chart-muted`, `--chart-grid`, `--chart-axis`)
zijn enkel voor gegevens in een grafiek (staafjes, lijnen, stukken), in vaste volgorde en nagekeken op
kleurenblindheid: geen tweede accent, en nooit voor tekst. Eén reeks is grijs (`--chart-muted`) met de periode van
nu zwart (`--primary`); meer reeksen krijgen elk een vaste kleur, de rest is "Overige" (`--chart-other`).

**Tonen** (`tone-peach`, `tone-butter`, `tone-sage`, `tone-mint`, `tone-sky`, `tone-lilac`, `tone-rose`) zijn de
kleuren van lijsten, tags en personen. Ze geven `--tone`, `--tone-soft`, `--tone-line`, `--tone-mid`
en `--tone-ink`. Gebruik ze **enkel** voor stipjes (`.dot`), avatars, het vierkantje voor een rij (`.row-media`),
de iconen van lijsten in de zijbalk en tags. Nooit voor knoppen, kaarten of grote vlakken.

### Typografie

- Lettertype: **Geist** (variabel), ook voor titels. Cijfers in kaartnummers en barcodes: Geist Mono (`.mono`).
- Bedragen en aantallen altijd met `font-variant-numeric: tabular-nums` (klassen `.num`, `.row-end`, `.total-value`).
- Een sectiekop in het menu staat in **kleine kapitalen**: hoofdletters, 12px, 600, spatiëring 0,05em, stil.

| Rol | Grootte | Gewicht |
| --- | --- | --- |
| Paginatitel | 24px | 700, −0,02em |
| Groot bedrag | 30–38px | 600, −0,03em |
| Titel van een kaart of sectie | 15px | 600 |
| Titel in een blad | 18px | 600 |
| Gewone tekst | 14px (muis), 15px (aanraking) | 400 |
| Menu in de zijbalk | 14px | 400, gekozen 500 |
| Knop | 14px (sm 13px) | 500 |
| Tab, segment, filter | 13px | 500 |
| Kolomkop, metadata | 12,5–13,5px | 400–500 |
| Label in de onderbalk | 11px | 500 |
| Badges, tellers | 11,5–12px | 500 |

### Maten

- Raster van **4px**. Gebruikelijke afstanden: 4, 8, 12, 16, 20, 24, 32. Een kaart: 12–16px binnenin.
- Afronding (één schaal): `--radius-sm` 6 (badges) · `--radius`, `--radius-md`, `--radius-lg` 10 (knoppen, velden,
  menu-items, rijen; een kleine knop 8) · `--radius-xl` 14 (kaarten, lege staat, zoekpalet, het vlak in de
  onderbalk) · `--radius-2xl` 18 (groepen in een formulier) · `--radius-panel` 18 (paneel) · `--radius-sheet` 20
  (blad, venster) · `--radius-pill` (filters, tags, badges, schakelaar). Een spoor is zo rond als het vlak erin plus
  de ruimte ertussen (spoor 9, vlak 7).
- Randen en schaduwen: `--shadow-card` (ring van 7% met een zweem) voor een kaart, `--shadow-surface` voor het witte
  vlak, `--shadow-inset` voor een wit kaartje in een grijze groep, `--shadow-xs` onder een veld of knop met rand,
  `--shadow-lg` enkel voor wat erover ligt (zoekpalet, venster, melding, de gesleepte rij), `--shadow-sheet` voor
  een blad van onder.
- Hoogtes: `--control` 32px (knop en veld; klein 28, groot 36) · op aanraakschermen `--control-touch` 40px (klein
  36, groot 44) · `--hit` 44px raakvlak (een `::after` dat uitsteekt) · kop op gsm 48px · onderbalk `--tabbar` 56px ·
  menu-item 32px (in het menublad 44px).
- Duren: `--dur` 150ms (kleur, rand, hover) · `--dur-page` 260ms (een nieuw scherm) · `--dur-glide` 320ms (een vlak
  dat glijdt) · `--dur-sheet-open` 300ms en `--dur-sheet-close` 200ms (blad, venster, palet).

---

## 3. Layout

### Gsm (smaller dan 768px)

```
┌ kop (schil, 48px, plakt) ──────────────┐
│ ‹            Wijnen           ⌕   (J)  │  ← terug of ▣ Thuis · titel zodra je scrolt · zoeken · jij
├────────────────────────────────────────┤
│ Wijnen                          (⋯)    │  ← titel 24px
│ [ Wijnen · Logboek ]                   │
│ …                                      │
├ onderbalk (schil, 56px, van rand tot rand) ┤
│ ◖Overzicht◗  Agenda  [ + ]  Geld  Menu │
└────────────────────────────────────────┘
```

- Witte pagina, inhoud met 16px marge, een titel van 24px.
- **De kop** (`.phone-head`, in `PageHead`): 48px op de schil met een waas, plakt bovenaan, een haarlijn eronder.
  Links **terug** (een icoonknop van 36px) of het merk (▣ Thuis, naar het overzicht); rechts **zoeken** (opent het
  [zoekpalet](#zoekpalet-commandpalette)) en **jouw letter** (naar `/ik`). Zodra de grote titel onder de kop
  schuift, verschijnt hij klein in het midden.
- **De onderbalk** (`.tabbar`): vast onderaan, van rand tot rand, op de schil met een waas en een dekkende lijn
  erboven. Vijf tabs: **Overzicht**, **Agenda**, de gele **+**, **Geld** en **Menu**. Het witte vlak glijdt naar
  waar je bent; Menu licht op voor wat enkel in het menublad staat (een lijst, Voorraad, Eten, …) en zolang dat
  open is.
- **De +** doet wat het scherm vraagt (`useAddAction` of `<PhoneAdd>` uit `src/shell.ts`: een lijst voegt een ding
  toe of logt), anders opent hij het palet om toe te voegen. Er is geen zwevende knop.
- **Het menublad** (`MenuSheet`, achter Menu): op de schil, zoeken bovenaan (opent het palet), de vaste plekken,
  je lijsten per tag en Jouw gegevens; het witte vlak op waar je bent. Een tik op een rij sluit het blad.
- Tabelkolommen verdwijnen: de info staat in de grijze regel onder de titel (`.narrow-only`).

### Tablet en kiosk (vanaf 768px)

```
┌ schil #f2f2ef ─────────────────────────────────────────────────────────────┐
│ ▣ Thuis          ┌ paneel (wit, haarlijn, 18px) ──────────────────────────┐ │
│ [⌕ Zoeken…]      │ Overzicht › Wijnen               [+ Wijn toevoegen]  (J)│ │  ← paneelbalk 56px
│ ◖Overzicht◗      ├────────────────────────────────────────────────────────┤ │
│ Agenda …         │ Wijnen                                          (⋯)    │ │  ← titel 24px
│ LIJSTEN          │ [ Wijnen · Logboek ]                                   │ │  ← tabs
│ ⌄ Huis           │ zijkolom (320px)        zoeken, filters                │ │
│ │ Voorraad       │ Wie                     Wijn          Wijnhuis   Fles  │ │
│ │ Wijnen         │ ───────────             ─────────────────────────────  │ │
│ › Wijnkelder     │ Tags                    rijen …                        │ │
│ + Lijst          └────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Schil** met links de **zijbalk** (224px, tussen 768 en 1100px enkel iconen: 68px) en rechts een wit
  **paneel** (10px marge, een dekkende haarlijn `--line`, afronding 18px, geen schaduw). Het paneel scrollt zelf; de
  zijbalk blijft staan.
- **Zijbalk** (`Sidebar.tsx`), van boven naar onder: het gele merktegeltje met "Thuis" (naar het overzicht), het
  zoekveld als wit vlak (opent het [zoekpalet](#zoekpalet-commandpalette)), de vaste plekken en de
  [lijsten per tag](#zijbalk-lijsten-per-tag-sidebartsx). Het gekozen item ligt op het **witte vlak** dat meeglijdt.
- **Paneelbalk** (56px, wit, plakt bovenaan het paneel met een haarlijn eronder; de inhoud scrollt eronder door):
  kruimelpad met `›` links ("Overzicht › Wijnen"), rechts de hoofdactie (gele knop) en jouw letter in een wit
  rondje (naar `/ik`).
- **Kop**: een titel (24px, vet) + badge, eventueel gegevens eronder in grijs (zie principe 11), acties op het
  item rechts (`btn-outline btn-sm`). Geen lijn eronder.
- Inhoud daaronder met 20px marge. Een lijst en een ding gebruiken de [zijkolom](#zijkolom-split).
- Geen + in de inhoud: de hoofdactie staat in de paneelbalk.

### Opbouw van elk scherm

```
PageHead                 kop (gsm) + paneelbalk (tablet: kruimelpad, primary, avatar) + titel, badge, actions
Tabs                     als er weergaves zijn (Wijnen · Logboek · …)
toolbar                  zoeken (+ iconknoppen: importeren, exporteren als CSV)
filters                  filterpillen
card / card table        de inhoud — of .split met zijkolom en secties
PhoneAdd                 wat de + in de onderbalk doet (gsm, zelfde actie als primary)
```

---

## 4. Componenten

### Paginakop: `PageHead` (`Page.tsx`)

Elk scherm begint ermee. Hij maakt de kop (gsm: terug of het merk, zoeken, jij, en de titel zodra je scrolt), de
paneelbalk (tablet: kruimelpad, hoofdactie, jij) en de titel met badge en acties.

```tsx
<PageHead
  title="Wijnkelder"
  badge={<span className="badge">Gearchiveerd</span>}                 // optioneel, kort
  description={person.email}                                           // enkel gegevens, nooit uitleg
  back={{ to: -1, label: list.name }}                                  // de lijst, of terug
  actions={<Link className="btn btn-outline btn-sm" …>Instellen</Link>} // acties op dit scherm, rechts naast de titel
  primary={<Link className="btn btn-primary" …><Icon name="plus" size={16} /> Wijn toevoegen</Link>} // in de paneelbalk
/>
```

- Een overzichtsscherm (een lijst) heeft `primary`, en zet met `<PhoneAdd label=… to=… />` dezelfde actie op de +
  in de onderbalk. Een fiche heeft `back` en `actions`.
- Formulieren: `back={{ to: -1, label: … }}` (gewoon terug), geen `primary`.
- `description` is enkel voor gegevens van de gebruiker (je e-mailadres). Nooit een
  zin die het scherm uitlegt, en nooit wat het kruimelpad al zegt (de naam van de lijst).
- Op gsm staat in de kop links terug (met `back`) of het merk (zonder), rechts altijd zoeken en jouw letter.
- Meer acties dan plaats (op gsm: Opnieuw + Bewerken)? Dan springen de acties onder de titel; de titel breekt nooit
  midden in een woord.

### Zijkolom: `split`

Voor een ding en een lijst: links de kern, rechts de lijst of de rest.

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
- Op gsm en smalle tablets staan beide onder elkaar. Is de rechterkant het belangrijkste (de dingen of het
  logboek van een lijst), zet dan `split split-main-first`: onder 960px komt die eerst.
- Vanaf 960px: zijkolom van 320px, zonder lijn ernaast. Zet de `.split` direct in `.page`, na `PageHead`.

### Knoppen

Knoppen zijn rond met `--radius` (10px; klein 8px), 32px hoog (op een aanraakscherm 40px), tekst 14px medium.
Ingedrukt zakt een knop 1px; uitgeschakeld halve dekking; focus een grijze rand met een ring van 3px. Het raakvlak
is altijd minstens 44px: een onzichtbare `::after` steekt uit zonder dat de opmaak verschuift.

| Klasse | Wanneer |
| --- | --- |
| `btn btn-primary` | De ene hoofdactie per scherm of formulier (Opslaan, Nieuwe lijst): **geel met zwarte tekst** en een randje |
| `btn btn-outline` | Gewone acties naast de hoofdactie (Bewerken, Instellen, Notitie): wit met een rand, grijs bij aanwijzen |
| `btn btn-ghost` | Stille acties in een rij (archiveren, sluiten) |
| `btn` | Een zachte grijze knop (zelden; liever een van de andere) |
| `btn btn-danger` | Enkel als bevestiging in het venster "verwijderen?": rode tekst op een rode tint, nooit een rood vlak |
| `btn btn-danger-ghost` | De knop die naar dat venster leidt ("Verwijderen") |
| `btn-sm`, `btn-lg`, `btn-icon`, `btn-block` | Grootte en vorm (een iconknop is vierkant) |

- Icoon links van de tekst, 15–16px, in de kleur van de tekst. In een ghostknop is het icoon grijs.
- Knop die iets bewaart: `SubmitButton` (draait een spinner tijdens het bewaren). Onderaan een formulier staat die
  op tablet links met zijn eigen breedte, op gsm over de hele breedte.
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
| Overzicht en elders | **Kaart**: wit, afronding 20px, `--shadow-card`; een kaart op het overzicht komt 2px omhoog bij aanwijzen |
| In een formulier (`.page.form`) en bij Instellen | **Groep**: een grijs vlak (`--group`), afronding 24px, geen schaduw |
| In een `.split` (lijst, ding) | **Sectie**: geen vlak, een haarlijn tussen secties |

- `CardHead`: titel 15,5px, gewicht 600, eventueel gegevens eronder in grijs ("2 van 3 klaar", "Deze maand"),
  eventueel een actie rechts (knop met rand). Geen icoon, geen uitleg.
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
- Een rij is 60px hoog, met `row-media` (36px tegel zonder rand, in de toon van de lijst, of `round` voor
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

- De dingen van een lijst (`ThingsView`) zijn `.table-items`: de kolommen komen van de velden met `column` (de naam en
  hooguit twee velden; naast de zijkolom is er niet meer plaats). Getallen (bedrag, getal, score, jaar) zijn 110px
  breed en rechts uitgelijnd (`col-end`), tekst `minmax(0, 160px)`. Daarom staat `--cols` op de tabel zelf.
- Een andere tabel met vaste kolommen krijgt een eigen klasse met `--cols` in `styles.css`; de eerste kolom is
  altijd `minmax(0, 1fr)`.
- Hooguit 4 kolommen tussen 768 en 1100px; extra kolommen krijgen `xl` (verschijnen pas vanaf 1100px).
- Wat op gsm in de grijze regel staat, heeft `narrow-only`; wat enkel in de tabel onder de titel moet, `wide-only`.
- Lege cel: een streepje `—` in `.muted`.

### Tabs: `Tabs`

```tsx
<Tabs label="Lijsten" value={type.id} onChange={(t) => setParams({ lijst: t }, { replace: true })}
  tabs={types.map((t) => ({ value: t.id, label: t.plural }))} />
```

Een grijs spoor (rond 9px) met een **wit vlak** (rond 7px, `--shadow-surface`) dat naar de actieve tab glijdt; tabs zijn 28px hoog (36px op een aanraakscherm), 13px medium. Geen tellers: het aantal staat bij de lijst zelf. Voor
verschillende **weergaves binnen één scherm** (dingen en logboek van een lijst, de onderwerpen bij Instellen). Niet voor
navigatie naar een ander scherm. Zet de gekozen tab in het adres (`?lijst=`, `?tab=`), zodat je ernaar kan linken.

### Filters: `FilterSelect` en `FilterToggle`

```tsx
<div className="filters">
  <FilterSelect label="Druif" all="Alle" value={filters.grape} onChange={…} options={…} />
  <FilterToggle on={now} onChange={setNow}><Icon name="clock" size={14} /> Drinkklaar: nu</FilterToggle>
</div>
```

Een grijze pil zonder rand (32px): grijs label, donkere waarde. Een actieve filter wordt het **witte vlak**. Filters
staan onder het zoekveld.
In `ThingsView` komen ze vanzelf uit de velden met `filter` (een keuzelijst met de waarden die voorkomen; een periode
wordt een schakelaar "Label: nu"), plus Archief. Toon een filter pas als er iets te kiezen valt.

### Segmenten: `Segmented`

Keuze tussen 2–4 opties in een formulier (Niet zien · Zien · Wijzigen, Gelijk · Procent). Zoals tabs: een grijs spoor
met een wit vlak dat meeglijdt. Meer dan 4 opties: gebruik een `select`.

### Zoekpalet: `CommandPalette`

Eén veld voor zoeken én toevoegen. Opent met **⌘K / Ctrl K**, het zoekveld in de zijbalk, de loep in de kop of
Zoeken in het menublad (modus zoeken), of met de + (modus toevoegen; `usePalette()("add", tekst)` vanuit een scherm):
een wit venster (rond 14px, `--shadow-lg`) boven een licht verduisterd scherm. Zoekt zonder op hoofdletters of accenten te letten in acties, je
lijsten en tags, en (via `/insights/search`) de dingen en gebeurtenissen die je ziet, en biedt aan waar je kan loggen
of toevoegen (`GET /me/targets`, `matchTargets`): noemen de eerste woorden een soort of lijst ("gegeten pasta"), dan
staat **Toevoegen** ("Gegeten: pasta", de rest gaat als `?tekst=` naar het formulier) bovenaan, anders wat je zoekt. Met de + staan de
lijsten altijd eerst (je meestgebruikte bovenaan) en Nieuwe lijst als laatste. Pijltjes kiezen (een grijs vlak
glijdt mee), Enter opent, Escape sluit. Iets nieuws dat je moet kunnen vinden? Voeg het toe als groep in
`CommandPalette.tsx`.

### Zijbalk: lijsten per tag (`Sidebar.tsx`)

Bovenaan de plekken (`PLACES`: Overzicht, Agenda, Geld, Voorraad, Eten, Te doen, Verbanden), daaronder **Lijsten**: per tag een
rij met een pijltje (`TagTree`); open groeit ze van `0fr` naar `1fr` en staan haar lijsten eronder met een klein
tegeltje in hun toon (`.place-dot`) en een hulplijn links. Een lijst met meer tags staat onder elke tag; zonder tag
onder "Zonder tag". De tag van de lijst die je bekijkt, staat open; een tag tekent zijn lijsten pas als hij opengaat.
Onderaan "+ Lijst". Op gsm staat dezelfde boom in het menublad (`MenuSheet`); op gsm en tablet tot 1100px staan je
lijsten per tag ook onder het overzicht (`.home-projects`). Een sectiekop ("Lijsten") staat in kleine kapitalen.

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
- Velden: 32px hoog (40px op een aanraakscherm, tekst 16px zodat iOS niet inzoomt), wit met een rand (`--input`) en
  een zweem schaduw, afronding 10px; bij focus een grijze rand met een ring van 3px. Op een grijze groep blijven ze wit.
- Schakelaars onder elkaar krijgen vanzelf een haarlijn ertussen.
- Label boven het veld. Een veld is vanzelf optioneel (verplicht: `required`); geen "· optioneel" en geen uitleg
  eronder. Een voorbeeld hoort in de placeholder ("bv. Rood, Wit"). `.hint` onder een veld enkel voor wat de app
  las of uitrekende ("= 1 u 30 min") of een fout.
- `Switch` heeft enkel een label: zegt dat het niet genoeg, kies een beter label.
- Verplichte velden krijgen `required`, geen sterretje.
- **Een lijst heeft een notitieveld** (een lange tekst); de sjablonen zetten er een klaar. In de fiche komt een
  lange tekst als eigen kaart.
- Automatisch ingevulde velden krijgen klasse `auto` (zacht geel) tot de gebruiker ze aanpast.
- Toetsenbord in een formulier (`ItemForm`): ↓ en ↑ gaan naar het volgende en vorige veld vanuit een tekst- of
  getalveld, een schakelaar of een keuzeveld zonder open keuzes (in een datum, uur, keuzelijst of lange tekst doen ze
  wat ze daar al doen); Ctrl/⌘ + Enter bewaart.
- Fout in een veld: `aria-invalid`. Fout van de server: `<p className="error">` boven de knop.
- Kant-en-klare velden: `FieldInputs` (alle velden van een lijst), `TagPicker`, `Switch`, `ToneSwatches`,
  `IconPicker`, `FilePicker`, `TreeSelect` en `QuantityField`.

### Lijsten en velden: `Fields.tsx`

Wat je bijhoudt, is een **ding** in een **lijst**, of een **gebeurtenis** in haar logboek. De dingen van een lijst
hebben dezelfde velden (Wijnen met jaargang en druiven); een eigen soort (Tankbeurt) heeft eigen velden voor haar
gebeurtenissen. Beide gebruiken dezelfde veldsoorten. De veldsoorten
staan in `FIELD_TYPES` (`shared/fields.ts`), elk met een groep (`FIELD_GROUPS`) en één zin uitleg (de titel van de keuze); een nieuwe
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
| `AmountsPicker` (`ItemPicker.tsx`) | Hoeveelheden (de ingrediënten van een recept): per regel een `ItemPicker` (met vrije tekst, "zout"), hoeveel en de eenheid (`.amount-row-line`), onderaan een lege regel om toe te voegen. Op de fiche een `.amount-list`: de hoeveelheid grijs voor de naam. Overgenomen uit een recept rekent het mee met de porties (`per`). |
| `ItemPicker`, `ItemsPicker` (`ItemPicker.tsx`) | Een verwijzing kiezen: een gewoon veld waarin je typt, de keuzes liggen eronder op een wit vlak (`.picker-list`), met de lijst erbij als ze uit meer lijsten komen. Pijltjes, Enter, Escape. Met `free` blijft wat je typt als vrije tekst staan; × maakt het leeg. Nooit een gewone `select` voor items: die kan je niet doorzoeken. |
| `FieldsEditor` (`fieldsDraft` → `buildFields`) | De velden van een lijst, elk een wit kaartje in de groep: naam en soort veld (gegroepeerd) op één regel, onder ⋯ de uitleg bij die soort, keuzes, eenheid, verwijzing, codeformaat, wat een berekening uitrekent, uit productinfo, kolom, filter, verplicht, uitleg, en wat het veld zelf invult (Begint met vandaag, Begint met jou, Leeg = verdelen met de gewone verdeling, **Onthouden** (`select`: Niet · Je laatste waarde · Een vaste waarde) en **Per** (Voor alles · Naam · een keuzeveld van de lijst): een nieuw item begint met wat jij de vorige keer (bij die keuze) invulde, of met de vaste waarde, zacht blauw) |
| `FieldInputs` (`attributesDraft` → `buildAttributes`) | De velden invullen; korte velden per twee (`.attr-fields`). Een veld dat je niet mag wijzigen, staat er alleen-lezen. Een berekening staat er als `.calc-output` (stippellijn) en rekent mee terwijl je typt |
| `AttributeRows` | De ingevulde velden als regels in de `dl` van een fiche; verwijzingen linken naar het item, een webadres toont enkel het domein als link, e-mail en telefoon openen mail of telefoon, een adres een kaart (op een kiosk als tekst). Bij een berekening een `Tip` met wat ze uitrekent |
| `ChecklistInput`, `ChecklistView` | Takenlijst (`.checklist`): invullen met altijd een lege regel onderaan; op de fiche een eigen kaart waar je meteen afvinkt (bewaart zonder het formulier) |
| `PeoplePicker` | Personen aanvinken: `tag person-chip` (een tag met avatar) |
| `ItemsSelect` | Meerdere items uit een andere lijst: kleine tags met een kruisje (`.ref-chips`), een keuzelijst eronder |
| `CodeInput`, `CodeView` | Een barcode of QR-code: typen, formaat kiezen of scannen; groot tonen om te laten scannen (zwart op wit) |
| `ItemSelect` | Een verwijzing naar een item uit een andere lijst (de wijn → het wijnhuis), ook uit een andere lijst. Je kiest enkel uit dingen die je ziet |
| `SharesField` (`sharesDraft`) | **Eigenaar** of **Verdeling**: wie welk deel heeft (Niemand · Gelijk · Procent · Bedrag). In bedragen begint het gelijk verdeeld (tot op de cent) en zegt het in rood als het samen niet op het bedrag van het formulier uitkomt (dan naar verhouding). Leeg = van iedereen samen |
| `MoneyInput` | Een bedrag in euro; "45 USD", "$45" of "£12,50" rekent het veld bij het verlaten om met de dagkoers van de ECB (`/rates`, `shared/money.ts`), met eronder wat het was |
| `ScoreInput`, `ScoreStars` | Score op 5 met halve sterren (tik nog eens voor een halve) |
| Porties (`PortionChips` in `FieldInputs`) | Bij een getal **In porties van** een ander getal (Hoeveel per Portie): onder het veld `.portion-chips`, drie `tag`-knoppen "½ portie 7,5 g", "1 portie 15 g", "2 porties 30 g" (de grammen grijs), enkel als de portie gekend is |
| Vastzetten (`FieldPin` in `FieldInputs`) | Bij een veld met een vaste waarde (`remember_fixed`): een kleine punaise (`.field-pin`, icoon `pushpin`, 28px) rechts naast het label, naast het veld (nooit in het `label`). Stil grijs = de waarde van nu staat niet vast (tik: vastzetten voor de keuze, bv. "Vastzetten voor Pasta"); zwart (`aria-pressed`) = ze staat vast (tik: niet meer vast). Een toast zegt wat er gebeurde |
| Typ wat je weet (`EventForm`) | Het eerste veld van Loggen (placeholder "Typ wat je weet…", de cursor staat er meteen in). Wat je typt, vult **live** in met code (`readEvent` in `shared/parse.ts`): datum en uur, bedrag, dingen met hoeveelheid, eenheid en prijs, velden van de soort; wat overblijft is de omschrijving. Enkel wat de tekst zelf zette, verandert mee: pas je iets aan, dan blijft dat staan; wis je een woord, dan komt terug wat er stond. Begint de tekst met een soort ("gegeten"), dan die soort. Eronder **Kasticket ✨**. |
| Barcode en Foto (`ThingForm`) | Onder de naam van een nieuw ding: **Barcode** (lijsten met productinfo: `BarcodeScanner`, zoekt in Open Food Facts, zonder AI) en **Foto ✨** (een etiket of product; enkel met de AI aan). Eronder in grijs waar het vandaan komt ("Uit Open Food Facts: …", "Uit NEVO: …", "Geschat met AI"). Een gedeelde foto staat klaar als **Foto lezen ✨**: de AI leest pas na die tik; de foto komt bij het ding. |
| `ItemPhoto` | De foto van een ding of gebeurtenis bovenaan: toevoegen, vervangen, weghalen. Nog geen foto: enkel de knop **Foto toevoegen** (geen leeg vlak) |
| `IconPicker` (`IconPicker.tsx`) | Een icoon kiezen voor een lijst (`ICONS` in `shared/icons.ts`): grijze tegeltjes, het gekozen is zwart |
| `NotificationsCard` (`Notifications.tsx`) | Bij Jouw gegevens: "Meldingen" als `card` met `CardHead` en `card-body`. Een `Switch` "Meldingen op dit toestel" en daaronder "Testmelding sturen" (`btn-outline btn-sm`). Dan **Stil**: de stilgezette lijsten en tags als rijen met × (weer laten melden) en een `select` "Stilzetten…". Kan het niet, dan enkel een `Alert` die zegt waarom: op een iPhone eerst op het beginscherm zetten, of de meldingen staan uit in de browser |
| `RepeatForm`, `RepeatCard` (`Repeat.tsx`) | Herhalen: op de fiche een `btn-outline btn-sm` "Herhalen" (icoon `clock`, enkel met `can_repeat`) opent een `Sheet` met "Hoe vaak" (`.interval-input`) en "De eerste keer" (vandaag of later), en Stoppen als het al loopt. Loopt het, dan een kaart "Herhaalt zich" in de zijkolom ("Elke maand; de volgende keer op 30 nov 2026.") met Aanpassen |

- "Eigenaar" is van wie iets is; "Van wie" is enkel de herkomst van iets dat je kreeg.
- Herhaling (`.interval-input`): "elke [3] [maanden]". Duur typ je vrij ("1u30", "90", "1,5 uur"); onder het veld
  staat wat de app las ("= 1 u 30 min") als dat anders is dan wat je typte.
- Een datum kan **Begint met vandaag** hebben (`today`, schakelaar onder ⋯): een nieuw item krijgt de datum van
  vandaag in het formulier (wat je at, een uitgave). Je ziet ze staan en past ze aan; enkel een verplichte datum die
  leeg blijft (Start in een timerblok) krijgt van de API vandaag.
  Een verwijzing kan **Neemt waarden over** (`copy`, schakelaar): kies je een item, dan krijgen de lege velden hier
  de waarden van de velden met dezelfde sleutel daar (zacht geel, `auto`; en de naam als die leeg is). En **Past het
  gekozen item aan** (`adjust`, keuzelijst "Trekt af van Aantal" / "Telt bij Aantal", met "Met": 1 per item of een
  getal of berekening van deze lijst; enkel als de lijst waarnaar het wijst een getal heeft).
  Een ja/nee kan **Aan: ook een item in** (`spawn`, lijsten kiezen onder ⋯): een nieuw item met dat vinkje aan maakt
  ook een item in de eerste van die lijsten waarin je mag toevoegen (Gegeten bij een uitgave → je eigen Eten), met de
  naam, de velden met dezelfde sleutel, hetzelfde product (met wat het overneemt) en hoeveel, omgerekend naar de
  eenheid daar. De toast zegt "Yoghurt bewaard, ook bij Eten" met **Openen**; Ongedaan maken in een snel-toevoegen-blok
  haalt beide weg.
  Een datum, periode of berekende datum kan **In de agenda** (`agenda`, schakelaar): ze staat dan in de Agenda.
  Een datum (of een berekende datum, zoals Volgende keer) kan **Herinneren** (`remind`, keuzelijst onder ⋯: Niet,
  Op de dag zelf, 1, 2, 3 dagen, 1 of 2 weken, 1 maand vooraf), met **Elk jaar** (`yearly`) voor een verjaardag.
  Zo'n lijst is een **logboek**: de naam mag leeg (placeholder "Weging 30/10/2026"; de API geeft die naam) en de
  lijst toont het nieuwste eerst.
- Een nieuwe lijst begint met een **sjabloon** (`TEMPLATES` in `shared/catalog.ts`, `.template-picker`): velden,
  voorraad en eigen soorten. Niet gekozen is een sjabloon een zacht grijs vlak; gekozen wordt het het witte vlak
  met een zwart icoontegeltje. Daarna kan je alles aanpassen. Een nieuwe use case begint best als sjabloon, gebouwd
  uit de bouwstenen (velden, formule, totalen): **Voeding** is Eten (kcal en macro's per 100 g × Hoeveel als
  formule, of de kcal van een Gerecht met `of(…)`), Gerechten (de kcal uit hun Ingrediënten), Gewicht en Water, met
  totalen "enkel van jou"; **Gedeelde uitgaven** is Betaald door, een Verdeling en een totaal dat verrekent. Geen
  eigen code. Een veld in een sjabloon kan een eenvoudigere berekening meekrijgen (`alt`) voor als een lijst los
  wordt toegevoegd (Eten zonder Gerechten: de kcal enkel uit kcal per 100 g). Losse
  lijsten (Onderhoud, Abonnementen, Recepten, Reizen, Contacten, Taken) staan in `LIST_TEMPLATES`; je voegt ze toe
  bij **Instellen → Lijsten → Uit sjabloon**.
- **Opnieuw**: op de fiche een `btn-outline btn-sm` "Opnieuw" (icoon `repeat`, enkel met `can_create`): een nieuw
  item met de waarden van dit (`?van=`, `repeatData`). In een nieuw formulier stelt de naam eerdere items voor
  (`datalist`); kies je er een, dan vult de app de rest in zoals de vorige keer. Een datum die met vandaag begint,
  wordt vandaag; een persoon die met jou begint, wordt jij. Alles zacht geel (`auto`). **Vaak** staat in het lege
  invulveld: tik je in "Typ wat je weet" voor je iets typt, dan tonen de keuzes wat je minstens twee keer toevoegde,
  het vaakst eerst, hooguit zes (rechts "Vaak"); één tik vult in zoals de vorige keer. Namen die de app zelf gaf
  ("Weging 30/10/2026") tellen niet mee.
- **Ook op de foto**: herkent de AI meerdere dingen op één foto van eten (een bord met rijst, kip en broccoli), dan
  komt het grootste in het formulier en de rest onder de knoppen als `.receipt-lines` (aanvinken, naam, "180 g · 234
  kcal"). Bij Opslaan wordt elk aangevinkt ding een eigen item met zijn eigen schatting en de rest van het formulier
  (datum, maaltijd, wie).
- **Productinfo** (`shared/product.ts`): een tekst- of getalveld kan "Uit productinfo" krijgen (naam, merk, inhoud,
  energie of een voedingswaarde per 100 g). Een barcode (gescand, op een foto of in een barcodeveld) of een product
  dat de AI herkent, zoekt de app op in Open Food Facts (gratis, `/products`, 30 dagen bijgehouden in `products`).
  Op barcode is het exact; op naam en merk enkel als bijna alle woorden kloppen (liever een eerlijke schatting dan
  een verkeerd product). Toon altijd welk product gevonden werd.
- Snel veel invullen: "Opslaan en volgende" (`.form-actions`, een `btn-outline` naast de hoofdknop). Een tabel
  importeren (`ImportPage`, `.column-map`: kolom → veld, onthouden per lijst; wat we niet herkennen gaat bij de
  lange tekst) is een eigen scherm. Exporteren is een iconknop `download` in de toolbar: een gewone `<a download>`
  naar een CSV-bestand (CSV met ; en een komma in getallen, voor Excel; `shared/csv.ts`), met enkel wat jij mag zien.
- **Offline**: zonder internet staat bovenaan `.offline-note` (op gsm onder de terugknop). Een nieuw item bewaren
  lukt toch: het wacht op het toestel (`src/outbox.ts`, IndexedDB) en de melding zegt hoeveel er wacht; met internet
  gaat het vanzelf mee (toast "2 items van offline verstuurd"). Wijzigen en verwijderen vragen internet.

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

- `CalcEditor` staat onder ⋯ van het veld: eerst de soort (de uitleg is de titel van de keuze), dan per soort de velden. Elke
  keuzelijst toont enkel velden die passen.
- Een formule typ je zoals je ze leest (`.formula-input`): velden tussen [ ] met hun **naam**, × en ÷ mogen. Onder
  het vak staan de velden als kleine tags (`.formula-fields`): een tik voegt `[Naam]` in waar de cursor staat. Bewaard
  wordt ze met de sleutels (hernoemen breekt niets). Nooit `eval`: een eigen ontleder, met fouten in gewone woorden
  ("de formule stopt te vroeg", "gebruik ; tussen de delen"). Wat nog niet klopt, staat er meteen onder in rood (`previewCalcs`);
  de API kijkt hetzelfde na (`checkCalcs`) en weigert een kring.
- De uitkomst toont zoals een veld van die soort (bedrag, datum, ja/nee, getal met eenheid); een opgezocht webadres
  is een link. Ze kan een kolom of filter zijn.
- Een berekening rekent enkel binnen het ding (zijn eigen velden); wat over gebeurtenissen gaat (prijs per eenheid,
  laatst gekocht), toont de tijdlijn van het ding.
- Rechten: een berekening telt enkel wat jij mag zien. Mag je een veld waarvan ze afhangt niet zien, dan blijft
  ze leeg (ook een som over gelinkte items als je bij één ervan het veld niet ziet).
- Opzoeken en samenvatten rekent de API uit (`worker/compute.ts`); in het formulier staan die er niet, op de fiche wel.

### Filters en weergaven: `ViewEditor`, `ConditionPills`, `ViewChips`

Een lijst filter, sorteer en toon je zoals je wil (`shared/views.ts`); dat bewaar je als **weergave**, voor jezelf of
(wie de lijst instelt) voor iedereen. Generiek: elke veldsoort heeft zijn vergelijkingen (tekst: bevat, is, begint
met; getal en bedrag: is, kleiner dan, minstens, tussen; datum: valt in een periode, in week … van de maand, op een
maandag; keuze, persoon, verwijzing: is een van, met **jij** als keuze; ja/nee; leeg of ingevuld). Periodes zijn
relatief (vandaag, deze week, vorige maand, de laatste 7 dagen, …) of tussen twee datums. Ook op de naam, de tags en
"Toegevoegd op".

| Waar | Hoe |
| --- | --- |
| Boven de lijst | Bewaarde weergaven als pillen (`ViewChips`: Alles, dan elke weergave; een persoonlijke met icoon `user`). Daaronder in `.filters` eerst de pil "Filters · 2" (icoon `sliders`, `active` als er iets geldt), dan elke voorwaarde als pil met een kruisje (`ConditionPills`, `.condition-pill`: "Datum valt in deze week ×"), dan de snelle filters van de velden en Archief |
| Onderblad "Filters" (of de naam van de weergave) | `ViewEditor`: Toon wat (`Segmented`: aan alles / aan één ervan), per voorwaarde een wit kaartje (`.condition`: veld, vergelijking, waarde; keuzes als `tag-picker` met vinkje), "+ Voorwaarde" (`btn-outline btn-sm`), Sorteren op (veld + richting), Kolommen (`tag-picker`, leeg = zoals de lijst), Als agenda (`Switch`), Toepassen (`btn-primary btn-lg`), en onder een lijn Bewaren als weergave (naam, Voor iedereen in deze lijst, Bijwerken / Als nieuwe bewaren / Verwijderen) |
| Kolomkoppen (tablet) | Een kop sorteert (`.table-sort`): oplopend, aflopend, weer zoals de lijst; een pijltje `up`/`down` toont welke |

- Wat je koos, blijft staan zolang de app openstaat (per lijst, `sessionStorage`). Exporteren volgt het filter.
- Een voorwaarde op een veld dat iemand niet mag zien, telt voor hem niet mee; een weergave is geen beveiliging.

### Agenda: `CalendarMonth`

Een maandkalender (`Calendar.tsx`): bovenaan de maand ("November 2026") met Vandaag (`btn-ghost btn-sm`) en vorige en
volgende (`btn-outline btn-icon btn-sm`), dan zeven kolommen (ma–zo). Een dag is een zacht vlak (`--muted`, afronding
`--radius-lg`), de dagen van een andere maand enkel een lijntje, vandaag een zwart rondje, de gekozen dag wit en een
beetje omhoog. Per dag hooguit drie pilletjes (`.calendar-entry`, in de toon van de lijst) en "+2"; op een gsm enkel
stipjes. Onder de kalender wat op de gekozen dag valt, als gewone `rows`, met eventueel "+ Maaltijd toevoegen" (begint
op die dag: `?veld=datum&op=2026-11-03`). Een periode (een reis) staat op elke dag ervan.

- **Agenda** (`/agenda`, in de zijbalk en de onderbalk): elk veld met **In de agenda** (`agenda` op een datum, een
  periode of een berekende datum) uit al je lijsten, met jouw rechten per lijst.
- Een lijst als agenda: de weergave **Als agenda** (volgens een datumveld naar keuze).

### Uitleg: `Tip`

`<Tip text="…" label="Hoe Totaal berekend wordt" />` is een kleine (i) naast een label: de uitleg verschijnt in
een zwart ballonnetje bij aanwijzen, focus of tikken (gsm), en sluit met Escape, ergens anders tikken of scrollen.

- Enkel bij een berekening: wat ze uitrekent, en bij een keuze in de `CalcEditor` die je moet begrijpen ("Welke
  items" bij samenvatten). Nergens anders: zie principe 11.
- Op een `label` werkt de (i) zonder het veld te focussen.

### Sjabloon delen (`shared/template-file.ts`)

Instellen → Algemeen → **Als sjabloon** (`btn-ghost`, icoon download) bewaart de opbouw van de lijst als bestand:
naam, hoe één ding heet, icoon, velden, voorraad en eigen soorten, zonder dingen, logboek of mensen. Bij een nieuwe
lijst is **Uit bestand** de laatste tegel van de sjablonen; het gekozen bestand staat daarna als eerste tegel.

### Volgorde: `useSortable` (`Sortable.tsx`)

Alles wat de gebruiker zelf ordent (lijsten, velden, soorten), sleep je aan een **greep** (`grip`, links in de rij).
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
- Wat de volgorde betekent: de volgorde van je lijsten is **jouw** volgorde (per persoon, `list_order`); velden en
  soorten zijn die van de lijst (enkel voor een beheerder).
- Volgorde is een instelling, geen knop op een overzicht: je lijsten bij **Jouw gegevens** (je letter rechtsboven),
  velden en soorten bij **Instellen** van de lijst.

### Kosten verdelen: `BalanceCard`

Kosten verdelen is geen lijst: elke aankoop of dienst heeft Bedrag, Betaald door (begint met jou) en Gedeeld met
(`SharesField`), en een lijn kan enkel van één persoon zijn. Wie moet wie rekent de app uit over alles wat je ziet
(`shared/ledger.ts`); een terugbetaling is een overdracht.

- Een bedrag verdeelt tot op de cent (`splitCents`): de cent die overschiet, draagt wie betaalde.
- `BalanceCard` ("Wie moet wie") staat op Geld en als blok op het overzicht. Per overschrijving één
  rij: avatar, "Jana moet jou nog", rechts het bedrag, en een `link-button` "Terugbetaald" (een `Sheet` met bedrag
  en datum; minder mag). Moet jij betalen en heeft de ander een rekeningnummer (bij **Jouw gegevens** (je letter rechtsboven)), dan staat daar een
  betaal-QR (`.pay-qr`, EPC, `shared/payment.ts`) om te scannen met je bank-app. Niets open: "Alles is verrekend."
- Op gsm komt de kaart vóór de lijst: geef ze `split-lead` (de zijkolom valt open onder 960px).
- "Jij/jou" in plaats van je eigen naam ("Jij moet Jaan nog", "Jana moet jou nog").
- Telt enkel wat je helemaal ziet (een gebeurtenis in een lijst waar je bij bent); wat je niet ziet, telt niet mee.
- Een nieuwe use case (voorraad, ...) bouw je eerst uit velden, berekeningen en totalen, als sjabloon. Pas als dat
  echt niet gaat, een eigen onderdeel bovenop de kern.

### Voorraad: `StockStepper` (`ThingsView.tsx`)

Een lijst die voorraad telt, toont rechts in elke rij hoeveel er is (`.row-stepper`: − het aantal +, de eenheid erbij,
rood als het bijna op is: `.row-stepper-value.is-low`). − en + loggen na een korte pauze één telling (een meting
"Telling"), nooit een gebeurtenis per tik. Wat er is, rekent de app uit (`shared/stock.ts`); in een tabel is dat de
laatste kolom (Voorraad), naast die kolom staat er één veld minder. Geplande aankopen (boodschappen) staan in het
logboek met een vinkje (`.row-check`, 44px); afgevinkt is doorstreept en stil (`.log-row.is-done`).

### Kasticket (`EventForm.tsx`)

Onder "Typ wat je weet" staat **Kasticket ✨** (`btn-outline btn-sm`, icoon receipt, `AiMark`), enkel als de AI voor
jou aan staat en de soort een bedrag heeft of de lijst voorraad telt. De foto wordt één aankoop: de winkel als lijn
**bij**, elk product als lijn **erbij** met hoeveel, eenheid en prijs, gekoppeld aan een ding dat je ziet; wat
nieuw is, krijgt **Nieuw in** (de lijst met voorraad). Het totaal komt in Bedrag, de datum in Wanneer, de foto bij de
gebeurtenis. De melding zegt "met AI". Een gedeelde foto staat klaar als **Kasticket lezen ✨** (`btn-primary`): de AI
leest pas na die tik.

### Dingen tonen: `ThingsView` en het logboek: `LogList`

**Dingen** (`ThingsView`): bovenaan zoeken, ⋯ (weergaven en CSV), de bewaarde weergaven als filterpillen ("Alles",
"Van mij"), Filters en per veld met `filter` een `FilterSelect`. Op gsm rijen (`ThingRowView`: icoon of foto, naam, de
kolommen als grijze meta), op tablet een tabel (`card table`, `--cols`; kolommen = velden met `column`, of die van de
weergave; de cellen van de rij-link staan in de kolommen). Met een datumveld kan een weergave een agenda zijn.

**Logboek** (`LogList`, `EventRow` in `Log.tsx`): per dag (Vandaag, Gisteren, "4 nov 2026") rijen met het icoon van
de basissoort in zijn toon (`BASE_TONES`), de titel ("Gegeten: Yoghurt", of de omschrijving), als meta het uur, de
lijst (enkel als het elders gelogd werd), waar en wie, en rechts het bedrag, een hoeveelheid (+2, −300 g) of de
waarde van een meting (82,4 kg). Een lijn van elders zonder de rest ("gedeeltelijk") toont enkel wat jouw dingen
raakt, zonder bedrag. Gepland: met een vinkje vooraan.

### Lijnen: `LinesEditor` (`Lines.tsx`)

Elke lijn is een wit kaartje in de groep (`.line-row`): bovenaan wat er gebeurt (Erbij, Eraf, Voor, Bij: een keuzelijst,
`.line-role`) en met wat (`Combo`: typ of kies een ding, of laat tekst staan) met × om weg te halen; eronder Hoeveel,
de eenheid, de prijs (bij geld), houdbaar tot (bij erbij) en Gedeeld of Van <persoon>. Tekst zonder ding in een lijn
erbij of eraf krijgt **Nieuw in** (een lijst waarin je mag toevoegen, of Enkel tekst). Onderaan "+ Lijn". Op gsm komt
het ding onder de rol.

### Rechten in de app

De API beslist wat iemand mag en weigert de rest; de app **verbergt** wat niet mag. Wat ze krijgt: de rol per lijst
(`useSession().lists[].role`, `ListDetail.role`): **beheerder** (Instellen, mensen, soorten), **lid** (dingen
toevoegen en loggen), **gast** (kijken). Toevoegen en loggen enkel met `canEdit`, Instellen enkel met `canManage`.

- **Mensen** (Instellen → Mensen): per persoon een rij met de rol als compacte keuzelijst (`member-actions` +
  `scope-select`) en ×; via een tag staat de keuze "Via Huis (beheerder)" bovenaan, en **Geen toegang** is een
  uitzondering op die regel.
- **Altijd erbij** (bij een tag, `RulesForm`): personen met een rol; enkel op lijsten waar jij rechtstreeks beheerder
  bent. Wie een tag kiest, ziet wie er zo bij komt.
- Afbeeldingen en bestanden uit de API altijd via `apiUrl("/…")`.

### Kleine bouwstenen

| Klasse of component | Gebruik |
| --- | --- |
| `.link-quiet` | Link in een `dl` of tekst: geen kleur, een zacht lijntje eronder |
| `.link-button` | Stille tekstknop met een onderlijn naast een label ("Per veld", "Wissen") |
| `.tips-block` | Een lange tekst op de fiche, met de regels zoals getypt |
| `.timeline` + `.timeline-date` | Logboek: datum links, notitie rechts |
| `.member-actions` | Rol (een `select`), bewerken en weghalen naast iemand in een lijst |
| `.dashboard` + `.dash-card` + `.dash-head` | Het overzicht: zachte witte kaarten zo breed als past, die 2px omhoog komen bij aanwijzen; een blok dat als geheel opent is een `dash-link` |
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
| `dot tone-x` | De kleur van een lijst of tag in een rij |
| `Avatar` | Personen: pastel rondje met een dunne gekleurde letter; `size="sm"` in tekst, gewoon in lijsten, `lg` in kaarten |

Badges zijn kort: 1–3 woorden.

### Meldingen

| Situatie | Component |
| --- | --- |
| Iets is bewaard, verwijderd, verplaatst | `useToast()("Wijn bewaard")`: een witte melding (rond 10px) met een zwart rondje (rood bij `"alert"`), rechtsonder (tablet) of boven de onderbalk; meer meldingen stapelen met 8px ertussen |
| Iets gebeurt of lukte half binnen een formulier | `<Alert tone="busy" \| "ok" \| "partial" \| "none">`: een zacht vlak zonder rand, gelukt met een vinkje. Kwam het van de AI, dan `ai` (✨ in plaats van het vinkje) en zegt de tekst het: "Gelezen met AI. …" |
| Iets kan niet ongedaan gemaakt worden | `useConfirm()({ title, body, confirmLabel, danger: true })` |
| Een korte invoer (notitie in het logboek, iemand toevoegen, een tag) | `<Sheet>`: een wit blad dat 6px van de randen onderaan hangt (gsm, rond 20px, met een greep om dicht te vegen), een wit venster in het midden (tablet) |
| Lijst is leeg | `<EmptyState icon title action>`: een zacht vlak met een wit icoontegeltje, de titel en hooguit één knop (`btn-outline btn-sm`), zonder uitleg |
| Lijst laadt | `<SkeletonRows rows={5} />` (verschijnt pas na 0,18 s) |

Toasts zijn de bevestiging na een actie. Elke bewaar- of verwijderactie geeft er één, behalve −/+ in een lijst en
het verslepen van een rij: daar is wat beweegt de bevestiging (een toast per tik zou storen).
Tekst: wat er gebeurde, in de verleden tijd of als korte vaststelling ("12 wijnen toegevoegd", "Rol bijgewerkt").

### Iconen

Twee soorten, inline in `Icon.tsx`:

- **Gevuld voor dingen** (bon, kaart, doos, portefeuille, speld, tandwiel, vlam, wagen, maan, sleutel, …): Phosphor "fill" (phosphoricons.com).
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

### Wat nu loopt (activiteiten)

Een activiteit met een uur en zonder einde loopt nog (werk, vasten): ze staat in het blok **Loopt nu** met de tijd die
live meetelt (`font-variant-numeric: tabular-nums`) en **Stop** (`POST /events/:id/stop`). Een soort met een doel
(16 u vasten) geeft een melding als dat doel bereikt is.

### Verbanden: `LinkMapView`, `LinkList`, `LinkDetail`, `LinkProblems` (`LinkMap.tsx`) en `LinksPage`

Hoe al je lijsten met elkaar en met de weergaven samenhangen, uit `shared/links.ts` (`GET /insights/links`): enkel
wat jij ziet. Drie soorten, elk met een eigen kleur **en** patroon, zodat kleur nooit alleen draagt: **Logboek**
(doorlopend, de eerste grafiekkleur: gebeurtenissen in de ene lijst met dingen of soorten van de andere),
**Verwijzingen** (streepjes, de tweede: een veld dat naar een andere lijst wijst) en **Weergaven** (puntjes, de derde:
Geld, Wie moet wie, Voorraad, Eten, Te doen, Agenda, Loopt nu, Herinneringen, Meldingen, Herhalen, Productinfo,
Kasticket lezen, Overzicht).

- **Kaart en Lijst** zijn twee tabs (`?weergave=`), enkel op tablet (`useWide`); het begint op Kaart. Op gsm is er
  enkel de lijst: de kaart is daar te klein om te lezen of aan te tikken. Daaronder per soort een filter die je aan- en
  uitzet (met een stukje lijn), en **Werkt niet voor iedereen**.
- **De kaart** is een metrokaart (`layoutLinks`): per tag een zachte grijze kolom (een lijst staat bij haar eerste
  tag), de lijsten als stations, de verbanden tussen lijsten als sporen. Elke lijst waar iets in toekomt, krijgt een
  eigen rij (wie het meest binnenkrijgt bovenaan, een groter station); een spoor loopt eerst verticaal bij de lijst
  waar het vertrekt en dan horizontaal naar zijn doel, op een eigen baan per soort. Twee stations in een kolom
  krijgen elk een eigen plaats als hun verticale sporen elkaar zouden raken. Onder de naam en het aantal dingen
  staan de weergaven als kleine grijze iconen (met de filter Weergaven). Elke lijst staat op de kaart: een lijst die
  enkel in weergaven voorkomt, is een grijs station zonder spoor op de eerste vrije rij van haar kolom, een lijst
  zonder verbanden een gestippeld station. Een verband dat voor iemand niet werkt, is rood gestreept. Past de kaart niet, dan verkleint ze tot 72%, en nog breder schuift ze binnen haar eigen vlak. Tik
  of Enter op een station kiest het (`?lijst=`): het krijgt een zachte gele halo, de rest vervaagt, en eronder komt
  zijn kaart.
- **De lijst**: per tag al je lijsten met hoeveel verbanden (of "Geen verbanden"), dan de weergaven. Een tik toont de kaart van die lijst of
  weergave, met **Alles** om terug te gaan.
- **Het schema** (`LinkSchema`, enkel op gsm, bovenaan de kaart van een gekozen lijst): erboven de lijsten waar iets
  vandaan komt, in het midden de lijst zelf (met een zachte gele halo, haar naam, hoeveel dingen en haar weergaven),
  eronder waar het naartoe gaat; dezelfde sporen en kleuren als op de kaart. Elk station is een raakvlak van 56px hoog
  en zo breed als zijn plaats; een tik kiest die lijst. Meer dan vier aan een kant: de drie met het meeste en "+n".
- **De kaart van een lijst of weergave** (`LinkDetail`): `CardHead` (de naam, hoeveel dingen, Openen), dan **Komt
  van**, **Gaat naar** en **Weergaven** met één rij per ander eind (zijn icoon, de naam, een stukje lijn per soort, wat
  het doet in grijs, rechts hoeveel keer; een tik kiest het), **In de lijst zelf** (wat ze met haar eigen dingen doet)
  en **Wie** (met rol, en via welke tag).
- **Werkt niet voor iedereen** (enkel als je een van beide lijsten beheert): wie in een lijst kan bewerken maar een
  lijst niet ziet waar die van afhangt; de rij opent Mensen van de lijst die je beheert.
- Een nieuwe eigenschap van een veld, lijst, soort, gebeurtenis, lijn of blok? Dan weigert TypeScript te bouwen tot
  je in `shared/links.ts` beslist of ze iets verbindt (`FIELD_LINKS` …); wat verbindt, krijgt een voorbeeld in
  `test/links.test.ts`. Zo blijft alles zichtbaar.

### Grafieken

`ChartBlock`, `ChartBuilder`, `TextBlock` (`ChartBlock.tsx`) en `ChartView`, `ChartTable` (`Chart.tsx`), uit
`shared/charts.ts`. Een grafiek is een blok op een overzicht; niets staat vast (er is geen grafiek tot je er een
maakt).

- **Kaart**: `dash-card` met `CardHead`: de titel (eigen titel, of de lijst · wat ze telt: "Uitgaven · Bedrag"), de
  periode als gegeven eronder ("Laatste 12 weken", "1/10 – 31/10") en rechts een stille knop met het icoon `table`
  (Als tabel / Als grafiek). Tijdens het herladen blijft de vorige grafiek staan, zachter (`.is-stale`): geen flits.
- **Staafjes**: hoogstens 24px breed, 4px rond aan de top en recht aan de basis; gestapeld met 2px wit ertussen.
  **Lijn**: 2px, een punt van 8px met een witte rand aan het eind, één reeks met een zachte vlakte eronder. Haarfijne
  rasterlijnen (`--chart-grid`), de nullijn iets sterker; een **doel** is de enige stippellijn ("Doel € 1.200,00").
  Eén waarde staat erbij (de periode van nu), niet bij elke staaf. Vanaf twee reeksen een legende (`.chart-legend`:
  een vierkantje bij staafjes, een streepje bij lijnen).
- **Per keuze** (`.chart-ranked`): per keuze een rij (naam, een zwart staafje van 12px, de waarde rechts), de
  grootste eerst, hoogstens 12 en de rest als Overige. **Verdeling** (`.chart-parts`): één balk van 28px in stukken
  (hoogstens zes), 2px wit ertussen, het aandeel erin enkel als het past (anders in de tooltip en de tabel), de namen
  in de legende. **Getal** (`.chart-number`): de uitkomst groot (32px, 600), "+12% tegenover de periode ervoor" in
  grijs, een doelbalk (`.chart-meter`, rood boven de grens) en een kleine grijze lijn per periode.
- **Kleur volgt de keuze**, niet haar plaats: een persoon, keuze of tag houdt zijn kleur (de volgorde van de keuzes,
  de leden, de namen), wat ook de rangorde is.
- **Tooltip** (`.chart-tip`, wit vlak): per periode één tooltip met alle reeksen, de waarde vooraan en vet; het raakvlak
  is de hele periode (groter dan het staafje). Met het toetsenbord: focus op de grafiek en ← →. Alles staat ook in
  de tabel (`.chart-table`): de tooltip is nooit de enige weg naar een getal.
- **Samenstellen** (`ChartBuilder` in een `Sheet`): Als (Staafjes · Lijn · Getal · Per keuze · Verdeling), Wat en
  Van, Per (bij Per keuze en Verdeling), Volgens, Per / Periode en Laatste (leeg = Alles), Apart per, Weergave, Doel,
  Van wie, Titel (de naam vanzelf als placeholder), en
  eronder een voorbeeld (`.chart-preview`) dat meekijkt.
- **Overzicht als verslag**: staat er een grafiek op, dan een rij `filters` met `FilterSelect` **Periode** ("Zoals
  ingesteld" of Deze week, Deze maand, Vorige maand, …) voor alle grafieken; een korte periode neemt een kleinere
  stap (een maand per week). ⋯ → **Afdrukken of als pdf**: bij afdrukken de naam en de periode bovenaan
  (`.print-title`), de blokken in twee kolommen met een haarlijn, zonder zijbalk, knoppen of tooltips.
- **Tekst** (`TextBlock`): een titel en alinea's (`.text-card-p`), bv. bovenaan een verslag.

## 5. Beweging

Curves (in `:root`): `--ease-out` voor bijna alles, ook een vlak dat glijdt en een blad dat opent · `--ease-close`
voor wat weggaat (een blad dat sluit, een melding) · `--spring` enkel voor een klein wipje van een icoon, nooit voor iets
dat aan een rand hangt · `--ease-in-out` voor heen-en-weer (scanlijn). Duren: `--dur` 150ms (kleur, hover),
`--dur-page` 260ms, `--dur-glide` 320ms, `--dur-sheet-open` 300ms en `--dur-sheet-close` 200ms. Een beweging speelt één
keer, bij het openen of kiezen; nooit bij het scrollen (behalve de titel die in de kop verschijnt).

### Schermwissels (View Transitions)

Elke navigatie loopt via een **View Transition**. Daarvoor gebruikt de app een data-router (`createBrowserRouter`
in `main.tsx`, routes in `routes.tsx`) en eigen `Link`, `NavLink` en `useNavigate` in `src/router.tsx` die
`viewTransition` standaard aanzetten.

- **Importeer `Link`, `NavLink` en `useNavigate` altijd uit `src/router.tsx`**, nooit uit `react-router`.
  (`useParams`, `useSearchParams`, `useLocation` mogen wel rechtstreeks.)
- Op tablet vloeit **enkel het paneel** over (`view-transition-name: panel`); de zijbalk blijft live, zodat het
  witte vlak naar het nieuwe item glijdt. Op gsm vloeit het scherm over en blijft de onderbalk staan.
- De inhoud van het nieuwe scherm schuift daarbij 5px omhoog (automatisch via `.page`; in een `.split` komen
  zijkolom en kaarten na elkaar).
- Filters in het adres (`setSearchParams`) wisselen **zonder** overgang: dat is geen nieuw scherm.
- Grote code laad je pas als ze nodig is, met `lazy`: de barcodecode (±1 MB, `Barcode` in `Fields.tsx`) en pdf.js
  (`PdfPages` in `FileViewer`). Een groot scherm kan een `lazy` route in `routes.tsx` zijn: de router wacht tot het
  geladen is, zodat de overgang vloeiend blijft, en toont zolang een zwart laadstreepje.

### Micro-animaties

| Moment | Animatie | Duur |
| --- | --- | --- |
| Nieuw scherm | paneel vloeit over, inhoud schuift 5px omhoog | 0,26 s |
| Lijst verschijnt | rij na rij (`stagger` + `stagger(i)`), 28 ms tussen rijen, max 14 | 0,3 s |
| Tab, segment, menu, onderbalk wisselt | het witte vlak glijdt naar de nieuwe keuze (`--ease-out`, zonder nawiebelen) | 0,32 s |
| Zoekresultaat wisselt | grijs vlak glijdt mee | 0,3 s |
| Titel in de kop (gsm) bij scrollen | verschijnt klein in het midden van de kop | 0,15 / 0,32 s |
| Boom klapt open | rij groeit (`grid-template-rows`), kinderen schuiven één voor één in, pijltje draait | 0,4 s |
| Getal verandert | rolt in de richting van de verandering (`Num`) | 0,38 s |
| Totaal verschijnt | telt op (`useCountUp`) | 0,9 s |
| Balk of meter | groeit vanaf links / van onder (`.total-bar`, `.total-history`, `LevelMeter`) | 0,5–1 s |
| Onderblad, venster, zoekpalet | glijdt in (`@starting-style`, `--ease-out`) en uit (`--ease-close`); een onderblad veeg je aan de greep dicht (verder dan 120px of snel: dicht, anders terug) | 0,3 / 0,2 s |
| Melding | komt op uit een waas en gaat erin weg (met een knop zoals Ongedaan maken: `.toast-action`, 7 s in beeld) | 0,4 / 0,2 s |
| Vinkje | tekent zichzelf (`draw`) | 0,4 s |
| Rij verslepen | de rij volgt de vinger, de andere schuiven opzij (`useSortable`) | 0,25 s |
| Indrukken | knop en filter zakken 1px, een icoon in menu of onderbalk krimpt even | 0,15 s |
| Ingevuld door de app | veld (`auto`) of chip (`.tag.is-filled`) krijgt een gele ring die vervaagt (`auto-flash`, enkel `box-shadow`) | 0,9 s |
| Hover | vlak wordt iets donkerder, de ring van een kaart iets sterker, pijltje schuift 3px | 0,15 s |

Regels:

- **`backwards`, nooit `both` of `forwards`.** Een animatie die na afloop een transform laat staan, maakt van het
  element het referentiekader voor vaste elementen (de kop, de onderbalk) en breekt die.
- Animeer `transform` en `opacity`. Uitzonderingen: de tablijn/het tabvlak (breedte) en de boom (`grid-template-rows`).
- Eerste keer tonen = rustig. Enkel **veranderingen** krijgen een opvallende animatie (`Num` beweegt pas bij een wijziging).
- Een venster opent met `@starting-style` en sluit met `transition-behavior: allow-discrete` (zie `dialog.sheet`,
  `dialog.palette`): nooit een venster dat zonder animatie verschijnt of verdwijnt.
- "Minder beweging" in het toestel zet alles uit, ook de schermwissels (staat onderaan `styles.css`). Test dat je
  scherm zonder animatie even duidelijk is.

---

## 6. Patronen per scherm

**Overzicht** (`/`, `BoardView` in `Board.tsx`): `PageHead` met de naam van het overzicht, `primary` **Toevoegen**
(op gsm de + in de onderbalk), in `actions` enkel ⋯ → een `Sheet` met Aanpassen, Nieuw overzicht, Hernoemen, Verwijderen. Meer
overzichten: `Tabs` onder de titel (dit toestel onthoudt welk, `?bord=`). Vanzelf: Uitgaven deze maand, Te doen, Bijna
op en Wie moet wie (geen blok per lijst: die staan in de zijbalk, en op gsm per tag onder het overzicht). Elk blok is
een `dash-card`; een blok dat als geheel opent, is een `dash-link`; het aantal staat rechts in de kop
(`.dash-count`, enkel als het niet 0 is). De blokken staan als metselwerk (`useMasonry`). **Aanpassen**
(`BlocksEditor`): een `sort-list` met greep en ×, Breed als filterpil, Toevoegen in een `Sheet`, onderaan Klaar.

**Toevoegen** (het [zoekpalet](#zoekpalet-commandpalette)): typ wat er gebeurde ("gegeten pasta 300 g"); noemen de
eerste woorden een soort of lijst, dan staat die bovenaan, staat er een ding in je tekst, dan loggen in zijn lijst
eerst; de rest van je tekst gaat mee naar het formulier (`?tekst=`). Nieuwe lijst als laatste.

**Lijst** (`/lijsten/:id`): `PageHead` met ⋯ (Instellen, Importeren, QR-sticker, Op je beginscherm) en `primary`
"<Wijn> toevoegen" of Loggen → `Tabs` <dingen> · Logboek · Gepland (enkel met iets gepland) → `split
split-main-first`: de dingen of het logboek, in de zijkolom Wie (enkel met meer dan jij) en Tags → `PhoneAdd`.

**Ding** (`/dingen/:id`): `PageHead` met Loggen en Bewerken → `split`: in de zijkolom de foto, de voorraad en de
velden (`dl`), rechts de **Tijdlijn** (alles wat ermee gebeurde: wanneer, waar, erbij of eraf, prijs per eenheid;
gaat een gebeurtenis enkel over dit ding, dan haar bedrag), de delen, wat ernaar verwijst en bestanden → onderaan
Archiveren en Verwijderen.

**Gebeurtenis** (`/gebeurtenissen/:id`): de velden (soort, wanneer, bedrag, betaald door, gedeeld met, gelogd door,
lijst) in de zijkolom, rechts de **Lijnen** en wat ze afvinkte → Verwijderen.

**Loggen** (`/lijsten/:id/loggen`, `EventForm`): bovenaan **Typ wat je weet** (vult live in, zie `shared/parse.ts`)
met Kasticket ✨, dan Soort (filterpillen: de eigen soorten, dan de basissoorten; soorten van andere lijsten in
"Andere soort…"), Omschrijving, Wanneer en Uur (bij een activiteit Van en Tot), Gepland; bij geld Bedrag, Betaald
door en Gedeeld met (bij gebruik: Wie at of gebruikte); de [Lijnen](#lijnen-lineseditor-linestsx); de velden van de
soort; Herhalen en Foto. Een prijs in de tekst zonder gekozen soort maakt er een aankoop van.

**Een ding toevoegen** (`/lijsten/:id/nieuw`, `ThingForm`): Naam, met eronder **Barcode** (lijsten met productinfo)
en **Foto ✨**, en daaronder de bron ("Uit Open Food Facts: …", "Geschat met AI"); dan de velden, Deel van, Opslaan
en Opslaan en volgende.

**Geld** (`/geld`): links Wie moet wie (`BalanceCard`: per overdracht een rij met Terugbetaald, een betaal-QR met het
rekeningnummer), rechts de maand (`calendar-head`: de maand en ‹ ›), het totaal groot (`total-value`) met jouw deel,
`Segmented` Per soort · Per lijst · Per winkel, en de gebeurtenissen van die maand.

**Voorraad, Eten, Te doen, Agenda**: Voorraad toont elk ding uit een lijst met voorraad (Bijna op · Lijst als
filters); Eten per dag de gebeurtenissen met kcal en per persoon de som; Te doen al wat gepland staat, met een vinkje;
de Agenda een maand met gebeurtenissen en datums van dingen.

**Instellen** (`/lijsten/:id/instellingen`): `Tabs` Algemeen · Velden · Voorraad · Soorten · Mensen (`?tab=`). Algemeen:
naam, hoe één ding heet, icoon, kleur, tags, melding; onderaan Als sjabloon, Archiveren en Verwijderen.

**Tag** (`/tags/:id`): de lijsten met die tag (met jouw rol), Tag weghalen, en **Altijd erbij** met Aanpassen.

**Jouw gegevens** (`/ik`): naam, kleur en rekeningnummer, Meldingen (en wat je stilzette), **App** (`AppCard`: Openen
op, Apps, Snelkoppelingen, Gedeelde foto; een bestemming kies je met `DestinationPicker`: Overzicht, Agenda,
Weergave, Lijst of Formulier, met bij een formulier Loggen, een soort of "<Ding> toevoegen" en Met tekst), **AI**, de
volgorde van je lijsten en **Back-up** (Downloaden, Terugzetten; enkel als je een lijst beheert).

**Verbanden** (`/verbanden`, ook via ⋯ → Verbanden van een lijst): `PageHead`, de filters, Werkt niet voor iedereen,
Kaart of Lijst, en de kaart van wat je kiest; zie [Verbanden](#verbanden-linkmapview-linklist-linkdetail-linkproblems-linkmaptsx-en-linkspage).

**Snel naar een formulier** (`QuickLinks.tsx`): de **QR-sticker** (`/lijsten/:id/sticker`, Afdrukken), een eigen app
(`/app/:id`: als app meteen naar haar bestemming, in de browser `HomeScreenHint`) en **Gedeeld** (`/delen`: een
gedeelde foto als kasticket ✨ of bij wat je toevoegt).

## 7. Toegankelijkheid

- Elk raakvlak is minstens 44px (`--hit`; de klassen regelen dat met een `::after`; maak niets kleiner met inline
  stijlen).
- Focus is altijd zichtbaar: een grijze rand met een ring (`--focus-ring`) op knoppen en velden, elders een
  omlijning (`--focus-outline`). Nooit `outline: none` zonder vervanging.
- **Naar de inhoud**: de eerste Tab toont een skiplink die naar `main#inhoud` springt.
- Iconen zonder tekst: `aria-label`. Decoratieve iconen en tegels: geen label nodig (`aria-hidden` zit in `Icon`).
- Kleur is nooit de enige drager: een badge heeft tekst, een meter heeft een `title`.
- Contrast: tekst haalt 4,5:1, ook op een grijs vlak; dus minstens `--muted-foreground` (ook voor placeholders en
  kolomkoppen). `--faint` enkel voor iconen en bijzaken.
- Geel draagt nooit tekst in geel: op het gele vlak staat zwart (haalt ruim 4,5:1), en geel is nooit een lijn of
  icoon op wit. De kop en de onderbalk op de waas zijn bijna dekkend, ook als het toestel geen vervaging kan.
- Het zoekpalet is een `listbox` met `aria-activedescendant`; dichtgeklapte boomtakken zijn `inert`.
- Keuzes onder een veld (`Combo` in `ItemPicker.tsx`, het zoekpalet) zijn een `combobox` met `listbox` en `aria-activedescendant`.

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
- Titels zonder punt. Geen uitleg (zie principe 11).
- Fouten zeggen wat er is en wat je kan doen: "Er moet altijd een beheerder overblijven."
- Lege staat: wat er nog niet is, en hooguit één knop om te beginnen. "Nog geen wijnen" + "Wijn toevoegen".
- Wat de gebruiker maakt, heet zoals hij het noemt: de naam van één item van de lijst ("Wijn toevoegen"), niet "item". Het
  algemene woord voor een formulier met eigen velden is **lijst**, nooit "soort", "type" of "categorie".
- Datums als "20 okt 2026", bedragen als "€ 1.234,56", hoeveelheden met het juiste meervoud ("1 fles", "3 flessen").
- Geen jargon ("API", "sync", "entity"), geen uitroeptekens, geen emoji.

---

## 10. Niet doen

- Geen nieuwe kleuren, schaduwen of afrondingen buiten de tokens.
- Geen gekleurde kaarten, geen verlopen, geen glans; een waas enkel achter de kop en de onderbalk op gsm.
- Geen zwevende knoppen of losse pillen: wat iets doet, hangt aan een rand (de onderbalk, de paneelbalk, een blad).
- Geen tweede hoofdknop op één scherm, en geen geel voor iets anders dan de hoofdactie, de + en het merk.
- Geen randen rond grijze vlakken (pillen, groepen, sporen): grijs is een vlak. Een veld is wit met een rand.
- Geen schaduw rond het paneel of een kaart: een ring van 1px.
- Geen lijnen tussen rijen of secties die tot tegen de rand lopen: ze zijn ingezet.
- Geen tekst onder 11px (11px enkel voor de onderbalk en eenheden in de stepper).
- Geen `animation-fill-mode: both/forwards` (zie Beweging).
- Geen `Link`, `NavLink` of `useNavigate` uit `react-router`: gebruik `src/router.tsx`.
- Geen eigen dialoog of `window.confirm`: gebruik `Sheet` of `useConfirm`.
- Geen nieuwe componentbibliotheek of CSS-framework; bouw op wat hier staat.
- Geen klassenamen die al een component zijn (`alert`, `card`, `row`, `tag`, `badge`, `filter`, `tab`, …) als
  losse toevoeging op iets anders: kies een eigen naam.
- Geen donkere modus (bewuste keuze: Thuis is wit).
- Geen AI zonder ✨: elke knop die de AI laat lezen, draagt `AiMark` (of is de stille ✨), en de AI start nooit
  vanzelf (ook niet bij een gedeelde foto). Wat de AI vond, zegt het ook achteraf (`Alert` met `ai`). ✨ betekent enkel
  AI: niet voor iets anders gebruiken.

---

## 11. Checklist voor elk nieuw onderdeel

Loop deze lijst af voor je iets oplevert:

- [ ] Gebruikt `PageHead`, en waar het past `Tabs`, `filters`, `card`/`CardHead`, `rows`/`table`, `split`.
- [ ] Enkel tokens uit `:root`; geen losse kleurcodes, px-schaduwen, duren of lettertypes. Kiezen is het witte vlak.
- [ ] Eén hoofdactie (`btn-primary`, geel), met `PhoneAdd` voor de + op gsm als het een overzichtsscherm is.
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
- [ ] Geen horizontale scroll (enkel de kaart van Verbanden schuift binnen haar eigen vlak); lange namen worden netjes afgekapt.
- [ ] Iets nieuws dat lijsten verbindt (een veld, een weergave, een blok)? Dan staat het op de kaart van Verbanden.
- [ ] Iconknoppen hebben een `aria-label`; alles werkt met het toetsenbord.
- [ ] Teksten volgen [Tekst](#9-tekst).
- [ ] Kan de gebruiker iets zelf ordenen? Dan met `useSortable` (greep + pijltjes), niet met knoppen.
- [ ] Geen ondertitel, uitlegzin, "· optioneel" of bijlabel (principe 11). Moet iets uitgelegd worden, pas dan de
      opbouw of het label aan.
- [ ] Gebruikt iets de AI? Dan een ✨ (`AiMark`) op de knop, nooit vanzelf, "met AI" in de melding achteraf, en
      verborgen als de AI voor jou uit staat (`useSession().ai`).
- [ ] Nieuw patroon nodig? Bouw het als component, en **voeg het toe aan dit stijlboek**.
