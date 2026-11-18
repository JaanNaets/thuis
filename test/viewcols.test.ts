import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateView, type ViewBlock } from "../shared/blocks.ts";
import type { FieldDef } from "../shared/fields.ts";
import { aggregateCols, calcsFor, cleanCols, colFields, coupleRow, sameField, withCols, type ViewCol } from "../shared/viewcols.ts";

const FIELDS: FieldDef[] = [
  { key: "at", label: "Datum", type: "date" },
  { key: "bedrag", label: "Bedrag", type: "money" },
  { key: "liter", label: "Liter", type: "number" },
  { key: "wagen", label: "Wagen", type: "select", options: ["Fiat", "Volvo"] },
];
const row = (id: string, at: string, bedrag: number, liter: number, wagen: string) => ({ id, name: id, data: { at, bedrag, liter, wagen }, tag_ids: [] as string[], created_at: `${at} 12:00:00` });
const ROWS = [row("a", "2026-10-28", 6000, 40, "Fiat"), row("b", "2026-11-03", 7500, 50, "Volvo"), row("c", "2026-11-12", 4500, 30, "Fiat")];
const COLS: ViewCol[] = [
  { key: "bedrag", field: "bedrag", calc: "sum" },
  { key: "liter", field: "liter", calc: "sum" },
  { key: "f1", formula: "[bedrag] / [liter]", calc: "toon", label: "Per liter" },
  { key: "at", field: "at", calc: "range" },
];

test("kolommen nakijken: een formule enkel met kolommen ervoor; koppelen per lijst", () => {
  const cols = cleanCols([
    { key: "bedrag", field: "bedrag", calc: "sum" },
    { key: "f1", formula: "[bedrag] * 2", calc: "toon" },
    { key: "f2", formula: "[later] + 1", calc: "toon" },
    { key: "f3", formula: "[bedrag] *", calc: "toon" },
    { key: "bedrag", field: "liter", calc: "sum" },
    { key: "prijs", field: "prijs", calc: "nonsens", from: { "lijst-b": "kost", "../x": "y" } },
  ]);
  assert.deepEqual(
    cols.map((c) => [c.key, c.calc, c.formula ?? c.field, c.from ?? null]),
    [
      ["bedrag", "sum", "bedrag", null],
      ["f1", "toon", "[bedrag] * 2", null],
      ["prijs", "toon", "prijs", { "lijst-b": "kost" }],
    ],
  );
  // Wat kan met welke soort: tellen met getallen, van–tot ook met datums.
  assert.deepEqual(calcsFor("text"), ["toon", "count"]);
  assert.ok(calcsFor("date").includes("range") && !calcsFor("date").includes("sum"));
});

test("een formule per rij en op de totalen: €/l per tankbeurt en over alles, van–tot van de datums", () => {
  const defs = colFields(COLS, FIELDS);
  // Bedrag gedeeld door liter is een bedrag (per liter).
  assert.equal(defs[2]?.type, "money");
  const rows = withCols(ROWS, COLS, defs);
  assert.deepEqual(
    rows.map((r) => r.data.f1),
    [150, 150, 150],
  );
  const total = aggregateCols(COLS, defs, rows);
  assert.deepEqual(total, { bedrag: 18000, liter: 120, f1: 150, at: ["2026-10-28", "2026-11-12"] });
  // Een formule per rij en dan opgeteld ([Prijs] × [Hoeveel]), tegenover op de totalen.
  const product: ViewCol[] = [{ key: "bedrag", field: "bedrag", calc: "toon" }, { key: "liter", field: "liter", calc: "toon" }, { key: "f1", formula: "[bedrag] * [liter]", calc: "sum" }];
  const pd = colFields(product, FIELDS);
  assert.equal(aggregateCols(product, pd, withCols(ROWS, product, pd)).f1, 6000 * 40 + 7500 * 50 + 4500 * 30);
});

test("koppelen over lijsten: hetzelfde veld op naam en soort, of per lijst een ander veld", () => {
  assert.ok(sameField({ key: "prijs", label: "Prijs", type: "money" }, { key: "prijs_2", label: " prijs", type: "money" }));
  assert.ok(!sameField({ key: "prijs", label: "Prijs", type: "money" }, { key: "prijs_2", label: "Prijs", type: "number" }));
  const cols: ViewCol[] = [{ key: "prijs", field: "prijs", calc: "sum", from: { kelder: "kost" } }];
  assert.deepEqual(coupleRow({ kost: 900 }, "kelder", cols, new Map()), { kost: 900, prijs: 900 });
  assert.deepEqual(coupleRow({ prijs_2: 700 }, "wijnen", cols, new Map([["prijs_2", "prijs"]])), { prijs_2: 700, prijs: 700 });
});

const ctx = { today: "2026-11-18", me: "jaan", names: { person: () => "", item: () => "" }, chart: { people: [], item: () => undefined, tags: [] } };
const block = (patch: Partial<ViewBlock>): ViewBlock => ({ kind: "view", name: "", source: "items", lists: ["x"], where: { match: "all", conditions: [] }, show: "tabel", date: "at", cols: COLS, ...patch });

test("een tabel met kolommen die samen tellen: de totaalrij, of een rij per maand", () => {
  const plain = evaluateView(block({}), FIELDS, ROWS, ctx);
  assert.equal(plain.rows.length, 3);
  assert.equal(plain.summary?.total.bedrag, 18000);
  const perMonth = evaluateView(block({ group: { field: "at", step: "month" } }), FIELDS, ROWS, ctx);
  assert.equal(perMonth.rows.length, 0);
  assert.deepEqual(
    perMonth.summary?.groups?.map((g) => [g.label, g.count, g.values.bedrag, g.values.f1]),
    [
      ["november 2026", 2, 12000, 150],
      ["oktober 2026", 1, 6000, 150],
    ],
  );
  // Per keuze (de wagen), en filteren op een formule kan ook.
  const perCar = evaluateView(block({ group: { field: "wagen" }, where: { match: "all", conditions: [{ field: "liter", op: "gt", value: 35 }] } }), FIELDS, ROWS, ctx);
  assert.deepEqual(
    perCar.summary?.groups?.map((g) => [g.label, g.values.liter]),
    [
      ["Fiat", 40],
      ["Volvo", 50],
    ],
  );
});

test("een getal of grafiek met meer kolommen: een getal per kolom, een reeks per kolom, de formule op de uitkomsten", () => {
  const number = evaluateView(block({ show: "getal", tally: { agg: "count", step: "month", n: 1 } }), FIELDS, ROWS, ctx);
  assert.equal(number.chart?.total, 12000);
  assert.deepEqual(
    number.numbers?.map((n) => [n.label, n.value, n.previous]),
    [
      ["Bedrag", 12000, 6000],
      ["Liter", 80, 40],
      ["Per liter", 150, 150],
    ],
  );
  const bars = evaluateView(block({ show: "staafjes", tally: { agg: "count", step: "month", n: 2 } }), FIELDS, ROWS, ctx);
  assert.deepEqual(
    bars.chart?.series.map((s) => [s.label, s.values]),
    [
      ["Bedrag", [6000, 12000]],
      ["Liter", [40, 80]],
      ["Per liter", [150, 150]],
    ],
  );
});
