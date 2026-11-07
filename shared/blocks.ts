// De bouwdoos van het overzicht (zie STIJLBOEK.md → Overzicht): elk blok is een **weergave** (wat je ziet) of een
// **actie** (wat je doet). Een weergave is een zin: "toon <bron> van <lijsten> waar <voorwaarden>, tel <…> per <…>",
// getoond als lijst, tabel, agenda, getal of grafiek, met voorwaarden op wat je ziet (kleur, bovenaan, verbergen). Een
// weergave met een periode (deze maand, de laatste 6 weken, een agenda) blader je door (`viewSpan`).
// Een actie is een knop die logt: een soort met vooraf ingevulde velden, die het formulier opent, meteen bewaart, er
// één bijtelt of start en stopt. Alles is enkel ids en sleutels; de server rekent een weergave uit met de rechten van
// wie kijkt (GET /insights/view), met de motor van bewaarde weergaven (shared/views.ts) en grafieken (shared/charts.ts).

import { monthGrid, shiftMonth } from "./agenda.ts";
import { bucketLabel, CHART_AGGS, CHART_STEPS, chartWindow, cleanChart, computeChart, previousWindow, type ChartAgg, type ChartData, type ChartDef, type ChartForm, type ChartNames, type ChartStep, type ChartWindow } from "./charts.ts";
import type { Attributes, FieldDef, FieldValue, Names } from "./fields.ts";
import { NUTRIENTS } from "./food.ts";
import { logFields } from "./logview.ts";
import { STATUSES } from "./model.ts";
import { matchesView, NAME, PERIODS, periodRange, periodText, sortItems, type Condition, type Period, type PeriodKind, type ViewDef, type ViewItem } from "./views.ts";

// ---------- bronnen ----------

/** Waar een weergave uit toont: het logboek, de dingen van een lijst, of iets wat de app uitrekent. */
export const SOURCES = {
  logboek: "het logboek",
  dingen: "de dingen",
  voorraad: "de voorraad",
  saldo: "wie moet wie",
  voeding: "wat er gegeten is",
  datums: "alles met een datum",
} as const;
export type SourceKind = keyof typeof SOURCES;

/** Volgens welke datum een bron in de tijd staat (tellen per periode, een agenda); bij de dingen kies je een datumveld. */
export function sourceDate(source: SourceKind, fields: FieldDef[], chosen?: string): string {
  if (source === "logboek" || source === "datums") return "at";
  if (source === "voeding") return "day";
  if (source === "voorraad") return "expires";
  if (source === "dingen") {
    const dates = fields.filter((f) => f.type === "date" || f.type === "date_range");
    return (dates.find((f) => f.key === chosen) ?? dates.find((f) => f.agenda) ?? dates[0])?.key ?? "created";
  }
  return "created";
}

/** Een veld dat het logboek heeft naast de vaste delen: loopt deze activiteit nu (een timer)? */
export const RUNNING: FieldDef = { key: "running", label: "Loopt nu", type: "bool" };

const NUTRIENT_LABELS: Record<(typeof NUTRIENTS)[number], [string, string]> = {
  kcal: ["Kcal", "kcal"],
  protein: ["Eiwit", "g"],
  carbs: ["Koolhydraten", "g"],
  fat: ["Vet", "g"],
  sugars: ["Suikers", "g"],
  fiber: ["Vezels", "g"],
  salt: ["Zout", "g"],
};

/**
 * De velden van een bron, zoals de zin en de tabel ze kennen. `lists`: de gekozen lijsten (logboek: hun namen als
 * keuze; dingen: hun velden), `kinds`: de soorten die er gelogd kunnen worden (hun velden komen bij het logboek).
 */
export function sourceFields(source: SourceKind, ctx: { lists: { name: string; fields: FieldDef[] }[]; kinds: { name: string; fields: FieldDef[] }[] }): FieldDef[] {
  switch (source) {
    case "logboek": {
      const base = logFields(ctx.kinds, ctx.lists);
      const taken = new Set([...base.map((f) => f.key), NAME, RUNNING.key]);
      const extra: FieldDef[] = [];
      for (const k of ctx.kinds) {
        for (const f of k.fields) {
          if (taken.has(f.key) || f.type === "calc") continue;
          taken.add(f.key);
          extra.push(f);
        }
      }
      return [{ key: NAME, label: "Omschrijving", type: "text" }, ...base, RUNNING, ...extra];
    }
    case "dingen": {
      const seen = new Set<string>();
      const fields = ctx.lists.flatMap((l) => l.fields).filter((f) => !seen.has(f.key) && (seen.add(f.key), true));
      return [{ key: NAME, label: "Naam", type: "text" }, ...fields];
    }
    case "voorraad":
      return [
        { key: NAME, label: "Naam", type: "text" },
        { key: "list", label: "Lijst", type: "select", options: ctx.lists.map((l) => l.name).slice(0, 60) },
        { key: "level", label: "Voorraad", type: "text" },
        { key: "amount", label: "Hoeveel", type: "number" },
        { key: "low", label: "Bijna op", type: "bool" },
        { key: "out", label: "Op", type: "bool" },
        { key: "expires", label: "Houdbaar tot", type: "date" },
      ];
    case "saldo":
      return [
        { key: NAME, label: "Wie aan wie", type: "text" },
        { key: "from", label: "Van", type: "person" },
        { key: "to", label: "Naar", type: "person" },
        { key: "amount", label: "Bedrag", type: "money" },
      ];
    case "voeding":
      return [
        { key: NAME, label: "Wie", type: "text" },
        { key: "day", label: "Dag", type: "date" },
        { key: "who", label: "Persoon", type: "person" },
        ...NUTRIENTS.map((n): FieldDef => ({ key: n, label: NUTRIENT_LABELS[n][0], type: "number", unit: NUTRIENT_LABELS[n][1] })),
      ];
    case "datums":
      // Wat gebeurde of gepland staat, en de datums van dingen met "In de agenda" (de keuring, een verjaardag).
      return [
        { key: NAME, label: "Wat", type: "text" },
        { key: "at", label: "Wanneer", type: "date" },
        { key: "end", label: "Tot", type: "date" },
        { key: "list", label: "Lijst", type: "select", options: ctx.lists.map((l) => l.name).slice(0, 60) },
        { key: "what", label: "Soort", type: "text" },
        { key: "status", label: "Status", type: "select", options: Object.values(STATUSES).map((x) => x.label) },
      ];
  }
}

// ---------- tonen als ----------

/** De vormen van een weergave; `chart`: met welke grafiekvorm ze uitgerekend wordt (geen: een lijst of tabel). */
export const SHOWS = {
  lijst: { label: "Lijst", chart: null },
  tabel: { label: "Tabel", chart: null },
  agenda: { label: "Agenda", chart: null },
  getal: { label: "Getal", chart: "number" },
  voortgang: { label: "Voortgang", chart: "number" },
  staafjes: { label: "Staafjes", chart: "bars" },
  lijn: { label: "Lijn", chart: "line" },
  gebied: { label: "Gebied", chart: "line" },
  perkeuze: { label: "Per keuze", chart: "ranked" },
  verdeling: { label: "Verdeling", chart: "parts" },
  kalender: { label: "Per dag", chart: "bars" },
} as const satisfies Record<string, { label: string; chart: ChartForm | null }>;
export type Show = keyof typeof SHOWS;
export const SHOW_ORDER = Object.keys(SHOWS) as Show[];

/** Telt deze vorm (getal of grafiek), of toont ze rijen? */
export const counts = (show: Show) => SHOWS[show].chart !== null;
/** Staat deze vorm in de tijd (per periode)? */
export const overTime = (show: Show) => show === "staafjes" || show === "lijn" || show === "gebied" || show === "kalender";
/** Telt deze vorm per keuze (een veld als as)? */
export const perChoice = (show: Show) => show === "perkeuze" || show === "verdeling";

/** Hoe er geteld wordt: aantal, som, gemiddelde, kleinste of grootste van een veld, per periode of keuze. */
export type Tally = {
  agg: ChartAgg;
  field?: string;
  /** Per keuze (Per keuze, Verdeling) of apart per (Staafjes, Lijn, Gebied). */
  by?: string;
  step: ChartStep;
  /** De laatste zoveel periodes; 0 = alles. */
  n: number;
};
export const DEFAULT_TALLY: Tally = { agg: "count", step: "week", n: 8 };

// ---------- voorwaarden op wat je ziet ----------

export const RULE_TONES = { rood: "rood", oranje: "oranje", groen: "groen" } as const;
export type RuleTone = keyof typeof RULE_TONES;
export const ROW_EFFECTS = { rood: "rood", oranje: "oranje", groen: "groen", bovenaan: "bovenaan", verbergen: "verbergen" } as const;
export type RowEffect = keyof typeof ROW_EFFECTS;
export const RESULT_OPS = { lt: "kleiner dan", le: "hoogstens", gt: "groter dan", ge: "minstens" } as const;
export type ResultOp = keyof typeof RESULT_OPS;

/**
 * Een voorwaarde op wat je ziet: een rij die aan iets voldoet krijgt een kleur, komt bovenaan of verdwijnt; een blok
 * zonder iets verdwijnt; een uitkomst (getal, voortgang) boven of onder een grens krijgt een kleur.
 */
export type Rule =
  | { when: "rij"; cond: Condition; then: RowEffect }
  | { when: "leeg"; then: "verbergen" }
  | { when: "uitkomst"; op: ResultOp; value: number; then: RuleTone };
export const MAX_RULES = 8;

// ---------- blokken ----------

export type ViewBlock = {
  kind: "view";
  /** De naam boven het blok; leeg: afgeleid uit de zin (`viewName`). */
  name: string;
  source: SourceKind;
  /** De lijsten; leeg = al je lijsten (bij de dingen: minstens één). */
  lists: string[];
  where: ViewDef;
  show: Show;
  tally?: Tally;
  /** De dingen: volgens welk datumveld ze in de tijd staan (tellen per periode, agenda); anders het eerste. */
  date?: string;
  /** Lijst en tabel: hoogstens zoveel rijen. */
  limit?: number;
  /** Voortgang (en een lijn bij getal en grafiek): het doel. */
  goal?: number;
  rules?: Rule[];
};

export const ACTION_DOES = {
  form: "Opent het formulier",
  save: "Bewaart meteen",
  count: "Telt er een bij",
  timer: "Start en stopt",
} as const;
export type ActionDoes = keyof typeof ACTION_DOES;

export type ActionBlock = {
  kind: "action";
  /** De naam op de knop; leeg: de naam van de soort. */
  name: string;
  list: string;
  /** De soort (een eigen soort of een basissoort); leeg: de eerste van de lijst. */
  type: string;
  does: ActionDoes;
  /** Vooraf ingevuld: velden van de soort (en `name`, de omschrijving). */
  values: Attributes;
  /** Gepland in plaats van gebeurd (een boodschap, iets te doen): enkel bij formulier en bewaren (`canPlan`). */
  planned?: true;
};

/** Wat een tik doet en ook gepland kan: het formulier openen of meteen bewaren (tellen en een timer gaan over nu). */
export const canPlan = (does: ActionDoes) => does === "form" || does === "save";

export const MAX_LIMIT = 50;
export const DEFAULT_LIMIT = 6;
const ID = /^[A-Za-z0-9-]{1,64}$/;
const KEY = /^[A-Za-z_][a-z0-9_]{0,39}$/;
const id = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);
const text = (v: unknown, max = 40) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function cleanTally(raw: unknown): Tally {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const agg = Object.hasOwn(CHART_AGGS, String(o.agg)) ? (o.agg as ChartAgg) : "count";
  const step = Object.hasOwn(CHART_STEPS, String(o.step)) ? (o.step as ChartStep) : "week";
  const n = typeof o.n === "number" && Number.isInteger(o.n) && o.n >= 0 ? Math.min(o.n, 366) : 8;
  const field = typeof o.field === "string" && KEY.test(o.field) ? o.field : undefined;
  const by = typeof o.by === "string" && KEY.test(o.by) ? o.by : undefined;
  return { agg: agg !== "count" && !field ? "count" : agg, ...(agg !== "count" && field ? { field } : {}), ...(by ? { by } : {}), step, n };
}

function cleanRule(raw: unknown): Rule | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.when === "leeg") return { when: "leeg", then: "verbergen" };
  if (o.when === "uitkomst") {
    if (!Object.hasOwn(RESULT_OPS, String(o.op)) || typeof o.value !== "number" || !Number.isFinite(o.value) || !Object.hasOwn(RULE_TONES, String(o.then))) return null;
    return { when: "uitkomst", op: o.op as ResultOp, value: o.value, then: o.then as RuleTone };
  }
  if (o.when === "rij") {
    if (!Object.hasOwn(ROW_EFFECTS, String(o.then))) return null;
    // Een voorwaarde zoals in een bewaarde weergave (dezelfde controle).
    const cond = cleanLooseCondition(o.cond);
    return cond ? { when: "rij", cond, then: o.then as RowEffect } : null;
  }
  return null;
}

/** Een voorwaarde zonder te weten welke velden er zijn (die komen pas bij het uitrekenen; een onbekend veld telt niet). */
function cleanLooseCondition(raw: unknown): Condition | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.field !== "string" || !KEY.test(o.field) || typeof o.op !== "string") return null;
  const value = o.value;
  const ok = value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean" || Array.isArray(value) || (value !== null && typeof value === "object");
  if (!ok || JSON.stringify(value ?? null).length > 2000) return null;
  return { field: o.field, op: o.op as Condition["op"], ...(value !== undefined ? { value } : {}) };
}

/** Een weergave zonder te weten welke velden er zijn: de voorwaarden los nagekeken (`cleanLooseCondition`). */
function cleanWhere(raw: unknown): ViewDef {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const conditions = (Array.isArray(o.conditions) ? o.conditions : []).slice(0, 20).flatMap((c) => {
    const x = cleanLooseCondition(c);
    return x ? [x] : [];
  });
  const sort = (Array.isArray(o.sort) ? o.sort : []).slice(0, 3).flatMap((s) => {
    const x = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
    return typeof x.field === "string" && KEY.test(x.field) ? [{ field: x.field, dir: x.dir === "desc" ? ("desc" as const) : ("asc" as const) }] : [];
  });
  const columns = (Array.isArray(o.columns) ? o.columns : []).filter((c): c is string => typeof c === "string" && KEY.test(c)).slice(0, 8);
  return { match: o.match === "any" ? "any" : "all", conditions, ...(sort.length ? { sort } : {}), ...(columns.length ? { columns } : {}) };
}

export function cleanViewBlock(raw: unknown): ViewBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const source = Object.hasOwn(SOURCES, String(o.source)) ? (o.source as SourceKind) : null;
  if (!source) return null;
  const lists = [...new Set((Array.isArray(o.lists) ? o.lists : []).map(id).filter((x): x is string => x !== null))].slice(0, 20);
  if (source === "dingen" && !lists.length) return null;
  const show = Object.hasOwn(SHOWS, String(o.show)) ? (o.show as Show) : "lijst";
  const limit = typeof o.limit === "number" && Number.isInteger(o.limit) ? Math.max(1, Math.min(o.limit, MAX_LIMIT)) : undefined;
  const goal = typeof o.goal === "number" && Number.isFinite(o.goal) && Math.abs(o.goal) < 1e12 ? o.goal : undefined;
  // Het datumveld van de dingen (vroeger in `tally.date`).
  const t = o.tally && typeof o.tally === "object" ? (o.tally as Record<string, unknown>) : {};
  const date = [o.date, t.date].find((d): d is string => typeof d === "string" && KEY.test(d));
  const rules = (Array.isArray(o.rules) ? o.rules : []).slice(0, MAX_RULES).flatMap((r) => {
    const x = cleanRule(r);
    return x ? [x] : [];
  });
  return {
    kind: "view",
    name: text(o.name),
    source,
    lists,
    where: cleanWhere(o.where),
    show,
    ...(counts(show) ? { tally: cleanTally(o.tally) } : {}),
    ...(source === "dingen" && date && (counts(show) || show === "agenda") ? { date } : {}),
    ...((show === "lijst" || show === "tabel") && limit ? { limit } : {}),
    ...(goal !== undefined ? { goal } : {}),
    ...(rules.length ? { rules } : {}),
  };
}

export function cleanActionBlock(raw: unknown): ActionBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const list = id(o.list);
  if (!list) return null;
  const does = Object.hasOwn(ACTION_DOES, String(o.does)) ? (o.does as ActionDoes) : "form";
  const values: Attributes = {};
  if (o.values && typeof o.values === "object" && !Array.isArray(o.values)) {
    for (const [k, v] of Object.entries(o.values as Record<string, unknown>).slice(0, 20)) {
      if (!KEY.test(k)) continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") values[k] = (typeof v === "string" ? v.slice(0, 200) : v) as FieldValue;
    }
  }
  return { kind: "action", name: text(o.name), list, type: id(o.type) ?? "", does, values, ...(o.planned === true && canPlan(does) ? { planned: true as const } : {}) };
}

// ---------- oude blokken ----------

const STATUS = (s: keyof typeof STATUSES) => STATUSES[s].label;

/**
 * De vaste blokken van vroeger als zin (Uitgaven deze maand, Wie moet wie, Te doen, Bijna op, Eten vandaag, Loopt nu,
 * een lijst, een grafiek, Snel loggen): zo werkt elk bestaand overzicht verder, en past iemand het aan, dan bewaart
 * het de zin. `null`: geen oud blok.
 */
export function upgradeBlock(raw: Record<string, unknown>): ViewBlock | ActionBlock | null {
  const view = (b: Omit<ViewBlock, "kind" | "lists"> & { lists?: string[] }): ViewBlock => ({ kind: "view", lists: [], ...b });
  switch (raw.kind) {
    case "money":
      return view({
        name: "Uitgaven deze maand",
        source: "logboek",
        where: {
          match: "all",
          conditions: [
            { field: "status", op: "any_of", value: [STATUS("gebeurd")] },
            { field: "amount", op: "not_empty" },
            { field: "kind", op: "none_of", value: ["Overdracht"] },
          ],
        },
        show: "getal",
        tally: { agg: "sum", field: "amount", step: "month", n: 1 },
      });
    case "balance":
      return view({ name: "Wie moet wie", source: "saldo", where: { match: "all", conditions: [] }, show: "lijst" });
    case "todo":
      return view({
        name: "Te doen",
        source: "logboek",
        where: { match: "all", conditions: [{ field: "status", op: "any_of", value: [STATUS("gepland")] }], sort: [{ field: "at", dir: "asc" }] },
        show: "lijst",
        limit: DEFAULT_LIMIT,
      });
    case "stock":
      return view({ name: "Bijna op", source: "voorraad", where: { match: "all", conditions: [{ field: "low", op: "is_true" }], columns: ["level"] }, show: "lijst", limit: DEFAULT_LIMIT });
    case "food":
      return view({
        name: "Eten vandaag",
        source: "voeding",
        where: { match: "all", conditions: [{ field: "day", op: "in", value: { p: "today" } }], columns: ["kcal"] },
        show: "lijst",
      });
    case "timers":
      return view({ name: "Loopt nu", source: "logboek", where: { match: "all", conditions: [{ field: "running", op: "is_true" }] }, show: "lijst", rules: [{ when: "leeg", then: "verbergen" }] });
    case "quick": {
      const list = id(raw.list);
      return list ? { kind: "action", name: "", list, type: id(raw.type) ?? "", does: "form", values: {} } : null;
    }
    case "list": {
      const list = id(raw.list);
      if (!list) return null;
      if (raw.show === "log") return view({ name: "", source: "logboek", lists: [list], where: { match: "all", conditions: [], sort: [{ field: "at", dir: "desc" }] }, show: "lijst", limit: 5 });
      if (raw.show === "things") return view({ name: "", source: "dingen", lists: [list], where: { match: "all", conditions: [] }, show: "lijst", limit: 5 });
      return view({ name: "", source: "dingen", lists: [list], where: { match: "all", conditions: [] }, show: "getal", tally: { agg: "count", step: "month", n: 0 } });
    }
    case "chart": {
      const chart = cleanChart(raw.chart);
      if (!chart) return null;
      const list = id(raw.list);
      const source: SourceKind = raw.source === "dingen" && list ? "dingen" : "logboek";
      const show: Show = chart.form === "bars" ? "staafjes" : chart.form === "line" ? "lijn" : chart.form === "number" ? "getal" : chart.form === "ranked" ? "perkeuze" : "verdeling";
      return view({
        name: "",
        source,
        lists: list ? [list] : [],
        where: { match: "all", conditions: [] },
        show,
        tally: { agg: chart.agg, ...(chart.field ? { field: chart.field } : {}), ...(chart.by ? { by: chart.by } : {}), step: chart.step, n: chart.count },
        ...(source === "dingen" && chart.date !== "created" ? { date: chart.date } : {}),
        ...(chart.goal !== undefined ? { goal: chart.goal } : {}),
      });
    }
    default:
      return null;
  }
}

// ---------- uitrekenen ----------

/** Een rij van een bron: een item (zoals bij een bewaarde weergave) met een id. */
export type SourceItem = ViewItem & { id: string; created_at: string };
export type ViewRow<T extends SourceItem = SourceItem> = T & { tone?: RuleTone; top?: boolean };
export type ViewOutcome<T extends SourceItem = SourceItem> = {
  rows: ViewRow<T>[];
  /** Hoeveel rijen er aan de zin voldoen (voor "en nog 12"). */
  total: number;
  chart: ChartData | null;
  /** Een voorwaarde "als er niets is, verberg het blok". */
  hidden: boolean;
  /** Een voorwaarde op de uitkomst. */
  tone: RuleTone | null;
  /** De periode die je ziet en of je kan bladeren; null: geen periode. */
  span: Span | null;
};

// ---------- bladeren door de tijd ----------

/** De periode van een weergave: wat er boven staat ("Deze maand", "oktober 2026") en of je verder terug of vooruit kan. */
export type Span = {
  label: string;
  earlier: boolean;
  later: boolean;
  from: string | null;
  to: string | null;
  /** Een agenda: de maand ("2026-11"). */
  month?: string;
};
/** Zoveel periodes ver kan je bladeren (ook vooruit). */
export const MAX_SHIFT = 240;

const DAY_MS = 86_400_000;
const dayMs = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const addDays = (d: string, n: number) => new Date(dayMs(d) + n * DAY_MS).toISOString().slice(0, 10);
/** Maanden verder of terug, met dezelfde dag (of de laatste van die maand). */
function addMonths(d: string, n: number): string {
  const month = shiftMonth(d.slice(0, 7), n);
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return `${month}-${String(Math.min(Number(d.slice(8, 10)), last)).padStart(2, "0")}`;
}
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Hoe ver een periode in een voorwaarde verschuift per stap (vandaag: een dag, deze maand: een maand). */
const PERIOD_STEPS: Partial<Record<PeriodKind, { unit: "day" | "month"; n: number }>> = {
  today: { unit: "day", n: 1 },
  yesterday: { unit: "day", n: 1 },
  tomorrow: { unit: "day", n: 1 },
  this_week: { unit: "day", n: 7 },
  last_week: { unit: "day", n: 7 },
  next_week: { unit: "day", n: 7 },
  this_month: { unit: "month", n: 1 },
  last_month: { unit: "month", n: 1 },
  next_month: { unit: "month", n: 1 },
  this_year: { unit: "month", n: 12 },
  last_year: { unit: "month", n: 12 },
  next_year: { unit: "month", n: 12 },
  last_days: { unit: "day", n: 0 },
  next_days: { unit: "day", n: 0 },
};

/** De eerste voorwaarde met een periode die meeschuift ("wanneer in deze maand"). */
function periodOf(block: ViewBlock): Period | null {
  for (const c of block.where.conditions) {
    const v = c.value as Period | undefined;
    if (c.op === "in" && v && typeof v === "object" && !Array.isArray(v) && typeof v.p === "string" && PERIOD_STEPS[v.p]) return v;
  }
  return null;
}

const NAMED: PeriodKind[] = ["today", "yesterday", "tomorrow", "this_week", "last_week", "next_week", "this_month", "last_month", "next_month", "this_year", "last_year", "next_year"];

/** Een periode in woorden: "Gisteren", "Vorige maand", "oktober 2026", "2025", "di 3 nov", "5/10 – 11/10". */
export function rangeLabel(from: string, to: string, today: string): string {
  for (const p of NAMED) {
    const [a, b] = periodRange({ p }, today);
    if (a === from && b === to) return cap(PERIODS[p]);
  }
  const year = today.slice(0, 4);
  if (from === to) return cap(bucketLabel(from, "day", from.slice(0, 4) !== year).long);
  const wholeMonths = from.slice(8) === "01" && addDays(to, 1).slice(8) === "01";
  if (wholeMonths) {
    if (from.slice(5) === "01-01" && to.slice(5) === "12-31" && from.slice(0, 4) === to.slice(0, 4)) return from.slice(0, 4);
    const month = (d: string) => bucketLabel(d, "month", true).long;
    return from.slice(0, 7) === to.slice(0, 7) ? cap(month(from)) : `${cap(month(from))} – ${month(to)}`;
  }
  const short = (d: string) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;
  return `${short(from)} – ${short(to)}${to.slice(0, 4) !== year ? ` ${to.slice(0, 4)}` : ""}`;
}

/** De periode van een getal of grafiek: de laatste zoveel periodes (stap en aantal zoals chartOf). */
const tallyWindow = (block: ViewBlock) => {
  const t = block.tally ?? DEFAULT_TALLY;
  const calendar = block.show === "kalender";
  return { step: calendar ? ("day" as const) : t.step, count: calendar && !t.n ? 35 : t.n };
};

/**
 * Waar een weergave staat als je `shift` periodes bladert (negatief: vroeger): de periode die je ziet, de dag die als
 * "vandaag" telt (voor de voorwaarden en de grafiek) en welke dagen de server moet laden. Een agenda bladert per maand,
 * een getal of grafiek per venster (6 maanden terug bij "de laatste 6 maanden", niet voorbij vandaag), een lijst met een
 * periode in haar voorwaarden per die periode (gisteren, vorige week). Null: niets om door te bladeren.
 */
export function viewSpan(block: ViewBlock, today: string, shift = 0): (Span & { today: string; load: [string | null, string | null] }) | null {
  const k = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, Math.trunc(shift) || 0));
  if (block.show === "agenda") {
    const month = shiftMonth(today.slice(0, 7), k);
    const grid = monthGrid(month);
    const from = grid[0];
    const to = grid[grid.length - 1];
    return { label: cap(bucketLabel(`${month}-01`, "month", true).long), earlier: true, later: true, from, to, month, today: k ? addMonths(today, k) : today, load: [from, to] };
  }
  const { step, count } = tallyWindow(block);
  if (counts(block.show) && count > 0) {
    const def = { step, count } as ChartDef;
    let w = chartWindow(def, today) as ChartWindow;
    for (let i = 0; i < -Math.min(k, 0); i++) w = previousWindow(w, def);
    const label = k < 0 ? rangeLabel(w.from, w.to, today) : count === 1 ? (step === "day" ? "Vandaag" : cap(`deze ${CHART_STEPS[step].one}`).replace("Deze jaar", "Dit jaar")) : `Laatste ${count} ${CHART_STEPS[step].many}`;
    // Een getal vergelijkt met de periode ervoor: die moet ook geladen zijn.
    return { label, earlier: true, later: k < 0, from: w.from, to: w.to, today: k < 0 ? w.to : today, load: [previousWindow(w, def).from, w.to] };
  }
  const period = periodOf(block);
  if (period) {
    const stepOf = PERIOD_STEPS[period.p]!;
    const n = (stepOf.n || Math.max(1, period.n ?? 7)) * k;
    const moved = stepOf.unit === "day" ? addDays(today, n) : addMonths(today, n);
    const [from, to] = periodRange(period, moved);
    const label = k === 0 ? cap(periodText(period)) : from && to ? rangeLabel(from, to, today) : cap(periodText(period));
    return { label, earlier: true, later: true, from, to, today: moved, load: [from, to] };
  }
  return null;
}

/** Wanneer een rij in de agenda staat: de dag (een datum, het begin van een tijdstip of periode) en eventueel tot wanneer. */
export function agendaDays(item: { data: Record<string, unknown> }, key: string): { start: string; end?: string } | null {
  const v = item.data[key];
  const day = (x: unknown) => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x) ? x.slice(0, 10) : null);
  if (Array.isArray(v)) {
    const start = day(v[0]) ?? day(v[1]);
    const end = day(v[1]);
    return start ? { start, ...(end && end > start ? { end } : {}) } : null;
  }
  const start = day(v);
  if (!start) return null;
  const end = day(item.data.end);
  return { start, ...(end && end > start ? { end } : {}) };
}

/** Zoveel staat er hoogstens in een agenda (een maand). */
export const MAX_AGENDA = 400;

/** De grafiek die bij de zin hoort (getal, voortgang, staafjes, …); null bij een lijst of tabel. */
export function chartOf(block: ViewBlock, fields: FieldDef[]): ChartDef | null {
  const form = SHOWS[block.show].chart;
  if (!form) return null;
  const t = block.tally ?? DEFAULT_TALLY;
  const by = perChoice(block.show) ? (t.by ?? fields.find((f) => f.type === "select" || f.type === "person")?.key) : overTime(block.show) && block.show !== "kalender" ? t.by : undefined;
  return {
    form,
    agg: t.agg,
    ...(t.agg !== "count" && t.field ? { field: t.field } : {}),
    date: sourceDate(block.source, fields, block.date),
    step: block.show === "kalender" ? "day" : t.step,
    count: block.show === "kalender" && !t.n ? 35 : t.n,
    ...(by ? { by } : {}),
    ...(block.goal !== undefined ? { goal: block.goal } : {}),
  };
}

const compare = (a: number, op: ResultOp, b: number) => (op === "lt" ? a < b : op === "le" ? a <= b : op === "gt" ? a > b : a >= b);

/**
 * Rekent een weergave uit over de rijen van haar bron (al met de rechten van de lezer): de voorwaarden van de zin, de
 * volgorde, de voorwaarden op wat je ziet, en de grafiek of de rijen (hoogstens `limit`).
 */
export function evaluateView<T extends SourceItem>(block: ViewBlock, fields: FieldDef[], items: T[], ctx: { today: string; me: string; names: Names; chart: ChartNames; shift?: number }): ViewOutcome<T> {
  const at = viewSpan(block, ctx.today, ctx.shift);
  const span: Span | null = at ? { label: at.label, earlier: at.earlier, later: at.later, from: at.from, to: at.to, ...(at.month ? { month: at.month } : {}) } : null;
  const today = at?.today ?? ctx.today;
  const chosen = items.filter((i) => matchesView(i, block.where, fields, { today, me: ctx.me, names: ctx.names }));
  const rules = block.rules ?? [];
  const hideEmpty = rules.some((r) => r.when === "leeg");
  const def = chartOf(block, fields);
  if (def) {
    const chart = computeChart(def, fields, chosen, ctx.chart, today);
    const result = chart?.total ?? null;
    const toneRule = result === null ? undefined : rules.find((r): r is Extract<Rule, { when: "uitkomst" }> => r.when === "uitkomst" && compare(result, r.op, r.value));
    return { rows: [], total: chosen.length, chart, hidden: hideEmpty && chosen.length === 0, tone: toneRule?.then ?? null, span };
  }
  if (block.show === "agenda" && at) {
    // Een agenda: wat in het rooster van de maand valt, op volgorde van de dag.
    const key = sourceDate(block.source, fields, block.date);
    const placed = chosen
      .map((i) => ({ i, d: agendaDays(i, key) }))
      .filter((x): x is { i: T; d: { start: string; end?: string } } => x.d !== null && x.d.start <= at.to! && (x.d.end ?? x.d.start) >= at.from!)
      .sort((a, b) => a.d.start.localeCompare(b.d.start));
    const rows: ViewRow<T>[] = placed.map((x) => x.i);
    return { rows: rows.slice(0, MAX_AGENDA), total: rows.length, chart: null, hidden: hideEmpty && rows.length === 0, tone: null, span };
  }
  // Een lijst of tabel: de volgorde, dan wat bovenaan moet, wat weg moet en welke kleur.
  const rowRules = rules.filter((r): r is Extract<Rule, { when: "rij" }> => r.when === "rij");
  const effects = (i: T) => rowRules.filter((r) => matchesView(i, { match: "all", conditions: [r.cond] }, fields, { today, me: ctx.me, names: ctx.names })).map((r) => r.then);
  const sorted = sortItems(chosen, block.where.sort, fields, ctx.names);
  const rows: ViewRow<T>[] = [];
  for (const i of sorted) {
    const fx = effects(i);
    if (fx.includes("verbergen")) continue;
    const tone = fx.find((x): x is RuleTone => x === "rood" || x === "oranje" || x === "groen");
    rows.push({ ...i, ...(tone ? { tone } : {}), ...(fx.includes("bovenaan") ? { top: true } : {}) });
  }
  const ordered = [...rows.filter((r) => r.top), ...rows.filter((r) => !r.top)];
  return { rows: ordered.slice(0, block.limit ?? DEFAULT_LIMIT), total: ordered.length, chart: null, hidden: hideEmpty && ordered.length === 0, tone: null, span };
}

/**
 * Een rij zoals de server ze geeft: met een link, bij het logboek de gebeurtenis (afvinken, een timer stoppen) en bij
 * wie moet wie waar Terugbetaald een overdracht logt (met de IBAN van wie krijgt, voor een betaal-QR).
 */
export type ViewRowOut = ViewRow<
  SourceItem & { link: string | null; event?: { status: "gebeurd" | "gepland" | "afgevinkt"; running: boolean; at: string }; settle?: { list: string; iban: string | null } }
>;

/** Wat GET /insights/view geeft: de velden van de bron, de uitkomst, en de namen om waarden te tonen. */
export type ViewResponse = Omit<ViewOutcome, "rows"> & {
  fields: FieldDef[];
  rows: ViewRowOut[];
  people: { id: string; name: string }[];
  items: Record<string, string>;
};

/** Een naam als het blok er zelf geen kreeg: uit de zin ("Voorraad", "Het logboek"). */
export function viewName(block: ViewBlock, listName: (id: string) => string | undefined): string {
  if (block.name) return block.name;
  const names = block.lists.map(listName).filter((x): x is string => Boolean(x));
  if (names.length) return names.join(", ");
  const s = SOURCES[block.source];
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** De kolommen van een lijst of tabel: wat gekozen is, anders de eerste velden die iets zeggen. */
export function columnsOf(block: ViewBlock, fields: FieldDef[]): FieldDef[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const chosen = (block.where.columns ?? []).map((k) => byKey.get(k)).filter((f): f is FieldDef => Boolean(f));
  if (chosen.length) return chosen;
  const fallback: Record<SourceKind, string[]> = {
    logboek: ["at", "amount"],
    dingen: [],
    voorraad: ["level"],
    saldo: ["amount"],
    voeding: ["kcal"],
    datums: ["at", "list"],
  };
  const keys = fallback[block.source];
  if (keys.length) return keys.map((k) => byKey.get(k)).filter((f): f is FieldDef => Boolean(f));
  return fields.filter((f) => f.key !== NAME).slice(0, 2);
}
