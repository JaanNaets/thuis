import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanFields } from "../shared/fields.ts";
import { fromOff } from "../shared/product.ts";
import { quickFill } from "../shared/quickfill.ts";

const fields = cleanFields([
  { key: "portie", label: "Portie", type: "number", unit: "g", product: "serving" },
  { key: "gram", label: "Hoeveel", type: "number", unit: "g", portion: "portie" },
  { key: "porties", label: "Porties", type: "number" },
]);

test("porties: een getal in porties van een ander getal van de lijst", () => {
  assert.equal(fields[1].portion, "portie");
  assert.equal(cleanFields([{ key: "a", label: "A", type: "number", portion: "a" }])[0].portion, undefined, "niet van zichzelf");
  assert.equal(cleanFields([{ key: "a", label: "A", type: "number", portion: "t" }, { key: "t", label: "T", type: "text" }])[0].portion, undefined);
});

test("snel invullen: 2 porties is 2 keer de portie, als die gekend is", () => {
  const ctx = { today: "2026-11-05", people: [], items: () => [] };
  const known = quickFill("2 porties nutella", fields, { ...ctx, values: (k) => (k === "portie" ? 15 : undefined) });
  assert.equal(known.data.gram, 30);
  assert.equal(known.data.porties, undefined);
  // Zonder gekende portie: zoals vroeger (het veld Porties).
  const unknown = quickFill("2 porties nutella", fields, ctx);
  assert.equal(unknown.data.gram, undefined);
  assert.equal(unknown.data.porties, 2);
});

test("Open Food Facts: de portie in gram", () => {
  const p = fromOff({ product_name: "Nutella", serving_quantity: 15, nutriments: { "energy-kcal_100g": 539 } })!;
  assert.equal(p.values.serving, 15);
  assert.equal(fromOff({ product_name: "X", serving_quantity: "abc", nutriments: { "energy-kcal_100g": 10 } })!.values.serving, undefined);
});
