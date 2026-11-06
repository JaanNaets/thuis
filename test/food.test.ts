import assert from "node:assert/strict";
import { test } from "node:test";
import { foodPerPerson, gramsOf, nutritionOf, type FoodEvent, type FoodThing } from "../shared/food.ts";
import type { FieldDef } from "../shared/fields.ts";

const PRODUCT: FieldDef[] = [
  { key: "eenheid", label: "Eenheid", type: "select", options: ["stuk", "g", "kg"] },
  { key: "per_stuk", label: "Per stuk", type: "number" },
  { key: "kcal", label: "Kcal per 100 g", type: "number", product: "kcal" },
  { key: "eiwit", label: "Eiwit per 100 g", type: "number", product: "protein" },
  { key: "portie", label: "Portie", type: "number", product: "serving" },
];
const STOCK = { unit: "eenheid", piece: "per_stuk" };
const pasta: FoodThing = { fields: PRODUCT, data: { eenheid: "kg", kcal: 350, eiwit: 12 }, stock: STOCK };
const yoghurt: FoodThing = { fields: PRODUCT, data: { eenheid: "stuk", per_stuk: 125, kcal: 80 }, stock: STOCK };
const KCAL: FieldDef[] = [{ key: "kcal", label: "Kcal", type: "number", product: "kcal" }];

const eaten = (o: Partial<FoodEvent>): FoodEvent => ({ base: "gebruik", status: "gebeurd", split: null, created_by: "jana", fields: KCAL, data: {}, lines: [], ...o });

test("gram van een lijn, met de eenheid van het ding", () => {
  assert.equal(gramsOf(300, "g", pasta), 300);
  assert.equal(gramsOf(0.3, null, pasta), 300);
  assert.equal(gramsOf(2, null, yoghurt), 250);
  // Stuks zonder inhoud per stuk of portie: niet te zeggen.
  assert.equal(gramsOf(2, "stuk", { fields: PRODUCT, data: { kcal: 100 }, stock: STOCK }), null);
});

test("kcal uit de dingen die eraf gingen, of zelf ingevuld", () => {
  const meal = eaten({ lines: [{ role: "uit", amount: 300, unit: "g", thing: pasta }, { role: "uit", amount: 1, unit: null, thing: yoghurt }] });
  assert.deepEqual(nutritionOf(meal), { kcal: 1150, protein: 36 });
  // Wat je zelf invult, wint.
  assert.deepEqual(nutritionOf(eaten({ data: { kcal: 450 } })), { kcal: 450 });
  // Een aankoop of iets gepland is geen eten.
  assert.equal(nutritionOf(eaten({ base: "aankoop", data: { kcal: 450 } })), null);
  assert.equal(nutritionOf(eaten({ status: "gepland", data: { kcal: 450 } })), null);
});

test("per persoon: wie at, volgens de verdeling", () => {
  const meal = eaten({
    split: [
      { person_id: "jana", share: 50 },
      { person_id: "jaan", share: 50 },
    ],
    lines: [{ role: "uit", amount: 300, unit: "g", thing: pasta }],
  });
  const per = foodPerPerson([meal, eaten({ data: { kcal: 200 } })]);
  assert.deepEqual(per.get("jaan"), { kcal: 525, protein: 18 });
  assert.deepEqual(per.get("jana"), { kcal: 725, protein: 18 });
});
