// Bewaarde weergaven van een lijst (filters, sortering, kolommen; zie shared/views.ts). Voor jezelf, of voor iedereen
// in het project (dat mag enkel wie het project instelt). Wat binnenkomt, gaat door `cleanView`.

import { Hono } from "hono";
import { fieldAccess, typeAccess } from "../../shared/access";
import type { ItemType } from "../../shared/types";
import { cleanView, viewFields, type SavedView } from "../../shared/views";
import { requireProject, typesFor, type ProjectAccess } from "../context";
import type { AppEnv } from "../types";
import { asObject, ForbiddenError, NotFoundError, requiredString, ValidationError } from "../validate";

export const projectViews = new Hono<AppEnv>();
export const views = new Hono<AppEnv>();

/** Hoeveel weergaven één persoon hooguit per lijst bewaart. */
const MAX_VIEWS = 30;

type ViewRow = { id: string; project_id: string; type_id: string; person_id: string | null; name: string; def: string };

/** De velden van de lijst die jij ziet, met de naam, tags en toegevoegd op. */
export const fieldsForViews = (access: ProjectAccess, type: ItemType) =>
  viewFields(
    type.fields.filter((f) => fieldAccess(access.rights, type.id, f.key) !== "none"),
    type.name_label ?? "Naam",
  );

function checked(raw: unknown, access: ProjectAccess, type: ItemType) {
  try {
    return cleanView(raw, fieldsForViews(access, type));
  } catch (err) {
    throw new ValidationError((err as Error).message);
  }
}

const toView = (row: ViewRow, me: string, access: ProjectAccess): SavedView => ({
  id: row.id,
  name: row.name,
  shared: row.person_id === null,
  def: JSON.parse(row.def),
  can_edit: row.person_id === me || (row.person_id === null && access.rights.manage),
});

async function listIn(c: { env: AppEnv["Bindings"]; get: (k: "person") => { id: string } }, projectId: string, typeId: string | undefined) {
  const db = c.env.DB;
  const me = c.get("person").id;
  const access = await requireProject(db, me, projectId);
  const type = (await typesFor(db, access.chain)).find((t) => t.id === typeId && typeAccess(access.rights, t.id) !== "none");
  if (!type) throw new NotFoundError("Die lijst bestaat hier niet.");
  return { db, me, access, type };
}

projectViews.get("/:id/views", async (c) => {
  const { db, me, access, type } = await listIn(c, c.req.param("id"), c.req.query("type"));
  const { results } = await db
    .prepare(
      `SELECT * FROM views WHERE project_id = ? AND type_id = ? AND (person_id IS NULL OR person_id = ?)
       ORDER BY person_id IS NOT NULL, sort_order, name COLLATE NOCASE`,
    )
    .bind(access.project.id, type.id, me)
    .all<ViewRow>();
  return c.json(results.map((r) => toView(r, me, access)));
});

projectViews.post("/:id/views", async (c) => {
  const body = asObject(await c.req.json());
  const { db, me, access, type } = await listIn(c, c.req.param("id"), typeof body.type_id === "string" ? body.type_id : undefined);
  const shared = body.shared === true;
  if (shared && !access.rights.manage) throw new ForbiddenError("Enkel wie het project instelt, bewaart een weergave voor iedereen.");
  const def = checked(body.def, access, type);
  const count = await db
    .prepare("SELECT COUNT(*) AS n FROM views WHERE project_id = ? AND type_id = ? AND person_id IS ?")
    .bind(access.project.id, type.id, shared ? null : me)
    .first<number>("n");
  if ((count ?? 0) >= MAX_VIEWS) throw new ValidationError(`Hoogstens ${MAX_VIEWS} weergaven per lijst.`);
  const id = crypto.randomUUID();
  const row: ViewRow = { id, project_id: access.project.id, type_id: type.id, person_id: shared ? null : me, name: requiredString(body, "name", 40), def: JSON.stringify(def) };
  await db
    .prepare("INSERT INTO views (id, project_id, type_id, person_id, name, def) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(row.id, row.project_id, row.type_id, row.person_id, row.name, row.def)
    .run();
  return c.json(toView(row, me, access), 201);
});

/** Een weergave die jij mag aanpassen: je eigen, of een gedeelde als je het project instelt. */
async function editable(c: Parameters<typeof listIn>[0], id: string) {
  const db = c.env.DB;
  const me = c.get("person").id;
  const row = await db.prepare("SELECT * FROM views WHERE id = ?").bind(id).first<ViewRow>();
  if (!row || (row.person_id !== null && row.person_id !== me)) throw new NotFoundError("Die weergave bestaat niet (meer).");
  const { access, type } = await listIn(c, row.project_id, row.type_id);
  if (row.person_id === null && !access.rights.manage) throw new ForbiddenError("Enkel wie het project instelt, past een gedeelde weergave aan.");
  return { db, me, row, access, type };
}

views.put("/:id", async (c) => {
  const { db, me, row, access, type } = await editable(c, c.req.param("id"));
  const body = asObject(await c.req.json());
  const next: ViewRow = {
    ...row,
    name: body.name === undefined ? row.name : requiredString(body, "name", 40),
    def: body.def === undefined ? row.def : JSON.stringify(checked(body.def, access, type)),
  };
  await db.prepare("UPDATE views SET name = ?, def = ? WHERE id = ?").bind(next.name, next.def, row.id).run();
  return c.json(toView(next, me, access));
});

views.delete("/:id", async (c) => {
  const { db, row } = await editable(c, c.req.param("id"));
  await db.prepare("DELETE FROM views WHERE id = ?").bind(row.id).run();
  return c.body(null, 204);
});
