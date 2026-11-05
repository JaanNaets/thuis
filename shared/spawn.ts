// Meteen ook (`spawn` op een ja/nee-veld): een nieuw item met dat veld aan maakt ook een item in een andere lijst, de
// eerste van `spawn` waarin wie bewaart mag toevoegen. Zo komt een gekocht broodje met Gegeten aan ook in je eigen
// Eten (Jana's Eten ziet jij niet, dus voor jou is dat het jouwe). Wat er meegaat, volgt uit de velden zelf:
//
// - de naam, en elk veld met dezelfde sleutel en soort (de datum);
// - het gekozen product: een verwijzing in de andere lijst naar dezelfde lijst krijgt hetzelfde item, en met `copy`
//   nemen we zijn waarden over (de voedingswaarde per 100 g), zoals het formulier doet;
// - hoeveel: telt die verwijzing ergens bij of af (`adjust.by`), dan krijgt dat getal hoeveel er gekocht werd,
//   omgerekend naar de eenheid daar (1 stuk yoghurt van 125 g = 125 g). Zo trekt het opeten af wat het kopen bijtelde.
//
// Daarna gaat alles door het gewone bewaren (`prepareData`, rechten, verwijzingen die tellen). Enkel bij een nieuw item.

import type { Attributes, FieldDef } from "./fields.ts";
import { refLists } from "./fields.ts";
import { convert, converts, measureOf } from "./units.ts";

/** Zoveel lijsten hoogstens bij Meteen ook. */
export const MAX_SPAWN = 10;

/** Een gekozen product: zijn lijst, zijn velden en waarden (zoals de bewaarder ze ziet). */
export type SpawnProduct = { id: string; type_id: string; fields: FieldDef[]; data: Attributes };

/** Welke ja/nee-velden van deze lijst nu een item laten maken (aan, met lijsten). */
export const spawnFields = (fields: FieldDef[], data: Attributes) => fields.filter((f) => f.type === "bool" && f.spawn?.length && data[f.key] === true);

/** Hetzelfde veld in twee lijsten: dezelfde sleutel en soort (geen berekening, geen ja/nee dat zelf iets maakt). */
const same = (a: FieldDef, b: FieldDef) => a.key === b.key && a.type === b.type && a.type !== "calc" && !b.spawn;

/**
 * Wat het nieuwe item in de andere lijst krijgt. `products`: de items waarnaar deze lijst verwijst (op id), om de
 * verwijzing, hun waarden en hun eenheid over te nemen.
 */
export function spawnData(source: { fields: FieldDef[]; data: Attributes; name: string }, target: FieldDef[], products: Map<string, SpawnProduct>): { name: string; data: Attributes } {
  const data: Attributes = {};
  for (const t of target) {
    const s = source.fields.find((f) => same(f, t));
    const v = s ? source.data[s.key] : undefined;
    if (v !== undefined && v !== null && t.type !== "item" && t.type !== "items" && t.type !== "amounts") data[t.key] = v;
  }
  // Het gekozen product: de eerste verwijzing hier met een item dat de andere lijst ook kent.
  for (const s of source.fields) {
    if (s.type !== "item" || typeof source.data[s.key] !== "string") continue;
    const product = products.get(source.data[s.key] as string);
    const t = product && target.find((f) => f.type === "item" && !(f.key in data) && refLists(f).includes(product.type_id));
    if (!product || !t) continue;
    data[t.key] = product.id;
    if (t.copy)
      for (const f of target) {
        const p = product.fields.find((x) => x.key === f.key && x.type === f.type && x.type !== "calc");
        const v = p ? product.data[p.key] : undefined;
        if (p && !(f.key in data) && v !== undefined && v !== null) data[f.key] = v;
      }
    // Hoeveel: wat gekocht werd, in de eenheid waarin de andere lijst telt.
    const by = s.adjust?.by;
    const into = t.adjust?.by;
    const amount = by ? source.data[by] : undefined;
    if (into && typeof amount === "number" && amount > 0 && !(into in data)) {
      const unit = s.adjust?.unit_by && typeof source.data[s.adjust.unit_by] === "string" ? (source.data[s.adjust.unit_by] as string) : s.adjust?.unit;
      const counter = product.fields.find((f) => f.key === t.adjust?.field);
      const measure = counter ? measureOf(counter, product.data) : { unit: null };
      // Eerst naar de eenheid van het product, dan naar die van de andere lijst (g bij Eten).
      const inProduct = unit ? convert(amount, unit, measure) : amount;
      const goal = t.adjust?.unit;
      // Een broodje (per stuk, zonder inhoud per stuk) is niet in gram om te rekenen: dan blijft Hoeveel leeg.
      if (!goal || converts(measure.unit, { unit: goal, piece: measure.piece }))
        data[into] = Math.round((goal ? convert(inProduct, measure.unit, { unit: goal, piece: measure.piece }) : inProduct) * 1000) / 1000;
    }
    break;
  }
  return { name: source.name, data };
}
