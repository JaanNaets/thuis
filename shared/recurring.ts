// Terugkerende kosten: wanneer valt de volgende keer?
// Elke keer wordt berekend vanaf de startdatum, zodat de dag niet verschuift (31 jan → 28 feb → 31 maa).

import type { Frequency } from "./types";

const MONTHS: Record<Exclude<Frequency, "weekly">, number> = { monthly: 1, quarterly: 3, yearly: 12 };

function parse(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

function format(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** De k-de keer (k = 0 is de startdatum). */
export function occurrence(start: string, frequency: Frequency, k: number): string {
  const [y, m, d] = parse(start);
  if (frequency === "weekly") {
    const date = new Date(Date.UTC(y, m - 1, d + 7 * k));
    return date.toISOString().slice(0, 10);
  }
  const months = m - 1 + MONTHS[frequency] * k;
  const year = y + Math.floor(months / 12);
  const month = (months % 12) + 1;
  return format(year, month, Math.min(d, daysInMonth(year, month)));
}

/** De eerste keer na `after` (strikt later). */
export function nextOccurrence(start: string, frequency: Frequency, after: string): string {
  if (start > after) return start;
  // Ruwe schatting van k, daarna bijstellen: zo blijft het snel, ook na jaren.
  const [ay, am, ad] = parse(after);
  const [sy, sm, sd] = parse(start);
  const days = (Date.UTC(ay, am - 1, ad) - Date.UTC(sy, sm - 1, sd)) / 86_400_000;
  const perStep = frequency === "weekly" ? 7 : MONTHS[frequency] * 30.44;
  let k = Math.max(0, Math.floor(days / perStep) - 1);
  while (occurrence(start, frequency, k) <= after) k++;
  return occurrence(start, frequency, k);
}

/**
 * Alle keren die nu ingeboekt moeten worden: vanaf `next` tot en met `today` (en niet na `end`).
 * Hoogstens `limit` keer, zodat een vergeten kost van jaren geleden niet alles overspoelt.
 */
export function dueDates(start: string, frequency: Frequency, next: string, today: string, end: string | null, limit = 60): string[] {
  const dates: string[] = [];
  let date = next;
  while (date <= today && (!end || date <= end) && dates.length < limit) {
    dates.push(date);
    date = nextOccurrence(start, frequency, date);
  }
  return dates;
}
