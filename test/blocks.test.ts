import assert from "node:assert/strict";
import { test } from "node:test";
import { actionPlans, agendaDays, cleanActionBlock, cleanViewBlock, columnsOf, evaluateView, chartOf, rangeLabel, sourceDate, sourceFields, upgradeBlock, viewName, viewSpan, type SourceItem, type ViewBlock } from "../shared/blocks.ts";
import { cleanBlock, cleanBlocks, cleanBoards, defaultBlocks, renameBoards, segmentBlocks, type Block } from "../shared/board.ts";
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
  // Gepland: bij formulier en bewaren (een boodschap, iets te doen), niet bij tellen of een timer.
  assert.equal(cleanActionBlock({ list: "L1", type: "aankoop", does: "form", planned: true })?.planned, true);
  assert.equal(cleanActionBlock({ list: "L1", type: "k1", does: "save", planned: true })?.planned, true);
  assert.equal(cleanActionBlock({ list: "L1", type: "k1", does: "count", planned: true })?.planned, undefined);
  assert.equal(cleanActionBlock({ list: "L1", type: "k1", does: "timer", planned: true })?.planned, undefined);
  assert.equal(cleanActionBlock({ list: "L1", type: "k1", does: "form", planned: "ja" })?.planned, undefined);
  // Een formulier dat gepland begint (een boodschap), plant ook zonder dat de actie het vraagt; tellen en een timer nooit.
  assert.equal(actionPlans({ does: "save" }, { planned: false }), false);
  assert.equal(actionPlans({ does: "save", planned: true }, { planned: false }), true);
  assert.equal(actionPlans({ does: "form" }, { planned: true }), true);
  assert.equal(actionPlans({ does: "count" }, { planned: true }), false);
  assert.equal(actionPlans({ does: "timer", planned: true }, { planned: true }), false);
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

test("bladeren: een periode in woorden, en per maand, per venster of per periode in de voorwaarden", () => {
  const today = "2026-11-06";
  assert.equal(rangeLabel("2026-11-05", "2026-11-05", today), "Gisteren");
  assert.equal(rangeLabel("2026-10-01", "2026-10-31", today), "Vorige maand");
  assert.equal(rangeLabel("2026-09-01", "2026-09-30", today), "September 2026");
  assert.equal(rangeLabel("2025-12-01", "2026-05-31", today), "December 2025 – mei 2026");
  assert.equal(rangeLabel("2024-01-01", "2024-12-31", today), "2024");
  assert.equal(rangeLabel("2026-10-26", "2026-11-01", today), "Vorige week");
  assert.equal(rangeLabel("2026-10-12", "2026-10-18", today), "12/10 – 18/10");

  const view = (b: Partial<ViewBlock>): ViewBlock => ({ kind: "view", name: "", source: "logboek", lists: [], where: { match: "all", conditions: [] }, show: "lijst", ...b });
  // Een agenda: per maand, vooruit en terug, met de weken errond.
  const agenda = viewSpan(view({ show: "agenda" }), today, -1)!;
  assert.deepEqual([agenda.label, agenda.month, agenda.from, agenda.to, agenda.later], ["Oktober 2026", "2026-10", "2026-09-28", "2026-11-01", true]);
  // Een grafiek: per venster terug, niet voorbij vandaag.
  const bars = view({ show: "staafjes", tally: { agg: "sum", field: "amount", step: "month", n: 6 } });
  assert.deepEqual(viewSpan(bars, today, 0)!.label, "Laatste 6 maanden");
  const back = viewSpan(bars, today, -1)!;
  assert.deepEqual([back.label, back.from, back.to, back.today, back.later], ["December 2025 – mei 2026", "2025-12-01", "2026-05-31", "2026-05-31", true]);
  assert.equal(viewSpan(bars, today, 3)!.later, false, "niet in de toekomst");
  const month = view({ show: "getal", tally: { agg: "sum", field: "amount", step: "month", n: 1 } });
  assert.deepEqual([viewSpan(month, today, 0)!.label, viewSpan(month, today, -1)!.label], ["Deze maand", "Vorige maand"]);
  // Een lijst met "wanneer in vandaag": per dag, ook vooruit.
  const eaten = view({ where: { match: "all", conditions: [{ field: "at", op: "in", value: { p: "today" } }] } });
  assert.deepEqual([viewSpan(eaten, today, 0)!.label, viewSpan(eaten, today, -1)!.label, viewSpan(eaten, today, 1)!.label], ["Vandaag", "Gisteren", "Morgen"]);
  assert.equal(viewSpan(eaten, today, -2)!.label, "Wo 4 nov");
  // Zonder periode: niets om door te bladeren.
  assert.equal(viewSpan(view({}), today, 0), null);
  assert.equal(viewSpan(view({ show: "getal", tally: { agg: "count", step: "month", n: 0 } }), today, 0), null);

  // Uitgerekend: gisteren gegeten, en het getal van vorige maand.
  const yesterday = evaluateView({ ...eaten, where: { match: "all", conditions: [...eaten.where.conditions, { field: "kind", op: "any_of", value: ["Gegeten"] }] } }, logFields, items, { ...ctx, shift: -1 });
  assert.deepEqual(yesterday.rows.map((r) => r.id), ["2"]);
  assert.equal(yesterday.span?.label, "Gisteren");
  const kcal = view({ show: "getal", tally: { agg: "sum", field: "kcal", step: "day", n: 1 } });
  assert.equal(evaluateView(kcal, logFields, items, { ...ctx, shift: -2 }).chart?.total, 300);
});

test("een agenda: alles op zijn dag in het rooster van de maand, ook de dingen met een datum of periode", () => {
  const block: ViewBlock = { kind: "view", name: "", source: "logboek", lists: [], where: { match: "all", conditions: [] }, show: "agenda" };
  const later = [...items, ev("6", "2026-12-24", "Gegeten"), ev("7", "2026-11-30T19:00", "Water")];
  const out = evaluateView(block, logFields, later, ctx);
  assert.deepEqual(out.rows.map((r) => r.id), ["3", "2", "1", "4", "5", "7"]);
  assert.equal(out.span?.month, "2026-11");
  assert.deepEqual(evaluateView(block, logFields, later, { ...ctx, shift: 1 }).rows.map((r) => r.id), ["7", "6"], "het rooster van december begint op maandag 30 november");
  // De dingen: volgens een datumveld (het gekozen, anders dat met "In de agenda", anders het eerste).
  const fields: FieldDef[] = [
    { key: NAME, label: "Naam", type: "text" },
    { key: "bought", label: "Gekocht", type: "date" },
    { key: "keuring", label: "Keuring", type: "date", agenda: true },
    { key: "trip", label: "Reis", type: "date_range" },
  ];
  assert.equal(sourceDate("dingen", fields), "keuring");
  assert.equal(sourceDate("dingen", fields, "trip"), "trip");
  assert.deepEqual(agendaDays({ data: { trip: ["2026-11-10", "2026-11-14"] } }, "trip"), { start: "2026-11-10", end: "2026-11-14" });
  assert.deepEqual(agendaDays({ data: { at: "2026-11-10T08:00", end: "2026-11-10" } }, "at"), { start: "2026-11-10" });
  assert.equal(agendaDays({ data: {} }, "at"), null);
  // Het datumveld van vroeger (in tally.date) blijft.
  const old = cleanViewBlock({ source: "dingen", lists: ["w"], show: "staafjes", tally: { agg: "count", step: "month", n: 6, date: "bought" } });
  assert.equal(old?.date, "bought");
  assert.equal(cleanViewBlock({ source: "dingen", lists: ["w"], show: "lijst", date: "bought" })?.date, undefined, "een lijst heeft geen datumveld nodig");
  // Alles met een datum: wat gebeurde of gepland staat, en de datums van dingen.
  assert.deepEqual(sourceFields("datums", { lists: [], kinds: [] }).map((f) => f.key), [NAME, "at", "end", "list", "what", "status"]);
});

test("borden: met een naam en een icoon, nieuw of hernoemd", () => {
  const boards = cleanBoards({ v: 2, boards: [{ id: "main", name: "Thuis", icon: "home", blocks: [] }, { id: "g", name: "Geld", icon: "<svg>", blocks: [] }] });
  assert.deepEqual(boards.map((b) => [b.name, b.icon]), [["Thuis", "home"], ["Geld", "project"]]);
  const next = renameBoards(boards, [{ id: "main", name: "Thuis" }, { id: "g", name: "Geld", icon: "wallet" }, { name: "Agenda", icon: "calendar" }], () => "n1");
  assert.deepEqual(next.map((b) => [b.id, b.name, b.icon]), [["main", "Thuis", "home"], ["g", "Geld", "wallet"], ["n1", "Agenda", "calendar"]]);
  assert.deepEqual(cleanBoards(null).map((b) => [b.name, b.icon]), [["Overzicht", "project"]]);
});
