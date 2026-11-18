// Waar je iets kan toevoegen (de +, het palet, de snelkoppelingen): per formulier waarmee je mag loggen "Gegeten", en
// per lijst met items een nieuw item ("Wijn"). Wat je het meest gebruikt, eerst. Noemen de eerste woorden van je tekst er
// een ("gegeten pasta 300 g"), dan staat die bovenaan en gaat de rest als tekst naar het formulier. Bij een lijst of een
// item ervan (`logForms`): de formulieren die die lijst invullen.

import { STOCK } from "./cells.ts";
import { fillsLists, type KindInfo } from "./model.ts";

export type TargetList = { id: string; name: string; one: string | null; icon: string | null; color: string | null; stock: boolean };
/** `used`: per formulier (`list_id` null) of per lijst een nieuw item (`kind` "+item"), hoe vaak en het laatst. */
export type Targets = { lists: TargetList[]; kinds: KindInfo[]; used: { list_id: string | null; kind: string; n: number; last: string }[] };

export type Target = {
  key: string;
  /** Wat er staat: "Gegeten", "Loggen in Voorraad", "Wijn toevoegen". */
  label: string;
  /** Kort: het formulier ("Gegeten") of hoe één item heet ("Wijn"). */
  name: string;
  /** Waar (de lijst), als dat niet al in het label staat. */
  hint: string | null;
  icon: string;
  /** Bij een nieuw item: de lijst. */
  list_id: string | null;
  /** Een formulier (loggen) of een item toevoegen. */
  kind: string | null;
  item: boolean;
  /** Waarop je kan zoeken (kleine letters, zonder accenten). */
  words: string[];
  used: number;
  last: string;
  /** Met een prijs in je tekst eerst: een aankoop of een lijst die voorraad telt. */
  buys: boolean;
};

export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

/** Alle plekken om iets toe te voegen, je meestgebruikte eerst. */
export function buildTargets(t: Targets): Target[] {
  const count = (list: string | null, kind: string) => t.used.find((u) => u.list_id === list && u.kind === kind) ?? { n: 0, last: "" };
  const out: Target[] = [];
  for (const l of t.lists) {
    if (!l.one) continue;
    const c = count(l.id, "+item");
    out.push({ key: `item:${l.id}`, label: `${l.one} toevoegen`, name: l.one, hint: l.name, icon: l.icon ?? "folder", list_id: l.id, kind: null, item: true, words: [fold(l.one), fold(l.name)], used: c.n, last: c.last, buys: false });
  }
  const names = new Map(t.lists.map((l) => [l.id, l.name]));
  for (const k of t.kinds) {
    const c = count(null, k.id);
    // Waar het formulier iets invult, als het dat uitdrukkelijk zegt (Ruimte uit Huis).
    const hint = fillsLists(k).map((id) => names.get(id)).filter(Boolean).join(", ") || null;
    out.push({ key: `soort:${k.id}`, label: k.name, name: k.name, hint, icon: k.icon, list_id: null, kind: k.id, item: false, words: [fold(k.name)], used: c.n, last: c.last, buys: buysWith(k) });
  }
  return out.sort((a, b) => b.used - a.used || b.last.localeCompare(a.last) || a.label.localeCompare(b.label, "nl"));
}

const PRICE = /(€\s*\d+([.,]\d{1,2})?|\d+([.,]\d{1,2})?\s*(€|euro|eur)\b|\d+,\d{2}\b)/i;

/** Staat er een bedrag in de tekst ("6 euro", "€ 4,99", "12,50")? */
export const hasPrice = (text: string) => PRICE.test(text);

/** De tekst zonder bedrag, als naam voor iets nieuws ("chablis 54 euro" is "chablis"). */
export const withoutPrice = (text: string) => text.replace(new RegExp(PRICE.source, "gi"), " ").replace(/\s+/g, " ").trim();

export type Match = { target: Target; rest: string; strong: boolean };

/**
 * De plekken die bij je tekst passen. Noemen de eerste woorden een plek ("gegeten", "wijn", "voorraad"), dan staat die
 * bovenaan (`strong`) en is de rest de tekst voor het formulier; anders alle plekken met de hele tekst, met een prijs
 * de aankopen eerst.
 */
export function matchTargets(text: string, targets: Target[]): Match[] {
  const f = fold(text);
  if (!f) return targets.map((target) => ({ target, rest: "", strong: false }));
  const strong: Match[] = [];
  for (const target of targets) {
    for (const w of target.words) {
      if (f === w || f.startsWith(`${w} `)) {
        strong.push({ target, rest: text.trim().slice(w.length).trim(), strong: true });
        break;
      }
    }
  }
  if (strong.length) return [...strong, ...targets.filter((t) => !strong.some((s) => s.target === t)).map((target) => ({ target, rest: text.trim(), strong: false }))];
  const priced = hasPrice(text);
  const ordered = priced ? [...targets.filter((t) => t.buys), ...targets.filter((t) => !t.buys)] : targets;
  // Woorden die in een naam voorkomen ("pellets" in Pellets) eerst.
  const words = f.split(/\s+/).filter((w) => w.length > 2);
  const named = ordered.filter((t) => t.words.some((w) => words.some((x) => w.includes(x))));
  const rest = ordered.filter((t) => !named.includes(t));
  return [...named, ...rest].map((target) => ({ target, rest: text.trim(), strong: false }));
}

/** Het pad van een plek, met de tekst die je typte. */
export function targetPath(t: Target, rest = ""): string {
  const q = new URLSearchParams();
  if (t.kind) q.set("formulier", t.kind);
  if (rest) q.set("tekst", rest);
  const query = q.toString();
  return t.item ? `/lijsten/${t.list_id}/nieuw${query ? `?${query}` : ""}` : `/loggen${query ? `?${query}` : ""}`;
}

/** Een formulier om mee te loggen bij een lijst of een item ervan. */
export type LogForm = {
  /** Dezelfde sleutel als de plek in `buildTargets` ("soort:…"). */
  key: string;
  kind: KindInfo;
  label: string;
  icon: string;
};

/** Is dit een formulier voor een kasticket: met geld, en wat erop staat telt bij in een voorraad? */
export const buysWith = (k: Pick<KindInfo, "parts" | "does">) =>
  k.parts.money && !k.parts.to && k.does.some((h) => h.rows.from === "lines" && h.field === STOCK && h.op === "bij");

/** Verandert een formulier de voorraad (zijn lijnen tellen bij of af)? */
export const movesStock = (k: Pick<KindInfo, "does">) => k.does.some((h) => h.rows.from === "lines" && h.field === STOCK && (h.op === "bij" || h.op === "af"));

/** Vult dit formulier de lijst in: uitdrukkelijk (een groep of handeling uit die lijst), of telt het in haar voorraad? */
export const fillsList = (k: Pick<KindInfo, "parts" | "does">, list: Pick<TargetList, "id" | "stock">) =>
  fillsLists(k).includes(list.id) || (list.stock && movesStock(k) && k.parts.groups.some((g) => !g.list && k.does.some((h) => h.rows.from === "lines" && h.rows.role === g.role && h.field === STOCK && !h.list)));

/**
 * Waarmee je logt bij een lijst of een item ervan: de formulieren die die lijst uitdrukkelijk invullen (Schilderwerk bij
 * Huis) eerst, en telt ze voorraad, dan die haar voorraad veranderen (Aankoop, Gegeten). `shown` laat weg wat je bij de
 * + verborg. Daarbinnen wat je het meest gebruikt, eerst.
 */
export function logForms(t: Targets, listId: string, shown: (id: string) => boolean = () => true): LogForm[] {
  const list = t.lists.find((l) => l.id === listId);
  if (!list) return [];
  const used = (k: KindInfo) => t.used.find((u) => u.list_id === null && u.kind === k.id);
  const own = (k: KindInfo) => (fillsLists(k).includes(listId) ? 0 : 1);
  const byUse = (a: KindInfo, b: KindInfo) =>
    own(a) - own(b) || (used(b)?.n ?? 0) - (used(a)?.n ?? 0) || (used(b)?.last ?? "").localeCompare(used(a)?.last ?? "") || a.name.localeCompare(b.name, "nl");
  return t.kinds
    .filter((k) => fillsList(k, list) && shown(k.id))
    .sort(byUse)
    .map((k) => ({ key: `soort:${k.id}`, kind: k, label: k.name, icon: k.icon }));
}

/** Met een bedrag in je tekst eerst de formulieren met geld die iets laten gebeuren (een aankoop, geen boodschap). */
export function pricedFirst(forms: LogForm[], text: string): LogForm[] {
  if (!hasPrice(text)) return forms;
  const money = (f: LogForm) => f.kind.parts.money && !f.kind.parts.to && !f.kind.planned;
  return [...forms.filter(money), ...forms.filter((f) => !money(f))];
}

/**
 * Het pad om met een formulier te loggen, eventueel met een item als eerste lijn en je tekst. `newIn`: de lijst waar je
 * vandaan komt; een nieuw item in een lijn (een wijn die er nog niet staat) komt daar dan vanzelf in (`?nieuw=`).
 */
export function logPath(form: { id: string }, item?: string, text = "", newIn?: string): string {
  const q = new URLSearchParams();
  q.set("formulier", form.id);
  if (item) q.set("item", item);
  if (text) q.set("tekst", text);
  if (newIn) q.set("nieuw", newIn);
  return `/loggen?${q.toString()}`;
}

/**
 * Wat er van je tekst overblijft naast de naam van een item: "chablis 54 euro" bij Chablis is "54 euro". Ook een begin
 * van een woord telt ("foru" bij Het Forum); getallen blijven altijd.
 */
export function restAfter(text: string, name: string): string {
  const words = fold(name).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => {
      const f = fold(w);
      return !(f.length >= 2 && /\p{L}/u.test(f) && words.some((n) => n.startsWith(f)));
    })
    .join(" ");
}

/** Waarmee een kasticket kan: de formulieren die kopen (`buysWith`) en niet gepland beginnen, je meestgebruikte eerst. */
export function receiptForms(t: Targets): KindInfo[] {
  const used = (k: KindInfo) => t.used.find((u) => u.list_id === null && u.kind === k.id)?.n ?? 0;
  return t.kinds.filter((k) => buysWith(k) && !k.planned).sort((a, b) => used(b) - used(a) || a.name.localeCompare(b.name, "nl"));
}
