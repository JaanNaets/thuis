// Voorraad: hoeveel er van een ding is, uitgerekend uit de lijnen (nooit bewaard).
//
// Een lijst telt voorraad als ze `stock` heeft: welke velden van een ding zeggen in welke eenheid het telt (kg, l,
// stuk, zak), wat er in één stuk en in één verpakking zit, en wat het minimum is. Dan is de voorraad van een ding:
// de laatste telling (een meting `voor` het ding, met een hoeveelheid), plus wat er daarna bij kwam (`in`), min wat
// eraf ging (`uit`). Enkel wat gebeurd is, telt (geen geplande of afgevinkte boodschappen). Elke lijn wordt eerst
// omgerekend naar de eenheid van het ding (500 g van een voorraad in kg is 0,5).

import type { Attributes, FieldDef } from "./fields.ts";
import type { Base, LineRole, Status, StockLevel } from "./model.ts";
import { convert, normalizeUnit, round3, type Measure } from "./units.ts";

/** Welke velden van een ding zeggen hoe het telt (sleutels), en de eenheid als er geen veld is. */
export type StockDef = {
  /** Een veld (tekst of keuzelijst) met de eenheid van het ding: kg, l, stuk, zak. */
  unit?: string;
  /** De eenheid als het ding er geen heeft ("stuk"). */
  default_unit?: string;
  /** Een getal: de inhoud van één stuk in g of ml. */
  piece?: string;
  /** Een getal: hoeveel er in één verpakking zit, in de eenheid van het ding. */
  pack?: string;
  /** Een tekst: hoe die verpakking heet (zak, pot). */
  pack_name?: string;
  /** Een getal: bijna op vanaf hier (in de eenheid van het ding). */
  min?: string;
};

const KEYS = ["unit", "piece", "pack", "pack_name", "min"] as const;

/** Nakijken wat binnenkomt: enkel sleutels van velden van de lijst, met de juiste soort. Null = telt niet. */
export function cleanStock(raw: unknown, fields: FieldDef[]): StockDef | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: StockDef = {};
  const typeOf = (key: unknown) => (typeof key === "string" ? fields.find((f) => f.key === key)?.type : undefined);
  const textual = (t: string | undefined) => t === "text" || t === "select";
  for (const k of KEYS) {
    const t = typeOf(o[k]);
    if (!t) continue;
    if ((k === "unit" || k === "pack_name") && !textual(t)) continue;
    if ((k === "piece" || k === "pack" || k === "min") && t !== "number") continue;
    out[k] = o[k] as string;
  }
  const unit = normalizeUnit(typeof o.default_unit === "string" ? o.default_unit.slice(0, 20) : null);
  if (unit) out.default_unit = unit;
  return out;
}

/** Hoe een ding telt: zijn eenheid, de inhoud per stuk en per verpakking. */
export function measureFor(def: StockDef, data: Attributes): Measure {
  const text = (k?: string) => (k && typeof data[k] === "string" && (data[k] as string).trim() ? (data[k] as string) : null);
  const num = (k?: string) => (k && typeof data[k] === "number" && (data[k] as number) > 0 ? (data[k] as number) : null);
  return { unit: normalizeUnit(text(def.unit) ?? def.default_unit ?? null), piece: num(def.piece), pack: num(def.pack), pack_name: text(def.pack_name) };
}

/** Een lijn die de voorraad van een ding raakt, met wat nodig is om te tellen. */
export type StockLine = {
  at: string;
  /** Om lijnen op hetzelfde moment in volgorde te zetten. */
  created_at: string;
  base: Base;
  status: Status;
  role: LineRole;
  amount: number | null;
  unit: string | null;
  expires: string | null;
};

/** Telt deze lijn mee voor de voorraad? */
export const countsForStock = (l: Pick<StockLine, "status" | "role" | "base">) =>
  l.status === "gebeurd" && (l.role === "in" || l.role === "uit" || (l.role === "voor" && l.base === "meting"));

/**
 * De voorraad van een ding uit zijn lijnen (in eender welke volgorde). Wat er nog is, komt van de oudste lijnen eerst
 * eraf (zo weet je ongeveer wat het eerst vervalt).
 */
export function stockLevel(def: StockDef, data: Attributes, lines: StockLine[]): StockLevel {
  const measure = measureFor(def, data);
  const sorted = lines.filter(countsForStock).sort((a, b) => a.at.localeCompare(b.at) || a.created_at.localeCompare(b.created_at));
  // Wat er nog is, per partij (van oud naar nieuw).
  let batches: { left: number; expires: string | null }[] = [];
  for (const l of sorted) {
    const n = l.amount === null ? (measure.pack ?? 1) : convert(l.amount, l.unit, measure);
    if (!Number.isFinite(n)) continue;
    if (l.role === "voor") {
      // Een telling: zoveel is er nu.
      batches = n > 0 ? [{ left: n, expires: null }] : [];
    } else if (l.role === "in") {
      batches.push({ left: n, expires: l.expires });
    } else {
      let rest = n;
      for (const b of batches) {
        if (rest <= 0) break;
        const take = Math.min(b.left, rest);
        b.left -= take;
        rest -= take;
      }
      batches = batches.filter((b) => b.left > 1e-9);
      // Meer eraf dan er was: de voorraad gaat onder nul (iets niet gelogd); toon dat eerlijk.
      if (rest > 1e-9) batches.push({ left: -rest, expires: null });
    }
  }
  const amount = round3(batches.reduce((s, b) => s + b.left, 0));
  const minKey = def.min;
  const min = minKey && typeof data[minKey] === "number" ? (data[minKey] as number) : null;
  const expiries = batches.filter((b) => b.left > 0 && b.expires).map((b) => b.expires!) as string[];
  return {
    amount,
    unit: measure.unit,
    low: min !== null ? amount <= min : amount <= 0,
    expires: expiries.length ? expiries.sort()[0] : null,
  };
}

/** De prijs per eenheid van het ding (in cent), uit een lijn met een prijs; null als het niet te zeggen is. */
export function unitPrice(price: number | null, amount: number | null, unit: string | null, measure: Measure): number | null {
  if (price === null || !(price > 0)) return null;
  const n = amount === null ? 1 : convert(amount, unit, measure);
  if (!(n > 0)) return null;
  return Math.round(price / n);
}
