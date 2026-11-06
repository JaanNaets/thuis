// Een kasticket lezen (✨, POST /lists/:id/events/read-receipt): de AI geeft de winkel, de datum, het totaal en de
// lijnen zoals op het ticket; de code koppelt elke lijn aan een ding dat de lezer ziet (op naam, of op een naam die
// eerder op een ticket stond: een tekstveld met `aliases`), en rekent de maat op de lijn om naar de eenheid van dat
// ding (5 kg aardappelen in een voorraad in kg). Het formulier maakt er één aankoop van, met een lijn per product.

import { normalizeUnit, parseSize, receiptAmount, round3, type Measure } from "./units.ts";

export const MAX_LINES = 80;

/** Een lijn zoals de AI ze geeft. */
export type RawLine = { name: string; quantity: number; size: string | null; price: number | null };

/** Een ding om aan te koppelen, met de namen die eerder op een ticket stonden. */
export type Candidate = { id: string; name: string; aliases: string[]; measure: Measure | null };

/** Een gelezen lijn: wat op het ticket stond, het ding (of niets), hoeveel en de prijs in cent. */
export type ReceiptLine = { name: string; thing: string | null; amount: number; unit: string | null; price: number | null };

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Het ding met deze naam: dezelfde, de langste die erin staat, of de kortste waar ze in staat. */
export function matchName(candidates: { id: string; name: string }[], text: string): string | null {
  const t = plain(text);
  if (t.length < 2) return null;
  const named = candidates.map((c) => ({ id: c.id, n: plain(c.name) })).filter((c) => c.n.length >= 2);
  const exact = named.find((c) => c.n === t);
  if (exact) return exact.id;
  const words = ` ${t} `;
  const inText = named.filter((c) => c.n.length >= 3 && words.includes(` ${c.n} `)).sort((a, b) => b.n.length - a.n.length)[0];
  if (inText) return inText.id;
  const inName = named.filter((c) => t.length >= 3 && ` ${c.n} `.includes(` ${t} `)).sort((a, b) => a.n.length - b.n.length)[0];
  return inName?.id ?? null;
}

/** Een naam die eerder op een ticket stond, wint van een gelijkende naam. */
export function matchCandidate(candidates: Candidate[], text: string): Candidate | null {
  const t = plain(text);
  const byAlias = candidates.find((c) => c.aliases.some((a) => plain(a) === t));
  if (byAlias) return byAlias;
  const id = matchName(candidates, text);
  return id ? (candidates.find((c) => c.id === id) ?? null) : null;
}

/** De namen in een tekstveld met namen van tickets (één per regel, of met | of ; ertussen). */
export const aliasesOf = (value: unknown): string[] =>
  typeof value === "string"
    ? value
        .split(/[\n|;]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

/** Een naam erbij in dat veld (als hij er nog niet in staat); null = niets te veranderen. */
export function withAlias(value: unknown, name: string): string | null {
  const have = aliasesOf(value);
  const n = name.trim().slice(0, 80);
  if (!n || have.some((a) => plain(a) === plain(n))) return null;
  return [...have, n].join(" | ").slice(0, 500);
}

/** Euro (zoals de AI het geeft) naar cent; niets of iets vreemds = null. */
export function cents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100_000) return null;
  return Math.round(value * 100);
}

/** Een echte datum (JJJJ-MM-DD), niet na `today`; anders null. */
export function validDate(value: unknown, today: string): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  return value <= today ? value : null;
}

/** "AARDAPPELEN 5KG" → "Aardappelen", "COLA 6X33CL" → "Cola"; gewone tekst blijft zoals ze is (behalve de maat). */
export function niceName(text: string): string {
  const t =
    text
      .trim()
      .replace(/\s*\b\d+(?:[.,]\d+)?\s*(?:[x×*]\s*\d+(?:[.,]\d+)?\s*)?(?:kg|gr|g|mg|ml|cl|dl|lt|l|liter|kilo)\b\.?/gi, "")
      .replace(/\s+/g, " ")
      .trim() || text.trim();
  if (!/[A-Z]/.test(t) || t !== t.toUpperCase()) return t;
  const lower = t.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * De lijnen van de AI, nagekeken en gekoppeld. Een lijn met een ding staat in de eenheid van dat ding (5 kg, of één
 * verpakking als er geen maat op staat); zonder ding de maat op het ticket (2 × 1 l = 2 l), anders stuks.
 */
export function readLines(raw: unknown, candidates: Candidate[]): ReceiptLine[] {
  const out: ReceiptLine[] = [];
  for (const r of Array.isArray(raw) ? raw.slice(0, MAX_LINES) : []) {
    const l = (r ?? {}) as Record<string, unknown>;
    const name = typeof l.name === "string" ? l.name.trim().slice(0, 120) : "";
    if (!name) continue;
    const quantity = typeof l.quantity === "number" && l.quantity > 0 ? Math.min(99, Math.round(l.quantity)) || 1 : 1;
    const size = typeof l.size === "string" && l.size.trim() ? l.size.trim().slice(0, 40) : null;
    const thing = matchCandidate(candidates, name);
    const measured = thing?.measure?.unit ? receiptAmount(quantity, size, name, thing.measure) : null;
    if (measured) {
      out.push({ name, thing: thing!.id, amount: measured.amount, unit: measured.unit, price: cents(l.price) });
      continue;
    }
    const found = (size ? parseSize(size) : null) ?? parseSize(name);
    // Centiliter en deciliter als liter (6 × 33 cl = 1,98 l).
    const unit = found ? normalizeUnit(found.unit) : null;
    const toLiter = unit === "cl" ? 0.01 : unit === "dl" ? 0.1 : 1;
    out.push({
      name,
      thing: thing?.id ?? null,
      amount: found ? round3(quantity * found.count * found.amount * toLiter) : quantity,
      unit: toLiter !== 1 ? "l" : unit,
      price: cents(l.price),
    });
  }
  return out;
}
