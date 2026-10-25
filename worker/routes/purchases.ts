import { Hono } from "hono";
import type { Context } from "hono";
import { checkPayments, computeShares, SPLIT_MODES, type PaymentInput, type SplitInput, type SplitLine } from "../../shared/split";
import type { Purchase, PurchaseDetail, PurchaseFile, PurchaseInput, PurchaseListItem } from "../../shared/types";
import { assertOwned, canUseProject } from "../context";
import type { AppEnv } from "../types";
import {
  asObject,
  idList,
  optionalCents,
  optionalDate,
  optionalId,
  optionalString,
  requiredDate,
  requiredEnum,
  requiredString,
  ValidationError,
} from "../validate";
import { assertTags, setTagsStatements } from "./taxonomy";
import { resolveVendor } from "./vendors";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];

const FILE_COLUMNS = "id, purchase_id, filename, content_type, size_bytes, created_at";

type Obj = Record<string, unknown>;

// ---------- invoer controleren ----------

export function parsePayments(value: unknown): PaymentInput[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) throw new ValidationError("'payments' moet een lijst zijn");
  return value.map((v) => {
    const obj = asObject(v);
    return {
      member_id: optionalId(obj, "member_id"),
      pot_id: optionalId(obj, "pot_id"),
      amount_cents: optionalCents(obj, "amount_cents") ?? 0,
    };
  });
}

function parseLines(value: unknown): SplitLine[] {
  if (!Array.isArray(value) || value.length > 200) throw new ValidationError("'lines' moet een lijst zijn");
  return value.map((v) => {
    const obj = asObject(v);
    const amount = obj.amount_cents;
    if (typeof amount !== "number" || !Number.isInteger(amount) || Math.abs(amount) > 100_000_000) {
      throw new ValidationError("Een lijn heeft een ongeldig bedrag");
    }
    return { description: requiredString(obj, "description", 200), amount_cents: amount, member_ids: idList(obj, "member_ids", 50) };
  });
}

export function parseSplit(value: unknown): SplitInput | null {
  if (value === undefined || value === null) return null;
  const obj = asObject(value);
  const mode = requiredEnum(obj, "mode", SPLIT_MODES);
  if (!Array.isArray(obj.participants) || obj.participants.length > 50) throw new ValidationError("'participants' moet een lijst zijn");
  const participants = obj.participants.map((p) => {
    const item = asObject(p);
    const v = item.value;
    if (v !== undefined && v !== null && (typeof v !== "number" || !Number.isFinite(v))) throw new ValidationError("Ongeldige verdeling");
    return { member_id: requiredString(item, "member_id", 64), value: (v as number | null | undefined) ?? null };
  });
  return { mode, participants, lines: mode === "lines" ? parseLines(obj.lines) : undefined };
}

function parsePurchase(body: unknown): PurchaseInput {
  const obj: Obj = asObject(body);
  return {
    description: requiredString(obj, "description", 200),
    vendor: optionalString(obj, "vendor", 100),
    purchased_on: requiredDate(obj, "purchased_on"),
    amount_cents: optionalCents(obj, "amount_cents"),
    category_id: optionalId(obj, "category_id"),
    project_id: optionalId(obj, "project_id"),
    payments: parsePayments(obj.payments),
    split: parseSplit(obj.split),
    warranty_until: optionalDate(obj, "warranty_until"),
    notes: optionalString(obj, "notes", 2000),
    tag_ids: idList(obj, "tag_ids"),
  };
}

export type Computed = {
  payments: PaymentInput[];
  shares: { member_id: string; share_cents: number; split_value: number | null }[];
  lines: SplitLine[];
  splitMode: SplitInput["mode"] | null;
};

/**
 * Controleert betalers en verdeling, en rekent de delen uit. Alle mensen en potten moeten bij dit huishouden horen;
 * bij een project moeten de mensen deelnemers zijn en de potten van dat project (of van het huishouden).
 */
export async function resolveSplit(
  db: D1Database,
  household: string,
  input: Pick<PurchaseInput, "amount_cents" | "project_id" | "payments" | "split">,
  /** Volledige leden mogen ook een pot van het huishouden gebruiken in een project; gasten enkel de potten van het project. */
  allowHouseholdPots = true,
): Promise<Computed> {
  const amount = input.amount_cents;
  if (amount === null || amount === 0) {
    if (input.payments.length > 0 && amount === null) throw new ValidationError("Vul eerst een bedrag in");
    return { payments: [], shares: [], lines: [], splitMode: null };
  }
  const problem = checkPayments(amount, input.payments);
  if (problem) throw new ValidationError(problem);

  const memberIds = [
    ...input.payments.map((p) => p.member_id),
    ...(input.split?.participants.map((p) => p.member_id) ?? []),
    ...(input.split?.lines?.flatMap((l) => l.member_ids) ?? []),
  ].filter((id): id is string => Boolean(id));
  const potIds = input.payments.map((p) => p.pot_id).filter((id): id is string => Boolean(id));

  await assertOwned(db, household, "members", memberIds);
  if (input.project_id) {
    const unique = [...new Set(memberIds)];
    if (unique.length > 0) {
      const { results } = await db
        .prepare(`SELECT member_id FROM project_members WHERE project_id = ? AND member_id IN (${unique.map(() => "?").join(", ")})`)
        .bind(input.project_id, ...unique)
        .all();
      if (results.length !== unique.length) throw new ValidationError("Iedereen in de verdeling moet deelnemer van het project zijn");
    }
  }
  if (potIds.length > 0) {
    const unique = [...new Set(potIds)];
    const { results } = await db
      .prepare(`SELECT id, project_id FROM pots WHERE household_id = ? AND id IN (${unique.map(() => "?").join(", ")})`)
      .bind(household, ...unique)
      .all<{ id: string; project_id: string | null }>();
    if (results.length !== unique.length) throw new ValidationError("Die pot bestaat niet (meer)");
    if (results.some((p) => (p.project_id === null ? input.project_id !== null && !allowHouseholdPots : p.project_id !== input.project_id))) {
      throw new ValidationError("Die pot hoort niet bij dit project");
    }
  }

  if (!input.split) return { payments: input.payments, shares: [], lines: [], splitMode: null };
  const payerIds = input.payments.flatMap((p) => (p.member_id ? [p.member_id] : []));
  const result = computeShares(amount, input.split, payerIds);
  if ("error" in result) throw new ValidationError(result.error);
  return { payments: input.payments, shares: result.shares, lines: input.split.lines ?? [], splitMode: input.split.mode };
}

/** Statements om betalers, delen en lijnen van een uitgave te vervangen. */
export function splitStatements(db: D1Database, purchaseId: string, computed: Computed): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM expense_payments WHERE purchase_id = ?").bind(purchaseId),
    db.prepare("DELETE FROM expense_shares WHERE purchase_id = ?").bind(purchaseId),
    db.prepare("DELETE FROM expense_lines WHERE purchase_id = ?").bind(purchaseId),
    ...computed.payments.map((p) =>
      db
        .prepare("INSERT INTO expense_payments (purchase_id, member_id, pot_id, amount_cents) VALUES (?, ?, ?, ?)")
        .bind(purchaseId, p.member_id, p.pot_id, p.amount_cents),
    ),
    ...computed.shares.map((s) =>
      db
        .prepare("INSERT INTO expense_shares (purchase_id, member_id, share_cents, split_value) VALUES (?, ?, ?, ?)")
        .bind(purchaseId, s.member_id, s.share_cents, s.split_value),
    ),
    ...computed.lines.map((l, i) =>
      db
        .prepare("INSERT INTO expense_lines (id, purchase_id, position, description, amount_cents, member_ids) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), purchaseId, i, l.description, l.amount_cents, JSON.stringify(l.member_ids)),
    ),
  ];
}

// ---------- lijst ----------

/** Kolommen en joins voor een lijst van aankopen (PurchaseListItem, via toListItem); ook gebruikt bij verkopers en projecten. */
export const PURCHASE_LIST_COLUMNS = `p.*, v.name AS vendor_name, c.name AS category_name, c.color AS category_color, pr.name AS project_name,
  (SELECT COUNT(*) FROM purchase_files f WHERE f.purchase_id = p.id) AS file_count,
  (SELECT f.id FROM purchase_files f
     WHERE f.purchase_id = p.id AND f.content_type LIKE 'image/%'
     ORDER BY f.created_at LIMIT 1) AS thumbnail_file_id,
  (SELECT json_group_array(json_object('member_id', ep.member_id, 'pot_id', ep.pot_id, 'amount_cents', ep.amount_cents))
     FROM expense_payments ep WHERE ep.purchase_id = p.id) AS payments_json`;

export const PURCHASE_LIST_FROM = `FROM purchases p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN vendors v ON v.id = p.vendor_id
  LEFT JOIN projects pr ON pr.id = p.project_id`;

export type PurchaseRow = Omit<PurchaseListItem, "payments"> & { payments_json: string };

export function toListItem({ payments_json, ...row }: PurchaseRow): PurchaseListItem {
  return { ...row, payments: JSON.parse(payments_json) as PaymentInput[] };
}

/**
 * Wat een gast (enkel projecten) van de uitgaven ziet: alles in zijn projecten, plus elke uitgave waarin hij zelf
 * betaalde of een deel heeft (bv. gedeeld voor hij kon aanmelden). `m` is de parameter met zijn lid-id.
 */
export function guestSeesSql(m: string): string {
  return `(p.project_id IN (SELECT project_id FROM project_members WHERE member_id = ${m} AND scope = 'all')
    OR p.id IN (SELECT purchase_id FROM expense_shares WHERE member_id = ${m})
    OR p.id IN (SELECT purchase_id FROM expense_payments WHERE member_id = ${m}))`;
}

/** De aankopen die dit lid mag zien. Parameters vanaf ?n: het huishouden en, voor een gast, zijn lid-id. */
function visibleSql(full: boolean, n: number): string {
  return full ? `p.household_id = ?${n}` : `p.household_id = ?${n} AND ${guestSeesSql(`?${n + 1}`)}`;
}

function visibleBinds(c: Context<AppEnv>): string[] {
  return c.get("full") ? [c.get("household")] : [c.get("household"), c.get("member").id];
}

/**
 * De aankoop, als dit lid ze mag aanpassen: volledige leden alles van het huishouden, een gast enkel wat in zijn
 * projecten staat. Wat buiten een project met een gast gedeeld werd, kan die zien maar niet veranderen.
 */
async function writable(c: Context<AppEnv>, id: string): Promise<Pick<Purchase, "id" | "project_id"> | null> {
  const full = c.get("full");
  const scope = full
    ? "p.household_id = ?2"
    : "p.household_id = ?2 AND p.project_id IN (SELECT project_id FROM project_members WHERE member_id = ?3 AND scope = 'all')";
  return c.env.DB.prepare(`SELECT p.id, p.project_id FROM purchases p WHERE p.id = ?1 AND ${scope}`)
    .bind(id, ...visibleBinds(c))
    .first<Pick<Purchase, "id" | "project_id">>();
}

/** Mag dit lid een uitgave in dit project (of, zonder project, in het huishouden) zetten? */
async function checkProject(c: Context<AppEnv>, projectId: string | null) {
  const db = c.env.DB;
  if (!projectId) {
    if (!c.get("full")) throw new ValidationError("Kies een project");
    return;
  }
  // Een gast die enkel zijn deel ziet, zet zelf geen uitgaven in het project.
  if (!(await canUseProject(db, c.get("household"), c.get("member"), projectId))) throw new ValidationError("Dat project bestaat niet (meer)");
}

// Een categorie met al haar subcategorieën (voor ?category=).
const CATEGORY_TREE = `SELECT id FROM (
  WITH RECURSIVE sub(id) AS (
    SELECT ?3 UNION ALL SELECT c2.id FROM categories c2 JOIN sub ON c2.parent_id = sub.id
  ) SELECT id FROM sub)`;

export const purchases = new Hono<AppEnv>();

// Lijst, met optioneel zoeken (?q=), lopende garantie (?warranty=active), categorie (?category=), tag (?tag=),
// verkoper (?vendor=) en project (?project=).
purchases.get("/", async (c) => {
  const q = c.req.query("q")?.trim();
  const activeWarranty = c.req.query("warranty") === "active" ? 1 : 0;
  const scope = visibleSql(c.get("full"), 7);

  const { results } = await c.env.DB.prepare(
    `SELECT ${PURCHASE_LIST_COLUMNS}
     ${PURCHASE_LIST_FROM}
     WHERE ${scope}
       AND (?1 IS NULL OR p.description LIKE ?1 OR v.name LIKE ?1 OR c.name LIKE ?1 OR p.notes LIKE ?1 OR pr.name LIKE ?1
            OR EXISTS (SELECT 1 FROM taggings g JOIN tags t ON t.id = g.tag_id
                       WHERE g.entity_type = 'purchase' AND g.entity_id = p.id AND t.name LIKE ?1))
       AND (?2 = 0 OR p.warranty_until >= date('now'))
       AND (?3 IS NULL OR p.category_id IN (${CATEGORY_TREE}))
       AND (?4 IS NULL OR EXISTS (SELECT 1 FROM taggings g
                                  WHERE g.entity_type = 'purchase' AND g.entity_id = p.id AND g.tag_id = ?4))
       AND (?5 IS NULL OR p.vendor_id = ?5)
       AND (?6 IS NULL OR p.project_id = ?6)
     ORDER BY p.purchased_on DESC, p.created_at DESC
     LIMIT 200`,
  )
    .bind(
      q ? `%${q}%` : null,
      activeWarranty,
      c.req.query("category") || null,
      c.req.query("tag") || null,
      c.req.query("vendor") || null,
      c.req.query("project") || null,
      // D1 wil precies zoveel waarden als er parameters zijn: ?8 bestaat enkel voor een gast.
      ...visibleBinds(c),
    )
    .all<PurchaseRow>();

  return c.json(results.map(toListItem));
});

purchases.get("/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.env.DB;
  const [purchase, files, shares, lines, tags, links] = await db.batch([
    db.prepare(`SELECT ${PURCHASE_LIST_COLUMNS} ${PURCHASE_LIST_FROM} WHERE p.id = ?1 AND ${visibleSql(c.get("full"), 2)}`).bind(id, ...visibleBinds(c)),
    db.prepare(`SELECT ${FILE_COLUMNS} FROM purchase_files WHERE purchase_id = ? ORDER BY created_at`).bind(id),
    db.prepare("SELECT member_id, share_cents, split_value FROM expense_shares WHERE purchase_id = ?").bind(id),
    db.prepare("SELECT description, amount_cents, member_ids FROM expense_lines WHERE purchase_id = ? ORDER BY position").bind(id),
    db.prepare("SELECT tag_id FROM taggings WHERE entity_type = 'purchase' AND entity_id = ?").bind(id),
    db
      .prepare(
        `SELECT l.id, l.item_id, l.role, l.quantity, l.amount_cents, l.note, i.name AS item_name, i.type AS item_type, i.unit,
           i.project_id AS item_project_id
         FROM item_links l JOIN items i ON i.id = l.item_id
         WHERE l.purchase_id = ?1
           -- Een gast ziet enkel de dingen van het project van de uitgave, niet de voorraad van het huishouden.
           AND (?2 = 1 OR i.project_id = (SELECT project_id FROM purchases WHERE id = ?1))
         ORDER BY l.created_at`,
      )
      .bind(id, c.get("full") ? 1 : 0),
  ]);

  const row = purchase.results[0] as PurchaseRow | undefined;
  if (!row) return c.json({ error: "Aankoop niet gevonden" }, 404);
  const full = c.get("full");
  const detail: PurchaseDetail = {
    ...toListItem(row),
    files: files.results as PurchaseFile[],
    shares: shares.results as PurchaseDetail["shares"],
    lines: (lines.results as { description: string; amount_cents: number; member_ids: string }[]).map((l) => ({
      ...l,
      member_ids: JSON.parse(l.member_ids) as string[],
    })),
    // Een gast ziet geen tags, voorraad of bezit van het huishouden.
    tag_ids: full ? (tags.results as { tag_id: string }[]).map((t) => t.tag_id) : [],
    links: full ? (links.results as PurchaseDetail["links"]) : [],
  };
  return c.json(detail);
});

/** Alles controleren en klaarzetten om een aankoop te bewaren. */
async function prepare(c: Context<AppEnv>, input: PurchaseInput) {
  const db = c.env.DB;
  const hh = c.get("household");
  await checkProject(c, input.project_id);
  await assertOwned(db, hh, "categories", [input.category_id]);
  // Tags zijn van het huishouden; een gast kan ze niet zien en dus ook niet zetten.
  const tagIds = c.get("full") ? input.tag_ids : [];
  await assertTags(db, hh, tagIds);
  const computed = await resolveSplit(db, hh, input, c.get("full"));
  const vendorId = await resolveVendor(db, hh, input.vendor);
  return { computed, vendorId, tagIds };
}

purchases.post("/", async (c) => {
  const input = parsePurchase(await c.req.json());
  const { computed, vendorId, tagIds } = await prepare(c, input);
  const id = crypto.randomUUID();
  const db = c.env.DB;

  const [inserted] = await db.batch([
    db
      .prepare(
        `INSERT INTO purchases
           (id, household_id, project_id, description, vendor_id, purchased_on, amount_cents, category_id, split_mode,
            warranty_until, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .bind(
        id,
        c.get("household"),
        input.project_id,
        input.description,
        vendorId,
        input.purchased_on,
        input.amount_cents,
        input.category_id,
        computed.splitMode,
        input.warranty_until,
        input.notes,
        c.get("user"),
      ),
    ...splitStatements(db, id, computed),
    ...setTagsStatements(db, "purchase", id, tagIds),
  ]);

  return c.json(inserted.results[0] as Purchase, 201);
});

purchases.put("/:id", async (c) => {
  const id = c.req.param("id");
  const input = parsePurchase(await c.req.json());
  const db = c.env.DB;
  if (!(await writable(c, id))) return c.json({ error: "Deze uitgave kan je niet aanpassen" }, 404);
  const { computed, vendorId, tagIds } = await prepare(c, input);

  const [updated] = await db.batch([
    db
      .prepare(
        `UPDATE purchases
         SET project_id = ?, description = ?, vendor_id = ?, purchased_on = ?, amount_cents = ?, category_id = ?,
             split_mode = ?, warranty_until = ?, notes = ?
         WHERE id = ? AND household_id = ?
         RETURNING *`,
      )
      .bind(
        input.project_id,
        input.description,
        vendorId,
        input.purchased_on,
        input.amount_cents,
        input.category_id,
        computed.splitMode,
        input.warranty_until,
        input.notes,
        id,
        c.get("household"),
      ),
    ...splitStatements(db, id, computed),
    // Een gast laat de tags (die hij niet ziet) ongemoeid.
    ...(c.get("full") ? setTagsStatements(db, "purchase", id, tagIds) : []),
  ]);

  return c.json(updated.results[0] as Purchase);
});

purchases.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await writable(c, id))) return c.json({ error: "Deze uitgave kan je niet verwijderen" }, 404);

  // Eerst de bestanden uit R2 halen; de rijen in purchase_files verdwijnen daarna vanzelf (ON DELETE CASCADE).
  const { results } = await c.env.DB.prepare("SELECT r2_key FROM purchase_files WHERE purchase_id = ?").bind(id).all<{ r2_key: string }>();
  if (results.length > 0) await c.env.FILES.delete(results.map((r) => r.r2_key));

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM taggings WHERE entity_type = 'purchase' AND entity_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM purchases WHERE id = ? AND household_id = ?").bind(id, c.get("household")),
  ]);
  return c.body(null, 204);
});

// Bewijsstukken uploaden (multipart/form-data, veld "file", meerdere toegelaten).
purchases.post("/:id/files", async (c) => {
  const purchaseId = c.req.param("id");
  if (!(await writable(c, purchaseId))) return c.json({ error: "Aankoop niet gevonden" }, 404);

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
    await c.env.FILES.put(r2Key, file.stream(), { httpMetadata: { contentType: file.type } });
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

// Losse bestanden: tonen en verwijderen, enkel als je de aankoop mag zien.
export const files = new Hono<AppEnv>();

async function accessibleFile(c: Context<AppEnv>, id: string) {
  return c.env.DB.prepare(
    `SELECT f.r2_key, f.filename, f.content_type, p.id AS purchase_id FROM purchase_files f JOIN purchases p ON p.id = f.purchase_id
     WHERE f.id = ?1 AND ${visibleSql(c.get("full"), 2)}`,
  )
    .bind(id, ...visibleBinds(c))
    .first<{ r2_key: string; filename: string; content_type: string; purchase_id: string }>();
}

files.get("/:id", async (c) => {
  const meta = await accessibleFile(c, c.req.param("id"));
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
  const id = c.req.param("id");
  const meta = await accessibleFile(c, id);
  if (!meta || !(await writable(c, meta.purchase_id))) return c.json({ error: "Bestand niet gevonden" }, 404);
  await c.env.DB.prepare("DELETE FROM purchase_files WHERE id = ?").bind(id).run();
  await c.env.FILES.delete(meta.r2_key);
  return c.body(null, 204);
});
