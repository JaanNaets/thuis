import { Hono } from "hono";
import type { Context } from "hono";
import { cleanAttributes, normalizeOwners, templateOf, type FieldDef, type OwnerShare } from "../../shared/fields";
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
  type ItemImportResult,
  type ItemImportRow,
  type ItemType,
  type ItemInput,
  type ItemLink,
  type ItemLinkInput,
  type ItemListItem,
  type ItemLogEntry,
  type ItemOrigin,
  type LabelScan,
  type LinkRole,
  type MovementReason,
  type ProductSuggestion,
  type ProjectScope,
  type StockActionInput,
  type StockLevel,
} from "../../shared/types";
import { assertOwned, projectScope, requireFull } from "../context";
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
import { AI_IMAGE_TYPES, MAX_IMAGE_BYTES, MODEL, safeJson, toBase64, useAiBudget } from "./receipts";
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
       WHERE l.item_id = i.id AND l.role = 'purchase' ORDER BY p.purchased_on LIMIT 1) AS bought_at,
    (SELECT json_group_array(json_object('member_id', o.member_id, 'share', o.share)) FROM item_owners o WHERE o.item_id = i.id) AS owners_json
  FROM items i
  LEFT JOIN categories c ON c.id = i.category_id`;

const LINK_SELECT = `
  SELECT l.id, l.item_id, l.purchase_id, l.role, l.quantity, l.amount_cents, l.note,
    p.description, p.purchased_on, p.vendor_id, v.name AS vendor_name, p.amount_cents AS purchase_amount_cents, p.warranty_until
  FROM item_links l
  JOIN purchases p ON p.id = l.purchase_id
  LEFT JOIN vendors v ON v.id = p.vendor_id`;

type ItemRow = Omit<ItemListItem, "levels" | "tag_ids" | "quantity" | "next_expiry" | "owners" | "attributes"> & {
  levels_json: string;
  tags_json: string;
  owners_json: string;
  attributes: string | null;
};

function toListItem({ levels_json, tags_json, owners_json, attributes, ...item }: ItemRow): ItemListItem {
  const levels = JSON.parse(levels_json) as StockLevel[];
  return {
    ...item,
    levels,
    tag_ids: JSON.parse(tags_json) as string[],
    owners: JSON.parse(owners_json) as OwnerShare[],
    attributes: attributes ? (JSON.parse(attributes) as ItemListItem["attributes"]) : {},
    ...summarizeLevels(levels),
  };
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
    project_id: optionalId(obj, "project_id"),
    // Wordt nagekeken tegen de velden van het project (zie prepareItem).
    attributes: (obj.attributes ?? {}) as ItemInput["attributes"],
    owners: [],
    tag_ids: idList(obj, "tag_ids"),
  };
  try {
    input.owners = normalizeOwners(obj.owners);
  } catch (err) {
    throw new ValidationError((err as Error).message);
  }
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
  "project_id",
  "attributes",
] as const satisfies readonly (keyof ItemInput)[];

function itemValues(input: ItemInput) {
  return ITEM_FIELDS.map((f) => (f === "attributes" ? (Object.keys(input.attributes).length ? JSON.stringify(input.attributes) : null) : input[f]));
}

type ProjectForItems = { id: string; fields: FieldDef[]; item_type: ItemType | null; item_unit: string | null; template: string | null };

/** Het project (met dingen) waarin iets komt, van dit huishouden. */
async function itemsProject(db: D1Database, household: string, projectId: string): Promise<ProjectForItems> {
  const row = await db
    .prepare("SELECT id, fields, item_type, item_unit, template FROM projects WHERE id = ? AND household_id = ? AND track_items = 1")
    .bind(projectId, household)
    .first<Omit<ProjectForItems, "fields"> & { fields: string | null }>();
  if (!row) throw new ValidationError("Dat project houdt geen dingen bij");
  return { ...row, fields: row.fields ? (JSON.parse(row.fields) as FieldDef[]) : [] };
}

/**
 * Een item klaarzetten om te bewaren: het project (een gast enkel in een project waarin die volledig meedoet),
 * de waarden van de eigen velden en de eigenaars (leden van dit huishouden).
 */
async function prepareItem(c: Context<AppEnv>, input: ItemInput, existing?: ExistingItem) {
  const db = c.env.DB;
  const hh = c.get("household");
  if (!c.get("full")) {
    // Een gast verplaatst niets naar of uit een project, en ziet de plaatsen, categorieën en tags van het huishouden niet:
    // die blijven zoals ze waren.
    if (!input.project_id || (existing && input.project_id !== existing.project_id)) throw new ValidationError("Kies een project");
    if ((await projectScope(db, hh, c.get("member"), input.project_id)) !== "all") throw new ValidationError("Dat project bestaat niet (meer)");
    input.category_id = existing?.category_id ?? null;
    input.default_location_id = existing?.default_location_id ?? null;
    input.tag_ids = existing?.tag_ids ?? [];
    if (input.initial) input.initial.location_id = null;
    await assertInProject(db, "purchases", input.initial?.purchase_id, input.project_id);
    await assertInProject(db, "items", input.parent_id, input.project_id);
  }
  const project = input.project_id ? await itemsProject(db, hh, input.project_id) : null;
  input.attributes = project ? cleanAttributes(project.fields, input.attributes) : {};
  await assertOwned(
    db,
    hh,
    "members",
    input.owners.map((o) => o.member_id),
  );
  return project;
}

type ExistingItem = { project_id: string | null; category_id: string | null; default_location_id: string | null; tag_ids: string[] };

/** Voor een gast: een uitgave of ding waarnaar verwezen wordt, moet in hetzelfde project zitten. */
async function assertInProject(db: D1Database, table: "purchases" | "items", id: string | null | undefined, projectId: string | null) {
  if (!id) return;
  const row = await db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND project_id = ?`).bind(id, projectId).first();
  if (!row) throw new ValidationError(table === "purchases" ? "Die uitgave hoort niet bij dit project." : "Dat hoort niet bij dit project.");
}

function ownerStatements(db: D1Database, itemId: string, owners: OwnerShare[]): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM item_owners WHERE item_id = ?").bind(itemId),
    ...owners.map((o) => db.prepare("INSERT INTO item_owners (item_id, member_id, share) VALUES (?, ?, ?)").bind(itemId, o.member_id, o.share)),
  ];
}

type Access = { id: string; type: ItemType; default_location_id: string | null; project_id: string | null; scope: ProjectScope };

/**
 * Mag dit lid dit item zien (of aanpassen)? Volledige leden: alles in het huishouden. Een gast: de dingen in
 * zijn projecten; wie enkel zijn deel ziet, enkel waarvan die mede-eigenaar is, en dan enkel bekijken.
 */
async function itemAccess(c: Context<AppEnv>, id: string, write: boolean): Promise<Access | null> {
  const db = c.env.DB;
  const row = await db
    .prepare("SELECT id, type, default_location_id, project_id FROM items WHERE id = ? AND household_id = ?")
    .bind(id, c.get("household"))
    .first<Omit<Access, "scope">>();
  if (!row) return null;
  if (c.get("full")) return { ...row, scope: "all" };
  if (!row.project_id) return null;
  const scope = await projectScope(db, c.get("household"), c.get("member"), row.project_id);
  if (scope === "all") return { ...row, scope };
  if (scope !== "own" || write) return null;
  const owns = await db.prepare("SELECT 1 FROM item_owners WHERE item_id = ? AND member_id = ?").bind(id, c.get("member").id).first();
  return owns ? { ...row, scope } : null;
}

const NOT_FOUND = "Item niet gevonden";

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

/**
 * De lijst (een huishouden heeft er hooguit enkele duizenden); filteren doet de app meteen zelf.
 * ?project= enkel de dingen van dat project. De voorraad van het huishouden is niet voor gasten: een gast krijgt
 * enkel de dingen van een project waarin die zit (met "enkel zijn deel": waarvan die mede-eigenaar is).
 */
items.get("/", async (c) => {
  const db = c.env.DB;
  const hh = c.get("household");
  const archived = c.req.query("archived") === "1" ? 1 : 0;
  const projectId = c.req.query("project") || null;
  if (!c.get("full")) {
    const scope = projectId ? await projectScope(db, hh, c.get("member"), projectId) : null;
    if (!projectId || !scope) return c.json({ error: "Hiervoor heb je geen toegang." }, 403);
    const own = scope === "own" ? "AND i.id IN (SELECT item_id FROM item_owners WHERE member_id = ?4)" : "";
    const { results } = await db
      .prepare(`${ITEM_SELECT} WHERE i.household_id = ?1 AND i.archived = ?2 AND i.project_id = ?3 ${own} ORDER BY i.name COLLATE NOCASE LIMIT 5000`)
      .bind(hh, archived, projectId, ...(own ? [c.get("member").id] : []))
      .all<ItemRow>();
    return c.json(results.map(toListItem));
  }
  const { results } = await db
    .prepare(`${ITEM_SELECT} WHERE i.household_id = ?1 AND i.archived = ?2 AND (?3 IS NULL OR i.project_id = ?3) ORDER BY i.name COLLATE NOCASE LIMIT 5000`)
    .bind(hh, archived, projectId)
    .all<ItemRow>();
  return c.json(results.map(toListItem));
});

// Eerst kijken of we het item al hebben; zo niet, een voorstel uit Open Food Facts.
items.get("/lookup", requireFull, async (c) => {
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

// ---------- een lijst importeren, een etiket lezen ----------

const MAX_IMPORT_ROWS = 3000;

/** Dingen toevoegen aan een project: volledige leden, of een gast die volledig meedoet in dat project. */
async function projectForAdding(c: Context<AppEnv>, projectId: string | null): Promise<ProjectForItems> {
  if (!projectId) throw new ValidationError("Kies een project");
  if (!c.get("full") && (await projectScope(c.env.DB, c.get("household"), c.get("member"), projectId)) !== "all") {
    throw new ValidationError("Dat project bestaat niet (meer)");
  }
  return itemsProject(c.env.DB, c.get("household"), projectId);
}

/** Herkent hetzelfde ding (naam, merk en eigen velden), zodat een lijst twee keer importeren geen dubbels geeft. */
function sameKey(name: string, brand: string | null, attributes: unknown): string {
  return JSON.stringify([name.toLowerCase(), (brand ?? "").toLowerCase(), attributes ?? {}]);
}

/**
 * Een lijst (bv. uit een Google Sheet) in een project zetten. De app leest de kolommen al; hier wordt alles
 * nagekeken. Plaatsen worden op naam gezocht (een volledig lid maakt een nieuwe plaats aan), wat er al is
 * wordt overgeslagen, en de eigenaars gelden voor de hele lijst.
 */
items.post("/import", async (c) => {
  const obj = asObject(await c.req.json());
  const db = c.env.DB;
  const hh = c.get("household");
  const user = c.get("user");
  const project = await projectForAdding(c, optionalId(obj, "project_id"));
  let owners: OwnerShare[];
  try {
    owners = normalizeOwners(obj.owners);
  } catch (err) {
    throw new ValidationError((err as Error).message);
  }
  await assertOwned(
    db,
    hh,
    "members",
    owners.map((o) => o.member_id),
  );
  if (!Array.isArray(obj.rows) || obj.rows.length === 0) throw new ValidationError("Er staan geen rijen in deze lijst");
  if (obj.rows.length > MAX_IMPORT_ROWS) throw new ValidationError(`Hooguit ${MAX_IMPORT_ROWS} rijen per keer`);

  const type: ItemType = project.item_type ?? "consumable";
  const unit = project.item_unit && isUnit(project.item_unit) ? project.item_unit : "stuk";
  const [{ results: locations }, { results: existing }] = (await db.batch([
    db.prepare("SELECT id, name FROM locations WHERE household_id = ? ORDER BY parent_id IS NOT NULL, sort_order").bind(hh),
    db.prepare("SELECT name, brand, attributes FROM items WHERE household_id = ? AND project_id = ?").bind(hh, project.id),
  ])) as [D1Result<{ id: string; name: string }>, D1Result<{ name: string; brand: string | null; attributes: string | null }>];
  const seen = new Set(existing.map((e) => sameKey(e.name, e.brand, e.attributes ? JSON.parse(e.attributes) : {})));
  const locationIds = new Map(locations.map((l) => [l.name.toLowerCase(), l.id]));
  const fallbackLocation = locations[0]?.id ?? null;

  const result: ItemImportResult = { created: 0, skipped: [] };
  const statements: D1PreparedStatement[] = [];
  const newLocations: D1PreparedStatement[] = [];
  (obj.rows as unknown[]).forEach((raw, index) => {
    const row = index + 1;
    const r = (raw && typeof raw === "object" ? raw : {}) as ItemImportRow;
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 200) : "";
    if (!name) return result.skipped.push({ row, error: "Geen naam" });
    const brand = typeof r.brand === "string" && r.brand.trim() ? r.brand.trim().slice(0, 100) : null;
    const quantity = r.quantity === null || r.quantity === undefined ? 1 : r.quantity;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0 || quantity > 100_000) {
      return result.skipped.push({ row, error: "Onleesbaar aantal" });
    }
    const attributes = cleanAttributes(project.fields, r.attributes ?? {});
    const key = sameKey(name, brand, attributes);
    if (seen.has(key)) return result.skipped.push({ row, error: "Staat er al in" });
    seen.add(key);

    let locationId = fallbackLocation;
    const locationName = typeof r.location === "string" ? r.location.trim().slice(0, 100) : "";
    if (locationName) {
      const found = locationIds.get(locationName.toLowerCase());
      if (found) locationId = found;
      else if (c.get("full")) {
        locationId = crypto.randomUUID();
        locationIds.set(locationName.toLowerCase(), locationId);
        newLocations.push(
          db
            .prepare(
              `INSERT INTO locations (id, household_id, parent_id, name, sort_order)
               VALUES (?1, ?2, NULL, ?3, (SELECT ifnull(max(sort_order), 0) + 10 FROM locations WHERE household_id = ?2 AND parent_id IS NULL))`,
            )
            .bind(locationId, hh, locationName),
        );
      }
    }
    if (quantity > 0 && !locationId) return result.skipped.push({ row, error: "Maak eerst een plaats aan (Meer → Plaatsen)" });

    const id = crypto.randomUUID();
    const input: ItemInput = {
      name,
      type,
      category_id: null,
      default_location_id: null,
      unit,
      barcode: null,
      brand,
      vendor: null,
      min_quantity: null,
      notes: typeof r.notes === "string" && r.notes.trim() ? r.notes.trim().slice(0, 4000) : null,
      parent_id: null,
      origin: null,
      origin_note: null,
      acquired_on: null,
      value_cents: null,
      content_amount: null,
      content_unit: null,
      project_id: project.id,
      attributes,
      owners,
      tag_ids: [],
    };
    statements.push(
      db
        .prepare(`INSERT INTO items (id, household_id, ${ITEM_FIELDS.join(", ")}, created_by) VALUES (?, ?, ${ITEM_FIELDS.map(() => "?").join(", ")}, ?)`)
        .bind(id, hh, ...itemValues(input), user),
      ...ownerStatements(db, id, owners).slice(1),
    );
    if (quantity > 0 && locationId) {
      statements.push(...changeStatements(db, { itemId: id, locationId, delta: roundQuantity(quantity), reason: "add", note: "Geïmporteerd", user }));
    }
    result.created++;
  });

  // In stukken: één batch is één transactie, en een heel grote batch duurt te lang.
  if (newLocations.length) await db.batch(newLocations);
  for (let i = 0; i < statements.length; i += 400) await db.batch(statements.slice(i, i + 400));
  return c.json(result, 201);
});

/** Het JSON-schema voor de AI: naam, merk en de velden van het project (een periode als twee jaartallen). */
function labelSchema(fields: FieldDef[]) {
  const properties: Record<string, unknown> = { name: { type: ["string", "null"] }, brand: { type: ["string", "null"] } };
  for (const f of fields) {
    if (f.type === "score") continue;
    if (f.type === "year_range") {
      properties[`${f.key}_from`] = { type: ["integer", "null"] };
      properties[`${f.key}_to`] = { type: ["integer", "null"] };
    } else if (f.type === "select" && f.options?.length) properties[f.key] = { type: ["string", "null"], enum: [...f.options, null] };
    else if (f.type === "multi") properties[f.key] = { type: ["array", "null"], items: { type: "string" } };
    else if (f.type === "number" || f.type === "money") properties[f.key] = { type: ["number", "null"] };
    else if (f.type === "year") properties[f.key] = { type: ["integer", "null"] };
    else if (f.type === "bool") properties[f.key] = { type: ["boolean", "null"] };
    else properties[f.key] = { type: ["string", "null"] };
  }
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

function describeField(f: FieldDef): string {
  const extra =
    f.type === "year_range"
      ? ` (${f.key}_from en ${f.key}_to: jaartallen)`
      : f.type === "money"
        ? " (in euro)"
        : f.type === "multi"
          ? " (lijst)"
          : f.unit
            ? ` (in ${f.unit})`
            : f.type === "date"
              ? " (YYYY-MM-DD)"
              : "";
  return `- ${f.key}: ${f.label}${extra}${f.hint ? `. ${f.hint}` : ""}`;
}

/** Een foto van een etiket (wijn, typeplaatje van een fiets, …) lezen in de velden van het project. */
items.post("/scan", async (c) => {
  const form = await c.req.formData();
  const image = form.get("image");
  const projectId = form.get("project_id");
  const project = await projectForAdding(c, typeof projectId === "string" ? projectId : null);
  const empty: LabelScan = { name: null, brand: null, attributes: {} };
  if (!(image instanceof File)) return c.json({ error: "Geen foto ontvangen" }, 400);
  if (!AI_IMAGE_TYPES.includes(image.type) || image.size > MAX_IMAGE_BYTES) {
    return c.json({ ...empty, message: "Deze foto kan niet automatisch gelezen worden." });
  }
  if (!(await useAiBudget(c.env))) return c.json({ ...empty, message: "De daglimiet voor automatisch lezen is bereikt. Vul het zelf in." });

  const template = templateOf(project.template);
  const fields = project.fields.filter((f) => f.type !== "score");
  try {
    const dataUrl = `data:${image.type};base64,${toBase64(await image.arrayBuffer())}`;
    const result = await c.env.AI.run(MODEL, {
      messages: [
        {
          role: "system",
          content: `Je leest een etiket of typeplaatje op een foto. Geef enkel wat je echt ziet; gebruik null als je twijfelt. Raad nooit.
- name: ${template.name_label}, zoals op het etiket (zonder het jaartal)
- brand: ${template.brand_label}
${fields.map(describeField).join("\n")}`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Lees dit etiket." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      response_format: { type: "json_schema", json_schema: { name: "label", schema: labelSchema(fields), strict: true } },
      chat_template_kwargs: { enable_thinking: false },
      temperature: 0,
      max_tokens: 500,
    });
    const content = result.choices?.[0]?.message?.content;
    const parsed = ((typeof content === "string" ? safeJson(content) : content) ?? {}) as Record<string, unknown>;
    // Wat de AI zegt, omzetten naar de waarden van de velden en daarna gewoon nakijken.
    const raw: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.type === "year_range") raw[f.key] = [parsed[`${f.key}_from`] ?? null, parsed[`${f.key}_to`] ?? null];
      else if (f.type === "money") raw[f.key] = typeof parsed[f.key] === "number" ? Math.round((parsed[f.key] as number) * 100) : null;
      else raw[f.key] = parsed[f.key];
    }
    const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
    const scan: LabelScan = { name: text(parsed.name, 200), brand: text(parsed.brand, 100), attributes: cleanAttributes(project.fields, raw) };
    if (!scan.name && !scan.brand && Object.keys(scan.attributes).length === 0) scan.message = "Niets herkend op deze foto. Vul het zelf in.";
    return c.json(scan);
  } catch (err) {
    console.error("AI kon het etiket niet lezen", err);
    return c.json({ ...empty, message: "Automatisch lezen lukte niet. Vul het zelf in." });
  }
});

items.get("/:id", async (c) => {
  const access = await itemAccess(c, c.req.param("id"), false);
  if (!access) return c.json({ error: NOT_FOUND }, 404);
  const detail = await loadDetail(c.env.DB, c.get("household"), c.req.param("id"));
  if (!detail) return c.json({ error: NOT_FOUND }, 404);
  if (!c.get("full")) {
    // Een gast ziet enkel de uitgaven van zijn project, geen geschiedenis van de voorraad van het huishouden.
    const { results } = await c.env.DB.prepare(`${LINK_SELECT} WHERE l.item_id = ? AND p.project_id = ? ORDER BY p.purchased_on DESC`)
      .bind(detail.id, access.project_id)
      .all<ItemLink>();
    const inProject = new Set(results.map((l) => l.purchase_id));
    Object.assign(detail, {
      links: results,
      children: detail.children.filter((ch) => ch.project_id === access.project_id),
      parent: null,
      movements: detail.movements.map((m) => (m.purchase_id && !inProject.has(m.purchase_id) ? { ...m, purchase_id: null, purchase_description: null } : m)),
    });
  }
  return c.json({ ...detail, can_edit: access.scope === "all" });
});

items.post("/", async (c) => {
  const input = parseItem(await c.req.json(), true);
  const db = c.env.DB;
  const hh = c.get("household");
  const id = crypto.randomUUID();
  const user = c.get("user");
  await prepareItem(c, input);
  await checkItemRefs(db, hh, input);
  const vendorId = await resolveVendor(db, hh, input.vendor);
  const purchaseId = input.initial?.purchase_id ?? null;

  const statements = [
    db
      .prepare(
        `INSERT INTO items (id, household_id, ${ITEM_FIELDS.join(", ")}, vendor_id, created_by)
         VALUES (?, ?, ${ITEM_FIELDS.map(() => "?").join(", ")}, ?, ?)`,
      )
      .bind(id, hh, ...itemValues(input), vendorId, user),
    ...setTagsStatements(db, "item", id, input.tag_ids),
    ...ownerStatements(db, id, input.owners),
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
  if (!(await itemAccess(c, id, true))) return c.json({ error: NOT_FOUND }, 404);
  const existing = await db
    .prepare(
      `SELECT project_id, category_id, default_location_id,
         (SELECT json_group_array(tag_id) FROM taggings WHERE entity_type = 'item' AND entity_id = i.id) AS tags_json
       FROM items i WHERE id = ?`,
    )
    .bind(id)
    .first<Omit<ExistingItem, "tag_ids"> & { tags_json: string }>();
  await prepareItem(c, input, existing ? { ...existing, tag_ids: JSON.parse(existing.tags_json) as string[] } : undefined);
  await checkItemRefs(db, hh, input, id);
  const vendorId = await resolveVendor(db, hh, input.vendor);

  await guard(
    db.batch([
      db
        .prepare(`UPDATE items SET ${ITEM_FIELDS.map((f) => `${f} = ?`).join(", ")}, vendor_id = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(...itemValues(input), vendorId, id),
      ...setTagsStatements(db, "item", id, input.tag_ids),
      ...ownerStatements(db, id, input.owners),
    ]),
    { unique: BARCODE_TAKEN },
  );
  return c.json(await loadDetail(db, hh, id));
});

// Archiveren: weg uit de lijst (verkocht, kapot, weggegeven), maar de geschiedenis blijft.
items.put("/:id/archived", async (c) => {
  const archived = optionalBoolean(asObject(await c.req.json()), "archived", true) ? 1 : 0;
  if (!(await itemAccess(c, c.req.param("id"), true))) return c.json({ error: NOT_FOUND }, 404);
  const { meta } = await c.env.DB.prepare("UPDATE items SET archived = ?, updated_at = datetime('now') WHERE id = ? AND household_id = ?")
    .bind(archived, c.req.param("id"), c.get("household"))
    .run();
  if (meta.changes === 0) return c.json({ error: NOT_FOUND }, 404);
  return c.json(await loadDetail(c.env.DB, c.get("household"), c.req.param("id")));
});

items.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await itemAccess(c, id, true))) return c.json({ error: NOT_FOUND }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM taggings WHERE entity_type = 'item' AND entity_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM items WHERE id = ?").bind(id),
  ]);
  await c.env.FILES.delete(photoKey(id));
  return c.body(null, 204);
});

// ---------- uitgaven aan een ding ----------

/** Een koppeling die dit lid mag aanpassen: een gast enkel als de uitgave in het project van het ding zit. */
async function linkAllowed(c: Context<AppEnv>, item: Access, linkId: string) {
  if (c.get("full")) return true;
  const row = await c.env.DB.prepare("SELECT 1 FROM item_links l JOIN purchases p ON p.id = l.purchase_id WHERE l.id = ? AND p.project_id = ?")
    .bind(linkId, item.project_id)
    .first();
  return !!row;
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
  const item = await itemAccess(c, id, true);
  if (!item) return c.json({ error: NOT_FOUND }, 404);
  const purchase = await db
    .prepare("SELECT vendor_id, project_id FROM purchases WHERE id = ? AND household_id = ?")
    .bind(input.purchase_id, hh)
    .first<{ vendor_id: string | null; project_id: string | null }>();
  if (!purchase) throw new ValidationError("Die uitgave bestaat niet (meer).");
  if (!c.get("full")) {
    if (purchase.project_id !== item.project_id) throw new ValidationError("Die uitgave hoort niet bij dit project.");
    input.location_id = null;
  }
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
  const item = await itemAccess(c, c.req.param("id"), true);
  if (!item) return c.json({ error: NOT_FOUND }, 404);
  if (!(await linkAllowed(c, item, c.req.param("linkId")))) return c.json({ error: "Koppeling niet gevonden" }, 404);
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
  const item = await itemAccess(c, c.req.param("id"), true);
  if (!item) return c.json({ error: NOT_FOUND }, 404);
  if (!(await linkAllowed(c, item, c.req.param("linkId")))) return c.json({ error: "Koppeling niet gevonden" }, 404);
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
  if (!(await itemAccess(c, id, true))) return c.json({ error: NOT_FOUND }, 404);
  const row = await c.env.DB.prepare("INSERT INTO item_log (id, item_id, happened_on, text, created_by) VALUES (?, ?, ?, ?, ?) RETURNING *")
    .bind(crypto.randomUUID(), id, entry.happened_on, entry.text, c.get("user"))
    .first<ItemLogEntry>();
  return c.json(row, 201);
});

items.put("/:id/log/:logId", async (c) => {
  const entry = parseLog(await c.req.json());
  if (!(await itemAccess(c, c.req.param("id"), true))) return c.json({ error: NOT_FOUND }, 404);
  const row = await c.env.DB.prepare("UPDATE item_log SET happened_on = ?, text = ? WHERE id = ? AND item_id = ? RETURNING *")
    .bind(entry.happened_on, entry.text, c.req.param("logId"), c.req.param("id"))
    .first<ItemLogEntry>();
  if (!row) return c.json({ error: "Notitie niet gevonden" }, 404);
  return c.json(row);
});

items.delete("/:id/log/:logId", async (c) => {
  if (!(await itemAccess(c, c.req.param("id"), true))) return c.json({ error: NOT_FOUND }, 404);
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

  const item = await itemAccess(c, id, true);
  if (!item) return c.json({ error: NOT_FOUND }, 404);
  await assertOwned(db, hh, "locations", [input.location_id, input.to_location_id]);
  await assertOwned(db, hh, "purchases", [input.purchase_id]);
  if (!c.get("full")) await assertInProject(db, "purchases", input.purchase_id, item.project_id);
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

// ---------- foto ----------

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const photoKey = (id: string) => `items/${id}/photo`;

items.get("/:id/photo", async (c) => {
  const id = c.req.param("id");
  if (!(await itemAccess(c, id, false))) return c.json({ error: NOT_FOUND }, 404);
  const object = await c.env.FILES.get(photoKey(id));
  if (!object) return c.json({ error: "Geen foto" }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "image/jpeg",
      // De app vraagt de foto op met ?v=<versie>, dus een nieuwe foto is altijd een nieuwe URL.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

items.put("/:id/photo", async (c) => {
  const id = c.req.param("id");
  if (!(await itemAccess(c, id, true))) return c.json({ error: NOT_FOUND }, 404);
  const file = (await c.req.formData()).get("file");
  if (!(file instanceof File)) return c.json({ error: "Geen bestand ontvangen" }, 400);
  // Geen SVG: daar kan code in zitten.
  if (!PHOTO_TYPES.includes(file.type)) return c.json({ error: "Kies een foto (JPG, PNG of WebP)" }, 400);
  if (file.size > MAX_IMAGE_BYTES) return c.json({ error: "Deze foto is groter dan 3 MB" }, 400);
  await c.env.FILES.put(photoKey(id), file.stream(), { httpMetadata: { contentType: file.type } });
  const row = await c.env.DB.prepare("UPDATE items SET photo_version = COALESCE(photo_version, 0) + 1 WHERE id = ? RETURNING photo_version")
    .bind(id)
    .first<{ photo_version: number }>();
  return c.json(row);
});

items.delete("/:id/photo", async (c) => {
  const id = c.req.param("id");
  if (!(await itemAccess(c, id, true))) return c.json({ error: NOT_FOUND }, 404);
  await c.env.DB.prepare("UPDATE items SET photo_version = NULL WHERE id = ?").bind(id).run();
  await c.env.FILES.delete(photoKey(id));
  return c.body(null, 204);
});
