import { Hono } from "hono";
import { computeLocal, isLinkCalc } from "../../shared/calc";
import { referencedItems, referencedPeople, type Attributes } from "../../shared/fields";
import { canEdit, type LineRole, type List, type Role, type StockLevel, type ThingRef, type ThingRow } from "../../shared/model";
import { measureFor, stockLevel, unitPrice, type StockLine } from "../../shared/stock";
import type { Person } from "../../shared/types";
import { brusselsToday } from "../today";
import { ids, kindOf, needEdit, requireList, requireThing, seenLists, toThing, type ThingRowDb } from "../access";
import { attachmentsOf, purgeMedia, removePhoto, servePhoto, storeFiles, storePhoto } from "../media";
import { prepareData } from "../prepare";
import { cleanPlan, MAX_TRANSFER, transferRows, type TransferPlan } from "../../shared/transfer";
import type { AppEnv } from "../types";
import { asObject, NotFoundError, optionalString, requiredString, ValidationError } from "../validate";

export const things = new Hono<AppEnv>();
export const listThings = new Hono<AppEnv>();

const MAX_THINGS = 2000;

/** De voorraad van dingen in een lijst die telt (uit alle lijnen, ook van gebeurtenissen die jij niet ziet). */
export async function stockOf(db: D1Database, list: Pick<List, "stock">, rows: { id: string; data: Attributes }[]): Promise<Map<string, StockLevel>> {
  const out = new Map<string, StockLevel>();
  if (!list.stock || !rows.length) return out;
  const { results } = await db
    .prepare(
      `SELECT l.thing_id, l.role, l.amount, l.unit, l.expires, e.at, e.created_at, e.base, e.status
       FROM lines l JOIN events e ON e.id = l.event_id
       WHERE l.thing_id IN (SELECT value FROM json_each(?)) AND e.status = 'gebeurd' AND l.role IN ('in', 'uit', 'voor')`,
    )
    .bind(ids(rows.map((r) => r.id)))
    .all<StockLine & { thing_id: string }>();
  const byThing = new Map<string, StockLine[]>();
  for (const l of results) byThing.set(l.thing_id, [...(byThing.get(l.thing_id) ?? []), l]);
  for (const r of rows) out.set(r.id, stockLevel(list.stock, r.data, byThing.get(r.id) ?? []));
  return out;
}

/** Namen van dingen (voor verwijzingen en lijnen), enkel uit lijsten die je ziet. */
export async function thingRefs(db: D1Database, seen: Map<string, Role>, thingIds: Iterable<string>): Promise<ThingRef[]> {
  const list = [...new Set(thingIds)];
  if (!list.length) return [];
  const { results } = await db
    .prepare(
      `SELECT t.id, t.name, t.list_id, t.data, l.name AS list, l.stock, l.fields FROM things t JOIN lists l ON l.id = t.list_id
       WHERE t.id IN (SELECT value FROM json_each(?))`,
    )
    .bind(ids(list))
    .all<{ id: string; name: string; list_id: string; list: string; data: string; stock: string | null; fields: string }>();
  return results
    .filter((r) => seen.has(r.list_id))
    .map((r) => ({ id: r.id, name: r.name, list_id: r.list_id, list: r.list, unit: unitOf(r) }));
}

/** De eenheid van een ding in een lijst die telt. */
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

listThings.get("/:id/things", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { list } = await requireList(db, me.id, c.req.param("id"));
  const archived = c.req.query("archived") === "1" ? 1 : 0;
  const q = c.req.query("q")?.trim();
  const { results } = await db
    .prepare(`SELECT * FROM things WHERE list_id = ? AND archived = ? ${q ? "AND name LIKE ?" : ""} ORDER BY name COLLATE NOCASE LIMIT ${MAX_THINGS}`)
    .bind(...[list.id, archived, ...(q ? [`%${q}%`] : [])])
    .all<ThingRowDb>();
  const today = brusselsToday();
  const rows = results.map(toThing);
  const stock = await stockOf(db, list, rows);
  const seen = await seenLists(db, me.id);
  const out: ThingRow[] = rows.map((t) => ({ ...t, data: shown(list.fields, t.data, today), ...(list.stock ? { stock: stock.get(t.id) ?? null } : {}) }));
  return c.json({
    things: out,
    people: await peopleByIds(db, rows.flatMap((t) => referencedPeople(list.fields, t.data))),
    refs: await thingRefs(db, seen, [...rows.flatMap((t) => referencedItems(list.fields, t.data).map((r) => r.id)), ...rows.flatMap((t) => (t.part_of ? [t.part_of] : []))]),
  });
});

listThings.post("/:id/things", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { list, role } = await requireList(db, me.id, c.req.param("id"));
  needEdit(role);
  if (!list.one) throw new ValidationError("Deze lijst heeft geen dingen, enkel een logboek.");
  const body = asObject(await c.req.json());
  const seen = await seenLists(db, me.id);
  const id = crypto.randomUUID();
  const data = await prepareData(db, me.id, seen, list.fields, body.data);
  const partOf = await checkPartOf(db, seen, optionalString(body, "part_of", 64), id);
  await db
    .prepare("INSERT INTO things (id, list_id, name, data, part_of, created_by) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, list.id, requiredString(body, "name", 200), JSON.stringify(data), partOf, me.id)
    .run();
  return c.json({ id }, 201);
});

async function checkPartOf(db: D1Database, seen: Map<string, Role>, partOf: string | null, self: string): Promise<string | null> {
  if (!partOf || partOf === self) return null;
  const row = await db.prepare("SELECT id, list_id FROM things WHERE id = ?").bind(partOf).first<{ id: string; list_id: string }>();
  return row && seen.has(row.list_id) ? row.id : null;
}

/** Dingen uit een tabel (zie src/pages/ImportPage.tsx): elke rij zoals een gewoon nieuw ding; wat niet lukt, slaat over. */
listThings.post("/:id/things/import", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { list, role } = await requireList(db, me.id, c.req.param("id"));
  needEdit(role);
  if (!list.one) throw new ValidationError("Deze lijst heeft geen dingen, enkel een logboek.");
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
      statements.push(db.prepare("INSERT INTO things (id, list_id, name, data, created_by) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), list.id, name, JSON.stringify(data), me.id));
    } catch (err) {
      skipped.push({ row: i + 2, error: err instanceof Error ? err.message : "Ongeldig" });
    }
  }
  for (let k = 0; k < statements.length; k += 100) await db.batch(statements.slice(k, k + 100));
  return c.json({ created: statements.length, skipped });
});

/**
 * Toevoegen uit een andere lijst (zie shared/transfer.ts): de server rekent het plan opnieuw uit met wat de lezer van de
 * bron ziet. Zonder Weghalen komen er nieuwe dingen bij (zoals Importeren); met Weghalen verhuist het ding zelf (dezelfde
 * id: foto, logboek en voorraad gaan mee), enkel als je de bron mag wijzigen. Elke waarde gaat door `prepareData`.
 */
listThings.post("/:id/things/from", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { list, role } = await requireList(db, me.id, c.req.param("id"));
  needEdit(role);
  if (!list.one) throw new ValidationError("Deze lijst heeft geen dingen, enkel een logboek.");
  const body = asObject(await c.req.json());
  const sourceId = typeof body.source === "string" ? body.source : "";
  if (!sourceId || sourceId === list.id) throw new ValidationError("Kies een andere lijst.");
  const { list: source, role: sourceRole } = await requireList(db, me.id, sourceId);
  if (!source.one) throw new ValidationError("Die lijst heeft geen dingen.");
  let plan: TransferPlan;
  try {
    plan = cleanPlan(body, source, list.fields);
  } catch (err) {
    throw new ValidationError((err as Error).message);
  }
  if (plan.move) needEdit(sourceRole, "Enkel wie die lijst mag wijzigen, haalt er iets uit weg.");
  const { results } = await db
    .prepare(`SELECT * FROM things WHERE list_id = ? AND archived = 0 ORDER BY name COLLATE NOCASE LIMIT ${MAX_TRANSFER}`)
    .bind(source.id)
    .all<ThingRowDb>();
  const today = brusselsToday();
  const rows = results.map(toThing);
  const seen = await seenLists(db, me.id);
  const people = new Map((await peopleByIds(db, rows.flatMap((t) => referencedPeople(source.fields, t.data)))).map((p) => [p.id, p.name]));
  const refs = new Map((await thingRefs(db, seen, rows.flatMap((t) => referencedItems(source.fields, t.data).map((r) => r.id)))).map((r) => [r.id, r.name]));
  const names = { person: (id: string) => people.get(id) ?? "?", item: (id: string) => refs.get(id) ?? "?" };
  const items = rows.map((t) => ({ id: t.id, name: t.name, data: shown(source.fields, t.data, today), tag_ids: [], created_at: t.created_at }));
  const out = transferRows(items, plan, source.fields, list.fields, { today, me: me.id, names });
  const statements: D1PreparedStatement[] = [];
  const skipped: { name: string; error: string }[] = [];
  for (const r of out) {
    try {
      const data = await prepareData(db, me.id, seen, list.fields, r.data);
      statements.push(
        plan.move
          ? db
              .prepare("UPDATE things SET list_id = ?, name = ?, data = ?, updated_at = datetime('now') WHERE id = ? AND list_id = ?")
              .bind(list.id, r.name, JSON.stringify(data), r.source_id, source.id)
          : db.prepare("INSERT INTO things (id, list_id, name, data, created_by) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), list.id, r.name, JSON.stringify(data), me.id),
      );
    } catch (err) {
      skipped.push({ name: r.name, error: err instanceof Error ? err.message : "Ongeldig" });
    }
  }
  for (let k = 0; k < statements.length; k += 100) await db.batch(statements.slice(k, k + 100));
  return c.json({ created: statements.length, skipped });
});

// ---------- zoeken en kiezen ----------

/**
 * Dingen om te kiezen of te herkennen, uit de lijsten die je ziet (`lists`: enkel die): op naam (`q`), de namen die
 * in een tekst staan (`in`: "yoghurt colruyt 6 euro" → Yoghurt en Colruyt), of bij ids (`ids`). Nooit een hele lijst.
 */
things.get("/", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const seen = await seenLists(db, me.id);
  const wanted = (c.req.query("lists") ?? "").split(",").filter(Boolean);
  const scope = wanted.length ? wanted.filter((id) => seen.has(id)) : [...seen.keys()];
  const limit = Math.min(Number(c.req.query("limit")) || 20, 50);
  const q = c.req.query("q")?.trim() ?? "";
  const text = c.req.query("in")?.trim().toLowerCase() ?? "";
  const chosen = (c.req.query("ids") ?? "").split(",").filter(Boolean).slice(0, 100);
  if (chosen.length) return c.json({ things: await thingRefs(db, seen, chosen), more: false });
  // In een tekst: de hele naam, of een woord van minstens 4 letters uit de naam ("sprinter" → Mercedes Sprinter).
  const words = text ? [...new Set(text.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !/^\d+$/.test(w)))].slice(0, 8) : [];
  const where = text
    ? `(instr(?2, lower(t.name)) > 0 AND length(t.name) >= 2)${words.map((_, i) => ` OR lower(t.name) LIKE ?${i + 3}`).join("")}`
    : "t.name LIKE ?2";
  const { results: rows } = await db
    .prepare(
      `SELECT t.id, t.name, t.list_id, t.data, l.name AS list, l.stock FROM things t JOIN lists l ON l.id = t.list_id
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
  const usual = text ? await usualRoles(db, seen, found) : new Map<string, LineRole>();
  return c.json({
    things: found.map(
      (r) =>
        ({
          id: r.id,
          name: r.name,
          list_id: r.list_id,
          list: r.list,
          unit: unitOf(r),
          ...(text ? { usual: usual.get(r.id) ?? null, stock: Boolean(r.stock) } : {}),
        }) satisfies ThingRef,
    ),
    more: results.length > limit,
  });
});

/**
 * Welke rol een ding meestal heeft (Colruyt: bij, de wagen: voor), uit de lijnen in wat de lezer ziet; zonder
 * geschiedenis die van de andere dingen in zijn lijst (een nieuwe winkel in Winkels: bij).
 */
async function usualRoles(db: D1Database, seen: Map<string, Role>, found: { id: string; list_id: string }[]): Promise<Map<string, LineRole>> {
  if (!found.length) return new Map();
  const { results } = await db
    .prepare(
      `SELECT t.id AS thing_id, t.list_id, l.role, COUNT(*) AS n FROM lines l JOIN things t ON t.id = l.thing_id JOIN events e ON e.id = l.event_id
       WHERE t.list_id IN (SELECT value FROM json_each(?1)) AND e.list_id IN (SELECT value FROM json_each(?2)) GROUP BY t.id, l.role`,
    )
    .bind(ids(new Set(found.map((f) => f.list_id))), ids(seen.keys()))
    .all<{ thing_id: string; list_id: string; role: LineRole; n: number }>();
  const top = (rows: typeof results) => {
    const sums = new Map<LineRole, number>();
    for (const r of rows) sums.set(r.role, (sums.get(r.role) ?? 0) + r.n);
    return [...sums].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const out = new Map<string, LineRole>();
  for (const f of found) {
    const role = top(results.filter((r) => r.thing_id === f.id)) ?? top(results.filter((r) => r.list_id === f.list_id));
    if (role) out.set(f.id, role);
  }
  return out;
}

// ---------- één ding ----------

/** Een lijn op de tijdlijn van een ding, met de kop van haar gebeurtenis. */
type TimelineEntry = {
  event_id: string;
  kind: string;
  kind_name: string;
  base: string;
  status: string;
  at: string;
  list_id: string;
  list: string | null;
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

things.get("/:id", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { thing, list, role } = await requireThing(db, me.id, c.req.param("id"));
  const seen = await seenLists(db, me.id);
  const today = brusselsToday();
  const [lines, parts] = (await db.batch([
    db
      .prepare(
        `SELECT l.role, l.amount, l.unit, l.price, l.expires, e.id AS event_id, e.kind, e.base, e.status, e.at, e.list_id, e.name, e.created_by, ls.name AS list,
                e.amount AS event_amount, (SELECT COUNT(*) FROM lines x WHERE x.event_id = e.id AND x.role != 'bij') AS main_lines
         FROM lines l JOIN events e ON e.id = l.event_id JOIN lists ls ON ls.id = e.list_id
         WHERE l.thing_id = ? ORDER BY e.at DESC, e.created_at DESC LIMIT 300`,
      )
      .bind(thing.id),
    db.prepare("SELECT id, name, list_id FROM things WHERE part_of = ?").bind(thing.id),
  ])) as [D1Result<Omit<TimelineEntry, "partial" | "store" | "unit_price" | "kind_name"> & { event_amount: number | null; main_lines: number }>, D1Result<{ id: string; name: string; list_id: string }>];
  const visible = lines.results.filter((l) => seen.has(l.list_id) || l.role !== "bij");
  const full = visible.filter((l) => seen.has(l.list_id)).map((l) => l.event_id);
  const { results: stores } = await db
    .prepare(
      `SELECT l.event_id, COALESCE(t.name, l.text) AS name FROM lines l LEFT JOIN things t ON t.id = l.thing_id
       WHERE l.role = 'bij' AND l.event_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(ids(full))
    .all<{ event_id: string; name: string | null }>();
  const storeOf = new Map(stores.map((s) => [s.event_id, s.name]));
  const measure = list.stock ? measureFor(list.stock, thing.data) : { unit: null };
  const kindNames = new Map<string, string>();
  for (const l of visible) if (!kindNames.has(l.kind)) kindNames.set(l.kind, (await kindOf(db, l.kind, l.base as never)).name);
  const timeline: TimelineEntry[] = visible.map(({ event_amount, main_lines, ...l }) => {
    const partial = !seen.has(l.list_id);
    return {
      ...l,
      // Gaat de gebeurtenis enkel over dit ding (een tankbeurt voor de wagen), dan is haar bedrag het zijne.
      price: l.price ?? (!partial && main_lines === 1 ? event_amount : null),
      kind_name: kindNames.get(l.kind) ?? l.kind,
      partial,
      name: partial ? "" : l.name,
      list: partial ? null : l.list,
      store: partial ? null : (storeOf.get(l.event_id) ?? null),
      unit_price: unitPrice(l.price, l.amount, l.unit, measure),
    };
  });
  const stock = list.stock ? (await stockOf(db, list, [thing])).get(thing.id) : null;
  return c.json({
    thing: { ...thing, data: shown(list.fields, thing.data, today) },
    list: { id: list.id, name: list.name, one: list.one, icon: list.icon, color: list.color, fields: list.fields, stock: list.stock },
    role,
    can_edit: canEdit(role),
    stock: stock ?? null,
    timeline,
    parts: parts.results.filter((p) => seen.has(p.list_id)),
    part_of: thing.part_of ? ((await thingRefs(db, seen, [thing.part_of]))[0] ?? null) : null,
    files: await attachmentsOf(db, "thing", thing.id),
    people: await peopleByIds(db, [...referencedPeople(list.fields, thing.data), ...timeline.map((t) => t.created_by)]),
    refs: await thingRefs(db, seen, referencedItems(list.fields, thing.data).map((r) => r.id)),
    backlinks: await backlinks(db, seen, thing.id),
  });
});

/** Dingen die naar dit ding verwijzen (de wijnen van een wijnhuis), uit lijsten die je ziet. */
async function backlinks(db: D1Database, seen: Map<string, Role>, thingId: string) {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.name, t.list_id, t.data, l.fields, l.name AS list FROM things t JOIN lists l ON l.id = t.list_id
       WHERE t.list_id IN (SELECT value FROM json_each(?1)) AND instr(t.data, ?2) > 0 LIMIT 100`,
    )
    .bind(ids(seen.keys()), thingId)
    .all<{ id: string; name: string; list_id: string; data: string; fields: string; list: string }>();
  return results
    .flatMap((r) => {
      try {
        const fields = JSON.parse(r.fields);
        const hit = referencedItems(fields, JSON.parse(r.data)).find((x) => x.id === thingId);
        const label = hit ? fields.find((f: { key: string }) => f.key === hit.key)?.label : null;
        return hit ? [{ id: r.id, name: r.name, list_id: r.list_id, list: r.list, field_label: label ?? "" }] : [];
      } catch {
        return [];
      }
    })
    .slice(0, 50);
}

things.put("/:id", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { thing, list, role } = await requireThing(db, me.id, c.req.param("id"));
  needEdit(role);
  const body = asObject(await c.req.json());
  const seen = await seenLists(db, me.id);
  const data = await prepareData(db, me.id, seen, list.fields, body.data, thing.data);
  const partOf = body.part_of === undefined ? thing.part_of : await checkPartOf(db, seen, optionalString(body, "part_of", 64), thing.id);
  await db
    .prepare("UPDATE things SET name = ?, data = ?, part_of = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(requiredString(body, "name", 200), JSON.stringify(data), partOf, thing.id)
    .run();
  return c.json({ ok: true });
});

things.put("/:id/archived", async (c) => {
  const db = c.env.DB;
  const { thing, role } = await requireThing(db, c.get("person").id, c.req.param("id"));
  needEdit(role);
  const archived = asObject(await c.req.json()).archived === true ? 1 : 0;
  await db.prepare("UPDATE things SET archived = ?, updated_at = datetime('now') WHERE id = ?").bind(archived, thing.id).run();
  return c.json({ ok: true });
});

/** Een ding verwijderen. Lijnen ernaar blijven als tekst (de geschiedenis van een kasticket klopt dan nog). */
things.delete("/:id", async (c) => {
  const db = c.env.DB;
  const { thing, role } = await requireThing(db, c.get("person").id, c.req.param("id"));
  needEdit(role);
  const { results } = await db.prepare("SELECT r2_key FROM attachments WHERE owner_kind = 'thing' AND owner_id = ?").bind(thing.id).all<{ r2_key: string }>();
  await db.batch([
    db.prepare("UPDATE lines SET text = ?, thing_id = NULL WHERE thing_id = ?").bind(thing.name, thing.id),
    db.prepare("DELETE FROM attachments WHERE owner_kind = 'thing' AND owner_id = ?").bind(thing.id),
    db.prepare("DELETE FROM things WHERE id = ?").bind(thing.id),
  ]);
  await purgeMedia(c.env, "thing", thing.id, results.map((r) => r.r2_key));
  return c.body(null, 204);
});

// ---------- foto en bestanden ----------

things.get("/:id/photo", async (c) => {
  const { thing } = await requireThing(c.env.DB, c.get("person").id, c.req.param("id"));
  return servePhoto(c, "thing", thing.id);
});

things.put("/:id/photo", async (c) => {
  const { thing, role } = await requireThing(c.env.DB, c.get("person").id, c.req.param("id"));
  needEdit(role);
  const result = await storePhoto(c, "thing", thing.id);
  return "error" in result ? c.json(result, 400) : c.json(result);
});

things.delete("/:id/photo", async (c) => {
  const { thing, role } = await requireThing(c.env.DB, c.get("person").id, c.req.param("id"));
  needEdit(role);
  await removePhoto(c, "thing", thing.id);
  return c.body(null, 204);
});

things.post("/:id/files", async (c) => {
  const { thing, role } = await requireThing(c.env.DB, c.get("person").id, c.req.param("id"));
  needEdit(role);
  const result = await storeFiles(c, "thing", thing.id);
  return "error" in result ? c.json(result, 400) : c.json(result, 201);
});

export { NotFoundError };
