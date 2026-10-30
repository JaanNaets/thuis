// Velden: de bouwstenen van een lijst (een zelf samengesteld formulier zoals "Wijn" of "Klantenkaart").
//
// - Een veld heeft een sleutel (blijft, ook als je het hernoemt), een naam en een soort: tekst, getal, datum,
//   keuzelijst, barcode/QR, een persoon, een verwijzing naar een ander item, personen met een aandeel, een
//   berekening (zie shared/calc.ts), …
// - De waarden van een item staan als JSON bij het item, per sleutel. Wat van buiten komt, gaat altijd door
//   `cleanAttributes`: onbekende velden vallen weg, elke waarde wordt nagekeken.

/** Groepen in de keuzelijst van veldsoorten. */
import type { CalcDef, CalcResult } from "./calc.ts";
import { isProductKey, productFits, type ProductKey } from "./product.ts";

export const FIELD_GROUPS = {
  text: "Tekst",
  number: "Getallen en geld",
  time: "Datum en tijd",
  choice: "Keuzes en lijstjes",
  link: "Mensen en verwijzingen",
  calc: "Berekenen",
} as const;
export type FieldGroup = keyof typeof FIELD_GROUPS;

/** Alle veldsoorten, met waar ze bij horen en één zin uitleg (als tooltip bij het kiezen). */
export const FIELD_TYPES = {
  text: { label: "Tekst", group: "text", hint: "Een korte tekst, zoals een merk of een kamer." },
  longtext: { label: "Lange tekst", group: "text", hint: "Notities over meerdere regels. Op de fiche krijgt ze een eigen kaart." },
  url: { label: "Webadres", group: "text", hint: "Een link naar een website. Op de fiche tik je erop om ze te openen." },
  email: { label: "E-mail", group: "text", hint: "Een e-mailadres. Op de fiche tik je erop om een mail te sturen." },
  phone: { label: "Telefoon", group: "text", hint: "Een telefoonnummer. Op de fiche tik je erop om te bellen." },
  address: { label: "Adres", group: "text", hint: "Een adres. Op de fiche tik je erop om het op een kaart te openen." },
  code: { label: "Barcode of QR-code", group: "text", hint: "Scan of typ een code; de fiche toont ze groot om aan de kassa te laten scannen." },
  number: { label: "Getal", group: "number", hint: "Een aantal of maat, met een eenheid als je wil (km, cm, kg, %)." },
  money: { label: "Bedrag", group: "number", hint: "Een bedrag in euro." },
  score: { label: "Score op 5", group: "number", hint: "Sterren van 0 tot 5, ook halve." },
  date: { label: "Datum", group: "time", hint: "Een dag, zoals een aankoopdatum of een verjaardag." },
  date_range: { label: "Periode", group: "time", hint: "Van een datum tot een datum, zoals een reis of een huurcontract. Je kan filteren op wat nu loopt." },
  time: { label: "Uur", group: "time", hint: "Een tijdstip, zoals 18:30." },
  duration: { label: "Duur", group: "time", hint: "Hoe lang iets duurt, zoals 1 u 30 min of 45 min." },
  year: { label: "Jaar", group: "time", hint: "Een jaartal, zoals een jaargang of een bouwjaar." },
  year_range: {
    label: "Van–tot (jaren)",
    group: "time",
    hint: "Van een jaar tot een jaar, zoals wanneer een wijn drinkklaar is. Je kan filteren op wat nu geldt.",
  },
  interval: {
    label: "Herhaling",
    group: "time",
    hint: "Om de hoeveel tijd iets terugkomt, zoals elke 6 maanden. Met een berekening Datum plus weet je wanneer het weer moet.",
  },
  select: { label: "Keuzelijst", group: "choice", hint: "Eén keuze uit een vaste lijst, zoals Rood, Wit of Rosé." },
  multi: { label: "Meerdere waarden", group: "choice", hint: "Een paar woorden of labels, gescheiden door komma's, met voorstellen." },
  bool: { label: "Ja of nee", group: "choice", hint: "Een schakelaar: ja of nee." },
  checklist: { label: "Takenlijst", group: "choice", hint: "Een lijstje om af te vinken, zoals een paklijst of wat er nog moet gebeuren." },
  person: { label: "Persoon", group: "link", hint: "Iemand uit het project, zoals wie betaalde." },
  people: { label: "Personen", group: "link", hint: "Meerdere mensen uit het project, zoals wie meegaat." },
  share: { label: "Personen met aandeel", group: "link", hint: "Wie welk deel heeft, samen 100%: van wie iets is of hoe een uitgave verdeeld wordt." },
  item: { label: "Verwijzing", group: "link", hint: "Eén item uit een andere lijst (of dezelfde), zoals de verkoper van een aankoop." },
  items: { label: "Verwijzingen", group: "link", hint: "Meerdere items uit een andere lijst, zoals de ingrediënten van een recept." },
  calc: {
    label: "Berekening",
    group: "calc",
    hint: "De app rekent de waarde zelf uit: met andere velden, met datums, of met items die gelinkt zijn.",
  },
} as const satisfies Record<string, { label: string; group: FieldGroup; hint: string }>;
export type FieldType = keyof typeof FIELD_TYPES;

/** Om de hoeveel tijd (Herhaling). */
export const INTERVAL_UNITS = {
  day: { one: "dag", many: "dagen" },
  week: { one: "week", many: "weken" },
  month: { one: "maand", many: "maanden" },
  year: { one: "jaar", many: "jaar" },
} as const;
export type IntervalUnit = keyof typeof INTERVAL_UNITS;
export type Interval = { n: number; unit: IntervalUnit };
export type ChecklistEntry = { text: string; done: boolean };

/** Namen volgens de Barcode Detection API (wat de scanner teruggeeft), met het symbool in bwip-js (om te tekenen). */
export const CODE_FORMATS = {
  qr_code: { label: "QR-code", bwip: "qrcode" },
  ean_13: { label: "EAN-13", bwip: "ean13" },
  ean_8: { label: "EAN-8", bwip: "ean8" },
  upc_a: { label: "UPC-A", bwip: "upca" },
  upc_e: { label: "UPC-E", bwip: "upce" },
  code_128: { label: "Code 128", bwip: "code128" },
  code_39: { label: "Code 39", bwip: "code39" },
  code_93: { label: "Code 93", bwip: "code93" },
  itf: { label: "ITF", bwip: "interleaved2of5" },
  codabar: { label: "Codabar", bwip: "rationalizedCodabar" },
  data_matrix: { label: "Data Matrix", bwip: "datamatrix" },
  pdf417: { label: "PDF417", bwip: "pdf417" },
  aztec: { label: "Aztec", bwip: "azteccode" },
} as const;
export type CodeFormat = keyof typeof CODE_FORMATS;

export function isCodeFormat(value: unknown): value is CodeFormat {
  return typeof value === "string" && Object.hasOwn(CODE_FORMATS, value);
}

export type FieldDef = {
  /** Vaste sleutel in de waarden (verandert niet als je het veld hernoemt). */
  key: string;
  label: string;
  type: FieldType;
  /** Keuzes (keuzelijst) of voorstellen (meerdere waarden). */
  options?: string[];
  /** Eenheid achter een getal: "km", "cm". */
  unit?: string;
  /** Verwijzing: naar items van deze lijst. */
  ref_type?: string;
  /** Barcode/QR: het formaat als je zelf een nummer typt. */
  format?: CodeFormat;
  /** Als kolom in de lijst. */
  column?: boolean;
  /** Als filter boven de lijst. */
  filter?: boolean;
  /** Moet ingevuld zijn. */
  required?: boolean;
  /** Datum: een nieuw item begint met vandaag (bv. wat je at). */
  today?: boolean;
  /** Persoon: een nieuw item begint met jou (bv. wie betaalde), als je in het project zit. */
  me?: boolean;
  /** Personen met aandeel: leeg = verdelen, volgens de gewone verdeling of anders gelijk over iedereen in het project. */
  fill?: boolean;
  /** De gewone verdeling bij `fill` (procenten, samen 100). */
  default_shares?: Share[];
  /** Uit productinfo (een barcode of een herkend product): welk gegeven hier hoort (zie shared/product.ts). */
  product?: ProductKey;
  /** Getal: met − en + in de lijst (een voorraad), en op te tellen met scannen of een kasticket. */
  counter?: boolean;
  /** Uitleg bij het veld (en voor wie een etiket of foto leest). */
  hint?: string;
  /** Berekening: wat de app uitrekent (zie shared/calc.ts), en de soort van de uitkomst (zet de API). */
  calc?: CalcDef;
  result?: CalcResult;
};

/** Een persoon met zijn aandeel in procent (samen 100). */
export type Share = { person_id: string; share: number };
export type CodeValue = { text: string; format: CodeFormat };

/**
 * text, longtext, url, email, phone, address, select, date, time ("18:30"), person (id), item (id): tekst ·
 * number, year, money (cent), score, duration (minuten): getal · year_range: [van, tot] · date_range: [van, tot]
 * (datums) · multi, people, items: lijst · bool · code: { text, format } · share: [{ person_id, share }] ·
 * interval: { n, unit } · checklist: [{ text, done }]. Een berekening wordt niet bewaard, enkel getoond.
 */
export type FieldValue =
  | string
  | number
  | boolean
  | string[]
  | [number | null, number | null]
  | [string | null, string | null]
  | CodeValue
  | Share[]
  | Interval
  | ChecklistEntry[];
export type Attributes = Record<string, FieldValue>;

// ---------- velden nakijken ----------

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const MAX_FIELDS = 40;

/** "Kilometerstand" → "kilometerstand"; zonder accenten of tekens, uniek binnen de lijst. */
export function fieldKey(label: string, taken: string[]): string {
  const base =
    label
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^(\d)/, "v_$1")
      .slice(0, 32) || "veld";
  let key = base;
  for (let i = 2; taken.includes(key); i++) key = `${base}_${i}`;
  return key;
}

/** De velden van een lijst nakijken (wat de app of iemand anders stuurde). Gooit een fout met uitleg. */
export function cleanFields(raw: unknown): FieldDef[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_FIELDS) throw new Error(`Hoogstens ${MAX_FIELDS} velden per lijst`);
  const seen = new Set<string>();
  return raw.map((r) => {
    const f = (r ?? {}) as Record<string, unknown>;
    const label = typeof f.label === "string" ? f.label.trim().slice(0, 40) : "";
    if (!label) throw new Error("Elk veld heeft een naam nodig");
    const key = typeof f.key === "string" ? f.key : "";
    if (!KEY_RE.test(key) || seen.has(key)) throw new Error(`Het veld "${label}" heeft geen geldige sleutel`);
    seen.add(key);
    const type = f.type as FieldType;
    if (!Object.hasOwn(FIELD_TYPES, type)) throw new Error(`Onbekende soort voor "${label}"`);
    const options = Array.isArray(f.options)
      ? [
          ...new Set(
            f.options
              .filter((o): o is string => typeof o === "string")
              .map((o) => o.trim().slice(0, 60))
              .filter(Boolean),
          ),
        ].slice(0, 60)
      : undefined;
    if (type === "select" && (!options || options.length === 0)) throw new Error(`Geef "${label}" minstens één keuze`);
    const def: FieldDef = { key, label, type };
    if (options && (type === "select" || type === "multi") && options.length) def.options = options;
    if (typeof f.unit === "string" && f.unit.trim() && (type === "number" || type === "calc")) def.unit = f.unit.trim().slice(0, 12);
    if (type === "item" || type === "items") {
      if (typeof f.ref_type !== "string" || !f.ref_type) throw new Error(`Kies naar welke lijst "${label}" verwijst`);
      def.ref_type = f.ref_type.slice(0, 64);
    }
    if (type === "calc") {
      // Enkel de vorm; wat erin staat, kijkt shared/calc.ts na (die kent ook de andere lijsten).
      if (!f.calc || typeof f.calc !== "object" || Array.isArray(f.calc) || JSON.stringify(f.calc).length > 2000)
        throw new Error(`Kies wat "${label}" uitrekent`);
      def.calc = f.calc as CalcDef;
    }
    if (type === "code" && isCodeFormat(f.format)) def.format = f.format;
    if (f.column === true) def.column = true;
    if (f.filter === true && FILTERABLE.includes(type)) def.filter = true;
    if (f.required === true && type !== "calc") def.required = true;
    if (f.today === true && type === "date") def.today = true;
    if (f.me === true && type === "person") def.me = true;
    if (isProductKey(f.product) && productFits(f.product, type)) def.product = f.product;
    if (f.counter === true && type === "number") def.counter = true;
    if (f.fill === true && type === "share") {
      def.fill = true;
      let shares: Share[] = [];
      try {
        shares = normalizeShares(f.default_shares ?? null);
      } catch {
        throw new Error(`${label}: de gewone verdeling klopt niet (samen 100%, elk een deel)`);
      }
      if (shares.length) def.default_shares = shares;
    }
    if (typeof f.hint === "string" && f.hint.trim()) def.hint = f.hint.trim().slice(0, 160);
    return def;
  });
}

/** Velden waarop je boven de lijst kan filteren. */
export const FILTERABLE: FieldType[] = ["text", "select", "multi", "year", "year_range", "date_range", "bool", "person", "people", "item", "items", "calc"];

const thisYear = () => new Date().getFullYear();
const isYear = (n: number) => Number.isInteger(n) && n >= 1800 && n <= thisYear() + 80;
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

/** Eén waarde nakijken; null = leeg (wordt weggelaten). */
export function cleanValue(def: FieldDef, value: unknown): FieldValue | null {
  if (value === null || value === undefined || value === "") return null;
  switch (def.type) {
    case "text":
      return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null;
    case "longtext":
      return typeof value === "string" && value.trim() ? value.trim().slice(0, 8000) : null;
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;
    case "select":
      if (typeof value !== "string" || !value.trim()) return null;
      // Hoofdletters van de keuze overnemen ("rood" → "Rood"); een andere waarde mag (bv. uit een import).
      return def.options?.find((o) => o.toLowerCase() === value.trim().toLowerCase()) ?? value.trim().slice(0, 60);
    case "multi": {
      const list = (Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;/]/) : [])
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim().slice(0, 60))
        .filter(Boolean);
      // Dubbels weg (de eerste schrijfwijze blijft), en de schrijfwijze van een voorstel overnemen.
      const unique: string[] = [];
      for (const v of list) {
        if (unique.some((u) => u.toLowerCase() === v.toLowerCase())) continue;
        unique.push(def.options?.find((o) => o.toLowerCase() === v.toLowerCase()) ?? v);
      }
      return unique.length ? unique.slice(0, 20) : null;
    }
    case "number":
      return typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 1e12 ? Math.round(value * 1000) / 1000 : null;
    case "year":
      return typeof value === "number" && isYear(value) ? value : null;
    case "money":
      return typeof value === "number" && Number.isInteger(value) && Math.abs(value) < 100_000_000_00 ? value : null;
    case "score":
      return typeof value === "number" && value >= 0 && value <= 5 ? Math.round(value * 2) / 2 : null;
    case "bool":
      return typeof value === "boolean" ? value : null;
    case "year_range": {
      if (!Array.isArray(value) || value.length !== 2) return null;
      const [from, to] = value.map((v) => (typeof v === "number" && isYear(v) ? v : null));
      if (from === null && to === null) return null;
      if (from !== null && to !== null && to < from) return [to, from];
      return [from, to];
    }
    case "code": {
      const v = (typeof value === "string" ? { text: value } : value) as Partial<CodeValue>;
      const text = typeof v?.text === "string" ? v.text.trim().slice(0, 500) : "";
      if (!text) return null;
      return { text, format: isCodeFormat(v.format) ? v.format : (def.format ?? "qr_code") };
    }
    case "person":
    case "item":
      return typeof value === "string" && ID_RE.test(value) ? value : null;
    case "share": {
      try {
        const shares = normalizeShares(value);
        return shares.length ? shares : null;
      } catch {
        return null;
      }
    }
    case "url": {
      if (typeof value !== "string") return null;
      let url = value.trim();
      // "colruyt.be" mag ook: dat wordt https://colruyt.be.
      if (!/^https?:\/\//i.test(url) && /^[^\s/]+\.[^\s]{2,}$/.test(url)) url = `https://${url}`;
      return /^https?:\/\/[^\s]+\.[^\s]+$/i.test(url) && url.length <= 500 ? url : null;
    }
    case "email": {
      const email = typeof value === "string" ? value.trim() : "";
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200 ? email : null;
    }
    case "phone": {
      const phone = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
      return /^[+\d][\d\s()./-]{4,38}$/.test(phone) && (phone.match(/\d/g) ?? []).length >= 6 ? phone : null;
    }
    case "address":
      return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null;
    case "time": {
      const m = typeof value === "string" ? value.trim().match(/^(\d{1,2}):(\d{2})$/) : null;
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
      return `${m[1].padStart(2, "0")}:${m[2]}`;
    }
    case "duration":
      return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1_000_000 ? Math.round(value) : null;
    case "date_range": {
      if (!Array.isArray(value) || value.length !== 2) return null;
      const [from, to] = value.map((v) => (typeof v === "string" && isDate(v) ? v : null));
      if (from === null && to === null) return null;
      return from !== null && to !== null && to < from ? [to, from] : [from, to];
    }
    case "interval": {
      const v = (value ?? {}) as Partial<Interval>;
      if (typeof v !== "object" || !Object.hasOwn(INTERVAL_UNITS, v.unit ?? "")) return null;
      return typeof v.n === "number" && Number.isInteger(v.n) && v.n >= 1 && v.n <= 1000 ? { n: v.n, unit: v.unit as IntervalUnit } : null;
    }
    case "people":
    case "items": {
      if (!Array.isArray(value)) return null;
      const ids = [...new Set(value.filter((v): v is string => typeof v === "string" && ID_RE.test(v)))].slice(0, def.type === "people" ? 50 : 100);
      return ids.length ? ids : null;
    }
    case "checklist": {
      if (!Array.isArray(value)) return null;
      const list = value
        .map((v) => (v && typeof v === "object" ? (v as Partial<ChecklistEntry>) : {}))
        .filter((v) => typeof v.text === "string" && v.text.trim())
        .map((v) => ({ text: v.text!.trim().slice(0, 200), done: v.done === true }))
        .slice(0, 100);
      return list.length ? list : null;
    }
    case "calc":
      // Een berekening wordt niet bewaard: de app rekent ze telkens uit.
      return null;
  }
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Alle waarden van een item nakijken tegen de velden van zijn lijst; onbekende velden vallen weg. */
export function cleanAttributes(defs: FieldDef[], raw: unknown): Attributes {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Attributes = {};
  for (const def of defs) {
    const v = cleanValue(def, obj[def.key]);
    if (v !== null) out[def.key] = v;
  }
  return out;
}

/** De personen waarnaar waarden verwijzen (persoon, personen met aandeel). */
export function referencedPeople(defs: FieldDef[], data: Attributes): string[] {
  const ids = new Set<string>();
  for (const def of defs) {
    const v = data[def.key];
    if (def.type === "person" && typeof v === "string") ids.add(v);
    if (def.type === "people" && Array.isArray(v)) for (const id of v as string[]) ids.add(id);
    if (def.type === "share" && Array.isArray(v)) for (const s of v as Share[]) ids.add(s.person_id);
  }
  return [...ids];
}

/** De items waarnaar waarden verwijzen, met de lijst waarnaar het veld wijst. */
export function referencedItems(defs: FieldDef[], data: Attributes): { id: string; ref_type: string; key: string }[] {
  return defs.flatMap((d) => {
    const v = data[d.key];
    if (d.type === "item" && typeof v === "string") return [{ id: v, ref_type: d.ref_type!, key: d.key }];
    if (d.type === "items" && Array.isArray(v)) return (v as string[]).map((id) => ({ id, ref_type: d.ref_type!, key: d.key }));
    return [];
  });
}

/** Velden die verplicht zijn maar leeg. */
export function missingRequired(defs: FieldDef[], data: Attributes): FieldDef[] {
  return defs.filter((d) => d.required && data[d.key] === undefined);
}

// ---------- tekst lezen en tonen ----------

export function parseMoney(text: string): number {
  let s = text.replace(/[€\s]|eur/gi, "");
  if (!s) return NaN;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

/**
 * Wat iemand typte of wat in een cel van een lijst staat, omzetten naar een waarde voor dit veld.
 * Leeg = null; niet te lezen = undefined (de app toont dan een fout of slaat de cel over).
 * Personen en verwijzingen lezen we niet uit tekst (daar zijn id's voor nodig).
 */
export function parseFieldText(def: FieldDef, text: string): FieldValue | null | undefined {
  const s = text.trim();
  if (!s) return null;
  switch (def.type) {
    case "text":
    case "longtext":
    case "select":
    case "multi":
    case "code":
      return cleanValue(def, s) ?? undefined;
    case "date":
      return cleanValue(def, dateText(s)) ?? undefined;
    case "url":
    case "email":
    case "phone":
    case "address":
      return cleanValue(def, s) ?? undefined;
    case "time":
      return cleanValue(def, timeText(s)) ?? undefined;
    case "duration":
      return cleanValue(def, parseDuration(s)) ?? undefined;
    case "date_range": {
      // "12/03/2026 - 20/03/2026", "12/03/2026 tot 20/03/2026", "vanaf 12/03/2026", "tot 20/03/2026".
      const parts = s.split(/\s+(?:-|–|tot|t\/m)\s+|\s*–\s*/i).map((x) => x.replace(/^(vanaf|van|tot)\s+/i, ""));
      const dates = parts.map((x) => (isDate(dateText(x)) ? dateText(x) : null));
      if (dates.some((d, i) => d === null && parts[i].trim())) return undefined;
      const value: [string | null, string | null] = /^tot\s/i.test(s)
        ? [null, dates[0]]
        : [dates[0] ?? null, dates[1] ?? (/^vanaf\s/i.test(s) ? null : dates[0])];
      return cleanValue(def, value) ?? undefined;
    }
    case "interval":
      return cleanValue(def, parseInterval(s)) ?? undefined;
    case "checklist":
      // Eén taak per regel (of gescheiden door ;). "[x] Paspoort" is al afgevinkt.
      return (
        cleanValue(
          def,
          s.split(/\n|;/).map((line) => {
            const done = /^\s*\[[xX✓]\]\s*/.test(line);
            return { text: line.replace(/^\s*\[[ xX✓]?\]\s*/, ""), done };
          }),
        ) ?? undefined
      );
    case "number":
      return (
        cleanValue(
          def,
          Number(
            s
              .replace(/\./g, "")
              .replace(",", ".")
              .replace(/[^\d.-]/g, ""),
          ),
        ) ?? undefined
      );
    case "year":
      return cleanValue(def, Number(s.match(/\d{4}/)?.[0])) ?? undefined;
    case "money":
      return cleanValue(def, parseMoney(s)) ?? undefined;
    case "score": {
      // "4", "4,5", "4/5", "17/20" of "92/100": omgerekend naar 5.
      const m = s.replace(",", ".").match(/^(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+))?/);
      if (!m) return undefined;
      const n = Number(m[1]) * (m[2] ? 5 / Number(m[2]) : 1);
      return cleanValue(def, n) ?? undefined;
    }
    case "bool":
      if (/^(ja|j|yes|y|true|1|x|✓)$/i.test(s)) return true;
      if (/^(nee|neen|n|no|false|0)$/i.test(s)) return false;
      return undefined;
    case "year_range": {
      const years = s.match(/\d{4}/g)?.map(Number) ?? [];
      if (years.length === 0) return undefined;
      const value: [number | null, number | null] = /^(tot|voor|<)/i.test(s)
        ? [null, years[0]]
        : /(\+|vanaf|na)/i.test(s) && years.length === 1
          ? [years[0], null]
          : [years[0], years[1] ?? years[0]];
      return cleanValue(def, value) ?? undefined;
    }
    case "person":
    case "item":
    case "share":
    case "people":
    case "items":
    case "calc":
      return undefined;
  }
}

/** "3/4/2026", "03-04-2026" of "2026-04-03" → "2026-04-03". */
function dateText(s: string): string {
  const m = s.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : s.trim();
}

/** "18:30", "18u30", "18.30", "18h", "18 uur" → "18:30". */
function timeText(s: string): string {
  const m = s.trim().match(/^(\d{1,2})(?:\s*(?::|u|h|\.|uur)\s*(\d{2})?)?\s*(?:u|h|uur)?$/i);
  return m ? `${m[1]}:${m[2] ?? "00"}` : s;
}

/** Een duur lezen in minuten: "1:30", "1u30", "1 u 30 min", "1,5 uur", "90 min", "90", "2 dagen". */
export function parseDuration(text: string): number {
  const s = text.trim().toLowerCase().replace(",", ".");
  const clock = s.match(/^(\d+):(\d{2})$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const units: [RegExp, number][] = [
    [/(\d+(?:\.\d+)?)\s*(?:dagen|dag|d)\b/, 1440],
    [/(\d+(?:\.\d+)?)\s*(?:uren|uur|u|h)(?![a-z])/, 60],
    [/(\d+(?:\.\d+)?)\s*(?:minuten|minuut|min|m)\b/, 1],
  ];
  let total = 0;
  let found = false;
  let rest = s;
  for (const [re, factor] of units) {
    const m = rest.match(re);
    if (!m) continue;
    total += Number(m[1]) * factor;
    found = true;
    rest = rest.replace(m[0], " ");
  }
  // "1u30": wat na de uren komt zonder eenheid, zijn minuten.
  const after = rest.trim().match(/^(\d{1,2})$/);
  if (found && after) total += Number(after[1]);
  return found ? Math.round(total) : NaN;
}

/** 90 → "1 u 30 min", 45 → "45 min", 120 → "2 u", 3000 → "2 d 2 u". */
export function formatDuration(minutes: number): string {
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return [d && `${d} d`, h && `${h} u`, m && `${m} min`].filter(Boolean).join(" ") || "0 min";
}

/** "elke 3 maanden", "maandelijks", "2 weken", "jaarlijks", "elk jaar" → { n, unit }. */
export function parseInterval(text: string): Interval | null {
  const s = text.trim().toLowerCase();
  const words: Record<string, Interval> = {
    dagelijks: { n: 1, unit: "day" },
    wekelijks: { n: 1, unit: "week" },
    maandelijks: { n: 1, unit: "month" },
    jaarlijks: { n: 1, unit: "year" },
    driemaandelijks: { n: 3, unit: "month" },
    halfjaarlijks: { n: 6, unit: "month" },
  };
  if (words[s]) return words[s];
  const m = s.match(/^(?:elke|elk|om de|iedere|ieder)?\s*(\d+)?\s*(dagen|dag|weken|week|maanden|maand|jaren|jaar)$/);
  if (!m) return null;
  const unit: IntervalUnit = m[2].startsWith("dag") ? "day" : m[2].startsWith("we") ? "week" : m[2].startsWith("maand") ? "month" : "year";
  return { n: m[1] ? Number(m[1]) : 1, unit };
}

/** { n: 3, unit: "month" } → "elke 3 maanden"; n = 1 → "elke maand", "elk jaar". */
export function formatInterval(v: Interval): string {
  const u = INTERVAL_UNITS[v.unit];
  if (v.n === 1) return `${v.unit === "year" ? "elk" : "elke"} ${u.one}`;
  return `elke ${v.n} ${u.many}`;
}

/** Namen bij id's, om personen en verwijzingen te tonen. */
export type Names = { person: (id: string) => string; item: (id: string) => string };
const NO_NAMES: Names = { person: () => "?", item: () => "?" };

/** Een waarde netjes tonen: "2019", "€ 24,50", "2026–2032", "Pinot Noir, Gamay", "Jana 60% · Jaan 40%". */
export function formatFieldValue(def: FieldDef, value: FieldValue | undefined, names: Names = NO_NAMES): string {
  if (value === undefined || value === null) return "";
  switch (def.type) {
    case "money":
      return typeof value === "number" ? new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" }).format(value / 100) : "";
    case "multi":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "year_range": {
      if (!Array.isArray(value)) return "";
      const [from, to] = value as [number | null, number | null];
      if (from && to) return from === to ? String(from) : `${from}–${to}`;
      return from ? `vanaf ${from}` : to ? `tot ${to}` : "";
    }
    case "bool":
      return value ? "Ja" : "Nee";
    case "score":
      return `${String(value).replace(".", ",")}/5`;
    case "number":
      return `${String(value).replace(".", ",")}${def.unit ? ` ${def.unit}` : ""}`;
    case "date":
      return typeof value === "string" ? value.split("-").reverse().join("/") : "";
    case "code":
      return typeof value === "object" && value && "text" in value ? value.text : "";
    case "person":
      return typeof value === "string" ? names.person(value) : "";
    case "item":
      return typeof value === "string" ? names.item(value) : "";
    case "share":
      return Array.isArray(value) ? sharesText(value as Share[], names.person) : "";
    case "people":
      return Array.isArray(value) ? (value as string[]).map(names.person).join(", ") : "";
    case "items":
      return Array.isArray(value) ? (value as string[]).map(names.item).join(", ") : "";
    case "url":
      return typeof value === "string" ? value.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "") : "";
    case "duration":
      return typeof value === "number" ? formatDuration(value) : "";
    case "date_range": {
      if (!Array.isArray(value)) return "";
      const [from, to] = (value as [string | null, string | null]).map((d) => (d ? d.split("-").reverse().join("/") : null));
      if (from && to) return from === to ? from : `${from} – ${to}`;
      return from ? `vanaf ${from}` : to ? `tot ${to}` : "";
    }
    case "interval":
      return value && typeof value === "object" && "unit" in value ? formatInterval(value as Interval) : "";
    case "checklist": {
      if (!Array.isArray(value)) return "";
      const list = value as ChecklistEntry[];
      return `${list.filter((e) => e.done).length} van ${list.length} klaar`;
    }
    case "calc":
      // Dagen tot een datum: "over 12 dagen", "vandaag", "3 dagen geleden".
      if (def.calc?.kind === "days_until" && typeof value === "number") return daysText(value);
      // De uitkomst tonen zoals een veld van die soort (een getal met eenheid, een bedrag, een datum, ja/nee).
      if (!def.result || def.result === "calc") return String(value);
      return formatFieldValue({ ...def, type: def.result }, value, names);
    default:
      return String(value);
  }
}

/** 0 → "vandaag", 1 → "morgen", 12 → "over 12 dagen", -3 → "3 dagen geleden". */
export function daysText(days: number): string {
  if (days === 0) return "vandaag";
  if (days === 1) return "morgen";
  if (days === -1) return "gisteren";
  return days > 0 ? `over ${days} dagen` : `${-days} dagen geleden`;
}

/**
 * Valt nu binnen een periode? Jaren (van–tot, bv. een wijn die nu drinkklaar is) of datums (bv. een reis, een
 * huurcontract). Voor de filter "nu".
 */
export function rangeStatus(value: FieldValue | undefined, year = thisYear(), today = new Date().toISOString().slice(0, 10)): "now" | "later" | "past" | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [from, to] = value as [number | string | null, number | string | null];
  if (from === null && to === null) return null;
  const now = typeof (from ?? to) === "string" ? today : year;
  if (from !== null && now < from) return "later";
  if (to !== null && now > to) return "past";
  return "now";
}

// ---------- personen met aandeel ----------

/**
 * Aandelen nakijken en omrekenen naar procenten die samen 100 zijn (gewichten mogen ook: 1 en 1 = 50/50).
 * Leeg = niemand apart.
 */
export function normalizeShares(raw: unknown): Share[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 30) throw new Error("Te veel personen");
  const list = raw.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    if (typeof o.person_id !== "string" || !ID_RE.test(o.person_id)) throw new Error("Kies een persoon");
    const share = typeof o.share === "number" ? o.share : 1;
    if (!Number.isFinite(share) || share <= 0) throw new Error("Geef elke persoon een deel");
    return { person_id: o.person_id, share };
  });
  if (new Set(list.map((o) => o.person_id)).size !== list.length) throw new Error("Iemand staat er twee keer bij");
  const total = list.reduce((sum, o) => sum + o.share, 0);
  return list.map((o) => ({ person_id: o.person_id, share: Math.round((o.share / total) * 10000) / 100 }));
}

/** Een lege verdeling: de gewone (wie nog in het project zit), anders gelijk over iedereen. */
export function defaultShares(preferred: Share[] | undefined, members: string[]): Share[] {
  const kept = (preferred ?? []).filter((s) => members.includes(s.person_id));
  if (kept.length) return normalizeShares(kept);
  return members.length ? normalizeShares(members.map((id) => ({ person_id: id }))) : [];
}

/**
 * Wat velden zelf invullen als het leeg is: een verdeling (`fill`) altijd, en bij een nieuw item jij in een persoon
 * met `me` (als je in het project zit). Wat ingevuld is, blijft. `members`: wie in het project zit.
 */
export function applyFieldDefaults(fields: FieldDef[], data: Attributes, members: string[], me: string, isNew: boolean): Attributes {
  const out = { ...data };
  for (const f of fields) {
    if (f.type === "person" && f.me && isNew && out[f.key] === undefined && members.includes(me)) out[f.key] = me;
    if (f.type === "share" && f.fill && out[f.key] === undefined) {
      const shares = defaultShares(f.default_shares, members);
      if (shares.length) out[f.key] = shares;
    }
  }
  return out;
}

/**
 * Opnieuw: de waarden van een vorig item als begin van een nieuw. Berekeningen rekent de app zelf; een datum die met
 * vandaag begint, wordt `today`; een persoon die met jou begint, valt weg (die vult `applyFieldDefaults` in).
 */
export function repeatData(fields: FieldDef[], data: Attributes, today: string): Attributes {
  const out: Attributes = {};
  for (const f of fields) {
    if (f.type === "calc" || (f.type === "person" && f.me)) continue;
    if (f.type === "date" && f.today) out[f.key] = today;
    else if (data[f.key] !== undefined) out[f.key] = data[f.key];
  }
  return out;
}

const plain = (s: string) =>
  ` ${s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

/**
 * Een naam van een foto (bv. de winkel op een kasticket) koppelen aan een bestaand item: dezelfde naam, anders een
 * item waarvan de naam als hele woorden in de tekst staat ("COLRUYT LAAGSTE PRIJZEN HALLE" → Colruyt; het langste
 * wint), of omgekeerd (Colruyt → Colruyt Halle; het kortste wint). Null als niets past.
 */
export function matchName(candidates: { id: string; name: string }[], text: string): string | null {
  const t = plain(text);
  if (t.trim().length < 2) return null;
  const named = candidates.map((c) => ({ id: c.id, n: plain(c.name) })).filter((c) => c.n.trim().length >= 2);
  const exact = named.find((c) => c.n === t);
  if (exact) return exact.id;
  const inText = named.filter((c) => c.n.trim().length >= 3 && t.includes(c.n)).sort((a, b) => b.n.length - a.n.length)[0];
  if (inText) return inText.id;
  const inName = named.filter((c) => t.trim().length >= 3 && c.n.includes(t)).sort((a, b) => a.n.length - b.n.length)[0];
  return inName?.id ?? null;
}

/** Of velden iets invullen (dan heb je wie in het project zit nodig). */
export const fillsDefaults = (fields: FieldDef[]) => fields.some((f) => (f.type === "person" && f.me) || (f.type === "share" && f.fill));

/** "Jana", "Jana en Jaan", "Jana 60% · Jaan 40%". */
export function sharesText(shares: Share[], name: (id: string) => string): string {
  if (shares.length === 0) return "";
  const equal = shares.every((o) => Math.abs(o.share - shares[0].share) < 0.02);
  if (equal) {
    const names = shares.map((o) => name(o.person_id));
    return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} en ${names[names.length - 1]}`;
  }
  return shares.map((o) => `${name(o.person_id)} ${String(Math.round(o.share * 10) / 10).replace(".", ",")}%`).join(" · ");
}

// ---------- een lijst importeren ----------
//
// Een Google Sheet als CSV, Excel of gewoon geplakte cellen. Alles gebeurt in de app; de API kijkt het resultaat na.

export type Sheet = { headers: string[]; rows: string[][] };

/** Het scheidingsteken van de eerste regel: komma, puntkomma (Excel in België) of tab (geplakt uit een sheet). */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestCount = 0;
  for (const d of ["\t", ";", ","]) {
    let count = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) count++;
    }
    if (count > bestCount) [best, bestCount] = [d, count];
  }
  return best;
}

/** CSV of geplakte cellen: aanhalingstekens, "" als teken, regels binnen een cel. Lege rijen vallen weg. */
export function parseSheet(input: string): Sheet {
  const text = input.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const table: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      table.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  table.push(row);

  const filled = table.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
  const [headers = [], ...rows] = filled;
  // Een kolom zonder kop krijgt een naam, zodat je ze toch kan kiezen.
  return { headers: headers.map((h, i) => h || `Kolom ${i + 1}`), rows };
}

/** Waar een kolom heen gaat: de naam, de tags, een veld (`field:<key>`), of niets (""). */
export type ColumnTarget = "name" | "tags" | `field:${string}` | "";

/** Andere namen die je in een lijst tegenkomt voor de naam, de tags en veelgebruikte velden. */
const SYNONYMS: Record<string, string[]> = {
  name: ["naam", "wijn", "name", "titel", "omschrijving", "product", "cuvee"],
  tags: ["tags", "tag", "labels"],
  jaargang: ["jaargang", "jaar", "vintage", "oogst", "year"],
  kleur: ["kleur", "color", "colour", "type"],
  druiven: ["druif", "druiven", "druivenras", "cepage", "grape", "grapes", "varietal"],
  land: ["land", "country"],
  streek: ["streek", "regio", "appellatie", "appellation", "region", "aoc"],
  wijnhuis: ["wijnhuis", "domein", "domaine", "producent", "producer", "chateau", "winery"],
  merk: ["merk", "brand"],
  aantal: ["aantal", "flessen", "aantal flessen", "stuks", "quantity", "qty", "bottles", "voorraad"],
  prijs: ["prijs", "aankoopprijs", "prijs per fles", "price", "kostprijs", "cost", "bedrag"],
  score: ["score", "punten", "rating", "beoordeling", "sterren"],
  notitie: ["notitie", "notities", "opmerking", "opmerkingen", "notes", "proefnotitie", "commentaar"],
  drinken: ["drinken", "drinkvenster", "drink", "drinkbaar", "drink window"],
};

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Raadt bij een kolomkop het doel: de naam, de tags, een veld (`field:<key>`), of null. */
export function guessColumn(header: string, defs: FieldDef[]): ColumnTarget | null {
  const h = norm(header);
  if (!h) return null;
  for (const def of defs) if (norm(def.label) === h || def.key === h) return `field:${def.key}`;
  const synonymsOf = (label: string) => Object.values(SYNONYMS).find((list) => list.some((s) => norm(s) === norm(label))) ?? [];
  for (const def of defs) if (synonymsOf(def.label).some((s) => norm(s) === h)) return `field:${def.key}`;
  if (SYNONYMS.name.some((s) => norm(s) === h)) return "name";
  if (SYNONYMS.tags.some((s) => norm(s) === h)) return "tags";
  return null;
}

/** Het eerste veld met lange tekst: daar komt bij een import wat we niet herkennen. */
export function notesField(defs: FieldDef[]): FieldDef | undefined {
  return defs.find((d) => d.type === "longtext");
}

/** De beginkeuze per kolom. Wat we niet herkennen, gaat naar het veld met lange tekst (als dat er is). */
export function guessMapping(headers: string[], defs: FieldDef[]): ColumnTarget[] {
  const used = new Set<string>();
  const notes = notesField(defs);
  return headers.map((h): ColumnTarget => {
    const guess = guessColumn(h, defs);
    if (guess && !used.has(guess)) {
      used.add(guess);
      return guess;
    }
    return notes ? `field:${notes.key}` : "";
  });
}

export type ImportRow = { name: string; data: Record<string, FieldValue>; tags: string[] };
export type ImportProblem = { row: number; column: string; value: string };

/**
 * De rijen van de lijst omzetten met de gekozen kolommen. Meerdere kolommen naar één veld met lange tekst komen
 * onder elkaar ("Kop: waarde"). Wat niet te lezen is, komt bij dat veld en staat in `problems`.
 */
export function importRows(sheet: Sheet, mapping: ColumnTarget[], defs: FieldDef[]): { rows: ImportRow[]; problems: ImportProblem[] } {
  const problems: ImportProblem[] = [];
  const notes = notesField(defs);
  const rows = sheet.rows.map((cells, index) => {
    const row: ImportRow = { name: "", data: {}, tags: [] };
    const extra: Record<string, string[]> = {};
    const add = (key: string, line: string) => (extra[key] = [...(extra[key] ?? []), line]);
    mapping.forEach((target, col) => {
      const value = (cells[col] ?? "").trim();
      if (!target || !value) return;
      const header = sheet.headers[col];
      if (target === "name") row.name = row.name ? `${row.name} ${value}` : value;
      else if (target === "tags")
        row.tags.push(
          ...value
            .split(/[,;]/)
            .map((t) => t.trim())
            .filter(Boolean),
        );
      else {
        const def = defs.find((d) => `field:${d.key}` === target);
        if (!def) return;
        if (def.type === "longtext") {
          add(def.key, mapping.filter((t) => t === target).length > 1 ? `${header}: ${value}` : value);
          return;
        }
        if (def.key in row.data) return;
        const parsed = parseFieldText(def, value);
        if (parsed === undefined) {
          problems.push({ row: index + 1, column: header, value });
          if (notes) add(notes.key, `${header}: ${value}`);
        } else if (parsed !== null) row.data[def.key] = parsed;
      }
    });
    for (const [key, lines] of Object.entries(extra)) row.data[key] = lines.join("\n");
    return row;
  });
  return { rows, problems };
}
