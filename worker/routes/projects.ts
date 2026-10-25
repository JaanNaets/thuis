import { Hono } from "hono";
import type { Context } from "hono";
import { TONES, type Category, type Member, type MoneyTransfer, type ProjectDetail, type ProjectListItem, type Tone } from "../../shared/types";
import { assertOwned, canUseProject, requireFull } from "../context";
import type { AppEnv } from "../types";
import { asObject, guard, optionalBoolean, optionalCents, optionalDate, optionalId, optionalString, requiredString, ValidationError } from "../validate";
import { buildSummary, toEntries, toRecurring, totalsByCategory, type RecurringRow } from "./expenses";
import { parseDefaultSplit } from "./households";
import { PURCHASE_LIST_COLUMNS, PURCHASE_LIST_FROM, type PurchaseRow } from "./purchases";
import { findTwin, freeTone, PROJECT_COLUMNS, toProject } from "./taxonomy";

const NOT_FOUND = "Project niet gevonden";

const TOTALS = `
  (SELECT COALESCE(SUM(x.amount_cents), 0) FROM purchases x WHERE x.project_id = p.id) AS total_cents,
  (SELECT COUNT(*) FROM purchases x WHERE x.project_id = p.id) AS expense_count,
  (SELECT MAX(x.purchased_on) FROM purchases x WHERE x.project_id = p.id) AS last_expense_on`;

type Row = Parameters<typeof toProject>[0] & { total_cents: number; expense_count: number; last_expense_on: string | null };

function toListItemRow(row: Row): ProjectListItem {
  const { total_cents, expense_count, last_expense_on } = row;
  return { ...toProject(row), total_cents, expense_count, last_expense_on };
}

async function parseProject(c: Context<AppEnv>, body: unknown) {
  const obj = asObject(body);
  const color = optionalString(obj, "color", 10);
  if (color && !(TONES as readonly string[]).includes(color)) throw new ValidationError("Onbekende kleur");
  const memberIds = Array.isArray(obj.member_ids) ? (obj.member_ids as unknown[]) : [];
  if (memberIds.some((m) => typeof m !== "string") || memberIds.length > 100) throw new ValidationError("'member_ids' moet een lijst zijn");
  const start = optionalDate(obj, "start_on");
  const end = optionalDate(obj, "end_on");
  if (start && end && end < start) throw new ValidationError("Het einde ligt vóór het begin");
  const ids = [...new Set(memberIds as string[])];
  await assertOwned(c.env.DB, c.get("household"), "members", ids);
  return {
    name: requiredString(obj, "name", 80),
    description: optionalString(obj, "description", 2000),
    color: color as Tone | null,
    start_on: start,
    end_on: end,
    budget_cents: optionalCents(obj, "budget_cents"),
    separate_balance: optionalBoolean(obj, "separate_balance", true) ? 1 : 0,
    default_split: await parseDefaultSplit(c.env.DB, c.get("household"), obj.default_split),
    member_ids: ids,
  };
}

function memberStatements(db: D1Database, projectId: string, memberIds: string[]): D1PreparedStatement[] {
  return [
    // Wie al iets betaalde of een deel heeft, blijft deelnemer: anders klopt het saldo van het project niet meer.
    db
      .prepare(
        `DELETE FROM project_members WHERE project_id = ?1 AND member_id NOT IN (SELECT value FROM json_each(?2))
         AND member_id NOT IN (
           SELECT ep.member_id FROM expense_payments ep JOIN purchases x ON x.id = ep.purchase_id WHERE x.project_id = ?1 AND ep.member_id IS NOT NULL
           UNION SELECT es.member_id FROM expense_shares es JOIN purchases x ON x.id = es.purchase_id WHERE x.project_id = ?1)`,
      )
      .bind(projectId, JSON.stringify(memberIds)),
    ...memberIds.map((m) => db.prepare("INSERT OR IGNORE INTO project_members (project_id, member_id) VALUES (?, ?)").bind(projectId, m)),
  ];
}

export const projects = new Hono<AppEnv>();

projects.get("/", async (c) => {
  const db = c.env.DB;
  const stmt = c.get("full")
    ? db
        .prepare(`SELECT ${PROJECT_COLUMNS}, ${TOTALS} FROM projects p WHERE p.household_id = ? ORDER BY p.archived, p.created_at DESC`)
        .bind(c.get("household"))
    : db
        .prepare(
          `SELECT ${PROJECT_COLUMNS}, ${TOTALS} FROM projects p
           WHERE p.household_id = ? AND p.id IN (SELECT project_id FROM project_members WHERE member_id = ?)
           ORDER BY p.archived, p.created_at DESC`,
        )
        .bind(c.get("household"), c.get("member").id);
  const { results } = await stmt.all<Row>();
  return c.json(results.map(toListItemRow));
});

projects.get("/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.env.DB;
  const hh = c.get("household");
  if (!(await canUseProject(db, hh, c.get("member"), id))) return c.json({ error: NOT_FOUND }, 404);

  const [project, members, categories, byCategory, purchases, transfers, recurring] = await db.batch([
    db.prepare(`SELECT ${PROJECT_COLUMNS}, ${TOTALS} FROM projects p WHERE p.id = ? AND p.household_id = ?`).bind(id, hh),
    db.prepare("SELECT m.* FROM members m JOIN project_members pm ON pm.member_id = m.id WHERE pm.project_id = ? ORDER BY m.created_at").bind(id),
    db.prepare("SELECT id, domain, parent_id, name, color, sort_order FROM categories WHERE household_id = ? AND domain = 'expense'").bind(hh),
    db.prepare("SELECT category_id, SUM(amount_cents) AS cents FROM purchases WHERE project_id = ? AND amount_cents IS NOT NULL GROUP BY category_id").bind(id),
    db
      .prepare(`SELECT ${PURCHASE_LIST_COLUMNS} ${PURCHASE_LIST_FROM} WHERE p.project_id = ? ORDER BY p.purchased_on DESC, p.created_at DESC LIMIT 200`)
      .bind(id),
    db.prepare("SELECT * FROM transfers WHERE project_id = ? ORDER BY transferred_on DESC, created_at DESC LIMIT 200").bind(id),
    db
      .prepare(
        `SELECT r.*, v.name AS vendor_name FROM recurring_expenses r LEFT JOIN vendors v ON v.id = r.vendor_id
         WHERE r.project_id = ? ORDER BY r.active DESC, r.next_on`,
      )
      .bind(id),
  ]);
  const row = project.results[0] as Row | undefined;
  if (!row) return c.json({ error: NOT_FOUND }, 404);
  const base = toListItemRow(row);
  let summary: ProjectDetail["summary"] = null;
  if (base.separate_balance) {
    const { month: _month, recurring: _recurring, entries: _entries, ...rest } = await buildSummary(db, hh, id, null);
    summary = rest;
  }
  const detail: ProjectDetail = {
    ...base,
    members: members.results as Member[],
    by_category: totalsByCategory(categories.results as Category[], byCategory.results as { category_id: string | null; cents: number }[]),
    summary,
    entries: toEntries(purchases.results as PurchaseRow[], transfers.results as MoneyTransfer[]),
    recurring: (recurring.results as RecurringRow[]).map(toRecurring),
  };
  return c.json(detail);
});

// Een project aanmaken of beheren kan enkel wie volledige toegang heeft; gasten zetten er uitgaven in.
projects.post("/", requireFull, async (c) => {
  const p = await parseProject(c, await c.req.json());
  const db = c.env.DB;
  const id = crypto.randomUUID();
  // Wie het project maakt, doet altijd mee.
  const memberIds = [...new Set([c.get("member").id, ...p.member_ids])];
  await db.batch([
    db
      .prepare(
        `INSERT INTO projects (id, household_id, name, description, color, start_on, end_on, budget_cents, separate_balance, default_split, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        c.get("household"),
        p.name,
        p.description,
        p.color,
        p.start_on,
        p.end_on,
        p.budget_cents,
        p.separate_balance,
        p.default_split ? JSON.stringify(p.default_split) : null,
        c.get("user"),
      ),
    ...memberStatements(db, id, memberIds),
  ]);
  return c.json({ id }, 201);
});

projects.put("/:id", requireFull, async (c) => {
  const id = c.req.param("id");
  const p = await parseProject(c, await c.req.json());
  const db = c.env.DB;
  const [updated] = await db.batch([
    db
      .prepare(
        `UPDATE projects SET name = ?, description = ?, color = ?, start_on = ?, end_on = ?, budget_cents = ?,
           separate_balance = ?, default_split = ?
         WHERE id = ? AND household_id = ?`,
      )
      .bind(
        p.name,
        p.description,
        p.color,
        p.start_on,
        p.end_on,
        p.budget_cents,
        p.separate_balance,
        p.default_split ? JSON.stringify(p.default_split) : null,
        id,
        c.get("household"),
      ),
  ]);
  if (updated.meta.changes === 0) return c.json({ error: NOT_FOUND }, 404);
  await db.batch(memberStatements(db, id, p.member_ids));
  return c.json({ id });
});

projects.put("/:id/archived", requireFull, async (c) => {
  const archived = optionalBoolean(asObject(await c.req.json()), "archived", true) ? 1 : 0;
  const { meta } = await c.env.DB.prepare("UPDATE projects SET archived = ? WHERE id = ? AND household_id = ?")
    .bind(archived, c.req.param("id"), c.get("household"))
    .run();
  if (meta.changes === 0) return c.json({ error: NOT_FOUND }, 404);
  return c.json({ archived });
});

projects.delete("/:id", requireFull, async (c) => {
  const { meta } = await guard(c.env.DB.prepare("DELETE FROM projects WHERE id = ? AND household_id = ?").bind(c.req.param("id"), c.get("household")).run(), {
    foreignKey: "Er staan nog uitgaven of geldbewegingen in dit project. Archiveer het in plaats van te verwijderen.",
  });
  if (meta.changes === 0) return c.json({ error: NOT_FOUND }, 404);
  return c.body(null, 204);
});

/**
 * Een deelnemer toevoegen: iemand uit het huishouden (member_id), of een nieuw iemand van buiten (name, email).
 * Wie van buiten komt, woont hier niet en ziet enkel de projecten waarin die zit.
 */
projects.post("/:id/members", requireFull, async (c) => {
  const id = c.req.param("id");
  const db = c.env.DB;
  const hh = c.get("household");
  if (!(await db.prepare("SELECT 1 FROM projects WHERE id = ? AND household_id = ?").bind(id, hh).first())) return c.json({ error: NOT_FOUND }, 404);
  const obj = asObject(await c.req.json());
  let memberId = optionalId(obj, "member_id");
  if (memberId) {
    await assertOwned(db, hh, "members", [memberId]);
  } else {
    const email = optionalString(obj, "email", 200);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError("Dat is geen geldig e-mailadres");
    const name = requiredString(obj, "name", 60);
    const existing = email
      ? await db.prepare("SELECT id FROM members WHERE household_id = ? AND email = ? COLLATE NOCASE").bind(hh, email).first<{ id: string }>()
      : null;
    // Al iemand met die naam zonder e-mailadres (al mee gedeeld): die persoon, met het e-mailadres erbij.
    // Enkel een gast: een lid van het huishouden krijgt zo nooit ongemerkt toegang tot alles.
    const twin = existing ? null : await findTwin(db, hh, name, true);
    if (twin && email) {
      await guard(db.prepare("UPDATE members SET email = ? WHERE id = ?").bind(email, twin.id).run(), { unique: "Er is al een lid met dit e-mailadres." });
    }
    memberId = existing?.id ?? twin?.id ?? crypto.randomUUID();
    if (!existing && !twin) {
      await db
        .prepare("INSERT INTO members (id, household_id, name, email, color, active, access) VALUES (?, ?, ?, ?, ?, 0, 'projects')")
        .bind(memberId, hh, name, email, await freeTone(db, hh))
        .run();
    }
  }
  await db.prepare("INSERT OR IGNORE INTO project_members (project_id, member_id) VALUES (?, ?)").bind(id, memberId).run();
  const member = await db.prepare("SELECT * FROM members WHERE id = ?").bind(memberId).first<Member>();
  return c.json(member, 201);
});

projects.delete("/:id/members/:memberId", requireFull, async (c) => {
  const id = c.req.param("id");
  const memberId = c.req.param("memberId");
  const db = c.env.DB;
  if (!(await db.prepare("SELECT 1 FROM projects WHERE id = ? AND household_id = ?").bind(id, c.get("household")).first())) {
    return c.json({ error: NOT_FOUND }, 404);
  }
  const used = await db
    .prepare(
      `SELECT 1 FROM purchases x WHERE x.project_id = ?1 AND (
         EXISTS (SELECT 1 FROM expense_payments ep WHERE ep.purchase_id = x.id AND ep.member_id = ?2)
         OR EXISTS (SELECT 1 FROM expense_shares es WHERE es.purchase_id = x.id AND es.member_id = ?2))
       LIMIT 1`,
    )
    .bind(id, memberId)
    .first();
  if (used) throw new ValidationError("Deze deelnemer betaalde al mee of heeft een deel in een uitgave. Pas eerst die uitgaven aan.");
  await db.prepare("DELETE FROM project_members WHERE project_id = ? AND member_id = ?").bind(id, memberId).run();
  return c.body(null, 204);
});
