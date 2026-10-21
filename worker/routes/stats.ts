import { Hono } from "hono";
import type { Stats } from "../../shared/types";
import type { AppEnv } from "../types";

export const stats = new Hono<AppEnv>();

/** Tellers voor de zijbalk: één lichte query, zodat de navigatie altijd klopt. Een gast krijgt enkel zijn projecten. */
stats.get("/", async (c) => {
  const db = c.env.DB;
  const hh = c.get("household");
  if (!c.get("full")) {
    const row = await db
      .prepare("SELECT COUNT(*) AS projects FROM project_members pm JOIN projects p ON p.id = pm.project_id WHERE pm.member_id = ? AND p.archived = 0")
      .bind(c.get("member").id)
      .first<{ projects: number }>();
    const empty: Stats = { purchases: 0, items: 0, low: 0, expiring: 0, cards: 0, vendors: 0, projects: row?.projects ?? 0 };
    return c.json(empty);
  }
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM purchases WHERE household_id = ?1) AS purchases,
         (SELECT COUNT(*) FROM items WHERE household_id = ?1 AND archived = 0) AS items,
         (SELECT COUNT(*) FROM items i
            WHERE i.household_id = ?1 AND i.archived = 0 AND i.min_quantity IS NOT NULL
              AND COALESCE((SELECT SUM(s.quantity) FROM stock_levels s WHERE s.item_id = i.id), 0) < i.min_quantity) AS low,
         (SELECT COUNT(DISTINCT s.item_id) FROM stock_levels s JOIN items i ON i.id = s.item_id
            WHERE i.household_id = ?1 AND i.archived = 0 AND s.next_expiry IS NOT NULL AND s.next_expiry <= date('now', '+7 days')) AS expiring,
         (SELECT COUNT(*) FROM loyalty_cards WHERE household_id = ?1) AS cards,
         (SELECT COUNT(*) FROM vendors WHERE household_id = ?1) AS vendors,
         (SELECT COUNT(*) FROM projects WHERE household_id = ?1 AND archived = 0) AS projects`,
    )
    .bind(hh)
    .first<Stats>();
  return c.json(row);
});
