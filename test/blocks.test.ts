import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanActionBlock, cleanViewBlock, columnsOf, evaluateView, chartOf, sourceFields, upgradeBlock, viewName, type SourceItem, type ViewBlock } from "../shared/blocks.ts";
import { cleanBlock, cleanBlocks, defaultBlocks, segmentBlocks, type Block } from "../shared/board.ts";
import type { FieldDef } from "../shared/fields.ts";
import { NAME } from "../shared/views.ts";

const names = { person: (id: string) => ({ jaan: "Jaan", jana: "Jana" })[id] ?? "?", item: (id: string) => ({ k: "Komkommer", p: "Pasta" })[id] ?? "?" };
const chartNames = { people: [{ id: "jaan", name: "Jaan" }], item: (id: string) => names.item(id), tags: [] };
const ctx = { today: "2026-11-06", me: "jaan", names, chart: chartNames };

const logFields = sourceFields("logboek", {
  lists: [{ name: "Jaan", fields: [] }],
  kinds: [
    { name: "Gegeten", fields: [{ key: "kcal", label: "Kcal", type: "number" }] },
    { name: "Water", fields: [{ key: "ml", label: "Hoeveel", type: "number", unit: "ml" }] },
  ],
});

const ev = (id: string, at: string, kind: string, extra: Record<string, unknown> = {}): SourceItem => ({
  id,
  name: kind,
  data: { at, kind, status: "Gebeurd", list: "Jaan", ...extra },
  tag_ids: [],
  created_at: `${at} 10:00:00`,
});

const items: SourceItem[] = [
  ev("1", "2026-11-06", "Gegeten", { kcal: 500, things: ["k"] }),
  ev("2", "2026-11-05", "Gegeten", { kcal: 700, things: ["p"] }),
  ev("3", "2026-11-04", "Gegeten", { kcal: 300, things: ["k", "p"] }),
  ev("4", "2026-11-06", "Water", { ml: 250 }),
  ev("5", "2026-11-06", "Water", { ml: 250, status: "Gepland" }),
];

test("de bronnen: het logboek met de velden van zijn soorten, de rest met hun eigen velden", () => {
  const keys = logFields.map((f) => f.key);
  for (const k of [NAME, "at", "kind", "amount", "status", "things", "running", "kcal", "ml"]) assert.ok(keys.includes(k), k);
  assert.equal(new Set(keys).size, keys.length, "geen dubbele sleutels");
  assert.deepEqual(
    sourceFields("saldo", { lists: [], kinds: [] }).map((f) => f.key),
    [NAME, "from", "to", "amount"],
  );
  assert.ok(sourceFields("voeding", { lists: [], kinds: [] }).some((f) => f.key === "kcal" && f.unit === "kcal"));
  const dingen = sourceFields("dingen", {
    lists: [
      { name: "A", fields: [{ key: "prijs", label: "Prijs", type: "money" }] },
      { name: "B", fields: [{ key: "prijs", label: "Prijs", type: "money" }, { key: "kleur", label: "Kleur", type: "text" }] },
    ],
    kinds: [],
  });
  assert.deepEqual(
    dingen.map((f) => f.key),
    [NAME, "prijs", "kleur"],
  );
});

test("een weergave nakijken: wat niet klopt valt weg, de dingen vragen een lijst", () => {
  assert.equal(cleanViewBlock({ source: "gevaar" }), null);
  assert.equal(cleanViewBlock({ source: "dingen", lists: [] }), null);
  const v = cleanViewBlock({
    name: "  Komkommer per week ".repeat(3),
    source: "logboek",
    lists: ["L1", "L1", "<script>"],
    where: { match: "any", conditions: [{ field: "things", op: "any_of", value: ["k"] }, { field: "Bad Key!", op: "is" }], sort: [{ field: "at", dir: "desc" }] },
    show: "staafjes",
    tally: { agg: "sum", step: "week", n: 8 },
    limit: 999,
    rules: [{ when: "uitkomst", op: "gt", value: 5, then: "oranje" }, { when: "rij", cond: { field: "kcal", op: "gt", value: 600 }, then: "rood" }, { when: "?" }],
  })!;
  assert.equal(v.name.length, 40);
  assert.deepEqual(v.lists, ["L1"]);
  assert.equal(v.where.match, "any");
  assert.equal(v.where.conditions.length, 1);
  assert.deepEqual(v.tally, { agg: "count", step: "week", n: 8 }, "een som zonder veld wordt een aantal");
  assert.equal(v.limit, undefined, "een grafiek heeft geen rijen");
  assert.equal(v.rules?.length, 2);
  const a = cleanActionBlock({ list: "L1", type: "k1", does: "save", values: { ml: 250, name: "Glas water", "x y": 1, obj: { a: 1 } } })!;
  assert.deepEqual(a, { kind: "action", name: "", list: "L1", type: "k1", does: "save", values: { ml: 250, name: "Glas water" } });
  assert.equal(cleanActionBlock({ type: "k1" }), null);
});

test("oude blokken worden de gelijkwaardige weergave of actie", () => {
  const money = upgradeBlock({ kind: "money" }) as ViewBlock;
  assert.equal(money.name, "Uitgaven deze maand");
  assert.equal(money.show, "getal");
  assert.deepEqual(money.tally, { agg: "sum", field: "amount", step: "month", n: 1 });
  assert.equal((upgradeBlock({ kind: "todo" }) as ViewBlock).where.conditions[0].value?.toString(), "Gepland");
  assert.equal((upgradeBlock({ kind: "balance" }) as ViewBlock).source, "saldo");
  assert.equal((upgradeBlock({ kind: "stock" }) as ViewBlock).source, "voorraad");
  assert.equal((upgradeBlock({ kind: "food" }) as ViewBlock).source, "voeding");
  assert.deepEqual((upgradeBlock({ kind: "timers" }) as ViewBlock).rules, [{ when: "leeg", then: "verbergen" }]);
  assert.deepEqual(upgradeBlock({ kind: "quick", list: "L1", type: "k1" }), { kind: "action", name: "", list: "L1", type: "k1", does: "form", values: {} });
  const chart = upgradeBlock({ kind: "chart", list: null, source: "logboek", chart: { form: "ranked", agg: "sum", field: "amount", date: "at", step: "month", count: 1, by: "paid_by" } }) as ViewBlock;
  assert.equal(chart.show, "perkeuze");
  assert.deepEqual(chart.tally, { agg: "sum", field: "amount", by: "paid_by", step: "month", n: 1 });
  assert.equal(upgradeBlock({ kind: "onbekend" }), null);
  // Een bord met oude blokken, nagekeken: elk blok is nu een weergave, actie of ding; de breedte blijft.
  const board = cleanBlocks([{ kind: "money", wide: true }, { kind: "quick", list: "L1" }, { kind: "thing", thing: "T1" }, { kind: "money" }])!;
  assert.deepEqual(
    board.map((b) => b.kind),
    ["view", "action", "thing"],
  );
  assert.equal(board[0].wide, true);
  assert.equal(cleanBlock({ kind: "view", source: "saldo", show: "lijst" })?.kind, "view");
  // Vanzelf: enkel wat er is.
  assert.deepEqual(
    defaultBlocks([{ id: "x", archived: 0 }], { money: false, stock: true }).map((b) => (b.kind === "view" ? b.name : "")),
    ["Te doen", "Bijna op"],
  );
  assert.deepEqual(defaultBlocks([], { money: true, stock: true }), []);
});

test("uitrekenen: de zin filtert, een lijst sorteert en volgt de voorwaarden op wat je ziet", () => {
  const eaten: ViewBlock = {
    kind: "view",
    name: "",
    source: "logboek",
    lists: [],
    where: { match: "all", conditions: [{ field: "kind", op: "any_of", value: ["Gegeten"] }], sort: [{ field: "kcal", dir: "desc" }] },
    show: "lijst",
    limit: 2,
    rules: [
      { when: "rij", cond: { field: "kcal", op: "gt", value: 600 }, then: "rood" },
      { when: "rij", cond: { field: "things", op: "any_of", value: ["k"] }, then: "bovenaan" },
    ],
  };
  const out = evaluateView(eaten, logFields, items, ctx);
  assert.equal(out.total, 3);
  // Met komkommer bovenaan (in volgorde van kcal: 500, 300), dan de rest (700, in het rood); hoogstens twee.
  assert.deepEqual(
    out.rows.map((r) => r.id),
    ["1", "3"],
  );
  assert.equal(out.rows[0].top, true);
  const all = evaluateView({ ...eaten, limit: 10 }, logFields, items, ctx);
  assert.equal(all.rows.find((r) => r.id === "2")?.tone, "rood");
  // Verbergen en "als er niets is".
  const none = evaluateView({ ...eaten, where: { match: "all", conditions: [{ field: "kind", op: "any_of", value: ["Slaap"] }] }, rules: [{ when: "leeg", then: "verbergen" }] }, logFields, items, ctx);
  assert.equal(none.hidden, true);
  const hiddenRows = evaluateView({ ...eaten, limit: 10, rules: [{ when: "rij", cond: { field: "kcal", op: "lt", value: 400 }, then: "verbergen" }] }, logFields, items, ctx);
  assert.deepEqual(
    hiddenRows.rows.map((r) => r.id),
    ["2", "1"],
  );
});

test("uitrekenen: tellen als getal, per keuze en in de tijd, met een kleur op de uitkomst", () => {
  const water: ViewBlock = {
    kind: "view",
    name: "Water vandaag",
    source: "logboek",
    lists: [],
    where: { match: "all", conditions: [{ field: "kind", op: "any_of", value: ["Water"] }, { field: "status", op: "any_of", value: ["Gebeurd"] }] },
    show: "voortgang",
    tally: { agg: "sum", field: "ml", step: "day", n: 1 },
    goal: 2000,
    rules: [{ when: "uitkomst", op: "lt", value: 1000, then: "oranje" }],
  };
  const out = evaluateView(water, logFields, items, ctx);
  assert.equal(out.chart?.total, 250, "enkel wat gebeurd is");
  assert.equal(out.chart?.goal, 2000);
  assert.equal(out.tone, "oranje");
  // Komkommer per week (het voorbeeld uit de mockup): het aantal keer.
  const cucumber: ViewBlock = { ...water, name: "", where: { match: "all", conditions: [{ field: "things", op: "any_of", value: ["k"] }] }, show: "staafjes", tally: { agg: "count", step: "week", n: 2 }, rules: [] };
  const weeks = evaluateView(cucumber, logFields, items, ctx).chart!;
  assert.equal(weeks.buckets.length, 2);
  assert.deepEqual(weeks.series[0].values, [0, 2]);
  // Per keuze zonder gekozen veld: het eerste veld met keuzes (de soort).
  const def = chartOf({ ...cucumber, show: "perkeuze", tally: { agg: "count", step: "month", n: 1 } }, logFields)!;
  assert.equal(def.form, "ranked");
  assert.equal(def.by, "kind");
  // Een kalender telt per dag.
  assert.equal(chartOf({ ...cucumber, show: "kalender" }, logFields)?.step, "day");
});

test("een naam en kolommen als het blok er geen kiest", () => {
  const block: ViewBlock = { kind: "view", name: "", source: "dingen", lists: ["L1"], where: { match: "all", conditions: [] }, show: "lijst" };
  assert.equal(viewName(block, () => "Voorraad"), "Voorraad");
  assert.equal(viewName({ ...block, source: "saldo", lists: [] }, () => undefined), "Wie moet wie");
  assert.equal(viewName({ ...block, name: "Mijn wijnen" }, () => "Wijnen"), "Mijn wijnen");
  const fields: FieldDef[] = [
    { key: NAME, label: "Naam", type: "text" },
    { key: "prijs", label: "Prijs", type: "money" },
    { key: "jaar", label: "Jaar", type: "year" },
    { key: "kleur", label: "Kleur", type: "text" },
  ];
  assert.deepEqual(
    columnsOf(block, fields).map((f) => f.key),
    ["prijs", "jaar"],
  );
  assert.deepEqual(
    columnsOf({ ...block, where: { match: "all", conditions: [], columns: ["kleur"] } }, fields).map((f) => f.key),
    ["kleur"],
  );
});

test("acties na elkaar staan samen op het bord", () => {
  const act = (type: string): Block => ({ kind: "action", name: "", list: "A", type, does: "form", values: {} });
  const view: Block = { kind: "view", name: "", source: "saldo", lists: [], where: { match: "all", conditions: [] }, show: "lijst" };
  const out = segmentBlocks([act("a"), view, act("b"), act("c")]);
  assert.equal(out.length, 3);
  assert.ok(Array.isArray(out[0]) && out[0].length === 1);
  assert.equal((out[1] as Block).kind, "view");
  assert.ok(Array.isArray(out[2]) && out[2].length === 2);
});
