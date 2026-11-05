// Elk kwartier (de cron in wrangler.jsonc): de herinneringen met een uur die in het voorbije kwartier vielen (een
// afspraak om 18:30, iets dat over twee dagen vervalt). En 's morgens om 7 u eerst de herhalingen (de huur van deze
// maand), dan de gewone herinneringen (de verwarming over een week, een verjaardag morgen). Een melding gaat enkel naar
// wie het item en de datum mag zien en meldingen aanzette.

import { fieldAccess, typeAccess, type Rights } from "../shared/access";
import { computeLocal, fieldDeps } from "../shared/calc";
import { formatDuration, type Attributes } from "../shared/fields";
import { remindersDue, repeatsDue, timedRemindersDue, whenText, type Reminder } from "../shared/remind";
import type { ItemType } from "../shared/types";
import { accessibleProjects, projectAccess, toItemType, type TypeRow } from "./context";
import { notify } from "./push";
import { createRepeated } from "./routes/items";
import { brusselsMoment, brusselsToday } from "./today";
import { ForbiddenError } from "./validate";

/** Hoeveel meldingen iemand per ochtend hooguit krijgt; de rest komt samen in één. */
const MAX_PER_PERSON = 5;

export async function daily(db: D1Database, today = brusselsToday()): Promise<void> {
  await runRepeats(db, today).catch((err) => console.error("Herhalen lukte niet", err));
  await sendReminders(db, today).catch((err) => console.error("Herinneren lukte niet", err));
}

/** Het uur van de ochtend (in België) voor herhalen en de gewone herinneringen. */
const MORNING = "07:00";

/**
 * Wat de cron elk kwartier doet, voor het kwartier `[at − 15 min, at)`: de herinneringen met een uur, en als 7 u in dat
 * kwartier valt de ochtend. Zo gebeurt alles één keer, zonder bij te houden wat al gebeurde.
 */
export async function quarter(db: D1Database, at = new Date()): Promise<void> {
  const to = brusselsMoment(at);
  const from = brusselsMoment(new Date(at.getTime() - 15 * 60_000));
  const morning = `${to.slice(0, 10)}T${MORNING}`;
  if (morning >= from && morning < to) await daily(db, to.slice(0, 10));
  await sendTimedReminders(db, from, to).catch((err) => console.error("Herinneren op een uur lukte niet", err));
  await sendTimerGoals(db, new Date(at.getTime() - 15 * 60_000), at).catch((err) => console.error("Timers lukte niet", err));
}

/**
 * Een timer met een doel (`timer_goal`, 16 u vasten) die nog loopt en zijn doel in het kwartier `[from, to)` haalde:
 * een melding aan wie hem startte (wie het item maakte), als die de lijst en de timer nog mag zien.
 */
export async function sendTimerGoals(db: D1Database, from: Date, to: Date): Promise<number> {
  const { results: rows } = await db.prepare(`SELECT * FROM item_types WHERE fields LIKE '%"timer_goal"%'`).all<TypeRow>();
  let sent = 0;
  for (const type of rows.map(toItemType)) {
    for (const f of type.fields.filter((x) => x.type === "timer" && x.timer_goal)) {
      const path = `$.${f.key}`;
      const { results } = await db
        .prepare(
          `SELECT id, name, project_id, created_by, json_extract(data, ? || '.start') AS start FROM items
           WHERE type_id = ? AND archived = 0 AND json_extract(data, ? || '.start') IS NOT NULL AND json_extract(data, ? || '.end') IS NULL`,
        )
        .bind(path, type.id, path, path)
        .all<{ id: string; name: string; project_id: string; created_by: string; start: string }>();
      for (const it of results) {
        const reached = Date.parse(it.start) + f.timer_goal! * 60_000;
        if (!(reached >= from.getTime() && reached < to.getTime())) continue;
        const access = await projectAccess(db, it.created_by, it.project_id);
        if (!access || typeAccess(access.rights, type.id) === "none" || fieldAccess(access.rights, type.id, f.key) === "none") continue;
        sent += await notify(db, it.created_by, { title: `${f.label}: ${formatDuration(f.timer_goal!)} bereikt`, body: it.name, url: `/items/${it.id}`, tag: `timer-${it.id}` });
      }
    }
  }
  return sent;
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

type Due = { item: { id: string; name: string }; reminder: Reminder; body: string };

/**
 * Per persoon de herinneringen die nu vallen: voor elke lijst met herinneringen (`like`: wat in haar velden moet staan)
 * de items, met `pick` wat er voor één item valt. Enkel wie het item en de datum mag zien (en alles waarvan een
 * berekende datum afhangt).
 */
async function collect(
  db: D1Database,
  like: string,
  today: string,
  pick: (fields: ItemType["fields"], data: Attributes) => { reminder: Reminder; body: string }[],
): Promise<Map<string, Due[]>> {
  const due = new Map<string, Due[]>();
  const { results: people } = await db.prepare("SELECT DISTINCT person_id FROM push_subscriptions").all<{ person_id: string }>();
  if (!people.length) return due;
  const { results: typeRows } = await db.prepare("SELECT * FROM item_types WHERE fields LIKE ?").bind(`%${like}%`).all<TypeRow>();
  if (!typeRows.length) return due;

  // Per persoon zijn rechten in elk project (zoals in de app).
  const rights = new Map<string, Map<string, Rights>>();
  for (const { person_id } of people) rights.set(person_id, new Map((await accessibleProjects(db, person_id)).map((n) => [n.id, n.rights])));

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
      for (const { reminder, body } of pick(type.fields, data)) {
        const deps = [...fieldDeps(type.fields, reminder.key), ...(type.fields.find((f) => f.key === reminder.key)?.remind_at ? [type.fields.find((f) => f.key === reminder.key)!.remind_at!] : [])];
        for (const [person, projects] of rights) {
          const r = projects.get(item.project_id);
          if (!r || typeAccess(r, type.id) === "none" || deps.some((k) => fieldAccess(r, type.id, k) === "none")) continue;
          due.set(person, [...(due.get(person) ?? []), { item, reminder, body }]);
        }
      }
    }
  }
  return due;
}

/** De meldingen sturen: per persoon hooguit `MAX_PER_PERSON`, de rest samen in één. */
async function send(db: D1Database, due: Map<string, Due[]>, tag: string): Promise<number> {
  let sent = 0;
  for (const [person, list] of due) {
    const shown = list.length > MAX_PER_PERSON ? list.slice(0, MAX_PER_PERSON - 1) : list;
    for (const { item, reminder, body } of shown)
      sent += await notify(db, person, {
        title: item.name,
        body,
        url: `/items/${item.id}`,
        tag: `${item.id}:${reminder.key}:${reminder.date}`,
      });
    if (shown.length < list.length) {
      const rest = list.slice(shown.length);
      sent += await notify(db, person, {
        title: `Nog ${rest.length} herinneringen`,
        body: rest.map((d) => d.item.name).join(", "),
        url: "/",
        tag: `meer:${tag}`,
      });
    }
  }
  return sent;
}

export async function sendReminders(db: D1Database, today: string): Promise<number> {
  const due = await collect(db, '"remind"', today, (fields, data) =>
    remindersDue(fields, data, today).map((reminder) => ({ reminder, body: `${reminder.label}: ${whenText(reminder.days, reminder.date)}` })),
  );
  return send(db, due, today);
}

/** De herinneringen met een uur die in `[from, to)` vallen (tijd van België, "YYYY-MM-DDTHH:MM"). */
export async function sendTimedReminders(db: D1Database, from: string, to: string): Promise<number> {
  const due = await collect(db, '"remind_at"', from.slice(0, 10), (fields, data) =>
    timedRemindersDue(fields, data, from, to).map((reminder) => ({
      reminder,
      body: `${reminder.label}: ${whenText(reminder.days, reminder.date)}${reminder.days === 0 ? ` om ${reminder.time}` : ""}`,
    })),
  );
  return send(db, due, from);
}
