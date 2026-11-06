import { Hono, type Context } from "hono";
import { normalizeShares, type Attributes, type Interval, type Share } from "../../shared/fields";
import { addToDate } from "../../shared/calc";
import { BASES, brusselsNow, canEdit, isAt, isLineRole, isStatus, type Base, type Event, type KindInfo, type LineRole, type Role, type Status } from "../../shared/model";
import { lineAllowed } from "../../shared/rights";
import { normalizeUnit } from "../../shared/units";
import { ids, kindsFor, needEdit, requireList, seenLists, toEvent, toLine, type EventRowDb, type LineRowDb } from "../access";
import { logbookRows, viewEvents } from "../events-view";
import { attachmentsOf, purgeMedia, removePhoto, servePhoto, storeFiles, storePhoto } from "../media";
import { prepareData } from "../prepare";
import { knownPeople } from "./lists";
import type { AppEnv } from "../types";
import { asObject, ConflictError, NotFoundError, optionalString, ValidationError } from "../validate";
import { notifyNewEvent } from "../notify-events";

export const events = new Hono<AppEnv>();
export const listEvents = new Hono<AppEnv>();

const MAX_LINES = 80;
const MAX_PAGE = 100;
const MAX_CENTS = 100_000_000;

// ---------- lezen ----------

/** Het logboek van een lijst (nieuwste eerst; gepland: eerst wat het eerst moet), met `before` om verder te lezen. */
listEvents.get("/:id/events", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { list } = await requireList(db, me.id, c.req.param("id"));
  const seen = await seenLists(db, me.id);
  const limit = Math.min(Number(c.req.query("limit")) || 50, MAX_PAGE);
  const status = c.req.query("status");
  const rows = await logbookRows(db, list.id, {
    status: status === "gepland" || status === "klaar" ? status : undefined,
    base: c.req.query("base") || undefined,
    from: c.req.query("from") || undefined,
    to: c.req.query("to") || undefined,
    before: c.req.query("before") || undefined,
    q: c.req.query("q")?.trim() || undefined,
    limit: limit + 1,
  });
  const page = await viewEvents(db, seen, rows.slice(0, limit));
  return c.json({ ...page, more: rows.length > limit });
});

type Found = { event: Event; role: Role | null; seen: Map<string, Role> };

/** Een gebeurtenis die je ziet (helemaal, of enkel een lijn erin); anders "niet gevonden". */
async function findEvent(c: Context<AppEnv>, id: string): Promise<Found> {
  const db = c.env.DB;
  const row = await db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventRowDb>();
  if (!row) throw new NotFoundError("Dat bestaat niet (meer), of je kan er niet bij.");
  const seen = await seenLists(db, c.get("person").id);
  return { event: toEvent(row), role: seen.get(row.list_id) ?? null, seen };
}

/** Om te wijzigen: je moet de lijst van de gebeurtenis mogen wijzigen. */
async function editableEvent(c: Context<AppEnv>, id: string): Promise<Found & { role: Role }> {
  const found = await findEvent(c, id);
  if (!found.role) throw new NotFoundError("Dat bestaat niet (meer), of je kan er niet bij.");
  needEdit(found.role);
  return found as Found & { role: Role };
}

events.get("/:id", async (c) => {
  const db = c.env.DB;
  const { event, role, seen } = await findEvent(c, c.req.param("id"));
  const row = await db.prepare("SELECT * FROM events WHERE id = ?").bind(event.id).first<EventRowDb>();
  const page = await viewEvents(db, seen, [row!]);
  if (!page.events.length) throw new NotFoundError("Dat bestaat niet (meer), of je kan er niet bij.");
  const view = page.events[0];
  return c.json({
    ...page,
    event: view,
    can_edit: !view.partial && canEdit(role),
    files: view.partial ? [] : await attachmentsOf(db, "event", event.id),
    // Wat een aankoop afvinkte (boodschappen), en wat deze gebeurtenis afvinkte.
    ticked: view.partial ? [] : await tickedBy(db, seen, event.id),
  });
});

async function tickedBy(db: D1Database, seen: Map<string, Role>, eventId: string) {
  const { results } = await db.prepare("SELECT id, name, list_id FROM events WHERE done_by = ?").bind(eventId).all<{ id: string; name: string; list_id: string }>();
  return results.filter((r) => seen.has(r.list_id));
}

// ---------- invoer nakijken ----------

type CleanLine = {
  role: LineRole;
  thing_id: string | null;
  text: string | null;
  amount: number | null;
  unit: string | null;
  price: number | null;
  expires: string | null;
  owner: string | null;
  new_thing: { list_id: string; name: string; data: Attributes } | null;
};

type CleanEvent = {
  kind: KindInfo;
  name: string;
  status: Status;
  at: string;
  end_at: string | null;
  amount: number | null;
  paid_by: string | null;
  split: Share[] | null;
  to_person: string | null;
  data: Attributes;
  lines: CleanLine[];
  repeat: { every: Interval; next_on: string } | null;
};

const num = (v: unknown, what: string, min: number, max: number): number | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new ValidationError(`${what} klopt niet`);
  return v;
};
const cents = (v: unknown, what: string) => {
  const n = num(v, what, -MAX_CENTS, MAX_CENTS);
  if (n !== null && !Number.isInteger(n)) throw new ValidationError(`${what} moet in cent zijn`);
  return n;
};

/**
 * Een gebeurtenis van buiten nakijken: de soort moet je kunnen gebruiken, personen moet je kennen, dingen moet je
 * zien en voor erbij/eraf ook mogen wijzigen (shared/rights.ts). `before`: de lijnen die er al stonden; een lijn die
 * niet verandert, mag altijd blijven.
 */
async function cleanEvent(
  db: D1Database,
  meId: string,
  seen: Map<string, Role>,
  raw: Record<string, unknown>,
  before: { data: Attributes; lines: CleanLine[] } | null,
): Promise<CleanEvent> {
  const kinds = await kindsFor(db, seen.keys());
  const kind = kinds.find((k) => k.id === raw.kind);
  if (!kind) throw new ValidationError("Kies een soort");
  const status = isStatus(raw.status) ? raw.status : "gebeurd";
  const at = typeof raw.at === "string" && isAt(raw.at) ? raw.at : null;
  if (!at) throw new ValidationError("Kies een datum");
  const endAt = typeof raw.end_at === "string" && raw.end_at ? raw.end_at : null;
  if (endAt && (!isAt(endAt) || endAt < at)) throw new ValidationError("Het einde ligt voor het begin");
  const known = new Set((await knownPeople(db, meId)).map((p) => p.id));
  const person = (v: unknown, what: string): string | null => {
    if (v === undefined || v === null || v === "") return null;
    if (typeof v !== "string" || !known.has(v)) throw new ValidationError(`${what}: die persoon ken je niet`);
    return v;
  };
  let split: Share[] | null = null;
  try {
    const shares = normalizeShares(raw.split ?? null);
    split = shares.length ? shares : null;
  } catch (err) {
    throw new ValidationError(err instanceof Error ? err.message : "De verdeling klopt niet");
  }
  for (const s of split ?? []) person(s.person_id, "Verdeling");
  const data = await prepareData(db, meId, seen, kind.fields, raw.data, before?.data);

  // Lijnen.
  const rawLines = Array.isArray(raw.lines) ? raw.lines : [];
  if (rawLines.length > MAX_LINES) throw new ValidationError(`Hoogstens ${MAX_LINES} lijnen`);
  const parsed = rawLines.map((r) => {
    const o = asObject(r);
    if (!isLineRole(o.role)) throw new ValidationError("Onbekende rol van een lijn");
    const newThing = o.new_thing && typeof o.new_thing === "object" ? asObject(o.new_thing) : null;
    const text = optionalString(o, "text", 200);
    const expires = optionalString(o, "expires", 10);
    if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) throw new ValidationError("Houdbaar tot moet een datum zijn");
    return {
      role: o.role,
      thing_id: typeof o.thing_id === "string" && o.thing_id ? o.thing_id : null,
      text,
      amount: num(o.amount, "Hoeveel", 0, 1_000_000),
      unit: normalizeUnit(optionalString(o, "unit", 20)),
      price: cents(o.price, "De prijs"),
      expires,
      owner: person(o.owner, "Van wie"),
      new_thing: newThing
        ? { list_id: typeof newThing.list_id === "string" ? newThing.list_id : "", name: optionalString(newThing, "name", 200) ?? "", data: (newThing.data ?? {}) as Attributes }
        : null,
    } satisfies CleanLine;
  });
  // De dingen: bestaan ze, en mag je ermee doen wat de lijn zegt?
  const thingIds = parsed.flatMap((l) => (l.thing_id ? [l.thing_id] : []));
  const { results } = thingIds.length
    ? await db.prepare("SELECT id, list_id, name FROM things WHERE id IN (SELECT value FROM json_each(?))").bind(ids(thingIds)).all<{ id: string; list_id: string; name: string }>()
    : { results: [] as { id: string; list_id: string; name: string }[] };
  const listOf = new Map(results.map((r) => [r.id, r.list_id]));
  const unchanged = (l: CleanLine) =>
    before?.lines.some((b) => b.thing_id === l.thing_id && b.role === l.role && b.amount === l.amount && (b.unit ?? null) === (l.unit ?? null)) ?? false;
  const lines: CleanLine[] = [];
  for (const l of parsed) {
    if (l.new_thing) {
      const target = seen.get(l.new_thing.list_id);
      if (!target || !l.new_thing.name) throw new ValidationError("Kies een lijst voor het nieuwe ding");
      if (!lineAllowed(l.role, target)) throw new ValidationError(`Je mag niets toevoegen aan die lijst (${l.new_thing.name})`);
      lines.push({ ...l, thing_id: null, text: null });
      continue;
    }
    if (l.thing_id) {
      const list = listOf.get(l.thing_id);
      if (!list) {
        // Het ding bestaat niet meer: hou de tekst.
        if (l.text) lines.push({ ...l, thing_id: null });
        continue;
      }
      if (!unchanged(l) && !lineAllowed(l.role, seen.get(list) ?? null)) {
        // De naam enkel als je de lijst van het ding ziet.
        const name = seen.has(list) ? (results.find((r) => r.id === l.thing_id)?.name ?? "dat ding") : "dat ding";
        throw new ValidationError(
          l.role === "in" || l.role === "uit" ? `Je mag de voorraad van ${name} niet wijzigen` : `Je kan niet naar ${name} verwijzen`,
        );
      }
      lines.push({ ...l, text: null });
      continue;
    }
    if (l.text) lines.push(l);
  }
  const amount = cents(raw.amount, "Het bedrag");
  const every = raw.repeat && typeof raw.repeat === "object" ? (asObject(raw.repeat).every as Interval | undefined) : undefined;
  const repeat =
    every && Number.isInteger(every.n) && every.n > 0 && every.n <= 365 && ["day", "week", "month", "year"].includes(every.unit)
      ? { every: { n: every.n, unit: every.unit }, next_on: addToDate(at.slice(0, 10), every.n, every.unit) }
      : null;
  return {
    kind,
    name: optionalString(raw, "name", 200) ?? "",
    status,
    at,
    end_at: kind.base === "activiteit" ? endAt : null,
    amount: BASES[kind.base].money || amount !== null ? amount : null,
    paid_by: person(raw.paid_by, "Betaald door"),
    split,
    to_person: kind.base === "overdracht" ? person(raw.to_person, "Naar") : null,
    data,
    lines,
    repeat,
  };
}

function lineStatements(db: D1Database, eventId: string, lines: CleanLine[], newIds: Map<number, string>): D1PreparedStatement[] {
  return lines.map((l, i) =>
    db
      .prepare("INSERT INTO lines (id, event_id, position, role, thing_id, text, amount, unit, price, expires, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), eventId, i, l.role, newIds.get(i) ?? l.thing_id, l.text, l.amount, l.unit, l.price, l.expires, l.owner),
  );
}

/** Nieuwe dingen uit lijnen (een product dat nog niet bestond), nagekeken zoals elk ding. */
async function newThingStatements(db: D1Database, meId: string, seen: Map<string, Role>, lines: CleanLine[]) {
  const statements: D1PreparedStatement[] = [];
  const newIds = new Map<number, string>();
  const made: { id: string; name: string; list_id: string }[] = [];
  for (const [i, l] of lines.entries()) {
    if (!l.new_thing) continue;
    const { list } = await requireList(db, meId, l.new_thing.list_id);
    if (!list.one) throw new ValidationError(`${list.name} heeft geen dingen`);
    const data = await prepareData(db, meId, seen, list.fields, l.new_thing.data);
    const id = crypto.randomUUID();
    statements.push(db.prepare("INSERT INTO things (id, list_id, name, data, created_by) VALUES (?, ?, ?, ?, ?)").bind(id, list.id, l.new_thing.name, JSON.stringify(data), meId));
    newIds.set(i, id);
    made.push({ id, name: l.new_thing.name, list_id: list.id });
  }
  return { statements, newIds, made };
}

/**
 * Een aankoop vinkt open boodschappen af: geplande aankopen in lijsten die je mag wijzigen, met een lijn erbij voor
 * hetzelfde ding (of een tekst met dezelfde naam).
 */
async function tickShopping(db: D1Database, seen: Map<string, Role>, eventId: string, thingIds: string[]): Promise<{ id: string; name: string }[]> {
  if (!thingIds.length) return [];
  const { results: names } = await db.prepare("SELECT lower(name) AS name FROM things WHERE id IN (SELECT value FROM json_each(?))").bind(ids(thingIds)).all<{ name: string }>();
  const editable = [...seen].filter(([, r]) => canEdit(r)).map(([id]) => id);
  const { results } = await db
    .prepare(
      `SELECT DISTINCT e.id, e.name FROM events e JOIN lines l ON l.event_id = e.id
       WHERE e.status = 'gepland' AND e.base = 'aankoop' AND e.id != ?1 AND e.list_id IN (SELECT value FROM json_each(?2)) AND l.role = 'in'
         AND (l.thing_id IN (SELECT value FROM json_each(?3)) OR (l.thing_id IS NULL AND lower(l.text) IN (SELECT value FROM json_each(?4))))`,
    )
    .bind(eventId, ids(editable), ids(thingIds), ids(names.map((n) => n.name)))
    .all<{ id: string; name: string }>();
  if (results.length)
    await db.prepare("UPDATE events SET status = 'afgevinkt', done_by = ?, updated_at = datetime('now') WHERE id IN (SELECT value FROM json_each(?))").bind(eventId, ids(results.map((r) => r.id))).run();
  return results;
}

// ---------- bewaren ----------

listEvents.post("/:id/events", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { list, role } = await requireList(db, me.id, c.req.param("id"));
  needEdit(role);
  const seen = await seenLists(db, me.id);
  const input = await cleanEvent(db, me.id, seen, asObject(await c.req.json()), null);
  const id = crypto.randomUUID();
  const fresh = await newThingStatements(db, me.id, seen, input.lines);
  await db.batch([
    ...fresh.statements,
    db
      .prepare(
        `INSERT INTO events (id, list_id, kind, base, name, status, at, end_at, amount, paid_by, split, to_person, data, repeat, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        list.id,
        input.kind.id,
        input.kind.base,
        input.name,
        input.status,
        input.at,
        input.end_at,
        input.amount,
        input.paid_by,
        input.split ? JSON.stringify(input.split) : null,
        input.to_person,
        JSON.stringify(input.data),
        input.repeat ? JSON.stringify(input.repeat) : null,
        me.id,
      ),
    ...lineStatements(db, id, input.lines, fresh.newIds),
  ]);
  const bought = input.lines.flatMap((l, i) => (l.role === "in" ? [fresh.newIds.get(i) ?? l.thing_id].filter((x): x is string => Boolean(x)) : []));
  const ticked = input.kind.base === "aankoop" && input.status === "gebeurd" ? await tickShopping(db, seen, id, bought) : [];
  if (input.status !== "gepland") c.executionCtx.waitUntil(notifyNewEvent(c.env, me, list, id).catch((err) => console.error("melding", err)));
  return c.json({ id, made: fresh.made, ticked }, 201);
});

events.put("/:id", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { event, seen } = await editableEvent(c, c.req.param("id"));
  const { results: oldRows } = await db
    .prepare("SELECT l.*, t.list_id AS thing_list FROM lines l LEFT JOIN things t ON t.id = l.thing_id WHERE l.event_id = ? ORDER BY l.position")
    .bind(event.id)
    .all<LineRowDb & { thing_list: string | null }>();
  const old = oldRows.map((r) => ({ ...toLine(r), thing_list: r.thing_list, new_thing: null }));
  const input = await cleanEvent(db, me.id, seen, asObject(await c.req.json()), { data: event.data, lines: old });
  // Lijnen naar dingen die jij niet ziet, blijven staan zoals ze waren.
  const hidden = old.filter((l) => l.thing_list && !seen.has(l.thing_list)).map(({ thing_list: _t, id: _i, position: _p, ...l }) => ({ ...l, new_thing: null }));
  const fresh = await newThingStatements(db, me.id, seen, input.lines);
  await db.batch([
    ...fresh.statements,
    db
      .prepare(
        `UPDATE events SET kind = ?, base = ?, name = ?, status = ?, at = ?, end_at = ?, amount = ?, paid_by = ?, split = ?, to_person = ?, data = ?,
           repeat = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .bind(
        input.kind.id,
        input.kind.base,
        input.name,
        input.status,
        input.at,
        input.end_at,
        input.amount,
        input.paid_by,
        input.split ? JSON.stringify(input.split) : null,
        input.to_person,
        JSON.stringify(input.data),
        input.repeat ? JSON.stringify(input.repeat) : event.repeat && JSON.stringify(event.repeat),
        event.id,
      ),
    db.prepare("DELETE FROM lines WHERE event_id = ?").bind(event.id),
    ...lineStatements(db, event.id, [...input.lines, ...hidden], fresh.newIds),
  ]);
  return c.json({ ok: true, made: fresh.made });
});

/** Stoppen met herhalen. */
events.delete("/:id/repeat", async (c) => {
  const { event } = await editableEvent(c, c.req.param("id"));
  await c.env.DB.prepare("UPDATE events SET repeat = NULL WHERE id = ?").bind(event.id).run();
  return c.body(null, 204);
});

/** Verwijderen: wat deze aankoop afvinkte, staat weer open. */
events.delete("/:id", async (c) => {
  const db = c.env.DB;
  const { event } = await editableEvent(c, c.req.param("id"));
  const { results } = await db.prepare("SELECT r2_key FROM attachments WHERE owner_kind = 'event' AND owner_id = ?").bind(event.id).all<{ r2_key: string }>();
  await db.batch([
    db.prepare("UPDATE events SET status = 'gepland', done_by = NULL WHERE done_by = ?").bind(event.id),
    db.prepare("DELETE FROM attachments WHERE owner_kind = 'event' AND owner_id = ?").bind(event.id),
    db.prepare("DELETE FROM events WHERE id = ?").bind(event.id),
  ]);
  await purgeMedia(c.env, "event", event.id, results.map((r) => r.r2_key));
  return c.body(null, 204);
});

/**
 * Afvinken: een geplande aankoop (een boodschap) wordt afgevinkt en telt niet (dat doet de aankoop zelf); iets anders
 * gepland (een taak) is dan gebeurd, vandaag. Herhaalt het, dan komt de volgende keer meteen gepland. `undo`: terug.
 */
events.post("/:id/tick", async (c) => {
  const db = c.env.DB;
  const { event } = await editableEvent(c, c.req.param("id"));
  const undo = asObject(await c.req.json().catch(() => ({}))).undo === true;
  if (undo) {
    await db.prepare("UPDATE events SET status = 'gepland', done_by = NULL, updated_at = datetime('now') WHERE id = ?").bind(event.id).run();
    return c.json({ status: "gepland" });
  }
  if (event.status !== "gepland") throw new ConflictError("Dit staat niet meer open.");
  const now = brusselsNow();
  const status: Status = event.base === "aankoop" ? "afgevinkt" : "gebeurd";
  const at = status === "gebeurd" ? (event.at.length > 10 ? now : now.slice(0, 10)) : event.at;
  const statements = [db.prepare("UPDATE events SET status = ?, at = ?, repeat = NULL, updated_at = datetime('now') WHERE id = ?").bind(status, at, event.id)];
  let next: string | null = null;
  if (event.repeat) {
    next = crypto.randomUUID();
    const nextAt = addToDate(event.at.slice(0, 10), event.repeat.every.n, event.repeat.every.unit) + event.at.slice(10);
    const repeat = { every: event.repeat.every, next_on: addToDate(nextAt.slice(0, 10), event.repeat.every.n, event.repeat.every.unit) };
    statements.push(
      db
        .prepare(
          `INSERT INTO events (id, list_id, kind, base, name, status, at, amount, paid_by, split, to_person, data, repeat, created_by)
           SELECT ?, list_id, kind, base, name, 'gepland', ?, amount, paid_by, split, to_person, data, ?, created_by FROM events WHERE id = ?`,
        )
        .bind(next, nextAt, JSON.stringify(repeat), event.id),
      db
        .prepare(
          `INSERT INTO lines (id, event_id, position, role, thing_id, text, amount, unit, price, expires, owner)
           SELECT lower(hex(randomblob(16))), ?, position, role, thing_id, text, amount, unit, price, NULL, owner FROM lines WHERE event_id = ?`,
        )
        .bind(next, event.id),
    );
  }
  await db.batch(statements);
  return c.json({ status, at, next });
});

/** Een activiteit die loopt (een timer) stoppen: het einde is nu. */
events.post("/:id/stop", async (c) => {
  const db = c.env.DB;
  const { event } = await editableEvent(c, c.req.param("id"));
  if (event.base !== "activiteit" || event.end_at || event.at.length <= 10) throw new ConflictError("Deze timer loopt niet.");
  const end = brusselsNow();
  await db.prepare("UPDATE events SET end_at = ?, updated_at = datetime('now') WHERE id = ?").bind(end < event.at ? event.at : end, event.id).run();
  return c.json({ end_at: end });
});

// ---------- foto en bestanden ----------

events.get("/:id/photo", async (c) => {
  const { event, role } = await findEvent(c, c.req.param("id"));
  if (!role) throw new NotFoundError("Geen foto");
  return servePhoto(c, "event", event.id);
});

events.put("/:id/photo", async (c) => {
  const { event } = await editableEvent(c, c.req.param("id"));
  const result = await storePhoto(c, "event", event.id);
  return "error" in result ? c.json(result, 400) : c.json(result);
});

events.delete("/:id/photo", async (c) => {
  const { event } = await editableEvent(c, c.req.param("id"));
  await removePhoto(c, "event", event.id);
  return c.body(null, 204);
});

events.post("/:id/files", async (c) => {
  const { event } = await editableEvent(c, c.req.param("id"));
  const result = await storeFiles(c, "event", event.id);
  return "error" in result ? c.json(result, 400) : c.json(result, 201);
});

export type { Base };
export { ids as idsParam, toLine, type EventRowDb };
