// De ingebouwde weergaven: uitgerekend op de server uit wat de lezer ziet, nooit bewaard. Over alle lijsten heen
// tellen enkel gebeurtenissen die je helemaal ziet (een lijn via een ding geeft geen bedrag of verdeling).

import { Hono } from "hono";
import { computeLocal } from "../../shared/calc";
import { canAgenda, MAX_AGENDA_DAYS, occurrences, daysApart } from "../../shared/agenda";
import type { FieldDef } from "../../shared/fields";
import { foodPerPerson, type FoodEvent, type Nutrition } from "../../shared/food";
import { isExpense, netBalance, settleUp, sharesOf, type MoneyEvent } from "../../shared/ledger";
import { canEdit, dayOf, type EventView, type Role } from "../../shared/model";
import { ids, kindsFor, parseJson, seenLists, toList, toThing, type EventRowDb, type ListRow, type ThingRowDb } from "../access";
import { viewEvents } from "../events-view";
import { brusselsToday } from "../today";
import type { AppEnv } from "../types";
import { ValidationError } from "../validate";
import { peopleByIds, stockOf } from "./things";

export const insights = new Hono<AppEnv>();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const range = (from: string | undefined, to: string | undefined, today: string): [string, string] => {
  const f = from && DATE.test(from) ? from : `${today.slice(0, 7)}-01`;
  const t = to && DATE.test(to) ? to : today;
  if (t < f) throw new ValidationError("Het einde ligt voor het begin");
  return [f, t];
};

/** Gebeurtenissen in de lijsten die je ziet (helemaal), met een extra voorwaarde. */
async function fullRows(db: D1Database, seen: Map<string, Role>, where: string, binds: unknown[], order = "e.at DESC, e.created_at DESC", limit = 2000): Promise<EventRowDb[]> {
  const { results } = await db
    .prepare(`SELECT e.* FROM events e WHERE e.list_id IN (SELECT value FROM json_each(?1)) AND ${where} ORDER BY ${order} LIMIT ${limit}`)
    .bind(ids(seen.keys()), ...binds)
    .all<EventRowDb>();
  return results;
}

const money = (e: EventView): MoneyEvent => ({ ...e, lines: e.lines.map((l) => ({ price: l.price, owner: l.owner })) });

// ---------- geld ----------

/**
 * Uitgaven over je lijsten: per maand, per soort, per lijst en per winkel, met jouw deel. `from`–`to` (standaard deze
 * maand), en de gebeurtenissen zelf (nieuwste eerst).
 */
insights.get("/money", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const seen = await seenLists(db, me.id);
  const [from, to] = range(c.req.query("from"), c.req.query("to"), brusselsToday());
  const rows = await fullRows(db, seen, "e.status = 'gebeurd' AND e.amount IS NOT NULL AND e.base != 'overdracht' AND e.at >= ?2 AND e.at < ?3", [from, `${to}~`]);
  const page = await viewEvents(db, seen, rows);
  const things = new Map(page.things.map((t) => [t.id, t.name]));
  const kinds = new Map(page.kinds.map((k) => [k.id, k.name]));
  const lists = new Map(page.lists.map((l) => [l.id, l.name]));
  type Sum = { key: string; label: string; total: number; mine: number };
  const groups = { month: new Map<string, Sum>(), kind: new Map<string, Sum>(), list: new Map<string, Sum>(), store: new Map<string, Sum>() };
  const add = (g: Map<string, Sum>, key: string, label: string, total: number, mine: number) => {
    const s = g.get(key) ?? { key, label, total: 0, mine: 0 };
    s.total += total;
    s.mine += mine;
    g.set(key, s);
  };
  let total = 0;
  let mine = 0;
  for (const e of page.events) {
    const m = money(e);
    if (!isExpense(m)) continue;
    const yours = sharesOf(m).get(me.id) ?? 0;
    total += e.amount!;
    mine += yours;
    add(groups.month, e.at.slice(0, 7), e.at.slice(0, 7), e.amount!, yours);
    add(groups.kind, e.kind, kinds.get(e.kind) ?? e.kind, e.amount!, yours);
    add(groups.list, e.list_id, lists.get(e.list_id) ?? "", e.amount!, yours);
    const store = e.lines.find((l) => l.role === "bij");
    const storeName = store ? (store.thing_id ? things.get(store.thing_id) : store.text) : null;
    if (storeName) add(groups.store, store!.thing_id ?? `t:${storeName}`, storeName, e.amount!, yours);
  }
  const sorted = (g: Map<string, Sum>) => [...g.values()].sort((a, b) => b.total - a.total);
  return c.json({
    from,
    to,
    total,
    mine,
    months: [...groups.month.values()].sort((a, b) => a.key.localeCompare(b.key)),
    by_kind: sorted(groups.kind),
    by_list: sorted(groups.list),
    by_store: sorted(groups.store).slice(0, 12),
    ...page,
    events: page.events.slice(0, 200),
  });
});

/**
 * Wie moet wie: over alle uitgaven met een betaler en alle overdrachten die je ziet. Per overschrijving een lijst om
 * de terugbetaling in te loggen: waar jullie het laatst samen iets in logden en jij mag loggen.
 */
insights.get("/balance", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const seen = await seenLists(db, me.id);
  const rows = await fullRows(db, seen, "e.status = 'gebeurd' AND e.amount IS NOT NULL AND e.paid_by IS NOT NULL", [], "e.at DESC", 5000);
  const page = await viewEvents(db, seen, rows);
  const events = page.events.map(money);
  const net = netBalance(events);
  const transfers = settleUp(net).map((t) => {
    const both = page.events.find((e) => canEdit(seen.get(e.list_id)) && [e.paid_by, ...(e.split ?? []).map((s) => s.person_id)].includes(t.from) && [e.paid_by, ...(e.split ?? []).map((s) => s.person_id)].includes(t.to));
    return { ...t, list_id: both?.list_id ?? null };
  });
  return c.json({
    net: [...net].map(([person_id, amount]) => ({ person_id, amount })).sort((a, b) => b.amount - a.amount),
    transfers,
    people: await peopleByIds(db, [...net.keys()]),
    ibans: await ibansFor(db, transfers.map((t) => t.to)),
  });
});

/** Rekeningnummers van wie iets krijgt (om te betalen met een QR). */
async function ibansFor(db: D1Database, personIds: string[]): Promise<Record<string, string>> {
  if (!personIds.length) return {};
  const { results } = await db.prepare("SELECT id, iban FROM people WHERE iban IS NOT NULL AND id IN (SELECT value FROM json_each(?))").bind(ids(personIds)).all<{ id: string; iban: string }>();
  return Object.fromEntries(results.map((r) => [r.id, r.iban]));
}

// ---------- voorraad ----------

/** Alles in een voorraad die je ziet, wat op of bijna op is eerst. */
insights.get("/stock", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const seen = await seenLists(db, me.id);
  const { results: listRows } = await db
    .prepare("SELECT * FROM lists WHERE stock IS NOT NULL AND archived = 0 AND id IN (SELECT value FROM json_each(?))")
    .bind(ids(seen.keys()))
    .all<ListRow>();
  const out: { id: string; name: string; list_id: string; list: string; amount: number; unit: string | null; low: boolean; expires: string | null }[] = [];
  for (const list of listRows.map(toList)) {
    const { results } = await db.prepare("SELECT * FROM things WHERE list_id = ? AND archived = 0 ORDER BY name LIMIT 2000").bind(list.id).all<ThingRowDb>();
    const rows = results.map(toThing);
    const levels = await stockOf(db, list, rows);
    for (const t of rows) {
      const s = levels.get(t.id);
      if (s) out.push({ id: t.id, name: t.name, list_id: list.id, list: list.name, ...s });
    }
  }
  out.sort((a, b) => Number(b.low) - Number(a.low) || (a.expires ?? "9").localeCompare(b.expires ?? "9") || a.name.localeCompare(b.name, "nl"));
  return c.json({ things: out });
});

// ---------- eten ----------

/** Wat er gegeten werd, per dag en per persoon (kcal en voedingswaarden). */
insights.get("/food", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const seen = await seenLists(db, me.id);
  const today = brusselsToday();
  const [from, to] = range(c.req.query("from") ?? addDays(today, -6), c.req.query("to"), today);
  const rows = await fullRows(db, seen, "e.status = 'gebeurd' AND e.base = 'gebruik' AND e.at >= ?2 AND e.at < ?3", [from, `${to}~`]);
  const page = await viewEvents(db, seen, rows);
  // De dingen met hun velden (productinfo) en voorraad-eenheden, ook uit lijsten die je niet ziet (enkel de getallen).
  const thingIds = [...new Set(page.events.flatMap((e) => e.lines.flatMap((l) => (l.thing_id ? [l.thing_id] : []))))];
  const { results: tRows } = await db
    .prepare("SELECT t.id, t.data, l.fields, l.stock FROM things t JOIN lists l ON l.id = t.list_id WHERE t.id IN (SELECT value FROM json_each(?))")
    .bind(ids(thingIds))
    .all<{ id: string; data: string; fields: string; stock: string | null }>();
  const things = new Map(tRows.map((t) => [t.id, { fields: parseJson<FieldDef[]>(t.fields, []), data: parseJson(t.data, {}), stock: parseJson(t.stock, null) }]));
  const kinds = new Map(page.kinds.map((k) => [k.id, k]));
  const byDay = new Map<string, FoodEvent[]>();
  for (const e of page.events) {
    const fe: FoodEvent = {
      base: e.base,
      status: e.status,
      split: e.split,
      created_by: e.created_by,
      fields: kinds.get(e.kind)?.fields ?? [],
      data: e.data,
      lines: e.lines.map((l) => ({ role: l.role, amount: l.amount, unit: l.unit, thing: l.thing_id ? (things.get(l.thing_id) ?? null) : null })),
    };
    const day = dayOf(e.at);
    byDay.set(day, [...(byDay.get(day) ?? []), fe]);
  }
  const days: { day: string; people: Record<string, Nutrition> }[] = [];
  const who = new Set<string>();
  for (const [day, list] of [...byDay].sort((a, b) => b[0].localeCompare(a[0]))) {
    const per = foodPerPerson(list);
    for (const id of per.keys()) who.add(id);
    days.push({ day, people: Object.fromEntries(per) });
  }
  return c.json({ from, to, days, eaters: await peopleByIds(db, who), ...page });
});

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ---------- te doen, agenda, timers ----------

/** Alles wat gepland staat in de lijsten die je ziet, het vroegste eerst. */
insights.get("/todo", async (c) => {
  const db = c.env.DB;
  const seen = await seenLists(db, c.get("person").id);
  const rows = await fullRows(db, seen, "e.status = 'gepland'", [], "e.at ASC, e.created_at ASC", 500);
  return c.json(await viewEvents(db, seen, rows));
});

/** Wat op een dag valt: gebeurtenissen (ook gepland) en datums van dingen met "In de agenda". */
insights.get("/agenda", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const seen = await seenLists(db, me.id);
  const today = brusselsToday();
  const [from, to] = range(c.req.query("from"), c.req.query("to") ?? addDays(today, 31), today);
  if (daysApart(from, to) > MAX_AGENDA_DAYS) throw new ValidationError("Hoogstens twee maanden tegelijk");
  const rows = await fullRows(db, seen, "e.at >= ?2 AND e.at < ?3 AND e.status != 'afgevinkt'", [from, `${to}~`], "e.at ASC", 1000);
  const page = await viewEvents(db, seen, rows);
  // Datums van dingen (garantie, vervaldatum, verjaardag) in lijsten met een agendaveld.
  const { results: listRows } = await db.prepare("SELECT * FROM lists WHERE id IN (SELECT value FROM json_each(?)) AND archived = 0").bind(ids(seen.keys())).all<ListRow>();
  const dated: { thing_id: string; name: string; list_id: string; label: string; start: string; end?: string }[] = [];
  for (const list of listRows.map(toList)) {
    const fields = list.fields.filter((f) => f.agenda && canAgenda(f));
    if (!fields.length) continue;
    const { results } = await db.prepare("SELECT * FROM things WHERE list_id = ? AND archived = 0").bind(list.id).all<ThingRowDb>();
    for (const t of results.map(toThing)) {
      const data = computeLocal(list.fields, t.data, today);
      for (const f of fields) for (const o of occurrences(f, data[f.key], from, to)) dated.push({ thing_id: t.id, name: t.name, list_id: list.id, label: f.label, ...o });
    }
  }
  return c.json({ from, to, ...page, dated });
});

/** Activiteiten die nu lopen (een timer), van jou of in een lijst die je ziet. */
insights.get("/timers", async (c) => {
  const db = c.env.DB;
  const seen = await seenLists(db, c.get("person").id);
  const rows = await fullRows(db, seen, "e.base = 'activiteit' AND e.end_at IS NULL AND length(e.at) > 10 AND e.status = 'gebeurd'", [], "e.at DESC", 20);
  return c.json(await viewEvents(db, seen, rows));
});

// ---------- zoeken ----------

insights.get("/search", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const q = c.req.query("q")?.trim() ?? "";
  if (q.length < 2) return c.json({ lists: [], things: [], events: [] });
  const seen = await seenLists(db, me.id);
  const like = `%${q}%`;
  const [lists, things, events] = (await db.batch([
    db.prepare("SELECT id, name, icon, color FROM lists WHERE id IN (SELECT value FROM json_each(?1)) AND name LIKE ?2 LIMIT 8").bind(ids(seen.keys()), like),
    db
      .prepare(
        `SELECT t.id, t.name, t.list_id, l.name AS list, l.icon FROM things t JOIN lists l ON l.id = t.list_id
         WHERE t.list_id IN (SELECT value FROM json_each(?1)) AND t.name LIKE ?2 ORDER BY t.archived, t.name LIMIT 20`,
      )
      .bind(ids(seen.keys()), like),
    db
      .prepare(
        `SELECT e.id, e.name, e.at, e.kind, e.base, e.list_id, l.name AS list FROM events e JOIN lists l ON l.id = e.list_id
         WHERE e.list_id IN (SELECT value FROM json_each(?1)) AND e.name LIKE ?2 ORDER BY e.at DESC LIMIT 12`,
      )
      .bind(ids(seen.keys()), like),
  ])) as [D1Result<{ id: string; name: string }>, D1Result<{ id: string; name: string }>, D1Result<{ id: string; name: string; kind: string }>];
  return c.json({ lists: lists.results, things: things.results, events: events.results, kinds: await kindsFor(db, seen.keys()) });
});
