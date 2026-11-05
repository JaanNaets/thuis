// Verbanden van een project (zie shared/links.ts): de lijsten van het project en zijn subprojecten, met wat ze met
// elkaar en met lijsten in andere projecten doen. Enkel wat de lezer mag zien: een project, lijst of veld dat hij niet
// ziet, komt er niet in (ook geen lijn of telling). Begrensd: hoogstens MAX_COLUMNS subprojecten en MAX_OUTSIDE lijsten
// van elders, en een vast aantal vragen aan de databank, of je nu 20 of 1000 projecten hebt.

import { Hono } from "hono";
import { canSeeType, visibleFields, type Rights } from "../../shared/access";
import {
  adjustProblems,
  AGENDA_NODE,
  BALANCE_NODE,
  listLinks,
  MAX_COLUMNS,
  MAX_MORE,
  MAX_OUTSIDE,
  mergeLinks,
  OUTSIDE,
  type AdjustEdge,
  type Link,
  type LinkMap,
  type LinkNode,
  type LinkProblem,
} from "../../shared/links";
import { refLists } from "../../shared/fields";
import { visibleTotals } from "../../shared/totals";
import { descendantIds, flattenTree } from "../../shared/tree";
import type { ItemType } from "../../shared/types";
import { accessibleProjects, parseRights, requireProject, toItemType, type TypeRow } from "../context";
import type { AppEnv } from "../types";

export const projectLinks = new Hono<AppEnv>();

const json = (v: unknown) => JSON.stringify(v);

/**
 * Wie een verwijzing die telt niet kan gebruiken (zie `adjustProblems`), voor de verbanden op de kaart. Enkel waar de
 * lezer de mensen beheert in het project van beide lijsten. Twee vragen aan de databank, hoeveel verbanden er ook zijn.
 */
async function problemsFor(
  db: D1Database,
  lists: Map<string, ItemType>,
  links: Link[],
  rightsIn: (projectId: string) => Rights | undefined,
  nameOf: (projectId: string) => string,
): Promise<LinkProblem[]> {
  const drawn = new Set(links.filter((l) => l.kind === "adjust").map((l) => `${l.from}|${l.to}`));
  const edges: AdjustEdge[] = [];
  for (const s of lists.values()) {
    for (const f of s.fields) {
      if ((f.type !== "item" && f.type !== "amounts") || !f.adjust) continue;
      for (const to of refLists(f)) {
        const t = lists.get(to);
        if (!t || !drawn.has(`${s.id}|${to}`) || !rightsIn(s.project_id)?.members || !rightsIn(t.project_id)?.members) continue;
        const target = f.adjust.field;
        edges.push({
          from: s.id,
          fromProject: s.project_id,
          key: f.key,
          to,
          toProject: t.project_id,
          toProjectName: nameOf(t.project_id),
          target,
          label: t.fields.find((x) => x.key === target)?.label ?? target,
        });
      }
    }
  }
  if (!edges.length) return [];
  const starts = [...new Set(edges.flatMap((e) => [e.fromProject, e.toProject]))];
  const { results: up } = await db
    .prepare(
      `WITH RECURSIVE up(start, id, depth) AS (
         SELECT value, value, 0 FROM json_each(?1)
         UNION ALL
         SELECT up.start, p.parent_id, up.depth + 1 FROM projects p JOIN up ON p.id = up.id WHERE p.parent_id IS NOT NULL AND up.depth < 30
       )
       SELECT start, id FROM up ORDER BY start, depth`,
    )
    .bind(json(starts))
    .all<{ start: string; id: string }>();
  const chains = new Map<string, string[]>();
  for (const r of up) chains.set(r.start, [...(chains.get(r.start) ?? []), r.id]);
  const { results: rows } = await db
    .prepare(
      `SELECT m.project_id, m.person_id, m.role_id, r.name AS role_name, r.rights, r.project_id AS role_project, pe.name AS person_name
       FROM memberships m JOIN roles r ON r.id = m.role_id JOIN people pe ON pe.id = m.person_id
       WHERE m.project_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(json([...new Set(up.map((r) => r.id))]))
    .all<{ project_id: string; person_id: string; role_id: string; role_name: string; rights: string; role_project: string; person_name: string }>();
  return adjustProblems(
    edges,
    new Map(rows.map((r) => [r.person_id, r.person_name])),
    rows,
    new Map(rows.map((r) => [r.role_id, { name: r.role_name, rights: parseRights(r.rights), project_id: r.role_project }])),
    (p) => chains.get(p) ?? [p],
  );
}

projectLinks.get("/:id/links", async (c) => {
  const db = c.env.DB;
  const me = c.get("person").id;
  const access = await requireProject(db, me, c.req.param("id"));
  const id = access.project.id;
  const nodes = await accessibleProjects(db, me);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Rechten per project: waar je lid bent (of eronder), en de projecten erboven met je rechten hier (hun lijsten
  // gebruik je hier ook). Een project erboven dat je zelf niet ziet, heeft geen naam.
  const visibleAbove = new Map(access.path.map((p) => [p.id, p.name]));
  const rightsIn = (projectId: string): Rights | undefined =>
    byId.get(projectId)?.rights ?? (access.chain.includes(projectId) ? access.rights : undefined);
  const nameOf = (projectId: string) => byId.get(projectId)?.name ?? visibleAbove.get(projectId) ?? "Erboven";

  // Het project en de subprojecten eronder (niet gearchiveerd), in de volgorde van de boom.
  const under = descendantIds(nodes, id);
  const tree = flattenTree(nodes.filter((n) => under.has(n.id) && (n.id === id || !n.archived)));
  const treeIds = tree.map((n) => n.id);
  const [{ results: owned }, { results: shownRows }] = (await db.batch([
    db.prepare("SELECT project_id, COUNT(*) AS n FROM item_types WHERE project_id IN (SELECT value FROM json_each(?)) GROUP BY project_id").bind(json(treeIds)),
    db.prepare("SELECT project_id, type_id FROM shown_lists WHERE project_id IN (SELECT value FROM json_each(?))").bind(json(treeIds)),
  ])) as [D1Result<{ project_id: string; n: number }>, D1Result<{ project_id: string; type_id: string }>];
  const busy = new Set([...owned.map((r) => r.project_id), ...shownRows.map((r) => r.project_id)]);
  // Eerst de rechtstreekse subprojecten, dan dieper (die hebben ook elk een eigen kaart).
  const subs = tree.filter((n) => n.id !== id && busy.has(n.id)).sort((a, b) => a.depth - b.depth);
  const columnIds = [id, ...subs.slice(0, MAX_COLUMNS).map((n) => n.id)];
  const inMap = new Set(columnIds);
  const shown = shownRows.filter((r) => inMap.has(r.project_id));

  // De lijsten op de kaart.
  const { results: mapRows } = await db
    .prepare("SELECT * FROM item_types WHERE project_id IN (SELECT value FROM json_each(?)) ORDER BY sort_order, created_at")
    .bind(json(columnIds))
    .all<TypeRow>();
  const seeAs = (t: ItemType): ItemType | null => {
    const rights = rightsIn(t.project_id);
    if (!rights || !canSeeType(rights, t.id)) return null;
    const fields = visibleFields(rights, t.id, t.fields);
    return { ...t, fields, totals: visibleTotals(t.totals, fields) };
  };
  const mapLists = mapRows.map(toItemType).map(seeAs).filter((t): t is ItemType => t !== null);
  const mapIds = new Set(mapLists.map((t) => t.id));

  // Lijsten elders die ermee verbonden zijn: waar onze lijsten naar wijzen (of als tab tonen), en wat naar onze lijsten
  // wijst of eruit telt (de JSON noemt hun id; daarna netjes nagekeken). Enkel in projecten die je ziet, en erboven.
  const pointsTo = new Set<string>(shown.map((r) => r.type_id));
  for (const t of mapLists) {
    for (const f of t.fields) {
      for (const to of refLists(f)) pointsTo.add(to);
      if (f.calc?.kind === "rollup" && f.calc.list) pointsTo.add(f.calc.list);
    }
    for (const total of t.totals) for (const s of total.sources ?? []) pointsTo.add(s);
  }
  // Subprojecten die niet meer op de kaart passen, hebben hun eigen kaart: die komen hier niet als "elders".
  const elsewhere = [...new Set([...nodes.map((n) => n.id), ...access.chain])].filter((p) => !under.has(p));
  const { results: outRows } = await db
    .prepare(
      `SELECT * FROM item_types t
       WHERE t.project_id IN (SELECT value FROM json_each(?1))
         AND (t.id IN (SELECT value FROM json_each(?2))
              OR EXISTS (SELECT 1 FROM json_each(?3) k WHERE instr(t.fields, k.value) > 0 OR instr(t.totals, k.value) > 0))
       LIMIT 200`,
    )
    .bind(json(elsewhere), json([...pointsTo].filter((x) => !mapIds.has(x))), json([...mapIds]))
    .all<TypeRow>();
  const outLists = outRows.map(toItemType).map(seeAs).filter((t): t is ItemType => t !== null);

  // De verbanden, met enkel wat de lezer ziet.
  const all = new Map([...mapLists, ...outLists].map((t) => [t.id, t]));
  const fieldsOf = (listId: string) => all.get(listId)?.fields;
  const derived: Link[] = [...mapLists, ...outLists].flatMap((t) => listLinks(t, fieldsOf));
  for (const r of shown) {
    if (!all.has(r.type_id) || !canSeeType(rightsIn(r.project_id)!, r.type_id)) continue;
    derived.push({ kind: "tab", from: `${r.type_id}@${r.project_id}`, to: r.type_id, texts: [`Tab in ${nameOf(r.project_id)}`] });
  }
  const own = (x: string) => mapIds.has(x) || x.includes("@");
  const links = mergeLinks(
    derived.filter((l) => {
      // Wie moet wie en de agenda: enkel van de lijsten op deze kaart.
      if (l.to === BALANCE_NODE || l.to === AGENDA_NODE) return own(l.from);
      return (all.has(l.from) || own(l.from)) && all.has(l.to) && (own(l.from) || own(l.to));
    }),
  );

  // Lijsten van elders: die met de meeste verbanden eerst, hoogstens MAX_OUTSIDE.
  const degree = new Map<string, number>();
  for (const l of links) for (const x of [l.from, l.to]) degree.set(x, (degree.get(x) ?? 0) + 1);
  const outsideUsed = outLists.filter((t) => degree.has(t.id)).sort((a, b) => degree.get(b.id)! - degree.get(a.id)!);
  const outsideKept = new Set(outsideUsed.slice(0, MAX_OUTSIDE).map((t) => t.id));
  const kept = links.filter((l) => [l.from, l.to].every((x) => !all.has(x) || mapIds.has(x) || outsideKept.has(x)));

  // Aantal items per lijst en project op de kaart.
  const { results: countRows } = await db
    .prepare(
      `SELECT type_id, project_id, COUNT(*) AS n FROM items
       WHERE archived = 0 AND project_id IN (SELECT value FROM json_each(?1)) AND type_id IN (SELECT value FROM json_each(?2))
       GROUP BY type_id, project_id`,
    )
    .bind(json(columnIds), json([...mapIds, ...shown.map((r) => r.type_id)]))
    .all<{ type_id: string; project_id: string; n: number }>();
  const countOf = (typeId: string, projectId: string) => countRows.find((r) => r.type_id === typeId && r.project_id === projectId)?.n ?? 0;

  const linked = new Set(kept.flatMap((l) => [l.from, l.to]));
  const out: LinkNode[] = [];
  const listNode = (t: ItemType, column: string, count: number | null): LinkNode => ({
    id: t.id,
    list_id: t.id,
    name: t.plural,
    icon: t.icon,
    project_id: t.project_id,
    project_name: nameOf(t.project_id),
    column,
    count,
  });
  for (const pid of columnIds) {
    for (const t of mapLists) if (t.project_id === pid && linked.has(t.id)) out.push(listNode(t, pid, countOf(t.id, pid)));
    for (const r of shown) {
      const t = all.get(r.type_id);
      const nodeId = `${r.type_id}@${r.project_id}`;
      if (r.project_id === pid && t && linked.has(nodeId)) out.push({ ...listNode(t, pid, countOf(t.id, pid)), id: nodeId, project_id: pid, project_name: nameOf(pid) });
    }
  }
  if (linked.has(BALANCE_NODE))
    out.push({ id: BALANCE_NODE, list_id: null, name: "Wie moet wie", icon: "wallet", project_id: id, project_name: nameOf(id), column: id, count: null });
  for (const t of outsideUsed) if (outsideKept.has(t.id)) out.push(listNode(t, OUTSIDE, null));
  if (linked.has(AGENDA_NODE))
    out.push({ id: AGENDA_NODE, list_id: null, name: "Agenda", icon: "calendar", project_id: id, project_name: "Al je projecten", column: OUTSIDE, count: null });

  const used = new Set(out.map((n) => n.column));
  const project = (pid: string) => tree.find((n) => n.id === pid)!;
  return c.json({
    columns: columnIds.filter((pid) => used.has(pid)).map((pid) => ({ id: pid, name: project(pid).name, color: project(pid).color })),
    nodes: out,
    links: kept,
    problems: await problemsFor(db, all, kept, rightsIn, nameOf),
    quiet: columnIds.filter((pid) => pid !== id && !used.has(pid)).map((pid) => ({ id: pid, name: project(pid).name })),
    more: {
      projects: subs.slice(MAX_COLUMNS, MAX_COLUMNS + MAX_MORE).map((n) => ({ id: n.id, name: n.name })),
      project_count: Math.max(0, subs.length - MAX_COLUMNS),
      outside: Math.max(0, outsideUsed.length - MAX_OUTSIDE),
    },
  } satisfies LinkMap);
});

/**
 * Verbanden over al je projecten: het hele web, elk project (ook een subproject) met verbonden lijsten een kolom, in
 * de volgorde van je boom. Begrensd: de MAX_COLUMNS + 1 projecten met de meeste verbanden, de rest bij naam (elk heeft
 * zijn eigen kaart). Elke lijst met jouw rechten in haar eigen project; geen agenda of Wie moet wie (die horen bij
 * één project).
 */
export const allLinks = new Hono<AppEnv>();

allLinks.get("/", async (c) => {
  const db = c.env.DB;
  const me = c.get("person").id;
  const nodes = (await accessibleProjects(db, me)).filter((n) => !n.archived);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const { results } = await db
    .prepare("SELECT * FROM item_types WHERE project_id IN (SELECT value FROM json_each(?)) ORDER BY sort_order, created_at")
    .bind(json(nodes.map((n) => n.id)))
    .all<TypeRow>();
  const lists = results.map(toItemType).flatMap((t): ItemType[] => {
    const rights = byId.get(t.project_id)!.rights;
    if (!canSeeType(rights, t.id)) return [];
    const fields = visibleFields(rights, t.id, t.fields);
    return [{ ...t, fields, totals: visibleTotals(t.totals, fields) }];
  });
  const all = new Map(lists.map((t) => [t.id, t]));
  const links = mergeLinks(lists.flatMap((t) => listLinks(t, (id) => all.get(id)?.fields)).filter((l) => all.has(l.from) && all.has(l.to)));

  // Projecten met de meeste verbanden; getoond in de volgorde van je boom.
  const degree = new Map<string, number>();
  for (const l of links) for (const x of [l.from, l.to]) degree.set(all.get(x)!.project_id, (degree.get(all.get(x)!.project_id) ?? 0) + 1);
  const busy = flattenTree(nodes).filter((n) => degree.has(n.id));
  const shown = new Set([...busy].sort((a, b) => degree.get(b.id)! - degree.get(a.id)!).slice(0, MAX_COLUMNS + 1).map((n) => n.id));
  const kept = links.filter((l) => [l.from, l.to].every((x) => shown.has(all.get(x)!.project_id)));
  const used = new Set(kept.flatMap((l) => [l.from, l.to]));
  const rest = busy.filter((n) => !shown.has(n.id));
  return c.json({
    columns: busy.filter((n) => shown.has(n.id)).map((n) => ({ id: n.id, name: n.name, color: n.color })),
    nodes: lists
      .filter((t) => used.has(t.id))
      .map((t) => ({
        id: t.id,
        list_id: t.id,
        name: t.plural,
        icon: t.icon,
        project_id: t.project_id,
        project_name: byId.get(t.project_id)?.name ?? "",
        column: t.project_id,
        count: null,
      })),
    links: kept,
    problems: await problemsFor(
      db,
      all,
      kept,
      (p) => byId.get(p)?.rights,
      (p) => byId.get(p)?.name ?? "",
    ),
    quiet: [],
    more: { projects: rest.slice(0, MAX_MORE).map((n) => ({ id: n.id, name: n.name })), project_count: rest.length, outside: 0 },
  } satisfies LinkMap);
});
