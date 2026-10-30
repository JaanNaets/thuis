// De agenda over al je projecten: wat op een dag valt volgens een datumveld met "In de agenda" (zie shared/agenda.ts).
// Elk item met jouw rechten in zijn eigen project: een lijst of veld dat je daar niet mag zien, komt er niet in.

import { Hono } from "hono";
import { fieldAccess, typeAccess, type Rights } from "../../shared/access";
import { MAX_AGENDA_DAYS, canAgenda, daysApart, occurrences, type Agenda, type AgendaEntry } from "../../shared/agenda";
import { withCalcs } from "../compute";
import { accessibleProjects, placeholders, toItemType, type TypeRow } from "../context";
import type { AppEnv } from "../types";
import { ValidationError } from "../validate";
import { ITEM_SELECT, toItem, type ItemRow } from "./items";

export const agenda = new Hono<AppEnv>();

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

agenda.get("/", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (!isDate(from) || !isDate(to) || to < from || daysApart(from, to) > MAX_AGENDA_DAYS) throw new ValidationError("Kies een periode van hoogstens twee maanden.");
  const db = c.env.DB;
  const me = c.get("person").id;
  const wanted = c.req.query("project");
  const nodes = (await accessibleProjects(db, me)).filter((n) => !n.archived && (!wanted || n.id === wanted));
  const empty: Agenda = { entries: [], projects: [], types: [] };
  if (!nodes.length) return c.json(empty);
  const rightsIn = new Map<string, Rights>(nodes.map((n) => [n.id, n.rights]));

  // Lijsten met een veld in de agenda (de JSON zegt het al; daarna netjes nagekeken).
  const { results: typeRows } = await db.prepare(`SELECT * FROM item_types WHERE fields LIKE '%"agenda":true%'`).all<TypeRow>();
  const types = typeRows.map(toItemType).filter((t) => t.fields.some((f) => f.agenda && canAgenda(f)));
  if (!types.length) return c.json(empty);
  const ids = nodes.map((n) => n.id);
  const { results } = await db
    .prepare(
      `${ITEM_SELECT} WHERE i.archived = 0 AND i.type_id IN (${placeholders(types.length)}) AND i.project_id IN (SELECT value FROM json_each(?)) LIMIT 5000`,
    )
    .bind(...types.map((t) => t.id), JSON.stringify(ids))
    .all<ItemRow>();

  const entries: AgendaEntry[] = [];
  for (const type of types) {
    // Per project: de rechten (en dus de berekeningen) kunnen verschillen.
    for (const projectId of new Set(results.filter((r) => r.type_id === type.id).map((r) => r.project_id))) {
      const rights = rightsIn.get(projectId)!;
      if (typeAccess(rights, type.id) === "none") continue;
      const items = results.filter((r) => r.type_id === type.id && r.project_id === projectId).map((r) => toItem(r, rights, type));
      const fields = type.fields.filter((f) => f.agenda && canAgenda(f) && fieldAccess(rights, type.id, f.key) !== "none");
      if (!fields.length) continue;
      if (fields.some((f) => f.type === "calc")) await withCalcs(db, me, type, rights, items);
      for (const item of items)
        for (const f of fields)
          for (const o of occurrences(f, item.data[f.key], from, to))
            entries.push({ item_id: item.id, name: item.name, project_id: projectId, type_id: type.id, label: f.label, ...o });
    }
  }
  entries.sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name, "nl"));
  const used = new Set(entries.map((e) => e.type_id));
  const usedProjects = new Set(entries.map((e) => e.project_id));
  return c.json({
    entries,
    projects: nodes.filter((n) => usedProjects.has(n.id)).map((n) => ({ id: n.id, name: n.name, color: n.color })),
    types: types.filter((t) => used.has(t.id)).map((t) => ({ id: t.id, name: t.name, plural: t.plural, icon: t.icon })),
  } satisfies Agenda);
});
