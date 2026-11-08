import { syncFrom } from "../mirrors";
import { Hono } from "hono";
import { isIconKey } from "../../shared/icons";
import { cleanKindFields, cleanListFields } from "../../shared/listdef";
import { withSelf } from "../../shared/template-file";
import { isBase, isDirectRole, isRole, ROLES, type DirectRole, type ListDetail, type ListNode, type ListPerson, type Role, type Tag } from "../../shared/model";
import { cleanNotify } from "../../shared/alerts";
import { cleanReadPhoto } from "../../shared/photoread";
import { keepsAdmin } from "../../shared/rights";
import { cleanStock } from "../../shared/stock";
import { isTone, type Person } from "../../shared/types";
import { ids, kindsFor, listRoles, needManage, requireList, seenLists, toKind, toList, type KindRowDb, type ListRow } from "../access";
import type { AppEnv } from "../types";
import { asObject, ConflictError, idList, NotFoundError, optionalString, requiredString, ValidationError } from "../validate";

export const lists = new Hono<AppEnv>();
export const kinds = new Hono<AppEnv>();

const MAX_TAGS = 12;
const MAX_KINDS = 30;

/** Een fout van het nakijken van velden wordt een gewone fout voor de gebruiker. */
function clean<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw new ValidationError(err instanceof Error ? err.message : "Ongeldige velden");
  }
}

/** Al je lijsten (met je rol, tags en jouw volgorde) en de tags die je ziet. */
export async function myLists(db: D1Database, personId: string): Promise<{ lists: ListNode[]; tags: Tag[] }> {
  const seen = await seenLists(db, personId);
  const list = ids(seen.keys());
  const [rows, links, order, tags] = (await db.batch([
    db.prepare("SELECT id, name, one, icon, color, archived, stock FROM lists WHERE id IN (SELECT value FROM json_each(?))").bind(list),
    db.prepare("SELECT list_id, tag_id FROM list_tag_links WHERE list_id IN (SELECT value FROM json_each(?))").bind(list),
    db.prepare("SELECT list_id, position FROM list_order WHERE person_id = ?").bind(personId),
    db
      .prepare(
        `SELECT DISTINCT t.id, t.name, t.color, t.created_by FROM list_tags t
         WHERE t.created_by = ?1 OR t.id IN (SELECT tag_id FROM list_tag_links WHERE list_id IN (SELECT value FROM json_each(?2)))
         ORDER BY t.name COLLATE NOCASE`,
      )
      .bind(personId, list),
  ])) as [
    D1Result<{ id: string; name: string; one: string | null; icon: string | null; color: string | null; archived: number; stock: string | null }>,
    D1Result<{ list_id: string; tag_id: string }>,
    D1Result<{ list_id: string; position: number }>,
    D1Result<{ id: string; name: string; color: string | null; created_by: string }>,
  ];
  const tagsOf = new Map<string, string[]>();
  for (const l of links.results) tagsOf.set(l.list_id, [...(tagsOf.get(l.list_id) ?? []), l.tag_id]);
  const pos = new Map(order.results.map((o) => [o.list_id, o.position]));
  const nodes: ListNode[] = rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    one: r.one,
    icon: isIconKey(r.icon) ? r.icon : null,
    color: isTone(r.color) ? r.color : null,
    archived: r.archived ? 1 : 0,
    role: seen.get(r.id)!,
    tags: tagsOf.get(r.id) ?? [],
    stock: Boolean(r.stock),
    position: pos.get(r.id) ?? 1_000_000,
  }));
  nodes.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "nl"));
  return { lists: nodes, tags: tags.results.map((t) => ({ ...t, color: isTone(t.color) ? t.color : null })) };
}

lists.get("/", async (c) => c.json(await myLists(c.env.DB, c.get("person").id)));

/** Een nieuwe lijst: jij bent beheerder; met tags komen ook de mensen van hun regels erbij. */
lists.post("/", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const body = asObject(await c.req.json());
  const name = requiredString(body, "name", 60);
  const id = crypto.randomUUID();
  // Uit een sjabloon: een verwijzing naar de lijst zelf ("self") wordt deze nieuwe lijst.
  const fields = withSelf(clean(() => cleanListFields(body.fields)), id);
  const one = optionalString(body, "one", 40);
  const stock = cleanStock(body.stock, fields);
  const statements: D1PreparedStatement[] = [
    db
      .prepare("INSERT INTO lists (id, name, one, icon, color, fields, stock, notify, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(
        id,
        name,
        one,
        isIconKey(body.icon) ? body.icon : null,
        isTone(body.color) ? body.color : null,
        JSON.stringify(fields),
        stock ? JSON.stringify(stock) : null,
        JSON.stringify(cleanNotify(body.notify)),
        me.id,
      ),
    db.prepare("INSERT INTO list_people (list_id, person_id, role) VALUES (?, ?, 'beheerder')").bind(id, me.id),
  ];
  statements.push(...(await tagStatements(db, me.id, id, body)));
  // Eigen soorten uit een sjabloon (Gegeten, Bijvulling).
  const rawKinds = Array.isArray(body.kinds) ? body.kinds.slice(0, MAX_KINDS) : [];
  rawKinds.forEach((raw, i) => {
    const k = asObject(raw);
    if (!isBase(k.base)) throw new ValidationError("Onbekende basissoort");
    statements.push(
      db
        .prepare("INSERT INTO kinds (id, list_id, base, name, icon, fields, goal, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), id, k.base, requiredString(k, "name", 40), isIconKey(k.icon) ? k.icon : null, JSON.stringify(withSelf(clean(() => cleanKindFields(k.fields)), id)), goalOf(k), i),
    );
  });
  await db.batch(statements);
  return c.json({ id }, 201);
});

/**
 * De tags van een lijst zetten: bestaande tags die je ziet (`tag_ids`) en nieuwe namen (`new_tags`). Een tag met
 * dezelfde naam die je al ziet, wordt hergebruikt.
 */
async function tagStatements(db: D1Database, personId: string, listId: string, body: Record<string, unknown>): Promise<D1PreparedStatement[]> {
  const wanted = idList(body, "tag_ids", MAX_TAGS);
  const names = Array.isArray(body.new_tags)
    ? [...new Set(body.new_tags.filter((n): n is string => typeof n === "string").map((n) => n.trim().slice(0, 40)).filter(Boolean))].slice(0, MAX_TAGS)
    : [];
  const { tags } = await myLists(db, personId);
  const byId = new Map(tags.map((t) => [t.id, t]));
  const byName = new Map(tags.map((t) => [t.name.toLocaleLowerCase("nl"), t]));
  const out: D1PreparedStatement[] = [db.prepare("DELETE FROM list_tag_links WHERE list_id = ?").bind(listId)];
  const chosen = new Set(wanted.filter((t) => byId.has(t)));
  for (const n of names) {
    const known = byName.get(n.toLocaleLowerCase("nl"));
    if (known) {
      chosen.add(known.id);
      continue;
    }
    const tagId = crypto.randomUUID();
    out.push(db.prepare("INSERT INTO list_tags (id, name, created_by) VALUES (?, ?, ?)").bind(tagId, n, personId));
    chosen.add(tagId);
  }
  if (chosen.size > MAX_TAGS) throw new ValidationError(`Hoogstens ${MAX_TAGS} tags per lijst`);
  for (const t of chosen) out.push(db.prepare("INSERT INTO list_tag_links (list_id, tag_id) VALUES (?, ?)").bind(listId, t));
  return out;
}

/** Iedereen bij een lijst, met hoe (rechtstreeks of via een tag). */
export async function listPeople(db: D1Database, listId: string): Promise<ListPerson[]> {
  const { index, candidates } = await listRoles(db, listId);
  const people = index.people(listId, candidates);
  if (!people.length) return [];
  const [persons, tags] = (await db.batch([
    db.prepare("SELECT id, name, email, color, iban FROM people WHERE id IN (SELECT value FROM json_each(?))").bind(ids(people.map((p) => p.person_id))),
    db.prepare("SELECT id, name FROM list_tags WHERE id IN (SELECT value FROM json_each(?))").bind(ids(people.flatMap((p) => (p.tag_id ? [p.tag_id] : [])))),
  ])) as [D1Result<Person>, D1Result<{ id: string; name: string }>];
  const byId = new Map(persons.results.map((p) => [p.id, p]));
  const tagName = new Map(tags.results.map((t) => [t.id, t.name]));
  return people
    .filter((p) => byId.has(p.person_id))
    .map((p) => ({
      person: { ...byId.get(p.person_id)!, iban: null },
      role: p.role ?? "gast",
      direct: p.direct,
      via: p.tag_id ? { tag_id: p.tag_id, tag: tagName.get(p.tag_id) ?? "" } : null,
    }))
    .sort((a, b) => (a.direct === "geen" ? 1 : 0) - (b.direct === "geen" ? 1 : 0) || a.person.name.localeCompare(b.person.name, "nl"));
}

lists.get("/:id", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { list, role } = await requireList(db, me.id, c.req.param("id"));
  const seen = await seenLists(db, me.id);
  const [tags, counts] = (await db.batch([
    db.prepare("SELECT t.id, t.name, t.color, t.created_by FROM list_tags t JOIN list_tag_links l ON l.tag_id = t.id WHERE l.list_id = ? ORDER BY t.name").bind(list.id),
    db
      .prepare(
        `SELECT (SELECT count(*) FROM things WHERE list_id = ?1 AND archived = 0) AS things,
                (SELECT count(*) FROM events WHERE list_id = ?1 AND status != 'gepland') AS events,
                (SELECT count(*) FROM events WHERE list_id = ?1 AND status = 'gepland') AS planned`,
      )
      .bind(list.id),
  ])) as [D1Result<Tag>, D1Result<{ things: number; events: number; planned: number }>];
  // Eigen soorten van deze lijst eerst, dan die van andere lijsten die je ziet.
  const all = await kindsFor(db, seen.keys());
  const kinds = [...all.filter((k) => !k.list_id), ...all.filter((k) => k.list_id === list.id), ...all.filter((k) => k.list_id && k.list_id !== list.id)];
  const detail: ListDetail = {
    list,
    role,
    tags: tags.results.map((t) => ({ ...t, color: isTone(t.color) ? t.color : null })),
    people: await listPeople(db, list.id),
    kinds,
    counts: counts.results[0] ?? { things: 0, events: 0, planned: 0 },
  };
  return c.json(detail);
});

lists.put("/:id", async (c) => {
  const db = c.env.DB;
  const { list, role } = await requireList(db, c.get("person").id, c.req.param("id"));
  needManage(role);
  const body = asObject(await c.req.json());
  const fields = body.fields === undefined ? list.fields : clean(() => cleanListFields(body.fields));
  const stock = body.stock === undefined ? list.stock : cleanStock(body.stock, fields);
  const notify = body.notify === undefined ? list.notify : cleanNotify(body.notify);
  const readPhoto = body.read_photo === undefined ? list.read_photo : cleanReadPhoto(body.read_photo);
  await db
    .prepare("UPDATE lists SET name = ?, one = ?, icon = ?, color = ?, fields = ?, stock = ?, notify = ?, read_photo = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(
      body.name === undefined ? list.name : requiredString(body, "name", 60),
      body.one === undefined ? list.one : optionalString(body, "one", 40),
      body.icon === undefined ? list.icon : isIconKey(body.icon) ? body.icon : null,
      body.color === undefined ? list.color : isTone(body.color) ? body.color : null,
      JSON.stringify(fields),
      stock ? JSON.stringify(stock) : null,
      notify ? JSON.stringify(notify) : null,
      readPhoto ? JSON.stringify(readPhoto) : null,
      list.id,
    )
    .run();
  // Andere velden: wat uit deze lijst haalt of erin schrijft, opnieuw uitrekenen.
  await syncFrom(db, list.id, { asTarget: true });
  return c.json({ ok: true });
});

lists.put("/:id/archived", async (c) => {
  const db = c.env.DB;
  const { list, role } = await requireList(db, c.get("person").id, c.req.param("id"));
  needManage(role);
  const archived = asObject(await c.req.json()).archived === true ? 1 : 0;
  await db.prepare("UPDATE lists SET archived = ?, updated_at = datetime('now') WHERE id = ?").bind(archived, list.id).run();
  return c.json({ ok: true });
});

/** Een lijst verwijderen: met haar dingen, logboek en soorten. Lijnen elders naar haar dingen worden tekst. */
lists.delete("/:id", async (c) => {
  const db = c.env.DB;
  const { list, role } = await requireList(db, c.get("person").id, c.req.param("id"));
  needManage(role);
  await db.batch([
    db.prepare("UPDATE lines SET text = (SELECT name FROM things WHERE things.id = lines.thing_id), thing_id = NULL WHERE thing_id IN (SELECT id FROM things WHERE list_id = ?)").bind(list.id),
    db.prepare("DELETE FROM attachments WHERE (owner_kind = 'thing' AND owner_id IN (SELECT id FROM things WHERE list_id = ?1)) OR (owner_kind = 'event' AND owner_id IN (SELECT id FROM events WHERE list_id = ?1))").bind(list.id),
    db.prepare("DELETE FROM lists WHERE id = ?").bind(list.id),
  ]);
  return c.body(null, 204);
});

lists.put("/:id/tags", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { list, role } = await requireList(db, me.id, c.req.param("id"));
  needManage(role, "Enkel een beheerder zet tags op deze lijst.");
  await db.batch(await tagStatements(db, me.id, list.id, asObject(await c.req.json())));
  return c.json({ ok: true });
});

// ---------- mensen ----------

/** Iemand toevoegen: een bestaande persoon (`person_id`) of een nieuwe met naam en e-mailadres. */
lists.post("/:id/people", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { list, role } = await requireList(db, me.id, c.req.param("id"));
  needManage(role, "Enkel een beheerder voegt mensen toe.");
  const body = asObject(await c.req.json());
  const wanted = body.role;
  if (!isRole(wanted)) throw new ValidationError(`Kies een rol: ${Object.values(ROLES).map((r) => r.label).join(", ")}`);
  const personId = await findOrCreatePerson(db, me.id, body);
  await db
    .prepare("INSERT INTO list_people (list_id, person_id, role) VALUES (?, ?, ?) ON CONFLICT (list_id, person_id) DO UPDATE SET role = excluded.role")
    .bind(list.id, personId, wanted)
    .run();
  return c.json({ person_id: personId }, 201);
});

/** Een persoon die je kent (`person_id`), of een nieuwe; bestaat het e-mailadres al, dan is het die persoon. */
export async function findOrCreatePerson(db: D1Database, meId: string, body: Record<string, unknown>): Promise<string> {
  const known = optionalString(body, "person_id", 64);
  if (known) {
    const mine = await knownPeople(db, meId);
    if (!mine.some((p) => p.id === known)) throw new NotFoundError("Die persoon ken je niet.");
    return known;
  }
  const name = requiredString(body, "name", 60);
  const email = optionalString(body, "email", 200)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Dat e-mailadres klopt niet");
  if (email) {
    const existing = await db.prepare("SELECT id FROM people WHERE email = ?").bind(email).first<{ id: string }>();
    if (existing) return existing.id;
  }
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO people (id, name, email, created_by) VALUES (?, ?, ?, ?)").bind(id, name, email, meId).run();
  return id;
}

/** Wie je kent: jezelf, wie je toevoegde, en iedereen bij een lijst die je ziet (ook via regels). */
export async function knownPeople(db: D1Database, meId: string): Promise<Person[]> {
  const seen = await seenLists(db, meId);
  const { results } = await db
    .prepare(
      `SELECT id, name, email, color, NULL AS iban FROM people WHERE id = ?1 OR created_by = ?1
         OR id IN (SELECT person_id FROM list_people WHERE list_id IN (SELECT value FROM json_each(?2)) AND role != 'geen')
         OR id IN (SELECT r.person_id FROM tag_rules r JOIN list_tag_links l ON l.tag_id = r.tag_id WHERE l.list_id IN (SELECT value FROM json_each(?2)))
       ORDER BY name COLLATE NOCASE`,
    )
    .bind(meId, ids(seen.keys()))
    .all<Person>();
  return results;
}

/** Iemands rol rechtstreeks zetten (`role`), een uitzondering maken (`geen`) of de rechtstreekse rij weghalen (null). */
lists.put("/:id/people/:personId", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { list, role } = await requireList(db, me.id, c.req.param("id"));
  needManage(role, "Enkel een beheerder beheert de mensen.");
  const personId = c.req.param("personId");
  const wanted = asObject(await c.req.json()).role;
  if (wanted !== null && !isDirectRole(wanted)) throw new ValidationError("Onbekende rol");
  const { results } = await db.prepare("SELECT person_id, role FROM list_people WHERE list_id = ?").bind(list.id).all<{ person_id: string; role: DirectRole }>();
  const after = results.filter((r) => r.person_id !== personId).map((r) => ({ role: r.role }));
  if (wanted) after.push({ role: wanted as DirectRole });
  if (!keepsAdmin(after)) throw new ConflictError("Er moet altijd iemand rechtstreeks beheerder blijven.");
  if (wanted === null) await db.prepare("DELETE FROM list_people WHERE list_id = ? AND person_id = ?").bind(list.id, personId).run();
  else
    await db
      .prepare("INSERT INTO list_people (list_id, person_id, role) VALUES (?, ?, ?) ON CONFLICT (list_id, person_id) DO UPDATE SET role = excluded.role")
      .bind(list.id, personId, wanted)
      .run();
  return c.json({ ok: true });
});

// ---------- soorten ----------

/** Het doel van een activiteit in minuten (een timer), of null. */
const goalOf = (o: Record<string, unknown>): number | null =>
  o.base !== undefined && o.base !== "activiteit" ? null : typeof o.goal === "number" && Number.isInteger(o.goal) && o.goal > 0 && o.goal < 100_000 ? o.goal : null;

lists.post("/:id/kinds", async (c) => {
  const db = c.env.DB;
  const { list, role } = await requireList(db, c.get("person").id, c.req.param("id"));
  needManage(role, "Enkel een beheerder maakt soorten.");
  const body = asObject(await c.req.json());
  if (!isBase(body.base)) throw new ValidationError("Kies een basissoort");
  const count = await db.prepare("SELECT count(*) AS n FROM kinds WHERE list_id = ?").bind(list.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_KINDS) throw new ValidationError(`Hoogstens ${MAX_KINDS} soorten per lijst`);
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO kinds (id, list_id, base, name, icon, fields, goal, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, list.id, body.base, requiredString(body, "name", 40), isIconKey(body.icon) ? body.icon : null, JSON.stringify(clean(() => cleanKindFields(body.fields))), goalOf(body), count?.n ?? 0)
    .run();
  return c.json({ id }, 201);
});

async function requireKind(db: D1Database, personId: string, kindId: string) {
  const row = await db.prepare("SELECT * FROM kinds WHERE id = ?").bind(kindId).first<KindRowDb>();
  if (!row) throw new NotFoundError("Die soort bestaat niet (meer).");
  const { role } = await requireList(db, personId, row.list_id);
  needManage(role, "Enkel een beheerder van de lijst past deze soort aan.");
  return toKind(row);
}

kinds.put("/:id", async (c) => {
  const db = c.env.DB;
  const kind = await requireKind(db, c.get("person").id, c.req.param("id"));
  const body = asObject(await c.req.json());
  await db
    .prepare("UPDATE kinds SET name = ?, icon = ?, fields = ?, goal = ? WHERE id = ?")
    .bind(
      body.name === undefined ? kind.name : requiredString(body, "name", 40),
      body.icon === undefined ? kind.icon : isIconKey(body.icon) ? body.icon : null,
      body.fields === undefined ? JSON.stringify(kind.fields) : JSON.stringify(clean(() => cleanKindFields(body.fields))),
      body.goal === undefined ? kind.goal : kind.base === "activiteit" ? goalOf(body) : null,
      kind.id,
    )
    .run();
  return c.json({ ok: true });
});

/** Een soort weghalen: gebeurtenissen ervan blijven, als hun basissoort. */
kinds.delete("/:id", async (c) => {
  const db = c.env.DB;
  const kind = await requireKind(db, c.get("person").id, c.req.param("id"));
  await db.batch([db.prepare("UPDATE events SET kind = base WHERE kind = ?").bind(kind.id), db.prepare("DELETE FROM kinds WHERE id = ?").bind(kind.id)]);
  return c.body(null, 204);
});

export type { Role };
export { toList, type ListRow };
