// Jouw deel (Enkel van jou met een verdeling) en Ook uit (dezelfde lijst in andere projecten).
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanChart, computeChart, fitChart, type ChartItem } from "../shared/charts.ts";
import type { FieldDef } from "../shared/fields.ts";
import { cleanTotals, computeTotal, onlyMine } from "../shared/totals.ts";
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

test("Enkel jouw deel: van een gedeelde uitgave telt je deel, tot op de cent", () => {
  const items = [
    { data: { bedrag: 6000, datum: "2026-11-02", verdeling: half } },
    { data: { bedrag: 1001, datum: "2026-11-03", verdeling: half } },
    { data: { bedrag: 2500, datum: "2026-11-04", verdeling: [{ person_id: "jaan", share: 100 }] } },
    { data: { bedrag: 900, datum: "2026-11-04", verdeling: [{ person_id: "jana", share: 100 }] } },
    { data: { bedrag: 700, datum: "2026-11-04" } },
  ];
  const mine = onlyMine(uitgave, "verdeling", items, "jaan", "bedrag");
  assert.deepEqual(
    mine.map((i) => i.data.bedrag),
    [3000, 501, 2500],
  );
  const theirs = onlyMine(uitgave, "verdeling", items, "jana", "bedrag");
  // Samen precies het geheel: 1001 wordt 501 + 500.
  assert.equal(theirs[1].data.bedrag, 500);
  // Het item zelf blijft ongewijzigd.
  assert.equal(items[0].data.bedrag, 6000);
});

test("Enkel van jou: een persoon of personen telt het hele getal", () => {
  const fields: FieldDef[] = [
    { key: "kcal", label: "Kcal", type: "number" },
    { key: "wie", label: "Wie", type: "person" },
    { key: "met", label: "Met", type: "people" },
  ];
  const items = [{ data: { kcal: 500, wie: "jaan", met: ["jaan", "jana"] } }, { data: { kcal: 300, wie: "jana", met: ["jana"] } }];
  assert.equal(onlyMine(fields, "wie", items, "jaan", "kcal").length, 1);
  assert.deepEqual(
    onlyMine(fields, "met", items, "jana", "kcal").map((i) => i.data.kcal),
    [500, 300],
  );
  // Geen veld met mensen: niets.
  assert.equal(onlyMine(fields, "kcal", items, "jaan", "kcal").length, 0);
});

test("Mijn flessen: een fles van drie telt voor een derde", () => {
  const wijn: FieldDef[] = [
    { key: "aantal", label: "Aantal", type: "number" },
    { key: "eigenaar", label: "Eigenaar", type: "share" },
  ];
  const items = [
    { data: { aantal: 3, eigenaar: [{ person_id: "jaan", share: 1 }, { person_id: "rik", share: 1 }, { person_id: "kobe", share: 1 }] } },
    { data: { aantal: 2, eigenaar: [{ person_id: "jaan", share: 50 }, { person_id: "jana", share: 50 }] } },
    { data: { aantal: 1, eigenaar: [{ person_id: "rik", share: 100 }] } },
  ];
  const [total] = cleanTotals([{ id: "mijn", agg: "sum", field: "aantal", period: "all", mine: "eigenaar" }], wijn);
  const result = computeTotal(total, wijn, onlyMine(wijn, "eigenaar", items, "jaan", "aantal"), "2026-11-05");
  assert.equal(result.current, 2);
});

test("cleanTotals: Enkel van jou met een verdeling of personen, niet met een keuzelijst", () => {
  assert.equal(cleanTotals([{ id: "a", agg: "sum", field: "bedrag", period: "all", mine: "verdeling" }], uitgave)[0].mine, "verdeling");
  assert.throws(() => cleanTotals([{ id: "a", agg: "sum", field: "bedrag", period: "all", mine: "categorie" }], uitgave), /veld met mensen/);
});

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

test("Grafiek: Ook uit en Enkel jouw deel", () => {
  const def = cleanChart({ form: "number", agg: "sum", field: "bedrag", date: "datum", step: "month", count: 1, also: ["huis"], mine: "verdeling" })!;
  assert.deepEqual(def.also, ["huis"]);
  assert.equal(def.mine, "verdeling");
  assert.ok(fitChart(def, uitgave));
  assert.equal(fitChart({ ...def, mine: "categorie" }, uitgave), null);
  const items: ChartItem[] = [
    { name: "Huur", data: { bedrag: 80000, datum: "2026-11-01", verdeling: half }, tag_ids: [], created_at: "2026-11-01 08:00:00" },
    { name: "Fiets", data: { bedrag: 20000, datum: "2026-11-02", verdeling: [{ person_id: "jaan", share: 1 }] }, tag_ids: [], created_at: "2026-11-02 08:00:00" },
  ];
  const data = computeChart(def, uitgave, onlyMine(uitgave, "verdeling", items, "jaan", "bedrag"), { people: [], item: () => undefined, tags: [] }, "2026-11-05");
  assert.ok(data);
  assert.equal(JSON.stringify(data).includes("60000"), true);
});
