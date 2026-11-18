// Een melding bij een nieuwe gebeurtenis (zie shared/alerts.ts), op de achtergrond na het bewaren. Het formulier zegt
// of en aan wie (`notify`): enkel wie de gebeurtenis ziet (het formulier, en raakt ze lijsten, minstens één ervan: zie
// `eventRole`), nooit wie het logde of wie het formulier (of een tag ervan) stilzette.

import { eventPeople, isMuted, notifyMessage } from "../shared/alerts";
import { cleanAppSettings } from "../shared/apps";
import { eventTitle } from "../shared/model";
import type { Person } from "../shared/types";
import { formatEuro } from "../shared/euro";
import { formRoles, ids, parseJson, seenLists, toEvent, toKind, type EventRowDb, type KindRowDb } from "./access";
import { touchedLists } from "./events-view";
import { notify } from "./push";
import type { AppEnv } from "./types";
import { kindInfo } from "../shared/model";

const MAX_RECIPIENTS = 40;
const BUNDLE_MINUTES = 10;

export async function notifyNewEvent(env: AppEnv["Bindings"], author: Pick<Person, "id" | "name">, eventId: string): Promise<number> {
  const db = env.DB;
  const row = await db.prepare("SELECT * FROM events WHERE id = ?").bind(eventId).first<EventRowDb>();
  if (!row) return 0;
  const formRow = await db.prepare("SELECT * FROM kinds WHERE id = ?").bind(row.kind).first<KindRowDb>();
  if (!formRow) return 0;
  const form = toKind(formRow);
  if (!form.notify) return 0;
  const event = toEvent(row);
  const { index, candidates } = await formRoles(db, form.id);
  const wanted = form.notify.to === "people" ? new Set(eventPeople(event)) : null;
  const touched = (await touchedLists(db, [event.id])).get(event.id) ?? [];
  const sees = async (person: string) => !touched.length || [...(await seenLists(db, person)).keys()].some((l) => touched.includes(l));
  const recipients: string[] = [];
  for (const p of index.people(form.id, candidates)) {
    if (recipients.length >= MAX_RECIPIENTS) break;
    if (p.role && p.person_id !== author.id && (!wanted || wanted.has(p.person_id)) && (await sees(p.person_id))) recipients.push(p.person_id);
  }
  if (!recipients.length) return 0;
  const [people, tags, lines, count] = (await db.batch([
    db.prepare("SELECT id, app_settings FROM people WHERE id IN (SELECT value FROM json_each(?))").bind(ids(recipients)),
    db.prepare("SELECT tag_id FROM form_tag_links WHERE form_id = ?").bind(form.id),
    db.prepare("SELECT l.role, l.item_id, l.text, t.name FROM lines l LEFT JOIN items t ON t.id = l.item_id WHERE l.event_id = ? ORDER BY l.position").bind(event.id),
    db
      .prepare(`SELECT COUNT(*) AS n FROM events WHERE kind = ? AND created_by = ? AND created_at >= datetime('now', '-${BUNDLE_MINUTES} minutes')`)
      .bind(form.id, author.id),
  ])) as [
    D1Result<{ id: string; app_settings: string | null }>,
    D1Result<{ tag_id: string }>,
    D1Result<{ role: "in" | "uit" | "voor" | "bij"; item_id: string | null; text: string | null; name: string | null }>,
    D1Result<{ n: number }>,
  ];
  const kind = kindInfo(form);
  const names = new Map(lines.results.flatMap((l) => (l.item_id && l.name ? [[l.item_id, l.name] as const] : [])));
  const title = eventTitle({ name: event.name, lines: lines.results.map((l) => ({ ...l, id: "", position: 0, amount: null, unit: null, price: null, expires: null, owner: null })) }, kind, (id) => names.get(id));
  const n = count.results[0]?.n ?? 1;
  const tagIds = tags.results.map((t) => t.tag_id);
  let sent = 0;
  for (const p of people.results) {
    const settings = cleanAppSettings(parseJson(p.app_settings, null));
    if (isMuted(settings.muted, form.id, tagIds)) continue;
    const message = notifyMessage({ author: author.name, kind: kind.name, title, count: n, detail: event.amount !== null ? formatEuro(event.amount) : undefined });
    sent += await notify(db, p.id, { ...message, url: n > 1 ? `/formulieren/${form.id}` : `/gebeurtenissen/${event.id}`, tag: `log-${form.id}-${author.id}` });
  }
  return sent;
}
