// Getypte tekst naar een gebeurtenis, met code (geen AI): "gegeten pasta 300 g", "tankbeurt 84,50 52 liter gisteren",
// "colruyt yoghurt 6 3,56 aardappelen 1 zak 4,99". Een datum en een uur, een bedrag (met €, euro of twee cijfers na de
// komma), de dingen die in de tekst staan (met hun hoeveelheid en eenheid, en een prijs vlak erna), een getal met de
// eenheid of de naam van een veld van de soort ("52 liter", "450 kcal"). Wat overblijft, is de omschrijving. De
// dingen komen van de server (GET /things?in=, enkel wat je ziet), met de rol die ze meestal hebben (Colruyt: bij).

import type { FieldDef } from "./fields.ts";
import type { LineRole } from "./model.ts";
import { normalizeUnit, UNITS } from "./units.ts";

/** Zonder hoofdletters, accenten en leestekens op het einde. */
export const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,;:!?]+$/, "")
    .trim();

/** Zoeken op naam: elk woord van wat je typt, staat in de naam (zonder hoofdletters of accenten). */
export function nameMatches(name: string, q: string): boolean {
  const n = fold(name);
  return q.split(/\s+/).every((w) => n.includes(fold(w)));
}

/** Staat de naam als hele woorden in de tekst? */
export function nameIn(name: string, text: string): boolean {
  const n = fold(name);
  return Boolean(n) && ` ${text.split(/\s+/).map(fold).join(" ")} `.includes(` ${n} `);
}

const WEEKDAYS = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, feb: 2, februari: 2, mrt: 3, maart: 3, apr: 4, april: 4, mei: 5, jun: 6, juni: 6, jul: 7, juli: 7,
  aug: 8, augustus: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const RELATIVE: Record<string, number> = { eergisteren: -2, gisteren: -1, vandaag: 0, morgen: 1, overmorgen: 2 };

const pad = (n: number) => String(n).padStart(2, "0");
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function validDate(y: number, m: number, d: number): string | null {
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return t.getUTCMonth() + 1 === m && t.getUTCDate() === d ? iso : null;
}

/** Een datum uit één of twee woorden ("21-10", "21/10/2026", "gisteren", "maandag", "21 okt"). `n`: hoeveel woorden. */
export function readDate(words: string[], today: string): { date: string; n: number } | null {
  const w = fold(words[0] ?? "");
  const year = Number(today.slice(0, 4));
  if (w in RELATIVE) return { date: addDays(today, RELATIVE[w]), n: 1 };
  const day = WEEKDAYS.indexOf(w);
  if (day >= 0) {
    // De laatste keer dat het die dag was (vandaag telt mee).
    const now = new Date(`${today}T00:00:00Z`).getUTCDay();
    return { date: addDays(today, -((now - day + 7) % 7)), n: 1 };
  }
  let m = w.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const iso = validDate(+m[1], +m[2], +m[3]);
    return iso ? { date: iso, n: 1 } : null;
  }
  m = w.match(/^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2}|\d{4}))?$/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : year;
    const iso = validDate(y, +m[2], +m[1]);
    return iso ? { date: iso, n: 1 } : null;
  }
  const month = MONTHS[fold(words[1] ?? "")];
  if (/^\d{1,2}$/.test(w) && month) {
    const iso = validDate(year, month, +w);
    return iso ? { date: iso, n: 2 } : null;
  }
  return null;
}

/** Een uur: "18:42", "18u", "18u30", "18h30". */
export function readTime(word: string): string | null {
  const m = fold(word).match(/^(\d{1,2})(?::(\d{2})|[uh](\d{2})?)$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? m[3] ?? 0);
  return h < 24 && min < 60 ? `${pad(h)}:${pad(min)}` : null;
}

/** Een ding dat in de tekst kan staan, met de rol die het meestal heeft. */
export type ParseThing = { id: string; name: string; unit?: string | null; role: LineRole };

export type ParseContext = {
  today: string;
  /** De soort heeft een bedrag (aankoop, dienst, overdracht). */
  money: boolean;
  /** De eigen velden van de soort (Liter, Km, Kcal, Gewicht). */
  fields: FieldDef[];
  things: ParseThing[];
};

export type ParsedLine = { thing: ParseThing; amount: number | null; unit: string | null; price: number | null };

export type ParsedEvent = {
  name: string;
  /** In cent. */
  amount: number | null;
  day: string | null;
  time: string | null;
  data: Record<string, number>;
  lines: ParsedLine[];
};

const NUMBER = /^\d+(?:[.,]\d+)?$/;
const toNumber = (s: string) => Number(s.replace(",", "."));
const EURO = /^(eur|euro|euros|€)$/;
/** Woorden voor een stuk of verpakking na een getal ("2 zakken", "3 stuks"), en hun gewone vorm. */
const PACKS: Record<string, string> = {
  stuk: "stuk", stuks: "stuk", zak: "zak", zakken: "zak", doos: "doos", dozen: "doos", fles: "fles", flessen: "fles",
  pak: "pak", pakken: "pak", pot: "pot", potten: "pot", blik: "blik", blikken: "blik", bak: "bak", bakken: "bak",
  net: "net", netten: "net", verpakking: "verpakking", verpakkingen: "verpakking",
};
/** Woordjes die alleen niets zeggen (blijft er enkel dit over, dan is er geen omschrijving). */
const FILLER = new Set(["de", "het", "een", "en", "met", "van", "voor", "bij", "in", "op", "om", "te", "aan", "nog", "ook"]);

/** De eenheid van een woord na een getal: g, kg, l, stuk, zak, …; null als het geen eenheid is. */
function unitOf(word: string | undefined): string | null {
  if (!word) return null;
  const w = fold(word);
  if (PACKS[w]) return PACKS[w];
  const u = normalizeUnit(w);
  return u && (UNITS as readonly string[]).includes(u) ? u : null;
}

/** Het veld van de soort waar een woord bij hoort: zijn eenheid of zijn naam ("liter", "kcal", "km"). */
function fieldFor(word: string | undefined, fields: FieldDef[], data: Record<string, number>): FieldDef | undefined {
  if (!word) return undefined;
  const w = fold(word);
  const fits = (a: string) => Boolean(a) && (a === w || (w.length >= 3 && (a.startsWith(w) || w.startsWith(a))));
  return fields.find((f) => (f.type === "number" || f.type === "duration") && data[f.key] === undefined && (fits(fold(f.unit ?? "")) || fits(fold(f.label))));
}

/** Een bedrag in cent uit een woord met €, of null. */
function euroWord(word: string): number | null {
  const m = word.match(/^€?(\d+(?:[.,]\d{1,2})?)€?$/);
  if (!m || !/€/.test(word)) return null;
  return Math.round(toNumber(m[1]) * 100);
}

export function readEvent(text: string, ctx: ParseContext): ParsedEvent {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const bare = words.map((w) => w.replace(/[,;]$/, ""));
  const used = words.map(() => false);
  const take = (i: number, n = 1) => {
    for (let k = i; k < i + n; k++) used[k] = true;
  };
  const free = (i: number) => i >= 0 && i < words.length && !used[i];
  const out: ParsedEvent = { name: "", amount: null, day: null, time: null, data: {}, lines: [] };

  // 1. Datum en uur ("om 18u").
  for (let i = 0; i < words.length; i++) {
    if (used[i]) continue;
    if (!out.day) {
      const d = readDate(bare.slice(i), ctx.today);
      if (d) {
        out.day = d.date;
        take(i, d.n);
        continue;
      }
    }
    if (!out.time) {
      const t = readTime(bare[i]);
      if (t && (!NUMBER.test(bare[i]) || fold(bare[i - 1] ?? "") === "om")) {
        out.time = t;
        take(i);
        if (fold(bare[i - 1] ?? "") === "om" && free(i - 1)) take(i - 1);
      }
    }
  }

  // 2. De dingen in de tekst, de langste naam eerst (zo wint "melk halfvol" van "melk").
  const folded = bare.map(fold);
  const spans: { thing: ParseThing; from: number; to: number }[] = [];
  const place = (thing: ParseThing, parts: string[]) => {
    for (let i = 0; i + parts.length <= words.length; i++) {
      if (parts.every((p, k) => folded[i + k] === p && !used[i + k])) {
        take(i, parts.length);
        spans.push({ thing, from: i, to: i + parts.length });
        return true;
      }
    }
    return false;
  };
  const sorted = [...ctx.things].sort((a, b) => b.name.length - a.name.length);
  const placed = new Set(sorted.filter((t) => place(t, fold(t.name).split(/\s+/))).map((t) => t.id));
  // Dan een woord uit de naam (minstens 4 letters, geen getal): "sprinter" is Mercedes Sprinter.
  for (const thing of sorted) {
    if (placed.has(thing.id)) continue;
    for (const w of fold(thing.name).split(/\s+/)) if (w.length >= 4 && !/^\d+$/.test(w) && place(thing, [w])) break;
  }
  spans.sort((a, b) => a.from - b.from);
  const lines = new Map(spans.map((s) => [s, { thing: s.thing, amount: null, unit: null, price: null } as ParsedLine]));

  // 3. Getallen. Een bedrag: met € of euro, of twee cijfers na de komma (enkel bij een soort met geld).
  const moneyAt = (i: number): { cents: number; n: number } | null => {
    if (!free(i)) return null;
    const e = euroWord(bare[i]);
    if (e !== null) return { cents: e, n: 1 };
    if (fold(bare[i]) === "€" && free(i + 1) && NUMBER.test(bare[i + 1])) return { cents: Math.round(toNumber(bare[i + 1]) * 100), n: 2 };
    if (NUMBER.test(bare[i]) && free(i + 1) && EURO.test(fold(bare[i + 1]))) return { cents: Math.round(toNumber(bare[i]) * 100), n: 2 };
    if (ctx.money && /^\d+,\d{2}$/.test(bare[i])) return { cents: Math.round(toNumber(bare[i]) * 100), n: 1 };
    return null;
  };
  /** Een hoeveelheid op plaats i: "300 g", "300g", "2", "1 zak". */
  const quantityAt = (i: number): { amount: number; unit: string | null; n: number } | null => {
    if (!free(i)) return null;
    const glued = bare[i].match(/^(\d+(?:[.,]\d+)?)([a-zA-Z]+)$/);
    if (glued) {
      const unit = unitOf(glued[2]);
      return unit ? { amount: toNumber(glued[1]), unit, n: 1 } : null;
    }
    if (!NUMBER.test(bare[i]) || moneyAt(i)) return null;
    const unit = free(i + 1) ? unitOf(bare[i + 1]) : null;
    return { amount: toNumber(bare[i]), unit, n: unit ? 2 : 1 };
  };

  // Per ding: een hoeveelheid vlak ervoor of erna, en een prijs vlak erna (na de hoeveelheid). Enkel bij een product
  // (erbij of eraf): de km-stand na de naam van de wagen is geen hoeveelheid.
  for (const s of spans) {
    const line = lines.get(s)!;
    let end = s.to;
    if (s.thing.role !== "in" && s.thing.role !== "uit") continue;
    const after = quantityAt(s.to);
    // Een getal vlak erna dat bij een veld van de soort hoort ("52 liter"), is geen hoeveelheid.
    if (after && !(after.n === 1 && fieldFor(bare[s.to + 1], ctx.fields, out.data))) {
      line.amount = after.amount;
      line.unit = after.unit;
      take(s.to, after.n);
      end = s.to + after.n;
    } else {
      // Ervoor: "2 yoghurt", "300 g pasta".
      for (const back of [2, 1]) {
        const q = quantityAt(s.from - back);
        if (q && q.n === back) {
          line.amount = q.amount;
          line.unit = q.unit;
          take(s.from - back, back);
          break;
        }
      }
    }
    // Een prijs hoort bij wat erbij komt of eraf gaat (een product), niet bij een winkel of de wagen.
    const price = s.thing.role === "in" || s.thing.role === "uit" ? moneyAt(end) : null;
    if (price) {
      line.price = price.cents;
      take(end, price.n);
    }
  }

  // 4. Wat overblijft: een getal met de eenheid of naam van een veld, een bedrag, of één getal voor één veld.
  for (let i = 0; i < words.length; i++) {
    if (!free(i)) continue;
    const m = moneyAt(i);
    if (m && out.amount === null) {
      out.amount = m.cents;
      take(i, m.n);
      continue;
    }
    if (!NUMBER.test(bare[i])) continue;
    const f = fieldFor(bare[i + 1], ctx.fields, out.data) ?? (free(i - 1) ? fieldFor(bare[i - 1], ctx.fields, out.data) : undefined);
    if (f) {
      out.data[f.key] = toNumber(bare[i]);
      const unitAfter = fieldFor(bare[i + 1], ctx.fields, {}) === f;
      take(unitAfter ? i : i - 1, 2);
    }
  }
  for (let i = 0; i < words.length; i++) {
    if (!free(i) || !NUMBER.test(bare[i])) continue;
    const numbers = ctx.fields.filter((f) => f.type === "number" && out.data[f.key] === undefined);
    if (numbers.length === 1 && Object.keys(out.data).length === 0) {
      out.data[numbers[0].key] = toNumber(bare[i]);
      take(i);
    } else if (ctx.money && out.amount === null && spans.length === 0) {
      out.amount = Math.round(toNumber(bare[i]) * 100);
      take(i);
    }
  }

  out.lines = spans.map((s) => lines.get(s)!);
  const rest = words.filter((_, i) => !used[i]);
  out.name = rest.every((w) => FILLER.has(fold(w))) ? "" : rest.join(" ").replace(/[,;]$/, "");
  return out;
}
