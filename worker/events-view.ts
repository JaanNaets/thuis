// Gebeurtenissen zoals de lezer ze ziet (zie shared/rights.ts):
// - de lijst van de gebeurtenis zien = alles (naam, bedrag, foto, alle lijnen);
// - anders enkel de lijnen in, uit of voor een ding uit een lijst die je ziet, met de kop van de gebeurtenis (soort,
//   moment, wie ze logde): `partial`. Geen naam, bedrag, foto, verdeling of andere lijnen.

import type { EventView, KindInfo, Line, Role, ThingRef } from "../shared/model";
import type { Person } from "../shared/types";
import { ids, kindOf, toEvent, toLine, type EventRowDb, type LineRowDb } from "./access";
import { peopleByIds, thingRefs } from "./routes/things";

export type EventPage = { events: EventView[]; things: ThingRef[]; people: Person[]; kinds: KindInfo[]; lists: { id: string; name: string }[]; more?: boolean };

/** Van rijen (al gefilterd op wat je mag zien: je ziet de lijst, of een lijn erin) naar wat je ziet, met de namen erbij. */
export async function viewEvents(db: D1Database, seen: Map<string, Role>, rows: EventRowDb[]): Promise<EventPage> {
  if (!rows.length) return { events: [], things: [], people: [], kinds: [], lists: [] };
  const [lineRows, listRows] = (await db.batch([
    db
      .prepare(
        `SELECT l.*, t.list_id AS thing_list FROM lines l LEFT JOIN things t ON t.id = l.thing_id
         WHERE l.event_id IN (SELECT value FROM json_each(?)) ORDER BY l.event_id, l.position`,
      )
      .bind(ids(rows.map((r) => r.id))),
    db.prepare("SELECT id, name FROM lists WHERE id IN (SELECT value FROM json_each(?))").bind(ids(rows.map((r) => r.list_id))),
  ])) as [D1Result<LineRowDb & { thing_list: string | null }>, D1Result<{ id: string; name: string }>];
  const linesOf = new Map<string, (Line & { thing_list: string | null })[]>();
  for (const l of lineRows.results) linesOf.set(l.event_id, [...(linesOf.get(l.event_id) ?? []), { ...toLine(l), thing_list: l.thing_list }]);

  const events: EventView[] = [];
  for (const row of rows) {
    const e = toEvent(row);
    const full = seen.has(e.list_id);
    const all = linesOf.get(e.id) ?? [];
    const lines = (full ? all : all.filter((l) => l.role !== "bij" && l.thing_list !== null && seen.has(l.thing_list))).map(({ thing_list: _t, ...l }) => l);
    if (!full && !lines.length) continue;
    events.push(
      full
        ? { ...e, lines, partial: false }
        : { ...e, name: "", amount: null, paid_by: null, split: null, to_person: null, data: {}, repeat: null, photo_version: null, lines, partial: true },
    );
  }
  // Namen: dingen in de lijnen (bij een volledige gebeurtenis ook uit lijsten die je niet ziet), personen en soorten.
  const fullThings = events.filter((e) => !e.partial).flatMap((e) => e.lines.flatMap((l) => (l.thing_id ? [l.thing_id] : [])));
  const partThings = events.filter((e) => e.partial).flatMap((e) => e.lines.flatMap((l) => (l.thing_id ? [l.thing_id] : [])));
  const visible = await thingRefs(db, seen, partThings);
  const inFull = await namesOf(db, seen, fullThings);
  const things = [...new Map([...visible, ...inFull].map((t) => [t.id, t])).values()];
  const people = await peopleByIds(
    db,
    events.flatMap((e) => [e.created_by, e.paid_by ?? "", e.to_person ?? "", ...(e.split ?? []).map((s) => s.person_id), ...e.lines.flatMap((l) => (l.owner ? [l.owner] : []))]),
  );
  const kinds = new Map<string, KindInfo>();
  for (const e of events) if (!kinds.has(e.kind)) kinds.set(e.kind, await kindOf(db, e.kind, e.base));
  return { events, things, people, kinds: [...kinds.values()], lists: listRows.results };
}

/**
 * Namen van dingen in een gebeurtenis die je helemaal ziet: ook uit een lijst die je niet ziet (de Rioja op jullie
 * kasticket), maar dan zonder de lijst (`list` leeg): openen kan je het niet.
 */
async function namesOf(db: D1Database, seen: Map<string, Role>, thingIds: string[]): Promise<ThingRef[]> {
  if (!thingIds.length) return [];
  const { results } = await db
    .prepare("SELECT t.id, t.name, t.list_id, l.name AS list FROM things t JOIN lists l ON l.id = t.list_id WHERE t.id IN (SELECT value FROM json_each(?))")
    .bind(ids(thingIds))
    .all<ThingRef>();
  return results.map((t) => (seen.has(t.list_id) ? t : { ...t, list: "" }));
}

/** Het logboek van een lijst: wat erin gelogd werd, en wat elders met haar dingen gebeurde (in, uit, voor). */
export async function logbookRows(
  db: D1Database,
  listId: string,
  opts: { status?: "gepland" | "klaar"; base?: string; from?: string; to?: string; before?: string; q?: string; limit: number },
): Promise<EventRowDb[]> {
  const where: string[] = [
    `(e.list_id = ?1 OR e.id IN (SELECT l.event_id FROM lines l JOIN things t ON t.id = l.thing_id WHERE t.list_id = ?1 AND l.role IN ('in', 'uit', 'voor')))`,
  ];
  const binds: unknown[] = [listId];
  const add = (sql: string, v: unknown) => {
    binds.push(v);
    where.push(sql.replace("?", `?${binds.length}`));
  };
  if (opts.status === "gepland") where.push("e.status = 'gepland'");
  if (opts.status === "klaar") where.push("e.status != 'gepland'");
  if (opts.base) add("e.base = ?", opts.base);
  if (opts.from) add("e.at >= ?", opts.from);
  if (opts.to) add("e.at < ?", `${opts.to}~`);
  if (opts.q) add("e.name LIKE ?", `%${opts.q}%`);
  if (opts.before) add("(e.at || '|' || e.id) < ?", opts.before);
  const order = opts.status === "gepland" ? "e.at ASC, e.created_at ASC" : "e.at DESC, e.created_at DESC";
  const { results } = await db
    .prepare(`SELECT e.* FROM events e WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${opts.limit}`)
    .bind(...binds)
    .all<EventRowDb>();
  return results;
}
