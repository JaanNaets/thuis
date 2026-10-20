// Productgegevens bij een gescande barcode, uit Open Food Facts (gratis, open data).
// Zonder AI: de categorie leiden we af uit hun eigen categorieën met een vaste lijst.

import type { ProductSuggestion } from "./types";

// Volgorde telt: de eerste die past, wint ("en:frozen-vegetables" is diepvries, niet groenten).
const CATEGORY_RULES: [RegExp, string][] = [
  [/frozen/, "item-diepvries"],
  [/(dairies|milks|cheeses|yogurts|butters|creams|eggs)\b/, "item-zuivel"],
  [/(meats|poultry|fishes|seafood|hams|sausages)\b/, "item-vlees-vis"],
  [/(fruits|vegetables|salads|potatoes)\b/, "item-groenten-fruit"],
  [/(breads|breakfast|cereals|spreads|jams|honeys)\b/, "item-brood-ontbijt"],
  [/(pastas|rices|canned|legumes|flours|noodles)\b/, "item-pasta-conserven"],
  [/(beverages|waters|sodas|juices|wines|beers|coffees|teas)\b/, "item-dranken"],
  [/(snacks|chocolates|biscuits|candies|chips|crisps|confectioneries)\b/, "item-snacks"],
  [/(sauces|condiments|spices|herbs|oils|vinegars|salts)\b/, "item-kruiden"],
  [/(pet-food|dog-food|cat-food)\b/, "item-huisdier"],
];

export function categoryFromTags(tags: string[]): string | null {
  for (const [match, id] of CATEGORY_RULES) {
    if (tags.some((t) => match.test(t))) return id;
  }
  return tags.length > 0 ? "item-voeding" : null;
}

type OffProduct = {
  product_name?: string;
  product_name_nl?: string;
  product_name_fr?: string;
  brands?: string;
  quantity?: string;
  categories_tags?: string[];
};

/** Zet een antwoord van Open Food Facts om naar een voorstel, of null als er niets bruikbaars in staat. */
export function suggestionFromOff(data: unknown): ProductSuggestion | null {
  const o = (typeof data === "object" && data !== null ? data : {}) as { status?: number; product?: OffProduct };
  if (o.status !== 1 || !o.product) return null;
  const p = o.product;
  const clean = (s: string | undefined, max: number) => (s?.trim() ? s.replace(/\s+/g, " ").trim().slice(0, max) : null);

  const name = clean(p.product_name_nl, 200) ?? clean(p.product_name, 200) ?? clean(p.product_name_fr, 200);
  const brand = clean(p.brands?.split(",")[0], 100);
  if (!name && !brand) return null;

  // Open Food Facts gebruikt de categorieën voorafgegaan door een taal, bv. "en:dairies".
  const tags = Array.isArray(p.categories_tags) ? p.categories_tags.filter((t) => typeof t === "string") : [];
  return {
    name,
    brand,
    quantity_text: clean(p.quantity, 40),
    category_id: categoryFromTags(tags),
    source: "openfoodfacts",
  };
}
