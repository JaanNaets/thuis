import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PROJECT_TEMPLATES,
  cleanAttributes,
  cleanFields,
  drinkStatus,
  fieldKey,
  formatFieldValue,
  guessColumn,
  normalizeOwners,
  ownersText,
  parseFieldText,
  parseInvoiceLine,
  valueByOwner,
  type FieldDef,
} from "../shared/fields.ts";

const wine = PROJECT_TEMPLATES.wine.fields as unknown as FieldDef[];
const field = (key: string) => wine.find((f) => f.key === key)!;

test("sjablonen zijn geldige velden", () => {
  for (const t of Object.values(PROJECT_TEMPLATES)) assert.deepEqual(cleanFields(t.fields), t.fields);
});

test("velden nakijken: sleutel, soort, keuzes en betekenis", () => {
  assert.throws(() => cleanFields([{ key: "a", label: "", type: "text" }]), /naam/);
  assert.throws(
    () =>
      cleanFields([
        { key: "a", label: "A", type: "text" },
        { key: "a", label: "B", type: "text" },
      ]),
    /sleutel/,
  );
  assert.throws(() => cleanFields([{ key: "k", label: "Kleur", type: "select" }]), /keuze/);
  assert.throws(() => cleanFields([{ key: "p", label: "Prijs", type: "text", role: "unit_price" }]), /betekenis/);
  assert.deepEqual(cleanFields([{ key: "km", label: " Km ", type: "number", unit: "km", column: true, extra: 1 }]), [
    { key: "km", label: "Km", type: "number", unit: "km", column: true },
  ]);
});

test("sleutel uit een naam", () => {
  assert.equal(fieldKey("Kilometerstand", []), "kilometerstand");
  assert.equal(fieldKey("Cuvée", ["cuvee"]), "cuvee_2");
  assert.equal(fieldKey("2de eigenaar", []), "v_2de_eigenaar");
});

test("waarden nakijken: onbekende velden vallen weg, typen kloppen", () => {
  assert.deepEqual(
    cleanAttributes(wine, {
      vintage: 2019,
      color: "rood",
      grapes: "Pinot Noir, gamay, Pinot noir",
      drink: [2032, 2026],
      price: 2450,
      score: 4.3,
      hack: "x",
      region: "  ",
    }),
    { vintage: 2019, color: "Rood", grapes: ["Pinot Noir", "gamay"], drink: [2026, 2032], price: 2450, score: 4.5 },
  );
  assert.deepEqual(cleanAttributes(wine, { vintage: 3000, price: -1, score: 7 }), {});
});

test("tekst uit een lijst lezen", () => {
  assert.equal(parseFieldText(field("vintage"), "2019"), 2019);
  assert.equal(parseFieldText(field("vintage"), "Château X 2015"), 2015);
  assert.equal(parseFieldText(field("price"), "€ 24,50"), 2450);
  assert.equal(parseFieldText(field("price"), "1.234,50"), 123450);
  assert.equal(parseFieldText(field("price"), "veel"), undefined);
  assert.deepEqual(parseFieldText(field("drink"), "2025-2030"), [2025, 2030]);
  assert.deepEqual(parseFieldText(field("drink"), "2028+"), [2028, null]);
  assert.deepEqual(parseFieldText(field("drink"), "tot 2027"), [null, 2027]);
  assert.equal(parseFieldText(field("score"), "92/100"), 4.5);
  assert.equal(parseFieldText(field("score"), "4,5"), 4.5);
  assert.deepEqual(parseFieldText(field("grapes"), "Merlot; Cabernet Franc"), ["Merlot", "Cabernet Franc"]);
  assert.equal(parseFieldText(field("vintage"), ""), null);
});

test("waarden tonen", () => {
  assert.equal(formatFieldValue(field("drink"), [2026, 2032]), "2026–2032");
  assert.equal(formatFieldValue(field("drink"), [2028, null]), "vanaf 2028");
  assert.equal(formatFieldValue(field("grapes"), ["Pinot Noir", "Gamay"]), "Pinot Noir, Gamay");
  assert.equal(formatFieldValue(field("score"), 4.5), "4,5/5");
  assert.match(formatFieldValue(field("price"), 2450), /24,50/);
});

test("drinkvenster", () => {
  assert.equal(drinkStatus([2025, 2030], 2026), "ready");
  assert.equal(drinkStatus([2028, 2035], 2026), "young");
  assert.equal(drinkStatus([2015, 2020], 2026), "past");
  assert.equal(drinkStatus([null, 2027], 2026), "ready");
  assert.equal(drinkStatus(undefined, 2026), null);
});

test("kolommen van een lijst herkennen", () => {
  assert.equal(guessColumn("Jaargang", wine), "field:vintage");
  assert.equal(guessColumn("Druif", wine), "field:grapes");
  assert.equal(guessColumn("Prijs", wine), "field:price");
  assert.equal(guessColumn("Domaine", wine), "brand");
  assert.equal(guessColumn("Aantal flessen", wine), "quantity");
  assert.equal(guessColumn("Wijn", wine), "name");
  assert.equal(guessColumn("Iets anders", wine), null);
});

test("eigenaars: procenten die samen 100 zijn", () => {
  assert.deepEqual(normalizeOwners([{ member_id: "a" }, { member_id: "b" }]), [
    { member_id: "a", share: 50 },
    { member_id: "b", share: 50 },
  ]);
  assert.deepEqual(
    normalizeOwners([
      { member_id: "a", share: 60 },
      { member_id: "b", share: 40 },
    ]),
    [
      { member_id: "a", share: 60 },
      { member_id: "b", share: 40 },
    ],
  );
  assert.deepEqual(normalizeOwners([]), []);
  assert.throws(() => normalizeOwners([{ member_id: "a" }, { member_id: "a" }]), /twee keer/);
  const name = (id: string) => ({ a: "Jana", b: "Jaan", c: "Lien" })[id] ?? "?";
  assert.equal(ownersText([], name), "Samen");
  assert.equal(ownersText(normalizeOwners([{ member_id: "a" }]), name), "Jana");
  assert.equal(ownersText(normalizeOwners([{ member_id: "a" }, { member_id: "b" }]), name), "Jana en Jaan");
  assert.equal(
    ownersText(
      normalizeOwners([
        { member_id: "a", share: 2 },
        { member_id: "b", share: 1 },
      ]),
      name,
    ),
    "Jana 66,7% · Jaan 33,3%",
  );
});

test("waarde: aantal × prijs per fles, per eigenaar", () => {
  const base = { type: "consumable" as const, value_cents: null, cost_cents: 0 };
  const items = [
    { ...base, quantity: 6, attributes: { price: 2000 }, owners: [] },
    { ...base, quantity: 2, attributes: { price: 5000 }, owners: normalizeOwners([{ member_id: "a" }, { member_id: "b" }]) },
    { ...base, quantity: 3, attributes: {}, owners: normalizeOwners([{ member_id: "a" }]) },
    { type: "asset" as const, quantity: 1, attributes: {}, value_cents: 150000, cost_cents: 0, owners: normalizeOwners([{ member_id: "b" }]) },
  ];
  assert.deepEqual(valueByOwner(items, wine), [
    { member_id: "b", cents: 155000 },
    { member_id: "", cents: 12000 },
    { member_id: "a", cents: 5000 },
  ]);
});

test("factuurlijn: aantal, jaargang en inhoud uit de omschrijving", () => {
  assert.deepEqual(parseInvoiceLine("6x Chablis 1er Cru Montmains 2019 75cl", wine), {
    name: "Chablis 1er Cru Montmains",
    quantity: 6,
    attributes: { vintage: 2019 },
  });
  assert.deepEqual(parseInvoiceLine("Barolo Bussia 2016 - 3 fl", wine), { name: "Barolo Bussia", quantity: 3, attributes: { vintage: 2016 } });
  assert.deepEqual(parseInvoiceLine("Cava Brut Nature", wine), { name: "Cava Brut Nature", quantity: 1, attributes: {} });
  assert.deepEqual(parseInvoiceLine("Fietsbel 2024", []), { name: "Fietsbel 2024", quantity: 1, attributes: {} });
});
