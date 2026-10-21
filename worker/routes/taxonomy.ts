import { Hono } from "hono";
import type { DefaultSplit } from "../../shared/split";
import { descendantIds } from "../../shared/tree";
import {
  ACCESS_LEVELS,
  CATEGORY_DOMAINS,
  TONES,
  isTone,
  type Access,
  type Category,
  type Location,
  type Member,
  type Pot,
  type Project,
  type Tag,
  type Taxonomy,
  type Tone,
  type Vendor,
} from "../../shared/types";
import { assertOwned, requireFull } from "../context";
import type { AppEnv } from "../types";
import { asObject, guard, optionalBoolean, optionalEnum, optionalId, optionalString, requiredEnum, requiredString, ValidationError } from "../validate";
import { parseJson } from "./households";
import { vendorsQuery } from "./vendors";

type Obj = Record<string, unknown>;

function optionalTone(obj: Obj, key: string): Tone | null {
  const value = optionalString(obj, key, 10);
  if (value !== null && !isTone(value)) throw new ValidationError(`'${key}' moet een van ${TONES.join(", ")} zijn`);
  return value;
}

function sortOrder(obj: Obj): number | null {
  const value = obj.sort_order;
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new ValidationError("'sort_order' moet een geheel getal zijn");
  return value;
}

type ProjectRow = Omit<Project, "member_ids" | "default_split"> & { member_ids: string; default_split: string | null };

/** Projecten met hun deelnemers als JSON in dezelfde rij. */
export const PROJECT_COLUMNS = `p.*, (SELECT json_group_array(pm.member_id) FROM project_members pm WHERE pm.project_id = p.id) AS member_ids`;

export function toProject(row: ProjectRow): Project {
  return { ...row, member_ids: JSON.parse(row.member_ids) as string[], default_split: parseJson<DefaultSplit>(row.default_split) };
}

// ---------- alles in één keer ----------

export const taxonomy = new Hono<AppEnv>();

/**
 * Alles wat formulieren nodig hebben. Een gast (enkel projecten) krijgt enkel wat bij zijn projecten hoort:
 * de mensen daarin, de uitgavencategorieën en de potten van die projecten.
 */
taxonomy.get("/", async (c) => {
  const db = c.env.DB;
  const hh = c.get("household");
  const me = c.get("member");
  const full = c.get("full");

  const visibleProjects = full
    ? db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects p WHERE p.household_id = ? ORDER BY p.archived, p.created_at DESC`).bind(hh)
    : db
        .prepare(
          `SELECT ${PROJECT_COLUMNS} FROM projects p
           WHERE p.household_id = ? AND p.id IN (SELECT project_id FROM project_members WHERE member_id = ?)
           ORDER BY p.archived, p.created_at DESC`,
        )
        .bind(hh, me.id);

  const [household, members, categories, locations, tags, vendors, projects, pots] = await db.batch([
    db.prepare("SELECT id, name, default_split FROM households WHERE id = ?").bind(hh),
    full
      ? db.prepare("SELECT * FROM members WHERE household_id = ? ORDER BY active DESC, created_at").bind(hh)
      : db
          .prepare(
            `SELECT DISTINCT m.* FROM members m
             WHERE m.household_id = ? AND (m.id = ?2 OR m.id IN (
               SELECT pm.member_id FROM project_members pm
               WHERE pm.project_id IN (SELECT project_id FROM project_members WHERE member_id = ?2)))
             ORDER BY m.created_at`,
          )
          .bind(hh, me.id),
    full
      ? db.prepare("SELECT id, domain, parent_id, name, color, sort_order FROM categories WHERE household_id = ?").bind(hh)
      : db.prepare("SELECT id, domain, parent_id, name, color, sort_order FROM categories WHERE household_id = ? AND domain = 'expense'").bind(hh),
    full ? db.prepare("SELECT id, parent_id, name, sort_order FROM locations WHERE household_id = ?").bind(hh) : db.prepare("SELECT 1 WHERE 0"),
    full
      ? db
          .prepare(
            `SELECT t.id, t.name, t.color, (SELECT COUNT(*) FROM taggings g WHERE g.tag_id = t.id) AS usage
             FROM tags t WHERE t.household_id = ? ORDER BY t.name COLLATE NOCASE`,
          )
          .bind(hh)
      : db.prepare("SELECT 1 WHERE 0"),
    full ? db.prepare(vendorsQuery).bind(hh) : db.prepare("SELECT 1 WHERE 0"),
    visibleProjects,
    full
      ? db.prepare("SELECT * FROM pots WHERE household_id = ? ORDER BY archived, created_at").bind(hh)
      : db
          .prepare(
            `SELECT * FROM pots WHERE household_id = ? AND project_id IN (SELECT project_id FROM project_members WHERE member_id = ?)
             ORDER BY archived, created_at`,
          )
          .bind(hh, me.id),
  ]);

  const h = household.results[0] as { id: string; name: string; default_split: string | null };
  const result: Taxonomy = {
    me,
    household: { id: h.id, name: h.name, default_split: parseJson<DefaultSplit>(h.default_split) },
    members: members.results as Member[],
    categories: categories.results as Category[],
    locations: locations.results as Location[],
    tags: tags.results as Tag[],
    vendors: vendors.results as Vendor[],
    projects: (projects.results as ProjectRow[]).map(toProject),
    pots: pots.results as Pot[],
  };
  return c.json(result);
});

// ---------- leden ----------

function parseMember(body: unknown) {
  const obj = asObject(body);
  const email = optionalString(obj, "email", 200);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError("Dat is geen geldig e-mailadres");
  return {
    name: requiredString(obj, "name", 60),
    email,
    color: optionalTone(obj, "color"),
    active: optionalBoolean(obj, "active", true) ? 1 : 0,
    access: optionalEnum(obj, "access", Object.keys(ACCESS_LEVELS) as Access[]) ?? "full",
  };
}

const MEMBER_EMAIL_TAKEN = "Er is al een lid met dit e-mailadres.";

/** Een nieuw lid krijgt een kleur die nog vrij is. */
export async function freeTone(db: D1Database, household: string): Promise<Tone> {
  const { results } = await db.prepare("SELECT color FROM members WHERE household_id = ?").bind(household).all<{ color: string | null }>();
  const used = new Set(results.map((r) => r.color));
  return TONES.find((t) => !used.has(t)) ?? TONES[results.length % TONES.length];
}

export const members = new Hono<AppEnv>();

members.use("*", requireFull);

members.post("/", async (c) => {
  const m = parseMember(await c.req.json());
  const hh = c.get("household");
  const row = await guard(
    c.env.DB.prepare("INSERT INTO members (id, household_id, name, email, color, active, access) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *")
      .bind(crypto.randomUUID(), hh, m.name, m.email, m.color ?? (await freeTone(c.env.DB, hh)), m.active, m.access)
      .first<Member>(),
    { unique: MEMBER_EMAIL_TAKEN },
  );
  return c.json(row, 201);
});

members.put("/:id", async (c) => {
  const m = parseMember(await c.req.json());
  const id = c.req.param("id");
  // Jezelf de toegang ontnemen zou je buitensluiten.
  if (id === c.get("member").id && (m.access !== "full" || m.email?.toLowerCase() !== c.get("user").toLowerCase())) {
    throw new ValidationError("Je kan je eigen e-mailadres en toegang niet aanpassen; vraag dat aan een ander lid.");
  }
  const row = await guard(
    c.env.DB.prepare("UPDATE members SET name = ?, email = ?, color = ?, active = ?, access = ? WHERE id = ? AND household_id = ? RETURNING *")
      .bind(m.name, m.email, m.color, m.active, m.access, id, c.get("household"))
      .first<Member>(),
    { unique: MEMBER_EMAIL_TAKEN },
  );
  if (!row) return c.json({ error: "Lid niet gevonden" }, 404);
  return c.json(row);
});

members.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (id === c.get("member").id) throw new ValidationError("Je kan jezelf niet verwijderen.");
  const { meta } = await guard(c.env.DB.prepare("DELETE FROM members WHERE id = ? AND household_id = ?").bind(id, c.get("household")).run(), {
    foreignKey: "Dit lid heeft al uitgaven of geldbewegingen. Zet het op 'woont hier niet' in plaats van te verwijderen.",
  });
  if (meta.changes === 0) return c.json({ error: "Lid niet gevonden" }, 404);
  return c.body(null, 204);
});

// ---------- categorieën en plaatsen (bomen) ----------

/** Controleert dat de nieuwe ouder bestaat (in dit huishouden) en dat er geen lus ontstaat. */
async function checkParent(db: D1Database, household: string, table: "categories" | "locations", id: string | null, parentId: string | null, domain?: string) {
  if (!parentId) return;
  const stmt = domain
    ? db.prepare(`SELECT id, parent_id, name, sort_order FROM ${table} WHERE household_id = ? AND domain = ?`).bind(household, domain)
    : db.prepare(`SELECT id, parent_id, name, sort_order FROM ${table} WHERE household_id = ?`).bind(household);
  const { results } = await stmt.all<{ id: string; parent_id: string | null; name: string; sort_order: number }>();
  if (!results.some((n) => n.id === parentId)) throw new ValidationError("Die bovenliggende keuze bestaat niet");
  if (id && descendantIds(results, id).has(parentId)) throw new ValidationError("Iets kan niet onder zichzelf hangen");
}

const CATEGORY_TAKEN = "Er is al een categorie met deze naam op dezelfde plaats.";

export const categories = new Hono<AppEnv>();

categories.use("*", requireFull);

categories.post("/", async (c) => {
  const obj = asObject(await c.req.json());
  const hh = c.get("household");
  const domain = requiredEnum(obj, "domain", CATEGORY_DOMAINS);
  const parentId = optionalId(obj, "parent_id");
  await checkParent(c.env.DB, hh, "categories", null, parentId, domain);
  const row = await guard(
    c.env.DB.prepare(
      `INSERT INTO categories (id, household_id, domain, parent_id, name, color, sort_order)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, coalesce(?7,
         (SELECT ifnull(max(sort_order), 0) + 10 FROM categories WHERE household_id = ?2 AND domain = ?3 AND parent_id IS ?4)))
       RETURNING id, domain, parent_id, name, color, sort_order`,
    )
      .bind(crypto.randomUUID(), hh, domain, parentId, requiredString(obj, "name", 60), optionalTone(obj, "color"), sortOrder(obj))
      .first<Category>(),
    { unique: CATEGORY_TAKEN },
  );
  return c.json(row, 201);
});

categories.put("/:id", async (c) => {
  const id = c.req.param("id");
  const hh = c.get("household");
  const obj = asObject(await c.req.json());
  const current = await c.env.DB.prepare("SELECT domain FROM categories WHERE id = ? AND household_id = ?").bind(id, hh).first<{ domain: string }>();
  if (!current) return c.json({ error: "Categorie niet gevonden" }, 404);
  const parentId = optionalId(obj, "parent_id");
  await checkParent(c.env.DB, hh, "categories", id, parentId, current.domain);
  const row = await guard(
    c.env.DB.prepare(
      `UPDATE categories SET parent_id = ?, name = ?, color = ?, sort_order = coalesce(?, sort_order)
       WHERE id = ? AND household_id = ? RETURNING id, domain, parent_id, name, color, sort_order`,
    )
      .bind(parentId, requiredString(obj, "name", 60), optionalTone(obj, "color"), sortOrder(obj), id, hh)
      .first<Category>(),
    { unique: CATEGORY_TAKEN },
  );
  return c.json(row);
});

// Wat in de categorie zat, wordt "zonder categorie"; subcategorieën schuiven een niveau op.
categories.delete("/:id", async (c) => {
  const { meta } = await c.env.DB.prepare("DELETE FROM categories WHERE id = ? AND household_id = ?").bind(c.req.param("id"), c.get("household")).run();
  if (meta.changes === 0) return c.json({ error: "Categorie niet gevonden" }, 404);
  return c.body(null, 204);
});

const LOCATION_TAKEN = "Er is al een plaats met deze naam op dezelfde plek.";

export const locations = new Hono<AppEnv>();

locations.use("*", requireFull);

locations.post("/", async (c) => {
  const obj = asObject(await c.req.json());
  const hh = c.get("household");
  const parentId = optionalId(obj, "parent_id");
  await checkParent(c.env.DB, hh, "locations", null, parentId);
  const row = await guard(
    c.env.DB.prepare(
      `INSERT INTO locations (id, household_id, parent_id, name, sort_order)
       VALUES (?1, ?2, ?3, ?4, coalesce(?5,
         (SELECT ifnull(max(sort_order), 0) + 10 FROM locations WHERE household_id = ?2 AND parent_id IS ?3)))
       RETURNING id, parent_id, name, sort_order`,
    )
      .bind(crypto.randomUUID(), hh, parentId, requiredString(obj, "name", 60), sortOrder(obj))
      .first<Location>(),
    { unique: LOCATION_TAKEN },
  );
  return c.json(row, 201);
});

locations.put("/:id", async (c) => {
  const id = c.req.param("id");
  const hh = c.get("household");
  const obj = asObject(await c.req.json());
  const parentId = optionalId(obj, "parent_id");
  await checkParent(c.env.DB, hh, "locations", id, parentId);
  const row = await guard(
    c.env.DB.prepare(
      `UPDATE locations SET parent_id = ?, name = ?, sort_order = coalesce(?, sort_order)
       WHERE id = ? AND household_id = ? RETURNING id, parent_id, name, sort_order`,
    )
      .bind(parentId, requiredString(obj, "name", 60), sortOrder(obj), id, hh)
      .first<Location>(),
    { unique: LOCATION_TAKEN },
  );
  if (!row) return c.json({ error: "Plaats niet gevonden" }, 404);
  return c.json(row);
});

locations.delete("/:id", async (c) => {
  const { meta } = await guard(c.env.DB.prepare("DELETE FROM locations WHERE id = ? AND household_id = ?").bind(c.req.param("id"), c.get("household")).run(), {
    foreignKey: "Hier ligt nog voorraad. Verplaats of verbruik die eerst.",
  });
  if (meta.changes === 0) return c.json({ error: "Plaats niet gevonden" }, 404);
  return c.body(null, 204);
});

// ---------- tags ----------

const TAG_TAKEN = "Deze tag bestaat al.";

export const tags = new Hono<AppEnv>();

tags.use("*", requireFull);

tags.post("/", async (c) => {
  const obj = asObject(await c.req.json());
  const row = await guard(
    c.env.DB.prepare("INSERT INTO tags (id, household_id, name, color) VALUES (?, ?, ?, ?) RETURNING id, name, color, 0 AS usage")
      .bind(crypto.randomUUID(), c.get("household"), requiredString(obj, "name", 40), optionalTone(obj, "color"))
      .first<Tag>(),
    { unique: TAG_TAKEN },
  );
  return c.json(row, 201);
});

tags.put("/:id", async (c) => {
  const obj = asObject(await c.req.json());
  const row = await guard(
    c.env.DB.prepare(
      `UPDATE tags SET name = ?, color = ? WHERE id = ? AND household_id = ?
       RETURNING id, name, color, (SELECT COUNT(*) FROM taggings g WHERE g.tag_id = tags.id) AS usage`,
    )
      .bind(requiredString(obj, "name", 40), optionalTone(obj, "color"), c.req.param("id"), c.get("household"))
      .first<Tag>(),
    { unique: TAG_TAKEN },
  );
  if (!row) return c.json({ error: "Tag niet gevonden" }, 404);
  return c.json(row);
});

tags.delete("/:id", async (c) => {
  const { meta } = await c.env.DB.prepare("DELETE FROM tags WHERE id = ? AND household_id = ?").bind(c.req.param("id"), c.get("household")).run();
  if (meta.changes === 0) return c.json({ error: "Tag niet gevonden" }, 404);
  return c.body(null, 204);
});

/**
 * Statements om de tags van iets te vervangen; voor in een batch samen met de rest.
 * Controleer eerst met assertTags dat de tags bij dit huishouden horen.
 */
export function setTagsStatements(db: D1Database, entityType: string, entityId: string, tagIds: string[]): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM taggings WHERE entity_type = ? AND entity_id = ?").bind(entityType, entityId),
    ...tagIds.map((tagId) => db.prepare("INSERT INTO taggings (tag_id, entity_type, entity_id) VALUES (?, ?, ?)").bind(tagId, entityType, entityId)),
  ];
}

export function assertTags(db: D1Database, household: string, tagIds: string[]): Promise<void> {
  return assertOwned(db, household, "tags", tagIds);
}
