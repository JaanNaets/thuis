// Koppelingen van een lijst (zie shared/transfer.ts en worker/mirrors.ts): GET de koppelingen die in deze lijst schrijven,
// PUT /:bron bewaart of wijzigt er een (enkel wie beheerder is van beide lijsten, zonder kring) en werkt ze meteen bij,
// DELETE /:bron haalt ze weg: de gekoppelde dingen blijven als gewone dingen staan.

import { Hono } from "hono";
import { canManage } from "../../shared/model";
import { cleanPlan, makesCycle } from "../../shared/transfer";
import { needManage, parseJson, requireList, seenLists } from "../access";
import { syncFrom, syncMirror, type MirrorRow } from "../mirrors";
import type { AppEnv } from "../types";
import { asObject, ValidationError } from "../validate";

export const listMirrors = new Hono<AppEnv>();

export type MirrorInfo = { id: string; source_id: string; source: string | null; plan: unknown; can_manage: boolean };

listMirrors.get("/:id/mirrors", async (c) => {
  const db = c.env.DB;
  const me = c.get("person").id;
  const { list } = await requireList(db, me, c.req.param("id"));
  const seen = await seenLists(db, me);
  const { results } = await db
    .prepare("SELECT m.id, m.source_id, m.plan, l.name FROM mirrors m JOIN lists l ON l.id = m.source_id WHERE m.list_id = ? ORDER BY l.name")
    .bind(list.id)
    .all<{ id: string; source_id: string; plan: string; name: string }>();
  // De naam van de bron enkel als je ze ziet; het plan enkel voor wie beide lijsten beheert (om het aan te passen).
  const manage = canManage(seen.get(list.id));
  return c.json(
    results.map(
      (m): MirrorInfo => ({
        id: m.id,
        source_id: m.source_id,
        source: seen.has(m.source_id) ? m.name : null,
        plan: manage && canManage(seen.get(m.source_id)) ? parseJson(m.plan, {}) : null,
        can_manage: manage && canManage(seen.get(m.source_id)),
      }),
    ),
  );
});

listMirrors.put("/:id/mirrors/:source", async (c) => {
  const db = c.env.DB;
  const me = c.get("person").id;
  const { list, role } = await requireList(db, me, c.req.param("id"));
  needManage(role, "Enkel een beheerder van beide lijsten koppelt.");
  const { list: source, role: sourceRole } = await requireList(db, me, c.req.param("source"));
  needManage(sourceRole, "Enkel een beheerder van beide lijsten koppelt.");
  if (!list.one || !source.one) throw new ValidationError("Koppelen kan enkel tussen lijsten met dingen.");
  const { results: all } = await db.prepare("SELECT list_id, source_id FROM mirrors").all<{ list_id: string; source_id: string }>();
  const others = all.filter((m) => !(m.list_id === list.id && m.source_id === source.id)).map((m) => ({ list: m.list_id, source: m.source_id }));
  if (makesCycle(others, list.id, source.id)) throw new ValidationError(`${source.name} haalt al uit ${list.name}: dat zou een kring worden.`);
  let plan;
  try {
    plan = { ...cleanPlan(asObject(await c.req.json()), source, list.fields), mode: "link" as const };
  } catch (err) {
    throw new ValidationError((err as Error).message);
  }
  const had = await db.prepare("SELECT id FROM mirrors WHERE list_id = ? AND source_id = ?").bind(list.id, source.id).first<{ id: string }>();
  const id = had?.id ?? crypto.randomUUID();
  if (had) await db.prepare("UPDATE mirrors SET plan = ?, created_by = ?, updated_at = datetime('now') WHERE id = ?").bind(JSON.stringify(plan), me, id).run();
  else await db.prepare("INSERT INTO mirrors (id, list_id, source_id, plan, created_by) VALUES (?, ?, ?, ?, ?)").bind(id, list.id, source.id, JSON.stringify(plan), me).run();
  const row: MirrorRow = { id, list_id: list.id, source_id: source.id, plan: JSON.stringify(plan), created_by: me };
  const changes = await syncMirror(db, row);
  // Wat in deze lijst veranderde, kan de bron zijn van een volgende koppeling.
  await syncFrom(db, list.id);
  return c.json({ id, created: changes?.create.length ?? 0, updated: changes?.update.length ?? 0, archived: changes?.archive.length ?? 0 });
});

listMirrors.delete("/:id/mirrors/:source", async (c) => {
  const db = c.env.DB;
  const { list, role } = await requireList(db, c.get("person").id, c.req.param("id"));
  needManage(role);
  const m = await db.prepare("SELECT id FROM mirrors WHERE list_id = ? AND source_id = ?").bind(list.id, c.req.param("source")).first<{ id: string }>();
  if (!m) return c.body(null, 204);
  await db.batch([
    db.prepare("UPDATE things SET mirror_id = NULL, mirror_of = NULL, updated_at = datetime('now') WHERE mirror_id = ?").bind(m.id),
    db.prepare("DELETE FROM mirrors WHERE id = ?").bind(m.id),
  ]);
  return c.body(null, 204);
});
