import { Hono } from "hono";
import { isBarcodeFormat, type LoyaltyCard, type LoyaltyCardInput } from "../../shared/types";
import type { AppEnv } from "../types";
import { asObject, optionalString, requiredString, ValidationError } from "../validate";

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
  };
}

export const loyaltyCards = new Hono<AppEnv>();

loyaltyCards.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM loyalty_cards ORDER BY name COLLATE NOCASE",
  ).all<LoyaltyCard>();
  return c.json(results);
});

loyaltyCards.post("/", async (c) => {
  const input = parseCard(await c.req.json());
  const row = await c.env.DB.prepare(
    `INSERT INTO loyalty_cards (id, name, card_number, format, color, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  )
    .bind(crypto.randomUUID(), input.name, input.card_number, input.format, input.color, input.notes, c.get("user"))
    .first<LoyaltyCard>();
  return c.json(row, 201);
});

loyaltyCards.put("/:id", async (c) => {
  const input = parseCard(await c.req.json());
  const row = await c.env.DB.prepare(
    `UPDATE loyalty_cards SET name = ?, card_number = ?, format = ?, color = ?, notes = ?
     WHERE id = ?
     RETURNING *`,
  )
    .bind(input.name, input.card_number, input.format, input.color, input.notes, c.req.param("id"))
    .first<LoyaltyCard>();
  if (!row) return c.json({ error: "Kaart niet gevonden" }, 404);
  return c.json(row);
});

loyaltyCards.delete("/:id", async (c) => {
  const { meta } = await c.env.DB.prepare("DELETE FROM loyalty_cards WHERE id = ?")
    .bind(c.req.param("id"))
    .run();
  if (meta.changes === 0) return c.json({ error: "Kaart niet gevonden" }, 404);
  return c.body(null, 204);
});
