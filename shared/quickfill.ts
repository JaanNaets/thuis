// Snel invullen: wat je typt ("21-10 komkommer 200 g") omzetten naar de velden van een lijst, zoveel mogelijk met
// code: datums, uren, bedragen, getallen (met eenheid), duur, keuzes, personen, items uit je lijsten en ja/nee. Wat
// overblijft, wordt de naam (of vrije tekst bij een verwijzing met `free`); is dat een hele zin, dan vraagt de app het
// aan de AI (zie POST /projects/:id/items/read), en wat de code al vond, blijft staan.

import { refLists, type AmountEntry, type Attributes, type FieldDef, type FieldValue } from "./fields.ts";
import { normalizeUnit, UNITS } from "./units.ts";

export type QuickContext = {
  /** Vandaag, YYYY-MM-DD. */
  today: string;
  /** Wie je kan kiezen bij een persoon. */
  people: { id: string; name: string }[];
  /** De items om uit te kiezen bij een verwijzing (per veld). */
  items: (fieldKey: string) => { id: string; name: string }[];
  /** Woorden die niets betekenen hier, zoals de naam van de lijst ("eten" bij Eten). */
  skip?: string[];
  /** Wat er nu in het formulier staat (bv. de portie van een product, om "2 porties" om te rekenen). */
  values?: (key: string) => unknown;
};

export type QuickResult = {
  name: string | null;
  data: Attributes;
  /** Per veld (en "name") de stukken tekst die erin kwamen: om te tonen, te verplaatsen of terug te nemen. */
  parts: Record<string, string[]>;
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

/** Zoeken op naam: elk woord van wat je typt, staat in de naam (zonder hoofdletters of accenten). */
export function nameMatches(name: string, q: string): boolean {
  const n = fold(name);
  return q.split(/\s+/).every((w) => n.includes(fold(w)));
}

/** Staat de naam als hele woorden in de tekst? Zo vindt snel invullen "appels" in "21-10 appels 2". */
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
/** Woorden voor een stuk of verpakking na een getal ("2 zakken", "3 stuks"). */
const PACKS = /^(stuks?|zak(ken)?|doos|dozen|fles(sen)?|pak(ken)?|pot(ten)?|blik(ken)?|bak(ken)?|net(ten)?|verpakkingen?)$/;
/** Het woord na een getal is het label van het veld ("4 porties", "3 portie"): ook dat veld. */
const labelFits = (word: string, field: FieldDef) => {
  const a = fold(word);
  const b = fold(field.label);
  return a.length >= 3 && (a === b || a.startsWith(b) || b.startsWith(a));
};

export function quickFill(text: string, fields: FieldDef[], ctx: QuickContext): QuickResult {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const used = words.map(() => false);
  const data: Attributes = {};
  const parts: Record<string, string[]> = {};
  const free = (i: number, n = 1) => used.slice(i, i + n).every((u) => !u) && i + n <= words.length;
  /** Woorden i tot i+n hebben een plaats; bij `key` in dat veld (zo weet je welke tekst waar terechtkwam). */
  const take = (i: number, n = 1, key?: string) => {
    for (let k = i; k < i + n; k++) used[k] = true;
    if (key) (parts[key] ??= []).push(words.slice(i, i + n).join(" "));
  };
  const put = (key: string, value: FieldValue, i: number, n = 1) => {
    data[key] = value;
    take(i, n, key);
  };
  const empty = (f: FieldDef) => data[f.key] === undefined;
  const firstEmpty = (type: FieldDef["type"], extra: (f: FieldDef) => boolean = () => true) => fields.find((f) => f.type === type && empty(f) && extra(f));
  let matchedName: string | null = null;

  // 0. Hoeveelheden (de ingrediënten van een recept of maaltijd): "400 g aardappelen, 2 eieren, zout". Een lijst met
  //    komma's gaat altijd naar de hoeveelheden; één stuk enkel als geen verwijzing naar dezelfde lijst het kan nemen
  //    (bij Eten is "200 g yoghurt" een product met een gewicht, bij een recept een ingrediënt).
  const amounts = fields.find((f) => f.type === "amounts");
  if (amounts) {
    const segments: [number, number][] = [];
    let from = 0;
    words.forEach((w, i) => {
      if (/[,;]$/.test(w) || i === words.length - 1) {
        segments.push([from, i + 1]);
        from = i + 1;
      }
    });
    const listed = segments.length > 1;
    const lists = refLists(amounts);
    const rival = fields.some((f) => (f.type === "item" || f.type === "items") && refLists(f).some((l) => lists.includes(l)));
    const options = lists.length ? ctx.items(amounts.key) : [];
    const find = (name: string) => {
      const n = fold(name);
      return options.find((o) => fold(o.name) === n) ?? [...options].filter((o) => nameIn(o.name, name)).sort((a, b) => b.name.length - a.name.length)[0];
    };
    const entries: AmountEntry[] = [];
    if (listed || !rival) {
      segments.forEach(([a, b], s) => {
        const seg = words.slice(a, b).map((w) => w.replace(/[,;]$/, ""));
        // Vanaf het laatste getal (de hoeveelheid): "4 porties 400 g aardappelen" → 400 g aardappelen.
        let q = -1;
        seg.forEach((w, i) => {
          if (NUMBER.test(w) || /^\d+(?:[.,]\d+)?[a-z]+$/i.test(w)) q = i;
        });
        if (q >= 0) {
          const glued = seg[q].match(/^(\d+(?:[.,]\d+)?)([a-z]+)$/i);
          const amount = toNumber(glued ? glued[1] : seg[q]);
          const unitWord = glued ? glued[2] : seg[q + 1];
          const unit = normalizeUnit(unitWord);
          const known = unit && (UNITS as readonly string[]).includes(unit) ? unit : null;
          const nameAt = q + 1 + (known && !glued ? 1 : 0);
          const name = seg.slice(nameAt).join(" ");
          if (!name || (glued && !known)) return;
          const item = find(name);
          if (!item && !listed) return;
          entries.push({ ...(item ? { item: item.id } : { text: name }), ...(amount > 0 ? { amount } : {}), ...(known ? { unit: known } : {}) });
          take(a + q, b - a - q, amounts.key);
          return;
        }
        // Zonder getal: een item met die naam, of (in een lijst, niet vooraan) gewoon tekst ("zout").
        const name = seg.join(" ");
        const item = find(name);
        if (item && fold(item.name) === fold(name)) entries.push({ item: item.id });
        else if (listed && s > 0 && seg.length <= 3) entries.push({ text: name });
        else return;
        take(a, b - a, amounts.key);
      });
    }
    if (entries.length) data[amounts.key] = entries;
  }

  // 1. Datums, uren, bedragen, duur en getallen: woord per woord.
  for (let i = 0; i < words.length; i++) {
    if (used[i]) continue;
    const w = fold(words[i]);
    const next = used[i + 1] ? "" : fold(words[i + 1] ?? "");

    // Datums in volgorde: de eerste naar het eerste lege datumveld, de tweede naar het tweede, ... Zijn die op, dan
    // vullen ze een periode (van, dan tot). Zonder plaats valt een datum weg (nooit in de naam).
    const date = readDate(words.slice(i, i + 2), ctx.today);
    if (date && free(i, date.n)) {
      const target = firstEmpty("date");
      const range = fields.find((f) => f.type === "date_range" && (empty(f) || (data[f.key] as [string, string | null])[1] === null));
      if (target) put(target.key, date.date, i, date.n);
      else if (range) put(range.key, empty(range) ? [date.date, null] : [(data[range.key] as [string, null])[0], date.date], i, date.n);
      else take(i, date.n);
      continue;
    }

    // 18:30, 18u, 18u30
    const time = w.match(/^(\d{1,2})(?::|u|h)(\d{2})?$/);
    if (time && +time[1] < 24 && (!time[2] || +time[2] < 60)) {
      const target = firstEmpty("time") ?? (w.includes(":") ? undefined : firstEmpty("duration"));
      if (target?.type === "time") {
        put(target.key, `${pad(+time[1])}:${time[2] ?? "00"}`, i);
        continue;
      }
      if (target?.type === "duration") {
        put(target.key, +time[1] * 60 + Number(time[2] ?? 0), i);
        continue;
      }
    }

    // 45min · 45 min
    const mins = w.match(/^(\d+)(?:min|minuten)$/);
    if ((mins || (NUMBER.test(w) && /^(min|minuten)$/.test(next))) && firstEmpty("duration")) {
      put(firstEmpty("duration")!.key, Number(mins ? mins[1] : w), i, mins ? 1 : 2);
      continue;
    }

    // € 5,20 · €5,20 · 5,20€ · 5 euro
    if (w === "€" && /^\d+(?:[.,]\d{1,2})?$/.test(next) && firstEmpty("money")) {
      put(firstEmpty("money")!.key, Math.round(toNumber(next) * 100), i, 2);
      continue;
    }
    const money = w.match(/^€?(\d+(?:[.,]\d{1,2})?)€?$/);
    const euro = money && (w.includes("€") || ["euro", "eur", "€"].includes(next));
    if (money && euro && firstEmpty("money")) {
      put(firstEmpty("money")!.key, Math.round(toNumber(money[1]) * 100), i, w.includes("€") ? 1 : 2);
      continue;
    }

    // 200 g, 200g, 2 zakken, 4 porties, 3. Een getal dat je typt, gaat nooit vanzelf naar productinfo (kcal per 100 g,
    // een portie): die komt uit de databank, je geheugen, de voorraad of ✨; "pizza 300" is hoeveel, geen kcal.
    const withUnit = w.match(/^(\d+(?:[.,]\d+)?)([a-z%]+)$/);
    const number = withUnit ? withUnit[1] : NUMBER.test(w) ? w : null;
    if (number) {
      const unit = withUnit ? withUnit[2] : next;
      // "2 porties" bij een getal in porties (Hoeveel per Portie, 30 g): 60 g, als de portie al gekend is.
      if (!withUnit && /^porties?$/.test(fold(unit ?? ""))) {
        const perPortion = (f: FieldDef) => (f.portion ? ctx.values?.(f.portion) : undefined);
        const target = fields.find((f) => f.type === "number" && empty(f) && typeof perPortion(f) === "number" && (perPortion(f) as number) > 0);
        if (target) {
          put(target.key, Math.round(toNumber(number) * (perPortion(target) as number) * 10) / 10, i, 2);
          continue;
        }
      }
      // Een label dat exact past ("Porties"), gaat voor een dat er enkel mee begint ("Portie").
      const typable = (f: FieldDef) => f.type === "number" && empty(f) && !f.product;
      const byUnit = unit
        ? (fields.find((f) => typable(f) && unitFits(unit, f)) ??
          (withUnit ? undefined : (fields.find((f) => typable(f) && fold(f.label) === fold(unit)) ?? fields.find((f) => typable(f) && labelFits(unit, f)))))
        : undefined;
      if (byUnit) {
        put(byUnit.key, toNumber(number), i, withUnit ? 1 : 2);
        continue;
      }
      // "2 boterhammen", "3 eieren": een aantal stuks, geen gewicht; dat blijft in de naam (✨ schat er het gewicht van).
      const word = fold(next ?? "");
      const counted =
        /^[a-z]{2,}$/.test(word) && !PACKS.test(word) && !(UNITS as readonly string[]).includes(normalizeUnit(word) ?? "") && !(word in RELATIVE) && !WEEKDAYS.includes(word) && !(word in MONTHS);
      const measured = (f: FieldDef) => ["g", "kg", "mg", "ml", "cl", "l"].includes(fold(f.unit ?? ""));
      const plain = firstEmpty("number", (f) => !f.product && !(counted && measured(f))) ?? firstEmpty("money");
      if (!withUnit && plain) {
        // "2 zakken": het woord voor de verpakking hoort bij het getal (en wordt geen naam).
        put(plain.key, plain.type === "money" ? Math.round(toNumber(number) * 100) : toNumber(number), i, plain.type === "number" && PACKS.test(next) ? 2 : 1);
        continue;
      }
      if (/^\d{4}$/.test(w) && firstEmpty("year")) put(firstEmpty("year")!.key, +w, i);
    }
  }

  // 2. Keuzes, personen, items en ja/nee: de langste woordgroep eerst (tot 4 woorden).
  const skip = new Set((ctx.skip ?? []).map(fold));
  const people = ctx.people.map((p) => ({ ...p, full: fold(p.name), first: fold(p.name).split(" ")[0], words: fold(p.name).split(" ") }));
  // Ook een ander woord van de naam ("jana" bij "Pellet Jana"), als maar één persoon zo heet.
  const byWord = (w: string) => {
    const found = people.filter((x) => x.words.includes(w));
    return found.length === 1 ? found[0] : undefined;
  };
  const set = (key: string, value: FieldValue) => {
    data[key] = value;
    return key;
  };
  /** Het veld waar deze woordgroep thuishoort ("" = een woord dat niets betekent hier), of false. */
  const tryPhrase = (phrase: string): string | false => {
    if (skip.has(phrase)) return "";
    for (const f of fields) {
      if ((f.type === "select" || f.type === "multi") && f.options) {
        const option = f.options.find((o) => fold(o) === phrase);
        if (option && f.type === "select" && empty(f)) return set(f.key, option);
        if (option && f.type === "multi") return set(f.key, [...((data[f.key] as string[]) ?? []), option]);
      }
      if (f.type === "person" || f.type === "people") {
        const p = people.find((x) => x.full === phrase || x.first === phrase) ?? byWord(phrase);
        if (p && f.type === "person" && empty(f)) return set(f.key, p.id);
        if (p && f.type === "people") return set(f.key, [...new Set([...((data[f.key] as string[]) ?? []), p.id])]);
      }
      if ((f.type === "item" || f.type === "items") && refLists(f).length) {
        const it = ctx.items(f.key).find((x) => fold(x.name) === phrase);
        if (it && f.type === "item" && empty(f)) {
          matchedName ??= it.name;
          return set(f.key, it.id);
        }
        if (it && f.type === "items") return set(f.key, [...new Set([...((data[f.key] as string[]) ?? []), it.id])]);
      }
      if (f.type === "bool" && empty(f) && fold(f.label) === phrase) return set(f.key, true);
    }
    return false;
  };
  for (let n = 4; n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      if (!free(i, n)) continue;
      const key = tryPhrase(fold(words.slice(i, i + n).join(" ")));
      if (key !== false) take(i, n, key || undefined);
    }
  }

  // 3. Wat overblijft: een naam of vrije tekst; een hele zin laat de code aan de AI.
  const left = words.filter((_, i) => !used[i]);
  const rest = left.join(" ");
  const sentence = left.length >= SENTENCE;
  let name: string | null = null;
  if (rest && !sentence) {
    const target = fields.find((f) => f.type === "item" && f.free && empty(f));
    if (target) {
      data[target.key] = { text: rest } satisfies FieldValue;
      parts[target.key] = [...left];
    }
    name = rest.charAt(0).toUpperCase() + rest.slice(1);
    parts.name = [...left];
  } else if (matchedName) name = matchedName;
  return { name, data, parts, rest: sentence ? rest : "", sentence };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const piece = (p: string) => new RegExp(`(^|\\s)${p.trim().split(/\s+/).map(escapeRe).join("\\s+")}(?=\\s|$)`, "i");

/** Staat dit stuk (als hele woorden) nog in de tekst? */
export function hasPiece(text: string, p: string): boolean {
  return Boolean(p.trim()) && piece(p).test(text);
}

/** De tekst zonder deze stukken (elk één keer, als hele woorden): wat je koos of verplaatste, leest de code niet opnieuw. */
export function withoutPieces(text: string, pieces: string[]): string {
  let out = text;
  for (const p of pieces) if (p.trim()) out = out.replace(piece(p), "$1");
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Naar welke andere velden een ingevulde waarde kan: een getal naar een ander getal of bedrag, een datum naar een
 * andere datum, een persoon naar een ander persoonsveld (Van, Aan), een item naar een verwijzing naar dezelfde lijsten,
 * een keuze naar een keuzelijst met die keuze.
 */
export function moveTargets(fields: FieldDef[], key: string, value: FieldValue): FieldDef[] {
  const from = fields.find((f) => f.key === key);
  if (!from) return [];
  const sameLists = (f: FieldDef) => refLists(f).slice().sort().join() === refLists(from).slice().sort().join();
  return fields.filter((f) => {
    if (f.key === key) return false;
    if (from.type === "number" || from.type === "money") return f.type === "number" || f.type === "money";
    if (from.type === "select") return f.type === "select" && (f.options ?? []).includes(String(value));
    if (from.type === "item" || from.type === "items" || from.type === "amounts") return f.type === from.type && sameLists(f) && typeof value !== "object";
    return f.type === from.type && ["date", "time", "duration", "person", "bool", "year"].includes(f.type);
  });
}

/** Een waarde van het ene veld naar het andere: een bedrag (in cent) wordt een getal en omgekeerd. */
export function moveValue(from: FieldDef, to: FieldDef, value: FieldValue): FieldValue {
  if (from.type === "money" && to.type === "number" && typeof value === "number") return value / 100;
  if (from.type === "number" && to.type === "money" && typeof value === "number") return Math.round(value * 100);
  return value;
}

/** Het woord bij de cursor (ook een getal of datum), of null tussen twee woorden. */
export function wordAt(text: string, caret: number): { word: string; start: number; end: number } | null {
  let start = caret;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  let end = caret;
  while (end < text.length && !/\s/.test(text[end])) end++;
  return end > start ? { word: text.slice(start, end), start, end } : null;
}

// ---------- keuzes terwijl je typt ----------

/**
 * Een keuze onder het invulveld terwijl je typt: een waarde voor één veld van het formulier (een item, een keuze, een
 * persoon, ja bij een ja/nee-veld, of de naam). Kiezen vult dat veld meteen in en zet `text` in je tekst.
 */
export type Suggestion = {
  /** Sleutel van het veld, of "name" voor de naam. */
  field: string;
  /** Het label van het veld (rechts in de keuze, om twee velden met dezelfde waarde uit elkaar te houden). */
  label: string;
  /** Wat in je tekst komt en wat je ziet. */
  text: string;
  /** Een id (item, persoon), een keuze, true (ja/nee), of bij verplaatsen de waarde zelf. */
  value: FieldValue;
  /** Verplaatsen: de waarde staat al in dit veld en gaat naar `field` (de tekst blijft zoals ze is). */
  move?: string;
  /** Vaak: een vorig item (deze id) als begin, zoals de vorige keer (de tekst blijft zoals ze is). */
  repeat?: string;
};

/** Zoveel keuzes tegelijk. */
export const MAX_SUGGESTIONS = 8;

/**
 * Wat je aan het typen bent: het woord bij de cursor (tot zijn einde), en ook met één of twee woorden ervoor (voor een
 * naam van meer woorden: "rode wi" → Rode wijn). De langste eerst. Leeg na een spatie, bij minder dan twee tekens of
 * een getal ("200", "21-10"): daar valt niets te kiezen.
 */
export function typedFragments(text: string, caret: number): { query: string; start: number; end: number }[] {
  let end = caret;
  while (end < text.length && !/\s/.test(text[end])) end++;
  const before = text.slice(0, end);
  const words = [...before.matchAll(/\S+/g)];
  const last = words[words.length - 1];
  if (!last || last.index! + last[0].length !== end || end === 0 || /\s/.test(text[caret - 1] ?? " ")) return [];
  if (fold(last[0]).length < 2 || /^[\d.,:/-]/.test(last[0])) return [];
  const out: { query: string; start: number; end: number }[] = [];
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    const group = words.slice(words.length - n);
    // Een getal vooraan hoort bij een hoeveelheid ("2 pel"), niet bij de naam.
    if (n > 1 && /^[\d.,:/-]/.test(group[0][0])) continue;
    out.push({ query: group.map((w) => w[0]).join(" "), start: group[0].index!, end });
  }
  return out;
}

/** De keuzes uit de velden zelf (zonder items, die komen van de server): keuzes, personen, ja/nee en eerdere namen. */
export function formSuggestions(fields: FieldDef[], people: { id: string; name: string }[], names: string[] = [], nameLabel = "Naam"): Suggestion[] {
  const out: Suggestion[] = [];
  for (const f of fields) {
    if ((f.type === "select" || f.type === "multi") && f.options) for (const o of f.options) out.push({ field: f.key, label: f.label, text: o, value: o });
    if (f.type === "person" || f.type === "people") for (const p of people) out.push({ field: f.key, label: f.label, text: p.name, value: p.id });
    if (f.type === "bool") out.push({ field: f.key, label: f.label, text: f.label, value: true });
  }
  for (const n of new Set(names)) out.push({ field: "name", label: nameLabel, text: n, value: n });
  return out;
}

/** De velden die items als keuze hebben, per groep lijsten (één vraag aan de server per groep). */
export function suggestionLists(fields: FieldDef[]): { lists: string[]; fields: FieldDef[] }[] {
  const groups = new Map<string, { lists: string[]; fields: FieldDef[] }>();
  for (const f of fields) {
    if (f.type !== "item" && f.type !== "items" && f.type !== "amounts") continue;
    const lists = refLists(f);
    if (!lists.length) continue;
    const key = [...lists].sort().join(",");
    groups.set(key, { lists, fields: [...(groups.get(key)?.fields ?? []), f] });
  }
  return [...groups.values()];
}

/**
 * De keuzes die passen bij wat je typt (`typedFragments`, de langste woordgroep die iets vindt), de beste eerst: de
 * naam begint ermee, dan een woord in de naam, dan ergens in de naam; namen van eerder als laatste. Geeft ook welk
 * stuk tekst een keuze vervangt.
 */
export function matchSuggestions(
  candidates: Suggestion[],
  fragments: { query: string; start: number; end: number }[],
): { start: number; end: number; suggestions: Suggestion[] } | null {
  for (const fragment of fragments) {
    const q = fold(fragment.query);
    const found = candidates.filter((c) => nameMatches(c.text, fragment.query));
    if (!found.length) continue;
    const rank = (c: Suggestion) => {
      const t = fold(c.text);
      const place = t.startsWith(q) ? 0 : ` ${t}`.includes(` ${q.split(" ")[0]}`) ? 1 : 2;
      return place + (c.field === "name" ? 3 : 0);
    };
    const seen = new Set<string>();
    const suggestions = found
      .filter((c) => {
        const key = `${c.field}:${String(c.value)}`;
        return !seen.has(key) && Boolean(seen.add(key));
      })
      .sort((a, b) => rank(a) - rank(b) || a.text.length - b.text.length || a.text.localeCompare(b.text, "nl"))
      .slice(0, MAX_SUGGESTIONS);
    return { start: fragment.start, end: fragment.end, suggestions };
  }
  return null;
}

/** Een keuze in de tekst zetten: het getypte stuk wordt de volledige naam, met een spatie erna. Geeft ook de cursor. */
export function insertSuggestion(text: string, start: number, end: number, insert: string): { text: string; caret: number } {
  const after = text.slice(end);
  const glue = after.startsWith(" ") ? "" : " ";
  const next = text.slice(0, start) + insert + glue + after;
  return { text: next, caret: start + insert.length + 1 };
}
