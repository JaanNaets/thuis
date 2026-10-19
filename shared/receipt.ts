// Kastickets en facturen lezen met gewone code, zonder AI.
// De Worker gebruikt dezelfde functies om een AI-antwoord na te kijken, zodat er nooit
// een onmogelijke datum of een raar bedrag in het formulier belandt.

export const CATEGORIES = [
  "Boodschappen",
  "Elektronica",
  "Huishoudtoestellen",
  "Meubels",
  "Kleding",
  "Gereedschap",
  "Tuin",
  "Auto & fiets",
  "Andere",
] as const;

export type Category = (typeof CATEGORIES)[number];

export type ReceiptGuess = {
  store: string | null;
  purchased_on: string | null; // YYYY-MM-DD
  amount_cents: number | null;
  description: string | null;
  category: Category | null;
};

export type ReceiptReadResult = {
  guess: ReceiptGuess;
  /** Wie las het ticket: "code" (tekst uit een PDF) of "ai" (foto). */
  source: "code" | "ai" | null;
  complete: boolean;
  message?: string;
};

type Store = { name: string; match: RegExp; category: Category | null };

// Winkels die we herkennen. Uitbreiden mag: hoe meer hier staat, hoe vaker de AI niet nodig is.
const STORES: Store[] = [
  { name: "Colruyt", match: /colruyt/i, category: "Boodschappen" },
  { name: "Delhaize", match: /delhaize/i, category: "Boodschappen" },
  { name: "Aldi", match: /\baldi\b/i, category: "Boodschappen" },
  { name: "Lidl", match: /\blidl\b/i, category: "Boodschappen" },
  { name: "Carrefour", match: /carrefour/i, category: "Boodschappen" },
  { name: "Albert Heijn", match: /albert\s*heijn/i, category: "Boodschappen" },
  { name: "Okay", match: /\bokay\b/i, category: "Boodschappen" },
  { name: "Spar", match: /\bspar\b/i, category: "Boodschappen" },
  { name: "Intermarché", match: /intermarch[eé]/i, category: "Boodschappen" },
  { name: "Jumbo", match: /\bjumbo\b/i, category: "Boodschappen" },
  { name: "Bio-Planet", match: /bio[\s-]?planet/i, category: "Boodschappen" },
  { name: "MediaMarkt", match: /media\s*markt/i, category: "Elektronica" },
  { name: "Coolblue", match: /coolblue/i, category: "Elektronica" },
  { name: "Vanden Borre", match: /vanden\s*borre/i, category: "Elektronica" },
  { name: "Krëfel", match: /kr[eë]fel/i, category: "Elektronica" },
  { name: "Fnac", match: /\bfnac\b/i, category: "Elektronica" },
  { name: "IKEA", match: /\bikea\b/i, category: "Meubels" },
  { name: "JYSK", match: /\bjysk\b/i, category: "Meubels" },
  { name: "Leen Bakker", match: /leen\s*bakker/i, category: "Meubels" },
  { name: "Hubo", match: /\bhubo\b/i, category: "Gereedschap" },
  { name: "Brico", match: /\bbrico\b/i, category: "Gereedschap" },
  { name: "Gamma", match: /\bgamma\b/i, category: "Gereedschap" },
  { name: "Praxis", match: /\bpraxis\b/i, category: "Gereedschap" },
  { name: "Aveve", match: /\baveve\b/i, category: "Tuin" },
  { name: "Zalando", match: /zalando/i, category: "Kleding" },
  { name: "H&M", match: /\bh\s?&\s?m\b/i, category: "Kleding" },
  { name: "C&A", match: /\bc\s?&\s?a\b/i, category: "Kleding" },
  { name: "JBC", match: /\bjbc\b/i, category: "Kleding" },
  { name: "Zeeman", match: /zeeman/i, category: "Kleding" },
  { name: "Primark", match: /primark/i, category: "Kleding" },
  { name: "Torfs", match: /\btorfs\b/i, category: "Kleding" },
  { name: "Decathlon", match: /decathlon/i, category: null },
  { name: "Action", match: /\baction\b/i, category: null },
  { name: "HEMA", match: /\bhema\b/i, category: null },
  { name: "Kruidvat", match: /kruidvat/i, category: null },
  { name: "bol", match: /\bbol(\.com)?\b/i, category: null },
  { name: "Amazon", match: /amazon/i, category: null },
];

// ---------- losse onderdelen ----------

/** "1.234,56", "1 234,56", "649.00", "€ 8" → cent. */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[€\s]|eur/gi, "");
  if (!/\d/.test(s)) return null;
  const negative = s.startsWith("-");
  s = s.replace(/^-/, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const decimalAt = Math.max(lastComma, lastDot);
  let euros: number;
  if (decimalAt > -1 && s.length - decimalAt - 1 === 2) {
    euros = Number(s.slice(0, decimalAt).replace(/[.,]/g, "") + "." + s.slice(decimalAt + 1));
  } else {
    euros = Number(s.replace(/[.,]/g, ""));
  }
  if (!Number.isFinite(euros)) return null;
  return Math.round(euros * 100) * (negative ? -1 : 1);
}

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, janvier: 1,
  feb: 2, februari: 2, february: 2, fevrier: 2, février: 2,
  maa: 3, mrt: 3, maart: 3, mar: 3, march: 3, mars: 3,
  apr: 4, april: 4, avril: 4,
  mei: 5, may: 5, mai: 5,
  jun: 6, juni: 6, june: 6, juin: 6,
  jul: 7, juli: 7, july: 7, juillet: 7,
  aug: 8, augustus: 8, august: 8, aout: 8, août: 8,
  sep: 9, sept: 9, september: 9, septembre: 9,
  okt: 10, oct: 10, oktober: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, decembre: 12, décembre: 12,
};

function isoDate(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Enkel datums die kunnen kloppen: niet in de toekomst en niet ouder dan 15 jaar. */
export function plausibleDate(iso: string | null, today = new Date()): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const max = today.getTime() + 2 * 86_400_000;
  const min = today.getTime() - 15 * 365 * 86_400_000;
  return t <= max && t >= min ? iso : null;
}

/** Alle datums in een stuk tekst, in de volgorde waarin ze staan. Belgische volgorde: dag/maand/jaar. */
export function findDates(text: string, today = new Date()): string[] {
  const found: { at: number; iso: string }[] = [];
  const push = (at: number, iso: string | null) => {
    const ok = plausibleDate(iso, today);
    if (ok) found.push({ at, iso: ok });
  };

  for (const m of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    push(m.index!, isoDate(+m[1], +m[2], +m[3]));
  }
  for (const m of text.matchAll(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})\b/g)) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    push(m.index!, isoDate(year, +m[2], +m[1]));
  }
  for (const m of text.matchAll(/\b(\d{1,2})\s+([a-zéû]{3,10})\.?\s+(\d{4})\b/gi)) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month) push(m.index!, isoDate(+m[3], month, +m[1]));
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.iso);
}

/** Winkel herkennen: de vroegste vermelding in de tekst wint (de naam staat bovenaan). */
export function findStore(text: string): Store | null {
  let best: { store: Store; at: number } | null = null;
  for (const store of STORES) {
    const at = text.search(store.match);
    if (at > -1 && (!best || at < best.at)) best = { store, at };
  }
  return best?.store ?? null;
}

// Hoe specifieker het label, hoe meer we het vertrouwen als eindtotaal.
const TOTAL_LABELS = [
  /totaal\s*te\s*betalen|te\s*betalen|a\s*payer|à\s*payer|amount\s*due/i,
  /totaal\s*(incl|inclusief)|total\s*(incl|ttc)/i,
  /totaalbedrag|eindtotaal|grand\s*total/i,
  /\btotaal\b|\btotal\b/i,
];
const NOT_A_TOTAL = /sub\s*-?\s*tota|subtotal|excl|korting|reductie|wisselgeld|terug|ontvangen|gespaard|punten|aantal/i;
const VAT_LINE = /\b(btw|tva|vat)\b/i;
const AMOUNT_RE = /-?\d{1,3}(?:[.\s]\d{3})*[.,]\d{2}(?!\d)|-?\d+[.,]\d{2}(?!\d)/g;

function amountsIn(line: string): number[] {
  return [...line.matchAll(AMOUNT_RE)].map((m) => parseAmount(m[0])).filter((n): n is number => n !== null);
}

export function findTotal(lines: string[]): number | null {
  let best: { rank: number; cents: number } | null = null;
  for (const [i, line] of lines.entries()) {
    if (NOT_A_TOTAL.test(line)) continue;
    if (VAT_LINE.test(line) && !/incl/i.test(line)) continue;
    const rank = TOTAL_LABELS.findIndex((re) => re.test(line));
    if (rank === -1) continue;
    // Het bedrag staat op dezelfde regel, of (in PDF's) soms op de volgende.
    const sameLine = amountsIn(line);
    const amounts = (sameLine.length ? sameLine : amountsIn(lines[i + 1] ?? "")).filter((a) => a > 0);
    if (amounts.length === 0) continue;
    const cents = Math.max(...amounts);
    if (!best || rank < best.rank || (rank === best.rank && cents > best.cents)) best = { rank, cents };
  }
  return best?.cents ?? null;
}

function findInvoiceDate(lines: string[], today: Date): string | null {
  // Eerst regels met een datumlabel; vervaldatum en leverdatum zijn niet de aankoopdatum.
  for (const line of lines) {
    if (/verval|due|lever|delivery|geldig/i.test(line)) continue;
    if (/datum|date|besteld|factuur|aankoop|ticket/i.test(line)) {
      const [date] = findDates(line, today);
      if (date) return date;
    }
  }
  return findDates(lines.join("\n"), today)[0] ?? null;
}

// ---------- samengesteld ----------

export function emptyGuess(): ReceiptGuess {
  return { store: null, purchased_on: null, amount_cents: null, description: null, category: null };
}

export function isComplete(g: ReceiptGuess): boolean {
  return g.amount_cents !== null && g.purchased_on !== null;
}

/** Leest de tekst van een kasticket of factuur (bv. uit een PDF). */
export function parseReceiptText(text: string, today = new Date()): ReceiptGuess {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const store = findStore(text);
  return {
    store: store?.name ?? null,
    purchased_on: findInvoiceDate(lines, today),
    amount_cents: findTotal(lines),
    description: store?.category === "Boodschappen" ? `Boodschappen ${store.name}` : null,
    category: store?.category ?? null,
  };
}

/** Maakt van een onbetrouwbaar antwoord (bv. van de AI) een geldige gok, of null per veld. */
export function normalizeGuess(raw: unknown, today = new Date()): ReceiptGuess {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null;

  const rawStore = str(o.store, 80);
  const known = rawStore ? findStore(rawStore) : null;
  const store = known?.name ?? (rawStore && rawStore === rawStore.toUpperCase() ? titleCase(rawStore) : rawStore);

  const rawDate = str(o.date ?? o.purchased_on, 40);
  const date = plausibleDate(rawDate, today) ?? (rawDate ? findDates(rawDate, today)[0] ?? null : null);

  let cents: number | null = null;
  const total = o.total ?? o.amount;
  if (typeof total === "number" && Number.isFinite(total)) cents = Math.round(total * 100);
  else if (typeof total === "string") cents = parseAmount(total);
  if (cents !== null && (cents <= 0 || cents >= 10_000_000)) cents = null;

  const category = CATEGORIES.find((c) => c === o.category) ?? known?.category ?? null;

  return {
    store,
    purchased_on: date,
    amount_cents: cents,
    description: str(o.description, 120),
    category,
  };
}

/** Vult de lege velden van `primary` aan met die van `fallback`. */
export function mergeGuess(primary: ReceiptGuess, fallback: ReceiptGuess): ReceiptGuess {
  return {
    store: primary.store ?? fallback.store,
    purchased_on: primary.purchased_on ?? fallback.purchased_on,
    amount_cents: primary.amount_cents ?? fallback.amount_cents,
    description: primary.description ?? fallback.description,
    category: primary.category ?? fallback.category,
  };
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}
