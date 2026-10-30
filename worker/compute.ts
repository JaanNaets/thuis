// Berekeningen uitrekenen bij het lezen (zie shared/calc.ts). Opzoeken en samenvatten halen andere items op: enkel
// wat jij daar mag zien (het project, de lijst en het veld) telt mee; anders blijft de uitkomst leeg.

import { fieldAccess, typeAccess, visibleData, type Rights } from "../shared/access";
import { aggregate, computeLocal, fieldDeps, type CalcDef } from "../shared/calc";
import type { Attributes, FieldDef, FieldValue } from "../shared/fields";
import type { Item, ItemType } from "../shared/types";
import { accessibleProjects, toItemType, type TypeRow } from "./context";

type Row = { id: string; project_id: string; type_id: string; data: string };
type LinkCalc = FieldDef & { calc: Extract<CalcDef, { kind: "lookup" | "rollup" }> };

function parse(json: string): Attributes {
  try {
    const value = JSON.parse(json);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Attributes) : {};
  } catch {
    return {};
  }
}

const idsIn = (v: FieldValue | undefined): string[] =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/**
 * De berekeningen van een lijst invullen in de items (die al gefilterd zijn op wat je mag zien). `rights`: jouw rechten
 * in het project van deze items.
 */
export async function withCalcs(db: D1Database, personId: string, type: ItemType, rights: Rights, items: Item[]): Promise<void> {
  const calcs = type.fields.filter((f) => f.type === "calc" && f.calc && f.result && fieldAccess(rights, type.id, f.key) !== "none");
  if (!calcs.length || !items.length) return;

  // Rechten per project en lijsten: pas ophalen als er iets op te zoeken is.
  let projectRights: Map<string, Rights> | undefined;
  const rightsIn = async (projectId: string) => {
    projectRights ??= new Map((await accessibleProjects(db, personId)).map((n) => [n.id, n.rights]));
    return projectRights.get(projectId);
  };
  const types = new Map<string, ItemType | null>();
  const typeOf = async (id: string) => {
    if (!types.has(id)) {
      const row = await db.prepare("SELECT * FROM item_types WHERE id = ?").bind(id).first<TypeRow>();
      types.set(id, row ? toItemType(row) : null);
    }
    return types.get(id) ?? null;
  };
  /**
   * Een ander item zoals jij het ziet (met zijn eigen berekeningen): null als je het item of `keys` niet mag zien;
   * `hidden` als je `value` niet mag zien (of iets waarvan die afhangt).
   */
  const seen = async (row: Row, list: ItemType, keys: string[], value?: string): Promise<{ data: Attributes; hidden: boolean } | null> => {
    const r = await rightsIn(row.project_id);
    if (!r || row.type_id !== list.id || typeAccess(r, list.id) === "none" || keys.some((k) => fieldAccess(r, list.id, k) === "none")) return null;
    const hidden = value ? fieldDeps(list.fields, value).some((k) => fieldAccess(r, list.id, k) === "none") : false;
    return { data: computeLocal(list.fields, visibleData(r, list.id, list.fields, parse(row.data))), hidden };
  };
  const fetch = async (ids: string[], activeOnly: boolean) => {
    if (!ids.length) return [];
    const { results } = await db
      .prepare(`SELECT id, project_id, type_id, data FROM items WHERE id IN (SELECT value FROM json_each(?))${activeOnly ? " AND archived = 0" : ""}`)
      .bind(JSON.stringify([...new Set(ids)]))
      .all<Row>();
    return results;
  };

  for (const def of calcs.filter((f): f is LinkCalc => f.calc!.kind === "lookup" || f.calc!.kind === "rollup")) {
    const calc = def.calc;
    const own = calc.kind === "lookup" || calc.from === "links" ? type.fields.find((f) => f.key === calc.via) : undefined;
    // De verwijzing in dit item moet je zelf ook mogen zien.
    if (own && fieldAccess(rights, type.id, own.key) === "none") continue;

    if (calc.kind === "lookup") {
      const list = own?.ref_type ? await typeOf(own.ref_type) : null;
      if (!list) continue;
      const values = new Map<string, FieldValue>();
      for (const row of await fetch(
        items.flatMap((i) => idsIn(i.data[calc.via])),
        false,
      )) {
        const found = await seen(row, list, [], calc.field);
        if (found && !found.hidden && found.data[calc.field] !== undefined) values.set(row.id, found.data[calc.field]);
      }
      for (const item of items) {
        const ref = item.data[calc.via];
        if (typeof ref === "string" && values.has(ref)) item.data[def.key] = values.get(ref)!;
      }
      continue;
    }

    // Samenvatten: per item de waarden van de gelinkte items die je mag zien. Mag je de waarde bij een van die items
    // niet zien, dan blijft de uitkomst leeg (een som zonder dat item zou niet kloppen).
    const field = calc.agg === "count" ? undefined : calc.field;
    const linked = new Map<string, FieldValue[]>(items.map((i) => [i.id, []]));
    const counts = new Map<string, number>(items.map((i) => [i.id, 0]));
    const incomplete = new Set<string>();
    const add = (itemId: string, found: { data: Attributes; hidden: boolean }) => {
      counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
      if (!field) return;
      if (found.hidden) incomplete.add(itemId);
      else if (found.data[field] !== undefined) linked.get(itemId)!.push(found.data[field]);
    };
    if (calc.from === "links") {
      const list = own?.ref_type ? await typeOf(own.ref_type) : null;
      if (!list) continue;
      const rows = new Map(
        (
          await fetch(
            items.flatMap((i) => idsIn(i.data[calc.via])),
            true,
          )
        ).map((r) => [r.id, r]),
      );
      for (const item of items) {
        for (const id of idsIn(item.data[calc.via])) {
          const row = rows.get(id);
          const found = row ? await seen(row, list, [], field) : null;
          if (found) add(item.id, found);
        }
      }
    } else {
      const list = calc.list ? await typeOf(calc.list) : null;
      if (!list) continue;
      const ours = new Set(items.map((i) => i.id));
      const { results } = await db
        .prepare(
          `SELECT id, project_id, type_id, data FROM items
           WHERE type_id = ?1 AND archived = 0 AND EXISTS (SELECT 1 FROM json_each(items.data, ?2) j WHERE j.value IN (SELECT value FROM json_each(?3)))`,
        )
        .bind(list.id, `$.${calc.via}`, JSON.stringify([...ours]))
        .all<Row>();
      for (const row of results) {
        const found = await seen(row, list, [calc.via], field);
        if (!found) continue;
        for (const id of idsIn(found.data[calc.via])) if (ours.has(id)) add(id, found);
      }
    }
    for (const item of items) {
      if (incomplete.has(item.id)) continue;
      const value = aggregate(calc.agg, linked.get(item.id)!, counts.get(item.id)!, def.result);
      if (value !== undefined) item.data[def.key] = value;
    }
  }

  // Daarna de berekeningen binnen het item, op wat je mag zien (een verborgen veld telt niet mee).
  for (const item of items) {
    const computed = computeLocal(type.fields, item.data);
    for (const def of calcs) if (computed[def.key] !== undefined) item.data[def.key] = computed[def.key];
  }
}

/** Een item zoals de lezer het ziet, voor een totaal. */
export type SeenItem = { id: string; project_id: string; data: Attributes };

/**
 * De items van een lijst in `projectIds` zoals jij ze ziet, voor een totaal: per item je rechten in zijn project.
 * Mag je daar de lijst of een van `keys` (of iets waarvan die afhangt) niet zien, dan telt het item niet. Met de
 * berekeningen uitgerekend (enkel als een van `keys` er een is). `rightsOf`: je rechten per project.
 */
export async function itemsAsSeen(
  db: D1Database,
  personId: string,
  rightsOf: Map<string, Rights>,
  list: ItemType,
  projectIds: string[],
  keys: string[],
): Promise<SeenItem[]> {
  const allowed = projectIds.filter((id) => {
    const r = rightsOf.get(id);
    return r && typeAccess(r, list.id) !== "none" && keys.every((k) => fieldDeps(list.fields, k).every((d) => fieldAccess(r, list.id, d) !== "none"));
  });
  if (!allowed.length) return [];
  const { results } = await db
    .prepare(`SELECT id, project_id, type_id, data FROM items WHERE type_id = ?1 AND archived = 0 AND project_id IN (SELECT value FROM json_each(?2))`)
    .bind(list.id, JSON.stringify(allowed))
    .all<Row>();
  const byProject = new Map<string, Item[]>();
  for (const row of results) {
    const rights = rightsOf.get(row.project_id)!;
    const item = { id: row.id, project_id: row.project_id, type_id: row.type_id, data: visibleData(rights, list.id, list.fields, parse(row.data)) } as Item;
    byProject.set(row.project_id, [...(byProject.get(row.project_id) ?? []), item]);
  }
  const calcs = keys.some((k) => fieldDeps(list.fields, k).some((d) => list.fields.find((f) => f.key === d)?.type === "calc"));
  if (calcs) for (const [projectId, items] of byProject) await withCalcs(db, personId, list, rightsOf.get(projectId)!, items);
  return [...byProject.values()].flat().map((i) => ({ id: i.id, project_id: i.project_id, data: i.data }));
}
