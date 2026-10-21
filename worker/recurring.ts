import { dueDates, nextOccurrence } from "../shared/recurring";
import { checkPayments, computeShares, type PaymentInput, type SplitInput } from "../shared/split";
import type { Frequency } from "../shared/types";
import { splitStatements } from "./routes/purchases";

type Row = {
  id: string;
  household_id: string;
  project_id: string | null;
  description: string;
  amount_cents: number;
  category_id: string | null;
  vendor_id: string | null;
  frequency: Frequency;
  start_on: string;
  next_on: string;
  end_on: string | null;
  payments: string;
  split: string;
  notes: string | null;
  created_by: string;
};

/** Vandaag in België (de dag wisselt om middernacht hier, niet in UTC). */
export function todayInBelgium(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(now);
}

/**
 * Boekt terugkerende kosten in die vervallen zijn: één uitgave per keer, met dezelfde betalers en verdeling.
 * Draait elke nacht (cron) en ook even vóór iemand de uitgaven bekijkt. Twee keer tegelijk is geen probleem:
 * per kost en datum kan er maar één uitgave bestaan (unieke index).
 */
export async function materializeRecurring(db: D1Database, household?: string, today = todayInBelgium()): Promise<number> {
  const { results } = await (
    household
      ? db.prepare("SELECT * FROM recurring_expenses WHERE active = 1 AND next_on <= ? AND household_id = ?").bind(today, household)
      : db.prepare("SELECT * FROM recurring_expenses WHERE active = 1 AND next_on <= ?").bind(today)
  ).all<Row>();

  let created = 0;
  for (const r of results) {
    const payments = JSON.parse(r.payments) as PaymentInput[];
    const split = JSON.parse(r.split) as SplitInput;
    const payerIds = payments.flatMap((p) => (p.member_id ? [p.member_id] : []));
    const computed = computeShares(r.amount_cents, split, payerIds);
    const dates = dueDates(r.start_on, r.frequency, r.next_on, today, r.end_on);

    // Kan het niet meer verdeeld worden (bv. iemand is weg), dan pauzeren we de kost in plaats van iets fout in te boeken.
    if ("error" in computed || checkPayments(r.amount_cents, payments)) {
      await db.prepare("UPDATE recurring_expenses SET active = 0 WHERE id = ?").bind(r.id).run();
      continue;
    }

    for (const date of dates) {
      const id = crypto.randomUUID();
      try {
        await db.batch([
          db
            .prepare(
              `INSERT INTO purchases
                 (id, household_id, project_id, description, vendor_id, purchased_on, amount_cents, category_id,
                  split_mode, recurring_id, notes, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(id, r.household_id, r.project_id, r.description, r.vendor_id, date, r.amount_cents, r.category_id, split.mode, r.id, r.notes, r.created_by),
          ...splitStatements(db, id, { payments, shares: computed.shares, lines: split.lines ?? [], splitMode: split.mode }),
        ]);
        created++;
      } catch (err) {
        // Al ingeboekt door een andere aanvraag: niets aan de hand.
        if (!(err instanceof Error && err.message.includes("UNIQUE constraint failed"))) throw err;
      }
    }

    const last = dates.at(-1) ?? r.next_on;
    const next = nextOccurrence(r.start_on, r.frequency, last);
    const ended = r.end_on !== null && next > r.end_on;
    await db
      .prepare("UPDATE recurring_expenses SET next_on = ?, active = ? WHERE id = ? AND next_on = ?")
      .bind(next, ended ? 0 : 1, r.id, r.next_on)
      .run();
  }
  return created;
}
