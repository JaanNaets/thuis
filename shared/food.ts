// Eten: kcal en voedingswaarden per persoon, uitgerekend uit wat er gegeten werd (nooit bewaard).
//
// Een gebruik (Gegeten) telt als eten als het voedingswaarden heeft: rechtstreeks in een veld van de soort met
// productinfo (een broodje van 450 kcal), of uit de dingen die eraf gingen (300 g pasta × de kcal per 100 g van de
// pasta). Wat je zelf invult, wint. Wie at, staat in de verdeling (`split`); zonder verdeling at wie het logde.

import type { Attributes, FieldDef, Share } from "./fields.ts";
import type { Base, LineRole, Status } from "./model.ts";
import type { ProductKey } from "./product.ts";
import { measureFor, type StockDef } from "./stock.ts";
import { convert, converts, normalizeUnit } from "./units.ts";

/** De voedingswaarden die de app optelt (per 100 g op een ding, in totaal op een gebeurtenis). */
export const NUTRIENTS = ["kcal", "protein", "carbs", "fat", "sugars", "fiber", "salt"] as const satisfies readonly ProductKey[];
export type Nutrient = (typeof NUTRIENTS)[number];
export type Nutrition = Partial<Record<Nutrient, number>>;

export type FoodThing = { fields: FieldDef[]; data: Attributes; stock: StockDef | null };
export type FoodEvent = {
  base: Base;
  status: Status;
  split: Share[] | null;
  created_by: string;
  /** De velden van de soort en hun waarden. */
  fields: FieldDef[];
  data: Attributes;
  lines: { role: LineRole; amount: number | null; unit: string | null; thing: FoodThing | null }[];
};

const valueOf = (fields: FieldDef[], data: Attributes, key: ProductKey): number | null => {
  const f = fields.find((x) => x.product === key && x.type === "number");
  const v = f ? data[f.key] : undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/** Hoeveel gram een lijn is: omgerekend met de eenheid en de inhoud per stuk (of de portie) van het ding. */
export function gramsOf(amount: number | null, unit: string | null, thing: FoodThing): number | null {
  const m = thing.stock ? measureFor(thing.stock, thing.data) : { unit: null };
  const piece = m.piece ?? valueOf(thing.fields, thing.data, "serving");
  const from = normalizeUnit(unit) ?? m.unit ?? (piece ? "stuk" : "g");
  const n = amount ?? 1;
  const target = { unit: "g", piece };
  if (!converts(from, target)) return null;
  // Een verpakking (zak, pot) met wat erin zit: eerst naar de eenheid van het ding.
  const inOwn = m.unit && from !== m.unit && m.pack && from === normalizeUnit(m.pack_name) ? convert(n, from, m) : null;
  return inOwn !== null ? convert(inOwn, m.unit, target) : convert(n, from, target);
}

const hasKcal = (fields: FieldDef[]) => fields.some((f) => f.product === "kcal" && f.type === "number");

/** Is dit eten? Een gebruik met een veld voor kcal, of dat iets gebruikte uit een lijst met kcal (geen pellets). */
export const isFood = (e: Pick<FoodEvent, "base" | "fields" | "lines">) =>
  e.base === "gebruik" && (hasKcal(e.fields) || e.lines.some((l) => l.role === "uit" && l.thing !== null && hasKcal(l.thing.fields)));

/** De voedingswaarden van één gebeurtenis, in totaal; null als ze niet als eten telt. */
export function nutritionOf(e: FoodEvent): Nutrition | null {
  if (e.base !== "gebruik" || e.status !== "gebeurd") return null;
  const out: Nutrition = {};
  let any = false;
  for (const key of NUTRIENTS) {
    const own = valueOf(e.fields, e.data, key);
    if (own !== null) {
      out[key] = own;
      any = true;
      continue;
    }
    let sum = 0;
    let found = false;
    for (const l of e.lines) {
      if (l.role !== "uit" || !l.thing) continue;
      const per100 = valueOf(l.thing.fields, l.thing.data, key);
      if (per100 === null) continue;
      const grams = gramsOf(l.amount, l.unit, l.thing);
      if (grams === null) continue;
      sum += (per100 * grams) / 100;
      found = true;
    }
    if (found) {
      out[key] = Math.round(sum * 10) / 10;
      any = true;
    }
  }
  return any ? out : null;
}

/** Wie at hoeveel van een gebeurtenis (aandeel 0–1 per persoon). */
export function eaters(e: Pick<FoodEvent, "split" | "created_by">): Map<string, number> {
  const shares = (e.split ?? []).filter((s) => s.share > 0);
  const sum = shares.reduce((s, x) => s + x.share, 0);
  if (!shares.length || !(sum > 0)) return new Map([[e.created_by, 1]]);
  return new Map(shares.map((s) => [s.person_id, s.share / sum]));
}

/** Per persoon de voedingswaarden van een reeks gebeurtenissen (afgerond op één cijfer na de komma). */
export function foodPerPerson(events: FoodEvent[]): Map<string, Nutrition> {
  const out = new Map<string, Nutrition>();
  for (const e of events) {
    const n = nutritionOf(e);
    if (!n) continue;
    for (const [person, part] of eaters(e)) {
      const t = out.get(person) ?? {};
      for (const key of NUTRIENTS) if (n[key] !== undefined) t[key] = Math.round(((t[key] ?? 0) + n[key]! * part) * 10) / 10;
      out.set(person, t);
    }
  }
  return out;
}
