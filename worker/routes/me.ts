import { Hono } from "hono";
import { typeAccess } from "../../shared/access";
import type { IconKey } from "../../shared/templates";
import { isTone, type Me, type Overview, type Person } from "../../shared/types";
import { accessibleProjects } from "../context";
import type { AppEnv } from "../types";
import { asObject, parseOrder, requiredString, ValidationError } from "../validate";

export const me = new Hono<AppEnv>();

/** Wie je bent en al je projecten, met je rol in elk. */
me.get("/", async (c) => {
  const person = c.get("person");
  const result: Me = { person, projects: await accessibleProjects(c.env.DB, person.id) };
  return c.json(result);
});

/** Je eigen naam en kleur. Je e-mailadres komt van je aanmelding en verandert hier niet. */
me.put("/", async (c) => {
  const obj = asObject(await c.req.json());
  const color = obj.color ?? null;
  if (color !== null && !isTone(color)) throw new ValidationError("Onbekende kleur");
  const updated = await c.env.DB.prepare("UPDATE people SET name = ?, color = ? WHERE id = ? RETURNING id, name, email, color")
    .bind(requiredString(obj, "name", 60), color, c.get("person").id)
    .first<Person>();
  return c.json(updated);
});

/** Jouw volgorde van de projecten bovenaan je overzicht. Raakt enkel je eigen lidmaatschappen. */
me.put("/order", async (c) => {
  const ids = parseOrder(await c.req.json());
  const db = c.env.DB;
  const personId = c.get("person").id;
  await db.batch(
    ids.map((id, i) => db.prepare("UPDATE memberships SET sort_order = ? WHERE person_id = ? AND project_id = ?").bind((i + 1) * 10, personId, id)),
  );
  return c.json({ ok: true });
});

/**
 * Je overzicht: per project de soorten van dat project zelf, en die van erboven waar hier items in zitten, met
 * het aantal. Een soort die je niet mag zien, staat er niet (ook niet als aantal).
 */
me.get("/overview", async (c) => {
  const db = c.env.DB;
  const nodes = (await accessibleProjects(db, c.get("person").id)).filter((n) => !n.archived);
  const ids = JSON.stringify(nodes.map((n) => n.id));
  const [types, counts] = (await db.batch([
    db
      .prepare(
        `SELECT id, project_id, name, plural, icon FROM item_types
         WHERE project_id IN (SELECT value FROM json_each(?1))
            OR id IN (SELECT type_id FROM items WHERE archived = 0 AND project_id IN (SELECT value FROM json_each(?1)))
         ORDER BY sort_order, created_at`,
      )
      .bind(ids),
    db
      .prepare(
        `SELECT project_id, type_id, COUNT(*) AS n FROM items
         WHERE archived = 0 AND project_id IN (SELECT value FROM json_each(?)) GROUP BY project_id, type_id`,
      )
      .bind(ids),
  ])) as [
    D1Result<{ id: string; project_id: string; name: string; plural: string; icon: IconKey | null }>,
    D1Result<{ project_id: string; type_id: string; n: number }>,
  ];
  const count = new Map(counts.results.map((r) => [`${r.project_id}/${r.type_id}`, r.n]));
  const result: Overview = {
    projects: nodes.map((n) => ({
      id: n.id,
      types: types.results
        .filter((t) => (t.project_id === n.id || count.has(`${n.id}/${t.id}`)) && typeAccess(n.rights, t.id) !== "none")
        // Eerst de eigen soorten, dan die van erboven (elk in hun volgorde).
        .sort((a, b) => Number(b.project_id === n.id) - Number(a.project_id === n.id))
        .map((t) => ({ id: t.id, name: t.name, plural: t.plural, icon: t.icon, count: count.get(`${n.id}/${t.id}`) ?? 0 })),
    })),
  };
  return c.json(result);
});
