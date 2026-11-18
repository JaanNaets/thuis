import { Hono, type Context } from "hono";
import { normalizeShares, type Attributes, type Interval, type Share } from "../../shared/fields";
import { addToDate } from "../../shared/calc";
import { ledgerLists, touchesCell } from "../../shared/cells";
import { brusselsNow, canEdit, GROUP_KEY, isAt, isLineRole, isStatus, type Base, type Event, type KindInfo, type LineRole, type Role, type Status } from "../../shared/model";
import { buysWith } from "../../shared/targets";
import { fold } from "../../shared/parse";
import { withAlias } from "../../shared/receipt";
import { lineAllowed } from "../../shared/rights";
import { normalizeUnit } from "../../shared/units";
import { ids, kindOf, needEdit, requireForm, requireList, seenAll, toEvent, toLine, type EventRowDb, type LineRowDb, type Seen } from "../access";
import { rebuildEffects } from "../cells";
import { eventRole, logbookRows, touchedLists, viewEvents, type LogOptions } from "../events-view";
import { attachmentsOf, purgeMedia, removePhoto, servePhoto, storeFiles, storePhoto } from "../media";
import { prepareData } from "../prepare";
import { knownPeople } from "./lists";
import type { AppEnv } from "../types";
import { asObject, ConflictError, NotFoundError, optionalString, ValidationError } from "../validate";
import { notifyNewEvent } from "../notify-events";

export const events = new Hono<AppEnv>();
export const listEvents = new Hono<AppEnv>();
export const formEvents = new Hono<AppEnv>();

const MAX_LINES = 80;
const MAX_PAGE = 100;
const MAX_CENTS = 100_000_000;

// ---------- lezen ----------

/** Wat je vraagt van een logboek: gepland of klaar, een periode, verder lezen (`before`), zoeken. */
function logOptions(c: Context<AppEnv>, limit: number): LogOptions {
  const status = c.req.query("status");
  return {
    status: status === "gepland" || status === "klaar" ? status : undefined,
    kind: c.req.query("formulier") || undefined,
    from: c.req.query("from") || undefined,
    to: c.req.query("to") || undefined,
    before: c.req.query("before") || undefined,
    q: c.req.query("q")?.trim() || undefined,
    limit: limit + 1,
  };
}

/** Het logboek van een lijst: wat haar items raakte (nieuwste eerst; gepland: eerst wat het eerst moet). */
listEvents.get("/:id/events", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { list } = await requireList(db, me.id, c.req.param("id"));
  const seen = await seenAll(db, me.id);
  const limit = Math.min(Number(c.req.query("limit")) || 50, MAX_PAGE);
  const rows = await logbookRows(db, { list: list.id }, logOptions(c, limit));
  const page = await viewEvents(db, seen, rows.slice(0, limit));
  return c.json({ ...page, more: rows.length > limit });
});

/** Het logboek van een formulier: alles wat ermee gelogd werd. */
formEvents.get("/:id/events", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { form } = await requireForm(db, me.id, c.req.param("id"));
  const seen = await seenAll(db, me.id);
  const limit = Math.min(Number(c.req.query("limit")) || 50, MAX_PAGE);
  const rows = await logbookRows(db, { form: form.id }, logOptions(c, limit));
  const page = await viewEvents(db, seen, rows.slice(0, limit));
  return c.json({ ...page, more: rows.length > limit });
});

type Found = { event: Event; role: Role | null; seen: Seen };

/** Een gebeurtenis die je ziet (helemaal, of enkel een lijn erin); anders "niet gevonden". */
async function findEvent(c: Context<AppEnv>, id: string): Promise<Found> {
  const db = c.env.DB;
  const row = await db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventRowDb>();
  if (!row) throw new NotFoundError("Dat bestaat niet (meer), of je kan er niet bij.");
  const seen = await seenAll(db, c.get("person").id);
  const touched = (await touchedLists(db, [id])).get(id) ?? [];
  return { event: toEvent(row), role: eventRole(seen, row.kind, touched), seen };
}

/** Om te wijzigen: je moet het formulier van de gebeurtenis mogen gebruiken (een Aanpassing: de lijst van haar item). */
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

async function tickedBy(db: D1Database, seen: Seen, eventId: string) {
  const { results } = await db.prepare("SELECT id, name, kind FROM events WHERE done_by = ?").bind(eventId).all<{ id: string; name: string; kind: string }>();
  return results.filter((r) => seen.forms.has(r.kind)).map((r) => ({ id: r.id, name: r.name }));
}

// ---------- invoer nakijken ----------

type CleanLine = {
  role: LineRole;
  /** De groep van het formulier (de `key`); haar rol is die van de lijn. */
  group: string;
  item_id: string | null;
  text: string | null;
  amount: number | null;
  unit: string | null;
  price: number | null;
  expires: string | null;
  owner: string | null;
  /** `alias`: de naam op het kasticket als het item anders heet (Go-tan wok → Noedels), in zijn tekstveld met `aliases`. */
  new_item: { list_id: string; name: string; data: Attributes; alias: string | null } | null;
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
 * Een gebeurtenis van buiten nakijken met haar formulier: personen moet je kennen, items moet je zien en wat het
 * formulier eraan verandert ook mogen wijzigen (shared/rights.ts). `before`: de lijnen die er al stonden; een lijn die
 * niet verandert, mag altijd blijven.
 */
async function cleanEvent(
  db: D1Database,
  meId: string,
  seenAccess: Seen,
  kind: KindInfo,
  raw: Record<string, unknown>,
  before: { data: Attributes; lines: CleanLine[] } | null,
): Promise<CleanEvent> {
  const seen = seenAccess.lists;
  const does = kind.does;
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
    // De groep zegt de rol; zonder groep (van vroeger, of de groep is er niet meer) de eerste groep met die rol.
    const wanted = typeof o.group === "string" && GROUP_KEY.test(o.group) ? o.group : null;
    const known = wanted ? kind.parts.groups.find((g) => g.key === wanted) : undefined;
    const role = known?.role ?? (isLineRole(o.role) ? o.role : null);
    if (!role) throw new ValidationError("Onbekende rol van een lijn");
    const group = known?.key ?? wanted ?? kind.parts.groups.find((g) => g.role === role)?.key ?? role;
    const newItem = o.new_item && typeof o.new_item === "object" ? asObject(o.new_item) : null;
    const text = optionalString(o, "text", 200);
    const expires = optionalString(o, "expires", 10);
    if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) throw new ValidationError("Houdbaar tot moet een datum zijn");
    return {
      role,
      group,
      item_id: typeof o.item_id === "string" && o.item_id ? o.item_id : null,
      text,
      amount: num(o.amount, "Hoeveel", 0, 1_000_000),
      unit: normalizeUnit(optionalString(o, "unit", 20)),
      price: cents(o.price, "De prijs"),
      expires,
      owner: person(o.owner, "Van wie"),
      new_item: newItem
        ? {
            list_id: typeof newItem.list_id === "string" ? newItem.list_id : "",
            name: optionalString(newItem, "name", 200) ?? "",
            data: (newItem.data ?? {}) as Attributes,
            alias: optionalString(newItem, "alias", 80),
          }
        : null,
    } satisfies CleanLine;
  });
  // De items: bestaan ze, en mag je ermee doen wat de lijn zegt?
  const itemIds = parsed.flatMap((l) => (l.item_id ? [l.item_id] : []));
  const { results } = itemIds.length
    ? await db
        .prepare("SELECT t.id, t.list_id, t.name, l.stock IS NOT NULL AS counts FROM items t JOIN lists l ON l.id = t.list_id WHERE t.id IN (SELECT value FROM json_each(?))")
        .bind(ids(itemIds))
        .all<{ id: string; list_id: string; name: string; counts: number }>()
    : { results: [] as { id: string; list_id: string; name: string; counts: number }[] };
  const listOf = new Map(results.map((r) => [r.id, r.list_id]));
  const counts = new Set(results.filter((r) => r.counts).map((r) => r.list_id));
  const unchanged = (l: CleanLine) =>
    before?.lines.some((b) => b.item_id === l.item_id && b.role === l.role && b.group === l.group && b.amount === l.amount && (b.unit ?? null) === (l.unit ?? null)) ?? false;
  const lines: CleanLine[] = [];
  for (const l of parsed) {
    if (l.new_item) {
      const target = seen.get(l.new_item.list_id);
      if (!target || !l.new_item.name) throw new ValidationError("Kies een lijst voor het nieuwe item");
      if (!lineAllowed(l.role, target)) throw new ValidationError(`Je mag niets toevoegen aan die lijst (${l.new_item.name})`);
      lines.push({ ...l, item_id: null, text: null });
      continue;
    }
    if (l.item_id) {
      const list = listOf.get(l.item_id);
      if (!list) {
        // Het item bestaat niet meer: hou de tekst.
        if (l.text) lines.push({ ...l, item_id: null });
        continue;
      }
      // De naam enkel als je de lijst van het item ziet.
      const name = () => (seen.has(list) ? (results.find((r) => r.id === l.item_id)?.name ?? "dat item") : "dat item");
      if (!unchanged(l) && !lineAllowed(l.role, seen.get(list) ?? null)) {
        throw new ValidationError(
          l.role === "in" || l.role === "uit" ? `Je mag de voorraad van ${name()} niet wijzigen` : `Je kan niet naar ${name()} verwijzen`,
        );
      }
      // Vult het formulier een kolom van dit item in, dan moet je zijn lijst mogen wijzigen (shared/cells.ts).
      if (!unchanged(l) && touchesCell(does, l.group, list, counts.has(list)) && !canEdit(seen.get(list))) {
        throw new ValidationError(`Je mag ${name()} niet aanpassen`);
      }
      lines.push({ ...l, text: null });
      continue;
    }
    if (l.text) lines.push(l);
  }
  // Een groep lijnen uit bepaalde lijsten (Ruimte uit Huis, een fles uit Wijnen of de kelder): enkel items daaruit.
  for (const l of lines) {
    const group = kind.parts.groups.find((g) => g.key === l.group && g.lists.length);
    const list = l.new_item ? l.new_item.list_id : l.item_id ? listOf.get(l.item_id) : null;
    if (group && list && !group.lists.includes(list)) throw new ValidationError(`Bij ${group.label} hoort een item uit een andere lijst`);
  }
  const amount = cents(raw.amount, "Het bedrag");
  const every = raw.repeat && typeof raw.repeat === "object" ? (asObject(raw.repeat).every as Interval | undefined) : undefined;
  const repeat =
    every && Number.isInteger(every.n) && every.n > 0 && every.n <= 365 && ["day", "week", "month", "year"].includes(every.unit)
      ? { every: { n: every.n, unit: every.unit }, next_on: addToDate(at.slice(0, 10), every.n, every.unit) }
      : null;
  // Houdt het formulier een saldo bij in een lijst, dan moet je die lijst mogen wijzigen.
  for (const l of ledgerLists(does)) {
    if (!canEdit(seen.get(l))) throw new ValidationError("Dit formulier houdt een saldo bij in een lijst die je niet mag wijzigen");
  }
  return {
    kind,
    name: optionalString(raw, "name", 200) ?? "",
    status,
    at,
    end_at: kind.parts.duration ? endAt : null,
    amount: kind.parts.money || amount !== null ? amount : null,
    paid_by: person(raw.paid_by, "Betaald door"),
    split,
    to_person: kind.parts.to ? person(raw.to_person, "Naar") : null,
    data,
    lines,
    repeat,
  };
}

function lineStatements(db: D1Database, eventId: string, lines: CleanLine[], newIds: Map<number, string>): D1PreparedStatement[] {
  return lines.map((l, i) =>
    db
      .prepare("INSERT INTO lines (id, event_id, position, role, grp, item_id, text, amount, unit, price, expires, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), eventId, i, l.role, l.group, newIds.get(i) ?? l.item_id, l.text, l.amount, l.unit, l.price, l.expires, l.owner),
  );
}

/** Nieuwe items uit lijnen (een product dat nog niet bestond), nagekeken zoals elk item. */
async function newItemStatements(db: D1Database, meId: string, seen: Map<string, Role>, lines: CleanLine[]) {
  const statements: D1PreparedStatement[] = [];
  const newIds = new Map<number, string>();
  const made: { id: string; name: string; list_id: string }[] = [];
  for (const [i, l] of lines.entries()) {
    if (!l.new_item) continue;
    const { list } = await requireList(db, meId, l.new_item.list_id);
    if (!list.one) throw new ValidationError(`${list.name} heeft geen items`);
    const data = await prepareData(db, meId, seen, list.fields, l.new_item.data);
    const aliasField = list.fields.find((f) => f.type === "text" && f.aliases);
    const alias = aliasField && l.new_item.alias && fold(l.new_item.alias) !== fold(l.new_item.name) ? withAlias(data[aliasField.key], l.new_item.alias) : null;
    if (aliasField && alias) data[aliasField.key] = alias;
    const id = crypto.randomUUID();
    statements.push(db.prepare("INSERT INTO items (id, list_id, name, data, created_by) VALUES (?, ?, ?, ?, ?)").bind(id, list.id, l.new_item.name, JSON.stringify(data), meId));
    newIds.set(i, id);
    made.push({ id, name: l.new_item.name, list_id: list.id });
  }
  return { statements, newIds, made };
}

/**
 * Een aankoop vinkt open boodschappen af: geplande gebeurtenissen met formulieren die je mag gebruiken en die
 * kopen (`buysWith`) en een lijn erbij voor hetzelfde item (of een tekst met dezelfde naam).
 */
async function tickShopping(db: D1Database, seen: Seen, eventId: string, itemIds: string[]): Promise<{ id: string; name: string }[]> {
  if (!itemIds.length) return [];
  const { results: names } = await db.prepare("SELECT lower(name) AS name FROM items WHERE id IN (SELECT value FROM json_each(?))").bind(ids(itemIds)).all<{ name: string }>();
  const editable = [...seen.forms].filter(([, r]) => canEdit(r)).map(([id]) => id);
  const { results: found } = await db
    .prepare(
      `SELECT DISTINCT e.id, e.name, e.kind, e.base FROM events e JOIN lines l ON l.event_id = e.id
       WHERE e.status = 'gepland' AND e.id != ?1 AND e.kind IN (SELECT value FROM json_each(?2)) AND l.role = 'in'
         AND (l.item_id IN (SELECT value FROM json_each(?3)) OR (l.item_id IS NULL AND lower(l.text) IN (SELECT value FROM json_each(?4))))`,
    )
    .bind(eventId, ids(editable), ids(itemIds), ids(names.map((n) => n.name)))
    .all<{ id: string; name: string; kind: string; base: Base }>();
  const results: { id: string; name: string }[] = [];
  for (const r of found) if (buysWith(await kindOf(db, r.kind, r.base))) results.push({ id: r.id, name: r.name });
  if (results.length)
    await db.prepare("UPDATE events SET status = 'afgevinkt', done_by = ?, updated_at = datetime('now') WHERE id IN (SELECT value FROM json_each(?))").bind(eventId, ids(results.map((r) => r.id))).run();
  return results;
}

// ---------- bewaren ----------

/** Loggen met een formulier: de gebeurtenis komt in zijn logboek. */
formEvents.post("/:id/events", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { form, role } = await requireForm(db, me.id, c.req.param("id"));
  needEdit(role, "Met dit formulier mag je enkel kijken.");
  const seen = await seenAll(db, me.id);
  const input = await cleanEvent(db, me.id, seen, form, asObject(await c.req.json()), null);
  const id = crypto.randomUUID();
  const fresh = await newItemStatements(db, me.id, seen.lists, input.lines);
  await db.batch([
    ...fresh.statements,
    db
      .prepare(
        `INSERT INTO events (id, kind, base, name, status, at, end_at, amount, paid_by, split, to_person, data, repeat, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
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
  await rebuildEffects(db, [id]);
  const bought = input.lines.flatMap((l, i) => (l.role === "in" ? [fresh.newIds.get(i) ?? l.item_id].filter((x): x is string => Boolean(x)) : []));
  const ticked = buysWith(input.kind) && input.status === "gebeurd" ? await tickShopping(db, seen, id, bought) : [];
  if (input.status !== "gepland") c.executionCtx.waitUntil(notifyNewEvent(c.env, me, id).catch((err) => console.error("melding", err)));
  return c.json({ id, made: fresh.made, ticked }, 201);
});

events.put("/:id", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { event, seen } = await editableEvent(c, c.req.param("id"));
  const { results: oldRows } = await db
    .prepare("SELECT l.*, t.list_id AS item_list FROM lines l LEFT JOIN items t ON t.id = l.item_id WHERE l.event_id = ? ORDER BY l.position")
    .bind(event.id)
    .all<LineRowDb & { item_list: string | null }>();
  const old = oldRows.map((r) => ({ ...toLine(r), item_list: r.item_list, new_item: null }));
  const body = asObject(await c.req.json());
  // Een ander formulier (en zo een ander logboek) mag, als je dat ook mag gebruiken.
  const wanted = typeof body.kind === "string" && body.kind !== event.kind && canEdit(seen.forms.get(body.kind)) ? body.kind : event.kind;
  const kind = await kindOf(db, wanted, event.base);
  const input = await cleanEvent(db, me.id, seen, kind, body, { data: event.data, lines: old });
  // Lijnen naar items die jij niet ziet, blijven staan zoals ze waren.
  const hidden = old.filter((l) => l.item_list && !seen.lists.has(l.item_list)).map(({ item_list: _t, id: _i, position: _p, ...l }) => ({ ...l, new_item: null }));
  const fresh = await newItemStatements(db, me.id, seen.lists, input.lines);
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
  await rebuildEffects(db, [event.id]);
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
  const status: Status = buysWith(await kindOf(db, event.kind, event.base)) ? "afgevinkt" : "gebeurd";
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
          `INSERT INTO events (id, kind, base, name, status, at, amount, paid_by, split, to_person, data, repeat, created_by)
           SELECT ?, kind, base, name, 'gepland', ?, amount, paid_by, split, to_person, data, ?, created_by FROM events WHERE id = ?`,
        )
        .bind(next, nextAt, JSON.stringify(repeat), event.id),
      db
        .prepare(
          `INSERT INTO lines (id, event_id, position, role, grp, item_id, text, amount, unit, price, expires, owner)
           SELECT lower(hex(randomblob(16))), ?, position, role, grp, item_id, text, amount, unit, price, NULL, owner FROM lines WHERE event_id = ?`,
        )
        .bind(next, event.id),
    );
  }
  await db.batch(statements);
  if (next) await rebuildEffects(db, [next]);
  return c.json({ status, at, next });
});

/** Een activiteit die loopt (een timer) stoppen: het einde is nu. */
events.post("/:id/stop", async (c) => {
  const db = c.env.DB;
  const { event } = await editableEvent(c, c.req.param("id"));
  if (!(await kindOf(db, event.kind, event.base)).parts.duration || event.end_at || event.at.length <= 10) throw new ConflictError("Deze timer loopt niet.");
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
