import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanFields, rememberKey } from "../shared/fields.ts";

test("geheugen per keuze: enkel per de naam of een keuzeveld van dezelfde lijst", () => {
  const fields = cleanFields([
    { key: "voorraad", label: "Uit voorraad", type: "text" },
    { key: "gram", label: "Hoeveel", type: "number", remember: true, remember_by: "voorraad", remember_fixed: true },
    { key: "maaltijd", label: "Maaltijd", type: "select", options: ["Ontbijt", "Avond"], remember: true, remember_by: "name" },
    { key: "notitie", label: "Notitie", type: "longtext", remember: true, remember_by: "gram" },
    { key: "zelf", label: "Zelf", type: "text", remember: true, remember_by: "zelf" },
    { key: "los", label: "Los", type: "number", remember_by: "voorraad", remember_fixed: true },
  ]);
  const by = Object.fromEntries(fields.map((f) => [f.key, [f.remember, f.remember_by, f.remember_fixed]]));
  assert.deepEqual(by.gram, [true, "voorraad", true]);
  assert.deepEqual(by.maaltijd, [true, "name", undefined]);
  // Per een getal of per zichzelf kan niet; zonder onthouden ook geen per of vast.
  assert.deepEqual(by.notitie, [true, undefined, undefined]);
  assert.deepEqual(by.zelf, [true, undefined, undefined]);
  assert.deepEqual(by.los, [undefined, undefined, undefined]);
});

test("geheugen per keuze: dezelfde sleutel voor dezelfde keuze", () => {
  assert.equal(rememberKey("name", "  Pásta "), "pasta");
  assert.equal(rememberKey("name", "pasta"), rememberKey("text", "PASTA"));
  assert.equal(rememberKey("item", "abc-123"), "abc-123");
  assert.equal(rememberKey("item", { text: "Pasta van mama" }), "t:pasta van mama");
  assert.equal(rememberKey("item", "../x"), null);
  assert.equal(rememberKey("code", { text: "5410" }), "5410");
  assert.equal(rememberKey("bool", false), "nee");
  assert.equal(rememberKey("name", "   "), null);
  assert.equal(rememberKey("person", 12), null);
});
