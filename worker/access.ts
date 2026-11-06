// Wie wat mag in het nieuwe model: per lijst een rol (rechtstreeks of via een regel van een tag, zie
// shared/rights.ts). Elke route die iets van een lijst raakt, haalt eerst de toegang op met `requireList`,
// `requireThing` of `requireEvent`. Geen toegang = 404 "niet gevonden"; ontbreekt een recht, dan `needEdit` of
// `needManage`. Bij twijfel: weigeren.

import type { FieldDef } from "../shared/fields";
import { isIconKey } from "../shared/icons";
import { cleanNotify } from "../shared/alerts";
import {
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
  type Thing,
} from "../shared/model";
import { Roles, type DirectRow, type RuleRow, type TagLink } from "../shared/rights";
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

export type ListRow = Omit<List, "fields" | "stock" | "notify" | "icon" | "color"> & {
  fields: string;
  stock: string | null;
  notify: string | null;
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
    notify: cleanNotify(parseJson(row.notify, null)),
    archived: row.archived ? 1 : 0,
    created_at: row.created_at,
  };
}

export type ThingRowDb = Omit<Thing, "data"> & { data: string };
export const toThing = (row: ThingRowDb): Thing => ({ ...row, data: parseJson(row.data, {}), archived: row.archived ? 1 : 0 });

export type EventRowDb = Omit<Event, "data" | "split" | "repeat"> & { data: string; split: string | null; repeat: string | null };
export const toEvent = (row: EventRowDb): Event => ({
  ...row,
  data: parseJson(row.data, {}),
  split: parseJson(row.split, null),
  repeat: parseJson(row.repeat, null),
});

export type LineRowDb = Line & { event_id: string };
export const toLine = ({ event_id: _e, ...l }: LineRowDb): Line => l;

export type KindRowDb = Omit<Kind, "fields" | "icon"> & { fields: string; icon: string | null };
export const toKind = (row: KindRowDb): Kind => ({
  ...row,
  base: row.base as Base,
  icon: isIconKey(row.icon) ? row.icon : null,
  fields: parseJson<FieldDef[]>(row.fields, []),
});

// ---------- rollen ----------

/**
 * Al je lijsten met je rol: rechtstreeks, of via een regel op een tag (enkel waar wie de regel maakte rechtstreeks
 * beheerder is). Rechtstreeks wint, ook `geen`. Met `only`: enkel die lijst.
 */
export async function seenLists(db: D1Database, personId: string, only?: string): Promise<Map<string, Role>> {
  const filter = only ? "AND x.list_id = ?2" : "";
  const { results } = await db
    .prepare(
      `SELECT x.* FROM (
         SELECT lp.list_id, lp.role, NULL AS tag_id FROM list_people lp WHERE lp.person_id = ?1
         UNION ALL
         SELECT ltl.list_id, r.role, r.tag_id FROM tag_rules r
           JOIN list_tag_links ltl ON ltl.tag_id = r.tag_id
           JOIN list_people c ON c.list_id = ltl.list_id AND c.person_id = r.created_by AND c.role = 'beheerder'
         WHERE r.person_id = ?1
       ) x WHERE 1 = 1 ${filter}`,
    )
    .bind(...(only ? [personId, only] : [personId]))
    .all<{ list_id: string; role: DirectRole; tag_id: string | null }>();
  const direct = new Map<string, DirectRole>();
  const rule = new Map<string, Role>();
  for (const r of results) {
    if (r.tag_id === null) direct.set(r.list_id, r.role);
    else if (r.role !== "geen") {
      const had = rule.get(r.list_id);
      if (!had || ROLE_RANK[r.role] > ROLE_RANK[had]) rule.set(r.list_id, r.role);
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

/** De index van rollen voor één lijst (rechtstreeks en de regels van haar tags), om iedereen erop te zien. */
export async function listRoles(db: D1Database, listId: string): Promise<{ index: Roles; candidates: string[] }> {
  const [direct, links, rules] = (await db.batch([
    db.prepare("SELECT list_id, person_id, role FROM list_people WHERE list_id = ?").bind(listId),
    db.prepare("SELECT list_id, tag_id FROM list_tag_links WHERE list_id = ?").bind(listId),
    db
      .prepare("SELECT r.tag_id, r.person_id, r.role, r.created_by FROM tag_rules r JOIN list_tag_links l ON l.tag_id = r.tag_id WHERE l.list_id = ?")
      .bind(listId),
  ])) as [D1Result<DirectRow>, D1Result<TagLink>, D1Result<RuleRow>];
  const index = new Roles(direct.results, links.results, rules.results);
  return { index, candidates: [...direct.results.map((d) => d.person_id), ...rules.results.map((r) => r.person_id)] };
}

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

export type ThingAccess = { thing: Thing; list: List; role: Role };

export async function requireThing(db: D1Database, personId: string, thingId: string): Promise<ThingAccess> {
  const row = await db.prepare("SELECT * FROM things WHERE id = ?").bind(thingId).first<ThingRowDb>();
  if (!row) throw new NotFoundError("Dat bestaat niet (meer), of je kan er niet bij.");
  const { list, role } = await requireList(db, personId, row.list_id).catch(() => {
    throw new NotFoundError("Dat bestaat niet (meer), of je kan er niet bij.");
  });
  return { thing: toThing(row), list, role };
}

/** De soorten die je kan gebruiken: de basissoorten en de eigen soorten van de lijsten die je ziet. */
export async function kindsFor(db: D1Database, listIds: Iterable<string>): Promise<KindInfo[]> {
  const { results } = await db
    .prepare("SELECT * FROM kinds WHERE list_id IN (SELECT value FROM json_each(?)) ORDER BY sort_order, name")
    .bind(ids(listIds))
    .all<KindRowDb>();
  const bases = (["aankoop", "gebruik", "dienst", "activiteit", "meting", "overdracht"] as const).map(baseKind);
  return [...bases, ...results.map(toKind).map(kindInfo)];
}

/** De soort van een gebeurtenis (wie de gebeurtenis ziet, ziet ook de definitie van haar soort). */
export async function kindOf(db: D1Database, kind: string, base: Base): Promise<KindInfo> {
  if (isBase(kind)) return baseKind(kind);
  const row = await db.prepare("SELECT * FROM kinds WHERE id = ?").bind(kind).first<KindRowDb>();
  return row ? kindInfo(toKind(row)) : baseKind(base);
}

export const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(", ");
