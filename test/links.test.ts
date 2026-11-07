import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldDef } from "../shared/fields.ts";
import {
  BLOCK_LINKS,
  betweenLists,
  betweenSelection,
  buildLinks,
  EVENT_LINKS,
  FIELD_LINKS,
  KIND_LINKS,
  LINE_LINKS,
  LIST_LINKS,
  groupLinkLists,
  layoutLinks,
  lineText,
  linkKey,
  linkProblems,
  linkSummary,
  litBy,
  searchLinks,
  sortLinkLists,
  viewNode,
  viewsOf,
  type Link,
  type LinkInput,
  type LinkList,
  type LogStat,
} from "../shared/links.ts";

const list = (id: string, extra: Partial<LinkList> = {}): LinkList => ({ id, name: id, one: null, fields: [], stock: null, notify: null, role: "beheerder", ...extra });
const input = (extra: Partial<LinkInput>): LinkInput => ({ lists: [list("A"), list("B")], kinds: [], log: [], lines: [], pairs: [], boards: [], ...extra });
const stat = (extra: Partial<LogStat>): LogStat => ({ list: "A", kind: "aankoop", base: "aankoop", events: 1, money: 0, shared: 0, planned: 0, repeats: 0, running: 0, food: 0, last: null, ...extra });
const has = (links: Link[], kind: Link["kind"], from: string, to: string) => links.some((l) => l.kind === kind && l.from === from && l.to === to);

// Een voorbeeld per eigenschap van een veld die een verband maakt: een veld met (enkel) die eigenschap op lijst A, en
// het verband dat het moet geven.
const FIELD_SAMPLES: Partial<Record<keyof FieldDef, { field: FieldDef; kind: Link["kind"]; from: string; to: string }>> = {
  ref_type: { field: { key: "w", label: "Winkel", type: "item", ref_type: "B" }, kind: "ref", from: "A", to: "B" },
  ref_also: { field: { key: "w", label: "Winkel", type: "items", ref_type: "A", ref_also: ["B"] }, kind: "ref", from: "A", to: "B" },
  copy: { field: { key: "w", label: "Winkel", type: "item", ref_type: "B", copy: true }, kind: "ref", from: "A", to: "B" },
  product: { field: { key: "k", label: "Kcal", type: "number", product: "kcal" }, kind: "view", from: "A", to: viewNode("eten") },
  aliases: { field: { key: "t", label: "Op het kasticket", type: "text", aliases: true }, kind: "view", from: viewNode("kasticket"), to: "A" },
  remind: { field: { key: "d", label: "Keuring", type: "date", remind: 30 }, kind: "view", from: "A", to: viewNode("herinneringen") },
  agenda: { field: { key: "d", label: "Keuring", type: "date", agenda: true }, kind: "view", from: "A", to: viewNode("agenda") },
};

test("altijd mee: elke eigenschap van een veld die verbindt, heeft een voorbeeld en geeft een verband", () => {
  for (const [key, linked] of Object.entries(FIELD_LINKS)) {
    if (!linked) continue;
    const sample = FIELD_SAMPLES[key as keyof FieldDef];
    assert.ok(sample, `geen voorbeeld voor ${key} in FIELD_SAMPLES`);
    const { links } = buildLinks(input({ lists: [list("A", { fields: [sample.field] }), list("B")] }));
    assert.ok(has(links, sample.kind, sample.from, sample.to), `${key} geeft geen verband ${sample.from} → ${sample.to}`);
  }
});

test("altijd mee: lijsten, soorten, gebeurtenissen, lijnen en blokken", () => {
  // Lijst: voorraad en melding (velden: zie hierboven).
  const listed = buildLinks(input({ lists: [list("A", { stock: { unit: "u", min: "m" }, notify: { to: "all" } }), list("B")] })).links;
  assert.ok(has(listed, "view", "A", viewNode("voorraad")) && LIST_LINKS.stock);
  assert.ok(has(listed, "view", "A", viewNode("meldingen")) && LIST_LINKS.notify);

  // Soort: van een andere lijst gebruikt (list_id), met kcal (fields), met een doel (goal).
  const kinds = [{ id: "K", list_id: "B", base: "gebruik" as const, name: "Gegeten", fields: [{ key: "kcal", label: "Kcal", type: "number" as const, product: "kcal" as const }], goal: 960 }];
  const kinded = buildLinks(input({ kinds, log: [stat({ kind: "K", base: "gebruik", food: 2 })] })).links;
  assert.ok(KIND_LINKS.list_id && has(kinded, "log", "A", "B"), "een soort van B gebruikt in A");
  assert.ok(KIND_LINKS.fields && has(kinded, "view", "B", viewNode("eten")), "kcal in de soort");
  assert.ok(KIND_LINKS.goal && has(kinded, "view", "B", viewNode("meldingen")), "een doel op de soort");
  assert.ok(EVENT_LINKS.base && has(kinded, "view", "A", viewNode("eten")), "gebruik dat als eten telt");

  // Gebeurtenissen: bedrag, gedeeld, gepland, herhalen, loopt nog.
  const logged = buildLinks(input({ log: [stat({ money: 3, shared: 2, planned: 1, repeats: 1, running: 1 })] })).links;
  for (const [key, view] of [
    ["amount", "geld"],
    ["paid_by", "balans"],
    ["split", "balans"],
    ["to_person", "balans"],
    ["status", "tedoen"],
    ["repeat", "herhalen"],
    ["end_at", "timers"],
  ] as const) {
    assert.ok(EVENT_LINKS[key] && has(logged, "view", "A", viewNode(view)), `${key} → ${view}`);
  }
  assert.ok(has(logged, "view", "A", viewNode("agenda")) && has(logged, "view", "A", viewNode("herinneringen")), "gepland staat ook in de agenda en herinnert");

  // Lijnen: rol en ding naar een andere lijst; een lijn van één persoon telt als gedeeld (in `shared`).
  const lined = buildLinks(input({ lines: [{ list: "A", kind: "aankoop", base: "aankoop", role: "in", to: "B", events: 4, last: "2026-11-05" }], pairs: [{ list: "A", to: "B", events: 4, last: "2026-11-05" }] })).links;
  const log = lined.find((l) => l.kind === "log" && l.from === "A" && l.to === "B");
  assert.ok(LINE_LINKS.role && LINE_LINKS.thing_id && log);
  assert.equal(log!.count, 4);
  assert.equal(log!.last, "2026-11-05");
  assert.ok(LINE_LINKS.owner);

  // Blokken: wat een lijst toont, verbindt; een weergave niet.
  for (const [block, linked] of Object.entries(BLOCK_LINKS)) {
    const out = buildLinks(input({ boards: [{ board: "Overzicht", list: "A", block: block as keyof typeof BLOCK_LINKS }] })).links;
    assert.equal(has(out, "view", "A", viewNode("overzicht")), linked, block);
  }
});

test("wat je niet ziet, bestaat niet; wat in de lijst zelf blijft, is geen lijn", () => {
  const { links, own } = buildLinks(
    input({
      lists: [list("A", { fields: [{ key: "w", label: "Winkel", type: "item", ref_type: "VERBORGEN" }] }), list("B", { stock: { unit: "u" } })],
      lines: [
        { list: "A", kind: "aankoop", base: "aankoop", role: "bij", to: "VERBORGEN", events: 2, last: null },
        { list: "B", kind: "gebruik", base: "gebruik", role: "uit", to: "B", events: 3, last: null },
        { list: "A", kind: "gebruik", base: "gebruik", role: "uit", to: "B", events: 1, last: null },
      ],
    }),
  );
  assert.ok(!links.some((l) => l.to === "VERBORGEN" || l.from === "VERBORGEN"));
  assert.deepEqual(own.B, ["Gebruik haalt eraf uit de voorraad, 3×"]);
  assert.deepEqual(links.find((l) => l.kind === "log" && l.to === "B")?.texts, ["Gebruik haalt eraf uit de voorraad"]);
});

test("een lijn als gewone zin, met hoe één ding heet", () => {
  assert.equal(lineText("Tankbeurt", "voor", { one: "Wagen", stock: null }), "Tankbeurt voor een wagen");
  assert.equal(lineText("Aankoop", "bij", { one: "Winkel", stock: null }), "Aankoop bij een winkel");
  assert.equal(lineText("Aankoop", "in", { one: "Product", stock: { unit: "u" } }), "Aankoop telt erbij in de voorraad");
  assert.equal(lineText("Gegeten", "uit", { one: null, stock: { unit: "u" } }), "Gegeten haalt eraf uit de voorraad");
  assert.equal(lineText("Gebruik", "uit", { one: null, stock: null }), "Gebruik haalt een ding eraf");
});

test("de dingen van een verband: de meeste eerst, enkel bij een verband dat bestaat", () => {
  const { links } = buildLinks(
    input({
      lines: [
        {
          list: "A",
          kind: "gebruik",
          base: "gebruik",
          role: "uit",
          to: "B",
          events: 8,
          last: null,
        },
      ],
      pairs: [{ list: "A", to: "B", events: 8, last: "2026-11-05" }],
      things: [
        { list: "A", to: "B", thing: "m", name: "Melk", events: 2 },
        { list: "A", to: "B", thing: "p", name: "Pasta", events: 3 },
        { list: "A", to: "B", thing: "y", name: "Yoghurt", events: 3 },
        { list: "A", to: "VERBORGEN", thing: "x", name: "Geheim", events: 9 },
      ],
    }),
  );
  assert.deepEqual(links.find((l) => l.kind === "log")?.things, [
    { name: "Pasta", count: 3 },
    { name: "Yoghurt", count: 3 },
    { name: "Melk", count: 2 },
  ]);
  assert.ok(!JSON.stringify(links).includes("Geheim"));
});

const sample: Link[] = [
  {
    kind: "log",
    from: "J",
    to: "V",
    texts: ["Gegeten haalt eraf uit de voorraad"],
    count: 8,
    last: "2026-11-05",
    things: [{ name: "Pasta", count: 3 }],
  },
  {
    kind: "log",
    from: "V",
    to: "W",
    texts: ["Aankoop bij een winkel"],
    count: 12,
    last: "2026-11-04",
    things: [{ name: "Colruyt", count: 8 }],
  },
  {
    kind: "ref",
    from: "R",
    to: "W",
    texts: ["Plaats verwijst ernaar"],
    count: null,
    last: null,
  },
  {
    kind: "view",
    from: "J",
    to: viewNode("eten"),
    texts: ["Gegeten: 8× gegeten"],
    count: 8,
    last: null,
  },
  {
    kind: "view",
    from: "V",
    to: viewNode("geld"),
    texts: ["Aankoop: 12× met een bedrag"],
    count: 12,
    last: null,
  },
  {
    kind: "view",
    from: "J",
    to: viewNode("geld"),
    texts: ["Gegeten: 2× met een bedrag"],
    count: 2,
    last: null,
  },
];
const sampleLists = [
  { id: "J", name: "Jaan" },
  { id: "V", name: "Voorraad" },
  { id: "W", name: "Winkels en diensten" },
  { id: "R", name: "Restaurants" },
  { id: "T", name: "Taken" },
];
const sampleKinds = [
  { id: "k1", list: "J", name: "Gegeten" },
  { id: "k2", list: "ONZICHTBAAR", name: "Gegeten" },
];

test("zoeken: lijsten, formulieren, dingen, verbanden en weergaven; elk woord, zonder accenten", () => {
  const find = (q: string) => searchLinks(q, { lists: sampleLists, kinds: sampleKinds, links: sample });
  assert.deepEqual(find("  "), []);
  assert.deepEqual(
    find("voorraad").map((h) => [h.group, h.title]),
    [
      ["lijsten", "Voorraad"],
      ["verbanden", "Jaan → Voorraad"],
    ],
  );
  const gegeten = find("GEGETEN");
  assert.deepEqual(
    gegeten.map((h) => [h.group, h.title]),
    [
      ["soorten", "Gegeten"],
      ["verbanden", "Jaan → Voorraad"],
      ["weergaven", "Jaan → Geld"],
      ["weergaven", "Jaan → Eten"],
    ],
  );
  // De soort van een lijst die je niet ziet, komt niet mee; de soort licht haar lijst en waar ze gebruikt wordt op.
  const soort = gegeten.find((h) => h.group === "soorten")!;
  assert.deepEqual(soort.nodes, ["J", "V"]);
  assert.ok(soort.links.includes(linkKey(sample[0])));
  assert.equal(soort.detail, "Formulier van Jaan");
  // Een ding in een verband: kiest de lijst van het ding.
  const pasta = find("pasta");
  assert.deepEqual(
    pasta.map((h) => [h.group, h.select, h.detail]),
    [["dingen", "V", "Jaan → Voorraad · 3×"]],
  );
  // Een weergave op naam: met al haar lijsten.
  const geld = find("geld");
  assert.deepEqual(geld[0], {
    group: "weergaven",
    key: "weergave geld",
    select: viewNode("geld"),
    title: "Geld",
    detail: "Voorraad, Jaan",
    nodes: [viewNode("geld"), "V", "J"],
    links: [linkKey(sample[4]), linkKey(sample[5])],
  });
  assert.deepEqual(
    find("winkel colruyt").map((h) => h.group),
    [],
  );
  assert.deepEqual(
    find("colruyt").map((h) => h.title),
    ["Colruyt"],
  );
  const lit = litBy(find("gegeten"));
  assert.ok(lit.nodes.has("J") && lit.nodes.has("V") && !lit.nodes.has("W"));
});

test("de lijst: samenvatten, sorteren, groeperen en wat een selectie verbindt", () => {
  assert.deepEqual(linkSummary(sample, "V"), { in: 1, out: 1, views: 1 });
  assert.deepEqual(linkSummary(sample, "W"), { in: 2, out: 0, views: 0 });
  const last = (id: string) => ({ J: "2026-11-05", V: "2026-11-06" })[id] ?? null;
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
  assert.deepEqual(ids(sortLinkLists(sampleLists, "eigen", sample, last)), ["J", "V", "W", "R", "T"]);
  assert.deepEqual(ids(sortLinkLists(sampleLists, "naam", sample, last)), ["J", "R", "T", "V", "W"]);
  assert.deepEqual(ids(sortLinkLists(sampleLists, "verbanden", sample, last)), ["J", "V", "W", "R", "T"]);
  assert.deepEqual(ids(sortLinkLists(sampleLists, "laatst", sample, last)), ["V", "J", "R", "T", "W"]);

  const all = ids(sampleLists);
  assert.deepEqual(groupLinkLists(all, sample, "soort"), [
    { key: "log", name: "Logboek", ids: ["J", "V", "W"] },
    { key: "ref", name: "Verwijzingen", ids: ["W", "R"] },
    { key: "geen", name: "Geen verbanden", ids: ["T"] },
  ]);
  assert.deepEqual(groupLinkLists(all, sample, "weergave"), [
    { key: "geld", name: "Geld", ids: ["J", "V"] },
    { key: "eten", name: "Eten", ids: ["J"] },
    { key: "geen", name: "In geen weergave", ids: ["W", "R", "T"] },
  ]);

  const chosen = betweenSelection(sample, ["V", "J", "W"]);
  assert.deepEqual(chosen.links.map(linkKey), [linkKey(sample[0]), linkKey(sample[1])]);
  assert.deepEqual(chosen.views, [{ view: "geld", lists: ["V", "J"] }]);
  assert.deepEqual(betweenSelection(sample, ["J", "R"]).links, []);
});

test("problemen: wie kan bewerken maar een lijst waar het van afhangt niet ziet, enkel als je een van beide beheert", () => {
  const { links } = buildLinks(input({ lists: [list("A", { fields: [{ key: "w", label: "Winkel", type: "item", ref_type: "B" }] }), list("B")] }));
  const people = new Map([
    [
      "A",
      [
        { id: "jaan", name: "Jaan", role: "beheerder" as const },
        { id: "rik", name: "Rik", role: "lid" as const },
        { id: "kobe", name: "Kobe", role: "gast" as const },
      ],
    ],
    ["B", [{ id: "jaan", name: "Jaan", role: "beheerder" as const }]],
  ]);
  const rik = [{ list: "A", to: "B", person: "rik", name: "Rik" }];
  assert.deepEqual(linkProblems(links, people, new Set(["A"])), rik);
  assert.deepEqual(linkProblems(links, people, new Set(["B"])), rik, "wie B beheert, kan Rik erbij zetten");
  assert.deepEqual(linkProblems(links, people, new Set(["C"])), []);
});

test("de kaart: een rij per lijst waar iets toekomt, een eigen plaats als verticale lijnen elkaar raken", () => {
  const links: Link[] = [
    { kind: "log", from: "B", to: "V", texts: [], count: 3, last: null },
    { kind: "ref", from: "B", to: "V", texts: [], count: null, last: null },
    { kind: "log", from: "U", to: "V", texts: [], count: 1, last: null },
    { kind: "log", from: "U", to: "K", texts: [], count: 1, last: null },
    { kind: "ref", from: "O", to: "K", texts: [], count: null, last: null },
  ];
  const nodes = [
    { id: "B", column: "huis" },
    { id: "O", column: "huis" },
    { id: "V", column: "eten" },
    { id: "U", column: "eten" },
    { id: "K", column: "eten" },
    { id: "W", column: "eten" }, // zonder verbanden: niet op de kaart
  ];
  const layout = layoutLinks(["huis", "eten"], nodes, links);
  assert.deepEqual(
    layout.rows.map((r) => r.hub),
    ["V", "K"],
  );
  assert.deepEqual(layout.rows[0].kinds, ["ref", "log"]);
  assert.deepEqual(layout.places.get("B"), { col: 0, slot: 0, row: 0 });
  assert.deepEqual(layout.places.get("O"), { col: 0, slot: 0, row: 1 });
  assert.deepEqual(layout.places.get("V"), { col: 1, slot: 0, row: 0 });
  // U gaat naar twee rijen en raakt V: een eigen plaats.
  assert.deepEqual(layout.places.get("U"), { col: 1, slot: 1, row: 0 });
  assert.deepEqual(layout.places.get("K"), { col: 1, slot: 0, row: 1 });
  assert.equal(layout.places.has("W"), false);
  assert.deepEqual(layout.slots, [1, 2]);
  // Wat enkel in weergaven voorkomt, staat op de eerste vrije rij in zijn kolom (niet waar een spoor door loopt).
  const withAlone = layoutLinks(["huis", "eten", "elders"], [...nodes, { id: "X", column: "huis" }, { id: "Y", column: "huis" }, { id: "Z", column: "elders" }], links, ["X", "Y", "W", "Z"]);
  assert.deepEqual(withAlone.places.get("X"), { col: 0, slot: 0, row: 2 });
  assert.deepEqual(withAlone.places.get("Y"), { col: 0, slot: 0, row: 3 });
  assert.deepEqual(withAlone.places.get("W"), { col: 1, slot: 0, row: 2 });
  assert.deepEqual(withAlone.places.get("Z"), { col: 2, slot: 0, row: 0 });
  assert.deepEqual(withAlone.rows.slice(2), [
    { hub: "", kinds: [] },
    { hub: "", kinds: [] },
  ]);
  // Dezelfde lijsten geven altijd dezelfde kaart.
  const again = layoutLinks(["huis", "eten"], nodes, [...links].reverse());
  assert.deepEqual([...again.places], [...layout.places]);
  assert.deepEqual(again.rows, layout.rows);
});

test("weergaven staan bij de lijst, niet als lijn op de kaart", () => {
  const links: Link[] = [
    { kind: "view", from: "A", to: viewNode("geld"), texts: [], count: 2, last: null },
    { kind: "view", from: viewNode("productinfo"), to: "A", texts: [], count: null, last: null },
    { kind: "view", from: "A", to: viewNode("agenda"), texts: [], count: null, last: null },
    { kind: "log", from: "A", to: "B", texts: [], count: 1, last: null },
  ];
  assert.deepEqual(viewsOf(links, "A"), ["geld", "agenda", "productinfo"]);
  assert.deepEqual(
    betweenLists(links).map((l) => l.to),
    ["B"],
  );
});

