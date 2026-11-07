// Back-up (GET /me/backup) en terugzetten (POST /me/restore), zie shared/backup.ts. Enkel de lijsten die je beheert,
// met wat erin staat; terugzetten maakt een nieuwe kopie waarin jij beheerder bent, en neemt foto's mee van dingen en
// gebeurtenissen die nog bestaan en die je ziet.

import { Hono } from "hono";
import { BACKUP_KIND, BACKUP_VERSION, parseBackup, planRestore, type Backup, type BackupLine } from "../../shared/backup";
import { canManage } from "../../shared/model";
import { ids, parseJson, seenLists, type ListRow } from "../access";
import { photoKey } from "../media";
import type { AppEnv } from "../types";
import { ValidationError } from "../validate";
import { knownPeople, myLists } from "./lists";

export const backup = new Hono<AppEnv>();

/** Zoveel rijen per vraag aan de databank (D1 aanvaardt hoogstens 100 waarden per vraag). */
const CHUNK = 40;
const chunks = <T,>(xs: T[], n = CHUNK) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

backup.get("/backup", async (c) => {
  const db = c.env.DB;
  const me = c.get("person").id;
  const seen = await seenLists(db, me);
  const mine = [...seen].filter(([, role]) => canManage(role)).map(([id]) => id);
  if (!mine.length) throw new ValidationError("Je beheert nog geen lijst.");
  const L = ids(mine);
  const [lists, links, kinds, things, events, lines, views, people] = (await db.batch([
    db.prepare("SELECT * FROM lists WHERE id IN (SELECT value FROM json_each(?))").bind(L),
    db.prepare("SELECT l.list_id, t.id, t.name, t.color FROM list_tag_links l JOIN list_tags t ON t.id = l.tag_id WHERE l.list_id IN (SELECT value FROM json_each(?))").bind(L),
    db.prepare("SELECT * FROM kinds WHERE list_id IN (SELECT value FROM json_each(?))").bind(L),
    db.prepare("SELECT id, list_id, name, data, part_of, archived, photo_version FROM things WHERE list_id IN (SELECT value FROM json_each(?))").bind(L),
    db.prepare("SELECT * FROM events WHERE list_id IN (SELECT value FROM json_each(?))").bind(L),
    db
      .prepare(
        `SELECT l.* FROM lines l JOIN events e ON e.id = l.event_id WHERE e.list_id IN (SELECT value FROM json_each(?)) ORDER BY l.event_id, l.position`,
      )
      .bind(L),
    db.prepare("SELECT * FROM saved_views WHERE list_id IN (SELECT value FROM json_each(?)) AND (shared = 1 OR owner_id = ?)").bind(L, me),
    db
      .prepare(
        `SELECT DISTINCT p.id, p.name, p.email, p.color FROM people p JOIN list_people lp ON lp.person_id = p.id WHERE lp.list_id IN (SELECT value FROM json_each(?))`,
      )
      .bind(L),
  ])) as D1Result<Record<string, unknown>>[];
  const linesOf = new Map<string, BackupLine[]>();
  for (const l of lines.results) {
    const line: BackupLine = {
      role: l.role as BackupLine["role"],
      thing_id: (l.thing_id as string | null) ?? null,
      text: (l.text as string | null) ?? null,
      amount: (l.amount as number | null) ?? null,
      unit: (l.unit as string | null) ?? null,
      price: (l.price as number | null) ?? null,
      expires: (l.expires as string | null) ?? null,
      owner: (l.owner as string | null) ?? null,
    };
    linesOf.set(l.event_id as string, [...(linesOf.get(l.event_id as string) ?? []), line]);
  }
  // De namen van dingen buiten de back-up waarnaar een lijn wijst, enkel als je hun lijst ziet.
  const inside = new Set(things.results.map((t) => t.id as string));
  const outsideIds = [...new Set(lines.results.map((l) => l.thing_id as string | null).filter((id): id is string => Boolean(id) && !inside.has(id!)))];
  const outside: Backup["outside"] = [];
  for (const part of chunks(outsideIds, 90)) {
    const { results } = await db.prepare("SELECT id, name, list_id FROM things WHERE id IN (SELECT value FROM json_each(?))").bind(ids(part)).all<{ id: string; name: string; list_id: string }>();
    for (const r of results) if (seen.has(r.list_id)) outside.push({ id: r.id, name: r.name });
  }
  const tags = new Map<string, { id: string; name: string; color: string | null }>();
  const tagIds = new Map<string, string[]>();
  for (const l of links.results) {
    tags.set(l.id as string, { id: l.id as string, name: l.name as string, color: (l.color as string | null) ?? null });
    tagIds.set(l.list_id as string, [...(tagIds.get(l.list_id as string) ?? []), l.id as string]);
  }
  const file: Backup = {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    created_at: new Date().toISOString(),
    people: people.results as Backup["people"],
    tags: [...tags.values()],
    lists: (lists.results as unknown as ListRow[]).map((l) => ({
      id: l.id,
      name: l.name,
      one: l.one,
      icon: l.icon,
      color: l.color,
      fields: parseJson(l.fields, []),
      stock: parseJson(l.stock, null),
      notify: parseJson(l.notify, null),
      read_photo: parseJson(l.read_photo, null),
      archived: l.archived ? 1 : 0,
      tag_ids: tagIds.get(l.id) ?? [],
    })),
    kinds: kinds.results.map((k) => ({
      id: k.id as string,
      list_id: k.list_id as string,
      base: k.base as Backup["kinds"][number]["base"],
      name: k.name as string,
      icon: k.icon as string,
      fields: parseJson(k.fields as string, []),
      goal: (k.goal as number | null) ?? null,
      sort_order: (k.sort_order as number) ?? 0,
    })),
    things: things.results.map((t) => ({
      id: t.id as string,
      list_id: t.list_id as string,
      name: t.name as string,
      data: parseJson(t.data as string, {}),
      part_of: (t.part_of as string | null) ?? null,
      archived: t.archived ? 1 : 0,
      photo: Boolean(t.photo_version),
    })),
    events: events.results.map((e) => ({
      id: e.id as string,
      list_id: e.list_id as string,
      kind: e.kind as string,
      base: e.base as Backup["events"][number]["base"],
      name: (e.name as string) ?? "",
      status: e.status as Backup["events"][number]["status"],
      at: e.at as string,
      end_at: (e.end_at as string | null) ?? null,
      amount: (e.amount as number | null) ?? null,
      paid_by: (e.paid_by as string | null) ?? null,
      split: parseJson(e.split as string | null, null),
      to_person: (e.to_person as string | null) ?? null,
      data: parseJson(e.data as string, {}),
      repeat: parseJson(e.repeat as string | null, null),
      done_by: (e.done_by as string | null) ?? null,
      photo: Boolean(e.photo_version),
      lines: linesOf.get(e.id as string) ?? [],
    })),
    views: views.results.map((v) => ({
      id: v.id as string,
      list_id: v.list_id as string,
      target: v.target as "dingen" | "logboek",
      name: v.name as string,
      def: parseJson(v.def as string, {}),
      shared: v.shared ? 1 : 0,
    })),
    outside,
  };
  const day = new Date().toISOString().slice(0, 10);
  return c.body(JSON.stringify(file), 200, { "content-type": "application/json", "content-disposition": `attachment; filename="thuis-${day}.json"` });
});

backup.post("/restore", async (c) => {
  const db = c.env.DB;
  const me = c.get("person").id;
  let file: Backup;
  try {
    file = parseBackup(await c.req.json());
  } catch (err) {
    throw new ValidationError((err as Error).message);
  }
  const seen = await seenLists(db, me);
  const people = new Set((await knownPeople(db, me)).map((p) => p.id));
  // Dingen buiten de back-up die er nog zijn en die je ziet.
  const refs = [...new Set(file.events.flatMap((e) => (e.lines ?? []).flatMap((l) => (l.thing_id ? [l.thing_id] : []))))];
  const seenThings = new Set<string>();
  for (const part of chunks(refs, 90)) {
    const { results } = await db.prepare("SELECT id, list_id FROM things WHERE id IN (SELECT value FROM json_each(?))").bind(ids(part)).all<{ id: string; list_id: string }>();
    for (const r of results) if (seen.has(r.list_id)) seenThings.add(r.id);
  }
  const plan = planRestore(file, { newId: () => crypto.randomUUID(), me, people, seenThings });

  // Tags op naam: een tag die je al hebt, of een nieuwe.
  const { tags } = await myLists(db, me);
  const tagByName = new Map(tags.map((t) => [t.name.toLocaleLowerCase("nl"), t.id]));
  const st: D1PreparedStatement[] = [];
  for (const l of plan.lists) {
    st.push(
      db
        .prepare("INSERT INTO lists (id, name, one, icon, color, fields, stock, notify, read_photo, archived, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(l.id, `${l.name}`, l.one, l.icon, l.color, JSON.stringify(l.fields), l.stock ? JSON.stringify(l.stock) : null, l.notify ? JSON.stringify(l.notify) : null, l.read_photo ? JSON.stringify(l.read_photo) : null, l.archived, me),
      db.prepare("INSERT INTO list_people (list_id, person_id, role) VALUES (?, ?, 'beheerder')").bind(l.id, me),
    );
    for (const name of l.tags) {
      let tagId = tagByName.get(name.toLocaleLowerCase("nl"));
      if (!tagId) {
        tagId = crypto.randomUUID();
        tagByName.set(name.toLocaleLowerCase("nl"), tagId);
        st.push(db.prepare("INSERT INTO list_tags (id, name, created_by) VALUES (?, ?, ?)").bind(tagId, name, me));
      }
      st.push(db.prepare("INSERT INTO list_tag_links (list_id, tag_id) VALUES (?, ?)").bind(l.id, tagId));
    }
  }
  for (const k of plan.kinds)
    st.push(db.prepare("INSERT INTO kinds (id, list_id, base, name, icon, fields, goal, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(k.id, k.list_id, k.base, k.name, k.icon, JSON.stringify(k.fields), k.goal, k.sort_order));
  // Eerst zonder "deel van" (dat wijst misschien naar een ding dat later komt), daarna die verwijzing.
  for (const t of plan.things) st.push(db.prepare("INSERT INTO things (id, list_id, name, data, archived, created_by) VALUES (?, ?, ?, ?, ?, ?)").bind(t.id, t.list_id, t.name, JSON.stringify(t.data), t.archived, me));
  for (const t of plan.things) if (t.part_of) st.push(db.prepare("UPDATE things SET part_of = ? WHERE id = ?").bind(t.part_of, t.id));
  for (const e of plan.events) {
    st.push(
      db
        .prepare(
          `INSERT INTO events (id, list_id, kind, base, name, status, at, end_at, amount, paid_by, split, to_person, data, repeat, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(e.id, e.list_id, e.kind, e.base, e.name, e.status, e.at, e.end_at, e.amount, e.paid_by, e.split ? JSON.stringify(e.split) : null, e.to_person, JSON.stringify(e.data), e.repeat ? JSON.stringify(e.repeat) : null, me),
    );
    e.lines.forEach((l, i) =>
      st.push(
        db
          .prepare("INSERT INTO lines (id, event_id, position, role, thing_id, text, amount, unit, price, expires, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(crypto.randomUUID(), e.id, i, l.role, l.thing_id, l.text, l.amount, l.unit, l.price, l.expires, l.owner),
      ),
    );
  }
  for (const e of plan.events) if (e.done_by) st.push(db.prepare("UPDATE events SET done_by = ? WHERE id = ?").bind(e.done_by, e.id));
  for (const v of plan.views)
    st.push(db.prepare("INSERT INTO saved_views (id, owner_id, list_id, target, name, def, shared) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(v.id, me, v.list_id, v.target, v.name, JSON.stringify(v.def), v.shared));
  // Alles of niets: D1 voert een batch in één transactie uit.
  await db.batch(st);

  // Foto's van dingen en gebeurtenissen die nog bestaan en die je ziet.
  let photos = 0;
  const copy = async (kind: "thing" | "event", oldId: string, newId: string, table: "things" | "events") => {
    const row = await db.prepare(`SELECT list_id FROM ${table} WHERE id = ?`).bind(oldId).first<{ list_id: string }>();
    if (!row || !seen.has(row.list_id)) return;
    const object = await c.env.FILES.get(photoKey(kind, oldId));
    if (!object) return;
    await c.env.FILES.put(photoKey(kind, newId), await object.arrayBuffer(), { httpMetadata: object.httpMetadata });
    await db.prepare(`UPDATE ${table} SET photo_version = 1 WHERE id = ?`).bind(newId).run();
    photos++;
  };
  for (const t of plan.things) if (t.photo) await copy("thing", t.old, t.id, "things");
  for (const e of plan.events) if (e.photo) await copy("event", e.old, e.id, "events");
  return c.json({ lists: plan.lists.length, things: plan.things.length, events: plan.events.length, photos });
});
