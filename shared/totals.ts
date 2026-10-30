// Totalen: een samenvatting over de items van een lijst, zoals "Kcal per dag" (de som van Kcal, per Datum, met een
// doel) of "Uitgaven per maand" (de som van Bedrag per Datum, apart per Betaald door). Generiek: elk getal of elke
// berekening, alles samen of per dag, week, maand of jaar, eventueel apart per persoon of keuze, met een doel of grens.
//
// Waar het telt: in het project dat je bekijkt, eventueel met zijn subprojecten, en eventueel ook in lijsten uit
// andere projecten met dezelfde velden (op sleutel). Een **saldo** trekt per persoon af wat bij een tweede veld staat
// (betaald door − verdeling = wie nog geld krijgt); een saldo dat **verrekent**, telt mee in Wie moet wie.
//
// De API rekent uit, per lezer: enkel items uit projecten en lijsten die je mag zien, met de velden die je daar mag
// zien. Mag je in het project zelf een veld van een totaal (of iets waarvan het afhangt) niet zien, dan krijg je het
// totaal niet (`visibleTotals`).

import { aggregate, AGGS, fieldDeps, NUMERIC, typeOf, type Agg } from "./calc.ts";
import type { Attributes, FieldDef, FieldType, FieldValue, Share } from "./fields.ts";

export type Period = "all" | "day" | "week" | "month" | "year";

export type TotalDef = {
  /** Vast, om het totaal te herkennen (ook als je het hernoemt). */
  id: string;
  /** Leeg = een naam uit wat het telt ("Kcal per dag"). */
  label?: string;
  agg: Agg;
  /** Het getal dat geteld wordt (niet bij Hoeveel). */
  field?: string;
  period: Period;
  /** Het datumveld dat zegt in welke periode een item valt (niet bij Alles samen). */
  date?: string;
  /** Apart per persoon of keuze: een Persoon, Personen, Personen met aandeel, Keuzelijst of Meerdere waarden. */
  by?: string;
  /** Doel of grens, in de eenheid van het veld (een bedrag in cent). */
  goal?: number;
  /** "max": niet meer dan (een budget, calorieën); "min": minstens (stappen, water). */
  goal_kind?: "max" | "min";
  /** "tree": ook de items in de subprojecten (leeg: enkel het project dat je bekijkt). */
  scope?: "tree";
  /** Ook de items van deze lijsten (ids, uit andere projecten), met dezelfde velden. */
  sources?: string[];
  /** Saldo: per persoon of keuze de som bij `by` min die bij dit veld (betaald door − verdeling). Enkel bij een som. */
  against?: string;
  /** Verrekenen: het saldo telt mee in Wie moet wie op het project (met de subprojecten). */
  settle?: boolean;
};

export const PERIODS = { all: "Alles samen", day: "Per dag", week: "Per week", month: "Per maand", year: "Per jaar" } as const satisfies Record<
  Period,
  string
>;
export const GOAL_KINDS = { max: "Niet meer dan", min: "Minstens" } as const;
/** Hoeveel periodes je terugkijkt (de huidige meegeteld). */
export const HISTORY = { all: 1, day: 7, week: 8, month: 6, year: 5 } as const satisfies Record<Period, number>;
/** Waarop je een totaal kan opsplitsen. */
export const GROUP_TYPES: FieldType[] = ["person", "people", "share", "select", "multi"];
/** Verrekenen kan tussen mensen: wie betaalde (een persoon) en een verdeling of een andere persoon. */
export const SETTLE_TYPES: FieldType[] = ["person", "share"];
export const MAX_TOTALS = 4;
export const MAX_SOURCES = 5;

const AGG_WORDS = { sum: "", count: "Aantal", avg: "Gemiddelde", min: "Kleinste", max: "Grootste" } as const satisfies Record<Agg, string>;

/** De naam van een totaal: zelf gekozen, of uit wat het telt ("Kcal per dag", "Gemiddelde Score per maand"). */
export function totalLabel(t: TotalDef, fields: FieldDef[]): string {
  if (t.label) return t.label;
  if (t.settle) return "Wie moet wie";
  const field = fields.find((f) => f.key === t.field)?.label ?? "";
  const what = t.against
    ? `Saldo ${field.toLowerCase()}`
    : t.agg === "count"
      ? "Aantal"
      : t.agg === "sum"
        ? field
        : `${AGG_WORDS[t.agg]} ${field.toLowerCase()}`;
  return t.period === "all" ? what : `${what} ${PERIODS[t.period].toLowerCase()}`;
}

/** De velden die een totaal gebruikt. */
export function totalKeys(t: TotalDef): string[] {
  return [t.field, t.date, t.by, t.against].filter((k): k is string => Boolean(k));
}

/** Een lijst met Van en Aan (twee personen) die verrekent: daar bewaart "Terugbetaald" een terugbetaling. */
export function isPayments(t: TotalDef, fields: FieldDef[]): boolean {
  const type = (key?: string) => fields.find((f) => f.key === key)?.type;
  return Boolean(t.settle && type(t.field) === "money" && type(t.by) === "person" && type(t.against) === "person");
}

/**
 * Past een lijst uit een ander project bij een totaal? Ze moet dezelfde velden hebben (op sleutel) van een passende
 * soort. Geeft wat er scheelt, of null.
 */
export function sourceMisfit(t: TotalDef, fields: FieldDef[], other: FieldDef[]): string | null {
  for (const key of totalKeys(t)) {
    const mine = fields.find((f) => f.key === key);
    const theirs = other.find((f) => f.key === key);
    if (!mine) continue;
    if (!theirs) return `heeft geen veld "${mine.label}"`;
    const a = typeOf(mine);
    const b = typeOf(theirs);
    const fits = key === t.field ? a === b : key === t.date ? b === "date" : mine.type === theirs.type;
    if (!fits) return `"${theirs.label}" is een ander soort veld`;
    if (t.settle && key === t.field && theirs.type !== "money") return `"${theirs.label}" is geen bedrag`;
  }
  return null;
}

/** Enkel de totalen waarvan je alles mag zien. `fields`: de velden die de lezer ziet. */
export function visibleTotals(totals: TotalDef[], fields: FieldDef[]): TotalDef[] {
  const seen = new Set(fields.map((f) => f.key));
  return totals.filter((t) => totalKeys(t).every((k) => fieldDeps(fields, k).every((d) => seen.has(d))));
}

/** Getallen die je kan optellen: een getal, bedrag, score, jaar of duur, of een berekening met zo'n uitkomst. */
const countable = (def: FieldDef | undefined) => NUMERIC.includes(typeOf(def)!);

/**
 * De totalen van een lijst nakijken tegen haar (nagekeken) velden. Gooit een fout met uitleg. `fields` moeten de
 * uitkomst van hun berekeningen al kennen (zie `checkCalcs`).
 */
export function cleanTotals(raw: unknown, fields: FieldDef[]): TotalDef[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error("De totalen kloppen niet");
  if (raw.length > MAX_TOTALS) throw new Error(`Hoogstens ${MAX_TOTALS} totalen per lijst`);
  const ids = new Set<string>();
  let settles = 0;
  return raw.map((r, index): TotalDef => {
    const o = (r ?? {}) as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label.trim().slice(0, 40) : "";
    const name = label || `Totaal ${index + 1}`;
    const fail = (message: string): never => {
      throw new Error(`${name}: ${message}`);
    };
    let id = typeof o.id === "string" && /^[a-z0-9]{1,16}$/.test(o.id) ? o.id : `t${index + 1}`;
    while (ids.has(id)) id = `${id}x`;
    ids.add(id);

    if (!Object.hasOwn(AGGS, String(o.agg))) fail("kies wat je wil weten");
    const agg = o.agg as Agg;
    const out: TotalDef = { id, agg, period: "all" };
    if (label) out.label = label;
    if (agg !== "count") {
      const def = fields.find((f) => f.key === o.field);
      if (!def) fail("kies welk getal je optelt");
      if (!countable(def)) fail(`"${def!.label}" is geen getal, bedrag of duur`);
      out.field = def!.key;
    }

    if (!Object.hasOwn(PERIODS, String(o.period))) fail("kies over welke periode");
    out.period = o.period as Period;
    if (out.period !== "all") {
      const def = fields.find((f) => f.key === o.date);
      if (!def) fail("kies een datumveld voor de periode");
      if (typeOf(def) !== "date") fail(`"${def!.label}" is geen datum`);
      out.date = def!.key;
    }

    if (o.by !== undefined && o.by !== null && o.by !== "") {
      const def = fields.find((f) => f.key === o.by);
      if (!def || !GROUP_TYPES.includes(def.type)) fail("apart per: kies een persoon, personen, aandeel of keuzelijst");
      out.by = def!.key;
    }

    if (o.against !== undefined && o.against !== null && o.against !== "") {
      const def = fields.find((f) => f.key === o.against);
      if (agg !== "sum" || !out.by) fail("tegenover: enkel bij een som, apart per persoon of keuze");
      if (!def || !GROUP_TYPES.includes(def.type)) fail("tegenover: kies een persoon, personen, aandeel of keuzelijst");
      if (def!.key === out.by) fail("tegenover: kies een ander veld dan bij apart per");
      out.against = def!.key;
    }

    if (o.settle === true) {
      const type = (key?: string) => fields.find((f) => f.key === key)?.type;
      if (settles++) fail("verrekenen: hooguit één totaal per lijst");
      if (!out.against) fail("verrekenen: kies apart per (wie betaalde) en tegenover (de verdeling)");
      if (type(out.field) !== "money") fail("verrekenen: kies een bedrag (geen berekening)");
      if (!SETTLE_TYPES.includes(type(out.by)!) || !SETTLE_TYPES.includes(type(out.against)!))
        fail("verrekenen: apart per en tegenover zijn een persoon of een verdeling");
      if (out.period !== "all") fail("verrekenen: kies alles samen als periode");
      out.settle = true;
    }

    if (o.scope === "tree" || out.settle) out.scope = "tree";
    if (o.sources !== undefined && o.sources !== null) {
      if (!Array.isArray(o.sources) || o.sources.some((x) => typeof x !== "string" || !/^[\w-]{1,64}$/.test(x)))
        fail("ook uit: kies lijsten");
      const sources = [...new Set(o.sources as string[])];
      if (sources.length > MAX_SOURCES) fail(`ook uit: hooguit ${MAX_SOURCES} lijsten`);
      if (sources.length) out.sources = sources;
    }

    if (o.goal !== undefined && o.goal !== null && o.goal !== "") {
      if (typeof o.goal !== "number" || !Number.isFinite(o.goal) || o.goal < 0 || o.goal > 1e12) fail("het doel is een getal van 0 of meer");
      out.goal = o.goal as number;
      out.goal_kind = o.goal_kind === "min" ? "min" : "max";
    }
    return out;
  });
}

/**
 * Totalen hernoemen: de sleutels van nieuwe velden worden pas bij bewaren gekozen. `rename` geeft undefined als het
 * veld weg is; dan valt dat deel weg en zegt de controle wat er nog ontbreekt.
 */
export function renameTotals(totals: TotalDef[], rename: (key: string) => string | undefined): TotalDef[] {
  return totals.map((t) => {
    const out: TotalDef = { ...t };
    for (const k of ["field", "date", "by", "against"] as const) {
      if (!t[k]) continue;
      const next = rename(t[k]!);
      if (next) out[k] = next;
      else delete out[k];
    }
    return out;
  });
}

// ---------- periodes ----------

const DAY = 86_400_000;
const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** In welke periode een datum valt: de dag, de maandag van de week, "2026-10" of "2026". */
export function periodKey(period: Period, date: string): string {
  switch (period) {
    case "all":
      return "all";
    case "day":
      return date;
    case "week": {
      const ms = utc(date);
      const weekday = (new Date(ms).getUTCDay() + 6) % 7;
      return iso(ms - weekday * DAY);
    }
    case "month":
      return date.slice(0, 7);
    case "year":
      return date.slice(0, 4);
  }
}

/** De laatste periodes tot en met die van vandaag, de oudste eerst. */
export function recentPeriods(period: Period, today: string): string[] {
  const n = HISTORY[period];
  const current = periodKey(period, today);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    if (period === "all") out.push("all");
    else if (period === "day") out.push(iso(utc(today) - i * DAY));
    else if (period === "week") out.push(iso(utc(current) - i * 7 * DAY));
    else if (period === "month") {
      const [y, m] = current.split("-").map(Number);
      const d = new Date(Date.UTC(y, m - 1 - i, 1));
      out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
    } else out.push(String(Number(current) - i));
  }
  return out;
}

// ---------- uitrekenen ----------

export type TotalResult = {
  /** De laatste periodes, de oudste eerst; de laatste is de huidige. */
  periods: { key: string; value: number | undefined }[];
  current: number | undefined;
  /** Apart per persoon of keuze (in de huidige periode), het grootste eerst. Bij een saldo: + krijgt, − moet. */
  groups: { key: string; value: number; label?: string }[];
  /** Hoe de uitkomst getoond wordt (een bedrag, een duur, een getal). */
  result: FieldType;
};

/** Per persoon of keuze: welke groepen een item raakt, en welk deel (bij een aandeel). */
function groupsOf(def: FieldDef, value: FieldValue | undefined): { key: string; weight: number }[] {
  if (value === undefined || value === null) return [];
  if (def.type === "share" && Array.isArray(value)) {
    const shares = value as Share[];
    const sum = shares.reduce((s, x) => s + x.share, 0);
    return sum > 0 ? shares.map((x) => ({ key: x.person_id, weight: x.share / sum })) : [];
  }
  if (typeof value === "string") return [{ key: value, weight: 1 }];
  if (Array.isArray(value)) return (value as unknown[]).filter((v): v is string => typeof v === "string").map((key) => ({ key, weight: 1 }));
  return [];
}

/** Een waarde over de groepen van een veld: volgens het aandeel (een bedrag tot op de cent), anders elk de hele waarde. */
function spread(def: FieldDef, value: number, raw: FieldValue | undefined, money: boolean, payer?: string): [string, number][] {
  if (money && def.type === "share" && Array.isArray(raw)) return [...splitCents(value, raw as Share[], payer)];
  return groupsOf(def, raw).map((g) => [g.key, value * g.weight]);
}

/**
 * Wat één item bijdraagt aan een som per persoon of keuze: + bij Apart per, en bij een saldo − bij Tegenover. Null
 * als het niet meetelt (geen getal, of bij een saldo een kant zonder iemand: dan zou het niet op 0 uitkomen).
 */
export function itemNet(t: TotalDef, fields: FieldDef[], data: Attributes): Map<string, number> | null {
  const byDef = fields.find((f) => f.key === t.by);
  const value = t.field ? data[t.field] : undefined;
  if (!byDef || t.agg !== "sum" || typeof value !== "number" || value === 0) return null;
  const money = typeOf(fields.find((f) => f.key === t.field)) === "money";
  const out = new Map<string, number>();
  const plus = spread(byDef, value, data[byDef.key], money);
  if (!plus.length) return null;
  for (const [key, v] of plus) out.set(key, (out.get(key) ?? 0) + v);
  if (t.against) {
    const againstDef = fields.find((f) => f.key === t.against);
    const payer = byDef.type === "person" && typeof data[byDef.key] === "string" ? (data[byDef.key] as string) : undefined;
    const minus = againstDef ? spread(againstDef, value, data[againstDef.key], money, payer) : [];
    if (!minus.length) return null;
    for (const [key, v] of minus) out.set(key, (out.get(key) ?? 0) - v);
  }
  return out;
}

/**
 * Een totaal uitrekenen over items (zoals de lezer ze ziet, zonder archief). `today`: de datum van vandaag bij de
 * lezer (YYYY-MM-DD).
 */
export function computeTotal(t: TotalDef, fields: FieldDef[], items: { data: Attributes }[], today: string): TotalResult {
  const fieldDef = fields.find((f) => f.key === t.field);
  const byDef = fields.find((f) => f.key === t.by);
  const kind = t.agg === "count" ? "number" : typeOf(fieldDef);
  const result: FieldType = kind === "money" || kind === "duration" ? kind : "number";
  const keys = recentPeriods(t.period, today);
  const current = keys[keys.length - 1];

  const buckets = new Map<string, { values: FieldValue[]; count: number }>(keys.map((k) => [k, { values: [], count: 0 }]));
  const groups = new Map<string, { values: FieldValue[]; count: number }>();
  const sums = new Map<string, number>();
  for (const item of items) {
    let key = "all";
    if (t.period !== "all") {
      const date = item.data[t.date!];
      if (typeof date !== "string") continue;
      key = periodKey(t.period, date);
    }
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const value = t.field ? item.data[t.field] : undefined;
    if (t.agg !== "count" && typeof value !== "number") continue;
    bucket.count++;
    if (value !== undefined) bucket.values.push(value);

    if (!byDef || key !== current) continue;
    if (t.agg === "sum") {
      // Een som verdeelt volgens het aandeel (een bedrag tot op de cent); een saldo trekt de andere kant af.
      for (const [g, v] of itemNet(t, fields, item.data) ?? []) sums.set(g, (sums.get(g) ?? 0) + v);
      continue;
    }
    // Hoeveel, een gemiddelde, kleinste of grootste neemt per groep de hele waarde.
    for (const g of groupsOf(byDef, item.data[byDef.key])) {
      const group = groups.get(g.key) ?? { values: [], count: 0 };
      group.count++;
      if (typeof value === "number") group.values.push(value);
      groups.set(g.key, group);
    }
  }

  const sum = (b: { values: FieldValue[]; count: number }) => {
    const v = aggregate(t.agg, b.values, b.count, result);
    return typeof v === "number" ? v : undefined;
  };
  const periods = keys.map((key) => ({ key, value: sum(buckets.get(key)!) }));
  const grouped =
    t.agg === "sum"
      ? [...sums].map(([key, v]) => ({ key, value: result === "number" ? Math.round(v * 1000) / 1000 : Math.round(v) }))
      : [...groups].map(([key, b]) => ({ key, value: sum(b) })).filter((g): g is { key: string; value: number } => g.value !== undefined);
  return {
    periods,
    current: periods[periods.length - 1].value,
    groups: grouped.filter((g) => !t.against || g.value !== 0).sort((a, b) => b.value - a.value || a.key.localeCompare(b.key)),
    result,
  };
}

// ---------- verrekenen ----------

/**
 * Een bedrag (in cent) verdelen volgens aandelen. Samen altijd precies het bedrag: een cent die niet deelbaar is,
 * draagt wie betaalde (als die meedeelt), anders wie het dichtst bij de volgende cent zat.
 */
export function splitCents(amount: number, shares: Share[], payer?: string): Map<string, number> {
  const out = new Map<string, number>();
  const sum = shares.reduce((s, x) => s + x.share, 0);
  if (!shares.length || !(sum > 0)) return out;
  const total = Math.abs(amount);
  const exact = shares.map((x) => ({ id: x.person_id, raw: (total * x.share) / sum }));
  let given = 0;
  for (const e of exact) {
    const cents = Math.floor(e.raw + 1e-9);
    out.set(e.id, (out.get(e.id) ?? 0) + cents);
    given += cents;
  }
  const order = [...exact].sort((a, b) => Number(b.id === payer) - Number(a.id === payer) || (b.raw % 1) - (a.raw % 1) || a.id.localeCompare(b.id));
  for (let rest = total - given, i = 0; rest > 0; rest--, i = (i + 1) % order.length) out.set(order[i].id, out.get(order[i].id)! + 1);
  if (amount < 0) for (const [id, cents] of out) out.set(id, -cents);
  return out;
}

export type Transfer = { from: string; to: string; amount: number };

/** Zo weinig mogelijk overschrijvingen: telkens wie het meest moet, aan wie het meest krijgt. */
export function settleUp(net: Map<string, number>): Transfer[] {
  const side = (sign: 1 | -1) =>
    [...net]
      .filter(([, v]) => v * sign > 0)
      .map(([id, v]) => ({ id, left: Math.abs(v) }))
      .sort((a, b) => b.left - a.left || a.id.localeCompare(b.id));
  const owe = side(-1);
  const get = side(1);
  const out: Transfer[] = [];
  for (let i = 0, j = 0; i < owe.length && j < get.length; ) {
    const amount = Math.min(owe[i].left, get[j].left);
    out.push({ from: owe[i].id, to: get[j].id, amount });
    owe[i].left -= amount;
    get[j].left -= amount;
    if (owe[i].left === 0) i++;
    if (get[j].left === 0) j++;
  }
  return out;
}
