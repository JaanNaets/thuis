// De ingebouwde weergaven: uitgerekend op de server uit wat de lezer ziet, nooit bewaard. Over alle lijsten heen
// tellen enkel gebeurtenissen die je helemaal ziet (een lijn via een ding geeft geen bedrag of verdeling).

import { Hono } from "hono";
import { computeLocal } from "../../shared/calc";
import { canAgenda, MAX_AGENDA_DAYS, occurrences, daysApart } from "../../shared/agenda";
import type { FieldDef } from "../../shared/fields";
import { foodPerPerson, hasKcal, isFood, type FoodEvent, type Nutrition } from "../../shared/food";
import { buildLinks, linkProblems, type BoardUse, type LineThing, type LinkKindDef, type LinkPersonView, type LinePair, type LineStat, type LinksResponse, type LogStat } from "../../shared/links";
import { isExpense, netBalance, settleUp, sharesOf, type MoneyEvent } from "../../shared/ledger";
import { canEdit, dayOf, type EventView, type Role } from "../../shared/model";
import { ids, kindsFor, parseJson, seenLists, toKind, toList, toThing, type EventRowDb, type KindRowDb, type ListRow, type ThingRowDb } from "../access";
import { logbookRows, viewEvents } from "../events-view";
import { brusselsToday } from "../today";
import type { AppEnv } from "../types";
import { ValidationError } from "../validate";
import { listPeople } from "./lists";
import { boardsOf } from "./me";
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
  const food = new Set<string>();
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
    if (!isFood(fe)) continue;
    food.add(e.id);
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
  return c.json({ from, to, days, eaters: await peopleByIds(db, who), ...page, events: page.events.filter((e) => food.has(e.id)) });
});

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ---------- logboek over een periode (grafieken) ----------

/**
 * Wat gebeurde in een lijst (`list`, met wat elders met haar dingen gebeurde) of over al je lijsten, in `from`–`to`:
 * voor een grafiek over het logboek. Hoogstens 2000.
 */
insights.get("/log", async (c) => {
  const db = c.env.DB;
  const seen = await seenLists(db, c.get("person").id);
  const today = brusselsToday();
  const [from, to] = range(c.req.query("from") ?? "1900-01-01", c.req.query("to"), today);
  const list = c.req.query("list");
  if (list) {
    if (!seen.has(list)) throw new ValidationError("Die lijst ken je niet");
    const rows = await logbookRows(db, list, { from, to, limit: 2000 });
    return c.json(await viewEvents(db, seen, rows));
  }
  const rows = await fullRows(db, seen, "e.at >= ?2 AND e.at < ?3", [from, `${to}~`], "e.at DESC", 2000);
  return c.json(await viewEvents(db, seen, rows));
});

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

// ---------- verbanden ----------

/** Zoveel lijsten krijgen hun mensen erbij (de rest van de kaart werkt gewoon). */
const LINK_PEOPLE_LISTS = 80;

/**
 * Hoe je lijsten samenhangen (zie shared/links.ts): enkel je lijsten (niet gearchiveerd) en tellingen over
 * gebeurtenissen in die lijsten met lijnen naar dingen in die lijsten; wie een gebeurtenis in haar lijst ziet, ziet ze
 * helemaal. De problemen enkel waar je een van beide lijsten beheert.
 */
insights.get("/links", async (c) => {
  const db = c.env.DB;
  const me = c.get("person").id;
  const seen = await seenLists(db, me);
  const { results: listRows } = await db.prepare("SELECT * FROM lists WHERE archived = 0 AND id IN (SELECT value FROM json_each(?))").bind(ids(seen.keys())).all<ListRow>();
  const lists = listRows.map(toList).map((l) => ({ ...l, role: seen.get(l.id)! }));
  const listIds = ids(lists.map((l) => l.id));

  // De soorten van je lijsten en die je gebeurtenissen gebruiken; wat als eten telt (kcal in de soort of het ding).
  const [kindRows, kcalRows] = (await db.batch([
    db.prepare("SELECT * FROM kinds WHERE list_id IN (SELECT value FROM json_each(?1)) OR id IN (SELECT DISTINCT kind FROM events WHERE list_id IN (SELECT value FROM json_each(?1)))").bind(listIds),
    db.prepare(`SELECT id, fields FROM lists WHERE fields LIKE '%"product":"kcal"%'`),
  ])) as [D1Result<KindRowDb>, D1Result<{ id: string; fields: string }>];
  const kinds: LinkKindDef[] = kindRows.results.map(toKind);
  const kcalKinds = kinds.filter((k) => hasKcal(k.fields)).map((k) => k.id);
  const kcalLists = kcalRows.results.filter((r) => hasKcal(parseJson<FieldDef[]>(r.fields, []))).map((r) => r.id);

  const done = "MAX(CASE WHEN e.status != 'gepland' THEN substr(e.at, 1, 10) END)";
  const inLists = "(SELECT value FROM json_each(?1))";
  const [logRows, lineRows, pairRows, thingLineRows, thingRows] = (await db.batch([
    db
      .prepare(
        `SELECT e.list_id AS list, e.kind, e.base, COUNT(*) AS events,
           SUM(e.status = 'gebeurd' AND e.amount IS NOT NULL AND e.base != 'overdracht') AS money,
           SUM(e.status = 'gebeurd' AND e.amount IS NOT NULL AND e.paid_by IS NOT NULL
               AND (e.split IS NOT NULL OR e.base = 'overdracht' OR EXISTS (SELECT 1 FROM lines o WHERE o.event_id = e.id AND o.owner IS NOT NULL))) AS shared,
           SUM(e.status = 'gepland') AS planned,
           SUM(e.repeat IS NOT NULL) AS repeats,
           SUM(e.base = 'activiteit' AND e.end_at IS NULL AND length(e.at) > 10 AND e.status = 'gebeurd') AS running,
           SUM(e.base = 'gebruik' AND e.status = 'gebeurd' AND (e.kind IN (SELECT value FROM json_each(?2))
               OR EXISTS (SELECT 1 FROM lines f JOIN things ft ON ft.id = f.thing_id
                          WHERE f.event_id = e.id AND f.role = 'uit' AND ft.list_id IN (SELECT value FROM json_each(?3))))) AS food,
           ${done} AS last
         FROM events e WHERE e.list_id IN ${inLists} GROUP BY e.list_id, e.kind, e.base`,
      )
      .bind(listIds, JSON.stringify(kcalKinds), JSON.stringify(kcalLists)),
    db
      .prepare(
        `SELECT e.list_id AS list, e.kind, e.base, l.role, t.list_id AS "to", COUNT(DISTINCT e.id) AS events, ${done} AS last
         FROM lines l JOIN events e ON e.id = l.event_id JOIN things t ON t.id = l.thing_id
         WHERE e.list_id IN ${inLists} AND t.list_id IN ${inLists}
         GROUP BY e.list_id, e.kind, e.base, l.role, t.list_id`,
      )
      .bind(listIds),
    db
      .prepare(
        `SELECT e.list_id AS list, t.list_id AS "to", COUNT(DISTINCT e.id) AS events, ${done} AS last
         FROM lines l JOIN events e ON e.id = l.event_id JOIN things t ON t.id = l.thing_id
         WHERE e.list_id IN ${inLists} AND t.list_id IN ${inLists} AND e.list_id != t.list_id
         GROUP BY e.list_id, t.list_id`,
      )
      .bind(listIds),
    // Welke dingen er in een verband zitten (enkel dingen van lijsten die je ziet).
    db
      .prepare(
        `SELECT e.list_id AS list, t.list_id AS "to", t.id AS thing, t.name, COUNT(DISTINCT e.id) AS events
         FROM lines l JOIN events e ON e.id = l.event_id JOIN things t ON t.id = l.thing_id
         WHERE e.list_id IN ${inLists} AND t.list_id IN ${inLists} AND e.list_id != t.list_id
         GROUP BY e.list_id, t.id`,
      )
      .bind(listIds),
    db.prepare(`SELECT list_id, COUNT(*) AS n FROM things WHERE archived = 0 AND list_id IN ${inLists} GROUP BY list_id`).bind(listIds),
  ])) as [D1Result<LogStat>, D1Result<LineStat>, D1Result<LinePair>, D1Result<LineThing>, D1Result<{ list_id: string; n: number }>];

  // Je overzichten: welke blokken een lijst tonen (een ding: zijn lijst).
  const boards = await boardsOf(db, me);
  const thingIds = boards.flatMap((b) => (b.blocks ?? []).flatMap((x) => (x.kind === "thing" ? [x.thing] : [])));
  const thingList = new Map<string, string>();
  if (thingIds.length) {
    const { results } = await db.prepare("SELECT id, list_id FROM things WHERE id IN (SELECT value FROM json_each(?))").bind(ids(thingIds)).all<{ id: string; list_id: string }>();
    for (const r of results) thingList.set(r.id, r.list_id);
  }
  const uses: BoardUse[] = boards.flatMap((b) =>
    (b.blocks ?? []).flatMap((x): BoardUse[] => {
      if (x.kind === "list" || x.kind === "quick") return [{ board: b.name, list: x.list, block: x.kind }];
      if (x.kind === "chart" && x.list) return [{ board: b.name, list: x.list, block: "chart" }];
      const list = x.kind === "thing" ? thingList.get(x.thing) : undefined;
      return list ? [{ board: b.name, list, block: "thing" }] : [];
    }),
  );

  const { links, own } = buildLinks({ lists, kinds, log: logRows.results, lines: lineRows.results, pairs: pairRows.results, things: thingLineRows.results, boards: uses });

  // Wie bij elke lijst is (zonder wie er rechtstreeks niet bij mag), en wat voor wie niet werkt.
  const peopleLists = lists.slice(0, LINK_PEOPLE_LISTS);
  const listed = await Promise.all(peopleLists.map((l) => listPeople(db, l.id)));
  const people: Record<string, LinkPersonView[]> = {};
  peopleLists.forEach((l, i) => {
    people[l.id] = listed[i].filter((p) => p.direct !== "geen").map((p) => ({ id: p.person.id, name: p.person.name, role: p.role, via: p.direct ? null : (p.via?.tag ?? null) }));
  });
  const managed = new Set(lists.filter((l) => l.role === "beheerder").map((l) => l.id));
  const problems = linkProblems(links, new Map(Object.entries(people)), managed);

  const counts: LinksResponse["counts"] = {};
  for (const l of lists) counts[l.id] = { things: 0, events: 0, last: null };
  for (const r of thingRows.results) counts[r.list_id].things = r.n;
  for (const r of logRows.results) {
    const count = counts[r.list];
    count.events += r.events;
    if (r.last && (!count.last || r.last > count.last)) count.last = r.last;
  }
  // De eigen soorten van je lijsten (om op te zoeken).
  const open = new Set(lists.map((l) => l.id));
  const seenKinds = kinds.filter((k) => open.has(k.list_id)).map((k) => ({ id: k.id, list: k.list_id, name: k.name }));
  return c.json({ links, own, counts, people, problems, kinds: seenKinds } satisfies LinksResponse);
});

