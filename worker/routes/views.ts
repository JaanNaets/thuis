// Bewaarde weergaven: filters, sortering, kolommen en groeperen op de dingen of het logboek van een lijst, of over al
// je lijsten (`list_id` null, het logboek). Een weergave is geen beveiliging: ze filtert enkel wat je al ziet.
// `shared`: ook voor iedereen bij de lijst (enkel wie in de lijst mag wijzigen).

import { Hono } from "hono";
import { logFields } from "../../shared/logview";
import { canEdit, canManage, type Role } from "../../shared/model";
import { cleanView, viewFields, type SavedView, type ViewDef } from "../../shared/views";
import { kindsFor, parseJson, requireList, seenLists } from "../access";
import type { AppEnv } from "../types";
import { asObject, ForbiddenError, NotFoundError, requiredString, ValidationError } from "../validate";

export const views = new Hono<AppEnv>();


type Row = { id: string; owner_id: string; list_id: string | null; target: "dingen" | "logboek"; name: string; def: string; shared: number };

views.get("/", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const listId = c.req.query("list") || null;
  const role = listId ? (await requireList(db, me.id, listId)).role : null;
  const { results } = await db
    .prepare(
      `SELECT * FROM saved_views WHERE ${listId ? "list_id = ?2 AND (owner_id = ?1 OR shared = 1)" : "list_id IS NULL AND owner_id = ?1"} ORDER BY sort_order, created_at`,
    )
    .bind(...(listId ? [me.id, listId] : [me.id]))
    .all<Row>();
  return c.json(results.map((r) => toView(r, me.id, role)));
});

const toView = (r: Row, me: string, role: Role | null | undefined): SavedView => ({
  id: r.id,
  list_id: r.list_id,
  target: r.target,
  name: r.name,
  def: parseJson(r.def, { match: "all", conditions: [] }),
  shared: Boolean(r.shared),
  can_edit: r.owner_id === me || (Boolean(r.shared) && canManage(role)),
});

async function viewById(db: D1Database, id: string, me: string): Promise<SavedView> {
  const row = await db.prepare("SELECT * FROM saved_views WHERE id = ?").bind(id).first<Row>();
  const role = row?.list_id ? (await seenLists(db, me, row.list_id)).get(row.list_id) : null;
  return toView(row!, me, role);
}

/** De velden waartegen een weergave nagekeken wordt. */
async function fieldsFor(db: D1Database, personId: string, listId: string | null, target: "dingen" | "logboek") {
  const seen = await seenLists(db, personId);
  if (target === "dingen") {
    if (!listId) throw new ValidationError("Kies een lijst");
    const { list } = await requireList(db, personId, listId);
    return viewFields(list.fields, list.one ?? "Naam");
  }
  const { results } = await db.prepare("SELECT name FROM lists WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify([...seen.keys()])).all<{ name: string }>();
  return viewFields(logFields(await kindsFor(db, seen.keys()), results), "Omschrijving");
}

function checkedDef(raw: unknown, fields: Parameters<typeof cleanView>[1]): ViewDef {
  try {
    return cleanView(raw, fields);
  } catch (err) {
    throw new ValidationError(err instanceof Error ? err.message : "Geen geldige weergave");
  }
}

views.post("/", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const body = asObject(await c.req.json());
  const listId = typeof body.list_id === "string" ? body.list_id : null;
  const target = body.target === "dingen" ? "dingen" : "logboek";
  const shared = body.shared === true;
  if (listId) {
    const { role } = await requireList(db, me.id, listId);
    if (shared && !canEdit(role)) throw new ForbiddenError("Je mag in deze lijst enkel kijken.");
  }
  const def = checkedDef(body.def, await fieldsFor(db, me.id, listId, target));
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO saved_views (id, owner_id, list_id, target, name, def, shared) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, me.id, listId, target, requiredString(body, "name", 40), JSON.stringify(def), shared && listId ? 1 : 0)
    .run();
  return c.json(await viewById(db, id, me.id), 201);
});

async function editable(db: D1Database, personId: string, id: string): Promise<Row> {
  const row = await db.prepare("SELECT * FROM saved_views WHERE id = ?").bind(id).first<Row>();
  if (!row) throw new NotFoundError("Die weergave bestaat niet (meer).");
  if (row.owner_id === personId) return row;
  if (row.shared && row.list_id && canManage((await seenLists(db, personId, row.list_id)).get(row.list_id))) return row;
  throw new NotFoundError("Die weergave bestaat niet (meer).");
}

views.put("/:id", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const row = await editable(db, me.id, c.req.param("id"));
  const body = asObject(await c.req.json());
  const def = body.def === undefined ? parseJson<ViewDef>(row.def, { match: "all", conditions: [] }) : checkedDef(body.def, await fieldsFor(db, me.id, row.list_id, row.target));
  await db
    .prepare("UPDATE saved_views SET name = ?, def = ?, shared = ? WHERE id = ?")
    .bind(body.name === undefined ? row.name : requiredString(body, "name", 40), JSON.stringify(def), body.shared === undefined ? row.shared : body.shared === true && row.list_id ? 1 : 0, row.id)
    .run();
  return c.json(await viewById(db, row.id, me.id));
});

views.delete("/:id", async (c) => {
  const db = c.env.DB;
  const row = await editable(db, c.get("person").id, c.req.param("id"));
  await db.prepare("DELETE FROM saved_views WHERE id = ?").bind(row.id).run();
  return c.body(null, 204);
});
