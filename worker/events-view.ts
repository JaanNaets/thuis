// Gebeurtenissen zoals de lezer ze ziet (zie shared/rights.ts):
// - het formulier van de gebeurtenis zien = alles (naam, bedrag, foto, alle lijnen); een Aanpassing (ADJUST) zie je
//   helemaal als je de lijst van haar item ziet;
// - anders enkel de lijnen in, uit of voor een item uit een lijst die je ziet (of wat ze in zo'n item veranderde, zoals
//   een saldo), met de kop van de gebeurtenis (formulier, moment, wie ze logde): `partial`. Geen naam, bedrag, foto,
//   verdeling of andere lijnen.

import { ADJUST } from "../shared/cells";
import type { EventView, KindInfo, Line, Role, ItemRef } from "../shared/model";
import type { Person } from "../shared/types";
import { ids, kindOf, toEvent, toLine, type EventRowDb, type LineRowDb, type Seen } from "./access";
import { peopleByIds, itemRefs } from "./routes/items";

export type EventPage = { events: EventView[]; items: ItemRef[]; people: Person[]; kinds: KindInfo[]; lists: { id: string; name: string }[]; more?: boolean };

/** Je rol op een gebeurtenis: op haar formulier, of bij een Aanpassing op de lijst van haar item. */
export function eventRole(seen: Seen, kind: string, itemLists: (string | null)[]): Role | null {
  if (kind !== ADJUST) return seen.forms.get(kind) ?? null;
  const roles = itemLists.map((l) => (l ? (seen.lists.get(l) ?? null) : null));
  return roles.length && roles.every((r) => r !== null) ? roles[0] : null;
}

/** Van rijen (al gefilterd op wat je mag zien: je ziet het formulier, of een lijn erin) naar wat je ziet, met de namen erbij. */
export async function viewEvents(db: D1Database, seen: Seen, rows: EventRowDb[]): Promise<EventPage> {
  if (!rows.length) return { events: [], items: [], people: [], kinds: [], lists: [] };
  const { results: lineRows } = await db
    .prepare(
      `SELECT l.*, t.list_id AS item_list FROM lines l LEFT JOIN items t ON t.id = l.item_id
       WHERE l.event_id IN (SELECT value FROM json_each(?)) ORDER BY l.event_id, l.position`,
    )
    .bind(ids(rows.map((r) => r.id)))
    .all<LineRowDb & { item_list: string | null }>();
  const linesOf = new Map<string, (Line & { item_list: string | null })[]>();
  for (const l of lineRows) linesOf.set(l.event_id, [...(linesOf.get(l.event_id) ?? []), { ...toLine(l), item_list: l.item_list }]);
  // De lijsten waarvan een gebeurtenis een cel veranderde (een saldo, een kleur).
  const { results: effectRows } = await db
    .prepare("SELECT DISTINCT f.event_id, t.list_id FROM effects f JOIN items t ON t.id = f.item_id WHERE f.event_id IN (SELECT value FROM json_each(?))")
    .bind(ids(rows.map((r) => r.id)))
    .all<{ event_id: string; list_id: string }>();
  const changed = new Map<string, string[]>();
  for (const r of effectRows) changed.set(r.event_id, [...(changed.get(r.event_id) ?? []), r.list_id]);

  const events: EventView[] = [];
  for (const row of rows) {
    const e = toEvent(row);
    const all = linesOf.get(e.id) ?? [];
    const full = eventRole(seen, e.kind, all.map((l) => l.item_list)) !== null;
    const lines = (full ? all : all.filter((l) => l.role !== "bij" && l.item_list !== null && seen.lists.has(l.item_list))).map(({ item_list: _t, ...l }) => l);
    const cells = (changed.get(e.id) ?? []).filter((l) => seen.lists.has(l));
    if (!full && !lines.length && !cells.length) continue;
    const lists = [...new Set([...all.flatMap((l) => (l.item_list && seen.lists.has(l.item_list) && (full || l.role !== "bij") ? [l.item_list] : [])), ...cells])];
    events.push(
      full
        ? { ...e, lines, lists, partial: false }
        : { ...e, name: "", amount: null, paid_by: null, split: null, to_person: null, data: {}, repeat: null, photo_version: null, lines, lists, partial: true },
    );
  }
  // Namen: items in de lijnen (bij een volledige gebeurtenis ook uit lijsten die je niet ziet), personen, formulieren en lijsten.
  const fullItems = events.filter((e) => !e.partial).flatMap((e) => e.lines.flatMap((l) => (l.item_id ? [l.item_id] : [])));
  const partItems = events.filter((e) => e.partial).flatMap((e) => e.lines.flatMap((l) => (l.item_id ? [l.item_id] : [])));
  const visible = await itemRefs(db, seen.lists, partItems);
  const inFull = await namesOf(db, seen.lists, fullItems);
  const items = [...new Map([...visible, ...inFull].map((t) => [t.id, t])).values()];
  const people = await peopleByIds(
    db,
    events.flatMap((e) => [e.created_by, e.paid_by ?? "", e.to_person ?? "", ...(e.split ?? []).map((s) => s.person_id), ...e.lines.flatMap((l) => (l.owner ? [l.owner] : []))]),
  );
  const kinds = new Map<string, KindInfo>();
  for (const e of events) if (!kinds.has(e.kind)) kinds.set(e.kind, await kindOf(db, e.kind, e.base));
  const listIds = [...new Set(events.flatMap((e) => e.lists))];
  const { results: lists } = listIds.length
    ? await db.prepare("SELECT id, name FROM lists WHERE id IN (SELECT value FROM json_each(?))").bind(ids(listIds)).all<{ id: string; name: string }>()
    : { results: [] as { id: string; name: string }[] };
  return { events, items, people, kinds: [...kinds.values()], lists };
}

/**
 * Namen van items in een gebeurtenis die je helemaal ziet: ook uit een lijst die je niet ziet (de Rioja op jullie
 * kasticket), maar dan zonder de lijst (`list` leeg): openen kan je het niet.
 */
async function namesOf(db: D1Database, seen: Map<string, Role>, itemIds: string[]): Promise<ItemRef[]> {
  if (!itemIds.length) return [];
  const { results } = await db
    .prepare("SELECT t.id, t.name, t.list_id, l.name AS list FROM items t JOIN lists l ON l.id = t.list_id WHERE t.id IN (SELECT value FROM json_each(?))")
    .bind(ids(itemIds))
    .all<ItemRef>();
  return results.map((t) => (seen.has(t.list_id) ? t : { ...t, list: "" }));
}

/**
 * SQL: de gebeurtenissen (`e`) die een item raken van de lijsten in `param` (een JSON-lijst van ids): met een lijn naar
 * zo'n item of een verandering van een van zijn cellen.
 */
export const touchesLists = (param: string) =>
  `(e.id IN (SELECT l.event_id FROM lines l JOIN items t ON t.id = l.item_id WHERE t.list_id IN (SELECT value FROM json_each(${param})))
    OR e.id IN (SELECT f.event_id FROM effects f JOIN items t ON t.id = f.item_id WHERE t.list_id IN (SELECT value FROM json_each(${param}))))`;

export type LogOptions = { status?: "gepland" | "klaar"; kind?: string; from?: string; to?: string; before?: string; q?: string; limit: number };

/**
 * Een logboek: dat van een formulier (alles wat ermee gelogd werd) of dat van een lijst (wat haar items raakte: een lijn
 * of een verandering van een cel, zoals een saldo). Wat je ervan ziet, beslist `viewEvents`.
 */
export async function logbookRows(db: D1Database, of: { list: string } | { form: string }, opts: LogOptions): Promise<EventRowDb[]> {
  const where: string[] = [
    "list" in of ? touchesLists("?1") : "e.kind = ?1",
  ];
  const binds: unknown[] = ["list" in of ? ids([of.list]) : of.form];
  const add = (sql: string, v: unknown) => {
    binds.push(v);
    where.push(sql.replace("?", `?${binds.length}`));
  };
  if (opts.status === "gepland") where.push("e.status = 'gepland'");
  if (opts.status === "klaar") where.push("e.status != 'gepland'");
  if (opts.kind) add("e.kind = ?", opts.kind);
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
