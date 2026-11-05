import assert from "node:assert/strict";
import { test } from "node:test";
import { boardWindow, bucketStart, chartWindow, cleanChart, computeChart, fitChart, type ChartItem, type ChartNames } from "../shared/charts.ts";
import type { FieldDef } from "../shared/fields.ts";

const fields: FieldDef[] = [
  { key: "datum", label: "Datum", type: "date" },
  { key: "bedrag", label: "Bedrag", type: "money" },
  { key: "wie", label: "Betaald door", type: "person" },
  { key: "soort", label: "Categorie", type: "select", options: ["Eten", "Energie", "Auto"] },
  { key: "notitie", label: "Notitie", type: "longtext" },
];
const names: ChartNames = {
  people: [
    { id: "p1", name: "Jaan" },
    { id: "p2", name: "Jana" },
  ],
  item: () => undefined,
  tags: [],
};
const item = (datum: string, bedrag: number, wie: string, soort: string): ChartItem => ({ name: "x", data: { datum, bedrag, wie, soort }, tag_ids: [], created_at: "2026-01-01 10:00:00" });
const items = [
  item("2026-11-03", 4000, "p1", "Eten"),
  item("2026-11-04", 2000, "p2", "Energie"),
  item("2026-11-05", 1000, "p1", "Eten"),
  item("2026-10-28", 5000, "p2", "Auto"),
  item("2026-10-01", 9900, "p1", "Auto"),
];

test("grafiek: nagekeken op vorm en op de velden die de lezer ziet", () => {
  assert.equal(cleanChart({ form: "taart", agg: "sum", step: "day" }), null);
  assert.equal(cleanChart({ form: "bars", agg: "sum", step: "day" }), null, "een som zonder getal");
  assert.equal(cleanChart({ form: "ranked", agg: "count", step: "month" }), null, "per keuze zonder keuze");
  const def = cleanChart({ form: "bars", agg: "sum", field: "bedrag", date: "datum", step: "week", count: 1, by: "wie", view: "../x" })!;
  assert.deepEqual(def, { form: "bars", agg: "sum", field: "bedrag", date: "datum", step: "week", count: 2, by: "wie" });
  assert.ok(fitChart(def, fields));
  assert.equal(fitChart({ ...def, field: "notitie" }, fields), null, "een lange tekst is geen getal");
  assert.equal(fitChart({ ...def, by: "bedrag" }, fields), null, "per bedrag kan niet");
  assert.equal(fitChart(def, fields.filter((f) => f.key !== "wie")), null, "een veld dat je niet ziet");
});

test("periodes: een week begint op maandag, de laatste N tot vandaag", () => {
  assert.equal(bucketStart("2026-11-05", "week"), "2026-11-02");
  assert.equal(bucketStart("2026-11-02", "week"), "2026-11-02");
  assert.equal(bucketStart("2026-11-08", "week"), "2026-11-02");
  assert.deepEqual(chartWindow({ form: "bars", agg: "count", date: "created", step: "month", count: 3 }, "2026-11-05"), { from: "2026-09-01", to: "2026-11-05" });
  assert.deepEqual(boardWindow("last_month", "2026-11-05"), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(boardWindow("months12", "2026-11-05"), { from: "2025-12-01", to: "2026-11-05" });
  assert.deepEqual(boardWindow("last_year", "2026-01-10"), { from: "2025-01-01", to: "2025-12-31" });
});

test("staafjes per week, apart per persoon: elke persoon zijn vaste kleur", () => {
  const data = computeChart({ form: "bars", agg: "sum", field: "bedrag", date: "datum", step: "week", count: 2, by: "wie" }, fields, items, names, "2026-11-05")!;
  assert.deepEqual(data.buckets.map((b) => b.key), ["2026-10-26", "2026-11-02"]);
  assert.deepEqual(data.series.map((s) => [s.label, s.slot, s.values]), [
    ["Jaan", 0, [0, 5000]],
    ["Jana", 1, [5000, 2000]],
  ]);
  assert.equal(data.unit.kind, "money");
  assert.equal(data.window, "Laatste 2 weken");
});

test("getal: de som over de periode en de periode ervoor", () => {
  const data = computeChart({ form: "number", agg: "sum", field: "bedrag", date: "datum", step: "month", count: 1 }, fields, items, names, "2026-11-05")!;
  assert.equal(data.total, 7000);
  assert.equal(data.previous, 14900);
  assert.equal(data.window, "Deze maand");
  const count = computeChart({ form: "number", agg: "count", date: "datum", step: "month", count: 0 }, fields, items, names, "2026-11-05")!;
  assert.equal(count.total, 5);
  assert.equal(count.previous, null);
});

test("per keuze: grootste eerst; de kleur volgt de keuze, niet de rangorde", () => {
  const data = computeChart({ form: "ranked", agg: "sum", field: "bedrag", date: "datum", step: "month", count: 0, by: "soort" }, fields, items, names, "2026-11-05")!;
  assert.deepEqual(data.buckets.map((b) => [b.label, b.slot]), [
    ["Auto", 2],
    ["Eten", 0],
    ["Energie", 1],
  ]);
  assert.deepEqual(data.series[0].values, [14900, 5000, 2000]);
  // Een vaste periode voor het hele overzicht (verslag): enkel november.
  const nov = computeChart({ form: "parts", agg: "count", date: "datum", step: "month", count: 0, by: "soort" }, fields, items, names, "2026-11-05", { from: "2026-11-01", to: "2026-11-30" })!;
  assert.deepEqual(nov.buckets.map((b) => b.label), ["Eten", "Energie"]);
  assert.equal(nov.total, 3);
  assert.equal(nov.window, "1/11 – 30/11");
});
