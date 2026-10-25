import assert from "node:assert/strict";
import { test } from "node:test";
import { addToDate, aggregate, between, checkCalcs, computeLocal, type CalcList } from "../shared/calc.ts";
import type { FieldDef } from "../shared/fields.ts";

const wine: FieldDef[] = [
  { key: "aantal", label: "Aantal", type: "number" },
  { key: "prijs", label: "Prijs", type: "money" },
  { key: "jaargang", label: "Jaargang", type: "year" },
  { key: "minimum", label: "Bijna op onder", type: "number" },
  { key: "gekocht", label: "Gekocht op", type: "date" },
  { key: "elke", label: "Herhaling", type: "interval" },
  { key: "naam", label: "Notitie", type: "text" },
  { key: "totaal", label: "Totaal", type: "calc", calc: { kind: "math", op: "*", a: { field: "aantal" }, b: { field: "prijs" } } },
  { key: "btw", label: "Met btw", type: "calc", calc: { kind: "math", op: "*", a: { field: "totaal" }, b: { value: 1.21 } } },
  { key: "op", label: "Bijna op", type: "calc", calc: { kind: "compare", op: "<=", a: { field: "aantal" }, b: { field: "minimum" } } },
  { key: "oud", label: "Leeftijd", type: "calc", calc: { kind: "since", field: "jaargang", unit: "year" } },
  { key: "tot", label: "Dagen tot", type: "calc", calc: { kind: "days_until", field: "volgende" } },
  { key: "volgende", label: "Volgende keer", type: "calc", calc: { kind: "date_add", field: "gekocht", add: { field: "elke" } } },
  { key: "plus5", label: "Plus 5", type: "calc", calc: { kind: "math", op: "+", a: { field: "prijs" }, b: { value: 5 } } },
];

test("berekeningen nakijken: de uitkomst en een eenheid", () => {
  const out = checkCalcs(wine, [], "self");
  const r = Object.fromEntries(out.filter((f) => f.type === "calc").map((f) => [f.key, f.result]));
  assert.deepEqual(r, { totaal: "money", btw: "money", op: "bool", oud: "number", tot: "number", volgende: "date", plus5: "money" });
  assert.equal(out.find((f) => f.key === "tot")!.unit, "dagen");
  assert.equal(out.find((f) => f.key === "oud")!.unit, "jaar");
});

test("berekeningen nakijken: fouten met uitleg", () => {
  const bad =
    (calc: object, extra: FieldDef[] = []) =>
    () =>
      checkCalcs([...wine.slice(0, 7), ...extra, { key: "x", label: "X", type: "calc", calc } as FieldDef], [], "self");
  assert.throws(bad({ kind: "math", op: "*", a: { field: "naam" }, b: { value: 2 } }), /Notitie.*geen getal/);
  assert.throws(bad({ kind: "math", op: "^", a: { field: "aantal" }, b: { value: 2 } }), /bewerking/);
  assert.throws(bad({ kind: "math", op: "+", a: { field: "weg" }, b: { value: 2 } }), /bestaat niet/);
  assert.throws(bad({ kind: "math", op: "+", a: { field: "x" }, b: { value: 2 } }), /zichzelf/);
  assert.throws(bad({ kind: "days_until", field: "aantal" }), /geen datum/);
  assert.throws(bad({ kind: "date_add", field: "gekocht", add: { field: "aantal" } }), /Herhaling/);
  assert.throws(bad({ kind: "date_add", field: "gekocht", add: { n: 0, unit: "day" } }), /hoeveel tijd/);
  assert.throws(bad({ kind: "magie" }), /uitrekent/);
  // Een kring: a gebruikt b, b gebruikt a.
  assert.throws(
    () =>
      checkCalcs(
        [
          { key: "n", label: "N", type: "number" },
          { key: "a", label: "A", type: "calc", calc: { kind: "math", op: "+", a: { field: "b" }, b: { value: 1 } } },
          { key: "b", label: "B", type: "calc", calc: { kind: "math", op: "+", a: { field: "a" }, b: { value: 1 } } },
        ],
        [],
        "self",
      ),
    /kring/,
  );
});

test("uitrekenen binnen een item", () => {
  const defs = checkCalcs(wine, [], "self");
  const out = computeLocal(defs, { aantal: 6, prijs: 1250, jaargang: 2016, minimum: 6, gekocht: "2026-01-31", elke: { n: 1, unit: "month" } }, "2026-02-10");
  assert.equal(out.totaal, 7500);
  assert.equal(out.btw, 9075);
  assert.equal(out.op, true);
  assert.equal(out.oud, 10);
  assert.equal(out.volgende, "2026-02-28");
  assert.equal(out.tot, 18);
  // Een getal bij een bedrag optellen is in euro.
  assert.equal(out.plus5, 1750);
  // Wat ontbreekt, blijft leeg; delen door nul ook.
  const empty = computeLocal(defs, { aantal: 6 }, "2026-02-10");
  assert.equal(empty.totaal, undefined);
  assert.equal(empty.op, undefined);
  const div = checkCalcs(
    [
      { key: "a", label: "A", type: "number" },
      { key: "b", label: "B", type: "number" },
      { key: "c", label: "C", type: "calc", calc: { kind: "math", op: "/", a: { field: "a" }, b: { field: "b" } } },
    ],
    [],
    "s",
  );
  assert.equal(computeLocal(div, { a: 1, b: 0 }).c, undefined);
  assert.equal(computeLocal(div, { a: 1, b: 3 }).c, 0.333);
  // Een opgegeven waarde voor een berekening telt niet: ze wordt opnieuw uitgerekend.
  assert.equal(computeLocal(defs, { aantal: 1, prijs: 100, totaal: 999 }).totaal, 100);
});

test("datums: erbij tellen en verschil", () => {
  assert.equal(addToDate("2026-01-31", 1, "month"), "2026-02-28");
  assert.equal(addToDate("2024-01-31", 1, "month"), "2024-02-29");
  assert.equal(addToDate("2026-03-10", 2, "week"), "2026-03-24");
  assert.equal(addToDate("2026-03-10", 1, "year"), "2027-03-10");
  assert.equal(between("2026-03-10", "2026-03-20", "day"), 10);
  assert.equal(between("2026-03-20", "2026-03-10", "day"), -10);
  assert.equal(between("1990-05-20", "2026-05-19", "year"), 35);
  assert.equal(between("1990-05-20", "2026-05-20", "year"), 36);
  assert.equal(between("2026-01-31", "2026-03-01", "month"), 1);
});

test("samenvatten", () => {
  assert.equal(aggregate("count", [], 4, "number"), 4);
  assert.equal(aggregate("sum", [100, 250, "x"], 3, "money"), 350);
  assert.equal(aggregate("sum", [], 0, "money"), 0);
  assert.equal(aggregate("avg", [1, 2], 2, "number"), 1.5);
  assert.equal(aggregate("avg", [], 0, "number"), undefined);
  assert.equal(aggregate("max", ["2026-01-02", "2026-03-01", "2025-12-31"], 3, "date"), "2026-03-01");
  assert.equal(aggregate("min", [5, 2, 9], 3, "number"), 2);
});

test("opzoeken en samenvatten nakijken tegen de andere lijsten", () => {
  const vendor: CalcList = {
    id: "v",
    name: "Verkoper",
    plural: "Verkopers",
    fields: [
      { key: "land", label: "Land", type: "text" },
      { key: "eigenaar", label: "Eigenaar", type: "person" },
    ],
  };
  const expense: CalcList = {
    id: "u",
    name: "Uitgave",
    plural: "Uitgaven",
    fields: [
      { key: "bedrag", label: "Bedrag", type: "money" },
      { key: "datum", label: "Datum", type: "date" },
      { key: "verkoper", label: "Verkoper", type: "item", ref_type: "v" },
    ],
  };
  // Op een wijn: het land van het wijnhuis.
  const lookup = checkCalcs(
    [
      { key: "huis", label: "Wijnhuis", type: "item", ref_type: "v" },
      { key: "land", label: "Land", type: "calc", calc: { kind: "lookup", via: "huis", field: "land" } },
    ],
    [vendor],
    "w",
  );
  assert.equal(lookup[1].result, "text");
  assert.throws(
    () =>
      checkCalcs(
        [
          { key: "huis", label: "Wijnhuis", type: "item", ref_type: "v" },
          { key: "x", label: "X", type: "calc", calc: { kind: "lookup", via: "huis", field: "eigenaar" } },
        ],
        [vendor],
        "w",
      ),
    /niet gebruiken/,
  );
  // Op een verkoper: hoeveel je er uitgaf, en wanneer het laatst.
  const rollups = checkCalcs(
    [
      {
        key: "uitgegeven",
        label: "Uitgegeven",
        type: "calc",
        calc: { kind: "rollup", from: "backlinks", list: "u", via: "verkoper", agg: "sum", field: "bedrag" },
      },
      { key: "laatst", label: "Laatst", type: "calc", calc: { kind: "rollup", from: "backlinks", list: "u", via: "verkoper", agg: "max", field: "datum" } },
      {
        key: "aantal",
        label: "Aankopen",
        type: "calc",
        calc: { kind: "rollup", from: "backlinks", list: "u", via: "verkoper", agg: "count", field: "bedrag" },
      },
    ],
    [expense],
    "v",
  );
  assert.deepEqual(
    rollups.map((f) => f.result),
    ["money", "date", "number"],
  );
  // Hoeveel geeft geen veld nodig; het veld valt weg.
  assert.equal((rollups[2].calc as { field?: string }).field, undefined);
  // Een lijst die niet naar deze lijst verwijst, kan niet.
  assert.throws(
    () =>
      checkCalcs(
        [{ key: "x", label: "X", type: "calc", calc: { kind: "rollup", from: "backlinks", list: "u", via: "verkoper", agg: "sum", field: "bedrag" } }],
        [expense],
        "andere",
      ),
    /Verwijzing naar deze lijst/,
  );
  assert.throws(
    () =>
      checkCalcs(
        [{ key: "x", label: "X", type: "calc", calc: { kind: "rollup", from: "backlinks", list: "u", via: "verkoper", agg: "sum", field: "datum" } }],
        [expense],
        "v",
      ),
    /niet gebruiken/,
  );
});
