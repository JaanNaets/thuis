// Meteen ook (zie shared/spawn.ts): bij een nieuw item met een ja/nee-veld met `spawn` aan, ook een item in de eerste
// van die lijsten waarin wie bewaart mag toevoegen. De statements gaan mee in dezelfde batch als het item zelf (alles
// of niets), door dezelfde controle als gewoon bewaren (`prepareData`, rechten, verwijzingen die tellen).

import { canCreate, typeAccess, visibleData, visibleFields } from "../shared/access";
import type { Attributes } from "../shared/fields";
import { spawnData, spawnFields, type SpawnProduct } from "../shared/spawn";
import type { ItemType } from "../shared/types";
import { computeEffects, effectStatements } from "./effects";
import { projectAccess, typesFor, type ProjectAccess } from "./context";

export type Spawned = { id: string; name: string; project_id: string; list: string };
type Prepare = (access: ProjectAccess, type: ItemType, data: unknown) => Promise<Attributes>;

/**
 * Wat een nieuw item ook maakt. `prepare`: het gewone nakijken van de waarden (prepareData) in het andere project.
 * Geen lijst waarin je mag toevoegen: niets (het item zelf wordt gewoon bewaard).
 */
export async function spawnStatements(
  db: D1Database,
  me: string,
  type: ItemType,
  source: { name: string; data: Attributes },
  prepare: Prepare,
): Promise<{ statements: D1PreparedStatement[]; made: Spawned[] }> {
  const statements: D1PreparedStatement[] = [];
  const made: Spawned[] = [];
  for (const field of spawnFields(type.fields, source.data)) {
    const target = await firstTarget(db, me, field.spawn ?? []);
    if (!target) continue;
    const products = await productsOf(db, me, type, source.data);
    const { name, data: raw } = spawnData({ fields: type.fields, data: source.data, name: source.name }, target.type.fields, products);
    const data = await prepare(target.access, target.type, raw);
    const id = crypto.randomUUID();
    const applied = await computeEffects(db, me, target.access.rights, target.type, { id, project_id: target.access.project.id }, data);
    statements.push(
      db
        .prepare("INSERT INTO items (id, project_id, type_id, name, data, created_by, applied) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(id, target.access.project.id, target.type.id, name || target.type.name, JSON.stringify(data), me, applied.length ? JSON.stringify(applied) : null),
      ...(await effectStatements(db, me, applied, true)),
    );
    made.push({ id, name: name || target.type.name, project_id: target.access.project.id, list: target.type.plural });
  }
  return { statements, made };
}

/** De eerste lijst (in volgorde) waarin je mag toevoegen, met je toegang tot haar project. */
async function firstTarget(db: D1Database, me: string, ids: string[]): Promise<{ access: ProjectAccess; type: ItemType } | null> {
  if (!ids.length) return null;
  const { results } = await db
    .prepare("SELECT id, project_id FROM item_types WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(ids))
    .all<{ id: string; project_id: string }>();
  for (const id of ids) {
    const row = results.find((r) => r.id === id);
    if (!row) continue;
    const access = await projectAccess(db, me, row.project_id);
    const type = access ? (await typesFor(db, access.chain)).find((t) => t.id === id) : undefined;
    if (access && type && canCreate(access.rights, type.id)) return { access, type };
  }
  return null;
}

/** De items waarnaar het nieuwe item verwijst, zoals jij ze ziet (enkel wat je mag zien gaat mee). */
async function productsOf(db: D1Database, me: string, type: ItemType, data: Attributes): Promise<Map<string, SpawnProduct>> {
  const ids = type.fields.filter((f) => f.type === "item" && typeof data[f.key] === "string").map((f) => data[f.key] as string);
  const out = new Map<string, SpawnProduct>();
  if (!ids.length) return out;
  const { results } = await db
    .prepare("SELECT id, project_id, type_id, data FROM items WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(ids))
    .all<{ id: string; project_id: string; type_id: string; data: string }>();
  for (const row of results) {
    const access = await projectAccess(db, me, row.project_id);
    const list = access ? (await typesFor(db, access.chain)).find((t) => t.id === row.type_id) : undefined;
    if (!access || !list || typeAccess(access.rights, list.id) === "none") continue;
    let parsed: Attributes = {};
    try {
      parsed = JSON.parse(row.data) as Attributes;
    } catch {
      parsed = {};
    }
    out.set(row.id, { id: row.id, type_id: list.id, fields: visibleFields(access.rights, list.id, list.fields), data: visibleData(access.rights, list.id, list.fields, parsed) });
  }
  return out;
}
