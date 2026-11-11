// Tags groeperen lijsten. Een regel op een tag geeft iemand een rol op elke lijst met die tag, waar wie de regel
// maakte rechtstreeks beheerder is (zie shared/rights.ts). Een tag zelf deelt nooit.

import { Hono } from "hono";
import { isRole, ROLES, type Role, type TagRule } from "../../shared/model";
import { isTone, type Person } from "../../shared/types";
import { ids, parseJson, seenLists } from "../access";
import type { AppEnv } from "../types";
import { asObject, ForbiddenError, NotFoundError, requiredString, ValidationError } from "../validate";
import { knownPeople, myLists } from "./lists";

export const tags = new Hono<AppEnv>();

const MAX_RULES = 30;

/** Een tag die je ziet (op een lijst die je ziet, of je maakte ze), en of je ze mag aanpassen. */
async function requireTag(db: D1Database, personId: string, tagId: string) {
  const { lists, tags: all } = await myLists(db, personId);
  const tag = all.find((t) => t.id === tagId);
  if (!tag) throw new NotFoundError("Die tag bestaat niet (meer).");
  const tagged = lists.filter((l) => l.tags.includes(tagId));
  // Aanpassen: wie de tag maakte, of wie beheerder is van een lijst met de tag.
  const canEdit = tag.created_by === personId || tagged.some((l) => l.role === "beheerder");
  return { tag, lists: tagged, canEdit };
}

tags.get("/:id", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { tag, lists, canEdit } = await requireTag(db, me.id, c.req.param("id"));
  const { results } = await db.prepare("SELECT person_id, role, created_by FROM tag_rules WHERE tag_id = ? ORDER BY created_at").bind(tag.id).all<TagRule>();
  const { results: people } = await db
    .prepare("SELECT id, name, NULL AS email, color, NULL AS iban FROM people WHERE id IN (SELECT value FROM json_each(?))")
    .bind(ids(results.flatMap((r) => [r.person_id, r.created_by])))
    .all<Person>();
  // De velden van haar lijsten: om al haar dingen samen te tonen (tagView in shared/blocks.ts).
  const { results: rows } = await db
    .prepare("SELECT id, fields FROM lists WHERE id IN (SELECT value FROM json_each(?))")
    .bind(ids(lists.map((l) => l.id)))
    .all<{ id: string; fields: string }>();
  const fields = Object.fromEntries(rows.map((r) => [r.id, parseJson(r.fields, [])]));
  return c.json({ tag, lists, rules: results, people, can_edit: canEdit, fields });
});

tags.put("/:id", async (c) => {
  const db = c.env.DB;
  const { tag, canEdit } = await requireTag(db, c.get("person").id, c.req.param("id"));
  if (!canEdit) throw new ForbiddenError("Enkel wie de tag maakte of een lijst ermee beheert, past ze aan.");
  const body = asObject(await c.req.json());
  const color = body.color ?? null;
  if (color !== null && !isTone(color)) throw new ValidationError("Onbekende kleur");
  await db.prepare("UPDATE list_tags SET name = ?, color = ? WHERE id = ?").bind(requiredString(body, "name", 40), color, tag.id).run();
  return c.json({ ok: true });
});

/**
 * De regels van een tag zetten: `rules` [{ person_id, role }]. Wie ze bewaart, wordt hun maker (ze gelden dus op de
 * lijsten met de tag waar jij rechtstreeks beheerder bent). Enkel mensen die je kent.
 */
tags.put("/:id/rules", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { tag, canEdit } = await requireTag(db, me.id, c.req.param("id"));
  if (!canEdit) throw new ForbiddenError("Enkel wie de tag maakte of een lijst ermee beheert, past de regels aan.");
  const raw = asObject(await c.req.json()).rules;
  if (!Array.isArray(raw) || raw.length > MAX_RULES) throw new ValidationError(`Hoogstens ${MAX_RULES} regels`);
  const known = new Set((await knownPeople(db, me.id)).map((p) => p.id));
  const rules = new Map<string, Role>();
  for (const r of raw) {
    const o = asObject(r);
    if (typeof o.person_id !== "string" || !known.has(o.person_id)) throw new ValidationError("Die persoon ken je niet");
    if (!isRole(o.role)) throw new ValidationError(`Kies een rol: ${Object.values(ROLES).map((x) => x.label).join(", ")}`);
    rules.set(o.person_id, o.role);
  }
  await db.batch([
    db.prepare("DELETE FROM tag_rules WHERE tag_id = ?").bind(tag.id),
    ...[...rules].map(([person, role]) => db.prepare("INSERT INTO tag_rules (tag_id, person_id, role, created_by) VALUES (?, ?, ?, ?)").bind(tag.id, person, role, me.id)),
  ]);
  return c.json({ ok: true });
});

/** Een tag weghalen (enkel wie ze maakte): de lijsten blijven, de regels vallen weg. */
tags.delete("/:id", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { tag } = await requireTag(db, me.id, c.req.param("id"));
  if (tag.created_by !== me.id) throw new ForbiddenError("Enkel wie de tag maakte, kan ze weghalen.");
  await db.prepare("DELETE FROM list_tags WHERE id = ?").bind(tag.id).run();
  return c.body(null, 204);
});

export { seenLists };
