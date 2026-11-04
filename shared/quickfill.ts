// Snel invullen: wat je typt ("21-10 komkommer 200 g") omzetten naar de velden van een lijst, zoveel mogelijk met
// code: datums, uren, bedragen, getallen (met eenheid), duur, keuzes, personen, items uit je lijsten en ja/nee. Wat
// overblijft, wordt de naam (of vrije tekst bij een verwijzing met `free`); is dat een hele zin, dan vraagt de app het
// aan de AI (zie POST /projects/:id/items/read), en wat de code al vond, blijft staan.

import { refLists, type Attributes, type FieldDef, type FieldValue } from "./fields.ts";

export type QuickContext = {
  /** Vandaag, YYYY-MM-DD. */
  today: string;
  /** Wie je kan kiezen bij een persoon. */
  people: { id: string; name: string }[];
  /** De items om uit te kiezen bij een verwijzing (per veld). */
  items: (fieldKey: string) => { id: string; name: string }[];
  /** Woorden die niets betekenen hier, zoals de naam van de lijst ("eten" bij Eten). */
  skip?: string[];
};

export type QuickResult = {
  name: string | null;
  data: Attributes;
  /** Wat de code niet kon plaatsen (leeg als alles een plaats kreeg). */
  rest: string;
  /** De rest is een zin: beter aan de AI vragen dan als naam gebruiken. */
  sentence: boolean;
};

/** Zoveel woorden of meer is een zin, geen naam. */
const SENTENCE = 4;

export const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,;:!?]+$/, "")
    .trim();

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
  m = w.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2}|\d{4}))?$/);
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

const NUMBER = /^(\d+(?:[.,]\d+)?)$/;
const toNumber = (s: string) => Number(s.replace(",", "."));
/** Een eenheid hoort bij een veld als ze gelijk is, of de ene het begin van de andere ("zak", "zakken"). */
const unitFits = (unit: string, field: FieldDef) => {
  const a = fold(unit);
  const b = fold(field.unit ?? "");
  return Boolean(a && b && (a === b || a.startsWith(b) || b.startsWith(a)));
};

export function quickFill(text: string, fields: FieldDef[], ctx: QuickContext): QuickResult {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const used = words.map(() => false);
  const data: Attributes = {};
  const free = (i: number, n = 1) => used.slice(i, i + n).every((u) => !u) && i + n <= words.length;
  const take = (i: number, n = 1) => {
    for (let k = i; k < i + n; k++) used[k] = true;
  };
  const empty = (f: FieldDef) => data[f.key] === undefined;
  const firstEmpty = (type: FieldDef["type"], extra: (f: FieldDef) => boolean = () => true) => fields.find((f) => f.type === type && empty(f) && extra(f));
  let matchedName: string | null = null;

  // 1. Datums, uren, bedragen, duur en getallen: woord per woord.
  for (let i = 0; i < words.length; i++) {
    if (used[i]) continue;
    const w = fold(words[i]);
    const next = fold(words[i + 1] ?? "");

    // Een datum gaat naar het eerste lege datumveld; zonder plaats valt ze weg (nooit in de naam).
    const date = readDate(words.slice(i, i + 2), ctx.today);
    if (date && free(i, date.n)) {
      const target = firstEmpty("date");
      if (target) data[target.key] = date.date;
      take(i, date.n);
      continue;
    }

    // 18:30, 18u, 18u30
    const time = w.match(/^(\d{1,2})(?::|u|h)(\d{2})?$/);
    if (time && +time[1] < 24 && (!time[2] || +time[2] < 60)) {
      const target = firstEmpty("time") ?? (w.includes(":") ? undefined : firstEmpty("duration"));
      if (target?.type === "time") {
        data[target.key] = `${pad(+time[1])}:${time[2] ?? "00"}`;
        take(i);
        continue;
      }
      if (target?.type === "duration") {
        data[target.key] = +time[1] * 60 + Number(time[2] ?? 0);
        take(i);
        continue;
      }
    }

    // 45min · 45 min
    const mins = w.match(/^(\d+)(?:min|minuten)$/);
    if ((mins || (NUMBER.test(w) && /^(min|minuten)$/.test(next))) && firstEmpty("duration")) {
      data[firstEmpty("duration")!.key] = Number(mins ? mins[1] : w);
      take(i, mins ? 1 : 2);
      continue;
    }

    // € 5,20 · €5,20 · 5,20€ · 5 euro
    if (w === "€" && /^\d+(?:[.,]\d{1,2})?$/.test(next) && firstEmpty("money")) {
      data[firstEmpty("money")!.key] = Math.round(toNumber(next) * 100);
      take(i, 2);
      continue;
    }
    const money = w.match(/^€?(\d+(?:[.,]\d{1,2})?)€?$/);
    const euro = money && (w.includes("€") || ["euro", "eur", "€"].includes(next));
    if (money && euro && firstEmpty("money")) {
      data[firstEmpty("money")!.key] = Math.round(toNumber(money[1]) * 100);
      take(i, w.includes("€") ? 1 : 2);
      continue;
    }

    // 200 g, 200g, 2 zakken, 3
    const withUnit = w.match(/^(\d+(?:[.,]\d+)?)([a-z%]+)$/);
    const number = withUnit ? withUnit[1] : NUMBER.test(w) ? w : null;
    if (number) {
      const unit = withUnit ? withUnit[2] : next;
      const byUnit = unit ? fields.find((f) => f.type === "number" && empty(f) && unitFits(unit, f)) : undefined;
      if (byUnit) {
        data[byUnit.key] = toNumber(number);
        take(i, withUnit ? 1 : 2);
        continue;
      }
      const plain = firstEmpty("number") ?? firstEmpty("money");
      if (!withUnit && plain) {
        data[plain.key] = plain.type === "money" ? Math.round(toNumber(number) * 100) : toNumber(number);
        take(i);
        continue;
      }
      if (/^\d{4}$/.test(w) && firstEmpty("year")) {
        data[firstEmpty("year")!.key] = +w;
        take(i);
      }
    }
  }

  // 2. Keuzes, personen, items en ja/nee: de langste woordgroep eerst (tot 4 woorden).
  const skip = new Set((ctx.skip ?? []).map(fold));
  const people = ctx.people.map((p) => ({ ...p, full: fold(p.name), first: fold(p.name).split(" ")[0] }));
  const tryPhrase = (phrase: string): boolean => {
    if (skip.has(phrase)) return true;
    for (const f of fields) {
      if ((f.type === "select" || f.type === "multi") && f.options) {
        const option = f.options.find((o) => fold(o) === phrase);
        if (option && f.type === "select" && empty(f)) return Boolean((data[f.key] = option));
        if (option && f.type === "multi") return Boolean((data[f.key] = [...((data[f.key] as string[]) ?? []), option]));
      }
      if (f.type === "person" || f.type === "people") {
        const p = people.find((x) => x.full === phrase || x.first === phrase);
        if (p && f.type === "person" && empty(f)) return Boolean((data[f.key] = p.id));
        if (p && f.type === "people") return Boolean((data[f.key] = [...new Set([...((data[f.key] as string[]) ?? []), p.id])]));
      }
      if ((f.type === "item" || f.type === "items") && refLists(f).length) {
        const it = ctx.items(f.key).find((x) => fold(x.name) === phrase);
        if (it && f.type === "item" && empty(f)) {
          matchedName ??= it.name;
          return Boolean((data[f.key] = it.id));
        }
        if (it && f.type === "items") return Boolean((data[f.key] = [...new Set([...((data[f.key] as string[]) ?? []), it.id])]));
      }
      if (f.type === "bool" && empty(f) && fold(f.label) === phrase) return Boolean((data[f.key] = true));
    }
    return false;
  };
  for (let n = 4; n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      if (!free(i, n)) continue;
      if (tryPhrase(fold(words.slice(i, i + n).join(" ")))) take(i, n);
    }
  }

  // 3. Wat overblijft: een naam of vrije tekst; een hele zin laat de code aan de AI.
  const rest = words.filter((_, i) => !used[i]).join(" ");
  const sentence = rest.split(" ").filter(Boolean).length >= SENTENCE;
  let name: string | null = null;
  if (rest && !sentence) {
    const target = fields.find((f) => f.type === "item" && f.free && empty(f));
    if (target) data[target.key] = { text: rest } satisfies FieldValue;
    name = rest.charAt(0).toUpperCase() + rest.slice(1);
  } else if (matchedName) name = matchedName;
  return { name, data, rest: sentence ? rest : "", sentence };
}
