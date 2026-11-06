// De bouwdoos van het overzicht (zie STIJLBOEK.md → Overzicht): elk blok is een **weergave** (wat je ziet) of een
// **actie** (wat je doet). Een weergave is een zin: "toon <bron> van <lijsten> waar <voorwaarden>, tel <…> per <…>",
// getoond als lijst, tabel, getal, grafiek of kalender, met voorwaarden op wat je ziet (kleur, bovenaan, verbergen).
// Een actie is een knop die logt: een soort met vooraf ingevulde velden, die het formulier opent, meteen bewaart, er
// één bijtelt of start en stopt. Alles is enkel ids en sleutels; de server rekent een weergave uit met de rechten van
// wie kijkt (GET /insights/view), met de motor van bewaarde weergaven (shared/views.ts) en grafieken (shared/charts.ts).

import { CHART_AGGS, CHART_STEPS, cleanChart, computeChart, type ChartAgg, type ChartData, type ChartDef, type ChartForm, type ChartNames, type ChartStep } from "./charts.ts";
import type { Attributes, FieldDef, FieldValue, Names } from "./fields.ts";
import { NUTRIENTS } from "./food.ts";
import { logFields } from "./logview.ts";
import { STATUSES } from "./model.ts";
import { matchesView, NAME, sortItems, type Condition, type ViewDef, type ViewItem } from "./views.ts";

// ---------- bronnen ----------

/** Waar een weergave uit toont: het logboek, de dingen van een lijst, of iets wat de app uitrekent. */
export const SOURCES = {
  logboek: "het logboek",
  dingen: "de dingen",
  voorraad: "de voorraad",
  saldo: "wie moet wie",
  voeding: "wat er gegeten is",
} as const;
export type SourceKind = keyof typeof SOURCES;

/** Volgens welke datum een bron in de tijd staat (voor tellen per periode); null: geen (dan telt "vandaag"). */
export function sourceDate(source: SourceKind, fields: FieldDef[], chosen?: string): string {
  if (source === "logboek") return "at";
  if (source === "voeding") return "day";
  if (source === "voorraad") return "expires";
  if (source === "dingen" && chosen && fields.some((f) => f.key === chosen && f.type === "date")) return chosen;
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
  }
}

// ---------- tonen als ----------

/** De vormen van een weergave; `chart`: met welke grafiekvorm ze uitgerekend wordt (geen: een lijst of tabel). */
export const SHOWS = {
  lijst: { label: "Lijst", chart: null },
  tabel: { label: "Tabel", chart: null },
  getal: { label: "Getal", chart: "number" },
  voortgang: { label: "Voortgang", chart: "number" },
  staafjes: { label: "Staafjes", chart: "bars" },
  lijn: { label: "Lijn", chart: "line" },
  gebied: { label: "Gebied", chart: "line" },
  perkeuze: { label: "Per keuze", chart: "ranked" },
  verdeling: { label: "Verdeling", chart: "parts" },
  kalender: { label: "Kalender", chart: "bars" },
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
  /** De dingen: volgens welk datumveld (anders wanneer ze toegevoegd werden). */
  date?: string;
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
};

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
  const date = typeof o.date === "string" && KEY.test(o.date) ? o.date : undefined;
  return { agg: agg !== "count" && !field ? "count" : agg, ...(agg !== "count" && field ? { field } : {}), ...(by ? { by } : {}), step, n, ...(date ? { date } : {}) };
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
    ...(!counts(show) && limit ? { limit } : {}),
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
  return { kind: "action", name: text(o.name), list, type: id(o.type) ?? "", does, values };
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
        tally: { agg: chart.agg, ...(chart.field ? { field: chart.field } : {}), ...(chart.by ? { by: chart.by } : {}), step: chart.step, n: chart.count, ...(source === "dingen" && chart.date !== "created" ? { date: chart.date } : {}) },
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
};

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
    date: sourceDate(block.source, fields, t.date),
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
export function evaluateView<T extends SourceItem>(block: ViewBlock, fields: FieldDef[], items: T[], ctx: { today: string; me: string; names: Names; chart: ChartNames }): ViewOutcome<T> {
  const chosen = items.filter((i) => matchesView(i, block.where, fields, { today: ctx.today, me: ctx.me, names: ctx.names }));
  const rules = block.rules ?? [];
  const hideEmpty = rules.some((r) => r.when === "leeg");
  const def = chartOf(block, fields);
  if (def) {
    const chart = computeChart(def, fields, chosen, ctx.chart, ctx.today);
    const result = chart?.total ?? null;
    const toneRule = result === null ? undefined : rules.find((r): r is Extract<Rule, { when: "uitkomst" }> => r.when === "uitkomst" && compare(result, r.op, r.value));
    return { rows: [], total: chosen.length, chart, hidden: hideEmpty && chosen.length === 0, tone: toneRule?.then ?? null };
  }
  // Een lijst of tabel: de volgorde, dan wat bovenaan moet, wat weg moet en welke kleur.
  const rowRules = rules.filter((r): r is Extract<Rule, { when: "rij" }> => r.when === "rij");
  const effects = (i: T) => rowRules.filter((r) => matchesView(i, { match: "all", conditions: [r.cond] }, fields, { today: ctx.today, me: ctx.me, names: ctx.names })).map((r) => r.then);
  const sorted = sortItems(chosen, block.where.sort, fields, ctx.names);
  const rows: ViewRow<T>[] = [];
  for (const i of sorted) {
    const fx = effects(i);
    if (fx.includes("verbergen")) continue;
    const tone = fx.find((x): x is RuleTone => x === "rood" || x === "oranje" || x === "groen");
    rows.push({ ...i, ...(tone ? { tone } : {}), ...(fx.includes("bovenaan") ? { top: true } : {}) });
  }
  const ordered = [...rows.filter((r) => r.top), ...rows.filter((r) => !r.top)];
  return { rows: ordered.slice(0, block.limit ?? DEFAULT_LIMIT), total: ordered.length, chart: null, hidden: hideEmpty && ordered.length === 0, tone: null };
}

/** Een rij zoals de server ze geeft: met een link, en bij het logboek de gebeurtenis (afvinken, een timer stoppen). */
export type ViewRowOut = ViewRow<SourceItem & { link: string | null; event?: { status: "gebeurd" | "gepland" | "afgevinkt"; running: boolean; at: string } }>;

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
  };
  const keys = fallback[block.source];
  if (keys.length) return keys.map((k) => byKey.get(k)).filter((f): f is FieldDef => Boolean(f));
  return fields.filter((f) => f.key !== NAME).slice(0, 2);
}
