// Productinfo: wat een gekend product is en bevat (naam, merk, voedingswaarde per 100 g), uit Open Food Facts, een
// open en gratis databank. Generiek: een veld zegt welk gegeven erin hoort (`product` op het veld). Een barcode, of een
// foto waarop de app het product herkent, vult die velden dan met echte gegevens in plaats van een schatting.
//
// Op barcode is het exact. Op naam en merk is het de beste match: Open Food Facts wordt door mensen aangevuld, en
// hetzelfde product staat er soms meermaals in met andere waarden. Daarom kiezen we wat het best past bij de naam, en
// daarbinnen de waarde in het midden (`bestMatch`). De app toont altijd welk product ze vond.

import type { Attributes, FieldDef, FieldType } from "./fields.ts";

export type ProductKey = "name" | "brand" | "quantity" | "kcal" | "fat" | "saturated" | "carbs" | "sugars" | "fiber" | "protein" | "salt";

/** Wat een veld uit productinfo kan krijgen; `off`: de sleutel in de voedingswaarden van Open Food Facts. */
export const PRODUCT_KEYS = {
  name: { label: "Productnaam", type: "text" },
  brand: { label: "Merk", type: "text" },
  quantity: { label: "Inhoud van de verpakking", type: "text" },
  kcal: { label: "Energie (kcal per 100 g)", type: "number", off: "energy-kcal_100g" },
  fat: { label: "Vetten (g per 100 g)", type: "number", off: "fat_100g" },
  saturated: { label: "Waarvan verzadigd (g per 100 g)", type: "number", off: "saturated-fat_100g" },
  carbs: { label: "Koolhydraten (g per 100 g)", type: "number", off: "carbohydrates_100g" },
  sugars: { label: "Waarvan suikers (g per 100 g)", type: "number", off: "sugars_100g" },
  fiber: { label: "Vezels (g per 100 g)", type: "number", off: "fiber_100g" },
  protein: { label: "Eiwitten (g per 100 g)", type: "number", off: "proteins_100g" },
  salt: { label: "Zout (g per 100 g)", type: "number", off: "salt_100g" },
} as const satisfies Record<ProductKey, { label: string; type: FieldType; off?: string }>;

export const isProductKey = (v: unknown): v is ProductKey => typeof v === "string" && Object.hasOwn(PRODUCT_KEYS, v);

/** Kan dit veld dit gegeven krijgen? Tekst voor naam, merk en inhoud; een getal voor voedingswaarden. */
export const productFits = (key: ProductKey, type: FieldType) => PRODUCT_KEYS[key].type === type;

export type ProductInfo = {
  /** De barcode (EAN), als we die kennen. */
  code: string | null;
  name: string;
  brand: string | null;
  quantity: string | null;
  /** Voedingswaarden per 100 g (of 100 ml). */
  values: Partial<Record<ProductKey, number>>;
  /** Hoe vaak het gescand werd in Open Food Facts (hoe gekender, hoe betrouwbaarder). */
  scans: number;
};

/** Een geldige barcode van een product (EAN-8, UPC-A of EAN-13), met een kloppend controlecijfer. */
export function isProductCode(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13})$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

const text = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : null);

/** Een product uit Open Food Facts omzetten; null als er geen naam of energie in staat. */
export function fromOff(raw: unknown): ProductInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const name = text(p.product_name_nl) ?? text(p.product_name) ?? text(p.product_name_fr) ?? text(p.product_name_en);
  const brands = Array.isArray(p.brands) ? p.brands.join(",") : p.brands;
  const brand = typeof brands === "string" ? text(brands.split(",")[0]) : null;
  const n = (p.nutriments && typeof p.nutriments === "object" ? p.nutriments : {}) as Record<string, unknown>;
  const values: ProductInfo["values"] = {};
  for (const [key, def] of Object.entries(PRODUCT_KEYS) as [ProductKey, { off?: string }][]) {
    const v = def.off ? n[def.off] : undefined;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) values[key] = key === "kcal" ? Math.round(v) : Math.round(v * 10) / 10;
  }
  // Enkel kJ? Dan rekenen we om (1 kcal = 4,184 kJ).
  const kj = n["energy-kj_100g"];
  if (values.kcal === undefined && typeof kj === "number" && kj > 0) values.kcal = Math.round(kj / 4.184);
  if (!name || values.kcal === undefined) return null;
  return {
    code: typeof p.code === "string" && /^\d{8,14}$/.test(p.code) ? p.code : null,
    name,
    brand,
    quantity: text(p.quantity, 40),
    values,
    scans: typeof p.unique_scans_n === "number" ? p.unique_scans_n : 0,
  };
}

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);

/**
 * Uit zoekresultaten het product dat past bij wat er op de foto staat (naam en merk). Bijna alle woorden van de naam
 * moeten erin staan (een Danio vanille is geen Danio bosbes), en het merk als dat gekend is; daarbinnen het product
 * met de energie het dichtst bij het midden (één foute invoer in de databank verandert dan niets). Null als niets
 * goed genoeg past: liever een eerlijke schatting dan een verkeerd product.
 */
export function bestMatch(hits: ProductInfo[], want: { name: string; brand?: string | null }): ProductInfo | null {
  const wanted = words(want.name);
  const brand = want.brand ? words(want.brand) : [];
  if (!wanted.length) return null;
  const scored = hits
    .map((p) => {
      const have = new Set(words(`${p.name} ${p.brand ?? ""}`));
      const name = wanted.filter((w) => have.has(w)).length / wanted.length;
      const brandOk = !brand.length || brand.some((w) => have.has(w));
      return { p, name, brandOk, score: name + (brandOk ? 0.25 : 0) };
    })
    .filter((s) => s.name >= 0.66 && (s.brandOk || s.name === 1));
  if (!scored.length) return null;
  const top = Math.max(...scored.map((s) => s.score));
  const best = scored.filter((s) => s.score >= top - 0.01).map((s) => s.p);
  const kcal = best.map((p) => p.values.kcal!).sort((a, b) => a - b);
  const mid = kcal[Math.floor((kcal.length - 1) / 2)];
  return best.sort((a, b) => Math.abs(a.values.kcal! - mid) - Math.abs(b.values.kcal! - mid) || b.scans - a.scans)[0];
}

/** De velden van een lijst die productinfo krijgen (`product`), ingevuld met wat we weten. */
export function productData(fields: FieldDef[], info: ProductInfo): Attributes {
  const out: Attributes = {};
  for (const f of fields) {
    if (!f.product) continue;
    const v =
      f.product === "name" ? info.name : f.product === "brand" ? info.brand : f.product === "quantity" ? info.quantity : info.values[f.product];
    if (v !== null && v !== undefined) out[f.key] = v;
  }
  return out;
}

/** Hoe de app een product noemt: "Nutella (Ferrero)". */
export const productLabel = (info: ProductInfo) =>
  info.brand && !info.name.toLowerCase().includes(info.brand.toLowerCase()) ? `${info.name} (${info.brand})` : info.name;
