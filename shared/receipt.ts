// Een kasticket per lijn (Uitgaven als één item per gekocht product): wat de velden van de lijst doen, volgt uit de
// velden zelf, nooit uit hun naam:
//
// - het **bedrag** is het eerste geldveld (de prijs van de lijn);
// - het **product** is de eerste verwijzing die telt (`adjust`: kopen telt bij de voorraad), met `adjust.by` als
//   hoeveel en `adjust.unit_by` als eenheid;
// - het **kasticket** is een verwijzing naar een lijst met een datum die deze lijnen optelt (een berekening die de
//   items telt of optelt die via dat veld naar haar verwijzen, Totaal bij Kastickets; Winkels telt ook op, maar heeft
//   geen datum): zo'n item wordt het ticket zelf, met de foto;
// - de **winkel** is de eerste andere verwijzing;
// - **Gegeten** is een ja/nee met Meteen ook (`spawn`), **Van mij** het veld met een verdeling.
//
// Al de rest (datum, betaald door, categorie, winkel, verdeling) staat één keer bovenaan: "voor alle lijnen".

import type { Attributes, FieldDef } from "./fields.ts";
import { matchName, refLists } from "./fields.ts";
import { normalizeUnit, parseSize, round3 } from "./units.ts";

export type ReceiptPlan = {
  price: string;
  product: { key: string; lists: string[] };
  amount?: string;
  unit?: string;
  receipt?: { key: string; list: string };
  store?: { key: string; lists: string[]; free: boolean };
  date?: string;
  share?: string;
  eaten?: string;
};

/**
 * Wat de velden van een lijst doen bij een kasticket per lijn. `listFields`: de velden van een andere lijst (om het
 * kasticket te vinden); `self`: de id van deze lijst. Null als de lijst geen bedrag of geen product heeft.
 */
export function receiptPlan(fields: FieldDef[], self: string, listFields: (id: string) => FieldDef[] | undefined): ReceiptPlan | null {
  const price = fields.find((f) => f.type === "money");
  const product = fields.find((f) => f.type === "item" && f.adjust && refLists(f).length);
  if (!price || !product) return null;
  const collects = (f: FieldDef) => {
    const other = f.ref_type ? (listFields(f.ref_type) ?? []) : [];
    return (
      other.some((x) => x.type === "date") &&
      other.some((x) => x.type === "calc" && x.calc?.kind === "rollup" && x.calc.from === "backlinks" && x.calc.list === self && x.calc.via === f.key)
    );
  };
  const receipt = fields.find((f) => f.type === "item" && f !== product && collects(f));
  const store = fields.find((f) => f.type === "item" && f !== product && f !== receipt && refLists(f).length);
  const amount = product.adjust?.by && fields.some((f) => f.key === product.adjust?.by && f.type === "number") ? product.adjust.by : undefined;
  const unit = product.adjust?.unit_by && fields.some((f) => f.key === product.adjust?.unit_by && (f.type === "select" || f.type === "text")) ? product.adjust.unit_by : undefined;
  return {
    price: price.key,
    product: { key: product.key, lists: refLists(product) },
    ...(amount ? { amount } : {}),
    ...(unit ? { unit } : {}),
    ...(receipt?.ref_type ? { receipt: { key: receipt.key, list: receipt.ref_type } } : {}),
    ...(store ? { store: { key: store.key, lists: refLists(store), free: Boolean(store.free) } } : {}),
    ...(fields.find((f) => f.type === "date") ? { date: fields.find((f) => f.type === "date")!.key } : {}),
    ...(fields.find((f) => f.type === "share") ? { share: fields.find((f) => f.type === "share")!.key } : {}),
    ...(fields.find((f) => f.type === "bool" && f.spawn?.length) ? { eaten: fields.find((f) => f.type === "bool" && f.spawn?.length)!.key } : {}),
  };
}

/** De velden die per lijn verschillen (de rest staat één keer bovenaan). */
export const lineKeys = (plan: ReceiptPlan) => [plan.price, plan.product.key, plan.amount, plan.unit, plan.receipt?.key, plan.eaten].filter((k): k is string => Boolean(k));

/** De velden "voor alle lijnen": wat je invult, behalve wat per lijn verschilt, lange teksten en bestanden. */
export const commonFields = (fields: FieldDef[], plan: ReceiptPlan) =>
  fields.filter((f) => !lineKeys(plan).includes(f.key) && f.type !== "calc" && f.type !== "longtext" && f.type !== "checklist" && f.type !== "timer");

/** Een lijn zoals de AI ze las: de naam, hoeveel stuks, de maat ("500 g") en de prijs van de hele lijn in cent. */
export type RawLine = { name: string; quantity: number; size: string | null; price: number | null };

/**
 * Hoeveel en de eenheid van een lijn, zoals op het ticket: "AARDAPPELEN 5KG" = 5 kg, "2 × MELK 1L" = 2 l, zonder maat
 * stuks. Kan de eenheid enkel uit keuzes komen (`options`), dan omgerekend naar een keuze van dezelfde soort (33 cl →
 * 330 ml); anders stuks.
 */
export function lineAmount(line: Pick<RawLine, "name" | "quantity" | "size">, options?: string[]): { amount: number; unit: string } {
  const size = (line.size ? parseSize(line.size) : null) ?? parseSize(line.name);
  const quantity = line.quantity > 0 ? line.quantity : 1;
  if (!size) return { amount: quantity, unit: "stuk" };
  const amount = round3(quantity * size.count * size.amount);
  if (!options?.length || options.includes(size.unit)) return { amount, unit: size.unit };
  // Een keuze van dezelfde soort (gewicht of inhoud): de grootste waarin het minstens 1 is (198 cl = 1,98 l), anders
  // de kleinste (33 cl = 330 ml).
  const kind = WEIGHT[size.unit] ? WEIGHT : VOLUME[size.unit] ? VOLUME : null;
  const same = options.filter((o) => kind?.[normalizeUnit(o) ?? ""]).sort((a, b) => kind![normalizeUnit(b)!] - kind![normalizeUnit(a)!]);
  const fits = same.find((o) => (amount * kind![size.unit]) / kind![normalizeUnit(o)!] >= 1) ?? same[same.length - 1];
  if (fits) return { amount: round3((amount * kind![size.unit]) / kind![normalizeUnit(fits)!]), unit: fits };
  return { amount: quantity, unit: "stuk" };
}

const WEIGHT: Record<string, number> = { mg: 0.001, g: 1, kg: 1000 };
const VOLUME: Record<string, number> = { ml: 1, cl: 10, dl: 100, l: 1000 };

/** Een lijn zoals ze in het nakijken staat. */
export type ReviewLine = {
  on: boolean;
  name: string;
  /** Het gekozen product (een item), of null: dan een nieuw product in `newIn`, of de naam als vrije tekst. */
  product: { id: string; name: string } | null;
  /** Zonder product: de lijst waarin het een nieuw product wordt (null = enkel tekst). */
  newIn: string | null;
  amount: number | null;
  unit: string | null;
  /** In cent. */
  price: number | null;
  eaten: boolean;
  mine: boolean;
};

/**
 * De waarden van een lijn om te bewaren: wat voor alle lijnen geldt, en wat bij deze lijn hoort. "Van mij" maakt de
 * verdeling enkel jij. Een lijn zonder product: de naam als vrije tekst als het veld dat toelaat (een nieuw product
 * vult de server in, zie `newProductData`).
 */
export function lineData(plan: ReceiptPlan, fields: FieldDef[], common: Attributes, line: ReviewLine, me: string): Attributes {
  const product = fields.find((f) => f.key === plan.product.key);
  const data: Attributes = { ...common };
  for (const k of lineKeys(plan)) delete data[k];
  if (line.price !== null) data[plan.price] = line.price;
  if (line.product) data[plan.product.key] = line.product.id;
  else if (!line.newIn && product?.free && line.name.trim()) data[plan.product.key] = { text: line.name.trim() };
  if (plan.amount && line.amount !== null) data[plan.amount] = line.amount;
  if (plan.unit && line.unit) data[plan.unit] = line.unit;
  if (plan.eaten) data[plan.eaten] = line.eaten;
  if (plan.share && line.mine) data[plan.share] = [{ person_id: me, share: 1 }];
  return data;
}

/**
 * Wat een nieuw product van een lijn krijgt: de eenheid van het ticket in het veld dat zegt waarin het getal telt
 * (`measure.unit` op een getal, bv. Eenheid in Voorraad), als dat veld die eenheid kent. Het aantal zelf begint leeg:
 * de aankoop telt het erbij, zoals bij elk product.
 */
export function newProductData(fields: FieldDef[], line: Pick<ReviewLine, "unit">): Attributes {
  const key = fields.find((f) => f.type === "number" && f.measure?.unit)?.measure?.unit;
  const unit = key ? fields.find((f) => f.key === key) : undefined;
  if (!unit || !line.unit) return {};
  if (unit.type === "select") return unit.options?.includes(line.unit) ? { [unit.key]: line.unit } : {};
  return unit.type === "text" ? { [unit.key]: line.unit } : {};
}

/** Wat het kasticket zelf krijgt: de velden met dezelfde sleutel en soort als "voor alle lijnen" (datum, winkel). */
export function receiptData(receiptFields: FieldDef[], lineFields: FieldDef[], common: Attributes): Attributes {
  const data: Attributes = {};
  for (const f of receiptFields) {
    const same = lineFields.find((x) => x.key === f.key && x.type === f.type && f.type !== "calc");
    if (same && common[f.key] !== undefined && common[f.key] !== null) data[f.key] = common[f.key];
  }
  return data;
}

/**
 * Een naam zoals op het ticket, leesbaar en zonder de maat (die staat al in hoeveel): "AARDAPPELEN 5KG" →
 * "Aardappelen", "COLA 6X33CL" → "Cola"; gewone tekst blijft zoals ze is (behalve de maat).
 */
export function niceName(text: string): string {
  const t = text
    .trim()
    .replace(/\s*\b\d+(?:[.,]\d+)?\s*(?:[x×*]\s*\d+(?:[.,]\d+)?\s*)?(?:kg|gr|g|mg|ml|cl|dl|lt|l|liter|kilo)\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim() || text.trim();
  if (!/[A-Z]/.test(t) || t !== t.toUpperCase()) return t;
  const lower = t.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** De som van de lijnen die aan staan, in cent. */
export const linesTotal = (lines: ReviewLine[]) => lines.reduce((s, l) => s + (l.on && l.price ? l.price : 0), 0);

/** Zoveel lijnen hoogstens van één ticket. */
export const MAX_LINES = 80;

/** Een item om een lijn aan te koppelen: op zijn naam, of op een naam zoals hij vroeger op een ticket stond (`own` = nee). */
export type Candidate = { id: string; name: string; item: string; own: boolean };

/** Een gelezen lijn: hoeveel, de eenheid, de prijs in cent en het product (als gekend). */
export type ReadLine = { name: string; quantity: number; amount: number; unit: string; price: number | null; product: { id: string; name: string } | null };

/**
 * Wat de AI las, als lijnen: elke lijn met een naam, hoeveel en de eenheid zoals op het ticket (`lineAmount`), de prijs
 * in cent en het product dat bij de naam past (`matchName`, ook op een vroegere naam op een ticket).
 */
export function readLines(raw: unknown, products: Candidate[], options?: string[]): ReadLine[] {
  const lines: ReadLine[] = [];
  for (const r of Array.isArray(raw) ? raw.slice(0, MAX_LINES) : []) {
    const l = (r ?? {}) as { name?: unknown; quantity?: unknown; size?: unknown; price?: unknown };
    const name = typeof l.name === "string" ? l.name.trim().slice(0, 120) : "";
    if (!name) continue;
    const quantity = typeof l.quantity === "number" && l.quantity > 0 ? Math.min(99, Math.round(l.quantity)) || 1 : 1;
    const { amount, unit } = lineAmount({ name, quantity, size: typeof l.size === "string" ? l.size : null }, options);
    const id = matchName(products, name);
    const product = id ? (products.find((p) => p.id === id && p.own) ?? products.find((p) => p.id === id)!) : null;
    lines.push({ name, quantity, amount, unit, price: cents(l.price), product: product ? { id: product.id, name: product.item } : null });
  }
  return lines;
}

/** Euro (zoals de AI het geeft) naar cent; niets of iets vreemds = null. */
export function cents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100_000) return null;
  return Math.round(value * 100);
}

/** Een echte datum (JJJJ-MM-DD), niet na `today`; anders null. */
export function validDate(value: unknown, today: string): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  return value <= today ? value : null;
}
