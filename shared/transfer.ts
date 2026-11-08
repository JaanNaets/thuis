// Toevoegen uit een andere lijst: dingen uit een bron (welke: voorwaarden zoals in een weergave) als dingen in deze
// lijst, met per veld wat erin komt (een veld van de bron, een vaste waarde of een verwijzing naar het origineel) en
// keuzes die anders heten vertaald (Rood → Drinken). Drie manieren (`TRANSFER_MODES`): kopiëren (nieuwe dingen),
// verplaatsen (het ding zelf verhuist, met foto, logboek en voorraad) of koppelen (blijvend: `syncChanges` houdt de
// doellijst bij, de gekoppelde velden volgen de bron). Dezelfde logica in het voorbeeld (src/pages/FromListPage.tsx) en
// op de server (POST /lists/:id/things/from, PUT /lists/:id/mirrors/:bron, worker/mirrors.ts), met wat de lezer ziet.

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

/** Kopiëren laat de bron staan, verplaatsen haalt het ding eruit, koppelen blijft meelopen. */
export const TRANSFER_MODES = { copy: "Kopiëren", move: "Verplaatsen", link: "Koppelen" } as const;
export type TransferMode = keyof typeof TRANSFER_MODES;

export type TransferPlan = {
  source: string;
  where: ViewDef;
  /** Welk veld van de bron de naam wordt (`NAME`: de naam). */
  name: string;
  /** Per veld van deze lijst; wat er niet staat, blijft leeg. */
  fields: Record<string, FieldSource>;
  /** Per keuzeveld van deze lijst: een waarde van de bron → een keuze hier ("" = leeg laten). */
  translate: Record<string, Record<string, string>>;
  mode: TransferMode;
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
  return { source: source.id, where: { match: "all", conditions: [] }, name: NAME, fields, translate: {}, mode: "copy" };
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
  // `move` is hoe een plan vroeger verplaatsen zei (nog zo bewaard in een toestel).
  const mode: TransferMode = typeof o.mode === "string" && Object.hasOwn(TRANSFER_MODES, o.mode) ? (o.mode as TransferMode) : o.move === true ? "move" : "copy";
  return { source: source.id, where, name, fields, translate, mode };
}

// ---------- koppelen ----------

/** De velden die een koppeling bijhoudt (in de doellijst niet te wijzigen): wat uit de bron komt. Een vaste waarde is een begin. */
export function linkedKeys(plan: Pick<TransferPlan, "fields">): string[] {
  return Object.entries(plan.fields)
    .filter(([, s]) => s.from !== "value")
    .map(([k]) => k);
}

/** Een ding in de doellijst van een koppeling, met het ding in de bron waar het bij hoort. */
export type MirrorThing = { id: string; mirror_of: string | null; name: string; data: Attributes; archived: 0 | 1 };
export type MirrorChanges = {
  /** Nieuw in de doellijst (met de vaste waarden). */
  create: TransferRow[];
  /** De naam en de gekoppelde velden volgen de bron; `restore`: was gearchiveerd en voldoet weer. */
  update: { id: string; name: string; data: Attributes; restore: boolean }[];
  /** Voldoet niet meer of is weg uit de bron: gearchiveerd, met zijn logboek. */
  archive: string[];
};

const sameData = (a: Attributes, b: Attributes) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
};

/**
 * Een koppeling bijwerken: wat aan de voorwaarden voldoet, staat in de doellijst (nieuw met de vaste waarden; al
 * gekoppeld: de naam en de gekoppelde velden volgen de bron, de eigen velden blijven); wat niet meer voldoet of uit de
 * bron weg is, wordt gearchiveerd en komt terug als het weer voldoet. Enkel wat echt verandert.
 */
export function syncChanges(things: SourceThing[], plan: TransferPlan, sourceFields: FieldDef[], targetFields: FieldDef[], existing: MirrorThing[], ctx: ViewContext): MirrorChanges {
  const rows = transferRows(things, plan, sourceFields, targetFields, ctx);
  const linked = linkedKeys(plan);
  const bySource = new Map(existing.filter((e) => e.mirror_of).map((e) => [e.mirror_of!, e]));
  const kept = new Set<string>();
  const create: TransferRow[] = [];
  const update: MirrorChanges["update"] = [];
  for (const r of rows) {
    const had = bySource.get(r.source_id);
    if (!had) {
      create.push(r);
      continue;
    }
    kept.add(had.id);
    const data: Attributes = { ...had.data };
    for (const k of linked) {
      if (r.data[k] === undefined) delete data[k];
      else data[k] = r.data[k];
    }
    const restore = had.archived === 1;
    if (restore || had.name !== r.name || !sameData(data, had.data)) update.push({ id: had.id, name: r.name, data, restore });
  }
  const archive = existing.filter((e) => !kept.has(e.id) && e.archived === 0).map((e) => e.id);
  return { create, update, archive };
}

/** Zou deze koppeling een kring maken (de bron haalt, rechtstreeks of via andere, al uit de doellijst)? */
export function makesCycle(links: { list: string; source: string }[], target: string, source: string): boolean {
  if (target === source) return true;
  // Van de bron terug langs de bronnen: komen we bij de doellijst, dan is het een kring.
  const sourcesOf = new Map<string, string[]>();
  for (const l of links) sourcesOf.set(l.list, [...(sourcesOf.get(l.list) ?? []), l.source]);
  const seen = new Set<string>();
  const todo = [source];
  while (todo.length) {
    const at = todo.pop()!;
    if (at === target) return true;
    if (seen.has(at)) continue;
    seen.add(at);
    todo.push(...(sourcesOf.get(at) ?? []));
  }
  return false;
}
