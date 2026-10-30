import assert from "node:assert/strict";
import { test } from "node:test";
import { csvFilename, exportValue, toCsv } from "../shared/csv.ts";
import type { FieldDef } from "../shared/fields.ts";

const names = { person: (id: string) => ({ a: "Jaan", b: "Ana" })[id] ?? "?", item: (id: string) => ({ c: "Colruyt" })[id] ?? "Verborgen" };
const f = (type: FieldDef["type"], extra: Partial<FieldDef> = {}): FieldDef => ({ key: "x", label: "X", type, ...extra });

test("export: getallen om mee te rekenen, datums als 2026-10-30, de rest leesbaar", () => {
  assert.equal(exportValue(f("money"), 95050, names), "950,50");
  assert.equal(exportValue(f("number", { unit: "kg" }), 82.4, names), "82,4");
  assert.equal(exportValue(f("calc", { result: "money" }), 1200, names), "12,00");
  assert.equal(exportValue(f("date"), "2026-10-30", names), "2026-10-30");
  assert.equal(exportValue(f("person"), "a", names), "Jaan");
  assert.equal(exportValue(f("item"), "c", names), "Colruyt");
  assert.equal(exportValue(f("share"), [{ person_id: "a", share: 60 }, { person_id: "b", share: 40 }], names), "Jaan 60% · Ana 40%");
  assert.equal(exportValue(f("bool"), true, names), "Ja");
  assert.equal(exportValue(f("multi"), ["Rood", "Wit"], names), "Rood, Wit");
  assert.equal(exportValue(f("text"), undefined, names), "");
});

test("export: CSV met ; en aanhalingstekens waar nodig, en een BOM voor Excel", () => {
  const csv = toCsv([
    ["Naam", "Bedrag", "Notitie"],
    ["Huur", "950,00", 'Zei "ok"; betaald'],
    ["Brood", "2,10", "twee\nregels"],
  ]);
  assert.equal(csv, '﻿Naam;Bedrag;Notitie\r\nHuur;950,00;"Zei ""ok""; betaald"\r\nBrood;2,10;"twee\nregels"\r\n');
  assert.equal(csvFilename("Ingrediënten", "2026-10-30"), "Ingredienten-2026-10-30.csv");
  assert.equal(csvFilename("Wie/moet wie?", "2026-10-30"), "Wie-moet-wie-2026-10-30.csv");
  assert.equal(csvFilename("???", "2026-10-30"), "lijst-2026-10-30.csv");
});
