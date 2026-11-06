// Eenheden: een voorraad telt in een eenheid (kg, l, stuk, zak, …), en wat je koopt, eet of gebruikt mag in een
// andere eenheid staan: 500 g aardappelen van een voorraad in kg, 2 zakken pellets van 15 kg, 30 g Nutella van een
// voorraad in potten van 400 g. `convert` rekent om naar de eenheid van het item dat telt.
//
// Regels: gewicht en inhoud rekenen om (g ↔ kg, ml ↔ cl ↔ l; tussen gewicht en inhoud telt 1 ml als 1 g, zoals in
// de keuken). Een stuk (stuk, zak, pot, fles, …) is een stuk; met de inhoud per stuk (in g of ml) wordt gewicht een
// aantal stuks. Een verpakking ("zak" bij een voorraad in kg) is de inhoud per verpakking. Lukt niets (gram van iets
// dat je per stuk telt zonder inhoud per stuk), dan telt het als één stuk: liever iets dan niets.

/** Gewicht en inhoud, in gram of milliliter. */
const BASE = { g: 1, kg: 1000, mg: 0.001, ml: 1, cl: 10, dl: 100, l: 1000 } as const;
type BaseUnit = keyof typeof BASE;

/** Eenheden om uit te kiezen (bij een ingrediënt of een hoeveelheid). */
export const UNITS = ["g", "kg", "ml", "cl", "l", "stuk"] as const;

/** Hoe een item telt: zijn eenheid, de inhoud van één stuk (g of ml) en van één verpakking (in zijn eenheid). */
export type Measure = { unit: string | null; piece?: number | null; pack?: number | null; pack_name?: string | null };

const ALIASES: Record<string, string> = {
  gr: "g",
  gram: "g",
  grammen: "g",
  kilo: "kg",
  kilogram: "kg",
  kgs: "kg",
  liter: "l",
  liters: "l",
  lt: "l",
  milliliter: "ml",
  centiliter: "cl",
  st: "stuk",
  stuks: "stuk",
  stk: "stuk",
  x: "stuk",
};

/** Een eenheid zoals de app ze kent: "Kilo" → "kg", "stuks" → "stuk", "zak" blijft "zak". */
export function normalizeUnit(text: string | null | undefined): string | null {
  const t = (text ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!t) return null;
  return ALIASES[t] ?? t;
}

const baseOf = (unit: string | null): number | null => (unit && Object.hasOwn(BASE, unit) ? BASE[unit as BaseUnit] : null);

/**
 * `amount` in eenheid `from` omrekenen naar de eenheid van `to`. `from` leeg = al in de eenheid van het item. Een
 * verpakking (`from` = de naam van de verpakking, of "verpakking") telt als `pack` eenheden.
 */
export function convert(amount: number, from: string | null | undefined, to: Measure): number {
  const source = normalizeUnit(from);
  const target = normalizeUnit(to.unit);
  if (!source || source === target) return amount;
  const pack = to.pack && to.pack > 0 ? to.pack : null;
  if (pack && (source === "verpakking" || source === normalizeUnit(to.pack_name))) return amount * pack;
  const a = baseOf(source);
  const b = baseOf(target);
  // Een verpakking zonder naam (pellets per 15 kg): een zak, doos of pak is dan die verpakking.
  if (pack && !to.pack_name && a === null && source !== "stuk" && b !== null) return amount * pack;
  // Gewicht of inhoud naar gewicht of inhoud.
  if (a !== null && b !== null) return (amount * a) / b;
  const piece = to.piece && to.piece > 0 ? to.piece : null;
  // Gewicht of inhoud van iets dat je per stuk (of per zak, pot, …) telt: met de inhoud per stuk, anders één stuk.
  if (a !== null && b === null) return piece ? (amount * a) / piece : 1;
  // Stuks van iets dat in gewicht of inhoud telt: met de inhoud per stuk, anders zoals het staat.
  if (a === null && b !== null) return piece ? (amount * piece) / b : amount;
  // Stuk naar stuk (stuk, zak, pot, …): één is één.
  return amount;
}

/**
 * Kan `amount` in `from` echt omgerekend worden naar `to`? Stuks (stuk, zak, pot, …) naar gewicht of inhoud enkel met
 * de inhoud per stuk (`convert` geeft dan het getal zoals het is, "liever iets dan niets"; dit zegt of dat klopt).
 */
export function converts(from: string | null | undefined, to: Measure): boolean {
  const source = normalizeUnit(from);
  const target = normalizeUnit(to.unit);
  if (!source || !target || source === target) return true;
  if (to.pack && to.pack > 0 && (source === "verpakking" || source === normalizeUnit(to.pack_name) || (!to.pack_name && source !== "stuk"))) return true;
  return !(baseOf(source) === null && baseOf(target) !== null && !(to.piece && to.piece > 0));
}

/** Afronden op drie cijfers na de komma (zo blijft 0,1 + 0,2 gewoon 0,3). */
export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** "4,5 kg", "3 stuks" (meervoud enkel voor stuk), "2 zak". */
export function formatAmount(amount: number, unit: string | null | undefined): string {
  const n = String(round3(amount)).replace(".", ",");
  const u = normalizeUnit(unit);
  if (!u) return n;
  return `${n} ${u === "stuk" && amount !== 1 ? "stuks" : u}`;
}

/**
 * Een maat op een kasticket of etiket: "5KG", "500 G", "1,5L", "6X33CL" (6 stuks van 33 cl), "2 x 1 l". Geeft de
 * hoeveelheid per stuk, het aantal stuks in de verpakking en de eenheid; null als er geen maat in staat.
 */
export function parseSize(text: string): { amount: number; unit: string; count: number } | null {
  const t = text.toLowerCase().replace(/,/g, ".");
  const multi = t.match(/(\d+)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(kg|g|gr|mg|ml|cl|dl|l|lt|liter)\b/);
  if (multi) return { count: Number(multi[1]), amount: Number(multi[2]), unit: normalizeUnit(multi[3])! };
  const one = t.match(/(\d+(?:\.\d+)?)\s*(kg|g|gr|mg|ml|cl|dl|l|lt|liter|kilo)\b/);
  if (one) return { count: 1, amount: Number(one[1]), unit: normalizeUnit(one[2])! };
  return null;
}

/** Hoe een item telt (de eenheid en de inhoud per stuk en per verpakking), uit zijn waarden en het veld dat telt. */
export function measureOf(
  def: { unit?: string; measure?: { unit?: string; piece?: string; pack?: string; pack_name?: string } },
  data: Record<string, unknown>,
): Measure {
  const m = def.measure;
  const text = (k?: string) => (k && typeof data[k] === "string" && (data[k] as string).trim() ? (data[k] as string) : null);
  const num = (k?: string) => (k && typeof data[k] === "number" && (data[k] as number) > 0 ? (data[k] as number) : null);
  return { unit: normalizeUnit(text(m?.unit) ?? def.unit ?? null), piece: num(m?.piece), pack: num(m?.pack), pack_name: text(m?.pack_name) };
}

/**
 * Hoeveel een lijn van een kasticket bijtelt, in de eenheid van het product (`measure`; null = een nieuw product):
 * de maat op de lijn omgerekend ("AARDAPPELEN 5KG" bij aardappelen in kg: 5), zonder maat een verpakking per stuk
 * (of één). Bij een nieuw product met een maat: in die eenheid, met wat er in één verpakking zit.
 */
export function receiptAmount(quantity: number, size: string | null, name: string, measure: Measure | null): { amount: number; unit: string | null; pack?: number } {
  const found = (size ? parseSize(size) : null) ?? parseSize(name);
  if (measure) {
    const amount = found ? quantity * found.count * convert(found.amount, found.unit, measure) : quantity * (measure.pack ?? 1);
    return { amount: round3(amount), unit: measure.unit };
  }
  if (!found) return { amount: quantity, unit: null };
  return { amount: round3(quantity * found.count * found.amount), unit: found.unit, pack: round3(found.count * found.amount) };
}
