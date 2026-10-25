import { Hono } from "hono";
import { isTone, type Me, type Person } from "../../shared/types";
import { accessibleProjects } from "../context";
import type { AppEnv } from "../types";
import { asObject, requiredString, ValidationError } from "../validate";

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
