// De kolommen van een weergave (zie STIJLBOEK.md → Weergaven): welke velden je toont en wat ermee gebeurt. Een kolom is
// een veld van de gekozen lijsten (over meer lijsten heen hetzelfde veld, of per lijst gekoppeld aan een ander veld) of
// een formule op andere kolommen ([Bedrag] ÷ [Liter], shared/formula.ts), met een berekening: tonen, of samen over de
// rijen (som, gemiddelde, kleinste, grootste, aantal, van–tot). Zo krijgt een tabel een totaalrij en per groep een rij,
// een getal of grafiek één uitkomst of reeks per kolom die samen telt.
//
// Een formule rekent per rij met de waarden van die rij. Samen (een groep, het totaal, een periode in een grafiek):
// met Tonen op de uitkomsten van haar kolommen (een getal dat je toont, telt dan op), zodat €/l over een maand het
// totale bedrag gedeeld door de totale liters is; met Som, Gemiddelde, … de uitkomsten per rij samen
// ([Prijs] × [Hoeveel], opgeteld).

import { evalFormula, formulaRefs, inferFormula, parseFormula, type FKind, type FNode } from "./formula.ts";
import type { Attributes, FieldDef, FieldType, FieldValue } from "./fields.ts";

export const COL_CALCS = {
  toon: "Tonen",
  sum: "Som",
  avg: "Gemiddelde",
  min: "Kleinste",
  max: "Grootste",
  count: "Aantal",
  range: "Van–tot",
} as const;
export type ColCalc = keyof typeof COL_CALCS;

export type ViewCol = {
  /** Sleutel in de rij van de weergave, uniek in het blok: het veld, of een eigen sleutel (een formule, een tweede keer hetzelfde veld). */
  key: string;
  /** Het veld van de gekozen lijsten; leeg bij een formule. */
  field?: string;
  /** Een formule met de sleutels van andere kolommen ervoor ("[bedrag] / [liter]"). */
  formula?: string;
  /** De naam boven de kolom; leeg: die van het veld (of "Formule"). */
  label?: string;
  calc: ColCalc;
  /** Koppelen: in deze lijsten een ander veld (lijst → sleutel van haar veld), als ze het veld niet (zo) hebben. */
  from?: Record<string, string>;
};

export const MAX_COLS = 12;
const KEY = /^[a-z_][a-z0-9_]{0,39}$/;
const ID = /^[A-Za-z0-9-]{1,64}$/;

/** Getallen die je samen kan tellen; datums (kleinste, grootste, van–tot). */
export const SUM_TYPES: FieldType[] = ["number", "money", "duration", "score", "year"];
const DATE_TYPES: FieldType[] = ["date", "date_range"];
const typeOf = (f: FieldDef | undefined): FieldType | undefined => (f?.type === "calc" ? f.result : f?.type);

/** Welke berekeningen kunnen met een veld van deze soort (een formule: zoals een getal). */
export function calcsFor(type: FieldType | undefined): ColCalc[] {
  if (type && SUM_TYPES.includes(type)) return ["toon", "sum", "avg", "min", "max", "count", "range"];
  if (type && DATE_TYPES.includes(type)) return ["toon", "min", "max", "count", "range"];
  return ["toon", "count"];
}

/** Telt deze kolom samen (een uitkomst per groep, totaal of periode)? Een formule met Tonen ook: op de uitkomsten. */
export const isMeasure = (c: ViewCol) => c.calc !== "toon" || Boolean(c.formula);

/** Kolommen van buiten nakijken (welke velden er zijn, weet de server pas bij het uitrekenen). */
export function cleanCols(raw: unknown): ViewCol[] {
  if (!Array.isArray(raw)) return [];
  const out: ViewCol[] = [];
  for (const r of raw.slice(0, MAX_COLS)) {
    const o = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
    const key = typeof o.key === "string" && KEY.test(o.key) ? o.key : null;
    if (!key || out.some((c) => c.key === key)) continue;
    const calc = Object.hasOwn(COL_CALCS, String(o.calc)) ? (o.calc as ColCalc) : "toon";
    const label = typeof o.label === "string" && o.label.trim() ? o.label.trim().slice(0, 40) : undefined;
    if (typeof o.formula === "string" && o.formula.trim()) {
      // Een formule mag enkel kolommen ervoor gebruiken (geen kringen).
      let node: FNode;
      try {
        node = parseFormula(o.formula);
      } catch {
        continue;
      }
      if (!formulaRefs(node).every((ref) => out.some((c) => c.key === ref))) continue;
      out.push({ key, formula: o.formula.trim(), calc: calc === "count" || calc === "range" ? "toon" : calc, ...(label ? { label } : {}) });
      continue;
    }
    const field = typeof o.field === "string" && KEY.test(o.field) ? o.field : null;
    if (!field) continue;
    const from: Record<string, string> = {};
    if (o.from && typeof o.from === "object" && !Array.isArray(o.from)) {
      for (const [list, f] of Object.entries(o.from as Record<string, unknown>).slice(0, 20)) if (ID.test(list) && typeof f === "string" && KEY.test(f)) from[list] = f;
    }
    out.push({ key, field, calc, ...(label ? { label } : {}), ...(Object.keys(from).length ? { from } : {}) });
  }
  return out;
}

/** Een vrije sleutel voor een nieuwe kolom: het veld zelf, anders met een volgnummer ("f1" voor een formule). */
export function newColKey(cols: Pick<ViewCol, "key">[], base: string): string {
  if (!cols.some((c) => c.key === base) && base !== "f") return base;
  for (let n = 1; ; n++) if (!cols.some((c) => c.key === `${base}${base === "f" ? "" : "_"}${n}`)) return `${base}${base === "f" ? "" : "_"}${n}`;
}

const FKIND_TYPE: Record<Exclude<FKind, "bool" | "const">, FieldType> = { number: "number", money: "money", duration: "duration" };
const fkindOf = (t: FieldType | undefined): FKind => (t === "money" ? "money" : t === "duration" ? "duration" : "number");

/**
 * De velden van de kolommen (om te tonen, te sorteren en te tellen): een veld met de naam van de kolom, een formule als
 * getal, bedrag of duur (wat ze oplevert). Een kolom met een veld dat er niet is, valt weg (null).
 */
export function colFields(cols: ViewCol[], fields: FieldDef[]): (FieldDef | null)[] {
  const out: (FieldDef | null)[] = [];
  const typeOfCol = (ref: string): FKind => {
    const i = cols.findIndex((c) => c.key === ref);
    return fkindOf(typeOf(out[i] ?? undefined));
  };
  for (const c of cols) {
    if (c.formula) {
      let type: FieldType = "number";
      try {
        const kind = inferFormula(parseFormula(c.formula), (ref) => {
          const i = cols.findIndex((x) => x.key === ref);
          const def = out[i];
          if (!def || !SUM_TYPES.includes(def.type)) throw new Error("geen getal");
          return typeOfCol(ref);
        });
        if (kind === "money" || kind === "duration" || kind === "number") type = FKIND_TYPE[kind];
      } catch {
        out.push(null);
        continue;
      }
      out.push({ key: c.key, label: c.label ?? "Formule", type });
      continue;
    }
    const f = fields.find((x) => x.key === c.field);
    out.push(f ? { ...f, key: c.key, label: c.label ?? f.label, ...(f.type === "calc" && f.result ? { type: f.result } : {}) } : null);
  }
  return out;
}

const num = (v: FieldValue | undefined): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * Elke rij met de waarden van de kolommen erbij (onder hun sleutel): het veld en de uitkomst van een formule. Wat een
 * gekoppelde lijst in een ander veld heeft, zette de server al in het veld (`coupleRow`).
 */
export function withCols<T extends { data: Record<string, FieldValue | undefined> }>(rows: T[], cols: ViewCol[], defs: (FieldDef | null)[]): T[] {
  if (!cols.length) return rows;
  const nodes = cols.map((c) => {
    if (!c.formula) return null;
    try {
      return parseFormula(c.formula);
    } catch {
      return null;
    }
  });
  const kindOf = (ref: string): FKind => fkindOf(defs[cols.findIndex((c) => c.key === ref)]?.type);
  return rows.map((row) => {
    const data = { ...row.data };
    cols.forEach((c, i) => {
      if (!defs[i]) return;
      if (c.field) {
        if (c.key !== c.field) data[c.key] = row.data[c.field];
        return;
      }
      const node = nodes[i];
      if (!node) return;
      const v = evalFormula(node, (ref) => num(data[ref]), kindOf);
      data[c.key] = typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : undefined;
    });
    return { ...row, data };
  });
}

/** Een datum om te vergelijken: een dag, of het begin of einde van een periode. */
function dayOf(v: FieldValue | undefined, end = false): string | undefined {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  if (Array.isArray(v)) {
    const d = (end ? v[1] : v[0]) ?? v[0];
    return typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : undefined;
  }
  return undefined;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Een kolom samen over rijen (die al `withCols` kregen): de som, het gemiddelde, de kleinste of grootste, het aantal
 * ingevulde, of van–tot (de eerste en de laatste: een datum als periode, een getal als twee getallen). Tonen: niets,
 * behalve een getal dat een formule op de uitkomsten nodig heeft (`forFormula`: dan de som).
 */
export function aggregateCol(col: ViewCol, def: FieldDef, rows: { data: Record<string, FieldValue | undefined> }[], forFormula = false): FieldValue | undefined {
  const values = rows.map((r) => r.data[col.key]).filter((v) => v !== undefined && v !== null && v !== "");
  if (col.calc === "count") return values.length;
  const date = DATE_TYPES.includes(def.type);
  if (date) {
    const days = values.flatMap((v) => [dayOf(v), dayOf(v, true)]).filter((d): d is string => Boolean(d)).sort();
    if (!days.length) return undefined;
    if (col.calc === "min") return days[0];
    if (col.calc === "max") return days[days.length - 1];
    if (col.calc === "range") return [days[0], days[days.length - 1]];
    return undefined;
  }
  const nums = values.map(num).filter((n): n is number => n !== undefined);
  const calc = col.calc === "toon" && forFormula ? "sum" : col.calc;
  if (calc === "toon" || !nums.length) return undefined;
  if (calc === "sum") return round(nums.reduce((a, b) => a + b, 0));
  if (calc === "avg") return round(nums.reduce((a, b) => a + b, 0) / nums.length);
  if (calc === "min") return Math.min(...nums);
  if (calc === "max") return Math.max(...nums);
  // Van–tot van getallen: de kleinste en de grootste.
  return `${Math.min(...nums)} – ${Math.max(...nums)}`;
}

/**
 * De uitkomsten van alle kolommen samen over deze rijen: elke kolom met haar berekening; een formule met Tonen op de
 * uitkomsten van haar kolommen, met een andere berekening op haar uitkomsten per rij.
 */
export function aggregateCols(cols: ViewCol[], defs: (FieldDef | null)[], rows: { data: Record<string, FieldValue | undefined> }[]): Record<string, FieldValue | undefined> {
  const out: Record<string, FieldValue | undefined> = {};
  const kindOf = (ref: string): FKind => fkindOf(defs[cols.findIndex((c) => c.key === ref)]?.type);
  // Wat een formule op de uitkomsten gebruikt: de uitkomst van die kolom, of (tonen) de som van haar getallen.
  const forFormula = new Map<string, number | undefined>();
  cols.forEach((c, i) => {
    const def = defs[i];
    if (!def) return;
    let value: FieldValue | undefined;
    if (c.formula && c.calc === "toon") {
      let node: FNode | null = null;
      try {
        node = parseFormula(c.formula);
      } catch {
        node = null;
      }
      const v = node ? evalFormula(node, (ref) => forFormula.get(ref), kindOf) : undefined;
      value = typeof v === "number" && Number.isFinite(v) ? round(v) : undefined;
    } else value = aggregateCol(c, def, rows);
    out[c.key] = value;
    forFormula.set(c.key, num(c.calc === "toon" && !c.formula ? aggregateCol(c, def, rows, true) : value));
  });
  return out;
}

/** Een groep rijen van een tabel: de waarde waarop gegroepeerd is, als tekst, hoeveel rijen en de uitkomsten. */
export type ColGroup = { key: string; label: string; count: number; values: Record<string, FieldValue | undefined> };

/**
 * Een rij uit een lijst met de gekoppelde velden van die lijst (`from`) onder het veld van de kolom, en de velden die
 * hetzelfde heten en dezelfde soort zijn (`same`: sleutel in deze lijst → sleutel in de weergave).
 */
export function coupleRow(data: Attributes, list: string, cols: ViewCol[], same: Map<string, string>): Attributes {
  const out: Attributes = { ...data };
  for (const [own, shared] of same) if (out[shared] === undefined && data[own] !== undefined) out[shared] = data[own];
  for (const c of cols) {
    const other = c.field ? c.from?.[list] : undefined;
    if (!other) continue;
    if (data[other] === undefined) delete out[c.field!];
    else out[c.field!] = data[other];
  }
  return out;
}

/** Hetzelfde veld in twee lijsten: dezelfde sleutel, of dezelfde naam en soort (Prijs in Wijnen en in de kelder). */
export const sameField = (a: Pick<FieldDef, "key" | "label" | "type">, b: Pick<FieldDef, "key" | "label" | "type">) =>
  a.key === b.key || (a.type === b.type && a.label.trim().toLocaleLowerCase("nl") === b.label.trim().toLocaleLowerCase("nl"));
