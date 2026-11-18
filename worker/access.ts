// Wie wat mag in het nieuwe model: per lijst een rol (rechtstreeks of via een regel van een tag, zie
// shared/rights.ts). Elke route die iets van een lijst raakt, haalt eerst de toegang op met `requireList`,
// `requireItem` of `requireEvent`. Geen toegang = 404 "niet gevonden"; ontbreekt een recht, dan `needEdit` of
// `needManage`. Bij twijfel: weigeren.

import type { FieldDef } from "../shared/fields";
import { isIconKey } from "../shared/icons";
import { cleanNotify } from "../shared/alerts";
import { cleanReadPhoto } from "../shared/photoread";
import { ADJUST, readDoes } from "../shared/cells";
import {
  ADJUST_KIND,
  cleanParts,
  baseKind,
  canEdit,
  canManage,
  isBase,
  kindInfo,
  ROLE_RANK,
  type Base,
  type DirectRole,
  type Event,
  type Kind,
  type KindInfo,
  type Line,
  type List,
  type Role,
  type Item,
} from "../shared/model";
import { Roles, type DirectRow, type RuleRow, type TagLink } from "../shared/rights";
import { cleanLedger } from "../shared/ledger";
import { cleanStock } from "../shared/stock";
import { isTone } from "../shared/types";
import { ForbiddenError, NotFoundError } from "./validate";

export const parseJson = <T>(text: string | null | undefined, fallback: T): T => {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

/** Een lijst van ids als één parameter (voor `IN (SELECT value FROM json_each(?))`). */
export const ids = (values: Iterable<string>) => JSON.stringify([...new Set(values)]);

// ---------- rijen ----------

export type ListRow = Omit<List, "fields" | "stock" | "ledger" | "notify" | "read_photo" | "icon" | "color"> & {
  fields: string;
  stock: string | null;
  ledger: string | null;
  notify: string | null;
  read_photo: string | null;
  icon: string | null;
  color: string | null;
  created_by: string;
};

export function toList(row: ListRow): List {
  const fields = parseJson<FieldDef[]>(row.fields, []);
  return {
    id: row.id,
    name: row.name,
    one: row.one,
    icon: isIconKey(row.icon) ? row.icon : null,
    color: isTone(row.color) ? row.color : null,
    fields,
    stock: row.stock ? cleanStock(parseJson(row.stock, null), fields) : null,
    ledger: cleanLedger(parseJson(row.ledger, null), fields),
    notify: cleanNotify(parseJson(row.notify, null)),
    read_photo: cleanReadPhoto(parseJson(row.read_photo, null)),
    archived: row.archived ? 1 : 0,
    created_at: row.created_at,
  };
}

export type ItemRowDb = Omit<Item, "data"> & { data: string };
export const toItem = (row: ItemRowDb): Item => ({ ...row, data: parseJson(row.data, {}), archived: row.archived ? 1 : 0 });

export type EventRowDb = Omit<Event, "data" | "split" | "repeat"> & { data: string; split: string | null; repeat: string | null };
export const toEvent = (row: EventRowDb): Event => ({
  ...row,
  data: parseJson(row.data, {}),
  split: parseJson(row.split, null),
  repeat: parseJson(row.repeat, null),
});

/** Een lijn uit de databank: haar groep staat in `grp` (van vroeger leeg: haar rol). */
export type LineRowDb = Omit<Line, "group"> & { event_id: string; grp: string | null };
export const toLine = ({ event_id: _e, grp, ...l }: LineRowDb): Line => ({ ...l, group: grp || l.role });

export type KindRowDb = Omit<Kind, "fields" | "icon" | "planned" | "does" | "parts" | "notify" | "reads" | "archived"> & {
  fields: string;
  icon: string | null;
  planned: number;
  does: string | null;
  parts: string | null;
  notify: string | null;
  reads: number | null;
  archived: number;
};
export const toKind = (row: KindRowDb): Kind => ({
  id: row.id,
  base: row.base as Base,
  name: row.name,
  icon: isIconKey(row.icon) ? row.icon : null,
  fields: parseJson<FieldDef[]>(row.fields, []),
  goal: row.goal,
  planned: row.planned === 1,
  parts: row.parts ? cleanParts(parseJson(row.parts, null)) : null,
  does: readDoes(parseJson(row.does, [])),
  notify: cleanNotify(parseJson(row.notify, null)),
  reads: row.reads === null || row.reads === undefined ? null : row.reads === 1,
  archived: row.archived ? 1 : 0,
  created_by: row.created_by,
  created_at: row.created_at,
});

// ---------- rollen ----------

/** Lijsten en formulieren hebben dezelfde rollen: rechtstreeks (`…_people`) of via een regel op een tag (`…_tag_links`). */
export const SEEN = {
  list: { people: "list_people", id: "list_id", links: "list_tag_links" },
  form: { people: "form_people", id: "form_id", links: "form_tag_links" },
} as const;

/**
 * Je rol op alle lijsten (of formulieren) waar je bij kan: rechtstreeks, of via een regel op een tag (enkel waar wie de
 * regel maakte rechtstreeks beheerder is). Rechtstreeks wint, ook `geen`. Met `only`: enkel die ene.
 */
export type Holder = keyof typeof SEEN;

async function seenOf(db: D1Database, what: Holder, personId: string, only?: string): Promise<Map<string, Role>> {
  const t = SEEN[what];
  const filter = only ? "AND x.obj = ?2" : "";
  const { results } = await db
    .prepare(
      `SELECT x.* FROM (
         SELECT p.${t.id} AS obj, p.role, NULL AS tag_id FROM ${t.people} p WHERE p.person_id = ?1
         UNION ALL
         SELECT ltl.${t.id} AS obj, r.role, r.tag_id FROM tag_rules r
           JOIN ${t.links} ltl ON ltl.tag_id = r.tag_id
           JOIN ${t.people} c ON c.${t.id} = ltl.${t.id} AND c.person_id = r.created_by AND c.role = 'beheerder'
         WHERE r.person_id = ?1
       ) x WHERE 1 = 1 ${filter}`,
    )
    .bind(...(only ? [personId, only] : [personId]))
    .all<{ obj: string; role: DirectRole; tag_id: string | null }>();
  const direct = new Map<string, DirectRole>();
  const rule = new Map<string, Role>();
  for (const r of results) {
    if (r.tag_id === null) direct.set(r.obj, r.role);
    else if (r.role !== "geen") {
      const had = rule.get(r.obj);
      if (!had || ROLE_RANK[r.role] > ROLE_RANK[had]) rule.set(r.obj, r.role);
    }
  }
  const out = new Map<string, Role>();
  for (const id of new Set([...direct.keys(), ...rule.keys()])) {
    const d = direct.get(id);
    if (d === "geen") continue;
    const role = d ?? rule.get(id);
    if (role) out.set(id, role);
  }
  return out;
}

/** Al je lijsten met je rol (zie `seenOf`). */
export const seenLists = (db: D1Database, personId: string, only?: string) => seenOf(db, "list", personId, only);
/** Al je formulieren met je rol (zie `seenOf`). */
export const seenForms = (db: D1Database, personId: string, only?: string) => seenOf(db, "form", personId, only);

/** Wat iemand ziet: lijsten (en hun items) en formulieren (en hun logboek), met een rol op elk. */
export type Seen = { lists: Map<string, Role>; forms: Map<string, Role> };
export async function seenAll(db: D1Database, personId: string): Promise<Seen> {
  const [lists, forms] = await Promise.all([seenLists(db, personId), seenForms(db, personId)]);
  return { lists, forms };
}

/** De index van rollen voor één lijst of formulier (rechtstreeks en de regels van zijn tags), om iedereen erop te zien. */
export async function rolesOf(db: D1Database, what: Holder, id: string): Promise<{ index: Roles; candidates: string[] }> {
  const t = SEEN[what];
  const [direct, links, rules] = (await db.batch([
    db.prepare(`SELECT ${t.id} AS list_id, person_id, role FROM ${t.people} WHERE ${t.id} = ?`).bind(id),
    db.prepare(`SELECT ${t.id} AS list_id, tag_id FROM ${t.links} WHERE ${t.id} = ?`).bind(id),
    db.prepare(`SELECT r.tag_id, r.person_id, r.role, r.created_by FROM tag_rules r JOIN ${t.links} l ON l.tag_id = r.tag_id WHERE l.${t.id} = ?`).bind(id),
  ])) as [D1Result<DirectRow>, D1Result<TagLink>, D1Result<RuleRow>];
  const index = new Roles(direct.results, links.results, rules.results);
  return { index, candidates: [...direct.results.map((d) => d.person_id), ...rules.results.map((r) => r.person_id)] };
}

export const listRoles = (db: D1Database, listId: string) => rolesOf(db, "list", listId);
export const formRoles = (db: D1Database, formId: string) => rolesOf(db, "form", formId);

// ---------- vereisten ----------

export type ListAccess = { list: List; role: Role; created_by: string };

/** De lijst en jouw rol erop; "niet gevonden" als je er niet bij kan (we verklappen niet of ze bestaat). */
export async function requireList(db: D1Database, personId: string, listId: string): Promise<ListAccess> {
  const role = (await seenLists(db, personId, listId)).get(listId);
  if (!role) throw new NotFoundError("Die lijst bestaat niet (meer), of je kan er niet bij.");
  const row = await db.prepare("SELECT * FROM lists WHERE id = ?").bind(listId).first<ListRow>();
  if (!row) throw new NotFoundError("Die lijst bestaat niet (meer), of je kan er niet bij.");
  return { list: toList(row), role, created_by: row.created_by };
}

export function needEdit(role: Role | null | undefined, message = "Je mag in deze lijst enkel kijken.") {
  if (!canEdit(role)) throw new ForbiddenError(message);
}

export function needManage(role: Role | null | undefined, message = "Enkel een beheerder kan deze lijst instellen.") {
  if (!canManage(role)) throw new ForbiddenError(message);
}

export type ItemAccess = { item: Item; list: List; role: Role };

export async function requireItem(db: D1Database, personId: string, itemId: string): Promise<ItemAccess> {
  const row = await db.prepare("SELECT * FROM items WHERE id = ?").bind(itemId).first<ItemRowDb>();
  if (!row) throw new NotFoundError("Dat bestaat niet (meer), of je kan er niet bij.");
  const { list, role } = await requireList(db, personId, row.list_id).catch(() => {
    throw new NotFoundError("Dat bestaat niet (meer), of je kan er niet bij.");
  });
  return { item: toItem(row), list, role };
}

/** De formulieren met deze ids (die je ziet), zoals een gebeurtenis ze gebruikt; `open`: zonder de gearchiveerde. */
export async function kindsFor(db: D1Database, formIds: Iterable<string>, open = false): Promise<KindInfo[]> {
  const { results } = await db
    .prepare(`SELECT * FROM kinds WHERE id IN (SELECT value FROM json_each(?)) ${open ? "AND archived = 0" : ""} ORDER BY name COLLATE NOCASE`)
    .bind(ids(formIds))
    .all<KindRowDb>();
  return results.map(toKind).map(kindInfo);
}

/** Het formulier van een gebeurtenis (wie de gebeurtenis ziet, ziet ook de definitie van haar formulier). */
export async function kindOf(db: D1Database, kind: string, base: Base): Promise<KindInfo> {
  if (kind === ADJUST) return ADJUST_KIND;
  const row = await db.prepare("SELECT * FROM kinds WHERE id = ?").bind(kind).first<KindRowDb>();
  return row ? kindInfo(toKind(row)) : isBase(kind) ? baseKind(kind) : baseKind(base);
}

export type FormAccess = { kind: Kind; form: KindInfo; role: Role };

/** Een formulier en jouw rol erop; "niet gevonden" als je er niet bij kan. */
export async function requireForm(db: D1Database, personId: string, formId: string): Promise<FormAccess> {
  const role = (await seenForms(db, personId, formId)).get(formId);
  if (!role) throw new NotFoundError("Dat formulier bestaat niet (meer), of je kan er niet bij.");
  const row = await db.prepare("SELECT * FROM kinds WHERE id = ?").bind(formId).first<KindRowDb>();
  if (!row) throw new NotFoundError("Dat formulier bestaat niet (meer), of je kan er niet bij.");
  const kind = toKind(row);
  return { kind, form: kindInfo(kind), role };
}

export const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(", ");
