// Eten: kcal en voedingswaarden per persoon, uitgerekend uit wat er gegeten werd (nooit bewaard).
//
// Een formulier dat eet (`formEats`: zonder geld, en het trekt iets af van de voorraad of heeft kcal, zoals Gegeten)
// telt als eten als het voedingswaarden heeft: rechtstreeks in een veld van het formulier met productinfo (een broodje
// van 450 kcal), of uit de items die eraf gingen (300 g pasta × de kcal per 100 g van de pasta). Wat je zelf invult,
// wint. Wie at, staat in de verdeling (`split`); zonder verdeling at wie het logde.

import { stockOp, STOCK } from "./cells.ts";
import type { Attributes, FieldDef, Share } from "./fields.ts";
import type { KindInfo, LineRole, Status } from "./model.ts";
import type { ProductKey } from "./product.ts";
import { measureFor, type StockDef } from "./stock.ts";
import { convert, converts, normalizeUnit } from "./units.ts";

/** De voedingswaarden die de app optelt (per 100 g op een item, in totaal op een gebeurtenis). */
export const NUTRIENTS = ["kcal", "protein", "carbs", "fat", "sugars", "fiber", "salt"] as const satisfies readonly ProductKey[];
export type Nutrient = (typeof NUTRIENTS)[number];
export type Nutrition = Partial<Record<Nutrient, number>>;

export type FoodItem = { fields: FieldDef[]; data: Attributes; stock: StockDef | null };
export type FoodEvent = {
  /** Het formulier eet (`formEats`). */
  eats: boolean;
  status: Status;
  split: Share[] | null;
  created_by: string;
  /** De velden van het formulier en hun waarden. */
  fields: FieldDef[];
  data: Attributes;
  /** De lijnen die eraf gaan (wat gegeten werd). */
  lines: { amount: number | null; unit: string | null; item: FoodItem | null }[];
};

const valueOf = (fields: FieldDef[], data: Attributes, key: ProductKey): number | null => {
  const f = fields.find((x) => x.product === key && x.type === "number");
  const v = f ? data[f.key] : undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/** Hoeveel gram een lijn is: omgerekend met de eenheid en de inhoud per stuk (of de portie) van het item. */
export function gramsOf(amount: number | null, unit: string | null, item: FoodItem): number | null {
  const m = item.stock ? measureFor(item.stock, item.data) : { unit: null };
  const piece = m.piece ?? valueOf(item.fields, item.data, "serving");
  const from = normalizeUnit(unit) ?? m.unit ?? (piece ? "stuk" : "g");
  const n = amount ?? 1;
  const target = { unit: "g", piece };
  if (!converts(from, target)) return null;
  // Een verpakking (zak, pot) met wat erin zit: eerst naar de eenheid van het item.
  const inOwn = m.unit && from !== m.unit && m.pack && from === normalizeUnit(m.pack_name) ? convert(n, from, m) : null;
  return inOwn !== null ? convert(inOwn, m.unit, target) : convert(n, from, target);
}

/** Een lijst of soort met kcal (een getal met productinfo kcal). */
export const hasKcal = (fields: FieldDef[]) => fields.some((f) => f.product === "kcal" && f.type === "number");

/** Eet dit formulier? Zonder geld, en het trekt iets af van de voorraad of heeft een veld voor kcal (Gegeten). */
export const formEats = (kind: Pick<KindInfo, "parts" | "does" | "fields">) =>
  !kind.parts.money && (hasKcal(kind.fields) || kind.does.some((h) => h.rows.from === "lines" && h.field === STOCK && h.op === "af"));

/** De rollen van de lijnen die eraf gaan (wat gegeten werd). */
export const eatenRoles = (kind: Pick<KindInfo, "does">): LineRole[] => (["in", "uit", "voor", "bij"] as const).filter((r) => stockOp(kind.does, r) === "af");

/** Is dit eten? Een formulier dat eet, met een veld voor kcal of dat iets gebruikte uit een lijst met kcal (geen pellets). */
export const isFood = (e: Pick<FoodEvent, "eats" | "fields" | "lines">) => e.eats && (hasKcal(e.fields) || e.lines.some((l) => l.item !== null && hasKcal(l.item.fields)));

/** De voedingswaarden van één gebeurtenis, in totaal; null als ze niet als eten telt. */
export function nutritionOf(e: FoodEvent): Nutrition | null {
  if (!e.eats || e.status !== "gebeurd") return null;
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
      if (!l.item) continue;
      const per100 = valueOf(l.item.fields, l.item.data, key);
      if (per100 === null) continue;
      const grams = gramsOf(l.amount, l.unit, l.item);
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
