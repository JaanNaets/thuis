import { Hono } from "hono";
import type { Stats } from "../../shared/types";
import type { AppEnv } from "../types";

export const stats = new Hono<AppEnv>();

/** Tellers voor de zijbalk: één lichte query, zodat de navigatie altijd klopt. */
stats.get("/", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM purchases) AS purchases,
       (SELECT COUNT(*) FROM items WHERE archived = 0) AS items,
       (SELECT COUNT(*) FROM items i
          WHERE i.archived = 0 AND i.min_quantity IS NOT NULL
            AND COALESCE((SELECT SUM(s.quantity) FROM stock_levels s WHERE s.item_id = i.id), 0) < i.min_quantity) AS low,
       (SELECT COUNT(DISTINCT s.item_id) FROM stock_levels s JOIN items i ON i.id = s.item_id
          WHERE i.archived = 0 AND s.next_expiry IS NOT NULL AND s.next_expiry <= date('now', '+7 days')) AS expiring,
       (SELECT COUNT(*) FROM loyalty_cards) AS cards`,
  ).first<Stats>();
  return c.json(row);
});
