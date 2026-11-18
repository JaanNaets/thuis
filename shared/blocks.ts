// De bouwdoos van het overzicht (zie STIJLBOEK.md → Overzicht): elk blok is een **weergave** (wat je ziet) of een
// **actie** (wat je doet). Een weergave is een zin: "toon <bron> van <lijsten> waar <voorwaarden>, tel <…> per <…>",
// getoond als lijst, tabel, agenda, getal of grafiek, met voorwaarden op wat je ziet (kleur, bovenaan, verbergen). Een
// weergave met een periode (deze maand, de laatste 6 weken, een agenda) blader je door (`viewSpan`).
// Een actie is een knop die logt: een soort met vooraf ingevulde velden, die het formulier opent, meteen bewaart, er
// één bijtelt of start en stopt. Alles is enkel ids en sleutels; de server rekent een weergave uit met de rechten van
// wie kijkt (GET /insights/view), met de motor van bewaarde weergaven (shared/views.ts) en grafieken (shared/charts.ts).

import { monthGrid, shiftMonth } from "./agenda.ts";
import { bucketLabel, CHART_AGGS, CHART_STEPS, chartWindow, cleanChart, computeChart, previousWindow, type ChartAgg, type ChartData, type ChartDef, type ChartForm, type ChartNames, type ChartStep, type ChartWindow } from "./charts.ts";
import { evalFormula, parseFormula } from "./formula.ts";
import type { Attributes, FieldDef, FieldValue, Names } from "./fields.ts";
import { NUTRIENTS } from "./food.ts";
import { logFields } from "./logview.ts";
import { fillsLists, STATUSES, type KindInfo } from "./model.ts";
import { groupItems, matchesView, NAME, PERIODS, periodRange, periodText, sortItems, type Condition, type Period, type PeriodKind, type ViewDef, type ViewItem } from "./views.ts";
import { aggregateCols, cleanCols, colFields, isMeasure, sameField, withCols, type ColGroup, type ViewCol } from "./viewcols.ts";

// ---------- bronnen ----------

/** Waar een weergave uit toont: het logboek, de items van een lijst, of iets wat de app uitrekent. */
export const SOURCES = {
  logboek: "het logboek",
  items: "de items",
  voorraad: "de voorraad",
  saldo: "wie moet wie",
  voeding: "wat er gegeten is",
  datums: "alles met een datum",
} as const;
export type SourceKind = keyof typeof SOURCES;

/** Volgens welke datum een bron in de tijd staat (tellen per periode, een agenda); bij de items kies je een datumveld. */
export function sourceDate(source: SourceKind, fields: FieldDef[], chosen?: string): string {
  if (source === "logboek" || source === "datums") return "at";
  if (source === "voeding") return "day";
  if (source === "voorraad") return "expires";
  if (source === "items") {
    const dates = fields.filter((f) => f.type === "date" || f.type === "date_range");
    return (dates.find((f) => f.key === chosen) ?? dates.find((f) => f.agenda) ?? dates[0])?.key ?? "created";
  }
  return "created";
}

/** De voorraad als kolommen bij de items van een lijst die telt: hoeveel, bijna op, de vroegste houdbaarheid. */
export const STOCK_FIELDS: FieldDef[] = [
  { key: "_voorraad", label: "Voorraad", type: "number" },
  { key: "_bijna_op", label: "Bijna op", type: "bool" },
  { key: "_houdbaar", label: "Houdbaar tot", type: "date" },
];

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
 * keuze; items: hun velden), `kinds`: de soorten die er gelogd kunnen worden (hun velden komen bij het logboek).
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
    case "items": {
      // Over meer lijsten heen: een veld met dezelfde sleutel, of dezelfde naam en soort, is één kolom (`sameField`).
      const fields: FieldDef[] = [];
      for (const f of ctx.lists.flatMap((l) => l.fields)) if (!fields.some((g) => sameField(g, f))) fields.push(f);
      // Uit meer lijsten: ook in welke lijst het staat (om te tonen, te filteren of te groeperen).
      const list: FieldDef[] = ctx.lists.length > 1 ? [{ key: LIST_KEY, label: "Lijst", type: "select", options: ctx.lists.map((l) => l.name).slice(0, 60) }] : [];
      return [{ key: NAME, label: "Naam", type: "text" }, ...list, ...fields.filter((f) => f.key !== LIST_KEY)];
    }
    case "voorraad":
      return [
        { key: NAME, label: "Naam", type: "text" },
        { key: LIST_KEY, label: "Lijst", type: "select", options: ctx.lists.map((l) => l.name).slice(0, 60) },
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
      // Wat gebeurde of gepland staat, en de datums van items met "In de agenda" (de keuring, een verjaardag).
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
  /** De lijsten; leeg = al je lijsten (bij de items: minstens één). */
  lists: string[];
  where: ViewDef;
  show: Show;
  tally?: Tally;
  /** De items: volgens welk datumveld ze in de tijd staan (tellen per periode, agenda); anders het eerste. */
  date?: string;
  /** Lijst en tabel: hoogstens zoveel rijen. */
  limit?: number;
  /** Voortgang (en een lijn bij getal en grafiek): het doel. */
  goal?: number;
  rules?: Rule[];
  /**
   * De kolommen en wat ermee gebeurt (shared/viewcols.ts): een tabel of lijst toont ze, met een totaalrij of per groep
   * een rij als er een samen telt; een getal of grafiek telt elke kolom die samen telt (een reeks of getal per kolom).
   * Leeg: van vroeger (`where.columns`, `tally`).
   */
  cols?: ViewCol[];
  /** Groeperen: per waarde van een veld, een datum per dag, week, maand of jaar (`step`). */
  group?: ViewGroup;
};

export type ViewGroup = { field: string; step?: ChartStep };

export const ACTION_DOES = {
  form: "Opent het formulier",
  save: "Bewaart meteen",
  count: "Telt er een bij",
  timer: "Start en stopt",
} as const;
export type ActionDoes = keyof typeof ACTION_DOES;

export type ActionBlock = {
  kind: "action";
  /** De naam op de knop; leeg: de naam van het formulier. */
  name: string;
  /** Enkel van vroeger (leeg bij een nieuwe actie): de lijst om het formulier terug te vinden (`legacyForm`). */
  list: string;
  /** Het formulier; van vroeger soms een vertrekpunt of leeg (de eerste van de lijst). */
  type: string;
  does: ActionDoes;
  /** Vooraf ingevuld: velden van de soort (en `name`, de omschrijving). */
  values: Attributes;
  /** Gepland in plaats van gebeurd (een boodschap, iets te doen): enkel bij formulier en bewaren (`canPlan`). */
  planned?: true;
};

/**
 * Het formulier van een actie: `type`; van vroeger (een lijst met een vertrekpunt of leeg) het formulier dat de omzetting
 * voor die lijst en dat vertrekpunt maakte (`<lijst>-<vertrekpunt>`), of een formulier (met dat vertrekpunt) dat de
 * lijst invult. Zie ook `legacyForm` in shared/apps.ts.
 */
export function actionForm<K extends Pick<KindInfo, "id" | "base" | "parts" | "does">>(block: Pick<ActionBlock, "type" | "list">, kinds: K[]): K | undefined {
  const exact = kinds.find((k) => k.id === block.type);
  if (exact || !block.list) return exact;
  return (
    kinds.find((k) => k.id === `${block.list}-${block.type}`) ??
    kinds.find((k) => fillsLists(k).includes(block.list) && (!block.type || k.base === block.type)) ??
    kinds.find((k) => fillsLists(k).includes(block.list))
  );
}

/** Wat een tik doet en ook gepland kan: het formulier openen of meteen bewaren (tellen en een timer gaan over nu). */
export const canPlan = (does: ActionDoes) => does === "form" || does === "save";

/** Of een actie gepland logt: als ze dat vraagt of haar formulier standaard gepland begint (een boodschap), en enkel als dat kan. */
export const actionPlans = (block: Pick<ActionBlock, "does" | "planned">, kind: { planned: boolean }): boolean => canPlan(block.does) && (block.planned === true || kind.planned);

export const MAX_LIMIT = 50;
/** In een weergave over meer lijsten: in welke lijst een rij staat. */
export const LIST_KEY = "list";
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

/** Overal de oude sleutel "things" (de items van een gebeurtenis) als "items". */
export function renamedThings(value: unknown): unknown {
  if (value === "things") return "items";
  if (Array.isArray(value)) return value.map(renamedThings);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renamedThings(v)]));
  return value;
}

export function cleanViewBlock(raw: unknown): ViewBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  // Vroeger heetten de items "dingen" (de bron) en de kolom met de items van een gebeurtenis "things".
  const named = o.source === "dingen" ? "items" : o.source;
  if ((named === "logboek" || named === "datums") && o.renamed !== true) return cleanViewBlock({ ...(renamedThings(o) as object), source: named, renamed: true });
  const source = Object.hasOwn(SOURCES, String(named)) ? (named as SourceKind) : null;
  if (!source) return null;
  const lists = [...new Set((Array.isArray(o.lists) ? o.lists : []).map(id).filter((x): x is string => x !== null))].slice(0, 20);
  if (source === "items" && !lists.length) return null;
  const show = Object.hasOwn(SHOWS, String(o.show)) ? (o.show as Show) : "lijst";
  const limit = typeof o.limit === "number" && Number.isInteger(o.limit) ? Math.max(1, Math.min(o.limit, MAX_LIMIT)) : undefined;
  const goal = typeof o.goal === "number" && Number.isFinite(o.goal) && Math.abs(o.goal) < 1e12 ? o.goal : undefined;
  // Het datumveld van de items (vroeger in `tally.date`).
  const t = o.tally && typeof o.tally === "object" ? (o.tally as Record<string, unknown>) : {};
  const date = [o.date, t.date].find((d): d is string => typeof d === "string" && KEY.test(d));
  const rules = (Array.isArray(o.rules) ? o.rules : []).slice(0, MAX_RULES).flatMap((r) => {
    const x = cleanRule(r);
    return x ? [x] : [];
  });
  const cols = cleanCols(o.cols);
  const g = o.group && typeof o.group === "object" ? (o.group as Record<string, unknown>) : null;
  const group = g && typeof g.field === "string" && KEY.test(g.field) ? { field: g.field, ...(Object.hasOwn(CHART_STEPS, String(g.step)) ? { step: g.step as ChartStep } : {}) } : undefined;
  return {
    kind: "view",
    name: text(o.name),
    source,
    lists,
    where: cleanWhere(o.where),
    show,
    ...(counts(show) ? { tally: cleanTally(o.tally) } : {}),
    ...(source === "items" && date && (counts(show) || show === "agenda") ? { date } : {}),
    ...((show === "lijst" || show === "tabel") && limit ? { limit } : {}),
    ...(goal !== undefined ? { goal } : {}),
    ...(rules.length ? { rules } : {}),
    ...(cols.length ? { cols } : {}),
    ...(group ? { group } : {}),
  };
}

export function cleanActionBlock(raw: unknown): ActionBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  // Een formulier (`type`); van vroeger soms enkel een lijst, met een vertrekpunt of leeg (zie `legacyForm`).
  const list = id(o.list) ?? "";
  const type = id(o.type) ?? "";
  if (!list && !type) return null;
  const does = Object.hasOwn(ACTION_DOES, String(o.does)) ? (o.does as ActionDoes) : "form";
  const values: Attributes = {};
  if (o.values && typeof o.values === "object" && !Array.isArray(o.values)) {
    for (const [k, v] of Object.entries(o.values as Record<string, unknown>).slice(0, 20)) {
      if (!KEY.test(k)) continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") values[k] = (typeof v === "string" ? v.slice(0, 200) : v) as FieldValue;
    }
  }
  return { kind: "action", name: text(o.name), list, type, does, values, ...(o.planned === true && canPlan(does) ? { planned: true as const } : {}) };
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
      if (raw.show === "items" || raw.show === "things") return view({ name: "", source: "items", lists: [list], where: { match: "all", conditions: [] }, show: "lijst", limit: 5 });
      return view({ name: "", source: "items", lists: [list], where: { match: "all", conditions: [] }, show: "getal", tally: { agg: "count", step: "month", n: 0 } });
    }
    case "chart": {
      const chart = cleanChart(raw.chart);
      if (!chart) return null;
      const list = id(raw.list);
      const source: SourceKind = (raw.source === "items" || raw.source === "dingen") && list ? "items" : "logboek";
      const show: Show = chart.form === "bars" ? "staafjes" : chart.form === "line" ? "lijn" : chart.form === "number" ? "getal" : chart.form === "ranked" ? "perkeuze" : "verdeling";
      return view({
        name: "",
        source,
        lists: list ? [list] : [],
        where: { match: "all", conditions: [] },
        show,
        tally: { agg: chart.agg, ...(chart.field ? { field: chart.field } : {}), ...(chart.by ? { by: chart.by } : {}), step: chart.step, n: chart.count },
        ...(source === "items" && chart.date !== "created" ? { date: chart.date } : {}),
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
  /** Een tabel of lijst met kolommen die samen tellen: de totaalrij, en per groep een rij (dan geen gewone rijen). */
  summary?: { total: Record<string, FieldValue | undefined>; groups?: ColGroup[] } | null;
  /** Een getal met meer kolommen die samen tellen: elk met zijn uitkomst (en die van de periode ervoor). */
  numbers?: { key: string; label: string; unit: ChartData["unit"]; value: number | null; previous: number | null }[];
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
  day_before_yesterday: { unit: "day", n: 1 },
  day_after_tomorrow: { unit: "day", n: 1 },
  this_quarter: { unit: "month", n: 3 },
  last_quarter: { unit: "month", n: 3 },
  next_quarter: { unit: "month", n: 3 },
  last_days: { unit: "day", n: 0 },
  next_days: { unit: "day", n: 0 },
  ago: { unit: "day", n: 0 },
};

/** Hoe ver een periode per stap verschuift; met een aantal (de laatste 3 maanden): dat aantal in haar eenheid. */
function stepOf(period: Period): { unit: "day" | "month"; n: number } {
  const step = PERIOD_STEPS[period.p]!;
  if (step.n) return step;
  const n = Math.max(1, period.n ?? 7);
  const u = period.u ?? "day";
  return u === "day" ? { unit: "day", n } : u === "week" ? { unit: "day", n: 7 * n } : u === "month" ? { unit: "month", n } : { unit: "month", n: 12 * n };
}

/** De eerste voorwaarde met een periode die meeschuift ("wanneer in deze maand"). */
function periodOf(block: ViewBlock): Period | null {
  for (const c of block.where.conditions) {
    const v = c.value as Period | undefined;
    if (c.op === "in" && v && typeof v === "object" && !Array.isArray(v) && typeof v.p === "string" && PERIOD_STEPS[v.p]) return v;
  }
  return null;
}

const NAMED: PeriodKind[] = [
  "today",
  "yesterday",
  "day_before_yesterday",
  "tomorrow",
  "day_after_tomorrow",
  "this_week",
  "last_week",
  "next_week",
  "this_month",
  "last_month",
  "next_month",
  "this_quarter",
  "last_quarter",
  "next_quarter",
  "this_year",
  "last_year",
  "next_year",
];

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
    const step = stepOf(period);
    const n = step.n * k;
    const moved = step.unit === "day" ? addDays(today, n) : addMonths(today, n);
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

/** Een berekening van een kolom als telling van een grafiek (van–tot en tonen tellen niet). */
const AGG_OF: Partial<Record<ViewCol["calc"], ChartAgg>> = { sum: "sum", avg: "avg", min: "min", max: "max", count: "count" };

/** De eenheid van een formule die op de uitkomsten rekent (zoals een veld van die soort). */
const unitOfDef = (def: FieldDef): ChartData["unit"] =>
  def.type === "money" ? { kind: "money" } : def.type === "duration" ? { kind: "duration" } : { kind: "number", ...(def.unit ? { unit: def.unit } : {}) };

/**
 * Een getal of grafiek met kolommen die samen tellen: per kolom een telling (een veld of de uitkomsten van een formule
 * per rij), een formule met Tonen op de uitkomsten van haar kolommen. Over de tijd: een reeks per kolom; een getal: het
 * eerste groot en de andere erbij (`numbers`); per keuze, een verdeling, voortgang of per dag: de eerste kolom.
 */
function measureChart(base: ChartDef, measures: { c: ViewCol; def: FieldDef }[], fields: FieldDef[], rows: SourceItem[], names: ChartNames, today: string) {
  const one = !(base.form === "bars" || base.form === "line" || base.form === "number");
  const used = one ? measures.slice(0, 1) : measures;
  const charts = new Map<string, ChartData | null>();
  for (const m of used) {
    const agg = AGG_OF[m.c.calc];
    if (m.c.formula && m.c.calc === "toon") continue;
    if (!agg) continue;
    // Apart per keuze enkel met één kolom (anders is elke kolom een reeks).
    const def: ChartDef = { ...base, agg, ...(agg !== "count" ? { field: m.c.key } : {}), ...(used.length > 1 ? { by: undefined } : {}) };
    if (agg === "count") delete (def as { field?: string }).field;
    charts.set(m.c.key, computeChart(def, fields, rows, names, today));
  }
  // Een formule op de uitkomsten: per periode (of het geheel) met de uitkomsten van haar kolommen.
  const formulaOn = (m: { c: ViewCol }, pick: (key: string) => number | null | undefined): number | null => {
    try {
      const node = parseFormula(m.c.formula!);
      const v = evalFormula(node, (ref) => pick(ref) ?? undefined, (ref) => {
        const d = measures.find((x) => x.c.key === ref)?.def.type;
        return d === "money" ? "money" : d === "duration" ? "duration" : "number";
      });
      return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
    } catch {
      return null;
    }
  };
  const first = used.map((m) => charts.get(m.c.key)).find((c): c is ChartData => Boolean(c));
  if (!first) return { chart: null, numbers: undefined };
  const value = (key: string, i: number | "total" | "previous"): number | null => {
    const c = charts.get(key);
    if (c) return i === "total" ? c.total : i === "previous" ? c.previous : (c.series[0]?.values[i] ?? null);
    const m = used.find((x) => x.c.key === key);
    return m?.c.formula ? formulaOn(m, (ref) => value(ref, i)) : null;
  };
  if (used.length === 1 && charts.get(used[0].c.key)) return { chart: first, numbers: undefined };
  const series = used.map((m, slot) => ({
    key: m.c.key,
    label: m.def.label,
    slot: slot < MAX_SERIES_SLOTS ? slot : null,
    values: first.buckets.map((_, i) => value(m.c.key, i)),
    unit: charts.get(m.c.key)?.unit ?? unitOfDef(m.def),
  }));
  const head = used[0];
  const chart: ChartData = {
    ...first,
    unit: charts.get(head.c.key)?.unit ?? unitOfDef(head.def),
    series: base.form === "number" ? first.series : series,
    ...(base.form === "bars" ? { side: true as const } : {}),
    total: value(head.c.key, "total"),
    previous: value(head.c.key, "previous"),
  };
  const numbers =
    base.form === "number"
      ? used.map((m) => ({ key: m.c.key, label: m.def.label, unit: charts.get(m.c.key)?.unit ?? unitOfDef(m.def), value: value(m.c.key, "total"), previous: value(m.c.key, "previous") }))
      : undefined;
  return { chart, numbers: numbers && numbers.length > 1 ? numbers : undefined };
}
const MAX_SERIES_SLOTS = 7;

/**
 * Rekent een weergave uit over de rijen van haar bron (al met de rechten van de lezer): de kolommen (velden en
 * formules, shared/viewcols.ts), de voorwaarden van de zin, de volgorde, de voorwaarden op wat je ziet, en de grafiek,
 * de rijen (hoogstens `limit`) met hun totaal, of een rij per groep.
 */
export function evaluateView<T extends SourceItem>(block: ViewBlock, fields: FieldDef[], items: T[], ctx: { today: string; me: string; names: Names; chart: ChartNames; shift?: number }): ViewOutcome<T> {
  const at = viewSpan(block, ctx.today, ctx.shift);
  const span: Span | null = at ? { label: at.label, earlier: at.earlier, later: at.later, from: at.from, to: at.to, ...(at.month ? { month: at.month } : {}) } : null;
  const today = at?.today ?? ctx.today;
  // De kolommen: hun waarden in elke rij, en hun velden erbij (een formule kan je ook filteren of sorteren).
  const cols = block.cols ?? [];
  const defs = colFields(cols, fields);
  const all = withCols(items, cols, defs);
  const vfields = [...fields, ...defs.filter((d): d is FieldDef => d !== null && !fields.some((f) => f.key === d.key))];
  const chosen = all.filter((i) => matchesView(i, block.where, vfields, { today, me: ctx.me, names: ctx.names }));
  const rules = block.rules ?? [];
  const hideEmpty = rules.some((r) => r.when === "leeg");
  const def = chartOf(block, vfields);
  if (def) {
    const measures = cols.flatMap((c, i) => (defs[i] && isMeasure(c) && c.calc !== "range" ? [{ c, def: defs[i]! }] : []));
    const { chart, numbers } = measures.length ? measureChart(def, measures, vfields, chosen, ctx.chart, today) : { chart: computeChart(def, vfields, chosen, ctx.chart, today), numbers: undefined };
    const result = chart?.total ?? null;
    const toneRule = result === null ? undefined : rules.find((r): r is Extract<Rule, { when: "uitkomst" }> => r.when === "uitkomst" && compare(result, r.op, r.value));
    return { rows: [], total: chosen.length, chart, hidden: hideEmpty && chosen.length === 0, tone: toneRule?.then ?? null, span, ...(numbers ? { numbers } : {}) };
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
  const effects = (i: T) => rowRules.filter((r) => matchesView(i, { match: "all", conditions: [r.cond] }, vfields, { today, me: ctx.me, names: ctx.names })).map((r) => r.then);
  const sorted = sortItems(chosen, block.where.sort, vfields, ctx.names);
  const rows: ViewRow<T>[] = [];
  for (const i of sorted) {
    const fx = effects(i);
    if (fx.includes("verbergen")) continue;
    const tone = fx.find((x): x is RuleTone => x === "rood" || x === "oranje" || x === "groen");
    rows.push({ ...i, ...(tone ? { tone } : {}), ...(fx.includes("bovenaan") ? { top: true } : {}) });
  }
  const ordered = [...rows.filter((r) => r.top), ...rows.filter((r) => !r.top)];
  // Kolommen die samen tellen: een totaalrij over alles (niet enkel wat je ziet), en per groep een rij.
  const counted = cols.some((c, i) => defs[i] && isMeasure(c));
  const groups = block.group ? groupItems(ordered, block.group.field, vfields, ctx.names, block.group.step) : null;
  const summary =
    counted || groups
      ? {
          total: aggregateCols(cols, defs, ordered),
          ...(groups ? { groups: groups.map((g) => ({ key: g.key, label: g.label, count: g.items.length, values: aggregateCols(cols, defs, g.items) })) } : {}),
        }
      : null;
  return {
    rows: groups ? [] : ordered.slice(0, block.limit ?? DEFAULT_LIMIT),
    total: groups ? groups.length : ordered.length,
    chart: null,
    hidden: hideEmpty && ordered.length === 0,
    tone: null,
    span,
    summary,
  };
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
  if (block.cols?.length) return colFields(block.cols, fields).filter((f): f is FieldDef => f !== null);
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const chosen = (block.where.columns ?? []).map((k) => byKey.get(k)).filter((f): f is FieldDef => Boolean(f));
  if (chosen.length) return chosen;
  const fallback: Record<SourceKind, string[]> = {
    logboek: ["at", "amount"],
    items: [],
    voorraad: ["level"],
    saldo: ["amount"],
    voeding: ["kcal"],
    datums: ["at", "list"],
  };
  const keys = fallback[block.source];
  if (keys.length) return keys.map((k) => byKey.get(k)).filter((f): f is FieldDef => Boolean(f));
  return fields.filter((f) => f.key !== NAME).slice(0, 2);
}

/**
 * Alles van een tag (de tagpagina): de items van haar lijsten samen, met wat je zoekt in de naam. Als kolommen de
 * velden die een van die lijsten als kolom toont en die in minstens twee ervan staan (bij één lijst: haar kolommen),
 * hoogstens drie, en rechts de lijst (Wijnhuis · Jaargang · Waar, Wijnen). Null als geen van de lijsten items heeft.
 */
export function tagView(lists: { id: string; one: string | null; fields: FieldDef[] }[], query = ""): ViewBlock | null {
  const withItems = lists.filter((l) => l.one);
  if (!withItems.length) return null;
  const count = new Map<string, number>();
  for (const l of withItems) for (const f of l.fields) count.set(f.key, (count.get(f.key) ?? 0) + 1);
  const need = withItems.length > 1 ? 2 : 1;
  const keys: string[] = [];
  for (const l of withItems) for (const f of l.fields) if (f.column && f.key !== LIST_KEY && (count.get(f.key) ?? 0) >= need && !keys.includes(f.key)) keys.push(f.key);
  const q = query.trim();
  return {
    kind: "view",
    name: "",
    source: "items",
    lists: withItems.map((l) => l.id),
    where: {
      match: "all",
      conditions: q ? [{ field: NAME, op: "contains", value: q }] : [],
      columns: [...keys.slice(0, 3), ...(withItems.length > 1 ? [LIST_KEY] : [])],
      sort: [{ field: NAME, dir: "asc" }],
    },
    show: "lijst",
    limit: MAX_LIMIT,
  };
}
