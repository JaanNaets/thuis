// Mensen en tags van een lijst of een formulier: allebei hebben ze dezelfde rollen (rechtstreeks of via een regel op
// een tag, zie access.ts) en dezelfde tags. Hier staat wat beide delen: de tags zetten, wie erbij is, iemand toevoegen
// of zijn rol zetten, en wie je kent.

import { canManage, fillsLists, isDirectRole, isRole, ROLES, type DirectRole, type ListPerson, type Tag } from "../shared/model";
import { keepsAdmin } from "../shared/rights";
import { isTone, type Person } from "../shared/types";
import { ids, kindsFor, rolesOf, SEEN, seenAll, seenForms, type Holder } from "./access";
import { ConflictError, idList, NotFoundError, optionalString, requiredString, ValidationError } from "./validate";

const MAX_TAGS = 12;

/** De tags die je ziet: die je maakte en die op een lijst of formulier staan dat je ziet. */
export async function seenTags(db: D1Database, personId: string): Promise<Tag[]> {
  const seen = await seenAll(db, personId);
  const { results } = await db
    .prepare(
      `SELECT t.id, t.name, t.color, t.created_by FROM list_tags t
       WHERE t.created_by = ?1 OR t.id IN (SELECT tag_id FROM list_tag_links WHERE list_id IN (SELECT value FROM json_each(?2)))
         OR t.id IN (SELECT tag_id FROM form_tag_links WHERE form_id IN (SELECT value FROM json_each(?3)))
       ORDER BY t.name COLLATE NOCASE`,
    )
    .bind(personId, ids(seen.lists.keys()), ids(seen.forms.keys()))
    .all<Tag>();
  return results.map((t) => ({ ...t, color: isTone(t.color) ? t.color : null }));
}

/** De tags op één lijst of formulier. */
export async function tagsOn(db: D1Database, what: Holder, id: string): Promise<Tag[]> {
  const t = SEEN[what];
  const { results } = await db
    .prepare(`SELECT t.id, t.name, t.color, t.created_by FROM list_tags t JOIN ${t.links} l ON l.tag_id = t.id WHERE l.${t.id} = ? ORDER BY t.name COLLATE NOCASE`)
    .bind(id)
    .all<Tag>();
  return results.map((r) => ({ ...r, color: isTone(r.color) ? r.color : null }));
}

/**
 * De tags van een lijst of formulier zetten: bestaande tags die je ziet (`tag_ids`) en nieuwe namen (`new_tags`). Een
 * tag met dezelfde naam die je al ziet, wordt hergebruikt.
 */
export async function tagStatements(db: D1Database, personId: string, what: Holder, id: string, body: Record<string, unknown>): Promise<D1PreparedStatement[]> {
  const t = SEEN[what];
  const wanted = idList(body, "tag_ids", MAX_TAGS);
  const names = Array.isArray(body.new_tags)
    ? [...new Set(body.new_tags.filter((n): n is string => typeof n === "string").map((n) => n.trim().slice(0, 40)).filter(Boolean))].slice(0, MAX_TAGS)
    : [];
  const tags = await seenTags(db, personId);
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const byName = new Map(tags.map((tag) => [tag.name.toLocaleLowerCase("nl"), tag]));
  const out: D1PreparedStatement[] = [db.prepare(`DELETE FROM ${t.links} WHERE ${t.id} = ?`).bind(id)];
  const chosen = new Set(wanted.filter((w) => byId.has(w)));
  for (const n of names) {
    const known = byName.get(n.toLocaleLowerCase("nl"));
    if (known) {
      chosen.add(known.id);
      continue;
    }
    const tagId = crypto.randomUUID();
    out.push(db.prepare("INSERT INTO list_tags (id, name, created_by) VALUES (?, ?, ?)").bind(tagId, n, personId));
    chosen.add(tagId);
  }
  if (chosen.size > MAX_TAGS) throw new ValidationError(`Hoogstens ${MAX_TAGS} tags`);
  for (const tag of chosen) out.push(db.prepare(`INSERT INTO ${t.links} (${t.id}, tag_id) VALUES (?, ?)`).bind(id, tag));
  return out;
}

/** Iedereen bij een lijst of formulier, met hoe (rechtstreeks of via een tag). */
export async function peopleOf(db: D1Database, what: Holder, id: string): Promise<ListPerson[]> {
  const { index, candidates } = await rolesOf(db, what, id);
  const people = index.people(id, candidates);
  if (!people.length) return [];
  const [persons, tags] = (await db.batch([
    db.prepare("SELECT id, name, email, color, iban FROM people WHERE id IN (SELECT value FROM json_each(?))").bind(ids(people.map((p) => p.person_id))),
    db.prepare("SELECT id, name FROM list_tags WHERE id IN (SELECT value FROM json_each(?))").bind(ids(people.flatMap((p) => (p.tag_id ? [p.tag_id] : [])))),
  ])) as [D1Result<Person>, D1Result<{ id: string; name: string }>];
  const byId = new Map(persons.results.map((p) => [p.id, p]));
  const tagName = new Map(tags.results.map((t) => [t.id, t.name]));
  return people
    .filter((p) => byId.has(p.person_id))
    .map((p) => ({
      person: { ...byId.get(p.person_id)!, iban: null },
      role: p.role ?? "gast",
      direct: p.direct,
      via: p.tag_id ? { tag_id: p.tag_id, tag: tagName.get(p.tag_id) ?? "" } : null,
    }))
    .sort((a, b) => (a.direct === "geen" ? 1 : 0) - (b.direct === "geen" ? 1 : 0) || a.person.name.localeCompare(b.person.name, "nl"));
}

/**
 * Iemand toevoegen met een rol: een bestaande persoon (`person_id`) of een nieuwe met naam en e-mailadres. Bij een lijst
 * komt die persoon ook bij de formulieren die de lijst invullen en die jij beheert (waar hij nog niet rechtstreeks
 * staat), met dezelfde rol: zo kan wie je bij Uitgaven zet, er meteen een aankoop loggen.
 */
export async function addPerson(db: D1Database, meId: string, what: Holder, id: string, body: Record<string, unknown>): Promise<string> {
  const t = SEEN[what];
  const wanted = body.role;
  if (!isRole(wanted)) throw new ValidationError(`Kies een rol: ${Object.values(ROLES).map((r) => r.label).join(", ")}`);
  const personId = await findOrCreatePerson(db, meId, body);
  const forms =
    what === "list"
      ? [...(await seenForms(db, meId))].filter(([, r]) => canManage(r)).map(([f]) => f)
      : [];
  const filling = forms.length ? (await kindsFor(db, forms)).filter((k) => fillsLists(k).includes(id)).map((k) => k.id) : [];
  await db.batch([
    db
      .prepare(`INSERT INTO ${t.people} (${t.id}, person_id, role) VALUES (?, ?, ?) ON CONFLICT (${t.id}, person_id) DO UPDATE SET role = excluded.role`)
      .bind(id, personId, wanted),
    ...filling.map((f) => db.prepare("INSERT INTO form_people (form_id, person_id, role) VALUES (?, ?, ?) ON CONFLICT (form_id, person_id) DO NOTHING").bind(f, personId, wanted)),
  ]);
  return personId;
}

/** Iemands rol rechtstreeks zetten (`role`), een uitzondering maken (`geen`) of de rechtstreekse rij weghalen (null). */
export async function setPerson(db: D1Database, what: Holder, id: string, personId: string, wanted: unknown) {
  const t = SEEN[what];
  if (wanted !== null && !isDirectRole(wanted)) throw new ValidationError("Onbekende rol");
  const { results } = await db.prepare(`SELECT person_id, role FROM ${t.people} WHERE ${t.id} = ?`).bind(id).all<{ person_id: string; role: DirectRole }>();
  const after = results.filter((r) => r.person_id !== personId).map((r) => ({ role: r.role }));
  if (wanted) after.push({ role: wanted as DirectRole });
  if (!keepsAdmin(after)) throw new ConflictError("Er moet altijd iemand rechtstreeks beheerder blijven.");
  if (wanted === null) await db.prepare(`DELETE FROM ${t.people} WHERE ${t.id} = ? AND person_id = ?`).bind(id, personId).run();
  else
    await db
      .prepare(`INSERT INTO ${t.people} (${t.id}, person_id, role) VALUES (?, ?, ?) ON CONFLICT (${t.id}, person_id) DO UPDATE SET role = excluded.role`)
      .bind(id, personId, wanted)
      .run();
}

/** Een persoon die je kent (`person_id`), of een nieuwe; bestaat het e-mailadres al, dan is het die persoon. */
export async function findOrCreatePerson(db: D1Database, meId: string, body: Record<string, unknown>): Promise<string> {
  const known = optionalString(body, "person_id", 64);
  if (known) {
    const mine = await knownPeople(db, meId);
    if (!mine.some((p) => p.id === known)) throw new NotFoundError("Die persoon ken je niet.");
    return known;
  }
  const name = requiredString(body, "name", 60);
  const email = optionalString(body, "email", 200)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Dat e-mailadres klopt niet");
  if (email) {
    const existing = await db.prepare("SELECT id FROM people WHERE email = ?").bind(email).first<{ id: string }>();
    if (existing) return existing.id;
  }
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO people (id, name, email, created_by) VALUES (?, ?, ?, ?)").bind(id, name, email, meId).run();
  return id;
}

/** Wie je kent: jezelf, wie je toevoegde, en iedereen bij een lijst of formulier dat je ziet (ook via regels). */
export async function knownPeople(db: D1Database, meId: string): Promise<Person[]> {
  const seen = await seenAll(db, meId);
  const { results } = await db
    .prepare(
      `SELECT id, name, email, color, NULL AS iban FROM people WHERE id = ?1 OR created_by = ?1
         OR id IN (SELECT person_id FROM list_people WHERE list_id IN (SELECT value FROM json_each(?2)) AND role != 'geen')
         OR id IN (SELECT r.person_id FROM tag_rules r JOIN list_tag_links l ON l.tag_id = r.tag_id WHERE l.list_id IN (SELECT value FROM json_each(?2)))
         OR id IN (SELECT person_id FROM form_people WHERE form_id IN (SELECT value FROM json_each(?3)) AND role != 'geen')
         OR id IN (SELECT r.person_id FROM tag_rules r JOIN form_tag_links l ON l.tag_id = r.tag_id WHERE l.form_id IN (SELECT value FROM json_each(?3)))
       ORDER BY name COLLATE NOCASE`,
    )
    .bind(meId, ids(seen.lists.keys()), ids(seen.forms.keys()))
    .all<Person>();
  return results;
}
