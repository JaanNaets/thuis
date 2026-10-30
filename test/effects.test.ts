import assert from "node:assert/strict";
import { test } from "node:test";
import { effectsOf, netEffects, parseApplied } from "../shared/effects.ts";
import { cleanFields, type FieldDef } from "../shared/fields.ts";

// Eten uit de voorraad: − gram ÷ inhoud van het product. Een winkellijst: + aantal als gekocht.
const eten: FieldDef[] = [
  { key: "voorraad", label: "Uit voorraad", type: "item", ref_type: "voorraad", adjust: { field: "aantal", by: "stuks", sign: -1 } },
  { key: "gram", label: "Hoeveel", type: "number" },
  { key: "stuks", label: "Stuks", type: "calc", result: "number", calc: { kind: "formula", expr: "[gram] / 400" } },
];
const winkel: FieldDef[] = [
  { key: "product", label: "Product", type: "item", ref_type: "voorraad", adjust: { field: "aantal", by: "binnen", sign: 1 } },
  { key: "binnen", label: "Binnen", type: "calc", result: "number", calc: { kind: "formula", expr: "als([gekocht]; [aantal]; 0)" } },
];

test("tellen: wat een item aan een ander doet", () => {
  assert.deepEqual(effectsOf(eten, { voorraad: "nutella", gram: 30, stuks: 0.075 }), [{ target: "nutella", field: "aantal", delta: -0.075 }]);
  assert.deepEqual(effectsOf(eten, { gram: 30, stuks: 0.075 }), []);
  assert.deepEqual(effectsOf(winkel, { product: "melk", binnen: 0 }), []);
  assert.deepEqual(effectsOf(winkel, { product: "melk", binnen: 3 }), [{ target: "melk", field: "aantal", delta: 3 }]);
  // Zonder "met": telkens één.
  assert.deepEqual(effectsOf([{ key: "p", label: "P", type: "item", adjust: { field: "aantal", sign: -1 } }], { p: "x" }), [{ target: "x", field: "aantal", delta: -1 }]);
});

test("tellen: bij wijzigen enkel het verschil, bij verwijderen terug", () => {
  const before = [{ target: "melk", field: "aantal", delta: 3 }];
  // Afgevinkt → niet meer gekocht: drie eraf.
  assert.deepEqual(netEffects(before, []), [{ target: "melk", field: "aantal", delta: -3 }]);
  // 3 → 4 stuks: één erbij.
  assert.deepEqual(netEffects(before, [{ target: "melk", field: "aantal", delta: 4 }]), [{ target: "melk", field: "aantal", delta: 1 }]);
  // Niets veranderd: niets te doen (en dus ook geen rechten nodig).
  assert.deepEqual(netEffects(before, before), []);
  // Een ander product gekozen: het oude terug, het nieuwe erbij.
  assert.deepEqual(netEffects(before, [{ target: "kaas", field: "aantal", delta: 3 }]), [
    { target: "melk", field: "aantal", delta: -3 },
    { target: "kaas", field: "aantal", delta: 3 },
  ]);
  assert.deepEqual(parseApplied('[{"target":"a","field":"b","delta":1},{"x":1}]'), [{ target: "a", field: "b", delta: 1 }]);
  assert.deepEqual(parseApplied("kapot"), []);
});

test("tellen: enkel bij een verwijzing, met een getal of berekening van deze lijst", () => {
  const clean = cleanFields([
    { key: "a", label: "A", type: "item", ref_type: "x", adjust: { field: "aantal", by: "n", sign: -1 } },
    { key: "b", label: "B", type: "item", ref_type: "x", adjust: { field: "aantal", by: "tekst", sign: 1 } },
    { key: "c", label: "C", type: "text", adjust: { field: "aantal", sign: 1 } },
    { key: "d", label: "D", type: "item", ref_type: "x", adjust: { field: "aantal", sign: 2 } },
    { key: "n", label: "N", type: "number" },
    { key: "tekst", label: "Tekst", type: "text" },
  ]);
  assert.deepEqual(
    clean.slice(0, 4).map((f) => f.adjust),
    [{ field: "aantal", by: "n", sign: -1 }, { field: "aantal", sign: 1 }, undefined, undefined],
  );
});
