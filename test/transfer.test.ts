import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldDef } from "../shared/fields.ts";
import { canCarry, carryValue, cleanPlan, guessPlan, toTranslate, transferRows, type SourceThing } from "../shared/transfer.ts";
import { NAME } from "../shared/views.ts";

// Wijnen (de bron) en Voorraad (de keuken): andere velden, een paar dezelfde.
const WIJNEN = "WIJNEN";
const wijnen: FieldDef[] = [
  { key: "kleur", label: "Kleur", type: "select", options: ["Rood", "Wit", "Rosé"] },
  { key: "jaargang", label: "Jaargang", type: "year" },
  { key: "waar", label: "Waar", type: "select", options: ["Kelder", "Keuken"] },
  { key: "prijs", label: "Aankoopprijs", type: "money" },
  { key: "notitie", label: "Notitie", type: "longtext" },
];
const voorraad: FieldDef[] = [
  { key: "eenheid", label: "Eenheid", type: "select", options: ["stuk", "fles"] },
  { key: "categorie", label: "Categorie", type: "select", options: ["Drinken", "Snacks"] },
  { key: "soort", label: "Kleur", type: "text" },
  { key: "wijn", label: "Wijn", type: "item", ref_type: WIJNEN },
  { key: "notitie", label: "Notitie", type: "longtext" },
  { key: "kcal", label: "Kcal", type: "calc", calc: "sum", result: "number" } as FieldDef,
];
const things: SourceThing[] = [
  { id: "w1", name: "Chablis", data: { kleur: "Wit", jaargang: 2020, waar: "Keuken", notitie: "fris" }, tag_ids: [] },
  { id: "w2", name: "Barolo", data: { kleur: "Rood", jaargang: 2015, waar: "Kelder" }, tag_ids: [] },
  { id: "w3", name: "Tavel", data: { kleur: "Rosé", waar: "Keuken" }, tag_ids: [] },
];
const ctx = { today: "2026-11-08", me: "jaan", names: { person: () => "?", item: () => "?" } };

test("toevoegen uit een andere lijst: het voorstel koppelt hetzelfde veld (sleutel of naam) en wijst terug naar het origineel", () => {
  const plan = guessPlan({ id: WIJNEN, fields: wijnen }, { fields: voorraad });
  assert.deepEqual(plan.fields, {
    soort: { from: "field", key: "kleur" }, // dezelfde naam, een keuze past in tekst
    wijn: { from: "self" },
    notitie: { from: "field", key: "notitie" },
  });
  assert.equal(plan.name, NAME);
  assert.equal(plan.move, false);
  assert.ok(!("kcal" in plan.fields), "een berekening krijgt niets");
});

test("een waarde zoals ze past: keuzes vertaald of leeg, tekst uit een keuze of getal, anders niets", () => {
  const cat = voorraad[1];
  assert.equal(carryValue(cat, wijnen[0], "Rood", { Rood: "Drinken" }), "Drinken");
  assert.equal(carryValue(cat, wijnen[0], "Rood"), undefined, "geen keuze hier en niet vertaald: leeg");
  assert.equal(carryValue(cat, wijnen[0], "Rood", { Rood: "" }), undefined, "bewust leeg laten");
  assert.equal(carryValue(voorraad[2], wijnen[1], 2020), "2020");
  assert.equal(carryValue({ key: "x", label: "X", type: "number" }, wijnen[3], 1250), undefined, "een bedrag is geen getal");
  assert.ok(canCarry({ key: "m", label: "M", type: "multi", options: ["Wit"] }, wijnen[0]));
  assert.deepEqual(carryValue({ key: "m", label: "M", type: "multi", options: ["Wit", "Rood"] }, wijnen[0], "Wit"), ["Wit"]);
});

test("de dingen die aan de voorwaarden voldoen, met vaste waarden en de verwijzing naar het origineel", () => {
  const plan = {
    ...guessPlan({ id: WIJNEN, fields: wijnen }, { fields: voorraad }),
    where: { match: "all" as const, conditions: [{ field: "waar", op: "any_of" as const, value: ["Keuken"] }] },
  };
  plan.fields.eenheid = { from: "value", value: "fles" };
  plan.fields.categorie = { from: "field", key: "kleur" };
  plan.translate = { categorie: { Wit: "Drinken" } };
  assert.deepEqual(toTranslate(things, plan, wijnen, voorraad, ctx), { categorie: ["Rosé", "Wit"] });
  const rows = transferRows(things, plan, wijnen, voorraad, ctx);
  assert.deepEqual(
    rows.map((r) => [r.source_id, r.name, r.data]),
    [
      ["w1", "Chablis", { eenheid: "fles", categorie: "Drinken", soort: "Wit", wijn: "w1", notitie: "fris" }],
      ["w3", "Tavel", { eenheid: "fles", soort: "Rosé", wijn: "w3" }],
    ],
  );
  // Een ander veld als naam.
  assert.deepEqual(transferRows(things, { ...plan, name: "kleur" }, wijnen, voorraad, ctx).map((r) => r.name), ["Wit", "Rosé"]);
});

test("een plan nakijken: onbekende velden, een verwijzing die niet naar de bron wijst en vreemde keuzes vallen weg", () => {
  const plan = cleanPlan(
    {
      where: { match: "any", conditions: [{ field: "waar", op: "any_of", value: ["Keuken"] }] },
      name: "bestaat-niet",
      fields: { eenheid: { from: "value", value: "fles" }, soort: { from: "field", key: "geen" }, notitie: { from: "self" }, wijn: { from: "self" }, kcal: { from: "value", value: 1 } },
      translate: { categorie: { Rood: "Drinken", Wit: "Bier" }, soort: { a: "b" } },
      move: true,
    },
    { id: WIJNEN, fields: wijnen, one: "Wijn" },
    voorraad,
  );
  assert.equal(plan.name, NAME);
  assert.deepEqual(plan.fields, { eenheid: { from: "value", value: "fles" }, wijn: { from: "self" } });
  assert.deepEqual(plan.translate, { categorie: { Rood: "Drinken" } });
  assert.equal(plan.where.match, "any");
  assert.equal(plan.move, true);
  assert.throws(() => cleanPlan({ where: { match: "all", conditions: [{ field: "x", op: "nonsense" }] } }, { id: WIJNEN, fields: wijnen, one: "Wijn" }, voorraad));
});
