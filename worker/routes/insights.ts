// Wat de app uitrekent voor een weergave op je overzicht (GET /insights/view: het logboek, de items, de voorraad, wie
// moet wie, wat er gegeten is, alles met een datum), zoeken en Verbanden: op de server uit wat de lezer ziet, nooit
// bewaard. Over alle lijsten heen tellen enkel gebeurtenissen die je helemaal ziet (je ziet hun formulier; een lijn via
// een item geeft geen bedrag of verdeling).

import { linkedKeys, type TransferPlan } from "../../shared/transfer";
import { Hono } from "hono";
import { cleanViewBlock, evaluateView, LIST_KEY, MAX_SHIFT, sourceFields, STOCK_FIELDS, viewSpan, type SourceItem, type ViewResponse } from "../../shared/blocks";
import { coupleRow, sameField } from "../../shared/viewcols";
import { computeLocal } from "../../shared/calc";
import { canAgenda, occurrences } from "../../shared/agenda";
import type { Attributes, FieldDef } from "../../shared/fields";
import { eatenGroups, foodPerPerson, formEats, hasKcal, isFood, type FoodEvent, type Nutrition } from "../../shared/food";
import { buildLinks, formNode, linkProblems, type BoardUse, type LineItem, type LinkForm, type LinkKindDef, type LinkPersonView, type LineStat, type LinksResponse, type LogStat, type MirrorUse } from "../../shared/links";
import { settleUp } from "../../shared/ledger";
import { LOG_KEYS, logItem } from "../../shared/logview";
import { canEdit, dayOf, fillsLists, kindInfo, STATUSES, type KindInfo, type List, type Role, type Status, type StockLevel } from "../../shared/model";
import { formatAmount } from "../../shared/units";
import { ids, kindsFor, parseJson, seenAll, toKind, toList, toItem, type EventRowDb, type KindRowDb, type ListRow, type ItemRowDb, type Seen } from "../access";
import { withCells } from "../cells";
import { touchesLists, viewEvents } from "../events-view";
import { brusselsToday } from "../today";
import type { AppEnv } from "../types";
import { ValidationError } from "../validate";
import { peopleOf } from "../members";
import { boardsOf } from "./me";
import { peopleByIds, stockOf, itemRefs } from "./items";

export const insights = new Hono<AppEnv>();

/**
 * Gebeurtenissen die je helemaal ziet (je ziet hun formulier, of bij een Aanpassing de lijst van haar item), met een
 * extra voorwaarde (`where`, met ?4, ?5, …). Met `lists`: enkel die een item van die lijsten raken.
 */
async function fullRows(db: D1Database, seen: Seen, lists: string[] | null, where: string, binds: unknown[], order = "e.at DESC, e.created_at DESC", limit = 2000): Promise<EventRowDb[]> {
  const { results } = await db
    .prepare(
      `SELECT e.* FROM events e
       WHERE (e.kind IN (SELECT value FROM json_each(?1))
              OR (e.kind = 'aanpassing' AND e.id IN (SELECT f.event_id FROM effects f JOIN items t ON t.id = f.item_id WHERE t.list_id IN (SELECT value FROM json_each(?2)))))
         AND (?3 IS NULL OR ${touchesLists("?3")})
         AND ${where} ORDER BY ${order} LIMIT ${limit}`,
    )
    .bind(ids(seen.forms.keys()), ids(seen.lists.keys()), lists ? ids(lists) : null, ...binds)
    .all<EventRowDb>();
  return results;
}

/**
 * Wie moet wie: het saldo van elke persoon (een cel, shared/cells.ts) in de lijsten met een saldo per persoon die je
 * ziet, samengeteld. Per overschrijving een lijst om de terugbetaling in te loggen: een lijst met een saldo waar beiden
 * een rij hebben en jij mag loggen.
 */
async function balanceOf(db: D1Database, seen: Map<string, Role>) {
  const { results: listRows } = await db
    .prepare("SELECT * FROM lists WHERE ledger IS NOT NULL AND archived = 0 AND id IN (SELECT value FROM json_each(?))")
    .bind(ids(seen.keys()))
    .all<ListRow>();
  const net = new Map<string, number>();
  const members = new Map<string, Set<string>>();
  for (const list of listRows.map(toList)) {
    if (!list.ledger) continue;
    const { results } = await db.prepare("SELECT * FROM items WHERE list_id = ? AND archived = 0").bind(list.id).all<ItemRowDb>();
    const { rows } = await withCells(db, list, results.map(toItem));
    const here = new Set<string>();
    for (const t of rows) {
      const who = t.data[list.ledger.person];
      const cents = t.data[list.ledger.field];
      if (typeof who !== "string") continue;
      here.add(who);
      if (typeof cents === "number" && cents !== 0) net.set(who, (net.get(who) ?? 0) + Math.round(cents));
    }
    members.set(list.id, here);
  }
  for (const [id, v] of net) if (v === 0) net.delete(id);
  const transfers = settleUp(net).map((t) => {
    const both = [...members].find(([id, here]) => canEdit(seen.get(id)) && here.has(t.from) && here.has(t.to));
    return { ...t, list_id: both?.[0] ?? null };
  });
  return { net, transfers };
}

/** Rekeningnummers van wie iets krijgt (om te betalen met een QR). */
async function ibansFor(db: D1Database, personIds: string[]): Promise<Record<string, string>> {
  if (!personIds.length) return {};
  const { results } = await db.prepare("SELECT id, iban FROM people WHERE iban IS NOT NULL AND id IN (SELECT value FROM json_each(?))").bind(ids(personIds)).all<{ id: string; iban: string }>();
  return Object.fromEntries(results.map((r) => [r.id, r.iban]));
}

// ---------- voorraad ----------

type StockItem = { id: string; name: string; list_id: string; list: string; amount: number; unit: string | null; low: boolean; expires: string | null; created_at: string };

/** Alles in een voorraad van deze lijsten (die je ziet), wat op of bijna op is eerst. */
async function stockItems(db: D1Database, listIds: Iterable<string>): Promise<StockItem[]> {
  const { results: listRows } = await db
    .prepare("SELECT * FROM lists WHERE stock IS NOT NULL AND archived = 0 AND id IN (SELECT value FROM json_each(?))")
    .bind(ids(listIds))
    .all<ListRow>();
  const out: StockItem[] = [];
  for (const list of listRows.map(toList)) {
    const { results } = await db.prepare("SELECT * FROM items WHERE list_id = ? AND archived = 0 ORDER BY name LIMIT 2000").bind(list.id).all<ItemRowDb>();
    const rows = results.map(toItem);
    const levels = await stockOf(db, list, rows);
    for (const t of rows) {
      const s = levels.get(t.id);
      if (s) out.push({ id: t.id, name: t.name, list_id: list.id, list: list.name, ...s, created_at: t.created_at });
    }
  }
  out.sort((a, b) => Number(b.low) - Number(a.low) || (a.expires ?? "9").localeCompare(b.expires ?? "9") || a.name.localeCompare(b.name, "nl"));
  return out;
}

// ---------- eten ----------

/** Wat er gegeten werd van `from` tot `to` (met de formulieren die je ziet; met `lists` enkel wat die raakt): per dag en per persoon. */
async function foodPeriod(db: D1Database, seen: Seen, lists: string[] | null, from: string, to: string) {
  // Zonder bedrag: een formulier met geld eet niet (shared/food.ts, `formEats`).
  const rows = await fullRows(db, seen, lists, "e.status = 'gebeurd' AND e.amount IS NULL AND e.at >= ?4 AND e.at < ?5", [from, `${to}~`]);
  const page = await viewEvents(db, seen, rows);
  // De items met hun velden (productinfo) en voorraad-eenheden, ook uit lijsten die je niet ziet (enkel de getallen).
  const itemIds = [...new Set(page.events.flatMap((e) => e.lines.flatMap((l) => (l.item_id ? [l.item_id] : []))))];
  const { results: tRows } = await db
    .prepare("SELECT t.id, t.data, l.fields, l.stock FROM items t JOIN lists l ON l.id = t.list_id WHERE t.id IN (SELECT value FROM json_each(?))")
    .bind(ids(itemIds))
    .all<{ id: string; data: string; fields: string; stock: string | null }>();
  const items = new Map(tRows.map((t) => [t.id, { fields: parseJson<FieldDef[]>(t.fields, []), data: parseJson(t.data, {}), stock: parseJson(t.stock, null) }]));
  const kinds = new Map(page.kinds.map((k) => [k.id, k]));
  const byDay = new Map<string, FoodEvent[]>();
  const food = new Set<string>();
  for (const e of page.events) {
    const kind = kinds.get(e.kind);
    if (!kind) continue;
    const eaten = eatenGroups(kind);
    const fe: FoodEvent = {
      eats: formEats(kind),
      status: e.status,
      split: e.split,
      created_by: e.created_by,
      fields: kind.fields,
      data: e.data,
      lines: e.lines.filter((l) => eaten.includes(l.group)).map((l) => ({ amount: l.amount, unit: l.unit, item: l.item_id ? (items.get(l.item_id) ?? null) : null })),
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
  return { days, who, page, food };
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ---------- datums van items ----------

/** De datums van items (de keuring, een verjaardag, het einde van de garantie) in velden met "In de agenda", van–tot. */
async function datedItems(db: D1Database, lists: List[], from: string, to: string, today: string) {
  const dated: { item_id: string; name: string; list_id: string; label: string; start: string; end?: string }[] = [];
  for (const list of lists) {
    const fields = list.fields.filter((f) => f.agenda && canAgenda(f));
    if (!fields.length) continue;
    const { results } = await db.prepare("SELECT * FROM items WHERE list_id = ? AND archived = 0").bind(list.id).all<ItemRowDb>();
    const { rows } = await withCells(db, list, results.map(toItem));
    for (const t of rows) {
      const data = computeLocal(list.fields, t.data, today);
      for (const f of fields) for (const o of occurrences(f, data[f.key], from, to)) dated.push({ item_id: t.id, name: t.name, list_id: list.id, label: f.label, ...o });
    }
  }
  return dated;
}

// ---------- een weergave op een overzicht ----------

/**
 * Een weergave (shared/blocks.ts) uitgerekend: haar bron geladen met de rechten van wie kijkt (enkel lijsten die je
 * ziet; een lijst die je niet meer ziet, telt niet), dan de zin, de voorwaarden en de grafiek of de rijen. `def`: het
 * blok als JSON, nagekeken met `cleanViewBlock`.
 */
insights.get("/view", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const block = cleanViewBlock(parseJson(c.req.query("def") ?? "", null));
  if (!block) throw new ValidationError("Deze weergave klopt niet");
  const seenBoth = await seenAll(db, me.id);
  const seen = seenBoth.lists;
  const today = brusselsToday();
  // Bladeren: zoveel periodes terug (negatief) of vooruit; enkel die dagen worden geladen.
  const shift = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, Number.parseInt(c.req.query("periode") ?? "0", 10) || 0));
  const [from, to] = viewSpan(block, today, shift)?.load ?? [null, null];
  const wanted = block.lists.filter((id) => seen.has(id));
  const listIds = block.lists.length ? wanted : [...seen.keys()];
  const { results: listRows } = await db.prepare("SELECT * FROM lists WHERE archived = 0 AND id IN (SELECT value FROM json_each(?))").bind(ids(listIds)).all<ListRow>();
  const lists = listRows.map(toList);
  const only = new Map([...seen].filter(([id]) => lists.some((l) => l.id === id)));
  // Gekozen lijsten: enkel wat die raakt; geen keuze: alles wat je ziet.
  const chosen = block.lists.length ? lists.map((l) => l.id) : null;

  type ViewRow = SourceItem & { link: string | null; event?: { status: Status; running: boolean; at: string }; settle?: { list: string; iban: string | null } };
  let fields: FieldDef[] = [];
  let items: ViewRow[] = [];
  let people: { id: string; name: string }[] = [];
  let refs: Record<string, string> = {};

  if (block.source === "logboek") {
    // De formulieren die je ziet (bij gekozen lijsten: die ze invullen), en die van wat je ziet.
    const forms = (await kindsFor(db, seenBoth.forms.keys())).filter((k) => !chosen || fillsLists(k).some((l) => chosen.includes(l)));
    const when = from && to ? "e.at >= ?4 AND e.at < ?5" : from ? "e.at >= ?4" : to ? "e.at < ?4" : "1 = 1";
    const binds = [from, to && `${to}~`].filter((x): x is string => Boolean(x));
    const rows = lists.length ? await fullRows(db, seenBoth, chosen, when, binds, "e.at DESC, e.created_at DESC", 2000) : [];
    const page = await viewEvents(db, seenBoth, rows);
    const kinds = [...new Map([...forms, ...page.kinds].map((k) => [k.id, k])).values()];
    const kindName = new Map(kinds.map((k) => [k.id, k.name]));
    const listName = new Map(page.lists.map((l) => [l.id, l.name]));
    fields = sourceFields("logboek", { lists, kinds });
    const fixed = new Set(LOG_KEYS as readonly string[]);
    items = page.events.map((e) => {
      const kind = kindName.get(e.kind) ?? e.kind;
      const row = logItem(e, { kind, list: listName.get(e.lists[0] ?? "") ?? "", me: me.id, title: e.name || kind });
      const running = Boolean(kinds.find((k) => k.id === e.kind)?.parts.duration) && !e.end_at && e.at.length > 10 && e.status === "gebeurd";
      const own = Object.fromEntries(Object.entries(e.data).filter(([k]) => !fixed.has(k)));
      return { ...row, id: e.id, data: { ...own, ...row.data, ...(running ? { running: true } : {}) }, link: `/gebeurtenissen/${e.id}`, event: { status: e.status, running, at: e.at } };
    });
    people = page.people.map((p) => ({ id: p.id, name: p.name }));
    refs = Object.fromEntries(page.items.map((t) => [t.id, t.name]));
  } else if (block.source === "items") {
    const { results } = lists.length
      ? await db.prepare("SELECT * FROM items WHERE archived = 0 AND list_id IN (SELECT value FROM json_each(?)) ORDER BY name LIMIT 2000").bind(ids(lists.map((l) => l.id))).all<ItemRowDb>()
      : { results: [] as ItemRowDb[] };
    const byList = new Map(lists.map((l) => [l.id, l]));
    // Een lijst die voorraad telt, heeft de voorraad als kolommen (hoeveel, bijna op, houdbaar tot).
    const stocked = lists.some((l) => l.stock);
    fields = [...sourceFields("items", { lists, kinds: [] }), ...(stocked ? STOCK_FIELDS : [])];
    // Uit meer lijsten: ook in welke lijst (LIST_KEY, zie sourceFields).
    const listOf = (id: string): Attributes => (lists.length > 1 ? { [LIST_KEY]: byList.get(id)?.name ?? "" } : {});
    // Per lijst: haar velden die in de weergave anders heten (dezelfde naam en soort, `sameField`).
    const sameOf = new Map(lists.map((l) => [l.id, new Map(l.fields.flatMap((f) => fields.filter((g) => g.key !== f.key && sameField(g, f) && !l.fields.some((x) => x.key === g.key)).slice(0, 1).map((g) => [f.key, g.key] as const)))]));
    // Met wat het logboek invult (shared/cells.ts), per lijst, en haar voorraad.
    const filled: ReturnType<typeof toItem>[] = [];
    const levels = new Map<string, StockLevel>();
    for (const list of lists) {
      const { rows, cells } = await withCells(db, list, results.filter((r) => r.list_id === list.id).map(toItem));
      filled.push(...rows);
      for (const [id, level] of cells.stock) levels.set(id, level);
    }
    const order = new Map(results.map((r, i) => [r.id, i]));
    filled.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const stockData = (id: string): Attributes => {
      const level = levels.get(id);
      return level ? { _voorraad: level.amount, _bijna_op: level.low, ...(level.expires ? { _houdbaar: level.expires } : {}) } : {};
    };
    items = filled.map((t) => ({
      id: t.id,
      name: t.name,
      data: { ...coupleRow(computeLocal(byList.get(t.list_id)?.fields ?? [], t.data, today), t.list_id, block.cols ?? [], sameOf.get(t.list_id) ?? new Map()), ...listOf(t.list_id), ...stockData(t.id) },
      tag_ids: [],
      created_at: t.created_at,
      link: `/items/${t.id}`,
    }));
    // Namen van personen en verwijzingen in de velden.
    const values = items.flatMap((i) => Object.values(i.data));
    const strings = values.flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? (v as unknown[]).flatMap((x) => (typeof x === "string" ? [x] : x && typeof x === "object" ? Object.values(x as object).filter((y): y is string => typeof y === "string") : [])) : []));
    people = (await peopleByIds(db, strings.filter((x) => /^[0-9a-f-]{36}$/.test(x)))).map((p) => ({ id: p.id, name: p.name }));
    refs = Object.fromEntries((await itemRefs(db, seen, strings.filter((x) => /^[0-9a-f-]{36}$/.test(x)))).map((t) => [t.id, t.name]));
  } else if (block.source === "voorraad") {
    const stock = await stockItems(db, lists.map((l) => l.id));
    fields = sourceFields("voorraad", { lists: lists.filter((l) => l.stock), kinds: [] });
    items = stock.map((t) => ({
      id: t.id,
      name: t.name,
      data: { list: t.list, level: formatAmount(t.amount, t.unit), amount: t.amount, low: t.low, out: t.amount <= 0, ...(t.expires ? { expires: t.expires } : {}) },
      tag_ids: [],
      created_at: t.created_at,
      link: `/items/${t.id}`,
    }));
  } else if (block.source === "saldo") {
    // Wie moet wie; Terugbetaald logt een overdracht in een lijst waar beiden in staan (met de IBAN van wie krijgt).
    const { transfers } = await balanceOf(db, only.size ? only : seen);
    const who = await peopleByIds(db, transfers.flatMap((t) => [t.from, t.to]));
    const ibans = await ibansFor(db, transfers.map((t) => t.to));
    const name = (id: string) => (id === me.id ? "Jij" : (who.find((p) => p.id === id)?.name ?? "Iemand"));
    fields = sourceFields("saldo", { lists, kinds: [] });
    people = who.map((p) => ({ id: p.id, name: p.name }));
    items = transfers.map((t) => ({
      id: `${t.from}-${t.to}`,
      name: `${name(t.from)} → ${name(t.to)}`,
      data: { from: t.from, to: t.to, amount: t.amount },
      tag_ids: [],
      created_at: `${today} 12:00:00`,
      link: null,
      ...(t.list_id ? { settle: { list: t.list_id, iban: ibans[t.to] ?? null } } : {}),
    }));
  } else if (block.source === "datums") {
    // Alles met een datum: wat gebeurde of gepland staat (niet afgevinkt) en de datums van items, in de periode (anders
    // de komende maanden).
    const start = from ?? addDays(today, -31);
    const end = to ?? addDays(today, 366);
    const rows = lists.length ? await fullRows(db, seenBoth, chosen, "e.at >= ?4 AND e.at < ?5 AND e.status != 'afgevinkt'", [start, `${end}~`], "e.at ASC", 1000) : [];
    const page = await viewEvents(db, seenBoth, rows);
    const kindName = new Map(page.kinds.map((k) => [k.id, k.name]));
    const listName = new Map([...lists, ...page.lists].map((l) => [l.id, l.name]));
    fields = sourceFields("datums", { lists, kinds: [] });
    items = [
      ...page.events.map((e) => {
        const kind = kindName.get(e.kind) ?? e.kind;
        const running = Boolean(page.kinds.find((k) => k.id === e.kind)?.parts.duration) && !e.end_at && e.at.length > 10 && e.status === "gebeurd";
        return {
          id: e.id,
          name: e.name || kind,
          data: { at: e.at, ...(e.end_at && e.end_at.slice(0, 10) > e.at.slice(0, 10) ? { end: e.end_at.slice(0, 10) } : {}), list: listName.get(e.lists[0] ?? "") ?? "", what: kind, status: STATUSES[e.status].label },
          tag_ids: [],
          created_at: e.created_at,
          link: `/gebeurtenissen/${e.id}`,
          event: { status: e.status, running, at: e.at },
        };
      }),
      ...(await datedItems(db, lists, start, end, today)).map((d) => ({
        id: `${d.item_id}-${d.label}-${d.start}`,
        name: d.name,
        data: { at: d.start, ...(d.end ? { end: d.end } : {}), list: listName.get(d.list_id) ?? "", what: d.label },
        tag_ids: [],
        created_at: `${d.start} 12:00:00`,
        link: `/items/${d.item_id}`,
      })),
    ];
    people = page.people.map((p) => ({ id: p.id, name: p.name }));
  } else {
    // Wat er gegeten werd: in de periode, anders zoveel dagen terug als de zin telt (minstens een week, hoogstens een jaar).
    const t = block.tally;
    const back = Math.min(366, Math.max(7, t ? (t.n || 52) * ({ day: 1, week: 7, month: 31, year: 366 } as const)[t.step] : 93));
    const { days, who } = await foodPeriod(db, seenBoth, chosen, from ?? addDays(today, -back), to ?? today);
    const eaters = await peopleByIds(db, who);
    const name = (id: string) => (id === me.id ? "Jij" : (eaters.find((p) => p.id === id)?.name ?? "Iemand"));
    fields = sourceFields("voeding", { lists, kinds: [] });
    people = eaters.map((p) => ({ id: p.id, name: p.name }));
    items = days.flatMap((d) => Object.entries(d.people).map(([id, n]) => ({ id: `${d.day}-${id}`, name: name(id), data: { day: d.day, who: id, ...n }, tag_ids: [], created_at: `${d.day} 12:00:00`, link: null })));
  }

  const personName = new Map(people.map((p) => [p.id, p.name]));
  const outcome = evaluateView(block, fields, items, {
    today,
    shift,
    me: me.id,
    names: { person: (id) => personName.get(id) ?? "?", item: (id) => refs[id] ?? "?" },
    chart: { people, item: (id) => refs[id], tags: [] },
  });
  return c.json({ ...outcome, fields, people, items: refs } satisfies ViewResponse);
});

// ---------- zoeken ----------

insights.get("/search", async (c) => {
  const db = c.env.DB;
  const me = c.get("person");
  const q = c.req.query("q")?.trim() ?? "";
  if (q.length < 2) return c.json({ lists: [], forms: [], items: [], events: [] });
  const { lists: seen, forms: seenForms } = await seenAll(db, me.id);
  const like = `%${q}%`;
  const [lists, forms, items, events] = (await db.batch([
    db.prepare("SELECT id, name, icon, color FROM lists WHERE id IN (SELECT value FROM json_each(?1)) AND name LIKE ?2 LIMIT 8").bind(ids(seen.keys()), like),
    db.prepare("SELECT id, name, icon, base FROM kinds WHERE id IN (SELECT value FROM json_each(?1)) AND name LIKE ?2 LIMIT 8").bind(ids(seenForms.keys()), like),
    db
      .prepare(
        `SELECT t.id, t.name, t.list_id, l.name AS list, l.icon FROM items t JOIN lists l ON l.id = t.list_id
         WHERE t.list_id IN (SELECT value FROM json_each(?1)) AND t.name LIKE ?2 ORDER BY t.archived, t.name LIMIT 20`,
      )
      .bind(ids(seen.keys()), like),
    db
      .prepare(
        `SELECT e.id, e.name, e.at, e.kind, e.base, k.name AS form FROM events e JOIN kinds k ON k.id = e.kind
         WHERE e.kind IN (SELECT value FROM json_each(?1)) AND e.name LIKE ?2 ORDER BY e.at DESC LIMIT 12`,
      )
      .bind(ids(seenForms.keys()), like),
  ])) as [D1Result<{ id: string; name: string }>, D1Result<{ id: string; name: string }>, D1Result<{ id: string; name: string }>, D1Result<{ id: string; name: string; kind: string }>];
  return c.json({ lists: lists.results, forms: forms.results, items: items.results, events: events.results });
});

// ---------- verbanden ----------

/** Zoveel lijsten krijgen hun mensen erbij (de rest van de kaart werkt gewoon). */
const LINK_PEOPLE_LISTS = 80;

/**
 * Hoe je lijsten samenhangen (zie shared/links.ts): enkel je lijsten (niet gearchiveerd) en de formulieren die je ziet,
 * met tellingen over hun logboek en hun lijnen naar items in je lijsten. De problemen enkel waar je een van beide
 * lijsten beheert.
 */
insights.get("/links", async (c) => {
  const db = c.env.DB;
  const me = c.get("person").id;
  const seenBoth = await seenAll(db, me);
  const seen = seenBoth.lists;
  const { results: listRows } = await db.prepare("SELECT * FROM lists WHERE archived = 0 AND id IN (SELECT value FROM json_each(?))").bind(ids(seen.keys())).all<ListRow>();
  const lists = listRows.map(toList).map((l) => ({ ...l, role: seen.get(l.id)! }));
  const listIds = ids(lists.map((l) => l.id));

  // De formulieren die je ziet; wat als eten telt (kcal in het formulier of het item).
  const [kindRows, kcalRows] = (await db.batch([
    db.prepare("SELECT * FROM kinds WHERE archived = 0 AND id IN (SELECT value FROM json_each(?1))").bind(ids(seenBoth.forms.keys())),
    db.prepare(`SELECT id, fields FROM lists WHERE fields LIKE '%"product":"kcal"%'`),
  ])) as [D1Result<KindRowDb>, D1Result<{ id: string; fields: string }>];
  const full = kindRows.results.map(toKind);
  const kinds: LinkKindDef[] = full;
  const infos = full.map(kindInfo);
  const formIds = ids(infos.map((k) => k.id));
  const idsOf = (pick: (k: KindInfo) => boolean) => JSON.stringify(infos.filter(pick).map((k) => k.id));
  const kcalKinds = infos.filter((k) => hasKcal(k.fields)).map((k) => k.id);
  const kcalLists = kcalRows.results.filter((r) => hasKcal(parseJson<FieldDef[]>(r.fields, []))).map((r) => r.id);

  const done = "MAX(CASE WHEN e.status != 'gepland' THEN substr(e.at, 1, 10) END)";
  const inLists = "(SELECT value FROM json_each(?1))";
  const inForms = "(SELECT value FROM json_each(?2))";
  const [logRows, lineRows, itemLineRows, itemRows, touchRows] = (await db.batch([
    db
      .prepare(
        `SELECT e.kind, e.base, COUNT(*) AS events,
           SUM(e.status = 'gebeurd' AND e.amount IS NOT NULL AND e.kind NOT IN (SELECT value FROM json_each(?4))) AS money,
           SUM(e.status = 'gebeurd' AND e.amount IS NOT NULL AND e.paid_by IS NOT NULL
               AND (e.split IS NOT NULL OR e.kind IN (SELECT value FROM json_each(?4)) OR EXISTS (SELECT 1 FROM lines o WHERE o.event_id = e.id AND o.owner IS NOT NULL))) AS shared,
           SUM(e.status = 'gepland') AS planned,
           SUM(e.repeat IS NOT NULL) AS repeats,
           SUM(e.kind IN (SELECT value FROM json_each(?5)) AND e.end_at IS NULL AND length(e.at) > 10 AND e.status = 'gebeurd') AS running,
           SUM(e.kind IN (SELECT value FROM json_each(?6)) AND e.status = 'gebeurd' AND (e.kind IN (SELECT value FROM json_each(?2))
               OR EXISTS (SELECT 1 FROM lines f JOIN items ft ON ft.id = f.item_id
                          WHERE f.event_id = e.id AND f.role != 'bij' AND ft.list_id IN (SELECT value FROM json_each(?3))))) AS food,
           ${done} AS last
         FROM events e WHERE e.kind IN (SELECT value FROM json_each(?1)) GROUP BY e.kind, e.base`,
      )
      .bind(
        formIds,
        JSON.stringify(kcalKinds),
        JSON.stringify(kcalLists),
        idsOf((k) => k.parts.to),
        idsOf((k) => k.parts.duration),
        idsOf(formEats),
      ),
    db
      .prepare(
        `SELECT e.kind, e.base, l.role, t.list_id AS "to", COUNT(DISTINCT e.id) AS events, ${done} AS last
         FROM lines l JOIN events e ON e.id = l.event_id JOIN items t ON t.id = l.item_id
         WHERE e.kind IN ${inForms} AND t.list_id IN ${inLists}
         GROUP BY e.kind, e.base, l.role, t.list_id`,
      )
      .bind(listIds, formIds),
    // Welke items er in een verband zitten (enkel items van lijsten die je ziet).
    db
      .prepare(
        `SELECT e.kind, t.list_id AS "to", t.id AS item, t.name, COUNT(DISTINCT e.id) AS events
         FROM lines l JOIN events e ON e.id = l.event_id JOIN items t ON t.id = l.item_id
         WHERE e.kind IN ${inForms} AND t.list_id IN ${inLists}
         GROUP BY e.kind, t.id`,
      )
      .bind(listIds, formIds),
    db.prepare(`SELECT list_id, COUNT(*) AS n FROM items WHERE archived = 0 AND list_id IN ${inLists} GROUP BY list_id`).bind(listIds),
    // Het logboek van elke lijst: wat haar items raakte (zie events-view.ts).
    db
      .prepare(
        `SELECT t.list_id AS list, COUNT(DISTINCT e.id) AS events, ${done} AS last
         FROM (SELECT event_id, item_id FROM lines WHERE item_id IS NOT NULL UNION SELECT event_id, item_id FROM effects) x
         JOIN events e ON e.id = x.event_id JOIN items t ON t.id = x.item_id
         WHERE t.list_id IN ${inLists} GROUP BY t.list_id`,
      )
      .bind(listIds),
  ])) as [D1Result<LogStat>, D1Result<LineStat>, D1Result<LineItem>, D1Result<{ list_id: string; n: number }>, D1Result<{ list: string; events: number; last: string | null }>];

  // De lijsten die een formulier raakt: wat het invult, dan waar zijn lijnen naartoe gingen.
  const open = new Set(lists.map((l) => l.id));
  const formLists = (k: KindInfo) => [...new Set([...fillsLists(k), ...lineRows.results.filter((r) => r.kind === k.id).map((r) => r.to)])].filter((l) => open.has(l));

  // Je overzichten: welke blokken een lijst tonen (een item: zijn lijst; een actie: de lijst van haar formulier).
  const boards = await boardsOf(db, me);
  const itemIds = boards.flatMap((b) => (b.blocks ?? []).flatMap((x) => (x.kind === "item" ? [x.item] : [])));
  const itemList = new Map<string, string>();
  if (itemIds.length) {
    const { results } = await db.prepare("SELECT id, list_id FROM items WHERE id IN (SELECT value FROM json_each(?))").bind(ids(itemIds)).all<{ id: string; list_id: string }>();
    for (const r of results) itemList.set(r.id, r.list_id);
  }
  const uses: BoardUse[] = boards.flatMap((b) =>
    (b.blocks ?? []).flatMap((x): BoardUse[] => {
      if (x.kind === "view") return x.lists.map((list) => ({ board: b.name, list, block: "view" as const }));
      if (x.kind === "action") {
        const form = infos.find((k) => k.id === x.type);
        const list = x.list || (form ? formLists(form)[0] : undefined);
        return list ? [{ board: b.name, list, block: "action" }] : [];
      }
      const list = x.kind === "item" ? itemList.get(x.item) : undefined;
      return list ? [{ board: b.name, list, block: "item" }] : [];
    }),
  );

  // Koppelingen tussen lijsten die je ziet, met de velden die meelopen (hun naam in de doellijst).
  const { results: mirrorRows } = await db
    .prepare("SELECT list_id, source_id, plan FROM mirrors WHERE list_id IN (SELECT value FROM json_each(?1)) AND source_id IN (SELECT value FROM json_each(?1))")
    .bind(listIds)
    .all<{ list_id: string; source_id: string; plan: string }>();
  const fieldsOf = new Map(lists.map((l) => [l.id, l.fields]));
  const mirrors: MirrorUse[] = mirrorRows.map((m) => {
    const keys = linkedKeys({ fields: parseJson<Partial<TransferPlan>>(m.plan, {}).fields ?? {} });
    const labels = keys.flatMap((k) => (fieldsOf.get(m.list_id) ?? []).filter((f) => f.key === k).map((f) => f.label));
    return { list: m.list_id, source: m.source_id, fields: labels };
  });

  const { links, own } = buildLinks({ lists, kinds, log: logRows.results, lines: lineRows.results, items: itemLineRows.results, boards: uses, mirrors });

  // Wie bij elke lijst is (zonder wie er rechtstreeks niet bij mag), en wat voor wie niet werkt.
  const peopleLists = lists.slice(0, LINK_PEOPLE_LISTS);
  const listed = await Promise.all(peopleLists.map((l) => peopleOf(db, "list", l.id)));
  const people: Record<string, LinkPersonView[]> = {};
  peopleLists.forEach((l, i) => {
    people[l.id] = listed[i]
      .filter((p) => p.direct !== "geen")
      .map((p) => ({ id: p.person.id, name: p.person.name, color: p.person.color ?? null, role: p.role, via: p.direct ? null : (p.via?.tag ?? null) }));
  });
  const managed = new Set(lists.filter((l) => l.role === "beheerder").map((l) => l.id));
  const problems = linkProblems(links, new Map(Object.entries(people)), managed);

  const counts: LinksResponse["counts"] = {};
  for (const l of lists) counts[l.id] = { items: 0, events: 0, last: null };
  for (const r of itemRows.results) counts[r.list_id].items = r.n;
  for (const r of touchRows.results) counts[r.list] = { ...counts[r.list], events: r.events, last: r.last };
  // De formulieren als punten op de kaart, met hun logboek (hoeveel gebeurtenissen, de laatste dag).
  const forms: LinkForm[] = infos.map((k) => ({ id: formNode(k.id), name: k.name, icon: k.icon, base: k.base, role: seenBoth.forms.get(k.id)! }));
  for (const r of logRows.results) {
    const count = (counts[formNode(r.kind)] ??= { items: 0, events: 0, last: null });
    count.events += r.events;
    if (r.last && (!count.last || r.last > count.last)) count.last = r.last;
  }
  // De formulieren die een melding sturen bij iets nieuws.
  const alerts = full.filter((k) => k.notify).map((k) => k.id);
  return c.json({ links, own, counts, people, alerts, problems, forms } satisfies LinksResponse);
});
