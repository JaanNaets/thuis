import { Hono } from "hono";
import { canCreate, typeAccess } from "../../shared/access";
import type { IconKey } from "../../shared/templates";
import { isTone, type Me, type Overview, type Person } from "../../shared/types";
import { blockProjects, cleanBlocks, defaultBlocks } from "../../shared/overview";
import { flattenTree } from "../../shared/tree";
import { isValidIban, normalizeIban } from "../../shared/payment";
import { accessibleProjects } from "../context";
import type { AppEnv } from "../types";
import { asObject, parseOrder, requiredString, ValidationError } from "../validate";

export const me = new Hono<AppEnv>();

const parseJson = (text: string | null | undefined): unknown => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

/**
 * Wat op je overzicht staat (zie shared/overview.ts): enkel ids, nagekeken. null = vanzelf. Wat erin staat, haalt de
 * app op met jouw rechten, dus een blok over iets dat je niet ziet, blijft gewoon weg.
 */
me.put("/overview", async (c) => {
  const blocks = cleanBlocks(asObject(await c.req.json()).blocks);
  await c.env.DB.prepare("UPDATE people SET overview = ? WHERE id = ?")
    .bind(blocks === null ? null : JSON.stringify(blocks), c.get("person").id)
    .run();
  return c.json({ blocks });
});

/** Wie je bent en al je projecten, met je rol in elk. */
me.get("/", async (c) => {
  const person = c.get("person");
  const result: Me = { person, projects: await accessibleProjects(c.env.DB, person.id) };
  return c.json(result);
});

/** Je eigen naam, kleur en rekeningnummer. Je e-mailadres komt van je aanmelding en verandert hier niet. */
me.put("/", async (c) => {
  const obj = asObject(await c.req.json());
  const color = obj.color ?? null;
  if (color !== null && !isTone(color)) throw new ValidationError("Onbekende kleur");
  const raw = typeof obj.iban === "string" ? obj.iban.trim() : "";
  if (raw && !isValidIban(raw)) throw new ValidationError("Dat rekeningnummer klopt niet. Kijk het IBAN na (bv. BE68 5390 0754 7034).");
  const updated = await c.env.DB.prepare("UPDATE people SET name = ?, color = ?, iban = ? WHERE id = ? RETURNING id, name, email, color, iban")
    .bind(requiredString(obj, "name", 60), color, raw ? normalizeIban(raw) : null, c.get("person").id)
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
 * Je overzicht: je blokken (of vanzelf, zie `defaultBlocks`), en voor de projecten die ze tonen de lijsten van dat
 * project zelf en die van erboven waar hier items in zitten, met het aantal. `?projects=a,b`: enkel voor die projecten
 * (een blok dat je net toevoegde). Een lijst die je niet mag zien, staat er niet (ook niet als aantal).
 */
me.get("/overview", async (c) => {
  const db = c.env.DB;
  const personId = c.get("person").id;
  const [all, mine] = await Promise.all([
    accessibleProjects(db, personId),
    db.prepare("SELECT overview FROM people WHERE id = ?").bind(personId).first<{ overview: string | null }>(),
  ]);
  const live = all.filter((n) => !n.archived);
  const blocks = cleanBlocks(parseJson(mine?.overview));
  const asked = c.req.query("projects")?.split(",").filter(Boolean).slice(0, 60);
  const wanted = new Set(asked ?? blockProjects(blocks ?? defaultBlocks(flattenTree(live))));
  const nodes = live.filter((n) => wanted.has(n.id));
  const ids = JSON.stringify(nodes.map((n) => n.id));
  const [types, counts, shownRows] = (await db.batch([
    db
      .prepare(
        `SELECT id, project_id, name, plural, icon FROM item_types
         WHERE project_id IN (SELECT value FROM json_each(?1))
            OR id IN (SELECT type_id FROM items WHERE archived = 0 AND project_id IN (SELECT value FROM json_each(?1)))
            OR id IN (SELECT type_id FROM shown_lists WHERE project_id IN (SELECT value FROM json_each(?1)))
         ORDER BY sort_order, created_at`,
      )
      .bind(ids),
    db
      .prepare(
        `SELECT project_id, type_id, COUNT(*) AS n FROM items
         WHERE archived = 0 AND project_id IN (SELECT value FROM json_each(?)) GROUP BY project_id, type_id`,
      )
      .bind(ids),
    db.prepare("SELECT project_id, type_id FROM shown_lists WHERE project_id IN (SELECT value FROM json_each(?))").bind(ids),
  ])) as [
    D1Result<{ id: string; project_id: string; name: string; plural: string; icon: IconKey | null }>,
    D1Result<{ project_id: string; type_id: string; n: number }>,
    D1Result<{ project_id: string; type_id: string }>,
  ];
  const count = new Map(counts.results.map((r) => [`${r.project_id}/${r.type_id}`, r.n]));
  // Lijsten van erboven die een subproject zelf koos (zie PUT /projects/:id/shown).
  const shown = new Set(shownRows.results.map((r) => `${r.project_id}/${r.type_id}`));
  const result: Overview = {
    blocks,
    projects: nodes.map((n) => ({
      id: n.id,
      types: types.results
        .filter((t) => (t.project_id === n.id || count.has(`${n.id}/${t.id}`) || shown.has(`${n.id}/${t.id}`)) && typeAccess(n.rights, t.id) !== "none")
        // Eerst de eigen lijsten, dan die van erboven (elk in hun volgorde).
        .sort((a, b) => Number(b.project_id === n.id) - Number(a.project_id === n.id))
        .map((t) => ({
          id: t.id,
          name: t.name,
          plural: t.plural,
          icon: t.icon,
          count: count.get(`${n.id}/${t.id}`) ?? 0,
          can_create: canCreate(n.rights, t.id),
        })),
    })),
  };
  return c.json(result);
});
