import { Hono } from "hono";
import { suggestionFromOff } from "../../shared/products";
import { pickConsumeLocation, roundQuantity, summarizeLevels } from "../../shared/stock";
import {
  CONTENT_UNITS,
  ITEM_ORIGINS,
  LINK_ROLES,
  STOCK_ACTIONS,
  isItemType,
  isUnit,
  type BarcodeLookup,
  type ItemDetail,
  type ItemInput,
  type ItemLink,
  type ItemLinkInput,
  type ItemListItem,
  type ItemLogEntry,
  type ItemOrigin,
  type LinkRole,
  type MovementReason,
  type ProductSuggestion,
  type StockActionInput,
  type StockLevel,
} from "../../shared/types";
import { assertOwned, requireFull } from "../context";
import type { AppEnv } from "../types";
import {
  asObject,
  guard,
  idList,
  optionalBoolean,
  optionalCents,
  optionalDate,
  optionalEnum,
  optionalId,
  optionalQuantity,
  optionalString,
  requiredDate,
  requiredEnum,
  requiredId,
  requiredString,
  ValidationError,
} from "../validate";
import { assertTags, setTagsStatements } from "./taxonomy";
import { resolveVendor } from "./vendors";

const BARCODE_TAKEN = "Er is al een item met deze barcode.";

// Voorraad per plaats en tags als JSON in dezelfde rij: één query voor de hele lijst.
// Een koppeling zonder bedrag telt voor het hele bedrag van de uitgave.
const ITEM_SELECT = `
  SELECT i.*, c.name AS category_name, c.color AS category_color,
    (SELECT json_group_array(json_object('location_id', sl.location_id, 'quantity', sl.quantity, 'next_expiry', sl.next_expiry))
       FROM stock_levels sl WHERE sl.item_id = i.id) AS levels_json,
    (SELECT json_group_array(g.tag_id) FROM taggings g WHERE g.entity_type = 'item' AND g.entity_id = i.id) AS tags_json,
    (SELECT COALESCE(SUM(COALESCE(l.amount_cents, p.amount_cents, 0)), 0)
       FROM item_links l JOIN purchases p ON p.id = l.purchase_id WHERE l.item_id = i.id) AS cost_cents,
    (SELECT MAX(p.warranty_until) FROM item_links l JOIN purchases p ON p.id = l.purchase_id WHERE l.item_id = i.id) AS warranty_until,
    (SELECT v.name FROM item_links l JOIN purchases p ON p.id = l.purchase_id JOIN vendors v ON v.id = p.vendor_id
       WHERE l.item_id = i.id AND l.role = 'purchase' ORDER BY p.purchased_on LIMIT 1) AS bought_at
  FROM items i
  LEFT JOIN categories c ON c.id = i.category_id`;

const LINK_SELECT = `
  SELECT l.id, l.item_id, l.purchase_id, l.role, l.quantity, l.amount_cents, l.note,
    p.description, p.purchased_on, p.vendor_id, v.name AS vendor_name, p.amount_cents AS purchase_amount_cents, p.warranty_until
  FROM item_links l
  JOIN purchases p ON p.id = l.purchase_id
  LEFT JOIN vendors v ON v.id = p.vendor_id`;

type ItemRow = Omit<ItemListItem, "levels" | "tag_ids" | "quantity" | "next_expiry"> & {
  levels_json: string;
  tags_json: string;
};

function toListItem({ levels_json, tags_json, ...item }: ItemRow): ItemListItem {
  const levels = JSON.parse(levels_json) as StockLevel[];
  return { ...item, levels, tag_ids: JSON.parse(tags_json) as string[], ...summarizeLevels(levels) };
}

function parseItem(body: unknown, isNew: boolean): ItemInput {
  const obj = asObject(body);
  const type = obj.type ?? "consumable";
  if (!isItemType(type)) throw new ValidationError("Onbekend type");
  const unit = obj.unit ?? "stuk";
  if (!isUnit(unit)) throw new ValidationError("Onbekende eenheid");

  const contentAmount = optionalQuantity(obj, "content_amount");
  const input: ItemInput = {
    name: requiredString(obj, "name", 200),
    type,
    category_id: optionalId(obj, "category_id"),
    default_location_id: optionalId(obj, "default_location_id"),
    unit,
    barcode: optionalString(obj, "barcode", 64),
    brand: optionalString(obj, "brand", 100),
    vendor: optionalString(obj, "vendor", 100),
    min_quantity: optionalQuantity(obj, "min_quantity"),
    notes: optionalString(obj, "notes", 4000),
    parent_id: optionalId(obj, "parent_id"),
    origin: optionalEnum(obj, "origin", Object.keys(ITEM_ORIGINS) as ItemOrigin[]),
    origin_note: optionalString(obj, "origin_note", 200),
    acquired_on: optionalDate(obj, "acquired_on"),
    value_cents: optionalCents(obj, "value_cents"),
    content_amount: contentAmount || null,
    content_unit: contentAmount ? optionalEnum(obj, "content_unit", CONTENT_UNITS) : null,
    tag_ids: idList(obj, "tag_ids"),
  };
  if (input.content_amount && !input.content_unit) throw new ValidationError("Kies de eenheid van de inhoud (kg, l, …)");
  if (isNew && obj.initial) {
    const initial = asObject(obj.initial);
    input.initial = {
      quantity: optionalQuantity(initial, "quantity") ?? 0,
      location_id: optionalId(initial, "location_id"),
      expires_on: optionalDate(initial, "expires_on"),
      purchase_id: optionalId(initial, "purchase_id"),
      amount_cents: optionalCents(initial, "amount_cents"),
    };
  }
  return input;
}

function parseStockAction(body: unknown): StockActionInput {
  const obj = asObject(body);
  const action = requiredEnum(obj, "action", STOCK_ACTIONS);
  const quantity = optionalQuantity(obj, "quantity");
  if (quantity === null || (action !== "count" && quantity === 0)) throw new ValidationError("Vul een hoeveelheid in");
  return {
    action,
    quantity,
    location_id: optionalId(obj, "location_id"),
    to_location_id: optionalId(obj, "to_location_id"),
    expires_on: optionalDate(obj, "expires_on"),
    purchase_id: optionalId(obj, "purchase_id"),
    vendor: optionalString(obj, "vendor", 100),
    note: optionalString(obj, "note", 500),
  };
}

/** De eerste plaats die opgegeven is, anders de bovenste plaats in de lijst (van dit huishouden). */
async function resolveLocation(db: D1Database, household: string, ...preferred: (string | null | undefined)[]): Promise<string> {
  for (const id of preferred) {
    if (!id) continue;
    await assertOwned(db, household, "locations", [id]);
    return id;
  }
  const first = await db
    .prepare("SELECT id FROM locations WHERE household_id = ? ORDER BY parent_id IS NOT NULL, sort_order, name LIMIT 1")
    .bind(household)
    .first<{ id: string }>();
  if (!first) throw new ValidationError("Maak eerst een plaats aan (Meer → Plaatsen).");
  return first.id;
}

type Change = {
  itemId: string;
  locationId: string;
  delta: number;
  reason: MovementReason;
  expiresOn?: string | null;
  purchaseId?: string | null;
  vendorId?: string | null;
  note?: string | null;
  user: string;
};

/**
 * Eén voorraadwijziging: de stand per plaats bijwerken én een regel in het logboek.
 * De stand wordt relatief aangepast (quantity + delta), zodat twee toestellen tegelijk niets overschrijven.
 */
function changeStatements(db: D1Database, ch: Change): D1PreparedStatement[] {
  return [
    db.prepare("INSERT INTO stock_levels (item_id, location_id) VALUES (?, ?) ON CONFLICT DO NOTHING").bind(ch.itemId, ch.locationId),
    db
      .prepare(
        `UPDATE stock_levels SET
           quantity = round(max(0, quantity + ?3), 3),
           next_expiry = CASE
             WHEN quantity + ?3 <= 0 THEN NULL
             WHEN ?4 IS NOT NULL AND (next_expiry IS NULL OR ?4 < next_expiry) THEN ?4
             ELSE next_expiry END,
           updated_at = datetime('now')
         WHERE item_id = ?1 AND location_id = ?2`,
      )
      .bind(ch.itemId, ch.locationId, ch.delta, ch.delta > 0 ? (ch.expiresOn ?? null) : null),
    db.prepare("DELETE FROM stock_levels WHERE item_id = ? AND location_id = ? AND quantity <= 0").bind(ch.itemId, ch.locationId),
    db
      .prepare(
        `INSERT INTO stock_movements
           (id, item_id, location_id, delta, reason, purchase_id, vendor_id, expires_on, note, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        ch.itemId,
        ch.locationId,
        ch.delta,
        ch.reason,
        ch.purchaseId ?? null,
        ch.vendorId ?? null,
        ch.expiresOn ?? null,
        ch.note ?? null,
        ch.user,
      ),
    db.prepare("UPDATE items SET updated_at = datetime('now') WHERE id = ?").bind(ch.itemId),
  ];
}

async function loadDetail(db: D1Database, household: string, id: string): Promise<ItemDetail | null> {
  const [item, movements, links, log, parent, children] = await db.batch([
    db.prepare(`${ITEM_SELECT} WHERE i.id = ? AND i.household_id = ?`).bind(id, household),
    db
      .prepare(
        `SELECT m.*, l.name AS location_name, p.description AS purchase_description, v.name AS vendor_name
         FROM stock_movements m
         LEFT JOIN locations l ON l.id = m.location_id
         LEFT JOIN purchases p ON p.id = m.purchase_id
         LEFT JOIN vendors v ON v.id = m.vendor_id
         WHERE m.item_id = ?
         ORDER BY m.created_at DESC, m.rowid DESC
         LIMIT 50`,
      )
      .bind(id),
    db.prepare(`${LINK_SELECT} WHERE l.item_id = ? ORDER BY p.purchased_on DESC, l.created_at DESC`).bind(id),
    db.prepare("SELECT * FROM item_log WHERE item_id = ? ORDER BY happened_on DESC, created_at DESC").bind(id),
    db.prepare("SELECT p.id, p.name, p.type FROM items i JOIN items p ON p.id = i.parent_id WHERE i.id = ? AND p.household_id = ?").bind(id, household),
    db.prepare(`${ITEM_SELECT} WHERE i.parent_id = ? AND i.household_id = ? AND i.archived = 0 ORDER BY i.name COLLATE NOCASE`).bind(id, household),
  ]);
  const row = item.results[0] as ItemRow | undefined;
  if (!row) return null;
  return {
    ...toListItem(row),
    movements: movements.results as ItemDetail["movements"],
    links: links.results as ItemLink[],
    log: log.results as ItemLogEntry[],
    parent: (parent.results[0] as ItemDetail["parent"]) ?? null,
    children: (children.results as ItemRow[]).map(toListItem),
  };
}

/** Gratis productgegevens bij een barcode. Lukt het niet (snel), dan gewoon niets. */
async function lookupOpenFoodFacts(barcode: string): Promise<ProductSuggestion | null> {
  if (!/^\d{8,14}$/.test(barcode)) return null;
  try {
    const fields = "product_name,product_name_nl,product_name_fr,brands,quantity,categories_tags";
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=${fields}`, {
      headers: { "User-Agent": "Thuis/1.0 (https://github.com/JaanNaets/thuis)" },
      signal: AbortSignal.timeout(4000),
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    if (!res.ok) return null;
    return suggestionFromOff(await res.json());
  } catch {
    return null;
  }
}

/**
 * Verwijzingen van een item moeten bij hetzelfde huishouden horen.
 * "Hoort bij" mag geen kring maken: niet bij zichzelf, en niet bij iets dat (onrechtstreeks) bij dit item hoort.
 */
async function checkItemRefs(db: D1Database, household: string, input: ItemInput, id?: string) {
  await assertOwned(db, household, "categories", [input.category_id]);
  await assertOwned(db, household, "locations", [input.default_location_id, input.initial?.location_id]);
  await assertOwned(db, household, "purchases", [input.initial?.purchase_id]);
  await assertOwned(db, household, "items", [input.parent_id]);
  await assertTags(db, household, input.tag_ids);
  if (id && input.parent_id) {
    const loop = await db
      .prepare(
        `WITH RECURSIVE up(id) AS (SELECT ?1 UNION SELECT i.parent_id FROM items i JOIN up ON i.id = up.id WHERE i.parent_id IS NOT NULL)
         SELECT 1 FROM up WHERE id = ?2 LIMIT 1`,
      )
      .bind(input.parent_id, id)
      .first();
    if (loop) throw new ValidationError("Iets kan niet bij zichzelf horen.");
  }
}

const ITEM_FIELDS = [
  "name",
  "type",
  "category_id",
  "default_location_id",
  "unit",
  "barcode",
  "brand",
  "min_quantity",
  "notes",
  "parent_id",
  "origin",
  "origin_note",
  "acquired_on",
  "value_cents",
  "content_amount",
  "content_unit",
] as const satisfies readonly (keyof ItemInput)[];

function parseLink(body: unknown): ItemLinkInput {
  const obj = asObject(body);
  const role = requiredEnum(obj, "role", Object.keys(LINK_ROLES) as LinkRole[]);
  const quantity = optionalQuantity(obj, "quantity");
  if (role === "refill" && !quantity) throw new ValidationError("Vul in hoeveel je kocht");
  return {
    purchase_id: requiredId(obj, "purchase_id"),
    role,
    quantity: quantity || null,
    amount_cents: optionalCents(obj, "amount_cents"),
    note: optionalString(obj, "note", 500),
    add_stock: optionalBoolean(obj, "add_stock", false),
    location_id: optionalId(obj, "location_id"),
  };
}

export const items = new Hono<AppEnv>();

// De voorraad is van het huishouden: gasten in een project zien die niet.
items.use("*", requireFull);

// De volledige lijst (een huishouden heeft er hooguit enkele honderden); filteren doet de app meteen zelf.
items.get("/", async (c) => {
  const archived = c.req.query("archived") === "1" ? 1 : 0;
  const { results } = await c.env.DB.prepare(`${ITEM_SELECT} WHERE i.household_id = ? AND i.archived = ? ORDER BY i.name COLLATE NOCASE LIMIT 2000`)
    .bind(c.get("household"), archived)
    .all<ItemRow>();
  return c.json(results.map(toListItem));
});

// Eerst kijken of we het item al hebben; zo niet, een voorstel uit Open Food Facts.
items.get("/lookup", async (c) => {
  const barcode = c.req.query("barcode")?.trim();
  if (!barcode) throw new ValidationError("Geef een barcode op");
  const hh = c.get("household");
  const known = await c.env.DB.prepare("SELECT id FROM items WHERE household_id = ? AND barcode = ?").bind(hh, barcode).first<{ id: string }>();
  if (known) return c.json({ item_id: known.id, suggestion: null } satisfies BarcodeLookup);
  const suggestion = await lookupOpenFoodFacts(barcode);
  // Open Food Facts geeft de vaste sleutel van een startcategorie; elk huishouden heeft daar een eigen id voor.
  if (suggestion?.category_id) {
    const category = await c.env.DB.prepare("SELECT id FROM categories WHERE household_id = ? AND key = ?")
      .bind(hh, suggestion.category_id)
      .first<{ id: string }>();
    suggestion.category_id = category?.id ?? null;
  }
  return c.json({ item_id: null, suggestion } satisfies BarcodeLookup);
});

items.get("/:id", async (c) => {
  const detail = await loadDetail(c.env.DB, c.get("household"), c.req.param("id"));
  if (!detail) return c.json({ error: "Item niet gevonden" }, 404);
  return c.json(detail);
});

items.post("/", async (c) => {
  const input = parseItem(await c.req.json(), true);
  const db = c.env.DB;
  const hh = c.get("household");
  const id = crypto.randomUUID();
  const user = c.get("user");
  await checkItemRefs(db, hh, input);
  const vendorId = await resolveVendor(db, hh, input.vendor);
  const purchaseId = input.initial?.purchase_id ?? null;

  const statements = [
    db
      .prepare(
        `INSERT INTO items (id, household_id, ${ITEM_FIELDS.join(", ")}, vendor_id, created_by)
         VALUES (?, ?, ${ITEM_FIELDS.map(() => "?").join(", ")}, ?, ?)`,
      )
      .bind(id, hh, ...ITEM_FIELDS.map((f) => input[f]), vendorId, user),
    ...setTagsStatements(db, "item", id, input.tag_ids),
  ];
  // Uit een aankoop: een bezit is die aankoop zelf, verbruik is bijgekocht (met het aantal, voor de prijs per eenheid).
  if (purchaseId) {
    const refill = input.type === "consumable";
    statements.push(
      db
        .prepare("INSERT INTO item_links (id, item_id, purchase_id, role, quantity, amount_cents, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(
          crypto.randomUUID(),
          id,
          purchaseId,
          refill ? "refill" : "purchase",
          refill ? input.initial?.quantity || null : null,
          input.initial?.amount_cents ?? null,
          user,
        ),
    );
  }
  if (input.initial && input.initial.quantity > 0) {
    const { quantity, location_id, expires_on, purchase_id } = input.initial;
    // Uit een aankoop: gekocht bij de verkoper van die aankoop.
    const purchaseVendor = purchase_id
      ? await db.prepare("SELECT vendor_id FROM purchases WHERE id = ?").bind(purchase_id).first<{ vendor_id: string | null }>()
      : null;
    statements.push(
      ...changeStatements(db, {
        itemId: id,
        locationId: await resolveLocation(db, hh, location_id, input.default_location_id),
        delta: quantity,
        reason: purchase_id ? "purchase" : "add",
        expiresOn: expires_on,
        purchaseId: purchase_id,
        vendorId: purchaseVendor?.vendor_id ?? null,
        user,
      }),
    );
  }

  await guard(db.batch(statements), { unique: BARCODE_TAKEN });
  return c.json(await loadDetail(db, hh, id), 201);
});

items.put("/:id", async (c) => {
  const id = c.req.param("id");
  const input = parseItem(await c.req.json(), false);
  const db = c.env.DB;
  const hh = c.get("household");
  const exists = await db.prepare("SELECT 1 FROM items WHERE id = ? AND household_id = ?").bind(id, hh).first();
  if (!exists) return c.json({ error: "Item niet gevonden" }, 404);
  await checkItemRefs(db, hh, input, id);
  const vendorId = await resolveVendor(db, hh, input.vendor);

  await guard(
    db.batch([
      db
        .prepare(`UPDATE items SET ${ITEM_FIELDS.map((f) => `${f} = ?`).join(", ")}, vendor_id = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(...ITEM_FIELDS.map((f) => input[f]), vendorId, id),
      ...setTagsStatements(db, "item", id, input.tag_ids),
    ]),
    { unique: BARCODE_TAKEN },
  );
  return c.json(await loadDetail(db, hh, id));
});

// Archiveren: weg uit de lijst (verkocht, kapot, weggegeven), maar de geschiedenis blijft.
items.put("/:id/archived", async (c) => {
  const archived = optionalBoolean(asObject(await c.req.json()), "archived", true) ? 1 : 0;
  const { meta } = await c.env.DB.prepare("UPDATE items SET archived = ?, updated_at = datetime('now') WHERE id = ? AND household_id = ?")
    .bind(archived, c.req.param("id"), c.get("household"))
    .run();
  if (meta.changes === 0) return c.json({ error: "Item niet gevonden" }, 404);
  return c.json(await loadDetail(c.env.DB, c.get("household"), c.req.param("id")));
});

items.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const exists = await c.env.DB.prepare("SELECT 1 FROM items WHERE id = ? AND household_id = ?").bind(id, c.get("household")).first();
  if (!exists) return c.json({ error: "Item niet gevonden" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM taggings WHERE entity_type = 'item' AND entity_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM items WHERE id = ?").bind(id),
  ]);
  return c.body(null, 204);
});

// ---------- uitgaven aan een ding ----------

async function itemExists(db: D1Database, household: string, id: string) {
  return db
    .prepare("SELECT type, default_location_id FROM items WHERE id = ? AND household_id = ?")
    .bind(id, household)
    .first<{ type: string; default_location_id: string | null }>();
}

/**
 * Een uitgave aan een ding hangen: de aankoop zelf, bijgekocht, onderhoud, herstelling, …
 * Bij bijkopen kan het meteen in voorraad (met de verkoper van de uitgave).
 */
items.post("/:id/links", async (c) => {
  const id = c.req.param("id");
  const input = parseLink(await c.req.json());
  const db = c.env.DB;
  const hh = c.get("household");
  const user = c.get("user");
  const item = await itemExists(db, hh, id);
  if (!item) return c.json({ error: "Item niet gevonden" }, 404);
  const purchase = await db
    .prepare("SELECT vendor_id FROM purchases WHERE id = ? AND household_id = ?")
    .bind(input.purchase_id, hh)
    .first<{ vendor_id: string | null }>();
  if (!purchase) throw new ValidationError("Die uitgave bestaat niet (meer).");
  await assertOwned(db, hh, "locations", [input.location_id]);

  const linkId = crypto.randomUUID();
  const statements = [
    db
      .prepare("INSERT INTO item_links (id, item_id, purchase_id, role, quantity, amount_cents, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(linkId, id, input.purchase_id, input.role, input.quantity, input.amount_cents, input.note, user),
  ];
  if (input.add_stock && input.role === "refill" && input.quantity) {
    statements.push(
      ...changeStatements(db, {
        itemId: id,
        locationId: await resolveLocation(db, hh, input.location_id, item.default_location_id),
        delta: input.quantity,
        reason: "purchase",
        purchaseId: input.purchase_id,
        vendorId: purchase.vendor_id,
        user,
      }),
    );
  }
  await db.batch(statements);
  return c.json(await db.prepare(`${LINK_SELECT} WHERE l.id = ?`).bind(linkId).first<ItemLink>(), 201);
});

items.put("/:id/links/:linkId", async (c) => {
  const input = parseLink(await c.req.json());
  const db = c.env.DB;
  if (!(await itemExists(db, c.get("household"), c.req.param("id")))) return c.json({ error: "Item niet gevonden" }, 404);
  const { meta } = await db
    .prepare("UPDATE item_links SET role = ?, quantity = ?, amount_cents = ?, note = ? WHERE id = ? AND item_id = ?")
    .bind(input.role, input.quantity, input.amount_cents, input.note, c.req.param("linkId"), c.req.param("id"))
    .run();
  if (meta.changes === 0) return c.json({ error: "Koppeling niet gevonden" }, 404);
  return c.json(await db.prepare(`${LINK_SELECT} WHERE l.id = ?`).bind(c.req.param("linkId")).first<ItemLink>());
});

// Losmaken: de uitgave en de voorraad blijven zoals ze zijn.
items.delete("/:id/links/:linkId", async (c) => {
  const db = c.env.DB;
  if (!(await itemExists(db, c.get("household"), c.req.param("id")))) return c.json({ error: "Item niet gevonden" }, 404);
  const { meta } = await db.prepare("DELETE FROM item_links WHERE id = ? AND item_id = ?").bind(c.req.param("linkId"), c.req.param("id")).run();
  if (meta.changes === 0) return c.json({ error: "Koppeling niet gevonden" }, 404);
  return c.body(null, 204);
});

// ---------- logboek ----------

function parseLog(body: unknown) {
  const obj = asObject(body);
  return { happened_on: requiredDate(obj, "happened_on"), text: requiredString(obj, "text", 2000) };
}

items.post("/:id/log", async (c) => {
  const id = c.req.param("id");
  const entry = parseLog(await c.req.json());
  if (!(await itemExists(c.env.DB, c.get("household"), id))) return c.json({ error: "Item niet gevonden" }, 404);
  const row = await c.env.DB.prepare("INSERT INTO item_log (id, item_id, happened_on, text, created_by) VALUES (?, ?, ?, ?, ?) RETURNING *")
    .bind(crypto.randomUUID(), id, entry.happened_on, entry.text, c.get("user"))
    .first<ItemLogEntry>();
  return c.json(row, 201);
});

items.put("/:id/log/:logId", async (c) => {
  const entry = parseLog(await c.req.json());
  if (!(await itemExists(c.env.DB, c.get("household"), c.req.param("id")))) return c.json({ error: "Item niet gevonden" }, 404);
  const row = await c.env.DB.prepare("UPDATE item_log SET happened_on = ?, text = ? WHERE id = ? AND item_id = ? RETURNING *")
    .bind(entry.happened_on, entry.text, c.req.param("logId"), c.req.param("id"))
    .first<ItemLogEntry>();
  if (!row) return c.json({ error: "Notitie niet gevonden" }, 404);
  return c.json(row);
});

items.delete("/:id/log/:logId", async (c) => {
  if (!(await itemExists(c.env.DB, c.get("household"), c.req.param("id")))) return c.json({ error: "Item niet gevonden" }, 404);
  const { meta } = await c.env.DB.prepare("DELETE FROM item_log WHERE id = ? AND item_id = ?").bind(c.req.param("logId"), c.req.param("id")).run();
  if (meta.changes === 0) return c.json({ error: "Notitie niet gevonden" }, 404);
  return c.body(null, 204);
});

/**
 * Voorraad aanpassen:
 * - add: erbij (gekocht als er een aankoop bij hoort);
 * - consume / discard: verbruikt of weggegooid, standaard van wat het eerst vervalt;
 * - count: "er zijn er nu zoveel" (na een telling);
 * - move: van de ene plaats naar de andere.
 */
items.post("/:id/stock", async (c) => {
  const id = c.req.param("id");
  const input = parseStockAction(await c.req.json());
  const db = c.env.DB;
  const hh = c.get("household");
  const user = c.get("user");

  const item = await db
    .prepare("SELECT default_location_id FROM items WHERE id = ? AND household_id = ?")
    .bind(id, hh)
    .first<{ default_location_id: string | null }>();
  if (!item) return c.json({ error: "Item niet gevonden" }, 404);
  await assertOwned(db, hh, "locations", [input.location_id, input.to_location_id]);
  await assertOwned(db, hh, "purchases", [input.purchase_id]);
  const { results: levels } = await db.prepare("SELECT location_id, quantity, next_expiry FROM stock_levels WHERE item_id = ?").bind(id).all<StockLevel>();
  const levelAt = (locationId: string | null | undefined) => levels.find((l) => l.location_id === locationId);
  const base = { itemId: id, user, note: input.note };

  let statements: D1PreparedStatement[] = [];
  switch (input.action) {
    case "add": {
      const locationId = await resolveLocation(db, hh, input.location_id, item.default_location_id, levels[0]?.location_id);
      statements = changeStatements(db, {
        ...base,
        locationId,
        delta: input.quantity,
        reason: input.purchase_id ? "purchase" : "add",
        expiresOn: input.expires_on,
        purchaseId: input.purchase_id,
        vendorId: await resolveVendor(db, hh, input.vendor ?? null),
      });
      break;
    }
    case "consume":
    case "discard": {
      const level = input.location_id ? levelAt(input.location_id) : pickConsumeLocation(levels, item.default_location_id);
      if (!level || level.quantity <= 0) throw new ValidationError("Er is hier niets meer van in voorraad.");
      statements = changeStatements(db, {
        ...base,
        locationId: level.location_id,
        delta: -Math.min(input.quantity, level.quantity),
        reason: input.action,
      });
      break;
    }
    case "count": {
      const locationId = await resolveLocation(db, hh, input.location_id, levels.length === 1 ? levels[0].location_id : null, item.default_location_id);
      const delta = roundQuantity(input.quantity - (levelAt(locationId)?.quantity ?? 0));
      if (delta !== 0) statements = changeStatements(db, { ...base, locationId, delta, reason: "adjust" });
      break;
    }
    case "move": {
      const from = levelAt(input.location_id);
      if (!from) throw new ValidationError("Kies waar het nu ligt.");
      if (!input.to_location_id || input.to_location_id === from.location_id) throw new ValidationError("Kies een andere plaats.");
      const quantity = Math.min(input.quantity, from.quantity);
      statements = [
        ...changeStatements(db, { ...base, locationId: from.location_id, delta: -quantity, reason: "move" }),
        ...changeStatements(db, {
          ...base,
          locationId: input.to_location_id,
          delta: quantity,
          reason: "move",
          expiresOn: from.next_expiry,
        }),
      ];
      break;
    }
  }

  if (statements.length > 0) await db.batch(statements);
  return c.json(await loadDetail(db, hh, id));
});
