import { Hono } from "hono";
import { descendantIds } from "../../shared/tree";
import {
  CATEGORY_DOMAINS,
  TONES,
  isTone,
  type Category,
  type Location,
  type Member,
  type Tag,
  type Taxonomy,
  type Tone,
} from "../../shared/types";
import type { AppEnv } from "../types";
import {
  asObject,
  guard,
  optionalBoolean,
  optionalId,
  optionalString,
  requiredEnum,
  requiredString,
  ValidationError,
} from "../validate";

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

// ---------- alles in één keer ----------

export const taxonomy = new Hono<AppEnv>();

taxonomy.get("/", async (c) => {
  const me = await ensureMember(c.env.DB, c.get("user"));
  const [members, categories, locations, tags] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM members ORDER BY active DESC, created_at"),
    c.env.DB.prepare("SELECT id, domain, parent_id, name, color, sort_order FROM categories"),
    c.env.DB.prepare("SELECT id, parent_id, name, sort_order FROM locations"),
    c.env.DB.prepare(
      `SELECT t.id, t.name, t.color, (SELECT COUNT(*) FROM taggings g WHERE g.tag_id = t.id) AS usage
       FROM tags t ORDER BY t.name COLLATE NOCASE`,
    ),
  ]);
  const result: Taxonomy = {
    me,
    members: members.results as Member[],
    categories: categories.results as Category[],
    locations: locations.results as Location[],
    tags: tags.results as Tag[],
  };
  return c.json(result);
});

// ---------- leden ----------

/** "jaan.naets@…" → "Jaan". Aanpassen kan bij Meer → Huishouden. */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0];
  const first = local.split(/[._+-]/)[0].replace(/\d+$/, "") || local;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** Wie aanmeldt en nog geen lid is, wordt automatisch lid van het huishouden. */
export async function ensureMember(db: D1Database, email: string): Promise<Member> {
  const existing = await db.prepare("SELECT * FROM members WHERE email = ?").bind(email).first<Member>();
  if (existing) return existing;

  const { results } = await db.prepare("SELECT color FROM members").all<{ color: string | null }>();
  const used = new Set(results.map((r) => r.color));
  const color = TONES.find((t) => !used.has(t)) ?? "peach";
  const row = await db
    .prepare(
      `INSERT INTO members (id, name, email, color) VALUES (?, ?, ?, ?)
       ON CONFLICT (email) DO UPDATE SET email = members.email
       RETURNING *`,
    )
    .bind(crypto.randomUUID(), nameFromEmail(email), email, color)
    .first<Member>();
  return row!;
}

function parseMember(body: unknown) {
  const obj = asObject(body);
  const email = optionalString(obj, "email", 200);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError("Dat is geen geldig e-mailadres");
  return {
    name: requiredString(obj, "name", 60),
    email,
    color: optionalTone(obj, "color"),
    active: optionalBoolean(obj, "active", true) ? 1 : 0,
  };
}

const MEMBER_EMAIL_TAKEN = "Er is al een lid met dit e-mailadres.";

export const members = new Hono<AppEnv>();

members.post("/", async (c) => {
  const m = parseMember(await c.req.json());
  const row = await guard(
    c.env.DB.prepare("INSERT INTO members (id, name, email, color, active) VALUES (?, ?, ?, ?, ?) RETURNING *")
      .bind(crypto.randomUUID(), m.name, m.email, m.color, m.active)
      .first<Member>(),
    { unique: MEMBER_EMAIL_TAKEN },
  );
  return c.json(row, 201);
});

members.put("/:id", async (c) => {
  const m = parseMember(await c.req.json());
  const row = await guard(
    c.env.DB.prepare("UPDATE members SET name = ?, email = ?, color = ?, active = ? WHERE id = ? RETURNING *")
      .bind(m.name, m.email, m.color, m.active, c.req.param("id"))
      .first<Member>(),
    { unique: MEMBER_EMAIL_TAKEN },
  );
  if (!row) return c.json({ error: "Lid niet gevonden" }, 404);
  return c.json(row);
});

members.delete("/:id", async (c) => {
  const { meta } = await guard(c.env.DB.prepare("DELETE FROM members WHERE id = ?").bind(c.req.param("id")).run(), {
    foreignKey: "Dit lid heeft al uitgaven of terugbetalingen. Zet het op inactief in plaats van te verwijderen.",
  });
  if (meta.changes === 0) return c.json({ error: "Lid niet gevonden" }, 404);
  return c.body(null, 204);
});

// ---------- categorieën en plaatsen (bomen) ----------

/** Controleert dat de nieuwe ouder bestaat en dat er geen lus ontstaat (iets onder zichzelf hangen). */
async function checkParent(db: D1Database, table: "categories" | "locations", id: string | null, parentId: string | null, domain?: string) {
  if (!parentId) return;
  const where = domain ? "WHERE domain = ?" : "";
  const stmt = db.prepare(`SELECT id, parent_id, name, sort_order FROM ${table} ${where}`);
  const { results } = await (domain ? stmt.bind(domain) : stmt).all<{ id: string; parent_id: string | null; name: string; sort_order: number }>();
  if (!results.some((n) => n.id === parentId)) throw new ValidationError("Die bovenliggende keuze bestaat niet");
  if (id && descendantIds(results, id).has(parentId)) throw new ValidationError("Iets kan niet onder zichzelf hangen");
}

const CATEGORY_TAKEN = "Er is al een categorie met deze naam op dezelfde plaats.";

export const categories = new Hono<AppEnv>();

categories.post("/", async (c) => {
  const obj = asObject(await c.req.json());
  const domain = requiredEnum(obj, "domain", CATEGORY_DOMAINS);
  const parentId = optionalId(obj, "parent_id");
  await checkParent(c.env.DB, "categories", null, parentId, domain);
  const row = await guard(
    c.env.DB.prepare(
      `INSERT INTO categories (id, domain, parent_id, name, color, sort_order)
       VALUES (?, ?, ?, ?, ?, coalesce(?, (SELECT ifnull(max(sort_order), 0) + 10 FROM categories WHERE domain = ? AND parent_id IS ?)))
       RETURNING id, domain, parent_id, name, color, sort_order`,
    )
      .bind(crypto.randomUUID(), domain, parentId, requiredString(obj, "name", 60), optionalTone(obj, "color"), sortOrder(obj), domain, parentId)
      .first<Category>(),
    { unique: CATEGORY_TAKEN },
  );
  return c.json(row, 201);
});

categories.put("/:id", async (c) => {
  const id = c.req.param("id");
  const obj = asObject(await c.req.json());
  const current = await c.env.DB.prepare("SELECT domain FROM categories WHERE id = ?").bind(id).first<{ domain: string }>();
  if (!current) return c.json({ error: "Categorie niet gevonden" }, 404);
  const parentId = optionalId(obj, "parent_id");
  await checkParent(c.env.DB, "categories", id, parentId, current.domain);
  const row = await guard(
    c.env.DB.prepare(
      `UPDATE categories SET parent_id = ?, name = ?, color = ?, sort_order = coalesce(?, sort_order)
       WHERE id = ? RETURNING id, domain, parent_id, name, color, sort_order`,
    )
      .bind(parentId, requiredString(obj, "name", 60), optionalTone(obj, "color"), sortOrder(obj), id)
      .first<Category>(),
    { unique: CATEGORY_TAKEN },
  );
  return c.json(row);
});

// Wat in de categorie zat, wordt "zonder categorie"; subcategorieën schuiven een niveau op.
categories.delete("/:id", async (c) => {
  const { meta } = await c.env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(c.req.param("id")).run();
  if (meta.changes === 0) return c.json({ error: "Categorie niet gevonden" }, 404);
  return c.body(null, 204);
});

const LOCATION_TAKEN = "Er is al een plaats met deze naam op dezelfde plek.";

export const locations = new Hono<AppEnv>();

locations.post("/", async (c) => {
  const obj = asObject(await c.req.json());
  const parentId = optionalId(obj, "parent_id");
  await checkParent(c.env.DB, "locations", null, parentId);
  const row = await guard(
    c.env.DB.prepare(
      `INSERT INTO locations (id, parent_id, name, sort_order)
       VALUES (?, ?, ?, coalesce(?, (SELECT ifnull(max(sort_order), 0) + 10 FROM locations WHERE parent_id IS ?)))
       RETURNING id, parent_id, name, sort_order`,
    )
      .bind(crypto.randomUUID(), parentId, requiredString(obj, "name", 60), sortOrder(obj), parentId)
      .first<Location>(),
    { unique: LOCATION_TAKEN },
  );
  return c.json(row, 201);
});

locations.put("/:id", async (c) => {
  const id = c.req.param("id");
  const obj = asObject(await c.req.json());
  const parentId = optionalId(obj, "parent_id");
  await checkParent(c.env.DB, "locations", id, parentId);
  const row = await guard(
    c.env.DB.prepare(
      `UPDATE locations SET parent_id = ?, name = ?, sort_order = coalesce(?, sort_order)
       WHERE id = ? RETURNING id, parent_id, name, sort_order`,
    )
      .bind(parentId, requiredString(obj, "name", 60), sortOrder(obj), id)
      .first<Location>(),
    { unique: LOCATION_TAKEN },
  );
  if (!row) return c.json({ error: "Plaats niet gevonden" }, 404);
  return c.json(row);
});

locations.delete("/:id", async (c) => {
  const { meta } = await guard(c.env.DB.prepare("DELETE FROM locations WHERE id = ?").bind(c.req.param("id")).run(), {
    foreignKey: "Hier ligt nog voorraad. Verplaats of verbruik die eerst.",
  });
  if (meta.changes === 0) return c.json({ error: "Plaats niet gevonden" }, 404);
  return c.body(null, 204);
});

// ---------- tags ----------

const TAG_TAKEN = "Deze tag bestaat al.";

export const tags = new Hono<AppEnv>();

tags.post("/", async (c) => {
  const obj = asObject(await c.req.json());
  const row = await guard(
    c.env.DB.prepare("INSERT INTO tags (id, name, color) VALUES (?, ?, ?) RETURNING id, name, color, 0 AS usage")
      .bind(crypto.randomUUID(), requiredString(obj, "name", 40), optionalTone(obj, "color"))
      .first<Tag>(),
    { unique: TAG_TAKEN },
  );
  return c.json(row, 201);
});

tags.put("/:id", async (c) => {
  const obj = asObject(await c.req.json());
  const row = await guard(
    c.env.DB.prepare(
      `UPDATE tags SET name = ?, color = ? WHERE id = ?
       RETURNING id, name, color, (SELECT COUNT(*) FROM taggings g WHERE g.tag_id = tags.id) AS usage`,
    )
      .bind(requiredString(obj, "name", 40), optionalTone(obj, "color"), c.req.param("id"))
      .first<Tag>(),
    { unique: TAG_TAKEN },
  );
  if (!row) return c.json({ error: "Tag niet gevonden" }, 404);
  return c.json(row);
});

tags.delete("/:id", async (c) => {
  const { meta } = await c.env.DB.prepare("DELETE FROM tags WHERE id = ?").bind(c.req.param("id")).run();
  if (meta.changes === 0) return c.json({ error: "Tag niet gevonden" }, 404);
  return c.body(null, 204);
});

/** Statements om de tags van iets te vervangen; voor in een batch samen met de rest. */
export function setTagsStatements(db: D1Database, entityType: string, entityId: string, tagIds: string[]): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM taggings WHERE entity_type = ? AND entity_id = ?").bind(entityType, entityId),
    ...tagIds.map((tagId) =>
      db.prepare("INSERT INTO taggings (tag_id, entity_type, entity_id) VALUES (?, ?, ?)").bind(tagId, entityType, entityId),
    ),
  ];
}
