// Bestanden bij een ding of gebeurtenis (een factuur, een handleiding): zien wie het ding of de gebeurtenis
// helemaal ziet, verwijderen wie het mag wijzigen.

import { Hono, type Context } from "hono";
import { canEdit } from "../../shared/model";
import { requireThing, seenLists } from "../access";
import type { AppEnv } from "../types";
import { ForbiddenError, NotFoundError } from "../validate";

export const attachments = new Hono<AppEnv>();

type Meta = { id: string; owner_kind: "thing" | "event"; owner_id: string; filename: string; content_type: string; r2_key: string };

async function requireAttachment(c: Context<AppEnv>, id: string, edit: boolean): Promise<Meta> {
  const db = c.env.DB;
  const meta = await db.prepare("SELECT * FROM attachments WHERE id = ?").bind(id).first<Meta>();
  if (!meta) throw new NotFoundError("Dat bestand bestaat niet (meer).");
  const personId = c.get("person").id;
  let role;
  if (meta.owner_kind === "thing") role = (await requireThing(db, personId, meta.owner_id)).role;
  else {
    const row = await db.prepare("SELECT list_id FROM events WHERE id = ?").bind(meta.owner_id).first<{ list_id: string }>();
    role = row ? (await seenLists(db, personId, row.list_id)).get(row.list_id) : undefined;
    if (!role) throw new NotFoundError("Dat bestand bestaat niet (meer).");
  }
  if (edit && !canEdit(role)) throw new ForbiddenError("Je mag hier enkel kijken.");
  return meta;
}

attachments.get("/:id", async (c) => {
  const meta = await requireAttachment(c, c.req.param("id"), false);
  const object = await c.env.FILES.get(meta.r2_key);
  if (!object) return c.json({ error: "Bestand niet gevonden" }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": meta.content_type,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(meta.filename)}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

attachments.delete("/:id", async (c) => {
  const meta = await requireAttachment(c, c.req.param("id"), true);
  await c.env.DB.prepare("DELETE FROM attachments WHERE id = ?").bind(meta.id).run();
  await c.env.FILES.delete(meta.r2_key);
  return c.body(null, 204);
});
