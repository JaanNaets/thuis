import { Hono } from "hono";
import { suggestionFromOff } from "../../shared/products";
import { pickConsumeLocation, roundQuantity, summarizeLevels } from "../../shared/stock";
import {
  STOCK_ACTIONS,
  isItemType,
  isUnit,
  type BarcodeLookup,
  type ItemDetail,
  type ItemInput,
  type ItemListItem,
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
  optionalDate,
  optionalId,
  optionalQuantity,
  optionalString,
  requiredEnum,
  requiredString,
  ValidationError,
} from "../validate";
import { assertTags, setTagsStatements } from "./taxonomy";
import { resolveVendor } from "./vendors";

const BARCODE_TAKEN = "Er is al een item met deze barcode.";

// Voorraad per plaats en tags als JSON in dezelfde rij: één query voor de hele lijst.
const ITEM_SELECT = `
  SELECT i.*, c.name AS category_name, c.color AS category_color,
    (SELECT json_group_array(json_object('location_id', sl.location_id, 'quantity', sl.quantity, 'next_expiry', sl.next_expiry))
       FROM stock_levels sl WHERE sl.item_id = i.id) AS levels_json,
    (SELECT json_group_array(g.tag_id) FROM taggings g WHERE g.entity_type = 'item' AND g.entity_id = i.id) AS tags_json
  FROM items i
  LEFT JOIN categories c ON c.id = i.category_id`;

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
    notes: optionalString(obj, "notes", 2000),
    tag_ids: idList(obj, "tag_ids"),
  };
  if (isNew && obj.initial) {
    const initial = asObject(obj.initial);
    input.initial = {
      quantity: optionalQuantity(initial, "quantity") ?? 0,
      location_id: optionalId(initial, "location_id"),
      expires_on: optionalDate(initial, "expires_on"),
      purchase_id: optionalId(initial, "purchase_id"),
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
  const [item, movements, purchases] = await db.batch([
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
    db
      .prepare(
        `SELECT DISTINCT p.id, p.description, p.purchased_on, p.warranty_until
         FROM stock_movements m JOIN purchases p ON p.id = m.purchase_id
         WHERE m.item_id = ?
         ORDER BY p.purchased_on DESC`,
      )
      .bind(id),
  ]);
  const row = item.results[0] as ItemRow | undefined;
  if (!row) return null;
  return {
    ...toListItem(row),
    movements: movements.results as ItemDetail["movements"],
    purchases: purchases.results as ItemDetail["purchases"],
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

/** Verwijzingen van een item moeten bij hetzelfde huishouden horen. */
async function checkItemRefs(db: D1Database, household: string, input: ItemInput) {
  await assertOwned(db, household, "categories", [input.category_id]);
  await assertOwned(db, household, "locations", [input.default_location_id, input.initial?.location_id]);
  await assertOwned(db, household, "purchases", [input.initial?.purchase_id]);
  await assertTags(db, household, input.tag_ids);
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

  const statements = [
    db
      .prepare(
        `INSERT INTO items
           (id, household_id, name, type, category_id, default_location_id, unit, barcode, brand, vendor_id, min_quantity, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        hh,
        input.name,
        input.type,
        input.category_id,
        input.default_location_id,
        input.unit,
        input.barcode,
        input.brand,
        vendorId,
        input.min_quantity,
        input.notes,
        user,
      ),
    ...setTagsStatements(db, "item", id, input.tag_ids),
  ];
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
  await checkItemRefs(db, hh, input);
  const vendorId = await resolveVendor(db, hh, input.vendor);

  await guard(
    db.batch([
      db
        .prepare(
          `UPDATE items SET name = ?, type = ?, category_id = ?, default_location_id = ?, unit = ?, barcode = ?,
             brand = ?, vendor_id = ?, min_quantity = ?, notes = ?, updated_at = datetime('now')
           WHERE id = ?`,
        )
        .bind(
          input.name,
          input.type,
          input.category_id,
          input.default_location_id,
          input.unit,
          input.barcode,
          input.brand,
          vendorId,
          input.min_quantity,
          input.notes,
          id,
        ),
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
