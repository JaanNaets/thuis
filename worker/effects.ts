// Verwijzingen die tellen (zie shared/effects.ts): de aanpassingen aan andere items nakijken en klaarzetten, samen met
// het bewaren van het item zelf (één batch, dus alles of niets).

import { fieldAccess, typeAccess, type Rights } from "../shared/access";
import { effectsOf, type Applied } from "../shared/effects";
import type { Attributes } from "../shared/fields";
import type { Item, ItemType } from "../shared/types";
import { withCalcs } from "./compute";
import { projectAccess, typesFor } from "./context";
import { ForbiddenError } from "./validate";

/** Wat een item met deze waarden aanpast, met de berekeningen (ook opzoekingen) zoals de bewerker ze ziet. */
export async function computeEffects(db: D1Database, personId: string, rights: Rights, type: ItemType, item: Pick<Item, "id" | "project_id">, data: Attributes) {
  if (!type.fields.some((f) => f.type === "item" && f.adjust)) return [];
  const temp = { ...item, type_id: type.id, name: "", tag_ids: [], data: { ...data } } as unknown as Item;
  await withCalcs(db, personId, type, rights, [temp]);
  return effectsOf(type.fields, temp.data);
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
