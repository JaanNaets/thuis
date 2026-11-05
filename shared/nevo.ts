// NEVO-online (RIVM): de Nederlandse tabel met de voedingswaarde van gewone voedingsmiddelen (een appel, gekookte rijst,
// spaghetti bolognese), als tweede databank naast Open Food Facts (merkproducten met een barcode). De gegevens staan in
// shared/nevo-data.ts (gemaakt door scripts/nevo.mjs uit het bestand van het RIVM) en worden ongewijzigd gebruikt, met
// de bron en de versie erbij (`nevoCredit`), zoals de voorwaarden van het RIVM vragen. Zonder gegevens: geen NEVO.

import { bestMatch, type ProductInfo } from "./product.ts";

/** Eén voedingsmiddel: code, naam, en per 100 g kcal, vet, verzadigd vet, koolhydraten, suikers, vezels, eiwit. */
export type NevoFood = [code: number, name: string, kcal: number | null, fat: number | null, saturated: number | null, carbs: number | null, sugars: number | null, fiber: number | null, protein: number | null];
export type NevoData = { version: string; foods: NevoFood[] };

/** De bronvermelding die het RIVM vraagt. */
export const nevoCredit = (version: string) => `NEVO-online versie ${version}, RIVM, Bilthoven`;

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

/** Een voedingsmiddel als productinfo (zoals uit Open Food Facts, met `source: "nevo"`). */
export function nevoInfo(f: NevoFood): ProductInfo {
  const [, name, kcal, fat, saturated, carbs, sugars, fiber, protein] = f;
  const values: ProductInfo["values"] = {};
  const set = (k: keyof ProductInfo["values"], v: number | null) => {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) values[k] = v;
  };
  set("kcal", kcal);
  set("fat", fat);
  set("saturated", saturated);
  set("carbs", carbs);
  set("sugars", sugars);
  set("fiber", fiber);
  set("protein", protein);
  return { code: null, name, brand: null, quantity: null, values, scans: 0, source: "nevo" };
}

/**
 * Het voedingsmiddel dat past bij een naam ("appel", "witte rijst gekookt"): eerst wat een woord van de naam bevat,
 * dan de beste match (zie `bestMatch`: bijna alle woorden moeten erin staan; liever niets dan iets verkeerds).
 */
export function nevoMatch(data: NevoData, name: string): ProductInfo | null {
  const words = fold(name)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
  if (!words.length || !data.foods.length) return null;
  const candidates = data.foods.filter((f) => f[2] !== null && words.some((w) => fold(f[1]).split(/[^a-z0-9]+/).includes(w))).slice(0, 400);
  return bestMatch(candidates.map(nevoInfo), { name });
}
