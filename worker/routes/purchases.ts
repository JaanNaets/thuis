import { Hono } from "hono";
import type { Purchase, PurchaseFile, PurchaseInput, PurchaseListItem } from "../../shared/types";
import type { AppEnv } from "../types";
import {
  asObject,
  optionalCents,
  optionalDate,
  optionalString,
  requiredDate,
  requiredString,
} from "../validate";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];

const FILE_COLUMNS = "id, purchase_id, filename, content_type, size_bytes, created_at";

function parsePurchase(body: unknown): PurchaseInput {
  const obj = asObject(body);
  return {
    description: requiredString(obj, "description", 200),
    store: optionalString(obj, "store", 100),
    purchased_on: requiredDate(obj, "purchased_on"),
    amount_cents: optionalCents(obj, "amount_cents"),
    category: optionalString(obj, "category", 50),
    warranty_until: optionalDate(obj, "warranty_until"),
    notes: optionalString(obj, "notes", 2000),
  };
}

export const purchases = new Hono<AppEnv>();

// Lijst, met optioneel zoeken (?q=) en filter op lopende garantie (?warranty=active).
purchases.get("/", async (c) => {
  const q = c.req.query("q")?.trim();
  const activeWarranty = c.req.query("warranty") === "active" ? 1 : 0;

  const { results } = await c.env.DB.prepare(
    `SELECT p.*,
       (SELECT COUNT(*) FROM purchase_files f WHERE f.purchase_id = p.id) AS file_count,
       (SELECT f.id FROM purchase_files f
          WHERE f.purchase_id = p.id AND f.content_type LIKE 'image/%'
          ORDER BY f.created_at LIMIT 1) AS thumbnail_file_id
     FROM purchases p
     WHERE (?1 IS NULL OR p.description LIKE ?1 OR p.store LIKE ?1 OR p.category LIKE ?1)
       AND (?2 = 0 OR p.warranty_until >= date('now'))
     ORDER BY p.purchased_on DESC, p.created_at DESC
     LIMIT 200`,
  )
    .bind(q ? `%${q}%` : null, activeWarranty)
    .all<PurchaseListItem>();

  return c.json(results);
});

purchases.get("/:id", async (c) => {
  const id = c.req.param("id");
  const [purchase, files] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM purchases WHERE id = ?").bind(id),
    c.env.DB.prepare(
      `SELECT ${FILE_COLUMNS} FROM purchase_files WHERE purchase_id = ? ORDER BY created_at`,
    ).bind(id),
  ]);

  const row = purchase.results[0] as Purchase | undefined;
  if (!row) return c.json({ error: "Aankoop niet gevonden" }, 404);
  return c.json({ ...row, files: files.results as PurchaseFile[] });
});

purchases.post("/", async (c) => {
  const input = parsePurchase(await c.req.json());
  const id = crypto.randomUUID();

  const row = await c.env.DB.prepare(
    `INSERT INTO purchases
       (id, description, store, purchased_on, amount_cents, category, warranty_until, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  )
    .bind(
      id,
      input.description,
      input.store,
      input.purchased_on,
      input.amount_cents,
      input.category,
      input.warranty_until,
      input.notes,
      c.get("user"),
    )
    .first<Purchase>();

  return c.json(row, 201);
});

purchases.put("/:id", async (c) => {
  const input = parsePurchase(await c.req.json());

  const row = await c.env.DB.prepare(
    `UPDATE purchases
     SET description = ?, store = ?, purchased_on = ?, amount_cents = ?,
         category = ?, warranty_until = ?, notes = ?
     WHERE id = ?
     RETURNING *`,
  )
    .bind(
      input.description,
      input.store,
      input.purchased_on,
      input.amount_cents,
      input.category,
      input.warranty_until,
      input.notes,
      c.req.param("id"),
    )
    .first<Purchase>();

  if (!row) return c.json({ error: "Aankoop niet gevonden" }, 404);
  return c.json(row);
});

purchases.delete("/:id", async (c) => {
  const id = c.req.param("id");

  // Eerst de bestanden uit R2 halen; de rijen in purchase_files verdwijnen
  // daarna vanzelf door ON DELETE CASCADE.
  const { results } = await c.env.DB.prepare("SELECT r2_key FROM purchase_files WHERE purchase_id = ?")
    .bind(id)
    .all<{ r2_key: string }>();
  if (results.length > 0) {
    await c.env.FILES.delete(results.map((r) => r.r2_key));
  }

  const { meta } = await c.env.DB.prepare("DELETE FROM purchases WHERE id = ?").bind(id).run();
  if (meta.changes === 0) return c.json({ error: "Aankoop niet gevonden" }, 404);
  return c.body(null, 204);
});

// Bewijsstukken uploaden (multipart/form-data, veld "file", meerdere toegelaten).
purchases.post("/:id/files", async (c) => {
  const purchaseId = c.req.param("id");
  const exists = await c.env.DB.prepare("SELECT 1 FROM purchases WHERE id = ?").bind(purchaseId).first();
  if (!exists) return c.json({ error: "Aankoop niet gevonden" }, 404);

  const form = await c.req.formData();
  const uploads = form.getAll("file").filter((f): f is File => f instanceof File);
  if (uploads.length === 0) return c.json({ error: "Geen bestand ontvangen" }, 400);

  for (const file of uploads) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return c.json({ error: `Bestandstype niet toegelaten: ${file.type || "onbekend"}` }, 400);
    }
    if (file.size > MAX_FILE_BYTES) {
      return c.json({ error: `${file.name} is groter dan 20 MB` }, 400);
    }
  }

  const saved: PurchaseFile[] = [];
  for (const file of uploads) {
    const id = crypto.randomUUID();
    const r2Key = `purchases/${purchaseId}/${id}`;
    await c.env.FILES.put(r2Key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });
    const row = await c.env.DB.prepare(
      `INSERT INTO purchase_files (id, purchase_id, r2_key, filename, content_type, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING ${FILE_COLUMNS}`,
    )
      .bind(id, purchaseId, r2Key, file.name.slice(0, 200), file.type, file.size)
      .first<PurchaseFile>();
    saved.push(row!);
  }

  return c.json(saved, 201);
});

// Losse bestanden: tonen en verwijderen.
export const files = new Hono<AppEnv>();

files.get("/:id", async (c) => {
  const meta = await c.env.DB.prepare("SELECT r2_key, filename, content_type FROM purchase_files WHERE id = ?")
    .bind(c.req.param("id"))
    .first<{ r2_key: string; filename: string; content_type: string }>();
  if (!meta) return c.json({ error: "Bestand niet gevonden" }, 404);

  const object = await c.env.FILES.get(meta.r2_key);
  if (!object) return c.json({ error: "Bestand niet gevonden in opslag" }, 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": meta.content_type,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(meta.filename)}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

files.delete("/:id", async (c) => {
  const meta = await c.env.DB.prepare("DELETE FROM purchase_files WHERE id = ? RETURNING r2_key")
    .bind(c.req.param("id"))
    .first<{ r2_key: string }>();
  if (!meta) return c.json({ error: "Bestand niet gevonden" }, 404);

  await c.env.FILES.delete(meta.r2_key);
  return c.body(null, 204);
});
