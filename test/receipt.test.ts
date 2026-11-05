// Een kasticket per lijn: welke velden wat doen, hoeveel en de eenheid van een lijn, en wat elke lijn bewaart.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldDef } from "../shared/fields.ts";
import { cents, commonFields, inProductUnit, lineAmount, lineData, linesTotal, newProductData, niceName, readLines, receiptData, receiptPlan, validDate, type ReviewLine } from "../shared/receipt.ts";

const uitgaven: FieldDef[] = [
  { key: "bedrag", label: "Bedrag", type: "money", required: true },
  { key: "datum", label: "Datum", type: "date", today: true },
  { key: "betaald_door", label: "Betaald door", type: "person", me: true },
  { key: "categorie", label: "Categorie", type: "select", options: ["Boodschappen", "Restaurant"] },
  { key: "winkel", label: "Winkel", type: "item", ref_type: "winkels", free: true },
  { key: "wat", label: "Wat", type: "item", ref_type: "voorraad", ref_also: ["wijnen"], free: true, adjust: { field: "aantal", by: "hoeveel", sign: 1, unit_by: "eenheid" } },
  { key: "hoeveel", label: "Hoeveel", type: "number" },
  { key: "eenheid", label: "Eenheid", type: "select", options: ["stuk", "kg", "g", "l", "ml"] },
  { key: "kasticket", label: "Kasticket", type: "item", ref_type: "kastickets" },
  { key: "gegeten", label: "Gegeten", type: "bool", spawn: ["eten"] },
  { key: "verdeling", label: "Verdeling", type: "share", fill: true },
  { key: "prijs", label: "Prijs per eenheid", type: "calc", calc: { kind: "formula", expr: "[bedrag] / [hoeveel]" } },
  { key: "notitie", label: "Notitie", type: "longtext" },
];
const kastickets: FieldDef[] = [
  { key: "datum", label: "Datum", type: "date" },
  { key: "winkel", label: "Winkel", type: "item", ref_type: "winkels", free: true },
  { key: "totaal", label: "Totaal", type: "calc", result: "money", calc: { kind: "rollup", from: "backlinks", list: "uitgaven", via: "kasticket", agg: "sum", field: "bedrag" } },
];
// Winkels telt ook de uitgaven op (Uitgegeven), maar heeft geen datum: dat is geen kasticket.
const winkels: FieldDef[] = [
  { key: "uitgegeven", label: "Uitgegeven", type: "calc", result: "money", calc: { kind: "rollup", from: "backlinks", list: "uitgaven", via: "winkel", agg: "sum", field: "bedrag" } },
  { key: "laatst", label: "Laatste aankoop", type: "calc", result: "date", calc: { kind: "rollup", from: "backlinks", list: "uitgaven", via: "winkel", agg: "max", field: "datum" } },
];
const lists = (id: string) => (id === "kastickets" ? kastickets : id === "winkels" ? winkels : undefined);

test("de velden zeggen wat ze doen bij een kasticket", () => {
  const plan = receiptPlan(uitgaven, "uitgaven", lists);
  assert.deepEqual(plan, {
    price: "bedrag",
    product: { key: "wat", lists: ["voorraad", "wijnen"] },
    amount: "hoeveel",
    unit: "eenheid",
    receipt: { key: "kasticket", list: "kastickets" },
    store: { key: "winkel", lists: ["winkels"], free: true },
    date: "datum",
    share: "verdeling",
    eaten: "gegeten",
  });
  // Voor alle lijnen: datum, betaald door, categorie, winkel, verdeling (geen berekening, notitie of wat per lijn is).
  assert.deepEqual(commonFields(uitgaven, plan!).map((f) => f.key), ["datum", "betaald_door", "categorie", "winkel", "verdeling"]);
});

test("zonder bedrag of zonder product dat telt: geen kasticket per lijn", () => {
  assert.equal(receiptPlan(uitgaven.filter((f) => f.key !== "bedrag"), "uitgaven", lists), null);
  assert.equal(receiptPlan(uitgaven.map((f) => (f.key === "wat" ? { ...f, adjust: undefined } : f)), "uitgaven", lists), null);
});

test("een verwijzing is enkel het kasticket als die lijst deze lijnen optelt", () => {
  const other = receiptPlan(uitgaven, "andere-lijst", lists);
  assert.equal(other?.receipt, undefined);
  // Dan is de eerste andere verwijzing de winkel (Kasticket staat na Winkel, dus nog altijd Winkel).
  assert.equal(other?.store?.key, "winkel");
});

test("hoeveel en de eenheid van een lijn", () => {
  const options = ["stuk", "kg", "g", "l", "ml"];
  assert.deepEqual(lineAmount({ name: "AARDAPPELEN 5KG", quantity: 1, size: null }, options), { amount: 5, unit: "kg" });
  assert.deepEqual(lineAmount({ name: "Melk", quantity: 2, size: "1 l" }, options), { amount: 2, unit: "l" });
  assert.deepEqual(lineAmount({ name: "Cola", quantity: 1, size: "6x33 cl" }, options), { amount: 1.98, unit: "l" });
  assert.deepEqual(lineAmount({ name: "Cola 33CL", quantity: 1, size: null }, options), { amount: 330, unit: "ml" });
  assert.deepEqual(lineAmount({ name: "Brood", quantity: 1, size: null }, options), { amount: 1, unit: "stuk" });
  assert.deepEqual(lineAmount({ name: "Appels", quantity: 3, size: null }), { amount: 3, unit: "stuk" });
});

test("wat elke lijn bewaart", () => {
  const plan = receiptPlan(uitgaven, "uitgaven", lists)!;
  const common = { datum: "2026-11-05", categorie: "Boodschappen", winkel: "colruyt", verdeling: [{ person_id: "jaan", share: 1 }, { person_id: "jana", share: 1 }] };
  const line: ReviewLine = { on: true, name: "Yoghurt", product: { id: "y1", name: "Yoghurt" }, newIn: null, amount: 4, unit: "stuk", price: 356, eaten: false, mine: false };
  assert.deepEqual(lineData(plan, uitgaven, common, line, "jaan"), { ...common, bedrag: 356, wat: "y1", hoeveel: 4, eenheid: "stuk", gegeten: false });
  // Een broodje voor mij alleen, meteen opgegeten, nog geen product: de naam als tekst.
  const broodje: ReviewLine = { on: true, name: "Broodje kaas", product: null, newIn: null, amount: 1, unit: "stuk", price: 450, eaten: true, mine: true };
  const data = lineData(plan, uitgaven, common, broodje, "jaan");
  assert.deepEqual(data.wat, { text: "Broodje kaas" });
  assert.deepEqual(data.verdeling, [{ person_id: "jaan", share: 1 }]);
  assert.equal(data.gegeten, true);
  assert.equal(linesTotal([line, broodje, { ...line, on: false }]), 806);
});

test("het kasticket krijgt de datum en de winkel", () => {
  assert.deepEqual(receiptData(kastickets, uitgaven, { datum: "2026-11-05", winkel: "colruyt", categorie: "Boodschappen" }), { datum: "2026-11-05", winkel: "colruyt" });
});

test("een naam van het ticket, leesbaar", () => {
  assert.equal(niceName("AARDAPPELEN  5KG"), "Aardappelen");
  assert.equal(niceName("COLA 6X33CL"), "Cola");
  assert.equal(niceName("Melk 1,5 l halfvol"), "Melk halfvol");
  assert.equal(niceName("5KG"), "5kg");
  assert.equal(niceName("Boni yoghurt"), "Boni yoghurt");
  assert.equal(niceName("123"), "123");
});

test("wat de AI las, als lijnen met een product", () => {
  const products = [
    { id: "y1", name: "Yoghurt", item: "Yoghurt", own: true },
    { id: "y1", name: "BONI YOG NAT", item: "Yoghurt", own: false },
    { id: "a1", name: "Aardappelen", item: "Aardappelen", own: true },
  ];
  const lines = readLines(
    [
      { name: "BONI YOG NAT", quantity: 4, size: "", price: 3.56 },
      { name: "AARDAPPELEN 5KG", quantity: 1, size: "", price: 4.99 },
      { name: "Broodje kaas", quantity: 1, size: "", price: 4.5 },
      { name: "", quantity: 1, size: "", price: 1 },
      "rommel",
    ],
    products,
    ["stuk", "kg", "g"],
  );
  assert.deepEqual(lines, [
    { name: "BONI YOG NAT", quantity: 4, size: null, amount: 4, unit: "stuk", price: 356, product: { id: "y1", name: "Yoghurt" } },
    { name: "AARDAPPELEN 5KG", quantity: 1, size: null, amount: 5, unit: "kg", price: 499, product: { id: "a1", name: "Aardappelen" } },
    { name: "Broodje kaas", quantity: 1, size: null, amount: 1, unit: "stuk", price: 450, product: null },
  ]);
  assert.deepEqual(readLines("geen lijst", products), []);
});

test("bedragen en datums van het ticket", () => {
  assert.equal(cents(12.345), 1235);
  assert.equal(cents(-1), null);
  assert.equal(cents("3"), null);
  assert.equal(validDate("2026-11-04", "2026-11-05"), "2026-11-04");
  assert.equal(validDate("2026-11-06", "2026-11-05"), null);
  assert.equal(validDate("2026-02-30", "2026-11-05"), null);
  assert.equal(validDate("4/11/2026", "2026-11-05"), null);
});

test("een nieuw product van een lijn", () => {
  const voorraad: FieldDef[] = [
    { key: "aantal", label: "Aantal", type: "number", counter: true, measure: { unit: "eenheid", piece: "inhoud" } },
    { key: "eenheid", label: "Eenheid", type: "select", options: ["stuk", "kg", "g"] },
  ];
  assert.deepEqual(newProductData(voorraad, { unit: "kg" }), { eenheid: "kg" });
  assert.deepEqual(newProductData(voorraad, { unit: "ml" }), {});
  // Wijnen tellen flessen, zonder eenheid.
  assert.deepEqual(newProductData([{ key: "aantal", label: "Aantal", type: "number" }], { unit: "stuk" }), {});
  // Een nieuw product: de lijn krijgt geen tekst (de server zet de verwijzing naar het nieuwe item).
  const plan = receiptPlan(uitgaven, "uitgaven", lists)!;
  const fresh: ReviewLine = { on: true, name: "Boni yog nat", product: null, newIn: "voorraad", amount: 4, unit: "stuk", price: 356, eaten: false, mine: false };
  assert.equal(lineData(plan, uitgaven, {}, fresh, "jaan").wat, undefined);
});

test("een gekoppelde lijn in de eenheid van het product (eerlijke prijs per eenheid)", () => {
  const options = ["stuk", "kg", "g", "l", "ml", "zak", "fles"];
  // Yoghurt per stuk van 125 g: "4X125G" zijn 4 stuks.
  assert.deepEqual(inProductUnit({ name: "BONI YOG 4X125G", quantity: 1, size: null }, { unit: "stuk", piece: 125 }, options), { amount: 4, unit: "stuk" });
  // Aardappelen in kg: een zak van 5 kg.
  assert.deepEqual(inProductUnit({ name: "AARDAPPELEN", quantity: 2, size: "5 kg" }, { unit: "kg" }, options), { amount: 10, unit: "kg" });
  // Pellets in kg per zak van 15: 3 zakken zonder maat = 45 kg.
  assert.deepEqual(inProductUnit({ name: "PELLETS", quantity: 3, size: null }, { unit: "kg", pack: 15 }, options), { amount: 45, unit: "kg" });
  // Geen eenheid bij het product, of een eenheid die dit veld niet kent: zoals op het ticket.
  assert.equal(inProductUnit({ name: "Wijn", quantity: 6, size: null }, { unit: null }, options), null);
  assert.equal(inProductUnit({ name: "Iets", quantity: 1, size: null }, { unit: "pot" }, options), null);
});

test("wat een lijn vorige keer had, geldt als je bovenaan niets koos", () => {
  const plan = receiptPlan(uitgaven, "uitgaven", lists)!;
  const wine: ReviewLine = { on: true, name: "Rioja", product: { id: "w1", name: "Rioja" }, newIn: null, amount: 1, unit: "fles", price: 899, eaten: false, mine: false, remember: { categorie: "Restaurant" } };
  assert.equal(lineData(plan, uitgaven, { datum: "2026-11-05" }, wine, "jaan").categorie, "Restaurant");
  assert.equal(lineData(plan, uitgaven, { datum: "2026-11-05", categorie: "Boodschappen" }, wine, "jaan").categorie, "Boodschappen");
  // Wat per lijn verschilt (het bedrag), neemt het geheugen nooit over.
  assert.equal(lineData(plan, uitgaven, {}, { ...wine, remember: { bedrag: 1 } }, "jaan").bedrag, 899);
});
