// Koppelen (zie shared/transfer.ts): een doellijst haalt blijvend dingen uit een bron. Na elke wijziging aan de dingen
// of de velden van een lijst (`syncFrom`) en elk kwartier (`syncAll`, worker/cron.ts) rekent de server de koppelingen
// opnieuw uit, met de rechten die wie koppelde nu heeft: is die geen beheerder meer van beide lijsten, dan staat de
// koppeling stil (er verandert niets). Een gekoppeld ding is een gewoon ding in de doellijst met eigen voorraad en
// logboek; de naam en de gekoppelde velden volgen de bron (`syncChanges`). Wat het in de doellijst verandert, kan weer
// een bron zijn voor een volgende koppeling (kringen kunnen niet, zie `makesCycle`).

import { referencedItems, referencedPeople, type Attributes } from "../shared/fields";
import { canManage, type List } from "../shared/model";
import { cleanPlan, linkedKeys, MAX_TRANSFER, syncChanges, type MirrorChanges, type TransferPlan } from "../shared/transfer";
import { NAME } from "../shared/views";
import { parseJson, seenLists, toList, toThing, type ListRow, type ThingRowDb } from "./access";
import { prepareData } from "./prepare";
import { peopleByIds, shown, thingRefs } from "./routes/things";
import { brusselsToday } from "./today";

export type MirrorRow = { id: string; list_id: string; source_id: string; plan: string; created_by: string };

/** Hoe diep een wijziging doorloopt langs koppelingen na elkaar (zonder kringen is dat eindig; dit is een rem). */
const MAX_DEPTH = 5;

async function listById(db: D1Database, id: string): Promise<List | null> {
  const row = await db.prepare("SELECT * FROM lists WHERE id = ? AND archived = 0").bind(id).first<ListRow>();
  return row ? toList(row) : null;
}

/** Het plan van een koppeling, nagekeken tegen de velden van nu (null: de lijsten passen niet meer). */
export function mirrorPlan(m: Pick<MirrorRow, "plan">, source: List, target: List): TransferPlan | null {
  try {
    return { ...cleanPlan(parseJson(m.plan, {}), source, target.fields), mode: "link" };
  } catch {
    return null;
  }
}

/** Wat een koppeling in de doellijst vastzet: de naam (als die uit de bron komt, en dat doet ze altijd) en de gekoppelde velden. */
export async function lockedOf(db: D1Database, mirrorId: string): Promise<{ source: { id: string; name: string }; keys: string[] } | null> {
  const m = await db
    .prepare("SELECT m.plan, m.source_id, l.name FROM mirrors m JOIN lists l ON l.id = m.source_id WHERE m.id = ?")
    .bind(mirrorId)
    .first<{ plan: string; source_id: string; name: string }>();
  if (!m) return null;
  const plan = parseJson<Partial<TransferPlan>>(m.plan, {});
  return { source: { id: m.source_id, name: m.name }, keys: [NAME, ...linkedKeys({ fields: plan.fields ?? {} })] };
}

/** Eén koppeling bijwerken; null als ze stilstaat (geen rechten meer, of de lijsten passen niet meer). */
export async function syncMirror(db: D1Database, m: MirrorRow): Promise<MirrorChanges | null> {
  const seen = await seenLists(db, m.created_by);
  if (!canManage(seen.get(m.list_id)) || !canManage(seen.get(m.source_id))) return null;
  const [target, source] = await Promise.all([listById(db, m.list_id), listById(db, m.source_id)]);
  if (!target?.one || !source?.one) return null;
  const plan = mirrorPlan(m, source, target);
  if (!plan) return null;
  const [{ results: sourceRows }, { results: mine }] = await Promise.all([
    db.prepare(`SELECT * FROM things WHERE list_id = ? AND archived = 0 ORDER BY name COLLATE NOCASE LIMIT ${MAX_TRANSFER}`).bind(source.id).all<ThingRowDb>(),
    db.prepare("SELECT id, mirror_of, name, data, archived FROM things WHERE mirror_id = ? AND list_id = ?").bind(m.id, target.id).all<{ id: string; mirror_of: string | null; name: string; data: string; archived: number }>(),
  ]);
  const today = brusselsToday();
  const rows = sourceRows.map(toThing);
  const people = new Map((await peopleByIds(db, rows.flatMap((t) => referencedPeople(source.fields, t.data)))).map((p) => [p.id, p.name]));
  const refs = new Map((await thingRefs(db, seen, rows.flatMap((t) => referencedItems(source.fields, t.data).map((r) => r.id)))).map((r) => [r.id, r.name]));
  const names = { person: (id: string) => people.get(id) ?? "?", item: (id: string) => refs.get(id) ?? "?" };
  const items = rows.map((t) => ({ id: t.id, name: t.name, data: shown(source.fields, t.data, today), tag_ids: [], created_at: t.created_at }));
  const existing = mine.map((t) => ({ id: t.id, mirror_of: t.mirror_of, name: t.name, data: parseJson<Attributes>(t.data, {}), archived: t.archived ? (1 as const) : (0 as const) }));
  const changes = syncChanges(items, plan, source.fields, target.fields, existing, { today, me: m.created_by, names });

  const statements: D1PreparedStatement[] = [];
  const before = new Map(existing.map((e) => [e.id, e.data]));
  for (const r of changes.create) {
    const data = await prepareData(db, m.created_by, seen, target.fields, r.data).catch(() => null);
    if (!data) continue;
    statements.push(
      db
        .prepare("INSERT INTO things (id, list_id, name, data, created_by, mirror_id, mirror_of) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), target.id, r.name, JSON.stringify(data), m.created_by, m.id, r.source_id),
    );
  }
  for (const u of changes.update) {
    const data = await prepareData(db, m.created_by, seen, target.fields, u.data, before.get(u.id)).catch(() => null);
    if (!data) continue;
    statements.push(
      db.prepare("UPDATE things SET name = ?, data = ?, archived = 0, updated_at = datetime('now') WHERE id = ? AND mirror_id = ?").bind(u.name, JSON.stringify(data), u.id, m.id),
    );
  }
  for (const id of changes.archive) statements.push(db.prepare("UPDATE things SET archived = 1, updated_at = datetime('now') WHERE id = ? AND mirror_id = ?").bind(id, m.id));
  for (let k = 0; k < statements.length; k += 100) await db.batch(statements.slice(k, k + 100));
  return changes;
}

const changed = (c: MirrorChanges | null) => Boolean(c && (c.create.length || c.update.length || c.archive.length));

/**
 * Na een wijziging aan de dingen of de velden van een lijst: de koppelingen die eruit halen (en, met `asTarget`, die
 * erin schrijven: hun plan hangt ook van de velden van de doellijst af). Een fout houdt het bewaren niet tegen; het
 * kwartier daarna probeert opnieuw.
 */
export async function syncFrom(db: D1Database, listId: string, opts: { asTarget?: boolean; depth?: number } = {}): Promise<void> {
  const depth = opts.depth ?? 0;
  if (depth > MAX_DEPTH) return;
  try {
    const { results } = await db
      .prepare(`SELECT id, list_id, source_id, plan, created_by FROM mirrors WHERE source_id = ?1 ${opts.asTarget ? "OR list_id = ?1" : ""}`)
      .bind(listId)
      .all<MirrorRow>();
    for (const m of results) {
      const c = await syncMirror(db, m);
      // Wat in de doellijst veranderde, kan de bron zijn van een volgende koppeling.
      if (changed(c)) await syncFrom(db, m.list_id, { depth: depth + 1 });
    }
  } catch (err) {
    console.error("koppeling bijwerken mislukt", listId, err);
  }
}

/** Elk kwartier: alle koppelingen (vangt op wat tussen twee wijzigingen door zou glippen). */
export async function syncAll(db: D1Database): Promise<number> {
  const { results } = await db.prepare("SELECT id, list_id, source_id, plan, created_by FROM mirrors").all<MirrorRow>();
  let n = 0;
  for (const m of results) {
    try {
      if (changed(await syncMirror(db, m))) n++;
    } catch (err) {
      console.error("koppeling bijwerken mislukt", m.id, err);
    }
  }
  return n;
}
