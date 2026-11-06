import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanFields } from "../shared/fields.ts";
import { fromOff } from "../shared/product.ts";

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

test("Open Food Facts: de portie in gram", () => {
  const p = fromOff({ product_name: "Nutella", serving_quantity: 15, nutriments: { "energy-kcal_100g": 539 } })!;
  assert.equal(p.values.serving, 15);
  assert.equal(fromOff({ product_name: "X", serving_quantity: "abc", nutriments: { "energy-kcal_100g": 10 } })!.values.serving, undefined);
});
