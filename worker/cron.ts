// Elk kwartier (de cron in wrangler.jsonc): de koppelingen tussen lijsten (worker/mirrors.ts), de herinneringen met een
// uur die in het voorbije kwartier vielen, timers die hun doel haalden, en om 7 u 's morgens eerst de herhalingen (Netflix van deze maand), dan de gewone herinneringen
// (de garantie over een week, wat vandaag gepland staat). Een melding gaat enkel naar wie het nu mag zien, en niet naar
// wie de lijst of een tag ervan stilzette. Zo gebeurt alles één keer, zonder bij te houden wat al verstuurd is.

import { isMuted } from "../shared/alerts";
import { cleanAppSettings } from "../shared/apps";
import { addToDate, computeLocal } from "../shared/calc";
import { formatDuration } from "../shared/fields";
import { canEdit, eventTitle, type Role } from "../shared/model";
import { remindersDue, repeatsDue, timedRemindersDue, whenText } from "../shared/remind";
import { lineAllowed } from "../shared/rights";
import { ids, kindOf, listRoles, parseJson, seenLists, toEvent, toList, toThing, type EventRowDb, type ListRow, type ThingRowDb } from "./access";
import { syncAll } from "./mirrors";
import { notify } from "./push";
import { brusselsMoment, brusselsToday } from "./today";
import type { AppEnv } from "./types";

type Env = AppEnv["Bindings"];

/** Hoeveel meldingen iemand per keer hooguit krijgt; de rest komt samen in één. */
const MAX_PER_PERSON = 5;
const MORNING = "07:00";

export async function quarter(env: Env, at = new Date()): Promise<void> {
  const db = env.DB;
  const to = brusselsMoment(at);
  const from = brusselsMoment(new Date(at.getTime() - 15 * 60_000));
  const morning = `${to.slice(0, 10)}T${MORNING}`;
  if (morning >= from && morning < to) await daily(db, to.slice(0, 10));
  await syncAll(db).catch((err) => console.error("Koppelingen bijwerken lukte niet", err));
  await sendTimed(db, from, to).catch((err) => console.error("Herinneren op een uur lukte niet", err));
  await sendTimerGoals(db, from, to).catch((err) => console.error("Timers lukte niet", err));
}

export async function daily(db: D1Database, today = brusselsToday()): Promise<void> {
  await runRepeats(db, today).catch((err) => console.error("Herhalen lukte niet", err));
  await sendMorning(db, today).catch((err) => console.error("Herinneren lukte niet", err));
}

// ---------- herhalen ----------

/**
 * Gebeurtenissen die herhalen (Netflix elke maand): een kopie op elke datum tot vandaag, met de rechten die wie ze
 * logde nu heeft. Mag die er niet meer loggen (of de voorraad van een lijn niet meer wijzigen), dan stopt het.
 */
export async function runRepeats(db: D1Database, today: string): Promise<number> {
  const { results } = await db
    .prepare("SELECT * FROM events WHERE repeat IS NOT NULL AND status = 'gebeurd' AND json_extract(repeat, '$.next_on') <= ?")
    .bind(today)
    .all<EventRowDb>();
  let made = 0;
  for (const row of results) {
    const e = toEvent(row);
    if (!e.repeat) continue;
    const seen = await seenLists(db, e.created_by);
    const { results: lines } = await db
      .prepare("SELECT l.*, t.list_id AS thing_list FROM lines l LEFT JOIN things t ON t.id = l.thing_id WHERE l.event_id = ? ORDER BY l.position")
      .bind(e.id)
      .all<{ id: string; role: "in" | "uit" | "voor" | "bij"; thing_id: string | null; thing_list: string | null }>();
    const allowed = canEdit(seen.get(e.list_id)) && lines.every((l) => !l.thing_id || lineAllowed(l.role, l.thing_list ? (seen.get(l.thing_list) ?? null) : null));
    if (!allowed) {
      await db.prepare("UPDATE events SET repeat = NULL WHERE id = ?").bind(e.id).run();
      continue;
    }
    const { dates, next } = repeatsDue(e.repeat.next_on, e.repeat.every, today);
    const statements: D1PreparedStatement[] = [];
    for (const day of dates) {
      const copy = crypto.randomUUID();
      statements.push(
        db
          .prepare(
            `INSERT INTO events (id, list_id, kind, base, name, status, at, amount, paid_by, split, to_person, data, created_by)
             SELECT ?, list_id, kind, base, name, 'gebeurd', ?, amount, paid_by, split, to_person, data, created_by FROM events WHERE id = ?`,
          )
          .bind(copy, day + e.at.slice(10), e.id),
        db
          .prepare(
            `INSERT INTO lines (id, event_id, position, role, thing_id, text, amount, unit, price, expires, owner)
             SELECT lower(hex(randomblob(16))), ?, position, role, thing_id, text, amount, unit, price, NULL, owner FROM lines WHERE event_id = ?`,
          )
          .bind(copy, e.id),
      );
      made++;
    }
    statements.push(db.prepare("UPDATE events SET repeat = ? WHERE id = ?").bind(JSON.stringify({ every: e.repeat.every, next_on: next }), e.id));
    await db.batch(statements);
  }
  return made;
}

// ---------- herinneren ----------

type Due = { title: string; body: string; url: string; tag: string };

/** Wie meldingen kan krijgen (een toestel aanzette), met wat die stilzette. */
async function listeners(db: D1Database): Promise<Map<string, string[]>> {
  const { results } = await db
    .prepare("SELECT DISTINCT p.id, p.app_settings FROM push_subscriptions s JOIN people p ON p.id = s.person_id")
    .all<{ id: string; app_settings: string | null }>();
  return new Map(results.map((r) => [r.id, cleanAppSettings(parseJson(r.app_settings, null)).muted]));
}

/** Per persoon wat er valt in de dingen van de lijsten die die ziet (en niet stilzette). */
async function collectThings(db: D1Database, people: Map<string, string[]>, pick: (fields: ReturnType<typeof toList>["fields"], data: ReturnType<typeof toThing>["data"]) => { key: string; body: string; date: string }[]) {
  const due = new Map<string, Due[]>();
  const { results: listRows } = await db.prepare(`SELECT * FROM lists WHERE archived = 0 AND fields LIKE '%"remind"%'`).all<ListRow>();
  for (const list of listRows.map(toList)) {
    if (!list.fields.some((f) => f.remind !== undefined)) continue;
    const { index, candidates } = await listRoles(db, list.id);
    const { results: tags } = await db.prepare("SELECT tag_id FROM list_tag_links WHERE list_id = ?").bind(list.id).all<{ tag_id: string }>();
    const who = index
      .people(list.id, candidates)
      .filter((p) => p.role && people.has(p.person_id) && !isMuted(people.get(p.person_id)!, list.id, tags.map((t) => t.tag_id)))
      .map((p) => p.person_id);
    if (!who.length) continue;
    const { results } = await db.prepare("SELECT * FROM things WHERE list_id = ? AND archived = 0").bind(list.id).all<ThingRowDb>();
    for (const thing of results.map(toThing)) {
      const data = computeLocal(list.fields, thing.data, brusselsToday());
      for (const hit of pick(list.fields, data)) {
        for (const person of who)
          due.set(person, [...(due.get(person) ?? []), { title: thing.name, body: hit.body, url: `/dingen/${thing.id}`, tag: `${thing.id}:${hit.key}:${hit.date}` }]);
      }
    }
  }
  return due;
}

/** Geplande gebeurtenissen die nu vallen: naar wie ze logde en wie erin staat, als die de lijst nog ziet. */
async function collectPlanned(db: D1Database, people: Map<string, string[]>, due: Map<string, Due[]>, where: string, binds: unknown[]) {
  const { results } = await db.prepare(`SELECT * FROM events WHERE status = 'gepland' AND ${where}`).bind(...binds).all<EventRowDb>();
  for (const e of results.map(toEvent)) {
    const kind = await kindOf(db, e.kind, e.base);
    const { results: lines } = await db
      .prepare("SELECT l.*, t.name AS thing FROM lines l LEFT JOIN things t ON t.id = l.thing_id WHERE l.event_id = ? ORDER BY l.position")
      .bind(e.id)
      .all<{ role: "in"; thing_id: string | null; text: string | null; thing: string | null }>();
    const names = new Map(lines.flatMap((l) => (l.thing_id && l.thing ? [[l.thing_id, l.thing] as const] : [])));
    const title = eventTitle({ name: e.name, lines: lines.map((l) => ({ ...l, id: "", position: 0, amount: null, unit: null, price: null, expires: null, owner: null })) }, kind, (id) => names.get(id));
    const wanted = new Set([e.created_by, e.paid_by, e.to_person, ...(e.split ?? []).map((s) => s.person_id)].filter((x): x is string => Boolean(x)));
    for (const person of wanted) {
      if (!people.has(person) || isMuted(people.get(person)!, e.list_id)) continue;
      const role: Role | undefined = (await seenLists(db, person, e.list_id)).get(e.list_id);
      if (!role) continue;
      const time = e.at.length > 10 ? ` om ${e.at.slice(11, 16)}` : "";
      due.set(person, [...(due.get(person) ?? []), { title, body: `Gepland: vandaag${time}`, url: `/gebeurtenissen/${e.id}`, tag: `plan:${e.id}:${e.at}` }]);
    }
  }
}

async function send(db: D1Database, due: Map<string, Due[]>, tag: string): Promise<number> {
  let sent = 0;
  for (const [person, list] of due) {
    const shown = list.length > MAX_PER_PERSON ? list.slice(0, MAX_PER_PERSON - 1) : list;
    for (const d of shown) sent += await notify(db, person, d);
    if (shown.length < list.length) {
      const rest = list.slice(shown.length);
      sent += await notify(db, person, { title: `Nog ${rest.length} herinneringen`, body: rest.map((d) => d.title).join(", "), url: "/", tag: `meer:${tag}` });
    }
  }
  return sent;
}

/** 's Morgens: datums van dingen (zoveel dagen vooraf) en wat vandaag gepland staat zonder uur. */
export async function sendMorning(db: D1Database, today: string): Promise<number> {
  const people = await listeners(db);
  if (!people.size) return 0;
  const due = await collectThings(db, people, (fields, data) =>
    remindersDue(fields, data, today).map((r) => ({ key: r.key, date: r.date, body: `${r.label}: ${whenText(r.days, r.date)}` })),
  );
  await collectPlanned(db, people, due, "at = ?", [today]);
  return send(db, due, today);
}

/** In het voorbije kwartier: datums met een uur, en wat gepland stond op een uur. */
export async function sendTimed(db: D1Database, from: string, to: string): Promise<number> {
  const people = await listeners(db);
  if (!people.size) return 0;
  const due = await collectThings(db, people, (fields, data) =>
    timedRemindersDue(fields, data, from, to).map((r) => ({ key: r.key, date: r.date, body: `${r.label}: ${whenText(r.days, r.date)}${r.days === 0 ? ` om ${r.time}` : ""}` })),
  );
  await collectPlanned(db, people, due, "length(at) > 10 AND at >= ? AND at < ?", [from, to]);
  return send(db, due, from);
}

/** Een activiteit die loopt en het doel van haar soort haalde (16 u vasten): een melding aan wie ze startte. */
export async function sendTimerGoals(db: D1Database, from: string, to: string): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT e.*, k.goal, k.name AS kind_name FROM events e JOIN kinds k ON k.id = e.kind
       WHERE e.base = 'activiteit' AND e.end_at IS NULL AND length(e.at) > 10 AND k.goal IS NOT NULL AND e.status = 'gebeurd'`,
    )
    .all<EventRowDb & { goal: number; kind_name: string }>();
  let sent = 0;
  for (const r of results) {
    const reached = addMinutes(r.at, r.goal);
    if (!(reached >= from && reached < to)) continue;
    if (!(await seenLists(db, r.created_by, r.list_id)).has(r.list_id)) continue;
    sent += await notify(db, r.created_by, { title: `${r.kind_name}: ${formatDuration(r.goal)} bereikt`, body: r.name || r.kind_name, url: `/gebeurtenissen/${r.id}`, tag: `timer-${r.id}` });
  }
  return sent;
}

/** Een moment ("2026-11-06T18:30") plus zoveel minuten, in dezelfde vorm. */
function addMinutes(at: string, minutes: number): string {
  const d = new Date(`${at}:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString().slice(0, 16);
}

export { addToDate, ids };
