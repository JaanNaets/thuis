// Cellen in de Worker (shared/cells.ts): wat gebeurtenissen met de kolommen van items doen (de tabel `effects`,
// afgeleid uit de gebeurtenissen en hun formulieren) en de waarde van die kolommen voor wie leest. Een cel aanpassen
// in het item is een Aanpassing in het logboek van zijn lijst (`adjust`).

import { effectsOf, foldCell, personAmounts, STOCK, type CellEntry, type Effect, type EffectEvent, type EffectLine, type Ledger } from "../shared/cells";
import { formatFieldValue, type Attributes, type FieldDef, type FieldValue, type Share } from "../shared/fields";
import { cleanLedger } from "../shared/ledger";
import { ADJUST_KIND, baseKind, brusselsNow, isBase, kindInfo, type Base, type KindInfo, type List, type StockLevel } from "../shared/model";
import { stockLevel } from "../shared/stock";
import { ids, parseJson, toKind, type KindRowDb } from "./access";

/** Verhoog dit als wat een gebeurtenis doet anders uitgerekend wordt: dan bouwt de Worker alles opnieuw op. */
export const EFFECTS_VERSION = "2";
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

type EventRow = { id: string; kind: string; base: Base; at: string; amount: number | null; data: string; paid_by: string | null; split: string | null; to_person: string | null; created_by: string };

/**
 * De lijsten met een saldo per persoon die deze gebeurtenissen raken: hun saldokolom en de rij van elke persoon. Een
 * persoon zonder rij krijgt er een (met zijn naam, en zijn id in de kolom van de persoon).
 */
async function ledgersFor(db: D1Database, needs: Map<string, Set<string>>): Promise<Map<string, Ledger>> {
  const out = new Map<string, Ledger>();
  if (!needs.size) return out;
  const { results } = await db
    .prepare("SELECT id, fields, ledger FROM lists WHERE ledger IS NOT NULL AND id IN (SELECT value FROM json_each(?))")
    .bind(ids(needs.keys()))
    .all<{ id: string; fields: string; ledger: string }>();
  for (const l of results) {
    const def = cleanLedger(parseJson(l.ledger, null), parseJson<FieldDef[]>(l.fields, []));
    if (!def) continue;
    const { results: items } = await db.prepare("SELECT id, data FROM items WHERE list_id = ? AND archived = 0").bind(l.id).all<{ id: string; data: string }>();
    const rows = new Map<string, string>();
    for (const t of items) {
      const who = parseJson<Attributes>(t.data, {})[def.person];
      if (typeof who === "string" && !rows.has(who)) rows.set(who, t.id);
    }
    const missing = [...(needs.get(l.id) ?? [])].filter((p) => !rows.has(p));
    if (missing.length) {
      const { results: people } = await db.prepare("SELECT id, name FROM people WHERE id IN (SELECT value FROM json_each(?))").bind(ids(missing)).all<{ id: string; name: string }>();
      const made = people.map((p) => ({ ...p, item: crypto.randomUUID() }));
      if (made.length)
        await db.batch(
          made.map((p) =>
            db.prepare("INSERT INTO items (id, list_id, name, data, created_by) VALUES (?, ?, ?, ?, ?)").bind(p.item, l.id, p.name, JSON.stringify({ [def.person]: p.id }), p.id),
          ),
        );
      for (const p of made) rows.set(p.id, p.item);
    }
    out.set(l.id, { field: def.field, rows });
  }
  return out;
}

/** Wat deze gebeurtenissen doen opnieuw uitrekenen en bewaren (na elk bewaren, of als hun formulier verandert). */
export async function rebuildEffects(db: D1Database, eventIds: string[]): Promise<void> {
  for (let i = 0; i < eventIds.length; i += CHUNK) {
    const chunk = [...new Set(eventIds.slice(i, i + CHUNK))];
    const [events, lines] = (await db.batch([
      db
        .prepare("SELECT id, kind, base, at, amount, data, paid_by, split, to_person, created_by FROM events WHERE id IN (SELECT value FROM json_each(?))")
        .bind(ids(chunk)),
      db
        .prepare(
          `SELECT l.event_id, l.role, l.item_id, t.list_id AS item_list, l.amount, l.unit, l.price, l.expires, l.owner
           FROM lines l LEFT JOIN items t ON t.id = l.item_id WHERE l.event_id IN (SELECT value FROM json_each(?)) ORDER BY l.position`,
        )
        .bind(ids(chunk)),
    ])) as [D1Result<EventRow>, D1Result<EffectLine & { event_id: string }>];
    const kinds = await kindsById(db, events.results.map((e) => e.kind));
    const prepared = events.results.map((e) => {
      const kind = kindFor(kinds, e.kind, e.base);
      const input: EffectEvent = {
        at: e.at,
        amount: e.amount,
        data: parseJson<Attributes>(e.data, {}),
        lines: lines.results.filter((l) => l.event_id === e.id),
        paid_by: e.paid_by,
        split: parseJson<Share[] | null>(e.split, null),
        to_person: e.to_person,
        created_by: e.created_by,
      };
      return { id: e.id, does: kind.does, input };
    });
    // Wie in welke lijst een saldo krijgt.
    const needs = new Map<string, Set<string>>();
    for (const p of prepared)
      for (const h of p.does) {
        if (h.rows.from === "lines" || !h.list) continue;
        const list = h.list;
        const set = needs.get(list) ?? new Set<string>();
        for (const person of personAmounts(h.rows.from, p.input).keys()) set.add(person);
        needs.set(list, set);
      }
    const ledgers = await ledgersFor(db, needs);
    const statements: D1PreparedStatement[] = [db.prepare("DELETE FROM effects WHERE event_id IN (SELECT value FROM json_each(?))").bind(ids(chunk))];
    for (const p of prepared) statements.push(...effectStatements(db, p.id, effectsOf(p.does, p.input, ledgers)));
    await db.batch(statements);
  }
}

function effectStatements(db: D1Database, eventId: string, effects: Effect[]): D1PreparedStatement[] {
  return effects.map((f, i) =>
    db
      .prepare("INSERT INTO effects (event_id, position, item_id, field, op, num, val, unit, expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(eventId, i, f.item_id, f.field, f.op, f.num, f.val === null ? null : JSON.stringify(f.val), f.unit, f.expires),
  );
}

/** Wat al deze gebeurtenissen doen, als dat nog met een oudere versie uitgerekend werd (hoogstens eens per minuut nagekeken). */
let checked = 0;
export async function ensureEffects(db: D1Database): Promise<void> {
  if (Date.now() - checked < 60_000) return;
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
  checked = Date.now();
}

// ---------- lezen ----------

type EntryRow = { item_id: string; field: string; op: CellEntry["op"]; num: number | null; val: string | null; unit: string | null; expires: string | null; position: number; event_id: string; at: string; created_at: string };

export type Cells = {
  /** Per item de kolommen die het logboek invulde, met hun waarde (leeg = gewist). */
  values: Map<string, Record<string, FieldValue | undefined>>;
  /** Per item en kolom: de gebeurtenis die ze het laatst veranderde. */
  from: Map<string, Record<string, string>>;
  /** De voorraad, als de lijst telt. */
  stock: Map<string, StockLevel>;
};

/** De kolommen van deze items die het logboek invult (uit alle gebeurtenissen, ook die jij niet ziet). */
export async function cellsOf(db: D1Database, list: Pick<List, "fields" | "stock">, rows: { id: string; data: Attributes }[]): Promise<Cells> {
  const out: Cells = { values: new Map(), from: new Map(), stock: new Map() };
  const keys = [...list.fields.filter((f) => f.type !== "calc").map((f) => f.key), ...(list.stock ? [STOCK] : [])];
  if (!rows.length || !keys.length) return out;
  const { results } = await db
    .prepare(
      `SELECT f.item_id, f.field, f.op, f.num, f.val, f.unit, f.expires, f.position, f.event_id, e.at, e.created_at
       FROM effects f JOIN events e ON e.id = f.event_id
       WHERE e.status = 'gebeurd' AND f.item_id IN (SELECT value FROM json_each(?1)) AND f.field IN (SELECT value FROM json_each(?2))`,
    )
    .bind(ids(rows.map((r) => r.id)), ids(keys))
    .all<EntryRow>();
  const byItem = new Map<string, Map<string, CellEntry[]>>();
  for (const r of results) {
    const fields = byItem.get(r.item_id) ?? new Map<string, CellEntry[]>();
    const entry: CellEntry = { op: r.op, num: r.num, val: r.val === null ? null : parseJson<FieldValue | null>(r.val, null), unit: r.unit, expires: r.expires, at: r.at, created_at: r.created_at, position: r.position, event_id: r.event_id };
    fields.set(r.field, [...(fields.get(r.field) ?? []), entry]);
    byItem.set(r.item_id, fields);
  }
  for (const row of rows) {
    const fields = byItem.get(row.id);
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

/** De waarden van een item met wat het logboek invulde. */
export function withValues(data: Attributes, values: Record<string, FieldValue | undefined> | undefined): Attributes {
  if (!values) return data;
  const out = { ...data };
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out;
}

/** Items met de kolommen die het logboek invult (en hun voorraad). */
export async function withCells<T extends { id: string; data: Attributes }>(db: D1Database, list: Pick<List, "fields" | "stock">, rows: T[]): Promise<{ rows: T[]; cells: Cells }> {
  const cells = await cellsOf(db, list, rows);
  return { rows: rows.map((r) => ({ ...r, data: withValues(r.data, cells.values.get(r.id)) })), cells };
}

// ---------- een cel aanpassen ----------

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Een item bewaren waarvan het logboek kolommen invult: wat je daar verandert, wordt een Aanpassing (een gebeurtenis
 * in het logboek van de lijst die de nieuwe waarde zet); in het item zelf blijft staan wat er stond. `data`: wat je
 * bewaart (nagekeken); geeft terug wat er in het item komt en de statements voor de Aanpassing.
 */
export async function adjust(
  db: D1Database,
  meId: string,
  list: Pick<List, "id" | "fields" | "stock">,
  item: { id: string; data: Attributes },
  data: Attributes,
): Promise<{ data: Attributes; statements: D1PreparedStatement[]; eventId: string | null }> {
  const cells = await cellsOf(db, list, [item]);
  const managed = cells.from.get(item.id) ?? {};
  const now = cells.values.get(item.id) ?? {};
  const changes: Record<string, FieldValue | null> = {};
  const changed: FieldDef[] = [];
  const kept = { ...data };
  for (const f of list.fields) {
    if (!(f.key in managed)) continue;
    // Wat in het item stond, blijft het begin van de cel.
    if (item.data[f.key] === undefined) delete kept[f.key];
    else kept[f.key] = item.data[f.key];
    if (same(data[f.key], now[f.key])) continue;
    changes[f.key] = data[f.key] ?? null;
    changed.push(f);
  }
  if (!changed.length) return { data: kept, statements: [], eventId: null };
  return { data: kept, ...adjustStatements(db, meId, item.id, changed, changes) };
}

/** Een Aanpassing: een gebeurtenis die deze kolommen van het item zet (je ziet ze met de lijst van het item). */
export function adjustStatements(db: D1Database, meId: string, itemId: string, fields: FieldDef[], changes: Record<string, FieldValue | null>) {
  const eventId = crypto.randomUUID();
  const name = fields.map((f) => `${f.label}: ${changes[f.key] === null ? "leeg" : formatFieldValue(f, changes[f.key] ?? undefined)}`).join(" · ").slice(0, 200);
  const data = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v === null ? "" : v]));
  const statements = [
    db
      .prepare("INSERT INTO events (id, kind, base, name, status, at, data, created_by) VALUES (?, ?, ?, ?, 'gebeurd', ?, ?, ?)")
      .bind(eventId, ADJUST_KIND.id, ADJUST_KIND.base, name, brusselsNow(), JSON.stringify(data), meId),
    db.prepare("INSERT INTO lines (id, event_id, position, role, item_id) VALUES (?, ?, 0, 'voor', ?)").bind(crypto.randomUUID(), eventId, itemId),
  ];
  return { statements, eventId };
}
