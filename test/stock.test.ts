import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanStock, stockLevel, unitPrice, type StockLine } from "../shared/stock.ts";
import type { FieldDef } from "../shared/fields.ts";

const FIELDS: FieldDef[] = [
  { key: "eenheid", label: "Eenheid", type: "select", options: ["stuk", "kg", "l"] },
  { key: "per_stuk", label: "Per stuk", type: "number", unit: "g" },
  { key: "verpakking", label: "Verpakking", type: "number" },
  { key: "verpakking_naam", label: "Verpakking heet", type: "text" },
  { key: "minimum", label: "Minimum", type: "number" },
  { key: "notitie", label: "Notitie", type: "longtext" },
];
const DEF = cleanStock({ unit: "eenheid", piece: "per_stuk", pack: "verpakking", pack_name: "verpakking_naam", min: "minimum", default_unit: "Stuks" }, FIELDS)!;

let n = 0;
const line = (at: string, base: StockLine["base"], role: StockLine["role"], amount: number | null, unit: string | null = null, extra: Partial<StockLine> = {}): StockLine => ({
  at,
  created_at: `2026-01-01 00:00:${String(n++).padStart(2, "0")}`,
  base,
  status: "gebeurd",
  role,
  amount,
  unit,
  expires: null,
  ...extra,
});

test("stock nakijken: enkel velden van de lijst met de juiste soort", () => {
  assert.deepEqual(DEF, { unit: "eenheid", piece: "per_stuk", pack: "verpakking", pack_name: "verpakking_naam", min: "minimum", default_unit: "stuk" });
  assert.deepEqual(cleanStock({ unit: "notitie", min: "eenheid", piece: "bestaat_niet" }, FIELDS), {});
  assert.equal(cleanStock(null, FIELDS), null);
});

test("voorraad: telling, erbij en eraf, omgerekend naar de eenheid van het ding", () => {
  const aardappelen = { eenheid: "kg", verpakking: 5, verpakking_naam: "zak", minimum: 2 };
  const level = stockLevel(DEF, aardappelen, [
    line("2026-11-01", "meting", "voor", 1),
    line("2026-11-02", "aankoop", "in", 1, "zak"),
    line("2026-11-03", "gebruik", "uit", 500, "g"),
    line("2026-11-04", "gebruik", "uit", 3),
  ]);
  assert.deepEqual(level, { amount: 2.5, unit: "kg", low: false, expires: null });
  // Een latere telling wist wat ervoor kwam.
  const recount = stockLevel(DEF, aardappelen, [line("2026-11-01", "aankoop", "in", 10), line("2026-11-05", "meting", "voor", 1.5)]);
  assert.deepEqual(recount, { amount: 1.5, unit: "kg", low: true, expires: null });
});

test("geplande en afgevinkte boodschappen tellen niet", () => {
  const level = stockLevel(DEF, { eenheid: "l" }, [
    line("2026-11-01", "aankoop", "in", 2, "l", { status: "gepland" }),
    line("2026-11-01", "aankoop", "in", 2, "l", { status: "afgevinkt" }),
    line("2026-11-02", "aankoop", "in", 1, "l"),
  ]);
  assert.equal(level.amount, 1);
});

test("in eender welke volgorde, en een stuk met inhoud per stuk", () => {
  const yoghurt = { eenheid: "stuk", per_stuk: 125 };
  const lines = [line("2026-11-03", "gebruik", "uit", 250, "g"), line("2026-11-01", "aankoop", "in", 6)];
  assert.equal(stockLevel(DEF, yoghurt, lines).amount, 4);
  // Zonder eenheid op het ding: de standaard van de lijst (stuk).
  assert.equal(stockLevel(DEF, {}, [line("2026-11-01", "aankoop", "in", 3)]).unit, "stuk");
});

test("wat het eerst vervalt: de oudste partij gaat eerst op", () => {
  const level = stockLevel(DEF, { eenheid: "stuk" }, [
    line("2026-11-01", "aankoop", "in", 2, null, { expires: "2026-11-10" }),
    line("2026-11-03", "aankoop", "in", 4, null, { expires: "2026-11-20" }),
    line("2026-11-04", "gebruik", "uit", 2),
  ]);
  assert.deepEqual(level, { amount: 4, unit: "stuk", low: false, expires: "2026-11-20" });
});

test("meer eraf dan er was: onder nul, en dus op", () => {
  const level = stockLevel(DEF, { eenheid: "stuk" }, [line("2026-11-01", "aankoop", "in", 1), line("2026-11-02", "gebruik", "uit", 3)]);
  assert.equal(level.amount, -2);
  assert.equal(level.low, true);
});

test("prijs per eenheid van het ding", () => {
  assert.equal(unitPrice(600, 6, "stuk", { unit: "stuk" }), 100);
  assert.equal(unitPrice(499, 5, "kg", { unit: "kg" }), 100);
  assert.equal(unitPrice(299, 750, "g", { unit: "kg" }), 399);
  assert.equal(unitPrice(null, 2, null, { unit: "kg" }), null);
});
