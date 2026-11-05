// Meteen ook: een aankoop met Gegeten aan maakt ook een item in Eten.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanFields, type FieldDef } from "../shared/fields.ts";
import { listLinks } from "../shared/links.ts";
import { spawnData, spawnFields, type SpawnProduct } from "../shared/spawn.ts";

const uitgave = cleanFields([
  { key: "bedrag", label: "Bedrag", type: "money" },
  { key: "datum", label: "Datum", type: "date" },
  { key: "wat", label: "Wat", type: "item", ref_type: "voorraad", adjust: { field: "aantal", by: "hoeveel", sign: 1, unit_by: "eenheid" } },
  { key: "hoeveel", label: "Hoeveel", type: "number" },
  { key: "eenheid", label: "Eenheid", type: "select", options: ["stuk", "g", "kg"] },
  { key: "gegeten", label: "Gegeten", type: "bool", spawn: ["eten-jaan", "eten-jana", "eten-jaan"] },
]);
const eten: FieldDef[] = [
  { key: "datum", label: "Datum", type: "date" },
  { key: "voorraad", label: "Uit voorraad", type: "item", ref_type: "voorraad", copy: true, adjust: { field: "aantal", by: "gram", unit: "g", sign: -1 } },
  { key: "kcal_100", label: "kcal per 100 g", type: "number", product: "kcal" },
  { key: "gram", label: "Hoeveel", type: "number", unit: "g" },
  { key: "kcal", label: "Kcal", type: "calc", calc: { kind: "formula", expr: "[kcal_100] * [gram] / 100" } },
];
const yoghurt: SpawnProduct = {
  id: "y1",
  type_id: "voorraad",
  fields: [
    { key: "aantal", label: "Aantal", type: "number", counter: true, measure: { unit: "eenheid", piece: "inhoud" } },
    { key: "eenheid", label: "Eenheid", type: "select", options: ["stuk", "kg"] },
    { key: "inhoud", label: "Inhoud per stuk", type: "number", unit: "g" },
    { key: "kcal_100", label: "kcal per 100 g", type: "number", product: "kcal" },
  ],
  data: { aantal: 4, eenheid: "stuk", inhoud: 125, kcal_100: 60 },
};

test("Meteen ook: enkel lijsten bij een ja/nee, zonder dubbels", () => {
  assert.deepEqual(uitgave.find((f) => f.key === "gegeten")?.spawn, ["eten-jaan", "eten-jana"]);
  assert.equal(cleanFields([{ key: "x", label: "X", type: "text", spawn: ["a"] }])[0].spawn, undefined);
  assert.equal(spawnFields(uitgave, { gegeten: false }).length, 0);
  assert.equal(spawnFields(uitgave, { gegeten: true }).length, 1);
});

test("Een gekochte yoghurt, meteen gegeten: datum, product, voedingswaarde en 125 g", () => {
  const made = spawnData({ fields: uitgave, data: { bedrag: 89, datum: "2026-11-05", wat: "y1", hoeveel: 1, eenheid: "stuk", gegeten: true }, name: "Yoghurt" }, eten, new Map([["y1", yoghurt]]));
  assert.deepEqual(made, { name: "Yoghurt", data: { datum: "2026-11-05", voorraad: "y1", kcal_100: 60, gram: 125 } });
});

test("Een broodje zonder product: enkel de naam en de datum", () => {
  const made = spawnData({ fields: uitgave, data: { bedrag: 350, datum: "2026-11-05", gegeten: true }, name: "Broodje kaas" }, eten, new Map());
  assert.deepEqual(made, { name: "Broodje kaas", data: { datum: "2026-11-05" } });
});

test("Verbanden: Meteen ook toont een verband naar de andere lijst", () => {
  const links = listLinks({ id: "uitgaven", fields: uitgave, totals: [] });
  assert.ok(links.some((l) => l.to === "eten-jaan" && l.texts[0].includes("Gegeten")));
});
