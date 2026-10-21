import { Hono } from "hono";
import { isBarcodeFormat, type LoyaltyCard, type LoyaltyCardInput } from "../../shared/types";
import { assertOwned, requireFull } from "../context";
import type { AppEnv } from "../types";
import { asObject, optionalId, optionalString, requiredString, ValidationError } from "../validate";

const COLOR_RE = /^#[0-9a-f]{6}$/i;

function parseCard(body: unknown): LoyaltyCardInput {
  const obj = asObject(body);
  const format = obj.format;
  if (!isBarcodeFormat(format)) throw new ValidationError("Onbekend barcodeformaat");

  const color = optionalString(obj, "color", 7);
  if (color && !COLOR_RE.test(color)) throw new ValidationError("Kleur moet een hexcode zijn (#rrggbb)");

  return {
    name: requiredString(obj, "name", 100),
    card_number: requiredString(obj, "card_number", 500),
    format,
    color,
    notes: optionalString(obj, "notes", 1000),
    vendor_id: optionalId(obj, "vendor_id"),
  };
}

export const loyaltyCards = new Hono<AppEnv>();

loyaltyCards.use("*", requireFull);

loyaltyCards.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM loyalty_cards WHERE household_id = ? ORDER BY name COLLATE NOCASE")
    .bind(c.get("household"))
    .all<LoyaltyCard>();
  return c.json(results);
});

loyaltyCards.post("/", async (c) => {
  const input = parseCard(await c.req.json());
  await assertOwned(c.env.DB, c.get("household"), "vendors", [input.vendor_id]);
  const row = await c.env.DB.prepare(
    `INSERT INTO loyalty_cards (id, household_id, name, card_number, format, color, notes, vendor_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  )
    .bind(crypto.randomUUID(), c.get("household"), input.name, input.card_number, input.format, input.color, input.notes, input.vendor_id, c.get("user"))
    .first<LoyaltyCard>();
  return c.json(row, 201);
});

loyaltyCards.put("/:id", async (c) => {
  const input = parseCard(await c.req.json());
  await assertOwned(c.env.DB, c.get("household"), "vendors", [input.vendor_id]);
  const row = await c.env.DB.prepare(
    `UPDATE loyalty_cards SET name = ?, card_number = ?, format = ?, color = ?, notes = ?, vendor_id = ?
     WHERE id = ? AND household_id = ?
     RETURNING *`,
  )
    .bind(input.name, input.card_number, input.format, input.color, input.notes, input.vendor_id, c.req.param("id"), c.get("household"))
    .first<LoyaltyCard>();
  if (!row) return c.json({ error: "Kaart niet gevonden" }, 404);
  return c.json(row);
});

loyaltyCards.delete("/:id", async (c) => {
  const { meta } = await c.env.DB.prepare("DELETE FROM loyalty_cards WHERE id = ? AND household_id = ?").bind(c.req.param("id"), c.get("household")).run();
  if (meta.changes === 0) return c.json({ error: "Kaart niet gevonden" }, 404);
  return c.body(null, 204);
});
