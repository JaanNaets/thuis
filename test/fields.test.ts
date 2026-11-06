import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanAttributes,
  cleanFields,
  cleanValue,
  fieldKey,
  formatFieldValue,
  guessMapping,
  importRows,
  missingRequired,
  normalizeShares,
  parseFieldText,
  parseSheet,
  rangeStatus,
  referencedItems,
  refLists,
  referencedPeople,
  sharesText,
  type FieldDef,
} from "../shared/fields.ts";

/** De velden van een wijnkelder (zoals de wijnen van het huishouden). */
const WINE: FieldDef[] = cleanFields([
  { key: "wijnhuis", label: "Wijnhuis", type: "text", column: true },
  { key: "jaargang", label: "Jaargang", type: "year", column: true },
  { key: "kleur", label: "Kleur", type: "select", options: ["Rood", "Wit", "Rosé", "Mousserend", "Zoet", "Versterkt"], filter: true },
  { key: "druiven", label: "Druiven", type: "multi", filter: true },
  { key: "land", label: "Land", type: "text", filter: true },
  { key: "streek", label: "Streek", type: "text", filter: true },
  { key: "alcohol", label: "Alcohol", type: "number", unit: "%" },
  { key: "inhoud", label: "Inhoud", type: "select", options: ["37,5 cl", "50 cl", "75 cl", "1,5 l", "3 l"] },
  { key: "drinken", label: "Drinken", type: "year_range", filter: true },
  { key: "prijs", label: "Prijs", type: "money" },
  { key: "aantal", label: "Aantal", type: "number", column: true },
  { key: "score", label: "Score", type: "score" },
  { key: "eigenaar", label: "Eigenaar", type: "share" },
  { key: "proefnotities", label: "Proefnotities", type: "longtext" },
  { key: "gekocht_in", label: "Gekocht in", type: "year" },
]);
const field = (key: string) => WINE.find((f) => f.key === key)!;

test("velden nakijken", () => {
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
  assert.throws(() => cleanFields([{ key: "v", label: "Verkoper", type: "item" }]), /lijst/);
  assert.deepEqual(cleanFields([{ key: "km", label: " Km ", type: "number", unit: "km", column: true, filter: true, extra: 1 }]), [
    { key: "km", label: "Km", type: "number", unit: "km", column: true },
  ]);
  assert.deepEqual(cleanFields([{ key: "c", label: "Code", type: "code", format: "ean_13", required: true }]), [
    { key: "c", label: "Code", type: "code", format: "ean_13", required: true },
  ]);
});

test("sleutel uit een naam", () => {
  assert.equal(fieldKey("Kilometerstand", []), "kilometerstand");
  assert.equal(fieldKey("Cuvée", ["cuvee"]), "cuvee_2");
  assert.equal(fieldKey("2de eigenaar", []), "v_2de_eigenaar");
});

test("waarden nakijken: onbekende velden vallen weg, typen kloppen", () => {
  assert.deepEqual(
    cleanAttributes(WINE, {
      jaargang: 2019,
      kleur: "rood",
      druiven: "Pinot Noir, gamay, Pinot noir",
      drinken: [2032, 2026],
      prijs: 2450,
      score: 4.3,
      hack: "x",
      streek: "  ",
      eigenaar: [{ person_id: "a" }, { person_id: "b", share: 3 }],
    }),
    {
      jaargang: 2019,
      kleur: "Rood",
      druiven: ["Pinot Noir", "gamay"],
      drinken: [2026, 2032],
      prijs: 2450,
      score: 4.5,
      eigenaar: [
        { person_id: "a", share: 25 },
        { person_id: "b", share: 75 },
      ],
    },
  );
  assert.deepEqual(cleanAttributes(WINE, { jaargang: 3000, score: 7, eigenaar: [{ person_id: "a" }, { person_id: "a" }] }), {});
  const code: FieldDef = { key: "c", label: "Code", type: "code", format: "ean_13" };
  assert.deepEqual(cleanAttributes([code], { c: "5410000000000" }), { c: { text: "5410000000000", format: "ean_13" } });
  assert.deepEqual(cleanAttributes([code], { c: { text: "abc", format: "qr_code" } }), { c: { text: "abc", format: "qr_code" } });
  const refs: FieldDef[] = [
    { key: "p", label: "Persoon", type: "person" },
    { key: "i", label: "Verkoper", type: "item", ref_type: "t1" },
  ];
  assert.deepEqual(cleanAttributes(refs, { p: "id-1", i: "id 2; drop" }), { p: "id-1" });
});

test("verwijzingen en verplichte velden", () => {
  const defs: FieldDef[] = [
    { key: "p", label: "Persoon", type: "person" },
    { key: "s", label: "Eigenaar", type: "share" },
    { key: "i", label: "Verkoper", type: "item", ref_type: "t1", required: true },
  ];
  const data = cleanAttributes(defs, { p: "a", s: [{ person_id: "b" }, { person_id: "a" }], i: "x" });
  assert.deepEqual(referencedPeople(defs, data).sort(), ["a", "b"]);
  assert.deepEqual(referencedItems(defs, data), [{ id: "x", lists: ["t1"], key: "i" }]);
  assert.deepEqual(
    missingRequired(defs, {}).map((d) => d.key),
    ["i"],
  );
});

test("tekst uit een lijst lezen", () => {
  assert.equal(parseFieldText(field("jaargang"), "Château X 2015"), 2015);
  assert.equal(parseFieldText(field("prijs"), "€ 24,50"), 2450);
  assert.equal(parseFieldText(field("prijs"), "1.234,50"), 123450);
  assert.equal(parseFieldText(field("prijs"), "veel"), undefined);
  assert.deepEqual(parseFieldText(field("drinken"), "2025-2030"), [2025, 2030]);
  assert.deepEqual(parseFieldText(field("drinken"), "2028+"), [2028, null]);
  assert.deepEqual(parseFieldText(field("drinken"), "tot 2027"), [null, 2027]);
  assert.equal(parseFieldText(field("score"), "92/100"), 4.5);
  assert.deepEqual(parseFieldText(field("druiven"), "Merlot; Cabernet Franc"), ["Merlot", "Cabernet Franc"]);
  assert.equal(parseFieldText(field("jaargang"), ""), null);
  assert.equal(parseFieldText(field("eigenaar"), "Jana"), undefined);
});

test("waarden tonen", () => {
  const names = { person: (id: string) => ({ a: "Jana", b: "Jaan" })[id] ?? "?", item: () => "Vinum" };
  assert.equal(formatFieldValue(field("drinken"), [2026, 2032]), "2026–2032");
  assert.equal(formatFieldValue(field("drinken"), [2028, null]), "vanaf 2028");
  assert.equal(formatFieldValue(field("score"), 4.5), "4,5/5");
  assert.match(formatFieldValue(field("prijs"), 2450), /24,50/);
  assert.equal(
    formatFieldValue(
      field("eigenaar"),
      normalizeShares([
        { person_id: "a", share: 2 },
        { person_id: "b", share: 1 },
      ]),
      names,
    ),
    "Jana 66,7% · Jaan 33,3%",
  );
  assert.equal(formatFieldValue({ key: "v", label: "V", type: "item", ref_type: "t" }, "x", names), "Vinum");
  assert.equal(sharesText(normalizeShares([{ person_id: "a" }, { person_id: "b" }]), names.person), "Jana en Jaan");
});

test("periode: nu, later of voorbij", () => {
  assert.equal(rangeStatus([2025, 2030], 2026), "now");
  assert.equal(rangeStatus([2028, 2035], 2026), "later");
  assert.equal(rangeStatus([2015, 2020], 2026), "past");
  assert.equal(rangeStatus([null, 2027], 2026), "now");
  assert.equal(rangeStatus(undefined, 2026), null);
});

test("een lijst inlezen: komma, puntkomma, tab en aanhalingstekens", () => {
  assert.deepEqual(parseSheet('﻿Wijn,Jaargang\r\n"Chablis, 1er cru",2019\r\n\r\n"Zeg ""santé""",\n'), {
    headers: ["Wijn", "Jaargang"],
    rows: [
      ["Chablis, 1er cru", "2019"],
      ['Zeg "santé"', ""],
    ],
  });
  assert.deepEqual(parseSheet("Wijn;Prijs\nBarolo;24,50").rows, [["Barolo", "24,50"]]);
  assert.deepEqual(parseSheet('Wijn\tNotitie\nRioja\t"twee\nregels"').rows, [["Rioja", "twee\nregels"]]);
});

test("kolommen raden en rijen omzetten; onbekend en onleesbaar gaat naar de lange tekst", () => {
  const sheet = parseSheet(
    "Wijn,Domaine,Jaargang,Druif,Aantal,Prijs,Opmerking,Gekocht bij,Tags\nClos de Vougeot,Méo-Camuzet,2015,Pinot Noir,6,€ 89,Mooi,Vinum,bourgogne; cadeau\nMystery,,ca. negentig,,,,,,",
  );
  const mapping = guessMapping(sheet.headers, WINE);
  assert.deepEqual(mapping, [
    "name",
    "field:wijnhuis",
    "field:jaargang",
    "field:druiven",
    "field:aantal",
    "field:prijs",
    "field:proefnotities",
    "field:proefnotities",
    "tags",
  ]);
  const { rows, problems } = importRows(sheet, mapping, WINE);
  assert.deepEqual(rows[0], {
    name: "Clos de Vougeot",
    tags: ["bourgogne", "cadeau"],
    data: { wijnhuis: "Méo-Camuzet", jaargang: 2015, druiven: ["Pinot Noir"], aantal: 6, prijs: 8900, proefnotities: "Opmerking: Mooi\nGekocht bij: Vinum" },
  });
  assert.deepEqual(rows[1].data, { proefnotities: "Jaargang: ca. negentig" });
  assert.deepEqual(
    problems.map((p) => p.column),
    ["Jaargang"],
  );
});

test("opnieuw: een vorig item als begin van een nieuw", async () => {
  const { repeatData } = await import("../shared/fields.ts");
  const fields: FieldDef[] = [
    { key: "datum", label: "Datum", type: "date", today: true },
    { key: "gekocht", label: "Gekocht op", type: "date" },
    { key: "door", label: "Betaald door", type: "person", me: true },
    { key: "voor", label: "Voor", type: "person" },
    { key: "gram", label: "Hoeveel", type: "number" },
    { key: "kcal", label: "Kcal", type: "calc", result: "number", calc: { kind: "math", op: "*", a: { field: "gram" }, b: { n: 2 } } },
  ];
  assert.deepEqual(repeatData(fields, { datum: "2026-10-01", gekocht: "2026-09-01", door: "jana", voor: "jaan", gram: 40, kcal: 80 }, "2026-10-30"), {
    datum: "2026-10-30",
    gekocht: "2026-09-01",
    voor: "jaan",
    gram: 40,
  });
});

test("een naam van een foto koppelen aan een bestaand item", async () => {
  const { matchName } = await import("../shared/fields.ts");
  const vendors = [
    { id: "c", name: "Colruyt" },
    { id: "ch", name: "Colruyt Halle" },
    { id: "d", name: "Delhaize" },
    { id: "a", name: "AD Delhaize Lembeek" },
    { id: "x", name: "A" },
  ];
  assert.equal(matchName(vendors, "Colruyt"), "c");
  assert.equal(matchName(vendors, "COLRUYT LAAGSTE PRIJZEN - HALLE"), "c");
  assert.equal(matchName(vendors, "colruyt halle"), "ch");
  assert.equal(matchName(vendors, "AD Delhaize Lembeek nv"), "a");
  assert.equal(matchName(vendors, "Délhaize"), "d");
  // Een woord in een ander woord telt niet; te kort of niets: geen gok.
  assert.equal(matchName(vendors, "Colruytgroep"), null);
  assert.equal(matchName(vendors, "Aldi"), null);
  assert.equal(matchName(vendors, " "), null);
  // Omgekeerd: de naam op de foto is korter dan het item.
  assert.equal(matchName([{ id: "z", name: "Zeeman textielsupers" }], "Zeeman"), "z");
});

test("een verwijzing naar meer lijsten, met vrije tekst", () => {
  const [wat] = cleanFields([{ key: "wat", label: "Wat", type: "item", ref_type: "v1", ref_also: ["v2", "v1", "v2", "bad id!"], free: true }]);
  assert.deepEqual(wat.ref_also, ["v2"]);
  assert.equal(wat.free, true);
  assert.deepEqual(refLists(wat), ["v1", "v2"]);
  // Een gekozen item blijft een id; vrije tekst staat als { text }.
  assert.equal(cleanValue(wat, "abc-123"), "abc-123");
  assert.deepEqual(cleanValue(wat, { text: "  appel " }), { text: "appel" });
  assert.equal(formatFieldValue(wat, { text: "appel" }), "appel");
  // Vrije tekst telt niet als verwijzing (niets om na te kijken of aan te passen).
  assert.deepEqual(referencedItems([wat], { wat: { text: "appel" } }), []);
  assert.deepEqual(referencedItems([wat], { wat: "abc-123" }), [{ id: "abc-123", lists: ["v1", "v2"], key: "wat" }]);
  // Zonder `free` is tekst geen waarde.
  const [streng] = cleanFields([{ key: "w", label: "W", type: "item", ref_type: "v1" }]);
  assert.equal(cleanValue(streng, { text: "appel" }), null);
  assert.equal(streng.free, undefined);
  // Vrije tekst kan enkel bij één verwijzing.
  const [veel] = cleanFields([{ key: "w", label: "W", type: "items", ref_type: "v1", free: true }]);
  assert.equal(veel.free, undefined);
});
