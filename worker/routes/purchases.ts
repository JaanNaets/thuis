import { Hono } from "hono";
import { checkCustomShares, splitEqual } from "../../shared/split";
import {
  SPLIT_MODES,
  type ExpenseShare,
  type Purchase,
  type PurchaseDetail,
  type PurchaseFile,
  type PurchaseInput,
  type PurchaseListItem,
} from "../../shared/types";
import type { AppEnv } from "../types";
import {
  asObject,
  idList,
  optionalCents,
  optionalDate,
  optionalEnum,
  optionalId,
  optionalString,
  requiredDate,
  requiredString,
  ValidationError,
} from "../validate";
import { setTagsStatements } from "./taxonomy";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];

const FILE_COLUMNS = "id, purchase_id, filename, content_type, size_bytes, created_at";

function parseShares(value: unknown): ExpenseShare[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 20) throw new ValidationError("'shares' moet een lijst zijn");
  return value.map((v) => {
    const obj = asObject(v);
    const cents = optionalCents(obj, "share_cents");
    return { member_id: requiredString(obj, "member_id", 64), share_cents: cents ?? 0 };
  });
}

function parsePurchase(body: unknown): PurchaseInput {
  const obj = asObject(body);
  const paidBy = optionalId(obj, "paid_by");
  return {
    description: requiredString(obj, "description", 200),
    store: optionalString(obj, "store", 100),
    purchased_on: requiredDate(obj, "purchased_on"),
    amount_cents: optionalCents(obj, "amount_cents"),
    category_id: optionalId(obj, "category_id"),
    paid_by: paidBy,
    // Van de gezamenlijke rekening betaald: niets te verdelen.
    split_mode: paidBy ? (optionalEnum(obj, "split_mode", SPLIT_MODES) ?? "equal") : null,
    shares: parseShares(obj.shares),
    warranty_until: optionalDate(obj, "warranty_until"),
    notes: optionalString(obj, "notes", 2000),
    tag_ids: idList(obj, "tag_ids"),
  };
}

/** Wie welk deel draagt. Bij "gelijk" en "persoonlijk" rekent de server zelf, zodat het altijd klopt. */
async function resolveShares(db: D1Database, input: PurchaseInput): Promise<ExpenseShare[]> {
  const { paid_by: payer, amount_cents: amount, split_mode: mode } = input;
  if (!payer || amount === null || !mode) return [];

  switch (mode) {
    case "personal":
      return [{ member_id: payer, share_cents: amount }];
    case "equal": {
      const { results } = await db.prepare("SELECT id FROM members WHERE active = 1").all<{ id: string }>();
      return splitEqual(amount, results.map((r) => r.id), payer);
    }
    case "custom": {
      const shares = input.shares ?? [];
      const problem = checkCustomShares(amount, shares);
      if (problem) throw new ValidationError(problem);
      return shares.filter((s) => s.share_cents > 0);
    }
  }
}

function shareStatements(db: D1Database, purchaseId: string, shares: ExpenseShare[]): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM expense_shares WHERE purchase_id = ?").bind(purchaseId),
    ...shares.map((s) =>
      db
        .prepare("INSERT INTO expense_shares (purchase_id, member_id, share_cents) VALUES (?, ?, ?)")
        .bind(purchaseId, s.member_id, s.share_cents),
    ),
  ];
}

// Een categorie met al haar subcategorieën (voor ?category=).
const CATEGORY_TREE = `SELECT id FROM (
  WITH RECURSIVE sub(id) AS (
    SELECT ?3 UNION ALL SELECT c2.id FROM categories c2 JOIN sub ON c2.parent_id = sub.id
  ) SELECT id FROM sub)`;

export const purchases = new Hono<AppEnv>();

// Lijst, met optioneel zoeken (?q=), lopende garantie (?warranty=active), categorie (?category=) en tag (?tag=).
purchases.get("/", async (c) => {
  const q = c.req.query("q")?.trim();
  const activeWarranty = c.req.query("warranty") === "active" ? 1 : 0;

  const { results } = await c.env.DB.prepare(
    `SELECT p.*, c.name AS category_name, c.color AS category_color,
       (SELECT COUNT(*) FROM purchase_files f WHERE f.purchase_id = p.id) AS file_count,
       (SELECT f.id FROM purchase_files f
          WHERE f.purchase_id = p.id AND f.content_type LIKE 'image/%'
          ORDER BY f.created_at LIMIT 1) AS thumbnail_file_id
     FROM purchases p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE (?1 IS NULL OR p.description LIKE ?1 OR p.store LIKE ?1 OR c.name LIKE ?1
            OR EXISTS (SELECT 1 FROM taggings g JOIN tags t ON t.id = g.tag_id
                       WHERE g.entity_type = 'purchase' AND g.entity_id = p.id AND t.name LIKE ?1))
       AND (?2 = 0 OR p.warranty_until >= date('now'))
       AND (?3 IS NULL OR p.category_id IN (${CATEGORY_TREE}))
       AND (?4 IS NULL OR EXISTS (SELECT 1 FROM taggings g
                                  WHERE g.entity_type = 'purchase' AND g.entity_id = p.id AND g.tag_id = ?4))
     ORDER BY p.purchased_on DESC, p.created_at DESC
     LIMIT 200`,
  )
    .bind(q ? `%${q}%` : null, activeWarranty, c.req.query("category") || null, c.req.query("tag") || null)
    .all<PurchaseListItem>();

  return c.json(results);
});

purchases.get("/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.env.DB;
  const [purchase, files, shares, tags, items] = await db.batch([
    db
      .prepare(
        `SELECT p.*, c.name AS category_name, c.color AS category_color
         FROM purchases p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`,
      )
      .bind(id),
    db.prepare(`SELECT ${FILE_COLUMNS} FROM purchase_files WHERE purchase_id = ? ORDER BY created_at`).bind(id),
    db.prepare("SELECT member_id, share_cents FROM expense_shares WHERE purchase_id = ?").bind(id),
    db.prepare("SELECT tag_id FROM taggings WHERE entity_type = 'purchase' AND entity_id = ?").bind(id),
    db
      .prepare(
        `SELECT DISTINCT i.id, i.name FROM stock_movements m JOIN items i ON i.id = m.item_id
         WHERE m.purchase_id = ? ORDER BY i.name COLLATE NOCASE`,
      )
      .bind(id),
  ]);

  const row = purchase.results[0] as Omit<PurchaseDetail, "files" | "shares" | "tag_ids" | "items"> | undefined;
  if (!row) return c.json({ error: "Aankoop niet gevonden" }, 404);
  const detail: PurchaseDetail = {
    ...row,
    files: files.results as PurchaseFile[],
    shares: shares.results as ExpenseShare[],
    tag_ids: (tags.results as { tag_id: string }[]).map((t) => t.tag_id),
    items: items.results as PurchaseDetail["items"],
  };
  return c.json(detail);
});

purchases.post("/", async (c) => {
  const input = parsePurchase(await c.req.json());
  const shares = await resolveShares(c.env.DB, input);
  const id = crypto.randomUUID();
  const db = c.env.DB;

  const [inserted] = await db.batch([
    db
      .prepare(
        `INSERT INTO purchases
           (id, description, store, purchased_on, amount_cents, category_id, paid_by, split_mode,
            warranty_until, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .bind(
        id,
        input.description,
        input.store,
        input.purchased_on,
        input.amount_cents,
        input.category_id,
        input.paid_by,
        input.split_mode,
        input.warranty_until,
        input.notes,
        c.get("user"),
      ),
    ...shareStatements(db, id, shares),
    ...setTagsStatements(db, "purchase", id, input.tag_ids),
  ]);

  return c.json(inserted.results[0] as Purchase, 201);
});

purchases.put("/:id", async (c) => {
  const id = c.req.param("id");
  const input = parsePurchase(await c.req.json());
  const db = c.env.DB;
  const exists = await db.prepare("SELECT 1 FROM purchases WHERE id = ?").bind(id).first();
  if (!exists) return c.json({ error: "Aankoop niet gevonden" }, 404);
  const shares = await resolveShares(db, input);

  const [updated] = await db.batch([
    db
      .prepare(
        `UPDATE purchases
         SET description = ?, store = ?, purchased_on = ?, amount_cents = ?, category_id = ?,
             paid_by = ?, split_mode = ?, warranty_until = ?, notes = ?
         WHERE id = ?
         RETURNING *`,
      )
      .bind(
        input.description,
        input.store,
        input.purchased_on,
        input.amount_cents,
        input.category_id,
        input.paid_by,
        input.split_mode,
        input.warranty_until,
        input.notes,
        id,
      ),
    ...shareStatements(db, id, shares),
    ...setTagsStatements(db, "purchase", id, input.tag_ids),
  ]);

  return c.json(updated.results[0] as Purchase);
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

  const [, deleted] = await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM taggings WHERE entity_type = 'purchase' AND entity_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM purchases WHERE id = ?").bind(id),
  ]);
  if (deleted.meta.changes === 0) return c.json({ error: "Aankoop niet gevonden" }, 404);
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
