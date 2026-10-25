// Eigen velden van een project (wijnkelder, koersfietsen, …) en wie eigenaar is van een ding.
//
// - Een project kiest zelf welke velden zijn dingen hebben: jaargang, druiven, framemaat, …
// - Een veld heeft een soort (tekst, jaar, keuzelijst, …) en soms een betekenis (`role`), zodat de app er slim
//   mee omgaat: "nu drinkklaar" bij een drinkvenster, de waarde van de kelder bij een prijs per eenheid.
// - Sjablonen geven een goed vertrekpunt; daarna kan je velden toevoegen, hernoemen of weglaten.

import type { ItemImportRow, ItemType, Unit } from "./types";

export const FIELD_TYPES = {
  text: { label: "Tekst" },
  number: { label: "Getal" },
  year: { label: "Jaar" },
  year_range: { label: "Van–tot (jaren)" },
  select: { label: "Keuzelijst" },
  multi: { label: "Meerdere waarden" },
  money: { label: "Bedrag" },
  score: { label: "Score op 5" },
  bool: { label: "Ja of nee" },
  date: { label: "Datum" },
} as const;
export type FieldType = keyof typeof FIELD_TYPES;

/** Wat een veld betekent. Zonder rol is het gewoon een veld. */
export const FIELD_ROLES = {
  drink_window: { label: "Drinkvenster", types: ["year_range"] },
  unit_price: { label: "Prijs per eenheid", types: ["money"] },
} as const satisfies Record<string, { label: string; types: FieldType[] }>;
export type FieldRole = keyof typeof FIELD_ROLES;

export type FieldDef = {
  /** Vaste sleutel in de waarden (verandert niet als je het veld hernoemt). */
  key: string;
  label: string;
  type: FieldType;
  /** Keuzes (keuzelijst) of voorstellen (meerdere waarden). */
  options?: string[];
  /** Eenheid achter een getal: "km", "cm". */
  unit?: string;
  /** Als kolom in de lijst. */
  column?: boolean;
  /** Als filter boven de lijst. */
  filter?: boolean;
  role?: FieldRole;
  /** Uitleg voor wie een etiket of foto leest. */
  hint?: string;
};

/** text, select, date: tekst · number, year, money (cent), score: getal · year_range: [van, tot] · multi: lijst · bool. */
export type FieldValue = string | number | boolean | string[] | [number | null, number | null];
export type Attributes = Record<string, FieldValue>;

export type ProjectTemplate = {
  label: string;
  description: string;
  icon: "wine" | "bike" | "project" | "armchair";
  track_expenses: boolean;
  track_items: boolean;
  item_type: ItemType;
  unit: Unit;
  /** Hoe de naam en het merk heten in dit project ("Wijn", "Wijnhuis"). */
  name_label: string;
  brand_label: string;
  /** Hoe de lijst heet ("Wijnen", "Fietsen"). */
  plural_label: string;
  fields: FieldDef[];
};

export const PROJECT_TEMPLATES = {
  expenses: {
    label: "Gewoon project",
    description: "Verbouwing, reis, feest: uitgaven bijhouden en verdelen",
    icon: "project",
    track_expenses: true,
    track_items: false,
    item_type: "asset",
    unit: "stuk",
    name_label: "Naam",
    brand_label: "Merk",
    plural_label: "Dingen",
    fields: [],
  },
  wine: {
    label: "Wijnkelder",
    description: "Elke wijn met jaargang, druiven, streek, drinkvenster en proefnotities",
    icon: "wine",
    track_expenses: true,
    track_items: true,
    item_type: "consumable",
    unit: "fles",
    name_label: "Wijn",
    brand_label: "Wijnhuis",
    plural_label: "Wijnen",
    fields: [
      { key: "vintage", label: "Jaargang", type: "year", column: true, hint: "jaartal van de oogst op het etiket" },
      { key: "color", label: "Kleur", type: "select", options: ["Rood", "Wit", "Rosé", "Mousserend", "Zoet", "Versterkt"], column: true, filter: true },
      { key: "grapes", label: "Druiven", type: "multi", filter: true, hint: "druivenrassen, zoals Pinot Noir of Chardonnay" },
      { key: "country", label: "Land", type: "text", filter: true },
      { key: "region", label: "Streek", type: "text", filter: true, hint: "streek of appellatie, zoals Bourgogne of Chablis" },
      { key: "size", label: "Inhoud", type: "select", options: ["37,5 cl", "50 cl", "75 cl", "1,5 l", "3 l"] },
      { key: "drink", label: "Drinken", type: "year_range", role: "drink_window" },
      { key: "price", label: "Aankoopprijs per fles", type: "money", role: "unit_price" },
      { key: "score", label: "Score", type: "score" },
    ],
  },
  bikes: {
    label: "Koersfietsen",
    description: "Fietsen met bouwjaar, maat, groep, kilometers en onderhoud",
    icon: "bike",
    track_expenses: true,
    track_items: true,
    item_type: "asset",
    unit: "stuk",
    name_label: "Fiets",
    brand_label: "Merk",
    plural_label: "Fietsen",
    fields: [
      { key: "year", label: "Bouwjaar", type: "year", column: true },
      { key: "frame", label: "Framemaat", type: "text", column: true },
      { key: "groupset", label: "Groep", type: "text", filter: true, hint: "het schakelsysteem, zoals Shimano Ultegra" },
      { key: "km", label: "Kilometerstand", type: "number", unit: "km" },
      { key: "serial", label: "Serienummer", type: "text" },
    ],
  },
  custom: {
    label: "Eigen verzameling",
    description: "Kies zelf welke velden je bijhoudt",
    icon: "armchair",
    track_expenses: false,
    track_items: true,
    item_type: "asset",
    unit: "stuk",
    name_label: "Naam",
    brand_label: "Merk",
    plural_label: "Dingen",
    fields: [],
  },
} as const satisfies Record<string, ProjectTemplate>;
export type TemplateKey = keyof typeof PROJECT_TEMPLATES;

export function templateOf(key: string | null | undefined): ProjectTemplate {
  return key && Object.hasOwn(PROJECT_TEMPLATES, key) ? PROJECT_TEMPLATES[key as TemplateKey] : PROJECT_TEMPLATES.expenses;
}

// ---------- velden nakijken ----------

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** "Kilometerstand" → "kilometerstand"; zonder accenten of tekens, uniek binnen het project. */
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

/** De velden van een project nakijken (wat de app of iemand anders stuurde). Gooit een fout met uitleg. */
export function cleanFields(raw: unknown): FieldDef[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 40) throw new Error("Hoogstens 40 velden per project");
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
    const role = f.role as FieldRole | undefined;
    if (role !== undefined && role !== null && !(Object.hasOwn(FIELD_ROLES, role) && (FIELD_ROLES[role].types as readonly FieldType[]).includes(type))) {
      throw new Error(`"${label}" kan die betekenis niet hebben`);
    }
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
    if (typeof f.unit === "string" && f.unit.trim() && type === "number") def.unit = f.unit.trim().slice(0, 12);
    if (f.column === true) def.column = true;
    if (f.filter === true) def.filter = true;
    if (role) def.role = role;
    if (typeof f.hint === "string" && f.hint.trim()) def.hint = f.hint.trim().slice(0, 120);
    return def;
  });
}

const thisYear = () => new Date().getFullYear();
const isYear = (n: number) => Number.isInteger(n) && n >= 1800 && n <= thisYear() + 80;

/** Eén waarde nakijken; null = leeg (wordt weggelaten). */
export function cleanValue(def: FieldDef, value: unknown): FieldValue | null {
  if (value === null || value === undefined || value === "") return null;
  switch (def.type) {
    case "text":
      return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null;
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
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
      return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
    case "year":
      return typeof value === "number" && isYear(value) ? value : null;
    case "money":
      return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 100_000_000 ? value : null;
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
  }
}

/** Alle waarden van een ding nakijken tegen de velden van zijn project; onbekende velden vallen weg. */
export function cleanAttributes(defs: FieldDef[], raw: unknown): Attributes {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Attributes = {};
  for (const def of defs) {
    const v = cleanValue(def, obj[def.key]);
    if (v !== null) out[def.key] = v;
  }
  return out;
}

// ---------- tekst lezen (formulier, import) ----------

/** "€ 24,50" → 2450; "1.234,5" → 123450. NaN als het geen bedrag is. */
export function parseMoney(text: string): number {
  let s = text.replace(/[€\s]|eur/gi, "");
  if (!s) return NaN;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}

/**
 * Wat iemand typte of wat in een cel van een lijst staat, omzetten naar een waarde voor dit veld.
 * Leeg = null; niet te lezen = undefined (de app toont dan een fout of slaat de cel over).
 */
export function parseFieldText(def: FieldDef, text: string): FieldValue | null | undefined {
  const s = text.trim();
  if (!s) return null;
  switch (def.type) {
    case "text":
    case "select":
    case "multi":
      return cleanValue(def, s) ?? undefined;
    case "date": {
      const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
      const iso = m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : s;
      return cleanValue(def, iso) ?? undefined;
    }
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
  }
}

/** Een waarde netjes tonen: "2019", "€ 24,50", "2026–2032", "Pinot Noir, Gamay", "★★★★☆". */
export function formatFieldValue(def: FieldDef, value: FieldValue | undefined): string {
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
    case "score": {
      const n = typeof value === "number" ? value : 0;
      return `${String(n).replace(".", ",")}/5`;
    }
    case "number":
      return `${String(value).replace(".", ",")}${def.unit ? ` ${def.unit}` : ""}`;
    case "date":
      return typeof value === "string" ? value.split("-").reverse().join("/") : "";
    default:
      return String(value);
  }
}

/** Waar staat een wijn in zijn drinkvenster? */
export function drinkStatus(value: FieldValue | undefined, year = thisYear()): "ready" | "young" | "past" | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [from, to] = value as [number | null, number | null];
  if (from === null && to === null) return null;
  if (from !== null && year < from) return "young";
  if (to !== null && year > to) return "past";
  return "ready";
}

/** Het eerste veld met deze betekenis. */
export function fieldWithRole(defs: FieldDef[], role: FieldRole): FieldDef | undefined {
  return defs.find((d) => d.role === role);
}

// ---------- kolommen van een lijst herkennen ----------

/** Wat een kolom in een lijst kan zijn, naast de eigen velden. */
export const BASE_COLUMNS = {
  name: ["naam", "wijn", "name", "wine", "cuvee", "cuvée", "omschrijving", "product", "titel"],
  brand: ["merk", "wijnhuis", "producent", "producer", "domein", "domaine", "chateau", "château", "brand", "winery"],
  quantity: ["aantal", "flessen", "aantal flessen", "stuks", "quantity", "qty", "bottles", "voorraad"],
  location: ["plaats", "locatie", "rek", "vak", "kelder", "location", "bin"],
  notes: ["notitie", "notities", "opmerking", "opmerkingen", "notes", "proefnotitie", "tasting notes", "commentaar"],
} as const;
export type BaseColumn = keyof typeof BASE_COLUMNS;

/** Andere namen die je in een lijst tegenkomt voor de velden van de sjablonen. */
const FIELD_SYNONYMS: Record<string, string[]> = {
  vintage: ["jaargang", "jaar", "vintage", "oogst", "year"],
  color: ["kleur", "type", "soort", "color", "colour"],
  grapes: ["druif", "druiven", "druivenras", "cepage", "cépage", "grape", "grapes", "varietal"],
  country: ["land", "country"],
  region: ["streek", "regio", "appellatie", "appellation", "region", "aoc"],
  size: ["inhoud", "fles", "formaat", "size", "volume"],
  drink: ["drinken", "drinkvenster", "drink", "drinkbaar", "drink window", "bewaren tot"],
  price: ["prijs", "aankoopprijs", "prijs per fles", "price", "kostprijs", "cost"],
  score: ["score", "punten", "rating", "beoordeling", "sterren"],
  year: ["bouwjaar", "jaar", "year"],
  frame: ["framemaat", "maat", "frame", "size"],
  groupset: ["groep", "groepset", "groupset", "schakeling"],
  km: ["km", "kilometers", "kilometerstand", "afstand"],
  serial: ["serienummer", "serial", "frame nummer", "framenummer"],
};

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Raadt bij een kolomkop het doel: een basiskolom ("name", "quantity", …), een veld (`field:<key>`), of null. */
export function guessColumn(header: string, defs: FieldDef[]): string | null {
  const h = norm(header);
  if (!h) return null;
  for (const def of defs) {
    if (norm(def.label) === h || def.key === h) return `field:${def.key}`;
  }
  for (const def of defs) {
    if ((FIELD_SYNONYMS[def.key] ?? []).some((s) => norm(s) === h)) return `field:${def.key}`;
  }
  for (const [col, names] of Object.entries(BASE_COLUMNS)) {
    if ((names as readonly string[]).some((n) => norm(n) === h)) return col;
  }
  return null;
}

// ---------- eigenaars ----------

export type OwnerShare = { member_id: string; share: number };

/**
 * Eigenaars nakijken en omrekenen naar procenten die samen 100 zijn (gewichten mogen ook: 1 en 1 = 50/50).
 * Leeg = van het huishouden samen.
 */
export function normalizeOwners(raw: unknown): OwnerShare[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 30) throw new Error("Te veel eigenaars");
  const list = raw.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    if (typeof o.member_id !== "string" || !o.member_id) throw new Error("Kies wie eigenaar is");
    const share = typeof o.share === "number" ? o.share : 1;
    if (!Number.isFinite(share) || share <= 0) throw new Error("Geef elke eigenaar een deel");
    return { member_id: o.member_id, share };
  });
  if (new Set(list.map((o) => o.member_id)).size !== list.length) throw new Error("Iemand staat twee keer bij de eigenaars");
  const total = list.reduce((sum, o) => sum + o.share, 0);
  return list.map((o) => ({ member_id: o.member_id, share: Math.round((o.share / total) * 10000) / 100 }));
}

/** "Jana", "Jana en Jaan", "Jana 60% · Jaan 40%". */
export function ownersText(owners: OwnerShare[], name: (id: string) => string): string {
  if (owners.length === 0) return "Samen";
  const equal = owners.every((o) => Math.abs(o.share - owners[0].share) < 0.02);
  if (equal) {
    const names = owners.map((o) => name(o.member_id));
    return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} en ${names[names.length - 1]}`;
  }
  return owners.map((o) => `${name(o.member_id)} ${String(Math.round(o.share * 10) / 10).replace(".", ",")}%`).join(" · ");
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

/** Waar een kolom heen gaat: een basiskolom, een eigen veld (`field:<key>`), of niets (""). */
export type ColumnTarget = keyof typeof BASE_COLUMNS | `field:${string}` | "";

/** De beginkeuze per kolom. Wat we niet herkennen, komt bij de notitie: zo gaat er niets verloren. */
export function guessMapping(headers: string[], defs: FieldDef[]): ColumnTarget[] {
  const used = new Set<string>();
  return headers.map((h) => {
    const guess = guessColumn(h, defs) as ColumnTarget | null;
    // Twee kolommen voor hetzelfde veld: de eerste krijgt het, de rest gaat bij de notitie.
    if (!guess || (guess !== "notes" && used.has(guess))) return "notes";
    used.add(guess);
    return guess;
  });
}

export type ImportProblem = { row: number; column: string; value: string };

/** Een getal uit een cel: "6", "6 flessen", "1,5". Leeg = null, onleesbaar = undefined. */
function parseQuantity(text: string): number | null | undefined {
  const s = text.trim();
  if (!s) return null;
  const n = Number(s.replace(",", ".").match(/^\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * De rijen van de lijst omzetten met de gekozen kolommen. Wat niet te lezen is (een jaartal "ca. negentig"),
 * komt bij de notitie met de naam van de kolom en staat in `problems`.
 */
export function importRows(sheet: Sheet, mapping: ColumnTarget[], defs: FieldDef[]): { rows: ItemImportRow[]; problems: ImportProblem[] } {
  const problems: ImportProblem[] = [];
  const rows = sheet.rows.map((cells, index) => {
    const row: ItemImportRow = { name: "", attributes: {} };
    const notes: string[] = [];
    const attributes: Record<string, FieldValue> = {};
    mapping.forEach((target, col) => {
      const value = (cells[col] ?? "").trim();
      if (!target || !value) return;
      const header = sheet.headers[col];
      const unreadable = () => {
        problems.push({ row: index + 1, column: header, value });
        notes.push(`${header}: ${value}`);
      };
      if (target === "name") row.name = row.name ? `${row.name} ${value}` : value;
      else if (target === "brand") row.brand ??= value;
      else if (target === "location") row.location ??= value;
      else if (target === "notes") notes.push(mapping.filter((t) => t === "notes").length > 1 ? `${header}: ${value}` : value);
      else if (target === "quantity") {
        const n = parseQuantity(value);
        if (n === undefined) unreadable();
        else row.quantity ??= n;
      } else {
        const def = defs.find((d) => `field:${d.key}` === target);
        if (!def || def.key in attributes) return;
        const parsed = parseFieldText(def, value);
        if (parsed === undefined) unreadable();
        else if (parsed !== null) attributes[def.key] = parsed;
      }
    });
    row.attributes = attributes;
    if (notes.length) row.notes = notes.join("\n");
    return row;
  });
  return { rows, problems };
}

// ---------- waarde en wie wat heeft ----------

type Valued = { type: ItemType; quantity: number; attributes: Attributes; value_cents: number | null; cost_cents: number; owners: OwnerShare[] };

/**
 * Wat iets waard is: bij iets dat opraakt het aantal × de prijs per eenheid (een veld met die betekenis),
 * anders de geschatte waarde of wat het kostte.
 */
export function itemValue(item: Valued, defs: FieldDef[]): number {
  if (item.type === "consumable") {
    const price = fieldWithRole(defs, "unit_price");
    const unit = price ? item.attributes[price.key] : undefined;
    return typeof unit === "number" ? Math.round(unit * item.quantity) : 0;
  }
  return item.value_cents ?? item.cost_cents ?? 0;
}

/** De waarde per eigenaar ("" = van het huishouden samen), van groot naar klein. */
export function valueByOwner(items: Valued[], defs: FieldDef[]): { member_id: string; cents: number }[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    const value = itemValue(item, defs);
    if (!value) continue;
    if (item.owners.length === 0) totals.set("", (totals.get("") ?? 0) + value);
    for (const o of item.owners) totals.set(o.member_id, (totals.get(o.member_id) ?? 0) + (value * o.share) / 100);
  }
  return [...totals.entries()].map(([member_id, cents]) => ({ member_id, cents: Math.round(cents) })).sort((a, b) => b.cents - a.cents);
}

// ---------- een lijn van een factuur ----------

/**
 * "6x Chablis 1er Cru Montmains 2019 75cl" → naam "Chablis 1er Cru Montmains", aantal 6, jaargang 2019.
 * Het jaartal gaat naar het eerste jaarveld van het project (zonder jaarveld blijft het in de naam).
 */
export function parseInvoiceLine(description: string, defs: FieldDef[]): { name: string; quantity: number; attributes: Attributes } {
  let name = description.replace(/\s+/g, " ").trim();
  let quantity = 1;
  const attributes: Attributes = {};
  const lead = name.match(/^(\d{1,3})\s*(?:[x×*]|fl\.?|fles(?:sen)?|btl\.?|st\.?|stuks?)\s+/i);
  const trail = name.match(/\s+(?:[x×*]\s*(\d{1,3})|(\d{1,3})\s*(?:fl\.?|fles(?:sen)?|btl\.?|st\.?|stuks?))$/i);
  if (lead) {
    quantity = Number(lead[1]);
    name = name.slice(lead[0].length);
  } else if (trail) {
    quantity = Number(trail[1] ?? trail[2]);
    name = name.slice(0, -trail[0].length);
  }
  // Inhoud van de fles weg uit de naam: "75cl", "0,75 l", "1,5L".
  name = name.replace(/\s*\b\d+(?:[.,]\d+)?\s*(?:cl|ml|l)\b\.?/gi, " ");
  const yearField = defs.find((d) => d.type === "year");
  const year = name.match(/\b(19[4-9]\d|20[0-4]\d)\b/);
  if (yearField && year) {
    attributes[yearField.key] = Number(year[1]);
    name = name.replace(year[0], " ");
  }
  name = name
    .replace(/\s+/g, " ")
    .replace(/^[\s,–-]+|[\s,–-]+$/g, "")
    .trim();
  return { name: name || description.trim(), quantity: quantity > 0 ? quantity : 1, attributes };
}
