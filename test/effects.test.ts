import assert from "node:assert/strict";
import { test } from "node:test";
import { convertEffects, effectsOf, netEffects, parseApplied } from "../shared/effects.ts";
import { cleanFields, cleanValue, formatFieldValue, type FieldDef } from "../shared/fields.ts";

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

test("tellen in eenheden: 500 g van een voorraad in kg, 30 g van een pot van 400 g", () => {
  const eten2: FieldDef[] = [
    { key: "voorraad", label: "Uit voorraad", type: "item", ref_type: "voorraad", adjust: { field: "aantal", by: "gram", sign: -1, unit: "g" } },
    { key: "gram", label: "Hoeveel", type: "number", unit: "g" },
  ];
  const raw = effectsOf(eten2, { voorraad: "aardappelen", gram: 500 });
  assert.deepEqual(raw, [{ target: "aardappelen", field: "aantal", delta: -500, unit: "g" }]);
  const measures: Record<string, { unit: string; piece?: number }> = { aardappelen: { unit: "kg" }, nutella: { unit: "pot", piece: 400 } };
  assert.deepEqual(
    convertEffects(raw, (t) => measures[t]),
    [{ target: "aardappelen", field: "aantal", delta: -0.5 }],
  );
  assert.deepEqual(
    convertEffects(effectsOf(eten2, { voorraad: "nutella", gram: 30 }), (t) => measures[t]),
    [{ target: "nutella", field: "aantal", delta: -0.075 }],
  );
  // Een onbekend item: zoals het staat (zonder eenheid in wat bewaard wordt).
  assert.deepEqual(convertEffects(raw, () => undefined), [{ target: "aardappelen", field: "aantal", delta: -500 }]);
  // De eenheid en wat telt, blijven over bij het nakijken van de velden.
  const clean = cleanFields([
    { key: "aantal", label: "Aantal", type: "number", counter: true, measure: { unit: "eenheid", piece: "inhoud", pack: "eenheid" } },
    { key: "eenheid", label: "Eenheid", type: "select", options: ["kg", "stuk"] },
    { key: "inhoud", label: "Inhoud per stuk", type: "number" },
  ]);
  // Een verpakking moet een getal zijn: "eenheid" (een keuze) valt weg.
  assert.deepEqual(clean[0].measure, { unit: "eenheid", piece: "inhoud" });
  assert.deepEqual(cleanFields(eten2)[0].adjust, { field: "aantal", by: "gram", sign: -1, unit: "g" });
});

test("hoeveelheden: een recept dat je at, trekt elk ingrediënt af in zijn eigen eenheid", () => {
  const maaltijd = cleanFields([
    { key: "porties", label: "Porties", type: "number" },
    { key: "ingredienten", label: "Ingrediënten", type: "amounts", ref_type: "voorraad", per: "porties", adjust: { field: "aantal", sign: -1, by: "porties" } },
  ]);
  // Bij hoeveelheden telt elke regel zelf: "met" valt weg; `per` blijft (een getal van deze lijst).
  assert.deepEqual(maaltijd[1].adjust, { field: "aantal", sign: -1 });
  assert.equal(maaltijd[1].per, "porties");
  const value = cleanValue(maaltijd[1], [
    { item: "aardappelen", amount: 800, unit: "G" },
    { text: " zout " },
    { item: "ui", amount: 2, unit: "stuk" },
    { amount: 3 },
    "rommel",
  ]);
  assert.deepEqual(value, [
    { item: "aardappelen", amount: 800, unit: "g" },
    { text: "zout" },
    { item: "ui", amount: 2, unit: "stuk" },
  ]);
  const effects = effectsOf(maaltijd, { porties: 4, ingredienten: value! });
  assert.deepEqual(effects, [
    { target: "aardappelen", field: "aantal", delta: -800, unit: "g" },
    { target: "ui", field: "aantal", delta: -2, unit: "stuk" },
  ]);
  const measures: Record<string, { unit: string; piece?: number }> = { aardappelen: { unit: "kg" }, ui: { unit: "kg", piece: 150 } };
  assert.deepEqual(
    convertEffects(effects, (t) => measures[t]),
    [
      { target: "aardappelen", field: "aantal", delta: -0.8 },
      { target: "ui", field: "aantal", delta: -0.3 },
    ],
  );
  const names = { person: () => "", item: (id: string) => ({ aardappelen: "Aardappelen", ui: "Ui" })[id] ?? "?" };
  assert.equal(formatFieldValue(maaltijd[1], value!, names), "800 g Aardappelen, zout, 2 stuks Ui");
  // Zonder lijst: enkel tekst.
  assert.deepEqual(cleanFields([{ key: "i", label: "Ingrediënten", type: "amounts" }]), [{ key: "i", label: "Ingrediënten", type: "amounts" }]);
});
