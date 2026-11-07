import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldDef } from "../shared/fields.ts";
import { cleanReadPhoto, isFoodKind, readsByDefault, readsPhoto, THINGS_FORM, withReads } from "../shared/photoread.ts";

const kcal: FieldDef = { key: "kcal", label: "kcal", type: "number", product: "kcal" };
const gegeten = { base: "gebruik" as const, fields: [kcal] };
const sport = { base: "activiteit" as const, fields: [{ key: "km", label: "km", type: "number" } as FieldDef] };
const aankoop = { base: "aankoop" as const, fields: [] };

test("foto lezen: standaard een ding, een soort met geld (kasticket) of met voedingswaarden (gerecht)", () => {
  assert.equal(readsByDefault(THINGS_FORM, null), true);
  assert.equal(readsByDefault("aankoop", aankoop), true);
  assert.equal(readsByDefault("k-gegeten", gegeten), true);
  assert.equal(isFoodKind(gegeten), true);
  assert.equal(readsByDefault("k-sport", sport), false);
  assert.equal(readsByDefault("activiteit", { base: "activiteit", fields: [] }), false);
});

test("foto lezen: wat de beheerder koos wint, gelijk aan de standaard bewaart niets", () => {
  let s = withReads(null, "k-sport", sport, true);
  assert.deepEqual(s, { on: ["k-sport"], off: [] });
  assert.equal(readsPhoto(s, "k-sport", sport), true);
  s = withReads(s, "aankoop", aankoop, false);
  assert.deepEqual(s, { on: ["k-sport"], off: ["aankoop"] });
  assert.equal(readsPhoto(s, "aankoop", aankoop), false);
  // Terug naar de standaard: de keuze verdwijnt.
  s = withReads(s, "k-sport", sport, false);
  s = withReads(s, "aankoop", aankoop, true);
  assert.equal(s, null);
  // Een nieuwe eigen soort met voedingswaarden leest meteen (geen keuze nodig).
  assert.equal(readsPhoto({ on: [], off: ["aankoop"] }, "k-nieuw", gegeten), true);
});

test("foto lezen: nagekeken bij het bewaren", () => {
  assert.equal(cleanReadPhoto(null), null);
  assert.equal(cleanReadPhoto({ on: [], off: [] }), null);
  assert.deepEqual(cleanReadPhoto({ on: ["dingen", "dingen", "<x>", 3], off: ["dingen", "aankoop"] }), { on: ["dingen"], off: ["aankoop"] });
});
