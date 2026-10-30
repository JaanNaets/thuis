import { Hono } from "hono";
import type { Context } from "hono";
import { canCreate, canDelete, canEditType, fieldAccess, fieldAccessMap, mergeEditable, typeAccess, visibleData, type Rights } from "../../shared/access";
import {
  applyFieldDefaults,
  cleanAttributes,
  fillsDefaults,
  matchName,
  missingRequired,
  referencedItems,
  referencedPeople,
  type Attributes,
  type FieldDef,
} from "../../shared/fields";
import type { ImportResult, Item, ItemDetail, ItemFile, ItemList, ItemRef, ItemType, LabelScan, LogEntry, Person, ReceiptLines, SearchResult, Tag } from "../../shared/types";
import { AI_IMAGE_TYPES, MAX_IMAGE_BYTES, MODEL, safeJson, toBase64, useAiBudget } from "../ai";
import { withCalcs } from "../compute";
import { productByCode, productByName } from "../products";
import { isProductCode, PRODUCT_KEYS, productData, productLabel } from "../../shared/product";
import { accessibleProjects, placeholders, projectAccess, requireProject, toItemType, typesFor, type ProjectAccess, type TypeRow } from "../context";
import type { AppEnv } from "../types";
import { asObject, ForbiddenError, idList, NotFoundError, optionalString, requiredDate, requiredId, requiredString, ValidationError } from "../validate";

export const items = new Hono<AppEnv>();
export const projectItems = new Hono<AppEnv>();
export const files = new Hono<AppEnv>();
export const search = new Hono<AppEnv>();

type ItemRow = Omit<Item, "data" | "tag_ids"> & { data: string; tag_json: string };

const ITEM_SELECT = `SELECT i.*, (SELECT json_group_array(tag_id) FROM item_tags WHERE item_id = i.id) AS tag_json FROM items i`;

function parseData(json: string): Attributes {
  try {
    const value = JSON.parse(json);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Attributes) : {};
  } catch {
    return {};
  }
}

function toItem(row: ItemRow, rights: Rights, type: ItemType): Item {
  const { data, tag_json, ...rest } = row;
  return { ...rest, data: visibleData(rights, type.id, type.fields, parseData(data)), tag_ids: JSON.parse(tag_json) as string[] };
}

/**
 * Wat je overal mag zien: per project je rechten, om verwijzingen naar items elders te tonen (of niet). Met `key`:
 * ook dat veld van het item moet je mogen zien.
 */
async function visibility(db: D1Database, personId: string) {
  const nodes = await accessibleProjects(db, personId);
  const rights = new Map(nodes.map((n) => [n.id, n.rights]));
  return (row: { project_id: string; type_id: string }, key?: string) => {
    const r = rights.get(row.project_id);
    return Boolean(r && typeAccess(r, row.type_id) !== "none" && (!key || fieldAccess(r, row.type_id, key) !== "none"));
  };
}

/** Namen van personen en van items waarnaar verwezen wordt (enkel items die je mag zien). */
async function namesFor(db: D1Database, personId: string, chain: string[], types: ItemType[], list: { type_id: string; data: Attributes }[]) {
  const typeById = new Map(types.map((t) => [t.id, t]));
  const personIds = new Set<string>();
  const itemIds = new Set<string>();
  for (const it of list) {
    const type = typeById.get(it.type_id);
    if (!type) continue;
    referencedPeople(type.fields, it.data).forEach((id) => personIds.add(id));
    referencedItems(type.fields, it.data).forEach((r) => itemIds.add(r.id));
  }
  // De mensen van het project (om personen te kiezen) en wie in de waarden staat.
  const { results: members } = await db
    .prepare(
      `SELECT DISTINCT p.id, p.name, p.email, p.color FROM people p
       WHERE p.id IN (SELECT person_id FROM memberships WHERE project_id IN (${placeholders(chain.length)}))
          OR p.id IN (SELECT value FROM json_each(?))`,
    )
    .bind(...chain, JSON.stringify([...personIds]))
    .all<Person>();
  let refs: ItemRef[] = [];
  if (itemIds.size) {
    const { results } = await db
      .prepare("SELECT id, name, type_id, project_id FROM items WHERE id IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify([...itemIds]))
      .all<ItemRef>();
    const canSee = await visibility(db, personId);
    refs = results.filter((r) => canSee(r));
  }
  return { people: members, refs };
}

/**
 * Een item met wat jij ermee mag. Wie de lijst niet mag zien (of het project niet), krijgt "niet gevonden".
 * `want`: "edit" = de items van de lijst wijzigen (naam, tags, foto, bestanden, logboek).
 */
async function requireItem(c: Context<AppEnv>, id: string, want: "view" | "edit" = "view") {
  const db = c.env.DB;
  const row = await db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).bind(id).first<ItemRow>();
  if (!row) throw new NotFoundError("Dat item bestaat niet (meer).");
  const access = await projectAccess(db, c.get("person").id, row.project_id);
  const types = access ? await typesFor(db, access.chain) : [];
  const type = types.find((t) => t.id === row.type_id);
  if (!access || !type || typeAccess(access.rights, type.id) === "none") throw new NotFoundError("Dat item bestaat niet (meer).");
  if (want === "edit" && !canEditType(access.rights, type.id)) throw new ForbiddenError("Dit item mag je enkel bekijken.");
  return { row, access, type, types };
}

/**
 * De waarden nakijken bij bewaren: enkel velden die je mag wijzigen, verplichte velden ingevuld, en wat je nieuw
 * kiest bij een persoon of verwijzing moet je kennen: iemand uit dit project, een item dat je mag zien. Velden vullen
 * zelf in wat leeg is (bij een uitgave: jij betaalde, de gewone verdeling; zie `applyFieldDefaults`).
 */
async function prepareData(
  db: D1Database,
  personId: string,
  access: ProjectAccess,
  type: ItemType,
  incoming: unknown,
  existing: Attributes,
  isNew: boolean,
): Promise<Attributes> {
  const clean = cleanAttributes(type.fields, incoming);
  const merged = mergeEditable(access.rights, type.id, type.fields, existing, clean);
  const data = fillsDefaults(type.fields) ? applyFieldDefaults(type.fields, merged, await membersOf(db, access.chain), personId, isNew) : merged;
  const changed = (key: string) => JSON.stringify(data[key]) !== JSON.stringify(existing[key]);

  const people = referencedPeople(
    type.fields.filter((f) => changed(f.key)),
    data,
  );
  if (people.length) {
    const { results } = await db
      .prepare(
        `SELECT DISTINCT person_id FROM memberships WHERE project_id IN (${placeholders(access.chain.length)}) AND person_id IN (SELECT value FROM json_each(?))`,
      )
      .bind(...access.chain, JSON.stringify(people))
      .all<{ person_id: string }>();
    if (results.length !== people.length) throw new ValidationError("Kies iemand die in dit project zit.");
  }

  const refs = referencedItems(type.fields, data).filter((r) => changed(r.key));
  if (refs.length) {
    const canSee = await visibility(db, personId);
    for (const ref of refs) {
      const target = await db.prepare("SELECT id, project_id, type_id FROM items WHERE id = ?").bind(ref.id).first<{ project_id: string; type_id: string }>();
      const label = type.fields.find((f) => f.key === ref.key)?.label ?? ref.key;
      if (!target || target.type_id !== ref.ref_type || !canSee(target)) throw new ValidationError(`Kies bij "${label}" een item dat bestaat.`);
    }
  }

  const missing = missingRequired(
    type.fields.filter((f) => fieldAccess(access.rights, type.id, f.key) === "edit"),
    data,
  );
  if (missing.length) throw new ValidationError(`Vul ${missing.map((f) => `"${f.label}"`).join(" en ")} in.`);
  return data;
}

/** Iedereen die in dit project zit (zelf of erboven). */
async function membersOf(db: D1Database, chain: string[]): Promise<string[]> {
  const { results } = await db
    .prepare(`SELECT DISTINCT person_id FROM memberships WHERE project_id IN (${placeholders(chain.length)})`)
    .bind(...chain)
    .all<{ person_id: string }>();
  return results.map((r) => r.person_id);
}

/** Tags moeten van dit project of erboven komen. */
async function assertTags(db: D1Database, chain: string[], tagIds: string[]) {
  if (!tagIds.length) return;
  const { results } = await db
    .prepare(`SELECT id FROM tags WHERE project_id IN (${placeholders(chain.length)}) AND id IN (SELECT value FROM json_each(?))`)
    .bind(...chain, JSON.stringify(tagIds))
    .all();
  if (results.length !== tagIds.length) throw new ValidationError("Een tag bestaat niet (meer). Herlaad de pagina.");
}

function tagStatements(db: D1Database, itemId: string, tagIds: string[]): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM item_tags WHERE item_id = ?").bind(itemId),
    ...tagIds.map((t) => db.prepare("INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)").bind(itemId, t)),
  ];
}

function parseItemInput(body: unknown) {
  const obj = asObject(body);
  return { type_id: requiredId(obj, "type_id"), name: optionalString(obj, "name", 200) ?? "", data: obj.data, tag_ids: idList(obj, "tag_ids") };
}

/**
 * Een lege naam: in een logboek (een lijst met een datum die met vandaag begint, bv. Gewicht) de lijst en de datum
 * ("Weging 30/10/2026"); anders moet je een naam geven.
 */
function nameOrDefault(type: ItemType, name: string, data: Attributes): string {
  if (name) return name;
  const date = type.fields.find((f) => f.type === "date" && f.today);
  if (!date) throw new ValidationError(`Geef ${type.name_label?.toLowerCase() ?? "een naam"}.`);
  const day = typeof data[date.key] === "string" ? (data[date.key] as string) : new Date().toISOString().slice(0, 10);
  return `${type.name} ${day.split("-").reverse().join("/")}`;
}

async function loadDetail(c: Context<AppEnv>, id: string): Promise<ItemDetail> {
  const db = c.env.DB;
  const me = c.get("person").id;
  const { row, access, type, types } = await requireItem(c, id);
  const item = toItem(row, access.rights, type);
  await withCalcs(db, me, type, access.rights, [item]);
  const [fileRows, logRows] = await db.batch([
    db.prepare("SELECT id, item_id, filename, content_type, size_bytes, created_at FROM item_files WHERE item_id = ? ORDER BY created_at").bind(id),
    db
      .prepare(
        `SELECT l.*, p.name AS created_by_name FROM item_log l LEFT JOIN people p ON p.id = l.created_by
         WHERE l.item_id = ? ORDER BY l.happened_on DESC, l.created_at DESC`,
      )
      .bind(id),
  ]);
  const names = await namesFor(db, me, access.chain, types, [item]);
  // Wat naar dit item verwijst (de wijnen van een verkoper), enkel wat je mag zien.
  const { results: candidates } = await db
    .prepare("SELECT id, name, type_id, project_id, data FROM items WHERE data LIKE ? AND id != ? LIMIT 300")
    .bind(`%"${id}"%`, id)
    .all<ItemRef & { data: string }>();
  const canSee = candidates.length ? await visibility(db, me) : () => false;
  const allTypes = new Map<string, ItemType>();
  const backlinks: ItemDetail["backlinks"] = [];
  for (const cand of candidates.filter((cand) => canSee(cand))) {
    if (!allTypes.has(cand.type_id)) {
      const t = await db.prepare("SELECT * FROM item_types WHERE id = ?").bind(cand.type_id).first<TypeRow>();
      if (t) allTypes.set(t.id, toItemType(t));
    }
    const data = parseData(cand.data);
    // Via een veld dat je daar mag zien.
    const field = allTypes.get(cand.type_id)?.fields.find((f) => {
      const v = data[f.key];
      const points = (f.type === "item" && v === id) || (f.type === "items" && Array.isArray(v) && (v as string[]).includes(id));
      return points && canSee(cand, f.key);
    });
    if (field) backlinks.push({ id: cand.id, name: cand.name, type_id: cand.type_id, project_id: cand.project_id, field_label: field.label });
  }
  return {
    ...item,
    files: fileRows.results as ItemFile[],
    log: logRows.results as LogEntry[],
    people: names.people,
    refs: names.refs,
    backlinks,
    access: typeAccess(access.rights, type.id),
    field_access: fieldAccessMap(access.rights, type.id, type.fields),
    can_delete: canDelete(access.rights, type.id),
  };
}

// ---------- items van een project ----------

/** De items van een project (?type= één lijst, ?archived=1 het archief), met de namen waarnaar ze verwijzen. */
projectItems.get("/:id/items", async (c) => {
  const db = c.env.DB;
  const me = c.get("person").id;
  const access = await requireProject(db, me, c.req.param("id"));
  const types = await typesFor(db, access.chain);
  const visible = types.filter((t) => typeAccess(access.rights, t.id) !== "none");
  const typeId = c.req.query("type") || null;
  const ids = visible.map((t) => t.id).filter((t) => !typeId || t === typeId);
  if (!ids.length) return c.json({ items: [], people: [], refs: [] } satisfies ItemList);
  const { results } = await db
    .prepare(
      `${ITEM_SELECT} WHERE i.project_id = ? AND i.archived = ? AND i.type_id IN (${placeholders(ids.length)}) ORDER BY i.name COLLATE NOCASE LIMIT 5000`,
    )
    .bind(access.project.id, c.req.query("archived") === "1" ? 1 : 0, ...ids)
    .all<ItemRow>();
  const byId = new Map(visible.map((t) => [t.id, t]));
  const list = results.map((r) => toItem(r, access.rights, byId.get(r.type_id)!));
  for (const t of visible) {
    const ofType = list.filter((i) => i.type_id === t.id);
    if (ofType.length) await withCalcs(db, me, t, access.rights, ofType);
  }
  return c.json({ items: list, ...(await namesFor(db, me, access.chain, types, list)) } satisfies ItemList);
});

projectItems.post("/:id/items", async (c) => {
  const input = parseItemInput(await c.req.json());
  const db = c.env.DB;
  const me = c.get("person").id;
  const access = await requireProject(db, me, c.req.param("id"));
  const type = (await typesFor(db, access.chain)).find((t) => t.id === input.type_id);
  if (!type) throw new ValidationError("Die lijst bestaat hier niet.");
  if (!canCreate(access.rights, type.id)) throw new ForbiddenError(`Je mag hier geen ${type.plural.toLowerCase()} toevoegen.`);
  const data = await prepareData(db, me, access, type, input.data, {}, true);
  await assertTags(db, access.chain, input.tag_ids);
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare("INSERT INTO items (id, project_id, type_id, name, data, created_by) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, access.project.id, type.id, nameOrDefault(type, input.name, data), JSON.stringify(data), me),
    ...tagStatements(db, id, input.tag_ids),
  ]);
  return c.json(await loadDetail(c, id), 201);
});

// ---------- één item ----------

/** Keuzes voor een verwijzing: alle items van een lijst (?type=) die je mag zien, in al je projecten. */
items.get("/", async (c) => {
  const typeId = c.req.query("type");
  if (!typeId) throw new ValidationError("Kies een lijst");
  const db = c.env.DB;
  const nodes = (await accessibleProjects(db, c.get("person").id)).filter((n) => typeAccess(n.rights, typeId) !== "none");
  if (!nodes.length) return c.json([]);
  const { results } = await db
    .prepare(
      `SELECT id, name, type_id, project_id FROM items WHERE type_id = ? AND archived = 0 AND project_id IN (SELECT value FROM json_each(?))
       ORDER BY name COLLATE NOCASE LIMIT 2000`,
    )
    .bind(typeId, JSON.stringify(nodes.map((n) => n.id)))
    .all<ItemRef>();
  return c.json(results);
});

items.get("/:id", async (c) => c.json(await loadDetail(c, c.req.param("id"))));

/**
 * Bewaren: wie de lijst mag wijzigen, past naam en tags aan; per veld enkel wat je mag wijzigen. Wie enkel enkele
 * velden mag wijzigen (bv. de score), past enkel die aan.
 */
/**
 * Een getal met − of + aanpassen (een voorraad): enkel een getal met `counter` dat je mag wijzigen, nooit onder 0,
 * in één keer in de database (twee mensen tegelijk overschrijven elkaar niet). Geeft de nieuwe waarde.
 */
items.post("/:id/adjust", async (c) => {
  const { row, access, type } = await requireItem(c, c.req.param("id"), "edit");
  const obj = asObject(await c.req.json());
  const def = type.fields.find((f) => f.key === obj.key && f.type === "number" && f.counter);
  if (!def || fieldAccess(access.rights, type.id, def.key) !== "edit") throw new ForbiddenError("Dit getal mag je hier niet aanpassen.");
  const delta = obj.delta;
  if (typeof delta !== "number" || !Number.isFinite(delta) || Math.abs(delta) > 100_000) throw new ValidationError("Geef een aantal om bij te tellen of af te trekken.");
  const path = `$.${def.key}`;
  const updated = await c.env.DB.prepare(
    `UPDATE items SET data = json_set(data, ?2, max(0, round(coalesce(json_extract(data, ?2), 0) + ?3, 3))), updated_at = datetime('now')
     WHERE id = ?1 RETURNING json_extract(data, ?2) AS value`,
  )
    .bind(row.id, path, delta)
    .first<{ value: number }>();
  return c.json({ value: updated?.value ?? 0 });
});

items.put("/:id", async (c) => {
  const input = parseItemInput(await c.req.json());
  const db = c.env.DB;
  const me = c.get("person").id;
  const { row, access, type } = await requireItem(c, c.req.param("id"));
  const editsType = canEditType(access.rights, type.id);
  if (!editsType && !type.fields.some((f) => fieldAccess(access.rights, type.id, f.key) === "edit"))
    throw new ForbiddenError("Dit item mag je enkel bekijken.");
  if (input.type_id !== type.id) throw new ValidationError("Een item verhuist niet naar een andere lijst.");
  const data = await prepareData(db, me, access, type, input.data, parseData(row.data), false);
  const statements = [
    db
      .prepare("UPDATE items SET name = ?, data = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(editsType ? nameOrDefault(type, input.name, data) : row.name, JSON.stringify(data), row.id),
  ];
  if (editsType) {
    await assertTags(db, access.chain, input.tag_ids);
    statements.push(...tagStatements(db, row.id, input.tag_ids));
  }
  await db.batch(statements);
  return c.json(await loadDetail(c, row.id));
});

items.put("/:id/archived", async (c) => {
  const archived = asObject(await c.req.json()).archived === true ? 1 : 0;
  const { row } = await requireItem(c, c.req.param("id"), "edit");
  await c.env.DB.prepare("UPDATE items SET archived = ?, updated_at = datetime('now') WHERE id = ?").bind(archived, row.id).run();
  return c.json(await loadDetail(c, row.id));
});

items.delete("/:id", async (c) => {
  const { row, access, type } = await requireItem(c, c.req.param("id"));
  if (!canDelete(access.rights, type.id)) throw new ForbiddenError("Je mag dit item niet verwijderen.");
  const { results } = await c.env.DB.prepare("SELECT r2_key FROM item_files WHERE item_id = ?").bind(row.id).all<{ r2_key: string }>();
  await c.env.DB.prepare("DELETE FROM items WHERE id = ?").bind(row.id).run();
  await c.env.FILES.delete([...results.map((r) => r.r2_key), photoKey(row.id)]);
  return c.body(null, 204);
});

// ---------- foto ----------

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const photoKey = (id: string) => `items/${id}/photo`;

items.get("/:id/photo", async (c) => {
  const { row } = await requireItem(c, c.req.param("id"));
  const object = await c.env.FILES.get(photoKey(row.id));
  if (!object) return c.json({ error: "Geen foto" }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "image/jpeg",
      // De app vraagt de foto op met ?v=<versie>, dus een nieuwe foto is altijd een nieuwe URL.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

items.put("/:id/photo", async (c) => {
  const { row } = await requireItem(c, c.req.param("id"), "edit");
  const file = (await c.req.formData()).get("file");
  if (!(file instanceof File)) return c.json({ error: "Geen bestand ontvangen" }, 400);
  // Geen SVG: daar kan code in zitten.
  if (!PHOTO_TYPES.includes(file.type)) return c.json({ error: "Kies een foto (JPG, PNG of WebP)" }, 400);
  if (file.size > MAX_IMAGE_BYTES) return c.json({ error: "Deze foto is groter dan 3 MB" }, 400);
  await c.env.FILES.put(photoKey(row.id), file.stream(), { httpMetadata: { contentType: file.type } });
  const updated = await c.env.DB.prepare("UPDATE items SET photo_version = COALESCE(photo_version, 0) + 1 WHERE id = ? RETURNING photo_version")
    .bind(row.id)
    .first<{ photo_version: number }>();
  return c.json(updated);
});

items.delete("/:id/photo", async (c) => {
  const { row } = await requireItem(c, c.req.param("id"), "edit");
  await c.env.DB.prepare("UPDATE items SET photo_version = NULL WHERE id = ?").bind(row.id).run();
  await c.env.FILES.delete(photoKey(row.id));
  return c.body(null, 204);
});

// ---------- bestanden ----------

const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

items.post("/:id/files", async (c) => {
  const { row } = await requireItem(c, c.req.param("id"), "edit");
  const form = await c.req.formData();
  const uploads = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!uploads.length) return c.json({ error: "Geen bestand ontvangen" }, 400);
  const saved: ItemFile[] = [];
  for (const file of uploads.slice(0, 10)) {
    if (!FILE_TYPES.includes(file.type)) return c.json({ error: `${file.name}: kies een foto of PDF` }, 400);
    if (file.size > MAX_FILE_BYTES) return c.json({ error: `${file.name} is groter dan 10 MB` }, 400);
    const id = crypto.randomUUID();
    const key = `items/${row.id}/files/${id}`;
    await c.env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    const meta = await c.env.DB.prepare(
      "INSERT INTO item_files (id, item_id, filename, content_type, size_bytes, r2_key, created_by) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, item_id, filename, content_type, size_bytes, created_at",
    )
      .bind(id, row.id, file.name.slice(0, 200), file.type, file.size, key, c.get("person").id)
      .first<ItemFile>();
    saved.push(meta!);
  }
  return c.json(saved, 201);
});

async function requireFile(c: Context<AppEnv>, fileId: string, want: "view" | "edit") {
  const meta = await c.env.DB.prepare("SELECT * FROM item_files WHERE id = ?").bind(fileId).first<ItemFile & { r2_key: string }>();
  if (!meta) throw new NotFoundError("Dat bestand bestaat niet (meer).");
  await requireItem(c, meta.item_id, want);
  return meta;
}

files.get("/:id", async (c) => {
  const meta = await requireFile(c, c.req.param("id"), "view");
  const object = await c.env.FILES.get(meta.r2_key);
  if (!object) return c.json({ error: "Bestand niet gevonden" }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": meta.content_type,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(meta.filename)}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

files.delete("/:id", async (c) => {
  const meta = await requireFile(c, c.req.param("id"), "edit");
  await c.env.DB.prepare("DELETE FROM item_files WHERE id = ?").bind(meta.id).run();
  await c.env.FILES.delete(meta.r2_key);
  return c.body(null, 204);
});

// ---------- logboek ----------

function parseLog(body: unknown) {
  const obj = asObject(body);
  return { happened_on: requiredDate(obj, "happened_on"), text: requiredString(obj, "text", 4000) };
}

items.post("/:id/log", async (c) => {
  const entry = parseLog(await c.req.json());
  const { row } = await requireItem(c, c.req.param("id"), "edit");
  const saved = await c.env.DB.prepare("INSERT INTO item_log (id, item_id, happened_on, text, created_by) VALUES (?, ?, ?, ?, ?) RETURNING *")
    .bind(crypto.randomUUID(), row.id, entry.happened_on, entry.text, c.get("person").id)
    .first<LogEntry>();
  return c.json(saved, 201);
});

items.put("/:id/log/:logId", async (c) => {
  const entry = parseLog(await c.req.json());
  const { row } = await requireItem(c, c.req.param("id"), "edit");
  const saved = await c.env.DB.prepare("UPDATE item_log SET happened_on = ?, text = ? WHERE id = ? AND item_id = ? RETURNING *")
    .bind(entry.happened_on, entry.text, c.req.param("logId"), row.id)
    .first<LogEntry>();
  if (!saved) throw new NotFoundError("Die notitie bestaat niet (meer).");
  return c.json(saved);
});

items.delete("/:id/log/:logId", async (c) => {
  const { row } = await requireItem(c, c.req.param("id"), "edit");
  const { meta } = await c.env.DB.prepare("DELETE FROM item_log WHERE id = ? AND item_id = ?").bind(c.req.param("logId"), row.id).run();
  if (meta.changes === 0) throw new NotFoundError("Die notitie bestaat niet (meer).");
  return c.body(null, 204);
});

// ---------- een lijst importeren ----------

const MAX_IMPORT_ROWS = 3000;

/**
 * Een tabel (bv. uit een Google Sheet) als items in één lijst. De app leest de kolommen; hier wordt alles
 * nagekeken. Tags op naam (nieuwe worden gemaakt), en wat er al staat (zelfde naam en waarden) wordt overgeslagen.
 */
projectItems.post("/:id/items/import", async (c) => {
  const obj = asObject(await c.req.json());
  const db = c.env.DB;
  const me = c.get("person").id;
  const access = await requireProject(db, me, c.req.param("id"));
  const type = (await typesFor(db, access.chain)).find((t) => t.id === requiredId(obj, "type_id"));
  if (!type) throw new ValidationError("Die lijst bestaat hier niet.");
  if (!canCreate(access.rights, type.id)) throw new ForbiddenError(`Je mag hier geen ${type.plural.toLowerCase()} toevoegen.`);
  if (!Array.isArray(obj.rows) || obj.rows.length === 0) throw new ValidationError("Er staan geen rijen in deze lijst");
  if (obj.rows.length > MAX_IMPORT_ROWS) throw new ValidationError(`Hooguit ${MAX_IMPORT_ROWS} rijen per keer`);

  // Personen en verwijzingen komen niet uit een lijst; enkel velden die je mag wijzigen.
  const fields = type.fields.filter((f) => !["person", "item", "share"].includes(f.type) && fieldAccess(access.rights, type.id, f.key) === "edit");
  const [{ results: existing }, { results: tagRows }] = (await db.batch([
    db.prepare("SELECT name, data FROM items WHERE project_id = ? AND type_id = ?").bind(access.project.id, type.id),
    db.prepare(`SELECT * FROM tags WHERE project_id IN (${placeholders(access.chain.length)})`).bind(...access.chain),
  ])) as [D1Result<{ name: string; data: string }>, D1Result<Tag>];
  const key = (name: string, data: Attributes) => JSON.stringify([name.toLowerCase(), data]);
  const seen = new Set(existing.map((e) => key(e.name, parseData(e.data))));
  const tagIds = new Map(tagRows.map((t) => [t.name.toLowerCase(), t.id]));
  const newTags: D1PreparedStatement[] = [];
  // Wat velden zelf invullen (jij betaalde, de gewone verdeling), ook voor velden die je niet importeert.
  const members = fillsDefaults(type.fields) ? await membersOf(db, access.chain) : [];

  const result: ImportResult = { created: 0, skipped: [] };
  const statements: D1PreparedStatement[] = [];
  (obj.rows as unknown[]).forEach((raw, index) => {
    const row = index + 1;
    const r = (raw && typeof raw === "object" ? raw : {}) as { name?: unknown; data?: unknown; tags?: unknown };
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 200) : "";
    if (!name) return result.skipped.push({ row, error: "Geen naam" });
    const data = applyFieldDefaults(type.fields, cleanAttributes(fields, r.data), members, me, true);
    const missing = missingRequired(fields, data);
    if (missing.length) return result.skipped.push({ row, error: `${missing[0].label} ontbreekt` });
    if (seen.has(key(name, data))) return result.skipped.push({ row, error: "Staat er al in" });
    seen.add(key(name, data));
    const id = crypto.randomUUID();
    statements.push(
      db
        .prepare("INSERT INTO items (id, project_id, type_id, name, data, created_by) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(id, access.project.id, type.id, name, JSON.stringify(data), me),
    );
    const names = Array.isArray(r.tags)
      ? [
          ...new Set(
            r.tags
              .filter((t): t is string => typeof t === "string")
              .map((t) => t.trim().slice(0, 40))
              .filter(Boolean),
          ),
        ].slice(0, 10)
      : [];
    for (const tagName of names) {
      let tagId = tagIds.get(tagName.toLowerCase());
      if (!tagId) {
        tagId = crypto.randomUUID();
        tagIds.set(tagName.toLowerCase(), tagId);
        newTags.push(db.prepare("INSERT INTO tags (id, project_id, name) VALUES (?, ?, ?)").bind(tagId, access.project.id, tagName));
      }
      statements.push(db.prepare("INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)").bind(id, tagId));
    }
    result.created++;
  });

  if (newTags.length) await db.batch(newTags);
  // In stukken: één batch is één transactie, en een heel grote batch duurt te lang.
  for (let i = 0; i < statements.length; i += 400) await db.batch(statements.slice(i, i + 400));
  return c.json(result, 201);
});

// ---------- een etiket lezen ----------

/** Velden die de AI van een foto kan lezen. */
const READABLE = ["text", "url", "email", "phone", "address", "number", "money", "date", "time", "year", "year_range", "select", "multi", "bool", "item"];

function labelSchema(fields: FieldDef[]) {
  const properties: Record<string, unknown> = { name: { type: ["string", "null"] } };
  for (const f of fields) {
    if (f.type === "year_range") {
      properties[`${f.key}_from`] = { type: ["integer", "null"] };
      properties[`${f.key}_to`] = { type: ["integer", "null"] };
    } else if (f.type === "select" && f.options?.length) properties[f.key] = { type: ["string", "null"], enum: [...f.options, null] };
    else if (f.type === "multi") properties[f.key] = { type: ["array", "null"], items: { type: "string" } };
    else if (f.type === "number" || f.type === "money") properties[f.key] = { type: ["number", "null"] };
    else if (f.type === "year") properties[f.key] = { type: ["integer", "null"] };
    else if (f.type === "bool") properties[f.key] = { type: ["boolean", "null"] };
    else properties[f.key] = { type: ["string", "null"] };
  }
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

function describeField(f: FieldDef): string {
  const extra =
    {
      year_range: ` (${f.key}_from en ${f.key}_to: jaartallen)`,
      money: " (in euro)",
      multi: " (lijst)",
      date: " (YYYY-MM-DD)",
      time: " (HH:MM)",
      item: " (de naam zoals op de foto, bv. van de winkel)",
    }[f.type as string] ?? (f.unit ? ` (in ${f.unit})` : "");
  return `- ${f.key}: ${f.label}${extra}${f.hint ? `. ${f.hint}` : ""}`;
}

/**
 * Wat de AI bij een verwijzing las (een naam), koppelen aan een item van die lijst dat je mag zien (`matchName`).
 * Bestaat het nog niet, dan een voorstel om het toe te voegen, als je dat in het project van die lijst mag.
 */
async function matchRefs(
  db: D1Database,
  personId: string,
  fields: FieldDef[],
  parsed: Record<string, unknown>,
): Promise<{ data: Record<string, string>; create: NonNullable<LabelScan["create"]> }> {
  const out = { data: {} as Record<string, string>, create: [] as NonNullable<LabelScan["create"]> };
  const wanted = fields.filter((f) => f.type === "item" && f.ref_type && typeof parsed[f.key] === "string" && (parsed[f.key] as string).trim());
  if (!wanted.length) return out;
  const canSee = await visibility(db, personId);
  for (const f of wanted) {
    const name = (parsed[f.key] as string).trim().slice(0, 120);
    const { results } = await db
      .prepare("SELECT id, name, project_id, type_id FROM items WHERE type_id = ? AND archived = 0")
      .bind(f.ref_type)
      .all<{ id: string; name: string; project_id: string; type_id: string }>();
    const found = matchName(
      results.filter((r) => canSee(r)),
      name,
    );
    if (found) {
      out.data[f.key] = found;
      continue;
    }
    const list = await db.prepare("SELECT * FROM item_types WHERE id = ?").bind(f.ref_type).first<TypeRow>();
    const access = list && (await projectAccess(db, personId, list.project_id));
    if (list && access && canCreate(access.rights, list.id))
      out.create.push({ key: f.key, name, type_id: list.id, project_id: list.project_id, list: list.name, plural: list.plural });
  }
  return out;
}

/**
 * Een foto lezen in de velden van een lijst (die je mag invullen): een etiket, typeplaatje, kasticket of factuur, of
 * bij een lijst met productinfo het product of gerecht dat erop staat (met de echte gegevens van een gekend product).
 */
projectItems.post("/:id/items/scan", async (c) => {
  const form = await c.req.formData();
  const db = c.env.DB;
  const access = await requireProject(db, c.get("person").id, c.req.param("id"));
  const typeId = form.get("type_id");
  const type = (await typesFor(db, access.chain)).find((t) => t.id === typeId);
  if (!type || !canEditType(access.rights, type.id)) throw new ValidationError("Die lijst bestaat hier niet.");
  const image = form.get("image");
  // Wat wie de foto nam erbij vertelt (bv. "ik at de helft"); kort, en enkel als uitleg bij deze foto.
  const note = typeof form.get("note") === "string" ? (form.get("note") as string).trim().replace(/\s+/g, " ").slice(0, 200) : "";
  // Een barcode die de app zelf al op de foto vond (dan zoekt de AI enkel de rest, zoals hoeveel je at).
  const found = typeof form.get("code") === "string" && isProductCode(form.get("code") as string) ? (form.get("code") as string) : "";
  const empty: LabelScan = { name: null, data: {} };
  if (!(image instanceof File)) return c.json({ error: "Geen foto ontvangen" }, 400);
  if (!AI_IMAGE_TYPES.includes(image.type) || image.size > MAX_IMAGE_BYTES)
    return c.json({ ...empty, message: "Deze foto kan niet automatisch gelezen worden." });
  const limit = await useAiBudget(c.env, c.get("person").id);
  if (limit) return c.json({ ...empty, message: limit });

  const readable = type.fields.filter((f) => READABLE.includes(f.type) && fieldAccess(access.rights, type.id, f.key) === "edit");
  // Een lijst met velden uit productinfo (bv. kcal per 100 g): de AI herkent het product of gerecht en mag schatten;
  // een gekend product zoeken we daarna op in Open Food Facts (echte gegevens). Anders: enkel lezen wat er staat.
  // Bij herkennen geen datums: die staan niet op een foto van eten (en "vandaag" blijft dan staan).
  const products = readable.some((f) => f.product);
  const fields = products ? readable.filter((f) => f.type !== "date") : readable;
  const schema = labelSchema(fields);
  // Bij herkennen moet de AI getallen schatten (kcal per 100 g, hoeveel er ligt): die mogen niet leeg blijven, ook
  // zonder etiket (een kop cappuccino). Een gekend product krijgt daarna de echte gegevens.
  const estimated = products ? fields.filter((f) => f.type === "number" && (f.product || f.unit)) : [];
  if (products) {
    Object.assign(schema.properties, {
      kind: { type: "string", enum: ["product", "dish", "unknown"] },
      brand: { type: ["string", "null"] },
      barcode: { type: ["string", "null"] },
      ...Object.fromEntries(estimated.map((f) => [f.key, { type: "number" }])),
    });
    schema.required = Object.keys(schema.properties);
  }
  const prompt = products
    ? `Je ziet een foto van eten of van een product. Herken wat het is.
- kind: "product" voor een verpakt product van een merk (je ziet de verpakking of het is duidelijk een gekend merk), "dish" voor een gerecht, een maaltijd of los eten (fruit, brood), anders "unknown"
- name: bij een product de naam zoals op de verpakking, in de taal van de verpakking, met de smaak of soort (bv. "Danio vanille", "Prince goût chocolat"); bij een gerecht de naam in het Nederlands
- brand: het merk zoals op de verpakking, of null
- barcode: de cijfers onder de barcode als je ze allemaal kan lezen, anders null
${fields.map((f) => describeField(f) + (f.product ? ` (${PRODUCT_KEYS[f.product].label})` : "")).join("\n")}
${estimated.length ? `Vul ${estimated.map((f) => f.key).join(" en ")} altijd in: lees het van de verpakking als dat kan, anders schat je het zoals een voedingstabel het zou geven voor wat je ziet (een cappuccino, een croissant, een bord pasta), en schat je hoeveel er op de foto staat (in g of ml; bij een gesloten verpakking één gewone portie).\n` : ""}Vul de andere velden enkel in als het uit de foto volgt, anders null.`
    : `Je leest wat er op een foto staat: een etiket, typeplaatje, kasticket of factuur. Geef enkel wat je echt ziet; gebruik null als je twijfelt. Raad nooit een getal, bedrag of datum.
Bij een kasticket of factuur: een bedrag is het totaal dat betaald werd ("Totaal", "Te betalen"), een datum de datum van aankoop, en een winkel of verkoper de naam van de zaak (zonder adres of filiaal).
Een keuze (zoals een categorie) mag je afleiden uit wat je ziet.
- name: ${type.name_label ?? `naam van de ${type.name.toLowerCase()}`}: zoals op het etiket (zonder jaartal), of bij een kasticket of factuur kort wat het is (bv. "Boodschappen Colruyt")
${fields.map(describeField).join("\n")}`;
  try {
    const dataUrl = `data:${image.type};base64,${toBase64(await image.arrayBuffer())}`;
    const result = await c.env.AI.run(MODEL, {
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: [
            { type: "text", text: products ? "Wat is dit?" : "Lees dit." },
            ...(note
              ? [
                  {
                    type: "text" as const,
                    text: `Extra uitleg van wie de foto nam (enkel om de velden hierboven juist in te vullen): "${note.replace(/"/g, "'")}"`,
                  },
                ]
              : []),
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      response_format: { type: "json_schema", json_schema: { name: "label", schema, strict: true } },
      chat_template_kwargs: { enable_thinking: false },
      temperature: 0,
      max_tokens: 500,
    });
    const content = result.choices?.[0]?.message?.content;
    const parsed = ((typeof content === "string" ? safeJson(content) : content) ?? {}) as Record<string, unknown>;
    // Wat de AI zegt, omzetten naar de waarden van de velden en daarna gewoon nakijken.
    const raw: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.type === "year_range") raw[f.key] = [parsed[`${f.key}_from`] ?? null, parsed[`${f.key}_to`] ?? null];
      else if (f.type === "money") raw[f.key] = typeof parsed[f.key] === "number" ? Math.round((parsed[f.key] as number) * 100) : null;
      else if (f.type !== "item") raw[f.key] = parsed[f.key];
    }
    // Een verwijzing: de naam op de foto koppelen aan een item dat je ziet (bv. de winkel aan je Verkopers).
    const refs = await matchRefs(db, c.get("person").id, fields, parsed);
    Object.assign(raw, refs.data);
    // Niets eetbaars of herkenbaars op de foto: dan zijn de verplichte schattingen niets waard.
    if (parsed.kind === "unknown") for (const f of estimated) raw[f.key] = null;
    const name = typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim().slice(0, 200) : null;
    const scan: LabelScan = { name, data: cleanAttributes(fields, raw), ...(refs.create.length ? { create: refs.create } : {}) };
    if (products && scan.name) {
      // Een gekend product: de echte gegevens (op de barcode die de AI las, anders op naam en merk). Lukt dat niet,
      // dan blijft de schatting staan, en dat zeggen we ook.
      const code = found || (typeof parsed.barcode === "string" ? parsed.barcode.replace(/\D/g, "") : "");
      const brand = typeof parsed.brand === "string" && parsed.brand.trim() ? parsed.brand.trim() : null;
      const info =
        parsed.kind === "product" || found
          ? await (isProductCode(code) ? productByCode(db, code) : Promise.resolve(null))
              .then((found) => found ?? productByName(db, scan.name!, brand))
              .catch(() => null)
          : null;
      if (info) {
        scan.name = productLabel(info);
        Object.assign(scan.data, cleanAttributes(fields, productData(fields, info)));
        scan.source = { kind: "database", label: productLabel(info) };
      } else scan.source = { kind: "estimate" };
    }
    if (!scan.name && Object.keys(scan.data).length === 0 && !scan.create) scan.message = "Niets herkend op deze foto. Vul het zelf in.";
    return c.json(scan);
  } catch (err) {
    console.error("AI kon het etiket niet lezen", err);
    return c.json({ ...empty, message: "Automatisch lezen lukte niet. Vul het zelf in." });
  }
});

/**
 * De lijnen van een kasticket lezen voor een voorraad (een lijst met een getal met − en +): per lijn de naam en het
 * aantal, gekoppeld aan een item van die lijst in dit project (`matchName`). Er wordt niets bewaard: je kiest daarna
 * zelf wat erbij komt.
 */
projectItems.post("/:id/items/scan-lines", async (c) => {
  const form = await c.req.formData();
  const db = c.env.DB;
  const access = await requireProject(db, c.get("person").id, c.req.param("id"));
  const type = (await typesFor(db, access.chain)).find((t) => t.id === form.get("type_id"));
  const counter = type?.fields.find((f) => f.type === "number" && f.counter && fieldAccess(access.rights, type.id, f.key) === "edit");
  if (!type || !counter || !canEditType(access.rights, type.id)) throw new ValidationError("In deze lijst kan je geen voorraad bijtellen.");
  const image = form.get("image");
  const none: ReceiptLines = { lines: [] };
  if (!(image instanceof File)) return c.json({ error: "Geen foto ontvangen" }, 400);
  if (!AI_IMAGE_TYPES.includes(image.type) || image.size > MAX_IMAGE_BYTES) return c.json({ ...none, message: "Deze foto kan niet gelezen worden." });
  const limit = await useAiBudget(c.env, c.get("person").id);
  if (limit) return c.json({ ...none, message: limit });

  try {
    const result = await c.env.AI.run(MODEL, {
      messages: [
        {
          role: "system",
          content: `Je leest een kasticket. Geef elke gekochte lijn:
- name: de productnaam zoals op het ticket (zonder prijs, code of gewicht)
- quantity: het aantal stuks (1 als er geen aantal staat, ook bij iets dat per gewicht verkocht wordt)
Sla totalen, kortingen, statiegeld, zakjes en betaalgegevens over. Geef enkel wat je echt ziet.`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Lees de lijnen van dit kasticket." },
            { type: "image_url", image_url: { url: `data:${image.type};base64,${toBase64(await image.arrayBuffer())}` } },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "lines",
          strict: true,
          schema: {
            type: "object",
            properties: {
              lines: {
                type: "array",
                items: {
                  type: "object",
                  properties: { name: { type: "string" }, quantity: { type: "number" } },
                  required: ["name", "quantity"],
                  additionalProperties: false,
                },
              },
            },
            required: ["lines"],
            additionalProperties: false,
          },
        },
      },
      chat_template_kwargs: { enable_thinking: false },
      temperature: 0,
      max_tokens: 1500,
    });
    const content = result.choices?.[0]?.message?.content;
    const parsed = ((typeof content === "string" ? safeJson(content) : content) ?? {}) as { lines?: unknown };
    const { results: known } = await db
      .prepare("SELECT id, name FROM items WHERE project_id = ? AND type_id = ? AND archived = 0")
      .bind(access.project.id, type.id)
      .all<{ id: string; name: string }>();
    // Per item één lijn (twee keer melk op het ticket: 2), wat niet gekend is per naam.
    const lines = new Map<string, ReceiptLines["lines"][number]>();
    for (const raw of Array.isArray(parsed.lines) ? parsed.lines.slice(0, 60) : []) {
      const l = (raw ?? {}) as { name?: unknown; quantity?: unknown };
      const name = typeof l.name === "string" ? l.name.trim().slice(0, 120) : "";
      if (!name) continue;
      const quantity = typeof l.quantity === "number" && l.quantity > 0 ? Math.min(99, Math.round(l.quantity)) || 1 : 1;
      const id = matchName(known, name);
      const key = id ?? `nieuw:${name.toLowerCase()}`;
      const prev = lines.get(key);
      lines.set(key, { name: prev?.name ?? name, quantity: (prev?.quantity ?? 0) + quantity, item_id: id, item_name: known.find((k) => k.id === id)?.name ?? null });
    }
    const out: ReceiptLines = { lines: [...lines.values()] };
    if (!out.lines.length) out.message = "Geen lijnen gevonden op deze foto.";
    return c.json(out);
  } catch (err) {
    console.error("AI kon het kasticket niet lezen", err);
    return c.json({ ...none, message: "Automatisch lezen lukte niet." });
  }
});

// ---------- zoeken ----------

/** Zoeken in je projecten en hun items (op naam), zonder op hoofdletters te letten. */
search.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 80);
  const db = c.env.DB;
  const nodes = await accessibleProjects(db, c.get("person").id);
  const out: SearchResult = { projects: [], items: [] };
  if (!q || !nodes.length) return c.json(out);
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const fold = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  out.projects = nodes.filter((n) => fold(n.name).includes(fold(q))).map((n) => ({ id: n.id, name: n.name, icon: n.icon, color: n.color }));
  const ids = nodes.map((n) => n.id);
  const { results } = await db
    .prepare(
      `SELECT i.id, i.name, i.type_id, i.project_id, t.name AS type_name, t.icon, p.name AS project_name FROM items i
       JOIN item_types t ON t.id = i.type_id JOIN projects p ON p.id = i.project_id
       WHERE i.project_id IN (SELECT value FROM json_each(?)) AND i.name LIKE ? AND i.archived = 0
       ORDER BY i.updated_at DESC LIMIT 60`,
    )
    .bind(JSON.stringify(ids), like)
    .all<SearchResult["items"][number]>();
  const rights = new Map(nodes.map((n) => [n.id, n.rights]));
  out.items = results.filter((r) => typeAccess(rights.get(r.project_id)!, r.type_id) !== "none").slice(0, 30);
  return c.json(out);
});
