// Toevoegen uit een andere lijst: dingen uit een bron (welke: voorwaarden zoals in een weergave) als dingen in deze
// lijst, met per veld wat erin komt (een veld van de bron, een vaste waarde of een verwijzing naar het origineel) en
// keuzes die anders heten vertaald (Rood → Drinken). Met Weghalen uit de bron verplaatst het ding zelf (foto, logboek en
// voorraad gaan mee); anders komt er een nieuw ding bij. Dezelfde logica in het voorbeeld (src/pages/FromListPage.tsx)
// en op de server (POST /lists/:id/things/from), die ze opnieuw uitrekent met wat de lezer ziet.

import { refLists, type Attributes, type FieldDef, type FieldValue } from "./fields.ts";
import { cleanView, matchesView, NAME, viewFields, type ViewContext, type ViewDef } from "./views.ts";

/** Waar een veld van deze lijst zijn waarde vandaan haalt. */
export type FieldSource =
  /** Een veld van de bron (`NAME`: de naam). */
  | { from: "field"; key: string }
  /** Voor elk ding dezelfde waarde (Eenheid = fles). */
  | { from: "value"; value: FieldValue }
  /** Een verwijzing naar het ding in de bron (enkel bij een verwijzing naar die lijst). */
  | { from: "self" };

export type TransferPlan = {
  source: string;
  where: ViewDef;
  /** Welk veld van de bron de naam wordt (`NAME`: de naam). */
  name: string;
  /** Per veld van deze lijst; wat er niet staat, blijft leeg. */
  fields: Record<string, FieldSource>;
  /** Per keuzeveld van deze lijst: een waarde van de bron → een keuze hier ("" = leeg laten). */
  translate: Record<string, Record<string, string>>;
  /** Weghalen uit de bron: het ding zelf verhuist. */
  move: boolean;
};

export type SourceThing = { id: string; name: string; data: Attributes; tag_ids: string[]; created_at?: string };
export type TransferRow = { source_id: string; name: string; data: Attributes };

export const MAX_TRANSFER = 2000;

const TEXT = new Set(["text", "longtext", "url", "email", "phone", "address", "code"]);
const CHOICE = new Set(["select", "multi"]);
/** Wat de app zelf invult of uitrekent, krijgt geen waarde uit een andere lijst. */
const COMPUTED = new Set(["calc", "timer"]);

const typeOf = (f: FieldDef) => (f.type === "calc" ? (f.result ?? "text") : f.type);

/** De velden van deze lijst die iets kunnen krijgen. */
export const fillable = (fields: FieldDef[]) => fields.filter((f) => !COMPUTED.has(f.type));

/** Kan een veld van de bron (of de naam) in dit veld? Hetzelfde type, tekst in tekst of een keuze, keuzes in keuzes. */
export function canCarry(target: FieldDef, source: FieldDef | null): boolean {
  if (COMPUTED.has(target.type)) return false;
  const s = source ? typeOf(source) : "text";
  const t = target.type;
  if (s === t) return true;
  if (TEXT.has(t)) return TEXT.has(s) || s === "select" || s === "number" || s === "year";
  if (t === "select") return TEXT.has(s) || s === "multi";
  if (t === "multi") return s === "select" || TEXT.has(s);
  return false;
}

/** Een verwijzing naar het origineel kan in een verwijzingsveld dat naar de bron wijst. */
export const canPointBack = (target: FieldDef, source: string) => (target.type === "item" || target.type === "items") && refLists(target).includes(source);

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

/** Een voorstel: hetzelfde veld (sleutel, anders naam) als het past, een verwijzing naar de bron wordt het origineel. */
export function guessPlan(source: { id: string; fields: FieldDef[] }, target: { fields: FieldDef[] }): TransferPlan {
  const fields: Record<string, FieldSource> = {};
  const used = new Set<string>();
  for (const t of fillable(target.fields)) {
    const pick =
      source.fields.find((s) => s.key === t.key && !used.has(s.key) && canCarry(t, s)) ??
      source.fields.find((s) => fold(s.label) === fold(t.label) && !used.has(s.key) && canCarry(t, s));
    if (pick) {
      used.add(pick.key);
      fields[t.key] = { from: "field", key: pick.key };
    } else if (canPointBack(t, source.id)) fields[t.key] = { from: "self" };
  }
  return { source: source.id, where: { match: "all", conditions: [] }, name: NAME, fields, translate: {}, move: false };
}

const asTexts = (v: FieldValue | undefined): string[] =>
  v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [String(v)];

/** Een waarde van de bron zoals ze in dit veld past; undefined = leeg laten. Keuzes gaan door de vertaling. */
export function carryValue(target: FieldDef, source: FieldDef | null, value: FieldValue | undefined, translate: Record<string, string> = {}): FieldValue | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!canCarry(target, source)) return undefined;
  const s = source ? typeOf(source) : "text";
  const pick = (x: string) => (Object.hasOwn(translate, x) ? translate[x] : x);
  const allowed = (x: string) => x !== "" && (!target.options?.length || target.options.includes(x));
  if (target.type === "select") {
    const choice = asTexts(value).map(pick).find(allowed);
    return choice;
  }
  if (target.type === "multi") {
    const choices = [...new Set(asTexts(value).map(pick).filter(allowed))];
    return choices.length ? choices : undefined;
  }
  if (TEXT.has(target.type) && s !== target.type) {
    const text = asTexts(value).join(", ");
    return text || undefined;
  }
  return value;
}

/** Welke dingen meegaan: die aan de voorwaarden voldoen. */
export function chosenThings<T extends SourceThing>(things: T[], plan: Pick<TransferPlan, "where">, sourceFields: FieldDef[], ctx: ViewContext, nameLabel = "Naam"): T[] {
  const vfields = viewFields(sourceFields, nameLabel);
  return things.filter((t) => matchesView(t, plan.where, vfields, ctx));
}

/** Wat er in deze lijst komt: per gekozen ding een naam en de waarden van de velden. */
export function transferRows(things: SourceThing[], plan: TransferPlan, sourceFields: FieldDef[], targetFields: FieldDef[], ctx: ViewContext): TransferRow[] {
  const bySource = new Map(sourceFields.map((f) => [f.key, f]));
  return chosenThings(things, plan, sourceFields, ctx).map((t) => {
    const named = plan.name === NAME ? t.name : asTexts(t.data[plan.name]).join(", ");
    const data: Attributes = {};
    for (const target of fillable(targetFields)) {
      const src = plan.fields[target.key];
      if (!src) continue;
      let v: FieldValue | undefined;
      if (src.from === "value") v = src.value;
      else if (src.from === "self") v = canPointBack(target, plan.source) ? (target.type === "items" ? [t.id] : t.id) : undefined;
      else {
        const def = src.key === NAME ? null : (bySource.get(src.key) ?? undefined);
        if (def === undefined) continue;
        v = carryValue(target, def, src.key === NAME ? t.name : t.data[src.key], plan.translate[target.key]);
      }
      if (v !== undefined && v !== null && v !== "") data[target.key] = v;
    }
    return { source_id: t.id, name: (named || t.name).slice(0, 200), data };
  });
}

/** De waarden van de bron die in een keuzeveld van deze lijst geen keuze zijn (om te vertalen), per veld. */
export function toTranslate(things: SourceThing[], plan: TransferPlan, sourceFields: FieldDef[], targetFields: FieldDef[], ctx: ViewContext): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const chosen = chosenThings(things, plan, sourceFields, ctx);
  for (const target of targetFields) {
    const src = plan.fields[target.key];
    if (!CHOICE.has(target.type) || !target.options?.length || src?.from !== "field") continue;
    const values = new Set<string>();
    for (const t of chosen) for (const v of asTexts(src.key === NAME ? t.name : t.data[src.key])) if (!target.options.includes(v)) values.add(v);
    if (values.size) out[target.key] = [...values].sort((a, b) => a.localeCompare(b, "nl")).slice(0, 50);
  }
  return out;
}

/** Een plan nakijken (op de server): bestaande velden, een geldige weergave; wat niet klopt, valt weg of geeft een fout. */
export function cleanPlan(raw: unknown, source: { id: string; fields: FieldDef[]; one: string | null }, targetFields: FieldDef[]): TransferPlan {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const where = cleanView(o.where ?? { match: "all", conditions: [] }, viewFields(source.fields, source.one ?? "Naam"));
  const sourceKeys = new Set([NAME, ...source.fields.map((f) => f.key)]);
  const name = typeof o.name === "string" && sourceKeys.has(o.name) ? o.name : NAME;
  const fields: Record<string, FieldSource> = {};
  const rawFields = o.fields && typeof o.fields === "object" ? (o.fields as Record<string, unknown>) : {};
  for (const target of fillable(targetFields)) {
    const s = rawFields[target.key];
    if (!s || typeof s !== "object") continue;
    const src = s as Record<string, unknown>;
    if (src.from === "field" && typeof src.key === "string" && sourceKeys.has(src.key)) fields[target.key] = { from: "field", key: src.key };
    else if (src.from === "self" && canPointBack(target, source.id)) fields[target.key] = { from: "self" };
    else if (src.from === "value" && src.value !== undefined && JSON.stringify(src.value).length <= 2000) fields[target.key] = { from: "value", value: src.value as FieldValue };
  }
  const translate: Record<string, Record<string, string>> = {};
  const rawTranslate = o.translate && typeof o.translate === "object" ? (o.translate as Record<string, unknown>) : {};
  for (const target of targetFields) {
    const t = rawTranslate[target.key];
    if (!CHOICE.has(target.type) || !t || typeof t !== "object") continue;
    const pairs = Object.entries(t as Record<string, unknown>)
      .filter((e): e is [string, string] => typeof e[1] === "string" && (e[1] === "" || !target.options?.length || target.options.includes(e[1])))
      .slice(0, 50);
    if (pairs.length) translate[target.key] = Object.fromEntries(pairs);
  }
  return { source: source.id, where, name, fields, translate, move: o.move === true };
}
