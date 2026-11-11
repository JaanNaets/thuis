// Waar je iets kan toevoegen (de +, het palet, de snelkoppelingen): per eigen formulier "Gegeten" (in haar lijst), per
// lijst zonder eigen formulieren "Loggen in Voorraad" (met de basissoorten) en per lijst met dingen een nieuw ding
// ("Wijn"). Wat je het meest gebruikt, eerst. Noemen de eerste woorden van je tekst er een ("gegeten pasta 300 g"), dan
// staat die bovenaan en gaat de rest als tekst naar het formulier. Bij een ding (`logForms`): waarmee je ermee logt.

import { BASES, type KindInfo } from "./model.ts";

export type TargetList = { id: string; name: string; one: string | null; icon: string | null; color: string | null; stock: boolean };
export type Targets = { lists: TargetList[]; kinds: KindInfo[]; used: { list_id: string; kind: string; n: number; last: string }[] };

export type Target = {
  key: string;
  /** Wat er staat: "Gegeten", "Loggen in Voorraad", "Wijn toevoegen". */
  label: string;
  /** Kort: het formulier ("Gegeten") of hoe één ding heet ("Wijn"). */
  name: string;
  /** Waar (de lijst), als dat niet al in het label staat. */
  hint: string | null;
  icon: string;
  list_id: string;
  /** Een soort (loggen) of een ding toevoegen. */
  kind: string | null;
  thing: boolean;
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
  const used = new Map(t.used.map((u) => [`${u.list_id}|${u.kind}`, u]));
  const count = (list: string, kind: string) => used.get(`${list}|${kind}`) ?? { n: 0, last: "" };
  const out: Target[] = [];
  const owns = new Set(t.kinds.map((k) => k.list_id));
  for (const l of t.lists) {
    const logs = t.used.filter((u) => u.list_id === l.id && u.kind !== "+ding");
    // Met eigen formulieren staan die er zelf; "Loggen in" zou hetzelfde formulier nog eens openen.
    if (!owns.has(l.id)) {
      out.push({
        key: `log:${l.id}`,
        label: `Loggen in ${l.name}`,
        name: "Loggen",
        hint: null,
        icon: l.icon ?? "note",
        list_id: l.id,
        kind: null,
        thing: false,
        words: [fold(l.name)],
        used: logs.reduce((s, u) => s + u.n, 0),
        last: logs.reduce((s, u) => (u.last > s ? u.last : s), ""),
        buys: l.stock,
      });
    }
    if (l.one) {
      const c = count(l.id, "+ding");
      out.push({ key: `ding:${l.id}`, label: `${l.one} toevoegen`, name: l.one, hint: l.name, icon: l.icon ?? "folder", list_id: l.id, kind: null, thing: true, words: [fold(l.one), fold(l.name)], used: c.n, last: c.last, buys: false });
    }
  }
  const editable = new Set(t.lists.map((l) => l.id));
  for (const k of t.kinds) {
    if (!k.list_id || !editable.has(k.list_id)) continue;
    const list = t.lists.find((l) => l.id === k.list_id)!;
    const c = count(k.list_id, k.id);
    out.push({ key: `soort:${k.id}`, label: k.name, name: k.name, hint: list.name, icon: k.icon, list_id: k.list_id, kind: k.id, thing: false, words: [fold(k.name)], used: c.n, last: c.last, buys: k.base === "aankoop" });
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
  if (t.kind) q.set("soort", t.kind);
  if (rest) q.set("tekst", rest);
  const query = q.toString();
  return `/lijsten/${t.list_id}/${t.thing ? "nieuw" : "loggen"}${query ? `?${query}` : ""}`;
}

/** Een formulier om mee te loggen bij een lijst of een ding ervan; `kind` null = Loggen (kiezen uit de basissoorten). */
export type LogForm = {
  /** Dezelfde sleutel als de plek in `buildTargets` ("soort:…", "log:…"). */
  key: string;
  kind: KindInfo | null;
  /** Waar de gebeurtenis komt (bij een aankoop in Uitgaven: Uitgaven, niet de lijst van de wijn). */
  list_id: string;
  /** De naam van het formulier, met de lijst erbij als twee formulieren hetzelfde heten. */
  label: string;
  icon: string;
  /** De lijst waar de gebeurtenis komt, als dat een andere lijst is. */
  hint: string | null;
};

/** Verandert een formulier de voorraad (er komt iets bij of gaat iets af)? */
export const movesStock = (k: Pick<KindInfo, "base">) => BASES[k.base].line === "in" || BASES[k.base].line === "uit";

/**
 * Waarmee je logt bij een lijst of een ding ervan: haar eigen formulieren (zonder: Loggen, met de basissoorten) en, telt
 * ze voorraad, de formulieren van lijsten zonder dingen die de voorraad veranderen: Aankoop in Uitgaven, Boodschap,
 * Gegeten. Daar komt de gebeurtenis in die andere lijst, met het ding als lijn. Een lijst met eigen dingen (een gedeelde
 * wijnkelder) logt enkel over haar eigen dingen. Enkel lijsten waar je mag loggen; `shown` laat weg wat je bij de +
 * verborg. Het eigen eerst, daarbinnen wat je het meest gebruikt.
 */
export function logForms(t: Targets, listId: string, shown: (listId: string) => boolean = () => true): LogForm[] {
  const list = t.lists.find((l) => l.id === listId);
  if (!list) return [];
  const lists = new Map(t.lists.map((l) => [l.id, l]));
  const used = (k: KindInfo) => t.used.find((u) => u.list_id === k.list_id && u.kind === k.id);
  const byUse = (a: KindInfo, b: KindInfo) => (used(b)?.n ?? 0) - (used(a)?.n ?? 0) || (used(b)?.last ?? "").localeCompare(used(a)?.last ?? "");
  const own = t.kinds.filter((k) => k.list_id === listId).sort(byUse);
  const others = list.stock
    ? t.kinds
        .filter((k) => k.list_id && k.list_id !== listId && movesStock(k))
        .filter((k) => {
          const l = lists.get(k.list_id!);
          return l && !l.one && shown(l.id);
        })
        .sort(byUse)
    : [];
  const forms: LogForm[] = own.length
    ? own.map((k) => ({ key: `soort:${k.id}`, kind: k, list_id: listId, label: k.name, icon: k.icon, hint: null }))
    : [{ key: `log:${listId}`, kind: null, list_id: listId, label: "Loggen", icon: list.icon ?? "note", hint: null }];
  for (const k of others) forms.push({ key: `soort:${k.id}`, kind: k, list_id: k.list_id!, label: k.name, icon: k.icon, hint: lists.get(k.list_id!)!.name });
  // Twee formulieren met dezelfde naam (Aankoop hier en in Uitgaven): de lijst erbij.
  return forms.map((f) => (forms.some((o) => o !== f && fold(o.label) === fold(f.label)) ? { ...f, label: `${f.label} · ${lists.get(f.list_id)!.name}` } : f));
}

/** Met een bedrag in je tekst eerst de formulieren met geld die iets laten gebeuren (een aankoop, geen boodschap). */
export function pricedFirst(forms: LogForm[], text: string): LogForm[] {
  if (!hasPrice(text)) return forms;
  const money = (f: LogForm) => Boolean(f.kind && BASES[f.kind.base].money && !f.kind.planned);
  return [...forms.filter(money), ...forms.filter((f) => !money(f))];
}

/**
 * Het pad om met een formulier te loggen, eventueel met een ding als eerste lijn en je tekst. `newIn`: de lijst waar je
 * vandaan komt; een nieuw ding in een lijn (een wijn die er nog niet staat) komt daar dan vanzelf in (`?nieuw=`).
 */
export function logPath(form: Pick<LogForm, "kind" | "list_id">, thing?: string, text = "", newIn?: string): string {
  const q = new URLSearchParams();
  if (form.kind) q.set("soort", form.kind.id);
  if (thing) q.set("ding", thing);
  if (text) q.set("tekst", text);
  if (newIn && newIn !== form.list_id) q.set("nieuw", newIn);
  const query = q.toString();
  return `/lijsten/${form.list_id}/loggen${query ? `?${query}` : ""}`;
}

/**
 * Wat er van je tekst overblijft naast de naam van een ding: "chablis 54 euro" bij Chablis is "54 euro". Ook een begin
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

/**
 * Waar een kasticket kan komen: de lijsten met een eigen aankoopformulier dat niet gepland begint (Uitgaven, een
 * gedeelde wijnkelder); zonder zo'n lijst de lijsten die voorraad tellen.
 */
export function receiptLists(t: Targets): TargetList[] {
  const buys = new Set(t.kinds.filter((k) => k.list_id && k.base === "aankoop" && !k.planned).map((k) => k.list_id));
  const withForm = t.lists.filter((l) => buys.has(l.id));
  return withForm.length ? withForm : t.lists.filter((l) => l.stock);
}
