import { Hono } from "hono";
import { computeBalances, suggestTransfers, type Debt, type Payment } from "../../shared/split";
import { rootOf } from "../../shared/tree";
import type { Category, ExpenseEntry, ExpenseSummary, Settlement, Tone } from "../../shared/types";
import type { AppEnv } from "../types";
import { asObject, optionalCents, optionalString, requiredDate, requiredId, ValidationError } from "../validate";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthRange(month: string): [string, string] {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return [`${month}-01`, `${next}-01`];
}

export const expenses = new Hono<AppEnv>();

/**
 * Alles voor het scherm "Uitgaven":
 * - saldo's en voorgestelde overschrijvingen (over alle tijd);
 * - voor één maand (?month=YYYY-MM): totaal, per categorie, per lid, en de lijst.
 */
expenses.get("/summary", async (c) => {
  const month = c.req.query("month") ?? new Date().toISOString().slice(0, 7);
  if (!MONTH_RE.test(month)) throw new ValidationError("'month' moet JJJJ-MM zijn");
  const [from, to] = monthRange(month);
  const db = c.env.DB;

  const [members, debts, payments, categories, byCategory, byMember, purchases, settlements] = await db.batch([
    db.prepare("SELECT id FROM members"),
    db.prepare(
      `SELECT p.paid_by AS payer, s.member_id AS member, SUM(s.share_cents) AS cents
       FROM expense_shares s JOIN purchases p ON p.id = s.purchase_id
       WHERE p.paid_by IS NOT NULL
       GROUP BY p.paid_by, s.member_id`,
    ),
    db.prepare(
      `SELECT from_member_id AS "from", to_member_id AS "to", SUM(amount_cents) AS cents
       FROM settlements GROUP BY from_member_id, to_member_id`,
    ),
    db.prepare("SELECT id, domain, parent_id, name, color, sort_order FROM categories WHERE domain = 'expense'"),
    db
      .prepare(
        `SELECT category_id, SUM(amount_cents) AS cents FROM purchases
         WHERE purchased_on >= ? AND purchased_on < ? AND amount_cents IS NOT NULL
         GROUP BY category_id`,
      )
      .bind(from, to),
    db
      .prepare(
        `SELECT s.member_id, SUM(s.share_cents) AS cents
         FROM expense_shares s JOIN purchases p ON p.id = s.purchase_id
         WHERE p.purchased_on >= ? AND p.purchased_on < ?
         GROUP BY s.member_id`,
      )
      .bind(from, to),
    db
      .prepare(
        `SELECT p.id, p.purchased_on AS date, p.description, p.amount_cents, p.paid_by, p.split_mode,
                c.name AS category_name, c.color AS category_color
         FROM purchases p LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.purchased_on >= ? AND p.purchased_on < ?
         ORDER BY p.purchased_on DESC, p.created_at DESC`,
      )
      .bind(from, to),
    db
      .prepare(
        `SELECT id, settled_on AS date, from_member_id, to_member_id, amount_cents, note
         FROM settlements WHERE settled_on >= ? AND settled_on < ?
         ORDER BY settled_on DESC, created_at DESC`,
      )
      .bind(from, to),
  ]);

  const balances = computeBalances(
    (members.results as { id: string }[]).map((m) => m.id),
    debts.results as Debt[],
    payments.results as Payment[],
  );

  // Subcategorieën tellen mee bij hun hoofdcategorie: zo blijft het overzicht kort.
  const cats = categories.results as Category[];
  const totals = new Map<string | null, { category_id: string | null; name: string; color: Tone | null; total_cents: number }>();
  for (const row of byCategory.results as { category_id: string | null; cents: number }[]) {
    const root = row.category_id ? rootOf(cats, row.category_id) : undefined;
    const key = root?.id ?? null;
    const entry = totals.get(key) ?? { category_id: key, name: root?.name ?? "Zonder categorie", color: root?.color ?? null, total_cents: 0 };
    entry.total_cents += row.cents;
    totals.set(key, entry);
  }
  const byCat = [...totals.values()].sort((a, b) => b.total_cents - a.total_cents);

  const entries: ExpenseEntry[] = [
    ...(purchases.results as Omit<Extract<ExpenseEntry, { kind: "purchase" }>, "kind">[]).map((p) => ({ kind: "purchase" as const, ...p })),
    ...(settlements.results as Omit<Extract<ExpenseEntry, { kind: "settlement" }>, "kind">[]).map((s) => ({ kind: "settlement" as const, ...s })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const summary: ExpenseSummary = {
    balances: [...balances].map(([member_id, balance_cents]) => ({ member_id, balance_cents })),
    transfers: suggestTransfers(balances),
    month: {
      month,
      total_cents: byCat.reduce((sum, c) => sum + c.total_cents, 0),
      by_category: byCat,
      by_member: (byMember.results as { member_id: string; cents: number }[]).map((r) => ({
        member_id: r.member_id,
        share_cents: r.cents,
      })),
    },
    entries,
  };
  return c.json(summary);
});

expenses.post("/settlements", async (c) => {
  const obj = asObject(await c.req.json());
  const from = requiredId(obj, "from_member_id");
  const to = requiredId(obj, "to_member_id");
  if (from === to) throw new ValidationError("Iemand kan zichzelf niets terugbetalen");
  const amount = optionalCents(obj, "amount_cents");
  if (!amount) throw new ValidationError("Vul een bedrag in");

  const row = await c.env.DB.prepare(
    `INSERT INTO settlements (id, from_member_id, to_member_id, amount_cents, settled_on, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  )
    .bind(crypto.randomUUID(), from, to, amount, requiredDate(obj, "settled_on"), optionalString(obj, "note", 200), c.get("user"))
    .first<Settlement>();
  return c.json(row, 201);
});

expenses.delete("/settlements/:id", async (c) => {
  const { meta } = await c.env.DB.prepare("DELETE FROM settlements WHERE id = ?").bind(c.req.param("id")).run();
  if (meta.changes === 0) return c.json({ error: "Terugbetaling niet gevonden" }, 404);
  return c.body(null, 204);
});
