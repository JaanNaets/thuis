// Jouw deel (Enkel van jou met een verdeling) en Ook uit (dezelfde lijst in andere projecten).
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanChart, computeChart, fitChart, type ChartItem } from "../shared/charts.ts";
import type { FieldDef } from "../shared/fields.ts";
import { alsoData, alsoFits, cleanAlso, cleanView, MAX_ALSO } from "../shared/views.ts";

const uitgave: FieldDef[] = [
  { key: "bedrag", label: "Bedrag", type: "money" },
  { key: "datum", label: "Datum", type: "date" },
  { key: "categorie", label: "Categorie", type: "select", options: ["Boodschappen", "Wonen"] },
  { key: "betaald_door", label: "Betaald door", type: "person" },
  { key: "verdeling", label: "Verdeling", type: "share" },
];
const half = [
  { person_id: "jaan", share: 1 },
  { person_id: "jana", share: 1 },
];

test("Ook uit: een lijst past als minstens de helft van de velden dezelfde is", () => {
  const eigen = uitgave.filter((f) => f.key !== "betaald_door");
  assert.equal(alsoFits(uitgave, eigen), true);
  assert.equal(alsoFits(uitgave, [{ key: "bedrag", label: "Bedrag", type: "money" }]), false);
  // Dezelfde sleutel maar een andere soort telt niet.
  assert.equal(alsoFits([{ key: "bedrag", label: "Bedrag", type: "money" }], [{ key: "bedrag", label: "Bedrag", type: "number" }]), false);
  assert.equal(alsoFits([], uitgave), false);
});

test("Ook uit: enkel de velden die hier hetzelfde zijn, komen mee", () => {
  const other: FieldDef[] = [
    { key: "bedrag", label: "Prijs", type: "money" },
    { key: "datum", label: "Datum", type: "text" },
    { key: "geheim", label: "Geheim", type: "text" },
  ];
  assert.deepEqual(alsoData(uitgave, other, { bedrag: 500, datum: "gisteren", geheim: "x" }), { bedrag: 500 });
});

test("cleanAlso en cleanView: hoogstens vijf andere lijsten, niet de lijst zelf", () => {
  assert.deepEqual(cleanAlso(["a", "a", "b", "eigen", "<x>", 3], "eigen"), ["a", "b"]);
  assert.equal(cleanAlso(Array.from({ length: 9 }, (_, i) => `l${i}`)).length, MAX_ALSO);
  assert.deepEqual(cleanView({ match: "all", conditions: [], also: ["kelder"] }, uitgave).also, ["kelder"]);
  assert.equal(cleanView({ match: "all", conditions: [], also: [] }, uitgave).also, undefined);
});

test("Een verplichte datum die met vandaag begint, vult de server zelf in (Start in een timerblok)", async () => {
  const { applyFieldDefaults } = await import("../shared/fields.ts");
  const fields: FieldDef[] = [
    { key: "datum", label: "Datum", type: "date", required: true, today: true },
    { key: "los", label: "Los", type: "date", today: true },
  ];
  assert.deepEqual(applyFieldDefaults(fields, {}, ["jaan"], "jaan", true, "2026-11-05"), { datum: "2026-11-05" });
  assert.deepEqual(applyFieldDefaults(fields, { datum: "2026-11-01" }, ["jaan"], "jaan", true, "2026-11-05"), { datum: "2026-11-01" });
  assert.deepEqual(applyFieldDefaults(fields, {}, ["jaan"], "jaan", false, "2026-11-05"), {});
});
