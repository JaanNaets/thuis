// Cellen in de Worker (shared/cells.ts): wat gebeurtenissen met de kolommen van dingen doen (de tabel `effects`,
// afgeleid uit de gebeurtenissen en hun formulieren) en de waarde van die kolommen voor wie leest. Een cel aanpassen
// in het ding is een Aanpassing in het logboek van zijn lijst (`adjust`).

import { allDoes, effectsOf, foldCell, STOCK, type CellEntry, type Effect, type EffectLine } from "../shared/cells";
import { formatFieldValue, type Attributes, type FieldDef, type FieldValue } from "../shared/fields";
import { ADJUST_KIND, baseKind, brusselsNow, isBase, kindInfo, type Base, type KindInfo, type List, type StockLevel } from "../shared/model";
import { stockLevel } from "../shared/stock";
import { ids, parseJson, toKind, type KindRowDb } from "./access";

/** Verhoog dit als wat een gebeurtenis doet anders uitgerekend wordt: dan bouwt de Worker alles opnieuw op. */
export const EFFECTS_VERSION = "1";
const CHUNK = 40;

async function kindsById(db: D1Database, kindIds: string[]): Promise<Map<string, KindInfo>> {
  const out = new Map<string, KindInfo>();
  const own = kindIds.filter((k) => !isBase(k) && k !== ADJUST_KIND.id);
  if (own.length) {
    const { results } = await db.prepare("SELECT * FROM kinds WHERE id IN (SELECT value FROM json_each(?))").bind(ids(own)).all<KindRowDb>();
    for (const r of results) out.set(r.id, kindInfo(toKind(r)));
  }
  return out;
}

const kindFor = (kinds: Map<string, KindInfo>, kind: string, base: Base): KindInfo =>
  kind === ADJUST_KIND.id ? ADJUST_KIND : isBase(kind) ? baseKind(kind) : (kinds.get(kind) ?? baseKind(base));

/** Wat deze gebeurtenissen doen opnieuw uitrekenen en bewaren (na elk bewaren, of als hun formulier verandert). */
export async function rebuildEffects(db: D1Database, eventIds: string[]): Promise<void> {
  for (let i = 0; i < eventIds.length; i += CHUNK) {
    const chunk = [...new Set(eventIds.slice(i, i + CHUNK))];
    const [events, lines] = (await db.batch([
      db.prepare("SELECT id, kind, base, at, amount, data FROM events WHERE id IN (SELECT value FROM json_each(?))").bind(ids(chunk)),
      db
        .prepare(
          `SELECT l.event_id, l.role, l.thing_id, t.list_id AS thing_list, l.amount, l.unit, l.price, l.expires
           FROM lines l LEFT JOIN things t ON t.id = l.thing_id WHERE l.event_id IN (SELECT value FROM json_each(?)) ORDER BY l.position`,
        )
        .bind(ids(chunk)),
    ])) as [D1Result<{ id: string; kind: string; base: Base; at: string; amount: number | null; data: string }>, D1Result<EffectLine & { event_id: string }>];
    const kinds = await kindsById(db, events.results.map((e) => e.kind));
    const statements: D1PreparedStatement[] = [db.prepare("DELETE FROM effects WHERE event_id IN (SELECT value FROM json_each(?))").bind(ids(chunk))];
    for (const e of events.results) {
      const kind = kindFor(kinds, e.kind, e.base);
      const effects = effectsOf(allDoes(kind), {
        at: e.at,
        amount: e.amount,
        data: parseJson<Attributes>(e.data, {}),
        lines: lines.results.filter((l) => l.event_id === e.id),
      });
      statements.push(...effectStatements(db, e.id, effects));
    }
    await db.batch(statements);
  }
}

function effectStatements(db: D1Database, eventId: string, effects: Effect[]): D1PreparedStatement[] {
  return effects.map((f, i) =>
    db
      .prepare("INSERT INTO effects (event_id, position, thing_id, field, op, num, val, unit, expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(eventId, i, f.thing_id, f.field, f.op, f.num, f.val === null ? null : JSON.stringify(f.val), f.unit, f.expires),
  );
}

/** Wat al deze gebeurtenissen doen, als dat nog met een oudere versie uitgerekend werd (eens per isolate nagekeken). */
let ready = false;
export async function ensureEffects(db: D1Database): Promise<void> {
  if (ready) return;
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'effects_version'").first<{ value: string }>();
  if (row?.value !== EFFECTS_VERSION) {
    const { results } = await db.prepare("SELECT id FROM events").all<{ id: string }>();
    await rebuildEffects(
      db,
      results.map((r) => r.id),
    );
    await db
      .prepare("INSERT INTO settings (key, value) VALUES ('effects_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')")
      .bind(EFFECTS_VERSION)
      .run();
  }
  ready = true;
}

/** Na een test die de databank leegmaakt (lokaal). */
export const resetEffectsCheck = () => {
  ready = false;
};

// ---------- lezen ----------

type EntryRow = { thing_id: string; field: string; op: CellEntry["op"]; num: number | null; val: string | null; unit: string | null; expires: string | null; position: number; event_id: string; at: string; created_at: string };

export type Cells = {
  /** Per ding de kolommen die het logboek invulde, met hun waarde (leeg = gewist). */
  values: Map<string, Record<string, FieldValue | undefined>>;
  /** Per ding en kolom: de gebeurtenis die ze het laatst veranderde. */
  from: Map<string, Record<string, string>>;
  /** De voorraad, als de lijst telt. */
  stock: Map<string, StockLevel>;
};

/** De kolommen van deze dingen die het logboek invult (uit alle gebeurtenissen, ook die jij niet ziet). */
export async function cellsOf(db: D1Database, list: Pick<List, "fields" | "stock">, rows: { id: string; data: Attributes }[]): Promise<Cells> {
  const out: Cells = { values: new Map(), from: new Map(), stock: new Map() };
  const keys = [...list.fields.filter((f) => f.type !== "calc").map((f) => f.key), ...(list.stock ? [STOCK] : [])];
  if (!rows.length || !keys.length) return out;
  const { results } = await db
    .prepare(
      `SELECT f.thing_id, f.field, f.op, f.num, f.val, f.unit, f.expires, f.position, f.event_id, e.at, e.created_at
       FROM effects f JOIN events e ON e.id = f.event_id
       WHERE e.status = 'gebeurd' AND f.thing_id IN (SELECT value FROM json_each(?1)) AND f.field IN (SELECT value FROM json_each(?2))`,
    )
    .bind(ids(rows.map((r) => r.id)), ids(keys))
    .all<EntryRow>();
  const byThing = new Map<string, Map<string, CellEntry[]>>();
  for (const r of results) {
    const fields = byThing.get(r.thing_id) ?? new Map<string, CellEntry[]>();
    const entry: CellEntry = { op: r.op, num: r.num, val: r.val === null ? null : parseJson<FieldValue | null>(r.val, null), unit: r.unit, expires: r.expires, at: r.at, created_at: r.created_at, position: r.position, event_id: r.event_id };
    fields.set(r.field, [...(fields.get(r.field) ?? []), entry]);
    byThing.set(r.thing_id, fields);
  }
  for (const row of rows) {
    const fields = byThing.get(row.id);
    if (list.stock) {
      const entries = fields?.get(STOCK) ?? [];
      out.stock.set(row.id, stockLevel(list.stock, row.data, entries.map((e) => ({ at: e.at, created_at: e.created_at, position: e.position, op: e.op, amount: e.num, unit: e.unit, expires: e.expires }))));
    }
    if (!fields) continue;
    const values: Record<string, FieldValue | undefined> = {};
    const from: Record<string, string> = {};
    for (const [key, entries] of fields) {
      if (key === STOCK) continue;
      const cell = foldCell(entries, row.data[key]);
      values[key] = cell.value;
      if (cell.from) from[key] = cell.from;
    }
    out.values.set(row.id, values);
    out.from.set(row.id, from);
  }
  return out;
}

/** De waarden van een ding met wat het logboek invulde. */
export function withValues(data: Attributes, values: Record<string, FieldValue | undefined> | undefined): Attributes {
  if (!values) return data;
  const out = { ...data };
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out;
}

/** Dingen met de kolommen die het logboek invult (en hun voorraad). */
export async function withCells<T extends { id: string; data: Attributes }>(db: D1Database, list: Pick<List, "fields" | "stock">, rows: T[]): Promise<{ rows: T[]; cells: Cells }> {
  const cells = await cellsOf(db, list, rows);
  return { rows: rows.map((r) => ({ ...r, data: withValues(r.data, cells.values.get(r.id)) })), cells };
}

// ---------- een cel aanpassen ----------

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Een ding bewaren waarvan het logboek kolommen invult: wat je daar verandert, wordt een Aanpassing (een gebeurtenis
 * in het logboek van de lijst die de nieuwe waarde zet); in het ding zelf blijft staan wat er stond. `data`: wat je
 * bewaart (nagekeken); geeft terug wat er in het ding komt en de statements voor de Aanpassing.
 */
export async function adjust(
  db: D1Database,
  meId: string,
  list: Pick<List, "id" | "fields" | "stock">,
  thing: { id: string; data: Attributes },
  data: Attributes,
): Promise<{ data: Attributes; statements: D1PreparedStatement[]; eventId: string | null }> {
  const cells = await cellsOf(db, list, [thing]);
  const managed = cells.from.get(thing.id) ?? {};
  const now = cells.values.get(thing.id) ?? {};
  const changes: Record<string, FieldValue | null> = {};
  const changed: FieldDef[] = [];
  const kept = { ...data };
  for (const f of list.fields) {
    if (!(f.key in managed)) continue;
    // Wat in het ding stond, blijft het begin van de cel.
    if (thing.data[f.key] === undefined) delete kept[f.key];
    else kept[f.key] = thing.data[f.key];
    if (same(data[f.key], now[f.key])) continue;
    changes[f.key] = data[f.key] ?? null;
    changed.push(f);
  }
  if (!changed.length) return { data: kept, statements: [], eventId: null };
  return { data: kept, ...adjustStatements(db, meId, list.id, thing.id, changed, changes) };
}

/** Een Aanpassing: een gebeurtenis in de lijst van het ding die deze kolommen zet. */
export function adjustStatements(db: D1Database, meId: string, listId: string, thingId: string, fields: FieldDef[], changes: Record<string, FieldValue | null>) {
  const eventId = crypto.randomUUID();
  const name = fields.map((f) => `${f.label}: ${changes[f.key] === null ? "leeg" : formatFieldValue(f, changes[f.key] ?? undefined)}`).join(" · ").slice(0, 200);
  const data = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v === null ? "" : v]));
  const statements = [
    db
      .prepare("INSERT INTO events (id, list_id, kind, base, name, status, at, data, created_by) VALUES (?, ?, ?, ?, ?, 'gebeurd', ?, ?, ?)")
      .bind(eventId, listId, ADJUST_KIND.id, ADJUST_KIND.base, name, brusselsNow(), JSON.stringify(data), meId),
    db.prepare("INSERT INTO lines (id, event_id, position, role, thing_id) VALUES (?, ?, 0, 'voor', ?)").bind(crypto.randomUUID(), eventId, thingId),
  ];
  return { statements, eventId };
}
