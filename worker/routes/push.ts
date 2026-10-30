// Meldingen aan- en uitzetten op een toestel. Elk toestel schrijft zich in met wat de browser gaf; de Worker stuurt
// enkel naar de pushdiensten van de browsers (`isPushEndpoint`).

import { Hono } from "hono";
import { b64url, isPushEndpoint, pushKeys } from "../../shared/webpush";
import { notify, vapid } from "../push";
import type { AppEnv } from "../types";
import { asObject, ValidationError } from "../validate";

export const push = new Hono<AppEnv>();

/** Hoeveel toestellen iemand hooguit heeft (het oudste valt weg). */
const MAX_DEVICES = 10;

/** De publieke sleutel van de app, om je in te schrijven. */
push.get("/key", async (c) => {
  const keys = await vapid(c.env.DB, new URL(c.req.url).origin);
  return c.json({ key: b64url.encode(keys!.raw) });
});

push.post("/", async (c) => {
  const body = asObject(await c.req.json());
  const keys = asObject(body.keys ?? {});
  const valid = pushKeys(keys.p256dh, keys.auth);
  if (!isPushEndpoint(body.endpoint) || !valid) throw new ValidationError("Dit toestel kan geen meldingen krijgen.");
  const db = c.env.DB;
  const me = c.get("person").id;
  await db.batch([
    db
      .prepare(
        `INSERT INTO push_subscriptions (id, person_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (endpoint) DO UPDATE SET person_id = excluded.person_id, p256dh = excluded.p256dh, auth = excluded.auth`,
      )
      .bind(crypto.randomUUID(), me, body.endpoint, valid.p256dh, valid.auth),
    db
      .prepare(
        `DELETE FROM push_subscriptions WHERE person_id = ?1 AND id NOT IN
         (SELECT id FROM push_subscriptions WHERE person_id = ?1 ORDER BY created_at DESC LIMIT ${MAX_DEVICES})`,
      )
      .bind(me),
  ]);
  return c.json({ ok: true }, 201);
});

/** Uitzetten op dit toestel. */
push.post("/remove", async (c) => {
  const body = asObject(await c.req.json());
  if (typeof body.endpoint !== "string") throw new ValidationError("Welk toestel?");
  await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND person_id = ?").bind(body.endpoint, c.get("person").id).run();
  return c.json({ ok: true });
});

/** Een testmelding naar je eigen toestellen. */
push.post("/test", async (c) => {
  const sent = await notify(c.env.DB, c.get("person").id, { title: "Thuis", body: "Zo ziet een melding eruit.", url: "/ik", tag: "test" });
  return c.json({ sent });
});
