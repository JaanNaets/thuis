import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldDef } from "../shared/fields.ts";
import {
  BLOCK_LINKS,
  buildLinks,
  EVENT_LINKS,
  FIELD_LINKS,
  KIND_LINKS,
  LINE_LINKS,
  LIST_LINKS,
  linkProblems,
  viewNode,
  type Link,
  type LinkInput,
  type LinkList,
  type LogStat,
} from "../shared/links.ts";

const list = (id: string, extra: Partial<LinkList> = {}): LinkList => ({ id, name: id, fields: [], stock: null, notify: null, role: "beheerder", ...extra });
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
  assert.deepEqual(own.B, ["Gebruik: eraf (gaat af van de voorraad), 3×"]);
  assert.deepEqual(links.find((l) => l.kind === "log" && l.to === "B")?.texts, ["Gebruik: eraf (gaat af van de voorraad), 1×"]);
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
