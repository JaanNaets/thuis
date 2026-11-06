// Het logboek als tabel: een gebeurtenis heeft vaste delen (wanneer, soort, bedrag, wie, status, lijst, dingen, waar,
// duur). Als velden voorgesteld, werken filters, sorteren, groeperen en grafieken (shared/views.ts, shared/charts.ts)
// er net zoals op de velden van een lijst.

import type { FieldDef } from "./fields.ts";
import { sharesOf } from "./ledger.ts";
import { minutesBetween, STATUSES, type EventView, type KindInfo } from "./model.ts";
import type { ViewItem } from "./views.ts";

export const LOG_KEYS = ["at", "kind", "amount", "mine", "paid_by", "who", "status", "list", "things", "store", "duration"] as const;
export type LogKey = (typeof LOG_KEYS)[number];

/** De velden van het logboek, met de keuzes die er nu zijn (soorten en lijsten). */
export function logFields(kinds: Pick<KindInfo, "name">[], lists: { name: string }[]): FieldDef[] {
  const names = (xs: { name: string }[]) => [...new Set(xs.map((x) => x.name))].slice(0, 60);
  return [
    { key: "at", label: "Wanneer", type: "date" },
    { key: "kind", label: "Soort", type: "select", options: names(kinds).length ? names(kinds) : ["—"] },
    { key: "amount", label: "Bedrag", type: "money" },
    { key: "mine", label: "Jouw deel", type: "money" },
    { key: "paid_by", label: "Betaald door", type: "person" },
    { key: "who", label: "Wie", type: "people" },
    { key: "status", label: "Status", type: "select", options: Object.values(STATUSES).map((s) => s.label) },
    { key: "list", label: "Lijst", type: "select", options: names(lists).length ? names(lists) : ["—"] },
    { key: "things", label: "Dingen", type: "items", ref_type: "dingen" },
    { key: "store", label: "Waar", type: "item", ref_type: "dingen" },
    { key: "duration", label: "Duur", type: "duration" },
  ];
}

/** Een gebeurtenis als rij voor een weergave of grafiek. */
export function logItem(e: EventView, ctx: { kind: string; list: string; me: string; title: string }): ViewItem & { created_at: string } {
  const data: ViewItem["data"] = { at: e.at.slice(0, 10), kind: ctx.kind, status: STATUSES[e.status].label, list: ctx.list };
  if (e.amount !== null) {
    data.amount = e.amount;
    const mine = sharesOf({ ...e, lines: e.lines.map((l) => ({ price: l.price, owner: l.owner })) }).get(ctx.me);
    if (mine) data.mine = mine;
  }
  if (e.paid_by) data.paid_by = e.paid_by;
  const who = (e.split ?? []).map((s) => s.person_id);
  if (who.length) data.who = who;
  const things = e.lines.filter((l) => l.role !== "bij" && l.thing_id).map((l) => l.thing_id!);
  if (things.length) data.things = [...new Set(things)];
  const store = e.lines.find((l) => l.role === "bij" && l.thing_id);
  if (store) data.store = store.thing_id!;
  const minutes = e.end_at ? minutesBetween(e.at, e.end_at) : null;
  if (minutes !== null && minutes >= 0) data.duration = minutes;
  return { name: ctx.title, data, tag_ids: [], created_at: e.created_at };
}
