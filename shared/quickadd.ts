// Toevoegen (de + op het overzicht): typ waar het heen moet en wat je weet, kies de lijst, en het formulier opent met de
// rest van je tekst al ingevuld (snel invullen, zie shared/quickfill.ts). "bijv" → Bijvulling · Pelletkachel; "uitgave
// pellets 40 euro" → Uitgave, met "pellets 40 euro" in het formulier. De lijsten die jij het vaakst gebruikt, eerst.

import { fold } from "./quickfill.ts";

/** Een lijst waarin je iets kan toevoegen, in een project (zie GET /me/lists). */
export type AddTarget = {
  project_id: string;
  project_name: string;
  type_id: string;
  name: string;
  plural: string;
  icon: string | null;
  /** Hoeveel items jij er de laatste 90 dagen in zette. */
  used: number;
  /** Wanneer jij er het laatst iets in zette (of null). */
  last: string | null;
  /** De lijst telt een voorraad (een getal met − en +): daar kan een kasticket naartoe. */
  counter: boolean;
  /** De lijst leest een kasticket per lijn (een bedrag en een product dat telt, zie shared/receipt.ts). */
  receipt: boolean;
};

/** Zoveel lijsten stuurt de server (de meestgebruikte eerst). */
export const MAX_TARGETS = 300;

/** De meestgebruikte eerst, dan de laatst gebruikte, dan op naam. */
export function rankTargets<T extends AddTarget>(targets: T[]): T[] {
  return [...targets].sort(
    (a, b) => b.used - a.used || (b.last ?? "").localeCompare(a.last ?? "") || a.name.localeCompare(b.name, "nl") || a.project_name.localeCompare(b.project_name, "nl"),
  );
}

/** Begint `name` met deze woorden ("bijv" bij Bijvulling, "rode wi" bij Rode wijn)? */
const startsWith = (name: string, words: string[]) => {
  const n = fold(name);
  const q = words.map(fold).join(" ");
  return Boolean(q) && (n.startsWith(q) || n.split(" ").some((_, i, all) => all.slice(i).join(" ").startsWith(q)));
};

/**
 * Welke lijsten passen bij wat je typt, en wat er overblijft voor het formulier. De eerste woorden die de naam van
 * een lijst zijn (of het begin ervan), kiezen die lijst; de eerste woorden die een project zijn, de lijsten van dat
 * project (`strong`: je tekst noemt de lijst of het project). Past er niets, dan alle lijsten, en gaat de hele tekst
 * mee. Zonder tekst: alle lijsten.
 */
export function matchTargets<T extends AddTarget>(text: string, targets: T[]): { target: T; rest: string; strong: boolean }[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const ranked = rankTargets(targets);
  const all = (rest: string, strong = false) => (list: T[]) => list.map((target) => ({ target, rest, strong }));
  if (!words.length) return all("")(ranked);
  for (let k = Math.min(3, words.length); k >= 1; k--) {
    const head = words.slice(0, k);
    const rest = words.slice(k).join(" ");
    const byList = ranked.filter((t) => startsWith(t.name, head) || startsWith(t.plural, head));
    if (byList.length) return all(rest, true)(byList);
    const byProject = ranked.filter((t) => startsWith(t.project_name, head));
    if (byProject.length) {
      // "pelletkachel bijv": eerst het project, dan de lijst erin.
      const next = words.slice(k, k + 1);
      const inList = next.length ? byProject.filter((t) => startsWith(t.name, next) || startsWith(t.plural, next)) : [];
      return inList.length ? all(words.slice(k + 1).join(" "), true)(inList) : all(rest, true)(byProject);
    }
  }
  return all(words.join(" "))(ranked);
}

/** Het formulier voor een lijst, met eventueel tekst om meteen in te vullen. */
export const addPath = (t: { project_id: string; type_id: string }, text = "") =>
  `/projecten/${t.project_id}/nieuw?lijst=${t.type_id}${text.trim() ? `&tekst=${encodeURIComponent(text.trim())}` : ""}`;
