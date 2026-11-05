// Een melding bij een nieuw item (zie shared/notify.ts): na het bewaren, op de achtergrond. Enkel naar mensen in het
// project (of erboven) die de lijst (en bij "wie erin staat" dat veld) nu mogen zien, nooit naar wie het toevoegde of
// wie het project stilzette. Elke melding toont enkel wat die persoon mag zien. Voegt iemand er kort na elkaar meer
// toe, dan vervangt het toestel de vorige melding (`tag`): "Jana voegde 3 uitgaven toe".

import { fieldAccess, typeAccess, visibleData } from "../shared/access";
import { cleanAppSettings } from "../shared/apps";
import { formatFieldValue, type Attributes } from "../shared/fields";
import { isMuted, notifyMessage, notifyTargets } from "../shared/notify";
import type { ItemType } from "../shared/types";
import { projectAccess, type ProjectAccess } from "./context";
import { notify } from "./push";

/** Zoveel mensen hoogstens per melding (een huishouden, een reis). */
const MAX_RECIPIENTS = 40;
/** Wat iemand in zoveel minuten in dezelfde lijst toevoegt, is één melding. */
const BUNDLE_MINUTES = 10;

export async function notifyNewItem(
  db: D1Database,
  author: { id: string; name: string },
  access: ProjectAccess,
  type: ItemType,
  item: { id: string; name: string; data: Attributes },
): Promise<number> {
  const def = type.notify;
  if (!def) return 0;
  const { results: members } = await db
    .prepare("SELECT DISTINCT person_id FROM memberships WHERE project_id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(access.chain))
    .all<{ person_id: string }>();
  const targets = notifyTargets(def, item.data);
  const ids = members
    .map((m) => m.person_id)
    .filter((id) => id !== author.id && (targets === "all" || targets.includes(id)))
    .slice(0, MAX_RECIPIENTS);
  if (!ids.length) return 0;
  const { results: people } = await db
    .prepare("SELECT id, app_settings FROM people WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(ids))
    .all<{ id: string; app_settings: string | null }>();
  const count =
    (
      await db
        .prepare(`SELECT COUNT(*) AS n FROM items WHERE project_id = ? AND type_id = ? AND created_by = ? AND created_at >= datetime('now', '-${BUNDLE_MINUTES} minutes')`)
        .bind(access.project.id, type.id, author.id)
        .first<{ n: number }>()
    )?.n ?? 1;
  let sent = 0;
  for (const p of people) {
    let settings;
    try {
      settings = cleanAppSettings(p.app_settings ? JSON.parse(p.app_settings) : null);
    } catch {
      settings = cleanAppSettings(null);
    }
    if (isMuted(settings.muted, access.chain)) continue;
    // Wat die persoon nu mag, in het project van het item (met zijn eigen rol).
    const theirs = await projectAccess(db, p.id, access.project.id);
    if (!theirs || typeAccess(theirs.rights, type.id) === "none") continue;
    if (def.to === "field" && fieldAccess(theirs.rights, type.id, def.field) === "none") continue;
    const seen = visibleData(theirs.rights, type.id, type.fields, item.data);
    // Een bedrag (of anders een getal met een eenheid) als korte uitleg, als die persoon het mag zien.
    const money = type.fields.find((f) => f.type === "money" && seen[f.key] !== undefined && seen[f.key] !== null);
    const detail = money ? formatFieldValue(money, seen[money.key]) : undefined;
    const message = notifyMessage({ author: author.name, name: type.name, plural: type.plural, itemName: item.name, count, detail });
    sent += await notify(db, p.id, {
      ...message,
      url: count > 1 ? `/projecten/${access.project.id}?lijst=${type.id}` : `/items/${item.id}`,
      tag: `nieuw-${type.id}-${author.id}`,
    });
  }
  return sent;
}
