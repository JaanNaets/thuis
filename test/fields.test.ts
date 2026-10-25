import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanAttributes,
  cleanFields,
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
  referencedPeople,
  sharesText,
  type FieldDef,
} from "../shared/fields.ts";
import { PROJECT_TEMPLATES, resolveTemplateFields } from "../shared/templates.ts";
import { descendantIds, flattenTree } from "../shared/tree.ts";

const WINE: FieldDef[] = resolveTemplateFields(PROJECT_TEMPLATES.wine.types[0].fields, {}, {});
const field = (key: string) => WINE.find((f) => f.key === key)!;

test("sjablonen: elke soort heeft geldige velden en verwijzingen", () => {
  for (const t of Object.values(PROJECT_TEMPLATES)) {
    const ids = Object.fromEntries(t.types.map((ty) => [ty.key, `id-${ty.key}`]));
    for (const ty of t.types) {
      const fields = resolveTemplateFields(ty.fields, ids, {});
      assert.deepEqual(cleanFields(fields), fields, `${t.label} › ${ty.name}`);
      assert.equal(fields.length, ty.fields.length, `${ty.name}: elke verwijzing gevonden`);
    }
  }
  // Een wijnkelder onder een huishouden verwijst naar de verkopers erboven; zonder verkopers valt het veld weg.
  const ref = [{ key: "bij", label: "Gekocht bij", type: "item" as const, ref: "verkoper" }];
  assert.deepEqual(resolveTemplateFields(ref, {}, { verkoper: "v1" }), [{ key: "bij", label: "Gekocht bij", type: "item", ref_type: "v1" }]);
  assert.deepEqual(resolveTemplateFields(ref, {}, {}), []);
});

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
  assert.throws(() => cleanFields([{ key: "v", label: "Verkoper", type: "item" }]), /soort/);
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
  assert.deepEqual(referencedItems(defs, data), [{ id: "x", ref_type: "t1", key: "i" }]);
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

test("boom: volgorde, alles eronder, lussen breken niets", () => {
  const nodes = [
    { id: "h", parent_id: null, name: "Huishouden", sort_order: 0 },
    { id: "w", parent_id: "h", name: "Wijnkelder", sort_order: 0 },
    { id: "b", parent_id: "w", name: "Bourgogne", sort_order: 0 },
    { id: "f", parent_id: "h", name: "Fietsen", sort_order: 0 },
  ];
  assert.deepEqual(
    flattenTree(nodes).map((n) => `${n.depth}:${n.name}`),
    ["0:Huishouden", "1:Fietsen", "1:Wijnkelder", "2:Bourgogne"],
  );
  assert.deepEqual([...descendantIds(nodes, "w")].sort(), ["b", "w"]);
  const loop = [
    { id: "a", parent_id: "b", name: "A", sort_order: 0 },
    { id: "b", parent_id: "a", name: "B", sort_order: 0 },
  ];
  assert.equal(flattenTree(loop).length, 0);
});
