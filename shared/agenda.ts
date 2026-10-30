// Agenda: wat op een dag valt. Generiek: een datumveld (ook een berekende datum, of een periode zoals een reis) met
// "In de agenda" (`agenda` op het veld) komt in de agenda van al je projecten; elke lijst met een datum kan je ook
// zelf als agenda bekijken (een weergave, zie shared/views.ts). Een datum met "Elk jaar" (een verjaardag) staat er
// elk jaar.

import type { FieldDef, FieldValue } from "./fields.ts";
import { nextDate } from "./remind.ts";

/** Hoeveel dagen de agenda hooguit in één keer ophaalt (een maand met de weken errond). */
export const MAX_AGENDA_DAYS = 62;

export type AgendaEntry = {
  item_id: string;
  name: string;
  project_id: string;
  type_id: string;
  /** Het veld (bv. "Volgende keer"), om te tonen waarom het hier staat. */
  label: string;
  start: string;
  /** Bij een periode: de laatste dag (binnen wat gevraagd is). */
  end?: string;
};

export type Agenda = {
  entries: AgendaEntry[];
  projects: { id: string; name: string; color: string | null }[];
  types: { id: string; name: string; plural: string; icon: string | null }[];
};

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const DAY = 86_400_000;
const toDay = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
export const daysApart = (from: string, to: string) => Math.round((toDay(to) - toDay(from)) / DAY);

/** Kan dit veld in de agenda: een datum, een periode van datums, of een berekening met een datum als uitkomst. */
export const canAgenda = (def: Pick<FieldDef, "type" | "result">) => def.type === "date" || def.type === "date_range" || (def.type === "calc" && def.result === "date");

/** Wanneer een waarde valt binnen van–tot (beide inbegrepen): niets, één dag, of een stuk van een periode. */
export function occurrences(def: FieldDef, value: FieldValue | undefined, from: string, to: string): { start: string; end?: string }[] {
  if (def.type === "date_range") {
    if (!Array.isArray(value)) return [];
    const [a, b] = value as (string | null)[];
    const start = isDate(a) ? a : isDate(b) ? b : null;
    const end = isDate(b) ? b : start;
    if (!start || !end || end < from || start > to) return [];
    const s = start < from ? from : start;
    const e = end > to ? to : end;
    return s === e ? [{ start: s }] : [{ start: s, end: e }];
  }
  if (!isDate(value)) return [];
  if (def.yearly) {
    // Elk jaar: de eerstvolgende keer vanaf `from` (en het jaar erna, als van–tot over nieuwjaar gaat).
    const out: { start: string }[] = [];
    for (let day = from, n = 0; n < 2; n++) {
      const next = nextDate(value, true, day);
      if (next > to) break;
      out.push({ start: next });
      day = `${Number(next.slice(0, 4)) + 1}-01-01`;
    }
    return out;
  }
  return value >= from && value <= to ? [{ start: value }] : [];
}

/** De dagen van de maandkalender rond een maand: van de maandag voor de eerste tot de zondag na de laatste. */
export function monthGrid(month: string): string[] {
  const first = `${month.slice(0, 7)}-01`;
  const start = toDay(first) - ((new Date(toDay(first)).getUTCDay() + 6) % 7) * DAY;
  const next = new Date(toDay(first));
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = next.getTime() - DAY;
  const end = last + (6 - ((new Date(last).getUTCDay() + 6) % 7)) * DAY;
  const days: string[] = [];
  for (let d = start; d <= end; d += DAY) days.push(new Date(d).toISOString().slice(0, 10));
  return days;
}

/** Een maand verder of terug ("2026-10" + 1 = "2026-11"). */
export function shiftMonth(month: string, by: number): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}
