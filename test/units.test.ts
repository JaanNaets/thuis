import assert from "node:assert/strict";
import { test } from "node:test";
import { convert, formatAmount, normalizeUnit, parseSize } from "../shared/units.ts";

test("omrekenen naar de eenheid van de voorraad", () => {
  const aardappelen = { unit: "kg", pack: 5, pack_name: "zak" };
  assert.equal(convert(500, "g", aardappelen), 0.5);
  assert.equal(convert(1, "zak", aardappelen), 5);
  assert.equal(convert(2, "verpakking", aardappelen), 10);
  assert.equal(convert(3, null, aardappelen), 3);
  // Pellets in kg: een zak van 15 kg, of van 5 kg als je die maat typt.
  const pellets = { unit: "kg", pack: 15, pack_name: "zak" };
  assert.equal(convert(1, "zak", pellets), 15);
  assert.equal(convert(5, "kg", pellets), 5);
  // Nutella per pot van 400 g: 30 g is 0,075 pot.
  assert.equal(convert(30, "g", { unit: "pot", piece: 400 }), 0.075);
  // Zonder inhoud per stuk: één stuk.
  assert.equal(convert(30, "g", { unit: "stuk" }), 1);
  // Melk in liter: 33 cl en (keuken) 250 g.
  assert.equal(convert(33, "cl", { unit: "l" }), 0.33);
  assert.equal(convert(250, "g", { unit: "l" }), 0.25);
  // Eieren per stuk, een recept vraagt 2 stuks.
  assert.equal(convert(2, "stuk", { unit: "stuk" }), 2);
  // Stuks van iets in kg, met het gewicht per stuk (een ui van 150 g).
  assert.equal(convert(2, "stuk", { unit: "kg", piece: 150 }), 0.3);
});

test("eenheden en maten lezen", () => {
  assert.equal(normalizeUnit("Kilo"), "kg");
  assert.equal(normalizeUnit("stuks"), "stuk");
  assert.equal(normalizeUnit("Zak"), "zak");
  assert.equal(normalizeUnit(""), null);
  assert.deepEqual(parseSize("AARDAPPELEN 5KG"), { count: 1, amount: 5, unit: "kg" });
  assert.deepEqual(parseSize("Cola 6X33CL"), { count: 6, amount: 33, unit: "cl" });
  assert.deepEqual(parseSize("Melk halfvol 1,5L"), { count: 1, amount: 1.5, unit: "l" });
  assert.deepEqual(parseSize("Gehakt 500 gr"), { count: 1, amount: 500, unit: "g" });
  assert.equal(parseSize("Brood wit"), null);
  assert.equal(formatAmount(4.5, "kg"), "4,5 kg");
  assert.equal(formatAmount(3, "stuk"), "3 stuks");
  assert.equal(formatAmount(1, "stuk"), "1 stuk");
  assert.equal(formatAmount(0.1 + 0.2, "l"), "0,3 l");
});
