import assert from "node:assert/strict";
import { test } from "node:test";
import { PROJECT_TEMPLATES, guessMapping, importRows, parseSheet, type FieldDef } from "../shared/fields.ts";

const wine = PROJECT_TEMPLATES.wine.fields as unknown as FieldDef[];

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
  assert.deepEqual(parseSheet("Wijn,\nX,1").headers, ["Wijn", "Kolom 2"]);
});

test("kolommen raden; onbekend gaat bij de notitie", () => {
  assert.deepEqual(guessMapping(["Wijn", "Domaine", "Jaargang", "Jaar", "Aantal", "Gekocht bij"], wine), [
    "name",
    "brand",
    "field:vintage",
    "notes",
    "quantity",
    "notes",
  ]);
});

test("rijen omzetten, met wat niet te lezen is in de notitie", () => {
  const sheet = parseSheet(
    "Wijn,Domaine,Jaargang,Druiven,Drinken,Prijs,Aantal,Opmerking,Gekocht bij\n" +
      "Clos de Vougeot,Méo-Camuzet,2015,Pinot Noir,2025-2035,€ 89,6,Mooi,Vinum\n" +
      "Mystery,,ca. negentig,,,,twee,,",
  );
  const mapping = guessMapping(sheet.headers, wine);
  const { rows, problems } = importRows(sheet, mapping, wine);
  assert.deepEqual(rows[0], {
    name: "Clos de Vougeot",
    brand: "Méo-Camuzet",
    quantity: 6,
    attributes: { vintage: 2015, grapes: ["Pinot Noir"], drink: [2025, 2035], price: 8900 },
    notes: "Opmerking: Mooi\nGekocht bij: Vinum",
  });
  assert.deepEqual(rows[1].attributes, {});
  assert.equal(rows[1].quantity, undefined);
  assert.equal(rows[1].notes, "Jaargang: ca. negentig\nAantal: twee");
  assert.deepEqual(
    problems.map((p) => p.column),
    ["Jaargang", "Aantal"],
  );
});
