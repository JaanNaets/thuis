// Weergaven van een lijst: filteren op elk veld, sorteren en kolommen kiezen, en dat bewaren (voor jezelf of voor
// iedereen in het project). Generiek: elke veldsoort heeft zijn vergelijkingen; datums kunnen relatief ("deze week",
// "vorige maand", "de laatste 7 dagen") of als patroon ("de eerste week van de maand", "op een maandag").
//
// Een weergave is geen beveiliging: wie een veld niet mag zien, krijgt de waarde niet, en een voorwaarde op zo'n veld
// telt voor hem niet mee (`matchesView` krijgt enkel de velden die de lezer ziet).

import type { Attributes, FieldDef, FieldValue, Names } from "./fields.ts";
import { formatFieldValue } from "./fields.ts";

// ---------- periodes ----------

export const PERIODS = {
  today: "vandaag",
  yesterday: "gisteren",
  tomorrow: "morgen",
  this_week: "deze week",
  last_week: "vorige week",
  next_week: "volgende week",
  this_month: "deze maand",
  last_month: "vorige maand",
  next_month: "volgende maand",
  this_year: "dit jaar",
  last_year: "vorig jaar",
  next_year: "volgend jaar",
  before_today: "voor vandaag",
  from_today: "vanaf vandaag",
  last_days: "de laatste … dagen",
  next_days: "de komende … dagen",
  range: "tussen twee datums",
} as const;
export type PeriodKind = keyof typeof PERIODS;
export type Period = { p: PeriodKind; n?: number; from?: string; to?: string };

const DAY = 86_400_000;
const toDay = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(toDay(d) + n * DAY);
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Maandag van de week (een week begint op maandag). */
const monday = (d: string) => addDays(d, -((new Date(toDay(d)).getUTCDay() + 6) % 7));
const monthStart = (d: string, shift = 0) => {
  const x = new Date(toDay(d));
  return iso(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + shift, 1));
};
const monthEnd = (d: string, shift = 0) => {
  const x = new Date(toDay(d));
  return iso(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + shift + 1, 0));
};

/** Van en tot (beide inbegrepen, null = open) voor een periode, gezien vanaf `today`. */
export function periodRange(period: Period, today: string): [string | null, string | null] {
  const year = Number(today.slice(0, 4));
  const n = Math.max(1, period.n ?? 7);
  switch (period.p) {
    case "today":
      return [today, today];
    case "yesterday":
      return [addDays(today, -1), addDays(today, -1)];
    case "tomorrow":
      return [addDays(today, 1), addDays(today, 1)];
    case "this_week":
      return [monday(today), addDays(monday(today), 6)];
    case "last_week":
      return [addDays(monday(today), -7), addDays(monday(today), -1)];
    case "next_week":
      return [addDays(monday(today), 7), addDays(monday(today), 13)];
    case "this_month":
      return [monthStart(today), monthEnd(today)];
    case "last_month":
      return [monthStart(today, -1), monthEnd(today, -1)];
    case "next_month":
      return [monthStart(today, 1), monthEnd(today, 1)];
    case "this_year":
      return [`${year}-01-01`, `${year}-12-31`];
    case "last_year":
      return [`${year - 1}-01-01`, `${year - 1}-12-31`];
    case "next_year":
      return [`${year + 1}-01-01`, `${year + 1}-12-31`];
    case "before_today":
      return [null, addDays(today, -1)];
    case "from_today":
      return [today, null];
    case "last_days":
      return [addDays(today, -(n - 1)), today];
    case "next_days":
      return [today, addDays(today, n - 1)];
    case "range":
      return [period.from ?? null, period.to ?? null];
  }
}

export function periodText(period: Period): string {
  if (period.p === "last_days") return `de laatste ${period.n ?? 7} dagen`;
  if (period.p === "next_days") return `de komende ${period.n ?? 7} dagen`;
  if (period.p === "range") {
    const d = (x?: string) => (x ? x.split("-").reverse().join("/") : "");
    return period.from && period.to ? `${d(period.from)} – ${d(period.to)}` : period.from ? `vanaf ${d(period.from)}` : `tot ${d(period.to)}`;
  }
  return PERIODS[period.p];
}

/** De hoeveelste week van de maand (dag 1–7 = 1, … 29–31 = 5). */
export const weekOfMonth = (d: string) => Math.ceil(Number(d.slice(8, 10)) / 7);
/** Valt de dag in de laatste 7 dagen van zijn maand? */
const inLastWeek = (d: string) => Number(d.slice(8, 10)) > Number(monthEnd(d).slice(8, 10)) - 7;
/** Maandag = 1 … zondag = 7. */
export const weekday = (d: string) => ((new Date(toDay(d)).getUTCDay() + 6) % 7) + 1;
export const WEEKDAYS = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];

// ---------- voorwaarden ----------

/** Soorten om te vergelijken, uit de veldsoort (en bij een berekening uit de uitkomst). */
export type Kind = "text" | "number" | "date" | "select" | "multi" | "bool" | "person" | "people" | "item" | "items" | "checklist" | "range" | "tags";

/** Wat ingevuld wordt bij een vergelijking. */
type ValueShape = "none" | "text" | "number" | "between" | "period" | "options" | "week" | "weekdays";

export const OPS = {
  contains: { label: "bevat", value: "text" },
  not_contains: { label: "bevat niet", value: "text" },
  is: { label: "is", value: "text" },
  is_not: { label: "is niet", value: "text" },
  starts: { label: "begint met", value: "text" },
  eq: { label: "is", value: "number" },
  ne: { label: "is niet", value: "number" },
  lt: { label: "kleiner dan", value: "number" },
  le: { label: "hoogstens", value: "number" },
  gt: { label: "groter dan", value: "number" },
  ge: { label: "minstens", value: "number" },
  between: { label: "tussen", value: "between" },
  in: { label: "valt in", value: "period" },
  not_in: { label: "valt niet in", value: "period" },
  week_of_month: { label: "valt in week … van de maand", value: "week" },
  weekday: { label: "valt op een", value: "weekdays" },
  any_of: { label: "is een van", value: "options" },
  none_of: { label: "is geen van", value: "options" },
  all_of: { label: "heeft alle", value: "options" },
  is_true: { label: "ja", value: "none" },
  is_false: { label: "nee", value: "none" },
  done: { label: "alles klaar", value: "none" },
  not_done: { label: "nog niet klaar", value: "none" },
  now: { label: "loopt nu", value: "none" },
  overlaps: { label: "loopt in", value: "period" },
  empty: { label: "is leeg", value: "none" },
  not_empty: { label: "is ingevuld", value: "none" },
} as const satisfies Record<string, { label: string; value: ValueShape }>;
export type Op = keyof typeof OPS;

export const OPS_FOR: Record<Kind, Op[]> = {
  text: ["contains", "not_contains", "is", "is_not", "starts", "empty", "not_empty"],
  number: ["eq", "ne", "lt", "le", "gt", "ge", "between", "empty", "not_empty"],
  date: ["in", "not_in", "week_of_month", "weekday", "empty", "not_empty"],
  select: ["any_of", "none_of", "empty", "not_empty"],
  multi: ["any_of", "all_of", "none_of", "empty", "not_empty"],
  bool: ["is_true", "is_false"],
  person: ["any_of", "none_of", "empty", "not_empty"],
  people: ["any_of", "all_of", "none_of", "empty", "not_empty"],
  item: ["any_of", "none_of", "empty", "not_empty"],
  items: ["any_of", "all_of", "none_of", "empty", "not_empty"],
  checklist: ["done", "not_done", "empty", "not_empty"],
  range: ["now", "overlaps", "empty", "not_empty"],
  tags: ["any_of", "none_of", "empty", "not_empty"],
};

/** Velden die geen veld van de lijst zijn: de naam, de tags, wanneer het toegevoegd werd. */
export const NAME = "_name";
export const TAGS = "_tags";
export const CREATED = "_created";

const NUMBERS = ["money", "number", "score", "year", "duration"];

export function kindOf(def: FieldDef): Kind {
  const type = def.type === "calc" ? (def.result ?? "text") : def.type;
  if (NUMBERS.includes(type)) return "number";
  if (type === "date") return "date";
  if (type === "select") return "select";
  if (type === "multi") return "multi";
  if (type === "bool") return "bool";
  if (type === "person") return "person";
  if (type === "people" || type === "share") return "people";
  if (type === "item") return "item";
  if (type === "items") return "items";
  if (type === "checklist") return "checklist";
  if (type === "date_range" || type === "year_range") return "range";
  return "text";
}

/** Een voorwaarde: `field` (een sleutel, of NAME, TAGS, CREATED), de vergelijking en wat je invulde. */
export type Condition = { field: string; op: Op; value?: unknown };
export type SortKey = { field: string; dir: "asc" | "desc" };
export type ViewDef = {
  match: "all" | "any";
  conditions: Condition[];
  sort?: SortKey[];
  /** De velden als kolom (in die volgorde); leeg = zoals de lijst ze instelt. */
  columns?: string[];
  /** Als agenda volgens een datumveld (zie Agenda). */
  mode?: "list" | "agenda";
  date?: string;
};
/** Een bewaarde weergave; `shared`: voor iedereen in het project; `can_edit`: jij mag ze aanpassen. */
export type SavedView = { id: string; name: string; shared: boolean; def: ViewDef; can_edit: boolean };

export const EMPTY_VIEW: ViewDef = { match: "all", conditions: [] };
export const MAX_CONDITIONS = 20;

/** Een kunstmatig veld voor de naam, de tags en de datum van toevoegen (om er op dezelfde manier mee te werken). */
export function viewFields(fields: FieldDef[], nameLabel = "Naam"): FieldDef[] {
  return [
    { key: NAME, label: nameLabel, type: "text" },
    ...fields,
    { key: TAGS, label: "Tags", type: "multi" },
    { key: CREATED, label: "Toegevoegd op", type: "date" },
  ];
}
export const kindOfKey = (key: string, def: FieldDef) => (key === TAGS ? "tags" : kindOf(def));

// ---------- toepassen ----------

export type ViewItem = { name: string; data: Attributes; tag_ids: string[]; created_at?: string };
export type ViewContext = { today: string; me: string; names: Names };

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

function valueOf(item: ViewItem, key: string): FieldValue | undefined {
  if (key === NAME) return item.name;
  if (key === TAGS) return item.tag_ids;
  if (key === CREATED) return item.created_at?.slice(0, 10);
  return item.data[key];
}

const isEmpty = (v: FieldValue | undefined) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && (v.length === 0 || v.every((x) => x === null)));

/** Id's in een waarde (een persoon, personen, personen met aandeel, verwijzingen, tags, keuzes). */
function idsOf(v: FieldValue | undefined): string[] {
  if (typeof v === "string") return [v];
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).flatMap((x) =>
    typeof x === "string" ? [x] : x && typeof x === "object" && "person_id" in x ? [String((x as { person_id: string }).person_id)] : [],
  );
}

function inPeriod(d: string, period: Period, today: string): boolean {
  const [from, to] = periodRange(period, today);
  return (!from || d >= from) && (!to || d <= to);
}

function testCondition(c: Condition, def: FieldDef, item: ViewItem, ctx: ViewContext): boolean {
  const v = valueOf(item, c.field);
  if (c.op === "empty") return isEmpty(v);
  if (c.op === "not_empty") return !isEmpty(v);
  const kind = kindOfKey(c.field, def);
  switch (kind) {
    case "text": {
      const text = fold(c.field === NAME ? String(v ?? "") : isEmpty(v) ? "" : formatFieldValue(def, v, ctx.names));
      const want = fold(String(c.value ?? ""));
      if (c.op === "contains") return text.includes(want);
      if (c.op === "not_contains") return !text.includes(want);
      if (c.op === "is") return text === want;
      if (c.op === "is_not") return text !== want;
      if (c.op === "starts") return text.startsWith(want);
      return false;
    }
    case "number": {
      if (typeof v !== "number") return c.op === "ne";
      const [a, b] = Array.isArray(c.value) ? (c.value as number[]) : [c.value as number, c.value as number];
      if (c.op === "eq") return v === a;
      if (c.op === "ne") return v !== a;
      if (c.op === "lt") return v < a;
      if (c.op === "le") return v <= a;
      if (c.op === "gt") return v > a;
      if (c.op === "ge") return v >= a;
      if (c.op === "between") return v >= Math.min(a, b) && v <= Math.max(a, b);
      return false;
    }
    case "date": {
      if (!isDate(v)) return c.op === "not_in";
      if (c.op === "in") return inPeriod(v, c.value as Period, ctx.today);
      if (c.op === "not_in") return !inPeriod(v, c.value as Period, ctx.today);
      if (c.op === "week_of_month") return c.value === -1 ? inLastWeek(v) : weekOfMonth(v) === c.value;
      if (c.op === "weekday") return (c.value as number[]).includes(weekday(v));
      return false;
    }
    case "bool":
      return c.op === "is_true" ? v === true : v !== true;
    case "checklist": {
      const list = Array.isArray(v) ? (v as { done: boolean }[]) : [];
      const done = list.length > 0 && list.every((e) => e.done);
      return c.op === "done" ? done : !done;
    }
    case "range": {
      if (!Array.isArray(v)) return false;
      const [from, to] = (v as (string | number | null)[]).map((x) => (x === null || x === undefined ? null : String(x)));
      const year = def.type === "year_range";
      const [pf, pt] = c.op === "now" ? [ctx.today, ctx.today] : periodRange(c.value as Period, ctx.today);
      // Een periode van jaren vergelijken met jaren.
      const lo = year && pf ? pf.slice(0, 4) : pf;
      const hi = year && pt ? pt.slice(0, 4) : pt;
      return (!from || !hi || from <= hi) && (!to || !lo || to >= lo) && Boolean(from || to);
    }
    default: {
      // Keuzes, personen, verwijzingen, tags: op id (of tekst bij keuzes); "me" is wie kijkt.
      const have = idsOf(v);
      const want = ((c.value as string[]) ?? []).map((x) => (x === "me" ? ctx.me : x));
      if (c.op === "any_of") return want.some((w) => have.includes(w));
      if (c.op === "all_of") return want.every((w) => have.includes(w));
      if (c.op === "none_of") return !want.some((w) => have.includes(w));
      return false;
    }
  }
}

/**
 * Hoort een item bij de weergave? `fields`: de velden die de lezer ziet (met `viewFields` erbij); een voorwaarde op
 * een ander veld telt niet mee.
 */
export function matchesView(item: ViewItem, view: ViewDef, fields: FieldDef[], ctx: ViewContext): boolean {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const results = view.conditions.flatMap((c) => {
    const def = byKey.get(c.field);
    return def ? [testCondition(c, def, item, ctx)] : [];
  });
  if (!results.length) return true;
  return view.match === "any" ? results.some(Boolean) : results.every(Boolean);
}

/** Sorteren volgens de weergave; leeg staat altijd achteraan. Zonder sortering blijft de volgorde. */
export function sortItems<T extends ViewItem>(items: T[], sort: SortKey[] | undefined, fields: FieldDef[], names: Names): T[] {
  if (!sort?.length) return items;
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const keyOf = (item: T, key: string): string | number | null => {
    const v = valueOf(item, key);
    if (isEmpty(v)) return null;
    const def = byKey.get(key);
    if (!def) return null;
    if (typeof v === "number") return v;
    if (def.type === "select" && def.options) return def.options.indexOf(String(v));
    if (key === NAME || kindOf(def) === "date") return String(v);
    return fold(formatFieldValue(def, v, names));
  };
  const keys = sort.filter((s) => byKey.has(s.field));
  return [...items].sort((a, b) => {
    for (const s of keys) {
      const x = keyOf(a, s.field);
      const y = keyOf(b, s.field);
      if (x === y) continue;
      if (x === null) return 1;
      if (y === null) return -1;
      const d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "nl", { numeric: true });
      if (d) return s.dir === "desc" ? -d : d;
    }
    return 0;
  });
}

/** Een voorwaarde in woorden: "Datum valt in deze week", "Wie is een van jij". */
export function conditionText(c: Condition, def: FieldDef, names: Names, tagName: (id: string) => string = (id) => id): string {
  const op = OPS[c.op];
  const value = (() => {
    switch (op.value) {
      case "none":
        return "";
      case "text":
        return `"${String(c.value ?? "")}"`;
      case "number":
        return formatFieldValue(def.type === "calc" ? { ...def, type: def.result ?? "number" } : def, c.value as number, names) || String(c.value);
      case "between": {
        const [a, b] = c.value as number[];
        const f = (x: number) => formatFieldValue(def.type === "calc" ? { ...def, type: def.result ?? "number" } : def, x, names) || String(x);
        return `${f(a)} en ${f(b)}`;
      }
      case "period":
        return periodText(c.value as Period);
      case "week":
        return c.value === -1 ? "laatste" : String(c.value);
      case "weekdays":
        return (c.value as number[]).map((d) => WEEKDAYS[d - 1]).join(" of ");
      case "options": {
        const list = (c.value as string[]).map((x) =>
          x === "me" ? "jij" : c.field === TAGS ? tagName(x) : ["person", "people"].includes(kindOf(def)) ? names.person(x) : ["item", "items"].includes(kindOf(def)) ? names.item(x) : x,
        );
        return list.join(", ");
      }
    }
  })();
  const label = c.op === "week_of_month" ? `valt in week ${value} van de maand` : `${op.label}${value ? ` ${value}` : ""}`;
  return `${def.label} ${label}`;
}

// ---------- nakijken (wat binnenkomt) ----------

const isPeriod = (v: unknown): v is Period => {
  if (!v || typeof v !== "object") return false;
  const p = v as Period;
  if (typeof p.p !== "string" || !Object.hasOwn(PERIODS, p.p)) return false;
  if (p.n !== undefined && (!Number.isInteger(p.n) || p.n < 1 || p.n > 3650)) return false;
  if (p.p === "range") return (p.from === undefined || isDate(p.from)) && (p.to === undefined || isDate(p.to)) && Boolean(p.from || p.to);
  return true;
};

function cleanValue(op: Op, value: unknown): unknown {
  switch (OPS[op].value) {
    case "none":
      return undefined;
    case "text":
      if (typeof value !== "string" || value.length > 200) throw new Error("Vul in waarop je zoekt");
      return value;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Vul een getal in");
      return value;
    case "between":
      if (!Array.isArray(value) || value.length !== 2 || !value.every((x) => typeof x === "number" && Number.isFinite(x))) throw new Error("Vul twee getallen in");
      return value;
    case "period":
      if (!isPeriod(value)) throw new Error("Kies een periode");
      return { p: value.p, ...(value.n !== undefined ? { n: value.n } : {}), ...(value.p === "range" ? { from: value.from, to: value.to } : {}) };
    case "week":
      if (value !== -1 && !(Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5)) throw new Error("Kies een week van de maand");
      return value;
    case "weekdays":
      if (!Array.isArray(value) || !value.length || !value.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) throw new Error("Kies een dag van de week");
      return [...new Set(value as number[])];
    case "options":
      if (!Array.isArray(value) || !value.length || value.length > 100 || !value.every((x) => typeof x === "string" && x.length <= 200))
        throw new Error("Kies minstens één waarde");
      return [...new Set(value as string[])];
  }
}

/** Een weergave nakijken tegen de velden van de lijst (met `viewFields`). Gooit een Error met uitleg. */
export function cleanView(raw: unknown, fields: FieldDef[]): ViewDef {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Geen geldige weergave");
  const o = raw as Record<string, unknown>;
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const list = Array.isArray(o.conditions) ? o.conditions : [];
  if (list.length > MAX_CONDITIONS) throw new Error(`Hoogstens ${MAX_CONDITIONS} voorwaarden`);
  const conditions = list.map((c): Condition => {
    const x = (c ?? {}) as Record<string, unknown>;
    const def = typeof x.field === "string" ? byKey.get(x.field) : undefined;
    if (!def) throw new Error("Een voorwaarde gaat over een veld dat niet (meer) bestaat");
    const op = x.op as Op;
    if (typeof op !== "string" || !OPS_FOR[kindOfKey(def.key, def)].includes(op)) throw new Error(`Die vergelijking kan niet bij "${def.label}"`);
    try {
      const value = cleanValue(op, x.value);
      return { field: def.key, op, ...(value !== undefined ? { value } : {}) };
    } catch (err) {
      throw new Error(`${def.label}: ${(err as Error).message.toLowerCase()}`);
    }
  });
  const sort = (Array.isArray(o.sort) ? o.sort : [])
    .filter((s): s is SortKey => !!s && typeof s === "object" && byKey.has((s as SortKey).field) && ["asc", "desc"].includes((s as SortKey).dir))
    .slice(0, 3)
    .map((s) => ({ field: s.field, dir: s.dir }));
  const columns = (Array.isArray(o.columns) ? o.columns : []).filter((k): k is string => typeof k === "string" && byKey.has(k) && !k.startsWith("_")).slice(0, 6);
  const date = typeof o.date === "string" && byKey.has(o.date) && kindOf(byKey.get(o.date)!) === "date" ? o.date : undefined;
  return {
    match: o.match === "any" ? "any" : "all",
    conditions,
    ...(sort.length ? { sort } : {}),
    ...(columns.length ? { columns: [...new Set(columns)] } : {}),
    ...(o.mode === "agenda" && date ? { mode: "agenda" as const, date } : {}),
  };
}
