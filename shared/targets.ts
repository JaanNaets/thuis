// Waar je iets kan toevoegen (Toevoegen, het palet, de snelkoppelingen): per lijst waar je lid bent "Loggen in Voorraad",
// per eigen soort "Gegeten" (in haar lijst) en per lijst met dingen "Wijn toevoegen". Wat je het meest gebruikt, eerst.
// Noemen de eerste woorden van je tekst er een ("gegeten pasta 300 g"), dan staat die bovenaan en gaat de rest als
// tekst naar het formulier.

import type { KindInfo } from "./model.ts";

export type TargetList = { id: string; name: string; one: string | null; icon: string | null; color: string | null; stock: boolean };
export type Targets = { lists: TargetList[]; kinds: KindInfo[]; used: { list_id: string; kind: string; n: number; last: string }[] };

export type Target = {
  key: string;
  /** Wat er staat: "Gegeten", "Loggen in Voorraad", "Wijn toevoegen". */
  label: string;
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
  for (const l of t.lists) {
    const logs = t.used.filter((u) => u.list_id === l.id && u.kind !== "+ding");
    out.push({
      key: `log:${l.id}`,
      label: `Loggen in ${l.name}`,
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
    if (l.one) {
      const c = count(l.id, "+ding");
      out.push({ key: `ding:${l.id}`, label: `${l.one} toevoegen`, hint: l.name, icon: l.icon ?? "folder", list_id: l.id, kind: null, thing: true, words: [fold(l.one), fold(l.name)], used: c.n, last: c.last, buys: false });
    }
  }
  const editable = new Set(t.lists.map((l) => l.id));
  for (const k of t.kinds) {
    if (!k.list_id || !editable.has(k.list_id)) continue;
    const list = t.lists.find((l) => l.id === k.list_id)!;
    const c = count(k.list_id, k.id);
    out.push({ key: `soort:${k.id}`, label: k.name, hint: list.name, icon: k.icon, list_id: k.list_id, kind: k.id, thing: false, words: [fold(k.name)], used: c.n, last: c.last, buys: k.base === "aankoop" });
  }
  return out.sort((a, b) => b.used - a.used || b.last.localeCompare(a.last) || a.label.localeCompare(b.label, "nl"));
}

/** Staat er een bedrag in de tekst ("6 euro", "€ 4,99", "12,50")? */
export const hasPrice = (text: string) => /(€\s*\d|\d+([.,]\d{1,2})?\s*(€|euro|eur)\b|\d+,\d{2}\b)/i.test(text);

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
