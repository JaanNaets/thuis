// Verwijzingen die tellen (zie shared/effects.ts): de aanpassingen aan andere items nakijken en klaarzetten, samen met
// het bewaren van het item zelf (één batch, dus alles of niets).

import { fieldAccess, typeAccess, type Rights } from "../shared/access";
import { convertEffects, effectsOf, type Applied, type Effect } from "../shared/effects";
import { measureOf } from "../shared/units";
import type { Attributes, FieldDef } from "../shared/fields";
import type { Item, ItemType } from "../shared/types";
import { withCalcs } from "./compute";
import { projectAccess, typesFor } from "./context";
import { ForbiddenError } from "./validate";

/** Wat een item met deze waarden aanpast, met de berekeningen (ook opzoekingen) zoals de bewerker ze ziet. */
export async function computeEffects(db: D1Database, personId: string, rights: Rights, type: ItemType, item: Pick<Item, "id" | "project_id">, data: Attributes) {
  if (!type.fields.some((f) => f.type === "item" && f.adjust)) return [];
  const temp = { ...item, type_id: type.id, name: "", tag_ids: [], data: { ...data } } as unknown as Item;
  await withCalcs(db, personId, type, rights, [temp]);
  return inTargetUnits(db, effectsOf(type.fields, temp.data));
}

/**
 * Hoeveelheden met een eenheid (500 g) omrekenen naar de eenheid van elk item dat telt (zie shared/units.ts): met de
 * waarden van die items, in twee vragen aan de databank. Niets hiervan gaat naar de browser.
 */
export async function inTargetUnits(db: D1Database, effects: Effect[]): Promise<Applied[]> {
  const targets = [...new Set(effects.filter((e) => e.unit).map((e) => e.target))];
  if (!targets.length) return convertEffects(effects, () => undefined);
  const { results: rows } = await db
    .prepare("SELECT id, type_id, data FROM items WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(targets))
    .all<{ id: string; type_id: string; data: string }>();
  const { results: lists } = await db
    .prepare("SELECT id, fields FROM item_types WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify([...new Set(rows.map((r) => r.type_id))]))
    .all<{ id: string; fields: string }>();
  const fieldsOf = new Map(lists.map((l) => [l.id, JSON.parse(l.fields) as FieldDef[]]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return convertEffects(effects, (target, field) => {
    const row = byId.get(target);
    const def = row && fieldsOf.get(row.type_id)?.find((f) => f.key === field);
    if (!row || !def) return undefined;
    return measureOf(def, JSON.parse(row.data) as Attributes);
  });
}

/**
 * De aanpassingen als statements. Het doel moet een getal zijn dat de bewerker daar mag wijzigen; anders weigert
 * `strict` het bewaren (een nieuw of gewijzigd item), en anders (verwijderen) blijft dat item gewoon zoals het is.
 */
export async function effectStatements(db: D1Database, personId: string, changes: Applied[], strict: boolean): Promise<D1PreparedStatement[]> {
  const statements: D1PreparedStatement[] = [];
  for (const change of changes) {
    const row = await db.prepare("SELECT id, name, project_id, type_id FROM items WHERE id = ?").bind(change.target).first<{ id: string; name: string; project_id: string; type_id: string }>();
    if (!row) continue;
    const access = await projectAccess(db, personId, row.project_id);
    const type = access ? (await typesFor(db, access.chain)).find((t) => t.id === row.type_id) : undefined;
    const field = type?.fields.find((f) => f.key === change.field && f.type === "number");
    const allowed = access && type && field && typeAccess(access.rights, type.id) !== "none" && fieldAccess(access.rights, type.id, field.key) === "edit";
    if (!allowed) {
      if (strict) throw new ForbiddenError(`Dit past ${field ? `${field.label.toLowerCase()} van ` : ""}"${access && type ? row.name : "een ander item"}" aan, en dat mag je niet.`);
      continue;
    }
    statements.push(
      db
        .prepare(`UPDATE items SET data = json_set(data, ?2, round(coalesce(json_extract(data, ?2), 0) + ?3, 3)), updated_at = datetime('now') WHERE id = ?1`)
        .bind(row.id, `$.${field.key}`, change.delta),
    );
  }
  return statements;
}
