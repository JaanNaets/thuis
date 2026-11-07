import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldDef } from "../shared/fields.ts";
import { parseTemplateFile, SELF, templateFile, withSelf } from "../shared/template-file.ts";

const fields: FieldDef[] = [
  { key: "eenheid", label: "Eenheid", type: "select", options: ["g", "kg"] },
  { key: "minimum", label: "Bijna op onder", type: "number" },
  { key: "zoals", label: "Lijkt op", type: "item", ref_type: "L1" },
  { key: "winkel", label: "Winkel", type: "item", ref_type: "ANDERE" },
];

test("een lijst als sjabloon: zonder verwijzingen naar elders, de lijst zelf wordt self", () => {
  const file = templateFile({ id: "L1", name: "Voorraad", one: "Product", icon: "food", fields, stock: { unit: "eenheid", min: "minimum" } }, [
    { base: "gebruik", name: "Gegeten", icon: "food", fields: [{ key: "kcal", label: "Kcal", type: "number" }], goal: null },
  ]);
  assert.deepEqual(file.fields.map((f) => [f.key, f.ref_type]), [["eenheid", undefined], ["minimum", undefined], ["zoals", SELF]]);
  const back = parseTemplateFile(JSON.parse(JSON.stringify(file)));
  assert.equal(back.name, "Voorraad");
  assert.equal(back.one, "Product");
  assert.deepEqual(back.stock, { unit: "eenheid", min: "minimum" });
  assert.deepEqual(back.kinds?.map((k) => k.name), ["Gegeten"]);
  assert.equal(withSelf(back.fields, "NIEUW").find((f) => f.key === "zoals")?.ref_type, "NIEUW");
  assert.equal(back.notify, undefined, "zonder melding");
  // Wie een melding krijgt, gaat mee.
  const shared = templateFile({ id: "L2", name: "Uitgaven", one: null, icon: "wallet", fields: [], stock: null, notify: { to: "people" } }, []);
  assert.deepEqual(parseTemplateFile(JSON.parse(JSON.stringify(shared))).notify, { to: "people" });
  assert.equal(parseTemplateFile({ ...shared, notify: { to: "raar" } }).notify, undefined);
});

test("wat geen sjabloon is, of niet klopt", () => {
  assert.throws(() => parseTemplateFile({ kind: "iets" }), /geen sjabloon/);
  assert.throws(() => parseTemplateFile({ kind: "thuis-sjabloon", version: 1 }), /andere versie/);
  const odd = parseTemplateFile({ kind: "thuis-sjabloon", version: 2, name: "", icon: "raar", fields: [], kinds: [{ base: "raar" }, { base: "meting" }] });
  assert.equal(odd.name, "Lijst");
  assert.equal(odd.icon, "folder");
  assert.deepEqual(odd.kinds?.map((k) => [k.base, k.name]), [["meting", "Meting"]]);
});
