import assert from "node:assert/strict";
import { test } from "node:test";
import { foodPerPerson, gramsOf, isFood, nutritionOf, type FoodEvent, type FoodItem } from "../shared/food.ts";
import type { FieldDef } from "../shared/fields.ts";

const PRODUCT: FieldDef[] = [
  { key: "eenheid", label: "Eenheid", type: "select", options: ["stuk", "g", "kg"] },
  { key: "per_stuk", label: "Per stuk", type: "number" },
  { key: "kcal", label: "Kcal per 100 g", type: "number", product: "kcal" },
  { key: "eiwit", label: "Eiwit per 100 g", type: "number", product: "protein" },
  { key: "portie", label: "Portie", type: "number", product: "serving" },
];
const STOCK = { unit: "eenheid", piece: "per_stuk" };
const pasta: FoodItem = { fields: PRODUCT, data: { eenheid: "kg", kcal: 350, eiwit: 12 }, stock: STOCK };
const yoghurt: FoodItem = { fields: PRODUCT, data: { eenheid: "stuk", per_stuk: 125, kcal: 80 }, stock: STOCK };
const KCAL: FieldDef[] = [{ key: "kcal", label: "Kcal", type: "number", product: "kcal" }];

const eaten = (o: Partial<FoodEvent>): FoodEvent => ({ eats: true, status: "gebeurd", split: null, created_by: "jana", fields: KCAL, data: {}, lines: [], ...o });

test("gram van een lijn, met de eenheid van het item", () => {
  assert.equal(gramsOf(300, "g", pasta), 300);
  assert.equal(gramsOf(0.3, null, pasta), 300);
  assert.equal(gramsOf(2, null, yoghurt), 250);
  // Stuks zonder inhoud per stuk of portie: niet te zeggen.
  assert.equal(gramsOf(2, "stuk", { fields: PRODUCT, data: { kcal: 100 }, stock: STOCK }), null);
});

test("kcal uit de items die eraf gingen, of zelf ingevuld", () => {
  const meal = eaten({ lines: [{ amount: 300, unit: "g", item: pasta }, { amount: 1, unit: null, item: yoghurt }] });
  assert.deepEqual(nutritionOf(meal), { kcal: 1150, protein: 36 });
  // Wat je zelf invult, wint.
  assert.deepEqual(nutritionOf(eaten({ data: { kcal: 450 } })), { kcal: 450 });
  // Een aankoop of iets gepland is geen eten.
  assert.equal(nutritionOf(eaten({ eats: false, data: { kcal: 450 } })), null);
  assert.equal(nutritionOf(eaten({ status: "gepland", data: { kcal: 450 } })), null);
});

test("per persoon: wie at, volgens de verdeling", () => {
  const meal = eaten({
    split: [
      { person_id: "jana", share: 50 },
      { person_id: "jaan", share: 50 },
    ],
    lines: [{ amount: 300, unit: "g", item: pasta }],
  });
  const per = foodPerPerson([meal, eaten({ data: { kcal: 200 } })]);
  assert.deepEqual(per.get("jaan"), { kcal: 525, protein: 18 });
  assert.deepEqual(per.get("jana"), { kcal: 725, protein: 18 });
});

test("eten is een gebruik met kcal (in de soort of in het item), geen pellets", () => {
  const kcal: FieldDef = { key: "kcal", label: "Kcal", type: "number", product: "kcal" };
  const pellets = { fields: [], data: {}, stock: null };
  const pasta = { fields: [kcal], data: { kcal: 350 }, stock: null };
  assert.equal(isFood({ eats: true, fields: [], lines: [{ amount: 1, unit: "zak", item: pellets }] }), false);
  assert.equal(isFood({ eats: true, fields: [], lines: [{ amount: 300, unit: "g", item: pasta }] }), true);
  assert.equal(isFood({ eats: true, fields: [kcal], lines: [] }), true);
  assert.equal(isFood({ eats: false, fields: [kcal], lines: [] }), false);
});

test("een formulier eet: zonder geld, en het trekt af van de voorraad of heeft kcal", async () => {
  const { baseKind } = await import("../shared/model.ts");
  const { formEats, eatenRoles } = await import("../shared/food.ts");
  assert.equal(formEats(baseKind("gebruik")), true);
  assert.deepEqual(eatenRoles(baseKind("gebruik")), ["uit"]);
  assert.equal(formEats(baseKind("aankoop")), false);
  assert.equal(formEats({ ...baseKind("meting"), fields: [{ key: "kcal", label: "Kcal", type: "number", product: "kcal" }] }), true);
  assert.equal(formEats({ ...baseKind("aankoop"), fields: [{ key: "kcal", label: "Kcal", type: "number", product: "kcal" }] }), false);
});
