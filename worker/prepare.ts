// Velden van een ding of gebeurtenis nakijken voor ze in de databank komen: `cleanAttributes` (shared/fields.ts),
// daarna personen die je kent en verwijzingen naar dingen die bestaan, die je ziet en in een lijst staan waarnaar
// het veld mag wijzen. Wat niet klopt, valt weg; een verwijzing die er al stond naar iets dat jij niet ziet, blijft.

import { cleanAttributes, missingRequired, referencedItems, referencedPeople, refLists, type AmountEntry, type Attributes, type FieldDef, type Share } from "../shared/fields";
import type { Role } from "../shared/model";
import { ids } from "./access";
import { knownPeople } from "./routes/lists";
import { ValidationError } from "./validate";

export async function prepareData(
  db: D1Database,
  meId: string,
  seen: Map<string, Role>,
  fields: FieldDef[],
  raw: unknown,
  before: Attributes = {},
): Promise<Attributes> {
  const data = cleanAttributes(fields, raw);
  const people = referencedPeople(fields, data);
  if (people.length) {
    const known = new Set((await knownPeople(db, meId)).map((p) => p.id));
    const keep = new Set(referencedPeople(fields, before));
    const ok = (id: string) => known.has(id) || keep.has(id);
    for (const f of fields) {
      const v = data[f.key];
      if (f.type === "person" && typeof v === "string" && !ok(v)) delete data[f.key];
      if (f.type === "people" && Array.isArray(v)) data[f.key] = (v as string[]).filter(ok);
      if (f.type === "share" && Array.isArray(v) && (v as Share[]).some((s) => !ok(s.person_id))) delete data[f.key];
    }
  }
  const refs = referencedItems(fields, data);
  if (refs.length) {
    const { results } = await db
      .prepare("SELECT id, list_id FROM things WHERE id IN (SELECT value FROM json_each(?))")
      .bind(ids(refs.map((r) => r.id)))
      .all<{ id: string; list_id: string }>();
    const listOf = new Map(results.map((r) => [r.id, r.list_id]));
    const kept = new Set(referencedItems(fields, before).map((r) => r.id));
    const valid = (id: string, f: FieldDef) => {
      if (kept.has(id)) return true;
      const list = listOf.get(id);
      return Boolean(list && seen.has(list) && refLists(f).includes(list));
    };
    for (const f of fields) {
      const v = data[f.key];
      if (f.type === "item" && typeof v === "string" && !valid(v, f)) delete data[f.key];
      if (f.type === "items" && Array.isArray(v)) data[f.key] = (v as string[]).filter((id) => valid(id, f));
      if (f.type === "amounts" && Array.isArray(v)) {
        data[f.key] = (v as AmountEntry[]).map((e) => (e.item && !valid(e.item, f) ? { ...e, item: undefined } : e)).filter((e) => e.item || e.text);
      }
    }
  }
  const missing = missingRequired(fields, data);
  if (missing.length) throw new ValidationError(`Vul ${missing.map((f) => f.label).join(", ")} in`);
  return data;
}
