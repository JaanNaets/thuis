import { Hono } from "hono";
import {
  canCreate,
  canDelete,
  canSeeType,
  cleanRights,
  DEFAULT_ROLES,
  fieldAccess,
  fieldAccessMap,
  typeAccess,
  visibleFields,
  type Rights,
} from "../../shared/access";
import { cleanFields, type FieldDef } from "../../shared/fields";
import { checkCalcs } from "../../shared/calc";
import {
  cleanTotals,
  computeTotal,
  isPayments,
  itemNet,
  MAX_TOTALS,
  settleUp,
  sourceMisfit,
  totalKeys,
  totalLabel,
  visibleTotals,
  goalFor,
  type TotalDef,
  type TotalResult,
} from "../../shared/totals";
import {
  buildTemplateFile,
  flatten,
  parseTemplateFile,
  planTemplate,
  type ExportProject,
  type TemplateFile,
  type TemplateProject,
} from "../../shared/template-file";
import { isIconKey, isTemplateKey, PROJECT_TEMPLATES, resolveTemplateLists, typeTemplate, type TemplatePlan } from "../../shared/templates";
import { descendantIds } from "../../shared/tree";
import { itemsAsSeen, type SeenItem } from "../compute";
import { isTone, type Balance, type ItemType, type Member, type Person, type ProjectDetail, type ProjectNode, type Role, type Tag } from "../../shared/types";
import {
  accessibleProjects,
  need,
  parseRights,
  placeholders,
  projectAccess,
  requireProject,
  toItemType,
  typesFor,
  visibleLists,
  type ProjectAccess,
  type TypeRow,
} from "../context";
import type { AppEnv } from "../types";
import {
  asObject,
  ConflictError,
  ForbiddenError,
  guard,
  NotFoundError,
  optionalId,
  optionalString,
  parseOrder,
  requiredId,
  requiredString,
  ValidationError,
} from "../validate";

export const projects = new Hono<AppEnv>();

// ---------- hulpjes ----------

function parseProjectInput(body: unknown) {
  const obj = asObject(body);
  const icon = obj.icon ?? null;
  if (icon !== null && !isIconKey(icon)) throw new ValidationError("Onbekend icoon");
  const color = obj.color ?? null;
  if (color !== null && !isTone(color)) throw new ValidationError("Onbekende kleur");
  return {
    name: requiredString(obj, "name", 80),
    description: optionalString(obj, "description", 2000),
    icon: icon as string | null,
    color: color as string | null,
    parent_id: optionalId(obj, "parent_id"),
    template: obj.template ?? null,
  };
}

/**
 * Velden van een lijst nakijken, met verwijzingen naar lijsten die je kan kiezen (zie `fieldListsFor`). "self" verwijst
 * naar de lijst zelf (een plaats die in een andere plaats ligt).
 */
function cleanTypeFields(raw: unknown, available: ItemType[], selfId: string, calcLists: ItemType[] = available): FieldDef[] {
  let fields: FieldDef[];
  try {
    const list = Array.isArray(raw)
      ? raw.map((f) => {
          if (!f || typeof f !== "object") return f;
          const def = f as FieldDef;
          const calc = def.calc as { list?: string } | undefined;
          return {
            ...def,
            ...(def.ref_type === "self" ? { ref_type: selfId } : {}),
            ...(calc && typeof calc === "object" && calc.list === "self" ? { calc: { ...calc, list: selfId } } : {}),
          };
        })
      : raw;
    fields = cleanFields(list);
  } catch (err) {
    throw new ValidationError((err as Error).message);
  }
  const ids = new Set([...available.map((t) => t.id), selfId]);
  for (const f of fields) {
    if ((f.type === "item" || f.type === "items") && !ids.has(f.ref_type!))
      throw new ValidationError(`"${f.label}" verwijst naar een lijst die niet (meer) bestaat, of die je niet ziet`);
  }
  try {
    return checkCalcs(
      fields,
      calcLists.filter((t) => t.id !== selfId),
      selfId,
    );
  } catch (err) {
    throw new ValidationError((err as Error).message);
  }
}

/**
 * De lijsten waar een veld naar kan wijzen of uit kan tellen: van dit project en erboven, eronder (om te tellen wat
 * naar een lijst verwijst, bv. de wijnen in een subproject bij een verkoper erboven), en elke lijst die je in een
 * ander project mag zien (met enkel de velden die je daar ziet). Wie de items leest, ziet er enkel van wat hij zelf
 * mag zien (zie worker/compute.ts en de namen bij een item).
 */
async function fieldListsFor(db: D1Database, personId: string, access: ProjectAccess): Promise<{ refs: ItemType[]; calcs: ItemType[] }> {
  const [chain, tree, elsewhere] = await Promise.all([typesFor(db, access.chain), calcListsFor(db, access), visibleLists(db, personId)]);
  const add = (lists: ItemType[]) => [...lists, ...elsewhere.filter((l) => !lists.some((x) => x.id === l.id))];
  return { refs: add(chain), calcs: add(tree) };
}

/**
 * De lijsten waarmee een berekening kan werken binnen de boom: van dit project, erboven (zoals bij verwijzingen) en
 * eronder.
 */
async function calcListsFor(db: D1Database, access: ProjectAccess): Promise<ItemType[]> {
  const { results } = await db
    .prepare(
      `WITH RECURSIVE down(id) AS (SELECT ?1 UNION SELECT p.id FROM projects p JOIN down ON p.parent_id = down.id)
       SELECT * FROM item_types WHERE project_id IN (SELECT id FROM down) OR project_id IN (SELECT value FROM json_each(?2))`,
    )
    .bind(access.project.id, JSON.stringify(access.chain))
    .all<TypeRow>();
  return results.map(toItemType);
}

function parseTypeInput(body: unknown) {
  const obj = asObject(body);
  const icon = obj.icon ?? null;
  if (icon !== null && !isIconKey(icon)) throw new ValidationError("Onbekend icoon");
  const name = requiredString(obj, "name", 40);
  return {
    name,
    plural: optionalString(obj, "plural", 40) ?? name,
    name_label: optionalString(obj, "name_label", 40),
    icon: icon as string | null,
    fields: obj.fields,
    totals: obj.totals,
  };
}

/** Wie in een gewone verdeling staat (`default_shares`), moet in het project zitten. */
async function checkDefaultShares(db: D1Database, fields: FieldDef[], chain: string[]): Promise<void> {
  const people = [...new Set(fields.flatMap((f) => (f.default_shares ?? []).map((s) => s.person_id)))];
  if (!people.length) return;
  const { results } = await db
    .prepare(
      `SELECT DISTINCT person_id FROM memberships WHERE project_id IN (${placeholders(chain.length)}) AND person_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(...chain, JSON.stringify(people))
    .all();
  if (results.length !== people.length) throw new ValidationError("De gewone verdeling: kies enkel mensen uit dit project.");
}

/**
 * "Ook uit": lijsten uit andere projecten moeten bestaan, door jou te zien zijn, en dezelfde velden hebben (op sleutel,
 * van een passende soort).
 */
async function checkSources(db: D1Database, personId: string, totals: TotalDef[], fields: FieldDef[], selfId: string): Promise<void> {
  const ids = [...new Set(totals.flatMap((t) => t.sources ?? []))];
  if (!ids.length) return;
  const [{ results }, nodes] = await Promise.all([
    db.prepare("SELECT * FROM item_types WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ids)).all<TypeRow>(),
    accessibleProjects(db, personId),
  ]);
  const rightsOf = new Map(nodes.map((n) => [n.id, n.rights]));
  const lists = new Map(results.map(toItemType).map((l) => [l.id, l]));
  for (const t of totals) {
    for (const id of t.sources ?? []) {
      const list = lists.get(id);
      const rights = list && rightsOf.get(list.project_id);
      if (!list || id === selfId || !rights || !canSeeType(rights, list.id))
        throw new ValidationError(`${totalLabel(t, fields)}: een lijst bij "ook uit" bestaat niet (meer), of je ziet ze niet.`);
      const misfit = sourceMisfit(t, fields, list.fields);
      if (misfit) throw new ValidationError(`${totalLabel(t, fields)}: ${list.plural} ${misfit}.`);
    }
  }
}

/** Wie een eigen doel heeft (bij "enkel van jou"), moet in het project zitten. */
async function checkGoalPeople(db: D1Database, totals: TotalDef[], chain: string[]): Promise<void> {
  const people = [...new Set(totals.flatMap((t) => Object.keys(t.goals ?? {})))];
  if (!people.length) return;
  const { results } = await db
    .prepare(
      `SELECT DISTINCT person_id FROM memberships WHERE project_id IN (${placeholders(chain.length)}) AND person_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(...chain, JSON.stringify(people))
    .all();
  if (results.length !== people.length) throw new ValidationError("Een doel per persoon: kies enkel mensen uit dit project.");
}

/** De totalen van een lijst nakijken tegen haar (nagekeken) velden. */
function cleanTypeTotals(raw: unknown, fields: FieldDef[]): TotalDef[] {
  try {
    return cleanTotals(raw, fields);
  } catch (err) {
    throw new ValidationError((err as Error).message);
  }
}

/** Totalen die je niet aanraakte: wat niet meer bij de velden past (een veld is weg), valt weg. */
function keepTotals(totals: TotalDef[], fields: FieldDef[]): TotalDef[] {
  return totals.flatMap((t) => {
    try {
      return cleanTotals([t], fields);
    } catch {
      return [];
    }
  });
}

/** Het bovenste project van de boom (waar de beheerders staan). */
const rootOf = (access: ProjectAccess) => access.chain[access.chain.length - 1];

/** Een lidmaatschap. Staat het project bovenaan je overzicht, dan komt het daar achteraan. */
function insertMembership(db: D1Database, projectId: string, personId: string, roleId: string) {
  return db
    .prepare(
      `INSERT INTO memberships (project_id, person_id, role_id, sort_order)
       VALUES (?1, ?2, ?3, (SELECT ifnull(max(sort_order), 0) + 10 FROM memberships WHERE person_id = ?2))`,
    )
    .bind(projectId, personId, roleId);
}

/**
 * Er moet bovenaan altijd iemand overblijven die alles mag (instellen én mensen beheren), anders kan niemand het
 * project nog beheren. `change` is wat er zou veranderen: een rol met nieuwe rechten, of een lidmaatschap.
 */
async function assertKeepsAdmin(
  db: D1Database,
  rootId: string,
  change: { role?: { id: string; rights: Rights }; member?: { person_id: string; role_id: string | null } },
) {
  const { results } = await db
    .prepare("SELECT m.person_id, m.role_id, r.rights FROM memberships m JOIN roles r ON r.id = m.role_id WHERE m.project_id = ?")
    .bind(rootId)
    .all<{ person_id: string; role_id: string; rights: string }>();
  let members = results.map((m) => ({ person_id: m.person_id, role_id: m.role_id, rights: parseRights(m.rights) }));
  if (change.member) {
    members = members.filter((m) => m.person_id !== change.member!.person_id);
    if (change.member.role_id) {
      const role = await db.prepare("SELECT rights FROM roles WHERE id = ?").bind(change.member.role_id).first<{ rights: string }>();
      members.push({ person_id: change.member.person_id, role_id: change.member.role_id, rights: parseRights(role?.rights) });
    }
  }
  if (change.role) members = members.map((m) => (m.role_id === change.role!.id ? { ...m, rights: change.role!.rights } : m));
  if (!members.some((m) => m.rights.manage && m.rights.members)) {
    throw new ConflictError("Er moet bovenaan altijd iemand blijven die het project instelt én mensen beheert.");
  }
}

/**
 * Een rol moet van dit project of erboven komen. En niemand geeft meer dan die zelf mag: een rol die het project
 * instelt, kan enkel wie zelf het project instelt.
 */
async function assertRoleAllowed(db: D1Database, roleId: string, access: ProjectAccess) {
  const role = await db
    .prepare(`SELECT id, rights FROM roles WHERE id = ? AND project_id IN (${placeholders(access.chain.length)})`)
    .bind(roleId, ...access.chain)
    .first<{ id: string; rights: string }>();
  if (!role) throw new ValidationError("Kies een rol van dit project");
  if (parseRights(role.rights).manage && !access.rights.manage)
    throw new ForbiddenError("Een rol die het project instelt, kan enkel wie zelf het project instelt.");
}

/** Lijsten erboven op naam, de dichtste eerst ("verkoper" → de Verkopers van het huishouden). */
const byNameOf = (above: ItemType[]) => Object.fromEntries([...above].reverse().map((t) => [t.name.toLowerCase(), t.id]));

/**
 * Lijsten uit een sjabloon aanmaken (zie `planTemplate`): met echte verwijzingen, en enkel de berekeningen en regels
 * die dan nog kloppen. `above`: de lijsten die er al zijn en waarmee ze mogen werken (erboven, en bij een bestaand
 * project ook eronder).
 */
function templateStatements(db: D1Database, nodes: { projectId: string; plans: TemplatePlan[] }[], byName: Record<string, string>, above: ItemType[]) {
  const plans = nodes.flatMap((n) => n.plans.map((plan) => ({ ...plan, projectId: n.projectId })));
  const fields = resolveTemplateLists(plans, byName, above);
  return plans.map(({ id, list, projectId }) => {
    // Een totaal waarvan de velden er niet (meer) zijn, valt weg; lijsten uit andere projecten komen niet mee.
    const totals = keepTotals(list.totals ?? [], fields[id])
      .map(({ sources: _sources, goals: _goals, ...t }) => t)
      .slice(0, MAX_TOTALS);
    return db
      .prepare(
        `INSERT INTO item_types (id, project_id, name, plural, name_label, icon, fields, totals, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, (SELECT ifnull(max(sort_order), 0) + 10 FROM item_types WHERE project_id = ?2))`,
      )
      .bind(id, projectId, list.name, list.plural, list.name_label ?? null, list.icon, JSON.stringify(fields[id]), JSON.stringify(totals));
  });
}

/** Een ingebouwd sjabloon in een nieuw project. `chain`: de projecten erboven. */
async function insertTemplateTypes(db: D1Database, projectId: string, templateKey: unknown, chain: string[]): Promise<D1PreparedStatement[]> {
  if (!isTemplateKey(templateKey)) return [];
  const template = PROJECT_TEMPLATES[templateKey];
  const above = chain.length ? await typesFor(db, chain) : [];
  const byName = byNameOf(above);
  const top: TemplateProject = { name: template.label, description: null, icon: null, color: null, lists: [...template.types], children: [] };
  return templateStatements(
    db,
    planTemplate(top, [projectId], byName, () => crypto.randomUUID()),
    byName,
    above,
  );
}

/** Een sjabloon uit een verzoek: nagekeken, en niet te groot. */
function readTemplate(raw: unknown): TemplateFile {
  if (JSON.stringify(raw ?? null).length > 400_000) throw new ValidationError("Dit sjabloon is te groot.");
  try {
    return parseTemplateFile(raw);
  } catch (err) {
    throw new ValidationError((err as Error).message);
  }
}

/** Het project en zijn subprojecten (niet gearchiveerd), elk na zijn ouder, in hun volgorde. */
async function exportTree(db: D1Database, rootId: string): Promise<ExportProject[]> {
  const { results } = await db
    .prepare(
      `WITH RECURSIVE down(id, depth) AS (SELECT ?1, 0 UNION SELECT p.id, down.depth + 1 FROM projects p JOIN down ON p.parent_id = down.id WHERE p.archived = 0)
       SELECT p.id, p.parent_id, p.name, p.description, p.icon, p.color FROM projects p JOIN down ON down.id = p.id ORDER BY down.depth, p.sort_order, p.created_at`,
    )
    .bind(rootId)
    .all<ExportProject>();
  return results;
}

// ---------- projecten ----------

/**
 * Een nieuw project. Bovenaan mag iedereen er een maken (je wordt er beheerder van); een subproject enkel wie het
 * project erboven mag instellen. Een sjabloon zet lijsten klaar.
 */
projects.post("/", async (c) => {
  const input = parseProjectInput(await c.req.json());
  const db = c.env.DB;
  const me = c.get("person");
  const id = crypto.randomUUID();
  let chain: string[] = [];
  if (input.parent_id) {
    const parent = await requireProject(db, me.id, input.parent_id);
    need(parent, "manage", "Enkel wie het project instelt, kan er een subproject in maken.");
    chain = parent.chain;
  }
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO projects (id, parent_id, name, description, icon, color, sort_order, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT ifnull(max(sort_order), 0) + 10 FROM projects WHERE parent_id IS ?2), ?7)`,
      )
      .bind(id, input.parent_id, input.name, input.description, input.icon, input.color, me.id),
  ];
  if (!input.parent_id) {
    // Bovenaan: de standaardrollen, en jij als beheerder.
    const roleIds = DEFAULT_ROLES.map(() => crypto.randomUUID());
    DEFAULT_ROLES.forEach((r, i) =>
      statements.push(
        db
          .prepare("INSERT INTO roles (id, project_id, name, rights, sort_order) VALUES (?, ?, ?, ?, ?)")
          .bind(roleIds[i], id, r.name, JSON.stringify(r.rights), i * 10),
      ),
    );
    statements.push(insertMembership(db, id, me.id, roleIds[0]));
  }
  statements.push(...(await insertTemplateTypes(db, id, input.template, chain)));
  await db.batch(statements);
  return c.json({ id }, 201);
});

/**
 * Een nieuw project uit een gedeeld sjabloon (een bestand), met zijn subprojecten en lijsten; zonder items of mensen.
 * Zoals een gewoon nieuw project: bovenaan word je beheerder, een subproject enkel als je het project erboven instelt.
 * Naam, icoon, kleur en beschrijving mag je meegeven (anders die uit het sjabloon).
 */
projects.post("/import", async (c) => {
  const body = asObject(await c.req.json());
  const file = readTemplate(body.file);
  const overrides = parseProjectInput({ ...file.project, ...body, template: null });
  const db = c.env.DB;
  const me = c.get("person");
  let chain: string[] = [];
  if (overrides.parent_id) {
    const parent = await requireProject(db, me.id, overrides.parent_id);
    need(parent, "manage", "Enkel wie het project instelt, kan er een subproject in maken.");
    chain = parent.chain;
  }
  const nodes = flatten(file.project);
  const ids = nodes.map(() => crypto.randomUUID());
  const statements: D1PreparedStatement[] = nodes.map(({ project, parent }, i) => {
    const top = i === 0;
    const parentId = top ? overrides.parent_id : ids[parent!];
    return db
      .prepare(
        `INSERT INTO projects (id, parent_id, name, description, icon, color, sort_order, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT ifnull(max(sort_order), 0) + 10 FROM projects WHERE parent_id IS ?2), ?7)`,
      )
      .bind(
        ids[i],
        parentId,
        top ? overrides.name : project.name,
        top ? overrides.description : project.description,
        top ? overrides.icon : project.icon,
        top ? overrides.color : project.color,
        me.id,
      );
  });
  if (!overrides.parent_id) {
    const roleIds = DEFAULT_ROLES.map(() => crypto.randomUUID());
    DEFAULT_ROLES.forEach((r, i) =>
      statements.push(
        db
          .prepare("INSERT INTO roles (id, project_id, name, rights, sort_order) VALUES (?, ?, ?, ?, ?)")
          .bind(roleIds[i], ids[0], r.name, JSON.stringify(r.rights), i * 10),
      ),
    );
    statements.push(insertMembership(db, ids[0], me.id, roleIds[0]));
  }
  const above = chain.length ? await typesFor(db, chain) : [];
  const byName = byNameOf(above);
  statements.push(
    ...templateStatements(
      db,
      planTemplate(file.project, ids, byName, () => crypto.randomUUID()),
      byName,
      above,
    ),
  );
  await db.batch(statements);
  return c.json({ id: ids[0] }, 201);
});

/**
 * Een project als sjabloon om te delen: zijn lijsten en velden en die van zijn subprojecten, zonder items, mensen,
 * rollen of tags. Een lijst erboven waarnaar verwezen wordt, komt mee. Enkel wie het project instelt.
 */
projects.get("/:id/template", async (c) => {
  const db = c.env.DB;
  const access = await requireProject(db, c.get("person").id, c.req.param("id"));
  need(access, "manage", "Enkel wie het project instelt, kan het als sjabloon delen.");
  const tree = await exportTree(db, access.project.id);
  const lists = await calcListsFor(db, access);
  return c.json(
    buildTemplateFile(
      tree,
      lists.sort((a, b) => a.sort_order - b.sort_order),
    ),
  );
});

/** De volgorde van de subprojecten. Die geldt voor iedereen, dus enkel wie het project instelt. */
projects.put("/:id/children/order", async (c) => {
  const db = c.env.DB;
  const access = await requireProject(db, c.get("person").id, c.req.param("id"));
  need(access, "manage", "Enkel wie het project instelt, kan de subprojecten ordenen.");
  const ids = parseOrder(await c.req.json());
  await db.batch(ids.map((id, i) => db.prepare("UPDATE projects SET sort_order = ? WHERE id = ? AND parent_id = ?").bind((i + 1) * 10, id, access.project.id)));
  return c.json({ ok: true });
});

/** De volgorde van de eigen lijsten (de tabs van het project). */
projects.put("/:id/types/order", async (c) => {
  const db = c.env.DB;
  const access = await requireProject(db, c.get("person").id, c.req.param("id"));
  need(access, "manage", "Enkel wie het project instelt, kan de lijsten ordenen.");
  const ids = parseOrder(await c.req.json());
  await db.batch(
    ids.map((id, i) => db.prepare("UPDATE item_types SET sort_order = ? WHERE id = ? AND project_id = ?").bind((i + 1) * 10, id, access.project.id)),
  );
  return c.json({ ok: true });
});

projects.get("/:id", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const access = await requireProject(db, me.id, c.req.param("id"));
  const { chain, rights } = access;
  const id = access.project.id;
  const inChain = placeholders(chain.length);

  const [children, ownChild, tags, roles, memberships, counts, childCounts] = await db.batch([
    db.prepare("SELECT * FROM projects WHERE parent_id = ? ORDER BY archived, sort_order, name COLLATE NOCASE").bind(id),
    db
      .prepare(
        `SELECT m.project_id, m.role_id, r.name AS role_name, r.rights FROM memberships m JOIN roles r ON r.id = m.role_id
         JOIN projects p ON p.id = m.project_id WHERE p.parent_id = ? AND m.person_id = ?`,
      )
      .bind(id, me.id),
    db.prepare(`SELECT * FROM tags WHERE project_id IN (${inChain}) ORDER BY name COLLATE NOCASE`).bind(...chain),
    db
      .prepare(
        `SELECT r.*, (SELECT COUNT(*) FROM memberships m WHERE m.role_id = r.id) AS member_count
         FROM roles r WHERE r.project_id IN (${inChain}) ORDER BY r.sort_order, r.created_at`,
      )
      .bind(...chain),
    db
      .prepare(
        `SELECT m.project_id, m.role_id, p.id AS person_id, p.name, p.email, p.color FROM memberships m JOIN people p ON p.id = m.person_id
         WHERE m.project_id IN (${inChain})`,
      )
      .bind(...chain),
    db.prepare("SELECT type_id, COUNT(*) AS n FROM items WHERE project_id = ? AND archived = 0 GROUP BY type_id").bind(id),
    db
      .prepare(
        `WITH RECURSIVE down(id, top) AS (
           SELECT id, id FROM projects WHERE parent_id = ?1
           UNION ALL SELECT p.id, down.top FROM projects p JOIN down ON p.parent_id = down.id
         )
         SELECT down.top AS id, COUNT(i.id) AS n FROM down LEFT JOIN items i ON i.project_id = down.id AND i.archived = 0 GROUP BY down.top`,
      )
      .bind(id),
  ]);

  const ownByChild = new Map((ownChild.results as { project_id: string; role_id: string; role_name: string; rights: string }[]).map((m) => [m.project_id, m]));
  const childCount = new Map((childCounts.results as { id: string; n: number }[]).map((r) => [r.id, r.n]));
  const childNodes = (children.results as (ProjectNode & { created_by: string })[]).map(({ created_by: _c, ...child }) => {
    const own = ownByChild.get(child.id);
    return {
      ...child,
      role_id: own?.role_id ?? access.role.id,
      role_name: own?.role_name ?? access.role.name,
      rights: own ? parseRights(own.rights) : rights,
      inherited: !own,
      item_count: childCount.get(child.id) ?? 0,
    };
  });

  // Per persoon het dichtstbijzijnde lidmaatschap (het project zelf, anders erboven).
  const nearest = new Map<string, Member>();
  for (const m of (
    memberships.results as { project_id: string; role_id: string; person_id: string; name: string; email: string | null; color: string | null }[]
  ).sort((a, b) => chain.indexOf(a.project_id) - chain.indexOf(b.project_id))) {
    if (nearest.has(m.person_id)) continue;
    nearest.set(m.person_id, {
      person: { id: m.person_id, name: m.name, email: m.email, color: m.color } as Person,
      role_id: m.role_id,
      project_id: m.project_id,
      inherited: m.project_id !== id,
    });
  }

  const types = (await typesFor(db, chain))
    .filter((t) => canSeeType(rights, t.id))
    .map((t) => {
      const fields = visibleFields(rights, t.id, t.fields);
      return {
        ...t,
        fields,
        // Een totaal op een veld dat je niet ziet (of waarvan het afhangt), krijg je niet.
        totals: visibleTotals(t.totals, fields),
        access: typeAccess(rights, t.id),
        field_access: fieldAccessMap(rights, t.id, t.fields),
        can_create: canCreate(rights, t.id),
        can_delete: canDelete(rights, t.id),
      };
    });
  const visible = new Set(types.map((t) => t.id));

  const detail: ProjectDetail = {
    project: { ...access.project, role_id: access.role.id, role_name: access.role.name, rights, inherited: access.inherited },
    path: access.path,
    children: childNodes,
    types,
    tags: tags.results as Tag[],
    roles: (roles.results as (Omit<Role, "rights"> & { rights: string })[]).map((r) => ({ ...r, rights: parseRights(r.rights) })),
    members: [...nearest.values()].sort((a, b) => a.person.name.localeCompare(b.person.name, "nl")),
    counts: Object.fromEntries((counts.results as { type_id: string; n: number }[]).filter((r) => visible.has(r.type_id)).map((r) => [r.type_id, r.n])),
  };
  delete (detail.project as { created_by?: string }).created_by;
  return c.json(detail);
});

/**
 * Wie wie nog hoeveel moet: alle items in dit project en eronder uit lijsten met de regel Kosten verdelen of
 * Terugbetalingen. Telt enkel wat jij mag zien: de lijst, en het bedrag, wie betaalde en de verdeling. Wat je niet
 * mag zien, telt niet mee (en verraadt niets).
 */
/**
 * De totalen van een lijst op een project, zoals jij ze ziet (?type=, ?today= jouw datum). Elk item telt met jouw
 * rechten in zijn project: het project zelf, eventueel de subprojecten, en de lijsten uit andere projecten bij "ook
 * uit". Een saldo dat verrekent, staat in Wie moet wie (zie /balance).
 */
projects.get("/:id/totals", async (c) => {
  const db = c.env.DB;
  const me = c.get("person").id;
  const access = await requireProject(db, me, c.req.param("id"));
  const type = (await typesFor(db, access.chain)).find((t) => t.id === c.req.query("type"));
  if (!type || !canSeeType(access.rights, type.id)) throw new NotFoundError("Die lijst bestaat niet (meer).");
  const fields = visibleFields(access.rights, type.id, type.fields);
  const totals = visibleTotals(type.totals, fields).filter((t) => !t.settle);
  if (!totals.length) return c.json([]);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query("today") ?? "") ? c.req.query("today")! : new Date().toISOString().slice(0, 10);

  const nodes = await accessibleProjects(db, me);
  const rightsOf = new Map(nodes.map((n) => [n.id, n.rights]));
  const below = [...descendantIds(nodes, access.project.id)];
  const sources = await listsById(db, totals.flatMap((t) => t.sources ?? []));
  const out: { id: string; result: TotalResult; goal?: number }[] = [];
  const people = new Set<string>();
  for (const t of totals) {
    const all = await totalItems(db, me, rightsOf, t, type, t.scope === "tree" ? below : [access.project.id], sources);
    // Enkel van jou: de items waar jij in staat (bv. bij Wie), met jouw eigen doel.
    const items = t.mine ? all.filter((i) => i.data[t.mine!] === me) : all;
    const result = computeTotal(t, fields, items, today);
    const groupType = fields.find((f) => f.key === t.by)?.type;
    if (groupType === "person" || groupType === "people" || groupType === "share") for (const g of result.groups) people.add(g.key);
    const goal = goalFor(t, me);
    out.push({ id: t.id, result, ...(goal !== undefined ? { goal } : {}) });
  }
  // Namen bij de groepen per persoon.
  const names = new Map(
    (
      await db
        .prepare("SELECT id, name FROM people WHERE id IN (SELECT value FROM json_each(?))")
        .bind(JSON.stringify([...people]))
        .all<{ id: string; name: string }>()
    ).results.map((p) => [p.id, p.name]),
  );
  for (const { result } of out) for (const g of result.groups) g.label = names.get(g.key) ?? g.key;
  return c.json(out);
});

/** Lijsten op id (voor "ook uit"). */
async function listsById(db: D1Database, ids: string[]): Promise<Map<string, ItemType>> {
  if (!ids.length) return new Map();
  const { results } = await db
    .prepare("SELECT * FROM item_types WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify([...new Set(ids)]))
    .all<TypeRow>();
  return new Map(results.map(toItemType).map((l) => [l.id, l]));
}

/**
 * De items voor een totaal: van de lijst zelf in `projectIds`, en van de lijsten bij "ook uit" overal waar je ze mag
 * zien (een lijst die niet meer past, telt niet). Elk item één keer.
 */
async function totalItems(
  db: D1Database,
  me: string,
  rightsOf: Map<string, Rights>,
  t: TotalDef,
  type: ItemType,
  projectIds: string[],
  sources: Map<string, ItemType>,
): Promise<SeenItem[]> {
  const keys = totalKeys(t);
  const items = await itemsAsSeen(db, me, rightsOf, type, projectIds, keys);
  for (const id of t.sources ?? []) {
    const list = sources.get(id);
    if (!list || list.id === type.id || sourceMisfit(t, type.fields, list.fields)) continue;
    items.push(...(await itemsAsSeen(db, me, rightsOf, list, [...rightsOf.keys()], keys)));
  }
  const seen = new Set<string>();
  return items.filter((i) => !seen.has(i.id) && seen.add(i.id));
}

/**
 * Wie wie nog hoeveel moet in een project (met alles eronder): de totalen die verrekenen, van de lijsten hier, erboven
 * en eronder (en hun lijsten bij "ook uit"). Telt enkel wat je mag zien. "Terugbetaald" bewaart in een lijst met Van
 * en Aan uit de keten.
 */
projects.get("/:id/balance", async (c) => {
  const db = c.env.DB;
  const me = c.get("person").id;
  const access = await requireProject(db, me, c.req.param("id"));
  const nodes = await accessibleProjects(db, me);
  const rightsOf = new Map(nodes.map((n) => [n.id, n.rights]));
  const below = [...descendantIds(nodes, access.project.id)];
  const [{ results: typeRows }, chainTypes] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM item_types WHERE totals LIKE '%"settle":true%' AND (project_id IN (SELECT value FROM json_each(?1)) OR project_id IN (SELECT value FROM json_each(?2)))`,
      )
      .bind(JSON.stringify(below), JSON.stringify(access.chain))
      .all<TypeRow>(),
    typesFor(db, access.chain),
  ]);
  const settleOf = (t: ItemType) => t.totals.find((x) => x.settle);
  const settling = typeRows
    .map(toItemType)
    .map((type) => ({ type, total: settleOf(type)! }))
    .filter((x) => x.total);
  const payments = chainTypes.find((t) => {
    const total = settleOf(t);
    return (
      total &&
      isPayments(total, t.fields) &&
      canCreate(access.rights, t.id) &&
      totalKeys(total).every((k) => fieldAccess(access.rights, t.id, k) === "edit")
    );
  });
  const result: Balance = {
    active: false,
    people: [],
    net: [],
    transfers: [],
    counted: 0,
    settle: null,
    can_add_settle: access.rights.manage && !chainTypes.some((t) => settleOf(t) && isPayments(settleOf(t)!, t.fields)),
  };
  if (!settling.length) return c.json(result);

  const sources = await listsById(
    db,
    settling.flatMap((x) => x.total.sources ?? []),
  );
  const net = new Map<string, number>();
  const counted = new Set<string>();
  for (const { type, total } of settling) {
    for (const item of await totalItems(db, me, rightsOf, total, type, below, sources)) {
      if (counted.has(item.id)) continue;
      const contribution = itemNet(total, type.fields, item.data);
      if (!contribution) continue;
      counted.add(item.id);
      for (const [id, cents] of contribution) net.set(id, (net.get(id) ?? 0) + cents);
    }
  }
  const ids = [...net.keys()];
  // Met hun rekeningnummer: wie moet, kan zo terugbetalen met een betaal-QR.
  const { results: people } = await db
    .prepare("SELECT id, name, email, color, iban FROM people WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(ids))
    .all<Person>();
  // Zichtbaar als hier een lijst met uitgaven (een saldo tegenover een verdeling) is die je mag zien, of als er iets meetelt.
  const visible = settling.some(
    ({ type, total }) => !isPayments(total, type.fields) && below.some((id) => rightsOf.has(id) && typeAccess(rightsOf.get(id)!, type.id) !== "none"),
  );
  const pay = payments && settleOf(payments)!;
  const date = payments?.fields.find((f) => f.type === "date" && f.required) ?? payments?.fields.find((f) => f.type === "date");
  return c.json({
    ...result,
    active: visible || counted.size > 0,
    people,
    net: [...net].filter(([, v]) => v !== 0).map(([person_id, amount]) => ({ person_id, amount })),
    transfers: settleUp(net),
    counted: counted.size,
    settle: payments && pay ? { type_id: payments.id, amount: pay.field!, from: pay.by!, to: pay.against!, date: date?.key ?? null } : null,
  } satisfies Balance);
});

projects.put("/:id", async (c) => {
  const input = parseProjectInput(await c.req.json());
  const db = c.env.DB;
  const access = await requireProject(db, c.get("person").id, c.req.param("id"));
  need(access, "manage");
  await db
    .prepare("UPDATE projects SET name = ?, description = ?, icon = ?, color = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(input.name, input.description, input.icon, input.color, access.project.id)
    .run();
  return c.json({ id: access.project.id });
});

projects.put("/:id/archived", async (c) => {
  const archived = asObject(await c.req.json()).archived === true ? 1 : 0;
  const db = c.env.DB;
  const access = await requireProject(db, c.get("person").id, c.req.param("id"));
  need(access, "manage");
  await db.prepare("UPDATE projects SET archived = ?, updated_at = datetime('now') WHERE id = ?").bind(archived, access.project.id).run();
  return c.json({ id: access.project.id, archived });
});

/** Verwijderen kan enkel als het project leeg is (geen items, geen subprojecten); anders archiveren. */
projects.delete("/:id", async (c) => {
  const db = c.env.DB;
  const access = await requireProject(db, c.get("person").id, c.req.param("id"));
  need(access, "manage");
  const busy = await db
    .prepare("SELECT (SELECT COUNT(*) FROM items WHERE project_id = ?1) + (SELECT COUNT(*) FROM projects WHERE parent_id = ?1) AS n")
    .bind(access.project.id)
    .first<{ n: number }>();
  if (busy && busy.n > 0) throw new ConflictError("Er zitten nog items of subprojecten in dit project. Archiveer het, of maak het eerst leeg.");
  await db.prepare("DELETE FROM projects WHERE id = ?").bind(access.project.id).run();
  return c.body(null, 204);
});

// ---------- lijsten ----------

projects.post("/:id/types", async (c) => {
  const input = parseTypeInput(await c.req.json());
  const db = c.env.DB;
  const access = await requireProject(db, c.get("person").id, c.req.param("id"));
  need(access, "manage", "Enkel wie het project instelt, kan lijsten maken.");
  const id = crypto.randomUUID();
  const lists = await fieldListsFor(db, c.get("person").id, access);
  const fields = cleanTypeFields(input.fields, lists.refs, id, lists.calcs);
  await checkDefaultShares(db, fields, access.chain);
  const totals = cleanTypeTotals(input.totals, fields);
  await checkSources(db, c.get("person").id, totals, fields, id);
  await checkGoalPeople(db, totals, access.chain);
  await db
    .prepare(
      `INSERT INTO item_types (id, project_id, name, plural, name_label, icon, fields, totals, sort_order)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, (SELECT ifnull(max(sort_order), 0) + 10 FROM item_types WHERE project_id = ?2))`,
    )
    .bind(id, access.project.id, input.name, input.plural, input.name_label, input.icon, JSON.stringify(fields), JSON.stringify(totals))
    .run();
  return c.json({ id }, 201);
});

/** Een lijst uit een sjabloon toevoegen aan een bestaand project (bv. Terugbetalingen). */
projects.post("/:id/types/template", async (c) => {
  const db = c.env.DB;
  const access = await requireProject(db, c.get("person").id, c.req.param("id"));
  need(access, "manage", "Enkel wie het project instelt, kan lijsten maken.");
  const template = typeTemplate(asObject(await c.req.json()).key);
  if (!template) throw new ValidationError("Die lijst bestaat niet als sjabloon.");
  const top: TemplateProject = { name: template.plural, description: null, icon: null, color: null, lists: [template], children: [] };
  const [{ plans }] = await addTemplateLists(db, access, top);
  return c.json({ id: plans[0].id }, 201);
});

/**
 * De lijsten van een gedeeld sjabloon (een bestand) toevoegen aan dit project. Subprojecten uit het sjabloon komen
 * niet mee (daarvoor maak je een nieuw project uit het bestand). Een gekoppelde lijst die hier al bestaat (op naam),
 * wordt gebruikt in plaats van een nieuwe.
 */
projects.post("/:id/types/import", async (c) => {
  const db = c.env.DB;
  const access = await requireProject(db, c.get("person").id, c.req.param("id"));
  need(access, "manage", "Enkel wie het project instelt, kan lijsten maken.");
  const file = readTemplate(asObject(await c.req.json()).file);
  const [{ plans }] = await addTemplateLists(db, access, { ...file.project, children: [] });
  return c.json({ ids: plans.map((p) => p.id) }, 201);
});

/** De lijsten van een sjabloon (zonder subprojecten) in een bestaand project zetten. */
async function addTemplateLists(db: D1Database, access: ProjectAccess, top: TemplateProject) {
  // Verwijzen kan naar het project zelf en erboven; samenvatten ook over de lijsten eronder.
  const above = await typesFor(db, access.chain);
  const byName = byNameOf(above);
  const nodes = planTemplate(top, [access.project.id], byName, () => crypto.randomUUID());
  await db.batch(templateStatements(db, nodes, byName, await calcListsFor(db, access)));
  return nodes;
}

/**
 * Alle lijsten die in dit project en zijn subprojecten gebruikt kunnen worden: om in een rol per lijst en per veld
 * te kiezen wat iemand mag. Enkel voor wie het project instelt.
 */
projects.get("/:id/all-types", async (c) => {
  const db = c.env.DB;
  const access = await requireProject(db, c.get("person").id, c.req.param("id"));
  need(access, "manage");
  const { results } = await db
    .prepare(
      `WITH RECURSIVE down(id) AS (SELECT ?1 UNION SELECT p.id FROM projects p JOIN down ON p.parent_id = down.id)
       SELECT t.*, p.name AS project_name FROM item_types t JOIN projects p ON p.id = t.project_id
       WHERE t.project_id IN (SELECT id FROM down) OR t.project_id IN (SELECT value FROM json_each(?2))
       ORDER BY t.sort_order, t.created_at`,
    )
    .bind(access.project.id, JSON.stringify(access.chain))
    .all<TypeRow & { project_name: string }>();
  return c.json(results.map((r) => ({ ...toItemType(r), project_name: r.project_name })));
});

export const types = new Hono<AppEnv>();

/** Alle lijsten die je ergens mag zien, met de velden die je er mag zien (om naar te verwijzen of uit te tellen). */
types.get("/", async (c) => {
  const lists = await visibleLists(c.env.DB, c.get("person").id);
  return c.json(lists.map((t) => ({ ...t, totals: [] })));
});

async function requireType(db: D1Database, personId: string, typeId: string) {
  const row = await db.prepare("SELECT * FROM item_types WHERE id = ?").bind(typeId).first<TypeRow>();
  if (!row) throw new NotFoundError("Die lijst bestaat niet (meer).");
  const access = await projectAccess(db, personId, row.project_id);
  if (!access) throw new NotFoundError("Die lijst bestaat niet (meer).");
  return { type: toItemType(row), access };
}

/** Eén lijst als sjabloon om te delen (met de lijsten waarnaar ze verwijst). Enkel wie het project instelt. */
types.get("/:id/template", async (c) => {
  const db = c.env.DB;
  const { type, access } = await requireType(db, c.get("person").id, c.req.param("id"));
  need(access, "manage", "Enkel wie het project instelt, kan een lijst delen.");
  const tree = await exportTree(db, access.project.id);
  return c.json(buildTemplateFile(tree.slice(0, 1), await typesFor(db, access.chain), type));
});

types.put("/:id", async (c) => {
  const input = parseTypeInput(await c.req.json());
  const db = c.env.DB;
  const { type, access } = await requireType(db, c.get("person").id, c.req.param("id"));
  need(access, "manage", "Enkel wie het project instelt, kan lijsten aanpassen.");
  const lists = await fieldListsFor(db, c.get("person").id, access);
  const fields = cleanTypeFields(input.fields, lists.refs, type.id, lists.calcs);
  await checkDefaultShares(db, fields, access.chain);
  // Zonder totalen in de vraag blijven de huidige die nog bij de velden passen.
  const totals = input.totals === undefined ? keepTotals(type.totals, fields) : cleanTypeTotals(input.totals, fields);
  if (input.totals !== undefined) {
    await checkSources(db, c.get("person").id, totals, fields, type.id);
    await checkGoalPeople(db, totals, access.chain);
  }
  await db
    .prepare("UPDATE item_types SET name = ?, plural = ?, name_label = ?, icon = ?, fields = ?, totals = ? WHERE id = ?")
    .bind(input.name, input.plural, input.name_label, input.icon, JSON.stringify(fields), JSON.stringify(totals), type.id)
    .run();
  return c.json({ id: type.id });
});

types.delete("/:id", async (c) => {
  const db = c.env.DB;
  const { type, access } = await requireType(db, c.get("person").id, c.req.param("id"));
  need(access, "manage");
  const used = await db.prepare("SELECT COUNT(*) AS n FROM items WHERE type_id = ?").bind(type.id).first<{ n: number }>();
  if (used && used.n > 0) throw new ConflictError(`Er staan nog ${used.n} items in deze lijst. Verwijder of verplaats ze eerst.`);
  const { results } = await db
    .prepare("SELECT id, name, fields FROM item_types WHERE id != ? AND fields LIKE ?")
    .bind(type.id, `%${type.id}%`)
    .all<{ id: string; name: string; fields: string }>();
  // Enkel lijsten die je zelf ziet, houden dit tegen (die kan je aanpassen). Een verwijzing uit een project dat je niet
  // ziet, wijst daarna nergens meer heen: daar kan je niets meer kiezen, en dat project ziet het bij het aanpassen.
  const seen = new Set((await visibleLists(db, c.get("person").id)).map((l) => l.id));
  const referring = results
    .filter((r) => seen.has(r.id) && (JSON.parse(r.fields) as FieldDef[]).some((f) => f.ref_type === type.id))
    .map((r) => r.name);
  if (referring.length) throw new ConflictError(`${referring.join(", ")} verwijst nog naar deze lijst. Haal dat veld eerst weg.`);
  await db.prepare("DELETE FROM item_types WHERE id = ?").bind(type.id).run();
  return c.body(null, 204);
});

// ---------- rollen ----------

function parseRoleInput(body: unknown) {
  const obj = asObject(body);
  return { name: requiredString(obj, "name", 40), rights: cleanRights(obj.rights) };
}

projects.post("/:id/roles", async (c) => {
  const input = parseRoleInput(await c.req.json());
  const db = c.env.DB;
  const access = await requireProject(db, c.get("person").id, c.req.param("id"));
  need(access, "manage", "Enkel wie het project instelt, kan rollen maken.");
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO roles (id, project_id, name, rights, sort_order)
       VALUES (?1, ?2, ?3, ?4, (SELECT ifnull(max(sort_order), 0) + 10 FROM roles WHERE project_id = ?2))`,
    )
    .bind(id, access.project.id, input.name, JSON.stringify(input.rights))
    .run();
  return c.json({ id }, 201);
});

export const roles = new Hono<AppEnv>();

async function requireRole(db: D1Database, personId: string, roleId: string) {
  const role = await db.prepare("SELECT * FROM roles WHERE id = ?").bind(roleId).first<{ id: string; project_id: string; name: string; rights: string }>();
  if (!role) throw new NotFoundError("Die rol bestaat niet (meer).");
  const access = await projectAccess(db, personId, role.project_id);
  if (!access) throw new NotFoundError("Die rol bestaat niet (meer).");
  need(access, "manage", "Enkel wie het project instelt, kan rollen aanpassen.");
  return { role, access };
}

roles.put("/:id", async (c) => {
  const input = parseRoleInput(await c.req.json());
  const db = c.env.DB;
  const { role, access } = await requireRole(db, c.get("person").id, c.req.param("id"));
  await assertKeepsAdmin(db, rootOf(access), { role: { id: role.id, rights: input.rights } });
  await db.prepare("UPDATE roles SET name = ?, rights = ? WHERE id = ?").bind(input.name, JSON.stringify(input.rights), role.id).run();
  return c.json({ id: role.id });
});

roles.delete("/:id", async (c) => {
  const db = c.env.DB;
  const { role } = await requireRole(db, c.get("person").id, c.req.param("id"));
  const used = await db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE role_id = ?").bind(role.id).first<{ n: number }>();
  if (used && used.n > 0) throw new ConflictError(`${used.n === 1 ? "Iemand heeft" : `${used.n} mensen hebben`} deze rol nog. Geef hen eerst een andere rol.`);
  await db.prepare("DELETE FROM roles WHERE id = ?").bind(role.id).run();
  return c.body(null, 204);
});

// ---------- mensen ----------

/** Iedereen in dezelfde boom van projecten: om iemand die je al kent toe te voegen. Voor wie mensen beheert. */
projects.get("/:id/people", async (c) => {
  const db = c.env.DB;
  const access = await requireProject(db, c.get("person").id, c.req.param("id"));
  need(access, "members");
  const { results } = await db
    .prepare(
      `WITH RECURSIVE down(id) AS (SELECT ?1 UNION SELECT p.id FROM projects p JOIN down ON p.parent_id = down.id)
       SELECT DISTINCT pe.id, pe.name, pe.email, pe.color FROM people pe JOIN memberships m ON m.person_id = pe.id
       WHERE m.project_id IN (SELECT id FROM down) ORDER BY pe.name COLLATE NOCASE`,
    )
    .bind(rootOf(access))
    .all<Person>();
  return c.json(results);
});

/**
 * Iemand toevoegen: een bestaande persoon uit dezelfde boom van projecten, iemand met een e-mailadres (die kan dan
 * zelf aanmelden), of enkel een naam (iemand zonder aanmelding, bv. voor wie een uitgave deelt).
 */
projects.post("/:id/members", async (c) => {
  const obj = asObject(await c.req.json());
  const db = c.env.DB;
  const me = c.get("person");
  const access = await requireProject(db, me.id, c.req.param("id"));
  need(access, "members", "Enkel wie mensen beheert, kan iemand toevoegen.");
  const roleId = requiredId(obj, "role_id");
  await assertRoleAllowed(db, roleId, access);

  const personId = optionalId(obj, "person_id");
  const email = optionalString(obj, "email", 200)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Dat e-mailadres klopt niet");
  let person: Person | null = null;
  if (personId) {
    // Enkel iemand die al in dezelfde boom zit: zo kan je niemand toevoegen die je niet kent.
    person = await db
      .prepare(
        `WITH RECURSIVE down(id) AS (SELECT ?2 UNION SELECT p.id FROM projects p JOIN down ON p.parent_id = down.id)
         SELECT pe.id, pe.name, pe.email, pe.color FROM people pe WHERE pe.id = ?1
           AND EXISTS (SELECT 1 FROM memberships m WHERE m.person_id = pe.id AND m.project_id IN (SELECT id FROM down))`,
      )
      .bind(personId, rootOf(access))
      .first<Person>();
    if (!person) throw new ValidationError("Die persoon ken je hier niet. Voeg iemand toe met een naam of e-mailadres.");
  } else if (email) {
    person = await db.prepare("SELECT id, name, email, color FROM people WHERE email = ?").bind(email).first<Person>();
  }
  if (!person) {
    const name = requiredString(obj, "name", 60);
    const color = isTone(obj.color) ? obj.color : null;
    person = await db
      .prepare("INSERT INTO people (id, name, email, color, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id, name, email, color")
      .bind(crypto.randomUUID(), name, email, color, me.id)
      .first<Person>();
  }
  await guard(insertMembership(db, access.project.id, person!.id, roleId).run(), {
    unique: `${person!.name} zit al in dit project. Pas de rol aan in de lijst.`,
  });
  return c.json(person, 201);
});

projects.put("/:id/members/:personId", async (c) => {
  const roleId = requiredId(asObject(await c.req.json()), "role_id");
  const db = c.env.DB;
  const access = await requireProject(db, c.get("person").id, c.req.param("id"));
  need(access, "members", "Enkel wie mensen beheert, kan een rol geven.");
  await assertRoleAllowed(db, roleId, access);
  const personId = c.req.param("personId");
  if (personId === c.get("person").id && !access.rights.manage) throw new ForbiddenError("Je eigen rol kan enkel wie het project instelt veranderen.");
  if (access.chain.length === 1) await assertKeepsAdmin(db, access.project.id, { member: { person_id: personId, role_id: roleId } });
  const { meta } = await db
    .prepare("UPDATE memberships SET role_id = ? WHERE project_id = ? AND person_id = ?")
    .bind(roleId, access.project.id, personId)
    .run();
  if (meta.changes === 0) {
    // Een geërfd lid: krijgt hier een eigen rol.
    const known = await db
      .prepare(`SELECT 1 FROM memberships WHERE person_id = ? AND project_id IN (${placeholders(access.chain.length)})`)
      .bind(personId, ...access.chain)
      .first();
    if (!known) throw new NotFoundError("Die persoon zit niet in dit project.");
    await insertMembership(db, access.project.id, personId, roleId).run();
  }
  return c.json({ ok: true });
});

projects.delete("/:id/members/:personId", async (c) => {
  const db = c.env.DB;
  const access = await requireProject(db, c.get("person").id, c.req.param("id"));
  need(access, "members", "Enkel wie mensen beheert, kan iemand weghalen.");
  const personId = c.req.param("personId");
  if (access.chain.length === 1) await assertKeepsAdmin(db, access.project.id, { member: { person_id: personId, role_id: null } });
  const { meta } = await db.prepare("DELETE FROM memberships WHERE project_id = ? AND person_id = ?").bind(access.project.id, personId).run();
  if (meta.changes === 0) throw new NotFoundError("Die persoon heeft hier geen eigen rol (enkel een rol van een project erboven).");
  return c.body(null, 204);
});

export const people = new Hono<AppEnv>();

/**
 * Een persoon aanpassen: jezelf (naam, kleur), of iemand in een project waar jij mensen beheert. Een e-mailadres
 * kan enkel bij iemand die er nog geen heeft: die kan dan zelf aanmelden en blijft dezelfde persoon.
 */
people.put("/:id", async (c) => {
  const obj = asObject(await c.req.json());
  const db = c.env.DB;
  const me = c.get("person");
  const target = await db.prepare("SELECT id, name, email, color FROM people WHERE id = ?").bind(c.req.param("id")).first<Person>();
  if (!target) throw new NotFoundError("Die persoon bestaat niet (meer).");
  if (target.id !== me.id) {
    const { results } = await db.prepare("SELECT project_id FROM memberships WHERE person_id = ?").bind(target.id).all<{ project_id: string }>();
    let allowed = false;
    for (const m of results) {
      const access = await projectAccess(db, me.id, m.project_id);
      if (access?.rights.members) {
        allowed = true;
        break;
      }
    }
    if (!allowed) throw new NotFoundError("Die persoon bestaat niet (meer).");
  }
  const name = requiredString(obj, "name", 60);
  const color = obj.color === null || obj.color === undefined ? target.color : isTone(obj.color) ? obj.color : target.color;
  let email = target.email;
  const wanted = optionalString(obj, "email", 200)?.toLowerCase() ?? null;
  if (wanted && wanted !== target.email) {
    if (target.email) throw new ForbiddenError("Het e-mailadres van iemand die al aanmeldt, kan je niet veranderen.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(wanted)) throw new ValidationError("Dat e-mailadres klopt niet");
    email = wanted;
  }
  const updated = await guard(
    db
      .prepare("UPDATE people SET name = ?, color = ?, email = ? WHERE id = ? RETURNING id, name, email, color")
      .bind(name, color, email, target.id)
      .first<Person>(),
    { unique: "Dat e-mailadres hoort al bij iemand anders. Voeg die persoon toe in plaats van een nieuwe." },
  );
  return c.json(updated);
});

// ---------- tags ----------

function parseTagInput(body: unknown) {
  const obj = asObject(body);
  const color = obj.color ?? null;
  if (color !== null && !isTone(color)) throw new ValidationError("Onbekende kleur");
  return { name: requiredString(obj, "name", 40), color: color as string | null };
}

/** Een tag maken mag wie items toevoegt (om meteen te taggen) of het project instelt. */
projects.post("/:id/tags", async (c) => {
  const input = parseTagInput(await c.req.json());
  const db = c.env.DB;
  const access = await requireProject(db, c.get("person").id, c.req.param("id"));
  if (!access.rights.create && !access.rights.manage) throw new ForbiddenError("Dat mag je in dit project niet.");
  const tag = await guard(
    db
      .prepare("INSERT INTO tags (id, project_id, name, color) VALUES (?, ?, ?, ?) RETURNING *")
      .bind(crypto.randomUUID(), access.project.id, input.name, input.color)
      .first<Tag>(),
    { unique: "Die tag bestaat al." },
  );
  return c.json(tag, 201);
});

export const tags = new Hono<AppEnv>();

async function requireTag(db: D1Database, personId: string, tagId: string) {
  const tag = await db.prepare("SELECT * FROM tags WHERE id = ?").bind(tagId).first<Tag>();
  if (!tag) throw new NotFoundError("Die tag bestaat niet (meer).");
  const access = await projectAccess(db, personId, tag.project_id);
  if (!access) throw new NotFoundError("Die tag bestaat niet (meer).");
  need(access, "manage", "Enkel wie het project instelt, kan tags aanpassen.");
  return tag;
}

tags.put("/:id", async (c) => {
  const input = parseTagInput(await c.req.json());
  const db = c.env.DB;
  const tag = await requireTag(db, c.get("person").id, c.req.param("id"));
  const updated = await guard(db.prepare("UPDATE tags SET name = ?, color = ? WHERE id = ? RETURNING *").bind(input.name, input.color, tag.id).first<Tag>(), {
    unique: "Die tag bestaat al.",
  });
  return c.json(updated);
});

tags.delete("/:id", async (c) => {
  const db = c.env.DB;
  const tag = await requireTag(db, c.get("person").id, c.req.param("id"));
  await db.prepare("DELETE FROM tags WHERE id = ?").bind(tag.id).run();
  return c.body(null, 204);
});
