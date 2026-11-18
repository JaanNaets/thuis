import { syncFrom } from "../mirrors";
import { Hono } from "hono";
import { isIconKey } from "../../shared/icons";
import { cleanKindFields, cleanListFields } from "../../shared/listdef";
import { withSelf } from "../../shared/template-file";
import { BALANCE, cleanDoes, presetDoes, type ListColumns } from "../../shared/cells";
import { cleanLedger } from "../../shared/ledger";
import { BASES, baseParts, canEdit, fillsLists, isBase, type Base, type FormNode, type ListDetail, type ListNode, type Role, type Tag } from "../../shared/model";
import { cleanNotify } from "../../shared/alerts";
import { cleanReadPhoto } from "../../shared/photoread";
import { cleanStock } from "../../shared/stock";
import { isTone } from "../../shared/types";
import { ids, kindsFor, needEdit, needManage, requireList, seenForms, seenLists, toList, type ListRow } from "../access";
import { rebuildEffects } from "../cells";
import { touchesLists } from "../events-view";
import { addPerson, peopleOf, setPerson, tagsOn, tagStatements } from "../members";
import type { AppEnv } from "../types";
import { asObject, cleaned as clean, optionalString, requiredString, ValidationError } from "../validate";
import { columnsOf, goalOf, partsOf, plannedOf } from "./forms";

export const lists = new Hono<AppEnv>();

const MAX_KINDS = 30;

/** Al je lijsten (met je rol, tags en jouw volgorde), je formulieren en de tags die je ziet. */
export async function myLists(db: D1Database, personId: string): Promise<{ lists: ListNode[]; forms: FormNode[]; tags: Tag[] }> {
  const [seen, seenF] = await Promise.all([seenLists(db, personId), seenForms(db, personId)]);
  const list = ids(seen.keys());
  const formIds = ids(seenF.keys());
  const [rows, links, order, tags, formRows, formLinks] = (await db.batch([
    db.prepare("SELECT id, name, one, icon, color, archived, stock FROM lists WHERE id IN (SELECT value FROM json_each(?))").bind(list),
    db.prepare("SELECT list_id, tag_id FROM list_tag_links WHERE list_id IN (SELECT value FROM json_each(?))").bind(list),
    db.prepare("SELECT list_id, position FROM list_order WHERE person_id = ?").bind(personId),
    db
      .prepare(
        `SELECT DISTINCT t.id, t.name, t.color, t.created_by FROM list_tags t
         WHERE t.created_by = ?1 OR t.id IN (SELECT tag_id FROM list_tag_links WHERE list_id IN (SELECT value FROM json_each(?2)))
           OR t.id IN (SELECT tag_id FROM form_tag_links WHERE form_id IN (SELECT value FROM json_each(?3)))
         ORDER BY t.name COLLATE NOCASE`,
      )
      .bind(personId, list, formIds),
    db.prepare("SELECT id, name, icon, base, archived FROM kinds WHERE id IN (SELECT value FROM json_each(?))").bind(formIds),
    db.prepare("SELECT form_id, tag_id FROM form_tag_links WHERE form_id IN (SELECT value FROM json_each(?))").bind(formIds),
  ])) as [
    D1Result<{ id: string; name: string; one: string | null; icon: string | null; color: string | null; archived: number; stock: string | null }>,
    D1Result<{ list_id: string; tag_id: string }>,
    D1Result<{ list_id: string; position: number }>,
    D1Result<{ id: string; name: string; color: string | null; created_by: string }>,
    D1Result<{ id: string; name: string; icon: string | null; base: Base; archived: number }>,
    D1Result<{ form_id: string; tag_id: string }>,
  ];
  const tagsOf = new Map<string, string[]>();
  for (const l of links.results) tagsOf.set(l.list_id, [...(tagsOf.get(l.list_id) ?? []), l.tag_id]);
  const pos = new Map(order.results.map((o) => [o.list_id, o.position]));
  const nodes: ListNode[] = rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    one: r.one,
    icon: isIconKey(r.icon) ? r.icon : null,
    color: isTone(r.color) ? r.color : null,
    archived: r.archived ? 1 : 0,
    role: seen.get(r.id)!,
    tags: tagsOf.get(r.id) ?? [],
    stock: Boolean(r.stock),
    position: pos.get(r.id) ?? 1_000_000,
  }));
  nodes.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "nl"));
  const formTags = new Map<string, string[]>();
  for (const l of formLinks.results) formTags.set(l.form_id, [...(formTags.get(l.form_id) ?? []), l.tag_id]);
  const forms: FormNode[] = formRows.results
    .map((r) => ({
      id: r.id,
      name: r.name,
      icon: isIconKey(r.icon) ? r.icon : (BASES[r.base]?.icon ?? "note"),
      base: r.base,
      role: seenF.get(r.id)!,
      tags: formTags.get(r.id) ?? [],
      archived: (r.archived ? 1 : 0) as 0 | 1,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "nl"));
  return { lists: nodes, forms, tags: tags.results.map((t) => ({ ...t, color: isTone(t.color) ? t.color : null })) };
}

lists.get("/", async (c) => c.json(await myLists(c.env.DB, c.get("person").id)));

/** Een nieuwe lijst: jij bent beheerder; met tags komen ook de mensen van hun regels erbij. */
lists.post("/", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const body = asObject(await c.req.json());
  const name = requiredString(body, "name", 60);
  const id = crypto.randomUUID();
  // Uit een sjabloon: een verwijzing naar de lijst zelf ("self") wordt deze nieuwe lijst.
  const fields = withSelf(clean(() => cleanListFields(body.fields)), id);
  const one = optionalString(body, "one", 40);
  if (!one) throw new ValidationError("Hoe heet één item van deze lijst?");
  const stock = cleanStock(body.stock, fields);
  const ledger = cleanLedger(body.ledger, fields);
  const statements: D1PreparedStatement[] = [
    db
      .prepare("INSERT INTO lists (id, name, one, icon, color, fields, stock, ledger, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(
        id,
        name,
        one,
        isIconKey(body.icon) ? body.icon : null,
        isTone(body.color) ? body.color : null,
        JSON.stringify(fields),
        stock ? JSON.stringify(stock) : null,
        ledger ? JSON.stringify(ledger) : null,
        me.id,
      ),
    db.prepare("INSERT INTO list_people (list_id, person_id, role) VALUES (?, ?, 'beheerder')").bind(id, me.id),
  ];
  statements.push(...(await tagStatements(db, me.id, "list", id, body)));
  // Eigen soorten uit een sjabloon (Gegeten, Bijvulling).
  const rawKinds = Array.isArray(body.kinds) ? body.kinds.slice(0, MAX_KINDS) : [];
  // Formulieren uit het sjabloon: los van de lijst, met jou als beheerder en de tags van de lijst. Wat ze invullen:
  // kolommen van de nieuwe lijst zelf ("self") of van lijsten waarin jij items mag aanpassen.
  const seen = await seenLists(db, me.id);
  const columns: ListColumns[] = rawKinds.some((k) => Array.isArray(asObject(k).does) && (asObject(k).does as unknown[]).length)
    ? [{ id, name, stock: Boolean(stock), ledger: Boolean(ledger), fields }, ...(await columnsOf(db, seen, true))]
    : [];
  for (const raw of rawKinds) {
    const k = asObject(raw);
    if (!isBase(k.base)) throw new ValidationError("Onbekende basissoort");
    const kindFields = withSelf(clean(() => cleanKindFields(k.fields)), id);
    const rawDoes: unknown[] = Array.isArray(k.does) ? k.does : [];
    const does = clean(() => cleanDoes(rawDoes.map((h) => (asObject(h).list === "self" ? { ...asObject(h), list: id } : h)), columns, kindFields));
    const parts = k.parts === undefined ? null : partsOf(k.parts, k.base, seen, id);
    const formId = crypto.randomUUID();
    statements.push(
      db
        .prepare("INSERT INTO kinds (id, base, name, icon, fields, goal, planned, parts, does, notify, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(
          formId,
          k.base,
          requiredString(k, "name", 40),
          isIconKey(k.icon) ? k.icon : null,
          JSON.stringify(kindFields),
          goalOf(k, parts ?? baseParts(k.base)),
          plannedOf(k),
          parts ? JSON.stringify(parts) : null,
          does.length ? JSON.stringify(does) : null,
          JSON.stringify(cleanNotify(body.notify)),
          me.id,
        ),
      db.prepare("INSERT INTO form_people (form_id, person_id, role) VALUES (?, ?, 'beheerder')").bind(formId, me.id),
      db.prepare("INSERT INTO form_tag_links (form_id, tag_id) SELECT ?, tag_id FROM list_tag_links WHERE list_id = ?").bind(formId, id),
    );
  }
  await db.batch(statements);
  return c.json({ id }, 201);
});

lists.get("/:id", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { list, role } = await requireList(db, me.id, c.req.param("id"));
  const forms = await seenForms(db, me.id);
  // Het logboek van een lijst: wat haar items raakte (een lijn of een verandering van een cel, zie events-view.ts).
  const counts = await db
    .prepare(
      `SELECT (SELECT count(*) FROM items WHERE list_id = ?1 AND archived = 0) AS items,
              (SELECT count(*) FROM events e WHERE ${touchesLists("?2")} AND e.status != 'gepland') AS events,
              (SELECT count(*) FROM events e WHERE ${touchesLists("?2")} AND e.status = 'gepland') AS planned`,
    )
    .bind(list.id, ids([list.id]))
    .first<{ items: number; events: number; planned: number }>();
  // De formulieren die je ziet: die deze lijst invullen eerst.
  const all = await kindsFor(db, forms.keys());
  const fills = (k: (typeof all)[number]) => fillsLists(k).includes(list.id);
  const kinds = [...all.filter(fills), ...all.filter((k) => !fills(k))];
  const detail: ListDetail = {
    list,
    role,
    tags: await tagsOn(db, "list", list.id),
    people: await peopleOf(db, "list", list.id),
    kinds,
    counts: counts ?? { items: 0, events: 0, planned: 0 },
  };
  return c.json(detail);
});

lists.put("/:id", async (c) => {
  const db = c.env.DB;
  const { list, role } = await requireList(db, c.get("person").id, c.req.param("id"));
  needManage(role);
  const body = asObject(await c.req.json());
  const fields = body.fields === undefined ? list.fields : clean(() => cleanListFields(body.fields));
  const stock = body.stock === undefined ? list.stock : cleanStock(body.stock, fields);
  const notify = body.notify === undefined ? list.notify : cleanNotify(body.notify);
  const readPhoto = body.read_photo === undefined ? list.read_photo : cleanReadPhoto(body.read_photo);
  const ledger = body.ledger === undefined ? cleanLedger(list.ledger, fields) : cleanLedger(body.ledger, fields);
  await db
    .prepare("UPDATE lists SET name = ?, one = ?, icon = ?, color = ?, fields = ?, stock = ?, ledger = ?, notify = ?, read_photo = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(
      body.name === undefined ? list.name : requiredString(body, "name", 60),
      body.one === undefined ? list.one : optionalString(body, "one", 40),
      body.icon === undefined ? list.icon : isIconKey(body.icon) ? body.icon : null,
      body.color === undefined ? list.color : isTone(body.color) ? body.color : null,
      JSON.stringify(fields),
      stock ? JSON.stringify(stock) : null,
      ledger ? JSON.stringify(ledger) : null,
      notify ? JSON.stringify(notify) : null,
      readPhoto ? JSON.stringify(readPhoto) : null,
      list.id,
    )
    .run();
  // Een ander saldo per persoon: het geld dat erin telt opnieuw uitrekenen (in deze lijst, of met een formulier dat hier een saldo bijhoudt).
  if (JSON.stringify(ledger) !== JSON.stringify(list.ledger)) {
    const { results } = await db
      .prepare(
        `SELECT id FROM events WHERE amount IS NOT NULL AND paid_by IS NOT NULL
           AND kind IN (SELECT id FROM kinds WHERE instr(does, ?1) > 0)`,
      )
      .bind(list.id)
      .all<{ id: string }>();
    await rebuildEffects(
      db,
      results.map((r) => r.id),
    );
  }
  // Andere velden: wat uit deze lijst haalt of erin schrijft, opnieuw uitrekenen.
  await syncFrom(db, list.id, { asTarget: true });
  return c.json({ ok: true });
});

lists.put("/:id/archived", async (c) => {
  const db = c.env.DB;
  const { list, role } = await requireList(db, c.get("person").id, c.req.param("id"));
  needManage(role);
  const archived = asObject(await c.req.json()).archived === true ? 1 : 0;
  await db.prepare("UPDATE lists SET archived = ?, updated_at = datetime('now') WHERE id = ?").bind(archived, list.id).run();
  return c.json({ ok: true });
});

/** Een lijst verwijderen: met haar items. Lijnen naar haar items worden tekst; de formulieren en hun logboek blijven. */
lists.delete("/:id", async (c) => {
  const db = c.env.DB;
  const { list, role } = await requireList(db, c.get("person").id, c.req.param("id"));
  needManage(role);
  await db.batch([
    db.prepare("UPDATE lines SET text = (SELECT name FROM items WHERE items.id = lines.item_id), item_id = NULL WHERE item_id IN (SELECT id FROM items WHERE list_id = ?)").bind(list.id),
    db.prepare("DELETE FROM attachments WHERE owner_kind = 'item' AND owner_id IN (SELECT id FROM items WHERE list_id = ?)").bind(list.id),
    db.prepare("DELETE FROM lists WHERE id = ?").bind(list.id),
  ]);
  return c.body(null, 204);
});

lists.put("/:id/tags", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { list, role } = await requireList(db, me.id, c.req.param("id"));
  needManage(role, "Enkel een beheerder zet tags op deze lijst.");
  await db.batch(await tagStatements(db, me.id, "list", list.id, asObject(await c.req.json())));
  return c.json({ ok: true });
});

// ---------- terugbetalen ----------

/**
 * Het formulier om in deze lijst (met een saldo per persoon) een terugbetaling te loggen: een formulier dat je ziet en
 * waarmee je mag loggen, dat naar iemand gaat en het saldo hier aftrekt van wie krijgt. Is er geen, dan maakt het er een
 * (Terugbetaling, met jou als beheerder en de tags van de lijst).
 */
lists.post("/:id/settle-form", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { list, role } = await requireList(db, me.id, c.req.param("id"));
  needEdit(role);
  if (!list.ledger) throw new ValidationError("Deze lijst houdt geen saldo per persoon bij.");
  const forms = await seenForms(db, me.id);
  const editable = [...forms].filter(([, r]) => canEdit(r)).map(([id]) => id);
  const found = (await kindsFor(db, editable, true)).find(
    (k) => k.parts.to && k.does.some((h) => h.rows.from === "to" && h.list === list.id && h.field === BALANCE && h.op === "af"),
  );
  if (found) return c.json({ id: found.id });
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare("INSERT INTO kinds (id, base, name, icon, fields, parts, does, created_by) VALUES (?, 'overdracht', 'Terugbetaling', ?, '[]', ?, ?, ?)")
      .bind(id, BASES.overdracht.icon, JSON.stringify(baseParts("overdracht")), JSON.stringify(presetDoes("overdracht", list.id)), me.id),
    db.prepare("INSERT INTO form_people (form_id, person_id, role) VALUES (?, ?, 'beheerder')").bind(id, me.id),
    db.prepare("INSERT INTO form_tag_links (form_id, tag_id) SELECT ?, tag_id FROM list_tag_links WHERE list_id = ?").bind(id, list.id),
  ]);
  return c.json({ id }, 201);
});

// ---------- mensen ----------

/** Iemand toevoegen: een bestaande persoon (`person_id`) of een nieuwe met naam en e-mailadres. */
lists.post("/:id/people", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { list, role } = await requireList(db, me.id, c.req.param("id"));
  needManage(role, "Enkel een beheerder voegt mensen toe.");
  const personId = await addPerson(db, me.id, "list", list.id, asObject(await c.req.json()));
  return c.json({ person_id: personId }, 201);
});

/** Iemands rol rechtstreeks zetten (`role`), een uitzondering maken (`geen`) of de rechtstreekse rij weghalen (null). */
lists.put("/:id/people/:personId", async (c) => {
  const db = c.env.DB;
  const { list, role } = await requireList(db, c.get("person").id, c.req.param("id"));
  needManage(role, "Enkel een beheerder beheert de mensen.");
  await setPerson(db, "list", list.id, c.req.param("personId"), asObject(await c.req.json()).role);
  return c.json({ ok: true });
});

export type { Role };
export { toList, type ListRow };
export { findOrCreatePerson, knownPeople, peopleOf as listPeopleOf } from "../members";
