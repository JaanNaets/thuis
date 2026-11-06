// Een melding bij een nieuwe gebeurtenis (zie shared/alerts.ts), op de achtergrond na het bewaren. Enkel naar wie de
// lijst nu ziet (rechtstreeks of via een regel), nooit naar wie het logde of wie de lijst (of een tag) stilzette.

import { eventPeople, isMuted, notifyMessage } from "../shared/alerts";
import { cleanAppSettings } from "../shared/apps";
import { eventTitle, type List } from "../shared/model";
import type { Person } from "../shared/types";
import { formatEuro } from "../shared/euro";
import { ids, kindOf, listRoles, parseJson, toEvent, type EventRowDb } from "./access";
import { notify } from "./push";
import type { AppEnv } from "./types";

const MAX_RECIPIENTS = 40;
const BUNDLE_MINUTES = 10;

export async function notifyNewEvent(env: AppEnv["Bindings"], author: Pick<Person, "id" | "name">, list: List, eventId: string): Promise<number> {
  const db = env.DB;
  if (!list.notify) return 0;
  const row = await db.prepare("SELECT * FROM events WHERE id = ?").bind(eventId).first<EventRowDb>();
  if (!row) return 0;
  const event = toEvent(row);
  const { index, candidates } = await listRoles(db, list.id);
  const wanted = list.notify.to === "people" ? new Set(eventPeople(event)) : null;
  const recipients = index
    .people(list.id, candidates)
    .filter((p) => p.role && p.person_id !== author.id && (!wanted || wanted.has(p.person_id)))
    .map((p) => p.person_id)
    .slice(0, MAX_RECIPIENTS);
  if (!recipients.length) return 0;
  const [people, tags, lines, count] = (await db.batch([
    db.prepare("SELECT id, app_settings FROM people WHERE id IN (SELECT value FROM json_each(?))").bind(ids(recipients)),
    db.prepare("SELECT tag_id FROM list_tag_links WHERE list_id = ?").bind(list.id),
    db.prepare("SELECT l.role, l.thing_id, l.text, t.name FROM lines l LEFT JOIN things t ON t.id = l.thing_id WHERE l.event_id = ? ORDER BY l.position").bind(event.id),
    db
      .prepare(`SELECT COUNT(*) AS n FROM events WHERE list_id = ? AND created_by = ? AND created_at >= datetime('now', '-${BUNDLE_MINUTES} minutes')`)
      .bind(list.id, author.id),
  ])) as [
    D1Result<{ id: string; app_settings: string | null }>,
    D1Result<{ tag_id: string }>,
    D1Result<{ role: "in" | "uit" | "voor" | "bij"; thing_id: string | null; text: string | null; name: string | null }>,
    D1Result<{ n: number }>,
  ];
  const kind = await kindOf(db, event.kind, event.base);
  const names = new Map(lines.results.flatMap((l) => (l.thing_id && l.name ? [[l.thing_id, l.name] as const] : [])));
  const title = eventTitle({ name: event.name, lines: lines.results.map((l) => ({ ...l, id: "", position: 0, amount: null, unit: null, price: null, expires: null, owner: null })) }, kind, (id) => names.get(id));
  const n = count.results[0]?.n ?? 1;
  const tagIds = tags.results.map((t) => t.tag_id);
  let sent = 0;
  for (const p of people.results) {
    const settings = cleanAppSettings(parseJson(p.app_settings, null));
    if (isMuted(settings.muted, list.id, tagIds)) continue;
    const message = notifyMessage({ author: author.name, kind: kind.name, list: list.name, title, count: n, detail: event.amount !== null ? formatEuro(event.amount) : undefined });
    sent += await notify(db, p.id, { ...message, url: n > 1 ? `/lijsten/${list.id}?tab=logboek` : `/gebeurtenissen/${event.id}`, tag: `log-${list.id}-${author.id}` });
  }
  return sent;
}
