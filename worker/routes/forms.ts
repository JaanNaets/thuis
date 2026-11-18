// Formulieren: los van de lijsten, met eigen mensen en tags (dezelfde rollen als een lijst, zie access.ts) en een eigen
// logboek (alles wat ermee gelogd werd, zie events.ts → formEvents). Wat een formulier invult, zeggen zijn groepen
// lijnen en handelingen (`parts`, `does`): daarvoor moet je de lijst zien, en wat het in een lijst aanpast, moet je
// er mogen aanpassen.

import { Hono } from "hono";
import { cleanNotify } from "../../shared/alerts";
import { cleanDoes, type Handeling, type ListColumns } from "../../shared/cells";
import type { FieldDef } from "../../shared/fields";
import { isIconKey } from "../../shared/icons";
import { cleanKindFields } from "../../shared/listdef";
import { baseParts, canEdit, cleanParts, isBase, type Base, type FormDetail, type Parts, type Role } from "../../shared/model";
import { ids, needManage, parseJson, requireForm, seenLists } from "../access";
import { rebuildEffects } from "../cells";
import { addPerson, peopleOf, setPerson, tagsOn, tagStatements } from "../members";
import type { AppEnv } from "../types";
import { asObject, cleaned, requiredString, ValidationError } from "../validate";

export const forms = new Hono<AppEnv>();

/** Het doel in minuten van iets dat loopt (een formulier met een einde: een timer), of null. */
export const goalOf = (o: Record<string, unknown>, parts: Parts): number | null =>
  parts.duration && typeof o.goal === "number" && Number.isInteger(o.goal) && o.goal > 0 && o.goal < 100_000 ? o.goal : null;

/**
 * De onderdelen van een formulier: wat binnenkomt (nagekeken; een groep uit een lijst enkel uit een lijst die je ziet),
 * anders die van het vertrekpunt. `self`: een nieuwe lijst uit een sjabloon, waarnaar "self" verwijst.
 */
export function partsOf(raw: unknown, base: Base, seen: Map<string, Role>, self?: string): Parts {
  const parts = cleanParts(raw) ?? baseParts(base);
  return {
    ...parts,
    groups: parts.groups.map((g) => (self && g.list === "self" ? { ...g, list: self } : g)).filter((g) => !g.list || g.list === self || seen.has(g.list)),
  };
}

/** Begint een nieuwe gebeurtenis met dit formulier gepland (een boodschap)? Als 0 of 1 voor de databank. */
export const plannedOf = (o: Record<string, unknown>): number => (o.planned === true ? 1 : 0);

/** Leest dit formulier een foto: aan, uit of de standaard (null). Als 1, 0 of null voor de databank. */
const readsOf = (o: Record<string, unknown>): number | null => (o.reads === true ? 1 : o.reads === false ? 0 : null);

/**
 * De lijsten met hun kolommen: welke die je ziet (`edit`: enkel waar je items mag aanpassen), om handelingen van een
 * formulier te kiezen en na te kijken (shared/cells.ts).
 */
export async function columnsOf(db: D1Database, seen: Map<string, Role>, edit: boolean): Promise<ListColumns[]> {
  const wanted = [...seen].filter(([, r]) => !edit || canEdit(r)).map(([id]) => id);
  const { results } = await db
    .prepare("SELECT id, name, fields, stock, ledger FROM lists WHERE archived = 0 AND one IS NOT NULL AND id IN (SELECT value FROM json_each(?)) ORDER BY name COLLATE NOCASE")
    .bind(ids(wanted))
    .all<{ id: string; name: string; fields: string; stock: string | null; ledger: string | null }>();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    stock: Boolean(r.stock),
    ledger: Boolean(r.ledger),
    fields: parseJson<FieldDef[]>(r.fields, []).map((f) => ({ key: f.key, label: f.label, type: f.type, ...(f.unit ? { unit: f.unit } : {}) })),
  }));
}

/** Wat de gebeurtenissen met dit formulier doen opnieuw uitrekenen (het formulier veranderde). */
async function rebuildForm(db: D1Database, formId: string) {
  const { results } = await db.prepare("SELECT id FROM events WHERE kind = ?").bind(formId).all<{ id: string }>();
  await rebuildEffects(
    db,
    results.map((r) => r.id),
  );
}

/** Een nieuw formulier: jij bent beheerder; met tags komen ook de mensen van hun regels erbij. */
forms.post("/", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const body = asObject(await c.req.json());
  if (!isBase(body.base)) throw new ValidationError("Kies een vertrekpunt");
  const id = crypto.randomUUID();
  const seen = await seenLists(db, me.id);
  const fields = cleaned(() => cleanKindFields(body.fields));
  const wantsDoes = Array.isArray(body.does) && body.does.length > 0;
  const editable = wantsDoes ? await columnsOf(db, seen, true) : [];
  const checked = wantsDoes ? cleaned(() => cleanDoes(body.does, editable, fields)) : [];
  const parts = body.parts === undefined ? null : partsOf(body.parts, body.base, seen);
  await db.batch([
    db
      .prepare("INSERT INTO kinds (id, base, name, icon, fields, goal, planned, parts, does, notify, reads, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(
        id,
        body.base,
        requiredString(body, "name", 40),
        isIconKey(body.icon) ? body.icon : null,
        JSON.stringify(fields),
        goalOf(body, parts ?? baseParts(body.base)),
        plannedOf(body),
        parts ? JSON.stringify(parts) : null,
        checked.length ? JSON.stringify(checked) : null,
        JSON.stringify(cleanNotify(body.notify)),
        readsOf(body),
        me.id,
      ),
    db.prepare("INSERT INTO form_people (form_id, person_id, role) VALUES (?, ?, 'beheerder')").bind(id, me.id),
    ...(await tagStatements(db, me.id, "form", id, body)),
  ]);
  return c.json({ id }, 201);
});

forms.get("/:id", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { kind, form, role } = await requireForm(db, me.id, c.req.param("id"));
  const counts = await db
    .prepare(
      `SELECT (SELECT count(*) FROM events WHERE kind = ?1 AND status != 'gepland') AS events,
              (SELECT count(*) FROM events WHERE kind = ?1 AND status = 'gepland') AS planned`,
    )
    .bind(kind.id)
    .first<{ events: number; planned: number }>();
  const detail: FormDetail = {
    form,
    role,
    tags: await tagsOn(db, "form", kind.id),
    people: await peopleOf(db, "form", kind.id),
    notify: kind.notify,
    archived: kind.archived,
    counts: counts ?? { events: 0, planned: 0 },
  };
  return c.json(detail);
});

forms.put("/:id", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { kind, role } = await requireForm(db, me.id, c.req.param("id"));
  needManage(role, "Enkel een beheerder past dit formulier aan.");
  const body = asObject(await c.req.json());
  const fields = body.fields === undefined ? kind.fields : cleaned(() => cleanKindFields(body.fields));
  const seen = await seenLists(db, me.id);
  // Groepen uit een lijst die je niet (meer) ziet, blijven staan als je ze niet aanraakt.
  const parts = body.parts === undefined ? kind.parts : keepUnseen(kind.parts, partsOf(body.parts, kind.base, seen), seen);
  // Handelingen die al bestonden in een lijst waar jij niets mag aanpassen, blijven; nieuwe moeten jouw lijsten zijn.
  let does: Handeling[] = kind.does;
  if (body.does !== undefined) {
    const editable = await columnsOf(db, seen, true);
    const raw = Array.isArray(body.does) ? body.does : [];
    const kept = kind.does.filter((h) => h.list && !editable.some((l) => l.id === h.list) && raw.some((r) => JSON.stringify(r) === JSON.stringify(h)));
    const fresh = raw.filter((r) => !kept.some((h) => JSON.stringify(r) === JSON.stringify(h)));
    does = [...kept, ...cleaned(() => cleanDoes(fresh, editable, fields))];
  }
  const after = parts ?? baseParts(kind.base);
  await db
    .prepare("UPDATE kinds SET name = ?, icon = ?, fields = ?, goal = ?, planned = ?, parts = ?, does = ?, notify = ?, reads = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(
      body.name === undefined ? kind.name : requiredString(body, "name", 40),
      body.icon === undefined ? kind.icon : isIconKey(body.icon) ? body.icon : null,
      JSON.stringify(fields),
      body.goal === undefined ? (after.duration ? kind.goal : null) : goalOf(body, after),
      body.planned === undefined ? (kind.planned ? 1 : 0) : plannedOf(body),
      parts ? JSON.stringify(parts) : null,
      does.length ? JSON.stringify(does) : null,
      JSON.stringify(body.notify === undefined ? kind.notify : cleanNotify(body.notify)),
      body.reads === undefined ? (kind.reads === null ? null : kind.reads ? 1 : 0) : readsOf(body),
      kind.id,
    )
    .run();
  if (JSON.stringify(does) !== JSON.stringify(kind.does) || JSON.stringify(parts) !== JSON.stringify(kind.parts)) await rebuildForm(db, kind.id);
  return c.json({ ok: true });
});

/** Groepen uit een lijst die de bewerker niet ziet, gaan niet verloren: ze blijven op hun plaats van voordien. */
function keepUnseen(before: Parts | null, after: Parts, seen: Map<string, Role>): Parts {
  const hidden = (before?.groups ?? []).filter((g) => g.list && !seen.has(g.list) && !after.groups.some((a) => a.role === g.role));
  return hidden.length ? { ...after, groups: [...after.groups, ...hidden] } : after;
}

forms.put("/:id/archived", async (c) => {
  const db = c.env.DB;
  const { kind, role } = await requireForm(db, c.get("person").id, c.req.param("id"));
  needManage(role, "Enkel een beheerder past dit formulier aan.");
  const archived = asObject(await c.req.json()).archived === true ? 1 : 0;
  await db.prepare("UPDATE kinds SET archived = ?, updated_at = datetime('now') WHERE id = ?").bind(archived, kind.id).run();
  return c.json({ ok: true });
});

/** Een formulier verwijderen: met zijn logboek (en wat dat in de lijsten deed). */
forms.delete("/:id", async (c) => {
  const db = c.env.DB;
  const { kind, role } = await requireForm(db, c.get("person").id, c.req.param("id"));
  needManage(role, "Enkel een beheerder verwijdert dit formulier.");
  await db.batch([
    db.prepare("DELETE FROM attachments WHERE owner_kind = 'event' AND owner_id IN (SELECT id FROM events WHERE kind = ?)").bind(kind.id),
    db.prepare("DELETE FROM events WHERE kind = ?").bind(kind.id),
    db.prepare("DELETE FROM kinds WHERE id = ?").bind(kind.id),
  ]);
  return c.body(null, 204);
});

forms.put("/:id/tags", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { kind, role } = await requireForm(db, me.id, c.req.param("id"));
  needManage(role, "Enkel een beheerder zet tags op dit formulier.");
  await db.batch(await tagStatements(db, me.id, "form", kind.id, asObject(await c.req.json())));
  return c.json({ ok: true });
});

forms.post("/:id/people", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const { kind, role } = await requireForm(db, me.id, c.req.param("id"));
  needManage(role, "Enkel een beheerder voegt mensen toe.");
  const personId = await addPerson(db, me.id, "form", kind.id, asObject(await c.req.json()));
  return c.json({ person_id: personId }, 201);
});

forms.put("/:id/people/:personId", async (c) => {
  const db = c.env.DB;
  const { kind, role } = await requireForm(db, c.get("person").id, c.req.param("id"));
  needManage(role, "Enkel een beheerder beheert de mensen.");
  await setPerson(db, "form", kind.id, c.req.param("personId"), asObject(await c.req.json()).role);
  return c.json({ ok: true });
});

