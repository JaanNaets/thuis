import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCalcs } from "../shared/calc.ts";
import type { FieldDef } from "../shared/fields.ts";
import { cleanTotals, computeTotal, periodKey, recentPeriods, renameTotals, totalLabel, visibleTotals } from "../shared/totals.ts";

const fields: FieldDef[] = checkCalcs(
  [
    { key: "datum", label: "Datum", type: "date" },
    { key: "maaltijd", label: "Maaltijd", type: "select", options: ["Ontbijt", "Middag", "Avond"] },
    { key: "kcal_100", label: "kcal per 100 g", type: "number" },
    { key: "gram", label: "Hoeveel", type: "number" },
    { key: "kcal", label: "Kcal", type: "calc", calc: { kind: "formula", expr: "[kcal_100] * [gram] / 100" } },
    { key: "bedrag", label: "Bedrag", type: "money" },
    { key: "wie", label: "Wie", type: "share" },
    { key: "notitie", label: "Notitie", type: "text" },
  ],
  [],
  "self",
);

test("totalen nakijken", () => {
  const [t] = cleanTotals([{ agg: "sum", field: "kcal", period: "day", date: "datum", goal: 1800, goal_kind: "max", extra: 1 }], fields);
  assert.deepEqual(t, { id: "t1", agg: "sum", field: "kcal", period: "day", date: "datum", goal: 1800, goal_kind: "max" });
  assert.deepEqual(cleanTotals([{ id: "a", agg: "count", field: "kcal", period: "all", label: "  Hoeveel keer  " }], fields), [
    { id: "a", agg: "count", period: "all", label: "Hoeveel keer" },
  ]);
  // Dubbele id's worden uniek.
  assert.deepEqual(
    cleanTotals([{ id: "a", agg: "count", period: "all" }, { id: "a", agg: "count", period: "all" }], fields).map((t) => t.id),
    ["a", "ax"],
  );
  assert.deepEqual(cleanTotals(undefined, fields), []);

  const bad = (raw: unknown) => () => cleanTotals([raw], fields);
  assert.throws(bad({ agg: "sum", field: "notitie", period: "all" }), /Totaal 1: "Notitie" is geen getal/);
  assert.throws(bad({ agg: "sum", period: "all" }), /kies welk getal/);
  assert.throws(bad({ agg: "sum", field: "kcal", period: "day" }), /kies een datumveld/);
  assert.throws(bad({ agg: "sum", field: "kcal", period: "day", date: "gram" }), /"Hoeveel" is geen datum/);
  assert.throws(bad({ agg: "sum", field: "kcal", period: "uur" }), /kies over welke periode/);
  assert.throws(bad({ agg: "som", field: "kcal", period: "all" }), /kies wat je wil weten/);
  assert.throws(bad({ agg: "sum", field: "kcal", period: "all", by: "notitie" }), /apart per/);
  assert.throws(bad({ label: "Kcal", agg: "sum", field: "kcal", period: "all", goal: -1 }), /Kcal: het doel/);
  assert.throws(() => cleanTotals(Array(5).fill({ agg: "count", period: "all" }), fields), /Hoogstens 4/);
  assert.throws(() => cleanTotals("x", fields), /kloppen niet/);
});

test("totalen: naam, hernoemen, wat je ziet", () => {
  assert.equal(totalLabel({ id: "a", agg: "sum", field: "kcal", period: "day", date: "datum" }, fields), "Kcal per dag");
  assert.equal(totalLabel({ id: "a", agg: "avg", field: "bedrag", period: "month", date: "datum" }, fields), "Gemiddelde bedrag per maand");
  assert.equal(totalLabel({ id: "a", agg: "count", period: "all" }, fields), "Aantal");
  assert.equal(totalLabel({ id: "a", label: "Eigen", agg: "count", period: "all" }, fields), "Eigen");

  const renamed = renameTotals([{ id: "a", agg: "sum", field: "k", period: "day", date: "d", by: "weg" }], (k) =>
    k === "k" ? "kcal" : k === "d" ? "datum" : undefined,
  );
  assert.deepEqual(renamed, [{ id: "a", agg: "sum", field: "kcal", period: "day", date: "datum" }]);

  // Zie je een veld waarvan Kcal afhangt niet, dan ook het totaal niet.
  const total = { id: "a", agg: "sum", field: "kcal", period: "day", date: "datum" } as const;
  assert.equal(visibleTotals([total], fields).length, 1);
  assert.equal(visibleTotals([total], fields.filter((f) => f.key !== "gram")).length, 0);
  assert.equal(visibleTotals([total], fields.filter((f) => f.key !== "datum")).length, 0);
});

test("periodes", () => {
  assert.equal(periodKey("day", "2026-10-30"), "2026-10-30");
  // Een week begint op maandag.
  assert.equal(periodKey("week", "2026-10-30"), "2026-10-26");
  assert.equal(periodKey("week", "2026-10-26"), "2026-10-26");
  assert.equal(periodKey("week", "2026-11-01"), "2026-10-26");
  assert.equal(periodKey("month", "2026-10-30"), "2026-10");
  assert.equal(periodKey("year", "2026-10-30"), "2026");
  assert.deepEqual(recentPeriods("day", "2026-03-02").slice(-3), ["2026-02-28", "2026-03-01", "2026-03-02"]);
  assert.deepEqual(recentPeriods("week", "2026-01-02").slice(-2), ["2025-12-22", "2025-12-29"]);
  assert.deepEqual(recentPeriods("month", "2026-02-15"), ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.deepEqual(recentPeriods("year", "2026-02-15"), ["2022", "2023", "2024", "2025", "2026"]);
  assert.deepEqual(recentPeriods("all", "2026-02-15"), ["all"]);
});

test("totalen uitrekenen", () => {
  const items = [
    { data: { datum: "2026-10-30", maaltijd: "Ontbijt", kcal: 350 } },
    { data: { datum: "2026-10-30", maaltijd: "Middag", kcal: 600.5 } },
    { data: { datum: "2026-10-30", maaltijd: "Ontbijt", kcal: 100 } },
    { data: { datum: "2026-10-29", maaltijd: "Avond", kcal: 900 } },
    // Zonder datum, zonder getal, of te oud: telt niet mee.
    { data: { maaltijd: "Avond", kcal: 50 } },
    { data: { datum: "2026-10-30", maaltijd: "Avond" } },
    { data: { datum: "2026-01-01", kcal: 5000 } },
  ];
  const day = computeTotal({ id: "a", agg: "sum", field: "kcal", period: "day", date: "datum", by: "maaltijd" }, fields, items, "2026-10-30");
  assert.equal(day.current, 1050.5);
  assert.equal(day.periods.length, 7);
  assert.deepEqual(day.periods.slice(-2), [
    { key: "2026-10-29", value: 900 },
    { key: "2026-10-30", value: 1050.5 },
  ]);
  // Een dag zonder items telt 0.
  assert.equal(day.periods[0].value, 0);
  assert.deepEqual(day.groups, [
    { key: "Middag", value: 600.5 },
    { key: "Ontbijt", value: 450 },
  ]);
  assert.equal(day.result, "number");

  const count = computeTotal({ id: "a", agg: "count", period: "all" }, fields, items, "2026-10-30");
  assert.equal(count.current, 7);
  const avg = computeTotal({ id: "a", agg: "avg", field: "kcal", period: "week", date: "datum" }, fields, items, "2026-10-30");
  assert.equal(avg.current, 487.625);
  const max = computeTotal({ id: "a", agg: "max", field: "kcal", period: "day", date: "datum" }, fields, items, "2026-10-28");
  assert.equal(max.current, undefined);
});

test("totalen: een bedrag verdeeld volgens aandeel", () => {
  const items = [
    { data: { bedrag: 3000, wie: [{ person_id: "jan", share: 1 }, { person_id: "an", share: 2 }] } },
    { data: { bedrag: 1001, wie: [{ person_id: "an", share: 50 }, { person_id: "jan", share: 50 }] } },
    { data: { bedrag: 500 } },
  ];
  const t = computeTotal({ id: "a", agg: "sum", field: "bedrag", period: "all", by: "wie" }, fields, items, "2026-10-30");
  assert.equal(t.current, 4501);
  assert.equal(t.result, "money");
  // In cent afgerond.
  assert.deepEqual(t.groups, [
    { key: "an", value: 2501 },
    { key: "jan", value: 1501 },
  ]);
});

test("sjabloon Voeding: formule en totaal kloppen", async () => {
  const { PROJECT_TEMPLATES, resolveTemplateLists } = await import("../shared/templates.ts");
  const { computeLocal } = await import("../shared/calc.ts");
  const list = PROJECT_TEMPLATES.food.types[0];
  const fields = resolveTemplateLists([{ id: "e", list, refs: {}, calcs: {} }], {})["e"];
  assert.equal(fields.find((f) => f.key === "kcal")?.result, "number");
  assert.equal(computeLocal(fields, { kcal_100: 380, gram: 45 }).kcal, 171);
  assert.deepEqual(cleanTotals(list.totals, fields), [{ id: "dag", agg: "sum", field: "kcal", period: "day", date: "datum" }]);
  assert.equal(totalLabel(list.totals![0], fields), "Kcal per dag");
  assert.equal(fields.find((f) => f.key === "datum")?.today, true);
});
