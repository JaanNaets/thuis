// NEVO-online (RIVM): de Nederlandse tabel met de voedingswaarde van gewone voedingsmiddelen (een appel, gekookte rijst,
// spaghetti bolognese), als tweede databank naast Open Food Facts (merkproducten met een barcode). De gegevens staan in
// D1 (`nevo_foods`, geladen met scripts/nevo.mjs uit het bestand van het RIVM; niet in git, want het repo is publiek) en
// worden ongewijzigd gebruikt, met de bron en de versie erbij (`nevoCredit`), zoals de voorwaarden van het RIVM vragen.
// Zonder gegevens: geen NEVO.

import type { ProductInfo } from "./product.ts";

/**
 * Eén voedingsmiddel: code, naam, per 100 g kcal, vet, verzadigd vet, koolhydraten, suikers, vezels, eiwit, en de
 * synoniemen van het RIVM ("Patat/friet bereid gem"), om op te zoeken.
 */
export type NevoFood = [
  code: number,
  name: string,
  kcal: number | null,
  fat: number | null,
  saturated: number | null,
  carbs: number | null,
  sugars: number | null,
  fiber: number | null,
  protein: number | null,
  synonym?: string | null,
];
export type NevoData = { version: string; foods: NevoFood[] };

/** De bronvermelding die het RIVM vraagt. */
export const nevoCredit = (version: string) => `NEVO-online versie ${version}, RIVM, Bilthoven`;

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Hetzelfde woord, ook in het meervoud of verbogen ("appel" en "appels", "wit" en "witte", "vol" en "volle"), maar
 * geen verkleinwoord (een broodje is geen brood).
 */
function same(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.length - short.length <= 2 && long.startsWith(short) && !long.endsWith("je");
}

/** Kleine woorden die niets zeggen over wat het is (m = met, z = zonder, v = van), en hoe het bereid is. */
const FILLER = new Set(["m", "z", "v", "en", "met", "zonder", "van", "ed", "e", "d", "gem"]);
const PREPARED = new Set(["bereid", "rauw", "gekookt", "gebakken", "onbereid", "vers", "gem"]);

/**
 * De namen van een voedingsmiddel om op te zoeken: de naam en elk synoniem. "Patat/friet bereid gem" is "Patat bereid
 * gem" of "friet bereid gem": een los woord voor een schuine streep deelt de rest van het laatste stuk.
 */
function namesOf(food: NevoFood): string[][] {
  const out = [words(food[1])];
  const parts = (food[9] ?? "").split("/").map((p) => p.trim()).filter(Boolean);
  const lastRest = parts.length ? words(parts[parts.length - 1]).slice(1) : [];
  for (const part of parts) {
    const w = words(part);
    out.push(w.length === 1 && part !== parts[parts.length - 1] ? [...w, ...lastRest] : w);
  }
  return out.filter((n) => n.length);
}
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
 * Het voedingsmiddel dat past bij een naam ("appel", "volle yoghurt", "friet", "volkoren brood"). NEVO zet het
 * hoofdwoord vooraan ("Melk koffie-" is koffiemelk, "Taart appel-" is appeltaart): dat hoofdwoord (van de naam of van
 * een synoniem) moet een woord van de vraag zijn, of er op eindigen ("Tarwebrood" voor brood, minder goed), en elk
 * woord van de vraag moet erin staan. Dan wint de naam met het minst extra woorden (bereid, rauw tellen minder; "gem" =
 * gemiddeld, liefst), de naam zelf voor een synoniem, en bij gelijkspel de laagste code. Liever niets dan iets
 * verkeerds: "boterham" is geen boterhamworst.
 */
export function nevoMatch(data: NevoData, name: string): ProductInfo | null {
  const asked = words(name).filter((w) => w.length >= 2);
  if (!asked.length || !data.foods.length) return null;
  const joined = asked.slice(1).map((w, i) => asked[i] + w); // "volkoren brood" → volkorenbrood
  const hit = (w: string, t: string) => same(w, t) || (w.length >= 4 && t.includes(w));
  let best: { food: NevoFood; score: number } | null = null;
  for (const food of data.foods) {
    if (food[2] === null) continue;
    const names = namesOf(food);
    const all = names.flat();
    if (!asked.every((w) => all.some((t) => hit(w, t)))) continue;
    let score = -Infinity;
    names.forEach((n, i) => {
      const head = n[0];
      const exact = asked.some((w) => same(w, head)) || joined.includes(head);
      const compound = !exact && asked.some((w) => w.length >= 4 && head.endsWith(w));
      if (!exact && !compound) return;
      // Wat je als één woord typte of als twee ("volkoren brood" = Volkorenbrood) weegt zwaar; een synoniem minder dan de naam.
      const base = joined.includes(head) ? (i === 0 ? 100 : 90) : exact ? (i === 0 ? 100 : 70) : i === 0 ? 50 : 40;
      const extra = n
        .slice(1)
        .filter((t) => !asked.some((w) => hit(w, t)))
        .reduce((sum, t) => sum + (FILLER.has(t) ? 0 : PREPARED.has(t) ? 2 : 5), 0) +
        // Een woord dat het gevraagde enkel bevat ("mueslibrood" voor brood) is iets anders.
        5 * n.slice(1).filter((t) => asked.some((w) => !same(w, t) && w.length >= 4 && t.includes(w)) && !asked.some((w) => same(w, t))).length;
      score = Math.max(score, base - extra + (n.includes("gem") ? 3 : 0));
    });
    if (score === -Infinity) continue;
    if (!best || score > best.score || (score === best.score && food[0] < best.food[0])) best = { food, score };
  }
  return best ? nevoInfo(best.food) : null;
}
