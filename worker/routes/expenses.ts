import { Hono } from "hono";
import type { Context } from "hono";
import { nextOccurrence } from "../../shared/recurring";
import { computeLedger, suggestTransfers, type LedgerExpense, type LedgerTransfer, type PaymentInput, type SplitInput } from "../../shared/split";
import { rootOf } from "../../shared/tree";
import {
  FREQUENCIES,
  TONES,
  TRANSFER_KINDS,
  type Category,
  type ExpenseEntry,
  type ExpenseSummary,
  type Frequency,
  type MoneyTransfer,
  type MoneyTransferInput,
  type Pot,
  type PotSummary,
  type RecurringExpense,
  type RecurringInput,
  type SharedSummary,
  type Tone,
  type TransferKind,
} from "../../shared/types";
import { assertOwned, canUseProject } from "../context";
import { materializeRecurring, todayInBelgium } from "../recurring";
import type { AppEnv } from "../types";
import {
  asObject,
  guard,
  optionalBoolean,
  optionalCents,
  optionalDate,
  optionalId,
  optionalString,
  requiredDate,
  requiredEnum,
  requiredString,
  ValidationError,
} from "../validate";
import { parsePayments, parseSplit, PURCHASE_LIST_COLUMNS, PURCHASE_LIST_FROM, resolveSplit, toListItem, type PurchaseRow } from "./purchases";
import { resolveVendor } from "./vendors";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthRange(month: string): [string, string] {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return [`${month}-01`, `${next}-01`];
}

/**
 * Welke uitgaven en geldbewegingen tellen mee in een saldo:
 * - van het huishouden: alles zonder project, plus projecten zonder eigen saldo;
 * - van een project met een eigen saldo: enkel dat project.
 * (Bind ?1 = huishouden, ?2 = project.)
 */
function scopeSql(alias: string, projectId: string | null): string {
  return projectId
    ? `${alias}.household_id = ?1 AND ${alias}.project_id = ?2`
    : `${alias}.household_id = ?1 AND (${alias}.project_id IS NULL OR ${alias}.project_id IN
         (SELECT id FROM projects WHERE household_id = ?1 AND separate_balance = 0))`;
}

/** Mag dit lid het saldo van het huishouden (geen project) of van dit project zien en aanpassen? */
async function checkScope(c: Context<AppEnv>, projectId: string | null): Promise<void> {
  if (!(await canUseProject(c.env.DB, c.get("household"), c.get("member"), projectId))) {
    throw new ValidationError(projectId ? "Dat project bestaat niet (meer)" : "Hiervoor heb je geen toegang.");
  }
}

type PaymentRow = PaymentInput & { purchase_id: string };
type ShareRow = { purchase_id: string; member_id: string; share_cents: number };

function groupExpenses(expenses: { id: string; amount_cents: number }[], payments: PaymentRow[], shares: ShareRow[]): LedgerExpense[] {
  const byId = new Map(expenses.map((e) => [e.id, { amount_cents: e.amount_cents, payments: [] as PaymentInput[], shares: [] as ShareRow[] }]));
  for (const p of payments) byId.get(p.purchase_id)?.payments.push(p);
  for (const s of shares) byId.get(s.purchase_id)?.shares.push(s);
  return [...byId.values()];
}

export type RecurringRow = Omit<RecurringExpense, "payments" | "split"> & { payments: string; split: string };

export function toRecurring(row: RecurringRow): RecurringExpense {
  return { ...row, payments: JSON.parse(row.payments) as PaymentInput[], split: JSON.parse(row.split) as SplitInput };
}

/**
 * Saldo's, potten en (optioneel) een maandoverzicht voor het huishouden of voor één project.
 * Wordt ook gebruikt door de projectpagina.
 */
export async function buildSummary(db: D1Database, household: string, projectId: string | null, month: string | null): Promise<ExpenseSummary> {
  await materializeRecurring(db, household);
  const bind = <T extends D1PreparedStatement>(stmt: T) => (projectId ? stmt.bind(household, projectId) : stmt.bind(household));
  const scope = scopeSql("p", projectId);
  const transferScope = scopeSql("t", projectId);
  const potScope = projectId ? "household_id = ?1 AND project_id = ?2" : "household_id = ?1 AND project_id IS NULL";

  const [members, expenses, payments, shares, transfers, pots] = await db.batch([
    projectId
      ? db.prepare("SELECT member_id AS id FROM project_members WHERE project_id = ?").bind(projectId)
      : db.prepare("SELECT id FROM members WHERE household_id = ?").bind(household),
    bind(db.prepare(`SELECT p.id, p.amount_cents FROM purchases p WHERE ${scope} AND p.amount_cents > 0`)),
    bind(
      db.prepare(
        `SELECT ep.purchase_id, ep.member_id, ep.pot_id, ep.amount_cents FROM expense_payments ep
         JOIN purchases p ON p.id = ep.purchase_id WHERE ${scope}`,
      ),
    ),
    bind(
      db.prepare(
        `SELECT es.purchase_id, es.member_id, es.share_cents FROM expense_shares es
         JOIN purchases p ON p.id = es.purchase_id WHERE ${scope}`,
      ),
    ),
    bind(db.prepare(`SELECT * FROM transfers t WHERE ${transferScope}`)),
    bind(db.prepare(`SELECT * FROM pots WHERE ${potScope} ORDER BY archived, created_at`)),
  ]);

  const memberIds = (members.results as { id: string }[]).map((m) => m.id);
  const scopedTransfers = transfers.results as MoneyTransfer[];
  const memberTransfers = scopedTransfers.filter((t) => t.from_member_id && t.to_member_id);
  const ledger = computeLedger(
    memberIds,
    [],
    groupExpenses(expenses.results as { id: string; amount_cents: number }[], payments.results as PaymentRow[], shares.results as ShareRow[]),
    memberTransfers,
  );

  // Een pot telt alles mee wat ermee betaald of erin gestort werd, ook vanuit een ander project.
  const potList = pots.results as Pot[];
  let potSummaries: PotSummary[] = [];
  if (potList.length > 0) {
    const ids = potList.map((p) => p.id);
    const marks = ids.map(() => "?").join(", ");
    const [potExpenses, potPayments, potShares, potTransfers] = await db.batch([
      db
        .prepare(`SELECT DISTINCT p.id, p.amount_cents FROM purchases p JOIN expense_payments ep ON ep.purchase_id = p.id WHERE ep.pot_id IN (${marks})`)
        .bind(...ids),
      db
        .prepare(
          `SELECT ep.purchase_id, ep.member_id, ep.pot_id, ep.amount_cents FROM expense_payments ep
           WHERE ep.purchase_id IN (SELECT purchase_id FROM expense_payments WHERE pot_id IN (${marks}))`,
        )
        .bind(...ids),
      db
        .prepare(
          `SELECT es.purchase_id, es.member_id, es.share_cents FROM expense_shares es
           WHERE es.purchase_id IN (SELECT purchase_id FROM expense_payments WHERE pot_id IN (${marks}))`,
        )
        .bind(...ids),
      db.prepare(`SELECT * FROM transfers WHERE from_pot_id IN (${marks}) OR to_pot_id IN (${marks})`).bind(...ids, ...ids),
    ]);
    const potLedger = computeLedger(
      memberIds,
      potList,
      groupExpenses(potExpenses.results as { id: string; amount_cents: number }[], potPayments.results as PaymentRow[], potShares.results as ShareRow[]),
      potTransfers.results as LedgerTransfer[],
    );
    potSummaries = potList.map((p) => {
      const l = potLedger.pots.get(p.id);
      return {
        ...p,
        cash_cents: l?.cash_cents ?? p.opening_cents,
        members: [...(l?.members ?? new Map<string, number>())].map(([member_id, balance_cents]) => ({ member_id, balance_cents })),
      };
    });
  }

  const [recurring] = await db.batch([
    bind(
      db.prepare(
        `SELECT r.*, v.name AS vendor_name FROM recurring_expenses r LEFT JOIN vendors v ON v.id = r.vendor_id
         WHERE ${projectId ? "r.household_id = ?1 AND r.project_id = ?2" : "r.household_id = ?1 AND r.project_id IS NULL"}
         ORDER BY r.active DESC, r.next_on`,
      ),
    ),
  ]);

  const summary: ExpenseSummary = {
    project_id: projectId,
    balances: [...ledger.balances].map(([member_id, balance_cents]) => ({ member_id, balance_cents })),
    transfers: suggestTransfers(ledger.balances),
    pots: potSummaries,
    month: { month: month ?? "", total_cents: 0, by_category: [], by_member: [] },
    entries: [],
    recurring: (recurring.results as RecurringRow[]).map(toRecurring),
  };
  if (month) Object.assign(summary, await monthOverview(db, household, projectId, month));
  return summary;
}

/** Totalen per hoofdcategorie (subcategorieën tellen mee bij hun hoofdcategorie). */
export function totalsByCategory(categories: Category[], rows: { category_id: string | null; cents: number }[]) {
  const totals = new Map<string | null, { category_id: string | null; name: string; color: Tone | null; total_cents: number }>();
  for (const row of rows) {
    const root = row.category_id ? rootOf(categories, row.category_id) : undefined;
    const key = root?.id ?? null;
    const entry = totals.get(key) ?? { category_id: key, name: root?.name ?? "Zonder categorie", color: root?.color ?? null, total_cents: 0 };
    entry.total_cents += row.cents;
    totals.set(key, entry);
  }
  return [...totals.values()].sort((a, b) => b.total_cents - a.total_cents);
}

/** Aankopen en geldbewegingen samen in één lijst, nieuwste eerst. */
export function toEntries(purchases: PurchaseRow[], transfers: MoneyTransfer[]): ExpenseEntry[] {
  return [
    ...purchases.map(toListItem).map(
      (p): ExpenseEntry => ({
        kind: "purchase",
        id: p.id,
        date: p.purchased_on,
        description: p.description,
        amount_cents: p.amount_cents,
        payments: p.payments,
        split_mode: p.split_mode,
        category_name: p.category_name,
        category_color: p.category_color,
        project_name: p.project_name,
        recurring_id: p.recurring_id,
      }),
    ),
    ...transfers.map(({ kind, transferred_on, ...t }): ExpenseEntry => ({ ...t, kind: "transfer", transfer_kind: kind, date: transferred_on })),
  ].sort((a, b) => b.date.localeCompare(a.date));
}

async function monthOverview(db: D1Database, household: string, projectId: string | null, month: string) {
  const [from, to] = monthRange(month);
  const scope = scopeSql("p", projectId);
  const bind = (stmt: D1PreparedStatement, ...rest: unknown[]) => (projectId ? stmt.bind(household, projectId, ...rest) : stmt.bind(household, null, ...rest));
  const [categories, byCategory, byMember, purchases, transfers] = await db.batch([
    db.prepare("SELECT id, domain, parent_id, name, color, sort_order FROM categories WHERE household_id = ? AND domain = 'expense'").bind(household),
    bind(
      db.prepare(
        `SELECT p.category_id, SUM(p.amount_cents) AS cents FROM purchases p
         WHERE ${scope} AND p.purchased_on >= ?3 AND p.purchased_on < ?4 AND p.amount_cents IS NOT NULL
         GROUP BY p.category_id`,
      ),
      from,
      to,
    ),
    bind(
      db.prepare(
        `SELECT es.member_id, SUM(es.share_cents) AS cents
         FROM expense_shares es JOIN purchases p ON p.id = es.purchase_id
         WHERE ${scope} AND p.purchased_on >= ?3 AND p.purchased_on < ?4
         GROUP BY es.member_id`,
      ),
      from,
      to,
    ),
    bind(
      db.prepare(
        `SELECT ${PURCHASE_LIST_COLUMNS} ${PURCHASE_LIST_FROM}
         WHERE ${scope} AND p.purchased_on >= ?3 AND p.purchased_on < ?4
         ORDER BY p.purchased_on DESC, p.created_at DESC`,
      ),
      from,
      to,
    ),
    bind(
      db.prepare(
        `SELECT * FROM transfers t WHERE ${scopeSql("t", projectId)} AND t.transferred_on >= ?3 AND t.transferred_on < ?4
         ORDER BY t.transferred_on DESC, t.created_at DESC`,
      ),
      from,
      to,
    ),
  ]);

  const byCat = totalsByCategory(categories.results as Category[], byCategory.results as { category_id: string | null; cents: number }[]);
  const entries = toEntries(purchases.results as PurchaseRow[], transfers.results as MoneyTransfer[]);

  return {
    month: {
      month,
      total_cents: byCat.reduce((sum, c) => sum + c.total_cents, 0),
      by_category: byCat,
      by_member: (byMember.results as { member_id: string; cents: number }[]).map((r) => ({ member_id: r.member_id, share_cents: r.cents })),
    },
    entries,
  };
}

export const expenses = new Hono<AppEnv>();

/** ?month=JJJJ-MM (standaard deze maand) en ?project= (leeg = het huishouden). */
expenses.get("/summary", async (c) => {
  const month = c.req.query("month") ?? todayInBelgium().slice(0, 7);
  if (!MONTH_RE.test(month)) throw new ValidationError("'month' moet JJJJ-MM zijn");
  const projectId = c.req.query("project") || null;
  await checkScope(c, projectId);
  return c.json(await buildSummary(c.env.DB, c.get("household"), projectId, month));
});

/**
 * Wat buiten de projecten met dit lid gedeeld werd: zijn saldo in het huishouden, de overschrijvingen waar hij in
 * zit, en de uitgaven en geldbewegingen met hem erin. Zo ziet een gast (enkel projecten) zijn deel, en niets meer.
 */
expenses.get("/shared", async (c) => {
  const db = c.env.DB;
  const hh = c.get("household");
  const me = c.get("member").id;
  const ledger = await buildSummary(db, hh, null, null);
  const scope = scopeSql("p", null);
  const [purchases, transfers, shares] = await db.batch([
    db
      .prepare(
        `SELECT ${PURCHASE_LIST_COLUMNS} ${PURCHASE_LIST_FROM}
         WHERE ${scope} AND (p.id IN (SELECT purchase_id FROM expense_shares WHERE member_id = ?3)
                             OR p.id IN (SELECT purchase_id FROM expense_payments WHERE member_id = ?3))
         ORDER BY p.purchased_on DESC, p.created_at DESC LIMIT 200`,
      )
      .bind(hh, null, me),
    db
      .prepare(
        `SELECT * FROM transfers t WHERE ${scopeSql("t", null)} AND (t.from_member_id = ?3 OR t.to_member_id = ?3)
         ORDER BY t.transferred_on DESC, t.created_at DESC LIMIT 200`,
      )
      .bind(hh, null, me),
    db
      .prepare(`SELECT es.purchase_id, es.share_cents FROM expense_shares es JOIN purchases p ON p.id = es.purchase_id WHERE ${scope} AND es.member_id = ?3`)
      .bind(hh, null, me),
  ]);
  const summary: SharedSummary = {
    balance_cents: ledger.balances.find((b) => b.member_id === me)?.balance_cents ?? 0,
    transfers: ledger.transfers.filter((t) => t.from === me || t.to === me),
    entries: toEntries(purchases.results as PurchaseRow[], transfers.results as MoneyTransfer[]),
    my_shares: Object.fromEntries((shares.results as { purchase_id: string; share_cents: number }[]).map((r) => [r.purchase_id, r.share_cents])),
  };
  return c.json(summary);
});

// ---------- geldbewegingen: terugbetaling, lening, storting, afhaling ----------

function parseTransfer(body: unknown): MoneyTransferInput {
  const obj = asObject(body);
  const kind = requiredEnum(obj, "kind", Object.keys(TRANSFER_KINDS) as TransferKind[]);
  const amount = optionalCents(obj, "amount_cents");
  if (!amount) throw new ValidationError("Vul een bedrag in");
  const input: MoneyTransferInput = {
    kind,
    project_id: optionalId(obj, "project_id"),
    from_member_id: optionalId(obj, "from_member_id"),
    from_pot_id: optionalId(obj, "from_pot_id"),
    to_member_id: optionalId(obj, "to_member_id"),
    to_pot_id: optionalId(obj, "to_pot_id"),
    amount_cents: amount,
    transferred_on: requiredDate(obj, "transferred_on"),
    note: optionalString(obj, "note", 200),
  };
  const memberToMember = input.from_member_id && input.to_member_id && !input.from_pot_id && !input.to_pot_id;
  const ok =
    kind === "deposit"
      ? input.from_member_id && input.to_pot_id && !input.from_pot_id && !input.to_member_id
      : kind === "withdrawal"
        ? input.from_pot_id && input.to_member_id && !input.from_member_id && !input.to_pot_id
        : memberToMember;
  if (!ok) throw new ValidationError("Kies van wie en naar wie het geld gaat");
  if (input.from_member_id && input.from_member_id === input.to_member_id) throw new ValidationError("Iemand kan zichzelf niets terugbetalen");
  return input;
}

/** Leden moeten (bij een project) deelnemers zijn; potten van dat project of van het huishouden. */
async function checkTransferRefs(db: D1Database, household: string, t: MoneyTransferInput) {
  const members = [t.from_member_id, t.to_member_id];
  await assertOwned(db, household, "members", members);
  await assertOwned(db, household, "pots", [t.from_pot_id, t.to_pot_id]);
  if (t.project_id) {
    const ids = members.filter((m): m is string => Boolean(m));
    const { results } = await db
      .prepare(`SELECT member_id FROM project_members WHERE project_id = ? AND member_id IN (${ids.map(() => "?").join(", ")})`)
      .bind(t.project_id, ...ids)
      .all();
    if (results.length !== new Set(ids).size) throw new ValidationError("Iedereen moet deelnemer van het project zijn");
  }
  // Storten in of afhalen uit een pot gebeurt binnen de pot zijn eigen huishouden of project.
  const potId = t.from_pot_id ?? t.to_pot_id;
  if (potId) {
    const pot = await db.prepare("SELECT project_id FROM pots WHERE id = ?").bind(potId).first<{ project_id: string | null }>();
    if ((pot?.project_id ?? null) !== t.project_id) throw new ValidationError("Die pot hoort niet bij dit project");
  }
}

expenses.post("/transfers", async (c) => {
  const input = parseTransfer(await c.req.json());
  await checkScope(c, input.project_id);
  await checkTransferRefs(c.env.DB, c.get("household"), input);
  const row = await c.env.DB.prepare(
    `INSERT INTO transfers (id, household_id, project_id, kind, from_member_id, from_pot_id, to_member_id, to_pot_id,
                            amount_cents, transferred_on, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  )
    .bind(
      crypto.randomUUID(),
      c.get("household"),
      input.project_id,
      input.kind,
      input.from_member_id,
      input.from_pot_id,
      input.to_member_id,
      input.to_pot_id,
      input.amount_cents,
      input.transferred_on,
      input.note,
      c.get("user"),
    )
    .first<MoneyTransfer>();
  return c.json(row, 201);
});

expenses.delete("/transfers/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT project_id FROM transfers WHERE id = ? AND household_id = ?")
    .bind(c.req.param("id"), c.get("household"))
    .first<{ project_id: string | null }>();
  if (!row) return c.json({ error: "Niet gevonden" }, 404);
  await checkScope(c, row.project_id);
  await c.env.DB.prepare("DELETE FROM transfers WHERE id = ?").bind(c.req.param("id")).run();
  return c.body(null, 204);
});

// ---------- potten ----------

function parsePot(body: unknown) {
  const obj = asObject(body);
  const color = optionalString(obj, "color", 10);
  if (color && !(TONES as readonly string[]).includes(color)) throw new ValidationError("Onbekende kleur");
  const opening = obj.opening_cents ?? 0;
  if (typeof opening !== "number" || !Number.isInteger(opening)) throw new ValidationError("Het beginsaldo moet een bedrag in cent zijn");
  return {
    name: requiredString(obj, "name", 60),
    color: color as Tone | null,
    opening_cents: opening,
    project_id: optionalId(obj, "project_id"),
    archived: optionalBoolean(obj, "archived", false) ? 1 : 0,
  };
}

expenses.post("/pots", async (c) => {
  const p = parsePot(await c.req.json());
  await checkScope(c, p.project_id);
  const row = await c.env.DB.prepare("INSERT INTO pots (id, household_id, project_id, name, color, opening_cents) VALUES (?, ?, ?, ?, ?, ?) RETURNING *")
    .bind(crypto.randomUUID(), c.get("household"), p.project_id, p.name, p.color, p.opening_cents)
    .first<Pot>();
  return c.json(row, 201);
});

async function loadPot(c: Context<AppEnv>, id: string) {
  const pot = await c.env.DB.prepare("SELECT * FROM pots WHERE id = ? AND household_id = ?").bind(id, c.get("household")).first<Pot>();
  if (pot) await checkScope(c, pot.project_id);
  return pot;
}

expenses.put("/pots/:id", async (c) => {
  const p = parsePot(await c.req.json());
  const pot = await loadPot(c, c.req.param("id"));
  if (!pot) return c.json({ error: "Pot niet gevonden" }, 404);
  const row = await c.env.DB.prepare("UPDATE pots SET name = ?, color = ?, opening_cents = ?, archived = ? WHERE id = ? RETURNING *")
    .bind(p.name, p.color, p.opening_cents, p.archived, pot.id)
    .first<Pot>();
  return c.json(row);
});

expenses.delete("/pots/:id", async (c) => {
  const pot = await loadPot(c, c.req.param("id"));
  if (!pot) return c.json({ error: "Pot niet gevonden" }, 404);
  await guard(c.env.DB.prepare("DELETE FROM pots WHERE id = ?").bind(pot.id).run(), {
    foreignKey: "Met deze pot werd al betaald of gestort. Archiveer hem in plaats van te verwijderen.",
  });
  return c.body(null, 204);
});

// ---------- terugkerende kosten ----------

function parseRecurring(body: unknown): RecurringInput {
  const obj = asObject(body);
  const amount = optionalCents(obj, "amount_cents");
  if (!amount) throw new ValidationError("Vul een bedrag in");
  const split = parseSplit(obj.split);
  if (!split) throw new ValidationError("Kies hoe het verdeeld wordt");
  return {
    project_id: optionalId(obj, "project_id"),
    description: requiredString(obj, "description", 200),
    amount_cents: amount,
    category_id: optionalId(obj, "category_id"),
    vendor: optionalString(obj, "vendor", 100),
    frequency: requiredEnum(obj, "frequency", Object.keys(FREQUENCIES) as Frequency[]),
    start_on: requiredDate(obj, "start_on"),
    end_on: optionalDate(obj, "end_on"),
    payments: parsePayments(obj.payments),
    split,
    notes: optionalString(obj, "notes", 2000),
    active: optionalBoolean(obj, "active", true) ? 1 : 0,
  };
}

async function prepareRecurring(c: Context<AppEnv>, input: RecurringInput) {
  const db = c.env.DB;
  const hh = c.get("household");
  await checkScope(c, input.project_id);
  await assertOwned(db, hh, "categories", [input.category_id]);
  // Zelfde controles als bij een gewone uitgave, zodat het later zonder fouten ingeboekt kan worden.
  await resolveSplit(db, hh, input, c.get("full"));
  if (input.end_on && input.end_on < input.start_on) throw new ValidationError("Het einde ligt vóór het begin");
  return resolveVendor(db, hh, input.vendor);
}

const RECURRING_FIELDS = `project_id = ?, description = ?, amount_cents = ?, category_id = ?, vendor_id = ?, frequency = ?,
  start_on = ?, next_on = ?, end_on = ?, payments = ?, split = ?, notes = ?, active = ?`;

function recurringValues(input: RecurringInput, vendorId: string | null, nextOn: string) {
  return [
    input.project_id,
    input.description,
    input.amount_cents,
    input.category_id,
    vendorId,
    input.frequency,
    input.start_on,
    nextOn,
    input.end_on,
    JSON.stringify(input.payments),
    JSON.stringify(input.split),
    input.notes,
    input.active,
  ];
}

expenses.post("/recurring", async (c) => {
  const input = parseRecurring(await c.req.json());
  const vendorId = await prepareRecurring(c, input);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO recurring_expenses (id, household_id, project_id, description, amount_cents, category_id, vendor_id, frequency,
       start_on, next_on, end_on, payments, split, notes, active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, c.get("household"), ...recurringValues(input, vendorId, input.start_on), c.get("user"))
    .run();
  // Ligt het begin in het verleden of vandaag, dan meteen inboeken.
  await materializeRecurring(c.env.DB, c.get("household"));
  return c.json({ id }, 201);
});

expenses.get("/recurring/:id", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT r.*, v.name AS vendor_name FROM recurring_expenses r LEFT JOIN vendors v ON v.id = r.vendor_id
     WHERE r.id = ? AND r.household_id = ?`,
  )
    .bind(c.req.param("id"), c.get("household"))
    .first<RecurringRow>();
  if (!row) return c.json({ error: "Niet gevonden" }, 404);
  await checkScope(c, row.project_id);
  return c.json(toRecurring(row));
});

expenses.put("/recurring/:id", async (c) => {
  const id = c.req.param("id");
  const input = parseRecurring(await c.req.json());
  const current = await c.env.DB.prepare("SELECT project_id, start_on, next_on FROM recurring_expenses WHERE id = ? AND household_id = ?")
    .bind(id, c.get("household"))
    .first<{ project_id: string | null; start_on: string; next_on: string }>();
  if (!current) return c.json({ error: "Niet gevonden" }, 404);
  await checkScope(c, current.project_id);
  const vendorId = await prepareRecurring(c, input);
  // Wat al ingeboekt is, blijft; de volgende keer volgt het (eventueel nieuwe) ritme vanaf vandaag.
  const nextOn = input.start_on > todayInBelgium() ? input.start_on : nextOccurrence(input.start_on, input.frequency, prevDay(current.next_on));
  await c.env.DB.prepare(`UPDATE recurring_expenses SET ${RECURRING_FIELDS} WHERE id = ?`)
    .bind(...recurringValues(input, vendorId, nextOn), id)
    .run();
  await materializeRecurring(c.env.DB, c.get("household"));
  return c.json({ id });
});

expenses.delete("/recurring/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT project_id FROM recurring_expenses WHERE id = ? AND household_id = ?")
    .bind(c.req.param("id"), c.get("household"))
    .first<{ project_id: string | null }>();
  if (!row) return c.json({ error: "Niet gevonden" }, 404);
  await checkScope(c, row.project_id);
  // Wat al ingeboekt werd, blijft gewoon staan (recurring_id wordt leeg).
  await c.env.DB.prepare("DELETE FROM recurring_expenses WHERE id = ?").bind(c.req.param("id")).run();
  return c.body(null, 204);
});

/** De dag ervoor: zo is "de eerste keer na gisteren" vandaag of later. */
function prevDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
