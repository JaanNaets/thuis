# Stijlboek Heystack

Dit stijlboek is de afspraak voor hoe Heystack eruitziet en aanvoelt. **Raadpleeg het voor je een scherm,
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
│ ‹            Wijnen           ⌕   (J)  │  ← terug of ▣ Heystack · titel zodra je scrolt · zoeken · jij
├────────────────────────────────────────┤
│ Wijnen                          (⋯)    │  ← titel 24px
│ [ Wijnen · Logboek ]                   │
│ …                                      │
├ onderbalk (schil, 56px, van rand tot rand) ┤
│ ◖Thuis◗   Geld   [ + ]  Agenda   Menu  │
└────────────────────────────────────────┘
```

- Witte pagina, inhoud met 16px marge, een titel van 24px.
- **De kop** (`.phone-head`, in `PageHead`): 48px op de schil met een waas, plakt bovenaan, een haarlijn eronder.
  Links **terug** (een icoonknop van 36px) of het merk (▣ Heystack, naar je eerste bord); rechts **zoeken** (opent het
  [zoekpalet](#zoekpalet-commandpalette)) en **jouw letter** (naar `/ik`). Zodra de grote titel onder de kop
  schuift, verschijnt hij klein in het midden.
- **De onderbalk** (`.tabbar`): vast onderaan, van rand tot rand, op de schil met een waas en een dekkende lijn
  erboven. Je eerste drie **borden** (met hun icoon en naam, in jouw volgorde) rond de gele **+**, en **Menu**. Het witte vlak glijdt naar waar je bent; Menu licht op voor wat enkel in het menublad staat (een lijst,
  je andere borden, …) en zolang dat open is.
- **De +** doet wat het scherm vraagt (`useAddAction` of `<PhoneAdd>` uit `src/shell.ts`: een lijst voegt een ding
  toe of logt), anders opent hij het palet om toe te voegen. Er is geen zwevende knop.
- **Het menublad** (`MenuSheet`, achter Menu): op de schil, zoeken bovenaan (opent het palet), je borden, onder
  Lijsten eerst Alle lijsten en dan je lijsten per tag, en Jouw gegevens; het witte vlak op waar je bent. Een tik op een rij sluit het blad.
- Tabelkolommen verdwijnen: de info staat in de grijze regel onder de titel (`.narrow-only`).

### Tablet en kiosk (vanaf 768px)

```
┌ schil #f2f2ef ─────────────────────────────────────────────────────────────┐
│ ▣ Heystack       ┌ paneel (wit, haarlijn, 18px) ──────────────────────────┐ │
│ [⌕ Zoeken…]      │ Thuis › Wijnen                   [+ Wijn toevoegen]  (J)│ │  ← paneelbalk 56px
│ ◖Thuis◗          ├────────────────────────────────────────────────────────┤ │
│ Geld, Agenda …   │ Wijnen                                          (⋯)    │ │  ← titel 24px
│ LIJSTEN          │ [ Wijnen · Logboek ]                                   │ │  ← tabs
│ ☰ Alle lijsten   │                                                        │ │
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
- **Zijbalk** (`Sidebar.tsx`), van boven naar onder: het gele merktegeltje (de stapel, `Icon name="brand"`) met "Heystack" (naar je eerste bord), het
  zoekveld als wit vlak (opent het [zoekpalet](#zoekpalet-commandpalette)), je borden, en onder Lijsten **Alle lijsten** en
  de [lijsten per tag](#zijbalk-lijsten-per-tag-sidebartsx). Het gekozen bord ligt op het **witte vlak** dat
  meeglijdt. Smal (enkel iconen) blijft van de lijsten enkel Alle lijsten over, onder een haarlijn (`.sidebar-lists`).
- **Paneelbalk** (56px, wit, plakt bovenaan het paneel met een haarlijn eronder; de inhoud scrollt eronder door):
  kruimelpad met `›` links ("Thuis › Wijnen": je eerste bord; een bord of Lijsten zelf staat er alleen, `top`),
  rechts de hoofdactie (gele knop) en jouw letter in een wit rondje (naar `/ik`).
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

- **Op een lijst** opent de + (gsm) of **Toevoegen** (tablet) hetzelfde palet, maar enkel met wat in die lijst kan
  (`usePalette()("add", "", { list, thing, planned })`): de naam van de lijst als zacht pilletje voor het invulveld
  (`.palette-scope`), op Dingen eerst "Wijn toevoegen", in het logboek eerst loggen, op Gepland wordt het plannen.
  Geen aparte knoppen per formulier meer: overal één manier.
- **De foto bij de +**: de camera rechts in het invulveld opent de [fotokiezer](#fotokiezer-photobutton-photopickertsx).
  De gekozen foto staat als smalle rij onder het invulveld (naam, ✨ als ze gelezen wordt, ×); tik daarna op een
  plek en ze gaat mee naar dat formulier (`foto=gedeeld`, met `lezen=1` als de AI ze leest). Sluit je zonder te
  kiezen, dan gaat de foto weg.
- Lijsten die je **bij de +** verborg ([Lijsten](#lijsten-listspage)), staan er niet; op die lijst zelf wel.

### Fotokiezer: `PhotoButton` (`PhotoPicker.tsx`)

Eén knop voor elke foto (een ding, een gebeurtenis, de foto bij de +): **Foto** (`btn-outline btn-sm`, camera, ✨ als
het formulier foto's leest) opent een blad met **Camera** en **Foto's** (op een computer enkel **Foto kiezen**) en de
schakelaar **Lezen met AI ✨**. Android opent bij een gewone fotoknop meteen de bibliotheek; daarom altijd deze twee.
De schakelaar staat zoals het formulier het wil (Instellen → Velden voor dingen, Soorten voor gebeurtenissen,
`shared/photoread.ts`) en kan per foto uit; de AI leest pas na die keuze. Leest niemand (AI uit, of het formulier
leest geen foto's), dan geen schakelaar (en op een computer meteen het bestandsvenster). In een formulier staat de
knop op zijn eigen breedte (`.photo-row`), met de naam van de foto en Weghalen ernaast, en eronder in grijs wat de AI
deed ("Gelezen met AI", "Geschat met AI", "Kasticket gelezen met AI: 4 lijnen"). Een gedeelde foto die nog gelezen
moet worden, staat klaar als **Foto lezen ✨** (`btn-primary`).

### Lijsten: `ListsPage`

**Lijsten** (`/lijsten`, in het menu **Alle lijsten**, `LINKS_PLACE`) is de ene plek waar al je lijsten staan, hoe
ze samenhangen en waar je ze voor jezelf instelt. `PageHead` met in grijs "9 lijsten · 4 verbanden tussen lijsten · 1
werkt niet voor iedereen", **Nieuwe lijst** (primary; op gsm in ⋯) en ⋯. Daaronder op tablet **Lijst | Kaart**
(`Segmented`; de kaart met `?weergave=kaart`, of als er een lijst gekozen is) en het zoekveld, dan **Werkt niet voor
iedereen**. Wat erna komt staat bij [Verbanden](#verbanden-linkmapview-linklist-linkdetail-linkproblems-linkmaptsx-en-listspage)
(de lijst, de kaart, selecteren). `/verbanden` en `/lijsten/verbanden` sturen door.

- **Een rij** (`LinkList`, de lijst zelf): ▸ (klapt haar verbanden open; zonder verbanden een lege plek), tegeltje,
  naam (**opent de lijst**) en in grijs haar verbanden, wat erin zit en wanneer laatst ("2 buiten · 7 weergaven · 7
  dingen · laatst gisteren"). Rechts (`RowEnd`): vanaf 1100px haar andere tags, wie er nog bij is (letters, max. drie
  en "+2") en de filterpillen **Menu**, **Toevoegen** en **Meldingen** (enkel als de lijst meldt; stil via een tag =
  uitgegrijsd); altijd ⋯. Smaller staat in de grijze regel ook wat afwijkt ("niet in het menu", "verborgen", "stil",
  "enkel kijken").
- **⋯ van een lijst**: Openen, Instellen (beheerder), **Op de kaart** (tablet) of **Verbanden** (gsm: het eigen
  scherm met het schema), en de schakelaars In het menu, Bij de + en Meldingen (stil via een tag: een knop "<tag>
  weer laten melden").
- **⋯ van de pagina**: Nieuwe lijst, **Volgorde** (een blad met een `sort-list` en Bewaren; je volgorde in het menu
  en de keuzelijsten) en **Selecteren** (dan staat Klaar rechts boven de lijst).
- De filterpil **Archief** (naast Groeperen en Sorteren) zet de gearchiveerde lijsten in een laatste groep.

Per persoon kies je zo waar een lijst staat: **in het menu** (zijbalk, menublad) en **bij de +** (`useListPlaces`,
`ListPlaces.tsx`). Een hulplijst zoals Winkels verberg je; zoeken, Lijsten en de keuzelijsten tonen ze altijd, en
de lijst die je bekijkt staat altijd in het menu. Dezelfde twee schakelaars staan in ⋯ van de lijst zelf
(`ListPlaceSwitches`, `.sheet-switches`). De structuur van een lijst (velden, soorten, mensen) blijft in Instellen.

### Zijbalk: lijsten per tag (`Sidebar.tsx`)

Bovenaan de plekken (`placesOf`): je **borden** met hun icoon en naam, in jouw volgorde (het eerste op `/`, de andere
op `/bord/:id`). Er zijn geen vaste pagina's voor geld, voorraad, eten, te doen of de agenda: dat zijn borden die je
zelf samenstelt (Geld, Agenda, Keuken). Daaronder **Lijsten**: eerst **Alle lijsten** (`LINKS_PLACE`, `/lijsten`: je lijsten en hun
verbanden, geen bord), dan per tag een
rij met een pijltje (`TagTree`); open groeit ze van `0fr` naar `1fr` en staan haar lijsten eronder met een klein
tegeltje in hun toon (`.place-dot`) en een hulplijn links. Een lijst met meer tags staat onder elke tag; zonder tag
onder "Zonder tag". De tag van de lijst die je bekijkt, staat open; een tag tekent zijn lijsten pas als hij opengaat.
Onderaan "+ Lijst". Op gsm staat dezelfde boom in het menublad (`MenuSheet`); onder een bord staan geen lijsten.
Een sectiekop ("Lijsten") staat in kleine kapitalen.

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
- Verplichte velden krijgen `required` en een grijs sterretje achter het label (`RequiredMark` in `Controls.tsx`):
  de velden die een beheerder verplicht zette, de naam van een ding en de datum van een gebeurtenis. Zonder sterretje
  is een veld optioneel; geen "· optioneel".
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

Wat je bijhoudt, is een **ding** in een **lijst** (wat er is en blijft), of een **gebeurtenis** in haar logboek (wat
er gebeurt). De dingen van een lijst hebben dezelfde velden (Wijnen met jaargang en druiven); een **formulier** (in de
code een soort, `kinds`: Tankbeurt, Uitgave) heeft eigen velden voor haar gebeurtenissen. In de interface heet een
soort altijd **Formulier**; het woord "soort" komt er niet in voor (een veld heeft een **type**). Beide gebruiken dezelfde veldsoorten. De veldsoorten
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
| Barcode en Foto (`ThingForm`) | Onder de naam van een nieuw ding: **Barcode** (lijsten met productinfo: `BarcodeScanner`, zoekt in Open Food Facts, zonder AI) en de [fotokiezer](#fotokiezer-photobutton-photopickertsx) (een etiket of product; lezen staat aan of uit in Instellen → Velden). Eronder in grijs waar het vandaan komt ("Uit Open Food Facts: …", "Uit NEVO: …", "Geschat met AI"). Een gedeelde foto staat klaar als **Foto lezen ✨**: de AI leest pas na die tik; de foto komt bij het ding. |
| `ItemPhoto` | De foto van een ding of gebeurtenis bovenaan: toevoegen, vervangen, weghalen. Nog geen foto: enkel de knop **Foto toevoegen** (geen leeg vlak) |
| `IconPicker` (`IconPicker.tsx`) | Een icoon kiezen voor een lijst (`ICONS` in `shared/icons.ts`): grijze tegeltjes, het gekozen is zwart |
| `NotificationsCard` (`Notifications.tsx`) | Bij Jouw gegevens: "Meldingen" als `card` met `CardHead` en `card-body`. Een `Switch` "Meldingen op dit toestel" en daaronder "Testmelding sturen" (`btn-outline btn-sm`). Dan **Stil**: de stilgezette lijsten en tags als rijen met × (weer laten melden) en een `select` "Stilzetten…". Kan het niet, dan enkel een `Alert` die zegt waarom: op een iPhone eerst op het beginscherm zetten, of de meldingen staan uit in de browser. Een melding toont het app-icoon (`icon-192.png`) en in de statusbalk de badge (`badge-96.png`: de stapel wit op doorzichtig; Android gebruikt enkel de doorzichtigheid, een icoon met achtergrond wordt een wit vierkant) |
| `RepeatForm`, `RepeatCard` (`Repeat.tsx`) | Herhalen: op de fiche een `btn-outline btn-sm` "Herhalen" (icoon `clock`, enkel met `can_repeat`) opent een `Sheet` met "Hoe vaak" (`.interval-input`) en "De eerste keer" (vandaag of later), en Stoppen als het al loopt. Loopt het, dan een kaart "Herhaalt zich" in de zijkolom ("Elke maand; de volgende keer op 30 nov 2026.") met Aanpassen |

- "Eigenaar" is van wie iets is; "Van wie" is enkel de herkomst van iets dat je kreeg.
- Herhaling (`.interval-input`): "elke [3] [maanden]". Duur typ je vrij ("1u30", "90", "1,5 uur"); onder het veld
  staat wat de app las ("= 1 u 30 min") als dat anders is dan wat je typte.
- Een datum kan **Begint met vandaag** hebben (`today`, schakelaar onder ⋯): een nieuw item krijgt de datum van
  vandaag in het formulier (wat je at, een uitgave). Je ziet ze staan en past ze aan; enkel een verplichte datum die
  leeg blijft (een actie die start) krijgt van de API vandaag.
  Een verwijzing kan **Neemt waarden over** (`copy`, schakelaar): kies je een item, dan krijgen de lege velden hier
  de waarden van de velden met dezelfde sleutel daar (zacht geel, `auto`; en de naam als die leeg is). En **Past het
  gekozen item aan** (`adjust`, keuzelijst "Trekt af van Aantal" / "Telt bij Aantal", met "Met": 1 per item of een
  getal of berekening van deze lijst; enkel als de lijst waarnaar het wijst een getal heeft).
  Een ja/nee kan **Aan: ook een item in** (`spawn`, lijsten kiezen onder ⋯): een nieuw item met dat vinkje aan maakt
  ook een item in de eerste van die lijsten waarin je mag toevoegen (Gegeten bij een uitgave → je eigen Eten), met de
  naam, de velden met dezelfde sleutel, hetzelfde product (met wat het overneemt) en hoeveel, omgerekend naar de
  eenheid daar. De toast zegt "Yoghurt bewaard, ook bij Eten" met **Openen**; Ongedaan maken na een actie die meteen
  bewaart haalt beide weg.
  Een datum, periode of berekende datum kan **In de agenda** (`agenda`, schakelaar): ze staat dan in de Agenda.
  Een datum (of een berekende datum, zoals Volgende keer) kan **Herinneren** (`remind`, keuzelijst onder ⋯: Niet,
  Op de dag zelf, 1, 2, 3 dagen, 1 of 2 weken, 1 maand vooraf), met **Elk jaar** (`yearly`) voor een verjaardag.
  Zo'n lijst is een **logboek**: de naam mag leeg (placeholder "Weging 30/10/2026"; de API geeft die naam) en de
  lijst toont het nieuwste eerst.
- Een nieuwe lijst begint met een **sjabloon** (`TEMPLATES` in `shared/catalog.ts`, `.template-picker`): velden,
  voorraad, eigen soorten en wie een melding krijgt. Niet gekozen is een sjabloon een zacht grijs vlak; gekozen wordt
  het het witte vlak met een zwart icoontegeltje. Er zijn er zo weinig mogelijk: **Lege lijst** (dingen met een
  notitieveld), **Uitgaven** (zoals Splitwise: de soort Uitgave, gelijk verdeeld, een melding aan wie in de verdeling
  staat), **Dieet** (zoals Yazio: Gegeten met kcal en Gewicht) en als laatste tegel **Uit bestand**. Elke lijst heeft
  een logboek, dus geen sjabloon "Logboek". Alles daarbovenop voeg je zelf toe (Instellen); een sjabloon voor één
  geval komt er niet, dat wordt een bestand dat iemand deelt.
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
- **Toevoegen uit andere lijst** (⋯ van de dingen, `FromListPage`, `/lijsten/:id/uit-lijst`, logica in
  `shared/transfer.ts`): een eigen scherm zoals Importeren. **Uit** (een lijst met dingen), **Welke**
  (`ConditionsEditor` uit `Filters.tsx`, dezelfde voorwaarden als een weergave), **Kolommen** (`.column-map`: per veld
  van deze lijst Leeg, een veld van de bron dat past (`canCarry`), het origineel bij een verwijzing naar de bron, of
  Vaste waarde met het gewone veld eronder, `.column-map-value`; keuzes die hier niet bestaan vertaal je eronder,
  `.column-map-translate`) en de schakelaar **Weghalen uit <bron>** (enkel als je de bron mag wijzigen: het ding zelf
  verhuist, met foto, logboek en voorraad). Dan **Zo komt het erin** (`.import-preview`) en de knop "N toevoegen" of
  "N verplaatsen". Wat je koos, blijft per paar lijsten bewaard; de server rekent alles opnieuw uit
  (`POST /lists/:id/things/from`). Het is een eenmalige actie, geen blijvende koppeling.
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

- **Een agenda op een bord**: een weergave in de vorm **Agenda** (`ViewBody`), bv. "alles met een datum van al je
  lijsten": wat gebeurde of gepland staat, en elk veld met **In de agenda** (`agenda` op een datum, een periode of
  een berekende datum), met jouw rechten per lijst. In een smalle kaart (onder 560px, een container query) zoals op
  gsm: stipjes en de daglijst.
- Een lijst als agenda: de weergave **Als agenda** (volgens een datumveld naar keuze).

### Uitleg: `Tip`

`<Tip text="…" label="Hoe Totaal berekend wordt" />` is een kleine (i) naast een label: de uitleg verschijnt in
een zwart ballonnetje bij aanwijzen, focus of tikken (gsm), en sluit met Escape, ergens anders tikken of scrollen.

- Enkel bij een berekening: wat ze uitrekent, en bij een keuze in de `CalcEditor` die je moet begrijpen ("Welke
  items" bij samenvatten). Nergens anders: zie principe 11.
- Op een `label` werkt de (i) zonder het veld te focussen.

### Sjabloon delen (`shared/template-file.ts`)

Instellen → Algemeen → **Als sjabloon** (`btn-ghost`, icoon download) bewaart de opbouw van de lijst als bestand:
naam, hoe één ding heet, icoon, velden, voorraad, eigen soorten en wie een melding krijgt, zonder dingen, logboek of
mensen. Bij een nieuwe
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

### Kosten verdelen: Wie moet wie en `SettleForm`

Kosten verdelen is geen lijst: elke aankoop of dienst heeft Bedrag, Betaald door (begint met jou) en Gedeeld met
(`SharesField`; in een lijst waar meer mensen loggen begint dat op Gelijk over hen, `defaultSharers`, zoals Splitwise),
en een lijn kan enkel van één persoon zijn. Wie moet wie rekent de app uit over alles wat je ziet
(`shared/ledger.ts`); een terugbetaling is een overdracht.

- Een bedrag verdeelt tot op de cent (`splitCents`): de cent die overschiet, draagt wie betaalde.
- Wie moet wie is een weergave ("Toon wie moet wie", bron `saldo`). Per overschrijving één rij: "Jana → Jij", rechts
  het bedrag, en eronder een `link-button` **Terugbetaald** (`SettleForm` in `Settle.tsx`, een `Sheet` met het bedrag;
  minder mag). Moet jij betalen en heeft de ander een rekeningnummer (bij **Jouw gegevens**), dan staat daar een
  betaal-QR (`.pay-qr`, EPC, `shared/payment.ts`) om te scannen met je bank-app. Niets open: "Niets".
- "Jij" in plaats van je eigen naam.
- Telt enkel wat je helemaal ziet (een gebeurtenis in een lijst waar je bij bent); wat je niet ziet, telt niet mee.
- Een nieuwe use case (voorraad, ...) bouw je eerst uit velden, berekeningen en totalen, als sjabloon. Pas als dat
  echt niet gaat, een eigen onderdeel bovenop de kern.

### Voorraad: `StockStepper` (`ThingsView.tsx`)

Een lijst die voorraad telt, toont rechts in elke rij hoeveel er is (`.row-stepper`: − het aantal +, de eenheid erbij,
rood als het bijna op is: `.row-stepper-value.is-low`). − en + loggen na een korte pauze één telling (een meting
"Telling"), nooit een gebeurtenis per tik. Wat er is, rekent de app uit (`shared/stock.ts`); in een tabel is dat de
laatste kolom (Voorraad), naast die kolom staat er één veld minder. Geplande aankopen (boodschappen) staan in het
logboek met een vinkje (`.row-check`, 44px); afgevinkt is doorstreept en stil (`.log-row.is-done`).

### Foto lezen in een gebeurtenis (`EventForm.tsx`)

Onder "Typ wat je weet" staat de [fotokiezer](#fotokiezer-photobutton-photopickertsx). Wat de AI leest, hangt af van
de soort (`POST /lists/:id/events/read-photo`): een **aankoop** leest een kasticket (de winkel als lijn **bij**, elk
product als lijn **erbij** met hoeveel, eenheid en prijs, gekoppeld aan een ding dat je ziet; wat nieuw is, krijgt
**Nieuw in**; het totaal in Bedrag, de datum in Wanneer). Een soort met voedingswaarden (Gegeten) herkent een
**gerecht** en schat de portie ("Geschat met AI"). Elke andere soort vult haar eigen velden, de omschrijving, datum en
het bedrag in met wat er echt op de foto staat ("Gelezen met AI"). De foto komt altijd bij de gebeurtenis. Welke
formulieren lezen, zet een beheerder in Instellen → Formulieren (**Foto lezen met AI ✨**, een schakelaar per formulier
van de lijst, `formsOf`, ook in het formulier zelf); standaard een formulier met geld of voedingswaarden.

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
- **Het merk** (`brand`): de stapel van Heystack, zwart op het gele tegeltje. Hetzelfde teken is het app-icoon
  (`public/icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`: geel vlak, het teken op 62,5% zodat het
  ook in een cirkel past) en de badge van een melding (`badge-96.png`, wit op doorzichtig). Verander je het teken,
  maak ze dan alle vijf opnieuw.
- Maten: 12 (in de toast) · 14–16 (knoppen, filters, tekst) · 17 (zijbalk) · 18 (standaard) · 21 (onderbalk).

### Getallen

- Bedragen: `formatCents` → "€ 1.234,56". Datums: `formatDate` → "20 okt 2026". Hoeveelheden: `formatNumber` +
  `unitWord` ("3 flessen").
- Een getal dat kan veranderen terwijl je kijkt (tellers): `<Num value={n}>` rolt omhoog of omlaag.
- Een groot totaal dat verschijnt: `useCountUp(cents)` telt op.

---

### Wat nu loopt (activiteiten)

Een activiteit met een uur en zonder einde loopt nog (werk, vasten). In een weergave met **Loopt nu** = ja staat ze
met de tijd die live meetelt (`font-variant-numeric: tabular-nums`) en **Stop** (`POST /events/:id/stop`); een actie
die start en stopt toont dezelfde tijd op de knop. Een soort met een doel (16 u vasten) geeft een melding als dat doel
bereikt is.

### Verbanden: `LinkMapView`, `LinkSchema` (`LinkMap.tsx`), `LinkSearch`, `LinkDetail`, `LinkInline`, `LinkProblems`, `SelectionCard` (`LinkParts.tsx`), `LinkList` (`LinkList.tsx`) en `ListsPage`

Hoe al je lijsten met elkaar en met de weergaven samenhangen, uit `shared/links.ts` (`GET /insights/links`): enkel
wat jij ziet. Drie soorten, elk met een eigen kleur **en** patroon, zodat kleur nooit alleen draagt: **Logboek**
(doorlopend, de eerste grafiekkleur: gebeurtenissen in de ene lijst met dingen of soorten van de andere),
**Verwijzingen** (streepjes, de tweede: een veld dat naar een andere lijst wijst) en **Weergaven** (puntjes, de derde:
wat de app uitrekent: Geld, Wie moet wie, Voorraad, Eten, Te doen, Agenda, Loopt nu, en verder Herinneringen,
Meldingen, Herhalen, Productinfo, Kasticket lezen, Overzicht). Wat een verband doet, staat er als gewone zin (`lineText`: "Tankbeurt voor een wagen",
"Gegeten haalt eraf uit de voorraad"); hoe vaak en wanneer laatst staan apart, rechts.

- **Bovenaan** onder de titel één regel met cijfers (lijsten · verbanden tussen lijsten · wat niet werkt). Dan één rij:
  **Kaart en Lijst** als `Segmented` (`?weergave=`, enkel op tablet, `useWide`; het begint op Kaart) en het **zoekveld**
  (`LinkSearch`, "Zoek een lijst, ding, formulier of weergave"). Daaronder per soort een filter die je aan- en uitzet (met
  een stukje lijn), en **Werkt niet voor iedereen** (`LinkProblems`): één regel per persoon ("Rik ziet Winkels en
  diensten niet") met de knop die het oplost ("Rik toevoegen" als je de ontbrekende lijst beheert, anders Mensen van de
  andere lijst). Enkel als je een van beide lijsten beheert.
- **Zoeken** (`searchLinks`): elk woord moet erin staan, zonder hoofdletters of accenten; het zoekt in lijsten,
  soorten (en waar ze gebruikt worden), de dingen in een verband, wat een verband doet en de weergaven. Rechts in het
  veld hoeveel treffers en een kruisje. Op de kaart liggen de treffers onder het veld per groep (Lijsten, Soorten,
  Dingen, Verbanden, Weergaven, hooguit vijf per groep), met de woorden gemarkeerd (`Mark`, zacht geel); pijltjes
  kiezen, Enter opent, Escape sluit en wist bij een tweede keer. Wat niet overeenkomt, wordt dof; wat overeenkomt, krijgt
  de gele halo. In de lijst filtert zoeken de lijst zelf, en zegt elke rij waarom ze er staat.
- **De kaart** is een metrokaart (`layoutLinks`): per tag een zachte grijze kolom (een lijst staat bij haar eerste
  tag), de lijsten als stations, de verbanden tussen lijsten als sporen. Elke lijst waar iets in toekomt, krijgt een
  eigen rij (wie het meest binnenkrijgt bovenaan, een groter station); een spoor loopt eerst verticaal bij de lijst
  waar het vertrekt en dan horizontaal naar zijn doel, op een eigen baan per soort. Twee stations in een kolom
  krijgen elk een eigen plaats als hun verticale sporen elkaar zouden raken. Onder de naam en het aantal dingen
  staan de weergaven als één grijze regel tekst met een groen bolletje ervoor ("Geld · Voorraad · +4", `viewsLine`).
  Elke lijst staat op de kaart: een lijst die enkel in weergaven voorkomt, is een grijs station zonder spoor op de
  eerste vrije rij van haar kolom, een lijst zonder verbanden een gestippeld station. Een verband dat voor iemand niet
  werkt, is rood gestreept. Past de kaart niet, dan verkleint ze tot 72%, en nog breder schuift ze binnen haar eigen
  vlak. Met de muis boven een station: een wit **kaartje** (naam, dingen en laatst, ← en → met hoe vaak, de weergaven);
  op aanraakschermen niet. Tik of Enter op een station kiest het (`?lijst=`): het krijgt de gele halo, de rest
  vervaagt, en eronder komt **het paneel**.
- **Het paneel** (`LinkDetail`): kop met icoon, naam, één regel (tag · dingen · laatst), Openen en een kruisje; dan
  wat niet werkt voor deze lijst (op een zacht rood vlak) en twee kolommen als er plaats is: links **Komt van**,
  **Gaat naar** en **In de lijst zelf**, rechts **Weergaven** en **Wie** (letter en naam, geen rol). Elke rij
  (`LinkEndRow`): een stukje lijn per soort (of het icoon van de weergave), de naam, wat het doet in grijs, de dingen
  die het vaakst voorkomen als grijze chips ("Colruyt 8"), rechts hoe vaak en de dag van de laatste. Een tik kiest dat
  eind.
- **De lijst** (`LinkList`): boven de lijst **Groeperen** (per tag, per soort verband, per weergave: `?groep=`),
  **Sorteren** (eigen volgorde, naam, meeste verbanden, laatst gebruikt: `?sort=`), **Archief**, **Alles uitklappen**
  en **Alles inklappen** (op gsm één icoon dat wisselt); Selecteren zit in ⋯ van de pagina. Een groep klapt
  open en dicht met haar pijltje; dicht toont ze de namen van haar lijsten, of in rood voor wie iets niet werkt. Het
  pijltje van een rij klapt haar open (`LinkInline`, op een zacht grijs vlak; de naam opent de lijst): Komt van en Gaat naar met één regel per ander eind (stukje
  lijn, naam, zin, chips, hoe vaak, laatst) en de weergaven als chips; een tik springt naar dat eind (zijn groep en rij
  gaan open, de lijst schuift ernaartoe). Rechts staat wat [Lijsten](#lijsten-listspage) erbij zet (tags, mensen, pillen, ⋯). Lijsten zonder verbanden
  hebben geen pijltje. In de groepering per tag komen
  de weergaven als laatste groep.
- **Selecteren**: vinkjes voor elke lijst en elke groep (een groep met een deel gekozen toont een streepje); een
  gekozen rij wordt zacht geel. Je keuze staat in het adres (`?keuze=a,b`). Ernaast (breed) of erboven (smaller dan
  1100px) **Tussen je selectie** (`SelectionCard`): de gekozen lijsten als chips met een kruisje, een klein schema
  (op een rij, de verbanden als lijn of boog met hoe vaak), de verbanden tussen twee ervan, **Samen in** (de weergaven
  met minstens twee ervan: "beide", "alle drie" of de namen) en wat niet werkt. Onderaan plakt een zwarte balk met
  hoeveel er gekozen zijn, **Samen op de kaart** (de kaart licht je keuze op), **Enkel deze tonen** (`?enkel=1`, geel
  als het aanstaat; dan **Alles tonen**) en **Wissen**. Op gsm zweeft de balk boven de onderbalk.
- **Op gsm** is er enkel de lijst; een gekozen lijst is een eigen scherm (terug is echt terug), met de naam als titel,
  één regel eronder, en **het schema** (`LinkSchema`): links waar iets vandaan komt, rechts waar het naartoe gaat, in
  het midden de lijst zelf met de gele halo, op elke lijn een wit pilletje met hoe vaak, en de weergaven als haltes op
  een groene stippellijn eronder (de namen om en om hoger en lager, aan de rand naar binnen). Een tik op een station
  kiest die lijst; meer dan vier aan een kant: de drie met het meeste en "+n". Daaronder wat niet werkt, Komt van, Gaat
  naar, Weergaven, In de lijst zelf en Wie, elk in een eigen kaart, en onderaan Openen.
- Een nieuwe eigenschap van een veld, lijst, soort, gebeurtenis, lijn of blok? Dan weigert TypeScript te bouwen tot
  je in `shared/links.ts` beslist of ze iets verbindt (`FIELD_LINKS` …); wat verbindt, krijgt een voorbeeld in
  `test/links.test.ts`. Zo blijft alles zichtbaar.

### Weergaven en acties op een overzicht: `ViewCard`, `ActionTile`, `ViewBuilder`, `ActionBuilder`

Een bord heeft twee soorten blokken (`shared/blocks.ts`): een **weergave** (iets tonen) en een **actie** (iets loggen).
Er zijn geen vaste blokken en geen voorbeelden: Toevoegen → **Blok toevoegen** (`AddChoice`: Weergave · Actie, zonder
ondertitel) → een lege zin. Te doen, Wie moet wie, Bijna op, Uitgaven, Eten en Loopt nu zijn gewoon zinnen.

- **De zin** (`ViewBuilder` in een `Sheet` met `builder-sheet`): een weergave lees je als een zin, elk stuk is een
  witte pil met een pijltje (`.tok`, met de gewone keuzelijst van het toestel erover), wat je toevoegt een stille
  `+ …` (`.tok-add`), wat je weghaalt een ×. "**Toon** het logboek **van** al je lijsten / Jaan · Voorraad **waar**
  dingen bevat komkommer **en** wanneer in deze maand **tel** de som van bedrag **per** maand **over** de laatste 12
  maanden **met als doel** …". Bronnen (`SOURCES`): het logboek, de dingen, de voorraad, wie moet wie, wat er gegeten
  is, alles met een datum (gebeurtenissen en de datums van dingen met In de agenda). Een lijst krijgt **gesorteerd
  op** en **hoogstens N rijen**; tellen enkel bij een vorm die telt; de dingen tellen of staan in een agenda
  **volgens** een datumveld.
- **Tonen als** (`.show-grid`, elf `.show-tile`s met een klein tekeningetje, het gekozen wit met een rand en blauw):
  Lijst, Tabel, Agenda, Getal, Voortgang, Staafjes, Lijn, Gebied, Per keuze, Verdeling, Per dag. Geen 3D, geen
  grafiekenbibliotheek. **Kolommen** als chips (`.builder-chips`) bij Lijst, Tabel en Agenda (de grijze regel in de
  daglijst).
- **Voorwaarden** (`RulesEditor`, `.rule-line`): over wat je ziet, nooit iets dat handelt. "Als een rij waar … →
  rood / oranje / groen kleuren, bovenaan, verbergen", "Als er niets is → het blok verbergen", "Als de uitkomst > … →
  kleuren". Een gekleurde rij krijgt een balkje links (`.tone-row-*`) en gekleurde tekst; een gekleurde uitkomst
  kleurt het getal.
- **Voorbeeld** (`.cap-label` Voorbeeld): de echte weergave met jouw gegevens, die meekijkt terwijl je bouwt
  (`GET /insights/view`, 300 ms na de laatste wijziging); in het voorbeeld doet een rij niets. Op tablet (vanaf 900px)
  links de zin en rechts het voorbeeld, op gsm het voorbeeld bovenaan. **Naam** bovenaan, met de naam die vanzelf
  komt als placeholder ("Het logboek", "Bijna op"). Onderaan, altijd zichtbaar (`.builder-actions`): Annuleren en **Op
  het bord zetten** / **Bewaren**.
- **Een weergave op het bord** (`ViewCard`): een `dash-card` met `CardHead`, de periode eronder ("Laatste 6 maanden")
  tenzij de naam ze al zegt ("Water vandaag"). **Bladeren** (`viewSpan`): heeft de weergave een periode (een getal of
  grafiek over de laatste zoveel, of een voorwaarde "in vandaag / deze week / deze maand / de laatste 7 dagen"), dan
  staan rechts in de kop ‹ › (`.view-tools`, `btn-ghost btn-icon btn-sm`) en na het bladeren **Vandaag**; de periode
  eronder in woorden ("Gisteren", "Vorige maand", "Oktober 2026", "12/10 – 18/10"). Een getal of grafiek gaat niet
  voorbij vandaag; tijdens het laden blijft de vorige periode staan, zachter (`.view-content.is-stale`). Agenda: een
  maandkalender (zie [Agenda](#agenda-calendarmonth)) die zelf per maand bladert. Lijst: rijen met de naam, de kolommen in grijs, de laatste rechts; een
  geplande rij heeft een vinkje (afvinken), een lopende de tijd en Stop, een rij van wie moet wie **Terugbetaald**;
  meer dan het maximum is "+13". Tabel
  (`.view-table`): kleine grijze koppen, getallen rechts. Per dag (`.view-calendar`): per dag een vakje van hoogstens
  32px, de weekdagen erboven, van licht naar donker in één kleur (`--chart-1`) met "minder … meer". Niets: "Niets"; een
  weergave die verbergt als er niets is, staat er dan niet.
- **Een actie** (`ActionBuilder`): bovenaan de knop zoals hij wordt (`.builder-preview-tile`), dan Lijst, Formulier (`FormPicker`),
  **Een tik** (`.does-grid`, vier keuzes: Opent het formulier · Bewaart meteen · Telt er een bij · Start en stopt, die
  laatste enkel bij een activiteit), bij formulier en bewaren de schakelaar **Gepland** (`Switch`: het formulier opent
  met Gepland aan, `?gepland=1`, of bewaren zet het gepland: een boodschap, iets te doen; toast "… gepland"),
  **Vooraf ingevuld** (`.prefill`: de omschrijving en de velden van de soort, het formulier krijgt ze via `?vooraf=`)
  en **Naam op de knop**.
- **Een actie op het bord** (`ActionTile`, `.quick-tile`): geen kaart maar een knop van 56px, het icoon van de soort
  op de tint van de lijst, de naam en rechts wat een tik doet (+ formulier of tellen, ✓ bewaren, klok timer).
  Bewaren en tellen tonen een toast met **Ongedaan maken**; tellen toont hoeveel vandaag (`.quick-tile-count`), een
  lopende timer de tijd (`.quick-tile-time`, de knop krijgt `.is-running`). Acties na elkaar staan samen
  (`segmentBlocks`, `ActionGroup`): twee per rij op gsm, vanaf drie een breed blok met vier naast elkaar op tablet.

### Grafieken

`ChartView`, `ChartTable` (`Chart.tsx`), uit `shared/charts.ts`. Een grafiek is een weergave in de vorm Staafjes,
Lijn, Gebied, Per keuze, Verdeling, Getal of Voortgang.

- **Kaart**: `ViewCard` met rechts een stille knop met het icoon `table` (Als tabel / Als grafiek).
- **Staafjes**: hoogstens 24px breed, 4px rond aan de top en recht aan de basis; gestapeld met 2px wit ertussen.
  **Lijn**: 2px, een punt van 8px met een witte rand aan het eind, één reeks met een zachte vlakte eronder; **Gebied**
  vult elke reeks. Haarfijne rasterlijnen (`--chart-grid`), de nullijn iets sterker; een **doel** is de enige
  stippellijn ("Doel € 1.200,00"). Eén waarde staat erbij (de periode van nu), niet bij elke staaf. Vanaf twee reeksen
  een legende (`.chart-legend`: een vierkantje bij staafjes, een streepje bij lijnen).
- **Per keuze** (`.chart-ranked`): per keuze een rij (naam, een zwart staafje van 12px, de waarde rechts), de
  grootste eerst, hoogstens 12 en de rest als Overige. **Verdeling** (`.chart-parts`): één balk van 28px in stukken
  (hoogstens zes), 2px wit ertussen, het aandeel erin enkel als het past (anders in de tooltip en de tabel), de namen
  in de legende. **Getal** (`.chart-number`): de uitkomst groot (32px, 600), "+12% tegenover de periode ervoor" in
  grijs en een kleine grijze lijn per periode. **Voortgang**: het getal met "/ 8" in grijs (`.chart-number-goal`) en
  een doelbalk (`.chart-meter`, rood boven de grens).
- **Kleur volgt de keuze**, niet haar plaats: een persoon, keuze of tag houdt zijn kleur (de volgorde van de keuzes,
  de leden, de namen), wat ook de rangorde is.
- **Tooltip** (`.chart-tip`, wit vlak): per periode één tooltip met alle reeksen, de waarde vooraan en vet; het raakvlak
  is de hele periode (groter dan het staafje). Met het toetsenbord: focus op de grafiek en ← →. Alles staat ook in
  de tabel (`.chart-table`): de tooltip is nooit de enige weg naar een getal.

---

## 6. Patronen per scherm

**Een bord** (`/` het eerste, `/bord/:id` de andere; `BoardView` in `Board.tsx`): `PageHead` (`top`) met de naam van
het bord, `primary` **Toevoegen** (op gsm de + in de onderbalk), in `actions` enkel ⋯ → een `Sheet` met Aanpassen,
Nieuw overzicht, Naam en icoon (`IconPicker`), Volgorde (een `sort-list` met greep en Bewaren; het bovenste wordt je
beginscherm), Verwijderen. Je wisselt van bord in het menu (zijbalk, onderbalk,
menublad, palet), niet met tabs. Vanzelf (zolang je niets koos): Uitgaven deze maand, Te doen, Bijna op en Wie moet
wie, als weergaven. Onder een bord staat niets anders dan zijn blokken: je lijsten
staan in de zijbalk en onder Menu (en in Verbanden). Elk blok is een [weergave of actie](#weergaven-en-acties-op-een-overzicht-viewcard-actiontile-viewbuilder-actionbuilder)
(of één ding); de blokken staan als metselwerk (`useMasonry`). **Aanpassen** (`BlocksEditor`): een `sort-list` met
greep, de naam, een potlood (de bouwer), Breed als filterpil (enkel op tablet) en ×, Toevoegen → Blok toevoegen, onderaan
Klaar.

**Toevoegen** (het [zoekpalet](#zoekpalet-commandpalette)): typ wat er gebeurde ("gegeten pasta 300 g"); noemen de
eerste woorden een soort of lijst, dan staat die bovenaan, staat er een ding in je tekst, dan loggen in zijn lijst
eerst; de rest van je tekst gaat mee naar het formulier (`?tekst=`). Nieuwe lijst als laatste.

**Lijst** (`/lijsten/:id`): `PageHead` met ⋯ (Instellen, Importeren, Toevoegen uit andere lijst, QR-sticker, Op je beginscherm) en `primary`
"<Wijn> toevoegen" of Loggen → `Tabs` <dingen> · Logboek · Gepland (enkel met iets gepland) → `split
split-main-first`: de dingen of het logboek, in de zijkolom Wie (enkel met meer dan jij) en Tags → `PhoneAdd`.

**Ding** (`/dingen/:id`): `PageHead` met Loggen en Bewerken → `split`: in de zijkolom de foto, de voorraad en de
velden (`dl`), rechts de **Tijdlijn** (alles wat ermee gebeurde: wanneer, waar, erbij of eraf, prijs per eenheid;
gaat een gebeurtenis enkel over dit ding, dan haar bedrag), de delen, wat ernaar verwijst en bestanden → onderaan
Archiveren en Verwijderen.

**Gebeurtenis** (`/gebeurtenissen/:id`): de velden (soort, wanneer, bedrag, betaald door, gedeeld met, gelogd door,
lijst) in de zijkolom, rechts de **Lijnen** en wat ze afvinkte → Verwijderen.

**Loggen** (`/lijsten/:id/loggen`, `EventForm`): bovenaan **Typ wat je weet** (vult live in, zie `shared/parse.ts`)
met Kasticket ✨, dan **Formulier** (`FormPicker`, filterpillen met icoon: de formulieren van de lijst, zonder eigen
formulieren de zes basissoorten; de rest, dus de basissoorten naast eigen formulieren en de formulieren van andere
lijsten, in "Ander formulier…"; zie `formsOf`), Omschrijving, Wanneer en Uur (bij een activiteit Van en Tot), Gepland; bij geld Bedrag, Betaald
door en Gedeeld met (bij gebruik: Wie at of gebruikte); de [Lijnen](#lijnen-lineseditor-linestsx); de velden van de
soort; Herhalen en Foto. Een prijs in de tekst zonder gekozen soort maakt er een aankoop van.

**Een ding toevoegen** (`/lijsten/:id/nieuw`, `ThingForm`): Naam, met eronder **Barcode** (lijsten met productinfo)
en **Foto ✨**, en daaronder de bron ("Uit Open Food Facts: …", "Geschat met AI"); dan de velden, Deel van, Opslaan
en Opslaan en volgende.

**Geld, Agenda, Te doen, Voorraad, Eten** zijn geen vaste pagina's maar borden met weergaven: Wie moet wie (met
Terugbetaald), Uitgaven deze maand (‹ › naar vorige maanden), per soort of per winkel; alles met een datum als
Agenda; wat gepland staat als lijst met een vinkje; de voorraad waar bijna op = ja; wat er gegeten is, vandaag (‹ ›
naar gisteren).

**Instellen** (`/lijsten/:id/instellingen`): `Tabs` Algemeen · Velden · Voorraad · Soorten · Mensen (`?tab=`). Algemeen:
naam, hoe één ding heet, icoon, kleur, tags, melding; onderaan Als sjabloon, Archiveren en Verwijderen.

**Tag** (`/tags/:id`): de lijsten met die tag (met jouw rol), Tag weghalen, en **Altijd erbij** met Aanpassen.

**Jouw gegevens** (`/ik`): naam, kleur en rekeningnummer, Meldingen (en wat je stilzette), **App** (`AppCard`: Openen
op, Apps, Snelkoppelingen, Gedeelde foto; een bestemming kies je met `DestinationPicker`: Overzicht (een bord), Lijst
of Formulier, met bij een formulier Loggen, een soort of "<Ding> toevoegen" en Met tekst), **AI** en **Back-up** (Downloaden, Terugzetten; enkel als je een lijst beheert).

**Lijsten** (`/lijsten`, ook via ⋯ → Verbanden van een lijst): zie [Lijsten](#lijsten-listspage); `PageHead`, de filters, Werkt niet voor iedereen,
Kaart of Lijst, en de kaart van wat je kiest; zie [Verbanden](#verbanden-linkmapview-linklist-linkdetail-linkproblems-linkmaptsx-en-listspage).

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
- Geen donkere modus (bewuste keuze: Heystack is wit).
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
