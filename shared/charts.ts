// Grafieken (een blok op je overzicht, zie shared/overview.ts): helemaal zelf samen te stellen uit de velden van een
// lijst. Wat (aantal, som, gemiddelde, hoogste of laagste van een getal), over de tijd (per dag, week, maand of jaar,
// volgens een datum) of per keuze (een keuzelijst, persoon, verwijzing, ja/nee of tag), en als wat (staafjes, lijn, een
// getal, per keuze of een verdeling). Niets staat vast: er is geen grafiek tot je er een maakt.
//
// De API rekent uit (`computeChart`), per lezer: enkel items en velden die hij ziet (zie GET /projects/:id/chart).
// Wat de browser krijgt, zijn enkel de uitkomsten per periode en reeks, nooit de items.

import type { Attributes, FieldDef, FieldType } from "./fields";
import { cleanAlso } from "./views.ts";

/** Velden met mensen: daarop kan "enkel van jou". */
const MINE_TYPES: FieldType[] = ["person", "people", "share"];

export type ChartForm = "bars" | "line" | "number" | "ranked" | "parts";
export type ChartAgg = "count" | "sum" | "avg" | "min" | "max";
export type ChartStep = "day" | "week" | "month" | "year";

export type ChartDef = {
  form: ChartForm;
  agg: ChartAgg;
  /** Het getal (niet bij Aantal). */
  field?: string;
  /** Volgens welke datum een item in een periode valt; "created" = wanneer het toegevoegd werd. */
  date: string;
  /** Per dag, week, maand of jaar. */
  step: ChartStep;
  /** De laatste zoveel periodes (tot en met vandaag); 0 = alles. */
  count: number;
  /** Per keuze: de as bij Per keuze en Verdeling, de reeksen bij Staafjes en Lijn. "tags" = de tags. */
  by?: string;
  /** Een doel of grens, in de eenheid van het veld (een bedrag in cent). */
  goal?: number;
  /** Enkel de items in deze bewaarde weergave. */
  view?: string;
  /** Ook de items uit de subprojecten. */
  sub?: true;
  /** Ook uit: dezelfde lijst in andere projecten (ids; zie `alsoData` in shared/views.ts). */
  also?: string[];
  /** Enkel van jou: een veld met mensen; bij een verdeling telt jouw deel (zie `onlyMine` in shared/totals.ts). */
  mine?: string;
};

export const CHART_FORMS = {
  bars: "Staafjes",
  line: "Lijn",
  number: "Getal",
  ranked: "Per keuze",
  parts: "Verdeling",
} as const satisfies Record<ChartForm, string>;

export const CHART_AGGS = {
  count: "Aantal",
  sum: "Som",
  avg: "Gemiddelde",
  min: "Laagste",
  max: "Hoogste",
} as const satisfies Record<ChartAgg, string>;

export const CHART_STEPS = {
  day: { one: "dag", many: "dagen", per: "Per dag" },
  week: { one: "week", many: "weken", per: "Per week" },
  month: { one: "maand", many: "maanden", per: "Per maand" },
  year: { one: "jaar", many: "jaar", per: "Per jaar" },
} as const satisfies Record<ChartStep, { one: string; many: string; per: string }>;

/** Zoveel periodes hoogstens op een as (meer: de app neemt een grotere stap). */
export const MAX_BUCKETS = 60;
/** Zoveel reeksen of keuzes hebben een eigen kleur; de rest is samen "Overige" (grijs). */
export const MAX_SERIES = 7;
/** Per keuze: zoveel staafjes hoogstens; Verdeling: zoveel delen. */
export const MAX_RANKED = 12;
export const MAX_PARTS = 6;

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const ID = /^[A-Za-z0-9-]{1,64}$/;

/** Velden met een getal (om te tellen). */
export const NUMBER_TYPES: FieldType[] = ["number", "money", "duration", "score"];
/** Velden waarin je kiest (een as of reeksen per keuze). */
export const GROUP_TYPES: FieldType[] = ["select", "multi", "person", "people", "item", "items", "bool"];
/** Velden met een datum. */
export const DATE_TYPES: FieldType[] = ["date", "date_range", "timer"];

const kind = (f: FieldDef): FieldType | undefined => (f.type === "calc" ? f.result : f.type);
export const isNumberField = (f: FieldDef) => NUMBER_TYPES.includes(kind(f) as FieldType);
export const isDateField = (f: FieldDef) => DATE_TYPES.includes(kind(f) as FieldType);
export const isGroupField = (f: FieldDef) => f.type !== "calc" && GROUP_TYPES.includes(f.type);
/** Heeft de grafiek een tijd-as (Staafjes, Lijn) of een periode om te vergelijken (Getal)? */
export const overTime = (form: ChartForm) => form === "bars" || form === "line";
export const byChoice = (form: ChartForm) => form === "ranked" || form === "parts";

/** Wat binnenkomt, nagekeken op vorm (welke velden er bestaan, kijkt `fitChart` na). Ongeldig: null. */
export function cleanChart(raw: unknown): ChartDef | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!Object.hasOwn(CHART_FORMS, String(o.form)) || !Object.hasOwn(CHART_AGGS, String(o.agg)) || !Object.hasOwn(CHART_STEPS, String(o.step))) return null;
  const form = o.form as ChartForm;
  const agg = o.agg as ChartAgg;
  const field = typeof o.field === "string" && KEY.test(o.field) ? o.field : undefined;
  if (agg !== "count" && !field) return null;
  const date = o.date === "created" || (typeof o.date === "string" && KEY.test(o.date)) ? (o.date as string) : "created";
  const count = typeof o.count === "number" && Number.isInteger(o.count) && o.count >= 0 ? Math.min(o.count, 366) : 0;
  const by = o.by === "tags" || (typeof o.by === "string" && KEY.test(o.by)) ? (o.by as string) : undefined;
  if (byChoice(form) && !by) return null;
  const goal = typeof o.goal === "number" && Number.isFinite(o.goal) && Math.abs(o.goal) < 1e12 ? o.goal : undefined;
  const view = typeof o.view === "string" && ID.test(o.view) ? o.view : undefined;
  return {
    form,
    agg,
    ...(agg !== "count" ? { field } : {}),
    date,
    step: o.step as ChartStep,
    count: overTime(form) ? Math.max(count, count === 0 ? 0 : 2) : count,
    ...(by && form !== "number" ? { by } : {}),
    ...(goal !== undefined && (overTime(form) || form === "number") ? { goal } : {}),
    ...(view ? { view } : {}),
    ...(o.sub === true ? { sub: true as const } : {}),
    ...(cleanAlso(o.also).length ? { also: cleanAlso(o.also) } : {}),
    ...(typeof o.mine === "string" && KEY.test(o.mine) ? { mine: o.mine } : {}),
  };
}

/** Kan deze grafiek met deze velden (die de lezer ziet)? Anders: null (dan geen grafiek, zoals een blok dat je niet ziet). */
export function fitChart(def: ChartDef, fields: FieldDef[]): { value?: FieldDef; date?: FieldDef; by?: FieldDef | "tags" } | null {
  const find = (key: string | undefined) => (key ? fields.find((f) => f.key === key) : undefined);
  const value = find(def.field);
  if (def.agg !== "count" && (!value || !isNumberField(value))) return null;
  const date = def.date === "created" ? undefined : find(def.date);
  if (def.date !== "created" && (!date || !isDateField(date))) return null;
  const byField = def.by && def.by !== "tags" ? find(def.by) : undefined;
  if (def.by && def.by !== "tags" && (!byField || !isGroupField(byField))) return null;
  const mine = find(def.mine);
  if (def.mine && (!mine || !MINE_TYPES.includes(mine.type))) return null;
  return { value, date, by: def.by === "tags" ? "tags" : byField };
}

// ---------- periodes ----------

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => {
  const d = parse(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

/** Het begin van de periode waarin een dag valt (een week begint op maandag). */
export function bucketStart(day: string, step: ChartStep): string {
  if (step === "day") return day;
  if (step === "week") return addDays(day, -((parse(day).getUTCDay() + 6) % 7));
  if (step === "month") return `${day.slice(0, 7)}-01`;
  return `${day.slice(0, 4)}-01-01`;
}

/** Het begin van de volgende periode. */
export function nextBucket(start: string, step: ChartStep): string {
  if (step === "day") return addDays(start, 1);
  if (step === "week") return addDays(start, 7);
  const d = parse(start);
  if (step === "month") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return iso(d);
}

const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const MONTHS_LONG = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const DAYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];

/** Hoe een periode heet: kort op de as ("3/11", "nov"), voluit in de tooltip ("ma 3 nov", "week van 3 nov"). */
export function bucketLabel(start: string, step: ChartStep, years: boolean): { short: string; long: string } {
  const d = parse(start);
  const day = d.getUTCDate();
  const month = d.getUTCMonth();
  const year = d.getUTCFullYear();
  switch (step) {
    case "day":
      return { short: `${day}/${month + 1}`, long: `${DAYS[d.getUTCDay()]} ${day} ${MONTHS[month]}${years ? ` ${year}` : ""}` };
    case "week":
      return { short: `${day}/${month + 1}`, long: `week van ${day} ${MONTHS[month]}${years ? ` ${year}` : ""}` };
    case "month":
      return { short: years ? `${MONTHS[month]} ${String(year).slice(2)}` : MONTHS[month], long: `${MONTHS_LONG[month]} ${year}` };
    case "year":
      return { short: String(year), long: String(year) };
  }
}

/** Een periode van dag tot dag (beide erbij). */
export type ChartWindow = { from: string; to: string };

/** De periode van de grafiek: de laatste `count` periodes tot en met vandaag, of null (alles). */
export function chartWindow(def: ChartDef, today: string): ChartWindow | null {
  if (!def.count) return null;
  let from = bucketStart(today, def.step);
  for (let i = 1; i < def.count; i++) from = bucketStart(addDays(from, -1), def.step);
  return { from, to: today };
}

/** Even lang, net ervoor (om te vergelijken bij Getal). */
export function previousWindow(w: ChartWindow, def: ChartDef): ChartWindow {
  let from = w.from;
  for (let i = 0; i < Math.max(def.count, 1); i++) from = bucketStart(addDays(from, -1), def.step);
  return { from, to: addDays(w.from, -1) };
}

/** De stap die op de as past: wordt het te veel, dan een grotere (dag → week → maand → jaar). */
export function fitStep(w: ChartWindow, step: ChartStep): ChartStep {
  const order: ChartStep[] = ["day", "week", "month", "year"];
  for (const s of order.slice(order.indexOf(step))) if (bucketsIn(w, s).length <= MAX_BUCKETS || s === "year") return s;
  return "year";
}

function bucketsIn(w: ChartWindow, step: ChartStep): string[] {
  const out: string[] = [];
  for (let b = bucketStart(w.from, step); b <= w.to && out.length <= MAX_BUCKETS * 8; b = nextBucket(b, step)) out.push(b);
  return out;
}

/** Een tijdstip uit de databank ("2026-11-05 21:30:00", UTC) als dag in België. */
export function brusselsDay(sqlUtc: string): string {
  const d = new Date(`${sqlUtc.replace(" ", "T")}${/Z|[+-]\d\d:?\d\d$/.test(sqlUtc) ? "" : "Z"}`);
  if (Number.isNaN(d.getTime())) return sqlUtc.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// ---------- uitrekenen ----------

/** Een item zoals de grafiek het krijgt: met de rechten van de lezer (enkel wat hij ziet) en zijn berekeningen. */
export type ChartItem = { name: string; data: Attributes; tag_ids: string[]; created_at: string };

/** Namen van keuzes: personen (in de volgorde van het project), items en tags. */
export type ChartNames = { people: { id: string; name: string }[]; item: (id: string) => string | undefined; tags: { id: string; name: string }[] };

export type ChartUnit = { kind: "count" } | { kind: "number"; unit?: string } | { kind: "money" } | { kind: "duration" } | { kind: "score" };

export type ChartData = {
  form: ChartForm;
  agg: ChartAgg;
  unit: ChartUnit;
  step: ChartStep;
  /** De as: periodes (Staafjes, Lijn, Getal) of keuzes (Per keuze, Verdeling, met hun kleur `slot`). */
  buckets: { key: string; label: string; long: string; slot?: number | null }[];
  /** Eén reeks zonder Apart per; anders per keuze (slot = kleur 0–6, null = Overige). */
  series: { key: string; label: string; slot: number | null; values: (number | null)[] }[];
  /** Getal: de uitkomst over de hele periode; Verdeling: het geheel. */
  total: number | null;
  /** Getal: hetzelfde over de periode net ervoor (om te vergelijken). */
  previous: number | null;
  /** Welke periode op de as die van vandaag is (die staat in het zwart); null bij een vaste periode of keuzes. */
  current: number | null;
  goal?: number;
  /** De periode zelf, in woorden ("Laatste 30 dagen", "1/10 – 31/10"). */
  window: string;
};

function aggregate(values: number[], agg: ChartAgg): number | null {
  if (agg === "count") return values.length;
  if (!values.length) return null;
  if (agg === "sum") return Math.round(values.reduce((a, b) => a + b, 0) * 1000) / 1000;
  if (agg === "avg") return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 1000;
  return agg === "min" ? Math.min(...values) : Math.max(...values);
}

/** De dag van een item volgens de datum van de grafiek (een periode: haar begin); geen datum: null. */
function dayOf(item: ChartItem, date: FieldDef | undefined): string | null {
  if (!date) return brusselsDay(item.created_at);
  const v = item.data[date.key];
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (Array.isArray(v) && typeof v[0] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v[0])) return v[0];
  // Een timer: de dag (in België) waarop hij startte.
  const start = v && typeof v === "object" && !Array.isArray(v) ? (v as unknown as { start?: unknown }).start : undefined;
  if (typeof start === "string" && /^\d{4}-\d{2}-\d{2}T/.test(start)) return brusselsDay(start);
  const from = v && typeof v === "object" && !Array.isArray(v) ? (v as unknown as { from?: unknown }).from : undefined;
  if (typeof from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(from)) return from;
  return null;
}

/** De keuzes van een item (een item kan in meer keuzes staan: Meerdere waarden, Personen, tags). */
function choicesOf(item: ChartItem, by: FieldDef | "tags"): string[] {
  if (by === "tags") return item.tag_ids;
  const v = item.data[by.key];
  if (v === undefined || v === null || v === "") return [];
  if (by.type === "bool") return [v === true ? "ja" : "nee"];
  if (Array.isArray(v)) return v.flatMap((x) => (typeof x === "string" ? [x] : x && typeof x === "object" && "item" in x ? [String((x as { item: unknown }).item)] : []));
  if (typeof v === "object" && "text" in (v as object)) return [`t:${(v as { text: string }).text}`];
  return [String(v)];
}

/** Een vaste volgorde en naam per keuze (de kleur volgt de keuze, niet haar plaats in de rangorde). */
function choiceInfo(by: FieldDef | "tags", names: ChartNames): { order: (key: string) => number; label: (key: string) => string } {
  if (by === "tags") {
    const ids = names.tags.map((t) => t.id);
    return { order: (k) => ids.indexOf(k), label: (k) => names.tags.find((t) => t.id === k)?.name ?? "Tag" };
  }
  if (by.type === "select" || by.type === "multi") {
    const opts = by.options ?? [];
    return { order: (k) => (opts.includes(k) ? opts.indexOf(k) : opts.length), label: (k) => k };
  }
  if (by.type === "person" || by.type === "people") {
    const ids = names.people.map((p) => p.id);
    return { order: (k) => (ids.includes(k) ? ids.indexOf(k) : ids.length), label: (k) => names.people.find((p) => p.id === k)?.name ?? "Iemand" };
  }
  if (by.type === "bool") return { order: (k) => (k === "ja" ? 0 : 1), label: (k) => (k === "ja" ? "Ja" : "Nee") };
  // Verwijzingen: op naam (vast genoeg; vrije tekst erachter).
  const label = (k: string) => (k.startsWith("t:") ? k.slice(2) : (names.item(k) ?? "Verborgen"));
  return { order: () => 0, label };
}

const unitOf = (value: FieldDef | undefined): ChartUnit => {
  if (!value) return { kind: "count" };
  const t = kind(value);
  if (t === "money") return { kind: "money" };
  if (t === "duration") return { kind: "duration" };
  if (t === "score") return { kind: "score" };
  return { kind: "number", ...(value.unit ? { unit: value.unit } : {}) };
};

function windowText(def: ChartDef, w: ChartWindow | null, custom: boolean): string {
  if (!w) return "Alles";
  if (custom) {
    const f = (s: string) => `${Number(s.slice(8))}/${Number(s.slice(5, 7))}`;
    return w.from === w.to ? f(w.from) : `${f(w.from)} – ${f(w.to)}`;
  }
  const n = def.count;
  const s = CHART_STEPS[def.step];
  if (n === 1) return def.step === "day" ? "Vandaag" : `Deze ${s.one}`.replace("Deze jaar", "Dit jaar");
  return `Laatste ${n} ${s.many}`;
}

/**
 * Rekent een grafiek uit over deze items (met de rechten van de lezer, zie GET /projects/:id/chart). `period`: een
 * vaste periode voor het hele overzicht (bv. vorige maand, voor een verslag) in plaats van de eigen periode.
 */
export function computeChart(def: ChartDef, fields: FieldDef[], items: ChartItem[], names: ChartNames, today: string, period?: ChartWindow): ChartData | null {
  const fit = fitChart(def, fields);
  if (!fit) return null;
  const unit = unitOf(fit.value);
  const valueOf = (i: ChartItem): number | null => {
    if (def.agg === "count") return 1;
    const v = i.data[fit.value!.key];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  let window = period ?? chartWindow(def, today);
  // Staafjes of lijn over alles: van het eerste item tot vandaag.
  const days = items.map((i) => dayOf(i, fit.date));
  if (!window && overTime(def.form)) {
    const first = days.filter((d): d is string => d !== null).sort()[0];
    window = { from: first ?? today, to: today };
  }
  const inWindow = (d: string | null) => !window || (d !== null && d >= window.from && d <= window.to);
  const chosen = items.filter((_, k) => inWindow(days[k]));
  const base = { form: def.form, agg: def.agg, unit, ...(def.goal !== undefined ? { goal: def.goal } : {}), window: windowText(def, window, Boolean(period)) };

  // Getal: de uitkomst over de periode, en hetzelfde net ervoor; met een kleine lijn per periode.
  if (def.form === "number") {
    const values = chosen.map(valueOf).filter((v): v is number => v !== null);
    let previous: number | null = null;
    if (window && !period) {
      const p = previousWindow(window, def);
      const before = items.filter((_, k) => days[k] !== null && days[k]! >= p.from && days[k]! <= p.to).map(valueOf).filter((v): v is number => v !== null);
      previous = aggregate(before, def.agg);
    }
    const spark = window ? timeSeries(def, window, items, days, valueOf, null, names, period ? null : today) : null;
    return {
      ...base,
      step: spark?.step ?? def.step,
      buckets: spark?.buckets ?? [],
      series: spark?.series ?? [],
      total: aggregate(values, def.agg),
      previous,
      current: spark?.current ?? null,
    };
  }

  // Per keuze en Verdeling: één waarde per keuze.
  if (byChoice(def.form)) {
    const by = fit.by!;
    const info = choiceInfo(by, names);
    const groups = new Map<string, number[]>();
    for (const i of chosen) {
      const v = valueOf(i);
      if (v === null) continue;
      for (const c of choicesOf(i, by)) groups.set(c, [...(groups.get(c) ?? []), v]);
    }
    const rows = [...groups.entries()]
      .map(([key, vs]) => ({ key, value: aggregate(vs, def.agg) ?? 0, values: vs }))
      .sort((a, b) => b.value - a.value || info.label(a.key).localeCompare(info.label(b.key), "nl"));
    const cap = def.form === "parts" ? MAX_PARTS - 1 : MAX_RANKED - 1;
    const shown = rows.length > cap + 1 ? rows.slice(0, cap) : rows;
    const rest = rows.length > cap + 1 ? rows.slice(cap) : [];
    // De kleur volgt de keuze (haar vaste volgorde), niet de rangorde.
    const stable = [...shown].sort((a, b) => info.order(a.key) - info.order(b.key) || info.label(a.key).localeCompare(info.label(b.key), "nl"));
    const slotOf = new Map(stable.map((r, k) => [r.key, k < MAX_SERIES ? k : null]));
    const buckets = shown.map((r) => ({ key: r.key, label: info.label(r.key), long: info.label(r.key), slot: slotOf.get(r.key) ?? null }));
    const values = shown.map((r) => r.value);
    if (rest.length) {
      buckets.push({ key: "overige", label: "Overige", long: "Overige", slot: null });
      values.push(aggregate(rest.flatMap((r) => r.values), def.agg) ?? 0);
    }
    const all = chosen.map(valueOf).filter((v): v is number => v !== null);
    return { ...base, step: def.step, buckets, series: [{ key: "waarde", label: CHART_AGGS[def.agg], slot: 0, values }], total: aggregate(all, def.agg), previous: null, current: null };
  }

  // Staafjes en Lijn: per periode, eventueel per keuze.
  const series = timeSeries(def, window!, items, days, valueOf, fit.by ?? null, names, period ? null : today);
  return { ...base, step: series.step, buckets: series.buckets, series: series.series, total: null, previous: null, current: series.current };
}

/** Eén periode van een reeks: een aantal of som zonder items is 0 (er was niets), een gemiddelde of uiterste leeg. */
const cellValue = (vs: number[], agg: ChartAgg): number | null => (agg === "count" ? vs.length : agg === "sum" ? (aggregate(vs, agg) ?? 0) : aggregate(vs, agg));

function timeSeries(
  def: ChartDef,
  window: ChartWindow,
  items: ChartItem[],
  days: (string | null)[],
  valueOf: (i: ChartItem) => number | null,
  by: FieldDef | "tags" | null,
  names: ChartNames,
  today: string | null,
): { step: ChartStep; buckets: ChartData["buckets"]; series: ChartData["series"]; current: number | null } {
  // Een korte vaste periode (een maand in een verslag): een kleinere stap, zodat er meer dan één periode is.
  const finer: ChartStep[] = ["year", "month", "week", "day"];
  let wanted = def.step;
  while (bucketsIn(window, wanted).length < 2 && wanted !== "day") wanted = finer[finer.indexOf(wanted) + 1];
  const step = fitStep(window, wanted);
  const keys = bucketsIn(window, step);
  const now = today ? keys.indexOf(bucketStart(today, step)) : -1;
  const current = now >= 0 ? now : null;
  const years = keys[0]?.slice(0, 4) !== keys[keys.length - 1]?.slice(0, 4);
  const buckets = keys.map((k) => ({ key: k, ...(({ short, long }) => ({ label: short, long }))(bucketLabel(k, step, years)) }));
  const index = new Map(keys.map((k, i) => [k, i]));
  // Per reeks en per periode de getallen.
  const cells = new Map<string, number[][]>();
  const add = (serie: string, b: number, v: number) => {
    if (!cells.has(serie)) cells.set(serie, keys.map(() => []));
    cells.get(serie)![b].push(v);
  };
  items.forEach((item, k) => {
    const d = days[k];
    if (d === null || d < window.from || d > window.to) return;
    const b = index.get(bucketStart(d, step));
    const v = valueOf(item);
    if (b === undefined || v === null) return;
    if (!by) return add("waarde", b, v);
    for (const c of choicesOf(item, by)) add(c, b, v);
  });
  if (!by) {
    const vals = cells.get("waarde") ?? keys.map(() => []);
    return { step, buckets, current, series: [{ key: "waarde", label: CHART_AGGS[def.agg], slot: 0, values: vals.map((vs) => cellValue(vs, def.agg)) }] };
  }
  const info = choiceInfo(by, names);
  const totals = [...cells.entries()].map(([key, rows]) => ({ key, size: rows.flat().reduce((a, b) => a + Math.abs(b), 0) })).sort((a, b) => b.size - a.size);
  const own = totals.slice(0, totals.length > MAX_SERIES ? MAX_SERIES - 1 : MAX_SERIES).map((t) => t.key);
  const rest = totals.filter((t) => !own.includes(t.key)).map((t) => t.key);
  const stable = [...own].sort((a, b) => info.order(a) - info.order(b) || info.label(a).localeCompare(info.label(b), "nl"));
  const fold = (list: string[]) => keys.map((_, b) => list.flatMap((s) => cells.get(s)![b]));
  const out: ChartData["series"] = stable.map((key, slot) => {
    const rows = cells.get(key)!;
    return { key, label: info.label(key), slot, values: rows.map((vs) => cellValue(vs, def.agg)) };
  });
  if (rest.length) out.push({ key: "overige", label: "Overige", slot: null, values: fold(rest).map((vs) => cellValue(vs, def.agg)) });
  return { step, buckets, series: out, current };
}

// ---------- een periode voor het hele overzicht (verslag) ----------

export const BOARD_PERIODS = {
  week: "Deze week",
  month: "Deze maand",
  last_month: "Vorige maand",
  days30: "Laatste 30 dagen",
  year: "Dit jaar",
  last_year: "Vorig jaar",
  months12: "Laatste 12 maanden",
} as const;
export type BoardPeriod = keyof typeof BOARD_PERIODS;

/** De dagen van een periode voor het hele overzicht. */
export function boardWindow(p: BoardPeriod, today: string): ChartWindow {
  switch (p) {
    case "week":
      return { from: bucketStart(today, "week"), to: today };
    case "month":
      return { from: bucketStart(today, "month"), to: today };
    case "last_month": {
      const start = bucketStart(addDays(bucketStart(today, "month"), -1), "month");
      return { from: start, to: addDays(bucketStart(today, "month"), -1) };
    }
    case "days30":
      return { from: addDays(today, -29), to: today };
    case "year":
      return { from: bucketStart(today, "year"), to: today };
    case "last_year": {
      const y = Number(today.slice(0, 4)) - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    case "months12": {
      let from = bucketStart(today, "month");
      for (let i = 0; i < 11; i++) from = bucketStart(addDays(from, -1), "month");
      return { from, to: today };
    }
  }
}
