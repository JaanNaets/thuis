import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCalcs } from "../shared/calc.ts";
import { applyFieldDefaults, cleanFields, type Attributes, type FieldDef } from "../shared/fields.ts";
import {
  cleanTotals,
  computeTotal,
  isPayments,
  itemNet,
  periodKey,
  recentPeriods,
  renameTotals,
  settleUp,
  sourceMisfit,
  splitCents,
  totalLabel,
  visibleTotals,
  type TotalDef,
} from "../shared/totals.ts";

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
  // Tot op de cent: samen precies het bedrag (de cent die overschiet, gaat naar wie het dichtst bij zat).
  assert.deepEqual(t.groups, [
    { key: "an", value: 2501 },
    { key: "jan", value: 1500 },
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

// ---------- saldo en verrekenen (de kostenverdeling) ----------

const costs: FieldDef[] = [
  { key: "bedrag", label: "Bedrag", type: "money" },
  { key: "datum", label: "Datum", type: "date" },
  { key: "door", label: "Betaald door", type: "person", me: true },
  { key: "voor", label: "Verdeling", type: "share", fill: true },
  { key: "van", label: "Van", type: "person" },
  { key: "aan", label: "Aan", type: "person" },
  { key: "cat", label: "Categorie", type: "select", options: ["Eten", "Huis"] },
  { key: "dubbel", label: "Dubbel", type: "calc", result: "money", calc: { kind: "math", op: "*", a: { field: "bedrag" }, b: { n: 2 } } },
];
const saldo: TotalDef = { id: "saldo", agg: "sum", field: "bedrag", period: "all", by: "door", against: "voor", settle: true, scope: "tree" };
const terug: TotalDef = { id: "saldo", agg: "sum", field: "bedrag", period: "all", by: "van", against: "aan", settle: true, scope: "tree" };
const half = [
  { person_id: "jaan", share: 50 },
  { person_id: "jana", share: 50 },
];
const netOf = (t: TotalDef, rows: Attributes[]) => {
  const net = new Map<string, number>();
  for (const data of rows) for (const [k, v] of itemNet(t, costs, data) ?? []) net.set(k, (net.get(k) ?? 0) + v);
  return net;
};

test("saldo en verrekenen nakijken", () => {
  const clean = (raw: unknown) => cleanTotals([raw], costs)[0];
  assert.deepEqual(clean({ ...saldo, scope: undefined }), saldo);
  assert.equal(totalLabel(saldo, costs), "Wie moet wie");
  assert.equal(totalLabel({ id: "a", agg: "sum", field: "bedrag", period: "month", date: "datum", by: "door", against: "voor" }, costs), "Saldo bedrag per maand");
  assert.ok(isPayments(terug, costs));
  assert.ok(!isPayments(saldo, costs));
  const bad = (raw: unknown) => () => clean(raw);
  assert.throws(bad({ ...saldo, agg: "avg" }), /tegenover: enkel bij een som/);
  assert.throws(bad({ ...saldo, by: undefined }), /tegenover: enkel bij een som/);
  assert.throws(bad({ ...saldo, against: "door" }), /ander veld/);
  assert.throws(bad({ ...saldo, against: "datum" }), /tegenover: kies/);
  assert.throws(bad({ ...saldo, against: undefined }), /verrekenen: kies apart per/);
  assert.throws(bad({ ...saldo, field: "dubbel" }), /verrekenen: kies een bedrag/);
  assert.throws(bad({ ...saldo, by: "cat", against: "voor" }), /persoon of een verdeling/);
  assert.throws(bad({ ...saldo, period: "month", date: "datum" }), /alles samen/);
  assert.throws(() => cleanTotals([saldo, { ...terug, id: "b" }], costs), /hooguit één/);
  // Verrekenen telt altijd ook in de subprojecten.
  assert.equal(clean({ ...saldo, scope: "project" }).scope, "tree");
  // Ook uit andere lijsten: ids, hooguit vijf, zonder dubbels.
  assert.deepEqual(clean({ id: "a", agg: "count", period: "all", sources: ["x", "x", "y"] }).sources, ["x", "y"]);
  assert.throws(bad({ id: "a", agg: "count", period: "all", sources: ["a", "b", "c", "d", "e", "f"] }), /hooguit 5/);
  assert.throws(bad({ id: "a", agg: "count", period: "all", sources: [3] }), /ook uit/);
});

test("een bedrag verdelen tot op de cent", () => {
  const three = [
    { person_id: "a", share: 33.33 },
    { person_id: "b", share: 33.33 },
    { person_id: "c", share: 33.34 },
  ];
  const sum = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);
  // € 10,00 over drie: wie betaalde, draagt de cent die overschiet.
  assert.deepEqual(Object.fromEntries(splitCents(1000, three, "a")), { a: 334, b: 333, c: 333 });
  assert.equal(sum(splitCents(1001, three, "b")), 1001);
  // Een terugbetaling of korting (negatief) verdeelt net zo.
  assert.deepEqual(Object.fromEntries(splitCents(-1000, three, "a")), { a: -334, b: -333, c: -333 });
  assert.equal(splitCents(1000, []).size, 0);
});

test("wie moet wie: een saldo dat verrekent", () => {
  // Jaan betaalt € 100 voor twee, Jana € 30 voor twee: Jana moet Jaan € 35.
  const spent = [
    { bedrag: 10000, door: "jaan", voor: half },
    { bedrag: 3000, door: "jana", voor: half },
  ];
  const net = netOf(saldo, spent);
  assert.deepEqual(Object.fromEntries(net), { jaan: 3500, jana: -3500 });
  assert.deepEqual(settleUp(net), [{ from: "jana", to: "jaan", amount: 3500 }]);
  // Jana betaalt € 35 terug (Van Jana, Aan Jaan): alles verrekend.
  for (const [k, v] of itemNet(terug, costs, { bedrag: 3500, van: "jana", aan: "jaan" })!) net.set(k, net.get(k)! + v);
  assert.deepEqual(settleUp(net), []);
  // Met drie: wie betaalde draagt de cent, samen altijd 0, zo weinig mogelijk overschrijvingen.
  const three = netOf(saldo, [
    { bedrag: 9001, door: "a", voor: [{ person_id: "a", share: 1 }, { person_id: "b", share: 1 }, { person_id: "c", share: 1 }] },
    { bedrag: 3000, door: "b", voor: [{ person_id: "c", share: 100 }] },
  ]);
  assert.equal([...three.values()].reduce((s, v) => s + v, 0), 0);
  assert.deepEqual(settleUp(three), [{ from: "c", to: "a", amount: 6000 }]);
  // Een item telt enkel mee als beide kanten iemand hebben (anders kwam het niet op 0 uit).
  assert.equal(itemNet(saldo, costs, { bedrag: 500, door: "a" }), null);
  assert.equal(itemNet(saldo, costs, { door: "a", voor: half }), null);
  assert.equal(itemNet(saldo, costs, { bedrag: 0, door: "a", voor: half }), null);
  // Op het project: het saldo per persoon (+ krijgt, − moet), zonder wie op 0 staat.
  const r = computeTotal({ ...saldo, settle: undefined }, costs, spent.map((data) => ({ data })), "2026-10-30");
  assert.equal(r.current, 13000);
  assert.deepEqual(r.groups, [
    { key: "jaan", value: 3500 },
    { key: "jana", value: -3500 },
  ]);
});

test("velden die zelf invullen: jij betaalde, de gewone verdeling", () => {
  const members = ["jaan", "jana"];
  assert.deepEqual(applyFieldDefaults(costs, { bedrag: 1000 }, members, "jaan", true), { bedrag: 1000, door: "jaan", voor: half });
  // Bewerken: wie betaalde blijft leeg als je het leegmaakt; een lege verdeling wordt wel gevuld.
  assert.deepEqual(applyFieldDefaults(costs, { bedrag: 1000 }, members, "jaan", false), { bedrag: 1000, voor: half });
  // Wat ingevuld is, blijft; wie niet in het project zit, wordt niet ingevuld.
  assert.deepEqual(applyFieldDefaults(costs, { door: "jana" }, members, "iemand", true).door, "jana");
  assert.equal(applyFieldDefaults(costs, {}, members, "iemand", true).door, undefined);
  // De gewone verdeling, met enkel wie nog in het project zit.
  const sixty = costs.map((f) => (f.key === "voor" ? { ...f, default_shares: [{ person_id: "jaan", share: 60 }, { person_id: "weg", share: 40 }] } : f));
  assert.deepEqual(applyFieldDefaults(sixty, {}, members, "jaan", true).voor, [{ person_id: "jaan", share: 100 }]);
  // Nakijken: enkel bij de juiste soort, en de verdeling in procenten.
  const [door, voor, tekst] = cleanFields([
    { key: "door", label: "Door", type: "person", me: true },
    { key: "voor", label: "Voor", type: "share", fill: true, default_shares: [{ person_id: "a", share: 3 }, { person_id: "b", share: 2 }] },
    { key: "t", label: "T", type: "text", me: true, fill: true },
  ]);
  assert.equal(door.me, true);
  assert.deepEqual(voor.default_shares, [{ person_id: "a", share: 60 }, { person_id: "b", share: 40 }]);
  assert.equal(tekst.me, undefined);
  assert.equal(tekst.fill, undefined);
});

test("ook uit een lijst in een ander project: dezelfde velden", () => {
  const t: TotalDef = { id: "a", agg: "sum", field: "bedrag", period: "month", date: "datum", by: "door" };
  assert.equal(sourceMisfit(t, costs, costs), null);
  assert.match(sourceMisfit(t, costs, costs.filter((f) => f.key !== "datum"))!, /geen veld "Datum"/);
  assert.match(sourceMisfit(t, costs, costs.map((f) => (f.key === "bedrag" ? { ...f, type: "number" as const } : f)))!, /ander soort/);
  assert.match(sourceMisfit(t, costs, costs.map((f) => (f.key === "door" ? { ...f, type: "people" as const } : f)))!, /ander soort/);
});

test("sjablonen: hun totalen passen bij hun velden", async () => {
  const { listTemplates, resolveTemplateLists, typeTemplate } = await import("../shared/templates.ts");
  for (const list of listTemplates()) {
    if (!list.totals) continue;
    // Verwijzingen naar andere lijsten doen hier niet ter zake (een totaal telt geen verwijzing).
    const plans = [{ id: "x", list: { ...list, fields: list.fields.filter((f) => !f.ref) }, refs: {}, calcs: {} }];
    const fields = resolveTemplateLists(plans, {})["x"];
    assert.deepEqual(cleanTotals(list.totals, fields), list.totals, list.name);
  }
  const settle = typeTemplate("terugbetaling")!;
  assert.ok(isPayments(settle.totals![0], settle.fields as FieldDef[]));
  assert.equal(typeTemplate("bestaat-niet"), undefined);
});
