import { Hono } from "hono";
import type { Vendor } from "../../shared/types";
import type { AppEnv } from "../types";
import { asObject, guard, optionalString, requiredString } from "../validate";

const VENDOR_TAKEN = "Er is al een verkoper met deze naam.";

const USAGE = "(SELECT COUNT(*) FROM purchases p WHERE p.vendor_id = vendors.id) AS usage";

/**
 * Van een getypte naam naar een verkoper: bestaat die al (hoofdletters maken niet uit), dan die;
 * anders wordt hij aangemaakt. Zo groeit de lijst vanzelf terwijl je aankopen invult.
 */
export async function resolveVendor(db: D1Database, name: string | null): Promise<string | null> {
  if (!name) return null;
  const row = await db
    .prepare(
      `INSERT INTO vendors (id, name) VALUES (?, ?)
       ON CONFLICT (name) DO UPDATE SET name = vendors.name
       RETURNING id`,
    )
    .bind(crypto.randomUUID(), name)
    .first<{ id: string }>();
  return row!.id;
}

function parseVendor(body: unknown) {
  const obj = asObject(body);
  return {
    name: requiredString(obj, "name", 100),
    website: optionalString(obj, "website", 200),
    phone: optionalString(obj, "phone", 40),
    notes: optionalString(obj, "notes", 2000),
  };
}

export const vendors = new Hono<AppEnv>();

vendors.post("/", async (c) => {
  const v = parseVendor(await c.req.json());
  const row = await guard(
    c.env.DB.prepare(`INSERT INTO vendors (id, name, website, phone, notes) VALUES (?, ?, ?, ?, ?) RETURNING *, 0 AS usage`)
      .bind(crypto.randomUUID(), v.name, v.website, v.phone, v.notes)
      .first<Vendor>(),
    { unique: VENDOR_TAKEN },
  );
  return c.json(row, 201);
});

vendors.put("/:id", async (c) => {
  const v = parseVendor(await c.req.json());
  const row = await guard(
    c.env.DB.prepare(`UPDATE vendors SET name = ?, website = ?, phone = ?, notes = ? WHERE id = ? RETURNING *, ${USAGE}`)
      .bind(v.name, v.website, v.phone, v.notes, c.req.param("id"))
      .first<Vendor>(),
    { unique: VENDOR_TAKEN },
  );
  if (!row) return c.json({ error: "Verkoper niet gevonden" }, 404);
  return c.json(row);
});

// Aankopen en items van deze verkoper blijven bestaan, zonder verkoper.
vendors.delete("/:id", async (c) => {
  const { meta } = await c.env.DB.prepare("DELETE FROM vendors WHERE id = ?").bind(c.req.param("id")).run();
  if (meta.changes === 0) return c.json({ error: "Verkoper niet gevonden" }, 404);
  return c.body(null, 204);
});

export const VENDORS_QUERY = `SELECT vendors.*, ${USAGE} FROM vendors ORDER BY name COLLATE NOCASE`;
