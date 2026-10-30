// Elke ochtend (de cron in wrangler.jsonc): eerst de herhalingen (de huur van deze maand), dan de herinneringen (de
// verwarming over een week, een verjaardag morgen) als melding naar wie ze mag zien en meldingen aanzette.

import { fieldAccess, typeAccess, type Rights } from "../shared/access";
import { computeLocal, fieldDeps } from "../shared/calc";
import type { Attributes } from "../shared/fields";
import { remindersDue, repeatsDue, whenText, type Reminder } from "../shared/remind";
import { accessibleProjects, toItemType, type TypeRow } from "./context";
import { notify } from "./push";
import { createRepeated } from "./routes/items";
import { brusselsToday } from "./today";
import { ForbiddenError } from "./validate";

/** Hoeveel meldingen iemand per ochtend hooguit krijgt; de rest komt samen in één. */
const MAX_PER_PERSON = 5;

export async function daily(db: D1Database, today = brusselsToday()): Promise<void> {
  await runRepeats(db, today).catch((err) => console.error("Herhalen lukte niet", err));
  await sendReminders(db, today).catch((err) => console.error("Herinneren lukte niet", err));
}

type RepeatRow = { item_id: string; every_n: number; every_unit: "day" | "week" | "month" | "year"; next_on: string; created_by: string; archived: number };

export async function runRepeats(db: D1Database, today: string): Promise<number> {
  const { results } = await db
    .prepare("SELECT r.*, i.archived FROM repeats r JOIN items i ON i.id = r.item_id WHERE r.next_on <= ?")
    .bind(today)
    .all<RepeatRow>();
  let made = 0;
  for (const r of results) {
    const { dates, next } = repeatsDue(r.next_on, { n: r.every_n, unit: r.every_unit }, today);
    try {
      // Een gearchiveerd item herhaalt niet (maar loopt wel mee, zodat het niet alles inhaalt als je het terugzet).
      if (!r.archived) for (const day of dates) (await createRepeated(db, r.created_by, r.item_id, day), made++);
      await db.prepare("UPDATE repeats SET next_on = ? WHERE item_id = ?").bind(next, r.item_id).run();
    } catch (err) {
      // Mag wie het instelde hier niets meer toevoegen: dan stopt de herhaling. Anders morgen opnieuw.
      if (err instanceof ForbiddenError) await db.prepare("DELETE FROM repeats WHERE item_id = ?").bind(r.item_id).run();
      else console.error("Herhaling mislukt", r.item_id, err);
    }
  }
  return made;
}

type Due = { item: { id: string; name: string }; reminder: Reminder };

export async function sendReminders(db: D1Database, today: string): Promise<number> {
  const { results: people } = await db.prepare("SELECT DISTINCT person_id FROM push_subscriptions").all<{ person_id: string }>();
  if (!people.length) return 0;
  const { results: typeRows } = await db.prepare(`SELECT * FROM item_types WHERE fields LIKE '%"remind"%'`).all<TypeRow>();
  if (!typeRows.length) return 0;

  // Per persoon zijn rechten in elk project (zoals in de app).
  const rights = new Map<string, Map<string, Rights>>();
  for (const { person_id } of people) rights.set(person_id, new Map((await accessibleProjects(db, person_id)).map((n) => [n.id, n.rights])));

  const due = new Map<string, Due[]>();
  for (const row of typeRows) {
    const type = toItemType(row);
    if (!type.fields.some((f) => f.remind !== undefined)) continue;
    const { results: items } = await db
      .prepare("SELECT id, project_id, name, data FROM items WHERE type_id = ? AND archived = 0")
      .bind(type.id)
      .all<{ id: string; project_id: string; name: string; data: string }>();
    for (const item of items) {
      let data: Attributes;
      try {
        data = computeLocal(type.fields, JSON.parse(item.data) as Attributes, today);
      } catch {
        continue;
      }
      for (const reminder of remindersDue(type.fields, data, today)) {
        // Enkel wie het item en de datum mag zien (en alles waarvan een berekende datum afhangt).
        const deps = fieldDeps(type.fields, reminder.key);
        for (const [person, projects] of rights) {
          const r = projects.get(item.project_id);
          if (!r || typeAccess(r, type.id) === "none" || deps.some((k) => fieldAccess(r, type.id, k) === "none")) continue;
          due.set(person, [...(due.get(person) ?? []), { item, reminder }]);
        }
      }
    }
  }

  let sent = 0;
  for (const [person, list] of due) {
    const shown = list.length > MAX_PER_PERSON ? list.slice(0, MAX_PER_PERSON - 1) : list;
    for (const { item, reminder } of shown)
      sent += await notify(db, person, {
        title: item.name,
        body: `${reminder.label}: ${whenText(reminder.days, reminder.date)}`,
        url: `/items/${item.id}`,
        tag: `${item.id}:${reminder.key}:${reminder.date}`,
      });
    if (shown.length < list.length) {
      const rest = list.slice(shown.length);
      sent += await notify(db, person, {
        title: `Nog ${rest.length} herinneringen`,
        body: rest.map((d) => d.item.name).join(", "),
        url: "/",
        tag: `meer:${today}`,
      });
    }
  }
  return sent;
}
