import { Hono } from "hono";
import type {
  LoyaltyCard,
  Vendor,
  VendorBranch,
  VendorBranchInput,
  VendorContact,
  VendorContactInput,
  VendorDetail,
  VendorInput,
  VendorListItem,
} from "../../shared/types";
import { VENDOR_KINDS, isValidCompanyNumber, isValidIban, normalizeCompanyNumber, normalizeIban, normalizeWebsite, type VendorKind } from "../../shared/vendor";
import { assertOwned, requireFull } from "../context";
import type { AppEnv } from "../types";
import { asObject, guard, optionalEnum, optionalId, optionalString, requiredString, ValidationError } from "../validate";
import { PURCHASE_LIST_COLUMNS, PURCHASE_LIST_FROM, toListItem, type PurchaseRow } from "./purchases";

const VENDOR_TAKEN = "Er is al een verkoper met deze naam.";
const NOT_FOUND = "Verkoper niet gevonden";
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const USAGE = "(SELECT COUNT(*) FROM purchases p WHERE p.vendor_id = vendors.id) AS usage";

type Obj = Record<string, unknown>;

/**
 * Van een getypte naam naar een verkoper: bestaat die al (hoofdletters maken niet uit), dan die;
 * anders wordt hij aangemaakt. Zo groeit de lijst vanzelf terwijl je aankopen invult.
 */
export async function resolveVendor(db: D1Database, household: string, name: string | null): Promise<string | null> {
  if (!name) return null;
  const row = await db
    .prepare(
      `INSERT INTO vendors (id, household_id, name) VALUES (?, ?, ?)
       ON CONFLICT (household_id, name) DO UPDATE SET name = vendors.name
       RETURNING id`,
    )
    .bind(crypto.randomUUID(), household, name)
    .first<{ id: string }>();
  return row!.id;
}

function optionalEmail(obj: Obj, key: string): string | null {
  const value = optionalString(obj, key, 200);
  if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new ValidationError("Dit e-mailadres klopt niet");
  return value;
}

function parseVendor(body: unknown): VendorInput {
  const obj = asObject(body);
  const website = optionalString(obj, "website", 200);
  const companyNumber = optionalString(obj, "company_number", 30);
  const iban = optionalString(obj, "iban", 40);
  if (companyNumber && !isValidCompanyNumber(companyNumber)) {
    throw new ValidationError("Dit ondernemingsnummer klopt niet. Kijk het na op een factuur.");
  }
  if (iban && !isValidIban(iban)) throw new ValidationError("Dit rekeningnummer (IBAN) klopt niet");
  return {
    name: requiredString(obj, "name", 100),
    kind: optionalEnum(obj, "kind", Object.keys(VENDOR_KINDS) as VendorKind[]),
    category_id: optionalId(obj, "category_id"),
    website: website ? normalizeWebsite(website) : null,
    phone: optionalString(obj, "phone", 40),
    email: optionalEmail(obj, "email"),
    notes: optionalString(obj, "notes", 2000),
    customer_number: optionalString(obj, "customer_number", 100),
    account_member_id: optionalId(obj, "account_member_id"),
    account_login: optionalString(obj, "account_login", 200),
    company_number: companyNumber ? normalizeCompanyNumber(companyNumber) : null,
    iban: iban ? normalizeIban(iban) : null,
  };
}

function parseBranch(body: unknown): VendorBranchInput {
  const obj = asObject(body);
  return {
    name: requiredString(obj, "name", 100),
    street: optionalString(obj, "street", 200),
    postal_code: optionalString(obj, "postal_code", 20),
    city: optionalString(obj, "city", 100),
    country: optionalString(obj, "country", 60),
    phone: optionalString(obj, "phone", 40),
    email: optionalEmail(obj, "email"),
    opening_hours: optionalString(obj, "opening_hours", 500),
    notes: optionalString(obj, "notes", 2000),
  };
}

function parseContact(body: unknown): VendorContactInput {
  const obj = asObject(body);
  return {
    name: requiredString(obj, "name", 100),
    role: optionalString(obj, "role", 100),
    branch_id: optionalId(obj, "branch_id"),
    phone: optionalString(obj, "phone", 40),
    email: optionalEmail(obj, "email"),
    notes: optionalString(obj, "notes", 2000),
  };
}

const VENDOR_FIELDS = [
  "name",
  "kind",
  "category_id",
  "website",
  "phone",
  "email",
  "notes",
  "customer_number",
  "account_member_id",
  "account_login",
  "company_number",
  "iban",
] as const satisfies readonly (keyof VendorInput)[];

const BRANCH_FIELDS = [
  "name",
  "street",
  "postal_code",
  "city",
  "country",
  "phone",
  "email",
  "opening_hours",
  "notes",
] as const satisfies readonly (keyof VendorBranchInput)[];

const CONTACT_FIELDS = ["name", "role", "branch_id", "phone", "email", "notes"] as const satisfies readonly (keyof VendorContactInput)[];

const logoKey = (id: string) => `vendors/${id}/logo`;

async function vendorExists(db: D1Database, household: string, id: string): Promise<boolean> {
  return Boolean(await db.prepare("SELECT 1 FROM vendors WHERE id = ? AND household_id = ?").bind(id, household).first());
}

/** Verwijzingen in een fiche (categorie, lid) moeten bij hetzelfde huishouden horen. */
async function checkVendorRefs(db: D1Database, household: string, v: VendorInput) {
  await assertOwned(db, household, "categories", [v.category_id]);
  await assertOwned(db, household, "members", [v.account_member_id]);
}

export const vendors = new Hono<AppEnv>();

vendors.use("*", requireFull);

// ---------- lijst en fiche ----------

vendors.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT vendors.*, c.name AS category_name, ${USAGE},
       (SELECT COALESCE(SUM(p.amount_cents), 0) FROM purchases p WHERE p.vendor_id = vendors.id) AS total_cents,
       (SELECT MAX(p.purchased_on) FROM purchases p WHERE p.vendor_id = vendors.id) AS last_purchase_on,
       (SELECT COUNT(*) FROM loyalty_cards k WHERE k.vendor_id = vendors.id) AS card_count
     FROM vendors LEFT JOIN categories c ON c.id = vendors.category_id
     WHERE vendors.household_id = ?
     ORDER BY vendors.name COLLATE NOCASE`,
  )
    .bind(c.get("household"))
    .all<VendorListItem>();
  return c.json(results);
});

vendors.get("/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.env.DB;
  const [vendor, totals, branches, contacts, cards, purchases, warranties, items, movements] = await db.batch([
    db
      .prepare(
        `SELECT vendors.*, c.name AS category_name, c.color AS category_color, ${USAGE},
           (SELECT COUNT(*) FROM purchases p WHERE p.vendor_id = vendors.id) AS purchase_count,
           (SELECT COALESCE(SUM(p.amount_cents), 0) FROM purchases p WHERE p.vendor_id = vendors.id) AS total_cents
         FROM vendors LEFT JOIN categories c ON c.id = vendors.category_id
         WHERE vendors.id = ? AND vendors.household_id = ?`,
      )
      .bind(id, c.get("household")),
    db
      .prepare(
        `SELECT substr(purchased_on, 1, 4) AS year, COALESCE(SUM(amount_cents), 0) AS total_cents, COUNT(*) AS count
         FROM purchases WHERE vendor_id = ? GROUP BY year ORDER BY year DESC`,
      )
      .bind(id),
    db.prepare("SELECT * FROM vendor_branches WHERE vendor_id = ? ORDER BY sort_order, name COLLATE NOCASE").bind(id),
    db.prepare("SELECT * FROM vendor_contacts WHERE vendor_id = ? ORDER BY sort_order, name COLLATE NOCASE").bind(id),
    db.prepare("SELECT * FROM loyalty_cards WHERE vendor_id = ? ORDER BY name COLLATE NOCASE").bind(id),
    db
      .prepare(
        `SELECT ${PURCHASE_LIST_COLUMNS} ${PURCHASE_LIST_FROM}
         WHERE p.vendor_id = ? ORDER BY p.purchased_on DESC, p.created_at DESC LIMIT 50`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT ${PURCHASE_LIST_COLUMNS} ${PURCHASE_LIST_FROM}
         WHERE p.vendor_id = ? AND p.warranty_until >= date('now') ORDER BY p.warranty_until`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT i.id, i.name, i.unit, c.name AS category_name, c.color AS category_color,
           COALESCE((SELECT SUM(s.quantity) FROM stock_levels s WHERE s.item_id = i.id), 0) AS quantity
         FROM items i LEFT JOIN categories c ON c.id = i.category_id
         WHERE i.vendor_id = ? AND i.archived = 0
         ORDER BY i.name COLLATE NOCASE`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT m.id, m.item_id, i.name AS item_name, m.delta, i.unit, m.created_at, l.name AS location_name
         FROM stock_movements m
         JOIN items i ON i.id = m.item_id
         LEFT JOIN locations l ON l.id = m.location_id
         WHERE m.vendor_id = ?
         ORDER BY m.created_at DESC LIMIT 10`,
      )
      .bind(id),
  ]);

  const row = vendor.results[0] as
    | Omit<VendorDetail, "totals" | "branches" | "contacts" | "cards" | "purchases" | "warranties" | "items" | "movements">
    | undefined;
  if (!row) return c.json({ error: NOT_FOUND }, 404);
  const detail: VendorDetail = {
    ...row,
    totals: totals.results as VendorDetail["totals"],
    branches: branches.results as VendorBranch[],
    contacts: contacts.results as VendorContact[],
    cards: cards.results as LoyaltyCard[],
    purchases: (purchases.results as PurchaseRow[]).map(toListItem),
    warranties: (warranties.results as PurchaseRow[]).map(toListItem),
    items: items.results as VendorDetail["items"],
    movements: movements.results as VendorDetail["movements"],
  };
  return c.json(detail);
});

vendors.post("/", async (c) => {
  const v = parseVendor(await c.req.json());
  const hh = c.get("household");
  await checkVendorRefs(c.env.DB, hh, v);
  const row = await guard(
    c.env.DB.prepare(
      `INSERT INTO vendors (id, household_id, ${VENDOR_FIELDS.join(", ")}) VALUES (?, ?, ${VENDOR_FIELDS.map(() => "?").join(", ")})
       RETURNING *, 0 AS usage`,
    )
      .bind(crypto.randomUUID(), hh, ...VENDOR_FIELDS.map((f) => v[f]))
      .first<Vendor>(),
    { unique: VENDOR_TAKEN },
  );
  return c.json(row, 201);
});

vendors.put("/:id", async (c) => {
  const v = parseVendor(await c.req.json());
  const hh = c.get("household");
  await checkVendorRefs(c.env.DB, hh, v);
  const row = await guard(
    c.env.DB.prepare(`UPDATE vendors SET ${VENDOR_FIELDS.map((f) => `${f} = ?`).join(", ")} WHERE id = ? AND household_id = ? RETURNING *, ${USAGE}`)
      .bind(...VENDOR_FIELDS.map((f) => v[f]), c.req.param("id"), hh)
      .first<Vendor>(),
    { unique: VENDOR_TAKEN },
  );
  if (!row) return c.json({ error: NOT_FOUND }, 404);
  return c.json(row);
});

// Aankopen, items en kaarten van deze verkoper blijven bestaan, zonder verkoper.
// Contactpersonen en vestigingen verdwijnen mee (ON DELETE CASCADE).
vendors.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const { meta } = await c.env.DB.prepare("DELETE FROM vendors WHERE id = ? AND household_id = ?").bind(id, c.get("household")).run();
  if (meta.changes === 0) return c.json({ error: NOT_FOUND }, 404);
  await c.env.FILES.delete(logoKey(id));
  return c.body(null, 204);
});

// ---------- logo ----------

vendors.get("/:id/logo", async (c) => {
  const id = c.req.param("id");
  if (!(await vendorExists(c.env.DB, c.get("household"), id))) return c.json({ error: NOT_FOUND }, 404);
  const object = await c.env.FILES.get(logoKey(id));
  if (!object) return c.json({ error: "Geen logo" }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "image/png",
      // De app vraagt het logo op met ?v=<versie>, dus een nieuw logo is altijd een nieuwe URL.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

vendors.put("/:id/logo", async (c) => {
  const id = c.req.param("id");
  if (!(await vendorExists(c.env.DB, c.get("household"), id))) return c.json({ error: NOT_FOUND }, 404);
  const file = (await c.req.formData()).get("file");
  if (!(file instanceof File)) return c.json({ error: "Geen bestand ontvangen" }, 400);
  // Geen SVG: daar kan code in zitten.
  if (!LOGO_TYPES.includes(file.type)) return c.json({ error: "Kies een foto of afbeelding (PNG, JPG of WebP)" }, 400);
  if (file.size > MAX_LOGO_BYTES) return c.json({ error: "Dit logo is groter dan 2 MB" }, 400);

  await c.env.FILES.put(logoKey(id), file.stream(), { httpMetadata: { contentType: file.type } });
  const row = await c.env.DB.prepare("UPDATE vendors SET logo_version = COALESCE(logo_version, 0) + 1 WHERE id = ? RETURNING logo_version")
    .bind(id)
    .first<{ logo_version: number }>();
  return c.json(row);
});

vendors.delete("/:id/logo", async (c) => {
  const id = c.req.param("id");
  const { meta } = await c.env.DB.prepare("UPDATE vendors SET logo_version = NULL WHERE id = ? AND household_id = ?").bind(id, c.get("household")).run();
  if (meta.changes === 0) return c.json({ error: NOT_FOUND }, 404);
  await c.env.FILES.delete(logoKey(id));
  return c.body(null, 204);
});

// ---------- vestigingen ----------

vendors.post("/:id/branches", async (c) => {
  const id = c.req.param("id");
  const b = parseBranch(await c.req.json());
  if (!(await vendorExists(c.env.DB, c.get("household"), id))) return c.json({ error: NOT_FOUND }, 404);
  const row = await c.env.DB.prepare(
    `INSERT INTO vendor_branches (id, vendor_id, ${BRANCH_FIELDS.join(", ")}, sort_order)
     VALUES (?, ?, ${BRANCH_FIELDS.map(() => "?").join(", ")},
             (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM vendor_branches WHERE vendor_id = ?))
     RETURNING *`,
  )
    .bind(crypto.randomUUID(), id, ...BRANCH_FIELDS.map((f) => b[f]), id)
    .first<VendorBranch>();
  return c.json(row, 201);
});

vendors.put("/:id/branches/:branchId", async (c) => {
  const b = parseBranch(await c.req.json());
  if (!(await vendorExists(c.env.DB, c.get("household"), c.req.param("id")))) return c.json({ error: NOT_FOUND }, 404);
  const row = await c.env.DB.prepare(
    `UPDATE vendor_branches SET ${BRANCH_FIELDS.map((f) => `${f} = ?`).join(", ")}
     WHERE id = ? AND vendor_id = ? RETURNING *`,
  )
    .bind(...BRANCH_FIELDS.map((f) => b[f]), c.req.param("branchId"), c.req.param("id"))
    .first<VendorBranch>();
  if (!row) return c.json({ error: "Vestiging niet gevonden" }, 404);
  return c.json(row);
});

vendors.delete("/:id/branches/:branchId", async (c) => {
  if (!(await vendorExists(c.env.DB, c.get("household"), c.req.param("id")))) return c.json({ error: NOT_FOUND }, 404);
  const { meta } = await c.env.DB.prepare("DELETE FROM vendor_branches WHERE id = ? AND vendor_id = ?").bind(c.req.param("branchId"), c.req.param("id")).run();
  if (meta.changes === 0) return c.json({ error: "Vestiging niet gevonden" }, 404);
  return c.body(null, 204);
});

// ---------- contactpersonen ----------

/** Een contactpersoon kan enkel bij een vestiging van dezelfde verkoper horen. */
async function checkBranch(db: D1Database, vendorId: string, branchId: string | null) {
  if (!branchId) return;
  const ok = await db.prepare("SELECT 1 FROM vendor_branches WHERE id = ? AND vendor_id = ?").bind(branchId, vendorId).first();
  if (!ok) throw new ValidationError("Deze vestiging hoort niet bij deze verkoper");
}

vendors.post("/:id/contacts", async (c) => {
  const id = c.req.param("id");
  const p = parseContact(await c.req.json());
  if (!(await vendorExists(c.env.DB, c.get("household"), id))) return c.json({ error: NOT_FOUND }, 404);
  await checkBranch(c.env.DB, id, p.branch_id);
  const row = await c.env.DB.prepare(
    `INSERT INTO vendor_contacts (id, vendor_id, ${CONTACT_FIELDS.join(", ")}, sort_order)
     VALUES (?, ?, ${CONTACT_FIELDS.map(() => "?").join(", ")},
             (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM vendor_contacts WHERE vendor_id = ?))
     RETURNING *`,
  )
    .bind(crypto.randomUUID(), id, ...CONTACT_FIELDS.map((f) => p[f]), id)
    .first<VendorContact>();
  return c.json(row, 201);
});

vendors.put("/:id/contacts/:contactId", async (c) => {
  const id = c.req.param("id");
  const p = parseContact(await c.req.json());
  if (!(await vendorExists(c.env.DB, c.get("household"), id))) return c.json({ error: NOT_FOUND }, 404);
  await checkBranch(c.env.DB, id, p.branch_id);
  const row = await c.env.DB.prepare(
    `UPDATE vendor_contacts SET ${CONTACT_FIELDS.map((f) => `${f} = ?`).join(", ")}
     WHERE id = ? AND vendor_id = ? RETURNING *`,
  )
    .bind(...CONTACT_FIELDS.map((f) => p[f]), c.req.param("contactId"), id)
    .first<VendorContact>();
  if (!row) return c.json({ error: "Contactpersoon niet gevonden" }, 404);
  return c.json(row);
});

vendors.delete("/:id/contacts/:contactId", async (c) => {
  if (!(await vendorExists(c.env.DB, c.get("household"), c.req.param("id")))) return c.json({ error: NOT_FOUND }, 404);
  const { meta } = await c.env.DB.prepare("DELETE FROM vendor_contacts WHERE id = ? AND vendor_id = ?").bind(c.req.param("contactId"), c.req.param("id")).run();
  if (meta.changes === 0) return c.json({ error: "Contactpersoon niet gevonden" }, 404);
  return c.body(null, 204);
});

// ---------- klantenkaarten koppelen ----------

vendors.put("/:id/cards/:cardId", async (c) => {
  const id = c.req.param("id");
  const hh = c.get("household");
  if (!(await vendorExists(c.env.DB, hh, id))) return c.json({ error: NOT_FOUND }, 404);
  const row = await c.env.DB.prepare("UPDATE loyalty_cards SET vendor_id = ? WHERE id = ? AND household_id = ? RETURNING *")
    .bind(id, c.req.param("cardId"), hh)
    .first<LoyaltyCard>();
  if (!row) return c.json({ error: "Kaart niet gevonden" }, 404);
  return c.json(row);
});

vendors.delete("/:id/cards/:cardId", async (c) => {
  const { meta } = await c.env.DB.prepare("UPDATE loyalty_cards SET vendor_id = NULL WHERE id = ? AND vendor_id = ? AND household_id = ?")
    .bind(c.req.param("cardId"), c.req.param("id"), c.get("household"))
    .run();
  if (meta.changes === 0) return c.json({ error: "Kaart niet gevonden" }, 404);
  return c.body(null, 204);
});

/** Alle verkopers van een huishouden (bind: household_id). */
export const vendorsQuery = `SELECT vendors.*, ${USAGE} FROM vendors WHERE household_id = ? ORDER BY name COLLATE NOCASE`;
