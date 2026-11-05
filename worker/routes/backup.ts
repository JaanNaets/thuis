// Back-up en terugzetten (zie shared/backup.ts).
//
// Een back-up bevat de projecten waar je alles beheert (instellen én mensen), met wat je er ziet: lijsten (enkel de
// velden die je ziet), items, tags, rollen, mensen, logboek, herhalingen, gedeelde en je eigen weergaven, en welke
// foto's en bestanden erbij horen. Nooit `items.applied`, nooit een rekeningnummer, nooit iets van een ander zijn
// eigen weergaven.
//
// Terugzetten maakt altijd een nieuwe kopie (nieuwe ids, niets wordt overschreven) en kijkt alles na alsof je het zelf
// invoert: velden en totalen zoals bij een lijst maken (`cleanTypeFields`, `cleanTotals`), waarden met
// `cleanAttributes`, personen moeten in het project zitten, een verwijzing moet naar een item wijzen dat bestaat in een
// lijst die het veld toelaat en dat jij mag zien. Wat niet klopt, valt weg. Mensen koppelt het op e-mailadres aan wie al
// bestaat (zoals iemand toevoegen); jij wordt beheerder van elk project bovenaan. Foto's en bestanden kopieert het
// enkel uit items die nog bestaan en die jij mag zien. Wat een item aan andere deed, rekent het opnieuw uit; het past
// niets opnieuw toe (de aantallen staan zoals in de back-up).

import { Hono } from "hono";
import { canSeeType, cleanRights, DEFAULT_ROLES, visibleData, visibleFields, type Rights } from "../../shared/access";
import {
  BACKUP_KIND,
  BACKUP_VERSION,
  freshIds,
  MAX_BACKUP_BYTES,
  MAX_BACKUP_ITEMS,
  MAX_BACKUP_PROJECTS,
  parseBackup,
  projectTree,
  remap,
  type Backup,
  type BackupItem,
} from "../../shared/backup";
import { effectsOf } from "../../shared/effects";
import { cleanAttributes, cleanFields, INTERVAL_UNITS, refLists, type AmountEntry, type Attributes, type FieldDef, type Share } from "../../shared/fields";
import { isIconKey } from "../../shared/templates";
import { sourceMisfit, visibleTotals, type TotalDef } from "../../shared/totals";
import { isTone, type Item, type ItemType } from "../../shared/types";
import { cleanView, viewFields } from "../../shared/views";
import { withCalcs } from "../compute";
import { inTargetUnits } from "../effects";
import { accessibleProjects, toItemType, visibleLists, type TypeRow } from "../context";
import { brusselsToday } from "../today";
import type { AppEnv } from "../types";
import { ForbiddenError, ValidationError } from "../validate";
import { visibility } from "./items";
import { cleanTypeFields, insertMembership, keepTotals } from "./projects";

export const backup = new Hono<AppEnv>();

/** Zoveel foto's en bestanden kopieert één keer terugzetten (elk is een lees- en een schrijfopdracht in R2). */
const MAX_COPIES = 300;
const photoKey = (id: string) => `items/${id}/photo`;

const parse = <T>(json: string | null | undefined, fallback: T): T => {
  try {
    return json ? (JSON.parse(json) as T) : fallback;
  } catch {
    return fallback;
  }
};
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : 0);
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isStamp = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- back-up maken ----------

backup.get("/", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const nodes = (await accessibleProjects(db, me.id)).filter((n) => n.rights.manage && n.rights.members);
  if (!nodes.length) throw new ForbiddenError("Je beheert geen enkel project helemaal.");
  const rightsOf = new Map(nodes.map((n) => [n.id, n.rights]));
  const ids = JSON.stringify(nodes.map((n) => n.id));
  const IN = "(SELECT value FROM json_each(?1))";
  const ITEMS = `(SELECT id FROM items WHERE project_id IN ${IN})`;
  const [projects, roles, memberships, people, types, tags, items, log, repeats, views, shown, files] = (await db.batch([
    db.prepare(`SELECT id, parent_id, name, description, icon, color, sort_order, archived FROM projects WHERE id IN ${IN} ORDER BY created_at`).bind(ids),
    db.prepare(`SELECT id, project_id, name, rights, sort_order FROM roles WHERE project_id IN ${IN}`).bind(ids),
    db.prepare(`SELECT project_id, person_id, role_id, sort_order FROM memberships WHERE project_id IN ${IN}`).bind(ids),
    db.prepare(`SELECT id, name, email, color FROM people WHERE id IN (SELECT person_id FROM memberships WHERE project_id IN ${IN})`).bind(ids),
    db.prepare(`SELECT * FROM item_types WHERE project_id IN ${IN} ORDER BY sort_order, created_at`).bind(ids),
    db.prepare(`SELECT id, project_id, name, color FROM tags WHERE project_id IN ${IN}`).bind(ids),
    db
      .prepare(
        `SELECT i.id, i.project_id, i.type_id, i.name, i.data, i.archived, i.created_by, i.created_at, i.updated_at, i.photo_version,
           (SELECT json_group_array(tag_id) FROM item_tags WHERE item_id = i.id) AS tag_json
         FROM items i WHERE i.project_id IN ${IN} ORDER BY i.created_at`,
      )
      .bind(ids),
    db.prepare(`SELECT id, item_id, happened_on, text, created_by, created_at FROM item_log WHERE item_id IN ${ITEMS}`).bind(ids),
    db.prepare(`SELECT item_id, every_n, every_unit, next_on, created_by FROM repeats WHERE item_id IN ${ITEMS}`).bind(ids),
    db
      .prepare(
        `SELECT id, project_id, type_id, person_id, name, def, sort_order FROM views WHERE project_id IN ${IN} AND (person_id IS NULL OR person_id = ?2)`,
      )
      .bind(ids, me.id),
    db.prepare(`SELECT project_id, type_id FROM shown_lists WHERE project_id IN ${IN}`).bind(ids),
    db.prepare(`SELECT id, item_id, filename, content_type, size_bytes, created_by FROM item_files WHERE item_id IN ${ITEMS}`).bind(ids),
  ])) as D1Result<Record<string, unknown>>[];

  // Enkel de lijsten (en velden) die je ziet, en de items daarvan met de waarden die je ziet.
  const lists = new Map<string, ItemType>();
  for (const row of types.results as unknown as TypeRow[]) {
    const t = toItemType(row);
    const rights = rightsOf.get(t.project_id)!;
    if (!canSeeType(rights, t.id)) continue;
    const fields = visibleFields(rights, t.id, t.fields);
    lists.set(t.id, { ...t, fields, totals: visibleTotals(t.totals, fields) });
  }
  const shownItems = (items.results as Record<string, unknown>[]).flatMap((row): BackupItem[] => {
    const type = lists.get(row.type_id as string);
    const rights = rightsOf.get(row.project_id as string);
    if (!type || !rights || !canSeeType(rights, type.id)) return [];
    return [
      {
        id: row.id as string,
        project_id: row.project_id as string,
        type_id: type.id,
        name: row.name as string,
        data: visibleData(rights, type.id, type.fields, parse<Attributes>(row.data as string, {})),
        archived: row.archived as number,
        created_by: row.created_by as string,
        created_at: row.created_at as string,
        updated_at: row.updated_at as string,
        tags: parse<string[]>(row.tag_json as string, []),
        photo: row.photo_version !== null,
      },
    ];
  });
  const itemIds = new Set(shownItems.map((i) => i.id));
  const ofItem = <T extends Record<string, unknown>>(rows: T[]) => rows.filter((r) => itemIds.has(r.item_id as string));

  const file: Backup = {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    created_at: new Date().toISOString(),
    people: people.results as Backup["people"],
    projects: projects.results as Backup["projects"],
    roles: (roles.results as Record<string, unknown>[]).map((r) => ({
      ...r,
      rights: parse(r.rights as string, {}),
    })) as Backup["roles"],
    memberships: memberships.results as Backup["memberships"],
    types: [...lists.values()].map((t) => ({
      id: t.id,
      project_id: t.project_id,
      name: t.name,
      plural: t.plural,
      name_label: t.name_label,
      icon: t.icon,
      fields: t.fields,
      totals: t.totals,
      sort_order: t.sort_order,
    })),
    tags: tags.results as Backup["tags"],
    items: shownItems,
    log: ofItem(log.results) as Backup["log"],
    repeats: ofItem(repeats.results) as Backup["repeats"],
    views: (views.results as Record<string, unknown>[])
      .filter((v) => lists.has(v.type_id as string))
      .map((v) => ({
        ...v,
        def: parse(v.def as string, {}),
      })) as Backup["views"],
    shown: (shown.results as Backup["shown"]).filter((s) => lists.has(s.type_id)),
    files: ofItem(files.results) as Backup["files"],
  };
  return c.json(file, 200, {
    "Content-Disposition": `attachment; filename="thuis-back-up-${brusselsToday()}.json"`,
  });
});

// ---------- terugzetten ----------

/**
 * Velden zoals bij een lijst maken (`cleanTypeFields`), maar wat niet klopt valt weg in plaats van alles te weigeren:
 * eerst verwijzingen naar lijsten die je niet (meer) ziet, dan veld per veld wat op zich niet klopt.
 */
function salvageFields(raw: unknown, available: ItemType[], selfId: string): FieldDef[] {
  const ids = new Set([...available.map((t) => t.id), selfId]);
  const list = (Array.isArray(raw) ? raw : []).flatMap((f) => {
    const def = f as FieldDef;
    if (!def || typeof def !== "object" || (def.type !== "item" && def.type !== "items" && def.type !== "amounts")) return [def];
    const lists = refLists(def).filter((id) => ids.has(id));
    if (!lists.length) return [];
    const [ref_type, ...ref_also] = lists;
    return [{ ...def, ref_type, ref_also: ref_also.length ? ref_also : undefined }];
  });
  try {
    return cleanTypeFields(list, available, selfId);
  } catch {
    // Veld per veld, tot er niets meer bij kan (een berekening kan een later veld nodig hebben).
    let kept: FieldDef[] = [];
    for (let grew = true; grew; ) {
      grew = false;
      for (const f of list) {
        if (kept.includes(f)) continue;
        try {
          cleanTypeFields([...kept, f], available, selfId);
          kept = list.filter((x) => x === f || kept.includes(x));
          grew = true;
        } catch {
          // valt weg
        }
      }
    }
    return kept.length ? cleanTypeFields(kept, available, selfId) : [];
  }
}

backup.post("/", async (c) => {
  if (Number(c.req.header("content-length") ?? 0) > MAX_BACKUP_BYTES) throw new ValidationError("Deze back-up is te groot.");
  let b: Backup;
  try {
    b = parseBackup(await c.req.json());
  } catch (err) {
    throw new ValidationError(err instanceof SyntaxError ? "Dit is geen back-up van Thuis." : (err as Error).message);
  }
  if (b.projects.length > MAX_BACKUP_PROJECTS || b.items.length > MAX_BACKUP_ITEMS)
    throw new ValidationError("Deze back-up is te groot om in één keer terug te zetten.");
  const db = c.env.DB;
  const me = c.get("person");
  const ids = freshIds(b, () => crypto.randomUUID());
  const statements: D1PreparedStatement[] = [];

  // Mensen: wie al bestaat (zelfde e-mailadres), blijft die persoon; de anderen komen erbij.
  const emailOf = new Map(b.people.map((p) => [p.id, typeof p.email === "string" && EMAIL.test(p.email.trim()) ? p.email.trim().toLowerCase() : null]));
  const emails = [...new Set([...emailOf.values()].filter(Boolean))] as string[];
  const { results: known } = emails.length
    ? await db
        .prepare("SELECT id, email FROM people WHERE email IN (SELECT value FROM json_each(?))")
        .bind(JSON.stringify(emails))
        .all<{ id: string; email: string }>()
    : { results: [] };
  const byEmail = new Map(known.map((p) => [p.email, p.id]));
  const newPeople: string[] = [];
  for (const p of b.people) {
    if (typeof p?.id !== "string" || ids.has(p.id)) continue;
    const email = emailOf.get(p.id) ?? null;
    if (email && byEmail.has(email)) {
      ids.set(p.id, byEmail.get(email)!);
      continue;
    }
    const id = crypto.randomUUID();
    ids.set(p.id, id);
    if (email) byEmail.set(email, id);
    newPeople.push(id);
    statements.push(
      db
        .prepare("INSERT INTO people (id, name, email, color, created_by) VALUES (?, ?, ?, ?, ?)")
        .bind(id, text(p.name, 60) || "Iemand", email, isTone(p.color) ? p.color : null, me.id),
    );
  }
  const person = (old: unknown) => (typeof old === "string" ? ids.get(old) : undefined);

  // Projecten, van boven naar onder; bovenaan worden het hoofdprojecten.
  const tree = projectTree(b);
  const chainOf = new Map([...tree.chain].map(([old, chain]) => [ids.get(old)!, chain.map((x) => ids.get(x)!)]));
  const tops = tree.order.filter((p) => chainOf.get(ids.get(p.id)!)!.length === 1).map((p) => ids.get(p.id)!);
  for (const p of tree.order) {
    statements.push(
      db
        .prepare("INSERT INTO projects (id, parent_id, name, description, icon, color, sort_order, archived, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(
          ids.get(p.id)!,
          chainOf.get(ids.get(p.id)!)!.length > 1 ? ids.get(p.parent_id!)! : null,
          text(p.name, 80) || "Project",
          text(p.description, 2000) || null,
          isIconKey(p.icon) ? p.icon : null,
          isTone(p.color) ? p.color : null,
          int(p.sort_order),
          p.archived ? 1 : 0,
          me.id,
        ),
    );
  }
  const inTree = (oldProject: unknown) => typeof oldProject === "string" && tree.chain.has(oldProject);

  // Rollen, en de mensen erin. Een rol hoort bij het project zelf of erboven.
  const roles = b.roles
    .filter((r) => inTree(r.project_id))
    .map((r) => ({
      ...r,
      id: ids.get(r.id)!,
      project_id: ids.get(r.project_id)!,
      rights: cleanRights(remap(r.rights, ids)),
    }));
  for (const r of roles) {
    statements.push(
      db
        .prepare("INSERT INTO roles (id, project_id, name, rights, sort_order) VALUES (?, ?, ?, ?, ?)")
        .bind(r.id, r.project_id, text(r.name, 40) || "Rol", JSON.stringify(r.rights), int(r.sort_order)),
    );
  }
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const members = new Map<string, { project_id: string; person_id: string; role_id: string }>();
  for (const m of b.memberships) {
    const project = inTree(m.project_id) ? ids.get(m.project_id) : undefined;
    const role = typeof m.role_id === "string" ? roleById.get(ids.get(m.role_id) ?? "") : undefined;
    const who = person(m.person_id);
    if (project && role && who && chainOf.get(project)!.includes(role.project_id))
      members.set(`${project}|${who}`, {
        project_id: project,
        person_id: who,
        role_id: role.id,
      });
  }
  // Jij beheert elk project bovenaan: met een rol daar die alles mag, of anders een nieuwe Beheerder.
  for (const top of tops) {
    const mine = members.get(`${top}|${me.id}`);
    const admin = (r?: { rights: Rights }) => Boolean(r?.rights.manage && r.rights.members);
    if (mine && admin(roleById.get(mine.role_id))) continue;
    let role = roles.find((r) => r.project_id === top && admin(r));
    if (!role) {
      role = {
        id: crypto.randomUUID(),
        project_id: top,
        name: DEFAULT_ROLES[0].name,
        rights: DEFAULT_ROLES[0].rights,
        sort_order: -10,
      };
      roles.push(role);
      roleById.set(role.id, role);
      statements.push(
        db
          .prepare("INSERT INTO roles (id, project_id, name, rights, sort_order) VALUES (?, ?, ?, ?, ?)")
          .bind(role.id, top, role.name, JSON.stringify(role.rights), role.sort_order),
      );
    }
    members.set(`${top}|${me.id}`, {
      project_id: top,
      person_id: me.id,
      role_id: role.id,
    });
  }
  for (const m of members.values()) statements.push(insertMembership(db, m.project_id, m.person_id, m.role_id));
  /** Wie in een project zit (zelf of erboven). */
  const memberSet = new Map<string, Set<string>>();
  const membersOf = (project: string) => {
    if (!memberSet.has(project)) {
      const chain = chainOf.get(project) ?? [];
      memberSet.set(project, new Set([...members.values()].filter((m) => chain.includes(m.project_id)).map((m) => m.person_id)));
    }
    return memberSet.get(project)!;
  };

  // Tags (een naam één keer per project).
  const tagProject = new Map<string, string>();
  const tagNames = new Set<string>();
  for (const t of b.tags) {
    const name = text(t.name, 40);
    if (!inTree(t.project_id) || !name || tagNames.has(`${t.project_id}|${name.toLowerCase()}`)) continue;
    tagNames.add(`${t.project_id}|${name.toLowerCase()}`);
    tagProject.set(ids.get(t.id)!, ids.get(t.project_id)!);
    statements.push(
      db
        .prepare("INSERT INTO tags (id, project_id, name, color) VALUES (?, ?, ?, ?)")
        .bind(ids.get(t.id)!, ids.get(t.project_id)!, name, isTone(t.color) ? t.color : null),
    );
  }

  // Lijsten: velden en totalen nagekeken tegen de lijsten uit de back-up en die je elders ziet.
  const elsewhere = await visibleLists(db, me.id);
  const restored: ItemType[] = b.types
    .filter((t) => inTree(t.project_id))
    .map((t) => {
      let fields: FieldDef[] = [];
      try {
        fields = cleanFields(remap(t.fields, ids));
      } catch {
        // nagekeken hieronder
      }
      return {
        id: ids.get(t.id)!,
        project_id: ids.get(t.project_id)!,
        name: text(t.name, 40) || "Lijst",
        plural: text(t.plural, 40) || text(t.name, 40) || "Lijst",
        name_label: text(t.name_label, 40) || null,
        icon: isIconKey(t.icon) ? t.icon : null,
        fields,
        totals: [],
        sort_order: int(t.sort_order),
      };
    });
  const available = [...restored, ...elsewhere];
  const raw = new Map(b.types.map((t) => [ids.get(t.id), t]));
  const types = new Map<string, ItemType>();
  for (const t of restored) {
    const source = raw.get(t.id)!;
    const people = membersOf(t.project_id);
    const fields = salvageFields(remap(source.fields, ids), available, t.id).map((f) => {
      if (!f.default_shares) return f;
      const shares = f.default_shares.filter((s: Share) => people.has(s.person_id));
      return { ...f, default_shares: shares.length ? shares : undefined };
    });
    const byId = new Map(available.map((l) => [l.id, l]));
    const totals = keepTotals(Array.isArray(source.totals) ? (remap(source.totals, ids) as TotalDef[]) : [], fields)
      .map((total) => {
        const sources = total.sources?.filter((id) => id !== t.id && byId.has(id) && !sourceMisfit(total, fields, byId.get(id)!.fields));
        return { ...total, sources: sources?.length ? sources : undefined };
      })
      .map((total) => ({
        ...total,
        ...(total.goals
          ? {
              goals: Object.fromEntries(Object.entries(total.goals).filter(([id]) => people.has(id))),
            }
          : {}),
      }));
    types.set(t.id, { ...t, fields, totals });
    statements.push(
      db
        .prepare("INSERT INTO item_types (id, project_id, name, plural, name_label, icon, fields, totals, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(t.id, t.project_id, t.name, t.plural, t.name_label, t.icon, JSON.stringify(fields), JSON.stringify(totals), t.sort_order),
    );
  }

  // Items: een lijst van het project zelf of erboven; waarden nagekeken, personen uit het project, verwijzingen naar
  // items die bestaan in een lijst die het veld toelaat en die jij mag zien.
  const typeOfNew = new Map<string, string>();
  const candidates = b.items.flatMap((i) => {
    const project = inTree(i.project_id) ? ids.get(i.project_id)! : undefined;
    const type = types.get(ids.get(i.type_id) ?? "");
    if (!project || !type || !chainOf.get(project)!.includes(type.project_id)) return [];
    typeOfNew.set(ids.get(i.id)!, type.id);
    return [
      {
        old: i,
        id: ids.get(i.id)!,
        project,
        type,
        data: cleanAttributes(type.fields, remap(i.data, ids)),
      },
    ];
  });
  const outside = [
    ...new Set(
      candidates.flatMap(({ type, data }) =>
        type.fields.flatMap((f) =>
          f.type === "item" && typeof data[f.key] === "string"
            ? [data[f.key] as string]
            : f.type === "items" && Array.isArray(data[f.key])
              ? (data[f.key] as string[])
              : f.type === "amounts" && Array.isArray(data[f.key])
                ? (data[f.key] as AmountEntry[]).flatMap((e) => (e.item ? [e.item] : []))
                : [],
        ),
      ),
    ),
  ].filter((id) => !typeOfNew.has(id));
  const { results: outsideRows } = outside.length
    ? await db
        .prepare("SELECT id, project_id, type_id FROM items WHERE id IN (SELECT value FROM json_each(?))")
        .bind(JSON.stringify(outside))
        .all<{ id: string; project_id: string; type_id: string }>()
    : { results: [] };
  const canSee = await visibility(db, me.id);
  const outsideType = new Map(outsideRows.filter((r) => canSee(r)).map((r) => [r.id, r.type_id]));
  const refOk = (def: FieldDef, id: unknown) => typeof id === "string" && refLists(def).includes(typeOfNew.get(id) ?? outsideType.get(id) ?? "");
  const items = candidates.map((item) => {
    const people = membersOf(item.project);
    const data: Attributes = {};
    for (const f of item.type.fields) {
      const v = item.data[f.key];
      if (v === undefined) continue;
      if (f.type === "person" && !people.has(v as string)) continue;
      if (f.type === "people") {
        const list = (v as string[]).filter((id) => people.has(id));
        if (list.length) data[f.key] = list;
        continue;
      }
      if (f.type === "share" && (v as Share[]).some((s) => !people.has(s.person_id))) continue;
      if (f.type === "item" && typeof v === "string" && !refOk(f, v)) continue;
      if (f.type === "items") {
        const list = (v as string[]).filter((id) => refOk(f, id));
        if (list.length) data[f.key] = list;
        continue;
      }
      // Hoeveelheden: een regel met een item dat niet (meer) klopt, wordt tekst zonder item (zout blijft zout).
      if (f.type === "amounts") {
        data[f.key] = (v as AmountEntry[]).flatMap(({ item: ref, ...rest }) => (ref && refOk(f, ref) ? [{ item: ref, ...rest }] : rest.text ? [rest] : []));
        continue;
      }
      data[f.key] = v;
    }
    return { ...item, data };
  });

  // Foto's en bestanden: enkel uit items die nog bestaan en die jij mag zien, en zoals ze nu in de databank staan.
  const wanted = new Map(items.map((i) => [i.old.id, i]));
  const sourceIds = [...new Set([...items.filter((i) => i.old.photo).map((i) => i.old.id), ...b.files.map((f) => f.item_id).filter((id) => wanted.has(id))])];
  const [{ results: sources }, { results: fileRows }] = sourceIds.length
    ? ((await db.batch([
        db.prepare("SELECT id, project_id, type_id, photo_version FROM items WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(sourceIds)),
        db
          .prepare(
            "SELECT id, item_id, filename, content_type, size_bytes, r2_key, created_by FROM item_files WHERE id IN (SELECT value FROM json_each(?)) AND item_id IN (SELECT value FROM json_each(?))",
          )
          .bind(JSON.stringify(b.files.map((f) => f.id)), JSON.stringify(sourceIds)),
      ])) as [
        D1Result<{
          id: string;
          project_id: string;
          type_id: string;
          photo_version: number | null;
        }>,
        D1Result<{
          id: string;
          item_id: string;
          filename: string;
          content_type: string;
          size_bytes: number;
          r2_key: string;
          created_by: string;
        }>,
      ])
    : [{ results: [] }, { results: [] }];
  const allowed = new Set(sources.filter((s) => canSee(s)).map((s) => s.id));
  const copies: { from: string; to: string; then?: () => void }[] = [];
  const photos = new Set<string>();
  for (const s of sources)
    if (allowed.has(s.id) && s.photo_version !== null && wanted.get(s.id)?.old.photo)
      copies.push({
        from: photoKey(s.id),
        to: photoKey(wanted.get(s.id)!.id),
        then: () => photos.add(wanted.get(s.id)!.id),
      });
  const fileStatements: D1PreparedStatement[] = [];
  for (const f of fileRows) {
    if (!allowed.has(f.item_id)) continue;
    const item = wanted.get(f.item_id)!;
    const id = ids.get(f.id) ?? crypto.randomUUID();
    const key = `items/${item.id}/files/${id}`;
    copies.push({
      from: f.r2_key,
      to: key,
      then: () =>
        fileStatements.push(
          db
            .prepare("INSERT INTO item_files (id, item_id, filename, content_type, size_bytes, r2_key, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(id, item.id, f.filename, f.content_type, f.size_bytes, key, person(f.created_by) ?? me.id),
        ),
    });
  }

  // De structuur eerst (alles of niets), dan de kopieën in R2, dan de items (alles of niets, anders weer weg).
  await db.batch(statements);
  const copied: string[] = [];
  try {
    for (const copy of copies.slice(0, MAX_COPIES)) {
      const object = await c.env.FILES.get(copy.from);
      if (!object) continue;
      await c.env.FILES.put(copy.to, await object.arrayBuffer(), {
        httpMetadata: object.httpMetadata,
      });
      copied.push(copy.to);
      copy.then?.();
    }

    const rows: D1PreparedStatement[] = [];
    for (const item of items) {
      rows.push(
        db
          .prepare(
            `INSERT INTO items (id, project_id, type_id, name, data, photo_version, archived, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`,
          )
          .bind(
            item.id,
            item.project,
            item.type.id,
            text(item.old.name, 200) || item.type.name,
            JSON.stringify(item.data),
            photos.has(item.id) ? 1 : null,
            item.old.archived ? 1 : 0,
            person(item.old.created_by) ?? me.id,
            isStamp(item.old.created_at) ? item.old.created_at : null,
            isStamp(item.old.updated_at) ? item.old.updated_at : null,
          ),
      );
      const chain = chainOf.get(item.project)!;
      const tags = new Set(
        (Array.isArray(item.old.tags) ? item.old.tags : [])
          .map((t) => ids.get(t))
          .filter((t): t is string => Boolean(t && chain.includes(tagProject.get(t) ?? ""))),
      );
      for (const tag of tags) rows.push(db.prepare("INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)").bind(item.id, tag));
    }
    const itemNew = (old: unknown) => (typeof old === "string" ? wanted.get(old) : undefined);
    for (const l of b.log) {
      const item = itemNew(l.item_id);
      const body = text(l.text, 4000);
      if (!item || !isDay(l.happened_on) || !body) continue;
      rows.push(
        db
          .prepare("INSERT INTO item_log (id, item_id, happened_on, text, created_by, created_at) VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))")
          .bind(ids.get(l.id) ?? crypto.randomUUID(), item.id, l.happened_on, body, person(l.created_by) ?? me.id, isStamp(l.created_at) ? l.created_at : null),
      );
    }
    const today = brusselsToday();
    for (const r of b.repeats) {
      const item = itemNew(r.item_id);
      const n = int(r.every_n);
      if (!item || n < 1 || n > 100 || typeof r.every_unit !== "string" || !Object.hasOwn(INTERVAL_UNITS, r.every_unit) || !isDay(r.next_on)) continue;
      // Wie de herhaling instelde, maakt de nieuwe items (met zijn rechten): enkel iemand uit het project, anders jij.
      const by = person(r.created_by);
      rows.push(
        db
          .prepare("INSERT INTO repeats (item_id, every_n, every_unit, next_on, created_by) VALUES (?, ?, ?, ?, ?)")
          .bind(item.id, n, r.every_unit, r.next_on < today ? today : r.next_on, by && membersOf(item.project).has(by) ? by : me.id),
      );
    }
    for (const v of b.views) {
      const project = inTree(v.project_id) ? ids.get(v.project_id)! : undefined;
      const type = types.get(ids.get(v.type_id) ?? "");
      if (!project || !type || !chainOf.get(project)!.includes(type.project_id)) continue;
      let def;
      try {
        def = cleanView(remap(v.def, ids), viewFields(type.fields, type.name_label ?? "Naam"));
      } catch {
        continue;
      }
      rows.push(
        db
          .prepare("INSERT INTO views (id, project_id, type_id, person_id, name, def, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(
            ids.get(v.id) ?? crypto.randomUUID(),
            project,
            type.id,
            v.person_id ? me.id : null,
            text(v.name, 40) || "Weergave",
            JSON.stringify(def),
            int(v.sort_order),
          ),
      );
    }
    const shown = new Set<string>();
    for (const s of b.shown) {
      const project = inTree(s.project_id) ? ids.get(s.project_id)! : undefined;
      const type = types.get(ids.get(s.type_id) ?? "");
      // Enkel een lijst van erboven.
      if (!project || !type || type.project_id === project || !chainOf.get(project)!.includes(type.project_id) || shown.has(`${project}|${type.id}`)) continue;
      shown.add(`${project}|${type.id}`);
      rows.push(db.prepare("INSERT INTO shown_lists (project_id, type_id) VALUES (?, ?)").bind(project, type.id));
    }
    rows.push(...fileStatements);
    if (rows.length) await db.batch(rows);
  } catch (err) {
    // Niets half laten staan.
    await db.batch([
      db.prepare("DELETE FROM projects WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(tops)),
      db
        .prepare("DELETE FROM people WHERE id IN (SELECT value FROM json_each(?)) AND NOT EXISTS (SELECT 1 FROM memberships WHERE person_id = people.id)")
        .bind(JSON.stringify(newPeople)),
    ]);
    if (copied.length) await c.env.FILES.delete(copied);
    throw err;
  }

  // Wat items aan andere aftrekken of bijtellen, opnieuw uitgerekend (met de berekeningen zoals jij ze ziet).
  const nodes = new Map((await accessibleProjects(db, me.id)).map((n) => [n.id, n.rights]));
  const effects: D1PreparedStatement[] = [];
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    if (!item.type.fields.some((f) => (f.type === "item" || f.type === "amounts") && f.adjust)) continue;
    const key = `${item.type.id}|${item.project}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const group of groups.values()) {
    const { type, project } = group[0];
    const rights = nodes.get(project);
    if (!rights) continue;
    const temp = group.map(
      (i) =>
        ({
          id: i.id,
          project_id: project,
          type_id: type.id,
          name: "",
          tag_ids: [],
          data: { ...i.data },
        }) as unknown as Item,
    );
    try {
      await withCalcs(db, me.id, type, rights, temp);
    } catch {
      continue;
    }
    for (const t of temp) {
      const applied = await inTargetUnits(db, effectsOf(type.fields, t.data));
      if (applied.length) effects.push(db.prepare("UPDATE items SET applied = ? WHERE id = ?").bind(JSON.stringify(applied), t.id));
    }
  }
  // Lukt dit niet, dan staat alles er toch: een latere wijziging past dan het hele getal toe.
  if (effects.length) await db.batch(effects).catch((err) => console.error(err));

  return c.json(
    {
      id: tops[0],
      projects: tree.order.length,
      items: items.length,
      files: copied.length,
      missing: copies.length - copied.length,
    },
    201,
  );
});
