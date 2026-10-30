import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanFields, type FieldDef } from "../shared/fields.ts";
import { bestMatch, fromOff, isProductCode, productData, productLabel, type ProductInfo } from "../shared/product.ts";

// Zoals Open Food Facts het teruggeeft (ingekort).
const nutella = {
  code: "3017620422003",
  product_name: "Nutella",
  brands: "Nutella, Ferrero",
  quantity: "400 g",
  unique_scans_n: 900,
  nutriments: { "energy-kcal_100g": 539, "energy-kj_100g": 2252, fat_100g: 30.9, sugars_100g: 56.3, proteins_100g: 6.3, salt_100g: 0.107 },
};

test("barcodes nakijken", () => {
  assert.ok(isProductCode("3017620422003"));
  assert.ok(isProductCode("5411188121923"));
  assert.ok(!isProductCode("3017620422004"));
  assert.ok(!isProductCode("12345"));
  assert.ok(!isProductCode("abc"));
});

test("een product uit Open Food Facts", () => {
  const p = fromOff(nutella)!;
  assert.deepEqual(p, {
    code: "3017620422003",
    name: "Nutella",
    brand: "Nutella",
    quantity: "400 g",
    values: { kcal: 539, fat: 30.9, sugars: 56.3, protein: 6.3, salt: 0.1 },
    scans: 900,
  });
  assert.equal(productLabel(p), "Nutella");
  assert.equal(productLabel({ ...p, brand: "Ferrero" }), "Nutella (Ferrero)");
  // Een Nederlandse naam gaat voor; enkel kJ wordt omgerekend; zonder energie is het niets waard.
  assert.equal(fromOff({ ...nutella, product_name_nl: "Hazelnootpasta" })!.name, "Hazelnootpasta");
  assert.equal(fromOff({ ...nutella, nutriments: { "energy-kj_100g": 2252 } })!.values.kcal, 538);
  assert.equal(fromOff({ ...nutella, nutriments: {} }), null);
  assert.equal(fromOff({ ...nutella, product_name: "" }), null);
  assert.equal(fromOff("x"), null);
  // Merken als lijst (zo geeft de zoekfunctie ze).
  assert.equal(fromOff({ ...nutella, brands: ["Ferrero", "Nutella"] })!.brand, "Ferrero");
});

test("het beste product kiezen uit zoekresultaten", () => {
  const p = (name: string, brand: string, kcal: number, scans = 0): ProductInfo => ({ code: null, name, brand, quantity: null, values: { kcal }, scans });
  // Prince: één foute invoer (622) verandert niets; bij gelijke waarden wint het meest gescande.
  const prince = [
    p("Prince goût chocolat", "Lu", 622),
    p("Prince goût chocolat", "Lu", 467, 1),
    p("Prince goût chocolat", "Lu", 465),
    p("prince gout chocolat", "Lu", 467, 32),
    p("Prince goût vanille", "Lu", 470),
  ];
  assert.deepEqual(bestMatch(prince, { name: "Prince goût chocolat", brand: "LU" }), prince[3]);
  // Wat past bij de naam, gaat voor op een ander product van hetzelfde merk; een andere smaak is geen match.
  const danio = [p("Danio Fraise", "Danone", 98), p("Danio vanille", "Danone", 108), p("Activia vanille", "Danone", 93)];
  assert.equal(bestMatch(danio, { name: "Danio vanille", brand: "Danone" })!.values.kcal, 108);
  assert.equal(bestMatch([p("Danio Blueberry", "Danone", 100)], { name: "Danio vanille", brand: "Danone" }), null);
  // Een extra beschrijvend woord mag (twee van drie), een ander merk niet.
  assert.equal(bestMatch([p("Alpro Soya Original", "Alpro", 39)], { name: "Alpro soya drink original", brand: "Alpro" })?.values.kcal, 39);
  assert.equal(bestMatch([p("Soya drink", "Lidl", 40)], { name: "Alpro soya drink", brand: "Alpro" }), null);
  // Niets dat past: geen gok.
  assert.equal(bestMatch([p("Marmite", "Unilever", 260)], { name: "Alpro soya original", brand: "Alpro" }), null);
  assert.equal(bestMatch(danio, { name: "", brand: "Danone" }), null);
});

test("productinfo in de velden van een lijst", () => {
  const fields = cleanFields([
    { key: "kcal_100", label: "kcal per 100 g", type: "number", product: "kcal" },
    { key: "merk", label: "Merk", type: "text", product: "brand" },
    { key: "suiker", label: "Suiker", type: "number", product: "sugars" },
    { key: "vezels", label: "Vezels", type: "number", product: "fiber" },
    // Past niet bij de soort: valt weg.
    { key: "fout", label: "Fout", type: "text", product: "kcal" },
    { key: "onbekend", label: "Onbekend", type: "number", product: "vitamine" },
  ]) as FieldDef[];
  assert.deepEqual(
    fields.map((f) => f.product),
    ["kcal", "brand", "sugars", "fiber", undefined, undefined],
  );
  assert.deepEqual(productData(fields, { ...fromOff(nutella)!, brand: "Ferrero" }), { kcal_100: 539, merk: "Ferrero", suiker: 56.3 });
});
