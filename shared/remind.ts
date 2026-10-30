// Herinneren en herhalen: wat de app elke ochtend doet (zie worker/cron.ts).
//
// - Een datum (of een berekende datum, zoals de volgende onderhoudsbeurt) kan herinneren: `remind` dagen vooraf
//   krijgt wie het mag zien een melding. Met `yearly` elk jaar opnieuw (een verjaardag).
// - Een item kan zich herhalen (de huur, elke maand): op de volgende datum maakt de app een nieuw item zoals dit.

import { addToDate } from "./calc.ts";
import type { Attributes, FieldDef, Interval } from "./fields.ts";

/** Hoeveel dagen vooraf je kan kiezen (0 = op de dag zelf). */
export const REMIND_DAYS = [0, 1, 2, 3, 7, 14, 30] as const;

const DAY = 86_400_000;
const isoDay = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const daysBetween = (from: string, to: string) => Math.round((isoDay(to) - isoDay(from)) / DAY);

/** De eerstvolgende keer dat een datum valt: de datum zelf, of bij `yearly` dezelfde dag dit jaar of volgend jaar. */
export function nextDate(value: string, yearly: boolean, today: string): string {
  if (!yearly) return value;
  const on = (year: number) => {
    // 29 februari in een gewoon jaar: 28 februari.
    const last = new Date(Date.UTC(year, Number(value.slice(5, 7)), 0)).getUTCDate();
    return `${year}-${value.slice(5, 7)}-${String(Math.min(Number(value.slice(8, 10)), last)).padStart(2, "0")}`;
  };
  const year = Number(today.slice(0, 4));
  return on(year) >= today ? on(year) : on(year + 1);
}

export type Reminder = { key: string; label: string; date: string; days: number };

/** De herinneringen die vandaag vallen voor één item (`data` met de berekeningen al uitgerekend). */
export function remindersDue(fields: FieldDef[], data: Attributes, today: string): Reminder[] {
  return fields.flatMap((f) => {
    const value = data[f.key];
    if (f.remind === undefined || !isDate(value)) return [];
    const date = nextDate(value, Boolean(f.yearly), today);
    const days = daysBetween(today, date);
    return days === f.remind ? [{ key: f.key, label: f.label, date, days }] : [];
  });
}

/** "vandaag", "morgen" of "over 7 dagen (6/11)". */
export function whenText(days: number, date: string): string {
  const short = `${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`;
  return days === 0 ? "vandaag" : days === 1 ? `morgen (${short})` : `over ${days} dagen (${short})`;
}

/** Hoeveel keer een herhaling hooguit inhaalt (als de app een tijd niet liep): genoeg voor een maand dagelijks. */
export const MAX_CATCH_UP = 31;

/**
 * Wanneer een herhaling een nieuw item maakt, tot en met vandaag (`next`: de eerstvolgende keer), en wanneer daarna.
 * Liep de app een tijd niet, dan haalt ze in (elke gemiste maand huur), hooguit `MAX_CATCH_UP` keer.
 */
export function repeatsDue(next: string, every: Interval, today: string): { dates: string[]; next: string } {
  const dates: string[] = [];
  let on = next;
  // Telkens vanaf de eerste datum rekenen: 31 januari + 2 maanden is 31 maart, niet 28 maart.
  for (let k = 1; on <= today; k++) {
    if (dates.length < MAX_CATCH_UP) dates.push(on);
    on = addToDate(next, k * every.n, every.unit);
  }
  return { dates, next: on };
}

/** "elke maand", "om de 2 weken". */
export function everyText(every: Interval): string {
  const words = { day: ["elke dag", "dagen"], week: ["elke week", "weken"], month: ["elke maand", "maanden"], year: ["elk jaar", "jaar"] }[every.unit];
  return every.n === 1 ? words[0] : `om de ${every.n} ${words[1]}`;
}
