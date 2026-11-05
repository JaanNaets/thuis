// Een melding bij een nieuw item (instelling per lijst, `item_types.notify`): aan niemand, aan iedereen die de lijst
// ziet, of aan wie in een veld van het item staat (Betaald door, Verdeling, Wie). Wie het item toevoegde, krijgt er
// geen; wie een project stilzette (Jouw gegevens → Meldingen), ook niet. Elke melding toont enkel wat die persoon mag
// zien (zie worker/notify.ts).

import type { Attributes, FieldDef, FieldType } from "./fields";

export type NotifyDef = { to: "all" } | { to: "field"; field: string };

/** Velden met mensen: een melding aan wie erin staat. */
export const NOTIFY_FIELD_TYPES: FieldType[] = ["person", "people", "share"];

const KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** Wat binnenkomt of bewaard staat, nagekeken (met `fields`: het veld moet bestaan en mensen bevatten). Niet: null. */
export function cleanNotify(raw: unknown, fields?: FieldDef[]): NotifyDef | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.to === "all") return { to: "all" };
  if (o.to !== "field" || typeof o.field !== "string" || !KEY.test(o.field)) return null;
  if (fields && !fields.some((f) => f.key === o.field && NOTIFY_FIELD_TYPES.includes(f.type))) return null;
  return { to: "field", field: o.field };
}

/** Wie in het veld van de melding staat (ids), of "all". */
export function notifyTargets(def: NotifyDef, data: Attributes): string[] | "all" {
  if (def.to === "all") return "all";
  const v = data[def.field];
  if (typeof v === "string") return [v];
  if (!Array.isArray(v)) return [];
  return [
    ...new Set(
      v.flatMap((x) =>
        typeof x === "string" ? [x] : x && typeof x === "object" && typeof (x as { person_id?: unknown }).person_id === "string" ? [(x as { person_id: string }).person_id] : [],
      ),
    ),
  ];
}

/** Is dit project (of een project erboven) stilgezet? `chain`: het project en die erboven. */
export const isMuted = (muted: string[], chain: string[]) => chain.some((id) => muted.includes(id));

/**
 * De tekst van de melding: "Jana voegde Pizza toe" (één) of "Jana voegde 3 uitgaven toe" (meer, kort na elkaar; het
 * toestel vervangt de vorige melding, zie `tag`). `detail`: wat de lezer van het item mag zien (bv. het bedrag).
 */
export function notifyMessage(o: { author: string; name: string; plural: string; itemName: string; count: number; detail?: string }): { title: string; body: string } {
  if (o.count > 1) return { title: `${o.author} voegde ${o.count} ${o.plural.toLowerCase()} toe`, body: `Laatst: ${o.itemName}${o.detail ? ` · ${o.detail}` : ""}` };
  return { title: `${o.author} voegde ${o.name.toLowerCase()} toe`, body: `${o.itemName}${o.detail ? ` · ${o.detail}` : ""}` };
}
