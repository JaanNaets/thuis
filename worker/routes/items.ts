import { Hono } from "hono";
import { computeLocal, isLinkCalc } from "../../shared/calc";
import { referencedItems, referencedPeople, type Attributes } from "../../shared/fields";
import { brusselsNow, canEdit, type LineRole, type List, type Role, type StockLevel, type ItemRef, type ItemRow } from "../../shared/model";
import { measureFor, unitPrice } from "../../shared/stock";
import { normalizeUnit } from "../../shared/units";
import type { Person } from "../../shared/types";
import { brusselsToday } from "../today";
import { ADJUST } from "../../shared/cells";
import { ids, kindOf, needEdit, requireList, requireItem, seenAll, seenForms, seenLists, toItem, type ItemRowDb } from "../access";
import { adjust, cellsOf, rebuildEffects, withCells, withValues } from "../cells";
import { attachmentsOf, purgeMedia, removePhoto, servePhoto, storeFiles, storePhoto } from "../media";
import { lockedOf, syncFrom } from "../mirrors";
import { prepareData } from "../prepare";
import { cleanPlan, MAX_TRANSFER, transferRows, type TransferPlan } from "../../shared/transfer";
import type { AppEnv } from "../types";
import { asObject, NotFoundError, optionalString, requiredString, ValidationError } from "../validate";

export const items = new Hono<AppEnv>();
export const listItems = new Hono<AppEnv>();

const MAX_ITEMS = 2000;

/** De voorraad van items in een lijst die telt (uit alle lijnen, ook van gebeurtenissen die jij niet ziet). */
export async function stockOf(db: D1Database, list: Pick<List, "stock">, rows: { id: string; data: Attributes }[]): Promise<Map<string, StockLevel>> {
  if (!list.stock || !rows.length) return new Map();
  return (await cellsOf(db, { fields: [], stock: list.stock }, rows)).stock;
}

/** Namen van items (voor verwijzingen en lijnen), enkel uit lijsten die je ziet. */
export async function itemRefs(db: D1Database, seen: Map<string, Role>, itemIds: Iterable<string>): Promise<ItemRef[]> {
  const list = [...new Set(itemIds)];
  if (!list.length) return [];
  const { results } = await db
    .prepare(
      `SELECT t.id, t.name, t.list_id, t.data, l.name AS list, l.stock, l.fields FROM items t JOIN lists l ON l.id = t.list_id
       WHERE t.id IN (SELECT value FROM json_each(?))`,
    )
    .bind(ids(list))
    .all<{ id: string; name: string; list_id: string; list: string; data: string; stock: string | null; fields: string }>();
  return results
    .filter((r) => seen.has(r.list_id))
    .map((r) => ({ id: r.id, name: r.name, list_id: r.list_id, list: r.list, unit: unitOf(r) }));
}

/** De eenheid van een item in een lijst die telt. */
function unitOf(r: { data: string; stock: string | null }): string | null {
  if (!r.stock) return null;
  try {
    return measureFor(JSON.parse(r.stock), JSON.parse(r.data)).unit;
  } catch {
    return null;
  }
}

/** Personen (enkel naam en kleur) bij ids. */
export async function peopleByIds(db: D1Database, personIds: Iterable<string>): Promise<Person[]> {
  const list = [...new Set(personIds)].filter(Boolean);
  if (!list.length) return [];
  const { results } = await db.prepare("SELECT id, name, email, color, NULL AS iban FROM people WHERE id IN (SELECT value FROM json_each(?))").bind(ids(list)).all<Person>();
  return results.map((p) => ({ ...p, email: null }));
}

/** Waarden om te tonen: met de berekeningen uitgerekend. */
export const shown = (fields: List["fields"], data: Attributes, today: string): Attributes =>
  fields.some((f) => f.type === "calc" && !isLinkCalc(f)) ? computeLocal(fields, data, today) : data;

// ---------- een lijst ----------

listItems.get("/:id/items", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { list } = await requireList(db, me.id, c.req.param("id"));
  const archived = c.req.query("archived") === "1" ? 1 : 0;
  const q = c.req.query("q")?.trim();
  const { results } = await db
    .prepare(`SELECT * FROM items WHERE list_id = ? AND archived = ? ${q ? "AND name LIKE ?" : ""} ORDER BY name COLLATE NOCASE LIMIT ${MAX_ITEMS}`)
    .bind(...[list.id, archived, ...(q ? [`%${q}%`] : [])])
    .all<ItemRowDb>();
  const today = brusselsToday();
  const { rows, cells } = await withCells(db, list, results.map(toItem));
  const stock = cells.stock;
  const seen = await seenLists(db, me.id);
  const out: ItemRow[] = rows.map((t) => ({ ...t, data: shown(list.fields, t.data, today), ...(list.stock ? { stock: stock.get(t.id) ?? null } : {}) }));
  return c.json({
    items: out,
    people: await peopleByIds(db, rows.flatMap((t) => referencedPeople(list.fields, t.data))),
    refs: await itemRefs(db, seen, [...rows.flatMap((t) => referencedItems(list.fields, t.data).map((r) => r.id)), ...rows.flatMap((t) => (t.part_of ? [t.part_of] : []))]),
  });
});

listItems.post("/:id/items", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { list, role } = await requireList(db, me.id, c.req.param("id"));
  needEdit(role);
  if (!list.one) throw new ValidationError("Deze lijst heeft geen items, enkel een logboek.");
  const body = asObject(await c.req.json());
  const seen = await seenLists(db, me.id);
  const id = crypto.randomUUID();
  const data = await prepareData(db, me.id, seen, list.fields, body.data);
  const partOf = await checkPartOf(db, seen, optionalString(body, "part_of", 64), id);
  await db
    .prepare("INSERT INTO items (id, list_id, name, data, part_of, created_by) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, list.id, requiredString(body, "name", 200), JSON.stringify(data), partOf, me.id)
    .run();
  await syncFrom(db, list.id);
  return c.json({ id }, 201);
});

/**
 * Waarvan een item een deel is: een item dat je ziet, en geen kring (de fiets kan geen deel zijn van haar eigen pedaal,
 * ook niet langs andere delen).
 */
async function checkPartOf(db: D1Database, seen: Map<string, Role>, partOf: string | null, self: string): Promise<string | null> {
  if (!partOf || partOf === self) return null;
  const row = await db.prepare("SELECT id, list_id FROM items WHERE id = ?").bind(partOf).first<{ id: string; list_id: string }>();
  if (!row || !seen.has(row.list_id)) return null;
  const { results } = await db
    .prepare(
      `WITH RECURSIVE up(id, depth) AS (SELECT ?1, 0 UNION SELECT i.part_of, up.depth + 1 FROM items i JOIN up ON i.id = up.id WHERE i.part_of IS NOT NULL AND up.depth < 50)
       SELECT id FROM up WHERE id = ?2 LIMIT 1`,
    )
    .bind(row.id, self)
    .all<{ id: string }>();
  if (results.length) throw new ValidationError("Dat item is zelf al een deel hiervan");
  return row.id;
}

/** Items uit een tabel (zie src/pages/ImportPage.tsx): elke rij zoals een gewoon nieuw item; wat niet lukt, slaat over. */
listItems.post("/:id/items/import", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { list, role } = await requireList(db, me.id, c.req.param("id"));
  needEdit(role);
  if (!list.one) throw new ValidationError("Deze lijst heeft geen items, enkel een logboek.");
  const rows = asObject(await c.req.json()).rows;
  if (!Array.isArray(rows) || rows.length > 2000) throw new ValidationError("Hoogstens 2000 rijen tegelijk");
  const seen = await seenLists(db, me.id);
  const statements: D1PreparedStatement[] = [];
  const skipped: { row: number; error: string }[] = [];
  for (const [i, raw] of rows.entries()) {
    try {
      const r = asObject(raw);
      const name = requiredString(r, "name", 200);
      const data = await prepareData(db, me.id, seen, list.fields, r.data);
      statements.push(db.prepare("INSERT INTO items (id, list_id, name, data, created_by) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), list.id, name, JSON.stringify(data), me.id));
    } catch (err) {
      skipped.push({ row: i + 2, error: err instanceof Error ? err.message : "Ongeldig" });
    }
  }
  for (let k = 0; k < statements.length; k += 100) await db.batch(statements.slice(k, k + 100));
  await syncFrom(db, list.id);
  return c.json({ created: statements.length, skipped });
});

/**
 * Toevoegen uit een andere lijst (zie shared/transfer.ts): de server rekent het plan opnieuw uit met wat de lezer van de
 * bron ziet. Zonder Weghalen komen er nieuwe items bij (zoals Importeren); met Weghalen verhuist het item zelf (dezelfde
 * id: foto, logboek en voorraad gaan mee), enkel als je de bron mag wijzigen. Elke waarde gaat door `prepareData`.
 */
listItems.post("/:id/items/from", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { list, role } = await requireList(db, me.id, c.req.param("id"));
  needEdit(role);
  if (!list.one) throw new ValidationError("Deze lijst heeft geen items, enkel een logboek.");
  const body = asObject(await c.req.json());
  const sourceId = typeof body.source === "string" ? body.source : "";
  if (!sourceId || sourceId === list.id) throw new ValidationError("Kies een andere lijst.");
  const { list: source, role: sourceRole } = await requireList(db, me.id, sourceId);
  if (!source.one) throw new ValidationError("Die lijst heeft geen items.");
  let plan: TransferPlan;
  try {
    plan = cleanPlan(body, source, list.fields);
  } catch (err) {
    throw new ValidationError((err as Error).message);
  }
  if (plan.mode === "link") throw new ValidationError("Een koppeling bewaar je bij Koppelen.");
  const move = plan.mode === "move";
  if (move) needEdit(sourceRole, "Enkel wie die lijst mag wijzigen, haalt er iets uit weg.");
  const { results } = await db
    .prepare(`SELECT * FROM items WHERE list_id = ? AND archived = 0 ORDER BY name COLLATE NOCASE LIMIT ${MAX_TRANSFER}`)
    .bind(source.id)
    .all<ItemRowDb>();
  const today = brusselsToday();
  const rows = (await withCells(db, source, results.map(toItem))).rows;
  const seen = await seenLists(db, me.id);
  const people = new Map((await peopleByIds(db, rows.flatMap((t) => referencedPeople(source.fields, t.data)))).map((p) => [p.id, p.name]));
  const refs = new Map((await itemRefs(db, seen, rows.flatMap((t) => referencedItems(source.fields, t.data).map((r) => r.id)))).map((r) => [r.id, r.name]));
  const names = { person: (id: string) => people.get(id) ?? "?", item: (id: string) => refs.get(id) ?? "?" };
  const sourceItems = rows.map((t) => ({ id: t.id, name: t.name, data: shown(source.fields, t.data, today), tag_ids: [], created_at: t.created_at }));
  const out = transferRows(sourceItems, plan, source.fields, list.fields, { today, me: me.id, names });
  const statements: D1PreparedStatement[] = [];
  const skipped: { name: string; error: string }[] = [];
  for (const r of out) {
    try {
      const data = await prepareData(db, me.id, seen, list.fields, r.data);
      statements.push(
        move
          ? db
              .prepare("UPDATE items SET list_id = ?, name = ?, data = ?, updated_at = datetime('now') WHERE id = ? AND list_id = ?")
              .bind(list.id, r.name, JSON.stringify(data), r.source_id, source.id)
          : db.prepare("INSERT INTO items (id, list_id, name, data, created_by) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), list.id, r.name, JSON.stringify(data), me.id),
      );
    } catch (err) {
      skipped.push({ name: r.name, error: err instanceof Error ? err.message : "Ongeldig" });
    }
  }
  for (let k = 0; k < statements.length; k += 100) await db.batch(statements.slice(k, k + 100));
  await syncFrom(db, list.id);
  if (move) await syncFrom(db, source.id);
  return c.json({ created: statements.length, skipped });
});

// ---------- zoeken en kiezen ----------

/**
 * Items om te kiezen of te herkennen, uit de lijsten die je ziet (`lists`: enkel die): op naam (`q`), de namen die
 * in een tekst staan (`in`: "yoghurt colruyt 6 euro" → Yoghurt en Colruyt), of bij ids (`ids`). Nooit een hele lijst.
 */
items.get("/", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const seen = await seenLists(db, me.id);
  const wanted = (c.req.query("lists") ?? "").split(",").filter(Boolean);
  const scope = wanted.length ? wanted.filter((id) => seen.has(id)) : [...seen.keys()];
  const limit = Math.min(Number(c.req.query("limit")) || 20, 50);
  const q = c.req.query("q")?.trim() ?? "";
  const text = c.req.query("in")?.trim().toLowerCase() ?? "";
  const chosen = (c.req.query("ids") ?? "").split(",").filter(Boolean).slice(0, 100);
  if (chosen.length) return c.json({ items: await itemRefs(db, seen, chosen), more: false });
  // In een tekst: de hele naam, of een woord van minstens 4 letters uit de naam ("sprinter" → Mercedes Sprinter).
  const words = text ? [...new Set(text.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !/^\d+$/.test(w)))].slice(0, 8) : [];
  const where = text
    ? `(instr(?2, lower(t.name)) > 0 AND length(t.name) >= 2)${words.map((_, i) => ` OR lower(t.name) LIKE ?${i + 3}`).join("")}`
    : "t.name LIKE ?2";
  const { results: rows } = await db
    .prepare(
      `SELECT t.id, t.name, t.list_id, t.data, l.name AS list, l.stock FROM items t JOIN lists l ON l.id = t.list_id
       WHERE t.list_id IN (SELECT value FROM json_each(?1)) AND t.archived = 0 AND (${where})
       ORDER BY ${text ? "length(t.name) DESC" : "t.name COLLATE NOCASE"} LIMIT ${text ? 200 : limit + 1}`,
    )
    .bind(ids(scope), text ? text : `%${q}%`, ...words.map((w) => `%${w}%`))
    .all<{ id: string; name: string; list_id: string; list: string; data: string; stock: string | null }>();
  // Een woord moet een heel woord van de naam zijn (geen "pasta" in "pastasaus"); de hele naam eerst.
  const whole = (name: string) => text.includes(name.toLowerCase());
  const results = text
    ? rows
        .filter((r) => whole(r.name) || r.name.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((w) => words.includes(w)))
        .sort((a, b) => Number(whole(b.name)) - Number(whole(a.name)) || b.name.length - a.name.length)
    : rows;
  const found = results.slice(0, limit);
  const usual = text ? await usualRoles(db, await seenForms(db, me.id), found) : new Map<string, LineRole>();
  return c.json({
    items: found.map(
      (r) =>
        ({
          id: r.id,
          name: r.name,
          list_id: r.list_id,
          list: r.list,
          unit: unitOf(r),
          ...(text ? { usual: usual.get(r.id) ?? null, stock: Boolean(r.stock) } : {}),
        }) satisfies ItemRef,
    ),
    more: results.length > limit,
  });
});

/**
 * Welke rol een item meestal heeft (Colruyt: bij, de wagen: voor), uit de lijnen in wat de lezer ziet; zonder
 * geschiedenis die van de andere items in zijn lijst (een nieuwe winkel in Winkels: bij).
 */
async function usualRoles(db: D1Database, forms: Map<string, Role>, found: { id: string; list_id: string }[]): Promise<Map<string, LineRole>> {
  if (!found.length) return new Map();
  const { results } = await db
    .prepare(
      `SELECT t.id AS item_id, t.list_id, l.role, COUNT(*) AS n FROM lines l JOIN items t ON t.id = l.item_id JOIN events e ON e.id = l.event_id
       WHERE t.list_id IN (SELECT value FROM json_each(?1)) AND e.kind IN (SELECT value FROM json_each(?2)) GROUP BY t.id, l.role`,
    )
    .bind(ids(new Set(found.map((f) => f.list_id))), ids(forms.keys()))
    .all<{ item_id: string; list_id: string; role: LineRole; n: number }>();
  const top = (rows: typeof results) => {
    const sums = new Map<LineRole, number>();
    for (const r of rows) sums.set(r.role, (sums.get(r.role) ?? 0) + r.n);
    return [...sums].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const out = new Map<string, LineRole>();
  for (const f of found) {
    const role = top(results.filter((r) => r.item_id === f.id)) ?? top(results.filter((r) => r.list_id === f.list_id));
    if (role) out.set(f.id, role);
  }
  return out;
}

// ---------- één item ----------

/** Een lijn op de tijdlijn van een item, met de kop van haar gebeurtenis. */
type TimelineEntry = {
  event_id: string;
  kind: string;
  kind_name: string;
  base: string;
  status: string;
  at: string;
  partial: boolean;
  name: string;
  role: string;
  amount: number | null;
  unit: string | null;
  price: number | null;
  unit_price: number | null;
  expires: string | null;
  /** Waar (de lijn `bij`), enkel bij een gebeurtenis die je helemaal ziet. */
  store: string | null;
  created_by: string;
};

items.get("/:id", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { item, list, role } = await requireItem(db, me.id, c.req.param("id"));
  const { lists: seen, forms } = await seenAll(db, me.id);
  const today = brusselsToday();
  const [lines, parts] = (await db.batch([
    db
      .prepare(
        `SELECT l.role, l.amount, l.unit, l.price, l.expires, e.id AS event_id, e.kind, e.base, e.status, e.at, e.name, e.created_by,
                e.amount AS event_amount, (SELECT COUNT(*) FROM lines x WHERE x.event_id = e.id AND x.role != 'bij') AS main_lines
         FROM lines l JOIN events e ON e.id = l.event_id
         WHERE l.item_id = ? ORDER BY e.at DESC, e.created_at DESC LIMIT 300`,
      )
      .bind(item.id),
    db.prepare("SELECT id, name, list_id FROM items WHERE part_of = ?").bind(item.id),
  ])) as [D1Result<Omit<TimelineEntry, "partial" | "store" | "unit_price" | "kind_name"> & { event_amount: number | null; main_lines: number }>, D1Result<{ id: string; name: string; list_id: string }>];
  // Helemaal als je het formulier ziet (een Aanpassing: dit item zie je); anders zonder naam, bedrag of waar.
  const whole = (kind: string) => kind === ADJUST || forms.has(kind);
  const visible = lines.results.filter((l) => whole(l.kind) || l.role !== "bij");
  const full = visible.filter((l) => whole(l.kind)).map((l) => l.event_id);
  const { results: stores } = await db
    .prepare(
      `SELECT l.event_id, COALESCE(t.name, l.text) AS name FROM lines l LEFT JOIN items t ON t.id = l.item_id
       WHERE l.role = 'bij' AND l.event_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(ids(full))
    .all<{ event_id: string; name: string | null }>();
  const storeOf = new Map(stores.map((s) => [s.event_id, s.name]));
  const measure = list.stock ? measureFor(list.stock, item.data) : { unit: null };
  const kindNames = new Map<string, string>();
  for (const l of visible) if (!kindNames.has(l.kind)) kindNames.set(l.kind, (await kindOf(db, l.kind, l.base as never)).name);
  const timeline: TimelineEntry[] = visible.map(({ event_amount, main_lines, ...l }) => {
    const partial = !whole(l.kind);
    return {
      ...l,
      // Gaat de gebeurtenis enkel over dit item (een tankbeurt voor de wagen), dan is haar bedrag het zijne.
      price: l.price ?? (!partial && main_lines === 1 ? event_amount : null),
      kind_name: kindNames.get(l.kind) ?? l.kind,
      partial,
      name: partial ? "" : l.name,
      store: partial ? null : (storeOf.get(l.event_id) ?? null),
      unit_price: unitPrice(l.price, l.amount, l.unit, measure),
    };
  });
  const cells = await cellsOf(db, list, [item]);
  const stock = list.stock ? cells.stock.get(item.id) : null;
  const filled = withValues(item.data, cells.values.get(item.id));
  const locked = item.mirror_id ? await lockedOf(db, item.mirror_id) : null;
  const mirror = locked
    ? {
        source: seen.has(locked.source.id) ? locked.source : null,
        of: item.mirror_of ? ((await itemRefs(db, seen, [item.mirror_of]))[0] ?? null) : null,
        locked: locked.keys,
      }
    : null;
  return c.json({
    mirror,
    item: { ...item, data: shown(list.fields, filled, today) },
    // Welke kolommen het logboek invult, en de gebeurtenis die elk het laatst veranderde.
    cells: cells.from.get(item.id) ?? {},
    list: { id: list.id, name: list.name, one: list.one, icon: list.icon, color: list.color, fields: list.fields, stock: list.stock },
    role,
    can_edit: canEdit(role),
    stock: stock ?? null,
    timeline,
    parts: parts.results.filter((p) => seen.has(p.list_id)),
    part_of: item.part_of ? ((await itemRefs(db, seen, [item.part_of]))[0] ?? null) : null,
    files: await attachmentsOf(db, "item", item.id),
    people: await peopleByIds(db, [...referencedPeople(list.fields, filled), ...timeline.map((t) => t.created_by)]),
    refs: await itemRefs(db, seen, referencedItems(list.fields, filled).map((r) => r.id)),
    backlinks: await backlinks(db, seen, item.id),
  });
});

/** Items die naar dit item verwijzen (de wijnen van een wijnhuis), uit lijsten die je ziet. */
async function backlinks(db: D1Database, seen: Map<string, Role>, itemId: string) {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.name, t.list_id, t.data, l.fields, l.name AS list FROM items t JOIN lists l ON l.id = t.list_id
       WHERE t.list_id IN (SELECT value FROM json_each(?1)) AND instr(t.data, ?2) > 0 LIMIT 100`,
    )
    .bind(ids(seen.keys()), itemId)
    .all<{ id: string; name: string; list_id: string; data: string; fields: string; list: string }>();
  return results
    .flatMap((r) => {
      try {
        const fields = JSON.parse(r.fields);
        const hit = referencedItems(fields, JSON.parse(r.data)).find((x) => x.id === itemId);
        const label = hit ? fields.find((f: { key: string }) => f.key === hit.key)?.label : null;
        return hit ? [{ id: r.id, name: r.name, list_id: r.list_id, list: r.list, field_label: label ?? "" }] : [];
      } catch {
        return [];
      }
    })
    .slice(0, 50);
}

items.put("/:id", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { item, list, role } = await requireItem(db, me.id, c.req.param("id"));
  needEdit(role);
  const body = asObject(await c.req.json());
  const seen = await seenLists(db, me.id);
  const data = await prepareData(db, me.id, seen, list.fields, body.data, item.data);
  let name = requiredString(body, "name", 200);
  // Gekoppeld: de naam en de gekoppelde velden volgen de bron, wat hier binnenkomt telt daarvoor niet.
  const locked = item.mirror_id ? await lockedOf(db, item.mirror_id) : null;
  if (locked) {
    name = item.name;
    for (const k of locked.keys) {
      if (item.data[k] === undefined) delete data[k];
      else data[k] = item.data[k];
    }
  }
  const partOf = body.part_of === undefined ? item.part_of : await checkPartOf(db, seen, optionalString(body, "part_of", 64), item.id);
  // Wat het logboek invult en je hier verandert, wordt een Aanpassing in het logboek (shared/cells.ts).
  const adjusted = await adjust(db, me.id, list, item, data);
  await db.batch([
    db.prepare("UPDATE items SET name = ?, data = ?, part_of = ?, updated_at = datetime('now') WHERE id = ?").bind(name, JSON.stringify(adjusted.data), partOf, item.id),
    ...adjusted.statements,
  ]);
  if (adjusted.eventId) await rebuildEffects(db, [adjusted.eventId]);
  await syncFrom(db, list.id);
  return c.json({ ok: true, adjusted: adjusted.eventId });
});

/**
 * Tellen (− en + in een lijst die voorraad telt): een Aanpassing "Telling" die de voorraad van het item op `amount` zet
 * (in `unit`, anders die van het item). Geen formulier nodig: wie het item mag aanpassen, mag tellen.
 */
items.post("/:id/count", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { item, list, role } = await requireItem(db, me.id, c.req.param("id"));
  needEdit(role);
  if (!list.stock) throw new ValidationError("Deze lijst telt geen voorraad.");
  const body = asObject(await c.req.json());
  const amount = typeof body.amount === "number" && Number.isFinite(body.amount) && body.amount >= 0 && body.amount < 1e9 ? body.amount : null;
  if (amount === null) throw new ValidationError("Hoeveel is er?");
  const unit = normalizeUnit(optionalString(body, "unit", 20)) ?? measureFor(list.stock, item.data).unit ?? null;
  const eventId = crypto.randomUUID();
  await db.batch([
    db
      .prepare("INSERT INTO events (id, kind, base, name, status, at, data, created_by) VALUES (?, ?, 'meting', 'Telling', 'gebeurd', ?, '{}', ?)")
      .bind(eventId, ADJUST, brusselsNow(), me.id),
    db.prepare("INSERT INTO lines (id, event_id, position, role, grp, item_id, amount, unit) VALUES (?, ?, 0, 'voor', 'voor', ?, ?, ?)").bind(crypto.randomUUID(), eventId, item.id, amount, unit),
  ]);
  await rebuildEffects(db, [eventId]);
  return c.json({ id: eventId }, 201);
});

items.put("/:id/archived", async (c) => {
  const db = c.env.DB;
  const { item, role } = await requireItem(db, c.get("person").id, c.req.param("id"));
  needEdit(role);
  await notMirrored(db, item.mirror_id);
  const archived = asObject(await c.req.json()).archived === true ? 1 : 0;
  await db.prepare("UPDATE items SET archived = ?, updated_at = datetime('now') WHERE id = ?").bind(archived, item.id).run();
  await syncFrom(db, item.list_id);
  return c.json({ ok: true });
});

/** Een item verwijderen. Lijnen ernaar blijven als tekst (de geschiedenis van een kasticket klopt dan nog). */
items.delete("/:id", async (c) => {
  const db = c.env.DB;
  const { item, role } = await requireItem(db, c.get("person").id, c.req.param("id"));
  needEdit(role);
  await notMirrored(db, item.mirror_id);
  const { results } = await db.prepare("SELECT r2_key FROM attachments WHERE owner_kind = 'item' AND owner_id = ?").bind(item.id).all<{ r2_key: string }>();
  await db.batch([
    db.prepare("UPDATE lines SET text = ?, item_id = NULL WHERE item_id = ?").bind(item.name, item.id),
    db.prepare("DELETE FROM attachments WHERE owner_kind = 'item' AND owner_id = ?").bind(item.id),
    db.prepare("DELETE FROM items WHERE id = ?").bind(item.id),
  ]);
  await purgeMedia(c.env, "item", item.id, results.map((r) => r.r2_key));
  await syncFrom(db, item.list_id);
  return c.body(null, 204);
});

/** Een gekoppeld item komt en gaat met de bron: weghalen of archiveren doe je daar (of je past de koppeling aan). */
async function notMirrored(db: D1Database, mirrorId: string | null | undefined) {
  if (!mirrorId) return;
  const locked = await lockedOf(db, mirrorId);
  if (locked) throw new ValidationError(`Dit komt uit ${locked.source.name}: haal het daar weg of pas de koppeling aan.`);
}

// ---------- foto en bestanden ----------

items.get("/:id/photo", async (c) => {
  const { item } = await requireItem(c.env.DB, c.get("person").id, c.req.param("id"));
  return servePhoto(c, "item", item.id);
});

items.put("/:id/photo", async (c) => {
  const { item, role } = await requireItem(c.env.DB, c.get("person").id, c.req.param("id"));
  needEdit(role);
  const result = await storePhoto(c, "item", item.id);
  return "error" in result ? c.json(result, 400) : c.json(result);
});

items.delete("/:id/photo", async (c) => {
  const { item, role } = await requireItem(c.env.DB, c.get("person").id, c.req.param("id"));
  needEdit(role);
  await removePhoto(c, "item", item.id);
  return c.body(null, 204);
});

items.post("/:id/files", async (c) => {
  const { item, role } = await requireItem(c.env.DB, c.get("person").id, c.req.param("id"));
  needEdit(role);
  const result = await storeFiles(c, "item", item.id);
  return "error" in result ? c.json(result, 400) : c.json(result, 201);
});

export { NotFoundError };
